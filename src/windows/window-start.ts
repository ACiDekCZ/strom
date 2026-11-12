/**
 * The start of a window by its role (spec 079 §0, §2, §5), the parts that do
 * not belong to the app's own start in main.ts:
 *
 * - main: the window's name, the registry of satellite windows (undo / redo
 *   as the app does them, links other windows pass on);
 * - satellite: its name and address, the client, launches of the installed
 *   app that reach it (passed on to the main window, never handled here);
 * - second tab: the screen that says the app is open elsewhere, its link and
 *   launches passed on to the main window (second-tab.ts).
 */

import { UI } from '../ui.js';
import { strings } from '../strings.js';
import { WindowBus } from './window-bus.js';
import { WindowRegistry, dataManagerHost } from './window-registry.js';
import { SatelliteClient } from './satellite.js';
import { MAIN_WINDOW_NAME, newWindowId, satelliteViewMode, satelliteWindowName, tryBecomeMain, type SatelliteParams } from './window-role.js';
import { becomeMain, writeBecomeMainMark } from './become-main.js';
import { recordReloadPoint } from '../resume-view.js';
import { openForwardedLink, type ForwardedLink, type LinkOpenerDeps } from './window-link.js';
import { SecondTab, renderSecondTab, removeSecondTabScreen } from './second-tab.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { PERSON_MENU_ACTION, runSatelliteResearchRow, SatelliteResearchMenu, setSatelliteResearchMenu } from './window-research-menu.js';
import type { PersonId } from '../types.js';
import { wireMainSelection, wireSatelliteSelection, type SelectionDeps } from './window-selection.js';
import { SettingsManager } from '../settings.js';
import type { MapKind } from '../places.js';
import type { SatelliteKind } from './window-role.js';
import {
    applyViewStateAfterDraw, applyViewStateBeforeDraw, captureViewState, parseViewState,
    type ViewStateSource, type ViewStateTarget, type ViewWindowState,
} from './view-window-state.js';

/** The main window's registry (null in any other window). */
let registry: WindowRegistry | null = null;

export function getWindowRegistry(): WindowRegistry | null {
    return registry;
}

/** A launch handle as launchQueue gives it (a FileSystemFileHandle). */
interface FileHandleLike {
    getFile?: () => Promise<File>;
}

/** How the main window opens a link: the handlers its own start uses (main.ts, research-ui, deep links). */
const appLinkOpener: LinkOpenerDeps = {
    currentTree: () => {
        const id = DataManager.getCurrentTreeId();
        if (!id) return null;
        return { id, researchId: TreeManager.getTreeMetadata(id)?.research?.id ?? null };
    },
    pickTree: (params) => {
        const tree = TreeManager.getTreeFromUrl(params);
        return tree ? { id: tree.id, researchId: tree.research?.id ?? null } : null;
    },
    switchTree: (treeId) => UI.switchToTree(treeId),
    externalRequest: (params) => UI.openExternalRequest(params),
    search: (query) => UI.handleSearchResults(DataManager.searchPersons(query), query),
    deepLink: (link, matches) => UI.openDeepLink(link, matches),
    openFile: (handle) => {
        const h = handle as FileHandleLike | null;
        if (!h || typeof h.getFile !== 'function') return;
        void h.getFile().then(
            (file) => UI.openGedcomFile(file),
            (err) => console.warn('Forwarded file unreadable', err),
        );
    },
};

/** Open what another window passed on: an address (a person, a search, the research's requests), files of the installed app. */
export function openLinkFromWindow(link: ForwardedLink): Promise<void> {
    return openForwardedLink(link, appLinkOpener).catch((err) => console.warn('Forwarded link not opened', err));
}

/**
 * The main window opens links of other windows from now on (after its first
 * render, as its own address's): those that came before are opened now.
 */
export function openLinksFromOtherWindows(): void {
    registry?.setLinkHandler((link) => { void openLinkFromWindow(link); });
}

