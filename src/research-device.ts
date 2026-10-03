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
