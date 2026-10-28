/**
 * The person card's line "the research does not look for history yet"
 * (spec 020 K1.6): when it shows, and that its close button is remembered.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { historyStripShows, parseHistoryPayload, type HistoryPayload, type HistoryStripEnv } from '../history.js';
import { SettingsManager } from '../settings.js';
import { SETTINGS_KEY } from '../types.js';

const AT = '2026-10-28T10:00:00Z';

function payload(raw: Record<string, unknown>): HistoryPayload {
    const p = parseHistoryPayload({ state: { on: false, search: 'none' }, lang: 'cs', events: [], places: {}, hidden: [], ...raw }, AT);
    if (!p) throw new Error('payload');
    return p;
}

const EVENT = {
    id: 'ev1', from: 1914, to: 1918, kind: 'war', scope: 'region',
    region: { id: 'cz-bohemia', name: { cs: 'Čechy', en: 'Bohemia', de: 'Böhmen' } },
    text: { cs: 'Válka', en: 'War', de: 'Krieg' },
    source: { title: 'Titul', publisher: 'Wikipedie', url: 'https://cs.wikipedia.org/wiki/X', checked: '2026-10-27' },
};

const base: HistoryStripEnv = {
    layerOn: true, closed: false, following: false, bridgeHistory: true,
    searchOn: false, offDone: false, canLinkOn: true, payload: null, treeState: 'research',
};

describe('historyStripShows (spec 020 K1.6)', () => {
    it('shows for a tree with its research running and the search off', () => {
        expect(historyStripShows(base)).toBe(true);
        expect(historyStripShows({ ...base, payload: payload({}) })).toBe(true);
    });

    it('nothing with the layer off, closed, or a followed (read-only) tree', () => {
        expect(historyStripShows({ ...base, layerOn: false })).toBe(false);
        expect(historyStripShows({ ...base, closed: true })).toBe(false);
        expect(historyStripShows({ ...base, following: true })).toBe(false);
    });

    it('nothing without the bridge or with an older research that does not say', () => {
        expect(historyStripShows({ ...base, bridgeHistory: false })).toBe(false);
        expect(historyStripShows({ ...base, searchOn: undefined })).toBe(false);
    });

    it('nothing while the research searches or was just switched off from here', () => {
        expect(historyStripShows({ ...base, searchOn: true })).toBe(false);
        expect(historyStripShows({ ...base, offDone: true })).toBe(false);
    });

    it('nothing without the link to switch it on, for an archive or a research waiting for its agent', () => {
        expect(historyStripShows({ ...base, canLinkOn: false })).toBe(false);
        expect(historyStripShows({ ...base, treeState: 'archive' })).toBe(false);
        expect(historyStripShows({ ...base, payload: payload({ state: { on: false, search: 'waiting' } }) })).toBe(false);
    });

    it('nothing when events were found before: the layer itself says the search is off', () => {
        const p = payload({ events: [EVENT] });
        expect(p.events.length).toBe(1);
        expect(historyStripShows({ ...base, payload: p })).toBe(false);
    });
});

describe('the closed line is remembered in this browser', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('setHistoryStripClosed is saved and read back after a reload', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
        expect(SettingsManager.isHistoryStripClosed()).toBe(false);
        SettingsManager.setHistoryStripClosed(true);
        expect(SettingsManager.isHistoryStripClosed()).toBe(true);
        expect(JSON.parse(store.get(SETTINGS_KEY) ?? '{}').historyStripClosed).toBe(true);
        // A new start reads the stored settings.
        (SettingsManager as unknown as { load(): void }).load();
        expect(SettingsManager.isHistoryStripClosed()).toBe(true);
    });
});
