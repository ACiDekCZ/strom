/**
 * A satellite window's side (spec 079 §2, §3): it gets the tree from the main
 * window, never from storage, and sends every edit back to it.
 *
 * - Start: `hello`; the main window answers with `init` (the view's starting
 *   state, once), `tree` (the whole tree) and `status`.
 * - Edits run on this window's copy as anywhere else in the app; DataManager
 *   then hands them here (WindowEditSink) instead of storing them. Each goes
 *   to the main window as `edit` on the revision it was made on, one at a
 *   time; the copy shows it at once. A refused edit (the tree changed
 *   meanwhile) drops the edits waiting behind it; the fresh tree follows.
 * - `patch` replaces the copy with the main window's newer state. While a
 *   staged dialog is open, or an edit of this window is on its way, it waits.
 * - Undo / redo are the main window's (`undo` / `redo`).
 * - The main window is gone when it said `main-bye` or stopped sending its
 *   status for 3 s and no window holds its lock (a hidden main window's
 *   heartbeat may be slowed down by the browser).
 */

import { findImageSource, restoreImages, type ImageLookup } from './window-images.js';
import { DataManager, type WindowEditSink } from '../data.js';
import type { TreeId } from '../types.js';
import { WindowBus, answerWhenFocused, FOCUS_WAIT_MS, type MessageOf, type WindowStatus, type EditRefusal, type WindowBounds } from './window-bus.js';
import { isMainAlive, MAIN_WINDOW_NAME, newWindowId, type LocksLike, type SatelliteParams, type SatelliteKind } from './window-role.js';
import { effectiveFollowMode, followChoiceToStore, parseFollowChoice, getSendModeChoice, sendModeAvailable, setSendMode, type FollowMode, type SendMode } from './follow-mode.js';
import type { AgentFollow } from './agent-follow-state.js';

/** Where the satellite's copy of the tree lives (DataManager; a test may pass its own). */
export interface SatelliteDataTarget {
    setWindowSink(sink: WindowEditSink | null): void;
    /** `data`: the tree as the channel cloned it (an older main window's: a JSON string). */
    loadFromWindow(treeId: TreeId, data: unknown): void;
    windowDataJson(): string;
    isEditSessionActive(): boolean;
}

export type SatelliteConnection = 'connecting' | 'connected' | 'main-closed';

export interface SatelliteEvents {
    /** The connection to the main window changed (§3.1 loading, §3.3 main window closed). */
    connection: SatelliteConnection;
    /** The view's starting state from the main window's openSatellite (once, before the first tree). */
    init: { kind: SatelliteKind; state: unknown };
    /**
     * A whole tree came in: the first one, another tree (`switchedFrom`, §3.5a),
     * or a fresh copy after a refused edit (`afterConflict`).
     */
    tree: { treeId: TreeId; name: string; revision: number; switchedFrom: { treeId: TreeId; name: string } | null; afterConflict: boolean };
    /** The copy's data were replaced (a tree or a patch): the view draws them again. */
    data: { treeId: TreeId; revision: number; source: 'tree' | 'patch' };
    /** The main window's status (§3.2 live, §3.6 locked, undo/redo availability). */
    status: WindowStatus;
    /**
     * An edit of this window was not applied (§3.4); the fresh tree follows.
     * `drafts`: the editors' contexts of the refused edit and of those
     * dropped behind it (DataManager.runWithEditContext), oldest first.
     */
    conflict: { reason?: EditRefusal; drafts: unknown[] };
    /** An edit of this window was saved by the main window. */
    saved: { revision: number };
    /** The tree was renamed in the main window (its status carries the new name). */
    renamed: string;
    /** The tree of this window was deleted in the main window (§3.5b). */
    'tree-gone': { treeId: TreeId | null };
    /** The research's state from the main window (K3, overview-window.ts: read it with readOverviewState). */
    'research-state': unknown;
    /** The agent's state from the main window (spec 097 K1.3, agent-state.ts: an AgentMirrorStore takes it in). */
    'agent-state': unknown;
    /** The main window's slots of the fan's family lines (spec 114 §3). */
    'fan-rod-colors': { treeId: TreeId | null; memory: Array<[string, string]> };
    /** Another window selected a person (only while following the selection). */
    select: { personId: string | null; origin: string };
    /** "Follow selection" was switched on or off in this window (off: the mark of another window's choice goes). */
    follow: boolean;
    /** The window's "Follow selection" mode changed (a choice in the header, K2.1). */
    'follow-mode': FollowMode;
    /** What a choice here does in the main window now changed (spec 110 §1: the send mode, the view, "off"). */
    'send-mode': SendMode;
    /** The main window opened, closed or started or stopped following the agent (spec 110 §4, §7). */
    'main-state': MainWindowState;
    /** Another window takes over after the main window closed (spec 097 §7). */
    'taking-over': { windowId: string };
    /** The main window asks this window to close (§4 ×). */
    close: Record<string, never>;
    /**
     * The main window asked this window forward and it did not get the focus
     * within FOCUS_WAIT_MS (§4, 4c): the window marks its title for a while.
     */
    attention: Record<string, never>;
}

