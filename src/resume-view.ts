/**
 * Where the work ended, per tree (1101): the person in the centre and the view
 * (family, descendants, timeline, fan, map), plus the tree used last. Kept on
 * this device (localStorage), never in the tree's data.
 *
 * With Settings → "Continue where work ended" ON, a start opens the last tree
 * in that view with that person, and a tree load (switch) opens that tree's
 * point. OFF (the default), a tree load opens the family view with the tree's
 * start person (TreeRenderer.loadViewModeForCurrentTree).
 */

import type { ViewMode } from './types.js';

export const RESUME_STORAGE_KEY = 'strom-resume-points';

const VIEW_MODES: readonly ViewMode[] = ['family', 'descendants', 'timeline', 'fan', 'map'];

export interface ResumePoint {
    person: string;
    view: ViewMode;
    up?: number;
    down?: number;
}

interface ResumeStore {
    last?: string;
    trees: Record<string, ResumePoint>;
}

function isViewMode(v: unknown): v is ViewMode {
    return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

/** The stored points; anything malformed is dropped. */
export function parseResumeStore(raw: string | null): ResumeStore {
    const store: ResumeStore = { trees: {} };
    if (!raw) return store;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return store; }
    if (!data || typeof data !== 'object') return store;
    const d = data as { last?: unknown; trees?: unknown };
    if (typeof d.last === 'string' && d.last) store.last = d.last;
    if (d.trees && typeof d.trees === 'object') {
        for (const [treeId, p] of Object.entries(d.trees as Record<string, unknown>)) {
            if (!p || typeof p !== 'object') continue;
            const point = p as { person?: unknown; view?: unknown; up?: unknown; down?: unknown };
            if (typeof point.person !== 'string' || !point.person || !isViewMode(point.view)) continue;
            const kept: ResumePoint = { person: point.person, view: point.view };
            if (typeof point.up === 'number' && Number.isFinite(point.up)) kept.up = point.up;
            if (typeof point.down === 'number' && Number.isFinite(point.down)) kept.down = point.down;
            store.trees[treeId] = kept;
        }
    }
    return store;
}

function readStore(): ResumeStore {
    try { return parseResumeStore(localStorage.getItem(RESUME_STORAGE_KEY)); } catch { return { trees: {} }; }
}

function writeStore(store: ResumeStore): void {
    try { localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(store)); } catch { /* storage full or blocked */ }
}

/** Note where the work in `treeId` stands now (also makes it the last tree). */
export function recordResumePoint(treeId: string, point: ResumePoint): void {
    const store = readStore();
    const prev = store.trees[treeId];
    if (store.last === treeId && prev && prev.person === point.person && prev.view === point.view
        && prev.up === point.up && prev.down === point.down) return;
    store.last = treeId;
    store.trees[treeId] = { ...point };
    writeStore(store);
}

/** Where the work in `treeId` ended, or null. */
export function readResumePoint(treeId: string): ResumePoint | null {
    return readStore().trees[treeId] ?? null;
}

/** The tree the work went on in last, or null. */
export function lastResumeTreeId(): string | null {
    return readStore().last ?? null;
}
