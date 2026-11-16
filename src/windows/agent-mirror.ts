/**
 * A satellite window's mirror of the agent's state (spec 097 K1.3, K3.1):
 * what the main window has of the followed research (its session, the
 * Table's research input, the cards' research word, the bridge's status,
 * the lines' places, following), as its `agent-state` messages say it.
 * Nothing here talks to a bridge. The app reads it through research-ui
 * (setAgentMirror) and src/ui/agent-window-ui.ts.
 *
 * A delta on a revision the mirror does not stand at, or a status whose
 * `agentRev` stays elsewhere for RECHECK_MS, asks the main window for the
 * whole state (at most once per ASK_GAP_MS). Another main window (the
 * earlier one reloaded) means everything comes anew.
 *
 * For what builds on it (D2 a window's own following, D4 taking over):
 * `live()` says the main window's following in brief, `follow()` its
 * following's switch and view, `onChange` names the sections that changed.
 */

import type { LiveSession } from '../ui/research-ui.js';
import type { DirectionPlaces } from '../research-directions-write.js';
import type { WindowStatus } from './window-bus.js';
import { overviewSessionFromData, type OverviewSessionData } from './overview-window.js';
import {
    AgentMirrorStore, type AgentSectionName, type AgentWorkData, type AgentStatusData, type AgentFollowData,
} from './agent-state.js';

/** A status whose revision differs is looked at again after this long (the delta may be on its way). */
export const RECHECK_MS = 250;
/** The whole state is asked for at most this often. */
export const ASK_GAP_MS = 1500;

/** The part of the satellite client the mirror uses (src/windows/satellite.ts; a fake in a test). */
export interface AgentMirrorClient {
    on(event: 'agent-state', cb: (state: unknown) => void): () => void;
    on(event: 'status', cb: (status: WindowStatus) => void): () => void;
    requestAgentState(): void;
    readonly mainWindowId: string | null;
}

/** The main window's following in brief (D2, D4). */
export interface AgentMirrorLive {
    treeId: string | null;
    researchId: string | null;
    /** Since when the bridge does not answer (ms; 0/undefined: it answers). */
    lostSince: number;
    ended: boolean;
    /** Whom the agent works on (the session's `working`). */
    working: LiveSession['working'];
}

export type AgentMirrorListener = (changed: readonly AgentSectionName[]) => void;

export class AgentMirror {
    private readonly store = new AgentMirrorStore();
    private readonly listeners = new Set<AgentMirrorListener>();
    private readonly unsubscribe: (() => void)[] = [];
    private main: string | null = null;
    private askedAt = -Infinity;
    private recheck: ReturnType<typeof setTimeout> | null = null;
    private lastStatus: WindowStatus | null = null;
    private readonly now: () => number;
    private sessionMemo: { from: unknown; session: LiveSession | null } = { from: undefined, session: null };
    private placesMemo: { from: unknown; places: DirectionPlaces | null } = { from: undefined, places: null };
    private cardsMemo: { from: unknown; cards: Map<string, Record<string, unknown>> } = { from: undefined, cards: new Map() };

    constructor(private readonly client: AgentMirrorClient, opts: { now?: () => number } = {}) {
        this.now = opts.now ?? Date.now;
    }

    start(): this {
        this.unsubscribe.push(
            this.client.on('agent-state', state => this.take(state)),
            this.client.on('status', status => this.onStatus(status)),
        );
        return this;
    }

    stop(): void {
        for (const u of this.unsubscribe.splice(0)) u();
        if (this.recheck) clearTimeout(this.recheck);
        this.recheck = null;
        this.listeners.clear();
    }

    /** Be told which sections changed; returns the way to stop. */
    onChange(cb: AgentMirrorListener): () => void {
        this.listeners.add(cb);
        return () => { this.listeners.delete(cb); };
    }

    /** The revision the mirror stands at (null: nothing yet). */
    get rev(): number | null {
        return this.store.rev;
    }

    /** The tree open in the main window (null: none, or nothing heard yet). */
    treeId(): string | null {
        return this.store.get('link')?.treeId ?? null;
    }

