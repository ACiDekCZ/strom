/**
 * Section choices of research following (spec 044, 057): one record for the
 * panel and the overview, taken over once from the old fold records; the
 * record v2 with the order and the top (the cost hidden by default); which
 * waiting items are new and which are important.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    OLD_OVERVIEW_KEY, OLD_PANEL_KEY, SECTION_PREFS_KEY, WAITING_SEEN_KEY,
    DEFAULT_ORDER, TOP_DEFAULTS, autoFoldOrder, completeOrder, hasSectionPrefs, isImportantWaiting, migratedSectionPrefs, moveSection,
    movedOrder, newWaiting, panelSectionOrder, noteWaitingSeen, prefKeyOfOverview, resetSectionPrefs, restoreSectionPrefs, sectionOrder,
    sectionPrefs, sectionPrefsSnapshot, setSectionOrder, setSectionPref, setTopPref, setTopTile, topAfterTile, topPrefs,
    topTileShown, waitingSeen,
} from '../ui/live-section-prefs.js';
import type { LiveWaiting } from '../research-link.js';

let store: Map<string, string>;
let sets: number;

beforeEach(() => {
    store = new Map();
    sets = 0;
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { sets++; store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const stored = (): unknown => JSON.parse(store.get(SECTION_PREFS_KEY) ?? 'null');

describe('migration from the old fold records', () => {
    it('(a) only the panel record: its choices, true = collapsed, false = expanded', () => {
        store.set(OLD_PANEL_KEY, JSON.stringify({ working: true, queue: false, changes: true }));
        expect(sectionPrefs()).toEqual({ working: 'collapsed', queue: 'expanded', changes: 'collapsed' });
        expect(stored()).toEqual({ v: 2, s: { working: 'collapsed', queue: 'expanded', changes: 'collapsed' } });
    });

    it('(b) only the overview record: now → working, timeline → changes', () => {
        store.set(OLD_OVERVIEW_KEY, JSON.stringify({ now: true, timeline: false, queue: false, knows: true, directions: true }));
        expect(sectionPrefs()).toEqual({ working: 'collapsed', changes: 'expanded', queue: 'expanded', knows: 'collapsed', directions: 'collapsed' });
    });

    it('(c) both disagree: the panel wins', () => {
        store.set(OLD_PANEL_KEY, JSON.stringify({ working: false, queue: true }));
        store.set(OLD_OVERVIEW_KEY, JSON.stringify({ now: true, queue: false, knows: false }));
        expect(sectionPrefs()).toEqual({ working: 'expanded', queue: 'collapsed', knows: 'expanded' });
    });

    it('(d) waiting: false is no choice (written by the app on a new item); waiting: true is', () => {
        store.set(OLD_PANEL_KEY, JSON.stringify({ waiting: false }));
        store.set(OLD_OVERVIEW_KEY, JSON.stringify({ waiting: false }));
        expect(sectionPrefs()).toEqual({});
        expect(stored()).toEqual({ v: 2, s: {} });
        expect(migratedSectionPrefs({ waiting: true }, {})).toEqual({ waiting: 'collapsed' });
        // The overview folded it, the panel's false is no choice: the overview's choice stays.
        expect(migratedSectionPrefs({ waiting: false }, { waiting: true })).toEqual({ waiting: 'collapsed' });
    });

    it('(e) the new record there: the old ones are not read again (nor removed)', () => {
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 1, s: { queue: 'hidden' } }));
        store.set(OLD_PANEL_KEY, JSON.stringify({ queue: false, working: true }));
        expect(sectionPrefs()).toEqual({ queue: 'hidden' });
        expect(store.get(OLD_PANEL_KEY)).toBe(JSON.stringify({ queue: false, working: true }));
    });

    it('runs once: an empty record is written, the old ones stay untouched', () => {
        store.set(OLD_PANEL_KEY, JSON.stringify({ working: true }));
        sectionPrefs();
        const writes = sets;
        store.set(OLD_PANEL_KEY, JSON.stringify({ working: false }));
        expect(sectionPrefs()).toEqual({ working: 'collapsed' });
        expect(sets).toBe(writes);
        expect(store.has(OLD_PANEL_KEY)).toBe(true);
    });

    it('nothing old: an empty record', () => {
        expect(sectionPrefs()).toEqual({});
        expect(stored()).toEqual({ v: 2, s: {} });
    });

    it('unknown sections and values of the old records are dropped', () => {
        store.set(OLD_PANEL_KEY, JSON.stringify({ working: 'yes', foo: true, queue: true }));
        store.set(OLD_OVERVIEW_KEY, '{broken');
        expect(sectionPrefs()).toEqual({ queue: 'collapsed' });
    });
});

describe('reading and writing', () => {
    it('unknown keys and values are dropped on reading', () => {
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 1, s: { queue: 'hidden', waiting: 'open', foo: 'hidden', knows: 'expanded' } }));
        expect(sectionPrefs()).toEqual({ queue: 'hidden', knows: 'expanded' });
    });

    it('a broken record reads as no choices', () => {
        store.set(SECTION_PREFS_KEY, 'not json');
        expect(sectionPrefs()).toEqual({});
    });

    it('set, reset (returns the choices before) and restore (Undo); each announces itself', () => {
        const seen: string[] = [];
        vi.stubGlobal('document', { dispatchEvent: (e: Event) => { seen.push(e.type); return true; } });
        vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
        setSectionPref('waiting', 'collapsed');
        setSectionPref('queue', 'hidden');
        expect(sectionPrefs()).toEqual({ waiting: 'collapsed', queue: 'hidden' });
        expect(hasSectionPrefs()).toBe(true);
        const before = resetSectionPrefs();
        expect(before).toEqual({ s: { waiting: 'collapsed', queue: 'hidden' } });
        expect(sectionPrefs()).toEqual({});
        expect(hasSectionPrefs()).toBe(false);
        restoreSectionPrefs(before);
        expect(sectionPrefs()).toEqual({ waiting: 'collapsed', queue: 'hidden' });
        expect(seen).toEqual(['strom:live-section-prefs', 'strom:live-section-prefs', 'strom:live-section-prefs', 'strom:live-section-prefs']);
        // The same value again: nothing written, nothing announced.
        setSectionPref('queue', 'hidden');
        expect(seen).toHaveLength(4);
    });

    it('reset leaves the seen waiting items alone', () => {
        noteWaitingSeen('tree-1', ['T1']);
        resetSectionPrefs();
        expect(waitingSeen('tree-1')).toEqual(new Set(['T1']));
    });

    it('overview keys map onto the choices', () => {
        expect(prefKeyOfOverview('now')).toBe('working');
        expect(prefKeyOfOverview('timeline')).toBe('changes');
        expect(prefKeyOfOverview('queue')).toBe('queue');
        expect(prefKeyOfOverview('working')).toBeNull();
    });
});

describe('record v2: the order and the top', () => {
    const announced = (): string[] => {
        const seen: string[] = [];
        vi.stubGlobal('document', { dispatchEvent: (e: Event) => { seen.push(e.type); return true; } });
        vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
        return seen;
    };

    it('a v1 record: its choices unchanged, the default order, the cost hidden', () => {
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 1, s: { queue: 'hidden', working: 'collapsed' } }));
        expect(sectionPrefs()).toEqual({ queue: 'hidden', working: 'collapsed' });
        expect(sectionOrder()).toEqual([...DEFAULT_ORDER]);
        expect(topPrefs()['month.price']).toBe(false);
        expect(topPrefs()).toEqual(TOP_DEFAULTS);
        // Reading writes nothing (the record stays v1 until a change).
        expect(stored()).toEqual({ v: 1, s: { queue: 'hidden', working: 'collapsed' } });
    });

    it('no record at all: everything but the cost shows', () => {
        expect(topPrefs()).toEqual({ 'day.persons': true, 'day.sources': true, 'month.sessions': true, 'month.price': false, followIn: true });
        expect(hasSectionPrefs()).toBe(false);
    });

    it('each write keeps the fields it does not change (a v1 record becomes v2)', () => {
        announced();
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 1, s: { queue: 'hidden' } }));
        setTopPref('month.price', true);
        expect(stored()).toEqual({ v: 2, s: { queue: 'hidden' }, t: { 'month.price': true } });
        setSectionOrder(['queue', 'working', 'waiting', 'directions', 'changes', 'knows']);
        setSectionPref('waiting', 'collapsed');
        expect(stored()).toEqual({
            v: 2, s: { queue: 'hidden', waiting: 'collapsed' },
            o: ['queue', 'working', 'waiting', 'directions', 'changes', 'knows'], t: { 'month.price': true },
        });
        setTopPref('followIn', false);
        expect(stored()).toEqual({
            v: 2, s: { queue: 'hidden', waiting: 'collapsed' },
            o: ['queue', 'working', 'waiting', 'directions', 'changes', 'knows'], t: { 'month.price': true, followIn: false },
        });
        // A part switched back to its default is no choice.
        setTopPref('month.price', false);
        setTopPref('followIn', true);
        expect((stored() as { t?: unknown }).t).toBeUndefined();
        expect(hasSectionPrefs()).toBe(true);
    });

    it('an order or a top choice alone counts as a choice (Restore defaults has something to do)', () => {
        announced();
        setSectionOrder(['waiting', 'working']);
        expect(sectionPrefs()).toEqual({});
        expect(hasSectionPrefs()).toBe(true);
        resetSectionPrefs();
        setTopPref('day.sources', false);
        expect(hasSectionPrefs()).toBe(true);
    });

    it('reset: everything back (the cost hidden again), the record before returned; restore puts it all back', () => {
        const seen = announced();
        setSectionPref('queue', 'hidden');
        moveSection('waiting', -1, 'overview');
        setTopPref('month.price', true);
        setTopPref('followIn', false);
        const full = sectionPrefsSnapshot();
        const before = resetSectionPrefs();
        expect(before).toEqual(full);
        expect(before).toEqual({ s: { queue: 'hidden' }, o: ['waiting', 'working', 'directions', 'changes', 'queue', 'knows'], t: { 'month.price': true, followIn: false } });
        expect(stored()).toEqual({ v: 2, s: {} });
        expect(topPrefs()['month.price']).toBe(false);
        expect(sectionOrder()).toEqual([...DEFAULT_ORDER]);
        expect(hasSectionPrefs()).toBe(false);
        restoreSectionPrefs(before);
        expect(sectionPrefsSnapshot()).toEqual(full);
        expect(seen.every(t => t === 'strom:live-section-prefs')).toBe(true);
        expect(seen).toHaveLength(6);
    });

    it('sectionOrder: unknown keys and repeats dropped, missing ones put in after their nearest one before', () => {
        expect(completeOrder(undefined)).toEqual([...DEFAULT_ORDER]);
        // 'knows' after 'queue', 'waiting' after 'working', 'directions' after 'waiting', 'changes' after 'directions'.
        expect(completeOrder(['queue', 'foo', 'queue', 'working'])).toEqual(['queue', 'knows', 'working', 'waiting', 'directions', 'changes']);
        // 'changes' after 'directions' (its nearest one before in the default), 'knows' after 'queue'.
        expect(completeOrder(['knows', 'queue', 'directions', 'waiting', 'working'])).toEqual(['knows', 'queue', 'directions', 'changes', 'waiting', 'working']);
        // 'working' has none before it: first.
        expect(completeOrder(['knows', 'waiting'])).toEqual(['working', 'knows', 'waiting', 'directions', 'changes', 'queue']);
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 2, s: {}, o: ['knows', 'nope', 'knows', 7, 'working'] }));
        expect(sectionOrder()).toEqual(['knows', 'working', 'waiting', 'directions', 'changes', 'queue']);
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 2, s: {}, o: 'queue' }));
        expect(sectionOrder()).toEqual([...DEFAULT_ORDER]);
    });

    it('the default order is kept as no order', () => {
        announced();
        setSectionOrder(['waiting', 'working', 'directions', 'changes', 'queue', 'knows']);
        expect((stored() as { o?: unknown }).o).toEqual(['waiting', 'working', 'directions', 'changes', 'queue', 'knows']);
        setSectionOrder([...DEFAULT_ORDER]);
        expect((stored() as { o?: unknown }).o).toBeUndefined();
        moveSection('queue', -1, 'overview');
        moveSection('queue', 1, 'overview');
        expect((stored() as { o?: unknown }).o).toBeUndefined();
    });

    it('moveSection: the panel skips the two the overview alone has; the overview and Settings move among all', () => {
        const d = [...DEFAULT_ORDER];
        // Panel: Changes up swaps with Awaiting action (Directions stays where it is).
        expect(movedOrder(d, 'changes', -1, 'panel')).toEqual(['working', 'changes', 'directions', 'waiting', 'queue', 'knows']);
        // Overview: Changes up swaps with Directions.
        expect(movedOrder(d, 'changes', -1, 'overview')).toEqual(['working', 'waiting', 'changes', 'directions', 'queue', 'knows']);
        expect(movedOrder(d, 'changes', -1, 'settings')).toEqual(['working', 'waiting', 'changes', 'directions', 'queue', 'knows']);
        // Panel: Awaiting action down swaps with Changes, over Directions.
        expect(movedOrder(d, 'waiting', 1, 'panel')).toEqual(['working', 'changes', 'directions', 'waiting', 'queue', 'knows']);
        // Two places in the panel.
        expect(movedOrder(d, 'queue', -2, 'panel')).toEqual(['working', 'queue', 'directions', 'waiting', 'changes', 'knows']);
        // Past either end: unchanged; a key the panel does not have: unchanged there.
        expect(movedOrder(d, 'working', -1, 'panel')).toEqual(d);
        expect(movedOrder(d, 'queue', 1, 'panel')).toEqual(d);
        expect(movedOrder(d, 'knows', 1, 'overview')).toEqual(d);
        expect(movedOrder(d, 'directions', 1, 'panel')).toEqual(d);
        announced();
        moveSection('changes', -1, 'panel');
        expect(sectionOrder()).toEqual(['working', 'changes', 'directions', 'waiting', 'queue', 'knows']);
    });

    it('the panel\'s order and what it folds by itself: the default order folds as before (Up next, Changes, Working)', () => {
        expect(panelSectionOrder([...DEFAULT_ORDER])).toEqual(['working', 'waiting', 'changes', 'queue']);
        expect(autoFoldOrder([...DEFAULT_ORDER])).toEqual(['queue', 'changes', 'working']);
        expect(autoFoldOrder()).toEqual(['queue', 'changes', 'working']);
        // A custom order folds from its own bottom up, never Awaiting action.
        const custom = ['queue', 'knows', 'waiting', 'changes', 'working', 'directions'] as const;
        expect(panelSectionOrder([...custom])).toEqual(['queue', 'waiting', 'changes', 'working']);
        expect(autoFoldOrder([...custom])).toEqual(['working', 'changes', 'queue']);
    });

    it('tiles: shown while a part is; off = both parts off; on with none = the defaults (the cost stays off)', () => {
        expect(topTileShown(TOP_DEFAULTS, 'day')).toBe(true);
        expect(topTileShown(TOP_DEFAULTS, 'month')).toBe(true);
        expect(topTileShown({ ...TOP_DEFAULTS, 'month.sessions': false }, 'month')).toBe(false);
        expect(topTileShown({ ...TOP_DEFAULTS, 'month.sessions': false, 'month.price': true }, 'month')).toBe(true);
        const off = topAfterTile(TOP_DEFAULTS, 'day', false);
        expect([off['day.persons'], off['day.sources']]).toEqual([false, false]);
        const on = topAfterTile(off, 'day', true);
        expect([on['day.persons'], on['day.sources']]).toEqual([true, true]);
        const monthOn = topAfterTile({ ...TOP_DEFAULTS, 'month.sessions': false }, 'month', true);
        expect([monthOn['month.sessions'], monthOn['month.price']]).toEqual([true, false]);
        // On with a part on: unchanged.
        const pricey = { ...TOP_DEFAULTS, 'month.sessions': false, 'month.price': true };
        expect(topAfterTile(pricey, 'month', true)).toEqual(pricey);
        announced();
        setTopTile('month', false);
        expect(topPrefs()['month.sessions']).toBe(false);
        expect(topPrefs()['month.price']).toBe(false);
        setTopTile('month', true);
        expect(topPrefs()['month.sessions']).toBe(true);
        expect(topPrefs()['month.price']).toBe(false);
        expect((stored() as { t?: unknown }).t).toBeUndefined();
    });

    it('unknown top keys and non-boolean values are dropped', () => {
        store.set(SECTION_PREFS_KEY, JSON.stringify({ v: 2, s: {}, t: { 'month.price': 'yes', followIn: false, foo: true } }));
        expect(topPrefs()).toEqual({ ...TOP_DEFAULTS, followIn: false });
    });
});

describe('"Awaiting action": new and important items', () => {
    const w = (id: string, extra: Partial<LiveWaiting> = {}): LiveWaiting => ({ id, what: id, ...extra } as LiveWaiting);

    it('important: a permission, a decision, a place conflict, priority 1; nothing else', () => {
        expect(isImportantWaiting(w('a', { kind: 'permission' }))).toBe(true);
        expect(isImportantWaiting(w('b', { section: 'decide' }))).toBe(true);
        expect(isImportantWaiting(w('c', { kind: 'place', question: 'conflict' }))).toBe(true);
        expect(isImportantWaiting(w('d', { priority: 1 }))).toBe(true);
        expect(isImportantWaiting(w('e', { priority: 2, section: 'letter', kind: 'place', question: 'propose' }))).toBe(false);
        expect(isImportantWaiting(w('f'))).toBe(false);
    });

    it('new = to do and not seen; the seen list is today\'s list (no growth), per tree, kept over a reload', () => {
        expect(waitingSeen('t1')).toBeNull();
        noteWaitingSeen('t1', ['T1', 'T2']);
        noteWaitingSeen('t2', ['X']);
        const todo = [w('T1'), w('T2'), w('T3')];
        expect(newWaiting(todo, waitingSeen('t1')!).map(x => x.id)).toEqual(['T3']);
        // Expanded again with T1 gone: the list follows today's items.
        noteWaitingSeen('t1', ['T2', 'T3']);
        expect(JSON.parse(store.get(WAITING_SEEN_KEY)!)).toEqual({ t1: ['T2', 'T3'], t2: ['X'] });
        expect(newWaiting([w('T2'), w('T3')], waitingSeen('t1')!)).toEqual([]);
    });

    it('an unchanged list is not written again', () => {
        noteWaitingSeen('t1', ['T1', 'T2']);
        const writes = sets;
        noteWaitingSeen('t1', ['T2', 'T1']);
        expect(sets).toBe(writes);
    });
});
