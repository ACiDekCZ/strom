/**
 * Changes per person (A2): what the user changed since the research's last
 * version, person by person — the base is a copy of the tree as the research
 * last gave it (or as it last took it), kept in this browser without images.
 * Pure: no DOM, no storage.
 */

import { StromData, Person, Partnership, Source, EventParticipant, PersonId } from './types.js';

export type ChangeKind =
    | 'added' | 'deleted' | 'name' | 'birth' | 'death' | 'marriage' | 'event'
    | 'godparent' | 'witness' | 'citation' | 'source' | 'attachment' | 'attachmentRemoved' | 'note' | 'other';

/** The order kinds are told in (the most telling first). */
const KIND_ORDER: ChangeKind[] = ['added', 'deleted', 'name', 'birth', 'death', 'marriage', 'event', 'godparent', 'witness',
    'citation', 'source', 'attachment', 'attachmentRemoved', 'note', 'other'];

export interface PersonChange {
    personId: PersonId;
    name: string;
    kinds: ChangeKind[];
    /** Removed in the app: no longer in the tree (no link to it). */
    deleted?: boolean;
}

const NAME_FIELDS: (keyof Person)[] = ['firstName', 'lastName', 'nameVariants'];
const BIRTH_FIELDS: (keyof Person)[] = ['birthDate', 'birthPlace', 'birthAddress'];
const DEATH_FIELDS: (keyof Person)[] = ['deathDate', 'deathPlace', 'deathCause', 'deathAge', 'deathAddress', 'isDeceased'];
const CITATION_FIELDS: (keyof Person)[] = ['sourceIds', 'birthSourceIds', 'deathSourceIds'];
/** Not the user's: the research's own knowledge and statuses, and what the app keeps for itself. */
const IGNORED_FIELDS = new Set<string>(['research', 'birthStatus', 'deathStatus', 'photoOriginalName', 'partnerships', 'childIds', 'isLocked']);
const MARRIAGE_FIELDS: (keyof Partnership)[] = ['status', 'startDate', 'startPlace', 'endDate', 'endPlace', 'address', 'ages', 'note'];

/** JSON with sorted keys and images reduced to their length (two copies of one tree compare equal). */
export function stable(value: unknown): string {
    return JSON.stringify(value, (_k, v) => {
        if (typeof v === 'string' && v.length >= 256 && v.startsWith('data:')) return `img:${v.length}`;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.keys(v).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = (v as Record<string, unknown>)[k]; return o; }, {});
        }
        return v;
    }) ?? '';
}

