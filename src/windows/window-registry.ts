/**
 * The main window's side of the app's windows (spec 079 §0, §4): the list of
 * satellite windows, the window revision of the open tree, and the messages
 * that keep every satellite's copy of the tree in step.
 *
 * Window revision: a number of the open tree that only the main window
 * raises — on every change of it (an edit here or from a satellite, undo,
 * redo, a load from the research, unlocking, a switch to another tree). A
 * satellite's edit names the revision it was made on; another revision means
 * the tree changed meanwhile and the edit is refused (§3.4). The revision is
 * read from the tree's state itself (its id, its data object, the data's
 * content revision, the lock), so no change can slip past it; saves and data
 * events only make it be read at once. A save that changes no content (the
 * last focus, the default person) raises nothing: no edit is refused for it.
 */

import { publishImageSource, WindowImageStore } from './window-images.js';
import { DataManager } from '../data.js';
import { IMAGES_ARRIVED_EVENT } from '../image-loads.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId } from '../types.js';
import { WindowBus, answerWhenFocused, FOCUS_WAIT_MS, type MessageOf, type WindowBounds, type WindowStatus, type EditRefusal } from './window-bus.js';
import { newWindowId, satelliteUrl, satelliteWindowName, type SatelliteKind } from './window-role.js';
import { parseAgentFollow, type AgentFollow } from './agent-follow-state.js';

/** What the registry needs of the main window (DataManager's by default; a test passes its own). */
export interface MainWindowHost {
    treeId(): TreeId | null;
    treeName(treeId: TreeId): string;
    treeExists(treeId: TreeId): boolean;
    /** The open tree as stored, as a JSON-shaped object for the channel to clone (never one string of the whole tree). */
    storedData(): unknown;
    /** Values that change whenever the open tree changes (compared item by item, by identity). */
    stateStamp(): readonly unknown[];
    /** Save a satellite's edit as an edit of this window (one undo step named `label`). */
    /** `listsOnly`: the edit changed only the lists of people (N2): only those are taken. */
    applyEdit(json: string, label: string, listsOnly?: boolean): boolean;
    /** A staged dialog is open here: no edit from outside now. */
    busy(): boolean;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    live(): boolean;
    locked(): boolean;
    readOnly(): boolean;
    /** The lists of people may be changed (also while readOnly because the tree follows a research, N2). */
    listsOpen?(): boolean;
    /** Undo / redo would be refused now (DataManager.undoLocked: a list's step goes while following, N2). */
    undoLocked?(which: 'undo' | 'redo'): boolean;
    researchState(): unknown;
    /** Subscribe to every save of the open tree; returns the unsubscribe. */
    onSaved(cb: () => void): () => void;
    focusSelf(): void;
    hasFocus(): boolean;
    /** The person in the centre and its generations (sent with the tree: where a satellite without a state starts); null: none. */
    focus?(): { personId: string; depthUp: number; depthDown: number } | null;
    /** This window follows the research agent now (spec 097 §4, not paused): the status says it (spec 110 §4). */
    followingAgent?(): boolean;
}

/** The main window as DataManager and TreeManager have it. */
export function dataManagerHost(overrides: Partial<MainWindowHost> = {}): MainWindowHost {
    const changed = () => {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    };
    return {
        treeId: () => DataManager.getCurrentTreeId(),
        treeName: (id) => TreeManager.getTrees().find(t => t.id === id)?.name ?? '',
        treeExists: (id) => TreeManager.getTrees().some(t => t.id === id),
        storedData: () => DataManager.storedWindowData(),
        stateStamp: () => [DataManager.getCurrentTreeId(), DataManager.getData(), DataManager.getContentRevision(), DataManager.isLocked()],
        applyEdit: (json, label, listsOnly) => DataManager.applyWindowEdit(json, label, listsOnly),
        busy: () => DataManager.isEditSessionActive(),
        undo: () => { if (DataManager.undo()) changed(); },
        redo: () => { if (DataManager.redo()) changed(); },
        canUndo: () => DataManager.canUndo(),
        canRedo: () => DataManager.canRedo(),
        live: () => DataManager.isLiveFollowing(),
        locked: () => DataManager.isLocked(),
        readOnly: () => DataManager.isReadOnly() || DataManager.isTreeLocked(),
        listsOpen: () => !DataManager.listsReadOnly(),
        undoLocked: (which) => DataManager.undoLocked(which),
        researchState: () => null,
        onSaved: (cb) => DataManager.onTreeSaved(cb),
        focusSelf: () => { if (typeof window !== 'undefined') window.focus(); },
        hasFocus: () => typeof document !== 'undefined' && document.hasFocus(),
        focus: () => null,
        ...overrides,
    };
}

