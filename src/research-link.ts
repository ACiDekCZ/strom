/**
 * Opening a research from Strom Research (the command-line research tool) —
 * the pure, testable half: recognising its GEDCOM header, deciding whether an
 * open creates a tree, updates one or has to ask, keeping person ids stable
 * across updates, and accepting bridge addresses on this computer only.
 *
 * The UI half (file handler, ?import-url, drag & drop, the live bridge) lives
 * in src/ui/research-ui.ts. Nothing here touches the DOM or storage.
 */

import { StromData, PersonId, ResearchLink, Source, APP_VERSION } from './types.js';

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
    'direction', 'finish', 'media',
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

/** A research direction's id ("G0002"), or null. */
export function researchDirectionRef(id: unknown): string | null {
    return typeof id === 'string' && /^G\d{1,7}$/.test(id.trim()) ? id.trim() : null;
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
    /** A research direction ("G0002"): chat on it, or pause / end / restart it. */
    research?: string;
    directionDo?: ResearchDirectionDo;
    /** The agent's session to finish ("N0132"). */
    session?: string;
    /** An original by its SHA-256 (`media`: open it in the system's image viewer). */
    sha?: string;
    /** A story: approve it (or its waiting new version), or keep the approved one. */
    storyDo?: ResearchStoryDo;
    /** A couple's story: the other partner (with `person`). */
    partner?: string;
}

/** A story: approve (the draft, or the new version in place of the approved one) / keep the approved one. */
export type ResearchStoryDo = 'final' | 'keep';
const STORY_DOS: readonly string[] = ['final', 'keep'];

/** What to do with a research direction. */
export type ResearchDirectionDo = 'pause' | 'done' | 'resume';
const DIRECTION_DOS: readonly string[] = ['pause', 'done', 'resume'];

