/**
 * Strom Research on THIS computer: which strom-research:// links it handles.
 * A web page cannot tell whether a program registered a link scheme, so the
 * research announces it whenever it talks to the app from this computer (the
 * bridge status, a file it serves on 127.0.0.1). Remembered per browser; a
 * later contact without the announcement forgets it again. The user can also
 * switch the features off (Settings → Data).
 */

import {
    ResearchLinkAction, LiveWaiting, LiveIntake, ResearchAccepts, sanitizeResearchLinks, sanitizeWaiting, sanitizeUpdate, sanitizeIntake,
    sanitizeAccepts, parseLiveBridge, isResearchHead,
} from './research-link.js';
import { ResearchConflict, ResearchSend } from './types.js';

const LINKS_KEY = 'strom-research-links';
const OFF_KEY = 'strom-research-links-off';
const WAITING_KEY = 'strom-research-waiting:';
const BRIDGE_KEY = 'strom-research-bridge:';
/** A remembered "Waiting for you" older than this is not shown any more. */
const WAITING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Remember what the research on this computer announced (an empty list forgets it). */
export function noteResearchLinks(links: readonly ResearchLinkAction[]): void {
    try {
        if (links.length === 0) localStorage.removeItem(LINKS_KEY);
        else localStorage.setItem(LINKS_KEY, JSON.stringify({ actions: links, at: new Date().toISOString() }));
    } catch { /* no storage: the features just stay hidden */ }
}

/** The announced actions, whether or not the user switched them off. */
export function announcedResearchLinks(): ResearchLinkAction[] {
    try {
        const raw = localStorage.getItem(LINKS_KEY);
        return raw ? sanitizeResearchLinks((JSON.parse(raw) as { actions?: unknown }).actions) : [];
    } catch {
        return [];
    }
}

export function researchLinksEnabled(): boolean {
    try { return localStorage.getItem(OFF_KEY) !== '1'; } catch { return true; }
}

export function setResearchLinksEnabled(on: boolean): void {
    try {
        if (on) localStorage.removeItem(OFF_KEY);
        else localStorage.setItem(OFF_KEY, '1');
    } catch { /* ignore */ }
}

/** What the research last said waits for the user (from its status), and when. */
export interface StoredResearchWaiting {
    items: LiveWaiting[];
    /** When the research said so (ms). */
    at: number;
    /** A newer Strom Research was out. */
    update: { version: string } | null;
    /** The last send it took in. */
    lastIntake: LiveIntake | null;
}

/**
 * Remember the research's "waiting" list (task id, text, time and person ref only), the
 * update it announced and its last intake, per research tree.
 */
export function noteResearchWaiting(
    researchId: string,
    items: readonly LiveWaiting[],
    extra: { update?: { version: string } | null; lastIntake?: LiveIntake | null } = {}
): void {
    try {
        const kept = items.map(w => ({ id: w.id, what: w.what, at: w.at, ...(w.person ? { person: w.person } : {}) }));
        localStorage.setItem(WAITING_KEY + researchId, JSON.stringify({
            items: kept,
            at: new Date().toISOString(),
            ...(extra.update ? { update: extra.update } : {}),
            ...(extra.lastIntake ? { lastIntake: extra.lastIntake } : {}),
        }));
    } catch { /* no storage: the count just is not remembered */ }
}

/** Drop the remembered tasks (an archive has none for the user); its update and last send stay. */
export function forgetResearchWaitingItems(researchId: string): void {
    try {
        const raw = localStorage.getItem(WAITING_KEY + researchId);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!Array.isArray(parsed.items) || parsed.items.length === 0) return;
        localStorage.setItem(WAITING_KEY + researchId, JSON.stringify({ ...parsed, items: [] }));
    } catch { /* nothing remembered */ }
}