/** A satellite window as the main window knows it. */
export interface WindowEntry {
    id: string;
    kind: SatelliteKind;
    treeId: TreeId | null;
    /** This main window opened it and holds its reference (focus, close, `closed`). */
    opened: boolean;
    /** It said hello (it runs and has the tree or gets it). */
    connected: boolean;
    /** Its view's state from its hello (K4), and where it stood when it left. */
    state?: unknown;
    bounds?: WindowBounds;
    /** Its own following of the agent as it last said (spec 097; null: none, no live session). */
    agent?: AgentFollow | null;
    /** It takes the tree's images from this window (window-images.ts): they go as references. */
    imageRefs?: boolean;
    /** It takes the tree as `data` (an older window, 3.31 and before, only as one JSON string). */
    takesData?: boolean;
}

interface Entry extends WindowEntry {
    win: Window | null;
    initial?: unknown;
    initSent: boolean;
    /**
     * Another satellite of this window's browsing context opened it (§2 ⧉):
     * `window.open('', its name)` finds it, so it can be brought forward
     * and closed as one this window opened.
     */
    reachable?: boolean;
}

/** A window a satellite opened, until its hello (§2 ⧉). */
interface Spawned {
    kind: SatelliteKind;
    state?: unknown;
    reachable: boolean;
    at: number;
}

/** A window a satellite opened that has not said hello by then is forgotten (blocked meanwhile, closed at once). */
export const SPAWN_FORGET_MS = 60000;

/** Window size per kind (§1 openSatellite). */
export const DEFAULT_WINDOW_SIZE: Record<SatelliteKind, { width: number; height: number }> = {
    table: { width: 1200, height: 800 },
    family: { width: 1000, height: 750 },
    descendants: { width: 1000, height: 750 },
    timeline: { width: 1000, height: 750 },
    fan: { width: 1000, height: 750 },
    map: { width: 1000, height: 750 },
    overview: { width: 900, height: 900 },
};

/** The main window and its screen (what placeNextTo reads). */
export interface ScreenGeometry {
    screenX: number;
    screenY: number;
    outerWidth: number;
    outerHeight: number;
    availLeft: number;
    availTop: number;
    availWidth: number;
    availHeight: number;
}

/** This window and its screen now (null outside a browser). */
export function currentGeometry(): ScreenGeometry | null {
    if (typeof window === 'undefined' || typeof screen === 'undefined') return null;
    const s = screen as Screen & { availLeft?: number; availTop?: number };
    return {
        screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight,
        availLeft: s.availLeft ?? 0, availTop: s.availTop ?? 0, availWidth: s.availWidth, availHeight: s.availHeight,
    };
}

/**
 * Where a new window goes without the Window Management API (§7): right of
 * the main window when it fits, else left of it, else over it shifted
 * +32/+32 per window already open; the size cut to the available area.
 */
export function placeNextTo(width: number, height: number, g: ScreenGeometry, openCount = 0): { left: number; top: number; width: number; height: number } {
    const w = Math.max(200, Math.min(width, g.availWidth));
    const h = Math.max(200, Math.min(height, g.availHeight));
    const right = g.availLeft + g.availWidth;
    const bottom = g.availTop + g.availHeight;
    const fitTop = (t: number) => Math.max(g.availTop, Math.min(t, bottom - h));
    if (g.screenX + g.outerWidth + w <= right) return { left: g.screenX + g.outerWidth, top: fitTop(g.screenY), width: w, height: h };
    if (g.screenX - w >= g.availLeft) return { left: g.screenX - w, top: fitTop(g.screenY), width: w, height: h };
    const step = 32 * (openCount + 1);
    const left = Math.max(g.availLeft, Math.min(g.screenX + step, right - w));
    return { left, top: fitTop(g.screenY + step), width: w, height: h };
}

export interface WindowRegistryOptions {
    bus: WindowBus;
    host?: MainWindowHost;
    /** window.open (a test passes its own). */
    openWindow?: (url: string, name: string, features: string) => Window | null;
    geometry?: () => ScreenGeometry | null;
    /** Where the satellites find this window's images (default: published on `window`). */
    images?: WindowImageStore;
}