/** An agent session's id in the research ("N0132"), or null. */
export function researchSessionRef(id: unknown): string | null {
    return typeof id === 'string' && /^N\d{1,7}$/.test(id.trim()) ? id.trim() : null;
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
            if (p.research !== undefined) {
                const research = researchDirectionRef(p.research);
                return research ? `${base}&research=${research}` : null;
            }
            if (p.person === undefined) return base;
            const person = researchPersonRef(p.person);
            return person ? `${base}&person=${person}` : null;
        }
        case 'direction': {
            const id = researchDirectionRef(p.research);
            return id && p.directionDo && DIRECTION_DOS.includes(p.directionDo) ? `${base}&id=${id}&do=${p.directionDo}` : null;
        }
        case 'finish': {
            const session = researchSessionRef(p.session);
            return session ? `${base}&session=${session}` : null;
        }
        case 'media': {
            const sha = typeof p.sha === 'string' && /^[0-9a-f]{64}$/.test(p.sha) ? p.sha : null;
            return sha ? `${base}&sha=${sha}` : null;
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
            const what = p.storyDo ?? 'final';
            if (!person || !STORY_DOS.includes(what)) return null;
            if (p.partner === undefined) return `${base}&person=${person}&do=${what}`;
            const partner = researchPersonRef(p.partner);
            return partner && partner !== person ? `${base}&person=${person}&partner=${partner}&do=${what}` : null;
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
    /** `1 _STROM_MODE archive`: the research works without an agent (missing: with one). */
    mode: 'archive' | null;
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
    const none: ResearchHeader = { isStromResearch: false, treeId: null, name: null, date: null, head: null, links: [], mode: null };
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
    let modeRaw = '';
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
            else if (tag === '_STROM_MODE') modeRaw = value.trim().toLowerCase();
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
        mode: isStromResearch && modeRaw === 'archive' ? 'archive' : null,
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

/**
 * A request to a research bridge on this computer, with the app's version
 * (`app=<version>`): the research decides by it what the app can show (the
 * status of a fact, `_STROM_STATUS`). A query parameter, not a header — a
 * header would need a CORS preflight that older bridges do not answer.
 * Any other address comes back as it was.
 */
export function withAppVersion(raw: string, version: string = APP_VERSION): string {
    const url = parseLoopbackUrl(raw);
    if (!url || !version) return raw;
    url.searchParams.set('app', version);
    return url.toString();
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
    // An entry the user made in the app comes back with the research's number:
    // the same title, archive, page and wording is the same entry.
    const entryKey = (src: Source): string =>
        [src.title, src.repository, src.reference, src.transcript].map(v => (v ?? '').trim().toLowerCase()).join('\u0000');
    const prevUnnumbered = new Map<string, string | null>();
    for (const [id, src] of Object.entries(previous.sources ?? {})) {
        if (!src || src.refn) continue;
        const key = entryKey(src);
        prevUnnumbered.set(key, prevUnnumbered.has(key) ? null : id);
    }
    const taken = new Set(map.values());
    for (const [newId, src] of Object.entries(next.sources ?? {})) {
        if (!src?.refn || map.has(newId)) continue;
        const oldId = prevUnnumbered.get(entryKey(src));
        if (!oldId || oldId === newId || nextIds.has(oldId) || taken.has(oldId)) continue;
        map.set(newId, oldId);
        taken.add(oldId);
    }

    const prevPairs = uniquePairs(previous, false);
    for (const [key, newId] of uniquePairs(next, true)) {
        const oldId = prevPairs.get(key);
        if (!oldId || oldId === newId || nextIds.has(oldId)) continue;
        map.set(newId, oldId);
    }

    return remapIds(next, map) as StromData;
}

// ==================== MEDIA ACROSS UPDATES ====================

/**
 * People of `previous` that stabilizeIds could not match (no REFN yet — a
 * tree handed to the research from the app), paired with a person of `next`
 * that is new to it, by name, birth date and gender. Only pairs unique on
 * both sides count. previous id → next id.
 */
function matchUnlinkedPersons(next: StromData, previous: StromData): Map<string, string> {
    const key = (p: StromData['persons'][PersonId]): string | null => {
        const name = `${p.firstName ?? ''}|${p.lastName ?? ''}`.trim().toLowerCase();
        return name === '|' || p.isPlaceholder ? null : `${name}|${p.birthDate ?? ''}|${p.gender ?? ''}`;
    };
    const unique = (data: StromData, keep: (id: string, p: StromData['persons'][PersonId]) => boolean): Map<string, string> => {
        const seen = new Map<string, string | null>();
        for (const [id, p] of Object.entries(data.persons ?? {})) {
            if (!p || !keep(id, p)) continue;
            const k = key(p);
            if (k) seen.set(k, seen.has(k) ? null : id);
        }
        const out = new Map<string, string>();
        for (const [k, id] of seen) if (id) out.set(k, id);
        return out;
    };
    const fresh = unique(next, id => !previous.persons?.[id as PersonId]);
    const out = new Map<string, string>();
    if (!fresh.size) return out;
    for (const [k, id] of unique(previous, (id, p) => !p.refn && !next.persons?.[id as PersonId])) {
        const match = fresh.get(k);
        if (match) out.set(id, match);
    }
    return out;
}

/** What carryOverMedia did: the tree, and what had nowhere to go. */
export interface MediaCarryOver {
    data: StromData;
    /** Photos, attachments and excerpts of people / sources the update no longer has. */
    lost: number;
}

/**
 * Strom Research does not keep the app's images (photos, attachments, crops
 * cut in the app), so an update would drop them. Carry them over from the
 * previous state onto `next` (already through stabilizeIds, so ids match;
 * people without a REFN yet are paired by matchUnlinkedPersons):
 * - a person's photo when the research has none for them;
 * - attachments the research does not have (by id or content); a link to a
 *   source the update no longer has is dropped;
 * - excerpts without a `clip` (clipped ones belong to the research) to the
 *   source with the same id: all when the research has none for it, else
 *   only those cut here from an attachment.
 * What belongs to a person or source missing from `next` is counted as lost.
 * Returns a new object; neither input is changed.
 */
export function carryOverMedia(next: StromData, previous: StromData): MediaCarryOver {
    let lost = 0;
    const persons = { ...(next.persons ?? {}) };
    const unlinked = matchUnlinkedPersons(next, previous);
    const sources = next.sources ? { ...next.sources } : undefined;
    const sourceExists = (id: string | undefined): boolean => !!id && !!sources?.[id];

    for (const [id, old] of Object.entries(previous.persons ?? {})) {
        if (!old) continue;
        const media = (old.photo ? 1 : 0) + (old.attachments?.length ?? 0);
        if (!media) continue;
        const curId = (persons[id as PersonId] ? id : unlinked.get(id)) as PersonId | undefined;
        const cur = curId ? persons[curId] : undefined;
        if (!curId || !cur) {
            lost += media;
            continue;
        }
        const out = { ...cur };
        let changed = false;
        if (old.photo && !cur.photo) {
            out.photo = old.photo;
            if (old.photoOriginalName) out.photoOriginalName = old.photoOriginalName;
            changed = true;
        }
        const have = cur.attachments ?? [];
        const ids = new Set(have.map(a => a.id));
        const urls = new Set(have.map(a => a.dataUrl).filter(Boolean));
        const shas = new Set(have.map(a => a.original?.sha256).filter(Boolean));
        const extra = (old.attachments ?? [])
            .filter(a => !ids.has(a.id) && !(a.dataUrl && urls.has(a.dataUrl)) && !(a.originalOnly && shas.has(a.original?.sha256)))
            .map(a => {
                if (a.sourceId === undefined || sourceExists(a.sourceId)) return a;
                const { sourceId: _gone, ...rest } = a;
                return rest;
            });
        if (extra.length) {
            out.attachments = [...have, ...extra];
            changed = true;
        }
        if (changed) persons[curId] = out;
    }

    for (const [id, old] of Object.entries(previous.sources ?? {})) {
        const own = (old?.excerpts ?? []).filter(e => !e.clip);
        if (!own.length) continue;
        const cur = sources?.[id];
        if (!cur || !sources) {
            lost += own.length;
            continue;
        }
        const have = cur.excerpts ?? [];
        const ids = new Set(have.map(e => e.id));
        const urls = new Set(have.map(e => e.dataUrl));
        // A research file need not mark its crops (clip): when the research
        // brings crops of its own, only those cut here from an attachment are
        // surely the app's — anything else could duplicate a newer crop.
        const extra = own.filter(e => !ids.has(e.id) && !urls.has(e.dataUrl) && (!have.length || e.fromAttachmentId));
        if (extra.length) sources[id] = { ...cur, excerpts: [...have, ...extra] };
    }

    return { data: { ...next, persons, ...(sources ? { sources } : {}) }, lost };
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
    /** The run waits between sessions (its gate said wait, e.g. the usage limit). */
    paused?: { until: string; reason: string };
    /** The research direction of the task ("G0002"; a newer research). */
    research?: string;
    /** The agent's session ("N0132"; a newer research): it can be finished. */
    session?: string;
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
    /** The research direction of the task ("G0002"; a newer research). */
    research?: string;
    /** 'story': a new version of an approved story (the person's, or with `partner` the couple's), not a task. */
    kind?: 'story';
    /** A couple's story: the other partner (REFN). */
    partner?: string;
}

/** A research direction ("research" in the research, id G…): kinds, state, counts. */
export type LiveDirectionKind = 'ancestors' | 'descendants' | 'person' | 'question';
export interface LiveDirection {
    id: string;
    name: string;
    state: 'active' | 'paused' | 'done';
    /** The fields below come from a newer research only. */
    direction?: LiveDirectionKind;
    /** The person it starts from (REFN). */
    focus?: string;
    /** Tasks in the queue. */
    tasks?: number;
    /** Tasks waiting for the user. */
    waiting?: number;
    /** An agent works on it now (not a paused run). */
    working?: boolean;
    /** Why it was paused or ended, when the user said. */
    reason?: string;
    /** When its state last changed (ISO). */
    since?: string;
    /** Ancestors only: known ancestors per generation (parents first). */
    generations?: number[];
    /** What its last session did. */
    last?: { at: string; text: string };
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
    /** The research's directions (empty: an older research, or none said). */
    researches: LiveDirection[];
    /** What the research takes from the app (Strom Research 1.12+); null: an older research. */
    accepts: ResearchAccepts | null;
    /** What the app sent and waits for a decision in the research; null: an older research. */
    inbox: ResearchInbox | null;
    /** The app's sends of the last days and what became of each; null: an older research. */
    sends: ResearchSendRecord[] | null;
    /** The research's own version (`strom`, "1.11.0"; '' = not said). */
    version: string;
}

/** One send of the app as the research keeps it (`/status.sends`). */
export interface ResearchSendRecord {
    /** The mark the `/sync` reply gave it. */
    intake: string;
    at: string;
    state: 'pending' | 'written' | 'discarded' | 'replaced' | 'nothing' | 'undone' | 'failed';
    changes: number | null;
    /** A pending send the research is trying again (it was busy): how many tries so far; null: none said. */
    tries: number | null;
    /** The app tree (`_STROM_APP_TREE`), or the research id. */
    tree: string;
    /** `_STROM_SENT` of that send. */
    sent: string;
    /** When the user decided in the research (ISO, '' = not yet). */
    decidedAt: string;
    /** The user's words when discarding ('' = none). */
    reason: string;
    /** Conflicts it left to decide and still open (null: not said). */
    conflicts: number | null;
    /** The persons those conflicts are about (research refs). */
    conflictPersons: string[];
}

const SEND_STATES = new Set(['pending', 'written', 'discarded', 'replaced', 'nothing', 'undone', 'failed']);

/** `/status.sends`, or null when the research does not say. Untrusted. */
export function sanitizeSends(value: unknown): ResearchSendRecord[] | null {
    if (!Array.isArray(value)) return null;
    const out: ResearchSendRecord[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
        const r = asRecord(item);
        const intake = r ? headerToken(r.intake) : null;
        if (!r || !intake || typeof r.state !== 'string' || !SEND_STATES.has(r.state)) continue;
        const iso = (v: unknown): string => {
            const t = cleanText(v, 40);
            return Number.isFinite(Date.parse(t)) ? t : '';
        };
        out.push({
            intake,
            at: iso(r.at),
            state: r.state as ResearchSendRecord['state'],
            changes: asCount(r.changes),
            tries: asCount(r.tries),
            tree: headerToken(r.tree) ?? normalizeResearchId(r.tree) ?? '',
            sent: headerToken(r.sent) ?? '',
            decidedAt: iso(r.decidedAt),
            reason: cleanText(r.reason, 200),
            conflicts: conflictCount(r.conflicts),
            conflictPersons: conflictPersons(r.conflicts),
        });
    }
    return out;
}

/** Conflicts as a count, or a list of them (`[{ person: "P12" }, …]`); null when not said. */
function conflictCount(value: unknown): number | null {
    if (Array.isArray(value)) return Math.min(value.length, 9999);
    return asCount(value);
}

/** The persons a list of conflicts names (research refs "P12"), at most 20. */
function conflictPersons(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
        const ref = researchPersonRef(typeof item === 'string' ? item : asRecord(item)?.person);
        if (ref && !out.includes(ref)) out.push(ref);
    }
    return out.slice(0, 20);
}

