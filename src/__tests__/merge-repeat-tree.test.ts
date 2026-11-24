/**
 * The same tree merged again (spec 134 K1.5, K0.7; tester finding 134 N1):
 * the second merge of a tree into the tree it went into knows the people the
 * first merge brought or joined, by the merge's record (the source's id of
 * each person it added or joined). Its people are "Same" ("merged before"),
 * none is still to decide, and adding the rest as new duplicates nobody:
 * also those the first merge added as new after step 2 (an unsure pair), and
 * those with no dates (a name alone scores below the auto-confirm bar).
 * Invented trees only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { AUTO_CONFIRM_SCORE, isEffectivelyConfirmed } from '../merge/executor.js';
import { applyPlan, buildPlan, isRepeatOf, planCounts, repeatCounts, type MergeRecord, type PlanSource, type WizardChoices } from '../merge/plan.js';
import { setLanguage, strings } from '../strings.js';
import { sanitizeMergeRecords } from '../merge/record.js';
import type { MergeState } from '../merge/types.js';
import { StorageManager } from '../storage.js';
import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

beforeAll(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
afterAll(() => { vi.restoreAllMocks(); });

/** A small tree of invented people; ids with the tree's own prefix. */
class Tree {
    readonly data: StromData = { persons: {}, partnerships: {}, sources: {}, media: {} };
    private n = 0;
    constructor(private readonly prefix: string) {}
    person(firstName: string, lastName: string, gender: Person['gender'], birthDate?: string): Person {
        const id = `${this.prefix}p${++this.n}` as PersonId;
        const p: Person = { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...(birthDate ? { birthDate } : {}) };
        this.data.persons[id] = p;
        return p;
    }
    couple(a: Person, b: Person, ...kids: Person[]): Partnership {
        const id = `${this.prefix}u${++this.n}` as PartnershipId;
        const u: Partnership = { id, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married' };
        this.data.partnerships[id] = u;
        a.partnerships.push(id);
        b.partnerships.push(id);
        for (const k of kids) {
            k.parentIds.push(a.id, b.id);
            a.childIds.push(k.id);
            b.childIds.push(k.id);
        }
        return u;
    }
}

/** The tree Pernštýnovi: a couple with a son, and a cousin with a birth year of its own. */
function targetTree(): StromData {
    const t = new Tree('T');
    const father = t.person('Hostivít', 'Pernštýn', 'male', '1851-03-14');
    const mother = t.person('Dobroslava', 'Pernštýnová', 'female', '1854-07-02');
    const son = t.person('Velemír', 'Pernštýn', 'male', '1880-01-20');
    t.couple(father, mother, son);
    t.person('Zbyhněv', 'Kořenáč', 'male', '1890');
    t.person('Mstislava', 'Ťapkalová', 'female', '1872');
    return t.data;
}

/**
 * The source tree: the same couple and son (sure pairs), two unsure pairs
 * (the cousin born 14 years later, a woman of the same name without dates)
 * and new people, some without any dates (a daughter-in-law and grandchildren).
 */
function sourceTree(): StromData {
    const s = new Tree('S');
    const father = s.person('Hostivít', 'Pernštýn', 'male', '1851-03-14');
    const mother = s.person('Dobroslava', 'Pernštýnová', 'female', '1854-07-02');
    const son = s.person('Velemír', 'Pernštýn', 'male', '1880-01-20');
    const wife = s.person('Ctislava', 'Brambořícová', 'female');
    const grandson = s.person('Kojata', 'Pernštýn', 'male');
    const granddaughter = s.person('Zbyslava', 'Pernštýnová', 'female');
    s.couple(father, mother, son);
    s.couple(son, wife, grandson, granddaughter);
    s.person('Zbyhněv', 'Kořenáč', 'male', '1904');
    s.person('Mstislava', 'Ťapkalová', 'female');
    s.person('Bolemír', 'Čmeldík', 'male', '1866');
    return s.data;
}

const SOURCE: PlanSource = { kind: 'tree', label: 'Pernštýnovi – sestřenice', treeId: 'tree-sestrenice' as PlanSource['treeId'], persons: 0 };

function choices(at: string): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-pernstyn' as WizardChoices['targetTreeId'], scope: 'a', swapped: false,
        source: { ...SOURCE }, targetName: 'Pernštýnovi', planId: `mp-${at}`, createdAt: at,
    };
}

const pending = (state: MergeState): PersonId[] => state.matches
    .filter(m => !m.incomingPerson.isPlaceholder && !isEffectivelyConfirmed(state, m)).map(m => m.incomingId);

