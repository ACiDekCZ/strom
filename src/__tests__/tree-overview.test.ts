/**
 * Tree overview computations (src/tree-overview.ts): ancestors per
 * generation, grandparent lines, rememberers, honest ages at death,
 * generations relative to a person, header numbers and the focus cards.
 * Small hand-built trees with invented names only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    ancestorGenerations, grandparentLines, lineEndIds, rememberers, remembererGaps, deathAgeOf, deathAgeSummary,
    relativeGenerations, adultDeathAgeByGeneration, childrenPerCoupleByGeneration, ancestorGenerationName,
    descendantGenerationName, relativeGenerationName, overviewHeader, selectFocusCards, hasEnoughSample, MIN_SAMPLE,
    AncestorGeneration, ancestorGenerationLabel, focusBirthNoSource,
} from '../tree-overview.js';
import { computeFamilyStats, computeEvidenceGaps } from '../stats.js';
import { setLanguage } from '../strings.js';
import { StromData, Person, PersonId, Partnership, PartnershipId, toPersonId, toPartnershipId } from '../types.js';

const id = (s: string): PersonId => toPersonId(s);

/** A tiny tree builder: people, then couples with their children. */
class Tree {
    persons: Record<PersonId, Person> = {};
    partnerships: Record<PartnershipId, Partnership> = {};
    private n = 0;

    person(pid: string, extra: Partial<Person> = {}): this {
        this.persons[id(pid)] = {
            id: id(pid), firstName: pid, lastName: 'Testák', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...extra,
        };
        return this;
    }

    /** A couple (either may be absent: a lone parent) and their children. */
    family(a: string | null, b: string | null, children: string[], extra: Partial<Partnership> = {}): this {
        const parents = [a, b].filter((x): x is string => !!x);
        if (parents.length === 2) {
            const uid = toPartnershipId(`u${++this.n}`);
            this.partnerships[uid] = {
                id: uid, person1Id: id(parents[0]), person2Id: id(parents[1]), childIds: children.map(id), status: 'married', ...extra,
            };
            for (const p of parents) this.persons[id(p)].partnerships.push(uid);
        }
        for (const c of children) {
            for (const p of parents) {
                this.persons[id(c)].parentIds.push(id(p));
                this.persons[id(p)].childIds.push(id(c));
            }
        }
        return this;
    }

    data(): StromData {
        return { persons: this.persons, partnerships: this.partnerships, sources: { s1: { id: 's1', title: 'Register' } } };
    }
}

const female = { gender: 'female' as const };

/**
 * A cousin marriage. Root's parents are first cousins: their grandparents
 * Gf ⚭ Gm are root's great-grandparents along two lines.
 *
 *              Ggf
 *               |
 *          Gf ⚭ Gm
 *         /        \
 *   S1 ⚭ X1     X2 ⚭ S2
 *      |           |
 *      F    ⚭      M
 *           |
 *           R
 */
function cousinMarriage(): Tree {
    return new Tree()
        .person('Ggf', { birthDate: '1740', birthSourceIds: ['s1'] })
        .person('Gf', { birthDate: '1770', events: [{ id: 'e1', type: 'baptism', date: '1770', sourceIds: ['s1'] }] })
        .person('Gm', { ...female, birthDate: '~1768' })
        .person('S1', { birthDate: '1800' })
        .person('X1', { ...female })
        .person('X2')
        .person('S2', { ...female, birthPlace: 'Ves' })
        .person('F', { birthSourceIds: ['s1'] })
        .person('M', { ...female })
        .person('R')
        .family('Ggf', null, ['Gf'])
        .family('Gf', 'Gm', ['S1', 'S2'])
        .family('S1', 'X1', ['F'])
        .family('X2', 'S2', ['M'])
        .family('F', 'M', ['R']);
}

