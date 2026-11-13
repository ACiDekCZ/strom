/**
 * A godparent or a witness recorded by name who is probably in the tree
 * (spec 085 §6, K1.4).
 *
 * A register names the godparent as "Jakub Mlčoch"; the tree may well hold a
 * Jakub Mlčoch who lived then. The app offers to link the two and never links
 * by itself: the same name is often a father and his son, both alive at the
 * baptism. A candidate is a person of the tree with the same given name and
 * surname (folded: no case, no diacritics; the married surname counts too),
 * who lived at the event's date and was at least 12 years old then, and who
 * is not a person of the event itself. Persons the user said the participant
 * is not (`linkRejected`) are never offered again.
 *
 * The year of birth and the house (the address of the birth or of the
 * residence nearest to the event's date) are only shown, to tell candidates
 * apart.
 *
 * The persons are found through an index by the folded name, built once per
 * state of the tree (a tree of 4 200 persons has thousands of participants).
 */

import { StromData, Person, PersonId, PartnershipId, ParticipantRole, EventParticipant } from './types.js';
import { parseFlexDate, yearOf, FlexDate } from './dates.js';
import { participantName, foldName, attendsByOffice } from './godparents.js';
import { allShareCopies, MARRIAGE_EVENT_ID } from './shared-events.js';

/** The youngest a godparent or a witness could be, in whole years. */
export const MIN_PARTICIPANT_AGE = 12;

/** One person of the tree a participant recorded by name may be. */
export interface ParticipantMatch {
    personId: PersonId;
    /** The year of birth, null when unknown. */
    birthYear: number | null;
    /** The house: the address of the birth or the residence nearest to the event's date ('' without any). */
    house: string;
}

/** The event a participant is looked up for. */
export interface MatchEvent {
    /** The event's date (flex date); without one, no one is left out by age or life. */
    date?: string;
    /** The persons the event is of (the baptized child, the couple…): never a candidate. */
    subjects?: readonly PersonId[];
    /** Persons left out besides: those said not to be the participant, those linked to the event already. */
    exclude?: readonly PersonId[];
}

/** Folded full name → the persons of the tree with it. */
export type PersonNameIndex = Map<string, PersonId[]>;

/** The keys a person is found under: the given name with the birth surname, and with the married one. */
function personNameKeys(p: Person): string[] {
    const keys = new Set<string>();
    const add = (first: string | undefined, last: string | undefined): void => {
        const f = first?.trim();
        const l = last?.trim();
        if (f && l) keys.add(foldName(`${f} ${l}`));
    };
    add(p.firstName, p.lastName);
    if (p.marriedSurname) {
        add(p.firstName, p.marriedSurname);
        if (p.marriedFirstName) add(p.marriedFirstName, p.marriedSurname);
    }
    return [...keys];
}

/** Build the index of the tree's persons by their folded names (placeholders left out). */
export function buildPersonNameIndex(data: StromData): PersonNameIndex {
    const index: PersonNameIndex = new Map();
    for (const p of Object.values(data.persons)) {
        if (!p || p.isPlaceholder) continue;
        for (const key of personNameKeys(p)) {
            const list = index.get(key);
            if (list) list.push(p.id); else index.set(key, [p.id]);
        }
    }
    return index;
}

type Ymd = [number, number, number];
const cmp = (a: Ymd, b: Ymd): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const firstDay = (d: { year: number; month?: number; day?: number }): Ymd => [d.year, d.month ?? 1, d.day ?? 1];
const lastDay = (d: { year: number; month?: number; day?: number }): Ymd => [d.year, d.month ?? 12, d.day ?? 31];
/** Slack of a date written "about" (~): two years either way. */
const ABOUT_YEARS = 2;

/** The earliest and the latest day a date can mean (null: open on that side). */
function bounds(d: FlexDate): { from: Ymd | null; to: Ymd | null } {
    const end = d.end ?? d;
    switch (d.qualifier) {
        case '~': return { from: [d.year - ABOUT_YEARS, 1, 1], to: [d.year + ABOUT_YEARS, 12, 31] };
        case '<': return { from: null, to: lastDay(d) };
        case '>': return { from: firstDay(d), to: null };
        default: return { from: firstDay(d), to: lastDay(end) };
    }
}

