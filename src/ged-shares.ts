/**
 * Shared events and a person's part at another's event in GEDCOM (spec 085 §7):
 * what the importer needs beyond reading the lines.
 *
 * - Strom's own marks: `2 _STROM_SHARE <id>` (+ `3 _ROLE` / `3 ROLE`) joins
 *   the copies of one event of several persons; `2 _STROM_ROLE <role>`
 *   (+ `3 _STROM_AT @x@` + `4 TYPE <tag>`) is a person's own godparent /
 *   witness event at another's event.
 * - Another program's shared events: RootsMagic, Legacy and Family Historian
 *   write the event once, at its principal, and name the others under it
 *   (`2 _SHAR @I@` with `3 ROLE` / `3 _ROLE` / `3 RELA`, `3 NOTE`; Family
 *   Historian also `2 _SHAN <name>` for someone with no record). A member of
 *   the household becomes a copy of a shared event (convertGedShares); a
 *   witness, a godparent or any other role a participant of the event.
 */

import { eventIsShareable, coupleEventTypeOfTag } from './events.js';
import { isValidShareId, shareIdMaker } from './shared-events.js';
import {
    CoupleEvent, CoupleEventType, EventParticipant, generateLifeEventId, LifeEvent, LifeEventType,
    Partnership, PartnershipId, ParticipantRole, PARTICIPANT_ROLES, Person, PersonId,
} from './types.js';

/**
 * "Not this person" of a godparent or a witness recorded by name
 * (EventParticipant.linkRejected): one line per person of the file the user
 * said they are not, under the participant's `_WITN` (or `ASSO`), pointing
 * at that person's record — `3 _STROM_NOT_LINK @I12@`. Read back, the offer
 * to link them is not made again; a pointer to no record of the file is
 * dropped. Written by every GEDCOM export; another program drops the line.
 */
export const LINK_REJECTED_TAG = '_STROM_NOT_LINK';

/** `_STROM_SHARE` as read: the id and the person's role in it. */
export interface RawShareMark {
    id: string;
    role?: string;
}

/** `_STROM_ROLE` as read: the role, the xref of whose event it was and that event's tag. */
export interface RawRoleAt {
    role: string;
    at?: string;
    tag?: string;
}

/** A `_SHAR @I@` / `_SHAN name` line with its role and note, as written. */
export interface RawShar {
    ref?: string;
    name?: string;
    role?: string;
    note?: string;
}

