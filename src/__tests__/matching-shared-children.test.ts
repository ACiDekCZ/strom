/**
 * Spec 134 K10.6: the partner of a joined person, written in the tree under
 * the surname after marriage and in the import under the birth one, is
 * offered through the shared joined children (Maybe the same), never left
 * as a new person — so the children get no third parent and the partner no
 * second spouse.
 */
import { describe, it, expect } from 'vitest';
import { findMatches, createMergeState, reanalyzeMatches } from '../merge/matching.js';
import { AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { Person, StromData, PersonId } from '../types.js';
import { toPersonId } from '../ids.js';

type Spec = Partial<Omit<Person, 'id'>> & { id: string; firstName: string; lastName: string; gender: Person['gender'] };
type Union = { id: string; a: string; b: string; children: string[] };

function data(people: Spec[], unions: Union[]): StromData {
    const persons: Record<string, Person> = {};
    for (const p of people) {
        persons[p.id] = { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p, id: toPersonId(p.id) } as Person;
    }
    const partnerships: Record<string, unknown> = {};
    for (const u of unions) {
        partnerships[u.id] = { id: u.id, person1Id: toPersonId(u.a), person2Id: toPersonId(u.b), status: 'married', childIds: u.children.map(toPersonId) };
        for (const id of [u.a, u.b]) {
            persons[id].partnerships.push(u.id as never);
            for (const c of u.children) persons[id].childIds.push(toPersonId(c));
        }
        for (const c of u.children) persons[c].parentIds.push(toPersonId(u.a), toPersonId(u.b));
    }
    return { persons, partnerships } as unknown as StromData;
}

const children = (pre: string): Spec[] => [
    { id: `${pre}c1`, firstName: 'Karel', lastName: 'Modřín', gender: 'male', birthDate: '1896-01-10' },
    { id: `${pre}c2`, firstName: 'Věra', lastName: 'Modřínová', gender: 'female', birthDate: '1898-03-11' },
    { id: `${pre}c3`, firstName: 'Josef', lastName: 'Modřín', gender: 'male', birthDate: '1901-07-12' },
];

/** The tree: Ondřej Modřín, his wife under the surname after marriage, three children. */
function tree(wife: Partial<Spec> = {}, husband: Partial<Spec> = {}): StromData {
    return data([
        { id: 'th', firstName: 'Ondřej', lastName: 'Modřín', gender: 'male', birthDate: '1871-04-02', ...husband },
        { id: 'tw', firstName: 'Marie Anna', lastName: 'Modřínová', gender: 'female', birthDate: '1874-05-20', ...wife },
        ...children('t'),
    ], [{ id: 'tu', a: 'th', b: 'tw', children: ['tc1', 'tc2', 'tc3'] }]);
}

/**
 * The import: the same family, the wife under her birth surname, and the
 * husband's unmarried sister Marie Modřínová, whom the tree does not have —
 * by name and years she looks more like the tree's wife than the wife does.
 */
function file(wife: Partial<Spec> = {}, opts: { sister?: boolean; childrenOfWife?: boolean } = {}): StromData {
    const { sister = true, childrenOfWife = true } = opts;
    const people: Spec[] = [
        ...(sister ? [{ id: 'is', firstName: 'Marie', lastName: 'Modřínová', gender: 'female', birthDate: '1874-11-02' } as Spec] : []),
        { id: 'ih', firstName: 'Ondřej', lastName: 'Modřín', gender: 'male', birthDate: '1871-04-02' },
        { id: 'iw', firstName: 'Marie', lastName: 'Šeříková', gender: 'female', ...wife },
        ...children('i'),
    ];
    if (childrenOfWife) return data(people, [{ id: 'iu', a: 'ih', b: 'iw', children: ['ic1', 'ic2', 'ic3'] }]);
    const d = data(people, [{ id: 'iu', a: 'ih', b: 'iw', children: [] }, { id: 'iu0', a: 'ih', b: 'ih', children: [] }]);
    // The children with the husband alone (no second parent in the file).
    delete (d.partnerships as Record<string, unknown>).iu0;
    d.persons[toPersonId('ih')].partnerships = d.persons[toPersonId('ih')].partnerships.filter(u => u !== 'iu0');
    for (const c of ['ic1', 'ic2', 'ic3'].map(toPersonId)) {
        d.persons[c].parentIds = [toPersonId('ih')];
        d.persons[toPersonId('ih')].childIds.push(c);
    }
    return d;
}

const pairOf = (matches: ReturnType<typeof findMatches>, incoming: string) =>
    matches.find(m => m.incomingId === toPersonId(incoming));

describe('the partner of a joined person through shared children (134 K10.6)', () => {
    it('offers the wife under her birth surname as Maybe the same, with the reason', () => {
        const m = pairOf(findMatches(tree(), file()), 'iw');
        expect(m?.existingId).toBe(toPersonId('tw'));
        expect(m?.reasons[0]).toBe('partner_shared_children');
        expect(m!.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(m!.score).toBeGreaterThanOrEqual(55);
    });

    it('takes the tree\'s wife back from a weaker pair of another person (the husband\'s sister of her given name)', () => {
        const matches = findMatches(tree(), file());
        expect(pairOf(matches, 'is')?.existingId).not.toBe(toPersonId('tw'));
        // Husband and children stay joined.
        for (const id of ['ih', 'ic1', 'ic2', 'ic3']) expect(pairOf(matches, id)!.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
    });

    it('pairs one given name of several and a given name alone', () => {
        const m = pairOf(findMatches(tree(), file({ firstName: 'Anna' })), 'iw');
        expect(m?.existingId).toBe(toPersonId('tw'));
        expect(m?.reasons).toContain('partner_shared_children');
    });

    it('pairs an initial only when the surname after marriage explains the other surname', () => {
        expect(pairOf(findMatches(tree(), file({ firstName: 'M.' })), 'iw')?.existingId).toBe(toPersonId('tw'));
        // The tree's wife under a surname that is neither hers nor her husband's: an initial is too little.
        const other = pairOf(findMatches(tree({ lastName: 'Olšanová' }), file({ firstName: 'M.' })), 'iw');
        expect(other?.reasons ?? []).not.toContain('partner_shared_children');
    });

    it('offers nothing for another given name', () => {
        expect(pairOf(findMatches(tree(), file({ firstName: 'Eliška' })), 'iw')).toBeUndefined();
    });

    it('offers nothing across sexes', () => {
        const m = pairOf(findMatches(tree({ gender: 'male' }), file()), 'iw');
        expect(m).toBeUndefined();
    });

    it('a partner without shared children keeps today\'s pairing', () => {
        const m = pairOf(findMatches(tree(), file({}, { sister: false, childrenOfWife: false })), 'iw');
        expect(m?.reasons ?? []).not.toContain('partner_shared_children');
    });

    it('a husband confirmed by hand brings his wife in as Maybe the same', () => {
        // The husband without his birth date only reaches Maybe the same, so the comparison does not count him as joined.
        const state = createMergeState(tree({}, { birthDate: undefined }), file({}, { sister: true }));
        const husband = state.matches.find(m => m.incomingId === toPersonId('ih'))!;
        expect(husband.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(state.matches.find(m => m.incomingId === toPersonId('iw'))?.reasons ?? []).not.toContain('partner_shared_children');
        state.decisions.set(toPersonId('ih'), { type: 'confirm' });
        reanalyzeMatches(state);
        const wife = state.matches.find(m => m.incomingId === toPersonId('iw'));
        expect(wife?.existingId).toBe(toPersonId('tw'));
        expect(wife?.reasons[0]).toBe('partner_shared_children');
        expect(state.unmatchedIncoming).not.toContain(toPersonId('iw') as PersonId);
    });

    it('a wife told "not the same" stays new after a recalculation', () => {
        const state = createMergeState(tree(), file());
        state.decisions.set(toPersonId('iw'), { type: 'reject' });
        reanalyzeMatches(state);
        expect(state.matches.find(m => m.incomingId === toPersonId('iw'))).toBeUndefined();
        expect(state.unmatchedIncoming).toContain(toPersonId('iw'));
    });
});
