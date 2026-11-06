/**
 * A bottom sheet is inert while it slides in (063 U3 A3).
 *
 * Every `.bottom-sheet-overlay` is built per open and gets `active` a frame
 * later, which slides its `.bottom-sheet` up (`transform`, 0.22 s). A tap or a
 * click during that slide used to land on whatever row was passing under the
 * pointer. Watched centrally: while the sheet moves, it is `inert` and clicks
 * anywhere in its overlay (the backdrop too, which would close it) are
 * swallowed; after the slide the sheet is usable again and focus the sheet
 * placed on open is put back. Under `prefers-reduced-motion: reduce` the sheet
 * has no transition (stylesheet), so it is never made inert.
 */

const SLIDING = 'data-sliding';
let initialized = false;

function transitionMs(el: Element): number {
    const cs = getComputedStyle(el);
    const parse = (v: string): number[] => v.split(',').map(s => {
        const t = s.trim();
        return t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000;
    });
    const durs = parse(cs.transitionDuration);
    const delays = parse(cs.transitionDelay);
    let max = 0;
    durs.forEach((d, i) => { max = Math.max(max, (d || 0) + (delays[i % delays.length] || 0)); });
    return max;
}

function startSlide(overlay: HTMLElement): void {
    if (overlay.hasAttribute(SLIDING) || overlay.dataset.slid) return;
    overlay.dataset.slid = '1';
    const sheet = overlay.querySelector<HTMLElement>('.bottom-sheet');
    if (!sheet) return;
    const ms = transitionMs(sheet);
    if (ms <= 0) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && sheet.contains(active) ? active : null;
    overlay.setAttribute(SLIDING, '');
    sheet.inert = true;
    let done = false;
    const end = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sheet.removeEventListener('transitionend', onEnd);
        sheet.removeEventListener('transitioncancel', onEnd);
        overlay.removeAttribute(SLIDING);
        sheet.inert = false;
        const now = document.activeElement;
        if (focused && focused.isConnected && (!now || now === document.body)) focused.focus({ preventScroll: true });
    };
    const onEnd = (e: TransitionEvent): void => {
        if (e.target === sheet && e.propertyName === 'transform') end();
    };
    sheet.addEventListener('transitionend', onEnd);
    sheet.addEventListener('transitioncancel', onEnd);
    // A slide that never reports its end (tab in the background, sheet removed).
    const timer = setTimeout(end, ms + 150);
}

/** A click in a sheet that is still sliding in hits nothing. */
function swallow(e: Event): void {
    const t = e.target;
    if (t instanceof Element && t.closest(`.bottom-sheet-overlay[${SLIDING}]`)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function isSheetOverlay(n: Node): n is HTMLElement {
    return n instanceof HTMLElement && n.classList.contains('bottom-sheet-overlay');
}

/** Start watching bottom sheets. Idempotent; call once at startup. */
export function initSheetSlide(): void {
    if (initialized || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    initialized = true;
    new MutationObserver(records => {
        for (const r of records) {
            const t = r.target;
            if (isSheetOverlay(t) && t.classList.contains('active')) startSlide(t);
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    for (const type of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
        document.addEventListener(type, swallow, true);
    }
}
