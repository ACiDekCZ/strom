/**
 * "Read a document" (spec 013): the research's agent reads one document (a
 * photo, a scan, a PDF; up to `pages` files as its pages) and gives back a
 * transcription, translation and explanation as data.
 *
 * This module is the data layer only: what the bridge says about reading
 * (`/status.accepts.read`, `/status.reads`), the result (`GET read/<id>`),
 * the bridge calls and how a refusal maps to the app's states. Everything
 * from the bridge is untrusted: checked, capped and cleaned here; a refusal's
 * `error`/`text` are never shown (the app says it by `code`).
 */

import { cleanText, researchPersonRef, withAppVersion } from './research-link.js';
import { clipText } from './text-clip.js';

/** `/status.features`: the research reads a document for the app now (`POST read`). */
export const READ_FEATURE = 'read.now';

/** The states of one reading, as the bridge says them. */
export type ReadState = 'queued' | 'reading' | 'checking' | 'done' | 'unreadable' | 'failed' | 'cancelled';
const READ_STATES: readonly ReadState[] = ['queued', 'reading', 'checking', 'done', 'unreadable', 'failed', 'cancelled'];

/** A reading still on its way (queued, being read, being compared). */
export function readRunning(state: ReadState): boolean {
    return state === 'queued' || state === 'reading' || state === 'checking';
}

/** `accepts.read`: whether and what the research reads now. */
export interface ReadAccepts {
    /** Reading can start now. */
    ready: boolean;
    /** Why not (`ready: false`): `agent.none`, `agent.untested`, `agent.sandbox`, `shared.none`, `limit`, `auth` or another code; '' when ready. */
    why: string;
    /** Until when a `limit` lasts (ISO), when the research says; ''. */
    resets: string;
    /** At most this many independent readers (1 or 2). */
    readers: number;
    /** The kinds of file it reads (MIME, lower case). */
    types: string[];
    /** The largest file it reads, in bytes. */
    max: number;
    /** At most this many files (pages) per document. */
    pages: number;
    /** The languages it translates and explains into. */
    langs: string[];
}

/** Defaults when the research leaves a limit out (the bridge's own: 50 MB, 10 pages). */
const DEFAULT_MAX = 50 * 1024 * 1024;
const DEFAULT_PAGES = 10;

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

const asCount = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

const asFraction = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

/** An ISO time as the bridge gives it, or ''. */
function isoTime(v: unknown): string {
    const t = cleanText(v, 40);
    return t && Number.isFinite(Date.parse(t)) ? t : '';
}

/** A short code (`agent.none`, `blur`, `register.baptism`), or ''. */
function code(v: unknown): string {
    return typeof v === 'string' && /^[a-z][a-z0-9.-]{0,40}$/.test(v) ? v : '';
}

