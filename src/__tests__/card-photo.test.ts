/**
 * The photo on the card (spec 096 §1, §2, §4): the stored choice repaired to
 * small + circle, the Normal card's box per photo size against the CSS, its
 * text column and height, and the default (or a view without a photo) laid
 * out exactly as before. Widths come from a made-up measure. Invented names.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeCardPhoto, CARD_PHOTO_SIZES, CARD_PHOTO_SHAPES } from '../card-fields.js';
import {
    MeasureTexts, normalCardHeight, normalCardHeights, normalCardTextWidth, normalCardNameRows,
    NORMAL_CARD_NAME_WIDTH, NORMAL_CARD_NAME_WIDTH_BARE,
} from '../card-width.js';
import { CARD_SIZE, NORMAL_PHOTO_BOX, DEFAULT_LAYOUT_CONFIG, layoutConfigFor, PersonId } from '../types.js';
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

    it('the text column beside a photo is 126px in every size; beside the initials of a wider card wider', () => {
        for (const size of CARD_PHOTO_SIZES) expect(normalCardTextWidth(size, true, true)).toBe(NORMAL_CARD_NAME_WIDTH);
        expect(normalCardTextWidth('small', true, false)).toBe(NORMAL_CARD_NAME_WIDTH);
        expect(normalCardTextWidth('small', false, false)).toBe(NORMAL_CARD_NAME_WIDTH_BARE);
        expect(normalCardTextWidth('medium', true, false)).toBe(138);
        expect(normalCardTextWidth('large', true, false)).toBe(174);
        expect(normalCardTextWidth('medium', false, false)).toBe(180);
        expect(normalCardTextWidth('large', false, false)).toBe(216);
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
            const withPhoto = rule(`${view}.has-photo,`);
            expect(pad(withPhoto)).toBe(box.padX);
            if (size === 'large') expect(px(withPhoto, 'height')).toBe(box.cardHeight);
            expect(pad(rule(`${view}.has-photo.focused {`))).toBe(box.padX - 1);
            const avatar = rule(`${view}.has-photo .card-avatar,`);
            expect(px(avatar, 'width')).toBe(box.avatar);
            expect(px(avatar, 'height')).toBe(box.avatar);
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
