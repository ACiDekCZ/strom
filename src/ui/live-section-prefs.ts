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

function write(prefs: SectionPrefs): void {
    try {
        localStorage.setItem(SECTION_PREFS_KEY, JSON.stringify({ v: 1, s: prefs }));
    } catch { /* not kept */ }
}

function announce(): void {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(SECTION_PREFS_EVENT));
}

/** The choices made (a key missing = the default). The first read takes over the old fold records. */
export function sectionPrefs(): SectionPrefs {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(SECTION_PREFS_KEY);
    } catch {
        return {};
    }
    if (raw === null) {
        const prefs = migratedSectionPrefs(readOld(OLD_PANEL_KEY), readOld(OLD_OVERVIEW_KEY));
        write(prefs);
        return prefs;
    }
    try {
        const parsed = JSON.parse(raw) as { s?: unknown } | null;
        return clean(parsed?.s);
    } catch {
        return {};
    }
}

/** Whether any choice is made (Restore defaults has something to do; Settings shows its group). */
export function hasSectionPrefs(): boolean {
    return Object.keys(sectionPrefs()).length > 0;
}

/** Choose how a section shows (both places). */
export function setSectionPref(key: PrefKey, value: SectionPref): void {
    const prefs = sectionPrefs();
    if (prefs[key] === value) return;
    write({ ...prefs, [key]: value });
    announce();
}

/** Back to the defaults; returns the choices before, for Undo. Leaves the seen items of "Awaiting action" alone. */
export function resetSectionPrefs(): SectionPrefs {
    const before = sectionPrefs();
    write({});
    announce();
    return before;
}

/** Put choices back (Undo of a reset or of hiding a section). */
export function restoreSectionPrefs(snapshot: SectionPrefs): void {
    write(clean(snapshot));
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
