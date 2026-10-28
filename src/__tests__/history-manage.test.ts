/**
 * History of places manager (pure model): region groups and their order,
 * regions derived for an older research, parents from `covered`, the Places
 * view, Hidden and Deleted rows, the header and the search without diacritics.
 * Fictional data (Lhota, Horní Kounice).
 */

import { describe, it, expect } from 'vitest';
import {
    foldSearch, matchesQuery, manageRegions, regionParents, regionGroups, placeGroups, hiddenRows,
    deletedRows, manageHeader, manageCan, gapsLabel, waitingPlaces, regionPicker, pickerCheck, pickerBody, pickerYear,
    mapResultText, placesHistoryLine, manageSummaries, type ManageEnv, type ManageNames,
    detailOwner, detailEvents, filterDetailEvents, detailFacets, detailCenturies, centuryGroups, emptyDetailFilter,
    detailFilterActive, historyAudience, audiencePlaces,
} from '../history-manage.js';
import { parseHistoryPayload, type HistoryPayload, type HistoryEvent, type HistoryRegion } from '../history.js';
import type { StromData, Person, PersonId } from '../types.js';

const ALL = ['history.events', 'history.hide', 'history.regions', 'history.first', 'history.hide.all',
    'history.skip', 'history.delete', 'history.map', 'history.place'];

function env(o: Partial<ManageEnv> = {}): ManageEnv {
    return {
        lang: 'en', features: ALL, bridgeUp: true, queue: [], treeState: 'research', searchOn: true,
        formatDate: iso => iso.slice(0, 10), formatTime: iso => iso.slice(11, 16), ...o,
    };
}
const names: ManageNames = { place: k => k.replace(/^./, c => c.toUpperCase()), person: (refn) => (refn === 'R1' ? 'Jan Lhoták' : '') };

function ev(id: string, o: Partial<HistoryEvent> = {}): HistoryEvent {
    return { id, from: 1866, kind: 'war', scope: 'region', region: { id: 'bohemia', name: { en: 'Bohemia' } }, text: { en: `Event ${id}` }, ...o };
}
function region(id: string, o: Partial<HistoryRegion> = {}): HistoryRegion {
    return { id, name: { en: id[0].toUpperCase() + id.slice(1), cs: id === 'bohemia' ? 'Čechy' : id }, state: 'queued', ...o };
}
function payload(o: Partial<HistoryPayload> = {}): HistoryPayload {
    return {
        state: { on: true, search: 'running', pending: 3 }, events: [], places: {}, hidden: [], cachedAt: '2026-10-28T09:00:00Z', ...o,
    };
}

describe('search', () => {
    it('folds diacritics and case', () => {
        expect(foldSearch('Horní Kounice')).toBe('horni kounice');
        expect(matchesQuery(foldSearch('Čáslav · Bohemia'), 'caslav')).toBe(true);
        expect(matchesQuery(foldSearch('Čáslav'), 'ČÁS  xy')).toBe(false);
        expect(matchesQuery(foldSearch('Čáslav'), '  ')).toBe(true);
    });
});

describe('gates', () => {
    it('bridge actions need the bridge and their feature; hidings only the feature', () => {
        expect(manageCan({ features: ALL, bridgeUp: true }, 'first')).toBe(true);
        expect(manageCan({ features: ALL, bridgeUp: false }, 'first')).toBe(false);
        expect(manageCan({ features: ALL, bridgeUp: false }, 'hideAll')).toBe(true);
        expect(manageCan({ features: ['history.events'], bridgeUp: true }, 'skip')).toBe(false);
    });
});

