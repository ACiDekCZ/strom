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
/** Header tag carrying the research commit the file was written from. */
export const STROM_HEAD_TAG = '_STROM_HEAD';
/** Header tag listing the strom-research:// links this computer handles. */
export const STROM_LINKS_TAG = '_STROM_LINKS';

/** Actions of the strom-research:// scheme the app knows how to use. */
export const RESEARCH_LINK_ACTIONS = [
    'send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live',
] as const;
export type ResearchLinkAction = typeof RESEARCH_LINK_ACTIONS[number];

/** The known actions in `value` (an array, or a space-separated header value); anything else is dropped. */
export function sanitizeResearchLinks(value: unknown): ResearchLinkAction[] {
    const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : [];
    const known = new Set<string>(RESEARCH_LINK_ACTIONS);
    return [...new Set(items.filter((v): v is string => typeof v === 'string').map(v => v.trim().toLowerCase()))]
        .filter((v): v is ResearchLinkAction => known.has(v));
}

/** A crop's id in the research (`_STROM_CLIP`: letters, digits, '-', ≤ 32), or null. */
export function researchClip(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(value.trim()) ? value.trim() : null;
}

/** A source's id in the research (its REFN, e.g. "S0042"), or null. */
export function researchSourceRef(refn: unknown): string | null {
    return typeof refn === 'string' && /^S\d{1,9}$/.test(refn.trim()) ? refn.trim() : null;
}

/** A person's id in the research (its REFN, e.g. "P0012"), or null. */
export function researchPersonRef(refn: unknown): string | null {
    return typeof refn === 'string' && /^P\d{1,7}$/.test(refn.trim()) ? refn.trim() : null;
}

/** A task's id in the research ("T0003"), or null. */
export function researchTaskRef(id: unknown): string | null {
    return typeof id === 'string' && /^T\d{1,7}$/.test(id.trim()) ? id.trim() : null;
}

/** A conflict's id in the research ("X0007"), or null. */
export function researchConflictRef(id: unknown): string | null {
    return typeof id === 'string' && /^X\d{1,7}$/.test(id.trim()) ? id.trim() : null;
}

/** A send's id in the research ("I0042", what it took in), or null. */
export function researchIntakeRef(id: unknown): string | null {
    return typeof id === 'string' && /^I\d{1,7}$/.test(id.trim()) ? id.trim() : null;
}

/** The one-time token of "Start research with this tree" (base64url, 22–43 characters), or null. */
export function researchAdoptToken(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{22,43}$/.test(value) ? value : null;
}

/** How far "Review again" reaches: the person, with the family, or the whole line up. */
export type ResearchReviewScope = 'person' | 'family' | 'line';
const REVIEW_SCOPES: readonly string[] = ['person', 'family', 'line'];
/** Direction of a new research. */
export type ResearchDirection = 'ancestors' | 'descendants';
const DIRECTIONS: readonly string[] = ['ancestors', 'descendants'];

/** Parameters of a strom-research:// link (only ids and fixed values — never names or free text). */
export interface ResearchLinkParams {
    tree: string;
    source?: string;
    clip?: string;
    person?: string;
    task?: string;
    scope?: ResearchReviewScope;
    direction?: ResearchDirection;
    /** A task: park / drop / wake (without: answer it). */
    taskDo?: ResearchTaskDo;
    /** A conflict ("X0007") and what to do with it. */
    conflict?: string;
    conflictDo?: ResearchConflictDo;
    /** The send to take back ("I0042"). */
    intake?: string;
}

/** What to do with a task in the research (nothing: answer it). */
export type ResearchTaskDo = 'park' | 'drop' | 'wake';
const TASK_DOS: readonly string[] = ['park', 'drop', 'wake'];
/** A conflict: decide it there, or leave it to the agent. */
export type ResearchConflictDo = 'decide' | 'agent';
const CONFLICT_DOS: readonly string[] = ['decide', 'agent'];

/** "Start research with this tree": the one link without a tree (the research makes one). */
export function researchNewUrl(token: string): string | null {
    const app = researchAdoptToken(token);
    return app ? `strom-research://new?app=${app}` : null;
}

