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
import { parseLiveBridge, withAppVersion, researchSchemeUrl } from '../research-link.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { sha256OfBlob, normalizeSha256 } from '../sha256.js';
import {
    QueuedOriginal, Region, queueKey, fitsBudget, exifOrientation, originalTargets, uploadHeaders, mediaReplyId,
    regionToStored, originalsBudget, DEFAULT_MEDIA_MAX_BYTES,
} from '../originals.js';
import { onComputer, fetchWithTimeout, bridgeFailure } from './research-ui.js';
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

/** Why an original was not queued (the attachment keeps its preview either way). 'sent': straight to a running research. */
export type QueueOutcome = 'queued' | 'sent' | 'notLinked' | 'notTaken' | 'off' | 'safari' | 'encrypted' | 'tooLarge' | 'noRoom' | 'failed';

/** Why only the preview is in the tree (the title of "preview only"). */
export type PreviewOnlyWhy = 'room' | 'encrypted' | 'off' | 'older' | 'safari';

/**
 * What the app can say about one file's original (the third line of an
 * attachment or excerpt row, the image viewer's bar). Nothing claims "in the
 * research" before the research confirmed it (a successful GET / PUT, or a
 * crop it sent back with `_STROM_SHA`).
 */
export type MediaState =
    | { kind: 'queued'; bytes: number; noId: boolean }
    | { kind: 'sending' }
    | { kind: 'inResearch' }
    | { kind: 'previewOnly'; why: PreviewOnlyWhy | null }
    | { kind: 'gone' };

/** "Full quality" opens here (fetched from the bridge) up to this size, these types. */
export const FULL_QUALITY_MAX_BYTES = 50 * 1024 * 1024;
const FULL_QUALITY_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Queued originals (keys) in this tab, for the attachment's state line. */
const queuedKeys = new Set<string>();
/** Size of each queued original (by queue key), for its state line. */
const queuedSizes = new Map<string, number>();
/** When each queued original was added (by queue key), for "waiting N days". */
const queuedAt = new Map<string, number>();
/** The original discarded last, for a while (Undo in the queue's row). */
let lastDiscarded: { key: string; rec: QueuedOriginal; at: number } | null = null;
const DISCARD_UNDO_MS = 8000;
/** The send run under way: how many it set out with, how many went, how much. */
let sendRun: { total: number; done: number; bytes: number } | null = null;
/** The queue's budget as last measured (bytes). */
let lastBudget = 2 * 1024 * 1024 * 1024;
/** The original on its way right now (its queue key). */
let sendingKey: string | null = null;
/** Why an original stayed out (by hash, this session): the title of "preview only". */
const previewOnlyWhy = new Map<string, PreviewOnlyWhy>();
/** Originals the research said it no longer has (by hash, this session). */
const goneShas = new Set<string>();
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

/** Drop a queue key from this tab's view of the queue. */
function forgetQueued(key: string): void {
    queuedKeys.delete(key);
    queuedSizes.delete(key);
    queuedAt.delete(key);
}

