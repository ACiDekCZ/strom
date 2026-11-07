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
import { ResearchWriteHeld, writeHeldOfCode } from './research-write-held.js';
import type { Source } from './types.js';
import { cleanWith, ReadChoices, ReadWho, ReadWithItem, sanitizeReadChoices, sanitizeReadWho } from './read-choices.js';
import {
    READ_PROPOSAL_PATH, READ_TASK_NAMES, readProposalBody, readTaskBody, readTaskId, readTaskPath, readTaskRefusal,
    sanitizeReadTaskReply, sanitizeSourceTaskInfo, sanitizeTaskSetting, sanitizeVariantTask,
} from './research-read-task.js';
import type { ReadProposalTake, ReadSourceTaskInfo, ReadTaskHow, ReadTaskReply, ReadTaskSetting } from './research-read-task.js';

/** `/status.features`: the research reads a document for the app now (`POST read`). */
export const READ_FEATURE = 'read.now';

/** `/status.features`: the research reads a source again from its original (`POST sources/read`, spec 059). */
export const READ_SOURCE_FEATURE = 'read.source';

/** `/status.features`: a source read again says which of its entries are the source's and when its comparison failed (spec 059 K6.4, K6.10). */
export const READ_SOURCE_ENTRY_FEATURE = 'read.sourceEntry';

/** `/status.features`: a reading of two readers carries the second (blind) reader's whole text (spec 059 K6.6). */
export const READ_BLIND_TEXT_FEATURE = 'read.blindText';

/** `/status.features`: a reading of two readers says when they read the document as different kinds (spec 059 K6.10). */
export const READ_KINDS_FEATURE = 'read.kinds';

/** `/status.features`: a difference says its kind (`variants[].kind`: a name, a number, a spelling…; spec 059 P7). */
export const READ_VARIANT_KIND_FEATURE = 'read.variantKind';

/** `/status.features`: a difference says where it lies on the page (`variants[].region`, fractions of the whole page; spec 059 P7). */
export const READ_VARIANT_REGION_FEATURE = 'read.variantRegion';

/** The kinds of a difference the research names (`read.variantKind`); an unknown one is as none. */
export type ReadVariantKind = 'name' | 'number' | 'date' | 'person' | 'spelling' | 'punctuation' | 'label' | 'abbr' | 'case' | 'illegible' | 'other';
export const READ_VARIANT_KINDS: readonly ReadVariantKind[] = ['name', 'number', 'date', 'person', 'spelling', 'punctuation', 'label', 'abbr', 'case', 'illegible', 'other'];

/** `/status.features`: each reader says its own state, and a failed reading which reader failed (spec 059 P7). */
export const READ_READER_STATE_FEATURE = 'read.readerState';

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
    /** How long one reading of one document usually takes here, in seconds (only when ready; absent: an older research). */
    expectSecs?: number;
    /** The readers one may choose (spec 059, only when ready and the bridge says `read.choose`; absent: as before). */
    choices?: ReadChoices;
    /** The research's setting "Task from a new reading" (`read.sourceTask`; absent: not said). */
    sourceTask?: ReadTaskSetting;
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
        ...(ready && expectSecs(r.expectSecs) ? { expectSecs: expectSecs(r.expectSecs)! } : {}),
        // `nowName` kept here; a research without `read.choices.now` has it cleared with the features (readAcceptsGated).
        ...(ready && sanitizeReadChoices(r.choices, true) ? { choices: sanitizeReadChoices(r.choices, true)! } : {}),
        ...(sanitizeTaskSetting(r[READ_TASK_NAMES.acceptsSetting]) ? { sourceTask: sanitizeTaskSetting(r[READ_TASK_NAMES.acceptsSetting])! } : {}),
    };
}

/** `expectSecs`: whole seconds, at least 1 (at most a day), or null. */
function expectSecs(v: unknown): number | null {
    const n = asCount(v);
    return n && n >= 1 ? Math.min(n, 86_400) : null;
}

/** From this many expected seconds a reader counts as slow: the dialog says reading takes several minutes. */
export const READ_SLOW_SECS = 120;

/** A slow reader: `expectSecs` at or above the threshold; an older research (no field) is not. */
export function readSlow(expect: number | null | undefined): boolean {
    return !!expect && expect >= READ_SLOW_SECS;
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
    /** How long it takes from its start, in seconds (only while running; absent: not said). */
    expectSecs?: number;
    /** Who reads it (spec 059; absent: a reading before the research kept it, nothing shown). */
    who?: ReadWho[];
    /** A source read again from its original (`POST sources/read`): the research's source (S…). */
    source?: string;
}

