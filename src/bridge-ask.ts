/**
 * Asking a research's bridge for its status without mistaking a slow one for
 * a stuck one. A big research takes seconds to say its status: one ask is on
 * its way at a time (a later caller waits for that one), the ask itself may
 * take up to BRIDGE_ANSWER_MS, and a caller in a hurry goes on with what was
 * last known. Only several asks in a row without an answer in time count as
 * "not responding".
 */

/** How long one ask of a bridge's status may take (a big research needs seconds). */
export const BRIDGE_ANSWER_MS = 15_000;

/** Asks in a row without an answer in time before the bridge counts as not responding. */
export const HUNG_AFTER_TIMEOUTS = 3;

/** How an ask of the bridge ended: any answer (also 4xx/503), no answer in time, or no connection at all. */
export type BridgeAskOutcome = 'answer' | 'timeout' | 'error';

/**
 * What an ask's end means: `strikes` — asks in a row without an answer in time
 * now; `hung` — that many that the bridge counts as not responding; `keepLast`
 * — a slow answer, not a stuck bridge: what it said last stands.
 */
export function tallyBridgeAsk(strikes: number, outcome: BridgeAskOutcome): { strikes: number; hung: boolean; keepLast: boolean } {
    if (outcome !== 'timeout') return { strikes: 0, hung: false, keepLast: false };
    const now = strikes + 1;
    const hung = now >= HUNG_AFTER_TIMEOUTS;
    return { strikes: now, hung, keepLast: !hung };
}

const flights = new Map<string, Promise<unknown>>();

/** One ask per key at a time: while one is on its way, a later caller gets that one. */
export function askOnce<T>(key: string, start: () => Promise<T>): Promise<T> {
    const on = flights.get(key) as Promise<T> | undefined;
    if (on) return on;
    const p: Promise<T> = start().finally(() => {
        if (flights.get(key) === p) flights.delete(key);
    });
    flights.set(key, p);
    return p;
}

/** Is an ask with this key on its way now? */
export function askOnTheWay(key: string): boolean {
    return flights.has(key);
}

/** Wait for `p` at most `ms`: its value, or `done: false` (it goes on by itself). */
export async function waitAtMost<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<{ done: false }>(resolve => { timer = setTimeout(() => resolve({ done: false }), ms); });
    try {
        return await Promise.race([p.then(value => ({ done: true as const, value })), late]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
