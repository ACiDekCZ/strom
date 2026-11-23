/**
 * The record of a merge (spec 134 §0.3) as the tree keeps it: what the merge
 * changed in the records the tree already had (MergeEdit, key by key), a
 * print of each person it added, and the check of records read from stored
 * data. Pure: no DOM, no storage. Built by applyPlan (plan.ts), read by the
 * undo (undo-plan.ts) and by migrateData (data.ts).
 */

import type { MergeEdit, MergeRecord, Person, PersonId, StromData } from '../types.js';

// ==================== VALUES ====================

/** A picture as a value of the record: its length and a hash, never its data. */
export interface ImageToken { $img: string }

const IMAGE_MIN = 1024;

function imageHash(url: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i += 16) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (let i = Math.max(0, url.length - 64); i < url.length; i++) {
        h ^= url.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${url.length}:${(h >>> 0).toString(36)}`;
}

const isImage = (v: unknown): v is string => typeof v === 'string' && v.length >= IMAGE_MIN && v.startsWith('data:');

function replacer(_key: string, value: unknown): unknown {
    return isImage(value) ? { $img: imageHash(value) } satisfies ImageToken : value;
}

/** A value as the record keeps it: a JSON copy, each picture's data URL a token. Undefined stays undefined. */
export function compactValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value, replacer)) as unknown;
}

/** A value as text to compare by (pictures by their token). */
export function valueKey(value: unknown): string {
    return value === undefined ? '' : JSON.stringify(value, replacer);
}

/** The value holds a picture's token (it cannot be put back without the picture itself). */
export function hasImageToken(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasImageToken);
    if (typeof (value as ImageToken).$img === 'string' && Object.keys(value).length === 1) return true;
    return Object.values(value).some(hasImageToken);
}

function fnv(text: string, seed: number): string {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(36);
}

/**
 * Keys of a person a print leaves out: its relations (a new relative is told
 * apart by the undo on its own) and what the research and the checks of facts
 * write (a send to the research, a record proving a fact, a confirmation —
 * also told apart by the undo, as "proven").
 */
const PRINT_SKIP = new Set([
    'partnerships', 'parentIds', 'childIds', 'parentRelTypes', 'importedParents',
    'research', 'researchOrigins', 'researchVerify', 'confirmed',
    'nameStatus', 'marriedNameStatus', 'birthStatus', 'deathStatus',
]);

/** A short print of a person's own details as they are (what a later edit changes). */
export function personPrint(person: Person): string {
    const own: Record<string, unknown> = {};
    for (const key of Object.keys(person).sort()) {
        if (!PRINT_SKIP.has(key)) own[key] = (person as unknown as Record<string, unknown>)[key];
    }
    const text = JSON.stringify(own, replacer);
    return `${fnv(text, 0x811c9dc5)}${fnv(text, 0x01000193)}`;
}

// ==================== EDITS ====================

/** The collections of records keyed by id whose records a merge may change one key at a time. */
export const RECORD_COLLECTIONS = ['persons', 'partnerships', 'sources', 'media', 'places', 'placeRecords', 'placeRefs', 'placeAliases'] as const;

/** Keys of the data the record never looks at: the version, the history itself, where the work stands. */
const DATA_SKIP = new Set<string>([
    'version', 'merges', 'lastFocusPersonId', 'lastFocusDepthUp', 'lastFocusDepthDown', 'defaultPersonId', 'defaultView',
    ...RECORD_COLLECTIONS,
]);

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What the merge changed in the records the tree had (before → after): a
 * key of a record of a collection, a record it removed (key ''), a key of the
 * data itself (in ''). Records the merge added are not here (the record lists
 * them), except in collections the record does not list (placeRecords,
 * placeRefs, placeAliases: key '' with no before).
 */
export function mergeEdits(before: StromData, after: StromData): MergeEdit[] {
    const out: MergeEdit[] = [];
    const listed = new Set<string>(['persons', 'partnerships', 'sources', 'media', 'places']);
    for (const coll of RECORD_COLLECTIONS) {
        const was = ((before as unknown as Record<string, unknown>)[coll] ?? {}) as Record<string, unknown>;
        const now = ((after as unknown as Record<string, unknown>)[coll] ?? {}) as Record<string, unknown>;
        for (const id of Object.keys(was)) {
            const a = was[id];
            const b = now[id];
            if (b === undefined) {
                out.push({ in: coll, id, key: '', before: compactValue(a) });
                continue;
            }
            if (a === b) continue;
            const ka = valueKey(a);
            const kb = valueKey(b);
            if (ka === kb) continue;
            if (isPlain(a) && isPlain(b)) {
                for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
                    if (valueKey(a[key]) === valueKey(b[key])) continue;
                    out.push({ in: coll, id, key, ...(a[key] !== undefined ? { before: compactValue(a[key]) } : {}), ...(b[key] !== undefined ? { after: compactValue(b[key]) } : {}) });
                }
            } else {
                out.push({ in: coll, id, key: '', before: compactValue(a), after: compactValue(b) });
            }
        }
        if (listed.has(coll)) continue;
        for (const id of Object.keys(now)) {
            if (!(id in was)) out.push({ in: coll, id, key: '', after: compactValue(now[id]) });
        }
    }
    const a = before as unknown as Record<string, unknown>;
    const b = after as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (DATA_SKIP.has(key) || valueKey(a[key]) === valueKey(b[key])) continue;
        out.push({ in: '', id: '', key, ...(a[key] !== undefined ? { before: compactValue(a[key]) } : {}), ...(b[key] !== undefined ? { after: compactValue(b[key]) } : {}) });
    }
    return out;
}

// ==================== STORED RECORDS ====================

const str = (v: unknown): v is string => typeof v === 'string';
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter(str) : [];
const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * The merge records of stored data (StromData.merges), only well-formed ones
 * (written by this app, but by any of its versions, or by a crafted file).
 * Undefined when there are none.
 */
export function sanitizeMergeRecords(value: unknown): MergeRecord[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: MergeRecord[] = [];
    for (const v of value) {
        if (!isPlain(v) || !str(v.id) || !v.id || !str(v.at)) continue;
        const src = isPlain(v.source) ? v.source : {};
        const kinds = ['ged', 'json', 'tree', 'view', 'share'] as const;
        const kind = kinds.find(k => k === src.kind) ?? 'ged';
        const target = isPlain(v.target) ? v.target : {};
        const c = isPlain(v.counts) ? v.counts : {};
        const state = v.state === 'partial' || v.state === 'undone' ? v.state : 'valid';
        const rec: MergeRecord = {
            id: v.id, at: v.at,
            source: {
                kind, label: str(src.label) ? src.label : '', persons: num(src.persons),
                ...(str(src.program) ? { program: src.program } : {}),
                ...(str(src.fileDate) ? { fileDate: src.fileDate } : {}),
                ...(str(src.importId) ? { importId: src.importId } : {}),
                ...(str(src.fingerprint) ? { fingerprint: src.fingerprint } : {}),
                ...(str(src.treeId) ? { treeId: src.treeId as NonNullable<MergeRecord['source']['treeId']> } : {}),
            },
            target: { name: str(target.name) ? target.name : '', newTree: target.newTree === true },
            counts: {
                joined: num(c.joined), added: num(c.added), skipped: num(c.skipped), pending: num(c.pending), total: num(c.total),
                fieldChanges: num(c.fieldChanges), differencesKept: num(c.differencesKept), alongside: num(c.alongside),
                partnerships: num(c.partnerships), links: num(c.links),
            },
            state,
            added: strs(v.added) as PersonId[],
            joined: (Array.isArray(v.joined) ? v.joined : [])
                .filter((j): j is [PersonId, PersonId] => Array.isArray(j) && j.length === 2 && str(j[0]) && str(j[1])),
            fields: (Array.isArray(v.fields) ? v.fields : [])
                .filter((f): f is MergeRecord['fields'][number] => isPlain(f) && str(f.person) && str(f.field) && str(f.before) && str(f.after)),
            partnerships: strs(v.partnerships), sources: strs(v.sources), places: strs(v.places), media: strs(v.media),
        };
        if (Array.isArray(v.edits)) {
            const edits = v.edits.filter((e): e is MergeEdit => isPlain(e) && str(e.in) && str(e.id) && str(e.key));
            if (edits.length) rec.edits = edits;
        }
        if (isPlain(v.prints)) {
            const prints = Object.fromEntries(Object.entries(v.prints).filter((e): e is [string, string] => str(e[1])));
            if (Object.keys(prints).length) rec.prints = prints;
        }
        if (str(v.backupId) && v.backupId) rec.backupId = v.backupId;
        if (str(v.sentToResearch) && v.sentToResearch) rec.sentToResearch = v.sentToResearch;
        if (str(v.sentAt) && v.sentAt) rec.sentAt = v.sentAt;
        if (str(v.sentIntake) && v.sentIntake) rec.sentIntake = v.sentIntake;
        if (Array.isArray(v.undone)) {
            const undone = v.undone.filter((u): u is { at: string; items: string[] } => isPlain(u) && str(u.at) && Array.isArray(u.items))
                .map(u => ({ at: u.at, items: strs(u.items) }));
            if (undone.length) rec.undone = undone;
        }
        out.push(rec);
    }
    return out.length ? out : undefined;
}
