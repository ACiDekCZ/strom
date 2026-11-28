/**
 * The Houses chapter of the family book (spec 030 §8, K7.3): the houses of
 * the book's people with their history done by the research or above the
 * threshold, set as a chapter of the book (not as the app shows a house):
 * the introduction, then for each house its heading, its name after the farm
 * in italics, the research's description of the building, Numbers over
 * time, the Timeline (the tree's records and the research's events),
 * Holders, Residents and Of note, the research's sources as numbered notes
 * at the end of the chapter.
 *
 * As outputs show a house (§10, src/house-privacy.ts): the living as the
 * book's privacy names them, people of the last ~100 years by name and role
 * only, the research's events of those years and its sensitive events left
 * out, the location only of a house without people of those years and not
 * hidden by hand (spec 145 T3: a cut of today's map, its coordinates, how sure
 * it is; the book option off: the town only); a note at the end
 * says what is left out. Its story a draft too, printed as the story (spec 145 T8). The
 * pictures of the house and its town under a free licence (spec 145 T8): from
 * the web by the setting "Web photos in outputs" (default; a plain http(s)
 * <img>, without the network the caption with its link stays) or the caption
 * and the link only. Pure and DOM-free.
 */

import type { PersonId, StromData } from './types.js';
import type { BookCtx, BookHouseEntry } from './book-blocks.js';
import type { HouseResearch, HouseSource, HouseStoryText } from './house-bridge.js';
import { safeHttpUrl } from './validation.js';
import { proseHtml } from './story-text.js';
import { getStringsForLang } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { shownName } from './person-name.js';
import { houseInteresting, houseTitle, type TreeHouse } from './houses.js';
import { houseTreeRows } from './house-page.js';
import { researchSourceRef } from './research-link.js';
import { houseCoordsText, houseSureText, type HouseMapPoint } from './house-map.js';
import type { HouseMapShot } from './house-map-shot.js';

/** One house of the chapter: as the index of houses shows it, with the research's result for its sources and building. */
export interface BookHouseChapterEntry extends BookHouseEntry {
    research: HouseResearch | null;
    /** Its story as outputs show it (houseStoryForOutput, spec 145 T4; a draft as the story, T8); null none. */
    story?: HouseStoryText | null;
    /**
     * Its location, where outputs may show it and the book does (spec 145 T3): the point, how sure it is, the cut of
     * today's map made before the book (null: the coordinates only).
     */
    map?: { point: HouseMapPoint; sure: 'confirmed' | 'assumed'; shot: HouseMapShot | null } | null;
}

