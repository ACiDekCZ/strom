/**
 * One event that happened to several persons at once (spec 085, data v20):
 * a census household, a residence, a move. Each person keeps a copy of the
 * event (LifeEvent) and the copies share `LifeEvent.shareId`. The common
 * fields (SHARED_EVENT_COMMON_FIELDS) are the same in every copy and are
 * written to all of them at once by the DataManager's shared-event methods;
 * the age, the role in the event (`shareRole`), the research's status, the
 * confirmation and the origin marks are each copy's own.
 *
 * This module holds what needs no DataManager: the id format, the index of
 * the copies and of linked participants (built when the tree is read or
 * changed, never while drawing), the check for copies that went apart, the
 * cleaning of the fields on load, and the pure edits the DataManager wraps
 * in one undo step.
 */

import { eventIsShareable } from './events.js';
import { parseFlexDate, toCanonical, yearOf } from './dates.js';
import {
    EventParticipant, LifeEvent, LifeEventType, Person, ParticipantRole, PARTICIPANT_ROLES, PersonId, PartnershipId, StromData,
} from './types.js';

// ==================== FORMAT ====================

/** A share id as the app reads it (the research accepts the same; the app makes 4–16 characters). */
const SHARE_ID_RE = /^[A-Za-z0-9]{1,64}$/;

/** Whether `value` is a share id this app keeps (`[A-Za-z0-9]{1,64}`). */
export function isValidShareId(value: unknown): value is string {
    return typeof value === 'string' && SHARE_ID_RE.test(value);
}

const SHARE_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_ID_LENGTH = 8;

/** Random characters of a new share id (crypto when there is one). */
function randomShareId(): string {
    const bytes = new Uint8Array(SHARE_ID_LENGTH);
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c?.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    let out = '';
    for (const b of bytes) out += SHARE_ID_CHARS[b % SHARE_ID_CHARS.length];
    return out;
}

/** Every share id the tree's events carry. */
export function treeShareIds(data: StromData): Set<string> {
    const ids = new Set<string>();
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) if (ev.shareId) ids.add(ev.shareId);
    }
    return ids;
}

/** New share ids none of `taken` is, each added to it (many at once: an import). */
export function shareIdMaker(taken: Set<string>): () => string {
    return () => {
        for (;;) {
            const id = randomShareId();
            if (!taken.has(id)) { taken.add(id); return id; }
        }
    };
}

/** A new share id no event of the tree carries (8 characters of `[A-Za-z0-9]`, opaque). */
export function newShareIdFor(data: StromData): string {
    const taken = treeShareIds(data);
    for (;;) {
        const id = randomShareId();
        if (!taken.has(id)) return id;
    }
}

// ==================== FIELDS ====================

/**
 * The fields every copy of a shared event has the same: the type (with a
 * custom event's label), the date, the place, the house or address, the note,
 * the sources and their citations' own QUAY.
 */
export const SHARED_EVENT_COMMON_FIELDS = [
    'type', 'customLabel', 'date', 'place', 'address', 'note', 'sourceIds', 'citationQuay',
] as const satisfies readonly (keyof LifeEvent)[];
export type SharedEventCommonField = typeof SHARED_EVENT_COMMON_FIELDS[number];

/** Values of the common fields (a key with `undefined` empties that field). */
export type SharedEventCommon = Partial<Pick<LifeEvent, SharedEventCommonField>>;

/**
 * What a copy keeps for itself: its age, its role in the event and whatever
 * else is not common (the research's status, confirmations, origin marks…).
 * A key with `undefined` empties that field.
 */
export type SharedEventOwn = Partial<Omit<LifeEvent, 'id' | 'shareId' | SharedEventCommonField>>;

/** What DataManager.saveSharedEvent writes (see there). */
export interface SharedEventEdit {
    common: SharedEventCommon;
    /** Each person's own fields (age, `shareRole`…), the edited person's too. */
    own?: ReadonlyMap<PersonId, SharedEventOwn>;
    /** Persons to get a copy (new to the event). */
    add?: readonly PersonId[];
    /** Persons whose copy is deleted. */
    remove?: readonly PersonId[];
    /** Persons whose copy leaves the share as it was before this edit. */
    separate?: readonly PersonId[];
}

