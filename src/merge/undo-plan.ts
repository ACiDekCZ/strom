/**
 * The undo of a merge (spec 134 §10; K8.1–K8.5, K9.1, K9.3): what it takes
 * back (undoPreview) and the tree without it (applyUndo), whole or by parts.
 * Pure: no DOM, no storage (the write with its backup: write.ts writeUndo).
 *
 * The undo works from the merge's record (StromData.merges, record.ts): the
 * persons, couples, sources, places and files it added are removed, every
 * change it made to a record the tree had goes back to its value before.
 * A change is taken back three ways: a value that is still what the merge
 * left goes back; one changed since stays and is listed (changedSince),
 * kept unless chosen (K8.3); a list (children, couples, citations, events)
 * loses what the merge put in and gets back what it took out, whatever else
 * was done to it since. Work done after the merge stays (K8.1), the research
 * link of the tree and of its persons is not touched (K9.1).
 *
 * Items (ids of what can be chosen, by parts):
 * - `p:<person>`, `u:<couple>`, `s:<source>`, `l:<place key>`, `m:<file>`: a record the merge added, removed;
 * - `f:<person>|<detail>`: a detail of a joined person (record.fields), back to its value before;
 * - `j:<person>`: the rest a joined person got (relations, citations, events…), its details too;
 * - `t:<collection>/<id>`: a change to another record the tree had (a parent of an added child, a source…);
 * - `d:`: the tree's own lists (surnames, place records…), taken back with the last other item.
 *
 * When a change was made: the app keeps no date of a change to a detail (no
 * per-person `updatedAt`; history-store.ts is the research's events, not the
 * tree's edits), so an `edited` item has an empty `at`; a new relative gives
 * its `addedAt`, a proof the day of its confirmation, a later merge its time.
 */

