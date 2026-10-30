/**
 * Places of life — the person page's map (spec 025, §1, variant 1a): the
 * neighbourhood of the person's places, with a small world map inset when a
 * child or partner went far away, and the list of places under it.
 *
 * Pure: `collectPersonPlacePoints` reads the tree, `placesMapHtml` returns
 * the section's HTML (inline SVG + HTML labels in percent, so labels keep
 * their size on a phone). The country outlines are bundled (Natural Earth,
 * src/map-outlines.ts); no tiles, no network, nothing outside the page.
 *
 * Geometry. The map is drawn into a 640 × 320 view (2 : 1). On a phone the
 * box is 4 : 3 and shows the middle of that view (x 106.7–533.3), held
 * sideways 3 : 1 (y 53.3–266.7). The person's places are therefore fitted
 * into the middle 2/3 of the view (the "safe area", visible in every shape)
 * and the rest of the frame shows the surroundings.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';
import type { StromData, PersonId, PlaceGeo, LifeEventType, CoupleEventType, Person } from './types.js';
import { computePersonLifeline } from './timeline.js';
import { placeKey } from './places.js';
import { yearOf, yearFraction, parseFlexDate } from './dates.js';
import { isLivingPerson } from './privacy.js';
import { lifeEventLabel, coupleEventLabelIn } from './person-sources.js';
import { mercator, outlinePaths, outlineResolution, viewBounds, WORLD, type OutlineView } from './map-outlines.js';
import { chartAnchorId } from './person-page-chart.js';

// ─── Points ─────────────────────────────────────────────────────────────────

/** A relative's place (hollow circle): a partner's birth, a child's death or emigration. */
export type RelativeRole = 'son' | 'daughter' | 'child' | 'husband' | 'wife' | 'partner' | 'partnerF';
export type RelativeEvent = 'birth' | 'death' | 'emigration' | 'immigration';

/** One place reference of the person (or, with `rel`, of a child or partner). */
export interface PlacePoint {
    placeKey: string;
    /** The place as written in the tree. */
    place: string;
    /** Life-timeline sort key (`computePersonLifeline`); null for an undated point. */
    sortKey: number | null;
    year: number | null;
    /** "1890–1900" when the date is a range or period. */
    yearLabel?: string;
    kind: 'birth' | 'death' | 'marriage' | 'divorce' | 'event' | 'coupleEvent' | 'relative';
    eventType?: LifeEventType;
    coupleType?: CoupleEventType;
    customLabel?: string;
    /** Marriage / divorce / couple event: the partner's name. */
    partnerName?: string;
    /** A divorce of a couple that never married ("end of the relationship"). */
    unmarried?: boolean;
    /** A relative's place. */
    rel?: { role: RelativeRole; name: string; id: PersonId; ev: RelativeEvent };
}

export interface CollectPlacesOptions {
    /** Ids of living people (PersonPageData.living); computed with isLivingPerson when missing. */
    living?: ReadonlySet<string>;
    /** A protected file (privacy ≠ full): nothing of a living person is shown. */
    protect?: boolean;
    /** The current year (living test without `living`). */
    now?: number;
}

/** Sort order of a point: undated birth first, undated death or burial last, other undated after the dated. */
export function placeOrderKey(p: PlacePoint): number {
    if (p.sortKey !== null) return p.sortKey;
    if (p.kind === 'birth') return -1e9;
    if (p.kind === 'death' || p.eventType === 'burial' || p.eventType === 'cremation') return 2e9;
    return 1e9;
}

function rangeLabel(date: string | undefined): string | undefined {
    const d = parseFlexDate(date);
    return d?.end && d.end.year !== d.year ? `${d.year}–${d.end.year}` : undefined;
}

/**
 * The person's place references for the map (§1.2): birth, baptism, events with
 * a place, marriages (start and end place), the couple's events, death and
 * burial — dated ones with the life timeline's sort keys, undated ones too (the
 * list shows them). Then the relatives' places that are not among the person's:
 * each partner's birth place, each child's death and emigration places.
 *
 * Living protection (§1.7): with `protect`, a living person's page gives
 * nothing, and no point comes from a living child or partner (a marriage or a
 * couple's event with a living partner included).
 */