/** What a shared save left: the share id (null: one copy, an ordinary event) and the persons holding a copy. */
export interface SharedEventSaveResult {
    shareId: string | null;
    personIds: PersonId[];
    /** Persons added whose own record of the same event joined (ownSameEvent) instead of a new copy. */
    attached: PersonId[];
}

/** The value of a common field as copies are compared (empty text = none; sources as a set). */
export function commonFieldKey(ev: LifeEvent, field: SharedEventCommonField): string {
    switch (field) {
        case 'customLabel':
            return ev.type === 'custom' ? (ev.customLabel ?? '').trim() : '';
        case 'sourceIds':
            return [...new Set(ev.sourceIds ?? [])].sort().join('\u0001');
        case 'citationQuay': {
            const cited = new Set(ev.sourceIds ?? []);
            const own = ev.citationQuay?.sourceIds ?? {};
            return Object.keys(own).filter(id => cited.has(id)).sort()
                .map(id => `${id}=${own[id] === null ? '-' : own[id]}`).join('\u0001');
        }
        case 'type':
            return ev.type;
        default: {
            const v = ev[field];
            return typeof v === 'string' ? v.trim() : '';
        }
    }
}

/** Whether two copies have every common field the same. */
export function sameCommonFields(a: LifeEvent, b: LifeEvent): boolean {
    return SHARED_EVENT_COMMON_FIELDS.every(f => commonFieldKey(a, f) === commonFieldKey(b, f));
}

/** The common fields of `ev` as values to write into another copy (deep copies). */
export function commonFieldsOf(ev: LifeEvent): SharedEventCommon {
    const out: SharedEventCommon = {};
    for (const f of SHARED_EVENT_COMMON_FIELDS) {
        const v = ev[f];
        (out as Record<string, unknown>)[f] = v === undefined ? undefined : structuredClone(v);
    }
    return out;
}

/** Write `values` into `ev` (an `undefined` value removes the field). */
export function applyEventFields(ev: LifeEvent, values: SharedEventCommon | SharedEventOwn): void {
    const rec = ev as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(values)) {
        if (k === 'id' || k === 'shareId') continue;
        if (v === undefined || (Array.isArray(v) && v.length === 0)) delete rec[k];
        else rec[k] = structuredClone(v);
    }
}

// ==================== INDEX ====================

/** One copy of a shared event: whose it is and its id there. */
export interface ShareCopyRef {
    personId: PersonId;
    eventId: string;
}

/** The id a wedding's own witnesses (Partnership.participants) are filed under. */
export const MARRIAGE_EVENT_ID = 'marriage';

/**
 * One event a person of the tree is linked to as a participant (godparent,
 * witness, officiant…): a person's event (`ownerPersonId`) or a couple's
 * (`partnershipId`; `eventId` MARRIAGE_EVENT_ID for the wedding itself).
 */
export interface LinkedParticipation {
    ownerPersonId?: PersonId;
    partnershipId?: PartnershipId;
    eventId: string;
    /** The event's type (a person's or a couple's), 'marriage' for the wedding. */
    eventType: string;
    role: ParticipantRole;
    participantId: string;
}

/** The index of shared events and linked participants of one state of a tree. */
export interface SharedEventIndex {
    /**
     * Share id → its copies, in the order persons were added (the copies'
     * event ids are made in that order), else the persons' order in the data.
     * A person with two copies of one share that are the same is listed once;
     * copies that differ are each listed (findDivergentShares tells them).
     * Only groups of two or more entries.
     */
    shares: Map<string, ShareCopyRef[]>;
    /** Share id of each copy listed in `shares`, by `${personId}\u0000${eventId}`. */
    shareOf: Map<string, string>;
    /** Person → the events they are linked to as a participant, in the data's order. */
    participations: Map<PersonId, LinkedParticipation[]>;
}

/** Order key of an event id the app made (`ev_<ms>_<seq>…`): when it was made. */
function idOrder(eventId: string): [number, number] | null {
    const m = /^ev_(\d+)_([0-9a-z]{4})/.exec(eventId);
    return m ? [Number(m[1]), parseInt(m[2], 36)] : null;
}

