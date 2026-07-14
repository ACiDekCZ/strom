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
        expect(b).toEqual({ minX: 0, minY: 0, maxX: 330, maxY: 365, width: 330, height: 365 });
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
        // Gender colors present.
        expect(svg).toContain('#e3f2fd'); // male fill
        expect(svg).toContain('#fce4ec'); // female fill
    });

    it('renders names, surnames and birth year via displayYear', () => {
        const data = makeData(person('a', { firstName: 'Jan', lastName: 'Novák', birthDate: '~1880-06' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('>Jan<');
        expect(svg).toContain('>Novák<');
        expect(svg).toContain('>~1880<'); // displayYear keeps the qualifier, drops month
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

    it('long names shrink and clamp instead of overflowing the card', () => {
        const data = makeData(person('a', { firstName: 'Maximilian Alexander Wolfgang Amadeus' } as never));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
        expect(svg).not.toContain('font-size="14" font-weight="600" fill="#333333">Maximilian Alexander');
    });
});
