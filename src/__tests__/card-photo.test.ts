/**
 * The photo on the card (spec 096 §1–§4): the stored choice repaired to
 * small + circle, the Normal card's box per photo size against the CSS, its
 * text column and height, the cards of details' header and height with a
 * medium or large photo, and the default (or a view without a photo) laid
 * out exactly as before. Widths come from a made-up measure. Invented names.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeCardPhoto, CARD_PHOTO_SIZES, CARD_PHOTO_SHAPES, customCardSize, CardLine } from '../card-fields.js';
import {
    MeasureTexts, normalCardHeight, normalCardHeights, normalCardTextWidth, normalCardNameRows,
    NORMAL_CARD_NAME_WIDTH, NORMAL_CARD_NAME_WIDTH_BARE,
    cardAvatarSize, cardHeadBlock, cardLinesTop, customCardHeight, customCardViewHeight, customCardMetrics, customCardRows,
    customCardSpouseLineY, CustomCardEntry, CARD_AVATAR_SIZE, avatarInitialsSize,
} from '../card-width.js';
import { PersonId } from '../types.js';
import { CARD_SIZE, NORMAL_PHOTO_BOX, DEFAULT_LAYOUT_CONFIG, layoutConfigFor } from '../layout-config.js';
import { SettingsManager } from '../settings.js';
import { runLayoutPipeline } from '../layout/pipeline/index.js';
import { loadFixture } from '../layout/__tests__/helpers/loadFixture.js';

let store: Map<string, string>;
beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
});
afterEach(() => vi.unstubAllGlobals());

/** 6px a character at the 12.5px name. */
const measure: MeasureTexts = (_kind, texts) => {
    const out = new Map<string, number>();
    for (const t of texts) out.set(t, Array.from(t).length * 6);
    return out;
};

describe('normalizeCardPhoto', () => {
    it('anything unknown is small and a circle', () => {
        const plain = { size: 'small', shape: 'circle' };
        expect(normalizeCardPhoto(undefined)).toEqual(plain);
        expect(normalizeCardPhoto(null)).toEqual(plain);
        expect(normalizeCardPhoto('large')).toEqual(plain);
        expect(normalizeCardPhoto([])).toEqual(plain);
        expect(normalizeCardPhoto({ size: 'huge', shape: 'star' })).toEqual(plain);
        expect(normalizeCardPhoto({ size: 'large' })).toEqual({ size: 'large', shape: 'circle' });
        expect(normalizeCardPhoto({ shape: 'rounded' })).toEqual({ size: 'small', shape: 'rounded' });
    });

    it('keeps every known size and shape', () => {
        for (const size of CARD_PHOTO_SIZES) for (const shape of CARD_PHOTO_SHAPES) {
            expect(normalizeCardPhoto({ size, shape })).toEqual({ size, shape });
        }
    });

    it('is stored on this device, repaired, small + circle when absent', () => {
        expect(SettingsManager.getCardPhoto()).toEqual({ size: 'small', shape: 'circle' });
        SettingsManager.setCardPhoto({ size: 'medium', shape: 'rounded' });
        expect(SettingsManager.getCardPhoto()).toEqual({ size: 'medium', shape: 'rounded' });
        expect(JSON.parse(store.get('strom-settings') ?? '{}').cardPhoto).toEqual({ size: 'medium', shape: 'rounded' });
        SettingsManager.setCardPhoto({ size: 'x' as never });
        expect(SettingsManager.getCardPhoto()).toEqual({ size: 'small', shape: 'circle' });
    });
});

