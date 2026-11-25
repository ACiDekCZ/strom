/**
 * The dock of a phone's Research screen (spec 094 K3.13 §6): what the queue's strip says by how the batches stand
 * (sending, waiting for the connection, failed, done for 5 s, none), and the person search of a batch sent from the
 * screen (asked after a pause in typing, at most 8, without the connection only the tree held here when it is loaded).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setLanguage, strings } from '../strings';
import { QUEUE_DONE_MS, phoneQueueStrip, phoneQueueStripHtml, type BatchQueueInfo } from '../ui/phone-research-ui';
import {
    PERSON_SEARCH_DEBOUNCE_MS, PERSON_SEARCH_MAX, createPersonSearch, personHitSub, type PersonSearchResult,
} from '../ui/phone-person-search';
import type { DevicePersonHit } from '../device/device-research-data';

const NOW = Date.parse('2026-11-25T14:40:00Z');
const R = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';

function going(o: Partial<NonNullable<BatchQueueInfo['run']>> = {}): BatchQueueInfo {
    return { run: { researchId: R, total: 6, sent: 1, failed: 0, share: 0.25, finished: false, paused: false, lost: false, ...o }, ended: null };
}

beforeAll(() => setLanguage('en'));

describe('the queue strip', () => {
    it('a batch on its way: "n photos · sending a of b" with its share', () => {
        const strip = phoneQueueStrip(going(), 0, NOW);
        expect(strip).toEqual({ kind: 'sending', n: 6, a: 2, b: 6, share: 0.25 });
        const html = phoneQueueStripHtml(strip!);
        expect(html).toContain('<b>6 photos</b> · sending 2 of 6');
        expect(html).toContain('width:25%');
    });

    it('the connection lost while sending: what is left waits for it', () => {
        expect(phoneQueueStrip(going({ paused: true, lost: true }), 0, NOW)).toEqual({ kind: 'offline', n: 5 });
    });

    it('photos handed over that wait on this device: waiting for the connection', () => {
        const strip = phoneQueueStrip({ run: null, ended: null }, 3, NOW);
        expect(strip).toEqual({ kind: 'offline', n: 3 });
        expect(phoneQueueStripHtml(strip!)).toContain(strings.deviceResearch.queueOffline(3).split(' · ')[1]);
    });

    it('failed photos: "n not sent" and Try again', () => {
        const ended = going({ finished: true, sent: 5, failed: 1 });
        const strip = phoneQueueStrip(ended, 0, NOW);
        expect(strip).toEqual({ kind: 'failed', n: 1 });
        const html = phoneQueueStripHtml(strip!);
        expect(html).toContain(strings.deviceResearch.queueFailed(1));
        expect(html).toContain(strings.batch.retry);
        // Its window closed: the batch that ended says the same.
        expect(phoneQueueStrip({ run: null, ended: { researchId: R, at: NOW - 60_000, k: 5, n: 6, failed: 1 } }, 0, NOW)).toEqual({ kind: 'failed', n: 1 });
    });

    it('a batch that reached the research: "k of n" for 5 seconds, then no strip', () => {
        const info: BatchQueueInfo = { run: null, ended: { researchId: R, at: NOW - 1000, k: 6, n: 6, failed: 0 } };
        const strip = phoneQueueStrip(info, 0, NOW);
        expect(strip).toEqual({ kind: 'done', k: 6, n: 6 });
        expect(phoneQueueStripHtml(strip!)).toContain(strings.batch.doneDevice(6, 6));
        expect(phoneQueueStrip(info, 0, NOW - 1000 + QUEUE_DONE_MS)).toBeNull();
    });

    it('nothing sent and nothing waiting: no strip', () => {
        expect(phoneQueueStrip({ run: null, ended: null }, 0, NOW)).toBeNull();
    });
});

describe('the person search of the Research screen', () => {
    const hit = (i: number): DevicePersonHit => ({ id: `P${String(i).padStart(4, '0')}`, name: `Person ${i}`, span: '1861–1934', place: 'Mlýnky' });

    afterEach(() => vi.useRealTimers());

    it('a hit\'s second line: years · place', () => {
        expect(personHitSub({ span: '1861–1934', place: 'Mlýnky' })).toBe('1861–1934 · Mlýnky');
        expect(personHitSub({ place: 'Mlýnky' })).toBe('Mlýnky');
        expect(personHitSub({})).toBe('');
    });

    it('asks the research only after a pause in typing, the last query, at most 8 people', async () => {
        vi.useFakeTimers();
        const search = vi.fn(async (_t: string, q: string) => Array.from({ length: 12 }, (_, i) => ({ ...hit(i), name: `${q} ${i}` })));
        const results: PersonSearchResult[] = [];
        const s = createPersonSearch({ treeId: R, search, onResult: r => results.push(r) });
        s.ask('Pý');
        await vi.advanceTimersByTimeAsync(PERSON_SEARCH_DEBOUNCE_MS - 50);
        s.ask('Pých');
        await vi.advanceTimersByTimeAsync(PERSON_SEARCH_DEBOUNCE_MS - 1);
        expect(search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][1]).toBe('Pých');
        expect(results).toHaveLength(1);
        expect(results[0].from).toBe('bridge');
        expect(results[0].hits).toHaveLength(PERSON_SEARCH_MAX);
    });

    it('a query too short asks nothing and empties the list', async () => {
        vi.useFakeTimers();
        const search = vi.fn(async () => [hit(1)]);
        const results: PersonSearchResult[] = [];
        createPersonSearch({ treeId: R, search, onResult: r => results.push(r) }).ask('P');
        await vi.advanceTimersByTimeAsync(PERSON_SEARCH_DEBOUNCE_MS * 2);
        expect(search).not.toHaveBeenCalled();
        expect(results).toEqual([{ query: 'P', hits: [], from: 'bridge' }]);
    });

    it('without the connection and no tree loaded here: nothing searched (the tree is not downloaded for it)', async () => {
        vi.useFakeTimers();
        const local = vi.fn(() => null);
        const results: PersonSearchResult[] = [];
        const s = createPersonSearch({ treeId: R, search: async () => { throw new Error('offline'); }, local, onResult: r => results.push(r) });
        s.ask('Pých');
        await vi.advanceTimersByTimeAsync(PERSON_SEARCH_DEBOUNCE_MS);
        expect(local).toHaveBeenCalledWith('Pých');
        expect(results).toEqual([{ query: 'Pých', hits: [], from: 'none' }]);
    });

    it('without the connection, the tree held here loaded: searched in it', async () => {
        vi.useFakeTimers();
        const results: PersonSearchResult[] = [];
        const held = Array.from({ length: 10 }, (_, i) => hit(i));
        const s = createPersonSearch({ treeId: R, search: async () => { throw new Error('offline'); }, local: () => held, onResult: r => results.push(r) });
        s.ask('Pých');
        await vi.advanceTimersByTimeAsync(PERSON_SEARCH_DEBOUNCE_MS);
        expect(results[0].from).toBe('held');
        expect(results[0].hits).toHaveLength(PERSON_SEARCH_MAX);
    });
});