/** Every copy of every share id, duplicates at one person included, in the data's order. */
export function allShareCopies(data: StromData): Map<string, { personId: PersonId; event: LifeEvent; at: number }[]> {
    const out = new Map<string, { personId: PersonId; event: LifeEvent; at: number }[]>();
    let at = 0;
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) {
            at++;
            if (!ev.shareId) continue;
            let list = out.get(ev.shareId);
            if (!list) out.set(ev.shareId, list = []);
            list.push({ personId: person.id, event: ev, at });
        }
    }
    return out;
}

/** The copies of one share id (duplicates at one person included). */
export function shareCopiesOf(data: StromData, shareId: string): { personId: PersonId; event: LifeEvent }[] {
    const out: { personId: PersonId; event: LifeEvent }[] = [];
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) if (ev.shareId === shareId) out.push({ personId: person.id, event: ev });
    }
    return out;
}

/** Build the index (see SharedEventIndex). */
export function buildSharedEventIndex(data: StromData): SharedEventIndex {
    const shares = new Map<string, ShareCopyRef[]>();
    const shareOf = new Map<string, string>();
    for (const [shareId, copies] of allShareCopies(data)) {
        const sorted = [...copies].sort((a, b) => {
            const ka = idOrder(a.event.id);
            const kb = idOrder(b.event.id);
            if (ka && kb && (ka[0] !== kb[0] || ka[1] !== kb[1])) return ka[0] - kb[0] || ka[1] - kb[1];
            return a.at - b.at;
        });
        const kept: typeof sorted = [];
        for (const c of sorted) {
            // A person holding the same copy twice (persons merged in the research) is one entry.
            if (kept.some(k => k.personId === c.personId && sameCommonFields(k.event, c.event))) continue;
            kept.push(c);
        }
        if (kept.length < 2) continue;
        shares.set(shareId, kept.map(c => ({ personId: c.personId, eventId: c.event.id })));
        for (const c of kept) shareOf.set(`${c.personId}\u0000${c.event.id}`, shareId);
    }

    const participations = new Map<PersonId, LinkedParticipation[]>();
    const add = (pid: PersonId | undefined, entry: LinkedParticipation): void => {
        if (!pid || !data.persons[pid]) return;
        let list = participations.get(pid);
        if (!list) participations.set(pid, list = []);
        list.push(entry);
    };
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) {
            for (const part of ev.participants ?? []) {
                add(part.personId, { ownerPersonId: person.id, eventId: ev.id, eventType: ev.type, role: part.role, participantId: part.id });
            }
        }
    }
    for (const union of Object.values(data.partnerships)) {
        for (const part of union?.participants ?? []) {
            add(part.personId, { partnershipId: union.id, eventId: MARRIAGE_EVENT_ID, eventType: 'marriage', role: part.role, participantId: part.id });
        }
        for (const ev of union?.events ?? []) {
            for (const part of ev.participants ?? []) {
                add(part.personId, { partnershipId: union.id, eventId: ev.id, eventType: ev.type, role: part.role, participantId: part.id });
            }
        }
    }
    return { shares, shareOf, participations };
}

/** The other persons sharing a person's event (none: not shared), from an index. */
export function sharedWith(index: SharedEventIndex, personId: PersonId, eventId: string): PersonId[] {
    const shareId = index.shareOf.get(`${personId}\u0000${eventId}`);
    if (!shareId) return [];
    const out: PersonId[] = [];
    for (const c of index.shares.get(shareId) ?? []) {
        if (c.personId !== personId && !out.includes(c.personId)) out.push(c.personId);
    }
    return out;
}

/** One shared event of a person (DataManager.personSharedEvents: the delete confirmation lists them). */
export interface PersonSharedEvent {
    shareId: string;
    eventId: string;
    type: LifeEventType;
    customLabel?: string;
    year: number | null;
    /** The other persons of the event, in the index's order. */
    otherPersonIds: PersonId[];
}

/** A person's events shared with someone else, in the order of the person's events. */
export function personSharedEvents(data: StromData, index: SharedEventIndex, personId: PersonId): PersonSharedEvent[] {
    const out: PersonSharedEvent[] = [];
    for (const ev of data.persons[personId]?.events ?? []) {
        if (!ev.shareId) continue;
        const others = sharedWith(index, personId, ev.id);
        if (others.length === 0 || out.some(o => o.shareId === ev.shareId)) continue;
        out.push({
            shareId: ev.shareId, eventId: ev.id, type: ev.type,
            ...(ev.type === 'custom' && ev.customLabel ? { customLabel: ev.customLabel } : {}),
            year: yearOf(ev.date), otherPersonIds: others,
        });
    }
    return out;
}

