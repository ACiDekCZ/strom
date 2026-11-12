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
import { MAIN_WINDOW_NAME, newWindowId, satelliteWindowName, type SatelliteParams } from './window-role.js';
import { openForwardedLink, type ForwardedLink, type LinkOpenerDeps } from './window-link.js';
import { SecondTab, renderSecondTab, removeSecondTabScreen } from './second-tab.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { PERSON_MENU_ACTION, runSatelliteResearchRow, SatelliteResearchMenu, setSatelliteResearchMenu } from './window-research-menu.js';
import type { PersonId } from '../types.js';
import { wireMainSelection, wireSatelliteSelection, type SelectionDeps } from './window-selection.js';

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
    });
    tab.start();
    renderSecondTab(tab);
    forwardLaunches((link) => tab.forwardLink(link), startSearch);
    return tab;
}
