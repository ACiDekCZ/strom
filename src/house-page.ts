/**
 * The house page (spec 030 §3, K3.1, K3.2, K7.1): a sibling of the person
 * page (src/person-page.ts), built here as plain HTML for the window
 * (`mode: 'app'`) and for the saved file (`mode: 'file'`).
 *
 * Order: the header (kicker, the house, its name after the farm, the facts),
 * In brief, Numbers over time, Timeline, Holders and residents, The building,
 * Map (§4, `mapHtml`), What is not known, What was searched (+ Only in the
 * reading room), Sources and materials. A section without content is left
 * out, and so is its entry in the contents. A house the research has no
 * result of (only the tree, queued, no research) shows the header, In brief,
 * the numbers, the tree's timeline, "Residents from the tree" and one quiet
 * sentence instead of the research's sections.
 *
 * The app shows everything. The file goes through houseOutputFilter
 * (src/house-privacy.ts, K1.4a, K3.3): people of the last ~100 years by name
 * and role only, their facts left out, the living named as an output names
 * them (initials), today's owners and residents never, sensitive events
 * until a person reveals them, the location only for a house without people
 * of the last ~100 years. Nothing in the file calls the network.
 */

import type { PersonId, PlaceRecord, StromData } from './types.js';
import type {
    HouseCertainty, HouseEvent, HouseHolder, HouseMaterial, HouseNumberItem, HouseResearch, HouseResident, HouseSource, HouseState,
    HouseUnknown,
} from './house-bridge.js';
import type { LiveHouseLayer } from './research-link.js';
import { houseFacts, houseLabel, houseTitle, type HouseFact, type TreeHouse } from './houses.js';
import { houseKey } from './places.js';
import { houseOutputFilter, housePrivacyContext, type HouseOutput } from './house-privacy.js';
import { applyLivingPrivacy } from './privacy.js';
import { getStringsForLang, joinAnd, type Language } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { shownName } from './person-name.js';
import { lifeEventLabel, coupleEventLabelIn } from './person-sources.js';
import { researchSourceRef } from './research-link.js';
import { safeHttpUrl } from './validation.js';
import { asciiSlug } from './filenames.js';
import { createdWithStromHtml, personPageDocumentShell } from './person-page.js';
import { HOUSE_PAGE_CSS, HOUSE_PAGE_FILE_TOKENS } from './house-page-css.js';
import { houseMapHtml, type HouseMapInput } from './house-map.js';

export type HousePageMode = 'app' | 'file';

/** What the window adds to the page in the app (none in the file). */
export interface HousePageApp {
    /** The research's state of the house with its action (§2), drawn by the window; '' none. */
    stateHtml?: string;
    /** The materials' actions (Attach material…, Take over research from a file…), drawn by the window; '' none. */
    materialActionsHtml?: string;
    /** Attach material… under a look not known (spec 145 T1: `house.material`, a tree that can be changed); '' none. */
    lookAttachHtml?: string;
    /** A renumbering's Confirm / Not the same house (`house.confirm`, a tree that can be changed). */
    canConfirm?: boolean;
    /** The name after the farm, the reveal of a sensitive event: a tree that can be changed. */
    canEdit?: boolean;
}

export interface HousePageOptions {
    lang: Language;
    /** "Now" for the ~100 years and the file's date (fixed in tests). */
    now: Date;
    /** The tree has a research that knows houses (`house`): the sentence of a house without a result says so. */
    research?: boolean;
    /** The research's state of the house (none: it does not know the house). */
    state?: HouseState | null;
    /** The research knows the look of houses (`house.look`): a researched house without one says it is not known. */
    look?: boolean;
    /** The research's map layers (`/status.houses.layers`), for the map (§4). */
    layers?: readonly LiveHouseLayer[];
    app?: HousePageApp;
}

export type { HouseMapInput } from './house-map.js';

/** The map section's body (§4, the map of the house, src/house-map.ts): '' = no section. */
export function mapHtml(input: HouseMapInput): string {
    return houseMapHtml(input);
}

/** A section of the page: its key, its id and the contents' label. */
export interface HousePageSection {
    key: HousePageSectionKey;
    id: string;
    label: string;
}

export type HousePageSectionKey = 'sum' | 'numbers' | 'timeline' | 'people' | 'treeResidents' | 'look' | 'map' | 'unknown' | 'passed' | 'sources';

const SECTION_KEYS: readonly HousePageSectionKey[] = ['sum', 'numbers', 'timeline', 'people', 'treeResidents', 'look', 'map', 'unknown', 'passed', 'sources'];

export const housePageSectionId = (key: HousePageSectionKey): string => `hp-sec-${key}`;

