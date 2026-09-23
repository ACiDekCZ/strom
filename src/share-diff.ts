/**
 * Change packets: a small JSON diff of a tree against a shared baseline, so a
 * collaborator can send back only what changed (kilobytes) instead of the whole
 * file. Pure — no DOM, no storage. The recipient reconstructs the full "incoming"
 * tree (baseline + packet) and feeds it to the unchanged merge engine.
 *
 * added/changed carry WHOLE objects; removed carries only ids. Photos and
 * attachments ride along inside the objects, which is fine because typically
 * only a few people change. Each changed object also travels in its BASELINE
 * form (`changedBase`), so the recipient can tell what the sender actually
 * edited from what merely was never shared: the baseline is a privacy- and
 * content-filtered copy (no citations, maybe no photos), and a whole-object
 * replace would wipe exactly those fields — plus every local edit made since.
 * The Accept path therefore applies per field, three-way (baseline × packet ×
 * current); see applyPacketOntoData.
 *
 * Tree-level registries travel too (v2): a relative who geocodes a place or
 * groups two surname spellings has curated real data that must not be lost on
 * the send-back path. Places are a plain key→value map (diffed by key, mirroring
 * how persons are added/changed/removed); surname groups are unioned on apply
 * via addSurnameGroup, which keeps transitivity. Focus fields and the data
 * version are deliberately NOT carried — the recipient's merge starts fresh and
 * re-stamps the version, exactly as executeMerge/migrateData do. If you add a
 * new StromData registry, decide here whether it belongs in the packet.
 */

import { StromData, Person, Partnership, Source, PlaceGeo, PersonId, PartnershipId, STROM_DATA_VERSION } from './types.js';
import { addSurnameGroup } from './surnames.js';

export interface EntityChanges<T> {
    added: T[];
    changed: T[];
    removedIds: string[];
    /**
     * The baseline version of every object in `changed` (same ids). Optional:
     * packets from older apps lack it, and the recipient then falls back to its
     * own stored baseline or a conservative, never-deleting apply.
     */
    changedBase?: T[];
}

/** Keyed map changes (places): whole entries to set, plus keys to remove. */
export interface KeyedChanges<T> {
    changed: Record<string, T>;
    removedKeys: string[];
}

export interface ChangePacket {
    kind: 'strom-changes';
    /** 1 = original (persons/partnerships/sources only); 2 = adds places + surnameVariants. */
    formatVersion: 1 | 2;
    baseExportId: string;
    senderName?: string;
    senderMessage?: string;
    treeName?: string;
    persons: EntityChanges<Person>;
    partnerships: EntityChanges<Partnership>;
    sources: EntityChanges<Source>;
    /** Place coordinates the sender added/changed/removed since the baseline. */
    places?: KeyedChanges<PlaceGeo>;
    /** Surname-equivalence groups the sender added since the baseline (unioned on apply). */
    surnameVariants?: string[][];
}

export interface ChangePacketMeta {
    baseExportId: string;
    senderName?: string;
    senderMessage?: string;
    treeName?: string;
}

/** Deterministic JSON with recursively sorted keys — for deep-equality checks. */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function diffCollection<T extends { id: string }>(
    base: Record<string, T>, current: Record<string, T>
): EntityChanges<T> {
    const added: T[] = [], changed: T[] = [], changedBase: T[] = [], removedIds: string[] = [];
    for (const id of Object.keys(current)) {
        if (!(id in base)) added.push(current[id]);
        else if (stableStringify(current[id]) !== stableStringify(base[id])) {
            changed.push(current[id]);
            changedBase.push(base[id]);
        }
    }
    for (const id of Object.keys(base)) {
        if (!(id in current)) removedIds.push(id);
    }
    return { added, changed, removedIds, ...(changed.length > 0 ? { changedBase } : {}) };
}

/** Diff a plain key→value map (places): whole entries to set, plus keys removed. */
function diffKeyed<T>(base: Record<string, T>, current: Record<string, T>): KeyedChanges<T> {
    const changed: Record<string, T> = {};
    const removedKeys: string[] = [];
    for (const key of Object.keys(current)) {
        if (!(key in base) || stableStringify(current[key]) !== stableStringify(base[key])) {
            changed[key] = current[key];
        }
    }
    for (const key of Object.keys(base)) {
        if (!(key in current)) removedKeys.push(key);
    }
    return { changed, removedKeys };
}

