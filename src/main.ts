/**
 * Strom - Family Tree Application
 * Main entry point
 */

import { DataManager } from './data.js';
import { TreeManager } from './tree-manager.js';
import { TreeRenderer } from './renderer.js';
import { UI } from './ui.js';
import { ZoomPan, setTreeRendererGetter } from './zoom.js';
import { AppExporter } from './export.js';
import { MergerUI } from './merge/index.js';
import { SettingsManager } from './settings.js';
import { AuditLogManager } from './audit-log.js';
import { TreePreview, TreeCompare } from './tree-preview.js';
import { DebugOptions, DebugStep, DebugPhase } from './layout/pipeline/debug-types.js';
import { decrypt, CryptoSession } from './crypto.js';
import { StromData, AppMode, PWA_HOSTNAME } from './types.js';

// Make modules available globally for HTML event handlers
declare global {
    interface Window {
        Strom: {
            DataManager: typeof DataManager;
            TreeManager: typeof TreeManager;
            TreeRenderer: typeof TreeRenderer;
            UI: typeof UI;
            ZoomPan: typeof ZoomPan;
            AppExporter: typeof AppExporter;
            MergerUI: typeof MergerUI;
            SettingsManager: typeof SettingsManager;
            TreePreview: typeof TreePreview;
            TreeCompare: typeof TreeCompare;
        };
    }
}

/**
 * Detect application mode based on hostname/protocol
 */
function detectAppMode(): AppMode {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // Dev server (localhost)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'dev';
    }

    // PWA on stromapp.info (or stromapp.local for testing)
    if (hostname === PWA_HOSTNAME || hostname === 'stromapp.local') {
        return 'pwa';
    }

    // file:// protocol or other domain = embedded HTML file
    if (protocol === 'file:') {
        return 'embedded';
    }

    // Other domains (e.g., testing on different server) - treat as embedded
    return 'embedded';
}

/** Current application mode */
export const APP_MODE = detectAppMode();

/**
 * Parse debug options from URL query parameters.
 * Usage: ?debug=1&step=5 or ?debug=1&step=6&phase=A
 */
function parseDebugOptions(): DebugOptions {
    const params = new URLSearchParams(window.location.search);
    const debugParam = params.get('debug');
    const stepParam = params.get('step');
    const phaseParam = params.get('phase');

    const enabled = debugParam === '1' || debugParam === 'true';

    let step: DebugStep = 8; // Default to full pipeline
    if (stepParam) {
        const parsed = parseInt(stepParam, 10);
        if (parsed >= 1 && parsed <= 8) {
            step = parsed as DebugStep;
        }
    }

    // Parse phase parameter (only relevant for step 6)
    let phase: DebugPhase | undefined;
    if (phaseParam && ['A', 'B'].includes(phaseParam.toUpperCase())) {
        phase = phaseParam.toUpperCase() as DebugPhase;
    }

    return { enabled, step, phase };
}

/**
 * Get tree ID from URL parameter (by tree slug)
 * @returns tree ID or null if not found
 */
function getTreeIdFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    const treeSlug = params.get('tree');
    if (!treeSlug) return null;

    // Find tree by slug
    const tree = TreeManager.getTreeBySlug(treeSlug);
    return tree?.id || null;
}

/**
 * Handle URL search parameter
 * Searches for person and focuses/highlights them
 */
function handleUrlSearchParam(): void {
    const params = new URLSearchParams(window.location.search);
    const searchQuery = params.get('search');

    if (searchQuery) {
        const results = DataManager.searchPersons(searchQuery);
        UI.handleSearchResults(results, searchQuery);
    }
}

/**
 * Handle URL import parameter
 * Shows new tree menu when coming from offline version
 * @returns true if import dialog was shown
 */
