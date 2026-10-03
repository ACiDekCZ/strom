/**
 * Originals for Strom Research (step C) — the browser half: take the file's
 * identity before it is shrunk, keep the file in the queue (IndexedDB
 * `originals`) and send it to the research's bridge (`GET` / `PUT
 * /media/<sha256>`). The pure rules are in src/originals.ts.
 *
 * Only for a tree linked to a research, on a computer, with the research
 * saying it takes originals (`accepts.media`); never with encrypted storage
 * (the queue would hold the files in the clear). A tree without a research
 * is untouched: no hash, no queue, no word about it.
 *
 * One sender at a time across tabs (Web Lock `strom-originals`), one file at
 * a time. A file the research already has (by hash) is not sent again; an
 * interrupted send is simply repeated later.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { StorageManager } from '../storage.js';
import { MediaOriginal, PersonId, StromData, TreeId } from '../types.js';
import { storedResearchBridge, researchLinksEnabled } from '../research-device.js';
import { parseLiveBridge } from '../research-link.js';
import { sha256OfBlob, normalizeSha256 } from '../sha256.js';
import {
    QueuedOriginal, Region, queueKey, fitsBudget, exifOrientation, originalTargets, uploadHeaders, mediaReplyId,
    regionToStored, DEFAULT_MEDIA_MAX_BYTES,
} from '../originals.js';
import { onComputer, fetchWithTimeout } from './research-ui.js';
import { uiModule } from './module.js';

/** Head of the file read for its EXIF orientation. */
const EXIF_HEAD_BYTES = 256 * 1024;
/** How long the bridge has to say whether it has a file. */
const ASK_TIMEOUT_MS = 5000;
/** A send gets at least this long, more for a large file. */
const PUT_MIN_TIMEOUT_MS = 60_000;
/** A queued file nothing in its tree refers to any more is forgotten after this. */
const ORPHAN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SENT_KEY = 'strom-originals-sent:';
/** At most this many sent hashes remembered per research. */
const SENT_MAX = 2000;

/** Why an original was not queued (the attachment keeps its preview either way). */
export type QueueOutcome = 'queued' | 'notLinked' | 'notTaken' | 'encrypted' | 'tooLarge' | 'noRoom' | 'failed';

/** Queued originals (keys) in this tab, for the attachment's state line. */
const queuedKeys = new Set<string>();
let queueLoaded = false;
let sending = false;

/** The research's id for each hash it confirmed, per research (this browser). */
function sentMap(researchId: string): Record<string, string> {
    try {
        const raw = localStorage.getItem(SENT_KEY + researchId);
        const parsed = raw ? JSON.parse(raw) as unknown : null;
        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch {
        return {};
    }
}

function noteSent(researchId: string, sha: string, id: string): void {
    try {
        const map = sentMap(researchId);
        delete map[sha];
        map[sha] = id;
        const keys = Object.keys(map);
        for (const k of keys.slice(0, Math.max(0, keys.length - SENT_MAX))) delete map[k];
        localStorage.setItem(SENT_KEY + researchId, JSON.stringify(map));
    } catch { /* no storage: the bridge is asked again next time */ }
}

/** Every original hash the tree still refers to (attachments and excerpts). */
function referencedShas(data: StromData): Set<string> {
    const out = new Set<string>();
    for (const p of Object.values(data.persons)) {
        for (const a of p.attachments ?? []) {
            const sha = normalizeSha256(a.original?.sha256);
            if (sha) out.add(sha);
        }
    }
    for (const s of Object.values(data.sources ?? {})) {
        for (const e of s.excerpts ?? []) {
            const sha = normalizeSha256(e.originalSha);
            if (sha) out.add(sha);
        }
    }
    return out;
}

async function storageQuota(): Promise<number | undefined> {
    try {
        return (await navigator.storage?.estimate?.())?.quota;
    } catch {
        return undefined;
    }
}

async function allQueued(): Promise<QueuedOriginal[]> {
    try {
        return await StorageManager.getAll<QueuedOriginal>('originals');
    } catch {
        return [];
    }
}

/** Run `fn` as the only sender across tabs (Web Lock); without locks, as the only one in this tab. */
async function asOnlySender(fn: () => Promise<void>): Promise<void> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks?.request) {
        await locks.request('strom-originals', { ifAvailable: true }, async (lock) => {
            if (lock) await fn();
        });
        return;
    }
    await fn();
}

