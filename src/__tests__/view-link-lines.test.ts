import { describe, it, expect } from 'vitest';
import { chainSegments, labelSpot, polylinePath, splitBus } from '../view-link-lines.js';

/**
 * The geometry of a line "linked in the view only": its segments chained
 * into polylines (drawn hollow as one stroke pair each), the stretch of a
 * shown family's bus that reaches the link's anchor, the label's spot.
 */
describe('chainSegments', () => {
    it('chains a stem, a connector and a drop into one polyline, in order', () => {
        const chains = chainSegments([
            { x1: 100, y1: 64, x2: 100, y2: 100 },    // stem
            { x1: 100, y1: 100, x2: 300, y2: 100 },   // bus
            { x1: 300, y1: 100, x2: 300, y2: 144 },   // drop
        ]);
        expect(chains).toEqual([[{ x: 100, y: 64 }, { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 144 }]]);
        expect(polylinePath(chains[0])).toBe('M 100 64 L 100 100 L 300 100 L 300 144');
    });

    it('chains whichever way the segments run and in whatever order they come', () => {
        const chains = chainSegments([
            { x1: 300, y1: 144, x2: 300, y2: 100 },
            { x1: 100, y1: 64, x2: 100, y2: 100 },
            { x1: 300, y1: 100, x2: 100, y2: 100 },
        ]);
        expect(chains).toHaveLength(1);
        expect(chains[0]).toHaveLength(4);
        const ends = [chains[0][0], chains[0][3]].map(p => `${p.x},${p.y}`).sort();
        expect(ends).toEqual(['100,64', '300,144']);
    });

    it('treats endpoints a float hair apart as one point', () => {
        expect(chainSegments([
            { x1: 0, y1: 0, x2: 0, y2: 40.0000001 },
            { x1: 0, y1: 40, x2: 50, y2: 40 },
        ])).toHaveLength(1);
    });

    it('splits at a fork and drops zero-length segments', () => {
        const chains = chainSegments([
            { x1: 0, y1: 0, x2: 0, y2: 40 },
            { x1: 0, y1: 40, x2: -50, y2: 40 },
            { x1: 0, y1: 40, x2: 50, y2: 40 },
            { x1: 50, y1: 40, x2: 50, y2: 40 },
        ]);
        expect(chains).toHaveLength(3);
        expect(chains.flat().length).toBe(6);
    });
});

describe('splitBus', () => {
    it('keeps the stretch over the family’s own children a ghost line, the rest out to the anchor is virtual', () => {
        // Stem at 560, the family's own child at 478, the anchor at 642.
        expect(splitBus(478, 642, [560, 478], [642])).toEqual({ ghost: [478, 560], virtual: [[560, 642]] });
    });

    it('reaches anchors on both sides', () => {
        expect(splitBus(0, 400, [200], [0, 400])).toEqual({ ghost: null, virtual: [[0, 200], [200, 400]] });
    });

    it('an anchor inside the family’s own stretch adds nothing virtual to the bus', () => {
        expect(splitBus(0, 400, [100, 0, 400], [200])).toEqual({ ghost: [0, 400], virtual: [] });
    });

    it('no own child and no stem: the whole bus is virtual', () => {
        expect(splitBus(10, 90, [], [10, 90])).toEqual({ ghost: null, virtual: [[10, 90]] });
    });
});

describe('labelSpot', () => {
    const line = [
        { x1: 100, y1: 64, x2: 100, y2: 104 },
        { x1: 100, y1: 104, x2: 400, y2: 104 },
        { x1: 400, y1: 104, x2: 400, y2: 144 },
    ];

    it('sits in the middle of the longest horizontal stretch the label fits on', () => {
        expect(labelSpot(line, 140)).toEqual({ x: 250, y: 104 });
    });

    it('a stretch shorter than the label: the middle of the longest vertical run', () => {
        const short = [
            { x1: 560, y1: 104, x2: 642, y2: 104 },
            { x1: 642, y1: 104, x2: 642, y2: 144 },
        ];
        expect(labelSpot(short, 140)).toEqual({ x: 642, y: 124 });
    });

    it('a stem straight above the child counts as one vertical run', () => {
        const straight = [
            { x1: 300, y1: 64, x2: 300, y2: 104 },
            { x1: 300, y1: 104, x2: 300, y2: 144 },
        ];
        expect(labelSpot(straight, 140)).toEqual({ x: 300, y: 104 });
    });

    it('no line, no spot', () => {
        expect(labelSpot([], 100)).toBeNull();
    });
});
