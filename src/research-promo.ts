/**
 * Strom Research in the app (3.0) — the pure, testable half: who sees the
 * menu item, the "New" marker (label + trigger dots) and the one-time
 * "What's new in 3.0" card. The DOM half lives in src/ui/research-promo-ui.ts;
 * the site address in src/research-link.ts (researchSiteUrl).
 *
 * State is per browser (settings), never part of tree data.
 */

/** Days the "New" marker stays lit after it was first shown. */
export const NEW_MARKER_DAYS = 30;

/** Persisted promotion state (browser settings). */
export interface ResearchPromoState {
    /** ISO date the "New" marker was first shown. */
    researchNewFirstSeen?: string;
    /** The "New" marker went out for good. */
    researchNewDismissed?: boolean;
    /** The one-time "What's new in 3.0" card was shown. */
    whatsNew30Shown?: boolean;
}

/** Where the app runs and what it shows right now. */
export interface ResearchPromoContext {
    /** A standalone exported file (strom.html opened from disk). */
    embedded: boolean;
    /** Read-only view of an embedded file / shared copy. */
    viewMode: boolean;
    /** Locked local data or a pending password prompt. */
    locked: boolean;
    /** The open tree came from Strom Research (it has a research link). */
    researchTree: boolean;
    /** This start was an open from Strom Research's command line. */
    cliOpen: boolean;
}

/** Everything the one-time card additionally waits for. */
export interface WhatsNewContext extends ResearchPromoContext {
    /** The tree is loaded and rendered. */
    treeReady: boolean;
    /** The open tree has no persons (the welcome screen shows instead). */
    emptyTree: boolean;
    /** A dialog, sheet, import or merge offer is in the way. */
    busy: boolean;
    /** The interactive tour is running. */
    tourActive: boolean;
}

/** The menu item and the welcome-screen offer exist at all (not in exports / view mode). */
export function isPromoAvailable(ctx: Pick<ResearchPromoContext, 'embedded' | 'viewMode'>): boolean {
    return !ctx.embedded && !ctx.viewMode;
}

/** The menu item is offered (hidden behind a lock like every other action). */
export function isMenuItemVisible(ctx: ResearchPromoContext): boolean {
    return isPromoAvailable(ctx) && !ctx.locked;
}

/** The "New" marker has been lit for NEW_MARKER_DAYS (or longer). */
export function isNewMarkerExpired(state: ResearchPromoState, now: Date): boolean {
    if (!state.researchNewFirstSeen) return false;
    const first = Date.parse(state.researchNewFirstSeen);
    if (Number.isNaN(first)) return false;
    return now.getTime() - first >= NEW_MARKER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The "New" label and the trigger dots are lit: the item is offered, the tree
 * is not a research already, and the marker was neither dismissed nor lit
 * for 30 days. (An open from the command line still shows it.)
 */
export function isNewMarkerActive(state: ResearchPromoState, ctx: ResearchPromoContext, now: Date): boolean {
    return isMenuItemVisible(ctx)
        && !ctx.researchTree
        && state.researchNewDismissed !== true
        && !isNewMarkerExpired(state, now);
}

/**
 * The one-time card:
 * - `show`: show it now (and remember it was shown);
 * - `mark-shown`: a new user on the welcome screen — they meet the news
 *   there, so the card is never shown to them;
 * - `wait`: not now; ask again on a later start.
 */
export type WhatsNewDecision = 'show' | 'mark-shown' | 'wait';

export function decideWhatsNewCard(state: ResearchPromoState, ctx: WhatsNewContext): WhatsNewDecision {
    if (state.whatsNew30Shown === true) return 'wait';
    if (!isPromoAvailable(ctx) || ctx.locked || !ctx.treeReady) return 'wait';
    if (ctx.emptyTree) return 'mark-shown';
    if (ctx.researchTree || ctx.cliOpen || ctx.busy || ctx.tourActive) return 'wait';
    return 'show';
}
