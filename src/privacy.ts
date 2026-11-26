/**
 * Living-person privacy filter for exports.
 *
 * When a tree leaves the family (shared/embedded/GEDCOM export), details of
 * people who are probably still alive can be hidden. The filter always returns
 * a DEEP COPY and never mutates the original; the tree STRUCTURE (ids,
 * relationships, partnerships, gender) is always preserved so the exported tree
 * still renders.
 */

import { rewriteStorySources, storySourceIds } from './story-sources.js';
import { StromData, Person, PersonId, Partnership, SourceExcerpt } from './types.js';
import { strings } from './strings.js';
import { yearOf } from './dates.js';
import { collectHouses } from './houses.js';
import { houseKey } from './places.js';
import { forgetHiddenImports } from './import-origin.js';
import { tidyShares } from './shared-events.js';
import { stripPhotos, dropDanglingPortraitSources } from './photo.js';
import { allMedia, dropMediaPlaces, mediaSourceIds, placePartnershipId, placePersonId, pruneMedia } from './media.js';
import { stripAttachments, stripExcerpts } from './attachments.js';

export type PrivacyMode = 'full' | 'initials' | 'anonymous' | 'minimal';

// ==================== GRANULAR EXPORT CONTENT ====================

/**
 * Which content categories an export carries. Independent of the living-privacy
 * filter above: privacy obscures WHO, content options decide WHAT extras (heavy
 * media, free-text notes, the source apparatus) travel with the file. All true
 * is the full archive.
 */
export interface ContentOptions {
    photos: boolean;
    attachments: boolean;
    notes: boolean;
    sources: boolean;
    /**
     * Source images, when the export offers them apart from attachments (a
     * tree with images from its research): none, those in the app (the
     * file's excerpts and the ones loaded from the research), or all — the
     * rest loaded before the export. Missing: excerpts go with attachments.
     */
    sourceImages?: SourceImagesChoice;
    /** Excerpts loaded from the research, by source id: written as the sources' own (with `sourceImages` app / all). */
    researchExcerpts?: Record<string, SourceExcerpt[]>;
}

export type SourceImagesChoice = 'none' | 'app' | 'all';

/** Everything included — the default (Complete archive) and the "all on" preset. */
export const ALL_CONTENT: ContentOptions = { photos: true, attachments: true, notes: true, sources: true };

/** Named export-content presets offered in the dialog. */
export type ContentPreset = 'complete' | 'small' | 'skeleton';

/**
 * Checkbox patterns behind the three presets:
 * - complete: the full archive (everything),
 * - small: no heavy media (photos + attachments), text kept — a file to email,
 * - skeleton: structure and names only (all four off).
 */
export const CONTENT_PRESETS: Record<ContentPreset | 'back', ContentOptions> = {
    complete: { photos: true, attachments: true, notes: true, sources: true, sourceImages: 'app' },
    small: { photos: false, attachments: false, notes: true, sources: true, sourceImages: 'none' },
    skeleton: { photos: false, attachments: false, notes: false, sources: false, sourceImages: 'none' },
    /**
     * GEDCOM "Back to {prog}" (spec 066 §4): the text of the tree with every
     * source and citation, no media — other programs do not read embedded
     * data URLs. Not a choice of the Content section (no button of its own).
     */
    back: { photos: false, attachments: false, notes: true, sources: true, sourceImages: 'none' },
};

/** The presets offered as buttons in the Content section, in their order. */
const DIALOG_PRESETS: readonly ContentPreset[] = ['complete', 'small', 'skeleton'];

/** The preset whose pattern equals `opts`, or null when the state is custom. */
export function matchContentPreset(opts: ContentOptions): ContentPreset | null {
    for (const name of DIALOG_PRESETS) {
        const p = CONTENT_PRESETS[name];
        // Source images: "complete" takes those in the app or all of them.
        const images = opts.sourceImages === undefined || opts.sourceImages === p.sourceImages
            || (name === 'complete' && opts.sourceImages === 'all');
        if (p.photos === opts.photos && p.attachments === opts.attachments
            && p.notes === opts.notes && p.sources === opts.sources && images) return name;
    }
    return null;
}

/**
 * Deep copy with every free-text note removed: person notes, partnership notes,
 * life-event notes, event-participant notes and the narratives (which are the
 * longest free text in the tree). Identity, structure and all other fields are
 * preserved. Does not mutate the input.
 */
export function stripNotes(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const person of Object.values(copy.persons)) {
        delete person.notes;
        delete person.story;
        // What the research knows is free text too (hypotheses, searches).
        delete person.research;
        for (const ev of person.events ?? []) {
            delete ev.note;
            for (const part of ev.participants ?? []) delete part.note;
        }
    }
    for (const partnership of Object.values(copy.partnerships)) {
        delete partnership.note;
        delete partnership.story;
        for (const ev of partnership.events ?? []) {
            delete ev.note;
            for (const part of ev.participants ?? []) delete part.note;
        }
    }
    return copy;
}

/**
 * Deep copy with the whole source/citation apparatus removed: the sources
 * catalog and every reference into it — person/event/partnership sourceIds and
 * attachment.sourceId links — so nothing is left pointing at a source that is no
 * longer present. Does not mutate the input.
 */
