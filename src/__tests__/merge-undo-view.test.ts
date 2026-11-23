/**
 * The tree's merges in words (spec 134 §9, §10): a Merge history row, a
 * merge's list read from its record (9b) and what the undo dialog says
 * (10a right after the write, 10b kept because changed since, 10c a later
 * merge on it, 10d partly undone). Invented trees only, deterministic seeds.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, MergeRecord, PlanScope, PlanSource, WizardChoices } from '../merge/plan.js';
import { applyUndo } from '../merge/undo-plan.js';
import {
    canUndoRecord, dayText, historyLine, peopleRemoved, recordGroups, recordText, stateLabel, undoModel, undoResearchView,
} from '../merge/undo-view.js';
import { setLanguage, getCurrentLanguage } from '../strings.js';
import { StorageManager } from '../storage.js';
import { PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];
const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-Jilmovi.ged', program: 'Ancestris', persons: 0 };
const AT = '2026-05-04T10:00:00.000Z';
const LATER = '2026-05-20T09:30:00.000Z';

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-view', createdAt: AT,
        ...over,
    };
}

async function merged(seed: number): Promise<{ after: StromData; record: MergeRecord }> {
    const rnd = mulberry32(seed);
    const target = targetTree(rnd);
    const source = sourceTree(target, rnd);
    const state = createMergeState(target, source);
    randomDecisions(state, rnd);
    delete state.updateOnly;
    const plan = buildPlan(state, choices({ scope: SCOPES[seed % 4] }));
    const result = await applyPlan(plan, target, source);
    if (!result.ok) throw new Error(`seed ${seed}: not saved`);
    const after = result.data;
    after.merges = [...(after.merges ?? []), result.record];
    return { after, record: result.record };
}

/** A merge with at least four real people added, two joined and a detail changed. */
async function richMerge(): Promise<{ after: StromData; record: MergeRecord }> {
    for (let seed = 1; seed < 200; seed++) {
        if (SCOPES[seed % 4] !== 'c') continue;
        const m = await merged(seed);
        const real = m.record.added.filter(id => !m.after.persons[id]?.isPlaceholder);
        if (real.length >= 4 && m.record.joined.length >= 2 && m.record.fields.length >= 1) return m;
    }
    throw new Error('no rich merge');
}

const realAdded = (data: StromData, r: MergeRecord): PersonId[] => r.added.filter(id => data.persons[id] && !data.persons[id].isPlaceholder);