/** The person's date of birth, else the date of their baptism. */
function birthOf(p: Person): string | undefined {
    if (p.birthDate) return p.birthDate;
    return p.events?.find(e => e.type === 'baptism' && e.date)?.date;
}

/**
 * Could the person have stood at an event of this date: alive then, and at
 * least 12 years old? A date that is missing or unreadable rules nothing out.
 */
export function couldAttend(p: Person, date: string | undefined): boolean {
    const ev = parseFlexDate(date);
    if (!ev) return true;
    const at = bounds(ev);
    const born = parseFlexDate(birthOf(p));
    if (born && at.to) {
        // The oldest the person can have been: born as early as the date allows, the event as late.
        const b = bounds(born).from;
        if (b) {
            const twelfth: Ymd = [b[0] + MIN_PARTICIPANT_AGE, b[1], b[2]];
            if (cmp(twelfth, at.to) > 0) return false;
        }
    }
    const died = parseFlexDate(p.deathDate);
    if (died && at.from) {
        const d = bounds(died).to;
        if (d && cmp(d, at.from) < 0) return false;
    }
    return true;
}

/** The house shown with a candidate: the address (with its place) of the birth or the residence nearest the date. */
export function personHouse(p: Person, date: string | undefined): string {
    const year = yearOf(date);
    const spots: { year: number | null; place?: string; address?: string }[] = [
        { year: yearOf(p.birthDate), place: p.birthPlace, address: p.birthAddress },
        ...(p.events ?? []).filter(e => e.type === 'residence' || e.type === 'census')
            .map(e => ({ year: yearOf(e.date), place: e.place, address: e.address })),
    ];
    const distance = (y: number | null): number => (y === null || year === null ? Number.MAX_SAFE_INTEGER : Math.abs(y - year));
    const pick = (list: typeof spots) => list.reduce<typeof spots[number] | null>(
        (best, s) => (!best || distance(s.year) < distance(best.year) ? s : best), null);
    const withAddress = pick(spots.filter(s => s.address?.trim()));
    if (withAddress) {
        const address = withAddress.address!.trim();
        const place = withAddress.place?.trim();
        if (!place || foldName(address).includes(foldName(place))) return address;
        return `${place} ${address}`;
    }
    return pick(spots.filter(s => s.place?.trim()))?.place?.trim() ?? '';
}

/**
 * The persons of the tree a participant recorded by `name` may be, oldest
 * first (born earlier), those without a known birth last. Empty for a name
 * that does not tell a person (a given name alone).
 */
export function findParticipantMatches(data: StromData, name: string, event: MatchEvent,
    index: PersonNameIndex = buildPersonNameIndex(data)): ParticipantMatch[] {
    const key = participantName(name).key;
    if (!key) return [];
    const ids = index.get(key);
    if (!ids?.length) return [];
    const left = new Set<PersonId>([...(event.subjects ?? []), ...(event.exclude ?? [])]);
    const out: ParticipantMatch[] = [];
    for (const id of ids) {
        if (left.has(id)) continue;
        const p = data.persons[id];
        if (!p || p.isPlaceholder || !couldAttend(p, event.date)) continue;
        out.push({ personId: id, birthYear: yearOf(birthOf(p)), house: personHouse(p, event.date) });
    }
    return out.sort((a, b) => (a.birthYear ?? Infinity) - (b.birthYear ?? Infinity));
}

/** "* 1884, Lhota pod Dubinou č. 9" (`sep` between the year and the house; '' without either). */
export function matchMeta(m: Pick<ParticipantMatch, 'birthYear' | 'house'>, sep = ', '): string {
    return [m.birthYear !== null ? `* ${m.birthYear}` : '', m.house].filter(Boolean).join(sep);
}

/** The roles a name may be linked for: those chosen for the event (not the priest or the midwife by office). */
export function linkableParticipant(part: EventParticipant): boolean {
    return (part.role === 'godparent' || part.role === 'witness') && !part.personId && !!part.name?.trim()
        && !attendsByOffice(part);
}

/** Where a participant is kept: a person's event, a couple's event, or a wedding's witnesses. */
export interface ParticipantRef {
    ownerPersonId?: PersonId;
    partnershipId?: PartnershipId;
    /** The event's id (MARRIAGE_EVENT_ID for the wedding's own witnesses). */
    eventId: string;
    participantId: string;
}

