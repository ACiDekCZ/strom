/**
 * The couple's photo outside the app's panels (spec 107 §8): first in the
 * person page's gallery (in the page's language, counted with the materials,
 * gone without the materials and under privacy for a living partner) and
 * above the couple's events in the Family book. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { preparePersonPageData, buildPersonPageBody, PERSON_PAGE_ALL_GROUPS, PersonPageOptions } from '../person-page.js';
import { buildFamilyBook } from '../book.js';
import { addPersonMedia } from '../media.js';
import { StromData, PersonId, PartnershipId, Person, Gender } from '../types.js';

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const NOW = new Date('2026-10-29T12:00:00Z');

function p(id: string, first: string, gender: Gender, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: 'Fronwieser', gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: ['u1' as PartnershipId], ...extra } as Person;
}

function tree(photo = true, livingWife = false): StromData {
    return {
        persons: {
            // The wife is person1: the caption still names the husband first (the card's order).
            a: p('a', 'Adelgunde', 'female', livingWife ? { birthDate: '1975' } : { birthDate: '1900', deathDate: '1980' }),
            w: p('w', 'Wolfhart', 'male', { birthDate: '1898', deathDate: '1970' }),
        },
        partnerships: {
            u1: { id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'w' as PersonId, status: 'married', childIds: [], startDate: livingWife ? '2001-05-12' : '1924-06-18', ...(photo ? { photo: IMG } : {}) },
        },
    } as StromData;
}

function opts(o: Partial<PersonPageOptions> = {}): PersonPageOptions {
    return {
        personId: 'w' as PersonId, lang: 'en', mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
        privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: NOW, ...o,
    };
}

const page = (d: StromData, o: Partial<PersonPageOptions> = {}) => {
    const op = opts(o);
    const html = buildPersonPageBody(preparePersonPageData(d, op), op);
    return html.match(/<section class="pp-sec pp-sec--materials" id="pp-sec-materials">.*?<\/section>/)?.[0] ?? '';
};

describe('the couple\'s photo on the person page (spec 107 §8)', () => {
    it('stands first in the gallery, captioned in the page\'s language and counted', () => {
        const d = tree();
        addPersonMedia(d, 'w' as PersonId, { id: 'x', name: 'farm.jpg', mimeType: 'image/jpeg', dataUrl: IMG, sizeBytes: 50, note: 'The farm' });
        const sec = page(d);
        expect(sec).toContain('<span class="pp-count">2</span>');
        const caps = [...sec.matchAll(/<span class="pp-gal-cap">([^<]*)<\/span>/g)].map(m => m[1]);
        expect(caps[0]).toBe('Wolfhart and Adelgunde · couple’s photo');
        expect(caps).toHaveLength(2);
        expect(sec).toContain('data-pp-zoom');
        expect(page(d, { lang: 'cs' })).toContain('Wolfhart a Adelgunde · fotka svazku');
        // The partner's page shows it too.
        expect(page(d, { personId: 'a' as PersonId })).toContain('couple’s photo');
    });

    it('is not there without a photo, without the materials, or for a living partner under privacy', () => {
        expect(page(tree(false))).not.toContain('couple’s photo');
        expect(page(tree(), { groups: { ...PERSON_PAGE_ALL_GROUPS, materials: false } })).not.toContain('couple’s photo');
        expect(page(tree(true, true), { privacy: 'initials' })).not.toContain('couple’s photo');
    });
});

describe('the couple\'s photo in the Family book (spec 107 §8)', () => {
    it('stands above the couple\'s events, captioned by the marriage and its date, only with the images', () => {
        const d = tree();
        d.partnerships['u1' as PartnershipId].events = [{ id: 'e1', type: 'engagement', date: '1923-12-24' }] as never;
        const book = buildFamilyBook(d, { lang: 'en', privacy: 'full' });
        const fig = book.match(/<figure class="book-photo book-photo--couple">.*?<\/figure>/)?.[0] ?? '';
        expect(fig).toContain(`src="${IMG}"`);
        expect(fig).toMatch(/<figcaption>Marriage, 18 Jun(e)? 1924<\/figcaption>/);
        const at = book.indexOf('<figure class="book-photo book-photo--couple">');
        expect(at).toBeGreaterThan(-1);
        expect(book.indexOf('<div class="book-section book-couple-events">')).toBeGreaterThan(at);
        expect(buildFamilyBook(tree(false), { lang: 'en', privacy: 'full' })).not.toContain('<figure class="book-photo book-photo--couple">');
    });
});