/** The role word as a program wrote it: RootsMagic may put it in brackets. */
export function sharRoleWord(value: string): string {
    return value.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

function roleWords(role: string): string[] {
    return role.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** Roles of a member of the household whose word is no role of its own ("Household Member"). */
const PLAIN_MEMBER_WORDS = new Set(['household', 'principal', 'primary', 'member', 'domacnost', 'haushalt']);
/** …and the household roles that say something about the person ("Head"). */
const HOUSEHOLD_ROLE_WORDS = new Set(['head']);

/**
 * Whether a `_SHAR` role makes the person a member of the shared event
 * (the household, the principal, the head, none at all) rather than a
 * participant of it (a witness, a godparent, an unknown role).
 */
export function isHouseholdShareRole(role: string | undefined): boolean {
    const words = roleWords(role ?? '');
    if (words.length === 0) return true;
    return words.every(w => PLAIN_MEMBER_WORDS.has(w) || HOUSEHOLD_ROLE_WORDS.has(w) || w === 'of' || w === 'the');
}

/** The copy's own role (`shareRole`) a household `_SHAR` role gives: none for a plain member. */
export function shareRoleOf(role: string | undefined): string | undefined {
    const words = roleWords(role ?? '');
    if (words.length === 0 || words.some(w => w === 'household') || words.every(w => PLAIN_MEMBER_WORDS.has(w))) return undefined;
    return role?.trim() || undefined;
}

/** A `_STROM_ROLE` value as a participant role (one the app does not know is 'other'). */
export function roleAtRole(value: string): ParticipantRole {
    const v = value.trim().toLowerCase();
    return (PARTICIPANT_ROLES as readonly string[]).includes(v) ? v as ParticipantRole : 'other';
}

/**
 * The type of a person's own event that `_STROM_ROLE` turns into: a godparent
 * (whatever event) is 'godparent', a witness at a wedding (`4 TYPE MARR`)
 * 'weddingWitness'; anything else keeps its type (a custom event with roleAt).
 */
export function roleAtEventType(type: LifeEventType, raw: RawRoleAt): LifeEventType {
    if (type !== 'custom') return type;
    const role = roleAtRole(raw.role);
    if (role === 'godparent') return 'godparent';
    if (role === 'witness' && raw.at && raw.tag?.trim().toUpperCase() === 'MARR') return 'weddingWitness';
    return type;
}

/** The app's type of the event `4 TYPE <tag>` names, at a person or at a couple. */
export function roleAtTypeOfTag(tag: string | undefined, onCouple: boolean, personTag: (tag: string) => LifeEventType | null): string {
    const t = (tag ?? '').trim().toUpperCase();
    if (!t) return '';
    if (onCouple) {
        if (t === 'MARR') return 'marriage';
        if (t === 'DIV') return 'divorce';
        return coupleEventTypeOfTag(t) ?? '';
    }
    if (t === 'BIRT') return 'birth';
    if (t === 'DEAT') return 'death';
    if (t === 'EVEN') return 'custom';
    return personTag(t) ?? '';
}

/** The id of the event roleAt points at, when there is exactly one of its type. */
export function roleAtEventId(at: { personId?: PersonId; partnershipId?: PartnershipId; eventType: string }, persons: Record<string, Person>, partnerships: Record<string, Partnership>): string | undefined {
    if (!at.eventType) return undefined;
    if (at.personId) {
        if (at.eventType === 'birth' || at.eventType === 'death') return undefined;
        const found = (persons[at.personId]?.events ?? []).filter(e => e.type === at.eventType);
        return found.length === 1 ? found[0].id : undefined;
    }
    if (at.partnershipId) {
        if (at.eventType === 'marriage') return 'marriage';
        const found = (partnerships[at.partnershipId]?.events ?? []).filter(e => e.type === at.eventType);
        return found.length === 1 ? found[0].id : undefined;
    }
    return undefined;
}

/** Strom's share mark on a converted event, when it is valid for its type. */
export function applyShareMark(out: LifeEvent, raw: RawShareMark | undefined): void {
    if (!raw || !isValidShareId(raw.id) || !eventIsShareable(out.type)) return;
    out.shareId = raw.id;
    const role = raw.role?.trim();
    if (role) out.shareRole = role;
}

/** A person's event with the household `_SHAR` lines under it. */
export interface PendingPersonShars {
    personId: PersonId;
    event: LifeEvent;
    members: { personId: PersonId; role?: string }[];
}

/** A couple's event with the household `_SHAR` lines under it. */
export interface PendingCoupleShars {
    partnership: Partnership;
    event: CoupleEvent;
    members: { personId: PersonId; role?: string }[];
}

/** What convertGedShares did: shared events made and the persons in them. */
export interface SharConversion {
    events: number;
    persons: number;
}

/** The person type a couple's event becomes when its household is shared (null: none). */
const COUPLE_TO_PERSON_TYPE: Partial<Record<CoupleEventType, LifeEventType>> = {
    census: 'census', residence: 'residence', custom: 'custom',
};

type Common = Pick<LifeEvent, 'type' | 'customLabel' | 'date' | 'place' | 'address' | 'note' | 'sourceIds' | 'citationQuay'>;

const sameEvent = (a: LifeEvent, b: Common): boolean =>
    a.type === b.type && (a.customLabel ?? '') === (b.customLabel ?? '')
    && (a.date ?? '') === (b.date ?? '') && (a.place ?? '') === (b.place ?? '');

function commonOf(ev: Common): Common {
    const out: Common = { type: ev.type };
    if (ev.customLabel) out.customLabel = ev.customLabel;
    if (ev.date) out.date = ev.date;
    if (ev.place) out.place = ev.place;
    if (ev.address) out.address = ev.address;
    if (ev.note) out.note = ev.note;
    if (ev.sourceIds?.length) out.sourceIds = [...ev.sourceIds];
    if (ev.citationQuay) out.citationQuay = structuredClone(ev.citationQuay);
    return out;
}

/**
 * Another program's shared events as Strom's (spec 085 §7, 7b): each
 * household `_SHAR` of a person's event gives the person it names a copy of
 * the event with a common share id (their own event of the same type, date
 * and place when they have one: a census the file wrote at each person as
 * well is joined, never doubled), with the role as the copy's own unless it
 * is a plain member of the household. A couple's census, residence or custom
 * event with household `_SHAR` lines becomes such a shared event of the
 * partners and the persons named (the couple's event goes: one event, not
 * two). A type that is never shared keeps the persons as participants
 * ('other' with the role as the note). Refs outside the file were left out
 * by the caller.
 */
export function convertGedShares(
    persons: Record<string, Person>,
    pendingPersons: readonly PendingPersonShars[],
    pendingCouples: readonly PendingCoupleShars[],
    participant: (personId: PersonId, role: string | undefined) => EventParticipant,
): SharConversion {
    const taken = new Set<string>();
    for (const p of Object.values(persons)) for (const ev of p.events ?? []) if (ev.shareId) taken.add(ev.shareId);
    const nextId = shareIdMaker(taken);
    let events = 0;
    const inShares = new Set<PersonId>();

    const join = (base: Common, shareId: string, members: { personId: PersonId; role?: string; age?: string; own?: LifeEvent }[]): void => {
        for (const m of members) {
            const person = persons[m.personId];
            if (!person) continue;
            let copy = m.own ?? person.events?.find(e => sameEvent(e, base) && (!e.shareId || e.shareId === shareId));
            if (!copy) {
                copy = { id: generateLifeEventId(), ...commonOf(base) };
                if (m.age) copy.age = m.age;
                (person.events ??= []).push(copy);
            }
            copy.shareId = shareId;
            const role = shareRoleOf(m.role);
            if (role && !copy.shareRole) copy.shareRole = role;
            inShares.add(m.personId);
        }
    };

    for (const { personId, event, members } of pendingPersons) {
        const others = members.filter(m => m.personId !== personId && persons[m.personId]);
        if (others.length === 0) continue;
        if (!eventIsShareable(event.type)) {
            for (const m of others) (event.participants ??= []).push(participant(m.personId, m.role || undefined));
            continue;
        }
        let shareId = event.shareId;
        if (!shareId) { shareId = nextId(); events++; }
        join(event, shareId, [{ personId, own: event }, ...others]);
    }

    for (const { partnership, event, members } of pendingCouples) {
        const type = COUPLE_TO_PERSON_TYPE[event.type];
        const partners = [partnership.person1Id, partnership.person2Id]
            .filter((id, i, all) => persons[id] && !persons[id].isPlaceholder && all.indexOf(id) === i);
        const others = members.filter(m => persons[m.personId] && !partners.includes(m.personId));
        if (!type || others.length === 0 || partners.length === 0) {
            for (const m of others) (event.participants ??= []).push(participant(m.personId, m.role || undefined));
            continue;
        }
        const base: Common = commonOf({ ...event, type });
        if (type !== 'custom') delete base.customLabel;
        const shareId = nextId();
        events++;
        join(base, shareId, [
            ...partners.map(id => ({ personId: id, age: event.ages?.[id] })),
            ...others,
        ]);
        // The couple's witnesses stay with the event: at the first partner's copy.
        if (event.participants?.length) {
            const first = persons[partners[0]].events?.find(e => e.shareId === shareId);
            if (first) first.participants = [...(first.participants ?? []), ...event.participants];
        }
        partnership.events = (partnership.events ?? []).filter(e => e !== event);
        if (partnership.events.length === 0) delete partnership.events;
    }
    return { events, persons: inShares.size };
}
