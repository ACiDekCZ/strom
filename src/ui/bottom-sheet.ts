/**
 * Bottom sheet: the touch / bottom-navigation counterpart of the desktop
 * context menu. A tap (or long-press) on a card opens a sheet with the SAME
 * actions (shared from context-menu.ts — same action list + dispatch,
 * different markup). Desktop (> 1024px, fine pointer) keeps the floating menu. See src/ui/module.ts for the composition pattern.
 */

import { iconSvg } from '../icons.js';
import { PersonId, APP_VERSION } from '../types.js';
import { uiModule } from './module.js';
import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { TreeRenderer } from '../renderer.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import { ZoomPan } from '../zoom.js';
import { isPhoneBar } from '../breakpoints.js';
import { menuItemBody, menuItemAria, PersonMenuAction } from './context-menu.js';
import { shownName } from '../person-name.js';
import type { ResearchSheetGroup } from './research-actions-ui.js';
import { researchTrialTagHtml } from './research-tree-settings-ui.js';

/** A row / section in a menu-style bottom sheet (the "More" and "Tree" sheets). */
interface MenuRow {
    label: string; run: () => void; danger?: boolean; badge?: number; active?: boolean;
    /** Carries the "New" label (Strom Research menu item while it is new). */
    isNew?: boolean;
    /** Accessible name when it differs from the visible label. */
    ariaLabel?: string;
    /** A quiet second line under the label ("whole tree or current view"). */
    sub?: string;
    /** A quiet value at the row's end ("BETA · 3.9.0"). */
    value?: string;
    /** The count in the research's colour (Awaiting action). */
    warnBadge?: boolean;
    /** Starts an AI agent: the AI label. */
    ai?: boolean;
    /** Continues in the research: ↗. */
    ext?: boolean;
    /** A quiet line with a link under the row (the "Export all" reminder under Export…). */
    after?: { id: string; text: string; link: string; run: () => void };
}
/** The prominent "Strom: {name}" row that opens the second-level tree sheet
 *  (serif name + chevron + tinted background — mirrors the desktop submenu row). */
interface TreeRow { prefix: string; name: string; run: () => void; }
/** The "Only in browser" state row on top of the "More" sheet. */
interface StorageRow { title: string; sub: string; run: () => void; }
interface MenuBlock {
    header?: string; rows: MenuRow[]; pair?: MenuRow[]; treeRow?: TreeRow; divider?: boolean; storageRow?: StorageRow; note?: string;
    /** The research group (a narrow window with a mouse): title, state, frequent actions, "All research actions ›". */
    research?: ResearchSheetGroup;
}

