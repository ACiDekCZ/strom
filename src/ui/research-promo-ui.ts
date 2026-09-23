/**
 * Strom Research in the app (3.0) — the DOM half:
 *  - the welcome-screen offer (`.research-offer`, straight to the website),
 *  - the permanent "AI ancestor research" menu item (desktop ⋯ actions menu,
 *    mobile "More" sheet) with its "New" label and the trigger dots,
 *  - the in-app explanation dialog the menu item opens,
 *  - the one-time "What's new in 3.0" card (desktop: anchored under the
 *    Actions button; bottom-navigation regime: a bottom sheet).
 *
 * Gating is decided by the pure functions in src/research-promo.ts; the
 * address comes from researchSiteUrl() in src/research-link.ts. State lives in
 * the browser settings only. Nothing here makes a network request — the site
 * opens in a new tab on the user's click.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { researchSiteUrl } from '../research-link.js';
import {
    ResearchPromoContext,
    isPromoAvailable,
    isMenuItemVisible,
    isNewMarkerActive,
    decideWhatsNewCard,
} from '../research-promo.js';
import { isToolbarCompact } from '../breakpoints.js';
import { uiModule } from './module.js';

const INFO_MODAL_ID = 'research-info-modal';
const SWIPE_CLOSE_PX = 80;
/** Delay after the first render before the one-time card is considered. */
const CARD_DELAY_MS = 700;

/**
 * This start is an open from Strom Research's command line (?import-url=,
 * ?live=, ?open=). Read at module load, before the external-open code drops
 * the parameters from the address.
 */
const startedFromCli: boolean = (() => {
    try {
        const p = new URLSearchParams(window.location.search);
        return p.has('import-url') || p.has('live') || p.has('open');
    } catch {
        return false;
    }
})();

/** The start carries another flow's parameter (?import=from-file). */
const startedWithImport: boolean = (() => {
    try {
        return new URLSearchParams(window.location.search).has('import');
    } catch {
        return false;
    }
})();

/** The markers may be lit only once the data init ran (lock / view mode known). */
let promoReady = false;
/** The one-time card on screen (desktop card or the sheet overlay). */
let whatsNewEl: HTMLElement | null = null;
let whatsNewResize: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A button label followed by the decorative ↗ (new tab). */
function externalButton(className: string, label: string): HTMLButtonElement {
    const btn = el('button', className);
    btn.type = 'button';
    btn.appendChild(document.createTextNode(label + ' '));
    const arrow = el('span', 'research-ext-arrow', '↗');
    arrow.setAttribute('aria-hidden', 'true');
    btn.appendChild(arrow);
    return btn;
}

function isShown(node: Element | null): node is HTMLElement {
    return !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
}