import type { EventParticipant, MergeEdit, MergeRecord, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { hasImageToken, personPrint, valueKey } from './record.js';
import { forEachCitationHolder } from '../citation-quality.js';
import { partnershipParticipants } from '../model-values.js';
import { rewriteStorySources } from '../story-sources.js';
import { onPersonDeleted } from '../person-lists-data.js';
import { dropImportedParent } from '../import-origin.js';
import { tidyShares } from '../shared-events.js';
import { allMedia } from '../media.js';

// ==================== TYPES ====================

export type UndoItemKind = 'person' | 'partnership' | 'source' | 'place' | 'media' | 'field' | 'joined' | 'record' | 'data';

/** One thing the undo takes back. */
export interface UndoItem {
    /** The item id (see the top of this file). */
    id: string;
    kind: UndoItemKind;
    /** The record: a person, couple, source or file id, a place key, `collection/id` of a record (kind 'record'). */
    ref: string;
    /** The detail (kind 'field'). */
    field?: string;
}

/** A joined person: stays, loses what the merge brought (its details among `fields`). */
export interface UnjoinItem extends UndoItem {
    kind: 'joined';
    /** Items of its details (`f:`), each to be taken back on its own. */
    fields: string[];
}

/**
 * Why an item is kept unless chosen (K8.3): `edited` = changed since the
 * merge; `proven` = a fact of the person confirmed since; `relative` = the
 * person got a relative that is not from the merge (for a couple: a partner
 * kept so); `merge` = a later merge stands on it (`merge` its id); `used` = a
 * source or file a record that stays still cites; `picture` = a picture the
 * merge replaced, without the backup "Before merge" (cannot be undone).
 */
export type ChangedWhat = 'edited' | 'proven' | 'relative' | 'merge' | 'used' | 'picture';

export interface ChangedSince {
    /** The item id. */
    id: string;
    what: ChangedWhat;
    /** When (ISO or YYYY-MM-DD), '' when the app does not know. */
    at: string;
    /** The person concerned (an added one, a joined one, the new relative's kept partner). */
    person?: PersonId;
    /** The later merge (what 'merge'). */
    merge?: string;
}

export interface UndoPreview {
    /** Records the merge added that are still in the tree, removed. */
    remove: UndoItem[];
    /** Changes to records the tree had (not a joined person), back to the value before. */
    restore: UndoItem[];
    /** Joined persons: they stay, what the merge brought goes. */
    unjoin: UnjoinItem[];
    /** Kept unless chosen (K8.3). */
    changedSince: ChangedSince[];
    /** Later merges, not undone, that stand on persons of this one (K8.4). */
    dependents: MergeRecord[];
}

export interface UndoChoices {
    /** Items of changedSince to undo anyway (the default keeps them, K8.3). */
    undo?: readonly string[];
    /** Only these items (by parts, K8.1); `j:` takes the person's `f:` items too. Absent: all. */
    only?: readonly string[];
    /** The backup "Before merge" (its data): pictures the merge replaced come back from it. */
    backup?: StromData | null;
    /** The time of the undo (ISO), for the record. */
    at?: string;
}

export interface UndoResult {
    /** The tree without what was undone (a new object; `current` is not changed). */
    data: StromData;
    /** What stayed (changedSince not chosen, pictures without the backup). */
    kept: ChangedSince[];
    /** The record as it is in `data` (state, undone). */
    record: MergeRecord;
    /** The items undone now. */
    items: string[];
}

// ==================== ITEMS OF A RECORD ====================

interface Unit {
    id: string;
    kind: UndoItemKind;
    ref: string;
    field?: string;
    /** Ids that choose it (its own, and `j:` of its person for a detail). */
    chosenBy: string[];
    edits: MergeEdit[];
    /** The person whose detail or relations it is. */
    person?: PersonId;
}

const ADDED_IN_DATA = new Set(['placeRecords', 'placeRefs', 'placeAliases']);

/** The detail of a person's key: the photo's parts are the photo. */
const fieldOfKey = (key: string): string => key.startsWith('photo') ? 'photo' : key;

function unitsOf(record: MergeRecord): Unit[] {
    const out: Unit[] = [];
    const byId = new Map<string, Unit>();
    const unit = (u: Omit<Unit, 'edits'>): Unit => {
        let found = byId.get(u.id);
        if (!found) {
            found = { ...u, edits: [] };
            byId.set(u.id, found);
            out.push(found);
        }
        return found;
    };
    for (const id of record.added) unit({ id: `p:${id}`, kind: 'person', ref: id, chosenBy: [`p:${id}`], person: id });
    for (const id of record.partnerships) unit({ id: `u:${id}`, kind: 'partnership', ref: id, chosenBy: [`u:${id}`] });
    for (const id of record.sources) unit({ id: `s:${id}`, kind: 'source', ref: id, chosenBy: [`s:${id}`] });
    for (const key of record.places) unit({ id: `l:${key}`, kind: 'place', ref: key, chosenBy: [`l:${key}`] });
    for (const id of record.media) unit({ id: `m:${id}`, kind: 'media', ref: id, chosenBy: [`m:${id}`] });
    const joined = new Set<string>(record.joined.map(([t]) => t));
    const fields = new Set(record.fields.map(f => `${f.person}|${f.field}`));
    for (const e of record.edits ?? []) {
        let u: Unit;
        if (e.in === '' || (ADDED_IN_DATA.has(e.in) && e.before === undefined)) {
            u = unit({ id: 'd:', kind: 'data', ref: '', chosenBy: ['d:'] });
        } else if (e.in === 'persons' && joined.has(e.id) && e.key) {
            const field = fieldOfKey(e.key);
            const pid = e.id as PersonId;
            u = fields.has(`${e.id}|${field}`)
                ? unit({ id: `f:${e.id}|${field}`, kind: 'field', ref: e.id, field, chosenBy: [`f:${e.id}|${field}`, `j:${e.id}`], person: pid })
                : unit({ id: `j:${e.id}`, kind: 'joined', ref: e.id, chosenBy: [`j:${e.id}`], person: pid });
        } else {
            u = unit({
                id: `t:${e.in}/${e.id}`, kind: 'record', ref: `${e.in}/${e.id}`, chosenBy: [`t:${e.in}/${e.id}`],
                ...(e.in === 'persons' ? { person: e.id as PersonId } : {}),
            });
        }
        u.edits.push(e);
    }
    return out;
}

/** Every item of a merge (whatever the tree is now). */
export function undoItems(record: MergeRecord): string[] {
    return unitsOf(record).map(u => u.id);
}

/** The items undone so far. */
export function undoneItems(record: MergeRecord): Set<string> {
    return new Set((record.undone ?? []).flatMap(u => u.items));
}

// ==================== THREE-WAY REVERT ====================

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => v === undefined ? v : structuredClone(v);

interface RevertCtx {
    /** Ids of records the merge added that stay: their links are kept in lists and keys. */
    kept: ReadonlySet<string>;
    force: boolean;
    conflict: boolean;
}

function mentionsKept(text: string, kept: ReadonlySet<string>): boolean {
    if (kept.size === 0) return false;
    for (const id of kept) if (text.includes(JSON.stringify(id))) return true;
    return false;
}

const idOf = (v: unknown): string | null => isPlain(v) && typeof v.id === 'string' ? v.id : null;

/** A list back: what the merge put in goes, what it took out comes back; elements with an id three ways. */
function revertList(before: unknown[] | undefined, after: unknown[], cur: unknown[], ctx: RevertCtx): unknown[] | undefined {
    const was = before ?? [];
    const bById = new Map<string, unknown>();
    const aById = new Map<string, unknown>();
    for (const e of was) { const id = idOf(e); if (id !== null) bById.set(id, e); }
    for (const e of after) { const id = idOf(e); if (id !== null) aById.set(id, e); }
    const bKeys = new Set(was.filter(e => idOf(e) === null).map(valueKey));
    const aKeys = new Set(after.filter(e => idOf(e) === null).map(valueKey));
    const out: unknown[] = [];
    for (const e of cur) {
        const id = idOf(e);
        if (id !== null && (bById.has(id) || aById.has(id))) {
            const v = revertValue(bById.get(id), aById.get(id), e, ctx);
            if (v !== undefined) out.push(v);
            continue;
        }
        if (id === null) {
            const k = valueKey(e);
            if (aKeys.has(k) && !bKeys.has(k) && !(typeof e === 'string' && ctx.kept.has(e))) continue;
        }
        out.push(e);
    }
    was.forEach((e, i) => {
        const id = idOf(e);
        if (id !== null) {
            if (aById.has(id) || out.some(x => idOf(x) === id)) return;
        } else {
            const k = valueKey(e);
            if (aKeys.has(k) || out.some(x => valueKey(x) === k)) return;
        }
        out.splice(Math.min(i, out.length), 0, clone(e));
    });
    if (before !== undefined && valueKey(out) !== valueKey(before)) {
        // The same elements as before, in another order: as before.
        const sorted = (l: unknown[]): string => l.map(valueKey).sort().join('\n');
        if (sorted(out) === sorted(before)) return clone(before);
    }
    if (before === undefined && out.length === 0) return undefined;
    return before !== undefined && valueKey(out) === valueKey(before) ? clone(before) : out;
}

/**
 * The value back as it was before the merge (`before`), the merge having
 * left `after`, the tree having `cur` now. A value changed since stays
 * (ctx.conflict), unless forced.
 */
function revertValue(before: unknown, after: unknown, cur: unknown, ctx: RevertCtx): unknown {
    const kb = valueKey(before);
    const kc = valueKey(cur);
    if (kc === kb) return cur;
    const ka = valueKey(after);
    if (Array.isArray(after) && Array.isArray(cur) && (before === undefined || Array.isArray(before))) {
        return revertList(before as unknown[] | undefined, after, cur, ctx);
    }
    if (isPlain(before) && isPlain(after) && isPlain(cur)) {
        const out: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(cur), ...Object.keys(before), ...Object.keys(after)])) {
            if (key in cur && !(key in before) && ctx.kept.has(key)) {
                out[key] = cur[key];
                continue;
            }
            const v = revertValue(before[key], after[key], cur[key], ctx);
            if (v !== undefined) out[key] = v;
        }
        // Keys in the order they had (an object back as it was compares the same).
        const ordered: Record<string, unknown> = {};
        for (const key of [...Object.keys(before), ...Object.keys(out)]) if (key in out && !(key in ordered)) ordered[key] = out[key];
        return valueKey(ordered) === kb ? clone(before) : ordered;
    }
    if (kc === ka && !mentionsKept(ka, ctx.kept)) return clone(before);
    if (kc === ka) {
        // What the merge put there links a record that stays: it stays.
        return cur;
    }
    ctx.conflict = true;
    return ctx.force ? clone(before) : cur;
}

