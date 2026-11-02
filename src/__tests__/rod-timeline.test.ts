/**
 * A line's timeline (1102 §5): the events of the line's members and their
 * spouses (births, marriages in both lines, moves, emigration), the history
 * layer of the line's places, the protection of the living, and the page in
 * the page set (slug, crumbs, links from the line page and the tree's
 * introduction, the groups' switch, English texts, the controls' script).
 */

import { describe, it, expect } from 'vitest';
import { PageSet, PageSetOptions, buildPageSet } from '../family-pages.js';
import { buildPageSetHtml, renderPage } from '../family-pages-html.js';
import { buildRodTimeline, rodTimelineAxis, rodTimelineMainCentury, rodTimelineTicks, RodTimeline } from '../rod-timeline.js';
import { rodTimelineScript } from '../rod-timeline-wire.js';
import { FAMILY_PAGES_BODY_CSS } from '../family-pages-css.js';
import { PersonId, StromData } from '../types.js';
import { timelineFixture, TP_NOW } from './helpers/tree-pages-fixture.js';

const F = timelineFixture();

function count(html: string, re: RegExp): number {
    return (html.match(re) ?? []).length;
}

function tlSet(extra: Partial<PageSetOptions> = {}, data: StromData = F.data): PageSet {
    return buildPageSet(data, { kind: 'tree' }, {
        lang: 'cs', now: TP_NOW, timelines: true, history: { payload: F.history }, ...extra,
    }, { treeName: 'Rodokmen z Lopuchova' });
}

function timelineOf(set: PageSet, person: PersonId, historyOn = true): RodTimeline {
    const rodId = set.protectedTree.lineages.rodByPerson.get(person)!;
    return buildRodTimeline({
        prot: set.protectedTree, rodId, lang: set.options.lang, now: TP_NOW,
        history: { payload: F.history }, historyOn,
    })!;
}

function slugOf(set: PageSet, person: PersonId): string {
    return set.rodTimelineSlug.get(set.protectedTree.lineages.rodByPerson.get(person)!)!;
}

const full = tlSet({ privacy: 'full' });
const lhotak = timelineOf(full, F.ids.vaclav);
const thornbury = timelineOf(full, F.ids.william);