/** The remembered list, or null when there is none or it is older than a week. */
export function storedResearchWaiting(researchId: string, now = Date.now()): StoredResearchWaiting | null {
    try {
        const raw = localStorage.getItem(WAITING_KEY + researchId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { items?: unknown; at?: unknown; update?: unknown; lastIntake?: unknown };
        const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : NaN;
        if (!Number.isFinite(at) || now - at > WAITING_MAX_AGE_MS) return null;
        return {
            items: sanitizeWaiting(parsed.items),
            at,
            update: sanitizeUpdate(parsed.update),
            lastIntake: sanitizeIntake(parsed.lastIntake),
        };
    } catch {
        return null;
    }
}

/**
 * The research's bridge on this computer, per research tree: its address (the
 * token stays, the port can change — every ?live= / ?send= rewrites it), what
 * it takes from the app (`accepts`, kept after the bridge stops: a research
 * that once said so still does) and its last known head.
 */
export interface StoredResearchBridge {
    /** `http://127.0.0.1:<port>/<token>`, or '' when only `accepts` is known. */
    base: string;
    accepts: ResearchAccepts | null;
    /** The research's head at the last status ('' = unknown). */
    head: string;
}

export function storedResearchBridge(researchId: string): StoredResearchBridge | null {
    try {
        const raw = localStorage.getItem(BRIDGE_KEY + researchId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { base?: unknown; accepts?: unknown; head?: unknown };
        const base = parseLiveBridge(parsed.base)?.base ?? '';
        const head = isResearchHead(parsed.head) ?? '';
        return { base, accepts: sanitizeAccepts(parsed.accepts), head };
    } catch {
        return null;
    }
}

function writeBridge(researchId: string, value: StoredResearchBridge): void {
    try {
        localStorage.setItem(BRIDGE_KEY + researchId, JSON.stringify({
            base: value.base,
            ...(value.accepts ? { accepts: {
                sync: { auto: value.accepts.syncAuto }, sources: value.accepts.sources,
                verified: value.accepts.verified, ...(value.accepts.media ? { media: {
                    ...(value.accepts.mediaMaxBytes ? { max: value.accepts.mediaMaxBytes } : {}),
                    ...(value.accepts.mediaRegion ? { region: true } : {}),
                    ...(value.accepts.mediaBatch ? { batch: value.accepts.mediaBatch } : {}),
                    ...(value.accepts.mediaEstimate ? { estimate: value.accepts.mediaEstimate } : {}),
                } } : {}),
                // Said by the bridge: kept either way (an archive switched back to research too).
                ...(value.accepts.mode === 'archive' ? { mode: 'archive' } : value.accepts.modeSaid ? { mode: 'research' } : {}),
            } } : {}),
            ...(value.head ? { head: value.head } : {}),
        }));
    } catch { /* no storage: the bridge is found again at the next ?live= / ?send= */ }
}

/** Does this browser know the bridge of any research (one that hands its bridge over, 1.11+)? */
export function anyResearchBridgeKnown(): boolean {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(BRIDGE_KEY) && storedResearchBridge(key.slice(BRIDGE_KEY.length))?.base) return true;
        }
    } catch { /* no storage */ }
    return false;
}

/**
 * The research this browser last reached at `base`: the same address (port
 * and token), else the only one known on that port. Null when none or not one.
 */
export function researchIdAtBridge(base: string): string | null {
    const target = parseLiveBridge(base);
    if (!target) return null;
    const port = (b: string): string => { try { return new URL(b).port; } catch { return ''; } };
    const onPort: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(BRIDGE_KEY)) continue;
            const id = key.slice(BRIDGE_KEY.length);
            const known = storedResearchBridge(id)?.base;
            if (!known) continue;
            if (known === target.base) return id;
            if (port(known) === port(target.base)) onPort.push(id);
        }
    } catch { /* no storage */ }
    return onPort.length === 1 ? onPort[0] : null;
}

/** The research reached this page at `base` (?live= / ?send= / a status from it): remember where. */
export function noteResearchBridge(researchId: string, base: string): void {
    const bridge = parseLiveBridge(base);
    if (!bridge) return;
    const prev = storedResearchBridge(researchId);
    writeBridge(researchId, { base: bridge.base, accepts: prev?.accepts ?? null, head: prev?.head ?? '' });
}

