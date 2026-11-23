/**
 * A merge and the research's marks (spec 134 §11, K9.1, K9.4, K9.6, 11h):
 * into a tree with a research its people keep their numbers, what the
 * research knows of them and their citations; a source tree linked to a
 * research of its own brings none of its marks (numbers of people, sources,
 * families and facts, `research`, origins, reading marks, place records,
 * lines), so its people are new in the target's research; a new person from
 * a GEDCOM file goes to the research as "from a family tree" (`_STROM_IMPORT`
 * under the person and its facts), never as the research's own. Invented
 * persons only.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, type WizardChoices } from '../merge/plan.js';
import { withoutResearchMarks } from '../merge/research-marks.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StorageManager } from '../storage.js';
import type { Partnership, PartnershipId, Person, PersonId, PlanSource, StromData, TreeId } from '../types.js';

function person(id: string, first: string, last: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...o,
    };
}

function couple(data: StromData, a: Person, b: Person, o: Partial<Partnership> = {}): void {
    const u: Partnership = { id: `u-${a.id}-${b.id}` as PartnershipId, person1Id: a.id, person2Id: b.id, childIds: [], status: 'married', ...o };
    data.partnerships[u.id] = u;
    a.partnerships.push(u.id);
    b.partnerships.push(u.id);
}

const VERIFY = { birth: { eid: 'E0012', confirmed: '2026-02-01' } } as unknown as Person['researchVerify'];
const KNOWS = { conflicts: [], hypos: [], searched: [] } as unknown as Person['research'];

/** The target, linked to its research: Velemír P0001 with what the research knows and a citation of S0042. */
function target(): StromData {
    const data: StromData = {
        persons: {}, partnerships: {},
        sources: { st1: { id: 'st1', title: 'Matrika N Mechová 1840–1860', refn: 'S0042' } as never },
        researchAsOf: '2026-03-01',
        placeRecords: { L0001: { id: 'L0001', names: [{ name: 'Mechová' }] } as never },
        placeRefs: { mechova: 'L0001' },
    };
    data.persons['t1' as PersonId] = person('t1', 'Velemír', 'Rozrazil', {
        birthDate: '1850', refn: 'P0001', research: KNOWS, researchVerify: VERIFY,
        researchOrigins: { birth: { kind: 'research' } } as never, birthSourceIds: ['st1'],
    });
    data.persons['t2' as PersonId] = person('t2', 'Ctibor', 'Rozrazil', { birthDate: '1990' });
    return data;
}

/** A source tree linked to another research: Velemír P0007 again (joins t1), his wife Zbyslava P0008 new, the couple F0003. */
function linkedSource(): StromData {
    const data: StromData = {
        persons: {}, partnerships: {},
        sources: { ss1: { id: 'ss1', title: 'Matrika O Kapradinov 1850–1870', refn: 'S0042', reading: 'D0003', readMark: 'm1', originalInResearch: true } as never },
        researchAsOf: '2026-04-01',
        researchDirections: { lines: [] } as never,
        placeRecords: { L0009: { id: 'L0009', names: [{ name: 'Kapradinov' }] } as never },
        placeRefs: { kapradinov: 'L0009' },
    };
    const v = person('s1', 'Velemír', 'Rozrazil', { birthDate: '1850', refn: 'P0007', research: KNOWS, researchVerify: VERIFY });
    const w = person('s2', 'Zbyslava', 'Kapradinová', {
        gender: 'female', birthDate: '1855', refn: 'P0008', research: KNOWS, researchVerify: VERIFY,
        researchOrigins: { birth: { kind: 'research' } } as never, birthSourceIds: ['ss1'],
    });
    data.persons[v.id] = v;
    data.persons[w.id] = w;
    couple(data, v, w, { researchId: 'F0003', researchVerify: VERIFY as never, researchOrigins: { marriage: { kind: 'research' } } as never });
    return data;
}