/**
 * The main window as another window shows it (spec 110 §4, §7): `open`
 * while it is heard; `followingAgent` while it follows the research agent
 * (a choice sent with `focus` is only marked there).
 */
export interface MainWindowState {
    open: boolean;
    followingAgent: boolean;
}

type Listener<K extends keyof SatelliteEvents> = (payload: SatelliteEvents[K]) => void;

/** sessionStorage key of "Follow selection" for one window (survives its reload, not other windows). */
export function followSelectionKey(windowId: string): string {
    return `strom.win.follow.${windowId}`;
}

/** A hello the main window has not answered may be on its way this long (no second one meanwhile). */
export const HELLO_RETRY_MS = 1000;

/** How long without the main window's status before the satellite checks whether it is gone (§3.3). */
export const MAIN_SILENCE_MS = 3000;
/** What stands in for a locked tree's copy. */
const EMPTY_TREE_JSON = '{"persons":{},"partnerships":{}}';
/** How often the silence is checked (a closed main window is said within 2–3.5 s: the heartbeat is 1 s). */
export const MAIN_CHECK_MS = 500;

export interface SatelliteClientOptions {
    bus?: WindowBus;
    data?: SatelliteDataTarget;
    /** sessionStorage (null: none). */
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    locks?: LocksLike | null;
    /** Close this window (default window.close()). */
    closeSelf?: () => void;
    hasFocus?: () => boolean;
    /** Where the window stands (sent with bye; K4). */
    bounds?: () => WindowBounds | undefined;
    /** Where this window takes the tree's images from (default: the main window through `opener`; null: nowhere). */
    imageSource?: () => ImageLookup | null;
}

interface QueuedEdit {
    json: string;
    label: string;
    context?: unknown;
    /** Only the lists of people changed (N2). */
    listsOnly?: true;
}

export class SatelliteClient {
    readonly windowId: string;
    /** The tree the window was opened for (the main window may send another). */
    readonly requestedTreeId: TreeId | null;
    private readonly bus: WindowBus;
    private readonly data: SatelliteDataTarget;
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
    private readonly locks: LocksLike | null | undefined;
    private readonly closeSelf: () => void;
    private readonly hasFocus: () => boolean;
    private readonly bounds: () => WindowBounds | undefined;
    private readonly imageSource: () => ImageLookup | null;
    /** The main window's images as this window reaches them (null: they come in the data). */
    private images: ImageLookup | null = null;
    private readonly listeners = new Map<keyof SatelliteEvents, Set<(p: unknown) => void>>();
    private readonly unsubscribe: (() => void)[] = [];

    private _kind: SatelliteKind;
    private _treeId: TreeId | null = null;
    private _treeName = '';
    private _revision = -1;
    private _status: WindowStatus | null = null;
    private _connection: SatelliteConnection = 'connecting';
    private _init: { kind: SatelliteKind; state: unknown } | null = null;
    private _mainFocus: unknown = null;
    private _agent: AgentFollow | null = null;
    private mainId: string | null = null;
    private lastHeard = 0;
    private helloAt = -Infinity;
    private watchdog: ReturnType<typeof setInterval> | null = null;
    private probing = false;
    private gone = false;

