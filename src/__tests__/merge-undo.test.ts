/**
 * The undo of a merge (spec 134 §10, K8.1–K8.5, K9.1, K9.3): a merge and its
 * undo give the tree as it was; work done after the merge stays and is
 * listed; by parts; the undo of the undo; a later merge standing on it; a
 * picture the merge replaced comes back from the backup; the research's step.
 * Invented trees only (helpers/merge-trees.ts), deterministic seeds.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { applyPlan, buildPlan, MergeRecord, PlanScope, PlanSource, WizardChoices } from '../merge/plan.js';
import { applyUndo, redo, undoItems, undoPreview, undoResearchStep } from '../merge/undo-plan.js';
import { danglingReferences } from '../merge/merge-check.js';
import { applySyncIds, contentFingerprint } from '../research-link.js';
import { StorageManager } from '../storage.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const RUNS = 120;
const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];
const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-Jilmovi.ged', persons: 0 };
const AT = '2026-05-04T10:00:00.000Z';
const UNDO_AT = '2026-06-01T09:00:00.000Z';

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-test', createdAt: AT,
        ...over,
    };
}

/** The tree for comparing: no history, no empty collections (an undo cannot tell an empty one from none). */
function plain(data: StromData): unknown {
    const out = structuredClone(data) as unknown as Record<string, unknown>;
    delete out.merges;
    for (const key of Object.keys(out)) {
        const v = out[key];
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete out[key];
    }
    return out;
}

/** A target with the research's details of its persons (K9.1: they stay). */
function withResearch(target: StromData, rnd: () => number): StromData {
    for (const p of Object.values(target.persons)) {
        if (p.isPlaceholder || rnd() < 0.5) continue;
        p.research = { searched: [{ what: 'birth', where: 'Matrika Lhotka', result: 'none' }] } as unknown as Person['research'];
    }
    target.researchAsOf = '2026-03-01';
    return target;
}

async function merged(seed: number, over: Partial<WizardChoices> = {}): Promise<{ target: StromData; after: StromData; record: MergeRecord; source: StromData }> {
    const rnd = mulberry32(seed);
    const target = targetTree(rnd);
    if (seed % 3 === 0) withResearch(target, rnd);
    const source = sourceTree(target, rnd);
    const state = createMergeState(target, source);
    randomDecisions(state, rnd);
    delete state.updateOnly;
    const scope = SCOPES[seed % 4];
    const plan = buildPlan(state, choices({ scope, rules: scope === 'c' && rnd() < 0.5 ? { all: 'import' } : undefined, ...over }));
    const result = await applyPlan(plan, target, source);
    if (!result.ok) throw new Error(`seed ${seed}: not saved ${JSON.stringify(result.issues).slice(0, 200)}`);
    const after = result.data;
    after.merges = [...(after.merges ?? []), result.record];
    return { target, after, record: result.record, source };
}

/** A merge with something added (a person, a couple) and someone joined; the first seed from `from` that has it. */
async function richMerge(from: number): Promise<Awaited<ReturnType<typeof merged>> & { seed: number }> {
    for (let seed = from; seed < from + 200; seed++) {
        if (SCOPES[seed % 4] !== 'c') continue;
        const m = await merged(seed);
        const real = m.record.added.filter(id => !m.after.persons[id]?.isPlaceholder);
        if (real.length >= 4 && m.record.joined.length >= 2 && m.record.fields.length >= 1) return { ...m, seed };
    }
    throw new Error('no rich merge');
}