describe('the events of a line (§5.2)', () => {
    it('births, deaths and marriages of the members, sorted by year', () => {
        const years = lhotak.events.map(e => e.year);
        expect(years).toEqual([...years].sort((a, b) => a - b));
        expect(lhotak.events.some(e => e.kind === 'birth' && e.personId === F.ids.vaclav)).toBe(true);
        expect(lhotak.period?.from).toBe(1800);
        expect(lhotak.period?.to).toBe(2019);
    });

    it('a married-in wife: the marriage in the husband\'s line with her line of birth', () => {
        const m = lhotak.events.find(e => e.kind === 'marriage' && e.personId === F.ids.vaclav)!;
        expect(m.partnerId).toBe(F.ids.marie);
        expect(m.year).toBe(1872);
        expect(m.rod?.rel).toBe('birth');
        expect(m.rod?.id).toBe(full.protectedTree.lineages.rodByPerson.get(F.ids.marie));
    });

    it('a daughter\'s marriage in both lines: "into" in hers, "born into" in her husband\'s', () => {
        const own = lhotak.events.find(e => e.kind === 'marriage' && e.personId === F.ids.anna)!;
        expect(own.rod).toEqual({ id: full.protectedTree.lineages.rodByPerson.get(F.ids.william), rel: 'to' });
        const his = thornbury.events.find(e => e.kind === 'marriage' && e.partnerId === F.ids.anna)!;
        expect(his.rod).toEqual({ id: full.protectedTree.lineages.rodByPerson.get(F.ids.vaclav), rel: 'birth' });
    });

    it('moves from a residence change; a married-in spouse only from the wedding on', () => {
        const moves = lhotak.events.filter(e => e.kind === 'move');
        expect(moves.map(e => [e.year, e.from, e.place])).toEqual([
            [1870, 'Lopuchov', 'Zálesí'],
            [1879, 'Lopuchov', 'Smrkov čp. 7'],
        ]);
        // Rosálie's residence in 1860 is before her wedding (1866).
        expect(moves.some(e => e.year === 1860)).toBe(false);
    });

    it('emigration from a record and from a move abroad (by the places\' coordinates)', () => {
        const em = lhotak.events.filter(e => e.kind === 'emigration').map(e => [e.year, e.personId, e.from, e.place]);
        expect(em).toEqual([
            [1888, F.ids.anna, 'Lopuchov', 'Ashford'],
            [1985, F.ids.jiri, 'Lopuchov', 'Ashford'],
        ]);
        // The emigration record before her wedding also in her husband's line, with her line of birth.
        const there = thornbury.events.find(e => e.kind === 'emigration')!;
        expect(there.personId).toBe(F.ids.anna);
        expect(there.rod?.rel).toBe('birth');
        // The immigration record is the destination of the emigration record, not a row of its own.
        expect(lhotak.events.filter(e => e.kind === 'emigration' && e.personId === F.ids.anna)).toHaveLength(1);
    });

    it('an emigration record\'s place is the place left; an immigration record\'s the place reached', () => {
        const data: StromData = structuredClone(F.data);
        const P = data.persons;
        // Anna leaves Dolní Lhota with no record of where she went; Jiří arrives in Ashford with no record of leaving.
        P[F.ids.anna] = { ...P[F.ids.anna], events: [{ id: 'x1', type: 'emigration', date: '1888', place: 'Dolní Lhota' }] };
        P[F.ids.jiri] = { ...P[F.ids.jiri], events: [{ id: 'x2', type: 'immigration', date: '1985', place: 'Ashford' }] };
        const set = tlSet({ privacy: 'full' }, data);
        const tl = timelineOf(set, F.ids.vaclav);
        const em = tl.events.filter(e => e.kind === 'emigration').map(e => [e.year, e.personId, e.from, e.place]);
        expect(em).toEqual([
            [1888, F.ids.anna, 'Dolní Lhota', undefined],
            [1985, F.ids.jiri, 'Lopuchov', 'Ashford'],
        ]);
        const html = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(html).toContain('odkud: Dolní Lhota');
        expect(html).not.toContain('→ Dolní Lhota');
        expect(html).toContain('Lopuchov → Ashford');
    });

    it('generations as rows; at most six places', () => {
        expect(lhotak.generations.map(g => g.gen)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(lhotak.generations[0]).toMatchObject({ from: 1800, count: 1 });
        expect(lhotak.places.length).toBeLessThanOrEqual(6);
        expect(lhotak.places[0].name).toBe('Lopuchov');
    });

    it('centuries: counts and the century with the most events', () => {
        expect(lhotak.centuries.map(c => c.c)).toEqual([19, 20, 21]);
        expect(rodTimelineMainCentury(lhotak)).toBe(19);
        expect(lhotak.centuries.reduce((n, c) => n + c.count, 0)).toBe(lhotak.events.length);
    });

    it('the axis rounds to tens; ticks by the span', () => {
        expect(rodTimelineAxis(1800, 2019)).toEqual({ a: 1800, b: 2020 });
        expect(rodTimelineTicks(1800, 2020)).toEqual([1800, 1900, 2000]);
        expect(rodTimelineTicks(1880, 1990)).toEqual([1900, 1950]);
        expect(rodTimelineTicks(1890, 1960)).toEqual([1900, 1925, 1950]);
    });
});

describe('the history layer (§5.2, §5.5)', () => {
    it('events of the line\'s places within the period; the region\'s "other" and foreign places left out', () => {
        const h = lhotak.events.filter(e => e.kind === 'history').map(e => e.year);
        expect(h).toEqual([1831, 1866, 1890, 1914]);
        expect(lhotak.history).toBe(true);
        // On the same year a history row comes first.
        const i = lhotak.events.findIndex(e => e.year === 1831);
        expect(lhotak.events[i].kind).toBe('history');
    });

    it('without the history group: no bands, no rows', () => {
        const off = timelineOf(full, F.ids.vaclav, false);
        expect(off.history).toBe(false);
        expect(off.events.some(e => e.kind === 'history')).toBe(false);
    });

    it('the page without the history group: no bands, rows or History chip', () => {
        const set = tlSet({ privacy: 'full', groups: { history: false } });
        const html = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(html).not.toContain('sp-tl-band');
        expect(html).not.toContain('sp-tl-row--hist');
        expect(html).not.toContain('data-tl-k="hist"');
        expect(html).toContain('data-tl-k="birth"');
    });
});

describe('the protection of the living (§5.4)', () => {
    const set = tlSet();
    const tl = timelineOf(set, F.ids.vaclav);

    it('a living person has no event and is not counted; the generation bar ends with the last unprotected', () => {
        for (const id of [F.ids.petr, F.ids.eva]) expect(tl.events.some(e => e.personId === id || e.partnerId === id)).toBe(false);
        expect(tl.generations.map(g => g.gen)).not.toContain(7);
        expect(lhotak.generations.reduce((n, g) => n + g.count, 0)).toBeGreaterThan(tl.generations.reduce((n, g) => n + g.count, 0) - 1);
    });

    it('the page names no living person', () => {
        const html = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(html).not.toContain('Petr');
        expect(html).not.toContain('Eva');
    });
});

describe('the page in the set (§5.1)', () => {
    it('one timeline per line with a page; slug, title, crumbs and the line as parent', () => {
        const pages = full.pages.filter(p => p.kind === 'rodTimeline');
        expect(pages).toHaveLength(full.rodIds.length);
        const p = full.bySlug.get(slugOf(full, F.ids.vaclav))!;
        expect(p.slug).toBe('casova-osa-lhotak-lopuchov');
        expect(p.title).toBe('Časová osa: rod Lhoták (Lopuchov)');
        expect(p.crumbs.map(c => c.label)).toEqual(['Strom', 'Rod Lhoták (Lopuchov)', 'Časová osa']);
        expect(p.under).toBe(full.protectedTree.lineages.rodByPerson.get(F.ids.vaclav));
    });

    it('the line page links its timeline under "The line over time"; the tree\'s card too', () => {
        const rodSlug = full.bySlug.get(slugOf(full, F.ids.vaclav))!.crumbs[1].slug!;
        const line = renderPage(full, rodSlug);
        expect(line).toContain('class="sp-tl-go"');
        expect(line).toContain('data-sp-open="page:casova-osa-lhotak-lopuchov"');
        const hub = renderPage(full, full.introSlug);
        expect(hub).toContain('sp-card-tl');
        expect((hub.match(/sp-card-tl/g) ?? []).length).toBe(full.rodIds.length);
    });

    it('the page: header, controls, overview and the centuries, the main century open', () => {
        const html = renderPage(full, slugOf(full, F.ids.vaclav));
        expect(html).toContain('<h1');
        expect(html).toContain('class="sp-tl"');
        expect(html).toContain('data-main="19"');
        expect(html).toContain('data-tl-c="19"');
        expect(html).toMatch(/<details class="sp-tl-c" data-c="19" open/);
        expect(html).toContain('Smrkov čp. 7');
        expect(html).toContain('Prusko-rakouská válka');
        // The places' rows carry their own class: on a phone a long name takes two lines and its row grows with it.
        expect(count(html, /class="sp-tl-lab sp-tl-lab--pl/g)).toBeGreaterThan(0);
        expect(count(html, /class="sp-tl-r sp-tl-r--pl/g)).toBe(count(html, /class="sp-tl-lab sp-tl-lab--pl/g));
        expect(count(html, /<span class="sp-tl-pln">/g)).toBe(count(html, /class="sp-tl-lab sp-tl-lab--pl/g));
    });

    it('the saved file: links by anchor, every century open without scripts, the controls\' script inside', () => {
        const html = buildPageSetHtml(full);
        expect(html).toContain('href="#casova-osa-lhotak-lopuchov"');
        const page = html.slice(html.indexOf('id="casova-osa-lhotak-lopuchov"'));
        const one = page.slice(0, page.indexOf('<section class="sp-page', 10));
        expect((one.match(/<details class="sp-tl-c"[^>]* open/g) ?? []).length).toBe(3);
        expect(html).toContain('data-tl-on');
    });

    it('without timelines: no pages, no links', () => {
        const set = tlSet({ privacy: 'full', timelines: false });
        expect(set.pages.some(p => p.kind === 'rodTimeline')).toBe(false);
        expect(renderPage(set, set.introSlug)).not.toContain('sp-card-tl');
        const rodSlug = set.pages.find(p => p.kind === 'rod')!.slug;
        expect(renderPage(set, rodSlug)).not.toContain('sp-tl-go');
    });

    it('English texts (§5.6)', () => {
        const set = tlSet({ privacy: 'full', lang: 'en' });
        const p = set.bySlug.get(slugOf(set, F.ids.vaclav))!;
        expect(p.title).toContain('family line over time');
        const html = renderPage(set, p.slug);
        expect(html).toContain('history · war');
        expect(html).toContain('19th century');
    });

    it('the chips carry their kind\'s symbol, hidden from screen readers; History keeps the dot', () => {
        const html = renderPage(full, slugOf(full, F.ids.vaclav));
        const chip = (k: string) => new RegExp(`<button type="button" class="sp-tl-chip" data-tl-k="${k}" aria-pressed="true">(<span[^>]*>[^<]*</span>)`).exec(html)?.[1];
        expect(chip('birth')).toBe('<span class="sp-tl-sym" aria-hidden="true">*</span>');
        expect(chip('marriage')).toBe('<span class="sp-tl-sym" aria-hidden="true">⚭</span>');
        expect(chip('death')).toBe('<span class="sp-tl-sym" aria-hidden="true">†</span>');
        expect(chip('move')).toBe('<span class="sp-tl-sym" aria-hidden="true">→</span>');
        expect(chip('hist')).toBe('<span class="sp-tl-dot" aria-hidden="true"></span>');
        expect(html).not.toMatch(/data-tl-k="(?!hist)\w+" aria-pressed="true"><span class="sp-tl-dot"/);
        // A chip turned off greys its symbol as it greys the dot.
        expect(FAMILY_PAGES_BODY_CSS).toMatch(/\.sp-tl-chip\[aria-pressed="false"\] \.sp-tl-sym \{ color: var\(--text-faint\)/);
    });

    it('the controls\' script is valid source text', () => {
        expect(() => new Function(rodTimelineScript())).not.toThrow();
    });
});