describe('ancestorGenerations', () => {
    it('counts an ancestor of two lines once, in the nearest generation, and reports the collapse', () => {
        const a = ancestorGenerations(cousinMarriage().data(), id('R'));
        expect(a.generations.map(g => [g.n, g.expected, g.known])).toEqual([[1, 2, 2], [2, 4, 4], [3, 8, 2], [4, 16, 1]]);
        expect(a.generations[2].ids).toEqual(['Gf', 'Gm']);
        // Gf and Gm are reached through S1 and through S2; Ggf through both of them.
        expect(a.pedigreeCollapse).toEqual(['Gf', 'Gm', 'Ggf']);
        expect(a.generationOf.get(id('Ggf'))).toBe(4);
    });

    it('counts proven births by the app rule (birth citation or a cited baptism)', () => {
        const a = ancestorGenerations(cousinMarriage().data(), id('R'));
        expect(a.generations.map(g => g.proven)).toEqual([1, 0, 1, 1]);
        // A birth on record that nothing cites: S1 (date), S2 (place), Gm (date). X1, X2 and M have no birth at all.
        expect(a.birthNoSource).toEqual(['S1', 'S2', 'Gm']);
    });

    it('lists, per generation, the people below whose parents are not both known', () => {
        const a = ancestorGenerations(cousinMarriage().data(), id('R'));
        expect(a.generations.map(g => g.gapIds)).toEqual([[], [], ['X1', 'X2'], ['Gf', 'Gm']]);
    });

    it('follows the father-most line for the path of a shared ancestor', () => {
        const a = ancestorGenerations(cousinMarriage().data(), id('R'));
        expect(a.pathOf.get(id('Gm'))).toEqual(['F', 'F', 'M']);
        expect(a.pathOf.get(id('X2'))).toEqual(['M', 'F']);
    });

    it('skips adoptive, step and foster parents and their ancestors', () => {
        const t = new Tree()
            .person('Bio', female).person('Step').person('StepDad').person('Ado', female).person('R')
            .family('StepDad', null, ['Step'])
            .family('Step', 'Bio', ['R']);
        t.persons[id('R')].parentIds.push(id('Ado'));
        t.persons[id('R')].parentRelTypes = { [id('Step')]: 'step', [id('Ado')]: 'adoptive' };
        const a = ancestorGenerations(t.data(), id('R'));
        expect(a.generations).toHaveLength(1);
        expect(a.generations[0]).toMatchObject({ n: 1, known: 1, ids: ['Bio'] });
        expect(lineEndIds(t.data(), id('R'))).toEqual(['Bio']);
    });

    it('never counts a placeholder parent', () => {
        const t = new Tree().person('Unknown', { isPlaceholder: true }).person('M', female).person('R')
            .family('Unknown', 'M', ['R']);
        expect(ancestorGenerations(t.data(), id('R')).generations.map(g => g.known)).toEqual([1]);
    });

    it('ends on a parent loop', () => {
        const t = new Tree().person('A').person('B').person('R').family('A', null, ['R']);
        t.family('B', null, ['A']).family('A', null, ['B']);
        const a = ancestorGenerations(t.data(), id('R'));
        expect(a.generations.map(g => g.ids)).toEqual([['A'], ['B']]);
        expect(lineEndIds(t.data(), id('R'))).toEqual([]);
        expect(grandparentLines(t.data(), id('R'))[0]).toMatchObject({ slot: 'FF', grandparentId: 'B', deepest: 3, personId: 'A' });
        expect(rememberers(t.data(), id('R'), 2026)).toEqual([]);
        expect(relativeGenerations(t.data(), id('R')).get(id('B'))).toBe(-2);
    });

    it('is empty for a person without parents or an unknown id', () => {
        const t = new Tree().person('R');
        expect(ancestorGenerations(t.data(), id('R')).generations).toEqual([]);
        expect(ancestorGenerations(t.data(), id('nobody')).generations).toEqual([]);
    });

    /**
     * What the research's `strom stats` gives for the same tree
     * (strom-research src/core/overview.ts treeStats over people.ts
     * ancestorGenerations: focus = 1, parents = 2…, expected 2^(g-1), each
     * ancestor once in the first generation the walk reaches): generations
     * 2..5 → expected 2, 4, 8, 16 and known 2, 4, 2, 1 — the app's n = g − 1.
     */
    it('agrees with the research numbering on expected and known', () => {
        const research = [
            { generation: 2, expected: 2, known: 2 }, { generation: 3, expected: 4, known: 4 },
            { generation: 4, expected: 8, known: 2 }, { generation: 5, expected: 16, known: 1 },
        ];
        const a = ancestorGenerations(cousinMarriage().data(), id('R'));
        expect(a.generations.map(g => ({ generation: g.n + 1, expected: g.expected, known: g.known }))).toEqual(research);
    });
});