const child = (data: StromData, union: Partnership, id: string, firstName: string): Person => {
    const p: Person = {
        id: id as PersonId, firstName, lastName: 'Kořenáč', gender: 'male', birthDate: '1931', isPlaceholder: false,
        partnerships: [], parentIds: [union.person1Id, union.person2Id], childIds: [], addedAt: '2026-05-20T08:00:00.000Z',
    };
    data.persons[p.id] = p;
    union.childIds.push(p.id);
    for (const pid of [union.person1Id, union.person2Id]) data.persons[pid].childIds.push(p.id);
    return p;
};

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    // The merge's record and the persons it adds take the time of the write.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AT));
});
afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('a merge and its undo give the tree as it was (K8.1, K8.2)', () => {
    it(`${RUNS} random pairs, every scope, research details of the target kept`, async () => {
        const errors: string[] = [];
        for (let seed = 1; seed <= RUNS; seed++) {
            const { target, after, record } = await merged(seed);
            const res = applyUndo(record, after, { at: UNDO_AT });
            if (res.kept.length) errors.push(`${seed}: kept ${JSON.stringify(res.kept).slice(0, 200)}`);
            if (res.record.state !== 'undone') errors.push(`${seed}: state ${res.record.state}`);
            if (JSON.stringify(plain(res.data)) !== JSON.stringify(plain(target))) {
                expect.soft(plain(res.data), `seed ${seed}`).toEqual(plain(target));
                errors.push(`${seed}: not as before`);
            }
            if (contentFingerprint(res.data) !== contentFingerprint(target)) errors.push(`${seed}: fingerprint`);
            if (res.data.merges?.[0]?.undone?.[0]?.at !== UNDO_AT) errors.push(`${seed}: undone not recorded`);
            if (JSON.stringify(after.merges) !== JSON.stringify([record])) errors.push(`${seed}: the tree changed in place`);
        }
        expect(errors).toEqual([]);
    });

    it('the preview lists what is removed, restored and unjoined; nothing changed since', async () => {
        const { after, record } = await richMerge(1);
        const pre = undoPreview(record, after);
        expect(pre.changedSince).toEqual([]);
        expect(pre.dependents).toEqual([]);
        const removed = new Set(pre.remove.map(i => i.id));
        for (const id of record.added) expect(removed.has(`p:${id}`)).toBe(true);
        for (const id of record.partnerships) expect(removed.has(`u:${id}`)).toBe(true);
        const joined = new Set(record.joined.map(([t]) => `j:${t}`));
        expect(pre.unjoin.length).toBeGreaterThan(0);
        for (const j of pre.unjoin) expect(joined.has(j.id)).toBe(true);
        const fields = pre.unjoin.flatMap(j => j.fields);
        for (const f of record.fields) expect(fields).toContain(`f:${f.person}|${f.field.startsWith('photo') ? 'photo' : f.field}`);
    });
});

