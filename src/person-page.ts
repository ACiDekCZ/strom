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

import { StromData, Person, PersonId, Partnership, Source, SourceExcerpt, LifeEvent, EventParticipant } from './types.js';
import { applyLivingPrivacy, stripResearchWork, isLivingPerson, inferBirthUpperBounds, PrivacyMode } from './privacy.js';
import { computePersonLifeline, LifelinePoint } from './timeline.js';
import {
    computePersonHistory, HistoryPayload, PersonHistoryEnv, LifelineHistoryItem, historySourceLabel, interleaveHistory,
} from './history.js';
import { getStringsForLang, Language, PersonPageCaptionEvent, PersonPageRegister } from './strings.js';
import { parseFlexDate, formatFlexDate, yearOf, ageBetween } from './dates.js';
import { nameHtml, shownName, shownNameOrEmpty } from './person-name.js';
import { asciiSlug, safeFileName } from './filenames.js';
import { isSafeExcerptDataUrl, safeHttpUrl, isOriginalOnlyAttachment } from './validation.js';
import { storyProseHtml } from './story-text.js';
import { excerptImageUrl } from './excerpts.js';
import { personSourceRows, lifeEventLabel, coupleEventLabelIn, PersonSourceRow } from './person-sources.js';
import { personInitials } from './initials.js';
import { PERSON_PAGE_SCRIPT, personPageFileCss } from './person-page-css.js';
import { findRelationship } from './kinship.js';

// ─── Interface (ZADANI §2.6) ────────────────────────────────────────────────

export type PersonPageMode = 'app' | 'file' | 'print';
/** 'app' → buttons into the app, 'plain' → text, 'set' → anchors between the pages of a set (§8). */
export type PersonPageLinks = 'app' | 'plain' | 'set';

export interface PersonPageGroups {
    history: boolean;
    childEvents: boolean;
    excerpts: boolean;
    materials: boolean;
    sources: boolean;
    research: boolean;
}

