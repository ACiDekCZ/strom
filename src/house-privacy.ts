/**
 * A house in outputs (spec 030 §10, K1.4, K1.4a): the book, the saved HTML
 * and the family pages show a house as history, never as today's address.
 * The rules are those of src/privacy.ts (who is living, who is of the last
 * ~100 years, RECENT_YEARS) applied to one house:
 *
 * - today's owners and residents never (nothing asks for them; a holder or a
 *   resident the tree does not know, of the last ~100 years, is left out);
 * - the living without their names (the output's privacy names them);
 * - people of the last ~100 years by name and role only, without years, and
 *   their facts at the house left out;
 * - "lived in the house", not "owned it", unless a source shows the holding;
 * - the research's events of the last ~100 years and its sensitive events
 *   (confiscation, expulsion, collectivisation, auctions, allotments) left
 *   out, a sensitive one until a person reveals it (HouseUserData.revealInOutputs);
 * - the house's location only for a house without people of the last ~100 years.
 *
 * In the app everything shows (the living by today's rules); this is for
 * outputs only. `now` comes from the caller (fixed in tests).
 */

import type { HouseUserData, Person, PersonId, StromData } from './types.js';
import type { HouseEvent, HouseHolder, HouseResearch, HouseResident, HouseStoryText } from './house-bridge.js';
import type { HouseFact, TreeHouse } from './houses.js';
import { inferBirthUpperBounds, isLivingPerson, isRecentPerson, recentFrom } from './privacy.js';
import { personResearchRef } from './verify.js';
import { yearOf } from './dates.js';

/** What one output knows of the tree's people, built once for all its houses. */
export interface HousePrivacyContext {
    currentYear: number;
    /** The first year of the last ~100 years. */
    from: number;
    living: (id: PersonId) => boolean;
    recent: (id: PersonId) => boolean;
    /** The tree's person of a research's person ref (P…), or null. */
    personOfRef: (ref: string | undefined) => PersonId | null;
}

export function housePrivacyContext(data: StromData, now: Date): HousePrivacyContext {
    const currentYear = now.getFullYear();
    const bounds = inferBirthUpperBounds(data);
    const living = new Map<PersonId, boolean>();
    const recent = new Map<PersonId, boolean>();
    let refs: Map<string, PersonId> | null = null;
    const person = (id: PersonId): Person | undefined => data.persons[id];
    return {
        currentYear,
        from: recentFrom(currentYear),
        living: id => {
            let v = living.get(id);
            if (v === undefined) {
                const p = person(id);
                v = !!p && !p.isPlaceholder && isLivingPerson(p, currentYear, bounds);
                living.set(id, v);
            }
            return v;
        },
        recent: id => {
            let v = recent.get(id);
            if (v === undefined) {
                const p = person(id);
                v = !!p && isRecentPerson(data, p, currentYear, bounds);
                recent.set(id, v);
            }
            return v;
        },
        personOfRef: ref => {
            if (!ref) return null;
            if (!refs) {
                refs = new Map();
                for (const p of Object.values(data.persons)) {
                    const r = personResearchRef(p);
                    if (r && !refs.has(r)) refs.set(r, p.id);
                }
            }
            return refs.get(ref) ?? null;
        },
    };
}

/** One of the house's people as an output shows them. */
export interface HouseOutputPerson {
    personId: PersonId;
    /** Living: named as the output's privacy names the living. */
    living: boolean;
    /** Of the last ~100 years: name and role only, no years, no facts. */
    recent: boolean;
}

/** A holder or resident of the research as an output shows them. */
export interface HouseOutputHolder<T extends HouseHolder | HouseResident> {
    item: T;
    /** The tree's person, when the research names one. */
    personId: PersonId | null;
    living: boolean;
    /** Name and role only: no years. */
    noYears: boolean;
    /** "Owned the house" only with a source showing it; otherwise "lived in the house". */
    owned: boolean;
}

export interface HouseOutput {
    /** The tree's people of the house, by their first year there. */
    persons: HouseOutputPerson[];
    /** The tree's facts at the house an output may show (not those of people of the last ~100 years). */
    facts: HouseFact[];
    /** The research's events an output may show. */
    timeline: HouseEvent[];
    holders: HouseOutputHolder<HouseHolder>[];
    residents: HouseOutputHolder<HouseResident>[];
    /** The location an output may show, or null. */
    location: { lat: number; lng: number } | null;
    /** The research's sensitive events still hidden (not revealed), by id. */
    sensitiveHidden: string[];
    /** What outputs leave out: the research's events (sensitive and of the last ~100 years), the tree's facts, the location. */
    hidden: { events: number; facts: number; location: boolean };
}

