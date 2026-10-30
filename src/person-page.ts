/**
 * The person page (spec 025): one person's life on one read-only page — the
 * header, family, story, notes, life timeline, images, sources and the
 * details for researchers. Pure and DOM-free, like buildFamilyBook: the window
 * (mode 'app') and the saved file (mode 'file') are the same body, apart in
 * how links are written and what may lead back into the app.
 *
 * preparePersonPageData applies the privacy of living people FIRST and keeps
 * only the page's people (the person, parents, partners, children, siblings,
 * people named at the events), their sources, excerpts and history; the body
 * is built from that subset alone, so nothing else of the tree can get into
 * the output.
 */

import { StromData, Person, PersonId, Partnership, Source, SourceExcerpt, LifeEvent, EventParticipant, Story, Attachment, PlaceGeo, FactStatus } from './types.js';
import { applyLivingPrivacy, stripResearchWork, isLivingPerson, inferBirthUpperBounds, PrivacyMode } from './privacy.js';
import { computePersonLifeline, LifelinePoint } from './timeline.js';
import {
    computePersonHistory, HistoryPayload, PersonHistoryEnv, LifelineHistoryItem, historySourceLabel, interleaveHistory, residencePoints,
} from './history.js';
import { placeKey } from './places.js';
import { getStringsForLang, Language, PersonPageCaptionEvent, PersonPageRegister } from './strings.js';
import { parseFlexDate, formatFlexDate, yearOf, ageBetween, toCanonical } from './dates.js';
import { nameHtml, shownName, shownNameOrEmpty } from './person-name.js';
import { asciiSlug, safeFileName } from './filenames.js';
import { isSafeExcerptDataUrl, safeHttpUrl, isOriginalOnlyAttachment } from './validation.js';
import { storyProseHtml, coupleStories, coupleStoryYears, splitProseLead, partnershipsInOrder, partnershipSortKey } from './story-text.js';
import { excerptImageUrl } from './excerpts.js';
import { personSourceRows, lifeEventLabel, coupleEventLabelIn, PersonSourceRow } from './person-sources.js';
import { personInitials } from './initials.js';
import { recordedAgeGap, readRecordedAge, ageBirthDate } from './recorded-age.js';
import { clipText } from './text-clip.js';
import { PERSON_PAGE_SCRIPT, PERSON_PAGE_STORY_SCRIPT, personPageFileCss } from './person-page-css.js';
import { findRelationship } from './kinship.js';
import { collectPersonPlacePoints, placesMapHtml, PlacePoint, PLACES_MAP_SCRIPT } from './person-page-map.js';
import { lifeChartInput, lifeChartHtml, chartAnchorId, chartHistAnchorId, LifeChartInput } from './person-page-chart.js';

// ─── Interface (ZADANI §2.6) ────────────────────────────────────────────────

export type PersonPageMode = 'app' | 'file' | 'print';
/** 'app' → buttons into the app, 'plain' → text, 'set' → anchors between the pages of a set (§8). */
export type PersonPageLinks = 'app' | 'plain' | 'set';

export interface PersonPageGroups {
    history: boolean;
    childEvents: boolean;
    excerpts: boolean;
    /** Image attachments (with the source excerpts they make the page's images). */
    materials: boolean;
    /** PDF attachments (§3.5: the file embeds them, the window lists them). */
    pdf: boolean;
    sources: boolean;
    research: boolean;
}

/** Every group on (the window; the export dialog's default). */
export const PERSON_PAGE_ALL_GROUPS: Readonly<PersonPageGroups> = Object.freeze({
    history: true, childEvents: true, excerpts: true, materials: true, pdf: true, sources: true, research: true,
});

/** The export's privacy of living people when no choice is remembered (K2.4). */
export const PERSON_PAGE_DEFAULT_PRIVACY: PrivacyMode = 'initials';

/** The export dialog's privacy choices, in its order. */
export const PERSON_PAGE_PRIVACY_MODES: readonly PrivacyMode[] = ['full', 'initials', 'anonymous', 'minimal'];

/**
 * The privacy the export dialog starts with: full data when nobody on the
 * page is living (there is nothing to protect), else the remembered choice,
 * else initials + birth year.
 */
export function personPageExportPrivacy(living: boolean, saved: PrivacyMode | undefined): PrivacyMode {
    if (!living) return 'full';
    return saved && PERSON_PAGE_PRIVACY_MODES.includes(saved) ? saved : PERSON_PAGE_DEFAULT_PRIVACY;
}

export interface PersonPageOptions {
    personId: PersonId;
    lang: Language;
    mode: PersonPageMode;
    links: PersonPageLinks;
    /** Members of a set (links 'set' only): they are anchors, everyone else text. */
    setMembers?: ReadonlySet<PersonId>;
    /** Window: all true (minus what the tree does not have). */
    groups: PersonPageGroups;
    /** The window is always 'full'. */
    privacy: PrivacyMode;
    /**
     * Initial state of the switches (the page's default: all on): the timeline's
     * History / Children's events (they apply to the life chart too) and the
     * places map's Children's places (missing = on).
     */
    toggles: { history: boolean; childEvents: boolean; kidPlaces?: boolean };
    /** Window: the place selected in the places map (placeKey). */
    selectedPlace?: string | null;
    /** Window: the life chart's width in px (the column, measured by the window); default 680. */
    chartWidth?: number;
    /** Open folds: 'sources', 'research', 'sibs', 'basis', 's:<source id>'. */
    open?: ReadonlySet<string>;
    /** The tree is linked to Strom Research (history, materials, the researchers' section). */
    research: boolean;
    now: Date;
    /** The embedded @font-face rules of the file (the app supplies personPageFontCss()); none = fallback fonts. */
    fontCss?: string;
    /**
     * File: the contents "On this page" (round 3 §0.7; the dialog's choice, on
     * there by default), with four sections or more as in the window.
     */
    toc?: boolean;
}

/** What the app knows besides the tree (all optional). */
export interface PersonPageContext {
    /** The tree's history layer (as the person's card computes it). */
    history?: { payload: HistoryPayload; env?: PersonHistoryEnv };
    /** Texts of research tasks about the person waiting outside the queue. */
    waiting?: readonly string[];
    /** Last change of the tree (ISO), for the window's footer. */
    changedAt?: string;
    /** Read-only mode or a locked person: no links into the research. */
    readOnly?: boolean;
    /** A tree already protected once for many pages (protectPersonPageTree; a set of pages, §8). */
    protected?: ProtectedPersonPageTree;
}

/** The whole tree after the privacy of living people (one result for any number of pages). */
export interface ProtectedPersonPageTree {
    tree: StromData;
    privacy: PrivacyMode;
    /** Living people, judged on the data before protection. */
    living: ReadonlySet<PersonId>;
    /** People whose approved story has a new version waiting (dropped from the tree). */
    drafts: ReadonlySet<PersonId>;
}

/** One person's page, ready to render. */
export interface PersonPageData {
    personId: PersonId;
    lang: Language;
    privacy: PrivacyMode;
    /** The groups that are in (asked for and possible in this tree). */
    groups: PersonPageGroups;
    research: boolean;
    /** The page's people, their couples and the sources they cite — nothing else. */
    tree: StromData;
    /** Living people on the page (judged before protection). */
    living: ReadonlySet<PersonId>;
    /** Visible history items of the person (empty without the history group). */
    history: readonly LifelineHistoryItem[];
    /** The research is still looking for a place's history. */
    historyPending: boolean;
    waiting: readonly string[];
    storyDraft: boolean;
    changedAt?: string;
    readOnly: boolean;
    /** What each content group holds (for the export dialog: a group with 0 is not offered). */
    counts: PersonPageGroupCounts;
    /** People the person stood godparent to (their baptism names the person), with the baptism's year. */
    godchildren: readonly { id: PersonId; year: number | null }[];
    /**
     * The places map's points (§1), collected from the whole protected tree (the
     * page's subset keeps too little of the children: emigrations, deaths);
     * nothing of a living person in a protected file.
     */
    places: readonly PlacePoint[];
    /** Coordinates of those places only (placeKey → geo), from the tree's places. */
    geo: Readonly<Record<string, PlaceGeo>>;
}

export interface PersonPageGroupCounts {
    history: number;
    childEvents: number;
    excerpts: number;
    materials: number;
    pdf: number;
    sources: number;
    research: number;
}