/** What the research takes from the app (`/status.accepts`): the gate the other way round. */
export interface ResearchAccepts {
    /**
     * How a send is written: 'off' — it waits in the inbox for the user
     * (`sync.review on`, and every research before the immediate write);
     * 'write' — at once, an edit of a documented fact becomes a conflict;
     * 'mirror' — at once, the user's word wins (an archive).
     */
    syncAuto: 'off' | 'write' | 'mirror' | 'additions';
    /** It reads sources and citations from a send. */
    sources: boolean;
    /** It knows how much a transcript weighs (`_STROM_TRANSCRIPTS`, `_STROM_VERIFIED`). */
    verified: boolean;
    /** It takes original files (`PUT /media/<sha256>`, `accepts.media` is an object). */
    media: boolean;
    /** The largest file it takes (`accepts.media.max`); null when it does not say. */
    mediaMaxBytes: number | null;
    /** It takes a crop's region with a file (`accepts.media.region`). */
    mediaRegion: boolean;
    /** The kinds of file it takes (`accepts.media.types`); null when it does not say. */
    mediaTypes: { mime: string; ext: string[] }[] | null;
    /** It works with an agent, or as an archive of the user's data without one (`mode: "archive"`). */
    mode: 'agent' | 'archive';
    /** A send waits in the research's inbox for the user (`sync.auto: "off"`). */
    review: boolean;
}

