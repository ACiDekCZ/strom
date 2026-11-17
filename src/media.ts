/**
 * The tree's files (data v24, spec 102 §0): one record per file in
 * StromData.media, each with the places where it is in the tree — a person,
 * a person's fact or event, a couple or a couple's event, a source.
 *
 * Everything that showed a person's attachments reads them here
 * (personMedia), in the order the records were added. Pure functions over
 * the data; DataManager wraps the writes as undo steps.
 */

import { Attachment, MediaPlace, PartnershipId, PersonId, StromData } from './types.js';

/** All records of the tree, also those taken out (`removed`), in their order. */
export function allMedia(data: Pick<StromData, 'media'>): Attachment[] {
    return Object.values(data.media ?? {}).filter((a): a is Attachment => !!a && typeof a === 'object');
}

/** The records that are in the tree (at least one place). */
export function treeMedia(data: Pick<StromData, 'media'>): Attachment[] {
    return allMedia(data).filter(a => a.places?.length > 0);
}

/** A record by its id (also one taken out). */
export function findMedia(data: Pick<StromData, 'media'>, id: string | undefined): Attachment | undefined {
    if (!id) return undefined;
    const att = data.media?.[id];
    return att && typeof att === 'object' ? att : undefined;
}

export function placePersonId(place: MediaPlace): PersonId | undefined {
    return 'personId' in place ? place.personId : undefined;
}

export function placePartnershipId(place: MediaPlace): PartnershipId | undefined {
    return 'partnershipId' in place ? place.partnershipId : undefined;
}

export function placeSourceId(place: MediaPlace): string | undefined {
    return 'sourceId' in place ? place.sourceId : undefined;
}

/** A place of the person themselves (not a fact or event of theirs). */
export function isPersonPlace(place: MediaPlace, personId?: PersonId): boolean {
    return 'personId' in place && !place.fact && !place.eventId && (personId === undefined || place.personId === personId);
}

/** A key of a place: the same for the same place, whoever put it there. */
export function placeKey(place: MediaPlace): string {
    if ('personId' in place) return `p:${place.personId}${place.fact ? `:f:${place.fact}` : place.eventId ? `:e:${place.eventId}` : ''}`;
    if ('partnershipId' in place) return `u:${place.partnershipId}${place.eventId ? `:e:${place.eventId}` : ''}`;
    return `s:${place.sourceId}`;
}

export function samePlace(a: MediaPlace, b: MediaPlace): boolean {
    return placeKey(a) === placeKey(b);
}

/** The record is at this place. */
export function mediaAt(att: Attachment, place: MediaPlace): boolean {
    const key = placeKey(place);
    return (att.places ?? []).some(p => placeKey(p) === key);
}

/** The records at exactly this place, in their order. */
export function mediaOf(data: Pick<StromData, 'media'>, place: MediaPlace): Attachment[] {
    const key = placeKey(place);
    return treeMedia(data).filter(a => a.places.some(p => placeKey(p) === key));
}

/** The person's files: the records with any place of theirs (themselves, a fact, an event), in their order. */
export function personMedia(data: Pick<StromData, 'media'>, personId: PersonId | undefined): Attachment[] {
    if (!personId) return [];
    return treeMedia(data).filter(a => a.places.some(p => placePersonId(p) === personId));
}

/** How many files the person has (personMedia). */
export function personMediaCount(data: Pick<StromData, 'media'>, personId: PersonId | undefined): number {
    return personMedia(data, personId).length;
}

/** The person's file by its id (a record with a place of theirs). */
export function personMediaById(data: Pick<StromData, 'media'>, personId: PersonId | undefined, id: string | undefined): Attachment | undefined {
    const att = findMedia(data, id);
    return att && personId && att.places.some(p => placePersonId(p) === personId) ? att : undefined;
}

/** The people a record is with (each once, in the order of its places). */
export function mediaPersonIds(att: Pick<Attachment, 'places'>): PersonId[] {
    return [...new Set((att.places ?? []).map(placePersonId).filter((id): id is PersonId => !!id))];
}

/** The first person a record is with (its owner where one is needed), else undefined. */
export function mediaPersonId(att: Pick<Attachment, 'places'> | undefined): PersonId | undefined {
    return att ? mediaPersonIds(att)[0] : undefined;
}

/** The source a record is the document of (its first source place; the GEDCOM `2 _SOUR` under a person's OBJE). */
export function mediaSourceId(att: Pick<Attachment, 'places'>): string | undefined {
    for (const p of att.places ?? []) if ('sourceId' in p) return p.sourceId;
    return undefined;
}