export const originalsMethods = uiModule({
    /**
     * The research of the open tree when originals can go to it: linked, on a
     * computer, the research's features on. `accepts.media` is checked when
     * queueing (an older research gets previews only).
     */
    researchOriginalsLink(): { treeId: TreeId; researchId: string } | null {
        const ctx = this.researchSyncLink();
        if (!ctx || !onComputer() || !researchLinksEnabled()) return null;
        return { treeId: ctx.treeId, researchId: ctx.link.id };
    },

    /**
     * The original's identity, taken before the file is shrunk — only for a
     * tree linked to a research (any other tree: null, nothing is computed).
     */
    async prepareOriginal(file: Blob, name: string): Promise<MediaOriginal | null> {
        if (!this.researchOriginalsLink()) return null;
        try {
            const sha256 = await sha256OfBlob(file);
            const head = new Uint8Array(await file.slice(0, EXIF_HEAD_BYTES).arrayBuffer());
            const orientation = exifOrientation(head);
            return {
                sha256, name: name || 'file', mimeType: file.type || 'application/octet-stream', bytes: file.size,
                ...(orientation > 1 ? { orientation } : {}),
            };
        } catch (err) {
            console.warn('Hashing the original failed', err);
            return null;
        }
    },

    /**
     * Put an original in the queue for the open tree's research and try to
     * send it. `region` is where a crop lies on the file as the user saw it.
     */
    async queueOriginal(original: MediaOriginal, file: Blob,
        target: { personId?: PersonId; sourceId?: string; region?: Region; note?: string }): Promise<QueueOutcome> {
        const link = this.researchOriginalsLink();
        if (!link) return 'notLinked';
        const accepts = this.researchMediaAccepts(link.researchId);
        if (!accepts) return 'notTaken';
        if (SettingsManager.isEncryptionEnabled()) return 'encrypted';
        if (file.size > accepts.maxBytes) return 'tooLarge';
        const key = queueKey(link.treeId, original.sha256);
        const waiting = await allQueued();
        if (waiting.some(r => queueKey(r.treeId, r.sha256) === key)) return 'queued';
        const queuedBytes = waiting.reduce((sum, r) => sum + (r.bytes || 0), 0);
        if (!fitsBudget(queuedBytes, file.size, await storageQuota())) return 'noRoom';
        const rec: QueuedOriginal = {
            sha256: original.sha256, treeId: link.treeId, researchId: link.researchId,
            name: original.name, mimeType: original.mimeType, bytes: file.size, blob: file,
            ...(target.personId ? { personId: target.personId } : {}),
            ...(target.sourceId ? { sourceId: target.sourceId } : {}),
            ...(target.region ? { region: regionToStored(target.region, original.orientation) } : {}),
            orientation: original.orientation ?? 1,
            ...(target.note ? { note: target.note.slice(0, 500) } : {}),
            addedAt: Date.now(), attempts: 0,
        };
        try {
            await StorageManager.set('originals', key, rec);
        } catch (err) {
            console.warn('Queueing the original failed', err);
            return 'failed';
        }
        queuedKeys.add(key);
        void this.researchOriginalsKick();
        return 'queued';
    },

    /** What the research says about originals (`accepts.media`), or null when it does not take them. */
    researchMediaAccepts(researchId: string): { maxBytes: number; region: boolean } | null {
        const accepts = this.researchAcceptsOf(researchId);
        if (!accepts?.media) return null;
        return { maxBytes: accepts.mediaMaxBytes ?? DEFAULT_MEDIA_MAX_BYTES, region: accepts.mediaRegion };
    },

    /** The state line of an attachment's original: in the research, waiting, or nothing to say. */
    originalStateOf(sha: string | null | undefined): 'sent' | 'queued' | null {
        const link = this.researchOriginalsLink();
        const hash = normalizeSha256(sha);
        if (!link || !hash || !this.researchMediaAccepts(link.researchId)) return null;
        if (queuedKeys.has(queueKey(link.treeId, hash))) return 'queued';
        return sentMap(link.researchId)[hash] ? 'sent' : null;
    },

    /** Load the queue's keys once (the state lines), then try to send. */
    async initOriginalsQueue(): Promise<void> {
        if (queueLoaded) return;
        queueLoaded = true;
        for (const rec of await allQueued()) queuedKeys.add(queueKey(rec.treeId, rec.sha256));
    },

    /**
     * Send what waits for the open tree's research, one file at a time, while
     * the bridge answers. Called when a file is queued and after each answer
     * of the bridge.
     */
    async researchOriginalsKick(): Promise<void> {
        if (sending) return;
        const link = this.researchOriginalsLink();
        if (!link || !this.researchMediaAccepts(link.researchId)) return;
        const bridge = parseLiveBridge(storedResearchBridge(link.researchId)?.base);
        if (!bridge) return;
        sending = true;
        let changed = false;
        try {
            await asOnlySender(async () => {
                const data = DataManager.getData();
                const referenced = referencedShas(data);
                for (const rec of await allQueued()) {
                    const key = queueKey(rec.treeId, rec.sha256);
                    // A tree gone for good takes its queue with it.
                    if (!TreeManager.getTreeMetadata(rec.treeId)) {
                        await StorageManager.delete('originals', key);
                        queuedKeys.delete(key);
                        continue;
                    }
                    // Only the open tree's (its data and its research are at hand).
                    if (rec.treeId !== link.treeId || rec.researchId !== link.researchId) continue;
                    if (!referenced.has(rec.sha256)) {
                        // Removed here (undo may bring it back): not sent; forgotten after a month.
                        if (Date.now() - rec.addedAt > ORPHAN_MAX_AGE_MS) {
                            await StorageManager.delete('originals', key);
                            queuedKeys.delete(key);
                        }
                        continue;
                    }
                    const targets = originalTargets(rec, data);
                    if (targets.gone) {
                        await StorageManager.delete('originals', key);
                        queuedKeys.delete(key);
                        continue;
                    }
                    // A person or source the research does not know yet: after the next send.
                    if (!targets.ready) continue;
                    const result = await this.sendOneOriginal(bridge.base, rec,
                        { ...targets, region: this.researchMediaAccepts(link.researchId)?.region ?? false });
                    if (result === 'down' || result === 'full') break;
                    if (result === 'retry') {
                        await StorageManager.set('originals', key, { ...rec, attempts: rec.attempts + 1 });
                        continue;
                    }
                    await StorageManager.delete('originals', key);
                    queuedKeys.delete(key);
                    if (result !== 'refused') noteSent(rec.researchId, rec.sha256, result);
                    changed = true;
                }
            });
        } catch (err) {
            console.warn('Sending originals failed', err);
        } finally {
            sending = false;
        }
        if (changed) this.renderAttachmentsList();
    },

    /**
     * One file: ask whether the research has it, send it when not. Returns the
     * research's id for it, 'refused' (it will never take it: wrong type, too
     * large, hash mismatch), 'retry' (try again later) or 'down' (the bridge
     * does not answer — stop for now).
     */
    async sendOneOriginal(base: string, rec: QueuedOriginal, targets: { person?: string; source?: string; region?: boolean }):
        Promise<string | 'refused' | 'retry' | 'down' | 'full'> {
        const url = `${base}/media/${rec.sha256}`;
        try {
            const res = await fetchWithTimeout(url, ASK_TIMEOUT_MS);
            if (res.ok) {
                const id = mediaReplyId(await res.json().catch(() => null));
                if (id) return id;
            } else if (res.status !== 404) {
                return res.status >= 500 ? 'retry' : 'down';
            }
        } catch {
            return 'down';
        }
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), Math.max(PUT_MIN_TIMEOUT_MS, rec.bytes / 2000)) : null;
        try {
            const res = await fetch(url, {
                method: 'PUT',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                headers: uploadHeaders(rec, targets),
                body: rec.blob,
                signal: ctl?.signal,
            });
            if (res.ok) return mediaReplyId(await res.json().catch(() => null)) ?? 'ok';
            // Too large / a kind it does not take: never. Out of disk space: stop for now.
            if (res.status === 413 || res.status === 415) {
                console.warn(`Strom Research refused the original ${rec.name} (HTTP ${res.status})`);
                return 'refused';
            }
            if (res.status === 507) {
                console.warn('Strom Research has no room for originals');
                return 'full';
            }
            if (res.status === 403) return 'down';
            // 404 (person / source unknown there yet), 409 / 422 (garbled on the way), 5xx: again later.
            return 'retry';
        } catch {
            return 'down';
        } finally {
            if (timer) clearTimeout(timer);
        }
    },
});