/** The research's id of a source (`S0042`), or null. */
export function readSourceId(value: unknown): string | null {
    return typeof value === 'string' && /^S\d{1,9}$/.test(value) ? value : null;
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
        ...(readRunning(state) && expectSecs(r.expectSecs) ? { expectSecs: expectSecs(r.expectSecs)! } : {}),
        ...(sanitizeReadWho(r.who) ? { who: sanitizeReadWho(r.who)! } : {}),
        ...(readSourceId(r.source) ? { source: readSourceId(r.source)! } : {}),
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

// ==================== The notice when a reading ends ====================

/** What the app keeps of a reading it started (`read.recent`), as far as its notice goes. */
export interface ReadMemo {
    id: string;
    /** Its result (or why not) was shown: no notice any more. */
    opened: boolean;
    /** Its end was announced (or passed over): no notice again, not after a restart either. */
    announced: boolean;
    /** Its pages' SHA-256s, comma-joined ('' = not known): the same document read again has the same. */
    doc: string;
}

/** Two readings of the same document: the same pages, or (pages not known) the same first file and page count. */
function sameDocument(a: LiveRead, am: ReadMemo, b: LiveRead, bm: ReadMemo): boolean {
    if (am.doc && bm.doc) return am.doc === bm.doc;
    return !!a.name && a.name === b.name && a.pages === b.pages;
}

/** `a` was asked for after `b`. */
function askedLater(a: LiveRead, b: LiveRead): boolean {
    if (a.at && b.at && a.at !== b.at) return a.at > b.at;
    return a.id > b.id;
}

/** A newer reading of the same document stands over this one (one cancelled does not). */
export function readSuperseded(r: LiveRead, reads: ReadonlyMap<string, LiveRead>, memos: readonly ReadMemo[]): boolean {
    const m = memos.find(x => x.id === r.id);
    if (!m) return false;
    return [...reads.values()].some(o => {
        const om = o.id !== r.id && o.state !== 'cancelled' ? memos.find(x => x.id === o.id) : undefined;
        return !!om && askedLater(o, r) && sameDocument(o, om, r, m);
    });
}

/**
 * Which ends of the app's readings to announce now. A notice comes once in a
 * reading's life: when it ends while the app follows it, or at the first
 * status after it ended with the app closed; never for one announced or opened
 * before (a restart, a reload). Of one document read more than once only the
 * newest says how it ended (a cancelled newer reading leaves the older one's
 * word). `settle`: ends passed over, to be remembered as announced; `rearm`:
 * readings seen running again, due a notice when they end.
 */
export function readEndsToAnnounce(
    reads: ReadonlyMap<string, LiveRead>, prev: ReadonlyMap<string, LiveRead>, memos: readonly ReadMemo[], shownId = '',
): { announce: LiveRead[]; settle: string[]; rearm: string[] } {
    const memo = new Map(memos.map(m => [m.id, m]));
    const announce: LiveRead[] = [];
    const settle: string[] = [];
    const rearm: string[] = [];
    for (const r of reads.values()) {
        const m = memo.get(r.id);
        if (!m || m.opened || r.id === shownId) continue;
        if (readRunning(r.state)) {
            if (m.announced) rearm.push(r.id);
            continue;
        }
        const before = prev.get(r.id);
        if (m.announced || (before && !readRunning(before.state))) continue;
        if (readSuperseded(r, reads, memos)) settle.push(r.id);
        else announce.push(r);
    }
    return { announce, settle, rearm };
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
    /** Who read, in the readers' order (spec 059; absent: a reading before it, nothing shown). */
    who?: ReadWho[];
    /** The two readers read the document as different kinds (`read.kinds`; absent: the same, or one said none). */
    kinds?: { first: ReadDocKind; blind: ReadDocKind };
}

/**
 * A source read again from its original (`POST sources/read`): the new
 * reading held against the source's transcript. `variants`: `at` the
 * transcript's words, `other` the new reading's. A difference is a task of
 * the research (`task`, T…), never a conflict: the transcript does not change.
 */
export interface ReadSourceResult extends Partial<ReadSourceTaskInfo> {
    id: string;
    agree: 'same' | 'differ';
    variants: ReadVariant[];
    /** The task where they differ ('' none). */
    task: string;
}

/** Why a source read again was not compared or not written (`read.sourceEntry`). */
export type ReadSourceFailCode = 'no-entry' | 'no-source' | 'write' | 'other';
const SOURCE_FAIL_CODES: readonly ReadSourceFailCode[] = ['no-entry', 'no-source', 'write', 'other'];

/**
 * A source read again as the research says it since `read.sourceEntry`, beside `source` (which keeps its
 * meaning: only a comparison made): the entries of the result that are the source's own (the others are
 * neighbours at the excerpt's edge) and why the comparison failed (`write`: compared, not written; the
 * others: not compared, `source` then absent).
 */
export interface ReadSourceRead {
    id: string;
    /** Ids of `entries` that are the source's entry (at most one per view); [] none said. */
    entries: string[];
    failed: ReadSourceFailCode | null;
}

/** The second (blind) reader's entry (`read.blindText`): its whole transcription, and which entry of reader 1 it was compared with. */
export interface ReadBlindEntry {
    id: string;
    page: number;
    region: ReadRegion | null;
    /** Literal, with the same marks as reader 1's. */
    transcript: string;
    /** The id of reader 1's entry it was compared with ('' an entry only reader 2 read). */
    of: string;
}

/** What the second reader read (`read.blindText`): how it saw the document, its entries in its order. */
export interface ReadBlind {
    doc: { kind: ReadDocKind | null };
    entries: ReadBlindEntry[];
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
    /** Only this part of the page was read (fractions of the whole page); null = the whole page. */
    region: ReadRegion | null;
    /** The page as JPEG, relative to the bridge's `<base>/` ("read/<id>/page/<n>.jpg"); '' = none. */
    image: string;
}

/**
 * Where the two readers differ: `at` the first reader's text, `other` the blind one's. `field` (research 2026-10):
 * what differs, "transcript" (words of the transcription), "p2.surname" / "p2.given" / "p2.role" (a person's name
 * or role), "p2" (a person only the first reader has), "person" (one only the blind reader has), "entry", "birth.date"…;
 * none from an older research (then a transcription's words).
 */
export interface ReadVariant {
    at: string;
    other: string;
    field?: string;
    /** The kind of the difference (`read.variantKind`; absent: not said, the app classifies it). */
    kind?: ReadVariantKind;
    /** Where it lies on the page, fractions of the whole page (`read.variantRegion`; absent: not said). */
    region?: ReadRegion;
    /** A source read again (`read.sourceTask`): false = the readers disagree here, not a sure change; absent: not said. */
    sure?: boolean;
    /** A source read again (`read.sourceTask`): the task that already assessed this place (T…); absent: none. */
    judged?: string;
}

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
    /** A source read again: how the new reading compares with its transcript (only once it is compared). */
    source?: ReadSourceResult;
    /** A source read again: its own entries and a failed comparison (`read.sourceEntry`; absent: none said). */
    sourceRead?: ReadSourceRead;
    /** The second reader's own text (`read.blindText`; absent: none). */
    blind?: ReadBlind;
    /** A failed reading: why, in the research's own sentence (`failure`, code `model`: its agent refused the model); absent: none said. */
    readerFailure?: ReadReaderFailure;
}

