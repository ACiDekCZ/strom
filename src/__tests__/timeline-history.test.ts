/**
 * The history row of the whole Timeline (spec 121 §0, §1): one pass over the
 * persons with a row computes every event of a region where one of them lived
 * in its year, and each person's history of places and findings for their
 * life line; hidings, the origins switched off and the region's name; the
 * options stored per tree; and the time it takes on a large tree.
 * Pure, fictional data (Valdorie, Quellnitz, Zelvar; the Brumla family).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    computeTimelineHistory, parseHistoryPayload, timelineHistoryRegion, type HistoryPayload, type PersonResidence,
} from '../history.js';
import {
    computeTimelineModel, filterTimelineHistory, timelineHistoryRowState, timelineHistoryFacets, timelineFilterKindCount,
    toggleTimelineKind, clearTimelineFilter, timelineLocalOptionState, timelineLocalX, layoutTimelineLocal,
    LOCAL_DENSE_PX_PER_YEAR, type TimelineLocalItem,
} from '../timeline.js';
import { buildTimelineSvg, historyFilterText } from '../timeline-chart.js';
import { setLanguage } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { StromData, PersonId, Person, LifeEvent } from '../types.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

const AT = '2026-11-20T14:05:00Z';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Brumla', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...o,
    } as Person;
}
function data(persons: Person[]): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {} as StromData['partnerships'],
    };
}
const residence = (date: string, place: string, id = `r${date}${place}`): LifeEvent => ({ id, type: 'residence', date, place });

const VALDORIE = { id: 'xx-valdorie', name: { cs: 'Valdorie', en: 'Valdoria' } };
const QUELLNITZ = { id: 'xx-quellnitz', name: { cs: 'Quellnitzko', en: 'Quellnitz Land' } };

function regionEvent(id: string, from: number, o: Record<string, unknown> = {}) {
    return {
        id, from, kind: 'war', scope: 'region', region: VALDORIE,
        text: { cs: `Událost ${id}`, en: `Event ${id}` },
        source: { title: 'Titul', publisher: 'Kronika', url: 'https://example.org/x', checked: '2026-10-27' },
        ...o,
    };
}
function localEvent(id: string, from: number, o: Record<string, unknown> = {}) {
    return {
        id, from, kind: 'epidemic', scope: 'local',
        text: { cs: `Místní ${id}`, en: `Local ${id}` },
        local: { source: 'S0004', clip: 'C0012', cite: 'Matrika zemřelých Zelvar' },
        ...o,
    };
}
function placeEvent(id: string, from: number, o: Record<string, unknown> = {}) {
    return {
        id, from, kind: 'disaster', scope: 'place',
        text: { cs: `Obec ${id}`, en: `Village ${id}` },
        source: { title: 'Kronika obce', url: 'https://example.org/p', checked: '2026-10-27' },
        ...o,
    };
}
function payload(raw: Record<string, unknown>): HistoryPayload {
    const p = parseHistoryPayload({ state: { on: true, search: 'done', at: AT }, lang: 'cs', events: [], places: {}, hidden: [], ...raw }, AT);
    if (!p) throw new Error('payload');
    return p;
}

// Anna: born in Zelvar (region Valdorie) 1840, there still 1866, moved to Quellnitz (region Quellnitz) 1870, died there 1890.
// Bert: Zelvar all his life, 1850–1900. Cyril: Quellnitz, 1872–1920.
const anna = person('anna', {
    refn: 'P0001', gender: 'female', birthDate: '1840', birthPlace: 'Zelvar',
    events: [residence('1866', 'Zelvar'), residence('1870', 'Quellnitz')], deathDate: '1890', deathPlace: 'Quellnitz',
});
const bert = person('bert', { refn: 'P0002', birthDate: '1850', birthPlace: 'Zelvar', deathDate: '1900', deathPlace: 'Zelvar' });
const cyril = person('cyril', { refn: 'P0003', birthDate: '1872', birthPlace: 'Quellnitz', deathDate: '1920', deathPlace: 'Quellnitz' });
const d = data([anna, bert, cyril]);
const ALL = ['anna', 'bert', 'cyril'];

const base = {
    events: [
        regionEvent('V-1820', 1820),                                  // before every life
        regionEvent('V-1866', 1866, { to: 1867 }),                    // Zelvar: Anna and Bert
        regionEvent('V-1870', 1870),                                  // Zelvar in the year Anna left it
        regionEvent('Q-1880', 1880, { region: QUELLNITZ, kind: 'census' }), // Quellnitz: Anna and Cyril
        regionEvent('V-1895', 1895),                                  // Zelvar: Bert only (Anna died 1890)
        localEvent('L-1870', 1870),                                   // Zelvar's register, the year of the move
        placeEvent('P-1870', 1870),                                   // Quellnitz's own history, the same year
        placeEvent('P-1900', 1900, { to: 1902 }),                     // Quellnitz, Cyril
    ],
    places: {
        Zelvar: { events: ['V-1820', 'V-1866', 'V-1870', 'V-1895', 'L-1870'] },
        Quellnitz: { events: ['Q-1880', 'P-1870', 'P-1900'] },
    },
};

describe('computeTimelineHistory: who an event of a region concerns', () => {
    it('a person in the region in its year yes; another region no; outside the life no', () => {
        const r = computeTimelineHistory(d, ALL, payload(base), 'en');
        expect(r.events.map(e => [e.id, e.persons])).toEqual([
            ['V-1866', ['anna', 'bert']],
            ['V-1870', ['anna', 'bert']],
            ['Q-1880', ['anna', 'cyril']],
            ['V-1895', ['bert']],
        ]);
        // Its years, kind, origin and text in the UI language; the region's id for the filter.
        expect(r.events[0]).toMatchObject({ year: 1866, year2: 1867, kind: 'war', scope: 'region', text: 'Event V-1866', regionId: 'xx-valdorie' });
        expect(r.events[2]).toMatchObject({ kind: 'census', regionId: 'xx-quellnitz' });
        // Cyril (Quellnitz only) never gets Valdorie's events; nobody gets one before every life.
        expect(r.events.some(e => e.id === 'V-1820')).toBe(false);
    });

    it('a person who moved in the year gets both places on the life line', () => {
        const r = computeTimelineHistory(d, ALL, payload(base), 'en');
        expect(r.local.get('anna')?.map(e => [e.id, e.scope, e.place, e.year])).toEqual([
            ['L-1870', 'local', 'Zelvar', 1870],
            ['P-1870', 'place', 'Quellnitz', 1870],
        ]);
        expect(r.local.get('anna')![0].source).toBe('Matrika zemřelých Zelvar');
        // Cyril was born after the place's event; its period 1900–1902 is in his life.
        expect(r.local.get('cyril')?.map(e => [e.id, e.year, e.year2])).toEqual([['P-1900', 1900, 1902]]);
        expect(r.local.get('bert')?.map(e => e.id)).toEqual(['L-1870']);
    });

    it('an event that began before the person came is on the line from the first year lived there', () => {
        const late = person('dora', { birthDate: '1866', birthPlace: 'Quellnitz', deathDate: '1910', deathPlace: 'Quellnitz' });
        const r = computeTimelineHistory(data([late]), ['dora'], payload({
            ...base, events: [...base.events, placeEvent('P-1860', 1860, { to: 1870 })],
            places: { ...base.places, Quellnitz: { events: [...base.places.Quellnitz.events, 'P-1860'] } },
        }), 'en');
        expect(r.local.get('dora')?.find(e => e.id === 'P-1860')).toMatchObject({ year: 1866, year2: 1870, moved: true });
    });

    it('persons without a row in the given ids, placeholders and unknown ids are skipped', () => {
        const ghost = person('ghost', { isPlaceholder: true, birthDate: '1850', birthPlace: 'Zelvar' });
        const r = computeTimelineHistory(data([anna, bert, ghost]), ['bert', 'ghost', 'nobody'], payload(base), 'en');
        expect(r.events.map(e => [e.id, e.persons])).toEqual([['V-1866', ['bert']], ['V-1870', ['bert']], ['V-1895', ['bert']]]);
    });

    it('fills the residences given by the caller and reuses them', () => {
        const residences = new Map<string, PersonResidence>();
        const first = computeTimelineHistory(d, ALL, payload(base), 'en', { residences });
        expect([...residences.keys()]).toEqual(ALL);
        const again = computeTimelineHistory(d, ALL, payload(base), 'en', { residences });
        expect(again.events).toEqual(first.events);
    });
});

describe('computeTimelineHistory: hidings and origins', () => {
    it('hidden for a place: not from that place, still from another place it is in', () => {
        const both = { ...base, places: { ...base.places, Quellnitz: { events: [...base.places.Quellnitz.events, 'V-1870'] } } };
        // Anna lived in both places in 1870; hidden for Zelvar she still has it from Quellnitz, Bert does not.
        const r = computeTimelineHistory(d, ALL, payload({ ...both, hidden: [{ event: 'V-1870', place: 'Zelvar' }] }), 'en');
        expect(r.events.find(e => e.id === 'V-1870')?.persons).toEqual(['anna']);
        // Hidden for one person (REFN): the others keep it.
        const one = computeTimelineHistory(d, ALL, payload({ ...base, hidden: [{ event: 'V-1866', person: 'P0002' }] }), 'en');
        expect(one.events.find(e => e.id === 'V-1866')?.persons).toEqual(['anna']);
    });

    it('a whole region hidden: none of its events; the whole tree: the event nowhere', () => {
        const region = computeTimelineHistory(d, ALL, payload({ ...base, hidden: [{ region: 'xx-valdorie' }] }), 'en');
        expect(region.events.map(e => e.id)).toEqual(['Q-1880']);
        // Local and place events are no region's: they stay.
        expect(region.local.get('anna')?.length).toBe(2);
        const tree = computeTimelineHistory(d, ALL, payload({ ...base, hidden: [{ event: 'Q-1880', tree: true }, { event: 'P-1870', tree: true }] }), 'en');
        expect(tree.events.map(e => e.id)).toEqual(['V-1866', 'V-1870', 'V-1895']);
        expect(tree.local.get('anna')?.map(e => e.id)).toEqual(['L-1870']);
        // A hiding queued on this computer counts at once.
        const queued = computeTimelineHistory(d, ALL, payload(base), 'en', { queue: [{ event: 'V-1895', tree: true, at: AT }] });
        expect(queued.events.map(e => e.id)).toEqual(['V-1866', 'V-1870', 'Q-1880']);
    });

    it('an origin switched off in Settings is not computed', () => {
        const noRegion = computeTimelineHistory(d, ALL, payload(base), 'en', { kinds: { region: false, place: true, local: true } });
        expect(noRegion.events).toEqual([]);
        expect(noRegion.local.get('anna')?.map(e => e.id)).toEqual(['L-1870', 'P-1870']);
        const noLocal = computeTimelineHistory(d, ALL, payload(base), 'en', { kinds: { region: true, place: true, local: false } });
        expect(noLocal.events.length).toBe(4);
        expect(noLocal.local.get('anna')?.map(e => e.id)).toEqual(['P-1870']);
        expect(noLocal.local.get('bert')).toBeUndefined();
    });
});

describe('computeTimelineHistory: the region in the label', () => {
    it('names the region only with two regions or more; lists the regions, the most events first', () => {
        const r = computeTimelineHistory(d, ALL, payload(base), 'en');
        expect(r.events.map(e => e.region)).toEqual(['Valdoria', 'Valdoria', 'Quellnitz Land', 'Valdoria']);
        expect(r.regionList).toEqual([
            { id: 'xx-valdorie', name: 'Valdoria', count: 3 },
            { id: 'xx-quellnitz', name: 'Quellnitz Land', count: 1 },
        ]);
        // Bert alone: one region, no name; English when the UI's language is missing.
        const one = computeTimelineHistory(d, ['bert'], payload(base), 'de');
        expect(one.events.every(e => e.region === undefined)).toBe(true);
        expect(one.regionList).toEqual([{ id: 'xx-valdorie', name: 'Valdoria', count: 3 }]);
    });

    it('the model names it only while the rows still have two regions', () => {
        const r = computeTimelineHistory(d, ALL, payload(base), 'en');
        const all = computeTimelineModel(d, ALL, 2026, { history: { events: r.events } });
        expect(all.history?.regions).toBe(2);
        expect(all.history?.events.find(e => e.id === 'Q-1880')?.region).toBe('Quellnitz Land');
        const bertOnly = computeTimelineModel(d, ['bert'], 2026, { history: { events: r.events } });
        expect(bertOnly.history?.regions).toBe(1);
        expect(bertOnly.history?.events.map(e => [e.id, e.region])).toEqual([['V-1866', undefined], ['V-1870', undefined], ['V-1895', undefined]]);
    });
});

describe('the stored region filter', () => {
    it('a region the research knows keeps its name; an unknown one means all regions', () => {
        const p = payload(base);
        expect(timelineHistoryRegion(p, 'xx-quellnitz', 'en')).toEqual({ region: 'xx-quellnitz', regionName: 'Quellnitz Land' });
        expect(timelineHistoryRegion(p, 'xx-valdorie', 'cs')).toEqual({ region: 'xx-valdorie', regionName: 'Valdorie' });
        expect(timelineHistoryRegion(p, 'xx-gone', 'en')).toBeUndefined();
        expect(timelineHistoryRegion(p, undefined, 'en')).toBeUndefined();
        // The name the row's list has wins.
        expect(timelineHistoryRegion(p, 'xx-valdorie', 'en', [{ id: 'xx-valdorie', name: 'V' }])?.regionName).toBe('V');
        // An unknown region filters nothing on the model.
        const r = computeTimelineHistory(d, ALL, p, 'en');
        expect(filterTimelineHistory(r.events, { region: 'xx-quellnitz' }).map(e => e.id)).toEqual(['Q-1880']);
        const filter = timelineHistoryRegion(p, 'xx-gone', 'en');
        expect(computeTimelineModel(d, ALL, 2026, { history: { events: r.events, filter } }).history?.events.length).toBe(4);
    });
});

describe('the options of the history row, per tree', () => {
    function loadSettings(stored: Record<string, unknown> | null): Map<string, string> {
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
        return store;
    }
    const saved = (store: Map<string, string>): Record<string, any> => JSON.parse(store.get('strom-settings') ?? '{}');
    afterEach(() => vi.unstubAllGlobals());

    it('defaults: every kind, every region, no local events', () => {
        loadSettings(null);
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ local: false });
        expect(SettingsManager.getTimelineHistory(null)).toEqual({ local: false });
    });

    it('kept per tree, beside the card timeline defaults; all nine kinds store nothing', () => {
        const store = loadSettings(null);
        SettingsManager.setLifelineDefaults('brumla', { childEvents: true, history: true });
        SettingsManager.setTimelineHistory('brumla', { kinds: ['war', 'census'], region: 'xx-valdorie', local: true });
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ kinds: ['war', 'census'], region: 'xx-valdorie', local: true });
        expect(SettingsManager.getTimelineHistory('other')).toEqual({ local: false });
        expect(saved(store).lifelineByTree.brumla).toEqual({
            childEvents: true, history: true, timeline: { kinds: ['war', 'census'], region: 'xx-valdorie', local: true },
        });
        // Setting the card's defaults keeps the row's options.
        SettingsManager.setLifelineDefaults('brumla', { childEvents: false, history: true });
        expect(SettingsManager.getTimelineHistory('brumla').region).toBe('xx-valdorie');
        // No kind is a choice too (the row empty); all kinds is no filter.
        SettingsManager.setTimelineHistory('brumla', { kinds: [], local: false });
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ kinds: [], local: false });
        SettingsManager.setTimelineHistory('brumla', {
            kinds: ['war', 'epidemic', 'state', 'law', 'economy', 'census', 'emigration', 'disaster', 'other'], local: false,
        });
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ local: false });
        expect(saved(store).lifelineByTree.brumla.timeline).toBeUndefined();
    });

    it('reads stored nonsense defensively and forgets the options with the tree', () => {
        const store = loadSettings({ lifelineByTree: { brumla: { timeline: { kinds: ['war', 'volcano', 7], region: 5, local: 'yes' } } } });
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ kinds: ['war'], local: false });
        SettingsManager.setTimelineHistory('brumla', { region: 'xx-quellnitz', local: false });
        SettingsManager.forgetLifelineDefaults('brumla');
        expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ local: false });
        expect(saved(store).lifelineByTree?.brumla).toBeUndefined();
    });
});

describe('the options of the history row (§5) and its states (§10)', () => {
    const r = computeTimelineHistory(d, ALL, payload(base), 'en');
    const regionNames = { 'xx-valdorie': 'Valdoria', 'xx-quellnitz': 'Quellnitz Land' } as Record<string, string>;
    const model = (filter: { kinds?: ('war' | 'census' | 'law' | 'epidemic' | 'disaster')[]; region?: string } = {}, local = true, events = r.events) =>
        computeTimelineModel(d, ALL, 2026, { history: {
            events, ...(local ? { local: r.local } : {}),
            filter: { ...filter, ...(filter.region ? { regionName: regionNames[filter.region] } : {}) },
        } });
    const svg = (m: ReturnType<typeof model>, narrow = false) => buildTimelineSvg(m, {
        esc: (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        width: 900, rowH: 30, labelW: narrow ? 96 : 160, mode: 'screen', narrow,
    });

    it('the chips count the row and the lines: each kind (of the region chosen), each region (of the kinds chosen), the most first', () => {
        const f = timelineHistoryFacets(model().history!);
        expect(f.kinds.map(k => k.kind)).toEqual(['war', 'epidemic', 'census', 'state', 'emigration', 'law', 'economy', 'disaster', 'other']);
        // war: V-1866, V-1870, V-1895; census: Q-1880; the lines' local ones: L-1870 twice (Anna, Bert), P-1870, P-1900.
        expect(Object.fromEntries(f.kinds.filter(k => k.count).map(k => [k.kind, k.count]))).toEqual({ war: 3, epidemic: 2, census: 1, disaster: 2 });
        expect(f.regions).toEqual([{ id: 'xx-valdorie', count: 3 }, { id: 'xx-quellnitz', count: 1 }]);
        const inQuellnitz = timelineHistoryFacets(model({ region: 'xx-quellnitz' }).history!);
        expect(inQuellnitz.kinds.find(k => k.kind === 'war')!.count).toBe(0);
        expect(timelineHistoryFacets(model({ kinds: ['census'] }).history!).regions).toEqual([{ id: 'xx-quellnitz', count: 1 }]);
        // Without the option the lines count nothing.
        expect(timelineHistoryFacets(model({}, false).history!).kinds.find(k => k.kind === 'disaster')!.count).toBe(0);
    });

    it('a kind clicked: added or taken away; "All", none left or all nine is no filter', () => {
        expect(toggleTimelineKind(undefined, 'war')).toEqual(['war']);
        expect(toggleTimelineKind(['war'], 'census')).toEqual(['war', 'census']);
        expect(toggleTimelineKind(['census', 'war'], 'war')).toEqual(['census']);
        expect(toggleTimelineKind(['war'], 'war')).toBeUndefined();
        expect(toggleTimelineKind(['war', 'census'], null)).toBeUndefined();
        expect(toggleTimelineKind([], 'law')).toEqual(['law']);
        expect(toggleTimelineKind(['war', 'epidemic', 'census', 'state', 'emigration', 'law', 'economy', 'disaster'], 'other')).toBeUndefined();
    });

    it('"Clear filter" drops the kinds and the region in one step and keeps the local option, stored for the tree', () => {
        expect(clearTimelineFilter({ kinds: ['war'], region: 'xx-valdorie', local: true })).toEqual({ local: true });
        expect(clearTimelineFilter({ kinds: ['law'], local: false })).toEqual({ local: false });
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
        try {
            const sm = SettingsManager as unknown as { settings: Record<string, unknown> };
            sm.settings = { theme: 'system', language: 'system', encryption: false, auditLog: false };
            SettingsManager.setTimelineHistory('brumla', { kinds: ['war', 'census'], region: 'xx-valdorie', local: true });
            SettingsManager.setTimelineHistory('brumla', clearTimelineFilter(SettingsManager.getTimelineHistory('brumla')));
            expect(SettingsManager.getTimelineHistory('brumla')).toEqual({ local: true });
            expect(JSON.parse(store.get('strom-settings')!).lifelineByTree.brumla.timeline).toEqual({ local: true });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('the label counts the kinds chosen the timeline has: a kind it does not have makes "0 kinds"', () => {
        setLanguage('en');
        expect(timelineFilterKindCount(model({ kinds: ['war', 'census'] }).history!)).toBe(2);
        expect(timelineFilterKindCount(model({ kinds: ['war', 'law'] }).history!)).toBe(1);
        expect(historyFilterText(model({ kinds: ['law'] }).history!)).toBe('0 kinds');
        expect(historyFilterText(model({ region: 'xx-quellnitz' }).history!)).toBe('Quellnitz Land');
        expect(historyFilterText(model({ kinds: ['war'], region: 'xx-valdorie' }).history!)).toBe('2 filters');
        expect(historyFilterText(model().history!)).toBe('');
        setLanguage('cs');
        expect(historyFilterText(model({ kinds: ['law'] }).history!)).toBe('0 druhů');
        setLanguage('en');
    });

    it('states: events; a filter leaving nothing says so with "Clear filter"; no event of a region but local ones is a thin row', () => {
        setLanguage('en');
        const all = model();
        expect(timelineHistoryRowState(all.history!, all.rows)).toBe('events');
        // A kind the timeline does not have: the row stays, its sentence and "Clear filter"; the lines keep none either.
        const none = model({ kinds: ['law'] });
        expect(none.history?.events).toEqual([]);
        expect(none.rows.every(row => !row.local)).toBe(true);
        expect(timelineHistoryRowState(none.history!, none.rows)).toBe('emptyFilter');
        const drawn = svg(none);
        expect(drawn).toContain('class="tl-hist-empty"');
        expect(drawn).toContain('<span class="tl-hist-empty-text">No history for the chosen kinds</span>');
        expect(drawn).toContain('class="link-button tl-hist-clear">Clear filter</button>');
        expect(drawn).toContain('<span class="tl-hist-meta">· 0 kinds</span>');
        // A phone: the short sentence, the whole one its name.
        const phone = svg(none, true);
        expect(phone).toContain('aria-label="No history for the chosen kinds"');
        expect(phone).toContain('>No history</span>');
        // A region filter with no event of the kinds there: the same.
        const off = model({ kinds: ['war'], region: 'xx-quellnitz' });
        expect(timelineHistoryRowState(off.history!, off.rows)).toBe('emptyFilter');
        // The row's events filtered away while a line shows a local one of the kinds: thin, no sentence.
        const local = model({ kinds: ['disaster'] });
        expect(timelineHistoryRowState(local.history!, local.rows)).toBe('thin');
        expect(svg(local)).not.toContain('tl-hist-empty');
        // No event of a region (the origin off), local history on: a thin row with the label alone (5d).
        const thin = model({}, true, []);
        expect(thin.history?.events).toEqual([]);
        expect(timelineHistoryRowState(thin.history!, thin.rows)).toBe('thin');
        expect(svg(thin)).toContain('class="tl-hist-btn"');
        expect(svg(thin)).not.toContain('tl-hist-empty');
        // ... and a kind filter hiding every local one keeps it, saying so (the filter can be cleared).
        const thinNone = model({ kinds: ['war'] }, true, []);
        expect(thinNone.history).toBeDefined();
        expect(timelineHistoryRowState(thinNone.history!, thinNone.rows)).toBe('emptyFilter');
        // No event of a region and the local option off: no row at all.
        expect(model({}, false, []).history).toBeUndefined();
    });

    it('the local option: unavailable with both of its origins off in Settings; "none" without a local event on the timeline', () => {
        expect(timelineLocalOptionState({ place: false, local: false }, true)).toBe('off');
        expect(timelineLocalOptionState({ place: true, local: false }, false)).toBe('none');
        expect(timelineLocalOptionState({ place: false, local: true }, true)).toBe('ok');
    });
});

describe('local history on the life lines (§4, §6–§8)', () => {
    const r = computeTimelineHistory(d, ALL, payload(base), 'en');
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const model = (kinds?: ('war' | 'epidemic' | 'disaster')[]) => computeTimelineModel(d, ALL, 2026, { history: {
        events: r.events, local: r.local, ...(kinds ? { filter: { kinds } } : {}),
    } });
    const svg = (m: ReturnType<typeof model>, o: { width?: number; narrow?: boolean; mode?: 'screen' | 'poster' } = {}) => buildTimelineSvg(m, {
        esc, width: o.width ?? 900, rowH: o.narrow ? 28 : 30, labelW: o.narrow ? 96 : 160, mode: o.mode ?? 'screen', narrow: !!o.narrow,
    });
    /** The row group of a person: from its opening tag to the next row's. */
    const rowOf = (s: string, id: string): string => {
        const i = s.indexOf(`data-person-id="${id}"`);
        const j = s.indexOf('<g class="timeline-bar', i);
        return s.slice(i, j < 0 ? undefined : j);
    };
    const xOf = (axis: { minYear: number; maxYear: number }, width: number, labelW: number) => (y: number) =>
        labelW + (y - axis.minYear) / (axis.maxYear - axis.minYear) * (width - labelW - 16);

    it('a symbol 10 px or nearer a dot goes 11 px right of it, or left when the right leaves the bar; never past the bar\'s end', () => {
        expect(timelineLocalX(105, [100], 50, 300)).toBe(111);
        expect(timelineLocalX(95, [100], 50, 300)).toBe(111);
        expect(timelineLocalX(110, [100], 50, 300)).toBe(110);
        // The right would leave the bar: the left.
        expect(timelineLocalX(103, [100], 50, 105)).toBe(89);
        // The right meets another dot, the left is free.
        expect(timelineLocalX(102, [100, 113], 50, 300)).toBe(89);
        // Past the bar's end (a living person's arrow, a fading end): at the end, then aside from a dot there.
        expect(timelineLocalX(320, [], 50, 300)).toBe(300);
        expect(timelineLocalX(320, [296], 50, 300)).toBe(285);
    });

    it('a line groups its symbols like the history row (16 px, a phone 22 px); below 1.5 px per year one symbol with them all', () => {
        const item = (id: string, year: number, o: Partial<TimelineLocalItem> = {}): TimelineLocalItem =>
            ({ id, year, kind: 'disaster', scope: 'place', place: 'Zelvar', text: id, ...o });
        const items = [item('a', 1850), item('b', 1855), item('c', 1857), item('d', 1880)];
        const at = (px: number) => (y: number) => 200 + (y - 1800) * px;
        const desk = layoutTimelineLocal(items, { xOf: at(3), barX1: 200, barX2: 800, obstacles: [], gap: 16, pxPerYear: 3 });
        expect(desk.marks.map(m => [m.x, m.items.map(e => e.id)])).toEqual([[350, ['a', 'b']], [371, ['c']], [440, ['d']]]);
        const phone = layoutTimelineLocal(items, { xOf: at(3), barX1: 200, barX2: 800, obstacles: [], gap: 22, pxPerYear: 3 });
        expect(phone.marks.map(m => m.items.map(e => e.id))).toEqual([['a', 'b', 'c'], ['d']]);
        // A symbol stepped aside is grouped where it stands, the group at its first symbol.
        const aside = layoutTimelineLocal(items, { xOf: at(3), barX1: 200, barX2: 800, obstacles: [352], gap: 16, pxPerYear: 3 });
        expect(aside.marks.map(m => [m.x, m.items.map(e => e.id)])).toEqual([[363, ['a', 'b', 'c']], [440, ['d']]]);
        // 1.4 px per year: one symbol at the first event, all four in it.
        const dense = layoutTimelineLocal(items, { xOf: at(1.4), barX1: 200, barX2: 800, obstacles: [], gap: 22, pxPerYear: 1.4 });
        expect(dense.marks).toHaveLength(1);
        expect(dense.marks[0].x).toBeCloseTo(270);
        expect(dense.marks[0].items.map(e => e.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(LOCAL_DENSE_PX_PER_YEAR).toBe(1.5);
    });

    it('a period\'s stripe runs from the year the person came (moved) to its end, at most to the bar\'s end', () => {
        const at = (y: number) => 100 + (y - 1800) * 4;
        const moved: TimelineLocalItem = { id: 'p', year: 1866, year2: 1870, moved: true, kind: 'economy', scope: 'place', place: 'Zelvar', text: 'p' };
        const l = layoutTimelineLocal([moved], { xOf: at, barX1: 100, barX2: 900, obstacles: [], gap: 16, pxPerYear: 4 });
        expect(l.periods.map(p => [p.x1, p.x2])).toEqual([[at(1866), at(1870)]]);
        const cut = layoutTimelineLocal([moved], { xOf: at, barX1: 100, barX2: at(1868), obstacles: [], gap: 16, pxPerYear: 4 });
        expect(cut.periods.map(p => [p.x1, p.x2])).toEqual([[at(1866), at(1868)]]);
        // Drawn: Dora came to Quellnitz in 1866, during its period 1860–1870 — the symbol and the stripe from 1866.
        const dora = person('dora', { birthDate: '1866', birthPlace: 'Quellnitz', deathDate: '1910', deathPlace: 'Quellnitz' });
        const dd = data([dora]);
        const rr = computeTimelineHistory(dd, ['dora'], payload({
            ...base, events: [...base.events, placeEvent('P-1860', 1860, { to: 1870 })],
            places: { ...base.places, Quellnitz: { events: [...base.places.Quellnitz.events, 'P-1860'] } },
        }), 'en');
        const m = computeTimelineModel(dd, ['dora'], 2026, { history: { events: rr.events, local: rr.local } });
        const x = xOf(m.axis, 900, 160);
        const s = svg(m);
        expect(s).toContain(`<rect class="tl-loc-period is-place" x="${x(1866).toFixed(1)}" y="64.0" width="${(x(1870) - x(1866)).toFixed(1)}" height="2.5"`);
        expect(s).toContain(`<rect class="tl-loc-box" x="${(x(1866) - 7).toFixed(1)}" y="48"`);
    });

    it('draws a symbol per line on a box over the bar, after the dots, named and titled; the kind filter applies, the poster has none', () => {
        setLanguage('en');
        const m = model();
        const s = svg(m);
        const anna = rowOf(s, 'anna');
        expect(anna).toContain('class="tl-loc is-local" role="img"');
        expect(anna).toContain('data-hist-ids="L-1870 P-1870"');
        expect(anna).toContain('aria-label="1870 · epidemic · Zelvar: Local L-1870; 1870 · disaster · Quellnitz: Village P-1870"');
        expect(anna).toContain('<title>1870 · epidemic · Zelvar – Local L-1870\nfrom records: Matrika zemřelých Zelvar\n'
            + '1870 · disaster · Quellnitz – Village P-1870</title>');
        expect(anna).toContain('class="tl-loc-box"');
        expect(anna).toContain('width="14" height="14" rx="3" aria-hidden="true"');
        // Bar, dots, then the local symbols.
        expect(anna.indexOf('tl-bar-rect')).toBeLessThan(anna.indexOf('tl-dot'));
        expect(anna.lastIndexOf('tl-dot')).toBeLessThan(anna.indexOf('tl-loc'));
        // The move of 1870 is a dot: L-1870 and P-1870 step 11 px aside of it and share one symbol with a badge of 2.
        const x = xOf(m.axis, 900, 160);
        expect(anna).toContain(`<rect class="tl-loc-box" x="${(x(1870) + 11 - 7).toFixed(1)}"`);
        expect(anna).toMatch(/class="tl-loc-n-txt"[^>]*>2<\/text>/);
        // The target: the row high, at most 24 px, off the dot beside it.
        const hit = /<rect class="tl-loc-hit" x="([\d.]+)" y="(\d+)" width="([\d.]+)" height="30"/.exec(anna)!;
        expect(Number(hit[3])).toBeLessThanOrEqual(24);
        expect(Number(hit[1])).toBeGreaterThan(x(1870) + 3);
        // Cyril's period 1900–1902 has its stripe under the bar.
        expect(rowOf(s, 'cyril')).toMatch(/<rect class="tl-loc-period is-place" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="2.5" rx="1.25"\/>/);
        // The kind filter: disasters only — Anna keeps P-1870, the epidemic of the register is gone.
        const f = svg(model(['disaster']));
        expect(rowOf(f, 'anna')).toContain('data-hist-ids="P-1870"');
        expect(f).not.toContain('L-1870');
        // The poster draws no local history (P2).
        expect(svg(m, { mode: 'poster' })).not.toContain('tl-loc');
    });

    it('a phone\'s long axis (under 1.5 px per year): one symbol per line with the count of all', () => {
        const wide = { ...base, events: [...base.events, placeEvent('P-1850', 1850), placeEvent('P-1880', 1880)],
            places: { ...base.places, Zelvar: { events: [...base.places.Zelvar.events, 'P-1850', 'P-1880'] } } };
        // An ancestor of the 18th century widens the axis to some 220 years.
        const dd = data([anna, bert, cyril, person('ezra', { birthDate: '1700', birthPlace: 'Brdovec', deathDate: '1760' })]);
        const ids = [...ALL, 'ezra'];
        const rr = computeTimelineHistory(dd, ids, payload(wide), 'en');
        const m = computeTimelineModel(dd, ids, 2026, { history: { events: rr.events, local: rr.local } });
        const span = m.axis.maxYear - m.axis.minYear;
        // 390 px wide, 96 px names: under the threshold.
        expect((390 - 96 - 16) / span).toBeLessThan(1.5);
        const phone = svg(m, { width: 390, narrow: true });
        const line = rowOf(phone, 'bert');
        expect(line.match(/class="tl-loc /g)).toHaveLength(1);
        expect(line).toContain('data-hist-ids="P-1850 L-1870 P-1880"');
        expect(line).toMatch(/class="tl-loc-n-txt"[^>]*>3<\/text>/);
        // A computer: the same line in groups.
        expect(rowOf(svg(m, { width: 1440 }), 'bert').match(/class="tl-loc /g)!.length).toBeGreaterThan(1);
    });
});

// ==================== performance (spec 121 §0) ====================

/** The computation's budget: 3 000 persons, 600 events (normalized ms). */
const COMPUTE_BUDGET_MS = 50;
/** The filter's budget on the finished list (normalized ms). */
const FILTER_BUDGET_MS = 16;
/** Calibration rounds about as long as each measured work, and their best time on the reference machine at rest. */
const COMPUTE_CALIBRATION_ROUNDS = 8;
const COMPUTE_CALIBRATION_REFERENCE_MS = 44;
const FILTER_CALIBRATION_ROUNDS = 1;
const FILTER_CALIBRATION_REFERENCE_MS = 5.5;

describe('the history row on a large tree', () => {
    // 3 000 persons over 60 villages in 6 regions, each 1–3 places over a life of 40–80 years;
    // 600 events, each in 1–4 villages of its region (100 of them the villages' own or findings).
    function big(): { data: StromData; ids: string[]; p: HistoryPayload } {
        let seed = 4242;
        const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const village = (i: number) => `Zelvar ${i}`;
        const persons: Person[] = [];
        for (let i = 0; i < 3000; i++) {
            const born = 1700 + Math.floor(rnd() * 250);
            const died = born + 40 + Math.floor(rnd() * 40);
            const events: LifeEvent[] = [];
            const moves = Math.floor(rnd() * 3);
            for (let m = 0; m < moves; m++) {
                events.push(residence(String(born + 15 + Math.floor(rnd() * 25)), village(Math.floor(rnd() * 60)), `r${i}-${m}`));
            }
            persons.push(person(`p${i}`, {
                birthDate: String(born), birthPlace: village(Math.floor(rnd() * 60)), deathDate: String(died),
                deathPlace: village(Math.floor(rnd() * 60)), events,
            }));
        }
        const events: Record<string, unknown>[] = [];
        const places: Record<string, { events: string[] }> = {};
        for (let v = 0; v < 60; v++) places[village(v)] = { events: [] };
        for (let e = 0; e < 600; e++) {
            const region = Math.floor(rnd() * 6);
            const from = 1700 + Math.floor(rnd() * 320);
            const id = `E-${e}`;
            const scope = e % 6 === 0 ? (e % 12 === 0 ? 'local' : 'place') : 'region';
            const extra = rnd() < 0.2 ? { to: from + 1 + Math.floor(rnd() * 10) } : {};
            events.push(scope === 'local' ? localEvent(id, from, extra)
                : scope === 'place' ? placeEvent(id, from, extra)
                    : regionEvent(id, from, { ...extra, region: { id: `xx-r${region}`, name: { cs: `Kraj ${region}` } } }));
            const n = 1 + Math.floor(rnd() * 4);
            for (let k = 0; k < n; k++) {
                const list = places[village(region * 10 + Math.floor(rnd() * 10))].events;
                if (!list.includes(id)) list.push(id);
            }
        }
        return { data: data(persons), ids: persons.map(p => p.id), p: payload({ events, places, hidden: [{ event: 'E-1', tree: true }, { region: 'xx-r5' }] }) };
    }

    it('3 000 persons × 600 events: computed within 50 ms, filtered within 16 ms', () => {
        const { data: tree, ids, p } = big();
        const r = computeTimelineHistory(tree, ids, p, 'cs');
        // The data is a real load: hundreds of events on the row, each concerning many persons.
        expect(r.events.length).toBeGreaterThan(300);
        expect(r.events.reduce((n, e) => n + e.persons.length, 0)).toBeGreaterThan(5000);
        expect(r.local.size).toBeGreaterThan(100);
        expect(r.events.some(e => e.regionId === 'xx-r5')).toBe(false);
        // Each run computes the residences again (a changed tree): the cold path.
        const compute = measureAgainstBudget(() => computeTimelineHistory(tree, ids, p, 'cs'), {
            budgetMs: COMPUTE_BUDGET_MS, calibrationRounds: COMPUTE_CALIBRATION_ROUNDS, referenceMs: COMPUTE_CALIBRATION_REFERENCE_MS,
            maxWallMs: 4_000,
        });
        console.log(budgetReport('computeTimelineHistory 3000 × 600', compute, COMPUTE_BUDGET_MS));
        if (compute.judged) expect(compute.ms).toBeLessThan(COMPUTE_BUDGET_MS);

        const filter = { kinds: ['war', 'census', 'epidemic'] as const, region: 'xx-r2' };
        expect(filterTimelineHistory(r.events, filter).every(e => e.regionId === 'xx-r2' && e.kind === 'war')).toBe(true);
        const filtered = measureAgainstBudget(() => filterTimelineHistory(r.events, filter), {
            budgetMs: FILTER_BUDGET_MS, calibrationRounds: FILTER_CALIBRATION_ROUNDS, referenceMs: FILTER_CALIBRATION_REFERENCE_MS,
            maxWallMs: 2_000,
        });
        console.log(budgetReport('filterTimelineHistory', filtered, FILTER_BUDGET_MS));
        if (filtered.judged) expect(filtered.ms).toBeLessThan(FILTER_BUDGET_MS);
    });
});