function esc(text: string): string {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

type HS = ReturnType<typeof getStringsForLang>['houses'];

interface Ctx {
    mode: HousePageMode;
    app: boolean;
    lang: Language;
    H: HS;
    P: HS['page'];
    /** The data the names come from: the app's own, the file's under the living privacy (initials). */
    names: StromData;
    data: StromData;
    house: TreeHouse;
    research: HouseResearch | null;
    /** The file's filter (null in the app). */
    out: HouseOutput | null;
    opts: HousePageOptions;
    /** The tree's person of a research person ref (P…). */
    personOfRef: (ref: string | undefined) => PersonId | null;
    /** The file: the house has people of the last ~100 years (its name after the farm stays out, as in privacy.ts). */
    recentHouse: boolean;
    /** The file: the first year of the last ~100 years (the tree's years from it stay out); null in the app. */
    recentFrom: number | null;
}

const cap = (s: string, lang: Language): string => (s ? s.charAt(0).toLocaleUpperCase(lang) + s.slice(1) : s);

function quoted(text: string, lang: Language): string {
    return lang === 'en' ? `“${text}”` : lang === 'pl' ? `„${text}”` : `„${text}“`;
}

function dayText(iso: string | undefined, lang: Language): string {
    const day = iso?.slice(0, 10);
    return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFlexDate(day, lang) : '';
}

function yearsSpan(c: Ctx, from: string | number | undefined, to: string | number | undefined): string {
    const a = typeof from === 'number' ? String(from) : from ? (formatFlexDate(from, c.lang) || from) : '';
    const b = typeof to === 'number' ? String(to) : to ? (formatFlexDate(to, c.lang) || to) : '';
    if (a && b) return a === b ? a : `${a}–${b}`;
    if (a) return c.P.fromYear(a);
    if (b) return c.P.untilYear(b);
    return '';
}

function personName(c: Ctx, id: PersonId): string {
    const p = c.names.persons[id];
    return p ? shownName(p) : '';
}

/** A person of the tree: a link in the app, a name in the file. */
function personHtml(c: Ctx, id: PersonId, fallback = ''): string {
    const name = personName(c, id) || fallback;
    if (!name) return '';
    return c.app
        ? `<button type="button" class="pp-link hp-person" data-person-id="${esc(id)}">${esc(name)}</button>`
        : `<span class="hp-nm">${esc(name)}</span>`;
}

function tag(cls: string, text: string): string {
    return `<span class="hp-otag hp-otag--${cls}">${esc(text)}</span>`;
}

function certaintyTag(c: Ctx, certainty: HouseCertainty | undefined): string {
    if (certainty === 'guess') return tag('guess', c.P.origin.guess);
    if (certainty === 'probable') return tag('guess', c.P.origin.probable);
    return '';
}

/** The tag of an item of the research: a conjecture, else where it came from. */
function originTag(c: Ctx, origin: 'research' | 'import' | undefined, certainty?: HouseCertainty): string {
    if (certainty === 'guess') return tag('guess', c.P.origin.guess);
    return origin === 'import' ? tag('own', c.P.origin.own) : tag('res', c.P.origin.research);
}

// ==================== SOURCES ====================

interface CitedSource {
    key: string;
    title: string;
    url: string | null;
    pages: string[];
}

function sourceRecord(c: Ctx, ref: string): { title: string; url: string | null } | null {
    for (const s of Object.values(c.data.sources ?? {})) {
        if (researchSourceRef(s.refn) === ref) return { title: s.title, url: safeHttpUrl(s.url) };
    }
    return null;
}

function hostOf(url: string): string {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/** One source of an item as a citation: "Title, p. 12" (↗ only for the web). */
function citeHtml(c: Ctx, s: HouseSource): string {
    if ('url' in s) {
        const url = safeHttpUrl(s.url);
        return url ? `<a class="hp-src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(url))} ↗</a>` : '';
    }
    const rec = sourceRecord(c, s.source);
    if (!rec) return '';
    const text = [rec.title, s.page].filter(Boolean).join(', ');
    return rec.url
        ? `<a class="hp-src" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`
        : `<span class="hp-src">${esc(text)}</span>`;
}

function citesHtml(c: Ctx, sources: readonly HouseSource[]): string {
    return sources.map(s => citeHtml(c, s)).filter(Boolean).join('');
}

// ==================== THE TREE'S RECORDS ====================

/** One record of the tree at the house (a wedding with both partners), by year. */
export interface HouseTreeRow {
    year?: number;
    factRef: string;
    kind: HouseFact['kind'];
    label: string;
    persons: PersonId[];
    marriedIn?: 'm' | 'f';
}

function factLabel(f: HouseFact, data: StromData, S: ReturnType<typeof getStringsForLang>): string {
    const ev = S.houses.ev;
    const fem = data.persons[f.personId]?.gender === 'female';
    if (f.kind === 'birth') return fem ? ev.bornF : ev.bornM;
    if (f.kind === 'death') return fem ? ev.diedF : ev.diedM;
    if (f.kind === 'marriage') return ev.marriage;
    if (f.kind === 'census') return ev.census;
    if (f.kind === 'residence') return ev.residence;
    const at = f.factRef.indexOf(':');
    const [kind, id] = [f.factRef.slice(0, at), f.factRef.slice(at + 1)];
    if (kind === 'event') {
        const e = data.persons[f.personId]?.events?.find(x => x.id === id);
        if (e) return lifeEventLabel(e, S);
    }
    if (kind === 'coupleEvent') {
        for (const u of Object.values(data.partnerships)) {
            const e = u.events?.find(x => x.id === id);
            if (e) return coupleEventLabelIn(e, S);
        }
    }
    return ev.event;
}

/** The house's records of the tree as rows (one per fact, a couple's fact once), by year. */
export function houseTreeRows(house: TreeHouse, facts: readonly HouseFact[], data: StromData, lang: Language): HouseTreeRow[] {
    const S = getStringsForLang(lang);
    const married = new Map(house.marriedIn.map(m => [m.personId, m.sex]));
    const rows = new Map<string, HouseTreeRow>();
    for (const f of houseFacts({ facts: [...facts] })) {
        const row = rows.get(f.factRef);
        if (row) {
            if (!row.persons.includes(f.personId)) row.persons.push(f.personId);
            continue;
        }
        rows.set(f.factRef, { year: f.year, factRef: f.factRef, kind: f.kind, label: factLabel(f, data, S), persons: [f.personId] });
    }
    for (const row of rows.values()) {
        if (row.kind !== 'marriage') continue;
        const inPerson = row.persons.find(p => married.has(p));
        if (inPerson) row.marriedIn = married.get(inPerson);
    }
    return [...rows.values()];
}

// ==================== CONTEXT ====================

function makeCtx(data: StromData, house: TreeHouse, research: HouseResearch | null, mode: HousePageMode, opts: HousePageOptions): Ctx {
    const S = getStringsForLang(opts.lang);
    const app = mode === 'app';
    const pctx = housePrivacyContext(data, opts.now);
    const out = app ? null : houseOutputFilter(house, research, data, opts.now, pctx);
    const recentHouse = !!out && (out.persons.some(p => p.recent || p.living)
        || house.facts.some(f => f.year !== undefined && f.year >= pctx.from));
    return {
        mode, app, lang: opts.lang, H: S.houses, P: S.houses.page,
        names: app ? data : applyLivingPrivacy(data, 'initials', opts.now.getFullYear()),
        data, house, research, out, opts, personOfRef: pctx.personOfRef, recentHouse, recentFrom: app ? null : pctx.from,
    };
}

/** The house's facts the page shows (the file's filtered). */
const factsOf = (c: Ctx): HouseFact[] => (c.out ? c.out.facts : c.house.facts);

/** The research's timeline the page shows: the app's whole (sensitive ones marked), the file's filtered. */
function timelineOf(c: Ctx): HouseEvent[] {
    if (!c.research) return [];
    return c.out ? c.out.timeline : c.research.timeline;
}

/** The research has something of the house to show beyond its state. */
function hasResult(r: HouseResearch | null): boolean {
    if (!r) return false;
    return r.timeline.length > 0 || r.holders.length > 0 || r.residents.length > 0 || !!r.look?.text || (r.look?.images.length ?? 0) > 0
        || r.passed.length > 0 || r.unknown.length > 0 || r.archiveOnly.length > 0 || r.materials.length > 0
        || r.numbers.length > 0 || !!r.location;
}

function shownHouseName(c: Ctx): string {
    const name = c.data.houses?.[c.house.id]?.name ?? c.house.name ?? c.research?.name ?? '';
    return c.out && c.recentHouse ? '' : name.trim();
}

/** The research's place record of the town, when the research names one. */
function townRecord(c: Ctx): PlaceRecord | null {
    const id = c.research?.place.id ?? c.research?.town?.place?.id;
    return id ? c.data.placeRecords?.[id] ?? null : null;
}

function jurisdiction(rec: PlaceRecord | null, kind: 'parish' | 'district'): string {
    const list = (rec?.jurisdictions ?? []).filter(j => j.kind === kind);
    const now = list.filter(j => j.to === undefined).sort((a, b) => (b.from ?? 0) - (a.from ?? 0))[0] ?? list[list.length - 1];
    return now?.name ?? '';
}

// ==================== SECTIONS ====================

function section(key: HousePageSectionKey, title: string, body: string, head = ''): string {
    return `<section class="pp-sec hp-sec hp-sec--${key}" id="${housePageSectionId(key)}">`
        + `<div class="pp-sec-head"><h2>${esc(title)}</h2>${head}</div>${body}</section>`;
}

/** The period of the house's records the page shows ("1781–1934"). */
function periodText(c: Ctx): string {
    const years = factsOf(c).map(f => f.year).filter((y): y is number => y !== undefined);
    if (!years.length) return '';
    const a = Math.min(...years);
    const b = Math.max(...years);
    return a === b ? String(a) : `${a}–${b}`;
}

function heroHtml(c: Ctx): string {
    const { P, house } = c;
    const name = shownHouseName(c);
    const edit = c.app && c.opts.app?.canEdit;
    const nameLine = name || edit
        ? `<p class="hp-aka">${name ? `<span class="hp-name">${esc(quoted(name, c.lang))}</span>` : ''}`
            + (edit ? `<button type="button" class="hp-name-edit" data-hp-act="name">${esc(name ? P.nameLink : P.nameAdd)}</button>` : '')
            + '</p>'
        : '';
    const rec = townRecord(c);
    const district = jurisdiction(rec, 'district');
    const parish = jurisdiction(rec, 'parish');
    const facts: [string, string][] = [[P.factTown, esc(district ? `${house.ref.town} (${district})` : house.ref.town)]];
    if (parish) facts.push([P.factParish, esc(parish)]);
    const persons = c.out ? c.out.persons.length : house.persons;
    const tree = P.treeLine(periodText(c), house.generations, persons);
    if (tree) facts.push([P.factTree, esc(tree)]);
    const state = c.app ? c.opts.app?.stateHtml ?? '' : '';
    if (state) facts.push([P.factResearch, `<span class="hp-state">${state}</span>`]);
    const hidden = c.app && c.research ? houseOutputFilter(house, c.research, c.data, c.opts.now).hidden : null;
    const outLine = hidden && (hidden.events || hidden.location)
        ? `<p class="hp-out">${esc(c.H.hiddenSummary(hidden.events, hidden.location))}</p>` : '';
    return `<header class="pp-sec hp-hero" id="hp-sec-facts">`
        + `<p class="pp-kicker">${esc(P.kicker)}</p>`
        + `<h1 class="pp-name">${esc(houseTitle(house))}</h1>${nameLine}`
        + `<dl class="pp-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>${outLine}</header>`;
}

/** One family's years at the house; the file's no longer than the records it shows (no year of the last ~100 years by sum). */
function familyYearsOf(c: Ctx): number {
    const all = c.house.familyYears ?? 0;
    if (!c.out || all <= 0) return all;
    const years = factsOf(c).map(f => f.year).filter((y): y is number => y !== undefined);
    return years.length ? Math.min(all, Math.max(...years) - Math.min(...years)) : 0;
}

/** In brief (K3.2): one family N years, the house numbers, the generations, the oldest record — each when it says something. */
function summaryHtml(c: Ctx): string {
    const { P, house } = c;
    const cells: [string, string][] = [];
    const family = familyYearsOf(c);
    if (family > 0) cells.push([P.sumYears(family), P.sumFamily]);
    const numbers = new Set(numberRows(c).map(r => houseKey(r.text))).size;
    if (numbers > 0) cells.push([String(numbers), P.sumNumbers(numbers)]);
    if (house.generations > 0) cells.push([String(house.generations), P.sumGenerations(house.generations)]);
    const years = factsOf(c).map(f => f.year).filter((y): y is number => y !== undefined);
    if (years.length) cells.push([String(Math.min(...years)), P.sumOldest]);
    if (!cells.length) return '';
    return `<section class="pp-sec hp-sec hp-sec--sum" id="${housePageSectionId('sum')}" aria-label="${esc(P.sum)}">`
        + `<div class="pp-sum${cells.length === 3 ? ' pp-sum--3' : ''}">`
        + cells.map(([big, lab]) => `<div class="pp-sum-cell"><span class="pp-sum-big">${esc(big)}</span><span class="pp-sum-lab">${esc(lab)}</span></div>`).join('')
        + '</div></section>';
}

interface NumberRow {
    text: string;
    from?: string | number;
    to?: string | number;
    tree: boolean;
    item?: HouseNumberItem;
}

/** A research's bare number written as the tree writes the house ("9" → "čp. 9" beside "čp. 16"). */
function numberText(c: Ctx, number: string): string {
    const n = number.trim();
    if (!/^\d+[a-z]?$/i.test(n)) return n;
    const prefix = /^(\D*?)\s*\d/.exec(c.house.text)?.[1] ?? '';
    return prefix ? `${prefix} ${n}` : n;
}

/** The numbers over time: the tree's (with houses joined by hand) and the research's, a proposal included. */
function numberRows(c: Ctx): NumberRow[] {
    const rows: NumberRow[] = [];
    const byKey = new Map<string, NumberRow>();
    for (const n of c.house.numbers) {
        if (n.source === 'research') continue;
        const key = houseKey(n.house);
        if (byKey.has(key)) continue;
        // The file leaves out a tree's year of the last ~100 years (it dates a person's fact).
        const keep = (y: number | undefined): number | undefined => (y !== undefined && c.recentFrom !== null && y >= c.recentFrom ? undefined : y);
        const row: NumberRow = { text: n.house, from: keep(n.from), to: keep(n.to), tree: true };
        byKey.set(key, row);
        rows.push(row);
    }
    for (const item of c.research?.numbers ?? []) {
        const key = houseKey(item.number);
        const have = byKey.get(key);
        if (have && !item.proposed) {
            have.item = item;
            if (item.from) have.from = item.from;
            if (item.to) have.to = item.to;
            continue;
        }
        const row: NumberRow = { text: numberText(c, item.number), from: item.from, to: item.to, tree: false, item };
        if (!item.proposed) byKey.set(key, row);
        rows.push(row);
    }
    const start = (r: NumberRow): number => (typeof r.from === 'number' ? r.from : yearOf(r.from) ?? Number.POSITIVE_INFINITY);
    return rows.sort((a, b) => start(a) - start(b));
}

function numbersHtml(c: Ctx): string {
    const { P } = c;
    const rows = numberRows(c);
    if (!rows.length) return '';
    const single = rows.length === 1;
    const html = rows.map(r => {
        const it = r.item;
        const what: string[] = [];
        if (it?.proposed) {
            what.push(`<span class="hp-num-what">${esc(it.text || P.proposed)}</span>`);
        } else {
            if (it) what.push(certaintyTag(c, it.certainty));
            if (it?.confirmed) what.push(`<span>${esc(P.confirmedOn(dayText(it.confirmed, c.lang) || it.confirmed))}</span>`);
            if (it?.text) what.push(`<span>${esc(it.text)}</span>`);
            else if (r.tree && single && !it) what.push(`<span>${esc(P.treeRecords(factsOf(c).length))}</span>`);
        }
        if (it) for (const s of it.sources) {
            if ('url' in s) {
                const url = safeHttpUrl(s.url);
                if (url) what.push(`<a class="hp-src" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(P.evidence)} ↗</a>`);
            } else {
                what.push(citeHtml(c, s));
            }
        }
        const acts = it?.proposed && c.app && c.opts.app?.canConfirm
            ? `<span class="hp-num-acts"><button type="button" class="hp-mini hp-mini--primary" data-hp-act="renumber" data-number="${esc(it.id)}">${esc(P.confirm)}</button>`
                + `<button type="button" class="hp-mini" data-hp-act="not-same" data-number="${esc(it.id)}">${esc(P.notSame)}</button></span>`
            : '';
        return `<div class="hp-num${it?.proposed ? ' hp-num--prop' : ''}"><span class="hp-num-y">${esc(yearsSpan(c, r.from, r.to))}</span>`
            + `<b class="hp-num-n">${esc(houseLabel(r.text))}</b><span class="hp-num-w">${what.filter(Boolean).join('')}${acts}</span></div>`;
    }).join('');
    return section('numbers', P.sec.numbers, `<div class="hp-nums">${html}</div>`);
}

interface TimelineRow {
    year: number | null;
    html: string;
}

function treeTimelineRows(c: Ctx): TimelineRow[] {
    const H = c.H;
    return houseTreeRows(c.house, factsOf(c), c.data, c.lang).map(r => {
        const names = joinAnd(c.lang, r.persons.map(id => personHtml(c, id)).filter(Boolean));
        const married = r.marriedIn ? tag('mar', r.marriedIn === 'f' ? H.marriedInF : H.marriedInM) : '';
        return {
            year: r.year ?? null,
            html: `<div class="hp-tl-r hp-tl-r--tree"><span class="hp-tl-y">${r.year ?? '—'}</span><span class="hp-tl-d" aria-hidden="true"></span>`
                + `<div class="hp-tl-t"><span>${esc(cap(r.label, c.lang))} ${names}</span>${married ? `<span class="hp-tl-m">${married}</span>` : ''}</div></div>`,
        };
    });
}

function researchTimelineRows(c: Ctx): TimelineRow[] {
    const sensitive = new Set(c.research?.sensitive ?? []);
    const revealed = new Set(c.data.houses?.[c.house.id]?.revealInOutputs ?? []);
    return timelineOf(c).map(e => {
        const y = yearOf(e.date);
        const hiddenOut = c.app && sensitive.has(e.id) && !revealed.has(e.id);
        const shownOut = c.app && sensitive.has(e.id) && revealed.has(e.id);
        const reveal = c.app && sensitive.has(e.id) && c.opts.app?.canEdit
            ? `<button type="button" class="hp-reveal" data-hp-act="reveal" data-event="${esc(e.id)}" data-reveal="${hiddenOut ? 'show' : 'hide'}">${esc(hiddenOut ? c.H.reveal : c.H.hide)}</button>`
            : '';
        const meta = [
            originTag(c, e.origin, e.certainty),
            citesHtml(c, e.sources),
            hiddenOut ? `<span class="hp-hid">${esc(c.H.hiddenOut)}</span>` : '',
            reveal,
        ].filter(Boolean).join('');
        const cls = e.origin === 'import' ? 'own' : 'res';
        return {
            year: y,
            html: `<div class="hp-tl-r hp-tl-r--${cls}${hiddenOut ? ' hp-tl-r--hidden' : ''}${shownOut ? ' hp-tl-r--shown' : ''}" data-event="${esc(e.id)}">`
                + `<span class="hp-tl-y">${y ?? '—'}</span><span class="hp-tl-d" aria-hidden="true"></span>`
                + `<div class="hp-tl-t"><span>${esc(e.text)}</span>${meta ? `<span class="hp-tl-m">${meta}</span>` : ''}</div></div>`,
        };
    });
}

function timelineHtml(c: Ctx): string {
    const tree = treeTimelineRows(c);
    const research = researchTimelineRows(c);
    if (!tree.length && !research.length) return '';
    const all = [...research, ...tree].map((r, i) => ({ ...r, i }));
    all.sort((a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY) || a.i - b.i);
    const note = `<span class="hp-sec-note">${esc(research.length ? c.P.tlBoth : c.P.tlTree)}</span>`;
    return section('timeline', c.P.sec.timeline, `<div class="hp-tl">${all.map(r => r.html).join('')}</div>`, note);
}

/** A holder's or a resident's name: the tree's person (a link in the app), else the research's name "· outside the tree". */
function holderName(c: Ctx, item: HouseHolder | HouseResident, personId: PersonId | null, living: boolean): string {
    if (personId) {
        // The file names the living as its privacy does (from the tree), never by the research's name.
        const html = personHtml(c, personId, living && c.out ? '' : item.name);
        if (html) return html;
    }
    return `<span class="hp-ext">${esc(item.name)} <span class="hp-ext-rl">· ${esc(c.P.outsideTree)}</span></span>`;
}

interface HolderView<T> {
    item: T;
    personId: PersonId | null;
    living: boolean;
    noYears: boolean;
}

function holdersOf(c: Ctx): HolderView<HouseHolder>[] {
    if (c.out) return c.out.holders;
    return (c.research?.holders ?? []).map(item => ({ item, personId: c.personOfRef(item.person), living: false, noYears: false }));
}

function residentsOf(c: Ctx): HolderView<HouseResident>[] {
    if (c.out) return c.out.residents;
    return (c.research?.residents ?? []).map(item => ({ item, personId: c.personOfRef(item.person), living: false, noYears: false }));
}

function holdersTable(c: Ctx): string {
    const { P } = c;
    const list = holdersOf(c);
    if (!list.length) return '';
    const rows: string[] = [];
    let lastTo: number | null = null;
    for (const h of list) {
        const from = yearOf(h.item.from);
        // A gap between two holders: "not known", see What is not known.
        if (!h.noYears && lastTo !== null && from !== null && from > lastTo) {
            rows.push(`<tr class="hp-gap"><td class="hp-unk">${esc(P.unknownHolder)}</td><td class="hp-y">${lastTo}–${from}</td>`
                + `<td class="hp-unk">${c.research?.unknown.length ? `<a href="#${housePageSectionId('unknown')}">${esc(P.seeUnknown)}</a>` : ''}</td></tr>`);
        }
        const to = yearOf(h.item.to);
        if (!h.noYears && to !== null) lastTo = to;
        const how = h.item.how ? esc(P.how[h.item.how]) : '';
        const origin = h.item.origin === 'import' ? ` ${tag('own', P.origin.own)}` : '';
        rows.push(`<tr><td class="hp-nmc">${holderName(c, h.item, h.personId, h.living)}</td>`
            + `<td class="hp-y">${h.noYears ? '' : esc(yearsSpan(c, h.item.from, h.item.to))}</td><td class="hp-role">${how}${origin}</td></tr>`);
    }
    return `<h3 class="hp-h3">${esc(P.holders)}</h3><table class="hp-table"><thead><tr><th>${esc(P.colHolder)}</th><th>${esc(P.colWhen)}</th>`
        + `<th>${esc(P.colHow)}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function residentsTable(c: Ctx): string {
    const { P } = c;
    const list = residentsOf(c);
    if (!list.length) return '';
    const rows = list.map(r => `<tr><td class="hp-nmc">${holderName(c, r.item, r.personId, r.living)}</td>`
        + `<td class="hp-role">${r.item.role ? esc(P.role[r.item.role]) : ''}</td>`
        + `<td class="hp-y">${r.noYears ? '' : esc(yearsSpan(c, r.item.from, r.item.to))}</td></tr>`).join('');
    return `<div class="hp-h3-row"><h3 class="hp-h3">${esc(P.residents)}</h3><span class="hp-sec-note">${esc(P.notOwner)}</span></div>`
        + `<table class="hp-table"><thead><tr><th>${esc(P.colResident)}</th><th>${esc(P.colRole)}</th><th>${esc(P.colWhen)}</th></tr></thead>`
        + `<tbody>${rows}</tbody></table>`;
}

function peopleHtml(c: Ctx): string {
    const body = holdersTable(c) + residentsTable(c);
    return body ? section('people', c.P.sec.people, body) : '';
}

/** Residents from the tree (a house without the research's result): person, years in the house, the records. */
function treeResidentsHtml(c: Ctx): string {
    const { P } = c;
    const facts = factsOf(c);
    const order: PersonId[] = [];
    const byPerson = new Map<PersonId, HouseFact[]>();
    for (const f of houseFacts({ facts })) {
        if (!byPerson.has(f.personId)) { byPerson.set(f.personId, []); order.push(f.personId); }
        byPerson.get(f.personId)!.push(f);
    }
    const S = getStringsForLang(c.lang);
    const rows = order.map(id => {
        const list = byPerson.get(id)!;
        const years = list.map(f => f.year).filter((y): y is number => y !== undefined);
        const span = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : '';
        const labels = [...new Set(list.map(f => {
            const l = factLabel(f, c.data, S);
            return f.kind === 'census' && f.year ? `${l} ${f.year}` : l;
        }))];
        const name = personHtml(c, id);
        return name ? `<tr><td class="hp-nmc">${name}</td><td class="hp-y">${esc(span)}</td><td>${esc(labels.join(', '))}</td></tr>` : '';
    }).filter(Boolean).join('');
    if (!rows) return '';
    return section('treeResidents', P.sec.treeResidents, `<table class="hp-table"><thead><tr><th>${esc(P.colPerson)}</th>`
        + `<th>${esc(P.colInHouse)}</th><th>${esc(P.colRecords)}</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/** The house's items of what of its look is not known: The building shows them, What is not known does not. */
const lookUnknowns = (r: HouseResearch | null): HouseUnknown[] => r?.unknown.filter(u => u.about === 'look') ?? [];

function unknownRow(c: Ctx, u: HouseUnknown): string {
    const answer = c.app && u.question
        ? `<span class="hp-ql-r"><button type="button" class="hp-mini" data-hp-act="answer" data-question="${esc(u.question)}">${esc(c.H.answer)}</button></span>` : '';
    const note = u.question ? `<span class="hp-ql-s">${esc(c.P.questionNote)}</span>` : '';
    return `<div class="hp-ql-i"><span class="hp-qt">${esc(u.text)}</span>${answer}${note}</div>`;
}

/** A link out of the page (↗, a new window). */
const outLink = (url: string, text: string): string =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`;

/** A house number without its marker ("čp. 16" → "16"), to tell a field name at this house. */
const bareNumber = (n: string | undefined): string => (n ?? '').replace(/[^\p{N}/]+/gu, ' ').trim();

/**
 * The building (spec 145 T1): the short look with its certainty and the house's pictures, the town's pictures
 * (the town is not the house), its field names (this house's first), what the check of the look said (researched
 * further, or what is not known with Attach material… and the steps by hand). Shown with `house.look` or when the
 * research's data carry a look; the file links the pictures (it calls no network) and has no buttons.
 */
function lookHtml(c: Ctx): string {
    const r = c.research;
    if (!r) return '';
    const { P } = c;
    const look = r.look;
    // Its certainty (a conjecture, probable), else where it came from, as elsewhere on the page.
    const tags = look ? certaintyTag(c, look.certainty) || (look.origin ? originTag(c, look.origin) : '') : '';
    const text = look?.text ? `<p class="hp-look">${esc(look.text)}${tags ? ` ${tags}` : ''}</p>` : '';
    // Only images with a free licence; the file links to them (it calls no network).
    const images = (look?.images ?? []).filter(im => im.license && im.url && safeHttpUrl(im.url));
    const figs = images.map(im => {
        const url = safeHttpUrl(im.url)!;
        const img = c.app ? `<img class="hp-img" src="${esc(url)}" alt="${esc(im.credit ?? '')}" loading="lazy" referrerpolicy="no-referrer">` : '';
        const caption = [im.credit, im.license].filter(Boolean).map(t => esc(t!)).join(' · ') + ` · ${outLink(url, hostOf(url))}`;
        return `<figure class="hp-fig">${img}<figcaption>${caption}</figcaption></figure>`;
    }).join('');
    // What the check of the look said: researched further (until the task of the look is done), or not known.
    const check = r.lookCheck;
    const lookDone = r.lookTask === true && r.state === 'done';
    const more = check && check.next !== 'none' && !lookDone
        ? `<p class="hp-note hp-look-more">${esc(P.lookMore(check.text.replace(/[.\s]+$/, '')))}${r.lookTask && r.state === 'queued' ? ` ${esc(P.lookQueued)}` : ''}</p>` : '';
    const unknowns = lookUnknowns(r);
    const notKnown = !look?.text && !images.length && !more
        && (check?.next === 'none' || unknowns.length > 0 || (!!c.opts.look && r.state === 'done'));
    let unknown = '';
    if (unknowns.length) unknown = `<div class="hp-ql hp-look-unk">${unknowns.map(u => unknownRow(c, u)).join('')}</div>`;
    else if (notKnown) unknown = `<p class="hp-note hp-look-unk">${esc(P.lookUnknown)}</p>`;
    // The steps by hand (a sketch of the cadastre to download and attach) and Attach material…, only while not known.
    const manual = notKnown && r.manual.length
        ? `<div class="hp-ql hp-look-hand">${r.manual.map(m => `<div class="hp-ql-i"><span>${outLink(m.url, m.what)}</span>`
            + `${m.why ? `<span class="hp-ql-s">${esc(m.why)}</span>` : ''}</div>`).join('')}</div>` : '';
    const attach = notKnown && c.app && c.opts.app?.lookAttachHtml ? `<div class="hp-acts">${c.opts.app.lookAttachHtml}</div>` : '';
    // The town's pictures and field names.
    const pictures = (r.town?.pictures ?? []).map(p => {
        const img = c.app ? `<img class="hp-img" src="${esc(p.url)}" alt="${esc(p.shows)}" loading="lazy" referrerpolicy="no-referrer">` : '';
        const by = [p.credit, p.license].filter(Boolean).map(t => esc(t!)).join(' · ');
        return `<figure class="hp-fig">${img}<figcaption><span class="hp-fig-what">${esc(p.shows)}</span>`
            + `<span class="hp-fig-by">${by} · ${outLink(p.url, hostOf(p.url))}</span></figcaption></figure>`;
    }).join('');
    const own = bareNumber(r.house);
    const atThis = (n: string | undefined): boolean => !!own && bareNumber(n) === own;
    const names = [...(r.town?.fieldNames ?? [])].sort((a, b) => Number(atThis(b.house)) - Number(atThis(a.house))).map(f => {
        const sub = [f.kind ? esc(f.kind) : '', f.house ? esc(P.lookAtHouse(f.house)) : ''].filter(Boolean).join(' · ');
        const name = f.url ? outLink(f.url, f.name) : esc(f.name);
        return `<div class="hp-ql-i${atThis(f.house) ? ' hp-fn--this' : ''}"><span class="hp-fn">${name}</span>`
            + `${sub ? `<span class="hp-ql-s">${sub}</span>` : ''}</div>`;
    }).join('');
    const body = text + figs + more + unknown + manual + attach
        + (pictures ? `<h3 class="hp-h3">${esc(P.lookPictures)}</h3><div class="hp-figs${c.app ? ' hp-figs--img' : ''}">${pictures}</div>` : '')
        + (names ? `<h3 class="hp-h3">${esc(P.lookFieldNames)}</h3><div class="hp-ql hp-fns">${names}</div>` : '');
    return body ? section('look', P.sec.look, body) : '';
}

function unknownHtml(c: Ctx): string {
    const list = [...(c.research?.unknown ?? []).filter(u => u.about !== 'look'), ...(c.research?.town?.unknown ?? [])];
    if (!list.length) return '';
    return section('unknown', c.P.sec.unknown, `<div class="hp-ql">${list.map(u => unknownRow(c, u)).join('')}</div>`);
}

function passedHtml(c: Ctx): string {
    const r = c.research;
    if (!r) return '';
    const seen = new Set<string>();
    const passed = [...r.passed, ...(r.town?.passed ?? [])].filter(p => !seen.has(p.id) && seen.add(p.id));
    const archive = [...r.archiveOnly, ...(r.town?.archiveOnly ?? [])].filter(a => !seen.has(a.id) && seen.add(a.id));
    if (!passed.length && !archive.length) return '';
    const passedRows = passed.map(p => {
        const sub = [p.found === false ? c.P.foundNothing : '', p.at ? c.P.searched(dayText(p.at, c.lang) || p.at) : '']
            .filter(Boolean).join(' · ');
        const url = safeHttpUrl(p.url);
        const what = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.what)} ↗</a>` : esc(p.what);
        return `<div class="hp-ql-i"><span>${what}</span>${sub ? `<span class="hp-ql-s">${esc(sub)}</span>` : ''}</div>`;
    }).join('');
    const archiveRows = archive.map(a => `<div class="hp-ql-i"><span>${esc(a.what)}</span>`
        + `<span class="hp-ql-s">${esc([a.archive, a.fond, a.signature].filter(Boolean).join(', '))}</span></div>`).join('');
    return section('passed', c.P.sec.passed,
        (passedRows ? `<div class="hp-ql">${passedRows}</div>` : '')
        + (archiveRows ? `<h3 class="hp-h3">${esc(c.P.sec.archiveOnly)}</h3><div class="hp-ql">${archiveRows}</div>` : ''));
}