// ==================== THE TREE NOW ====================

type Coll = Record<string, unknown>;

const collOf = (data: StromData, name: string): Coll | undefined => (data as unknown as Record<string, Coll | undefined>)[name];

function ensureColl(data: StromData, name: string): Coll {
    const d = data as unknown as Record<string, Coll | undefined>;
    return d[name] ?? (d[name] = {});
}

/** The value an edit's `before` stands for in another copy of the tree (the backup). */
function valueIn(data: StromData, e: MergeEdit): unknown {
    if (e.in === '') return (data as unknown as Record<string, unknown>)[e.key];
    const rec = collOf(data, e.in)?.[e.id];
    if (e.key === '') return rec;
    return isPlain(rec) ? rec[e.key] : undefined;
}

/** The edit's value before with its pictures: from the backup, when the backup has that very value. Null: not to be had. */
function realBefore(e: MergeEdit, backup: StromData | null | undefined): { value: unknown } | null {
    if (!hasImageToken(e.before)) return { value: e.before };
    if (!backup) return null;
    const v = valueIn(backup, e);
    return valueKey(v) === valueKey(e.before) ? { value: clone(v) } : null;
}

/** The day of a date or a time (YYYY-MM-DD). */
const dayOf = (at: string): string => at.slice(0, 10);

