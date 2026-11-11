/**
 * How each section of research following is shown: expanded, collapsed or
 * hidden, one choice for the small live panel and the Research overview.
 * A section without a choice shows as each place has it by default (the
 * panel folds some by itself for lack of room, the overview keeps Queue and
 * What the research knows folded). Kept on this device for all trees;
 * nothing is synchronised.
 *
 * Every write sends `strom:live-section-prefs` on the document; a change
 * made in another tab (the `storage` event) sends the same, so one listener
 * redraws the panel, the overview and Settings.
 *
 * The same record keeps the sections' order (one order for both places;
 * the panel skips the two the overview alone has) and what the top shows
 * (the parts of the summary tiles, "Follow in"; the cost is hidden until
 * switched on). Record v2: `{ v: 2, s, o?, t? }`; a v1 record (`{ v: 1, s }`)
 * reads as the same choices with the default order and top.
 *
 * Also here: which items of "Awaiting action" were seen expanded, per tree
 * (for "N new" in the heading of a collapsed or hidden section), and which
 * items count as important (a decision or a permission the agent stands on).
 */

import type { LiveWaiting } from '../research-link.js';

export type SectionPref = 'expanded' | 'collapsed' | 'hidden';
export type PrefKey = 'working' | 'waiting' | 'changes' | 'queue' | 'directions' | 'knows';
export type SectionPrefs = Partial<Record<PrefKey, SectionPref>>;

/** In the panel's order, then the two the overview alone has. */
export const PREF_KEYS: readonly PrefKey[] = ['working', 'waiting', 'changes', 'queue', 'directions', 'knows'];
/** The sections the small panel has. */
export type PanelPrefKey = 'working' | 'waiting' | 'changes' | 'queue';
export const PANEL_PREF_KEYS: readonly PrefKey[] = ['working', 'waiting', 'changes', 'queue'];
const VALUES: readonly SectionPref[] = ['expanded', 'collapsed', 'hidden'];

export const SECTION_PREFS_KEY = 'strom-live-section-prefs';
export const SECTION_PREFS_EVENT = 'strom:live-section-prefs';
/** The fold choices before one setting for both places (read once, by the migration; never written or removed here). */
export const OLD_PANEL_KEY = 'strom-live-sections';
export const OLD_OVERVIEW_KEY = 'strom-live-overview-sections';
/** The items to do seen with "Awaiting action" expanded: `{ [treeId]: id[] }`. */
export const WAITING_SEEN_KEY = 'strom-live-waiting-seen';

/** The overview's section keys by the choice they follow (the panel's keys are the choices' own). */
const OVERVIEW_KEYS: Record<PrefKey, string> = {
    working: 'now', waiting: 'waiting', changes: 'timeline', queue: 'queue', directions: 'directions', knows: 'knows',
};

/** The choice an overview section follows ('now' → working, 'timeline' → changes); null: none. */
export function prefKeyOfOverview(key: string): PrefKey | null {
    return PREF_KEYS.find(k => OVERVIEW_KEYS[k] === key) ?? null;
}

/** The overview's key of a choice. */
export function overviewKeyOf(key: PrefKey): string {
    return OVERVIEW_KEYS[key];
}

function isPrefKey(k: string): k is PrefKey {
    return (PREF_KEYS as readonly string[]).includes(k);
}

/** Known keys with known values only; anything else is dropped. */
function clean(raw: unknown): SectionPrefs {
    const out: SectionPrefs = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (isPrefKey(k) && typeof v === 'string' && (VALUES as readonly string[]).includes(v)) out[k] = v as SectionPref;
    }
    return out;
}

/** An old fold record (`{ section: folded }`), booleans only. */
function readOld(key: string): Record<string, boolean> {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        const out: Record<string, boolean> = {};
        if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * The choices the old fold records stand for: the overview's first, the
 * panel's over them (the panel is always in view; its choice is the one the
 * user knows). `waiting: false` is no choice: the panel wrote it by itself
 * when a new item came, so it stays the default. Exported for the tests.
 */
export function migratedSectionPrefs(panel: Record<string, boolean>, overview: Record<string, boolean>): SectionPrefs {
    const out: SectionPrefs = {};
    const take = (key: PrefKey | null, folded: boolean): void => {
        if (!key) return;
        if (key === 'waiting' && !folded) return;
        out[key] = folded ? 'collapsed' : 'expanded';
    };
    for (const [k, v] of Object.entries(overview)) take(prefKeyOfOverview(k), v);
    for (const [k, v] of Object.entries(panel)) take(isPrefKey(k) && PANEL_PREF_KEYS.includes(k) ? k : null, v);
    return out;
}