/** Why a reading failed, said by the research for the person (`failure` of `GET read/<id>`). */
export interface ReadReaderFailure {
    /** `model`: a reader's agent refused its model (Codex: one its installed CLI does not have); another code: a failure the app has no words of its own for. */
    code: string;
    /** The research's sentence in its language (what to do included). */
    text: string;
    /**
     * Which reader failed (`read.readerState`, with `code: model`); absent: not known, or both. A reading where
     * the other reader finished is not failed: it ends done as a reading of one reader (its `who` says the failed one).
     */
    reader?: 1 | 2;
}

/** `failure` of a failed reading: a code with its sentence, or null. Untrusted. */
function sanitizeReaderFailure(v: unknown, state: string): ReadReaderFailure | null {
    const f = asRecord(v);
    if (!f || state !== 'failed') return null;
    const c = code(f.code);
    const text = cleanText(f.text, 400);
    if (!c || !text) return null;
    return {
        code: c, text,
        // Which reader is said only with a refused model.
        ...(c === 'model' && (f.reader === 1 || f.reader === 2) ? { reader: f.reader } : {}),
    };
}

/**
 * The failure as the app may show it: without `read.readerState` only a
 * refused model (`code: model`), without which reader; with it, any code
 * (an unknown one is a failure in general).
 */
export function readFailureShown(f: ReadReaderFailure | undefined, readerState: boolean): ReadReaderFailure | null {
    if (!f) return null;
    if (readerState) return f;
    return f.code === 'model' ? { code: 'model', text: f.text } : null;
}

/**
 * A reading done by one reader because the other one could not read (`read.readerState`): the
 * failed reader's number, else null. Its text then has no check of a second reader.
 */
export function readOneReaderFailed(res: Pick<ReadResult, 'state' | 'readers'> | null | undefined, readerState: boolean): 1 | 2 | null {
    const who = res?.readers.who;
    if (!readerState || res?.state !== 'done' || !who || who.length < 2) return null;
    const failed = who.findIndex(w => w.state === 'failed');
    if (failed < 0 || !who.some((w, i) => i !== failed && w.state === 'done')) return null;
    return failed === 0 ? 1 : 2;
}

/** `source` of a result: the comparison with the source's transcript, or null. Untrusted. */
function sanitizeSourceResult(v: unknown, read = ''): ReadSourceResult | null {
    const s = asRecord(v);
    const id = s ? readSourceId(s.id) : null;
    if (!s || !id || (s.agree !== 'same' && s.agree !== 'differ')) return null;
    const variants: ReadVariant[] = [];
    for (const item of Array.isArray(s.variants) ? s.variants.slice(0, 200) : []) {
        const x = asRecord(item);
        if (!x) continue;
        const at = cleanText(x.at, 500);
        const other = cleanText(x.other, 500);
        if (at || other) variants.push({ at, other, ...variantExtras(x) });
    }
    const task = readTaskId(s.task);
    const info = sanitizeSourceTaskInfo(s, read);
    return { id, agree: s.agree, variants: s.agree === 'same' ? [] : variants, task: s.agree === 'differ' ? task : '', ...(info ?? {}) };
}