describe('work done after the merge stays and is listed (K8.1, K8.3)', () => {
    it('an edit, a new relative, a confirmation; a detail of a joined person changed since', async () => {
        const { target, after, record } = await richMerge(1);
        const now = structuredClone(after);
        const added = record.added.filter(id => !now.persons[id].isPlaceholder);
        const [edited, proven] = added;
        now.persons[edited].notes = 'Kovář v Lhotce, podle vyprávění.';
        now.persons[proven].confirmed = { birth: { at: '2026-05-10' } };
        // A new child under a couple of the merge (both partners added or one of them).
        const union = record.partnerships.map(id => now.partnerships[id as PartnershipId]).find(u => u && added.includes(u.person1Id) && u.person1Id !== edited && u.person1Id !== proven)
            ?? record.partnerships.map(id => now.partnerships[id as PartnershipId]).find(u => u && ![edited, proven].includes(u.person1Id) && ![edited, proven].includes(u.person2Id))!;
        expect(union).toBeTruthy();
        const kid = child(now, union, 'p-new-kid', 'Ctibor');
        const parentsOfKid = [union.person1Id, union.person2Id].filter(id => record.added.includes(id));
        // A joined person's merged detail changed again.
        const f = record.fields.find(x => x.field !== 'photo' && x.field !== 'gender')!;
        (now.persons[f.person] as unknown as Record<string, unknown>)[f.field] = 'změněno později';

        const pre = undoPreview(record, now);
        const what = (id: string) => pre.changedSince.filter(c => c.id === id).map(c => c.what);
        expect(what(`p:${edited}`)).toContain('edited');
        expect(pre.changedSince.find(c => c.id === `p:${proven}` && c.what === 'proven')?.at).toBe('2026-05-10');
        for (const pid of parentsOfKid) {
            const rel = pre.changedSince.find(c => c.id === `p:${pid}` && c.what === 'relative');
            expect(rel?.person).toBe(kid.id);
            expect(rel?.at).toBe('2026-05-20T08:00:00.000Z');
        }
        expect(what(`f:${f.person}|${f.field}`)).toEqual(['edited']);

        // The default keeps them.
        const res = applyUndo(record, now, { at: UNDO_AT });
        expect(res.record.state).toBe('partial');
        expect(res.data.persons[edited].notes).toBe('Kovář v Lhotce, podle vyprávění.');
        expect(res.data.persons[proven]).toBeTruthy();
        expect(res.data.persons[kid.id]).toBeTruthy();
        for (const pid of parentsOfKid) expect(res.data.persons[pid]?.childIds).toContain(kid.id);
        expect(res.data.partnerships[union.id]).toBeTruthy();
        expect((res.data.persons[f.person] as unknown as Record<string, unknown>)[f.field]).toBe('změněno později');
        expect([...danglingReferences(res.data).entries()]).toEqual([]);
        // The rest of the merge is gone.
        const keptIds = new Set(res.kept.map(k => k.id));
        for (const id of record.added) {
            if (!keptIds.has(`p:${id}`) && !parentsOfKid.includes(id)) expect(res.data.persons[id], id).toBeUndefined();
        }
        // Tree persons the merge did not touch are as they were.
        const touched = new Set([...record.joined.map(([t]) => t), ...(record.edits ?? []).map(e => e.id)]);
        for (const [id, p] of Object.entries(target.persons)) if (!touched.has(id)) expect(res.data.persons[id as PersonId]).toEqual(p);

        // Chosen after all (K8.3): the rest goes, the new child stays without those parents.
        const again = applyUndo(res.record, res.data, { at: '2026-06-02T09:00:00.000Z', undo: res.kept.map(k => k.id) });
        expect(again.kept).toEqual([]);
        expect(again.record.state).toBe('undone');
        expect(again.record.undone).toHaveLength(2);
        for (const id of record.added) expect(again.data.persons[id]).toBeUndefined();
        expect(again.data.persons[kid.id]?.parentIds.filter(id => !!again.data.persons[id])).toEqual(again.data.persons[kid.id]?.parentIds);
        expect((again.data.persons[f.person] as unknown as Record<string, unknown>)[f.field] ?? '').toBe(f.before);
        expect([...danglingReferences(again.data).entries()]).toEqual([]);
    });
});

describe('by parts (K8.1)', () => {
    it('one person, then a joined person, then the rest: as before at the end', async () => {
        const { target, after, record } = await richMerge(1);
        const first = record.added.find(id => !after.persons[id].isPlaceholder)!;
        const one = applyUndo(record, after, { only: [`p:${first}`], at: UNDO_AT });
        expect(one.items).toEqual([`p:${first}`]);
        expect(one.record.state).toBe('partial');
        expect(one.data.persons[first]).toBeUndefined();
        expect(record.added.filter(id => id !== first).every(id => !!one.data.persons[id])).toBe(true);
        expect([...danglingReferences(one.data).entries()]).toEqual([]);

        const [joinedId] = record.joined[0];
        const two = applyUndo(one.record, one.data, { only: [`j:${joinedId}`], at: '2026-06-01T10:00:00.000Z' });
        for (const f of record.fields.filter(x => x.person === joinedId && x.field !== 'photo')) {
            expect(String((two.data.persons[joinedId] as unknown as Record<string, unknown>)[f.field] ?? '')).toBe(f.before);
        }
        expect(two.record.state).toBe('partial');
        expect([...danglingReferences(two.data).entries()]).toEqual([]);

        const rest = applyUndo(two.record, two.data, { at: '2026-06-01T11:00:00.000Z' });
        expect(rest.kept).toEqual([]);
        expect(rest.record.state).toBe('undone');
        expect(rest.record.undone?.map(u => u.at)).toEqual([UNDO_AT, '2026-06-01T10:00:00.000Z', '2026-06-01T11:00:00.000Z']);
        expect(plain(rest.data)).toEqual(plain(target));
        // Every item of the merge undone once.
        expect(new Set(rest.record.undone!.flatMap(u => u.items))).toEqual(new Set(undoItems(record)));
    });
});

