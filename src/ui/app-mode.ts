/**
 * app mode UI methods (view mode, embedded mode, version compatibility,
 * cross-tree navigation, audit log). Extracted from the original UIClass;
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

export const appModeMethods = uiModule({
    // ---- EMBEDDED MODE INFO ----
    /**
     * Show embedded mode info dialog
     */
    showEmbeddedInfoDialog(): void {
        this.clearDialogStack();
        this.pushDialog('embedded-info-modal');
        document.getElementById('embedded-info-modal')?.classList.add('active');
    },

    /**
     * Close embedded mode info dialog
     */
    closeEmbeddedInfoDialog(): void {
        document.getElementById('embedded-info-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /**
     * Export JSON for transferring to online version
     */
    exportJsonForOnline(): void {
        const data = DataManager.exportJSON();
        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'strom-data.json';
        a.click();
        URL.revokeObjectURL(a.href);
        this.showToast(strings.buttons.exportComplete);
    },

    // ---- VIEW MODE ----
    /**
     * Check if in view mode (proxy to DataManager)
     */
    isViewMode(): boolean {
        return DataManager.isViewMode();
    },

    /**
     * Show the view mode banner
     */
    showViewModeBanner(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('view-mode');

        // Update go-online link with tree name
        this.updateViewModeGoOnlineLink();
    },

    /**
     * Update view mode go-online link with tree name
     */
    updateViewModeGoOnlineLink(): void {
        const treeName = DataManager.getCurrentEmbeddedTreeName();
        if (!treeName) return;

        const encodedName = encodeURIComponent(treeName);
        const url = `https://stromapp.info?import=from-file&name=${encodedName}`;

        const link = document.getElementById('view-mode-go-online');
        if (link) {
            link.setAttribute('href', url);
        }
    },

    /**
     * Hide the view mode banner
     */
    hideViewModeBanner(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.remove('visible');
        }
        document.body.classList.remove('view-mode');
    },

    /**
     * Show the existing export dialog (tree from this export already exists)
     */
    showExistingExportDialog(): void {
        const existingTree = DataManager.getExistingTreeFromExport();
        if (existingTree) {
            const nameEl = document.getElementById('existing-export-tree-name');
            if (nameEl) {
                nameEl.textContent = `"${existingTree.name}"`;
            }
        }
        document.getElementById('existing-export-modal')?.classList.add('active');
    },

    /**
     * Close existing export dialog
     */
    closeExistingExportDialog(): void {
        document.getElementById('existing-export-modal')?.classList.remove('active');
    },

    /**
     * View the stored version (switch to localStorage tree)
     */
    async viewStoredVersion(): Promise<void> {
        this.closeExistingExportDialog();
        await DataManager.switchToStoredVersion();
        this.hideViewModeBanner();
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * View the embedded version (stay in view mode)
     */
    async viewEmbeddedVersion(): Promise<void> {
        this.closeExistingExportDialog();
        // Already in view mode, just render
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Update stored version with embedded data
     */
    async updateStoredVersion(): Promise<void> {
        this.closeExistingExportDialog();
        DataManager.importFromViewMode('update');
        this.hideViewModeBanner();
        this.showToast(strings.viewMode.updateSuccess);
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Show the view mode import dialog (from view mode banner)
     */
    showViewModeImportDialog(): void {
        const envelope = DataManager.getEmbeddedEnvelope();
        if (envelope) {
            const nameEl = document.getElementById('import-tree-name');
            if (nameEl) {
                nameEl.textContent = `"${envelope.treeName}"`;
            }
        }
        document.getElementById('import-view-mode-modal')?.classList.add('active');
    },

    /**
     * Close import view mode dialog
     */
    closeImportViewModeDialog(): void {
        document.getElementById('import-view-mode-modal')?.classList.remove('active');
    },

    /**
     * Import embedded trees to storage (handles both single and multiple trees)
     * Always creates new trees, adds date suffix if name already exists
     */
    async importAsNew(): Promise<void> {
        this.closeImportViewModeDialog();
        this.closeExistingExportDialog();

        // Import all embedded trees (works for single tree too)
        const result = await DataManager.importAllEmbeddedTrees();
        this.hideViewModeBanner();

        if (result.imported > 1) {
            this.showToast(strings.viewMode.importAllSuccess(result.imported));
        } else {
            this.showToast(strings.viewMode.importSuccess);
        }

        this.updateTreeSwitcher();
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Import as copy
     */
    async importAsCopy(): Promise<void> {
        this.closeImportViewModeDialog();
        await DataManager.importFromViewMode('copy');
        this.hideViewModeBanner();
        this.showToast(strings.viewMode.importSuccess);
        this.updateTreeSwitcher();
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Initialize view mode UI based on DataManager state
     * Called after init to set up view mode banner if needed
     */
    initViewMode(): void {
        // First check for newer version data (embedded)
        if (DataManager.hasNewerVersionData()) {
            const source = DataManager.getNewerVersionSource();
            if (source === 'embedded') {
                this.showNewerVersionViewModeDialog();
            }
            return;
        }

        if (DataManager.isViewMode()) {
            // Check if import is blocked due to version
            if (DataManager.isImportBlocked()) {
                this.showViewModeBannerNoImport();
            } else {
                this.showViewModeBanner();
                // Update tree switcher to show embedded trees
                this.updateTreeSwitcher();
                // Collaboration surfaces (reply-merge offer / welcome screen)
                // sit on top of the regular view-mode banner.
                this.maybeShowShareSurface();
            }
        }
        // Local trees saved from a shared file show the collaboration bar.
        this.updateCollabBar();
    },

    // ---- VERSION COMPATIBILITY ----
    /**
     * Show newer version warning dialog for storage (blocking - no continue option)
     */
    async showNewerVersionStorageDialog(): Promise<void> {
        const check = await DataManager.checkStorageVersion();

        const yourVersionEl = document.getElementById('storage-your-version');
        const dataVersionEl = document.getElementById('storage-data-version');

        if (yourVersionEl) {
            yourVersionEl.textContent = String(check.currentVersion);
        }
        if (dataVersionEl) {
            dataVersionEl.textContent = String(check.dataVersion ?? '?');
        }

        document.getElementById('newer-version-storage-modal')?.classList.add('active');
    },

    /**
     * Show newer version warning dialog for view mode (allows viewing, blocks import)
     */
    showNewerVersionViewModeDialog(): void {
        const info = DataManager.getNewerVersionInfo();

        const yourVersionEl = document.getElementById('viewmode-your-version');
        const dataVersionEl = document.getElementById('viewmode-data-version');

        if (yourVersionEl) {
            yourVersionEl.textContent = String(info?.currentVersion ?? 1);
        }
        if (dataVersionEl) {
            dataVersionEl.textContent = String(info?.dataVersion ?? '?');
        }

        document.getElementById('newer-version-viewmode-modal')?.classList.add('active');
    },

    /**
     * Close newer version view mode dialog
     */
    closeNewerVersionViewMode(): void {
        document.getElementById('newer-version-viewmode-modal')?.classList.remove('active');
    },

    /**
     * Export storage data and close (for storage version mismatch)
     */
    exportStorageAndClose(): void {
        // Export all trees as JSON
        const trees = TreeManager.getTrees();
        const allData: Record<string, unknown> = {};

        for (const tree of trees) {
            const rawData = localStorage.getItem(`strom-tree-${tree.id}`);
            if (rawData) {
                try {
                    allData[tree.id] = {
                        name: tree.name,
                        data: JSON.parse(rawData)
                    };
                } catch {
                    // Skip invalid data
                }
            }
        }

        const dataStr = JSON.stringify(allData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'strom-backup-all-trees.json';
        a.click();
        URL.revokeObjectURL(a.href);

        // Don't close dialog - let user close the app/tab manually
    },

    /**
     * View newer version data in read-only mode (import will be blocked)
     */
    async viewNewerVersionData(): Promise<void> {
        document.getElementById('newer-version-viewmode-modal')?.classList.remove('active');
        DataManager.viewNewerVersionData();

        // Show view mode banner (without import button functional)
        this.showViewModeBannerNoImport();

        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    },

    /**
     * Show view mode banner with import disabled
     */
    showViewModeBannerNoImport(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('view-mode');

        // Disable import button
        const importBtn = document.getElementById('view-mode-import-btn');
        if (importBtn) {
            importBtn.setAttribute('disabled', 'true');
            importBtn.textContent = strings.validation.importBlocked;
            importBtn.onclick = () => {
                this.showAlert(strings.validation.importBlockedNewer, 'warning');
            };
        }
    },

    /**
     * Check storage version on startup
     * @returns true if OK to continue, false if blocked
     */
    async checkStorageVersionOnStartup(): Promise<boolean> {
        const check = await DataManager.checkStorageVersion();
        if (!check.compatible) {
            await this.showNewerVersionStorageDialog();
            return false;
        }
        return true;
    },

    /**
     * Check JSON version before import
     * @returns true if OK to import, false if blocked
     */
    checkJsonVersionBeforeImport(data: StromData): boolean {
        const check = DataManager.checkJsonVersion(data);
        if (!check.compatible) {
            const message = strings.validation.jsonNewerVersion
                .replace('%d', String(check.dataVersion))
                .replace('%d', String(check.currentVersion));
            this.showAlert(message, 'error');
            return false;
        }
        return true;
    },

    // ---- EMBEDDED MODE ----
    /**
     * Initialize embedded mode based on detected app mode
     */
    initEmbeddedMode(mode: AppMode): void {
        this.appMode = mode;

        if (mode === 'embedded') {
            this.showEmbeddedBanner();
            this.updateExportButtonForEmbedded();
            this.setupBeforeUnloadWarning();
        }
    },

    /**
     * Show the embedded mode banner
     */
    showEmbeddedBanner(): void {
        const banner = document.getElementById('embedded-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('embedded-mode');

        // Update go-online links with tree name parameter
        this.updateGoOnlineLinks();
    },

    /**
     * Update go-online links with current tree name in URL
     */
    updateGoOnlineLinks(): void {
        const metadata = TreeManager.getActiveTreeMetadata();
        const treeName = metadata?.name;
        if (!treeName) return;

        const encodedName = encodeURIComponent(treeName);
        const url = `https://stromapp.info?import=from-file&name=${encodedName}`;

        // Update banner link
        const bannerLink = document.getElementById('go-online-link');
        if (bannerLink) {
            bannerLink.setAttribute('href', url);
        }

        // Update info dialog link
        const infoLink = document.getElementById('embedded-info-go-online');
        if (infoLink) {
            infoLink.setAttribute('href', url);
        }
    },

    /**
     * Hide the embedded mode banner
     */
    hideEmbeddedBanner(): void {
        const banner = document.getElementById('embedded-mode-banner');
        if (banner) {
            banner.classList.remove('visible');
        }
        // Keep embedded-mode class on body for potential other UI adjustments
    },

    /**
     * Update export button text/title for embedded mode
     */
    updateExportButtonForEmbedded(): void {
        // Update toolbar export button title
        const exportBtn = document.querySelector('.toolbar-buttons .menu-btn[onclick*="showExportMenu"]');
        if (exportBtn) {
            exportBtn.setAttribute('title', strings.embeddedMode.saveFileTitle);
        }
    },

    /**
     * Setup beforeunload warning for embedded mode
     */
    setupBeforeUnloadWarning(): void {
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = strings.embeddedMode.unsavedWarning;
                return e.returnValue;
            }
        });
    },

    /**
     * Mark that data has changed (call after any data modification)
     */
    markDataChanged(): void {
        this.lastChangeTime = Date.now();
    },

    /**
     * Mark that data was exported (call after successful export)
     */
    markExported(): void {
        this.lastExportTime = Date.now();
    },

    /**
     * Check if there are unsaved changes since last export
     */
    hasUnsavedChanges(): boolean {
        return this.lastChangeTime > this.lastExportTime;
    },

    /**
     * Get current app mode
     */
    getAppMode(): AppMode {
        return this.appMode;
    },

    // ---- CROSS-TREE NAVIGATION ----
    /**
     * Switch to another tree and focus on a specific person
     * Used for cross-tree link navigation
     */
    async switchToTreeAndFocus(treeId: TreeId, personId: PersonId): Promise<void> {
        // Reset cross-tree navigation index when switching trees
        CrossTree.resetNavigationIndex();

        // Switch to the target tree
        if (await DataManager.switchTree(treeId)) {
            // Update UI to reflect tree switch
            this.updateTreeSwitcher();

            // Re-render the tree
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();

            // Focus on the person
            TreeRenderer.setFocus(personId, false);

            // Center view on the person
            ZoomPan.centerOnPerson(personId);
        }
    },

    // ---- AUDIT LOG ----
    toggleAuditLog(enabled: boolean): void {
        AuditLogManager.setEnabled(enabled);
        const status = document.getElementById('audit-log-status');
        if (status) {
            status.textContent = enabled
                ? strings.auditLog.enabled
                : strings.auditLog.disabled;
        }
    },

    toggleSuggestDuplicates(enabled: boolean): void {
        SettingsManager.setSuggestDuplicates(enabled);
    },

    toggleMinimap(enabled: boolean): void {
        SettingsManager.setMinimap(enabled);
        this.updateMinimap();
    },

    toggleOnThisDay(enabled: boolean): void {
        SettingsManager.setOnThisDay(enabled);
        if (!enabled) this.dismissOnThisDay();
    },

    showAuditLogDialog(treeId?: TreeId | string, parentDialogId?: string): void {
        const modal = document.getElementById('audit-log-modal');
        if (!modal) return;

        const targetTreeId = (treeId || DataManager.getCurrentTreeId()) as TreeId;
        if (!targetTreeId) return;

        // Store target tree id for clear action
        modal.dataset.treeId = targetTreeId;

        // Set tree name in header
        const titleEl = modal.querySelector('.audit-log-title-text');
        const treeMeta = TreeManager.getTreeMetadata(targetTreeId);
        if (titleEl && treeMeta) {
            titleEl.textContent = `${strings.auditLog.title} — ${treeMeta.name}`;
        }

        this.renderAuditLogEntries(targetTreeId);

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('audit-log-modal');
        modal.classList.add('active');
    },

    async renderAuditLogEntries(treeId: TreeId): Promise<void> {
        const listEl = document.getElementById('audit-log-list');
        if (!listEl) return;

        const log = await AuditLogManager.load(treeId);

        if (log.entries.length === 0) {
            listEl.innerHTML = `<div class="audit-log-empty">${strings.auditLog.empty}</div>`;
            const countEl = document.getElementById('audit-log-count');
            if (countEl) countEl.textContent = strings.auditLog.entries(0);
            return;
        }

        const countEl = document.getElementById('audit-log-count');
        if (countEl) countEl.textContent = strings.auditLog.entries(log.entries.length);

        // Render newest first
        const entries = [...log.entries].reverse();
        let html = '';
        for (const entry of entries) {
            const date = new Date(entry.t);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Icon based on action type
            let icon = '+';
            if (entry.a.includes('update')) icon = '✎';
            else if (entry.a.includes('delete') || entry.a.includes('remove')) icon = '−';
            else if (entry.a.includes('merge')) icon = '⇄';
            else if (entry.a === 'data.clear') icon = '!';
            else if (entry.a === 'data.load' || entry.a === 'data.import') icon = '↓';

            html += `
                <div class="audit-log-entry">
                    <span class="audit-log-time">${this.escapeHtml(timeStr)}</span>
                    <span class="audit-log-icon">${icon}</span>
                    <span class="audit-log-desc">${this.escapeHtml(entry.d)}</span>
                </div>
            `;
        }

        listEl.innerHTML = html;
    },

    closeAuditLogDialog(): void {
        document.getElementById('audit-log-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    async exportAuditLogTxt(): Promise<void> {
        const modal = document.getElementById('audit-log-modal');
        const treeId = modal?.dataset.treeId as TreeId;
        if (!treeId) return;

        const log = await AuditLogManager.load(treeId);
        if (log.entries.length === 0) return;

        const treeMeta = TreeManager.getTreeMetadata(treeId);
        const treeName = treeMeta?.name || 'tree';

        const lines: string[] = [];
        lines.push(`${strings.auditLog.title} — ${treeName}`);
        lines.push(`${strings.auditLog.entries(log.entries.length)}`);
        lines.push('');

        // Chronological order (oldest first) for TXT export
        for (const entry of log.entries) {
            const date = new Date(entry.t);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            lines.push(`${timeStr}  ${entry.d}`);
        }

        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${treeName.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async clearAuditLog(): Promise<void> {
        const modal = document.getElementById('audit-log-modal');
        const treeId = modal?.dataset.treeId as TreeId;
        if (!treeId) return;

        const confirmed = await this.showConfirm(strings.auditLog.clearConfirm);
        if (!confirmed) return;

        await AuditLogManager.clear(treeId);
        this.renderAuditLogEntries(treeId);  // async, fire and forget
    },
});
