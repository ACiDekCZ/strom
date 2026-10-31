/**
 * Lineages ("rody", spec 028 P1) and selections for outputs. Fictional trees
 * only: every name below is invented.
 */

import { describe, it, expect } from 'vitest';
import {
    buildLineages, rods, rodOf, rodMembers, rodSpouses, marriedInto, branch, selection,
    SMALL_ROD_MAX_MEMBERS, RodId, LineageIndex,
} from '../lineage.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';

// ---- Tiny synthetic-tree builder ----
type Sex = 'male' | 'female' | 'unknown';
interface Spec { first: string; last?: string; sex: Sex; born?: string; parents?: string[]; placeholder?: boolean; extra?: Partial<Person> }

/** Build a tree from people and unions; parent/child/partner links are derived. */
function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][] = [], extra: Partial<StromData> = {}): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last ?? '', gender: s.sex,
            isPlaceholder: !!s.placeholder, partnerships: [], parentIds: (s.parents ?? []) as PersonId[],
            childIds: [], birthDate: s.born, ...s.extra,
        } as Person;
    }
    for (const p of Object.values(persons)) {
        for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    }
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = {
            id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
            childIds: kids as PersonId[], status: 'married',
        };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships, ...extra } as StromData;
}
const P = (id: string): PersonId => id as PersonId;
const U = (id: string): PartnershipId => id as PartnershipId;
const rodIdOf = (idx: LineageIndex, id: string): RodId => {
    const r = rodOf(idx, P(id));
    expect(r).not.toBeNull();
    return r!;
};

// A three-generation Brumlák lineage with in-laws of every kind.
const brumlak = tree({
    hostivit: { first: 'Hostivít', last: 'Brumlák', sex: 'male', born: '1800' },
    dobromila: { first: 'Dobromila', last: 'Čmeldová', sex: 'female', born: '1803', parents: ['svatoboj', 'zdislava'] },
    svatoboj: { first: 'Svatoboj', last: 'Čmelda', sex: 'male', born: '1770' },
    zdislava: { first: 'Zdislava', last: 'Kopýtková', sex: 'female', born: '1772' },        // wife, no parents, maiden name
    borivoj: { first: 'Bořivoj', last: 'Brumlák', sex: 'male', born: '1830', parents: ['hostivit', 'dobromila'] },
    radoslava: { first: 'Radoslava', last: 'Brumláková', sex: 'female', born: '1832', parents: ['hostivit', 'dobromila'] },
    lubomira: { first: 'Lubomíra', last: 'Brumláková', sex: 'female', born: '1834' },       // filed under her married name
    spytihnev: { first: 'Spytihněv', last: 'Trnkavec', sex: 'male', born: '1828' },
    bozetech: { first: 'Božetěch', last: 'Brumlák', sex: 'male', born: '1860', parents: ['borivoj', 'lubomira'] },
    bolemir: { first: 'Bolemír', last: 'Trnkavec', sex: 'male', born: '1858', parents: ['spytihnev', 'radoslava'] },
}, [
    ['u1', 'hostivit', 'dobromila', ['borivoj', 'radoslava']],
    ['u0', 'svatoboj', 'zdislava', ['dobromila']],
    ['u2', 'borivoj', 'lubomira', ['bozetech']],
    ['u3', 'spytihnev', 'radoslava', ['bolemir']],
]);