/** One send waiting in the research's inbox. */
export interface ResearchInboxTree {
    /** The app's tree id (`_STROM_APP_TREE`), or the research id from a send without it. */
    tree: string;
    at: string;
    changes: number | null;
    /** `_STROM_SENT` of that send ('' = none). */
    sent: string;
}

/** `/status.inbox`. */
export interface ResearchInbox {
    trees: ResearchInboxTree[];
    material: number;
}

/** `/status.accepts`, or null when the research does not say (older than 1.12). Untrusted. */
function mediaMaxBytes(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** `accepts.media.types`: `[{ mime, ext: [".jpg"] }]`, or null when the research does not say. Untrusted. */
function mediaTypes(value: unknown): { mime: string; ext: string[] }[] | null {
    if (!Array.isArray(value)) return null;
    const out: { mime: string; ext: string[] }[] = [];
    for (const item of value.slice(0, 100)) {
        const t = asRecord(item);
        const mime = typeof t?.mime === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(t.mime) ? t.mime.toLowerCase() : '';
        const ext = Array.isArray(t?.ext) ? (t!.ext as unknown[]).filter((e): e is string => typeof e === 'string' && /^\.[a-z0-9]{1,8}$/i.test(e)).slice(0, 20) : [];
        if (mime || ext.length) out.push({ mime, ext });
    }
    return out.length ? out : null;
}

export function sanitizeAccepts(value: unknown): ResearchAccepts | null {
    const r = asRecord(value);
    if (!r) return null;
    const sync = asRecord(r.sync);
    const auto = sync?.auto === 'write' || sync?.auto === 'mirror' || sync?.auto === 'additions' ? sync.auto : 'off';
    return {
        syncAuto: auto,
        sources: r.sources === true,
        verified: r.verified === true,
        media: !!asRecord(r.media),
        mediaMaxBytes: mediaMaxBytes(asRecord(r.media)?.max ?? asRecord(r.media)?.maxBytes),
        mediaRegion: asRecord(r.media)?.region === true,
        mediaTypes: mediaTypes(asRecord(r.media)?.types),
        mode: r.mode === 'archive' ? 'archive' : 'agent',
        review: auto === 'off' && r.mode !== 'archive',
    };
}

/** `/status.inbox`, or null when the research does not say. Untrusted. */
export function sanitizeInbox(value: unknown): ResearchInbox | null {
    const r = asRecord(value);
    if (!r) return null;
    const trees: ResearchInboxTree[] = [];
    for (const item of Array.isArray(r.trees) ? r.trees.slice(0, MAX_ITEMS) : []) {
        const t = asRecord(item);
        const tree = t ? headerToken(t.tree) ?? normalizeResearchId(t.tree) : null;
        if (!t || !tree) continue;
        const at = cleanText(t.at, 40);
        trees.push({
            tree,
            at: Number.isFinite(Date.parse(at)) ? at : '',
            changes: asCount(t.changes),
            sent: headerToken(t.sent) ?? '',
        });
    }
    return { trees, material: asCount(r.material) ?? 0 };
}

/** A task in the agent's queue. */
export interface LiveQueueItem {
    id: string;
    text: string;
    state: 'next' | 'parked';
    /** The person the task is about (REFN "P12"), when the research says. */
    person?: string;
    /** The research direction of the task ("G0002"; a newer research). */
    research?: string;
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
    /** The new commits, as /log gives them (a newer research): each with its task and text. */
    entries?: LiveLogEntry[];
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
        const p = asRecord(r.paused);
        const until = p ? cleanText(p.until, 40) : '';
        const paused = p ? { until: Number.isFinite(Date.parse(until)) ? until : '', reason: cleanText(p.reason, 200) } : null;
        const research = researchDirectionRef(r.research);
        const session = researchSessionRef(r.session);
        out.push({
            who, since: cleanText(r.since, 40), task: cleanText(r.task), ...(person ? { person } : {}), ...(paused ? { paused } : {}),
            ...(research ? { research } : {}), ...(session ? { session } : {}),
        });
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
        const research = researchDirectionRef(r.research);
        // A story names whose it is; without the person it is just a line.
        const story = r.kind === 'story' && person;
        const partner = story ? researchPersonRef(r.partner) : null;
        out.push({
            id: cleanText(r.id, 40), what, on: cleanText(r.on, 120), at: cleanText(r.at ?? r.since, 40),
            ...(person ? { person } : {}), ...(research ? { research } : {}),
            ...(story ? { kind: 'story' as const } : {}), ...(partner && partner !== person ? { partner } : {}),
        });
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
        const research = researchDirectionRef(r.research);
        if (state) out.push({ id, text, state, ...(person ? { person } : {}), ...(research ? { research } : {}) });
    }
    return out;
}

