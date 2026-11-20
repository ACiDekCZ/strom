/**
 * The fan's look (spec 118 §10): its style, which family lines are coloured,
 * what the sectors write and the portraits. Three levels in one direction:
 *
 * - the default (Settings, kept on the device: FAN_STORAGE_KEYS),
 * - the current look (the Appearance panel, until the app is closed:
 *   sessionStorage, FAN_LOOK_SESSION_KEY; a reload of the tab keeps it),
 * - the output's own look (the poster dialog, not kept).
 *
 * A lower level never writes into a higher one, except "Save as default".
 * The look is no edit of the tree: it works read-only, while following the
 * research and in a saved page. A satellite window (spec 079) starts from the
 * main window's current look and keeps its changes in its memory only.
 */

import { FanStyle, FAN_STYLES, FanTheme, fanPalette, fanRodSlotColor, FanRodSlot } from './fan-colors.js';
import { FanRodScope, FAN_ROD_SCOPES } from './fan-rod-assign.js';
import { FanContent, FAN_CONTENTS } from './fan-labels.js';
import { FAN_STORAGE_KEYS, FAN_LOOK_SESSION_KEY } from './storage-keys.js';

export interface FanLook {
    style: FanStyle;
    rodScope: FanRodScope;
    content: FanContent;
    portraits: boolean;
}

/** The look of a first start (and of every value that cannot be read). */
export const FAN_LOOK_DEFAULT: Readonly<FanLook> = Object.freeze({ style: 'color', rodScope: 'all', content: 'years', portraits: false });

/** The same four choices (the only ones compared). */
export function sameFanLook(a: Readonly<FanLook>, b: Readonly<FanLook>): boolean {
    return a.style === b.style && a.rodScope === b.rodScope && a.content === b.content && a.portraits === b.portraits;
}

const isStyle = (v: unknown): v is FanStyle => typeof v === 'string' && (FAN_STYLES as readonly string[]).includes(v);
const isScope = (v: unknown): v is FanRodScope => typeof v === 'string' && (FAN_ROD_SCOPES as readonly string[]).includes(v);
const isContent = (v: unknown): v is FanContent => typeof v === 'string' && (FAN_CONTENTS as readonly string[]).includes(v);

/** The portraits' value: a boolean, or '1' / '0' as the device keeps it. */
function portraitsOf(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
}

/** A look from loose fields: each valid field taken, each other one from `fallback`. */
export function fanLookFrom(raw: Partial<Record<keyof FanLook, unknown>> | null | undefined, fallback: Readonly<FanLook> = FAN_LOOK_DEFAULT): FanLook {
    const r = raw ?? {};
    return {
        style: isStyle(r.style) ? r.style : fallback.style,
        rodScope: isScope(r.rodScope) ? r.rodScope : fallback.rodScope,
        content: isContent(r.content) ? r.content : fallback.content,
        portraits: portraitsOf(r.portraits) ?? fallback.portraits,
    };
}

/**
 * A look kept as JSON (or as an object): each valid field taken, each other
 * one (or all, when it does not parse) from `fallback`.
 */
export function parseFanLook(json: unknown, fallback: Readonly<FanLook> = FAN_LOOK_DEFAULT): FanLook {
    let raw: unknown = json;
    if (typeof json === 'string') {
        try { raw = JSON.parse(json); } catch { raw = null; }
    }
    const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    return fanLookFrom(obj, fallback);
}

/** A store of strings (localStorage, sessionStorage). */
export interface FanLookStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Where the look is kept; null: in the memory only (a satellite window, no storage). */
export interface FanLookStores {
    /** The default (Settings, "Save as default"). */
    local(): FanLookStore | null;
    /** The current look (the panel). */
    session(): FanLookStore | null;
}

function read(store: FanLookStore | null, key: string): string | null {
    try { return store?.getItem(key) ?? null; } catch { return null; }
}

/** The default as the device keeps it (four keys; each invalid one is the first start's). */
export function readFanLookDefault(store: FanLookStore | null): FanLook {
    return fanLookFrom({
        style: read(store, FAN_STORAGE_KEYS.style),
        rodScope: read(store, FAN_STORAGE_KEYS.rodScope),
        content: read(store, FAN_STORAGE_KEYS.content),
        portraits: read(store, FAN_STORAGE_KEYS.portraits),
    });
}

/**
 * The default and the current look of one window. The current look is kept
 * in the session only while it differs from the default (equal, it follows
 * the default: a reload reads the default again).
 */
export class FanLookState {
    private def: FanLook;
    private cur: FanLook;

