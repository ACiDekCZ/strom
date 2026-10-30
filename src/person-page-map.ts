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
 *
 * A small neighbourhood (§1.3a, round 3): when the frame holds almost no
 * border or coast, an orientation layer replaces the graticule (distance
 * rings, a nearby town, an arrow to the regional city beyond the frame,
 * rivers, the region's name, a "where in the country" inset; Natural Earth,
 * src/map-context.ts). Places all within 3 km get no map: the list names the
 * distance and direction from place 1, beside the country inset.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';
import type { StromData, PersonId, PlaceGeo, LifeEventType, CoupleEventType, Person } from './types.js';
import { computePersonLifeline } from './timeline.js';
import { placeKey } from './places.js';
import { yearOf, yearFraction, parseFlexDate } from './dates.js';
import { isLivingPerson } from './privacy.js';
import { lifeEventLabel, coupleEventLabelIn } from './person-sources.js';
import {
    mercator, unmercator, outlinePaths, outlineResolution, outlineLengthInView, viewBounds, linesPath, ringsPath, lengthInView,
    WORLD, type OutlineView, type GeoLine, type GeoBounds,
} from './map-outlines.js';
import { towns, rivers, riverName, regionOf, regionName, countryAt, ringsBounds, type Region } from './map-context.js';
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
    /** "1890–1900" when the date is a range or period; "před 1965" when an event's date says so (`yearText`). */
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
    /**
     * An event's date to the year with its precision ("před 1965", "kolem 1965",
     * "1950–1960"), as the page's header words it; the bare year without it.
     */
    yearText?: (date: string | undefined) => string;
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
        // An event's date that says more than its year ("<1965", a range) keeps it, as in the header.
        const evDate = pt.kind === 'event' && pt.eventId ? person.events?.find(e => e.id === pt.eventId)?.date : undefined;
        const precise = evDate && opts.yearText ? opts.yearText(evDate) : '';
        out.push({
            placeKey: key, place, sortKey: pt.sortKey, year: pt.year,
            ...(precise && precise !== String(pt.year) ? { yearLabel: precise }
                : pt.yearLabel ? { yearLabel: pt.yearLabel } : pt.endYear ? { yearLabel: `${pt.year}–${pt.endYear}` } : {}),
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
    /** Label side on desktop/tablet and on a phone ('hide' also while the point is in a cluster there). */
    side?: { d: LabelSide; p: LabelSide };
    /** Index of the point's cluster in `plan.clusters.d` / `.p`, when it has one there (K4-29). */
    cl?: { d?: number; p?: number };
    /** Places within 3 km (state 'tiny'): distance (km, at least 1) and compass sector (0 = N … 7 = NW) from place 1. */
    from1?: { km: number; dir: number };
}

/** Right, left, above, below (above / below aligned to the point's left edge), or none (number only). */
export type LabelSide = 'l' | 'r' | 'a' | 'b' | 'hide';

/**
 * A cluster of numbered points (K4-29): points whose centres lie closer than
 * 26 px (phone 24) in the frame, chained, drawn as one pill at their centroid
 * ("1–2", "1, 3–4") with one label. Its members' rows are selected together.
 */
export interface MapCluster {
    /** The person's places in it, in the order of their numbers. */
    members: PlannedPlace[];
    /**
     * Children's and partners' places in it (round 5, K5-33): with places of the person a hollow ring
     * after the numbers; alone a hollow pill with their count, no label.
     */
    rels: PlannedPlace[];
    x: number;
    y: number;
    /** The pill's text: the numbers as ranges; the count of places for a pill of relatives' places only. */
    text: string;
    side: LabelSide;
}
/** The orientation layer of a small neighbourhood (§1.3a); positions in view units. */
export interface SmallLayer {
    /** Distance rings around place 1 (the second one not on a phone). */
    rings: {
        x: number; y: number; r: number[]; km: number[];
        /** Each ring's label: its point on the ring, desktop (d) and phone (p), none where no free spot. */
        lab?: { d?: { x: number; y: number }; p?: { x: number; y: number } }[];
    };
    /** The nearest town of 10 000+ in the frame that is not one of the places (not on a phone). */
    anchor?: { name: string; x: number; y: number };
    /** The nearest regional city (or 50 000+) when it lies beyond the frame: a label on that edge. */
    arrow?: { name: string; km: number; dir: 'r' | 'l' | 'u' | 'd'; /** y (r, l) or x (u, d) on the edge, view units */ at: number };
    /** Where the longest river named in the app's language is named (desktop and tablet). */
    river?: { name: string; x: number; y: number };
    /** The first-level region that holds the whole frame. */
    region?: Pick<Region, 'name' | 'en' | 'de'>;
    /**
     * The region's name at the top centre: its font size in px on desktop (d) and a phone (p);
     * missing where it fits no size or would cover a place's label.
     */
    regionFont?: { d?: number; p?: number };
}

/** The "where in the country" inset: the country's outline with the frame (map) or a dot (no map). */
export interface WhereInset {
    /** Map state: the inset's corner; none beside the list. */
    corner?: 'br' | 'tl';
    view: OutlineView;
    rings: GeoLine[];
    rect?: Rect;
    dot?: { x: number; y: number };
}

export interface MapPlan {
    /**
     * 'map': map + list; 'tiny': ≥ 2 places within 3 km — list with distances, no map; 'list': list only
     * (one place with a position); 'noGeo': list, no position at all; 'none': no section.
     */
    state: 'map' | 'tiny' | 'list' | 'noGeo' | 'none';
    places: PlannedPlace[];
    /** The person's places without a position (the "Not on the map" row). */
    noPos: PlannedPlace[];
    view?: OutlineView;
    /** Scale bar: km and its length in view units; none for a world-wide frame. */
    scale?: { km: number; units: number };
    /** Migration path through the numbered places, in view units. */
    route: { x: number; y: number }[];
    /** The path as drawn on desktop (d) and a phone (p): a cluster's members at its pill, no segment inside it. */
    routes?: { d: { x: number; y: number }[]; p: { x: number; y: number }[] };
    /** Clusters of points on desktop and on a phone (K4-29). */
    clusters?: { d: MapCluster[]; p: MapCluster[] };
    inset?: {
        corner: 'br' | 'tl';
        view: OutlineView;
        /** The main frame in inset units. */
        rect: { x: number; y: number; w: number; h: number };
        /** Centre of the main frame in inset units (where the arcs start). */
        from: { x: number; y: number };
    };
    /** A small neighbourhood (§1.3a): the orientation layer instead of the graticule. */
    small?: SmallLayer;
    /** The "where in the country" inset (small neighbourhood without the world inset, 'tiny', 'list'). */
    where?: WhereInset;
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
function insetHits(pts: readonly { x: number; y: number }[], corner: 'br' | 'tl', rects: typeof insetRects = insetRects): number {
    const r = rects(corner);
    const pad = 14;
    let n = 0;
    for (const p of pts) {
        const box = { x: p.x - pad, y: p.y - pad, w: 2 * pad, h: 2 * pad };
        if (overlaps(box, r.d) || overlaps(box, r.p) || overlaps(box, r.l)) n++;
    }
    return n;
}

export interface LabelInput {
    x: number; y: number;
    /** label width in px */
    w: number;
    /** Half the point's width in px (11 for a point, more for a cluster's pill). */
    hw?: number;
}

/** A point's (or pill's) box in view units: `hw` half its width in px, 11 px half its height. */
export function pointRect(p: LabelInput, pxToUnit: number): Rect {
    const hw = (p.hw ?? 11) * pxToUnit, hh = 11 * pxToUnit;
    return { x: p.x - hw, y: p.y - hh, w: 2 * hw, h: 2 * hh };
}

/**
 * A label's box in view units on a side of its point: beside it 5 px off the point's edge, above or
 * below it 3 px off, aligned to the point's left edge (as the CSS of `.lb-d-*` / `.lb-p-*`).
 */
export function labelRect(p: LabelInput, side: Exclude<LabelSide, 'hide'>, pxToUnit: number): Rect {
    const u = pxToUnit, w = p.w * u, h = 20 * u, hw = (p.hw ?? 11) * u;
    if (side === 'r') return { x: p.x + hw + 5 * u, y: p.y - h / 2, w, h };
    if (side === 'l') return { x: p.x - hw - 5 * u - w, y: p.y - h / 2, w, h };
    return { x: p.x - hw, y: side === 'a' ? p.y - 14 * u - h : p.y + 14 * u, w, h };
}

/**
 * Label sides (§1.2, round 4): right of the point (left first for a point in
 * the right third), then left, above, below — the first side clear of the view's
 * edge, a placed label, a point and the obstacles; when none is, the label is
 * left out (number only). Units: view units; `pxToUnit` converts the px sizes.
 */
export function placeLabelSides(
    pts: readonly LabelInput[],
    o: { minX: number; maxX: number; minY: number; maxY: number; pxToUnit: number; obstacles?: readonly Rect[] },
): LabelSide[] {
    const placed: Rect[] = [];
    const pointBoxes = pts.map(p => pointRect(p, o.pxToUnit));
    const third = o.minX + (o.maxX - o.minX) * 2 / 3;
    return pts.map((p, i) => {
        const fits = (r: Rect): boolean =>
            r.x >= o.minX && r.x + r.w <= o.maxX && r.y >= o.minY && r.y + r.h <= o.maxY
            && !placed.some(q => overlaps(q, r))
            && !pointBoxes.some((q, j) => j !== i && overlaps(q, r))
            && !(o.obstacles ?? []).some(q => overlaps(q, r));
        const first: 'l' | 'r' = p.x > third ? 'l' : 'r';
        for (const side of [first, first === 'r' ? 'l' : 'r', 'a', 'b'] as const) {
            const r = labelRect(p, side, o.pxToUnit);
            if (fits(r)) { placed.push(r); return side; }
        }
        return 'hide';
    });
}

/** Numbers as ranges: [1, 2] → "1–2", [1, 3, 4] → "1, 3–4". */
export function numberRanges(nums: readonly number[]): string {
    const ns = [...nums].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < ns.length;) {
        let j = i;
        while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
        parts.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
        i = j + 1;
    }
    return parts.join(', ');
}

/** Groups of points closer than `min` (view units), chained; single points are no group. */
export function chainClusters<T extends { x: number; y: number }>(pts: readonly T[], min: number): T[][] {
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < min) parent[find(j)] = find(i);
    }
    const groups = new Map<number, T[]>();
    pts.forEach((p, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), p]); });
    return [...groups.values()].filter(g => g.length > 1);
}