const DIRECTION_KINDS: readonly string[] = ['ancestors', 'descendants', 'person', 'question'];
const DIRECTION_STATES: readonly string[] = ['active', 'paused', 'done'];
/** Longest direction note taken (a reason, the last session's text). */
const MAX_DIRECTION_NOTE = 140;

/**
 * The `researches` list of the status. Untrusted input: a direction needs a
 * valid id, a name and a state; any other field that is wrong is dropped and
 * the direction kept.
 */
export function sanitizeDirections(value: unknown): LiveDirection[] {
    if (!Array.isArray(value)) return [];
    const out: LiveDirection[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
        const r = asRecord(item);
        const id = researchDirectionRef(r?.id);
        const name = cleanText(r?.name, MAX_NAME);
        const state = typeof r?.state === 'string' && DIRECTION_STATES.includes(r.state) ? r.state as LiveDirection['state'] : null;
        if (!r || !id || !name || !state) continue;
        const d: LiveDirection = { id, name, state };
        if (typeof r.direction === 'string' && DIRECTION_KINDS.includes(r.direction)) d.direction = r.direction as LiveDirectionKind;
        const focus = researchPersonRef(r.focus);
        if (focus) d.focus = focus;
        const tasks = asCount(r.tasks);
        if (tasks !== null) d.tasks = tasks;
        const waiting = asCount(r.waiting);
        if (waiting !== null) d.waiting = waiting;
        if (typeof r.working === 'boolean') d.working = r.working;
        const reason = cleanText(r.reason, MAX_DIRECTION_NOTE);
        if (reason) d.reason = reason;
        const since = cleanText(r.since, 40);
        if (Number.isFinite(Date.parse(since))) d.since = since;
        if (Array.isArray(r.generations) && r.generations.length > 0 && r.generations.length <= 12) {
            const gens = r.generations.map(asCount);
            if (gens.every((g): g is number => g !== null)) d.generations = gens;
        }
        const last = asRecord(r.last);
        const lastAt = last ? cleanText(last.at, 40) : '';
        const lastText = last ? cleanText(last.text, MAX_DIRECTION_NOTE) : '';
        if (lastText && Number.isFinite(Date.parse(lastAt))) d.last = { at: lastAt, text: lastText };
        out.push(d);
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
        researches: sanitizeDirections(r.researches),
        accepts: sanitizeAccepts(r.accepts),
        inbox: sanitizeInbox(r.inbox),
        sends: sanitizeSends(r.sends),
        version: researchVersion(r.strom),
    };
}