export function collectPersonPlacePoints(tree: StromData, personId: PersonId, opts: CollectPlacesOptions = {}): PlacePoint[] {
    const person = tree.persons[personId];
    if (!person || person.isPlaceholder) return [];
    const now = opts.now ?? new Date().getFullYear();
    const isLiving = (p: Person): boolean => opts.living ? opts.living.has(p.id) : isLivingPerson(p, now);
    const hidden = (id: string | undefined): boolean => {
        if (!opts.protect || !id) return false;
        const p = tree.persons[id as PersonId];
        return !!p && isLiving(p);
    };
    if (hidden(personId)) return [];

    const out: PlacePoint[] = [];
    const partnerOf = (unionId: string): string | undefined => {
        const u = tree.partnerships[unionId as keyof typeof tree.partnerships];
        if (!u) return undefined;
        return u.person1Id === personId ? u.person2Id : u.person1Id;
    };

    // Dated points: the life timeline (same sort keys as its rows and anchors).
    for (const pt of computePersonLifeline(tree, personId)) {
        const place = pt.place?.trim();
        if (!place) continue;
        if (pt.kind === 'child' || pt.kind === 'childEvent') continue;
        const key = placeKey(place);
        if (!key) continue;
        if ((pt.kind === 'marriage' || pt.kind === 'divorce' || pt.kind === 'coupleEvent')
            && pt.partnershipId && hidden(partnerOf(pt.partnershipId))) continue;
        out.push({
            placeKey: key, place, sortKey: pt.sortKey, year: pt.year,
            ...(pt.yearLabel ? { yearLabel: pt.yearLabel } : pt.endYear ? { yearLabel: `${pt.year}–${pt.endYear}` } : {}),
            kind: pt.kind,
            ...(pt.eventType ? { eventType: pt.eventType } : {}),
            ...(pt.coupleType ? { coupleType: pt.coupleType } : {}),
            ...(pt.customLabel ? { customLabel: pt.customLabel } : {}),
            ...(pt.relatedName ? { partnerName: pt.relatedName } : {}),
            ...(pt.unmarried ? { unmarried: true } : {}),
        });
    }

    // Undated points with a place: the list names them too.
    const undated = (date: string | undefined, placeRaw: string | undefined, p: Omit<PlacePoint, 'placeKey' | 'place' | 'sortKey' | 'year'>) => {
        if (yearOf(date) !== null) return;
        const place = placeRaw?.trim();
        const key = place ? placeKey(place) : '';
        if (!place || !key) return;
        out.push({ placeKey: key, place, sortKey: null, year: null, ...p });
    };
    undated(person.birthDate, person.birthPlace, { kind: 'birth' });
    undated(person.deathDate, person.deathPlace, { kind: 'death' });
    for (const ev of person.events ?? []) {
        undated(ev.date, ev.place, { kind: 'event', eventType: ev.type, ...(ev.customLabel ? { customLabel: ev.customLabel } : {}) });
    }
    for (const unionId of person.partnerships) {
        const u = tree.partnerships[unionId];
        if (!u) continue;
        const otherId = partnerOf(unionId);
        if (hidden(otherId)) continue;
        const other = otherId ? tree.persons[otherId as PersonId] : undefined;
        const partnerName = other ? personName(other) : '';
        const named = partnerName ? { partnerName } : {};
        undated(u.startDate, u.startPlace, { kind: 'marriage', ...named });
        if (u.endDate || u.endPlace) {
            if (yearOf(u.endDate) === null && u.endPlace?.trim()) {
                undated(u.endDate, u.endPlace, { kind: 'divorce', ...named,
                    ...(u.status === 'partners' || u.status === 'separated' ? { unmarried: true } : {}) });
            }
        }
        for (const ev of u.events ?? []) {
            undated(ev.date, ev.place, { kind: 'coupleEvent', coupleType: ev.type, ...(ev.customLabel ? { customLabel: ev.customLabel } : {}), ...named });
        }
    }

    // The relatives' places that are not the person's own.
    const own = new Set(out.map(p => p.placeKey));
    const relPoint = (rel: Person, role: RelativeRole, ev: RelativeEvent, date: string | undefined, placeRaw: string | undefined) => {
        const place = placeRaw?.trim();
        const key = place ? placeKey(place) : '';
        if (!place || !key || own.has(key)) return;
        const year = yearOf(date);
        out.push({
            placeKey: key, place, sortKey: year !== null ? year + yearFraction(date) : null, year,
            ...(rangeLabel(date) ? { yearLabel: rangeLabel(date) } : {}),
            kind: 'relative', rel: { role, name: rel.firstName?.trim() || personName(rel), id: rel.id, ev },
        });
    };
    for (const unionId of person.partnerships) {
        const u = tree.partnerships[unionId];
        const otherId = partnerOf(unionId);
        const other = otherId ? tree.persons[otherId as PersonId] : undefined;
        if (!u || !other || other.isPlaceholder || hidden(other.id)) continue;
        const married = u.status === 'married' || u.status === 'divorced';
        const role: RelativeRole = married
            ? (other.gender === 'female' ? 'wife' : 'husband')
            : (other.gender === 'female' ? 'partnerF' : 'partner');
        relPoint(other, role, 'birth', other.birthDate, other.birthPlace);
    }
    for (const childId of person.childIds) {
        const child = tree.persons[childId];
        if (!child || child.isPlaceholder || hidden(child.id)) continue;
        const role: RelativeRole = child.gender === 'male' ? 'son' : child.gender === 'female' ? 'daughter' : 'child';
        for (const ev of child.events ?? []) {
            if (ev.type === 'emigration' || ev.type === 'immigration') relPoint(child, role, ev.type, ev.date, ev.place);
        }
        relPoint(child, role, 'death', child.deathDate, child.deathPlace);
    }

    return out;
}

function personName(p: Person): string {
    return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
}

// ─── Plan (pure geometry) ───────────────────────────────────────────────────

export const VIEW_W = 640;
export const VIEW_H = 320;
/** The middle 2/3 of the view: visible on a phone (4 : 3) and held sideways (3 : 1). */
export const SAFE = { x0: VIEW_W / 6, x1: VIEW_W * 5 / 6, y0: VIEW_H / 6, y1: VIEW_H * 5 / 6 };
/** Places farther than this from the centre of the neighbourhood go to the world inset. */
export const FAR_KM = 300;
const MIN_SPAN_KM = 25;
const EARTH_KM = 40075.017;
const INSET_W = 240;
const INSET_H = 120;

