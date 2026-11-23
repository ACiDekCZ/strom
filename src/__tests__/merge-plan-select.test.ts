/**
 * Whom to add (spec 134 §5): where each new person links to the tree, who
 * loses the one way to it when a person is unticked (K4.3), the variants of
 * step 3, a person kept as a "?" (written with its links, no dangling id),
 * and the living among the new (K4.5). Invented trees, persons joined by hand.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { applyPlan, buildPlan, planCounts, planFates, verifyResult } from '../merge/plan.js';
import {
    connectedNew, dependentsVia, livingNew, newPersons, selectionOf, variantSelection, leftOutFor,
} from '../merge/plan-select.js';
import { StorageManager } from '../storage.js';
import { Person, PersonId, StromData } from '../types.js';
import { Family, addChoices, stateOf } from './helpers/merge-select-trees.js';

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });

interface Fixture {
    target: StromData; source: StromData;
    s1: Person; s4: Person; s5: Person; s6: Person; s7: Person; s8: Person; s9: Person;
    t1: Person; branch: Person[];
}

/**
 * The tree: a couple (Jilm, Modřínová) and their son. The import: the same
 * three (joined), the husband's parents, grandfather and great-grandfather,
 * a second son with a wife and a branch of 44 below them, a lone Jilm.
 */
function fixture(): Fixture {
    const t = new Family('t');
    const t1 = t.person('male', 'Jilm', 1850, { birthPlace: 'Křemenná' });
    const t2 = t.person('female', 'Modřín', 1852);
    const tu = t.couple(t1, t2);
    const t3 = t.child(tu, t.person('male', 'Jilm', 1878));

    const s = new Family('s');
    const s1 = s.person('male', 'Jilm', 1850, { birthPlace: 'Křemenná', firstName: t1.firstName });
    const s2 = s.person('female', 'Modřín', 1852, { firstName: t2.firstName });
    const su = s.couple(s1, s2);
    const s3 = s.child(su, s.person('male', 'Jilm', 1878, { firstName: t3.firstName }));
    const s4 = s.person('male', 'Jilm', 1820);
    const s5 = s.person('female', 'Jilm', 1822);
    s.child(s.couple(s4, s5), s1);
    const s6 = s.person('male', 'Jilm', 1790);
    s.child(s6, s4);
    const s8 = s.person('male', 'Jilm', 1760);
    s.child(s8, s6);
    const s7 = s.child(su, s.person('male', 'Jilm', 1880));
    const wife = s.person('female', 'Modřín', 1882);
    const wu = s.couple(s7, wife);
    const branch = [wife, ...s.branch(wu, 1880, 2, 3)];
    const s9 = s.person('male', 'Jilm', 1900);
    const state0 = { target: t.data, source: s.data };
    void s3;
    return { ...state0, s1, s4, s5, s6, s7, s8, s9, t1, branch };
}

function setup() {
    const f = fixture();
    const pairs = Object.values(f.target.persons).map(tp => {
        const sp = Object.values(f.source.persons).find(p => p.firstName === tp.firstName && p.birthDate === tp.birthDate)!;
        return [sp.id, tp.id] as [PersonId, PersonId];
    });
    return { ...f, state: stateOf(f.target, f.source, pairs) };
}

const ids = (list: readonly Person[]): PersonId[] => list.map(p => p.id);

describe('connectedNew', () => {
    it('gives each new person the joined person its shortest way ends at, the steps and the next person', () => {
        const { state, s1, s4, s5, s6, s7, s8, s9, t1, branch } = setup();
        const w = addChoices();
        const c = connectedNew(state, w);
        expect(c.get(s4.id)).toMatchObject({ via: t1.id, viaSource: s1.id, steps: 1, next: s1.id, rel: 'parent', path: [s4.id, s1.id] });
        expect(c.get(s5.id)).toMatchObject({ steps: 1, rel: 'parent' });
        expect(c.get(s6.id)).toMatchObject({ via: t1.id, steps: 2, next: s4.id, rel: 'parent', path: [s6.id, s4.id, s1.id] });
        expect(c.get(s8.id)?.steps).toBe(3);
        expect(c.get(s7.id)).toMatchObject({ steps: 1, rel: 'child' });
        expect(c.get(branch[0].id)).toMatchObject({ steps: 2, next: s7.id, rel: 'partner' });
        // The lone one has no way; the joined are not new.
        expect(c.has(s9.id)).toBe(false);
        expect(c.has(s1.id)).toBe(false);
        expect(c.size).toBe(newPersons(state, w).length - 1);
    });

    it('under a selection: no way through an unticked person', () => {
        const { state, s4, s6, s8 } = setup();
        const w = addChoices({ leftOut: [s4.id] });
        const c = connectedNew(state, w, selectionOf(state, w));
        expect(c.has(s4.id)).toBe(false);
        expect(c.has(s6.id)).toBe(false);
        expect(c.has(s8.id)).toBe(false);
    });
});

describe('dependentsVia (K4.3)', () => {
    it('unticking the second son takes his branch of 45 (wife and descendants) with him, nearest first', () => {
        const { state, s7, branch } = setup();
        const w = addChoices();
        const deps = dependentsVia(state, w, s7.id, selectionOf(state, w));
        expect(deps.length).toBe(45);
        expect(new Set(deps)).toEqual(new Set(ids(branch)));
        // Nearest first: the wife and the two children, then the generations below.
        const near = [branch[0].id, ...state.incomingData.persons[s7.id].childIds];
        expect(new Set(deps.slice(0, 3))).toEqual(new Set(near));
    });

    it('a person with another way left takes nobody; a line upwards goes with its lower end', () => {
        const { state, s4, s5, s6, s8 } = setup();
        const w = addChoices();
        const sel = selectionOf(state, w);
        expect(dependentsVia(state, w, s5.id, sel)).toEqual([]);
        expect(dependentsVia(state, w, s4.id, sel)).toEqual([s6.id, s8.id]);
        // Already unticked: nothing more goes.
        const w2 = addChoices({ leftOut: [s6.id] });
        expect(dependentsVia(state, w2, s4.id, selectionOf(state, w2))).toEqual([]);
    });
});

