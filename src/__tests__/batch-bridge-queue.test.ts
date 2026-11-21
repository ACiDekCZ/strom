/**
 * A batch through a bridge that writes it as it is closed (Strom Research
 * 1.36: media.known, media.queued): which files one ask of `media/known`
 * covers, its answer, what `batch/done` says of each queued file, and the
 * followed research's changes held while the batch goes, read as one.
 * Invented hashes and paths only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    batchKnownChunk, parseMediaKnown, parseBatchDoneFiles, batchHeldChange, MEDIA_KNOWN_MAX, KNOWN_CHUNK_FILES,
} from '../batch.js';

const sha = (n: number): string => n.toString(16).padStart(64, '0');
const MB = 1024 * 1024;

describe('the part of the batch one ask of media/known covers', () => {
    it('from the file on, at most the files and bytes of a part, ZIPs and files asked before left out', () => {
        const items = [
            { path: 'a.jpg', size: 1 * MB }, { path: 'b.zip', size: 1 * MB }, { path: 'c.jpg', size: 1 * MB },
            { path: 'd.jpg', size: 1 * MB }, { path: 'e.jpg', size: 1 * MB },
        ];
        expect(batchKnownChunk(items, 0, () => false)).toEqual([0, 2, 3, 4]);
        expect(batchKnownChunk(items, 0, i => i === 2)).toEqual([0, 3, 4]);
        expect(batchKnownChunk(items, 3, () => false)).toEqual([3, 4]);
        expect(batchKnownChunk(items, 0, () => false, 2)).toEqual([0, 2]);
        // Bytes: the part ends before a file over them, never empty.
        expect(batchKnownChunk(items, 0, () => false, 100, 2.5 * MB)).toEqual([0, 2]);
        expect(batchKnownChunk([{ path: 'big.tif', size: 900 * MB }], 0, () => false)).toEqual([0]);
    });

    it('never more than the bridge takes at once', () => {
        const many = Array.from({ length: MEDIA_KNOWN_MAX + 10 }, (_, i) => ({ path: `f${i}.jpg`, size: 1 }));
        expect(batchKnownChunk(many, 0, () => false)).toHaveLength(KNOWN_CHUNK_FILES);
        expect(batchKnownChunk(many, 0, () => false, 1_000_000, Infinity)).toHaveLength(MEDIA_KNOWN_MAX);
    });
});

describe('the answer of media/known', () => {
    it('has, waits in the queue, or not; a hash it did not answer is left out (asked on its own)', () => {
        const said = parseMediaKnown({ known: {
            [sha(1)]: { id: 'I0007', kind: 'input', mime: 'image/jpeg', bytes: 10, here: true },
            [sha(2)]: { queued: true },
            [sha(3)]: null,
            [sha(4)]: { kind: 'media' },
        } }, [sha(1), sha(2), sha(3), sha(4), sha(5)]);
        expect(said).toEqual(new Map([[sha(1), 'has'], [sha(2), 'queued'], [sha(3), 'none']]));
    });

    it('not an answer: null', () => {
        expect(parseMediaKnown(null, [sha(1)])).toBeNull();
        expect(parseMediaKnown({ error: 'no' }, [sha(1)])).toBeNull();
        expect(parseMediaKnown({ known: [] }, [sha(1)])).toBeNull();
    });
});

describe('what batch/done says of each queued file', () => {
    it('the input it became, what the research had, why it was refused, a ZIP’s counts', () => {
        const files = parseBatchDoneFiles([
            { sha: sha(1), path: 'Krabice/a.jpg', batch: 'b1', input: 'I0101' },
            { sha: sha(2).toUpperCase(), path: 'Krabice/b.jpg', known: 'M0042' },
            { sha: sha(3), path: 'Krabice/c.jpg', refused: { code: 'media.no-person', why: 'No person P9 here.' } },
            { sha: sha(4), path: 'Krabice/d.zip', zip: { name: 'd.zip', files: 3, inputs: ['I1', 'I2'], known: ['I3'], refused: [{ path: 'd/x.exe', why: 'a program' }], nested: [] } },
            { sha: 'not-a-sha', input: 'I0001' },
            'junk',
        ]);
        expect(files).toEqual([
            { sha: sha(1), path: 'Krabice/a.jpg', input: 'I0101' },
            { sha: sha(2), path: 'Krabice/b.jpg', known: 'M0042' },
            { sha: sha(3), path: 'Krabice/c.jpg', refused: { code: 'media.no-person', why: 'No person P9 here.' } },
            { sha: sha(4), path: 'Krabice/d.zip', zip: { inputs: 2, known: 1, refused: [{ path: 'd/x.exe', why: 'a program' }] } },
        ]);
    });

    it('an older bridge without files: none', () => {
        expect(parseBatchDoneFiles(undefined)).toEqual([]);
        expect(parseBatchDoneFiles({})).toEqual([]);
    });
});

describe('the changes held while a batch goes, read as one', () => {
    it('the last head, every commit once, newest first', () => {
        const merged = batchHeldChange([
            { head: 'h1', what: ['line 1'], at: '2026-11-21T10:00:01Z' },
            { head: 'h2', what: [], at: '2026-11-21T10:00:02Z', entries: [{ head: 'h2', at: '2026-11-21T10:00:02Z', what: ['line 2'], task: 'T1' }] },
            { head: 'h2', what: [], at: '' },
        ]);
        expect(merged).toEqual({
            head: 'h2', at: '2026-11-21T10:00:02Z', what: [],
            entries: [
                { head: 'h2', at: '2026-11-21T10:00:02Z', what: ['line 2'], task: 'T1' },
                { head: 'h1', at: '2026-11-21T10:00:01Z', what: ['line 1'], task: '' },
            ],
        });
    });

    it('nothing held: nothing to read', () => {
        expect(batchHeldChange([])).toBeNull();
    });
});

describe('the followed research while a batch goes (liveChangeOrHold, liveReleaseHeld)', () => {
    type Change = { head: string; what: string[]; at: string };
    type Ui = {
        liveChangeOrHold(s: unknown, change: Change): void;
        liveReleaseHeld(): void;
    };

    let researchUiMethods: Record<string, unknown> = {};
    beforeAll(async () => {
        ({ researchUiMethods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> });
    }, 180_000);

    it('held while the batch goes, read once after it; not held: read at once, as before', () => {
        let holds = true;
        const loads: Change[] = [];
        const ui = Object.assign(Object.create(null), researchUiMethods, {
            batchHoldsLive: () => holds,
            enqueueLive: (_s: unknown, job: () => Promise<void>) => { void job(); },
            onLiveChange: async (_s: unknown, change: Change) => { loads.push(change); },
        }) as Ui;
        const s = { researchId: 'r1', ended: false };
        ui.liveChangeOrHold(s, { head: 'h1', what: ['a'], at: '2026-11-21T10:00:01Z' });
        ui.liveChangeOrHold(s, { head: 'h2', what: ['b'], at: '2026-11-21T10:00:02Z' });
        expect(loads).toEqual([]);
        holds = false;
        ui.liveReleaseHeld();
        expect(loads).toHaveLength(1);
        expect(loads[0].head).toBe('h2');
        // Nothing held any more: a second release reads nothing.
        ui.liveReleaseHeld();
        expect(loads).toHaveLength(1);
        // An older bridge (nothing held): each change read as it comes.
        ui.liveChangeOrHold(s, { head: 'h3', what: [], at: '' });
        expect(loads.map(c => c.head)).toEqual(['h2', 'h3']);
    });
});
