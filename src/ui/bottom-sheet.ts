/**
 * Mobile bottom sheet: the touch counterpart of the desktop context menu.
 * A long-press on a card opens a sheet with the SAME actions (shared from
 * context-menu.ts — same action list + dispatch, different markup). Desktop
 * behaviour is untouched. See src/ui/module.ts for the composition pattern.
 */

import { PersonId } from '../types.js';
import { uiModule } from './module.js';

/** Coarse pointer = touch device; used to gate touch-only behaviour. */
function isCoarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;
const SWIPE_CLOSE_PX = 80;

export const bottomSheetMethods = uiModule({
    /** Open the mobile action sheet for a person (built from the shared list). */
    showPersonBottomSheet(personId: PersonId): void {
        this.hideBottomSheet();
        const actions = this.getPersonMenuActions(personId);
        if (actions.length === 0) return;

        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        overlay.innerHTML = `
            <div class="bottom-sheet" role="menu">
                <div class="bottom-sheet-handle"></div>
                <div class="bottom-sheet-items">
                    ${actions.map(a => {
                        // Keep the class out of the attribute (see context-menu.ts note).
                        const cls = a.danger ? 'bottom-sheet-item danger' : 'bottom-sheet-item';
                        return `<button type="button" class="${cls}" data-action="${esc(a.action)}">
                            <span class="bottom-sheet-icon">${a.icon}</span> ${esc(a.label)}
                        </button>`;
                    }).join('')}
                </div>
            </div>
        `;

        // Tap outside (on the overlay backdrop) closes.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });

        const sheet = overlay.querySelector('.bottom-sheet') as HTMLElement;
        sheet.querySelectorAll('.bottom-sheet-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = (item as HTMLElement).dataset.action;
                this.hideBottomSheet();
                if (action) this.runPersonMenuAction(personId, action);
            });
        });

        // Swipe-down to dismiss.
        let dragStartY = 0;
        let dragging = false;
        sheet.addEventListener('touchstart', (e) => {
            dragStartY = e.touches[0].clientY;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });
        sheet.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - dragStartY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        sheet.addEventListener('touchend', (e) => {
            dragging = false;
            sheet.style.transition = '';
            const dy = e.changedTouches[0].clientY - dragStartY;
            if (dy > SWIPE_CLOSE_PX) this.hideBottomSheet();
            else sheet.style.transform = '';
        });

        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        // Trigger the slide-up animation.
        requestAnimationFrame(() => overlay.classList.add('active'));
    },

    hideBottomSheet(): void {
        if (this.bottomSheet) {
            this.bottomSheet.remove();
            this.bottomSheet = null;
        }
    },

    /**
     * Attach a long-press gesture to a card: on a coarse pointer, holding for
     * LONG_PRESS_MS without moving > MOVE_CANCEL_PX opens the bottom sheet and
     * suppresses the following click (so the desktop context menu never fires).
     * A pan (finger drag) cancels the long-press.
     */
    attachCardLongPress(card: HTMLElement, personId: PersonId): void {
        if (!isCoarsePointer()) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let startX = 0, startY = 0, fired = false;

        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

        card.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            startX = t.clientX; startY = t.clientY; fired = false;
            timer = setTimeout(() => {
                fired = true;
                this.showPersonBottomSheet(personId);
            }, LONG_PRESS_MS);
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            const t = e.touches[0];
            if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL_PX) cancel();
        }, { passive: true });

        card.addEventListener('touchend', (e) => {
            cancel();
            if (fired) {
                e.preventDefault(); // stop the synthetic click
                card.dataset.suppressClick = '1';
                setTimeout(() => { delete card.dataset.suppressClick; }, 400);
            }
        }, { passive: false });

        card.addEventListener('touchcancel', cancel, { passive: true });
    },
});