/** Order-independent signature of a surname group (for comparing groups). */
function surnameGroupSig(group: string[]): string {
    return [...group].map(n => n.trim().toLowerCase()).sort().join('|');
}

/** Groups in `current` that the baseline did not have (an extended group counts). */
function diffSurnameVariants(base: string[][], current: string[][]): string[][] {
    const baseSigs = new Set(base.map(surnameGroupSig));
    return current.filter(g => g.length >= 2 && !baseSigs.has(surnameGroupSig(g)));
}

/** Build a change packet describing how `current` differs from `base`. */
export function buildChangePacket(base: StromData, current: StromData, meta: ChangePacketMeta): ChangePacket {
    const places = diffKeyed(base.places ?? {}, current.places ?? {});
    const surnameVariants = diffSurnameVariants(base.surnameVariants ?? [], current.surnameVariants ?? []);
    // Only stamp v2 (and carry the registries) when there is something to carry,
    // so a plain person-only packet stays v1 and still applies in older apps.
    const hasRegistryChanges =
        Object.keys(places.changed).length > 0 || places.removedKeys.length > 0 || surnameVariants.length > 0;
    return {
        kind: 'strom-changes',
        formatVersion: hasRegistryChanges ? 2 : 1,
        baseExportId: meta.baseExportId,
        ...(meta.senderName ? { senderName: meta.senderName } : {}),
        ...(meta.senderMessage ? { senderMessage: meta.senderMessage } : {}),
        ...(meta.treeName ? { treeName: meta.treeName } : {}),
        persons: diffCollection(base.persons as Record<string, Person>, current.persons as Record<string, Person>),
        partnerships: diffCollection(base.partnerships as Record<string, Partnership>, current.partnerships as Record<string, Partnership>),
        sources: diffCollection(base.sources ?? {}, current.sources ?? {}),
        ...(hasRegistryChanges ? { places, surnameVariants } : {}),
    };
}

function applyChanges<T extends { id: string }>(
    base: Record<string, T>, changes: EntityChanges<T>
): Record<string, T> {
    const out: Record<string, T> = { ...base };
    for (const id of changes.removedIds) delete out[id];
    for (const obj of changes.added) out[obj.id] = obj;
    for (const obj of changes.changed) out[obj.id] = obj;
    return out;
}

/** Reconstruct the full "incoming" tree by applying a packet onto its baseline. */
export function applyChangePacket(base: StromData, packet: ChangePacket): StromData {
    const out: StromData = {
        version: STROM_DATA_VERSION,
        persons: applyChanges(base.persons as Record<string, Person>, packet.persons) as Record<PersonId, Person>,
        partnerships: applyChanges(base.partnerships as Record<string, Partnership>, packet.partnerships) as Record<PartnershipId, Partnership>,
        sources: applyChanges(base.sources ?? {}, packet.sources),
    };

    // Places (keyed): start from the baseline, set/remove what the packet carries.
    if (packet.places || base.places) {
        const places: Record<string, PlaceGeo> = { ...(base.places ?? {}) };
        for (const [key, geo] of Object.entries(packet.places?.changed ?? {})) places[key] = geo;
        for (const key of packet.places?.removedKeys ?? []) delete places[key];
        if (Object.keys(places).length > 0) out.places = places;
    }

    // Surname groups: union the baseline's groups with the packet's, letting
    // addSurnameGroup merge overlapping ones so transitivity holds.
    if (base.surnameVariants?.length || packet.surnameVariants?.length) {
        const acc: StromData = {
            persons: {}, partnerships: {},
            surnameVariants: base.surnameVariants ? structuredClone(base.surnameVariants) : [],
        };
        for (const group of packet.surnameVariants ?? []) {
            acc.surnameVariants = addSurnameGroup(acc, group);
        }
        if (acc.surnameVariants && acc.surnameVariants.length > 0) out.surnameVariants = acc.surnameVariants;
    }

    return out;
}

/** Type guard: does this parsed JSON look like a change packet? */
export function isChangePacket(json: unknown): json is ChangePacket {
    if (!json || typeof json !== 'object') return false;
    const p = json as Partial<ChangePacket>;
    // Accept both v1 (person-only) and v2 (with places/surnameVariants) packets.
    return p.kind === 'strom-changes'
        && (p.formatVersion === 1 || p.formatVersion === 2)
        && typeof p.baseExportId === 'string';
}