/** The main window: its name (other windows find it by it) and the registry of satellites. */
export function startMainWindow(): WindowRegistry {
    try { window.name = MAIN_WINDOW_NAME; } catch { /* not settable */ }
    registry = new WindowRegistry({
        bus: new WindowBus(newWindowId()),
        host: dataManagerHost({
            // As the app's own Undo: the drawing, the toolbar and the toast follow.
            undo: () => UI.performUndo(),
            redo: () => UI.performRedo(),
        }),
    });
    registry.start();
    wireMainSelection(registry, selectionDeps());
    // The person menu's research rows of a satellite (§2, 2g): listed and run here, as this window's own menu.
    const researchItems = (personId: string) => (DataManager.getPerson(personId as PersonId) ? UI.personResearchMenuItems(personId as PersonId) : null);
    registry.setResearchMenuProvider((personId) => researchItems(personId) ?? []);
    registry.setResearchActionHandler((action, args) => {
        if (action !== PERSON_MENU_ACTION) return;
        runSatelliteResearchRow(args, { items: researchItems, run: (personId, a) => UI.runPersonMenuAction(personId as PersonId, a) });
    });
    return registry;
}

/** The app's side of the shared selection (spec 079 §2). */
function selectionDeps(): SelectionDeps {
    return {
        viewMode: () => TreeRenderer.getViewMode(),
        setTableSelectionShare: (share) => UI.setTableSelectionShare(share),
        tableSharedSelect: (id) => UI.tableSharedSelect(id),
        setWindowSelected: (id) => TreeRenderer.setWindowSelected(id),
        glideTo: (id) => { ZoomPan.glideToPerson(id); },
    };
}

/** A satellite's side of the shared selection (spec 079 §2). */
export function startSatelliteSelection(client: SatelliteClient): void {
    wireSatelliteSelection(client, selectionDeps());
    // The person menu's research rows come from the main window and run there (§2, 2g).
    setSatelliteResearchMenu(new SatelliteResearchMenu(client));
}

/** A launch as launchQueue hands it over. */
interface LaunchParamsLike {
    files?: ArrayLike<unknown>;
    targetURL?: string;
}

/**
 * Launches of the installed app that reach a window which does not open them
 * (a satellite, a second tab): `forward` passes each to the main window. The
 * launch that opened this window (its own address) is not one.
 */
export function forwardLaunches(forward: (link: ForwardedLink) => void, startSearch: string): void {
    const lq = (window as unknown as { launchQueue?: { setConsumer?: (consumer: (params: LaunchParamsLike) => void) => void } }).launchQueue;
    if (!lq || typeof lq.setConsumer !== 'function') return;
    let startupSeen = false;
    try {
        lq.setConsumer((params) => {
            let search = '';
            if (typeof params?.targetURL === 'string') {
                try { search = new URL(params.targetURL).search; } catch { /* not a URL */ }
            }
            const files = params?.files ? Array.from(params.files) : [];
            const isStartup = !startupSeen && search === startSearch;
            startupSeen = true;
            const link = { ...(search && !isStartup ? { search } : {}), ...(files.length ? { files } : {}) };
            if (!link.search && !link.files) return;
            forward(link);
        });
    } catch (err) {
        console.warn('launchQueue unavailable', err);
    }
}

/** A satellite's launches: the main window opens them; it is asked to the front and this window says so. */
export function forwardSatelliteLaunches(client: SatelliteClient, startSearch: string): void {
    forwardLaunches((link) => {
        client.forwardLink(link);
        void client.requestMainFocus();
        UI.showToast(strings.win.linkForwarded, 4000);
    }, startSearch);
}

/**
 * A satellite window: its name, its id written into the address (a reload
 * keeps it), and the client that gets the tree from the main window.
 */
export function startSatelliteClient(params: SatelliteParams): SatelliteClient {
    try { window.name = satelliteWindowName(params.windowId); } catch { /* not settable */ }
    if (params.newId) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('w', params.windowId);
            history.replaceState(null, '', url.toString());
        } catch { /* the address stays */ }
    }
    return new SatelliteClient(params);
}

/**
 * Another tab while the main window is open (§5): nothing is loaded or
 * stored; the screen saying so, its link and launches passed on to the main
 * window. "Open as another window" removes the screen and `startSatellite`
 * starts the app as a satellite here (no reload).
 */
