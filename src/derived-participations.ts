/**
 * A person's part at another's event, in their own life (spec 085 §5): the
 * baptism they stood godparent at, the wedding they witnessed, the one they
 * officiated, the birth they attended as the midwife. The record stays with
 * whose event it was; the godparent's list and life show it as a derived
 * row, from the index of linked participants (SharedEventIndex.participations).
 *
 * Only a participant linked to the person makes a row (one recorded by name
 * has none), and a row goes once the person keeps an own record of that part
 * (an own godparent / wedding witness event whose roleAt points at the event).
 * Rows are not in GEDCOM, the Events table, the map, the book or the family
 * timeline: they are views of the other person's event.
 */

import { Person, PersonId, PartnershipId, ParticipantRole, StromData, LifeEvent, CoupleEvent, Gender } from './types.js';
import { MARRIAGE_EVENT_ID, type SharedEventIndex } from './shared-events.js';
import { extraParticipantRole, type ExtraParticipantRole } from './godparents.js';
import { yearOf, yearFraction } from './dates.js';
import { strings as appStrings } from './strings.js';

type Strings = typeof appStrings;

/** One derived row: the event a person took part in, whose it is, and the part. */
export interface DerivedParticipation {
    role: ParticipantRole;
    /** A role the app keeps as "other" with its word in the note (a midwife, an informant). */
    extra?: ExtraParticipantRole;
    /** The participant's note ("other": what they were there). */
    note?: string;
    /** The event's type: a person's or a couple's, 'marriage' for the wedding itself. */
    eventType: string;
    customLabel?: string;
    /** Whose event: a person's … */
    ownerPersonId?: PersonId;
    /** … or a couple's (`eventId` MARRIAGE_EVENT_ID for the wedding). */
    partnershipId?: PartnershipId;
    eventId: string;
    participantId: string;
    date?: string;
    place?: string;
    /** The persons the event is of: its person (all persons of a shared event), or the couple. */
    subjects: PersonId[];
    /** Order key: the date's year and fraction; undated rows go last. */
    sortKey: number;
}

/** What a derived row points at (an own record's roleAt names the same). */
export interface ParticipationTarget {
    ownerPersonId?: PersonId;
    partnershipId?: PartnershipId;
    eventId: string;
}

/** Does the person keep an own record (roleAt) of their part at this event? */
export function hasOwnRecordOf(person: Pick<Person, 'events'>, target: ParticipationTarget): boolean {
    return (person.events ?? []).some(ev => {
        const at = ev.roleAt;
        if (!at?.eventId || at.eventId !== target.eventId) return false;
        return target.ownerPersonId ? at.personId === target.ownerPersonId : !!target.partnershipId && at.partnershipId === target.partnershipId;
    });
}

/** The event a participation points at, with what a row needs of it. */
function targetEvent(data: StromData, t: ParticipationTarget):
    { date?: string; place?: string; type: string; customLabel?: string; event?: LifeEvent | CoupleEvent } | null {
    if (t.ownerPersonId) {
        const ev = data.persons[t.ownerPersonId]?.events?.find(e => e.id === t.eventId);
        return ev ? { date: ev.date, place: ev.place, type: ev.type, customLabel: ev.customLabel, event: ev } : null;
    }
    const union = t.partnershipId ? data.partnerships[t.partnershipId] : undefined;
    if (!union) return null;
    if (t.eventId === MARRIAGE_EVENT_ID) return { date: union.startDate, place: union.startPlace, type: 'marriage' };
    const ev = union.events?.find(e => e.id === t.eventId);
    return ev ? { date: ev.date, place: ev.place, type: ev.type, customLabel: ev.customLabel, event: ev } : null;
}

const realPerson = (data: StromData, pid: PersonId | undefined): pid is PersonId =>
    !!pid && !!data.persons[pid] && !data.persons[pid].isPlaceholder;

/**
 * The derived rows of a person, in the order of their dates (undated last).
 * `hidden`: a person whose events the reader may not see (a living person in
 * an export, print or shared page); an event of theirs, or a wedding with
 * them, gives no row.
 */
