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
import { initModalSkeleton } from './ui/modal-skeleton.js';
import { DebugOptions, DebugStep, DebugPhase } from './layout/pipeline/debug-types.js';
import { CryptoSession } from './crypto.js';
import { AppMode, PWA_HOSTNAME, APP_VERSION, TreeId } from './types.js';
import { strings } from './strings.js';
import { onTreeSavedElsewhere } from './tab-sync.js';
import { StorageManager } from './storage.js';
import { PERSISTENCE_EVENT, PersistenceState, getRequestedPersistenceState } from './persistence.js';
import { SNAPSHOTS_TRIMMED_EVENT, SnapshotTrim } from './snapshots.js';
import { shouldRegisterServiceWorker, registerServiceWorker, linkManifest, isBetaBuild } from './pwa.js';

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

/**
 * Sync the `?tree=` URL parameter with the current tree (refresh persistence
 * and bookmarking). Drops the parameter when there is no tree to name.
 */
function syncUrlTreeParam(): void {
    const currentTreeId = DataManager.getCurrentTreeId();
    const url = new URL(window.location.href);
    const currentUrlSlug = url.searchParams.get('tree');
    const treeSlug = currentTreeId ? TreeManager.getTreeSlug(currentTreeId) : null;
    if (treeSlug) {
        // Only update if slug changed
        if (currentUrlSlug === treeSlug) return;
        url.searchParams.set('tree', treeSlug);
    } else {
        if (currentUrlSlug === null || DataManager.isViewMode()) return;
        url.searchParams.delete('tree');
    }
    history.replaceState(null, '', url.toString());
}

/** Listeners every startup path needs — including the locked ones (V3). */
function registerAppListeners(): void {
    // Listen for data changes (e.g., after import)
    window.addEventListener('strom:data-changed', () => {
        // Locked ↔ readable flips with every tree (re)load: sync the
        // read-only gating before the render reads it.
        UI.syncLockedState();
        TreeRenderer.render();
        UI.refreshSearch();
        // Track changes for embedded mode unsaved warning
        UI.markDataChanged();
    });

    // Listen for tree switches
    window.addEventListener('strom:tree-switched', () => {
        UI.updateTreeSwitcher();
        UI.updateCollabBar();
        void UI.updateFileIndicator();
        // A warning about another tab belongs to the tree it was raised for.
        document.getElementById('other-tab-notice')?.remove();
    });

    // Persistence failures (quota, locked session) must reach the user —
    // they used to be swallowed rejections with memory/disk divergence.
    window.addEventListener('strom:save-failed', () => {
        UI.showToast(UI.getString('errors.saveFailed'), 6000);
    });

    // Backups removed for space: say so (once per tree and day).
    window.addEventListener(SNAPSHOTS_TRIMMED_EVENT, (e) => {
        UI.handleSnapshotsTrimmed((e as CustomEvent<SnapshotTrim>).detail);
    });

    // A tree that could not be decrypted is never saved over (K8).
    window.addEventListener('strom:save-blocked', () => {
        UI.showToast(strings.storageSafety.saveBlocked, 6000);
    });
    window.addEventListener('strom:tree-unreadable', (e) => {
        // Locked session → Unlock banner; unlocked but another key → ask for
        // that tree's password and re-encrypt it (K8).
        UI.handleUnreadableTree((e as CustomEvent<{ treeId?: TreeId }>).detail?.treeId);
        UI.syncLockedState();
    });

    // Another tab saved the tree open here: warn and offer a reload — this
    // tab's next save would silently overwrite that work (V6).
    onTreeSavedElsewhere((treeId) => {
        if (DataManager.isViewMode() || treeId !== DataManager.getCurrentTreeId()) return;
        UI.showStorageNotice('other-tab-notice', strings.storageSafety.otherTabSaved, {
            label: strings.storageSafety.reload,
            run: () => window.location.reload(),
        });
    });

    // A locked start is read-only from the first paint (no add/edit entry
    // points behind the password prompt).
    UI.syncLockedState();
}