export const researchPromoMethods = uiModule({
    /** Where the app runs and what it shows (input for the pure gating). */
    researchPromoContext(): ResearchPromoContext {
        const embeddedData = !!(window as Window & { STROM_EMBEDDED_DATA?: unknown }).STROM_EMBEDDED_DATA;
        return {
            embedded: this.appMode === 'embedded' || embeddedData,
            viewMode: DataManager.isViewMode(),
            locked: DataManager.isLocked() || document.body.classList.contains('data-locked'),
            researchTree: !!TreeManager.getActiveTreeMetadata()?.research,
            cliOpen: startedFromCli || DataManager.isLiveFollowing(),
        };
    },

    /**
     * Startup (after the app mode is known): reveal the welcome-screen offer
     * and the menu item where they belong, and keep the markers in sync with
     * tree switches and data changes (a research open makes a research tree).
     */
    initResearchPromo(): void {
        try {
            this.syncResearchPromoAvailability();
            window.addEventListener('strom:tree-switched', () => this.refreshResearchPromo());
            window.addEventListener('strom:data-changed', () => this.refreshResearchPromo());
        } catch (err) {
            console.warn('Research promo unavailable', err);
        }
    },

    /** `body.research-promo` shows the offer + menu item (never in exports / view mode). */
    syncResearchPromoAvailability(): void {
        document.body.classList.toggle('research-promo', isPromoAvailable(this.researchPromoContext()));
    },

    /** After the first real render: light the markers, maybe show the card. */
    researchPromoAfterFirstRender(): void {
        try {
            promoReady = true;
            this.refreshResearchPromo();
            // A new user (welcome screen at start) is settled right away — a
            // first person added within the delay must not bring the card.
            if (DataManager.getAllPersons().length === 0) this.maybeShowWhatsNewCard();
            else setTimeout(() => this.maybeShowWhatsNewCard(), CARD_DELAY_MS);
        } catch (err) {
            console.warn('Research promo unavailable', err);
        }
    },

    /** Is the "New" marker lit right now? */
    isResearchNewActive(): boolean {
        if (!promoReady) return false;
        return isNewMarkerActive(SettingsManager.getResearchPromoState(), this.researchPromoContext(), new Date());
    },

    /** Re-evaluate availability + markers (dots, label, accessible names). */
    refreshResearchPromo(): void {
        try {
            this.syncResearchPromoAvailability();
            // refreshActionMenuBadges ends with refreshResearchNewMarker so
            // the anniversaries dot and the "New" dot are decided together.
            this.refreshActionMenuBadges();
        } catch (err) {
            console.warn('Research promo refresh failed', err);
        }
    },

    /**
     * Paint the "New" marker. `anniversaryCount` is the red anniversaries
     * signal: on the desktop ⋯ trigger it takes precedence (one dot only);
     * the mobile "More" dot is shared (it is the accent colour anyway).
     */
    refreshResearchNewMarker(anniversaryCount: number): void {
        const active = this.isResearchNewActive();
        if (active && !SettingsManager.getResearchPromoState().researchNewFirstSeen) {
            SettingsManager.setResearchNewFirstSeen(new Date().toISOString());
        }
        const s = strings.research;

        const row = document.getElementById('research-menu-row');
        const rowVisible = promoReady && isMenuItemVisible(this.researchPromoContext());
        document.body.classList.toggle('research-menu', rowVisible);
        if (row) {
            row.setAttribute('aria-label', active ? `${s.menuItem}, ${s.newSr}` : s.menuItem);
            const badge = row.querySelector<HTMLElement>('.research-new-badge');
            if (badge) badge.hidden = !active;
        }

        const newDot = document.getElementById('actions-menu-new-dot');
        if (newDot) newDot.style.display = active && anniversaryCount === 0 ? 'block' : 'none';
        const moreDot = document.getElementById('bottom-bar-more-dot');
        if (moreDot && active) moreDot.style.display = 'block';

        const actionsBtn = document.querySelector('.actions-menu-btn');
        if (actionsBtn) {
            actionsBtn.setAttribute('aria-label', active ? `${strings.menu.actions}, ${s.triggerNewSr}` : strings.menu.actions);
        }
        const moreTab = document.getElementById('bb-view-more');
        if (moreTab) {
            if (active) moreTab.setAttribute('aria-label', `${strings.mobileMenu.more}, ${s.triggerNewSr}`);
            else moreTab.removeAttribute('aria-label');
        }
    },

    /** The "New" marker goes out for good. */
    dismissResearchNew(): void {
        try {
            SettingsManager.setResearchNewDismissed();
        } finally {
            this.refreshResearchPromo();
        }
    },

    /** Open the Strom Research website in a new tab (app language). */
    openResearchSite(): void {
        try {
            window.open(researchSiteUrl(getCurrentLanguage()), '_blank', 'noopener');
        } catch (err) {
            console.warn('Opening the Strom Research page failed', err);
        }
    },

    /** The "More" sheet row (bottom-navigation regime), or null when not offered. */
    researchMenuSheetRow(): { label: string; run: () => void; isNew: boolean; ariaLabel: string } | null {
        if (!isMenuItemVisible(this.researchPromoContext()) || DataManager.isReadOnly()) return null;
        const isNew = this.isResearchNewActive();
        const s = strings.research;
        return {
            label: s.menuItem,
            isNew,
            ariaLabel: isNew ? `${s.menuItem}, ${s.newSr}` : s.menuItem,
            run: () => this.showResearchInfoDialog(),
        };
    },

    // ---- The explanation dialog (menu item) ----

    /**
     * "AI ancestor research": what it is and what it needs, before leaving the
     * app. Opening it puts the "New" marker out; closing returns focus to the
     * menu trigger it came from.
     */
    showResearchInfoDialog(): void {
        this.closeActionsMenu();
        this.hideBottomSheet();
        this.hideWhatsNewCard();
        this.dismissResearchNew();
        document.getElementById(INFO_MODAL_ID)?.remove();

        // Focus goes back to the visible menu trigger (dialog-focus.ts
        // remembers what had focus when the dialog opened).
        const trigger = [document.querySelector('.actions-menu-btn'), document.getElementById('bb-view-more')]
            .find(isShown);
        trigger?.focus({ preventScroll: true });

        const s = strings.research;
        const overlay = el('div', 'modal-overlay active');
        overlay.id = INFO_MODAL_ID;
        const modal = el('div', 'modal modal--sm research-info-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'research-info-title');

        const header = el('div', 'modal-header');
        const title = el('h2', undefined, s.menuItem);
        title.id = 'research-info-title';
        const closeX = el('button', 'close-btn');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', s.close);
        closeX.innerHTML = '&times;';
        header.append(title, closeX);

        const content = el('div', 'modal-content research-info-body');
        content.appendChild(el('p', 'research-info-lead', s.dialogLead));
        const points = el('ol', 'research-info-points');
        const pointDefs: Array<[string, string]> = [
            [s.point1Title, s.point1Text], [s.point2Title, s.point2Text], [s.point3Title, s.point3Text],
        ];
        pointDefs.forEach(([t, d], i) => {
            const li = el('li', 'research-info-point');
            const num = el('span', 'research-info-num', String(i + 1));
            num.setAttribute('aria-hidden', 'true');
            const text = el('div');
            text.append(el('div', 'research-info-point-title', t), el('div', 'research-info-point-text', d));
            li.append(num, text);
            points.appendChild(li);
        });
        content.appendChild(points);
        const need = el('div', 'research-info-need');
        need.append(el('div', 'research-info-need-title', s.needTitle), el('p', 'research-info-need-text', s.needText));
        content.appendChild(need);

        const buttons = el('div', 'modal-buttons research-info-buttons');
        const closeBtn = el('button', 'secondary', s.close);
        closeBtn.type = 'button';
        const openBtn = externalButton('primary', s.openSite);
        buttons.append(closeBtn, openBtn);

        modal.append(header, content, buttons);
        overlay.appendChild(modal);

        const close = (): void => this.closeResearchInfoDialog();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        closeX.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        openBtn.addEventListener('click', () => {
            this.openResearchSite();
            close();
        });

        document.body.appendChild(overlay);
        // Escape through the shared dialog stack (see misc.ts keyboard handler).
        this.pushDialog(INFO_MODAL_ID);
    },

    closeResearchInfoDialog(): void {
        document.getElementById(INFO_MODAL_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== INFO_MODAL_ID);
    },

    // ---- The one-time "What's new in 3.0" card ----

    isWhatsNewCardOpen(): boolean {
        return !!whatsNewEl && whatsNewEl.isConnected;
    },

    /** Something is in the way of the card (a dialog, a sheet, an import, the tour offer). */
    isWhatsNewBlocked(): boolean {
        return this.dialogStack.length > 0
            || !!document.querySelector('.modal-overlay.active')
            || !!this.bottomSheet
            || !!this.contextMenu
            || !!document.querySelector('.tour-offer')
            || document.documentElement.classList.contains('external-opening')
            || startedWithImport;
    },

    /** Show the card when every condition holds (once per browser). */
    maybeShowWhatsNewCard(): void {
        try {
            if (this.isWhatsNewCardOpen()) return;
            const decision = decideWhatsNewCard(SettingsManager.getResearchPromoState(), {
                ...this.researchPromoContext(),
                treeReady: promoReady && !!DataManager.getCurrentTreeId(),
                emptyTree: DataManager.getAllPersons().length === 0,
                busy: this.isWhatsNewBlocked(),
                tourActive: this.tourActive,
            });
            if (decision === 'mark-shown') {
                SettingsManager.setWhatsNew30Shown();
                return;
            }
            if (decision !== 'show') return;
            // Shown at most once — even when it is only swiped away.
            SettingsManager.setWhatsNew30Shown();
            this.showWhatsNewCard();
        } catch (err) {
            console.warn('What\'s new card unavailable', err);
        }
    },

    /** Build the card: desktop anchored card, or the bottom sheet (≤ 1024px). */
    showWhatsNewCard(): void {
        this.hideWhatsNewCard();
        const anchor = document.querySelector<HTMLElement>('.actions-menu-btn');
        const asSheet = isToolbarCompact() || !isShown(anchor);
        const s = strings.research;

        const card = el('div', asSheet ? 'bottom-sheet whats-new whats-new-sheet' : 'whats-new whats-new-card');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', asSheet ? 'true' : 'false');
        card.setAttribute('aria-labelledby', 'whats-new-title');
        card.tabIndex = -1;

        if (asSheet) card.appendChild(el('div', 'bottom-sheet-handle'));
        else {
            const arrow = el('span', 'whats-new-arrow');
            arrow.setAttribute('aria-hidden', 'true');
            card.appendChild(arrow);
        }

        const body = el('div', 'whats-new-body');
        const wordmark = el('div', 'whats-new-wordmark', s.brand);
        const dot = el('span', 'whats-new-wordmark-dot');
        dot.setAttribute('aria-hidden', 'true');
        wordmark.appendChild(dot);
        const title = el('h2', 'whats-new-title', s.cardTitle);
        title.id = 'whats-new-title';
        body.append(wordmark, title, el('p', 'whats-new-text', s.cardText));
        if (asSheet) body.appendChild(el('p', 'whats-new-runs', s.runsOnComputer));
        const actions = el('div', 'whats-new-actions');
        const notNow = el('button', 'secondary whats-new-not-now', s.notNow);
        notNow.type = 'button';
        const learnMore = externalButton('primary whats-new-learn-more', s.learnMore);
        actions.append(notNow, learnMore);
        body.appendChild(actions);
        card.appendChild(body);

        const footer = el('div', 'whats-new-footer');
        footer.appendChild(el('div', 'menu-section-header whats-new-also', s.alsoNew));
        const list = el('ul', 'whats-new-list');
        for (const item of [s.news1, s.news2, s.news3]) list.appendChild(el('li', undefined, item));
        footer.appendChild(list);
        card.appendChild(footer);

        notNow.addEventListener('click', () => this.dismissWhatsNewCard(false));
        learnMore.addEventListener('click', () => this.dismissWhatsNewCard(true));

        if (asSheet) {
            const overlay = el('div', 'bottom-sheet-overlay whats-new-overlay');
            overlay.appendChild(card);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismissWhatsNewCard(false); });
            this.attachWhatsNewSwipe(card);
            document.body.appendChild(overlay);
            whatsNewEl = overlay;
            requestAnimationFrame(() => overlay.classList.add('active'));
        } else {
            document.body.appendChild(card);
            whatsNewEl = card;
            this.positionWhatsNewCard();
            whatsNewResize = () => {
                // Crossing into the bottom-navigation regime: the anchor is gone.
                if (isToolbarCompact()) this.hideWhatsNewCard();
                else this.positionWhatsNewCard();
            };
            window.addEventListener('resize', whatsNewResize);
        }
        card.focus({ preventScroll: true });
    },

    /** Place the desktop card under the Actions button, arrow on its centre. */
    positionWhatsNewCard(): void {
        const card = whatsNewEl;
        const anchor = document.querySelector<HTMLElement>('.actions-menu-btn');
        if (!card || !anchor || !card.classList.contains('whats-new-card')) return;
        const r = anchor.getBoundingClientRect();
        const width = card.offsetWidth || 384;
        const margin = 16;
        const centre = r.left + r.width / 2;
        // Right edge lines up with the button's right edge, kept ≥ 16px from the window.
        let left = Math.min(r.right, window.innerWidth - margin) - width;
        left = Math.max(margin, left);
        card.style.top = `${r.bottom + 14}px`;
        card.style.left = `${Math.round(left)}px`;
        const arrow = card.querySelector<HTMLElement>('.whats-new-arrow');
        if (arrow) {
            const x = Math.min(Math.max(centre - left - 6, 16), width - 28);
            arrow.style.left = `${Math.round(x)}px`;
        }
    },

    /** Swipe down on the sheet = "Not now" (mirrors the other sheets). */
    attachWhatsNewSwipe(sheet: HTMLElement): void {
        let startY = 0;
        let dragging = false;
        sheet.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });
        sheet.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        sheet.addEventListener('touchend', (e) => {
            dragging = false;
            sheet.style.transition = '';
            const dy = e.changedTouches[0].clientY - startY;
            if (dy > SWIPE_CLOSE_PX) this.dismissWhatsNewCard(false);
            else sheet.style.transform = '';
        });
    },

    /** "Not now" / "Learn more": close the card and put the "New" marker out. */
    dismissWhatsNewCard(learnMore: boolean): void {
        if (learnMore) this.openResearchSite();
        this.hideWhatsNewCard();
        this.dismissResearchNew();
        // Back to the tree (the focused person's card), not lost on <body>.
        const focusedCard = document.querySelector<HTMLElement>('.person-card.focused');
        if (focusedCard) focusedCard.focus({ preventScroll: true });
    },

    /** Remove the card without changing any state. */
    hideWhatsNewCard(): void {
        if (whatsNewResize) {
            window.removeEventListener('resize', whatsNewResize);
            whatsNewResize = null;
        }
        whatsNewEl?.remove();
        whatsNewEl = null;
    },
});