/** Patches go out at most this often (a burst of changes, e.g. Undo ×10, makes one). */
export const PATCH_INTERVAL_MS = 500;
/** The status is sent at least this often (the satellites tell a closed main window by its silence). */
export const HEARTBEAT_MS = 1000;

/** What a satellite's choice does here (spec 110): `focus` makes the person the centre; its number rises in that window. */
export interface SelectMeta {
    intent: 'mark' | 'focus';
    seq: number | null;
}
type SelectHandler = (personId: string | null, origin: string, meta: SelectMeta) => void;
type LinkHandler = (link: { search?: string; files?: unknown[] }, from: string) => void;
/** Runs a research action; what it returns (or its promise resolves to) goes back to an action sent with `reqId`. */
type ResearchActionHandler = (action: string, args: unknown, from: string) => unknown;
type HeldAction = { action: string; args: unknown; from: string; reqId?: string };

export class WindowRegistry {
    private readonly bus: WindowBus;
    private readonly host: MainWindowHost;
    private readonly openWindowFn: (url: string, name: string, features: string) => Window | null;
    private readonly geometry: () => ScreenGeometry | null;
    private readonly entries = new Map<string, Entry>();
    private readonly spawned = new Map<string, Spawned>();
    private readonly changeListeners = new Set<() => void>();
    private readonly selectHandlers = new Set<SelectHandler>();
    private readonly sendEndHandlers = new Set<(windowId: string) => void>();
    private linkHandler: LinkHandler | null = null;
    private researchHandler: ResearchActionHandler | null = null;
    /** "On the map" of a satellite's Table (spec 098 §6): the selection's encoded ref and its tree. */
    private showOnMapHandler: ((ref: string, treeId: TreeId | null) => void) | null = null;
    private researchMenuProvider: ((personId: string) => unknown[]) | null = null;
    private readonly heldLinks: { link: { search?: string; files?: unknown[] }; from: string }[] = [];
    private readonly heldActions: HeldAction[] = [];
    private readonly helloListeners = new Set<(id: string, kind: SatelliteKind) => void>();
    /** The fan's family-line slots last told (spec 114 §3). */
    private fanRodColors: Array<[string, string]> | null = null;
    private readonly agentReqListeners = new Set<(id: string) => void>();
    /** The agent's state's revision sent last (spec 097 K1.3; null: none). */
    private agentRev: number | null = null;
    private readonly focusWaiters = new Map<string, () => void>();
    private readonly unsubscribe: (() => void)[] = [];

    /** Starts at the clock: a later main window (after a reload) never repeats an earlier one's revisions. */
    private rev = Date.now();
    private lastStamp: readonly unknown[] | null = null;
    private lastSent: { treeId: TreeId | null; withData: boolean } | null = null;
    private lastBroadcastAt = 0;
    private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private ticks = 0;
    private lastStatusJson = '';
    private lastSelection: string | null = null;
    private applyingRemoteSelection = false;
    private started = false;
    private readonly images: WindowImageStore;

    constructor(opts: WindowRegistryOptions) {
        this.bus = opts.bus;
        this.host = opts.host ?? dataManagerHost();
        this.openWindowFn = opts.openWindow ?? ((url, name, features) => (typeof window !== 'undefined' ? window.open(url, name, features) : null));
        this.geometry = opts.geometry ?? currentGeometry;
        this.images = opts.images ?? new WindowImageStore();
        if (!opts.images) publishImageSource(this.images);
    }

    /** This main window's id (the `from` of its messages). */
    get id(): string {
        return this.bus.id;
    }

