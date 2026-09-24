/**
 * Opening a research from Strom Research (the command-line research tool) —
 * the pure, testable half: recognising its GEDCOM header, deciding whether an
 * open creates a tree, updates one or has to ask, keeping person ids stable
 * across updates, and accepting bridge addresses on this computer only.
 *
 * The UI half (file handler, ?import-url, drag & drop, the live bridge) lives
 * in src/ui/research-ui.ts. Nothing here touches the DOM or storage.
 */

import { StromData, PersonId, ResearchLink } from './types.js';

/** `1 SOUR` value that marks a file written by Strom Research. */
export const STROM_RESEARCH_SOURCE = 'STROM_RESEARCH';
/** Header tag carrying the research tree's UUID: `1 _STROM_TREE <uuid>`. */
export const STROM_TREE_TAG = '_STROM_TREE';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longest tree name taken from a file or a bridge (longer is cut). */
const MAX_NAME = 120;
/** Longest bridge text shown (a task, a change, a name). */
const MAX_TEXT = 300;
/** Most list items taken from one bridge message. */
const MAX_ITEMS = 50;

/** What the GEDCOM header says about where the file comes from. */
export interface ResearchHeader {
    /** `1 SOUR STROM_RESEARCH` — written by Strom Research. */
    isStromResearch: boolean;
    /** The research tree's UUID (lower case); only for Strom Research files. */
    treeId: string | null;
    /** Tree name: the first line of the header `1 NOTE`. */
    name: string | null;
    /** The header `1 DATE` (when the file was written), raw GEDCOM. */
    date: string | null;
}

/** Normalise a research UUID (lower case), or null when it is not one. */
export function normalizeResearchId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** Plain one-line text: control characters out, whitespace collapsed, capped. */
export function cleanText(value: unknown, max = MAX_TEXT): string {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * Read the `0 HEAD` record of a GEDCOM text. Only the header is looked at; the
 * records themselves go through the normal importer.
 */
export function readResearchHeader(text: string): ResearchHeader {
    const none: ResearchHeader = { isStromResearch: false, treeId: null, name: null, date: null };
    if (typeof text !== 'string') return none;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = body.split(/\r\n|\r|\n/);

    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || !/^0\s+HEAD\b/.test(lines[i].trim())) return none;

    let source = '';
    let treeRaw: string | null = null;
    let date: string | null = null;
    let noteLines: string[] | null = null;
    let inFirstNote = false;

    for (i = i + 1; i < lines.length; i++) {
        const m = /^\s*(\d+)\s+(@[^@]+@\s+)?(\S+)(?: (.*))?$/.exec(lines[i]);
        if (!m) continue;
        const level = Number(m[1]);
        const tag = m[3].toUpperCase();
        const value = m[4] ?? '';
        if (level === 0) break;
        if (level === 1) {
            inFirstNote = false;
            if (tag === 'SOUR') source = value.trim();
            else if (tag === STROM_TREE_TAG) treeRaw = value;
            else if (tag === 'DATE') date = value.trim() || null;
            else if (tag === 'NOTE' && noteLines === null) {
                noteLines = [value];
                inFirstNote = true;
            }
        } else if (level === 2 && inFirstNote && noteLines) {
            if (tag === 'CONC') noteLines[noteLines.length - 1] += value;
            else if (tag === 'CONT') noteLines.push(value);
        }
    }

    const isStromResearch = source.toUpperCase() === STROM_RESEARCH_SOURCE;
    const firstLine = noteLines?.find(l => l.trim() !== '') ?? '';
    return {
        isStromResearch,
        treeId: isStromResearch ? normalizeResearchId(treeRaw) : null,
        name: cleanText(firstLine, MAX_NAME) || null,
        date,
    };
}

// ==================== LOOPBACK ADDRESSES ====================

/**
 * Accept only an address on this computer: `http://127.0.0.1[:port]/…` or
 * `http://localhost[:port]/…`, no user name or password. Everything else —
 * another host, https, file:, a look-alike like `127.0.0.1.evil.com` or
 * `localhost@evil.com` — is refused, so a link can never make the app fetch
 * a file from somewhere else.
 */
export function parseLoopbackUrl(raw: unknown): URL | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
    return url;
}

/** The endpoints of a live research bridge. */
export interface LiveBridgeUrls {
    base: string;
    status: string;
    ged: string;
    events: string;
}

/** Endpoints of the bridge at `raw` (`http://127.0.0.1:<port>/<token>`), or null. */
export function parseLiveBridge(raw: unknown): LiveBridgeUrls | null {
    const url = parseLoopbackUrl(raw);
    if (!url) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const base = `${url.origin}${path}`;
    return {
        base,
        status: `${base}/status`,
        ged: `${base}/tree.ged`,
        events: `${base}/events`,
    };
}

