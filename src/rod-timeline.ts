/**
 * The timeline of a family line (1102 §5): what the page "Timeline of the
 * line" shows, as data. The line's events come from its people — births of
 * the members, the members' marriages (a married-in wife's marriage belongs to
 * her husband's line; a daughter's marriage to both lines, as "born into the
 * X line" in the husband's and "→ X line" in hers), deaths of the members
 * and of those who married in, moves (a change of the town between dated
 * records with a place) and emigration (an emigration record, whose place is
 * the place left, with an immigration record that follows it as the
 * destination; an immigration record, whose place is the place reached; or a
 * move between two located places in different countries). The history
 * layer adds the events of the line's places within the line's period: of a
 * place of the line or of its whole region; an event of the kind "other" only
 * with a place of the line.
 *
 * A protected person (living, privacy other than full) has no event and does
 * not count: the generation bars end at the last unprotected record. Pure.
 */

import { Partnership, PartnershipId, Person, PersonId, StromData } from './types.js';
import { yearOf, yearFraction } from './dates.js';
import { placeKey, townOfPlace } from './places.js';
import { Rod, RodId, RodPlaceSpan, placeSpans, rodGenerations } from './lineage.js';
import { HistoryKind, HistoryPayload, PersonHistoryEnv, effectiveHidden, matchHistoryPlace, pickHistoryText } from './history.js';
import { ProtectedPersonPageTree } from './person-page.js';
import { countryIdAt } from './map-context.js';
import { Language } from './strings.js';

export type RodTimelineKind = 'birth' | 'marriage' | 'death' | 'move' | 'emigration' | 'history';
/** The chips of the page (§5.2): moves and emigration share one. */
export type RodTimelineChip = 'birth' | 'marriage' | 'death' | 'move' | 'hist';
export const ROD_TIMELINE_CHIPS: readonly RodTimelineChip[] = ['birth', 'marriage', 'death', 'move', 'hist'];

export function rodTimelineChip(kind: RodTimelineKind): RodTimelineChip {
    return kind === 'history' ? 'hist' : kind === 'emigration' ? 'move' : kind;
}

export interface RodTimelineHistory {
    id: string;
    from: number;
    to?: number;
    kind: HistoryKind;
    text: string;
    textLang: string;
    /** The line's spelling of the place the event belongs to; none for an event of the whole region. */
    place?: string;
}

export interface RodTimelineEvent {
    kind: RodTimelineKind;
    year: number;
    /** The year with its fraction, for the order. */
    sort: number;
    /** The person the row is about (none for history). */
    personId?: PersonId;
    /** A marriage: the partner and the union. */
    partnerId?: PersonId;
    partnershipId?: PartnershipId;
    /** Birth, death, marriage: where; a move or emigration: where to (none: an emigration record without a known destination). */
    place?: string;
    /** A move or emigration: where from (none when not known). */
    from?: string;
    /** A marriage: the partner's birth line ('birth') or the line the member married into ('to'). */
    rod?: { id: RodId; rel: 'birth' | 'to' };
    /** A death: the age in years when the birth year is known. */
    age?: number;
    history?: RodTimelineHistory;
}

export interface RodTimelineGeneration {
    /** 1 = the founder's. */
    gen: number;
    from: number;
    to: number;
    /** Unprotected real members of the generation. */
    count: number;
}

export interface RodTimelineCentury {
    /** 18 = 1700–1799. */
    c: number;
    count: number;
}

export interface RodTimeline {
    rodId: RodId;
    /** First and last year of the line's records the page shows (null without any). */
    period: { from: number; to: number } | null;
    generations: RodTimelineGeneration[];
    /** The places' rows (max 6) and how many more there are. */
    places: RodPlaceSpan[];
    morePlaces: number;
    /** By year. */
    events: RodTimelineEvent[];
    /** Centuries with events, earliest first. */
    centuries: RodTimelineCentury[];
    /** The history layer is part of the page (the group is on and the research gave a payload). */
    history: boolean;
}

