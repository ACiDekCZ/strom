/**
 * What happened to people at the tree's houses with history (spec 030 §13):
 * who married into a house, who left a house and where for, who was the
 * last of it. Read on the tree an output shows (the set's protected copy),
 * each house's facts through houseOutputFilter (nothing of the people of the
 * last ~100 years, K1.4a). Pure.
 */

import { houseOutputFilter, housePrivacyContext, type HousePrivacyContext } from './house-privacy.js';
import { generationsOf, houseLabel, houseTitle, type HouseFact, type TreeHouse } from './houses.js';
import { forEachPlaceFact, placeKey } from './places.js';
import { yearOf } from './dates.js';
import type { HouseId, PersonId, StromData } from './types.js';

export type HouseLifeKind = 'marriedIn' | 'left' | 'last';

export interface HouseLifeEvent {
    kind: HouseLifeKind;
    year: number;
    personId: PersonId;
    sex: 'm' | 'f';
    houseId: HouseId;
    /** The house as the tree writes it ("čp. 16"). */
    house: string;
    town: string;
    /**
     * 'left': where the person went: a house of the tree in another town with its town ("Bělokamen čp.\u00a016"),
     * one in the same town alone ("čp.\u00a016"), else the place.
     */
    to?: string;
}

/** A house of the tree with what an output may show of it. */
export interface OutputHouse {
    house: TreeHouse;
    /** The house's facts an output may show. */
    facts: readonly HouseFact[];
    /** The first and the last year of those facts (none without a dated one). */
    period?: { from: number; to: number };
    /** The generations of the people of those facts (not of the people left out). */
    generations: number;
}

/** The tree's houses with history as an output may show them (those with no fact left out), the house's facts filtered. */
export function outputHouses(data: StromData, houses: readonly TreeHouse[], now: Date,
    ctx: HousePrivacyContext = housePrivacyContext(data, now)): OutputHouse[] {
    const out: OutputHouse[] = [];
    for (const house of houses) {
        if (!house.overThreshold) continue;
        const facts = houseOutputFilter(house, null, data, now, ctx).facts;
        if (!facts.length) continue;
        const years = facts.map(f => f.year).filter((y): y is number => y !== undefined);
        const generations = generationsOf(data, new Set(facts.map(f => f.personId)));
        out.push({ house, facts, generations, ...(years.length ? { period: { from: Math.min(...years), to: Math.max(...years) } } : {}) });
    }
    return out;
}

/**
 * The events of the houses: a marriage into a house (K1.2), a person's
 * leaving a house (the person's first later dated fact at another house or in
 * another town), the last person of a house (the latest fact of a house whose
 * facts an output shows whole). Only from the facts the output shows; a
 * destination from a fact of `until` or later is not named.
 */
export function houseLifeEvents(data: StromData, houses: readonly OutputHouse[], until: number): HouseLifeEvent[] {
    const events: HouseLifeEvent[] = [];
    const sexOf = (id: PersonId): 'm' | 'f' => (data.persons[id]?.gender === 'female' ? 'f' : 'm');
    const houseOfRef = new Map<string, TreeHouse>();
    for (const h of houses) for (const f of h.facts) houseOfRef.set(`${f.personId}\u0000${f.factRef}`, h.house);
    // Each person's dated places in order (a fact at a house names the house).
    const where = new Map<PersonId, { year: number; place: string; house?: TreeHouse }[]>();
    forEachPlaceFact(data, fact => {
        const year = yearOf(fact.date);
        const place = fact.place?.trim();
        if (year === null || year >= until || !place) return;
        for (const pid of fact.persons) {
            const list = where.get(pid) ?? where.set(pid, []).get(pid)!;
            const house = houseOfRef.get(`${pid}\u0000${fact.ref}`);
            list.push({ year, place, ...(house ? { house } : {}) });
        }
    });
    // A marriage into a house puts the person there from its year.
    for (const { house: h, facts } of houses) {
        const shown = new Set(facts.map(f => f.personId));
        for (const m of h.marriedIn) {
            if (m.year === undefined || m.year >= until || !shown.has(m.personId)) continue;
            const list = where.get(m.personId) ?? where.set(m.personId, []).get(m.personId)!;
            list.push({ year: m.year, place: h.ref.town, house: h });
        }
    }
    for (const list of where.values()) list.sort((a, b) => a.year - b.year);

    for (const { house: h, facts, period } of houses) {
        const base = { houseId: h.id, house: h.text, town: h.ref.town };
        const shown = new Set(facts.map(f => f.personId));
        for (const m of h.marriedIn) {
            if (m.year === undefined || m.year >= until || !shown.has(m.personId)) continue;
            events.push({ kind: 'marriedIn', year: m.year, personId: m.personId, sex: m.sex, ...base });
        }
        for (const pid of shown) {
            const last = Math.max(...facts.filter(f => f.personId === pid && f.year !== undefined).map(f => f.year!));
            if (!Number.isFinite(last)) continue;
            // The first later fact elsewhere: at another house or in another town (one in the same town without a house says nothing).
            const next = (where.get(pid) ?? []).find(p => p.year > last && (p.house ? p.house !== h : placeKey(p.place) !== h.townKey));
            if (!next) continue;
            const to = !next.house ? next.place
                : next.house.townKey === h.townKey ? houseLabel(next.house.text) : houseTitle(next.house);
            events.push({ kind: 'left', year: next.year, personId: pid, sex: sexOf(pid), ...base, to });
        }
        // The last of the house: only when the output shows all its facts (a hidden later one would make it wrong).
        if (period && facts.length === h.facts.length) {
            const lastFact = [...facts].reverse().find(f => f.year === period.to);
            if (lastFact) events.push({ kind: 'last', year: period.to, personId: lastFact.personId, sex: sexOf(lastFact.personId), ...base });
        }
    }
    const order: Record<HouseLifeKind, number> = { marriedIn: 0, left: 1, last: 2 };
    return events.sort((a, b) => a.year - b.year || order[a.kind] - order[b.kind] || (a.houseId < b.houseId ? -1 : a.houseId > b.houseId ? 1 : 0));
}

/** The houses with history an output shows and their events (outputHouses, houseLifeEvents), worked out once. */
export interface HouseOutputs {
    houses: OutputHouse[];
    events: HouseLifeEvent[];
}

export function houseOutputs(data: StromData, houses: readonly TreeHouse[], now: Date): HouseOutputs {
    const ctx = housePrivacyContext(data, now);
    const shown = outputHouses(data, houses, now, ctx);
    return { houses: shown, events: houseLifeEvents(data, shown, ctx.from) };
}
