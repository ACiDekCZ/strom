import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    requestPersistentStorage, resetPersistenceRequestForTests, getPersistenceState,
    getRequestedPersistenceState, settledPersistenceState,
} from '../persistence.js';

function stubStorage(storage: unknown): void {
    vi.stubGlobal('navigator', { storage });
}

describe('requestPersistentStorage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        resetPersistenceRequestForTests();
    });

    it('asks the browser once per page load and remembers the outcome', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
        expect(getRequestedPersistenceState()).toBeNull();
        expect(await requestPersistentStorage()).toBe('persistent');
        expect(await requestPersistentStorage()).toBeNull();
        expect(persist).toHaveBeenCalledTimes(1);
        expect(getRequestedPersistenceState()).toBe('persistent');
    });

    it('does not ask again when storage is already persistent', async () => {
        const persist = vi.fn();
        stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
        expect(await requestPersistentStorage()).toBe('persistent');
        expect(persist).not.toHaveBeenCalled();
    });

    it('a refusal leaves best-effort storage', async () => {
        stubStorage({ persist: vi.fn().mockResolvedValue(false) });
        expect(await requestPersistentStorage()).toBe('best-effort');
    });

    it('never fails when the API is missing or throws', async () => {
        stubStorage(undefined);
        expect(await requestPersistentStorage()).toBe('unsupported');
        resetPersistenceRequestForTests();
        stubStorage({ persisted: vi.fn().mockRejectedValue(new Error('denied')), persist: vi.fn().mockRejectedValue(new Error('x')) });
        expect(await requestPersistentStorage()).toBe('best-effort');
        resetPersistenceRequestForTests();
        stubStorage({ persisted: () => { throw new Error('sync'); }, persist: () => { throw new Error('sync'); } });
        expect(await requestPersistentStorage()).toBe('best-effort');
    });

    it('reads the state without asking', async () => {
        const persist = vi.fn();
        stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
        expect(await getPersistenceState()).toBe('best-effort');
        expect(persist).not.toHaveBeenCalled();
    });
});

describe('settledPersistenceState', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        resetPersistenceRequestForTests();
    });

    it('waits for a request still in flight instead of reporting best-effort', async () => {
        let grant: ((ok: boolean) => void) | null = null;
        stubStorage({
            persisted: vi.fn().mockResolvedValue(false),
            persist: vi.fn(() => new Promise<boolean>(r => { grant = r; })),
        });
        void requestPersistentStorage();
        const settled = settledPersistenceState();
        await vi.waitFor(() => expect(grant).not.toBeNull());
        grant!(true);
        expect(await settled).toBe('persistent');
    });

    it('reads the state when nothing was asked in this load', async () => {
        stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn() });
        expect(await settledPersistenceState()).toBe('best-effort');
    });
});