let lang: ReturnType<typeof getCurrentLanguage>;
beforeAll(() => {
    lang = getCurrentLanguage();
    setLanguage('en');
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
});
afterAll(() => {
    setLanguage(lang);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('a Merge history row (9a)', () => {
    it('says the state, the source with its program and what the merge brought', async () => {
        const { record } = await richMerge();
        expect(stateLabel('valid')).toBe('stands');
        expect(stateLabel('partial')).toBe('partly undone');
        expect(stateLabel('undone')).toBe('undone');
        const c = record.counts;
        expect(historyLine(record)).toBe(`rodokmen-Jilmovi.ged · Ancestris · ${c.added} new · ${c.joined} joined · ${c.fieldChanges} detail${c.fieldChanges === 1 ? '' : 's'}`);
        expect(historyLine({ ...record, source: { ...record.source, kind: 'tree', label: 'Habrovi', program: undefined }, counts: { ...c, joined: 0 } }))
            .toBe(`Habrovi (tree) · ${c.added} new`);
    });

    it('offers Undo for a merge into a tree that was there and not undone whole', async () => {
        const { record } = await richMerge();
        expect(canUndoRecord(record)).toBe(true);
        expect(canUndoRecord({ ...record, state: 'partial' })).toBe(true);
        expect(canUndoRecord({ ...record, state: 'undone' })).toBe(false);
        expect(canUndoRecord({ ...record, target: { ...record.target, newTree: true } })).toBe(false);
    });

    it('writes a day with its year, a plain date at noon (no day shift)', () => {
        expect(dayText('2026-11-22', 'cs')).toBe('22. 11. 2026');
        expect(dayText('2026-11-22T15:41:00', 'en')).toBe('11/22/2026');
        expect(dayText('')).toBe('');
        expect(dayText('not a date')).toBe('');
    });
});

describe("a merge's list from its record (9b)", () => {
    it("lists the record's new and joined people, its counts as written", async () => {
        const { after, record } = await richMerge();
        const groups = recordGroups(record, after);
        const g = (key: string) => groups.find(x => x.key === key)!;
        expect(g('new').count).toBe(record.counts.added);
        expect(g('new').lines.map(l => l.person).sort()).toEqual(realAdded(after, record).sort());
        expect(g('joined').count).toBe(record.counts.joined);
        expect(g('joined').lines.map(l => l.person).sort()).toEqual(record.joined.map(([t]) => t).sort());
        expect(g('fields').lines).toHaveLength(record.fields.length);
        expect(g('skipped').lines).toEqual([]);
        expect(groups.some(x => x.key === 'notTaken')).toBe(false);
        for (const x of groups) for (const l of x.lines) expect(l.can).toBe(false);
    });

    it('says how many are no longer in the tree; the text file holds every group', async () => {
        const { after, record } = await richMerge();
        const now = structuredClone(after);
        const gone = realAdded(now, record)[0];
        delete now.persons[gone];
        const fresh = recordGroups(record, now).find(x => x.key === 'new')!;
        expect(fresh.summary).toContain('1 no longer in the tree');
        expect(fresh.lines.some(l => l.person === gone)).toBe(false);
        const text = recordText(record, 'Modřínovi', recordGroups(record, now));
        expect(text.split('\n')[1]).toBe('rodokmen-Jilmovi.ged → Modřínovi · stands');
        expect(text).toContain(`New (${record.counts.added.toLocaleString()})`);
    });

    it("hides a living person's values, only says which detail changed", async () => {
        const { after, record } = await richMerge();
        const now = structuredClone(after);
        const f = record.fields[0];
        const p = now.persons[f.person];
        p.birthDate = '1990';
        delete p.deathDate;
        p.isDeceased = false;
        const line = recordGroups(record, now).find(x => x.key === 'fields')!.lines.find(l => l.key === `f:${f.person}|${f.field}`)!;
        expect(line.living).toBe(true);
        expect(line.text).not.toContain('→');
    });
});

describe('the undo dialog (10a–10d)', () => {
    it('10a right after the write: everything goes, nothing kept, the button counts the real people', async () => {
        const { after, record } = await richMerge();
        const m = undoModel(record, after);
        expect(m.empty).toBe(false);
        expect(m.keep).toEqual([]);
        expect(m.builtOn).toEqual([]);
        expect(m.partly).toBe('');
        expect(m.people).toBe(realAdded(after, record).length);
        expect(m.couples).toBe(record.partnerships.length);
        // A joined person loses something only when the merge brought them a detail or a link.
        expect(m.unjoined).toBe(m.preview.unjoin.length);
        expect(m.unjoined).toBeGreaterThan(0);
        expect(m.unjoined).toBeLessThanOrEqual(new Set(record.joined.map(([t]) => t)).size);
        expect(peopleRemoved(m, new Set(), null, after)).toBe(m.people);
        expect(m.lines.filter(l => l.group === 'remove' && l.id.startsWith('p:'))).toHaveLength(m.people);
    });

    it('10b an edit since: the person is kept unless chosen; choosing some counts only them', async () => {
        const { after, record } = await richMerge();
        const now = structuredClone(after);
        const [edited, other] = realAdded(now, record);
        now.persons[edited].notes = 'Kovář v Lhotce.';
        const m = undoModel(record, now);
        const row = m.keep.find(k => k.id === `p:${edited}`)!;
        expect(row.text).toBe('edited after the merge');
        expect(row.canUndo).toBe(true);
        expect(row.warn).toBe(false);
        expect(peopleRemoved(m, new Set(), null, now)).toBe(m.people - 1);
        expect(peopleRemoved(m, new Set([`p:${edited}`]), null, now)).toBe(m.people);
        expect(peopleRemoved(m, new Set(), new Set([`p:${other}`]), now)).toBe(1);
        expect(peopleRemoved(m, new Set(), new Set([`p:${edited}`]), now)).toBe(0);
    });

    it('10c a later merge standing on it: said with its day, its rows warned', async () => {
        const { after, record } = await richMerge();
        const now = structuredClone(after);
        const ours = realAdded(now, record)[0];
        const later: MergeRecord = {
            ...structuredClone(record), id: 'mp-later', at: LATER, added: [], joined: [[ours, 'k1' as PersonId]],
            fields: [], partnerships: [], sources: [], places: [], media: [], edits: [], undone: [], state: 'valid',
        };
        now.merges = [...(now.merges ?? []), later];
        const m = undoModel(record, now);
        expect(m.builtOn).toHaveLength(1);
        expect(m.builtOn[0]).toContain(dayText(LATER));
        expect(m.builtOn[0]).toContain(now.persons[ours].firstName!);
        expect(m.keep.find(k => k.id === `p:${ours}`)?.warn).toBe(true);
    });

    it('10d partly undone: says how many went and how many are left', async () => {
        const { after, record } = await richMerge();
        const [first] = realAdded(after, record);
        const res = applyUndo(record, after, { only: [`p:${first}`], at: '2026-05-10T08:00:00.000Z' });
        expect(res.record.state).toBe('partial');
        const m = undoModel(res.record, res.data);
        expect(m.partly).toContain('1 person already removed');
        expect(m.partly).toContain(`${m.people} ${m.people === 1 ? 'person' : 'people'}.`);
        expect(m.people).toBe(realAdded(after, record).length - 1);
    });

    it('nothing left once undone whole', async () => {
        const { after, record } = await richMerge();
        const res = applyUndo(record, after, { at: '2026-05-10T08:00:00.000Z' });
        const m = undoModel(res.record, res.data);
        expect(m.empty).toBe(true);
        expect(stateLabel(res.record.state)).toBe('undone');
    });
});

describe('the research in the undo dialog (11c, K9.3)', () => {
    it('a merge not sent to the research: nothing of the research', async () => {
        const { record } = await richMerge();
        expect(undoResearchView(record, 5)).toBeNull();
    });

    it('sent with a known input: when it went, the step in the research\'s terminal and what comes back until then', async () => {
        const { record } = await richMerge();
        const v = undoResearchView({ ...record, sentAt: LATER, sentIntake: 'R0007', sentToResearch: 'I0412' }, 143)!;
        expect(v.sent).toBe(`The merge is already in the research (sent ${dayText(LATER)}). The research does not delete people by itself.`);
        expect(v.command).toBe('strom sync undo I0412');
        expect(v.step).toBe('In the app the undo happens at once. In the research one step in the research’s terminal is needed:');
        expect(v.comesBack).toBe('Until then the research’s next version brings 143 people back – the app then offers to remove them.');
    });

    it('sent without a known input: no command, the help says how; no one to remove, nothing comes back', async () => {
        const { record } = await richMerge();
        const v = undoResearchView({ ...record, sentAt: LATER, sentIntake: 'R0007' }, 0)!;
        expect(v.command).toBeNull();
        expect(v.step).toBe('In the app the undo happens at once. How the people are removed in the research is in the help:');
        expect(v.comesBack).toBe('');
        // An input that is not one (not I + digits) gives no command either.
        expect(undoResearchView({ ...record, sentAt: LATER, sentToResearch: 'R0007; rm -rf' }, 1)!.command).toBeNull();
    });

    it('in Czech', async () => {
        const { record } = await richMerge();
        setLanguage('cs');
        try {
            const v = undoResearchView({ ...record, sentAt: '2026-11-22T14:41:00.000Z', sentToResearch: 'I0412' }, 1)!;
            expect(v.sent).toBe('Sloučení už je ve výzkumu (odesláno 22. 11. 2026). Výzkum osoby sám nesmaže.');
            expect(v.comesBack).toBe('Do té doby výzkum při příští verzi vrátí 1 osobu zpět – aplikace ji pak nabídne k odebrání.');
        } finally {
            setLanguage('en');
        }
    });
});