/** Every source the research cites for the house, once, with the pages cited. */
function citedSources(c: Ctx): CitedSource[] {
    const r = c.research;
    if (!r) return [];
    const all: HouseSource[] = [
        ...r.numbers.flatMap(n => n.sources), ...timelineOf(c).flatMap(e => e.sources),
        ...holdersOf(c).flatMap(h => h.item.sources), ...residentsOf(c).flatMap(h => h.item.sources),
        ...(c.out && !c.out.location ? [] : r.location?.sources ?? []),
    ];
    const map = new Map<string, CitedSource>();
    for (const s of all) {
        if ('url' in s) {
            const url = safeHttpUrl(s.url);
            if (url && !map.has(url)) map.set(url, { key: url, title: hostOf(url), url, pages: [] });
            continue;
        }
        const rec = sourceRecord(c, s.source);
        if (!rec) continue;
        const got = map.get(s.source) ?? map.set(s.source, { key: s.source, title: rec.title, url: rec.url, pages: [] }).get(s.source)!;
        if (s.page && !got.pages.includes(s.page)) got.pages.push(s.page);
    }
    return [...map.values()];
}

function materialHtml(c: Ctx, m: HouseMaterial): string {
    const H = c.H;
    const memory = m.kind === 'memory';
    const image = !memory && !!m.file && /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i.test(m.file);
    const title = memory ? (m.title ? `${H.memoryTitle}: ${m.title}` : H.memoryTitle)
        : m.kind === 'own-research' ? H.ownResearch : (m.title || m.file || H.matKind.file);
    // A witness's name stays in the app (the file never names who told it).
    const who = memory ? [H.familyMemory, c.app ? (m.witness ? H.witnessBy(m.witness) : H.witnessNone) : ''] : [];
    const sub = [...who, dayText(m.at, c.lang)].filter(Boolean).join(' · ');
    const kind = memory ? H.matKind.text : image ? H.matKind.photo : H.matKind.file;
    return `<div class="hp-mat"><span class="hp-mat-t">${esc(title)}${sub ? `<span class="hp-mat-s">${esc(sub)}</span>` : ''}</span>`
        + `<span class="hp-mat-k">${esc(kind)}</span></div>`;
}