describe('lineage: members by birth, spouses by marriage (Q1, Q2)', () => {
    const idx = buildLineages(brumlak);
    const rod = rodIdOf(idx, 'hostivit');

    it('the male line with its daughters is one lineage, keyed by its founder', () => {
        for (const id of ['borivoj', 'radoslava', 'bozetech']) expect(rodOf(idx, P(id))).toBe(rod);
        const r = idx.rods.get(rod)!;
        expect(r.founderId).toBe(P('hostivit'));
        expect(r.surname).toBe('Brumlák');
        // Line order: founder, then each child's line in birth order.
        expect(rodMembers(idx, rod)).toEqual(['hostivit', 'borivoj', 'bozetech', 'radoslava'].map(P));
        expect(r.forms).toEqual(['Brumlák', 'Brumláková']);
        expect(r.otherForms).toEqual([]);
        expect(r.generations).toBe(3);
        expect(r.period).toEqual({ from: 1800, to: 1860 });
    });

    it('a wife who married in is a spouse with a link to her birth lineage, never a member', () => {
        const spouses = rodSpouses(idx, rod);
        expect(spouses.map(s => s.personId)).toEqual([P('dobromila'), P('lubomira')]);
        const dob = spouses[0];
        expect(dob).toMatchObject({ spouseOfId: P('hostivit'), partnershipId: U('u1') });
        // With parents: she belongs to her father's lineage.
        expect(dob.birthRodId).toBe(rodOf(idx, P('svatoboj')));
        expect(rodMembers(idx, dob.birthRodId!)).toContain(P('dobromila'));
        // Filed under her husband's surname, no parents: her birth lineage is
        // unknown — the married name is not a form of anything.
        expect(spouses[1].birthRodId).toBeNull();
        expect(rodOf(idx, P('lubomira'))).toBeNull();
        expect(rodMembers(idx, rod)).not.toContain(P('dobromila'));
        expect(idx.rods.get(rod)!.realSpouseCount).toBe(2);
    });

    it('a wife without parents but with her maiden name founds a solitary lineage of her own', () => {
        const kop = rodIdOf(idx, 'zdislava');
        const r = idx.rods.get(kop)!;
        expect(r.solitary).toBe(true);
        expect(r.small).toBe(true);
        expect(rodSpouses(idx, rodIdOf(idx, 'svatoboj')).map(s => s.birthRodId)).toEqual([kop]);
    });

    it('a daughter stays in her father\'s lineage and gets a link into her husband\'s', () => {
        expect(marriedInto(idx, P('radoslava'))).toEqual([
            { partnershipId: U('u3'), spouseId: P('spytihnev'), rodId: rodOf(idx, P('spytihnev')) },
        ]);
        // Her son carries his father's name: Trnkavec lineage, not Brumlák.
        expect(rodOf(idx, P('bolemir'))).toBe(rodOf(idx, P('spytihnev')));
        // The husband is not in the daughter's lineage; the union is his lineage's family.
        expect(rodSpouses(idx, rod).map(s => s.personId)).not.toContain(P('spytihnev'));
        expect(idx.rods.get(rod)!.familyIds).toEqual([U('u1'), U('u2')]);
        expect(idx.rods.get(rodOf(idx, P('spytihnev'))!)!.familyIds).toEqual([U('u3')]);
        // A man marrying in is not "married into" anything.
        expect(marriedInto(idx, P('borivoj'))).toEqual([]);
    });
});

describe('lineage: children of an unmarried mother', () => {
    const t = tree({
        bolemir: { first: 'Bolemír', last: 'Šnytl', sex: 'male', born: '1790' },
        dobroslava: { first: 'Dobroslava', last: 'Šnytlová', sex: 'female', born: '1820', parents: ['bolemir'] },
        bozetech: { first: 'Božetěch', last: 'Šnytl', sex: 'male', born: '1845', parents: ['dobroslava'] },
        // A recorded father, but the child carries the mother's surname.
        kudlibal: { first: 'Spytihněv', last: 'Kudlibal', sex: 'male', born: '1818' },
        hostivit: { first: 'Hostivít', last: 'Šnytl', sex: 'male', born: '1847', parents: ['kudlibal', 'dobroslava'] },
        // No father and a surname that is not the mother's: an undocumented father's name.
        svatoboj: { first: 'Svatoboj', last: 'Drndal', sex: 'male', born: '1850', parents: ['dobroslava'] },
    }, [['u1', 'kudlibal', 'dobroslava', ['hostivit']]]);
    const idx = buildLineages(t);
    const snytl = rodIdOf(idx, 'bolemir');

    it('a child with the mother\'s surname belongs to her birth lineage (her father\'s line)', () => {
        expect(rodOf(idx, P('dobroslava'))).toBe(snytl);
        expect(rodOf(idx, P('bozetech'))).toBe(snytl);
        expect(idx.lineParent.get(P('bozetech'))).toBe(P('dobroslava'));
    });

    it('…even when the father is recorded, as long as the child does not carry his name', () => {
        expect(rodOf(idx, P('hostivit'))).toBe(snytl);
        expect(rodOf(idx, P('kudlibal'))).not.toBe(snytl);
        // The union gave the Šnytl lineage a child, so it is one of its families;
        // the father shows as a spouse there, with his own lineage linked.
        expect(idx.rods.get(snytl)!.familyIds).toContain(U('u1'));
        expect(rodSpouses(idx, snytl)).toEqual([
            { personId: P('kudlibal'), spouseOfId: P('dobroslava'), partnershipId: U('u1'), birthRodId: rodOf(idx, P('kudlibal')) },
        ]);
    });

    it('a child with neither parent\'s surname and no father founds a lineage of its own', () => {
        const drndal = rodIdOf(idx, 'svatoboj');
        expect(drndal).not.toBe(snytl);
        expect(idx.rods.get(drndal)!.founderId).toBe(P('svatoboj'));
    });
});

