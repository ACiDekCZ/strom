/**
 * Readers for the "Export all" backup formats, so a backup made by the app can
 * be restored by the app (review V5):
 * - JSON: `{ [treeId]: { name, data, auditLog? } }` (optionally encrypted as a whole)
 * - HTML: `window.STROM_EMBEDDED_DATA = {envelope};window.STROM_ALL_TREES = {…};`
 *   in ONE script tag (the all-trees object may be encrypted).
 *
 * The HTML reader does not rely on a regex for the JSON body: it locates the
 * assignment and scans the value with a string-aware balanced-brace scanner,
 * then hands exactly that slice to JSON.parse. That is robust to both
 * assignments sharing a script tag and to however the writer escapes `<`.
 */

import { StromData, AuditLog } from './types.js';
import { EncryptedData, isEncrypted } from './crypto.js';

export interface BackupTreeEntry {
    name: string;
    data: StromData;
    isHidden?: boolean;
    auditLog?: AuditLog;
}

export type BackupTrees = Record<string, BackupTreeEntry>;

/** True for the "Export all" JSON shape `{ treeId: { name, data } }`. */
export function isMultiTreeBackup(value: unknown): value is BackupTrees {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (isEncrypted(value)) return false;
    const obj = value as Record<string, unknown>;
    // A single tree has top-level persons; a backup never does.
    if ('persons' in obj) return false;
    const entries = Object.values(obj);
    if (entries.length === 0) return false;
    return entries.every(e => {
        if (!e || typeof e !== 'object') return false;
        const entry = e as Record<string, unknown>;
        const data = entry.data as Record<string, unknown> | null | undefined;
        return typeof entry.name === 'string'
            && !!data && typeof data === 'object'
            && !!data.persons && typeof data.persons === 'object';
    });
}

/**
 * Return the end index (exclusive) of the JSON object/array starting at
 * `start`, honouring string literals and escapes. -1 when unbalanced.
 */
function scanJsonValue(text: string, start: number): number {
    const open = text[start];
    if (open !== '{' && open !== '[') return -1;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * Parse the value assigned as `window.<name> = …` in an HTML document. Takes
 * the LAST assignment that parses (older builds could leave a stale first
 * copy; the runtime also ends up with the last one). `null` literal → null;
 * no parsable assignment → undefined.
 */
export function readWindowAssignment(html: string, name: string): unknown {
    const needle = `window.${name}`;
    let result: unknown = undefined;
    let from = 0;
    for (;;) {
        const at = html.indexOf(needle, from);
        if (at < 0) break;
        from = at + needle.length;
        let i = from;
        while (i < html.length && /\s/.test(html[i])) i++;
        if (html[i] !== '=' || html[i + 1] === '=') continue;
        i++;
        while (i < html.length && /\s/.test(html[i])) i++;
        if (html.startsWith('null', i)) { result = null; continue; }
        const end = scanJsonValue(html, i);
        if (end < 0) continue;
        try {
            result = JSON.parse(html.slice(i, end));
        } catch {
            // Not JSON (e.g. the app's own source code) — keep looking.
        }
    }
    return result;
}

export interface EmbeddedHtmlContent {
    /** The single-tree envelope (its `data` may be encrypted). */
    envelope: { data?: unknown; treeName?: string; exportId?: string; [k: string]: unknown } | null;
    /** "Export all" trees, plain or encrypted; null for single-tree files. */
    allTrees: BackupTrees | EncryptedData | null;
}

/** Read both embedded payloads of an exported Strom HTML file. */
export function readEmbeddedHtml(html: string): EmbeddedHtmlContent {
    const env = readWindowAssignment(html, 'STROM_EMBEDDED_DATA');
    const all = readWindowAssignment(html, 'STROM_ALL_TREES');
    const envelope = env && typeof env === 'object' && !Array.isArray(env)
        ? env as EmbeddedHtmlContent['envelope']
        : null;
    let allTrees: EmbeddedHtmlContent['allTrees'] = null;
    if (isEncrypted(all)) allTrees = all;
    else if (isMultiTreeBackup(all)) allTrees = all;
    return { envelope, allTrees };
}
