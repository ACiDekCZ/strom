import { describe, it, expect } from 'vitest';
import { startupPerson, defaultTarget } from '../default-person.js';
import { type PersonId, type StromData } from '../types.js';
import { LAST_FOCUSED } from '../model-values.js';

type Data = Pick<StromData, 'persons' | 'defaultPersonId' | 'lastFocusPersonId'>;

const A = 'p_a' as PersonId;
const B = 'p_b' as PersonId;
const C = 'p_c' as PersonId;

function data(ids: PersonId[], extra: Partial<Data> = {}): Data {
    const persons = Object.fromEntries(ids.map(id => [id, { id }])) as unknown as Data['persons'];
    return { persons, ...extra };
}

describe('startupPerson (the person a tree opens on)', () => {
    it('opens an empty tree on nobody', () => {
        expect(startupPerson(data([]))).toBeNull();
    });
    it('opens on the first person without a setting', () => {
        expect(startupPerson(data([A, B]))).toEqual({ id: A, reason: 'first' });
    });
    it('opens on the person set, or the first person once that one is gone', () => {
        expect(startupPerson(data([A, B], { defaultPersonId: B }))).toEqual({ id: B, reason: 'specific' });
        expect(startupPerson(data([A, B], { defaultPersonId: C }))).toEqual({ id: A, reason: 'fallbackFirst' });
    });
    it('opens "Last focused" on the last focused person, else on the first', () => {
        expect(startupPerson(data([A, B], { defaultPersonId: LAST_FOCUSED, lastFocusPersonId: B }))).toEqual({ id: B, reason: 'last' });
        expect(startupPerson(data([A, B], { defaultPersonId: LAST_FOCUSED, lastFocusPersonId: C }))).toEqual({ id: A, reason: 'first' });
        expect(startupPerson(data([A, B], { defaultPersonId: LAST_FOCUSED }))).toEqual({ id: A, reason: 'first' });
    });
});

describe('defaultTarget (spec 111: the target of ⌂)', () => {
    it('has no target in an empty tree, in both variants', () => {
        expect(defaultTarget(data([]), null, true)).toBeNull();
        expect(defaultTarget(data([]), null, false)).toBeNull();
    });
    it('"First person" leads to the first person now (a new first after a deletion)', () => {
        expect(defaultTarget(data([A, B]), null, true)).toEqual({ id: A, reason: 'first' });
        expect(defaultTarget(data([B, C]), null, true)).toEqual({ id: B, reason: 'first' });
    });
    it('"Specific person" leads to that person', () => {
        expect(defaultTarget(data([A, B], { defaultPersonId: B }), A, true)).toEqual({ id: B, reason: 'specific' });
    });
    it('a specific person deleted: variant A the first person, variant B none (K1.5)', () => {
        expect(defaultTarget(data([A, B], { defaultPersonId: C }), null, true)).toEqual({ id: A, reason: 'fallbackFirst' });
        expect(defaultTarget(data([A, B], { defaultPersonId: C }), null, false)).toBeNull();
    });
    it('"Last focused" leads to the person the tree opened on, not the last focused one', () => {
        const d = data([A, B, C], { defaultPersonId: LAST_FOCUSED, lastFocusPersonId: C });
        expect(defaultTarget(d, B, true)).toEqual({ id: B, reason: 'opened' });
    });
    it('"Last focused" without an opened person still there: the first person (A) or none (B)', () => {
        const d = data([A, B], { defaultPersonId: LAST_FOCUSED });
        expect(defaultTarget(d, C, true)).toEqual({ id: A, reason: 'first' });
        expect(defaultTarget(d, null, false)).toBeNull();
    });
});