function personName(p: Person | undefined): string {
    return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';
}

export function relativesOf(data: StromData, person: Person): PersonId[] {
    const out = new Set<PersonId>([...(person.parentIds ?? []), ...(person.childIds ?? [])]);
    for (const uid of person.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (!u) continue;
        out.add(u.person1Id === person.id ? u.person2Id : u.person1Id);
        for (const c of u.childIds ?? []) out.add(c);
    }
    out.delete(person.id);
    return [...out].filter(id => !!data.persons[id]);
}

/** A fact of the person confirmed on or after day `day` (by a person, or by the research): that date. */
function provenSince(person: Person, day: string): string {
    let found = '';
    for (const c of Object.values(person.confirmed ?? {})) {
        if (c?.at && dayOf(c.at) >= day && c.at > found) found = c.at;
    }
    for (const v of Object.values(person.researchVerify ?? {})) {
        if (v?.confirmed && dayOf(v.confirmed) >= day && v.confirmed > found) found = v.confirmed;
    }
    return found;
}

/** The persons the merge touched: added, joined, any other it changed. */
function mergePersons(record: MergeRecord): Set<string> {
    return new Set<string>([
        ...record.added,
        ...record.joined.map(([t]) => t),
        ...(record.edits ?? []).filter(e => e.in === 'persons').map(e => e.id),
    ]);
}

/** Later merges, not undone, standing on persons this one added (joined them, linked them, changed them). */
function laterOn(record: MergeRecord, current: StromData, all: readonly MergeRecord[]): Array<{ merge: MergeRecord; persons: PersonId[] }> {
    const ours = new Set<string>(record.added);
    const at = all.findIndex(r => r.id === record.id);
    const later = all.filter((r, i) => r.id !== record.id && r.state !== 'undone' && (at >= 0 ? i > at : r.at > record.at));
    const out: Array<{ merge: MergeRecord; persons: PersonId[] }> = [];
    for (const r of later) {
        const hit = new Set<PersonId>();
        for (const [t] of r.joined) if (ours.has(t)) hit.add(t);
        for (const e of r.edits ?? []) if (e.in === 'persons' && ours.has(e.id)) hit.add(e.id as PersonId);
        for (const id of r.added) {
            const p = current.persons[id];
            if (!p) continue;
            for (const rel of relativesOf(current, p)) if (ours.has(rel)) hit.add(rel);
        }
        if (hit.size) out.push({ merge: r, persons: [...hit] });
    }
    return out;
}

/** Why an added person is kept unless chosen (K8.3). */
function personReasons(record: MergeRecord, data: StromData, pid: PersonId, touched: Set<string>, later: ReturnType<typeof laterOn>): ChangedSince[] {
    const id = `p:${pid}`;
    const person = data.persons[pid];
    if (!person) return [];
    const out: ChangedSince[] = [];
    for (const l of later) {
        if (l.persons.includes(pid)) out.push({ id, what: 'merge', at: l.merge.at, person: pid, merge: l.merge.id });
    }
    const print = record.prints?.[pid];
    if (print && personPrint(person) !== print) out.push({ id, what: 'edited', at: '', person: pid });
    const proven = provenSince(person, dayOf(record.at));
    if (proven) out.push({ id, what: 'proven', at: proven, person: pid });
    const laterAdded = new Set(later.flatMap(l => l.merge.added));
    for (const rel of relativesOf(data, person)) {
        if (touched.has(rel) || laterAdded.has(rel)) continue;
        out.push({ id, what: 'relative', at: data.persons[rel]?.addedAt ?? '', person: rel });
        break;
    }
    return out;
}

