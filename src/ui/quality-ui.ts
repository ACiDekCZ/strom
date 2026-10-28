/**
 * "Not an error" marks and the research (spec 021 §D, ZADANI_DEV §2.4): the
 * open research tree's marks go to its bridge when it takes them
 * (`quality.dismiss`), wait while it does not run, and the research's own
 * marks come in when it tells them (`quality.read`, by `/status.quality.rev`
 * or the stream's `quality {rev}` event). The tree's list is the truth; the
 * device's record of what the research holds (quality-bridge.ts) is the base
 * a three-way merge needs. Only the open tree: a mark of another tree waits
 * until it is opened.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { parseLiveBridge, cleanText, type LiveStatus } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import {
    QUALITY_DISMISS_FEATURE, QUALITY_READ_FEATURE, dismissBody, dismissalKey, marksInTree, mergeResearchMarks, researchMarkKey,
} from '../quality-dismiss.js';
import {
    postQualityDismiss, fetchQualityMarks, loadQualityBridgeRecord, saveQualityBridgeRecord, type QualityBridgeRecord,
} from '../quality-bridge.js';
import { DUPLICATES_JUDGE_FEATURE } from '../duplicate-verdicts.js';
import type { QualityDismissal, TreeId } from '../types.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

/** Fired on window when the marks or their send state changed (the dialog redraws). */
export const QUALITY_CHANGED_EVENT = 'strom:quality-changed';

const records = new Map<string, QualityBridgeRecord>();
const loadingRecord = new Map<string, Promise<QualityBridgeRecord>>();
const flushing = new Set<string>();
const flushAgain = new Set<string>();
/** The `quality.rev` last read (or written) per research. */
const knownRev = new Map<string, string>();
/** Writes sent per research: a read started before one ended is not merged (it may predate it). */
const writes = new Map<string, number>();
const reading = new Set<string>();
/** Per research: the features of its last status in this page. */
const lastFeatures = new Map<string, readonly string[]>();
let listening = false;

function activeResearchId(): string | null {
    if (DataManager.isViewMode()) return null;
    const treeId = DataManager.getCurrentTreeId();
    const id = treeId ? TreeManager.getTreeMetadata(treeId)?.research?.id : undefined;
    return id ? id.toLowerCase() : null;
}

function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

async function recordOf(rid: string): Promise<QualityBridgeRecord> {
    const have = records.get(rid);
    if (have) return have;
    let pending = loadingRecord.get(rid);
    if (!pending) {
        pending = loadQualityBridgeRecord(rid).then(r => {
            if (!records.has(rid)) records.set(rid, r);
            return records.get(rid)!;
        }).finally(() => loadingRecord.delete(rid));
        loadingRecord.set(rid, pending);
    }
    return pending;
}

function tellChanged(): void {
    window.dispatchEvent(new CustomEvent(QUALITY_CHANGED_EVENT));
}