export function showSecondTab(startSatellite: (params: SatelliteParams) => void): SecondTab {
    const startSearch = window.location.search;
    const tab = new SecondTab({
        becomeSatellite: (params) => {
            removeSecondTabScreen();
            startSatellite(params);
        },
        // The main window closed (§5): this tab starts as the main window, with the link it did not pass on.
        becomeMain: (search) => becomeMain({
            tryLock: () => tryBecomeMain(),
            prepare: () => prepareMainStart({ tree: null, search }),
            restart: () => window.location.reload(),
        }),
    });
    tab.start();
    renderSecondTab(tab);
    forwardLaunches((link) => tab.forwardLink(link), startSearch);
    return tab;
}

/**
 * What a window writes before it starts again as the main window (§3.3, §5):
 * the mark (the new page tries again for the lock a moment), the reload point
 * and the Table's state of a satellite, its address without `okno=`.
 */
function prepareMainStart(opts: { tree: string | null; search?: string | null; table?: unknown }): void {
    writeBecomeMainMark({ tree: opts.tree, ...(opts.table !== undefined ? { table: opts.table } : {}), at: Date.now() });
    try {
        const url = new URL(window.location.href);
        if (opts.search) url.search = opts.search;
        else url.search = opts.tree ? `?tree=${encodeURIComponent(opts.tree)}` : '';
        url.hash = '';
        history.replaceState(null, '', url.toString());
    } catch { /* the address stays */ }
}

/**
 * "Make this the main window" in a satellite (§3.3): the lock taken (another
 * window has it: nothing happens), then the window starts again as the main
 * one — its tree from storage (the saved state, newer than this copy may be),
 * its view (the reload point) and the Table's state kept. The opener's live
 * session copied into this window is not its own and goes.
 */
export function makeSatelliteMain(client: SatelliteClient, kind: SatelliteParams['kind']): Promise<boolean> {
    return becomeMain({
        tryLock: () => tryBecomeMain(),
        prepare: () => {
            const tree = client.treeId;
            const view = satelliteViewMode(kind);
            // The reload point needs a person: the focus, else the first one of the tree (the Table keeps its own row).
            const person = TreeRenderer.getFocusPersonId() ?? DataManager.getAllPersons().find(p => !p.isPlaceholder)?.id ?? null;
            if (tree && person) recordReloadPoint({ tree, person, view });
            try { sessionStorage.removeItem('strom.live'); } catch { /* no storage */ }
            prepareMainStart({ tree, table: view === 'table' ? UI.tableWindowState() : undefined });
        },
        restart: () => window.location.reload(),
    });
}

/**
 * "Open Strom" in a satellite whose main window closed (§3.3): a new main
 * window at the app's own address (its path kept: a file opened from disk,
 * /strom.html), without this window's session (`noopener`).
 */
export function openMainWindow(): void {
    let href = './';
    try {
        const url = new URL(window.location.href);
        url.search = '';
        url.hash = '';
        href = url.toString();
    } catch { /* the folder */ }
    try { window.open(href, MAIN_WINDOW_NAME, 'noopener'); } catch (err) { console.warn('Main window not opened', err); }
}

// ---- the state a new window of a view takes over (spec 079 §1) ----

/** The main window's views, as a new window of a view takes them over. */
const appViewStateSource: ViewStateSource = {
    viewMode: () => TreeRenderer.getViewMode(),
    focus: () => TreeRenderer.getFocusPersonId(),
    tableFocus: () => UI.tableFocusPerson(TreeRenderer.getFocusPersonId()),
    windowSelected: () => TreeRenderer.getWindowSelected(),
    depthUp: () => TreeRenderer.getFocusDepthUp(),
    depthDown: () => TreeRenderer.getFocusDepthDown(),
    chartZoom: () => {
        const view = TreeRenderer.getViewMode();
        if (view !== 'family' && view !== 'descendants') return null;
        const { width, height } = ZoomPan.getViewportSize();
        if (!width || !height) return null;
        const middle = ZoomPan.viewCenterWorld();
        return { scale: ZoomPan.getScale(), x: middle.x, y: middle.y };
    },
    fullFamilies: () => TreeRenderer.isDescendantsFullFamilies(),
    fan: () => ({
        generations: TreeRenderer.getFanGenerations(),
        descGenerations: TreeRenderer.getFanDescGenerations(),
        shape: TreeRenderer.getFanShape(),
        colorMode: TreeRenderer.getFanColorMode(),
    }),
    map: () => ({
        scope: UI.mapScope,
        center: UI.mapCenter ? { lat: UI.mapCenter.lat, lon: UI.mapCenter.lon } : null,
        zoom: UI.mapZoom,
        kinds: SettingsManager.getMapKinds(),
        time: { on: UI.mapTimeOn, year: UI.mapTimeYear },
    }),
};

