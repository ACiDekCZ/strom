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

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId } from '../types.js';
import { WindowBus, answerWhenFocused, FOCUS_WAIT_MS, type MessageOf, type WindowBounds, type WindowStatus, type EditRefusal } from './window-bus.js';
import { newWindowId, satelliteUrl, satelliteWindowName, type SatelliteKind } from './window-role.js';

/** What the registry needs of the main window (DataManager's by default; a test passes its own). */
export interface MainWindowHost {
    treeId(): TreeId | null;
    treeName(treeId: TreeId): string;
    treeExists(treeId: TreeId): boolean;
    /** The open tree as stored, as one JSON string. */
    storedJson(): string;
    /** Values that change whenever the open tree changes (compared item by item, by identity). */
    stateStamp(): readonly unknown[];
    /** Save a satellite's edit as an edit of this window (one undo step named `label`). */
    applyEdit(json: string, label: string): boolean;
    /** A staged dialog is open here: no edit from outside now. */
    busy(): boolean;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    live(): boolean;
    locked(): boolean;
    readOnly(): boolean;
    researchState(): unknown;
    /** Subscribe to every save of the open tree; returns the unsubscribe. */
    onSaved(cb: () => void): () => void;
    focusSelf(): void;
    hasFocus(): boolean;
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
        storedJson: () => DataManager.storedDataJson(),
        stateStamp: () => [DataManager.getCurrentTreeId(), DataManager.getData(), DataManager.getContentRevision(), DataManager.isLocked()],
        applyEdit: (json, label) => DataManager.applyWindowEdit(json, label),
        busy: () => DataManager.isEditSessionActive(),
        undo: () => { if (DataManager.undo()) changed(); },
        redo: () => { if (DataManager.redo()) changed(); },
        canUndo: () => DataManager.canUndo(),
        canRedo: () => DataManager.canRedo(),
        live: () => DataManager.isLiveFollowing(),
        locked: () => DataManager.isLocked(),
        readOnly: () => DataManager.isReadOnly() || DataManager.isTreeLocked(),
        researchState: () => null,
        onSaved: (cb) => DataManager.onTreeSaved(cb),
        focusSelf: () => { if (typeof window !== 'undefined') window.focus(); },
        hasFocus: () => typeof document !== 'undefined' && document.hasFocus(),
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
}

interface Entry extends WindowEntry {
    win: Window | null;
    initial?: unknown;
    initSent: boolean;
}

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

function currentGeometry(): ScreenGeometry | null {
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
}

/** Patches go out at most this often (a burst of changes, e.g. Undo ×10, makes one). */
export const PATCH_INTERVAL_MS = 500;
/** The status is sent at least this often (the satellites tell a closed main window by its silence). */
export const HEARTBEAT_MS = 1000;

type SelectHandler = (personId: string | null, origin: string) => void;
type LinkHandler = (link: { search?: string; files?: unknown[] }, from: string) => void;
type ResearchActionHandler = (action: string, args: unknown, from: string) => void;

export class WindowRegistry {
    private readonly bus: WindowBus;
    private readonly host: MainWindowHost;
    private readonly openWindowFn: (url: string, name: string, features: string) => Window | null;
    private readonly geometry: () => ScreenGeometry | null;
    private readonly entries = new Map<string, Entry>();
    private readonly changeListeners = new Set<() => void>();
    private readonly selectHandlers = new Set<SelectHandler>();
    private linkHandler: LinkHandler | null = null;
    private researchHandler: ResearchActionHandler | null = null;
    private researchMenuProvider: ((personId: string) => unknown[]) | null = null;
    private readonly heldLinks: { link: { search?: string; files?: unknown[] }; from: string }[] = [];
    private readonly heldActions: { action: string; args: unknown; from: string }[] = [];
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

