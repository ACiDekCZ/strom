/**
 * The research state of every research tree on this computer, not only the
 * open one: the tree switcher marks each tree (followed live, running, idle,
 * not running), the research panel names the other trees where an agent works
 * or something waits ("Elsewhere"), and the closed switcher carries one dot
 * for the other trees.
 *
 * Pure: how a tree's state follows from its bridge's last answer, how the
 * other trees sum up, and the poller that asks the other trees' bridges —
 * one at a time (each bridge works its status out over the whole research,
 * and the open tree's own ask must not wait behind a burst), about once a
 * minute, only while the page is seen. The asking itself is the caller's
 * (askResearchBridge: the status only, nothing is sent or fetched).
 */

import type { LiveStatus, ResearchAccepts } from './research-link.js';
import { waitingTodoCount } from './research-waiting.js';

/**
 * `live` — the research is followed here; `running` — its bridge answers and
 * an agent works (not paused); `idle` — it answers, nobody works; `off` — it
 * did not answer (not running, stuck, another address, no address known);
 * `blocked` — the browser does not let the page reach this computer's
 * programs (one state for every tree).
 */
export type ResearchTreeKind = 'live' | 'running' | 'idle' | 'off' | 'blocked';

export interface ResearchTreeState {
    kind: ResearchTreeKind;
    /** Directions at work (not paused); one for work outside any direction. */
    lines: number;
    /** What waits for the user (as the menu counts it); 0 for an archive and while not running. */
    waiting: number;
}

/** What a bridge's last ask came to. */
export interface BridgeAnswer {
    /** `up`: it answered with this research's status; `off`: no answer; `denied`: the browser blocked the address. */
    result: 'up' | 'off' | 'denied';
    status: LiveStatus | null;
    /** When (ms). */
    at: number;
}

/** An archive, or a research without its agent: nobody works there, nothing waits for the user. */
export function researchAgentless(accepts: ResearchAccepts | null | undefined): boolean {
    return accepts?.mode === 'archive' || accepts?.agentHere === false;
}

/** Directions at work in a status: distinct `research` of the workers not paused (work outside any counts once). */
export function workingLines(working: LiveStatus['working']): number {
    const keys = new Set<string>();
    for (const w of working) if (!w.paused) keys.add(w.research || '');
    return keys.size;
}

/**
 * A tree's state from its bridge's last answer (null: not asked yet — no
 * state, nothing shown). `live`: the research followed here (its session's
 * workers and waiting list). An archive never runs and never waits.
 */
export function researchTreeState(answer: BridgeAnswer | null, o: {
    live?: { working: LiveStatus['working']; waiting: LiveStatus['waiting']; accepts?: ResearchAccepts | null } | null;
    /** The bridge's address is not known on this computer. */
    noAddress?: boolean;
    /** What the research said it takes (its status, else as kept). */
    accepts?: ResearchAccepts | null;
} = {}): ResearchTreeState | null {
    if (o.live) {
        const agentless = researchAgentless(o.live.accepts ?? o.accepts);
        return { kind: 'live', lines: agentless ? 0 : workingLines(o.live.working), waiting: agentless ? 0 : waitingTodoCount(o.live.waiting) };
    }
    if (o.noAddress) return { kind: 'off', lines: 0, waiting: 0 };
    if (!answer) return null;
    if (answer.result === 'denied') return { kind: 'blocked', lines: 0, waiting: 0 };
    if (answer.result === 'off' || !answer.status) return { kind: 'off', lines: 0, waiting: 0 };
    const status = answer.status;
    // `tree.kind` when the bridge says it (a research waiting for its agent is an archive), else `accepts`.
    if (status.treeKind ? status.treeKind === 'archive' : researchAgentless(status.accepts ?? o.accepts)) return { kind: 'idle', lines: 0, waiting: 0 };
    const lines = workingLines(status.working);
    return { kind: lines > 0 ? 'running' : 'idle', lines, waiting: waitingTodoCount(status.waiting) };
}

/** The tree belongs in "Elsewhere" (and in the closed switcher's dot): an agent works there, or something waits. */
export function researchTreeNoteworthy(state: ResearchTreeState | null): boolean {
    if (!state || state.kind === 'off' || state.kind === 'blocked') return false;
    return state.lines > 0 || state.waiting > 0;
}

/** The summary dot of several trees: amber when something waits in any, else green when an agent works in any. */
export function researchTreesDot(states: readonly (ResearchTreeState | null)[]): 'waiting' | 'running' | null {
    let running = false;
    for (const s of states) {
        if (!researchTreeNoteworthy(s)) continue;
        if (s!.waiting > 0) return 'waiting';
        running = true;
    }
    return running ? 'running' : null;
}

/** "Elsewhere": the trees worth naming, those with something waiting first, then those running, each by name. */
export function elsewhereTrees<T extends { name: string; state: ResearchTreeState | null }>(trees: readonly T[], lang = 'en'): T[] {
    return trees.filter(t => researchTreeNoteworthy(t.state)).sort((a, b) => {
        const wa = a.state!.waiting > 0 ? 0 : 1;
        const wb = b.state!.waiting > 0 ? 0 : 1;
        return wa - wb || a.name.localeCompare(b.name, lang);
    });
}

