/**
 * Poster SVG builder tests (pure string output; no DOM).
 */

import { describe, it, expect } from 'vitest';
import { buildTreeSvg, computeBounds, PosterLayout, fitCompactName, COMPACT_NAME_MIN_SQUEEZE } from '../export-image.js';
import { StromData, Person, PersonId, PartnershipId, Position, DEFAULT_LAYOUT_CONFIG } from '../types.js';
import { MeasureTexts, normalCardHeights, cardNameMaxRows } from '../card-width.js';
import type { CardValueLines } from '../card-fields.js';

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

    it('an only adopted child gets a fully dashed line; with a biological sibling only its drop is dashed (T03)', () => {
        const linesOf = (svg: string) => svg.split('class="connections"')[1].split('</g>')[0].match(/<line [^>]*>/g) ?? [];
        // Stem 65→80, connector 65→265 (stem outside the bus), bus 265→465, two drops.
        const twoKids = (kids: string[]): PosterLayout => {
            const l = layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 }, c: { x: 400, y: 300 } });
            l.connections = [{
                unionId: 'u1' as never,
                stemX: 65, stemTopY: 64, stemBottomY: 80,
                branchY: 100, branchLeftX: 265, branchRightX: kids.length > 1 ? 465 : 265,
                connectorFromX: 65, connectorToX: 265, connectorY: 80,
                drops: kids.map((id, i) => ({ personId: id as PersonId, x: 265 + i * 200, topY: 100, bottomY: 300 })),
            }];
            return l;
        };

        const only = makeData(person('a'), person('b', { parentRelTypes: { a: 'adoptive' } as never }));
        const onlyLines = linesOf(buildTreeSvg(only, twoKids(['b'])));
        expect(onlyLines.length).toBe(4); // stem, connector, junction, drop
        for (const l of onlyLines) expect(l).toContain('stroke-dasharray="6,4"');

        const mixed = makeData(person('a'), person('b', { parentRelTypes: { a: 'adoptive' } as never }), person('c'));
        const mixedLines = linesOf(buildTreeSvg(mixed, twoKids(['b', 'c'])));
        expect(mixedLines.length).toBe(6); // stem, connector, junction, bus, 2 drops
        expect(mixedLines.filter(l => l.includes('stroke-dasharray')).length).toBe(1);
        expect(mixedLines.find(l => l.includes('stroke-dasharray'))).toContain('x1="265.0"');
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
        // Each part fits a row of its own, the whole is too long for one line: shrunk and clamped (two rows at most).
        const data = makeData(person('a', { firstName: 'Maximilian', lastName: 'Wolfensteiner' } as never));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
        expect(svg).not.toContain('font-size="15" font-weight="600" fill="#2b2822">Maximilian Wolfensteiner');
    });

    it('a name too long for two rows goes on more rows, never squeezed past reading (T40)', () => {
        const data = makeData(person('a', { firstName: 'Maximilian Alexander Wolfgang Amadeus' } as never));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }));
        const rows = [...svg.matchAll(/<text class="card-name-row"[^>]*>([^<]*)</g)].map(m => m[1]);
        expect(rows.length).toBeGreaterThan(2);
        expect(rows.join(' ')).toBe('Maximilian Alexander Wolfgang Amadeus Novák');
        expect(svg).not.toContain('textLength');
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

describe('branch stripe (T06)', () => {
    it('runs into the card\'s rounded corners instead of being an inset bar', () => {
        const data = makeData(person('a'));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 } }), { branchMap: new Map([['a', 'paternal']]) });
        const stripe = /<path class="branch-stripe" d="([^"]+)" fill="#d08a5a"\/>/.exec(svg);
        expect(stripe).not.toBeNull();
        const d = stripe![1];
        // Two corner arcs on the card's own radius (8, +0.5 for the outer edge of the border)...
        expect(d.match(/A8\.5 8\.5 0 0 0/g)?.length).toBe(2);
        // ...spanning the full card height from the outer border edge (card box 64px high).
        const ys = [...d.matchAll(/(-?\d+\.\d+) (-?\d+\.\d+)/g)].map(m => Number(m[2]));
        expect(Math.min(...ys)).toBeLessThan(1);
        expect(Math.max(...ys)).toBeGreaterThan(63);
    });
});

