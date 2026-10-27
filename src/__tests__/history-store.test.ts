/**
 * The device's copy of the research's events of the time and the hide queue
 * (spec 020) name the tree's places and REFNs: with encryption on they are
 * kept encrypted with the session (like the research's version of the tree),
 * not read while it is locked, and re-encoded with the other side stores.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageManager } from '../storage.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession, isEncrypted } from '../crypto.js';
import { reencodeAllBaselines } from '../share-baselines.js';
import { loadHistoryCache, saveHistoryCache, loadHideQueue, saveHideQueue, deleteHistoryStore } from '../history-store.js';
import { parseHistoryPayload, type HistoryHideOp } from '../history.js';

const RID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
let stores: Map<string, Map<string, unknown>>;
const st = (name: string): Map<string, unknown> => {
    let s = stores.get(name);
    if (!s) { s = new Map(); stores.set(name, s); }
    return s;
};

const payload = parseHistoryPayload({
    state: { on: true, search: 'done', at: '2026-10-27T10:00:00Z' },
    events: [{ id: 'E1', from: 1866, kind: 'war', scope: 'region', text: { cs: 'Prusko-rakouská válka v Lhotě' },
        source: { title: 'Encyklopedie', url: 'https://example.org/w', checked: '2026-10-01' } }],
    places: { 'Lhota u Kolína': { events: ['E1'] } },
    hidden: [],
}, '2026-10-27T10:00:00Z')!;
const queue: HistoryHideOp[] = [{ event: 'E1', personId: 'p1', personRefn: 'P0003', at: '2026-10-27T10:01:00Z' }];

beforeEach(() => {
    stores = new Map();
    vi.spyOn(StorageManager, 'set').mockImplementation(async (s, k, v) => { st(s).set(k as string, v); });
    vi.spyOn(StorageManager, 'get').mockImplementation(async (s, k) => st(s).get(k as string) as never);
    vi.spyOn(StorageManager, 'delete').mockImplementation(async (s, k) => { st(s).delete(k as string); });
    vi.spyOn(StorageManager, 'getAll').mockImplementation(async (s) => [...st(s).values()] as never);
});

afterEach(() => {
    CryptoSession.lock();
    vi.restoreAllMocks();
});

describe('history store', () => {
    it('keeps the cache and the queue in plain form without encryption', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
        await saveHistoryCache(RID, payload);
        await saveHideQueue(RID, queue);
        expect(JSON.stringify([...st('shareBaselines').values()])).toContain('Lhota u Kolína');
        expect((await loadHistoryCache(RID))?.events[0].id).toBe('E1');
        expect(await loadHideQueue(RID)).toEqual(queue);
    });

    it('encrypts both with the session when encryption is on, and reads nothing while locked', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('history-password-1');
        const salt = CryptoSession.getSalt()!;
        await saveHistoryCache(RID, payload);
        await saveHideQueue(RID, queue);
        const raw = JSON.stringify([...st('shareBaselines').values()]);
        expect(raw).not.toContain('Lhota');
        expect(raw).not.toContain('P0003');
        for (const rec of st('shareBaselines').values()) expect(isEncrypted((rec as { encrypted?: unknown }).encrypted)).toBe(true);
        expect((await loadHistoryCache(RID))?.places['Lhota u Kolína'].events).toEqual(['E1']);
        expect(await loadHideQueue(RID)).toEqual(queue);

        CryptoSession.lock();
        expect(await loadHistoryCache(RID)).toBeNull();
        expect(await loadHideQueue(RID)).toEqual([]);
        // Locked: nothing kept (no plain copy written instead).
        await saveHistoryCache('other', payload);
        expect(st('shareBaselines').has('history:other')).toBe(false);

        await CryptoSession.unlock('history-password-1', salt);
        expect((await loadHistoryCache(RID))?.events.length).toBe(1);
    });

    it('is re-encoded when encryption is switched off', async () => {
        const enc = vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('history-password-2');
        await saveHistoryCache(RID, payload);
        enc.mockReturnValue(false);
        expect(await reencodeAllBaselines()).toBe(0);
        CryptoSession.lock();
        expect(JSON.stringify([...st('shareBaselines').values()])).toContain('Lhota u Kolína');
        expect((await loadHistoryCache(RID))?.events[0].id).toBe('E1');
    });

    it('an empty queue is removed; deleting forgets both (and an early beta\'s plain records)', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
        await saveHistoryCache(RID, payload);
        await saveHideQueue(RID, queue);
        await saveHideQueue(RID, []);
        expect(await loadHideQueue(RID)).toEqual([]);
        st('trees').set(`history:${RID}`, payload);
        await deleteHistoryStore(RID);
        expect(await loadHistoryCache(RID)).toBeNull();
        expect(st('shareBaselines').size).toBe(0);
        expect(st('trees').size).toBe(0);
    });
});
