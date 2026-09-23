/**
 * Dialog focus management (review S37).
 *
 * Dialogs are plain `.modal-overlay` elements shown by toggling the `active`
 * class from many places — there is no single "open dialog" helper. So focus
 * is handled centrally by watching that class:
 *  - on open: remember what had focus, then move focus into the dialog (the
 *    first visible enabled field, or the dialog container itself) unless the
 *    dialog already focused something inside itself;
 *  - Tab / Shift+Tab stay inside the top-most open dialog;
 *  - on close: focus returns to the remembered element when it still exists.
 */

const FIELD_SELECTOR = 'input:not([type="hidden"]), select, textarea';
const FOCUSABLE_SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(', ');

/** Open dialogs, oldest first (the last one is the top-most). */
const openStack: HTMLElement[] = [];
/** What had focus when each dialog opened. */
const openers = new Map<HTMLElement, HTMLElement | null>();
const allClosedCallbacks: Array<() => void> = [];
let initialized = false;

function isVisible(el: Element): boolean {
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
}

function isUsable(el: Element): boolean {
    const f = el as HTMLInputElement;
    return !f.disabled && !(f.readOnly && f.tagName !== 'SELECT') && isVisible(el);
}

/** Focusable controls of a dialog in DOM order (visible and enabled only). */
export function focusableIn(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => !(el as HTMLButtonElement).disabled && isVisible(el));
}

/** The element that represents the dialog (the `.modal` box, else the overlay). */
function dialogContainer(overlay: HTMLElement): HTMLElement {
    const box = overlay.querySelector<HTMLElement>('[role="dialog"], .modal') ?? overlay;
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    return box;
}

/** Touch devices: focusing a field would pop the on-screen keyboard. */
function prefersNoFieldFocus(): boolean {
    try {
        return window.matchMedia?.('(pointer: coarse)').matches ?? false;
    } catch {
        return false;
    }
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

function isTextEntry(el: HTMLElement): boolean {
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase());
}

function focusInto(overlay: HTMLElement): void {
    const active = document.activeElement;
    // The dialog already placed focus itself (autofocus, picker search, ...).
    if (active && active !== document.body && overlay.contains(active)) return;
    // Prefer a field the user types into: a leading select (e.g. "other
    // parent" above the name in the relation dialog) is rarely what they
    // came to fill in. Fall back to any usable field.
    const fields = prefersNoFieldFocus()
        ? []
        : Array.from(overlay.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(isUsable);
    const field = fields.find(isTextEntry) ?? fields[0] ?? null;
    (field ?? dialogContainer(overlay)).focus({ preventScroll: true });
}

function onOpen(overlay: HTMLElement): void {
    const active = document.activeElement as HTMLElement | null;
    openers.set(overlay, active && active !== document.body && !overlay.contains(active) ? active : null);
    openStack.push(overlay);
    focusInto(overlay);
}

function onClose(overlay: HTMLElement): void {
    const idx = openStack.indexOf(overlay);
    if (idx !== -1) openStack.splice(idx, 1);
    const opener = openers.get(overlay) ?? null;
    openers.delete(overlay);
    const active = document.activeElement;
    // Focus that already moved somewhere meaningful is left alone.
    const focusLost = !active || active === document.body || overlay.contains(active);
    if (!focusLost) return;
    if (opener && opener.isConnected && isVisible(opener)) {
        opener.focus({ preventScroll: true });
        return;
    }
    // The opener is gone (re-rendered list etc.): stay in the dialog below.
    const below = openStack[openStack.length - 1];
    if (below) {
        dialogContainer(below).focus({ preventScroll: true });
        return;
    }
    // Nothing to return to: never leave focus parked inside the hidden
    // dialog (the browser's own focus fixup only runs on a later frame).
    if (active instanceof HTMLElement && overlay.contains(active)) active.blur();
}

/** Re-scan open dialogs after a relevant DOM change. */
function sync(): void {
    const current = new Set(Array.from(document.querySelectorAll<HTMLElement>('.modal-overlay.active')));
    const hadOpen = openStack.length > 0;
    for (const overlay of [...openStack]) {
        if (!current.has(overlay) || !overlay.isConnected) onClose(overlay);
    }
    for (const overlay of current) {
        if (!openStack.includes(overlay)) onOpen(overlay);
    }
    if (hadOpen && openStack.length === 0) {
        // Deferred: a flow may close one dialog and open the next across an
        // await (confirm → reopen parent). Fire only if still nothing is open.
        setTimeout(() => {
            if (document.querySelector('.modal-overlay.active')) return;
            for (const cb of allClosedCallbacks) cb();
        }, 0);
    }
}

/** Register a callback run when the last open dialog closes. */
export function onAllDialogsClosed(cb: () => void): void {
    allClosedCallbacks.push(cb);
}

/** The top-most open dialog, or null. */
export function topDialog(): HTMLElement | null {
    for (let i = openStack.length - 1; i >= 0; i--) {
        if (openStack[i].isConnected && isVisible(openStack[i])) return openStack[i];
    }
    return null;
}

function trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const top = topDialog();
    if (!top) return;
    const items = focusableIn(top);
    if (items.length === 0) {
        e.preventDefault();
        dialogContainer(top).focus({ preventScroll: true });
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const outside = !active || !top.contains(active);
    if (e.shiftKey && (outside || active === first || !items.includes(active!))) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
    }
}

/** Start watching dialogs. Idempotent; call once at startup. */
export function initDialogFocus(): void {
    if (initialized || typeof MutationObserver === 'undefined') return;
    initialized = true;
    const isOverlay = (n: Node): boolean => n instanceof Element && n.classList.contains('modal-overlay');
    // Class changes anywhere (static dialogs toggling `active`) ...
    new MutationObserver(records => {
        if (records.some(r => isOverlay(r.target))) sync();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    // ... and overlays added to / removed from <body> (dialogs built per open).
    new MutationObserver(records => {
        if (records.some(r => Array.from(r.addedNodes).some(isOverlay) || Array.from(r.removedNodes).some(isOverlay))) sync();
    }).observe(document.body, { childList: true });
    document.addEventListener('keydown', trapTab, true);
    sync();
}
