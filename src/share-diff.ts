/**
 * Change packets: a small JSON diff of a tree against a shared baseline, so a
 * collaborator can send back only what changed (kilobytes) instead of the whole
 * file. Pure — no DOM, no storage. The recipient reconstructs the full "incoming"
 * tree (baseline + packet) and feeds it to the unchanged merge engine.
 *
 * added/changed carry WHOLE objects (no per-field patches — simple and robust);
 * removed carries only ids. Photos/attachments ride along inside the objects,
 * which is fine because typically only a few people change.
 */

import { StromData, Person, Partnership, Source, PersonId, PartnershipId, STROM_DATA_VERSION } from './types.js';

export interface EntityChanges<T> {
    added: T[];
    changed: T[];
    removedIds: string[];
}

export interface ChangePacket {
    kind: 'strom-changes';
    formatVersion: 1;
    baseExportId: string;
    senderName?: string;
    senderMessage?: string;
    treeName?: string;
    persons: EntityChanges<Person>;
    partnerships: EntityChanges<Partnership>;
    sources: EntityChanges<Source>;
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

/** Build a change packet describing how `current` differs from `base`. */
export function buildChangePacket(base: StromData, current: StromData, meta: ChangePacketMeta): ChangePacket {
    return {
        kind: 'strom-changes',
        formatVersion: 1,
        baseExportId: meta.baseExportId,
        ...(meta.senderName ? { senderName: meta.senderName } : {}),
        ...(meta.senderMessage ? { senderMessage: meta.senderMessage } : {}),
        ...(meta.treeName ? { treeName: meta.treeName } : {}),
        persons: diffCollection(base.persons as Record<string, Person>, current.persons as Record<string, Person>),
        partnerships: diffCollection(base.partnerships as Record<string, Partnership>, current.partnerships as Record<string, Partnership>),
        sources: diffCollection(base.sources ?? {}, current.sources ?? {}),
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
    return {
        version: STROM_DATA_VERSION,
        persons: applyChanges(base.persons as Record<string, Person>, packet.persons) as Record<PersonId, Person>,
        partnerships: applyChanges(base.partnerships as Record<string, Partnership>, packet.partnerships) as Record<PartnershipId, Partnership>,
        sources: applyChanges(base.sources ?? {}, packet.sources),
    };
}

/** Type guard: does this parsed JSON look like a change packet? */
export function isChangePacket(json: unknown): json is ChangePacket {
    if (!json || typeof json !== 'object') return false;
    const p = json as Partial<ChangePacket>;
    return p.kind === 'strom-changes' && p.formatVersion === 1 && typeof p.baseExportId === 'string';
}

/** True when a packet carries no actual changes (all collections empty). */
export function isEmptyPacket(packet: ChangePacket): boolean {
    const empty = (c: EntityChanges<unknown>) => c.added.length === 0 && c.changed.length === 0 && c.removedIds.length === 0;
    return empty(packet.persons) && empty(packet.partnerships) && empty(packet.sources);
}