/** The anchor of a house in the chapter (a person's story links to it). */
export function bookHouseAnchor(h: Pick<TreeHouse, 'id'>): string {
    return `kap-dum-${h.id.replace(/[^a-z0-9]+/gi, '-')}`;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "commons.wikimedia.org" of an address (its link's text). */
function hostOf(url: string): string {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/**
 * The pictures of a house in the chapter (spec 145 T8): the house's own, then its town's not shown at an earlier
 * house of the chapter (`seen`). Each its caption (what it shows, author · licence · link); with `web` the picture
 * itself from its address (no referrer, empty alt: without the network it takes no room).
 */
function picturesHtml(research: HouseResearch | null, web: boolean, seen: Set<string>, townLabel: string): string {
    const fig = (url: string, what: string, by: string): string => {
        const img = web ? `<img class="book-house-img" src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : '';
        const link = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(url))} ↗</a>`;
        return `<figure class="book-house-fig${web ? '' : ' book-house-fig--link'}">${img}<figcaption>`
            + `${what ? `<span class="book-house-fig-what">${esc(what)}</span>` : ''}`
            + `<span class="book-house-fig-by">${by ? `${esc(by)} · ` : ''}${link}</span></figcaption></figure>`;
    };
    const own = (research?.look?.images ?? []).flatMap(im => {
        const url = im.license && im.url ? safeHttpUrl(im.url) : null;
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [fig(url, '', [im.credit, im.license].filter(Boolean).join(' · '))];
    });
    const town = (research?.town?.pictures ?? []).flatMap(p => {
        const url = safeHttpUrl(p.url);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [fig(url, p.shows, [p.credit, p.license].filter(Boolean).join(' · '))];
    });
    return (own.length ? `<div class="book-house-figs">${own.join('')}</div>` : '')
        + (town.length ? `<div class="book-sub">${esc(townLabel)}</div><div class="book-house-figs">${town.join('')}</div>` : '');
}

/** The chapter's notes: each source once, numbered in the order it is first cited. */
class HouseNotes {
    readonly list: string[] = [];
    private readonly no = new Map<string, number>();

    constructor(private readonly sources: StromData['sources']) {}

    private text(s: HouseSource): string {
        if ('url' in s) {
            try { return new URL(s.url).host.replace(/^www\./, ''); } catch { return ''; }
        }
        for (const src of Object.values(this.sources ?? {})) {
            if (researchSourceRef(src.refn) === s.source) return [src.title, s.page].filter(Boolean).join(', ');
        }
        return '';
    }

    /** The marks of an item's sources ('' without a source the book can name). */
    cite(sources: readonly HouseSource[]): string {
        const marks: number[] = [];
        for (const s of sources) {
            const text = this.text(s);
            if (!text) continue;
            let n = this.no.get(text);
            if (n === undefined) {
                this.list.push(text);
                n = this.list.length;
                this.no.set(text, n);
            }
            if (!marks.includes(n)) marks.push(n);
        }
        return marks.length ? `<sup class="book-house-fn-mark">${marks.join(',')}</sup>` : '';
    }
}

/**
 * The chapter's HTML ('' without a house to show). `from` is the first year of the last ~100 years
 * (housePrivacyContext): a year from it on stays out. `sources`: the tree's catalog before protection (the
 * book's drops a source no shown person cites, while the research's items of the house cite it).
 */
export function housesChapterHtml(ctx: BookCtx, entries: readonly BookHouseChapterEntry[], from: number,
    sources: StromData['sources'] = ctx.tree.sources, webPhotos = true): string {
    const S = getStringsForLang(ctx.lang);
    const B = S.book;
    const H = S.houses;
    const P = H.page;
    const notes = new HouseNotes(sources);
    const old = (y: number | null | undefined): y is number => y !== null && y !== undefined && y < from;
    const yearText = (d: string | number | undefined): string => {
        if (d === undefined || d === '') return '';
        const y = typeof d === 'number' ? d : yearOf(d);
        if (!old(y)) return '';
        return typeof d === 'number' ? String(d) : formatFlexDate(d, ctx.lang) || d;
    };
    const span = (a: string | number | undefined, b: string | number | undefined): string => {
        const x = yearText(a), y = yearText(b);
        if (x && y) return x === y ? x : `${x}–${y}`;
        if (x) return P.fromYear(x);
        if (y) return P.untilYear(y);
        return '';
    };
    const nameOf = (id: PersonId): string => {
        const p = ctx.tree.persons[id];
        return p && !p.isPlaceholder ? shownName(p) : '';
    };
    let shielded = false;
    const houses: string[] = [];
    const seenPictures = new Set<string>();
    for (const e of entries) {
        const h = e.house;
        const out = e.out;
        if (out.hidden.events || out.hidden.facts || out.hidden.location || out.persons.some(p => p.recent || p.living)) shielded = true;
        const parts: string[] = [`<h3>${esc(houseTitle(h))}</h3>`];
        if (e.name) parts.push(`<div class="book-house-alias"><em>${esc(e.name)}</em></div>`);
        // Its story first (spec 145 T4): the approved text, or a draft printed as the story (T8); its sources among the chapter's notes.
        if (e.story) {
            const body = proseHtml(e.story.text, { headingLevel: 5, softBreak: 'space', dropStrayMarks: true });
            if (body) {
                const title = e.story.title ? `<h4 class="book-house-story-title">${esc(e.story.title)}</h4>` : '';
                const marks = notes.cite(e.story.sources);
                parts.push(`<div class="book-story book-house-story">${title}${body}`
                    + `${marks ? `<p class="book-house-story-src">${marks}</p>` : ''}</div>`);
            }
        }
        // The research's description of the building, its pictures and its town's (spec 145 T8).
        const look = e.research?.look?.text?.trim();
        if (look) parts.push(`<p class="book-house-text">${esc(look)}</p>`);
        const pictures = picturesHtml(e.research, webPhotos, seenPictures, P.lookPictures);
        if (pictures) parts.push(pictures);
        // Its location (spec 145 T3): the cut of today's map with the house's point, its coordinates, how sure it is.
        if (e.map) {
            const shot = e.map.shot;
            const img = shot ? `<img class="book-house-map-img" src="${esc(shot.src)}" alt="${esc(P.map.shotAlt(h.text))}"`
                + ` width="${shot.width}" height="${shot.height}">` : '';
            const attr = shot ? `<span class="book-house-map-attr">${esc(shot.attribution)}</span>` : '';
            parts.push(`<figure class="book-house-map${shot ? '' : ' book-house-map--words'}">${img}<figcaption>`
                + `<span class="book-house-map-pos">${esc(houseCoordsText(e.map.point))} · ${esc(houseSureText(ctx.lang, e.map.sure))}</span>`
                + `${attr}</figcaption></figure>`);
        }

        // Numbers over time: a number's years before the last ~100 years ("1838–" when the span reaches them).
        const numbers = e.numbers.map(n => {
            const years = n.from !== undefined && old(n.from)
                ? (n.to !== undefined && old(n.to) ? (n.from === n.to ? String(n.from) : `${n.from}–${n.to}`) : `${n.from}–`)
                : '';
            return `<b>${esc(years)}</b><span>${esc(n.house)}</span>`;
        });
        if (e.numbers.length > 1 || e.numbers.some(n => n.source === 'research')) {
            parts.push(`<div class="book-sub">${esc(P.sec.numbers)}</div><div class="book-house-rows">${numbers.join('')}</div>`);
        }

        // The timeline: the tree's records the output may show and the research's events, by year.
        const rows: { year: number | null; html: string }[] = [];
        for (const r of houseTreeRows(h, out.facts, ctx.tree, ctx.lang)) {
            const names = r.persons.map(nameOf).filter(Boolean);
            const y = r.year !== undefined && old(r.year) ? r.year : null;
            rows.push({ year: y, html: esc([r.label, names.join(` ${B.and} `)].filter(Boolean).join(' · ')) });
        }
        for (const ev of out.timeline) {
            const y = yearOf(ev.date);
            rows.push({ year: old(y) ? y : null, html: `${esc(ev.text)}${notes.cite(ev.sources)}` });
        }
        rows.sort((a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY));
        if (rows.length) {
            parts.push(`<div class="book-sub">${esc(P.sec.timeline)}</div><div class="book-house-rows">`
                + rows.map(r => `<b>${r.year ?? ''}</b><span>${r.html}</span>`).join('') + '</div>');
        }

        // Holders and residents (the research's): the living as the privacy names them, of the last ~100 years without years.
        const who = (personId: PersonId | null, name: string, living: boolean): string =>
            esc((personId ? nameOf(personId) || (living ? '' : name) : name)) || '?';
        if (out.holders.length) {
            const trs = out.holders.map(x => `<tr><td>${who(x.personId, x.item.name, x.living)}${notes.cite(x.item.sources)}</td>`
                + `<td>${x.noYears ? '' : esc(span(x.item.from, x.item.to))}</td>`
                + `<td>${x.owned && x.item.how ? esc(P.how[x.item.how]) : ''}</td></tr>`).join('');
            parts.push(`<div class="book-sub">${esc(P.holders)}</div><table class="book-house-table"><thead><tr><th>${esc(P.colHolder)}</th>`
                + `<th>${esc(P.colWhen)}</th><th>${esc(P.colHow)}</th></tr></thead><tbody>${trs}</tbody></table>`);
        }
        if (out.residents.length) {
            const trs = out.residents.map(x => `<tr><td>${who(x.personId, x.item.name, x.living)}${notes.cite(x.item.sources)}</td>`
                + `<td>${x.item.role ? esc(P.role[x.item.role]) : ''}</td>`
                + `<td>${x.noYears ? '' : esc(span(x.item.from, x.item.to))}</td></tr>`).join('');
            parts.push(`<div class="book-sub">${esc(P.residents)}</div><table class="book-house-table"><thead><tr><th>${esc(P.colResident)}</th>`
                + `<th>${esc(P.colRole)}</th><th>${esc(P.colWhen)}</th></tr></thead><tbody>${trs}</tbody></table>`);
        }

        // Of note: one family N years, the numbers, the oldest record (one of the last ~100 years left out).
        // One family's years only over the records the output shows (not up to a record of the last ~100 years).
        const shown = out.facts.map(f => f.year).filter((y): y is number => y !== undefined);
        const familyYears = h.familyYears && shown.length ? Math.min(h.familyYears, Math.max(...shown) - Math.min(...shown)) : 0;
        const items = houseInteresting({ ...h, familyYears, numbers: [...e.numbers] })
            .filter(it => it.kind !== 'oldest' || old(it.year))
            .map(it => it.kind === 'family' ? H.family(it.years) : it.kind === 'numbers' ? H.numbers(it.count) : H.oldest(it.year));
        if (items.length) parts.push(`<p class="book-house-note"><em>${esc(B.housesInteresting)}:</em> ${esc(items.join(' · '))}.</p>`);
        houses.push(`<div class="book-house-ch" id="${esc(bookHouseAnchor(h))}">${parts.join('')}</div>`);
    }
    if (!houses.length) return '';
    const fns = notes.list.map((t, i) => `<p><span class="book-pn">${i + 1}</span>${esc(t)}</p>`).join('');
    // With the locations on (spec 145 T3) the book gives the location of a house without people of those years.
    const note = shielded
        ? `<p class="book-house-protected">${esc((entries.some(e => e.map) ? B.houseChapterProtected : B.houseIndexProtected)(from - 1))}</p>` : '';
    const foot = fns || note ? `<div class="book-house-fns">${fns}${note}</div>` : '';
    return `<h2 class="book-houses-h">${esc(B.parts.houses)}</h2>`
        + `<p class="book-houses-intro">${esc(B.housesIntro)}</p>${houses.join('')}${foot}`;
}