describe('regions', () => {
    it('derives regions from the events without R1', () => {
        const p = payload({ events: [ev('a'), ev('b'), ev('c', { region: { id: 'moravia' } }), ev('d', { scope: 'local', region: undefined })] });
        const { regions, derived } = manageRegions(p);
        expect(derived).toBe(true);
        expect(regions.map(r => [r.id, r.events, r.state])).toEqual([['bohemia', 2, 'none'], ['moravia', 1, 'none']]);
        const groups = regionGroups(p, env(), names);
        expect(groups.map(g => g.key)).toEqual(['all', 'noRegion']);
        expect(groups[0].rows.every(r => r.state === '' && r.actions.length === 0 || r.actions.every(a => a === 'hideAll'))).toBe(true);
        expect(groups[1].rows[0].kind).toBe('local');
    });

    it('parents come from covered', () => {
        const parents = regionParents([region('austria', { state: 'done', covered: ['bohemia', 'moravia'] }), region('bohemia'), region('moravia')]);
        expect(parents.get('bohemia')).toBe('austria');
        expect(parents.has('austria')).toBe(false);
    });

    it('orders the queue running → first → by order → waiting → none, and groups done and not searched', () => {
        const p = payload({
            regions: {
                a: region('a', { state: 'queued', order: 3 }),
                b: region('b', { state: 'queued', order: 1 }),
                c: region('c', { state: 'running' }),
                d: region('d', { state: 'queued', order: 5, first: true }),
                e: region('e', { state: 'waiting', why: 'no catalogue yet' }),
                f: region('f', { state: 'none' }),
                g: region('g', { state: 'done', at: '2026-10-20T10:00:00Z', events: 4, gaps: [{ from: 1870, to: 1913 }, { from: 1920, to: 1920 }], fill: 'queued' }),
                h: region('h', { state: 'covered', covered: ['g'] }),
                i: region('i', { state: 'skipped' }),
            },
        });
        const groups = regionGroups(p, env(), names);
        expect(groups.map(g => g.key)).toEqual(['queue', 'done', 'skip']);
        expect(groups[0].rows.map(r => r.key)).toEqual(['c', 'd', 'b', 'a', 'e', 'f']);
        const [c, d, b, a, e, f] = groups[0].rows;
        expect(c.state).toBe('Searching');
        expect(d.state).toBe('First');
        expect(b.state).toBe('Queued · next');
        expect(a.state).toBe('Queued · 3rd');
        expect(e.why).toBe('no catalogue yet');
        expect(f.state).toBe('');
        expect(a.events).toBeNull();
        expect(a.actions).toEqual(['first', 'hideAll', 'skip']);
        expect(d.actions).not.toContain('first');
        const g = groups[1].rows[0];
        expect(g.state).toBe('Done · 2026-10-20');
        expect(g.gaps).toContain('1870–1913, 1920');
        expect(g.open).toBe(true);
        const [h, i] = groups[2].rows;
        expect(h.state).toContain('G');
        expect(h.parent).toBe('');
        expect(i.dim).toBe(true);
        expect(i.link).toBe('searchAgain');
    });

    it('a done region with a fill task but no gaps says more years are coming (cs/en/de)', () => {
        const p = payload({ regions: {
            a: region('a', { state: 'done', fill: 'queued' }),
            b: region('b', { state: 'done', fill: 'running' }),
            c: region('c', { state: 'done', fill: 'running', gaps: [{ from: 1870, to: 1913 }] }),
            d: region('d', { state: 'done' }),
        } });
        const rows = (lang: 'en' | 'cs' | 'de') => regionGroups(p, env({ lang }), names)[0].rows;
        const [a, b, c, d] = rows('en');
        expect(a.gaps).toBe('more years queued');
        expect(b.gaps).toBe('more years being searched');
        expect(c.gaps).toBe('years without events 1870–1913 · being filled');
        expect(d.gaps).toBe('');
        expect(rows('cs').map(r => r.gaps).slice(0, 2)).toEqual(['další roky na řadě', 'hledají se další roky']);
        expect(rows('de').map(r => r.gaps).slice(0, 2)).toEqual(['weitere Jahre geplant', 'weitere Jahre werden gesucht']);
    });

    it('never offers find first for a skipped, covered or done region', () => {
        const p = payload({ regions: {
            s: region('s', { state: 'skipped' }), c: region('c', { state: 'covered', covered: ['x'] }), d: region('d', { state: 'done' }),
            q: region('q', { state: 'queued', order: 2 }), w: region('w', { state: 'waiting' }),
        } });
        const rows = regionGroups(p, env(), names).flatMap(g => g.rows);
        const first = rows.filter(r => r.actions.includes('first')).map(r => r.key).sort();
        expect(first).toEqual(['q', 'w']);
    });

    it('without the bridge offers only hide all; an archive shows the queue waiting', () => {
        const p = payload({ regions: { a: region('a', { state: 'queued', order: 1 }) } });
        expect(regionGroups(p, env({ bridgeUp: false }), names)[0].rows[0].actions).toEqual(['hideAll']);
        const archived = regionGroups(p, env({ treeState: 'archive' }), names)[0];
        expect(archived.archive).toBe(true);
        expect(archived.rows[0].state).toBe('Waiting');
        expect(archived.rows[0].actions).not.toContain('first');
    });

    it('a region hidden as a whole is dimmed with show again', () => {
        const p = payload({ regions: { bohemia: region('bohemia', { state: 'done', events: 2 }) }, hidden: [{ region: 'bohemia', at: '2026-10-27T10:00:00Z' }] });
        const row = regionGroups(p, env(), names)[0].rows[0];
        expect(row.state).toBe('Hidden in this tree');
        expect(row.link).toBe('showAgain');
        expect(row.actions).not.toContain('hideAll');
    });

    it('lists places with their own history under Without region', () => {
        const p = payload({
            regions: {},
            events: [ev('p1', { scope: 'place', region: undefined, place: { key: 'lhota', id: 'L0001' } })],
            places: { lhota: { events: ['p1'], id: 'L0001', history: 'done', at: '2026-10-01T00:00:00Z' }, kounice: { events: [], history: 'running' }, other: { events: [] } },
        });
        const rows = regionGroups(p, env(), names).find(g => g.key === 'noRegion')!.rows;
        expect(rows.map(r => r.key)).toEqual(['place:kounice', 'place:lhota']);
        expect(rows[1].events).toBe(1);
    });

    it('uses the UI language for names and searches every language', () => {
        const p = payload({ regions: { bohemia: region('bohemia') } });
        const row = regionGroups(p, env({ lang: 'cs' }), names)[0].rows[0];
        expect(row.name).toBe('Čechy');
        expect(matchesQuery(row.search, 'cechy')).toBe(true);
        expect(matchesQuery(row.search, 'bohemia')).toBe(true);
    });
});

