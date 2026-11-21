/**
 * The window's selection of people (spec 098 §0.1): its people found the way
 * the lists find theirs, gone when its list, line or person is, named with
 * the prefix of its kind, as a list's rule, as a string, cached per change of
 * the data. Fictional trees only: every name below is invented.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildLineages, rodOf, realRodMembers, realRodSpouses, rodLabels, RodId } from '../lineage.js';
import { rulePersonIds } from '../person-lists.js';
import { setLanguage } from '../strings.js';
import type { Person, Partnership, PartnershipId, PersonId, PersonList, StromData } from '../types.js';
import {
    SelectionRef, decodeSelectionRef, encodeSelectionRef, sameSelectionRef, sanitizeSelectionRef, selectionAsRule, selectionGone,
    selectionLabel, selectionLabelText, selectionPersonIds,
} from '../view-selection.js';

type Sex = 'male' | 'female';
interface Spec { first: string; last: string; sex: Sex; born?: string; parents?: string[]; placeholder?: boolean }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: s.placeholder === true,
            partnerships: [], parentIds: (s.parents ?? []) as PersonId[], childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as StromData;
}

// The Měsíček line: Sudimír's children Zbyhněv and Rozmarýna; Rozmarýna married Bohuchval Ostružiník.
const mesicek = (): StromData => {
    const d = tree({
        sudimir: { first: 'Sudimír', last: 'Měsíček', sex: 'male', born: '1800' },
        mlhoslava: { first: 'Mlhoslava', last: 'Kmínová', sex: 'female', born: '1802' },
        zbyhnev: { first: 'Zbyhněv', last: 'Měsíček', sex: 'male', born: '1830', parents: ['sudimir', 'mlhoslava'] },
        rozmaryna: { first: 'Rozmarýna', last: 'Měsíčková', sex: 'female', born: '1832', parents: ['sudimir', 'mlhoslava'] },
        kopretinka: { first: 'Kopretinka', last: 'Hvozdíková', sex: 'female', born: '1833' },
        bohuchval: { first: 'Bohuchval', last: 'Ostružiník', sex: 'male', born: '1828' },
        vlkodav: { first: 'Vlkodav', last: 'Měsíček', sex: 'male', born: '1860', parents: ['zbyhnev', 'kopretinka'] },
        drahoslav: { first: 'Drahoslav', last: 'Ostružiník', sex: 'male', born: '1858', parents: ['bohuchval', 'rozmaryna'] },
        ghost: { first: '', last: '', sex: 'male', placeholder: true, parents: ['drahoslav'] },
    }, [
        ['u1', 'sudimir', 'mlhoslava', ['zbyhnev', 'rozmaryna']],
        ['u2', 'zbyhnev', 'kopretinka', ['vlkodav']],
        ['u3', 'bohuchval', 'rozmaryna', ['drahoslav']],
    ]);
    d.researchDirections = { complete: true, lines: [{ id: 'G1', name: 'Ostružiník line' }, { id: 'G2', name: 'Other' }], branches: [] };
    for (const [pid, refn, line] of [['drahoslav', 'P1', 'G1'], ['rozmaryna', 'P2', 'G1'], ['vlkodav', 'P3', 'G2']] as const) {
        d.persons[pid as PersonId].refn = refn;
        d.persons[pid as PersonId].research = { places: [{ role: 'line', line }] } as Person['research'];
    }
    const list: PersonList = {
        id: 'l1', name: 'To find', dynamic: false, personIds: ['vlkodav', 'gone-person', 'ghost', 'sudimir'] as PersonId[],
        sort: 'manual', updated: '2026-11-01T10:00:00Z',
    };
    d.personLists = [list];
    return d;
};

const P = (id: string): PersonId => id as PersonId;
const ids = (s: ReadonlySet<PersonId> | null): string[] | null => (s ? [...s].sort() : null);

afterEach(() => setLanguage('en'));

describe('the people of a selection (§0.1): the lists\' way, real people only', () => {
    const data = mesicek();
    const index = buildLineages(data);
    const rod = rodOf(index, P('sudimir'))!;

    it('a family line: its real members (as the highlight), the spouses who married in not', () => {
        const got = selectionPersonIds(data, index, { kind: 'rod', rodId: rod });
        expect(ids(got)).toEqual([...realRodMembers(index, rod)].sort());
        expect(got!.has(P('zbyhnev'))).toBe(true);
        for (const spouse of realRodSpouses(index, rod)) expect(got!.has(spouse)).toBe(false);
    });

    it('ancestors and descendants: the automatic list\'s rule, all or n generations', () => {
        for (const ref of [
            { kind: 'ancestors', personId: P('drahoslav') },
            { kind: 'ancestors', personId: P('drahoslav'), generations: 1 },
            { kind: 'descendants', personId: P('sudimir') },
            { kind: 'descendants', personId: P('sudimir'), generations: 1 },
        ] as SelectionRef[]) {
            const rule = selectionAsRule(ref)!;
            expect(ids(selectionPersonIds(data, index, ref))).toEqual([...rulePersonIds(index, rule)].sort());
        }
        const all = selectionPersonIds(data, index, { kind: 'ancestors', personId: P('drahoslav') })!;
        for (const a of ['rozmaryna', 'bohuchval', 'sudimir', 'mlhoslava']) expect(all.has(P(a))).toBe(true);
        expect(all.has(P('zbyhnev'))).toBe(false);
        const parents = selectionPersonIds(data, index, { kind: 'ancestors', personId: P('drahoslav'), generations: 1 })!;
        expect(parents.has(P('sudimir'))).toBe(false);
        expect(parents.has(P('rozmaryna'))).toBe(true);
        const down = selectionPersonIds(data, index, { kind: 'descendants', personId: P('sudimir') })!;
        for (const a of ['zbyhnev', 'rozmaryna', 'vlkodav', 'drahoslav']) expect(down.has(P(a))).toBe(true);
        // The placeholder under Drahoslav is never in it.
        expect(down.has(P('ghost'))).toBe(false);
        const children = selectionPersonIds(data, index, { kind: 'descendants', personId: P('sudimir'), generations: 1 })!;
        expect(children.has(P('vlkodav'))).toBe(false);
    });

    it('a research line: the people the Table\'s line chip shows', () => {
        expect(ids(selectionPersonIds(data, index, { kind: 'line', directionId: 'G1' }))).toEqual(['drahoslav', 'rozmaryna']);
    });

    it('a list: its people, those no longer in the tree and placeholders left out', () => {
        expect(ids(selectionPersonIds(data, index, { kind: 'list', listId: 'l1' }))).toEqual(['sudimir', 'vlkodav']);
        // The ready-made "Added in the last 30 days" is a list too.
        expect(selectionPersonIds(data, index, { kind: 'list', listId: 'added30' })).not.toBeNull();
    });
});

describe('a gone selection (§7): why', () => {
    it('each kind gone, null while it exists', () => {
        const data = mesicek();
        const index = buildLineages(data);
        const rod = rodOf(index, P('sudimir'))!;
        const refs: [SelectionRef, string][] = [
            [{ kind: 'rod', rodId: rod }, 'rod'],
            [{ kind: 'ancestors', personId: P('drahoslav') }, 'person'],
            [{ kind: 'descendants', personId: P('sudimir') }, 'person'],
            [{ kind: 'line', directionId: 'G1' }, 'line'],
            [{ kind: 'list', listId: 'l1' }, 'list'],
        ];
        for (const [ref] of refs) expect(selectionGone(data, index, ref)).toBeNull();
        expect(selectionGone(data, index, { kind: 'rod', rodId: 'nope' as RodId })).toBe('rod');
        expect(selectionGone(data, index, { kind: 'ancestors', personId: P('nobody') })).toBe('person');
        expect(selectionGone(data, index, { kind: 'line', directionId: 'G9' })).toBe('line');
        expect(selectionGone(data, index, { kind: 'list', listId: 'l9' })).toBe('list');

        // The list deleted, the line removed, the people deleted (a new tree object, as after an edit).
        const after = mesicek();
        after.personLists = [];
        after.researchDirections = { complete: true, lines: [{ id: 'G2', name: 'Other' }], branches: [] };
        for (const id of ['sudimir', 'zbyhnev', 'vlkodav', 'rozmaryna', 'drahoslav']) delete after.persons[P(id)];
        const ix2 = buildLineages(after);
        for (const [ref, why] of refs) {
            expect(selectionGone(after, ix2, ref)).toBe(why);
            expect(selectionPersonIds(after, ix2, ref)).toBeNull();
        }
    });
});

describe('the name of a selection (1.2)', () => {
    const data = mesicek();
    const index = buildLineages(data);
    const rod = rodOf(index, P('sudimir'))!;
    const labels = rodLabels(index);
    const refs: SelectionRef[] = [
        { kind: 'rod', rodId: rod },
        { kind: 'ancestors', personId: P('drahoslav') },
        { kind: 'descendants', personId: P('sudimir'), generations: 2 },
        { kind: 'line', directionId: 'G1' },
        { kind: 'list', listId: 'l1' },
    ];
    const texts = () => refs.map(r => selectionLabelText(selectionLabel(r, data, labels)));

    it('the prefix of its kind and the name, in all four languages', () => {
        setLanguage('en');
        expect(texts()).toEqual(['Line Měsíček', 'Ancestors: Drahoslav Ostružiník', 'Descendants: Sudimír Měsíček', 'Research line: Ostružiník line', 'List: To find']);
        setLanguage('cs');
        expect(texts()).toEqual(['Rod Měsíček', 'Předci: Drahoslav Ostružiník', 'Potomci: Sudimír Měsíček', 'Linie: Ostružiník line', 'Seznam: To find']);
        setLanguage('de');
        expect(texts()).toEqual(['Stammlinie Měsíček', 'Vorfahren: Drahoslav Ostružiník', 'Nachkommen: Sudimír Měsíček', 'Linie: Ostružiník line', 'Liste: To find']);
        setLanguage('pl');
        expect(texts()).toEqual(['Ród Měsíček', 'Przodkowie: Drahoslav Ostružiník', 'Potomkowie: Sudimír Měsíček', 'Linia: Ostružiník line', 'Lista: To find']);
    });

    it('the ready-made list by its period\'s name', () => {
        setLanguage('cs');
        expect(selectionLabel({ kind: 'list', listId: 'added30' }, data, labels)).toEqual({ prefix: 'Seznam:', name: 'Přidáno za posledních 30 dní' });
    });
});

describe('a selection as a list\'s rule (§2, §5)', () => {
    it('a line, ancestors, descendants and a research line; a list none', () => {
        expect(selectionAsRule({ kind: 'rod', rodId: 'r1' as RodId })).toEqual({ kind: 'rods', rodIds: ['r1'] });
        expect(selectionAsRule({ kind: 'ancestors', personId: P('a'), generations: 3 })).toEqual({ kind: 'ancestors', personId: 'a', generations: 3 });
        expect(selectionAsRule({ kind: 'descendants', personId: P('a') })).toEqual({ kind: 'descendants', personId: 'a' });
        expect(selectionAsRule({ kind: 'line', directionId: 'G1' })).toEqual({ kind: 'line', directionId: 'G1' });
        expect(selectionAsRule({ kind: 'list', listId: 'l1' })).toBeNull();
    });
});

describe('a selection as a string (data-sel) and from storage', () => {
    it('round trip of every kind, odd ids too; anything else null', () => {
        const refs: SelectionRef[] = [
            { kind: 'rod', rodId: 'rod:a b' as RodId },
            { kind: 'ancestors', personId: P('p_1') },
            { kind: 'ancestors', personId: P('p_1'), generations: 4 },
            { kind: 'descendants', personId: P('p:2'), generations: 1 },
            { kind: 'line', directionId: 'G1' },
            { kind: 'list', listId: 'added30' },
        ];
        for (const ref of refs) {
            expect(decodeSelectionRef(encodeSelectionRef(ref))).toEqual(ref);
            expect(sameSelectionRef(decodeSelectionRef(encodeSelectionRef(ref)), ref)).toBe(true);
        }
        expect(encodeSelectionRef({ kind: 'ancestors', personId: P('x'), generations: 0 })).toBe('anc:x');
        for (const bad of ['', 'tree', 'rod:', 'anc:x:0', 'anc:x:1.5', 'anc:x:2:3', 'rod:a:b', 'who:x', null, undefined]) {
            expect(decodeSelectionRef(bad)).toBeNull();
        }
        expect(sameSelectionRef(null, null)).toBe(true);
        expect(sameSelectionRef(refs[1], refs[2])).toBe(false);
    });

    it('a stored ref checked', () => {
        expect(sanitizeSelectionRef({ kind: 'rod', rodId: 'r1' })).toEqual({ kind: 'rod', rodId: 'r1' });
        expect(sanitizeSelectionRef({ kind: 'ancestors', personId: 'p', generations: -2 })).toEqual({ kind: 'ancestors', personId: 'p' });
        for (const bad of [null, 'rod', { kind: 'rod' }, { kind: 'list', listId: '' }, { kind: 'tree' }]) expect(sanitizeSelectionRef(bad)).toBeNull();
    });
});

describe('the cache (§0.1, K3.2)', () => {
    it('one result per index and selection; a change of the data (a new index) counts again', () => {
        const data = mesicek();
        const index = buildLineages(data);
        const ref: SelectionRef = { kind: 'list', listId: 'l1' };
        const first = selectionPersonIds(data, index, ref);
        expect(selectionPersonIds(data, index, ref)).toBe(first);
        expect(selectionPersonIds(data, index, { kind: 'list', listId: 'l1' })).toBe(first);
        // A person added to the list: the next data revision has a new index.
        data.personLists![0] = { ...data.personLists![0], personIds: [...data.personLists![0].personIds!, P('zbyhnev')] };
        const index2 = buildLineages(data);
        const second = selectionPersonIds(data, index2, ref);
        expect(second).not.toBe(first);
        expect(ids(second)).toEqual(['sudimir', 'vlkodav', 'zbyhnev']);
    });
});