export function stripSources(data: StromData): StromData {
    const copy = structuredClone(data);
    delete copy.sources;
    // A file that was a source's document stays where else it is (a person's attachment).
    dropMediaPlaces(copy, place => 'sourceId' in place);
    for (const person of Object.values(copy.persons)) {
        delete person.sourceIds;
        delete person.birthSourceIds;
        delete person.deathSourceIds;
        // The research's conflicts and searches are part of the source apparatus.
        delete person.research;
        for (const ev of person.events ?? []) delete ev.sourceIds;
        rewriteStorySources(person.story, () => []);
    }
    for (const partnership of Object.values(copy.partnerships)) {
        delete partnership.sourceIds;
        delete partnership.divorceSourceIds;
        for (const ev of partnership.events ?? []) delete ev.sourceIds;
        rewriteStorySources(partnership.story, () => []);
    }
    return copy;
}

/** Scopes that are a fact about the person, not the research's plan. */
const FACT_SCOPES: readonly string[] = ['living', 'off-tree'];

/**
 * Every copy that leaves the app keeps what the records say about the edge
 * of the tree (what is missing and why, the window searched, the books, the
 * estimate, the hypotheses and the family outside the tree) and drops how
 * the research works on it: what comes next, the queue, tasks, searches,
 * sessions and their cost, the direction, a story's waiting new version,
 * the lines and side branches and who stands where in them, the waits.
 * That is the research's own state, stale in any copy and meaningless to
 * anyone else; the research tree gets it back with its next load. Mutates and returns `data` (a fresh copy).
 */
export function stripResearchWork(data: StromData): StromData {
    // A new version of a story waiting for the user is the research's
    // workshop too: the copy carries the approved story only.
    for (const partnership of Object.values(data.partnerships)) delete partnership.story?.draft;
    for (const person of Object.values(data.persons)) {
        delete person.story?.draft;
        const r = person.research;
        if (!r) continue;
        if (r.edge) {
            const e = r.edge;
            r.edge = {
                missing: e.missing,
                ...(e.scope && FACT_SCOPES.includes(e.scope) ? { scope: e.scope } : {}),
                ...(e.end ? { end: e.end } : {}),
                ...(e.records !== undefined ? { records: e.records } : {}),
                ...(e.est ? { est: e.est } : {}),
                ...(e.window ? { window: e.window } : {}),
                books: e.books,
                covered: e.covered,
                noRecords: e.noRecords,
                tasks: [],
                tried: [],
                conflicts: e.conflicts,
                hypos: e.hypos.map(h => ({ id: h.id, ...(h.join ? { join: h.join } : {}), ...(h.island !== undefined ? { island: h.island } : {}), tests: [], ...(h.variants ? { variants: h.variants } : {}),
                    ...(h.joins ? { joins: h.joins.map(j => ({ person: j.person, ...(j.variants ? { variants: j.variants } : {}), ...(j.island !== undefined ? { island: j.island } : {}) })) } : {}) })),
            };
        }
        if (r.island) r.island = { size: r.island.size, hypos: r.island.hypos };
        // Where the person stands in the lines, what is waited for and when the research added them: its workshop.
        delete r.places;
        delete r.waits;
        delete r.added;
    }
    delete data.researchDirections;
    return data;
}

/**
 * Normalise the legacy boolean "drop media" flag into full ContentOptions:
 * `false` keeps everything, `true` drops photos + attachments (the old
 * stripMedia behaviour) while keeping notes and sources.
 */
export function resolveContentOptions(content: boolean | ContentOptions): ContentOptions {
    if (typeof content === 'boolean') {
        return content ? { photos: false, attachments: false, notes: true, sources: true } : ALL_CONTENT;
    }
    return content;
}

/**
 * Deep copy of `data` keeping only the selected content categories. A thin
 * composition of the pure strip functions; the leading clone guarantees a fresh
 * object even when nothing is stripped. Does not mutate the input.
 */
export function applyContentOptions(data: StromData, content: boolean | ContentOptions): StromData {
    const opts = resolveContentOptions(content);
    let out = stripResearchWork(structuredClone(data));
    if (!opts.photos) out = stripPhotos(out);
    if (opts.sourceImages !== undefined) {
        // Attachments and source images are chosen apart.
        if (!opts.attachments) delete out.media;
        if (opts.sourceImages === 'none') out = stripExcerpts(out);
        else if (opts.researchExcerpts) {
            for (const [id, extra] of Object.entries(opts.researchExcerpts)) {
                const src = out.sources?.[id];
                if (!src || extra.length === 0) continue;
                const have = new Set((src.excerpts ?? []).map(e => e.clip).filter(Boolean));
                const add = extra.filter(e => !e.clip || !have.has(e.clip));
                if (add.length) src.excerpts = [...(src.excerpts ?? []), ...structuredClone(add)];
            }
        }
    } else if (!opts.attachments) out = stripAttachments(out);
    if (!opts.notes) out = stripNotes(out);
    if (!opts.sources) out = stripSources(out);
    // The merge history keeps the values a merge changed (notes, sources among them): not without them.
    if (!opts.notes || !opts.sources) delete out.merges;
    // A fact left out takes its stored import value with it.
    for (const person of Object.values(out.persons)) forgetHiddenImports(person, false);
    for (const ps of Object.values(out.partnerships)) forgetHiddenImports(ps, false);
    // A portrait whose original was left out keeps no link to it (spec 107).
    dropDanglingPortraitSources(out);
    return out;
}