describe('the Normal card box per photo size', () => {
    afterEach(() => {
        SettingsManager.setCardPhoto({});
        SettingsManager.setCardDensity('normal');
    });

    it('small is the card as it always was', () => {
        expect(NORMAL_PHOTO_BOX.small).toEqual({ ...CARD_SIZE.normal, avatar: 34, padX: 9 });
    });

    it('a view without a photo keeps the small card whatever the choice (D3)', () => {
        SettingsManager.setCardDensity('normal');
        for (const size of CARD_PHOTO_SIZES) {
            SettingsManager.setCardPhoto({ size });
            expect(SettingsManager.getCardSize(false)).toEqual(CARD_SIZE.normal);
            expect(SettingsManager.getCardSize()).toEqual(CARD_SIZE.normal);
        }
    });

    it('a view with a photo: the chosen width, the base height 64 (large cards by their own height)', () => {
        SettingsManager.setCardDensity('normal');
        SettingsManager.setCardPhoto({ size: 'medium' });
        expect(SettingsManager.getCardSize(true)).toEqual({ cardWidth: 200, cardHeight: 64 });
        SettingsManager.setCardPhoto({ size: 'large' });
        expect(SettingsManager.getCardSize(true)).toEqual({ cardWidth: 236, cardHeight: 64 });
        SettingsManager.setCardPhoto({ size: 'small' });
        expect(SettingsManager.getCardSize(true)).toEqual(CARD_SIZE.normal);
        // The Compact card has no photo.
        SettingsManager.setCardPhoto({ size: 'large' });
        SettingsManager.setCardDensity('compact');
        expect(SettingsManager.getCardSize(true)).toEqual(CARD_SIZE.compact);
    });

    it('the text column beside the avatar (a photo or the initials) is 126px in every size (spec 103 K2.1)', () => {
        for (const size of CARD_PHOTO_SIZES) expect(normalCardTextWidth(size, true)).toBe(NORMAL_CARD_NAME_WIDTH);
        expect(normalCardTextWidth('small', false)).toBe(NORMAL_CARD_NAME_WIDTH_BARE);
        expect(normalCardTextWidth('medium', false)).toBe(180);
        expect(normalCardTextWidth('large', false)).toBe(216);
    });

    it('the initials take a size in proportion to the avatar: 12 / 11px as before in the small one', () => {
        expect(avatarInitialsSize(NORMAL_PHOTO_BOX.small.avatar)).toBe(12);
        expect(avatarInitialsSize(cardAvatarSize('small'))).toBe(11);
        expect(avatarInitialsSize(NORMAL_PHOTO_BOX.medium.avatar)).toBe(17);
        expect(avatarInitialsSize(NORMAL_PHOTO_BOX.large.avatar)).toBe(29);
        expect(avatarInitialsSize(cardAvatarSize('medium'))).toBe(16);
        expect(avatarInitialsSize(cardAvatarSize('large'))).toBe(26);
    });

    it('matches the CSS (index.html body[data-card-photo])', () => {
        const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
        /** The declarations of the rule whose selector list starts with `selector`. */
        const rule = (selector: string): string => {
            const at = html.indexOf(selector);
            expect(at, selector).toBeGreaterThan(-1);
            const open = html.indexOf('{', at);
            return html.slice(open + 1, html.indexOf('}', open));
        };
        const px = (decls: string, prop: string): number | undefined => {
            const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([0-9.]+)px`).exec(decls);
            return m ? Number(m[1]) : undefined;
        };
        const pad = (decls: string): number | undefined => {
            const m = /padding:\s*0\s+([0-9.]+)px/.exec(decls);
            return m ? Number(m[1]) : undefined;
        };
        const base = rule('        .person-card {\n');
        expect(px(base, 'width')).toBe(NORMAL_PHOTO_BOX.small.cardWidth);
        expect(px(base, 'height')).toBe(NORMAL_PHOTO_BOX.small.cardHeight);
        expect(pad(base)).toBe(NORMAL_PHOTO_BOX.small.padX);
        expect(px(rule('        .card-avatar {\n'), 'width')).toBe(NORMAL_PHOTO_BOX.small.avatar);
        for (const size of ['medium', 'large'] as const) {
            const box = NORMAL_PHOTO_BOX[size];
            const view = `body[data-card-photo="${size}"]:not([data-card-fields]) #tree-canvas .person-card`;
            expect(px(rule(`${view},`), 'width')).toBe(box.cardWidth);
            // Every card with an avatar, a photo or the initials (spec 103 K2.1).
            const withAvatar = rule(`${view}.has-avatar,`);
            expect(pad(withAvatar)).toBe(box.padX);
            if (size === 'large') expect(px(withAvatar, 'height')).toBe(box.cardHeight);
            expect(pad(rule(`${view}.has-avatar.focused {`))).toBe(box.padX - 1);
            const avatar = rule(`${view}.has-avatar .card-avatar,`);
            expect(px(avatar, 'width')).toBe(box.avatar);
            expect(px(avatar, 'height')).toBe(box.avatar);
            const initials = rule(`body[data-card-photo="${size}"]:not([data-card-fields]) #tree-canvas .has-avatar .avatar-initials {`);
            expect(px(initials, 'font-size')).toBe(avatarInitialsSize(box.avatar));
            const fieldInitials = rule(`body[data-card-fields][data-card-photo="${size}"] #tree-canvas .has-avatar .avatar-initials {`);
            expect(px(fieldInitials, 'font-size')).toBe(avatarInitialsSize(cardAvatarSize(size)));
            // The column: the box less the border, the padding, the photo and the 8px gap.
            expect(box.cardWidth - 2 - 2 * box.padX - box.avatar - 8).toBe(NORMAL_CARD_NAME_WIDTH);
        }
    });
});

