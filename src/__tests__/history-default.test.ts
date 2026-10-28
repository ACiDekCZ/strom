/**
 * History in the life timeline on by default (spec 020 K1.3): the setting
 * never chosen is on, a user's own "off" stays; the card shows the layer only
 * when the research has events for the tree or searches for them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { historyCardShows, parseHistoryPayload, HistoryPayload } from '../history.js';
import { SettingsManager } from '../settings.js';

const AT = '2026-10-28T07:00:00Z';

function payload(raw: Record<string, unknown>): HistoryPayload {
    const p = parseHistoryPayload({ state: { on: true, search: 'done', at: AT }, lang: 'cs', events: [], places: {}, hidden: [], ...raw }, AT);
    if (!p) throw new Error('payload');
    return p;
}

const war = {
    id: 'E1', from: 1866, kind: 'war', scope: 'region',
    text: { cs: 'Válka', en: 'War' },
    source: { title: 'Titul', url: 'https://example.org/war', checked: '2026-10-27' },
};

/** SettingsManager over a stored settings object (its constructor default, then `load`). */
function loadSettings(stored: Record<string, unknown> | null): void {
    const store = new Map<string, string>();
    if (stored) store.set('strom-settings', JSON.stringify(stored));
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    });
    const sm = SettingsManager as unknown as { settings: Record<string, unknown>; load(): void };
    sm.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
    sm.load();
}

describe('history layer setting', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is on for a new install', () => {
        loadSettings(null);
        expect(SettingsManager.isHistoryLayer()).toBe(true);
    });

    it('is on for a user who never chose it', () => {
        loadSettings({ theme: 'dark', lifelineChildEvents: true });
        expect(SettingsManager.isHistoryLayer()).toBe(true);
    });

    it('stays off when the user switched it off', () => {
        loadSettings(null);
        SettingsManager.setHistoryLayer(false);
        const saved = JSON.parse(localStorage.getItem('strom-settings')!);
        expect(saved.historyLayer).toBe(false);
        loadSettings(saved);
        expect(SettingsManager.isHistoryLayer()).toBe(false);
    });

    it('stays on when the user switched it on', () => {
        loadSettings({ historyLayer: true });
        expect(SettingsManager.isHistoryLayer()).toBe(true);
    });
});

describe('historyCardShows', () => {
    it('shows with events, whatever the search', () => {
        const p = payload({ state: { on: false, search: 'none' }, events: [war], places: { Lhota: { events: ['E1'] } } });
        expect(historyCardShows(p)).toBe(true);
        expect(historyCardShows(p, { searchOn: false })).toBe(true);
        expect(historyCardShows(p, { treeState: 'archive' })).toBe(true);
    });

    it('shows without events while the research searches', () => {
        expect(historyCardShows(payload({ state: { on: true, search: 'running' } }))).toBe(true);
        expect(historyCardShows(payload({ state: { on: false, search: 'none' } }), { searchOn: true })).toBe(true);
        expect(historyCardShows(null, { searchOn: true })).toBe(true);
    });

    it('stays silent without events and without a search', () => {
        expect(historyCardShows(payload({ state: { on: false, search: 'none' } }))).toBe(false);
        expect(historyCardShows(payload({ state: { on: true, search: 'done' } }), { searchOn: false })).toBe(false);
        expect(historyCardShows(null)).toBe(false);
        expect(historyCardShows(null, { searchOn: false })).toBe(false);
    });

    it('stays silent without events while the research waits (archive, its agent)', () => {
        expect(historyCardShows(payload({ state: { on: true, search: 'waiting' } }))).toBe(false);
        expect(historyCardShows(payload({ state: { on: true, search: 'done' } }), { treeState: 'archive', searchOn: true })).toBe(false);
    });
});