/** "3 h" ago in the language's short form ("před 3 h", "3 hr. ago", "vor 3 Std."). */
export function agoShort(ts: number, now: number, lang: string): string {
    const diff = Math.max(0, now - ts);
    const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = diff < 3_600_000 ? [Math.max(1, Math.round(diff / 60_000)), 'minute']
        : diff < 86_400_000 ? [Math.round(diff / 3_600_000), 'hour'] : [Math.round(diff / 86_400_000), 'day'];
    try {
        return new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' }).format(-value, unit);
    } catch {
        return `${value}`;
    }
}

/** A tree with a research link, as the asking sees it. */
export interface ResearchTreeEntry {
    treeId: string;
    researchId: string;
    /** A copy ("Duplicate"): no tie to the bridge, never marked. */
    copy: boolean;
    /** The research said it is an archive (no agent, nothing waits). */
    archive: boolean;
    /** The bridge's address is kept on this computer. */
    hasAddress: boolean;
}

/**
 * The bridges a round asks: the other trees' researches (not the open tree,
 * whose state comes from its own ask, not the research followed live), not
 * copies, not archives, only with an address known; each research once.
 */
export function otherBridgeTargets(entries: readonly ResearchTreeEntry[], activeTreeId: string | null, skipResearchIds: readonly string[] = []): string[] {
    // The open tree's research is asked by its own poll (a copy open too: its research is the same bridge).
    const active = entries.find(e => e.treeId === activeTreeId)?.researchId ?? null;
    const out: string[] = [];
    for (const e of entries) {
        if (e.copy || e.archive || !e.hasAddress || e.treeId === activeTreeId) continue;
        if (e.researchId === active || skipResearchIds.includes(e.researchId) || out.includes(e.researchId)) continue;
        out.push(e.researchId);
    }
    return out;
}

// ==================== ASKING THE OTHER TREES' BRIDGES ====================

export interface OtherBridgesTimings {
    /** The first round after the start (ms). */
    first: number;
    /** Between rounds (ms). */
    every: number;
    /** An answer this fresh is not asked again when the switcher opens (ms). */
    fresh: number;
    /** One ask's limit (ms). */
    timeout: number;
}

export const OTHER_BRIDGES_TIMINGS: OtherBridgesTimings = { first: 3000, every: 60_000, fresh: 15_000, timeout: 1500 };

export interface OtherBridgesDeps {
    /** The research ids to ask in this round (worked out at its start). */
    targets(): string[];
    /** Ask one bridge (resolves, never throws; null: no answer worth keeping, e.g. busy). */
    ask(researchId: string, timeout: number): Promise<BridgeAnswer | null>;
    /** The page is seen (a hidden page asks nothing). */
    visible(): boolean;
    /** Asking applies at all on this device (a computer, research links on, not Safari, not a shared file). */
    enabled(): boolean;
    /** One answer came (results land as they come). */
    onAnswer(researchId: string, answer: BridgeAnswer): void;
    /** A round ended. */
    onRound?(): void;
    now?(): number;
    timings?(): OtherBridgesTimings;
}

/**
 * Asks the other trees' bridges: one round about every minute, the bridges
 * one after another (never two asks at once, never two rounds at once), each
 * with a short limit and no retry; a hidden page waits for the next round.
 */
export class OtherBridgesPoller {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private stopped = true;
    /** When the last round ended (ms; 0: none yet). */
    lastRoundAt = 0;
    /** Asks in flight (0 or 1). */
    inFlight = 0;

    constructor(private readonly deps: OtherBridgesDeps) {}

    private t(): OtherBridgesTimings {
        return this.deps.timings?.() ?? OTHER_BRIDGES_TIMINGS;
    }

    private now(): number {
        return this.deps.now?.() ?? Date.now();
    }

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.schedule(this.t().first);
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    /** A round is on its way. */
    get busy(): boolean {
        return this.running;
    }

    private schedule(ms: number): void {
        if (this.stopped) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.round();
        }, ms);
    }

    /**
     * Ask now (the switcher opened, the page came back) unless a round runs or
     * the last one ended less than `maxAge` ago (default: `fresh`).
     */
    kick(maxAge = this.t().fresh): void {
        if (this.stopped || this.running) return;
        if (this.lastRoundAt && this.now() - this.lastRoundAt < maxAge) return;
        void this.round();
    }

    /** One round: every target in turn. The next is scheduled when it ends. */
    async round(): Promise<void> {
        if (this.running || this.stopped) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (!this.deps.visible() || !this.deps.enabled()) {
            this.schedule(this.t().every);
            return;
        }
        this.running = true;
        try {
            for (const id of this.deps.targets()) {
                if (this.stopped || !this.deps.visible() || !this.deps.enabled()) break;
                this.inFlight++;
                let answer: BridgeAnswer | null = null;
                try {
                    answer = await this.deps.ask(id, this.t().timeout);
                } catch {
                    answer = { result: 'off', status: null, at: this.now() };
                } finally {
                    this.inFlight--;
                }
                if (answer) this.deps.onAnswer(id, answer);
            }
        } finally {
            this.running = false;
            this.lastRoundAt = this.now();
            this.deps.onRound?.();
            this.schedule(this.t().every);
        }
    }
}