/** "182 MB" / "640 kB" (one decimal from 10 MB down). */
export function formatBytesShort(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 10 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} kB`;
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
        target: { personId?: PersonId; sourceId?: string; region?: Region; note?: string; material?: boolean }): Promise<QueueOutcome> {
        const link = this.researchOriginalsLink();
        if (!link) return 'notLinked';
        const accepts = this.researchMediaAccepts(link.researchId);
        const why = (w: PreviewOnlyWhy): void => { previewOnlyWhy.set(original.sha256, w); };
        if (!accepts) { why('older'); return 'notTaken'; }
        if (TreeManager.getTreeMetadata(link.treeId)?.research?.sendMedia === false) { why('off'); return 'off'; }
        // Safari does not reach the research: a queue would never empty.
        if (bridgeFailure(null) === 'safari') { why('safari'); return 'safari'; }
        if (file.size > accepts.maxBytes) return 'tooLarge';
        if (target.material && this.researchBridgeFresh(link.researchId)) {
            if (await this.sendOriginalNow(link, original, file, target)) return 'sent';
        }
        if (SettingsManager.isEncryptionEnabled()) {
            // Never kept in the browser in the clear: straight to a running research, or preview only.
            const sent = await this.sendOriginalNow(link, original, file, target);
            if (sent) return 'sent';
            why('encrypted');
            return 'encrypted';
        }
        const key = queueKey(link.treeId, original.sha256);
        const waiting = await allQueued();
        if (waiting.some(r => queueKey(r.treeId, r.sha256) === key)) return 'queued';
        const queuedBytes = waiting.reduce((sum, r) => sum + (r.bytes || 0), 0);
        if (!fitsBudget(queuedBytes, file.size, await storageQuota())) { why('room'); return 'noRoom'; }
        const rec: QueuedOriginal = {
            sha256: original.sha256, treeId: link.treeId, researchId: link.researchId,
            name: original.name, mimeType: original.mimeType, bytes: file.size, blob: file,
            ...(target.personId ? { personId: target.personId } : {}),
            ...(target.sourceId ? { sourceId: target.sourceId } : {}),
            ...(target.region ? { region: regionToStored(target.region, original.orientation) } : {}),
            orientation: original.orientation ?? 1,
            ...(target.note ? { note: target.note.slice(0, 500) } : {}),
            // Material sent from the dialog is in no attachment: it goes anyway.
            ...(target.material ? { sendAnyway: true } : {}),
            addedAt: Date.now(), attempts: 0,
        };
        try {
            await StorageManager.set('originals', key, rec);
        } catch (err) {
            console.warn('Queueing the original failed', err);
            return 'failed';
        }
        queuedKeys.add(key);
        queuedSizes.set(key, file.size);
        queuedAt.set(key, rec.addedAt);
        void this.researchOriginalsKick();
        return 'queued';
    },

    /** What the research says about originals (`accepts.media`), or null when it does not take them. */
    researchMediaAccepts(researchId: string): { maxBytes: number; region: boolean } | null {
        const accepts = this.researchAcceptsOf(researchId);
        if (!accepts?.media) return null;
        return { maxBytes: accepts.mediaMaxBytes ?? DEFAULT_MEDIA_MAX_BYTES, region: accepts.mediaRegion };
    },


    /**
     * The state of one file's original for its row: waiting (and whether the
     * research knows whom it belongs to), on its way, in the research, preview
     * only (and why), or gone from the research. Null: nothing to say (a tree
     * without a research, a phone, the research's features off).
     */
    mediaStateOf(item: { sha?: string | null; bytes?: number; personId?: PersonId; sourceId?: string; fromResearch?: boolean }): MediaState | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const hash = normalizeSha256(item.sha);
        if (hash && goneShas.has(hash)) return { kind: 'gone' };
        const accepts = this.researchMediaAccepts(link.researchId);
        if (!hash) {
            // Added before the tree was linked, or a file of no original (a pasted crop of a crop).
            if (!accepts) return { kind: 'previewOnly', why: 'older' };
            return { kind: 'previewOnly', why: null };
        }
        // A crop the research sent back names its original: the research has it.
        if (item.fromResearch) return { kind: 'inResearch' };
        if (!accepts) return { kind: 'previewOnly', why: 'older' };
        const key = queueKey(link.treeId, hash);
        if (sendingKey === key) return { kind: 'sending' };
        if (queuedKeys.has(key)) {
            const targets = originalTargets({ personId: item.personId, sourceId: item.sourceId }, DataManager.getData());
            return { kind: 'queued', bytes: queuedSizes.get(key) ?? item.bytes ?? 0, noId: !targets.ready };
        }
        if (sentMap(link.researchId)[hash]) return { kind: 'inResearch' };
        return { kind: 'previewOnly', why: previewOnlyWhy.get(hash) ?? null };
    },

    /** How "Full quality" opens: here (fetched from the running bridge), in the research (a link), or not at all. */
    fullQualityMode(sha: string | null | undefined, mimeType: string, bytes: number): 'app' | 'external' | null {
        const link = this.researchOriginalsLink();
        const hash = normalizeSha256(sha);
        if (!link || !hash) return null;
        const external = this.researchLinkAvailable('media') && researchSchemeUrl('media', { tree: link.researchId, sha: hash }) ? 'external' : null;
        // Up at the last poll is enough: a failed fetch says so and offers the research.
        const here = this.researchBridgeUp(link.researchId) && !!storedResearchBridge(link.researchId)?.base
            && FULL_QUALITY_TYPES.includes(mimeType) && bytes > 0 && bytes <= FULL_QUALITY_MAX_BYTES;
        return here ? 'app' : external;
    },

    /** Open the original in the research (strom-research://media). */
    openOriginalInResearch(sha: string): void {
        const link = this.researchOriginalsLink();
        const url = link ? researchSchemeUrl('media', { tree: link.researchId, sha }) : null;
        if (url) this.launchResearchLink(url);
    },

    /**
     * Fetch the original from the bridge (`GET /media/<sha>?file=1`) with its
     * progress. A 404 / 410 marks it gone. The caller owns the object URL.
     */
    async fetchOriginal(sha: string, progress: (loaded: number, total: number) => void, signal: AbortSignal): Promise<{ url: string; bytes: number; type: string }> {
        const link = this.researchOriginalsLink();
        const base = link ? parseLiveBridge(storedResearchBridge(link.researchId)?.base)?.base : null;
        if (!link || !base) throw new Error('no bridge');
        const res = await fetch(withAppVersion(`${base}/media/${sha}?file=1`), {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal,
        });
        if (res.status === 404 || res.status === 410) {
            goneShas.add(sha);
            throw new Error('gone');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('Content-Length')) || 0;
        const type = res.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream';
        const reader = res.body?.getReader();
        if (!reader) {
            const blob = await res.blob();
            progress(blob.size, blob.size);
            return { url: URL.createObjectURL(blob), bytes: blob.size, type };
        }
        const chunks: BlobPart[] = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            progress(loaded, total || loaded);
        }
        const blob = new Blob(chunks, { type });
        return { url: URL.createObjectURL(blob), bytes: blob.size, type };
    },

    /** Was this original found gone from the research (this session)? */
    originalGone(sha: string | null | undefined): boolean {
        const hash = normalizeSha256(sha);
        return !!hash && goneShas.has(hash);
    },

    /**
     * Say once per tree, session and reason why an original stayed out of the
     * queue (the row then says "preview only" quietly). An older research is
     * not told: its line sits by the Attachments heading.
     */
    noteOriginalOutcome(outcome: QueueOutcome, bytes: number, target: { personId?: PersonId; sourceId?: string }): void {
        const link = this.researchOriginalsLink();
        if (!link) return;
        const m = strings.media;
        const reasons: Partial<Record<QueueOutcome, () => { text: string; action?: { label: string; run: () => void } }>> = {
            noRoom: () => ({ text: m.noRoom(formatBytesShort(bytes)), action: { label: m.queueOpen, run: () => this.showOriginalsQueue() } }),
            encrypted: () => ({ text: m.encryptedPreviewOnly }),
            safari: () => ({ text: m.safariPreviewOnly }),
        };
        let reason: string = outcome;
        let say = reasons[outcome];
        if (outcome === 'queued' && !originalTargets(target, DataManager.getData()).ready) {
            reason = 'noId';
            say = () => ({ text: m.queuedNoIdToast });
        }
        if (!say) return;
        const key = `strom-media-notice:${link.treeId}:${reason}`;
        try {
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
        } catch { /* no storage: said every time */ }
        const { text, action } = say();
        this.showToast(text, 8000, { closable: true, ...(action ? { action } : {}) });
    },

    /** The open tree's research takes originals, or says it does not (the line by the Attachments heading). */
    researchMediaOlder(): boolean {
        const link = this.researchOriginalsLink();
        return !!link && !this.researchMediaAccepts(link.researchId);
    },

    /** What waits for the open tree's research: how many, how large, the oldest for how many days (null: nothing). */
    originalsQueueLine(): { n: number; bytes: number; days: number } | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const prefix = `${link.treeId}:`;
        let n = 0;
        let bytes = 0;
        let oldest = Infinity;
        for (const key of queuedKeys) {
            if (!key.startsWith(prefix)) continue;
            n++;
            bytes += queuedSizes.get(key) ?? 0;
            oldest = Math.min(oldest, queuedAt.get(key) ?? Date.now());
        }
        if (n === 0) return null;
        return { n, bytes, days: Math.floor((Date.now() - oldest) / (24 * 60 * 60 * 1000)) };
    },

    /** Originals waiting 3 days or more, or the space nearly full: worth the ⋯ dot. */
    originalsQueueWarn(): boolean {
        const line = this.originalsQueueLine();
        return !!line && (line.days >= 3 || line.bytes >= 0.9 * lastBudget);
    },

    /** The block's second line: the waiting originals with "Show…" (HTML, '' for none). */
    originalsQueueLineHtml(): string {
        const line = this.originalsQueueLine();
        if (!line) return '';
        const q = strings.mediaQueue;
        const esc = (t: string): string => this.escapeHtml(t);
        // On their way: "Sending originals, 2 of 3". Waiting 3 days, or the space nearly full: amber, said why.
        const sendingNow = sendingKey !== null && sendRun;
        const full = line.bytes >= 0.9 * lastBudget;
        const warn = !sendingNow && (line.days >= 3 || full);
        const text = sendingNow ? `${q.sendingK(sendRun!.done + 1, sendRun!.total)} · ${q.sentSize(formatBytesShort(sendRun!.bytes))}`
            : line.days >= 3 ? `${q.staleTitle(line.days)} · ${q.staleSub(line.n, formatBytesShort(line.bytes))}`
            : full ? `${q.fullTitle} · ${q.fullSub(formatBytesShort(line.bytes), formatBytesShort(lastBudget))}`
            : q.summary(line.n, formatBytesShort(line.bytes));
        const icon = sendingNow ? '<span class="media-spinner" aria-hidden="true"></span>'
            : warn ? '<span class="media-warn-dot" aria-hidden="true"></span>' : '<span class="media-ring" aria-hidden="true"></span>';
        return `<div class="research-sync-line2${warn ? ' is-warn' : ''}">${icon}`
            + `<span class="research-sync-line2-text">${esc(text)}</span>`
            + `<button type="button" class="research-sync-link" data-action="showOriginals" onclick="window.Strom.UI.showOriginalsQueue()">${esc(q.show)}</button></div>`;
    },

    /** Settings → Data, the waiting originals open (from the block, a toast, "Research for this tree"). */
    showOriginalsQueue(): void {
        this.closeActionsMenu();
        if (!document.getElementById('settings-modal')?.classList.contains('active')) this.showSettingsDialog();
        void this.renderOriginalsQueueRow().then(() => {
            const row = document.getElementById('media-queue-row') as HTMLDetailsElement | null;
            if (!row || row.hidden) return;
            row.open = true;
            row.scrollIntoView({ block: 'nearest' });
            row.querySelector<HTMLElement>('summary')?.focus();
        });
    },

    /**
     * The row "Originals waiting for the research" in Settings → Data, only
     * while something waits (any tree): the budget, why it is only in this
     * browser, each file with Discard, Discard all, Send now / Start the research.
     */
    async renderOriginalsQueueRow(): Promise<void> {
        const body = document.querySelector('#settings-modal [aria-labelledby="settings-group-data"] .settings-group-body');
        if (!body) return;
        // The row exists before anything is awaited: two renders at once fill one row.
        let row = document.getElementById('media-queue-row') as HTMLDetailsElement | null;
        if (!row) {
            row = document.createElement('details');
            row.id = 'media-queue-row';
            row.className = 'settings-row media-queue-row';
            row.hidden = true;
            body.prepend(row);
        }
        const records = await allQueued();
        const undo = lastDiscarded && Date.now() - lastDiscarded.at < DISCARD_UNDO_MS ? lastDiscarded : null;
        if (records.length === 0 && !undo) {
            row.hidden = true;
            return;
        }
        const wasOpen = row.open || !!undo;
        row.hidden = false;
        const q = strings.mediaQueue;
        const esc = (t: string): string => this.escapeHtml(t);
        const used = records.reduce((sum, r) => sum + (r.bytes || 0), 0);
        const budget = originalsBudget(await storageQuota());
        lastBudget = budget;
        const pct = Math.min(100, Math.round(used / Math.max(1, budget) * 100));
        const data = DataManager.getData();
        const openTree = DataManager.getCurrentTreeId();
        const targetOf = (r: QueuedOriginal): string => {
            if (r.treeId !== openTree) return TreeManager.getTreeMetadata(r.treeId)?.name ?? '';
            const person = r.personId ? data.persons[r.personId] : undefined;
            const source = r.sourceId ? data.sources?.[r.sourceId] : undefined;
            return person ? `${person.firstName} ${person.lastName}`.trim() : source?.title ?? '';
        };
        const since = (ms: number): string => new Date(ms).toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'numeric' })
            + ' ' + new Date(ms).toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' });
        const link = this.researchOriginalsLink();
        const up = !!link && this.researchBridgeUp(link.researchId);
        const sorted = [...records].sort((a, b) => a.addedAt - b.addedAt);
        row.innerHTML = `
            <summary class="settings-text">
                <span class="settings-name">${esc(q.title)}</span>
                <span class="settings-desc">${esc(q.summary(records.length, formatBytesShort(used)))}</span>
            </summary>
            <div class="media-queue-body">
                ${undo ? `<p class="media-queue-undo" role="status">${esc(q.discarded)} <button type="button" class="link-button media-queue-undo-btn">${esc(strings.undo.undo)}</button></p>` : ''}
                <div class="media-queue-budget${pct >= 90 ? ' is-full' : ''}" role="img" aria-label="${esc(q.budget(formatBytesShort(used), formatBytesShort(budget)))}"><span style="width:${pct}%"></span></div>
                <p class="media-queue-budget-text">${esc(q.budget(formatBytesShort(used), formatBytesShort(budget)))}</p>
                <p class="media-queue-info"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(q.browserOnly)}</span></p>
                <ul class="media-queue-list">
                    ${sorted.map(r => `
                    <li class="media-queue-item${r.attempts >= 3 ? ' is-refused' : ''}" data-key="${esc(queueKey(r.treeId, r.sha256))}">
                        <span class="media-queue-name">${esc(r.name)}</span>
                        <span class="media-queue-target">${esc(targetOf(r))}</span>
                        <span class="media-queue-size">${esc(formatBytesShort(r.bytes))}</span>
                        <span class="media-queue-since">${esc(q.since(since(r.addedAt)))}</span>
                        <button type="button" class="link-button media-queue-discard" data-key="${esc(queueKey(r.treeId, r.sha256))}">${esc(q.discard)}</button>
                    </li>`).join('')}
                </ul>
                <div class="media-queue-foot">
                    <button type="button" class="link-button media-queue-discard-all">${esc(q.discardAll)}</button>
                    ${link ? `<button type="button" class="secondary btn-sm media-queue-send" data-up="${up ? '1' : ''}">${esc(up ? strings.sync.sendNow : strings.sync.startResearch)}</button>` : ''}
                </div>
            </div>`;
        row.open = wasOpen;
        row.querySelectorAll<HTMLButtonElement>('.media-queue-discard').forEach(btn => btn.addEventListener('click', () => {
            void this.discardOriginal(btn.dataset.key ?? '');
        }));
        row.querySelector('.media-queue-discard-all')?.addEventListener('click', () => { void this.discardAllOriginals(); });
        row.querySelector('.media-queue-undo-btn')?.addEventListener('click', () => { void this.undoDiscardOriginal(); });
        row.querySelector<HTMLButtonElement>('.media-queue-send')?.addEventListener('click', (e) => {
            if ((e.currentTarget as HTMLElement).dataset.up) void this.researchOriginalsKick().then(() => this.renderOriginalsQueueRow());
            else this.researchSyncAction('startResearch');
        });
    },

    /**
     * The attachment of a waiting original is being deleted: discard the
     * original too, or keep it to be sent anyway (the research then detaches
     * it as "removed in the app").
     */
    async settleQueuedOriginal(sha: string, discard: boolean): Promise<void> {
        const link = this.researchOriginalsLink();
        if (!link) return;
        const key = queueKey(link.treeId, sha);
        try {
            if (discard) {
                await StorageManager.delete('originals', key);
                forgetQueued(key);
            } else {
                const rec = await StorageManager.get<QueuedOriginal>('originals', key);
                if (rec) await StorageManager.set('originals', key, { ...rec, sendAnyway: true });
            }
        } catch (err) {
            console.warn('Settling the waiting original failed', err);
        }
        this.refreshResearchSyncUi();
    },

    /**
     * Discard one waiting original (no question). Undo stays in the row for a
     * while — a toast would sit under the Settings dialog.
     */
    async discardOriginal(key: string): Promise<void> {
        let rec: QueuedOriginal | null | undefined;
        try { rec = await StorageManager.get<QueuedOriginal>('originals', key); } catch { /* gone already */ }
        if (!rec) return;
        await StorageManager.delete('originals', key);
        forgetQueued(key);
        lastDiscarded = { key, rec, at: Date.now() };
        setTimeout(() => {
            if (lastDiscarded?.key === key && Date.now() - lastDiscarded.at >= DISCARD_UNDO_MS) {
                lastDiscarded = null;
                void this.renderOriginalsQueueRow();
            }
        }, DISCARD_UNDO_MS + 50);
        await this.renderOriginalsQueueRow();
        this.renderAttachmentsList();
        this.refreshResearchSyncUi();
    },

    /** Put the last discarded original back in the queue. */
    async undoDiscardOriginal(): Promise<void> {
        const last = lastDiscarded;
        if (!last) return;
        lastDiscarded = null;
        await StorageManager.set('originals', last.key, last.rec);
        queuedKeys.add(last.key);
        queuedSizes.set(last.key, last.rec.bytes);
        queuedAt.set(last.key, last.rec.addedAt);
        await this.renderOriginalsQueueRow();
        this.renderAttachmentsList();
        this.refreshResearchSyncUi();
    },

    /** Discard every waiting original, after a question. */
    async discardAllOriginals(): Promise<void> {
        const records = await allQueued();
        if (records.length === 0) return;
        const bytes = records.reduce((sum, r) => sum + (r.bytes || 0), 0);
        const ok = await this.showConfirm(strings.mediaQueue.discardAllConfirm(records.length, formatBytesShort(bytes)),
            strings.mediaQueue.title, { confirmLabel: strings.mediaQueue.discardAll, variant: 'danger' });
        if (!ok) return;
        for (const r of records) {
            const key = queueKey(r.treeId, r.sha256);
            await StorageManager.delete('originals', key);
            forgetQueued(key);
        }
        await this.renderOriginalsQueueRow();
        this.renderAttachmentsList();
        this.refreshResearchSyncUi();
    },

    /** Load the queue's keys once (the state lines), then try to send. */
    async initOriginalsQueue(): Promise<void> {
        if (queueLoaded) return;
        queueLoaded = true;
        lastBudget = originalsBudget(await storageQuota());
        for (const rec of await allQueued()) {
            const key = queueKey(rec.treeId, rec.sha256);
            queuedKeys.add(key);
            queuedSizes.set(key, rec.bytes);
            queuedAt.set(key, rec.addedAt);
        }
    },

    /**
     * Send one original straight from memory, not through the queue (an
     * encrypted tree's file never waits in the browser). True when the
     * research has it now.
     */
    async sendOriginalNow(link: { treeId: TreeId; researchId: string }, original: MediaOriginal, file: Blob,
        target: { personId?: PersonId; sourceId?: string; region?: Region; note?: string }): Promise<boolean> {
        if (!this.researchBridgeFresh(link.researchId)) return false;
        const bridge = parseLiveBridge(storedResearchBridge(link.researchId)?.base);
        if (!bridge) return false;
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
        const targets = originalTargets(rec, DataManager.getData());
        if (!targets.ready) return false;
        const result = await this.sendOneOriginal(bridge.base, rec,
            { ...targets, region: this.researchMediaAccepts(link.researchId)?.region ?? false });
        if (result === 'down' || result === 'full' || result === 'retry' || result === 'refused') return false;
        noteSent(link.researchId, original.sha256, result);
        return true;
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
                const all = await allQueued();
                sendRun = { total: all.filter(r => r.treeId === link.treeId).length, done: 0, bytes: 0 };
                for (const rec of all) {
                    const key = queueKey(rec.treeId, rec.sha256);
                    // A tree gone for good takes its queue with it.
                    if (!TreeManager.getTreeMetadata(rec.treeId)) {
                        await StorageManager.delete('originals', key);
                        queuedKeys.delete(key);
                        queuedSizes.delete(key);
                        queuedAt.delete(key);
                        continue;
                    }
                    // Only the open tree's (its data and its research are at hand).
                    if (rec.treeId !== link.treeId || rec.researchId !== link.researchId) continue;
                    if (!referenced.has(rec.sha256) && !rec.sendAnyway) {
                        // Removed here (undo may bring it back): not sent; forgotten after a month.
                        if (Date.now() - rec.addedAt > ORPHAN_MAX_AGE_MS) {
                            await StorageManager.delete('originals', key);
                            queuedKeys.delete(key);
                        queuedSizes.delete(key);
                        queuedAt.delete(key);
                        }
                        continue;
                    }
                    const targets = originalTargets(rec, data);
                    if (targets.gone) {
                        await StorageManager.delete('originals', key);
                        queuedKeys.delete(key);
                        queuedSizes.delete(key);
                        queuedAt.delete(key);
                        continue;
                    }
                    // A person or source the research does not know yet: after the next send.
                    if (!targets.ready) continue;
                    sendingKey = key;
                    this.renderAttachmentsList();
                    this.refreshResearchSyncUi();
                    const result = await this.sendOneOriginal(bridge.base, rec,
                        { ...targets, region: this.researchMediaAccepts(link.researchId)?.region ?? false });
                    sendingKey = null;
                    if (result === 'down' || result === 'full') break;
                    if (result === 'retry') {
                        await StorageManager.set('originals', key, { ...rec, attempts: rec.attempts + 1 });
                        continue;
                    }
                    await StorageManager.delete('originals', key);
                    queuedKeys.delete(key);
                        queuedSizes.delete(key);
                        queuedAt.delete(key);
                    if (result !== 'refused') noteSent(rec.researchId, rec.sha256, result);
                    if (sendRun) { sendRun.done++; sendRun.bytes += rec.bytes; }
                    changed = true;
                }
            });
        } catch (err) {
            console.warn('Sending originals failed', err);
        } finally {
            sending = false;
            sendingKey = null;
            sendRun = null;
        }
        // The rows say what happened (sent, or "sending" over again with the bridge gone).
        this.renderAttachmentsList();
        if (changed) void this.renderOriginalsQueueRow();
        this.refreshResearchSyncUi();
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
            const res = await fetch(withAppVersion(url), {
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
            // Busy (503, Retry-After): stop for now, the next answer of the bridge tries again.
            if (res.status === 503) return 'full';
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