/** Ages beyond this (with no death date) are assumed deceased. */
const ASSUMED_MAX_AGE = 110;
/** A parent is at least this much older than any of their children. */
const MIN_PARENT_AGE = 12;
/** Nobody marries younger than this (historically conservative). */
const MIN_MARRIAGE_AGE = 14;

/**
 * Whether a person should be treated as living. A death date (or isDeceased:
 * true) means deceased; isDeceased: false forces living. Otherwise: living if
 * the latest possible birth year is within ASSUMED_MAX_AGE. `bounds` (see
 * inferBirthUpperBounds) lets people WITHOUT any dates of their own be
 * recognised as certainly deceased from indirect evidence; without it, only
 * the person's own birth year is used and unknowns stay living (safe default).
 */
export function isLivingPerson(
    person: Person,
    currentYear: number = new Date().getFullYear(),
    bounds?: Map<string, number>
): boolean {
    if (person.isDeceased === true) return false;
    if (person.isDeceased === false) return true;
    if (person.deathDate) return false;
    const birthYear = bounds?.get(person.id) ?? yearOf(person.birthDate);
    if (birthYear === null || birthYear === undefined) return true;
    return currentYear - birthYear < ASSUMED_MAX_AGE;
}

/**
 * Infer, for every person, the LATEST year they can have been born — from
 * their own dates and events, their weddings, and (propagated up through the
 * generations) their descendants' bounds: a parent is at least MIN_PARENT_AGE
 * older than any child. Only certain inferences, so the privacy filter can
 * stop treating clearly-historical people (no recorded dates of their own,
 * but a child born in 1880) as "maybe living".
 */
export function inferBirthUpperBounds(data: StromData): Map<string, number> {
    const bounds = new Map<string, number>();
    const tighten = (id: string, year: number | null): boolean => {
        if (year === null) return false;
        const cur = bounds.get(id);
        if (cur === undefined || year < cur) { bounds.set(id, year); return true; }
        return false;
    };

    for (const p of Object.values(data.persons)) {
        tighten(p.id, yearOf(p.birthDate));
        tighten(p.id, yearOf(p.deathDate));               // born no later than died
        for (const ev of p.events ?? []) tighten(p.id, yearOf(ev.date));
    }
    for (const u of Object.values(data.partnerships)) {
        // The banns, a census of the household: dated like the wedding.
        for (const date of [u.startDate, ...(u.events ?? []).map(e => e.date)]) {
            const wy = yearOf(date);
            if (wy === null) continue;
            tighten(u.person1Id, wy - MIN_MARRIAGE_AGE);
            tighten(u.person2Id, wy - MIN_MARRIAGE_AGE);
        }
    }

    // Fixpoint child → parent. The iteration cap guards against parent cycles
    // in broken data (a DAG needs at most its depth in passes).
    const persons = Object.values(data.persons);
    let changed = true;
    for (let i = 0; i < persons.length && changed; i++) {
        changed = false;
        for (const p of persons) {
            const b = bounds.get(p.id);
            if (b === undefined) continue;
            for (const parentId of p.parentIds) {
                if (tighten(parentId, b - MIN_PARENT_AGE)) changed = true;
            }
        }
    }
    return bounds;
}

// ==================== HOUSES IN OUTPUTS (spec 030 §10, K1.4a) ====================

/**
 * People of the last ~100 years (spec 030 K1.4a): a house is today the
 * address of another family, so outputs give such people their name and
 * role only, and a house where they lived keeps its location and its name
 * after the farm to itself.
 */
export const RECENT_YEARS = 100;

/** The first year of "the last ~100 years" by today's year. */
export function recentFrom(currentYear: number): number {
    return currentYear - RECENT_YEARS;
}

/** The latest year a person's own records name: birth, death, their events, their couples' dates (null: none). */
export function personLatestYear(data: Pick<StromData, 'partnerships'>, person: Person): number | null {
    let latest: number | null = null;
    const see = (date: string | undefined): void => {
        const y = yearOf(date);
        if (y !== null && (latest === null || y > latest)) latest = y;
    };
    see(person.birthDate);
    see(person.deathDate);
    for (const ev of person.events ?? []) see(ev.date);
    for (const uid of person.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        see(u.startDate);
        see(u.endDate);
        for (const ev of u.events ?? []) see(ev.date);
    }
    return latest;
}

/**
 * A person of the last ~100 years: living (as the outputs judge it), or a
 * record of their own in those years. `bounds` from inferBirthUpperBounds.
 */
export function isRecentPerson(data: Pick<StromData, 'partnerships'>, person: Person, currentYear: number, bounds?: Map<string, number>): boolean {
    if (person.isPlaceholder) return false;
    if (isLivingPerson(person, currentYear, bounds)) return true;
    const latest = personLatestYear(data, person);
    return latest !== null && latest >= recentFrom(currentYear);
}

/**
 * What was said about houses as an output under a privacy mode carries it:
 * a house where people of the last ~100 years have a record (or a record of
 * the house falls in those years) loses its location and its name after the
 * farm; what joins houses and tells them apart stays. Works on `copy`, judged
 * on `data` (the tree before protection).
 */
