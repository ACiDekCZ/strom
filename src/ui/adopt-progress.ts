/**
 * The steps of handing a tree to the research (A175, screens 2a–2c, 2i):
 * the dialog stays open and shows them as a list (`ul.steps`, done ✓, running
 * spinner, still to come ·, failed !), or — folded into the background — as a
 * progress toast with "Show". One controller keeps their state, so the list and
 * the toast tell the same thing wherever the hand-over is watched from.
 */

import { strings } from '../strings.js';
import { showProgressToast, type ProgressToastHandle } from './toast.js';

export const ADOPT_STEPS = ['backup', 'gedcom', 'taking', 'loading'] as const;
export type AdoptStep = typeof ADOPT_STEPS[number];
export type AdoptStepState = 'todo' | 'run' | 'done' | 'fail';

/** A phase the hand-over reports: the step it is at, with what it says beside it (people, MB). */
export interface AdoptPhase {
    step: AdoptStep;
    meta?: string;
}

/** Its usual time: from twice that (and 20 s at least) the list says it takes longer, with why. */
export const ADOPT_USUAL_MS = 10_000;
const LONG_AFTER_MS = Math.max(2 * ADOPT_USUAL_MS, 20_000);
/** The running step shows its time from 10 s on. */
const ELAPSED_FROM_MS = 10_000;

/** A step's label as the list and the toast say it (no trailing ellipsis: the running one gets its own). */
export function adoptStepLabel(step: AdoptStep): string {
    const b = strings.busy;
    const text = step === 'backup' ? b.adoptBackup : step === 'gedcom' ? b.adoptGedcom : step === 'taking' ? b.adoptTaking : b.loadingTree;
    return text.replace(/(…|\.\.\.)$/, '');
}

const GLYPH: Record<Exclude<AdoptStepState, 'run'>, string> = { done: '✓', todo: '·', fail: '!' };

export interface AdoptProgressOpts {
    /** "Show" in the background toast: the dialog back. */
    onShow: () => void;
    now?: () => number;
}

export class AdoptProgress {
    private readonly states = new Map<AdoptStep, { state: AdoptStepState; meta: string }>();
    private readonly now: () => number;
    readonly startedAt: number;
    private stepAt: number;
    private host: HTMLElement | null = null;
    private toast: ProgressToastHandle | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private over = false;

    constructor(private readonly opts: AdoptProgressOpts) {
        this.now = opts.now ?? Date.now;
        this.startedAt = this.now();
        this.stepAt = this.startedAt;
        for (const s of ADOPT_STEPS) this.states.set(s, { state: 'todo', meta: '' });
        this.timer = setInterval(() => this.tick(), 1000);
    }

    /** The state of a step now (for tests and the dialog). */
    stateOf(step: AdoptStep): AdoptStepState {
        return this.states.get(step)!.state;
    }

    /** Whether it ended (done or failed). */
    get ended(): boolean {
        return this.over;
    }

    /** The step it is at now: the steps before it done. */
    phase(p: AdoptPhase): void {
        if (this.over) return;
        const at = ADOPT_STEPS.indexOf(p.step);
        ADOPT_STEPS.forEach((s, i) => {
            const st = this.states.get(s)!;
            if (i < at) st.state = 'done';
            else if (i === at) { st.state = 'run'; if (p.meta !== undefined) st.meta = p.meta; }
        });
        this.stepAt = this.now();
        this.draw();
    }

    /** What a step says beside it (a later word of the same step: the MB downloaded). */
    meta(step: AdoptStep, meta: string): void {
        const st = this.states.get(step)!;
        st.meta = meta;
        this.draw();
    }

    /** Every step done. */
    finish(): void {
        for (const st of this.states.values()) st.state = 'done';
        this.end();
    }

    /** The running step failed (the steps after it stay to come). */
    fail(): void {
        for (const st of this.states.values()) if (st.state === 'run') st.state = 'fail';
        this.end();
    }