/** `source.entries` and `source.failed` (`read.sourceEntry`): only entries of the result, a known code; null when neither. Untrusted. */
function sanitizeSourceRead(v: unknown, entryIds: ReadonlySet<string>): ReadSourceRead | null {
    const s = asRecord(v);
    const id = s ? readSourceId(s.id) : null;
    if (!s || !id) return null;
    const entries: string[] = [];
    for (const e of Array.isArray(s.entries) ? s.entries.slice(0, 50) : []) {
        const ref = localRef(e);
        if (ref && entryIds.has(ref) && !entries.includes(ref)) entries.push(ref);
    }
    const f = asRecord(s.failed);
    const failed = f ? SOURCE_FAIL_CODES.includes(f.code as ReadSourceFailCode) ? f.code as ReadSourceFailCode : 'other' : null;
    return entries.length || failed ? { id, entries, failed } : null;
}

/** `blind` (`read.blindText`): reader 2's entries, `of` only an entry of the result. Null without any. Untrusted. */
function sanitizeBlind(v: unknown, entryIds: ReadonlySet<string>): ReadBlind | null {
    const b = asRecord(v);
    if (!b) return null;
    const d = asRecord(b.doc);
    const entries: ReadBlindEntry[] = [];
    const ids = new Set<string>();
    for (const [i, item] of (Array.isArray(b.entries) ? b.entries.slice(0, 200) : []).entries()) {
        const e = asRecord(item);
        const transcript = e ? cleanBlock(e.transcript) : '';
        if (!e || !transcript) continue;
        let id = localRef(e.id) || `b${i + 1}`;
        if (ids.has(id)) id = `b${i + 1}`;
        if (ids.has(id)) continue;
        ids.add(id);
        const of = localRef(e.of);
        entries.push({ id, page: Math.max(1, asCount(e.page) ?? 1), region: region(e.region), transcript, of: of && entryIds.has(of) ? of : '' });
    }
    if (!entries.length) return null;
    return { doc: { kind: d && DOC_KINDS.includes(d.kind as ReadDocKind) ? d.kind as ReadDocKind : null }, entries };
}

/** `readers.kinds` (`read.kinds`): two known kinds that differ, else null. Untrusted. */
function sanitizeKinds(v: unknown): { first: ReadDocKind; blind: ReadDocKind } | null {
    const k = asRecord(v);
    const first = k && DOC_KINDS.includes(k.first as ReadDocKind) ? k.first as ReadDocKind : null;
    const blind = k && DOC_KINDS.includes(k.blind as ReadDocKind) ? k.blind as ReadDocKind : null;
    return first && blind && first !== blind ? { first, blind } : null;
}

/** A difference's `kind` and `region`, where known and valid (an unknown kind, a broken region: left out). Untrusted. */
function variantExtras(x: Record<string, unknown>): { kind?: ReadVariantKind; region?: ReadRegion; sure?: boolean; judged?: string } {
    const kind = READ_VARIANT_KINDS.includes(x.kind as ReadVariantKind) ? x.kind as ReadVariantKind : null;
    const r = region(x.region);
    return { ...(kind ? { kind } : {}), ...(r && r[2] > 0 && r[3] > 0 ? { region: r } : {}), ...sanitizeVariantTask(x) };
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
        const field = r && typeof r.field === 'string' ? cleanText(r.field, 40) : '';
        const other = r ? cleanText(r.other, 300) : '';
        // A side one reader left out stays a place (only reader 2 read something there: `at` empty).
        if (r && (at || other)) variants.push({ at, other, ...(field ? { field } : {}), ...variantExtras(r) });
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
            region: region(p.region),
            image: pageImage(p.image),
        });
    }
    const entries = (Array.isArray(r.entries) ? r.entries.slice(0, 200) : [])
        .map((e, i) => sanitizeEntry(e, i)).filter((e): e is ReadEntry => !!e);
    const entryIds = new Set(entries.map(e => e.id));
    const sourceRead = sanitizeSourceRead(r.source, entryIds);
    const blind = sanitizeBlind(r.blind, entryIds);
    const kinds = asked === 2 ? sanitizeKinds(rd.kinds) : null;
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
            ...(sanitizeReadWho(rd.who) ? { who: sanitizeReadWho(rd.who)! } : {}),
            ...(kinds ? { kinds } : {}),
        },
        pages, entries,
        context: cleanBlock(r.context, 5000),
        cost: amount !== null && currency ? { amount, currency, partial: c!.partial === true } : null,
        version: asCount(r.version) || 1,
        ...(sanitizeSourceResult(r.source, id) ? { source: sanitizeSourceResult(r.source, id)! } : {}),
        ...(sourceRead ? { sourceRead } : {}),
        ...(blind ? { blind } : {}),
        ...(sanitizeReaderFailure(r.failure, state) ? { readerFailure: sanitizeReaderFailure(r.failure, state)! } : {}),
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
    /** 409 seal.foreign / tree.not-downloaded, 507 disk.full: held until it is settled in the research (`held`, 017 U7). */
    | 'held'
    /** 400 read.with: a reader's choice the research does not offer (any more): reader `at`, `field`. */
    | 'with'
    /** 409 read.agent: reader `at`'s agent cannot read now (`agent`, `why` limit | auth, `resets`); nothing started. */
    | 'agent'
    /** 404 read.source.none: the research has no such source (`source`). */
    | 'source-none'
    /** 409 read.source.notext: the source has no transcript to compare a new reading with. */
    | 'source-notext'
    /** 409 read.source.noscan: no original of the source (or of its excerpt `clip`) on the research's computer. */
    | 'source-noscan'
    /** 409 read.source.running: the source is being read again now (`read`: that reading). */
    | 'source-running'
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
    /** `held`: what holds it, with the research's sentence (its language, shown as it is). */
    held?: ResearchWriteHeld;
    /** `with` / `agent`: the reader (0 the first, 1 the blind one). */
    at?: number;
    /** `with`: what of the reader is not offered. */
    field?: 'agent' | 'model' | 'effort';
    /** `agent`: the agent that cannot read now. */
    agent?: string;
    /** `source-*`: the source (S…). */
    source?: string;
    /** `source-noscan`: the excerpt without an original. */
    clip?: string;
    /** `source-running`: the reading of the source under way. */
    read?: string;
    /**
     * `down` of a start (`POST read`, `read/<id>/again`, `sources/read`) whose answer did not come in time:
     * the bridge may still have taken the reading (a busy bridge takes it late), so it is not a bridge that is not running.
     */
    late?: boolean;
}