/** Text that keeps its line breaks (a transcription): control characters out, each line trimmed of runs, capped. */
export function cleanBlock(value: unknown, max = 20_000): string {
    if (typeof value !== 'string') return '';
    const lines = value.replace(/\r\n?/g, '\n').split('\n')
        // eslint-disable-next-line no-control-regex
        .map(line => line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').trimEnd());
    const flat = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** `accepts.read`, or null when the research does not read for the app (absent, an archive, no agent). Untrusted. */
export function sanitizeReadAccepts(value: unknown): ReadAccepts | null {
    const r = asRecord(value);
    if (!r) return null;
    const types = Array.isArray(r.types)
        ? r.types.slice(0, 20).filter((t): t is string => typeof t === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(t)).map(t => t.toLowerCase())
        : [];
    const langs = Array.isArray(r.langs)
        ? r.langs.slice(0, 20).filter((l): l is string => typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l))
        : [];
    const ready = r.ready === true;
    return {
        ready,
        why: ready ? '' : code(r.why) || 'other',
        resets: isoTime(r.resets),
        readers: asCount(r.readers) === 2 ? 2 : 1,
        types: types.length ? types : ['image/jpeg', 'image/png'],
        max: asCount(r.max) || DEFAULT_MAX,
        pages: Math.min(50, asCount(r.pages) || DEFAULT_PAGES),
        langs,
    };
}

/** One reading in `/status.reads` (or an SSE `read` event). */
export interface LiveRead {
    /** "D20261019153012-a1b2". */
    id: string;
    state: ReadState;
    version: number;
    /** When it was asked for (ISO). */
    at: string;
    /** When it came into its state (ISO). */
    since: string;
    files: number;
    pages: number;
    readers: number;
    /** Readers that have finished. */
    done: number;
    /** Entries read so far. */
    entries: number;
    /** Its first file's name ('' = not said). */
    name: string;
    /** The person it is about (REFN), ''. */
    person: string;
    /** Started by the app, or in the research (an agent, the terminal: no again/cancel from the app). */
    from: 'app' | 'research';
}

/** A reading's id, or null. */
export function readId(value: unknown): string | null {
    return typeof value === 'string' && /^D\d{14}-[0-9a-f]{4}$/.test(value) ? value : null;
}

/** One `/status.reads` entry, or an SSE `read` event's data. Null: not a reading. Untrusted. */
export function sanitizeLiveRead(value: unknown): LiveRead | null {
    const r = asRecord(value);
    const id = r ? readId(r.id ?? r.read) : null;
    if (!r || !id) return null;
    const state = READ_STATES.includes(r.state as ReadState) ? r.state as ReadState : null;
    if (!state) return null;
    const readers = asCount(r.readers) === 2 ? 2 : 1;
    return {
        id, state,
        version: asCount(r.version) || 1,
        at: isoTime(r.at),
        since: isoTime(r.since),
        files: asCount(r.files) ?? 0,
        pages: asCount(r.pages) ?? 0,
        readers,
        done: Math.min(readers, asCount(r.done) ?? 0),
        entries: asCount(r.entries) ?? 0,
        name: cleanText(r.name, 200),
        person: researchPersonRef(r.person) ?? '',
        from: r.from === 'research' ? 'research' : 'app',
    };
}

/** `/status.reads`, newest first (at most 50); null when the research does not say. Untrusted. */
export function sanitizeReads(value: unknown): LiveRead[] | null {
    if (!Array.isArray(value)) return null;
    const out: LiveRead[] = [];
    const seen = new Set<string>();
    for (const item of value.slice(0, 200)) {
        const read = sanitizeLiveRead(item);
        if (!read || seen.has(read.id)) continue;
        seen.add(read.id);
        out.push(read);
        if (out.length >= 50) break;
    }
    return out;
}

// ==================== The history (GET reads) ====================

/** One reading in `GET reads`: a `/status.reads` entry plus whether a source of the tree carries it. */
export interface ReadHistoryItem extends LiveRead {
    inSource: boolean;
}

const HISTORY_MAX = 200;

/**
 * `GET reads` (`{reads: [...]}`), newest first by `at`, without duplicates and
 * capped; null when the answer is not a history. Untrusted.
 */
export function sanitizeReadHistory(value: unknown): ReadHistoryItem[] | null {
    const b = asRecord(value);
    const list = Array.isArray(value) ? value : b && Array.isArray(b.reads) ? b.reads : null;
    if (!list) return null;
    const out: ReadHistoryItem[] = [];
    const seen = new Set<string>();
    for (const item of list.slice(0, HISTORY_MAX * 4)) {
        const read = sanitizeLiveRead(item);
        if (!read || seen.has(read.id)) continue;
        seen.add(read.id);
        out.push({ ...read, inSource: asRecord(item)?.inSource === true });
        if (out.length >= HISTORY_MAX) break;
    }
    // Newest first: by `at`, then by the id (which carries the time it was asked for).
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.id.localeCompare(a.id));
}

// ==================== The result (GET read/<id>) ====================

/** `[x, y, w, h]` as fractions of the page from its top left corner. */
export type ReadRegion = [number, number, number, number];

export type ReadDocKind =
    | 'register.baptism' | 'register.birth' | 'register.marriage' | 'register.death' | 'register.burial' | 'register.other'
    | 'letter' | 'deed' | 'gravestone' | 'photo.back' | 'certificate' | 'list' | 'other';
const DOC_KINDS: readonly ReadDocKind[] = [
    'register.baptism', 'register.birth', 'register.marriage', 'register.death', 'register.burial', 'register.other',
    'letter', 'deed', 'gravestone', 'photo.back', 'certificate', 'list', 'other',
];

/** Why a document (or a part of it) cannot be read. */
export type ReadWhy = 'blur' | 'glare' | 'angle' | 'cut' | 'dark' | 'small' | 'not-text' | 'other';
const READ_WHYS: readonly ReadWhy[] = ['blur', 'glare', 'angle', 'cut', 'dark', 'small', 'not-text', 'other'];

