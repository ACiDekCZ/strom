/**
 * Linked in the view only: where the shown links are kept track of — the
 * indicator in the view ("Linked in the view only · 2 ×"), the list of every
 * record (its switch, Find, ×; the main switch; "Remove invalid" / "Remove
 * all" with Undo in the panel), the notice after a load of the research made
 * some invalid, and the entries that open the list (the Research menu,
 * Settings → Tree). Plus the two things that keep the feature honest: other
 * windows of the same tree follow a change of the records (a `storage`
 * event), and a live research bridge has its say on whether it shows at all
 * (`hypothesis.links` in /status). None of it is a change of the tree's data:
 * only the tree's device setting (src/view-links.ts) is written.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { StromData, TreeId } from '../types.js';
import { shownName } from '../person-name.js';
import {
    ResolvedViewLink, ViewLink, isViewLinksMaster, loadViewLinks, newlyInvalidViewLinks, orderViewLinkRows, removeViewLinks,
    resolveViewLinks, saveViewLinks, setViewLinkOn, setViewLinksMaster, unlinkViewLink, viewLinkContext, viewLinkCounts,
    viewLinkDependents, viewLinkPeopleCount, viewLinksTreeOfKey,
} from '../view-links.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { uiModule } from './module.js';

const PILL_ID = 'view-links-pill';
const PANEL_ID = 'view-links-panel';
/** The notices in the tree stay 6 s; "Removed · Undo" in the list 8 s. */
const TOAST_MS = 6000;
const PANEL_TOAST_MS = 8000;

/** What the list remembers while open: where focus goes back, the in-panel notice. */
let panelOpener: HTMLElement | null = null;
let panelToastTimer: ReturnType<typeof setTimeout> | null = null;
let panelKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let howToOpen = false;
/** Invalid records already told about after a load in this page (tree, hypothesis, version): once each. */
const toldInvalid = new Set<string>();
let storageWatched = false;
/** Whether the feature showed at the last drawing (a bridge's answer may change it). */
let offeredAtDrawing: boolean | null = null;

const sheet = (): boolean => window.matchMedia?.(`${MQ_MOBILE}, ${MQ_PHONE_LANDSCAPE}`).matches === true;
const landscape = (): boolean => window.matchMedia?.(MQ_PHONE_LANDSCAPE).matches === true;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/**
 * What may stand at the top of the view above the indicator: the toolbar,
 * the phone's person row, the descendants badge, the evidence pill, the
 * "following paused" pill, the standalone-file banner.
 */
const TOP_CHROME = ['.toolbar', '.focus-controls', '.descendants-badge', '#evidence-pill', '#live-follow-pill', '.embedded-mode-banner'];
let pillWatch: MutationObserver | null = null;

/** Put the indicator 8px under whatever stands at the top of the view (sideways the stylesheet places it). */
function placePill(): void {
    const pill = document.getElementById(PILL_ID);
    if (!pill) return;
    let bottom = 0;
    const own = pill.getBoundingClientRect();
    for (const sel of TOP_CHROME) {
        for (const node of document.querySelectorAll<HTMLElement>(sel)) {
            if (node === pill || node.getClientRects().length === 0) continue;
            const r = node.getBoundingClientRect();
            // Only the top chrome: a pill a phone puts above its bottom bar does not count.
            if (r.height === 0 || r.top > window.innerHeight / 3) continue;
            // Beside the indicator (a panel at the left edge) it does not push it down.
            if (r.right <= own.left || r.left >= own.right) continue;
            if (getComputedStyle(node).visibility === 'hidden') continue;
            bottom = Math.max(bottom, r.bottom);
        }
    }
    const top = `${Math.round(Math.max(bottom, 56) + 8)}px`;
    if (pill.style.getPropertyValue('--view-links-top') !== top) pill.style.setProperty('--view-links-top', top);
}

