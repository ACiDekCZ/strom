import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    requestPersistentStorage, resetPersistenceRequestForTests, getPersistenceState,
    getRequestedPersistenceState, shouldWarnNotPersistent, PERSISTENCE_WARNING_MIN_PERSONS,
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

describe('shouldWarnNotPersistent', () => {
    const big = PERSISTENCE_WARNING_MIN_PERSONS;
    const base = { state: 'best-effort' as const, personCount: big, alreadyShown: false, viewMode: false };

    it('warns once for a big tree the browser may clear', () => {
        expect(shouldWarnNotPersistent(base)).toBe(true);
        expect(shouldWarnNotPersistent({ ...base, state: 'unsupported' })).toBe(true);
        expect(shouldWarnNotPersistent({ ...base, alreadyShown: true })).toBe(false);
    });

    it('stays quiet for persistent storage, small trees and shared copies', () => {
        expect(shouldWarnNotPersistent({ ...base, state: 'persistent' })).toBe(false);
        expect(shouldWarnNotPersistent({ ...base, personCount: big - 1 })).toBe(false);
        expect(shouldWarnNotPersistent({ ...base, viewMode: true })).toBe(false);
    });
});
