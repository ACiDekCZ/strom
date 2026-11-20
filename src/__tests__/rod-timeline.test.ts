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
import { buildRodTimeline, rodTimelineAxis, rodTimelineHistKinds, rodTimelineMainCentury, rodTimelineTicks, RodTimeline } from '../rod-timeline.js';
import { rodTimelineScript } from '../rod-timeline-wire.js';
import { FAMILY_PAGES_BODY_CSS } from '../family-pages-css.js';
import { HISTORY_KINDS, HistoryPayload } from '../history.js';
import { historyKindSvg } from '../history-symbols.js';
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

describe('history on the page: symbols and the kinds\' filter (121 §9)', () => {
    const html = renderPage(full, slugOf(full, F.ids.vaclav));
    const overview = html.slice(html.indexOf('<div class="sp-tl-plot">'), html.indexOf('</section>', html.indexOf('<div class="sp-tl-plot">')));
    const rowOf = (place: string): string => {
        const i = overview.indexOf(`title="${place} · `);
        const start = overview.lastIndexOf('<span class="sp-tl-r', i);
        const next = overview.indexOf('<span class="sp-tl-r', i);
        return overview.slice(start, next < 0 ? undefined : next);
    };

    it('a band of the region\'s history carries its kind\'s symbol of 11 px on top', () => {
        const bands = [...overview.matchAll(/<span class="sp-tl-band" data-hk="(\w+)" data-f="(\d+)"/g)].map(m => `${m[2]}:${m[1]}`);
        expect(bands).toEqual(['1866:war', '1914:war']);
        for (const y of ['1866', '1914']) {
            expect(overview).toMatch(new RegExp(`<span class="sp-tl-bandsym" data-hk="war" data-f="${y}" data-t="${+y + 1}" data-pt="" style="left:[\\d.]+%" title="[^"]+" aria-hidden="true">${historyKindSvg('war', 11).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`));
        }
        expect(FAMILY_PAGES_BODY_CSS).toMatch(/\.sp-tl-bandsym \{[^}]*color: var\(--hist-text\)/);
    });

    it('a place\'s own history is a symbol on the place\'s row, not a band across the chart', () => {
        expect(overview).not.toMatch(/class="sp-tl-band"[^>]* data-f="1831"/);
        expect(overview).not.toMatch(/class="sp-tl-band"[^>]* data-f="1890"/);
        const lop = rowOf('Lopuchov');
        expect(lop).toContain(`<span class="sp-tl-locsym is-place" data-hk="epidemic" data-f="1831" data-t="1832" data-pt="" style="left:`);
        expect(lop).toContain('title="1831 · Cholera v Lopuchově"');
        expect(lop).toContain(`data-hk="other" data-f="1890"`);
        expect(count(overview, /class="sp-tl-locsym/g)).toBe(2);
        expect(rowOf('Kvasín')).not.toContain('sp-tl-locsym');
        // 18 × 18 on the surface in the origin's colour, 16 px on a phone.
        expect(FAMILY_PAGES_BODY_CSS).toMatch(/\.sp-tl-locsym \{[^}]*width: 18px; height: 18px;[^}]*border: 1px solid currentColor; border-radius: var\(--r-tag\); background: var\(--surface\); color: var\(--hist-place-text\)/);
        expect(FAMILY_PAGES_BODY_CSS).toMatch(/@media \(max-width: 640px\) \{[^@]*\.sp-tl-locsym \{ top: 8px; width: 16px; height: 16px; \}/);
        expect(html).toContain('Symboly na řádku obce = místní dějiny.');
    });

    it('a finding of the records on its place\'s row in the colour of findings; a place without a row keeps its band', () => {
        const lop = Object.keys(F.history.places)[0];
        const payload: HistoryPayload = {
            ...F.history,
            events: [...F.history.events, { ...F.history.events.find(e => e.id === 'lop-1890')!, id: 'lop-1902', from: 1902, kind: 'disaster', scope: 'local', text: { cs: 'Kroupy' } }],
            places: { ...F.history.places, [lop]: { ...F.history.places[lop], events: [...F.history.places[lop].events, 'lop-1902'] } },
        };
        const set = tlSet({ privacy: 'full', history: { payload } });
        const page = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(page).toContain('<span class="sp-tl-locsym is-local" data-hk="disaster" data-f="1902"');
        expect(page).toContain('<li class="sp-tl-row sp-tl-row--hist is-local" data-k="hist" data-hk="disaster">');
        expect(FAMILY_PAGES_BODY_CSS).toContain('.sp-tl-locsym.is-local { color: var(--hist-local-text); }');
    });

    it('the list: the kind\'s symbol of 12 px before "history · kind", the colour of the origin, the place after the text', () => {
        const row = (y: number) => new RegExp(`<li class="sp-tl-row sp-tl-row--hist ([\\w-]+)" data-k="hist" data-hk="(\\w+)"><span class="sp-tl-y">${y}</span><div class="sp-tl-b"><span class="sp-tl-k">(<svg[^]*?</svg>)dějiny · [^<]+</span>`).exec(html);
        expect(row(1866)?.slice(1)).toEqual(['is-region', 'war', historyKindSvg('war', 12)]);
        expect(row(1831)?.slice(1)).toEqual(['is-place', 'epidemic', historyKindSvg('epidemic', 12)]);
        expect(html).toMatch(/Cholera v Lopuchově<\/span> <span class="sp-tl-pl">· Lopuchov<\/span>/);
        // One region: no region after the text.
        expect(html).toMatch(/Prusko-rakouská válka<\/span><\/span>/);
        expect(FAMILY_PAGES_BODY_CSS).toContain('.sp-tl-row--hist.is-place .sp-tl-k { color: var(--hist-place-text); }');
        expect(FAMILY_PAGES_BODY_CSS).toContain('.sp-tl-row--hist .sp-tl-k { color: var(--hist-text); }');
    });

    it('two regions: each region event names its region after the text', () => {
        const payload: HistoryPayload = {
            ...F.history,
            events: F.history.events.map(e => e.id === 'cz-1914' ? { ...e, region: { id: 'cz-moravia', name: { cs: 'Morava', en: 'Moravia' } } } : e),
        };
        const set = tlSet({ privacy: 'full', history: { payload } });
        const tl = buildRodTimeline({ prot: set.protectedTree, rodId: set.protectedTree.lineages.rodByPerson.get(F.ids.vaclav)!, lang: 'cs', now: TP_NOW, history: { payload } })!;
        const h = tl.events.filter(e => e.history).map(e => [e.year, e.history!.region ?? e.history!.place]);
        expect(h).toEqual([[1831, 'Lopuchov'], [1866, 'Čechy'], [1890, 'Lopuchov'], [1914, 'Morava']]);
        const page = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(page).toMatch(/Prusko-rakouská válka<\/span> <span class="sp-tl-pl">· Čechy<\/span>/);
        expect(lhotak.events.some(e => e.history?.region)).toBe(false);
    });

    it('the second row of chips: "Kinds of history", All and the kinds on the page, each with its symbol; the script\'s only', () => {
        expect(rodTimelineHistKinds(lhotak)).toEqual(['war', 'epidemic', 'other']);
        const at = html.indexOf('<div class="sp-tl-ctl js-only">');
        const ctl = html.slice(at, html.indexOf('<section', at));
        const row = ctl.slice(ctl.indexOf('<div class="sp-tl-chips sp-tl-hkrow"'));
        expect(row).toMatch(/^<div class="sp-tl-chips sp-tl-hkrow" role="group" aria-label="Druhy dějin"><span class="sp-tl-chips-lab" aria-hidden="true">Druhy dějin:<\/span>/);
        expect([...row.matchAll(/data-tl-hk="(\w*)" aria-pressed="(\w+)"/g)].map(m => `${m[1]}:${m[2]}`)).toEqual([':true', 'war:false', 'epidemic:false', 'other:false']);
        expect(row).toContain(`data-tl-hk="war" aria-pressed="false">${historyKindSvg('war', 14)}Válka</button>`);
        expect(row).toContain('data-tl-hk="" aria-pressed="true">Vše</button>');
        // Under the first row, inside the controls only the script shows.
        expect(ctl.indexOf('sp-tl-hkrow')).toBeGreaterThan(ctl.indexOf('data-tl-k="hist"'));
    });

    it('no row of kinds with one kind of history or without the history group', () => {
        const payload: HistoryPayload = { ...F.history, events: F.history.events.filter(e => e.kind === 'war') };
        const one = tlSet({ privacy: 'full', history: { payload } });
        expect(renderPage(one, slugOf(one, F.ids.vaclav))).not.toContain('data-tl-hk');
        const off = tlSet({ privacy: 'full', groups: { history: false } });
        expect(renderPage(off, slugOf(off, F.ids.vaclav))).not.toContain('data-tl-hk');
    });

    it('English: Kinds of history, All, the kinds\' names', () => {
        const set = tlSet({ privacy: 'full', lang: 'en' });
        const page = renderPage(set, slugOf(set, F.ids.vaclav));
        expect(page).toContain('aria-label="Kinds of history"');
        expect(page).toContain('data-tl-hk="" aria-pressed="true">All</button>');
        expect(page).toContain('Epidemic</button>');
        expect(page).toContain('Symbols on a place’s row = local history.');
    });

    it('the stylesheet hides each kind left out (rows, bands and symbols) and the row with History off, on screen only', () => {
        for (const k of HISTORY_KINDS) expect(FAMILY_PAGES_BODY_CSS).toContain(`.sp-tl[data-hk-off~="${k}"] [data-hk="${k}"]`);
        const screen = FAMILY_PAGES_BODY_CSS.slice(FAMILY_PAGES_BODY_CSS.indexOf('@media screen {'));
        const block = screen.slice(0, screen.indexOf('\n}'));
        expect(block).toContain('.sp-tl[data-hk-off~="war"] [data-hk="war"]');
        expect(block).toContain('.sp-tl[data-off~="hist"] .sp-tl-hkrow');
        expect(block).toContain('.sp-tl[data-off~="hist"] .sp-tl-locsym');
        expect(block).toContain('.sp-tl[data-off~="hist"] .sp-tl-bandsym');
        // Every history element carries its kind.
        expect(count(html, /class="sp-tl-row sp-tl-row--hist[^"]*" data-k="hist" data-hk="\w+"/g)).toBe(4);
        expect(count(html, /class="sp-tl-(?:band|bandsym|locsym[^"]*)" data-hk="\w+"/g)).toBe(2 * 2 + 2);
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
        // A bar of one year says the year once ("Zálesí · 1870", not "1870–1870").
        expect(html).not.toMatch(/title="[^"]* · (\d{4})–\1"/);
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

    it('the chips carry their kind\'s symbol, hidden from screen readers; History the symbol of "other" (121 §9)', () => {
        const html = renderPage(full, slugOf(full, F.ids.vaclav));
        const chip = (k: string) => new RegExp(`<button type="button" class="sp-tl-chip sel-opt" data-tl-k="${k}" aria-pressed="true">(<span[^>]*>[^<]*</span>)`).exec(html)?.[1];
        expect(chip('birth')).toBe('<span class="sp-tl-sym" aria-hidden="true">*</span>');
        expect(chip('marriage')).toBe('<span class="sp-tl-sym" aria-hidden="true">⚭</span>');
        expect(chip('death')).toBe('<span class="sp-tl-sym" aria-hidden="true">†</span>');
        expect(chip('move')).toBe('<span class="sp-tl-sym" aria-hidden="true">→</span>');
        expect(html).toContain(`data-tl-k="hist" aria-pressed="true">${historyKindSvg('other', 14)}Dějiny</button>`);
        expect(html).not.toContain('sp-tl-dot');
        // A chip turned off greys its symbol.
        expect(FAMILY_PAGES_BODY_CSS).toMatch(/\.sp-tl-chip\[aria-pressed="false"\] \.sp-tl-sym, \.sp-tl-chip\[data-tl-k\]\[aria-pressed="false"\] \.hist-kind-svg \{ color: var\(--text-faint\)/);
    });

    it('the chips mark the choice as the app\'s options ("Linka", .sel-opt), not with a frame of their own (121 §9)', () => {
        const html = renderPage(full, slugOf(full, F.ids.vaclav));
        expect(count(html, /class="sp-tl-chip"/g)).toBe(0);
        expect(count(html, /class="sp-tl-chip sel-opt"/g)).toBe(5 + 4);
        const rule = /\.sp-tl-chip \{([^}]*)\}/.exec(FAMILY_PAGES_BODY_CSS)![1];
        expect(rule).not.toMatch(/border|background|color/);
        expect(FAMILY_PAGES_BODY_CSS).not.toMatch(/\.sp-tl-chip\[aria-pressed="false"\] \{/);
        // The saved file carries the indicator's rules.
        expect(buildPageSetHtml(full)).toContain('.sel-opt {');
    });

    it('the controls\' script is valid source text', () => {
        expect(() => new Function(rodTimelineScript())).not.toThrow();
    });
});