const differs = (a: unknown, b: unknown): boolean => stable(a) !== stable(b);
const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`.trim() || '?';

/**
 * The base kept for a tree: the data as the research last had them, images
 * replaced by their length (a photo or scan changed still compares unequal)
 * — small enough to keep beside the tree.
 */
export function baseCopy(data: StromData): StromData {
    return JSON.parse(JSON.stringify({ persons: data.persons, partnerships: data.partnerships, sources: data.sources ?? {} },
        (_k, v) => typeof v === 'string' && v.length >= 256 && v.startsWith('data:') ? `img:${v.length}` : v)) as StromData;
}

/** Participants added or changed at an event: godparents apart from everyone else. */
function participantKinds(before: EventParticipant[] | undefined, after: EventParticipant[] | undefined): ChangeKind[] {
    if (!differs(before ?? [], after ?? [])) return [];
    const all = [...(before ?? []), ...(after ?? [])];
    const changed = all.filter(p => {
        const other = (before ?? []).find(b => b.id === p.id);
        const now = (after ?? []).find(a => a.id === p.id);
        return !other || !now || differs(other, now);
    });
    const out = new Set<ChangeKind>();
    for (const p of changed) out.add(p.role === 'godparent' ? 'godparent' : 'witness');
    return [...out];
}

function personKinds(before: Person, after: Person, sourcesChanged: Set<string>): Set<ChangeKind> {
    const kinds = new Set<ChangeKind>();
    if (NAME_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('name');
    if (BIRTH_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('birth');
    if (DEATH_FIELDS.some(f => differs(before[f], after[f]))) kinds.add('death');
    if (CITATION_FIELDS.some(f => differs(before[f] ?? [], after[f] ?? []))) kinds.add('citation');
    if (differs(before.notes ?? '', after.notes ?? '')) kinds.add('note');
    // Events: the event itself, its people, its citations.
    const evBefore = new Map((before.events ?? []).map(e => [e.id, e]));
    const evAfter = new Map((after.events ?? []).map(e => [e.id, e]));
    for (const id of new Set([...evBefore.keys(), ...evAfter.keys()])) {
        const a = evBefore.get(id);
        const b = evAfter.get(id);
        if (!a || !b) { kinds.add(b?.type === 'birth' || a?.type === 'birth' ? 'birth' : 'event'); if (b?.participants?.length) participantKinds([], b.participants).forEach(k => kinds.add(k)); continue; }
        const { participants: pa, sourceIds: sa, status: _st1, ...restA } = a;
        const { participants: pb, sourceIds: sb, status: _st2, ...restB } = b;
        if (differs(restA, restB)) kinds.add('event');
        participantKinds(pa, pb).forEach(k => kinds.add(k));
        if (differs(sa ?? [], sb ?? [])) kinds.add('citation');
    }
    // Attachments: added, removed (by id); a changed note or crop is "other".
    const attBefore = new Set((before.attachments ?? []).map(a => a.id));
    const attAfter = new Set((after.attachments ?? []).map(a => a.id));
    if ([...attAfter].some(id => !attBefore.has(id))) kinds.add('attachment');
    if ([...attBefore].some(id => !attAfter.has(id))) kinds.add('attachmentRemoved');
    // A source this person cites, changed (its transcript, its page…).
    if ([...(after.sourceIds ?? []), ...(after.birthSourceIds ?? []), ...(after.deathSourceIds ?? []),
        ...(after.events ?? []).flatMap(e => e.sourceIds ?? [])].some(id => sourcesChanged.has(id))) kinds.add('source');
    // Anything else of the person (gender, the number, the question, the story, parents…).
    const known = new Set<string>([...NAME_FIELDS, ...BIRTH_FIELDS, ...DEATH_FIELDS, ...CITATION_FIELDS, 'notes', 'events', 'attachments', 'id']);
    const rest = (p: Person): Record<string, unknown> => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) if (!known.has(k) && !IGNORED_FIELDS.has(k)) o[k] = v;
        return o;
    };
    if (differs(rest(before), rest(after))) kinds.add('other');
    if (differs((before.attachments ?? []).map(a => ({ ...a, dataUrl: undefined })), (after.attachments ?? []).map(a => ({ ...a, dataUrl: undefined })))
        && !kinds.has('attachment') && !kinds.has('attachmentRemoved')) kinds.add('other');
    return kinds;
}

/** A source this person cites changed. */
function citesChanged(p: Person, sourcesChanged: Set<string>): boolean {
    if (sourcesChanged.size === 0) return false;
    return [...(p.sourceIds ?? []), ...(p.birthSourceIds ?? []), ...(p.deathSourceIds ?? []),
        ...(p.events ?? []).flatMap(e => e.sourceIds ?? [])].some(id => sourcesChanged.has(id));
}

/** What changed for each person since `base` (an empty list: nothing). Sorted by name. */
export function diffByPerson(base: StromData, current: StromData): PersonChange[] {
    const out = new Map<string, { name: string; kinds: Set<ChangeKind>; deleted?: boolean }>();
    const touch = (id: string, name: string): Set<ChangeKind> => {
        let e = out.get(id);
        if (!e) { e = { name, kinds: new Set() }; out.set(id, e); }
        return e.kinds;
    };
    const bp = base.persons as Record<string, Person>;
    const cp = current.persons as Record<string, Person>;
    const bs = (base.sources ?? {}) as Record<string, Source>;
    const cs = (current.sources ?? {}) as Record<string, Source>;
    const sourcesChanged = new Set(Object.keys(cs).filter(id => bs[id] && differs(bs[id], cs[id])));

    for (const p of Object.values(cp)) {
        const before = bp[p.id];
        if (!before) {
            if (!p.isPlaceholder) touch(p.id, fullName(p)).add('added');
            continue;
        }
        // Most people did not change: one comparison of the whole record, not one per field.
        if (stable(before) === stable(p) && !citesChanged(p, sourcesChanged)) continue;
        const kinds = personKinds(before, p, sourcesChanged);
        if (kinds.size) kinds.forEach(k => touch(p.id, fullName(p)).add(k));
    }
    for (const p of Object.values(bp)) {
        if (cp[p.id] || p.isPlaceholder) continue;
        touch(p.id, fullName(p)).add('deleted');
        out.get(p.id)!.deleted = true;
    }

    // Couples: the wedding and divorce, the witnesses, the couple's events and citations — told at both partners.
    const bu = base.partnerships as Record<string, Partnership>;
    const cu = current.partnerships as Record<string, Partnership>;
    for (const id of new Set([...Object.keys(bu), ...Object.keys(cu)])) {
        const a = bu[id];
        const b = cu[id];
        if (a && b && stable(a) === stable(b)) continue;
        const kinds = new Set<ChangeKind>();
        if (!a || !b) kinds.add('marriage');
        else {
            if (MARRIAGE_FIELDS.some(f => differs(a[f], b[f]))) kinds.add('marriage');
            participantKinds(a.participants, b.participants).forEach(k => kinds.add(k));
            if (differs(a.events ?? [], b.events ?? [])) kinds.add('event');
            if (differs(a.sourceIds ?? [], b.sourceIds ?? [])) kinds.add('citation');
            if (differs(a.story, b.story)) kinds.add('other');
        }
        if (!kinds.size) continue;
        const u = (b ?? a)!;
        for (const pid of [u.person1Id, u.person2Id]) {
            const person = cp[pid] ?? bp[pid];
            if (!person || person.isPlaceholder) continue;
            if (out.get(pid)?.deleted) continue;
            kinds.forEach(k => touch(pid, fullName(person)).add(k));
        }
    }

    return [...out.entries()]
        .map(([personId, e]) => ({
            personId: personId as PersonId,
            name: e.name,
            kinds: KIND_ORDER.filter(k => e.kinds.has(k)),
            ...(e.deleted ? { deleted: true } : {}),
        }))
        .sort((x, y) => x.name.localeCompare(y.name));
}

// ==================== VALUES THE RESEARCH'S VERSION WOULD OVERWRITE ====================

/** Which value a row is about (the UI names it). */
export type ValueField =
    | 'name' | 'gender' | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace' | 'deathCause' | 'notes'
    | 'person' | 'event' | 'eventDate' | 'eventPlace' | 'eventValue' | 'citation' | 'marriageDate' | 'marriagePlace';

/** One value here that loading the research's version replaces or removes. */
export interface ValueChange {
    /** The person (a couple: the first partner), for the name column and selecting. */
    personId: PersonId;
    /** The person's name ("Jan Víšek"; a couple "Jan Víšek & Anna Víšková"). */
    name: string;
    field: ValueField;
    /** The event's type for event rows; the fact a citation belongs to ('birth', 'death', 'person' or an event type). */
    of?: string;
    /** As it is here, and as the research's version has it ('' = none). Dates as stored (flex dates). */
    here: string;
    there: string;
    /** The field holds a date (the UI formats it). */
    date?: boolean;
    /** An open conflict of the research is about this fact. */
    conflict?: boolean;
}

export interface ValueDiff {
    /** Values here that change or go, in person order. */
    rows: ValueChange[];
    /** People the research's version adds. */
    addedPersons: number;
    /** Facts it adds where there are none here (on people here and on the added ones). */
    addedFacts: number;
}

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

/** The open conflicts of a person in the research's version, by fact tag. */
function openConflictFacts(p: Person | undefined): Set<string> {
    return new Set((p?.research?.conflicts ?? []).filter(c => c.status === 'open').map(c => c.fact.toUpperCase()));
}

const EVENT_TAG: Record<string, string> = {
    baptism: 'BAPM', burial: 'BURI', occupation: 'OCCU', residence: 'RESI', emigration: 'EMIG', immigration: 'IMMI',
    education: 'EDUC', religion: 'RELI', confirmation: 'CONF', firstCommunion: 'FCOM', cremation: 'CREM', title: 'TITL',
};

/** The titles of sources (or their ids when unnamed), sorted. */
function sourceTitles(ids: readonly string[], sources: Record<string, Source>): string {
    return ids.map(id => sources[id]?.title?.trim() || id).sort((a, b) => a.localeCompare(b)).join(', ');
}

/** What a fact of a new person adds: its filled fields and events. */
function factsOf(p: Person): number {
    const fields: (keyof Person)[] = ['birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'deathCause'];
    return fields.filter(f => str(p[f])).length + (p.events?.length ?? 0);
}

/**
 * Values the research's version (`there`) would put over the tree here:
 * every value here that changes or goes, one row each (a value only there
 * is counted as added, not listed). Matched by id — `there` stabilized to
 * this tree's ids. Pure.
 */
export function diffValues(here: StromData, there: StromData): ValueDiff {
    const rows: ValueChange[] = [];
    let addedFacts = 0;
    const hp = here.persons as Record<string, Person>;
    const tp = there.persons as Record<string, Person>;
    const hs = (here.sources ?? {}) as Record<string, Source>;
    const ts = (there.sources ?? {}) as Record<string, Source>;
    const people = Object.values(hp).filter(p => !p.isPlaceholder).sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const field = (p: Person, f: ValueField, a: string, b: string, extra: Partial<ValueChange> = {}): void => {
        if (a === b) return;
        if (!a) { if (b) addedFacts++; return; }
        rows.push({ personId: p.id, name: fullName(p), field: f, here: a, there: b, ...extra });
    };
    for (const h of people) {
        const t = tp[h.id];
        if (!t) {
            rows.push({ personId: h.id, name: fullName(h), field: 'person', here: fullName(h), there: '' });
            continue;
        }
        if (stable(h) === stable(t)) continue;
        const open = openConflictFacts(t);
        field(h, 'name', fullName(h) === '?' ? '' : fullName(h), fullName(t) === '?' ? '' : fullName(t), open.has('NAME') ? { conflict: true } : {});
        if (h.gender !== t.gender && h.gender && t.gender) rows.push({ personId: h.id, name: fullName(h), field: 'gender', here: h.gender, there: t.gender, ...(open.has('SEX') ? { conflict: true } : {}) });
        const birth = open.has('BIRT') ? { conflict: true } : {};
        const death = open.has('DEAT') ? { conflict: true } : {};
        field(h, 'birthDate', str(h.birthDate), str(t.birthDate), { date: true, ...birth });
        field(h, 'birthPlace', str(h.birthPlace), str(t.birthPlace), birth);
        field(h, 'deathDate', str(h.deathDate), str(t.deathDate), { date: true, ...death });
        field(h, 'deathPlace', str(h.deathPlace), str(t.deathPlace), death);
        field(h, 'deathCause', str(h.deathCause), str(t.deathCause), death);
        field(h, 'notes', str(h.notes), str(t.notes));
        // Events by id: their date, place, value; one here only goes.
        const tEvents = new Map((t.events ?? []).map(e => [e.id, e]));
        for (const e of h.events ?? []) {
            const o = tEvents.get(e.id);
            const ev = { of: e.type, ...(open.has(EVENT_TAG[e.type] ?? '') ? { conflict: true } : {}) };
            if (!o) {
                rows.push({ personId: h.id, name: fullName(h), field: 'event', here: str(e.note) || str(e.date) || str(e.place) || e.type, there: '', ...ev,
                    ...(!str(e.note) && str(e.date) ? { date: true } : {}) });
                continue;
            }
            field(h, 'eventDate', str(e.date), str(o.date), { date: true, ...ev });
            field(h, 'eventPlace', str(e.place), str(o.place), ev);
            field(h, 'eventValue', str(e.note), str(o.note), ev);
            // Its citations: a source cited here and not there goes.
            const gone = (e.sourceIds ?? []).filter(id => !(o.sourceIds ?? []).includes(id));
            if (gone.length) rows.push({ personId: h.id, name: fullName(h), field: 'citation', of: e.type, here: sourceTitles(gone, hs), there: sourceTitles(o.sourceIds ?? [], ts) });
        }
        addedFacts += (t.events ?? []).filter(e => !(h.events ?? []).some(x => x.id === e.id)).length;
        // Citations of the person, the birth, the death: what is cited here and not there.
        for (const [key, of] of [['sourceIds', 'person'], ['birthSourceIds', 'birth'], ['deathSourceIds', 'death']] as const) {
            const a = h[key] ?? [];
            const b = t[key] ?? [];
            const gone = a.filter(id => !b.includes(id));
            if (gone.length) rows.push({ personId: h.id, name: fullName(h), field: 'citation', of, here: sourceTitles(gone, hs), there: sourceTitles(b, ts) });
            addedFacts += b.filter(id => !a.includes(id)).length;
        }
    }
    // Couples: the wedding's date and place.
    const hu = here.partnerships as Record<string, Partnership>;
    const tu = there.partnerships as Record<string, Partnership>;
    for (const u of Object.values(hu)) {
        const o = tu[u.id];
        const a = hp[u.person1Id];
        const b = hp[u.person2Id];
        if (!o || !a) continue;
        const who = { ...a, firstName: [fullName(a), b && !b.isPlaceholder ? fullName(b) : ''].filter(Boolean).join(' & '), lastName: '' } as Person;
        field(who, 'marriageDate', str(u.startDate), str(o.startDate), { date: true });
        field(who, 'marriagePlace', str(u.startPlace), str(o.startPlace));
    }
    const added = Object.values(tp).filter(p => !p.isPlaceholder && !hp[p.id]);
    addedFacts += added.reduce((n, p) => n + factsOf(p), 0);
    return { rows, addedPersons: added.length, addedFacts };
}