describe('grandparentLines and lineEndIds', () => {
    it('gives the four lines in fixed order with the farthest generation and its person', () => {
        const lines = grandparentLines(cousinMarriage().data(), id('R'));
        expect(lines.map(l => [l.slot, l.grandparentId, l.deepest, l.personId])).toEqual([
            ['FF', 'S1', 4, 'Ggf'], ['FM', 'X1', 2, 'X1'], ['MF', 'X2', 2, 'X2'], ['MM', 'S2', 4, 'Ggf'],
        ]);
        expect(lines[0].year).toEqual({ year: 1740, approx: false, from: 'birth' });
        expect(lines[1].year).toBeNull();
    });

    it('picks the earliest birth year at the farthest generation, marking an approximate one', () => {
        const t = cousinMarriage();
        delete t.persons[id('Ggf')];
        t.persons[id('Gf')].parentIds = [];
        const fatherLine = grandparentLines(t.data(), id('R'))[0];
        expect(fatherLine).toMatchObject({ deepest: 3, personId: 'Gm', year: { year: 1768, approx: true, from: 'birth' } });
    });

    it('falls back to the baptism year', () => {
        const t = cousinMarriage();
        delete t.persons[id('Ggf')].birthDate;
        t.persons[id('Ggf')].events = [{ id: 'b', type: 'baptism', date: '1741-03-02' }];
        expect(grandparentLines(t.data(), id('R'))[0].year).toEqual({ year: 1741, approx: false, from: 'baptism' });
    });

    it('leaves a missing grandparent empty', () => {
        const t = new Tree().person('Gf').person('F').person('M', female).person('R')
            .family('Gf', null, ['F']).family('F', 'M', ['R']);
        const lines = grandparentLines(t.data(), id('R'));
        expect(lines.map(l => l.grandparentId)).toEqual(['Gf', null, null, null]);
        expect(lines[3]).toEqual({ slot: 'MM', grandparentId: null, deepest: null, personId: null, year: null });
    });

    it('lists the line ends by generation, then name', () => {
        expect(lineEndIds(cousinMarriage().data(), id('R'))).toEqual(['X1', 'X2', 'Gm', 'Ggf']);
    });
});

