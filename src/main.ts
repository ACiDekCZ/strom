/**
 * Strom - Family Tree Application
 * Main entry point
 */

import { DataManager, DataChangedDetail } from './data.js';
import { TreeManager } from './tree-manager.js';
import { TreeRenderer } from './renderer.js';
import { UI } from './ui.js';
import { ZoomPan, setTreeRendererGetter } from './zoom.js';
import { installCardTapTarget } from './card-tap.js';
import { AppExporter } from './export.js';
import { MergerUI } from './merge/index.js';
import { SettingsManager } from './settings.js';
import { AuditLogManager } from './audit-log.js';
import { TreePreview, TreeCompare } from './tree-preview.js';
import { initModalSkeleton } from './ui/modal-skeleton.js';
import { setHelpResearchVersion, setHelpTour } from './ui/help-ui.js';
import { activeResearchId } from './ui/history-ui.js';
import { initToolbarFit } from './ui/toolbar-fit.js';
import { DebugOptions, DebugStep, DebugPhase } from './layout/pipeline/debug-types.js';
import { CryptoSession } from './crypto.js';
import { AppMode, APP_VERSION, TreeId } from './types.js';
import { strings } from './strings.js';
import { onTreeSavedElsewhere } from './tab-sync.js';
import { StorageManager } from './storage.js';
import { PERSISTENCE_EVENT } from './persistence.js';
import { FILE_COPY_EVENT, RESEARCH_BASE_EVENT } from './tree-manager.js';
import { SNAPSHOTS_TRIMMED_EVENT, SNAPSHOT_CREATED_EVENT, SnapshotTrim } from './snapshots.js';
import { collectPoolGarbage } from './media-pool.js';
import { keepLifelineChipsFor } from './lifeline-view.js';
import { parseDeepLink, deepLinkTreeMatches, stripDeepLinkParams } from './deep-link.js';
import { shouldRegisterServiceWorker, registerServiceWorker, linkManifest, isBetaBuild, appModeFor, captureInstallPrompt, INSTALL_AVAILABILITY_EVENT, isSafariOnComputer, safariAppName } from './pwa.js';
import { decideWindowRole, getWindowRole, setWindowRole, satelliteViewMode, type SatelliteParams } from './windows/window-role.js';
import { startMainWindow, startSatelliteClient, forwardLaunches, showSecondTab } from './windows/window-start.js';
import { windowTitle } from './windows/window-title.js';
import type { SatelliteClient } from './windows/satellite.js';

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
 * Detect application mode based on hostname (see appModeFor in pwa.ts)
 */