// ==================== REMOVING RECORDS ====================

interface Gone {
    persons: Set<string>;
    unions: Set<string>;
    sources: Set<string>;
    media: Set<string>;
}

/** Remove the records of `gone` and every link to them (as deleting a person does, data.ts deletePerson). */
function removeRecords(data: StromData, gone: Gone): void {
    const names = new Map<string, string>();
    const shareIds: string[] = [];
    for (const id of gone.persons) {
        const p = data.persons[id as PersonId];
        if (!p) continue;
        if (!p.isPlaceholder) names.set(id, personName(p));
        for (const ev of p.events ?? []) if (ev.shareId) shareIds.push(ev.shareId);
    }
    // A couple of a removed person goes with it.
    for (const u of Object.values(data.partnerships)) {
        if (gone.persons.has(u.person1Id) || gone.persons.has(u.person2Id)) gone.unions.add(u.id);
    }
    for (const id of gone.persons) delete data.persons[id as PersonId];
    for (const id of gone.unions) delete data.partnerships[id as PartnershipId];
    for (const id of gone.sources) if (data.sources) delete data.sources[id];
    for (const id of gone.media) if (data.media) delete data.media[id];

    const unlink = (part: EventParticipant): void => {
        if (!part.personId || !gone.persons.has(part.personId)) return;
        const name = names.get(part.personId);
        if (!part.name && name && name !== '?') part.name = name;
        delete part.personId;
    };
    const keep = <T>(list: T[] | undefined, out: ReadonlySet<string>): T[] | undefined =>
        list && list.some(x => out.has(x as unknown as string)) ? list.filter(x => !out.has(x as unknown as string)) : list;
    if (gone.persons.size || gone.unions.size || gone.media.size) {
        for (const p of Object.values(data.persons)) {
            if (p.parentIds) p.parentIds = keep(p.parentIds, gone.persons)!;
            if (p.childIds) p.childIds = keep(p.childIds, gone.persons)!;
            if (p.partnerships) p.partnerships = keep(p.partnerships, gone.unions)!;
            for (const id of gone.persons) {
                if (p.parentRelTypes && id in p.parentRelTypes) {
                    delete p.parentRelTypes[id as PersonId];
                    if (Object.keys(p.parentRelTypes).length === 0) delete p.parentRelTypes;
                }
                dropImportedParent(p, id);
            }
            if (p.alsoChildOf?.some(a => gone.unions.has(a.partnershipId))) {
                p.alsoChildOf = p.alsoChildOf.filter(a => !gone.unions.has(a.partnershipId));
                if (p.alsoChildOf.length === 0) delete p.alsoChildOf;
            }
            for (const ev of p.events ?? []) {
                for (const part of ev.participants ?? []) unlink(part);
                if (ev.roleAt?.personId && gone.persons.has(ev.roleAt.personId)) delete ev.roleAt.personId;
                if (ev.roleAt?.partnershipId && gone.unions.has(ev.roleAt.partnershipId)) delete ev.roleAt.partnershipId;
            }
            const ps = p.photoSource;
            if (ps && ((ps.partnershipId && gone.unions.has(ps.partnershipId)) || (ps.attachmentId && gone.media.has(ps.attachmentId)))) delete p.photoSource;
        }
        for (const u of Object.values(data.partnerships)) {
            if (u.childIds) u.childIds = keep(u.childIds, gone.persons)!;
            for (const part of partnershipParticipants(u)) unlink(part);
        }
    }
    if (gone.sources.size) {
        forEachCitationHolder(data, (holder, fields) => {
            for (const f of fields) {
                const list = holder[f];
                if (!Array.isArray(list) || !list.some(id => gone.sources.has(id as string))) continue;
                const left = list.filter(id => !gone.sources.has(id as string));
                if (left.length) holder[f] = left;
                else delete holder[f];
            }
        });
        for (const p of Object.values(data.persons)) rewriteStorySources(p.story, ids => ids.filter(id => !gone.sources.has(id)));
        for (const u of Object.values(data.partnerships)) rewriteStorySources(u.story, ids => ids.filter(id => !gone.sources.has(id)));
    }
    for (const att of allMedia(data)) {
        if (!att.places?.length) continue;
        const left = att.places.filter(pl => !(
            ('personId' in pl && gone.persons.has(pl.personId))
            || ('partnershipId' in pl && gone.unions.has(pl.partnershipId))
            || ('sourceId' in pl && gone.sources.has(pl.sourceId))));
        if (left.length !== att.places.length) att.places = left;
    }
    for (const id of gone.persons) onPersonDeleted(data, id as PersonId);
    if (shareIds.length || gone.persons.size || gone.unions.size) tidyShares(data, shareIds);
    if (data.defaultPersonId && gone.persons.has(data.defaultPersonId)) delete data.defaultPersonId;
    if (data.lastFocusPersonId && gone.persons.has(data.lastFocusPersonId)) delete data.lastFocusPersonId;
}