describe('rememberers', () => {
    /**
     *   Gf ⚭ Gm            Gf ⚭ Other (second marriage) → Half
     *      |
     *   F ⚭ M   (+ F's full sister Aunt)
     *      |
     *      R
     */
    function family(): Tree {
        return new Tree()
            .person('Gf', { birthDate: '1880', deathDate: '1927-01-05' })
            .person('Gm', { ...female, birthDate: '1885', deathDate: '1926-12-31' })
            .person('Other', { ...female, birthDate: '1890' , deathDate: '1960' })
            .person('Half', { ...female, birthDate: '1915', deathDate: '1990', deathPlace: 'Ves', deathCause: 'mrtvice',
                birthPlace: 'Ves' })
            .person('Aunt', { ...female, birthDate: '1907', isDeceased: true, question: 'Kde je pohřbena?' })
            .person('F', { birthDate: '1906', isDeceased: true })
            .person('M', { ...female, birthDate: '1950' })
            .person('R', { birthDate: '1975' })
            .family('Gf', 'Gm', ['F', 'Aunt'])
            .family('Gf', 'Other', ['Half'])
            .family('F', 'M', ['R']);
    }

    it('takes deaths after (year − 100), else births after (year − 120), and leaves the living out', () => {
        const list = rememberers(family().data(), id('R'), 2026);
        // Gm died 1926 (not after 1926), F has no death year and was born 1906 (not after 1906); M is living.
        expect(list.map(r => [r.id, r.kind, r.generation])).toEqual([
            ['Aunt', 'sibling', 1], ['Half', 'sibling', 1], ['Gf', 'ancestor', 2],
        ]);
    });

    it('includes half siblings of an ancestor and keeps the ancestor path', () => {
        const list = rememberers(family().data(), id('R'), 2026);
        const half = list.find(r => r.id === 'Half')!;
        const aunt = list.find(r => r.id === 'Aunt')!;
        expect(half).toMatchObject({ kind: 'sibling', half: true, path: ['F'] });
        expect(aunt).toMatchObject({ kind: 'sibling', half: false, path: ['F'] });
        expect(list.find(r => r.id === 'Gf')!.path).toEqual(['F', 'F']);
    });

    it('does not call a sibling half when the ancestor has only one parent recorded', () => {
        // F has only his father Gf in the tree; his brother Bro has both Gf and Gm.
        const t = new Tree()
            .person('Gf', { birthDate: '1880', deathDate: '1950' })
            .person('Gm', { ...female, birthDate: '1885', deathDate: '1950' })
            .person('Bro', { birthDate: '1910', deathDate: '1990' })
            .person('F', { birthDate: '1908', deathDate: '1980' })
            .person('R', { birthDate: '1975' })
            .family('Gf', 'Gm', ['Bro'])
            .family('Gf', null, ['F'])
            .family('F', null, ['R']);
        const list = rememberers(t.data(), id('R'), 2026);
        expect(list.find(r => r.id === 'Bro')).toMatchObject({ kind: 'sibling', half: false });
    });

    it('calls a sibling half when a real parent in the same role differs', () => {
        const t = new Tree()
            .person('Gf', { birthDate: '1880', deathDate: '1950' })
            .person('Gm', { ...female, birthDate: '1885', deathDate: '1950' })
            .person('Gm2', { ...female, birthDate: '1888', deathDate: '1950' })
            .person('Bro', { birthDate: '1910', deathDate: '1990' })
            .person('F', { birthDate: '1908', deathDate: '1980' })
            .person('R', { birthDate: '1975' })
            .family('Gf', 'Gm', ['F'])
            .family('Gf', 'Gm2', ['Bro'])
            .family('F', null, ['R']);
        const list = rememberers(t.data(), id('R'), 2026);
        expect(list.find(r => r.id === 'Bro')).toMatchObject({ kind: 'sibling', half: true });
    });

    it('says what is missing and carries the question', () => {
        const list = rememberers(family().data(), id('R'), 2026);
        const by = Object.fromEntries(list.map(r => [r.id, r]));
        expect(by.Half.missing).toEqual([]);
        expect(by.Aunt.missing).toEqual(['deathDate', 'deathPlace', 'deathCause', 'birthPlace']);
        expect(by.Aunt.question).toBe('Kde je pohřbena?');
        expect(by.Aunt.deathYear).toBeNull();
        expect(by.Gf).toMatchObject({ deathYear: 1927, birthYear: { year: 1880 }, missing: ['deathPlace', 'deathCause', 'birthPlace'] });
        expect(remembererGaps(list)).toEqual(['Aunt', 'Gf']);
    });

    it('counts facts on death, burial and baptism events', () => {
        const t = family();
        t.persons[id('Gf')].events = [
            { id: 'd', type: 'death', place: 'Ves' },
            { id: 'b', type: 'burial', cause: 'tyf' },
            { id: 'k', type: 'baptism', place: 'Fara' },
        ];
        const gf = rememberers(t.data(), id('R'), 2026).find(r => r.id === 'Gf')!;
        expect(gf.missing).toEqual([]);
    });

    it('moves with the current year', () => {
        const list = rememberers(family().data(), id('R'), 2027);
        expect(list.map(r => r.id)).not.toContain('Gf'); // died 1927: not after 1927
    });
});

