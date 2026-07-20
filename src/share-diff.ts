/**
 * Change packets: a small JSON diff of a tree against a shared baseline, so a
 * collaborator can send back only what changed (kilobytes) instead of the whole
 * file. Pure — no DOM, no storage. The recipient reconstructs the full "incoming"
 * tree (baseline + packet) and feeds it to the unchanged merge engine.
 *
 * added/changed carry WHOLE objects (no per-field patches — simple and robust);
 * removed carries only ids. Photos/attachments ride along inside the objects,
 * which is fine because typically only a few people change.
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
    const added: T[] = [], changed: T[] = [], removedIds: string[] = [];
    for (const id of Object.keys(current)) {
        if (!(id in base)) added.push(current[id]);
        else if (stableStringify(current[id]) !== stableStringify(base[id])) changed.push(current[id]);
    }
    for (const id of Object.keys(base)) {
        if (!(id in current)) removedIds.push(id);
    }
    return { added, changed, removedIds };
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

/** Summarise a packet's effect on `current` (drives the preview + idempotence). */
export function summarizeChangePacket(current: StromData, packet: ChangePacket): PacketSummary {
    const curPersons = current.persons as Record<string, Person>;
    const newPersons: { id: string; name: string }[] = [];
    const modifiedPersons: ModifiedPersonSummary[] = [];
    let mediaCount = 0;
    for (const p of [...packet.persons.added, ...packet.persons.changed]) {
        const before = curPersons[p.id];
        if (!before) {
            newPersons.push({ id: p.id, name: personLabel(p) });
            if (gainedMedia(undefined, p)) mediaCount++;
        } else if (stableStringify(before) !== stableStringify(p)) {
            modifiedPersons.push({ id: p.id, name: personLabel(p), changedFieldKeys: diffPersonFields(before, p) });
            if (gainedMedia(before, p)) mediaCount++;
        }
    }
    const removedPersonCount = packet.persons.removedIds.filter(id => id in curPersons).length;

    const curPart = current.partnerships as Record<string, Partnership>;
    let newPartnershipCount = 0, modifiedPartnershipCount = 0;
    for (const x of [...packet.partnerships.added, ...packet.partnerships.changed]) {
        const before = curPart[x.id];
        if (!before) newPartnershipCount++;
        else if (stableStringify(before) !== stableStringify(x)) modifiedPartnershipCount++;
    }
    const removedPartnershipCount = packet.partnerships.removedIds.filter(id => id in curPart).length;

    const curSrc = current.sources ?? {};
    let sourceChangeCount = 0;
    for (const x of [...packet.sources.added, ...packet.sources.changed]) {
        const before = curSrc[x.id];
        if (!before || stableStringify(before) !== stableStringify(x)) sourceChangeCount++;
    }
    sourceChangeCount += packet.sources.removedIds.filter(id => id in curSrc).length;

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
 */
export function applyPacketOntoData(current: StromData, packet: ChangePacket): StromData {
    const out: StromData = structuredClone(current);
    out.persons = applyChanges(out.persons as Record<string, Person>, packet.persons) as Record<PersonId, Person>;
    out.partnerships = applyChanges(out.partnerships as Record<string, Partnership>, packet.partnerships) as Record<PartnershipId, Partnership>;
    out.sources = applyChanges(out.sources ?? {}, packet.sources);

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

    return out;
}