    /** Start listening, send the first status (satellites of an earlier main window say hello again) and the heartbeat. */
    start(): void {
        if (this.started) return;
        this.started = true;
        this.lastStamp = this.host.stateStamp();
        const b = this.bus;
        this.unsubscribe.push(
            b.on('hello', m => this.onHello(m)),
            b.on('resend', m => this.onResend(m.windowId || m.from)),
            b.on('edit', m => this.onEdit(m)),
            b.on('undo', () => { this.host.undo(); this.sync(); }),
            b.on('redo', () => { this.host.redo(); this.sync(); }),
            b.on('bye', m => this.onBye(m)),
            b.on('view', m => this.onView(m)),
            b.on('spawn', m => this.onSpawn(m)),
            b.on('select', m => this.handleSelect(m)),
            b.on('send-mode', m => { if (m.mode !== 'focus') this.sendEnded(m.windowId || m.from); }),
            b.on('focus-req', m => this.onFocusRequest(m.from)),
            b.on('focused', m => this.focusWaiters.get(m.from)?.()),
            b.on('link', m => this.onLink({ search: m.search, files: m.files }, m.from)),
            b.on('research-action', m => this.onResearchAction({ action: m.action, args: m.args, from: m.from, reqId: m.reqId })),
            b.on('research-menu-req', m => this.onResearchMenuRequest(m)),
            b.on('show-on-map', m => this.showOnMapHandler?.(m.ref, m.treeId)),
            b.on('agent-state-req', m => this.agentStateAsked(m.windowId || m.from)),
            this.host.onSaved(() => this.sync()),
        );
        if (typeof window !== 'undefined') {
            const sync = () => this.sync();
            const bye = () => this.bus.post({ type: 'main-bye' });
            const rodColors = (e: Event) => this.postFanRodColors((e as CustomEvent<Array<[string, string]>>).detail);
            window.addEventListener('strom:fan-rod-colors', rodColors);
            window.addEventListener('strom:data-changed', sync);
            window.addEventListener('strom:tree-switched', sync);
            window.addEventListener('strom:tree-renamed', sync);
            // Images that came after the tree (spec 116, I6): to the satellites as any change of the data, no edit.
            window.addEventListener(IMAGES_ARRIVED_EVENT, sync);
            window.addEventListener('pagehide', bye);
            this.unsubscribe.push(() => {
                window.removeEventListener('strom:data-changed', sync);
                window.removeEventListener('strom:tree-switched', sync);
                window.removeEventListener('strom:tree-renamed', sync);
                window.removeEventListener(IMAGES_ARRIVED_EVENT, sync);
                window.removeEventListener('strom:fan-rod-colors', rodColors);
                window.removeEventListener('pagehide', bye);
            });
        }
        this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
        this.postStatus(true);
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        for (const u of this.unsubscribe.splice(0)) u();
        if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
        this.heartbeat = null;
        this.broadcastTimer = null;
    }

    /** The open tree's window revision (read from its state now). */
    get revision(): number {
        this.checkRevision();
        return this.rev;
    }

    /** The satellite windows, in the order they appeared. */
    list(): WindowEntry[] {
        return [...this.entries.values()].map(({ id, kind, treeId, opened, connected, state, bounds, agent }) => ({ id, kind, treeId, opened, connected, state, bounds, ...(agent ? { agent } : {}) }));
    }

    get size(): number {
        return this.entries.size;
    }

    /** Listen to changes of the list. Returns the unsubscribe. */
    onChange(cb: () => void): () => void {
        this.changeListeners.add(cb);
        return () => { this.changeListeners.delete(cb); };
    }

    /**
     * Open a satellite window of `kind`; `initial` = its view's starting state
     * (sent as `init` after its hello). Call only from a click's handler (a
     * browser blocks a window opened later). Returns the window's id, or null
     * when the browser blocked it (§4d: the caller says so and offers a retry).
     */
    openSatellite(kind: SatelliteKind, initial?: unknown): string | null {
        const id = newWindowId();
        const size = DEFAULT_WINDOW_SIZE[kind];
        const g = this.geometry();
        const place = g ? placeNextTo(size.width, size.height, g, this.entries.size) : { left: 0, top: 0, ...size };
        const features = `popup,width=${place.width},height=${place.height},left=${place.left},top=${place.top}`;
        let win: Window | null = null;
        try {
            win = this.openWindowFn(satelliteUrl(kind, this.host.treeId(), id), satelliteWindowName(id), features);
        } catch {
            win = null;
        }
        if (!win) return null;
        this.entries.set(id, { id, kind, treeId: this.host.treeId(), opened: true, connected: false, win, initial, initSent: false });
        this.emitChange();
        return id;
    }

    /**
     * Bring a satellite to the front: focus() on its reference and a request
     * it answers once it has the focus. True when it confirmed within 400 ms
     * (§4: else the menu says the browser did not bring it forward).
     */
    focusWindow(id: string): Promise<boolean> {
        const entry = this.entries.get(id);
        if (!entry) return Promise.resolve(false);
        // A window another satellite opened: found by its name (only one known to live: else a blank one would open).
        if (!entry.win && entry.reachable && entry.connected) {
            try { entry.win = this.openWindowFn('', satelliteWindowName(id), ''); } catch { entry.win = null; }
        }
        try { entry.win?.focus(); } catch { /* a closed window */ }
        const answered = this.waitFocused(id);
        this.bus.post({ type: 'focus-req', to: id });
        return answered;
    }

