/**
 * A satellite window's own following of the agent (spec 097 §1–§3, §6):
 *
 * - `attached`: the window follows the agent in the view it shows (the
 *   default while the main window follows a research live);
 * - `paused`: the window was moved, zoomed or someone was chosen in it; it
 *   comes back by itself after a while without touching (live-follow-ui's
 *   timer) or with Back to the agent;
 * - `detached`: "Detach this window" — no jumps until Follow the agent; the
 *   agent's marks stay.
 * null: the main window follows no research live (no strip, nothing kept).
 *
 * Only `detached` is kept (sessionStorage, per window): it survives the
 * window's reload, a pause does not. The end of the live session forgets it;
 * a main window that reloads (another window id) says "not live" for a
 * moment before its following comes back, so that alone forgets nothing
 * until it stays so for FORGET_AFTER_MS.
 * The state is the window's own: nothing of it reaches the other windows but
 * the main window's list (hello / view, for the order of taking over, §7).
 */

export type AgentFollow = 'attached' | 'paused' | 'detached';

/** sessionStorage key of one window's detachment (survives its reload, not other windows). */
export function agentFollowKey(windowId: string): string {
    return `strom.win.agent.${windowId}`;
}

/** A window's state as it came in a message (anything else: none). */
export function parseAgentFollow(raw: unknown): AgentFollow | null {
    return raw === 'attached' || raw === 'paused' || raw === 'detached' ? raw : null;
}

/** A main window not following live this long (after its reload) forgets a window's detachment. */
export const FORGET_AFTER_MS = 15_000;

export type AgentFollowStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** What changed: the state, or the end of the live session (the window says so once). */
export interface AgentFollowChange {
    value: AgentFollow | null;
    /** The live session ended in the main window (not its reload). */
    ended: boolean;
}

export class AgentFollowState {
    private live = false;
    private paused = false;
    private detached = false;
    /** Since when the main window has said "not live" without having said "live" before (its reload). */
    private notLiveSince: number | null = null;
    private readonly listeners = new Set<(c: AgentFollowChange) => void>();
    private readonly now: () => number;

    constructor(private readonly windowId: string, private readonly storage: AgentFollowStorage | null, opts: { now?: () => number } = {}) {
        this.now = opts.now ?? Date.now;
    }

    /** The window's state now (null: no live session). */
    get value(): AgentFollow | null {
        if (!this.live) return null;
        if (this.detached) return 'detached';
        return this.paused ? 'paused' : 'attached';
    }

    /** The window follows (attached or paused): the agent's jumps apply here. */
    get following(): boolean {
        return this.live && !this.detached;
    }

    onChange(cb: (c: AgentFollowChange) => void): () => void {
        this.listeners.add(cb);
        return () => { this.listeners.delete(cb); };
    }

    /**
     * The main window's status: live or not. `sameMain`: from the main window
     * that sent the status before (false after its reload, or the first one).
     */
    setLive(live: boolean, sameMain: boolean): void {
        const before = this.value;
        if (live) {
            this.notLiveSince = null;
            if (!this.live) {
                this.live = true;
                this.paused = false;
                this.detached = this.read() === 'detached';
            }
            this.emitIfChanged(before, false);
            return;
        }
        const wasLive = this.live;
        this.live = false;
        this.paused = false;
        if (wasLive && sameMain) {
            // The session ended (End following, or by itself): the detachment is forgotten (§6).
            this.forget();
            this.emitIfChanged(before, true);
            return;
        }
        // Not live yet (a main window after its reload, or none): forgotten only when it stays so.
        const t = this.now();
        if (!sameMain || this.notLiveSince === null) this.notLiveSince = t;
        else if (t - this.notLiveSince >= FORGET_AFTER_MS) this.forget();
        this.emitIfChanged(before, false);
    }

    /** "Detach this window" (§2): no jumps here until Follow the agent. */
    detach(): void {
        if (!this.live) return;
        const before = this.value;
        this.detached = true;
        this.paused = false;
        this.write('detached');
        this.emitIfChanged(before, false);
    }

    /** "Follow the agent" (§2): following here again. */
    attach(): void {
        if (!this.live) return;
        const before = this.value;
        this.detached = false;
        this.paused = false;
        this.forget();
        this.emitIfChanged(before, false);
    }

    /** Following here paused or back (§3; nothing while detached or not live). */
    setPaused(paused: boolean): void {
        if (!this.live || this.detached) return;
        const before = this.value;
        this.paused = paused;
        this.emitIfChanged(before, false);
    }

    // ---- inside ----

    private read(): string | null {
        try { return this.storage?.getItem(agentFollowKey(this.windowId)) ?? null; } catch { return null; }
    }

    private write(value: string): void {
        try { this.storage?.setItem(agentFollowKey(this.windowId), value); } catch { /* not kept */ }
    }

    private forget(): void {
        try { this.storage?.removeItem(agentFollowKey(this.windowId)); } catch { /* none */ }
    }

    private emitIfChanged(before: AgentFollow | null, ended: boolean): void {
        const value = this.value;
        if (value === before && !ended) return;
        for (const cb of [...this.listeners]) {
            try { cb({ value, ended }); } catch (err) { console.error('agent follow listener failed', err); }
        }
    }
}

/** This window's state (null: the main window, the overview window, a plain tab). */
let current: AgentFollowState | null = null;

/** Start this satellite's own following state (once; main.ts startSatelliteWindow). */
export function startAgentFollowState(windowId: string, storage: AgentFollowStorage | null = sessionStorageOrNull()): AgentFollowState {
    current = new AgentFollowState(windowId, storage);
    return current;
}

export function agentFollowState(): AgentFollowState | null {
    return current;
}

/** This window's following of the agent (null: no live session, or not a satellite). */
export function windowAgentFollow(): AgentFollow | null {
    return current?.value ?? null;
}

function sessionStorageOrNull(): AgentFollowStorage | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
        return null;
    }
}