/** What the bridge's status said: its `accepts` (only when it says) and head. */
export function noteResearchBridgeStatus(researchId: string, accepts: ResearchAccepts | null, head: string): void {
    const prev = storedResearchBridge(researchId);
    writeBridge(researchId, {
        base: prev?.base ?? '',
        accepts: accepts ?? prev?.accepts ?? null,
        head: isResearchHead(head) ?? prev?.head ?? '',
    });
}

// ==================== "WHAT WILL BE SENT" FIRST (per tree, this browser) ====================

/** The user said "Send without preview next time" for this tree (sending by hand then goes at once). */
export function researchSendPreviewSkipped(treeId: string): boolean {
    return researchAutoState(treeId).skipPreview === true;
}

export function noteResearchSendPreviewSkipped(treeId: string, skip: boolean): void {
    patchResearchAutoState(treeId, { skipPreview: skip ? true : undefined });
}

// ==================== SENDING BY ITSELF (per tree, this browser) ====================

const AUTO_KEY = 'strom-research-auto:';
const INTRO_KEY = 'strom-research-auto-intro-seen';

/**
 * What this browser keeps about a research tree's sending, beside the tree's
 * research link: the last send the research wrote (it outlives loading the
 * new version), the research's mode as last shown (a switch is said once),
 * the one-time offer to send by itself, and the user's edits not sent yet.
 */
export interface ResearchAutoState {
    /** The last send the research wrote, and the conflicts it left. */
    lastWritten?: { at: string; changes: number | null; conflicts: number; persons?: string[]; conflictIds?: string[]; intake?: string; fingerprint?: string };
    /** The research's mode the user last saw ("switched" is said once). */
    modeSeen?: 'agent' | 'archive';
    /** When the mode last switched (ISO): the line in Research for this tree. */
    modeSince?: string;
    /** The offer to send by itself (an archive, a tree sent by hand) was answered. */
    offerSeen?: true;
    /** Edits since the last send ("3 changes waiting"). */
    edits?: number;
    /** When the first of those edits was made (ISO): the "only in browser" pill waits 10 minutes from it. */
    unsentSince?: string;
    /** The reasons a refusal was already told (once each). */
    toldRefused?: string[];
    /** The research's conflicts read from a version that was not loaded (see ResearchHeldConflicts). */
    held?: ResearchHeldConflicts;
    /** Sends taken back that this app had written again (`/again`), by their marks: never offered again (finding B2). */
    resent?: string[];
    /**
     * The last copy of this tree the research took in (its mark), and the head
     * the tree stood on when it went: while the tree still stands there (the
     * research's version not loaded since), the next copy is that one plus the
     * edits since (`_STROM_SINCE`) — written, nothing new, or beside a send
     * taken back alike.
     */
    lastCopy?: { intake: string; base: string };
    /**
     * The backup taken before the research's version was last loaded, and the
     * tree's fingerprint right after that load: "Restore the state before
     * loading" is offered while the tree is still just that (no edit since).
     */
    loadBackup?: { id: string; at: string; fingerprint: string; before?: ResearchLinkBefore };
    /** A backup was taken before this tree's first send from this browser. */
    firstSendBackup?: true;
    /** How changes go was chosen or asked once (the hand-over, or the one-time question after 3.9). */
    modeAsked?: true;
    /** Sends by hand the research wrote: after a few, sending by itself is offered (once). */
    manualWrites?: number;
    /** "Send without preview next time": sending by hand goes at once (unless the tie asks for a preview). */
    skipPreview?: true;
    /**
     * The last written send left changes unwritten: what the research named (person, fact, why) and how
     * many it did not name, by the send's fingerprint. It stays the state until the next send is written;
     * `seen` once the list was shown (no dot then).
     */
    notWritten?: ResearchNotWritten;
}

/** What a written send did not write (`ResearchAutoState.notWritten`). */
export interface ResearchNotWritten {
    at: string;
    fingerprint: string;
    /** Changes the research wrote (its `applied`). */
    written: number;
    items: { person: string; fact: string; why: string }[];
    /** Changes it counted but neither wrote nor named. */
    unexplained: number;
    seen?: true;
}

