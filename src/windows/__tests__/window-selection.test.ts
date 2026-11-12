/**
 * The person selection shared between windows (spec 079 §2): another
 * window's choice selects the Table's row, or rings the chart's card and pans
 * only when the card is out of view (the focus stays); a choice here goes to
 * the others; a satellite not following neither sends nor takes it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applySharedSelection, wireMainSelection, wireSatelliteSelection, cardInView, type SelectionDeps } from '../window-selection.js';
import type { WindowRegistry } from '../window-registry.js';
import type { SatelliteClient } from '../satellite.js';
import type { TableSelectionShare } from '../../ui/table-view/table-ui.js';

type Rect = { left: number; right: number; top: number; bottom: number };

/** A document with the chart's area and one drawn card. */
function doc(card: Rect | null): Document {
    const box = { getBoundingClientRect: () => ({ left: 0, right: 800, top: 48, bottom: 600 }) };
    return {
        getElementById: (id: string) => (id === 'tree-container' ? box : null),
        querySelector: (sel: string) => (card && sel.includes('p1') ? { getBoundingClientRect: () => card } : null),
    } as unknown as Document;
}

function deps(mode = 'family'): SelectionDeps & { share: TableSelectionShare | null; calls: string[] } {
    const d = {
        share: null as TableSelectionShare | null,
        calls: [] as string[],
        viewMode: () => mode,
        setTableSelectionShare: (s: TableSelectionShare | null) => { d.share = s; },
        tableSharedSelect: (id: string | null) => { d.calls.push(`table:${id}`); },
        setWindowSelected: (id: string | null) => { d.calls.push(`ring:${id}`); },
        glideTo: (id: string) => { d.calls.push(`glide:${id}`); },
    };
    return d;
}

beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    vi.stubGlobal('document', doc(null));
});
afterEach(() => vi.unstubAllGlobals());

describe('another window\'s selection here', () => {
    it('the Table: the person\'s row (scrolled to there only when out of view)', () => {
        const d = deps('table');
        applySharedSelection('p1', d, doc(null));
        expect(d.calls).toEqual(['ring:p1', 'table:p1']);
    });

    it('a chart: the card\'s ring; a pan only when the card is out of view; never a new focus', () => {
        const inside = deps('family');
        applySharedSelection('p1', inside, doc({ left: 100, right: 260, top: 100, bottom: 180 }));
        expect(inside.calls).toEqual(['ring:p1']);
        const outside = deps('descendants');
        applySharedSelection('p1', outside, doc({ left: 760, right: 920, top: 100, bottom: 180 }));
        expect(outside.calls).toEqual(['ring:p1', 'glide:p1']);
        // Not drawn in this chart: nothing to pan to.
        const absent = deps('family');
        applySharedSelection('p1', absent, doc(null));
        expect(absent.calls).toEqual(['ring:p1']);
    });

    it('a card half under the bar counts as out of view', () => {
        expect(cardInView(doc({ left: 100, right: 260, top: 20, bottom: 100 }), 'p1')).toBe(false);
        expect(cardInView(doc(null), 'p1')).toBeNull();
    });
});

describe('the main window', () => {
    it('a person chosen here goes to the satellites and drops the ring; theirs are taken; the Table shows the shared look with windows open', () => {
        let onSelect: ((id: string | null, origin: string) => void) | null = null;
        const announced: string[] = [];
        let windows = 0;
        const registry = {
            list: () => Array.from({ length: windows }),
            announceSelection: (id: string) => { announced.push(id); },
            onSelect: (cb: (id: string | null, origin: string) => void) => { onSelect = cb; return () => { onSelect = null; }; },
        } as unknown as WindowRegistry;
        const d = deps('family');
        const stop = wireMainSelection(registry, d);
        expect(d.share!.active()).toBe(false);
        windows = 1;
        expect(d.share!.active()).toBe(true);
        d.share!.announce('p7' as never);
        expect(announced).toEqual(['p7']);

        window.dispatchEvent(new CustomEvent('strom:focus-changed', { detail: { personId: 'p2' } }));
        expect(announced).toEqual(['p7', 'p2']);
        expect(d.calls).toEqual(['ring:null']);

        onSelect!('p1', 'sat-1');
        expect(d.calls).toContain('ring:p1');

        stop();
        window.dispatchEvent(new CustomEvent('strom:focus-changed', { detail: { personId: 'p3' } }));
        expect(announced).toEqual(['p7', 'p2']);
        expect(d.share).toBeNull();
    });
});

describe('a satellite', () => {
    it('shares the Table\'s row while following; another window\'s choice selects its row', () => {
        let follow = true;
        let onSelect: ((p: { personId: string | null; origin: string }) => void) | null = null;
        const announced: string[] = [];
        const client = {
            get followSelection() { return follow; },
            announceSelection: (id: string) => { announced.push(id); },
            on: (_e: string, cb: (p: { personId: string | null; origin: string }) => void) => { onSelect = cb; return () => {}; },
        } as unknown as SatelliteClient;
        const d = deps('table');
        wireSatelliteSelection(client, d);
        expect(d.share!.active()).toBe(true);
        follow = false;
        expect(d.share!.active()).toBe(false);
        d.share!.announce('p4' as never);
        expect(announced).toEqual(['p4']);
        onSelect!({ personId: 'p5', origin: 'main-1' });
        expect(d.calls).toEqual(['ring:p5', 'table:p5']);
    });
});
