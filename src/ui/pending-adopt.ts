/**
 * The hand-over (?adopt=) a tab is in, kept in sessionStorage until it ends:
 * a reload meanwhile — the browser's own advice after allowing local network
 * access — asks again instead of losing it and quietly following the tree's
 * old research.
 */

/** sessionStorage: the ?adopt= of this tab while its hand-over is under way (see adoptFromResearch). */
export const PENDING_ADOPT_KEY = 'strom-pending-adopt';
/** A hand-over waits that long at most (the research's token holds less). */
const PENDING_ADOPT_MAX_MS = 60 * 60 * 1000;

export function setPendingAdopt(raw: string): void {
    try { sessionStorage.setItem(PENDING_ADOPT_KEY, JSON.stringify({ raw, at: Date.now() })); } catch { /* no storage: as before */ }
}

export function clearPendingAdopt(raw: string): void {
    try {
        const held = JSON.parse(sessionStorage.getItem(PENDING_ADOPT_KEY) ?? 'null') as { raw?: string } | null;
        if (held?.raw === raw) sessionStorage.removeItem(PENDING_ADOPT_KEY);
    } catch { /* nothing kept */ }
}

/** The hand-over this tab was in when it was reloaded, or null. */
export function pendingAdopt(): string | null {
    try {
        const held = JSON.parse(sessionStorage.getItem(PENDING_ADOPT_KEY) ?? 'null') as { raw?: unknown; at?: unknown } | null;
        if (held && typeof held.raw === 'string' && typeof held.at === 'number' && Date.now() - held.at < PENDING_ADOPT_MAX_MS) return held.raw;
        sessionStorage.removeItem(PENDING_ADOPT_KEY);
    } catch { /* nothing kept */ }
    return null;
}
