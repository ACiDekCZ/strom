/**
 * Files picked in the system's dialog (waiting buttons §9, 9a–9c).
 *
 * While the system's dialog is open nothing shows: the element that opened it
 * is only guarded against opening it twice. A choice called off (a `change`
 * without a file, the input's `cancel`, the window's focus back without a
 * file) gives the element back at once. Once a file is chosen, reading it is
 * the element's working state with the file's name ("Loading family.ged…",
 * then the people found), and a file that cannot be read ends in a sentence
 * at the element with "Choose another file" (no alert). Without an element on
 * the screen (a file handed in some other way, the dialog closed) the reading
 * shows as a progress toast after 120 ms and its failure as a toast.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { activatedElement, runBusy, nextPaint, BUSY_SHOW_MS } from './busy.js';
import { showProgressToast, showToast, type ProgressToastHandle } from './toast.js';
import { holdLeave } from './busy-leave.js';

/** A file that is neither GEDCOM nor a Strom backup (or a JSON that does not parse). */
export class FileUnreadableError extends Error {
    constructor(message = 'unreadable') {
        super(message);
        this.name = 'FileUnreadableError';
    }
}

/** How long after the window's focus comes back the choice counts as called off (a `change` may come late). */
export const PICK_FOCUS_CANCEL_MS = 600;

interface Pick {
    origin: HTMLElement | null;
    open: boolean;
    release: () => void;
}

const picks = new WeakMap<HTMLInputElement, Pick>();
/** The elements whose system dialog is open now. */
const picking = new WeakSet<HTMLElement>();

function seen(el: Element | null | undefined): el is HTMLElement {
    if (!el || !el.isConnected) return false;
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

/** Whether `el` opened a system file dialog that is still open (a second open goes nowhere). */
export function isPicking(el: HTMLElement | null | undefined): boolean {
    return !!el && picking.has(el);
}

/**
 * Open the system's file dialog of `input` for `origin` (default: the element of the current click). False: the
 * element's dialog is open already (nothing happens). `onCancel`: the choice was called off.
 */
export function openFilePicker(input: HTMLInputElement | null, origin: HTMLElement | null = activatedElement(),
    onCancel?: () => void): boolean {
    if (!input) return false;
    if (origin && picking.has(origin)) return false;
    picks.get(input)?.release();
    const guard = (e: Event): void => {
        if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
        e.stopImmediatePropagation();
        e.preventDefault();
    };
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const pick: Pick = { origin, open: true, release: () => undefined };
    const end = (called: boolean): void => {
        if (!pick.open) return;
        pick.open = false;
        pick.release();
        if (called) onCancel?.();
    };
    const onChange = (): void => { end(!input.files?.length); };
    const onCancelEvt = (): void => { end(true); };
    const onFocus = (): void => {
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
            focusTimer = null;
            if (pick.open && !input.files?.length) end(true);
        }, PICK_FOCUS_CANCEL_MS);
    };
    pick.release = () => {
        if (origin) {
            picking.delete(origin);
            origin.removeEventListener('click', guard, true);
            origin.removeEventListener('keydown', guard, true);
        }
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancelEvt);
        window.removeEventListener('focus', onFocus);
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = null;
    };
    if (origin) {
        picking.add(origin);
        origin.addEventListener('click', guard, true);
        origin.addEventListener('keydown', guard, true);
    }
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancelEvt);
    // The window's focus comes back while the dialog closes; a little later so a slow `change` still counts.
    setTimeout(() => { if (pick.open) window.addEventListener('focus', onFocus); }, 0);
    picks.set(input, pick);
    try {
        input.click();
    } catch {
        end(true);
        return false;
    }
    return true;
}

/**
 * The element that opened `input`'s dialog (taken: asked once per file), when it is still on the screen; null for
 * a file handed in without it. Its guard goes.
 */
export function takePickOrigin(input: HTMLInputElement | null): HTMLElement | null {
    if (!input) return null;
    const pick = picks.get(input);
    if (!pick) return null;
    picks.delete(input);
    pick.open = false;
    pick.release();
    return seen(pick.origin) ? pick.origin : null;
}

/** A count as the language writes it ("2 400", "2,400"). */
export function shownCount(n: number): string {
    try { return new Intl.NumberFormat(getCurrentLanguage()).format(n); } catch { return String(n); }
}

/** "2 400 people". */
export function peopleText(n: number): string {
    return strings.busy.filePeople(n, shownCount(n));
}

