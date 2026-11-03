/**
 * The pure half of managing the research's directions in the app (spec 038):
 * the order the Directions section shows, a move up / down / to the top, a
 * series of moves written once after a quiet moment, and one retry of a
 * write the research turned down as busy. No DOM here.
 */

import type { LiveDirection } from './research-link.js';

/** The section's rows: those in the order (active and paused) and those apart (paused and ended, or ended only). */
export interface DirectionsOrdered {
    active: LiveDirection[];
    inactive: LiveDirection[];
}

/**
 * The rows of the Directions section.
 * - `byBridge` (a research that keeps the order, `caps.directionsOrder`):
 *   the bridge's order of work (`order`, else as sent), a paused direction
 *   in it at its own place; only ended ones apart, in the same order.
 * - otherwise (an older research): running ones first (the one worked on
 *   first, then the newest), then paused and ended, newest first.
 */
export function orderDirections(list: readonly LiveDirection[], byBridge = false): DirectionsOrdered {
    if (byBridge) {
        const sent = list.map((d, i) => ({ d, i }));
        sent.sort((a, b) => (a.d.order ?? Infinity) - (b.d.order ?? Infinity) || a.i - b.i);
        const all = sent.map(x => x.d);
        return { active: all.filter(d => d.state !== 'done'), inactive: all.filter(d => d.state === 'done') };
    }
    const since = (d: LiveDirection): number => Date.parse(d.since ?? '') || 0;
    const active = list.filter(d => d.state === 'active')
        .sort((a, b) => Number(!!b.working) - Number(!!a.working) || since(b) - since(a));
    const inactive = list.filter(d => d.state !== 'active').sort((a, b) => since(b) - since(a));
    return { active, inactive };
}

/**
 * The rows in the order a move not yet in the research's status asks for
 * (`pending`: ids in their new order). Ids the list no longer has are left
 * out; rows the order does not name keep their place after those it does.
 */
export function withPendingOrder(rows: readonly LiveDirection[], pending: readonly string[] | null): LiveDirection[] {
    if (!pending || pending.length === 0) return [...rows];
    const at = new Map(pending.map((id, i) => [id, i]));
    return rows.map((d, i) => ({ d, i }))
        .sort((a, b) => (at.get(a.d.id) ?? pending.length + a.i) - (at.get(b.d.id) ?? pending.length + b.i))
        .map(x => x.d);
}

export type DirectionMove = 'up' | 'down' | 'top';

/** The order after moving `id` one up, one down or to the top (the same order when it cannot move). */
export function moveInOrder(order: readonly string[], id: string, move: DirectionMove): string[] {
    const i = order.indexOf(id);
    const out = [...order];
    if (i < 0) return out;
    const to = move === 'top' ? 0 : move === 'up' ? i - 1 : i + 1;
    if (to < 0 || to >= out.length || to === i) return out;
    out.splice(i, 1);
    out.splice(to, 0, id);
    return out;
}

/** The order after dropping `id` before the row now at `index` (`index` = length: last). */
export function dropInOrder(order: readonly string[], id: string, index: number): string[] {
    const i = order.indexOf(id);
    if (i < 0) return [...order];
    const out = order.filter(x => x !== id);
    const to = Math.max(0, Math.min(out.length, index > i ? index - 1 : index));
    out.splice(to, 0, id);
    return out;
}

/** Two orders the same. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Moves written once they settle: each move sets the order at once (the
 * caller shows it) and (re)starts the quiet wait; after `quietMs` without a
 * move the last order is written once. A move while a write runs waits for
 * it and is written after it.
 */
export class DirectionOrderWriter {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running: Promise<void> | null = null;
    /** The order to write (null: nothing waits). */
    private next: string[] | null = null;

    constructor(
        private readonly write: (order: string[]) => Promise<void>,
        private readonly quietMs = 400,
    ) {}

    /** A move: the new order waits for the quiet moment. */
    move(order: readonly string[]): void {
        this.next = [...order];
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, this.quietMs);
    }

    /** A move waits or is being written. */
    get busy(): boolean {
        return this.next !== null || this.running !== null;
    }

    /** Write what waits now (after a write that runs). */
    async flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        while (this.running) await this.running;
        const order = this.next;
        if (!order) return;
        this.next = null;
        this.running = this.write(order).finally(() => { this.running = null; });
        await this.running;
    }

    /** Drop what waits (the session ended). */
    cancel(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.next = null;
    }
}

/** How long before the one retry of a write the research said it was too busy for. */
export const BUSY_RETRY_MS = 3000;

/**
 * A write, and once more after `waitMs` when the research answered busy
 * (503): the second answer is the one shown, whatever it is.
 */
export async function withBusyRetry<R extends { ok: boolean; code?: string }>(run: () => Promise<R>,
    waitMs = BUSY_RETRY_MS, sleep: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms))): Promise<R> {
    const first = await run();
    if (first.ok || first.code !== 'busy') return first;
    await sleep(waitMs);
    return run();
}

/** The parts of "what it found" that are not zero (sessions, persons, sources), in that order. */
export function foundParts(found: { sessions: number; persons: number; sources: number }): ('sessions' | 'persons' | 'sources')[] {
    return (['sessions', 'persons', 'sources'] as const).filter(k => found[k] > 0);
}

/** A direction younger than its first session: no tasks yet, nothing done ("the next run proposes the tasks"). */
export function directionUnstarted(d: LiveDirection): boolean {
    return d.state === 'active' && !d.last && !d.working && (d.tasks ?? 0) === 0 && (d.waiting ?? 0) === 0;
}

/** Whole days between two moments by the calendar (0: the same day). */
export function calendarDaysAgo(ts: number, now: number): number {
    const a = new Date(ts);
    const b = new Date(now);
    const day = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((day(b) - day(a)) / 86_400_000);
}