// ==================== COPIES THAT WENT APART ====================

/** One value a common field has in some of the copies. */
export interface ShareFieldValue {
    /** The value as the first of these copies has it. */
    value: unknown;
    copies: ShareCopyRef[];
}

/** A common field the copies do not agree on, with each value and its copies (the most copies first). */
export interface ShareFieldDivergence {
    field: SharedEventCommonField;
    values: ShareFieldValue[];
}

/** A shared event whose copies differ in a common field. */
export interface ShareDivergence {
    shareId: string;
    /** Every copy, in the data's order. */
    copies: ShareCopyRef[];
    fields: ShareFieldDivergence[];
}

/**
 * The shared events whose copies differ in a common field (spec 085 §4,
 * `sharedCopiesDiffer`): the age, the role, the research's status, the
 * confirmation and the origin are each copy's own and never compared. Two
 * copies of one share at one person count as two copies (the same: no
 * difference; different: told like any other).
 */
export function findDivergentShares(data: StromData): ShareDivergence[] {
    const out: ShareDivergence[] = [];
    for (const [shareId, copies] of allShareCopies(data)) {
        const d = divergenceOfCopies(shareId, copies);
        if (d) out.push(d);
    }
    return out;
}

/** One share's divergence (findDivergentShares); null when its copies agree or it has fewer than two. */
export function shareDivergence(data: StromData, shareId: string): ShareDivergence | null {
    return divergenceOfCopies(shareId, shareCopiesOf(data, shareId));
}

function divergenceOfCopies(shareId: string, copies: readonly { personId: PersonId; event: LifeEvent }[]): ShareDivergence | null {
    if (copies.length < 2) return null;
    const fields: ShareFieldDivergence[] = [];
    for (const field of SHARED_EVENT_COMMON_FIELDS) {
        const byKey = new Map<string, ShareFieldValue>();
        for (const c of copies) {
            const key = commonFieldKey(c.event, field);
            let entry = byKey.get(key);
            if (!entry) byKey.set(key, entry = { value: structuredClone(c.event[field]), copies: [] });
            entry.copies.push({ personId: c.personId, eventId: c.event.id });
        }
        if (byKey.size < 2) continue;
        const values = [...byKey.values()];
        values.sort((a, b) => b.copies.length - a.copies.length);
        fields.push({ field, values });
    }
    if (fields.length === 0) return null;
    return { shareId, copies: copies.map(c => ({ personId: c.personId, eventId: c.event.id })), fields };
}

// ==================== CLEANING ON LOAD ====================

/**
 * Data version 20: keep only valid shares and roles, for every tree read
 * (a file, an import, the research, an older app). A share id that is not
 * `[A-Za-z0-9]{1,64}`, one on a type that is not shared, and one only a
 * single copy in the tree carries go (the copy is an ordinary event); a role
 * in a share goes with its share. `roleAt` keeps a known role (another is
 * `other`) and only links to persons and couples of the tree; a participant's
 * rejected links only name persons of the tree. Nothing is joined. Returns
 * how many events changed.
 */
