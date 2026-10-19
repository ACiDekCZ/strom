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