// ==================== UPDATE OR ASK ====================

/** FNV-1a over a string with a given offset basis (32-bit). */
function fnv1a(text: string, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** The parts of a tree the user can change (see contentFingerprint). */
function fingerprintParts(data: StromData): unknown[] {
    return [
        data.persons ?? {},
        data.partnerships ?? {},
        data.sources ?? null,
        data.places ?? null,
        data.surnameVariants ?? null,
    ];
}

/** Prefix of the current fingerprint format. */
const FINGERPRINT_V2 = 'v2-';

/**
 * Stands for an image in the fingerprint: its length and a hash of every
 * 16th character plus the tail. Any real change of a picture (a new crop, a
 * rotation, another scan) changes the length or the sample; hashing all of
 * 80 MB of images took seconds on every research update.
 */
function imageToken(url: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i += 16) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (let i = Math.max(0, url.length - 64); i < url.length; i++) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `\u0000img:${url.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Fingerprint of what the user can change in a tree — people, couples,
 * sources, places, surname spellings. Leaves out bookkeeping that changes
 * without an edit (data version, last focused person, default person).
 * Images count by length and a sample (imageToken).
 */
export function contentFingerprint(data: StromData): string {
    const text = JSON.stringify(fingerprintParts(data), (_key, value) =>
        typeof value === 'string' && value.length >= 1024 && value.startsWith('data:') ? imageToken(value) : value);
    return `${FINGERPRINT_V2}${text.length.toString(36)}-${fnv1a(text, 0x811c9dc5).toString(36)}-${fnv1a(text, 0x01000193).toString(36)}`;
}

/** The fingerprint before images counted by sample (links synced by older versions). */
function legacyFingerprint(data: StromData): string {
    const text = JSON.stringify(fingerprintParts(data));
    return `${text.length.toString(36)}-${fnv1a(text, 0x811c9dc5).toString(36)}-${fnv1a(text, 0x01000193).toString(36)}`;
}

/**
 * The tree's fingerprint in the same format as `stored` (a link synced by an
 * older version keeps the old format until the next sync rewrites it).
 */
export function fingerprintLike(data: StromData, stored: string | undefined): string {
    return stored !== undefined && !stored.startsWith(FINGERPRINT_V2) ? legacyFingerprint(data) : contentFingerprint(data);
}

/** What an open of a research does with the user's trees. */
export type ResearchOpenAction = 'create' | 'update' | 'ask';

/**
 * - no tree holds this research → create one;
 * - the tree is as the last import left it → update it;
 * - the user changed it in the app since (or it cannot be read) → ask
 *   "Update (your changes are overwritten) / Open as a new copy".
 */
export function decideResearchOpen(
    link: Pick<ResearchLink, 'fingerprint'> | null | undefined,
    currentFingerprint: string | null
): ResearchOpenAction {
    if (!link) return 'create';
    if (currentFingerprint === null) return 'ask';
    return currentFingerprint === link.fingerprint ? 'update' : 'ask';
}

// ==================== STABLE IDS ACROSS UPDATES ====================

/** Reference numbers that occur exactly once, mapped to their person id. */
function uniqueRefns(data: StromData): Map<string, PersonId> {
    const seen = new Map<string, PersonId | null>();
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        const refn = p?.refn?.trim();
        if (!refn) continue;
        seen.set(refn, seen.has(refn) ? null : id as PersonId);
    }
    const out = new Map<string, PersonId>();
    for (const [refn, id] of seen) if (id) out.set(refn, id);
    return out;
}

/**
 * The importer gives every person a new id on each import. Carry over the ids
 * of the previous state, matched by the research's own person numbers (REFN),
 * so the focus, the last-viewed person and the highlight survive an update.
 * Couples follow their two people, sources their SOUR REFN. Returns a new
 * object; the input is kept.
 */
export function stabilizeIds(next: StromData, previous: StromData): StromData {
    const map = new Map<string, string>();
    const prevByRefn = uniqueRefns(previous);
    const nextByRefn = uniqueRefns(next);
    const nextIds = new Set<string>([
        ...Object.keys(next.persons ?? {}),
        ...Object.keys(next.partnerships ?? {}),
        ...Object.keys(next.sources ?? {}),
    ]);

    for (const [refn, newId] of nextByRefn) {
        const oldId = prevByRefn.get(refn);
        if (!oldId || oldId === newId) continue;
        // Never let a carried-over id collide with another record's id.
        if (nextIds.has(oldId)) continue;
        map.set(newId, oldId);
    }

    const pairKey = (a: string | null | undefined, b: string | null | undefined, remap: boolean): string | null => {
        if (!a || !b) return null;
        const x = remap ? (map.get(a) ?? a) : a;
        const y = remap ? (map.get(b) ?? b) : b;
        return x < y ? `${x}|${y}` : `${y}|${x}`;
    };
    const uniquePairs = (data: StromData, remap: boolean): Map<string, string> => {
        const seen = new Map<string, string | null>();
        for (const [id, ps] of Object.entries(data.partnerships ?? {})) {
            const key = pairKey(ps?.person1Id, ps?.person2Id, remap);
            if (!key) continue;
            seen.set(key, seen.has(key) ? null : id);
        }
        const out = new Map<string, string>();
        for (const [k, id] of seen) if (id) out.set(k, id);
        return out;
    };
    // Sources (register entries) follow the research's own record numbers too,
    // so citations and an open source viewer keep pointing at the same entry.
    const sourceRefns = (data: StromData): Map<string, string> => {
        const seen = new Map<string, string | null>();
        for (const [id, src] of Object.entries(data.sources ?? {})) {
            if (!src?.refn) continue;
            seen.set(src.refn, seen.has(src.refn) ? null : id);
        }
        const out = new Map<string, string>();
        for (const [refn, id] of seen) if (id) out.set(refn, id);
        return out;
    };
    const prevSources = sourceRefns(previous);
    for (const [refn, newId] of sourceRefns(next)) {
        const oldId = prevSources.get(refn);
        if (!oldId || oldId === newId || nextIds.has(oldId)) continue;
        map.set(newId, oldId);
    }

    const prevPairs = uniquePairs(previous, false);
    for (const [key, newId] of uniquePairs(next, true)) {
        const oldId = prevPairs.get(key);
        if (!oldId || oldId === newId || nextIds.has(oldId)) continue;
        map.set(newId, oldId);
    }

    return remapIds(next, map) as StromData;
}

/**
 * A copy of `value` (shaped like a JSON round-trip, strings shared) with every
 * key and string equal to a mapped id replaced. Generated ids are unique
 * random tokens: a string equal to one IS that id (as a key or a reference),
 * never text. Long strings (images, transcripts) are never ids.
 */
function remapIds(value: unknown, map: Map<string, string>): unknown {
    if (typeof value === 'string') return value.length <= 256 ? map.get(value) ?? value : value;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => (v === undefined ? null : remapIds(v, map)));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined || typeof v === 'function') continue;
        out[map.get(k) ?? k] = remapIds(v, map);
    }
    return out;
}

// ==================== LIVE BRIDGE MESSAGES ====================

/** Somebody (an agent) at work on the research. */
export interface LiveWorker {
    who: string;
    since: string;
    task: string;
}

/** Something the research waits for from the user. */
export interface LiveWaiting {
    id: string;
    what: string;
    on: string;
}

/** The bridge's /status (and the `hello` event), checked and cleaned. */
export interface LiveStatus {
    treeId: string | null;
    name: string;
    head: string;
    persons: number | null;
    families: number | null;
    working: LiveWorker[];
    waiting: LiveWaiting[];
}

/** A `change` event, checked and cleaned. */
export interface LiveChange {
    head: string;
    what: string[];
    at: string;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

const asCount = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** The `working` list (status field or `working` event). Untrusted input. */
export function sanitizeWorking(value: unknown): LiveWorker[] {
    if (!Array.isArray(value)) return [];
    const out: LiveWorker[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
        const r = asRecord(item);
        if (!r) continue;
        const who = cleanText(r.who, 80);
        if (!who) continue;
        out.push({ who, since: cleanText(r.since, 40), task: cleanText(r.task) });
    }
    return out;
}

/** The `waiting` list of the status. Untrusted input. */
export function sanitizeWaiting(value: unknown): LiveWaiting[] {
    if (!Array.isArray(value)) return [];
    const out: LiveWaiting[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
        const r = asRecord(item);
        if (!r) continue;
        const what = cleanText(r.what);
        if (!what) continue;
        out.push({ id: cleanText(r.id, 40), what, on: cleanText(r.on, 120) });
    }
    return out;
}

/** The bridge status. Untrusted input: every field is checked. */
export function sanitizeLiveStatus(value: unknown): LiveStatus | null {
    const r = asRecord(value);
    if (!r) return null;
    const tree = asRecord(r.tree);
    return {
        treeId: normalizeResearchId(tree?.id),
        name: cleanText(tree?.name, MAX_NAME),
        head: cleanText(r.head, 80),
        persons: asCount(r.persons),
        families: asCount(r.families),
        working: sanitizeWorking(r.working),
        waiting: sanitizeWaiting(r.waiting),
    };
}

/** A `change` event. Untrusted input. */
export function sanitizeLiveChange(value: unknown): LiveChange | null {
    const r = asRecord(value);
    if (!r) return null;
    const what = Array.isArray(r.what)
        ? r.what.slice(0, MAX_ITEMS).map(w => cleanText(w)).filter(Boolean)
        : [];
    return { head: cleanText(r.head, 80), what, at: cleanText(r.at, 40) };
}

/** Parse an event's JSON payload; null when it is not JSON. */
export function parseEventData(data: unknown): unknown {
    if (typeof data !== 'string') return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

/**
 * The research's person numbers a change mentions ("+P0101 Ludmila
 * /Nováková/ ← S0202" → P0101, S0202). Matched against the people's REFN.
 */
export function extractChangedRefs(what: string[]): string[] {
    const out = new Set<string>();
    for (const line of what) {
        for (const m of line.matchAll(/(?:^|[^\p{L}\p{N}])([A-Z]\d{2,})(?![\p{L}\p{N}])/gu)) out.add(m[1]);
    }
    return [...out];
}

/** People of `data` whose REFN is one of `refs`. */
export function personsByRefs(data: StromData, refs: string[]): PersonId[] {
    if (refs.length === 0) return [];
    const wanted = new Set(refs);
    const out: PersonId[] = [];
    for (const [id, p] of Object.entries(data.persons ?? {})) {
        const refn = p?.refn?.trim();
        if (refn && wanted.has(refn)) out.push(id as PersonId);
    }
    return out;
}

/**
 * A change line for people to read. Without `words` only the GEDCOM surname
 * slashes go; with them the usual lines of strom read as sentences — "New
 * person: …", "New child: <name>", "New family: …" — people's numbers become
 * their names, record ids and status marks ([lead]) disappear, and fact tags
 * are named. Lines of any other shape keep their wording.
 */
export function humanizeChange(line: string, nameOf?: (ref: string) => string | null, words?: ChangeWords): string {
    const plain = line.replace(/\/([^/]*)\//g, '$1').replace(/\s+/g, ' ').trim();
    if (!words) return plain;
    const name = (ref: string): string => nameOf?.(ref) || ref;
    const facts = (text: string): string => text
        .replace(/\s*\[(?:lead|possible|probable|proven|disproven)\]/gi, '')
        .replace(/\s*←\s*S\d{2,}/g, '')
        .replace(/\bE\d{2,}\s+/g, '')
        .replace(/\b([A-Z]{4})\b/g, (tag) => words.facts[tag] ?? tag)
        .replace(/\s+/g, ' ').trim();
    // "+P0006 Ludmila Nováková · E0006 BIRT 1905 [lead]" — a person added.
    let m = plain.match(/^\+(P\d{2,})\s+(.+?)(?:\s+·\s+(.*))?$/);
    if (m) {
        const rest = m[3] ? facts(m[3]) : '';
        return `${words.newPerson}: ${facts(m[2])}${rest ? ` · ${rest}` : ''}`;
    }
    // "F0001 +child P0006" — a child joined a family.
    m = plain.match(/^F\d{2,}\s+\+child\s+(P\d{2,})\b/);
    if (m) return `${words.newChild}: ${name(m[1])}`;
    // "+F0001 Josef Novák & Marie Dvořáková (1 child)" — a family added.
    m = plain.match(/^\+F\d{2,}\s+(.+?)(?:\s+\(\d+ child(?:ren)?\))?$/);
    if (m) return `${words.newFamily}: ${facts(m[1])}`;
    // Anything else: people by name, ids and status marks out.
    return facts(plain.replace(/(^|[^\p{L}\p{N}])[+~-]?(P\d{2,})(?![\p{L}\p{N}])/gu, (_, pre, ref) => `${pre}${name(ref)}`));
}

/** The words a humanized change line uses (from strings.research). */
export interface ChangeWords {
    newPerson: string;
    newChild: string;
    newFamily: string;
    /** GEDCOM fact tags → words (BIRT → "birth"); unknown tags stay as they are. */
    facts: Record<string, string>;
}

/** A file name the importer should take as GEDCOM. */
export function isGedcomFileName(name: unknown): boolean {
    return typeof name === 'string' && /\.ged$/i.test(name.trim());
}

/**
 * Safari (desktop or iOS, not Chrome/Edge/Firefox on iOS): it refuses https
 * pages any connection to http://127.0.0.1 / localhost, so ?import-url= and
 * ?live= cannot work there — the app says so instead of a generic error.
 */
export function isSafariBrowser(userAgent: string): boolean {
    return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(userAgent);
}

/** The Strom Research website (what it is, how to start). */
export const RESEARCH_SITE_URL = 'https://stromapp.info/research/';

/**
 * The Strom Research page in the app's language: `?lang=cs` / `?lang=de`,
 * English without a parameter. The ONE place the address is built — any
 * future parameter (e.g. a referrer tag) goes here and nowhere else.
 */
export function researchSiteUrl(lang: string): string {
    return lang === 'cs' || lang === 'de' ? `${RESEARCH_SITE_URL}?lang=${lang}` : RESEARCH_SITE_URL;
}