/** A GEDCOM file: Velemír (joins t1) and his son Bořek, new, his name and birth as the file gave them. */
function gedcomSource(): StromData {
    const data: StromData = {
        persons: {}, partnerships: {},
        imports: [{ id: 'I1', program: 'MyHeritage', at: '2026-05-04T09:00:00.000Z' }],
    };
    data.persons['g1' as PersonId] = person('g1', 'Velemír', 'Rozrazil', { birthDate: '1850', importId: 'I1' });
    data.persons['g2' as PersonId] = person('g2', 'Bořek', 'Rozrazil', {
        birthDate: '1880', birthPlace: 'Mechová', importId: 'I1',
        importedValues: {
            firstName: { from: 'I1', value: 'Bořek' }, lastName: { from: 'I1', value: 'Rozrazil' },
            birthDate: { from: 'I1', value: '1880' }, birthPlace: { from: 'I1', value: 'Mechová' },
        },
    });
    return data;
}

function choices(source: PlanSource, over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-rozrazil' as TreeId, scope: 'c', swapped: false,
        source, targetName: 'Rozrazilovi', targetFingerprint: 'fp-target', targetResearch: true,
        planId: 'mp-research', createdAt: '2026-05-04T10:00:00.000Z', ...over,
    };
}

/** The plan with `joins` (source id → target id) as the pairs, everyone else added. */
async function merged(t: StromData, s: StromData, source: PlanSource, joins: Record<string, string>, over: Partial<WizardChoices> = {}): Promise<StromData> {
    const state = createMergeState(t, s);
    state.decisions.clear();
    for (const id of Object.keys(s.persons) as PersonId[]) {
        const to = joins[id];
        state.decisions.set(id, to ? { type: 'manual_match', targetId: to as PersonId } : { type: 'reject' });
    }
    delete state.updateOnly;
    const result = await applyPlan(buildPlan(state, choices(source, over)), t, s);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    return result.data;
}

const byName = (data: StromData, first: string): Person => Object.values(data.persons).find(p => p.firstName === first)!;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

const LINKED: PlanSource = { kind: 'tree', label: 'Kapradinovi', persons: 2, treeId: 'tree-kapradin' as TreeId, research: true };
const GED: PlanSource = { kind: 'ged', label: 'rodokmen-rozrazilovi.ged', persons: 2, importId: 'I1' };

describe('into a tree with a research (K9.1)', () => {
    it('its people keep their number, what the research knows, the facts\' origins and their citations', async () => {
        const before = target();
        const after = await merged(target(), gedcomSource(), GED, { g1: 't1' });
        const v = after.persons['t1' as PersonId];
        const was = before.persons['t1' as PersonId];
        expect(v.refn).toBe('P0001');
        expect(v.research).toEqual(was.research);
        expect(v.researchVerify).toEqual(was.researchVerify);
        expect(v.researchOrigins).toEqual(was.researchOrigins);
        expect(v.birthSourceIds).toEqual(['st1']);
        expect(after.sources?.st1).toEqual(before.sources?.st1);
        expect(after.researchAsOf).toBe('2026-03-01');
        expect(after.placeRecords).toEqual(before.placeRecords);
        expect(after.placeRefs).toEqual(before.placeRefs);
    });
});