    private end(): void {
        this.over = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.draw();
    }

    /** The list into `host` (the dialog's body); the background toast goes. */
    attach(host: HTMLElement): void {
        this.host = host;
        this.closeToast();
        this.draw();
    }

    /** Folded into the background: the progress toast with "Show" (§2.5). Kept if open already. */
    background(): ProgressToastHandle {
        this.host = null;
        if (!this.toast) {
            this.toast = showProgressToast({ title: strings.busy.adoptTitle, usualMs: ADOPT_USUAL_MS, startedAt: this.startedAt,
                show: () => this.opts.onShow(), lockEdits: strings.busy.editsWaitAdopt }, this.toastStep());
        }
        return this.toast;
    }

    /** The background toast, if it is open. */
    get toastHandle(): ProgressToastHandle | null {
        return this.toast;
    }

    closeToast(): void {
        this.toast?.close();
        this.toast = null;
    }

    /** The toast's line: the running (or failed) step, k of 4, its meta. */
    toastStep(): { step: string; k: number; n: number; size?: string } {
        const at = ADOPT_STEPS.findIndex(s => this.states.get(s)!.state === 'run' || this.states.get(s)!.state === 'fail');
        const i = at < 0 ? ADOPT_STEPS.length - 1 : at;
        const st = this.states.get(ADOPT_STEPS[i])!;
        return { step: adoptStepLabel(ADOPT_STEPS[i]), k: i + 1, n: ADOPT_STEPS.length, ...(st.meta ? { size: st.meta } : {}) };
    }

    private tick(): void {
        this.draw();
    }

    /** The running step's time (from 10 s), else its meta. */
    private metaOf(step: AdoptStep): string {
        const st = this.states.get(step)!;
        if (st.state !== 'run') return st.meta;
        const ms = this.now() - this.stepAt;
        const time = ms >= ELAPSED_FROM_MS ? strings.busy.elapsed(Math.floor(ms / 1000)) : '';
        return [st.meta, time].filter(Boolean).join(' ');
    }

    private draw(): void {
        if (this.toast && !this.over) this.toast.update(this.toastStep());
        if (!this.host) return;
        const doc = document;
        let list = this.host.querySelector<HTMLElement>('ul.steps');
        if (!list) {
            list = doc.createElement('ul');
            list.className = 'steps';
            list.setAttribute('role', 'status');
            list.setAttribute('aria-live', 'polite');
            this.host.appendChild(list);
        }
        list.replaceChildren();
        for (const step of ADOPT_STEPS) {
            const st = this.states.get(step)!;
            const li = doc.createElement('li');
            li.className = st.state;
            li.dataset.step = step;
            const g = doc.createElement('span');
            g.className = 'g';
            g.setAttribute('aria-hidden', 'true');
            if (st.state === 'run') {
                const spin = doc.createElement('i');
                spin.className = 'busy-spin';
                g.appendChild(spin);
            } else g.textContent = GLYPH[st.state];
            li.appendChild(g);
            const label = doc.createElement('span');
            label.className = 'steps-label';
            label.textContent = adoptStepLabel(step) + (st.state === 'run' ? '…' : '');
            li.appendChild(label);
            const meta = this.metaOf(step);
            if (meta) {
                const m = doc.createElement('span');
                m.className = 'meta';
                m.textContent = meta;
                li.appendChild(m);
            }
            list.appendChild(li);
        }
        // Taking longer than usual, with why (a large tree with images), while it still runs.
        let long = this.host.querySelector<HTMLElement>('.adopt-long');
        const isLong = !this.over && this.now() - this.startedAt >= LONG_AFTER_MS;
        if (isLong && !long) {
            long = doc.createElement('div');
            long.className = 'busy-msg adopt-long';
            long.setAttribute('role', 'status');
            long.textContent = `${strings.busy.takingLong} ${strings.busy.adoptLongNote}`;
            this.host.appendChild(long);
        } else if (!isLong && long) long.remove();
    }
}