describe('places', () => {
    const p = payload({
        regions: { bohemia: region('bohemia', { state: 'done' }) },
        suggest: ['L0002', 'L0009'],
        places: {
            lhota: { events: [], id: 'L0001', regions: [{ id: 'bohemia', from: 1800 }], persons: 4, manual: true },
            kounice: { events: [], id: 'L0002', regions: [{ id: 'bohemia' }], persons: 9, history: 'none' },
            nowhere: { events: [], state: 'unlocated', why: 'two places of that name', persons: 2 },
            skipped: { events: [], skip: true, persons: 1 },
        },
    });

    it('groups unassigned, suggested and all', () => {
        const groups = placeGroups(p, env(), names);
        expect(groups.map(g => g.key)).toEqual(['unassigned', 'suggest', 'all']);
        expect(groups[0].rows[0].why).toBe('two places of that name');
        expect(groups[0].rows[0].assign).toBe(true);
        expect(groups[1].rows.map(r => r.key)).toEqual(['kounice']);
        expect(groups[2].rows.map(r => r.key)).toEqual(['kounice', 'lhota', 'nowhere', 'skipped']);
        const lhota = groups[2].rows[1];
        expect(lhota.meta).toBe('Bohemia from 1800 (manual) · 4 people');
        expect(lhota.actions).toEqual(['changeRegion', 'placeFind', 'skip', 'openInPlaces']);
        expect(groups[2].rows[3].link).toBe('searchAgain');
    });

    it('sorts alphabetically on request', () => {
        expect(placeGroups(p, env(), names, 'alpha').find(g => g.key === 'all')!.rows.map(r => r.key))
            .toEqual(['kounice', 'lhota', 'nowhere', 'skipped']);
        const rows = placeGroups(payload({ regions: {}, places: { b: { events: [], persons: 9 }, a: { events: [], persons: 1 } } }), env(), names, 'alpha')[0].rows;
        expect(rows.map(r => r.key)).toEqual(['a', 'b']);
    });

    it('without the bridge or features: no suggestions and no assign', () => {
        const groups = placeGroups(p, env({ bridgeUp: false }), names);
        expect(groups.map(g => g.key)).toEqual(['unassigned', 'all']);
        expect(groups[0].rows[0].assign).toBe(false);
        expect(groups[1].rows[0].actions).toEqual(['openInPlaces']);
    });

    it('an older research: all places by events, no meta', () => {
        const old = payload({ places: { a: { events: ['x'] }, b: { events: ['x', 'y'], state: 'pending' } } });
        const groups = placeGroups(old, env(), names);
        expect(groups.map(g => g.key)).toEqual(['all']);
        expect(groups[0].rows.map(r => r.key)).toEqual(['b', 'a']);
        expect(groups[0].rows[0].meta).toBe('');
        expect(groups[0].rows[0].actions).toEqual([]);
    });

    it('a region with two periods shows both (1029)', () => {
        const raw = {
            state: { on: true, search: 'done' }, events: [], hidden: [],
            regions: { bohemia: region('bohemia', { state: 'done' }), czechoslovakia: region('czechoslovakia', { state: 'done' }) },
            places: {
                lhota: {
                    events: [], persons: 3, regions: [
                        { id: 'bohemia' }, { id: 'czechoslovakia', from: 1918, to: 1938 },
                        { id: 'czechoslovakia', from: 1945, to: 1992 }, { id: 'czechoslovakia', from: 1918, to: 1938 },
                    ],
                },
            },
        };
        const parsed = parseHistoryPayload(raw, '2026-10-29T00:00:00Z')!;
        expect(parsed.places.lhota.regions).toEqual([
            { id: 'bohemia' }, { id: 'czechoslovakia', from: 1918, to: 1938 }, { id: 'czechoslovakia', from: 1945, to: 1992 },
        ]);
        const row = placeGroups(parsed, env(), names).find(g => g.key === 'all')!.rows[0];
        expect(row.meta).toBe('Bohemia · Czechoslovakia 1918–1938 · Czechoslovakia 1945–1992 · 3 people');
        expect(mapResultText(parsed, ['czechoslovakia', 'czechoslovakia'], 'en')).not.toMatch(/Czechoslovakia.*Czechoslovakia/);
    });

    it('a region waiting and the place\'s own history done: both said (1029)', () => {
        const q = payload({
            regions: { bohemia: region('bohemia', { state: 'queued' }) },
            events: [ev('k1', { scope: 'place', region: undefined, place: { key: 'kounice' } })],
            places: { kounice: { events: ['k1'], state: 'pending', regions: [{ id: 'bohemia' }], persons: 2, history: 'done' } },
        });
        const row = placeGroups(q, env(), names).find(g => g.key === 'all')!.rows[0];
        expect(row.state).toBe('Region waits for the search · Local history: done · 1');
        expect(row.tone).toBe('accent');
    });

    it('streets follow their municipality when the tree has it on its own (1029)', () => {
        const q = payload({
            regions: { bohemia: region('bohemia', { state: 'done' }) },
            places: {
                'kounice, pivovarská': { events: [], regions: [{ id: 'bohemia' }], persons: 1 },
                lhota: { events: [], regions: [{ id: 'bohemia' }], persons: 5 },
                kounice: { events: [], regions: [{ id: 'bohemia' }], persons: 3 },
                'kounice, havlíčkova': { events: [], regions: [{ id: 'bohemia' }], persons: 2 },
                // No "Hora" on its own: stays where it is.
                'hora, dolní': { events: [], regions: [{ id: 'bohemia' }], persons: 4 },
                // Only a name that starts the same: not a street of it.
                kounicky: { events: [], regions: [{ id: 'bohemia' }], persons: 1 },
            },
        });
        const rows = placeGroups(q, env(), names).find(g => g.key === 'all')!.rows;
        expect(rows.map(r => r.key)).toEqual(['lhota', 'hora, dolní', 'kounice', 'kounice, havlíčkova', 'kounice, pivovarská', 'kounicky']);
        expect(rows[3].under).toEqual({ key: 'kounice', name: 'havlíčkova' });
        expect(rows[4].under).toEqual({ key: 'kounice', name: 'pivovarská' });
        expect(rows[1].under).toBeUndefined();
        expect(rows[2].under).toBeUndefined();
        const alpha = placeGroups(q, env(), names, 'alpha').find(g => g.key === 'all')!.rows.map(r => r.key);
        expect(alpha).toEqual(['hora, dolní', 'kounice', 'kounice, havlíčkova', 'kounice, pivovarská', 'kounicky', 'lhota']);
    });

    it('caps suggestions at five', () => {
        const places: HistoryPayload['places'] = {};
        const suggest: string[] = [];
        for (let i = 0; i < 8; i++) { places[`p${i}`] = { events: [], id: `L${i}` }; suggest.push(`L${i}`); }
        const groups = placeGroups(payload({ regions: {}, places, suggest }), env(), names);
        expect(groups.find(g => g.key === 'suggest')!.rows).toHaveLength(5);
    });
});