    /** Close a satellite (its reference, else it is asked to close itself). */
    closeWindow(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        if (entry.win && !entry.win.closed) {
            try { entry.win.close(); } catch { /* gone already */ }
        } else {
            this.bus.post({ type: 'close', to: id });
        }
        this.entries.delete(id);
        this.emitChange();
    }

    closeAll(): void {
        for (const id of [...this.entries.keys()]) this.closeWindow(id);
    }

    /**
     * The person selected here (the main window always follows the
     * selection). Not sent again when it came from another window.
     */
    announceSelection(personId: string | null): void {
        if (this.applyingRemoteSelection || personId === this.lastSelection) return;
        this.lastSelection = personId;
        this.bus.post({ type: 'select', personId, treeId: this.host.treeId(), origin: this.bus.id });
    }

    /** A person selected in another window (the main view highlights it). Returns the unsubscribe. */
    onSelect(cb: SelectHandler): () => void {
        this.selectHandlers.add(cb);
        return () => { this.selectHandlers.delete(cb); };
    }

    /**
     * A window's choices no longer make this window's centre (spec 110 §2,
     * §7): it chose another send mode, switched to a view without one,
     * stopped sending, or went away. Returns the unsubscribe.
     */
    onSendEnded(cb: (windowId: string) => void): () => void {
        this.sendEndHandlers.add(cb);
        return () => { this.sendEndHandlers.delete(cb); };
    }

    private sendEnded(id: string): void {
        for (const cb of [...this.sendEndHandlers]) {
            try { cb(id); } catch (err) { console.error('send end handler failed', err); }
        }
    }

    /** Who opens an address or a launch another window passed on (§5); links that came before are handed over now. */
    setLinkHandler(cb: LinkHandler | null): void {
        this.linkHandler = cb;
        if (cb) for (const l of this.heldLinks.splice(0)) cb(l.link, l.from);
    }

    /** Who lists the research's rows of a person's menu for a satellite (§2, 2g); none: no rows. */
    setResearchMenuProvider(cb: ((personId: string) => unknown[]) | null): void {
        this.researchMenuProvider = cb;
    }

    /** Who runs a research action asked for by a satellite (§2, §6). */
    /** Who shows a satellite's selection on the map here (spec 098 §6). */
    setShowOnMapHandler(cb: ((ref: string, treeId: TreeId | null) => void) | null): void {
        this.showOnMapHandler = cb;
    }

    setResearchActionHandler(cb: ResearchActionHandler | null): void {
        this.researchHandler = cb;
        if (cb) for (const a of this.heldActions.splice(0)) this.runResearchAction(a);
    }

    /** A window said hello (a new one, or one reloaded): what only it needs now goes to it (K3: the research's state). */
    onWindowHello(cb: (id: string, kind: SatelliteKind) => void): () => void {
        this.helloListeners.add(cb);
        return () => this.helloListeners.delete(cb);
    }

    /**
     * The fan's family-line slots this window remembers (spec 114 §3), to every
     * satellite; kept for a window that says hello later. Empty: forgotten.
     */
    postFanRodColors(memory: Array<[string, string]> | null | undefined, to?: string): void {
        if (!to) this.fanRodColors = Array.isArray(memory) && memory.length ? memory : null;
        const mem = to ? memory : this.fanRodColors;
        const treeId = this.host.treeId();
        this.bus.post(to ? { type: 'fan-rod-colors', to, treeId, memory: mem ?? [] } : { type: 'fan-rod-colors', treeId, memory: mem ?? [] });
    }

    /** The research's state for an overview window (K3). */
    postResearchState(state: unknown): void {
        this.bus.post({ type: 'research-state', state });
    }

    /**
     * The agent's state for the other windows (spec 097 K1.3): to every one,
     * or to one (`to`: after its hello or its ask).
     */
    postAgentState(state: unknown, to?: string): void {
        this.bus.post(to ? { type: 'agent-state', to, state } : { type: 'agent-state', state });
    }

    /** The revision of the agent's state sent last: the status carries it (a window that missed one asks). */
    setAgentRev(rev: number | null): void {
        if (rev === this.agentRev) return;
        this.agentRev = rev;
        this.postStatus(false);
    }

    /** A window asked for the whole agent's state (its mirror missed a revision). */
    onAgentStateRequest(cb: (id: string) => void): () => void {
        this.agentReqListeners.add(cb);
        return () => this.agentReqListeners.delete(cb);
    }

