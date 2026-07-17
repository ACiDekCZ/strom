/**
 * tree management UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { TreeManager } from '../tree-manager.js';
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
    LAST_FOCUSED,
    LastFocusedMarker
} from '../types.js';
import { strings } from '../strings.js';
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
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';

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

            // Same outside-click behaviour for the desktop ⋯ actions menu.
            const actions = document.getElementById('actions-menu-dropdown');
            const actionsBtn = document.querySelector('.actions-menu-btn');
            if (actions?.classList.contains('active') &&
                !actions.contains(e.target as Node) &&
                !actionsBtn?.contains(e.target as Node)) {
                actions.classList.remove('active');
            }
        });
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
                nameEl.textContent = currentName || '...';
            }

            if (dropdown) {
                let html = '';

                // Show embedded trees (only if more than one)
                if (embeddedTrees.length > 1) {
                    for (const tree of embeddedTrees) {
                        html += `
                            <div class="tree-switcher-item ${tree.isActive ? 'active' : ''}"
                                 onclick="window.Strom.UI.switchEmbeddedTree('${tree.id}')">
                                <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                                ${tree.isActive ? '<span class="tree-item-check">✓</span>' : ''}
                            </div>
                        `;
                    }
                } else if (embeddedTrees.length === 1) {
                    // Single tree - just show it as active (no click handler needed)
                    html += `
                        <div class="tree-switcher-item active">
                            <span class="tree-item-name">${this.escapeHtml(embeddedTrees[0].name)}</span>
                            <span class="tree-item-check">✓</span>
                        </div>
                    `;
                }

                // Divider and actions (hidden by CSS in view mode, but include for consistency)
                html += `
                    <div class="tree-switcher-divider"></div>
                    <div class="tree-switcher-action" onclick="window.Strom.UI.showTreeManagerDialog()">
                        ${strings.treeManager.manageTreesTitle}...
                    </div>
                `;

                dropdown.innerHTML = html;
            }
            return;
        }

        // Normal mode: show storage trees
        const activeTree = TreeManager.getActiveTreeMetadata();
        if (nameEl) {
            nameEl.textContent = activeTree?.name || '...';
        }

        if (!dropdown) return;

        // Use getVisibleTrees() to exclude hidden trees from switcher
        const trees = TreeManager.getVisibleTrees();
        const activeId = TreeManager.getActiveTreeId();

        let html = '';

        // Tree list (only visible trees)
        for (const tree of trees) {
            const isActive = tree.id === activeId;
            html += `
                <div class="tree-switcher-item ${isActive ? 'active' : ''}"
                     onclick="window.Strom.UI.switchToTree('${tree.id}')">
                    <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                    ${isActive ? '<span class="tree-item-check">✓</span>' : ''}
                </div>
            `;
        }

        // The switcher is trees only now: view/tree actions moved to the ⋯
        // actions menu (desktop) and the mobile "More" sheet (≤1024).
        html += `
            <div class="tree-switcher-divider"></div>
            <div class="tree-switcher-action" onclick="window.Strom.UI.showTreeManagerDialog()">
                ${strings.treeManager.manageTreesTitle}...
            </div>
        `;

        dropdown.innerHTML = html;
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
        // Small dot on the triggers so the signal survives the menu move.
        for (const id of ['actions-menu-dot', 'bottom-bar-more-dot']) {
            const dot = document.getElementById(id);
            if (dot) dot.style.display = count > 0 ? 'block' : 'none';
        }
        // Count badge inside the desktop ⋯ actions menu.
        const badge = document.getElementById('actions-ann-badge');
        if (badge) {
            badge.textContent = count > 0 ? String(count) : '';
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        this.refreshActionsUndoRedo();
    },

    /**
     * Refresh the ⋯ menu's Undo / Redo rows: the Undo label carries the last
     * change's description (grey "Undo" with no description when the stack is
     * empty); Redo greys out when there is nothing to replay. Shortcut hints
     * follow the platform. Called whenever the menu opens.
     */
    refreshActionsUndoRedo(): void {
        const s = strings.actions;
        const undoRow = document.getElementById('actions-undo-row');
        const undoLabel = document.getElementById('actions-undo-label');
        const undoHint = document.getElementById('actions-undo-hint');
        const redoRow = document.getElementById('actions-redo-row');
        const redoHint = document.getElementById('actions-redo-hint');

        const canUndo = DataManager.canUndo();
        const desc = canUndo ? DataManager.lastUndoDescription() : null;
        if (undoLabel) undoLabel.textContent = desc ? s.undoLabel(desc) : s.undoDisabled;
        if (undoHint) undoHint.textContent = this.shortcutHint('undo');
        if (undoRow) {
            undoRow.classList.toggle('menu-row-disabled', !canUndo);
            undoRow.setAttribute('aria-disabled', String(!canUndo));
        }

        const canRedo = DataManager.canRedo();
        if (redoHint) redoHint.textContent = this.shortcutHint('redo');
        if (redoRow) {
            redoRow.classList.toggle('menu-row-disabled', !canRedo);
            redoRow.setAttribute('aria-disabled', String(!canRedo));
        }
    },

    /** Toggle the desktop ⋯ actions menu (mirrors the tree switcher dropdown). */
    toggleActionsMenu(): void {
        this.closeAllMenusExcept('actions');
        const dropdown = document.getElementById('actions-menu-dropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) this.refreshActionMenuBadges();
    },

    /** Close the desktop ⋯ actions menu. */
    closeActionsMenu(): void {
        document.getElementById('actions-menu-dropdown')?.classList.remove('active');
    },

    /**
     * Toggle tree switcher dropdown
     */
    toggleTreeSwitcher(): void {
        this.closeAllMenusExcept('switcher');
        const dropdown = document.getElementById('tree-switcher-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('active');
            if (dropdown.classList.contains('active')) {
                this.updateTreeSwitcher();
            }
        }
    },

    /**
     * Switch to a different tree
     */
    async switchToTree(treeId: string): Promise<void> {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        dropdown?.classList.remove('active');

        if (await DataManager.switchTree(treeId as TreeId)) {
            this.updateTreeSwitcher();
            // Restore focus from per-tree session state (uses tree's defaultPersonId setting)
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();
            this.refreshSearch();

            // Center view on focused person
            ZoomPan.centerOnFocusWithContext();

            // Update URL with tree parameter (enables refresh persistence and bookmarking)
            this.updateUrlTreeParam(treeId);
        }
    },

    /**
     * Update URL with tree slug parameter without page reload
     * Also clears search parameter as the person may not exist in the new tree
     */
    updateUrlTreeParam(treeId: string): void {
        const treeSlug = TreeManager.getTreeSlug(treeId as TreeId);
        if (!treeSlug) return;

        const url = new URL(window.location.href);
        url.searchParams.set('tree', treeSlug);
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

        let html = '';
        for (const tree of visibleTrees) {
            const isActive = tree.id === activeId;

            // Get tree data for additional stats
            const treeData = await TreeManager.getTreeData(tree.id);
            const familyCount = treeData ? Object.keys(treeData.partnerships).length : 0;

            // Get tree size from metadata
            const treeSize = tree.sizeBytes;
            const treeSizeFormatted = TreeManager.formatBytes(treeSize);

            // Get default person setting
            const defaultPersonSetting = treeData?.defaultPersonId;
            let defaultPersonDisplay = '';

            if (defaultPersonSetting === LAST_FOCUSED) {
                defaultPersonDisplay = strings.treeManager.defaultPersonLastFocused;
            } else if (defaultPersonSetting && treeData?.persons[defaultPersonSetting]) {
                const person = treeData.persons[defaultPersonSetting];
                const birthYear = person.birthDate ? person.birthDate.split('-')[0] : '';
                const name = `${person.firstName} ${person.lastName}`.trim();
                defaultPersonDisplay = birthYear ? `${name} (*${birthYear})` : name;
            }
            // If undefined, don't show anything (first person is implicit default)

            const s = strings.treeManager;
            const visibilityLabel = tree.isHidden ? s.showTree : s.hideTree;
            const lockLabel = tree.isLocked ? strings.lock.unlockTree : strings.lock.lockTree;

            // Status as explicit text chips — a leading glyph was easy to miss
            // and its meaning unclear. Active reads green, hidden/locked gray.
            const badges =
                (isActive ? `<span class="tree-badge active-badge">${s.activeBadge}</span>` : '') +
                (tree.isLocked ? `<span class="tree-badge">${s.lockedBadge}</span>` : '') +
                (tree.isHidden ? `<span class="tree-badge">${s.hiddenBadge}</span>` : '');

            // Row menu items are text-only per the Letopis design (no emoji).
            const menuItem = (onclick: string, label: string, cls = '') =>
                `<button class="tree-row-menu-item ${cls}" onclick="${onclick}">${label}</button>`;

            const auditItem = (AuditLogManager.isEnabled() || await AuditLogManager.hasEntries(tree.id))
                ? menuItem(`window.Strom.UI.showAuditLogDialog('${tree.id}', 'tree-manager-modal')`, strings.auditLog.viewLog)
                : '';

            html += `
                <div class="tree-manager-item ${isActive ? 'active' : ''} ${tree.isHidden ? 'hidden-tree' : ''}">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator"></span>
                        <span class="tree-manager-item-name clickable" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${this.escapeHtml(tree.name)}</span>
                        ${badges}
                        <span class="tree-manager-item-size">${treeSizeFormatted}</span>
                    </div>
                    <div class="tree-manager-item-stats-row">
                        ${tree.personCount} ${s.persons} • ${familyCount} ${s.families}
                        ${defaultPersonDisplay ? ` • ${this.escapeHtml(defaultPersonDisplay)}` : ''}
                    </div>
                    <div class="tree-manager-item-actions">
                        <button class="tree-open-btn" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${s.open}</button>
                        <div class="tree-row-menu-wrap">
                            <button class="tree-row-menu-btn" data-tip="${s.moreActions}">⋯</button>
                            <div class="tree-row-menu">
                                ${menuItem(`window.Strom.UI.showTreeStatsDialog('${tree.id}', 'tree-manager-modal')`, s.stats)}
                                ${menuItem(`window.Strom.UI.showTreeValidationDialog('${tree.id}', 'tree-manager-modal')`, s.validate)}
                                ${menuItem(`window.Strom.UI.showExportDialogFromManager('${tree.id}')`, s.export)}
                                ${menuItem(`window.Strom.UI.showRenameTreeDialog('${tree.id}', 'tree-manager-modal')`, s.rename, 'edit-only tree-row-menu-divider')}
                                ${menuItem(`window.Strom.UI.showDefaultPersonDialog('${tree.id}', 'tree-manager-modal')`, s.defaultPerson, 'edit-only')}
                                ${menuItem(`window.Strom.UI.showSnapshotsDialog('${tree.id}', 'tree-manager-modal')`, strings.snapshots.menu, 'edit-only')}
                                ${isActive ? menuItem(`window.Strom.UI.showPlacesManager(undefined, 'tree-manager-modal')`, strings.map.placesTitle, 'edit-only') : ''}
                                ${isActive ? menuItem(`window.Strom.UI.showSurnamesDialog('tree-manager-modal')`, strings.surnames.menu, 'edit-only') : ''}
                                ${menuItem(`window.Strom.UI.showSplitDialog('${tree.id}', 'tree-manager-modal')`, strings.split.menu, 'edit-only')}
                                ${auditItem}
                                ${menuItem(`window.Strom.UI.duplicateTree('${tree.id}')`, s.duplicate, 'edit-only')}
                                ${menuItem(`window.Strom.UI.showMergeTreesDialog('${tree.id}', 'tree-manager-modal')`, s.mergeInto, 'edit-only')}
                                ${menuItem(`window.Strom.UI.toggleTreeVisibility('${tree.id}')`, visibilityLabel, 'edit-only')}
                                ${menuItem(`window.Strom.UI.toggleTreeLock('${tree.id}')`, lockLabel, 'edit-only')}
                                ${menuItem(`window.Strom.UI.confirmDeleteTree('${tree.id}')`, s.delete, 'danger edit-only tree-row-menu-divider')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        if (filter && visibleTrees.length === 0) {
            html += `<p class="tree-manager-empty">${strings.merge.noItems}</p>`;
        }

        // Pending merge sessions get their own labelled section — mixed into
        // the tree list they read as "some broken tree".
        const pendingMerges = await listMergeSessionsInfo();
        if (pendingMerges.length > 0) {
            html += `<div class="tree-manager-section">${strings.treeManager.pendingSection}</div>`;
        }
        for (const session of pendingMerges) {
            const date = new Date(session.savedAt).toLocaleString();

            // Display name - use incomingFileName or generate from tree names
            const displayName = session.incomingFileName
                || (session.sourceTreeName && session.targetTreeName
                    ? `${session.targetTreeName} + ${session.sourceTreeName}`
                    : strings.merge.pendingMergeLabel);

            // Stats info showing source/target trees
            const mergeInfo = session.sourceTreeName && session.targetTreeName
                ? strings.merge.pendingMergeInto(session.sourceTreeName, session.targetTreeName)
                : '';
            const conflictsInfo = session.stats.conflicts > 0
                ? ` • ${strings.merge.pendingMergeConflicts(session.stats.conflicts)}`
                : '';
            const progressInfo = strings.merge.reviewedCount(session.stats.reviewed, session.stats.total);
            const statsText = mergeInfo ? `${mergeInfo}${conflictsInfo} • ${progressInfo}` : `${progressInfo}${conflictsInfo}`;

            const escapedName = this.escapeHtml(displayName).replace(/'/g, "\\'");
            html += `
                <div class="tree-manager-item pending-merge">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator pending"></span>
                        <span class="tree-manager-item-name">${this.escapeHtml(displayName)}</span>
                        <span class="tree-manager-item-stats">${statsText}</span>
                        <span class="tree-manager-item-size">${date}</span>
                    </div>
                    <div class="tree-manager-item-actions">
                        <button class="tree-open-btn edit-only" onclick="window.Strom.UI.resumePendingMergeFromManager('${session.id}')">${strings.merge.resume}</button>
                        <button class="edit-only tree-text-action" onclick="window.Strom.UI.renamePendingMergeFromManager('${session.id}', '${escapedName}')">${strings.treeManager.rename}</button>
                        <button class="danger edit-only tree-text-action" onclick="window.Strom.UI.discardPendingMergeFromManager('${session.id}', '${escapedName}')">${strings.merge.discard}</button>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html || `<p class="tree-manager-empty">${strings.merge.noItems}</p>`;
        this.wireTreeRowMenus(list);
    },

    /** Per-row "⋯" menus: one open at a time, outside click closes. Wired once. */
    wireTreeRowMenus(list: HTMLElement): void {
        const closeAll = () =>
            list.querySelectorAll('.tree-row-menu.open').forEach(m => m.classList.remove('open'));

        if (!list.dataset.menuWired) {
            list.dataset.menuWired = '1';
            list.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const btn = target.closest('.tree-row-menu-btn') as HTMLElement | null;
                if (btn) {
                    const menu = btn.parentElement?.querySelector('.tree-row-menu') as HTMLElement | null;
                    const wasOpen = menu?.classList.contains('open');
                    closeAll();
                    if (menu && !wasOpen) {
                        menu.classList.add('open');
                        this.positionTreeRowMenu(btn, menu);
                    }
                    e.stopPropagation();
                    return;
                }
                // A menu item runs its inline action; close the menu around it.
                if (target.closest('.tree-row-menu-item')) closeAll();
            });
            document.addEventListener('click', (e) => {
                if (!(e.target as HTMLElement).closest('.tree-row-menu-wrap')) closeAll();
            });
            // A fixed-position menu must not drift away from its button.
            window.addEventListener('resize', closeAll);
            document.addEventListener('scroll', closeAll, true);
        }
    },

    /**
     * Place a row menu (position: fixed) next to its ⋯ button: right-aligned
     * to the button, below it — or above when there is no room underneath.
     */
    positionTreeRowMenu(btn: HTMLElement, menu: HTMLElement): void {
        const r = btn.getBoundingClientRect();
        menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        menu.style.top = '0px';
        const h = menu.offsetHeight;
        const below = r.bottom + 4;
        const top = (below + h > window.innerHeight - 8)
            ? Math.max(8, r.top - h - 4)
            : below;
        menu.style.top = `${top}px`;
    },

    /** Switch to a tree from the manager and close the dialog to show it. */
    async openTreeFromManager(treeId: string): Promise<void> {
        this.closeTreeManagerDialog();
        // The active tree is already open — its Open button simply shows it.
        // (Every row has the button; a missing one on the active row read as
        // an inconsistency, not as information.)
        if (treeId === TreeManager.getActiveTreeId()) return;
        await this.switchToTree(treeId);
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
        this.showImportTreeDialog(focusedData, strings.treeManager.defaultTreeName, true);
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

    // ---- DUPLICATE TREE ----
    /**
     * Show duplicate tree dialog
     */
    duplicateTree(treeId: string): void {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        if (!tree) return;

        this.duplicateTreeId = treeId as TreeId;
        const defaultName = tree.name + ' ' + strings.treeManager.duplicateSuffix;

        const modal = document.getElementById('duplicate-tree-modal');
        const input = document.getElementById('duplicate-tree-name') as HTMLInputElement;

        // Handle dialog stack - tree-manager is parent
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('duplicate-tree-modal');

        if (input) {
            input.value = defaultName;
        }

        modal?.classList.add('active');
        input?.focus();
        input?.select();

        // Handle Enter key
        if (input) {
            input.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.confirmDuplicateTree();
                }
            };
        }
    },

    /**
     * Close duplicate tree dialog
     */
    closeDuplicateTreeDialog(): void {
        const modal = document.getElementById('duplicate-tree-modal');
        modal?.classList.remove('active');
        this.returnToParentDialog();
        this.duplicateTreeId = null;
    },

    /**
     * Confirm duplicate tree
     */
    async confirmDuplicateTree(): Promise<void> {
        if (!this.duplicateTreeId) return;

        const input = document.getElementById('duplicate-tree-name') as HTMLInputElement;
        const newName = input?.value.trim();

        if (!newName) {
            input?.focus();
            return;
        }

        await TreeManager.duplicateTree(this.duplicateTreeId, newName);
        this.closeDuplicateTreeDialog();
        this.updateTreeManagerList();
        this.updateTreeSwitcher();
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
    async confirmDeleteTree(treeId: string): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        if (!tree) return;

        // Setup dialog stack - tree manager is parent of confirm
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');

        const confirmed = await this.showConfirm(strings.treeManager.confirmDelete(tree.name), strings.buttons.delete);
        if (confirmed) {
            const wasActive = TreeManager.getActiveTreeId() === treeId;
            await TreeManager.deleteTree(treeId as TreeId);

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
        // If not confirmed, tree manager stays open (returnToParentDialog handles it)
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
        const firstPersonName = firstPerson ? `${firstPerson.firstName} ${firstPerson.lastName}`.trim() : '?';

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

        await TreeManager.setDefaultPerson(this.defaultPersonTreeId, value);

        // If this is the current tree, also update DataManager
        if (this.defaultPersonTreeId === DataManager.getCurrentTreeId()) {
            DataManager.setDefaultPerson(value);
        }

        this.closeDefaultPersonDialog();
        this.updateTreeManagerList();
    },

    // ---- DEFAULT TREE DIALOG ----
    /**
     * Show default tree dialog
     */
    showDefaultTreeDialog(): void {
        const modal = document.getElementById('default-tree-modal');
        if (!modal) return;

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('default-tree-modal');

        const currentSetting = TreeManager.getDefaultTree();
        const trees = TreeManager.getTrees();

        // Get first tree name for display
        const firstTree = trees[0];
        const firstTreeName = firstTree ? firstTree.name : '?';

        // Update "First tree" label to show which tree that is
        const firstTreeLabel = document.getElementById('default-tree-first-label');
        if (firstTreeLabel) {
            firstTreeLabel.textContent = `${strings.treeManager.defaultTreeFirstTree} (${firstTreeName})`;
        }

        // Select appropriate radio button
        const radioFirst = document.getElementById('default-tree-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-tree-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;

        if (currentSetting === undefined) {
            radioFirst.checked = true;
        } else if (currentSetting === LAST_FOCUSED) {
            radioLast.checked = true;
        } else {
            radioSpecific.checked = true;
        }

        // Populate tree select
        const treeSelect = document.getElementById('default-tree-select') as HTMLSelectElement;
        if (treeSelect) {
            treeSelect.innerHTML = trees.map(tree =>
                `<option value="${tree.id}"${currentSetting === tree.id ? ' selected' : ''}>${this.escapeHtml(tree.name)}</option>`
            ).join('');
        }

        // Update select visibility
        this.updateDefaultTreeSelectVisibility();

        // Add radio change listeners
        [radioFirst, radioLast, radioSpecific].forEach(radio => {
            radio.onchange = () => this.updateDefaultTreeSelectVisibility();
        });

        modal.classList.add('active');
    },

    /**
     * Update tree select visibility based on radio selection
     */
    updateDefaultTreeSelectVisibility(): void {
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;
        const selectContainer = document.getElementById('default-tree-select-container');
        if (selectContainer) {
            selectContainer.style.display = radioSpecific?.checked ? 'block' : 'none';
        }
    },

    /**
     * Close default tree dialog
     */
    closeDefaultTreeDialog(): void {
        document.getElementById('default-tree-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    /**
     * Confirm and save default tree
     */
    confirmDefaultTree(): void {
        const radioFirst = document.getElementById('default-tree-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-tree-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;
        const treeSelect = document.getElementById('default-tree-select') as HTMLSelectElement;

        let value: TreeId | LastFocusedMarker | undefined;

        if (radioFirst?.checked) {
            value = undefined;  // First tree
        } else if (radioLast?.checked) {
            value = LAST_FOCUSED;  // Last focused
        } else if (radioSpecific?.checked) {
            value = treeSelect?.value as TreeId || undefined;
        }

        TreeManager.setDefaultTree(value);
        this.closeDefaultTreeDialog();
    },

    // ---- MODIFIED NEW TREE HANDLER ----
    /**
     * Handle new tree creation (replaces old handleNewTree)
     */
    handleNewTree(): void {
        this.showNewTreeDialog();
    },
});
