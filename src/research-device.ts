/**
 * Strom Research on THIS computer: which strom-research:// links it handles.
 * A web page cannot tell whether a program registered a link scheme, so the
 * research announces it whenever it talks to the app from this computer (the
 * bridge status, a file it serves on 127.0.0.1). Remembered per browser; a
 * later contact without the announcement forgets it again. The user can also
 * switch the features off (Settings → Data).
 */

import { ResearchLinkAction, sanitizeResearchLinks } from './research-link.js';

const LINKS_KEY = 'strom-research-links';
const OFF_KEY = 'strom-research-links-off';

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