describe('deathAgeOf and deathAgeSummary', () => {
    const one = (extra: Partial<Person>): Person => ({
        id: id('x'), firstName: 'X', lastName: 'Testák', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    });

    it('reads ages from the dates, the baptism and the burial', () => {
        expect(deathAgeOf(one({ birthDate: '1850-01-01', deathDate: '1850-06-01' }))).toMatchObject({ years: 0, min: 0, max: 0 });
        expect(deathAgeOf(one({ events: [{ id: 'b', type: 'baptism', date: '1850-03-01' }], deathDate: '1900-03-02' })))
            .toMatchObject({ years: 50, from: 'dates' });
        expect(deathAgeOf(one({ birthDate: '1800-01-01', events: [{ id: 'p', type: 'burial', date: '1860-05-05' }] })))
            .toMatchObject({ years: 60 });
    });

    it('gives a range from the precision of the dates and widens an approximate one', () => {
        expect(deathAgeOf(one({ birthDate: '1850', deathDate: '1853' }))).toMatchObject({ min: 2, max: 3 });
        expect(deathAgeOf(one({ birthDate: '~1850', deathDate: '1853' }))).toMatchObject({ min: 1, max: 4 });
    });

    it('falls back to the recorded age, words included', () => {
        expect(deathAgeOf(one({ deathAge: '54 let' }))).toMatchObject({ years: 54, min: 54, max: 54, from: 'recorded' });
        expect(deathAgeOf(one({ deathAge: 'kojenec' }))).toMatchObject({ years: 0, max: 0 });
        expect(deathAgeOf(one({ deathAge: 'mrtvě narozené' }))).toMatchObject({ years: 0, max: 0 });
        expect(deathAgeOf(one({ deathAge: 'STILLBORN' }))).toMatchObject({ max: 0 });
        expect(deathAgeOf(one({ events: [{ id: 'd', type: 'death', age: '3 Monate' }] }))).toMatchObject({ years: 0, max: 0 });
        // A "before" date says too little: the recorded age is used.
        expect(deathAgeOf(one({ birthDate: '<1800', deathDate: '1860', deathAge: '62' }))).toMatchObject({ years: 62 });
        expect(deathAgeOf(one({ birthDate: '<1800', deathDate: '1860' }))).toBeNull();
    });

    it('drops implausible ages', () => {
        expect(deathAgeOf(one({ birthDate: '1700', deathDate: '1850' }))).toBeNull();
        expect(deathAgeOf(one({ birthDate: '1850-05-01', deathDate: '1849-01-01' }))).toBeNull();
        expect(deathAgeOf(one({ deathAge: '130' }))).toBeNull();
        expect(deathAgeOf(one({ birthDate: '1850' }))).toBeNull();
    });

    it('summarises deaths under 5 and the adult median with the sample sizes', () => {
        const t = new Tree()
            .person('infant', { birthDate: '1850-01-01', deathDate: '1850-02-01' })
            .person('stillborn', { deathAge: 'mrtvě narozené' })
            .person('three', { birthDate: '1850', deathDate: '1853' })              // 2–3: under 5
            .person('unclear', { birthDate: '1850', deathDate: '1855' })            // 4–5: left out of under 5
            .person('child', { birthDate: '1850-01-01', deathDate: '1860-01-01' })  // 10: not under 5, not adult
            .person('teen', { birthDate: '1850', deathDate: '1865' })               // 14–15: spans 15, not adult
            .person('a40', { birthDate: '1800-01-01', deathDate: '1840-06-01' })
            .person('a60', { deathAge: '60 let' })
            .person('a70', { birthDate: '1800-01-01', deathDate: '1870-06-01' })
            .person('old', { birthDate: '1700', deathDate: '1850' })                // 150: dropped
            .person('alive', { birthDate: '1990' })
            .person('ph', { isPlaceholder: true, deathAge: '1' });
        const s = deathAgeSummary(t.data());
        expect(s.diedUnder5).toEqual({ count: 3, n: 8 });
        expect(s.adultMedian).toEqual({ median: 60, n: 3 });
        expect(deathAgeSummary(t.data(), [id('a40'), id('a70')]).adultMedian).toEqual({ median: 55, n: 2 });
        expect(deathAgeSummary(t.data(), []).adultMedian).toEqual({ median: null, n: 0 });
    });

    it('shows a number only from n = 5', () => {
        expect(MIN_SAMPLE).toBe(5);
        expect(hasEnoughSample(4)).toBe(false);
        expect(hasEnoughSample(5)).toBe(true);
    });
});

