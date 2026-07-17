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