export function cleanEventShares(data: StromData): number {
    let changed = 0;
    const counts = new Map<string, number>();
    const persons = Object.values(data.persons).filter(p => p && typeof p === 'object');
    for (const person of persons) {
        if (!Array.isArray(person.events)) continue;
        for (const ev of person.events) {
            if (!ev || typeof ev !== 'object') continue;
            let touched = false;
            if ('shareId' in ev && (!isValidShareId(ev.shareId) || !eventIsShareable(ev.type))) {
                delete ev.shareId;
                touched = true;
            }
            if (ev.shareId) counts.set(ev.shareId, (counts.get(ev.shareId) ?? 0) + 1);
            if ('roleAt' in ev && cleanRoleAt(ev, data)) touched = true;
            for (const part of Array.isArray(ev.participants) ? ev.participants : []) {
                if (part && typeof part === 'object' && 'linkRejected' in part && cleanLinkRejected(part, data)) touched = true;
            }
            if (touched) changed++;
        }
    }
    for (const union of Object.values(data.partnerships)) {
        const lists = [union?.participants, ...(Array.isArray(union?.events) ? union.events.map(e => e?.participants) : [])];
        for (const list of lists) {
            for (const part of Array.isArray(list) ? list : []) {
                if (part && typeof part === 'object' && 'linkRejected' in part && cleanLinkRejected(part, data)) changed++;
            }
        }
    }
    for (const person of persons) {
        if (!Array.isArray(person.events)) continue;
        for (const ev of person.events) {
            if (!ev || typeof ev !== 'object') continue;
            let touched = false;
            if (ev.shareId && (counts.get(ev.shareId) ?? 0) < 2) {
                delete ev.shareId;
                touched = true;
            }
            if ('shareRole' in ev && (!ev.shareId || typeof ev.shareRole !== 'string' || !ev.shareRole.trim())) {
                delete ev.shareRole;
                touched = true;
            }
            if (touched) changed++;
        }
    }
    return changed;
}

/** Keep a valid `roleAt` (see cleanEventShares); true when it changed. */
function cleanRoleAt(ev: LifeEvent, data: StromData): boolean {
    const raw = ev.roleAt as unknown;
    if (!raw || typeof raw !== 'object') {
        delete ev.roleAt;
        return true;
    }
    const r = raw as Record<string, unknown>;
    const role: ParticipantRole = (PARTICIPANT_ROLES as readonly unknown[]).includes(r.role) ? r.role as ParticipantRole : 'other';
    const next: NonNullable<LifeEvent['roleAt']> = { role, eventType: typeof r.eventType === 'string' ? r.eventType : '' };
    if (typeof r.personId === 'string' && data.persons[r.personId as PersonId]) next.personId = r.personId as PersonId;
    if (typeof r.partnershipId === 'string' && data.partnerships[r.partnershipId as PartnershipId]) next.partnershipId = r.partnershipId as PartnershipId;
    if (typeof r.eventId === 'string' && r.eventId) next.eventId = r.eventId;
    if (JSON.stringify(next) === JSON.stringify(raw)) return false;
    ev.roleAt = next;
    return true;
}

/** Keep the rejected links of persons of the tree; true when it changed. */
function cleanLinkRejected(part: { linkRejected?: PersonId[] }, data: StromData): boolean {
    const raw = part.linkRejected as unknown;
    const kept = Array.isArray(raw)
        ? [...new Set(raw.filter((id): id is PersonId => typeof id === 'string' && !!data.persons[id as PersonId]))]
        : [];
    if (Array.isArray(raw) && kept.length === raw.length && kept.length > 0) return false;
    if (kept.length > 0) part.linkRejected = kept;
    else delete part.linkRejected;
    return true;
}

/**
 * After copies went (a person deleted, a copy removed): each of `shareIds`
 * that only one copy carries now loses it (with its role), and `roleAt` and
 * rejected links naming a person or couple no longer in the tree lose that
 * link. Returns how many events changed.
 */
export function tidyShares(data: StromData, shareIds?: Iterable<string>): number {
    let changed = 0;
    const ids = shareIds ? new Set(shareIds) : null;
    const copies = allShareCopies(data);
    for (const [shareId, list] of copies) {
        if (ids && !ids.has(shareId)) continue;
        if (list.length >= 2) continue;
        for (const c of list) {
            delete c.event.shareId;
            delete c.event.shareRole;
            changed++;
        }
    }
    for (const person of Object.values(data.persons)) {
        for (const ev of person?.events ?? []) {
            const at = ev.roleAt;
            if (at && ((at.personId && !data.persons[at.personId]) || (at.partnershipId && !data.partnerships[at.partnershipId]))) {
                cleanRoleAt(ev, data);
                changed++;
            }
            for (const part of ev.participants ?? []) {
                if (part.linkRejected?.some(id => !data.persons[id]) && cleanLinkRejected(part, data)) changed++;
            }
        }
    }
    for (const union of Object.values(data.partnerships)) {
        for (const part of [...(union.participants ?? []), ...(union.events ?? []).flatMap(e => e.participants ?? [])]) {
            if (part.linkRejected?.some(id => !data.persons[id]) && cleanLinkRejected(part, data)) changed++;
        }
    }
    return changed;
}