describe('relativeGenerations', () => {
    it('places relatives by the shared ancestor, partners by their partner', () => {
        const t = cousinMarriage()
            .person('Sib').person('Kid', female).person('Cousin').person('Wife', female).person('Child')
            .person('Uncle').person('UncleWife', female);
        t.family('F', 'M', ['Sib']);
        t.family('X2', 'S2', ['Uncle']).family('Uncle', 'UncleWife', ['Cousin']);
        t.family('R', 'Wife', ['Child']);
        const g = relativeGenerations(t.data(), id('R'));
        expect(Object.fromEntries(g)).toMatchObject({
            R: 0, Sib: 0, Wife: 0, Cousin: 0, Child: 1, F: -1, M: -1, Uncle: -1, UncleWife: -1,
            S1: -2, X1: -2, S2: -2, X2: -2, Gf: -3, Gm: -3, Ggf: -4,
        });
    });

    it('takes the shortest path when generations skew (an uncle marrying his niece)', () => {
        //  Gp → F and U (brothers); U ⚭ Uw → M; F ⚭ M → R.
        const t = new Tree().person('Gp').person('F').person('U').person('Uw', female).person('M', female).person('R')
            .family('Gp', null, ['F', 'U']).family('U', 'Uw', ['M']).family('F', 'M', ['R']);
        const g = relativeGenerations(t.data(), id('R'));
        expect(g.get(id('U'))).toBe(-2);   // via M (2 steps), not via F and Gp (3 steps, −1)
        expect(g.get(id('Gp'))).toBe(-2);
    });

    it('walks through a placeholder parent but leaves it out', () => {
        const t = new Tree().person('Unknown', { isPlaceholder: true }).person('R').person('Brother')
            .family('Unknown', null, ['R', 'Brother']);
        const g = relativeGenerations(t.data(), id('R'));
        expect(g.get(id('Brother'))).toBe(0);
        expect(g.has(id('Unknown'))).toBe(false);
    });

    it('groups adult ages and children per couple per relative generation', () => {
        const t = cousinMarriage();
        t.persons[id('F')].birthDate = '1830-01-01'; t.persons[id('F')].deathDate = '1880-06-01';
        t.persons[id('M')].deathAge = '70 let';
        t.person('Wife', female).family('R', 'Wife', []);
        t.person('Ph', { isPlaceholder: true }).family('Ph', 'X1', []);
        const data = t.data();
        const g = relativeGenerations(data, id('R'));
        expect(adultDeathAgeByGeneration(data, g)).toEqual([{ generation: -1, median: 60, n: 2 }]);
        expect(childrenPerCoupleByGeneration(data, g)).toEqual([
            { generation: -3, avgChildren: 2, n: 1 },       // Gf ⚭ Gm (Ggf alone has no union)
            { generation: -2, avgChildren: 0.7, n: 3 },     // S1 ⚭ X1, X2 ⚭ S2, Ph ⚭ X1 (childless)
            { generation: -1, avgChildren: 1, n: 1 },
            { generation: 0, avgChildren: 0, n: 1 },        // R ⚭ Wife, childless, counted as in the statistics
        ]);
    });
});

describe('generation names', () => {
    afterEach(() => setLanguage('en'));

    it('names ancestor and descendant generations in English, ordinals included', () => {
        setLanguage('en');
        expect([1, 2, 3, 4, 5].map(ancestorGenerationName)).toEqual([
            'parents', 'grandparents', 'great-grandparents', '2nd great-grandparents', '3rd great-grandparents',
        ]);
        expect([13, 14, 15, 23, 24].map(ancestorGenerationName)).toEqual([
            '11th great-grandparents', '12th great-grandparents', '13th great-grandparents',
            '21st great-grandparents', '22nd great-grandparents',
        ]);
        expect([1, 2, 3, 4].map(descendantGenerationName)).toEqual([
            'children', 'grandchildren', 'great-grandchildren', '2nd great-grandchildren',
        ]);
        expect([-2, 0, 1].map(relativeGenerationName)).toEqual(['grandparents', 'same generation', 'children']);
    });

    it('names them in Czech', () => {
        setLanguage('cs');
        expect([1, 2, 3, 4, 9].map(ancestorGenerationName)).toEqual([
            'rodiče', 'prarodiče', 'praprarodiče', '4. generace předků', '9. generace předků',
        ]);
        expect([1, 2, 3, 4].map(descendantGenerationName)).toEqual(['děti', 'vnoučata', 'pravnoučata', '4. generace potomků']);
        expect(relativeGenerationName(0)).toBe('generace osoby');
    });

    it('names them in German', () => {
        setLanguage('de');
        expect([1, 2, 3, 4, 5].map(ancestorGenerationName)).toEqual([
            'Eltern', 'Großeltern', 'Urgroßeltern', 'Ururgroßeltern', '5. Ahnengeneration',
        ]);
        expect([1, 2, 3, 4, 5].map(descendantGenerationName)).toEqual([
            'Kinder', 'Enkel', 'Urenkel', 'Ururenkel', '5. Nachkommengeneration',
        ]);
        expect(relativeGenerationName(0)).toBe('eigene Generation');
    });
});

