/**
 * The research's questions about places in "Awaiting action" (spec 034 §9),
 * without the DOM: which choices a question offers and what each sends to
 * the bridge (`take`), what a question is about in the tree (people, facts,
 * years), who gave the location a conflict has now, and what the bulk steps
 * of the group "Places" take — every suggestion (the first candidate), every
 * conflict kept, or the suggestions of one area.
 */

import type { LiveWaiting, WaitingPlaceCandidate, WaitingPlaceQuestion } from './research-link.js';
import type { PlaceAnswerTake } from './places-bridge.js';
import type { PlaceGeo, StromData, PersonId } from './types.js';
import { forEachPlaceFact, placeKey } from './places.js';
import { sameCoords } from './place-records.js';
import { yearOf } from './dates.js';
import { fitBounds } from './map.js';
import { compareAppVersions, isAppVersion } from './app-version.js';

export { PLACES_GROUP } from './research-waiting.js';

/** A waiting item that is a place question (kind 'place' with its record id and question). */
export type PlaceQuestion = LiveWaiting & { kind: 'place'; place: string; question: WaitingPlaceQuestion };

export function isPlaceQuestion(w: LiveWaiting): w is PlaceQuestion {
    return w.kind === 'place' && !!w.place && !!w.question;
}

/** A button of a question's footer (a candidate's own "It is A" is its row's). */
export type PlaceChoice = 'none' | 'unknown' | 'chat' | 'fix' | 'keep' | 'yes' | 'no';

export interface PlaceChoiceButton {
    choice: PlaceChoice;
    /** What it sends; none for Chat (a link). */
    take?: PlaceAnswerTake;
}

/**
 * The research version from which Don't know answers a conflict and a form
 * too (an older one refuses it there; None of them only ever answers a proposal).
 */
export const PLACES_UNKNOWN_ALL_SINCE = '1.26.0-beta.7';

/** Whether the research of this version takes Don't know for a conflict and a form ('' / unknown = no). */
export function placesUnknownEverywhere(version: string | undefined): boolean {
    return !!version && isAppVersion(version) && compareAppVersions(version, PLACES_UNKNOWN_ALL_SINCE) >= 0;
}

/**
 * The footer of a question: propose — None of them · Don't know (· Chat);
 * conflict — Move to the suggestion (when there is one) · Keep (· Don't know);
 * form — Yes · No (· Don't know). `chat`: a chat link goes for it;
 * `unknownAll`: the research takes Don't know for a conflict and a form
 * ({@link placesUnknownEverywhere}).
 */
export function placeQuestionChoices(w: PlaceQuestion, opts: { chat?: boolean; unknownAll?: boolean } = {}): PlaceChoiceButton[] {
    const unknown: PlaceChoiceButton[] = opts.unknownAll ? [{ choice: 'unknown', take: 'unknown' }] : [];
    switch (w.question) {
        case 'propose':
            return [
                { choice: 'none', take: 'none' },
                { choice: 'unknown', take: 'unknown' },
                ...(opts.chat ? [{ choice: 'chat' as const }] : []),
            ];
        case 'conflict':
            return [
                ...(w.candidates?.length ? [{ choice: 'fix' as const, take: w.candidates[0].id }] : []),
                { choice: 'keep', take: 'keep' },
                ...unknown,
            ];
        case 'form':
            return [
                { choice: 'yes', take: 'yes' },
                { choice: 'no', take: 'no' },
                ...unknown,
            ];
    }
}

/** The candidates a question lets pick by row (a conflict picks its suggestion in the footer). */
export function pickableCandidates(w: PlaceQuestion): WaitingPlaceCandidate[] {
    return w.question === 'propose' ? w.candidates ?? [] : [];
}

/** A candidate's letter: c1 → A. */
export function candidateLetter(id: WaitingPlaceCandidate['id']): string {
    return String.fromCharCode(64 + Number(id.slice(1)));
}

/** The tree's place keys of a question's forms (as the facts write them). */
export function placeQuestionKeys(w: Pick<LiveWaiting, 'forms'>): string[] {
    return [...new Set((w.forms ?? []).map(placeKey).filter(Boolean))];
}

export interface PlaceQuestionFacts {
    /** People with a fact at the place. */
    persons: PersonId[];
    /** The facts there. */
    facts: number;
    /** The years of those facts, when any has one. */
    from?: number;
    to?: number;
}

/** What a question is about in the tree: the facts written with one of its forms. */
export function placeQuestionFacts(data: StromData, forms: readonly string[]): PlaceQuestionFacts {
    const keys = new Set(forms.map(placeKey).filter(Boolean));
    const persons = new Set<PersonId>();
    let facts = 0;
    let from: number | undefined;
    let to: number | undefined;
    if (keys.size === 0) return { persons: [], facts: 0 };
    forEachPlaceFact(data, fact => {
        const v = fact.place?.trim();
        if (!v || !keys.has(placeKey(v))) return;
        facts++;
        for (const id of fact.persons) persons.add(id);
        const y = yearOf(fact.date);
        if (y !== null) {
            from = from === undefined ? y : Math.min(from, y);
            to = to === undefined ? y : Math.max(to, y);
        }
    });
    return { persons: [...persons], facts, ...(from !== undefined ? { from, to } : {}) };
}

/** The people of several questions together (each person once). */
export function placeQuestionsPersons(data: StromData, items: readonly Pick<LiveWaiting, 'forms'>[]): number {
    return placeQuestionFacts(data, items.flatMap(w => w.forms ?? [])).persons.length;
}

/** Who gave the location a conflict has now, as the app says it. */
export type CurrentOrigin = 'hand' | 'map' | 'research' | 'other';