function handleUrlImportParam(): boolean {
    const params = new URLSearchParams(window.location.search);

    if (params.get('import') === 'from-file') {
        // Clear URL parameters
        history.replaceState(null, '', window.location.pathname);

        // Show new tree menu with intro text explaining the situation
        UI.showNewTreeMenu(true);
        return true;
    }
    return false;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings (theme) early for smooth loading
    SettingsManager.init();

    // Initialize audit log (reads enabled state from settings)
    AuditLogManager.init();

    // Initialize UI strings from strings.ts
    UI.initializeStrings();

    // Expose modules globally early (needed for password prompt buttons)
    window.Strom = {
        DataManager,
        TreeManager,
        TreeRenderer,
        UI,
        ZoomPan,
        AppExporter,
        MergerUI,
        SettingsManager,
        TreePreview,
        TreeCompare
    };

    // Parse debug options from URL
    const debugOptions = parseDebugOptions();

    // Check if we have embedded data (from exported HTML)
    const hasEmbeddedData = !!(window as Window & { STROM_EMBEDDED_DATA?: unknown }).STROM_EMBEDDED_DATA;

    // Initialize data (includes TreeManager initialization)
    DataManager.init();

    // Check for tree ID in URL - if specified and valid, switch to it
    const urlTreeId = getTreeIdFromUrl();
    if (urlTreeId && DataManager.getCurrentTreeId() !== urlTreeId) {
        DataManager.switchTree(urlTreeId as any);
    }

    // Initialize zoom/pan
    ZoomPan.init();

    // Set up TreeRenderer getter for ZoomPan (for centering on reset)
    setTreeRendererGetter(() => TreeRenderer);

    // Initialize keyboard shortcuts
    UI.initKeyboard();

    // Initialize search
    UI.initSearch();

    // Initialize tree switcher
    UI.initTreeSwitcher();

    // Set debug options before rendering
    if (debugOptions.enabled) {
        TreeRenderer.setDebugOptions(debugOptions);
    }

    // Check for encrypted embedded data that needs password
    if (DataManager.hasPendingEncryptedData()) {
        const encryptedData = DataManager.getPendingEncryptedData();
        if (encryptedData) {
            // Set pending data for password validation
            UI.setPendingEncryptedData(encryptedData);

            // Show password prompt
            UI.showPasswordPrompt(async (password: string) => {
                try {
                    // Decrypt the data
                    const decryptedStr = await decrypt(encryptedData, password);
                    const decryptedData = JSON.parse(decryptedStr) as StromData;

                    // Unlock session with this password
                    const salt = new Uint8Array(atob(encryptedData.salt).split('').map(c => c.charCodeAt(0)));
                    await CryptoSession.unlock(password, salt);

                    // Load the decrypted data (this now handles view mode)
                    DataManager.loadDecryptedEmbeddedData(decryptedData);

                    // Initialize view mode UI if needed
                    UI.initViewMode();

                    // Restore focus and render
                    TreeRenderer.restoreFromSession();
                    TreeRenderer.render();
                    setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
                } catch {
                    UI.showAlert(UI.getString('encryption.decryptionFailed'), 'error');
                }
            });

            // Don't render yet - wait for password
            return;
        }
    }

    // Check for encrypted localStorage data that needs password
    if (SettingsManager.isEncryptionEnabled() && TreeManager.hasEncryptedTrees()) {
        const encryptedData = TreeManager.getFirstEncryptedData();
        if (encryptedData) {
            // Set pending data for password validation
            UI.setPendingEncryptedData(encryptedData);

            // Show password prompt
            UI.showPasswordPrompt(async (password: string) => {
                try {
                    // Verify password by decrypting
                    await decrypt(encryptedData, password);

                    // Unlock session with this password
                    const salt = new Uint8Array(atob(encryptedData.salt).split('').map(c => c.charCodeAt(0)));
                    await CryptoSession.unlock(password, salt);

                    // Now we can load the data - re-init DataManager to load decrypted data
                    await DataManager.reloadCurrentTree();

                    // Restore focus and render
                    TreeRenderer.restoreFromSession();
                    TreeRenderer.render();
                    setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
                } catch {
                    UI.showAlert(UI.getString('encryption.decryptionFailed'), 'error');
                }
            });

            // Don't render yet - wait for password
            return;
        }
    }

    // Check storage version compatibility (for non-embedded data)
    if (!hasEmbeddedData) {
        if (!UI.checkStorageVersionOnStartup()) {
            // Newer version detected in storage - dialog shown, stop here
            return;
        }
    }

    // Initialize view mode UI if we have embedded data
    if (hasEmbeddedData) {
        UI.initViewMode();
        // If newer version dialog is shown, stop here
        if (DataManager.hasNewerVersionData()) {
            return;
        }
    }

    // Initialize embedded mode UI (for file:// or non-PWA domains)
    UI.initEmbeddedMode(APP_MODE);

    // Restore focus based on tree's defaultPersonId setting
    if (!hasEmbeddedData || !DataManager.isViewMode()) {
        // Normal app: use tree's defaultPersonId setting (first person, last focused, or specific)
        TreeRenderer.restoreFromSession();
    }
    // For view mode with embedded data: use data as-is (no saved focus state)

    // Initial render
    TreeRenderer.render();

    // Center on focused person with context on initial load (with delay for DOM)
    setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);

    // Handle URL search parameter after render (may override fitToScreen)
    handleUrlSearchParam();

    // Handle URL import parameter (from offline version redirect)
    handleUrlImportParam();

    // Sync URL with current tree slug (for refresh persistence and bookmarking)
    const currentTreeId = DataManager.getCurrentTreeId();
    if (currentTreeId) {
        const treeSlug = TreeManager.getTreeSlug(currentTreeId);
        if (treeSlug) {
            const url = new URL(window.location.href);
            const currentUrlSlug = url.searchParams.get('tree');
            // Only update if slug changed
            if (currentUrlSlug !== treeSlug) {
                url.searchParams.set('tree', treeSlug);
                history.replaceState(null, '', url.toString());
            }
        }
    }

    // Listen for data changes (e.g., after import)
    window.addEventListener('strom:data-changed', () => {
        TreeRenderer.render();
        UI.refreshSearch();
        // Track changes for embedded mode unsaved warning
        UI.markDataChanged();
    });

    // Listen for tree switches
    window.addEventListener('strom:tree-switched', () => {
        UI.updateTreeSwitcher();
    });

    console.log('Strom v1.0 initialized');
});
