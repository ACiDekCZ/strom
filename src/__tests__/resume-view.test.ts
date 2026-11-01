import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    parseResumeStore, recordResumePoint, readResumePoint, lastResumeTreeId, RESUME_STORAGE_KEY,
} from '../resume-view';

/** Where the work ended, per tree, on this device (1101). */

let store: Map<string, string>;
beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('resume points', () => {
    it('keeps a point per tree and the tree used last', () => {
        expect(lastResumeTreeId()).toBeNull();
        recordResumePoint('t_a', { person: 'p_1', view: 'fan', up: 4, down: 1 });
        recordResumePoint('t_b', { person: 'p_9', view: 'family' });
        expect(lastResumeTreeId()).toBe('t_b');
        expect(readResumePoint('t_a')).toEqual({ person: 'p_1', view: 'fan', up: 4, down: 1 });
        expect(readResumePoint('t_b')).toEqual({ person: 'p_9', view: 'family' });
        expect(readResumePoint('t_c')).toBeNull();
        // Work going on in the first tree again makes it the last one.
        recordResumePoint('t_a', { person: 'p_2', view: 'map' });
        expect(lastResumeTreeId()).toBe('t_a');
        expect(readResumePoint('t_a')).toEqual({ person: 'p_2', view: 'map' });
    });

    it('drops what is malformed and survives storage that throws', () => {
        expect(parseResumeStore('not json')).toEqual({ trees: {} });
        expect(parseResumeStore(JSON.stringify({
            last: 7,
            trees: { a: { person: 'p_1', view: 'poster' }, b: { person: '', view: 'fan' }, c: { person: 'p_3', view: 'timeline', up: 'x' }, d: null },
        }))).toEqual({ trees: { c: { person: 'p_3', view: 'timeline' } } });
        store.set(RESUME_STORAGE_KEY, '{');
        expect(readResumePoint('a')).toBeNull();
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
        expect(() => recordResumePoint('a', { person: 'p_1', view: 'fan' })).not.toThrow();
        expect(lastResumeTreeId()).toBeNull();
    });
});