export function derivedParticipations(
    data: StromData, index: SharedEventIndex, personId: PersonId,
    opts: { hidden?: (pid: PersonId) => boolean } = {},
): DerivedParticipation[] {
    const person = data.persons[personId];
    if (!person) return [];
    const out: DerivedParticipation[] = [];
    const seen = new Set<string>();
    for (const part of index.participations.get(personId) ?? []) {
        const t: ParticipationTarget = { ownerPersonId: part.ownerPersonId, partnershipId: part.partnershipId, eventId: part.eventId };
        if (hasOwnRecordOf(person, t)) continue;
        const ev = targetEvent(data, t);
        if (!ev) continue;
        let subjects: PersonId[];
        let key: string;
        const shareId = part.ownerPersonId ? (ev.event as LifeEvent | undefined)?.shareId : undefined;
        const share = shareId ? index.shares.get(shareId) : undefined;
        if (share) {
            // A shared event names its participants on every copy: one row for the event.
            subjects = [...new Set(share.map(c => c.personId))].filter(pid => realPerson(data, pid));
            key = `s\u0000${shareId}`;
        } else if (part.ownerPersonId) {
            subjects = [part.ownerPersonId];
            key = `p\u0000${part.ownerPersonId}\u0000${part.eventId}`;
        } else {
            const union = data.partnerships[part.partnershipId!];
            subjects = [union.person1Id, union.person2Id].filter(pid => realPerson(data, pid));
            key = `u\u0000${part.partnershipId}\u0000${part.eventId}`;
        }
        // A share's copies at other persons may hold an own record too.
        if (share && share.some(c => hasOwnRecordOf(person, { ownerPersonId: c.personId, eventId: c.eventId }))) continue;
        key += `\u0000${part.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (subjects.includes(personId)) continue;
        if (opts.hidden && subjects.some(pid => opts.hidden!(pid))) continue;
        const participant = findParticipant(data, t, part.participantId);
        const extra = participant ? extraParticipantRole(participant) : null;
        const y = yearOf(ev.date);
        out.push({
            role: part.role,
            ...(extra ? { extra: extra.role } : {}),
            ...(participant?.note?.trim() ? { note: participant.note.trim() } : {}),
            eventType: ev.type,
            ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
            ...(part.ownerPersonId ? { ownerPersonId: part.ownerPersonId } : { partnershipId: part.partnershipId }),
            eventId: part.eventId,
            participantId: part.participantId,
            ...(ev.date ? { date: ev.date } : {}),
            ...(ev.place ? { place: ev.place } : {}),
            subjects,
            sortKey: y === null ? Infinity : y + yearFraction(ev.date),
        });
    }
    return out.sort((a, b) => a.sortKey - b.sortKey);
}

function findParticipant(data: StromData, t: ParticipationTarget, participantId: string) {
    if (t.ownerPersonId) {
        return data.persons[t.ownerPersonId]?.events?.find(e => e.id === t.eventId)?.participants?.find(p => p.id === participantId);
    }
    const union = t.partnershipId ? data.partnerships[t.partnershipId] : undefined;
    const list = t.eventId === MARRIAGE_EVENT_ID ? union?.participants : union?.events?.find(e => e.id === t.eventId)?.participants;
    return list?.find(p => p.id === participantId);
}

/** The event's name inside a derived row ("baptism", "marriage", a custom event's own name). */
export function derivedEventWord(d: Pick<DerivedParticipation, 'eventType' | 'customLabel' | 'partnershipId'>, S: Strings = appStrings): string {
    const E = S.events;
    if (d.eventType === 'custom' && d.customLabel) return d.customLabel;
    if (d.eventType === 'marriage') return E.marriageWord;
    if (d.partnershipId) {
        const label = (S.partnerEvents.types as Record<string, string>)[d.eventType];
        return label ? E.derivedWord(label) : E.derivedWord(E.types.custom);
    }
    const label = (E.types as Record<string, string>)[d.eventType];
    return E.derivedWord(label ?? E.types.custom);
}

/**
 * A derived row's heading, "Godparent · baptism:" (the names follow it):
 * the role by the person's sex (godfather / godmother, witness), the type of
 * the event; a role the app has no word for is the participant's note.
 */
export function derivedRoleLabel(d: Pick<DerivedParticipation, 'role' | 'extra' | 'note' | 'eventType' | 'customLabel' | 'partnershipId'>,
    gender: Gender | undefined, S: Strings = appStrings): string {
    const E = S.events;
    const f = gender === 'female';
    const word = derivedEventWord(d, S);
    const own = !d.partnershipId;
    if (d.extra === 'midwife') return own && d.eventType === 'baptism' ? E.derivedMidwife : E.derivedOther(E.extraRoles.midwife, word);
    if (d.extra === 'informant') return own && d.eventType === 'death' ? E.derivedInformant : E.derivedOther(E.extraRoles.informant, word);
    switch (d.role) {
        case 'godparent':
            if (d.eventType === 'baptism' && !d.partnershipId) return f ? E.derivedGodparentF : E.derivedGodparent;
            return E.derivedOther(E.derivedRoles.godparent[f ? 'f' : 'm'], word);
        case 'witness':
            if (d.eventType === 'marriage') return f ? E.derivedWitnessF : E.derivedWitness;
            return E.derivedOther(E.derivedRoles.witness[f ? 'f' : 'm'], word);
        case 'officiant':
            if (d.eventType === 'marriage') return E.derivedOfficiant;
            return E.derivedOther(E.roles.officiant, word);
        default:
            return E.derivedOther(d.note ? shortNote(d.note) : E.roles.other, word);
    }
}

/** The role word of a derived row alone ("godparent", "witness"), for the summary "Godparent and witness for". */
export function derivedRoleWord(d: Pick<DerivedParticipation, 'role' | 'extra' | 'note'>, gender: Gender | undefined, S: Strings = appStrings): string {
    const E = S.events;
    const f = gender === 'female';
    if (d.extra) return E.derivedWord(E.extraRoles[d.extra]);
    switch (d.role) {
        case 'godparent': return E.derivedWord(E.derivedRoles.godparent[f ? 'f' : 'm']);
        case 'witness': return E.derivedWord(E.derivedRoles.witness[f ? 'f' : 'm']);
        case 'officiant': return E.derivedWord(E.roles.officiant);
        default: return d.note ? shortNote(d.note) : E.derivedWord(E.roles.other);
    }
}

/** A participant's note as a role: its first clause, at most 40 characters. */
function shortNote(note: string): string {
    const first = note.split(/[,;—]/)[0].trim() || note.trim();
    return first.length > 40 ? `${first.slice(0, 39).trimEnd()}…` : first;
}
