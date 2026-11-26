/**
 * The agent's state as it crosses from the main window to the other windows
 * of the app (spec 097 K1.3, K3.1): only the main window follows a research
 * and talks to its bridge; every other window draws the research (the
 * Table's research columns and views, the agent's marks on the cards) from
 * a mirror of what the main window has.
 *
 * The state is split into sections; the main window sends only the sections
 * that changed since its last revision (`base`), and the whole state to one
 * window after its hello or its ask. A window whose mirror does not stand at
 * a delta's `base` (it missed one) asks for the whole state. The status
 * heartbeat carries the last revision (`WindowStatus.agentRev`), so a lost
 * last message is noticed too.
 *
 * Pure: no app modules here. What the sections hold is built in the main
 * window (src/ui/agent-window-ui.ts) and read in a satellite
 * (src/windows/agent-mirror.ts). No bridge address or token crosses
 * (agentStateSafe).
 */

import { cloneSafe } from './overview-window.js';

export const AGENT_STATE_VERSION = 1;

/** The sections of the agent's state, each sent on its own change. */
export const AGENT_SECTIONS = ['link', 'live', 'work', 'cards', 'status', 'places', 'follow'] as const;
export type AgentSectionName = typeof AGENT_SECTIONS[number];

/** The main window's tree and its research link (a subset of its TreeMetadata, never a bridge or a token). */
export interface AgentLinkData {
    treeId: string | null;
    /** id, name, research, researchEdges, researchEdgeMotion of the tree's metadata (null: no tree). */
    meta: Record<string, unknown> | null;
}

/** What the main window's Table reads of the research beyond the tree (research-ui ResearchTableLive). */
export interface AgentWorkData {
    live: boolean;
    followed: boolean;
    waiting: unknown[];
    working: unknown[];
    queue: unknown[];
    /** People (REFN) the agent was just done with, since when (ms). */
    done: [string, number][];
}

/** The research's last status in the main window. */
export interface AgentStatusData {
    researchId: string;
    status: unknown;
    /** Its bridge answers in the main window now (absent: a main window from before, taken as answering). */
    up?: boolean;
}

/** The followed research's lines' places (research-directions-write DirectionPlaces, its map as entries). */
export interface AgentPlacesData {
    rev: string;
    places: [string, unknown[]][];
    lines: unknown[];
    branches: unknown[];
}

/** Following in the main window (spec 097: what a window's own following starts from, D2). */
export interface AgentFollowData {
    on: boolean;
    view: string | null;
    /** The run followed (spec 126 U10 §7; absent or null: none, or a research without runs). */
    run?: string | null;
}

export interface AgentSections {
    link: AgentLinkData;
    /** The followed session as the overview window gets it (overviewSessionData), null: not following. */
    live: Record<string, unknown> | null;
    work: AgentWorkData;
    /** The research's word per person REFN for the cards (card-signals ResearchCardInfo). */
    cards: [string, Record<string, unknown>][];
    status: AgentStatusData | null;
    places: AgentPlacesData | null;
    follow: AgentFollowData;
}

/** One `agent-state` message's state. */
export interface AgentStateMessage {
    v: number;
    /** This state's revision. */
    rev: number;
    /** The revision the sections change (null: the whole state). */
    base: number | null;
    sections: Partial<AgentSections>;
}

/** A section stamp the main window gives instead of the section's JSON (a large section that carries its own revision). */
export type AgentStamps = Partial<Record<AgentSectionName, string>>;

/**
 * The sections as they may cross: every string holding a bridge address or
 * its token (`secrets`, overview-window bridgeSecrets) dropped, class
 * instances and functions dropped, Maps and Sets kept as such.
 */
export function agentStateSafe(sections: AgentSections, secrets: readonly string[]): AgentSections {
    return cloneSafe(sections, secrets) as AgentSections;
}

/** A section's stamp: its JSON, Maps and Sets as their entries (a change inside one is a change). */
export function agentStamp(value: unknown): string {
    return JSON.stringify(value, (_k, v: unknown) => v instanceof Map ? ['\u0000map', ...v] : v instanceof Set ? ['\u0000set', ...v] : v) ?? 'null';
}

