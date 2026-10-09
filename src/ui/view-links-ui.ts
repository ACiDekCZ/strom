/**
 * Linked in the view only: the actions on the tree's view links, shared by
 * every place that offers them — the edge's pinned bubble, the "+ family"
 * menu, the family's own button (here), and later the card's menu, "What
 * research knows" and the list. Show a variant (or another instead), unlink
 * one (asking first only when others hang on it), and undo either from the
 * notice. None of it is a change of the tree's data: only the tree's device
 * setting (src/view-links.ts) is written and the view drawn again — no undo
 * step, nothing to send, no new version.
 */

import { DataManager, auditPersonName } from '../data.js';
import { AuditLogManager } from '../audit-log.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { shownName } from '../person-name.js';
import {
    VIEW_LINK_VIEWS, ViewLink, ViewLinkCandidate, ViewLinkChoice, ViewLinkOffer, isViewLinksMaster, loadViewLinks, saveViewLinks,
    setViewLinksMaster, showViewLink, unlinkViewLink, viewLinkCandidates, viewLinkContext, viewLinkDependents, viewLinkIsland,
    viewLinkOffers,
} from '../view-links.js';
import { uiModule } from './module.js';
import type { PersonMenuAction } from './context-menu.js';

const MENU_ID = 'view-link-menu';
const CHAIN_ID = 'view-link-chain';
/** The notices stay 6 s (an action in them can be reached with Tab meanwhile). */
const TOAST_MS = 6000;

/** One row of a view link menu: what it does, a line under it. */
export interface ViewLinkMenuItem {
    label: string;
    hint?: string;
    /** A hook for tests and styles ("show", "unlink", "go"…). */
    action: string;
    run: () => void;
}

let menuCleanup: (() => void) | null = null;
let chainCleanup: ((ok: boolean) => void) | null = null;

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    return p ? shownName(p) : '?';
}