function protectHouses(copy: StromData, data: StromData, currentYear: number, bounds: Map<string, number>): void {
    if (!copy.houses) return;
    const from = recentFrom(currentYear);
    const recent = new Map<PersonId, boolean>();
    const isRecent = (id: PersonId): boolean => {
        let r = recent.get(id);
        if (r === undefined) {
            const p = data.persons[id];
            r = !!p && isRecentPerson(data, p, currentYear, bounds);
            recent.set(id, r);
        }
        return r;
    };
    const protectedIds = new Set<string>();
    for (const h of collectHouses(data)) {
        if (h.facts.some(f => (f.year !== undefined && f.year >= from) || isRecent(f.personId))) {
            protectedIds.add(h.id);
            // A house joined into it is the same house: its own entry goes the same way.
            for (const n of h.numbers) protectedIds.add(`${h.townKey}|${houseKey(n.house)}`);
        }
    }
    // A house joined to a protected one (`merged`, either side, never across a
    // `split`) is the same house even without a fact of its own in the tree:
    // the whole joined group goes the same way.
    const user = data.houses ?? {};
    const apart = (a: string, b: string): boolean => !!user[a]?.split?.includes(b) || !!user[b]?.split?.includes(a);
    const links = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
        if (a === b || apart(a, b)) return;
        (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
        (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
    };
    for (const [id, entry] of Object.entries(user)) for (const other of entry.merged ?? []) link(id, other);
    const queue = [...protectedIds];
    while (queue.length) {
        for (const next of links.get(queue.pop()!) ?? []) {
            if (protectedIds.has(next)) continue;
            protectedIds.add(next);
            queue.push(next);
        }
    }
    for (const [id, entry] of Object.entries(copy.houses)) {
        if (!protectedIds.has(id)) continue;
        delete entry.location;
        delete entry.name;
        if (!Object.keys(entry).length) delete copy.houses[id];
    }
    if (!Object.keys(copy.houses).length) delete copy.houses;
}

/** First letter + '.', e.g. "Jan" -> "J.". Empty stays empty. */
function initial(name: string): string {
    const trimmed = name.trim();
    return trimmed ? `${trimmed[0].toUpperCase()}.` : '';
}

/** Drop every detail field, keeping only identity/structure fields. */
function stripDetails(person: Person): void {
    delete person.birthDate;
    delete person.birthPlace;
    delete person.deathDate;
    delete person.deathPlace;
    delete person.gedcomDates;
    delete person.birthAddress;
    delete person.birthAge;
    delete person.deathCause;
    delete person.deathAge;
    delete person.deathAddress;
    delete person.notes;
    // A narrative is the most personal text in the file — never about a living
    // person under a privacy mode.
    delete person.story;
    delete person.photo;
    delete person.photoOriginalName;
    delete person.photoDate;
    // The original the portrait was cut from (spec 107; the attachment goes below).
    delete person.photoSource;
    // Life events carry places and dates — drop them for living people.
    delete person.events;
    // Source citations may point at sensitive references — drop them too.
    delete person.sourceIds;
    delete person.birthSourceIds;
    delete person.deathSourceIds;
    // …with their details: a citation's own QUAY and the main citation of a fact.
    delete person.citationQuay;
    delete person.citationMain;
    // Attachments (scans, letters) are private documents — always dropped (by the caller, StromData.media).
    // Name variants carry the full real name (e.g. a GEDCOM second NAME line
    // under "Living person"); the open question is free text about the person;
    // a REFN is an identifier that finds them in other databases.
    delete person.nameVariants;
    // Titles ("Ing.", "ml.") narrow down who someone is as much as a name variant.
    delete person.titleBefore;
    delete person.titleAfter;
    // The surname after marriage is the name a living woman goes by today.
    delete person.marriedSurname;
    delete person.marriedFirstName;
    // …which of the two she goes by (it hints at a divorce; initials keep
    // the married surname's initial, not the choice)…
    delete person.primaryName;
    // …and the one the editor suggested from the husband's surname.
    delete person.dismissedMarriedSuggestion;
    delete person.question;
    // The contact of a living person is theirs to give (spec 134 K0.10).
    delete person.emails;
    delete person.refn;
    delete person.refnType;
    // What the research knows about them (conflicts, hypotheses, searches).
    delete person.research;
    // When they came into the tree (spec 084 §8) is a date about them like the rest.
    delete person.addedAt;
    // …and so is the time of their last change here (spec 136 D4).
    delete person.changedAt;
}

/**
 * Drop a couple's details when either partner is living: when and where they
 * married (or split), the note and the witnesses. The union itself (partners,
 * status, children) is structure and stays. 'initials' keeps the start YEAR,
 * mirroring the birth year it keeps on the person.
 */
function stripPartnershipDetails(partnership: Partnership, mode: PrivacyMode): void {
    const startYear = mode === 'initials' ? yearOf(partnership.startDate) : null;
    delete partnership.startDate;
    delete partnership.startPlace;
    delete partnership.endDate;
    delete partnership.endPlace;
    delete partnership.gedcomDates;
    delete partnership.address;
    delete partnership.ages;
    delete partnership.note;
    delete partnership.participants;
    delete partnership.story;
    delete partnership.sourceIds;
    delete partnership.divorceSourceIds;
    delete partnership.citationQuay;
    delete partnership.citationMain;
    // The banns, the household at a census: dates, places, witnesses.
    delete partnership.events;
    // The couple's photo shows a living person (spec 107).
    delete partnership.photo;
    delete partnership.photoOriginalName;
    delete partnership.photoDate;
    delete partnership.photoOriginal;
    if (startYear !== null) partnership.startDate = String(startYear);
}

export interface LivingPrivacyOptions {
    /**
     * Deceased people keep their sources and attachments (the person page,
     * spec 025 K2.7): only the living lose them, and the source catalog keeps
     * just the sources someone still cites. Without it every source and
     * attachment goes (book, tree export).
     */
    keepDeceasedSources?: boolean;
    /**
     * Living people shown in full whatever the mode (a gift's household and
     * its exceptions, spec 093 §4); `sensitive` masks their details by kind.
     */
    fullIds?: Iterable<string>;
    /**
     * What the living shown in full keep, by kind (true = kept). Missing =
     * everything. Under 'full' it applies to every living person, unless
     * `othersSensitive` is given.
     */
    sensitive?: LivingSensitive;
    /**
     * Under 'full': what the living outside `fullIds` keep (a gift's "other
     * living", spec 093 K6.5). Missing = `sensitive` for them too. A couple of
     * two living people takes the stricter of their two masks.
     */
    othersSensitive?: LivingSensitive;
    /** What the deceased keep (true = kept). Missing = everything. */
    dead?: DeceasedDetails;
}

/**
 * The kinds of detail of a living person shown in full (spec 093 §4):
 * - birthDates: the date of birth (the year stays) and of the baptism;
 * - addresses: addresses and residences (the birth and event addresses, the
 *   residence and census events, a couple's address);
 * - contacts: e-mail addresses (also those in notes) and another program's
 *   own lines (phone numbers among them);
 * - photos: the portrait and the attachments;
 * - notes: notes, narratives, the open question;
 * - religion: the religion event and the religious rites;
 * - sources: the citations, their details and the attachments.
 */
export interface LivingSensitive {
    birthDates: boolean;
    addresses: boolean;
    contacts: boolean;
    photos: boolean;
    notes: boolean;
    religion: boolean;
    sources: boolean;
}

/** What the deceased keep: the causes of death, notes and narratives, citations. */
export interface DeceasedDetails {
    causes: boolean;
    notes: boolean;
    sources: boolean;
}

/** Events that tell a person's faith (the religion itself and its rites). */
const RELIGION_EVENTS: ReadonlySet<string> = new Set(['religion', 'baptism', 'confirmation', 'firstCommunion', 'barMitzvah', 'batMitzvah', 'ordination']);
/** Events that tell where a person lives. */
const RESIDENCE_EVENTS: ReadonlySet<string> = new Set(['residence', 'census']);
/** Events whose date tells the date of birth. */
const BIRTH_DATE_EVENTS: ReadonlySet<string> = new Set(['birth', 'baptism']);
/** A line of free text with an e-mail address in it. */
const EMAIL_LINE = /^.*[^\s@]+@[^\s@]+\.[^\s@]+.*$/gm;

/** Free text without the lines that carry an e-mail address. */
function withoutEmailLines(text: string | undefined): string | undefined {
    if (!text) return text;
    const out = text.replace(EMAIL_LINE, '').replace(/\n{2,}/g, '\n').trim();
    return out || undefined;
}

type EventLike = { type?: string; date?: string; address?: string; gedcomAddress?: unknown; note?: string; cause?: string; sourceIds?: string[];
    citationQuay?: unknown; citationMain?: unknown; gedcomEmails?: string[]; participants?: { note?: string }[] };

/** Set or delete an optional text field (undefined deletes it). */
function setText<T extends object, K extends keyof T>(holder: T, key: K, value: T[K] | undefined): void {
    if (value === undefined) delete holder[key];
    else holder[key] = value as T[K];
}

/** Mask one event's details by kind (the event itself stays unless the caller drops it). */
function maskEvent(ev: EventLike, s: LivingSensitive): void {
    if (!s.birthDates && ev.type && BIRTH_DATE_EVENTS.has(ev.type) && ev.date) {
        const y = yearOf(ev.date);
        if (y === null) delete ev.date; else ev.date = String(y);
    }
    if (!s.addresses) { delete ev.address; delete ev.gedcomAddress; }
    if (!s.contacts) {
        delete ev.gedcomEmails;
        setText(ev, 'note', withoutEmailLines(ev.note));
        for (const part of ev.participants ?? []) setText(part, 'note', withoutEmailLines(part.note));
    }
    if (!s.notes) {
        delete ev.note;
        for (const part of ev.participants ?? []) delete part.note;
    }
    if (!s.sources) { delete ev.sourceIds; delete ev.citationQuay; delete ev.citationMain; }
}

/** Which events a person shown in full keeps. */
function keepsEvent(ev: { type?: string }, s: LivingSensitive): boolean {
    if (!s.addresses && ev.type && RESIDENCE_EVENTS.has(ev.type)) return false;
    if (!s.religion && ev.type && RELIGION_EVENTS.has(ev.type)) return false;
    return true;
}

/** Whether a mask hides anything at all. */
function masksAny(s: object): boolean {
    return Object.values(s).some(v => v === false);
}

/** A living person shown in full: their details masked by kind. */
function maskSensitive(person: Person, s: LivingSensitive): void {
    if (!s.birthDates) {
        const y = yearOf(person.birthDate);
        if (y === null) delete person.birthDate; else person.birthDate = String(y);
        delete person.birthAge;
        delete person.gedcomDates;
    }
    if (!s.addresses) { delete person.birthAddress; delete person.deathAddress; }
    if (!s.contacts) {
        delete person.emails;
        setText(person, 'notes', withoutEmailLines(person.notes));
    }
    if (!s.photos) {
        delete person.photo;
        delete person.photoOriginalName;
        delete person.photoDate;
        delete person.photoSource;
    }
    if (!s.notes) {
        delete person.notes;
        delete person.story;
        delete person.question;
        delete person.research;
    }
    if (!s.sources) {
        delete person.sourceIds;
        delete person.birthSourceIds;
        delete person.deathSourceIds;
        delete person.citationQuay;
        delete person.citationMain;
        delete person.research;
        rewriteStorySources(person.story, () => []);
    }
    if (person.events) {
        person.events = person.events.filter(ev => keepsEvent(ev, s));
        for (const ev of person.events) maskEvent(ev, s);
        if (person.events.length === 0) delete person.events;
    }
    if (masksAny(s)) forgetHiddenImports(person, true);
}

/** A couple whose living partners are shown in full: its details masked by kind. */
function maskSensitiveCouple(partnership: Partnership, s: LivingSensitive): void {
    if (!s.addresses) delete partnership.address;
    if (!s.photos) {
        delete partnership.photo;
        delete partnership.photoOriginalName;
        delete partnership.photoDate;
        delete partnership.photoOriginal;
    }
    if (!s.contacts) setText(partnership, 'note', withoutEmailLines(partnership.note));
    if (!s.notes) {
        delete partnership.note;
        delete partnership.story;
        for (const part of partnership.participants ?? []) delete part.note;
    }
    if (!s.sources) {
        delete partnership.sourceIds;
        delete partnership.divorceSourceIds;
        delete partnership.citationQuay;
        delete partnership.citationMain;
        rewriteStorySources(partnership.story, () => []);
    }
    if (partnership.events) {
        partnership.events = partnership.events.filter(ev => keepsEvent(ev, s));
        for (const ev of partnership.events) maskEvent(ev, s);
        if (partnership.events.length === 0) delete partnership.events;
    }
    if (masksAny(s)) forgetHiddenImports(partnership, true);
}

/** A deceased person (or a couple of the deceased): causes, notes and citations by `d`. */
function maskDeceased(holder: Person | Partnership, d: DeceasedDetails): void {
    const h = holder as Partial<Person> & Partial<Partnership>;
    if (!d.causes) delete h.deathCause;
    if (!d.notes) {
        delete h.notes;
        delete h.note;
        delete h.story;
        delete h.question;
        delete h.research;
        for (const part of h.participants ?? []) delete part.note;
    }
    if (!d.sources) {
        delete h.sourceIds;
        delete h.birthSourceIds;
        delete h.deathSourceIds;
        delete h.divorceSourceIds;
        delete h.citationQuay;
        delete h.citationMain;
        delete h.research;
        rewriteStorySources(h.story, () => []);
    }
    for (const ev of (h.events ?? []) as EventLike[]) {
        if (!d.causes) delete ev.cause;
        if (!d.notes) {
            delete ev.note;
            for (const part of ev.participants ?? []) delete part.note;
        }
        if (!d.sources) { delete ev.sourceIds; delete ev.citationQuay; delete ev.citationMain; }
    }
    if (masksAny(d)) forgetHiddenImports(holder, false);
}

/**
 * Return a deep copy of `data` with living persons obscured according to `mode`.
 * Deceased persons and placeholders are left untouched. 'full' is a no-op copy.
 */
export function applyLivingPrivacy(
    data: StromData,
    mode: PrivacyMode,
    currentYear: number = new Date().getFullYear(),
    options: LivingPrivacyOptions = {}
): StromData {
    const copy = structuredClone(data);
    // A gift's choices (spec 093 §4): people in full, masks by kind, the deceased's details.
    const gift = !!(options.fullIds || options.sensitive || options.othersSensitive || options.dead);
    if (mode === 'full' && !gift) return copy;
    // The merge history keeps the details a merge changed, of the living too: never under a privacy mode.
    delete copy.merges;
    // A house of people of the last ~100 years keeps its location and name to itself (spec 030 §10).
    protectHouses(copy, data, currentYear, inferBirthUpperBounds(data));

    // The source catalog may hold sensitive references (e.g. registers of the
    // living), so it is never exported under a privacy mode. Drop every citation
    // too, so no person/event points at a source that is no longer present.
    if (!options.keepDeceasedSources) {
        delete copy.sources;
        delete copy.media;
        for (const person of Object.values(copy.persons)) {
            delete person.sourceIds;
            delete person.birthSourceIds;
            delete person.deathSourceIds;
            delete person.citationQuay;
            delete person.citationMain;
            for (const ev of person.events ?? []) { delete ev.sourceIds; delete ev.citationQuay; delete ev.citationMain; }
            rewriteStorySources(person.story, () => []);
        }
        for (const partnership of Object.values(copy.partnerships)) {
            delete partnership.sourceIds;
            delete partnership.divorceSourceIds;
            delete partnership.citationQuay;
            delete partnership.citationMain;
            for (const ev of partnership.events ?? []) { delete ev.sourceIds; delete ev.citationQuay; delete ev.citationMain; }
            rewriteStorySources(partnership.story, () => []);
        }
    }

    // Decide liveness BEFORE any transformation (the loop below strips the
    // very dates the inference reads), with indirect evidence: a person whose
    // child was born in 1880 is certainly not living, even with no dates of
    // their own.
    const bounds = inferBirthUpperBounds(copy);
    const living = new Set(
        Object.values(copy.persons)
            .filter(p => !p.isPlaceholder && isLivingPerson(p, currentYear, bounds))
            .map(p => p.id)
    );
    // The living shown in full (all of them under 'full'); the rest are obscured by the mode.
    const fullIds = new Set<string>(options.fullIds ?? []);
    const shown = new Set([...living].filter(id => mode === 'full' || fullIds.has(id)));
    const obscured = shown.size ? new Set([...living].filter(id => !shown.has(id))) : living;
    const sensitive = options.sensitive;
    const othersSensitive = mode === 'full' ? options.othersSensitive : undefined;
    const dead = options.dead;
    // The mask of a living person shown in full: the "other living" one under 'full' outside fullIds.
    const maskOf = (id: string): LivingSensitive | undefined =>
        (othersSensitive && !fullIds.has(id) ? othersSensitive : sensitive);
    // A couple's mask: the stricter of its shown living partners' (a deceased partner adds none).
    const coupleMask = (partnership: Partnership): LivingSensitive | undefined => {
        const masks = [partnership.person1Id, partnership.person2Id]
            .filter(id => shown.has(id))
            .map(maskOf)
            .filter((m): m is LivingSensitive => !!m);
        if (masks.length === 0) return undefined;
        if (masks.length === 1) return masks[0];
        const out = { ...masks[0] };
        for (const key of Object.keys(out) as (keyof LivingSensitive)[]) out[key] = masks.every(m => m[key]);
        return out;
    };

    // A couple's details (dates, place, note, witnesses, narrative) describe
    // both of them, so they go as soon as either one is living — there is no
    // half of them to keep. A couple of the living shown in full keeps them,
    // masked like the people.
    for (const partnership of Object.values(copy.partnerships)) {
        if (obscured.has(partnership.person1Id) || obscured.has(partnership.person2Id)) {
            stripPartnershipDetails(partnership, mode);
            forgetHiddenImports(partnership, true);
        } else if (shown.has(partnership.person1Id) || shown.has(partnership.person2Id)) {
            const mask = coupleMask(partnership);
            if (mask) maskSensitiveCouple(partnership, mask);
            if (dead) maskDeceased(partnership, dead);
        } else if (dead) {
            const p1 = copy.persons[partnership.person1Id];
            const p2 = copy.persons[partnership.person2Id];
            if ((p1 && !p1.isPlaceholder) || (p2 && !p2.isPlaceholder)) maskDeceased(partnership, dead);
        }
    }

    for (const person of Object.values(copy.persons)) {
        if (shown.has(person.id)) {
            const mask = maskOf(person.id);
            if (mask) maskSensitive(person, mask);
            continue;
        }
        if (!living.has(person.id)) {
            if (dead && !person.isPlaceholder) maskDeceased(person, dead);
            continue;
        }

        switch (mode) {
            case 'initials': {
                const birthYear = yearOf(person.birthDate);
                const married = initial(person.marriedSurname ?? '');
                person.firstName = initial(person.firstName);
                person.lastName = initial(person.lastName);
                stripDetails(person);
                if (birthYear !== null) person.birthDate = String(birthYear);
                // Shortened like the surname, never kept whole.
                if (married) person.marriedSurname = married;
                break;
            }
            case 'anonymous': {
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = '';
                break;
            }
            case 'minimal': {
                const keptLastName = person.lastName;
                stripDetails(person);
                person.firstName = strings.privacy.livingPerson;
                person.lastName = keptLastName;
                break;
            }
        }
        // The file's values of what was just hidden must not stay behind.
        forgetHiddenImports(person, true);
    }
    // Attachments (scans, letters) of the living and of their couples are private documents — always dropped.
    // Those of the living shown in full go with their photos or their sources (each by their own mask;
    // a couple's go when either partner's would, which is the stricter mask).
    const shownMediaGo = (id: PersonId): boolean => {
        const mask = maskOf(id);
        return !!mask && (!mask.photos || !mask.sources);
    };
    const mediaGo = (id: PersonId): boolean => obscured.has(id) || (shown.has(id) && shownMediaGo(id));
    dropMediaPlaces(copy, place => {
        const pid = placePersonId(place);
        if (pid) return mediaGo(pid);
        const uid = placePartnershipId(place);
        const union = uid ? copy.partnerships[uid] : undefined;
        return !!union && (mediaGo(union.person1Id) || mediaGo(union.person2Id));
    });
    // A deceased person's own godparent or witness event keeps its role but
    // not whose event it was when that is a living person or a couple whose
    // details went (GEDCOM's `_STROM_AT` would name them), and a shared event
    // whose other copies went with the living is that person's own again.
    for (const person of Object.values(copy.persons)) {
        for (const ev of person.events ?? []) {
            const at = ev.roleAt;
            if (!at) continue;
            const partnership = at.partnershipId ? copy.partnerships[at.partnershipId] : undefined;
            if ((at.personId && obscured.has(at.personId))
                || (partnership && (obscured.has(partnership.person1Id) || obscured.has(partnership.person2Id)))) {
                delete at.personId;
                delete at.partnershipId;
                delete at.eventId;
            }
        }
    }
    tidyShares(copy);
    // A "?" of a loaded file (a spouse the file names without a name) goes out
    // as its record, with nothing of its own to hide but its ids there, which
    // name the person in the other program: gone when it may be living. Which
    // files it was a record of stays (no id in it), so it is not taken for a
    // stand-in the app made up and its family keeps both partners.
    for (const person of Object.values(copy.persons)) {
        if (!person.isPlaceholder || !person.originalIds || !isLivingPerson(person, currentYear, bounds)) continue;
        const files = person.originalIds.map(e => ({ from: e.from, ids: [] }));
        forgetHiddenImports(person, true);
        person.originalIds = files;
    }

    // The living lost their citations above; a source only they cited goes too.
    if (options.keepDeceasedSources && copy.sources) {
        const cited = new Set<string>();
        const cite = (ids: readonly string[] | undefined) => { for (const id of ids ?? []) cited.add(id); };
        for (const p of Object.values(copy.persons)) {
            cite(p.sourceIds);
            cite(p.birthSourceIds);
            cite(p.deathSourceIds);
            for (const ev of p.events ?? []) cite(ev.sourceIds);
            cite(storySourceIds(p.story));
        }
        for (const u of Object.values(copy.partnerships)) {
            cite(u.sourceIds);
            cite(u.divorceSourceIds);
            for (const ev of u.events ?? []) cite(ev.sourceIds);
            cite(storySourceIds(u.story));
        }
        for (const a of allMedia(copy)) cite(mediaSourceIds(a));
        for (const id of Object.keys(copy.sources)) if (!cited.has(id)) delete copy.sources[id];
    }

    // A deceased partner's portrait cut from the photo of a couple with a
    // living person, or from an attachment that went: the link goes too.
    pruneMedia(copy);
    dropDanglingPortraitSources(copy);
    return copy;
}

/**
 * The citations of a tree: every reference from a person, a couple, their
 * events and narratives to a source of the catalog (an attachment's link to
 * its source is an image, not a citation).
 */
export function countCitations(data: StromData): number {
    let n = 0;
    const count = (ids: readonly string[] | undefined) => { n += ids?.length ?? 0; };
    for (const p of Object.values(data.persons)) {
        count(p.sourceIds);
        count(p.birthSourceIds);
        count(p.deathSourceIds);
        for (const ev of p.events ?? []) count(ev.sourceIds);
        count(storySourceIds(p.story));
    }
    for (const u of Object.values(data.partnerships)) {
        count(u.sourceIds);
        count(u.divorceSourceIds);
        for (const ev of u.events ?? []) count(ev.sourceIds);
        count(storySourceIds(u.story));
    }
    return n;
}

/** The tree's own people (no placeholders) the privacy filter treats as living. */
export function countLivingPersons(data: StromData, currentYear: number = new Date().getFullYear()): number {
    const bounds = inferBirthUpperBounds(data);
    return Object.values(data.persons).filter(p => !p.isPlaceholder && isLivingPerson(p, currentYear, bounds)).length;
}

/**
 * What a GEDCOM export leaves out of the tree's sources (spec 066 §5): the
 * sources of the catalog and the citations the tree has and the file will
 * not. Without "Sources & citations" everything; otherwise, under a privacy
 * mode, the citations of the living (and of couples with a living partner)
 * and the sources only they cite — the deceased keep theirs
 * (`keepDeceasedSources`). Pure: does not touch `data`.
 */
export function droppedSources(
    data: StromData,
    privacy: PrivacyMode,
    content: Pick<ContentOptions, 'sources'>,
    currentYear: number = new Date().getFullYear()
): { sources: number; citations: number } {
    const sources = Object.keys(data.sources ?? {}).length;
    const citations = countCitations(data);
    if (!content.sources) return { sources, citations };
    if (privacy === 'full' || (sources === 0 && citations === 0)) return { sources: 0, citations: 0 };
    const kept = applyLivingPrivacy(data, privacy, currentYear, { keepDeceasedSources: true });
    return {
        sources: sources - Object.keys(kept.sources ?? {}).length,
        citations: citations - countCitations(kept),
    };
}

/**
 * Presumed-deceased set for the † marker (renderer + poster export share this):
 * a recorded death or isDeceased, or an age beyond 120. A person with a birth
 * year is judged by it alone; one without by the latest year they can have
 * been born (inferBirthUpperBounds: their own events, weddings, children's
 * births), unless marked as alive. A descendant's death alone never marks an
 * ancestor (T35: a parent born in 1937 of a child who died is not †). Looser
 * than the privacy heuristic above on purpose — it only drives a display marker.
 */
export function presumedDeceasedSet(data: StromData, currentYear: number = new Date().getFullYear()): Set<string> {
    const MARKER_MAX_AGE = 120;
    const out = new Set<string>();
    let bounds: Map<string, number> | null = null;
    for (const p of Object.values(data.persons)) {
        if (p.deathDate || p.isDeceased === true) { out.add(p.id); continue; }
        const birthYear = yearOf(p.birthDate);
        if (birthYear !== null) {
            if (currentYear - birthYear > MARKER_MAX_AGE) out.add(p.id);
            continue;
        }
        if (p.isDeceased === false) continue;
        bounds ??= inferBirthUpperBounds(data);
        const latestBirth = bounds.get(p.id);
        if (latestBirth !== undefined && currentYear - latestBirth > MARKER_MAX_AGE) out.add(p.id);
    }
    return out;
}