describe('cards by content (U02 V3)', () => {
    // Custom cards 240 wide: a 140px card, a 73px one, and one without its own height (the view's 100).
    const config = {
        ...DEFAULT_LAYOUT_CONFIG, cardWidth: 240, cardHeight: 100,
        personHeights: new Map([['a' as PersonId, 140], ['b' as PersonId, 73]]),
    };

    it('the bounds take each card\'s own height', () => {
        const l = layout({ a: { x: 0, y: 0 }, b: { x: 300, y: 300 }, c: { x: 600, y: 300 } });
        expect(computeBounds(l, config)).toMatchObject({ maxY: 400, height: 400 });
        expect(computeBounds(layout({ a: { x: 0, y: 0 }, b: { x: 300, y: 300 } }), config)).toMatchObject({ maxY: 373 });
    });

    it('every card rect and its branch stripe are as tall as that person\'s card', () => {
        const data = makeData(person('a'), person('b', { gender: 'female' }), person('c'));
        const svg = buildTreeSvg(data, layout({ a: { x: 0, y: 0 }, b: { x: 300, y: 300 }, c: { x: 600, y: 300 } }), {
            config, branchMap: new Map([['a', 'paternal'], ['b', 'maternal'], ['c', 'paternal']]),
        });
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
            .map(m => [Number(m[1]), Number(m[4])]);
        expect(rects).toEqual([[0, 140], [300, 73], [600, 100]]);
        const stripes = [...svg.matchAll(/<path class="branch-stripe" d="([^"]+)"/g)].map(m => {
            // The path's points: after M, L and each arc's flags.
            const ys = [...m[1].matchAll(/(?:M|L|0 0 0 )(-?[\d.]+) (-?[\d.]+)/g)].map(p => Number(p[2]));
            return Math.max(...ys) - Math.min(...ys);
        });
        // From the outer edge of the border (1px taller than the card), its inner edge 1px into each corner arc.
        expect(stripes).toEqual([140 - 1, 73 - 1, 100 - 1]);
    });

    it('a partner line splits only around a card it really crosses, by that card\'s height', () => {
        const data = makeData(person('a'), person('b'), person('c'));
        // Line at y 32 from a (x 0) to c (x 600) over b at x 300: b's short card spans 0..73.
        const base = layout({ a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 600, y: 0 } });
        const l = { ...base, spouseLines: [{ ...base.spouseLines[0], y: 120, xMin: 240, xMax: 600 }] };
        const spouse = (svg: string) => (svg.split('class="spouse-lines"')[1].split('</g>')[0].match(/<line /g) ?? []).length;
        // At 120 the line passes under b's 73px card: one piece; a card of the view's 140 would split it.
        expect(spouse(buildTreeSvg(data, l, { config }))).toBe(1);
        expect(spouse(buildTreeSvg(data, l, { config: { ...config, personHeights: new Map([['b' as PersonId, 140]]) } }))).toBe(2);
    });
});

describe('card densities (N16): each drawn at the layout\'s card size, in its own look', () => {
    /** Every <text>'s x, y and font size. */
    const texts = (svg: string) => [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)</g)]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), text: m[4] }));

    it('compact: a 150x44 card with the name only, centred, no avatar', () => {
        const data = makeData(person('a', { birthDate: '1880', birthPlace: 'Brno' }));
        const svg = buildTreeSvg(data, layout({ a: { x: 100, y: 50 } }), {
            config: { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 }, cardDensity: 'compact',
        });
        expect(svg).toContain('<rect x="100.0" y="50.0" width="150" height="44" rx="8"');
        expect(svg).not.toContain('<circle');
        expect(svg).not.toContain('1880');
        expect(texts(svg)).toEqual([{ x: 175, y: 76.5, size: 13, text: 'Jan Novák' }]);
    });

    it('normal stays the 188x64 card with the 34px avatar', () => {
        const svg = buildTreeSvg(makeData(person('a')), layout({ a: { x: 0, y: 0 } }), { cardDensity: 'normal' });
        expect(svg).toContain('width="188" height="64" rx="8"');
        expect(svg).toMatch(/<circle [^>]*r="17"/);
    });
});

