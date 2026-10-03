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
