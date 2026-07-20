/**
 * Mobile bottom sheet: the touch counterpart of the desktop context menu.
 * A long-press on a card opens a sheet with the SAME actions (shared from
 * context-menu.ts — same action list + dispatch, different markup). Desktop
 * behaviour is untouched. See src/ui/module.ts for the composition pattern.
 */

import { PersonId } from '../types.js';
import { uiModule } from './module.js';
import { strings } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { TreeRenderer } from '../renderer.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';

/** A row / section in a menu-style bottom sheet (the "More" and "Tree" sheets). */
interface MenuRow { label: string; run: () => void; danger?: boolean; badge?: number; active?: boolean; }
/** The prominent "Strom: {name}" row that opens the second-level tree sheet
 *  (serif name + chevron + tinted background — mirrors the desktop submenu row). */
interface TreeRow { prefix: string; name: string; run: () => void; badge?: number; }
interface MenuBlock { header?: string; rows: MenuRow[]; pair?: MenuRow[]; treeRow?: TreeRow; }

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
     * The mobile "More" (Více) navigation sheet — the successor to the removed
     * hamburger menu. It MIRRORS the desktop ⋯ actions menu (index.html
     * #actions-menu-dropdown): a compact Undo/Redo pair on top, the "Current
     * view" section, then the prominent "Strom: {name}" row that opens the
     * second-level tree sheet (the counterpart of the desktop submenu), and
     * finally the global rows. Two mobile-only groups have no desktop actions-
     * menu equivalent because desktop reaches them elsewhere: the extra views
     * (Fan/Map — no bottom-bar tab) and Add family (no toolbar button on the
     * bar); they sit below the tree row so the important rows stay above the
     * fold. Opened from the bottom-bar "More" tab and the top bar's ⋯ button.
     * Gating mirrors the desktop menu (edit-only rows drop in read-only view).
     */
    showMoreMenuSheet(): void {
        this.hideBottomSheet();
        this.closeAllMenusExcept('sheet');

        const s = strings;
        const isView = document.body.classList.contains('view-mode');
        const mode = TreeRenderer.getViewMode();

        const blocks: MenuBlock[] = [];

        // 1) Undo / Redo — compact first group, like the top of the desktop menu
        //    (edit-only; the sheet is the mobile home for these beyond the toast).
        if (!isView) {
            blocks.push({ rows: [], pair: [
                { label: s.undo.undo, run: () => this.performUndo() },
                { label: s.undo.redo, run: () => this.performRedo() },
            ] });
        }

        // 2) Current view actions (mirrors the desktop "Current view" section).
        const current: MenuRow[] = [
            { label: s.menu.poster, run: () => this.showPosterDialog() },
            { label: s.menu.exportSelection, run: () => this.exportFocusedJSON() },
        ];
        if (!isView) {
            current.push({ label: s.menu.makeTree, run: () => this.makeTreeFromCurrentView() });
            current.push({ label: s.menu.mergeViewInto, run: () => this.mergeViewInto() });
        }
        current.push({ label: s.slideshow.menu, run: () => this.startSlideshow() });
        blocks.push({ header: s.menu.sectionCurrentView, rows: current });

        // 3) The prominent "Strom: {name}" row — every whole-tree action lives
        //    behind it (the mobile counterpart of the desktop submenu, incl. the
        //    anniversaries badge). Nothing to manage per-tree in read-only view.
        if (!isView) {
            const active = TreeManager.getActiveTreeMetadata();
            if (active) {
                blocks.push({ rows: [], treeRow: {
                    prefix: s.menu.treeActions,
                    name: active.name,
                    run: () => this.showTreeActionsSheet(),
                    // The dot rides the top row so a pending notice shows
                    // without opening the second level.
                    badge: this.anniversaryBadgeCount(),
                } });
            }
        }

        // 4) Extra views (Fan/Map) — no bottom-bar tab of their own.
        blocks.push({ header: s.menu.sectionView, rows: [
            { label: s.viewModeSwitch.fan, run: () => this.setDisplayViewMode('fan'), active: mode === 'fan' },
            { label: s.viewModeSwitch.map, run: () => this.setDisplayViewMode('map'), active: mode === 'map' },
        ] });

        // 5) Edits with no bottom-bar home (dropped in read-only view mode).
        if (!isView) {
            blocks.push({ header: s.menu.sectionEdits, rows: [
                { label: s.familyWizard.title, run: () => this.startFamilyWizardFromToolbar() },
            ] });
        }

        // 6) App / global rows.
        blocks.push({ header: s.menu.sectionApp, rows: [
            { label: s.settings.title, run: () => this.showSettingsDialog() },
        ] });

        this.presentMenuSheet(s.mobileMenu.more, blocks);
    },

    /**
     * The second-level "Strom: {name}" sheet (mobile counterpart of the desktop
     * ⋯ actions submenu): every whole-tree action, mirroring the desktop submenu
     * — all except Delete, which stays in the tree manager. Reuses the shared
     * menu-sheet chrome; gating (fsa / audit) matches the desktop rows.
     */
    showTreeActionsSheet(): void {
        const s = strings;
        const active = TreeManager.getActiveTreeMetadata();
        const id = TreeManager.getActiveTreeId();
        if (!active || !id || DataManager.isViewMode()) return;
        const isFsa = document.body.classList.contains('fsa-supported');

        const rows: MenuRow[] = [
            { label: s.treeManager.rename, run: () => this.showRenameTreeDialog(id) },
            { label: s.treeManager.duplicate, run: () => this.duplicateTree(id) },
            { label: s.treeManager.mergeInto, run: () => this.showMergeTreesDialog(id) },
            // WYSIWYG: the active tree IS the live view, so no person picker.
            { label: s.menu.splitFamilies, run: () => this.showSplitFamiliesDialog() },
            { label: s.treeManager.stats, run: () => this.showActiveTreeStats() },
            { label: s.book.menu, run: () => this.showBookDialog() },
            { label: s.menu.export, run: () => this.showExportDialog() },
        ];
        if (isFsa) rows.push({ label: s.fileAccess.saveToFile, run: () => this.attachSaveToFile() });
        rows.push({ label: s.anniversaries.menu, run: () => this.showAnniversariesDialog(), badge: this.anniversaryBadgeCount() });
        if (SettingsManager.isAuditLogEnabled()) rows.push({ label: s.auditLog.viewLog, run: () => this.showAuditLogDialog() });
        rows.push({ label: s.treeManager.hide, run: () => void this.toggleTreeVisibility(id) });
        rows.push({ label: s.treeManager.manageTreesTitle, run: () => this.showTreeManagerDialog() });

        this.presentMenuSheet(`${s.menu.treeActions} ${active.name}`, [
            { header: s.menu.sectionTree, rows },
        ]);
    },

    /**
     * Build and show a menu-style bottom sheet from section blocks: section
     * headers, flat action rows (no emoji), optional side-by-side "pair" row,
     * overlay + swipe-to-dismiss chrome. Shared by the "More" and "Tree" sheets.
     */
    presentMenuSheet(titleText: string, blocks: MenuBlock[]): void {
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
            btn.appendChild(label);
            if (row.badge && row.badge > 0) {
                const badge = document.createElement('span');
                badge.className = 'tree-switcher-badge';
                badge.textContent = String(row.badge);
                btn.appendChild(badge);
            }
            btn.addEventListener('click', () => {
                this.hideBottomSheet();
                row.run();
            });
            return btn;
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
            if (row.badge && row.badge > 0) {
                const badge = document.createElement('span');
                badge.className = 'tree-switcher-badge';
                badge.textContent = String(row.badge);
                btn.appendChild(badge);
            }
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

        for (const block of blocks) {
            if (block.header) {
                const header = document.createElement('div');
                header.className = 'bottom-sheet-section';
                header.textContent = block.header;
                list.appendChild(header);
            }
            for (const row of block.rows) list.appendChild(makeButton(row));
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