/** The pill's half width in px: 6 px padding, 2 px border, ≈ 6.5 px a character of 11.5 px digits; at least a point's 11. */
export function pillHalfWidth(text: string): number {
    return Math.max(11, Math.ceil((16 + text.length * 6.5) / 2));
}

/** A cluster's pill half width in px: with places of the person and relatives, the ring (8 px, 4 px off) after the numbers. */
export function clusterHalfWidth(c: Pick<MapCluster, 'text' | 'members' | 'rels'>): number {
    return pillHalfWidth(c.text) + (c.members.length && c.rels.length ? 6 : 0);
}

/** A cluster's label: the members' names (more than two: "first +n") and, on desktop, their years first–last. */
export function clusterLabel(c: Pick<MapCluster, 'members'>, S: MapStrings): { name: string; years: string } {
    const name = S.personPage.map.cluster(c.members.map(m => m.name));
    const ys = c.members.flatMap(m => m.points.map(q => q.year)).filter((y): y is number => y !== null);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return { name, years: !ys.length ? '' : lo === hi ? String(lo) : `${lo}–${hi}` };
}

/**
 * Years of a place for its label: desktop "1860, 1883" (≤ 3) or first–last; phone first–last.
 * A year whose only points carry one worded date ("před 1965") shows it, except inside first–last.
 */
