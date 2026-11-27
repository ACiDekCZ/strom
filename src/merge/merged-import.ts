/**
 * A merged tree is an import (1127, Milan 27 Nov 2026): what a merge of
 * another tree of the app (spec 134) brings into a tree is that tree's, as a
 * GEDCOM's facts are the file's — it goes to the research marked
 * `_STROM_IMPORT` (its source the merged tree), not as a person's edits. Also
 * when the merged tree has no import record of its own (loaded before data
 * version 15, made by hand, read from a file of Strom).
 *
 * The source gets one import record of its own (program MERGED_TREE_PROGRAM,
 * file = the tree's or the file's name, the day of the merge) and every
 * record the tree does not know the origin of is marked from it: the person
 * or couple, its facts and its parent links. What the tree already knows
 * stays as it is: a record from its own import (its hand-added facts stay a
 * person's), a fact with a stored value of an import (changed since: a
 * person's), a fact a person confirmed (spec 065). The merge then carries the
 * marks as it carries a GEDCOM's (addImportRecords, carryMergedImports): an
 * added person keeps them, a joined one only where it took the source's value.
 */

import type { FactHolder } from '../import-origin.js';
import { factParts, factsOf, localIsoDay, markFactImported, MERGED_TREE_PROGRAM, nextImportId } from '../import-origin.js';
import { factVerifyInfo } from '../verify.js';
import type { ImportRecord, PlanSource, StromData } from '../types.js';

/** Whether the holder's record came from an import the source still has a record of. */
function knownOrigin(holder: FactHolder, known: ReadonlySet<string>): boolean {
    return !!holder.importId && known.has(holder.importId);
}

/** Mark the facts of a record of unknown origin from `importId`; false when there was nothing to mark. */
function markFacts(holder: FactHolder, importId: string): boolean {
    let marked = false;
    for (const fact of factsOf(holder)) {
        if (factVerifyInfo(holder, fact).confirmed) continue;
        const keys = Object.values(factParts(holder, fact)) as string[];
        if (keys.some(key => holder.importedValues?.[key])) continue;
        const before = Object.keys(holder.importedValues ?? {}).length;
        markFactImported(holder, fact, importId);
        if (Object.keys(holder.importedValues ?? {}).length > before) marked = true;
    }
    return marked;
}

/**
 * The source of a merge with the merged tree as its import (see the module's
 * note); the source itself when it is a GEDCOM of another program (its own
 * import marks all of it) or holds nothing of unknown origin. `at`: the day
 * of the merge.
 */
export function withMergedTreeImport(source: StromData, from: Pick<PlanSource, 'kind' | 'label' | 'importId' | 'fileDate'>, at: string = localIsoDay()): StromData {
    if (from.importId) return source;
    const data = structuredClone(source);
    const known = new Set((data.imports ?? []).map(r => r.id));
    const id = nextImportId(data.imports);
    let used = false;
    for (const person of Object.values(data.persons)) {
        if (!person || person.isPlaceholder || knownOrigin(person, known)) continue;
        markFacts(person, id);
        person.importId = id;
        for (const pid of person.parentIds ?? []) {
            if (!person.importedParents?.[pid]) (person.importedParents ??= {})[pid] = id;
        }
        used = true;
    }
    for (const ps of Object.values(data.partnerships)) {
        if (!ps || knownOrigin(ps, known)) continue;
        markFacts(ps, id);
        ps.importId = id;
        used = true;
    }
    if (!used) return source;
    const label = from.label.trim();
    const rec: ImportRecord = {
        id,
        program: MERGED_TREE_PROGRAM,
        at,
        ...(label ? { file: label } : {}),
        ...(from.fileDate?.trim() ? { fileDate: from.fileDate.trim() } : {}),
    };
    (data.imports ??= []).push(rec);
    return data;
}

