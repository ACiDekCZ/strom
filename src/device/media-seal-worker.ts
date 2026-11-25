/**
 * The blob worker that seals a photo's blocks for PUT /device/media (the
 * build bundles this file on its own and embeds it as `__MEDIA_SEAL_WORKER__`;
 * device-media.ts starts it from a blob URL, as sha256.ts does its own): the
 * page stays responsive while 20 MB are sealed.
 *
 * In: `{job: MediaSealJob, blob: Blob}`. Out: `{progress: plain bytes done}`
 * after each block, then `{parts: Uint8Array[]}` (their buffers transferred)
 * or `{error}`.
 */

import { mediaBlockRanges, sealMediaMeta, sealFileBlock, type MediaSealJob } from './media-blocks';

interface WorkerScope {
    onmessage: ((e: MessageEvent<{ job: MediaSealJob; blob: Blob }>) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
    try {
        const { job, blob } = e.data;
        const parts: Uint8Array[] = [sealMediaMeta(job)];
        const ranges = mediaBlockRanges(blob.size);
        for (let i = 0; i < ranges.length; i++) {
            const [a, b] = ranges[i];
            const bytes = new Uint8Array(await blob.slice(a, b).arrayBuffer());
            parts.push(sealFileBlock(job, i, i === ranges.length - 1, bytes));
            scope.postMessage({ progress: b });
        }
        scope.postMessage({ parts }, parts.map(p => p.buffer as ArrayBuffer));
    } catch (err) {
        scope.postMessage({ error: String(err) });
    }
};