/** True when a packet carries no actual changes (all collections empty). */
export function isEmptyPacket(packet: ChangePacket): boolean {
    const empty = (c: EntityChanges<unknown>) => c.added.length === 0 && c.changed.length === 0 && c.removedIds.length === 0;
    const placesEmpty = !packet.places
        || (Object.keys(packet.places.changed).length === 0 && packet.places.removedKeys.length === 0);
    const surnamesEmpty = !packet.surnameVariants || packet.surnameVariants.length === 0;
    return empty(packet.persons) && empty(packet.partnerships) && empty(packet.sources)
        && placesEmpty && surnamesEmpty;
}

// ==================== RECIPIENT-SIDE SUMMARY & DIRECT APPLY ====================
//
// The preview and the "Accept" path work against the recipient's CURRENT tree,
// not the baseline: what the recipient actually gains depends on what they
// already have. A packet re-opened after it was accepted therefore summarises
// as empty (hasEffect === false) — honest idempotence.

/** One modified person, with the human field labels that changed. */
export interface ModifiedPersonSummary {
    id: string;
    name: string;
    /** Keys into strings.labels, plus the sentinel 'fieldOther'. */
    changedFieldKeys: string[];
}

/** What a change packet would actually do to a given tree (for the preview). */
export interface PacketSummary {
    newPersons: { id: string; name: string }[];
    modifiedPersons: ModifiedPersonSummary[];
    removedPersonCount: number;
    newPartnershipCount: number;
    modifiedPartnershipCount: number;
    removedPartnershipCount: number;
    sourceChangeCount: number;
    /** Persons (new or updated) that gain a photo or an attachment. */
    mediaCount: number;
    placeCount: number;
    surnameGroupCount: number;
    hasEffect: boolean;
}

/** Person scalar fields shown by name in the preview (mapped to strings.labels). */
const PREVIEW_FIELD_KEYS: (keyof Person)[] = [
    'firstName', 'lastName', 'gender', 'birthDate', 'birthPlace',
    'deathDate', 'deathPlace', 'notes', 'photo', 'refn', 'question',
];

function personLabel(p: Person): string {
    const name = `${p.firstName} ${p.lastName}`.trim();
    const year = p.birthDate?.split('-')[0] || '';
    return year ? `${name} (*${year})` : name;
}

/** True when `after` carries a photo or attachment that `before` did not. */
function gainedMedia(before: Person | undefined, after: Person): boolean {
    if (after.photo && after.photo !== before?.photo) return true;
    return (after.attachments?.length ?? 0) > (before?.attachments?.length ?? 0);
}

/** Which named fields (plus a generic 'fieldOther') differ between two persons. */
function diffPersonFields(before: Person, after: Person): string[] {
    const keys: string[] = [];
    for (const f of PREVIEW_FIELD_KEYS) {
        if (stableStringify(before[f]) !== stableStringify(after[f])) keys.push(f);
    }
    // Anything else (relations, events, attachments, sources, name variants…)
    // rolls up into one honest "other details" marker.
    const strip = (p: Person) => {
        const c = { ...p } as Record<string, unknown>;
        for (const f of PREVIEW_FIELD_KEYS) delete c[f as string];
        return stableStringify(c);
    };
    if (strip(before) !== strip(after)) keys.push('fieldOther');
    return keys;
}

/**
 * Summarise a packet's effect on `current` (drives the preview + idempotence).
 * Computed from the real Accept result, so the preview says exactly what
 * Accept would do — including fields the packet cannot touch (never shared)
 * staying as they are. `base` is the recipient's stored baseline, if any.
 */