describe('the card corner in the image (spec 066 P4 §7)', () => {
    const data = makeData(person('a', { birthDate: '1900', deathDate: '1970', birthPlace: 'Lipany' }), person('b', { gender: 'female' }));
    const l = layout({ a: { x: 0, y: 0 }, b: { x: 200, y: 300 } });
    const markBox = (svg: string) => {
        const m = /<g class="card-status-mark" data-status="([a-z0-9-]+)"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
        return m ? { cls: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] } : null;
    };

    it('no marks without cardMarks (the family book\'s tree page, a switch off)', () => {
        const svg = buildTreeSvg(data, l);
        expect(svg).not.toContain('card-status-mark');
        expect(svg).not.toContain('card-story');
    });

    it('the status mark sits in the bottom-right corner, 15px in beside the fold, 5px without', () => {
        const withFold = buildTreeSvg(data, l, { cardMarks: new Map([['a', { status: 'cs-p2', story: { kind: 'own', final: true } }]]) });
        const m = markBox(withFold)!;
        expect(m.cls).toBe('cs-p2');
        // Card a: 188x64 at (0,0); the 20px pill ends 1 + 15px inside the right edge, 1 + 4px above the bottom.
        expect(m.x + m.w + 0.5).toBeCloseTo(188.5 - 1 - 15, 1);
        expect(m.y + m.h + 0.5).toBeCloseTo(64.5 - 1 - 4, 1);
        expect(withFold).toContain('<g class="card-story">');
        // Two full dots.
        expect(withFold.match(/<circle [^>]*r="2" fill="#5c5546"/g)).toHaveLength(2);
        const alone = markBox(buildTreeSvg(data, l, { cardMarks: new Map([['a', { status: 'cs-p2' }]]) }))!;
        expect(alone.x + alone.w + 0.5).toBeCloseTo(188.5 - 1 - 5, 1);
    });

    it('each step draws its own shape: ✓, ●○, ○, ○○ dashed, an empty dotted frame', () => {
        const svgOf = (cls: 'cs-human' | 'cs-p1' | 'cs-res' | 'cs-import' | 'cs-none') =>
            buildTreeSvg(data, l, { cardMarks: new Map([['a', { status: cls }]]) });
        expect(svgOf('cs-human')).toContain('>✓</text>');
        expect(svgOf('cs-p1').match(/r="2" fill="none"/g)).toHaveLength(1);
        expect(svgOf('cs-res').match(/r="2" fill="none"/g)).toHaveLength(1);
        expect(svgOf('cs-import')).toContain('stroke-dasharray="3,2"');
        expect(svgOf('cs-import').match(/r="2" fill="none"/g)).toHaveLength(2);
        const none = svgOf('cs-none');
        expect(none).toContain('stroke-dasharray="1,1.5"');
        expect(none).not.toMatch(/r="2"/);
    });

    it('a couple\'s story or a draft: a hollow fold; a placeholder draws no mark', () => {
        const svg = buildTreeSvg(makeData(person('a'), person('b', { isPlaceholder: true })), l, {
            cardMarks: new Map([['a', { story: { kind: 'couple', final: true } }], ['b', { status: 'cs-none' }]]),
        });
        expect(svg).toContain('<g class="card-story hollow">');
        expect(svg).not.toContain('card-status-mark');
    });

    it('the last row ends before the mark (the screen\'s 28px), the name of a compact card before its 36px', () => {
        const meta = (svg: string) => /<text x="([\d.]+)" y="45.0"[^>]*textLength="(\d+)"|<text x="([\d.]+)" y="45.0"/.exec(svg);
        const plain = meta(buildTreeSvg(data, l))!;
        const marked = meta(buildTreeSvg(data, l, { cardMarks: new Map([['a', { status: 'cs-p2' }]]) }))!;
        // The row's centre moves 14px left (its room 28px narrower).
        expect(+(plain[1] ?? plain[3]) - +(marked[1] ?? marked[3])).toBeCloseTo(14, 1);
        const compact = { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 };
        const nameX = (svg: string) => +/<text x="([\d.]+)" y="26.5"/.exec(svg)![1];
        const a = nameX(buildTreeSvg(data, l, { config: compact, cardDensity: 'compact' }));
        const b = nameX(buildTreeSvg(data, l, { config: compact, cardDensity: 'compact', cardMarks: new Map([['a', { status: 'cs-p2' }]]) }));
        expect(a - b).toBeCloseTo(13, 1);
    });
});

