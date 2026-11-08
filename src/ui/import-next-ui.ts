/**
 * The "What next" card after a GEDCOM import from another program (spec 066
 * §1, K4.1 + K1.3). Not a dialog: on a computer and a tablet an anchored card
 * under the Actions button (where the "What's new" card sits), on a phone a
 * bottom sheet, on a phone held sideways a panel on the right. It replaces the
 * two questions after an import (data check, separate families) and the
 * "Import complete" toast. Once per import: closing it marks the import
 * record (`nextCardClosed`). What it shows is src/import-next.ts.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { validateTreeData } from '../validation.js';
import { findComponents } from '../components.js';
import { researchLinkMark } from '../research-link.js';
import { importRecordOf } from '../import-origin.js';
import {
    importNextDue, importNextResearchState, importNextRows, importNextVerifyAvailable, markImportNextClosed,
    importProgramLabel, importProgramName, importDateText, peopleWithImportedFacts,
    type ImportNextRow, type ImportNextPath,
} from '../import-next.js';
import { isMobile, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { setResearchActionLabel } from './research-open-mark.js';
import { onComputer } from './research-ui.js';
import { isHelpOpen } from './help-ui.js';
import { uiModule } from './module.js';
import type { TreeId } from '../types.js';

/**
 * The help chapter the card's help link opens. "A tree from another program"
 * (strom-doc, spec 066 K4.2) is not written yet; until it is, the chapter on
 * loading a family tree (GEDCOM) is the nearest one. Point this at the new
 * chapter's number once strom-doc has it.
 */
export const IMPORT_NEXT_HELP_TOPIC = 'A2';

/** The card waiting to be shown (the import just made), or on screen. */
interface ImportNextPending {
    treeId: TreeId;
    importId: string;
    path: ImportNextPath;
    added?: number;
    updated?: number;
}

type CardMode = 'card' | 'sheet' | 'side';

const SWIPE_CLOSE_PX = 80;
/** How long the card waits for a dialog in its way (the merge's tree manager, a question) to close. */
const WAIT_TICK_MS = 400;
const WAIT_MAX_MS = 10 * 60 * 1000;

let pending: ImportNextPending | null = null;
/** The card was shown in this run: the "What's new" card waits for a later start (§1 1o). */
let shownThisRun = false;
/** On screen: the card itself, or the sheet's overlay. */
let cardEl: HTMLElement | null = null;
let cardMode: CardMode | null = null;
let onResize: (() => void) | null = null;
let waitTimer: ReturnType<typeof setInterval> | null = null;
let switchListener = false;
/** "Find places" was used from the card: the places offer after it is not needed. */
let placesUsed = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className: string, label: string): HTMLButtonElement {
    const b = el('button', className, label);
    b.type = 'button';
    return b;
}

function isShown(node: Element | null): node is HTMLElement {
    return !!node && (node as HTMLElement).offsetParent !== null;
}

function modeNow(): CardMode {
    if (window.matchMedia?.(MQ_PHONE_LANDSCAPE).matches) return 'side';
    return isMobile() ? 'sheet' : 'card';
}

function stopWaiting(): void {
    if (waitTimer) clearInterval(waitTimer);
    waitTimer = null;
}

