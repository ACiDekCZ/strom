/**
 * Poster SVG builder tests (pure string output; no DOM).
 */

import { describe, it, expect } from 'vitest';
import { buildTreeSvg, computeBounds, PosterLayout } from '../export-image.js';
import { StromData, Person, PersonId, PartnershipId, Position } from '../types.js';

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: 'Jan', lastName: 'Novák', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...over,
    };
}

function makeData(...persons: Person[]): StromData {
    const map: StromData['persons'] = {};
    for (const p of persons) map[p.id] = p;
    return { persons: map, partnerships: {} as Record<PartnershipId, never> };
}

function layout(positions: Record<string, Position>): PosterLayout {
    const map = new Map<PersonId, Position>();
    for (const [id, pos] of Object.entries(positions)) map.set(id as PersonId, pos);
    return {
        positions: map,
        connections: [{
            unionId: 'u1' as never,
            stemX: 65, stemTopY: 65, stemBottomY: 100,
            branchY: 100, branchLeftX: 65, branchRightX: 65,
            connectorFromX: 65, connectorToX: 65, connectorY: 100,
            drops: [{ personId: 'b' as PersonId, x: 65, topY: 100, bottomY: 200 }],
        }],
        spouseLines: [{
            unionId: 'u1' as never, person1Id: 'a' as PersonId, person2Id: 'c' as PersonId,
            partnershipId: null, y: 32, xMin: 130, xMax: 200,
        }],
    };
}

describe('computeBounds', () => {
    it('covers all cards (top-left to bottom-right)', () => {
        const l = layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } });
        const b = computeBounds(l);
        // Card box is 188x64 (Letopis normal): b at (200,300) → 388 x 364.
        expect(b).toEqual({ minX: 0, minY: 0, maxX: 388, maxY: 364, width: 388, height: 364 });
    });
    it('is all-zero for an empty layout', () => {
        expect(computeBounds({ positions: new Map(), connections: [], spouseLines: [] }).width).toBe(0);
    });
});

describe('buildTreeSvg', () => {
    it('produces a well-formed SVG with one card rect per person', () => {
        const data = makeData(person('a'), person('b', { gender: 'female' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } }));
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
        // Two rounded card rects (rx="8"); the background rect has no rx.
        expect((svg.match(/rx="8"/g) || []).length).toBe(2);
        // Cards are the neutral surface; gender is the avatar RING colour.
        expect(svg).toContain('#fffdf8'); // card surface
        expect(svg).toContain('#5b7f9e'); // male ring
        expect(svg).toContain('#a1706e'); // female ring
    });

    it('renders the full name and birth year via displayYear', () => {
        const data = makeData(person('a', { firstName: 'Jan', lastName: 'Novák', birthDate: '~1880-06' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('>Jan Novák<');   // full name on one row
        expect(svg).toContain('~1880');          // meta: "* ~1880" (qualifier kept, month dropped)
    });

    it('escapes XML special characters in names', () => {
        const data = makeData(person('a', { firstName: 'A & B', lastName: '<x>' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('A &amp; B');
        expect(svg).toContain('&lt;x&gt;');
        expect(svg).not.toContain('<x>');
    });

    it('adds a footer only when a title or date is given', () => {
        const data = makeData(person('a'));
        const l = layout({ a: { x: 0, y: 0 } });
        expect(buildTreeSvg(data, l, { treeName: 'My Family' })).toContain('My Family');
        expect(buildTreeSvg(data, l)).not.toContain('My Family');
    });

    it('spouse lines follow the partnership status (married solid, divorced dashed)', () => {
        const data = makeData(person('a'), person('b'));
        // No partnership resolved (partnershipId null) → married default → SOLID.
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } }));
        const spouseBlock = svg.split('class="spouse-lines"')[1].split('</g>')[0];
        expect(spouseBlock).not.toContain('stroke-dasharray');

        // Divorced partnership → dashed 8,4 (renderer parity).
        const divorced = makeData(person('a'), person('b'));
        divorced.partnerships = {
            ['u1' as never]: {
                id: 'u1', person1Id: 'a', person2Id: 'c', childIds: [], status: 'divorced',
            } as never,
        };
        const l = layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } });
        l.spouseLines[0].partnershipId = 'u1' as never;
        const svg2 = buildTreeSvg(divorced, l);
        const spouseBlock2 = svg2.split('class="spouse-lines"')[1].split('</g>')[0];
        expect(spouseBlock2).toContain('stroke-dasharray="8,4"');
    });

    it('adoptive child drops are dashed; deceased marker and branch stripe render', () => {
        const data = makeData(
            person('a'), person('b', { parentRelTypes: { a: 'adoptive' } as never }));
        const l = layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } });
        const svg = buildTreeSvg(data, l, {
            deceasedSet: new Set(['a']),
            branchMap: new Map([['a', 'paternal']]),
        });
        const connBlock = svg.split('class="connections"')[1].split('</g>')[0];
        expect(connBlock).toContain('stroke-dasharray="6,4"');   // adoptive drop
        expect(svg).toContain('†');                               // deceased marker
        expect(svg).toContain('#d08a5a');                         // paternal stripe
    });

    it('draws dimmed (context-only) persons at half opacity, others at full', () => {
        const data = makeData(person('a'), person('b', { gender: 'female' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } }), {
            dimmedIds: new Set(['b']),
        });
        // Exactly one card group is wrapped in an opacity-0.5 group (person b).
        expect((svg.match(/<g opacity="0.5">/g) || []).length).toBe(1);
        // Without dimmedIds, nothing is dimmed.
        const plain = buildTreeSvg(data, layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } }));
        expect(plain).not.toContain('<g opacity="0.5">');
    });

    it('long names shrink and clamp instead of overflowing the card', () => {
        const data = makeData(person('a', { firstName: 'Maximilian Alexander Wolfgang Amadeus' } as never));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
        expect(svg).not.toContain('font-size="15" font-weight="600" fill="#2b2822">Maximilian Alexander');
    });
});

