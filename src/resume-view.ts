/**
 * Which view a tree opens in (1101).
 *
 * - A tree load (start, opening or switching a tree) follows the tree's
 *   "Default view" (`StromData.defaultView`, in the default person dialog):
 *   the family view, or with 'last' the view last used with the tree on this
 *   device. The person always comes from the tree's default person.
 * - A reload of the page keeps the tree, the view and the person, whatever
 *   the settings say (the reload point below).
 *
 * The last used view is kept per tree on this device (localStorage), never in
 * the tree's data: a view switch must not make the tree dirty or sync.
 */

import type { ViewMode } from './types.js';

export const LAST_VIEW_STORAGE_KEY = 'strom-last-views';

const VIEW_MODES: readonly ViewMode[] = ['family', 'descendants', 'timeline', 'fan', 'map'];

function isViewMode(v: unknown): v is ViewMode {
    return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

/** The view a tree load opens: the family view unless the tree asks for the last used one and there is one. */
export function chooseStartView(defaultView: unknown, storedView: ViewMode | null | undefined): ViewMode {
    return defaultView === 'last' && isViewMode(storedView) ? storedView : 'family';
}

/** The stored last views per tree; anything malformed is dropped. */
export function parseLastViews(raw: string | null): Record<string, ViewMode> {
    const views: Record<string, ViewMode> = {};
    if (!raw) return views;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return views; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return views;
    for (const [treeId, view] of Object.entries(data as Record<string, unknown>)) {
        if (treeId && isViewMode(view)) views[treeId] = view;
    }
    return views;
}

function readLastViews(): Record<string, ViewMode> {
    try { return parseLastViews(localStorage.getItem(LAST_VIEW_STORAGE_KEY)); } catch { return {}; }
}

/** Note the view used with `treeId` now. */
export function recordLastView(treeId: string, view: ViewMode): void {
    const views = readLastViews();
    if (views[treeId] === view) return;
    views[treeId] = view;
    try { localStorage.setItem(LAST_VIEW_STORAGE_KEY, JSON.stringify(views)); } catch { /* storage full or blocked */ }
}

/** The view last used with `treeId` on this device, or null. */
export function readLastView(treeId: string): ViewMode | null {
    return readLastViews()[treeId] ?? null;
}

/** A tree deleted: its last view goes too. */
export function forgetLastView(treeId: string): void {
    const views = readLastViews();
    if (!(treeId in views)) return;
    delete views[treeId];
    try { localStorage.setItem(LAST_VIEW_STORAGE_KEY, JSON.stringify(views)); } catch { /* storage blocked */ }
}

// ==================== Reload point (1101) ====================

/**
 * A reload of the page in the same tab keeps the tree, the view and the
 * person (with the depths), whatever the settings say. Kept for the tab only
 * (sessionStorage) and used once, by the first tree load after a reload; a
 * new start (a new tab, an address opened again) follows the tree's settings.
 */
export const RELOAD_STORAGE_KEY = 'strom-reload-point';

export interface ReloadPoint {
    tree: string;
    person: string;
    view: ViewMode;
    up?: number;
    down?: number;
}

/** The stored reload point, or null when missing or malformed. */
export function parseReloadPoint(raw: string | null): ReloadPoint | null {
    if (!raw) return null;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    const d = data as { tree?: unknown; person?: unknown; view?: unknown; up?: unknown; down?: unknown };
    if (typeof d.tree !== 'string' || !d.tree || typeof d.person !== 'string' || !d.person || !isViewMode(d.view)) return null;
    const point: ReloadPoint = { tree: d.tree, person: d.person, view: d.view };
    if (typeof d.up === 'number' && Number.isFinite(d.up)) point.up = d.up;
    if (typeof d.down === 'number' && Number.isFinite(d.down)) point.down = d.down;
    return point;
}

/** Note where the work in this tab stands now, for a reload. */
export function recordReloadPoint(point: ReloadPoint): void {
    try { sessionStorage.setItem(RELOAD_STORAGE_KEY, JSON.stringify(point)); } catch { /* storage blocked */ }
}

/** Was this page load a reload (not a new start, a link or back/forward)? */
export function isReloadNavigation(): boolean {
    try {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return nav?.type === 'reload';
    } catch { return false; }
}

let reloadPointUsed = false;

/** The reload point while it still counts: a reload, before the first tree load used it. */
export function peekReloadPoint(): ReloadPoint | null {
    if (reloadPointUsed || !isReloadNavigation()) return null;
    try { return parseReloadPoint(sessionStorage.getItem(RELOAD_STORAGE_KEY)); } catch { return null; }
}

/** The reload point for the first tree load; every later call gets null. */
export function takeReloadPoint(): ReloadPoint | null {
    const point = peekReloadPoint();
    reloadPointUsed = true;
    return point;
}

/** Tests: the page starts again. */
export function resetReloadPointForTests(): void {
    reloadPointUsed = false;
}