describe('the Normal card height with a photo', () => {
    it('small and medium: as before; large: 96 up to four rows of the name, then taller', () => {
        for (let rows = 1; rows <= 7; rows++) {
            expect(normalCardHeight(rows, 'small')).toBe(normalCardHeight(rows));
            expect(normalCardHeight(rows, 'medium')).toBe(normalCardHeight(rows));
        }
        expect(normalCardHeight(2)).toBe(64);
        expect(normalCardHeight(3)).toBe(79);
        for (let rows = 1; rows <= 4; rows++) expect(normalCardHeight(rows, 'large')).toBe(96);
        expect(normalCardHeight(5, 'large')).toBe(110);
        expect(normalCardHeight(6, 'large')).toBe(15 + Math.ceil(6 * 14.375) + 14 + 9);
    });

    it('a large photo makes its card 96px with a short name; cards without one stay 64', () => {
        const heights = normalCardHeights(new Map([
            ['photo', { given: 'Florimund', surname: 'Pfefferkorn', avatar: true, textWidth: 126, photo: 'large' as const }],
            ['plain', { given: 'Florimund', surname: 'Pfefferkorn', avatar: true, textWidth: 174 }],
        ]), measure);
        expect(heights).toEqual(new Map([['photo', 96]]));
        // A medium photo changes no height.
        expect(normalCardHeights(new Map([
            ['photo', { given: 'Florimund', surname: 'Pfefferkorn', avatar: true, textWidth: 126, photo: 'medium' as const }],
        ]), measure)).toBeNull();
    });

    it('a name wraps at the column it is given (the wider column of a card without a photo)', () => {
        // 23 characters: 138px, wider than 126, narrower than 174.
        const given = 'Bonifatius Zebulonius Q';
        const at = (textWidth?: number) =>
            normalCardNameRows([{ given, surname: 'Pfefferkorn', avatar: true, ...(textWidth ? { textWidth } : {}) }], measure)[0].given.length;
        expect(at()).toBe(2);
        expect(at(126)).toBe(2);
        expect(at(174)).toBe(1);
    });
});

