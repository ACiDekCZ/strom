/**
 * Interactive tour: a lightweight five-step guide over the demo tree (no
 * external library). Each step spotlights a real UI element with a dimmed
 * overlay "hole" and a bubble of text; the tour never clicks for the user, it
 * only points. Steps whose target isn't visible (e.g. the toolbar search on
 * mobile) are skipped, so it degrades gracefully across breakpoints.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';

const TOUR_OFFERED_KEY = 'strom-tour-offered';

export interface TourStepDef {
    key: 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7' | 'step8';
    selectors: string[];
    /** Force-reveal the hover-only card buttons while this step shows. */
    reveal?: boolean;
    /** Extra spotlight padding (the card's + buttons sit outside its box). */
    pad?: number;
    /** Skip on touch devices (hover-only affordances don't exist there). */
    skipOnCoarse?: boolean;
}

// Each step lists candidate selectors; the first VISIBLE one is spotlighted.
// Later candidates are the mobile equivalents (the bottom bar / its FAB when a
// desktop-only control is hidden).
const TOUR_STEPS: TourStepDef[] = [
    { key: 'step1', selectors: ['.person-card.focused', '.person-card'] },
    { key: 'step2', selectors: ['.person-card.focused', '.person-card'], reveal: true, pad: 18, skipOnCoarse: true },
    { key: 'step3', selectors: ['.toolbar-buttons button', '.bottom-bar-fab'] },
    { key: 'step4', selectors: ['#focus-controls', '.toolbar .toolbar-focus'] },
    { key: 'step5', selectors: ['#view-mode-segment', '.bottom-bar'] },
    { key: 'step6', selectors: ['.zoom-controls'] },
    { key: 'step7', selectors: ['#toolbar-search-picker'] },
    { key: 'step8', selectors: ['.tree-switcher-btn', '.bottom-bar-more'] },
];

function isCoarse(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Smallest target (CSS px) worth spotlighting — a squeezed sliver is not. */
const MIN_TARGET = 24;

/**
 * The first candidate that is actually on screen: rendered (not display:none /
 * hidden — offsetParent can't be used, it is null for position:fixed bars like
 * the bottom bar and the focus chip), big enough to point at, and inside the
 * viewport. Every match of a selector is tried, not only the first one.
 */
function firstVisible(selectors: string[]): HTMLElement | null {
    for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            if (el.getClientRects().length === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.width < MIN_TARGET || r.height < MIN_TARGET / 2) continue;
            if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
            return el;
        }
    }
    return null;
}

/** Last geometry the spotlight was placed for (skip no-op repositions). */
let lastPlacement = '';