    private readonly queue: QueuedEdit[] = [];
    private inFlight: { editId: string; context?: unknown } | null = null;
    private heldTree: MessageOf<'tree'> | null = null;
    private heldPatch: MessageOf<'patch'> | null = null;
    private conflictPending = false;

    private lastSelection: string | null = null;
    private applyingRemoteSelection = false;
    /** The number of this window's last choice (from the clock: a reload never repeats an earlier one's). */
    private seq = Date.now();
    /** What a choice here did in the main window as last said (sendModeNow). */
    private sentMode: SendMode;
    private lastMainState: MainWindowState = { open: false, followingAgent: false };
    private focusWaiter: (() => void) | null = null;
    private started = false;
    private menuReqs = 0;
    private readonly menuWaiters = new Map<string, (items: unknown[]) => void>();
    private readonly actionWaiters = new Map<string, (result: unknown) => void>();

    constructor(params: SatelliteParams, opts: SatelliteClientOptions = {}) {
        this.windowId = params.windowId;
        this._kind = params.kind;
        this.requestedTreeId = params.treeId;
        this.bus = opts.bus ?? new WindowBus(params.windowId);
        this.data = opts.data ?? DataManager;
        this.storage = opts.storage !== undefined ? opts.storage : sessionStorageOrNull();
        this.locks = opts.locks;
        this.closeSelf = opts.closeSelf ?? (() => { if (typeof window !== 'undefined') window.close(); });
        this.hasFocus = opts.hasFocus ?? (() => typeof document !== 'undefined' && document.hasFocus());
        this.bounds = opts.bounds ?? defaultBounds;
        this.imageSource = opts.imageSource ?? (() => findImageSource());
        this.sentMode = this.sendMode;
    }

    // ---- state ----

    /** The view this window shows now (switched in its header, §2 K2). */
    get kind(): SatelliteKind { return this._kind; }
    get treeId(): TreeId | null { return this._treeId; }
    get treeName(): string { return this._treeName; }
    /** The window revision of the copy (-1 before the first tree). */
    get revision(): number { return this._revision; }
    get status(): WindowStatus | null { return this._status; }
    get connection(): SatelliteConnection { return this._connection; }
    /** The starting state, when it came before a listener did. */
    get initState(): { kind: SatelliteKind; state: unknown } | null { return this._init; }
    /**
     * The main window's person in the centre as it came with the last tree
     * (raw; parseMainFocus): set before the copy is loaded, so the start of
     * that tree may read it.
     */
    get mainFocus(): unknown { return this._mainFocus; }
    /** The copy has a tree. */
    get hasTree(): boolean { return this._treeId !== null && this._revision >= 0 && !this.gone; }
    /** Edits sent or waiting for the main window. */
    get pendingEdits(): number { return this.queue.length + (this.inFlight ? 1 : 0); }
    /** The tree of this window was deleted in the main window (§3.5b). */
    get treeGone(): boolean { return this.gone; }
    /** When the main window was last heard (its status): the copy was current then (§3.3 "as of"). */
    get lastHeardAt(): number { return this.lastHeard; }

    /** Nothing may be edited here now (§3.2, §3.3, §3.6). */
    readOnly(): boolean {
        const s = this._status;
        return this._connection !== 'connected' || !this.hasTree || !s || s.readOnly || s.live || s.locked;
    }

    /** Undo / redo from here goes: the main window has a step, and the copy may be edited or the step is a list's the main window lets go (N2). */
    stepOpen(which: 'undo' | 'redo'): boolean {
        const s = this._status;
        if (!s || !(which === 'undo' ? s.canUndo : s.canRedo)) return false;
        return !this.readOnly() || (!this.listsReadOnly() && (which === 'undo' ? s.undoOpen : s.redoOpen) === true);
    }

    /** The lists of people may not be changed here: as readOnly, but open while the main window says so (N2: it follows a research). */
    listsReadOnly(): boolean {
        const s = this._status;
        if (this._connection !== 'connected' || !this.hasTree || !s || s.locked) return true;
        return (s.readOnly || s.live) && s.listsOpen !== true;
    }

