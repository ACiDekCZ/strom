/**
 * The app's windows talk over one BroadcastChannel, `strom-windows`
 * (spec 079 §0 "Zprávy"). Every message is `{ type, from, ... }`, `from`
 * being the sending window's id; a message with `to` is meant for that
 * window only. A window never handles its own messages.
 *
 * The tree travels as one JSON string of the whole data (`json`): the
 * receiver parses it in a fraction of the time a structured clone of the
 * object takes, and it holds exactly what storage would (prototype S0).
 */

import type { TreeId } from '../types.js';
import type { SatelliteKind } from './window-role.js';

export const WINDOW_CHANNEL = 'strom-windows';

/** The main window's state every satellite follows (sent on change and as a heartbeat ≤ 1 s). */
export interface WindowStatus {
    /** The open tree follows a live research: satellites are read-only (§3.2). */
    live: boolean;
    /** The open tree is locked (encryption): satellites show "locked" (§3.6). */
    locked: boolean;
    /** Nothing may be edited now (live, locked, a newer app's tree, the tree locked against edits). */
    readOnly: boolean;
    /** The research's state for the overview window (K3); null = no research. */
    researchState: unknown;
    /** The main window has a tree open that exists. */
    treeExists: boolean;
    /** The tree open in the main window and its window revision. */
    treeId: TreeId | null;
    /** The open tree's name, as renamed meanwhile (the satellites' titles follow it). */
    treeName: string;
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    /** The satellites the main window knows (one missing from it says hello again: a main window after its reload). */
    windows: string[];
}

/** Where a satellite stands on screen (K4 layout). */
export interface WindowBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

export type WindowMessageBody =
    /** sat → main: after start and after its reload. `state`: the view's own state (K4). */
    | { type: 'hello'; windowId: string; kind: SatelliteKind; treeId: TreeId | null; state?: unknown }
    /** main → sat: the view's starting state from openSatellite (once, before `tree`). */
    | { type: 'init'; to: string; kind: SatelliteKind; state: unknown }
    /**
     * main → sat: the whole open tree (unlocked). To one window (`to`) after
     * its hello or a refused edit; to all after a tree switch. `replaces`: the
     * tree sent before it, and whether that one still exists (deleted: §3.5b).
     */
    | { type: 'tree'; to?: string; treeId: TreeId; name: string; revision: number; json: string; replaces?: { treeId: TreeId; exists: boolean } }
    /** main → all: the tree after a save (any: own edit, a satellite's, undo, the research). */
    | { type: 'patch'; treeId: TreeId; revision: number; json: string }
    /** sat → main: an edit made on the copy of revision `baseRevision`; `json` = the whole data after it. */
    | { type: 'edit'; windowId: string; editId: string; treeId: TreeId; baseRevision: number; json: string; label: string }
    /** main → sat: the edit's result; `ok: false` = not applied (a fresh `tree` follows to that window). */
    | { type: 'edit-result'; to: string; editId: string; ok: boolean; revision: number; reason?: EditRefusal }
    /** all → all: the selected person (only windows following the selection send and take it). */
    | { type: 'select'; personId: string | null; treeId: TreeId | null; origin: string }
    /** sat → main: undo / redo from the main window's history (the result comes as `patch`). */
    | { type: 'undo' }
    | { type: 'redo' }
    /** main → all */
    | ({ type: 'status' } & WindowStatus)
    /** a request to come to the front, and its confirmation (the window got the focus). */
    | { type: 'focus-req'; to: string }
    | { type: 'focused'; to: string }
    /** sat / overview → main: a research action to run in the main window (§2, §6). */
    | { type: 'research-action'; action: string; args?: unknown }
    /**
     * sat → main: the research's rows of the person menu (§2, 2g), as the
     * main window offers them now; the answer goes to that window only.
     */
    | { type: 'research-menu-req'; reqId: string; personId: string; treeId: TreeId | null }
    | { type: 'research-menu'; to: string; reqId: string; items: unknown[] }
    /** main → overview window: the research's state (§6, K3). */
    | { type: 'research-state'; state: unknown }
    /** sat → main: the window is going away. */
    | { type: 'bye'; windowId: string; bounds?: WindowBounds }
    /** main → all: the main window is going away. */
    | { type: 'main-bye' }
    /** second tab / sat → main: an address or a launch to open there (?person= ?live= ?send= ?import-url=, files). */
    | { type: 'link'; search?: string; files?: unknown[] }
    /** main → sat: close yourself (a window the main window holds no reference to). */
    | { type: 'close'; to: string };

/** Why an edit was not applied. */
export type EditRefusal = 'revision' | 'tree' | 'read-only' | 'busy' | 'invalid';

export type WindowMessageType = WindowMessageBody['type'];
export type WindowMessage = WindowMessageBody & { from: string };
export type MessageOf<T extends WindowMessageType> = Extract<WindowMessage, { type: T }>;

/** The part of BroadcastChannel the bus uses (a test passes its own). */
export interface ChannelLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    close(): void;
}