describe('the default photo lays the tree out as before', () => {
    const data = loadFixture('comprehensive');
    const focusIds = (Object.keys(data.persons) as PersonId[]).slice(0, 6);
    const layout = (config: typeof DEFAULT_LAYOUT_CONFIG, focusPersonId: PersonId) => {
        const result = runLayoutPipeline({
            data, focusPersonId, config, ancestorDepth: 3, descendantDepth: 3,
            includeSpouseAncestors: true, includeParentSiblings: true, includeParentSiblingDescendants: true,
            displayPolicy: { mode: 'standard', autoExpand: true },
        });
        return [...result.positions].map(([id, p]) => `${id}:${p.x},${p.y}`).sort();
    };

    afterEach(() => SettingsManager.setCardPhoto({}));

    it('small, or no photo in the view: the positions are those of the 188 × 64 card', () => {
        SettingsManager.setCardDensity('normal');
        for (const focus of focusIds) {
            const before = layout(DEFAULT_LAYOUT_CONFIG, focus);
            for (const size of CARD_PHOTO_SIZES) {
                SettingsManager.setCardPhoto({ size, shape: 'rounded' });
                expect(layout({ ...layoutConfigFor('normal'), ...SettingsManager.getCardSize(false) }, focus)).toEqual(before);
            }
            SettingsManager.setCardPhoto({ size: 'small' });
            expect(layout({ ...layoutConfigFor('normal'), ...SettingsManager.getCardSize(true) }, focus)).toEqual(before);
        }
    });
});