describe('hidden and deleted', () => {
    it('hidden rows newest first with scope; region rows; queued ones marked', () => {
        const p = payload({
            regions: { bohemia: region('bohemia', { events: 7 }) },
            events: [ev('a'), ev('b'), ev('c')],
            hidden: [
                { event: 'a', place: 'lhota', at: '2026-10-01T00:00:00Z' },
                { event: 'b', person: 'R1', at: '2026-10-03T00:00:00Z' },
                { region: 'bohemia', at: '2026-10-02T00:00:00Z' },
            ],
        });
        const rows = hiddenRows(p, env({ queue: [{ event: 'c', tree: true, at: '2026-10-04T00:00:00Z' }] }), names);
        expect(rows.map(r => r.hide.event ?? r.hide.region)).toEqual(['c', 'b', 'bohemia', 'a']);
        expect(rows[0].meta).toContain('in the whole tree');
        expect(rows[0].meta).toContain('so far only in this browser');
        expect(rows[1].meta).toContain('Jan Lhoták');
        expect(rows[2].region).toBe(true);
        expect(rows[2].meta).toContain('7 events');
        expect(rows[3].meta).toBe('Bohemia · for Lhota');
    });

    it('deleted rows: text when the research kept it, else the id', () => {
        const p = payload({
            deleted: [
                { event: 'x1', scope: 'region', at: '2026-10-01T00:00:00Z', from: 1866, text: { en: 'War' }, region: { id: 'bohemia', name: { en: 'Bohemia' } } },
                { event: 'x2', scope: 'local', at: '2026-10-05T00:00:00Z' },
            ],
        });
        const rows = deletedRows(p, env(), names);
        expect(rows.map(r => r.event)).toEqual(['x2', 'x1']);
        expect(rows[0].text).toBe('x2');
        expect(rows[1].year).toBe('1866');
        expect(rows[1].meta).toMatch(/^Bohemia · .*2026-10-01/);
    });

    it('deleted rows: a local finding with its place (R4 names it by the key)', () => {
        const p = payload({
            deleted: [{ event: 'L0003', scope: 'local', at: '2026-10-05T00:00:00Z', from: 1842, text: { en: 'A fire' }, place: { key: 'Lhota' } }],
        });
        const [row] = deletedRows(p, env(), names);
        expect(row.year).toBe('1842');
        expect(row.text).toBe('A fire');
        expect(row.meta).toMatch(/^From research sources · Lhota · .*in this tree only$/);
    });
});

