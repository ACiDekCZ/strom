/**
 * Where the search scope's people come from (spec 137 §2): the toolbar's
 * search (the centre of the tree views, the main person in the Map and the
 * Table; the people the view shows now) and the dialogs' pickers (the
 * dialog's person; the view behind the dialog when nothing else covers it).
 * The sets themselves are worked out by the picker when its list opens
 * (src/search-scope.ts), never while typing.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { LAST_FOCUSED } from '../model-values.js';
import { startupPerson } from '../default-person.js';
import { shownName as shownNameOf } from '../person-name.js';
import type { PersonId, ViewMode } from '../types.js';
import type { PickerScopeSource } from '../person-picker.js';
import { directLineIds, getSearchScope, narrowIds } from '../search-scope.js';
import { getUI } from '../ui-ref.js';
import { materialsWindowOpen } from './materials-window.js';

/** A real person of the tree, or null (none, gone, a placeholder). */
function realPerson(id: PersonId | null | undefined): PersonId | null {
    if (!id) return null;
    const p = DataManager.getPerson(id);
    return p && !p.isPlaceholder ? p.id : null;
}

/** The views that read the line from the tree's main person (no centre of their own). */
function mainPersonView(mode: ViewMode): boolean {
    return mode === 'map' || mode === 'table';
}

/**
 * The tree's main person: the one set in "Default person and view", else the
 * first person (as the tree opens, spec 111); with "the last focused" the centre.
 */
function mainPerson(): PersonId | null {
    const data = DataManager.getData();
    if (data.defaultPersonId === LAST_FOCUSED) return realPerson(TreeRenderer.getFocusPersonId());
    return realPerson(startupPerson(data)?.id);
}

/** The toolbar's direct-line person (§2.1): the centre of the tree views, the main person in the Map and the Table. */
export function toolbarRefPerson(): PersonId | null {
    return mainPersonView(TreeRenderer.getViewMode()) ? mainPerson() : realPerson(TreeRenderer.getFocusPersonId());
}

/** Without placeholders: the count says the people one could find. */
function realOnly(ids: Iterable<PersonId>): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const id of ids) if (realPerson(id)) out.add(id);
    return out;
}

/**
 * The people the view shows now (§2.3); null where it shows the whole tree
 * (the Map or the Timeline with the scope Whole tree, the Table with neither
 * a filter nor a scope).
 */
export function toolbarViewIds(): ReadonlySet<PersonId> | null {
    const ui = getUI();
    switch (TreeRenderer.getViewMode()) {
        case 'map': {
            const ids = ui.mapScopePersons();
            return ids ? realOnly(ids) : null;
        }
        case 'timeline':
            if (ui.timelineScope === 'tree') return null;
            return realOnly(ui.timelineScopePersons());
        case 'table':
            return ui.tableShownPersonIds();
        default:
            return realOnly(TreeRenderer.getVisiblePersonIds());
    }
}

/** The view's name in the line under the segments: its tab's, the Table's "Table, filtered". */
export function toolbarViewLabel(): string {
    const mode = TreeRenderer.getViewMode();
    return mode === 'table' ? strings.searchScope.tableView : strings.viewModeSwitch[mode];
}

/** The toolbar search's scope (§2.1–§2.3). */
export function toolbarScopeSource(): PickerScopeSource {
    return {
        refPersonId: toolbarRefPerson,
        refKind: () => mainPersonView(TreeRenderer.getViewMode()) ? 'main' : 'center',
        viewPersonIds: toolbarViewIds,
        viewLabel: toolbarViewLabel,
    };
}

/**
 * The toolbar's narrowing now (§4): the people the toolbar's highlight and
 * counts keep; null for the whole tree or a scope not offered here.
 */
export function toolbarScopeIds(): ReadonlySet<PersonId> | null {
    const scope = getSearchScope();
    if (scope === 'tree') return null;
    let line: ReadonlySet<PersonId> | null = null;
    if (scope === 'line') {
        const ref = toolbarRefPerson();
        line = ref ? directLineIds(DataManager.getData(), ref, DataManager.getRevision()) : null;
    }
    const view = scope === 'view' ? toolbarViewIds() : null;
    return narrowIds(scope, { line, view });
}

/**
 * The view behind a dialog (§2.4): its people only while this dialog alone
 * stands over the view — no other dialog and no whole-window page (the
 * Person page, the Materials window, the Lists of people) covers it.
 */
export function viewBehindDialog(): ReadonlySet<PersonId> | null {
    const ui = getUI();
    if (ui.isPersonPageOpen() || ui.isPersonListsOpen() || materialsWindowOpen()) return null;
    if (document.querySelectorAll('.modal-overlay.active').length > 1) return null;
    return toolbarViewIds();
}

/**
 * A dialog picker's scope (§1.5): the line of the dialog's person (`ref`,
 * read when the list opens), the view behind the dialog unless `view` is
 * false (a window that covers the view).
 */
export function dialogScopeSource(ref: () => PersonId | null | undefined, opts: { view?: boolean } = {}): PickerScopeSource {
    const withView = opts.view !== false;
    return {
        refPersonId: () => realPerson(ref()),
        refKind: () => 'dialog',
        viewPersonIds: () => withView ? viewBehindDialog() : null,
        viewLabel: toolbarViewLabel,
    };
}

/**
 * The Materials window's pickers (§1.5): the line of the material's person,
 * else of the tree's main person (and the line says so); no view, the
 * window covers it.
 */
export function materialScopeSource(personId: PersonId | null | undefined): PickerScopeSource {
    const own = () => realPerson(personId);
    return {
        refPersonId: () => own() ?? mainPerson(),
        refKind: () => own() ? 'dialog' : 'main',
        viewPersonIds: () => null,
        viewLabel: toolbarViewLabel,
    };
}

/** The sheet's quiet line under the filters (§5) and the panel's foot (§4) while the toolbar narrows. */
export function toolbarScopeNote(): { foot: string; sheet: string } | null {
    const S = strings.searchScope;
    const scope = getSearchScope();
    if (scope === 'line') {
        const ref = toolbarRefPerson();
        const p = ref ? DataManager.getPerson(ref) : null;
        if (!p) return null;
        const year = p.birthDate ? p.birthDate.split('-')[0] : '';
        const name = `${shownNameOf(p)}${year ? ` (*${year})` : ''}`;
        return { foot: S.footLine, sheet: S.sheetLine(name) };
    }
    if (scope === 'view') {
        if (!toolbarViewIds()) return null;
        return { foot: S.footView, sheet: S.sheetView(toolbarViewLabel()) };
    }
    return null;
}
