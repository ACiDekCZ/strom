/**
 * Table view (spec 073 §14.1): the Events rows.
 *
 * One row per event of the tree: every event of a person (all types), the
 * birth and the death from a person's own fields, the wedding and the divorce
 * of a union (both partners) and every event of a couple. The same event
 * recorded at several people (spec 053: a census of a household, a move of a
 * family) is one row with all of them. Placeholder persons have no rows.
 */

import type { CoupleEvent, CoupleEventType, EventParticipant, LifeEvent, LifeEventType, Partnership, Person, PersonId, StromData } from '../../types.js';
import type { EventCategory, EventRef, EventRow } from './table-model.js';

/** Couple events that belong to a marriage (the Marriages chip, §14.1). */
const MARRIAGE_COUPLE_TYPES: ReadonlySet<CoupleEventType> = new Set(['engagement', 'banns', 'marriageLicence', 'marriageContract', 'marriageSettlement']);

/**
 * Event types a household shares (spec 053): identical copies at several
 * people are one event. A baptism, an occupation or a title is always one
 * person's own, even when two copies look alike.
 */
const SHARED_TYPES: ReadonlySet<LifeEventType> = new Set(['residence', 'military', 'emigration', 'immigration', 'naturalization', 'custom']);

function lifeCategory(type: LifeEventType): EventCategory {
    if (type === 'birth' || type === 'baptism') return 'birth';
    if (type === 'death' || type === 'burial' || type === 'cremation') return 'death';
    return 'other';
}

const has = (v: string | undefined): boolean => !!v?.trim();

/** The key identical copies of a shared event agree on; null: never merged. */
function shareKey(e: LifeEvent): string | null {
    if (!SHARED_TYPES.has(e.type) || !has(e.date)) return null;
    const sources = [...new Set(e.sourceIds ?? [])].sort();
    if (!has(e.place) && !sources.length) return null;
    const norm = (v: string | undefined) => (v ?? '').trim();
    return JSON.stringify([e.type, norm(e.customLabel), norm(e.date), norm(e.place), norm(e.address), norm(e.note), sources]);
}

/** The participants of several copies, each (person, or role and name) once. */
function mergeParticipants(into: EventParticipant[], more: readonly EventParticipant[] | undefined): void {
    for (const x of more ?? []) {
        const same = into.some(y => y.role === x.role && (x.personId ? y.personId === x.personId : !y.personId && (y.name ?? '').trim() === (x.name ?? '').trim()));
        if (!same) into.push(x);
    }
}

function row(id: string, fields: Omit<EventRow, 'kind' | 'id' | 'cache'>): EventRow {
    return { kind: 'event', id, ...fields, cache: new Map() };
}

/** The persons of a union that are real (not placeholders), in data order. */
function unionPersons(data: StromData, u: Partnership): Person[] {
    return [u.person1Id, u.person2Id]
        .map(id => data.persons[id])
        .filter((p): p is Person => !!p && !p.isPlaceholder);
}

const isMarriage = (u: Partnership) => u.status === 'married' || u.status === 'divorced';

/** A union's wedding row: always for a marriage the file recorded; a relationship's start only with something written. */
function weddingRow(u: Partnership, persons: Person[]): EventRow | null {
    const recorded = has(u.startDate) || has(u.startPlace) || has(u.address) || (u.sourceIds?.length ?? 0) > 0
        || (u.participants?.length ?? 0) > 0 || Object.values(u.ages ?? {}).some(has);
    if (!recorded && (!isMarriage(u) || u.marriageUnrecorded)) return null;
    const marriage = isMarriage(u);
    return row(`w:${u.id}`, {
        source: 'marriage', type: marriage ? 'marriage' : 'partnersStart', category: marriage ? 'marriage' : 'other',
        persons, union: u, event: null, refs: [], date: u.startDate, place: u.startPlace,
        sourceIds: [...(u.sourceIds ?? [])], participants: [...(u.participants ?? [])],
    });
}

/** A union's divorce (or a relationship's end) row: when divorced or anything of the end is written. */
function divorceRow(u: Partnership, persons: Person[]): EventRow | null {
    const recorded = has(u.endDate) || has(u.endPlace) || (u.divorceSourceIds?.length ?? 0) > 0;
    if (!recorded && u.status !== 'divorced') return null;
    return row(`v:${u.id}`, {
        source: 'divorce', type: isMarriage(u) ? 'divorce' : 'partnersEnd', category: 'other',
        persons, union: u, event: null, refs: [], date: u.endDate, place: u.endPlace,
        sourceIds: [...(u.divorceSourceIds ?? [])], participants: [],
    });
}