/**
 * A strom-research:// link, or null when a parameter is not what the research
 * accepts (it checks again: any web page can open such a link).
 */
export function researchSchemeUrl(action: ResearchLinkAction, p: ResearchLinkParams): string | null {
    const tree = normalizeResearchId(p.tree);
    if (!tree) return null;
    const base = `strom-research://${action}?tree=${tree}`;
    switch (action) {
        case 'send':
        case 'app':
        case 'open':
        case 'update':
        case 'sessions':
        case 'setup':
        case 'live':
            return base;
        case 'excerpt': {
            const source = researchSourceRef(p.source);
            const clip = researchClip(p.clip);
            return source && clip ? `${base}&source=${source}&clip=${clip}` : null;
        }
        case 'chat': {
            if (p.person === undefined) return base;
            const person = researchPersonRef(p.person);
            return person ? `${base}&person=${person}` : null;
        }
        case 'task': {
            const task = researchTaskRef(p.task);
            if (!task) return null;
            if (p.taskDo === undefined) return `${base}&task=${task}`;
            return TASK_DOS.includes(p.taskDo) ? `${base}&task=${task}&do=${p.taskDo}` : null;
        }
        case 'conflict': {
            const id = researchConflictRef(p.conflict);
            const what = p.conflictDo ?? 'decide';
            return id && CONFLICT_DOS.includes(what) ? `${base}&id=${id}&do=${what}` : null;
        }
        case 'story': {
            const person = researchPersonRef(p.person);
            return person ? `${base}&person=${person}&do=final` : null;
        }
        case 'sync-undo': {
            const intake = researchIntakeRef(p.intake);
            return intake ? `${base}&intake=${intake}` : null;
        }
        case 'new':
            // Carries a token, not a tree: see researchNewUrl.
            return null;
        case 'review': {
            const person = researchPersonRef(p.person);
            const scope = p.scope ?? 'person';
            return person && REVIEW_SCOPES.includes(scope) ? `${base}&person=${person}&scope=${scope}` : null;
        }
        case 'research': {
            const person = researchPersonRef(p.person);
            const direction = p.direction ?? 'ancestors';
            return person && DIRECTIONS.includes(direction) ? `${base}&person=${person}&direction=${direction}` : null;
        }
    }
    return null;
}

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
    /** `1 _STROM_HEAD`: the research commit the file was written from. */
    head: string | null;
    /** `1 _STROM_LINKS`: strom-research:// actions this computer handles (Strom Research files only). */
    links: ResearchLinkAction[];
}

/** Normalise a research UUID (lower case), or null when it is not one. */
export function normalizeResearchId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** A research commit id (hex, 7–64 characters, lower case), or null. */
export function isResearchHead(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^[0-9a-f]{7,64}$/i.test(v) ? v.toLowerCase() : null;
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
    const none: ResearchHeader = { isStromResearch: false, treeId: null, name: null, date: null, head: null, links: [] };
    if (typeof text !== 'string') return none;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = body.split(/\r\n|\r|\n/);

    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || !/^0\s+HEAD\b/.test(lines[i].trim())) return none;

    let source = '';
    let treeRaw: string | null = null;
    let headRaw: string | null = null;
    let linksRaw = '';
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
            else if (tag === STROM_HEAD_TAG) headRaw = value;
            else if (tag === STROM_LINKS_TAG) linksRaw = value;
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
        head: isStromResearch ? isResearchHead(headRaw) : null,
        links: isStromResearch ? sanitizeResearchLinks(linksRaw) : [],
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
    /** The research's own history (newest first); a bridge before 1.8 answers 404. */
    log: string;
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
        log: `${base}/log`,
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
    /** The person the work is about (REFN "P12"), when the research says. */
    person?: string;
}

/** Something the research waits for from the user. */
export interface LiveWaiting {
    id: string;
    what: string;
    on: string;
    /** Since when it waits (ISO time; empty when the research does not say). */
    at: string;
    /** The person it is about (REFN "P12"), when the research says. */
    person?: string;
}