/**
 * Who gave a conflict's current location: the tree's own location of one of
 * its forms at the same spot wins (a location the app wrote returns from the
 * research as `person`: the geocoder's stays `map`, a pick `hand`), else the
 * research's `by`.
 */
export function conflictOrigin(w: PlaceQuestion, geos: Readonly<Record<string, PlaceGeo>> | undefined): { origin: CurrentOrigin; at?: string } {
    for (const key of placeQuestionKeys(w)) {
        const geo = geos?.[key];
        if (geo && w.current && sameCoords(geo, w.current)) {
            return { origin: geo.origin ?? 'map', ...(geo.at ? { at: geo.at } : {}) };
        }
    }
    return { origin: w.by === 'research' ? 'research' : w.by === 'person' ? 'hand' : 'other' };
}

/** A conflict whose location was placed by hand: bulk steps leave it (only one by one). */
export function isHandConflict(w: PlaceQuestion, geos: Readonly<Record<string, PlaceGeo>> | undefined): boolean {
    return w.question === 'conflict' && conflictOrigin(w, geos).origin === 'hand';
}

/** "Accept all suggested": suggestions and conflicts with a suggestion, not one placed by hand. */
export function bulkAcceptable(items: readonly PlaceQuestion[], geos: Readonly<Record<string, PlaceGeo>> | undefined): PlaceQuestion[] {
    return items.filter(w => (w.question === 'propose' || w.question === 'conflict')
        && !!w.candidates?.length && !isHandConflict(w, geos));
}

/** "Keep all": every conflict. */
export function bulkKeepable(items: readonly PlaceQuestion[]): PlaceQuestion[] {
    return items.filter(w => w.question === 'conflict');
}

/** Conflicts left out of "Accept all suggested" because their location was placed by hand. */
export function bulkHandConflicts(items: readonly PlaceQuestion[], geos: Readonly<Record<string, PlaceGeo>> | undefined): PlaceQuestion[] {
    return items.filter(w => isHandConflict(w, geos) && !!w.candidates?.length);
}

export interface PlaceArea {
    /** The district (or the country without one) of candidate A, as the research writes it. */
    name: string;
    /** The record ids of its questions. */
    places: string[];
}

/**
 * "By area": the acceptable questions by their first candidate's district
 * (its country without one); one with neither is in no area. Most questions
 * first, then by name. Only when there are two areas or more (one area is
 * "Accept all" again).
 */
export function placeAreas(acceptable: readonly PlaceQuestion[]): PlaceArea[] {
    const areas = new Map<string, PlaceArea>();
    for (const w of acceptable) {
        const c = w.candidates?.[0];
        const name = c?.district || c?.country;
        if (!name) continue;
        const a = areas.get(name) ?? { name, places: [] };
        a.places.push(w.place);
        areas.set(name, a);
    }
    const list = [...areas.values()].sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
    return list.length >= 2 ? list : [];
}

/** A question's small map never comes closer than this (about 15 km across): near points stay apart, the area is seen. */
export const WAITING_MAP_POINTS_ZOOM = 11;
/** The family's places alone (no point of the question): as close as the map goes. */
export const WAITING_MAP_TREE_ZOOM = 13;

/**
 * The points a question's small map is about: a conflict's location now and
 * its suggestion, a "where is"'s candidates (and a location now, if sent).
 */
export function waitingMapPoints(w: PlaceQuestion): { lat: number; lon: number }[] {
    const cands = w.question === 'conflict' ? (w.candidates ?? []).slice(0, 1) : pickableCandidates(w);
    return [...cands, ...(w.current ? [w.current] : [])];
}

/**
 * The view of a question's small map: fitted to the question's own points
 * (far apart: both in; close: not closer than WAITING_MAP_POINTS_ZOOM), the
 * family's places only drawn where they fall in it. No point of the
 * question: the family's places.
 */
export function waitingMapView(points: readonly PlaceGeo[], tree: readonly PlaceGeo[], width: number, height: number, padding = 26): { center: PlaceGeo; zoom: number } {
    const own = points.length > 0;
    const fit = fitBounds([...(own ? points : tree)], width, height, padding);
    return { center: fit.center, zoom: Math.min(fit.zoom, own ? WAITING_MAP_POINTS_ZOOM : WAITING_MAP_TREE_ZOOM) };
}

/**
 * Pins closer than `gap` px pushed apart (the location now never hidden under
 * a candidate's letter), kept `margin` px inside the map. The same point
 * twice: side by side, the earlier one left.
 */
export function spreadPins(at: readonly { x: number; y: number }[], width: number, height: number, gap = 26, margin = 11): { x: number; y: number }[] {
    const out = at.map(p => ({ x: p.x, y: p.y }));
    const clampIn = (p: { x: number; y: number }): void => {
        p.x = Math.min(Math.max(p.x, margin), Math.max(margin, width - margin));
        p.y = Math.min(Math.max(p.y, margin), Math.max(margin, height - margin));
    };
    for (let round = 0; round < 12; round++) {
        let moved = false;
        for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                const a = out[i], b = out[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                if (d >= gap - 0.01) continue;
                if (d < 0.01) { dx = 1; dy = 0; d = 1; }
                const push = (gap - Math.hypot(b.x - a.x, b.y - a.y)) / 2;
                a.x -= (dx / d) * push; a.y -= (dy / d) * push;
                b.x += (dx / d) * push; b.y += (dy / d) * push;
                clampIn(a); clampIn(b);
                moved = true;
            }
        }
        if (!moved) break;
    }
    return out;
}
