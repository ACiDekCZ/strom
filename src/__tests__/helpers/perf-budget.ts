/**
 * Time budgets that hold on a loaded machine and still catch a slowdown.
 *
 * An absolute budget ("opens within 1 s") is met with room to spare on an
 * idle computer, but fails when the same computer runs other suites at the
 * same time (parallel vitest workers, Playwright shards, another checkout):
 * every computation there is slower (waiting for a core, or moved to a slower
 * efficiency core), the code under test is not. So each measured run is put
 * next to a fixed reference computation (the calibration) run in the same
 * process right before it, and the run's time is scaled by how slow that
 * calibration was against the reference machine at rest:
 *
 *   factor     = calibration time now / calibration time on the reference machine (idle),
 *                clamped to 1 … CAP_FACTOR
 *   normalized = measured time / factor
 *
 * and the best (lowest) normalized run must stay within the spec's budget.
 * A code regression makes the measured work slower but not the calibration,
 * so it still fails; a busy machine slows both and the factor follows. On an
 * idle reference machine (or a faster one) the factor is 1: the budget is
 * exactly the spec's. The cap keeps the test meaningful when the machine is
 * extremely slow: the run is never forgiven more than CAP_FACTOR times.
 *
 * Why per pair and the best pair: a loaded machine changes speed from one
 * moment to the next (the scheduler moves the process between cores; on the
 * reference machine, 4 performance and 6 efficiency cores, an efficiency
 * core runs this code about 3× slower), so a
 * calibration measured once, or the best calibration against the best run,
 * can come from a fast moment and the run from a slow one. A calibration and
 * the run right after it mostly share the same moment. The calibration takes
 * about as long as the measured work for the same reason.
 */

/** No budget grows past this multiple of the spec's, however slow the machine is. */
export const CAP_FACTOR = 5;

/**
 * A fixed, deterministic workload of the same nature as the tree code (objects
 * with string ids, Map/Set lookups, a graph walk, sorting, string building),
 * independent of the app's code so a change there cannot change it. Returns a
 * checksum so the work cannot be optimized away.
 *
 * Self-contained (no outer references): e2e specs pass it to page.evaluate,
 * which runs its source text in the browser.
 */
export function calibrationWorkload(rounds: number): number {
    let checksum = 0;
    for (let round = 0; round < rounds; round++) {
        let seed = 12345 + round;
        const rnd = (): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        const size = 5000;
        const nodes: { id: string; name: string; year: number; links: string[] }[] = [];
        for (let i = 0; i < size; i++) {
            nodes.push({ id: 'n' + i, name: 'Name' + ((i * 7919) % size), year: 1600 + Math.floor(rnd() * 400), links: [] });
        }
        const byId = new Map<string, { id: string; name: string; year: number; links: string[] }>();
        for (const n of nodes) byId.set(n.id, n);
        for (const n of nodes) {
            const k = 1 + Math.floor(rnd() * 3);
            for (let j = 0; j < k; j++) n.links.push('n' + Math.floor(rnd() * size));
        }
        // Walk the graph from every 500th node.
        for (let start = 0; start < size; start += 500) {
            const seen = new Set<string>(['n' + start]);
            const queue = ['n' + start];
            for (let q = 0; q < queue.length; q++) {
                const node = byId.get(queue[q])!;
                checksum = (checksum + node.year) % 1000003;
                for (const next of node.links) {
                    if (!seen.has(next)) { seen.add(next); queue.push(next); }
                }
            }
        }
        const sorted = nodes.slice().sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.year - b.year);
        const text = sorted.slice(0, 1000).map(n => `${n.name} (${n.year})`).join('; ');
        checksum = (checksum + text.length + JSON.parse(JSON.stringify(sorted.slice(0, 500))).length) % 1000003;
    }
    return checksum;
}

/** How much slower than the reference machine at rest this moment is (1 … CAP_FACTOR). */
export function machineFactor(calibrationMs: number, referenceMs: number): number {
    return Math.min(CAP_FACTOR, Math.max(1, calibrationMs / referenceMs));
}

/** A measured time as it would be on the reference machine at rest (see the file comment). */
export function normalizedMs(measuredMs: number, calibrationMs: number, referenceMs: number): number {
    return measuredMs / machineFactor(calibrationMs, referenceMs);
}

export interface BudgetMeasure {
    /** The best normalized time of the judged pairs (Infinity when none was judged). */
    ms: number;
    /** That run as measured, and the machine factor of its pair. */
    measuredMs: number;
    factor: number;
    /** At least one pair ran on a machine no more than CAP_FACTOR times slower than the reference. */
    judged: boolean;
    /** Pairs measured (calibration + run). */
    pairs: number;
}

export interface BudgetOptions {
    /** The spec's budget on the reference machine at rest (ms, normalized). */
    budgetMs: number;
    calibrationRounds: number;
    /** The calibration's best time on the reference machine at rest (ms). */
    referenceMs: number;
    /** Pairs measured at least (default 3) and at most (default 10). */
    minPairs?: number;
    maxPairs?: number;
    /** No new pair after this much wall time (ms, default 15 000), so the runner's limit never decides. */
    maxWallMs?: number;
}

/**
 * The time of `run` against a budget (see the file comment): a warm-up of
 * both, then pairs of a calibration and the run right after it; the best
 * normalized run counts. It stops as soon as a run is within the budget
 * (after `minPairs`), else after `maxPairs` or `maxWallMs`.
 *
 * A pair whose calibration was more than CAP_FACTOR times slower than the
 * reference ran on a machine too busy (or too slow, a CI runner at its worst)
 * to judge the code by: it does not count either way. When no pair could be
 * judged the result says so (`judged: false`) and the caller reports it
 * instead of failing: a slower code still fails on any machine that is not
 * that busy, as its calibration stays fast.
 */
export function measureAgainstBudget(run: () => unknown, o: BudgetOptions): BudgetMeasure {
    const minPairs = o.minPairs ?? 3;
    const maxPairs = o.maxPairs ?? 10;
    const maxWallMs = o.maxWallMs ?? 15_000;
    run();
    calibrationWorkload(o.calibrationRounds);
    const out: BudgetMeasure = { ms: Infinity, measuredMs: 0, factor: 0, judged: false, pairs: 0 };
    const start = performance.now();
    while (out.pairs < maxPairs) {
        const c0 = performance.now();
        calibrationWorkload(o.calibrationRounds);
        const calMs = performance.now() - c0;
        const t0 = performance.now();
        run();
        const ms = performance.now() - t0;
        out.pairs++;
        const factor = calMs / o.referenceMs;
        if (factor <= CAP_FACTOR) {
            const n = normalizedMs(ms, calMs, o.referenceMs);
            out.judged = true;
            if (n < out.ms) { out.ms = n; out.measuredMs = ms; out.factor = machineFactor(calMs, o.referenceMs); }
        }
        if (out.pairs >= minPairs && out.ms < o.budgetMs) break;
        if (performance.now() - start > maxWallMs) break;
    }
    return out;
}

/** One line for the test's log: the verdict's numbers, or why there is none. */
export function budgetReport(label: string, m: BudgetMeasure, budgetMs: number): string {
    return m.judged
        ? `[${label}] ${m.ms.toFixed(1)} ms normalized of ${budgetMs} (${m.measuredMs.toFixed(1)} ms, machine ×${m.factor.toFixed(2)}, ${m.pairs} pairs)`
        : `[${label}] not judged: the machine was over ×${CAP_FACTOR} slower than the reference in all ${m.pairs} pairs`;
}