function sourcesHtml(c: Ctx): string {
    const cited = citedSources(c);
    const mats = c.research?.materials ?? [];
    const acts = c.app ? c.opts.app?.materialActionsHtml ?? '' : '';
    if (!cited.length && !mats.length && !acts) return '';
    const srcs = cited.length ? `<div class="hp-srcs">${cited.map(s => `<div class="hp-sr"><b>${esc(s.title)}</b>`
        + (s.pages.length ? `<span class="hp-sr-s">${esc(s.pages.join(' · '))}</span>` : '')
        + (s.url ? `<span class="hp-sr-ref"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(s.url))} ↗</a></span>` : '')
        + '</div>').join('')}</div>` : '';
    const matList = mats.length ? `<h3 class="hp-h3">${esc(c.P.materials)}</h3><div class="hp-mats">${mats.map(m => materialHtml(c, m)).join('')}</div>` : '';
    return section('sources', c.P.sec.sources, srcs + matList + (acts ? `<div class="hp-acts">${acts}</div>` : ''));
}

/** The quiet sentence of a house without the research's result (with the action of §2 in the app). */
function noResultHtml(c: Ctx): string {
    const { P } = c;
    const text = c.opts.state === 'queued' || c.opts.state === 'running' ? P.queued : c.opts.research && c.app ? P.treeOnly : P.noResearch;
    return `<p class="hp-note">${esc(text)}</p>`;
}

