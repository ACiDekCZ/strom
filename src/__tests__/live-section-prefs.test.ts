/**
 * Section choices of research following (spec 044): one record for the
 * panel and the overview, taken over once from the old fold records; which
 * waiting items are new and which are important.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    OLD_OVERVIEW_KEY, OLD_PANEL_KEY, SECTION_PREFS_KEY, WAITING_SEEN_KEY,
    hasSectionPrefs, isImportantWaiting, migratedSectionPrefs, newWaiting, noteWaitingSeen, prefKeyOfOverview,
    resetSectionPrefs, restoreSectionPrefs, sectionPrefs, setSectionPref, waitingSeen,
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
        expect(stored()).toEqual({ v: 1, s: { working: 'collapsed', queue: 'expanded', changes: 'collapsed' } });
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
        expect(stored()).toEqual({ v: 1, s: {} });
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
        expect(stored()).toEqual({ v: 1, s: {} });
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
        expect(before).toEqual({ waiting: 'collapsed', queue: 'hidden' });
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