describe('header', () => {
    const p = payload({ regions: { bohemia: region('bohemia', { state: 'running' }), moravia: region('moravia', { state: 'queued', order: 1 }) } });

    it('no bridge: the copy and the note', () => {
        const h = manageHeader(p, env({ bridgeUp: false }));
        expect(h.text).toContain('09:00');
        expect(h.notes.length).toBe(1);
        expect(h.pace).toBe('');
    });

    it('searching names the running region and the pace', () => {
        const h = manageHeader(p, env({ pace: 'rare' }));
        expect(h.text).toContain('Bohemia');
        expect(h.pace).not.toBe('');
    });

    it('queued, done, mapping, off, waiting, truncated', () => {
        const queued = payload({ regions: { moravia: region('moravia', { state: 'queued', order: 1 }) } });
        expect(manageHeader(queued, env()).text).toContain('Moravia');
        const done = payload({ regions: { moravia: region('moravia', { state: 'done' }) }, state: { on: true, search: 'done', truncated: true } });
        const hd = manageHeader(done, env());
        expect(hd.notes).toHaveLength(1);
        // P3: the matching session says so while the search stays "running".
        const mapping = payload({ regions: { moravia: region('moravia', { state: 'queued', order: 1 }) }, state: { on: true, search: 'running', mapping: { mapped: 3, mappable: 10 } } });
        expect(manageHeader(mapping, env()).text).toMatch(/3.*10/);
        const off = manageHeader(p, env({ searchOn: false, canLinkOn: true }));
        expect(off.link).toBe('enable');
        expect(manageHeader(p, env({ searchOn: false })).link).toBeNull();
        expect(manageHeader(p, env({ treeState: 'archive' })).text).not.toContain('Bohemia');
    });

    it('the running sentence counts waiting places without skipped ones (state.pending without R1 places)', () => {
        const regions = { bohemia: region('bohemia', { state: 'running' }), moravia: region('moravia', { state: 'skipped' }), silesia: region('silesia', { state: 'queued' }) };
        const q = payload({
            regions, state: { on: true, search: 'running', pending: 9 },
            places: {
                a: { events: [], state: 'pending', regions: [{ id: 'silesia' }], persons: 2 },
                b: { events: [], state: 'pending', regions: [{ id: 'moravia' }], persons: 1 },
                c: { events: [], state: 'pending', regions: [{ id: 'moravia', to: 1850 }, { id: 'silesia', from: 1850 }], persons: 1 },
                d: { events: [], state: 'pending', persons: 1 },
                e: { events: [], state: 'pending', skip: true, regions: [{ id: 'silesia' }], persons: 1 },
                f: { events: [], regions: [{ id: 'bohemia' }], persons: 4 },
            },
        });
        expect(waitingPlaces(q)).toBe(3);
        expect(manageHeader(q, env()).text).toContain('3 places');
        const old = payload({ regions, state: { on: true, search: 'running', pending: 9 }, places: { a: { events: [], state: 'pending' } } });
        expect(waitingPlaces(old)).toBe(9);
    });

    it('summaries count regions, places, events and hidden', () => {
        const q = payload({ regions: { a: region('a') }, events: [ev('x')], places: { lhota: { events: ['x'] } }, hidden: [{ event: 'x', place: 'lhota' }] });
        const h = manageHeader(q, env());
        expect(h.summary).toMatch(/1 region/);
        expect(manageSummaries(q, 'en').settings).toMatch(/1/);
    });
});

describe('two searches apart (experiments.split, spec 020 K8, 1029)', () => {
    const regions = { bohemia: region('bohemia', { state: 'running' }), moravia: region('moravia', { state: 'queued', order: 1 }) };
    const p = payload({
        regions, suggest: ['L0002'],
        places: { kounice: { events: [], id: 'L0002', regions: [{ id: 'bohemia' }], persons: 9, history: 'none' } },
    });
    const split = (r: boolean, pl: boolean, o: Partial<ManageEnv> = {}) =>
        env({ split: { regions: r, places: pl }, canOff: true, canLinkOn: true, ...o });

    it('the header says both: off through the bridge, on by the link', () => {
        const h = manageHeader(p, split(true, false));
        expect(h.switches.map(s => [s.key, s.text, s.action])).toEqual([
            ['regions', 'Regional history: on', 'off'],
            ['places', 'Local history: off', 'linkOn'],
        ]);
        expect(h.text).toContain('Bohemia');
        // Without experiments.off the bridge cannot switch off: the research's link does; without the link nothing.
        expect(manageHeader(p, split(true, false, { canOff: false })).switches[0].action).toBe('off');
        expect(manageHeader(p, split(true, false, { canOff: false, canLinkOn: false })).switches.map(s => s.action)).toEqual([null, null]);
        const cs = manageHeader(p, split(false, true, { lang: 'cs' })).switches.map(s => s.text);
        expect(cs).toEqual(['Dějiny regionů: vypnuto', 'Dějiny míst: zapnuto']);
        const de = manageHeader(p, split(true, true, { lang: 'de' })).switches.map(s => s.text);
        expect(de).toEqual(['Regionalgeschichte: ein', 'Ortsgeschichte: ein']);
    });

    it('regions off: the header says so, no region first; places off: no local history offered', () => {
        const h = manageHeader(p, split(false, true));
        expect(h.text).toBe('Regional history is not searched for this tree. Events already found stay.');
        expect(h.link).toBeNull();
        const firstOf = (e: ManageEnv) => regionGroups(p, e, names).flatMap(g => g.rows).filter(r => r.actions.includes('first')).map(r => r.key);
        expect(firstOf(split(true, true))).toEqual(['moravia']);
        expect(firstOf(split(false, true))).toEqual([]);
        expect(placeGroups(p, split(true, true), names).map(g => g.key)).toEqual(['suggest', 'all']);
        const off = placeGroups(p, split(true, false), names);
        expect(off.map(g => g.key)).toEqual(['all']);
        expect(off[0].rows[0].actions).not.toContain('placeFind');
        expect(placeGroups(p, split(false, true), names)[1].rows[0].actions).toContain('placeFind');
    });

    it('both off: the old sentence without its own link (each switch has one)', () => {
        const h = manageHeader(p, split(false, false));
        expect(h.text).toBe('The research is not looking for history. Events already found stay.');
        expect(h.link).toBeNull();
        expect(h.switches.map(s => s.action)).toEqual(['linkOn', 'linkOn']);
    });

    it('without split (an older research), no bridge or an archive: no switches, as before', () => {
        expect(manageHeader(p, env()).switches).toEqual([]);
        expect(manageHeader(p, env({ searchOn: false, canLinkOn: true })).link).toBe('enable');
        expect(manageHeader(p, split(true, false, { bridgeUp: false })).switches).toEqual([]);
        expect(manageHeader(p, split(true, false, { treeState: 'archive' })).switches).toEqual([]);
    });
});