/** The tie as it stood before the research's version was loaded: what a restore of that backup builds on again (V-B). */
export interface ResearchLinkBefore {
    head: string;
    fingerprint: string;
    syncedAt: string;
    sent?: ResearchSend;
}

/**
 * The research's conflicts as its version has them, read without loading that
 * version (it holds the research's values where they are open, finding 40):
 * what a conflict says now — the user's latest value in it — and whose values
 * that version would take over. Stands while the tree builds on `base`.
 */
export interface ResearchHeldConflicts {
    /** The research's head the tree builds on (its link's head) when read. */
    base: string;
    /** The research's head read. */
    head: string;
    /** Person id → the research's conflicts of that person, where they differ from the tree's. */
    persons: Record<string, ResearchConflict[]>;
    /** People whose values that version would replace over an open conflict. */
    takeovers: string[];
}

/** At most this many people's conflicts are kept (a large first write). */
const HELD_MAX_PERSONS = 50;

function heldConflictsFrom(v: unknown): ResearchHeldConflicts | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const h = v as Record<string, unknown>;
    if (typeof h.base !== 'string' || typeof h.head !== 'string' || !h.persons || typeof h.persons !== 'object') return undefined;
    const persons: Record<string, ResearchConflict[]> = {};
    for (const [id, list] of Object.entries(h.persons as Record<string, unknown>).slice(0, HELD_MAX_PERSONS)) {
        if (!Array.isArray(list)) continue;
        persons[id] = list.filter((c): c is ResearchConflict => !!c && typeof c === 'object'
            && typeof (c as ResearchConflict).id === 'string' && Array.isArray((c as ResearchConflict).values)
            && ((c as ResearchConflict).status === 'open' || (c as ResearchConflict).status === 'decided'));
    }
    const takeovers = Array.isArray(h.takeovers) ? h.takeovers.filter((x): x is string => typeof x === 'string').slice(0, HELD_MAX_PERSONS) : [];
    return { base: h.base, head: h.head, persons, takeovers };
}

/** Keep at most HELD_MAX_PERSONS people of a reading (the takeovers first). */
export function trimHeldConflicts(held: ResearchHeldConflicts): ResearchHeldConflicts {
    const ids = Object.keys(held.persons);
    if (ids.length <= HELD_MAX_PERSONS) return held;
    const keep = [...held.takeovers.filter(id => id in held.persons), ...ids.filter(id => !held.takeovers.includes(id))].slice(0, HELD_MAX_PERSONS);
    return { ...held, persons: Object.fromEntries(keep.map(id => [id, held.persons[id]])) };
}