    constructor(private readonly stores: FanLookStores) {
        this.def = readFanLookDefault(stores.local());
        const kept = read(stores.session(), FAN_LOOK_SESSION_KEY);
        this.cur = kept == null ? { ...this.def } : parseFanLook(kept, this.def);
    }

    /** The current look (what the screen shows). */
    look(): FanLook {
        return { ...this.cur };
    }

    /** The default look (Settings). */
    defaults(): FanLook {
        return { ...this.def };
    }

    differs(): boolean {
        return !sameFanLook(this.cur, this.def);
    }

    /** The current look changed by the panel (each invalid field ignored); false when nothing changed. */
    set(partial: Partial<Record<keyof FanLook, unknown>>): boolean {
        const next = fanLookFrom(partial, this.cur);
        if (sameFanLook(next, this.cur)) return false;
        this.cur = next;
        this.keepSession();
        return true;
    }

    /**
     * The default changed (Settings, "Save as default"): kept on the device;
     * the current look follows it only when it did not differ from the old
     * default (a look changed in the panel stays). False when nothing changed.
     */
    setDefault(look: Partial<Record<keyof FanLook, unknown>>): boolean {
        const next = fanLookFrom(look, this.def);
        if (sameFanLook(next, this.def)) return false;
        const followed = sameFanLook(this.cur, this.def);
        this.def = next;
        const store = this.stores.local();
        try {
            store?.setItem(FAN_STORAGE_KEYS.style, next.style);
            store?.setItem(FAN_STORAGE_KEYS.rodScope, next.rodScope);
            store?.setItem(FAN_STORAGE_KEYS.content, next.content);
            store?.setItem(FAN_STORAGE_KEYS.portraits, next.portraits ? '1' : '0');
        } catch { /* full or blocked storage: the default holds in this window */ }
        if (followed) this.cur = { ...next };
        this.keepSession();
        return true;
    }

    /** "Save as default": the current look becomes the default. */
    saveAsDefault(): boolean {
        return this.setDefault(this.cur);
    }

    /** "Back to default": the current look is the default again. */
    resetToDefault(): boolean {
        return this.set(this.def);
    }

    private keepSession(): void {
        const store = this.stores.session();
        if (!store) return;
        try {
            if (this.differs()) store.setItem(FAN_LOOK_SESSION_KEY, JSON.stringify(this.cur));
            else store.removeItem(FAN_LOOK_SESSION_KEY);
        } catch { /* full or blocked storage */ }
    }
}

/** The sectors of the style preview: per ring, the father's half then the mother's (outer rings wider). */
const PREVIEW_RINGS: ReadonlyArray<readonly FanRodSlot[]> = [
    ['PS0', 'MS0'],
    ['PS0', 'PS1', 'MS1', 'MS0'],
    ['PS0', 'PS2', 'PS1', 'PS3', 'MS3', 'MS1', 'MS2', 'MS0'],
];

/**
 * A small half fan of three rings in a style's colours (the panel's tiles,
 * Settings' rows): each sector carries its light and dark fill (`--l`, `--d`),
 * the stylesheet picks the theme's, so a change of theme needs no redraw.
 */
export function fanStylePreviewSvg(style: FanStyle, cls = 'fan-look-prev'): string {
    const W = 72, H = 40, cx = W / 2, cy = H - 2;
    const radii = [9, 19, 28, 37];
    const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;
    const fill = (slot: FanRodSlot) => `--l:${fanRodSlotColor(slot, 'light', style)};--d:${fanRodSlotColor(slot, 'dark', style)}`;
    const pal = (t: FanTheme) => fanPalette(t, style);
    let paths = `<path d="M${pt(radii[0], Math.PI)} A${radii[0]} ${radii[0]} 0 0 1 ${pt(radii[0], 0)} Z" style="--l:${pal('light').surface};--d:${pal('dark').surface}"/>`;
    PREVIEW_RINGS.forEach((slots, ring) => {
        const r1 = radii[ring], r2 = radii[ring + 1], n = slots.length;
        slots.forEach((slot, i) => {
            const a1 = Math.PI - (i * Math.PI) / n, a2 = Math.PI - ((i + 1) * Math.PI) / n;
            paths += `<path d="M${pt(r1, a1)} L${pt(r2, a1)} A${r2} ${r2} 0 0 1 ${pt(r2, a2)} L${pt(r1, a2)} A${r1} ${r1} 0 0 0 ${pt(r1, a1)} Z" style="${fill(slot)}"/>`;
        });
    });
    const edge = `--el:${pal('light').bg};--ed:${pal('dark').bg}`;
    return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false" style="${edge}">${paths}</svg>`;
}