function watchPill(on: boolean): void {
    if (!on) {
        pillWatch?.disconnect();
        pillWatch = null;
        window.removeEventListener('resize', placePill);
        return;
    }
    if (pillWatch) return;
    // A pill coming or going, the person row's steppers opening (a class of the body).
    pillWatch = new MutationObserver(() => placePill());
    pillWatch.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', placePill);
}

export const viewLinksListMethods = uiModule({
    /** Once at start: the live bridge's say, other windows' changes of the records, the browser's print. */
    initViewLinks(): void {
        TreeRenderer.setViewLinksBridge(() => this.viewLinksBridgeState());
        if (storageWatched || typeof window === 'undefined') return;
        storageWatched = true;
        window.addEventListener('storage', (e) => {
            const tree = viewLinksTreeOfKey(e.key);
            if (tree === null) return;
            const current = DataManager.getCurrentTreeId();
            if (!current || (tree !== '' && tree !== current)) return;
            void this.viewLinksChangedElsewhere();
        });
        // The browser prints the tree laid out without the shown links (the
        // poster's own print hides the tree and prints its sheets instead).
        window.addEventListener('beforeprint', () => {
            if (!document.body.classList.contains('poster-printing')) void TreeRenderer.setPrinting(true);
        });
        window.addEventListener('afterprint', () => { void TreeRenderer.setPrinting(false); });
    },

    /**
     * What the tree's live research bridge said about the feature: its
     * /status features once it answered in this page (null: none asked — a
     * tree from a file, an archive or a bridge not reached: the data alone).
     */
    viewLinksBridgeState(): { features: readonly string[] | null } | null {
        const id = this.activeResearchId();
        const status = id ? this.researchStatusOf(id) : null;
        return status ? { features: status.features ?? null } : null;
    },

    /**
     * The research's bridge answered (src/ui/research-sync-ui.ts): when what
     * it says turns the feature on or off for the tree, the tree is drawn
     * again (the links, the edge's actions, the indicator).
     */
    viewLinksBridgeChanged(): void {
        if (offeredAtDrawing === null || !DataManager.getCurrentTreeId()) return;
        if (this.viewLinksListOffered() !== offeredAtDrawing) void TreeRenderer.refreshViewLinks(() => { /* the bridge said it */ });
    },

    /** Another window of this tree changed the records or the main switch: drawn again here. */
    async viewLinksChangedElsewhere(): Promise<void> {
        await TreeRenderer.refreshViewLinks(() => { /* stored there already */ });
        this.renderViewLinksPanel();
    },

    /** The records of the open tree against its data now. */
    viewLinksResolved(): ResolvedViewLink[] {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return [];
        return resolveViewLinks(DataManager.getData(), loadViewLinks(treeId));
    },

    /** The shown links as the menus count them: drawable and switched on, the main switch on (0 where the feature does not show). */
    viewLinksShownCount(): number {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || !TreeRenderer.viewLinksOffered() || !isViewLinksMaster(treeId)) return 0;
        return viewLinkCounts(this.viewLinksResolved()).on;
    },

    /**
     * The row an output's dialog carries while links are shown (the poster,
     * the book, the view's export, a tree from the view, sharing): "View-only
     * links (n) are not included", no action. Stands right after `after` (the
     * preview, or what the output prints), and goes when none is shown or
     * `show` is false.
     */
    renderViewLinksNote(after: Element | null, show = true): void {
        const parent = after?.parentElement;
        if (!after || !parent) return;
        const n = show ? this.viewLinksShownCount() : 0;
        let note = parent.querySelector<HTMLElement>(':scope > .view-links-note');
        if (n === 0) {
            note?.remove();
            return;
        }
        if (!note) {
            note = el('p', 'view-links-note');
            note.append(el('span', 'view-link-icon view-link-icon--12'), el('span', 'view-links-note__text'));
            note.firstElementChild!.setAttribute('aria-hidden', 'true');
        }
        if (after.nextElementSibling !== note) after.after(note);
        note.querySelector('.view-links-note__text')!.textContent = strings.export.viewLinksNote(n);
    },

    /** Where the list is offered: a tree whose research says what a variant would connect (src/view-links.ts viewLinksAvailable). */
    viewLinksListOffered(): boolean {
        return !!DataManager.getCurrentTreeId() && TreeRenderer.viewLinksOffered();
    },

    // ==================== THE INDICATOR ====================

    /**
     * After each drawing: the indicator at the top of the view while the
     * view draws shown links (the main switch on), and the open list in step.
     */
    updateViewLinksIndicator(): void {
        offeredAtDrawing = this.viewLinksListOffered();
        const n = TreeRenderer.getViewLayer()?.links.length ?? 0;
        let pill = document.getElementById(PILL_ID);
        if (n === 0 || !this.viewLinksListOffered()) {
            pill?.remove();
            watchPill(false);
        } else {
            const v = strings.viewLinks;
            if (!pill) {
                pill = el('div', 'view-links-pill');
                pill.id = PILL_ID;
                pill.setAttribute('role', 'region');
                document.body.appendChild(pill);
            }
            pill.setAttribute('aria-label', v.state);
            pill.replaceChildren();
            const open = el('button', 'view-links-pill__open');
            open.type = 'button';
            open.setAttribute('aria-label', `${v.state} · ${n}. ${v.openList}`);
            open.title = v.openList;
            open.setAttribute('aria-haspopup', 'dialog');
            const icon = el('span', 'view-link-icon view-link-icon--12');
            icon.setAttribute('aria-hidden', 'true');
            const long = el('span', 'view-links-pill__label view-links-pill__label--long', `${v.state} · `);
            const short = el('span', 'view-links-pill__label view-links-pill__label--short', `${v.indicatorShort} · `);
            const count = el('strong', 'view-links-pill__count', String(n));
            open.append(icon, long, short, count);
            open.onclick = () => this.openViewLinksPanel(open);
            const close = el('button', 'view-links-pill__close', '×');
            close.type = 'button';
            close.setAttribute('aria-label', v.turnOffAria);
            close.title = v.turnOffAria;
            close.onclick = () => void this.viewLinksTurnOff();
            pill.append(open, close);
            placePill();
            watchPill(true);
        }
        this.renderViewLinksPanel();
    },

    /** × on the indicator: the main switch off; the notice turns it on again. */
    async viewLinksTurnOff(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        await TreeRenderer.refreshViewLinks(() => setViewLinksMaster(treeId, false));
        const v = strings.viewLinks;
        this.showToast(v.offToast, TOAST_MS, {
            kind: 'view-links-off',
            action: { label: v.turnOn, run: () => void this.viewLinksSetMaster(true) },
        });
    },

    /** The main switch "Show in the tree". */
    async viewLinksSetMaster(on: boolean): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        await TreeRenderer.refreshViewLinks(() => setViewLinksMaster(treeId, on));
    },

    // ==================== THE LIST ====================

    viewLinksPanelOpen(): boolean {
        return !!document.getElementById(PANEL_ID);
    },

    /**
     * The list "Linked in the view only": a 420px panel on the right (computer,
     * tablet), a full-height sheet on a phone (sideways at most 560px wide,
     * centred). Not modal on a wide screen: the tree stays usable beside it.
     * Esc and × close it; focus goes back where it came from.
     */
    openViewLinksPanel(opener?: HTMLElement | null): void {
        if (!this.viewLinksListOffered()) return;
        this.closeViewLinkPopups();
        panelOpener = opener ?? (document.activeElement as HTMLElement | null);
        howToOpen = false;
        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = el('aside', 'view-links-panel');
            panel.id = PANEL_ID;
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-labelledby', `${PANEL_ID}-title`);
            document.body.appendChild(panel);
            panelKeyHandler = (e: KeyboardEvent) => {
                const open = document.getElementById(PANEL_ID);
                if (!open) return;
                // The sheet over the whole screen keeps the keyboard inside.
                if (e.key === 'Tab' && open.classList.contains('view-links-panel--sheet') && !document.getElementById('view-link-chain')) {
                    const all = [...open.querySelectorAll<HTMLElement>('button')].filter(b => b.getClientRects().length > 0);
                    if (all.length === 0) return;
                    const first = all[0], last = all[all.length - 1];
                    if (!open.contains(document.activeElement)) {
                        e.preventDefault();
                        first.focus();
                    } else if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                    return;
                }
                // Escape: the app's keyboard handler (src/ui/misc.ts) closes it in its turn.
            };
            document.addEventListener('keydown', panelKeyHandler);
        }
        this.renderViewLinksPanel();
        panel.querySelector<HTMLElement>('.view-links-panel__close')?.focus({ preventScroll: true });
    },

    closeViewLinksPanel(): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        if (panelToastTimer) clearTimeout(panelToastTimer);
        panelToastTimer = null;
        if (panelKeyHandler) document.removeEventListener('keydown', panelKeyHandler);
        panelKeyHandler = null;
        const back = panelOpener;
        panelOpener = null;
        const hadFocus = panel.contains(document.activeElement);
        panel.remove();
        if (hadFocus) {
            const target = back?.isConnected && back.getClientRects().length > 0 ? back : document.querySelector<HTMLElement>(`#${PILL_ID} .view-links-pill__open`);
            target?.focus({ preventScroll: true });
        }
    },

    /** Draw the open list again (nothing when closed); the focused control keeps the focus. */
    renderViewLinksPanel(): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || !this.viewLinksListOffered()) {
            this.closeViewLinksPanel();
            return;
        }
        const v = strings.viewLinks;
        // A phone turned: the sheet or the panel.
        panel.classList.toggle('view-links-panel--sheet', sheet());
        panel.setAttribute('aria-modal', sheet() ? 'true' : 'false');
        const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
        const toast = panel.querySelector('.view-links-panel__toast');
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const resolved = resolveViewLinks(data, loadViewLinks(treeId), ctx);
        const master = isViewLinksMaster(treeId);
        const counts = viewLinkCounts(resolved);
        const positions = TreeRenderer.getPositions();
        const rows = orderViewLinkRows(resolved, id => positions.get(id));

        panel.replaceChildren();
        if (panel.classList.contains('view-links-panel--sheet')) panel.appendChild(el('div', 'view-links-panel__handle'));

        const head = el('div', 'view-links-panel__head');
        const title = el('h2', 'view-links-panel__title', v.state);
        title.id = `${PANEL_ID}-title`;
        const close = el('button', 'view-links-panel__close', '×');
        close.type = 'button';
        close.dataset.focusKey = 'close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.title = strings.buttons.close;
        close.onclick = () => this.closeViewLinksPanel();
        head.append(title, close);

        const masterRow = el('div', 'view-links-panel__master');
        const masterText = el('div', 'view-links-panel__master-text');
        const masterName = el('span', 'view-links-panel__master-name', v.master);
        masterName.id = `${PANEL_ID}-master`;
        const masterSub = el('span', 'view-links-panel__master-sub', master ? v.masterCount(counts.on, counts.drawable) : v.masterOff);
        masterSub.id = `${PANEL_ID}-master-sub`;
        masterText.append(masterName, masterSub);
        const masterSwitch = this.viewLinksSwitch(master, `${PANEL_ID}-master`);
        masterSwitch.classList.add('view-links-panel__master-switch');
        masterSwitch.setAttribute('aria-describedby', masterSub.id);
        masterSwitch.dataset.focusKey = 'master';
        masterSwitch.onclick = () => void this.viewLinksSetMaster(!master);
        masterRow.append(masterText, masterSwitch);

        const list = el('div', 'view-links-panel__list');
        list.classList.toggle('is-master-off', !master);
        if (rows.length === 0) {
            const empty = el('div', 'view-links-panel__empty');
            empty.appendChild(el('p', 'view-links-panel__empty-text', v.empty));
            const how = el('button', 'link-button view-links-panel__howto', v.howTo);
            how.type = 'button';
            how.dataset.focusKey = 'howto';
            how.setAttribute('aria-expanded', String(howToOpen));
            how.setAttribute('aria-controls', `${PANEL_ID}-howto`);
            const help = el('p', 'view-links-panel__howto-text', v.howToText);
            help.id = `${PANEL_ID}-howto`;
            help.hidden = !howToOpen;
            how.onclick = () => {
                howToOpen = !howToOpen;
                how.setAttribute('aria-expanded', String(howToOpen));
                help.hidden = !howToOpen;
            };
            empty.append(how, help);
            list.appendChild(empty);
        }
        for (const r of rows) list.appendChild(this.viewLinkRow(r, data, ctx));

        const foot = el('div', 'view-links-panel__foot');
        if (counts.invalid > 0) {
            const bad = el('button', 'view-links-panel__remove-invalid', v.removeInvalid);
            bad.type = 'button';
            bad.dataset.focusKey = 'remove-invalid';
            bad.onclick = () => this.viewLinksRemove(resolved.filter(x => x.state === 'invalid').map(x => x.link.hypo));
            foot.appendChild(bad);
        }
        if (rows.length > 0) {
            const all = el('button', 'view-links-panel__remove-all', v.removeAll);
            all.type = 'button';
            all.dataset.focusKey = 'remove-all';
            all.onclick = () => this.viewLinksRemove(resolved.map(x => x.link.hypo));
            foot.appendChild(all);
        }
        foot.hidden = foot.childElementCount === 0;

        panel.append(head, masterRow, list, foot);
        if (toast) panel.appendChild(toast);
        if (focusKey) {
            (panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) ?? close).focus({ preventScroll: true });
        }
    },

    /** A switch (role="switch") of the list; `labelledBy` names it. */
    viewLinksSwitch(on: boolean, labelledBy: string | null, label?: string): HTMLButtonElement {
        const sw = el('button', 'view-link-switch view-links-switch');
        sw.type = 'button';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(on));
        if (labelledBy) sw.setAttribute('aria-labelledby', labelledBy);
        if (label) sw.setAttribute('aria-label', label);
        const track = el('span', 'view-link-switch__track');
        track.setAttribute('aria-hidden', 'true');
        sw.appendChild(track);
        return sw;
    },

    /**
     * One row: its switch (drawable), a dashed outline (linked for real) or the
     * same outline quiet (no longer valid); whom it concerns, "H0022 · version
     * B: claim", "+ 5 people" / "Now linked for real" / "No longer valid:
     * reason"; Find (not for an invalid one); × removes.
     */
    viewLinkRow(r: ResolvedViewLink, data: StromData, ctx: ReturnType<typeof viewLinkContext>): HTMLElement {
        const v = strings.viewLinks;
        const link = r.link;
        const key = link.hypo;
        const row = el('div', `view-links-row view-links-row--${r.state}`);
        row.dataset.hypo = link.hypo;
        row.dataset.state = r.state;
        if (r.state === 'draw') row.classList.toggle('is-off', !link.on);
        const who = capitalize(this.viewLinkWho(link));
        const whoId = `${PANEL_ID}-who-${key}`;

        const lead = el('div', 'view-links-row__lead');
        if (r.state === 'draw') {
            const sw = this.viewLinksSwitch(link.on, null, v.rowSwitchAria(who));
            sw.dataset.focusKey = `switch:${key}`;
            sw.onclick = () => void this.viewLinksToggleRow(link.hypo, !link.on, sw);
            lead.appendChild(sw);
        } else {
            const outline = el('span', 'view-links-row__outline');
            outline.setAttribute('aria-hidden', 'true');
            lead.appendChild(outline);
        }

        const text = el('div', 'view-links-row__text');
        const name = el('span', 'view-links-row__who', who);
        name.id = whoId;
        const title = ctx.hypotheses.get(link.hypo)?.variants?.find(x => x.id === link.variant)?.title ?? '';
        const claim = el('span', 'view-links-row__claim', v.rowVariant(link.hypo, link.variant, title));
        claim.title = claim.textContent ?? '';
        text.append(name, claim);
        if (r.state === 'draw') text.appendChild(el('span', 'view-links-row__people', v.people(viewLinkPeopleCount(data, link, ctx))));
        else if (r.state === 'real') text.appendChild(el('span', 'view-links-row__status view-links-row__status--real', v.real));
        else text.appendChild(el('span', 'view-links-row__status view-links-row__status--invalid', v.invalid(v.reason[r.reason])));

        row.append(lead, text);
        if (r.state !== 'invalid') {
            const find = el('button', 'view-links-row__find', v.find);
            find.type = 'button';
            find.dataset.focusKey = `find:${key}`;
            find.setAttribute('aria-label', v.findAria(who));
            find.onclick = () => void this.viewLinksFindRow(r);
            row.appendChild(find);
        } else {
            row.appendChild(el('span', 'view-links-row__find-gap'));
        }
        const remove = el('button', 'view-links-row__remove', '×');
        remove.type = 'button';
        remove.dataset.focusKey = `remove:${key}`;
        remove.setAttribute('aria-label', v.removeAria(who));
        remove.title = v.remove;
        remove.onclick = () => this.viewLinksRemove([link.hypo]);
        row.appendChild(remove);
        return row;
    },

    /**
     * A row's switch: off unlinks it (and what hangs on it, asked first when
     * something does); on shows it again by the rules of showing (a family
     * shown elsewhere moves here: said in the panel, with Undo).
     */
    async viewLinksToggleRow(hypo: string, on: boolean, sw?: HTMLElement): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const before = loadViewLinks(treeId);
        const link = before.find(l => l.hypo === hypo);
        if (!link) return;
        if (!on) {
            const dependents = viewLinkDependents(data, before, hypo, ctx);
            if (dependents.length > 0 && !(await this.confirmViewLinkChain(link, dependents, sw ?? null))) return;
            const change = unlinkViewLink(data, before, hypo, ctx);
            await TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, change.links));
            return;
        }
        const change = setViewLinkOn(data, before, hypo, true, Date.now(), ctx);
        await TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, change.links));
        if (change.removed.length > 0) {
            const surname = DataManager.getPerson(link.islandIds[0])?.lastName?.trim() || null;
            const anchor = DataManager.getPerson(link.anchorId);
            this.showViewLinksPanelToast(strings.viewLinks.movedToast(surname, anchor ? shownName(anchor) : '?', link.hypo, link.variant), before);
        }
    },

    /**
     * Find: the place in the tree (src/ui/view-links-ui.ts viewLinkFind) — for
     * a link that is real now, the person and the people it linked. On a
     * phone the sheet closes so the tree can be seen.
     */
    async viewLinksFindRow(r: ResolvedViewLink): Promise<void> {
        if (sheet()) this.closeViewLinksPanel();
        await this.viewLinkFind(r.link, { exact: r.state === 'real' });
    },

    /**
     * × / "Remove invalid" / "Remove all": the rows go at once (no question);
     * the panel says what went, with Undo for 8 s (the list exactly as it was).
     */
    viewLinksRemove(hypos: readonly string[]): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || hypos.length === 0) return;
        const before = loadViewLinks(treeId);
        const change = removeViewLinks(DataManager.getData(), before, hypos);
        if (change.removed.length === 0) return;
        const v = strings.viewLinks;
        const text = change.removed.length === 1 ? v.removedToast(this.viewLinkWho(change.removed[0])) : v.removedToastN(change.removed.length);
        void TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, change.links)).then(() => {
            this.showViewLinksPanelToast(text, before);
            // The keyboard stays in the list: on the footer, else the close button.
            const panel = document.getElementById(PANEL_ID);
            if (panel && !panel.contains(document.activeElement)) {
                panel.querySelector<HTMLElement>('.view-links-panel__toast-undo')?.focus({ preventScroll: true });
            }
        });
    },

    /** The notice inside the list: what happened, Undo (the records exactly as `before`) for 8 s. */
    showViewLinksPanelToast(text: string, before: readonly ViewLink[]): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.querySelector('.view-links-panel__toast')?.remove();
        if (panelToastTimer) clearTimeout(panelToastTimer);
        const toast = el('div', 'view-links-panel__toast');
        toast.setAttribute('role', 'status');
        toast.appendChild(el('span', 'view-links-panel__toast-text', text));
        const undo = el('button', 'view-links-panel__toast-undo', strings.viewLinks.undo);
        undo.type = 'button';
        undo.dataset.focusKey = 'toast-undo';
        const hide = (): void => {
            if (panelToastTimer) clearTimeout(panelToastTimer);
            panelToastTimer = null;
            toast.remove();
        };
        undo.onclick = () => {
            hide();
            void this.viewLinkRestore(before).then(() => {
                document.querySelector<HTMLElement>(`#${PANEL_ID} .view-links-panel__close`)?.focus({ preventScroll: true });
            });
        };
        toast.appendChild(undo);
        panel.appendChild(toast);
        const later = (): void => {
            // Stays while the keyboard is on Undo.
            if (toast.contains(document.activeElement)) {
                toast.addEventListener('focusout', () => setTimeout(later, 0), { once: true });
                return;
            }
            hide();
        };
        panelToastTimer = setTimeout(later, PANEL_TOAST_MS);
    },

    // ==================== SETTINGS → TREE ====================

    /** Under "Research edge": "Linked in the view only · n · Open" (only where the list is offered). */
    renderViewLinksSettings(): void {
        const host = document.getElementById('view-links-settings');
        if (!host) return;
        const offered = this.viewLinksListOffered();
        host.hidden = !offered;
        host.replaceChildren();
        if (!offered) return;
        const v = strings.viewLinks;
        const row = el('div', 'settings-row view-links-settings-row');
        const text = el('span', 'settings-text');
        const name = el('span', 'settings-name', v.settingsRow(this.viewLinksShownCount()));
        name.id = 'view-links-settings-name';
        text.appendChild(name);
        const open = el('button', 'link-button view-links-settings-open', v.open);
        open.type = 'button';
        open.setAttribute('aria-describedby', name.id);
        open.onclick = () => {
            this.closeSettingsDialog();
            this.openViewLinksPanel(null);
        };
        row.append(text, open);
        host.appendChild(row);
    },

    // ==================== AFTER A LOAD OF THE RESEARCH ====================

    /**
     * A load of the research's version over the tree (`before`: the tree as it
     * was): records it made invalid are told about once in this page —
     * "2 view-only links are no longer valid · List". Queued behind the
     * load's own notice ("Restore the state before loading" first).
     */
    noteViewLinksAfterLoad(treeId: TreeId, before: StromData): void {
        if (DataManager.getCurrentTreeId() !== treeId || !this.viewLinksListOffered()) return;
        const fresh = newlyInvalidViewLinks(before, DataManager.getData(), loadViewLinks(treeId))
            .filter(r => !toldInvalid.has(`${treeId}|${r.link.hypo}|${r.link.variant}`));
        if (fresh.length === 0) return;
        for (const r of fresh) toldInvalid.add(`${treeId}|${r.link.hypo}|${r.link.variant}`);
        const v = strings.viewLinks;
        const tell = (): void => {
            if (DataManager.getCurrentTreeId() !== treeId) return;
            this.showToast(v.invalidAfterLoad(fresh.length), TOAST_MS, {
                kind: 'view-links-invalid',
                action: { label: v.list, run: () => this.openViewLinksPanel() },
            });
        };
        // After the notices on screen (each goes by itself, or another replaces it); at the latest in a minute.
        if (!document.querySelector('.toast')) {
            tell();
            return;
        }
        const until = Date.now() + 60_000;
        const watch = new MutationObserver(() => {
            if (document.querySelector('.toast') && Date.now() < until) return;
            watch.disconnect();
            tell();
        });
        watch.observe(document.body, { childList: true });
    },
});