export const importNextMethods = uiModule({
    /** The card is on screen. */
    isImportNextOpen(): boolean {
        return !!cardEl && cardEl.isConnected;
    },

    /** The card was (or is about to be) shown in this run — the "What's new" card waits (decideWhatsNewCard). */
    importNextThisRun(): boolean {
        return shownThisRun || !!pending;
    },

    /** The card waits for this tree (a merge's new tree not opened yet): the merge asks nothing more itself. */
    importNextPendingFor(treeId: TreeId): boolean {
        return !!pending && pending.treeId === treeId;
    },

    /**
     * After a GEDCOM import: the card, when the file came from another program
     * (its import record is in the tree) and the card was not closed for it.
     * False: nothing to show (Strom's own GEDCOM, no record) — the caller asks
     * what it asked before.
     */
    offerImportNextCard(treeId: TreeId, opts: { importId?: string; path?: ImportNextPath; added?: number; updated?: number }): boolean {
        const data = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : null;
        // A merge's new tree is not open yet: its record is checked when it opens.
        if (data && !importNextDue(data, opts.importId)) return false;
        if (!opts.importId) return false;
        pending = {
            treeId, importId: opts.importId, path: opts.path ?? 'new',
            ...(opts.added !== undefined ? { added: opts.added } : {}),
            ...(opts.updated !== undefined ? { updated: opts.updated } : {}),
        };
        placesUsed = false;
        if (!switchListener) {
            switchListener = true;
            window.addEventListener('strom:tree-switched', () => this.waitForImportNextCard());
        }
        this.waitForImportNextCard();
        return true;
    },

    /** Show the pending card as soon as its tree is open and nothing is in the way. */
    waitForImportNextCard(): void {
        stopWaiting();
        if (!pending || this.isImportNextOpen()) return;
        const started = Date.now();
        const tick = (): boolean => {
            if (!pending) return true;
            if (DataManager.getCurrentTreeId() !== pending.treeId) return Date.now() - started > WAIT_MAX_MS;
            if (this.importNextBlocked()) return Date.now() - started > WAIT_MAX_MS;
            this.showImportNextCard();
            return true;
        };
        if (tick()) return;
        waitTimer = setInterval(() => { if (tick()) stopWaiting(); }, WAIT_TICK_MS);
    },

    /** A dialog, sheet or menu is open: the card waits. */
    importNextBlocked(): boolean {
        return this.dialogStack.length > 0
            || !!document.querySelector('.modal-overlay.active')
            || !!this.bottomSheet
            || !!this.contextMenu
            || this.tourActive
            || isHelpOpen();
    },

    /** Build and show the card for the pending import. */
    showImportNextCard(): void {
        const p = pending;
        if (!p) return;
        const data = DataManager.getData();
        const rec = importRecordOf(data, p.importId);
        if (!rec || rec.nextCardClosed) {
            pending = null;
            return;
        }
        this.hideImportNextCard();
        this.hideWhatsNewCard();
        shownThisRun = true;

        const s = strings.importNext;
        const lang = getCurrentLanguage();
        const prog = importProgramLabel(rec);
        const date = importDateText(rec, lang === 'cs' || lang === 'de' || lang === 'pl' ? lang : 'en');
        const treeName = TreeManager.getTreeMetadata(p.treeId)?.name ?? '';
        const persons = Object.keys(data.persons ?? {}).length;
        const origin = p.path === 'merge'
            ? s.originMerge(treeName, p.added ?? 0, p.updated ?? 0, prog, date)
            : p.path === 'insert'
                ? s.originInsert(treeName, persons, prog, date)
                : s.origin(prog, date, persons);

        // As the two questions did: the data check and the families, computed now.
        const check = validateTreeData(data);
        const families = findComponents(data).filter(c => c.count >= 2).length;
        const meta = TreeManager.getTreeMetadata(p.treeId);
        const computer = onComputer();
        const research = importNextResearchState({
            onComputer: computer,
            linked: !!meta?.research,
            canAdopt: computer && this.researchAdoptAvailable(meta),
        });
        const researchId = research === 'linked' ? this.activeResearchId() : null;
        const rows = importNextRows({
            findings: check.stats.errors + check.stats.warnings,
            families,
            research,
            verify: importNextVerifyAvailable(researchId ? this.researchStatusOf(researchId)?.features : null),
        });

        const mode = modeNow();
        cardMode = mode;
        const card = el('div', `${mode === 'sheet' ? 'bottom-sheet ' : ''}import-next import-next--${mode}`);
        card.id = 'import-next-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', mode === 'sheet' ? 'true' : 'false');
        card.setAttribute('aria-labelledby', 'import-next-title');
        card.dataset.research = research;
        if (mode === 'sheet') card.appendChild(el('div', 'bottom-sheet-handle import-next-handle'));

        const head = el('div', 'import-next-head');
        const headText = el('div', 'import-next-head-text');
        const title = el('h2', 'import-next-title', s.title);
        title.id = 'import-next-title';
        title.tabIndex = -1;
        headText.append(title, el('p', 'import-next-origin', origin));
        head.appendChild(headText);
        if (mode !== 'sheet') {
            const x = button('import-next-x', '×');
            x.setAttribute('aria-label', strings.buttons.close);
            x.addEventListener('click', () => this.closeImportNextCard());
            head.appendChild(x);
        }
        card.appendChild(head);

        const body = el('div', 'import-next-body');
        for (const row of rows) body.appendChild(this.importNextRowEl(row, p.treeId, data, researchId));
        body.appendChild(el('div', 'import-next-note', s.dataNote));
        const links = el('div', 'import-next-links');
        const back = button('import-next-link import-next-back', s.backLink(importProgramName(rec)));
        back.addEventListener('click', () => {
            this.closeImportNextCard();
            void this.exportTargetTreeGedcom({ preset: 'back' });
        });
        // In-app help ("How Strom works"): no mark — it is not the web in a new window.
        const help = button('import-next-link import-next-help', s.help);
        help.addEventListener('click', () => this.showHelp(IMPORT_NEXT_HELP_TOPIC, help));
        links.append(back, help);
        body.appendChild(links);
        card.appendChild(body);

        const foot = el('div', 'import-next-foot');
        const close = button('primary import-next-close', strings.buttons.close);
        close.addEventListener('click', () => this.closeImportNextCard());
        foot.appendChild(close);
        card.appendChild(foot);

        if (mode === 'sheet') {
            const overlay = el('div', 'bottom-sheet-overlay import-next-overlay');
            overlay.appendChild(card);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeImportNextCard(); });
            this.attachImportNextSwipe(card);
            document.body.appendChild(overlay);
            cardEl = overlay;
            requestAnimationFrame(() => overlay.classList.add('active'));
        } else {
            document.body.appendChild(card);
            cardEl = card;
            this.positionImportNextCard();
        }
        onResize = () => {
            if (!this.isImportNextOpen()) return;
            // Crossing a regime (phone ↔ sideways ↔ computer): the card is built again for it.
            if (modeNow() !== cardMode) this.showImportNextCard();
            else this.positionImportNextCard();
        };
        window.addEventListener('resize', onResize);
        title.focus({ preventScroll: true });
    },

    /** One row: its title and text, and its buttons. */
    importNextRowEl(row: ImportNextRow, treeId: TreeId, data: ReturnType<typeof DataManager.getData>, researchId: string | null): HTMLElement {
        const s = strings.importNext;
        const box = el('div', `import-next-row import-next-row--${row.kind}`);
        const text = el('div', 'import-next-row-text');
        const btns = el('div', 'import-next-row-btns');
        const add = (b: HTMLButtonElement, run: () => void, opts: { places?: boolean } = {}): void => {
            b.addEventListener('click', () => {
                if (opts.places) placesUsed = true;
                this.closeImportNextCard();
                run();
            });
            btns.appendChild(b);
        };
        if (row.kind === 'check') {
            text.append(el('div', 'import-next-row-title', strings.treeManager.postImportCheckTitle),
                el('div', 'import-next-row-desc', row.findings > 0 ? s.checkFound(row.findings) : s.checkClean));
            if (row.findings > 0) add(button('import-next-btn', s.review), () => { void this.showTreeValidationDialog(treeId); });
        } else if (row.kind === 'split') {
            text.append(el('div', 'import-next-row-title', strings.split.postImportTitle),
                el('div', 'import-next-row-desc', s.splitText(row.families)));
            add(button('import-next-btn', strings.split.menu), () => { void this.showSplitDialog(treeId); });
        } else if (row.state === 'linked') {
            const places = this.placesOffMapCount();
            text.append(el('div', 'import-next-row-title', s.linkedTitle),
                el('div', 'import-next-row-desc', s.linkedText(places, peopleWithImportedFacts(data))));
            const look = setResearchActionLabel(button('import-next-btn import-next-places', ''), s.places, researchLinkMark('places'));
            add(look, () => this.openPlacesLookAll(), { places: true });
            if (row.verify && researchId) {
                // 065 (bulk verification) brings its own link and its group in RESEARCH_LINK_MARKS; until
                // then importNextVerifyAvailable is false and this button is never drawn (placeholder: open the research).
                const verify = setResearchActionLabel(button('import-next-btn import-next-verify', ''), s.verify, researchLinkMark('open'));
                add(verify, () => this.researchSyncAction('openResearch'));
            }
        } else {
            text.append(el('div', 'import-next-row-title', s.researchTitle),
                el('div', 'import-next-row-desc', s.researchText));
            if (row.state === 'have') {
                // The research runs here and takes this tree over: its set-up opens in the terminal.
                const start = setResearchActionLabel(button('import-next-btn import-next-start', ''),
                    strings.research.startWithTree, researchLinkMark('new'));
                add(start, () => this.startResearchAdopt(treeId));
            } else {
                // What it is and how to install it, in the app: no mark.
                add(button('import-next-btn import-next-install', strings.research.menuItem), () => this.showResearchInfoDialog());
            }
        }
        box.appendChild(text);
        if (btns.childElementCount > 0) box.appendChild(btns);
        return box;
    },

    /** Computer / tablet: under the Actions button, right edges aligned (else the top-right corner). */
    positionImportNextCard(): void {
        const card = cardEl;
        if (!card || cardMode !== 'card') return;
        const anchor = document.querySelector<HTMLElement>('.actions-menu-btn');
        const margin = 16;
        if (isShown(anchor)) {
            const r = anchor.getBoundingClientRect();
            const width = card.offsetWidth || 420;
            const left = Math.max(margin, Math.min(r.right, window.innerWidth - margin) - width);
            card.style.top = `${Math.round(r.bottom + 10)}px`;
            card.style.left = `${Math.round(left)}px`;
            card.style.right = '';
        } else {
            card.style.top = '58px';
            card.style.left = '';
            card.style.right = `${margin}px`;
        }
        card.style.maxHeight = `calc(100vh - ${Math.round(parseFloat(card.style.top) + margin)}px)`;
    },

    /** Drag the sheet down = close (as the other sheets). */
    attachImportNextSwipe(sheet: HTMLElement): void {
        let startY = 0;
        let dragging = false;
        sheet.addEventListener('touchstart', (e) => {
            // Only from the top of the sheet's content: a scrolled list scrolls.
            const body = sheet.querySelector<HTMLElement>('.import-next-body');
            if (body && body.contains(e.target as Node) && body.scrollTop > 0) return;
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
            if (!dragging) return;
            dragging = false;
            sheet.style.transition = '';
            const dy = e.changedTouches[0].clientY - startY;
            if (dy > SWIPE_CLOSE_PX) this.closeImportNextCard();
            else sheet.style.transform = '';
        });
    },

    /**
     * Close the card for good: the import record remembers it, and a research
     * tree gets its places offer now — unless "Find places" was used here.
     */
    closeImportNextCard(): void {
        const p = pending;
        this.hideImportNextCard();
        pending = null;
        stopWaiting();
        if (!p) return;
        if (DataManager.getCurrentTreeId() === p.treeId && !DataManager.isReadOnly()) {
            if (markImportNextClosed(DataManager.getData(), p.importId)) DataManager.resaveCurrent();
        }
        if (!placesUsed && TreeManager.getTreeMetadata(p.treeId)?.research) this.armPlacesOffer(p.treeId);
        placesUsed = false;
        const focusedCard = document.querySelector<HTMLElement>('.person-card.focused');
        if (focusedCard && !document.querySelector('.modal-overlay.active')) focusedCard.focus({ preventScroll: true });
    },

    /** Remove the card without changing any state. */
    hideImportNextCard(): void {
        if (onResize) {
            window.removeEventListener('resize', onResize);
            onResize = null;
        }
        cardEl?.remove();
        cardEl = null;
        cardMode = null;
    },
});