export const tourMethods = uiModule({
    /** Offer the tour once, unobtrusively, after the demo tree loads. */
    offerTourAfterDemo(): void {
        try {
            if (localStorage.getItem(TOUR_OFFERED_KEY) === '1') return;
            localStorage.setItem(TOUR_OFFERED_KEY, '1');
        } catch { /* private mode: just offer this once in-session */ }

        document.querySelector('.tour-offer')?.remove();
        const t = strings.tour;
        const el = document.createElement('div');
        el.className = 'tour-offer';
        el.innerHTML = `<span>${this.escapeHtml(t.offer)}</span>`
            + `<button type="button" class="tour-offer-btn">${this.escapeHtml(t.offerYes)}</button>`
            + `<button type="button" class="tour-offer-close" aria-label="${strings.buttons.close}">&times;</button>`;
        el.querySelector('.tour-offer-btn')!.addEventListener('click', () => { el.remove(); this.startTour(); });
        el.querySelector('.tour-offer-close')!.addEventListener('click', () => el.remove());
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => el.remove(), 15000);
    },

    /** Start the tour (from the offer or the About dialog). */
    startTour(): void {
        this.closeMobileMenu?.();
        document.getElementById('about-modal')?.classList.remove('active');
        // Keep only the steps whose target is currently visible (and skip
        // hover-affordance steps on touch devices).
        this.tourSteps = TOUR_STEPS.filter(s =>
            !(s.skipOnCoarse && isCoarse()) && firstVisible(s.selectors) !== null);
        if (this.tourSteps.length === 0) return;
        this.tourIndex = 0;
        this.tourActive = true;

        if (!this.tourReposition) {
            this.tourReposition = () => this.positionTourStep();
            window.addEventListener('resize', this.tourReposition);
            window.addEventListener('scroll', this.tourReposition, true);
        }
        document.getElementById('tour-overlay')?.classList.add('active');
        this.renderTourStep();
        // The canvas pans/zooms by transform (no scroll event) and the tree may
        // still be settling after the demo loads: follow the target every frame.
        const follow = () => {
            if (!this.tourActive) return;
            this.positionTourStep(true);
            requestAnimationFrame(follow);
        };
        requestAnimationFrame(follow);
    },

    endTour(): void {
        this.tourActive = false;
        lastPlacement = '';
        document.querySelectorAll('.person-card.tour-reveal').forEach(c => c.classList.remove('tour-reveal'));
        document.getElementById('tour-overlay')?.classList.remove('active');
        if (this.tourReposition) {
            window.removeEventListener('resize', this.tourReposition);
            window.removeEventListener('scroll', this.tourReposition, true);
            this.tourReposition = null;
        }
    },

    nextTourStep(): void {
        if (!this.tourActive) return;
        if (this.tourIndex >= this.tourSteps.length - 1) { this.endTour(); return; }
        this.tourIndex += 1;
        this.renderTourStep();
    },

    /** Fill in the bubble text/buttons for the current step, then position it. */
    renderTourStep(): void {
        const step = this.tourSteps[this.tourIndex];
        if (!step) { this.endTour(); return; }
        const t = strings.tour;
        const textEl = document.getElementById('tour-text');
        const stepEl = document.getElementById('tour-step');
        const nextEl = document.getElementById('tour-next');
        // Mouse wording (drag, wheel, 0 key) has a touch variant.
        if (textEl) textEl.textContent = step.key === 'step6' && isCoarse() ? t.step6Touch : t[step.key];
        if (stepEl) stepEl.textContent = `${this.tourIndex + 1}/${this.tourSteps.length}`;
        if (nextEl) nextEl.textContent = (this.tourIndex === this.tourSteps.length - 1) ? t.done : t.next;
        this.positionTourStep();
    },

    /**
     * Place the spotlight hole and the bubble relative to the target element.
     * `following`: called from the per-frame follow loop — a target that is
     * momentarily gone (the tree re-rendering, panned off screen) keeps the
     * last placement instead of skipping the step.
     */
    positionTourStep(following = false): void {
        if (!this.tourActive) return;
        const step = this.tourSteps[this.tourIndex];
        const target = step ? firstVisible(step.selectors) : null;
        const holeEl = document.getElementById('tour-hole');
        const bubble = document.getElementById('tour-bubble');
        if (!target || !holeEl || !bubble) {
            if (!following) this.nextTourStep();
            return;
        }

        // Hover-only card buttons: force-show them while their step is up.
        const revealEl = step.reveal ? (target.closest('.person-card') as HTMLElement | null) ?? target : null;
        document.querySelectorAll('.person-card.tour-reveal').forEach(c => { if (c !== revealEl) c.classList.remove('tour-reveal'); });
        if (revealEl && !revealEl.classList.contains('tour-reveal')) revealEl.classList.add('tour-reveal');

        const r = target.getBoundingClientRect();
        const pad = step.pad ?? 6;
        const bubbleRect = bubble.getBoundingClientRect();
        const bh = bubbleRect.height || 120;
        const bw = bubbleRect.width || 280;
        const key = [this.tourIndex, r.left, r.top, r.width, r.height, bw, bh, window.innerWidth, window.innerHeight].map(Math.round).join(',');
        if (key === lastPlacement) return;
        // Glide between steps; follow the same target (pan, zoom) without lag.
        const sameStep = lastPlacement.startsWith(`${this.tourIndex},`);
        holeEl.style.transition = sameStep ? 'none' : '';
        lastPlacement = key;

        const hole = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
        holeEl.style.left = `${hole.left}px`;
        holeEl.style.top = `${hole.top}px`;
        holeEl.style.width = `${hole.right - hole.left}px`;
        holeEl.style.height = `${hole.bottom - hole.top}px`;

        // Bubble: below the spotlight if there's room, otherwise above it;
        // never over the spotlit area (the padding holds the card's + buttons).
        const gap = 12;
        const fitsBelow = hole.bottom + gap + bh <= window.innerHeight - gap;
        const fitsAbove = hole.top - gap - bh >= gap;
        const top = fitsBelow || !fitsAbove
            ? Math.min(hole.bottom + gap, window.innerHeight - bh - gap)
            : hole.top - gap - bh;
        let left = r.left + r.width / 2 - bw / 2;
        left = Math.max(gap, Math.min(left, window.innerWidth - bw - gap));
        bubble.style.top = `${Math.max(gap, top)}px`;
        bubble.style.left = `${left}px`;
    },
});