export interface RodTimelineInput {
    prot: ProtectedPersonPageTree;
    rodId: RodId;
    lang: Language;
    now: Date;
    /** The research's history (none: no layer). */
    history?: { payload: HistoryPayload; env?: PersonHistoryEnv } | null;
    /** The group "History" of the set (§5.5); off: no bands, no rows, no chip. */
    historyOn?: boolean;
}

/** Rows of places on the overview (§5.2). */
export const ROD_TIMELINE_PLACES = 6;

/** Events of a person's own that say nothing of where the person lived. */
const NOT_RESIDENCE = new Set(['death', 'burial', 'cremation', 'probate', 'will', 'emigration', 'immigration']);

function isWedding(u: Partnership): boolean {
    return u.status === 'married' || u.status === 'divorced';
}

/** Who carries a line in a union (as the lineages do): the man; a woman's partner of unrecorded sex. */
function carrierOf(tree: StromData, u: Partnership): PersonId | null {
    const a = tree.persons[u.person1Id];
    const b = u.person2Id ? tree.persons[u.person2Id] : undefined;
    if (!a || !b) return a?.gender === 'male' ? a.id : b?.gender === 'male' ? b.id : null;
    if (a.gender === 'male' && b.gender !== 'male') return a.id;
    if (b.gender === 'male' && a.gender !== 'male') return b.id;
    if (a.gender === 'female' && b.gender === 'unknown') return b.id;
    if (b.gender === 'female' && a.gender === 'unknown') return a.id;
    return null;
}

/** The town of a place, as a key: "Lopuchov 12" and "Lopuchov" are one town. */
function townKey(place: string): string {
    return placeKey(townOfPlace(place)?.town ?? place) || placeKey(place);
}

/** A place a person was at; `emig`: an emigration record ('out', the place left) or an immigration record ('in', the place reached). */
interface Point { sort: number; year: number; place: string; emig?: 'out' | 'in' }

/** An immigration record at most this many years after an emigration record is its destination. */
const EMIG_ARRIVAL_YEARS = 5;

