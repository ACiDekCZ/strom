import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    chooseStartView, parseLastViews, recordLastView, readLastView, forgetLastView, LAST_VIEW_STORAGE_KEY,
    parseReloadPoint, recordReloadPoint, peekReloadPoint, takeReloadPoint, isReloadNavigation,
    resetReloadPointForTests, RELOAD_STORAGE_KEY, startedAgainAsMain,
} from '../resume-view';
import { migrateData } from '../data';

/** Which view a tree opens in, and what a reload keeps (1101). */

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

describe('the view a tree load opens', () => {
    it('is the family view unless the tree asks for the last used one and there is one', () => {
        expect(chooseStartView(undefined, null)).toBe('family');
        expect(chooseStartView(undefined, 'fan')).toBe('family');
        expect(chooseStartView('last', null)).toBe('family');
        expect(chooseStartView('last', 'fan')).toBe('fan');
        expect(chooseStartView('last', 'map')).toBe('map');
        expect(chooseStartView('last', 'poster' as never)).toBe('family');
        expect(chooseStartView('fan', 'fan')).toBe('family');
    });
});

describe('last used views', () => {
    it('keeps one view per tree and forgets a deleted tree', () => {
        expect(readLastView('t_a')).toBeNull();
        recordLastView('t_a', 'fan');
        recordLastView('t_b', 'timeline');
        expect(readLastView('t_a')).toBe('fan');
        expect(readLastView('t_b')).toBe('timeline');
        recordLastView('t_a', 'map');
        expect(readLastView('t_a')).toBe('map');
        forgetLastView('t_a');
        expect(readLastView('t_a')).toBeNull();
        expect(JSON.parse(store.get(LAST_VIEW_STORAGE_KEY)!)).toEqual({ t_b: 'timeline' });
    });

    it('drops what is malformed and survives storage that throws', () => {
        expect(parseLastViews('not json')).toEqual({});
        expect(parseLastViews('[1]')).toEqual({});
        expect(parseLastViews(JSON.stringify({ a: 'poster', b: 7, c: 'descendants' }))).toEqual({ c: 'descendants' });
        store.set(LAST_VIEW_STORAGE_KEY, '{');
        expect(readLastView('a')).toBeNull();
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
        expect(() => recordLastView('a', 'fan')).not.toThrow();
        expect(() => forgetLastView('a')).not.toThrow();
        expect(readLastView('a')).toBeNull();
    });
});

describe('the tree\'s default view in its data', () => {
    it('a load keeps "last", and nothing else', () => {
        expect(migrateData({ persons: {}, partnerships: {}, defaultView: 'last' }).defaultView).toBe('last');
        expect('defaultView' in migrateData({ persons: {}, partnerships: {}, defaultView: 'fan' })).toBe(false);
        expect('defaultView' in migrateData({ persons: {}, partnerships: {} })).toBe(false);
    });
});

describe('reload point (1101)', () => {
    let session: Map<string, string>;
    const navigation = (type: string | null) => vi.stubGlobal('performance', {
        getEntriesByType: (t: string) => (t === 'navigation' && type ? [{ type }] : []),
    });
    beforeEach(() => {
        session = new Map();
        vi.stubGlobal('sessionStorage', {
            getItem: (k: string) => session.get(k) ?? null,
            setItem: (k: string, v: string) => { session.set(k, v); },
            removeItem: (k: string) => { session.delete(k); },
        });
        resetReloadPointForTests();
    });

    it('parses a point and drops what is malformed', () => {
        expect(parseReloadPoint(null)).toBeNull();
        expect(parseReloadPoint('{')).toBeNull();
        expect(parseReloadPoint(JSON.stringify({ tree: 't', person: 'p', view: 'poster' }))).toBeNull();
        expect(parseReloadPoint(JSON.stringify({ tree: '', person: 'p', view: 'fan' }))).toBeNull();
        expect(parseReloadPoint(JSON.stringify({ tree: 't', person: 'p', view: 'map', up: 2, down: 'x' })))
            .toEqual({ tree: 't', person: 'p', view: 'map', up: 2 });
    });

    it('counts only for a reload, and only once', () => {
        recordReloadPoint({ tree: 't_a', person: 'p_1', view: 'fan', up: 3, down: 1 });
        expect(JSON.parse(session.get(RELOAD_STORAGE_KEY)!)).toEqual({ tree: 't_a', person: 'p_1', view: 'fan', up: 3, down: 1 });

        // A new start (an address opened again, a link) keeps nothing.
        navigation('navigate');
        expect(isReloadNavigation()).toBe(false);
        expect(peekReloadPoint()).toBeNull();
        expect(takeReloadPoint()).toBeNull();

        resetReloadPointForTests();
        navigation('reload');
        expect(isReloadNavigation()).toBe(true);
        expect(peekReloadPoint()).toEqual({ tree: 't_a', person: 'p_1', view: 'fan', up: 3, down: 1 });
        expect(takeReloadPoint()).toEqual({ tree: 't_a', person: 'p_1', view: 'fan', up: 3, down: 1 });
        // A later tree load (a switch) follows the settings.
        expect(peekReloadPoint()).toBeNull();
        expect(takeReloadPoint()).toBeNull();
    });

    it('a window starting again as the main one (spec 079 §3.3) uses it whatever the navigation says, once', () => {
        recordReloadPoint({ tree: 't_a', person: 'p_1', view: 'table' });
        navigation(null);
        expect(peekReloadPoint()).toBeNull();
        startedAgainAsMain();
        expect(takeReloadPoint()).toEqual({ tree: 't_a', person: 'p_1', view: 'table' });
        expect(takeReloadPoint()).toBeNull();
    });

    it('survives storage and timing that throw', () => {
        vi.stubGlobal('performance', { getEntriesByType: () => { throw new Error('no'); } });
        expect(isReloadNavigation()).toBe(false);
        navigation('reload');
        vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
        expect(() => recordReloadPoint({ tree: 't', person: 'p', view: 'family' })).not.toThrow();
        expect(takeReloadPoint()).toBeNull();
    });
});