describe('the undo of the undo (K8.4)', () => {
    it('gives the tree as it was before the undo, the record as it was there', async () => {
        const { after, record } = await richMerge(1);
        const res = applyUndo(record, after, { at: UNDO_AT });
        const back = redo(res.record, after);
        expect(back.data).toEqual(after);
        expect(back.data).not.toBe(after);
        expect(back.record.state).toBe('valid');
        expect(back.record.undone).toBeUndefined();
    });
});

describe('a later merge standing on this one (K8.4)', () => {
    it('is reported, the persons it joined are kept unless chosen', async () => {
        const { after, record, source } = await richMerge(1);
        // A second import: a copy of two persons the first one added, one with a new child.
        const ours = record.added.filter(id => !after.persons[id].isPlaceholder).slice(0, 2);
        const second: StromData = { persons: {}, partnerships: {} };
        for (const id of ours) {
            const p = after.persons[id];
            second.persons[`k-${id}` as PersonId] = {
                id: `k-${id}` as PersonId, firstName: p.firstName, lastName: p.lastName, gender: p.gender, birthDate: p.birthDate,
                isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
            };
        }
        const state = createMergeState(after, second);
        for (const id of ours) {
            state.decisions.set(`k-${id}` as PersonId, { type: 'manual_match', targetId: id });
        }
        const plan = buildPlan(state, choices({ planId: 'mp-second', createdAt: '2026-05-06T10:00:00.000Z', source: { ...SOURCE, label: 'druhy.ged' } }));
        const res2 = await applyPlan(plan, after, second);
        expect(res2.ok).toBe(true);
        const now = res2.data;
        now.merges = [...(now.merges ?? []), res2.record];
        expect(res2.record.joined.map(([t]) => t).sort()).toEqual([...ours].sort());

        const pre = undoPreview(record, now);
        expect(pre.dependents.map(r => r.id)).toEqual(['mp-second']);
        for (const id of ours) {
            expect(pre.changedSince.find(c => c.id === `p:${id}` && c.what === 'merge')?.merge).toBe('mp-second');
        }
        const res = applyUndo(record, now, { at: UNDO_AT });
        for (const id of ours) expect(res.data.persons[id]).toBeTruthy();
        expect(res.record.state).toBe('partial');
        expect([...danglingReferences(res.data).entries()]).toEqual([]);
        // Once the later one is undone, nothing stands on it.
        const undoneSecond = applyUndo(res2.record, now, { at: UNDO_AT });
        expect(undoPreview(record, undoneSecond.data).dependents).toEqual([]);
        void source;
    });
});

describe('a picture the merge replaced (§0.3: the record keeps no pictures)', () => {
    const big = (c: string): string => `data:image/jpeg;base64,${c.repeat(3000)}`;
    const person = (id: string, firstName: string, o: Partial<Person> = {}): Person => ({
        id: id as PersonId, firstName, lastName: 'Kořenáč', gender: 'female', birthDate: '1901', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...o,
    });

    async function photoMerge(): Promise<{ target: StromData; after: StromData; record: MergeRecord }> {
        const target: StromData = { persons: { e1: person('e1', 'Bohdana', { photo: big('A'), photoOriginalName: 'stara.jpg' }) } as never, partnerships: {} };
        const source: StromData = {
            persons: {
                i1: person('i1', 'Bohdana', { photo: big('B'), photoOriginalName: 'nova.jpg' }),
                i2: person('i2', 'Radmila', { birthDate: '1925', photo: big('C') }),
            } as never, partnerships: {},
        };
        const state = createMergeState(target, source);
        for (const m of state.matches) updateMatchDecision(state, m.incomingId, 'confirm');
        if (!state.matches.some(m => m.incomingId === 'i1')) state.decisions.set('i1' as PersonId, { type: 'manual_match', targetId: 'e1' as PersonId });
        const plan = buildPlan(state, choices({ rules: { all: 'import' } }));
        const result = await applyPlan(plan, target, source);
        expect(result.ok).toBe(true);
        const after = result.data;
        after.merges = [result.record];
        return { target, after, record: result.record };
    }

    it('the record holds a token, not the picture; the undo takes it from the backup "Before merge"', async () => {
        const { target, after, record } = await photoMerge();
        expect(after.persons['e1' as PersonId].photo).toBe(big('B'));
        expect(JSON.stringify(record)).not.toContain('AAAA');
        expect(JSON.stringify(record)).not.toContain('BBBB');
        // Without the backup: kept, said why.
        const bare = applyUndo(record, after, { at: UNDO_AT });
        expect(bare.kept.map(k => k.what)).toEqual(['picture']);
        expect(bare.data.persons['e1' as PersonId].photo).toBe(big('B'));
        expect(bare.record.state).toBe('partial');
        // With it: as before.
        const res = applyUndo(record, after, { at: UNDO_AT, backup: target });
        expect(res.kept).toEqual([]);
        expect(plain(res.data)).toEqual(plain(target));
        // A backup with another picture there is not taken.
        const other = structuredClone(target);
        other.persons['e1' as PersonId].photo = big('D');
        expect(applyUndo(record, after, { at: UNDO_AT, backup: other }).kept.map(k => k.what)).toEqual(['picture']);
    });
});