/**
 * The main window's end: the revision, what each section was when last
 * sent, and the deltas. The revision starts at the clock, so a main window
 * after a reload never repeats an earlier one's revisions.
 */
export class AgentStateSender {
    private revision: number;
    private readonly stamps = new Map<AgentSectionName, string>();
    private current: Partial<AgentSections> = {};

    constructor(start = Date.now()) {
        this.revision = start;
    }

    get rev(): number {
        return this.revision;
    }

    /** Any state taken yet. */
    get started(): boolean {
        return this.stamps.size > 0;
    }

    /**
     * Take the present state: the sections that changed since the last one
     * as a delta (a new revision), or null when none did.
     */
    next(sections: AgentSections, given: AgentStamps = {}): AgentStateMessage | null {
        const changed: Partial<AgentSections> = {};
        let any = false;
        for (const name of AGENT_SECTIONS) {
            const value = sections[name];
            const stamp = given[name] ?? agentStamp(value);
            if (this.stamps.get(name) === stamp && name in this.current) continue;
            this.stamps.set(name, stamp);
            (changed as Record<string, unknown>)[name] = value;
            (this.current as Record<string, unknown>)[name] = value;
            any = true;
        }
        if (!any) return null;
        const base = this.revision;
        this.revision++;
        return { v: AGENT_STATE_VERSION, rev: this.revision, base, sections: changed };
    }

    /** The whole state at the present revision (to a window after its hello or its ask). */
    full(): AgentStateMessage {
        return { v: AGENT_STATE_VERSION, rev: this.revision, base: null, sections: { ...this.current } };
    }
}

export type AgentApplyResult =
    /** Taken in (`changed`: its sections). */
    | { kind: 'applied'; changed: AgentSectionName[] }
    /** A delta on another revision than the mirror's: the whole state is to be asked for. */
    | { kind: 'need-full' }
    /** Not an agent state of this version, or one already had. */
    | { kind: 'ignored' };

/** Read an `agent-state` message's state (null: not one of this version). */
export function readAgentState(state: unknown): AgentStateMessage | null {
    if (!state || typeof state !== 'object') return null;
    const s = state as Partial<AgentStateMessage>;
    if (s.v !== AGENT_STATE_VERSION || typeof s.rev !== 'number') return null;
    if (s.base !== null && typeof s.base !== 'number') return null;
    if (!s.sections || typeof s.sections !== 'object') return null;
    return s as AgentStateMessage;
}

/** A satellite's end: the sections as the main window last said them, at its revision. */
export class AgentMirrorStore {
    private revision: number | null = null;
    private readonly data: Partial<AgentSections> = {};

    /** The revision the mirror stands at (null: nothing taken yet). */
    get rev(): number | null {
        return this.revision;
    }

    get<K extends AgentSectionName>(name: K): AgentSections[K] | undefined {
        return this.data[name];
    }

    apply(state: unknown): AgentApplyResult {
        const s = readAgentState(state);
        if (!s) return { kind: 'ignored' };
        if (s.base !== null) {
            if (this.revision === s.rev) return { kind: 'ignored' };
            if (this.revision !== s.base) return { kind: 'need-full' };
        } else if (this.revision === s.rev) {
            // The same whole state again (two windows asked at once): nothing new.
            return { kind: 'ignored' };
        }
        const changed: AgentSectionName[] = [];
        if (s.base === null) {
            for (const name of AGENT_SECTIONS) {
                if (!(name in s.sections) && !(name in this.data)) continue;
                changed.push(name);
                if (name in s.sections) (this.data as Record<string, unknown>)[name] = s.sections[name];
                else delete this.data[name];
            }
        } else {
            for (const name of AGENT_SECTIONS) {
                if (!(name in s.sections)) continue;
                changed.push(name);
                (this.data as Record<string, unknown>)[name] = s.sections[name];
            }
        }
        this.revision = s.rev;
        return { kind: 'applied', changed };
    }

    /** Forget everything (another main window: its state comes anew). */
    reset(): AgentSectionName[] {
        const had = AGENT_SECTIONS.filter(n => n in this.data);
        for (const n of had) delete this.data[n];
        this.revision = null;
        return had;
    }
}
