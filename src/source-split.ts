/**
 * Splitting older locations into fields, all sources at once (spec 075 §5).
 *
 * One interface for where the split comes from (`SplitProvider`): the app
 * itself for a tree without a research (`local`, one undo step), the
 * research's bridge for a research tree (`bridge`, GET/POST
 * <token>/sources/split). The dialog, its preview and the offer lines of the
 * Sources manager and the Table read only this interface, never the local
 * computation directly.
 *
 * The local plan applies the same rule as the research (`splitSource` of
 * source-location.ts, the research's splitOf) and moves a note line
 * "Call number: …" an earlier GEDCOM import wrote (in any language the import
 * ran in) to the call number field, when that field is empty.
 */

import type { Source } from './types.js';
import { recognizeLocation, splitSource, withSplit } from './source-location.js';
import { getStringsForLang, SUPPORTED_LANGUAGES } from './strings.js';

/**
 * Where the split comes from, for the dialog and the offer lines:
 * - `local`: a tree without a research, split by the app (one undo step);
 * - `bridge`: a research tree whose running research's bridge offers `sources.split`;
 * - `needsResearch`: a research tree whose research is not running or offers no `sources.split`
 *   (a quiet sentence in the Sources manager, nothing in the Table);
 * - `archive`: a research tree in the archive (nothing offered);
 * - `none`: nothing offered (a read-only or locked tree).
 */
export type SplitSourceKind = 'local' | 'bridge' | 'needsResearch' | 'archive' | 'none';

/** Where an entry stands, as the split preview names it (the app's field names; the bridge's `locator` is `reference`). */
export interface SplitPlace {
    reference?: string;
    folio?: string;
    image?: string;
    callNumber?: string;
}

/** One source the split changes: what it is now, what it would be. */
export interface SplitRow {
    source: string;
    title: string;
    before: SplitPlace;
    after: SplitPlace;
    /** The call number comes from a note line "Call number: …" (local only). */
    callNumberFromNote?: boolean;
}

/** What a split would do. */
export interface SplitPreview {
    /** The sources it changes, in their order: all of them, or the first ones (`complete` false). */
    rows: SplitRow[];
    /** How many sources it changes (also when `rows` holds only the first ones). */
    count: number;
    /** Whether `rows` holds every source the split changes (else "Show all" reads them all). */
    complete: boolean;
    /** Sources with a location in which neither a folio nor an image is recognised: they stay as they are. */
    unrecognized: number;
    /** The first locations not recognised (examples; may be empty). */
    unrecognizedExamples: string[];
    /** How many sources take their call number from a note line (local; 0 through the bridge). */
    fromNote: number;
    /** The bridge's mark of this preview (`plan`), given back when the split is asked for. */
    plan?: string;
}

/** The newest split that can be undone. */
export interface SplitUndoInfo {
    /** The local undo step's or the bridge's undo id. */
    id: string;
    /** When it was done (ms since the epoch). */
    at: number;
    /** How many sources it split. */
    count: number;
}

/** What the dialog and the offer lines show. */
export interface SplitState {
    kind: SplitSourceKind;
    /** The preview (null: not read yet, or nothing offered). */
    preview: SplitPreview | null;
    /** The newest split that can be undone (null: none). */
    undo: SplitUndoInfo | null;
}

/** A reading of the split's state: the state, or why it could not be read. */
export type SplitReadResult =
    | { ok: true; state: SplitState }
    | { ok: false; error: 'busy' | 'archive' | 'failed'; reason?: string };

/** The split done, or why not (`plan`: the sources changed meanwhile, here is the preview as it is now). */
export type SplitApplyResult =
    | { ok: true; count: number; undo: SplitUndoInfo | null }
    | { ok: false; error: 'plan'; preview: SplitPreview }
    | { ok: false; error: 'busy' | 'archive' | 'failed'; reason?: string };

/** The split undone, or why not (`changed`: sources changed after the split, nothing undone). */
export type SplitUndoResult =
    | { ok: true; restored: number }
    | { ok: false; error: 'changed'; count: number; titles: string[] }
    | { ok: false; error: 'busy' | 'failed'; reason?: string };

/** Where the split comes from (the app itself or the research's bridge). */
export interface SplitProvider {
    readonly kind: 'local' | 'bridge';
    /** The state known now, without waiting (the bridge: its cached reading, preview null before the first). */
    state(): SplitState;
    /** Read the state (again); `all`: every row of the preview. */
    read(all?: boolean): Promise<SplitReadResult>;
    /** Do the split the preview shows. */
    apply(preview: SplitPreview): Promise<SplitApplyResult>;
    /** Undo a split. */
    undo(info: SplitUndoInfo): Promise<SplitUndoResult>;
}

// ---- The note line "Call number: …" of an earlier GEDCOM import ----

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

let noteLineRe: RegExp | null = null;

/** A note line the GEDCOM import wrote for REPO > CALN before the call number had a field (any import language). */
function callNumberLineRe(): RegExp {
    if (noteLineRe) return noteLineRe;
    const labels = [...new Set(SUPPORTED_LANGUAGES.map(l => getStringsForLang(l.code).gedcomNotes.sourceCallNumber('').trim()))]
        .filter(Boolean).sort((a, b) => b.length - a.length);
    noteLineRe = new RegExp(`^\\s*(?:${labels.map(escapeRe).join('|')})\\s*(\\S.*?)\\s*$`, 'u');
    return noteLineRe;
}

