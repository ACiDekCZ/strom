import { describe, it, expect } from 'vitest';
import { pickMapLabels, type LabelBox, type MapLabelCandidate } from '../map-labels.js';

/** A point at (x, y): a 26 px dot and a name under it, `w` wide. */
const point = (x: number, y: number, weight: number, w = 80): MapLabelCandidate => {
    const dot: LabelBox = { left: x - 13, top: y - 13, right: x + 13, bottom: y + 13 };
    return { label: { left: x - w / 2, top: y + 15, right: x + w / 2, bottom: y + 30 }, own: [dot], weight };
};

describe('pickMapLabels', () => {
    it('keeps every name of points far apart', () => {
        expect(pickMapLabels([point(0, 0, 1), point(300, 0, 1), point(0, 300, 1)])).toEqual([true, true, true]);
    });

    it('two names over each other: the point with more people keeps its name', () => {
        expect(pickMapLabels([point(0, 0, 1), point(20, 4, 5)])).toEqual([false, true]);
    });

    it('a name that would cover a nearby dot is left out, the dot\'s own name stays', () => {
        // Lhota's name runs under Lhotínek's dot (just below and to the right).
        const lhota = point(0, 0, 3, 120);
        const lhotinek = point(40, 40, 1);
        expect(pickMapLabels([lhota, lhotinek])).toEqual([false, true]);
    });

    it('equal weights keep the first one given', () => {
        expect(pickMapLabels([point(0, 0, 2), point(10, 0, 2)])).toEqual([true, false]);
    });

    it('a hidden name (an empty box) is never kept and hides nothing', () => {
        const hidden: MapLabelCandidate = { ...point(0, 0, 9), label: { left: 0, top: 0, right: 0, bottom: 0 } };
        expect(pickMapLabels([hidden, point(10, 0, 1)])).toEqual([false, true]);
    });
});