export function labelYears(points: readonly PlacePoint[]): { d: string; p: string } {
    const ys = [...new Set(points.map(p => p.year).filter((y): y is number => y !== null))].sort((a, b) => a - b);
    if (!ys.length) return { d: '', p: '' };
    const worded = (y: number): string => {
        const labels = new Set(points.filter(p => p.year === y).map(p => p.yearLabel ?? ''));
        const only = labels.size === 1 ? [...labels][0] : '';
        return only && !only.includes('–') ? only : String(y);
    };
    const range = ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : worded(ys[0]);
    return { d: ys.length <= 3 ? ys.map(worded).join(', ') : range, p: range };
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
export function planPlacesMap(
    points: readonly PlacePoint[], geo: Readonly<Record<string, PlaceGeo>> | undefined, opts: { kidPlaces: boolean; lang?: Language },
): MapPlan {
    const g = geo ?? {};
    const lang: Language = opts.lang ?? 'en';
    const S = getStringsForLang(lang);
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
    if (ownGeo.length === 1) {
        const where = whereInset(ownGeo[0].geo!);
        return { ...empty, state: 'list', places: own, noPos: [], ...(where ? { where } : {}) };
    }
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

    // All within 3 km (§1.3a): no map, the list with the distance and direction from place 1.
    const close = [...ownGeo, ...rels];
    let maxKm = 0;
    for (let i = 0; i < close.length; i++) for (let j = i + 1; j < close.length; j++) maxKm = Math.max(maxKm, distanceKm(close[i].geo!, close[j].geo!));
    if (maxKm <= TINY_KM) {
        const g1 = ownGeo[0].geo!;
        for (const p of close.slice(1)) {
            const km = distanceKm(g1, p.geo!);
            if (km >= 0.05) p.from1 = { km: Math.max(1, Math.round(km)), dir: compassSector(g1, p.geo!) };
        }
        const where = whereInset(centroidOf(ownGeo.map(p => p.geo!)));
        return { ...empty, state: 'tiny', places: close, noPos, ...(where ? { where } : {}) };
    }

    // The 180th meridian (round 2): when the places' longitudes span more than 180°, negative longitudes
    // +360° give the narrower envelope (the same shift for the points and the outlines).
    const lons = [...ownGeo, ...rels].map(p => p.geo!.lon);
    const lonSpan = (ls: number[]): number => Math.max(...ls) - Math.min(...ls);
    const wrap = lonSpan(lons) > 180 && lonSpan(lons.map(l => (l < 0 ? l + 360 : l))) < lonSpan(lons);
    const lonOf = (geo: PlaceGeo): number => (wrap && geo.lon < 0 ? geo.lon + 360 : geo.lon);
    const merc = (geo: PlaceGeo) => mercator(lonOf(geo), geo.lat);

    // Centre of the neighbourhood: the centroid of the person's places.
    const centroid: PlaceGeo = {
        lat: ownGeo.reduce((s, p) => s + p.geo!.lat, 0) / ownGeo.length,
        lon: ownGeo.reduce((s, p) => s + lonOf(p.geo!), 0) / ownGeo.length,
    };
    const compact = ownGeo.every(p => distanceKm(p.geo!, centroid) <= FAR_KM);
    const near = compact ? rels.filter(p => distanceKm(p.geo!, centroid) <= FAR_KM) : rels;
    const far = compact ? rels.filter(p => distanceKm(p.geo!, centroid) > FAR_KM) : [];

    // Frame: the envelope of the main map's places + 15 % each side, at least 25 km, fitted into the safe area.
    const main = [...ownGeo, ...near];
    const w = main.map(p => merc(p.geo!));
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
    const toView = (geo: PlaceGeo) => {
        const m = merc(geo);
        return { x: (m.x - view.x0) * k, y: (m.y - view.y0) * k };
    };
    for (const p of main) Object.assign(p, toView(p.geo!));

    // Scale bar (hidden for a world-wide frame: the Mercator scale drifts).
    const unitsPerKm = perKm * k;
    const frameKm = VIEW_W / unitsPerKm;
    const scale = frameKm <= 3000 ? scaleBar(unitsPerKm) : undefined;

    // Migration path: the numbered places in the order of life, only changes of place.
    const routePlaces: PlannedPlace[] = [];
    let last = '';
    for (const p of ordered) {
        if (p.rel || p.placeKey === last) continue;
        const gp = groups.get(p.placeKey);
        if (!gp?.geo || gp.x === undefined || gp.y === undefined) continue;
        // Undated events other than birth / death have no place in the order of life.
        if (p.sortKey === null && p.kind !== 'birth' && p.kind !== 'death') continue;
        routePlaces.push(gp);
        last = p.placeKey;
    }
    const route = routePlaces.map(p => ({ x: p.x!, y: p.y! }));

    // Clusters (K4-29): points closer than 26 px on desktop, 24 px on a phone, chained; the relatives'
    // hollow points join them the same way (round 5, K5-33).
    const clusters: { d: MapCluster[]; p: MapCluster[] } = { d: [], p: [] };
    for (const mode of ['d', 'p'] as const) {
        const min = mode === 'd' ? 26 * pxD : 24 * pxP;
        for (const group of chainClusters([...ownGeo, ...near].map(q => ({ q, x: q.x!, y: q.y! })), min)) {
            const all = group.map(m => m.q);
            const ms = all.filter(m => !m.rel).sort((a, b) => a.num - b.num);
            const rs = all.filter(m => m.rel);
            const idx = clusters[mode].length;
            for (const m of all) m.cl = { ...m.cl, [mode]: idx };
            clusters[mode].push({
                members: ms, rels: rs, side: 'hide', text: ms.length ? numberRanges(ms.map(m => m.num)) : String(rs.length),
                x: all.reduce((t, m) => t + m.x!, 0) / all.length, y: all.reduce((t, m) => t + m.y!, 0) / all.length,
            });
        }
    }
    // The path as drawn: a member at its cluster's pill, no segment inside a cluster.
    const routeOf = (mode: 'd' | 'p') => {
        const out: { x: number; y: number }[] = [];
        for (const p of routePlaces) {
            const ci = p.cl?.[mode];
            const c = ci !== undefined ? clusters[mode][ci] : undefined;
            const at = c ? { x: c.x, y: c.y } : { x: p.x!, y: p.y! };
            const prev = out[out.length - 1];
            if (!prev || prev.x !== at.x || prev.y !== at.y) out.push(at);
        }
        return out;
    };
    const routes = { d: routeOf('d'), p: routeOf('p') };

    // World inset for far places.
    let inset: MapPlan['inset'];
    if (far.length) {
        const ownPts = ownGeo.map(p => ({ x: p.x!, y: p.y! }));
        const corner: 'br' | 'tl' = insetHits(ownPts, 'br') <= insetHits(ownPts, 'tl') ? 'br' : 'tl';
        const centre = { x: view.x0 + VIEW_W / 2 / k, y: view.y0 + VIEW_H / 2 / k };
        const fw = far.map(p => merc(p.geo!));
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

    // A small neighbourhood (§1.3a): next to nothing of a border or coast in the frame.
    let small: SmallLayer | undefined;
    let where: WhereInset | undefined;
    const ownPtsView = [...ownGeo, ...near].map(p => ({ x: p.x!, y: p.y! }));
    if (outlineLengthInView(view, outlineResolution(viewBounds(view))) < SMALL_SHARE * VIEW_W) {
        if (!inset) {
            const corner: 'br' | 'tl' = insetHits(ownPtsView, 'br', whereRects) <= insetHits(ownPtsView, 'tl', whereRects) ? 'br' : 'tl';
            where = whereInset(centroid, viewBounds({ ...view, margin: 0 }), corner);
        }
        small = smallLayer({
            view, unitsPerKm, merc, lonOf, p1: ownGeo[0], places: [...ownGeo, ...near], lang,
            obstacles: where?.corner ? [whereRects(where.corner).d] : inset ? [insetRects(inset.corner).d] : [],
            topRightFree: !!where,
            corner: where?.corner ?? inset?.corner,
        });
    }

    // Labels: desktop (the whole view) and phone (the middle 2/3, short years).
    const onMain = [...ownGeo, ...near];
    const deskObst = inset ? [insetRects(inset.corner).d] : where?.corner ? [whereRects(where.corner).d] : [];
    const phoneObst = inset ? [insetRects(inset.corner).p] : where?.corner ? [whereRects(where.corner).p] : [];
    if (small?.anchor) deskObst.push(anchorRect(small.anchor));
    if (small?.arrow) { deskObst.push(arrowRect(small.arrow, 'd')); phoneObst.push(arrowRect(small.arrow, 'p')); }
    // A pill of relatives' places only has no label, but no other label may cover it.
    for (const mode of ['d', 'p'] as const) {
        for (const c of clusters[mode]) {
            if (c.members.length) continue;
            (mode === 'd' ? deskObst : phoneObst).push(pointRect({ x: c.x, y: c.y, w: 0, hw: clusterHalfWidth(c) }, mode === 'd' ? pxD : pxP));
        }
    }
    const attr: Rect = { x: VIEW_W - 150, y: 0, w: 150, h: 18 };
    // Per mode the labels of the points outside a cluster and of the clusters, in the order of the places.
    type Item = { input: LabelInput; set: (side: LabelSide) => void };
    const items = (mode: 'd' | 'p'): Item[] => {
        const out: Item[] = [];
        for (const p of onMain) {
            const ci = p.cl?.[mode];
            if (ci === undefined) {
                out.push({ input: { x: p.x!, y: p.y!, w: labelWidthPx(p.name, labelYears(p.points)[mode]) },
                    set: side => { p.side = { ...(p.side ?? { d: 'hide', p: 'hide' }), [mode]: side }; } });
                continue;
            }
            p.side = { ...(p.side ?? { d: 'hide', p: 'hide' }), [mode]: 'hide' };
            const c = clusters[mode][ci];
            if (c.members[0] !== p) continue;
            const lab = clusterLabel(c, S);
            out.push({ input: { x: c.x, y: c.y, w: labelWidthPx(lab.name, mode === 'd' ? lab.years : ''), hw: clusterHalfWidth(c) },
                set: side => { c.side = side; } });
        }
        return out;
    };
    const itemsD = items('d'), itemsP = items('p');
    const sideD = placeLabelSides(itemsD.map(i => i.input),
        { minX: 4, maxX: VIEW_W - 4, minY: 2, maxY: VIEW_H - 2, pxToUnit: pxD, obstacles: [...deskObst, attr] });
    const sideP = placeLabelSides(itemsP.map(i => i.input),
        { minX: SAFE.x0 + 3, maxX: SAFE.x1 - 3, minY: 2, maxY: VIEW_H - 2, pxToUnit: pxP, obstacles: phoneObst });
    itemsD.forEach((it, i) => it.set(sideD[i]));
    itemsP.forEach((it, i) => it.set(sideP[i]));
    if (small) {
        const labRects = (mode: 'd' | 'p'): Rect[] => {
            const u = mode === 'd' ? pxD : pxP;
            return (mode === 'd' ? itemsD : itemsP).flatMap((it, i) => {
                const side = (mode === 'd' ? sideD : sideP)[i];
                return side === 'hide' ? [pointRect(it.input, u)] : [labelRect(it.input, side, u), pointRect(it.input, u)];
            });
        };
        const rectsD = [...labRects('d'), ...deskObst, ...(where ? [] : [attr])], rectsP = [...labRects('p'), ...phoneObst];
        // The region's name at the top centre (round 4): the biggest size that fits 70 % of the box,
        // none when it would cover a label, a point or an inset.
        if (small.region) {
            const name = regionName(small.region as Region, lang).toLocaleUpperCase(lang);
            const font: { d?: number; p?: number } = {};
            const fit = (mode: 'd' | 'p', sizes: number[], top: number, rects: Rect[]): void => {
                const u = mode === 'd' ? pxD : pxP;
                const boxPx = mode === 'd' ? BOX_PX.desk : BOX_PX.phone;
                const size = sizes.find(z => regionWidthPx(name, z) <= boxPx * 0.7);
                if (size === undefined) return;
                const w = regionWidthPx(name, size) * u;
                const r = { x: VIEW_W / 2 - w / 2, y: top * u, w, h: size * u };
                if (rects.some(q => overlaps(q, r))) return;
                font[mode] = size;
                rects.push(r);
            };
            fit('d', [22, 20, 18, 16], 40, rectsD);
            fit('p', [15, 13, 12], 14, rectsP);
            small.regionFont = font;
        }
        small.rings.lab = ringLabelSpots(small.rings, route, { d: rectsD, p: rectsP });
    }

    const anyCluster = clusters.d.length > 0 || clusters.p.length > 0;
    return {
        state: 'map', places: [...ownGeo, ...near, ...far], noPos, view, ...(scale ? { scale } : {}), route,
        ...(anyCluster ? { clusters, routes } : {}),
        ...(inset ? { inset } : {}), ...(small ? { small } : {}), ...(where ? { where } : {}),
    };
}

// ─── Small neighbourhood (§1.3a) ────────────────────────────────────────────

/** Places at most this far apart get no map (the list names distances). */
export const TINY_KM = 3;
/** Borders and coast inside the frame shorter than this share of its width: a small neighbourhood. */
export const SMALL_SHARE = 0.15;
/** The "where in the country" inset, view box (desktop 150 × 86 px, phone 96 × 56 px). */
export const WHERE_W = 150;
export const WHERE_H = 86;
/** Ring label angles (degrees, counter-clockwise from east): up and to the right first. */
const RING_LABEL_ANGLES = [45, 135, -45, -135, 70, 110, -70, -110, 20, 160, -20, -160];

/** Does the segment a–b pass through the rectangle (sampled every 2 units)? */
function segmentHits(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let i = 0; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
}

/**
 * Where each ring's distance label goes (its text starts 3 px right of the
 * point, its bottom on it): the first angle whose box stays in the visible
 * part and clear of the points, the place labels, the route, the insets and
 * the other ring label. The phone shows only the first ring.
 */
function ringLabelSpots(
    rings: SmallLayer['rings'], route: readonly { x: number; y: number }[], obstacles: { d: readonly Rect[]; p: readonly Rect[] },
): NonNullable<SmallLayer['rings']['lab']> {
    const placed: Record<'d' | 'p', Rect[]> = { d: [], p: [] };
    return rings.r.map((r, i) => {
        const chars = String(rings.km[i]).length + 3;
        const spot = (mode: 'd' | 'p'): { x: number; y: number } | undefined => {
            const u = mode === 'd' ? UNITS_ACROSS.desk / BOX_PX.desk : UNITS_ACROSS.phone / BOX_PX.phone;
            const [minX, maxX] = mode === 'd' ? [4, VIEW_W - 4] : [SAFE.x0 + 3, SAFE.x1 - 3];
            for (const deg of RING_LABEL_ANGLES) {
                const a = (deg * Math.PI) / 180;
                const x = rings.x + r * Math.cos(a), y = rings.y - r * Math.sin(a);
                const box: Rect = { x: x + 2 * u, y: y - 13 * u, w: (chars * 6 + 4) * u, h: 13 * u };
                if (box.x < minX || box.x + box.w > maxX || box.y < 2 || box.y + box.h > VIEW_H - 2) continue;
                if ([...obstacles[mode], ...placed[mode]].some(q => overlaps(q, box))) continue;
                if (route.some((p, j) => j > 0 && segmentHits(route[j - 1], p, box))) continue;
                placed[mode].push(box);
                return { x, y };
            }
            return undefined;
        };
        const d = spot('d');
        const p = i === 0 ? spot('p') : undefined;
        return { ...(d ? { d } : {}), ...(p ? { p } : {}) };
    });
}

/** Ring pairs (km): the first whose inner ring is at least 40 units across (5 and 10 km in a usual frame). */
const RING_STEPS: readonly [number, number][] = [[5, 10], [10, 20], [25, 50], [50, 100], [100, 200]];

function centroidOf(gs: readonly PlaceGeo[]): PlaceGeo {
    return { lat: gs.reduce((s, g) => s + g.lat, 0) / gs.length, lon: gs.reduce((s, g) => s + g.lon, 0) / gs.length };
}

/** Compass sector from a to b: 0 = N, 1 = NE … 7 = NW. */
export function compassSector(a: PlaceGeo, b: PlaceGeo): number {
    const dx = (b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const dy = b.lat - a.lat;
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return ((Math.round(deg / 45) % 8) + 8) % 8;
}

/** The "where" inset's rectangles (view units, with its attribution line) per box shape and corner. */
export function whereRects(corner: 'br' | 'tl'): { d: Rect; p: Rect; l: Rect } {
    const du = UNITS_ACROSS.desk / BOX_PX.desk, pu = UNITS_ACROSS.phone / BOX_PX.phone;
    const dw = WHERE_W * du, dh = (WHERE_H + 16) * du, dm = 12 * du;
    const pw = 96 * pu, ph = (56 + 14) * pu, pm = 8 * pu;
    if (corner === 'br') {
        return {
            d: { x: VIEW_W - dm - dw, y: VIEW_H - dm - dh, w: dw, h: dh },
            p: { x: SAFE.x1 - pm - pw, y: VIEW_H - pm - ph, w: pw, h: ph },
            l: { x: VIEW_W - dm - dw, y: SAFE.y1 - dm - dh, w: dw, h: dh },
        };
    }
    return {
        d: { x: dm, y: dm, w: dw, h: dh },
        p: { x: SAFE.x0 + pm, y: pm, w: pw, h: ph },
        l: { x: dm, y: SAFE.y0 + dm, w: dw, h: dh },
    };
}

/**
 * The "where in the country" inset (§1.3a, item 6): the country at `at`
 * fitted into 150 × 86 with the main frame as a rectangle (`frame`) or a dot.
 * Null when the point lies in no country of the data (the open sea).
 */
export function whereInset(at: PlaceGeo, frame?: GeoBounds, corner?: 'br' | 'tl'): WhereInset | undefined {
    const norm = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
    const rings = countryAt(norm(at.lon), at.lat);
    if (!rings?.length) return undefined;
    const b = ringsBounds(rings);
    const a = mercator(b.west, b.north), z = mercator(b.east, b.south);
    const pad = 7;
    const k = Math.min((WHERE_W - 2 * pad) / Math.max(z.x - a.x, 1e-9), (WHERE_H - 2 * pad) / Math.max(z.y - a.y, 1e-9));
    const cx = (a.x + z.x) / 2, cy = (a.y + z.y) / 2;
    const view: OutlineView = { x0: cx - WHERE_W / 2 / k, y0: cy - WHERE_H / 2 / k, k, width: WHERE_W, height: WHERE_H, margin: 4, minStep: 1 };
    const toW = (lon: number, lat: number) => {
        const m = mercator(norm(lon), lat);
        return { x: (m.x - view.x0) * k, y: (m.y - view.y0) * k };
    };
    const out: WhereInset = { view, rings, ...(corner ? { corner } : {}) };
    if (frame) {
        const shift = frame.west > 180 ? -360 : 0;
        const p = toW(frame.west + shift, frame.north), q = toW(frame.east + shift, frame.south);
        const w = Math.max(q.x - p.x, 5), h = Math.max(q.y - p.y, 3);
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        out.rect = { x: mx - w / 2, y: my - h / 2, w, h };
    } else {
        out.dot = toW(at.lon, at.lat);
    }
    return out;
}

const pxD = UNITS_ACROSS.desk / BOX_PX.desk;
const pxP = UNITS_ACROSS.phone / BOX_PX.phone;

function anchorRect(a: { name: string; x: number }  & { y: number }): Rect {
    return { x: a.x - 6 * pxD, y: a.y - 10 * pxD, w: (16 + a.name.length * 6.6) * pxD, h: 20 * pxD };
}

/** The arrow label's box (view units) on desktop ('d') or a phone ('p'). */
function arrowRect(a: NonNullable<SmallLayer['arrow']>, box: 'd' | 'p'): Rect {
    const u = box === 'd' ? pxD : pxP;
    const w = (a.name.length + String(a.km).length + 6) * 6.4 * u + 14 * u, h = 20 * u;
    const x0 = box === 'd' ? 0 : SAFE.x0, x1 = box === 'd' ? VIEW_W : SAFE.x1;
    const m = 8 * u;
    if (a.dir === 'r') return { x: x1 - m - w, y: a.at - h / 2, w, h };
    if (a.dir === 'l') return { x: x0 + m, y: a.at - h / 2, w, h };
    const at = box === 'd' ? arrowX(a.at).d : SAFE.x0 + arrowX(a.at).p * (SAFE.x1 - SAFE.x0) / 100;
    return { x: at - w / 2, y: a.dir === 'u' ? m : VIEW_H - m - h, w, h };
}

/** An up/down arrow's x: desktop in view units, phone in percent of the visible width (clear of the scale bar and the inset). */
function arrowX(at: number): { d: number; p: number } {
    const d = Math.min(430, Math.max(190, at));
    const p = Math.min(SAFE.x0 + 235, Math.max(SAFE.x0 + 170, at));
    return { d, p: ((p - SAFE.x0) / (SAFE.x1 - SAFE.x0)) * 100 };
}

/** The region name's width in px: Strom Serif capitals (about 0.7 em) with 0.32 em letter spacing. */
export function regionWidthPx(name: string, size: number): number {
    return Math.ceil(name.length * size * 1.02);
}

interface SmallInput {
    lang: Language;
    view: OutlineView;
    unitsPerKm: number;
    merc: (g: PlaceGeo) => { x: number; y: number };
    lonOf: (g: PlaceGeo) => number;
    p1: PlannedPlace;
    places: readonly PlannedPlace[];
    obstacles: readonly Rect[];
    /** The attribution is not in the top right (it sits under the "where" inset). */
    topRightFree: boolean;
    /** The corner the inset takes (the arrow keeps clear of it). */
    corner?: 'br' | 'tl';
}

/** The orientation layer (§1.3a, items 1–5). */
function smallLayer(o: SmallInput): SmallLayer {
    const { view, unitsPerKm } = o;
    const g1 = o.p1.geo!;
    const toView = (lon: number, lat: number) => {
        const m = o.merc({ lon, lat });
        return { x: (m.x - view.x0) * view.k, y: (m.y - view.y0) * view.k };
    };
    const inView = (q: { x: number; y: number }, m = 0) => q.x >= m && q.x <= VIEW_W - m && q.y >= m && q.y <= VIEW_H - m;
    const wrapLon = (lon: number) => o.lonOf({ lon, lat: 0 });

    // 1. Distance rings around place 1.
    const pair = RING_STEPS.find(([a]) => a * unitsPerKm >= 40) ?? RING_STEPS[RING_STEPS.length - 1];
    const rings = { x: o.p1.x!, y: o.p1.y!, km: [...pair], r: pair.map(km => km * unitsPerKm) };

    // The person's places: a town there is not an anchor (by name or within 2 km).
    const placeNames = new Set(o.places.flatMap(p => [placeKey(p.name), placeKey(p.full)]));
    const isPlace = (t: { name: string; lon: number; lat: number }) =>
        placeNames.has(placeKey(t.name)) || o.places.some(p => distanceKm(p.geo!, t) < 2);
    const pointBoxes: Rect[] = o.places.map(p => ({ x: p.x! - 14, y: p.y! - 14, w: 28, h: 28 }));
    const attr: Rect = { x: VIEW_W - 150, y: 0, w: 150, h: 18 };
    const blocked = (r: Rect) => [...pointBoxes, ...o.obstacles, ...(o.topRightFree ? [] : [attr])].some(q => overlaps(q, r));

    // Towns near place 1 (a box of about ±330 km), with view positions.
    const near = towns().filter(t => Math.abs(t.lat - g1.lat) < 3 && Math.abs(wrapLon(t.lon) - o.lonOf(g1)) < 5)
        .map(t => ({ ...t, km: distanceKm(g1, t), v: toView(wrapLon(t.lon), t.lat) }))
        .sort((a, b) => a.km - b.km);

    // 2. The biggest town inside the frame that is not a place of the person (round 4: whatever its size;
    //    Natural Earth holds only notable towns), the nearer of two of one size class.
    let anchor: SmallLayer['anchor'];
    for (const t of [...near].sort((a, b) => b.pop - a.pop || a.km - b.km)) {
        if (!inView(t.v, 16) || isPlace(t)) continue;
        const a = { name: t.name, x: t.v.x, y: t.v.y };
        const r = anchorRect(a);
        if (r.x + r.w > VIEW_W - 4 || blocked(r)) continue;
        anchor = a;
        break;
    }

    // 3. The nearest regional city (or 50 000+), when it lies beyond the frame.
    let arrow: SmallLayer['arrow'];
    const city = near.find(t => t.big);
    if (city && city.km <= FAR_KM && !inView(city.v)) {
        const dx = city.v.x - rings.x, dy = city.v.y - rings.y;
        const horiz = Math.abs(dx) >= Math.abs(dy);
        const dir: 'r' | 'l' | 'u' | 'd' = horiz ? (dx > 0 ? 'r' : 'l') : (dy < 0 ? 'u' : 'd');
        const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
        let at: number;
        if (horiz) {
            const ex = dx > 0 ? VIEW_W : 0;
            const y = rings.y + dy * ((ex - rings.x) / dx);
            // Clear of the attribution (top right), the scale bar (bottom left) and the inset's corner.
            const lo = dir === 'r' ? (o.topRightFree ? 0.1 : 0.14) : o.corner === 'tl' ? 0.42 : 0.1;
            const hi = dir === 'r' ? (o.corner === 'br' ? 0.6 : 0.86) : 0.8;
            at = clamp(y, lo * VIEW_H, hi * VIEW_H);
        } else {
            const ey = dy < 0 ? 0 : VIEW_H;
            at = clamp(rings.x + dx * ((ey - rings.y) / dy), 0, VIEW_W);
        }
        arrow = { name: city.name, km: Math.max(1, Math.round(city.km)), dir, at };
    }

    // 4. Rivers: name the longest one in the frame (on a vertex clear of the points and the inset).
    let river: SmallLayer['river'];
    let best = 60;
    for (const rv of rivers()) {
        // Named in the app's language only (never another language's name).
        const name = riverName(rv, o.lang);
        if (!name) continue;
        const len = lengthInView(rv.lines, view);
        if (len <= best) continue;
        const vs: { x: number; y: number }[] = [];
        for (const l of rv.lines) for (let i = 0; i + 1 < l.c.length; i += 2) {
            const q = toView(wrapLon(l.c[i]), l.c[i + 1]);
            if (inView(q, 24)) vs.push(q);
        }
        const mid = Math.floor(vs.length / 2);
        const order = vs.map((q, i) => ({ q, d: Math.abs(i - mid) })).sort((a, b) => a.d - b.d).map(e => e.q);
        const spot = order.find(q => {
            const r = { x: q.x - 4, y: q.y - 18, w: name.length * 6 + 8, h: 16 };
            return !blocked(r) && !(anchor && overlaps(r, anchorRect(anchor)));
        });
        if (!spot) continue;
        best = len;
        river = { name, x: spot.x, y: spot.y };
    }

    // 5. The region, when it holds the whole frame (a grid of 5 × 3 points and the places).
    const probe: { lon: number; lat: number }[] = [];
    for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fy of [0, 0.5, 1]) {
        probe.push(unmercator(view.x0 + (fx * VIEW_W) / view.k, view.y0 + (fy * VIEW_H) / view.k));
    }
    probe.push(...o.places.map(p => ({ lon: p.geo!.lon, lat: p.geo!.lat })));
    const reg = regionOf(probe);

    return {
        rings,
        ...(anchor ? { anchor } : {}), ...(arrow ? { arrow } : {}), ...(river ? { river } : {}),
        ...(reg ? { region: { name: reg.name, en: reg.en, de: reg.de } } : {}),
    };
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

/** "Václav (syn): vystěhování 1913, úmrtí 1968; Marie (dcera): úmrtí 1950" (the name in the nominative, round 2). */
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
        return M.kidRow(r.name, M.rel[r.role], evs);
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
    const plan = planPlacesMap(points, geo, { kidPlaces: ctx.kidPlaces, lang: ctx.lang });
    if (plan.state === 'none') return '';
    const S = getStringsForLang(ctx.lang);
    const M = S.personPage.map;
    const app = ctx.mode === 'app';
    const sel = ctx.selected ?? null;
    const id = ctx.id ?? 'pp-sec-places';

    const hasRel = points.some(p => p.rel && geo?.[p.placeKey]);
    const tools: string[] = [];
    const mapLike = plan.state === 'map' || plan.state === 'tiny';
    if (app && mapLike && hasRel) {
        tools.push(`<button type="button" class="pp-toggle" role="switch" aria-checked="${ctx.kidPlaces}" data-pp-switch="kidPlaces">${esc(M.kids)}</button>`);
    }
    if (app && mapLike) tools.push(`<button type="button" class="pp-act pp-map-open" data-pp-action="map:open">${esc(M.open)}</button>`);
    const head = `<div class="pp-sec-head"><h2>${esc(M.title)}</h2>${tools.length ? `<div class="pp-toggles pp-map-tools">${tools.join('')}</div>` : ''}</div>`;

    const map = plan.state === 'map' ? mapHtml(plan, S, sel, ctx.lang) : '';
    const list = listHtml(plan, S, ctx, sel);
    const note = plan.state === 'noGeo'
        ? `<p class="pp-map-note">${esc(M.noGeo)}${app ? ` ${esc(M.noGeoHint)}` : ''}</p>` : '';
    // No map ('tiny', 'list'): the list beside the "where in the country" inset (§1.3a).
    if (plan.state !== 'map' && plan.where) {
        const sub = plan.state === 'tiny' ? `<p class="pp-map-sub">${esc(M.tiny)}</p>` : '';
        return `<section class="pp-sec pp-sec--places pp-places" id="${esc(id)}">${head}`
            + `<div class="pp-map-brief"><div class="pp-map-brief-main">${sub}${list}</div>${whereHtml(plan.where, S)}</div>${note}</section>`;
    }
    const sub = plan.state === 'tiny' ? `<p class="pp-map-sub">${esc(M.tiny)}</p>` : '';
    return `<section class="pp-sec pp-sec--places pp-places" id="${esc(id)}">${head}${sub}${map}${list}${note}</section>`;
}

/** The "where in the country" inset: the country, the frame (map) or a dot (beside the list), the attribution under it. */
function whereHtml(w: WhereInset, S: MapStrings): string {
    const M = S.personPage.map;
    const land = ringsPath(w.rings, w.view);
    const mark = w.rect
        ? `<rect class="pp-map-frame pp-map-wframe" x="${f1(w.rect.x)}" y="${f1(w.rect.y)}" width="${f1(w.rect.w)}" height="${f1(w.rect.h)}"/>`
        : w.dot ? `<circle class="pp-map-wdot" cx="${f1(w.dot.x)}" cy="${f1(w.dot.y)}" r="3"/>` : '';
    const cls = w.corner ? `pp-map-where pp-map-where--${w.corner}` : 'pp-map-where pp-map-where--side';
    return `<div class="${cls}"><svg viewBox="0 0 ${WHERE_W} ${WHERE_H}" role="img" aria-label="${esc(M.where)}" focusable="false">`
        + (land ? `<path class="pp-map-cty" d="${land}"/>` : '') + `${mark}</svg><span class="pp-map-wattr">${esc(M.attr)}</span></div>`;
}

/** The orientation layer's SVG (rivers, rings) and its HTML labels (§1.3a). */
function smallHtml(plan: MapPlan, S: MapStrings, lang: Language): { svg: string; html: string; box: string } {
    const M = S.personPage.map;
    const sm = plan.small!;
    const v = plan.view!;
    const riverLines = rivers().flatMap(r => r.lines);
    const riverD = linesPath(riverLines, v);
    let svg = riverD ? `<path class="pp-map-river" d="${riverD}"/>` : '';
    sm.rings.r.forEach((r, i) => {
        svg += `<circle class="pp-map-ring${i ? ' pp-map-ring--2' : ''}" cx="${f1(sm.rings.x)}" cy="${f1(sm.rings.y)}" r="${f1(r)}"/>`;
    });
    let html = '';
    // Ring labels on the ring, where the plan found room (desktop and phone apart when they differ).
    (sm.rings.lab ?? []).forEach((lab, i) => {
        const span = (q: { x: number; y: number }, only: '' | 'd' | 'p') =>
            `<span class="pp-map-rl${i ? ' pp-map-rl--2' : ''}${only ? ` pp-map-rl--${only}` : ''}" style="left:${pct(q.x, VIEW_W)};top:${pct(q.y, VIEW_H)}" aria-hidden="true">${esc(M.km(sm.rings.km[i]))}</span>`;
        const same = lab.d && lab.p && lab.d.x === lab.p.x && lab.d.y === lab.p.y;
        if (same) html += span(lab.d!, '');
        else {
            if (lab.d) html += span(lab.d, 'd');
            if (lab.p) html += span(lab.p, 'p');
        }
    });
    // The region at the top centre in the size the plan found, per box (none where it found none).
    const rf = sm.regionFont ?? {};
    if (sm.region && (rf.d || rf.p)) {
        const name = regionName(sm.region as Region, lang).toLocaleUpperCase(lang);
        const cls = `pp-map-region${rf.d ? '' : ' rg-d-hide'}${rf.p ? '' : ' rg-p-hide'}`;
        html += `<span class="${cls}" style="--fd:${rf.d ?? 16}px;--fp:${rf.p ?? 12}px" aria-hidden="true">${esc(name)}</span>`;
    }
    if (sm.river) {
        html += `<span class="pp-map-rvl" style="left:${pct(sm.river.x, VIEW_W)};top:${pct(sm.river.y, VIEW_H)}" aria-hidden="true">${esc(sm.river.name)}</span>`;
    }
    if (sm.anchor) {
        html += `<span class="pp-map-anc" style="left:${pct(sm.anchor.x, VIEW_W)};top:${pct(sm.anchor.y, VIEW_H)}">${esc(sm.anchor.name)}</span>`;
    }
    let box = '';
    if (sm.arrow) {
        const a = sm.arrow;
        const glyph = { r: '→', l: '←', u: '↑', d: '↓' }[a.dir];
        const pos = a.dir === 'r' || a.dir === 'l' ? `top:${pct(a.at, VIEW_H)}` : `--xd:${f1(arrowX(a.at).d / VIEW_W * 100)}%;--xp:${f1(arrowX(a.at).p)}%`;
        box = `<span class="pp-map-arrow pp-map-arrow--${a.dir}" style="${pos}">${esc(M.toTown(a.name, a.km, glyph))}</span>`;
    }
    return { svg, html, box };
}

function mapHtml(plan: MapPlan, S: MapStrings, sel: string | null, lang: Language): string {
    const M = S.personPage.map;
    const v = plan.view!;
    const b = viewBounds(v);
    const res = outlineResolution(b);
    const lines = outlinePaths(v, res);
    const small = plan.small ? smallHtml(plan, S, lang) : null;

    // Graticule: meridians and parallels at a round step (0.05°, 0.1° … in a neighbourhood);
    // a small neighbourhood has the distance rings instead (§1.3a).
    const lonSpan = b.east - b.west;
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30].find(s => lonSpan / s <= 10) ?? 30;
    let grid = '';
    if (!small) for (let lon = Math.ceil(b.west / step) * step; lon <= b.east; lon += step) {
        const x = (mercator(lon, 0).x - v.x0) * v.k;
        grid += `M${f1(x)} -40V360`;
    }
    if (!small) for (let lat = Math.ceil(b.south / step) * step; lat <= b.north; lat += step) {
        const y = (mercator(0, lat).y - v.y0) * v.k;
        grid += `M-40 ${f1(y)}H680`;
    }

    // The path; with clusters as drawn per box (no segment inside a cluster), apart when the boxes differ.
    const path = (pts: { x: number; y: number }[], cls = '') => (pts.length >= 2
        ? `<path class="pp-map-route${cls}" d="M${pts.map(p => `${f1(p.x)} ${f1(p.y)}`).join('L')}"/>` : '');
    const rd = plan.routes?.d ?? plan.route, rp = plan.routes?.p ?? plan.route;
    const route = path(rd) === path(rp) ? path(rd) : path(rd, ' r-d') + path(rp, ' r-p');
    const svg = `<svg class="pp-map-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
        + (grid ? `<path class="pp-map-grid" d="${grid}"/>` : '')
        + (small?.svg ?? '')
        + (lines.coast ? `<path class="pp-map-coast" d="${lines.coast}"/>` : '')
        + (lines.borders ? `<path class="pp-map-border" d="${lines.borders}"/>` : '')
        + route + '</svg>';

    let pts = '';
    let labels = '';
    // Relatives' hollow circles under the numbered points.
    const onMain = plan.places.filter(p => p.x !== undefined && p.y !== undefined);
    for (const p of [...onMain.filter(q => q.rel), ...onMain.filter(q => !q.rel)]) {
        const isSel = isSelected(sel, [p.placeKey]) ? ' is-sel' : '';
        const pos = `left:${pct(p.x!, VIEW_W)};top:${pct(p.y!, VIEW_H)}`;
        // A point inside a cluster gives way to the cluster's pill in that box.
        const inCl = `${p.cl?.d !== undefined ? ' cl-d' : ''}${p.cl?.p !== undefined ? ' cl-p' : ''}`;
        if (p.rel) {
            pts += `<button type="button" class="pp-map-pt pp-map-pt--rel${inCl}${isSel}" style="${pos}" data-pp-map-place="${esc(p.placeKey)}" aria-label="${esc(p.full)}"></button>`;
        } else {
            pts += `<button type="button" class="pp-map-pt${inCl}${isSel}" style="${pos}" data-pp-map-place="${esc(p.placeKey)}" aria-label="${p.num} ${esc(p.full)}">${p.num}</button>`;
        }
        const yrs = labelYears(p.points);
        const side = p.side ?? { d: 'r', p: 'r' };
        if (side.d === 'hide' && side.p === 'hide') continue;
        labels += `<span class="pp-map-lb lb-d-${side.d} lb-p-${side.p}${p.rel ? ' pp-map-lb--rel' : ''}" style="${pos}" aria-hidden="true">`
            + `${esc(p.name)}${yrs.d ? `<span class="pp-map-yr y-d">${esc(yrs.d)}</span>` : ''}${yrs.p ? `<span class="pp-map-yr y-p">${esc(yrs.p)}</span>` : ''}</span>`;
    }

    // Clusters (K4-29): one pill and one label each, per box; a cluster alike in both boxes once.
    const cd = plan.clusters?.d ?? [], cp = plan.clusters?.p ?? [];
    const same = (a: PlannedPlace[], b: PlannedPlace[]) => a.length === b.length && a.every((m, i) => m === b[i]);
    const sameAs = (c: MapCluster, list: MapCluster[]) => list.find(o => same(o.members, c.members) && same(o.rels, c.rels));
    const clusterHtml = (c: MapCluster, sides: { d: LabelSide; p: LabelSide }, only: '' | 'd' | 'p') => {
        // The relatives' places are selected with the pill too (round 5, K5-33).
        const keys = [...c.members, ...c.rels].map(m => m.placeKey);
        const isSel = isSelected(sel, keys) ? ' is-sel' : '';
        const pos = `left:${pct(c.x, VIEW_W)};top:${pct(c.y, VIEW_H)}`;
        const lab = clusterLabel(c, S);
        const relOnly = !c.members.length;
        const aria = c.rels.length
            ? M.clusterAria(relOnly ? '' : c.text, c.members.length, c.rels.length)
            : `${c.text} ${c.members.map(m => m.full).join(', ')}`;
        // A pill of relatives' places only names them in its tooltip (it has no label).
        const title = relOnly ? ` title="${esc(c.rels.map(m => m.name).join(', '))}"` : '';
        const ring = c.rels.length && !relOnly ? '<span class="pp-map-cl-ring" aria-hidden="true"></span>' : '';
        pts += `<button type="button" class="pp-map-pt pp-map-cl${relOnly ? ' pp-map-cl--rel' : ''}${only ? ` pp-map-cl--${only}` : ''}${isSel}" style="${pos}" data-pp-map-place="${esc(keys.join(KEY_SEP))}" aria-label="${esc(aria)}"${title}>${esc(c.text)}${ring}</button>`;
        if (relOnly || (sides.d === 'hide' && sides.p === 'hide')) return;
        labels += `<span class="pp-map-lb pp-map-lb--cl lb-d-${sides.d} lb-p-${sides.p}" style="${pos};--hw:${clusterHalfWidth(c)}px" aria-hidden="true">`
            + `${esc(lab.name)}${lab.years ? `<span class="pp-map-yr y-d">${esc(lab.years)}</span>` : ''}</span>`;
    };
    for (const c of cd) {
        const twin = sameAs(c, cp);
        clusterHtml(c, { d: c.side, p: twin ? twin.side : 'hide' }, twin ? '' : 'd');
    }
    for (const c of cp) if (!sameAs(c, cd)) clusterHtml(c, { d: 'hide', p: c.side }, 'p');

    const scale = plan.scale
        ? `<div class="pp-map-scale" style="--u:${f1(plan.scale.units)}" aria-hidden="true"><span class="pp-map-scale-bar"></span><span class="pp-map-scale-t">${esc(M.km(plan.scale.km))}</span></div>` : '';
    const inset = plan.inset ? insetHtml(plan, S, sel) : '';
    // The attribution sits under the "where" inset when there is one, else top right.
    const attr = plan.where?.corner ? whereHtml(plan.where, S) : `<div class="pp-map-attr">${esc(M.attr)}</div>`;
    return `<div class="pp-map pp-wide${small ? ' pp-map--small' : ''}" role="group" aria-label="${esc(M.aria)}"><div class="pp-map-in">${svg}${small?.html ?? ''}${pts}${labels}</div>`
        + `${attr}${small?.box ?? ''}${scale}${inset}</div>`;
}

/** The inset's width in px: on a desktop (31 % of a ~680 px map) and on a phone (40 % of ~350 px). */
const INSET_PX_WIDE = 210;
const INSET_PX_PHONE = 140;

type InsetLabel = { x: number; y: number; name: string; side: 'l' | 'r'; v?: 'up' | 'dn'; phone: boolean };
type InsetDot = { x: number; y: number; name: string; keys: string[] };

/** The inset's dots: far places, those closer than `min` (inset units) chained into one dot at their centroid. */
function insetDots(far: readonly PlannedPlace[], min: number, S: MapStrings): InsetDot[] {
    const pts = far.map(p => ({ p, x: p.inset!.x, y: p.inset!.y }));
    const groups = chainClusters(pts, min);
    const grouped = new Set(groups.flat());
    const out: InsetDot[] = [];
    for (const q of pts) {
        if (!grouped.has(q)) { out.push({ x: q.x, y: q.y, name: q.p.name, keys: [q.p.placeKey] }); continue; }
        const g = groups.find(gr => gr[0] === q);
        if (!g) continue;
        out.push({
            x: g.reduce((t, m) => t + m.x, 0) / g.length, y: g.reduce((t, m) => t + m.y, 0) / g.length,
            name: S.personPage.map.cluster(g.map(m => m.p.name)), keys: g.map(m => m.p.placeKey),
        });
    }
    return out;
}

/**
 * The inset's labels (at most three), each beside its dot: on the side with room, then above or
 * below it; a label that finds no free place is left out (the list under the map names the place).
 * Labels never cover another label or another place's dot (New York beside Chicago). Placed for a
 * desktop's inset; `phone` false = that label does not fit the phone's smaller inset (hidden there).
 */
export function insetLabels(dots: { x: number; y: number; name: string }[]): InsetLabel[] {
    type Box = { l: number; r: number; t: number; b: number };
    const hit = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const boxAt = (d: { x: number; y: number; name: string }, side: 'l' | 'r', v: 'up' | 'dn' | undefined, px: number): Box => {
        const u = INSET_W / px;
        const h = 13 * u, gap = 6 * u, w = (d.name.length * 5.6 + 6) * u;
        const l = side === 'r' ? d.x + gap : d.x - gap - w;
        const t = v === 'up' ? d.y - h - u : v === 'dn' ? d.y + u : d.y - h / 2;
        return { l, r: l + w, t, b: t + h };
    };
    const dotsAt = (d: { x: number; y: number }, px: number): Box[] => {
        const r = 4.5 * INSET_W / px;
        return dots.filter(o => o !== d).map(o => ({ l: o.x - r, r: o.x + r, t: o.y - r, b: o.y + r }));
    };
    const free = (box: Box, placed: Box[], others: Box[]) => box.l >= 0 && box.r <= INSET_W && box.t >= 0 && box.b <= INSET_H
        && !placed.some(p => hit(p, box)) && !others.some(o => hit(o, box));
    const wide: Box[] = [];
    const phone: Box[] = [];
    const out: InsetLabel[] = [];
    for (const d of dots) {
        if (out.length >= 3) break;
        const pref: 'l' | 'r' = d.x > INSET_W * 2 / 3 ? 'l' : 'r';
        const other: 'l' | 'r' = pref === 'l' ? 'r' : 'l';
        const tries: { side: 'l' | 'r'; v?: 'up' | 'dn' }[] = [{ side: pref }, { side: other }, { side: pref, v: 'up' }, { side: pref, v: 'dn' }, { side: other, v: 'up' }, { side: other, v: 'dn' }];
        const t = tries.find(c => free(boxAt(d, c.side, c.v, INSET_PX_WIDE), wide, dotsAt(d, INSET_PX_WIDE)));
        if (!t) continue;
        wide.push(boxAt(d, t.side, t.v, INSET_PX_WIDE));
        const small = boxAt(d, t.side, t.v, INSET_PX_PHONE);
        const fitsPhone = free(small, phone, dotsAt(d, INSET_PX_PHONE));
        if (fitsPhone) phone.push(small);
        out.push({ x: d.x, y: d.y, name: d.name, side: t.side, ...(t.v ? { v: t.v } : {}), phone: fitsPhone });
    }
    return out;
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
    // Dots closer than 26 px (phone 24) in the inset are one dot at their centroid with one label (K4-29).
    const groupsFor = (px: number, min: number): InsetDot[] => insetDots(far, min * INSET_W / px, S);
    const wide = groupsFor(INSET_PX_WIDE, 26), small = groupsFor(INSET_PX_PHONE, 24);
    const same = wide.length === small.length && wide.every((d, i) => d.keys.join(KEY_SEP) === small[i].keys.join(KEY_SEP));
    const drawDots = (list: InsetDot[], only: '' | 'd' | 'p') => {
        for (const d of list) {
            const a = ins.from;
            const mx = (a.x + d.x) / 2, my = (a.y + d.y) / 2;
            const lift = Math.max(8, Math.hypot(d.x - a.x, d.y - a.y) * 0.3);
            const arc = `M${f1(a.x)} ${f1(a.y)}Q${f1(mx)} ${f1(my - lift)} ${f1(d.x)} ${f1(d.y)}`;
            if (only) dots += `<path class="pp-map-arc pp-map-i--${only}" d="${arc}"/>`;
            else arcs += arc;
            dots += `<circle class="pp-map-ipt${isSelected(sel, d.keys) ? ' is-sel' : ''}${only ? ` pp-map-i--${only}` : ''}" cx="${f1(d.x)}" cy="${f1(d.y)}" r="3.5"/>`;
        }
    };
    drawDots(wide, same ? '' : 'd');
    if (!same) drawDots(small, 'p');
    const label = (l: InsetLabel, extra: string) =>
        `<span class="pp-map-ilb pp-map-ilb--${l.side}${l.v ? ` pp-map-ilb--${l.v}` : ''}${extra}" style="left:${pct(l.x, INSET_W)};top:${pct(l.y, INSET_H)}">${esc(l.name)}</span>`;
    for (const l of insetLabels(wide)) labels += label(l, same ? (l.phone ? '' : ' pp-map-ilb--wide') : ' pp-map-i--d');
    if (!same) for (const l of insetLabels(small)) if (l.phone) labels += label(l, ' pp-map-i--p');
    const svg = `<svg viewBox="0 0 ${INSET_W} ${INSET_H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
        + (land ? `<path class="pp-map-land" d="${land}"/>` : '')
        + `<rect class="pp-map-frame" x="${f1(r.x)}" y="${f1(r.y)}" width="${f1(r.w)}" height="${f1(r.h)}"/>`
        + `<path class="pp-map-arc" d="${arcs}"/>${dots}</svg>`;
    return `<div class="pp-map-inset pp-map-inset--${ins.corner}" role="img" aria-label="${esc(M.inset)}">${svg}${labels}</div>`;
}

function listHtml(plan: MapPlan, S: MapStrings, ctx: PlacesMapCtx, sel: string | null): string {
    const M = S.personPage.map;
    const rows: string[] = [];
    const first = plan.places.find(p => p.num === 1);
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
        const selectable = plan.state === 'map' || plan.state === 'tiny';
        // Distance and direction from place 1, named by its badge (round 4: no inflected place name).
        const mini = `<span class="pp-mini" role="img" aria-label="${esc(M.placeN(1))}">1</span>`;
        const from = p.from1 && first ? `<span class="pp-map-from">${M.near(p.from1.km, esc(M.dirs[p.from1.dir]), mini)}</span>` : '';
        const attrs = selectable
            ? ` tabindex="0" data-pp-map-place="${esc(p.placeKey)}"${osa ? ` data-pp-osa="${osa}"` : ''}` : osa ? ` data-pp-osa="${osa}"` : '';
        rows.push(`<li class="pp-map-row${p.rel ? ' pp-map-row--rel' : ''}${selectable && isSelected(sel, [p.placeKey]) ? ' is-sel' : ''}"${attrs}>`
            + `${badge(p)}<span class="pp-map-rt"><b class="pp-map-name">${esc(p.full)}</b>${from}${text ? ` · <span class="pp-map-ev">${esc(text)}</span>` : ''}${plan.state !== 'map' ? ambiguous(p) : ''}</span></li>`);
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
 * Separator of the place keys of a cluster's pill in `data-pp-map-place` (a
 * place key never holds a tab: placeKey collapses white space).
 */
export const KEY_SEP = '\t';

/** Whether an element with these place keys is selected by a selection (one key, or a cluster's keys). */
export function isSelected(sel: string | null | undefined, keys: readonly string[]): boolean {
    if (!sel) return false;
    const on = sel.split(KEY_SEP);
    return keys.some(k => on.includes(k));
}

/**
 * Select a place in a rendered section (app and saved file): the point and the
 * row get `is-sel`; `null` clears. A cluster's pill selects all its places
 * (their keys tab-separated); a pill is selected with any of its places.
 * Returns the first selected row (for scrolling).
 */
export function selectMapPlace(root: ParentNode, key: string | null): Element | null {
    let row: Element | null = null;
    root.querySelectorAll('.pp-places [data-pp-map-place]').forEach(el => {
        const on = isSelected(key, (el.getAttribute('data-pp-map-place') ?? '').split(KEY_SEP));
        el.classList.toggle('is-sel', on);
        if (on && !row && el.classList.contains('pp-map-row')) row = el;
    });
    return row;
}

/**
 * The saved file's selection script (inline, optional: without it the map is
 * static and nothing breaks). Click / Enter / Space on a point or row selects
 * the place; again on the selected row follows its timeline anchor; a place
 * in the text (an anchor to the section) selects its place too.
 */
export const PLACES_MAP_SCRIPT = `(function(){
var root=document.querySelector('.pp-places');if(!root)return;
function sel(k){var on=(k||'').split('\\t');root.querySelectorAll('[data-pp-map-place]').forEach(function(el){el.classList.toggle('is-sel',!!k&&el.getAttribute('data-pp-map-place').split('\\t').some(function(x){return on.indexOf(x)>=0;}));});}
function act(el){var k=el.getAttribute('data-pp-map-place');var was=el.classList.contains('is-sel');sel(k);
if(was&&el.classList.contains('pp-map-row')){var a=el.getAttribute('data-pp-osa');var t=a&&document.getElementById(a);if(t)t.scrollIntoView({block:'center'});}}
root.addEventListener('click',function(e){var el=e.target.closest&&e.target.closest('[data-pp-map-place]');if(el)act(el);});
root.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var el=e.target.closest&&e.target.closest('li[data-pp-map-place]');if(el){e.preventDefault();act(el);}});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-pp-to-place]');if(a)sel(a.getAttribute('data-pp-to-place'));});
})();`;