    /** What another window's choice does here (K2.1): the window's choice, else its view's default. */
    get followMode(): FollowMode {
        return effectiveFollowMode(this.followChoice(), this._kind);
    }

    set followMode(mode: FollowMode) {
        const wasMode = this.followMode;
        const wasOn = this.followSelection;
        try { this.storage?.setItem(followSelectionKey(this.windowId), followChoiceToStore(mode, this._kind)); } catch { /* no storage */ }
        const on = this.followSelection;
        if (on !== wasOn) this.emit('follow', on);
        if (this.followMode !== wasMode) this.emit('follow-mode', this.followMode);
        this.syncSendMode();
    }

    /** The window sends and takes the selection (any mode but off). */
    get followSelection(): boolean {
        return this.followMode !== 'off';
    }

    /** The send mode chosen in this window (spec 110 §1), also while "off"; none chosen: the default of the view shown now. */
    get sendModeChoice(): SendMode {
        return getSendModeChoice(this.windowId, this._kind, this.storage);
    }

    /**
     * What a choice here does in the main window now (spec 110 §1, §6): the
     * chosen send mode in a view that offers it while the window sends its
     * choices; `mark` otherwise.
     */
    get sendMode(): SendMode {
        return this.followSelection && sendModeAvailable(this._kind) ? this.sendModeChoice : 'mark';
    }

    /** Choose the send mode (kept for the window; the main window hears what it does now). */
    set sendMode(mode: SendMode) {
        setSendMode(this.windowId, mode, this.storage);
        this.syncSendMode();
    }

    /** The main window as this window shows it now (spec 110 §4, §7). */
    get mainState(): MainWindowState {
        return { open: this._connection === 'connected', followingAgent: this._connection === 'connected' && !!this._status?.followingAgent };
    }

    /** What a choice here does in the main window changed: said here, and to the main window (another than focus ends its run there). */
    private syncSendMode(): void {
        const mode = this.sendMode;
        if (mode === this.sentMode) return;
        this.sentMode = mode;
        this.emit('send-mode', mode);
        if (this.started) this.bus.post({ type: 'send-mode', windowId: this.windowId, mode });
    }

    private syncMainState(): void {
        const now = this.mainState;
        if (now.open === this.lastMainState.open && now.followingAgent === this.lastMainState.followingAgent) return;
        this.lastMainState = now;
        this.emit('main-state', now);
    }

    private followChoice(): FollowMode | null {
        try { return parseFollowChoice(this.storage?.getItem(followSelectionKey(this.windowId))); } catch { return null; }
    }

    on<K extends keyof SatelliteEvents>(event: K, cb: Listener<K>): () => void {
        let set = this.listeners.get(event);
        if (!set) { set = new Set(); this.listeners.set(event, set); }
        const l = cb as (p: unknown) => void;
        set.add(l);
        return () => { set!.delete(l); };
    }

    // ---- life ----

