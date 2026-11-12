/**
 * The start of a window by its role (spec 079 §0, §2, §5), the parts that do
 * not belong to the app's own start in main.ts:
 *
 * - main: the window's name, the registry of satellite windows (undo / redo
 *   as the app does them, links other windows pass on);
 * - satellite: its name and address, the client, launches of the installed
 *   app that reach it (passed on to the main window, never handled here);
 * - second tab: the screen that says the app is open elsewhere (S2 makes it whole).
 */

import { UI } from '../ui.js';
import { strings } from '../strings.js';
import { WindowBus } from './window-bus.js';
import { WindowRegistry, dataManagerHost } from './window-registry.js';
import { SatelliteClient } from './satellite.js';
import { MAIN_WINDOW_NAME, newWindowId, satelliteWindowName, type SatelliteParams } from './window-role.js';

/** The main window's registry (null in any other window). */
let registry: WindowRegistry | null = null;

export function getWindowRegistry(): WindowRegistry | null {
    return registry;
}

/** A launch handle as launchQueue gives it (a FileSystemFileHandle). */
interface FileHandleLike {
    getFile?: () => Promise<File>;
}

/** Open what another window passed on: an address of the research, files of the installed app. */
export function openForwardedLink(link: { search?: string; files?: unknown[] }): void {
    if (link.search) UI.openExternalRequest(new URLSearchParams(link.search));
    for (const handle of (link.files ?? []) as FileHandleLike[]) {
        if (!handle || typeof handle.getFile !== 'function') continue;
        void handle.getFile().then(
            (file) => UI.openGedcomFile(file),
            (err) => console.warn('Forwarded file unreadable', err),
        );
    }
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
    registry.setLinkHandler((link) => openForwardedLink(link));
    registry.start();
    return registry;
}

/** A launch as launchQueue hands it over. */
interface LaunchParamsLike {
    files?: ArrayLike<unknown>;
    targetURL?: string;
}

/**
 * Launches of the installed app that reach a satellite (the window last used):
 * the main window opens them; this one asks it to the front and says so. The
 * launch that opened this window (its own address) is not one.
 */
export function forwardLaunches(client: SatelliteClient, startSearch: string): void {
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
            client.forwardLink(link);
            void client.requestMainFocus();
            UI.showToast(strings.win.linkForwarded, 4000);
        });
    } catch (err) {
        console.warn('launchQueue unavailable', err);
    }
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
 * stored; only the screen saying so (its actions come with S2).
 */
export function showSecondTab(): void {
    const html = document.documentElement;
    html.classList.add('window-second-tab');
    html.classList.remove('app-booting', 'app-loading', 'external-opening');
    const main = document.createElement('main');
    main.className = 'second-tab';
    const card = document.createElement('div');
    card.className = 'second-tab-card';
    const title = document.createElement('h1');
    title.className = 'second-tab-title';
    title.textContent = strings.win.alreadyOpen;
    const note = document.createElement('p');
    note.className = 'second-tab-note';
    note.textContent = strings.win.alreadyOpenNote;
    card.append(title, note);
    main.append(card);
    document.body.append(main);
}
