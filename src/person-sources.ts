/**
 * A person's sources: every source cited on the person, the person's events
 * and the person's marriages (and their events), one row per source with what
 * it supports here. Pure — the person menu's "Sources" dialog and the person
 * page (spec 025) both read it.
 */

import { StromData, PersonId, PartnershipId, Source, LifeEvent, CoupleEvent, Story } from './types.js';
import { storyBasisSourceIds } from './story-sources.js';
import { yearOf } from './dates.js';
import { sortCoupleEvents, sortLifeEvents } from './events.js';
import { shownName } from './person-name.js';
import { strings as appStrings } from './strings.js';
import { CitationHolder, citationQuality } from './citation-quality.js';

type Strings = typeof appStrings;

/** Where a citation sits: on the person (or a fact or event of theirs), or on a couple. */
export type PersonSourceCiteContext =
    | { personId: PersonId; eventId?: string; fact?: 'birth' | 'death' }
    | { partnershipId: PartnershipId; eventId?: string; fact?: 'divorce' };

/** One thing a source supports for this person ("Person", "Baptism 1865", "Marriage 1890"). */
export interface PersonSourceCite {
    label: string;
    ctx: PersonSourceCiteContext;
    year: number | null;
    /** Tooltip telling two marriages apart. */
    title?: string;
    /** Cited by a story (Story.sources), not by a fact: listed after the facts. */
    story?: true;
    /** The citation's QUAY (spec 077: its own, else its source's); none for a story's. */
    quality?: number;
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
 * like a life; undated ones last, then by title. `stories`: the sources the
 * person's own story and the person's couples' stories rest on count too
 * (the person page and the family book, where those stories are told).
 */
export function personSourceRows(data: StromData, personId: PersonId, S: Strings = appStrings,
    opts: { stories?: boolean } = {}): PersonSourceRow[] {
    const catalog = data.sources ?? {};
    const person = data.persons[personId];
    if (!person) return [];
    const fullName = (id: PersonId): string => {
        const p = data.persons[id];
        return p ? shownName(p) : '?';
    };
    const rows = new Map<string, PersonSourceRow>();
    const addIds = (ids: string[] | undefined, cite: PersonSourceCite, quality?: (id: string) => number | undefined) => {
        for (const id of new Set(ids ?? [])) {
            const source = catalog[id];
            if (!source) continue;
            const row = rows.get(id) ?? { source, cites: [] };
            const q = quality?.(id);
            if (!row.cites.some(c => c.label === cite.label)) row.cites.push(q !== undefined ? { ...cite, quality: q } : cite);
            rows.set(id, row);
        }
    };
    /** A list of citations (`holder[field]`), each with its QUAY. */
    const add = <F extends string>(holder: CitationHolder<F> & Partial<Record<F, string[]>>, field: F, cite: PersonSourceCite) =>
        addIds(holder[field], cite, id => citationQuality(holder, field, id, catalog));
    const withYear = (label: string, year: number | null) => (year !== null ? `${label} ${year}` : label);
    add(person, 'sourceIds', { label: S.personSources.citePerson, ctx: { personId }, year: null });
    // The birth and death entries (GEDCOM BIRT.SOUR / DEAT.SOUR).
    for (const fact of ['birth', 'death'] as const) {
        const year = yearOf(fact === 'birth' ? person.birthDate : person.deathDate);
        add(person, fact === 'birth' ? 'birthSourceIds' : 'deathSourceIds',
            { label: withYear(S.events.types[fact], year), ctx: { personId, fact }, year });
    }
    for (const ev of sortLifeEvents(person.events ?? [])) {
        const year = yearOf(ev.date);
        add(ev, 'sourceIds', { label: withYear(lifeEventLabel(ev, S), year), ctx: { personId, eventId: ev.id }, year });
    }
    for (const u of Object.values(data.partnerships)) {
        if (u.person1Id !== personId && u.person2Id !== personId) continue;
        const year = yearOf(u.startDate);
        add(u, 'sourceIds', {
            label: S.personSources.citeUnion(year), ctx: { partnershipId: u.id }, year,
            title: S.sources.citedPartnership(fullName(u.person1Id), fullName(u.person2Id)),
        });
        // The divorce's own record: "Divorce 1890".
        const endYear = yearOf(u.endDate);
        add(u, 'divorceSourceIds', {
            label: withYear(S.fields.divorceRow, endYear), ctx: { partnershipId: u.id, fact: 'divorce' }, year: endYear,
            title: S.partnerEvents.cited(S.fields.divorceRow, S.partnerEvents.couple(fullName(u.person1Id), fullName(u.person2Id))),
        });
        // The couple's events (banns, a census): "Banns 1888".
        for (const ev of sortCoupleEvents(u.events ?? [])) {
            const evYear = yearOf(ev.date);
            add(ev, 'sourceIds', {
                label: withYear(coupleEventLabelIn(ev, S), evYear), ctx: { partnershipId: u.id, eventId: ev.id }, year: evYear,
                title: S.partnerEvents.cited(coupleEventLabelIn(ev, S),
                    S.partnerEvents.couple(fullName(u.person1Id), fullName(u.person2Id))),
            });
        }
    }
    if (opts.stories) {
        // A story's sources (its facts' and its background's, e.g. a chronicle no event cites).
        // Its pointers and the sources its facts cite by code, as the story's section lists them.
        const told = (st: Story | undefined) => (st?.text?.trim() ? storyBasisSourceIds(catalog, st) : undefined);
        addIds(told(person.story), { label: S.personPage.sec.story, ctx: { personId }, year: null, story: true });
        for (const u of Object.values(data.partnerships)) {
            if (u.person1Id !== personId && u.person2Id !== personId) continue;
            addIds(told(u.story), {
                label: S.personPage.story.titleCouple, ctx: { partnershipId: u.id }, year: null, story: true,
                title: S.sources.citedPartnership(fullName(u.person1Id), fullName(u.person2Id)),
            });
        }
    }
    const byYear = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
    const list = [...rows.values()];
    for (const row of list) {
        // Collected person → events → marriages → stories: the first is what a click opens.
        const own = row.cites.filter(c => !c.story && 'personId' in c.ctx && !c.ctx.eventId && !c.ctx.fact);
        const rest = row.cites.filter(c => !own.includes(c) && !c.story).sort((a, b) => byYear(a.year, b.year));
        row.cites = [...own, ...rest, ...row.cites.filter(c => c.story)];
    }
    const rowYear = (r: PersonSourceRow): number | null => {
        const years = r.cites.map(c => c.year).filter((y): y is number => y !== null);
        return years.length > 0 ? Math.min(...years) : yearOf(r.source.recordDate);
    };
    return list.sort((a, b) => byYear(rowYear(a), rowYear(b)) || a.source.title.localeCompare(b.source.title));
}

/**
 * The reliability a row shows once (spec 077): that of its citations when
 * they all say the same (a row only stories cite: its source's), null when
 * they differ and each citation shows its own.
 */
export function rowQuality(row: PersonSourceRow): number | undefined | null {
    const facts = row.cites.filter(c => !c.story);
    if (facts.length === 0) return row.source.quality;
    const first = facts[0].quality;
    return facts.every(c => c.quality === first) ? first : null;
}