    start(): void {
        if (this.started) return;
        this.started = true;
        const sink: WindowEditSink = {
            edit: (label, context, listsOnly) => this.queueEdit(label, context, listsOnly),
            undo: () => this.undo(),
            redo: () => this.redo(),
            canUndo: () => this.stepOpen('undo'),
            canRedo: () => this.stepOpen('redo'),
            readOnly: () => this.readOnly(),
            listsReadOnly: () => this.listsReadOnly(),
            sessionEnded: () => this.takeHeld(),
        };
        this.data.setWindowSink(sink);
        const b = this.bus;
        this.unsubscribe.push(
            b.on('status', m => this.onStatus(m)),
            b.on('init', m => { this._init = { kind: m.kind, state: m.state }; this.emit('init', this._init); }),
            b.on('tree', m => this.onTree(m)),
            b.on('patch', m => this.onPatch(m)),
            b.on('edit-result', m => this.onEditResult(m)),
            b.on('select', m => this.onSelect(m)),
            b.on('main-bye', m => { if (m.from === this.mainId) this.mainId = null; }),
            b.on('focus-req', m => this.onFocusRequest(m.from)),
            b.on('focused', m => { if (m.from === this.mainId) this.focusWaiter?.(); }),
            b.on('close', () => { this.emit('close', {}); this.closeSelf(); }),
            b.on('research-menu', m => this.menuWaiters.get(m.reqId)?.(Array.isArray(m.items) ? m.items : [])),
            b.on('research-action-result', m => this.actionWaiters.get(m.reqId)?.(m.result)),
            b.on('research-state', m => { if (!this.mainId || m.from === this.mainId) this.emit('research-state', m.state); }),
            b.on('agent-state', m => { if (!this.mainId || m.from === this.mainId) this.emit('agent-state', m.state); }),
            b.on('fan-rod-colors', m => {
                if ((!this.mainId || m.from === this.mainId) && Array.isArray(m.memory)) this.emit('fan-rod-colors', { treeId: m.treeId, memory: m.memory });
            }),
            b.on('taking-over', m => this.emit('taking-over', { windowId: m.windowId || m.from })),
        );
        if (typeof window !== 'undefined') {
            const bye = () => this.bus.post({ type: 'bye', windowId: this.windowId, bounds: this.bounds() });
            window.addEventListener('pagehide', bye);
            this.unsubscribe.push(() => window.removeEventListener('pagehide', bye));
        }
        this.lastHeard = Date.now();
        this.watchdog = setInterval(() => this.checkMain(), MAIN_CHECK_MS);
        this.hello();
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        for (const u of this.unsubscribe.splice(0)) u();
        if (this.watchdog) clearInterval(this.watchdog);
        this.watchdog = null;
        this.data.setWindowSink(null);
    }

    // ---- actions ----

    /** Ask the main window for the whole agent's state (spec 097 K1.3: the mirror missed a revision). */
    requestAgentState(): void {
        if (this.started && this.mainId) this.bus.post({ type: 'agent-state-req', windowId: this.windowId });
    }

    /** This window takes over after the main window closed (spec 097 §7): the others stop waiting for their turn. */
    announceTakeover(): void {
        if (this.started) this.bus.post({ type: 'taking-over', windowId: this.windowId });
    }

    /** The main window's id (null: none known now); another one means its state comes anew. */
    get mainWindowId(): string | null { return this.mainId; }

    /**
     * This window switched its view (§2 K2): the main window's list names
     * the new one, and a hello after its reload says it too.
     */
    setKind(kind: SatelliteKind): void {
        if (kind === this._kind) return;
        const wasMode = this.followMode;
        this._kind = kind;
        // The view's default (or a switch of a view that cannot move its centre) may change what a choice does here.
        if (this.followMode !== wasMode) this.emit('follow-mode', this.followMode);
        if (this.started) this.bus.post({ type: 'view', windowId: this.windowId, kind, agent: this._agent });
        // A view without the send mode marks only (spec 110 §6): the main window's run of this window's choices ends.
        this.syncSendMode();
    }

    /** This window's own following of the agent (spec 097 §1–§3; null: no live session). */
    get agentFollow(): AgentFollow | null { return this._agent; }

    /** The window's following of the agent changed: the main window's list says it (the order of taking over, §7). */
    setAgentFollow(agent: AgentFollow | null): void {
        if (agent === this._agent) return;
        this._agent = agent;
        if (this.started) this.bus.post({ type: 'view', windowId: this.windowId, kind: this._kind, agent });
    }

    /**
     * This window opened another one itself (§2 ⧉): the main window lists it
     * at its hello and hands it `state` as its starting state (`init`), as
     * for a window it opened.
     */
    announceSpawn(windowId: string, kind: SatelliteKind, state: unknown): void {
        this.bus.post({ type: 'spawn', windowId, kind, treeId: this._treeId ?? this.requestedTreeId, ...(state !== undefined ? { state } : {}) });
    }

    undo(): void {
        if (this.mainId && (!this.readOnly() || this.stepOpen('undo'))) this.bus.post({ type: 'undo' });
    }

    redo(): void {
        if (this.mainId && (!this.readOnly() || this.stepOpen('redo'))) this.bus.post({ type: 'redo' });
    }

