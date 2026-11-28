/**
 * Houses in a line's pages (spec 030 §13): the houses' events (married into,
 * left, the last of a house) on the line's timeline under their own chip, the
 * line's houses on its page, a page per house with history in the set and the
 * index of houses after the places; a family's marriage and residence lead to
 * the house's page. Nothing of the people of the last ~100 years (fixed "now").
 */
import { describe, expect, it } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { collectHouses } from '../houses.js';
import { houseOutputs } from '../house-events.js';
import { buildPageSet, estimatePageSetSize, pageSetPath } from '../family-pages.js';
import { buildPageSetHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { HOUSE_ID, HOUSE_NOW, LIVING_NAME, OLD_HOUSE_ID, SENSITIVE_TEXT, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const pid = (s: string): PersonId => s as PersonId;

function prouzalSet(data: StromData = houseTree(), extra: Record<string, unknown> = {}) {
    const rod = rods(buildLineages(data)).find(r => r.surname === 'Prouzal')!;
    return buildPageSet(data, { kind: 'rods', rods: [rod.id] }, { lang: 'en', now: HOUSE_NOW, timelines: true, ...extra });
}

/** A page's section of the single file. */
function section(html: string, slug: string): string {
    const at = html.indexOf(`<section class="sp-page`, html.indexOf(`id="${slug}"`) - 80);
    const ends = ['<section class="sp-page', '<script'].map(m => html.indexOf(m, at + 10)).filter(i => i > 0);
    return html.slice(at, ends.length ? Math.min(...ends) : undefined);
}

describe('the houses\' events', () => {
    it('married into, left and the last of a house — none of the last ~100 years', () => {
        const data = houseTree();
        const { events, houses } = houseOutputs(data, collectHouses(data), HOUSE_NOW);
        expect(events.map(e => [e.kind, e.year, e.personId, e.houseId, e.to ?? ''])).toEqual([
            ['marriedIn', 1845, 'radegunda', HOUSE_ID, ''],
            ['left', 1845, 'radegunda', OLD_HOUSE_ID, 'Bělokamen čp.\u00a016'],
            ['last', 1860, 'drahobud', OLD_HOUSE_ID, ''],
            ['marriedIn', 1878, 'kunhuta', HOUSE_ID, ''],
        ]);
        // čp. 16 has people of the last ~100 years (Lubor died 1950, Vratislav, Bohuslava): no "last of the house",
        // its period and generations only of those shown.
        const h16 = houses.find(h => h.house.id === HOUSE_ID)!;
        expect(h16.period).toEqual({ from: 1820, to: 1920 });
        expect(h16.facts.some(f => ['lubor', 'vratislav', 'bohuslava'].includes(f.personId))).toBe(false);
        expect(h16.generations).toBe(2);
    });
});

describe('a set of a line with houses', () => {
    it('a page per house its people lived at, the index of houses after the places, in a folder of their own', () => {
        const set = prouzalSet();
        expect([...set.houseSlug!.keys()].sort()).toEqual([HOUSE_ID, OLD_HOUSE_ID].sort());
        const slug = set.houseSlug!.get(HOUSE_ID)!;
        expect(slug).toBe('dum-belokamen-cp-16');
        const page = set.bySlug.get(slug)!;
        expect(page.kind).toBe('house');
        expect(page.crumbs.map(c => c.slug)).toEqual([set.introSlug, set.indexSlug.houses, slug]);
        expect(set.indexSlug.houses).toBe('rejstrik-domy');
        const kinds = set.pages.filter(p => p.kind === 'index').map(p => p.id);
        expect(kinds.indexOf('houses')).toBe(kinds.indexOf('places') + 1);
        expect(pageSetPath(set, slug)).toBe('houses/dum-belokamen-cp-16.html');
    });

    it('a tree without a house with history has no house page and no index of houses', () => {
        const data = houseTree();
        for (const p of Object.values(data.persons)) { delete p.birthAddress; delete p.deathAddress; }
        for (const u of Object.values(data.partnerships)) delete u.address;
        const set = prouzalSet(data);
        expect(set.houseSlug!.size).toBe(0);
        expect(set.indexSlug.houses).toBe('');
        const html = buildPageSetHtml(set);
        expect(html).not.toContain('rejstrik-domy');
        expect(html).not.toContain('class="sp-block sp-houses"');
    });

    it('the line\'s page, the timeline, the family and the person pages lead to the house', () => {
        const set = prouzalSet();
        const html = buildPageSetHtml(set);
        const slug = set.houseSlug!.get(HOUSE_ID)!;
        // The line's houses: house | period | generations.
        const rod = section(html, [...set.rodSlug.values()][0]);
        expect(rod).toContain('<section class="sp-block sp-houses">');
        expect(rod).toMatch(new RegExp(`<td><a class="pp-link sp-house-link" href="#${slug}">Bělokamen čp.\u00a016</a></td><td>1820–1920</td><td>2</td>`));
        // The timeline: the houses' chip and their sentences.
        const tl = section(html, [...set.rodTimelineSlug.values()][0]);
        expect(tl).toContain('data-tl-k="houses"');
        expect(tl).toMatch(/sp-tl-row--house" data-k="houses"><span class="sp-tl-y">1878<\/span>.*Kunhuta.*married into.*href="#dum-belokamen-cp-16"/);
        // The family of 1878: its wedding at čp. 16.
        const fam = section(html, [...set.familySlug.values()].find(s => s.includes('1878'))!);
        expect(fam).toContain(`<dd><a class="pp-link sp-house-link" href="#${slug}">Bělokamen, čp. 16</a></dd>`);
        // A person page: the address and the row Houses lead to the house's page.
        const person = section(html, set.personSlug.get(pid('hostivit'))!);
        expect(person).toContain(`href="#${slug}"`);
        expect(person).toContain('class="pp-houses"');
    });

    it('the house\'s page and the index: nothing of the people of the last ~100 years, the research\'s events never', () => {
        const set = prouzalSet();
        const html = buildPageSetHtml(set);
        const slug = set.houseSlug!.get(HOUSE_ID)!;
        const page = section(html, slug);
        expect(page).toContain('<article class="pp hp"');
        expect(page).toContain(`id="${slug}--hp-sec-`);
        const index = section(html, set.indexSlug.houses);
        expect(index).toContain(`href="#${slug}"`);
        for (const text of [LIVING_NAME, SENSITIVE_TEXT, '2015', '2001']) {
            expect(page).not.toContain(text);
            expect(index).not.toContain(text);
        }
        // The house's events on the line's timeline stop before the last ~100 years too.
        const tl = section(html, [...set.rodTimelineSlug.values()][0]);
        expect(tl.match(/sp-tl-row--house[^>]*><span class="sp-tl-y">(\d+)/g)!.map(m => Number(m.slice(-4))).every(y => y < 1926)).toBe(true);
    });
});

describe('houses in the family pages (spec 145 T6)', () => {
    const set0 = () => prouzalSet();
    const research = (edit?: (r: ReturnType<typeof houseResearch>) => void) => {
        const r = houseResearch();
        edit?.(r);
        return { houseResearch: new Map([[HOUSE_ID, r]]) };
    };

    it('the house\'s page carries the research\'s results through the privacy filter of a saved file', () => {
        const set = prouzalSet(undefined, research());
        const page = section(buildPageSetHtml(set), set.houseSlug!.get(HOUSE_ID)!);
        // The holders of the research, before the last ~100 years.
        expect(page).toContain('hp-sec--people');
        for (const name of ['Svatobor Prouzal', 'Hostivít Prouzal', 'Lubor Prouzal', 'Radegunda Prouzalová']) expect(page).toContain(name);
        // Never the sensitive event, the rebuilding of 1962 or the stranger holding it from 1951.
        for (const text of [SENSITIVE_TEXT, 'Přestavba stodoly', 'Kvido Stranný', LIVING_NAME]) expect(page).not.toContain(text);
        // Without the research's results the page is the tree's alone.
        expect(section(buildPageSetHtml(prouzalSet()), set.houseSlug!.get(HOUSE_ID)!)).not.toContain('hp-sec--people');
    });

    // Changed 28. 11. (spec 145 T8 change): a draft untagged; a person of the last ~100 years no longer keeps the
    // story out, a living one only with the option off.
    it('the house\'s page shows its story (spec 145 T4), a draft as the story; the living only by the option (T8)', () => {
        const story = (status: 'draft' | 'final', people: { id: string; died: boolean }[]) => research(r => {
            r.story = { status, title: 'Grunt na návsi', text: 'Grunt založil Svatobor Prouzal.', facts: ['h1', 'h3'], sources: [], people };
        });
        const slug = set0().houseSlug!.get(HOUSE_ID)!;
        const page = (extra: Record<string, unknown>) => section(buildPageSetHtml(prouzalSet(undefined, extra)), slug);
        const shown = page(story('final', [{ id: 'P0001', died: true }]));
        expect(shown).toContain('hp-sec--story');
        expect(shown).toContain('Grunt založil Svatobor Prouzal.');
        const draft = page(story('draft', [{ id: 'P0001', died: true }]));
        expect(draft).toContain('Grunt založil');
        expect(draft).not.toContain('hp-story-tag');
        expect(draft).not.toContain('waiting for approval');
        expect(draft).not.toContain('<button');
        expect(page(story('draft', [{ id: 'P0001', died: true }, { id: 'P0003', died: true }]))).toContain('Grunt založil');
        const living = [{ id: 'P0001', died: true }, { id: 'P0005', died: false }];
        expect(page(story('final', living))).toContain('Grunt založil');
        expect(page({ ...story('final', living), houseStoriesLiving: false })).not.toContain('Grunt založil');
        expect(page({ ...story('draft', living), houseStoriesLiving: false })).not.toContain('Grunt založil');
        expect(page({ ...story('final', [{ id: 'P0003', died: true }]), houseStoriesLiving: false })).toContain('Grunt založil');
    });

    it('the house\'s people link to their pages in the set; one without a page stays text', () => {
        // Radegunda's father (P0009) has no page in the line's set.
        const set = prouzalSet(undefined, research(r => { r.residents[0] = { ...r.residents[0], name: 'Drahobud Mlynář', person: 'P0009' }; }));
        expect(set.personSlug.has(pid('drahobud'))).toBe(false);
        const page = section(buildPageSetHtml(set), set.houseSlug!.get(HOUSE_ID)!);
        expect(page).toContain(`<a class="pp-link" href="#${set.personSlug.get(pid('svatobor'))}">Svatobor Prouzal</a>`);
        expect(page).toContain(`<a class="pp-link" href="#${set.personSlug.get(pid('lubor'))}">Lubor Prouzal</a>`);
        // The tree's own events of the house link too.
        expect(page).toMatch(new RegExp(`Died <a class="pp-link" href="#${set.personSlug.get(pid('kunhuta'))}">Kunhuta Prouzalová</a>`));
        expect(page).toMatch(/<span class="hp-nm">Drahobud [^<]*<\/span>/);
        expect(page).not.toMatch(/<a [^>]*>Drahobud/);
        // Every link of the page leads to a page of the set.
        for (const m of page.matchAll(/<a class="pp-link[^"]*" href="#([^"]+)"/g)) expect(set.bySlug.has(m[1].split('--')[0])).toBe(true);
    });

    it('a protected living person is named as the set names them, never by the research\'s name, and not linked', () => {
        for (const privacy of ['initials', 'anonymous'] as const) {
            const set = prouzalSet(undefined, { ...research(), privacy });
            const page = section(buildPageSetHtml(set), set.houseSlug!.get(HOUSE_ID)!);
            expect(page).not.toContain(LIVING_NAME);
            expect(page).not.toContain('Prouzalová</a></td><td class="hp-role">other');
            expect(set.personSlug.has(pid('bohuslava'))).toBe(false);
        }
        const initials = section(buildPageSetHtml(prouzalSet(undefined, { ...research(), privacy: 'initials' })), 'dum-belokamen-cp-16');
        expect(initials).toContain('<span class="hp-nm">B. P.</span>');
        // Full names chosen: the living person's page exists and the house leads to it.
        const full = prouzalSet(undefined, { ...research(), privacy: 'full' });
        expect(section(buildPageSetHtml(full), 'dum-belokamen-cp-16')).toContain(`<a class="pp-link" href="#${full.personSlug.get(pid('bohuslava'))}">${LIVING_NAME} Prouzalová</a>`);
    });

    it('the option Houses: pages, only a mention, none', () => {
        const pages = prouzalSet();
        const mention = prouzalSet(undefined, { houses: 'mention' });
        const none = prouzalSet(undefined, { houses: 'none' });
        // The set knows its houses whatever the option (the dialog shows the option by them).
        for (const set of [pages, mention, none]) expect([...set.houseIds!].sort()).toEqual([HOUSE_ID, OLD_HOUSE_ID].sort());
        expect(pages.options.houses).toBe('pages');
        // Pages and the index only with 'pages'.
        expect(mention.houseSlug!.size).toBe(0);
        expect(none.houseSlug!.size).toBe(0);
        expect(mention.indexSlug.houses).toBe('');
        expect(mention.pages.length).toBe(pages.pages.length - 3);
        expect(none.pages.length).toBe(mention.pages.length);
        const html = { pages: buildPageSetHtml(pages), mention: buildPageSetHtml(mention), none: buildPageSetHtml(none) };
        for (const h of [html.mention, html.none]) {
            expect(h).not.toContain('rejstrik-domy');
            expect(h).not.toContain('sp-house-link');
            expect(h).not.toContain('<article class="pp hp"');
        }
        // A mention: the line's houses as text, the house on the timeline, the person's row Houses without a link.
        const rod = (k: 'mention' | 'none') => section(html[k], [...(k === 'mention' ? mention : none).rodSlug.values()][0]);
        expect(rod('mention')).toMatch(/<section class="sp-block sp-houses">[\s\S]*<td>Bělokamen čp.\u00a016<\/td><td>1820–1920<\/td>/);
        const tl = (k: 'mention' | 'none') => section(html[k], [...(k === 'mention' ? mention : none).rodTimelineSlug.values()][0]);
        expect(tl('mention')).toContain('data-tl-k="houses"');
        const person = (k: 'mention' | 'none') => section(html[k], (k === 'mention' ? mention : none).personSlug.get(pid('hostivit'))!);
        expect(person('mention')).toContain('class="pp-houses"');
        // None: no section, no events of houses, no row Houses; the address as a plain place.
        expect(rod('none')).not.toContain('sp-houses');
        expect(tl('none')).not.toContain('data-tl-k="houses"');
        expect(tl('none')).not.toContain('sp-tl-row--house');
        expect(person('none')).not.toContain('pp-houses');
        expect(person('none')).toContain('Bělokamen');
    });

    it('the size estimate and the page count change with the option', () => {
        const size = (houses: 'pages' | 'mention' | 'none') => estimatePageSetSize(prouzalSet(undefined, { houses }));
        expect(size('mention').bytes).toBeLessThan(size('pages').bytes);
        expect(size('mention').pages).toBe(size('pages').pages - 3);
        expect(size('none').bytes).toBeLessThanOrEqual(size('mention').bytes);
    });
});