function footerHtml(c: Ctx): string {
    if (c.app) return '';
    const d = c.opts.now;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `<footer class="pp-foot">${createdWithStromHtml(c.lang, formatFlexDate(iso, c.lang))}</footer>`;
}

// ==================== THE PAGE ====================

/**
 * The page's body: `<article class="pp hp">` with its sections. `research`
 * is the research's whole result of the house (null: none read, or no
 * research); `mode` 'file' filters it for outputs (houseOutputFilter).
 */
export function buildHousePage(data: StromData, house: TreeHouse, research: HouseResearch | null, mode: HousePageMode, opts: HousePageOptions): string {
    const c = makeCtx(data, house, research, mode, opts);
    const result = hasResult(research);
    const location = c.out ? c.out.location
        : data.houses?.[house.id]?.location ? { lat: data.houses[house.id]!.location!.lat, lng: data.houses[house.id]!.location!.lng }
            : research?.location ? { lat: research.location.lat, lng: research.location.lon } : null;
    const townGeo = data.places?.[house.townKey];
    const map = mapHtml({
        mode, lang: opts.lang, house, research, location, layers: opts.layers ?? [],
        town: townGeo ? { lat: townGeo.lat, lng: townGeo.lon } : null,
        how: c.out ? undefined : data.houses?.[house.id]?.location?.how,
        canEdit: !!opts.app?.canEdit, hasResearch: !!opts.research,
    });
    const parts = result
        ? [heroHtml(c), summaryHtml(c), numbersHtml(c), timelineHtml(c), peopleHtml(c), lookHtml(c),
            map ? section('map', c.P.sec.map, map) : '', unknownHtml(c), passedHtml(c), sourcesHtml(c)]
        : [heroHtml(c), summaryHtml(c), numbersHtml(c), timelineHtml(c), treeResidentsHtml(c),
            map ? section('map', c.P.sec.map, map) : '', noResultHtml(c)];
    return `<article class="pp hp" data-house="${esc(house.id)}" lang="${esc(opts.lang)}">${parts.join('')}${footerHtml(c)}</article>`;
}

