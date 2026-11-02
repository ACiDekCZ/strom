import { describe, it, expect } from 'vitest';
import type { StromData, PlaceGeo, PlaceRecord } from '../types.js';
import {
    placeIdentity, placeIdentities, identityKey, identityHead, placeStateMatches, placeStateSummary, placeSummaryChips,
    filterPlaceGroup, placeStateRank, sortPlacesByState, bulkCounts, bulkLookPreview, bulkCheckPreview,
    placeStateBadge, placeOriginBadge, placeStateText, formatPlaceDate, type PlaceIdentity,
} from '../place-identity.js';
import { sanitizeBridgePlaces } from '../places-bridge.js';
import { placeKey, TOWN_POINT_PREFIX, type PlaceUsage } from '../places.js';
import type { CheckFinding } from '../place-check.js';
import type { LiveWaiting } from '../research-link.js';

const k = placeKey;

function tree(places: Record<string, PlaceGeo>, records: Record<string, PlaceRecord> = {}, refs: Record<string, string> = {}): StromData {
    return { persons: {}, partnerships: {}, places, placeRecords: records, placeRefs: refs } as unknown as StromData;
}

const at = { lat: 49.61, lon: 15.23 };
const elsewhere = { lat: 50.2, lon: 14.1 };

describe('placeIdentity', () => {
    it('reads the app’s own locations: none, map, hand, town', () => {
        const data = tree({
            [k('Lhota')]: { ...at },
            [k('Jinov')]: { ...at, origin: 'hand', at: '2026-10-01' },
            [k('Lhota 16')]: { ...at, byTown: 'Lhota' },
        });
        expect(placeIdentity(k('Lhotov'), { data })).toEqual({ state: 'none', located: false });
        expect(placeIdentity(k('Lhota'), { data })).toMatchObject({ state: 'placed', origin: 'map', located: true });
        expect(placeIdentity(k('Jinov'), { data })).toMatchObject({ state: 'placed', origin: 'hand', at: '2026-10-01' });
        expect(placeIdentity(k('Lhota 16'), { data })).toMatchObject({ state: 'town', town: 'Lhota', origin: 'map' });
    });

    it('reads the tree’s research records: identified, verified, unlocated, the record’s names', () => {
        const records: Record<string, PlaceRecord> = {
            L0012: {
                id: 'L0012', names: [{ name: 'Horní Lhota' }, { name: 'Ober Lhota', lang: 'de', to: 1945 }],
                jurisdictions: [{ kind: 'district', name: 'Lhotov' }], coords: at, by: 'research', at: '2026-11-03', why: 'Fara Jinov.',
            },
            L0013: { id: 'L0013', names: [{ name: 'Lhotínek' }], unlocated: 'zaniklá ves', needs: 'zápis z fary' },
            L0014: { id: 'L0014', names: [{ name: 'Jinov' }], coords: at, by: 'research', verified: '2026-11-02' },
        };
        const data = tree({}, records, { [k('Horní Lhota')]: 'L0012', [k('Lhotínek')]: 'L0013', [k('Jinov')]: 'L0014' });
        const l12 = placeIdentity(k('Horní Lhota'), { data });
        expect(l12).toMatchObject({
            state: 'placed', origin: 'research', at: '2026-11-03', located: true, record: 'L0012',
            today: { name: 'Horní Lhota', district: 'Lhotov' }, former: [{ name: 'Ober Lhota', lang: 'de', to: 1945 }], why: 'Fara Jinov.',
        });
        expect(placeIdentity(k('Lhotínek'), { data })).toMatchObject({ state: 'undet', why: 'zaniklá ves', decide: 'zápis z fary', located: false });
        expect(placeIdentity(k('Jinov'), { data })).toMatchObject({ state: 'verified', at: '2026-11-02', origin: 'research' });
    });

    it('lets the app’s own origin win when the location is the same, and its location when it differs', () => {
        const rec: PlaceRecord = { id: 'L0012', names: [{ name: 'Lhota' }], coords: at, by: 'person', at: '2026-11-03' };
        const refs = { [k('Lhota')]: 'L0012' };
        // The app's geocoder location came back to the research as "person": it stays "map".
        expect(placeIdentity(k('Lhota'), { data: tree({ [k('Lhota')]: { lat: at.lat + 0.0003, lon: at.lon, origin: 'map' } }, { L0012: rec }, refs) }))
            .toMatchObject({ state: 'placed', origin: 'map' });
        expect(placeIdentity(k('Lhota'), { data: tree({ [k('Lhota')]: { ...at, origin: 'hand' } }, { L0012: rec }, refs) }))
            .toMatchObject({ state: 'placed', origin: 'hand' });
        // Without a local origin the record says who: person → hand, adopted → other.
        expect(placeIdentity(k('Lhota'), { data: tree({ [k('Lhota')]: { ...at } }, { L0012: rec }, refs) })).toMatchObject({ origin: 'hand' });
        expect(placeIdentity(k('Lhota'), { data: tree({}, { L0012: { ...rec, by: 'adopted' } }, refs) })).toMatchObject({ origin: 'other' });
        // Moved in the app since: the app's location and origin.
        expect(placeIdentity(k('Lhota'), { data: tree({ [k('Lhota')]: { ...elsewhere, origin: 'hand' } }, { L0012: rec }, refs) }))
            .toMatchObject({ state: 'placed', origin: 'hand' });
        // A confirmation does not hold for a location moved since.
        expect(placeIdentity(k('Lhota'), { data: tree({ [k('Lhota')]: { ...elsewhere } }, { L0012: { ...rec, verified: '2026-11-04' } }, refs) }).state)
            .toBe('placed');
    });

    it('keeps a place placed by hand over "not identified"', () => {
        const rec: PlaceRecord = { id: 'L0013', names: [{ name: 'Lhotínek' }], unlocated: '' };
        const refs = { [k('Lhotínek')]: 'L0013' };
        expect(placeIdentity(k('Lhotínek'), { data: tree({ [k('Lhotínek')]: { ...at, origin: 'hand' } }, { L0013: rec }, refs) }).state).toBe('placed');
        expect(placeIdentity(k('Lhotínek'), { data: tree({ [k('Lhotínek')]: { ...at } }, { L0013: rec }, refs) }).state).toBe('undet');
    });

    it('takes the live bridge first: running > queued > confirm, forms without a record', () => {
        const live = sanitizeBridgePlaces({
            places: {
                L0012: { name: 'Horní Lhota', state: 'running' },
                L0014: { name: 'Lhotov', state: 'proposed', waiting: 'L0014' },
                L0015: { name: 'Jinov', state: 'conflict', current: at },
            },
            forms: { 'Horní Lhota': { place: 'L0012' }, Lhotov: { place: 'L0014' }, Jinov: { place: 'L0015' }, 'Łotów': { state: 'queued' } },
        })!;
        const data = tree({ [k('Jinov')]: { ...at }, [k('Łotów')]: { ...at } });
        const waiting = [{ id: 'L0015', kind: 'place', place: 'L0015', candidates: [{}, {}] }] as unknown as LiveWaiting[];
        expect(placeIdentity(k('Horní Lhota'), { data, live }).state).toBe('running');
        expect(placeIdentity(k('Lhotov'), { data, live })).toMatchObject({ state: 'confirm', waitingId: 'L0014', record: 'L0014' });
        expect(placeIdentity(k('Jinov'), { data, live, waiting })).toMatchObject({ state: 'confirm', candidates: 2, waitingId: 'L0015', located: true });
        // A located place queued for a check: still on the map.
        expect(placeIdentity(k('Łotów'), { data, live })).toMatchObject({ state: 'queued', located: true });
    });

    it('shows the app check over a placed location', () => {
        const data = tree({ [k('Lhota')]: { ...at, origin: 'hand' } });
        const checks = new Map<string, CheckFinding[]>([[k('Lhota'), [{ kind: 'label', type: 'street' }]]]);
        expect(placeIdentity(k('Lhota'), { data, checks })).toMatchObject({ state: 'check', origin: 'hand', checks: [{ kind: 'label' }], located: true });
        expect(placeIdentities([k('Lhota'), k('Jinov')], { data, checks }).get(k('Jinov'))!.state).toBe('none');
    });
});

