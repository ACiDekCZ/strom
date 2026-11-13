/**
 * Folding the tree legend (spec 1112 §2). Its ◯ button folds the legend
 * into a chip "◯ Legend" and back: the pill's first segment, the whole head
 * "◯ Legend ⌄" of the panel with the card marks, the chip itself. A computer
 * and a tablet unfold it in place and keep the choice on the device
 * (`strom-tree-legend-open`, one for all trees, open by default). A phone,
 * either way up, always shows the chip; a tap opens the legend as a sheet
 * (along the bottom upright, a panel at the right held sideways) that is never
 * reopened by itself after a reload, and the choice is neither read nor
 * written there.
 *
 * A folded chip carries a dot while the view shows a kind of card mark the
 * legend has not shown open on this device yet (`strom-tree-legend-seen`, the
 * mark classes of `updateLegendMarks`); an open legend (or the sheet) adds
 * what it shows. The rest of the legend lets a drag through to the canvas
 * (`pointer-events: none` but on the button and the help link).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { uiModule } from './module.js';
import { strings } from '../strings.js';
import { TREE_UI_STORAGE_KEYS } from '../storage-keys.js';
import { isPhoneBar, MQ_PHONE_BAR, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { HELP_TOPICS } from '../help/topics.js';
import { openHelp } from './help-ui.js';

/** A swipe this far closes the sheet (as the app's other sheets). */
const SWIPE_CLOSE_PX = 80;

/** The choices while storage cannot keep them (a private window): they last while the page is open. */
let openMemory: boolean | null = null;
let seenMemory: Set<string> | null = null;

/** Whether the legend is unfolded on a computer or a tablet (open by default). */
export function readTreeLegendOpen(): boolean {
    try {
        const v = localStorage.getItem(TREE_UI_STORAGE_KEYS.legendOpen);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch { /* the memory below */ }
    return openMemory ?? true;
}

function writeTreeLegendOpen(open: boolean): void {
    openMemory = open;
    try { localStorage.setItem(TREE_UI_STORAGE_KEYS.legendOpen, open ? '1' : '0'); } catch { /* kept in memory */ }
}

/** The mark classes the legend has already shown open on this device. */
export function readTreeLegendSeen(): Set<string> {
    try {
        const raw = localStorage.getItem(TREE_UI_STORAGE_KEYS.legendSeen);
        if (raw) {
            const list: unknown = JSON.parse(raw);
            if (Array.isArray(list)) return new Set(list.filter((x): x is string => typeof x === 'string'));
        }
    } catch { /* the memory below */ }
    return new Set(seenMemory ?? []);
}

/** Add what the legend shows open now; written only when something is new. */
function noteTreeLegendSeen(marks: readonly string[]): void {
    const seen = readTreeLegendSeen();
    const before = seen.size;
    for (const m of marks) seen.add(m);
    if (seen.size === before) return;
    seenMemory = seen;
    try { localStorage.setItem(TREE_UI_STORAGE_KEYS.legendSeen, JSON.stringify([...seen])); } catch { /* kept in memory */ }
}

/** The mark classes the legend names now (written by `updateLegendMarks`). */
function currentMarks(legend: HTMLElement): string[] {
    return (legend.dataset.marks ?? '').split(' ').filter(Boolean);
}

function onPhoneSideways(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MQ_PHONE_LANDSCAPE).matches;
}

const RING_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="4.6"/></svg>';