describe('a long name on the card is never shortened in the image (T40)', () => {
    /** Every text a fixed 7px a character (the 126px column holds 18). */
    const measure: MeasureTexts = (_kind, texts) => new Map([...texts].map(t => [t, t.length * 7]));
    const long = person('a', { firstName: 'Bartoloměj Kryštof Maximilián', lastName: 'Wolfensteiner-Hohenbrandt', birthDate: '1888', deathDate: '1950' });
    const word = person('a', { firstName: 'Ondřej', lastName: 'Wolfensteinerhohenbrandtovský' });
    const rows = (svg: string) => [...svg.matchAll(/<text class="card-name-row"[^>]*>([^<]*)</g)].map(m => m[1]);
    const rectH = (svg: string) => Number(/<rect x="[\d.-]+" y="[\d.-]+" width="\d+" height="(\d+)" rx="8"/.exec(svg)![1]);
    const heightOf = (p: Person) => normalCardHeights(new Map([['a', { given: p.firstName, surname: p.lastName, avatar: true }]]), measure)?.get('a');

    it('normal: the name on as many rows as it needs, whole, the card as tall as the screen laid it out', () => {
        const h = heightOf(long)!;
        expect(h).toBeGreaterThan(64);
        const config = { ...DEFAULT_LAYOUT_CONFIG, personHeights: new Map([['a' as PersonId, h]]) };
        const svg = buildTreeSvg(makeData(long), layout({ a: { x: 0, y: 0 } }), { config, cardDensity: 'normal', measureCardTexts: measure });
        const r = rows(svg);
        expect(r.length).toBeGreaterThan(2);
        expect(r.join(' ').replace('- ', '-')).toBe('Bartoloměj Kryštof Maximilián Wolfensteiner-Hohenbrandt');
        expect(svg).not.toContain('…');
        expect(rectH(svg)).toBe(h);
        // Every row inside the column (drawn at its measured width) and inside the card's height.
        for (const m of svg.matchAll(/<text class="card-name-row"[^>]*y="([\d.]+)"[^>]*textLength="([\d.]+)"/g)) {
            expect(Number(m[2])).toBeLessThanOrEqual(125);
            expect(Number(m[1])).toBeLessThan(h);
        }
        // The years only, under the rows, inside the card.
        const years = /<text x="[\d.]+" y="([\d.]+)"[^>]*>1888 – 1950</.exec(svg)!;
        expect(Number(years[1])).toBeLessThan(h);
    });

    it('normal: one long word without spaces breaks between characters, nothing cut', () => {
        const h = heightOf(word)!;
        const config = { ...DEFAULT_LAYOUT_CONFIG, personHeights: new Map([['a' as PersonId, h]]) };
        const svg = buildTreeSvg(makeData(word), layout({ a: { x: 0, y: 0 } }), { config, cardDensity: 'normal', measureCardTexts: measure });
        const r = rows(svg);
        expect(r.length).toBe(3);
        expect(r.slice(1).join('')).toBe('Wolfensteinerhohenbrandtovský');
        expect(svg).not.toContain('…');
    });

    it('normal: a short name stays the one-line 64px card', () => {
        const svg = buildTreeSvg(makeData(person('a')), layout({ a: { x: 0, y: 0 } }), { cardDensity: 'normal', measureCardTexts: measure });
        expect(rows(svg)).toEqual([]);
        expect(rectH(svg)).toBe(64);
        expect(svg).toMatch(/<text x="[\d.]+" y="28.0"[^>]*>Jan Novák</);
    });

    it('normal with the birth surname: the rows, then "roz.", never "…"', () => {
        const married = person('a', { gender: 'female', firstName: 'Bartolomějka Kryštofa', lastName: 'Lindenthalová', marriedSurname: 'Wolfensteinerová-Hohenbrandtová' });
        const svg = buildTreeSvg(makeData(married), layout({ a: { x: 0, y: 0 } }), { cardDensity: 'normal', measureCardTexts: measure,
            config: { ...DEFAULT_LAYOUT_CONFIG, personHeights: new Map([['a' as PersonId, 79]]) } });
        expect(rows(svg).join(' ')).toContain('Wolfensteinerová-');
        expect(svg).toContain('class="card-birth"');
        expect(svg.split('class="card-birth"')[0]).not.toContain('…');
    });

    it('compact stays one shortened row', () => {
        const svg = buildTreeSvg(makeData(long), layout({ a: { x: 0, y: 0 } }), {
            config: { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 }, cardDensity: 'compact', measureCardTexts: measure,
        });
        expect(rows(svg)).toEqual([]);
        expect(svg.match(/<text /g)).toHaveLength(1);
        // Shortened with "…" inside the 128px room as on the screen, not squeezed (1110).
        expect(svg).toMatch(/font-size="12.5"[^>]*>Bartoloměj Kryšto…<\/text>/);
        expect(svg).not.toContain('textLength');
    });

    it('compact: a long name without spaces (PNG and SVG draw this) is shortened, never squeezed below a readable ratio (1110)', () => {
        const word30 = person('a', { firstName: 'Ivo', lastName: 'Wolkenhammerstrandvoldeckenbergsheim' });
        const draw = (m?: MeasureTexts) => buildTreeSvg(makeData(word30), layout({ a: { x: 0, y: 0 } }), {
            config: { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 150, cardHeight: 44 }, cardDensity: 'compact',
            ...(m ? { measureCardTexts: m } : {}),
        });
        for (const svg of [draw(measure), draw()]) {
            const text = /<text [^>]*>([^<]*)<\/text>/.exec(svg)!;
            expect(text[1].endsWith('…')).toBe(true);
            expect(text[1].startsWith('Ivo Wolkenham')).toBe(true);
            const squeeze = /textLength="([\d.]+)"/.exec(text[0]);
            if (squeeze) {
                const natural = (m => m.get(text[1]) ?? 0)(measure('nameSmall', [text[1]]));
                expect(Number(squeeze[1]) / natural).toBeGreaterThanOrEqual(COMPACT_NAME_MIN_SQUEEZE);
            }
        }
    });

    it('compact: 13px, then 12.5px, then a name a little too wide narrowed whole, then "…"', () => {
        const w = (texts: string[]) => new Map(texts.map(t => [t, t.length * 10]));
        expect(fitCompactName('Jan Novák', 128, w)).toEqual({ text: 'Jan Novák', size: 13, width: 93.6, squeezed: false });
        expect(fitCompactName('Jan Nováková', 121, w)).toEqual({ text: 'Jan Nováková', size: 12.5, width: 120, squeezed: false });
        // 130px in a 120px room: 92% of its width, drawn whole.
        expect(fitCompactName('Jan Novákovsk', 120, w)).toEqual({ text: 'Jan Novákovsk', size: 12.5, width: 120, squeezed: true });
        // 180px in 120px: "…".
        expect(fitCompactName('Jan Novákovský Brn', 120, w)).toEqual({ text: 'Jan Novákov…', size: 12.5, width: 120, squeezed: false });
        // A cut after a space: the space dropped before the "…".
        expect(fitCompactName('Jan Nováko Brn', 120, w).text).toBe('Jan Nováko…');
    });

    it('detailed: the whole name on rows; register and custom keep two rows, the last ending in "…"', () => {
        const draw = (nameRows: CardValueLines) => buildTreeSvg(makeData(long), layout({ a: { x: 0, y: 0 } }), {
            config: { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 200, cardHeight: 120 },
            cardLines: new Map([['a', []]]), cardDateColumn: 0, cardValueLines: 0, measureCardTexts: measure,
            ...(nameRows === 2 ? {} : { cardNameMaxRows: nameRows }),
        });
        const detailed = rows(draw(cardNameMaxRows('detailed')));
        expect(detailed.length).toBeGreaterThan(2);
        expect(detailed.join(' ').replace('- ', '-')).toBe('Bartoloměj Kryštof Maximilián Wolfensteiner-Hohenbrandt');
        const register = rows(draw(cardNameMaxRows('register')));
        expect(register).toHaveLength(2);
        expect(register[1].endsWith('…')).toBe(true);
    });
});