/** Sources cited by the tree (persons, couples, their events and stories, files placed on a source). */
function citedSources(data: StromData): Set<string> {
    const out = new Set<string>();
    forEachCitationHolder(data, (holder, fields) => {
        for (const f of fields) {
            const list = holder[f];
            if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') out.add(id);
        }
    });
    for (const holder of [...Object.values(data.persons), ...Object.values(data.partnerships)]) {
        for (const id of [...(holder.story?.sources ?? []), ...(holder.story?.draft?.sources ?? [])]) out.add(id);
    }
    return out;
}

// ==================== THE UNDO ====================

interface Run {
    data: StromData;
    kept: ChangedSince[];
    items: string[];
}

function run(record: MergeRecord, current: StromData, choices: UndoChoices): Run {
    const data = structuredClone(current);
    const units = unitsOf(record);
    const done = undoneItems(record);
    const only = choices.only ? new Set(choices.only) : null;
    const forced = new Set(choices.undo ?? []);
    const open = units.filter(u => !done.has(u.id));
    const chosen = (u: Unit): boolean => !only || u.chosenBy.some(id => only.has(id));
    const items: string[] = [];
    const kept: ChangedSince[] = [];
    const touched = mergePersons(record);
    const later = laterOn(record, current, current.merges ?? []);

    // Persons: removed, unless changed since (kept unless chosen).
    const gone: Gone = { persons: new Set(), unions: new Set(), sources: new Set(), media: new Set() };
    const held = new Set<string>();
    for (const u of open.filter(x => x.kind === 'person' && chosen(x))) {
        if (!data.persons[u.ref as PersonId]) { items.push(u.id); continue; }
        const why = personReasons(record, data, u.ref as PersonId, touched, later);
        if (why.length && !forced.has(u.id)) {
            kept.push(...why);
            held.add(u.ref);
            continue;
        }
        gone.persons.add(u.ref);
        items.push(u.id);
    }
    // Couples: removed, unless a partner is a person kept so.
    const keptUnions = new Set<string>();
    for (const u of open.filter(x => x.kind === 'partnership' && chosen(x))) {
        const union = data.partnerships[u.ref as PartnershipId];
        if (!union) { items.push(u.id); continue; }
        const partner = [union.person1Id, union.person2Id].find(p => held.has(p));
        if (partner && !gone.persons.has(union.person1Id) && !gone.persons.has(union.person2Id) && !forced.has(u.id)) {
            kept.push({ id: u.id, what: 'relative', at: '', person: partner });
            keptUnions.add(u.ref);
            continue;
        }
        gone.unions.add(u.ref);
        items.push(u.id);
    }

    // Changes to records the tree had, back (the tree's own lists last: with the last other item).
    const keptIds = new Set<string>([
        ...record.added.filter(id => !gone.persons.has(id) && !!data.persons[id]),
        ...record.partnerships.filter(id => !gone.unions.has(id) && !!data.partnerships[id as PartnershipId]),
    ]);
    const revertUnit = (u: Unit): void => {
        const ctx: RevertCtx = { kept: keptIds, force: forced.has(u.id), conflict: false };
        let picture = false;
        for (const e of u.edits) {
            const coll = e.in === '' ? null : collOf(data, e.in);
            const rec = coll ? coll[e.id] : undefined;
            if (e.in !== '' && e.key !== '' && !isPlain(rec)) continue;   // the record is gone since
            const cur = e.in === '' ? (data as unknown as Record<string, unknown>)[e.key] : e.key === '' ? rec : (rec as Record<string, unknown>)[e.key];
            if (valueKey(cur) === valueKey(e.before)) continue;
            const real = realBefore(e, choices.backup);
            if (!real) { picture = true; continue; }
            const next = revertValue(real.value, e.after, cur, ctx);
            if (e.in === '') {
                const d = data as unknown as Record<string, unknown>;
                if (next === undefined) delete d[e.key]; else d[e.key] = next;
            } else if (e.key === '') {
                const c = ensureColl(data, e.in);
                if (next === undefined) delete c[e.id]; else c[e.id] = next;
            } else {
                const r = rec as Record<string, unknown>;
                if (next === undefined) delete r[e.key]; else r[e.key] = next;
            }
        }
        if (picture) kept.push({ id: u.id, what: 'picture', at: '', ...(u.person ? { person: u.person } : {}) });
        else if (ctx.conflict && !ctx.force) kept.push({ id: u.id, what: 'edited', at: '', ...(u.person ? { person: u.person } : {}) });
        else items.push(u.id);
    };
    const editUnits = open.filter(x => x.edits.length && x.kind !== 'data');
    for (const u of editUnits.filter(chosen)) revertUnit(u);

    // Sources and files: removed, unless what stays still cites them.
    removeRecords(data, gone);
    const cited = citedSources(data);
    const srcGone: Gone = { persons: new Set(), unions: new Set(), sources: new Set(), media: new Set() };
    for (const u of open.filter(x => x.kind === 'source' && chosen(x))) {
        if (!data.sources?.[u.ref]) { items.push(u.id); continue; }
        if (cited.has(u.ref) && !forced.has(u.id)) { kept.push({ id: u.id, what: 'used', at: '' }); continue; }
        srcGone.sources.add(u.ref);
        items.push(u.id);
    }
    const ourUnions = new Set<string>(record.partnerships);
    const ourSources = new Set<string>(record.sources);
    for (const u of open.filter(x => x.kind === 'media' && chosen(x))) {
        const att = data.media?.[u.ref];
        if (!att) { items.push(u.id); continue; }
        const used = (att.places ?? []).some(pl =>
            ('personId' in pl && !!data.persons[pl.personId] && (held.has(pl.personId) || !touched.has(pl.personId)))
            || ('partnershipId' in pl && !!data.partnerships[pl.partnershipId] && (keptUnions.has(pl.partnershipId) || !ourUnions.has(pl.partnershipId)))
            || ('sourceId' in pl && !!data.sources?.[pl.sourceId] && !ourSources.has(pl.sourceId) && !srcGone.sources.has(pl.sourceId)));
        if (used && !forced.has(u.id)) { kept.push({ id: u.id, what: 'used', at: '' }); continue; }
        srcGone.media.add(u.ref);
        items.push(u.id);
    }
    removeRecords(data, srcGone);
    for (const u of open.filter(x => x.kind === 'place' && chosen(x))) {
        if (data.places) delete data.places[u.ref];
        items.push(u.id);
    }

    // The tree's own lists: with everything else (or chosen as such).
    const dataUnit = open.find(x => x.kind === 'data');
    if (dataUnit) {
        const now = new Set([...done, ...items]);
        const rest = units.filter(u => u.kind !== 'data').every(u => now.has(u.id));
        if (!only || only.has('d:') || rest) revertUnit(dataUnit);
    }
    // A collection the undo emptied goes (the record does not say whether the tree had it empty before).
    for (const name of ['sources', 'media', 'places', 'placeRecords', 'placeRefs', 'placeAliases'] as const) {
        const now = collOf(data, name);
        const was = collOf(current, name);
        if (now && Object.keys(now).length === 0 && was && Object.keys(was).length > 0) delete (data as unknown as Record<string, unknown>)[name];
    }
    return { data, kept, items };
}

