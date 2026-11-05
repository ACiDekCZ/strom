/**
 * Following the research agent on the map: where a session works now, and
 * the trail of where it worked before. Pure logic, no DOM: the map and the
 * fan draw from it.
 *
 * Where a session works (its "work place"):
 *   1. the research names a place record of the row (`working[].place`,
 *      "L0001", only when the bridge says `working.place`) that the tree
 *      knows: that place (`record`), or `noCoords` when it has no position;
 *   2. otherwise the places of the person worked on, in the order birth →
 *      residence → marriage → death, the first one with a position
 *      (`person`); a place without one only names it (`noCoords`); a person
 *      with no place at all is `noPlace`.
 * Never an archive's seat, never a name guessed from the task's text.
 */

import { PersonId, StromData } from './types.js';
import { placeKey } from './places.js';
import { isPlaceRecordId } from './place-records.js';
import { TrailEntry, trailOpacity } from './live-follow-targets.js';

export interface GeoPoint { lat: number; lon: number }

/** The person's event a place of theirs comes from. */
export type WorkEvent = 'birth' | 'residence' | 'wedding' | 'death';

export interface WorkPlace {
    kind: 'record' | 'person' | 'noCoords' | 'noPlace';
    /** The tree's place key (placeKey), null when no fact of the tree names it. */
    key: string | null;
    /** The place's name ('' for noPlace). */
    name: string;
    geo: GeoPoint | null;
    /** For a person's place: which event it is. */
    event?: WorkEvent;
    /** For a record's place: its id. */
    recordId?: string;
}

/** What a working row needs here. */
export interface WorkRow {
    personId: PersonId;
    /** The research's place record id ("L0001"), when it gives one. */
    place?: string;
}

/** A place key's position: its own coordinates, or those of the research's record it is. */
export function geoOfKey(data: StromData, key: string): GeoPoint | null {
    const g = data.places?.[key];
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) return { lat: g.lat, lon: g.lon };
    const rid = data.placeRefs?.[key];
    const c = rid ? data.placeRecords?.[rid]?.coords : undefined;
    return c ? { lat: c.lat, lon: c.lon } : null;
}

/** The place of a research record, as the tree knows it (null: no such record). */
function recordPlace(data: StromData, id: string): WorkPlace | null {
    const rec = data.placeRecords?.[id];
    if (!rec) return null;
    const keys = Object.entries(data.placeRefs ?? {}).filter(([, v]) => v === id).map(([k]) => k);
    // A name of the record the tree writes as a fact's place counts too.
    for (const n of rec.names) {
        const k = placeKey(n.name);
        if (k && data.places?.[k] && !keys.includes(k)) keys.push(k);
    }
    const located = keys.find(k => data.places?.[k]);
    const key = located ?? keys[0] ?? null;
    const geo = (located ? geoOfKey(data, located) : null) ?? (rec.coords ? { lat: rec.coords.lat, lon: rec.coords.lon } : null);
    const name = rec.names[0]?.name ?? '';
    return { kind: geo ? 'record' : 'noCoords', key, name, geo, recordId: id };
}

/** A person's places in the order the map looks at them: birth (baptism), residence, marriage, death (burial). */
export function personPlaces(data: StromData, id: PersonId): Array<{ name: string; event: WorkEvent }> {
    const p = data.persons[id];
    if (!p) return [];
    const out: Array<{ name: string; event: WorkEvent }> = [];
    const add = (name: string | undefined, event: WorkEvent): void => {
        const n = name?.trim();
        if (n) out.push({ name: n, event });
    };
    const events = p.events ?? [];
    add(p.birthPlace, 'birth');
    for (const e of events) if (e.type === 'baptism' || e.type === 'birth') add(e.place, 'birth');
    for (const e of events) if (e.type === 'residence') add(e.place, 'residence');
    for (const u of Object.values(data.partnerships)) {
        if (u.person1Id === id || u.person2Id === id) add(u.startPlace, 'wedding');
    }
    add(p.deathPlace, 'death');
    for (const e of events) if (e.type === 'burial' || e.type === 'death') add(e.place, 'death');
    return out;
}

/**
 * Where a row works. `usePlace`: the bridge sends `working[].place` (the
 * feature `working.place`); without it the field is never read.
 */
