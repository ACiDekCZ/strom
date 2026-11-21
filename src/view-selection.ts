/**
 * The window's selection of people (spec 098 §0.1): one named group of
 * people per window, the same in every view of the window. Pure: no DOM, no
 * app state; the window's state lives in src/ui/view-selection-ui.ts.
 *
 * A selection is a family line, the ancestors or descendants of a person
 * (optionally limited to n generations), a research line or a list of people.
 * It is never stored in the tree's data; the lists (spec 084) stay as they are.
 *
 * Its people are found the way the lists find theirs: a family line by its
 * real members (as the tree view's highlight), ancestors, descendants and a
 * research line by the very rule of an automatic list (rulePersonIds), a list
 * by listPersonIds. Placeholders and people no longer in the tree are never in
 * it. One pass over the lineage index, cached per index (one per change of
 * the data) and selection.
 */

import type { PersonId, PersonListRule, StromData } from './types.js';
import { realRodMembers, type LineageIndex, type RodId } from './lineage.js';
import { listDisplayName, listPersonIds, personListsOf, rulePersonIds } from './person-lists.js';
import { researchLinesOf } from './ui/table-view/table-research.js';
import { shownName } from './person-name.js';
import { strings } from './strings.js';
import { encodeSelectionRef, generationsOf, type GoneReason, type SelectionLabel, type SelectionRef } from './view-selection-ref.js';

export * from './view-selection-ref.js';

// ---------------------------------------------------------------------------
// People, gone, label, rule
// ---------------------------------------------------------------------------

/** The rule of an automatic list that finds the same people (ancestors, descendants, a research line). */
function ruleOf(ref: Extract<SelectionRef, { kind: 'ancestors' | 'descendants' | 'line' }>): PersonListRule {
    if (ref.kind === 'line') return { kind: 'line', directionId: ref.directionId };
    const g = generationsOf(ref.generations);
    return { kind: ref.kind, personId: ref.personId, ...(g ? { generations: g } : {}) };
}

/** The research lines of the tree (the file's, as the lists' rule reads them). */
function hasLine(data: StromData, id: string): boolean {
    return researchLinesOf(data).lines.some(l => l.id === id);
}

/** Why the selection no longer exists after a change; null while it does. */
export function selectionGone(data: StromData, index: LineageIndex, ref: SelectionRef): GoneReason | null {
    switch (ref.kind) {
        case 'rod':
            return index.rods.has(ref.rodId) && realRodMembers(index, ref.rodId).length > 0 ? null : 'rod';
        case 'ancestors':
        case 'descendants':
            return data.persons[ref.personId] ? null : 'person';
        case 'line':
            return hasLine(data, ref.directionId) ? null : 'line';
        case 'list':
            return personListsOf(data).some(l => l.id === ref.listId) ? null : 'list';
    }
}

const cache = new WeakMap<LineageIndex, Map<string, ReadonlySet<PersonId> | null>>();

function compute(data: StromData, index: LineageIndex, ref: SelectionRef): ReadonlySet<PersonId> | null {
    if (selectionGone(data, index, ref)) return null;
    switch (ref.kind) {
        case 'rod':
            return new Set(realRodMembers(index, ref.rodId));
        case 'ancestors':
        case 'descendants':
        case 'line':
            return new Set(rulePersonIds(index, ruleOf(ref)));
        case 'list': {
            const list = personListsOf(data).find(l => l.id === ref.listId)!;
            return new Set(listPersonIds(index, list));
        }
    }
}

/**
 * The selection's people (real people of the tree only, people no longer in
 * it left out); null = the selection is gone (§7). Cached per lineage index
 * (a new one comes with every change of the data) and selection.
 */
export function selectionPersonIds(data: StromData, index: LineageIndex, ref: SelectionRef): ReadonlySet<PersonId> | null {
    let byRef = cache.get(index);
    if (!byRef) { byRef = new Map(); cache.set(index, byRef); }
    const key = encodeSelectionRef(ref);
    if (byRef.has(key)) return byRef.get(key)!;
    const ids = compute(data, index, ref);
    byRef.set(key, ids);
    return ids;
}

/** The selection's name: the prefix of its kind (1.2) and the name of its line, person or list ('' when gone). */
export function selectionLabel(ref: SelectionRef, data: StromData, labels: ReadonlyMap<RodId, string>): SelectionLabel {
    const p = strings.selection.prefix;
    switch (ref.kind) {
        case 'rod':
            return { prefix: p.rod, name: labels.get(ref.rodId) ?? '' };
        case 'ancestors':
        case 'descendants': {
            const person = data.persons[ref.personId];
            return { prefix: ref.kind === 'ancestors' ? p.ancestors : p.descendants, name: person ? shownName(person) : '' };
        }
        case 'line': {
            const line = researchLinesOf(data).lines.find(l => l.id === ref.directionId);
            return { prefix: p.line, name: line ? line.name || line.id : '' };
        }
        case 'list': {
            const list = personListsOf(data).find(l => l.id === ref.listId);
            return { prefix: p.list, name: list ? listDisplayName(list) : '' };
        }
    }
}

/** The label as one text: "Line Brandvold", "Ancestors: Anna Nováková". */
export function selectionLabelText(label: SelectionLabel): string {
    return label.prefix ? `${label.prefix} ${label.name}`.trim() : label.name;
}

/** The selection as an automatic list's rule (§2 "Save the selection as a list…", §5 the Table); a list itself → null. */
export function selectionAsRule(ref: SelectionRef): PersonListRule | null {
    switch (ref.kind) {
        case 'rod': return { kind: 'rods', rodIds: [ref.rodId] };
        case 'ancestors':
        case 'descendants':
        case 'line': return ruleOf(ref);
        case 'list': return null;
    }
}
