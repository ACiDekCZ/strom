/**
 * The ancestors' path to one person on the map (spec 054, Migration over
 * time with a chosen person): who the ancestors are, where and when each of
 * them was born, which grandparent line (quarter) and great-grandparent line
 * (eighth) each belongs to, and the parent → child lines between their
 * places for a given year.
 *
 * Pure data, no DOM: the map view hands in the tree, optionally a resolver
 * from a place key to the map point it is drawn at (a town gathers its
 * houses into one point), and a viewport test as a predicate. Without a
 * chosen person nothing here runs; the map keeps src/map-time.ts.
 *
 * Numbering: `rel` is the ahnentafel number relative to the chosen person
 * (1 = the person, 2 = the father, 3 = the mother, 4 = the father's father …),
 * found by walking parents from the person (2·rel father, 2·rel+1 mother;
 * the same father/mother choice as the fan chart). A person reached along
 * several paths (implex) gets one record per path; a person already expanded
 * within the same line is not expanded again, which keeps a heavily
 * intermarried tree bounded (its further ancestors are already in that line).
 */

import { StromData, Person, PersonId, PlaceGeo, parentSlots } from './types.js';
import { placeKey } from './places.js';
import { yearOf } from './dates.js';

export type LineMode = 'quarter' | 'eighth';
export type LineClass = 'trunk' | `q${0 | 1 | 2 | 3}` | `e${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;

/** Where a person (or the target) stands on the map: which fact the place comes from. */
export type PathPlaceKind = 'birth' | 'baptism' | 'residence';

/** One ancestor record (an implex person has one per path). */
export interface PathAncestor {
    personId: PersonId;
    /** Ahnentafel number relative to the chosen person (2 = father, 4 = father's father …). */
    rel: number;
    /** floor(log2(rel)): 1 = parents, 2 = grandparents … */
    gen: number;
    /** gen ≥ 2: (rel >> (gen − 2)) − 4, else −1. */
    quarter: number;
    /** gen ≥ 3: (rel >> (gen − 3)) − 8, else −1. */
    eighth: number;
    /** Birth year, else baptism year, else the year of the place's fact. */
    year?: number;
    /** Place key (places.ts placeKey) of the place on the map: birth → baptism → first dated residence. */
    placeKey?: string;
    /** The map point the place is drawn at (a town for its houses); set together with placeKey. */
    pointKey?: string;
    placeKind?: PathPlaceKind;
}

export interface PathTarget {
    year?: number;
    placeKey?: string;
    pointKey?: string;
    /** Which fact the place comes from; null = no place on the map (the target is not drawn). */
    kind: PathPlaceKind | null;
}

/** A grandparent (quarter) or great-grandparent (eighth) line. */
export interface BranchInfo {
    /** The grandparent / great-grandparent the line starts at. */
    rootId: PersonId;
    /** Their birth surname (lastName; the given name when no surname is written). */
    surname: string;
    /** Distinct ancestors of the line on the map (root included when on the map). */
    count: number;
    /** Birth year of the line's earliest ancestor on the map (the mark above the timebar). */
    firstYear?: number;
}

export type MissingReason = 'date' | 'place' | 'both';

export interface PathMissing {
    personId: PersonId;
    /** 'date' = no year, 'place' = no place with a location, 'both'. */
    reason: MissingReason;
}

/** A person in two or more lines. */
export interface PathImplex {
    personId: PersonId;
    rels: number[];
    /** Distinct quarters (≥ 0) and eighths (≥ 0) the records fall in. */
    quarters: number[];
    eighths: number[];
}

/** One parent → child line between two map points (raw, before merging and mode). */
export interface PathLink {
    parentId: PersonId;
    childId: PersonId;
    /** The parent record's rel, gen, quarter and eighth: the line takes the parent's branch. */
    parentRel: number;
    gen: number;
    quarter: number;
    eighth: number;
    fromKey: string;
    toKey: string;
    /** The child's year: the line appears then. */
    year: number;
}

export interface PathModel {
    targetId: PersonId;
    target: PathTarget;
    /** Every ancestor record, by rel (implex = several records of one person). */
    ancestors: PathAncestor[];
    /** Records with both a year and a place on the map. */
    onMap: PathAncestor[];
    /** Distinct persons on the map ("37 ancestors on the map"). */
    onMapCount: number;
    /** Distinct ancestors without a year or without a place on the map. */
    missingOnMap: PersonId[];
    /** The same with the reason, for the list "Ancestors not on the timeline" (by generation, then rel). */
    missing: PathMissing[];
    /** The four grandparent lines; null = unknown grandparent. */
    quarters: (BranchInfo | null)[];
    /** The eight great-grandparent lines; null = unknown. */
    eighths: (BranchInfo | null)[];
    implex: PathImplex[];
    /** Parent → child lines between different map points. */
    links: PathLink[];
    /** Coordinates of every map point used (ancestors and the target). */
    points: Map<string, PlaceGeo>;
    /** The earliest year of an ancestor on the map → the target's year; null without an ancestor on the map. */
    yearFrom: number | null;
    yearTo: number | null;
}

/** Where a place key is drawn: the map point's key and coordinates, or null when it has no location. */
export type PathLocate = (placeKey: string) => { key: string; geo: PlaceGeo } | null;

export interface PathModelOptions {
    /** Deepest generation walked (default 30). */
    maxGen?: number;
    /** Place key → map point; default: `data.places[key]` at its own key (as mapMigrationSegments). */
    locate?: PathLocate;
}

/** The hard cap of drawn path lines (as without a chosen person). */
export const PATH_LINE_CAP = 400;

/** Gen ≥ 2: the quarter of a rel, else −1. */
export function quarterOfRel(rel: number): number {
    const gen = genOfRel(rel);
    return gen >= 2 ? (rel >> (gen - 2)) - 4 : -1;
}

/** Gen ≥ 3: the eighth of a rel, else −1. */
export function eighthOfRel(rel: number): number {
    const gen = genOfRel(rel);
    return gen >= 3 ? (rel >> (gen - 3)) - 8 : -1;
}

export function genOfRel(rel: number): number {
    return Math.floor(Math.log2(rel));
}

/** The father and the mother as the fan chart chooses them. */
function fatherMother(data: StromData, person: Person): [Person | null, Person | null] {
    // A placeholder (the other parent of a one-parent family) is nobody: its line is unknown, not missing.
    const parents = person.parentIds
        .map(id => data.persons[id])
        .filter((p): p is Person => !!p && !p.isPlaceholder)
        .slice(0, 2);
    return parentSlots(parents);
}

/** Where a person stands: birth place → baptism place → first dated residence, each only with a location. */
function placeOf(person: Person, locate: PathLocate): { year?: number; placeKey?: string; pointKey?: string; geo?: PlaceGeo; kind: PathPlaceKind | null } {
    const birthYear = yearOf(person.birthDate);
    const baptisms = (person.events ?? []).filter(e => e.type === 'baptism');
    const baptismYear = baptisms.map(e => yearOf(e.date)).find((y): y is number => y !== null) ?? null;
    const candidates: { raw: string | undefined; year: number | null; kind: PathPlaceKind }[] = [
        { raw: person.birthPlace, year: birthYear, kind: 'birth' },
        ...baptisms.map(e => ({ raw: e.place, year: yearOf(e.date), kind: 'baptism' as const })),
        ...(person.events ?? [])
            .filter(e => e.type === 'residence')
            .map(e => ({ raw: e.place, year: yearOf(e.date), kind: 'residence' as const }))
            .filter(c => c.year !== null)
            .sort((a, b) => a.year! - b.year!),
    ];
    let found: { placeKey: string; pointKey: string; geo: PlaceGeo; year: number | null; kind: PathPlaceKind } | null = null;
    for (const c of candidates) {
        const raw = c.raw?.trim();
        if (!raw) continue;
        const key = placeKey(raw);
        const pt = key ? locate(key) : null;
        if (pt) { found = { placeKey: key, pointKey: pt.key, geo: pt.geo, year: c.year, kind: c.kind }; break; }
    }
    const year = birthYear ?? baptismYear ?? found?.year ?? null;
    return {
        ...(year !== null ? { year } : {}),
        ...(found ? { placeKey: found.placeKey, pointKey: found.pointKey, geo: found.geo } : {}),
        kind: found?.kind ?? null,
    };
}

/** The line's surname: the birth surname, the given name when none is written. */
function branchSurname(p: Person): string {
    return p.lastName?.trim() || p.firstName?.trim() || '';
}

/**
 * Build the path model of the chosen person: every ancestor record, which of
 * them are on the map, the lines between them, the four and eight lines with
 * their surnames and counts, implex, missing ancestors and the year range.
 */
export function buildPathModel(data: StromData, targetId: PersonId, opts: PathModelOptions = {}): PathModel {
    const maxGen = opts.maxGen ?? 30;
    const places = data.places ?? {};
    const locate: PathLocate = opts.locate ?? (key => places[key] ? { key, geo: places[key] } : null);
    const target = data.persons[targetId];
    const points = new Map<string, PlaceGeo>();

    const tp = target ? placeOf(target, locate) : { kind: null };
    if (tp.pointKey && tp.geo) points.set(tp.pointKey, tp.geo);
    const targetInfo: PathTarget = {
        ...(tp.year !== undefined ? { year: tp.year } : {}),
        ...(tp.pointKey ? { placeKey: tp.placeKey, pointKey: tp.pointKey } : {}),
        kind: tp.kind,
    };

    // Walk parents breadth-first (by rel), one record per path.
    const ancestors: PathAncestor[] = [];
    const byRel = new Map<number, PathAncestor>();
    const expanded = new Set<string>();
    const placeCache = new Map<PersonId, ReturnType<typeof placeOf>>();
    const placeFor = (p: Person) => {
        let v = placeCache.get(p.id);
        if (!v) { v = placeOf(p, locate); placeCache.set(p.id, v); }
        return v;
    };
    let frontier: { person: Person; rel: number }[] = target ? [{ person: target, rel: 1 }] : [];
    for (let gen = 1; gen <= maxGen && frontier.length; gen++) {
        const next: { person: Person; rel: number }[] = [];
        for (const { person, rel } of frontier) {
            const [father, mother] = fatherMother(data, person);
            for (const [parent, r] of [[father, rel * 2], [mother, rel * 2 + 1]] as const) {
                if (!parent || parent.id === targetId) continue;
                const pl = placeFor(parent);
                const a: PathAncestor = {
                    personId: parent.id, rel: r, gen, quarter: quarterOfRel(r), eighth: eighthOfRel(r),
                    ...(pl.year !== undefined ? { year: pl.year } : {}),
                    ...(pl.pointKey ? { placeKey: pl.placeKey, pointKey: pl.pointKey, placeKind: pl.kind ?? undefined } : {}),
                };
                if (pl.pointKey && pl.geo) points.set(pl.pointKey, pl.geo);
                ancestors.push(a);
                byRel.set(r, a);
                const lineKey = `${parent.id}|${a.quarter}|${a.eighth}`;
                if (!expanded.has(lineKey)) {
                    expanded.add(lineKey);
                    next.push({ person: parent, rel: r });
                }
            }
        }
        frontier = next;
    }

    const isOn = (a: { year?: number; pointKey?: string }): boolean => a.year !== undefined && !!a.pointKey;
    const onMap = ancestors.filter(isOn);
    const onMapIds = new Set(onMap.map(a => a.personId));

    // Missing: distinct persons, by first record order (generation, then rel).
    const missing: PathMissing[] = [];
    const seenMissing = new Set<PersonId>();
    for (const a of ancestors) {
        if (isOn(a) || seenMissing.has(a.personId)) continue;
        seenMissing.add(a.personId);
        const noDate = a.year === undefined, noPlace = !a.pointKey;
        missing.push({ personId: a.personId, reason: noDate && noPlace ? 'both' : noDate ? 'date' : 'place' });
    }

    const years = onMap.map(a => a.year!);
    const yearFrom = years.length ? Math.min(...years) : null;
    const lastAncestor = years.length ? Math.max(...years) : null;
    const yearTo = lastAncestor === null ? null : Math.max(lastAncestor, targetInfo.year ?? lastAncestor);

    // Lines: each parent record on the map → its child (the record rel >> 1, or the target).
    // A target with a place but no year at all takes the end of the range.
    const targetNode = targetInfo.pointKey
        ? { personId: targetId, year: targetInfo.year ?? yearTo ?? undefined, pointKey: targetInfo.pointKey }
        : null;
    const links: PathLink[] = [];
    for (const a of onMap) {
        const childRel = a.rel >> 1;
        const child = childRel === 1 ? targetNode : byRel.get(childRel);
        if (!child || !child.pointKey || child.year === undefined || child.pointKey === a.pointKey) continue;
        links.push({
            parentId: a.personId, childId: child.personId, parentRel: a.rel, gen: a.gen, quarter: a.quarter, eighth: a.eighth,
            fromKey: a.pointKey!, toKey: child.pointKey, year: child.year,
        });
    }

    const branch = (rel: number, inLine: (a: PathAncestor) => boolean): BranchInfo | null => {
        const root = byRel.get(rel);
        const person = root ? data.persons[root.personId] : undefined;
        if (!root || !person) return null;
        const members = onMap.filter(inLine);
        const years = members.map(a => a.year!);
        return {
            rootId: root.personId,
            surname: branchSurname(person),
            count: new Set(members.map(a => a.personId)).size,
            ...(years.length ? { firstYear: Math.min(...years) } : {}),
        };
    };
    const quarters = [0, 1, 2, 3].map(q => branch(4 + q, a => a.quarter === q));
    const eighths = [0, 1, 2, 3, 4, 5, 6, 7].map(e => branch(8 + e, a => a.eighth === e));

    const recordsOf = new Map<PersonId, PathAncestor[]>();
    for (const a of ancestors) {
        const list = recordsOf.get(a.personId);
        if (list) list.push(a); else recordsOf.set(a.personId, [a]);
    }
    const implex: PathImplex[] = [...recordsOf.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([personId, list]) => ({
            personId,
            rels: list.map(a => a.rel),
            quarters: [...new Set(list.map(a => a.quarter).filter(q => q >= 0))].sort((a, b) => a - b),
            eighths: [...new Set(list.map(a => a.eighth).filter(e => e >= 0))].sort((a, b) => a - b),
        }));

    return {
        targetId,
        target: targetInfo,
        ancestors,
        onMap,
        onMapCount: onMapIds.size,
        missingOnMap: missing.map(m => m.personId),
        missing,
        quarters,
        eighths,
        implex,
        links,
        points,
        yearFrom,
        yearTo,
    };
}

// ---------------------------------------------------------------- classes

/** The class of a line from a parent record: parents and grandparents → the trunk, else the parent's quarter or eighth. */
export function lineClassOf(gen: number, quarter: number, eighth: number, mode: LineMode): LineClass {
    if (gen <= 2 || quarter < 0) return 'trunk';
    return (mode === 'eighth' && eighth >= 0 ? `e${eighth}` : `q${quarter}`) as LineClass;
}

/** The class of an ancestor's point: parents the trunk colour, grandparents their quarter, deeper their quarter or eighth. */
export function pointClassOf(a: Pick<PathAncestor, 'gen' | 'quarter' | 'eighth'>, mode: LineMode): LineClass {
    if (a.gen <= 1 || a.quarter < 0) return 'trunk';
    return (mode === 'eighth' && a.eighth >= 0 ? `e${a.eighth}` : `q${a.quarter}`) as LineClass;
}

/** The class of a legend row (the pinned line `lineFocus`): quarter or eighth `index` in the mode. */
export function branchClass(mode: LineMode, index: number): LineClass {
    return (mode === 'eighth' ? `e${index}` : `q${index}`) as LineClass;
}

// ---------------------------------------------------------------- segments

/** One drawn line: a route between two map points, its siblings merged. */
export interface PathSegment {
    cls: LineClass;
    fromKey: string;
    toKey: string;
    from: PlaceGeo;
    to: PlaceGeo;
    /** The newest child year on this route up to the year shown (drives the fade). */
    year: number;
    /** Year shown − year. */
    age: number;
    /** Added in the last ten years (age 0…9): drawn wider. */
    fresh: boolean;
    /** The smallest parent generation on the route. */
    gen: number;
    /** The parent record's quarter / eighth (−1 for the trunk). */
    quarter: number;
    eighth: number;
    parentIds: PersonId[];
    childIds: PersonId[];
    /** Rough length in km (the cut prefers longer lines). */
    length: number;
}

function routeLength(a: PlaceGeo, b: PlaceGeo): number {
    const k = Math.PI / 180;
    const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * k);
    const y = b.lat - a.lat;
    return Math.sqrt(x * x + y * y) * 111.32;
}

/**
 * The lines of the path at `year` in `mode`: every parent → child route whose
 * child was born by then, routes of siblings of one class merged (key =
 * from → to + class, the newest year wins). `total` = all such routes; over
 * `limit` (400) the kept ones are, in this order: the trunk, lines added in
 * the last ten years, a smaller generation, an end inside the viewport, a
 * longer line. The result is in that priority order.
 */
export function pathSegments(
    model: PathModel,
    year: number,
    mode: LineMode,
    viewport?: (geo: PlaceGeo) => boolean,
    limit = PATH_LINE_CAP,
): { segs: PathSegment[]; total: number } {
    const byKey = new Map<string, PathSegment>();
    for (const l of model.links) {
        if (l.year > year) continue;
        const cls = lineClassOf(l.gen, l.quarter, l.eighth, mode);
        const key = `${l.fromKey}->${l.toKey}|${cls}`;
        const s = byKey.get(key);
        if (s) {
            if (l.year > s.year) s.year = l.year;
            s.gen = Math.min(s.gen, l.gen);
            if (!s.parentIds.includes(l.parentId)) s.parentIds.push(l.parentId);
            if (!s.childIds.includes(l.childId)) s.childIds.push(l.childId);
            continue;
        }
        const from = model.points.get(l.fromKey), to = model.points.get(l.toKey);
        if (!from || !to) continue;
        const trunk = cls === 'trunk';
        byKey.set(key, {
            cls, fromKey: l.fromKey, toKey: l.toKey, from, to, year: l.year, age: 0, fresh: false, gen: l.gen,
            quarter: trunk ? -1 : l.quarter, eighth: trunk ? -1 : l.eighth,
            parentIds: [l.parentId], childIds: [l.childId], length: routeLength(from, to),
        });
    }
    const all = [...byKey.entries()].map(([key, s]) => {
        s.age = year - s.year;
        s.fresh = s.age >= 0 && s.age < 10;
        return { key, s, inView: viewport ? viewport(s.to) : true };
    });
    all.sort((a, b) =>
        Number(b.s.cls === 'trunk') - Number(a.s.cls === 'trunk')
        || Number(b.s.fresh) - Number(a.s.fresh)
        || a.s.gen - b.s.gen
        || Number(b.inView) - Number(a.inView)
        || b.s.length - a.s.length
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { segs: all.slice(0, Math.max(0, limit)).map(x => x.s), total: all.length };
}

// ---------------------------------------------------------------- points

/** One map point of the path at a year: every ancestor born there by then. */
export interface PathPoint {
    key: string;
    geo: PlaceGeo;
    /** Distinct classes in the slice order of map-line-colors (several = a split point). */
    classes: LineClass[];
    /** The records drawn here (an implex person once per line). */
    ancestors: PathAncestor[];
    personIds: PersonId[];
    /** Someone born here in the last ten years. */
    fresh: boolean;
}

const CLASS_ORDER: readonly LineClass[] = ['q0', 'q1', 'q2', 'q3', 'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'trunk'];

/** The ancestors' points at `year` (one point per map point, never twice for an implex person). The target is not among them. */
export function pathPoints(model: PathModel, year: number, mode: LineMode): PathPoint[] {
    const byKey = new Map<string, PathPoint>();
    for (const a of model.onMap) {
        if (a.year! > year) continue;
        const key = a.pointKey!;
        let p = byKey.get(key);
        if (!p) {
            p = { key, geo: model.points.get(key)!, classes: [], ancestors: [], personIds: [], fresh: false };
            byKey.set(key, p);
        }
        const cls = pointClassOf(a, mode);
        if (!p.classes.includes(cls)) p.classes.push(cls);
        p.ancestors.push(a);
        if (!p.personIds.includes(a.personId)) p.personIds.push(a.personId);
        if (year - a.year! < 10) p.fresh = true;
    }
    for (const p of byKey.values()) p.classes.sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
    return [...byKey.values()];
}

// ---------------------------------------------------------------- playback

/** The whole range always plays in 24 s. */
export const PATH_PLAY_MS = 24000;
/** A year with a new ancestor or the target weighs 5, any other 1. */
export const PATH_EVENT_WEIGHT = 5;

export interface PathPlaySchedule {
    from: number;
    to: number;
    /** One step per year from → to, its time in ms (integers summing to exactly 24 000). */
    steps: { year: number; ms: number; event: boolean }[];
    /** The time of a year (0 outside the range). */
    msOf(year: number): number;
}

/**
 * The playback timing with a chosen person: yearFrom → yearTo, step one
 * year, nothing skipped; ms(year) = weight · 24000 / Σ weights, rounded so
 * that the steps still add up to 24 000. Null without an ancestor on the map.
 */
export function pathPlaySchedule(model: PathModel): PathPlaySchedule | null {
    if (model.yearFrom === null || model.yearTo === null) return null;
    const from = model.yearFrom, to = model.yearTo;
    const events = new Set(model.onMap.map(a => a.year!));
    if (model.target.year !== undefined) events.add(model.target.year);
    const years: number[] = [];
    for (let y = from; y <= to; y++) years.push(y);
    const weights = years.map(y => (events.has(y) ? PATH_EVENT_WEIGHT : 1));
    const sum = weights.reduce((s, w) => s + w, 0);
    let cum = 0, prev = 0;
    const steps = years.map((year, i) => {
        cum += weights[i];
        const at = Math.round((cum * PATH_PLAY_MS) / sum);
        const ms = at - prev;
        prev = at;
        return { year, ms, event: weights[i] > 1 };
    });
    const msByYear = new Map(steps.map(s => [s.year, s.ms]));
    return { from, to, steps, msOf: (year: number) => msByYear.get(year) ?? 0 };
}

/** What came onto the map in a year: an ancestor (all their records) or the target. */
export interface PathAddition {
    personId: PersonId;
    isTarget: boolean;
    /** The records' rels (empty for the target). */
    rels: number[];
    gen: number;
    quarter: number;
    eighth: number;
    /** The map point the person is at. */
    pointKey: string;
    /** The parent's map point the line comes from, when it differs (father first, then mother). */
    fromKey?: string;
}

/**
 * Who was added to the map exactly in `year`: ancestors (closest generation
 * first, then rel), the target last. For the line under the timebar:
 * "1893 · Ysolde Zandmeer · Mu → Kappa".
 */
export function pathAddedIn(model: PathModel, year: number): PathAddition[] {
    const byRel = new Map(model.onMap.map(a => [a.rel, a]));
    const fromOf = (rel: number, own: string): string | undefined => {
        for (const r of [rel * 2, rel * 2 + 1]) {
            const p = byRel.get(r);
            if (p && p.pointKey !== own) return p.pointKey;
            if (p) return undefined;
        }
        return undefined;
    };
    const out: PathAddition[] = [];
    const seen = new Map<PersonId, PathAddition>();
    for (const a of model.onMap) {
        if (a.year !== year) continue;
        const had = seen.get(a.personId);
        if (had) { had.rels.push(a.rel); continue; }
        const from = fromOf(a.rel, a.pointKey!);
        const item: PathAddition = {
            personId: a.personId, isTarget: false, rels: [a.rel], gen: a.gen, quarter: a.quarter, eighth: a.eighth,
            pointKey: a.pointKey!, ...(from ? { fromKey: from } : {}),
        };
        seen.set(a.personId, item);
        out.push(item);
    }
    out.sort((a, b) => a.gen - b.gen || a.rels[0] - b.rels[0]);
    const t = model.target;
    const tYear = t.year ?? model.yearTo;
    if (t.pointKey && tYear === year) {
        const from = fromOf(1, t.pointKey);
        out.push({
            personId: model.targetId, isTarget: true, rels: [], gen: 0, quarter: -1, eighth: -1,
            pointKey: t.pointKey, ...(from ? { fromKey: from } : {}),
        });
    }
    return out;
}

/** The latest year ≤ `year` (within the range) in which something came onto the map, with what came; null before the first. */
export function pathLastAdded(model: PathModel, year: number): { year: number; items: PathAddition[] } | null {
    let best: number | null = null;
    for (const a of model.onMap) if (a.year! <= year && (best === null || a.year! > best)) best = a.year!;
    const tYear = model.target.pointKey ? model.target.year ?? model.yearTo : null;
    if (tYear !== null && tYear <= year && (best === null || tYear > best)) best = tYear;
    if (best === null) return null;
    return { year: best, items: pathAddedIn(model, best) };
}
