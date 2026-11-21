/**
 * The window's selection of people (spec 098 §0.1): what a selection is and
 * its text form. No imports beyond types, so the settings can read it.
 * Re-exported by src/view-selection.ts.
 */

import type { PersonId } from './types.js';
import type { RodId } from './lineage.js';

export type SelectionRef =
    | { kind: 'rod'; rodId: RodId }
    | { kind: 'ancestors'; personId: PersonId; generations?: number }   // undefined = all
    | { kind: 'descendants'; personId: PersonId; generations?: number }
    | { kind: 'line'; directionId: string }
    | { kind: 'list'; listId: string };

export type SelectionKind = SelectionRef['kind'];

export interface WindowSelection {
    /** null = no selection (the whole tree). */
    ref: SelectionRef | null;
    /** "Hide others" (§8): only meaningful with a ref. */
    hideOthers: boolean;
}

/** Why a selection is gone (the toast of §7). */
export type GoneReason = 'list' | 'rod' | 'line' | 'person';

/** A selection's name for the toolbar, the pill and the map's scope: "Ancestors:" + "Anna Nováková". */
export interface SelectionLabel {
    prefix: string;
    name: string;
}

const KIND_CODE: Record<SelectionKind, string> = { rod: 'rod', ancestors: 'anc', descendants: 'des', line: 'line', list: 'list' };
const CODE_KIND: Record<string, SelectionKind> = { rod: 'rod', anc: 'ancestors', des: 'descendants', line: 'line', list: 'list' };

/** A valid generation limit (1 and more, whole), else undefined (= all). */
export function generationsOf(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;
}

/** "rod:<id>", "anc:<person>[:<generations>]", "des:…", "line:<id>", "list:<id>" (ids URI-encoded). */
export function encodeSelectionRef(ref: SelectionRef): string {
    const code = KIND_CODE[ref.kind];
    switch (ref.kind) {
        case 'rod': return `${code}:${encodeURIComponent(ref.rodId)}`;
        case 'ancestors':
        case 'descendants': {
            const g = generationsOf(ref.generations);
            return `${code}:${encodeURIComponent(ref.personId)}${g ? `:${g}` : ''}`;
        }
        case 'line': return `${code}:${encodeURIComponent(ref.directionId)}`;
        case 'list': return `${code}:${encodeURIComponent(ref.listId)}`;
    }
}

/** The ref of encodeSelectionRef; null for anything else. */
export function decodeSelectionRef(text: string | null | undefined): SelectionRef | null {
    if (!text) return null;
    const parts = text.split(':');
    const kind = CODE_KIND[parts[0]];
    if (!kind || parts.length < 2 || !parts[1]) return null;
    let id: string;
    try { id = decodeURIComponent(parts[1]); } catch { return null; }
    if (!id) return null;
    switch (kind) {
        case 'rod': return parts.length === 2 ? { kind, rodId: id as RodId } : null;
        case 'ancestors':
        case 'descendants': {
            if (parts.length > 3) return null;
            if (parts.length === 2) return { kind, personId: id as PersonId };
            const g = generationsOf(Number(parts[2]));
            return g ? { kind, personId: id as PersonId, generations: g } : null;
        }
        case 'line': return parts.length === 2 ? { kind, directionId: id } : null;
        case 'list': return parts.length === 2 ? { kind, listId: id } : null;
    }
}

/** A ref read from storage, checked (null when it is not one). */
export function sanitizeSelectionRef(raw: unknown): SelectionRef | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    switch (r.kind) {
        case 'rod': { const id = str(r.rodId); return id ? { kind: 'rod', rodId: id as RodId } : null; }
        case 'ancestors':
        case 'descendants': {
            const id = str(r.personId);
            if (!id) return null;
            const g = generationsOf(r.generations);
            return { kind: r.kind, personId: id as PersonId, ...(g ? { generations: g } : {}) };
        }
        case 'line': { const id = str(r.directionId); return id ? { kind: 'line', directionId: id } : null; }
        case 'list': { const id = str(r.listId); return id ? { kind: 'list', listId: id } : null; }
        default: return null;
    }
}

export function sameSelectionRef(a: SelectionRef | null, b: SelectionRef | null): boolean {
    if (!a || !b) return a === b;
    return encodeSelectionRef(a) === encodeSelectionRef(b);
}
