/**
 * The main window's side of "Focus" sent from another window (spec 110
 * §2–§5, §7): a person chosen in a satellite whose send mode is `focus`
 * becomes the main window's centre, as its card's Focus makes them.
 *
 * - The ring comes at once (cheap: only a drawn card shows it); the centre
 *   only after WINDOW_FOCUS_DELAY_MS without another choice from that window,
 *   and only for its newest choice (the numbers of its choices, `seq`; an
 *   older one is dropped). Running down a list with the arrow keys changes
 *   the centre once, to the row the keys stopped on.
 * - A run of choices from one window is one step of the view's history: the
 *   first centre pushes the view before it, the next ones replace it
 *   (nothing more on the back stack), so one Back returns to the centre
 *   before the run. The run ends with any step of this window's own (a focus,
 *   Back / Forward, a step of the history, another view), with the notice
 *   closed, and when that window stops sending `focus` or goes away.
 * - The notice at the bottom of the tree says why the centre changed and
 *   offers the centre before the run; one notice at a time, its words read
 *   out once per run.
 * - Following the research agent (spec 097 §4) the choice is only marked
 *   (the ring): the centre and the view stay with the agent; a notice says
 *   so once per run. Nothing is applied afterwards.
 * - A person hidden here or no longer in the tree: the centre stays, a
 *   notice says so (the hidden one without a name).
 */

import type { PersonId } from '../types.js';

/** A step of the main window's own view (a step of its history, Back / Forward, another view; renderer.ts). */
export const VIEW_STEP_EVENT = 'strom:view-step';

/** The quiet after a window's last choice before the centre follows it. */
export const WINDOW_FOCUS_DELAY_MS = 200;

/** What the notice at the bottom of the tree says. */
export type WindowNotice =
    /** "Centre chosen in another window" with "↶ {the centre before the run}". */
    | { kind: 'focus'; previous: PersonId | null }
    /** Following the agent: the choice is only marked. */
    | { kind: 'agent' }
    /** The person is hidden in this window (no name). */
    | { kind: 'hidden' }
    /** The person is no longer in the tree. */
    | { kind: 'deleted' }
    /** "Mark only": the person is not drawn in this view; "Go to" makes them the centre. */
    | { kind: 'not-in-view'; personId: PersonId };

export interface WindowFocusDeps {
    /** The main window's centre now. */
    focusId(): PersonId | null;
    exists(id: PersonId): boolean;
    /** The person is hidden in this window (spec 110 §7). */
    hidden(id: PersonId): boolean;
    /** The window follows the research agent now (attached, not paused). */
    followingAgent(): boolean;
    /** The ring of another window's choice (null: none). */
    ring(id: PersonId | null): void;
    /** Make the person the centre as the card's Focus does; the history step pushed, or replacing the run's. */
    focus(id: PersonId, history: 'push' | 'replace'): void;
    /** Show the notice (`announce`: its words read out now). */
    showNotice(notice: WindowNotice, announce: boolean): void;
    hideNotice(): void;
}

interface Pending {
    personId: PersonId;
    timer: ReturnType<typeof setTimeout>;
}

interface Run {
    source: string;
    /** The centre before the run's first step. */
    before: PersonId | null;
}

export class WindowFocusController {
    private readonly pending = new Map<string, Pending>();
    private readonly lastSeq = new Map<string, number>();
    private run: Run | null = null;
    /** The window whose choices the agent's notice was shown for (once per run). */
    private agentNoticeFor: string | null = null;
    private shown: WindowNotice['kind'] | null = null;
    private applying = false;

    constructor(private readonly deps: WindowFocusDeps) {}

    /** A window's run of choices is under way (its next centre replaces the history step). */
    get runSource(): string | null {
        return this.run?.source ?? null;
    }

    /** This controller is making the centre now (its focus is not the window's own step). */
    get isApplying(): boolean {
        return this.applying;
    }

    /** The kind of notice on screen (null: none). */
    get noticeShown(): WindowNotice['kind'] | null {
        return this.shown;
    }

    /** A choice sent with `focus` from window `source` (`seq`: its number there; null: none given). */
    take(personId: string | null, source: string, seq: number | null): void {
        if (seq !== null) {
            const last = this.lastSeq.get(source);
            if (last !== undefined && seq < last) return;
            this.lastSeq.set(source, seq);
        }
        this.cancel(source);
        if (!personId) return;
        const id = personId as PersonId;
        if (this.deps.exists(id) && !this.deps.hidden(id)) this.deps.ring(id);
        const timer = setTimeout(() => this.fire(source), WINDOW_FOCUS_DELAY_MS);
        this.pending.set(source, { personId: id, timer });
    }

    /** The window stopped sending `focus` or went away: its waiting choice goes, its run ends. */
    sourceEnded(source: string): void {
        this.cancel(source);
        this.lastSeq.delete(source);
        if (this.run?.source === source || this.agentNoticeFor === source) this.endRun();
    }

    /** A step of this window's own (or the notice closed): the run ends, the notice goes. */
    endRun(): void {
        this.run = null;
        this.agentNoticeFor = null;
        this.hide();
    }

    /** Show a notice of this window's own choice (mark only: the person not in view). */
    notice(n: WindowNotice): void {
        this.show(n);
    }

    /** The notice goes (the run stays). */
    hide(): void {
        if (this.shown === null) return;
        this.shown = null;
        this.deps.hideNotice();
    }

    dispose(): void {
        for (const source of [...this.pending.keys()]) this.cancel(source);
        this.run = null;
        this.agentNoticeFor = null;
    }

    private cancel(source: string): void {
        const p = this.pending.get(source);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(source);
    }

    private show(n: WindowNotice, announce = true): void {
        const again = this.shown === n.kind && !announce;
        this.shown = n.kind;
        this.deps.showNotice(n, !again);
    }

    private fire(source: string): void {
        const p = this.pending.get(source);
        if (!p) return;
        this.pending.delete(source);
        const id = p.personId;
        const d = this.deps;
        if (!d.exists(id)) {
            this.show({ kind: 'deleted' });
            return;
        }
        if (d.hidden(id)) {
            d.ring(null);
            this.show({ kind: 'hidden' });
            return;
        }
        if (d.followingAgent()) {
            // The agent goes first (spec 097 §4): the ring only, said once per run of this window's choices.
            if (this.agentNoticeFor !== source) {
                this.agentNoticeFor = source;
                this.show({ kind: 'agent' });
            }
            return;
        }
        if (id === d.focusId()) return;
        const same = this.run?.source === source;
        if (!same) {
            if (this.run) this.endRun();
            this.run = { source, before: d.focusId() };
        }
        this.applying = true;
        try {
            d.focus(id, same ? 'replace' : 'push');
        } finally {
            this.applying = false;
        }
        // The centre says the person itself: no ring of another window's choice.
        d.ring(null);
        // Read out once per run: the next centre of the run only changes nothing of the words.
        this.show({ kind: 'focus', previous: this.run!.before }, !same || this.shown !== 'focus');
    }
}
