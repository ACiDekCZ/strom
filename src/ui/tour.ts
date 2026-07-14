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
// Later candidates are the mobile equivalents (hamburger when a desktop-only
// control is hidden).
const TOUR_STEPS: TourStepDef[] = [
    { key: 'step1', selectors: ['.person-card.focused', '.person-card'] },
    { key: 'step2', selectors: ['.person-card.focused', '.person-card'], reveal: true, pad: 18, skipOnCoarse: true },
    { key: 'step3', selectors: ['.toolbar-buttons button', '.add-person-round', '.hamburger-btn'] },
    { key: 'step4', selectors: ['#focus-controls', '#toolbar-focus-name'] },
    { key: 'step5', selectors: ['#view-mode-segment', '.hamburger-btn'] },
    { key: 'step6', selectors: ['.zoom-controls'] },
    { key: 'step7', selectors: ['#toolbar-search-picker', '.hamburger-btn'] },
    { key: 'step8', selectors: ['.tree-switcher-btn', '.hamburger-btn'] },
];

function isCoarse(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function firstVisible(selectors: string[]): HTMLElement | null {
    for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.offsetParent !== null) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
    }
    return null;
}

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
            + `<button type="button" class="tour-offer-close" aria-label="close">&times;</button>`;
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
    },

    endTour(): void {
        this.tourActive = false;
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
        if (textEl) textEl.textContent = t[step.key];
        if (stepEl) stepEl.textContent = `${this.tourIndex + 1}/${this.tourSteps.length}`;
        if (nextEl) nextEl.textContent = (this.tourIndex === this.tourSteps.length - 1) ? t.done : t.next;
        this.positionTourStep();
    },

    /** Place the spotlight hole and the bubble relative to the target element. */
    positionTourStep(): void {
        if (!this.tourActive) return;
        const step = this.tourSteps[this.tourIndex];
        const target = step ? firstVisible(step.selectors) : null;
        const hole = document.getElementById('tour-hole');
        const bubble = document.getElementById('tour-bubble');
        if (!target || !hole || !bubble) { if (this.tourActive) this.nextTourStep(); return; }

        // Hover-only card buttons: force-show them while their step is up.
        document.querySelectorAll('.person-card.tour-reveal').forEach(c => c.classList.remove('tour-reveal'));
        if (step.reveal) (target.closest('.person-card') ?? target).classList.add('tour-reveal');

        const r = target.getBoundingClientRect();
        const pad = step.pad ?? 6;
        hole.style.left = `${r.left - pad}px`;
        hole.style.top = `${r.top - pad}px`;
        hole.style.width = `${r.width + pad * 2}px`;
        hole.style.height = `${r.height + pad * 2}px`;

        // Bubble: below the target if there's room, otherwise above.
        const bubbleRect = bubble.getBoundingClientRect();
        const bh = bubbleRect.height || 120;
        const bw = bubbleRect.width || 280;
        const below = r.bottom + 12 + bh <= window.innerHeight;
        const top = below ? r.bottom + 12 : Math.max(12, r.top - bh - 12);
        let left = r.left + r.width / 2 - bw / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - bw - 12));
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
    },
});