/** IndexedDB could not be opened: say so instead of a blank page (S22). */
function showStartupError(err: unknown): void {
    console.error('Startup failed', err);
    void UI.showAlert(strings.storageSafety.storageInitFailed, 'error');
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    // Opening a research from outside (?import-url= / ?live=): keep the canvas
    // blank until that tree is in, instead of flashing the last-opened tree.
    // Cleared by UI.initExternalOpen when the open settles (with a safety net).
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.has('import-url') || params.has('live')) {
            document.documentElement.classList.add('external-opening');
            setTimeout(() => document.documentElement.classList.remove('external-opening'), 20000);
        }
    } catch { /* no URLSearchParams: nothing to hide */ }

    // Initialize settings (theme) early for smooth loading
    SettingsManager.init();

    // Initialize audit log (reads enabled state from settings)
    AuditLogManager.init();

    // Initialize UI strings from strings.ts
    UI.initializeStrings();

    // Unify all dialogs onto the flex skeleton (fixed header + scrolling body +
    // fixed actions) and watch for dynamically inserted modals.
    initModalSkeleton();

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

    // Storage connection problems (registered before init: onblocked can
    // fire while the database is opening).
    window.addEventListener('strom:storage-blocked', () => {
        UI.showStorageNotice('storage-blocked-notice', strings.storageSafety.storageBlocked);
    });
    window.addEventListener('strom:storage-closed', () => {
        UI.showStorageNotice('storage-closed-notice', strings.storageSafety.storageClosed, {
            label: strings.storageSafety.reload,
            run: () => window.location.reload(),
        });
    });

    try {
        // Initialize IndexedDB
        await StorageManager.init();

        // Initialize data (includes TreeManager initialization)
        await DataManager.init();

        // Check for tree ID in URL - if specified and valid, switch to it
        const urlTreeId = getTreeIdFromUrl();
        if (urlTreeId && DataManager.getCurrentTreeId() !== urlTreeId) {
            await DataManager.switchTree(urlTreeId as any);
        }
    } catch (err) {
        showStartupError(err);
        return;
    }
    document.getElementById('storage-blocked-notice')?.remove();

    // ---- Shell: everything that does not need readable data ----

    // Initialize zoom/pan
    ZoomPan.init();

    // Overview minimap (wires ZoomPan.onChange + canvas handlers)
    UI.initMinimap();

    // Sticky generation labels (wires ZoomPan.onChange + resize)
    UI.initGenLabels();

    // Set up TreeRenderer getter for ZoomPan (for centering on reset)
    setTreeRendererGetter(() => TreeRenderer);

    // CSS :has() fallback for older Safari (toast stacking). No-op elsewhere.
    UI.initHasFallback();

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

    // Listeners (save failures, tree switches, other tabs) — before any
    // password prompt, so a locked start never saves silently (V3).
    registerAppListeners();

    // PWA: offline indicator always; register the service worker only on the
    // hosted PWA (never in embedded/file:// exports or dev).
    UI.initOnlineIndicator();
    if (shouldRegisterServiceWorker(APP_MODE)) {
        linkManifest();
        registerServiceWorker(() => UI.showUpdateAvailable());
    }
    // The pre-release test build (/beta/) says so next to the wordmark.
    if (isBetaBuild(APP_MODE)) {
        const logo = document.querySelector('.app-wordmark');
        if (logo && !logo.querySelector('.beta-badge')) {
            const badge = document.createElement('span');
            badge.className = 'beta-badge';
            badge.textContent = strings.about.betaBadge;
            badge.title = strings.about.betaTitle;
            logo.appendChild(badge);
        }
    }

    // File System Access (reveal controls if supported; sync the file indicator).
    UI.initFileAccess();

    // A .ged dropped anywhere onto the window opens it (no-op without drag and drop).
    UI.initFileDrop();

    // Initialize embedded mode UI (for file:// or non-PWA domains)
    UI.initEmbeddedMode(APP_MODE);

    // Strom Research in the app: welcome-screen offer + menu item gating.
    UI.initResearchPromo();


    // ---- Data: runs once the data is readable ----

    /** URL parameters and idle extras after the first real render. */
    const afterFirstRender = (): void => {
        // Handle URL search parameter after render (may override fitToScreen)
        handleUrlSearchParam();

        // Opening from outside: ?import-url= / ?live= (Strom Research on this
        // computer) and the installed app's file handler (launchQueue). Reads
        // its parameters before handleUrlImportParam may clear the address.
        UI.initExternalOpen();

        // Handle URL import parameter (from offline version redirect)
        handleUrlImportParam();

        // Sync URL with current tree slug (for refresh persistence and bookmarking)
        syncUrlTreeParam();

        // Strom Research: light the "New" marker, maybe the one-time 3.0 card.
        UI.researchPromoAfterFirstRender();

        // Persistent storage: a one-time notice when the browser may clear a
        // big tree — for a request settled during startup, and for later ones.
        const settled = getRequestedPersistenceState();
        if (settled) UI.maybeWarnNotPersistent(settled);
        window.addEventListener(PERSISTENCE_EVENT, (e) => {
            UI.maybeWarnNotPersistent((e as CustomEvent<PersistenceState>).detail);
        });

        // "On this day" reminder — after the first render, off the critical path.
        const showOtd = () => UI.maybeShowOnThisDay();
        if ('requestIdleCallback' in window) {
            (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(showOtd);
        } else {
            setTimeout(showOtd, 800);
        }
    };

    let dataInitDone = false;
    const finishDataInit = async (): Promise<void> => {
        dataInitDone = true;

        // A tree that already cites sources belongs to someone who uses the
        // research fields — keep them visible for that user (one-time default).
        SettingsManager.defaultAdvancedFieldsFromData(DataManager.getData());

        // Check storage version compatibility (for non-embedded data) — after
        // unlocking too, so an older build never migrates newer data (V3).
        if (!hasEmbeddedData) {
            if (!await UI.checkStorageVersionOnStartup()) {
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

        // Restore focus based on tree's defaultPersonId setting
        if (!hasEmbeddedData || !DataManager.isViewMode()) {
            // Normal app: use tree's defaultPersonId setting (first person, last focused, or specific)
            TreeRenderer.restoreFromSession();
        }
        // For view mode with embedded data: use data as-is (no saved focus state)

        // Initial render
        await TreeRenderer.renderAsync();

        // Center on focused person with context on initial load
        ZoomPan.centerOnFocusWithContext();

        afterFirstRender();
    };

    // Local data unlocked (startup prompt, the "Unlock" banner, or before an
    // import): reload the tree now readable, then run the data init once.
    UI.onLocalDataUnlocked = async () => {
        if (!DataManager.isViewMode()) {
            await DataManager.reloadCurrentTree();
            const treeId = DataManager.getCurrentTreeId();
            if (treeId) await AuditLogManager.loadForTree(treeId);
        }
        if (!dataInitDone) {
            await finishDataInit();
            return;
        }
        // Viewing an embedded file: unlocking only prepares a later import.
        if (DataManager.isViewMode()) return;
        TreeRenderer.restoreFromSession();
        await TreeRenderer.renderAsync();
        ZoomPan.centerOnFocusWithContext();
    };

    // Reconcile the encryption FLAG (localStorage) with what actually sits
    // on disk (IndexedDB): browsers can evict them independently, and a lost
    // flag used to skip the password prompt, load the tree as silently EMPTY
    // and let a subsequent save overwrite the ciphertext (audit K4).
    if (!SettingsManager.isEncryptionEnabled() && await TreeManager.hasEncryptedTrees()) {
        SettingsManager.setEncryption(true);
    }

    // Encrypted embedded file: its password decrypts only this file, with a
    // key of its own — the local session key is never replaced (K8).
    if (DataManager.hasPendingEncryptedData()) {
        UI.showEmbeddedPasswordPrompt(async () => {
            dataInitDone = true;
            // Initialize view mode UI if needed
            UI.initViewMode();

            // Restore focus and render
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();
            ZoomPan.centerOnFocusWithContext();
            afterFirstRender();
        });
        console.log(`Strom v${APP_VERSION} initialized (awaiting file password)`);
        return;
    }

    // Encrypted local data: prompt; the data init runs after unlocking.
    // Cancelling leaves an "Unlock" banner (V3). A plain embedded file is
    // shown right away — the local password is asked for only when the
    // file is saved into local storage (ensureLocalUnlocked).
    const showingEmbedded = DataManager.isViewMode() || DataManager.hasNewerVersionData();
    if (!showingEmbedded && SettingsManager.isEncryptionEnabled() && !CryptoSession.isUnlocked()
        && await TreeManager.hasEncryptedTrees()) {
        void UI.showLocalUnlockPrompt(async () => {
            await UI.onLocalDataUnlocked?.();
        });
        console.log(`Strom v${APP_VERSION} initialized (locked)`);
        return;
    }

    await finishDataInit();

    console.log(`Strom v${APP_VERSION} initialized`);
});
