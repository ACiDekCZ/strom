/**
 * The blob worker that seals a photo's blocks for PUT /device/media (the
 * build bundles this file on its own and embeds it as `__MEDIA_SEAL_WORKER__`;
 * device-media.ts starts it from a blob URL, as sha256.ts does its own): the
 * page stays responsive while 20 MB are sealed.
 *
 * In: `{job: MediaSealJob, blob: Blob}` (the meta block and blocks From+1…to
 * sealed, to: N when the job does not say). Out: `{progress: the plain end of the block}` after each block, then `{parts: Uint8Array[]}` (their buffers transferred)
 * or `{error}`.
 */

import { mediaJobEnd, mediaBlockRange, sealMediaMeta, sealDataBlock, type MediaSealJob } from './media-blocks';

interface WorkerScope {
    onmessage: ((e: MessageEvent<{ job: MediaSealJob; blob: Blob }>) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
    try {
        const { job, blob } = e.data;
        const parts: Uint8Array[] = [sealMediaMeta(job)];
        for (let i = job.from + 1; i <= mediaJobEnd(job); i++) {
            const [a, b] = mediaBlockRange(job.size, i);
            parts.push(sealDataBlock(job, i, new Uint8Array(await blob.slice(a, b).arrayBuffer())));
            scope.postMessage({ progress: b });
        }
        scope.postMessage({ parts }, parts.map(p => p.buffer as ArrayBuffer));
    } catch (err) {
        scope.postMessage({ error: String(err) });
    }
};