describe('lineage: placeholders and nameless people neither split nor found', () => {
    it('an unknown son between two bearers keeps one lineage', () => {
        const t = tree({
            a: { first: 'Hostivít', last: 'Hrabálek', sex: 'male', born: '1750' },
            ph: { first: '', last: 'Hrabálek', sex: 'male', placeholder: true, parents: ['a'] },
            c: { first: 'Bořivoj', last: 'Hrabálek', sex: 'male', born: '1810', parents: ['ph'] },
            nameless: { first: 'Zdislava', sex: 'female', born: '1812', parents: ['ph'] },
        });
        const idx = buildLineages(t);
        const rod = rodIdOf(idx, 'a');
        expect(['ph', 'c', 'nameless'].map(id => rodOf(idx, P(id)))).toEqual([rod, rod, rod]);
        expect(rods(idx)).toHaveLength(1);
        expect(idx.rods.get(rod)!.realMemberCount).toBe(3);
    });

    it('an unknown father bridges his named sons; the oldest of them is the founder', () => {
        const t = tree({
            ph: { first: '', sex: 'male', placeholder: true },
            s1: { first: 'Bolemír', last: 'Hrabálek', sex: 'male', born: '1812', parents: ['ph'] },
            s2: { first: 'Božetěch', last: 'Hrabálek', sex: 'male', born: '1810', parents: ['ph'] },
        });
        const idx = buildLineages(t);
        expect(rods(idx)).toHaveLength(1);
        const r = rods(idx)[0];
        expect(r.rootId).toBe(P('ph'));
        expect(r.founderId).toBe(P('s2'));
        expect(rodOf(idx, P('s1'))).toBe(r.id);
    });

    it('an unknown spouse has no lineage and founds none', () => {
        const t = tree({
            a: { first: 'Hostivít', last: 'Hrabálek', sex: 'male', born: '1800' },
            w: { first: '', last: 'Hrabálková', sex: 'female', placeholder: true },
            nameless: { first: 'Radoslava', sex: 'female', born: '1801' },
        }, [['u1', 'a', 'w', []], ['u2', 'a', 'nameless', []]]);
        const idx = buildLineages(t);
        expect(rodOf(idx, P('w'))).toBeNull();
        expect(rodOf(idx, P('nameless'))).toBeNull();
        expect(rods(idx)).toHaveLength(1);
        expect(rodSpouses(idx, rodIdOf(idx, 'a')).map(s => [s.personId, s.birthRodId])).toEqual([['w', null], ['nameless', null]]);
        expect(idx.rods.get(rodIdOf(idx, 'a'))!.realSpouseCount).toBe(1);
    });
});

describe('lineage: surname forms', () => {
    const people: Record<string, Spec> = {
        f: { first: 'Hostivít', last: 'Zvonílek', sex: 'male', born: '1800' },
        s: { first: 'Bořivoj', last: 'Zvonýlek', sex: 'male', born: '1830', parents: ['f'] },
        d: { first: 'Radoslava', last: 'Zvonýlková', sex: 'female', born: '1832', parents: ['f'] },
    };

    it('a grouped spelling is a confirmed form of the lineage', () => {
        const idx = buildLineages(tree(people, [], { surnameVariants: [['Zvonílek', 'Zvonýlek']] }));
        expect(rods(idx)).toHaveLength(1);
        const r = rods(idx)[0];
        expect(r.forms.sort()).toEqual(['Zvonílek', 'Zvonýlek', 'Zvonýlková']);
        expect(r.otherForms).toEqual([]);
    });

    it('an ungrouped spelling stays in the father\'s lineage but is only a candidate form', () => {
        const idx = buildLineages(tree(people));
        expect(rods(idx)).toHaveLength(1);
        const r = rods(idx)[0];
        expect(r.forms).toEqual(['Zvonílek']);
        expect(r.otherForms).toEqual(['Zvonýlek', 'Zvonýlková']);
    });

    it('a woman\'s married surname is never a form of her birth lineage', () => {
        const t = tree({
            f: { first: 'Hostivít', last: 'Bobrník', sex: 'male', born: '1800' },
            d: { first: 'Radoslava', last: 'Kudlibalová', sex: 'female', born: '1830', parents: ['f'] },   // filed under her husband's name
            h: { first: 'Bolemír', last: 'Kudlibal', sex: 'male', born: '1828' },
        }, [['u1', 'h', 'd', []]]);
        const idx = buildLineages(t);
        const rod = rodIdOf(idx, 'f');
        expect(rodOf(idx, P('d'))).toBe(rod);       // still her father's daughter
        expect(idx.rods.get(rod)!.forms).toEqual(['Bobrník']);
        expect(idx.rods.get(rod)!.otherForms).toEqual([]);
        expect(marriedInto(idx, P('d')).map(m => m.rodId)).toEqual([rodOf(idx, P('h'))]);
    });
});