const yearsOf = (...dates: (string | undefined)[]): number[] =>
    dates.map(d => yearOf(d)).filter((y): y is number => y !== null);

/**
 * The house as an output may show it. `research` is the research's whole
 * result of the house (null: none read); `ctx` built once per output
 * (housePrivacyContext) or here from `data` and `now`.
 */
export function houseOutputFilter(house: TreeHouse, research: HouseResearch | null, data: StromData, now: Date,
    ctx: HousePrivacyContext = housePrivacyContext(data, now)): HouseOutput {
    const user: HouseUserData | undefined = data.houses?.[house.id];
    const revealed = new Set(user?.revealInOutputs ?? []);
    const from = ctx.from;

    const persons: HouseOutputPerson[] = house.personIds
        .filter(id => data.persons[id] && !data.persons[id].isPlaceholder)
        .map(id => ({ personId: id, living: ctx.living(id), recent: ctx.recent(id) }));
    const shielded = new Set(persons.filter(p => p.recent || p.living).map(p => p.personId));
    const facts = house.facts.filter(f => !shielded.has(f.personId) && !(f.year !== undefined && f.year >= from));
    const hiddenFacts = house.facts.length - facts.length;

    const sensitive = new Set(research?.sensitive ?? []);
    const timeline: HouseEvent[] = [];
    let hiddenEvents = 0;
    for (const e of research?.timeline ?? []) {
        const y = yearOf(e.date);
        const show = sensitive.has(e.id) ? revealed.has(e.id) : !(y !== null && y >= from);
        if (show) timeline.push(e); else hiddenEvents++;
    }
    const sensitiveHidden = [...sensitive].filter(id => !revealed.has(id));

    let recentPeople = shielded.size > 0 || house.facts.some(f => f.year !== undefined && f.year >= from);
    const holderOf = <T extends HouseHolder | HouseResident>(item: T): HouseOutputHolder<T> | null => {
        const personId = ctx.personOfRef(item.person);
        const inRecent = yearsOf(item.from, item.to).some(y => y >= from);
        if (personId) {
            const living = ctx.living(personId);
            const recent = living || ctx.recent(personId) || inRecent;
            if (recent) recentPeople = true;
            return { item, personId, living, noYears: recent, owned: 'how' in item && item.sources.length > 0 };
        }
        // Someone the tree does not know, of the last ~100 years: possibly today's owner or resident — never.
        if (inRecent) {
            recentPeople = true;
            return null;
        }
        return { item, personId: null, living: false, noYears: false, owned: 'how' in item && item.sources.length > 0 };
    };
    const holders = (research?.holders ?? []).map(holderOf).filter((h): h is HouseOutputHolder<HouseHolder> => !!h);
    const residents = (research?.residents ?? []).map(holderOf).filter((h): h is HouseOutputHolder<HouseResident> => !!h);

    const loc = user?.location
        ? { lat: user.location.lat, lng: user.location.lng }
        : research?.location ? { lat: research.location.lat, lng: research.location.lon } : null;
    const location = loc && !recentPeople ? loc : null;

    return {
        persons, facts, timeline, holders, residents, location, sensitiveHidden,
        hidden: { events: hiddenEvents, facts: hiddenFacts, location: !!loc && !location },
    };
}

/**
 * The house's story an output may show (spec 145 T4): its approved text only, never a draft or a version waiting
 * beside it. None when it names a protected person — living or of the last ~100 years, or a person of the research
 * the tree does not know and whose death is not known — or rests on what the output leaves out (an event hidden, a
 * holder or resident left out or shown without years): the story is left out whole, as the book leaves out a
 * protected person's story; its text is never rewritten.
 */
export function houseStoryForOutput(research: HouseResearch | null, out: HouseOutput, ctx: HousePrivacyContext): HouseStoryText | null {
    const story = research?.story;
    if (!story || story.status !== 'final') return null;
    for (const p of story.people) {
        const id = ctx.personOfRef(p.id);
        if (id ? ctx.living(id) || ctx.recent(id) : !p.died) return null;
    }
    const low = (id: string): string => id.toLowerCase();
    const items = new Set([...research.timeline, ...research.holders, ...research.residents].map(x => low(x.id)));
    const shown = new Set([...out.timeline.map(e => low(e.id)),
        ...[...out.holders, ...out.residents].filter(h => !h.noYears).map(h => low(h.item.id))]);
    if (story.facts.some(f => items.has(low(f)) && !shown.has(low(f)))) return null;
    return {
        ...(story.title ? { title: story.title } : {}), text: story.text, facts: story.facts, sources: story.sources,
        ...(story.at ? { at: story.at } : {}), people: story.people,
    };
}