describe('grouping', () => {
    it('groups by record, alias, town, else the place itself', () => {
        const data = tree({}, { L0012: { id: 'L0012', names: [{ name: 'Horní Lhota' }] } }, { [k('H. Lhota')]: 'L0012', [k('Lhota č. 9')]: 'L0999' });
        const live = sanitizeBridgePlaces({ places: { L0012: { name: 'Horní Lhota' } }, forms: { 'Ober Lhota': { place: 'L0012' } } })!;
        expect(identityKey(k('H. Lhota'), { data })).toBe('L0012');
        expect(identityKey(k('Ober Lhota'), { data, live })).toBe('L0012');
        expect(identityKey(k('Ober Lhota'), { data })).toBe(k('Ober Lhota'));
        expect(identityKey(k('Lhotínek'), { data, aliases: new Map([[k('Lhotínek'), k('Lhotov')]]) })).toBe(k('Lhotov'));
        expect(identityKey(k('Lhota 16'), { data })).toBe(TOWN_POINT_PREFIX + k('Lhota'));
        expect(identityKey(k('Jinov'), { data })).toBe(k('Jinov'));
        const usage = (display: string, count: number) => ({ key: k(display), usage: { display, count } as PlaceUsage });
        expect(identityHead('L0012', [usage('H. Lhota', 5)], { data })).toBe('Horní Lhota');
        expect(identityHead('town:lhota', [usage('Lhota 16', 1), usage('Lhota 3', 4)], { data })).toBe('Lhota 3');
    });
});