describe('overviewHeader', () => {
    it('counts real persons, generations as the statistics, the year span and sources incl. unions', () => {
        const t = cousinMarriage()
            .person('Lonely', { isPlaceholder: true })
            .person('Stray', { birthDate: '1990' });
        t.partnerships[Object.keys(t.partnerships)[0] as PartnershipId].sourceIds = ['s1']; // Gf ⚭ Gm
        const data = t.data();
        const h = overviewHeader(data);
        expect(h.persons).toBe(11);
        expect(h.generations).toBe(computeFamilyStats(data).generations);
        expect(h.yearSpan).toEqual({ first: 1740, last: 1990 });
        // Ggf, F (birth citations), Gf (cited baptism and the union), Gm (the union only).
        expect(h.withSource).toBe(4);
        expect(h.withSource + computeEvidenceGaps(data).noSource.length).toBe(h.persons);
        expect(h.withSourceShare).toBeCloseTo(4 / 11);
        // The family and Stray; the placeholder-only island does not count.
        expect(h.islands).toBe(2);
    });

    it('handles an empty tree', () => {
        expect(overviewHeader({ persons: {}, partnerships: {} })).toEqual({
            persons: 0, generations: 0, yearSpan: null, withSource: 0, withSourceShare: 0, islands: 0,
        });
    });
});