describe('labels', () => {
    it('gaps', () => {
        expect(gapsLabel([{ from: 1870, to: 1913 }, { from: 1920, to: 1920 }])).toBe('1870–1913, 1920');
    });
});

describe('detail', () => {
    const p = payload({
        lang: 'cs',
        events: [
            ev('w1', { from: 1866 }),
            ev('e1', { from: 1873, kind: 'economy' }),
            ev('s1', { from: 1914, to: 1918, kind: 'state', text: { de: 'Krieg' } }),
            ev('m1', { from: 1866, region: { id: 'moravia' } }),
            ev('l1', { from: 1880, scope: 'local', region: undefined, kind: 'disaster', local: { source: 'S1', cite: 'Matrika Lhota' } }),
            ev('l2', { from: 1890, scope: 'local', region: undefined, kind: 'epidemic', local: { source: 'S1', cite: 'Kronika' } }),
            ev('p1', { from: 1762, scope: 'place', region: undefined, place: { key: 'lhota', name: { en: 'Lhota' } } }),
        ],
        places: {
            lhota: { events: ['w1', 'e1', 'l1', 'p1'] },
            kounice: { events: ['w1', 'l1', 'l2'] },
        },
        hidden: [
            { event: 'e1', place: 'lhota', at: '2026-10-27T10:00:00Z' },
            { event: 's1', tree: true, at: '2026-10-27T11:00:00Z' },
        ],
    });

    it('takes a region, the local findings or a place by key', () => {
        expect(detailOwner('bohemia')).toEqual({ kind: 'region', id: 'bohemia' });
        expect(detailOwner('local')).toEqual({ kind: 'local', id: '' });
        expect(detailOwner('place:lhota')).toEqual({ kind: 'place', id: 'lhota' });
        expect(detailEvents(p, env(), names, 'bohemia').map(r => r.ev.id)).toEqual(['w1', 'e1', 's1']);
        expect(detailEvents(p, env(), names, 'local').map(r => r.ev.id)).toEqual(['l1', 'l2']);
        expect(detailEvents(p, env(), names, 'place:lhota').map(r => r.ev.id)).toEqual(['p1']);
    });

    it('says how an event is hidden; a range year; the text of another language', () => {
        const rows = detailEvents(p, env(), names, 'bohemia');
        expect(rows[0]).toMatchObject({ hide: 'none', hideNote: '', year: '1866' });
        expect(rows[1]).toMatchObject({ hide: 'partial', hideNote: 'Hidden at Lhota' });
        expect(rows[2]).toMatchObject({ hide: 'tree', hideNote: 'Hidden in the whole tree', year: '1914–1918', text: 'Krieg', textLang: 'de' });
        // A queued hiding for a person, and the whole region hidden.
        const q = env({ queue: [{ event: 'w1', personId: 'x1', at: '2026-10-28T08:00:00Z' }] });
        const r2 = detailEvents(p, { ...q, }, { ...names, person: () => 'Jan Lhoták' }, 'bohemia');
        expect(r2[0].hideNote).toBe('Hidden for Jan Lhoták only · so far only in this browser');
        const all = detailEvents(payload({ ...p, hidden: [{ region: 'bohemia' }] }), env(), names, 'bohemia');
        expect(all.map(r => r.hide)).toEqual(['region', 'region', 'region']);
        expect(all[0].hideNote).toBe('All of the region hidden');
    });

    it('names the places of a local event', () => {
        const rows = detailEvents(p, env(), names, 'local');
        expect(rows[0]).toMatchObject({ place: 'Lhota and Kounice', placeKeys: ['lhota', 'kounice'] });
        expect(rows[1].place).toBe('Kounice');
    });

    it('filters by kinds, places, period, text and hidden only, counting each chip without its own part', () => {
        const rows = detailEvents(p, env(), names, 'bohemia');
        const f = emptyDetailFilter();
        expect(detailFilterActive(f)).toBe(false);
        expect(detailFacets(rows, f, 'kinds', names)).toEqual([
            { key: 'war', label: 'war', count: 1 }, { key: 'state', label: 'state', count: 1 }, { key: 'economy', label: 'economy', count: 1 },
        ]);
        f.kinds = ['war', 'economy'];
        expect(filterDetailEvents(rows, f).map(r => r.ev.id)).toEqual(['w1', 'e1']);
        expect(detailFacets(rows, f, 'kinds', names).map(c => c.count)).toEqual([1, 1, 1]);
        f.from = 1870; f.to = 1879;
        expect(filterDetailEvents(rows, f).map(r => r.ev.id)).toEqual(['e1']);
        // An event of more years falls in each period it overlaps.
        expect(filterDetailEvents(rows, { ...emptyDetailFilter(), from: 1916, to: 1920 }).map(r => r.ev.id)).toEqual(['s1']);
        expect(filterDetailEvents(rows, { ...emptyDetailFilter(), query: 'krieg' }).map(r => r.ev.id)).toEqual(['s1']);
        expect(filterDetailEvents(rows, { ...emptyDetailFilter(), hiddenOnly: true }).map(r => r.ev.id)).toEqual(['e1', 's1']);
        const local = detailEvents(p, env(), names, 'local');
        expect(detailFacets(local, emptyDetailFilter(), 'places', names)).toEqual([
            { key: 'kounice', label: 'Kounice', count: 2 }, { key: 'lhota', label: 'Lhota', count: 1 },
        ]);
        expect(filterDetailEvents(local, { ...emptyDetailFilter(), places: ['lhota'] }).map(r => r.ev.id)).toEqual(['l1']);
        // The search covers the citation too.
        expect(filterDetailEvents(local, { ...emptyDetailFilter(), query: 'kronika' }).map(r => r.ev.id)).toEqual(['l2']);
    });

    it('groups by centuries; above 40 events only the largest century is unfolded', () => {
        const rows = detailEvents(p, env(), names, 'bohemia');
        expect(detailCenturies(rows)).toEqual([18, 19]);
        const g = centuryGroups(rows);
        expect(g.map(x => [x.label, x.rows.length, x.open])).toEqual([['1800–1899', 2, true], ['1900–1999', 1, true]]);
        const many = payload({ events: [
            ...Array.from({ length: 30 }, (_, i) => ev(`a${i}`, { from: 1800 + i })),
            ...Array.from({ length: 12 }, (_, i) => ev(`b${i}`, { from: 1700 + i })),
        ] });
        const big = centuryGroups(detailEvents(many, env(), names, 'bohemia'));
        expect(big.map(x => [x.century, x.open])).toEqual([[17, false], [18, true]]);
        expect(centuryGroups(detailEvents(many, env(), names, 'bohemia'), new Set([17, 18])).map(x => x.open)).toEqual([true, false]);
    });
});

