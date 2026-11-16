/**
 * Taking over after the main window closed (spec 097 §7, K2.6): while the
 * main window followed a research live, one of the other windows becomes the
 * main window by itself and following goes on there.
 *
 * - Only when the main window's last status was live and the window learnt
 *   that it closed (`main-closed`: no status for 3 s and no window holds its
 *   lock; a main window's F5 takes the lock again long before that).
 * - The order: the windows following the agent (attached or paused) first,
 *   then the detached ones, each group as the main window listed them (the
 *   oldest first); a window without a following of its own (the research
 *   overview's window) never takes over. The window waits `rank × 400 ms`,
 *   then takes the lock (`ifAvailable`): one window wins, it tells the
 *   others (`taking-over`) and starts again as the main window.
 * - Without a stored address of the research's bridge the window cannot
 *   follow it as the main window: it does not become one, and says so
 *   (`failed`, the manual way of spec 079 stays).
 * - The others wait for the new main window (their hello as at any of its
 *   starts) and say once that another window took over.
 */

import type { AgentFollow } from './agent-follow-state.js';
import type { SatelliteConnection } from './satellite.js';
import type { WindowStatus } from './window-bus.js';

/** The wait of each place in the order (the first window starts at once). */
export const TAKEOVER_STEP_MS = 400;

/** Where taking over stands in this window: waiting for its turn, under way (the reload), impossible. */
export type TakeoverPhase = 'waiting' | 'running' | 'failed' | null;

/** What the new main window needs to follow the research again (no bridge address or token). */
export interface TakeoverLive {
    treeId: string;
    researchId: string;
    /** ◎ was on in the closed main window. */
    follow: boolean;
}

/**
 * The order of taking over: the windows following the agent (attached,
 * paused) first, then the detached ones, each group in the main window's
 * order. A window without a following of its own is left out.
 */
export function takeoverOrder(windows: readonly string[], agents: Readonly<Record<string, AgentFollow | null | undefined>>): string[] {
    const known = windows.filter(id => !!agents[id]);
    return [...known.filter(id => agents[id] !== 'detached'), ...known.filter(id => agents[id] === 'detached')];
}

/** This window's place in the order of the status (-1: it does not take over). */
export function takeoverRank(windowId: string, status: Pick<WindowStatus, 'windows' | 'agents'> | null): number {
    if (!status) return -1;
    return takeoverOrder(status.windows ?? [], status.agents ?? {}).indexOf(windowId);
}

/** What taking over needs from the satellite client (SatelliteClient fits). */
export interface TakeoverClient {
    readonly windowId: string;
    readonly connection: SatelliteConnection;
    readonly status: WindowStatus | null;
    readonly treeId: string | null;
    on(event: 'connection', cb: (c: SatelliteConnection) => void): () => void;
    on(event: 'taking-over', cb: (e: { windowId: string }) => void): () => void;
    /** Tell the other windows this one takes over. */
    announceTakeover(): void;
}

export interface TakeoverDeps {
    /** The research the main window followed (the agent's mirror; null: not known). */
    researchId: () => string | null;
    /** ◎ was on in the main window. */
    followOn: () => boolean;
    /** The research's bridge address is stored in this browser (read only, the bridge is not asked). */
    hasBridge: (researchId: string) => boolean;
    /**
     * Take the lock and start again as the main window with `live`;
     * `locked` runs once the lock is held, before the reload. False: another
     * window holds the lock.
     */
    become: (live: TakeoverLive, locked: () => void) => Promise<boolean>;
    /** The phase changed (the strip looks again). */
    changed: () => void;
    /** Another window took over and the new main window is here (a toast). */
    takenOver: () => void;
    /** Tests: the timer. */
    setTimer?: (cb: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export class Takeover {
    private _phase: TakeoverPhase = null;
    private timer: unknown = null;
    /** Another window said it takes over: its start as the main window is said once it is here. */
    private otherTook = false;
    private readonly off: (() => void)[] = [];
    private readonly setTimer: (cb: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;

    constructor(private readonly client: TakeoverClient, private readonly deps: TakeoverDeps) {
        this.setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
        this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    }

    get phase(): TakeoverPhase { return this._phase; }

    /** The strip's word (`waiting` shows as the main window closed). */
    get stripPhase(): 'running' | 'failed' | null {
        return this._phase === 'running' || this._phase === 'failed' ? this._phase : null;
    }

    start(): this {
        this.off.push(
            this.client.on('connection', (c) => this.onConnection(c)),
            this.client.on('taking-over', (e) => this.onOtherTakes(e.windowId)),
        );
        return this;
    }

    stop(): void {
        for (const u of this.off.splice(0)) u();
        this.cancel();
    }

    private set(phase: TakeoverPhase): void {
        if (phase === this._phase) return;
        this._phase = phase;
        this.deps.changed();
    }

    private cancel(): void {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
    }

    private onConnection(c: SatelliteConnection): void {
        if (c === 'main-closed') {
            const status = this.client.status;
            // Only a research followed live is taken over (a tree read-only without one: spec 079 as it is).
            if (!status?.live || this._phase !== null || !this.deps.researchId()) return;
            const rank = takeoverRank(this.client.windowId, status);
            if (rank < 0) return;
            this.set('waiting');
            this.timer = this.setTimer(() => { this.timer = null; void this.turn(); }, rank * TAKEOVER_STEP_MS);
            return;
        }
        if (c !== 'connected') return;
        // A main window again (the one that took over, or one opened by hand): nothing to take over any more.
        this.cancel();
        if (this._phase !== 'running') this.set(null);
        if (this.otherTook) {
            this.otherTook = false;
            this.deps.takenOver();
        }
    }

    private onOtherTakes(windowId: string): void {
        if (windowId === this.client.windowId || this._phase === 'running') return;
        this.otherTook = true;
        this.cancel();
        if (this._phase === 'waiting' || this._phase === 'failed') this.set(null);
    }

    private async turn(): Promise<void> {
        if (this._phase !== 'waiting' || this.client.connection !== 'main-closed') return;
        const researchId = this.deps.researchId();
        const treeId = this.client.status?.treeId ?? this.client.treeId;
        if (!researchId) {
            this.set(null);
            return;
        }
        if (!treeId || !this.deps.hasBridge(researchId)) {
            this.set('failed');
            return;
        }
        const live: TakeoverLive = { treeId, researchId, follow: this.deps.followOn() };
        let became = false;
        try {
            became = await this.deps.become(live, () => {
                this.set('running');
                this.client.announceTakeover();
            });
        } catch {
            became = false;
        }
        // Another window (or a tab) has the lock: its status comes; until then the main window is closed here.
        if (!became && this._phase === 'waiting') this.set(null);
    }
}