export function resolveWorkPlace(data: StromData, row: WorkRow, usePlace: boolean): WorkPlace {
    if (usePlace && isPlaceRecordId(row.place)) {
        const rec = recordPlace(data, row.place);
        if (rec) return rec;
    }
    const places = personPlaces(data, row.personId);
    for (const pl of places) {
        const key = placeKey(pl.name);
        const geo = key ? geoOfKey(data, key) : null;
        if (geo) return { kind: 'person', key, name: pl.name, geo, event: pl.event };
    }
    const first = places[0];
    if (first) return { kind: 'noCoords', key: placeKey(first.name) || null, name: first.name, geo: null, event: first.event };
    return { kind: 'noPlace', key: null, name: '', geo: null };
}

/** Two work places are the same place (a change of one signals). */
export function samePlace(a: WorkPlace | undefined, b: WorkPlace | undefined): boolean {
    if (!a || !b) return a === b;
    return a.kind === b.kind && a.key === b.key && a.name === b.name && a.recordId === b.recordId;
}

/** The identity of a work place on the map (its key, else its record, else its name). */
export function workPlaceId(w: WorkPlace): string {
    return w.key ?? (w.recordId ? `#${w.recordId}` : `~${w.name}`);
}

// ------------------------------------------------------------ the trail's strength

/**
 * The trail's strength per spot: each entry adds to the spot it lands on
 * (`spotOf`; null: nowhere), the newest entry decides the session's colour.
 * Two or more entries on one spot make it stronger (up to the newest step's
 * strength). Spots in `skip` (the ones worked on now) carry no trail.
 */
export function trailStrength(
    trail: readonly TrailEntry[], spotOf: (e: TrailEntry) => string | null, skip: ReadonlySet<string> = new Set(),
): Map<string, { opacity: number; session: number }> {
    const out = new Map<string, { opacity: number; session: number; n: number }>();
    trail.forEach((e, i) => {
        const spot = spotOf(e);
        if (!spot || skip.has(spot)) return;
        const o = trailOpacity(i);
        const had = out.get(spot);
        if (!had) out.set(spot, { opacity: o, session: e.session, n: 1 });
        else {
            had.n++;
            had.opacity = Math.min(trailOpacity(0), Math.max(had.opacity, o) + 0.1);
        }
    });
    return new Map([...out].map(([k, v]) => [k, { opacity: Math.round(v.opacity * 100) / 100, session: v.session }]));
}

/** A dot of the map's trail. */
export interface MapTrailDot { key: string; geo: GeoPoint; opacity: number; session: number }

/** The map's trail: places with a position, the ones worked on now left out. */
export function mapTrailDots(trail: readonly TrailEntry[], current: ReadonlySet<string>): MapTrailDot[] {
    const geoOf = new Map<string, GeoPoint>();
    for (const e of trail) if (e.placeKey && e.geo && !geoOf.has(e.placeKey)) geoOf.set(e.placeKey, e.geo);
    const strength = trailStrength(trail, e => (e.placeKey && e.geo ? e.placeKey : null), current);
    return [...strength].map(([key, v]) => ({ key, geo: geoOf.get(key)!, opacity: v.opacity, session: v.session }));
}

/**
 * The dotted lines of the map's trail: per session, between its places one
 * after another (oldest first, its place now last); places without a
 * position are skipped, the same place twice in a row is one.
 */
export function mapTrailLines(
    trail: readonly TrailEntry[], now: ReadonlyMap<number, { key: string; geo: GeoPoint }>,
): Array<{ session: number; from: GeoPoint; to: GeoPoint }> {
    const sessions = new Set<number>([...trail.map(e => e.session), ...now.keys()]);
    const out: Array<{ session: number; from: GeoPoint; to: GeoPoint }> = [];
    for (const s of [...sessions].sort((a, b) => a - b)) {
        const steps: Array<{ key: string; geo: GeoPoint }> = [];
        for (const e of [...trail].reverse()) {
            if (e.session === s && e.placeKey && e.geo) steps.push({ key: e.placeKey, geo: e.geo });
        }
        const cur = now.get(s);
        if (cur) steps.push(cur);
        for (let i = 1; i < steps.length; i++) {
            if (steps[i].key === steps[i - 1].key) continue;
            out.push({ session: s, from: steps[i - 1].geo, to: steps[i].geo });
        }
    }
    return out;
}