function clip(text: string, max = 70): string {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const touch = (): boolean => window.matchMedia?.('(pointer: coarse)').matches === true;

export const viewLinksUiMethods = uiModule({
    /** "parents of Václav Horák" / "partner of Rozálie Dvořáčková": whom a view link concerns, for its notices. */
    viewLinkWho(link: Pick<ViewLink, 'kind' | 'anchorId' | 'islandIds'>): string {
        const v = strings.viewLinks;
        const name = personName(link.anchorId);
        if (link.kind === 'partners') return v.whoPartner(name);
        return link.islandIds.length === 1 ? v.whoParent(name) : v.whoParents(name);
    },

    /** The variants of `hypo` as the actions offer them now (src/view-links.ts viewLinkOffers). */
    viewLinkOffersFor(hypo: string): ViewLinkOffer[] {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return [];
        return viewLinkOffers(DataManager.getData(), loadViewLinks(treeId), isViewLinksMaster(treeId), hypo);
    },

    /**
     * Show a variant linked in the view only (or instead of the version shown
     * now). The main switch goes on with it. `returnToTree`: from the family's
     * own view, back where the tree was (as ↩; else to the person it links
     * to). The view then shows both the person and the family; the notice
     * says what was shown (or that the family moved here from elsewhere) and
     * offers to unlink it (or to undo the move). `focusLabel`: the keyboard
     * lands on the new line's label.
     */
    async viewLinkShow(choice: ViewLinkChoice, opts: { returnToTree?: boolean; focusLabel?: boolean } = {}): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        this.closeViewLinkPopups();
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const before = loadViewLinks(treeId);
        const change = showViewLink(data, before, choice, Date.now(), ctx);
        const apply = (): void => {
            saveViewLinks(treeId, change.links);
            if (!isViewLinksMaster(treeId)) setViewLinksMaster(treeId, true);
        };
        if (opts.returnToTree) {
            apply();
            if (TreeRenderer.canGoBack()) await TreeRenderer.goBack();
            if (!TreeRenderer.isVisible(choice.anchorId)) await TreeRenderer.setFocus(choice.anchorId);
        } else {
            await TreeRenderer.refreshViewLinks(apply);
        }
        ZoomPan.fitPersons([choice.anchorId, ...viewLinkIsland(data, choice, ctx)].filter(id => TreeRenderer.isVisible(id)));
        if (opts.focusLabel) {
            document.querySelector<HTMLElement>(`.view-link-label[data-view-hypo="${CSS.escape(choice.hypo)}"]`)?.focus({ preventScroll: true });
        }
        const v = strings.viewLinks;
        if (change.removed.length > 0) {
            const surname = DataManager.getPerson(choice.islandIds[0])?.lastName?.trim() || null;
            this.showToast(v.movedToast(surname, personName(choice.anchorId), choice.hypo, choice.variant), TOAST_MS, {
                kind: 'view-link-moved',
                action: { label: v.undo, run: () => void this.viewLinkRestore(before) },
            });
        } else {
            this.showToast(v.shownToast(this.viewLinkWho(choice), choice.hypo, choice.variant), TOAST_MS, {
                kind: 'view-link-shown',
                action: { label: v.unlink, run: () => void this.viewLinkUnlink(choice.hypo) },
            });
        }
    },

    /**
     * Unlink (switch off) a shown variant. When others are chained to it (their
     * person stands in the family it shows), a small confirmation names them
     * first and they go off with it. The notice offers to undo. `near`: where
     * the confirmation opens; `restoreFocus`: the keyboard goes back to the
     * person's stub or "+ family" once drawn again. False: cancelled.
     */
    async viewLinkUnlink(hypo: string, opts: { near?: HTMLElement | null; restoreFocus?: boolean } = {}): Promise<boolean> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return false;
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const before = loadViewLinks(treeId);
        const link = before.find(l => l.hypo === hypo);
        if (!link) return false;
        const dependents = viewLinkDependents(data, before, hypo, ctx);
        this.closeViewLinkMenu();
        if (dependents.length > 0 && !(await this.confirmViewLinkChain(link, dependents, opts.near ?? null))) return false;
        const change = unlinkViewLink(data, before, hypo, ctx);
        this.hideResearchEdgeBubble();
        await TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, change.links));
        if (opts.restoreFocus) {
            const card = `.person-card[data-id="${CSS.escape(link.anchorId)}"]`;
            (document.querySelector<HTMLElement>(`${card} .research-edge`)
                ?? document.querySelector<HTMLElement>(`.edge-link-pill[data-edge-person="${CSS.escape(link.anchorId)}"]`)
                ?? document.querySelector<HTMLElement>(card))?.focus({ preventScroll: true });
        }
        const v = strings.viewLinks;
        this.showToast(v.unlinkedToast, TOAST_MS, {
            kind: 'view-link-unlinked',
            action: { label: v.undo, run: () => void this.viewLinkRestore(before) },
        });
        return true;
    },

    /** Put the records back exactly as they were (the notices' "Undo"). */
    async viewLinkRestore(links: readonly ViewLink[]): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        this.closeViewLinkPopups();
        await TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, links));
    },

    /**
     * "Unlink parents of Václav Horák?" / "Also unlinks 1 that builds on it
     * (parents of Tomáš Horák, H0030 A)." — Cancel · Unlink. Resolves true
     * for Unlink. Opens by `near` (else at the bottom of the window); Esc and
     * a click outside cancel; the keyboard stays inside.
     */
    confirmViewLinkChain(link: ViewLink, dependents: readonly ViewLink[], near: HTMLElement | null): Promise<boolean> {
        chainCleanup?.(false);
        const v = strings.viewLinks;
        const back = document.activeElement as HTMLElement | null;
        const pop = document.createElement('div');
        pop.id = CHAIN_ID;
        pop.className = 'view-link-chain';
        pop.setAttribute('role', 'alertdialog');
        pop.setAttribute('aria-labelledby', `${CHAIN_ID}-title`);
        pop.setAttribute('aria-describedby', `${CHAIN_ID}-body`);
        const list = dependents.map(d => `${this.viewLinkWho(d)}, ${d.hypo} ${d.variant}`).join('; ');
        pop.innerHTML = `
            <div class="view-link-chain__title" id="${CHAIN_ID}-title"></div>
            <div class="view-link-chain__body" id="${CHAIN_ID}-body"></div>
            <div class="view-link-chain__actions">
                <button type="button" class="secondary" data-do="cancel"></button>
                <button type="button" class="primary" data-do="unlink"></button>
            </div>`;
        pop.querySelector('.view-link-chain__title')!.textContent = v.chainTitle(this.viewLinkWho(link));
        pop.querySelector('.view-link-chain__body')!.textContent = v.chainBody(dependents.length, list);
        const cancel = pop.querySelector<HTMLButtonElement>('[data-do="cancel"]')!;
        const ok = pop.querySelector<HTMLButtonElement>('[data-do="unlink"]')!;
        cancel.textContent = strings.buttons.cancel;
        ok.textContent = v.unlink;
        document.body.appendChild(pop);
        const r = near?.isConnected ? near.getBoundingClientRect() : null;
        if (r && window.innerWidth > 640) {
            const left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2));
            const top = r.bottom + 8 + pop.offsetHeight <= window.innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - pop.offsetHeight - 8);
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(top)}px`;
        } else {
            pop.classList.add('view-link-chain--docked');
        }
        ok.focus();
        return new Promise<boolean>(resolve => {
            const onKey = (e: KeyboardEvent): void => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    done(false);
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    (document.activeElement === ok) !== e.shiftKey ? cancel.focus() : ok.focus();
                }
            };
            const onDown = (e: Event): void => {
                if (!pop.contains(e.target as Node)) done(false);
            };
            // Opened by a click (or a key): its press is over.
            document.addEventListener('pointerdown', onDown, true);
            document.addEventListener('keydown', onKey, true);
            const done = (yes: boolean): void => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onDown, true);
                pop.remove();
                chainCleanup = null;
                if (!yes && back?.isConnected) back.focus({ preventScroll: true });
                resolve(yes);
            };
            chainCleanup = done;
            cancel.onclick = () => done(false);
            ok.onclick = () => done(true);
        });
    },

    // ==================== THE CARD'S MENU AND DETAIL ====================

    /** The record a person's card stands for as a ghost in the current view (one of a shown family), or null. */
    viewLinkGhostOf(personId: PersonId): ViewLink | null {
        return TreeRenderer.getViewLayer()?.ghostOf.get(personId) ?? null;
    },

    /**
     * What the person menu (context menu and bottom sheet) offers of the view
     * links. `head`: a ghost's own block on top — its state (not an action),
     * "Unlink", "What research knows about the link" (phase 2 adds "Link for
     * real" under it; nothing is drawn for it now). `afterFocus`: right after
     * "Focus" — "Unlink the shown parents / partner" for a person whose
     * family is shown, "Show as linked" for a version that can be shown here
     * (one version: at once; more: a second level, a heading per hypothesis).
     * Nothing where the feature does not show; `afterFocus` only in the views
     * that draw the links.
     */
    personViewLinkMenu(personId: PersonId): { head: PersonMenuAction[]; afterFocus: PersonMenuAction[] } {
        const out: { head: PersonMenuAction[]; afterFocus: PersonMenuAction[] } = { head: [], afterFocus: [] };
        if (!TreeRenderer.viewLinksOffered() || !DataManager.getCurrentTreeId()) return out;
        const v = strings.viewLinks;
        const ghost = this.viewLinkGhostOf(personId);
        if (ghost) {
            out.head.push(
                { action: 'view-link-caption', label: v.caption(ghost.hypo, ghost.variant), caption: true, lead: true },
                { action: `view-link-unlink:${ghost.hypo}`, label: v.unlink, strong: true, lead: true },
                { action: `view-link-about:${ghost.hypo}`, label: v.aboutLink, lead: true },
                // Phase 2: "Link for real" (hypothesis.decide) comes here.
            );
        }
        if (!VIEW_LINK_VIEWS.includes(TreeRenderer.getViewMode())) return out;
        const shown = TreeRenderer.getViewLayer()?.links ?? [];
        for (const link of shown) {
            if (link.anchorId !== personId) continue;
            out.afterFocus.push({
                action: `view-link-unlink:${link.hypo}`, sheetTop: true,
                label: link.kind === 'partners' ? v.unlinkPartner : link.islandIds.length === 1 ? v.unlinkParent : v.unlinkParents,
            });
        }
        // A person of a family off the tree offers its links only while that family stands in the view (chained).
        if (DataManager.getPerson(personId)?.research?.island && !ghost) return out;
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const offers = viewLinkCandidates(data, ctx)
            .filter(c => c.anchorId === personId && c.state === 'draw' && !shown.some(l => l.hypo === c.hypo));
        if (offers.length === 1) {
            const c = offers[0];
            out.afterFocus.push({ action: `view-link-show:${c.hypo}:${c.variant}`, label: v.show, sheetTop: true });
        } else if (offers.length > 1) {
            const submenu = offers.map((c, i): PersonMenuAction => {
                const h = ctx.hypotheses.get(c.hypo);
                const title = h?.variants?.find(x => x.id === c.variant)?.title ?? '';
                const people = `+ ${viewLinkIsland(data, c, ctx).length}`;
                const first = i === 0 || offers[i - 1].hypo !== c.hypo;
                return {
                    action: `view-link-show:${c.hypo}:${c.variant}`, label: v.version(c.variant),
                    note: title ? `${clip(title, 40)} · ${people}` : people,
                    ...(first ? { header: h?.title ? `${c.hypo} · ${h.title}` : c.hypo, divider: i > 0 } : {}),
                };
            });
            out.afterFocus.push({ action: 'view-link-show-menu', label: v.showMenu, submenu, sheetTop: true });
        }
        return out;
    },

    /** Run a view link row of the person menu ("view-link-show:H0022:B", "view-link-unlink:H0022", "view-link-about:H0022"). */
    runViewLinkMenuAction(personId: PersonId, action: string): void {
        const [, what, hypo, variant] = /^view-link-(show|unlink|about):(H\d+)(?::([A-Z]+))?$/.exec(action) ?? [];
        if (!what || !hypo) return;
        if (what === 'unlink') {
            void this.viewLinkUnlink(hypo, { restoreFocus: true });
            return;
        }
        if (what === 'about') {
            const treeId = DataManager.getCurrentTreeId();
            const link = treeId ? loadViewLinks(treeId).find(l => l.hypo === hypo) : null;
            this.clearDialogStack();
            // The menu is gone: the card it was opened on gets the keyboard back when the dialog closes.
            if (!document.activeElement || document.activeElement === document.body) {
                document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(personId)}"]`)?.focus({ preventScroll: true });
            }
            this.showPersonResearchDialog(link?.anchorId ?? personId, { hypo: { id: hypo, ...(link ? { variant: link.variant } : {}) } });
            return;
        }
        const c = viewLinkCandidates(DataManager.getData()).find(x => x.hypo === hypo && x.variant === variant && x.state === 'draw');
        if (!c) return;
        const { kind, anchorId, islandIds } = c;
        void this.viewLinkShow({ hypo, variant: c.variant, kind, anchorId, islandIds }, { focusLabel: true });
    },

    /**
     * "Find": the place of a view link in the tree — the person it links to
     * and the family as far as the view shows it (only the person while the
     * main switch is off). From a view that never draws the links, the
     * Family view at the person. `exact`: only the person and the people
     * the link names (a link real now: its family is the whole tree).
     */
    async viewLinkFind(link: Pick<ViewLink, 'anchorId' | 'islandIds'>, opts: { exact?: boolean } = {}): Promise<void> {
        if (!VIEW_LINK_VIEWS.includes(TreeRenderer.getViewMode())) {
            TreeRenderer.presetViewMode('family');
            await TreeRenderer.setFocus(link.anchorId);
        } else {
            // The person out of the view, or the family shown but not reached from the focus: at the person.
            const shown = !!TreeRenderer.getViewLayer()?.ghostOf.has(link.islandIds[0]);
            if (!TreeRenderer.isVisible(link.anchorId) || (shown && !link.islandIds.some(id => TreeRenderer.isVisible(id)))) {
                await TreeRenderer.setFocus(link.anchorId);
            }
        }
        const people = opts.exact ? link.islandIds : viewLinkIsland(DataManager.getData(), link);
        ZoomPan.fitPersons([link.anchorId, ...people].filter(id => TreeRenderer.isVisible(id)));
    },

    /**
     * The person's detail: under the Family section (real links only), a
     * quiet row per link of the view that touches the person — "View only:
     * father Jakub Horák · H0022 B · Unlink" — and for a ghost its state
     * (the card's tooltip row, which a touch screen never shows). Empty when
     * nothing of the view touches the person.
     */
    personViewLinkRowsHtml(personId: PersonId): string {
        const layer = TreeRenderer.getViewLayer();
        if (!layer) return '';
        const v = strings.viewLinks;
        const e = (t: string): string => this.escapeHtml(t);
        const rows: string[] = [];
        const ghost = layer.ghostOf.get(personId);
        if (ghost) {
            rows.push(`<div class="pm-view-link-row pm-view-link-state"><span class="view-link-icon" aria-hidden="true"></span>${e(v.tooltip(ghost.hypo, ghost.variant))}</div>`);
        }
        const role = (id: PersonId, as: 'parent' | 'child' | 'partner'): string => {
            const g = DataManager.getPerson(id)?.gender;
            if (as === 'partner') return v.role.partner;
            if (as === 'parent') return g === 'male' ? v.role.father : g === 'female' ? v.role.mother : v.role.parent;
            return g === 'male' ? v.role.son : g === 'female' ? v.role.daughter : v.role.child;
        };
        for (const link of layer.links) {
            let text = '';
            if (link.anchorId === personId) {
                if (link.kind === 'partners') text = v.viewOnlyRow(v.role.partner, personName(link.islandIds[0]), link.hypo, link.variant);
                else if (link.islandIds.length === 1) text = v.viewOnlyRow(role(link.islandIds[0], 'parent'), personName(link.islandIds[0]), link.hypo, link.variant);
                else text = v.viewOnlyRow(v.role.parents, v.names(link.islandIds.map(personName)), link.hypo, link.variant);
            } else if (link.islandIds.includes(personId)) {
                text = v.viewOnlyRow(role(link.anchorId, link.kind === 'partners' ? 'partner' : 'child'), personName(link.anchorId), link.hypo, link.variant);
            }
            if (!text) continue;
            rows.push(`<div class="pm-view-link-row" data-view-hypo="${e(link.hypo)}"><span class="pm-view-link-text">${e(text)}</span>`
                + ` · <button type="button" class="link-button pm-view-link-unlink" data-view-hypo="${e(link.hypo)}">${e(v.unlink)}</button></div>`);
        }
        return rows.join('');
    },

    /** The note of the "Add" dialog for a person whose parents are shown in the view only (null: none). */
    viewLinkShownParents(personId: PersonId): ViewLink | null {
        return TreeRenderer.getViewLayer()?.links.find(l => l.kind === 'child' && l.anchorId === personId) ?? null;
    },

    /**
     * "Link the shown: Jakub Horák and Marie Pokorná" in the "Add parent"
     * dialog: the shown parents become the person's real parents — a change
     * of the tree like any link made by hand (one undo step, sent to the
     * research), after which the record is real.
     */
    linkShownParents(personId: PersonId): boolean {
        const link = this.viewLinkShownParents(personId);
        if (!link || DataManager.isReadOnly()) return false;
        const parents = link.islandIds.filter(id => this.canLinkRelation(personId, id, 'parent'));
        if (parents.length !== link.islandIds.length) {
            this.showLinkRefused();
            return false;
        }
        const person = DataManager.getPerson(personId);
        // Both parents first, then their family (a "?" for a missing one only after both are in).
        AuditLogManager.beginBatch();
        DataManager.runBatch(null, () => {
            for (const parentId of parents) DataManager.addParentChild(parentId, personId);
            if (parents.length === 2) {
                const union = DataManager.getPartnerships(parents[0]).find(u => u.person1Id === parents[1] || u.person2Id === parents[1])
                    ?? DataManager.createPartnership(parents[0], parents[1]);
                if (union) DataManager.addParentChild(parents[0], personId, union.id);
            }
            DataManager.ensureSingleParentFamilies();
        });
        AuditLogManager.endBatch(DataManager.getCurrentTreeId(), 'person.create',
            strings.auditLog.addedParent(strings.viewLinks.names(parents.map(id => auditPersonName(DataManager.getPerson(id)))), auditPersonName(person)));
        return true;
    },

    // ==================== MENUS ====================

    /**
     * A small menu by `anchor` (role menu: arrows, Home/End, Enter, Esc gives
     * the keyboard back to `anchor`; a click outside closes it). The same
     * anchor again closes it.
     */
    openViewLinkMenu(anchor: HTMLElement, items: readonly ViewLinkMenuItem[], label: string): void {
        const wasOpen = menuCleanup && anchor.getAttribute('aria-expanded') === 'true';
        this.closeViewLinkMenu();
        if (wasOpen) return;
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'context-menu view-link-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', label);
        for (const it of items) {
            const item = document.createElement('div');
            item.className = 'context-menu-item view-link-menu__item';
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.action = it.action;
            const name = document.createElement('span');
            name.className = 'view-link-menu__label';
            name.textContent = it.label;
            item.appendChild(name);
            if (it.hint) {
                const hint = document.createElement('span');
                hint.className = 'view-link-menu__hint';
                hint.textContent = it.hint;
                item.appendChild(hint);
            }
            const run = (): void => {
                this.closeViewLinkMenu();
                it.run();
            };
            item.onclick = (e) => { e.stopPropagation(); run(); };
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
            };
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');
        const rect = anchor.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left + rect.width / 2 - menu.offsetWidth / 2, window.innerWidth - menu.offsetWidth - 8));
        const above = rect.top - menu.offsetHeight - 6;
        const top = above >= 8 ? above : Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8);
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(Math.max(8, top))}px`;
        (menu.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
        const all = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('.view-link-menu__item')];
        const onKey = (e: KeyboardEvent): void => {
            const list = all();
            const i = list.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeViewLinkMenu();
                anchor.focus({ preventScroll: true });
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
            } else if (e.key === 'Tab') {
                this.closeViewLinkMenu();
            }
        };
        const onDown = (e: Event): void => {
            if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) this.closeViewLinkMenu();
        };
        document.addEventListener('keydown', onKey, true);
        // Opened by a click (or a key): its press is over.
        document.addEventListener('pointerdown', onDown, true);
        menuCleanup = () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            anchor.setAttribute('aria-expanded', 'false');
        };
    },

    closeViewLinkMenu(): void {
        menuCleanup?.();
        menuCleanup = null;
        document.getElementById(MENU_ID)?.remove();
    },

    /** Every popup of the view links: the menu, the confirmation, the edge's bubble. */
    closeViewLinkPopups(): void {
        this.closeViewLinkMenu();
        chainCleanup?.(false);
        this.hideResearchEdgeBubble();
    },

    /**
     * The "+ family" pill at the stub's end and the "possible link · H0001"
     * pill on the curve: where the view links are offered, a click (tap,
     * Enter) opens the menu — show the family linked (or unlink it) and go to
     * it; pointing at it shows the edge's bubble. Elsewhere "+ family" goes to
     * the family, the curve's pill is only a label.
     */
    bindEdgeLinkPill(personId: PersonId, pill: HTMLButtonElement, joinId: PersonId, hypo: string): void {
        const family = pill.classList.contains('edge-link-pill--family');
        if (!TreeRenderer.viewLinksOffered()) {
            if (family) pill.onclick = (e) => { e.stopPropagation(); void TreeRenderer.setFocus(joinId); };
            else {
                pill.tabIndex = -1;
                pill.classList.add('is-inert');
            }
            return;
        }
        pill.setAttribute('aria-haspopup', 'menu');
        pill.setAttribute('aria-expanded', 'false');
        pill.onclick = (e) => {
            e.stopPropagation();
            this.hideResearchEdgeBubble();
            this.openViewLinkFamilyMenu(pill, personId, joinId, hypo);
        };
        pill.addEventListener('mouseenter', () => {
            if (!touch() && !menuCleanup) this.showResearchEdgeBubble(personId, pill);
        });
        pill.addEventListener('mouseleave', () => this.hideResearchEdgeBubbleSoon());
    },

    /** The pill's menu: "Show as linked" per version (or "Unlink" while shown), then "Go to the family". */
    openViewLinkFamilyMenu(pill: HTMLElement, personId: PersonId, joinId: PersonId, hypo: string): void {
        const v = strings.viewLinks;
        const variants = DataManager.getPerson(personId)?.research?.edge?.hypos.find(h => h.id === hypo)?.variants;
        const offers = this.viewLinkOffersFor(hypo)
            .filter(o => o.choice?.anchorId === personId && (!variants?.length || variants.includes(o.variant)));
        const items: ViewLinkMenuItem[] = [];
        const shown = offers.find(o => o.shown);
        if (shown?.choice) {
            items.push({
                label: v.unlink, hint: `${hypo} ${shown.variant} · ${this.viewLinkWho(shown.choice)}`, action: 'unlink',
                run: () => void this.viewLinkUnlink(hypo, { near: pill, restoreFocus: true }),
            });
        } else {
            for (const o of offers) {
                if (o.state?.state !== 'draw' || !o.choice) continue;
                const choice = o.choice;
                items.push({
                    label: v.show, action: 'show',
                    hint: `${hypo} ${o.variant} · ${v.names(choice.islandIds.map(personName))}, ${v.people(o.people)}`,
                    run: () => void this.viewLinkShow(choice, { focusLabel: true }),
                });
            }
        }
        items.push({ label: v.goToFamily, hint: v.goBackHint, action: 'go', run: () => void TreeRenderer.setFocus(joinId) });
        this.openViewLinkMenu(pill, items, v.menuAria(personName(personId)));
    },

    /**
     * The family's own button ("Show linked to the tree"): one version shows
     * at once, several open a menu of them. Back in the tree, at the link.
     */
    showViewLinkFromIsland(btn: HTMLElement, offers: readonly ViewLinkCandidate[]): void {
        const pick = (c: ViewLinkCandidate): void => {
            const { hypo, variant, kind, anchorId, islandIds } = c;
            void this.viewLinkShow({ hypo, variant, kind, anchorId, islandIds }, { returnToTree: true, focusLabel: true });
        };
        if (offers.length === 1) {
            pick(offers[0]);
            return;
        }
        const v = strings.viewLinks;
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        const items = offers.map((c): ViewLinkMenuItem => {
            const title = ctx.hypotheses.get(c.hypo)?.variants?.find(x => x.id === c.variant)?.title ?? '';
            return {
                label: `${c.hypo} ${c.variant} · ${personName(c.anchorId)}`, action: 'show',
                hint: [title ? clip(title, 60) : '', v.people(viewLinkIsland(data, c, ctx).length)].filter(Boolean).join(' · '),
                run: () => pick(c),
            };
        });
        this.openViewLinkMenu(btn, items, v.versionsAria);
    },
});
