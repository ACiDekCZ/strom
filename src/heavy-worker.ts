/**
 * The blob worker of the page's heavy pure-JS work (heavy-job.ts): the build
 * bundles this file on its own and embeds it as `__HEAVY_WORKER__`;
 * heavy-work.ts starts it from a blob URL. The page stays responsive while a
 * phone hashes a photo or opens tens of MB of a research's answer.
 *
 * In: `{id, job}`. Out: `{id, result}` (its buffers transferred) or `{id, error}`.
 */

import { runHeavyJob, type HeavyJob } from './heavy-job';

interface WorkerScope {
    onmessage: ((e: MessageEvent<{ id: number; job: HeavyJob }>) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
    const { id, job } = e.data;
    try {
        const { result, transfer } = await runHeavyJob(job);
        scope.postMessage({ id, result }, transfer);
    } catch (err) {
        scope.postMessage({ id, error: String(err) });
    }
};