/** Typical box widths in px: desktop column, phone (100vw − 32 at 375). */
const BOX_PX = { desk: 680, phone: 343 };
/** Visible view units across the box: desktop (whole view), phone (the middle 2/3). */
const UNITS_ACROSS = { desk: VIEW_W, phone: VIEW_W * 2 / 3 };

export interface PlannedPlace {
    placeKey: string;
    /** Label text: the place's first part ("Lhota" of "Lhota, Čechy"). */
    name: string;
    /** Full name for the list. */
    full: string;
    /** 1, 2, … in the order of the first visit; 0 for a relative's place. */
    num: number;
    rel: boolean;
    points: PlacePoint[];
    geo?: PlaceGeo;
    /** Position in the main view (units); missing when not on the main map. */
    x?: number;
    y?: number;
    /** On the world inset (a far relative's place). */
    inset?: { x: number; y: number };
    /** Label side on desktop/tablet and on a phone. */
    side?: { d: LabelSide; p: LabelSide };
}

export type LabelSide = 'l' | 'r' | 'hide';

export interface MapPlan {
    /** 'map': map + list; 'list': list only (one place with a position); 'noGeo': list, no position at all; 'none': no section. */
    state: 'map' | 'list' | 'noGeo' | 'none';
    places: PlannedPlace[];
    /** The person's places without a position (the "Not on the map" row). */
    noPos: PlannedPlace[];
    view?: OutlineView;
    /** Scale bar: km and its length in view units; none for a world-wide frame. */
    scale?: { km: number; units: number };
    /** Migration path through the numbered places, in view units. */
    route: { x: number; y: number }[];
    inset?: {
        corner: 'br' | 'tl';
        view: OutlineView;
        /** The main frame in inset units. */
        rect: { x: number; y: number; w: number; h: number };
        /** Centre of the main frame in inset units (where the arcs start). */
        from: { x: number; y: number };
    };
}