export type ReadRole =
    | 'child' | 'father' | 'mother' | 'godparent' | 'witness' | 'midwife' | 'priest' | 'groom' | 'bride'
    | 'deceased' | 'informant' | 'writer' | 'addressee' | 'mentioned' | 'other';
export const READ_ROLES: readonly ReadRole[] = [
    'child', 'father', 'mother', 'godparent', 'witness', 'midwife', 'priest', 'groom', 'bride',
    'deceased', 'informant', 'writer', 'addressee', 'mentioned', 'other',
];

export interface ReadDoc {
    kind: ReadDocKind;
    /** The document's languages (BCP 47). */
    language: string[];
    /** kurrent | fraktur | latin | cyrillic | print | other; '' = not said. */
    script: string;
    /** When the document was made, as text ('' = not said). */
    date: string;
    legible: 'yes' | 'partly' | 'no';
    /** Why not (fully) legible; null when legible. */
    why: ReadWhy | null;
}

export interface ReadReaders {
    asked: number;
    ran: number;
    agree: 'same' | 'differ' | 'fixed' | null;
}

export interface ReadPage {
    n: number;
    /** The research's input or media id ("I0042", "M0003"); ''. */
    file: string;
    sha: string;
    name: string;
    /** The page within its file (a PDF's page), 1-based. */
    page: number;
    /** Size after rotation (px); 0 = not said. */
    w: number;
    h: number;
    /** The page as JPEG, relative to the bridge's `<base>/` ("read/<id>/page/<n>.jpg"); '' = none. */
    image: string;
}

export interface ReadVariant { at: string; other: string }

export interface ReadGloss { term: string; meaning: string; kind: 'term' | 'occupation' | 'abbr' | 'symbol' }

export interface ReadMatch { person: string; why: string; score: number }

export interface ReadPerson {
    /** The person's ref within this reading ("p1"). */
    ref: string;
    role: ReadRole;
    /** The role in the reading's language ('' = use the app's own). */
    roleText: string;
    given: string;
    surname: string;
    /** The literal span of the transcription. */
    written: string;
    sex: 'M' | 'F' | '';
    age: string;
    occupation: string;
    residence: string;
    /** Fields read uncertainly ("given", "surname", …). */
    uncertain: string[];
    region: ReadRegion | null;
    /** The research's guesses which of its persons this is (REFN), best first. */
    match: ReadMatch[];
}

export interface ReadEvent {
    /** GEDCOM tag ("BAPM", "BIRT", "MARR", "DEAT", "BURI", …). */
    type: string;
    date: { text: string; gedcom: string } | null;
    place: { text: string; known: string } | null;
    persons: { ref: string; role: string }[];
    region: ReadRegion | null;
}

export type ReadRelation =
    | { type: 'parent'; parent: string; child: string }
    | { type: 'spouse'; a: string; b: string };

export interface ReadEntry {
    id: string;
    page: number;
    region: ReadRegion | null;
    /** Literal, with the marks `[?]` (uncertain), `[...]` (illegible), `|` (line break in the original). */
    transcript: string;
    variants: ReadVariant[];
    translation: string;
    glossary: ReadGloss[];
    persons: ReadPerson[];
    events: ReadEvent[];
    relations: ReadRelation[];
}

/** `GET read/<id>`: a reading's result (partial while it runs). */
export interface ReadResult {
    id: string;
    state: ReadState;
    /** The language of translation and explanation. */
    lang: string;
    doc: ReadDoc;
    readers: ReadReaders;
    pages: ReadPage[];
    entries: ReadEntry[];
    /** The explanation of the document by its kind ('' = none). */
    context: string;
    cost: { amount: number; currency: string; partial: boolean } | null;
    version: number;
}

function region(v: unknown): ReadRegion | null {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const n = v.map(asFraction);
    return n.every((x): x is number => x !== null) ? n as ReadRegion : null;
}

function langList(v: unknown): string[] {
    return Array.isArray(v)
        ? v.slice(0, 10).filter((l): l is string => typeof l === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l))
        : typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) ? [v] : [];
}

/** A ref inside one reading ("p1"), or ''. */
function localRef(v: unknown): string {
    return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,20}$/.test(v) ? v : '';
}

