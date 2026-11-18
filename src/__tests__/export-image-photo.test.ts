/**
 * The photo on the card in the image export, the poster and its PDF (spec
 * 096 P2): the cards drawn with the view's photo size and shape as on
 * screen, and the default (small + circle) drawn exactly as before.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildTreeSvg, PosterLayout, PosterOptions, ROUNDED_AVATAR_RADIUS } from '../export-image.js';
import {
    StromData, Person, PersonId, PartnershipId, Position, DEFAULT_LAYOUT_CONFIG, LayoutConfig, CardPhotoSize, CardPhotoShape, NORMAL_PHOTO_BOX,
} from '../types.js';
import { MeasureTexts, normalCardHeights, normalCardTextWidth, cardAvatarSize } from '../card-width.js';
import { cardLines, DEFAULT_CARD_FIELDS } from '../card-fields.js';

/** A photo (a 1 × 1 PNG data URI). */
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: 'Florimund', lastName: 'Pfefferkorn', gender: 'male',
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
    return { positions: map, connections: [], spouseLines: [], omittedEdges: [] };
}

/** Every text a fixed 7px a character (the 126px column holds 18). */
const measure: MeasureTexts = (_kind, texts) => new Map([...texts].map(t => [t, t.length * 7]));

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A view of Normal cards: with and without a photo, a placeholder, a long name, a birth surname, an unknown sex. */
const normalPeople = [
    person('a', { photo: PHOTO, birthDate: '1850', deathDate: '1910', birthPlace: 'Lindenau' }),
    person('b', { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female', birthDate: '1855' }),
    person('c', { isPlaceholder: true, firstName: '', lastName: '' }),
    person('d', { photo: PHOTO, firstName: 'Bartoloměj Kryštof Maximilián', lastName: 'Wolfensteiner-Hohenbrandt', birthDate: '1888', deathDate: '1950' }),
    person('e', { photo: PHOTO, gender: 'female', firstName: 'Bartolomějka', lastName: 'Lindenthalová', marriedSurname: 'Wolfensteinerová' }),
    person('f', { photo: PHOTO, gender: 'unknown', firstName: 'Kasimir', lastName: 'Pfefferkorn' }),
];
const normalPositions = {
    a: { x: 0, y: 0 }, b: { x: 260, y: 0 }, c: { x: 520, y: 0 },
    d: { x: 0, y: 200 }, e: { x: 260, y: 200 }, f: { x: 520, y: 200 },
};

function normalHeights(): Map<PersonId, number> {
    const names = new Map(normalPeople.map(p => [p.id, { given: p.firstName, surname: p.lastName, avatar: !p.isPlaceholder }]));
    return normalCardHeights(names, measure) ?? new Map();
}

function normalSvg(extra: Partial<PosterOptions> = {}, config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, personHeights: normalHeights() }): string {
    return buildTreeSvg(makeData(...normalPeople), layout(normalPositions), {
        config, cardDensity: 'normal', measureCardTexts: measure,
        deceasedSet: new Set(['a', 'd']), branchMap: new Map([['a', { paternal: true as const }]]),
        cardMarks: new Map([['f', { status: 'cs-p2' }]]),
        ...extra,
    });
}

/** A view of custom cards (the default details) with and without a photo. */
const customPeople = [
    person('a', { photo: PHOTO, birthDate: '1850', birthPlace: 'Lindenau', deathDate: '1910' }),
    person('b', { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female', birthDate: '1855' }),
    person('d', { photo: PHOTO, firstName: 'Bartoloměj Kryštof Maximilián', lastName: 'Wolfensteiner-Hohenbrandt', birthDate: '1888' }),
];

function customSvg(extra: Partial<PosterOptions> = {}, years = false, cardHeight = 140, people = customPeople): string {
    const data = makeData(...people);
    return buildTreeSvg(data, layout(Object.fromEntries(people.map((p, i) => [p.id, { x: 300 * i, y: 0 }]))), {
        config: { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 240, cardHeight },
        cardLines: new Map(customPeople.map(p => [p.id as string, cardLines(p, data, DEFAULT_CARD_FIELDS)])),
        cardDateColumn: 60, cardValueLines: 0, measureCardTexts: measure,
        ...(years ? { cardYears: new Map(people.map(p => [p.id as string, '1850 – 1910'])) } : {}),
        ...extra,
    });
}

describe('the default photo (small + circle): the image as before', () => {
    // The images of these views as the export drew them before the photo's size and shape reached it
    // (Normal: since 1118 a name fits one line as the screen does, 15 → 14 → 13px measured, then two rows).
    const BEFORE = { normal: '9bbf28d0e1812189', custom: 'f365ec70c3ea607a', customYears: '1c3abca8a9313cd9' };

    // The lineage stripe got the P2 colour and names its line (spec 112): taken back to the old form, the rest is unchanged.
    const oldStripe = (svg: string) => svg.replace('<path class="branch-stripe" data-branch="paternal" ', '<path class="branch-stripe" ')
        .replace('fill="#234e8c"', 'fill="#d08a5a"');

    it('Normal cards', () => {
        expect(sha(oldStripe(normalSvg()))).toBe(BEFORE.normal);
    });

    it('cards of details, with and without the years', () => {
        expect(sha(customSvg())).toBe(BEFORE.custom);
        expect(sha(customSvg({}, true))).toBe(BEFORE.customYears);
    });
});

/**
 * The Normal cards' heights in a view of a photo size, as the screen lays
 * them out (renderer.ts normalNameColumn): every card with an avatar, a
 * photo or the initials, at the view's size (spec 103 K2.1).
 */
function heightsFor(view: CardPhotoSize): Map<PersonId, number> {
    const names = new Map(normalPeople.map(p => {
        const avatar = !p.isPlaceholder;
        return [p.id, view === 'small' ? { given: p.firstName, surname: p.lastName, avatar }
            : { given: p.firstName, surname: p.lastName, avatar, textWidth: normalCardTextWidth(view, avatar), ...(avatar ? { photo: view } : {}) }];
    }));
    return normalCardHeights(names, measure) ?? new Map();
}

function normalView(size: CardPhotoSize, shape: CardPhotoShape, extra: Partial<PosterOptions> = {}): { svg: string; config: LayoutConfig } {
    const config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, cardWidth: NORMAL_PHOTO_BOX[size].cardWidth, personHeights: heightsFor(size) };
    return { svg: normalSvg({ cardPhoto: { size, shape }, ...extra }, config), config };
}

/** The image of each card and the clip and ring drawn with it. */
const images = (svg: string) => [...svg.matchAll(/<image href="[^"]*" x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
const cardRects = (svg: string) => [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
const texts = (svg: string) => [...svg.matchAll(/<text (?:class="[^"]*" )?x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([^<]*)</g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));

/** Every image, avatar and text inside the card it belongs to (the card whose rect holds its point). */
function allInsideCards(svg: string): boolean {
    const rects = cardRects(svg);
    const inside = (x: number, y: number) => rects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    const boxInside = (x: number, y: number, w: number, h: number) =>
        rects.some(r => x >= r.x && x + w <= r.x + r.w && y >= r.y && y + h <= r.y + r.h);
    return images(svg).every(i => boxInside(i.x, i.y, i.w, i.h)) && texts(svg).every(t => inside(t.x, t.y));
}

const SIZES: CardPhotoSize[] = ['small', 'medium', 'large'];
const SHAPES: CardPhotoShape[] = ['circle', 'rounded'];

describe('Normal cards with the view\'s photo (spec 096 §2)', () => {
    it('small + circle given explicitly: the image as before', () => {
        expect(sha(normalView('small', 'circle').svg)).toBe(sha(normalSvg()));
    });

    for (const size of SIZES) for (const shape of SHAPES) {
        it(`${size} + ${shape}: the box, the photo's size and place, everything inside its card`, () => {
            const { svg, config } = normalView(size, shape);
            const box = NORMAL_PHOTO_BOX[size];
            const rects = cardRects(svg);
            expect(rects.every(r => r.w === box.cardWidth)).toBe(true);
            // The cards with an avatar (a, d, e, f with a photo, b with the initials) as tall as
            // laid out: a large one at least 96 (spec 103 K2.1); the placeholder (c) 64.
            for (const id of ['a', 'b', 'd', 'e', 'f']) {
                const pos = normalPositions[id as keyof typeof normalPositions];
                const rect = rects.find(r => r.x === pos.x && r.y === pos.y)!;
                expect(rect.h).toBe(config.personHeights?.get(id as PersonId) ?? 64);
                if (size === 'large') expect(rect.h).toBeGreaterThanOrEqual(96);
            }
            const imgs = images(svg);
            expect(imgs).toHaveLength(4);
            for (const img of imgs) {
                expect(img.w).toBe(box.avatar);
                // At the card's padding of that box, centred on the card's height.
                expect(img.x % 260).toBeCloseTo(1 + box.padX, 1);
            }
            // The ring follows the shape: a circle, or a rounded square of the size's radius.
            if (shape === 'circle') {
                expect(svg).not.toMatch(/<rect x="[^"]+" y="[^"]+" width="(34|48|80)"/);
                expect(svg).toContain(`r="${box.avatar / 2}" fill="none"`);
                // Quirinella's initials (no photo): the photo's size (spec 103 K2.1).
                expect(svg).toContain(`r="${box.avatar / 2}" fill="#f0e9da"`);
            } else {
                expect(svg).toContain(`width="${box.avatar}" height="${box.avatar}" rx="${ROUNDED_AVATAR_RADIUS[box.avatar]}" fill="none"`);
                // Quirinella's initials: the photo's size and radius.
                expect(svg).toContain(`width="${box.avatar}" height="${box.avatar}" rx="${ROUNDED_AVATAR_RADIUS[box.avatar]}" fill="#f0e9da"`);
                expect(svg).not.toMatch(/<circle[^>]* r="(17|24|40)"/);
            }
            expect(allInsideCards(svg)).toBe(true);
        });
    }

    it('the text column beside the avatar stays 125px; the initials of a card without a photo take the photo\'s size (spec 103 K2.1)', () => {
        for (const size of SIZES) {
            const { svg, config } = normalView(size, 'circle');
            const box = NORMAL_PHOTO_BOX[size];
            const contentX = 1 + box.padX + box.avatar + 9;
            const column = (x: number) => x + contentX + (box.cardWidth - contentX - 1 - box.padX) / 2;
            expect(box.cardWidth - contentX - 1 - box.padX).toBe(125);
            // Florimund (a photo, at x 0): the name (on its two rows) centred in the column right of the photo.
            expect(texts(svg).find(t => t.text === 'Florimund')!.x).toBeCloseTo(column(0), 1);
            // Quirinella (no photo, at x 260): her initials as large and as placed as a photo, in the
            // middle of her card's height, the same column after them; their text in proportion.
            const h = config.personHeights?.get('b' as PersonId) ?? 64;
            const r = box.avatar / 2;
            expect(svg).toMatch(new RegExp(`<circle cx="${(260 + 1 + box.padX + r).toFixed(1)}" cy="${(h / 2).toFixed(1)}" r="${r}" fill="#f0e9da"`));
            const initials = size === 'small' ? 12 : size === 'medium' ? 17 : 29;
            expect(svg).toMatch(new RegExp(`<text x="${(260 + 1 + box.padX + r).toFixed(1)}" y="[\\d.]+" text-anchor="middle" font-size="${initials}" font-weight="600" fill="[^"]+">QP</text>`));
            expect(texts(svg).find(t => t.text === 'Quirinella')!.x).toBeCloseTo(column(260), 1);
            if (size === 'large') expect(h).toBe(96);
        }
    });

    it('large: a short name stands on y = 28 as on the 64px card beside it; a long name from y = 15 down beside the photo', () => {
        const { svg } = normalView('large', 'circle');
        // Kasimir (at y 200) on one line.
        expect(texts(svg).find(t => t.text === 'Kasimir Pfefferkorn')!.y).toBe(228);
        // Bartoloměj (at y 200) on rows of 12.5px: the first row's baseline 15 + 10.9 below the card's top.
        const rows = [...svg.matchAll(/<text class="card-name-row" x="[\d.]+" y="([\d.]+)"/g)].map(m => Number(m[1]) - 200).filter(y => y > 0 && y < 120);
        expect(rows.length).toBeGreaterThan(2);
        expect(rows[0]).toBeCloseTo(15 + 10.9, 1);
        // The photo in the middle of the card's height.
        const photo = images(svg).find(i => i.y > 150 && i.x < 100)!;
        const h = heightsFor('large').get('d' as PersonId) ?? 96;
        expect(photo.y + 40).toBeCloseTo(200 + h / 2, 1);
    });

    it('a photo taken away by a living-privacy mode: the card keeps the box it was laid out with, the initials in the photo\'s place', () => {
        const config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, cardWidth: 236, personHeights: heightsFor('large') };
        const people = normalPeople.map(p => p.id === 'a' ? { ...p, photo: undefined } : p);
        const svg = buildTreeSvg(makeData(...people), layout(normalPositions), {
            config, cardDensity: 'normal', measureCardTexts: measure,
            cardPhoto: { size: 'large', shape: 'rounded', photoIds: new Set(['a', 'd', 'e', 'f']) },
        });
        expect(images(svg)).toHaveLength(3);
        // Florimund's initials in the 80px rounded square at the large box's padding.
        expect(svg).toContain('<rect x="11.0" y="8.0" width="80" height="80" rx="12" fill="#f0e9da"');
        expect(allInsideCards(svg)).toBe(true);
    });
});

describe('cards of details with the view\'s photo (spec 096 §3)', () => {
    // As tall as the large photo's header and the lines under it (98 + 17 a row, the long name's rows beside the photo).
    const custom = (size: CardPhotoSize, shape: CardPhotoShape, years = false, people = customPeople) =>
        customSvg(size === 'small' ? {} : { cardPhoto: { size, shape } }, years, size === 'small' ? 140 : 200, people);

    it('small + circle given explicitly: the image as before', () => {
        expect(sha(customSvg({ cardPhoto: { size: 'small', shape: 'circle' } }))).toBe(sha(customSvg()));
        expect(sha(customSvg({ cardPhoto: { size: 'small', shape: 'circle' } }, true))).toBe(sha(customSvg({}, true)));
    });

    for (const size of SIZES) for (const shape of SHAPES) {
        it(`${size} + ${shape}: the photo at the header's top left, the name beside it, the lines under the header`, () => {
            for (const years of [false, true]) {
                const svg = size === 'small' ? customSvg({ cardPhoto: { size, shape } }, years) : custom(size, shape, years);
                const avatar = cardAvatarSize(size === 'small' ? null : size);
                const imgs = images(svg);
                expect(imgs).toHaveLength(2);
                for (const img of imgs) {
                    expect(img.w).toBe(avatar);
                    expect(img.x % 300).toBeCloseTo(12, 1);
                    if (size !== 'small') expect(img.y).toBeCloseTo(10, 1);
                }
                // Florimund's name right of the photo, his first line under the header.
                const name = texts(svg).find(t => t.text.startsWith('Florimund'))!;
                expect(name.x).toBeCloseTo(12 + avatar + 8, 1);
                const lines = texts(svg).filter(t => t.x < 300 && /1850|1910/.test(t.text) && t.text !== '1850 – 1910');
                expect(Math.min(...lines.map(l => l.y))).toBeGreaterThan(10 + avatar);
                // Quirinella, without a photo: her initials as large as the photo beside the name (spec 103 K2.1).
                expect(svg).toContain(shape === 'rounded' ? `width="${avatar}" height="${avatar}" rx="${ROUNDED_AVATAR_RADIUS[avatar]}" fill="#f0e9da"`
                    : `r="${avatar / 2}" fill="#f0e9da"`);
                expect(texts(svg).find(t => t.text.startsWith('Quirinella'))!.x).toBeCloseTo(300 + 12 + avatar + 8, 1);
                if (shape === 'rounded' && size !== 'small') {
                    expect(svg).toContain(`width="${avatar}" height="${avatar}" rx="${ROUNDED_AVATAR_RADIUS[avatar]}" fill="none" stroke="#5b7f9e" stroke-width="2"`);
                }
                expect(allInsideCards(svg)).toBe(true);
            }
        });
    }

    it('the name beside a medium or large photo stands where it stands beside the small avatar (D13)', () => {
        const short = [person('a', { photo: PHOTO, firstName: 'Ivo', lastName: 'Lind', birthDate: '1850' })];
        for (const years of [false, true]) {
            const nameY = (svg: string) => texts(svg).find(t => t.text === 'Ivo Lind')!.y;
            const small = nameY(custom('small', 'circle', years, short));
            expect(nameY(custom('medium', 'circle', years, short))).toBe(small);
            expect(nameY(custom('large', 'rounded', years, short))).toBe(small);
        }
    });
});
