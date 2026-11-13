/**
 * The kind chips of "What the research knows" (spec 052 §3): offered only
 * with both kinds there, a kind without items never chosen.
 */

import { describe, it, expect } from 'vitest';
import { knowsKindChoice, knowsKindShows } from '../knows-kind.js';

describe('the kind shown in What the research knows', () => {
    it('offers the chips only when conflicts and hypotheses are both there', () => {
        expect(knowsKindChoice(3, 12, 'all')).toEqual({ kind: 'all', chips: true });
        expect(knowsKindChoice(3, 12, 'hyp')).toEqual({ kind: 'hyp', chips: true });
        // One kind left: no chips, the whole list (a choice made before does not hide it).
        expect(knowsKindChoice(0, 12, 'con')).toEqual({ kind: 'all', chips: false });
        expect(knowsKindChoice(3, 0, 'hyp')).toEqual({ kind: 'all', chips: false });
    });

    it('shows the rows of the kind chosen', () => {
        expect([knowsKindShows('all', true), knowsKindShows('all', false)]).toEqual([true, true]);
        expect([knowsKindShows('con', true), knowsKindShows('con', false)]).toEqual([true, false]);
        expect([knowsKindShows('hyp', true), knowsKindShows('hyp', false)]).toEqual([false, true]);
    });
});