/** Every group on (the window; the export dialog's default). */
export const PERSON_PAGE_ALL_GROUPS: Readonly<PersonPageGroups> = Object.freeze({
    history: true, childEvents: true, excerpts: true, materials: true, sources: true, research: true,
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
    /** Initial state of the timeline switches (the page's default: both on). */
    toggles: { history: boolean; childEvents: boolean };
    /** Open folds: 'sources', 'research', 'sibs', 'basis', 's:<source id>'. */
    open?: ReadonlySet<string>;
    /** The tree is linked to Strom Research (history, materials, the researchers' section). */
    research: boolean;
    now: Date;
    /** The embedded @font-face rules of the file (the app supplies personPageFontCss()); none = fallback fonts. */
    fontCss?: string;
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
}

export interface PersonPageGroupCounts {
    history: number;
    childEvents: number;
    excerpts: number;
    materials: number;
    sources: number;
    research: number;
}

/** A section that is on the page (for the window's table of contents). */
export interface PersonPageSection {
    key: 'family' | 'story' | 'notes' | 'timeline' | 'materials' | 'sources' | 'research';
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
    const unions = person.partnerships.map(id => tree.partnerships[id]).filter((u): u is Partnership => !!u)
        .sort((a, b) => (yearOf(a.startDate) ?? Infinity) - (yearOf(b.startDate) ?? Infinity));
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
        materials: opts.groups.materials && opts.research,
        research: opts.groups.research && opts.research,
    };
    const src = full.persons[id];
    const tree: StromData = { persons: {}, partnerships: {}, sources: {} };
    if (!src) {
        return {
            personId: id, lang: opts.lang, privacy: opts.privacy, groups, research: opts.research, tree,
            living: new Set(), history: [], historyPending: false, waiting: [], storyDraft: false,
            readOnly: !!ctx.readOnly, counts: { history: 0, childEvents: 0, excerpts: 0, materials: 0, sources: 0, research: 0 },
        };
    }
    const person: Person = structuredClone(src);
    if (!groups.materials) delete person.attachments;
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
    for (const cid of fam.children) {
        tree.persons[cid] = relativeView(full.persons[cid], true);
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

    const living = new Set<PersonId>([...Object.keys(tree.persons)].filter(p => prot.living.has(p as PersonId)) as PersonId[]);
    const page: PersonPageData = {
        personId: id, lang: opts.lang, privacy: opts.privacy, groups, research: opts.research, tree, living,
        history, historyPending: groups.research && historyPending,
        waiting: groups.research ? [...(ctx.waiting ?? [])] : [],
        storyDraft: groups.research && prot.drafts.has(id) && !!person.story?.text?.trim(),
        ...(ctx.changedAt ? { changedAt: ctx.changedAt } : {}),
        readOnly: !!ctx.readOnly,
        counts: { history: 0, childEvents: 0, excerpts: 0, materials: 0, sources: 0, research: 0 },
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
        materials: (person?.attachments ?? []).filter(a => !!safeImage(a.dataUrl) && !isOriginalOnlyAttachment(a)).length,
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
    const st = person?.story;
    if (st?.text?.trim()) {
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

function placeLink(c: Ctx, place: string | undefined): string {
    const p = place?.trim();
    if (!p) return '';
    if (c.app && c.opts.links === 'app') return `<button type="button" class="pp-link" data-pp-place="${esc(p)}">${esc(p)}</button>`;
    return esc(p);
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
    const out: ResearchItems = { conflicts: [], tips: [], pending: [], hypotheses: [], count: 0, differsBirth: false, differsDeath: false };
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
    out.count = out.conflicts.length + out.tips.length + out.pending.length + out.hypotheses.length;
    return out;
}

// ── Header ──

function headerHtml(c: Ctx, differs: { birth: boolean; death: boolean } | null): string {
    const { P, person, page } = c;
    const g = genderKey(person);
    const photo = safeImage(person.photo);
    const avatar = photo
        ? `<img class="pp-photo" src="${esc(photo)}" alt="">`
        : `<div class="pp-initials" aria-hidden="true">${esc(personInitials(person.firstName, person.lastName))}</div>`;
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
    if (bapt && bapt.date !== person.birthDate) {
        facts.push([P.baptised[g], withPlace(personPageDate(bapt.date, page.lang), bapt.place)]);
    }
    const isLiving = page.living.has(person.id);
    if (person.deathDate || person.deathPlace) {
        const age = ageAt(person.birthDate, person.deathDate);
        facts.push([P.died[g], withPlace(personPageDate(person.deathDate, page.lang), person.deathPlace)
            + (age !== null ? ` · ${esc(P.aged(age))}` : '') + badge(!!differs?.death)]);
    } else if (isLiving) {
        const age = ageAt(person.birthDate, isoDay(c.opts.now)) ?? (() => {
            const b = parseFlexDate(person.birthDate);
            return b && !b.qualifier && !b.end ? ageBetween(person.birthDate, isoDay(c.opts.now))?.years ?? null : null;
        })();
        facts.push([P.alive, age !== null ? esc(P.living(age)) : '']);
    }
    const jobs = (person.events ?? []).filter(e => e.type === 'occupation').map(e => {
        // An occupation's name is its note (as the editor stores it).
        const what = stripResearchIds(e.note?.trim() ?? '').text;
        const d = parseFlexDate(e.date);
        const years = d ? (d.end && d.end.year !== d.year ? `${d.year}–${d.end.year}` : String(d.year)) : '';
        return [what, years ? `(${years})` : ''].filter(Boolean).join(' ');
    }).filter(Boolean);
    if (jobs.length) facts.push([P.occupation, esc(jobs.join(', '))]);

    const aka = (person.nameVariants ?? []).map(v => v.trim()).filter(Boolean);
    return `<header class="pp-hero" id="pp-sec-facts">${avatar}<div class="pp-hero-main">`
        + (c.app ? '' : `<p class="pp-eyebrow">${esc(P.eyebrow)}</p>`)
        + `<h1 class="pp-name">${nameHtml(person, { former: true })}</h1>`
        + (aka.length ? `<p class="pp-aka">${esc(P.alsoKnown)} ${esc(aka.join(', '))}</p>` : '')
        + (facts.length ? `<dl class="pp-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '')
        + `</div></header>`;
}

// ── Family ──

function cardHtml(c: Ctx, pid: PersonId, sub = ''): string {
    const p = c.tree.persons[pid];
    if (!p) return '';
    const years = yearsOf(p);
    // The marriage line belongs to the partner's card (inside it), so it is
    // plain text: a place button would nest a button inside the card's button.
    const inner = `<span class="pp-card-name">${esc(shownNameOrEmpty(p) || '?')}</span>`
        + (years ? `<span class="pp-card-years">${esc(years)}</span>` : '')
        + (sub ? `<span class="pp-card-sub">${sub}</span>` : '');
    if (linkable(c, pid)) {
        if (c.opts.links === 'set') return `<a class="pp-card pp-link-card" href="#${esc(slugOf(c, pid))}">${inner}</a>`;
        return `<button type="button" class="pp-card pp-link-card" data-pp-person="${esc(pid)}">${inner}</button>`;
    }
    return `<span class="pp-card pp-card--plain">${inner}</span>`;
}

function familyHtml(c: Ctx): string {
    const { P, tree, person, page } = c;
    const fam = familyOf(tree, person);
    const row = (label: string, cards: string) =>
        `<div class="pp-fam-row"><div class="pp-fam-label">${esc(label)}</div><div class="pp-fam-cards">${cards}</div></div>`;
    const rows: string[] = [];
    if (fam.parents.length) rows.push(row(P.parents, fam.parents.map(id => cardHtml(c, id)).join('')));
    for (const u of fam.unions) {
        const other = u.person1Id === person.id ? u.person2Id : u.person1Id;
        const partner = other ? tree.persons[other] : undefined;
        if (!partner || partner.isPlaceholder) continue;
        const unmarried = u.status === 'partners' || u.status === 'separated';
        const label = unmarried ? P.partner : partner.gender === 'male' ? P.husband : partner.gender === 'female' ? P.wife : P.partner;
        const subParts: string[] = [];
        if (!unmarried && (u.startDate || u.startPlace)) {
            subParts.push(esc(P.married(personPageDate(u.startDate, page.lang), '\u0000')).replace('\u0000', esc(u.startPlace?.trim() ?? '')).replace(/, $/, ''));
        }
        if (!unmarried && (u.endDate || u.status === 'divorced')) subParts.push(esc(P.divorced(personPageDate(u.endDate, page.lang))));
        rows.push(row(label, cardHtml(c, partner.id, subParts.join(' · '))));
    }
    if (fam.children.length) rows.push(row(P.children(fam.children.length), fam.children.map(id => cardHtml(c, id)).join('')));
    if (fam.siblings.length) {
        const sibs = fold(c, {
            key: 'sibs', id: 'pp-sibs', cls: 'pp-sibs',
            head: `<span class="pp-disc--inline">${foldState(`${P.show(fam.siblings.length)} ▸`, `${P.hide} ▾`)}</span>`,
            body: `<div class="pp-fam-cards">${fam.siblings.map(id => cardHtml(c, id)).join('')}</div>`,
        });
        rows.push(row(P.siblings, sibs));
    }
    if (!rows.length) return '';
    return section('family', P.sec.family, `<div class="pp-fam">${rows.join('')}</div>`);
}

function section(key: PersonPageSection['key'], title: string, body: string, head = ''): string {
    const h = head || `<h2>${esc(title)}</h2>`;
    return `<section class="pp-sec pp-sec--${key}" id="pp-sec-${key}">${h}${body}</section>`;
}

// ── Story, notes ──

function storyHtml(c: Ctx): string {
    const { P, person, page } = c;
    const st = person.story;
    if (!st || !st.text?.trim()) return '';
    const stripped = stripResearchIds(st.text);
    stripped.ids.forEach(id => c.ids.add(id));
    const text = stripped.text;
    const title = st.title?.trim() ? stripResearchIds(st.title).text : '';
    // A story not approved yet is shown too, marked as a draft (as the story reader does).
    const tag = st.status === 'draft' ? ` <span class="pp-draft-tag">${esc(c.S.story.statusDraft)}</span>` : '';
    const head = title
        ? `<p class="pp-kicker">${esc(P.sec.story)}${tag}</p><h2 class="pp-story-title">${esc(title)}</h2>`
        : `<h2 class="pp-kicker pp-story-kicker">${esc(P.sec.story)}${tag}</h2>`;
    const prose = `<div class="pp-prose">${storyProseHtml(text, { title: title || undefined, headingLevel: 3 })}</div>`;
    let basis = '';
    const facts = (st.facts ?? []).map(f => stripResearchIds(f)).filter(f => f.text.trim());
    const note = st.note?.trim() ? stripResearchIds(st.note).text : '';
    if (facts.length || note) {
        const showIds = page.groups.research;
        const items = facts.map(f => {
            f.ids.forEach(id => c.ids.add(id));
            return `<li>${esc(f.text.trim())}${showIds ? f.ids.map(id => `<span class="pp-id">${esc(id)}</span>`).join('') : ''}</li>`;
        }).join('');
        basis = fold(c, {
            key: 'basis', id: 'pp-basis', cls: 'pp-basis',
            head: `<span class="pp-disc--inline">${esc(P.storyBasis)} ${foldState('▸', '▾')}</span>`,
            body: `<div class="pp-basis-body">${items ? `<ul>${items}</ul>` : ''}`
                + (note ? `<p class="pp-basis-note">${esc(P.authorNote)}: ${esc(note)}</p>` : '') + `</div>`,
        });
    }
    return section('story', P.sec.story, prose + basis, head);
}

function notesHtml(c: Ctx): string {
    const notes = c.person.notes?.trim();
    if (!notes) return '';
    const stripped = stripResearchIds(notes);
    stripped.ids.forEach(id => c.ids.add(id));
    return section('notes', c.P.sec.notes, `<p class="pp-notes-text">${esc(stripped.text)}</p>`);
}

// ── Timeline ──

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
    const zoom = `<button type="button" class="pp-zoom${c.app ? '' : ' js-only'}" data-pp-zoom aria-label="${esc(c.P.zoom)}">⤢</button>`;
    return `<figure class="pp-fig"${id ? ` id="${id}"` : ''}><img src="${esc(src)}" alt="${esc(caption)}" loading="lazy">${zoom}`
        + `<figcaption>${esc(caption)}</figcaption></figure>`;
}

function histRowHtml(c: Ctx, item: LifelineHistoryItem): string {
    const { S } = c;
    const ev = item.ev;
    const scope = ev.scope === 'local' ? 'local' : ev.scope === 'place' ? 'place' : 'region';
    const mark = scope === 'local' ? '■' : scope === 'place' ? '▲' : '◇';
    const meta: string[] = [];
    meta.push(`<span class="pp-hist-kind">${esc(S.history.kinds[ev.kind] ?? ev.kind)}</span>`);
    if (item.age) meta.push(esc(item.age));
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
    return `<div class="pp-row pp-row--hist"><span class="pp-y">${esc(item.yearLabel ?? String(item.year))}</span>`
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
        return `<div class="pp-row ${cls}"><span class="pp-y">${esc(pt.yearLabel ?? String(pt.year))}</span>`
            + `<span class="pp-m"><span class="pp-mk" aria-hidden="true">${markOf(pt)}</span></span>`
            + `<div class="pp-t">${rowText(c, pt, r.merged)}${detailsLine(c, pt, r.merged)}${fig}</div></div>`;
    };
    const segHtml = segs.map(s => {
        const has = new Set(s.rows.map(r => r.kind));
        const cls = ['pp-seg', ...[...has].map(k => `pp-seg--${k}`)].join(' ');
        const title = s.titled
            ? `<div class="pp-seg-title">${esc(P.seg[s.key])}<span class="pp-seg-years">${s.from === s.to ? s.from : `${s.from}–${s.to}`}</span></div>`
            : '';
        return `<div class="${cls}">${title}${s.rows.map(rowHtml).join('')}</div>`;
    }).join('');
    const hasHist = segs.some(s => s.rows.some(r => r.kind === 'hist'));
    const hasKid = segs.some(s => s.rows.some(r => r.kind === 'kid'));
    const sw = (key: 'history' | 'childEvents', label: string) =>
        `<button type="button" class="pp-toggle${c.app ? '' : ' js-only'}" role="switch" aria-checked="${c.opts.toggles[key]}" data-pp-switch="${key}">${esc(label)}</button>`;
    const toggles = [hasHist ? sw('history', P.toggle.history) : '', hasKid ? sw('childEvents', P.toggle.childEvents) : ''].join('');
    const head = `<div class="pp-sec-head"><h2>${esc(P.sec.timeline)}</h2>${toggles ? `<div class="pp-toggles">${toggles}</div>` : ''}</div>`;
    const legend = hasHist
        ? `<p class="pp-legend"><span><span class="pp-hm pp-hm--region" aria-hidden="true">◇</span>${esc(P.legend.region)}</span>`
            + `<span><span class="pp-hm pp-hm--place" aria-hidden="true">▲</span>${esc(P.legend.place)}</span>`
            + `<span><span class="pp-hm pp-hm--local" aria-hidden="true">■</span>${esc(P.legend.local)}</span></p>`
        : '';
    return section('timeline', P.sec.timeline, legend + segHtml, head);
}

// ── Materials ──

function materialsHtml(c: Ctx): string {
    if (!c.page.groups.materials) return '';
    const { P } = c;
    const atts = c.person.attachments ?? [];
    const images: string[] = [];
    const files: string[] = [];
    for (const a of atts) {
        const img = !isOriginalOnlyAttachment(a) && a.mimeType.startsWith('image/') ? safeImage(a.dataUrl) : null;
        const caption = stripResearchIds(a.note?.trim() || a.name).text;
        if (img) {
            images.push(`<figure class="pp-mat"><img src="${esc(img)}" alt="${esc(caption)}" loading="lazy"><figcaption>${esc(caption)}</figcaption></figure>`);
        } else {
            const ext = a.mimeType === 'application/pdf' ? 'PDF' : (a.name.split('.').pop() ?? '').toUpperCase().slice(0, 5);
            files.push(`<li><span class="pp-mat-kind">${esc(ext || '·')}</span> · ${esc(a.name)} · <span class="pp-mat-hint">${esc(c.app ? P.materials.pdfApp : P.materials.pdfFile)}</span></li>`);
        }
    }
    if (!images.length && !files.length) return '';
    const open = c.app && !c.page.readOnly
        ? `<button type="button" class="pp-act" data-pp-action="materials">${esc(P.materials.open)} ›</button>` : '';
    return section('materials', P.sec.materials,
        (images.length ? `<div class="pp-mat-grid">${images.join('')}</div>` : '')
        + (files.length ? `<ul class="pp-mat-files">${files.join('')}</ul>` : '') + open);
}

// ── Sources ──

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
    const peek = rows.map(r => stripResearchIds(r.source.title || '?').text).join(' · ');
    const head = `<span class="pp-sum-main"><span class="pp-h2-text">${esc(P.sec.sources)}</span> <span class="pp-count">${rows.length}</span></span>`
        + foldState(`${P.expand} ▸`, `${P.collapse} ▾`)
        + `<span class="pp-peek">${esc(peek)}</span>`;
    const body = `<p class="pp-src-intro">${esc(P.sources.intro)}</p><ol class="pp-src-list">${cards}</ol>`;
    return `<section class="pp-sec pp-sec--sources" id="pp-sec-sources">`
        + fold(c, { key: 'sources', id: c.app ? 'pp-sources' : 'pp-sources-fold', cls: 'pp-sources', head, heading: true, body })
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
    const body = group(P.research.conflicts, items.conflicts) + group(P.research.tips, items.tips)
        + group(P.research.pending, items.pending) + group(P.research.hypotheses, items.hypotheses)
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
    };
}

/** The page's body: `<article class="pp">…</article>`. */
export function buildPersonPageBody(page: PersonPageData, opts: PersonPageOptions): string {
    const c = makeCtx(page, opts);
    if (!c) return '<article class="pp"></article>';
    const rows = personSourceRows(page.tree, page.personId, c.S).filter(r => page.tree.sources?.[r.source.id]);
    const items = researchItems(page, page.lang, c);
    const differs = page.groups.research ? { birth: items.differsBirth, death: items.differsDeath } : null;
    // Order of building: the timeline places the main excerpts the sources refer to,
    // the story collects the ids the researchers' section lists.
    const header = headerHtml(c, differs);
    const family = familyHtml(c);
    const story = storyHtml(c);
    const notes = notesHtml(c);
    const timeline = timelineHtml(c);
    const materials = materialsHtml(c);
    const sources = sourcesHtml(c, rows);
    const research = researchHtml(c, items, rows);
    const cls = ['pp', opts.toggles.history ? '' : 'pp-no-history', opts.toggles.childEvents ? '' : 'pp-no-kids'].filter(Boolean).join(' ');
    return `<article class="${cls}" data-pp-close="${esc(c.P.close)}">${header}${family}${story}${notes}${timeline}${materials}${sources}${research}${footerHtml(c)}</article>`;
}

/** The sections on the page, in order (the window's table of contents). */
export function personPageSections(body: string, lang: Language): PersonPageSection[] {
    const P = getStringsForLang(lang).personPage;
    const keys: PersonPageSection['key'][] = ['family', 'story', 'notes', 'timeline', 'materials', 'sources', 'research'];
    return keys.filter(k => body.includes(`id="pp-sec-${k}"`)).map(k => ({ key: k, id: `pp-sec-${k}`, label: P.sec[k] }));
}

/** The document title: "Jan Fíšek (1860–1910)". */
function documentTitle(page: PersonPageData): string {
    const p = page.tree.persons[page.personId];
    if (!p) return getStringsForLang(page.lang).personPage.title;
    const b = yearOf(p.birthDate);
    const d = yearOf(p.deathDate);
    const years = b !== null || d !== null ? `${b ?? ''}–${d ?? ''}` : '';
    const name = shownNameOrEmpty(p) || getStringsForLang(page.lang).personPage.title;
    return years ? `${name} (${years})` : name;
}

/** The file's frame around a body (separate, so a set of pages wraps its pages once, §8). */
export function personPageDocumentShell(lang: Language, title: string, body: string, fontCss = ''): string {
    return `<!doctype html><html lang="${esc(lang)}" class="no-js"><head>`
        + `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<meta name="generator" content="Strom"><title>${esc(title)}</title>`
        + `<style>${personPageFileCss(fontCss)}</style>`
        + `</head><body><script>document.documentElement.className='js'</script>`
        + `<main class="pp-file">${body}</main>`
        + `<script>${PERSON_PAGE_SCRIPT}</script></body></html>`;
}

/** The whole saved file (§5.6). */
export function buildPersonPageDocument(page: PersonPageData, opts: PersonPageOptions): string {
    const body = buildPersonPageBody(page, { ...opts, mode: opts.mode === 'app' ? 'file' : opts.mode });
    return personPageDocumentShell(page.lang, documentTitle(page), body, opts.fontCss ?? '');
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

/** The saved file's size in bytes (UTF-8) and the images it embeds. */
export function estimatePersonPageSize(page: PersonPageData, opts: PersonPageOptions): { bytes: number; images: number } {
    const html = buildPersonPageDocument(page, opts);
    const images = (html.match(/<img\s/g) ?? []).length;
    return { bytes: utf8Length(html), images };
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