/** All sources a record is the document of. */
export function mediaSourceIds(att: Pick<Attachment, 'places'>): string[] {
    return [...new Set((att.places ?? []).map(placeSourceId).filter((id): id is string => !!id))];
}

/** Any file in the tree at all. */
export function hasTreeMedia(data: Pick<StromData, 'media'>): boolean {
    return treeMedia(data).length > 0;
}

/**
 * Put a record into the data (a new one at the end; an existing id gets the
 * places it lacks). Mutates `data`; returns the record now held.
 */
export function putMedia(data: StromData, att: Attachment): Attachment {
    const media = (data.media ??= {});
    const had = media[att.id];
    if (!had) {
        media[att.id] = att;
        return att;
    }
    for (const p of att.places) if (!mediaAt(had, p)) had.places.push(p);
    return had;
}

/** A person's new file: a record with the person's place (and the source's, when given). Mutates `data`. */
export function addPersonMedia(data: StromData, personId: PersonId, att: Omit<Attachment, 'places'> & { places?: MediaPlace[] }, sourceId?: string): Attachment {
    const places: MediaPlace[] = [{ personId }, ...(sourceId ? [{ sourceId }] : [])];
    return putMedia(data, { ...att, places: [...places, ...(att.places ?? []).filter(p => !places.some(q => samePlace(p, q)))] });
}

/**
 * Take places off records: each place `drop` says yes to goes; a record left
 * with no place (and not taken out on purpose) goes too. Mutates `data`;
 * returns the ids of the records gone.
 */
export function dropMediaPlaces(data: StromData, drop: (place: MediaPlace, att: Attachment) => boolean): string[] {
    const gone: string[] = [];
    if (!data.media) return gone;
    for (const [id, att] of Object.entries(data.media)) {
        if (!att || typeof att !== 'object') continue;
        const had = att.places?.length ?? 0;
        const kept = (att.places ?? []).filter(p => !drop(p, att));
        if (kept.length === had) continue;
        att.places = kept;
        if (!kept.length && !att.removed) {
            delete data.media[id];
            gone.push(id);
        }
    }
    if (!Object.keys(data.media).length) delete data.media;
    return gone;
}

/** Take the person's places off every record (a record only theirs goes). Mutates `data`. */
export function dropPersonMedia(data: StromData, personId: PersonId): string[] {
    return dropMediaPlaces(data, p => placePersonId(p) === personId);
}

/** Remove records whole. Mutates `data`. */
export function deleteMedia(data: StromData, ids: Iterable<string>): void {
    if (!data.media) return;
    for (const id of ids) delete data.media[id];
    if (!Object.keys(data.media).length) delete data.media;
}

/** Keep only the records `keep` says yes to. Mutates `data`. */
export function filterMedia(data: StromData, keep: (att: Attachment) => boolean): number {
    if (!data.media) return 0;
    let dropped = 0;
    for (const [id, att] of Object.entries(data.media)) {
        if (keep(att)) continue;
        delete data.media[id];
        dropped++;
    }
    if (!Object.keys(data.media).length) delete data.media;
    return dropped;
}

/**
 * The places that name what is no longer in the tree go (a person, a couple,
 * a source deleted, also by a filter of an export); one of an event no longer
 * there falls back to its person or couple. A record left without places
 * (and not taken out on purpose) goes, the places of one taken out are
 * cleaned the same way. Mutates `data`; returns how many places went.
 */