/** The words of a file read and its people (after parsing). */
export function fileReadStep(name: string, people?: number): string {
    const lead = strings.busy.loadingFile(name);
    return people === undefined ? lead : `${lead} ${peopleText(people)}`;
}

export interface FileReadCtl {
    /** The people found (after parsing): "Loading family.ged… 2,400 people". */
    people(n: number): void;
}

/**
 * Read a chosen file as `origin`'s working state (§9): "Loading <name>…", its people once known. A
 * `FileUnreadableError` from `work` ends in the sentence "The file cannot be read…" with "Choose another file"
 * (`again`), at the element or, without one, in a toast. Leaving the page asks meanwhile. Gives what `work` gave
 * (undefined: it failed).
 */
export async function readPickedFile<T>(origin: HTMLElement | null, file: { name: string },
    work: (ctl: FileReadCtl) => Promise<T>, again?: () => void): Promise<T | undefined> {
    const release = holdLeave('import');
    const unreadable = (): { ok: false; kind: 'error'; text: string; alt?: { label: string; run: () => void } } => ({
        ok: false, kind: 'error', text: strings.busy.fileUnreadable,
        ...(again ? { alt: { label: strings.busy.pickOther, run: again } } : {}),
    });
    try {
        if (origin && seen(origin)) {
            return await runBusy(origin, async ctl => {
                try {
                    return await work({ people: n => ctl.step(fileReadStep(file.name, n)) });
                } catch (err) {
                    // Whatever stops the reading, the file is not one the app reads.
                    if (!(err instanceof FileUnreadableError)) console.error('File read error:', err);
                    ctl.end(unreadable());
                    return undefined;
                }
            }, { label: fileReadStep(file.name), kind: 'local' });
        }
        // No element: a progress toast past 120 ms, the failure as a toast.
        let toast: ProgressToastHandle | null = null;
        const timer = setTimeout(() => { toast = showProgressToast({ title: fileReadStep(file.name) }); }, BUSY_SHOW_MS);
        try {
            const got = await work({ people: n => { (toast as ProgressToastHandle | null)?.update({ step: peopleText(n) }); } });
            return got;
        } catch (err) {
            if (!(err instanceof FileUnreadableError)) console.error('File read error:', err);
            const end = unreadable();
            showToast(end.text, Infinity, { alert: true, closable: true, kind: 'busy-end', ...(end.alt ? { action: end.alt } : {}) });
            return undefined;
        } finally {
            clearTimeout(timer);
            (toast as ProgressToastHandle | null)?.close();
        }
    } finally {
        release();
    }
}

/**
 * Whether a text is a GEDCOM file at all: its header, or at least one person or family record at level 0. A text
 * without either (another kind of file named .ged) cannot be read as one (9a "unreadable"); the lenient parser
 * would make an empty tree of it.
 */
export function looksLikeGedcom(text: string): boolean {
    return /^[\s﻿]*0\s+HEAD\b/.test(text) || /^\s*0\s+@[^@\s]+@\s+(INDI|FAM)\b/m.test(text);
}

/** A file this large is parsed after its working state is painted (the parse holds the page meanwhile, §8). */
export const PAINT_BEFORE_PARSE_BYTES = 512 * 1024;

/** Wait until the working state of a large file is on the screen (shown after 120 ms), then the parse may hold the page. */
export async function paintBeforeParse(size: number): Promise<void> {
    if (size < PAINT_BEFORE_PARSE_BYTES) return;
    await new Promise(resolve => setTimeout(resolve, BUSY_SHOW_MS + 20));
    await nextPaint();
}

/**
 * A system dialog that answers with a promise (`showSaveFilePicker`, `showOpenFilePicker`, the install prompt): no
 * state while it is open, only `el` guarded against opening it twice (§9, A177). Undefined: it is open already.
 */
export async function whilePicking<T>(el: HTMLElement | null, open: () => Promise<T>): Promise<T | undefined> {
    if (!el) return open();
    if (picking.has(el)) return undefined;
    const guard = (e: Event): void => {
        if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
        e.stopImmediatePropagation();
        e.preventDefault();
    };
    picking.add(el);
    el.addEventListener('click', guard, true);
    el.addEventListener('keydown', guard, true);
    try {
        return await open();
    } finally {
        picking.delete(el);
        el.removeEventListener('click', guard, true);
        el.removeEventListener('keydown', guard, true);
    }
}