/** `Retry-After` in ms (seconds or an HTTP date), capped at a day; 0 when absent or bad. */
export function retryAfter(value: string | null, now = Date.now()): number {
    if (!value) return 0;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.min(86_400_000, Math.round(n * 1000));
    const t = Date.parse(value);
    return Number.isFinite(t) ? Math.max(0, Math.min(86_400_000, t - now)) : 0;
}

/** A reader's index in a refusal (`at`: "0" | "1", or a number). */
function readerAt(v: unknown): { at?: number } {
    const n = typeof v === 'string' && /^[01]$/.test(v) ? Number(v) : v === 0 || v === 1 ? v : null;
    return n === null ? {} : { at: n };
}

function sourceOf(p: Record<string, unknown>): { source?: string } {
    const source = readSourceId(p.source);
    return source ? { source } : {};
}

/** An excerpt's mark the research reads again by (`_STROM_CLIP`: `c` + 10 hex, or `input`). */
export const READ_CLIP = /^(?:c[0-9a-f]{10}|input)$/;

/** A refusal (HTTP status, its JSON body, `Retry-After`) as the app's state. Status 0: no answer. Untrusted. */
export function readFailure(status: number, body: unknown, retryAfterHeader: string | null = null): ReadFailure {
    const b = asRecord(body);
    const c = b ? code(b.code) : '';
    // Params come in `params` (the bridge's refusals), some bridges put them beside `code`.
    const p = asRecord(b?.params) ?? b ?? {};
    const base: ReadFailure = { kind: 'failed', code: c, status, retryAfterMs: retryAfter(retryAfterHeader) };
    const sha = typeof p.sha === 'string' && /^[0-9a-f]{64}$/.test(p.sha) ? { sha: p.sha } : {};
    if (status === 0) return { ...base, kind: 'down' };
    const held = status === 409 || status === 507 ? writeHeldOfCode(c, b?.error, b?.params) : null;
    if (held) return { ...base, kind: 'held', held };
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
        case 'read.with': {
            const field = p.field === 'agent' || p.field === 'model' || p.field === 'effort' ? { field: p.field as 'agent' | 'model' | 'effort' } : {};
            return { ...base, kind: 'with', ...readerAt(p.at), ...field };
        }
        case 'read.agent': {
            const agent = typeof p.agent === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(p.agent) ? { agent: p.agent } : {};
            return { ...base, kind: 'agent', ...readerAt(p.at), ...agent, why: code(p.why) || 'other', resets: isoTime(p.resets) };
        }
        case 'read.source.none': return { ...base, kind: 'source-none', ...sourceOf(p) };
        case 'read.source.notext': return { ...base, kind: 'source-notext', ...sourceOf(p) };
        case 'read.source.noscan': {
            const clip = typeof p.clip === 'string' && READ_CLIP.test(p.clip) ? { clip: p.clip } : {};
            return { ...base, kind: 'source-noscan', ...sourceOf(p), ...clip };
        }
        case 'read.source.running': {
            const read = readId(p.read) ?? readId(b?.read);
            return { ...base, kind: 'source-running', ...sourceOf(p), ...(read ? { read } : {}) };
        }
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

/** How long a JSON call waits for the bridge (tests shorten it with `__STROM_READ_TIMEOUT_MS`). */
function jsonTimeoutMs(): number {
    const t = (globalThis as { __STROM_READ_TIMEOUT_MS?: unknown }).__STROM_READ_TIMEOUT_MS;
    return typeof t === 'number' && t > 0 ? t : JSON_TIMEOUT_MS;
}

/** A call's answer; `late`: none came in time (the call was given up, the bridge may still act on it). */
interface CallReply { status: number; body: unknown; retry: string | null; late?: boolean }

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<CallReply> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let late = false;
    const timer = ctl ? setTimeout(() => { late = true; ctl.abort(); }, timeoutMs) : null;
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
        return { status: 0, body: null, retry: null, ...(late ? { late: true } : {}) };
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
    /** Who reads (spec 059, `readWith`): only when a reader differs from the default. */
    with?: ReadWithItem[];
}