/** A page image's path within the bridge, only the shape the research uses ("read/<id>/page/<n>.jpg"), or ''. */
function pageImage(v: unknown): string {
    return typeof v === 'string' && /^read\/D\d{14}-[0-9a-f]{4}\/page\/\d{1,3}\.jpg$/.test(v) ? v : '';
}

function sanitizePerson(v: unknown): ReadPerson | null {
    const p = asRecord(v);
    const ref = p ? localRef(p.ref) : '';
    if (!p || !ref) return null;
    const match: ReadMatch[] = [];
    for (const m of Array.isArray(p.match) ? p.match.slice(0, 10) : []) {
        const r = asRecord(m);
        const person = r ? researchPersonRef(r.person) : null;
        if (!r || !person) continue;
        match.push({ person, why: cleanText(r.why, 200), score: asFraction(r.score) ?? 0 });
    }
    const field = (x: unknown, max = 200) => (typeof x === 'number' && Number.isFinite(x) ? String(x) : cleanText(x, max));
    return {
        ref,
        role: READ_ROLES.includes(p.role as ReadRole) ? p.role as ReadRole : 'other',
        roleText: cleanText(p.roleText, 60),
        given: cleanText(p.given, 120),
        surname: cleanText(p.surname, 120),
        written: cleanText(p.written, 300),
        sex: p.sex === 'M' || p.sex === 'F' ? p.sex : '',
        age: field(p.age, 40),
        occupation: cleanText(p.occupation, 200),
        residence: cleanText(p.residence, 200),
        uncertain: Array.isArray(p.uncertain)
            ? p.uncertain.slice(0, 20).filter((u): u is string => typeof u === 'string' && /^[a-z][a-zA-Z]{0,30}$/.test(u)) : [],
        region: region(p.region),
        match,
    };
}

function sanitizeEvent(v: unknown): ReadEvent | null {
    const e = asRecord(v);
    const type = e && typeof e.type === 'string' && /^_?[A-Z]{3,5}$/.test(e.type) ? e.type : '';
    if (!e || !type) return null;
    const d = asRecord(e.date);
    const pl = asRecord(e.place);
    const date = d ? { text: cleanText(d.text, 120), gedcom: cleanText(d.gedcom, 60) } : null;
    const place = pl ? { text: cleanText(pl.text, 200), known: typeof pl.known === 'string' && /^PL\d{1,7}$/.test(pl.known) ? pl.known : '' } : null;
    const persons: { ref: string; role: string }[] = [];
    for (const item of Array.isArray(e.persons) ? e.persons.slice(0, 40) : []) {
        const r = asRecord(item);
        const ref = r ? localRef(r.ref) : '';
        if (ref) persons.push({ ref, role: code(r!.role) });
    }
    return {
        type,
        date: date && (date.text || date.gedcom) ? date : null,
        place: place && place.text ? place : null,
        persons,
        region: region(e.region),
    };
}

function sanitizeRelation(v: unknown): ReadRelation | null {
    const r = asRecord(v);
    if (!r) return null;
    if (r.type === 'parent') {
        const parent = localRef(r.parent), child = localRef(r.child);
        return parent && child && parent !== child ? { type: 'parent', parent, child } : null;
    }
    if (r.type === 'spouse') {
        const a = localRef(r.a), b = localRef(r.b);
        return a && b && a !== b ? { type: 'spouse', a, b } : null;
    }
    return null;
}

function sanitizeEntry(v: unknown, index: number): ReadEntry | null {
    const e = asRecord(v);
    if (!e) return null;
    const variants: ReadVariant[] = [];
    for (const item of Array.isArray(e.variants) ? e.variants.slice(0, 100) : []) {
        const r = asRecord(item);
        const at = r ? cleanText(r.at, 300) : '';
        if (r && at) variants.push({ at, other: cleanText(r.other, 300) });
    }
    const glossary: ReadGloss[] = [];
    for (const item of Array.isArray(e.glossary) ? e.glossary.slice(0, 100) : []) {
        const r = asRecord(item);
        const term = r ? cleanText(r.term, 200) : '';
        if (!r || !term) continue;
        const kind = r.kind === 'occupation' || r.kind === 'abbr' || r.kind === 'symbol' ? r.kind : 'term';
        glossary.push({ term, meaning: cleanText(r.meaning, 1000), kind });
    }
    const persons = (Array.isArray(e.persons) ? e.persons.slice(0, 60) : []).map(sanitizePerson).filter((p): p is ReadPerson => !!p);
    const refs = new Set(persons.map(p => p.ref));
    const events = (Array.isArray(e.events) ? e.events.slice(0, 40) : []).map(sanitizeEvent).filter((x): x is ReadEvent => !!x)
        .map(ev => ({ ...ev, persons: ev.persons.filter(p => refs.has(p.ref)) }));
    const relations = (Array.isArray(e.relations) ? e.relations.slice(0, 100) : []).map(sanitizeRelation)
        .filter((x): x is ReadRelation => !!x && (x.type === 'parent' ? refs.has(x.parent) && refs.has(x.child) : refs.has(x.a) && refs.has(x.b)));
    return {
        id: localRef(e.id) || `e${index + 1}`,
        page: Math.max(1, asCount(e.page) ?? 1),
        region: region(e.region),
        transcript: cleanBlock(e.transcript),
        variants,
        translation: cleanBlock(e.translation),
        glossary, persons, events, relations,
    };
}