/** The bridge's /status (and the `hello` event), checked and cleaned. */
export interface LiveStatus {
    treeId: string | null;
    name: string;
    head: string;
    /** When the research last changed (its head commit's time, ISO; '' = not said). */
    headAt: string;
    persons: number | null;
    families: number | null;
    working: LiveWorker[];
    waiting: LiveWaiting[];
    /** strom-research:// actions this computer handles (empty: none announced). */
    links: ResearchLinkAction[];
    /** The agent's queue, in its order (at most 20). */
    queue: LiveQueueItem[];
    /** How many more tasks the queue holds beyond `queue`. */
    queueMore: number;
    /** A newer Strom Research is out ("1.7.0"); null: none. */
    update: { version: string } | null;
    /** What the agent cost this month; null: not said. */
    spend: LiveSpend | null;
    /** The last send the research took in; null: none. */
    lastIntake: LiveIntake | null;
}

/** A task in the agent's queue. */
export interface LiveQueueItem {
    id: string;
    text: string;
    state: 'next' | 'parked';
    /** The person the task is about (REFN "P12"), when the research says. */
    person?: string;
}

/** The agent's sessions and cost this month. */
export interface LiveSpend {
    /** "2026-09". */
    month: string;
    sessions: number;
    amount: number;
    /** ISO 4217 ("USD"). */
    currency: string;
}

/** The last send the research took in (it can be taken back). */
export interface LiveIntake {
    id: string;
    at: string;
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
        const person = researchPersonRef(r.person);
        out.push({ who, since: cleanText(r.since, 40), task: cleanText(r.task), ...(person ? { person } : {}) });
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
        const person = researchPersonRef(r.person);
        out.push({ id: cleanText(r.id, 40), what, on: cleanText(r.on, 120), at: cleanText(r.at ?? r.since, 40), ...(person ? { person } : {}) });
    }
    return out;
}

/** Most queue items taken from the status. */
const MAX_QUEUE = 20;

/** The `queue` list of the status. Untrusted input: bad items are dropped. */
export function sanitizeQueue(value: unknown): LiveQueueItem[] {
    if (!Array.isArray(value)) return [];
    const out: LiveQueueItem[] = [];
    for (const item of value) {
        if (out.length >= MAX_QUEUE) break;
        const r = asRecord(item);
        const id = researchTaskRef(r?.id);
        const text = cleanText(r?.text);
        if (!r || !id || !text) continue;
        const state = r.state === 'parked' ? 'parked' : r.state === 'next' ? 'next' : null;
        const person = researchPersonRef(r.person);
        if (state) out.push({ id, text, state, ...(person ? { person } : {}) });
    }
    return out;
}

/** `update: { version }`: a newer research, or null. */
export function sanitizeUpdate(value: unknown): { version: string } | null {
    const r = asRecord(value);
    const version = typeof r?.version === 'string' ? r.version.trim() : '';
    return /^\d{1,4}(\.\d{1,4}){1,3}([-.][0-9A-Za-z.]{1,20})?$/.test(version) ? { version } : null;
}

/** `spend: { month, sessions, amount, currency }`, or null when any part is wrong. */
export function sanitizeSpend(value: unknown): LiveSpend | null {
    const r = asRecord(value);
    if (!r) return null;
    const month = typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) ? r.month : null;
    const sessions = asCount(r.sessions);
    const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0 ? r.amount : null;
    const currency = typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null;
    return month && sessions !== null && amount !== null && currency ? { month, sessions, amount, currency } : null;
}

/** `lastIntake: { id, at }`, or null. */
export function sanitizeIntake(value: unknown): LiveIntake | null {
    const r = asRecord(value);
    const id = researchIntakeRef(r?.id);
    const at = typeof r?.at === 'string' && Number.isFinite(Date.parse(r.at)) ? r.at : null;
    return id && at ? { id, at } : null;
}