/** The answer to a start, again or cancel: the reading, its state, its version (and a source read again: its id). */
export interface ReadStarted { read: string; state: ReadState; version: number; source?: string }

function started(body: unknown): ReadStarted | null {
    const b = asRecord(body);
    const read = b ? readId(b.read ?? b.id) : null;
    if (!b || !read) return null;
    const source = readSourceId(b.source);
    return { read, state: READ_STATES.includes(b.state as ReadState) ? b.state as ReadState : 'queued', version: asCount(b.version) || 1, ...(source ? { source } : {}) };
}

/** `with` into a request body (nothing when every reader reads as by default). */
function putWith(body: Record<string, unknown>, value: readonly ReadWithItem[] | undefined, readers: number): void {
    const w = cleanWith(value, readers);
    if (w) body.with = w;
}

/** A start's answer: the reading, or why not (`late`: no answer in time, the bridge may have taken it). */
function startReply(r: CallReply): ReadReply<ReadStarted> {
    const s = ok(r.status) ? started(r.body) : null;
    if (s) return { ok: true, value: s };
    const failure = readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry);
    return { ok: false, failure: r.late && failure.kind === 'down' ? { ...failure, late: true } : failure };
}

const postJson = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Start reading (`POST read`). */
export async function startRead(base: string, req: ReadRequest): Promise<ReadReply<ReadStarted>> {
    const body: Record<string, unknown> = { files: req.files, readers: req.readers, lang: req.lang };
    if (req.person && researchPersonRef(req.person)) body.person = req.person;
    const note = req.note === undefined ? undefined : clipText(req.note.trim(), 500);
    if (note) body.note = note;
    putWith(body, req.with, req.readers);
    const r = await call(`${base}/read`, postJson(body), jsonTimeoutMs());
    return startReply(r);
}

