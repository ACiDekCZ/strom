/**
 * A couple's story as a chapter (spec 027 §5, §6): the pure chapter block,
 * the fold rules, the years of the marriage, the stable anchor and the label
 * of a link to it. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { coupleChapterHtml, coupleChapterId, coupleChapterLinkLabel, CoupleChapterData } from '../person-page.js';
import { coupleStoryYears, personStoryChapterCount, proseBlocks, splitProseLead } from '../story-text.js';
import { Partnership, Person, PersonId, StromData } from '../types.js';

const chapter = (over: Partial<CoupleChapterData> = {}): CoupleChapterData => ({
    unionId: 'u:1', selfName: 'Jan Vlk', partnerName: 'Rozálie Vlková', selfShort: 'Jan', partnerShort: 'Rozálie',
    selfInitials: 'JV', partnerInitials: 'RV', partnerId: 'roz' as PersonId, years: '1885–1910', title: '',
    prose: '<p>První.</p><p>Druhý.</p>', draft: false, ids: [], ...over,
});

describe('coupleChapterHtml', () => {
    it('monogram (the page’s person first), kicker with the years, the names as the heading without a title', () => {
        const html = coupleChapterHtml(chapter(), { lang: 'en', mode: 'app', foldable: false, open: false, partnerHtml: '' });
        expect(html).toContain('<div class="pp-couple-story" id="pp-story-u_1" tabindex="-1">');
        expect(html).toContain('<span class="pp-ch-mono" aria-hidden="true"><span>JV</span><span>RV</span></span>');
        expect(html).toContain('<p class="pp-kicker pp-ch-kicker">Story of the marriage · 1885–1910</p>');
        expect(html).toContain('<h3 class="pp-ch-title">Jan Vlk and Rozálie Vlková</h3>');
        expect(html).not.toContain('pp-ch-pair');
        expect(html).not.toContain('pp-ch-foot');
    });

    it('a title is the heading, the names go under the kicker; a draft is marked', () => {
        const html = coupleChapterHtml(chapter({ title: 'The mill', draft: true }), { lang: 'cs', mode: 'file', foldable: false, open: false, partnerHtml: '' });
        expect(html).toContain('<p class="pp-ch-pair">Jan Vlk a Rozálie Vlková</p>');
        expect(html).toContain('<h3 class="pp-ch-title">The mill <span class="pp-draft-tag">Návrh</span></h3>');
    });

    it('no years: the kicker alone; the partner line carries the given HTML', () => {
        const html = coupleChapterHtml(chapter({ years: '' }), { lang: 'de', mode: 'app', foldable: false, open: false, partnerHtml: '<b>Rozálie</b>' });
        expect(html).toContain('<p class="pp-kicker pp-ch-kicker">Geschichte der Ehe</p>');
        expect(html).toContain('<span class="pp-ch-also">Dieselbe Geschichte steht auch auf der Seite von <b>Rozálie</b>.</span>');
    });

    it('folds only when foldable and longer than one paragraph; print never folds', () => {
        const cx = { lang: 'en' as const, foldable: true, open: false, partnerHtml: '' };
        expect(coupleChapterHtml(chapter(), { ...cx, mode: 'app' })).toContain('<button type="button" class="pp-ch-more" aria-expanded="false"');
        expect(coupleChapterHtml(chapter(), { ...cx, mode: 'file' })).toContain('<details class="pp-ch-fold">');
        expect(coupleChapterHtml(chapter(), { ...cx, mode: 'print' })).not.toContain('pp-ch-more');
        expect(coupleChapterHtml(chapter({ prose: '<p>Jediný.</p>' }), { ...cx, mode: 'app' })).not.toContain('pp-ch-more');
        // The basis goes inside the fold.
        const html = coupleChapterHtml(chapter(), { ...cx, mode: 'app', basisHtml: '<div class="pp-basis">B</div>' });
        expect(html).toMatch(/<div class="pp-ch-rest"[^>]*hidden><div class="pp-prose"><p>Druhý\.<\/p><\/div><div class="pp-basis">B<\/div><\/div>/);
    });

    it('a partner who is a placeholder: one circle, the person alone named', () => {
        const html = coupleChapterHtml(chapter({ partnerName: '', partnerInitials: '', partnerShort: '' }), { lang: 'en', mode: 'app', foldable: false, open: false, partnerHtml: '' });
        expect(html).toContain('<span class="pp-ch-mono" aria-hidden="true"><span>JV</span></span>');
        expect(html).toContain('<h3 class="pp-ch-title">Jan Vlk</h3>');
    });
});

describe('the fold’s split (splitProseLead)', () => {
    it('the lead is the first paragraph (with a subheading before it); the rest follows', () => {
        expect(splitProseLead('<p>A</p><p>B</p><ul><li>C</li></ul>')).toEqual({ lead: '<p>A</p>', rest: '<p>B</p><ul><li>C</li></ul>' });
        expect(splitProseLead('<h4 class="story-subhead">H</h4><p>A</p><p>B</p>')).toEqual({ lead: '<h4 class="story-subhead">H</h4><p>A</p>', rest: '<p>B</p>' });
        expect(splitProseLead('<p>A</p>')).toEqual({ lead: '<p>A</p>', rest: '' });
        expect(splitProseLead('<p>A</p><h4 class="story-subhead">H</h4>')).toEqual({ lead: '<p>A</p>', rest: '<h4 class="story-subhead">H</h4>' });
        expect(proseBlocks('<p>A<br>a</p><ul><li>B</li><li>C</li></ul>')).toEqual(['<p>A<br>a</p>', '<ul><li>B</li><li>C</li></ul>']);
    });
});

describe('the marriage’s years and the chapters', () => {
    const tree = (u: Partial<Partnership>, d1?: string, d2?: string): { data: StromData; u: Partnership } => {
        const a = { id: 'a', firstName: 'A', lastName: 'X', gender: 'male', parentIds: [], childIds: [], partnerships: ['u'], deathDate: d1 } as unknown as Person;
        const b = { id: 'b', firstName: 'B', lastName: 'X', gender: 'female', parentIds: [], childIds: [], partnerships: ['u'], deathDate: d2 } as unknown as Person;
        const union = { id: 'u', person1Id: 'a', person2Id: 'b', childIds: [], ...u } as unknown as Partnership;
        return { data: { persons: { a, b }, partnerships: { u: union } } as unknown as StromData, u: union };
    };

    it('wedding → end of the union, else the first death', () => {
        const y = (...args: Parameters<typeof tree>) => { const t = tree(...args); return coupleStoryYears(t.data, t.u); };
        expect(y({ startDate: '1885-05-01', endDate: '1899' }, '1910', '1920')).toBe('1885–1899');
        expect(y({ startDate: '1885' }, '1920', '1910')).toBe('1885–1910');
        expect(y({ startDate: '1885' })).toBe('1885');
        expect(y({}, '1910')).toBe('–1910');
        expect(y({})).toBe('');
    });

    it('counts the own story and one chapter per couple’s story', () => {
        const t = tree({ story: { status: 'final', text: 'Svatba.' } });
        const a = t.data.persons['a' as PersonId];
        expect(personStoryChapterCount(t.data, a)).toBe(1);
        a.story = { status: 'draft', text: 'Vlastní.' };
        expect(personStoryChapterCount(t.data, a)).toBe(2);
    });
});

describe('a link to a chapter (the family tree at the wedding, spec 027 §5.1)', () => {
    it('a stable anchor from the union id; the title with ↓, else “story ↓”; nothing without a story', () => {
        expect(coupleChapterId('u1')).toBe('pp-story-u1');
        expect(coupleChapterId('u:1/ä')).toBe('pp-story-u_1__');
        const u = { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], story: { status: 'final', text: 'T', title: 'The mill [S0042]' } } as unknown as Partnership;
        expect(coupleChapterLinkLabel(u, 'en')).toBe('The mill ↓');
        delete u.story!.title;
        expect(coupleChapterLinkLabel(u, 'en')).toBe('story ↓');
        expect(coupleChapterLinkLabel(u, 'cs')).toBe('vyprávění ↓');
        delete u.story;
        expect(coupleChapterLinkLabel(u, 'en')).toBe('');
    });
});