    /** The main window's metadata of its tree (a subset: id, name, research, researchEdges, researchEdgeMotion). */
    meta(): Record<string, unknown> | null {
        return this.store.get('link')?.meta ?? null;
    }

    /** The followed session, with an empty bridge (null: the main window follows none). The same object until it changes. */
    session(): LiveSession | null {
        const from = this.store.get('live');
        if (this.sessionMemo.from !== from) {
            this.sessionMemo = { from, session: from ? overviewSessionFromData(from as unknown as OverviewSessionData) : null };
        }
        return this.sessionMemo.session;
    }

    /** What the main window's Table reads of the research beyond the tree. */
    work(): AgentWorkData | null {
        return this.store.get('work') ?? null;
    }

    /** The research's word per person REFN for the cards (ResearchCardInfo). */
    cards(): Map<string, Record<string, unknown>> {
        const from = this.store.get('cards');
        if (this.cardsMemo.from !== from) this.cardsMemo = { from, cards: new Map(from ?? []) };
        return this.cardsMemo.cards;
    }

    /** The research's last status in the main window (null: none). */
    status(): AgentStatusData | null {
        return this.store.get('status') ?? null;
    }

    /** The followed research's lines' places (null: none read). The same object until they change. */
    places(): DirectionPlaces | null {
        const from = this.store.get('places');
        if (this.placesMemo.from !== from) {
            this.placesMemo = {
                from,
                places: from ? { rev: from.rev, places: new Map(from.places) as DirectionPlaces['places'], lines: from.lines as DirectionPlaces['lines'], branches: from.branches as DirectionPlaces['branches'] } : null,
            };
        }
        return this.placesMemo.places;
    }

    /** Following in the main window: its switch and its view. */
    follow(): AgentFollowData {
        return this.store.get('follow') ?? { on: false, view: null };
    }

    /** The main window's following in brief (null: it follows none). */
    live(): AgentMirrorLive | null {
        const s = this.session();
        if (!s) return null;
        return { treeId: s.treeId ?? null, researchId: s.researchId ?? null, lostSince: s.lostSince ?? 0, ended: !!s.ended, working: s.working ?? [] };
    }

    // ---- inside ----

    private take(state: unknown): void {
        const r = this.store.apply(state);
        if (r.kind === 'need-full') this.ask(true);
        else if (r.kind === 'applied' && r.changed.length > 0) this.emit(r.changed);
    }

    private onStatus(status: WindowStatus): void {
        const main = this.client.mainWindowId;
        if (main !== this.main) {
            const had = this.main !== null;
            this.main = main;
            if (had) {
                // Another main window: what the earlier one said is void; its hello brings the state anew.
                const dropped = this.store.reset();
                if (dropped.length) this.emit(dropped);
            }
        }
        this.lastStatus = status;
        if (status.agentRev === undefined || status.agentRev === null || status.agentRev === this.store.rev) return;
        if (this.recheck) return;
        this.recheck = setTimeout(() => {
            this.recheck = null;
            const rev = this.lastStatus?.agentRev;
            if (rev !== undefined && rev !== null && rev !== this.store.rev) this.ask(false);
        }, RECHECK_MS);
    }

    private ask(force: boolean): void {
        const t = this.now();
        if (!force && t - this.askedAt < ASK_GAP_MS) return;
        if (force && t - this.askedAt < RECHECK_MS) return;
        this.askedAt = t;
        this.client.requestAgentState();
    }

    private emit(changed: readonly AgentSectionName[]): void {
        for (const cb of [...this.listeners]) {
            try { cb(changed); } catch (err) { console.error('agent mirror listener failed', err); }
        }
    }
}

/** This window's mirror (null: the main window, the overview window, a plain tab). */
let current: AgentMirror | null = null;

export function agentMirror(): AgentMirror | null {
    return current;
}

/** Start this satellite's mirror of the agent's state (once; main.ts startSatelliteWindow). */
export function startAgentMirror(client: AgentMirrorClient): AgentMirror {
    current?.stop();
    current = new AgentMirror(client).start();
    return current;
}