export function summarizeChangePacket(current: StromData, packet: ChangePacket, base?: StromData | null): PacketSummary {
    const after = applyPacketOntoData(current, packet, base);
    const curPersons = current.persons as Record<string, Person>;
    const newPersons: { id: string; name: string }[] = [];
    const modifiedPersons: ModifiedPersonSummary[] = [];
    let mediaCount = 0;
    for (const p of Object.values(after.persons as Record<string, Person>)) {
        const before = curPersons[p.id];
        if (!before) {
            newPersons.push({ id: p.id, name: personLabel(p) });
            if (gainedMedia(undefined, p)) mediaCount++;
        } else if (stableStringify(before) !== stableStringify(p)) {
            modifiedPersons.push({ id: p.id, name: personLabel(p), changedFieldKeys: diffPersonFields(before, p) });
            if (gainedMedia(before, p)) mediaCount++;
        }
    }
    const removedPersonCount = Object.keys(curPersons).filter(id => !(id in after.persons)).length;

    const curPart = current.partnerships as Record<string, Partnership>;
    const afterPart = after.partnerships as Record<string, Partnership>;
    let newPartnershipCount = 0, modifiedPartnershipCount = 0;
    for (const x of Object.values(afterPart)) {
        const before = curPart[x.id];
        if (!before) newPartnershipCount++;
        else if (stableStringify(before) !== stableStringify(x)) modifiedPartnershipCount++;
    }
    const removedPartnershipCount = Object.keys(curPart).filter(id => !(id in afterPart)).length;

    const curSrc = current.sources ?? {};
    const afterSrc = after.sources ?? {};
    let sourceChangeCount = 0;
    for (const x of Object.values(afterSrc)) {
        const before = curSrc[x.id];
        if (!before || stableStringify(before) !== stableStringify(x)) sourceChangeCount++;
    }
    sourceChangeCount += Object.keys(curSrc).filter(id => !(id in afterSrc)).length;

    let placeCount = 0;
    const curPlaces = current.places ?? {};
    if (packet.places) {
        for (const [k, v] of Object.entries(packet.places.changed)) {
            if (stableStringify(curPlaces[k]) !== stableStringify(v)) placeCount++;
        }
        placeCount += packet.places.removedKeys.filter(k => k in curPlaces).length;
    }

    const surnameGroupCount = diffSurnameVariants(current.surnameVariants ?? [], packet.surnameVariants ?? []).length;

    const hasEffect = newPersons.length > 0 || modifiedPersons.length > 0 || removedPersonCount > 0
        || newPartnershipCount > 0 || modifiedPartnershipCount > 0 || removedPartnershipCount > 0
        || sourceChangeCount > 0 || placeCount > 0 || surnameGroupCount > 0;

    return {
        newPersons, modifiedPersons, removedPersonCount,
        newPartnershipCount, modifiedPartnershipCount, removedPartnershipCount,
        sourceChangeCount, mediaCount, placeCount, surnameGroupCount, hasEffect,
    };
}

/**
 * Apply a packet straight onto an existing tree (the "Accept" path), preserving
 * every field the packet does not touch (version, focus, etc.). Unlike
 * applyChangePacket — which reconstructs an incoming tree from the baseline for
 * the merge engine — this mutates the recipient's own tree in place.
 *
 * Three-way, per field: only what differs between the packet object and its
 * baseline version is applied onto the CURRENT object. A field the baseline
 * never carried (filtered out for privacy or content) is therefore never
 * cleared, and a local edit to a field the sender did not touch survives.
 * Id lists (relations, citations, name variants) apply as set operations —
 * what the sender added or removed relative to the baseline — and lists of
 * records with ids (events, attachments, witnesses) per record. Relationship
 * symmetry is re-established afterwards.
 *
 * The baseline version comes from `base` (the recipient's stored baseline)
 * or from the packet's own `changedBase`. Without either, the apply is
 * conservative: fields the packet holds overwrite, nothing is ever deleted
 * and id lists only grow.
 */
export function applyPacketOntoData(current: StromData, packet: ChangePacket, base?: StromData | null): StromData {
    const out: StromData = structuredClone(current);
    out.persons = applyThreeWay(
        out.persons as Record<string, Person>, packet.persons,
        (base?.persons ?? undefined) as Record<string, Person> | undefined,
    ) as Record<PersonId, Person>;
    out.partnerships = applyThreeWay(
        out.partnerships as Record<string, Partnership>, packet.partnerships,
        (base?.partnerships ?? undefined) as Record<string, Partnership> | undefined,
    ) as Record<PartnershipId, Partnership>;
    const sources = applyThreeWay(out.sources ?? {}, packet.sources, base?.sources ?? undefined);
    if (Object.keys(sources).length > 0 || out.sources) out.sources = sources;

    if (packet.places) {
        const places: Record<string, PlaceGeo> = { ...(out.places ?? {}) };
        for (const [key, geo] of Object.entries(packet.places.changed)) places[key] = geo;
        for (const key of packet.places.removedKeys) delete places[key];
        out.places = Object.keys(places).length > 0 ? places : undefined;
    }

    if (packet.surnameVariants?.length) {
        const acc: StromData = {
            persons: {}, partnerships: {},
            surnameVariants: out.surnameVariants ? structuredClone(out.surnameVariants) : [],
        };
        for (const group of packet.surnameVariants) acc.surnameVariants = addSurnameGroup(acc, group);
        if (acc.surnameVariants && acc.surnameVariants.length > 0) out.surnameVariants = acc.surnameVariants;
    }

    reconcileRelations(out);
    return out;
}