export function researchAutoState(treeId: string): ResearchAutoState {
    try {
        const raw = localStorage.getItem(AUTO_KEY + treeId);
        if (!raw) return {};
        const p = JSON.parse(raw) as Record<string, unknown>;
        const out: ResearchAutoState = {};
        const lw = p.lastWritten as Record<string, unknown> | undefined;
        if (lw && typeof lw.at === 'string' && Number.isFinite(Date.parse(lw.at))) {
            out.lastWritten = {
                at: lw.at,
                changes: typeof lw.changes === 'number' && lw.changes >= 0 ? Math.floor(lw.changes) : null,
                conflicts: typeof lw.conflicts === 'number' && lw.conflicts > 0 ? Math.floor(lw.conflicts) : 0,
                ...(Array.isArray(lw.persons) ? { persons: lw.persons.filter((x): x is string => typeof x === 'string').slice(0, 20) } : {}),
                ...(Array.isArray(lw.conflictIds) ? { conflictIds: lw.conflictIds.filter((x): x is string => typeof x === 'string' && /^X\d{1,9}$/.test(x)).slice(0, 20) } : {}),
                ...(typeof lw.intake === 'string' ? { intake: lw.intake } : {}),
                ...(typeof lw.fingerprint === 'string' ? { fingerprint: lw.fingerprint } : {}),
            };
        }
        if (p.modeSeen === 'agent' || p.modeSeen === 'archive') out.modeSeen = p.modeSeen;
        if (typeof p.modeSince === 'string' && Number.isFinite(Date.parse(p.modeSince))) out.modeSince = p.modeSince;
        if (p.offerSeen === true) out.offerSeen = true;
        if (typeof p.edits === 'number' && p.edits > 0) out.edits = Math.min(Math.floor(p.edits), 99999);
        if (typeof p.unsentSince === 'string' && Number.isFinite(Date.parse(p.unsentSince))) out.unsentSince = p.unsentSince;
        if (Array.isArray(p.toldRefused)) out.toldRefused = p.toldRefused.filter((r): r is string => typeof r === 'string').slice(-10);
        const held = heldConflictsFrom(p.held);
        if (held) out.held = held;
        const lc = p.lastCopy as Record<string, unknown> | undefined;
        if (lc && typeof lc.intake === 'string' && lc.intake.length <= 80 && typeof lc.base === 'string') out.lastCopy = { intake: lc.intake, base: lc.base };
        if (Array.isArray(p.resent)) out.resent = p.resent.filter((r): r is string => typeof r === 'string' && r.length <= 80).slice(-30);
        const lb = p.loadBackup as Record<string, unknown> | undefined;
        if (lb && typeof lb.id === 'string' && lb.id.length <= 80 && typeof lb.at === 'string' && Number.isFinite(Date.parse(lb.at))
            && typeof lb.fingerprint === 'string') {
            const b = lb.before as Record<string, unknown> | undefined;
            const sent = b?.sent as ResearchSend | undefined;
            const before: ResearchLinkBefore | undefined = b && typeof b.head === 'string' && typeof b.fingerprint === 'string' && typeof b.syncedAt === 'string'
                ? { head: b.head, fingerprint: b.fingerprint, syncedAt: b.syncedAt,
                    ...(sent && typeof sent === 'object' && typeof sent.fingerprint === 'string' && typeof sent.at === 'string' && typeof sent.state === 'string' ? { sent } : {}) }
                : undefined;
            out.loadBackup = { id: lb.id, at: lb.at, fingerprint: lb.fingerprint, ...(before ? { before } : {}) };
        }
        if (p.firstSendBackup === true) out.firstSendBackup = true;
        if (p.modeAsked === true) out.modeAsked = true;
        if (typeof p.manualWrites === 'number' && p.manualWrites > 0) out.manualWrites = Math.min(Math.floor(p.manualWrites), 9999);
        if (p.skipPreview === true) out.skipPreview = true;
        const nw = p.notWritten as Record<string, unknown> | undefined;
        if (nw && typeof nw.at === 'string' && typeof nw.fingerprint === 'string' && Array.isArray(nw.items)) {
            out.notWritten = {
                at: nw.at, fingerprint: nw.fingerprint,
                written: typeof nw.written === 'number' && nw.written >= 0 ? Math.floor(nw.written) : 0,
                items: nw.items.slice(0, 50).map(i => i as Record<string, unknown>).filter(i => !!i && typeof i === 'object')
                    .map(i => ({ person: typeof i.person === 'string' ? i.person.slice(0, 12) : '', fact: typeof i.fact === 'string' ? i.fact.slice(0, 8) : '',
                        why: typeof i.why === 'string' ? i.why.slice(0, 12) : '' })),
                unexplained: typeof nw.unexplained === 'number' && nw.unexplained > 0 ? Math.floor(nw.unexplained) : 0,
                ...(nw.seen === true ? { seen: true as const } : {}),
            };
        }
        return out;
    } catch {
        return {};
    }
}

/** Change part of it (undefined removes a field). */
export function patchResearchAutoState(treeId: string, patch: Partial<ResearchAutoState>): void {
    try {
        const next: Record<string, unknown> = { ...researchAutoState(treeId), ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        localStorage.setItem(AUTO_KEY + treeId, JSON.stringify(next));
    } catch { /* no storage: the notices may show again */ }
}

/** "Changes now go to the research by themselves" was shown once on this install. */
export function researchAutoIntroSeen(): boolean {
    try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; }
}

export function noteResearchAutoIntroSeen(): void {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* shown again next time */ }
}
