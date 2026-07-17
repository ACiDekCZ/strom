/**
 * misc UI methods. Extracted from the original UIClass;
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
import { ThemeMode, LanguageSetting, AppMode, AuditLog, APP_VERSION, ViewMode, STANDALONE_VIEWS } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { yearOf } from '../dates.js';

export const miscMethods = uiModule({
    // ---- ABOUT DIALOG ----
    showAboutDialog(): void {
        const modal = document.getElementById('about-modal');
        if (!modal) return;

        // Set version (from package.json via APP_VERSION)
        const versionEl = document.getElementById('about-version');
        if (versionEl) {
            versionEl.textContent = APP_VERSION;
        }

        // Calculate and display stats
        this.updateAboutStats();

        modal.classList.add('active');
    },

    updateAboutStats(): void {
        const persons = DataManager.getAllPersons();
        const partnerships = DataManager.getAllPartnerships();

        // Count persons (excluding placeholders)
        const realPersons = persons.filter(p => !p.isPlaceholder);
        const men = realPersons.filter(p => p.gender === 'male').length;
        const women = realPersons.filter(p => p.gender === 'female').length;

        // Count families (partnerships)
        const families = partnerships.length;

        // Calculate generations
        const generations = this.calculateMaxGenerations(persons);

        // Find oldest person (by birth year)
        const oldest = this.findOldestPerson(realPersons);

        // Get current tree name
        const activeTree = TreeManager.getActiveTreeMetadata();
        const treeName = activeTree?.name || '-';

        // Update tree name
        const treeNameEl = document.getElementById('stat-tree-name');
        if (treeNameEl) treeNameEl.textContent = treeName;

        // Update compact stats row for current tree
        const statsRow = document.getElementById('about-stats-row');
        if (statsRow) {
            const parts = [
                `${realPersons.length} persons`,
                `${men}♂ ${women}♀`,
                `${families} families`,
                `${generations} gen`
            ];
            if (oldest !== '-') {
                parts.push(`since ${oldest}`);
            }
            statsRow.textContent = parts.join(' • ');
        }

        // Calculate and update aggregate stats across all trees
        this.updateAboutTotalStats();
    },

    /**
     * Calculate and display aggregate statistics across all trees
     */
    async updateAboutTotalStats(): Promise<void> {
        const trees = TreeManager.getTrees();
        const totalStatsRow = document.getElementById('about-stats-total-row');
        const totalStatsSection = document.getElementById('about-stats-total');

        // Hide total stats if only one tree
        if (totalStatsSection) {
            totalStatsSection.style.display = trees.length > 1 ? 'block' : 'none';
        }

        if (!totalStatsRow || trees.length <= 1) return;

        let totalPersons = 0;
        let totalMen = 0;
        let totalWomen = 0;
        let totalFamilies = 0;

        for (const tree of trees) {
            const treeData = await TreeManager.getTreeData(tree.id);
            if (!treeData) continue;

            const persons = Object.values(treeData.persons).filter(p => !p.isPlaceholder);
            totalPersons += persons.length;
            totalMen += persons.filter(p => p.gender === 'male').length;
            totalWomen += persons.filter(p => p.gender === 'female').length;
            totalFamilies += Object.keys(treeData.partnerships).length;
        }

        const parts = [
            `${trees.length} ${strings.about.stats.trees}`,
            `${totalPersons} ${strings.about.stats.persons.toLowerCase()}`,
            `${totalMen}♂ ${totalWomen}♀`,
            `${totalFamilies} ${strings.about.stats.families.toLowerCase()}`
        ];

        totalStatsRow.textContent = parts.join(' • ');
    },

    calculateMaxGenerations(persons: import('../types.js').Person[]): number {
        if (persons.length === 0) return 0;

        // Find a root person (someone without parents)
        const roots = persons.filter(p => p.parentIds.length === 0 && !p.isPlaceholder);
        if (roots.length === 0) return 1;

        // BFS to find max depth
        let maxDepth = 0;
        const visited = new Set<PersonId>();

        const getDepth = (personId: PersonId, depth: number): number => {
            if (visited.has(personId)) return depth;
            visited.add(personId);

            const person = DataManager.getPerson(personId);
            if (!person) return depth;

            let maxChildDepth = depth;
            for (const childId of person.childIds) {
                const childDepth = getDepth(childId, depth + 1);
                maxChildDepth = Math.max(maxChildDepth, childDepth);
            }
            return maxChildDepth;
        };

        for (const root of roots) {
            const depth = getDepth(root.id, 1);
            maxDepth = Math.max(maxDepth, depth);
        }

        return maxDepth;
    },

    findOldestPerson(persons: import('../types.js').Person[]): string {
        let oldestYear = Infinity;
        let oldestName = '-';

        for (const person of persons) {
            if (person.birthDate) {
                const year = yearOf(person.birthDate) ?? 0;
                if (year && year < oldestYear) {
                    oldestYear = year;
                    oldestName = `${year}`;
                }
            }
        }

        return oldestName;
    },

    closeAboutDialog(): void {
        document.getElementById('about-modal')?.classList.remove('active');
    },

    // ---- SETTINGS DIALOG ----
    showSettingsDialog(): void {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;

        // Set current theme selection
        const currentTheme = SettingsManager.getTheme();
        const themeRadios = modal.querySelectorAll<HTMLInputElement>('input[name="theme"]');
        themeRadios.forEach(radio => {
            radio.checked = radio.value === currentTheme;
        });

        // Set current language selection
        const currentLanguage = SettingsManager.getLanguage();
        const languageRadios = modal.querySelectorAll<HTMLInputElement>('input[name="language"]');
        languageRadios.forEach(radio => {
            radio.checked = radio.value === currentLanguage;
        });

        // Set current encryption state
        const encryptionToggle = document.getElementById('encryption-toggle') as HTMLInputElement;
        const encryptionStatus = document.getElementById('encryption-status');
        if (encryptionToggle) {
            encryptionToggle.checked = SettingsManager.isEncryptionEnabled();
        }
        if (encryptionStatus) {
            encryptionStatus.textContent = SettingsManager.isEncryptionEnabled()
                ? strings.encryption.encryptionEnabled
                : strings.encryption.encryptionDisabled;
        }

        // Set current audit log state
        const auditLogToggle = document.getElementById('audit-log-toggle') as HTMLInputElement;
        const auditLogStatus = document.getElementById('audit-log-status');
        if (auditLogToggle) {
            auditLogToggle.checked = AuditLogManager.isEnabled();
        }
        if (auditLogStatus) {
            auditLogStatus.textContent = AuditLogManager.isEnabled()
                ? strings.auditLog.enabled
                : strings.auditLog.disabled;
        }

        const suggestToggle = document.getElementById('suggest-duplicates-toggle') as HTMLInputElement | null;
        if (suggestToggle) suggestToggle.checked = SettingsManager.isSuggestDuplicatesEnabled();

        const minimapToggle = document.getElementById('minimap-toggle') as HTMLInputElement | null;
        if (minimapToggle) minimapToggle.checked = SettingsManager.isMinimapEnabled();

        const zoomControlsToggle = document.getElementById('zoom-controls-toggle') as HTMLInputElement | null;
        if (zoomControlsToggle) zoomControlsToggle.checked = SettingsManager.isZoomControlsEnabled();

        const otdToggle = document.getElementById('on-this-day-toggle') as HTMLInputElement | null;
        if (otdToggle) otdToggle.checked = SettingsManager.isOnThisDayEnabled();
        const deathAnnToggle = document.getElementById('death-anniversaries-toggle') as HTMLInputElement | null;
        if (deathAnnToggle) deathAnnToggle.checked = SettingsManager.isDeathAnniversariesEnabled();

        const densitySelect = document.getElementById('card-density-select') as HTMLSelectElement | null;
        if (densitySelect) densitySelect.value = SettingsManager.getCardDensity();
        const kekuleToggle = document.getElementById('fan-kekule-toggle') as HTMLInputElement | null;
        if (kekuleToggle) kekuleToggle.checked = SettingsManager.isFanKekuleEnabled();
        const crossTreeToggle = document.getElementById('cross-tree-badges-toggle') as HTMLInputElement | null;
        if (crossTreeToggle) crossTreeToggle.checked = SettingsManager.isCrossTreeBadgesEnabled();
        const branchColorsToggle = document.getElementById('branch-colors-toggle') as HTMLInputElement | null;
        if (branchColorsToggle) branchColorsToggle.checked = SettingsManager.isBranchColorsEnabled();
        const descFamiliesToggle = document.getElementById('descendants-families-default-toggle') as HTMLInputElement | null;
        if (descFamiliesToggle) descFamiliesToggle.checked = SettingsManager.isDescendantsFullFamiliesDefault();

        const familyButtonToggle = document.getElementById('family-button-toggle') as HTMLInputElement | null;
        if (familyButtonToggle) familyButtonToggle.checked = SettingsManager.isFamilyButtonEnabled();

        const branchLegendToggle = document.getElementById('branch-legend-toggle') as HTMLInputElement | null;
        if (branchLegendToggle) branchLegendToggle.checked = SettingsManager.isBranchLegendEnabled();

        const geocodingToggle = document.getElementById('geocoding-toggle') as HTMLInputElement | null;
        if (geocodingToggle) geocodingToggle.checked = SettingsManager.isGeocodingAllowed();

        const advancedToggle = document.getElementById('advanced-fields-toggle') as HTMLInputElement | null;
        if (advancedToggle) advancedToggle.checked = SettingsManager.isAdvancedFields();

        modal.classList.add('active');
    },

    closeSettingsDialog(): void {
        document.getElementById('settings-modal')?.classList.remove('active');
    },

    setTheme(theme: ThemeMode): void {
        SettingsManager.setTheme(theme);
    },

    // ==================== DISPLAY VIEW MODE (family / descendants) ====================

    setDisplayViewMode(mode: ViewMode): void {
        TreeRenderer.setViewMode(mode); // re-renders + calls updateViewModeUI
    },

    exitDescendantsView(): void {
        this.setDisplayViewMode('family');
    },

    /** Sync the toolbar segment + descendants badge with the renderer's view mode. */
    updateViewModeUI(): void {
        const mode = TreeRenderer.getViewMode();
        // Mobile CSS hides the focus bar under the descendants badge.
        document.body.classList.toggle('descendants-view', mode === 'descendants');
        // Standalone views (map/timeline/fan) have their own top-left controls;
        // the tree focus chip does not apply there and must not overlap them.
        document.body.classList.toggle('standalone-view',
            mode === 'map' || mode === 'timeline' || mode === 'fan');
        for (const m of ['family', 'descendants', 'timeline', 'fan', 'map']) {
            document.getElementById(`view-mode-${m}`)?.classList.toggle('active', mode === m);
        }
        // Mobile bottom bar: three primary view tabs plus "More" (fan/map live
        // in the More sheet, so More lights up while either is active).
        document.getElementById('bb-view-family')?.classList.toggle('active', mode === 'family');
        document.getElementById('bb-view-descendants')?.classList.toggle('active', mode === 'descendants');
        document.getElementById('bb-view-timeline')?.classList.toggle('active', mode === 'timeline');
        document.getElementById('bb-view-more')?.classList.toggle('active', mode === 'fan' || mode === 'map');

        const badge = document.getElementById('descendants-badge');
        const text = document.getElementById('descendants-badge-text');
        if (mode === 'descendants') {
            const focusId = TreeRenderer.getFocusPersonId();
            const person = focusId ? DataManager.getPerson(focusId) : null;
            const name = person ? `${person.firstName} ${person.lastName}`.trim() : '';
            if (text) text.textContent = strings.viewModeSwitch.badge(name, TreeRenderer.getDescendantCount());
            const famToggle = document.getElementById('descendants-families-toggle');
            famToggle?.classList.toggle('active', TreeRenderer.isDescendantsFullFamilies());
            if (badge) badge.style.display = 'flex';
        } else if (badge) {
            badge.style.display = 'none';
        }

        // The floating zoom/pan controls act on the tree canvas — in the
        // timeline and fan views (own scroll containers) they do nothing, so
        // hide them. The user can also turn them off entirely in settings.
        const zoomControls = document.querySelector('.zoom-controls') as HTMLElement | null;
        if (zoomControls) {
            const hidden = STANDALONE_VIEWS.includes(mode) || !SettingsManager.isZoomControlsEnabled();
            zoomControls.style.display = hidden ? 'none' : '';
        }

        // Toolbar "Add family" shortcut (opt-in setting).
        const familyBtn = document.getElementById('toolbar-family-btn');
        if (familyBtn) familyBtn.style.display = SettingsManager.isFamilyButtonEnabled() ? '' : 'none';

        // Branch-colour legend: only when the setting is on and cards are
        // actually shown (family/descendants — not timeline, not fan).
        const cardsShown = mode === 'family' || mode === 'descendants';
        // The legend pill (gender rings) shows whenever cards are on screen; the
        // branch swatches inside it stay an opt-in sub-group.
        const treeLegend = document.getElementById('tree-legend');
        if (treeLegend) {
            const hasPersons = DataManager.getAllPersons().length > 0;
            treeLegend.style.display = (cardsShown && hasPersons) ? 'flex' : 'none';
        }
        const legend = document.getElementById('branch-legend');
        if (legend) {
            legend.style.display = (cardsShown && SettingsManager.isBranchColorsEnabled()
                && SettingsManager.isBranchLegendEnabled()) ? 'flex' : 'none';
        }
    },

    setLanguage(language: LanguageSetting): void {
        SettingsManager.setLanguage(language);
        // Refresh UI to update all strings
        this.initializeStrings();
        // Refresh dynamically created components
        this.initSearch();
        this.updateTreeSwitcher();
        this.updateEncryptionStatus();
        TreeRenderer.render();
    },

    // ---- MENUS ----
    /**
     * The three toolbar overlays — the mobile "More" (Více) bottom sheet, the
     * tree switcher and the desktop ⋯ actions menu — are mutually exclusive:
     * opening one closes the others. Called at the top of each toggle so a
     * second one never layers on top of the first (a user once saw the old
     * hamburger and the switcher dropdown open together on mobile).
     */
    closeAllMenusExcept(which: 'sheet' | 'switcher' | 'actions'): void {
        if (which !== 'sheet') this.hideBottomSheet();
        if (which !== 'switcher') document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
        if (which !== 'actions') document.getElementById('actions-menu-dropdown')?.classList.remove('active');
    },

    // ---- MOBILE "MORE" MENU ----
    /**
     * Legacy alias kept so action methods can defensively close the mobile menu
     * after they fire. The hamburger is gone; the mobile menu is now the "More"
     * bottom sheet, so closing it means dismissing that sheet.
     */
    closeMobileMenu(): void {
        this.hideBottomSheet();
    },

    // ---- KEYBOARD SHORTCUTS ----
    initKeyboard(): void {
        document.addEventListener('keydown', (e) => {
            // The slideshow owns the keyboard while it runs (TV remote style).
            if (this.slideshowActive) {
                if (e.key === 'Escape') { e.preventDefault(); this.stopSlideshow(); return; }
                if (e.key === ' ') { e.preventDefault(); this.toggleSlideshowPause(); return; }
                if (e.key === 'ArrowRight') { e.preventDefault(); this.advanceSlideshow(1); return; }
                if (e.key === 'ArrowLeft') { e.preventDefault(); this.advanceSlideshow(-1); return; }
                return;
            }
            if (e.key === 'Escape') {
                // The cross-tree chooser (a floating menu, not a modal) closes
                // first and ONLY itself — it must not fall through to the
                // dialog-stack handling below.
                if (this.crossTreeChooser) {
                    this.hideCrossTreeChooser();
                    return;
                }
                // The interactive tour takes precedence (it is not a modal).
                if (this.tourActive) {
                    this.endTour();
                    return;
                }
                // Floating overlays (not modals) close first and only
                // themselves: the mobile "More" sheet, the desktop ⋯ actions
                // menu and the tree switcher.
                if (this.bottomSheet) {
                    this.hideBottomSheet();
                    return;
                }
                const actionsMenu = document.getElementById('actions-menu-dropdown');
                if (actionsMenu?.classList.contains('active')) {
                    this.closeActionsMenu();
                    return;
                }
                const switcher = document.getElementById('tree-switcher-dropdown');
                if (switcher?.classList.contains('active')) {
                    switcher.classList.remove('active');
                    return;
                }

                // Search filter panel closes first (it is not a modal)
                const searchFilters = document.getElementById('search-filters');
                if (searchFilters && searchFilters.style.display !== 'none') {
                    this.toggleSearchFilters();
                    return;
                }
                // Check if merge modal is open - it handles its own escape
                const mergeModal = document.getElementById('merge-modal');
                if (mergeModal?.classList.contains('active')) {
                    // Merge modal has its own escape handler
                    return;
                }

                // Special check for relation-modal in link mode (regardless of stack state)
                const relationModal = document.getElementById('relation-modal');
                if (relationModal?.classList.contains('active') && this.linkMode) {
                    // First close any open PersonPicker dropdown
                    this.relationPicker?.hide();
                    // Toggle back to create mode
                    this.toggleLinkMode();
                    return;
                }

                // Handle dialog stack - return to parent dialog
                if (this.dialogStack.length > 0) {
                    const currentDialog = this.dialogStack[this.dialogStack.length - 1];

                    // Intercept Escape for relationships-modal to check pending changes
                    if (currentDialog === 'relationships-modal' && this.pendingPartnershipChanges.size > 0) {
                        this.showUnsavedChangesDialog();
                        return;
                    }

                    // Special handling for relation-modal
                    if (currentDialog === 'relation-modal') {
                        this.closeRelationModal();
                        return;
                    }

                    // Dynamic overlays (built per-open): full close removes the
                    // element + its stack entry, not just the 'active' class.
                    if (currentDialog === 'archives-modal') {
                        this.closeArchiveSearch();
                        return;
                    }
                    if (currentDialog === 'kinship-modal') {
                        this.closeRelationshipCalculator();
                        return;
                    }
                    if (currentDialog === 'places-modal') {
                        this.closePlacesManager();
                        return;
                    }
                    if (currentDialog === 'split-modal') {
                        this.closeSplitDialog();
                        return;
                    }
                    if (currentDialog === 'surnames-modal') {
                        this.closeSurnamesDialog();
                        return;
                    }

                    // Special handling for person-merge-modal: closePersonMergeDialog handles stack and parent
                    if (currentDialog === 'person-merge-modal') {
                        this.closePersonMergeDialog();
                        return;
                    }

                    // Participant picker: resolve its promise with cancel (which
                    // also pops the stack entry) rather than closing the event
                    // editor underneath and leaving the await unsettled.
                    if (currentDialog === 'participant-picker-modal') {
                        this.cancelParticipantPicker();
                        return;
                    }

                    this.dialogStack.pop();

                    this.closeDialogById(currentDialog);

                    // Special handling for relationships-modal: use closeRelationshipsPanel for proper cleanup
                    if (currentDialog === 'relationships-modal') {
                        // Don't re-close (already closed above), but do the cleanup
                        this.pendingPartnershipChanges.clear();
                        const returnToId = this.returnToEditPersonId;
                        this.relationshipsPanelPersonId = null;
                        this.returnToEditPersonId = null;
                        if (this.dialogStack.length > 0) {
                            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
                            if (returnToId && parentDialog === 'person-modal') {
                                this.openDialogById(parentDialog);
                            }
                            this.dialogStack = [];
                        }
                        return;
                    }

                    // Reopen parent if exists
                    if (this.dialogStack.length > 0) {
                        const parentDialog = this.dialogStack[this.dialogStack.length - 1];
                        this.openDialogById(parentDialog);
                    }
                    return;
                }

                // Close all dialogs (fallback for dialogs not in stack)
                // Check for unsaved relationship changes before closing
                if (this.relationshipsPanelPersonId && this.pendingPartnershipChanges.size > 0) {
                    this.showUnsavedChangesDialog();
                    return;
                }
                // Check for unsaved person modal changes before closing
                if (this.hasPersonModalChanges()) {
                    this.showPersonUnsavedChangesDialog();
                    return;
                }
                this.forceCloseModal();
                this.closeRelationModal();
                this.closeConfirmModal();
                this.closeRelationshipsPanel();
                this.closeAboutDialog();
                this.closeSettingsDialog();
                this.closeExportDialog();
                this.closeImportDialog();
                this.closeMobileMenu();
                this.hideContextMenu();
                this.closeGedcomResultDialog();
                this.closeSaveCurrentDialog();
                this.closeValidationDialog();
                this.closePendingMergeDialog();
                this.closeNewTreeMenu();
                this.closeExportAllDialog();
                this.closeDefaultPersonDialog();
                this.closeTreeManagerDialog();
                this.closePersonMergeDialog();
                this.closeArchiveSearch();
                this.closeRelationshipCalculator();
                // Generic sweep: any remaining plain dialog (book, poster,
                // sources, snapshots, stats, anniversaries, audit log, ...)
                // closes too — new dialogs must not depend on being
                // hand-listed above. Promise-managed prompts are skipped so
                // their callbacks can't be left dangling.
                const promiseManaged = new Set(['confirmation-modal', 'password-prompt-modal', 'export-password-modal', 'password-setup-modal']);
                document.querySelectorAll('.modal-overlay.active').forEach(el => {
                    if (!promiseManaged.has(el.id)) el.classList.remove('active');
                });
            }

            // Skip remaining shortcuts if modal is open
            if (this.dialogStack.length > 0) return;
            const activeModals = document.querySelectorAll('.modal-overlay.active');
            if (activeModals.length > 0) return;

            // Alt+Left / Alt+Right: focus-history back / forward
            if (e.altKey && e.key === 'ArrowLeft') {
                e.preventDefault();
                TreeRenderer.goBack();
                return;
            }
            if (e.altKey && e.key === 'ArrowRight') {
                e.preventDefault();
                TreeRenderer.goForward();
                return;
            }

            // Ctrl/Cmd+F: Focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.toolbarSearchPicker?.focusInput();
                return;
            }

            // Ctrl/Cmd+S: save into the attached file (only when the tree is
            // linked to one — otherwise leave the browser default).
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                if (this.activeFileHandleName) {
                    e.preventDefault();
                    void this.saveActiveTreeToFile();
                }
                return;
            }

            // Skip shortcuts when focus is in input/textarea/select
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) return;

            // "/" focuses the toolbar search (only when not typing — the guard
            // above already returned for inputs/textareas/selects).
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.toolbarSearchPicker?.focusInput();
                return;
            }

            // Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                if (e.shiftKey) this.performRedo(); else this.performUndo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
                e.preventDefault();
                this.performRedo();
                return;
            }

            // Delete: delete focused person (skip if locked)
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const focusId = TreeRenderer.getFocusPersonId();
                if (focusId && !DataManager.isPersonLocked(focusId)) {
                    this.confirmDelete(focusId);
                }
                return;
            }

            // +/= : Zoom in
            if (e.key === '+' || e.key === '=') {
                ZoomPan.zoomIn();
                return;
            }

            // - : Zoom out
            if (e.key === '-') {
                ZoomPan.zoomOut();
                return;
            }

            // 0 : Reset zoom
            if (e.key === '0') {
                ZoomPan.reset();
                return;
            }
        });
    },

    /**
     * Close dialog by ID
     */
    closeDialogById(dialogId: string | undefined): void {
        if (!dialogId) return;
        document.getElementById(dialogId)?.classList.remove('active');
    },

    /**
     * Open dialog by ID
     */
    openDialogById(dialogId: string | undefined): void {
        if (!dialogId) return;
        document.getElementById(dialogId)?.classList.add('active');
    },

    /**
     * Push dialog to stack (for nested dialogs)
     */
    pushDialog(dialogId: string): void {
        this.dialogStack.push(dialogId);
    },

    /**
     * Clear dialog stack
     */
    clearDialogStack(): void {
        this.dialogStack = [];
    },

    // ---- VALIDATION DIALOG ----
    /**
     * Show validation errors/warnings dialog
     */
    showValidationDialog(result: ValidationResult, onContinue?: () => void): void {
        const modal = document.getElementById('validation-modal');
        const content = document.getElementById('validation-content');
        const continueBtn = document.getElementById('validation-continue-btn');

        if (!modal || !content || !continueBtn) return;

        let html = '';

        // Show errors
        if (result.errors.length > 0) {
            html += `
                <div class="validation-section">
                    <div class="validation-section-title errors">
                        ${strings.validation.errors} (${result.errors.length})
                    </div>
                    ${result.errors.map(err => `
                        <div class="validation-item">${this.formatValidationMessage(err)}</div>
                    `).join('')}
                </div>
            `;
        }

        // Show warnings
        if (result.warnings.length > 0) {
            html += `
                <div class="validation-section">
                    <div class="validation-section-title warnings">
                        ${strings.validation.warnings} (${result.warnings.length})
                    </div>
                    ${result.warnings.map(warn => `
                        <div class="validation-item">${this.formatValidationMessage(warn)}</div>
                    `).join('')}
                </div>
            `;
        }

        content.innerHTML = html;

        // Show continue button only if there are no errors (only warnings)
        if (result.errors.length === 0 && onContinue) {
            continueBtn.style.display = 'block';
            continueBtn.onclick = () => {
                this.closeValidationDialog();
                onContinue();
            };
        } else {
            continueBtn.style.display = 'none';
        }

        modal.classList.add('active');
    },

    closeValidationDialog(): void {
        document.getElementById('validation-modal')?.classList.remove('active');
    },

    formatValidationMessage(code: string): string {
        // Parse error code: type:detail1:detail2
        const parts = code.split(':');
        const type = parts[0];
        const detail = parts.slice(1).join(':');

        switch (type) {
            case 'parseError':
                return strings.validation.parseError;
            case 'invalidStructure':
                return strings.validation.invalidStructure;
            case 'missingPersons':
                return strings.validation.missingPersons;
            case 'missingPersonId':
            case 'missingFirstName':
            case 'missingLastName':
            case 'invalidGender':
                return `${strings.validation.missingField}: ${detail || type}`;
            case 'invalidParentRef':
            case 'invalidChildRef':
            case 'invalidPartnershipRef':
                return `${strings.validation.invalidReference}: ${detail}`;
            case 'missingHeader':
                return strings.validation.missingGedcomHeader;
            case 'noIndividuals':
                return strings.validation.noIndividuals;
            case 'invalidLine':
                return `${strings.validation.invalidLine}: ${detail}`;
            case 'noVersion':
                return strings.validation.noVersion;
            case 'olderVersion':
                return strings.validation.olderVersion?.replace('{0}', detail) || `Older version: ${detail}`;
            case 'newerVersion':
                return strings.validation.newerVersion?.replace('{0}', detail) || `Newer version: ${detail}`;
            default:
                return code;
        }
    },

    // ---- STRING INITIALIZATION ----
    initializeStrings(): void {
        // Helper to get nested property from strings object
        const getString = (path: string): string => {
            const parts = path.split('.');
            let value: unknown = strings;
            for (const part of parts) {
                if (value && typeof value === 'object' && part in value) {
                    value = (value as Record<string, unknown>)[part];
                } else {
                    console.warn(`String not found: ${path}`);
                    return path;
                }
            }
            return typeof value === 'string' ? value : path;
        };

        // Set text content for data-i18n elements
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = getString(key);
            }
        });

        // Set placeholder for data-i18n-placeholder elements
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key && el instanceof HTMLInputElement) {
                el.placeholder = getString(key);
            }
        });

        // Set title for data-i18n-title elements
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key && el instanceof HTMLElement) {
                el.title = getString(key);
            }
        });

        // Set aria-label for data-i18n-aria-label elements (icon-only buttons)
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria-label');
            if (key && el instanceof HTMLElement) {
                el.setAttribute('aria-label', getString(key));
            }
        });
    },

    /**
     * Public helper to get localized string
     */
    getString(path: string): string {
        const parts = path.split('.');
        let value: unknown = strings;
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = (value as Record<string, unknown>)[part];
            } else {
                return path;
            }
        }
        return typeof value === 'string' ? value : path;
    },

    // ---- TOAST NOTIFICATIONS ----
    /**
     * Show a toast notification
     */
    showToast(message: string, duration = 3000): void {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-hide
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // ---- UNDO / REDO ----
    /**
     * Undo the last data mutation of the active tree and re-render. Shows a
     * toast describing what was undone; silent when there is nothing to undo.
     */
    performUndo(): void {
        const result = DataManager.undo();
        if (!result) return;
        void TreeRenderer.renderAsync();
        // Undo can add/remove/rename people — the picker's cached list too.
        this.refreshSearch();
        this.showToast(strings.undo.undone(result.description));
    },

    /** Replay the last undone mutation. Symmetric to performUndo(). */
    performRedo(): void {
        const result = DataManager.redo();
        if (!result) return;
        void TreeRenderer.renderAsync();
        this.refreshSearch();
        this.showToast(strings.undo.redone(result.description));
    },

});