/** The sections on the page, in order (the contents: In brief first). */
export function housePageSections(body: string, lang: Language): HousePageSection[] {
    const P = getStringsForLang(lang).houses.page;
    return SECTION_KEYS.filter(k => body.includes(`id="${housePageSectionId(k)}"`))
        .map(k => ({ key: k, id: housePageSectionId(k), label: k === 'sum' ? P.sum : P.sec[k] }));
}

/** The file's contents beside the page: plain anchors, no script. */
function tocNavHtml(sections: readonly HousePageSection[], lang: Language): string {
    if (sections.length < 3) return '';
    const P = getStringsForLang(lang).personPage;
    return `<nav class="pp-toc" aria-label="${esc(P.toc)}"><div class="pp-toc-h">${esc(P.toc)}</div><ol>`
        + sections.map(s => `<li><a class="pp-toc-link sel-tab" data-sel-dir="side" href="#${esc(s.id)}"><span class="sel-l" data-label="${esc(s.label)}">${esc(s.label)}</span></a></li>`).join('')
        + '</ol></nav>';
}

/** "Bělokamen čp. 16 „U Prouzalů“" (the file's title; the name only where the file may show it). */
export function housePageTitle(data: StromData, house: TreeHouse, lang: Language): string {
    const name = data.houses?.[house.id]?.name ?? house.name;
    return name ? `${houseTitle(house)} ${quoted(name, lang)}` : houseTitle(house);
}

/** The whole saved file (K7.1): self-contained, the light page with its contents. */
export function buildHousePageDocument(data: StromData, house: TreeHouse, research: HouseResearch | null, opts: HousePageOptions & { fontCss?: string }): string {
    const body = buildHousePage(data, house, research, 'file', { ...opts, app: undefined });
    const title = houseTitle(house);
    return personPageDocumentShell(opts.lang, title, body, opts.fontCss ?? '', tocNavHtml(housePageSections(body, opts.lang), opts.lang),
        { css: HOUSE_PAGE_FILE_TOKENS + HOUSE_PAGE_CSS });
}

/** "belokamen-cp-16.html". */
export function housePageFileName(house: TreeHouse): string {
    return `${asciiSlug(`${house.ref.town} ${house.text}`) || 'house'}.html`;
}
