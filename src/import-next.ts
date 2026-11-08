/**
 * The "What next" card after a GEDCOM import from another program (spec 066
 * K4.1, K1.3): which rows it shows and the texts they need. The DOM side is
 * src/ui/import-next-ui.ts.
 *
 * The card belongs to one import record (StromData.imports): a file another
 * program wrote. Strom's own GEDCOM export (HEAD `1 SOUR STROM`) makes no
 * record, so it never gets the card; neither does a JSON import. Closing the
 * card sets `nextCardClosed` on the record: never again for that import.
 */

import type { ImportRecord, StromData } from './types.js';
import { parseGedcomDate } from './gedcom-date-read.js';
import { formatFlexDate } from './dates.js';
import { isFromImport } from './import-origin.js';

/** Which way the import went: a new tree, into the open (empty) tree, or merged into a new tree. */
export type ImportNextPath = 'new' | 'insert' | 'merge';

/**
 * The research row:
 * - `none`: no research on this computer (or a phone/tablet) — what it is and how to install it;
 * - `have`: the research runs here, the tree is not one of its trees — start it with this tree;
 * - `linked`: the tree is a research's tree — look up places (and, with 065, check facts).
 */
export type ImportNextResearch = 'none' | 'have' | 'linked';

export interface ImportNextResearchInput {
    /** A computer (no coarse pointer): the research runs only there. */
    onComputer: boolean;
    /** The tree is a research's tree (TreeMetadata.research). */
    linked: boolean;
    /** The research runs here and can take this tree over (researchAdoptAvailable). */
    canAdopt: boolean;
}

/** The research row's state (§1 point 4). */
export function importNextResearchState(input: ImportNextResearchInput): ImportNextResearch {
    if (!input.onComputer) return 'none';
    if (input.linked) return 'linked';
    return input.canAdopt ? 'have' : 'none';
}

/**
 * "Check facts against sources" (065, bulk verification): offered only when
 * the research's bridge names the feature (`verify.bulk`); the button opens
 * the bulk dialog, through the bridge with the AI badge alone.
 */
export const IMPORT_NEXT_VERIFY_FEATURES: readonly string[] = ['verify.bulk'];

/** The bridge's /status.features offer the bulk verification of 065. */
export function importNextVerifyAvailable(features: readonly string[] | null | undefined): boolean {
    return !!features && IMPORT_NEXT_VERIFY_FEATURES.some(f => features.includes(f));
}

export type ImportNextRow =
    | { kind: 'check'; findings: number }
    | { kind: 'split'; families: number }
    | { kind: 'research'; state: ImportNextResearch; verify: boolean };

export interface ImportNextRowsInput {
    /** Errors + warnings of the data check (validateTreeData). */
    findings: number;
    /** Families of 2+ people that nothing connects (findComponents). */
    families: number;
    research: ImportNextResearch;
    /** The bridge offers the bulk verification (importNextVerifyAvailable). */
    verify: boolean;
}

/** The card's rows, top down: the data check (always), the split (2+ families), the research. */
export function importNextRows(input: ImportNextRowsInput): ImportNextRow[] {
    const rows: ImportNextRow[] = [{ kind: 'check', findings: Math.max(0, input.findings) }];
    if (input.families >= 2) rows.push({ kind: 'split', families: input.families });
    rows.push({ kind: 'research', state: input.research, verify: input.research === 'linked' && input.verify });
    return rows;
}

/** The card is due for this import: its record is in the tree and the card was not closed. */
export function importNextDue(data: Pick<StromData, 'imports'>, importId: string | undefined): boolean {
    const rec = importId ? data.imports?.find(r => r.id === importId) : undefined;
    return !!rec && rec.nextCardClosed !== true;
}

/** Remember the card was closed for this import; true when the record changed. */
export function markImportNextClosed(data: Pick<StromData, 'imports'>, importId: string | undefined): boolean {
    const rec = importId ? data.imports?.find(r => r.id === importId) : undefined;
    if (!rec || rec.nextCardClosed === true) return false;
    rec.nextCardClosed = true;
    return true;
}

/** `{prog}` of the origin line: the program and its version ("MyHeritage Family Tree Builder 8.0"). */
export function importProgramLabel(rec: Pick<ImportRecord, 'program' | 'version' | 'file'>): string {
    const program = rec.program.trim();
    const version = rec.version?.trim() ?? '';
    if (!program) return rec.file?.trim() || 'GEDCOM';
    return version && !program.endsWith(version) ? `${program} ${version}` : program;
}

/** `{prog}` of "Back to {prog}": the program without its version (the way back is to the program). */
export function importProgramName(rec: Pick<ImportRecord, 'program' | 'file'>): string {
    return rec.program.trim() || rec.file?.trim() || 'GEDCOM';
}

/**
 * `{date}`: the file's date from its header in the app's way of writing
 * dates, else the day it was loaded; as written when it cannot be read.
 */
export function importDateText(rec: Pick<ImportRecord, 'fileDate' | 'at'>, lang: 'cs' | 'en' | 'de' | 'pl'): string {
    const written = rec.fileDate?.trim();
    if (written) {
        const iso = parseGedcomDate(written);
        return /^\d{4}(-\d{2}){0,2}$/.test(iso) ? formatFlexDate(iso, lang) : written;
    }
    const day = rec.at.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFlexDate(day, lang) : rec.at;
}

/** People with at least one fact still as the file gave it (`importNext.linkedText` n). */
export function peopleWithImportedFacts(data: Pick<StromData, 'persons'>): number {
    let n = 0;
    for (const person of Object.values(data.persons ?? {})) {
        if (!person?.importedValues) continue;
        if (Object.keys(person.importedValues).some(key => isFromImport(person, key))) n++;
    }
    return n;
}