/** One merge of `source` into `tree` as the guide writes it: every pair still to decide added as new. */
async function mergeOnce(tree: StromData, source: StromData, at: string, from: PlanSource = SOURCE): Promise<{ after: StromData; record: MergeRecord; state: MergeState; undecided: number }> {
    const state = createMergeState(structuredClone(tree), source);
    const undecided = pending(state);
    for (const id of undecided) updateMatchDecision(state, id, 'reject');
    const plan = buildPlan(state, { ...choices(at), source: { ...from } });
    const result = await applyPlan(plan, state.existingData, source);
    if (!result.ok) throw new Error(JSON.stringify(result.issues).slice(0, 300));
    const after = result.data;
    after.merges = [...(after.merges ?? []), result.record];
    return { after, record: result.record, state, undecided: undecided.length };
}

const people = (data: StromData): string[] =>
    Object.values(data.persons).filter(p => !p.isPlaceholder).map(p => `${p.firstName} ${p.lastName}`).sort();

describe('the same tree merged again (134 N1)', () => {
    it('the first merge has unsure pairs; added as new, they and the new people without dates are known the second time', async () => {
        const source = sourceTree();
        const first = await mergeOnce(targetTree(), source, '2026-11-20T10:00:00.000Z');
        expect(first.undecided).toBeGreaterThanOrEqual(2);
        expect(planCounts(buildPlan(first.state, choices('x'))).added).toBe(6);

        const again = createMergeState(structuredClone(first.after), source);
        // Every person of the source is joined with the one the first merge brought or joined: nothing to decide, nobody new.
        expect(pending(again)).toEqual([]);
        expect(again.unmatchedIncoming).toEqual([]);
        const byIncoming = new Map(again.matches.map(m => [m.incomingId, m]));
        const known = new Map<PersonId, PersonId>(first.record.joined.map(([tree, src]) => [src, tree]));
        for (const [tree, src] of Object.entries(first.record.from ?? {})) known.set(src as PersonId, tree as PersonId);
        for (const id of first.record.added) if (!first.record.from?.[id]) known.set(id, id);
        for (const p of Object.values(source.persons)) {
            const m = byIncoming.get(p.id);
            expect(m?.existingId, `${p.firstName} ${p.lastName}`).toBe(known.get(p.id));
            expect(m!.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
            if (first.record.added.includes(m!.existingId)) expect(m!.reasons).toContain('merged_before');
        }

        const second = await mergeOnce(first.after, source, '2026-11-22T10:00:00.000Z');
        expect(second.undecided).toBe(0);
        expect(planCounts(buildPlan(second.state, choices('y')))).toMatchObject({ added: 0, pending: 0, joined: 9 });
        expect(people(second.after)).toEqual(people(first.after));
    });

    it('a person edited in the tree since, or removed from it, is told as such', async () => {
        const source = sourceTree();
        const first = await mergeOnce(targetTree(), source, '2026-11-20T10:00:00.000Z');
        const tree = structuredClone(first.after);
        const wifeIn = Object.entries(first.record.from ?? {}).find(([, src]) => source.persons[src as PersonId]?.firstName === 'Ctislava')![0] as PersonId;
        tree.persons[wifeIn].birthDate = '1883';
        // A person removed from the tree since (an undo, a delete): its record is no pair.
        const cousinIn = Object.entries(first.record.from ?? {}).find(([, src]) => source.persons[src as PersonId]?.firstName === 'Bolemír')![0] as PersonId;
        delete tree.persons[cousinIn];
        const again = createMergeState(tree, source);
        const wife = again.matches.find(m => m.existingId === wifeIn);
        expect(wife?.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
        expect(again.unmatchedIncoming.map(id => source.persons[id].firstName)).toEqual(['Bolemír']);
    });

    it('an undone merge is no pair, and another tree of other ids is not the same source', async () => {
        const source = sourceTree();
        const first = await mergeOnce(targetTree(), source, '2026-11-20T10:00:00.000Z');
        const undone = structuredClone(first.after);
        undone.merges = undone.merges!.map(r => ({ ...r, state: 'undone' as const }));
        expect(createMergeState(undone, source).matches.some(m => m.reasons.includes('merged_before'))).toBe(false);
        const other = new Tree('X');
        other.person('Kojata', 'Pernštýn', 'male');
        expect(createMergeState(structuredClone(first.after), other.data).matches.some(m => m.reasons.includes('merged_before'))).toBe(false);
    });

    it('a file read again (new ids): the people the first merge added pair by their records in the file', async () => {
        const sha = 'b7'.repeat(32);
        const ged = ['0 HEAD', '1 SOUR FICTIVE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Hostivít /Pernštýn/', '1 SEX M', '1 BIRT', '2 DATE 14 MAR 1851',
            '0 @I2@ INDI', '1 NAME Ctislava /Brambořícová/', '1 SEX F',
            '0 @I3@ INDI', '1 NAME Zbyhněv /Kořenáč/', '1 SEX M', '1 BIRT', '2 DATE 1904',
            '0 TRLR'].join('\n');
        const load = (day: string): StromData => convertToStrom(parseGedcom(ged), { importOrigin: { at: day, file: 'pernstyn.ged', sha } }).data;
        const file: PlanSource = { kind: 'ged', label: 'pernstyn.ged', importId: 'I1', fingerprint: sha, persons: 3 };
        const first = await mergeOnce(targetTree(), load('2026-11-20'), '2026-11-20T10:00:00.000Z', file);
        expect(first.undecided).toBe(1);
        const again = load('2026-11-22');
        const second = createMergeState(structuredClone(first.after), again);
        expect(pending(second)).toEqual([]);
        expect(second.unmatchedIncoming).toEqual([]);
        const reasons = new Map(second.matches.map(m => [m.incomingPerson.firstName, m.reasons]));
        expect(reasons.get('Ctislava')).toEqual(['merged_before']);
        expect(reasons.get('Zbyhněv')).toEqual(['merged_before']);
        // Another file of the same program is not the same file: no pair by the merge's record.
        const other = convertToStrom(parseGedcom(ged), { importOrigin: { at: '2026-11-22', file: 'jiny.ged', sha: 'c8'.repeat(32) } }).data;
        expect(createMergeState(structuredClone(first.after), other).matches.some(m => m.reasons.includes('merged_before'))).toBe(false);
    });

    it('the record keeps the source ids of the added people through a stored copy', async () => {
        const first = await mergeOnce(targetTree(), sourceTree(), '2026-11-20T10:00:00.000Z');
        expect(Object.keys(first.record.from ?? {}).length).toBe(first.record.added.length);
        const stored = sanitizeMergeRecords(JSON.parse(JSON.stringify([first.record])))!;
        expect(stored[0].from).toEqual(first.record.from);
    });
});

describe('step 1 says the same tree was merged here before (134 N1, part C 6)', () => {
    it('found by the tree\'s id (a tree has no file fingerprint), not undone; counted by the record\'s pairs', async () => {
        const source = sourceTree();
        const first = await mergeOnce(targetTree(), source, '2026-11-20T10:00:00.000Z');
        const before = isRepeatOf(SOURCE, first.after.merges);
        expect(before?.id).toBe(first.record.id);
        expect(repeatCounts(source, first.after, before, true)).toEqual({ joined: 9, fresh: 0 });
        // A person added to the source tree since: one new.
        const grown = structuredClone(source);
        grown.persons['Sp99' as PersonId] = { id: 'Sp99' as PersonId, firstName: 'Radhošť', lastName: 'Pernštýn', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
        expect(repeatCounts(grown, first.after, before, true)).toEqual({ joined: 9, fresh: 1 });
        // Another tree, a file, an undone merge: not this source again.
        expect(isRepeatOf({ ...SOURCE, treeId: 'tree-jina' as PlanSource['treeId'] }, first.after.merges)).toBeNull();
        expect(isRepeatOf({ kind: 'json', label: 'x.json', persons: 9 }, first.after.merges)).toBeNull();
        expect(isRepeatOf(SOURCE, first.after.merges!.map(r => ({ ...r, state: 'undone' as const })))).toBeNull();
    });

    it('in the tree\'s own words', () => {
        setLanguage('cs');
        expect(strings.mergeWizard.repeatTree('Pernštýnovi – sestřenice', '20. 11. 2026', 0, 9))
            .toBe('Ze stromu Pernštýnovi – sestřenice už se sem slučovalo (20. 11. 2026). Nových je jen 0 osob; 9 je spojeno s tím dřívějším sloučením a nezdvojí se.');
        setLanguage('en');
        expect(strings.mergeWizard.repeatTree('Jilmovi', 'today 3:41 PM', 1, 3))
            .toBe('The tree Jilmovi was already merged into this one (today 3:41 PM). Only 1 person is new; 3 are joined with that earlier merge and will not be duplicated.');
    });
});