    /** Something may have changed (a hint from the app): read the revision and the status now. */
    notifyChanged(): void {
        this.sync();
    }

    // ---- inside ----

    private emitChange(): void {
        for (const cb of [...this.changeListeners]) {
            try { cb(); } catch (err) { console.error('window list listener failed', err); }
        }
    }

    private sync(): void {
        this.checkRevision();
        this.postStatus(false);
    }

    /** Raise the revision when the open tree's state differs from the last one seen; the satellites then get it. */
    private checkRevision(): void {
        const stamp = this.host.stateStamp();
        const last = this.lastStamp;
        if (last && last.length === stamp.length && last.every((v, i) => v === stamp[i])) return;
        this.lastStamp = stamp;
        this.rev++;
        this.scheduleBroadcast();
    }

    private scheduleBroadcast(): void {
        if (this.broadcastTimer) return;
        const wait = Math.max(0, this.lastBroadcastAt + PATCH_INTERVAL_MS - Date.now());
        this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = null;
            this.broadcast();
        }, wait);
    }

    /** The tree's present state to every satellite: a patch, or the whole tree after a switch or an unlock. */
    private broadcast(): void {
        this.checkRevision();
        if (this.broadcastTimer) { clearTimeout(this.broadcastTimer); this.broadcastTimer = null; }
        this.lastBroadcastAt = Date.now();
        const treeId = this.host.treeId();
        const withData = !!treeId && !this.host.locked();
        const prev = this.lastSent;
        this.lastSent = { treeId, withData };
        if (!treeId || !withData) {
            this.postStatus(true);
            return;
        }
        // No window holds a copy of the tree: nothing is copied or sent. A
        // window that says hello later gets the whole tree then (onHello),
        // and the first broadcast after it a patch.
        if (!this.anyConnected()) {
            this.lastSent = null;
            this.postStatus(false);
            return;
        }
        // One message for all: images as references only when every window takes them from here.
        const out = this.outgoing([...this.entries.values()].filter(e => e.connected));
        if (prev && prev.treeId === treeId && prev.withData) {
            this.bus.post({ type: 'patch', treeId, revision: this.rev, ...out });
        } else {
            const replaces = prev?.treeId && prev.treeId !== treeId ? { treeId: prev.treeId, exists: this.host.treeExists(prev.treeId) } : undefined;
            this.bus.post({ type: 'tree', treeId, name: this.host.treeName(treeId), revision: this.rev, ...out, ...(replaces ? { replaces } : {}), ...this.focusField() });
        }
        this.postStatus(false);
    }

    /** A satellite said hello and is still listed (it holds the tree, or gets it). */
    private anyConnected(): boolean {
        for (const e of this.entries.values()) if (e.connected) return true;
        return false;
    }

    /** The whole open tree to one window (after its hello, after a refused edit). */
    private sendTreeTo(to: string): void {
        const treeId = this.host.treeId();
        if (!treeId || this.host.locked()) return;   // the status says why
        this.bus.post({ type: 'tree', to, treeId, name: this.host.treeName(treeId), revision: this.rev, ...this.outgoing([this.entries.get(to)]), ...this.focusField() });
        if (!this.lastSent) this.lastSent = { treeId, withData: true };
    }

    /** The open tree to send: as data, its images as references when all receivers take them from here. */
    private outgoing(to: (WindowEntry | undefined)[]): { data: unknown; imageRefs?: true } | { json: string } {
        const data = this.host.storedData();
        // A window of an older version takes only one JSON string (as long as one is open).
        if (to.some(e => e?.takesData !== true)) return { json: JSON.stringify(data) };
        return to.every(e => e?.imageRefs === true) ? { data: this.images.replaceImages(data), imageRefs: true } : { data };
    }

    /** A satellite could not take an image from here: the whole tree with its images, and so from now on. */
    private onResend(id: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.imageRefs = false;
        this.sendTreeTo(id);
    }

    /** The person in the centre here, with the tree (a satellite without a state of its own starts there). */
    private focusField(): { focus?: { personId: string; depthUp: number; depthDown: number } } {
        let focus: { personId: string; depthUp: number; depthDown: number } | null = null;
        try { focus = this.host.focus?.() ?? null; } catch { /* none */ }
        return focus ? { focus } : {};
    }

    private status(): WindowStatus {
        const treeId = this.host.treeId();
        return {
            live: this.host.live(),
            locked: this.host.locked(),
            readOnly: this.host.readOnly(),
            listsOpen: this.host.listsOpen?.() ?? !this.host.readOnly(),
            researchState: this.host.researchState(),
            treeExists: !!treeId && this.host.treeExists(treeId),
            treeId,
            treeName: treeId ? this.host.treeName(treeId) : '',
            revision: this.rev,
            canUndo: this.host.canUndo(),
            canRedo: this.host.canRedo(),
            undoOpen: this.host.canUndo() && !(this.host.undoLocked?.('undo') ?? this.host.readOnly()),
            redoOpen: this.host.canRedo() && !(this.host.undoLocked?.('redo') ?? this.host.readOnly()),
            windows: [...this.entries.keys()],
            agentRev: this.agentRev,
            ...this.agentsField(),
            ...(this.host.followingAgent?.() ? { followingAgent: true } : {}),
        };
    }

    /** The windows' own following of the agent (spec 097 §7: the order of taking over); none without any. */
    private agentsField(): { agents?: Record<string, AgentFollow> } {
        const agents: Record<string, AgentFollow> = {};
        for (const [id, e] of this.entries) if (e.agent) agents[id] = e.agent;
        return Object.keys(agents).length > 0 ? { agents } : {};
    }

    private agentStateAsked(id: string): void {
        for (const cb of [...this.agentReqListeners]) {
            try { cb(id); } catch (err) { console.error('agent state request failed', err); }
        }
    }

    private postStatus(force: boolean): void {
        const s = this.status();
        const json = JSON.stringify(s);
        if (!force && json === this.lastStatusJson) return;
        this.lastStatusJson = json;
        this.bus.post({ type: 'status', ...s });
    }

    private tick(): void {
        this.checkRevision();
        this.postStatus(true);
        // Windows this one opened: one closed without a word (a crash) leaves the list (every 2 s).
        if (++this.ticks % 2 === 0) {
            let changed = false;
            for (const [id, e] of this.entries) {
                if (e.win && e.win.closed) { this.entries.delete(id); changed = true; this.sendEnded(id); }
            }
            if (changed) this.emitChange();
        }
    }

    private onHello(m: MessageOf<'hello'>): void {
        const id = m.windowId || m.from;
        let entry = this.entries.get(id);
        if (!entry) {
            entry = { id, kind: m.kind, treeId: m.treeId, opened: false, connected: false, win: null, initSent: false };
            // Opened by another satellite: its starting state, as for a window opened here.
            const spawn = this.spawned.get(id);
            if (spawn) {
                this.spawned.delete(id);
                if (spawn.state !== undefined) entry.initial = spawn.state;
                entry.reachable = spawn.reachable;
            }
        }
        entry.kind = m.kind;
        entry.treeId = m.treeId;
        entry.connected = true;
        entry.agent = parseAgentFollow(m.agent);
        entry.imageRefs = m.imageRefs === true;
        entry.takesData = m.takesData === true;
        if (m.state !== undefined) entry.state = m.state;
        this.entries.set(id, entry);
        if (!entry.initSent) {
            entry.initSent = true;
            if (entry.initial !== undefined) this.bus.post({ type: 'init', to: id, kind: entry.kind, state: entry.initial });
        }
        this.checkRevision();
        this.sendTreeTo(id);
        this.postStatus(true);
        if (this.fanRodColors && m.kind === 'fan') this.postFanRodColors(this.fanRodColors, id);
        this.emitChange();
        for (const cb of [...this.helloListeners]) {
            try { cb(id, entry.kind); } catch (err) { console.error('hello listener failed', err); }
        }
    }

    private onEdit(m: MessageOf<'edit'>): void {
        this.checkRevision();
        const refuse = (reason: EditRefusal) => {
            this.bus.post({ type: 'edit-result', to: m.from, editId: m.editId, ok: false, revision: this.rev, reason });
            this.sendTreeTo(m.from);
            this.postStatus(true);
        };
        if (m.treeId !== this.host.treeId()) return refuse('tree');
        // A change of the lists alone also while the tree follows a research (N2).
        const listsOnly = m.listsOnly === true;
        if (this.host.locked() || (this.host.readOnly() && !(listsOnly && this.host.listsOpen?.()))) return refuse('read-only');
        if (this.host.busy()) return refuse('busy');
        if (m.baseRevision !== this.rev) return refuse('revision');
        if (!this.host.applyEdit(m.json, m.label, listsOnly)) return refuse('invalid');
        this.checkRevision();
        this.bus.post({ type: 'edit-result', to: m.from, editId: m.editId, ok: true, revision: this.rev });
        this.postStatus(false);
    }

    /** A satellite switched its view (§2 K2): the list names the new one. */
    private onView(m: MessageOf<'view'>): void {
        const entry = this.entries.get(m.windowId || m.from);
        if (!entry) return;
        // Its following of the agent (spec 097): kept for the order of taking over, not shown here (§8).
        if (m.agent !== undefined) {
            const agent = parseAgentFollow(m.agent);
            if (agent !== (entry.agent ?? null)) {
                entry.agent = agent;
                // The status says it at once: a main window closed before its next heartbeat leaves the right order.
                this.postStatus(false);
            }
        }
        if (entry.kind === m.kind) return;
        entry.kind = m.kind;
        if (m.kind === 'fan' && this.fanRodColors) this.postFanRodColors(this.fanRodColors, entry.id);
        this.emitChange();
    }

    /**
     * A satellite opened another window itself (§2 ⧉): noted until its hello,
     * which then gets `state` as `init`. Reachable by its name when the
     * opener is (a window opened here, or by such a window).
     */
    private onSpawn(m: MessageOf<'spawn'>): void {
        const now = Date.now();
        for (const [id, s] of this.spawned) if (now - s.at > SPAWN_FORGET_MS) this.spawned.delete(id);
        if (!m.windowId || this.entries.has(m.windowId)) return;
        const opener = this.entries.get(m.from);
        const reachable = !!opener && (opener.opened || !!opener.reachable);
        this.spawned.set(m.windowId, { kind: m.kind, ...(m.state !== undefined ? { state: m.state } : {}), reachable, at: now });
    }

    private onBye(m: MessageOf<'bye'>): void {
        const id = m.windowId || m.from;
        this.sendEnded(id);
        if (!this.entries.delete(id)) return;
        this.emitChange();
    }

    private handleSelect(m: MessageOf<'select'>): void {
        if (m.treeId && m.treeId !== this.host.treeId()) return;
        this.lastSelection = m.personId;
        this.applyingRemoteSelection = true;
        try {
            const meta: SelectMeta = { intent: m.intent === 'focus' ? 'focus' : 'mark', seq: typeof m.seq === 'number' ? m.seq : null };
            for (const cb of [...this.selectHandlers]) cb(m.personId, m.origin, meta);
        } catch (err) {
            console.error('select handler failed', err);
        } finally {
            this.applyingRemoteSelection = false;
        }
    }

    private onFocusRequest(from: string): void {
        this.host.focusSelf();
        void answerWhenFocused(this.bus, from, () => this.host.hasFocus());
    }

    private onLink(link: { search?: string; files?: unknown[] }, from: string): void {
        if (this.linkHandler) this.linkHandler(link, from);
        else this.heldLinks.push({ link, from });
    }

    private onResearchMenuRequest(m: MessageOf<'research-menu-req'>): void {
        let items: unknown[] = [];
        if (this.researchMenuProvider && (!m.treeId || m.treeId === this.host.treeId())) {
            try { items = this.researchMenuProvider(m.personId); } catch (err) { console.error('research menu failed', err); }
        }
        this.bus.post({ type: 'research-menu', to: m.from, reqId: m.reqId, items });
    }

    private onResearchAction(a: HeldAction): void {
        if (this.researchHandler) this.runResearchAction(a);
        else this.heldActions.push(a);
    }

    private runResearchAction(a: HeldAction): void {
        let result: unknown = null;
        try {
            result = this.researchHandler?.(a.action, a.args, a.from);
        } catch (err) {
            console.error('research action failed', err);
        }
        const reqId = a.reqId;
        if (!reqId) return;
        const answer = (value: unknown) => {
            try {
                this.bus.post({ type: 'research-action-result', to: a.from, reqId, result: value ?? null });
            } catch (err) {
                // An outcome a structured clone does not take: the window hears "no outcome".
                console.error('research action result not sent', err);
                this.bus.post({ type: 'research-action-result', to: a.from, reqId, result: null });
            }
        };
        Promise.resolve(result).then(answer, (err) => { console.error('research action failed', err); answer(null); });
    }

    private waitFocused(id: string): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.focusWaiters.delete(id); resolve(false); }, FOCUS_WAIT_MS);
            this.focusWaiters.set(id, () => { clearTimeout(timer); this.focusWaiters.delete(id); resolve(true); });
        });
    }
}