/**
 * What undoing merge `record` takes back of the tree as it is now (K8.2),
 * what of it changed since (K8.3) and the later merges standing on it (K8.4).
 * `allMerges`: the tree's records (default: `current.merges`).
 */
export function undoPreview(record: MergeRecord, current: StromData, allMerges?: readonly MergeRecord[]): UndoPreview {
    const all = allMerges ?? current.merges ?? [];
    const done = undoneItems(record);
    const units = unitsOf(record).filter(u => !done.has(u.id));
    const exists = (u: Unit): boolean => {
        switch (u.kind) {
            case 'person': return !!current.persons[u.ref as PersonId];
            case 'partnership': return !!current.partnerships[u.ref as PartnershipId];
            case 'source': return !!current.sources?.[u.ref];
            case 'place': return !!current.places?.[u.ref];
            case 'media': return !!current.media?.[u.ref];
            default: return true;
        }
    };
    const item = (u: Unit): UndoItem => ({ id: u.id, kind: u.kind, ref: u.ref, ...(u.field ? { field: u.field } : {}) });
    const remove = units.filter(u => ['person', 'partnership', 'source', 'place', 'media'].includes(u.kind) && exists(u)).map(item);
    const restore = units.filter(u => u.kind === 'record' && changes(u, current)).map(item);
    const unjoin: UnjoinItem[] = [];
    for (const [t] of record.joined) {
        const own = units.filter(u => u.person === t && (u.kind === 'field' || u.kind === 'joined') && changes(u, current));
        if (!own.length || unjoin.some(j => j.ref === t)) continue;
        unjoin.push({ id: `j:${t}`, kind: 'joined', ref: t, fields: own.filter(u => u.kind === 'field').map(u => u.id) });
    }
    const { kept } = run(record, { ...current, merges: [...all] }, {});
    return { remove, restore, unjoin, changedSince: kept, dependents: laterOn(record, current, all).map(l => l.merge) };
}