const id = (state: PlaceIdentity['state'], extra: Partial<PlaceIdentity> = {}): PlaceIdentity =>
    ({ state, located: ['placed', 'verified', 'check', 'town'].includes(state), ...extra });

describe('summary, filter and order', () => {
    const all = [id('none'), id('none'), id('queued'), id('running'), id('confirm'), id('undet'), id('check', { origin: 'hand' }),
        id('verified'), id('placed', { origin: 'hand' }), id('town'), id('queued', { located: true })];

    it('counts the chips (check also on the map) and shows only the ones that apply', () => {
        const s = placeStateSummary(all);
        expect(s).toEqual({ total: 11, map: 5, check: 1, confirm: 1, undet: 1, research: 3, none: 2 });
        expect(placeSummaryChips(s, true)).toEqual(['map', 'check', 'confirm', 'undet', 'research', 'none']);
        expect(placeSummaryChips(s, false)).toEqual(['map', 'check', 'none']);
        expect(placeSummaryChips(placeStateSummary([id('placed')]), true)).toEqual(['map']);
        expect(placeStateMatches(id('check'), 'map')).toBe(true);
        expect(placeStateMatches(id('none'), 'all')).toBe(true);
    });

    it('passes a group by its head or by the children that pass', () => {
        const pass = (x: PlaceIdentity) => placeStateMatches(x, 'none');
        expect(filterPlaceGroup(id('none'), [id('placed'), id('none')], pass).children).toHaveLength(2);
        expect(filterPlaceGroup(id('placed'), [id('placed'), id('none')], pass)).toEqual({ pass: true, children: [id('none')] });
        expect(filterPlaceGroup(id('placed'), [id('placed')], pass).pass).toBe(false);
    });

    it('sorts by state, the name order inside a state', () => {
        const row = (display: string, state: PlaceIdentity['state']) =>
            ({ key: k(display), usage: { display } as PlaceUsage, ident: id(state) });
        const rows = [row('Lhotov', 'placed'), row('Jinov', 'queued'), row('Lhota', 'none'), row('Horní Lhota', 'check'),
            row('Łotów', 'confirm'), row('Lhotínek', 'undet'), row('Lhoták', 'running'), row('H. Lhota', 'town'), row('Lhota u Jinova', 'verified')];
        expect(sortPlacesByState(rows, 'cs', r => placeStateRank(r.ident)).map(r => r.usage.display))
            .toEqual(['Horní Lhota', 'Łotów', 'Lhotínek', 'H. Lhota', 'Lhota', 'Lhoták', 'Jinov', 'Lhota u Jinova', 'Lhotov']);
    });
});