function detectAppMode(): AppMode {
    return appModeFor(window.location.hostname);
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
 * Get tree ID from URL parameters (`?research=` UUID, else the tree slug)
 * @returns tree ID or null if not found
 */
function getTreeIdFromUrl(): string | null {
    const tree = TreeManager.getTreeFromUrl(new URLSearchParams(window.location.search));
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
    // `?research=` only picks the startup tree; the slug names it from then on.
    // So do `person` / `show` (a link from outside, handled once: src/deep-link.ts).
    const hadResearch = stripDeepLinkParams(url) || url.searchParams.has('research');
    url.searchParams.delete('research');
    if (treeSlug) {
        // Only update if slug changed
        if (currentUrlSlug === treeSlug && !hadResearch) return;
        url.searchParams.set('tree', treeSlug);
    } else {
        if ((currentUrlSlug === null && !hadResearch) || DataManager.isViewMode()) return;
        url.searchParams.delete('tree');
    }
    history.replaceState(null, '', url.toString());
}

/** Listeners every startup path needs — including the locked ones (V3). */
function registerAppListeners(): void {
    // Listen for data changes (e.g., after import)
    window.addEventListener('strom:data-changed', (e) => {
        // The card timeline's chips change the open tree's default for a while only (K4.5): another tree, its default.
        keepLifelineChipsFor(DataManager.getCurrentTreeId());
        // Locked ↔ readable flips with every tree (re)load: sync the
        // read-only gating before the render reads it.
        UI.syncLockedState();
        UI.syncNewerDataState();
        // A live load from the research's source: the tree goes over without a flash (spec 055).
        const detail = (e as CustomEvent<DataChangedDetail | undefined>).detail;
        if (detail?.source === 'live') void TreeRenderer.renderLive(detail.previous);
        else TreeRenderer.render();
        UI.refreshSearch();
        // Track changes for embedded mode unsaved warning
        UI.markDataChanged();
    });

    // Listen for tree switches
    window.addEventListener('strom:tree-switched', () => {
        UI.updateTreeSwitcher();
        UI.updateCollabBar();
        void UI.updateFileIndicator();
        void UI.refreshUnsavedIndicator();
        // A warning about another tab belongs to the tree it was raised for.
        document.getElementById('other-tab-notice')?.remove();
        // So does "on this day": the new tree gets its own (once a day).
        UI.dismissOnThisDay();
        void UI.maybeShowOnThisDay();
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
    window.addEventListener(SNAPSHOT_CREATED_EVENT, (e) => {
        UI.handleSnapshotCreated((e as CustomEvent<{ treeId: string }>).detail.treeId);
    });

    // A tree that could not be decrypted is never saved over (K8).
    window.addEventListener('strom:save-blocked', () => {
        UI.showToast(strings.storageSafety.saveBlocked, 6000);
    });
    // A tree saved by a newer app, opened by switching or reloaded: it is
    // read-only here, with the bar saying so (prod 3.17 N1, then "1a").
    window.addEventListener('strom:newer-data', () => UI.syncNewerDataState());
    // A write a newer app's tree refused (a path the read-only UI does not
    // close, e.g. a tree updated in the background): said once per tree.
    const newerNotSaved = new Set<string>();
    window.addEventListener('strom:save-newer', (e) => {
        const treeId = (e as CustomEvent<{ treeId?: string }>).detail?.treeId;
        if (!treeId || newerNotSaved.has(treeId)) return;
        newerNotSaved.add(treeId);
        UI.showToast(strings.storageSafety.newerNotSaved, 8000, { closable: true, notice: true, kind: 'newer-data' });
    });
    window.addEventListener('strom:tree-unreadable', (e) => {
        // Locked session → Unlock banner; unlocked but another key → ask for
        // that tree's password and re-encrypt it (K8).
        UI.handleUnreadableTree((e as CustomEvent<{ treeId?: TreeId }>).detail?.treeId);
        UI.syncLockedState();
    });

    // Another tab saved the tree open here: warn and offer a reload — this
    // tab's next save would silently overwrite that work (V6).
    // A tree's research base changed (loaded from the research, undone): its
    // data are stored again with it, in one transaction.
    window.addEventListener(RESEARCH_BASE_EVENT, (e) => {
        const treeId = (e as CustomEvent<{ treeId: string }>).detail?.treeId;
        if (treeId && treeId === DataManager.getCurrentTreeId()) DataManager.resaveCurrent();
    });

    // This window's copy is older than the stored one: an edit here was
    // not written over it. Say so plainly, every time, with the reload.
    window.addEventListener('strom:save-stale', (e) => {
        const treeId = (e as CustomEvent<{ treeId?: string }>).detail?.treeId;
        if (!treeId || treeId !== DataManager.getCurrentTreeId()) return;
        document.getElementById('other-tab-notice')?.remove();
        UI.showStorageNotice('other-tab-notice', strings.storageSafety.otherTabNotSaved, {
            label: strings.storageSafety.reload,
            run: () => window.location.reload(),
        });
    });

    // A satellite window's tree is the main window's: its saves are this window's data coming in.
    if (getWindowRole() !== 'satellite') onTreeSavedElsewhere((treeId) => {
        if (DataManager.isViewMode() || treeId !== DataManager.getCurrentTreeId()) return;
        // What this window holds is kept as a backup, once: another window — an older app too, which
        // knows no stale-copy guard — may have saved over this window's saved work (N2).
        void DataManager.snapshotOtherWindow(treeId as TreeId);
        // A research tree says it too: nothing of this copy is sent until a reload.
        UI.refreshResearchSyncUi();
        UI.showStorageNotice('other-tab-notice', strings.storageSafety.otherTabSaved, {
            label: strings.storageSafety.reload,
            run: () => window.location.reload(),
        });
    });

    // A locked start is read-only from the first paint (no add/edit entry
    // points behind the password prompt).
    UI.syncLockedState();
}

/** The satellite's client (null in any other window). */
let satelliteClient: SatelliteClient | null = null;
let satelliteKind: SatelliteParams['kind'] | null = null;

/** The window's title by its role, its tree (and a satellite's view); again at every switch or rename. */
function updateWindowTitle(): void {
    const role = getWindowRole();
    let treeName = '';
    if (role === 'satellite') {
        treeName = satelliteClient?.hasTree ? satelliteClient.treeName : '';
    } else if (role === 'main') {
        // An empty tree (the first start's) is no tree yet: the app's name alone.
        const id = DataManager.getCurrentTreeId();
        let hasPeople = false;
        for (const _ in DataManager.getData().persons) { hasPeople = true; break; }
        treeName = id && hasPeople ? TreeManager.getTreeMetadata(id)?.name ?? '' : '';
    }
    document.title = windowTitle({ role, kind: satelliteKind, treeName, beta: isBetaBuild(APP_MODE) });
}

/**
 * A satellite window (spec 079 §2): the view of the main window's tree. No
 * storage is read or written here — no tree, no tree index, no settings, no
 * last view or reload point; the research, links from outside, the welcome
 * and "What's new" are the main window's. The tree comes with the client's
 * first `tree` message; until then the view stays empty.
 */
function startSatelliteWindow(params: SatelliteParams, debugOptions: DebugOptions): void {
    document.documentElement.classList.add('window-satellite');
    satelliteKind = params.kind;
    TreeRenderer.setWindowView(satelliteViewMode(params.kind));
    const client = startSatelliteClient(params);
    satelliteClient = client;

    // The shell (as in the main window, without the tree switcher, files, research and the app's offers).
    ZoomPan.init();
    installCardTapTarget();
    UI.installStatusTipHost();
    UI.initMinimap();
    UI.initGenLabels();
    setTreeRendererGetter(() => TreeRenderer);
    UI.initHasFallback();
    UI.initKeyboard();
    UI.initSearch();
    UI.initHistoryManage();
    if (debugOptions.enabled) TreeRenderer.setDebugOptions(debugOptions);

    // Another tree (the first one, a switch in the main window): its default person, before the drawing below.
    let shownTree: TreeId | null = null;
    window.addEventListener('strom:data-changed', () => {
        const treeId = DataManager.getCurrentTreeId();
        if (treeId === shownTree) return;
        shownTree = treeId;
        TreeRenderer.restoreFromSession();
    });
    registerAppListeners();
    UI.initOnlineIndicator();

    // The settings are the main window's: what it stores shows here too.
    SettingsManager.watchOtherWindows(({ languageBefore }) => {
        if (SettingsManager.getLanguage() !== languageBefore) UI.setLanguage(SettingsManager.getLanguage());
        else TreeRenderer.render();
        updateWindowTitle();
    });

    client.on('tree', () => {
        document.documentElement.classList.remove('app-loading');
        updateWindowTitle();
    });
    client.on('tree-gone', () => updateWindowTitle());
    // Whether anything may be edited here follows the connection and the main window's status (§3).
    let readOnly = client.readOnly();
    const followReadOnly = (): void => {
        if (client.readOnly() === readOnly) return;
        readOnly = client.readOnly();
        UI.syncLockedState();
        if (client.hasTree) TreeRenderer.render();
    };
    client.on('status', followReadOnly);
    client.on('connection', followReadOnly);
    client.start();
    forwardLaunches(client, window.location.search);
    updateWindowTitle();
    console.log(`Strom v${APP_VERSION} initialized (window ${params.windowId})`);
}

/** IndexedDB could not be opened: say so instead of a blank page (S22). */
function showStartupError(err: unknown): void {
    console.error('Startup failed', err);
    document.documentElement.classList.remove('app-booting', 'app-loading');
    void UI.showAlert(strings.storageSafety.storageInitFailed, 'error');
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    // The welcome stays hidden until the first render (renderer.ts); a safety
    // net in case startup stops short of one (a password prompt left open).
    setTimeout(() => document.documentElement.classList.remove('app-booting'), 10000);

    // Check if we have embedded data (from exported HTML)
    const hasEmbeddedData = !!(window as Window & { STROM_EMBEDDED_DATA?: unknown }).STROM_EMBEDDED_DATA;

    // The window's role, before anything is read or stored (spec 079 §0): a
    // satellite and a second tab never write the settings, the tree index or a tree.
    const role = await decideWindowRole({ embedded: hasEmbeddedData });
    setWindowRole(role.role);
    const satellite = role.role === 'satellite' ? role.satellite ?? null : null;
    if (role.role === 'satellite' || role.role === 'second-tab') SettingsManager.setReadOnly(true);
    if (role.role === 'second-tab') {
        SettingsManager.init();
        showSecondTab();
        console.log(`Strom v${APP_VERSION}: open in another window`);
        return;
    }

    // Opening a research from outside (?import-url= / ?live=): keep the canvas
    // blank until that tree is in, instead of flashing the last-opened tree.
    // Cleared by UI.initExternalOpen when the open settles (with a safety net).
    // A satellite opens nothing from outside (its copy of the opener's session is not its own).
    if (!satellite) try {
        const params = new URLSearchParams(window.location.search);
        let resumingLive = false;
        try {
            resumingLive = !!sessionStorage.getItem('strom.live');
        } catch { /* no storage */ }
        if (params.has('import-url') || params.has('live') || resumingLive) {
            document.documentElement.classList.add('external-opening');
            setTimeout(() => document.documentElement.classList.remove('external-opening'), 20000);
        }
    } catch { /* no URLSearchParams: nothing to hide */ }

    // Initialize settings (theme) early for smooth loading
    SettingsManager.init();

    // Initialize audit log (reads enabled state from settings). A satellite
    // keeps none: the main window logs the edits it saves for it.
    if (!satellite) AuditLogManager.init();

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

    if (satellite) {
        startSatelliteWindow(satellite, debugOptions);
        return;
    }

    // A link beyond the tree (?person= / ?show=waiting): read before anything rewrites the address.
    const startParams = new URLSearchParams(window.location.search);
    const startDeepLink = parseDeepLink(startParams);

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
    // The main window: the satellites get their tree from here (spec 079 §0).
    if (role.role === 'main') startMainWindow();
    // Its title names the open tree, as switched or renamed.
    updateWindowTitle();
    if (role.role === 'main') {
        window.addEventListener('strom:tree-switched', updateWindowTitle);
        window.addEventListener('strom:tree-renamed', updateWindowTitle);
        window.addEventListener('strom:data-changed', updateWindowTitle);
    }
    // "What's new": whether this browser held trees before anything can be added.
    UI.captureReleaseNotesStart();
    // "How Strom works" compares a rule's version with the research connected to the tree.
    setHelpResearchVersion(() => {
        const rid = activeResearchId();
        return rid ? UI.researchBridgeVersion(rid) : '';
    });
    // Its contents start the app tour.
    setHelpTour(() => UI.startTour());
    // The startup tree is in memory: editing may begin (see .app-loading).
    document.documentElement.classList.remove('app-loading');
    document.getElementById('storage-blocked-notice')?.remove();

    // ---- Shell: everything that does not need readable data ----

    // Initialize zoom/pan
    ZoomPan.init();
    // A touch tap on a card beside its edge pills stays the card's
    installCardTapTarget();
    // The status tip of every reliability pill and card mark
    UI.installStatusTipHost();

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

    // "History of places": its static dialog's handlers
    UI.initHistoryManage();

    // The add button folds to ＋ where the desktop toolbar does not fit its labels
    initToolbarFit();

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
        const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
        linkManifest(isSafariOnComputer(nav.userAgent || '', nav.platform || '', nav.maxTouchPoints ?? 0, nav.userAgentData?.brands?.map(b => b.brand))
            ? safariAppName(isBetaBuild(APP_MODE)) : null);
        captureInstallPrompt();
        registerServiceWorker(() => UI.showUpdateAvailable());
    }
    // The pre-release test build (/beta/) says so next to the wordmark.
    if (isBetaBuild(APP_MODE)) {
        // The window title says "Strom Beta" too (as the installed app's name): updateWindowTitle.
        // The phone's More sheet shows "BETA · version" by About (no badge room there).
        document.body.classList.add('beta-build');
        const logo = document.querySelector('.app-wordmark');
        if (logo && !logo.querySelector('.beta-badge')) {
            const badge = document.createElement('span');
            badge.className = 'beta-badge';
            badge.textContent = strings.about.betaBadge;
            badge.title = strings.about.betaTitle;
            // Right after the name, before the unsaved-changes indicator.
            logo.querySelector('.app-logo')?.after(badge);
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

    // History in the life timeline (on by default): bridge statuses, tree switches.
    UI.initHistoryLayer();
    UI.initQualityBridge();
    UI.initResearchFixes();
    UI.initVerifyPerson();
    UI.initSurnameSuggest();

    // Linked in the view only: the live bridge's say, other windows' changes of the shown links.
    UI.initViewLinks();

    // The family line chosen in the tree view (spec 039): remembered per tree.
    UI.initRodView();


    // ---- Data: runs once the data is readable ----

    /** URL parameters and idle extras after the first real render. */
    const afterFirstRender = (): void => {
        // Handle URL search parameter after render (may override fitToScreen)
        handleUrlSearchParam();

        // Opening from outside: ?import-url= / ?live= (Strom Research on this
        // computer) and the installed app's file handler (launchQueue). Reads
        // its parameters before handleUrlImportParam may clear the address.
        UI.initExternalOpen();
        // Where a research tree stands with its research (a research that says so).
        UI.initResearchSync();
        // The other research trees' state (switcher marks, "Elsewhere" in the panel).
        UI.initOtherResearch();
        // The switches "Research on" of the research trees (spec 064).
        UI.initResearchLive();
        // Originals waiting for a research (their state lines).
        void UI.initOriginalsQueue();
        // The family's materials from the research (cards' counts, the person's section).
        UI.initMaterials();
        // A tree downloaded in Safari to move to another browser for the research: its banner.
        UI.initResearchTransferBanner();
        // A private window: its trees go when it closes (said once).
        void UI.initPrivateWindowNotice();

        // Handle URL import parameter (from offline version redirect)
        handleUrlImportParam();

        // Sync URL with current tree slug (for refresh persistence and bookmarking)
        syncUrlTreeParam();

        // A link to a person or to "Waiting for you" (the macOS widget, spec 019 U4).
        if (startDeepLink && !hasEmbeddedData) {
            const currentId = DataManager.getCurrentTreeId();
            const current = currentId ? TreeManager.getTreeMetadata(currentId) : null;
            const matches = deepLinkTreeMatches(
                startParams,
                current ? { id: current.id, researchId: current.research?.id ?? null } : null,
                TreeManager.getTreeFromUrl(startParams),
            );
            void UI.openDeepLink(startDeepLink, matches);
        }

        // Strom Research: light the "New" marker, maybe the one-time 3.0 card.
        UI.researchPromoAfterFirstRender();

        // "What's new" at the first start of a new version, once the app is free.
        UI.initReleaseNotes();

        // Where the data is: the "changes only in the browser" indicator, and
        // the notice at an edit no file holds (src/file-copy.ts).
        void UI.refreshUnsavedIndicator();
        window.addEventListener(PERSISTENCE_EVENT, () => { void UI.refreshUnsavedIndicator(); });
        window.addEventListener(FILE_COPY_EVENT, (e) => {
            void UI.handleFileCopyChange((e as CustomEvent<{ treeId: string }>).detail.treeId);
        });
        window.addEventListener(INSTALL_AVAILABILITY_EVENT, () => {
            if (document.getElementById('storage-status-modal')?.classList.contains('active')) {
                void UI.refreshStorageStatusDialog();
            }
        });

        // "On this day" reminder — after the first render, off the critical path.
        const showOtd = () => { void UI.maybeShowOnThisDay(); };
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

        // A tree a newer app saved opens read-only, never written (also
        // after unlocking: an older build never migrates newer data, V3).
        if (!hasEmbeddedData) UI.syncNewerDataState();

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

        // A tree merge interrupted mid-review (reload, crash) is offered back.
        if (!DataManager.isViewMode()) void UI.checkPendingMerges();
    };

    // Local data unlocked (startup prompt, the "Unlock" banner, or before an
    // import): reload the tree now readable, then run the data init once.
    UI.onLocalDataUnlocked = async () => {
        if (!DataManager.isViewMode()) {
            await DataManager.reloadCurrentTree();
            const treeId = DataManager.getCurrentTreeId();
            if (treeId) await AuditLogManager.loadForTree(treeId);
            // The history layer's device copy is encrypted too: read it again now.
            void UI.reloadHistoryAfterUnlock();
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
    // Pooled images no stored tree or backup names any more (an image removed
    // from a tree stays in the pool until a cleanup). Off the startup path.
    setTimeout(() => { void collectPoolGarbage(); }, 30_000);

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