describe('two trees linked to a research each (11h, K9.6)', () => {
    it('nothing of the source\'s research comes over: its people are new in the target\'s research', async () => {
        const after = await merged(target(), linkedSource(), LINKED, { s1: 't1' });
        // The joined person: the target's number and research, not the source's.
        const v = after.persons['t1' as PersonId];
        expect(v.refn).toBe('P0001');
        expect(v.research).toEqual(target().persons['t1' as PersonId].research);
        expect(v.researchVerify).toEqual(VERIFY);
        // The new person: no number of the other research, nothing it knew; the person and the citation stay.
        const w = byName(after, 'Zbyslava');
        expect(w.refn).toBeUndefined();
        expect(w.research).toBeUndefined();
        expect(w.researchVerify).toBeUndefined();
        expect(w.researchOrigins).toBeUndefined();
        expect(w.birthDate).toBe('1855');
        expect(w.birthSourceIds).toHaveLength(1);
        // Its source: a new entry without the other research's number or reading, not folded into the target's S0042.
        const cited = after.sources![w.birthSourceIds![0]!]!;
        expect(cited.title).toBe('Matrika O Kapradinov 1850–1870');
        expect(cited.refn).toBeUndefined();
        expect(cited.reading).toBeUndefined();
        expect(cited.originalInResearch).toBeUndefined();
        expect(after.sources!.st1).toEqual(target().sources!.st1);
        // The couple: no family number of the other research.
        const u = Object.values(after.partnerships)[0]!;
        expect(u.researchId).toBeUndefined();
        expect(u.researchVerify).toBeUndefined();
        expect(u.researchOrigins).toBeUndefined();
        // The tree's own: its as-of, place records; no lines of the other research.
        expect(after.researchAsOf).toBe('2026-03-01');
        expect(Object.keys(after.placeRecords ?? {})).toEqual(['L0001']);
        expect(after.placeRefs).toEqual({ mechova: 'L0001' });
        expect(after.researchDirections).toBeUndefined();
        // Nothing in the result names a number of the other research.
        expect(JSON.stringify(after)).not.toMatch(/P0007|P0008|F0003|D0003|L0009/);
    });

    it('a target person without a number joined with the source\'s person does not take the other research\'s', async () => {
        const after = await merged(target(), linkedSource(), LINKED, { s1: 't2' });
        expect(after.persons['t2' as PersonId].refn).toBeUndefined();
    });

    it('a new tree of a linked tree (11f) has none of its marks either', async () => {
        const after = await merged(target(), linkedSource(), LINKED, {}, { mode: 'new', targetTreeId: null, targetResearch: false });
        expect(JSON.stringify(after)).not.toMatch(/P0007|P0008|F0003|D0003|L0009/);
        expect(Object.values(after.persons).every(p => !p.research)).toBe(true);
    });

    it('a source not linked keeps a REFN of another program and its people\'s marks as they are', async () => {
        const s = gedcomSource();
        s.persons['g2' as PersonId].refn = 'MH-1234';
        const after = await merged(target(), s, GED, { g1: 't1' });
        expect(byName(after, 'Bořek').refn).toBe('MH-1234');
    });

    it('withoutResearchMarks leaves the source itself as it was', () => {
        const s = linkedSource();
        const copy = withoutResearchMarks(s);
        expect(s.persons['s1' as PersonId].refn).toBe('P0007');
        expect(copy.persons['s1' as PersonId].refn).toBeUndefined();
        expect(copy.persons['s1' as PersonId].firstName).toBe('Velemír');
    });
});

describe('a new person from a GEDCOM file goes to the research "from a family tree" (K9.4)', () => {
    it('what is sent names the file under the person and its facts, no number of the research', async () => {
        const after = await merged(target(), gedcomSource(), GED, { g1: 't1' });
        const son = byName(after, 'Bořek');
        expect(son.importId).toBeTruthy();
        const imp = son.importId!;
        expect(after.imports?.some(r => r.id === imp)).toBe(true);
        const ged = exportToGedcom(after, 'Rozrazilovi', { research: { id: 'a1b2c3d4-0000-4000-8000-000000000001', head: 'h1' } }).content;
        const block = ged.split(/\n(?=0 )/).find(b => /^0 @[^@]+@ INDI/.test(b) && b.includes('Bořek'))!;
        expect(block).toBeTruthy();
        expect(block).toMatch(new RegExp(`^1 _STROM_IMPORT ${imp}$`, 'm'));
        expect(block).toMatch(new RegExp(`^1 BIRT[\\s\\S]*?^2 _STROM_IMPORT ${imp}`, 'm'));
        expect(block).not.toMatch(/REFN P\d/);
        expect(ged).toMatch(new RegExp(`^1 _STROM_IMPORT ${imp}$`, 'm'));
    });
});
