/**
 * The first start on a device of the home network (spec 094 §2): what the
 * start screen shows, whether a tree is to be chosen, a tree's row in the
 * chooser, the home-screen icon's quiet line and its "How" by system. Pure
 * decisions only; the screens are drawn by src/ui/device-start-ui.ts.
 */

import type { DeviceCode } from './device-mode';
import type { DeviceTree } from './device-store';
import { systemOf, type DeviceEnv } from '../device-client';

/** Where the start ends: the tree, a code that paired nothing, an icon not paired, or the plain page. */
export type DeviceStartEnd = 'tree' | 'codeBad' | 'homeUnpaired' | 'none';

/** What the device mode's start gave (the parts these decisions read). */
export interface DeviceStartFacts {
    /** The gateway answered its hello. */
    hello: boolean;
    code: DeviceCode | null;
    /** A pairing is held (stored or just made). */
    paired: boolean;
    /** The page runs as a home-screen icon (display-mode standalone). */
    standalone: boolean;
}

export function deviceStartEnd(f: DeviceStartFacts): DeviceStartEnd {
    if (f.paired) return 'tree';
    if (!f.hello) return 'none';
    // The icon's code that paired nothing, or the icon opened with no code and no pairing (2.8b).
    if (f.code?.kind === 'home' || (!f.code && f.standalone)) return 'homeUnpaired';
    if (f.code) return 'codeBad';
    return 'none';
}

/** Whether the start screen is drawn at all: only a start that pairs (a code in the address) or an icon's first open. */
export function deviceStartScreen(f: { code: DeviceCode | null; paired: boolean; standalone: boolean }): boolean {
    return !!f.code || (f.standalone && !f.paired);
}

/** The tree to open, or null: the person chooses (several trees, none chosen yet). */
export function deviceTreeToOpen(trees: readonly DeviceTree[], chosen: string | null): string | null {
    if (chosen && trees.some(t => t.id === chosen)) return chosen;
    return trees.length === 1 ? trees[0].id : null;
}

/**
 * The name the research's tree takes on the device after its first load, or null to keep it: a tree.ged
 * whose header names nothing was opened under the default name ("Research" in any language), while the
 * pairing knows the research's own name.
 */
export function deviceTreeRename(current: string, paired: string | undefined, defaults: readonly string[]): string | null {
    const name = (paired ?? '').trim();
    if (!name || name === current) return null;
    return !current.trim() || defaults.includes(current) ? name : null;
}

/** A tree's row in the chooser, read from its bridge's status (any field may be missing). */
export interface DeviceTreeRow {
    persons: number | null;
    working: boolean;
    waiting: number;
}

export function deviceTreeRow(status: unknown): DeviceTreeRow {
    const s = status && typeof status === 'object' ? status as Record<string, unknown> : {};
    const tree = s.tree && typeof s.tree === 'object' ? s.tree as Record<string, unknown> : {};
    const count = typeof s.persons === 'number' ? s.persons
        : typeof tree.persons === 'number' ? tree.persons : null;
    const persons = count !== null && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
    const working = Array.isArray(s.working) && s.working.length > 0;
    const waitingRaw = Array.isArray(s.waiting) ? s.waiting.length : typeof s.waiting === 'number' ? s.waiting : 0;
    const waiting = Number.isFinite(waitingRaw) && waitingRaw > 0 ? Math.floor(waitingRaw) : 0;
    return { persons, working, waiting };
}

/** Which "How" of the home-screen icon this device reads first. */
export type HomeHowSystem = 'ios' | 'android' | 'computer';

export function homeHowSystem(env: DeviceEnv): HomeHowSystem {
    const sys = systemOf(env);
    if (sys === 'iPhone' || sys === 'iPad') return 'ios';
    if (sys === 'Android') return 'android';
    return 'computer';
}

/** Whether the quiet line of the home-screen icon is due: once, never in the icon itself, gone for good after ×. */
export function homeLineDue(f: { hidden: boolean; standalone: boolean }): boolean {
    return !f.hidden && !f.standalone;
}

/**
 * The address of a home-screen icon the gateway made (`device/home`), as this
 * page's own path and hash — only of this very origin and with a home code.
 */
export function homeAddressHere(url: unknown, origin: string): string | null {
    if (typeof url !== 'string') return null;
    let u: URL;
    try { u = new URL(url, origin); } catch { return null; }
    if (u.origin !== origin) return null;
    if (!/^#home\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(u.hash)) return null;
    return `${u.pathname}${u.search}${u.hash}`;
}