// ==================== Order and the top ====================

/** The default order: Now, Awaiting action, Directions, Progress, Queue, What the research knows (the panel filters it). */
export const DEFAULT_ORDER: readonly PrefKey[] = ['working', 'waiting', 'directions', 'changes', 'queue', 'knows'];

/** The parts of the top: the 24 h tile's people and sources, this month's sessions and cost, "Follow in". */
export type TopKey = 'day.persons' | 'day.sources' | 'month.sessions' | 'month.price' | 'followIn';
export type TopPrefs = Partial<Record<TopKey, boolean>>;
export const TOP_KEYS: readonly TopKey[] = ['day.persons', 'day.sources', 'month.sessions', 'month.price', 'followIn'];
/** Without a choice: everything but the cost. */
export const TOP_DEFAULTS: Readonly<Record<TopKey, boolean>> = {
    'day.persons': true, 'day.sources': true, 'month.sessions': true, 'month.price': false, followIn: true,
};
export type TopTile = 'day' | 'month';
const TILE_PARTS: Record<TopTile, readonly [TopKey, TopKey]> = {
    day: ['day.persons', 'day.sources'],
    month: ['month.sessions', 'month.price'],
};

/** Everything kept in the record: the choices, the order (none: the default), the top's choices. */
export interface SectionPrefsSnapshot { s: SectionPrefs; o?: PrefKey[]; t?: TopPrefs }

/** Known keys, no repeats (the stored order as it was written). */
function cleanOrder(raw: unknown): PrefKey[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: PrefKey[] = [];
    for (const k of raw) if (typeof k === 'string' && isPrefKey(k) && !out.includes(k)) out.push(k);
    return out.length > 0 ? out : undefined;
}

/** Known keys with booleans only. */
function cleanTop(raw: unknown): TopPrefs | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: TopPrefs = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if ((TOP_KEYS as readonly string[]).includes(k) && typeof v === 'boolean') out[k as TopKey] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function cleanSnapshot(raw: unknown): SectionPrefsSnapshot {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { s?: unknown; o?: unknown; t?: unknown };
    const out: SectionPrefsSnapshot = { s: clean(r.s) };
    const o = cleanOrder(r.o);
    if (o) out.o = o;
    const t = cleanTop(r.t);
    if (t) out.t = t;
    return out;
}

/** The top's choices that differ from the default (a part switched back is no choice). */
function pruneTop(t: TopPrefs | undefined): TopPrefs | undefined {
    if (!t) return undefined;
    const out: TopPrefs = {};
    for (const k of TOP_KEYS) if (t[k] !== undefined && t[k] !== TOP_DEFAULTS[k]) out[k] = t[k];
    return Object.keys(out).length > 0 ? out : undefined;
}

function writeRecord(rec: SectionPrefsSnapshot): void {
    const out: { v: 2; s: SectionPrefs; o?: PrefKey[]; t?: TopPrefs } = { v: 2, s: rec.s };
    if (rec.o && rec.o.length > 0) out.o = rec.o;
    const t = pruneTop(rec.t);
    if (t) out.t = t;
    try {
        localStorage.setItem(SECTION_PREFS_KEY, JSON.stringify(out));
    } catch { /* not kept */ }
}

/** The whole record as kept (read through the migration of the old fold records, as `sectionPrefs`). */
export function sectionPrefsSnapshot(): SectionPrefsSnapshot {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(SECTION_PREFS_KEY);
    } catch {
        return { s: {} };
    }
    if (raw === null) {
        const prefs = migratedSectionPrefs(readOld(OLD_PANEL_KEY), readOld(OLD_OVERVIEW_KEY));
        writeRecord({ s: prefs });
        return { s: prefs };
    }
    try {
        return cleanSnapshot(JSON.parse(raw));
    } catch {
        return { s: {} };
    }
}

/** Read, change, write: the fields a change does not touch stay as they were. */
function update(change: (rec: SectionPrefsSnapshot) => SectionPrefsSnapshot): void {
    writeRecord(change(sectionPrefsSnapshot()));
}

