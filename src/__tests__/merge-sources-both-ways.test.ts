/**
 * Sources of a merge are the same whichever tree is the target (134 S-N3):
 * two sources of the import stay two (a research's two records of one
 * register differ by their number alone), a source the tree already has is
 * joined with it, and step 5 says each join the write makes (plan and write
 * use one rule). Invented trees only.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, planCounts, PlanSource, WizardChoices } from '../merge/plan.js';
import { planList } from '../merge/steps/step5-plan.js';
import { recordGroups } from '../merge/undo-view.js';
import { sanitizeMergeRecords } from '../merge/record.js';
import { StorageManager } from '../storage.js';
import { strings } from '../strings.js';
import { Person, PersonId, Source, StromData } from '../types.js';

const SOURCE: PlanSource = { kind: 'tree', label: 'Jasanovi', persons: 0 };

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-klenovec' as WizardChoices['targetTreeId'], scope: 'b', swapped: false,
        source: SOURCE, targetName: 'Klenovcovi', targetFingerprint: 'fp-target', planId: 'mp-sources', createdAt: '2026-05-04T10:00:00.000Z',
        ...over,
    };
}

function treeOf(persons: Array<[string, string, string]>, sources: Source[]): StromData {
    const data: StromData = { persons: {}, partnerships: {}, sources: {} };
    for (const [id, first, last] of persons) {
        const p: Person = {
            id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], birthDate: '1871', sourceIds: sources.map(s => s.id),
        };
        data.persons[p.id] = p;
    }
    for (const s of sources) data.sources![s.id] = s;
    return data;
}

/** The bigger tree: a research's two records of one register (their numbers alone differ) and a census. */
function bigTree(): StromData {
    const register = { title: 'Matrika Jilmov 1', repository: 'Archiv Habrovice', callNumber: '112', note: 'Narození 1850–1880' };
    return treeOf([['b1', 'Hostivít', 'Jasan']], [
        { id: 'src-b1', ...register, refn: 'S0001' },
        { id: 'src-b2', ...register, refn: 'S0002' },
        { id: 'src-b3', title: 'Sčítání 1921 Klenovec', repository: 'Archiv Habrovice', folio: '7' },
    ]);
}

/** The smaller tree: the same census (no research number) and a chronicle of its own. */
function smallTree(): StromData {
    return treeOf([['m1', 'Dobromil', 'Jasan']], [
        { id: 'src-m1', title: 'Sčítání 1921 Klenovec', repository: 'Archiv Habrovice', folio: '7' },
        { id: 'src-m2', title: 'Kronika obce Jasanov', repository: 'Obecní úřad Jasanov' },
        // The same title, another archive: not the same source.
        { id: 'src-m3', title: 'Matrika Jilmov 1', repository: 'Farní úřad Jasanov' },
    ]);
}

async function merge(target: StromData, source: StromData) {
    const state = createMergeState(structuredClone(target), structuredClone(source), { match: false });
    state.decisions.clear();
    for (const id of Object.keys(source.persons) as PersonId[]) state.decisions.set(id, { type: 'reject' });
    delete state.updateOnly;
    const plan = buildPlan(state, choices());
    const r = await applyPlan(plan, structuredClone(target), structuredClone(source));
    expect(r.ok).toBe(true);
    return { plan, state, data: r.data, record: r.record, counts: planCounts(plan) };
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('sources of a merge, both ways (134 S-N3)', () => {
    it('the result has the same sources whichever tree is the target', async () => {
        const one = await merge(bigTree(), smallTree());
        const other = await merge(smallTree(), bigTree());
        const titles = (d: StromData) => Object.values(d.sources ?? {}).map(s => `${s.title}|${s.repository ?? ''}|${s.refn ?? ''}`).sort();
        // b1, b2 (two records), the census once, the chronicle, the other archive's register.
        expect(Object.keys(one.data.sources ?? {})).toHaveLength(5);
        expect(Object.keys(other.data.sources ?? {})).toHaveLength(5);
        expect(titles(other.data)).toEqual(titles(one.data));
        // Both research records stay, each with its number.
        expect(Object.values(other.data.sources ?? {}).filter(s => s.refn).map(s => s.refn).sort()).toEqual(['S0001', 'S0002']);
    });

    it('step 5 says each join the write makes, in both ways', async () => {
        for (const [target, source] of [[bigTree(), smallTree()], [smallTree(), bigTree()]] as const) {
            const m = await merge(target, source);
            const incoming = Object.keys(source.sources ?? {}).length;
            const joinedByWrite = incoming - m.record.sources.length;
            expect(m.counts.sourcesJoined).toBe(1);
            expect(joinedByWrite).toBe(m.counts.sourcesJoined);
            // Every source of the import is cited in the result: added or joined, none lost.
            const cited = new Set(Object.values(m.data.persons).flatMap(p => p.sourceIds ?? []));
            for (const id of Object.keys(m.data.sources ?? {})) expect(cited.has(id)).toBe(true);
            const groups = planList(m.plan, m.state);
            const joined = groups.find(g => g.key === 'sourcesJoined');
            expect(joined?.count).toBe(1);
            expect(joined?.summary).toBe(strings.mergeWizard.sourcesJoinedSum(1));
            expect(joined?.lines.map(l => l.name)).toEqual(['Sčítání 1921 Klenovec']);
            // The joined source sits next to the filled-in details, before couples and links.
            const keys = groups.map(g => g.key);
            expect(keys.indexOf('sourcesJoined')).toBeLessThan(keys.indexOf('links'));
            expect(keys.indexOf('sourcesJoined')).toBeGreaterThan(keys.indexOf('fields'));
            // The sources group lists only the added ones.
            expect(groups.find(g => g.key === 'sources')?.count).toBe(m.record.sources.length);
            // The merge's record keeps the number (Merge history).
            const [rec] = sanitizeMergeRecords([JSON.parse(JSON.stringify(m.record))])!;
            expect(rec.counts.sourcesJoined).toBe(1);
            expect(recordGroups(rec, m.data).find(g => g.key === 'sourcesJoined')?.count).toBe(1);
        }
    });

    it('a source of the same title from another archive is not said to be joined', async () => {
        const target = treeOf([['t1', 'Hostivít', 'Jasan']], [{ id: 'src-t1', title: 'Matrika Jilmov 1', repository: 'Archiv Habrovice' }]);
        const source = treeOf([['s1', 'Dobromil', 'Jasan']], [{ id: 'src-s1', title: 'Matrika Jilmov 1', repository: 'Farní úřad Jasanov' }]);
        const m = await merge(target, source);
        expect(m.record.sources).toHaveLength(1);
        expect(m.counts.sourcesJoined).toBe(0);
        expect(planList(m.plan, m.state).some(g => g.key === 'sourcesJoined')).toBe(false);
    });
});
