/**
 * Closed dialogs and menus stay out of the accessibility tree (063 U3).
 *
 * Dialogs are `.modal-overlay` elements shown by toggling `active` from many
 * places, menus are shown by a class, a `:hover` rule or inline styles; when
 * closed they are only `display: none` / `visibility: hidden` by CSS. Tools
 * that read the DOM (screen-reader helpers, browser agents) still found their
 * buttons ("Cancel" twenty times). So this guard marks every closed one
 * centrally, by watching the DOM:
 *  - a closed `.modal-overlay` gets the `hidden` attribute. `.modal-overlay.active`
 *    sets `display: flex`, which wins over the user agent's `[hidden]` rule, so a
 *    dialog that adds `active` and focuses a field in the same task still works,
 *    and the attribute is gone again before the next frame;
 *  - a closed menu or dialog elsewhere (`[role=menu|dialog|alertdialog]`) gets
 *    `aria-hidden="true"` (never `hidden`: its open state may have no `display`
 *    of its own, and a closing transition would be cut short).
 * Only attributes this guard set are ever removed (`data-closed-guard`), so the
 * app's own `hidden` / `aria-hidden` are left alone. Focus moving into a guarded
 * element lifts its guard at once (no focused element inside `aria-hidden`).
 */

const OVERLAY = 'modal-overlay';
const POPUP_SELECTOR = '[role="menu"], [role="dialog"], [role="alertdialog"]';
const MARK = 'data-closed-guard';

let initialized = false;
let scheduled = 0;

function isOverlay(el: Element): boolean {
    return el.classList.contains(OVERLAY);
}

/** Rendered and not `visibility: hidden` (opacity is a transition, not a state). */
function shown(el: Element): boolean {
    const cv = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof cv === 'function') return cv.call(el, { visibilityProperty: true });
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
}

function guard(el: HTMLElement, kind: 'hidden' | 'aria'): void {
    if (el.getAttribute(MARK) === kind) return;
    if (kind === 'hidden') {
        if (el.hidden) return;              // the app's own hidden: already out
        el.hidden = true;
    } else {
        if (el.hasAttribute('aria-hidden') || el.hidden) return;
        el.setAttribute('aria-hidden', 'true');
    }
    el.setAttribute(MARK, kind);
}

function unguard(el: HTMLElement): void {
    const kind = el.getAttribute(MARK);
    if (!kind) return;
    el.removeAttribute(MARK);
    if (kind === 'hidden') el.hidden = false;
    else el.removeAttribute('aria-hidden');
}

/** A `.modal-overlay` is open exactly when it has `active` (or an inline display of its own). */
function syncOverlay(el: HTMLElement): void {
    const open = el.classList.contains('active') || (el.style.display !== '' && el.style.display !== 'none');
    if (open) unguard(el);
    else guard(el, 'hidden');
}

function syncPopup(el: HTMLElement): void {
    // A dialog box inside an overlay follows the overlay.
    if (el.closest(`.${OVERLAY}`)) {
        unguard(el);
        return;
    }
    // Measured with this guard's own attribute out of the way.
    if (el.getAttribute(MARK) === 'aria') {
        if (!shown(el)) return;
        unguard(el);
        return;
    }
    if (!shown(el)) guard(el, 'aria');
}

/** Re-check every dialog and menu in the page. */
export function syncClosedPopups(): void {
    scheduled = 0;
    for (const el of Array.from(document.getElementsByClassName(OVERLAY)) as HTMLElement[]) syncOverlay(el);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(POPUP_SELECTOR))) {
        if (!isOverlay(el)) syncPopup(el);
    }
}

function schedule(): void {
    if (scheduled) return;
    scheduled = requestAnimationFrame(syncClosedPopups);
}

/** Focus landing inside a guarded element: lift the guard at once. */
function onFocusIn(e: FocusEvent): void {
    let el = e.target instanceof Element ? e.target : null;
    while (el) {
        if (el.hasAttribute(MARK)) unguard(el as HTMLElement);
        el = el.parentElement;
    }
}

function relevantAdded(n: Node): boolean {
    return n instanceof Element
        && (isOverlay(n) || n.matches(POPUP_SELECTOR) || !!n.querySelector(`.${OVERLAY}, ${POPUP_SELECTOR}`));
}

/** Start the guard. Idempotent; call once at startup, after the dialog focus watcher. */
export function initClosedPopups(): void {
    if (initialized || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    initialized = true;
    new MutationObserver(records => {
        let later = false;
        for (const r of records) {
            if (r.type === 'childList') {
                for (const n of Array.from(r.addedNodes)) {
                    if (!relevantAdded(n)) continue;
                    const el = n as HTMLElement;
                    // Overlays at once (a dialog built per open), the rest after layout.
                    if (isOverlay(el)) syncOverlay(el);
                    for (const o of Array.from(el.getElementsByClassName(OVERLAY)) as HTMLElement[]) syncOverlay(o);
                    later = true;
                }
                continue;
            }
            const t = r.target as HTMLElement;
            if (r.attributeName === MARK) continue;
            if (isOverlay(t)) {
                if (r.attributeName === 'class' || r.attributeName === 'style') syncOverlay(t);
                later = true;           // dialogs and menus inside it
                continue;
            }
            // Inline styles change constantly (pan, zoom, drag): only a popup's own counts.
            if (r.attributeName === 'style' && !t.matches(POPUP_SELECTOR)) continue;
            // The guard's own writes come back here once; a no-op re-check.
            if ((r.attributeName === 'hidden' || r.attributeName === 'aria-hidden') && t.hasAttribute(MARK)) continue;
            later = true;
        }
        if (later) schedule();
    }).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
    });
    document.addEventListener('focusin', onFocusIn, true);
    // Menus shown by `:hover` or after a delayed `visibility` transition change no attribute.
    const onMotionEnd = (e: Event): void => {
        const t = e.target;
        if (t instanceof Element && (t.matches(POPUP_SELECTOR) || isOverlay(t))) schedule();
    };
    document.addEventListener('transitionend', onMotionEnd, true);
    document.addEventListener('animationend', onMotionEnd, true);
    document.addEventListener('pointerover', e => {
        if (e.target instanceof Element && e.target.closest('.actions-submenu-wrap')) schedule();
    }, true);
    document.addEventListener('pointerout', e => {
        if (e.target instanceof Element && e.target.closest('.actions-submenu-wrap')) schedule();
    }, true);
    window.addEventListener('resize', schedule);
    syncClosedPopups();
}
