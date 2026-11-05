/**
 * Following the research agent on the map: which place a session works on
 * (the research's place record with `working.place`, else the person's own
 * places), the bridge field's sanitizer, and the trail's strength and order.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveWorkPlace, personPlaces, samePlace, trailStrength, mapTrailDots, mapTrailLines,
} from '../live-follow-map.js';
import { TrailEntry } from '../live-follow-targets.js';
import { sanitizeWorking, WORKING_PLACE_FEATURE } from '../research-link.js';
import { StromData, Person, PersonId, Partnership, PartnershipId } from '../types.js';

const P = (s: string) => s as PersonId;

function person(id: string, extra: Partial<Person> = {}): Person {
    return {
        id: P(id), firstName: id, lastName: 'Lísek', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...extra,
    };
}

/**
 * Tomáš: born in Rybná (located), lived in Habrov (located), married in
 * Lhota u Habrova (no position). Vojtěch: born in Lhota u Habrova (no
 * position), died in Rybná. Kryštof: no place. The research's records:
 * L0003 farnost Habrov (written "Habrov" in the tree), L0007 Dolní Mez (a
 * position on the record only), L0009 Horní Mez (no position anywhere).
 */
function tree(): StromData {
    const ps = [
        person('tomas', {
            birthPlace: 'Rybná',
            events: [{ id: 'e1', type: 'residence', place: 'Habrov' }] as Person['events'],
        }),
        person('vojtech', { birthPlace: 'Lhota u Habrova', deathPlace: 'Rybná' }),
        person('kryštof'),
        person('marta', { gender: 'female' }),
    ];
    const data: StromData = { persons: Object.fromEntries(ps.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
    const u = { id: 'u1' as PartnershipId, person1Id: P('tomas'), person2Id: P('marta'), childIds: [], status: 'married', startPlace: 'Lhota u Habrova' } as Partnership;
    data.partnerships[u.id] = u;
    data.places = {
        'rybna': { lat: 49.71, lon: 16.42, label: 'Rybná' },
        'habrov': { lat: 49.8, lon: 16.5, label: 'Habrov' },
    };
    data.placeRecords = {
        L0003: { id: 'L0003', names: [{ name: 'farnost Habrov' }], coords: { lat: 49.8, lon: 16.5 } },
        L0007: { id: 'L0007', names: [{ name: 'Dolní Mez' }], coords: { lat: 49.6, lon: 16.3 } },
        L0009: { id: 'L0009', names: [{ name: 'Horní Mez' }] },
    };
    data.placeRefs = { habrov: 'L0003' };
    return data;
}

describe('resolveWorkPlace', () => {
    it('with the flag, a known place record is the work place (its tree key and position)', () => {
        const w = resolveWorkPlace(tree(), { personId: P('vojtech'), place: 'L0003' }, true);
        expect(w).toMatchObject({ kind: 'record', key: 'habrov', name: 'farnost Habrov', recordId: 'L0003' });
        expect(w.geo).toEqual({ lat: 49.8, lon: 16.5 });
    });

    it('a record no fact names still stands on the map by its own position', () => {
        const w = resolveWorkPlace(tree(), { personId: P('tomas'), place: 'L0007' }, true);
        expect(w).toMatchObject({ kind: 'record', key: null, name: 'Dolní Mez', geo: { lat: 49.6, lon: 16.3 } });
    });

    it('a record without a position gives the no-position state, never the person’s places', () => {
        const w = resolveWorkPlace(tree(), { personId: P('tomas'), place: 'L0009' }, true);
        expect(w).toMatchObject({ kind: 'noCoords', name: 'Horní Mez', geo: null, recordId: 'L0009' });
    });

    it('without the flag the place field is not read: the person’s first located place', () => {
        const w = resolveWorkPlace(tree(), { personId: P('vojtech'), place: 'L0003' }, false);
        // Born in Lhota u Habrova (no position) → died in Rybná (located).
        expect(w).toMatchObject({ kind: 'person', key: 'rybna', name: 'Rybná', event: 'death' });
    });

    it('a missing or unknown record falls back to the person’s places', () => {
        expect(resolveWorkPlace(tree(), { personId: P('tomas') }, true)).toMatchObject({ kind: 'person', key: 'rybna', event: 'birth' });
        expect(resolveWorkPlace(tree(), { personId: P('tomas'), place: 'L0404' }, true)).toMatchObject({ kind: 'person', key: 'rybna' });
        expect(resolveWorkPlace(tree(), { personId: P('tomas'), place: 'Habrov' }, true)).toMatchObject({ kind: 'person', key: 'rybna' });
    });

    it('a person whose places have no position names the first; one with no place is noPlace', () => {
        const d = tree();
        d.persons[P('vojtech')].deathPlace = undefined;
        expect(resolveWorkPlace(d, { personId: P('vojtech') }, true))
            .toMatchObject({ kind: 'noCoords', key: 'lhota u habrova', name: 'Lhota u Habrova', geo: null, event: 'birth' });
        expect(resolveWorkPlace(d, { personId: P('kryštof') }, true)).toMatchObject({ kind: 'noPlace', key: null, geo: null });
    });

    it('a place without its own position takes the position of the research record it is', () => {
        const d = tree();
        delete d.places!.rybna;
        d.placeRefs!.rybna = 'L0007';
        expect(resolveWorkPlace(d, { personId: P('tomas') }, false)).toMatchObject({ kind: 'person', key: 'rybna', geo: { lat: 49.6, lon: 16.3 } });
    });

    it('the person’s places go birth → residence → marriage → death', () => {
        expect(personPlaces(tree(), P('tomas')).map(p => p.event)).toEqual(['birth', 'residence', 'wedding']);
        expect(personPlaces(tree(), P('marta')).map(p => [p.event, p.name])).toEqual([['wedding', 'Lhota u Habrova']]);
    });

    it('samePlace tells a change of place apart from the same one', () => {
        const a = resolveWorkPlace(tree(), { personId: P('tomas') }, true);
        expect(samePlace(a, resolveWorkPlace(tree(), { personId: P('tomas') }, true))).toBe(true);
        // Vojtěch died in Rybná, where Tomáš was born: the same place, no signal.
        expect(samePlace(a, resolveWorkPlace(tree(), { personId: P('vojtech') }, true))).toBe(true);
        expect(samePlace(a, resolveWorkPlace(tree(), { personId: P('tomas'), place: 'L0003' }, true))).toBe(false);
        expect(samePlace(undefined, a)).toBe(false);
    });
});

describe('working[].place from the bridge', () => {
    it('keeps a place record id and drops anything else', () => {
        const w = sanitizeWorking([
            { who: 'a', place: 'L0003' },
            { who: 'b', place: 'Habrov' },
            { who: 'c', place: 'L12345678' },
            { who: 'd', place: 3 },
            { who: 'e' },
        ]);
        expect(w.map(x => x.place)).toEqual(['L0003', undefined, undefined, undefined, undefined]);
        expect('place' in w[1]).toBe(false);
        expect(WORKING_PLACE_FEATURE).toBe('working.place');
    });
});

describe('the trail', () => {
    const e = (personId: string, placeKey: string | null, session: number, geo: { lat: number; lon: number } | null = null): TrailEntry =>
        ({ personId: P(personId), placeKey, session, at: 0, geo });
    const g = (n: number) => ({ lat: 49 + n / 10, lon: 16 });

    it('strength by order: the newest strongest, older fainter', () => {
        const s = trailStrength([e('a', null, 1), e('b', null, 1), e('c', null, 2)], x => x.personId);
        expect([...s].map(([k, v]) => [k, v.opacity, v.session])).toEqual([['a', 0.85, 1], ['b', 0.7, 1], ['c', 0.6, 2]]);
    });

    it('two entries on one spot are stronger; a spot worked on now carries none', () => {
        const s = trailStrength([e('a', null, 1), e('b', null, 1), e('c', null, 1), e('b', null, 2)], x => x.personId, new Set(['a']));
        expect(s.has('a')).toBe(false);
        expect(s.get('b')).toEqual({ opacity: 0.8, session: 1 });
        expect(s.get('c')!.opacity).toBe(0.6);
    });

    it('map dots: only places with a position, the place worked on now left out, deduplicated', () => {
        const dots = mapTrailDots([
            e('a', 'rybna', 1, g(1)), e('b', 'lhota', 1, null), e('c', 'habrov', 1, g(2)), e('d', 'rybna', 1, g(1)), e('f', 'mez', 2, g(3)),
        ], new Set(['habrov']));
        expect(dots.map(d => [d.key, d.opacity])).toEqual([['rybna', 0.85], ['mez', 0.42]]);
    });

    it('map lines join one session’s places oldest first, ending at its place now', () => {
        // The trail is newest first: session 1 went rybna → habrov → (now) mez; session 2 was at lhota, now at lhota.
        const lines = mapTrailLines([e('x', 'habrov', 1, g(2)), e('y', 'lhota', 2, g(4)), e('z', 'rybna', 1, g(1))],
            new Map([[1, { key: 'mez', geo: g(3) }], [2, { key: 'lhota', geo: g(4) }]]));
        expect(lines).toEqual([
            { session: 1, from: g(1), to: g(2) },
            { session: 1, from: g(2), to: g(3) },
        ]);
    });
});