// ---- three-way helpers ----

/** Fields holding lists of ids / plain strings: applied as set add/remove. */
const ID_LIST_FIELDS = new Set(['parentIds', 'childIds', 'partnerships', 'sourceIds', 'nameVariants']);
/** Fields holding lists of records with their own id: applied per record. */
const RECORD_LIST_FIELDS = new Set(['events', 'attachments', 'participants']);
/** Plain maps (parentRelTypes): applied per key. */
const MAP_FIELDS = new Set(['parentRelTypes']);

type Obj = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

function applyThreeWay<T extends { id: string }>(
    current: Record<string, T>,
    changes: EntityChanges<T>,
    base: Record<string, T> | undefined,
): Record<string, T> {
    const out: Record<string, T> = { ...current };
    for (const id of changes.removedIds) delete out[id];

    const packetBase = new Map<string, T>((changes.changedBase ?? []).map(o => [o.id, o] as const));
    const baseOf = (id: string): T | undefined => base?.[id] ?? packetBase.get(id);

    for (const obj of changes.added) {
        const cur = out[obj.id];
        // A new object; if it is already here the packet was applied before.
        out[obj.id] = cur ? mergeObject(cur, obj, undefined) : structuredClone(obj);
    }
    for (const obj of changes.changed) {
        const cur = out[obj.id];
        // Deleted locally since sharing: the sender's edit brings it back whole.
        out[obj.id] = cur ? mergeObject(cur, obj, baseOf(obj.id)) : structuredClone(obj);
    }
    return out;
}

/** Apply the sender's edits (theirs vs base) onto a clone of `cur`. */
function mergeObject<T>(cur: T, theirs: T, base: T | undefined): T {
    const result = structuredClone(cur) as unknown as Obj;
    const t = theirs as unknown as Obj;
    const b = base as unknown as Obj | undefined;
    const keys = new Set([...Object.keys(t), ...Object.keys(b ?? {})]);
    keys.delete('id');
    for (const key of keys) {
        const tv = t[key];
        if (b) {
            const bv = b[key];
            if (same(tv, bv)) continue;                  // the sender did not touch it
            if (ID_LIST_FIELDS.has(key)) result[key] = applyIdList(result[key], tv, bv);
            else if (RECORD_LIST_FIELDS.has(key)) result[key] = applyRecordList(result[key], tv, bv);
            else if (MAP_FIELDS.has(key)) result[key] = applyMap(result[key], tv, bv);
            else if (tv === undefined) delete result[key];
            else result[key] = structuredClone(tv);
        } else {
            // No baseline: never delete, lists only grow.
            if (tv === undefined || same(tv, result[key])) continue;
            if (ID_LIST_FIELDS.has(key)) result[key] = applyIdList(result[key], tv, []);
            else if (RECORD_LIST_FIELDS.has(key)) result[key] = applyRecordList(result[key], tv, []);
            else if (MAP_FIELDS.has(key)) result[key] = applyMap(result[key], tv, {});
            else result[key] = structuredClone(tv);
        }
    }
    for (const key of Object.keys(result)) {
        if (result[key] === undefined) delete result[key];
    }
    return result as unknown as T;
}

/** (current − removed) ∪ added, where added/removed are theirs relative to base. */
function applyIdList(cur: unknown, theirs: unknown, base: unknown): unknown[] | undefined {
    const c = Array.isArray(cur) ? cur : [];
    const t = Array.isArray(theirs) ? theirs : [];
    const b = Array.isArray(base) ? base : [];
    const key = (v: unknown): string => stableStringify(v);
    const tKeys = new Set(t.map(key));
    const bKeys = new Set(b.map(key));
    const removed = new Set(b.filter(v => !tKeys.has(key(v))).map(key));
    const out = c.filter(v => !removed.has(key(v)));
    const have = new Set(out.map(key));
    for (const v of t) {
        if (!bKeys.has(key(v)) && !have.has(key(v))) { out.push(v); have.add(key(v)); }
    }
    return out.length > 0 || Array.isArray(cur) ? out : undefined;
}