// ==================== ONE PERSON, TWO COPIES ====================

/** Whether two participants are the same entry (the same person or name, the same role). */
function sameParticipant(a: EventParticipant, b: EventParticipant): boolean {
    if (a.role !== b.role) return false;
    if (a.personId || b.personId) return a.personId === b.personId;
    return (a.name ?? '').trim().toLocaleLowerCase() === (b.name ?? '').trim().toLocaleLowerCase();
}

/**
 * What `into` lacks of its own fields it takes from `from`, another record of
 * the same event at the same person: the age, the role, the research's status
 * and any other field of its own `into` has none of; participants it does not
 * list yet. The common fields stay (they are the shared event's).
 */
export function absorbCopy(into: LifeEvent, from: LifeEvent): void {
    const rec = into as unknown as Record<string, unknown>;
    const common = new Set<string>(SHARED_EVENT_COMMON_FIELDS);
    for (const [k, v] of Object.entries(from)) {
        if (k === 'id' || k === 'shareId' || k === 'participants' || common.has(k) || v === undefined) continue;
        const has = rec[k];
        if (has === undefined || (typeof has === 'string' && !has.trim())) rec[k] = structuredClone(v);
    }
    for (const part of from.participants ?? []) {
        const list = (into.participants ??= []);
        if (!list.some(q => sameParticipant(q, part))) list.push(structuredClone(part));
    }
}

/**
 * A person holding two copies of one shared event (two records of the person
 * merged here, in a tree merge or in the research): copies whose common
 * fields are the same are one — the first stays and takes what it lacks of
 * the other (absorbCopy); copies that differ stay (the data check tells them,
 * sharedCopiesDiffer). Returns the events that went.
 */
export function joinSameShareCopies(person: Person): LifeEvent[] {
    const events = person.events ?? [];
    const gone: LifeEvent[] = [];
    const kept: LifeEvent[] = [];
    for (const ev of events) {
        const twin = ev.shareId ? kept.find(k => k.shareId === ev.shareId && sameCommonFields(k, ev)) : undefined;
        if (twin) {
            absorbCopy(twin, ev);
            gone.push(ev);
        } else {
            kept.push(ev);
        }
    }
    if (gone.length > 0) person.events = kept;
    return gone;
}

// ==================== THE SAME EVENT RECORDED SEPARATELY (K1.6) ====================

/** The fields that tell whether two records are the same event (see sameEventKey). */
export type SameEventFields = Pick<LifeEvent, 'type' | 'customLabel' | 'date' | 'place' | 'address'>;

/** How strictly sameEventKey reads a record. */
export interface SameEventOptions {
    /**
     * A person merge (the two records are one person's): any type, a date or
     * a place is enough and the date need not be complete. Without it (two
     * persons' records, spec 085 K1.6): a shareable type, a complete date
     * (day, month and year, no "about", range or period) and a place.
     */
    partial?: boolean;
}

/** Text compared as the same: trimmed, one case. */
function foldText(text: string | undefined): string {
    return (text ?? '').trim().toLocaleLowerCase();
}

/** A complete date (day, month, year; no qualifier, range or period) in its canonical form, else null. */
function completeDate(value: string | undefined): string | null {
    const d = parseFlexDate(value?.trim());
    if (!d || d.qualifier || d.end || d.period || d.day === undefined || d.month === undefined) return null;
    return toCanonical(d);
}

/**
 * The key two records of the same event share (spec 085 K1.6): the type (a
 * custom event's label too), the date and the place (trimmed, one case).
 * Null when the record cannot be matched at all: without `partial`, a type
 * that cannot be shared, a date that is not complete or no place; with it,
 * neither a date nor a place. The house or address is not in the key: two
 * records with the same key are the same event when sameEventAddress agrees
 * too (isSameEvent) — so a search over the whole tree groups by this key
 * first and splits each group by the address.
 */
export function sameEventKey(ev: SameEventFields, opts: SameEventOptions = {}): string | null {
    const label = ev.type === 'custom' ? foldText(ev.customLabel) : '';
    const place = foldText(ev.place);
    if (opts.partial) {
        const date = (ev.date ?? '').trim();
        if (!date && !place) return null;
        return [ev.type, label, date, place].join('\u0000');
    }
    if (!eventIsShareable(ev.type) || (ev.type === 'custom' && !label)) return null;
    const date = completeDate(ev.date);
    if (!date || !place) return null;
    return [ev.type, label, date, place].join('\u0000');
}

