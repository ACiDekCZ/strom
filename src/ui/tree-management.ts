/**
 * tree management UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { researchOpenMark, researchOpenSrHtml } from './research-open-mark.js';
import { DataManager, auditPersonName } from '../data.js';
import { runTreeSwitch, type TreeSwitchPlace, type TreeSwitchResult } from './tree-switch-busy.js';
import { activatedElement } from './busy.js';
import type { FollowSwitchFrom } from './research-follow-ui.js';
import { TreeManager } from '../tree-manager.js';
import { sharedImageTrees, treeImageIds } from '../snapshots.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import {
    Person,
    PersonId,
    PartnershipId,
    PartnershipStatus,
    Gender,
    RelationType,
    RelationContext,
    StromData,
    TreeId,
    LastFocusedMarker
} from '../types.js';
import { LAST_FOCUSED } from '../model-values.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatRelativeDateTime, formatTreeSize } from '../format.js';
import { pendingMergeHasTarget, pendingMergeSourceName, pendingMergeTreeId, treeOriginLine } from '../tree-row.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from '../ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { sourceRetractOffered } from '../source-retract.js';
import { dropLifelineChips } from '../lifeline-view.js';
import { HISTORY_PLACE_FEATURE } from '../research-link.js';
import { historyKindLocked, historyKindsShown, HISTORY_SCOPE_KINDS, type HistoryKinds } from '../history.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import type { TreeMetadata } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { fitFlyout } from './flyout.js';
import { uiModule } from './module.js';
import { treeActionsAsSheet, TreeActionRow } from './tree-actions.js';
import { isPhoneToolbar } from './search.js';

import { iconSvg } from '../icons.js';
import { shownNameOrEmpty } from '../person-name.js';
import { forgetTreeMaterials } from './materials-ui.js';
import { updateDefaultFocusButtons } from './default-focus.js';

/** Room (px) a row menu needs beside ⋯ to show a useful part of its rows. */
const TREE_MENU_MIN_ROOM = 240;

/** The flyouts of the desktop ⋯ menu (`actions-{which}-wrap/-row/-submenu`). */
export type ActionsSubmenu = 'family' | 'tree';
const ACTIONS_SUBMENUS: readonly ActionsSubmenu[] = ['family', 'tree'];

/** The tree's flyout never starts higher than this (px from the window's top: under the toolbar). */
const TREE_FLYOUT_TOP = 62;

/**
 * Focus the first item of a ⋯-menu flyout opened from the keyboard. The tree's
 * list is drawn when the menu opens (renderActionsTreeRows, async): until its
 * rows are there, try again each frame for a moment, as long as the flyout is
 * still open and the focus has not moved on from its row.
 */