describe('lineage: several marriages', () => {
    const t = tree({
        m: { first: 'Hostivít', last: 'Bobrník', sex: 'male', born: '1800' },
        w1: { first: 'Zdislava', last: 'Mechúrková', sex: 'female', born: '1802' },
        w2: { first: 'Dobromila', last: 'Šnytlová', sex: 'female', born: '1810' },
        c1: { first: 'Bořivoj', last: 'Bobrník', sex: 'male', born: '1825', parents: ['m', 'w1'] },
        c2: { first: 'Lubomíra', last: 'Bobrníková', sex: 'female', born: '1835', parents: ['m', 'w2'] },
        h1: { first: 'Spytihněv', last: 'Ťapka', sex: 'male', born: '1830' },
        h2: { first: 'Božetěch', last: 'Kudlibal', sex: 'male', born: '1828' },
    }, [
        ['u2', 'm', 'w2', ['c2']],
        ['u1', 'm', 'w1', ['c1']],
        ['u3', 'h1', 'c2', []],
        ['u4', 'h2', 'c2', []],
    ]);
    const idx = buildLineages(t);
    const rod = rodIdOf(idx, 'm');

    it('a man\'s every wife is a spouse and every union a family; all children are members', () => {
        expect(rodMembers(idx, rod)).toEqual(['m', 'c1', 'c2'].map(P));
        expect(rodSpouses(idx, rod).map(s => s.personId).sort()).toEqual(['w1', 'w2']);
        expect(idx.rods.get(rod)!.familyIds.sort()).toEqual(['u1', 'u2']);
    });

    it('a twice-married daughter is linked into both husbands\' lineages', () => {
        expect(marriedInto(idx, P('c2')).map(m => m.spouseId).sort()).toEqual(['h1', 'h2']);
    });
});

describe('lineage: two lineages of one surname, and small lineages', () => {
    const t = tree({
        a: { first: 'Hostivít', last: 'Mechúrek', sex: 'male', born: '1700' },
        a1: { first: 'Bořivoj', last: 'Mechúrek', sex: 'male', born: '1730', parents: ['a'] },
        a2: { first: 'Bolemír', last: 'Mechúrek', sex: 'male', born: '1732', parents: ['a'] },
        a3: { first: 'Radoslava', last: 'Mechúrková', sex: 'female', born: '1734', parents: ['a'] },
        a4: { first: 'Spytihněv', last: 'Mechúrek', sex: 'male', born: '1760', parents: ['a1'] },
        b: { first: 'Svatoboj', last: 'Mechúrek', sex: 'male', born: '1800' },
        b1: { first: 'Zdislava', last: 'Mechúrková', sex: 'female', born: '1830', parents: ['b'] },
    });
    const idx = buildLineages(t);

    it('unconnected bearers of one surname are two lineages, each with its founder', () => {
        const ra = rodIdOf(idx, 'a1');
        const rb = rodIdOf(idx, 'b1');
        expect(ra).not.toBe(rb);
        expect(idx.rods.get(ra)!.surname).toBe(idx.rods.get(rb)!.surname);
        expect([idx.rods.get(ra)!.founderId, idx.rods.get(rb)!.founderId]).toEqual([P('a'), P('b')]);
    });

    it(`small = at most ${SMALL_ROD_MAX_MEMBERS} real members; largest first`, () => {
        const list = rods(idx);
        expect(list.map(r => r.realMemberCount)).toEqual([5, 2]);
        expect(list.map(r => r.small)).toEqual([false, true]);
        expect(list.map(r => r.solitary)).toEqual([false, false]);
    });
});