    /**
     * The person selected in this window (sent only while following the
     * selection, never back to where it came from, nor again when another
     * window gives back this window's own choice). It says what it does in
     * the main window (spec 110: the send mode) and its number.
     */
    announceSelection(personId: string | null): void {
        if (!this.followSelection || this.applyingRemoteSelection || personId === this.lastSelection) return;
        this.lastSelection = personId;
        this.bus.post({ type: 'select', personId, treeId: this._treeId, origin: this.windowId, intent: this.sendMode, seq: ++this.seq });
    }

    /**
     * Bring the main window to the front (§3.2 "Go to the main window"): its
     * window is focused where it can be, and asked to come forward. True when
     * it confirmed within 400 ms.
     */
    requestMainFocus(): Promise<boolean> {
        const main = this.mainId;
        if (!main) return Promise.resolve(false);
        try {
            const opener = typeof window !== 'undefined' ? (window.opener as Window | null) : null;
            if (opener && !opener.closed) opener.focus();
            else if (typeof window !== 'undefined') window.open('', MAIN_WINDOW_NAME)?.focus();
        } catch { /* another origin or gone */ }
        const answered = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => { this.focusWaiter = null; resolve(false); }, FOCUS_WAIT_MS);
            this.focusWaiter = () => { clearTimeout(timer); this.focusWaiter = null; resolve(true); };
        });
        this.bus.post({ type: 'focus-req', to: main });
        return answered;
    }

    /** An address or a launch this window got: the main window opens it (§5, launchQueue). */
    forwardLink(link: { search?: string; files?: unknown[] }): void {
        this.bus.post({ type: 'link', ...link });
    }

    /**
     * The research's rows of a person's menu as the main window offers them
     * (§2, 2g); null when it does not answer within `waitMs` (closed, busy).
     */
    requestResearchMenu(personId: string, waitMs: number): Promise<unknown[] | null> {
        if (this._connection !== 'connected') return Promise.resolve(null);
        const reqId = `${this.windowId}:${++this.menuReqs}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.menuWaiters.delete(reqId); resolve(null); }, waitMs);
            this.menuWaiters.set(reqId, (items) => { clearTimeout(timer); this.menuWaiters.delete(reqId); resolve(items); });
            this.bus.post({ type: 'research-menu-req', reqId, personId, treeId: this._treeId });
        });
    }

    /** "On the map" of this window's Table (spec 098 §6): the main window shows the selection on its map. */
    showOnMap(ref: string): void {
        this.bus.post({ type: 'show-on-map', ref, treeId: this._treeId });
    }

    /** A research action: the main window runs it (§2 person menu). */
    researchAction(action: string, args?: unknown): void {
        this.bus.post({ type: 'research-action', action, args });
    }

    /**
     * A research action whose outcome the window waits for (K3: an answer
     * sent from the overview window); null when the main window does not
     * answer within `waitMs`.
     */
    researchActionResult(action: string, args: unknown, waitMs: number): Promise<unknown> {
        if (this._connection !== 'connected') return Promise.resolve(null);
        const reqId = `${this.windowId}:a${++this.menuReqs}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { this.actionWaiters.delete(reqId); resolve(null); }, waitMs);
            this.actionWaiters.set(reqId, (result) => { clearTimeout(timer); this.actionWaiters.delete(reqId); resolve(result); });
            this.bus.post({ type: 'research-action', action, args, reqId });
        });
    }

    // ---- inside ----

    private emit<K extends keyof SatelliteEvents>(event: K, payload: SatelliteEvents[K]): void {
        for (const cb of [...(this.listeners.get(event) ?? [])]) {
            try { cb(payload); } catch (err) { console.error('satellite listener failed', event, err); }
        }
    }

    private hello(): void {
        this.helloAt = Date.now();
        this.images = this.imageSource();
        this.bus.post({ type: 'hello', windowId: this.windowId, kind: this._kind, treeId: this._treeId ?? this.requestedTreeId, agent: this._agent, takesData: true, ...(this.images ? { imageRefs: true as const } : {}) });
    }

    private setConnection(c: SatelliteConnection): void {
        if (this._connection === c) return;
        this._connection = c;
        this.emit('connection', c);
        this.syncMainState();
    }

    private onStatus(m: MessageOf<'status'>): void {
        const { type: _t, from, ...status } = m;
        this.lastHeard = Date.now();
        if (from !== this.mainId) {
            if (this.mainId !== null || this.hasTree) {
                // Another main window (the earlier one reloaded or closed): edits on its revisions are void; its tree comes anew.
                this.queue.length = 0;
                this.inFlight = null;
            }
            this.mainId = from;
        }
        // A main window that does not know this one (its first status, after its reload, a hello lost): hello
        // (not again while the last one may still be on its way).
        if (!status.windows.includes(this.windowId) && Date.now() - this.helloAt > HELLO_RETRY_MS) this.hello();
        this._status = status;
        // The tree renamed in the main window: the title and the header follow.
        if (this.hasTree && status.treeId === this._treeId && status.treeName && status.treeName !== this._treeName) {
            this._treeName = status.treeName;
            this.emit('renamed', status.treeName);
        }
        this.setConnection('connected');
        this.syncMainState();
        if (this.hasTree && !status.treeExists && status.treeId === null) this.markGone();
        if (status.locked && this.hasTree) this.dropLockedCopy();
        this.emit('status', status);
    }

    /**
     * The tree was locked in the main window (§3.6): this window's copy goes
     * too (no data of a locked tree stays shown or in memory); the main window
     * sends the tree anew after the unlock.
     */
    private dropLockedCopy(): void {
        const treeId = this._treeId!;
        this.queue.length = 0;
        this.inFlight = null;
        this.heldTree = null;
        this.heldPatch = null;
        this._revision = -1;
        this.data.loadFromWindow(treeId, EMPTY_TREE_JSON);
        this.emit('data', { treeId, revision: -1, source: 'tree' });
    }

    private checkMain(): void {
        if (this.probing || Date.now() - this.lastHeard < MAIN_SILENCE_MS) return;
        this.probing = true;
        void isMainAlive(this.locks === undefined ? undefined : this.locks).then((alive) => {
            this.probing = false;
            if (Date.now() - this.lastHeard < MAIN_SILENCE_MS) return;   // heard meanwhile
            if (alive) {
                // Alive but quiet (hidden and slowed down): ask again for the tree when there is none.
                if (!this.hasTree) this.hello();
                return;
            }
            this.mainId = null;
            this.setConnection('main-closed');
        });
    }

    private markGone(): void {
        if (this.gone) return;
        this.gone = true;
        this.queue.length = 0;
        this.inFlight = null;
        this.emit('tree-gone', { treeId: this._treeId });
    }

    /**
     * Put the main window's images in place of their references (at once: the
     * main window keeps an image a while only). False when one could not be
     * taken: the main window is asked for the whole tree with its images.
     */
    private takeImages(m: { data?: unknown; imageRefs?: true }): boolean {
        if (!m.imageRefs) return true;
        if (this.images && restoreImages(m.data, this.images)) return true;
        this.images = null;
        this.bus.post({ type: 'resend', windowId: this.windowId });
        return false;
    }

    private onTree(m: MessageOf<'tree'>): void {
        if (!this.takeImages(m)) return;
        if (this.data.isEditSessionActive()) {
            this.heldTree = m;
            return;
        }
        this.applyTree(m);
    }

    private applyTree(m: MessageOf<'tree'>): void {
        this.heldTree = null;
        this.heldPatch = null;
        // The tree this window shows was deleted in the main window: it stays empty (§3.5b).
        if (m.replaces && !m.replaces.exists && this._treeId !== null && m.replaces.treeId === this._treeId && this._treeId !== m.treeId) {
            this.markGone();
            return;
        }
        const switchedFrom = this.hasTree && this._treeId !== m.treeId ? { treeId: this._treeId!, name: this._treeName } : null;
        if (switchedFrom) this.lastSelection = null;
        this.gone = false;
        this.queue.length = 0;
        this.inFlight = null;
        this._mainFocus = m.focus ?? null;
        this.data.loadFromWindow(m.treeId, m.data ?? m.json);
        this._treeId = m.treeId;
        this._treeName = m.name;
        this._revision = m.revision;
        const afterConflict = this.conflictPending;
        this.conflictPending = false;
        this.emit('tree', { treeId: m.treeId, name: m.name, revision: m.revision, switchedFrom, afterConflict });
        this.emit('data', { treeId: m.treeId, revision: m.revision, source: 'tree' });
    }

    private onPatch(m: MessageOf<'patch'>): void {
        if (m.treeId !== this._treeId || m.revision <= this._revision || this.gone) return;
        if (!this.takeImages(m)) return;
        if (this.inFlight || this.queue.length > 0 || this.data.isEditSessionActive()) {
            this.heldPatch = m;
            return;
        }
        this.applyPatch(m);
    }

    private applyPatch(m: MessageOf<'patch'>): void {
        this.heldPatch = null;
        this.data.loadFromWindow(m.treeId, m.data ?? m.json);
        this._revision = m.revision;
        this.emit('data', { treeId: m.treeId, revision: m.revision, source: 'patch' });
    }

    /** What waited for a staged dialog or an edit on its way comes in now. */
    private takeHeld(): void {
        if (this.data.isEditSessionActive()) return;
        if (this.heldTree) { this.applyTree(this.heldTree); return; }
        const p = this.heldPatch;
        if (p && !this.inFlight && this.queue.length === 0) {
            if (p.treeId === this._treeId && p.revision > this._revision) this.applyPatch(p);
            else this.heldPatch = null;
        }
    }

    private queueEdit(label: string, context?: unknown, listsOnly?: boolean): void {
        if (!this.hasTree) return;
        this.queue.push({ json: this.data.windowDataJson(), label, ...(context !== undefined ? { context } : {}), ...(listsOnly ? { listsOnly: true as const } : {}) });
        this.sendNext();
    }

    private sendNext(): void {
        if (this.inFlight || this.queue.length === 0 || !this.mainId || !this._treeId) return;
        const next = this.queue.shift()!;
        const editId = newWindowId();
        this.inFlight = { editId, ...(next.context !== undefined ? { context: next.context } : {}) };
        this.bus.post({ type: 'edit', windowId: this.windowId, editId, treeId: this._treeId, baseRevision: this._revision, json: next.json, label: next.label, ...(next.listsOnly ? { listsOnly: true as const } : {}) });
    }

    private onEditResult(m: MessageOf<'edit-result'>): void {
        const sent = this.inFlight;
        if (!sent || m.editId !== sent.editId) return;
        this.inFlight = null;
        if (m.ok) {
            this._revision = Math.max(this._revision, m.revision);
            this.emit('saved', { revision: m.revision });
            if (this.queue.length > 0) this.sendNext();
            else this.takeHeld();
            return;
        }
        // Built on a state the main window no longer has: what waited behind it goes too; the fresh tree follows.
        const drafts = [sent.context, ...this.queue.map(q => q.context)].filter(c => c !== undefined);
        this.queue.length = 0;
        this.heldPatch = null;
        this.conflictPending = true;
        this.emit('conflict', { reason: m.reason, drafts });
    }

    private onSelect(m: MessageOf<'select'>): void {
        if (!this.followSelection) return;
        if (m.treeId && m.treeId !== this._treeId) return;
        this.lastSelection = m.personId;
        this.applyingRemoteSelection = true;
        try {
            this.emit('select', { personId: m.personId, origin: m.origin });
        } finally {
            this.applyingRemoteSelection = false;
        }
    }

    private onFocusRequest(from: string): void {
        try { if (typeof window !== 'undefined') window.focus(); } catch { /* not allowed */ }
        let answered = false;
        void answerWhenFocused(this.bus, from, this.hasFocus).then((ok) => { answered = ok; });
        // As the main window decides (400 ms): not forward by then, the title is marked.
        setTimeout(() => {
            if (!answered && !this.hasFocus()) this.emit('attention', {});
        }, FOCUS_WAIT_MS);
    }
}

function sessionStorageOrNull(): Pick<Storage, 'getItem' | 'setItem'> | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}

function defaultBounds(): WindowBounds | undefined {
    if (typeof window === 'undefined') return undefined;
    return { left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight };
}