describe('a send to the research is no edit after the merge (134 V-N3)', () => {
    it('the numbers a send gives the people it added: the undo removes them, nothing kept as edited', async () => {
        const { target, after, record } = await richMerge(1);
        // The send's answer: every person and source of the sent file gets the research's number (applySyncIds).
        const persons = new Map(Object.keys(after.persons).map((id, i) => [id, `@I${i + 1}@`]));
        const sources = new Map(Object.keys(after.sources ?? {}).map((id, i) => [id, `@S${i + 1}@`]));
        const ids = {
            persons: Object.fromEntries([...persons.values()].map((x, i) => [x, `P${9000 + i}`])),
            sources: Object.fromEntries([...sources.values()].map((x, i) => [x, `S${9000 + i}`])),
        };
        const { data: sent, changed } = applySyncIds(after, { persons, sources }, ids);
        expect(changed).toBeGreaterThan(0);
        for (const id of record.added) expect(sent.persons[id as PersonId].refn).toMatch(/^P\d+$/);

        const pre = undoPreview(record, sent);
        expect(pre.changedSince).toEqual([]);
        const res = applyUndo(record, sent, { at: UNDO_AT });
        expect(res.kept).toEqual([]);
        expect(res.record.state).toBe('undone');
        for (const id of record.added) expect(res.data.persons[id as PersonId]).toBeUndefined();
        // The people the tree had keep the numbers the send gave them (the research's link is not touched).
        for (const id of Object.keys(target.persons)) expect(res.data.persons[id as PersonId]?.refn).toBe(sent.persons[id as PersonId].refn);
    });

    it('a number of another program (a GEDCOM REFN) changed since is an edit', async () => {
        const { after, record } = await richMerge(1);
        const now = structuredClone(after);
        const pid = record.added.find(id => !now.persons[id as PersonId].isPlaceholder)! as PersonId;
        now.persons[pid].refn = 'R-17';
        expect(undoPreview(record, now).changedSince.filter(c => c.id === `p:${pid}`).map(c => c.what)).toContain('edited');
    });
});

describe('the research step (K9.3)', () => {
    const rec = (sent?: string): MergeRecord => ({
        id: 'mp-1', at: AT, source: SOURCE, target: { name: 'Modřínovi', newTree: false },
        counts: { joined: 0, added: 0, skipped: 0, pending: 0, total: 0, fieldChanges: 0, fieldFills: 0, differencesKept: 0, alongside: 0, partnerships: 0, links: 0, sourcesJoined: 0 },
        state: 'valid', added: [], joined: [], fields: [], partnerships: [], sources: [], places: [], media: [],
        ...(sent !== undefined ? { sentToResearch: sent } : {}),
    });

    it('names the research\'s undo of the input the send became; nothing when not sent', () => {
        expect(undoResearchStep(rec('I0412'))).toEqual({ command: 'strom sync undo I0412' });
        expect(undoResearchStep(rec())).toBeNull();
        expect(undoResearchStep(rec('R0007'))).toBeNull();
        expect(undoResearchStep(rec('I0412; rm -rf'))).toBeNull();
    });
});