function coupleRow(u: Partnership, persons: Person[], e: CoupleEvent): EventRow {
    return row(`c:${u.id}:${e.id}`, {
        source: 'couple', type: e.type, category: MARRIAGE_COUPLE_TYPES.has(e.type) ? 'marriage' : 'other',
        persons, union: u, event: e, refs: [], date: e.date, place: e.place,
        sourceIds: [...(e.sourceIds ?? [])], participants: [...(e.participants ?? [])],
    });
}

/**
 * All event rows of a tree, in data order (persons first, then unions), and
 * each row by its id. A merged event is found by the id of every copy.
 */
export function buildEventRows(data: StromData): { rows: EventRow[]; byId: Map<string, EventRow> } {
    const rows: EventRow[] = [];
    const byId = new Map<string, EventRow>();
    const shared = new Map<string, EventRow>();
    const add = (r: EventRow) => { rows.push(r); byId.set(r.id, r); };

    for (const p of Object.values(data.persons)) {
        if (!p || p.isPlaceholder) continue;
        if (has(p.birthDate) || has(p.birthPlace) || has(p.birthAddress) || (p.birthSourceIds?.length ?? 0) > 0) {
            add(row(`b:${p.id}`, {
                source: 'birth', type: 'birth', category: 'birth', persons: [p], union: null, event: null, refs: [],
                date: p.birthDate, place: p.birthPlace, sourceIds: [...(p.birthSourceIds ?? [])], participants: [],
            }));
        }
        for (const e of p.events ?? []) {
            const id = `l:${p.id}:${e.id}`;
            const key = shareKey(e);
            const hit = key ? shared.get(key) : undefined;
            if (hit && !hit.persons.some(x => x.id === p.id)) {
                hit.persons.push(p);
                hit.refs.push({ personId: p.id, eventId: e.id });
                mergeParticipants(hit.participants, e.participants);
                byId.set(id, hit);
                continue;
            }
            const r = row(id, {
                source: 'life', type: e.type, category: lifeCategory(e.type), persons: [p], union: null, event: e,
                refs: [{ personId: p.id, eventId: e.id } satisfies EventRef], date: e.date, place: e.place,
                sourceIds: [...new Set(e.sourceIds ?? [])], participants: [],
            });
            mergeParticipants(r.participants, e.participants);
            add(r);
            if (key && !hit) shared.set(key, r);
        }
        if (has(p.deathDate) || has(p.deathPlace) || has(p.deathCause) || has(p.deathAge) || has(p.deathAddress) || (p.deathSourceIds?.length ?? 0) > 0) {
            add(row(`d:${p.id}`, {
                source: 'death', type: 'death', category: 'death', persons: [p], union: null, event: null, refs: [],
                date: p.deathDate, place: p.deathPlace, sourceIds: [...(p.deathSourceIds ?? [])], participants: [],
            }));
        }
    }

    for (const u of Object.values(data.partnerships ?? {})) {
        if (!u) continue;
        const persons = unionPersons(data, u);
        if (!persons.length) continue;
        const w = weddingRow(u, persons);
        if (w) add(w);
        for (const e of u.events ?? []) add(coupleRow(u, persons, e));
        const v = divorceRow(u, persons);
        if (v) add(v);
    }
    return { rows, byId };
}

/** What the Edit action of an event row opens (§14.1, part A2). */
export type EventEditTarget =
    | { kind: 'person'; personId: PersonId }
    | { kind: 'personEvent'; personId: PersonId; eventId: string }
    | { kind: 'coupleEvent'; partnershipId: Partnership['id']; eventId: string }
    | { kind: 'union'; partnershipId: Partnership['id']; personId: PersonId };

/**
 * Where an event row is edited: a person's event in the person dialog on that
 * event (a merged one: its first copy), the birth and the death in the person
 * dialog, a couple's event in its own dialog, the wedding and the divorce in
 * the union's panel (as in the Unions table).
 */
export function eventEditTarget(r: EventRow): EventEditTarget | null {
    const first = r.persons[0];
    if (r.source === 'life') {
        const ref = r.refs[0];
        return ref ? { kind: 'personEvent', personId: ref.personId, eventId: ref.eventId } : null;
    }
    if (r.source === 'couple' && r.union && r.event) return { kind: 'coupleEvent', partnershipId: r.union.id, eventId: r.event.id };
    if ((r.source === 'marriage' || r.source === 'divorce') && r.union && first) return { kind: 'union', partnershipId: r.union.id, personId: first.id };
    return first ? { kind: 'person', personId: first.id } : null;
}

/**
 * A person's godparents (§14.5, the People table's Godparents): the
 * godparent participants of the person's birth and baptism events, each
 * (person, or name) once — the same participants the Events table lists.
 */
export function personGodparents(p: Person): EventParticipant[] {
    const out: EventParticipant[] = [];
    for (const e of p.events ?? []) {
        if (e.type !== 'birth' && e.type !== 'baptism') continue;
        mergeParticipants(out, (e.participants ?? []).filter(x => x.role === 'godparent'));
    }
    return out;
}
