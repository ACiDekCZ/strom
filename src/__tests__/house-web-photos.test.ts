/**
 * Web photos in outputs (spec 145 T8), "now" fixed at 20 Nov 2026: the pictures of a house (`look.images`, under a
 * free licence) and of its town (`town.pictures`) in the saved house page, the Houses chapter of the book and the
 * house pages of a set of family pages — from the web by default (a plain http(s) <img> without the referrer, the
 * caption with the link beside it), the caption and the link only with "Link only"; the setting is remembered and
 * on by default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, StromData } from '../types.js';
import type { HouseResearch } from '../house-bridge.js';
import { collectHouses, type TreeHouse } from '../houses.js';
import { buildHousePageDocument, housePicturesOf } from '../house-page.js';
import { defaultBookOptions } from '../book-options.js';
import { buildFamilyBook } from '../book.js';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { SettingsManager } from '../settings.js';
import { SETTINGS_KEY } from '../model-values.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const HOUSE_IMG = 'https://example.org/dum.jpg';
const TOWN_IMG = 'https://commons.example.org/naves.jpg';

function withPictures(): HouseResearch {
    const r = houseResearch();
    r.look = {
        text: 'Zděné přízemní stavení.',
        images: [{ url: HOUSE_IMG, license: 'CC BY 4.0', credit: 'Archiv Brodek' }, { url: 'https://example.org/bez.jpg', credit: 'bez licence' }],
    };
    r.town = {
        id: 'A0002', place: { id: 'L0001', name: 'Bělokamen' }, text: '', passed: [], manual: [], archiveOnly: [], maps: [], unknown: [],
        pictures: [{ id: 'i1', url: TOWN_IMG, license: 'CC BY-SA 4.0', credit: 'Jan Brodský', shows: 'Náves od kaple, 1912' }],
    };
    return r;
}

const houseOf = (data: StromData, id: string): TreeHouse => collectHouses(data).find(h => h.id === id)!;
const webImgs = (html: string): string[] => [...html.matchAll(/<img[^>]+src="(https?:[^"]+)"/g)].map(m => m[1]);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('the saved house page', () => {
    const data = houseTree();
    const doc = (webPhotos?: boolean) => buildHousePageDocument(data, houseOf(data, HOUSE_ID), withPictures(),
        { lang: 'en', now: HOUSE_NOW, ...(webPhotos === undefined ? {} : { webPhotos }) });

    it('Load from web (default): the licensed pictures as <img> without the referrer, the captions with their links', () => {
        const html = doc();
        expect(webImgs(html)).toEqual([HOUSE_IMG, TOWN_IMG]);
        for (const m of html.matchAll(/<img[^>]+src="https?:[^>]+>/g)) {
            expect(m[0]).toContain('referrerpolicy="no-referrer"');
            expect(m[0]).toContain('loading="lazy"');
            expect(m[0]).toContain('alt=""');
            expect(m[0]).not.toMatch(/\son[a-z]+=/);
        }
        expect(html).toContain('Archiv Brodek · CC BY 4.0');
        expect(html).toContain('Náves od kaple, 1912');
        expect(html).toContain(`href="${TOWN_IMG}"`);
        expect(html).not.toContain('bez.jpg');
    });

    it('Link only: no <img> from the web, the captions and links stay', () => {
        const html = doc(false);
        expect(webImgs(html)).toEqual([]);
        expect(html).toContain('Archiv Brodek · CC BY 4.0');
        expect(html).toContain(`href="${HOUSE_IMG}"`);
        expect(html).toContain(`href="${TOWN_IMG}"`);
    });

    it('a house with pictures is told (the dialog offers the switch); one without is not', () => {
        expect(housePicturesOf(withPictures())).toBe(true);
        expect(housePicturesOf(houseResearch())).toBe(false);
        expect(housePicturesOf(null)).toBe(false);
    });
});

describe('the Houses chapter of the book', () => {
    const book = (webPhotos?: boolean): string => {
        const chapterOf = (html: string) => {
            const at = html.indexOf('id="book-houses"');
            return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
        };
        return chapterOf(buildFamilyBook(houseTree(), {
            ...defaultBookOptions('en'), selection: { kind: 'tree' }, privacy: 'full',
            parts: { ...defaultBookOptions('en').parts, houses: true },
        }, {
            dateLabel: 'x', now: HOUSE_NOW, houseResearch: h => (h.id === HOUSE_ID ? withPictures() : null),
            ...(webPhotos === undefined ? {} : { webPhotos }),
        }));
    };

    it('Load from web (default): the house\'s and the town\'s pictures with their captions, after the look', () => {
        const ch = book();
        expect(ch).toContain('Zděné přízemní stavení.');
        expect(webImgs(ch)).toEqual([HOUSE_IMG, TOWN_IMG]);
        expect(ch).toContain(`<img class="book-house-img" src="${HOUSE_IMG}" alt="" referrerpolicy="no-referrer">`);
        expect(ch.indexOf(HOUSE_IMG)).toBeGreaterThan(ch.indexOf('Zděné přízemní stavení.'));
        expect(ch).toContain('Pictures of the town');
        expect(ch).toContain('Archiv Brodek · CC BY 4.0 · ');
        expect(ch).toContain('Jan Brodský · CC BY-SA 4.0');
        expect(ch).not.toContain('bez.jpg');
        expect(book(true)).toBe(ch);
    });

    it('Link only: the captions with the links, no picture', () => {
        const ch = book(false);
        expect(webImgs(ch)).toEqual([]);
        expect(ch).toContain('book-house-fig--link');
        expect(ch).toContain(`href="${HOUSE_IMG}"`);
        expect(ch).toContain('Náves od kaple, 1912');
    });
});

describe('the house pages of a set of family pages', () => {
    const page = (webPhotos?: boolean): string => {
        const data = houseTree();
        const rod = rods(buildLineages(data)).find(r => r.surname === 'Prouzal')!;
        const set = buildPageSet(data, { kind: 'rods', rods: [rod.id] }, {
            lang: 'en', now: HOUSE_NOW, houseResearch: new Map([[HOUSE_ID, withPictures()]]),
            ...(webPhotos === undefined ? {} : { webPhotos }),
        });
        const html = buildPageSetHtml(set);
        const at = html.indexOf(`id="${set.houseSlug!.get(HOUSE_ID)!}"`);
        return html.slice(at, html.indexOf('</section>', html.indexOf('</article>', at)));
    };

    it('Load from web (default) and Link only', () => {
        expect(webImgs(page())).toEqual([HOUSE_IMG, TOWN_IMG]);
        expect(webImgs(page(false))).toEqual([]);
        expect(page(false)).toContain(`href="${TOWN_IMG}"`);
    });
});

describe('the setting "Web photos in outputs"', () => {
    let store: Map<string, string>;
    const internals = SettingsManager as unknown as { load(): void; settings: AppSettings };
    const restart = (): void => {
        internals.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
        internals.load();
    };
    beforeEach(() => {
        store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
        restart();
    });
    afterEach(() => { restart(); vi.unstubAllGlobals(); });

    it('on by default; Link only is remembered after a restart, Load from web again too', () => {
        expect(SettingsManager.isOutputWebPhotos()).toBe(true);
        SettingsManager.setOutputWebPhotos(false);
        expect(JSON.parse(store.get(SETTINGS_KEY) ?? '{}').outputWebPhotos).toBe(false);
        restart();
        expect(SettingsManager.isOutputWebPhotos()).toBe(false);
        SettingsManager.setOutputWebPhotos(true);
        restart();
        expect(SettingsManager.isOutputWebPhotos()).toBe(true);
    });
});