/** What the top shows: each part, the default where no choice is made. */
export function topPrefs(): Record<TopKey, boolean> {
    return { ...TOP_DEFAULTS, ...sectionPrefsSnapshot().t };
}

/** Show or hide one part of the top. */
export function setTopPref(key: TopKey, on: boolean): void {
    if (topPrefs()[key] === on) return;
    update(rec => ({ ...rec, t: { ...rec.t, [key]: on } }));
    announce();
}

/** Whether a tile shows: one of its parts does (the 24 h tile: people or sources; this month: sessions or cost). */
export function topTileShown(top: Readonly<Record<TopKey, boolean>>, tile: TopTile): boolean {
    const [a, b] = TILE_PARTS[tile];
    return top[a] || top[b];
}

/**
 * The parts after a tile is switched (pure): off = both parts off; on with
 * both off = the parts' defaults (24 h: both; this month: sessions, the cost
 * as by default); on with a part on = unchanged.
 */
export function topAfterTile(top: Readonly<Record<TopKey, boolean>>, tile: TopTile, on: boolean): Record<TopKey, boolean> {
    const [a, b] = TILE_PARTS[tile];
    const out = { ...top };
    if (!on) {
        out[a] = false;
        out[b] = false;
    } else if (!top[a] && !top[b]) {
        out[a] = TOP_DEFAULTS[a];
        out[b] = TOP_DEFAULTS[b];
    }
    return out;
}

/** Switch a whole tile (see `topAfterTile`). */
export function setTopTile(tile: TopTile, on: boolean): void {
    const before = topPrefs();
    const after = topAfterTile(before, tile, on);
    const [a, b] = TILE_PARTS[tile];
    if (before[a] === after[a] && before[b] === after[b]) return;
    update(rec => ({ ...rec, t: { ...rec.t, [a]: after[a], [b]: after[b] } }));
    announce();
}

/**
 * The order of a stored list (pure): its known keys without repeats, the
 * missing ones put in as the default order has them (right after the
 * nearest one before them in it; first when none is).
 */
export function completeOrder(stored: readonly string[] | undefined): PrefKey[] {
    const out: PrefKey[] = [];
    for (const k of stored ?? []) if (isPrefKey(k) && !out.includes(k)) out.push(k);
    DEFAULT_ORDER.forEach((k, i) => {
        if (out.includes(k)) return;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
            const pos = out.indexOf(DEFAULT_ORDER[j]);
            if (pos >= 0) { at = pos + 1; break; }
        }
        out.splice(at, 0, k);
    });
    return out;
}

/** The sections' order (all six; the panel takes its four from it). */
export function sectionOrder(): PrefKey[] {
    return completeOrder(sectionPrefsSnapshot().o);
}

/** The panel's sections in an order (the two the overview alone has left out). */
export function panelSectionOrder(order: readonly PrefKey[] = sectionOrder()): PanelPrefKey[] {
    return order.filter((k): k is PanelPrefKey => PANEL_PREF_KEYS.includes(k));
}

/**
 * The sections the panel folds by itself, in this order, when it runs out
 * of room: from the bottom of its order up, never "Awaiting action" (the
 * default order: Up next, Changes, Working).
 */
export function autoFoldOrder(order: readonly PrefKey[] = sectionOrder()): PanelPrefKey[] {
    return panelSectionOrder(order).filter(k => k !== 'waiting').reverse();
}

function sameOrder(a: readonly PrefKey[], b: readonly PrefKey[]): boolean {
    return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Keep an order (the default one is kept as no choice). */
export function setSectionOrder(order: readonly string[]): void {
    const next = completeOrder(order);
    if (sameOrder(next, sectionOrder())) return;
    update(rec => ({ ...rec, o: sameOrder(next, DEFAULT_ORDER) ? undefined : next }));
    announce();
}

/**
 * The order after a section moves by `delta` places among those a place
 * shows (pure): the panel skips the two the overview alone has, the overview
 * and Settings move among all. A move is a swap with the neighbour that
 * place shows; past the end: unchanged.
 */
export function movedOrder(order: readonly PrefKey[], key: PrefKey, delta: number, place: 'panel' | 'overview' | 'settings'): PrefKey[] {
    const out = [...order];
    const visible = out.filter(k => place !== 'panel' || PANEL_PREF_KEYS.includes(k));
    const at = visible.indexOf(key);
    const to = at + delta;
    if (at < 0 || delta === 0 || to < 0 || to >= visible.length) return out;
    // Step by step: each step swaps with the next section shown there.
    let cur = at;
    while (cur !== to) {
        const next = cur + Math.sign(delta);
        const i = out.indexOf(visible[cur]);
        const j = out.indexOf(visible[next]);
        [out[i], out[j]] = [out[j], out[i]];
        [visible[cur], visible[next]] = [visible[next], visible[cur]];
        cur = next;
    }
    return out;
}

/** Move a section by `delta` places among those `place` shows (see `movedOrder`). */
export function moveSection(key: PrefKey, delta: number, place: 'panel' | 'overview' | 'settings'): void {
    setSectionOrder(movedOrder(sectionOrder(), key, delta, place));
}

function write(prefs: SectionPrefs): void {
    update(rec => ({ ...rec, s: prefs }));
}

function announce(): void {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(SECTION_PREFS_EVENT));
}