/** A version as the research names itself ("1.11.0", "1.12.0-beta.2"), or ''. Untrusted. */
export function researchVersion(value: unknown): string {
    return typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.]{1,20})?$/.test(value) ? value : '';
}

/** One version of the research in its history (a commit): when, what, on which task. */
export interface LiveLogEntry {
    head: string;
    at: string;
    what: string[];
    /** The task it was done for ('' = none said). */
    task: string;
    /**
     * What it did in the research's language, line by line ("Nová osoba: Jan
     * Víšek (*1865) [P0012]"); empty: nothing worth saying (don't show it).
     * Absent from an older research (then `what` is shown).
     */
    text?: string[];
    /** The kind of each `text` line, same order (a newer research; else guessed from `what`). */
    kinds?: LiveChangeKind[];
    /** The research direction the commit was for ("G0002"; a newer research). */
    research?: string;
}

/** The research's kinds of text lines, as the app's filter kinds. */
const TEXT_KINDS: Record<string, LiveChangeKind> = { person: 'persons', source: 'sources', story: 'stories', other: 'other' };

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
        // `kinds` pairs with `text` line by line: only a list of the same
        // length and known values counts, and an empty line goes with its kind.
        const rawText = Array.isArray(e.text) ? e.text.slice(0, MAX_CHANGE_LINES) : null;
        const rawKinds = rawText && Array.isArray(e.kinds) && e.kinds.length === (e.text as unknown[]).length
            && e.kinds.every(k => typeof k === 'string' && k in TEXT_KINDS)
            ? (e.kinds as string[]).map(k => TEXT_KINDS[k]) : null;
        const lines = rawText ? rawText.map((t, i) => ({ t: cleanText(t), k: rawKinds?.[i] })).filter(l => l.t) : null;
        const research = researchDirectionRef(e.research);
        out.push({
            head: cleanText(e.head, 80), at, what, task: cleanText(e.task),
            ...(lines ? { text: lines.map(l => l.t) } : {}),
            ...(lines && rawKinds ? { kinds: lines.map(l => l.k as LiveChangeKind) } : {}),
            ...(research ? { research } : {}),
        });
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
    const entries = Array.isArray(r.entries) ? sanitizeLiveLog({ entries: r.entries }) : null;
    return { head: cleanText(r.head, 80), what, at: cleanText(r.at, 40), ...(entries && entries.length > 0 ? { entries } : {}) };
}