describe('lineage: parent links that do not carry it', () => {
    it('a stepfather does not pass his lineage; an adoptive one does when no other father is recorded', () => {
        const t = tree({
            step: { first: 'Hostivít', last: 'Ťapka', sex: 'male', born: '1800' },
            mom: { first: 'Dobromila', last: 'Kudlibalová', sex: 'female', born: '1805' },
            kid: { first: 'Bořivoj', last: 'Kudlibal', sex: 'male', born: '1830', parents: ['step', 'mom'],
                extra: { parentRelTypes: { step: 'step' } as Person['parentRelTypes'] } },
            adopter: { first: 'Bolemír', last: 'Drndal', sex: 'male', born: '1790' },
            adopted: { first: 'Božetěch', last: 'Drndal', sex: 'male', born: '1820', parents: ['adopter'],
                extra: { parentRelTypes: { adopter: 'adoptive' } as Person['parentRelTypes'] } },
        });
        const idx = buildLineages(t);
        expect(rodOf(idx, P('kid'))).toBe(rodOf(idx, P('mom')));
        expect(rodOf(idx, P('kid'))).not.toBe(rodOf(idx, P('step')));
        expect(rodOf(idx, P('adopted'))).toBe(rodOf(idx, P('adopter')));
    });

    it('a cycle in broken data ends instead of looping', () => {
        const t = tree({
            x: { first: 'Hostivít', last: 'Ťapka', sex: 'male', born: '1800', parents: ['y'] },
            y: { first: 'Bořivoj', last: 'Ťapka', sex: 'male', born: '1820', parents: ['x'] },
        });
        const idx = buildLineages(t);
        expect(rodOf(idx, P('x'))).toBe(rodOf(idx, P('y')));
        expect(rods(idx)).toHaveLength(1);
    });
});

describe('selection for outputs', () => {
    const idx = buildLineages(brumlak);

    it('tree: everybody and every union', () => {
        const s = selection(brumlak, { kind: 'tree' });
        expect(s.memberIds).toHaveLength(Object.keys(brumlak.persons).length);
        expect(s.spouseIds).toEqual([]);
        expect(s.familyIds.sort()).toEqual(['u0', 'u1', 'u2', 'u3']);
    });

    it('rods: members, then married-in spouses, with the lineage\'s families', () => {
        const rod = rodIdOf(idx, 'hostivit');
        const s = selection(idx, { kind: 'rods', rodIds: [rod] });
        expect(s.memberIds).toEqual(['hostivit', 'borivoj', 'bozetech', 'radoslava'].map(P));
        expect(s.spouseIds).toEqual([P('dobromila'), P('lubomira')]);
        expect(s.personIds).toEqual([...s.memberIds, ...s.spouseIds]);
        expect(s.familyIds).toEqual([U('u1'), U('u2')]);
        // Same answer from the bare data (the index is built on the way).
        expect(selection(brumlak, { kind: 'rods', rodIds: [rod] })).toEqual(s);
    });

    it('rods: a spouse who is a member of another chosen lineage is listed once, as a member', () => {
        const both = [rodIdOf(idx, 'hostivit'), rodIdOf(idx, 'svatoboj')];
        const s = selection(idx, { kind: 'rods', rodIds: both });
        expect(s.memberIds).toContain(P('dobromila'));
        expect(s.spouseIds).not.toContain(P('dobromila'));
        expect(new Set(s.personIds).size).toBe(s.personIds.length);
    });

    it('descendants = branch: through sons and daughters, with spouses and their unions', () => {
        const s = selection(brumlak, { kind: 'descendants', personId: P('hostivit') });
        expect(s).toEqual(branch(brumlak, P('hostivit')));
        expect(s.memberIds).toEqual(['hostivit', 'borivoj', 'bozetech', 'radoslava', 'bolemir'].map(P));
        expect(s.spouseIds).toEqual(['dobromila', 'lubomira', 'spytihnev'].map(P));
        expect(s.familyIds).toEqual(['u1', 'u2', 'u3'].map(U));
        expect(branch(brumlak, P('hostivit'), 1).memberIds).toEqual(['hostivit', 'borivoj', 'radoslava'].map(P));
    });

    it('ancestors: generation by generation, father first, with the unions that produced them', () => {
        const s = selection(brumlak, { kind: 'ancestors', personId: P('bozetech') });
        expect(s.memberIds).toEqual(['bozetech', 'borivoj', 'lubomira', 'hostivit', 'dobromila', 'svatoboj', 'zdislava'].map(P));
        expect(s.familyIds).toEqual(['u2', 'u1', 'u0'].map(U));
        expect(s.spouseIds).toEqual([]);
        expect(selection(brumlak, { kind: 'ancestors', personId: P('bozetech'), generations: 1 }).memberIds)
            .toEqual(['bozetech', 'borivoj', 'lubomira'].map(P));
    });

    it('an unknown person or lineage selects nothing', () => {
        expect(selection(idx, { kind: 'rods', rodIds: ['nope' as RodId] }).personIds).toEqual([]);
        expect(branch(brumlak, P('nope')).personIds).toEqual([]);
    });
});