/** The choices made (a key missing = the default). The first read takes over the old fold records. */
export function sectionPrefs(): SectionPrefs {
    return sectionPrefsSnapshot().s;
}

/** Whether any choice is made, of a section, the order or the top (Restore defaults has something to do; Settings shows its group). */
export function hasSectionPrefs(): boolean {
    const rec = sectionPrefsSnapshot();
    return Object.keys(rec.s).length > 0 || !!rec.o || !!rec.t;
}

/** Choose how a section shows (both places). */
export function setSectionPref(key: PrefKey, value: SectionPref): void {
    const prefs = sectionPrefs();
    if (prefs[key] === value) return;
    write({ ...prefs, [key]: value });
    announce();
}

/**
 * Back to the defaults (the sections' states, the order, the top: the cost
 * hidden again); returns the record before, for Undo. Leaves the seen items
 * of "Awaiting action" alone.
 */
export function resetSectionPrefs(): SectionPrefsSnapshot {
    const before = sectionPrefsSnapshot();
    writeRecord({ s: {} });
    announce();
    return before;
}

/** Put the record back as it was (Undo of a reset or of hiding a section). */
export function restoreSectionPrefs(snapshot: SectionPrefsSnapshot): void {
    writeRecord(cleanSnapshot(snapshot));
    announce();
}

let storageWatched = false;
/** A choice made in another tab redraws this one too (once per page). */
export function watchSectionPrefsStorage(): void {
    if (storageWatched || typeof window === 'undefined') return;
    storageWatched = true;
    window.addEventListener('storage', (e) => {
        if (e.key === SECTION_PREFS_KEY || e.key === null) announce();
    });
}

// ==================== "Awaiting action": seen, new, important ====================

/**
 * An item the agent may stand on until it is answered: a permission, a
 * decision, a conflict about a place, or a task of the top priority.
 */
export function isImportantWaiting(w: LiveWaiting): boolean {
    return w.kind === 'permission' || w.section === 'decide' || w.question === 'conflict' || w.priority === 1;
}

function readSeen(): Record<string, string[]> {
    try {
        const parsed = JSON.parse(localStorage.getItem(WAITING_SEEN_KEY) ?? '{}') as Record<string, unknown>;
        const out: Record<string, string[]> = {};
        if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
                if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
            }
        }
        return out;
    } catch {
        return {};
    }
}

/** The items to do seen in a tree's "Awaiting action" (null: never noted there). */
export function waitingSeen(treeId: string): Set<string> | null {
    const ids = readSeen()[treeId];
    return ids ? new Set(ids) : null;
}

/**
 * Note what is to do now as seen (the section is expanded and in view, or a
 * first look): exactly today's list, so gone items drop out by themselves.
 * Writes only when it differs.
 */
export function noteWaitingSeen(treeId: string, todoIds: readonly string[]): void {
    const all = readSeen();
    const before = all[treeId];
    if (before && before.length === todoIds.length && todoIds.every(id => before.includes(id))) return;
    all[treeId] = [...todoIds];
    try {
        localStorage.setItem(WAITING_SEEN_KEY, JSON.stringify(all));
    } catch { /* not kept */ }
}

/** The items to do not seen yet ("N new"). */
export function newWaiting<T extends LiveWaiting>(todo: readonly T[], seen: ReadonlySet<string>): T[] {
    return todo.filter(w => !seen.has(w.id));
}