/**
 * The call number a note line "Call number: …" gives (the first such line)
 * and the note without that line (undefined when nothing is left), or
 * undefined when the note has no such line.
 */
export function noteCallNumber(note: string | undefined): { callNumber: string; note?: string } | undefined {
    if (!note) return undefined;
    const lines = note.split('\n');
    const re = callNumberLineRe();
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) return undefined;
    const callNumber = re.exec(lines[i]!)![1]!;
    lines.splice(i, 1);
    // An empty line the removed one stood between (a paragraph break before it) goes with it.
    if (i > 0 && lines[i - 1]?.trim() === '' && (i >= lines.length || lines[i]?.trim() === '')) lines.splice(i - 1, 1);
    else if (i === 0 && lines[0]?.trim() === '') lines.splice(0, 1);
    const rest = lines.join('\n');
    return { callNumber, ...(rest.trim() ? { note: rest } : {}) };
}

// ---- The local plan ----

const has = (v: string | undefined): boolean => !!v?.trim();

function placeOf(s: Pick<Source, 'reference' | 'folio' | 'image' | 'callNumber'>): SplitPlace {
    return {
        ...(has(s.reference) ? { reference: s.reference } : {}),
        ...(has(s.folio) ? { folio: s.folio } : {}),
        ...(has(s.image) ? { image: s.image } : {}),
        ...(has(s.callNumber) ? { callNumber: s.callNumber } : {}),
    };
}

/** One source the local split changes: its preview row and the source as it would be. */
export interface LocalSplitChange {
    row: SplitRow;
    source: Source;
}

/** What the local split would do: the sources it changes (their rows and new forms), the ones not recognised. */
export interface LocalSplitPlan {
    changes: LocalSplitChange[];
    unrecognized: number;
    unrecognizedExamples: string[];
    fromNote: number;
}

/** How many locations not recognised the preview names. */
export const SPLIT_UNRECOGNIZED_EXAMPLES = 2;

/**
 * What one source's local split would be, or undefined when it changes
 * nothing: its folio, image and rest of the location (`splitSource`), and the
 * call number of a note line while the field is empty.
 */
export function localSplitOf(s: Source): LocalSplitChange | undefined {
    const place = splitSource(s);
    const fromNote = !has(s.callNumber) ? noteCallNumber(s.note) : undefined;
    if (!place && !fromNote) return undefined;
    let next: Source = place ? withSplit(s, place) : { ...s };
    if (fromNote) {
        next = { ...next, callNumber: fromNote.callNumber };
        if (fromNote.note !== undefined) next.note = fromNote.note;
        else delete next.note;
    }
    return {
        row: { source: s.id, title: s.title, before: placeOf(s), after: placeOf(next), ...(fromNote ? { callNumberFromNote: true } : {}) },
        source: next,
    };
}

/** The local split of all sources (ordered by title, as the Sources manager lists them). */
export function localSplitPlan(sources: readonly Source[]): LocalSplitPlan {
    const changes: LocalSplitChange[] = [];
    let unrecognized = 0;
    const examples: string[] = [];
    let fromNote = 0;
    const sorted = [...sources].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    for (const s of sorted) {
        const change = localSplitOf(s);
        if (change) {
            changes.push(change);
            if (change.row.callNumberFromNote) fromNote++;
            continue;
        }
        if (!has(s.reference)) continue;
        const found = recognizeLocation(s.reference);
        if (found?.folio || found?.image) continue;   // its folio and image are fields already: nothing to take
        unrecognized++;
        if (examples.length < SPLIT_UNRECOGNIZED_EXAMPLES) examples.push(s.reference!.trim());
    }
    return { changes, unrecognized, unrecognizedExamples: examples, fromNote };
}

/** The preview of a local plan (every row). */
export function localSplitPreview(plan: LocalSplitPlan): SplitPreview {
    return {
        rows: plan.changes.map(c => c.row),
        count: plan.changes.length,
        complete: true,
        unrecognized: plan.unrecognized,
        unrecognizedExamples: plan.unrecognizedExamples,
        fromNote: plan.fromNote,
    };
}

/** A short mark of what a preview does (each source, before and after): another plan by then is refused. */
export function splitPreviewMark(rows: readonly SplitRow[]): string {
    return JSON.stringify(rows.map(r => [r.source, r.before, r.after]));
}

// ---- The offer lines ----

/** What the offer line of the Sources manager (`sources`) or the Table (`table`) says. */
export type SplitOffer =
    | { line: 'offer'; count: number }
    | { line: 'needsResearch' }
    | { line: 'done'; undo: SplitUndoInfo }
    | { line: 'hidden' };

/**
 * The offer line for a state: something to split → the offer; a research tree
 * without the bridge's split → a quiet sentence (the Sources manager only,
 * unless its preview — the app's own reading of the copy — finds nothing);
 * nothing to split but a split to undo → the done line (the Sources manager
 * only); else hidden.
 */
export function splitOffer(state: SplitState, where: 'sources' | 'table'): SplitOffer {
    // A research tree's sentence only while its sources hold something to split (as the app's copy reads them).
    if (state.kind === 'needsResearch') return where === 'sources' && (state.preview?.count ?? 1) > 0 ? { line: 'needsResearch' } : { line: 'hidden' };
    if (state.kind !== 'local' && state.kind !== 'bridge') return { line: 'hidden' };
    const count = state.preview?.count ?? 0;
    if (count > 0) return { line: 'offer', count };
    if (where === 'sources' && state.undo) return { line: 'done', undo: state.undo };
    return { line: 'hidden' };
}
