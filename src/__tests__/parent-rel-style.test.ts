/**
 * Style of a parent→child connection from the children's parent-rel types
 * (T03): an only adopted child, or a bus of adopted children only, is dashed
 * along the whole path; with a biological sibling only the adopted drops are.
 */

import { describe, it, expect } from 'vitest';
import { parentRelKind, parentRelDash, connectionDash, ADOPTIVE_DASH, STEP_DASH } from '../parent-rel-style.js';
import { ParentChildRelType, PersonId } from '../types.js';

const child = (...types: ParentChildRelType[]) => ({
    parentRelTypes: Object.fromEntries(types.map((t, i) => [`p${i}` as PersonId, t])) as Record<PersonId, ParentChildRelType>,
});

describe('parent-rel style', () => {
    it('reads the kind of a child link like the drop always did', () => {
        expect(parentRelKind(undefined)).toBeNull();
        expect(parentRelKind({})).toBeNull();
        expect(parentRelKind(child('biological', 'biological'))).toBeNull();
        expect(parentRelKind(child('biological', 'adoptive'))).toBe('adoptive');
        expect(parentRelKind(child('step', 'adoptive'))).toBe('adoptive');
        expect(parentRelKind(child('step', 'foster'))).toBe('foster');
        expect(parentRelKind(child('step'))).toBe('step');
        expect(parentRelDash('adoptive')).toBe(ADOPTIVE_DASH);
        expect(parentRelDash('step')).toBe(STEP_DASH);
        expect(parentRelDash('foster')).toBe(STEP_DASH);
        expect(parentRelDash(null)).toBeUndefined();
    });

    it('dashes the shared path of an only adopted child', () => {
        expect(connectionDash(['adoptive'])).toBe(ADOPTIVE_DASH);
        expect(connectionDash(['step'])).toBe(STEP_DASH);
    });

    it('dashes the shared path when every child is non-biological', () => {
        expect(connectionDash(['adoptive', 'adoptive'])).toBe(ADOPTIVE_DASH);
        expect(connectionDash(['foster', 'step'])).toBe(STEP_DASH);
        expect(connectionDash(['adoptive', 'foster'])).toBe(ADOPTIVE_DASH);
    });

    it('keeps the shared path solid with a biological sibling or no children', () => {
        expect(connectionDash(['adoptive', null])).toBeUndefined();
        expect(connectionDash([null, 'step'])).toBeUndefined();
        expect(connectionDash([null])).toBeUndefined();
        expect(connectionDash([])).toBeUndefined();
    });
});