/**
 * Whether two records' house or address allows them to be one event: the
 * same (trimmed, one case), or written at one of them only (the joined
 * event takes it, as a person merge does); two different ones never.
 */
export function sameEventAddress(a: Pick<LifeEvent, 'address'>, b: Pick<LifeEvent, 'address'>): boolean {
    const x = foldText(a.address);
    const y = foldText(b.address);
    return !x || !y || x === y;
}

/**
 * Records joined as one event (sameEventAddress agreed): the house written
 * at some of them only goes to the others, as a person merge does — when
 * they have one house between them; two different ones stay for Unify.
 */
export function fillSameEventAddress(events: readonly LifeEvent[]): void {
    const written = events.filter(e => foldText(e.address));
    if (written.length === 0 || new Set(written.map(e => foldText(e.address))).size !== 1) return;
    for (const e of events) if (!foldText(e.address)) e.address = written[0].address;
}

/** Whether two records are the same event: the same sameEventKey (not null) and an address that agrees (sameEventAddress). */
export function isSameEvent(a: SameEventFields, b: SameEventFields, opts: SameEventOptions = {}): boolean {
    const key = sameEventKey(a, opts);
    return key !== null && key === sameEventKey(b, opts) && sameEventAddress(a, b);
}

/**
 * The person's own record of the event `ev` (spec 085 K1.6 a): the first of
 * their events not shared with anyone that isSameEvent (strict) with `ev`,
 * `ev` itself left out. Null when there is none. "Shared with → Add a
 * person" joins this record instead of making a new copy.
 */
export function ownSameEvent(person: Person | null | undefined, ev: SameEventFields): LifeEvent | null {
    if (sameEventKey(ev) === null) return null;
    return (person?.events ?? []).find(e => e !== ev && !e.shareId && isSameEvent(e, ev)) ?? null;
}

/**
 * The records of the event `ev` written separately in other lives (spec 085
 * K1.6): each person's ownSameEvent, in the tree's order of persons, the
 * persons of `exclude` left out. Empty when `ev` cannot be matched.
 */