/** A satellite's views, as they take the main window's state over (nothing stored). */
const appViewStateTarget: ViewStateTarget = {
    hasPerson: (id) => !!DataManager.getPerson(id) && !DataManager.getPerson(id)?.isPlaceholder,
    setFocus: (id, up, down) => TreeRenderer.setWindowStart(id, up, down),
    setWindowSelected: (id) => TreeRenderer.setWindowSelected(id),
    setFullFamilies: (on) => TreeRenderer.setDescendantsFullFamilies(on),
    setFan: (fan) => TreeRenderer.setWindowFan(fan),
    setMap: (m) => {
        UI.mapScope = m.scope;
        UI.mapCenter = m.center ? { lat: m.center.lat, lon: m.center.lon } : null;
        UI.mapZoom = m.zoom;
        // The kinds are this device's: the same here unless changed meanwhile (a satellite keeps them in its memory).
        const kinds = m.kinds as MapKind[];
        if (kinds.length && kinds.join() !== SettingsManager.getMapKinds().join()) SettingsManager.setMapKinds(kinds);
        UI.mapTimeOn = m.time.on;
        UI.mapTimeYear = m.time.year;
    },
    restoreZoom: (zoom) => ZoomPan.restoreView(zoom.scale, zoom.x, zoom.y),
    centerView: () => TreeRenderer.centerForViewMode(),
};

/**
 * The starting state a new window of `kind` gets from this window (§1 "What
 * is carried over"; the main window's ⧉ and a satellite's alike).
 */
export function windowStartState(kind: SatelliteKind): unknown {
    if (kind !== 'table') return captureAppViewState(kind);
    const state = UI.tableWindowState();
    // From another view: the person selected here is the selected row there.
    if (TreeRenderer.getViewMode() !== 'table' && state.rowType === 'persons') {
        const focus = TreeRenderer.getFocusPersonId();
        if (focus) state.selected = `p:${focus}`;
    }
    return state;
}

/** The main window's state of its views for a new window of `kind` (undefined: the Table's is table-ui's). */
export function captureAppViewState(kind: SatelliteKind): ViewWindowState | undefined {
    return captureViewState(kind, appViewStateSource);
}

/**
 * A satellite of a view: the state the main window sent (`init`, before the
 * tree) is applied at its first tree, after the tree's default person was
 * chosen and before the drawing (the returned function, called there); after
 * the drawing Family and Descendants take the zoom and middle, or centre as
 * they would on their own (also at another tree, a reload of the window).
 */
export function wireSatelliteViewStart(client: SatelliteClient): () => void {
    let start: ViewWindowState | null = null;
    let applied = false;
    let drawnTree: string | null = null;
    client.on('init', ({ kind, state }) => {
        if (!applied && drawnTree === null) start = parseViewState(kind, state);
    });
    client.on('tree', ({ treeId }) => {
        if (treeId === drawnTree) return;
        drawnTree = treeId;
        const state = applied ? start : null;
        start = null;
        // Only the charts frame themselves after drawing (the Table, the fan, the timeline and the map do it while drawing).
        const view = TreeRenderer.getViewMode();
        if (view !== 'family' && view !== 'descendants') return;
        void TreeRenderer.renderAsync().then(() => applyViewStateAfterDraw(state, TreeRenderer.getViewMode(), appViewStateTarget));
    });
    return () => {
        if (applied || drawnTree !== null || !start) return;
        applied = true;
        // The main window switched trees meanwhile: its state was another tree's.
        if (client.requestedTreeId && DataManager.getCurrentTreeId() !== client.requestedTreeId) { start = null; return; }
        applyViewStateBeforeDraw(start, appViewStateTarget);
    };
}
