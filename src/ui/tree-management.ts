/**
 * tree management UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { countFamilies } from '../ged-exporter.js';
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
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFileSize, formatRelativeDateTime } from '../format.js';
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
import { fitFlyout } from './flyout.js';
import { uiModule } from './module.js';
import { treeActionsAsSheet } from './tree-actions.js';
import { isPhoneToolbar } from './search.js';

import { iconSvg } from '../icons.js';

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
                this.closeActionsMenu();
            }
        });

        // The flyouts ("Tree:", "Research") open on hover too (CSS): fit the
        // one under the pointer into the window, and close a flyout another
        // one opened by click / keyboard.
        const flyouts: Array<{ wrap: string; row: string; sub: string; open: () => void; close: () => void }> = [
            { wrap: 'actions-tree-wrap', row: 'actions-tree-row', sub: 'actions-tree-submenu',
                open: () => this.openActionsTreeSubmenu(), close: () => this.closeActionsTreeSubmenu() },
            { wrap: 'actions-research-wrap', row: 'actions-research-row', sub: 'actions-research-submenu',
                open: () => this.openActionsResearchSubmenu(), close: () => this.closeActionsResearchSubmenu() },
        ];
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
            // Keyboard for a submenu row: → opens, ← / Esc closes.
            // (Esc still bubbles to the global handler that closes the whole menu.)
            document.getElementById(f.row)?.addEventListener('keydown', (e) => {
                const ev = e as KeyboardEvent;
                if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    f.open();
                    // Opened from the keyboard: Escape goes back to its row (by the pointer, it closes the menu).
                    document.getElementById(f.wrap)?.setAttribute('data-kbd', '');
                } else if (ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    f.close();
                }
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
                nameEl.textContent = currentName || '...';
            }

            if (dropdown) {
                let html = '';

                // Show embedded trees (only if more than one)
                if (embeddedTrees.length > 1) {
                    for (const tree of embeddedTrees) {
                        html += `
                            <div class="tree-switcher-item ${tree.isActive ? 'active' : ''}" role="menuitem" tabindex="0"
                                 data-embedded-tree-id="${this.escapeHtml(tree.id)}">
                                <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                                ${tree.isActive ? `<span class="tree-item-check">${iconSvg('check')}</span>` : ''}
                            </div>
                        `;
                    }
                } else if (embeddedTrees.length === 1) {
                    // Single tree - just show it as active (no click handler needed)
                    html += `
                        <div class="tree-switcher-item active" role="menuitem" tabindex="0" aria-current="true">
                            <span class="tree-item-name">${this.escapeHtml(embeddedTrees[0].name)}</span>
                            <span class="tree-item-check">${iconSvg('check')}</span>
                        </div>
                    `;
                }

                // Divider and actions (hidden by CSS in view mode, but include for consistency)
                html += `
                    <div class="tree-switcher-divider"></div>
                    <div class="tree-switcher-action" role="menuitem" tabindex="0" onclick="window.Strom.UI.showTreeManagerDialog()">
                        ${strings.treeManager.manageTreesTitle}...
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
                <div class="tree-switcher-item ${isActive ? 'active' : ''}" role="menuitem" tabindex="0"
                     onclick="window.Strom.UI.switchToTree('${tree.id}')">
                    <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                    ${isActive ? `<span class="tree-item-check">${iconSvg('check')}</span>` : ''}
                </div>
            `;
        }

        // The switcher is trees only now: view/tree actions moved to the ⋯
        // actions menu (desktop) and the mobile "More" sheet (≤1024px).
        html += `
            <div class="tree-switcher-divider"></div>
            <div class="tree-switcher-action" role="menuitem" tabindex="0" onclick="window.Strom.UI.showTreeManagerDialog()">
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
        // Small dot on the triggers so the signal survives the menu move — the ⋯
        // button and the mobile "More" tab.
        for (const id of ['actions-menu-dot', 'bottom-bar-more-dot']) {
            const dot = document.getElementById(id);
            if (dot) dot.style.display = count > 0 ? 'block' : 'none';
        }
        // "Research" row + its submenu; waiting tasks light the ⋯ dot as well,
        // and so does a state of the research tree that asks for the user.
        const researchWaiting = this.refreshResearchMenu();
        if (researchWaiting > 0 || this.researchSyncAttention()) {
            const dot = document.getElementById('actions-menu-dot');
            if (dot) dot.style.display = 'block';
        }
        // Count badge on the Anniversaries row.
        const badge = document.getElementById('actions-ann-badge');
        if (badge) {
            badge.textContent = count > 0 ? String(count) : '';
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        // "Change history" row is only offered when the audit log is enabled.
        const auditRow = document.getElementById('actions-tree-audit-row');
        if (auditRow) auditRow.style.display = SettingsManager.isAuditLogEnabled() ? '' : 'none';
        const sourcesRow = document.getElementById('actions-sources-row');
        if (sourcesRow) sourcesRow.style.display = this.isSourcesMenuOffered() ? '' : 'none';
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

    /** Toggle the desktop ⋯ actions menu (mirrors the tree switcher dropdown). */
    toggleActionsMenu(): void {
        this.closeAllMenusExcept('actions');
        this.hideWhatsNewCard();
        const dropdown = document.getElementById('actions-menu-dropdown');
        if (!dropdown) return;
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) {
            this.refreshActionMenuBadges();
            this.updateActionsTreeRow();
            this.closeActionsTreeSubmenu();
            this.closeActionsResearchSubmenu();
        }
    },

    /** Close the desktop ⋯ actions menu (and its "Tree:" / "Research" submenus). */
    closeActionsMenu(): void {
        this.closeActionsTreeSubmenu();
        this.closeActionsResearchSubmenu();
        this.closeResearchTrialNote();
        document.getElementById('actions-menu-dropdown')?.classList.remove('active');
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
    },

    /** The "Tree:" submenu opens on hover; click / →  toggles it for keyboard. */
    toggleActionsTreeSubmenu(): void {
        const wrap = document.getElementById('actions-tree-wrap');
        if (!wrap) return;
        if (wrap.classList.contains('submenu-open')) this.closeActionsTreeSubmenu();
        else this.openActionsTreeSubmenu();
    },

    openActionsTreeSubmenu(): void {
        const wrap = document.getElementById('actions-tree-wrap');
        if (!wrap) return;
        this.closeActionsResearchSubmenu();
        wrap.classList.add('submenu-open');
        document.getElementById('actions-tree-row')?.setAttribute('aria-expanded', 'true');
        this.positionActionsTreeSubmenu();
    },

    /**
     * Keep the "Tree:" flyout inside the window. It starts level with its row
     * at the bottom of the ⋯ menu, so on a short window (or a zoomed page) it
     * used to run off the bottom with its last items unreachable: shift it up
     * as far as needed, and let it scroll when even the whole window height
     * is not enough.
     */
    positionActionsTreeSubmenu(): void {
        this.positionActionsSubmenu('actions-tree-submenu');
    },

    /** Keep a ⋯-menu flyout ("Tree:", "Research") inside the window. */
    positionActionsSubmenu(id: string): void {
        const sub = document.getElementById(id);
        if (!sub) return;
        sub.style.top = '';
        const viewport = window.innerHeight;
        sub.style.maxHeight = `${fitFlyout(0, 0, viewport).maxHeight}px`;
        const rect = sub.getBoundingClientRect();
        if (rect.height === 0 || getComputedStyle(sub).visibility === 'hidden') return;   // not shown (hover already left)
        const { shift } = fitFlyout(rect.top, rect.height, viewport);
        if (shift <= 0) return;
        const baseTop = parseFloat(getComputedStyle(sub).top) || 0;
        sub.style.top = `${baseTop - shift}px`;
    },

    closeActionsTreeSubmenu(): void {
        const wrap = document.getElementById('actions-tree-wrap');
        if (!wrap) return;
        // Closed under the pointer, it must not stay open by hover.
        if (wrap.classList.contains('submenu-open') && wrap.matches(':hover')) wrap.classList.add('hover-off');
        wrap.classList.remove('submenu-open');
        wrap.removeAttribute('data-kbd');
        document.getElementById('actions-tree-row')?.setAttribute('aria-expanded', 'false');
    },

    // The "Tree:" submenu actions reuse the app's own functions (no duplicated
    // logic) against the ACTIVE tree, resolved at click time.
    treeActionSendToResearch(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) void this.researchSendTree(id);
    },

    treeActionRename(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) this.showRenameTreeDialog(id);
    },
    treeActionDuplicate(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) this.duplicateTree(id);
    },
    treeActionMergeInto(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) this.showMergeTreesDialog(id);
    },
    treeActionStats(): void {
        this.closeActionsMenu();
        this.showActiveTreeStats();
    },
    treeActionHealth(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        if (id) void this.showTreeHealthDialog(id);
    },
    /**
     * The source catalog is a research tool: offered when advanced fields are on,
     * or as soon as the tree has a source (imported or cited), so nobody is left
     * without a way to manage sources they already have.
     */
    isSourcesMenuOffered(): boolean {
        if (DataManager.isReadOnly() || DataManager.isTreeLocked()) return false;
        return SettingsManager.isAdvancedFields()
            || Object.keys(DataManager.getData().sources ?? {}).length > 0;
    },
    treeActionSources(): void {
        this.closeActionsMenu();
        this.showSourcesDialog();
    },
    treeActionBook(): void {
        this.closeActionsMenu();
        this.showBookDialog();
    },
    treeActionExport(): void {
        // The one export hub for the active tree (JSON / App / GEDCOM / CSV /
        // Poster / Book / Share); its switch picks the whole tree or the view.
        this.closeActionsMenu();
        this.showExportDialog();
    },
    treeActionSaveToFile(): void {
        this.closeActionsMenu();
        this.attachSaveToFile();
    },
    treeActionAnniversaries(): void {
        this.closeActionsMenu();
        this.showAnniversariesDialog();
    },
    treeActionAudit(): void {
        this.closeActionsMenu();
        this.showAuditLogDialog();
    },
    treeActionSplitFamilies(): void {
        // WYSIWYG: the active tree IS the live view, so no person picker — the
        // first family is exactly what is on screen (same as before the move).
        this.closeActionsMenu();
        this.showSplitFamiliesDialog();
    },
    treeActionHide(): void {
        const id = TreeManager.getActiveTreeId();
        this.closeActionsMenu();
        // Hiding the active tree switches to another visible one; the last
        // visible tree cannot be hidden (handled inside toggleTreeVisibility).
        if (id) void this.toggleTreeVisibility(id);
    },
    treeActionManager(): void {
        this.closeActionsMenu();
        this.showTreeManagerDialog();
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
            }
        }
    },

    /** The phone's tree list: the visible trees (the open one marked), then Manage trees ›. */
    showTreeSwitcherSheet(): void {
        const activeId = TreeManager.getActiveTreeId();
        const trees = TreeManager.getVisibleTrees();
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        this.presentMenuSheet(strings.treeManager.switcherTitle, [
            { rows: trees.map(tree => ({
                label: tree.name,
                active: tree.id === activeId,
                run: () => { if (tree.id !== activeId) void this.switchToTree(tree.id); },
            })) },
            { divider: true, rows: [
                { label: strings.treeManager.manageTreesTitle, value: '\u203a', run: () => this.showTreeManagerDialog() },
            ] },
        ]);
    },

    /**
     * Switch to a different tree
     */
    async switchToTree(treeId: string): Promise<void> {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        dropdown?.classList.remove('active');

        if (await DataManager.switchTree(treeId as TreeId)) {
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
        const defaultTree = TreeManager.getDefaultTree();
        for (const tree of visibleTrees) {
            const isActive = tree.id === activeId;

            // Get tree data for additional stats
            const treeData = await TreeManager.getTreeData(tree.id);
            // As the research and GEDCOM count them: a single parent's family too.
            const familyCount = treeData ? countFamilies(treeData) : 0;

            // Get tree size from metadata
            const treeSize = tree.sizeBytes;
            // Only sizes worth noticing (1 MB and up), rounded: "1,4 MB".
            const treeSizeFormatted = formatFileSize(treeSize, getCurrentLanguage());

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

            // Status as explicit text chips — a leading glyph was easy to miss
            // and its meaning unclear. Active reads green, hidden/locked gray.
            const badges =
                (isActive ? `<span class="tree-badge active-badge">${s.activeBadge}</span>` : '') +
                (tree.isLocked ? `<span class="tree-badge">${s.lockedBadge}</span>` : '') +
                (tree.isHidden ? `<span class="tree-badge">${s.hiddenBadge}</span>` : '');

            html += `
                <div class="tree-manager-item ${isActive ? 'active' : ''} ${tree.isHidden ? 'hidden-tree' : ''}">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator"></span>
                        <span class="tree-manager-item-name clickable" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${this.escapeHtml(tree.name)}</span>
                        ${badges}
                        ${treeSizeFormatted ? `<span class="tree-manager-item-size">${treeSizeFormatted}</span>` : ''}
                    </div>
                    <div class="tree-manager-item-stats-row">
                        ${s.persons(tree.personCount)} • ${s.families(familyCount)}
                        ${defaultPersonDisplay ? ` • ${this.escapeHtml(defaultPersonDisplay)}` : ''}
                    </div>
                    <div class="tree-manager-item-actions">
                        <button class="tree-open-btn" onclick="window.Strom.UI.openTreeFromManager('${tree.id}')">${s.open}</button>
                        ${isActive ? `<span class="tree-opened-label">${s.opened}</span>` : ''}
                        <div class="tree-row-menu-wrap">
                            <button class="tree-row-menu-btn" data-tree-id="${tree.id}" data-tip="${s.moreActions}" aria-label="${s.moreActions}" aria-haspopup="menu">⋯</button>
                            <div class="tree-row-menu" role="menu"></div>
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
            const date = formatRelativeDateTime(new Date(session.savedAt).getTime(), getCurrentLanguage());

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

            html += `
                <div class="tree-manager-item pending-merge">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator pending"></span>
                        <span class="tree-manager-item-name">${this.escapeHtml(displayName)}</span>
                        <span class="tree-manager-item-stats">${this.escapeHtml(statsText)}</span>
                        <span class="tree-manager-item-size">${date}</span>
                    </div>
                    <div class="tree-manager-item-actions">
                        <button class="tree-open-btn edit-only" onclick="window.Strom.UI.resumePendingMergeFromManager('${session.id}')">${strings.merge.resume}</button>
                        <button class="edit-only tree-text-action pending-merge-rename" data-session-id="${this.escapeHtml(session.id)}" data-merge-name="${this.escapeHtml(displayName)}">${strings.treeManager.rename}</button>
                        <button class="danger edit-only tree-text-action pending-merge-discard" data-session-id="${this.escapeHtml(session.id)}" data-merge-name="${this.escapeHtml(displayName)}">${strings.merge.discard}</button>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html || `<p class="tree-manager-empty">${strings.merge.noItems}</p>`;
        // Merge names come from file/tree names: no inline JS (a quote in the
        // name would break out of the handler string).
        list.querySelectorAll<HTMLElement>('.pending-merge-rename').forEach(btn => {
            btn.addEventListener('click', () => { void this.renamePendingMergeFromManager(btn.dataset.sessionId ?? '', btn.dataset.mergeName ?? ''); });
        });
        list.querySelectorAll<HTMLElement>('.pending-merge-discard').forEach(btn => {
            btn.addEventListener('click', () => { void this.discardPendingMergeFromManager(btn.dataset.sessionId ?? '', btn.dataset.mergeName ?? ''); });
        });
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
        const groups = await this.treeActionGroups(treeId, 'manager');
        menu.replaceChildren();
        for (const group of groups) {
            const header = document.createElement('div');
            header.className = 'tree-row-menu-group';
            header.setAttribute('role', 'presentation');
            header.textContent = group.header;
            // A group of edit-only rows hides with them in read-only mode.
            if (group.rows.every(row => row.editOnly)) header.classList.add('edit-only');
            menu.appendChild(header);
            for (const row of group.rows) {
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
                menu.appendChild(item);
            }
        }
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
     * aligned, 4px apart — above it only when there is more room there, and
     * never over the tree's name, the dialog's header nor past the window;
     * max-height is the room left (8px kept on each side) and the rest
     * scrolls inside the menu.
     */
    positionTreeRowMenu(btn: HTMLElement, menu: HTMLElement): void {
        const r = btn.getBoundingClientRect();
        menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        menu.style.top = '0px';
        menu.style.maxHeight = '';
        const h = menu.offsetHeight;
        // The dialog's scrolling body clips the menu: its edges (and the header's) are the room.
        let clip: HTMLElement | null = btn.parentElement;
        while (clip && !/(auto|scroll)/.test(getComputedStyle(clip).overflowY)) clip = clip.parentElement;
        const box = clip?.getBoundingClientRect();
        const header = btn.closest('.modal')?.querySelector('.modal-header')?.getBoundingClientRect();
        const name = btn.closest('.tree-manager-item')?.querySelector('.tree-manager-item-header')?.getBoundingClientRect();
        const ceiling = Math.max(8, header ? header.bottom + 4 : 8, box ? box.top + 4 : 8, name ? name.bottom + 4 : 8);
        const floor = Math.min(window.innerHeight - 8, box ? box.bottom - 8 : Infinity);
        const roomBelow = floor - (r.bottom + 4);
        const roomAbove = (r.top - 4) - ceiling;
        if (h <= roomBelow || roomBelow >= roomAbove) {
            menu.style.top = `${r.bottom + 4}px`;
            if (h > roomBelow) menu.style.maxHeight = `${Math.max(120, roomBelow)}px`;
        } else {
            const fit = Math.min(h, roomAbove);
            menu.style.top = `${Math.max(ceiling, r.top - 4 - fit)}px`;
            if (h > roomAbove) menu.style.maxHeight = `${Math.max(120, roomAbove)}px`;
        }
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

        const d = strings.danger;
        const confirmed = await this.showConfirm(d.deleteTreeMessage(tree.personCount), d.deleteTreeTitle(tree.name),
            { confirmLabel: d.deleteTree, variant: 'danger' });
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