describe('the cards of details with a photo (§3)', () => {
    /** A line of a detail with a date and a place. */
    const line = (place: string): CardLine => ({
        key: 'birth', mark: '*', text: `1888 ${place}`, date: '1888', rest: place, more: '', wide: false, place, cause: '',
        label: 'Born', dateLong: false,
    } as unknown as CardLine);

    it('the avatar: 30 (none, small), 44 medium, 72 large', () => {
        expect(cardAvatarSize(null)).toBe(CARD_AVATAR_SIZE);
        expect(cardAvatarSize(undefined)).toBe(30);
        expect(cardAvatarSize('small')).toBe(30);
        expect(cardAvatarSize('medium')).toBe(44);
        expect(cardAvatarSize('large')).toBe(72);
    });

    it('the header: at least the avatar; the years and three rows of the name fit beside the large photo', () => {
        // The default avatar: as before.
        expect(cardHeadBlock(1, false)).toBe(30);
        expect(cardHeadBlock(1, true)).toBe(33);
        expect(cardHeadBlock(2, true)).toBe(52);
        expect(cardHeadBlock(1, true, true)).toBe(47);
        expect(cardHeadBlock(1, false, false, 30)).toBe(30);
        // Medium: the years fit (33 < 44); two rows and the years do not (52).
        expect(cardHeadBlock(1, false, false, 44)).toBe(44);
        expect(cardHeadBlock(1, true, false, 44)).toBe(44);
        expect(cardHeadBlock(2, true, false, 44)).toBe(52);
        // Large: three rows (57) and the years (71) beside 72; four rows grow it.
        expect(cardHeadBlock(1, true, true, 72)).toBe(72);
        expect(cardHeadBlock(3, true, false, 72)).toBe(72);
        expect(cardHeadBlock(4, false, false, 72)).toBe(76);
        expect(cardLinesTop(cardHeadBlock(1, false, false, 44))).toBe(60);
        expect(cardLinesTop(cardHeadBlock(1, false, false, 72))).toBe(88);
    });

    it('the height "equal", one row a detail: 70 + 17n medium, 98 + 17n large (87 / 155 / 115 / 183)', () => {
        expect(customCardSize(1, false, 'medium').cardHeight).toBe(87);
        expect(customCardSize(5, false, 'medium').cardHeight).toBe(155);
        expect(customCardSize(1, false, 'large').cardHeight).toBe(115);
        expect(customCardSize(5, false, 'large').cardHeight).toBe(183);
        // The years fit beside the photo: no taller header.
        expect(customCardSize(5, true, 'medium').cardHeight).toBe(155);
        expect(customCardSize(5, true, 'large').cardHeight).toBe(183);
        // Small, and the default: as before.
        expect(customCardSize(1).cardHeight).toBe(73);
        expect(customCardSize(5).cardHeight).toBe(141);
        expect(customCardSize(5, true).cardHeight).toBe(144);
        expect(customCardSize(5, true, 'small')).toEqual(customCardSize(5, true));
        // The view's one height from the header (customCardViewHeight) agrees.
        for (const [photo, avatar] of [['small', 30], ['medium', 44], ['large', 72]] as const) {
            for (const n of [0, 1, 5]) {
                for (const years of [false, true]) {
                    expect(customCardViewHeight(n, 1, [], years, false, avatar)).toBe(customCardSize(n, years, photo).cardHeight);
                }
            }
        }
        expect(customCardViewHeight(5, 1, [], false, false)).toBe(141);
    });

    it('a card with a photo: a narrower name, a taller header; one without keeps its own (Narrow and Wide)', () => {
        const entry = (photo?: 'medium' | 'large'): CustomCardEntry => ({
            name: 'Abcdefgh Ijklmnopqrs Tuvwxyz', avatar: true, lines: [line('Lhota'), line('Ves')], years: '1850 – 1920',
            ...(photo ? { photo } : {}),
        });
        for (const cap of [240, 400]) {
            const list = [entry('large'), entry()];
            const metrics = customCardMetrics(list, measure, cap, 0);
            // 28 characters × 6 = 168 + 72 + 8 = 248 + 26: the card at its cap (the cap does not change).
            expect(metrics.cardWidth).toBe(cap === 240 ? 240 : 276);
            const { heads, heights, rows } = customCardRows(list, metrics, measure, 0, 'marks', 2);
            const counts = (i: number) => list[i].lines.map(l => rows.get(l as CardLine)!.rows.length);
            // The lines across the card's whole width: the same rows on either card.
            expect(counts(0)).toEqual(counts(1));
            expect(counts(0)).toEqual([1, 1]);
            const room = metrics.cardWidth - 26;
            // The name's column: the room less the avatar and the 8px gap.
            const rowsAt = (w: number) => Math.ceil(168 / w) > 1;
            expect(heads[0].name.length > 1).toBe(rowsAt(room - 80));
            expect(heads[0].block).toBe(Math.max(72, cardHeadBlock(heads[0].name.length, true)));
            expect(heads[1].block).toBe(cardHeadBlock(heads[1].name.length, true));
            // Two lines of one row each: 10 + header + 6 + 2 × 17 + 3 + 10.
            expect(heights[0]).toBe(customCardHeight([1, 1], heads[0].block));
            expect(heights[0]).toBe(10 + 72 + 6 + 34 + 3 + 10);
            expect(heights[1]).toBe(customCardHeight([1, 1], heads[1].block));
        }
        // Without the photo the entries measure as before.
        const plain = customCardMetrics([entry()], measure, 400, 0);
        expect(plain.cardWidth).toBe(Math.ceil((168 + 30 + 8 + 26) / 4) * 4);
    });

    it('the partner line stays by the name (25 / 26.5px), as on a card without a photo', () => {
        expect(customCardSpouseLineY(2)).toBe(25);
        expect(customCardSpouseLineY(2, true)).toBe(26.5);
        expect(customCardSpouseLineY(1, false, 'content')).toBe(25);
        expect(customCardSpouseLineY(1)).toBeUndefined();
    });

    it('matches the CSS (index.html body[data-card-fields][data-card-photo])', () => {
        const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
        for (const size of ['medium', 'large'] as const) {
            const sel = `body[data-card-fields][data-card-photo="${size}"] #tree-canvas .person-card.has-avatar .card-avatar,`;
            const at = html.indexOf(sel);
            expect(at, sel).toBeGreaterThan(-1);
            const decls = html.slice(html.indexOf('{', at) + 1, html.indexOf('}', at));
            expect(decls).toContain(`width: ${cardAvatarSize(size)}px`);
            expect(decls).toContain(`height: ${cardAvatarSize(size)}px`);
            const head = `body[data-card-fields][data-card-photo="${size}"] #tree-canvas .person-card.has-avatar .card-head,`;
            const h = html.indexOf(head);
            expect(h, head).toBeGreaterThan(-1);
            expect(html.slice(html.indexOf('{', h) + 1, html.indexOf('}', h))).toContain(`min-height: ${cardAvatarSize(size)}px`);
        }
    });
});