export function pruneMedia(data: StromData): number {
    if (!data.media) return 0;
    let dropped = 0;
    const persons = data.persons ?? {};
    const unions = data.partnerships ?? {};
    const sources = data.sources ?? {};
    const fix = (place: MediaPlace): MediaPlace | null => {
        if ('personId' in place) {
            const person = persons[place.personId];
            if (!person) return null;
            if (place.eventId && !(person.events ?? []).some(e => e.id === place.eventId)) {
                return { personId: place.personId, ...(place.by ? { by: place.by } : {}) };
            }
            return place;
        }
        if ('partnershipId' in place) {
            const union = unions[place.partnershipId];
            if (!union) return null;
            if (place.eventId && !(union.events ?? []).some(e => e.id === place.eventId)) {
                return { partnershipId: place.partnershipId, ...(place.by ? { by: place.by } : {}) };
            }
            return place;
        }
        if ('sourceId' in place) return sources[place.sourceId] ? place : null;
        return null;
    };
    const clean = (list: MediaPlace[]): MediaPlace[] => {
        const out: MediaPlace[] = [];
        for (const p of list) {
            const now = p && typeof p === 'object' ? fix(p) : null;
            if (!now || out.some(q => samePlace(q, now))) {
                dropped++;
                continue;
            }
            if (now !== p) dropped++;
            out.push(now);
        }
        return out;
    };
    for (const [id, att] of Object.entries(data.media)) {
        if (!att || typeof att !== 'object') {
            delete data.media[id];
            continue;
        }
        const places = Array.isArray(att.places) ? att.places : [];
        const kept = clean(places);
        if (kept.length !== places.length || kept.some((p, i) => p !== places[i])) att.places = kept;
        if (att.removed) att.removed.places = clean(Array.isArray(att.removed.places) ? att.removed.places : []);
        if (!att.places.length && !att.removed) delete data.media[id];
    }
    if (!Object.keys(data.media).length) delete data.media;
    return dropped;
}

/**
 * The tree's files as the data of v23 and older held them (Person.attachments,
 * Attachment.sourceId) moved into records (data v24, spec 102 §0): each
 * attachment a record with its person's place and its source's; the same
 * file at several people (the same original by its hash, else the same data)
 * one record with each person's place — the first one's id, the first note
 * and date that say something. The order of the records is the order of the
 * people and their attachments. Records already there stay first.
 * Mutates `data` (the persons lose `attachments`); returns how many joined.
 */
export function moveLegacyAttachments(data: StromData): number {
    let joined = 0;
    /** Per person: an attachment id that is now another record's (joined, or renamed for a clash). */
    const renamed = new Map<PersonId, Map<string, string>>();
    const rename = (personId: PersonId, from: string, to: string): void => {
        if (from === to) return;
        let m = renamed.get(personId);
        if (!m) renamed.set(personId, m = new Map());
        m.set(from, to);
    };
    const bySha = new Map<string, Attachment>();
    const byUrl = new Map<string, Attachment>();
    for (const att of allMedia(data)) {
        const sha = att.original?.sha256?.toLowerCase();
        if (sha) bySha.set(sha, att);
        else if (!att.originalOnly && att.dataUrl) byUrl.set(att.dataUrl, att);
    }
    for (const [personId, person] of Object.entries(data.persons ?? {}) as [PersonId, unknown][]) {
        if (!person || typeof person !== 'object') continue;
        const holder = person as { attachments?: unknown };
        const list = holder.attachments;
        delete holder.attachments;
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const { sourceId, places: _places, ...rest } = raw as Attachment & { sourceId?: unknown };
            const att = rest as Omit<Attachment, 'places'>;
            if (typeof att.id !== 'string' || !att.id) continue;
            const places: MediaPlace[] = [{ personId }];
            if (typeof sourceId === 'string' && sourceId) places.push({ sourceId });
            const sha = att.original?.sha256?.toLowerCase();
            const same = sha ? bySha.get(sha) : !att.originalOnly && att.dataUrl ? byUrl.get(att.dataUrl) : undefined;
            if (same) {
                joined++;
                rename(personId, att.id, same.id);
                for (const p of places) if (!mediaAt(same, p)) same.places.push(p);
                if (!same.note && att.note) same.note = att.note;
                if (!same.date && att.date) same.date = att.date;
                // The record that shows the file wins over one that holds its original only.
                if (same.originalOnly && !att.originalOnly && att.dataUrl) {
                    delete same.originalOnly;
                    same.dataUrl = att.dataUrl;
                    same.mimeType = att.mimeType;
                    same.sizeBytes = att.sizeBytes;
                }
                continue;
            }
            // An id taken by another file already: the record gets one of its own.
            let id = att.id;
            for (let n = 2; data.media?.[id]; n++) id = `${att.id}_${n}`;
            rename(personId, att.id, id);
            const record: Attachment = { ...att, id, places };
            (data.media ??= {})[id] = record;
            if (sha) bySha.set(sha, record);
            else if (!att.originalOnly && att.dataUrl) byUrl.set(att.dataUrl, record);
        }
    }
    // What named an attachment that is now another record names that record:
    // a portrait's original and the excerpts cut from it.
    const anyRename = new Map<string, string>();
    for (const [personId, m] of renamed) {
        for (const [from, to] of m) if (!anyRename.has(from)) anyRename.set(from, to);
        const person = data.persons[personId];
        const src = person?.photoSource;
        if (src?.attachmentId && m.has(src.attachmentId)) src.attachmentId = m.get(src.attachmentId);
    }
    if (anyRename.size) {
        for (const source of Object.values(data.sources ?? {})) {
            for (const exc of source?.excerpts ?? []) {
                if (exc.fromAttachmentId && anyRename.has(exc.fromAttachmentId)) exc.fromAttachmentId = anyRename.get(exc.fromAttachmentId);
            }
        }
    }
    return joined;
}

