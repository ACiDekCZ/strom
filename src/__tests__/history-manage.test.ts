/**
 * History of places manager (pure model): region groups and their order,
 * regions derived for an older research, parents from `covered`, the Places
 * view, Hidden and Deleted rows, the header and the search without diacritics.
 * Fictional data (Lhota, Horní Kounice).
 */

import { describe, it, expect } from 'vitest';
import {
    foldSearch, matchesQuery, manageRegions, regionParents, regionGroups, placeGroups, hiddenRows,
    deletedRows, manageHeader, manageCan, gapsLabel, manageSummaries, type ManageEnv, type ManageNames,
} from '../history-manage.js';
import type { HistoryPayload, HistoryEvent, HistoryRegion } from '../history.js';

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
        const mapping = payload({ regions: {}, state: { on: true, search: 'mapping', mapped: 3, mappable: 10 } });
        expect(manageHeader(mapping, env()).text).toMatch(/3.*10/);
        const off = manageHeader(p, env({ searchOn: false, canLinkOn: true }));
        expect(off.link).toBe('enable');
        expect(manageHeader(p, env({ searchOn: false })).link).toBeNull();
        expect(manageHeader(p, env({ treeState: 'archive' })).text).not.toContain('Bohemia');
    });

    it('summaries count regions, places, events and hidden', () => {
        const q = payload({ regions: { a: region('a') }, events: [ev('x')], places: { lhota: { events: ['x'] } }, hidden: [{ event: 'x', place: 'lhota' }] });
        const h = manageHeader(q, env());
        expect(h.summary).toMatch(/1 region/);
        expect(manageSummaries(q, 'en').settings).toMatch(/1/);
    });
});

describe('labels', () => {
    it('gaps', () => {
        expect(gapsLabel([{ from: 1870, to: 1913 }, { from: 1920, to: 1920 }])).toBe('1870–1913, 1920');
    });
});