/** The timeline of one line; null for a line the tree does not have. */
export function buildRodTimeline(input: RodTimelineInput): RodTimeline | null {
    const { prot, rodId, lang } = input;
    const index = prot.lineages;
    const rod: Rod | undefined = index.rods.get(rodId);
    if (!rod) return null;
    const tree = prot.tree;
    const geo = index.data.places ?? {};
    const shielded = (id: PersonId): boolean => prot.privacy !== 'full' && prot.living.has(id);
    const real = (id: PersonId | undefined | null): Person | undefined => {
        if (!id) return undefined;
        const p = tree.persons[id];
        return p && !p.isPlaceholder && !shielded(id) ? p : undefined;
    };
    const members = rod.memberIds.filter(id => !!real(id));
    const memberSet = new Set(rod.memberIds);
    const spouses = [...new Set(rod.spouses.map(s => s.personId))].filter(id => !!real(id));
    const events: RodTimelineEvent[] = [];
    const sortOf = (date: string | undefined, year: number): number => year + yearFraction(date);

    // Countries of located places, once per place.
    const countries = new Map<string, number>();
    const countryOf = (place: string): number => {
        const key = placeKey(place);
        let c = countries.get(key);
        if (c === undefined) {
            const g = geo[key];
            c = g && Number.isFinite(g.lat) && Number.isFinite(g.lon) ? countryIdAt(g.lon, g.lat) : -1;
            countries.set(key, c);
        }
        return c;
    };
    const abroad = (a: string, b: string): boolean => {
        const x = countryOf(a), y = countryOf(b);
        return x >= 0 && y >= 0 && x !== y;
    };

    // Where a person lived: the birth, the own events with a place, the births of the children.
    const points = (p: Person): Point[] => {
        const out: Point[] = [];
        const add = (date: string | undefined, place: string | undefined, emig?: Point['emig']): void => {
            const y = yearOf(date);
            const at = place?.trim();
            if (y === null || !at) return;
            out.push({ sort: sortOf(date, y), year: y, place: at, ...(emig ? { emig } : {}) });
        };
        add(p.birthDate, p.birthPlace);
        for (const ev of p.events ?? []) {
            if (ev.type === 'emigration') add(ev.date, ev.place, 'out');
            else if (ev.type === 'immigration') add(ev.date, ev.place, 'in');
            else if (!NOT_RESIDENCE.has(ev.type)) add(ev.date, ev.place);
        }
        for (const uid of p.partnerships) {
            const u = tree.partnerships[uid];
            for (const kid of u?.childIds ?? []) {
                const c = real(kid);
                if (c) add(c.birthDate, c.birthPlace);
            }
        }
        return out.sort((a, b) => a.sort - b.sort);
    };

    const seenMove = new Set<string>();
    const seenEmig = new Set<string>();
    /**
     * A person's moves and emigration. A married-in spouse (`fromYear` the
     * wedding): moves from the wedding on (moving in is the marriage itself),
     * an emigration record whenever it is (with the spouse's line of birth).
     */
    const moves = (id: PersonId, p: Person, fromYear: number | null, birthRod?: RodTimelineEvent['rod']): void => {
        let prev: Point | null = null;
        let last: Point | null = null;
        const pts = points(p);
        // Immigration records already shown as the destination of an emigration record.
        const arrivals = new Set<Point>();
        for (const [i, pt] of pts.entries()) {
            const before = fromYear !== null && pt.year < fromYear;
            if (pt.emig) {
                const key = `${id}|${pt.year}|${pt.emig}|${townKey(pt.place)}`;
                if (!arrivals.has(pt) && !seenEmig.has(key)) {
                    seenEmig.add(key);
                    const tag = before && birthRod ? { rod: birthRod } : {};
                    if (pt.emig === 'out') {
                        // The record's place is where the person left from; the destination is an
                        // immigration record that follows (before another emigration record).
                        let to: Point | undefined;
                        for (const q of pts.slice(i + 1)) {
                            if (q.emig === 'out' || q.year - pt.year > EMIG_ARRIVAL_YEARS) break;
                            if (q.emig === 'in') { to = q; break; }
                        }
                        if (to) arrivals.add(to);
                        const dest = to && townKey(to.place) !== townKey(pt.place) ? { place: to.place } : {};
                        events.push({ kind: 'emigration', year: pt.year, sort: pt.sort, personId: id, from: pt.place, ...dest, ...tag });
                    } else {
                        // An immigration record's place is where the person arrived.
                        const was = before ? last : prev;
                        const from = was && townKey(was.place) !== townKey(pt.place) ? { from: was.place } : {};
                        events.push({ kind: 'emigration', year: pt.year, sort: pt.sort, personId: id, place: pt.place, ...from, ...tag });
                    }
                }
            } else if (!before && prev && townKey(prev.place) !== townKey(pt.place)) {
                // One row for a couple moving together (the member's, who comes first).
                const key = `${pt.year}|${townKey(prev.place)}|${townKey(pt.place)}`;
                if (!seenMove.has(key)) {
                    seenMove.add(key);
                    events.push({ kind: abroad(prev.place, pt.place) ? 'emigration' : 'move', year: pt.year, sort: pt.sort, personId: id, from: prev.place, place: pt.place });
                }
            }
            last = pt;
            if (!before) prev = pt;
        }
    };

    const death = (id: PersonId, p: Person): void => {
        const y = yearOf(p.deathDate);
        if (y === null) return;
        const b = yearOf(p.birthDate);
        const age = b !== null && y >= b ? y - b : undefined;
        events.push({ kind: 'death', year: y, sort: sortOf(p.deathDate, y) + 0.001, personId: id, ...(p.deathPlace?.trim() ? { place: p.deathPlace.trim() } : {}), ...(age !== undefined ? { age } : {}) });
    };

    const seenUnion = new Set<PartnershipId>();
    for (const id of members) {
        const p = real(id)!;
        const b = yearOf(p.birthDate);
        if (b !== null) events.push({ kind: 'birth', year: b, sort: sortOf(p.birthDate, b) - 0.001, personId: id, ...(p.birthPlace?.trim() ? { place: p.birthPlace.trim() } : {}) });
        death(id, p);
        for (const uid of p.partnerships) {
            const u = tree.partnerships[uid];
            if (!u || seenUnion.has(uid) || !isWedding(u)) continue;
            const y = yearOf(u.startDate);
            const partnerId = u.person1Id === id ? u.person2Id : u.person1Id;
            if (y === null || !partnerId || !real(partnerId)) continue;
            seenUnion.add(uid);
            const carrier = carrierOf(tree, u);
            const partnerRod = index.rodByPerson.get(partnerId) ?? null;
            let rel: RodTimelineEvent['rod'];
            const other = partnerRod ? index.rods.get(partnerRod) : undefined;
            if (other && partnerRod && partnerRod !== rodId && !memberSet.has(partnerId) && !other.small) {
                // The partner carries: the member married into the partner's line; else the partner came from
                // another line (not one the partner founds: a wife "from nowhere" has no line of birth to name).
                if (carrier === partnerId) rel = { id: partnerRod, rel: 'to' };
                else if (other.founderId !== partnerId) rel = { id: partnerRod, rel: 'birth' };
            }
            events.push({
                kind: 'marriage', year: y, sort: sortOf(u.startDate, y), personId: id, partnerId, partnershipId: uid,
                ...(u.startPlace?.trim() ? { place: u.startPlace.trim() } : {}), ...(rel ? { rod: rel } : {}),
            });
        }
        moves(id, p, null);
    }
    for (const id of spouses) {
        const p = real(id)!;
        death(id, p);
        // A married-in spouse's moves from the wedding on (moving in is the marriage itself).
        let wed: number | null = null;
        for (const uid of p.partnerships) {
            const u = tree.partnerships[uid];
            if (!u) continue;
            const other = u.person1Id === id ? u.person2Id : u.person1Id;
            if (!other || !memberSet.has(other)) continue;
            const y = yearOf(u.startDate);
            if (y !== null) wed = wed === null ? y : Math.min(wed, y);
        }
        const own = index.rodByPerson.get(id);
        const born = own ? index.rods.get(own) : undefined;
        const birthRod = born && own && own !== rodId && !born.small && born.founderId !== id ? { id: own, rel: 'birth' as const } : undefined;
        moves(id, p, wed ?? Infinity, birthRod);
    }

    // The period: the records shown (the history layer is cut to it).
    let from = Infinity, to = -Infinity;
    for (const e of events) { from = Math.min(from, e.year); to = Math.max(to, e.year); }
    const period = from <= to ? { from, to } : null;

    // The generations (§5.2): a bar per generation of unprotected members; a living one (full data) up to now.
    const nowYear = input.now.getFullYear();
    const generations: RodTimelineGeneration[] = [];
    rodGenerations(index, rodId).forEach((ids, i) => {
        let a = Infinity, b = -Infinity, count = 0;
        for (const id of ids) {
            const p = real(id);
            if (!p) continue;
            count++;
            const by = yearOf(p.birthDate);
            const dy = yearOf(p.deathDate);
            const end = dy ?? (prot.living.has(id) ? nowYear : by);
            const start = by ?? end;
            if (start === null) continue;
            a = Math.min(a, start);
            b = Math.max(b, end ?? start, start);
        }
        if (count && a <= b) generations.push({ gen: i + 1, from: a, to: b, count });
    });

    const allPlaces = placeSpans(tree, [...rod.memberIds, ...rod.spouses.map(s => s.personId)], rod.familyIds, memberSet, id => shielded(id));

    // The history layer (§5.1, §5.5).
    const hist = input.history && input.historyOn !== false ? input.history : null;
    if (hist && period) {
        const p = hist.payload;
        const hidden = effectiveHidden(p, hist.env?.queue ?? []);
        const byId = new Map(p.events.map(e => [e.id, e]));
        const keys = new Map<string, string>();
        for (const s of allPlaces) {
            const key = matchHistoryPlace(p, s.name);
            if (key && !keys.has(key)) keys.set(key, s.name);
        }
        const done = new Set<string>();
        for (const [key, name] of keys) {
            for (const evId of p.places[key]?.events ?? []) {
                if (done.has(evId)) continue;
                const ev = byId.get(evId);
                if (!ev) continue;
                if (hist.env?.kinds && !hist.env.kinds[ev.scope]) continue;
                if (ev.from < period.from || ev.from > period.to) continue;
                // "Other" says something only of a place of the line, not of the whole region.
                if (ev.kind === 'other' && ev.scope === 'region') continue;
                const wide = hidden.some(h => (!h.event && !!h.region && ev.scope === 'region' && ev.region?.id === h.region) || (h.tree && h.event === ev.id));
                if (wide) { done.add(evId); continue; }
                const here = hidden.some(h => h.event === ev.id && !h.tree && !!h.place
                    && (placeKey(h.place) === placeKey(key) || matchHistoryPlace(p, h.place) === key));
                if (here) continue;
                const t = pickHistoryText(ev.text, lang, p.lang);
                if (!t) continue;
                done.add(evId);
                events.push({
                    kind: 'history', year: ev.from, sort: ev.from,
                    history: {
                        id: ev.id, from: ev.from, ...(ev.to !== undefined && ev.to > ev.from ? { to: ev.to } : {}), kind: ev.kind,
                        text: t.text, textLang: t.lang, ...(ev.scope !== 'region' ? { place: name } : {}),
                    },
                });
            }
        }
    }

    events.sort((a, b) => a.sort - b.sort || (a.kind === 'history' ? -1 : 0) - (b.kind === 'history' ? -1 : 0));
    const perCentury = new Map<number, number>();
    for (const e of events) {
        const c = Math.floor(e.year / 100) + 1;
        perCentury.set(c, (perCentury.get(c) ?? 0) + 1);
    }
    const centuries = [...perCentury.entries()].sort((a, b) => a[0] - b[0]).map(([c, count]) => ({ c, count }));
    return {
        rodId, period, generations,
        places: allPlaces.slice(0, ROD_TIMELINE_PLACES), morePlaces: Math.max(0, allPlaces.length - ROD_TIMELINE_PLACES),
        events, centuries, history: !!hist,
    };
}

/** The century opened at first (§5.2): the one with the most events, the earlier on a tie; null without events. */
export function rodTimelineMainCentury(tl: RodTimeline): number | null {
    let best: RodTimelineCentury | null = null;
    for (const c of tl.centuries) if (!best || c.count > best.count) best = c;
    return best ? best.c : null;
}

/**
 * The overview's axis (§5.2): the whole period (generation bars included)
 * rounded out to ten years, and its labels every 100, 50 or 25 years by the
 * span (over 200, over 80, else).
 */
export function rodTimelineAxis(lo: number, hi: number): { a: number; b: number } {
    let a = Math.floor(lo / 10) * 10;
    let b = Math.ceil((hi + 1) / 10) * 10;
    if (b - a < 30) { const m = (a + b) / 2; a = Math.floor((m - 15) / 10) * 10; b = a + 30; }
    return { a, b };
}

export function rodTimelineTicks(a: number, b: number): number[] {
    const span = b - a;
    const step = span > 200 ? 100 : span > 80 ? 50 : 25;
    const out: number[] = [];
    for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(y);
    return out;
}