/** Coarse pointer = touch device; used to gate touch-only behaviour. */
export function isCoarsePointer(): boolean {
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
const SWIPE_BACK_PX = 60;
/** The person sheet's tiles, in this order (each when the menu offers it). */
const TILE_ACTIONS = ['edit', 'focus', 'view', 'sources', 'story'];

export const bottomSheetMethods = uiModule({
    /**
     * Open the person action sheet (touch, and every viewport in the
     * bottom-navigation regime). Built from the shared action list: the
     * person's own four (edit, focus, sources, story) as tiles on top, the
     * "Add" grid, then the rows; a row with a second level ("Research ›",
     * "More ›") turns the sheet into that page (‹ Back returns).
     */
    showPersonBottomSheet(personId: PersonId): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const actions = this.getPersonMenuActions(personId);
        if (actions.length === 0) return;

        const person = DataManager.getPerson(personId);
        const personName = person ? shownName(person) : '';

        // The tiles: in this order, each when the menu offers it.
        const tiles = TILE_ACTIONS.map(t => actions.find(a => a.action === t)).filter((a): a is PersonMenuAction => !!a);
        const add = actions.find(a => a.chips);
        // Under the tiles: "Add" first, then the rows — those about the person
        // as one group, the last group ("Research ›", "More ›") on its own.
        // A ghost's own block above the tiles; "Show as linked" and its kin right under them (by "Focus").
        const lead = actions.map((a, index) => ({ a, index })).filter(({ a }) => a.lead);
        const top = actions.map((a, index) => ({ a, index })).filter(({ a }) => a.sheetTop);
        const rest = actions.map((a, index) => ({ a, index })).filter(({ a }) => !TILE_ACTIONS.includes(a.action) && !a.chips && !a.lead && !a.sheetTop);
        const lastGroup = rest.map(r => !!r.a.divider).lastIndexOf(true);
        rest.forEach((r, i) => { if (i < lastGroup || lastGroup === -1) r.a = { ...r.a, divider: i === 0 && !!add }; });

        const itemHtml = (a: PersonMenuAction, index: number): string => {
            const divider = a.divider ? '<div class="bottom-sheet-divider" role="separator"></div>' : '';
            const header = a.header ? `<div class="bottom-sheet-section" role="presentation">${esc(a.header)}</div>` : '';
            if (a.caption) {
                return `${divider}${header}<div class="bottom-sheet-caption" role="menuitem" aria-disabled="true"><span class="view-link-icon" aria-hidden="true"></span><span>${esc(a.label)}</span></div>`;
            }
            if (a.submenu) {
                return `${divider}${header}<button type="button" class="bottom-sheet-item sheet-submenu-row" role="menuitem" aria-haspopup="menu" data-submenu="${index}" data-menu="${esc(a.action)}"${menuItemAria(a)}>${menuItemBody(a)}</button>`;
            }
            // Keep the class out of the attribute (see context-menu.ts note).
            const cls = a.danger ? 'bottom-sheet-item danger' : a.strong ? 'bottom-sheet-item is-strong' : 'bottom-sheet-item';
            return `${divider}${header}<button type="button" class="${cls}" role="menuitem" data-action="${esc(a.action)}"${menuItemAria(a)}>${menuItemBody(a)}</button>`;
        };
        const tilesHtml = tiles.length === 0 ? '' : `<div class="sheet-tiles" style="--tiles: ${tiles.length}">`
            + tiles.map(t => `<button type="button" class="bottom-sheet-item sheet-tile" role="menuitem" data-action="${esc(t.action)}"${menuItemAria(t)}>`
                + `<span class="sheet-tile-label">${esc(t.label)}</span>`
                + (t.meta ? `<span class="sheet-tile-meta" aria-hidden="true">${esc(t.meta)}</span>` : '')
                + '</button>').join('')
            + '</div>';
        const addHtml = add?.chips ? `<div class="bottom-sheet-section" role="presentation">${esc(add.label)}</div>`
            + `<div class="menu-chip-grid sheet-chip-grid" role="group" aria-label="${esc(add.label)}">`
            + add.chips.map(ch => `<button type="button" class="bottom-sheet-item menu-chip" role="menuitem" data-action="${esc(ch.action)}"${menuItemAria(ch)}>${esc(ch.label)}</button>`).join('')
            + '</div>' : '';

        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        overlay.innerHTML = `
            <div class="bottom-sheet bottom-sheet-person" role="menu"${personName ? ` aria-label="${esc(personName)}"` : ''}>
                <div class="bottom-sheet-handle"></div>
                <div class="sheet-page sheet-page-root">
                    ${personName ? `<div class="bottom-sheet-menu-title">${esc(personName)}</div>` : ''}
                    <div class="bottom-sheet-items">
                        ${lead.length > 0 ? `<div class="sheet-view-link-head">${lead.map(r => itemHtml(r.a, r.index)).join('')}</div><div class="bottom-sheet-divider" role="separator"></div>` : ''}
                        ${this.personSignalsMenuHtml(personId, true, 'bottom-sheet-item')}
                        ${tilesHtml}
                        ${top.map(r => itemHtml({ ...r.a, divider: false }, r.index)).join('')}
                        ${addHtml}
                        ${rest.map(r => itemHtml(r.a, r.index)).join('')}
                    </div>
                </div>
                <div class="sheet-page sheet-page-sub" hidden></div>
            </div>
        `;

        // Tap outside (on the overlay backdrop) closes.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });

        const sheet = overlay.querySelector('.bottom-sheet') as HTMLElement;
        const root = sheet.querySelector('.sheet-page-root') as HTMLElement;
        const sub = sheet.querySelector('.sheet-page-sub') as HTMLElement;
        let openRow: HTMLElement | null = null;

        // One page replaces the other in place: the content slides in from
        // the side and the sheet's height follows smoothly (no jump).
        const switchPage = (show: HTMLElement, hide: HTMLElement, from: 1 | -1): void => {
            const before = sheet.offsetHeight;
            hide.hidden = true;
            show.hidden = false;
            const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduced || typeof sheet.animate !== 'function') return;
            const after = sheet.offsetHeight;
            const timing = { duration: 200, easing: 'ease' };
            sheet.animate([{ height: `${before}px` }, { height: `${after}px` }], timing);
            show.animate([{ transform: `translateX(${from * 100}%)` }, { transform: 'none' }], timing);
        };
        const openSubmenu = (row: HTMLElement): void => {
            const a = actions[Number(row.dataset.submenu)];
            if (!a?.submenu) return;
            openRow = row;
            sub.innerHTML = `<div class="sheet-subhead">`
                + `<button type="button" class="sheet-back">‹ ${esc(strings.contextMenu.back)}</button>`
                + `<span class="sheet-subhead-title">${esc(a.label)}</span></div>`
                + `<div class="bottom-sheet-items">${a.submenu.map((x, i) => itemHtml(x, i)).join('')}</div>`;
            switchPage(sub, root, 1);
            sub.querySelector<HTMLElement>('.bottom-sheet-item')?.focus({ preventScroll: true });
        };
        const back = (): void => {
            if (sub.hidden) return;
            switchPage(root, sub, -1);
            openRow?.focus({ preventScroll: true });
        };

        sheet.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.sheet-back')) { back(); return; }
            const row = target.closest<HTMLElement>('[data-submenu]');
            if (row) { openSubmenu(row); return; }
            const item = target.closest<HTMLElement>('[data-action]');
            if (!item || !sheet.contains(item)) return;
            const action = item.dataset.action;
            this.hideBottomSheet();
            if (action) this.runPersonMenuAction(personId, action);
        });
        sheet.addEventListener('keydown', (e) => {
            // Esc / ← on the second page: back to the first (a second Esc closes).
            if ((e.key === 'Escape' || e.key === 'ArrowLeft') && !sub.hidden) {
                e.preventDefault();
                e.stopPropagation();
                back();
            }
        });

        // Swipe down to dismiss; on the second page a swipe right goes back.
        let dragStartX = 0;
        let dragStartY = 0;
        let dragging = false;
        sheet.addEventListener('touchstart', (e) => {
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });
        sheet.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - dragStartY;
            const dx = e.touches[0].clientX - dragStartX;
            if (dy > 0 && dy > Math.abs(dx)) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        sheet.addEventListener('touchend', (e) => {
            dragging = false;
            sheet.style.transition = '';
            const dy = e.changedTouches[0].clientY - dragStartY;
            const dx = e.changedTouches[0].clientX - dragStartX;
            if (dy > SWIPE_CLOSE_PX && dy > Math.abs(dx)) {
                this.hideBottomSheet();
                return;
            }
            sheet.style.transform = '';
            if (!sub.hidden && dx > SWIPE_BACK_PX && Math.abs(dy) < dx / 2) back();
        });

        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        // Trigger the slide-up animation.
        requestAnimationFrame(() => overlay.classList.add('active'));
    },

    /** The person panel's name: the person's sheet on a phone, centring elsewhere. */
    focusNameTap(): void {
        const id = TreeRenderer.getFocusPersonId();
        if (id && isPhoneBar()) this.showPersonBottomSheet(id);
        else ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Phone person panel: a ↑n / ↓n chip unfolds (or folds) the steppers' row;
     * a tap into the tree folds it too.
     */
    toggleFocusSteppers(open?: boolean): void {
        const next = open ?? !document.body.classList.contains('focus-steppers-open');
        document.body.classList.toggle('focus-steppers-open', next);
        document.querySelectorAll('.focus-chip').forEach(chip => chip.setAttribute('aria-expanded', String(next)));
        const tree = document.getElementById('tree-container');
        if (next && tree && !tree.dataset.foldsSteppers) {
            tree.dataset.foldsSteppers = '1';
            tree.addEventListener('pointerdown', () => {
                if (document.body.classList.contains('focus-steppers-open')) this.toggleFocusSteppers(false);
            });
        }
    },

    hideBottomSheet(): void {
        if (this.bottomSheet) {
            this.bottomSheet.remove();
            this.bottomSheet = null;
            this.exportReminderClosed();
            this.closeResearchTrialNote();
            // Focus back to what opened the sheet — unless the row's action
            // already put it somewhere (a dialog it opened).
            const trigger = this.bottomSheetTrigger;
            this.bottomSheetTrigger = null;
            requestAnimationFrame(() => {
                // Replaced by another sheet: that one hands the focus back later.
                if (this.bottomSheet) {
                    if (!this.bottomSheetTrigger) this.bottomSheetTrigger = trigger;
                    return;
                }
                if (trigger?.isConnected && (document.activeElement === document.body || !document.activeElement)) {
                    trigger.focus({ preventScroll: true });
                }
            });
        }
    },

    /** Remember the opener (once per sheet; a sheet replacing another keeps the first). */
    noteBottomSheetTrigger(): void {
        if (this.bottomSheet) return;
        const active = document.activeElement;
        this.bottomSheetTrigger = active instanceof HTMLElement && active !== document.body ? active : null;
    },

    /**
     * The mobile "More" (Více) navigation sheet — the successor to the removed
     * hamburger menu. It MIRRORS the desktop ⋯ actions menu (index.html
     * #actions-menu-dropdown), ordered by what the user wants to do: the
     * tree's content (book, sources, anniversaries), the outputs (one Export…,
     * poster, fly-through), then the "Strom: {name}" row that opens the
     * second-level tree sheet (the counterpart of the desktop submenu). Mobile
     * only: the Undo/Redo pair on top (desktop has it in the toolbar), the
     * extra views (Fan/Map — no bottom-bar tab) and Add family (no toolbar
     * button on the bar). Opened from the bottom-bar "More" tab and the top
     * bar's ⋯ button. Edit-only rows drop in read-only view.
     */
    showMoreMenuSheet(opts: { research?: boolean } = {}): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.closeAllMenusExcept('sheet');
        this.hideWhatsNewCard();

        const s = strings;
        // Read-only: an embedded file's view mode or locked local data.
        const isView = DataManager.isReadOnly();
        const mode = TreeRenderer.getViewMode();

        const blocks: MenuBlock[] = [];

        // 0) Edits only in the browser: the state first, one tap from the dialog.
        if (!isView && this.isUnsavedInBrowser()) {
            blocks.push({ rows: [], storageRow: {
                title: s.fileCopy.menuUnsaved,
                sub: s.fileCopy.moreRowSub,
                run: () => { void this.showStorageStatusDialog(); },
            } });
        }

        // The phone bar's state dot explained: a linked file to save into, offline.
        if (!isView && this.activeFileHandleName) {
            blocks.push({ rows: [{ label: s.fileAccess.save, sub: s.fileAccess.linkedTo(this.activeFileHandleName), run: () => void this.saveActiveTreeToFile() }] });
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            blocks.push({ rows: [], note: s.pwa.offline });
        }

        // The research group first (a research tree on a computer whose window has no room for the
        // Research button): its state, the frequent actions and the way to all of them.
        const researchGroup = this.researchSheetGroup();
        if (researchGroup) blocks.push({ rows: [], research: researchGroup });

        // 1) Undo / Redo — the mobile home for these beyond the toast.
        if (!isView) {
            blocks.push({ divider: !!researchGroup, rows: [], pair: [
                { label: s.undo.undo, run: () => this.performUndo() },
                { label: s.undo.redo, run: () => this.performRedo() },
            ] });
        }

        // 2) The tree's content (a manageable tree only, like the desktop menu).
        const active = isView ? null : TreeManager.getActiveTreeMetadata();
        if (active) {
            blocks.push({ divider: blocks.length > 0, rows: [
                { label: s.book.menu, run: () => this.showBookDialog() },
                ...(this.isSourcesMenuOffered() ? [{ label: s.sources.menu, run: () => this.showSourcesDialog() }] : []),
                { label: s.anniversaries.menu, run: () => this.showAnniversariesDialog(), badge: this.anniversaryBadgeCount() },
            ] });
        }

        // 3) Outputs: one Export… (whole tree or the current view, chosen in
        //    its dialog; a read-only view exports what it shows), poster, fly-through.
        //    Under Export…, now and then, "Export all" (not backed up; once a day at most).
        const lastExport = this.exportReminderLast();
        const reminder = lastExport === undefined ? undefined
            : { id: 'sheet-export-reminder', text: this.exportReminderText(lastExport), link: s.snapshots.exportAll, run: () => this.researchActionExportAll() };
        blocks.push({ divider: blocks.length > 0, rows: [
            active
                ? { label: s.menu.exportAll, sub: s.menu.exportAllSub, run: () => this.showExportDialog(), after: reminder }
                : { label: s.menu.exportAll, run: () => this.exportFocusedJSON(), after: reminder },
            { label: s.menu.poster, run: () => this.showPosterDialog() },
            { label: s.slideshow.menu, run: () => this.startSlideshow() },
        ] });

        // 4) Extra views (Fan/Map — no bottom-bar tab of their own), side by side.
        blocks.push({ divider: true, header: s.menu.sectionView, rows: [], pair: [
            { label: s.viewModeSwitch.fan, run: () => this.setDisplayViewMode('fan'), active: mode === 'fan' },
            { label: s.viewModeSwitch.map, run: () => this.setDisplayViewMode('map'), active: mode === 'map' },
        ] });

        // 5) Strom Research, then the "Strom: {name}" row — every whole-tree
        //    action lives behind it (never in read-only views).
        // ("AI ancestor research" only where the research group is not: it is this tree's research.)
        const research = researchGroup ? null : this.researchMenuSheetRow();
        const managed: MenuBlock = { divider: true, rows: research ? [research] : [] };
        if (active) {
            managed.treeRow = {
                prefix: s.menu.treeActions,
                name: active.name,
                run: () => this.showTreeActionsSheet(),
            };
        }
        if (managed.rows.length > 0 || managed.treeRow) blocks.push(managed);
        // The tree manager right under the tree row (its actions sheet no longer lists it).
        if (active) blocks.push({ rows: [{ label: s.treeManager.manageTreesTitle, run: () => this.showTreeManagerDialog() }] });

        // 6) Add family (no bottom-bar home; edit-only) and the settings.
        blocks.push({ divider: true, rows: [
            ...(isView ? [] : [{ label: s.familyWizard.menu, run: () => this.startFamilyWizardFromToolbar() }]),
            { label: s.settings.title, run: () => this.showSettingsDialog() },
            // The version here (the toolbar's BETA badge has no room on a phone).
            { label: s.about.title, run: () => this.showAboutDialog(),
                value: document.body.classList.contains('beta-build') ? s.about.betaValue(APP_VERSION) : APP_VERSION },
        ] });

        this.presentMenuSheet(s.mobileMenu.more, blocks, { research: opts.research });
        if (reminder) this.exportReminderOpened();
    },

    /** More → "Strom: {name}": the open tree's actions sheet (the shared list, tree-actions.ts). */
    showTreeActionsSheet(): void {
        const id = TreeManager.getActiveTreeId();
        if (!id || DataManager.isReadOnly()) return;
        void this.presentTreeActionsSheet(id, { source: 'more' });
    },

    /**
     * Build and show a menu-style bottom sheet from section blocks: section
     * headers, flat action rows (no emoji), optional side-by-side "pair" row,
     * overlay + swipe-to-dismiss chrome. Shared by the "More" and "Tree" sheets.
     */
    presentMenuSheet(titleText: string, blocks: MenuBlock[], opts: { research?: boolean } = {}): void {
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        const sheet = document.createElement('div');
        sheet.className = 'bottom-sheet bottom-sheet-menu';
        sheet.setAttribute('role', 'menu');

        const handle = document.createElement('div');
        handle.className = 'bottom-sheet-handle';
        sheet.appendChild(handle);

        const title = document.createElement('div');
        title.className = 'bottom-sheet-menu-title';
        title.textContent = titleText;
        sheet.appendChild(title);

        const list = document.createElement('div');
        list.className = 'bottom-sheet-items';
        sheet.appendChild(list);

        const makeButton = (row: MenuRow): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bottom-sheet-item' + (row.danger ? ' danger' : '') + (row.active ? ' active' : '');
            const label = document.createElement('span');
            label.className = 'bottom-sheet-label';
            label.textContent = row.label;
            if (row.sub) {
                const sub = document.createElement('span');
                sub.className = 'bottom-sheet-sub';
                sub.textContent = row.sub;
                label.appendChild(sub);
            }
            btn.appendChild(label);
            if (row.value) {
                const value = document.createElement('span');
                value.className = 'bottom-sheet-value';
                value.textContent = row.value;
                btn.appendChild(value);
            }
            if (row.badge && row.badge > 0) {
                const badge = document.createElement('span');
                badge.className = 'tree-switcher-badge';
                badge.textContent = String(row.badge);
                btn.appendChild(badge);
            }
            if (row.isNew) {
                const badge = document.createElement('span');
                badge.className = 'research-new-badge research-new-badge--sheet';
                badge.setAttribute('aria-hidden', 'true');
                badge.textContent = strings.research.newBadge;
                btn.appendChild(badge);
            }
            if (row.ai) {
                const ai = document.createElement('span');
                ai.className = 'research-ai-badge';
                ai.setAttribute('aria-hidden', 'true');
                ai.title = strings.research.aiCostHint;
                ai.textContent = strings.research.aiBadge;
                btn.appendChild(ai);
            }
            if (row.ext) {
                const ext = document.createElement('span');
                ext.className = 'research-item-ext';
                ext.setAttribute('aria-hidden', 'true');
                ext.textContent = '↗';
                btn.appendChild(ext);
            }
            if (row.warnBadge) btn.querySelector('.tree-switcher-badge')?.classList.add('research-count-badge');
            if (row.ariaLabel) btn.setAttribute('aria-label', row.ariaLabel);
            btn.setAttribute('role', 'menuitem');
            btn.addEventListener('click', () => {
                this.hideBottomSheet();
                row.run();
            });
            return btn;
        };
        /** The quiet line with its link under a row ("Export all"). */
        const makeAfter = (after: NonNullable<MenuRow['after']>): HTMLElement => {
            const line = document.createElement('div');
            line.className = 'export-reminder export-reminder--sheet';
            line.id = after.id;
            const text = document.createElement('span');
            text.className = 'export-reminder-text';
            text.textContent = after.text;
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'link-button export-reminder-link';
            link.setAttribute('role', 'menuitem');
            link.textContent = after.link;
            link.addEventListener('click', () => {
                this.hideBottomSheet();
                after.run();
            });
            line.append(text, link);
            return line;
        };

        const makeTreeButton = (row: TreeRow): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bottom-sheet-item bottom-sheet-tree-row';
            btn.setAttribute('aria-haspopup', 'true');
            const prefix = document.createElement('span');
            prefix.className = 'bottom-sheet-tree-prefix';
            prefix.textContent = row.prefix;
            const name = document.createElement('span');
            name.className = 'bottom-sheet-tree-name';
            name.textContent = row.name;
            btn.appendChild(prefix);
            btn.appendChild(name);
            const chevron = document.createElement('span');
            chevron.className = 'bottom-sheet-tree-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.textContent = '›'; // ›
            btn.appendChild(chevron);
            btn.addEventListener('click', () => {
                this.hideBottomSheet();
                row.run();
            });
            return btn;
        };

        const makeStorageButton = (row: StorageRow): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bottom-sheet-item bottom-sheet-storage-row';
            btn.insertAdjacentHTML('beforeend', iconSvg('alert-triangle', { size: 18 }));
            const text = document.createElement('span');
            text.className = 'bottom-sheet-storage-text';
            const title = document.createElement('span');
            title.className = 'bottom-sheet-storage-title';
            title.textContent = row.title;
            const sub = document.createElement('span');
            sub.className = 'bottom-sheet-storage-sub';
            sub.textContent = row.sub;
            text.append(title, sub);
            const chevron = document.createElement('span');
            chevron.className = 'bottom-sheet-storage-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.textContent = '\u203a';
            btn.append(text, chevron);
            btn.addEventListener('click', () => {
                this.hideBottomSheet();
                row.run();
            });
            return btn;
        };

        // The research page: the whole research menu in this same sheet (‹ back to the list).
        let researchPage: HTMLElement | null = null;
        let allRow: HTMLButtonElement | null = null;
        const showResearchPage = (): void => {
            if (!researchPage) return;
            title.hidden = true;
            list.hidden = true;
            researchPage.hidden = false;
            this.refreshResearchMenu();
            this.focusResearchMenuItem('first');
        };
        const hideResearchPage = (): void => {
            if (!researchPage || researchPage.hidden) return;
            this.closeResearchTrialNote();
            researchPage.hidden = true;
            title.hidden = false;
            list.hidden = false;
            const body = researchPage.querySelector<HTMLElement>('#research-sheet-menu');
            if (body) {
                body.innerHTML = '';
                body.dataset.html = '';
            }
            // Drawn in the toolbar's dropdown again (one place at a time).
            this.refreshResearchMenu();
            allRow?.focus({ preventScroll: true });
        };
        const appendResearchGroup = (group: ResearchSheetGroup): void => {
            const r = strings.research;
            const head = document.createElement('div');
            head.className = 'bottom-sheet-section research-sheet-heading';
            head.innerHTML = `<span>${esc(r.menuTitle)}</span>${researchTrialTagHtml(true)}`;
            list.appendChild(head);
            if (group.state) {
                const st = group.state;
                const line = document.createElement('div');
                line.className = `research-sheet-state is-${st.tone}`;
                line.id = 'research-sheet-state';
                const dot = document.createElement('span');
                dot.className = 'research-sheet-state-dot';
                dot.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.className = 'research-sheet-state-text';
                text.id = 'research-sheet-state-text';
                text.textContent = st.title;
                const act = document.createElement('button');
                act.type = 'button';
                act.className = st.action.asLink ? 'research-sync-link' : 'primary btn-sm research-sync-btn';
                act.setAttribute('role', 'menuitem');
                act.setAttribute('aria-describedby', 'research-sheet-state-text');
                act.textContent = st.action.label;
                act.addEventListener('click', () => {
                    this.hideBottomSheet();
                    st.action.run();
                });
                line.append(dot, text, act);
                list.appendChild(line);
            }
            for (const row of group.rows) {
                list.appendChild(makeButton({ label: row.label, run: row.run, badge: row.count, warnBadge: true, ai: row.ai, ext: row.ext, ariaLabel: row.ariaLabel }));
            }
            allRow = document.createElement('button');
            allRow.type = 'button';
            allRow.className = 'bottom-sheet-item research-sheet-all';
            allRow.id = 'research-sheet-all';
            allRow.setAttribute('role', 'menuitem');
            allRow.setAttribute('aria-haspopup', 'menu');
            const label = document.createElement('span');
            label.className = 'bottom-sheet-label';
            label.textContent = r.allActions;
            const chevron = document.createElement('span');
            chevron.className = 'bottom-sheet-tree-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            chevron.textContent = '›';
            allRow.append(label, chevron);
            allRow.addEventListener('click', showResearchPage);
            list.appendChild(allRow);

            researchPage = document.createElement('div');
            researchPage.className = 'sheet-page-research';
            researchPage.hidden = true;
            researchPage.innerHTML = '<div id="research-sheet-menu" class="research-menu-body research-sheet-body" role="menu" aria-labelledby="research-menu-title"></div>';
            researchPage.addEventListener('click', (e) => {
                const target = e.target as Element | null;
                if (target?.closest('.research-menu-back')) {
                    hideResearchPage();
                    return;
                }
                // An item done closes the sheet (unless it put another sheet in its place).
                const item = target?.closest('[role="menuitem"]');
                if (!item || item.matches('.research-trial-tag, [data-action="cancelLoad"], [data-action="conflicts"]')) return;
                if (this.bottomSheet === overlay) this.hideBottomSheet();
            });
            sheet.appendChild(researchPage);
        };

        for (const block of blocks) {
            if (block.storageRow) list.appendChild(makeStorageButton(block.storageRow));
            if (block.note) {
                const note = document.createElement('p');
                note.className = 'bottom-sheet-note';
                note.textContent = block.note;
                list.appendChild(note);
            }
            if (block.divider) {
                const divider = document.createElement('div');
                divider.className = 'bottom-sheet-divider';
                divider.setAttribute('role', 'separator');
                list.appendChild(divider);
            }
            if (block.header) {
                const header = document.createElement('div');
                header.className = 'bottom-sheet-section';
                header.textContent = block.header;
                list.appendChild(header);
            }
            if (block.research) appendResearchGroup(block.research);
            for (const row of block.rows) {
                list.appendChild(makeButton(row));
                if (row.after) list.appendChild(makeAfter(row.after));
            }
            if (block.treeRow) list.appendChild(makeTreeButton(block.treeRow));
            if (block.pair) {
                const pairRow = document.createElement('div');
                pairRow.className = 'bottom-sheet-pair';
                for (const row of block.pair) pairRow.appendChild(makeButton(row));
                list.appendChild(pairRow);
            }
        }

        overlay.appendChild(sheet);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });
        // Escape on the research page: back to the list, focus on "All research actions" (a second one closes).
        sheet.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && researchPage && !researchPage.hidden && !document.getElementById('research-trial-note')) {
                e.preventDefault();
                e.stopPropagation();
                hideResearchPage();
            }
        });

        // Swipe-down to dismiss (mirrors the person sheet).
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
        // Opened for the research (its state in the toolbar, a narrow window): straight on its page.
        if (opts.research) showResearchPage();
        requestAnimationFrame(() => overlay.classList.add('active'));
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