describe('Keep as "?"', () => {
    it('the second son becomes a "?" with his links: his branch stays linked, nothing points at nothing', async () => {
        const { state, target, source, s7, branch } = setup();
        const w = addChoices({ placeholders: [s7.id] });
        const plan = buildPlan(state, w);
        expect(plan.items).toContainEqual({ kind: 'skip', id: s7.id, reason: 'step3', standIn: true });
        const c = planCounts(plan);
        expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);
        expect(planFates(plan).get(s7.id)).toBe('skipped');
        for (const p of branch) expect(planFates(plan).get(p.id)).toBe('added');

        const result = await applyPlan(plan, target, source);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
        const q = result.data.persons[result.trace!.persons.get(s7.id)!];
        expect(q).toMatchObject({ isPlaceholder: true, firstName: '?', lastName: '' });
        expect(q.birthDate).toBeUndefined();
        expect(q.childIds.length).toBe(2);
        expect(q.partnerships.length).toBe(1);
        expect(verifyResult(plan, target, source, result.data)).toEqual([]);
        // The "?" is not counted among the added people.
        const addedNamed = Object.values(result.data.persons).filter(p => !target.persons[p.id] && !p.isPlaceholder).length;
        expect(addedNamed).toBe(c.added);
        // The import itself is untouched.
        expect(source.persons[s7.id].isPlaceholder).toBe(false);
    });

    it('a "?" with nothing to stand between is not written', async () => {
        const { state, target, source, s9 } = setup();
        const plan = buildPlan(state, addChoices({ placeholders: [s9.id] }));
        expect(plan.items).toContainEqual({ kind: 'skip', id: s9.id, reason: 'step3' });
        const result = await applyPlan(plan, target, source);
        expect(result.ok).toBe(true);
        expect(result.trace!.persons.get(s9.id) && result.data.persons[result.trace!.persons.get(s9.id)!]).toBeFalsy();
    });
});

describe('variantSelection', () => {
    it('ancestors of a person: the new ones above them, by generations', () => {
        const { state, s1, s4, s5, s6, s8 } = setup();
        const w = addChoices();
        expect(variantSelection(state, w, { kind: 'ancestors', person: s1.id, generations: 'all' })).toEqual(new Set([s4.id, s5.id, s6.id, s8.id]));
        expect(variantSelection(state, w, { kind: 'ancestors', person: s1.id, generations: 2 })).toEqual(new Set([s4.id, s5.id, s6.id]));
    });

    it('descendants of a person: the person when new, the descendants and who married in', () => {
        const { state, s7, branch } = setup();
        const sel = variantSelection(state, addChoices(), { kind: 'descendants', person: s7.id, generations: 'all' });
        expect(sel).toEqual(new Set([s7.id, ...ids(branch)]));
    });

    it('a family: the new people with a form of the surname', () => {
        const { state, source } = setup();
        const w = addChoices();
        const fresh = newPersons(state, w);
        const want = fresh.filter(id => source.persons[id].lastName.startsWith('Jilm'));
        expect(want.length).toBeGreaterThan(5);
        expect(variantSelection(state, w, { kind: 'rod', surname: 'Jilm' })).toEqual(new Set(want));
        expect(variantSelection(state, w, { kind: 'rod', surname: 'Jilmová' })).toEqual(new Set(want));
    });

    it('only linked, within n steps; all; by hand', () => {
        const { state, s4, s5, s6, s7, branch } = setup();
        const w = addChoices();
        expect(variantSelection(state, w, { kind: 'linked', steps: 1 })).toEqual(new Set([s4.id, s5.id, s7.id]));
        const two = variantSelection(state, w, { kind: 'linked', steps: 2 });
        expect(two.has(s6.id)).toBe(true);
        expect(two.has(branch[0].id)).toBe(true);
        expect(variantSelection(state, w, { kind: 'all' }).size).toBe(newPersons(state, w).length);
        expect(variantSelection(state, w, { kind: 'manual' }).size).toBe(0);
        // A variant is the choices' leftOut: the counts follow.
        const ticked = variantSelection(state, w, { kind: 'linked', steps: 1 });
        const c = planCounts(buildPlan(state, addChoices({ leftOut: leftOutFor(state, w, ticked) })));
        expect(c.added).toBe(3);
        expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);
    });
});

describe('living among the new (K4.5)', () => {
    it('are those the privacy rules treat as living; Leave out living skips them with their reason', () => {
        const { state, source } = setup();
        const w = addChoices();
        const living = livingNew(state, w);
        const want = newPersons(state, w).filter(id => Number(source.persons[id].birthDate) > 2026 - 110);
        expect(living.length).toBeGreaterThan(10);
        expect(new Set(living)).toEqual(new Set(want));
        const plan = buildPlan(state, addChoices({ skipLiving: true }));
        const skipped = plan.items.flatMap(i => i.kind === 'skip' && i.reason === 'living' ? [i.id] : []);
        expect(new Set(skipped)).toEqual(new Set(want));
        const c = planCounts(plan);
        expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);
    });
});