describe('who sees an event', () => {
    const person = (id: string, o: Partial<Person> = {}): Person => ({
        id: id as PersonId, firstName: id, lastName: 'Lhoták', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...o,
    } as Person);
    const data: StromData = {
        persons: Object.fromEntries([
            person('jan', { birthDate: '1840', birthPlace: 'Lhota', deathDate: '1900', deathPlace: 'Lhota' }),
            person('eva', { birthDate: '1850', birthPlace: 'Lhota', deathDate: '1910', deathPlace: 'Lhota' }),
            person('max', { birthDate: '1845', birthPlace: 'Kounice', deathDate: '1899', deathPlace: 'Kounice' }),
            person('old', { birthDate: '1700', birthPlace: 'Lhota', deathDate: '1760', deathPlace: 'Lhota' }),
        ].map(x => [x.id, x])) as StromData['persons'],
        partnerships: {} as StromData['partnerships'],
    };
    const p = payload({
        events: [ev('w1', { from: 1866 }), ev('w2', { from: 1870 })],
        places: { Lhota: { events: ['w1', 'w2'] }, Kounice: { events: ['w1'] } },
        hidden: [{ event: 'w2', place: 'Lhota' }],
    });

    it('counts the persons whose card shows it, as the card layer does', () => {
        const a = historyAudience(data, p, 'en');
        expect(a.get('w1')!.sees.map(e => e.personId).sort()).toEqual(['eva', 'jan', 'max']);
        expect(a.get('w2')!.sees).toEqual([]);
        expect(a.get('w2')!.hidden.map(e => e.personId).sort()).toEqual(['eva', 'jan']);
        expect(audiencePlaces(a.get('w1'), { ...names, place: k => k })).toEqual([
            { key: 'Lhota', name: 'Lhota', persons: 2 }, { key: 'Kounice', name: 'Kounice', persons: 1 },
        ]);
        // A queued hiding counts at once.
        const q = historyAudience(data, p, 'en', { queue: [{ event: 'w1', place: 'Kounice', at: '2026-10-28T08:00:00Z' }] });
        expect(q.get('w1')!.sees.map(e => e.personId).sort()).toEqual(['eva', 'jan']);
    });
});