export const qualityMethods = uiModule({
    /** At startup: listen for bridge statuses and tree switches. */
    initQualityBridge(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((researchId, status) => this.noteQualityStatus(researchId, status));
        window.addEventListener('strom:tree-switched', () => { void this.qualityForActiveTree(); });
        void this.qualityForActiveTree();
    },

    /** The open tree: what its bridge said last, else the waiting marks stay as they are. */
    async qualityForActiveTree(): Promise<void> {
        const rid = activeResearchId();
        if (!rid) return;
        await recordOf(rid);
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        if (status) this.noteQualityStatus(rid, status);
        else void this.flushQuality(rid);
    },

    /**
     * Does the open tree's research take the marks (its last status in this
     * page, else what this device remembers of it)? The send state in the
     * list of marks shows only then (ZADANI_DEV §2.3).
     */
    qualitySendsToResearch(treeId: string): boolean {
        const rid = TreeManager.getTreeMetadata(treeId as TreeId)?.research?.id?.toLowerCase();
        if (!rid) return false;
        const said = lastFeatures.get(rid);
        if (said) return said.includes(QUALITY_DISMISS_FEATURE);
        return records.get(rid)?.dismiss === true;
    },

    /**
     * Did the research judge possible duplicates at its last connection (its
     * last status in this page, else what this device remembers of it)?
     */
    async researchJudgedDuplicates(researchId: string): Promise<boolean> {
        const rid = researchId.toLowerCase();
        const said = lastFeatures.get(rid);
        if (said) return said.includes(DUPLICATES_JUDGE_FEATURE);
        return (await recordOf(rid)).judge;
    },

    /** A status: send the waiting marks, read the research's when its rev moved. */
    noteQualityStatus(researchId: string, status: LiveStatus): void {
        const rid = researchId.toLowerCase();
        const features = status.features ?? [];
        lastFeatures.set(rid, features);
        void recordOf(rid).then(async (record) => {
            const dismiss = features.includes(QUALITY_DISMISS_FEATURE);
            const judge = features.includes(DUPLICATES_JUDGE_FEATURE);
            if (record.dismiss !== dismiss || record.judge !== judge) {
                record.dismiss = dismiss;
                record.judge = judge;
                await saveQualityBridgeRecord(rid, record);
            }
            if (rid !== activeResearchId()) return;
            if (dismiss) await this.flushQuality(rid);
            if (features.includes(QUALITY_READ_FEATURE) && status.qualityRev && status.qualityRev !== knownRev.get(rid)) {
                await this.readQualityMarks(rid, status.qualityRev);
            }
        });
    },

    /** The stream's `quality {rev}` event (the research's marks changed). */
    noteQualityEvent(researchId: string, raw: unknown): void {
        const rid = researchId.toLowerCase();
        if (rid !== activeResearchId()) return;
        const rev = raw && typeof raw === 'object' ? cleanText((raw as { rev?: unknown }).rev, 128) : '';
        if (!rev || rev === knownRev.get(rid)) return;
        if (!(lastFeatures.get(rid) ?? []).includes(QUALITY_READ_FEATURE)) return;
        void this.readQualityMarks(rid, rev);
    },

    /**
     * Bring the research in line with the open tree's marks: each mark all of
     * whose people have the research's REFN goes (once), each one the tree
     * lost that the research holds is taken back. The send state of each
     * mark is kept in the tree (no undo step): sent, waiting (the bridge does
     * not run, is busy, or holds writes) or in the app only (a person without
     * a REFN, or refused).
     */
    async flushQuality(researchId: string): Promise<void> {
        const rid = researchId.toLowerCase();
        if (flushing.has(rid)) {
            flushAgain.add(rid);
            return;
        }
        flushing.add(rid);
        try {
            do {
                flushAgain.delete(rid);
                await this.flushQualityOnce(rid);
            } while (flushAgain.has(rid) && rid === activeResearchId());
        } finally {
            flushing.delete(rid);
        }
    },

    async flushQualityOnce(rid: string): Promise<void> {
        const record = await recordOf(rid);
        const treeId = DataManager.getCurrentTreeId();
        if (rid !== activeResearchId() || !treeId || DataManager.isReadOnly()) return;
        const takes = this.qualitySendsToResearch(treeId);
        if (!takes) return;
        const states = new Map<string, QualityDismissal['sync']>();
        const canWrite = (): boolean => {
            const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
            return !!status && !!bridgeBase(rid) && (status.features ?? []).includes(QUALITY_DISMISS_FEATURE) && !this.researchWriteHeldNow(rid);
        };
        let open = canWrite();
        const acked = new Map(record.acked.map(b => [researchMarkKey(b), b]));
        let recordChanged = false;
        const persons = DataManager.getData().persons;
        const marks = DataManager.getData().qualityDismissed ?? [];
        const wanted = new Set<string>();
        for (const mark of marks) {
            const key = dismissalKey(mark);
            const body = dismissBody(mark, persons);
            if (!body) { states.set(key, 'app'); continue; }
            const rk = researchMarkKey(body);
            wanted.add(rk);
            if (acked.has(rk)) { states.set(key, 'sent'); continue; }
            if (mark.sync === 'app') continue; // refused once: never again
            if (!open) { states.set(key, 'queued'); continue; }
            const before = this.researchHeadNow(rid);
            writes.set(rid, (writes.get(rid) ?? 0) + 1);
            const r = await postQualityDismiss(bridgeBase(rid)!, body, this.researchStatusOf(rid)?.features);
            if (r.ok) {
                acked.set(rk, body);
                recordChanged = true;
                states.set(key, 'sent');
                if (r.rev) knownRev.set(rid, r.rev);
                if (r.head) this.researchTakeOwnWriteHead(rid, before, r.head, r.parent);
            } else if (r.code === 'invalid') {
                states.set(key, 'app');
            } else {
                states.set(key, 'queued');
                open = false;
            }
        }
        // Taken back in the tree (Restore, an undo of the mark): taken back in the research.
        for (const [rk, body] of [...acked]) {
            if (wanted.has(rk) || !open) continue;
            const before = this.researchHeadNow(rid);
            writes.set(rid, (writes.get(rid) ?? 0) + 1);
            const r = await postQualityDismiss(bridgeBase(rid)!, { ...body, do: 'undo' }, this.researchStatusOf(rid)?.features);
            if (r.ok || r.code === 'invalid') {
                acked.delete(rk);
                recordChanged = true;
                if (r.ok && r.rev) knownRev.set(rid, r.rev);
                if (r.ok && r.head) this.researchTakeOwnWriteHead(rid, before, r.head, r.parent);
            } else {
                open = false;
            }
        }
        if (recordChanged) {
            record.acked = [...acked.values()];
            await saveQualityBridgeRecord(rid, record);
        }
        this.qualityKeepStates(rid, states);
    },

    /** Keep the send states in the open tree (still the same research's), without an undo step. */
    qualityKeepStates(rid: string, states: ReadonlyMap<string, QualityDismissal['sync']>): void {
        if (rid !== activeResearchId() || states.size === 0) return;
        const marks = DataManager.getData().qualityDismissed ?? [];
        let changed = false;
        const next = marks.map(m => {
            const s = states.get(dismissalKey(m));
            if (!s || m.sync === s) return m;
            changed = true;
            return { ...m, sync: s };
        });
        if (!changed) return;
        DataManager.replaceQualityDismissed(next);
        tellChanged();
    },

    /**
     * `GET /quality`: take over the marks made in the research or on another
     * device and those taken back there (mergeResearchMarks). Not merged
     * while the app writes, nor when a write ended during the read.
     */
    async readQualityMarks(researchId: string, rev: string): Promise<void> {
        const rid = researchId.toLowerCase();
        const base = bridgeBase(rid);
        if (!base || reading.has(rid) || flushing.has(rid)) return;
        reading.add(rid);
        try {
            const writesBefore = writes.get(rid) ?? 0;
            const reply = await fetchQualityMarks(base);
            if (!reply || flushing.has(rid) || (writes.get(rid) ?? 0) !== writesBefore) return;
            if (rid !== activeResearchId() || DataManager.isReadOnly()) return;
            const record = await recordOf(rid);
            const data = DataManager.getData();
            const research = marksInTree(reply.dismissed, data.persons);
            const acked = new Set(record.acked.map(researchMarkKey));
            const next = mergeResearchMarks(data.qualityDismissed ?? [], research, acked, data.persons);
            if (next) {
                DataManager.replaceQualityDismissed(next);
                tellChanged();
            }
            // What the research holds now (of this tree's people) is what the device knows.
            record.acked = research.map(r => ({ kind: r.mark.kind, persons: [...r.mark.persons].sort(), ...(r.mark.subject ? { subject: r.mark.subject } : {}) }));
            await saveQualityBridgeRecord(rid, record);
            knownRev.set(rid, reply.rev || rev);
            // Taken back here meanwhile (the undo waits): send it.
            void this.flushQuality(rid);
        } finally {
            reading.delete(rid);
        }
    },

    /** A mark made or taken back in the open tree: off to the research (when it takes them). */
    qualityMarksChanged(): void {
        const rid = activeResearchId();
        if (rid) void this.flushQuality(rid);
    },
});
