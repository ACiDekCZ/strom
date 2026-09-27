/**
 * Strom Research on THIS computer: which strom-research:// links it handles.
 * A web page cannot tell whether a program registered a link scheme, so the
 * research announces it whenever it talks to the app from this computer (the
 * bridge status, a file it serves on 127.0.0.1). Remembered per browser; a
 * later contact without the announcement forgets it again. The user can also
 * switch the features off (Settings → Data).
 */

import { ResearchLinkAction, LiveWaiting, sanitizeResearchLinks, sanitizeWaiting } from './research-link.js';

const LINKS_KEY = 'strom-research-links';
const OFF_KEY = 'strom-research-links-off';
const WAITING_KEY = 'strom-research-waiting:';
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
}

/** Remember the research's "waiting" list (task id, text and time only) per research tree. */
export function noteResearchWaiting(researchId: string, items: readonly LiveWaiting[]): void {
    try {
        const kept = items.map(w => ({ id: w.id, what: w.what, at: w.at }));
        localStorage.setItem(WAITING_KEY + researchId, JSON.stringify({ items: kept, at: new Date().toISOString() }));
    } catch { /* no storage: the count just is not remembered */ }
}

/** The remembered list, or null when there is none or it is older than a week. */
export function storedResearchWaiting(researchId: string, now = Date.now()): StoredResearchWaiting | null {
    try {
        const raw = localStorage.getItem(WAITING_KEY + researchId);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { items?: unknown; at?: unknown };
        const at = typeof parsed.at === 'string' ? Date.parse(parsed.at) : NaN;
        if (!Number.isFinite(at) || now - at > WAITING_MAX_AGE_MS) return null;
        return { items: sanitizeWaiting(parsed.items), at };
    } catch {
        return null;
    }
}