describe('connection continuity (the printed lines must not break)', () => {
    // Secondary unions in partner chains get their connector on a LOWER lane
    // than the stem's natural end — the poster used to draw the stem only to
    // stemBottomY and left a visible gap (reported on a real printed poster:
    // the drops to children of a spouse's other unions arrived from nowhere).
    const conn = {
        unionId: 'u2' as never,
        stemX: 300, stemTopY: 65, stemBottomY: 100,
        branchY: 140, branchLeftX: 250, branchRightX: 350,
        connectorFromX: 300, connectorToX: 250, connectorY: 120,
        drops: [{ personId: 'b' as PersonId, x: 350, topY: 140, bottomY: 200 }],
    };

    it('draws the stem all the way down to the connector lane', () => {
        const data = makeData(person('a'), person('b'));
        const l: PosterLayout = {
            positions: new Map([['a' as PersonId, { x: 270, y: 0 }], ['b' as PersonId, { x: 320, y: 200 }]]),
            connections: [conn],
            spouseLines: [],
        };
        const svg = buildTreeSvg(data, l);
        // Stem reaches connectorY (120), not just stemBottomY (100)…
        expect(svg).toMatch(/x1="300(\.0*)?" y1="65(\.0*)?" x2="300(\.0*)?" y2="120(\.0*)?"/);
        // …the horizontal connector runs on its lane…
        expect(svg).toMatch(/x1="300(\.0*)?" y1="120(\.0*)?" x2="250(\.0*)?" y2="120(\.0*)?"/);
        // …and its junction continues down to the bus lane.
        expect(svg).toMatch(/x1="250(\.0*)?" y1="120(\.0*)?" x2="250(\.0*)?" y2="140(\.0*)?"/);
    });

    it('extends an in-range stem straight to the bus (no gap either)', () => {
        const straight = {
            ...conn,
            connectorFromX: 300, connectorToX: 300, connectorY: 120,
            branchLeftX: 280, branchRightX: 350,
        };
        const data = makeData(person('a'), person('b'));
        const l: PosterLayout = {
            positions: new Map([['a' as PersonId, { x: 270, y: 0 }], ['b' as PersonId, { x: 320, y: 200 }]]),
            connections: [straight],
            spouseLines: [],
        };
        const svg = buildTreeSvg(data, l);
        expect(svg).toMatch(/x1="300(\.0*)?" y1="65(\.0*)?" x2="300(\.0*)?" y2="120(\.0*)?"/);
        expect(svg).toMatch(/x1="300(\.0*)?" y1="120(\.0*)?" x2="300(\.0*)?" y2="140(\.0*)?"/);
    });
});