/** A section that is on the page (for the window's table of contents). */
export interface PersonPageSection {
    key: 'family' | 'story' | 'question' | 'places' | 'timeline' | 'materials' | 'people' | 'notes' | 'sources' | 'research';
    id: string;
    label: string;
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type S = ReturnType<typeof getStringsForLang>;
type PP = S['personPage'];

/** Research ids in texts: "[S0042]", "[M-12]", "[G0001]", "[D-…]". */
const ID_IN_TEXT = /\s*\[(S\d{4}|M-\d+|G\d{4}|D[\w-]+)\]/g;

/** A text without its research ids, and the ids it carried. */
export function stripResearchIds(text: string): { text: string; ids: string[] } {
    const ids: string[] = [];
    const out = text.replace(ID_IN_TEXT, (_m, id: string) => { ids.push(id); return ''; });
    return { text: out, ids };
}

/** A raster image data URL safe to embed (the app's check plus a clean base64 body). */
function safeImage(url: string | undefined): string | null {
    if (!url || !isSafeExcerptDataUrl(url)) return null;
    const comma = url.indexOf(',');
    return /^[A-Za-z0-9+/=\s]*$/.test(url.slice(comma + 1)) ? url : null;
}

function isPdfAttachment(a: Attachment): boolean {
    return a.mimeType === 'application/pdf';
}

/** A PDF attachment's data URL safe to embed as a download link, else null. */
function safePdf(a: Attachment): string | null {
    if (!isPdfAttachment(a) || isOriginalOnlyAttachment(a)) return null;
    const m = /^data:application\/pdf(;[\w=.-]+)*;base64,([A-Za-z0-9+/=\s]+)$/.exec(a.dataUrl ?? '');
    return m ? `data:application/pdf;base64,${m[2].replace(/\s+/g, '')}` : null;
}

/** An excerpt as shown (turned upright), still a safe data URL. */
function shownExcerpt(e: SourceExcerpt): string {
    return safeImage(excerptImageUrl(e)) ?? safeImage(e.dataUrl) ?? '';
}

/** The register a source is, from its title (no field holds it). */
export function registerKindOf(title: string | undefined): PersonPageRegister | null {
    const t = (title ?? '').toLowerCase();
    if (/narozen|křt|baptis|birth|christen|geburt|tauf/.test(t)) return 'birth';
    if (/oddan|sňat|marriage|marriages|trau|heirat/.test(t)) return 'marriage';
    if (/zemřel|úmrt|death|burial|sterbe|begräb|tote/.test(t)) return 'death';
    return null;
}

function genderKey(p: Person | undefined): 'm' | 'f' | 'u' {
    return p?.gender === 'male' ? 'm' : p?.gender === 'female' ? 'f' : 'u';
}

/** "12. března 1860" / "12 March 1860"; "asi 1835"; other qualified dates as the app writes them. */
export function personPageDate(value: string | undefined, lang: Language): string {
    const d = parseFlexDate(value);
    if (!d) return value?.trim() ?? '';
    const P = getStringsForLang(lang).personPage;
    if (d.end || d.period || d.qualifier === '<' || d.qualifier === '>') return formatFlexDate(value, lang);
    const core = d.month !== undefined
        ? P.date.words(d.day, P.date.months[d.month - 1] ?? String(d.month), d.year)
        : String(d.year);
    return d.qualifier === '~' ? `${P.about} ${core}` : core;
}

/**
 * A date to the year, its precision kept the way personPageDate words it: "1965",
 * "before 1965", "after 1965", "about 1965", "to 1965" (a period's end), "1950–1960"
 * (a period or a range across years). An occupation in the header (round 3, finding 3).
 */
export function personPageYear(value: string | undefined, lang: Language): string {
    const d = parseFlexDate(value);
    if (!d) return value?.trim() ?? '';
    if (d.end && d.end.year !== d.year) return `${d.year}–${d.end.year}`;
    if (d.end || (!d.qualifier && !d.period)) return String(d.year);
    return personPageDate(toCanonical({ qualifier: d.qualifier, year: d.year, ...(d.period ? { period: true } : {}) }), lang);
}

/** Whole years between two dates when both are exact days or both mere years; else null. */
function ageAt(birth: string | undefined, end: string | undefined): number | null {
    const b = parseFlexDate(birth);
    const e = parseFlexDate(end);
    if (!b || !e || b.qualifier || e.qualifier || b.end || e.end || b.period || e.period) return null;
    const exact = (x: typeof b) => x.day !== undefined && x.month !== undefined;
    const yearOnly = (x: typeof b) => x.month === undefined;
    if (exact(b) && exact(e)) return ageBetween(birth, end)?.years ?? null;
    if (yearOnly(b) && yearOnly(e)) return e.year >= b.year ? e.year - b.year : null;
    return null;
}

function isoDay(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yearsOf(p: Person): string {
    const b = yearOf(p.birthDate);
    const d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

function utf8Length(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

function sortByBirth(ids: readonly PersonId[], tree: StromData): PersonId[] {
    return [...ids].sort((a, b) => {
        const ya = yearOf(tree.persons[a]?.birthDate) ?? Infinity;
        const yb = yearOf(tree.persons[b]?.birthDate) ?? Infinity;
        return ya - yb || String(a).localeCompare(String(b));
    });
}

// ─── Preparing the data ─────────────────────────────────────────────────────

/** Protect the whole tree once: privacy of living people, then no research workshop. */
export function protectPersonPageTree(data: StromData, privacy: PrivacyMode, now: Date): ProtectedPersonPageTree {
    const year = now.getFullYear();
    const bounds = inferBirthUpperBounds(data);
    const living = new Set<PersonId>();
    for (const p of Object.values(data.persons)) {
        if (!p.isPlaceholder && isLivingPerson(p, year, bounds)) living.add(p.id);
    }
    // Only the living lose sources, excerpts and attachments (K2.7); the book drops them for everyone.
    const tree = applyLivingPrivacy(data, privacy, year, { keepDeceasedSources: true });
    const drafts = new Set<PersonId>();
    for (const p of Object.values(tree.persons)) if (p.story?.draft) drafts.add(p.id);
    stripResearchWork(tree);
    return { tree, privacy, living, drafts };
}

/** The page's family: parents, partners, children, siblings (ids in the tree). */
function familyOf(tree: StromData, person: Person) {
    const parents = person.parentIds.filter(id => tree.persons[id] && !tree.persons[id].isPlaceholder);
    // §4.5: a union without a wedding date by its first child (or first event), after a dated one of that year.
    const unions = partnershipsInOrder(tree, person.partnerships.map(id => tree.partnerships[id]).filter((u): u is Partnership => !!u));
    const children = sortByBirth(person.childIds.filter(id => tree.persons[id] && !tree.persons[id].isPlaceholder), tree);
    const sibs = new Set<PersonId>();
    for (const pid of parents) for (const c of tree.persons[pid]?.childIds ?? []) {
        if (c !== person.id && tree.persons[c] && !tree.persons[c].isPlaceholder) sibs.add(c);
    }
    return { parents, unions, children, siblings: sortByBirth([...sibs], tree) };
}

/** Keep of a relative only what a page shows about them. */
function relativeView(p: Person, withEvents: boolean): Person {
    const keep: Person = {
        id: p.id, firstName: p.firstName, lastName: p.lastName, gender: p.gender, isPlaceholder: p.isPlaceholder,
        partnerships: [...p.partnerships], parentIds: [...p.parentIds], childIds: [...p.childIds],
    };
    for (const k of ['titleBefore', 'titleAfter', 'marriedSurname', 'primaryName', 'birthDate', 'birthPlace',
        'deathDate', 'deathPlace', 'isDeceased'] as const) {
        if (p[k] !== undefined) (keep as unknown as Record<string, unknown>)[k] = p[k];
    }
    // A child's burial and marriages are rows of the parent's timeline.
    if (withEvents && p.events) {
        keep.events = p.events.filter(e => e.type === 'burial')
            .map(e => ({ id: e.id, type: e.type, ...(e.date ? { date: e.date } : {}), ...(e.place ? { place: e.place } : {}) }));
    }
    return keep;
}

function participantIds(list: readonly EventParticipant[] | undefined): PersonId[] {
    return (list ?? []).map(p => p.personId).filter((id): id is PersonId => !!id);
}

/**
 * The person's page data: the tree protected (or `ctx.protected` reused), the
 * page's people only, their sources and history; groups the tree cannot have
 * (no research) or the caller left out are dropped with their data.
 */
export function preparePersonPageData(data: StromData, opts: PersonPageOptions, ctx: PersonPageContext = {}): PersonPageData {
    const prot = ctx.protected && ctx.protected.privacy === opts.privacy
        ? ctx.protected : protectPersonPageTree(data, opts.privacy, opts.now);
    const full = prot.tree;
    const id = opts.personId;
    const S = getStringsForLang(opts.lang);
    const groups: PersonPageGroups = {
        ...opts.groups,
        history: opts.groups.history && opts.research && !!ctx.history,
        // Attachments are the user's own documents: on without research too (§3.3).
        research: opts.groups.research && opts.research,
    };
    const src = full.persons[id];
    const tree: StromData = { persons: {}, partnerships: {}, sources: {} };
    if (!src) {
        return {
            personId: id, lang: opts.lang, privacy: opts.privacy, groups, research: opts.research, tree,
            living: new Set(), history: [], historyPending: false, waiting: [], storyDraft: false,
            readOnly: !!ctx.readOnly, counts: { history: 0, childEvents: 0, excerpts: 0, materials: 0, pdf: 0, sources: 0, research: 0 },
            godchildren: [], places: [], geo: {},
        };
    }
    const person: Person = structuredClone(src);
    if (person.attachments) {
        person.attachments = person.attachments.filter(a => (isPdfAttachment(a) ? groups.pdf : groups.materials));
        if (!person.attachments.length) delete person.attachments;
    }
    if (!groups.research) delete person.research;
    tree.persons[id] = person;

    const fam = familyOf(full, person);
    const named = new Set<PersonId>();
    for (const ev of person.events ?? []) participantIds(ev.participants).forEach(p => named.add(p));
    for (const u of fam.unions) {
        tree.partnerships[u.id] = structuredClone(u);
        participantIds(u.participants).forEach(p => named.add(p));
        for (const ev of u.events ?? []) participantIds(ev.participants).forEach(p => named.add(p));
        const other = u.person1Id === id ? u.person2Id : u.person1Id;
        if (other) named.add(other);
    }
    for (const pid of [...fam.parents, ...fam.siblings, ...named]) {
        if (pid !== id && full.persons[pid]) tree.persons[pid] = relativeView(full.persons[pid], false);
    }
    // The parents' marriage (its year is the label between them in the family tree).
    if (fam.parents.length === 2) {
        const pu = (full.persons[fam.parents[0]]?.partnerships ?? []).map(uid => full.partnerships[uid])
            .find(u => !!u && (u.person1Id === fam.parents[1] || u.person2Id === fam.parents[1]));
        if (pu && !tree.partnerships[pu.id]) {
            tree.partnerships[pu.id] = {
                id: pu.id, person1Id: pu.person1Id, person2Id: pu.person2Id, childIds: [], status: pu.status,
                ...(pu.startDate ? { startDate: pu.startDate } : {}),
            } as Partnership;
        }
    }
    for (const cid of fam.children) {
        tree.persons[cid] = relativeView(full.persons[cid], true);
        // Grandchildren: names and years for the family tree's folded row (§4.1).
        for (const gid of full.persons[cid].childIds) {
            const g = full.persons[gid];
            if (g && !g.isPlaceholder && !tree.persons[gid]) tree.persons[gid] = relativeView(g, false);
        }
        // The child's marriages and divorces (dates and places only).
        for (const uid of full.persons[cid].partnerships) {
            const u = full.partnerships[uid];
            if (!u || tree.partnerships[uid]) continue;
            tree.partnerships[uid] = {
                id: u.id, person1Id: u.person1Id, person2Id: u.person2Id, childIds: [], status: u.status,
                ...(u.startDate ? { startDate: u.startDate } : {}), ...(u.startPlace ? { startPlace: u.startPlace } : {}),
                ...(u.endDate ? { endDate: u.endDate } : {}), ...(u.endPlace ? { endPlace: u.endPlace } : {}),
            } as Partnership;
        }
    }

    // The sources the person, the person's events and marriages cite.
    const rows = personSourceRows({ ...full, persons: { ...full.persons, [id]: person } }, id, S);
    if (groups.sources || groups.excerpts || groups.research) {
        for (const row of rows) {
            const s: Source = structuredClone(row.source);
            if (!groups.excerpts) delete s.excerpts;
            else if (s.excerpts) s.excerpts = s.excerpts.filter(e => !!safeImage(e.dataUrl));
            tree.sources![s.id] = s;
        }
    }

    // History over the protected data: a living person's places are gone with the rest.
    let history: LifelineHistoryItem[] = [];
    let historyPending = false;
    if (ctx.history && opts.research) {
        const h = computePersonHistory(tree, id, ctx.history.payload, opts.lang, ctx.history.env ?? {});
        historyPending = h.state.kind === 'searching' || (h.state.kind === 'events' && h.state.somePending) || h.placesPending;
        if (groups.history) history = h.items;
    }

    // "Godparent to" (§0.5): baptisms anywhere in the tree naming the person as a godparent.
    // A living godchild's events are gone with the privacy, so they never show here.
    const godchildren: { id: PersonId; year: number | null }[] = [];
    for (const other of Object.values(full.persons)) {
        if (other.id === id || other.isPlaceholder) continue;
        const bapt = (other.events ?? []).find(e => e.type === 'baptism'
            && (e.participants ?? []).some(p => p.personId === id && p.role === 'godparent'));
        if (!bapt) continue;
        godchildren.push({ id: other.id, year: yearOf(bapt.date) ?? yearOf(other.birthDate) });
        if (!tree.persons[other.id]) tree.persons[other.id] = relativeView(other, false);
    }
    godchildren.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || String(a.id).localeCompare(String(b.id)));

    const living = new Set<PersonId>([...Object.keys(tree.persons)].filter(p => prot.living.has(p as PersonId)) as PersonId[]);
    // The places map (§1): points from the whole protected tree, the coordinates of those places alone.
    const places = collectPersonPlacePoints(full, id, { living: prot.living, protect: opts.privacy !== 'full', now: opts.now.getFullYear() });
    const geo: Record<string, PlaceGeo> = {};
    for (const pt of places) {
        const g = full.places?.[pt.placeKey];
        if (g) geo[pt.placeKey] = { lat: g.lat, lon: g.lon };
    }
    const page: PersonPageData = {
        personId: id, lang: opts.lang, privacy: opts.privacy, groups, research: opts.research, tree, living,
        history, historyPending: groups.research && historyPending,
        waiting: groups.research ? [...(ctx.waiting ?? [])] : [],
        storyDraft: groups.research && prot.drafts.has(id) && !!person.story?.text?.trim(),
        ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
        readOnly: !!ctx.readOnly,
        counts: { history: 0, childEvents: 0, excerpts: 0, materials: 0, pdf: 0, sources: 0, research: 0 },
        godchildren, places, geo,
    };
    page.counts = countGroups(page);
    return page;
}

function countGroups(page: PersonPageData): PersonPageGroupCounts {
    const person = page.tree.persons[page.personId];
    const points = computePersonLifeline(page.tree, page.personId, { childEvents: true });
    const sources = Object.values(page.tree.sources ?? {});
    return {
        history: page.history.length,
        childEvents: page.groups.childEvents
            ? personPageTimeline(points, [], { childEvents: true, history: false, living: false })
                .reduce((n, s) => n + s.rows.filter(r => r.kind === 'kid').length, 0)
            : 0,
        excerpts: sources.reduce((n, s) => n + (s.excerpts?.length ?? 0), 0),
        materials: (person?.attachments ?? []).filter(a => !isPdfAttachment(a) && !!safeImage(a.dataUrl) && !isOriginalOnlyAttachment(a)).length,
        pdf: (person?.attachments ?? []).filter(a => !!safePdf(a)).length,
        sources: page.groups.sources ? sources.length : 0,
        research: researchItems(page, page.lang).count + researchIdCount(page),
    };
}

/** Research ids the researchers' section would list (source refn, ids in the story and notes). */
function researchIdCount(page: PersonPageData): number {
    if (!page.groups.research) return 0;
    const person = page.tree.persons[page.personId];
    const ids = new Set<string>();
    if (page.groups.sources) for (const s of Object.values(page.tree.sources ?? {})) if (s.refn) ids.add(s.refn);
    const stories = [person?.story, ...(person ? coupleStories(page.tree, person) : []).map(u => u.story)];
    for (const st of stories) {
        if (!st?.text?.trim()) continue;
        for (const t of [st.text, ...(st.facts ?? [])]) stripResearchIds(t).ids.forEach(id => ids.add(id));
    }
    if (person?.notes) stripResearchIds(person.notes).ids.forEach(id => ids.add(id));
    return ids.size;
}

// ─── Timeline (§3.1) ────────────────────────────────────────────────────────

export type PersonPageTimelineRow =
    | { kind: 'own'; point: LifelinePoint; merged?: LifelinePoint }
    | { kind: 'kid'; point: LifelinePoint; merged?: LifelinePoint }
    | { kind: 'hist'; item: LifelineHistoryItem };

export interface PersonPageTimelineSegment {
    key: 'before' | 'married' | 'after';
    /** A titled segment (there is a marriage, or it is the time after death). */
    titled: boolean;
    from: number;
    to: number;
    rows: PersonPageTimelineRow[];
}

export interface PersonPageTimelineOptions {
    /** Rows of the children's events. */
    childEvents: boolean;
    /** Rows of the history layer. */
    history: boolean;
    /** A living person has no "after death". */
    living: boolean;
}

function rowYear(r: PersonPageTimelineRow): number {
    return r.kind === 'hist' ? r.item.year : r.point.year;
}

/**
 * The page's timeline: birth + baptism (within a year) and death + burial
 * become one row each (a child's death and burial too); history items are
 * single rows after the person's rows of their year; the rows split into
 * "before marriage" (< the first marriage's year), "married" (to the death
 * year inclusive) and "after death" (> the death year). Without a marriage
 * the one segment before has no title; empty segments are left out.
 */
export function personPageTimeline(
    points: readonly LifelinePoint[], layer: readonly LifelineHistoryItem[], opts: PersonPageTimelineOptions,
): PersonPageTimelineSegment[] {
    const own: PersonPageTimelineRow[] = [];
    const used = new Set<LifelinePoint>();
    const birth = points.find(p => p.kind === 'birth');
    const death = points.find(p => p.kind === 'death');
    const baptism = birth && points.find(p => p.kind === 'event' && p.eventType === 'baptism'
        && Math.abs(p.year - birth.year) <= 1);
    const burial = death && points.find(p => p.kind === 'event' && p.eventType === 'burial'
        && p.year >= death.year && p.year - death.year <= 1);
    if (baptism) used.add(baptism);
    if (burial) used.add(burial);
    const kidBurials = new Map<string, LifelinePoint>();
    for (const p of points) {
        if (p.kind === 'childEvent' && p.childEvent === 'burial' && p.relatedId) kidBurials.set(p.relatedId, p);
    }
    for (const p of points) {
        if (used.has(p)) continue;
        if (p.kind === 'childEvent') {
            if (!opts.childEvents) continue;
            if (p.childEvent === 'death' && p.relatedId) {
                const b = kidBurials.get(p.relatedId);
                if (b && b.year >= p.year && b.year - p.year <= 1) {
                    used.add(b);
                    own.push({ kind: 'kid', point: p, merged: b });
                    continue;
                }
            }
            own.push({ kind: 'kid', point: p });
            continue;
        }
        if (p === birth && baptism) own.push({ kind: 'own', point: p, merged: baptism });
        else if (p === death && burial) own.push({ kind: 'own', point: p, merged: burial });
        else own.push({ kind: 'own', point: p });
    }
    // A merged child's burial may have been pushed before its death was seen.
    const ownRows = own.filter(r => !(r.kind === 'kid' && used.has(r.point)));

    const hist = opts.history ? layer : [];
    const rows: PersonPageTimelineRow[] = interleaveHistory(ownRows.map(rowYear), hist.map(i => i.year))
        .map(slot => ('point' in slot ? ownRows[slot.point] : { kind: 'hist', item: hist[slot.group] } as PersonPageTimelineRow));

    const marriageYear = points.filter(p => p.kind === 'marriage').map(p => p.year).sort((a, b) => a - b)[0];
    const deathYear = !opts.living && death ? death.year : undefined;
    const segOf = (y: number): PersonPageTimelineSegment['key'] => {
        if (deathYear !== undefined && y > deathYear) return 'after';
        if (marriageYear !== undefined && y >= marriageYear) return 'married';
        return 'before';
    };
    const out: PersonPageTimelineSegment[] = [];
    for (const r of rows) {
        const key = segOf(rowYear(r));
        let seg = out[out.length - 1];
        if (!seg || seg.key !== key) {
            seg = { key, titled: key !== 'before' || marriageYear !== undefined, from: rowYear(r), to: rowYear(r), rows: [] };
            out.push(seg);
        }
        seg.rows.push(r);
        seg.to = Math.max(seg.to, rowYear(r));
    }
    return out;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

interface Ctx {
    page: PersonPageData;
    opts: PersonPageOptions;
    S: S;
    P: PP;
    app: boolean;
    tree: StromData;
    person: Person;
    /** Main excerpts already placed: source id → the anchor of their row. */
    mainEx: Map<string, { anchor: string; label: string }>;
    /** Research ids met in texts. */
    ids: Set<string>;
    /** The file's images, each embedded once (null in the window and in print). */
    imgs: Map<string, ImgEntry> | null;
    /** The gallery's images in order (the file's light boxes follow it). */
    gal: GalleryItem[];
    /** An image's place in the gallery (1-based): the timeline's link into the light box. */
    galIndex: Map<string, number>;
    /** The places the page's Places section names (placeKey): a place in the text leads there. */
    placeKeys: Set<string>;
    /** Ids of the timeline's rows given out so far (one row per chart anchor). */
    anchors: Set<string>;
    /** The life chart's input (§2), null when the chart is not drawn. */
    chart: LifeChartInput | null;
}

interface ImgEntry {
    n: number;
    src: string;
    /** "1200 / 900" from the image's header, for the box it paints. */
    ratio: string | null;
}

function isOpen(c: Ctx, key: string): boolean {
    return !!c.opts.open?.has(key);
}

/** The slug of a person's page in a set (the file name without .html). */
function slugOf(c: Ctx, pid: PersonId): string {
    return personPageFileName({ ...c.page, personId: pid }).replace(/\.html$/, '');
}

/** May a person's name lead to their page? */
function linkable(c: Ctx, pid: PersonId | undefined): pid is PersonId {
    if (!pid || pid === c.page.personId || !c.tree.persons[pid]) return false;
    if (c.opts.links === 'app') return c.opts.mode === 'app';
    if (c.opts.links === 'set') {
        if (!c.opts.setMembers?.has(pid)) return false;
        // A living relative under privacy is never a link.
        return !(c.page.privacy !== 'full' && c.page.living.has(pid));
    }
    return false;
}

function personLink(c: Ctx, nameHtmlStr: string, pid: PersonId | undefined): string {
    if (!linkable(c, pid)) return nameHtmlStr;
    if (c.opts.links === 'set') return `<a class="pp-link" href="#${esc(slugOf(c, pid))}">${nameHtmlStr}</a>`;
    return `<button type="button" class="pp-link" data-pp-person="${esc(pid)}">${nameHtmlStr}</button>`;
}

/**
 * A place in the text. Window: a button (the window scrolls to the Places
 * section and selects the place there, or opens the app's map, §1.6). File:
 * an anchor to the Places section when it names the place, else text.
 */
function placeLink(c: Ctx, place: string | undefined): string {
    const p = place?.trim();
    if (!p) return '';
    if (c.app && c.opts.links === 'app') return `<button type="button" class="pp-link" data-pp-place="${esc(p)}">${esc(p)}</button>`;
    const key = placeKey(p);
    if (!c.app && key && c.placeKeys.has(key)) {
        return `<a class="pp-link pp-place-link" href="#pp-sec-places" data-pp-to-place="${esc(key)}">${esc(p)}</a>`;
    }
    return esc(p);
}

/** ` id="…"` for the first timeline row of a chart anchor ('' when given out already). */
function anchorAttr(c: Ctx, id: string): string {
    if (!id || c.anchors.has(id)) return '';
    c.anchors.add(id);
    return ` id="${esc(id)}"`;
}

function nameOf(c: Ctx, pid: PersonId | undefined): string {
    const p = pid ? c.tree.persons[pid] : undefined;
    return p ? shownNameOrEmpty(p) : '';
}

function extLink(url: string | undefined, label: string): string {
    const href = safeHttpUrl(url);
    if (!href) return '';
    return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(label)} ↗</a>`;
}

/** A fold: a button + region in the window, <details> in the file. */
function fold(c: Ctx, o: {
    key: string; id: string; cls: string; head: string; heading?: boolean; after?: string; body: string; detailsOpen?: boolean;
}): string {
    const open = isOpen(c, o.key) || !!o.detailsOpen;
    const h = (inner: string) => (o.heading ? `<h2 class="pp-fold-h">${inner}</h2>` : inner);
    if (c.app) {
        const btn = `<button type="button" class="pp-disc" aria-expanded="${open}" aria-controls="${o.id}-body" data-pp-toggle="${esc(o.key)}">${o.head}</button>`;
        return `<div class="pp-coll ${o.cls}" id="${o.id}">${h(btn)}${o.after ?? ''}`
            + `<div class="pp-fold-body" id="${o.id}-body"${open ? '' : ' hidden'}>${o.body}</div></div>`;
    }
    return `<details class="pp-coll ${o.cls}" id="${o.id}"${open ? ' open' : ''}>`
        + `<summary class="pp-disc">${h(`<span class="pp-sum-main">${o.head}</span>`)}${o.after ?? ''}</summary>`
        + `<div class="pp-fold-body">${o.body}</div></details>`;
}

function foldState(closed: string, open: string): string {
    return `<span class="pp-fold-state"><span class="pp-st-closed">${esc(closed)}</span><span class="pp-st-open">${esc(open)}</span></span>`;
}

// ── Research items (also counted for the export dialog) ──

interface ResearchItems {
    conflicts: string[];
    tips: string[];
    pending: string[];
    hypotheses: string[];
    /** The research's status of each fact that has one ("Birth 1860: Proven"). */
    certainty: string[];
    /** "Backed by sources: 3 of 5 facts" ('' = the person has no facts). */
    sourced: string;
    count: number;
    /** Open conflicts about the birth / the death. */
    differsBirth: boolean;
    differsDeath: boolean;
}

const BIRTH_FACTS = new Set(['BIRT', 'CHR', 'BAPM']);
const DEATH_FACTS = new Set(['DEAT', 'BURI', 'CREM']);

function factLabel(S: S, fact: string): string {
    const t = S.events.types;
    switch (fact) {
        case 'BIRT': return t.birth;
        case 'CHR': case 'BAPM': return t.baptism;
        case 'DEAT': return t.death;
        case 'BURI': return t.burial;
        case 'MARR': return S.personSources.citeUnion(null);
        default: return fact;
    }
}

function sourceByRef(tree: StromData, ref: string): Source | undefined {
    const all = tree.sources ?? {};
    return all[ref] ?? Object.values(all).find(s => s.refn === ref);
}

function researchItems(page: PersonPageData, lang: Language, c?: Ctx): ResearchItems {
    const S = getStringsForLang(lang);
    const P = S.personPage;
    const out: ResearchItems = { conflicts: [], tips: [], pending: [], hypotheses: [], certainty: [], sourced: '', count: 0, differsBirth: false, differsDeath: false };
    if (!page.groups.research) return out;
    const person = page.tree.persons[page.personId];
    if (!person) return out;
    const act = (kind: 'research:open' | 'research:find', arg: string | undefined, label: string) =>
        c && c.app && !page.readOnly
            ? ` <button type="button" class="pp-act" data-pp-action="${kind}"${arg ? ` data-pp-arg="${esc(arg)}"` : ''}>${esc(label)} ›</button>`
            : '';
    for (const k of person.research?.conflicts ?? []) {
        if (k.status !== 'open') continue;
        if (BIRTH_FACTS.has(k.fact)) out.differsBirth = true;
        if (DEATH_FACTS.has(k.fact)) out.differsDeath = true;
        const values = k.values.map(v => {
            const value = esc(stripResearchIds(v.value).text);
            const titles = (v.sourceIds ?? []).map(sid => sourceByRef(page.tree, sid)?.title).filter((t): t is string => !!t);
            return titles.length ? esc(P.accordingTo('\u0000', titles.join(', '))).replace('\u0000', value) : value;
        });
        const title = stripResearchIds(k.title || factLabel(S, k.fact)).text;
        out.conflicts.push(`<strong>${esc(title)}:</strong> ${values.join(', ')}${act('research:open', k.id, P.openResearch)}`);
    }
    for (const item of page.history) {
        if (!item.tip) continue;
        const kind = S.history.kinds[item.ev.kind] ?? item.ev.kind;
        out.tips.push(`<strong>${esc(item.yearLabel ?? String(item.year))} · ${esc(kind)}:</strong> <span${item.tipLang && item.tipLang !== lang ? ` lang="${esc(item.tipLang)}"` : ''}>${esc(stripResearchIds(item.tip).text)}</span>`);
    }
    if (page.historyPending) out.pending.push(esc(P.historyPending));
    for (const w of page.waiting) out.pending.push(`${esc(P.waiting)} ${esc(stripResearchIds(w).text)}`);
    if (page.storyDraft) out.pending.push(esc(P.storyDraft));
    const edge = person.research?.edge;
    if (edge && edge.scope !== 'done' && edge.missing in P.edgeMissing) {
        out.pending.push(`${esc(P.edgeMissing[edge.missing as keyof PP['edgeMissing']])}${act('research:find', undefined, P.findSource)}`);
    }
    for (const h of person.research?.hypotheses ?? []) {
        if (h.status && h.status !== 'open') continue;
        const note = h.note ? ` — ${esc(stripResearchIds(h.note).text)}` : '';
        out.hypotheses.push(`<strong>${esc(stripResearchIds(h.title).text)}</strong>${note}${h.id ? act('research:open', h.id, P.openResearch) : ''}`);
    }
    const facts = personFacts(page, S);
    for (const f of facts) if (f.status) out.certainty.push(`<strong>${esc(f.label)}:</strong> ${esc(S.factStatus[f.status])}`);
    // The count only once the person cites a source or the research rated a fact: else "0 of 1" on every page.
    const anySource = Object.keys(page.tree.sources ?? {}).length > 0;
    if (facts.length && (anySource || out.certainty.length)) {
        out.sourced = esc(P.research.sourced(facts.filter(f => f.sourced).length, facts.length));
    }
    out.count = out.conflicts.length + out.tips.length + out.pending.length + out.hypotheses.length
        + out.certainty.length + (out.sourced ? 1 : 0);
    return out;
}

interface PersonFact { label: string; status?: FactStatus; sourced: boolean }

/**
 * The person's facts for the researchers' section (§0.6): the birth, the death,
 * each life event, each marriage (and its divorce, the couple's events) with a
 * date or a place — with the research's status and whether a source on the
 * page backs it. A union with a living partner in a protected file is left out.
 */
function personFacts(page: PersonPageData, S: S): PersonFact[] {
    const person = page.tree.persons[page.personId];
    if (!person) return [];
    const catalog = page.tree.sources ?? {};
    const cited = (ids: readonly string[] | undefined) => (ids ?? []).some(id => !!catalog[id]);
    const withYear = (label: string, date: string | undefined) => {
        const y = yearOf(date);
        return y !== null ? `${label} ${y}` : label;
    };
    const out: PersonFact[] = [];
    const add = (label: string, status: FactStatus | undefined, sourced: boolean) =>
        out.push({ label, ...(status ? { status } : {}), sourced });
    if (person.birthDate || person.birthPlace) add(withYear(S.events.types.birth, person.birthDate), person.birthStatus, cited(person.birthSourceIds));
    if (person.deathDate || person.deathPlace) add(withYear(S.events.types.death, person.deathDate), person.deathStatus, cited(person.deathSourceIds));
    for (const ev of person.events ?? []) {
        if (!ev.date && !ev.place) continue;
        add(withYear(lifeEventLabel(ev, S), ev.date), ev.status, cited(ev.sourceIds));
    }
    const protect = page.privacy !== 'full';
    for (const uid of person.partnerships) {
        const u = page.tree.partnerships[uid];
        if (!u) continue;
        const other = u.person1Id === person.id ? u.person2Id : u.person1Id;
        if (protect && page.living.has(other)) continue;
        if (u.startDate || u.startPlace) add(S.personSources.citeUnion(yearOf(u.startDate)), u.startStatus, cited(u.sourceIds));
        if (u.endDate || u.endPlace) add(withYear(S.fields.divorceRow, u.endDate), u.endStatus, cited(u.sourceIds));
        for (const ev of u.events ?? []) {
            if (!ev.date && !ev.place) continue;
            add(withYear(coupleEventLabelIn(ev, S), ev.date), ev.status, cited(ev.sourceIds));
        }
    }
    return out;
}

// ── Header ──

function headerHtml(c: Ctx, differs: { birth: boolean; death: boolean } | null): string {
    const { P, person, page } = c;
    const g = genderKey(person);
    const shield = shielded(c, person.id);
    const photo = shield ? null : safeImage(person.photo);
    const badge = (on: boolean) => {
        if (!on) return '';
        return c.app
            ? ` <button type="button" class="pp-differs" data-pp-differs aria-controls="pp-research-body">${esc(P.differs)} ↓</button>`
            : ` <a class="pp-differs js-only" href="#pp-research">${esc(P.differs)} ↓</a>`;
    };
    const facts: [string, string][] = [];
    const withPlace = (date: string, place: string | undefined) =>
        [esc(date), placeLink(c, place)].filter(Boolean).join(', ');
    if (person.birthDate || person.birthPlace) {
        facts.push([P.born[g], withPlace(personPageDate(person.birthDate, page.lang), person.birthPlace) + badge(!!differs?.birth)]);
    }
    const bapt = (person.events ?? []).find(e => e.type === 'baptism' && e.date);
    if (!shield && bapt && bapt.date !== person.birthDate) {
        facts.push([P.baptised[g], withPlace(personPageDate(bapt.date, page.lang), bapt.place)]);
    }
    const isLiving = page.living.has(person.id);
    if (person.deathDate || person.deathPlace) {
        const age = ageAt(person.birthDate, person.deathDate);
        facts.push([P.died[g], withPlace(personPageDate(person.deathDate, page.lang), person.deathPlace)
            + (age !== null ? ` · ${esc(P.aged(age))}` : '') + badge(!!differs?.death)]);
    } else if (isLiving && !shield) {
        const age = ageAt(person.birthDate, isoDay(c.opts.now)) ?? (() => {
            const b = parseFlexDate(person.birthDate);
            return b && !b.qualifier && !b.end ? ageBetween(person.birthDate, isoDay(c.opts.now))?.years ?? null : null;
        })();
        facts.push([P.alive, age !== null ? esc(P.living(age)) : '']);
    }
    const jobs = shield ? [] : (person.events ?? []).filter(e => e.type === 'occupation').map(e => {
        // An occupation's name is its note (as the editor stores it).
        const what = stripResearchIds(e.note?.trim() ?? '').text;
        const years = personPageYear(e.date, page.lang);
        return [what, years ? `(${years})` : ''].filter(Boolean).join(' ');
    }).filter(Boolean);
    if (jobs.length) facts.push([P.occupation, esc(jobs.join(', '))]);

    // The portrait (§3.1): a rounded square; a click shows it large (the window's viewer, the file's light box).
    let avatar: string;
    if (photo) {
        const corner = `<span class="pp-portrait-zoom" aria-hidden="true">⤢</span>`;
        if (c.imgs) avatar = `<a class="pp-portrait" href="#obr-p" aria-label="${esc(P.zoom)}">${imgHtml(c, photo, '', 'pp-photo')}${corner}</a>`;
        else if (c.app) avatar = `<button type="button" class="pp-portrait" data-pp-zoom aria-label="${esc(P.zoom)}"><img class="pp-photo" src="${esc(photo)}" alt="">${corner}</button>`;
        else avatar = `<span class="pp-portrait"><img class="pp-photo" src="${esc(photo)}" alt=""></span>`;
    } else {
        // A poor person (a name and a year at most) gets the smaller initials.
        const small = facts.length <= 1 && !(person.nameVariants ?? []).length;
        avatar = `<div class="pp-initials${small ? ' pp-initials--small' : ''}" aria-hidden="true">${esc(personInitials(person.firstName, person.lastName))}</div>`;
    }
    const aka = shield ? [] : (person.nameVariants ?? []).map(v => v.trim()).filter(Boolean);
    return `<header class="pp-hero${photo ? ' pp-hero--photo' : ''}" id="pp-sec-facts">${avatar}<div class="pp-hero-main">`
        + (c.app ? '' : `<p class="pp-eyebrow">${esc(P.eyebrow)}</p>`)
        + `<h1 class="pp-name">${nameHtml(person, { former: true })}</h1>`
        + (aka.length ? `<p class="pp-aka">${esc(P.alsoKnown)} ${esc(aka.join(', '))}</p>` : '')
        + (facts.length ? `<dl class="pp-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '')
        + (shield ? `<p class="pp-living-note">${esc(P.livingNote)}</p>` : '')
        + `</div></header>`;
}

// ── Family tree (§4) ──

/** The desktop tree's column (§4.1): geometry in px of a 680 px column, written as % so it narrows with the page. */
const FT_W = 680;
const FT_CARD = 150;
const FT_CARD_H = 50;
const FT_KID = 126;
const FT_KID_MIN = 110;
const FT_KID_GAP = 8;
const FT_GROUP_GAP = 20;
const FT_KIDS_PER_ROW = 5;
/** A wrapped row of children: ticks from its bus to the cards, the gap from a row's cards to the next row's bus (K2-2b). */
const FT_TICK = 12;
const FT_ROW_GAP = 40;
/** From this many unions the tree is drawn upright on every width (§4.1, round 2): partners to the sides would cross. */
const FT_UPRIGHT_UNIONS = 3;

function ftPct(x: number): string {
    return `${+(x / FT_W * 100).toFixed(3)}%`;
}

/** A living person under a privacy other than full: "E. F. · * 1952", never a link (§4.1). */
function shielded(c: Ctx, pid: PersonId): boolean {
    return c.page.privacy !== 'full' && c.page.living.has(pid);
}

/** A parent who is not the biological one: "stepfather", "adoptive mother", "foster father" (parentRelTypes). */
function relKind(c: Ctx, parentId: PersonId): 'step' | 'adoptive' | 'foster' | null {
    const k = c.person.parentRelTypes?.[parentId];
    return k === 'step' || k === 'adoptive' || k === 'foster' ? k : null;
}

function relLabel(c: Ctx, parentId: PersonId): string {
    const k = relKind(c, parentId);
    return k ? c.P.rel[k][genderKey(c.tree.persons[parentId])] : '';
}

/** A card of the family tree: the name (whole in the title), the years, an optional line under them. */
function ftCard(c: Ctx, pid: PersonId, cls: string, style = '', extra = ''): string {
    const p = c.tree.persons[pid];
    if (!p) return '';
    const name = shownNameOrEmpty(p) || '?';
    const years = yearsOf(p);
    const classes = ['pp-ft-card', cls, shielded(c, pid) ? 'pp-ft-card--living' : ''].filter(Boolean).join(' ');
    const inner = `<span class="pp-ft-name" title="${esc(name)}">${esc(name)}</span>`
        + (years ? `<span class="pp-ft-years">${esc(years)}</span>` : '')
        + (extra ? `<span class="pp-ft-rel">${esc(extra)}</span>` : '');
    const st = style ? ` style="${style}"` : '';
    if (linkable(c, pid)) {
        if (c.opts.links === 'set') return `<a class="${classes} pp-ft-link" href="#${esc(slugOf(c, pid))}"${st}>${inner}</a>`;
        return `<button type="button" class="${classes} pp-ft-link" data-pp-person="${esc(pid)}"${st}>${inner}</button>`;
    }
    return `<span class="${classes}"${st}>${inner}</span>`;
}

/** A chip of the siblings' and grandchildren's rows: "Jiří Fíšek 1938–2001", living under privacy "E. F. · * 1952". */
function ftChip(c: Ctx, pid: PersonId): string {
    const p = c.tree.persons[pid];
    if (!p) return '';
    const name = shownNameOrEmpty(p) || '?';
    const years = yearsOf(p);
    const shield = shielded(c, pid);
    const text = `<span class="pp-chip-name">${esc(name)}</span>${years ? `${shield ? ' · ' : ' '}<span class="pp-chip-years">${esc(years)}</span>` : ''}`;
    const cls = `pp-chip${shield ? ' pp-chip--living' : ''}`;
    if (linkable(c, pid)) {
        if (c.opts.links === 'set') return `<a class="${cls} pp-chip-link" href="#${esc(slugOf(c, pid))}">${text}</a>`;
        return `<button type="button" class="${cls} pp-chip-link" data-pp-person="${esc(pid)}">${text}</button>`;
    }
    return `<span class="${cls}">${text}</span>`;
}

interface FtUnion {
    union: Partnership;
    partner: PersonId;
    kids: PersonId[];
    /** "⚭ 1883", "⚭ year unknown" (empty for partners who did not marry). */
    short: string;
    /** "children from 1886" for a union without a wedding date sorted by its first child ('' otherwise). */
    kidsFrom: string;
    /** "⚭ 10 February 1883, Lhota · divorced 1890". */
    long: string;
    /** The link to the couple's chapter at the wedding ('' when the page has no chapter for the couple). */
    story: string;
}

interface FtData {
    parents: PersonId[];
    parentsUnion: string;
    unions: FtUnion[];
    /** Children with no known other parent (in no union with a partner). */
    solo: PersonId[];
    siblings: PersonId[];
    grandchildren: PersonId[];
}

function familyTreeData(c: Ctx): FtData {
    const { P, tree, person, page } = c;
    const fam = familyOf(tree, person);
    // Father on the left, mother on the right.
    const parents = [...fam.parents].sort((a, b) => {
        const rank = (id: PersonId) => (tree.persons[id]?.gender === 'male' ? 0 : tree.persons[id]?.gender === 'female' ? 2 : 1);
        return rank(a) - rank(b);
    });
    let parentsUnion = '';
    if (parents.length === 2) {
        const pu = Object.values(tree.partnerships).find(u =>
            (u.person1Id === parents[0] && u.person2Id === parents[1]) || (u.person1Id === parents[1] && u.person2Id === parents[0]));
        if (pu && pu.status !== 'partners' && pu.status !== 'separated') {
            const y = yearOf(pu.startDate);
            parentsUnion = y !== null ? `⚭ ${y}` : '';
        }
    }
    const placed = new Set<PersonId>();
    const unions: FtUnion[] = [];
    for (const u of fam.unions) {
        const other = u.person1Id === person.id ? u.person2Id : u.person1Id;
        const partner = other ? tree.persons[other] : undefined;
        if (!partner || partner.isPlaceholder) continue;
        const kids = fam.children.filter(k => (u.childIds ?? []).includes(k) && !placed.has(k));
        kids.forEach(k => placed.add(k));
        const unmarried = u.status === 'partners' || u.status === 'separated';
        const y = yearOf(u.startDate);
        // No wedding date (§4.5): "⚭ year unknown", with the year its children start from when they give it.
        const key = y === null ? partnershipSortKey(u, (u.childIds ?? []).map(id => tree.persons[id])) : null;
        const kidsFrom = !unmarried && key?.from === 'children' ? P.tree.kidsFrom(String(key.year)) : '';
        const short = unmarried ? '' : y !== null ? `⚭ ${y}` : P.tree.marUnknown;
        const parts: string[] = [];
        if (unmarried) parts.push(P.partner);
        else if (y === null) parts.push([P.tree.marUnknown, u.startPlace?.trim() ?? ''].filter(Boolean).join(', '));
        else parts.push(['⚭', [personPageDate(u.startDate, page.lang), u.startPlace?.trim() ?? ''].filter(Boolean).join(', ')].filter(Boolean).join(' '));
        if (kidsFrom) parts.push(kidsFrom);
        if (!unmarried && (u.endDate || u.status === 'divorced')) parts.push(P.divorced(personPageDate(u.endDate, page.lang)));
        unions.push({
            union: u, partner: partner.id, kids, short, kidsFrom, long: parts.join(' · '),
            story: coupleChapterLinkHtml(c, u),
        });
    }
    const solo = fam.children.filter(k => !placed.has(k));
    const grand = new Set<PersonId>();
    for (const k of fam.children) {
        for (const g of tree.persons[k]?.childIds ?? []) if (tree.persons[g] && !tree.persons[g].isPlaceholder) grand.add(g);
    }
    return { parents, parentsUnion, unions, solo, siblings: fam.siblings, grandchildren: sortByBirth([...grand], tree) };
}

/** The desktop and tablet tree (§4.1, 0–2 unions): parents, the person with partners to the sides, children under their union. */
function familyTreeDesktopHtml(c: Ctx, d: FtData): string {
    const lines: string[] = [];
    const labels: string[] = [];
    const cards: string[] = [];
    const hLine = (x1: number, x2: number, y: number, dashed = false) => {
        const l = Math.min(x1, x2);
        const w = Math.abs(x2 - x1);
        if (w > 0) lines.push(`<span class="pp-ft-h${dashed ? ' pp-ft-dash' : ''}" style="left:${ftPct(l)};top:${y}px;width:${ftPct(w)}"></span>`);
    };
    const vLine = (x: number, y1: number, y2: number, dashed = false) => {
        const t = Math.min(y1, y2);
        const h = Math.abs(y2 - y1);
        if (h > 0) lines.push(`<span class="pp-ft-v${dashed ? ' pp-ft-dash' : ''}" style="left:${ftPct(x)};top:${t}px;height:${h}px"></span>`);
    };
    // A label between two cards never grows wider than the gap (round 3 §4.1): it would run under the cards.
    const label = (x: number, y: number, html: string, maxW = 0) => {
        if (html) labels.push(`<span class="pp-ft-lab" style="left:${ftPct(x)};top:${y}px${maxW ? `;max-width:${ftPct(maxW)}` : ''}">${html}</span>`);
    };
    const card = (pid: PersonId, x: number, y: number, w: number, cls: string, extra = '', h = FT_CARD_H) =>
        cards.push(ftCard(c, pid, cls, `left:${ftPct(x)};top:${y}px;width:${ftPct(w)};height:${h}px`, extra));
    const mid = FT_W / 2;
    const meX = mid - FT_CARD / 2;
    let bottom = 0;

    // Parents (none in the data: the row is not there, §4.1 4e).
    const parentH = FT_CARD_H + (d.parents.some(p => relKind(c, p)) ? 16 : 0);
    const meTop = d.parents.length ? parentH + 40 : 0;
    if (d.parents.length === 2) {
        const [a, b] = d.parents;
        const ly = Math.round(parentH / 2);
        card(a, mid - 25 - FT_CARD, 0, FT_CARD, 'pp-ft-card--parent', relLabel(c, a), parentH);
        card(b, mid + 25, 0, FT_CARD, 'pp-ft-card--parent', relLabel(c, b), parentH);
        hLine(mid - 25, mid, ly, !!relKind(c, a));
        hLine(mid, mid + 25, ly, !!relKind(c, b));
        vLine(mid, ly, meTop, !!relKind(c, a) && !!relKind(c, b));
        if (d.parentsUnion) label(mid, ly + 6, `<span>${esc(d.parentsUnion)}</span>`);
    } else if (d.parents.length === 1) {
        const [a] = d.parents;
        card(a, meX, 0, FT_CARD, 'pp-ft-card--parent', relLabel(c, a), parentH);
        vLine(mid, parentH, meTop, !!relKind(c, a));
    }
    card(c.person.id, meX, meTop, FT_CARD, 'pp-ft-card--me');
    bottom = meTop + FT_CARD_H;

    // Partners to the sides: the 1st left, the 2nd right (3 unions and more: the upright tree, familyTreeRailHtml).
    const cy = meTop + FT_CARD_H / 2;
    const stems: { kids: PersonId[]; x: number; y: number }[] = [];
    d.unions.slice(0, FT_UPRIGHT_UNIONS - 1).forEach((u, k) => {
        const py = meTop, ly = cy;
        let px: number; let lx: number;
        if (k === 0) {
            px = 0; lx = (FT_CARD + meX) / 2;
            hLine(FT_CARD, meX, cy);
        } else {
            px = FT_W - FT_CARD; lx = (meX + FT_CARD + FT_W - FT_CARD) / 2;
            hLine(meX + FT_CARD, FT_W - FT_CARD, cy);
        }
        card(u.partner, px, py, FT_CARD, 'pp-ft-card--partner');
        bottom = Math.max(bottom, py + FT_CARD_H);
        const bits = [
            u.short ? `<span>${esc(u.short)}</span>` : '',
            u.kidsFrom ? `<span class="pp-ft-from">${esc(u.kidsFrom)}</span>` : '',
            u.story,
            u.kids.length ? '' : `<span class="pp-ft-nokids">${esc(c.P.tree.noKids)}</span>`,
        ].filter(Boolean);
        if (bits.length) {
            label(lx, ly - 9, bits.join(''), meX - FT_CARD);
            bottom = Math.max(bottom, ly - 9 + bits.length * 17);
        }
        if (u.kids.length) stems.push({ kids: u.kids, x: lx, y: ly });
    });
    if (d.solo.length) {
        // Children without a known other parent: under the person, with a note.
        label(mid, meTop + FT_CARD_H + 4, `<span>${esc(c.P.tree.otherParent)}</span>`);
        bottom = Math.max(bottom, meTop + FT_CARD_H + 4 + 17);
        stems.push({ kids: d.solo, x: mid, y: meTop + FT_CARD_H });
    }
    stems.sort((a, b) => a.x - b.x);

    // Children under their union: groups centred under their stem and pushed inward; over 5 children wrap
    // (K2-2b): every row has its own bus over its cards' centres with 12 px ticks, a trunk from the union's
    // stem runs down to the last row's bus, a shorter last row is centred under the trunk.
    if (stems.length) {
        const busY = bottom + 14;
        const kidTop = busY + FT_TICK;
        const pitch = FT_CARD_H + FT_ROW_GAP + FT_TICK;
        const cols = stems.map(s => Math.min(s.kids.length, FT_KIDS_PER_ROW));
        let kw = FT_KID;
        for (;;) {
            const fixed = cols.reduce((n, k) => n + (k - 1) * FT_KID_GAP, 0) + (stems.length - 1) * FT_GROUP_GAP;
            const sum = cols.reduce((n, k) => n + k, 0);
            kw = Math.min(FT_KID, Math.floor((FT_W - fixed) / sum));
            if (kw >= FT_KID_MIN) break;
            const widest = cols.indexOf(Math.max(...cols));
            if (cols[widest] <= 1) { kw = Math.max(kw, 60); break; }
            cols[widest]--;
        }
        const widths = cols.map(k => k * kw + (k - 1) * FT_KID_GAP);
        const lefts = stems.map((s, i) => s.x - widths[i] / 2);
        for (let i = 0; i < lefts.length; i++) {
            lefts[i] = Math.max(lefts[i], 0, i ? lefts[i - 1] + widths[i - 1] + FT_GROUP_GAP : 0);
        }
        let bound = FT_W;
        for (let i = lefts.length - 1; i >= 0; i--) {
            lefts[i] = Math.max(0, Math.min(lefts[i], bound - widths[i]));
            bound = lefts[i] - FT_GROUP_GAP;
        }
        stems.forEach((s, i) => {
            const n = cols[i];
            const rows = Math.ceil(s.kids.length / n);
            for (let r = 0; r < rows; r++) {
                const row = s.kids.slice(r * n, r * n + n);
                const rowW = row.length * kw + (row.length - 1) * FT_KID_GAP;
                // A full row fills the group; a shorter one is centred under the trunk (kept inside the group).
                const left = row.length === n ? lefts[i]
                    : Math.min(Math.max(s.x - rowW / 2, lefts[i]), lefts[i] + widths[i] - rowW);
                const top = kidTop + r * pitch;
                const bus = top - FT_TICK;
                row.forEach((k, j) => {
                    const x = left + j * (kw + FT_KID_GAP);
                    card(k, x, top, kw, 'pp-ft-card--kid');
                    vLine(x + kw / 2, bus, top);
                });
                const c0 = left + kw / 2;
                const c1 = left + rowW - kw / 2;
                hLine(Math.min(c0, s.x), Math.max(c1, s.x), bus);
                bottom = Math.max(bottom, top + FT_CARD_H);
            }
            vLine(s.x, s.y, kidTop + (rows - 1) * pitch - FT_TICK);
        });
    }
    return `<div class="pp-ft" style="height:${Math.ceil(bottom) + 2}px">${lines.join('')}${labels.join('')}${cards.join('')}</div>`;
}

/**
 * The upright tree (§4.2): on a phone and in a window narrower than 641 px;
 * with 3 unions and more (`wide`) on every width, where a union's block is a
 * grid (§4.2, round 2): the label and the partner on the left, "Children (n)"
 * and the children in 3 columns on the right; the parents in a 4-column grid.
 */
function familyTreeRailHtml(c: Ctx, d: FtData, wide = false): string {
    const { P } = c;
    let h = '';
    if (d.parents.length) {
        h += `<p class="pp-kicker pp-rail-kicker">${esc(P.parents)}</p>`
            + `<div class="pp-rail-2 pp-rail-parents">${d.parents.map(p => ftCard(c, p, 'pp-rail-card', '', relLabel(c, p))).join('')}</div>`
            + `<span class="pp-rail-stem" aria-hidden="true"></span>`;
    }
    h += ftCard(c, c.person.id, 'pp-rail-card pp-ft-card--me');
    const kidsHtml = (kids: PersonId[]) => `<div class="pp-rail-kids">` + (kids.length
        ? `<p class="pp-rail-lab">${esc(P.children(kids.length))}</p><div class="pp-rail-2 pp-rail-kidgrid">${kids.map(k => ftCard(c, k, 'pp-rail-card')).join('')}</div>`
        : `<p class="pp-rail-lab">${esc(P.tree.noKids)}</p>`) + `</div>`;
    for (const u of d.unions) {
        const story = u.story;
        // "· story ↓" stays one piece after the date (round 3 §4.2).
        h += `<div class="pp-rail-u"><div class="pp-rail-side"><p class="pp-rail-lab"><span>${esc(u.long)}</span>${story ? `<span class="pp-rail-story">· ${story}</span>` : ''}</p>`
            + ftCard(c, u.partner, 'pp-rail-card') + `</div>` + kidsHtml(u.kids) + `</div>`;
    }
    if (d.solo.length) {
        h += `<div class="pp-rail-u"><div class="pp-rail-side"><p class="pp-rail-lab">${esc(P.tree.otherParent)}</p></div>${kidsHtml(d.solo)}</div>`;
    }
    return `<div class="pp-rail${wide ? ' pp-rail--wide' : ''}">${h}</div>`;
}

/** Under the tree: siblings (folded over 3) and grandchildren (folded), as chips. */
function familyTreeMoreHtml(c: Ctx, d: FtData): string {
    const { P } = c;
    const rows: string[] = [];
    const chips = (ids: PersonId[]) => `<div class="pp-chips">${ids.map(id => ftChip(c, id)).join('')}</div>`;
    if (d.siblings.length) {
        const title = P.tree.siblings(d.siblings.length);
        rows.push(d.siblings.length <= 3
            ? `<div class="pp-ft-row pp-ft-row--open"><span class="pp-ft-row-h">${esc(title)}</span>${chips(d.siblings)}</div>`
            : fold(c, {
                key: 'sibs', id: 'pp-sibs', cls: 'pp-ft-row pp-sibs',
                head: `<span class="pp-disc--inline">${esc(title)} ${foldState('▸', '▴')}</span>`, body: chips(d.siblings),
            }));
    }
    if (d.grandchildren.length) {
        rows.push(fold(c, {
            key: 'grand', id: 'pp-grand', cls: 'pp-ft-row pp-grand',
            head: `<span class="pp-disc--inline">${esc(P.tree.grandchildren(d.grandchildren.length))} ${foldState('▸', '▴')}</span>`,
            body: chips(d.grandchildren),
        }));
    }
    return rows.length ? `<div class="pp-ft-more">${rows.join('')}</div>` : '';
}

/**
 * The family as a small tree (§4): `.pp-ft` on a page wider than 640 px,
 * `.pp-rail` below that (the CSS picks one by the window's or file's width),
 * the siblings' and grandchildren's rows under both.
 */
function familyTreeHtml(c: Ctx): string {
    const d = familyTreeData(c);
    const any = d.parents.length || d.unions.length || d.solo.length || d.siblings.length || d.grandchildren.length;
    if (!any) return '';
    // 0–2 unions: the tree to the sides (the upright one under 641 px); 3 and more: upright on every width.
    const upright = d.unions.length >= FT_UPRIGHT_UNIONS;
    const core = !(d.parents.length || d.unions.length || d.solo.length) ? ''
        : upright ? familyTreeRailHtml(c, d, true) : familyTreeDesktopHtml(c, d) + familyTreeRailHtml(c, d);
    return section('family', c.P.sec.family, `<div class="pp-fam">${core}${familyTreeMoreHtml(c, d)}</div>`);
}

function section(key: PersonPageSection['key'], title: string, body: string, head = ''): string {
    const h = head || `<h2>${esc(title)}</h2>`;
    return `<section class="pp-sec pp-sec--${key}" id="pp-sec-${key}">${h}${body}</section>`;
}

// ── Story, notes ──

/** A story not approved yet is shown too, marked as a draft (as the story reader does). */
function draftTag(c: Ctx, st: Story): string {
    return st.status === 'draft' ? ` <span class="pp-draft-tag">${esc(c.S.story.statusDraft)}</span>` : '';
}

/** What the story rests on (facts, the author's note), folded under the prose. */
function storyBasisHtml(c: Ctx, st: Story, key: string, id: string): string {
    const { P, page } = c;
    const facts = (st.facts ?? []).map(f => stripResearchIds(f)).filter(f => f.text.trim());
    const note = st.note?.trim() ? stripResearchIds(st.note).text : '';
    if (!facts.length && !note) return '';
    const showIds = page.groups.research;
    const items = facts.map(f => {
        f.ids.forEach(rid => c.ids.add(rid));
        return `<li>${esc(f.text.trim())}${showIds ? f.ids.map(rid => `<span class="pp-id">${esc(rid)}</span>`).join('') : ''}</li>`;
    }).join('');
    return fold(c, {
        key, id, cls: 'pp-basis',
        head: `<span class="pp-disc--inline">${esc(P.storyBasis)} ${foldState('▸', '▾')}</span>`,
        body: `<div class="pp-basis-body">${items ? `<ul>${items}</ul>` : ''}`
            + (note ? `<p class="pp-basis-note">${esc(P.authorNote)}: ${esc(note)}</p>` : '') + `</div>`,
    });
}

// ── Couple's chapters (spec 027 §5–§6) ──
// A couple's story (Partnership.story) is told whole on both partners' pages,
// as a chapter "Story of the marriage" under the person's own story, in the
// order of the marriages. coupleChapterHtml is a pure block (data → HTML), to
// be reused by a couple's page; the window folds with a button (the open set
// of the page, so Back restores it), the file with <details>, print unfolds.

/** The anchor id of a couple's chapter on the person page (stable: the family tree links to it). */
export function coupleChapterId(unionId: string): string {
    return `pp-story-${unionId.replace(/[^\w-]/g, '_')}`;
}

/** The key of a chapter's fold in the window's open set. */
function coupleChapterFoldKey(unionId: string): string {
    return `story-${unionId.replace(/[^\w-]/g, '_')}`;
}

/**
 * The label of a link to a couple's chapter (the family tree at the wedding,
 * round 3 §4.1): always the fixed "story ↓", never the title (it would run
 * under the cards); '' when the couple has no story.
 */
export function coupleChapterLinkLabel(u: Partnership, lang: Language): string {
    if (!u.story?.text?.trim()) return '';
    return getStringsForLang(lang).personPage.story.link;
}

/** The tooltip and accessible name of that link: "Story of the marriage: {title}" ({name} and {name} without one), a draft marked. */
export function coupleChapterLinkTip(ch: CoupleChapterData, lang: Language): string {
    const S = getStringsForLang(lang);
    const what = ch.title || (ch.partnerShort ? S.story.couple(ch.selfShort, ch.partnerShort) : ch.selfShort);
    return S.personPage.story.treeTip(what, ch.draft);
}

/** What a couple's chapter shows, from the person's side (coupleChapterHtml renders it). */
export interface CoupleChapterData {
    unionId: string;
    /** The page's person first, the partner second (monogram, the names line). */
    selfName: string;
    partnerName: string;
    /** First names for short labels ("Jan and Rozálie"). */
    selfShort: string;
    partnerShort: string;
    selfInitials: string;
    partnerInitials: string;
    partnerId?: PersonId;
    /** "1885–1910" (wedding → end of the union or the first death). */
    years: string;
    /** The title without research ids ('' = none: the two names are the heading). */
    title: string;
    /** The prose as HTML, research ids removed. */
    prose: string;
    draft: boolean;
    /** Research ids the story carried (for the researchers' section). */
    ids: string[];
}

export interface CoupleChapterContext {
    lang: Language;
    /** Window: a button folds the rest; file: <details>; print: all unfolded. */
    mode: PersonPageMode;
    /** Folded to its first paragraph (the chapter follows the person's own story). */
    foldable: boolean;
    /** Window: the chapter is unfolded now. */
    open: boolean;
    /** The partner's name as HTML for "The same story is also on …" ('' = no such line). */
    partnerHtml: string;
    /** Under the prose (inside the fold when folded), e.g. the story's basis. */
    basisHtml?: string;
    /** Two or more chapters on the page (own story + marriages): the tinted surface and the double monogram. */
    tint: boolean;
}

/** The chapter's data from a tree: the person and one of the person's couples with a story (null: none). */
export function coupleChapterData(tree: StromData, person: Person, u: Partnership, lang: Language): CoupleChapterData | null {
    const st = u.story;
    if (!st?.text?.trim()) return null;
    const pid = u.person1Id === person.id ? u.person2Id : u.person1Id;
    const partner = pid ? tree.persons[pid] : undefined;
    const real = partner && !partner.isPlaceholder ? partner : undefined;
    const stripped = stripResearchIds(st.text);
    const title = st.title?.trim() ? stripResearchIds(st.title).text.trim() : '';
    const short = (p: Person) => p.firstName?.trim() || shownNameOrEmpty(p);
    return {
        unionId: u.id,
        selfName: shownNameOrEmpty(person), partnerName: real ? shownNameOrEmpty(real) : '',
        selfShort: short(person), partnerShort: real ? short(real) : '',
        selfInitials: personInitials(person.firstName, person.lastName),
        partnerInitials: real ? personInitials(real.firstName, real.lastName) : '',
        ...(real ? { partnerId: real.id } : {}),
        years: coupleStoryYears(tree, u, getStringsForLang(lang).personPage.story.until),
        title,
        prose: storyProseHtml(stripped.text, { title: title || undefined, headingLevel: 4 }),
        draft: st.status === 'draft',
        ids: stripped.ids,
    };
}

/** A couple's chapter: kicker with the years (always), title, prose, "also on …"; tinted with a double monogram from two chapters. */
export function coupleChapterHtml(ch: CoupleChapterData, cx: CoupleChapterContext): string {
    const S = getStringsForLang(cx.lang);
    const P = S.personPage;
    const id = coupleChapterId(ch.unionId);
    const pair = ch.partnerName ? S.story.couple(ch.selfName, ch.partnerName) : ch.selfName;
    const mono = !cx.tint ? '' : `<span class="pp-ch-mono" aria-hidden="true"><span>${esc(ch.selfInitials || '?')}</span>`
        + (ch.partnerName ? `<span>${esc(ch.partnerInitials || '?')}</span>` : '') + `</span>`;
    const tag = ch.draft ? ` <span class="pp-draft-tag">${esc(S.story.statusDraft)}</span>` : '';
    const head = `<div class="pp-ch-head">${mono}<div class="pp-ch-headtext">`
        + `<p class="pp-kicker pp-ch-kicker">${esc(P.story.couple(ch.years))}</p>`
        + (ch.title ? `<p class="pp-ch-pair">${esc(pair)}</p>` : '')
        + `</div></div><h3 class="pp-ch-title">${esc(ch.title || pair)}${tag}</h3>`;
    const basis = cx.basisHtml ?? '';
    const { lead, rest } = cx.foldable && cx.mode !== 'print' ? splitProseLead(ch.prose) : { lead: ch.prose, rest: '' };
    const label = (closed: string, open: string) =>
        `<span class="pp-st-closed">${esc(closed)}</span><span class="pp-st-open">${esc(open)}</span>`;
    let text: string;
    let toggle = '';
    if (!rest) {
        text = `<div class="pp-prose">${lead}</div>${basis}`;
    } else if (cx.mode === 'app') {
        text = `<div class="pp-prose">${lead}</div>`
            + `<div class="pp-ch-rest" id="${id}-rest"${cx.open ? '' : ' hidden'}><div class="pp-prose">${rest}</div>${basis}</div>`;
        toggle = `<button type="button" class="pp-ch-more" aria-expanded="${cx.open}" aria-controls="${id}-rest" `
            + `data-pp-toggle="${esc(coupleChapterFoldKey(ch.unionId))}">${label(P.story.readAll, P.story.collapse)}</button>`;
    } else {
        // The file: the first paragraph outside, the rest in <details> (the summary reads as a link).
        text = `<div class="pp-prose">${lead}</div>`
            + `<details class="pp-ch-fold"><summary class="pp-ch-more">${label(P.story.readAll, P.story.collapse)}</summary>`
            + `<div class="pp-prose">${rest}</div>${basis}</details>`;
    }
    const also = cx.partnerHtml
        ? `<span class="pp-ch-also">${esc(P.story.also('\u0000')).replace('\u0000', cx.partnerHtml)}</span>` : '';
    const foot = toggle || also ? `<p class="pp-ch-foot">${toggle}${also}</p>` : '';
    return `<div class="pp-couple-story${cx.tint ? ' pp-couple-story--tint' : ''}" id="${id}" tabindex="-1">${head}${text}${foot}</div>`;
}

/** A link that unfolds a couple's chapter and scrolls to it (window: a button; file: an anchor). */
function storyJumpHtml(c: Ctx, unionId: string, label: string, cls = 'pp-story-jump', tip = '', inner = ''): string {
    const id = coupleChapterId(unionId);
    const t = tip ? ` title="${esc(tip)}" aria-label="${esc(tip)}"` : '';
    const content = inner || esc(label);
    if (c.app) return `<button type="button" class="pp-link ${cls}" data-pp-story="${esc(id)}"${t}>${content}</button>`;
    return `<a class="${cls}" href="#${esc(id)}" data-pp-story="${esc(id)}"${t}>${content}</a>`;
}

/**
 * The family tree's link to a couple's chapter at the wedding (§5.1, round 3
 * §4.1): "story ↓" with the title in the tooltip; where the gap between the
 * cards is narrow only "↓" (CSS); '' when the page has no chapter for the
 * couple (no story, or privacy left it out with a living partner).
 */
function coupleChapterLinkHtml(c: Ctx, u: Partnership): string {
    const shown = c.tree.partnerships[u.id];
    if (!shown || !c.person.partnerships.includes(u.id)) return '';
    const label = coupleChapterLinkLabel(shown, c.page.lang);
    const ch = label ? coupleChapterData(c.tree, c.person, shown, c.page.lang) : null;
    if (!ch) return '';
    const inner = `<span class="pp-ft-story-l">${esc(label)}</span><span class="pp-ft-story-s" aria-hidden="true">↓</span>`;
    return storyJumpHtml(c, u.id, label, 'pp-ft-story', coupleChapterLinkTip(ch, c.page.lang), inner);
}

function storyHtml(c: Ctx): string {
    const { P, S, person } = c;
    const own = person.story?.text?.trim() ? person.story : undefined;
    const chapters = coupleStories(c.tree, person)
        .map(u => ({ u, ch: coupleChapterData(c.tree, person, u, c.page.lang) }))
        .filter((x): x is { u: Partnership; ch: CoupleChapterData } => !!x.ch);
    if (!own && !chapters.length) return '';
    let head = `<h2 class="pp-kicker pp-story-kicker">${esc(P.sec.story)}</h2>`;
    let body = '';
    if (own) {
        const stripped = stripResearchIds(own.text);
        stripped.ids.forEach(id => c.ids.add(id));
        const title = own.title?.trim() ? stripResearchIds(own.title).text : '';
        const tag = draftTag(c, own);
        head = title
            ? `<p class="pp-kicker">${esc(P.sec.story)}${tag}</p><h2 class="pp-story-title">${esc(title)}</h2>`
            : `<h2 class="pp-kicker pp-story-kicker">${esc(P.sec.story)}${tag}</h2>`;
        body += `<div class="pp-prose">${storyProseHtml(stripped.text, { title: title || undefined, headingLevel: 3 })}</div>`
            + storyBasisHtml(c, own, 'basis', 'pp-basis');
        // Continued reading (§6.1): the own story leads on to the marriages' chapters.
        if (chapters.length) {
            const links = chapters.map(({ u, ch }) =>
                storyJumpHtml(c, u.id, `${ch.title || (ch.partnerShort ? S.story.couple(ch.selfShort, ch.partnerShort) : ch.selfShort)} ↓`));
            body += `<p class="pp-story-cont"><span>${esc(P.story.continues)}</span> ${links.join(' ')}</p>`;
        }
    }
    for (const { u, ch } of chapters) {
        ch.ids.forEach(id => c.ids.add(id));
        const uid = u.id.replace(/[^\w-]/g, '_');
        body += coupleChapterHtml(ch, {
            lang: c.page.lang, mode: c.opts.mode,
            // After the person's own story a chapter folds to its first paragraph; alone it is whole.
            foldable: !!own, open: isOpen(c, coupleChapterFoldKey(u.id)),
            // Every chapter on the page counts (round 2): the tone from two.
            tint: (own ? 1 : 0) + chapters.length >= 2,
            partnerHtml: ch.partnerId ? personLink(c, esc(ch.partnerName), ch.partnerId) : '',
            basisHtml: storyBasisHtml(c, u.story!, `basis-${uid}`, `pp-basis-${uid}`),
        });
    }
    return section('story', P.sec.story, body, head);
}

function notesHtml(c: Ctx): string {
    const notes = c.person.notes?.trim();
    if (!notes) return '';
    const stripped = stripResearchIds(notes);
    stripped.ids.forEach(id => c.ids.add(id));
    return section('notes', c.P.sec.notes, `<p class="pp-notes-text">${esc(stripped.text)}</p>`);
}

// ── Timeline ──

/** The year column: a span of years ("1950–1960") may break after the dash, never under the marker. */
/**
 * A span of years (round 3 §2.8). `cell` (the timeline's narrow year column):
 * always two lines, the start in bold, "–1790" under it, never a dash left at
 * a line's end; `inline` (labels, a card's footer): one piece that does not
 * break. The same year twice is the year alone.
 */
export function yearRangeHtml(a: string, b: string, mode: 'cell' | 'inline'): string {
    if (!b || a === b) return esc(a);
    if (mode === 'inline') return `<span class="pp-nw">${esc(`${a}–${b}`)}</span>`;
    return `<span class="pp-yr"><b>${esc(a)}</b><small>–${esc(b)}</small></span>`;
}

function yearCell(label: string): string {
    const range = label.match(/^(.+?)–(.+)$/);
    return `<span class="pp-y">${range ? yearRangeHtml(range[1], range[2], 'cell') : esc(label)}</span>`;
}

function eventOf(c: Ctx, pt: LifelinePoint): LifeEvent | undefined {
    return pt.eventId ? c.person.events?.find(e => e.id === pt.eventId) : undefined;
}

function pointDate(c: Ctx, pt: LifelinePoint): string | undefined {
    const u = pt.partnershipId ? c.tree.partnerships[pt.partnershipId] : undefined;
    switch (pt.kind) {
        case 'birth': return c.person.birthDate;
        case 'death': return c.person.deathDate;
        case 'marriage': return u?.startDate;
        case 'divorce': return u?.endDate;
        case 'child': return pt.relatedId ? c.tree.persons[pt.relatedId as PersonId]?.birthDate : undefined;
        case 'event': return eventOf(c, pt)?.date;
        case 'coupleEvent': return u?.events?.find(e => e.id === pt.eventId)?.date;
        case 'childEvent': {
            const kid = pt.relatedId ? c.tree.persons[pt.relatedId as PersonId] : undefined;
            if (pt.childEvent === 'death') return kid?.deathDate;
            if (pt.childEvent === 'burial') return kid?.events?.find(e => e.type === 'burial')?.date;
            return undefined;
        }
    }
}

function exactDate(c: Ctx, value: string | undefined): string {
    const d = parseFlexDate(value);
    return d && d.month !== undefined ? personPageDate(value, c.page.lang) : '';
}

function participantNames(c: Ctx, list: readonly EventParticipant[] | undefined, role?: EventParticipant['role']): string {
    return (list ?? []).filter(p => !role || p.role === role).map(p => {
        const linked = p.personId ? c.tree.persons[p.personId] : undefined;
        const name = linked ? shownNameOrEmpty(linked) : p.name?.trim() ?? '';
        return name ? personLink(c, esc(name), linked?.id) : '';
    }).filter(Boolean).join(', ');
}

/**
 * The age a record gives at a row's event (deathAge, an event's age, the age at
 * a wedding), only when it differs from the age the dates give or the dates give
 * none (§0.6); '' otherwise. A plain number of years is worded, anything else
 * ("3 měsíce", "kojenec") is quoted as written.
 */
function recordedAgeText(c: Ctx, recorded: string | undefined, eventDate: string | undefined): string {
    const text = recorded?.trim();
    if (!text) return '';
    if (recordedAgeGap(text, ageBirthDate(c.person), eventDate) === 0) return '';
    const a = readRecordedAge(text);
    return a?.kind === 'span' && !a.qualifier && !a.months && !a.weeks && !a.days
        ? c.P.detail.recordedAge(a.years) : c.P.detail.recordedAs(text);
}

function detailsLine(c: Ctx, pt: LifelinePoint, merged?: LifelinePoint): string {
    const { P } = c;
    const parts: string[] = [];
    const date = exactDate(c, pointDate(c, pt));
    if (date) parts.push(esc(date));
    if (merged) {
        const md = pointDate(c, merged);
        const label = merged.eventType === 'baptism' ? P.detail.baptism : P.detail.burial;
        const mdText = personPageDate(md, c.page.lang);
        if (mdText) parts.push(esc(label(mdText)) + (merged.place && merged.place !== pt.place ? `, ${placeLink(c, merged.place)}` : ''));
    }
    const ev = eventOf(c, pt);
    const bapt = merged ? eventOf(c, merged) : undefined;
    const u = pt.partnershipId ? c.tree.partnerships[pt.partnershipId] : undefined;
    const godSrc = ev?.type === 'baptism' ? ev : bapt?.type === 'baptism' ? bapt : undefined;
    if (godSrc) {
        const g = participantNames(c, godSrc.participants, 'godparent');
        if (g) parts.push(P.detail.godparents('\u0000').split('\u0000').map(esc).join(g));
    }
    const witnessList = pt.kind === 'marriage' ? u?.participants
        : pt.kind === 'coupleEvent' ? u?.events?.find(e => e.id === pt.eventId)?.participants : ev?.participants;
    const w = participantNames(c, witnessList, 'witness');
    if (w) parts.push(P.detail.witnesses('\u0000').split('\u0000').map(esc).join(w));
    if (ev && ev.type !== 'baptism') {
        const others = participantNames(c, ev.participants?.filter(p => p.role !== 'witness' && p.role !== 'godparent'));
        if (others) parts.push(c.S.personModal.lifelineWith('\u0000').split('\u0000').map(esc).join(others));
    }
    if (pt.details?.cause) parts.push(esc(pt.details.cause));
    const age = recordedAgeText(c, pt.details?.age, pointDate(c, pt));
    if (age) parts.push(esc(age));
    const mergedAge = merged && merged.details?.age?.trim() !== pt.details?.age?.trim()
        ? recordedAgeText(c, merged.details?.age, pointDate(c, merged)) : '';
    if (mergedAge) parts.push(esc(mergedAge));
    const note = pt.kind === 'event' && ev?.note?.trim() && !pt.detail ? ev.note.trim()
        : pt.kind === 'marriage' ? u?.note?.trim() : '';
    if (note) parts.push(esc(stripResearchIds(note).text));
    if (pt.details?.address) parts.push(esc(pt.details.address));
    if (!parts.length) return '';
    const line = parts.join(' · ');
    const plainLen = line.replace(/<[^>]*>/g, '').length;
    if (plainLen <= 140) return `<span class="pp-dt">${line}</span>`;
    return `<details class="pp-dtx"><summary><span class="pp-dt">${line}</span><span class="pp-more">${esc(P.more)} ▸</span></summary></details>`;
}

function rowText(c: Ctx, pt: LifelinePoint, merged?: LifelinePoint): string {
    const { S, P } = c;
    const pm = S.personModal;
    const place = pt.place ? ` <span class="pp-place">· ${placeLink(c, pt.place)}</span>` : '';
    const who = pt.relatedName ? personLink(c, esc(nameOf(c, pt.relatedId as PersonId) || pt.relatedName), pt.relatedId as PersonId) : '';
    const fill = (fn: (s: string) => string, html: string) => fn('\u0000').split('\u0000').map(esc).join(html);
    switch (pt.kind) {
        case 'birth': return `${esc(merged ? P.ev.birthBaptism : pm.lifelineBorn)}${place}`;
        case 'death': return `${esc(merged ? P.ev.deathBurial : pm.lifelineDied)}${place}`;
        case 'marriage': return `${who ? fill(pm.lifelineMarried, who) : esc(pm.lifelineMarriedUnknown)}${place}`;
        case 'divorce':
            if (pt.unmarried) return `${who ? fill(pm.lifelineRelationEnded, who) : esc(pm.lifelineRelationEndedUnknown)}${place}`;
            return `${who ? fill(pm.lifelineDivorced, who) : esc(pm.lifelineDivorcedUnknown)}${place}`;
        case 'child': return who ? fill(pm.lifelineChild, who) : esc(pm.lifelineChildUnknown);
        case 'childEvent': {
            const types = pm.lifelineChildEventTypes;
            const what = merged ? P.evc.deathBurial
                : pt.childEvent === 'divorce' && pt.unmarried ? types.relationEnded : types[pt.childEvent ?? 'death'];
            const name = `<strong>${who || '?'}</strong>`;
            const text = pm.lifelineChildEvent('\u0000', '\u0001');
            return esc(text).replace('\u0000', name).replace('\u0001', esc(what)) + place;
        }
        case 'coupleEvent': {
            const label = esc(coupleEventLabelIn({ type: pt.coupleType ?? 'custom', customLabel: pt.customLabel }, S));
            return `${who ? pm.lifelinePartnerEvent('\u0000', '\u0001').split('\u0000').map(s => s.split('\u0001').map(esc).join(who)).join(label) : label}${place}`;
        }
        default: {
            const label = lifeEventLabel({ type: pt.eventType ?? 'custom', customLabel: pt.customLabel }, S);
            const detail = pt.detail ? `: ${esc(stripResearchIds(pt.detail).text)}` : '';
            return `${esc(label)}${detail}${place}`;
        }
    }
}

function markOf(pt: LifelinePoint): string {
    if (pt.kind === 'birth' || pt.kind === 'child') return '*';
    if (pt.kind === 'marriage') return '⚭';
    if (pt.kind === 'death') return '†';
    if (pt.kind === 'event' && pt.eventType === 'emigration') return '→';
    return '·';
}

/** The first excerpt of the first source cited at a birth / marriage / death row. */
function mainExcerpt(c: Ctx, pt: LifelinePoint, merged?: LifelinePoint): { source: Source; excerpt: SourceExcerpt; event: PersonPageCaptionEvent } | null {
    if (!c.page.groups.excerpts) return null;
    const ids: string[] = [];
    let event: PersonPageCaptionEvent;
    if (pt.kind === 'birth') {
        ids.push(...(c.person.birthSourceIds ?? []));
        if (merged) ids.push(...(eventOf(c, merged)?.sourceIds ?? []));
        event = merged ? 'birthBaptism' : 'birth';
    } else if (pt.kind === 'death') {
        ids.push(...(c.person.deathSourceIds ?? []));
        if (merged) ids.push(...(eventOf(c, merged)?.sourceIds ?? []));
        event = merged ? 'deathBurial' : 'death';
    } else if (pt.kind === 'marriage' && pt.partnershipId) {
        ids.push(...(c.tree.partnerships[pt.partnershipId]?.sourceIds ?? []));
        event = 'marriage';
    } else return null;
    for (const sid of ids) {
        if (c.mainEx.has(sid)) continue;
        const s = c.tree.sources?.[sid];
        const e = s?.excerpts?.[0];
        if (s && e && safeImage(e.dataUrl)) return { source: s, excerpt: e, event };
    }
    return null;
}

function figureHtml(c: Ctx, src: string, caption: string, id?: string): string {
    const idAttr = id ? ` id="${id}"` : '';
    if (c.imgs) {
        // The file: the image's class (embedded once), a link into its light box when the gallery has it.
        const n = c.galIndex.get(src.replace(/\s+/g, ''));
        const img = imgHtml(c, src, caption, 'pp-fig-img');
        const pic = n
            ? `<a class="pp-fig-link" href="#obr-${n}" aria-label="${esc(`${c.P.zoom}: ${caption}`)}">${img}<span class="pp-zoom" aria-hidden="true">⤢</span></a>`
            : img;
        return `<figure class="pp-fig"${idAttr}>${pic}<figcaption>${esc(caption)}</figcaption></figure>`;
    }
    const zoom = c.app ? `<button type="button" class="pp-zoom" data-pp-zoom aria-label="${esc(c.P.zoom)}">⤢</button>` : '';
    return `<figure class="pp-fig"${idAttr}><img src="${esc(src)}" alt="${esc(caption)}" loading="lazy">${zoom}`
        + `<figcaption>${esc(caption)}</figcaption></figure>`;
}

function histRowHtml(c: Ctx, item: LifelineHistoryItem): string {
    const { S } = c;
    const ev = item.ev;
    const scope = ev.scope === 'local' ? 'local' : ev.scope === 'place' ? 'place' : 'region';
    const mark = scope === 'local' ? '■' : scope === 'place' ? '▲' : '◇';
    const meta: string[] = [];
    meta.push(`<span class="pp-hist-kind">${esc(S.history.kinds[ev.kind] ?? ev.kind)}</span>`);
    // "age 24–39" is one piece: the footer wraps it whole to the next line (round 3 §2.8).
    if (item.age) meta.push(`<span class="pp-nw">${esc(item.age)}</span>`);
    if (item.regionLabel) meta.push(esc(item.regionLabel));
    if (ev.source) {
        const link = extLink(ev.source.url, historySourceLabel(ev.source));
        if (link) meta.push(`${esc(S.history.source)} ${link}`);
    } else if (ev.local?.cite) {
        meta.push(`${esc(S.history.source)} ${esc(stripResearchIds(ev.local.cite).text)}`);
    }
    const quote = ev.source?.quote?.trim();
    if (quote) {
        meta.push(`<details class="pp-quote"${c.app ? '' : ' open'}><summary>${esc(S.history.quote)} ▸</summary>`
            + `<blockquote>${esc(S.history.quoted(quote))}</blockquote></details>`);
    }
    const langAttr = item.textLang && item.textLang !== c.page.lang ? ` lang="${esc(item.textLang)}"` : '';
    return `<div class="pp-row pp-row--hist"${anchorAttr(c, chartHistAnchorId(ev.id))}>${yearCell(item.yearLabel ?? String(item.year))}`
        + `<span class="pp-m"><span class="pp-mk pp-hm--${scope}" aria-hidden="true">${mark}</span></span>`
        + `<div class="pp-t"><div class="pp-hist"><p${langAttr}>${esc(stripResearchIds(item.text).text)}</p>`
        + `<div class="pp-hist-meta">${meta.join('<span aria-hidden="true">·</span>')}</div></div></div></div>`;
}

function timelineHtml(c: Ctx): string {
    const { P, page, person } = c;
    const points = computePersonLifeline(page.tree, page.personId, { childEvents: page.groups.childEvents });
    const segs = personPageTimeline(points, page.history, {
        childEvents: page.groups.childEvents, history: page.groups.history, living: page.living.has(person.id),
    });
    if (!segs.length) return '';
    let marriageNo = 0;
    const rowHtml = (r: PersonPageTimelineRow): string => {
        if (r.kind === 'hist') return histRowHtml(c, r.item);
        const pt = r.point;
        const cls = r.kind === 'kid' ? 'pp-row--kid' : 'pp-row--own';
        const ex = r.kind === 'own' ? mainExcerpt(c, pt, r.merged) : null;
        let fig = '';
        if (ex) {
            const anchor = pt.kind === 'birth' ? 'pp-ex-birth' : pt.kind === 'death' ? 'pp-ex-death' : `pp-ex-marriage-${++marriageNo}`;
            const label = pt.kind === 'marriage' ? c.S.personSources.citeUnion(pt.year)
                : `${r.merged ? (pt.kind === 'birth' ? P.ev.birthBaptism : P.ev.deathBurial) : c.S.events.types[pt.kind === 'birth' ? 'birth' : 'death']} ${pt.year}`;
            c.mainEx.set(ex.source.id, { anchor, label });
            const caption = P.excerptCaption(ex.event, registerKindOf(ex.source.title), pt.place ?? '', pt.year);
            fig = figureHtml(c, shownExcerpt(ex.excerpt), caption, anchor);
        }
        // The life chart's and the places list's anchors (#osa-…): the row, and inside it the point merged in.
        const id = anchorAttr(c, chartAnchorId(pt.sortKey));
        const mergedId = r.merged ? anchorAttr(c, chartAnchorId(r.merged.sortKey)) : '';
        return `<div class="pp-row ${cls}"${id}>${yearCell(pt.yearLabel ?? String(pt.year))}`
            + `<span class="pp-m"><span class="pp-mk" aria-hidden="true">${markOf(pt)}</span></span>`
            + `<div class="pp-t">${mergedId ? `<span class="pp-osa-anchor"${mergedId}></span>` : ''}`
            + `${rowText(c, pt, r.merged)}${detailsLine(c, pt, r.merged)}${fig}</div></div>`;
    };
    const segHtml = segs.map(s => {
        const has = new Set(s.rows.map(r => r.kind));
        const cls = ['pp-seg', ...[...has].map(k => `pp-seg--${k}`)].join(' ');
        const title = s.titled
            ? `<div class="pp-seg-title">${esc(P.seg[s.key])}<span class="pp-seg-years">${s.from === s.to ? s.from : `${s.from}–${s.to}`}</span></div>`
            : '';
        return `<div class="${cls}">${title}${s.rows.map(rowHtml).join('')}</div>`;
    }).join('');
    // The switches apply to the life chart too (its history row, the children's lines).
    const chart = c.chart;
    const hasHist = segs.some(s => s.rows.some(r => r.kind === 'hist')) || !!chart?.history.length;
    const hasKid = segs.some(s => s.rows.some(r => r.kind === 'kid')) || !!chart?.lines.some(l => l.kind === 'child');
    const sw = (key: 'history' | 'childEvents', label: string) =>
        `<button type="button" class="pp-toggle${c.app ? '' : ' js-only'}" role="switch" aria-checked="${c.opts.toggles[key]}" data-pp-switch="${key}">${esc(label)}</button>`;
    const toggles = [hasHist ? sw('history', P.toggle.history) : '', hasKid ? sw('childEvents', P.toggle.childEvents) : ''].join('');
    const head = `<div class="pp-sec-head"><h2>${esc(P.sec.timeline)}</h2>${toggles ? `<div class="pp-toggles">${toggles}</div>` : ''}</div>`;
    const legend = segs.some(s => s.rows.some(r => r.kind === 'hist'))
        ? `<p class="pp-legend"><span><span class="pp-hm pp-hm--region" aria-hidden="true">◇</span>${esc(P.legend.region)}</span>`
            + `<span><span class="pp-hm pp-hm--place" aria-hidden="true">▲</span>${esc(P.legend.place)}</span>`
            + `<span><span class="pp-hm pp-hm--local" aria-hidden="true">■</span>${esc(P.legend.local)}</span></p>`
        : '';
    // Slot 7 (§2.1): the life chart above the text timeline.
    const chartHtml = chart
        ? `<div class="pp-chart-host">${lifeChartHtml(chart, { lang: c.page.lang, mode: c.app ? 'app' : 'file', ...(c.opts.chartWidth ? { width: c.opts.chartWidth } : {}) })}</div>`
        : '';
    return section('timeline', P.sec.timeline, chartHtml + legend + segHtml, head);
}

// ── Images embedded once (§3.2: the file's <style> holds each image, everything else names its class) ──

/** An image's pixel size from its data URL's header (PNG, GIF, JPEG, WebP), else null. */
export function dataUrlImageSize(url: string): { w: number; h: number } | null {
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    let bytes: Uint8Array;
    try {
        const b64 = url.slice(comma + 1, comma + 1 + 90_000).replace(/\s+/g, '');
        const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
        return null;
    }
    const b = bytes;
    const be16 = (i: number) => (b[i] << 8) | b[i + 1];
    const le16 = (i: number) => b[i] | (b[i + 1] << 8);
    const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        return ok(((b[16] << 24) | (b[17] << 16) | be16(18)) >>> 0, ((b[20] << 24) | (b[21] << 16) | be16(22)) >>> 0);
    }
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(le16(6), le16(8));
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xff) { i++; continue; }
            const m = b[i + 1];
            if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(be16(i + 7), be16(i + 5));
            i += 2 + be16(i + 2);
        }
        return null;
    }
    if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
        const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (tag === 'VP8 ') return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
        if (tag === 'VP8L') {
            const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            return ok((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
        }
        if (tag === 'VP8X') return ok((b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1);
    }
    return null;
}

const CSS_SAFE_IMAGE = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;

/** The file's entry of an image (registered on first use); null in the window and in print. */
function imgEntry(c: Ctx, src: string): ImgEntry | null {
    if (!c.imgs) return null;
    const clean = src.replace(/\s+/g, '');
    if (!CSS_SAFE_IMAGE.test(clean)) return null;
    let e = c.imgs.get(clean);
    if (!e) {
        const size = dataUrlImageSize(clean);
        e = { n: c.imgs.size + 1, src: clean, ratio: size ? `${size.w} / ${size.h}` : null };
        c.imgs.set(clean, e);
    }
    return e;
}

/** An image: `<img>` in the window, in the file a span painted by the image's class. */
function imgHtml(c: Ctx, src: string, alt: string, cls: string): string {
    const e = imgEntry(c, src);
    if (!e) return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
    return `<span class="pp-img ${cls} img-${e.n}"${alt ? ` role="img" aria-label="${esc(alt)}"` : ' aria-hidden="true"'}></span>`;
}

/** The file's one <style> of images (each data URL once). */
function imgStyles(c: Ctx): string {
    if (!c.imgs?.size) return '';
    const rules = [...c.imgs.values()]
        .map(e => `.img-${e.n}{background-image:url("${e.src}")${e.ratio ? `;--pp-ar:${e.ratio}` : ''}}`).join('\n');
    return `<style>\n${rules}\n</style>`;
}

// ── Gallery (§3.2) ──

interface GalleryItem {
    src: string;
    kind: 'record' | 'document' | 'photo';
    caption: string;
    sub: string;
    year: number | null;
}

interface PdfItem {
    name: string;
    href: string | null;
    pages: number | null;
    year: number | null;
}

const YEAR_IN_TEXT = /\b(1[5-9]\d\d|20\d\d)\b/;
const DOCUMENT_WORDS = /scan|sken|list|dokument|document|urkunde|zeugnis|certific|osvědč|vysvědč|smlouv|contract|vertrag|passport|\bpas\b|dopis|letter|brief|register|matrik|zápis|record|akt/i;

function cap(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** The excerpt's event: a main event (with its record wording) or another event's label, its year and place. */
function excerptEvent(c: Ctx, sid: string): { event: PersonPageCaptionEvent | null; label: string; year: number | null; place: string } | null {
    const p = c.person;
    const bapt = p.events?.find(e => e.type === 'baptism');
    const bur = p.events?.find(e => e.type === 'burial');
    if (p.birthSourceIds?.includes(sid) || bapt?.sourceIds?.includes(sid)) {
        return {
            event: bapt?.sourceIds?.includes(sid) ? 'birthBaptism' : 'birth', label: '',
            year: yearOf(p.birthDate) ?? yearOf(bapt?.date), place: p.birthPlace?.trim() || bapt?.place?.trim() || '',
        };
    }
    if (p.deathSourceIds?.includes(sid) || bur?.sourceIds?.includes(sid)) {
        return {
            event: bur?.sourceIds?.includes(sid) ? 'deathBurial' : 'death', label: '',
            year: yearOf(p.deathDate) ?? yearOf(bur?.date), place: p.deathPlace?.trim() || bur?.place?.trim() || '',
        };
    }
    for (const uid of p.partnerships) {
        const u = c.tree.partnerships[uid];
        if (u?.sourceIds?.includes(sid)) return { event: 'marriage', label: '', year: yearOf(u.startDate), place: u.startPlace?.trim() ?? '' };
    }
    const ev = p.events?.find(e => e.sourceIds?.includes(sid));
    if (ev) return { event: null, label: lifeEventLabel(ev, c.S), year: yearOf(ev.date), place: ev.place?.trim() ?? '' };
    return null;
}

/** Every image of the person: the excerpts of the person's sources and the image attachments, by year (none last). */
function galleryItems(c: Ctx, rows: PersonSourceRow[]): GalleryItem[] {
    const { P } = c;
    const out: GalleryItem[] = [];
    if (c.page.groups.excerpts) {
        for (const row of rows) {
            const s = c.tree.sources?.[row.source.id];
            if (!s?.excerpts?.length) continue;
            const title = stripResearchIds(s.title || '').text.trim();
            const reg = registerKindOf(s.title);
            const ev = excerptEvent(c, s.id);
            const year = ev?.year ?? yearOf(s.recordDate);
            const where = [ev?.place ?? '', year !== null ? String(year) : ''].filter(Boolean).join(' ');
            const sub = [reg ? cap(P.gal.register(reg)) : peekTitle(title), where].filter(Boolean).join(', ');
            const main = ev?.event ? P.gal.recordOf(ev.event) : ev?.label ?? '';
            const kind: GalleryItem['kind'] = reg || ev?.event ? 'record' : 'document';
            for (const e of s.excerpts) {
                const src = shownExcerpt(e);
                if (!src) continue;
                const caption = main || stripResearchIds(e.caption?.trim() ?? '').text || peekTitle(title);
                out.push({ src, kind, caption, sub: sub === caption ? '' : sub, year });
            }
        }
    }
    for (const a of c.person.attachments ?? []) {
        if (isPdfAttachment(a) || isOriginalOnlyAttachment(a) || !a.mimeType.startsWith('image/')) continue;
        const src = safeImage(a.dataUrl);
        if (!src) continue;
        const caption = stripResearchIds(a.note?.trim() || a.name.replace(/\.[^.]+$/, '')).text.trim() || a.name;
        const m = YEAR_IN_TEXT.exec(`${a.note ?? ''} ${a.name}`);
        const year = m ? Number(m[1]) : null;
        const s = a.sourceId ? c.tree.sources?.[a.sourceId] : undefined;
        const sub = [s ? peekTitle(s.title) : '', year !== null && !caption.includes(String(year)) ? String(year) : ''].filter(Boolean).join(', ');
        out.push({ src, kind: a.sourceId || DOCUMENT_WORDS.test(`${a.name} ${a.note ?? ''}`) ? 'document' : 'photo', caption, sub, year });
    }
    return out
        .map((it, i) => ({ it, i }))
        .sort((x, y) => (x.it.year ?? Infinity) - (y.it.year ?? Infinity) || x.i - y.i)
        .map(x => x.it);
}

/** Pages of a PDF data URL (its page objects), null when it cannot be read. */
function pdfPages(dataUrl: string): number | null {
    const comma = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.length > 30_000_000) return null;
    try {
        const bin = atob(dataUrl.slice(comma + 1).replace(/\s+/g, ''));
        const n = (bin.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
        return n > 0 ? n : null;
    } catch {
        return null;
    }
}

function pdfItems(c: Ctx): PdfItem[] {
    if (!c.page.groups.pdf) return [];
    return (c.person.attachments ?? []).filter(isPdfAttachment).map(a => {
        const href = safePdf(a);
        const m = YEAR_IN_TEXT.exec(`${a.note ?? ''} ${a.name}`);
        const name = stripResearchIds(a.note?.trim() || a.name).text.trim() || a.name;
        return { name, href, pages: href ? pdfPages(href) : null, year: m ? Number(m[1]) : null };
    });
}

function galleryCaption(it: GalleryItem, P: PP): string {
    return `<span class="pp-gal-kind">${esc(P.gal.kind[it.kind])}</span>`
        + `<span class="pp-gal-cap">${esc(it.caption)}</span>`
        + (it.sub ? `<span class="pp-gal-sub">${esc(it.sub)}</span>` : '');
}

function galleryHtml(c: Ctx): string {
    const { P } = c;
    const items = c.gal;
    const pdfs = pdfItems(c);
    if (!items.length && !pdfs.length) return '';
    const thumb = (it: GalleryItem, i: number): string => {
        let pic: string;
        if (c.imgs) {
            pic = `<a class="pp-gal-thumb" href="#obr-${i + 1}" aria-label="${esc(`${P.zoom}: ${it.caption}`)}">${imgHtml(c, it.src, it.caption, 'pp-gal-img')}</a>`;
        } else if (c.app) {
            pic = `<button type="button" class="pp-gal-thumb" data-pp-zoom aria-label="${esc(`${P.zoom}: ${it.caption}`)}">`
                + `<img class="pp-gal-img" src="${esc(it.src)}" alt="${esc(it.caption)}" loading="lazy"></button>`;
        } else {
            pic = `<span class="pp-gal-thumb"><img class="pp-gal-img" src="${esc(it.src)}" alt="${esc(it.caption)}" loading="lazy"></span>`;
        }
        return `<figure class="pp-gal-item">${pic}<figcaption>${galleryCaption(it, P)}</figcaption></figure>`;
    };
    const first = c.opts.mode === 'print' ? items : items.slice(0, 6);
    const rest = c.opts.mode === 'print' ? [] : items.slice(6);
    let body = first.length ? `<div class="pp-gal">${first.map(thumb).join('')}</div>` : '';
    if (rest.length) {
        body += fold(c, {
            key: 'gal', id: 'pp-gal-more', cls: 'pp-gal-more',
            head: `<span class="pp-disc--inline">${foldState(`${P.gal.more(rest.length)} ▾`, `${P.gal.less} ▴`)}</span>`,
            body: `<div class="pp-gal">${rest.map((it, i) => thumb(it, i + 6)).join('')}</div>`,
        });
    }
    if (pdfs.length) {
        const row = (f: PdfItem): string => {
            let name: string;
            if (c.app && !c.page.readOnly) name = `<button type="button" class="pp-pdf-name pp-link" data-pp-action="materials">${esc(f.name)}</button>`;
            else if (!c.app && f.href) name = `<a class="pp-pdf-name" href="${esc(f.href)}" download="${esc(safeFileName(f.name.replace(/\.pdf$/i, ''), 'document'))}.pdf">${esc(f.name)}</a>`;
            else name = `<span class="pp-pdf-name">${esc(f.name)}</span>`;
            const meta = [P.gal.pdf(f.pages, f.year), !c.app && !f.href ? P.gal.pdfOff : ''].filter(Boolean).join(' · ');
            return `<li class="pp-pdf"><span class="pp-pdf-ic" aria-hidden="true">PDF</span>`
                + `<span class="pp-pdf-main">${name}<span class="pp-pdf-meta">${esc(meta)}</span></span></li>`;
        };
        body += `<ul class="pp-pdfs">${pdfs.map(row).join('')}</ul>`;
    }
    const open = c.app && !c.page.readOnly
        ? `<button type="button" class="pp-act pp-gal-open" data-pp-action="materials">${esc(P.materials.open)} ›</button>` : '';
    const head = `<div class="pp-sec-head"><h2>${esc(P.sec.materials)} <span class="pp-count">${items.length + pdfs.length}</span></h2>${open}</div>`;
    return section('materials', P.sec.materials, body, head);
}

/** The file's light boxes (§3.4): one per gallery image, shown by :target, with the counter and ‹ › anchors. */
function lightboxHtml(c: Ctx): string {
    if (!c.imgs) return '';
    const { P } = c;
    const m = c.gal.length;
    return c.gal.map((it, i) => {
        const n = i + 1;
        const prev = n > 1 ? `<a class="pp-lb-nav" href="#obr-${n - 1}" data-pp-lb="prev">${esc(P.gal.prev)}</a>` : '';
        const next = n < m ? `<a class="pp-lb-nav" href="#obr-${n + 1}" data-pp-lb="next">${esc(P.gal.next)}</a>` : '';
        return `<div class="pp-lb" id="obr-${n}" role="dialog" aria-label="${esc(it.caption)}">`
            + `<div class="pp-lb-top"><span class="pp-lb-count">${esc(P.gal.counter(n, m))}</span>`
            + `<a class="pp-lb-close" href="#pp-sec-materials" data-pp-lb="close">${esc(P.gal.closeZoom)}</a></div>`
            + imgHtml(c, it.src, it.caption, 'pp-lb-img')
            + `<div class="pp-lb-foot"><span class="pp-lb-cap">${esc([it.caption, it.sub].filter(Boolean).join(' · '))}</span>`
            + `<span class="pp-lb-navs">${prev}${next}</span></div></div>`;
    }).join('');
}

/** The file's light box of the portrait. */
function portraitLightbox(c: Ctx, photo: string | null): string {
    if (!c.imgs || !photo) return '';
    const name = nameOf(c, c.person.id);
    return `<div class="pp-lb" id="obr-p" role="dialog" aria-label="${esc(name)}">`
        + `<div class="pp-lb-top"><span class="pp-lb-count"></span><a class="pp-lb-close" href="#pp-sec-facts" data-pp-lb="close">${esc(c.P.gal.closeZoom)}</a></div>`
        + imgHtml(c, photo, name, 'pp-lb-img')
        + `<div class="pp-lb-foot"><span class="pp-lb-cap">${esc(name)}</span></div></div>`;
}

// ── In brief (§0.3) ──

function summaryHtml(c: Ctx): string {
    const { P, person, page, tree } = c;
    if (shielded(c, person.id)) return '';
    const g = genderKey(person);
    const living = page.living.has(person.id);
    const cells: [string, string][] = [];

    // 1. Age at death (living: age today, in the window only).
    if (!living) {
        const exact = ageAt(person.birthDate, person.deathDate);
        const b = yearOf(person.birthDate);
        const d = yearOf(person.deathDate);
        if (exact !== null) cells.push([P.summary.years(exact), P.summary.age]);
        else if (b !== null && d !== null && d >= b) cells.push([P.summary.aboutYears(d - b), P.summary.age]);
    } else if (c.app) {
        const today = isoDay(c.opts.now);
        const exact = ageBetween(person.birthDate, today);
        const bd = parseFlexDate(person.birthDate);
        if (bd && !bd.qualifier && !bd.end && bd.month !== undefined && exact) cells.push([P.summary.years(exact.years), P.summary.ageNow]);
        else if (bd) cells.push([P.summary.aboutYears(c.opts.now.getFullYear() - bd.year), P.summary.ageNow]);
    }

    // 2. Marriages.
    const fam = familyOf(tree, person);
    const unions = fam.unions.filter(u => {
        const other = u.person1Id === person.id ? u.person2Id : u.person1Id;
        return !!other && !!tree.persons[other] && !tree.persons[other].isPlaceholder;
    });
    const married = unions.filter(u => u.status !== 'partners' && u.status !== 'separated');
    const ageOfMarriage = (u: Partnership): number | null => {
        const a = ageAt(person.birthDate, u.startDate);
        if (a !== null) return a;
        const rec = parseInt(u.ages?.[person.id] ?? '', 10);
        return Number.isFinite(rec) ? rec : null;
    };
    const marriedAt = (list: Partnership[]) => {
        const ages = list.map(ageOfMarriage);
        return ages.every((a): a is number => a !== null) ? P.summary.marriedAt[g](ages as number[]) : '';
    };
    if (married.length >= 2) {
        cells.push([P.summary.marriages(married.length), marriedAt(married)]);
    } else if (married.length === 1) {
        const u = married[0];
        const other = tree.persons[(u.person1Id === person.id ? u.person2Id : u.person1Id) as PersonId];
        const deaths = [person.deathDate, other?.deathDate].filter((x): x is string => !!x)
            .sort((a, b) => (yearOf(a) ?? Infinity) - (yearOf(b) ?? Infinity));
        const end = u.endDate ?? deaths[0];
        const years = end ? ageAt(u.startDate, end) ?? (() => {
            const s = yearOf(u.startDate);
            const e = yearOf(end);
            return s !== null && e !== null && e >= s ? e - s : null;
        })() : null;
        if (years !== null && years > 0) cells.push([P.summary.marriageYears(years), marriedAt([u])]);
        else cells.push([P.summary.marriages(1), marriedAt([u])]);
    } else if (unions.length) {
        cells.push([P.summary.partnership, '']);
    }

    // 3. Children (who outlived the person only when it can be told for every child).
    const kids = fam.children;
    if (kids.length) {
        let label = '';
        const dy = yearOf(person.deathDate);
        if (!living && dy !== null) {
            const decided = kids.map(k => {
                if (page.living.has(k)) return true;
                const ky = yearOf(tree.persons[k]?.deathDate);
                if (ky === null || ky === dy) return null;
                return ky > dy;
            });
            if (decided.every(x => x !== null)) {
                const n = decided.filter(Boolean).length;
                if (n > 0) label = P.summary.survived[g](n);
            }
        }
        if (!label) {
            const withKids = unions.filter(u => kids.some(k => (u.childIds ?? []).includes(k))).length;
            if (withKids >= 2) label = P.summary.fromMarriages(withKids);
        }
        cells.push([P.summary.children(kids.length), label]);
    }

    // 4. The longest occupation with a period, else the places of a life (3 and more).
    let job: { years: number; label: string } | null = null;
    for (const e of person.events ?? []) {
        if (e.type !== 'occupation') continue;
        const d = parseFlexDate(e.date);
        const years = d?.end ? d.end.year - d.year : 0;
        if (years > 0 && (!job || years > job.years)) {
            const what = stripResearchIds(e.note?.trim() ?? '').text.trim();
            job = { years, label: [what, e.place?.trim() ?? ''].filter(Boolean).join(', ') };
        }
    }
    if (job) {
        cells.push([P.summary.years(job.years), job.label]);
    } else {
        const points = residencePoints(computePersonLifeline(tree, person.id, { childEvents: false }));
        const places = new Set(points.map(p => placeKey(p.place)).filter(Boolean));
        if (places.size >= 3) cells.push([P.summary.places(places.size), P.summary.lifelong]);
    }

    if (cells.length < 3) return '';
    return `<div class="pp-sum${cells.length === 3 ? ' pp-sum--3' : ''}" role="list" aria-label="${esc(P.summary.label)}">`
        + cells.map(([big, label]) => `<div class="pp-sum-cell" role="listitem"><span class="pp-sum-big">${esc(big)}</span>`
            + (label ? `<span class="pp-sum-lab">${esc(label)}</span>` : '') + `</div>`).join('')
        + `</div>`;
}

// ── Open question (§0.4) ──

function questionHtml(c: Ctx): string {
    const q = c.person.question?.trim();
    if (!q) return '';
    // In the file only for the deceased (Milan, 30 Oct): a question about a living person stays in the app.
    if (!c.app && c.page.living.has(c.person.id)) return '';
    return `<section class="pp-sec pp-sec--question" id="pp-sec-question"><div class="pp-question">`
        + `<h2 class="pp-kicker">${esc(c.P.question)}</h2><p class="pp-question-text">${esc(stripResearchIds(q).text)}</p></div></section>`;
}

// ── People around (§0.5) ──

const GODCHILDREN_SHOWN = 6;

function peopleAroundHtml(c: Ctx): string {
    const { P, person, tree, page } = c;
    const rows: { label: string; items: string[] }[] = [];
    let names = 0;
    // The role stands in the group's heading (round 2); a name carries only its note ("Václav Dvořák, sedlák").
    const item = (p: EventParticipant): string => {
        if (p.personId && shielded(c, p.personId)) return '';
        const linked = p.personId ? tree.persons[p.personId] : undefined;
        const name = linked ? shownNameOrEmpty(linked) : p.name?.trim() ?? '';
        if (!name) return '';
        names++;
        const note = p.note?.trim() ? stripResearchIds(p.note).text.trim() : '';
        return `<strong>${personLink(c, esc(name), linked?.id)}</strong>${note ? `, ${esc(note)}` : ''}`;
    };
    const group = (label: string, list: readonly EventParticipant[]): void => {
        const items = list.map(item).filter(Boolean);
        if (items.length) rows.push({ label, items });
    };
    const yearText = (date: string | undefined): string => {
        const y = yearOf(date);
        return y !== null ? String(y) : '';
    };
    const bapt = (person.events ?? []).find(e => e.type === 'baptism' && e.participants?.length);
    if (bapt) {
        const y = yearText(bapt.date);
        group(P.people.godparents(y), bapt.participants!.filter(p => p.role === 'godparent'));
        group(P.people.othersBaptism(y), bapt.participants!.filter(p => p.role !== 'godparent'));
    }
    for (const u of familyOf(tree, person).unions) {
        const y = yearText(u.startDate);
        group(P.people.witnesses(y), (u.participants ?? []).filter(p => p.role === 'witness'));
        group(P.people.others(y), (u.participants ?? []).filter(p => p.role !== 'witness'));
    }
    const god = page.godchildren.filter(gc => tree.persons[gc.id] && !shielded(c, gc.id));
    if (god.length) {
        const items = god.slice(0, GODCHILDREN_SHOWN).map(gc => {
            names++;
            return `<strong>${personLink(c, esc(nameOf(c, gc.id) || '?'), gc.id)}</strong>`
                + ` <span class="pp-people-note">(${esc(P.people.baptismOf(gc.year !== null ? String(gc.year) : ''))})</span>`;
        });
        if (god.length > GODCHILDREN_SHOWN) items.push(`<span class="pp-people-more">${esc(P.people.more(god.length - GODCHILDREN_SHOWN))}</span>`);
        rows.push({ label: P.people.godparentOf[genderKey(person)], items });
    }
    if (names < 2) return '';
    // Names in a row separated by " · " (the separator is text, so a copied or read line keeps it).
    const sep = '<span class="pp-people-sep" aria-hidden="true"> · </span>';
    return section('people', P.people.title, `<dl class="pp-people">${rows.map(r =>
        `<div class="pp-people-row"><dt>${esc(r.label)}</dt><dd><ul>${r.items.map((it, i) => `<li>${i ? sep : ''}${it}</li>`).join('')}</ul></dd></div>`).join('')}</dl>`);
}

// ── Sources ──

/** Source titles the folded Sources section names before "and N more", each cut to a short line. */
const SOURCES_PEEK = 3;
const SOURCES_PEEK_TITLE = 60;

function peekTitle(title: string): string {
    const t = stripResearchIds(title || '?').text.trim();
    if (t.length <= SOURCES_PEEK_TITLE) return t;
    const cut = clipText(t, SOURCES_PEEK_TITLE - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > SOURCES_PEEK_TITLE / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.(–-]+$/, '')}…`;
}

function sourcesHtml(c: Ctx, rows: PersonSourceRow[]): string {
    if (!c.page.groups.sources || !rows.length) return '';
    const { P } = c;
    const cards = rows.map(row => {
        const s = row.source;
        const title = stripResearchIds(s.title || '?').text;
        const sup = row.cites.length ? `${P.sources.supports}: ${row.cites.map(x => x.label).join(' · ')}` : '';
        const ref = [s.repository, s.reference].map(x => x?.trim()).filter(Boolean).join(' · ');
        const body: string[] = [];
        const main = c.mainEx.get(s.id);
        (s.excerpts ?? []).forEach((e, i) => {
            if (main && i === 0) return;
            const img = safeImage(e.dataUrl);
            if (img) body.push(figureHtml(c, shownExcerpt(e), e.caption?.trim() || title));
        });
        if (main) {
            body.push(`<p>${esc(P.excerptAbove('\u0000')).replace('\u0000', `<a href="#${main.anchor}">${esc(main.label)}</a>`)}</p>`);
        }
        if (s.transcript?.trim()) {
            body.push(`<div><p class="pp-kicker">${esc(P.sources.transcript)}</p><p class="pp-transcript">${esc(stripResearchIds(s.transcript).text)}</p></div>`);
        }
        const page = extLink(s.excerpts?.find(e => safeHttpUrl(e.pageUrl))?.pageUrl ?? s.url, P.sources.archivePage);
        if (page) body.push(`<p>${page}</p>`);
        if (c.app) body.push(`<button type="button" class="pp-act" data-pp-action="source" data-pp-source="${esc(s.id)}">${esc(P.sources.open)} ›</button>`);
        const head = `<span class="pp-src-lines"><span class="pp-src-title">${esc(title)}</span>`
            + (sup ? `<span class="pp-src-sup">${esc(sup)}</span>` : '')
            + (ref ? `<span class="pp-src-ref">${esc(ref)}</span>` : '') + `</span>`
            + foldState('▸', '▾');
        return `<li class="pp-src">${fold(c, { key: `s:${s.id}`, id: `pp-src-${asciiSlug(s.id) || 'x'}`, cls: 'pp-src-card', head, body: `<div class="pp-src-body">${body.join('')}</div>` })}</li>`;
    }).join('');
    // Folded: a few titles under the heading in plain text, the rest counted.
    const peekTitles = rows.slice(0, SOURCES_PEEK).map(r => peekTitle(r.source.title));
    if (rows.length > SOURCES_PEEK) peekTitles.push(P.sources.peekMore(rows.length - SOURCES_PEEK));
    const peek = `<span class="pp-peek">${esc(peekTitles.join(' · '))}</span>`;
    const head = `<span class="pp-sum-main"><span class="pp-h2-text">${esc(P.sec.sources)}</span> <span class="pp-count">${rows.length}</span></span>`
        + foldState(`${P.expand} ▸`, `${P.collapse} ▾`);
    const body = `<p class="pp-src-intro">${esc(P.sources.intro)}</p><ol class="pp-src-list">${cards}</ol>`;
    return `<section class="pp-sec pp-sec--sources" id="pp-sec-sources">`
        + fold(c, { key: 'sources', id: c.app ? 'pp-sources' : 'pp-sources-fold', cls: 'pp-sources', head, heading: true, after: peek, body })
        + `</section>`;
}

// ── For researchers ──

function researchHtml(c: Ctx, items: ResearchItems, rows: PersonSourceRow[]): string {
    if (!c.page.groups.research) return '';
    const { P } = c;
    const group = (title: string, list: string[], cls = '') =>
        list.length ? `<div class="pp-rgroup${cls}"><p class="pp-kicker">${esc(title)}</p><ul>${list.map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';
    const ids: string[] = [];
    if (c.page.groups.sources) {
        for (const r of rows) {
            if (r.source.refn) ids.push(`<code>${esc(r.source.refn)}</code><span>${esc(stripResearchIds(r.source.title).text)}</span>`);
        }
    }
    const known = new Set(rows.map(r => r.source.refn).filter(Boolean));
    for (const id of c.ids) if (!known.has(id)) ids.push(`<code>${esc(id)}</code>`);
    const certainty = [...(items.sourced ? [items.sourced] : []), ...items.certainty];
    const body = group(P.research.conflicts, items.conflicts) + group(P.research.tips, items.tips)
        + group(P.research.pending, items.pending) + group(P.research.hypotheses, items.hypotheses)
        + group(P.research.certainty, certainty)
        + group(P.research.ids, ids, ' pp-ids');
    if (!body) return '';
    const head = `<span class="pp-sum-main"><span class="pp-h2-text">${esc(P.sec.research)}</span></span>` + foldState(`${P.expand} ▸`, `${P.collapse} ▾`);
    const intro = `<span class="pp-research-intro">${esc(P.research.intro)}</span>`;
    return `<section class="pp-sec pp-sec--research" id="pp-sec-research">`
        + fold(c, { key: 'research', id: 'pp-research', cls: 'pp-research', head, heading: true, after: intro, body })
        + `</section>`;
}

// ── Whole body ──

function footerHtml(c: Ctx): string {
    const { P, page } = c;
    if (c.app) {
        if (!page.changedAt) return '';
        const d = formatFlexDate(page.changedAt.slice(0, 10), page.lang);
        return `<footer class="pp-foot">${esc(P.changed(d))}</footer>`;
    }
    return `<footer class="pp-foot">${esc(P.created(formatFlexDate(isoDay(c.opts.now), page.lang)))}</footer>`;
}

function makeCtx(page: PersonPageData, opts: PersonPageOptions): Ctx | null {
    const person = page.tree.persons[page.personId];
    if (!person) return null;
    const S = getStringsForLang(page.lang);
    return {
        page, opts, S, P: S.personPage, app: opts.mode === 'app', tree: page.tree, person,
        mainEx: new Map(), ids: new Set(),
        imgs: opts.mode === 'file' ? new Map() : null, gal: [], galIndex: new Map(),
        placeKeys: new Set(), anchors: new Set(), chart: null,
    };
}

/** Is the life chart's / places map's content protected (a file with a privacy other than full data)? */
function protects(page: PersonPageData): boolean {
    return page.privacy !== 'full';
}

/**
 * The places the Places section names (§1): the person's own places when
 * there are at least two, and with Children's places on and two own places on
 * the map, the relatives' places that have a position.
 */
function placesSectionKeys(page: PersonPageData, kidPlaces: boolean): Set<string> {
    const own = new Set(page.places.filter(p => !p.rel).map(p => p.placeKey));
    if (own.size <= 1) return new Set();
    const out = new Set(own);
    const onMap = [...own].filter(k => page.geo[k]).length;
    if (kidPlaces && onMap >= 2) {
        for (const p of page.places) if (p.rel && page.geo[p.placeKey]) out.add(p.placeKey);
    }
    return out;
}

/** The life chart's input for a page (null: not drawn). The window redraws the chart with it when its width changes. */
export function personPageChartInput(page: PersonPageData, now: Date): LifeChartInput | null {
    if (!page.tree.persons[page.personId]) return null;
    return lifeChartInput(page.tree, page.personId, {
        living: page.living, protect: protects(page), history: page.history,
        now: now.getFullYear() + now.getMonth() / 12,
    });
}

/**
 * The switches a saved file starts with: exactly the window's at the moment of
 * saving — History, Children's events and Children's places (what is visible
 * is what gets saved). The file's own switches can still turn them back on.
 */
export function personPageFileToggles(shown: { history: boolean; childEvents: boolean; kidPlaces?: boolean }): PersonPageOptions['toggles'] {
    return { history: shown.history, childEvents: shown.childEvents, kidPlaces: shown.kidPlaces !== false };
}

/** The page's body: `<article class="pp">…</article>`. */
export function buildPersonPageBody(page: PersonPageData, opts: PersonPageOptions): string {
    const c = makeCtx(page, opts);
    if (!c) return '<article class="pp"></article>';
    const rows = personSourceRows(page.tree, page.personId, c.S).filter(r => page.tree.sources?.[r.source.id]);
    const items = researchItems(page, page.lang, c);
    const differs = page.groups.research ? { birth: items.differsBirth, death: items.differsDeath } : null;
    const footer = footerHtml(c);
    const cls = ['pp', opts.toggles.history ? '' : 'pp-no-history', opts.toggles.childEvents ? '' : 'pp-no-kids'].filter(Boolean).join(' ');
    const open = `<article class="${cls}" data-pp-close="${esc(c.P.close)}">`;
    // A living person in a protected file (§0, 0f): the header ("E. F.", the birth year, a note) alone.
    if (shielded(c, c.person.id)) return `${open}${headerHtml(c, null)}${footer}</article>`;
    c.gal = galleryItems(c, rows);
    c.gal.forEach((it, i) => {
        const key = it.src.replace(/\s+/g, '');
        if (!c.galIndex.has(key)) c.galIndex.set(key, i + 1);
    });
    // The places map first: a place in the header or the timeline leads to it (§1.6).
    const kidPlaces = opts.toggles.kidPlaces !== false;
    const places = placesMapHtml(page.places, page.geo, {
        lang: page.lang, mode: c.app ? 'app' : 'file', kidPlaces,
        ...(c.app && opts.selectedPlace ? { selected: opts.selectedPlace } : {}),
        // The places manager keeps one position per name and no candidates: nothing to tell.
        ambiguous: new Set<string>(),
    });
    if (places) c.placeKeys = placesSectionKeys(page, kidPlaces);
    c.chart = personPageChartInput(page, opts.now);
    // Order of building: the timeline places the main excerpts the sources refer to,
    // the story collects the ids the researchers' section lists.
    const header = headerHtml(c, differs);
    const summary = summaryHtml(c);
    const family = familyTreeHtml(c);
    const story = storyHtml(c);
    const question = questionHtml(c);
    // Slot 6, the places of a life (placesMapHtml, §1), after the question; slot 7, the life chart, opens the timeline.
    const timeline = timelineHtml(c);
    const gallery = galleryHtml(c);
    const people = peopleAroundHtml(c);
    const notes = notesHtml(c);
    const sources = sourcesHtml(c, rows);
    const research = researchHtml(c, items, rows);
    const boxes = portraitLightbox(c, safeImage(c.person.photo)) + lightboxHtml(c);
    // Last: every image of the page is registered by now.
    const styles = imgStyles(c);
    const content = `${summary}${family}${story}${question}${places}${timeline}${gallery}${people}${notes}${sources}${research}`;
    // The file's contents on a phone and in a narrow window (§0.7): a fold under the header.
    const tocM = opts.toc && !c.app ? tocFoldHtml(personPageTocItems(content, page.lang), page.lang) : '';
    return `${open}${styles}${header}${tocM}${content}${footer}${boxes}</article>`;
}

/**
 * The entries of the contents "On this page" (the window and the file, §0.7):
 * the header's details, then the sections the page has; none under four
 * sections. Section names only, never a person's name.
 */
export function personPageTocItems(body: string, lang: Language): { id: string; label: string }[] {
    const sections = personPageSections(body, lang);
    if (sections.length < 4) return [];
    return [{ id: 'pp-sec-facts', label: getStringsForLang(lang).personPage.sec.facts }, ...sections];
}

/** The file's contents beside the page (≥ 900 px, §0.7): plain anchors, no script. */
function tocNavHtml(items: readonly { id: string; label: string }[], lang: Language): string {
    if (!items.length) return '';
    const P = getStringsForLang(lang).personPage;
    return `<nav class="pp-toc" aria-label="${esc(P.toc)}"><div class="pp-toc-h">${esc(P.toc)}</div><ol>`
        + items.map(s => `<li><a class="pp-toc-link" href="#${esc(s.id)}">${esc(s.label)}</a></li>`).join('')
        + '</ol></nav>';
}

/** The file's contents under the header (< 900 px, §0.7): a closed fold. */
function tocFoldHtml(items: readonly { id: string; label: string }[], lang: Language): string {
    if (!items.length) return '';
    const P = getStringsForLang(lang).personPage;
    return `<details class="pp-toc-m"><summary>${esc(P.toc)}<span class="pp-toc-m-arr" aria-hidden="true">▾</span></summary>`
        + `<nav aria-label="${esc(P.toc)}"><ol>`
        + items.map(s => `<li><a class="pp-toc-m-link" href="#${esc(s.id)}">${esc(s.label)}</a></li>`).join('')
        + '</ol></nav></details>';
}

/** The sections on the page, in order (the window's table of contents). */
export function personPageSections(body: string, lang: Language): PersonPageSection[] {
    const P = getStringsForLang(lang).personPage;
    // The open question is part of the story's reading, not an entry of its own.
    const keys = ['family', 'story', 'places', 'timeline', 'materials', 'people', 'notes', 'sources', 'research'] as const;
    return keys.filter(k => body.includes(`id="pp-sec-${k}"`))
        .map(k => ({ key: k, id: `pp-sec-${k}`, label: k === 'people' ? P.people.title : k === 'places' ? P.map.title : P.sec[k] }));
}

/**
 * The section the contents mark (K1, Milan 30. 10.): the last one whose top
 * has passed the reading line a quarter down the view; scrolled to the end,
 * the last section, however short (it may never reach the line). Tops are
 * offsets in the scrolled content, in page order.
 */
export function personPageTocCurrent(
    sections: readonly { id: string; top: number }[],
    view: { scrollTop: number; clientHeight: number; scrollHeight: number },
): string | null {
    if (sections.length === 0) return null;
    // A page that does not scroll is all in view: its top.
    if (view.scrollHeight - view.clientHeight <= 1) return sections[0].id;
    if (view.scrollTop >= view.scrollHeight - view.clientHeight - 2) return sections[sections.length - 1].id;
    const line = view.scrollTop + view.clientHeight * 0.25;
    let current = sections[0].id;
    for (const s of sections) if (s.top <= line) current = s.id;
    return current;
}

/** The document title: "Jan Fíšek (1860–1910)". */
function documentTitle(page: PersonPageData): string {
    const p = page.tree.persons[page.personId];
    if (!p) return getStringsForLang(page.lang).personPage.title;
    // "1798–1850", "* 1798" or "† 1850" (never an open "1798–").
    const years = yearsOf(p);
    const name = shownNameOrEmpty(p) || getStringsForLang(page.lang).personPage.title;
    return years ? `${name} (${years})` : name;
}

/** The file's frame around a body (separate, so a set of pages wraps its pages once, §8). */
export function personPageDocumentShell(lang: Language, title: string, body: string, fontCss = '', toc = ''): string {
    return `<!doctype html><html lang="${esc(lang)}" class="no-js"><head>`
        + `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<meta name="generator" content="Strom"><title>${esc(title)}</title>`
        + `<style>${personPageFileCss(fontCss)}</style>`
        + `</head><body><script>document.documentElement.className='js'</script>`
        + (toc ? `<div class="pp-file-layout">${toc}<main class="pp-file">${body}</main></div>` : `<main class="pp-file">${body}</main>`)
        + `<script>${PERSON_PAGE_SCRIPT}</script><script>${PERSON_PAGE_STORY_SCRIPT}</script>`
        + (body.includes('class="pp-sec pp-sec--places') ? `<script>${PLACES_MAP_SCRIPT}</script>` : '')
        + '</body></html>';
}

/** The whole saved file (§5.6). */
export function buildPersonPageDocument(page: PersonPageData, opts: PersonPageOptions): string {
    const body = buildPersonPageBody(page, { ...opts, mode: opts.mode === 'app' ? 'file' : opts.mode });
    const toc = opts.toc ? tocNavHtml(personPageTocItems(body, page.lang), page.lang) : '';
    return personPageDocumentShell(page.lang, documentTitle(page), body, opts.fontCss ?? '', toc);
}

/**
 * "jan-fisek-1860-1910.html" (no birth year: no numbers); a living person
 * under a privacy other than full: "stranka-osoby-e-f-1952.html".
 */
export function personPageFileName(page: PersonPageData): string {
    const P = getStringsForLang(page.lang).personPage;
    const prefix = asciiSlug(P.title) || 'person-page';
    const p = page.tree.persons[page.personId];
    if (!p) return `${prefix}.html`;
    const name = asciiSlug(shownName(p, '', false));
    const b = yearOf(p.birthDate);
    const d = yearOf(p.deathDate);
    if (page.privacy !== 'full' && page.living.has(p.id)) {
        return `${safeFileName([prefix, name, b !== null ? String(b) : ''].filter(Boolean).join('-'), prefix)}.html`;
    }
    const stem = b !== null ? [name, String(b), d !== null ? String(d) : ''].filter(Boolean).join('-') : name;
    return `${safeFileName(stem, prefix)}.html`;
}

/**
 * The saved file's size in bytes (UTF-8) and the images "Attach images"
 * adds: the excerpts and image attachments, each once (the portrait in the
 * header is not one of them), so the dialog's two numbers agree.
 */
export function estimatePersonPageSize(page: PersonPageData, opts: PersonPageOptions): { bytes: number; images: number } {
    const html = buildPersonPageDocument(page, opts);
    return { bytes: utf8Length(html), images: attachedImageCount(html) };
}

/** Distinct excerpt and attachment images of a page's HTML (file: one class per image; window: the src). */
function attachedImageCount(html: string): number {
    const seen = new Set<string>();
    for (const m of html.matchAll(/class="pp-img pp-(?:fig|gal)-img img-(\d+)"/g)) seen.add(`n${m[1]}`);
    for (const m of html.matchAll(/<img class="pp-(?:fig|gal)-img" src="([^"]*)"/g)) seen.add(`s${m[1]}`);
    return seen.size;
}

/** "2,4" (cs, de) / "2.4" (en): the saved file's size in MB, one decimal, 0.1 at least (§5.1). */
export function personPageSizeMb(bytes: number, lang: Language): string {
    const mb = Math.max(0.1, Math.round(Math.max(0, bytes) / 100_000) / 10);
    const text = mb.toFixed(1);
    return lang === 'en' ? text : text.replace('.', ',');
}

/**
 * The living people on the page (who the privacy choice is about), in page
 * order, each with the relation to the page's person: "Eva Fíšková (vnučka)".
 * The relation is found in `data` (the whole tree, so a grandchild named at
 * an event is still "vnučka"), else among the page's people; the person
 * itself, or someone no relation connects, is the name alone.
 */
export function personPageLivingNames(page: PersonPageData, data?: StromData): string[] {
    return [...page.living].map(id => page.tree.persons[id]).filter((p): p is Person => !!p).map(p => {
        const relation = p.id === page.personId ? null
            : (data?.persons[page.personId] && data.persons[p.id] ? findRelationship(data, page.personId, p.id) : null)
                ?? findRelationship(page.tree, page.personId, p.id);
        return relation ? `${shownName(p)} (${relation.term[page.lang]})` : shownName(p);
    });
}