/**
 * What undoing merge `record` with `choices` would do, the tree not changed
 * (the same run as applyUndo, for the undo dialog to say what the write
 * does, 10b): the items it takes back and what stays. An item of changes
 * counts only when the undo changes a value of it (a list that keeps only a
 * kept person's link, as it was, does not).
 */
export function undoOutcome(record: MergeRecord, current: StromData, choices: Omit<UndoChoices, 'at'> = {}): { items: Set<string>; kept: ChangedSince[] } {
    const { data, kept, items } = run(record, current, choices);
    const units = new Map(unitsOf(record).map(u => [u.id, u]));
    const changed = (u: Unit): boolean => u.edits.some(e => valueKey(valueIn(current, e)) !== valueKey(valueIn(data, e)));
    return {
        items: new Set(items.filter(id => {
            const u = units.get(id);
            return !u || !u.edits.length || u.kind === 'data' || changed(u);
        })),
        kept,
    };
}

/** The unit still has something to take back (a value not as before). */
function changes(u: Unit, current: StromData): boolean {
    return u.edits.some(e => {
        if (e.in !== '' && e.key !== '' && !isPlain(collOf(current, e.in)?.[e.id])) return false;
        return valueKey(valueIn(current, e)) !== valueKey(e.before);
    });
}

/**
 * Undo merge `record` (whole, or the items `choices.only`, K8.1) on the tree
 * as it is now. What changed since stays unless chosen (`choices.undo`,
 * K8.3). The record in the result's `merges` says what was undone, `undone`
 * when nothing of the merge is left, else `partial` (K8.4). Nothing else of
 * the tree changes; its research link and its persons' stay (K9.1).
 */
export function applyUndo(record: MergeRecord, current: StromData, choices: UndoChoices = {}): UndoResult {
    const { data, kept, items } = run(record, current, choices);
    const at = choices.at ?? new Date().toISOString();
    const next: MergeRecord = structuredClone(record);
    if (items.length) next.undone = [...(next.undone ?? []), { at, items }];
    const done = undoneItems(next);
    const all = undoItems(record);
    next.state = all.every(id => done.has(id)) ? 'undone' : done.size ? 'partial' : record.state;
    const list = data.merges ?? [];
    const i = list.findIndex(r => r.id === record.id);
    data.merges = i >= 0 ? list.map((r, j) => j === i ? next : r) : [...list, next];
    return { data, kept, record: next, items };
}

/**
 * Undo the undo (K8.4): the tree as it was before it, which the caller kept
 * (the open tree's Undo, or the backup taken before the undo, write.ts
 * writeUndo). The record as that tree has it.
 */
export function redo(record: MergeRecord, before: StromData): { data: StromData; record: MergeRecord } {
    const data = structuredClone(before);
    return { data, record: data.merges?.find(r => r.id === record.id) ?? structuredClone(record) };
}

/**
 * The step for the research when the merge was sent to it (K9.3): the
 * research does not remove persons on its own, its own undo of that input
 * does (`strom sync undo I0412`, strom-research src/commands/sync.ts). The
 * input is the number of the research's input the send became (`/status`
 * `sends[].input`, recorded as `record.sentToResearch`). Null when the merge
 * was not sent.
 */
export function undoResearchStep(record: MergeRecord): { command: string } | null {
    const input = record.sentToResearch?.trim() ?? '';
    return /^I\d+$/.test(input) ? { command: `strom sync undo ${input}` } : null;
}
