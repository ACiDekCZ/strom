/**
 * A person's sources: every source cited on the person, the person's events
 * and the person's marriages (and their events), one row per source with what
 * it supports here. Pure — the person menu's "Sources" dialog and the person
 * page (spec 025) both read it.
 */

import { StromData, PersonId, PartnershipId, Source, LifeEvent, CoupleEvent } from './types.js';
import { yearOf } from './dates.js';
import { sortCoupleEvents, sortLifeEvents } from './events.js';
import { shownName } from './person-name.js';
import { strings as appStrings } from './strings.js';

type Strings = typeof appStrings;

/** Where a citation sits: on the person (or a fact or event of theirs), or on a couple. */
export type PersonSourceCiteContext =
    | { personId: PersonId; eventId?: string; fact?: 'birth' | 'death' }
    | { partnershipId: PartnershipId; eventId?: string };

/** One thing a source supports for this person ("Person", "Baptism 1865", "Marriage 1890"). */
export interface PersonSourceCite {
    label: string;
    ctx: PersonSourceCiteContext;
    year: number | null;
    /** Tooltip telling two marriages apart. */
    title?: string;
}

/** One source and everything it supports for the person. */
export interface PersonSourceRow {
    source: Source;
    cites: PersonSourceCite[];
}

/** A person event's label in the language of `S` (a custom label as written). */
export function lifeEventLabel(ev: Pick<LifeEvent, 'type' | 'customLabel'>, S: Strings = appStrings): string {
    if (ev.type === 'custom' && ev.customLabel) return ev.customLabel;
    return S.events.types[ev.type];
}

/** A couple event's label in the language of `S`. */
export function coupleEventLabelIn(ev: Pick<CoupleEvent, 'type' | 'customLabel'>, S: Strings = appStrings): string {
    if (ev.type === 'custom' && ev.customLabel?.trim()) return ev.customLabel.trim();
    return S.partnerEvents.types[ev.type];
}

/**
 * The person's citations merged per source: person, events, marriages. Each
 * source is one row whose labels say what it supports; rows are ordered by
 * the earliest year they document (else the record date), so the list reads
 * like a life; undated ones last, then by title.
 */
export function personSourceRows(data: StromData, personId: PersonId, S: Strings = appStrings): PersonSourceRow[] {
    const catalog = data.sources ?? {};
    const person = data.persons[personId];
    if (!person) return [];
    const fullName = (id: PersonId): string => {
        const p = data.persons[id];
        return p ? shownName(p) : '?';
    };
    const rows = new Map<string, PersonSourceRow>();
    const add = (ids: string[] | undefined, cite: PersonSourceCite) => {
        for (const id of new Set(ids ?? [])) {
            const source = catalog[id];
            if (!source) continue;
            const row = rows.get(id) ?? { source, cites: [] };
            if (!row.cites.some(c => c.label === cite.label)) row.cites.push(cite);
            rows.set(id, row);
        }
    };
    const withYear = (label: string, year: number | null) => (year !== null ? `${label} ${year}` : label);
    add(person.sourceIds, { label: S.personSources.citePerson, ctx: { personId }, year: null });
    // The birth and death entries (GEDCOM BIRT.SOUR / DEAT.SOUR).
    for (const fact of ['birth', 'death'] as const) {
        const year = yearOf(fact === 'birth' ? person.birthDate : person.deathDate);
        add(fact === 'birth' ? person.birthSourceIds : person.deathSourceIds,
            { label: withYear(S.events.types[fact], year), ctx: { personId, fact }, year });
    }
    for (const ev of sortLifeEvents(person.events ?? [])) {
        const year = yearOf(ev.date);
        add(ev.sourceIds, { label: withYear(lifeEventLabel(ev, S), year), ctx: { personId, eventId: ev.id }, year });
    }
    for (const u of Object.values(data.partnerships)) {
        if (u.person1Id !== personId && u.person2Id !== personId) continue;
        const year = yearOf(u.startDate);
        add(u.sourceIds, {
            label: S.personSources.citeUnion(year), ctx: { partnershipId: u.id }, year,
            title: S.sources.citedPartnership(fullName(u.person1Id), fullName(u.person2Id)),
        });
        // The couple's events (banns, a census): "Banns 1888".
        for (const ev of sortCoupleEvents(u.events ?? [])) {
            const evYear = yearOf(ev.date);
            add(ev.sourceIds, {
                label: withYear(coupleEventLabelIn(ev, S), evYear), ctx: { partnershipId: u.id, eventId: ev.id }, year: evYear,
                title: S.partnerEvents.cited(coupleEventLabelIn(ev, S),
                    S.partnerEvents.couple(fullName(u.person1Id), fullName(u.person2Id))),
            });
        }
    }
    const byYear = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
    const list = [...rows.values()];
    for (const row of list) {
        // Collected person → events → marriages: the first is what a click opens.
        const own = row.cites.filter(c => 'personId' in c.ctx && !c.ctx.eventId && !c.ctx.fact);
        const rest = row.cites.filter(c => !own.includes(c)).sort((a, b) => byYear(a.year, b.year));
        row.cites = [...own, ...rest];
    }
    const rowYear = (r: PersonSourceRow): number | null => {
        const years = r.cites.map(c => c.year).filter((y): y is number => y !== null);
        return years.length > 0 ? Math.min(...years) : yearOf(r.source.recordDate);
    };
    return list.sort((a, b) => byYear(rowYear(a), rowYear(b)) || a.source.title.localeCompare(b.source.title));
}