function focusFirstFlyoutItem(subId: string, rowId: string): void {
    const sub = document.getElementById(subId);
    if (!sub) return;
    const tryFocus = (): boolean => {
        const first = Array.from(sub.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
            .find(el => el.getClientRects().length > 0);
        first?.focus();
        return !!first && document.activeElement === first;
    };
    if (tryFocus()) return;
    const until = performance.now() + 1000;
    const step = (): void => {
        if (!sub.parentElement?.classList.contains('submenu-open')) return;
        if (document.activeElement !== document.getElementById(rowId)) return;
        if (tryFocus() || performance.now() > until) return;
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** The tree whose card timeline default the dialog edits. */
let lifelineDefaultsTreeId: TreeId | null = null;

export const treeManagementMethods = uiModule({
    // ---- TREE SWITCHER ----
    /**
     * Initialize tree switcher
     */
    initTreeSwitcher(): void {
        this.updateTreeSwitcher();

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('tree-switcher-dropdown');
            const btn = document.querySelector('.tree-switcher-btn');
            if (dropdown?.classList.contains('active') &&
                !dropdown.contains(e.target as Node) &&
                !btn?.contains(e.target as Node)) {
                dropdown.classList.remove('active');
            }

            // Same outside-click behaviour for the desktop ⋯ actions menu. The research's state in the
            // toolbar (mark, pill) opens it too: its own click must not close it again.
            const actions = document.getElementById('actions-menu-dropdown');
            const actionsBtn = document.querySelector('.actions-menu-btn');
            const syncState = document.getElementById('research-sync-pill');
            if (actions?.classList.contains('active') &&
                !actions.contains(e.target as Node) &&
                !actionsBtn?.contains(e.target as Node) &&
                !syncState?.contains(e.target as Node)) {
                this.closeActionsMenu();
            }
            // The Research menu likewise (its button, the pill that opens it too).
            const researchWrap = document.getElementById('research-menu-wrap');
            if (this.isResearchMenuOpen() &&
                !researchWrap?.contains(e.target as Node) &&
                !syncState?.contains(e.target as Node)) {
                this.closeResearchMenu();
            }
        });

        // The "For the family ›" and "Tree ›" flyouts open on hover too (CSS):
        // fit them into the window under the pointer; one is open at a time.
        const flyouts = ACTIONS_SUBMENUS.map(which => ({
            wrap: `actions-${which}-wrap`, row: `actions-${which}-row`, sub: `actions-${which}-submenu`,
            open: () => this.openActionsSubmenu(which), close: () => this.closeActionsSubmenu(which),
        }));
        for (const f of flyouts) {
            // A flyout closed under the pointer stays hidden until the pointer leaves (.hover-off).
            document.getElementById(f.wrap)?.addEventListener('mouseleave', () => {
                document.getElementById(f.wrap)?.classList.remove('hover-off');
            });
            document.getElementById(f.wrap)?.addEventListener('mouseenter', () => {
                document.getElementById(f.wrap)?.classList.remove('hover-off');
                for (const other of flyouts) if (other !== f) other.close();
                this.positionActionsSubmenu(f.sub);
                requestAnimationFrame(() => this.positionActionsSubmenu(f.sub));
            });
            // Keyboard for a submenu row (menu 1020 D3): → / Enter / Space open it and
            // move focus to its first item; ← on the row closes it. ↓ / ↑ on the row stay
            // in the parent menu (keyboard-access.ts). Hover only opens, focus stays.
            // (Esc still bubbles to the global handler that closes the whole menu.)
            document.getElementById(f.row)?.addEventListener('keydown', (e) => {
                const ev = e as KeyboardEvent;
                if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
                if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    f.open();
                    // Opened from the keyboard: Escape goes back to its row (by the pointer, it closes the menu).
                    document.getElementById(f.wrap)?.setAttribute('data-kbd', '');
                    focusFirstFlyoutItem(f.sub, f.row);
                } else if (ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    f.close();
                }
            });
            // ← in the flyout: it closes, focus back on its row ("Change structure" takes ← first).
            document.getElementById(f.sub)?.addEventListener('keydown', (e) => {
                const ev = e as KeyboardEvent;
                if (ev.key !== 'ArrowLeft' || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
                ev.preventDefault();
                f.close();
                document.getElementById(f.row)?.focus();
            });
        }
    },

    /**
     * Update tree switcher display
     */
    updateTreeSwitcher(): void {
        // Keep the action-menu anniversaries signal in sync: this method is
        // already called wherever the count can change (tree switch, edits, ...).
        this.refreshActionMenuBadges();

        const nameEl = document.getElementById('current-tree-name');
        const dropdown = document.getElementById('tree-switcher-dropdown');

        // View mode: show embedded trees
        if (DataManager.isViewMode()) {
            const embeddedTrees = DataManager.getEmbeddedTrees();
            const currentName = DataManager.getCurrentEmbeddedTreeName();

            if (nameEl) {
                nameEl.textContent = currentName || '…';
            }

            if (dropdown) {
                let html = '';

                // Show embedded trees (only if more than one)
                if (embeddedTrees.length > 1) {
                    for (const tree of embeddedTrees) {
                        html += `
                            <div class="tree-switcher-item sel-opt ${tree.isActive ? 'active' : ''}" data-sel-form="row" role="menuitem" tabindex="0"
                                 data-embedded-tree-id="${this.escapeHtml(tree.id)}">
                                <span class="tree-item-check">${tree.isActive ? iconSvg('check') : ''}</span>
                                <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                            </div>
                        `;
                    }
                } else if (embeddedTrees.length === 1) {
                    // Single tree - just show it as active (no click handler needed)
                    html += `
                        <div class="tree-switcher-item sel-opt active" data-sel-form="row" role="menuitem" tabindex="0" aria-current="true">
                            <span class="tree-item-check">${iconSvg('check')}</span>
                            <span class="tree-item-name">${this.escapeHtml(embeddedTrees[0].name)}</span>
                        </div>
                    `;
                }

                // Divider and actions (hidden by CSS in view mode, but include for consistency)
                html += `
                    <div class="tree-switcher-divider"></div>
                    <div class="tree-switcher-action" role="menuitem" tabindex="0" onclick="window.Strom.UI.showTreeManagerDialog()">
                        ${strings.treeManager.manage}
                    </div>
                `;

                dropdown.innerHTML = html;
                // Embedded tree ids are keys of a shared HTML file's payload:
                // handlers via data attributes, never inline JS.
                dropdown.querySelectorAll<HTMLElement>('[data-embedded-tree-id]').forEach(item => {
                    item.addEventListener('click', () => { void this.switchEmbeddedTree(item.dataset.embeddedTreeId ?? ''); });
                });
            }
            return;
        }

        // Normal mode: show storage trees
        const activeTree = TreeManager.getActiveTreeMetadata();
        if (nameEl) {
            nameEl.textContent = activeTree?.name || '…';
        }
        // A merge not sent to the tree's research yet, quietly beside the switcher (spec 134 11b).
        this.listenForMergeHold();
        const holdEl = document.getElementById('tree-switcher-hold');
        if (holdEl) {
            holdEl.textContent = this.treeHoldText(activeTree);
            // Shortened with an ellipsis when the toolbar is tight: the whole text on hover.
            holdEl.title = holdEl.textContent;
            holdEl.hidden = !holdEl.textContent;
        }

        if (!dropdown) return;

        // Use getVisibleTrees() to exclude hidden trees from switcher
        const trees = TreeManager.getVisibleTrees();
        const activeId = TreeManager.getActiveTreeId();

        let html = '';

        // Tree list (only visible trees): ✓ in its own column, the name, the research marks (spec 011).
        for (const tree of trees) {
            const isActive = tree.id === activeId;
            const title = this.treeSwitcherTitle(tree);
            html += `
                <div class="tree-switcher-item sel-opt ${isActive ? 'active' : ''}" data-sel-form="row" role="menuitem" tabindex="0" data-tree-id="${tree.id}"
                     ${title ? `title="${this.escapeHtml(title)}"` : ''} onclick="window.Strom.UI.switchToTree('${tree.id}')">
                    <span class="tree-item-check">${isActive ? iconSvg('check') : ''}</span>
                    <span class="tree-item-name" title="${this.escapeHtml(title ? `${tree.name}\n${title}` : tree.name)}">${this.escapeHtml(tree.name)}</span>
                    ${this.treeSwitcherKindHtml(tree)}
                    ${this.treeHoldText(tree) ? `<span class="tree-item-hold">${this.escapeHtml(this.treeHoldText(tree))}</span>` : ''}
                    ${this.treeSwitcherMarksHtml(tree)}
                </div>
            `;
        }
        // The browser keeps the page from the research programs: said once, above Manage trees.
        if (this.otherResearchEnabled()) html += this.treeSwitcherBlockedHtml();
        dropdown.classList.toggle('with-research', this.treeSwitcherMarksShown());

        // The switcher is trees only: view/tree actions live in the ⋯ actions
        // menu (desktop) and the mobile "More" sheet (≤1024px). Import… makes a
        // new tree, so it belongs here, not with the open tree's actions.
        html += `
            <div class="tree-switcher-divider"></div>
            <div class="tree-switcher-action edit-only" id="tree-switcher-import" role="menuitem" tabindex="0" onclick="window.Strom.UI.treeSwitcherImport()">
                ${strings.treeSwitcher.import}
            </div>
            <div class="tree-switcher-action" role="menuitem" tabindex="0" onclick="window.Strom.UI.showTreeManagerDialog()">
                ${strings.treeManager.manage}
            </div>
        `;

        dropdown.innerHTML = html;
        this.refreshTreeSwitcherDot();
    },

    /**
     * Refresh the anniversaries signal on whichever action trigger is visible:
     * a dot on the desktop ⋯ button and the mobile bottom-bar "More" tab, plus
     * the count badge inside the desktop actions menu. The mobile "More" sheet
     * is built on demand, so its badge is rendered when the sheet opens. Driven
     * by updateTreeSwitcher(), called wherever the count can change.
     */
    refreshActionMenuBadges(): void {
        const count = this.anniversaryBadgeCount();
        // The dot goes out once the anniversaries were opened, until their list changes or a new day (T51).
        const annDot = count > 0 && this.anniversaryDotLit();
        // The Research button and menu (its own signal); the ⋯ dot is the anniversaries' only.
        const researchSignal = this.refreshResearchMenu();
        const dot = document.getElementById('actions-menu-dot');
        if (dot) dot.style.display = annDot ? 'block' : 'none';
        // The "More" tab carries both: there the research group sits in its sheet (a narrow window with a mouse).
        // Changes waiting for a research that is not running: their number on the tab, in place of the dot (audit 017 a-D6).
        const resting = this.researchRestingWaitingCount();
        const moreCount = document.getElementById('bottom-bar-more-count');
        if (moreCount) {
            moreCount.hidden = resting === 0;
            moreCount.textContent = resting > 99 ? '99+' : resting > 0 ? String(resting) : '';
            if (resting > 0) moreCount.title = `${strings.sync.stateBridgeDown} · ${strings.sync.waitingN(resting)}`;
            else moreCount.removeAttribute('title');
        }
        const moreDot = document.getElementById('bottom-bar-more-dot');
        if (moreDot) moreDot.style.display = resting === 0 && (annDot || researchSignal !== '') ? 'block' : 'none';
        this.renderActionsExportReminder();
        // Count badge on the Anniversaries row; its tooltip and the row's
        // spoken name say what the number counts (the next days, T33).
        const badge = document.getElementById('actions-ann-badge');
        if (badge) {
            badge.textContent = count > 0 ? String(count) : '';
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
            const hint = count > 0 ? this.anniversaryBadgeHint(count) : '';
            if (hint) badge.title = hint; else badge.removeAttribute('title');
            const row = document.getElementById('actions-ann-row');
            if (row) {
                if (hint) row.setAttribute('aria-label', `${strings.anniversaries.menu}: ${hint}`);
                else row.removeAttribute('aria-label');
            }
        }
        const sourcesRow = document.getElementById('actions-sources-row');
        if (sourcesRow) sourcesRow.style.display = this.isSourcesMenuOffered() ? '' : 'none';
        // Materials with their count: a tree without a research that lists them (spec 102 §1).
        const materialsRow = document.getElementById('actions-materials-row');
        if (materialsRow) {
            const on = this.isMaterialsMenuOffered();
            materialsRow.style.display = on ? '' : 'none';
            const n = on ? this.materialsAppCount() : 0;
            const val = document.getElementById('actions-materials-count');
            if (val) val.textContent = on ? n.toLocaleString(getCurrentLanguage()) : '';
            if (on) materialsRow.setAttribute('aria-label', `${strings.materials.menu} ${n.toLocaleString(getCurrentLanguage())}`);
            else materialsRow.removeAttribute('aria-label');
        }
        // Strom Research "New" label on its menu row.
        this.refreshResearchNewMarker();
        this.refreshUndoRedoToolbar();
    },

    /**
     * R3: refresh the desktop toolbar's visible Undo / Redo icon buttons — the
     * disabled state follows canUndo()/canRedo(), and the tooltip carries the
     * platform shortcut (plus the last change's description for Undo). Called on
     * every mutation / undo / redo, the same beats the toast uses.
     */
    refreshUndoRedoToolbar(): void {
        const undoBtn = document.getElementById('toolbar-undo-btn') as HTMLButtonElement | null;
        const redoBtn = document.getElementById('toolbar-redo-btn') as HTMLButtonElement | null;
        if (undoBtn) {
            const canUndo = DataManager.canUndo();
            undoBtn.disabled = !canUndo;
            const desc = canUndo ? DataManager.lastUndoDescription() : null;
            const base = `${strings.undo.undo} (${this.shortcutHint('undo')})`;
            const title = desc ? `${strings.actions.undoLabel(desc)} (${this.shortcutHint('undo')})` : base;
            undoBtn.title = title;
            undoBtn.setAttribute('aria-label', title);
        }
        if (redoBtn) {
            const canRedo = DataManager.canRedo();
            redoBtn.disabled = !canRedo;
            const title = `${strings.undo.redo} (${this.shortcutHint('redo')})`;
            redoBtn.title = title;
            redoBtn.setAttribute('aria-label', title);
        }
    },

    /** Tree switcher → Import…: close the switcher, open the import dialog. */
    treeSwitcherImport(): void {
        document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
        this.showImportDialog();
    },

    /** Toggle the desktop ⋯ actions menu (mirrors the tree switcher dropdown). */
    toggleActionsMenu(): void {
        const dropdown = document.getElementById('actions-menu-dropdown');
        if (dropdown?.classList.contains('active')) {
            this.closeActionsMenu();
            return;
        }
        this.closeAllMenusExcept('actions');
        this.hideWhatsNewCard();
        if (!dropdown) return;
        dropdown.classList.add('active');
        this.refreshActionMenuBadges();
        this.updateActionsTreeRow();
        this.closeActionsSubmenu();
        this.fillMenuShortcuts(dropdown);
        // Never an empty menu (menu 1020 §10): with nothing to offer, it stays shut.
        const offered = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]'))
            .some(el => !el.closest('.actions-submenu') && el.getClientRects().length > 0);
        if (!offered) {
            dropdown.classList.remove('active');
            return;
        }
        // "Export all" under Export…: this opening shows it (at most the first one of a day).
        if (this.renderActionsExportReminder()) this.exportReminderOpened();
    },

    /**
     * The shortcut chips (`<kbd data-shortcut>`) of a menu: the platform's
     * text, and the same keys for assistive technology (aria-keyshortcuts on
     * the row).
     */
    fillMenuShortcuts(root: ParentNode): void {
        for (const kbd of Array.from(root.querySelectorAll<HTMLElement>('kbd[data-shortcut]'))) {
            const action = kbd.dataset.shortcut as 'undo' | 'redo' | 'save';
            const { text, aria } = this.menuShortcut(action);
            kbd.textContent = text;
            kbd.closest('[role="menuitem"], button')?.setAttribute('aria-keyshortcuts', aria);
        }
    },

    /** A menu row's shortcut: shown text and its aria-keyshortcuts value. */
    menuShortcut(action: 'undo' | 'redo' | 'save'): { text: string; aria: string } {
        const mac = this.isMacPlatform();
        if (action === 'save') return mac ? { text: '⌘S', aria: 'Meta+S' } : { text: 'Ctrl+S', aria: 'Control+S' };
        if (action === 'undo') return mac ? { text: '⌘Z', aria: 'Meta+Z' } : { text: 'Ctrl+Z', aria: 'Control+Z' };
        return mac ? { text: '⇧⌘Z', aria: 'Meta+Shift+Z' } : { text: 'Ctrl+⇧+Z', aria: 'Control+Shift+Z' };
    },

    /**
     * Close the desktop ⋯ actions menu (and its "Tree:" submenu). The research
     * menu closes too: its items end by this call like the menu's own.
     */
    closeActionsMenu(): void {
        this.closeActionsSubmenu();
        this.closeResearchTrialNote();
        const dropdown = document.getElementById('actions-menu-dropdown');
        if (dropdown?.classList.contains('active')) this.exportReminderClosed();
        dropdown?.classList.remove('active');
        this.closeResearchMenu();
    },

    /** Fill the "Tree: {name}" row with the active tree's name; hide it when
     *  there is no manageable storage tree (e.g. an exported read-only view). */
    updateActionsTreeRow(): void {
        const wrap = document.getElementById('actions-tree-wrap');
        const nameEl = document.getElementById('actions-tree-name');
        if (!wrap || !nameEl) return;
        const active = DataManager.isViewMode() ? null : TreeManager.getActiveTreeMetadata();
        if (!active) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        nameEl.textContent = active.name;
        nameEl.title = active.name;
        // A long name is cut short in the row: its spoken name and tooltip carry all of it.
        const row = document.getElementById('actions-tree-row');
        if (row) {
            row.setAttribute('aria-label', `${strings.menu.treeActions} ${active.name}`);
            row.title = active.name;
        }
        void this.renderActionsTreeRows(active.id);
    },

    /**
     * The "Tree: {name} ›" flyout is the one list of tree actions
     * (treeActionGroups, menu 1020 §3), the same as the tree manager's ⋯ and
     * the More sheet, so they never drift apart. The previous rows stay until
     * the new ones are ready (no empty flash).
     */
    async renderActionsTreeRows(treeId: TreeId): Promise<void> {
        const host = document.getElementById('actions-tree-submenu');
        if (!host) return;
        const groups = await this.treeActionGroups(treeId, 'actions');
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        host.setAttribute('aria-label', `${strings.menu.treeActions} ${name}`);
        const nodes: HTMLElement[] = [];
        const rowItem = (row: TreeActionRow): HTMLElement => {
            const item = document.createElement('div');
            item.className = 'tree-switcher-action actions-tree-action'
                + (row.danger ? ' danger' : '') + (row.editOnly ? ' edit-only' : '');
            item.setAttribute('role', row.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
            item.tabIndex = 0;
            item.dataset.action = row.key;
            item.id = `actions-tree-${row.key}-row`;
            if (row.hint) item.title = row.hint;
            const label = document.createElement('span');
            label.className = 'actions-tree-action-label';
            label.textContent = row.label;
            item.appendChild(label);
            if (row.research) {
                label.insertAdjacentHTML('beforeend', researchOpenSrHtml());
                item.insertAdjacentHTML('beforeend', researchOpenMark({ sr: false }));
            }
            if (row.value !== undefined) {
                const value = document.createElement('span');
                value.className = 'actions-tree-value';
                value.textContent = row.value;
                item.appendChild(value);
            }
            if (row.value !== undefined) {
                const chevron = document.createElement('span');
                chevron.className = 'actions-tree-chevron';
                chevron.setAttribute('aria-hidden', 'true');
                chevron.textContent = '\u203a';
                item.appendChild(chevron);
            }
            if (row.checked !== undefined) {
                item.setAttribute('aria-checked', String(row.checked));
                // A switch as in the More sheet (menu 1020 §3, 3a): on or off at a glance.
                const toggle = document.createElement('span');
                toggle.className = 'tree-actions-switch actions-tree-switch';
                toggle.setAttribute('aria-hidden', 'true');
                item.appendChild(toggle);
                // Toggled in place: the menu stays open.
                item.addEventListener('click', () => {
                    row.run();
                    item.setAttribute('aria-checked', String(TreeManager.getDefaultTree() === treeId));
                });
            } else {
                item.addEventListener('click', () => {
                    this.closeActionsMenu();
                    row.run();
                });
            }
            return item;
        };
        groups.forEach((group, index) => {
            if (group.header) {
                const header = document.createElement('div');
                header.className = 'menu-section-header actions-tree-header';
                header.setAttribute('role', 'presentation');
                header.textContent = group.header;
                nodes.push(header);
            } else if (index > 0) {
                const divider = document.createElement('div');
                divider.className = 'tree-switcher-divider';
                divider.setAttribute('role', 'separator');
                nodes.push(divider);
            }
            nodes.push(...group.rows.map(rowItem));
        });
        // A row focused from the keyboard meanwhile (→ on "Tree:") keeps the focus on its new copy.
        const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement)
            ? document.activeElement.id : '';
        host.replaceChildren(...nodes);
        if (focused) document.getElementById(focused)?.focus();
        if (document.getElementById('actions-tree-wrap')?.classList.contains('submenu-open')) {
            this.positionActionsSubmenu('actions-tree-submenu');
        }
    },

    /**
     * A flyout of the ⋯ menu ("For the family ›", "Tree ›") opens on hover;
     * a click, Enter or → toggles it. Only one is open at a time.
     */
    toggleActionsSubmenu(which: ActionsSubmenu): void {
        const wrap = document.getElementById(`actions-${which}-wrap`);
        if (!wrap) return;
        if (wrap.classList.contains('submenu-open')) this.closeActionsSubmenu(which);
        else this.openActionsSubmenu(which);
    },

    openActionsSubmenu(which: ActionsSubmenu): void {
        const wrap = document.getElementById(`actions-${which}-wrap`);
        if (!wrap) return;
        for (const other of ACTIONS_SUBMENUS) if (other !== which) this.closeActionsSubmenu(other);
        wrap.classList.add('submenu-open');
        document.getElementById(`actions-${which}-row`)?.setAttribute('aria-expanded', 'true');
        this.positionActionsSubmenu(`actions-${which}-submenu`);
    },

    /**
     * Keep a ⋯-menu flyout inside the window. It starts level with its row,
     * so on a short window (or a zoomed page) it used to run off the bottom
     * with its last items unreachable: shift it up as far as needed, and let
     * it scroll when even the whole window height is not enough.
     */
    positionActionsSubmenu(id: string): void {
        const sub = document.getElementById(id);
        if (!sub) return;
        sub.style.top = '';
        const viewport = window.innerHeight;
        if (id === 'actions-tree-submenu') {
            // The tree's list (menu 1020 §3.2): level with its row, never over
            // the toolbar, ending 8px above the window's bottom; on a short
            // window (or with "Change structure" open) it scrolls inside.
            sub.style.maxHeight = `${Math.max(120, viewport - TREE_FLYOUT_TOP - 8)}px`;
            const wrap = sub.parentElement;
            const rect = sub.getBoundingClientRect();
            if (!wrap || rect.height === 0) return;
            const rowTop = wrap.getBoundingClientRect().top;
            const top = Math.max(TREE_FLYOUT_TOP, Math.min(rowTop - 6, viewport - rect.height - 8));
            sub.style.top = `${top - rowTop}px`;
            return;
        }
        sub.style.maxHeight = `${fitFlyout(0, 0, viewport).maxHeight}px`;
        const rect = sub.getBoundingClientRect();
        if (rect.height === 0 || getComputedStyle(sub).visibility === 'hidden') return;   // not shown (hover already left)
        const { shift } = fitFlyout(rect.top, rect.height, viewport);
        if (shift <= 0) return;
        const baseTop = parseFloat(getComputedStyle(sub).top) || 0;
        sub.style.top = `${baseTop - shift}px`;
    },

    /** Close one flyout of the ⋯ menu, or both. */
    closeActionsSubmenu(which?: ActionsSubmenu): void {
        for (const w of which ? [which] : ACTIONS_SUBMENUS) {
            const wrap = document.getElementById(`actions-${w}-wrap`);
            if (!wrap) continue;
            // Closed under the pointer, it must not stay open by hover.
            if (wrap.classList.contains('submenu-open') && wrap.matches(':hover')) wrap.classList.add('hover-off');
            wrap.classList.remove('submenu-open');
            wrap.removeAttribute('data-kbd');
            document.getElementById(`actions-${w}-row`)?.setAttribute('aria-expanded', 'false');
        }
    },

    // The "Tree:" submenu actions reuse the app's own functions (no duplicated
    // logic) against the ACTIVE tree, resolved at click time.
    treeActionSendToResearch(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) void this.researchSendTree(id);
    },

    /**
     * The source catalog is a research tool: offered when advanced fields are on,
     * or as soon as the tree has a source (imported or cited), so nobody is left
     * without a way to manage sources they already have.
     */
    isSourcesMenuOffered(): boolean {
        if (DataManager.isReadOnly()) return false;
        const any = Object.keys(DataManager.getData().sources ?? {}).length > 0;
        // A followed tree: read-only, with deleting through its research (spec 117 §1), when that is offered.
        if (DataManager.isTreeLocked()) return any && sourceRetractOffered() !== null;
        return SettingsManager.isAdvancedFields() || any;
    },
    treeActionSources(): void {
        this.closeActionsMenu();
        this.showSourcesDialog();
    },
    /** The Actions menu's Materials (a tree without a research that lists them; spec 102 §1). */
    isMaterialsMenuOffered(): boolean {
        return this.materialsWindowOn() && !this.materialsListOn();
    },
    /** ⋯ › Materials: the tree's own files (spec 102 §1). */
    treeActionMaterials(): void {
        this.closeActionsMenu();
        this.openMaterials();
    },
    /** ⋯ › Lists of people… (spec 084 §2). */
    treeActionLists(): void {
        this.closeActionsMenu();
        this.showPersonLists();
    },
    treeActionBook(): void {
        this.closeActionsMenu();
        this.showBookDialog();
    },
    /** For the family → Family pages (026 §9.6): right after the book. */
    treeActionPages(): void {
        this.closeActionsMenu();
        this.openFamilyPagesForFocus();
    },
    /** For the family → Pages for the whole tree (P3 §3.2): the whole tree's window at its introduction. */
    treeActionTreePages(): void {
        this.closeActionsMenu();
        this.openTreePages();
    },
    treeActionExport(): void {
        // The one export hub for the active tree (JSON / App / GEDCOM / CSV /
        // Poster / Book / Share); its switch picks the whole tree or the view.
        this.closeActionsMenu();
        this.showExportDialog();
    },
    treeActionAnniversaries(): void {
        this.closeActionsMenu();
        this.showAnniversariesDialog();
    },

    /**
     * Toggle tree switcher dropdown
     */
    toggleTreeSwitcher(): void {
        this.closeAllMenusExcept('switcher');
        // Phone: the tree list is a sheet from below (1.5).
        if (isPhoneToolbar() && !DataManager.isViewMode()) {
            this.showTreeSwitcherSheet();
            return;
        }
        const dropdown = document.getElementById('tree-switcher-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('active');
            if (dropdown.classList.contains('active')) {
                this.updateTreeSwitcher();
                // The other trees' research state: asked now unless fresh.
                this.kickOtherResearch();
            }
        }
    },

    /** The phone's tree list: the visible trees (the open one marked), then Manage trees ›. */
    showTreeSwitcherSheet(): void {
        const activeId = TreeManager.getActiveTreeId();
        const trees = TreeManager.getVisibleTrees();
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const o = strings.otherResearch;
        const blocked = this.otherResearchEnabled() ? {
            id: 'tree-sheet-research-blocked', text: o.blockedSwitcher, link: o.blockedHow,
            run: () => this.showOtherResearchAllowHow(), hidden: !this.researchMarksBlocked(),
        } : undefined;
        this.presentMenuSheet(strings.treeManager.switcherTitle, [
            { rows: trees.map(tree => {
                const marks = this.treeSheetMarks(tree);
                const sub = [this.treeKindLabel(tree), this.treeHoldText(tree)].filter(Boolean).join(' \u00b7 ');
                return {
                    label: tree.name,
                    ...(sub ? { sub } : {}),
                    active: tree.id === activeId,
                    treeId: tree.id,
                    extra: marks?.extra,
                    run: () => { if (tree.id !== activeId) void this.switchToTree(tree.id); },
                };
            }) },
            { divider: true, lead: blocked, rows: [
                ...(DataManager.isReadOnly() ? [] : [{ label: strings.treeSwitcher.import, id: 'tree-sheet-import', run: () => this.showImportDialog() }]),
                { label: strings.treeManager.manageTreesTitle, value: '\u203a', run: () => this.showTreeManagerDialog() },
            ] },
        ]);
        // The other trees' research state: asked now unless fresh.
        this.kickOtherResearch();
    },

    /**
     * Switch to a different tree. `follow` (default): a switch the user
     * makes — the open tree's changes go first (when they go by themselves)
     * and the switch waits, at most 15 s, in the one working state (waiting
     * buttons 2f, tree-switch-busy.ts: "Switching…" on `el` or the element of
     * the click, Cancel while the changes go, no switch after 15 s); following
     * of the tree left ends quietly; the tree opened is followed live when an
     * agent works there (spec 011). One such switch at a time.
     * `follow: false`: a switch inside a research step (it follows or asks
     * itself).
     */
    async switchToTree(treeId: string, opts: { follow?: boolean; el?: HTMLElement | null; place?: TreeSwitchPlace; retry?: () => void } = {}): Promise<TreeSwitchResult> {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        const el = opts.el !== undefined ? opts.el : activatedElement();
        dropdown?.classList.remove('active');
        if (opts.follow === false) {
            await this.switchToTreeNow(treeId, null);
            return 'switched';
        }
        // A row of the closed switcher: its button carries the state.
        const trigger = document.querySelector<HTMLElement>('.tree-switcher-btn');
        const place: TreeSwitchPlace = opts.place ?? (el?.closest('#tree-switcher-dropdown') && trigger ? { rowOf: trigger } : {});
        return runTreeSwitch(el, treeId, {
            before: (o) => this.researchFollowBeforeSwitch(treeId as TreeId, o),
            go: (from) => this.switchToTreeNow(treeId, from),
            retry: opts.retry ?? (() => { void this.switchToTree(treeId, { el: el?.isConnected ? el : null }); }),
        }, place);
    },

    /** The switch itself (after the open tree's changes went): the tree opened, drawn, its research followed. */
    async switchToTreeNow(treeId: string, from: FollowSwitchFrom | null): Promise<void> {
        if (await DataManager.switchTree(treeId as TreeId)) {
            // One following at a time: the tree left is editable again (quietly).
            if (from) this.researchFollowLeft(from.open);
            // Opened again: a question closed unanswered there is asked again.
            this.forgetResearchModeAskLater(treeId as TreeId);
            // The research state shown is this tree's at once (never the last tree's under a dialog, D of rc.34).
            this.refreshResearchSyncUi();
            this.updateTreeSwitcher();
            // Restore focus from per-tree session state (uses tree's defaultPersonId setting)
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();
            this.refreshSearch();

            // Center view on focused person
            ZoomPan.centerOnFocusWithContext();

            // Update URL with tree parameter (enables refresh persistence and bookmarking)
            this.updateUrlTreeParam(treeId);
            // An agent works there: followed live (after the switch, never holding it up).
            if (from) void this.researchFollowAfterSwitch(treeId as TreeId, from);
        }
    },

    /**
     * Update URL with tree slug parameter without page reload
     * Also clears search parameter as the person may not exist in the new tree
     */
    updateUrlTreeParam(treeId: string): void {
        const treeSlug = TreeManager.getTreeSlug(treeId as TreeId);

        const url = new URL(window.location.href);
        // No slug → drop the parameter; keeping the previous tree's value
        // made a reload open the WRONG tree (review S19).
        if (treeSlug) url.searchParams.set('tree', treeSlug);
        else url.searchParams.delete('tree');
        url.searchParams.delete('search');
        history.replaceState(null, '', url.toString());
    },

    /**
     * Switch to a different embedded tree (view mode only)
     */
    async switchEmbeddedTree(treeId: string): Promise<void> {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        dropdown?.classList.remove('active');

        if (DataManager.switchEmbeddedTree(treeId)) {
            this.updateTreeSwitcher();
            await TreeRenderer.renderAsync();
            this.refreshSearch();

            // Center view on first person
            ZoomPan.centerOnFocusWithContext();
        }
    },

    // ---- TREE MANAGER DIALOG ----
    /**
     * Show tree manager dialog
     */
    showTreeManagerDialog(): void {
        const modal = document.getElementById('tree-manager-modal');
        if (!modal) return;

        // Listen for merge session changes to refresh list
        const refreshHandler = () => this.updateTreeManagerList();
        window.addEventListener('strom:merge-session-changed', refreshHandler);

        // Clean up listener when modal closes
        const closeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'class' && !modal.classList.contains('active')) {
                    window.removeEventListener('strom:merge-session-changed', refreshHandler);
                    closeObserver.disconnect();
                }
            }
        });
        closeObserver.observe(modal, { attributes: true });

        // The menus it was opened from close under it (the tree switcher stayed open behind it).
        document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
        document.getElementById('actions-menu-dropdown')?.classList.remove('active');
        this.updateTreeManagerList();
        modal.classList.add('active');
    },

    /**
     * Close tree manager dialog
     */
    closeTreeManagerDialog(): void {
        document.getElementById('tree-manager-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /**
     * Update tree manager list
     */
    async updateTreeManagerList(): Promise<void> {
        const list = document.getElementById('tree-manager-list');
        if (!list) return;

        const activeId = TreeManager.getActiveTreeId();
        // Active tree first, then alphabetically — storage order means nothing
        // to the user and made long lists hard to scan.
        const trees = [...TreeManager.getTrees()].sort((a, b) => {
            if (a.id === activeId) return -1;
            if (b.id === activeId) return 1;
            return a.name.localeCompare(b.name);
        });

        // Search box: only worth the space once the list is long.
        const searchRow = document.getElementById('tree-manager-search-row');
        const searchInput = document.getElementById('tree-manager-search') as HTMLInputElement | null;
        const searchable = trees.length >= 6;
        if (searchRow) searchRow.style.display = searchable ? '' : 'none';
        const filter = (searchable ? (searchInput?.value ?? '') : '').trim().toLowerCase();
        const visibleTrees = filter ? trees.filter(t => t.name.toLowerCase().includes(filter)) : trees;

        const lang = getCurrentLanguage();
        const s = strings.treeManager;
        const st = strings.structure;
        const esc = (text: string) => this.escapeHtml(text);
        // Unfinished merges stand under the tree they merge into (spec 139 §9.1); those whose tree is gone, in a section of their own.
        const pendingMerges = await listMergeSessionsInfo();
        const underTree = new Map<string, typeof pendingMerges>();
        const orphans: typeof pendingMerges = [];
        for (const session of pendingMerges) {
            const target = pendingMergeTreeId(session, trees);
            if (target) underTree.set(target, [...(underTree.get(target) ?? []), session]);
            else orphans.push(session);
        }
        const mergeName = (session: (typeof pendingMerges)[number]) => pendingMergeSourceName(session, strings.merge.pendingMergeLabel);
        const mergeFacts = (session: (typeof pendingMerges)[number]) => [
            // The guide's step 2 "to decide" (134 S-P2), then how far it got.
            ...((session.stats.pending ?? 0) > 0 ? [strings.mergeWizard.subPending(session.stats.pending ?? 0)] : []),
            strings.merge.reviewedCount(session.stats.reviewed, session.stats.total),
            ...(session.stats.conflicts > 0 ? [strings.merge.pendingMergeConflicts(session.stats.conflicts)] : []),
            st.savedAt(formatRelativeDateTime(new Date(session.savedAt).getTime(), lang)),
        ];
        const mergeLinks = (session: (typeof pendingMerges)[number], resume: boolean) => `
            <span class="tree-manager-pending-actions">
                ${resume ? `<button type="button" class="link-button edit-only pending-merge-resume" data-session-id="${esc(session.id)}">${esc(strings.merge.resume)}</button>` : ''}
                ${resume ? `<button type="button" class="link-button edit-only pending-merge-rename" data-session-id="${esc(session.id)}" data-merge-name="${esc(mergeName(session))}">${esc(s.rename)}</button>` : ''}
                <button type="button" class="link-button danger edit-only pending-merge-discard" data-session-id="${esc(session.id)}" data-merge-name="${esc(mergeName(session))}">${esc(strings.merge.discard)}</button>
            </span>`;

        let html = '';
        for (const tree of visibleTrees) {
            const isActive = tree.id === activeId;
            // Change structure… where the tree can be written (the dialog itself says what a followed tree cannot do).
            const canStructure = !tree.isLocked && !TreeManager.isTreeNewer(tree.id);
            // Status as text chips; the open tree's row also has the selection's fill and line (Linka).
            const badges =
                (isActive ? `<span class="tree-badge active-badge">${esc(s.opened)}</span>` : '') +
                (tree.isLocked ? `<span class="tree-badge">${esc(s.lockedBadge)}</span>` : '') +
                (tree.isHidden ? `<span class="tree-badge">${esc(s.hiddenBadge)}</span>` : '');
            // Every tree the same facts, all from the tree index (spec 139 §7.2): no tree's data is read here.
            const edited = Date.parse(tree.lastModifiedAt);
            const stats = [
                esc(s.persons(tree.personCount)),
                esc(st.couples(tree.partnershipCount)),
                `<span class="tree-manager-item-size">${esc(formatTreeSize(tree.sizeBytes, lang))}</span>`,
                ...(Number.isFinite(edited) ? [esc(strings.treeActions.edited(formatRelativeDateTime(edited, lang)))] : []),
            ].join(' · ');
            const pending = (underTree.get(tree.id) ?? []).map(session => `
                <div class="tree-manager-item-pending" data-session-id="${esc(session.id)}">
                    <span class="tree-manager-item-indicator pending" aria-hidden="true"></span>
                    <span class="tree-manager-pending-text">${esc([st.pendingRow(mergeName(session), tree.name), ...mergeFacts(session)].join(' · '))}</span>
                    ${mergeLinks(session, true)}
                </div>`).join('');

            html += `
                <div class="tree-manager-item sel-opt ${isActive ? 'active' : ''} ${tree.isHidden ? 'hidden-tree' : ''}" data-sel-form="row" data-tree-id="${tree.id}">
                    <div class="tree-manager-item-info">
                        <div class="tree-manager-item-header">
                            <span class="tree-manager-item-name clickable" title="${esc(tree.name)}" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${esc(tree.name)}</span>
                            ${badges}
                        </div>
                        <div class="tree-manager-item-stats-row">${stats}</div>
                        ${this.treeManagerOriginHtml(tree)}
                        ${this.treeManagerHoldHtml(tree)}
                    </div>
                    <div class="tree-manager-item-actions">
                        ${isActive ? '' : `<button type="button" class="tree-open-btn" data-tree-id="${tree.id}" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${esc(s.open)}</button>`}
                        ${canStructure ? `<button type="button" class="tree-row-action edit-only" data-row-action="structure" data-action="structure" data-tree-id="${tree.id}">${esc(st.menuItem)}</button>` : ''}
                        <button type="button" class="tree-row-action" data-row-action="export" data-action="export" data-tree-id="${tree.id}">${esc(s.export)}</button>
                        <div class="tree-row-menu-wrap">
                            <button type="button" class="tree-row-menu-btn" data-tree-id="${tree.id}" data-tip="${esc(s.moreActions)}" aria-label="${esc(s.moreActions)}" aria-haspopup="menu">⋯</button>
                            <div class="tree-row-menu" role="menu"></div>
                        </div>
                    </div>
                    ${pending}
                </div>
            `;
        }

        if (filter && visibleTrees.length === 0) {
            html += `<p class="tree-manager-empty">${strings.merge.noItems}</p>`;
        }

        // Merges whose target tree is gone (or never named): their own section, Discard only when there is nothing to continue into.
        if (orphans.length > 0) {
            html += `<div class="tree-manager-section">${esc(st.pendingOrphans)}</div>`;
        }
        for (const session of orphans) {
            const gone = pendingMergeHasTarget(session);
            const facts = [...(gone ? [st.targetGone] : []), ...mergeFacts(session)].join(' · ');
            html += `
                <div class="tree-manager-item pending-merge" data-session-id="${esc(session.id)}">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator pending" aria-hidden="true"></span>
                        <span class="tree-manager-item-name">${esc(mergeName(session))}</span>
                    </div>
                    <div class="tree-manager-item-stats">${esc(facts)}</div>
                    ${mergeLinks(session, !gone)}
                </div>
            `;
        }

        list.innerHTML = html || `<p class="tree-manager-empty">${strings.merge.noItems}</p>`;
        // "Research on" (spec 064): each research tree's switch, as its bridge last answered; asked again now.
        list.querySelectorAll<HTMLElement>('[data-research-live]').forEach(slot => this.fillResearchLiveSlot(slot));
        this.kickOtherResearch();
        // Merge names come from file/tree names: no inline JS (a quote in the
        // name would break out of the handler string).
        list.querySelectorAll<HTMLElement>('.pending-merge-resume').forEach(btn => {
            btn.addEventListener('click', () => { this.resumePendingMergeFromManager(btn.dataset.sessionId ?? ''); });
        });
        list.querySelectorAll<HTMLElement>('.pending-merge-rename').forEach(btn => {
            btn.addEventListener('click', () => { void this.renamePendingMergeFromManager(btn.dataset.sessionId ?? '', btn.dataset.mergeName ?? ''); });
        });
        list.querySelectorAll<HTMLElement>('.pending-merge-discard').forEach(btn => {
            btn.addEventListener('click', () => { void this.discardPendingMergeFromManager(btn.dataset.sessionId ?? '', btn.dataset.mergeName ?? ''); });
        });
        this.wireTreeRowMenus(list);
        void this.markSharedImageTrees(list, trees.map(t => t.id));
    },

    /**
     * A tree row's third line (spec 139 §7.2): its origin and research, never
     * empty ("no research" at least), then the research's switch (its owner,
     * on a computer with the bridge: fillResearchLiveSlot) and the link to its
     * merge history. Read from the tree index only.
     */
    treeManagerOriginHtml(tree: TreeMetadata): string {
        const origin = treeOriginLine(tree, {
            owner: TreeManager.canSendToResearch(tree.id),
            copyOrigin: TreeManager.researchCopyOrigin(tree.id),
        });
        const title = origin.researchId ? ` title="${this.escapeHtml(strings.structure.research(origin.researchId))}"` : '';
        const merges = tree.mergeCount ?? 0;
        return `
            <div class="tree-manager-item-origin" data-origin="${origin.kind}">
                <span class="tree-manager-item-origin-text"${title}>${this.escapeHtml(origin.text)}</span>
                ${origin.kind === 'research' ? this.researchLiveSlotHtml(tree.id) : ''}
                ${merges > 0 ? `<button type="button" class="link-button tree-manager-merge-history" data-row-action="mergeHistory" data-tree-id="${tree.id}">${this.escapeHtml(strings.structure.mergeHistory(merges))}</button>` : ''}
            </div>`;
    },

    /**
     * Trees sharing images with another (a copy, 134 S-P1): "images shared"
     * after their size. Read after the list is drawn, so the list never waits
     * for the trees' stored records.
     */
    async markSharedImageTrees(list: HTMLElement, ids: readonly TreeId[]): Promise<void> {
        const sharing = sharedImageTrees(new Map(await Promise.all(ids.map(async id => [id, await treeImageIds(id).catch(() => [])] as const))));
        const s = strings.treeManager;
        for (const id of sharing) {
            const size = list.querySelector<HTMLElement>(`.tree-manager-item[data-tree-id="${CSS.escape(id)}"] .tree-manager-item-size`);
            if (!size || size.dataset.shared) continue;
            size.dataset.shared = '1';
            size.title = s.imagesSharedTip;
            size.append(` · ${s.imagesShared}`);
        }
    },

    /** Per-row "⋯" menus: one open at a time, outside click closes. Wired once. */
    wireTreeRowMenus(list: HTMLElement): void {
        const closeAll = () =>
            list.querySelectorAll('.tree-row-menu.open').forEach(m => m.classList.remove('open'));

        if (!list.dataset.menuWired) {
            list.dataset.menuWired = '1';
            list.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                // The row's own buttons and links (spec 139 §8.1, §9.2): Change structure…, Export…, Merge history (n).
                const act = target.closest<HTMLElement>('[data-row-action]');
                if (act?.dataset.treeId) {
                    const id = act.dataset.treeId as TreeId;
                    closeAll();
                    if (act.dataset.rowAction === 'structure') void this.showStructureDialog(id, { source: 'manager', parent: 'tree-manager-modal' });
                    else if (act.dataset.rowAction === 'export') this.showExportDialogFromManager(id);
                    else if (act.dataset.rowAction === 'mergeHistory') void this.showMergeHistory(id, 'tree-manager-modal');
                    e.stopPropagation();
                    return;
                }
                const btn = target.closest('.tree-row-menu-btn') as HTMLElement | null;
                if (btn) {
                    const menu = btn.parentElement?.querySelector('.tree-row-menu') as HTMLElement | null;
                    const wasOpen = menu?.classList.contains('open');
                    closeAll();
                    if (btn.dataset.treeId && treeActionsAsSheet()) {
                        // Touch: the tree-actions sheet over the manager (no floating menu).
                        void this.presentTreeActionsSheet(btn.dataset.treeId as TreeId, { source: 'manager' });
                    } else if (menu && !wasOpen && btn.dataset.treeId) {
                        void this.openTreeRowMenu(btn, menu, btn.dataset.treeId as TreeId);
                    }
                    e.stopPropagation();
                    return;
                }
            });
            document.addEventListener('click', (e) => {
                if (!(e.target as HTMLElement).closest('.tree-row-menu-wrap')) closeAll();
            });
            // A fixed-position menu must not drift away from its button.
            window.addEventListener('resize', closeAll);
            // (A menu scrolled inside itself stays open.)
            document.addEventListener('scroll', (e) => {
                if (!(e.target instanceof Element && e.target.closest('.tree-row-menu'))) closeAll();
            }, true);
        }
    },

    /** Fill a row's ⋯ menu from the shared tree-action list, then show it by its button. */
    async openTreeRowMenu(btn: HTMLElement, menu: HTMLElement, treeId: TreeId): Promise<void> {
        // Change structure… and Export… are left out where the row shows them as buttons (spec 139 §8.2);
        // a narrow window that hides those buttons keeps them in the menu.
        const row = btn.closest('.tree-manager-item');
        const inRow = !!row?.querySelector<HTMLElement>('[data-row-action="export"]')?.offsetParent;
        const groups = await this.treeActionGroups(treeId, 'manager', { inRow });
        menu.replaceChildren();
        const rowItem = (row: TreeActionRow): HTMLButtonElement => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'tree-row-menu-item';
            item.dataset.action = row.key;
            if (row.danger) item.classList.add('danger');
            if (row.editOnly) item.classList.add('edit-only');
            if (row.hint) item.title = row.hint;
            const label = document.createElement('span');
            label.className = 'tree-row-menu-label';
            label.textContent = row.label;
            item.appendChild(label);
            if (row.research) {
                label.insertAdjacentHTML('beforeend', researchOpenSrHtml());
                item.insertAdjacentHTML('beforeend', researchOpenMark({ sr: false }));
            }
            if (row.checked !== undefined) {
                item.classList.add('tree-startup-toggle');
                item.setAttribute('role', 'menuitemcheckbox');
                item.setAttribute('aria-checked', String(row.checked));
                const check = document.createElement('span');
                check.className = 'tree-row-menu-check';
                check.setAttribute('aria-hidden', 'true');
                if (row.checked) check.innerHTML = iconSvg('check', { size: 14 });
                item.appendChild(check);
            } else {
                item.setAttribute('role', 'menuitem');
                if (row.value) {
                    const value = document.createElement('span');
                    value.className = 'tree-row-menu-value';
                    value.textContent = row.value;
                    item.appendChild(value);
                }
            }
            item.addEventListener('click', () => {
                menu.classList.remove('open');
                row.run();
            });
            return item;
        };
        groups.forEach((group, index) => {
            // A group of edit-only rows hides with them in read-only mode.
            const editOnly = group.rows.every(row => row.editOnly);
            if (group.header) {
                const header = document.createElement('div');
                header.className = 'tree-row-menu-group';
                header.setAttribute('role', 'presentation');
                header.textContent = group.header;
                if (editOnly) header.classList.add('edit-only');
                menu.appendChild(header);
            } else if (index > 0) {
                const divider = document.createElement('div');
                divider.className = 'tree-row-menu-divider';
                divider.setAttribute('role', 'separator');
                if (editOnly) divider.classList.add('edit-only');
                menu.appendChild(divider);
            }
            for (const row of group.rows) menu.appendChild(rowItem(row));
        });
        // A tree that is not open: say where the missing actions are.
        if (treeId !== TreeManager.getActiveTreeId()) {
            const note = document.createElement('div');
            note.className = 'tree-row-menu-note edit-only';
            note.textContent = strings.treeActions.moreWhenOpen;
            menu.appendChild(note);
        }
        const more = document.createElement('div');
        more.className = 'tree-row-menu-more';
        more.setAttribute('aria-hidden', 'true');
        more.innerHTML = iconSvg('chevron-down', { size: 16 });
        menu.appendChild(more);
        if (!menu.dataset.scrollWired) {
            menu.dataset.scrollWired = '1';
            menu.addEventListener('scroll', () => this.updateTreeRowMenuHint(menu), { passive: true });
        }
        menu.classList.add('open');
        this.positionTreeRowMenu(btn, menu);
        this.updateTreeRowMenuHint(menu);
    },

    /** The fade + chevron while more of the menu lies below; gone at its end. */
    updateTreeRowMenuHint(menu: HTMLElement): void {
        menu.classList.toggle('can-scroll', menu.scrollTop + menu.clientHeight < menu.scrollHeight - 2);
    },

    /**
     * Place a row menu (position: fixed) under its ⋯ button, right edges
     * aligned, 4px apart — above it when it does not fit below and there is
     * more room there, and never over the tree's name (or its badges), the
     * dialog's header nor past the window (it may run over the footer); max-height is the room left (8px
     * kept on each side) and the rest scrolls inside the menu. With less than
     * TREE_MENU_MIN_ROOM on both sides it takes the whole height.
     */
    positionTreeRowMenu(btn: HTMLElement, menu: HTMLElement): void {
        const r = btn.getBoundingClientRect();
        menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        menu.style.top = '0px';
        menu.style.maxHeight = '';
        const h = menu.offsetHeight;
        // The window is the room (the body's fade mask is off while a menu is
        // open and a scroll closes it), the dialog's header stays clear.
        const header = btn.closest('.modal')?.querySelector('.modal-header')?.getBoundingClientRect();
        // The name and its badges stop the menu only where they lie under it:
        // a short name leaves the room above free (the header row is full width).
        const menuLeft = window.innerWidth - parseFloat(menu.style.right) - menu.offsetWidth;
        let ceiling = Math.max(8, header ? header.bottom + 4 : 8);
        const head = btn.closest('.tree-manager-item')?.querySelector('.tree-manager-item-header');
        for (const el of Array.from(head?.children ?? []) as HTMLElement[]) {
            if (!el.offsetParent || el.classList.contains('tree-manager-item-indicator')) continue;
            const range = document.createRange();
            range.selectNodeContents(el);
            const text = range.getBoundingClientRect();
            const rect = text.width ? text : el.getBoundingClientRect();
            if (rect.right > menuLeft) ceiling = Math.max(ceiling, rect.bottom + 4);
        }
        const floor = window.innerHeight - 8;
        const roomBelow = floor - (r.bottom + 4);
        const roomAbove = (r.top - 4) - ceiling;
        const best = Math.max(roomBelow, roomAbove);
        if (h <= roomBelow || (h > roomAbove && roomBelow >= TREE_MENU_MIN_ROOM && roomBelow >= roomAbove)) {
            menu.style.top = `${r.bottom + 4}px`;
            if (h > roomBelow) menu.style.maxHeight = `${roomBelow}px`;
        } else if (h <= roomAbove || best >= TREE_MENU_MIN_ROOM) {
            const fit = Math.min(h, roomAbove);
            menu.style.top = `${r.top - 4 - fit}px`;
            if (h > roomAbove) menu.style.maxHeight = `${roomAbove}px`;
        } else {
            // Little room on either side: the whole height, over ⋯ if need be.
            const fit = Math.min(h, floor - ceiling);
            menu.style.top = `${Math.max(ceiling, floor - fit)}px`;
            if (h > fit) menu.style.maxHeight = `${fit}px`;
        }
    },

    /** Switch to a tree from the manager and close the dialog to show it. */
    async openTreeFromManager(treeId: string): Promise<void> {
        // The active tree is already open — its Open button simply shows it.
        // (Every row has the button; a missing one on the active row read as
        // an inconsistency, not as information.)
        if (treeId === TreeManager.getActiveTreeId()) {
            this.closeTreeManagerDialog();
            return;
        }
        // The dialog stays while the switch works (2f): "Switching…" on the row's Open, the open tree's
        // row says when its changes go first (Cancel beside Open), a switch that did not happen is said
        // in the row; it closes once the tree is open.
        const modal = document.getElementById('tree-manager-modal');
        const row = modal?.querySelector<HTMLElement>(`.tree-manager-item[data-tree-id="${CSS.escape(treeId)}"]`) ?? null;
        const btn = row?.querySelector<HTMLElement>('.tree-open-btn') ?? null;
        const openRow = modal?.querySelector<HTMLElement>('.tree-manager-item.active') ?? null;
        if (!modal?.classList.contains('active') || !row || !btn) {
            this.closeTreeManagerDialog();
            await this.switchToTree(treeId);
            return;
        }
        const place: TreeSwitchPlace = {
            sentenceIn: openRow?.querySelector<HTMLElement>('.tree-manager-item-stats-row') ? openRow : null,
            cancelAfter: btn,
            msgIn: row,
        };
        const r = await this.switchToTree(treeId, { el: btn, place, retry: () => { void this.openTreeFromManager(treeId); } });
        if (r === 'switched') this.closeTreeManagerDialog();
    },

    // ---- NEW TREE MENU ----
    /**
     * Show new tree menu dialog with options (Empty, JSON, GEDCOM, Focus)
     * @param showIntro If true, shows intro text for users coming from offline version
     */
    showNewTreeMenu(showIntro?: boolean): void {
        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('new-tree-menu-modal');

        // Show/hide intro text
        const introEl = document.getElementById('new-tree-menu-intro');
        if (introEl) {
            introEl.style.display = showIntro ? 'block' : 'none';
        }

        document.getElementById('new-tree-menu-modal')?.classList.add('active');
    },

    /**
     * Close new tree menu dialog
     */
    closeNewTreeMenu(): void {
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    // ---- CREATE TREE FROM FOCUS ----
    /**
     * Create a new tree from currently focused family data
     */
    createTreeFromFocus(): void {
        const focusedData = TreeRenderer.getFocusedData();
        if (!focusedData || Object.keys(focusedData.persons).length === 0) {
            this.showAlert(strings.treeManager.noFocusedData, 'warning');
            return;
        }

        // Close new-tree-menu visually, keep tree-manager in stack for proper ESC navigation
        this.closeDialogById('new-tree-menu-modal');
        this.dialogStack.pop(); // Remove new-tree-menu-modal, keep tree-manager
        this.showImportTreeDialog(focusedData, strings.treeManager.defaultTreeName, true, true);
    },

    // ---- NEW TREE DIALOG ----
    /**
     * Show new tree dialog
     */
    showNewTreeDialog(): void {
        const modal = document.getElementById('new-tree-modal');
        const input = document.getElementById('new-tree-name') as HTMLInputElement;
        if (!modal || !input) return;

        // Handle dialog stack - keep existing stack (tree-manager, new-tree-menu), just add new-tree-modal
        // Close new-tree-menu visually but keep in stack
        this.closeDialogById('new-tree-menu-modal');
        this.pushDialog('new-tree-modal');

        input.value = '';
        modal.classList.add('active');
        input.focus();

        // Handle Enter key
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.createNewTreeFromDialog();
            }
        };
    },

    /**
     * Close new tree dialog
     */
    closeNewTreeDialog(): void {
        document.getElementById('new-tree-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    /**
     * Create new tree from dialog
     */
    createNewTreeFromDialog(): void {
        const input = document.getElementById('new-tree-name') as HTMLInputElement;
        const name = input?.value.trim() || strings.treeManager.defaultTreeName;

        const newTreeId = DataManager.createNewTree(name);

        // Close dialogs and return to tree manager (skip new-tree-menu)
        this.closeDialogById('new-tree-modal');
        this.closeDialogById('new-tree-menu-modal');
        this.clearDialogStack();

        // Update and show tree manager with new tree
        this.updateTreeManagerList();
        this.showTreeManagerDialog();

        this.updateTreeSwitcher();
        TreeRenderer.render();
        this.refreshSearch();
        // Update URL to reflect new tree
        this.updateUrlTreeParam(newTreeId);
    },

    // ---- RENAME TREE DIALOG ----
    /**
     * Show rename tree dialog
     */
    showRenameTreeDialog(treeId: string, parentDialogId?: string): void {
        const modal = document.getElementById('rename-tree-modal');
        const input = document.getElementById('rename-tree-name') as HTMLInputElement;
        if (!modal || !input) return;

        this.renameTreeId = treeId as TreeId;
        const tree = TreeManager.getTreeMetadata(this.renameTreeId);
        input.value = tree?.name || '';

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('rename-tree-modal');

        modal.classList.add('active');
        input.focus();
        input.select();

        // Handle Enter key
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmRenameTree();
            }
        };
    },

    /**
     * Close rename tree dialog
     */
    closeRenameTreeDialog(): void {
        document.getElementById('rename-tree-modal')?.classList.remove('active');
        this.renameTreeId = null;
        this.returnToParentDialog();
    },

    /**
     * Confirm rename tree
     */
    confirmRenameTree(): void {
        if (!this.renameTreeId) return;

        const input = document.getElementById('rename-tree-name') as HTMLInputElement;
        const name = input?.value.trim();
        if (!name) return;

        const isActiveTree = TreeManager.getActiveTreeId() === this.renameTreeId;
        TreeManager.renameTree(this.renameTreeId, name);

        // Update URL if renamed tree is the active one
        if (isActiveTree) {
            this.updateUrlTreeParam(this.renameTreeId);
        }

        this.closeRenameTreeDialog();
        this.updateTreeManagerList();
        this.updateTreeSwitcher();
    },

    // ---- PERSON CARD TIMELINE: THE TREE'S DEFAULT (spec 020 K4.5) ----
    /** The tree's default of the card timeline's chips; the card changes it only for a while. */
    showLifelineDefaultsDialog(treeId: string, parentDialogId?: string): void {
        const modal = document.getElementById('lifeline-defaults-modal');
        const child = document.getElementById('lifeline-default-child') as HTMLInputElement | null;
        const history = document.getElementById('lifeline-default-history') as HTMLInputElement | null;
        if (!modal || !child || !history) return;
        lifelineDefaultsTreeId = treeId as TreeId;
        const d = SettingsManager.getLifelineDefaults(treeId);
        child.checked = d.childEvents;
        history.checked = d.history;
        const kinds = historyKindsShown(SettingsManager.getHistoryKinds(treeId), this.lifelineDefaultPlaceShown(treeId));
        for (const kind of HISTORY_SCOPE_KINDS) {
            const input = document.getElementById(`lifeline-default-kind-${kind}`) as HTMLInputElement | null;
            if (input) input.checked = kinds[kind];
        }
        this.renderLifelineDefaultKinds();
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('lifeline-defaults-modal');
        modal.classList.add('active');
        child.focus();
    },

    closeLifelineDefaultsDialog(): void {
        document.getElementById('lifeline-defaults-modal')?.classList.remove('active');
        lifelineDefaultsTreeId = null;
        this.returnToParentDialog();
    },

    /** Saved for the tree in this browser; a card's change of that tree gives way to it. */
    confirmLifelineDefaults(): void {
        const treeId = lifelineDefaultsTreeId;
        if (!treeId) return;
        const child = document.getElementById('lifeline-default-child') as HTMLInputElement | null;
        const history = document.getElementById('lifeline-default-history') as HTMLInputElement | null;
        SettingsManager.setLifelineDefaults(treeId, { childEvents: !!child?.checked, history: !!history?.checked });
        if (SettingsManager.isHistoryLayer()) SettingsManager.setTreeHistoryKinds(treeId, this.lifelineDefaultKinds());
        dropLifelineChips(treeId);
        this.closeLifelineDefaultsDialog();
        if (treeId === DataManager.getCurrentTreeId()) this.historyChanged();
    },

    /** The tree's research offers the history of a place (`history.place` in its last status). */
    lifelineDefaultPlaceShown(treeId: string): boolean {
        const rid = TreeManager.getTreeMetadata(treeId as TreeId)?.research?.id?.toLowerCase();
        return !!rid && (this.researchStatusOf(rid)?.features ?? []).includes(HISTORY_PLACE_FEATURE);
    },

    /** The kinds as the dialog has them ticked. */
    lifelineDefaultKinds(): HistoryKinds {
        const on = (kind: keyof HistoryKinds) => !!(document.getElementById(`lifeline-default-kind-${kind}`) as HTMLInputElement | null)?.checked;
        return { region: on('region'), place: on('place'), local: on('local') };
    },

    /**
     * K8.6: the kinds of history under "History" — only while history is on in
     * Settings; muted while the tree's "History" is off; the last one on stays
     * (as in Settings).
     */
    renderLifelineDefaultKinds(): void {
        const box = document.getElementById('lifeline-default-kinds');
        const history = document.getElementById('lifeline-default-history') as HTMLInputElement | null;
        const treeId = lifelineDefaultsTreeId;
        if (!box || !history || !treeId) return;
        box.hidden = !SettingsManager.isHistoryLayer();
        const placeShown = this.lifelineDefaultPlaceShown(treeId);
        const kinds = this.lifelineDefaultKinds();
        for (const kind of HISTORY_SCOPE_KINDS) {
            const row = box.querySelector<HTMLElement>(`[data-kind="${kind}"]`);
            const input = document.getElementById(`lifeline-default-kind-${kind}`) as HTMLInputElement | null;
            if (!row || !input) continue;
            row.hidden = kind === 'place' && !placeShown;
            const locked = history.checked && historyKindLocked(kinds, kind, placeShown);
            row.classList.toggle('is-muted', !history.checked);
            row.classList.toggle('is-locked', locked);
            if (!history.checked || locked) input.setAttribute('aria-disabled', 'true');
            else input.removeAttribute('aria-disabled');
        }
    },

    /** A kind's click in the tree's dialog: the last one on and all while "History" is off stay as they are. */
    lifelineDefaultKindClick(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        if (input.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
        }
        this.renderLifelineDefaultKinds();
    },

    // ---- DUPLICATE TREE ----
    /**
     * Copy of a whole tree: Change structure… on the copy's summary with its
     * name (the old naming dialog is gone, spec 139 §4).
     */
    duplicateTree(treeId: string, parentDialogId?: string): void {
        void this.showStructureDialog(treeId as TreeId, { parent: parentDialogId, step: 'copy' });
    },

    // ---- TREE VISIBILITY ----
    /**
     * Toggle tree visibility (hidden from switcher and cross-tree matching)
     */
    async toggleTreeVisibility(treeId: string): Promise<void> {
        const id = treeId as TreeId;
        const tree = TreeManager.getTrees().find(t => t.id === id);
        if (!tree) return;

        // Invariant: the active tree is never hidden. Hiding the active tree
        // switches to another visible one first; with no other visible tree
        // the action is refused with an explanation.
        const hiding = !tree.isHidden;
        if (hiding && TreeManager.getActiveTreeId() === id) {
            const other = TreeManager.getVisibleTrees().find(t => t.id !== id);
            if (!other) {
                this.showToast(strings.treeManager.cannotHideLastVisible);
                return;
            }
            TreeManager.toggleTreeVisibility(id);
            await this.switchToTree(other.id);
            this.updateTreeManagerList();
            return;
        }

        // Toggle visibility
        TreeManager.toggleTreeVisibility(id);

        // Refresh displays
        this.updateTreeManagerList();
        this.updateTreeSwitcher();

        // Invalidate cross-tree cache and re-render to update badges
        CrossTree.invalidateCache();
        TreeRenderer.render();
    },

    toggleTreeLock(treeId: string): void {
        const id = treeId as TreeId;
        TreeManager.toggleTreeLock(id);

        // Refresh displays
        this.updateTreeManagerList();
        TreeRenderer.render();
    },

    // ---- DELETE TREE ----
    /**
     * Confirm delete tree
     */
    async confirmDeleteTree(treeId: string, parentDialogId?: string): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        if (!tree) return;

        // Dialog stack: the confirmation returns to its parent (the tree manager) when there is one.
        this.clearDialogStack();
        if (parentDialogId) this.pushDialog(parentDialogId);

        const d = strings.danger;
        const confirmed = await this.showConfirm(d.deleteTreeMessage(tree.personCount), d.deleteTreeTitle(tree.name),
            { confirmLabel: d.deleteTree, variant: 'danger' });
        if (confirmed) {
            const wasActive = TreeManager.getActiveTreeId() === treeId;
            await TreeManager.deleteTree(treeId as TreeId);
            // The research's files stay in the research; only this browser's copy of their list goes.
            void forgetTreeMaterials(treeId);

            // If no trees left, create a new empty one
            if (!TreeManager.hasTrees()) {
                const newTreeId = DataManager.createNewTree(strings.treeManager.defaultTreeName);
                this.updateUrlTreeParam(newTreeId);
            } else if (wasActive) {
                // Reload data from the new active tree
                const newActiveId = TreeManager.getActiveTreeId()!;
                await DataManager.switchTree(newActiveId);
                // Update URL to reflect new active tree
                this.updateUrlTreeParam(newActiveId);
            }

            this.updateTreeManagerList();
            this.updateTreeSwitcher();
            TreeRenderer.render();
        }
        // If not confirmed, the parent dialog (if any) comes back (returnToParentDialog handles it)
    },

    // ---- DEFAULT PERSON DIALOG ----
    /**
     * Show default person dialog for a tree
     */
    async showDefaultPersonDialog(treeId: string, parentDialogId?: string): Promise<void> {
        const modal = document.getElementById('default-person-modal');
        if (!modal) return;

        this.defaultPersonTreeId = treeId as TreeId;

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('default-person-modal');

        // Get tree data
        const treeData = await TreeManager.getTreeData(this.defaultPersonTreeId);
        const currentSetting = treeData?.defaultPersonId;

        // Get first person name for display
        const persons = treeData ? Object.values(treeData.persons).filter(p => !p.isPlaceholder) : [];
        const firstPerson = persons[0];
        const firstPersonName = firstPerson ? shownNameOrEmpty(firstPerson) : '?';

        // Update "First person" label to show who that is
        const firstPersonLabel = document.getElementById('default-person-first-label');
        if (firstPersonLabel) {
            firstPersonLabel.textContent = `${strings.treeManager.defaultPersonFirstPerson} (${firstPersonName})`;
        }

        // Select appropriate radio button
        const radioFirst = document.getElementById('default-person-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-person-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;

        if (currentSetting === undefined) {
            radioFirst.checked = true;
        } else if (currentSetting === LAST_FOCUSED) {
            radioLast.checked = true;
        } else {
            radioSpecific.checked = true;
        }

        // The view the tree opens in (1101): the family view unless set to the last used one.
        const viewLast = treeData?.defaultView === 'last';
        (document.getElementById('default-view-family') as HTMLInputElement).checked = !viewLast;
        (document.getElementById('default-view-last') as HTMLInputElement).checked = viewLast;

        // Initialize person picker with persons from this tree
        this.initDefaultPersonPicker(treeData, currentSetting);

        // Update picker visibility based on radio selection
        this.updateDefaultPersonPickerVisibility();

        // Add radio change listeners
        [radioFirst, radioLast, radioSpecific].forEach(radio => {
            radio.onchange = () => this.updateDefaultPersonPickerVisibility();
        });

        modal.classList.add('active');
    },

    /**
     * Initialize PersonPicker for default person selection
     */
    initDefaultPersonPicker(treeData: StromData | null, currentSetting?: PersonId | LastFocusedMarker): void {
        // Destroy existing picker
        if (this.defaultPersonPicker) {
            this.defaultPersonPicker.destroy();
            this.defaultPersonPicker = null;
        }

        if (!treeData) return;

        const persons = Object.values(treeData.persons).filter(p => !p.isPlaceholder);

        this.defaultPersonPicker = new PersonPicker({
            containerId: 'default-person-picker',
            onSelect: () => {
                // When a person is selected, automatically check the "specific" radio
                const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;
                if (radioSpecific) radioSpecific.checked = true;
            },
            placeholder: strings.personPicker.placeholder,
            persons
        });

        // Pre-select current default if it's a specific person ID
        if (currentSetting && currentSetting !== LAST_FOCUSED && treeData.persons[currentSetting]) {
            this.defaultPersonPicker.setValue(currentSetting);
        }
    },

    /**
     * Update picker visibility based on radio selection
     */
    updateDefaultPersonPickerVisibility(): void {
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;
        const pickerContainer = document.getElementById('default-person-picker-container');
        if (pickerContainer) {
            pickerContainer.style.display = radioSpecific?.checked ? 'block' : 'none';
        }
    },

    /**
     * Close default person dialog
     */
    closeDefaultPersonDialog(): void {
        document.getElementById('default-person-modal')?.classList.remove('active');

        if (this.defaultPersonPicker) {
            this.defaultPersonPicker.destroy();
            this.defaultPersonPicker = null;
        }

        this.defaultPersonTreeId = null;
        this.returnToParentDialog();
    },

    /**
     * Confirm and save default person
     */
    async confirmDefaultPerson(): Promise<void> {
        if (!this.defaultPersonTreeId) return;

        const radioFirst = document.getElementById('default-person-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-person-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;

        let value: PersonId | LastFocusedMarker | undefined;

        if (radioFirst?.checked) {
            value = undefined;  // First person
        } else if (radioLast?.checked) {
            value = LAST_FOCUSED;  // Last focused
        } else if (radioSpecific?.checked) {
            value = this.defaultPersonPicker?.getValue() || undefined;
            if (!value) {
                // No person selected, treat as "first person"
                value = undefined;
            }
        }

        const view = (document.getElementById('default-view-last') as HTMLInputElement | null)?.checked ? 'last' : undefined;

        await TreeManager.setDefaultPerson(this.defaultPersonTreeId, value);
        await TreeManager.setDefaultView(this.defaultPersonTreeId, view);

        // If this is the current tree, also update DataManager
        if (this.defaultPersonTreeId === DataManager.getCurrentTreeId()) {
            DataManager.setDefaultPerson(value);
            DataManager.setDefaultView(view);
        }
        // ⌂ beside "Focused on" leads to the new default person at once (spec 111 §5).
        updateDefaultFocusButtons();

        this.closeDefaultPersonDialog();
        this.updateTreeManagerList();
    },

    /** Tree row menu: make this tree the one opened at startup, or undo that. */
    toggleStartupTree(treeId: string): void {
        const current = TreeManager.getDefaultTree();
        TreeManager.setDefaultTree(current === treeId ? undefined : treeId as TreeId);
        void this.updateTreeManagerList();
    },

    // ---- MODIFIED NEW TREE HANDLER ----
    /**
     * Handle new tree creation (replaces old handleNewTree)
     */
    handleNewTree(): void {
        this.showNewTreeDialog();
    },
});