/** People a research text line names ("… [P0019] …"). */
export function textPersonRefs(line: string): string[] {
    return [...line.matchAll(/\[(P\d{1,7})\]/g)].map(m => m[1]);
}

/** A research text line as shown: the "[P0019]" marks go (the names become links). */
export function textWithoutRefs(line: string): string {
    return line.replace(/\s*\[P\d{1,7}\]/g, '').trim();
}

/**
 * The filter kind of a text line of a commit. The text is in the research's
 * language, so the commit's `what` decides: one kind there is the kind of
 * every line; a mixed commit: a line naming a person is about people (a story
 * line when the commit wrote a story), else its sources, else other.
 */
export function textKind(line: string, what: readonly string[]): LiveChangeKind {
    const kinds = new Set(what.map(changeKind).filter(k => k !== 'other'));
    if (kinds.size === 1) return [...kinds][0];
    if (kinds.size === 0) return 'other';
    if (textPersonRefs(line).length > 0) {
        return kinds.has('stories') && /vyprávění|story|erzählung/i.test(line) ? 'stories' : 'persons';
    }
    return kinds.has('sources') ? 'sources' : 'other';
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
    // A GEDCOM surname ("Marie /Víšková/") loses its slashes; a path ("output/tree.ged") keeps them.
    const plain = line.replace(/(^|\s)\/([^/\s][^/]*)\/(?=$|[\s,.;:·)])/g, '$1$2').replace(/\s+/g, ' ').trim();
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