/** A reading's result (`GET read/<id>`; partial while it runs). */
export async function fetchReadResult(base: string, id: string): Promise<ReadReply<ReadResult>> {
    const r = await call(`${base}/read/${encodeURIComponent(id)}`, { method: 'GET' }, jsonTimeoutMs());
    const res = ok(r.status) ? sanitizeReadResult(r.body) : null;
    return res ? { ok: true, value: res } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/**
 * The readings of the research (`GET reads`). A research without a history
 * (an older one: 404 without a code) answers `down`; an archive `none`.
 */
export async function fetchReads(base: string): Promise<ReadReply<ReadHistoryItem[]>> {
    const r = await call(`${base}/reads`, { method: 'GET' }, jsonTimeoutMs());
    const list = ok(r.status) ? sanitizeReadHistory(r.body) : null;
    return list ? { ok: true, value: list } : { ok: false, failure: readFailure(ok(r.status) ? 500 : r.status, r.body, r.retry) };
}

/** Read the same pages again, blind (`POST read/<id>/again`); `withReaders` only when a reader differs from the default. */
export async function readAgain(base: string, id: string, readers?: 1 | 2, withReaders?: ReadWithItem[]): Promise<ReadReply<ReadStarted>> {
    const body: Record<string, unknown> = readers ? { readers } : {};
    putWith(body, withReaders, readers ?? 2);
    const r = await call(`${base}/read/${encodeURIComponent(id)}/again`, postJson(body), jsonTimeoutMs());
    return startReply(r);
}

/** What `POST sources/read` takes: a source of the research read again from its original. */
export interface ReadSourceRequest {
    /** The research's source (S…). */
    source: string;
    /** One excerpt of it alone (`_STROM_CLIP`); none: the whole entry. */
    clip?: string;
    readers: 1 | 2;
    /** The language of translation and explanation; none: the research's. */
    lang?: string;
    with?: ReadWithItem[];
    /** The app chooses who creates the task (`read.sourceTask`): sent only when the research says the feature. */
    taskChoice?: boolean;
}

/**
 * Read a source again from its original (`POST sources/read`, feature
 * `read.source`): 202 → the reading, followed like any other. Its result
 * says how it compares with the transcript (`ReadResult.source`).
 */
export async function startSourceRead(base: string, req: ReadSourceRequest): Promise<ReadReply<ReadStarted>> {
    const source = readSourceId(req.source);
    if (!source) return { ok: false, failure: readFailure(400, { code: 'read.bad-body' }) };
    const body: Record<string, unknown> = { source, readers: req.readers };
    if (req.clip && READ_CLIP.test(req.clip)) body.clip = req.clip;
    if (req.lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(req.lang)) body.lang = req.lang;
    putWith(body, req.with, req.readers);
    if (req.taskChoice === true) body[READ_TASK_NAMES.choice] = true;
    const r = await call(`${base}/sources/read`, postJson(body), jsonTimeoutMs());
    return startReply(r);
}

/**
 * What the app chose after a source was read again (`read.sourceTask`):
 * `POST sources/<S>/read/<D>/task {how}`. The one call for the dialog's
 * footer and the source's row. A call without an answer in time is a failure.
 */
export async function postReadTask(base: string, source: string, read: string, how: ReadTaskHow): Promise<ReadReply<ReadTaskReply>> {
    const s = readSourceId(source);
    const d = readId(read);
    if (!s || !d) return { ok: false, failure: readFailure(400, { code: 'read.bad-body' }) };
    const r = await call(`${base}${readTaskPath(s, d)}`, postJson(readTaskBody(how)), jsonTimeoutMs());
    if (!ok(r.status)) {
        // A task already holds the places, or nothing is left to decide: an answer, not a failure.
        const answer = readTaskRefusal(r.status, r.body);
        return answer ? { ok: true, value: answer } : { ok: false, failure: readFailure(r.status, r.body, r.retry) };
    }
    return { ok: true, value: sanitizeReadTaskReply(r.body) };
}

/** The answer to the agent's proposal for a source (`POST sources/proposal {source, task, take}`); the answer's body, as the research gives it. */
export async function postReadProposal(base: string, source: string, task: string, take: ReadProposalTake): Promise<ReadReply<Record<string, unknown> | null>> {
    const s = readSourceId(source);
    const tk = readTaskId(task);
    if (!s || !tk) return { ok: false, failure: readFailure(400, { code: 'read.bad-body' }) };
    const r = await call(`${base}${READ_PROPOSAL_PATH}`, postJson(readProposalBody(s, tk, take)), jsonTimeoutMs());
    if (!ok(r.status)) return { ok: false, failure: readFailure(r.status, r.body, r.retry) };
    return { ok: true, value: asRecord(r.body) };
}

/**
 * Whether "Read again…" is offered for a source: the bridge reads sources
 * again (`read.source`) and reads now (`accepts.read.ready`), and the
 * research's file says it has the source's original (`_STROM_ORIG Y`) — with
 * the source's id there (REFN S…) and a transcript to compare with.
 */
export function readSourceAgainOffered(
    status: { features: readonly string[] | null; accepts: { read?: Pick<ReadAccepts, 'ready'> } | null } | null | undefined,
    src: Pick<Source, 'originalInResearch' | 'refn' | 'transcript'> | null | undefined,
): boolean {
    if (!status?.features?.includes(READ_SOURCE_FEATURE) || status.accepts?.read?.ready !== true) return false;
    return readSourceAgainCandidate(src);
}

/**
 * The source itself could be read again: the research's file says it has its
 * original (`_STROM_ORIG Y`), with the source's id there (REFN S…) and a
 * transcript to compare with. On a phone, where the bridge is not reached,
 * this alone decides the sentence saying where reading again works.
 */
export function readSourceAgainCandidate(src: Pick<Source, 'originalInResearch' | 'refn' | 'transcript'> | null | undefined): boolean {
    return !!src?.originalInResearch && !!readSourceId(src.refn?.trim()) && !!src.transcript?.trim();
}

/**
 * The excerpt mark to read again by: the excerpt's own `clip` when the source
 * has no other excerpt of the research; a source of several excerpts is read
 * whole (a single excerpt would be compared with the whole transcript, so
 * the words of the others would come out as differences). None: whole.
 */
export function readSourceAgainClip(src: Pick<Source, 'excerpts'>, excerptId?: string): string | undefined {
    if (!excerptId) return undefined;
    const clipped = (src.excerpts ?? []).filter(e => !!e.clip && READ_CLIP.test(e.clip));
    const one = clipped.find(e => e.id === excerptId);
    return one && clipped.length === 1 ? one.clip : undefined;
}

/**
 * Cancel a reading (`POST read/<id>/cancel`). `cancelled: false`: it had
 * already ended. A cancelled reading-again answers `state: "done"` with the
 * previous version (its result stands).
 */
export async function cancelRead(base: string, id: string): Promise<ReadReply<ReadStarted & { cancelled: boolean }>> {
    const r = await call(`${base}/read/${encodeURIComponent(id)}/cancel`, postJson({}), jsonTimeoutMs());
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

/**
 * The sheet a view of a reading shows: its file (sha, else the research's id) and the page within it.
 * Two views of one sheet are two parts (regions) of the same picture.
 */
function readSheetKey(p: Pick<ReadPage, 'n' | 'file' | 'sha' | 'page'>): string {
    return `${p.sha || p.file || `#${p.n}`}:${p.page}`;
}

/** Whether two views of a reading show the same picture (the same file and page). */
export function readSameSheet(a: Pick<ReadPage, 'n' | 'file' | 'sha' | 'page'>, b: Pick<ReadPage, 'n' | 'file' | 'sha' | 'page'>): boolean {
    return readSheetKey(a) === readSheetKey(b);
}

/**
 * What each view of a reading is called: `sheet` its page among the document's different pictures (1-based),
 * `part` its number among the parts (regions) read of that same picture, 0 when it is the only view of it
 * or shows the whole picture. Two parts of one page are "Excerpt 1 / 2", not "Page 1 / 2".
 */
export function readViewNames(pages: readonly Pick<ReadPage, 'n' | 'file' | 'sha' | 'page' | 'region'>[]): { sheet: number; part: number; sheets: number }[] {
    const sheets: string[] = [];
    const parts = new Map<string, number>();
    for (const p of pages) {
        const key = readSheetKey(p);
        if (!sheets.includes(key)) sheets.push(key);
        if (p.region) parts.set(key, (parts.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return pages.map(p => {
        const key = readSheetKey(p);
        let part = 0;
        if (p.region && (parts.get(key) ?? 0) >= 2) {
            part = (seen.get(key) ?? 0) + 1;
            seen.set(key, part);
        }
        return { sheet: sheets.indexOf(key) + 1, part, sheets: sheets.length };
    });
}

/** One reader as the pace of a reading counts it ('' model / effort: as the agent itself is set). */
export interface ReadPaceReader { agent: string; model: string; effort: string }

/** The readings a pace is learned from: the last so many that ended with a reader alike. */
const PACE_LAST = 9;
/** A reading longer than this is no reader's pace (a clock gone wrong, a computer asleep). */
const PACE_MAX_SECS = 86_400;

const paceAlike = (a: ReadPaceReader, b: ReadPaceReader): boolean =>
    a.agent === b.agent && (!a.model || !b.model || a.model === b.model) && (!a.effort || !b.effort || a.effort === b.effort);

function median(list: number[]): number {
    const v = [...list].sort((a, b) => a - b);
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * How long a reading is expected to take (seconds): its slowest reader's pace. Each reader by agent, model
 * and effort: from the readings of this research that ended (`history`: from asking to done, so never too
 * short) — those read by that reader alone first, else those it read with another (the slower one's time,
 * an upper bound); the agent whose pace the research itself measures (`measured`, the first reader's) by the
 * research's `expectSecs` before that (not said: the usual time). Null: a reader's pace is not known (another agent, never read here) —
 * then no time is said rather than one too short. No readers said (an older research): the research's word
 * (none: 0, the usual time).
 */
export function readPaceSecs(readers: readonly ReadPaceReader[] | null | undefined, o: {
    expectSecs?: number | null;
    measured?: string;
    history?: readonly Pick<LiveRead, 'id' | 'state' | 'at' | 'since' | 'who'>[];
    except?: string;
}): number | null {
    if (!readers?.length) return o.expectSecs ?? 0;
    const ended = (o.history ?? [])
        .filter(r => r.state === 'done' && r.id !== o.except && r.who?.length)
        .map(r => ({ who: r.who!.filter(w => w.ran), secs: (Date.parse(r.since) - Date.parse(r.at)) / 1000, at: r.at }))
        .filter(r => r.who.length && Number.isFinite(r.secs) && r.secs > 0 && r.secs <= PACE_MAX_SECS)
        .sort((a, b) => b.at.localeCompare(a.at));
    let slowest = 0;
    for (const reader of readers) {
        const alone = ended.filter(r => r.who.every(w => paceAlike(w, reader))).slice(0, PACE_LAST);
        const along = ended.filter(r => r.who.some(w => paceAlike(w, reader))).slice(0, PACE_LAST);
        const mine = reader.agent === o.measured;
        const secs = mine && o.expectSecs ? o.expectSecs
            : alone.length ? median(alone.map(r => r.secs))
                : along.length ? median(along.map(r => r.secs))
                    // the research's own agent, its pace not said (an older research): the usual time
                    : mine ? 0 : null;
        if (secs === null) return null;
        slowest = Math.max(slowest, secs);
    }
    return Math.round(slowest);
}

/** The usual time a reading takes (minutes): 3 for one reader, 4 for two. */
export function readUsualMinutes(readers: number, expect?: number | null): number {
    const usual = readers >= 2 ? 4 : 3;
    // A slower reader than usual: its own expected time, rounded up to whole minutes.
    return expect ? Math.max(usual, Math.ceil(expect / 60)) : usual;
}