/** The bridge status. Untrusted input: every field is checked. */
export function sanitizeLiveStatus(value: unknown): LiveStatus | null {
    const r = asRecord(value);
    if (!r) return null;
    // `tree` is `{ id, name }` (the live bridge) or the id itself with the
    // name beside it (the send bridge).
    const tree = asRecord(r.tree);
    return {
        treeId: normalizeResearchId(tree ? tree.id : r.tree),
        name: cleanText(tree?.name ?? r.name, MAX_NAME),
        head: cleanText(r.head, 80),
        headAt: Number.isFinite(Date.parse(cleanText(r.headAt, 40))) ? cleanText(r.headAt, 40) : '',
        persons: asCount(r.persons),
        families: asCount(r.families),
        working: sanitizeWorking(r.working),
        waiting: sanitizeWaiting(r.waiting),
        links: sanitizeResearchLinks(r.links),
        queue: sanitizeQueue(r.queue),
        queueMore: asCount(r.queueMore) ?? 0,
        update: sanitizeUpdate(r.update),
        spend: sanitizeSpend(r.spend),
        lastIntake: sanitizeIntake(r.lastIntake),
    };
}

/** One version of the research in its history (a commit): when, what, on which task. */
export interface LiveLogEntry {
    head: string;
    at: string;
    what: string[];
    /** The task it was done for ('' = none said). */
    task: string;
}

/** Most history entries taken from the bridge. */
const MAX_LOG = 500;
/** Lines of one commit: a bulk command (an intake, a fetch) lists every change it saved. */
const MAX_CHANGE_LINES = 1000;

/** The bridge's /log (`{ entries: [...] }`, newest first). Untrusted input: bad entries are dropped. */
export function sanitizeLiveLog(value: unknown): LiveLogEntry[] | null {
    const r = asRecord(value);
    if (!r || !Array.isArray(r.entries)) return null;
    const out: LiveLogEntry[] = [];
    for (const item of r.entries) {
        if (out.length >= MAX_LOG) break;
        const e = asRecord(item);
        if (!e) continue;
        const at = cleanText(e.at, 40);
        const what = Array.isArray(e.what) ? e.what.slice(0, MAX_CHANGE_LINES).map(w => cleanText(w)).filter(Boolean) : [];
        if (!Number.isFinite(Date.parse(at)) || what.length === 0) continue;
        out.push({ head: cleanText(e.head, 80), at, what, task: cleanText(e.task) });
    }
    return out;
}

/** What a change line adds: a person ("+P0006 …"), a source ("+S0031 …"), or nothing new. */
export function changeAdds(line: string): 'person' | 'source' | null {
    const t = line.trim();
    if (/^\+P\d{2,}\b/.test(t)) return 'person';
    if (/^\+S\d{2,}\b/.test(t)) return 'source';
    return null;
}