const TYPES = new Set<string>(['hello', 'init', 'tree', 'patch', 'edit', 'edit-result', 'select', 'undo', 'redo', 'status',
    'focus-req', 'focused', 'research-action', 'research-menu-req', 'research-menu', 'research-state', 'bye', 'main-bye', 'link', 'close']);

function isWindowMessage(data: unknown): data is WindowMessage {
    if (!data || typeof data !== 'object') return false;
    const m = data as { type?: unknown; from?: unknown };
    return typeof m.type === 'string' && TYPES.has(m.type) && typeof m.from === 'string';
}

type AnyHandler = (message: WindowMessage) => void;

/** One window's end of the channel. */
export class WindowBus {
    private readonly channel: ChannelLike;
    private readonly handlers = new Map<string, Set<AnyHandler>>();
    private readonly anyHandlers = new Set<AnyHandler>();
    private closed = false;
    private readonly listener = (event: { data: unknown }) => this.receive(event.data);

    /** `id`: this window's id (the `from` of what it sends). */
    constructor(readonly id: string, channel?: ChannelLike) {
        this.channel = channel ?? (new BroadcastChannel(WINDOW_CHANNEL) as unknown as ChannelLike);
        this.channel.addEventListener('message', this.listener);
    }

    /** Send a message to the other windows. */
    post(message: WindowMessageBody): void {
        if (this.closed) return;
        try {
            this.channel.postMessage({ ...message, from: this.id });
        } catch (err) {
            console.error('window message not sent', message.type, err);
        }
    }

    /** Handle messages of one type. Returns the unsubscribe. */
    on<T extends WindowMessageType>(type: T, handler: (message: MessageOf<T>) => void): () => void {
        let set = this.handlers.get(type);
        if (!set) { set = new Set(); this.handlers.set(type, set); }
        const h = handler as AnyHandler;
        set.add(h);
        return () => { set!.delete(h); };
    }

    /** Handle every message (after the typed handlers). */
    onAny(handler: AnyHandler): () => void {
        this.anyHandlers.add(handler);
        return () => { this.anyHandlers.delete(handler); };
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.channel.removeEventListener('message', this.listener);
        this.channel.close();
        this.handlers.clear();
        this.anyHandlers.clear();
    }

    private receive(data: unknown): void {
        if (this.closed || !isWindowMessage(data)) return;
        if (data.from === this.id) return;
        const to = (data as { to?: unknown }).to;
        if (typeof to === 'string' && to !== this.id) return;
        for (const h of [...(this.handlers.get(data.type) ?? [])]) {
            try { h(data); } catch (err) { console.error('window message handler failed', data.type, err); }
        }
        for (const h of [...this.anyHandlers]) {
            try { h(data); } catch (err) { console.error('window message handler failed', data.type, err); }
        }
    }
}

/** How long a request to come to the front waits for the window's confirmation (§4). */
export const FOCUS_WAIT_MS = 400;

/**
 * Answer a request to come to the front once this window has the focus
 * (now, or on its `focus` event within a second). Shared by the main window
 * and the satellites.
 */
export function answerWhenFocused(bus: WindowBus, to: string, hasFocus: () => boolean): Promise<boolean> {
    if (hasFocus()) {
        bus.post({ type: 'focused', to });
        return Promise.resolve(true);
    }
    if (typeof window === 'undefined') return Promise.resolve(false);
    return new Promise((resolve) => {
        const done = (ok: boolean) => {
            window.removeEventListener('focus', onFocus);
            clearTimeout(timer);
            if (ok) bus.post({ type: 'focused', to });
            resolve(ok);
        };
        const onFocus = () => done(true);
        const timer = setTimeout(() => done(false), 1000);
        window.addEventListener('focus', onFocus);
    });
}

/**
 * Channels of one in-memory "origin" (tests): what one posts, the others get
 * asynchronously as a structured clone, as BroadcastChannel does.
 */
export function createMemoryHub(): { channel(): ChannelLike; flush(): Promise<void> } {
    const members = new Set<{ listeners: Set<(e: { data: unknown }) => void> }>();
    let pending: Promise<void> = Promise.resolve();
    return {
        channel(): ChannelLike {
            const me = { listeners: new Set<(e: { data: unknown }) => void>() };
            members.add(me);
            return {
                postMessage(message: unknown) {
                    const copy = structuredClone(message);
                    const targets = [...members].filter(m => m !== me);
                    pending = pending.then(() => {
                        for (const t of targets) for (const l of [...t.listeners]) l({ data: copy });
                    });
                },
                addEventListener(_type, listener) { me.listeners.add(listener); },
                removeEventListener(_type, listener) { me.listeners.delete(listener); },
                close() { members.delete(me); },
            };
        },
        /** Wait until every message posted so far (and those posted while delivering) was delivered. */
        async flush() {
            let last: Promise<void> | null = null;
            while (last !== pending) {
                last = pending;
                await last;
            }
        },
    };
}