/** `GET read/<id>`, checked and cleaned; null: not a reading's result. Untrusted. */
export function sanitizeReadResult(value: unknown): ReadResult | null {
    const r = asRecord(value);
    const id = r ? readId(r.id ?? r.read) : null;
    const state = r && READ_STATES.includes(r.state as ReadState) ? r.state as ReadState : null;
    if (!r || !id || !state) return null;
    const d = asRecord(r.doc) ?? {};
    const legible = d.legible === 'partly' || d.legible === 'no' ? d.legible : 'yes';
    const why = READ_WHYS.includes(d.why as ReadWhy) ? d.why as ReadWhy : (legible === 'yes' ? null : 'other');
    const rd = asRecord(r.readers) ?? {};
    const asked = asCount(rd.asked) === 2 ? 2 : 1;
    const pages: ReadPage[] = [];
    for (const [i, item] of (Array.isArray(r.pages) ? r.pages.slice(0, 50) : []).entries()) {
        const p = asRecord(item);
        if (!p) continue;
        const sha = typeof p.sha === 'string' && /^[0-9a-f]{64}$/.test(p.sha) ? p.sha
            : typeof p.file === 'string' && /^[0-9a-f]{64}$/.test(p.file) ? p.file : '';
        pages.push({
            n: asCount(p.n) || i + 1,
            file: typeof p.file === 'string' && /^[IM]\d{1,7}$/.test(p.file) ? p.file : '',
            sha,
            name: cleanText(p.name, 200),
            page: asCount(p.page) || 1,
            w: asCount(p.w) ?? 0,
            h: asCount(p.h) ?? 0,
            image: pageImage(p.image),
        });
    }
    const entries = (Array.isArray(r.entries) ? r.entries.slice(0, 200) : [])
        .map((e, i) => sanitizeEntry(e, i)).filter((e): e is ReadEntry => !!e);
    const c = asRecord(r.cost);
    const amount = c && typeof c.amount === 'number' && Number.isFinite(c.amount) && c.amount >= 0 ? c.amount : null;
    const currency = c && typeof c.currency === 'string' && /^[A-Z]{3}$/.test(c.currency) ? c.currency : '';
    return {
        id, state,
        lang: langList(r.lang)[0] ?? '',
        doc: {
            kind: DOC_KINDS.includes(d.kind as ReadDocKind) ? d.kind as ReadDocKind : 'other',
            language: langList(d.language),
            script: code(d.script),
            date: cleanText(d.date, 80),
            legible, why,
        },
        readers: {
            asked,
            ran: Math.min(asked, asCount(rd.ran) ?? 0),
            agree: rd.agree === 'same' || rd.agree === 'differ' || rd.agree === 'fixed' ? rd.agree : null,
        },
        pages, entries,
        context: cleanBlock(r.context, 5000),
        cost: amount !== null && currency ? { amount, currency, partial: c!.partial === true } : null,
        version: asCount(r.version) || 1,
    };
}

/** A page's image as a full URL at the bridge (`base` = `http://127.0.0.1:<port>/<token>`), or ''. */
export function readPageImageUrl(base: string, page: Pick<ReadPage, 'image'>): string {
    return page.image ? withAppVersion(`${base.replace(/\/+$/, '')}/${page.image}`) : '';
}

/** The year of a document's date ("3. 4. 1846" → "1846"), or ''. */
export function readDocYear(date: string): string {
    return /(?:^|\D)(1[0-9]{3}|20[0-9]{2})(?:\D|$)/.exec(date)?.[1] ?? '';
}

