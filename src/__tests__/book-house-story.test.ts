/**
 * A house's story in the family book (spec 145 T4), "now" fixed at 20 Nov 2026: in the Houses chapter before the
 * house's sections, the approved text or a draft printed as the story, untagged (spec 145 T8; a new version beside an
 * approved one never); whoever appears in it, a story with a living person left out only with the book's option
 * houseStoriesLiving off (T8 change, 28. 11.); under the story of a person who lived there a link to the house in the chapter,
 * only when the chapter has the house with its story.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import type { HouseResearch, HouseStory } from '../house-bridge.js';
import { defaultBookOptions } from '../book-options.js';
import { buildFamilyBook } from '../book.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const TEXT = 'Grunt na návsi založil Svatobor Prouzal.';
const OLD = [{ id: 'P0001', died: true }, { id: 'P0002', died: true }];
type Told = Exclude<HouseStory, { status: null }>;
const final = (over: Partial<Told> = {}): Told =>
    ({ status: 'final', title: 'Grunt na návsi', text: TEXT, facts: ['e1', 'h1'], sources: [], people: OLD, ...over });

function tree(): StromData {
    const data = houseTree();
    data.persons['svatobor' as PersonId].story = { status: 'final', text: 'Svatobor hospodařil na gruntu celý život.' };
    return data;
}

const book = (story: HouseStory | undefined, houses = true, data = tree(), houseStoriesLiving?: boolean): string =>
    buildFamilyBook(data, {
        ...defaultBookOptions('cs'), selection: { kind: 'tree' }, privacy: 'full',
        parts: { ...defaultBookOptions('cs').parts, houses, story: true },
        ...(houseStoriesLiving !== undefined ? { houseStoriesLiving } : {}),
    }, {
        dateLabel: 'x', now: HOUSE_NOW,
        houseResearch: h => {
            if (h.id !== HOUSE_ID) return null;
            const r: HouseResearch = houseResearch();
            if (story) r.story = story;
            return r;
        },
    });
const chapter = (html: string): string => {
    const at = html.indexOf('id="book-houses"');
    return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
};
const personStory = (html: string): string => {
    const at = html.indexOf('Svatobor hospodařil');
    return at < 0 ? '' : html.slice(at, html.indexOf('</div>', at));
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('the Houses chapter: a house\'s story', () => {
    it('the approved story before the house\'s sections', () => {
        const ch = chapter(book(final()));
        expect(ch).toContain('book-house-story');
        expect(ch).toContain('Grunt na návsi');
        expect(ch.indexOf(TEXT)).toBeGreaterThan(0);
        expect(ch.indexOf(TEXT)).toBeLessThan(ch.indexOf('Časová osa'));
    });

    it('a draft as the story, untagged (T8); a new version beside an approved one stays out, the approved one in', () => {
        const draft = chapter(book({ ...final(), status: 'draft' }));
        expect(draft).toContain(TEXT);
        expect(draft).not.toContain('book-house-story-tag');
        expect(draft).not.toContain('book-house-story--draft');
        expect(draft).not.toContain('čeká na schválení');
        const both = chapter(book(final({ draft: { text: 'Nová verze o gruntu.', facts: [], sources: [], people: [] } })));
        expect(both).toContain(TEXT);
        expect(both).not.toContain('Nová verze o gruntu.');
    });

    // Changed 28. 11. (T8 change): before, a story naming the living or a person of the last ~100 years was left out always.
    it('with the living in it: in by default, left out with the option off; a person of the last ~100 years never keeps it out', () => {
        const living = final({ people: [...OLD, { id: 'P0005', died: false }] });
        expect(chapter(book(living))).toContain(TEXT);
        expect(chapter(book({ ...living, status: 'draft' }))).toContain(TEXT);
        expect(chapter(book(living, true, tree(), false))).not.toContain(TEXT);
        expect(chapter(book({ ...living, status: 'draft' }, true, tree(), false))).not.toContain(TEXT);
        const recent = final({ people: [...OLD, { id: 'P0003', died: true }], facts: ['h3', 'e9'] });
        expect(chapter(book(recent))).toContain(TEXT);
        expect(chapter(book(recent, true, tree(), false))).toContain(TEXT);
    });
});

describe('a person\'s story: the link to the house', () => {
    it('under the story of a person who lived there, to the house in the chapter', () => {
        const html = book(final());
        const ps = personStory(html);
        expect(ps).toContain('book-story-houses');
        const href = /class="book-story-houses"><a href="#([^"]+)"/.exec(ps)?.[1];
        expect(href).toBeTruthy();
        expect(chapter(html)).toContain(`id="${href}"`);
    });

    it('none without the chapter or without a story of the house; its draft shown in the chapter links too (T8)', () => {
        expect(personStory(book(final(), false))).not.toContain('book-story-houses');
        expect(personStory(book(undefined))).not.toContain('book-story-houses');
        expect(personStory(book({ ...final(), status: 'draft' }))).toContain('book-story-houses');
        expect(personStory(book(undefined))).toContain('Svatobor hospodařil');
    });
});