export function findSeparateCopies(
    data: StromData, ev: SameEventFields, exclude: Iterable<PersonId> = [],
): { personId: PersonId; event: LifeEvent }[] {
    if (sameEventKey(ev) === null) return [];
    const skip = new Set(exclude);
    const out: { personId: PersonId; event: LifeEvent }[] = [];
    for (const [pid, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        if (skip.has(pid)) continue;
        const own = ownSameEvent(person, ev);
        if (own) out.push({ personId: pid, event: own });
    }
    return out;
}

/** An event of a person merge's preview (spec 085 §7, 7a). */
export interface PersonMergeShareRow {
    /**
     * 'once': both persons are in the same shared event, the merged person is
     * in it once; 'attach': one is in it and the other has the same event of
     * its own (type, date, place): that copy can go and the merged person is
     * in the shared event.
     */
    kind: 'once' | 'attach';
    shareId: string;
    /** The copy of the shared event the merged person keeps. */
    event: LifeEvent;
    /** 'once': the other person's copy; 'attach': the own event that goes. */
    other: LifeEvent;
    /** Whose `other` is (the person kept or the one merged into it). */
    otherOf: PersonId;
    /** The persons in the shared event now. */
    persons: number;
    /** 'once': both copies give an age and they differ (the merge asks which). */
    ageDiffers: boolean;
}

/**
 * The shared events of a person merge (`removeId` merged into `keepId`):
 * those both are in (the merged person is in it once) and those one is in
 * while the other has the same event of its own — one such own event
 * (isSameEvent with `partial`: the two records are one person's, so a date
 * or a place is enough). In the order of the kept person's events, then the
 * other's.
 */
export function personMergeShares(data: StromData, keepId: PersonId, removeId: PersonId): PersonMergeShareRow[] {
    const keep = data.persons[keepId];
    const remove = data.persons[removeId];
    if (!keep || !remove || keepId === removeId) return [];
    const firstCopies = (events: readonly LifeEvent[]): Map<string, LifeEvent> => {
        const out = new Map<string, LifeEvent>();
        for (const ev of events) if (ev.shareId && !out.has(ev.shareId)) out.set(ev.shareId, ev);
        return out;
    };
    const keepCopies = firstCopies(keep.events ?? []);
    const removeCopies = firstCopies(remove.events ?? []);
    const personsIn = (shareId: string): number => new Set(shareCopiesOf(data, shareId).map(c => c.personId)).size;
    const rows: PersonMergeShareRow[] = [];
    const used = new Set<LifeEvent>();
    const attach = (shareId: string, copy: LifeEvent, ownerOfOwn: PersonId, own: readonly LifeEvent[]): void => {
        if (sameEventKey(copy, { partial: true }) === null) return;
        const found = own.filter(e => !e.shareId && !used.has(e) && isSameEvent(e, copy, { partial: true }));
        if (found.length !== 1) return;
        used.add(found[0]);
        rows.push({ kind: 'attach', shareId, event: copy, other: found[0], otherOf: ownerOfOwn, persons: personsIn(shareId), ageDiffers: false });
    };
    for (const [shareId, copy] of keepCopies) {
        const theirs = removeCopies.get(shareId);
        if (theirs) {
            if (!sameCommonFields(copy, theirs)) continue;
            const a = copy.age?.trim();
            const b = theirs.age?.trim();
            rows.push({
                kind: 'once', shareId, event: copy, other: theirs, otherOf: removeId,
                persons: personsIn(shareId), ageDiffers: !!a && !!b && a !== b,
            });
        } else {
            attach(shareId, copy, removeId, remove.events ?? []);
        }
    }
    for (const [shareId, copy] of removeCopies) {
        if (!keepCopies.has(shareId)) attach(shareId, copy, keepId, keep.events ?? []);
    }
    return rows;
}

/** What a person merge does with its shared events (see personMergeShares). */
export interface PersonMergeShareChoices {
    /** Shares whose matching own event stays an own event ('attach' rows not taken). */
    detach?: ReadonlySet<string>;
    /** The age the merged person's copy gets ('once' rows whose ages differ). */
    ages?: ReadonlyMap<string, string>;
}

/**
 * Apply `rows` (computed before the merge) to the merged person, whose events
 * now hold both persons' records: an own event matching a shared one goes
 * (unless detached) — its sources, their quality and a note or an address
 * the shared event has none of go to every copy, its age and other own
 * fields to the merged person's copy; two copies of one share become one
 * (joinSameShareCopies) with the chosen age. Returns the share ids touched.
 */
export function applyPersonMergeShares(
    data: StromData, person: Person, rows: readonly PersonMergeShareRow[], choices: PersonMergeShareChoices = {},
): string[] {
    const touched = new Set<string>();
    const events = person.events ?? [];
    for (const row of rows) {
        touched.add(row.shareId);
        if (row.kind !== 'attach' || choices.detach?.has(row.shareId)) continue;
        const own = row.other;
        const at = events.indexOf(own);
        if (at < 0) continue;
        events.splice(at, 1);
        const copies = shareCopiesOf(data, row.shareId).map(c => c.event);
        if (!copies.includes(row.event)) copies.push(row.event);
        for (const copy of copies) {
            for (const id of own.sourceIds ?? []) {
                if (!(copy.sourceIds ?? []).includes(id)) {
                    (copy.sourceIds ??= []).push(id);
                    const q = own.citationQuay?.sourceIds?.[id];
                    if (q !== undefined) {
                        copy.citationQuay = { ...copy.citationQuay, sourceIds: { ...copy.citationQuay?.sourceIds, [id]: q } };
                    }
                }
            }
        }
        for (const f of ['note', 'address'] as const) {
            const text = own[f]?.trim();
            if (text && copies.every(c => !c[f]?.trim())) for (const c of copies) c[f] = own[f];
        }
        absorbCopy(row.event, own);
    }
    joinSameShareCopies(person);
    for (const [shareId, age] of choices.ages ?? []) {
        const copy = (person.events ?? []).find(e => e.shareId === shareId);
        if (!copy) continue;
        if (age.trim()) copy.age = age;
        else delete copy.age;
    }
    return [...touched];
}
