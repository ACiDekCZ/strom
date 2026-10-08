/**
 * Marriage order (T13): the chronological order of a person's unions and the
 * marriage-order pills of a laid-out view (src/marriage-order.ts), drawn by
 * the image export too (src/export-image.ts).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { marriagesInOrder, unionOrderBadges, compareMarriages } from '../marriage-order.js';
import { buildTreeSvg } from '../export-image.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { setLanguage, strings } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId, Partnership, DEFAULT_LAYOUT_CONFIG } from '../types.js';

const P = (id: string) => id as PersonId;

function family(): StromData {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const person = (id: string, gender: 'male' | 'female', over: Partial<Person> = {}) => {
        persons[id] = { id: P(id), firstName: id, lastName: 'X', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...over };
    };
    const union = (id: string, a: string, b: string, startDate: string | undefined, kids: string[], over: Partial<Partnership> = {}) => {
        partnerships[id] = { id: id as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids.map(P),
            status: 'married', startDate, ...over };
        persons[a].partnerships.push(id as PartnershipId);
        persons[b].partnerships.push(id as PartnershipId);
        for (const k of kids) {
            persons[k].parentIds.push(P(a), P(b));
            persons[a].childIds.push(P(k));
            persons[b].childIds.push(P(k));
        }
    };
    person('gf', 'male'); person('gm', 'female');
    person('H', 'male', { birthDate: '1841' });
    union('u_g', 'gf', 'gm', '1838', ['H']);
    person('W1', 'female'); person('W2', 'female'); person('W3', 'female');
    person('c1', 'male', { birthDate: '1867' });
    person('c2', 'female', { birthDate: '1909' });
    person('c3', 'male', { birthDate: '1881' });
    // Data order is NOT chronological: 1908, 1880, 1866.
    union('u2', 'H', 'W2', '1908', ['c2'], { startPlace: 'Praha' });
    union('u3', 'H', 'W3', '1880', ['c3']);
    union('u1', 'H', 'W1', '1866', ['c1'], { startPlace: 'Dolní Lhota' });
    return { persons, partnerships } as unknown as StromData;
}

function layout(data: StromData, focus: string, autoExpand: boolean) {
    return runLayoutPipeline({
        data, focusPersonId: P(focus), config: DEFAULT_LAYOUT_CONFIG,
        ancestorDepth: 3, descendantDepth: 3,
        includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
        displayPolicy: { mode: 'standard', autoExpand },
    });
}

afterEach(() => setLanguage('en'));

describe('compareMarriages / marriagesInOrder', () => {
    it('orders by the wedding date, whatever the data order', () => {
        expect(marriagesInOrder(family(), P('H'))).toEqual(['u1', 'u3', 'u2']);
    });

    it('puts an undated union after the dated ones, ties in data order', () => {
        const data = family();
        delete data.partnerships['u3' as PartnershipId].startDate;
        expect(marriagesInOrder(data, P('H'))).toEqual(['u1', 'u2', 'u3']);
        // Two undated: the data order decides.
        delete data.partnerships['u1' as PartnershipId].startDate;
        expect(marriagesInOrder(data, P('H'))).toEqual(['u2', 'u3', 'u1']);
        // Same year, a full date after the bare year; a qualifier does not move it.
        expect(compareMarriages({ startDate: '1866', index: 1 }, { startDate: '1866-05-02', index: 0 })).toBeLessThan(0);
        expect(compareMarriages({ startDate: '~1866', index: 1 }, { startDate: '1866', index: 0 })).toBeGreaterThan(0);
        expect(compareMarriages({ startDate: '850', index: 1 }, { startDate: '1866', index: 0 })).toBeLessThan(0);
    });

    it('leaves out an empty "?" stand-in family (not a marriage)', () => {
        const data = family();
        const persons = data.persons as Record<string, Person>;
        persons.Q = { id: P('Q'), firstName: '', lastName: '', gender: 'female', isPlaceholder: true,
            partnerships: ['uq' as PartnershipId], parentIds: [], childIds: [P('cq')] };
        persons.cq = { id: P('cq'), firstName: 'cq', lastName: 'X', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [P('H'), P('Q')], childIds: [] };
        (data.partnerships as Record<string, Partnership>).uq = { id: 'uq' as PartnershipId, person1Id: P('H'),
            person2Id: P('Q'), childIds: [P('cq')], status: 'married', startDate: '1850' };
        persons.H.partnerships.push('uq' as PartnershipId);
        expect(marriagesInOrder(data, P('H'))).toEqual(['u1', 'u3', 'u2']);
    });
});

describe('unionOrderBadges', () => {
    it('gives every partner of a person with several unions in view a pill, pointing to that person', () => {
        const data = family();
        const result = layout(data, 'H', true);
        const badges = unionOrderBadges(data, result);
        const hx = result.positions.get(P('H'))!.x;
        const got = (id: string) => { const b = badges.get(P(id)); return b && { n: b.number, year: b.year, toward: b.towardId }; };
        expect(got('W1')).toEqual({ n: 1, year: '1866', toward: 'H' });
        expect(got('W3')).toEqual({ n: 2, year: '1880', toward: 'H' });
        expect(got('W2')).toEqual({ n: 3, year: '1908', toward: 'H' });
        for (const w of ['W1', 'W2', 'W3']) {
            const b = badges.get(P(w))!;
            const x = result.positions.get(P(w))!.x;
            expect(b.side).toBe(x < hx ? 'right' : 'left');
        }
        // The shared person and the persons of a single union have none.
        for (const id of ['H', 'gf', 'gm', 'c1', 'c2', 'c3']) expect(badges.has(P(id))).toBe(false);
        expect(badges.get(P('W1'))!.place).toBe('Dolní Lhota');
    });

    it('shows no pill while only one union of the person is in view', () => {
        const data = family();
        // Standard view: one partner per person.
        expect(unionOrderBadges(data, layout(data, 'H', false)).size).toBe(0);
        // A hand-made view with one of the three unions drawn.
        const positions = new Map([[P('H'), { x: 0, y: 0 }], [P('W2'), { x: 200, y: 0 }]]);
        const one = unionOrderBadges(data, { positions,
            spouseLines: [{ person1Id: P('H'), person2Id: P('W2'), partnershipId: 'u2' as PartnershipId }] });
        expect(one.size).toBe(0);
        // Two of them: the numbers count every union in the data (1908 is the 3rd).
        positions.set(P('W3'), { x: -200, y: 0 });
        const two = unionOrderBadges(data, { positions, spouseLines: [
            { person1Id: P('H'), person2Id: P('W2'), partnershipId: 'u2' as PartnershipId },
            { person1Id: P('W3'), person2Id: P('H'), partnershipId: 'u3' as PartnershipId },
        ] });
        expect(two.get(P('W2'))!).toMatchObject({ number: 3, side: 'left' });
        expect(two.get(P('W3'))!).toMatchObject({ number: 2, side: 'right' });
    });

    it('words its bubble per language and kind of union, naming whose marriage it is', () => {
        expect(strings.focus.unionOrderTip(2, '1885', '', true, 'Jan Novák')).toBe("Jan Novák's 2nd marriage, 1885");
        expect(strings.focus.unionOrderTip(1, '1866', 'Dolní Lhota', true, 'Jan Novák')).toBe("Jan Novák's 1st marriage, 1866, Dolní Lhota");
        expect(strings.focus.unionOrdinal(2)).toBe('2nd');
        expect(strings.focus.unionOrdinal(13)).toBe('13th');
        setLanguage('cs');
        expect(strings.focus.unionOrderTip(2, '1885', 'Dolní Lhota', true, 'Jan Novák')).toBe('Jan Novák: 2. sňatek, 1885, Dolní Lhota');
        expect(strings.focus.unionOrderTip(2, '', '', false, 'Jan Novák')).toBe('Jan Novák: 2. svazek');
        expect(strings.focus.unionOrdinal(2)).toBe('2.');
        setLanguage('de');
        expect(strings.focus.unionOrderTip(2, '1885', '', true, 'Jan Novák')).toBe('2. Ehe von Jan Novák, 1885');
    });
});

describe('the image export draws the pills', () => {
    it('whole, without a shadow, on the partners only', () => {
        setLanguage('cs');
        const data = family();
        const result = layout(data, 'H', true);
        const svg = buildTreeSvg(data, result);
        const pills = [...svg.matchAll(/<g class="union-order-pill" data-union-order="(\d+)" data-person="([^"]+)"[^>]*>(.*?)<\/g>/g)];
        expect(pills.map(m => `${m[2]}:${m[1]}`).sort()).toEqual(['W1:1', 'W2:3', 'W3:2']);
        const w1 = pills.find(m => m[2] === 'W1')![3];
        expect(w1).toContain('>1.</text>');
        expect(w1).toContain('>∞</text>');
        expect(w1).toContain('>1866</text>');
        expect(w1).toContain('height="17" rx="8.5"');
        expect(svg).not.toMatch(/filter|drop-shadow/);
        // On the card's top edge: the pill's top 9px above the card's top.
        const card = result.positions.get(P('W1'))!;
        const y = Number(/<rect x="[^"]+" y="([^"]+)"/.exec(w1)![1]);
        expect(y).toBeCloseTo(card.y - 9 + 0.5, 1);
    });

    it('a pill without a date reads "1. ∞"; the numbers stay the unfiltered data\'s', () => {
        setLanguage('cs');
        const data = family();
        const result = layout(data, 'H', true);
        // A privacy-filtered copy without the 1866 date: the number still says 1.
        const filtered = structuredClone(data);
        delete filtered.partnerships['u1' as PartnershipId].startDate;
        const svg = buildTreeSvg(filtered, result, { orderData: data });
        const w1 = /<g class="union-order-pill" data-union-order="1" data-person="W1"[^>]*>(.*?)<\/g>/.exec(svg)![1];
        expect(w1).toContain('>1.</text>');
        expect(w1).not.toContain('1866');
        expect(svg).toContain('data-union-order="2" data-person="W3"');
    });

    it('a dimmed (context-only) card dims its pill too, without a group of its own', () => {
        const data = family();
        const result = layout(data, 'H', true);
        const plain = buildTreeSvg(data, result);
        const svg = buildTreeSvg(data, result, { dimmedIds: new Set(['W2']) });
        expect(svg).toMatch(/<g class="union-order-pill" data-union-order="3" data-person="W2" data-toward="H" opacity="0.5">/);
        expect(svg).toMatch(/<g class="union-order-pill" data-union-order="1" data-person="W1" data-toward="H">/);
        // One dimming group per dimmed card, as without the pills.
        expect((svg.match(/<g opacity="0.5">/g) || []).length).toBe(1);
        // The cards keep their own rect (rx 8); the pills are rx 8.5.
        expect((plain.match(/rx="8" fill="#fffdf8"/g) || []).length).toBe(result.positions.size);
    });

    it('draws the pill at the measured width and lays it out as the screen does (above the edge on a narrow card)', () => {
        setLanguage('cs');
        const data = family();
        const config = { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 };
        const result = runLayoutPipeline({
            data, focusPersonId: P('H'), config, ancestorDepth: 3, descendantDepth: 3,
            includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand: true },
        });
        const measure = () => ({ width: 64.25, numX: 8, glyphX: 22, yearX: 30 });
        const svg = buildTreeSvg(data, result, { config, cardDensity: 'compact', measureUnionOrderPill: measure });
        const w1 = /<g class="union-order-pill" data-union-order="1" data-person="W1"[^>]*>(.*?)<\/g>/.exec(svg)![1];
        const [, x, y, w] = /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)"/.exec(w1)!.map(Number);
        expect(w).toBeCloseTo(63.25, 2);
        const card = result.positions.get(P('W1'))!;
        const hx = result.positions.get(P('H'))!.x;
        // 13 + 64.25 does not fit in the half of 150 (71): above the edge, in the half toward H.
        expect(y).toBeCloseTo(card.y - 29 + 0.5, 1);
        if (hx < card.x) expect(x - 0.5 + 64.25).toBeLessThanOrEqual(card.x + 75 - 4 + 0.01);
        else expect(x - 0.5).toBeGreaterThanOrEqual(card.x + 75 + 4 - 0.01);
        expect(w1).toContain('<text x="' + (x - 0.5 + 22).toFixed(2) + '"');
    });

    it('a pill wider than its half of a narrow card (a wide font) draws the shorter label the screen shows, off the middle', () => {
        const data = family();
        const config = { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 };
        const result = runLayoutPipeline({
            data, focusPersonId: P('H'), config, ancestorDepth: 3, descendantDepth: 3,
            includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand: true },
        });
        // A wide font: "1st ∞ 1866" 78px (the half holds 71), "1st ∞" 44px, "1st" 30px.
        const measure = (_o: string, year: string, glyph = true) => !glyph ? { width: 30, numX: 8, glyphX: 0, yearX: 0 }
            : year ? { width: 78, numX: 8, glyphX: 30, yearX: 40 } : { width: 44, numX: 8, glyphX: 30, yearX: 0 };
        const svg = buildTreeSvg(data, result, { config, cardDensity: 'compact', measureUnionOrderPill: measure });
        const m = /<g class="union-order-pill" data-union-order="1" data-person="W1"([^>]*)>(.*?)<\/g>/.exec(svg)!;
        expect(m[1]).toContain('data-label="noYear"');
        expect(m[2]).toContain('>1st</text>');
        expect(m[2]).toContain('>∞</text>');
        expect(m[2]).not.toContain('1866');
        const [, x, , w] = /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)"/.exec(m[2])!.map(Number);
        expect(w).toBeCloseTo(43, 2);
        const card = result.positions.get(P('W1'))!;
        const left = x - 0.5, right = left + 44, mid = card.x + 75;
        expect(right <= mid - 4 + 0.01 || left >= mid + 4 - 0.01).toBe(true);
    });
});
