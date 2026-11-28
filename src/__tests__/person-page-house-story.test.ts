/**
 * The story of a house under a person's story (spec 145 T4): "House No. N ›" for a house the person lived in that has
 * a story (in a set also a draft its page shows, spec 145 T8) — in the window a button to the house's page at its story, in a set an anchor only when the
 * house's page there shows the story; nothing otherwise, and the house's text never repeated.
 */
import { describe, expect, it } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { buildPersonPageBody, preparePersonPageData, PERSON_PAGE_ALL_GROUPS, type PersonPageOptions } from '../person-page.js';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { HOUSE_ID, HOUSE_NOW, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const pid = (s: string): PersonId => s as PersonId;
const STORY = 'Hostivít hospodařil na gruntu po otci.';
const HOUSE_STORY = 'Grunt založil Svatobor Prouzal.';

/** The tree with Hostivít's own story. */
function tree(): StromData {
    const data = houseTree();
    data.persons[pid('hostivit')]!.story = { status: 'final', text: STORY };
    return data;
}

const opts = (o: Partial<PersonPageOptions> = {}): PersonPageOptions => ({
    personId: pid('hostivit'), lang: 'en', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
    privacy: 'full', toggles: { history: true, childEvents: true }, research: false, now: HOUSE_NOW, ...o,
});
const body = (d: StromData, o: Partial<PersonPageOptions> = {}): string => buildPersonPageBody(preparePersonPageData(d, opts(o)), opts(o));
const storyLinks = (html: string): string => /<p class="pp-story-houses">.*?<\/p>/.exec(html)?.[0] ?? '';

describe('the person page — the story of a house the person lived in (spec 145 T4)', () => {
    it('window: a button to the house\'s story under the person\'s story', () => {
        const html = body(tree(), { houseStory: id => id === HOUSE_ID });
        const links = storyLinks(html);
        expect(links).toMatch(/<button type="button" class="pp-link pp-house-link" data-pp-house="belokamen\|16" data-pp-house-sec="story" title="House čp. 16">House čp. 16 ›<\/button>/);
        // Under the story: after its text, inside its section.
        const sec = html.slice(html.indexOf('id="pp-sec-story"'));
        expect(sec.indexOf(STORY)).toBeLessThan(sec.indexOf('pp-story-houses'));
        expect(sec.indexOf('pp-story-houses')).toBeLessThan(sec.indexOf('</section>'));
    });

    it('nothing without a house with a story, without the check, or without the person\'s story', () => {
        expect(storyLinks(body(tree(), { houseStory: () => false }))).toBe('');
        expect(storyLinks(body(tree()))).toBe('');
        // No story of the person: no section to put it under.
        expect(body(houseTree(), { houseStory: () => true })).not.toContain('pp-story-houses');
    });

    it('a saved page: an anchor only to a house page in the set; outside a set nothing', () => {
        const set = (houseSlug: Map<string, string>): Partial<PersonPageOptions> => ({
            mode: 'file', links: { mode: 'set', personSlug: new Map(), houseSlug }, houseStory: () => true,
        });
        expect(storyLinks(body(tree(), set(new Map([[HOUSE_ID, 'dum-belokamen-cp-16']]))))).toContain('href="#dum-belokamen-cp-16"');
        expect(storyLinks(body(tree(), set(new Map())))).toBe('');
        expect(body(tree(), { mode: 'file', links: 'plain', houseStory: () => true })).not.toContain('pp-story-houses');
    });
});

describe('the family pages — a person\'s story leads to the house\'s story', () => {
    const setHtml = (story?: { status: 'draft' | 'final'; people: { id: string; died: boolean }[] }, houses?: 'pages' | 'mention', houseStoriesLiving?: boolean) => {
        const data = tree();
        const r = houseResearch();
        if (story) r.story = { ...story, title: 'Grunt na návsi', text: HOUSE_STORY, facts: ['h1'], sources: [] };
        const rod = rods(buildLineages(data)).find(x => x.surname === 'Prouzal')!;
        const set = buildPageSet(data, { kind: 'rods', rods: [rod.id] },
            { lang: 'en', now: HOUSE_NOW, timelines: true, houseResearch: new Map([[HOUSE_ID, r]]), ...(houses ? { houses } : {}),
                ...(houseStoriesLiving !== undefined ? { houseStoriesLiving } : {}) });
        return { html: buildPageSetHtml(set), slug: set.houseSlug?.get(HOUSE_ID), person: set.personSlug.get(pid('hostivit'))! };
    };
    /** Hostivít's page of the single file. */
    const personPage = (html: string, slug: string): string => {
        const at = html.indexOf(`id="${slug}"`);
        return html.slice(at, html.indexOf('<section class="sp-page', at + 10));
    };

    it('an approved story the house\'s page shows: the link to that page, the story told there only', () => {
        const { html, slug, person } = setHtml({ status: 'final', people: [{ id: 'P0001', died: true }] });
        const page = personPage(html, person);
        expect(storyLinks(page)).toContain(`href="#${slug}"`);
        expect(page).not.toContain(HOUSE_STORY);
    });

    it('a draft the house\'s page shows (spec 145 T8): the link to that page too', () => {
        const { html, slug, person } = setHtml({ status: 'draft', people: [{ id: 'P0001', died: true }] });
        expect(storyLinks(personPage(html, person))).toContain(`href="#${slug}"`);
    });

    // Changed 28. 11. (spec 145 T8 change): a person of the last ~100 years no longer keeps the story out.
    it('none for a story the house\'s page leaves out (the living with the option off), or a house without a page', () => {
        const recent = setHtml({ status: 'final', people: [{ id: 'P0001', died: true }, { id: 'P0003', died: true }] });
        expect(storyLinks(personPage(recent.html, recent.person))).toContain(`href="#${recent.slug}"`);
        for (const s of [
            setHtml({ status: 'draft', people: [{ id: 'P0001', died: true }, { id: 'P0005', died: false }] }, undefined, false),
            setHtml({ status: 'final', people: [{ id: 'P0001', died: true }, { id: 'P0005', died: false }] }, undefined, false),
            setHtml(),
        ]) expect(storyLinks(personPage(s.html, s.person))).toBe('');
        const mention = setHtml({ status: 'final', people: [{ id: 'P0001', died: true }] }, 'mention');
        expect(mention.slug).toBeUndefined();
        expect(storyLinks(mention.html)).toBe('');
    });
});
