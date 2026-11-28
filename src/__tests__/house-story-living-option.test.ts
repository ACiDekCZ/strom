/**
 * The bulk outputs' option "Stories of houses with living people" (spec 145 T8 change, 28. 11.): on by default,
 * remembered like the dialog's other choices (the book's options, the family pages' choices), offered only when a
 * house's story names a living person of the tree ("now" fixed at 20 Nov 2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseResearch, HouseStory } from '../house-bridge.js';
import { collectHouses } from '../houses.js';
import { bookHouseStoriesLiving, defaultBookOptions, housesStoryWithLiving } from '../book-options.js';
import { bookOptionsFromMemory, loadBookMemory, pagesChoicesFromMemory, parseBookMemory, saveBookMemory, defaultPagesChoices } from '../book-memory.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

type Told = Exclude<HouseStory, { status: null }>;
const story = (people: Told['people'], status: Told['status'] = 'final'): HouseResearch => {
    const r = houseResearch();
    r.story = { status, text: 'Grunt na návsi založil Svatobor Prouzal.', facts: [], sources: [], people };
    return r;
};

function memoryStorage() {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('the option of the stories of houses with living people', () => {
    it('on by default, off only when false', () => {
        expect(bookHouseStoriesLiving(defaultBookOptions('cs'))).toBe(true);
        expect(bookHouseStoriesLiving({ houseStoriesLiving: false })).toBe(false);
        expect(defaultPagesChoices().houseStoriesLiving).toBeUndefined();
    });

    it('the book remembers it with its other options; the family pages with their choices', () => {
        const s = memoryStorage();
        saveBookMemory(s, 't1', { ...defaultBookOptions('cs'), selection: { kind: 'tree' }, houseStoriesLiving: false });
        expect(bookOptionsFromMemory('cs', loadBookMemory(s, 't1'), { kind: 'tree' }).houseStoriesLiving).toBe(false);
        saveBookMemory(s, 't2', { ...defaultBookOptions('cs'), selection: { kind: 'tree' } });
        expect(bookOptionsFromMemory('cs', loadBookMemory(s, 't2'), { kind: 'tree' }).houseStoriesLiving).toBeUndefined();
        const pages = { ...defaultPagesChoices(), houseStoriesLiving: false };
        saveBookMemory(s, 't3', { ...defaultBookOptions('cs'), selection: { kind: 'tree' } }, { output: 'pages', pages });
        expect(pagesChoicesFromMemory(loadBookMemory(s, 't3')).houseStoriesLiving).toBe(false);
        expect(parseBookMemory('{"houseStoriesLiving":"no","notes":true}')).toEqual({ notes: true });
        expect(parseBookMemory('{"pages":{"houseStoriesLiving":"no"}}')).toBeNull();
    });

    it('offered only when a story of the houses names a living person of the tree (a draft too)', () => {
        const data = houseTree();
        const houses = collectHouses(data).filter(h => h.id === HOUSE_ID);
        const of = (r: HouseResearch | null) => housesStoryWithLiving(data, houses, h => (h.id === HOUSE_ID ? r : null), HOUSE_NOW);
        expect(of(story([{ id: 'P0001', died: true }, { id: 'P0005', died: false }]))).toBe(true);
        expect(of(story([{ id: 'P0005', died: false }], 'draft'))).toBe(true);
        // A person of the last ~100 years, a stranger the tree does not know: not living.
        expect(of(story([{ id: 'P0003', died: true }, { id: 'P0777', died: false }]))).toBe(false);
        expect(of(houseResearch())).toBe(false);
        expect(of(null)).toBe(false);
        expect(housesStoryWithLiving(data, [], () => story([{ id: 'P0005', died: false }]), HOUSE_NOW)).toBe(false);
        expect(housesStoryWithLiving(data, houses, undefined, HOUSE_NOW)).toBe(false);
    });
});