const KINDS = new Set(['photo', 'document', 'record', 'other']);
const isBy = (v: unknown): v is 'user' | 'agent' => v === 'user' || v === 'agent';

/** A place as read from stored data: only the known shapes, with text ids. */
function cleanPlace(raw: unknown): MediaPlace | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const by = isBy(r.by) && r.by !== 'user' ? { by: r.by } : {};
    const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
    if (text(r.personId)) {
        if (r.fact === 'birth' || r.fact === 'death') return { personId: r.personId as PersonId, fact: r.fact, ...by };
        if (text(r.eventId)) return { personId: r.personId as PersonId, eventId: r.eventId, ...by };
        return { personId: r.personId as PersonId, ...by };
    }
    if (text(r.partnershipId)) return { partnershipId: r.partnershipId as PartnershipId, ...(text(r.eventId) ? { eventId: r.eventId } : {}), ...by };
    if (text(r.sourceId)) return { sourceId: r.sourceId, ...by };
    return null;
}

/**
 * StromData.media as read from stored data (data v24): records keyed by
 * their id with text data, valid places and only valid values of the fields
 * of spec 102 (title, kind, who gave them, removed). Whether the places name
 * what is in the tree is pruneMedia's. Undefined when nothing is left.
 */
export function sanitizeMediaRecords(raw: unknown): Record<string, Attachment> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, Attachment> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const att = value as Attachment & Record<string, unknown>;
        if (typeof att.dataUrl !== 'string' || typeof att.name !== 'string') continue;
        att.id = key;
        if (typeof att.mimeType !== 'string') att.mimeType = '';
        if (typeof att.sizeBytes !== 'number') att.sizeBytes = 0;
        att.places = (Array.isArray(att.places) ? att.places : []).map(cleanPlace).filter((p): p is MediaPlace => !!p);
        if (att.title !== undefined && (typeof att.title !== 'string' || !att.title.trim())) delete att.title;
        if (att.kind !== undefined && !KINDS.has(att.kind as string)) delete att.kind;
        for (const f of ['titleBy', 'dateBy', 'kindBy'] as const) if (att[f] !== undefined && !isBy(att[f])) delete att[f];
        if (att.addedAt !== undefined && typeof att.addedAt !== 'string') delete att.addedAt;
        if ('sourceId' in att) delete att.sourceId;
        if (att.removed !== undefined) {
            const r = att.removed as unknown as Record<string, unknown>;
            if (!r || typeof r !== 'object' || typeof r.at !== 'string') delete att.removed;
            else {
                att.removed = {
                    at: r.at,
                    ...(r.reason === 'unrelated' || r.reason === 'duplicate' ? { reason: r.reason } : {}),
                    places: (Array.isArray(r.places) ? r.places : []).map(cleanPlace).filter((p): p is MediaPlace => !!p),
                };
            }
        }
        out[key] = att;
    }
    return Object.keys(out).length ? out : undefined;
}

/** Each person's files at once (personMedia for every person), for code that goes through all people. */
export function personMediaIndex(data: Pick<StromData, 'media'>): Map<PersonId, Attachment[]> {
    const out = new Map<PersonId, Attachment[]>();
    for (const att of treeMedia(data)) {
        for (const pid of mediaPersonIds(att)) {
            let list = out.get(pid);
            if (!list) out.set(pid, list = []);
            list.push(att);
        }
    }
    return out;
}

/**
 * A person's files in stored data of any version, read as it is (not
 * through migrateData): the attachments a tree of v23 and older keeps on the
 * person, else personMedia.
 */
export function personFilesAnyVersion(data: Pick<StromData, 'media' | 'persons'>, personId: PersonId): Omit<Attachment, 'places'>[] {
    const legacy = (data.persons?.[personId] as { attachments?: unknown } | undefined)?.attachments;
    if (Array.isArray(legacy)) return legacy.filter((a): a is Attachment => !!a && typeof a === 'object');
    return personMedia(data, personId);
}
