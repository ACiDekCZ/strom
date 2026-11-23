/**
 * Who is who by time (spec 134 K3.3, §4 tests): a candidate more than a
 * generation away, or one who died before a child was born, does not fit the
 * time; a candidate whose relatives are already joined comes first, one of
 * another period never first; recalculating after a decision never changes a
 * decided person (random invented trees, helpers/merge-trees.ts).
 */

import { describe, it, expect } from 'vitest';
import { candidatesFor, createMergeState, findMatches, reanalyzeMatches, recalcUndecided, timeConflict } from '../merge/matching.js';
import { MergeState } from '../merge/types.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

function tree(prefix: string): {
    data: StromData;
    person: (key: string, first: string, last: string, o?: Partial<Person>) => Person;
    couple: (a: Person, b: Person, kids?: Person[]) => void;
} {
    const data: StromData = { persons: {}, partnerships: {} };
    const person = (key: string, first: string, last: string, o: Partial<Person> = {}): Person => {
        const p: Person = {
            id: `${prefix}${key}` as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...o,
        };
        data.persons[p.id] = p;
        return p;
    };
    const couple = (a: Person, b: Person, kids: Person[] = []): void => {
        const u: Partnership = { id: `${prefix}u-${a.id}-${b.id}` as PartnershipId, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married' };
        data.partnerships[u.id] = u;
        a.partnerships.push(u.id);
        b.partnerships.push(u.id);
        for (const k of kids) {
            k.parentIds.push(a.id, b.id);
            a.childIds.push(k.id);
            b.childIds.push(k.id);
        }
    };
    return { data, person, couple };
}

/** A state over two trees with the given pairs decided "same" by hand. */
function stateOf(existing: StromData, incoming: StromData, joined: Array<[string, string]> = []): MergeState {
    const state = createMergeState(existing, incoming);
    for (const [inc, ex] of joined) state.decisions.set(inc as PersonId, { type: 'manual_match', targetId: ex as PersonId });
    return state;
}

/**
 * The tree: Velemír Modřín (1800) → his son Radomil (1830) → his son
 * Velemír (1860), three generations of one family in Lipová.
 */
function modřínTree(): { t: ReturnType<typeof tree>; grand: Person; father: Person; son: Person } {
    const t = tree('t');
    const grand = t.person('g', 'Velemír', 'Modřín', { birthDate: '1800' });
    const father = t.person('f', 'Radomil', 'Modřín', { birthDate: '1830' });
    const son = t.person('s', 'Velemír', 'Modřín', { birthDate: '1860' });
    t.couple(grand, t.person('gw', 'Ctislava', 'Modřínová', { gender: 'female', birthDate: '1802' }), [father]);
    t.couple(father, t.person('fw', 'Mstislava', 'Modřínová', { gender: 'female', birthDate: '1833' }), [son]);
    return { t, grand, father, son };
}

describe('timeConflict', () => {
    it('a candidate two generations from where the joined parent puts the person', () => {
        const { t, grand, son } = modřínTree();
        const s = tree('i');
        const inFather = s.person('f', 'Radomil', 'Modřín', { birthDate: '1830' });
        // No birth: only the joined parent says where the person belongs.
        const inSon = s.person('s', 'Velemír', 'Modřín');
        s.couple(inFather, s.person('fw', 'Mstislava', 'Modřínová', { gender: 'female' }), [inSon]);
        const state = stateOf(t.data, s.data, [['if', 'tf']]);
        // The grandfather is a generation above the joined father, the son one below as he should be.
        expect(timeConflict(grand, inSon, state)).toEqual({ reason: 'generation' });
        expect(timeConflict(son, inSon, state)).toBeNull();
    });

    it('births more than 50 years apart', () => {
        const { t, grand } = modřínTree();
        const s = tree('i');
        const young = s.person('x', 'Velemír', 'Modřín', { birthDate: '1862' });
        const near = s.person('y', 'Velemír', 'Modřín', { birthDate: '1840' });
        const state = stateOf(t.data, s.data);
        expect(timeConflict(grand, young, state)).toEqual({ reason: 'generation' });
        expect(timeConflict(grand, near, state)).toBeNull();
    });

    it('a death before a child of the other was born (a father up to a year before)', () => {
        const t = tree('t');
        const kvido = t.person('k', 'Hostivít', 'Jilm', { birthDate: '1820', deathDate: '1850' });
        const s = tree('i');
        const inHostivít = s.person('k', 'Hostivít', 'Jilm', { birthDate: '1820' });
        const late = s.person('c', 'Zbyhněv', 'Jilm', { birthDate: '1858' });
        s.couple(inHostivít, s.person('w', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1825' }), [late]);
        expect(timeConflict(kvido, inHostivít, stateOf(t.data, s.data))).toEqual({ reason: 'deathBeforeChild' });

        const s2 = tree('i');
        const inHostivít2 = s2.person('k', 'Hostivít', 'Jilm', { birthDate: '1820' });
        s2.couple(inHostivít2, s2.person('w', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1825' }),
            [s2.person('c', 'Zbyhněv', 'Jilm', { birthDate: '1851' })]);
        expect(timeConflict(kvido, inHostivít2, stateOf(t.data, s2.data))).toBeNull();

        // The other way round: the import's person died before a child of the tree's.
        const t3 = tree('t');
        const tHostivít = t3.person('k', 'Hostivít', 'Jilm', { birthDate: '1820' });
        t3.couple(tHostivít, t3.person('w', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1825' }),
            [t3.person('c', 'Zbyhněv', 'Jilm', { birthDate: '1860' })]);
        const s3 = tree('i');
        const dead = s3.person('k', 'Hostivít', 'Jilm', { birthDate: '1820', deathDate: '1849' });
        expect(timeConflict(tHostivít, dead, stateOf(t3.data, s3.data))).toEqual({ reason: 'deathBeforeChild' });
    });

    it('not when both records say the same: a parent who died before the child in each file is the same person, offered first', () => {
        // Both files carry the same slip (a death of 1660, a child of 1682): it says nothing against the pair.
        const t = tree('t');
        const tRadim = t.person('r', 'Radim', 'Modřín', { birthDate: '1657-08-08', deathDate: '1660-05-20', birthPlace: 'Křemenná' });
        t.couple(tRadim, t.person('w', 'Ludmila', 'Modřínová', { gender: 'female', birthDate: '1659' }),
            [t.person('c', 'Blanka', 'Modřínová', { gender: 'female', birthDate: '1682' })]);
        // A namesake of the same years with nothing more.
        t.person('n', 'Radim', 'Modřín', { birthDate: '1657' });
        const s = tree('i');
        const inRadim = s.person('r', 'Radim', 'Modřín', { birthDate: '1657-08-08', deathDate: '1660-05-20', birthPlace: 'Křemenná' });
        s.couple(inRadim, s.person('w', 'Ludmila', 'Modřínová', { gender: 'female', birthDate: '1659' }),
            [s.person('c', 'Blanka', 'Modřínová', { gender: 'female', birthDate: '1682' })]);
        const state = stateOf(t.data, s.data);
        expect(timeConflict(tRadim, inRadim, state)).toBeNull();
        expect(candidatesFor(inRadim.id, state)[0]).toMatchObject({ existingId: 'tr', timeConflict: null });
        // The same child joined in the tree under him: the tree says so itself.
        const s2 = tree('i');
        const inRadim2 = s2.person('r', 'Radim', 'Modřín', { birthDate: '1657-08-08', birthPlace: 'Křemenná' });
        s2.couple(inRadim2, s2.person('w', 'Ludmila', 'Modřínová', { gender: 'female', birthDate: '1659' }),
            [s2.person('c', 'Blanka', 'Modřínová', { gender: 'female', birthDate: '1682' })]);
        expect(timeConflict(tRadim, inRadim2, stateOf(t.data, s2.data, [['ic', 'tc']]))).toBeNull();
        expect(timeConflict(tRadim, inRadim2, stateOf(t.data, s2.data, [['ic', 'tn']]))).toEqual({ reason: 'deathBeforeChild' });
    });
});

describe('candidatesFor', () => {
    it('a candidate whose relatives are joined comes first, before a better score', () => {
        // Two Velemír Modříns in the tree: one (1860) the son of Radomil, the other
        // (1861, born in Dubová like the import's) with no family.
        const { t, son } = modřínTree();
        const other = t.person('o', 'Velemír', 'Modřín', { birthDate: '1861', birthPlace: 'Dubová' });
        const s = tree('i');
        const inFather = s.person('f', 'Radomil', 'Modřín', { birthDate: '1830' });
        const inSon = s.person('s', 'Velemír', 'Modřín', { birthDate: '1861', birthPlace: 'Dubová' });
        s.couple(inFather, s.person('fw', 'Mstislava', 'Modřínová', { gender: 'female', birthDate: '1833' }), [inSon]);
        const state = stateOf(t.data, s.data, [['if', 'tf'], ['ifw', 'tfw']]);
        const list = candidatesFor(inSon.id, state);
        const ids = list.map(c => c.existingId);
        expect(ids).toContain(other.id);
        expect(ids[0]).toBe(son.id);
        expect(list[0].relativesJoined).toBeGreaterThan(0);
        const otherInfo = list.find(c => c.existingId === other.id)!;
        expect(otherInfo.relativesJoined).toBe(0);
        expect(otherInfo.score).toBeGreaterThan(list[0].score);
    });

    it('a candidate of another period is never first, whatever its score', () => {
        // The tree's Hostivít Jilm died in 1850, the import's had a son in 1858; the
        // other Hostivít has a less sure birth but fits.
        const t = tree('t');
        const dead = t.person('k', 'Hostivít', 'Jilm', { birthDate: '1820-04-02', birthPlace: 'Lipová', deathDate: '1850' });
        const fits = t.person('k2', 'Hostivít', 'Jilm', { birthDate: '1821' });
        const s = tree('i');
        const inHostivít = s.person('k', 'Hostivít', 'Jilm', { birthDate: '1820-04-02', birthPlace: 'Lipová' });
        s.couple(inHostivít, s.person('w', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1825' }),
            [s.person('c', 'Zbyhněv', 'Jilm', { birthDate: '1858' })]);
        const list = candidatesFor(inHostivít.id, stateOf(t.data, s.data));
        const deadInfo = list.find(c => c.existingId === dead.id);
        expect(deadInfo?.timeConflict).toEqual({ reason: 'deathBeforeChild' });
        expect(list[0].existingId).toBe(fits.id);
        expect(deadInfo!.score).toBeGreaterThan(list[0].score);
    });
});

describe('recalcUndecided on random pairs of invented trees', () => {
    it('never changes a decided person', () => {
        const failures: string[] = [];
        for (let seed = 1; seed <= 100; seed++) {
            const rnd = mulberry32(seed);
            const existing = targetTree(rnd);
            const state = createMergeState(existing, sourceTree(existing, rnd));
            randomDecisions(state, rnd);
            const undecided = state.matches.filter(m => !state.decisions.has(m.incomingId));
            if (!undecided.length) continue;
            const pick = undecided[Math.floor(rnd() * undecided.length)];
            state.decisions.set(pick.incomingId, rnd() < 0.5 ? { type: 'confirm' } : { type: 'reject' });
            const decisions = JSON.stringify([...state.decisions]);
            const pairOf = (id: PersonId): string => {
                const m = state.matches.find(x => x.incomingId === id);
                return m ? `${m.existingId}|${m.score}|${m.confidence}` : '';
            };
            const before = new Map([...state.decisions.keys()].map(id => [id, pairOf(id)]));
            const { changed } = recalcUndecided(state, pick.incomingId);
            const errors: string[] = [];
            if (JSON.stringify([...state.decisions]) !== decisions) errors.push('decisions changed');
            for (const [id, was] of before) if (pairOf(id) !== was) errors.push(`${id}: ${was} → ${pairOf(id)}`);
            for (const id of changed) if (state.decisions.has(id)) errors.push(`decided ${id} reported changed`);
            const seen = new Set<PersonId>();
            for (const m of state.matches) {
                if (seen.has(m.incomingId)) errors.push(`${m.incomingId} offered twice`);
                seen.add(m.incomingId);
            }
            for (const id of state.unmatchedIncoming) if (seen.has(id)) errors.push(`${id} both matched and unmatched`);
            if (errors.length) failures.push(`seed ${seed}: ${errors.slice(0, 4).join('; ')}`);
        }
        expect(failures).toEqual([]);
    });

    it('gives the person just decided by hand the pair of the person picked', () => {
        let checked = 0;
        for (let seed = 1; seed <= 60 && checked < 10; seed++) {
            const rnd = mulberry32(seed);
            const existing = targetTree(rnd);
            const state = createMergeState(existing, sourceTree(existing, rnd));
            const pair = state.matches.find(m => !state.decisions.has(m.incomingId));
            const used = new Set(state.matches.map(m => m.existingId));
            const other = Object.values(existing.persons).find(p => !p.isPlaceholder && !used.has(p.id));
            if (!pair || !other) continue;
            state.decisions.set(pair.incomingId, { type: 'manual_match', targetId: other.id });
            recalcUndecided(state, pair.incomingId);
            const now = state.matches.filter(m => m.incomingId === pair.incomingId);
            expect(now).toHaveLength(1);
            expect(now[0].existingId).toBe(other.id);
            expect(now[0].reasons).toEqual(['manual']);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });
});

describe('the pairs of a comparison made once serve the merge (K3.3, K3.5)', () => {
    it('a recalculation works from the comparison handed in, not from matching the trees again', () => {
        const rnd = mulberry32(7);
        const existing = targetTree(rnd);
        const state = createMergeState(existing, sourceTree(existing, rnd), { match: false });
        const found = findMatches(state.existingData, state.incomingData);
        expect(found.length).toBeGreaterThan(1);
        // The comparison handed in knows one pair only: the recalculation keeps to it.
        const one = found.slice(0, 1);
        reanalyzeMatches(state, one);
        expect(state.matches.map(m => m.incomingId)).toEqual([one[0].incomingId]);
        state.decisions.set(one[0].incomingId, { type: 'confirm' });
        recalcUndecided(state, one[0].incomingId);
        expect(state.matches.map(m => m.incomingId)).toEqual([one[0].incomingId]);
        // Handed out as copies: an answer on a difference does not reach the kept pairs.
        state.matches[0].conflicts.forEach(c => { c.resolution = 'use_incoming'; });
        reanalyzeMatches(state);
        expect(state.matches[0].conflicts.every(c => c.resolution !== 'use_incoming' || one[0].conflicts.includes(c))).toBe(true);
    });

    it('another merge of the same trees matches them itself', () => {
        const rnd = mulberry32(7);
        const existing = targetTree(rnd);
        const incoming = sourceTree(existing, rnd);
        const a = createMergeState(existing, incoming, { match: false });
        reanalyzeMatches(a, []);
        expect(a.matches).toEqual([]);
        const b = createMergeState(existing, incoming, { match: false });
        reanalyzeMatches(b);
        expect(b.matches.length).toBe(findMatches(existing, incoming).length);
    });
});