/** A `change` event. Untrusted input. */
export function sanitizeLiveChange(value: unknown): LiveChange | null {
    const r = asRecord(value);
    if (!r) return null;
    const what = Array.isArray(r.what)
        ? r.what.slice(0, MAX_CHANGE_LINES).map(w => cleanText(w)).filter(Boolean)
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

/** What a change line is about, for the overview's filters ("other": only under All). */
export type LiveChangeKind = 'persons' | 'sources' | 'stories' | 'other';

export function changeKind(line: string): LiveChangeKind {
    if (/_STORY\b|\bstory\b/i.test(line)) return 'stories';
    if (/(^|[^\p{L}\p{N}])[+~-]?S\d{2,}(?![\p{L}\p{N}])|\bSOUR\b/u.test(line)) {
        // "E0006 BIRT 1905 ← S0012" is a fact about a person, backed by a source.
        if (/(^|[^\p{L}\p{N}])[+~-]?[PF]\d{2,}(?![\p{L}\p{N}])/u.test(line) && /←\s*S\d{2,}/.test(line)) return 'persons';
        return 'sources';
    }
    if (/(^|[^\p{L}\p{N}])[+~-]?[PF]\d{2,}(?![\p{L}\p{N}])/u.test(line)) return 'persons';
    return 'other';
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

// ==================== SENDING CHANGES BACK ====================

/** The endpoints of a send bridge (`?send=`): its status and where to POST. */
export interface SendBridgeUrls {
    base: string;
    status: string;
    sync: string;
    /** POST {"reason": …} here whenever nothing will be sent, so the research stops waiting. */
    cancel: string;
}

/** Endpoints of the bridge at `raw` (`http://127.0.0.1:<port>/<token>`), or null. */
export function parseSendBridge(raw: unknown): SendBridgeUrls | null {
    const live = parseLiveBridge(raw);
    if (!live) return null;
    return { base: live.base, status: live.status, sync: `${live.base}/sync`, cancel: `${live.base}/cancel` };
}

/** A tree that could be sent: the open one, or the one changed last. */
export function pickSendDefault<T extends { id: string; changedAt?: string; lastModifiedAt?: string }>(
    trees: readonly T[],
    openTreeId: string | null
): T | null {
    if (trees.length === 0) return null;
    const open = trees.find(t => t.id === openTreeId);
    if (open) return open;
    const when = (t: T): number => Date.parse(t.changedAt ?? t.lastModifiedAt ?? '') || 0;
    return [...trees].sort((a, b) => when(b) - when(a))[0];
}

/** The header lines that tie an exported GEDCOM to its research. */
export function researchHeaderLines(link: { id: string; head?: string } | null | undefined): string[] {
    const id = normalizeResearchId(link?.id);
    if (!id) return [];
    const head = isResearchHead(link?.head);
    return [`1 ${STROM_TREE_TAG} ${id}`, ...(head ? [`1 ${STROM_HEAD_TAG} ${head}`] : [])];
}

/** The `research` field of a JSON export / import: `{ id, head? }`, checked. */
export function sanitizeResearchField(value: unknown): { id: string; head?: string } | null {
    const r = asRecord(value);
    const id = normalizeResearchId(r?.id);
    if (!id) return null;
    const head = isResearchHead(r?.head);
    return head ? { id, head } : { id };
}

/** The bridge's answer to a sync: `{ ok, input, changes }` or `{ error }`. Untrusted. */
export interface SyncReply {
    ok: boolean;
    changes: number | null;
    error: string;
}

export function sanitizeSyncReply(value: unknown): SyncReply {
    const r = asRecord(value);
    if (!r) return { ok: false, changes: null, error: '' };
    return {
        ok: r.ok === true,
        changes: asCount(r.changes),
        error: cleanText(r.error),
    };
}

/**
 * Only a faithful export names its research: the whole tree, every living
 * person as is, all content. The research compares what it sent with what
 * comes back — hidden living people, dropped images or notes would read as
 * edits and deletions.
 */
export function isFaithfulExport(privacy: string, content: { photos: boolean; attachments: boolean; notes: boolean; sources: boolean }): boolean {
    return privacy === 'full' && content.photos && content.attachments && content.notes && content.sources;
}

// ==================== "START RESEARCH WITH THIS TREE" ====================

/** What the research asks for at `GET <bridge>/adopt`: the tree by its token, and its own name. */
export interface AdoptOffer {
    token: string;
    name: string;
    /** The research tree's UUID, when it already made one. */
    tree: string | null;
}

/** The adopt offer, or null when it does not carry a valid token. Untrusted. */
export function sanitizeAdoptOffer(value: unknown): AdoptOffer | null {
    const r = asRecord(value);
    const token = researchAdoptToken(r?.token);
    if (!r || !token) return null;
    return { token, name: cleanText(r.name, MAX_NAME), tree: normalizeResearchId(r.tree) };
}

/** The research's answer to the handed-over tree: its tree UUID and version, or null. Untrusted. */
export function sanitizeAdoptReply(value: unknown): { tree: string; head: string | null } | null {
    const r = asRecord(value);
    const tree = normalizeResearchId(r?.tree);
    return tree ? { tree, head: isResearchHead(r?.head) } : null;
}

/** A one-time token for "Start research with this tree": 32 random bytes, base64url (43 characters). */
export function newAdoptToken(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
    const bytes = random(new Uint8Array(32));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