// ==================== Refusals → the app's states ====================

/** What became of a call, by the app's states (§7 of the spec). */
export type ReadFailureKind =
    /** No answer (the research does not run, or the address changed). */
    | 'down'
    /** 503 read.not-ready: `why` (as `accepts.read.why`), `resets`. */
    | 'not-ready'
    /** 503 research.busy: ask again after `retryAfterMs`. */
    | 'research-busy'
    /** 409 read.busy: a reading of this document still runs. */
    | 'read-busy'
    /** 429 read.limit: `per` queue | hour | day, `most`; again after `retryAfterMs`. */
    | 'limit'
    /** 415 read.type: the reader does not read this kind of file (`sha`, `mime`). */
    | 'type'
    /** 415 read.pdf-render / read.heic / read.convert / read.page: a page could not be made. */
    | 'convert'
    /** 413 read.pages: more pages than it reads. */
    | 'pages'
    /** 413 read.large: a file over the limit (`sha`, `mb`). */
    | 'large'
    /** 404/410 read.no-file: the research does not have the file (`sha`). */
    | 'no-file'
    /** 404 read.no-person: the person is not in the research. */
    | 'no-person'
    /** 404 read.none: no such reading (or the research reads nothing for the app: an archive, no agent). */
    | 'none'
    /** 404 read.no-page / 410 read.page-gone. */
    | 'no-page'
    /** 423 locked: the research wrote a newer tree. */
    | 'locked'
    /** 403 app.only, 400 read.bad-body / read.lang / read.region, and an unknown 4xx: the app's own mistake. */
    | 'refused'
    /** 500 read.failed and anything else. */
    | 'failed';

export interface ReadFailure {
    kind: ReadFailureKind;
    /** The bridge's code ('' = none said). */
    code: string;
    /** HTTP status (0 = no answer). */
    status: number;
    /** From `Retry-After` (ms); 0 = not said. */
    retryAfterMs: number;
    why?: string;
    resets?: string;
    per?: 'queue' | 'hour' | 'day';
    most?: number;
    sha?: string;
    mime?: string;
    mb?: number;
}

/** `Retry-After` in ms (seconds or an HTTP date), capped at a day; 0 when absent or bad. */
export function retryAfter(value: string | null, now = Date.now()): number {
    if (!value) return 0;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.min(86_400_000, Math.round(n * 1000));
    const t = Date.parse(value);
    return Number.isFinite(t) ? Math.max(0, Math.min(86_400_000, t - now)) : 0;
}

/** A refusal (HTTP status, its JSON body, `Retry-After`) as the app's state. Status 0: no answer. Untrusted. */
export function readFailure(status: number, body: unknown, retryAfterHeader: string | null = null): ReadFailure {
    const b = asRecord(body);
    const c = b ? code(b.code) : '';
    // Params come in `params` (the bridge's refusals), some bridges put them beside `code`.
    const p = asRecord(b?.params) ?? b ?? {};
    const base: ReadFailure = { kind: 'failed', code: c, status, retryAfterMs: retryAfter(retryAfterHeader) };
    const sha = typeof p.sha === 'string' && /^[0-9a-f]{64}$/.test(p.sha) ? { sha: p.sha } : {};
    if (status === 0) return { ...base, kind: 'down' };
    switch (c) {
        case 'read.not-ready': return { ...base, kind: 'not-ready', why: code(p.why) || 'other', resets: isoTime(p.resets) };
        case 'research.busy': return { ...base, kind: 'research-busy', retryAfterMs: base.retryAfterMs || 5000 };
        case 'read.busy': return { ...base, kind: 'read-busy' };
        case 'read.limit': {
            const per = p.per === 'hour' || p.per === 'day' ? p.per : 'queue';
            const most = asCount(p.most);
            return { ...base, kind: 'limit', per, ...(most ? { most } : {}), retryAfterMs: base.retryAfterMs || 60_000 };
        }
        case 'read.type': return { ...base, kind: 'type', ...sha, mime: typeof p.mime === 'string' ? cleanText(p.mime, 80) : '' };
        case 'read.pdf-render': case 'read.heic': case 'read.convert': case 'read.page': return { ...base, kind: 'convert' };
        case 'read.pages': return { ...base, kind: 'pages' };
        case 'read.large': return { ...base, kind: 'large', ...sha, ...(asCount(p.mb) ? { mb: asCount(p.mb)! } : {}) };
        case 'read.no-file': return { ...base, kind: 'no-file', ...sha };
        case 'read.no-person': return { ...base, kind: 'no-person' };
        case 'read.none': return { ...base, kind: 'none' };
        case 'read.no-page': case 'read.page-gone': return { ...base, kind: 'no-page' };
        case 'locked': return { ...base, kind: 'locked' };
        case 'app.only': case 'read.bad-body': case 'read.lang': case 'read.region': return { ...base, kind: 'refused' };
        case 'read.failed': return base;
    }
    // Without a code of its own: a bridge turning an unknown token down (404 without a body) is not reachable here.
    if (status === 404 && !c) return { ...base, kind: 'down' };
    if (status === 503) return { ...base, kind: 'research-busy', retryAfterMs: base.retryAfterMs || 5000 };
    if (status === 415) return { ...base, kind: 'type', ...sha };
    if (status === 413) return { ...base, kind: 'large', ...sha };
    if (status === 429) return { ...base, kind: 'limit', per: 'queue', retryAfterMs: base.retryAfterMs || 60_000 };
    if (status >= 400 && status < 500) return { ...base, kind: 'refused' };
    return base;
}