describe('selectFocusCards', () => {
    const row = (n: number, known: number, gapIds: string[] = [], filled = known): AncestorGeneration => ({
        n, expected: 2 ** n, known, filled, proven: 0, ids: [], gapIds: gapIds.map(id),
    });

    it('keeps the fixed order and at most three cards', () => {
        const cards = selectFocusCards({
            validationErrors: 2,
            generations: [row(1, 2), row(2, 3), row(3, 5, ['a'])],
            ancestorBirthsNoSource: [id('b')],
            rememberers: [id('c')],
            researchWaiting: 3,
        });
        expect(cards.map(c => c.kind)).toEqual(['validation', 'ancestorGap', 'birthNoSource']);
        // Generation 2 misses 1 of 4 (not more than a quarter); generation 3 misses 3 of 8.
        expect(cards[1]).toEqual({ kind: 'ancestorGap', count: 3, n: 3, known: 5, filled: 5, expected: 8, ids: ['a'] });
    });

    it('moves on to the rememberers and the research when earlier cards do not apply', () => {
        const cards = selectFocusCards({
            validationErrors: 0, generations: [row(1, 2), row(2, 4)], ancestorBirthsNoSource: [],
            rememberers: [id('c'), id('d')], researchWaiting: 3,
        });
        expect(cards).toEqual([
            { kind: 'rememberers', count: 2, ids: ['c', 'd'] },
            { kind: 'researchWaiting', count: 3 },
        ]);
    });

    it('counts places a repeated ancestor fills and never shows a generation without gaps', () => {
        // Generation 3 knows 4 distinct people of 8, but pedigree collapse fills all 8 places.
        expect(selectFocusCards({
            validationErrors: 0, generations: [row(1, 2), row(2, 4), row(3, 4, [], 8)], ancestorBirthsNoSource: [], rememberers: [],
        })).toEqual([]);
        // A generation short of places but with nobody to attach the missing to (no gapIds) gives no card either.
        expect(selectFocusCards({
            validationErrors: 0, generations: [row(3, 4, [], 5)], ancestorBirthsNoSource: [], rememberers: [],
        })).toEqual([]);
        // Filled 5 of 8 is below three quarters: the card counts the missing places.
        expect(selectFocusCards({
            validationErrors: 0, generations: [row(3, 4, ['a'], 5)], ancestorBirthsNoSource: [], rememberers: [],
        })).toEqual([{ kind: 'ancestorGap', count: 3, n: 3, known: 4, filled: 5, expected: 8, ids: ['a'] }]);
    });

    it('gives no gap card for a multiple pedigree collapse where no parent is missing', () => {
        // Double first cousins: F's parents and M's parents are two pairs of siblings, so R has
        // only 4 distinct great-grandparents (A1 ⚭ A2, B1 ⚭ B2), each at two places.
        const t = new Tree()
            .person('A1').person('A2', female).person('B1').person('B2', female)
            .person('Pa').person('Pb', female).person('Qb').person('Qa', female)
            .person('F').person('M', female).person('R')
            .family('A1', 'A2', ['Pa', 'Qa'])
            .family('B1', 'B2', ['Pb', 'Qb'])
            .family('Pa', 'Pb', ['F'])
            .family('Qb', 'Qa', ['M'])
            .family('F', 'M', ['R']);
        const a = ancestorGenerations(t.data(), id('R'));
        expect(a.generations.map(g => [g.n, g.known, g.filled])).toEqual([[1, 2, 2], [2, 4, 4], [3, 4, 8]]);
        expect(a.generations[2].gapIds).toEqual([]);
        expect(selectFocusCards({
            validationErrors: 0, generations: a.generations, ancestorBirthsNoSource: [], rememberers: [],
        })).toEqual([]);
    });

    it('is empty when the tree is in good shape (and outside the research)', () => {
        expect(selectFocusCards({ validationErrors: 0, generations: [], ancestorBirthsNoSource: [], rememberers: [] })).toEqual([]);
        expect(selectFocusCards({
            validationErrors: 0, generations: [], ancestorBirthsNoSource: [], rememberers: [], researchWaiting: 0,
        })).toEqual([]);
    });
});

describe('ancestorGenerationLabel', () => {
    it('names ancestor, own and descendant generations in both forms and all languages', () => {
        expect([1, 2, 3, 4, 5].map(n => ancestorGenerationLabel(n, 'cs'))).toEqual([
            'rodiče', 'prarodiče', 'praprarodiče', '4. generace předků', '5. generace předků',
        ]);
        expect([1, 2, 3, 4].map(n => ancestorGenerationLabel(n, 'cs', 'of'))).toEqual([
            'generace rodičů', 'generace prarodičů', 'generace praprarodičů', '4. generace předků',
        ]);
        expect([-1, -2, -3, -4].map(n => ancestorGenerationLabel(n, 'cs', 'of'))).toEqual([
            'generace dětí', 'generace vnuků', 'generace pravnuků', '4. generace potomků',
        ]);
        expect(ancestorGenerationLabel(0, 'cs', 'of')).toBe('generace osoby');
        expect([1, 3, 4, 5].map(n => ancestorGenerationLabel(n, 'en'))).toEqual([
            'parents', 'great-grandparents', '2nd great-grandparents', '3rd great-grandparents',
        ]);
        expect(ancestorGenerationLabel(-2, 'en')).toBe('grandchildren');
        expect([4, 5].map(n => ancestorGenerationLabel(n, 'de'))).toEqual(['Ururgroßeltern', '5. Ahnengeneration']);
        expect(ancestorGenerationLabel(-1, 'de', 'of')).toBe('Generation der Kinder');
    });
});

describe('focusBirthNoSource', () => {
    it('keeps the direct ancestors of generations 1 to 4 only', () => {
        // Ggf (generation 4) has a cited birth; give a deeper ancestor an uncited one.
        const t = cousinMarriage().person('Gggf', { birthDate: '1710' }).family('Gggf', null, ['Ggf']);
        const a = ancestorGenerations(t.data(), id('R'));
        expect(a.birthNoSource).toContain('Gggf');
        expect(focusBirthNoSource(a)).toEqual(['S1', 'S2', 'Gm']);
    });
});