/** Great-circle distance in km. */
export function distanceKm(a: PlaceGeo, b: PlaceGeo): number {
    const R = 6371.0088;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** World units (zoom 0) per km at a latitude. */
function worldPerKm(lat: number): number {
    return WORLD / (EARTH_KM * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
}

const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

/**
 * The scale bar for `unitsPerKm` view units per km: a round length whose bar
 * is 40–120 px both on a desktop box (680 px ↔ 640 units) and on a phone
 * (343 px ↔ 426.7 units), i.e. 50–110 units; else the one nearest 80 units.
 */
export function scaleBar(unitsPerKm: number): { km: number; units: number } {
    let best = SCALE_STEPS[0], bestD = Infinity;
    for (const km of SCALE_STEPS) {
        const u = km * unitsPerKm;
        if (u >= 50 && u <= 110) return { km, units: u };
        const d = Math.abs(Math.log(u / 80));
        if (d < bestD) { bestD = d; best = km; }
    }
    return { km: best, units: best * unitsPerKm };
}

/** "Lhota" of "Lhota, okres Kolín, Čechy". */
function shortName(place: string): string {
    const first = place.split(',')[0].trim();
    return first || place.trim();
}

/** Inset rectangles (view units) per box shape and corner — obstacles for the labels and the inset choice. */
export function insetRects(corner: 'br' | 'tl'): { d: Rect; p: Rect; l: Rect } {
    // Desktop: 31 % of the width, 8 px from the edges (≈ 7.5 units).
    const dw = VIEW_W * 0.31, dh = dw / 2, dm = 7.5;
    // Phone: 40 % of the box width; the box shows 426.7 units across (8 px ≈ 10 units).
    const pw = UNITS_ACROSS.phone * 0.4, ph = pw / 2, pm = 10;
    // Held sideways (3 : 1): 24 % of the width; the box shows y 53.3–266.7.
    const lw = VIEW_W * 0.24, lh = lw / 2, lm = 7.5;
    if (corner === 'br') {
        return {
            d: { x: VIEW_W - dm - dw, y: VIEW_H - dm - dh, w: dw, h: dh },
            p: { x: SAFE.x1 - pm - pw, y: VIEW_H - pm - ph, w: pw, h: ph },
            l: { x: VIEW_W - lm - lw, y: SAFE.y1 - lm - lh, w: lw, h: lh },
        };
    }
    return {
        d: { x: dm, y: dm, w: dw, h: dh },
        p: { x: SAFE.x0 + pm, y: pm, w: pw, h: ph },
        l: { x: lm, y: SAFE.y0 + lm, w: lw, h: lh },
    };
}

export interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** How many numbered places (with their 22 px point) fall into an inset corner. */
function insetHits(pts: readonly { x: number; y: number }[], corner: 'br' | 'tl'): number {
    const r = insetRects(corner);
    const pad = 14;
    let n = 0;
    for (const p of pts) {
        const box = { x: p.x - pad, y: p.y - pad, w: 2 * pad, h: 2 * pad };
        if (overlaps(box, r.d) || overlaps(box, r.p) || overlaps(box, r.l)) n++;
    }
    return n;
}

export interface LabelInput { x: number; y: number; /** label width in px */ w: number }

/**
 * Label sides (§1.2): right of the point; left for a point in the right third
 * or when the right side collides with a placed label, a point or an obstacle;
 * when neither side fits (two tries), the label is left out (number only).
 * Units: view units; `pxToUnit` converts the label's px size.
 */
export function placeLabelSides(
    pts: readonly LabelInput[],
    o: { minX: number; maxX: number; minY: number; maxY: number; pxToUnit: number; obstacles?: readonly Rect[] },
): LabelSide[] {
    const off = 16 * o.pxToUnit, h = 20 * o.pxToUnit, pr = 11 * o.pxToUnit;
    const placed: Rect[] = [];
    const pointBoxes = pts.map(p => ({ x: p.x - pr, y: p.y - pr, w: 2 * pr, h: 2 * pr }));
    const third = o.minX + (o.maxX - o.minX) * 2 / 3;
    return pts.map((p, i) => {
        const w = p.w * o.pxToUnit;
        const rect = (side: 'l' | 'r'): Rect => ({ x: side === 'r' ? p.x + off : p.x - off - w, y: p.y - h / 2, w, h });
        const fits = (r: Rect): boolean =>
            r.x >= o.minX && r.x + r.w <= o.maxX && r.y >= o.minY && r.y + r.h <= o.maxY
            && !placed.some(q => overlaps(q, r))
            && !pointBoxes.some((q, j) => j !== i && overlaps(q, r))
            && !(o.obstacles ?? []).some(q => overlaps(q, r));
        const first: 'l' | 'r' = p.x > third ? 'l' : 'r';
        for (const side of [first, first === 'r' ? 'l' : 'r'] as const) {
            const r = rect(side);
            if (fits(r)) { placed.push(r); return side; }
        }
        return 'hide';
    });
}

/** Years of a place for its label: desktop "1860, 1883" (≤ 3) or first–last; phone first–last. */
export function labelYears(points: readonly PlacePoint[]): { d: string; p: string } {
    const ys = [...new Set(points.map(p => p.year).filter((y): y is number => y !== null))].sort((a, b) => a - b);
    if (!ys.length) return { d: '', p: '' };
    const range = ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : String(ys[0]);
    return { d: ys.length <= 3 ? ys.join(', ') : range, p: range };
}

/** Estimated label width in px: name 12.5 px 600 (≈ 7 px a character) + years 11 px (≈ 6 px). */
export function labelWidthPx(name: string, years: string): number {
    return Math.ceil(name.length * 7 + (years ? 6 + years.length * 6 : 0) + 12);
}

/**
 * Plan the map (pure): group the points by place, number them by first visit,
 * pick the state (§1.5), the frame (§1.3), the inset, the scale bar and the
 * label sides.
 */
export function planPlacesMap(points: readonly PlacePoint[], geo: Readonly<Record<string, PlaceGeo>> | undefined, opts: { kidPlaces: boolean }): MapPlan {
    const g = geo ?? {};
    const groups = new Map<string, PlannedPlace>();
    const ordered = [...points].sort((a, b) => placeOrderKey(a) - placeOrderKey(b));
    // The person's own places first (numbered), then relatives' places.
    for (const p of ordered) {
        if (p.rel) continue;
        let gp = groups.get(p.placeKey);
        if (!gp) {
            gp = { placeKey: p.placeKey, name: shortName(p.place), full: p.place.trim(), num: 0, rel: false, points: [],
                ...(g[p.placeKey] ? { geo: g[p.placeKey] } : {}) };
            groups.set(p.placeKey, gp);
        }
        gp.points.push(p);
    }
    const own = [...groups.values()];
    const empty: MapPlan = { state: 'none', places: [], noPos: [], route: [] };
    if (own.length <= 1) return empty;

    const ownGeo = own.filter(p => p.geo);
    const noPos = own.filter(p => !p.geo);
    if (!ownGeo.length) return { ...empty, state: 'noGeo', places: own, noPos: [] };
    if (ownGeo.length === 1) return { ...empty, state: 'list', places: own, noPos: [] };
    ownGeo.forEach((p, i) => { p.num = i + 1; });

    // Relatives' places with a position (when the switch is on).
    const rels: PlannedPlace[] = [];
    if (opts.kidPlaces) {
        const relGroups = new Map<string, PlannedPlace>();
        for (const p of ordered) {
            if (!p.rel || groups.has(p.placeKey) || !g[p.placeKey]) continue;
            let gp = relGroups.get(p.placeKey);
            if (!gp) {
                gp = { placeKey: p.placeKey, name: shortName(p.place), full: p.place.trim(), num: 0, rel: true, points: [], geo: g[p.placeKey] };
                relGroups.set(p.placeKey, gp);
            }
            gp.points.push(p);
        }
        rels.push(...relGroups.values());
    }

    // Centre of the neighbourhood: the centroid of the person's places.
    const centroid: PlaceGeo = {
        lat: ownGeo.reduce((s, p) => s + p.geo!.lat, 0) / ownGeo.length,
        lon: ownGeo.reduce((s, p) => s + p.geo!.lon, 0) / ownGeo.length,
    };
    const compact = ownGeo.every(p => distanceKm(p.geo!, centroid) <= FAR_KM);
    const near = compact ? rels.filter(p => distanceKm(p.geo!, centroid) <= FAR_KM) : rels;
    const far = compact ? rels.filter(p => distanceKm(p.geo!, centroid) > FAR_KM) : [];

    // Frame: the envelope of the main map's places + 15 % each side, at least 25 km, fitted into the safe area.
    const main = [...ownGeo, ...near];
    const w = main.map(p => mercator(p.geo!.lon, p.geo!.lat));
    let minX = Math.min(...w.map(p => p.x)), maxX = Math.max(...w.map(p => p.x));
    let minY = Math.min(...w.map(p => p.y)), maxY = Math.max(...w.map(p => p.y));
    const cLat = (Math.min(...main.map(p => p.geo!.lat)) + Math.max(...main.map(p => p.geo!.lat))) / 2;
    const perKm = worldPerKm(cLat);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max((maxX - minX) * 1.3, MIN_SPAN_KM * perKm);
    const spanY = Math.max((maxY - minY) * 1.3, 1e-9);
    const safeW = SAFE.x1 - SAFE.x0, safeH = SAFE.y1 - SAFE.y0;
    const k = Math.min(safeW / spanX, safeH / spanY);
    const view: OutlineView = { x0: cx - VIEW_W / 2 / k, y0: cy - VIEW_H / 2 / k, k, width: VIEW_W, height: VIEW_H };
    const toView = (lat: number, lon: number) => {
        const m = mercator(lon, lat);
        return { x: (m.x - view.x0) * k, y: (m.y - view.y0) * k };
    };
    for (const p of main) Object.assign(p, toView(p.geo!.lat, p.geo!.lon));

    // Scale bar (hidden for a world-wide frame: the Mercator scale drifts).
    const unitsPerKm = perKm * k;
    const frameKm = VIEW_W / unitsPerKm;
    const scale = frameKm <= 3000 ? scaleBar(unitsPerKm) : undefined;

    // Migration path: the numbered places in the order of life, only changes of place.
    const route: { x: number; y: number }[] = [];
    let last = '';
    for (const p of ordered) {
        if (p.rel || p.placeKey === last) continue;
        const gp = groups.get(p.placeKey);
        if (!gp?.geo || gp.x === undefined || gp.y === undefined) continue;
        // Undated events other than birth / death have no place in the order of life.
        if (p.sortKey === null && p.kind !== 'birth' && p.kind !== 'death') continue;
        route.push({ x: gp.x, y: gp.y });
        last = p.placeKey;
    }

    // World inset for far places.
    let inset: MapPlan['inset'];
    if (far.length) {
        const ownPts = ownGeo.map(p => ({ x: p.x!, y: p.y! }));
        const corner: 'br' | 'tl' = insetHits(ownPts, 'br') <= insetHits(ownPts, 'tl') ? 'br' : 'tl';
        const centre = { x: view.x0 + VIEW_W / 2 / k, y: view.y0 + VIEW_H / 2 / k };
        const fw = far.map(p => mercator(p.geo!.lon, p.geo!.lat));
        const xs = [centre.x, ...fw.map(p => p.x)], ys = [centre.y, ...fw.map(p => p.y)];
        const ix = (Math.min(...xs) + Math.max(...xs)) / 2, iy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const minSpan = (40 / 360) * WORLD;
        const iw = Math.max((Math.max(...xs) - Math.min(...xs)) * 1.4, minSpan);
        const ih = Math.max((Math.max(...ys) - Math.min(...ys)) * 1.4, minSpan / 2);
        const ik = Math.min(INSET_W / iw, INSET_H / ih);
        const iv: OutlineView = { x0: ix - INSET_W / 2 / ik, y0: iy - INSET_H / 2 / ik, k: ik, width: INSET_W, height: INSET_H, margin: 10, minStep: 1.2 };
        for (let i = 0; i < far.length; i++) far[i].inset = { x: (fw[i].x - iv.x0) * ik, y: (fw[i].y - iv.y0) * ik };
        let rw = (VIEW_W / k) * ik, rh = (VIEW_H / k) * ik;
        const from = { x: (centre.x - iv.x0) * ik, y: (centre.y - iv.y0) * ik };
        rw = Math.max(rw, 6); rh = Math.max(rh, 3);
        inset = { corner, view: iv, rect: { x: from.x - rw / 2, y: from.y - rh / 2, w: rw, h: rh }, from };
    }

    // Labels: desktop (the whole view) and phone (the middle 2/3, short years).
    const onMain = [...ownGeo, ...near];
    const deskObst = inset ? [insetRects(inset.corner).d] : [];
    const phoneObst = inset ? [insetRects(inset.corner).p] : [];
    const attr: Rect = { x: VIEW_W - 150, y: 0, w: 150, h: 18 };
    const sideD = placeLabelSides(onMain.map(p => ({ x: p.x!, y: p.y!, w: labelWidthPx(p.name, labelYears(p.points).d) })),
        { minX: 4, maxX: VIEW_W - 4, minY: 2, maxY: VIEW_H - 2, pxToUnit: UNITS_ACROSS.desk / BOX_PX.desk, obstacles: [...deskObst, attr] });
    const sideP = placeLabelSides(onMain.map(p => ({ x: p.x!, y: p.y!, w: labelWidthPx(p.name, labelYears(p.points).p) })),
        { minX: SAFE.x0 + 3, maxX: SAFE.x1 - 3, minY: 2, maxY: VIEW_H - 2, pxToUnit: UNITS_ACROSS.phone / BOX_PX.phone, obstacles: phoneObst });
    onMain.forEach((p, i) => { p.side = { d: sideD[i], p: sideP[i] }; });

    return { state: 'map', places: [...ownGeo, ...near, ...far], noPos, view, ...(scale ? { scale } : {}), route, ...(inset ? { inset } : {}) };
}

// ─── HTML ───────────────────────────────────────────────────────────────────

export interface PlacesMapCtx {
    lang: Language;
    /** 'app': the person page window (switch, open button, both noGeo sentences); 'file': a saved page. */
    mode: 'app' | 'file';
    /** Children's and partners' places shown (the switch; in a file its state when saved). */
    kidPlaces: boolean;
    /** The selected place (placeKey), highlighted in the map and the list. */
    selected?: string | null;
    /** Place keys whose name matches several places (the places manager knows). */
    ambiguous?: ReadonlySet<string>;
    /** Section id (default 'pp-sec-places'). */
    id?: string;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const pct = (n: number, of: number): string => `${(Math.round((n / of) * 10000) / 100).toString()}%`;

type MapStrings = ReturnType<typeof getStringsForLang>;

/** First letter lower-cased (cs, en: "narození", "baptism"), German nouns keep theirs. */
function lowerFirst(text: string, lang: Language): string {
    if (lang === 'de' || text.length < 2) return text;
    const second = text[1];
    return second === second.toLowerCase() ? text[0].toLowerCase() + text.slice(1) : text;
}

function yearText(p: PlacePoint): string {
    return p.yearLabel ?? (p.year !== null ? String(p.year) : '');
}

/** The label of one of the person's own events at a place. */
function ownEventLabel(p: PlacePoint, S: MapStrings, lang: Language): string {
    const M = S.personPage.map;
    switch (p.kind) {
        case 'birth': return M.ev.birth;
        case 'death': return M.ev.death;
        case 'marriage': return M.ev.marriage(p.partnerName ?? '');
        case 'divorce': return p.unmarried ? M.ev.relationEnded : M.ev.divorce;
        case 'coupleEvent': return lowerFirst(coupleEventLabelIn({ type: p.coupleType ?? 'custom', customLabel: p.customLabel }, S), lang);
        default: return lowerFirst(lifeEventLabel({ type: p.eventType ?? 'custom', customLabel: p.customLabel }, S), lang);
    }
}

/** "narození a křest 1860, sňatek – Rozálie 1883" — births and baptisms (deaths and burials) of one year merged. */
export function ownEventsText(points: readonly PlacePoint[], S: MapStrings, lang: Language): string {
    const M = S.personPage.map;
    const parts: string[] = [];
    const used = new Set<PlacePoint>();
    for (const p of points) {
        if (used.has(p)) continue;
        used.add(p);
        let label = ownEventLabel(p, S, lang);
        const pairWith = p.kind === 'birth' ? 'baptism' : p.kind === 'death' ? 'burial' : null;
        if (pairWith) {
            const mate = points.find(q => !used.has(q) && q.kind === 'event' && q.eventType === pairWith && q.year === p.year);
            if (mate) { used.add(mate); label = p.kind === 'birth' ? M.ev.birthBaptism : M.ev.deathBurial; }
        }
        const y = yearText(p);
        parts.push(y ? `${label} ${y}` : label);
    }
    return parts.join(', ');
}

/** "syn Václav: vystěhování 1913, úmrtí 1968; dcera Marie: úmrtí 1950". */
export function relativeEventsText(points: readonly PlacePoint[], S: MapStrings): string {
    const M = S.personPage.map;
    const byPerson = new Map<string, PlacePoint[]>();
    for (const p of points) {
        if (!p.rel) continue;
        const list = byPerson.get(p.rel.id) ?? [];
        list.push(p);
        byPerson.set(p.rel.id, list);
    }
    return [...byPerson.values()].map(list => {
        const r = list[0].rel!;
        const evs = list.map(p => {
            const y = yearText(p);
            return y ? `${M.relEv[p.rel!.ev]} ${y}` : M.relEv[p.rel!.ev];
        }).join(', ');
        return `${M.rel[r.role]} ${r.name}: ${evs}`;
    }).join('; ');
}

/** The list row's timeline anchor: the first dated event of the place. */
function osaOf(p: PlannedPlace): string {
    const first = p.points.find(q => q.sortKey !== null && !q.rel);
    return first ? chartAnchorId(first.sortKey!) : '';
}

/**
 * The "Places of life" section (§1), or '' when the person has at most one
 * place (§1.5). `points` from `collectPersonPlacePoints` (protection applied
 * there), `geo` the tree's `places` (coordinates by placeKey).
 *
 * Interaction hooks for the app (and the file's small script):
 *   - `data-pp-map-place="{placeKey}"` on points and rows: select (click / Enter);
 *   - `data-pp-osa="osa-…"` on a row: the timeline row of the place's first event;
 *   - `data-pp-switch="kidPlaces"` (app): the children's places switch, the app re-renders;
 *   - `data-pp-action="map:open"` (app): open the application map.
 */
export function placesMapHtml(points: readonly PlacePoint[], geo: Readonly<Record<string, PlaceGeo>> | undefined, ctx: PlacesMapCtx): string {
    const plan = planPlacesMap(points, geo, { kidPlaces: ctx.kidPlaces });
    if (plan.state === 'none') return '';
    const S = getStringsForLang(ctx.lang);
    const M = S.personPage.map;
    const app = ctx.mode === 'app';
    const sel = ctx.selected ?? null;
    const id = ctx.id ?? 'pp-sec-places';

    const hasRel = points.some(p => p.rel && geo?.[p.placeKey]);
    const tools: string[] = [];
    if (app && plan.state === 'map' && hasRel) {
        tools.push(`<button type="button" class="pp-toggle" role="switch" aria-checked="${ctx.kidPlaces}" data-pp-switch="kidPlaces">${esc(M.kids)}</button>`);
    }
    if (app && plan.state === 'map') tools.push(`<button type="button" class="pp-act pp-map-open" data-pp-action="map:open">${esc(M.open)}</button>`);
    const head = `<div class="pp-sec-head"><h2>${esc(M.title)}</h2>${tools.length ? `<div class="pp-toggles pp-map-tools">${tools.join('')}</div>` : ''}</div>`;

    const map = plan.state === 'map' ? mapHtml(plan, S, sel) : '';
    const list = listHtml(plan, S, ctx, sel);
    const note = plan.state === 'noGeo'
        ? `<p class="pp-map-note">${esc(M.noGeo)}${app ? ` ${esc(M.noGeoHint)}` : ''}</p>` : '';
    return `<section class="pp-sec pp-sec--places pp-places" id="${esc(id)}">${head}${map}${list}${note}</section>`;
}

function mapHtml(plan: MapPlan, S: MapStrings, sel: string | null): string {
    const M = S.personPage.map;
    const v = plan.view!;
    const b = viewBounds(v);
    const res = outlineResolution(b);
    const lines = outlinePaths(v, res);

    // Graticule: meridians and parallels at a round step (0.05°, 0.1° … in a neighbourhood).
    const lonSpan = b.east - b.west;
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30].find(s => lonSpan / s <= 10) ?? 30;
    let grid = '';
    for (let lon = Math.ceil(b.west / step) * step; lon <= b.east; lon += step) {
        const x = (mercator(lon, 0).x - v.x0) * v.k;
        grid += `M${f1(x)} -40V360`;
    }
    for (let lat = Math.ceil(b.south / step) * step; lat <= b.north; lat += step) {
        const y = (mercator(0, lat).y - v.y0) * v.k;
        grid += `M-40 ${f1(y)}H680`;
    }

    const route = plan.route.length >= 2
        ? `<path class="pp-map-route" d="M${plan.route.map(p => `${f1(p.x)} ${f1(p.y)}`).join('L')}"/>` : '';
    const svg = `<svg class="pp-map-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
        + (grid ? `<path class="pp-map-grid" d="${grid}"/>` : '')
        + (lines.coast ? `<path class="pp-map-coast" d="${lines.coast}"/>` : '')
        + (lines.borders ? `<path class="pp-map-border" d="${lines.borders}"/>` : '')
        + route + '</svg>';

    let pts = '';
    let labels = '';
    // Relatives' hollow circles under the numbered points.
    const onMain = plan.places.filter(p => p.x !== undefined && p.y !== undefined);
    for (const p of [...onMain.filter(q => q.rel), ...onMain.filter(q => !q.rel)]) {
        const isSel = sel === p.placeKey ? ' is-sel' : '';
        const pos = `left:${pct(p.x!, VIEW_W)};top:${pct(p.y!, VIEW_H)}`;
        if (p.rel) {
            pts += `<button type="button" class="pp-map-pt pp-map-pt--rel${isSel}" style="${pos}" data-pp-map-place="${esc(p.placeKey)}" aria-label="${esc(p.full)}"></button>`;
        } else {
            pts += `<button type="button" class="pp-map-pt${isSel}" style="${pos}" data-pp-map-place="${esc(p.placeKey)}" aria-label="${p.num} ${esc(p.full)}">${p.num}</button>`;
        }
        const yrs = labelYears(p.points);
        const side = p.side ?? { d: 'r', p: 'r' };
        if (side.d === 'hide' && side.p === 'hide') continue;
        labels += `<span class="pp-map-lb lb-d-${side.d} lb-p-${side.p}${p.rel ? ' pp-map-lb--rel' : ''}" style="${pos}" aria-hidden="true">`
            + `${esc(p.name)}${yrs.d ? `<span class="pp-map-yr y-d">${esc(yrs.d)}</span>` : ''}${yrs.p ? `<span class="pp-map-yr y-p">${esc(yrs.p)}</span>` : ''}</span>`;
    }

    const scale = plan.scale
        ? `<div class="pp-map-scale" style="--u:${f1(plan.scale.units)}" aria-hidden="true"><span class="pp-map-scale-bar"></span><span class="pp-map-scale-t">${esc(M.km(plan.scale.km))}</span></div>` : '';
    const inset = plan.inset ? insetHtml(plan, S, sel) : '';
    return `<div class="pp-map" role="group" aria-label="${esc(M.aria)}"><div class="pp-map-in">${svg}${pts}${labels}</div>`
        + `<div class="pp-map-attr">${esc(M.attr)}</div>${scale}${inset}</div>`;
}

function insetHtml(plan: MapPlan, S: MapStrings, sel: string | null): string {
    const M = S.personPage.map;
    const ins = plan.inset!;
    const land = outlinePaths(ins.view, '110m', { land: true }).land;
    const far = plan.places.filter(p => p.inset);
    const r = ins.rect;
    let arcs = '';
    let dots = '';
    let labels = '';
    far.forEach((p, i) => {
        const a = ins.from, z = p.inset!;
        const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2;
        const lift = Math.max(8, Math.hypot(z.x - a.x, z.y - a.y) * 0.3);
        arcs += `M${f1(a.x)} ${f1(a.y)}Q${f1(mx)} ${f1(my - lift)} ${f1(z.x)} ${f1(z.y)}`;
        dots += `<circle class="pp-map-ipt${sel === p.placeKey ? ' is-sel' : ''}" cx="${f1(z.x)}" cy="${f1(z.y)}" r="3.5"/>`;
        if (i < 3) {
            const side = z.x > INSET_W * 2 / 3 ? 'l' : 'r';
            labels += `<span class="pp-map-ilb pp-map-ilb--${side}" style="left:${pct(z.x, INSET_W)};top:${pct(z.y, INSET_H)}">${esc(p.name)}</span>`;
        }
    });
    const svg = `<svg viewBox="0 0 ${INSET_W} ${INSET_H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
        + (land ? `<path class="pp-map-land" d="${land}"/>` : '')
        + `<rect class="pp-map-frame" x="${f1(r.x)}" y="${f1(r.y)}" width="${f1(r.w)}" height="${f1(r.h)}"/>`
        + `<path class="pp-map-arc" d="${arcs}"/>${dots}</svg>`;
    return `<div class="pp-map-inset pp-map-inset--${ins.corner}" role="img" aria-label="${esc(M.inset)}">${svg}${labels}</div>`;
}

function listHtml(plan: MapPlan, S: MapStrings, ctx: PlacesMapCtx, sel: string | null): string {
    const M = S.personPage.map;
    const rows: string[] = [];
    const badge = (p: PlannedPlace): string => {
        if (plan.state === 'noGeo') return '<span class="pp-map-badge pp-map-badge--none" aria-hidden="true"></span>';
        if (plan.state === 'list') return `<span class="pp-map-badge pp-map-badge--${p.geo ? 'dot' : 'none'}" aria-hidden="true"></span>`;
        if (p.rel) return '<span class="pp-map-badge pp-map-badge--rel" aria-hidden="true"></span>';
        return `<span class="pp-map-badge" aria-hidden="true">${p.num}</span>`;
    };
    const ambiguous = (p: PlannedPlace) => (ctx.ambiguous?.has(p.placeKey) ? ` <span class="pp-map-amb">– ${esc(M.ambiguous)}</span>` : '');
    const listed = plan.state === 'map' ? plan.places.filter(p => !p.rel || p.x !== undefined || p.inset) : plan.places;
    const ordered = [...listed.filter(p => !p.rel), ...listed.filter(p => p.rel)];
    for (const p of ordered) {
        const text = p.rel ? relativeEventsText(p.points, S) : ownEventsText(p.points, S, ctx.lang);
        const osa = p.rel ? '' : osaOf(p);
        const selectable = plan.state === 'map';
        const attrs = selectable
            ? ` tabindex="0" data-pp-map-place="${esc(p.placeKey)}"${osa ? ` data-pp-osa="${osa}"` : ''}` : osa ? ` data-pp-osa="${osa}"` : '';
        rows.push(`<li class="pp-map-row${p.rel ? ' pp-map-row--rel' : ''}${selectable && sel === p.placeKey ? ' is-sel' : ''}"${attrs}>`
            + `${badge(p)}<span class="pp-map-rt"><b class="pp-map-name">${esc(p.full)}</b>${text ? ` · <span class="pp-map-ev">${esc(text)}</span>` : ''}${plan.state !== 'map' ? ambiguous(p) : ''}</span></li>`);
    }
    if (plan.noPos.length) {
        const items = plan.noPos.map(p => {
            const first = p.points[0];
            const ev = ownEventsText([first], S, ctx.lang);
            return `${esc(p.full)}${ev ? ` (${esc(ev)}${ctx.ambiguous?.has(p.placeKey) ? ` – ${esc(M.ambiguous)}` : ''})`
                : ctx.ambiguous?.has(p.placeKey) ? ` (${esc(M.ambiguous)})` : ''}`;
        }).join(', ');
        rows.push(`<li class="pp-map-row pp-map-row--nopos"><span class="pp-map-badge pp-map-badge--none" aria-hidden="true"></span>`
            + `<span class="pp-map-rt">${M.noPos(items)}</span></li>`);
    }
    return `<ol class="pp-map-list">${rows.join('')}</ol>`;
}

/**
 * Select a place in a rendered section (app and saved file): the point and the
 * row get `is-sel`; `null` clears. Returns the selected row (for scrolling).
 */
export function selectMapPlace(root: ParentNode, key: string | null): Element | null {
    let row: Element | null = null;
    root.querySelectorAll('.pp-places [data-pp-map-place]').forEach(el => {
        const on = key !== null && el.getAttribute('data-pp-map-place') === key;
        el.classList.toggle('is-sel', on);
        if (on && el.classList.contains('pp-map-row')) row = el;
    });
    return row;
}

/**
 * The saved file's selection script (inline, optional: without it the map is
 * static and nothing breaks). Click / Enter / Space on a point or row selects
 * the place; again on the selected row follows its timeline anchor.
 */
export const PLACES_MAP_SCRIPT = `(function(){
var root=document.querySelector('.pp-places');if(!root)return;
function sel(k){root.querySelectorAll('[data-pp-map-place]').forEach(function(el){el.classList.toggle('is-sel',el.getAttribute('data-pp-map-place')===k);});}
function act(el){var k=el.getAttribute('data-pp-map-place');var was=el.classList.contains('is-sel');sel(k);
if(was&&el.classList.contains('pp-map-row')){var a=el.getAttribute('data-pp-osa');var t=a&&document.getElementById(a);if(t)t.scrollIntoView({block:'center'});}}
root.addEventListener('click',function(e){var el=e.target.closest&&e.target.closest('[data-pp-map-place]');if(el)act(el);});
root.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var el=e.target.closest&&e.target.closest('li[data-pp-map-place]');if(el){e.preventDefault();act(el);}});
})();`;