// ==================== The bridge's calls ====================

export type ReadReply<T> = { ok: true; value: T } | { ok: false; failure: ReadFailure };

const JSON_TIMEOUT_MS = 15_000;
const PUT_MIN_TIMEOUT_MS = 60_000;

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown; retry: string | null }> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), { mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: ctl?.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok && body && typeof body === 'object') {
            // The research's own words stay out of the UI: in the console only.
            const r = body as Record<string, unknown>;
            console.warn('Reading refused', res.status, r.code, r.error ?? r.text);
        }
        return { status: res.status, body, retry: res.headers.get('Retry-After') };
    } catch (err) {
        console.warn('Reading: no answer', err);
        return { status: 0, body: null, retry: null };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const ok = (status: number) => status >= 200 && status < 300;

/** One page for reading: `PUT media/<sha>` with `X-Strom-Read: 1`. `name` and `person` (REFN) go as headers, `mime` as its type. */
export async function putReadPage(base: string, sha: string, file: Blob, opts: { name?: string; person?: string; mime?: string } = {}): Promise<ReadReply<{ input: string }>> {
    const headers: Record<string, string> = {
        // A HEIC often comes without a type: the one known from its name.
        'Content-Type': opts.mime || file.type || 'application/octet-stream',
        'X-Strom-Read': '1',
        ...(opts.name ? { 'X-Strom-Name': encodeURIComponent(opts.name) } : {}),
        ...(opts.person && researchPersonRef(opts.person) ? { 'X-Strom-Person': opts.person } : {}),
    };
    const r = await call(`${base}/media/${sha}`, { method: 'PUT', headers, body: file }, Math.max(PUT_MIN_TIMEOUT_MS, file.size / 2000));
    if (!ok(r.status)) return { ok: false, failure: readFailure(r.status, r.body, r.retry) };
    const b = asRecord(r.body);
    const input = b && typeof (b.input ?? b.known) === 'string' ? cleanText(b.input ?? b.known, 20) : '';
    return { ok: true, value: { input } };
}

/** What `POST read` takes. */
export interface ReadRequest {
    /** The pages' SHA-256, in order. */
    files: string[];
    readers: 1 | 2;
    lang: string;
    /** The person it is about (REFN), when known. */
    person?: string;
    note?: string;
}

/** The answer to a start, again or cancel: the reading, its state, its version. */
export interface ReadStarted { read: string; state: ReadState; version: number }

function started(body: unknown): ReadStarted | null {
    const b = asRecord(body);
    const read = b ? readId(b.read ?? b.id) : null;
    if (!b || !read) return null;
    return { read, state: READ_STATES.includes(b.state as ReadState) ? b.state as ReadState : 'queued', version: asCount(b.version) || 1 };
}

const postJson = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Start reading (`POST read`). */
export async function startRead(base: string, req: ReadRequest): Promise<ReadReply<ReadStarted>> {
    const body: Record<string, unknown> = { files: req.files, readers: req.readers, lang: req.lang };
    if (req.person && researchPersonRef(req.person)) body.person = req.person;
    const note = req.note === undefined ? undefined : clipText(req.note.trim(), 500);
    if (note) body.note = note;
    const r = await call(`${base}/read`, postJson(body), JSON_TIMEOUT_MS);
    const s = ok(r.status) ? started(r.body) : null;
    return s ? { ok: true, value: s } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/** A reading's result (`GET read/<id>`; partial while it runs). */
export async function fetchReadResult(base: string, id: string): Promise<ReadReply<ReadResult>> {
    const r = await call(`${base}/read/${encodeURIComponent(id)}`, { method: 'GET' }, JSON_TIMEOUT_MS);
    const res = ok(r.status) ? sanitizeReadResult(r.body) : null;
    return res ? { ok: true, value: res } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/**
 * The readings of the research (`GET reads`). A research without a history
 * (an older one: 404 without a code) answers `down`; an archive `none`.
 */
export async function fetchReads(base: string): Promise<ReadReply<ReadHistoryItem[]>> {
    const r = await call(`${base}/reads`, { method: 'GET' }, JSON_TIMEOUT_MS);
    const list = ok(r.status) ? sanitizeReadHistory(r.body) : null;
    return list ? { ok: true, value: list } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/** Read the same pages again, blind (`POST read/<id>/again`). */
export async function readAgain(base: string, id: string, readers?: 1 | 2): Promise<ReadReply<ReadStarted>> {
    const r = await call(`${base}/read/${encodeURIComponent(id)}/again`, postJson(readers ? { readers } : {}), JSON_TIMEOUT_MS);
    const s = ok(r.status) ? started(r.body) : null;
    return s ? { ok: true, value: s } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/**
 * Cancel a reading (`POST read/<id>/cancel`). `cancelled: false`: it had
 * already ended. A cancelled reading-again answers `state: "done"` with the
 * previous version (its result stands).
 */
export async function cancelRead(base: string, id: string): Promise<ReadReply<ReadStarted & { cancelled: boolean }>> {
    const r = await call(`${base}/read/${encodeURIComponent(id)}/cancel`, postJson({}), JSON_TIMEOUT_MS);
    const s = ok(r.status) ? started({ ...(asRecord(r.body) ?? {}), read: asRecord(r.body)?.read ?? id }) : null;
    return s
        ? { ok: true, value: { ...s, cancelled: asRecord(r.body)?.cancelled !== false } }
        : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

// ==================== The files a reading takes ====================

/** Why a file is not taken for reading (it stays in the list, with its reason). */
export type ReadFileRefusal = { kind: 'type'; type: string } | { kind: 'size'; mb: number; maxMb: number } | { kind: 'pages'; pages: number };

/** A file's MIME, from its type or its name (a HEIC often comes without a type). */
export function readFileMime(file: { type: string; name: string }): string {
    if (file.type) return file.type.toLowerCase();
    const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' } as Record<string, string>)[ext] ?? '';
}

/** The short name of a file's kind ("JPEG", "PDF"). */
export function readFileKind(file: { type: string; name: string }): string {
    const mime = readFileMime(file);
    const known: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/heic': 'HEIC', 'image/heif': 'HEIF', 'application/pdf': 'PDF', 'image/tiff': 'TIFF', 'image/webp': 'WEBP' };
    return known[mime] ?? (/\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toUpperCase() ?? (mime.split('/')[1]?.toUpperCase() || '?'));
}

/**
 * Which files are refused and why: a kind it does not read, a file over its
 * size, or a page beyond its count (counted among the files it would take,
 * in order). Null in place of a file: taken.
 */
export function readFileRefusals(files: { type: string; name: string; size: number }[], accepts: Pick<ReadAccepts, 'types' | 'max' | 'pages'>): (ReadFileRefusal | null)[] {
    let taken = 0;
    return files.map(f => {
        const mime = readFileMime(f);
        if (!mime || !accepts.types.includes(mime)) return { kind: 'type', type: readFileKind(f) };
        if (f.size > accepts.max) return { kind: 'size', mb: Math.ceil(f.size / 1024 / 1024 * 10) / 10, maxMb: Math.round(accepts.max / 1024 / 1024) };
        if (taken >= accepts.pages) return { kind: 'pages', pages: accepts.pages };
        taken++;
        return null;
    });
}

/** The usual time a reading takes (minutes): 3 for one reader, 4 for two. */
export function readUsualMinutes(readers: number): number {
    return readers >= 2 ? 4 : 3;
}
