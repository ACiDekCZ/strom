/**
 * Heavy pure-JS work off the page's thread (heavy-job.ts): up to
 * HEAVY_WORKERS blob workers of the build (`__HEAVY_WORKER__`), started when
 * first needed and let go after a while without work. `runOffThread` rejects
 * when no worker can start (no build worker, no Worker, a start that fails):
 * the caller then does the work on the page as before.
 */

import type { HeavyJob, HeavyResult } from './heavy-job.js';

declare const __HEAVY_WORKER__: string | undefined;

/** Workers at most (two answers of the gateway come at once). */
export const HEAVY_WORKERS = 2;
/** A worker without work this long is let go (its memory back). */
const IDLE_MS = 20_000;

interface Slot {
    worker: Worker;
    jobs: number;
    idle: ReturnType<typeof setTimeout> | null;
}

type Runner = (job: HeavyJob) => Promise<HeavyResult>;

let slots: Slot[] = [];
let sourceUrl = '';
let broken = false;
let nextId = 1;
const waiting = new Map<number, { slot: Slot; resolve: (r: HeavyResult) => void; reject: (e: Error) => void }>();
/** Tests: another runner (null: the workers again); `off`: none, as without Worker. */
let testRunner: Runner | null = null;
let testOff = false;

export function configureHeavyWork(o: { run?: Runner | null; off?: boolean } | null): void {
    testRunner = o?.run ?? null;
    testOff = !!o?.off;
}

/** Whether work can go off the page's thread here (a worker of the build can be started). */
export function canWorkOffThread(): boolean {
    if (testRunner) return true;
    if (testOff || broken || typeof Worker === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
    return typeof __HEAVY_WORKER__ === 'string' && __HEAVY_WORKER__.length > 0;
}

function fail(slot: Slot, err: Error): void {
    slot.worker.terminate();
    if (slot.idle) clearTimeout(slot.idle);
    slots = slots.filter(s => s !== slot);
    for (const [id, w] of [...waiting]) {
        if (w.slot !== slot) continue;
        waiting.delete(id);
        w.reject(err);
    }
}

function startSlot(): Slot {
    if (!sourceUrl) sourceUrl = URL.createObjectURL(new Blob([__HEAVY_WORKER__ as string], { type: 'text/javascript' }));
    const slot: Slot = { worker: new Worker(sourceUrl), jobs: 0, idle: null };
    slot.worker.onmessage = (e: MessageEvent<{ id: number; result?: HeavyResult; error?: string }>) => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        slot.jobs--;
        if (slot.jobs === 0) slot.idle = setTimeout(() => { if (slot.jobs === 0) fail(slot, new Error('idle')); }, IDLE_MS);
        if (e.data.result) w.resolve(e.data.result);
        else w.reject(new Error(e.data.error ?? 'heavy worker failed'));
    };
    slot.worker.onerror = (e) => {
        e.preventDefault?.();
        // A worker that cannot run (blocked, its source refused): the page does the work from now on.
        broken = true;
        fail(slot, new Error(e.message || 'heavy worker failed'));
    };
    slots.push(slot);
    return slot;
}

function pickSlot(): Slot {
    const free = slots.find(s => s.jobs === 0);
    if (free) return free;
    if (slots.length < HEAVY_WORKERS) return startSlot();
    return slots.reduce((a, b) => (b.jobs < a.jobs ? b : a));
}

/**
 * `job` done in a worker. The bytes it carries are copied to the worker (the
 * caller keeps them). Rejects when no worker can do it: the caller does the
 * work itself.
 */
export function runOffThread(job: HeavyJob): Promise<HeavyResult> {
    if (testRunner) return testRunner(job);
    if (!canWorkOffThread()) return Promise.reject(new Error('no worker'));
    let slot: Slot;
    try {
        slot = pickSlot();
    } catch (err) {
        broken = true;
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    if (slot.idle) { clearTimeout(slot.idle); slot.idle = null; }
    slot.jobs++;
    const id = nextId++;
    return new Promise<HeavyResult>((resolve, reject) => {
        waiting.set(id, { slot, resolve, reject });
        try {
            slot.worker.postMessage({ id, job });
        } catch (err) {
            waiting.delete(id);
            slot.jobs--;
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}

/** A pause that lets the page draw and answer between pieces of work done on it. */
export function yieldToPage(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
