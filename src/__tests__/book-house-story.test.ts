/**
 * A house's story in the family book (spec 145 T4), "now" fixed at 20 Nov 2026: in the Houses chapter before the
 * house's sections, the approved text or a draft tagged as one (spec 145 T8; a new version beside an approved one
 * never); left out when it names a protected person (a draft too); under the story of a person who lived there a link to the house in the chapter,
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

const book = (story: HouseStory | undefined, houses = true, data = tree()): string =>
    buildFamilyBook(data, {
        ...defaultBookOptions('cs'), selection: { kind: 'tree' }, privacy: 'full',
        parts: { ...defaultBookOptions('cs').parts, houses, story: true },
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

    it('a draft tagged (T8); a new version beside an approved one stays out, the approved one in', () => {
        const draft = chapter(book({ ...final(), status: 'draft' }));
        expect(draft).toContain(TEXT);
        expect(draft).toContain('<p class="book-house-story-tag"><span>koncept, čeká na schválení</span></p>');
        expect(draft).toContain('book-house-story--draft');
        expect(chapter(book(final()))).not.toContain('book-house-story-tag');
        expect(chapter(book({ ...final({ people: [...OLD, { id: 'P0005', died: false }] }), status: 'draft' }))).not.toContain(TEXT);
        const both = chapter(book(final({ draft: { text: 'Nová verze o gruntu.', facts: [], sources: [], people: [] } })));
        expect(both).toContain(TEXT);
        expect(both).not.toContain('Nová verze o gruntu.');
    });

    it('left out when it names the living or a person of the last ~100 years', () => {
        expect(chapter(book(final({ people: [...OLD, { id: 'P0005', died: false }] })))).not.toContain(TEXT);
        expect(chapter(book(final({ people: [...OLD, { id: 'P0003', died: true }] })))).not.toContain(TEXT);
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
