/**
 * Lineage markers in the Settings and the legend (spec 112, R1 / R5): the
 * tint switch beside every shape ("no shape" included, Milan 19 Nov 2026),
 * when the legend draws its lineage part, and the names of the lines.
 */
import { describe, it, expect } from 'vitest';
import { branchLegendLabelKeys, syncBranchLegend, syncBranchMarkerSetting } from '../ui/branch-marker-ui.js';
import { strings } from '../strings.js';
import type { BranchMarker } from '../types.js';

type FakeInput = { value: string; checked: boolean; disabled: boolean };

function fakeSettings(): { root: ParentNode; radios: FakeInput[]; tint: FakeInput } {
    const radios = (['arc', 'tag', 'stripe', 'corner', 'none'] as const).map(value => ({ value, checked: false, disabled: false }));
    const tint = { value: 'on', checked: false, disabled: false };
    const root = {
        querySelectorAll: (sel: string) => (sel === 'input[name="branch-marker"]' ? radios : []),
        querySelector: (sel: string) => (sel === '#branch-tint-toggle' ? tint : null),
    };
    return { root: root as unknown as ParentNode, radios, tint };
}

describe('syncBranchMarkerSetting (R1)', () => {
    it('the tint is enabled and shows its choice with every row, no shape included', () => {
        for (const m of ['arc', 'tag', 'stripe', 'corner', 'none'] as const) {
            for (const on of [true, false]) {
                const { root, radios, tint } = fakeSettings();
                syncBranchMarkerSetting(m, on, root);
                expect(radios.filter(r => r.checked).map(r => r.value)).toEqual([m]);
                expect(tint).toMatchObject({ checked: on, disabled: false });
            }
        }
    });
});

describe('syncBranchLegend (R1)', () => {
    const group = { querySelectorAll: () => [] } as unknown as HTMLElement;
    it('drawn with any shape, and with no shape only while the cards are tinted', () => {
        for (const m of ['arc', 'tag', 'stripe', 'corner'] as BranchMarker[]) {
            expect(syncBranchLegend(group, m, false, false)).toBe(true);
            expect(syncBranchLegend(group, m, false, true)).toBe(true);
        }
        expect(syncBranchLegend(group, 'none', false, true)).toBe(true);
        expect(syncBranchLegend(group, 'none', false, false)).toBe(false);
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