describe('region of a place by hand (R5)', () => {
    const regions = {
        empire: region('empire', { state: 'covered', covered: ['bohemia', 'moravia'] }),
        bohemia: region('bohemia', { state: 'done', places: 87 }),
        moravia: region('moravia', { state: 'running', places: 12 }),
        silesia: region('silesia', { state: 'queued', places: 4 }),
        bavaria: region('bavaria', { state: 'skipped', places: 2 }),
    };
    const p = payload({
        regions,
        places: {
            lhotka: { events: [], state: 'unlocated', why: 'several places of that name', persons: 3 },
            hora: { events: [], regions: [{ id: 'moravia', to: 1850 }, { id: 'bohemia', from: 1850 }], manual: true, persons: 1 },
            redo: { events: [], state: 'pending', redo: true, note: 'Lhotka near Benešov', persons: 2 },
            done: { events: ['x'], regions: [{ id: 'bohemia' }], persons: 4 },
        },
    });

    it('lists a state with its lands indented, the chosen regions and the why', () => {
        const pk = regionPicker(p, 'en', names, 'lhotka')!;
        expect(pk.list.map(r => [r.id, r.indent])).toEqual([
            ['empire', false], ['bohemia', true], ['moravia', true], ['silesia', false], ['bavaria', false]]);
        expect(pk.list[0].meta).toBe('state');
        expect(pk.list[1].meta).toBe('87 places');
        expect(pk.list[1].parent).toBe('Empire');
        expect(pk.why).toBe('Research: several places of that name · 3 people');
        expect(pk.chosen).toEqual([]);
        const hora = regionPicker(p, 'en', names, 'hora')!;
        expect(hora.chosen).toEqual([{ id: 'moravia', from: '', to: '1850' }, { id: 'bohemia', from: '1850', to: '' }]);
        expect(hora.why).toContain('Moravia until 1850 · Bohemia from 1850');
        expect(regionPicker(payload({ places: { a: { events: [] } } }), 'en', names, 'a')).toBeNull();
    });

    it('checks the years: 100–9999, from ≤ to, no overlap (touching ends and a state with its land are fine)', () => {
        expect(pickerYear('')).toBeUndefined();
        expect(pickerYear('99')).toBeNull();
        expect(pickerYear('1850')).toBe(1850);
        expect(pickerYear('18a0')).toBeNull();
        expect(pickerCheck(p, [{ id: 'moravia', from: '', to: '1850' }, { id: 'bohemia', from: '1850', to: '' }]).ok).toBe(true);
        expect(pickerCheck(p, [{ id: 'moravia', from: '', to: '1860' }, { id: 'bohemia', from: '1850', to: '' }]).rows).toEqual(['overlap', 'overlap']);
        expect(pickerCheck(p, [{ id: 'moravia', from: '', to: '' }, { id: 'silesia', from: '', to: '' }]).ok).toBe(false);
        expect(pickerCheck(p, [{ id: 'empire', from: '', to: '' }, { id: 'bohemia', from: '', to: '' }]).ok).toBe(true);
        expect(pickerCheck(p, [{ id: 'bohemia', from: '1900', to: '1850' }]).rows).toEqual(['years']);
        expect(pickerCheck(p, [{ id: 'bohemia', from: '50', to: '' }]).rows).toEqual(['years']);
        expect(pickerCheck(p, []).ok).toBe(false);
        expect(pickerBody([{ id: 'moravia', from: '', to: '1850' }, { id: 'bohemia', from: '1850', to: '' }]))
            .toEqual([{ id: 'moravia', to: 1850 }, { id: 'bohemia', from: 1850 }]);
    });

    it('says what happens by the regions\' states', () => {
        expect(mapResultText(p, ['bohemia'], 'en')).toMatch(/^The history of Bohemia is done/);
        expect(mapResultText(p, ['moravia', 'bohemia'], 'en')).toMatch(/Moravia right now.*Bohemia is done/);
        expect(mapResultText(p, ['silesia'], 'cs')).toBe('Region silesia je ve frontě, místo se do ní přidá.');
        expect(mapResultText(p, ['bavaria'], 'en')).toContain('not searched');
    });

    it('place rows: by hand with the way back, redo with its note and no way back', () => {
        const groups = placeGroups(p, env(), names);
        const unassigned = groups.find(g => g.key === 'unassigned')!.rows;
        expect(unassigned.map(r => r.key)).toEqual(['lhotka', 'redo']);
        const redo = unassigned[1];
        expect(redo.meta).toBe('The research will decide again · 2 people');
        expect(redo.why).toBe('Note for the research: “Lhotka near Benešov”');
        expect(redo.link).toBeNull();
        expect(redo.assign).toBe(false);
        const all = groups.find(g => g.key === 'all')!.rows;
        const hora = all.find(r => r.key === 'hora')!;
        expect(hora.meta).toContain('(manual)');
        expect(hora.link).toBe('auto');
        expect(hora.why).toMatch(/Moravia right now/);
        expect(all.find(r => r.key === 'redo')!.link).toBeNull();
        expect(all.find(r => r.key === 'done')!.link).toBeNull();
        expect(placeGroups(p, env({ features: ['history.events'] }), names).find(g => g.key === 'all')!.rows.find(r => r.key === 'hora')!.link).toBeNull();
    });

    it('the History line in Places', () => {
        expect(placesHistoryLine(p, env(), 'done')).toEqual({ text: 'Bohemia · done · 1 event', action: 'manage', legacy: false });
        expect(placesHistoryLine(p, env(), 'lhotka')).toEqual({ text: 'unassigned: several places of that name', action: 'assign', legacy: false });
        expect(placesHistoryLine(p, env({ features: [] }), 'lhotka')!.action).toBe('manage');
        expect(placesHistoryLine(p, env(), 'hora')!.text).toBe('Moravia until 1850 · Bohemia from 1850 (manual) · being searched · 0 events');
        expect(placesHistoryLine(p, env(), 'nowhere')).toBeNull();
        const old = payload({ places: { a: { events: ['x', 'y'] } } });
        expect(placesHistoryLine(old, env(), 'a')).toEqual({ text: 'History: 2 events', action: 'manage', legacy: true });
    });
});