/** What names an exported GEDCOM's research (header lines, see researchHeaderLines). */
export interface ResearchHeaderInfo {
    id: string;
    head?: string;
    /** The tree's id in the app (`_STROM_APP_TREE`): the research keeps one send per app tree. */
    appTree?: string;
    /** How the research takes the user's transcripts (`_STROM_TRANSCRIPTS`; missing = lead). */
    transcripts?: 'lead' | 'evidence';
    /** The fingerprint of the tree as sent (`_STROM_SENT`): only on a send to the bridge. */
    sent?: string;
}

/** `_STROM_SENT` / `_STROM_APP_TREE` values: what the research accepts (at most 64 of [A-Za-z0-9._:-]). */
function headerToken(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : null;
}

/** The header lines that tie an exported GEDCOM to its research. */
export function researchHeaderLines(link: ResearchHeaderInfo | null | undefined): string[] {
    const id = normalizeResearchId(link?.id);
    if (!id) return [];
    const head = isResearchHead(link?.head);
    const appTree = headerToken(link?.appTree);
    const sent = headerToken(link?.sent);
    return [
        `1 ${STROM_TREE_TAG} ${id}`,
        ...(head ? [`1 ${STROM_HEAD_TAG} ${head}`] : []),
        ...(appTree ? [`1 _STROM_APP_TREE ${appTree}`] : []),
        ...(link?.transcripts === 'evidence' || link?.transcripts === 'lead' ? [`1 _STROM_TRANSCRIPTS ${link.transcripts}`] : []),
        ...(sent ? [`1 _STROM_SENT ${sent}`] : []),
    ];
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
    /** The send waits in the research's inbox (true) or was written at once (false); null: not said. */
    inbox: boolean | null;
    /** The research's mark of this send ("R20261002143205123-a1b2"; '' = not said): find it in `/status.sends`. */
    intake: string;
    /** The commit the write made (written at once; '' = not said or nothing written). */
    head: string;
    /** What of `changes` was written (the rest only reported); null: not said. */
    applied: number | null;
    /** Still writing (202): the end comes in the status. */
    pending: boolean;
    /** Conflicts the send left to decide (null: not said). */
    conflicts: number | null;
    /** The persons those conflicts are about (research refs), when it says. */
    conflictPersons: string[];
    /** Things the send lacked that the research kept (an archive takes away only what this app tree had). */
    kept: number | null;
}

export function sanitizeSyncReply(value: unknown): SyncReply {
    const r = asRecord(value);
    if (!r) return { ok: false, changes: null, error: '', inbox: null, intake: '', head: '', applied: null, pending: false, conflicts: null, conflictPersons: [], kept: null };
    return {
        ok: r.ok === true,
        changes: asCount(r.changes),
        error: cleanText(r.error),
        inbox: typeof r.inbox === 'boolean' ? r.inbox : null,
        intake: headerToken(r.intake) ?? '',
        head: isResearchHead(r.head) ?? '',
        applied: asCount(r.applied),
        pending: r.pending === true,
        conflicts: conflictCount(r.conflicts),
        conflictPersons: conflictPersons(r.conflicts),
        kept: asCount(r.kept),
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