export const treeLegendMethods = uiModule({
    /** Wire the legend's button once at startup. */
    initTreeLegend(): void {
        const legend = document.getElementById('tree-legend');
        const toggle = legend?.querySelector<HTMLButtonElement>('.tree-legend-toggle');
        if (!legend || !toggle) return;
        toggle.addEventListener('click', () => {
            if (isPhoneBar()) {
                this.openTreeLegendSheet();
                return;
            }
            writeTreeLegendOpen(!readTreeLegendOpen());
            this.syncTreeLegendFold(legend);
        });
        // Turning a phone (or a window crossing the phone's width) changes the form:
        // the chip there, the choice of the device elsewhere; the sheet does not outlive it.
        if (typeof window.matchMedia === 'function') {
            window.matchMedia(MQ_PHONE_BAR).addEventListener('change', () => {
                if (!isPhoneBar() && this.bottomSheet?.querySelector('.bottom-sheet-legend')) this.hideBottomSheet();
                this.syncTreeLegendFold(legend);
            });
        }
    },

    /** Put the legend in its form: open or folded, the button's state and name, the new mark's dot. */
    syncTreeLegendFold(legend: HTMLElement): void {
        const toggle = legend.querySelector<HTMLButtonElement>('.tree-legend-toggle');
        if (!toggle) return;
        const phone = isPhoneBar();
        const open = !phone && readTreeLegendOpen();
        const shown = legend.style.display !== 'none';
        legend.classList.toggle('is-collapsed', !open);
        legend.classList.toggle('is-chip-only', phone);
        const marks = currentMarks(legend);
        if (open && shown) noteTreeLegendSeen(marks);
        const sheetOpen = phone && !!this.bottomSheet?.querySelector('.bottom-sheet-legend');
        const seen = readTreeLegendSeen();
        const fresh = !open && !sheetOpen && marks.some(m => !seen.has(m));
        const s = strings.legend;
        const label = open ? s.collapse : fresh ? `${s.title}, ${s.newMark}` : s.expand;
        toggle.setAttribute('aria-expanded', open || sheetOpen ? 'true' : 'false');
        if (toggle.getAttribute('aria-label') !== label) toggle.setAttribute('aria-label', label);
        // The open legend's bubble is drawn by the stylesheet; the chip keeps a plain tooltip.
        if (open) {
            toggle.dataset.bubble = s.collapse;
            toggle.removeAttribute('title');
        } else {
            delete toggle.dataset.bubble;
            toggle.title = s.title;
        }
        if (phone) toggle.setAttribute('aria-haspopup', 'dialog');
        else toggle.removeAttribute('aria-haspopup');
        const text = toggle.querySelector<HTMLElement>('.tlt-label');
        if (text && text.textContent !== s.title) text.textContent = s.title;
        const dot = toggle.querySelector<HTMLElement>('.tlt-dot');
        if (dot) dot.hidden = !fresh;
    },

    /**
     * The legend as a sheet (a phone): the grip, "◯ Legend" with Done, the
     * legend's content. Done, a tap beside it, a swipe down (to the right on
     * a phone held sideways) and Escape close it; the focus goes back to the chip.
     */
    openTreeLegendSheet(): void {
        const legend = document.getElementById('tree-legend');
        const toggle = legend?.querySelector<HTMLButtonElement>('.tree-legend-toggle');
        if (!legend || !toggle) return;
        this.hideBottomSheet();

        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        const sheet = document.createElement('div');
        sheet.className = 'bottom-sheet bottom-sheet-legend';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', 'tree-legend-sheet-title');

        const handle = document.createElement('div');
        handle.className = 'bottom-sheet-handle';
        sheet.appendChild(handle);

        const head = document.createElement('div');
        head.className = 'tree-legend-sheet-head';
        head.innerHTML = `<span class="tree-legend-sheet-ring">${RING_SVG}</span>`;
        const title = document.createElement('span');
        title.id = 'tree-legend-sheet-title';
        title.className = 'tree-legend-sheet-title';
        title.textContent = strings.legend.title;
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'tree-legend-sheet-done';
        done.textContent = strings.tour.done;
        done.addEventListener('click', () => this.hideBottomSheet());
        head.append(title, done);
        sheet.appendChild(head);

        // The same content as the legend: the rings (and the branch colours), then the card marks.
        const body = document.createElement('div');
        body.className = 'tree-legend-sheet-body';
        const keys = document.createElement('div');
        keys.className = 'tree-legend-sheet-keys';
        for (const item of legend.querySelectorAll<HTMLElement>(':scope > .legend-item')) {
            if (item.style.display === 'none') continue;
            const copy = item.cloneNode(true) as HTMLElement;
            copy.removeAttribute('id');
            copy.removeAttribute('style');
            keys.appendChild(copy);
        }
        const branches = legend.querySelector<HTMLElement>('#branch-legend');
        if (branches && branches.style.display !== 'none') {
            for (const item of branches.querySelectorAll<HTMLElement>('.branch-legend-item')) keys.appendChild(item.cloneNode(true));
        }
        body.appendChild(keys);
        const marks = legend.querySelector<HTMLElement>('#legend-marks');
        if (marks) {
            const copy = marks.cloneNode(true) as HTMLElement;
            copy.removeAttribute('id');
            delete copy.dataset.html;
            copy.querySelector('.legend-marks-help')?.addEventListener('click', () => {
                this.hideBottomSheet();
                void openHelp(HELP_TOPICS.reliability, toggle);
            });
            body.appendChild(copy);
        }
        sheet.appendChild(body);
        overlay.appendChild(sheet);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });

        // A swipe down closes it (to the right on a phone held sideways, where it is a side panel).
        let startX = 0, startY = 0, dragging = false;
        sheet.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });
        sheet.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
            if (onPhoneSideways()) { if (dx > 0) sheet.style.transform = `translateX(${dx}px)`; }
            else if (dy > 0 && sheet.scrollTop <= 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        sheet.addEventListener('touchend', (e) => {
            if (!dragging) return;
            dragging = false;
            sheet.style.transition = '';
            const dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
            const away = onPhoneSideways() ? dx > SWIPE_CLOSE_PX && dx > Math.abs(dy) : dy > SWIPE_CLOSE_PX && dy > Math.abs(dx);
            if (away) this.hideBottomSheet();
            else sheet.style.transform = '';
        });

        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        this.bottomSheetTrigger = toggle;
        this.bottomSheetOnClose = () => this.syncTreeLegendFold(legend);
        // Shown open: what it names counts as seen (the chip's dot goes).
        noteTreeLegendSeen(currentMarks(legend));
        this.syncTreeLegendFold(legend);
        requestAnimationFrame(() => overlay.classList.add('active'));
        done.focus({ preventScroll: true });
    },
});