    constructor(opts: WindowRegistryOptions) {
        this.bus = opts.bus;
        this.host = opts.host ?? dataManagerHost();
        this.openWindowFn = opts.openWindow ?? ((url, name, features) => (typeof window !== 'undefined' ? window.open(url, name, features) : null));
        this.geometry = opts.geometry ?? currentGeometry;
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
            b.on('edit', m => this.onEdit(m)),
            b.on('undo', () => { this.host.undo(); this.sync(); }),
            b.on('redo', () => { this.host.redo(); this.sync(); }),
            b.on('bye', m => this.onBye(m)),
            b.on('select', m => this.handleSelect(m)),
            b.on('focus-req', m => this.onFocusRequest(m.from)),
            b.on('focused', m => this.focusWaiters.get(m.from)?.()),
            b.on('link', m => this.onLink({ search: m.search, files: m.files }, m.from)),
            b.on('research-action', m => this.onResearchAction(m.action, m.args, m.from)),
            b.on('research-menu-req', m => this.onResearchMenuRequest(m)),
            this.host.onSaved(() => this.sync()),
        );
        if (typeof window !== 'undefined') {
            const sync = () => this.sync();
            const bye = () => this.bus.post({ type: 'main-bye' });
            window.addEventListener('strom:data-changed', sync);
            window.addEventListener('strom:tree-switched', sync);
            window.addEventListener('strom:tree-renamed', sync);
            window.addEventListener('pagehide', bye);
            this.unsubscribe.push(() => {
                window.removeEventListener('strom:data-changed', sync);
                window.removeEventListener('strom:tree-switched', sync);
                window.removeEventListener('strom:tree-renamed', sync);
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
        return [...this.entries.values()].map(({ id, kind, treeId, opened, connected, state, bounds }) => ({ id, kind, treeId, opened, connected, state, bounds }));
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
    setResearchActionHandler(cb: ResearchActionHandler | null): void {
        this.researchHandler = cb;
        if (cb) for (const a of this.heldActions.splice(0)) cb(a.action, a.args, a.from);
    }

    /** The research's state for an overview window (K3). */
    postResearchState(state: unknown): void {
        this.bus.post({ type: 'research-state', state });
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
        const json = this.host.storedJson();
        if (prev && prev.treeId === treeId && prev.withData) {
            this.bus.post({ type: 'patch', treeId, revision: this.rev, json });
        } else {
            const replaces = prev?.treeId && prev.treeId !== treeId ? { treeId: prev.treeId, exists: this.host.treeExists(prev.treeId) } : undefined;
            this.bus.post({ type: 'tree', treeId, name: this.host.treeName(treeId), revision: this.rev, json, ...(replaces ? { replaces } : {}) });
        }
        this.postStatus(false);
    }

    /** The whole open tree to one window (after its hello, after a refused edit). */
    private sendTreeTo(to: string): void {
        const treeId = this.host.treeId();
        if (!treeId || this.host.locked()) return;   // the status says why
        this.bus.post({ type: 'tree', to, treeId, name: this.host.treeName(treeId), revision: this.rev, json: this.host.storedJson() });
        if (!this.lastSent) this.lastSent = { treeId, withData: true };
    }

    private status(): WindowStatus {
        const treeId = this.host.treeId();
        return {
            live: this.host.live(),
            locked: this.host.locked(),
            readOnly: this.host.readOnly(),
            researchState: this.host.researchState(),
            treeExists: !!treeId && this.host.treeExists(treeId),
            treeId,
            treeName: treeId ? this.host.treeName(treeId) : '',
            revision: this.rev,
            canUndo: this.host.canUndo(),
            canRedo: this.host.canRedo(),
            windows: [...this.entries.keys()],
        };
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
                if (e.win && e.win.closed) { this.entries.delete(id); changed = true; }
            }
            if (changed) this.emitChange();
        }
    }

    private onHello(m: MessageOf<'hello'>): void {
        const id = m.windowId || m.from;
        const entry: Entry = this.entries.get(id) ?? { id, kind: m.kind, treeId: m.treeId, opened: false, connected: false, win: null, initSent: false };
        entry.kind = m.kind;
        entry.treeId = m.treeId;
        entry.connected = true;
        if (m.state !== undefined) entry.state = m.state;
        this.entries.set(id, entry);
        if (!entry.initSent) {
            entry.initSent = true;
            if (entry.initial !== undefined) this.bus.post({ type: 'init', to: id, kind: entry.kind, state: entry.initial });
        }
        this.checkRevision();
        this.sendTreeTo(id);
        this.postStatus(true);
        this.emitChange();
    }

    private onEdit(m: MessageOf<'edit'>): void {
        this.checkRevision();
        const refuse = (reason: EditRefusal) => {
            this.bus.post({ type: 'edit-result', to: m.from, editId: m.editId, ok: false, revision: this.rev, reason });
            this.sendTreeTo(m.from);
            this.postStatus(true);
        };
        if (m.treeId !== this.host.treeId()) return refuse('tree');
        if (this.host.readOnly() || this.host.locked()) return refuse('read-only');
        if (this.host.busy()) return refuse('busy');
        if (m.baseRevision !== this.rev) return refuse('revision');
        if (!this.host.applyEdit(m.json, m.label)) return refuse('invalid');
        this.checkRevision();
        this.bus.post({ type: 'edit-result', to: m.from, editId: m.editId, ok: true, revision: this.rev });
        this.postStatus(false);
    }

    private onBye(m: MessageOf<'bye'>): void {
        const id = m.windowId || m.from;
        if (!this.entries.delete(id)) return;
        this.emitChange();
    }

    private handleSelect(m: MessageOf<'select'>): void {
        if (m.treeId && m.treeId !== this.host.treeId()) return;
        this.lastSelection = m.personId;
        this.applyingRemoteSelection = true;
        try {
            for (const cb of [...this.selectHandlers]) cb(m.personId, m.origin);
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

    private onResearchAction(action: string, args: unknown, from: string): void {
        if (this.researchHandler) this.researchHandler(action, args, from);
        else this.heldActions.push({ action, args, from });
    }

    private waitFocused(id: string): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.focusWaiters.delete(id); resolve(false); }, FOCUS_WAIT_MS);
            this.focusWaiters.set(id, () => { clearTimeout(timer); this.focusWaiters.delete(id); resolve(true); });
        });
    }
}
