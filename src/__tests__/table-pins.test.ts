import { describe, it, expect } from 'vitest';
import { PIN_MAX, TablePins, pinRanks } from '../ui/table-view/table-pins.js';

/** Pinned rows of the Table (spec 103 U3, §3; decisions D5, D7). */
describe('TablePins', () => {
    it('pins rows once each, unpins one and all', () => {
        const p = new TablePins();
        p.use('t1', 'persons');
        expect(p.pin(['p:a', 'p:b', 'p:a'])).toBe(true);
        expect(p.all()).toEqual(['p:a', 'p:b']);
        expect(p.has('p:a')).toBe(true);
        expect(p.pin(['p:a'])).toBe(false);
        expect(p.unpin('p:a')).toBe(true);
        expect(p.unpin('p:a')).toBe(false);
        expect(p.all()).toEqual(['p:b']);
        p.clear();
        expect(p.count()).toBe(0);
    });

    it('holds a row only for its own tree and row type (a jump to a pinned person)', () => {
        const p = new TablePins();
        expect(p.holds('t1', 'persons', 'p:a')).toBe(false);
        p.use('t1', 'persons');
        p.pin(['p:a']);
        expect(p.holds('t1', 'persons', 'p:a')).toBe(true);
        expect(p.holds('t1', 'persons', 'p:b')).toBe(false);
        expect(p.holds('t2', 'persons', 'p:a')).toBe(false);
        expect(p.holds('t1', 'unions', 'p:a')).toBe(false);
    });

    it('keeps within PIN_MAX: a range that would go over pins nothing', () => {
        const p = new TablePins();
        p.use('t1', 'persons');
        const keys = Array.from({ length: PIN_MAX }, (_, i) => `p:${i}`);
        expect(p.pin(keys.slice(0, PIN_MAX - 1))).toBe(true);
        expect(p.canPin(['p:x', 'p:y'])).toBe(false);
        expect(p.pin(['p:x', 'p:y'])).toBe(false);
        expect(p.count()).toBe(PIN_MAX - 1);
        // Rows already pinned count once.
        expect(p.canPin(['p:0', 'p:x'])).toBe(true);
        expect(p.pin(['p:0', 'p:x'])).toBe(true);
        expect(p.count()).toBe(PIN_MAX);
        expect(p.canPin(['p:z'])).toBe(false);
    });

    it('another tree or row type drops the pins; the same keeps them', () => {
        const p = new TablePins();
        p.use('t1', 'persons');
        p.pin(['p:a']);
        p.use('t1', 'persons');
        expect(p.count()).toBe(1);
        p.use('t1', 'unions');
        expect(p.count()).toBe(0);
        p.pin(['u:x']);
        p.use('t2', 'unions');
        expect(p.count()).toBe(0);
    });

    it('rows gone from the data drop out', () => {
        const p = new TablePins();
        p.use('t1', 'persons');
        p.pin(['p:a', 'p:b', 'p:c']);
        p.prune(k => k !== 'p:b');
        expect(p.all()).toEqual(['p:a', 'p:c']);
    });

    it('orders by the table and keeps that order until the context changes (D7 a)', () => {
        const p = new TablePins();
        p.use('t1', 'persons');
        p.pin(['p:c', 'p:a']);
        let shown = ['p:a', 'p:b', 'p:c'];
        const rank = () => pinRanks(p.all(), shown, () => shown);
        expect(p.ordered('sort1', rank)).toEqual(['p:a', 'p:c']);
        // An edit moved p:c before p:a in the body; the same context keeps the order.
        shown = ['p:c', 'p:a', 'p:b'];
        expect(p.ordered('sort1', rank)).toEqual(['p:a', 'p:c']);
        // Another sort, filter, search or view orders anew.
        expect(p.ordered('sort2', rank)).toEqual(['p:c', 'p:a']);
        // A new pin orders anew too.
        p.pin(['p:b']);
        expect(p.ordered('sort2', rank)).toEqual(['p:c', 'p:a', 'p:b']);
    });
});

describe('pinRanks', () => {
    it('a shown row ranks by its place; a hidden one after the last shown row before it', () => {
        const shown = ['p:a', 'p:c', 'p:e'];
        const all = ['p:a', 'p:b', 'p:c', 'p:d', 'p:x', 'p:e'];
        const r = pinRanks(['p:e', 'p:d', 'p:x', 'p:a', 'p:b'], shown, () => all);
        const order = [...r.keys()].sort((x, y) => r.get(x)! - r.get(y)!);
        expect(order).toEqual(['p:a', 'p:b', 'p:d', 'p:x', 'p:e']);
    });

    it('does not ask for the full order when every pinned row is shown', () => {
        let asked = false;
        const r = pinRanks(['p:b'], ['p:a', 'p:b'], () => { asked = true; return []; });
        expect(r.get('p:b')).toBe(1);
        expect(asked).toBe(false);
    });
});