describe('bulk look-up and check', () => {
    const all = [id('none'), id('none'), id('undet'), id('confirm'), id('queued'), id('running'),
        id('placed', { origin: 'hand' }), id('placed', { origin: 'map' }), id('check', { origin: 'map' }), id('verified'), id('town')];

    it('counts from the research when it says, else from the app', () => {
        expect(bulkCounts(all)).toEqual({ offMap: 3, placed: 5 });
        const live = sanitizeBridgePlaces({ places: {}, counts: { offMap: 40, placed: 7, proposed: 1, unlocated: 0 } });
        expect(bulkCounts(all, live)).toEqual({ offMap: 40, placed: 7 });
    });

    it('previews what Look up all and Check all do', () => {
        expect(bulkLookPreview(all)).toEqual({ queue: 2, again: 1, skipConfirm: 1, skipResearch: 2, total: 3 });
        expect(bulkCheckPreview(all)).toEqual({ total: 5, first: 1, hand: 1, skipResearch: 2, skipConfirm: 1 });
    });
});

describe('badges', () => {
    it('writes the state badge with its glyph, escaped text and the origin', () => {
        expect(placeStateBadge(id('none'), 'cs')).toBe('<span class="place-state" data-state="none"><span aria-hidden="true">○</span> Zatím není na mapě</span>');
        expect(placeStateBadge(id('queued'), 'de')).toContain('In der Warteschlange');
        expect(placeStateBadge(id('none'), 'cs', { small: true })).toBe('<span class="place-state is-small" data-state="none"><span aria-hidden="true">○</span> bez polohy</span>');
        expect(placeStateBadge(id('town', { town: 'Lhota <b>' }), 'cs')).toContain('Poloha podle obce Lhota &lt;b&gt;');
        expect(placeStateBadge(id('running'), 'en')).toContain('title="The research is working on it right now."');
        const verified = placeStateBadge(id('verified', { at: '2026-11-03', origin: 'research' }), 'cs', { origin: true });
        expect(verified).toContain('Ověřeno výzkumem 3. 11. 2026');
        expect(verified).toContain('<span class="place-origin" data-origin="research"><span aria-hidden="true">◆</span> Určil výzkum</span>');
        expect(placeStateBadge(id('placed', { origin: 'hand' }), 'en')).toBe('<span class="place-origin" data-origin="hand"><span aria-hidden="true">✛</span> Placed by hand</span>');
        expect(placeOriginBadge('research', 'en', '2026-11-03T10:12:00Z')).toContain('Identified by the research 3 Nov 2026');
    });

    it('says the number of candidates with Czech plurals', () => {
        expect(placeStateText(id('confirm', { candidates: 1 }), 'cs')).toBe('K potvrzení – 1 kandidát');
        expect(placeStateText(id('confirm', { candidates: 3 }), 'cs')).toBe('K potvrzení – 3 kandidáti');
        expect(placeStateText(id('confirm', { candidates: 5 }), 'cs')).toBe('K potvrzení – 5 kandidátů');
        expect(placeStateText(id('confirm'), 'en')).toBe('To confirm');
        expect(placeStateText(id('confirm', { candidates: 2 }), 'de')).toBe('Zu bestätigen – 2 Kandidaten');
        expect(formatPlaceDate('bad', 'cs')).toBe('');
    });
});
