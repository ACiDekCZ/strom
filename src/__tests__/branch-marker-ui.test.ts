/**
 * Lineage markers in the Settings and the legend (spec 112, R1 / R5): the
 * tint switch under "off" and the names of the lines in the legend.
 */
import { describe, it, expect } from 'vitest';
import { branchLegendLabelKeys, branchTintControl } from '../ui/branch-marker-ui.js';
import { strings } from '../strings.js';

describe('branchTintControl (R1)', () => {
    it('is disabled and unchecked while the markers are off, the choice kept for later', () => {
        expect(branchTintControl('off', true)).toEqual({ checked: false, disabled: true });
        expect(branchTintControl('off', false)).toEqual({ checked: false, disabled: true });
    });
    it('shows the choice with any shape', () => {
        for (const m of ['arc', 'tag', 'stripe', 'corner'] as const) {
            expect(branchTintControl(m, true)).toEqual({ checked: true, disabled: false });
            expect(branchTintControl(m, false)).toEqual({ checked: false, disabled: false });
        }
    });
});

describe('branchLegendLabelKeys (R5)', () => {
    it('names the paternal, maternal and descendant lines', () => {
        const k = branchLegendLabelKeys(false);
        expect(k).toEqual({ paternal: 'legendPaternal', maternal: 'legendMaternal', descendant: 'legendDescendant' });
    });
    it('numbers the parents\' lines when both parents share a gender; descendants stay', () => {
        const k = branchLegendLabelKeys(true);
        expect(k).toEqual({ paternal: 'legendSlot1', maternal: 'legendSlot2', descendant: 'legendDescendant' });
        // Every key is a string of every language's table (the legend shows it as is).
        for (const key of Object.values(k)) expect(typeof strings.branchColors[key]).toBe('string');
    });
});