/** Per record id: added records appended, removed ones dropped, edited ones replaced. */
function applyRecordList(cur: unknown, theirs: unknown, base: unknown): unknown[] | undefined {
    type Rec = { id?: string };
    const c = (Array.isArray(cur) ? cur : []) as Rec[];
    const t = (Array.isArray(theirs) ? theirs : []) as Rec[];
    const b = (Array.isArray(base) ? base : []) as Rec[];
    const tById = new Map(t.map(r => [r.id, r] as const));
    const bById = new Map(b.map(r => [r.id, r] as const));
    const out: Rec[] = [];
    for (const r of c) {
        const inBase = bById.get(r.id);
        const inTheirs = tById.get(r.id);
        if (inBase && !inTheirs) continue;                              // the sender removed it
        if (inBase && inTheirs && !same(inBase, inTheirs)) {
            out.push(structuredClone(inTheirs));                       // the sender edited it
            continue;
        }
        out.push(r);
    }
    const have = new Set(out.map(r => r.id));
    for (const r of t) {
        if (!bById.has(r.id) && !have.has(r.id)) { out.push(structuredClone(r)); have.add(r.id); }
    }
    return out.length > 0 || Array.isArray(cur) ? out : undefined;
}

/** Per key of a plain map (parentRelTypes). */
function applyMap(cur: unknown, theirs: unknown, base: unknown): Obj | undefined {
    const out: Obj = { ...((cur ?? {}) as Obj) };
    const t = (theirs ?? {}) as Obj;
    const b = (base ?? {}) as Obj;
    for (const key of new Set([...Object.keys(t), ...Object.keys(b)])) {
        if (same(t[key], b[key])) continue;
        if (t[key] === undefined) delete out[key];
        else out[key] = t[key];
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Make every relation mutual again after a per-field apply: dangling ids go,
 * a parent↔child link present on one side is written on the other (a child
 * keeps at most two parents), and each partnership is listed by exactly its
 * two partners.
 */
function reconcileRelations(data: StromData): void {
    const persons = data.persons as Record<string, Person>;
    const partnerships = data.partnerships as Record<string, Partnership>;

    for (const [uid, u] of Object.entries(partnerships)) {
        if (!persons[u.person1Id] || !persons[u.person2Id]) delete partnerships[uid];
    }
    for (const p of Object.values(persons)) {
        p.parentIds = [...new Set(p.parentIds.filter(id => id !== p.id && persons[id]))];
        p.childIds = [...new Set(p.childIds.filter(id => id !== p.id && persons[id]))];
        p.partnerships = [...new Set(p.partnerships.filter(uid => {
            const u = partnerships[uid];
            return !!u && (u.person1Id === p.id || u.person2Id === p.id);
        }))];
    }
    // Child side is the source of truth; a link written only on the parent side
    // is completed when the child still has room for a parent, else dropped.
    for (const parent of Object.values(persons)) {
        for (const cid of [...parent.childIds]) {
            const child = persons[cid];
            if (child.parentIds.includes(parent.id)) continue;
            if (child.parentIds.length < 2) child.parentIds.push(parent.id);
            else parent.childIds = parent.childIds.filter(id => id !== cid);
        }
    }
    for (const child of Object.values(persons)) {
        for (const pid of child.parentIds) {
            const parent = persons[pid];
            if (!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
        }
        if (child.parentRelTypes) {
            for (const key of Object.keys(child.parentRelTypes) as PersonId[]) {
                if (!child.parentIds.includes(key)) delete child.parentRelTypes[key];
            }
            if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
        }
    }
    for (const u of Object.values(partnerships)) {
        for (const pid of [u.person1Id, u.person2Id]) {
            if (!persons[pid].partnerships.includes(u.id)) persons[pid].partnerships.push(u.id);
        }
        // A child the couple lists belongs to both partners (room permitting);
        // a child that no longer names either partner leaves the union.
        u.childIds = [...new Set(u.childIds.filter(cid => {
            const child = persons[cid];
            if (!child) return false;
            for (const pid of [u.person1Id, u.person2Id]) {
                if (!child.parentIds.includes(pid) && child.parentIds.length < 2) {
                    child.parentIds.push(pid);
                    if (!persons[pid].childIds.includes(cid)) persons[pid].childIds.push(cid);
                }
            }
            return child.parentIds.includes(u.person1Id) || child.parentIds.includes(u.person2Id);
        }))];
        for (const part of u.participants ?? []) {
            if (part.personId && !persons[part.personId]) delete part.personId;
        }
    }
    for (const p of Object.values(persons)) {
        for (const ev of p.events ?? []) {
            for (const part of ev.participants ?? []) {
                if (part.personId && !persons[part.personId]) delete part.personId;
            }
        }
    }
}