/** A participant recorded by name with the persons of the tree they may be (Data quality, §6 6g). */
export interface NameLinkLead {
    ref: ParticipantRef;
    /** The name as written. */
    name: string;
    role: ParticipantRole;
    note?: string;
    /** The event's type ('marriage' for the wedding). */
    eventType: string;
    customLabel?: string;
    date?: string;
    /** The persons the event is of (all persons of a shared event). */
    subjects: PersonId[];
    shareId?: string;
    candidates: ParticipantMatch[];
}

/** One event that names participants, with what a lead needs of it. */
interface NamingEvent {
    ownerPersonId?: PersonId;
    partnershipId?: PartnershipId;
    eventId: string;
    eventType: string;
    customLabel?: string;
    date?: string;
    subjects: PersonId[];
    shareId?: string;
    participants: EventParticipant[];
}

/** Every event that names participants, a shared event once (its first copy). */
function namingEvents(data: StromData): NamingEvent[] {
    const out: NamingEvent[] = [];
    const real = (pid: PersonId | undefined): pid is PersonId => !!pid && !!data.persons[pid] && !data.persons[pid].isPlaceholder;
    const shares = allShareCopies(data);
    const seenShares = new Set<string>();
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) {
            if (!ev.participants?.length) continue;
            let subjects: PersonId[] = [person.id];
            if (ev.shareId) {
                const copies = shares.get(ev.shareId) ?? [];
                if (copies.length > 1) {
                    if (seenShares.has(ev.shareId)) continue;
                    seenShares.add(ev.shareId);
                    subjects = [...new Set(copies.map(c => c.personId))];
                }
            }
            out.push({
                ownerPersonId: person.id, eventId: ev.id, eventType: ev.type, customLabel: ev.customLabel, date: ev.date,
                subjects: subjects.filter(real), ...(ev.shareId ? { shareId: ev.shareId } : {}), participants: ev.participants,
            });
        }
    }
    for (const union of Object.values(data.partnerships)) {
        if (!union) continue;
        const subjects = [union.person1Id, union.person2Id].filter(real);
        if (union.participants?.length) {
            out.push({ partnershipId: union.id, eventId: MARRIAGE_EVENT_ID, eventType: 'marriage', date: union.startDate, subjects, participants: union.participants });
        }
        for (const ev of union.events ?? []) {
            if (!ev.participants?.length) continue;
            out.push({ partnershipId: union.id, eventId: ev.id, eventType: ev.type, customLabel: ev.customLabel, date: ev.date, subjects, participants: ev.participants });
        }
    }
    return out;
}

/** The persons an event's participants are linked to already. */
const linkedIn = (parts: readonly EventParticipant[]): PersonId[] =>
    parts.map(p => p.personId).filter((pid): pid is PersonId => !!pid);

/**
 * The godparents and witnesses recorded by name who match persons of the
 * tree, in the order of the data. Those whose every candidate was rejected
 * have none left and are not listed.
 */
export function nameLinkLeads(data: StromData, index: PersonNameIndex = buildPersonNameIndex(data)): NameLinkLead[] {
    const out: NameLinkLead[] = [];
    for (const ev of namingEvents(data)) {
        const linked = linkedIn(ev.participants);
        for (const part of ev.participants) {
            if (!linkableParticipant(part)) continue;
            const candidates = findParticipantMatches(data, part.name!, {
                date: ev.date, subjects: ev.subjects, exclude: [...linked, ...(part.linkRejected ?? [])],
            }, index);
            if (candidates.length === 0) continue;
            out.push({
                ref: { ...(ev.ownerPersonId ? { ownerPersonId: ev.ownerPersonId } : { partnershipId: ev.partnershipId }), eventId: ev.eventId, participantId: part.id },
                name: part.name!.trim(), role: part.role, ...(part.note?.trim() ? { note: part.note.trim() } : {}),
                eventType: ev.eventType, ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
                ...(ev.date ? { date: ev.date } : {}), subjects: ev.subjects,
                ...(ev.shareId ? { shareId: ev.shareId } : {}), candidates,
            });
        }
    }
    return out;
}

/** How many godparents and witnesses recorded by name had their offer turned down (they are not offered again). */
export function rejectedNameLinks(data: StromData): number {
    let n = 0;
    for (const ev of namingEvents(data)) {
        for (const part of ev.participants) if (linkableParticipant(part) && part.linkRejected?.length) n++;
    }
    return n;
}
