/**
 * Where the dialog Lists of people (src/ui/person-lists-ui.ts) hands over to
 * the parts built beside it (spec 084): one object of entry points, each
 * replaced by its own part when it comes.
 *
 *   newList      "+ New list…" in the dialog's head and its empty state:
 *                the dialog New list (§3, src/ui/person-list-new-ui.ts).
 *   editRule     "Edit rule…" of an automatic list (§3, §7): the same dialog
 *                with the list's rule. A rule of a Table filter opens the
 *                Table with the rule's filter; its ⋯ offers "Save to the
 *                list". null: no link.
 *   addPerson    "+ Add person…" of a fixed list (§4, the dialog in
 *                src/ui/person-list-add.ts). null: no link.
 *   openInTable  "Open in Table" and the "N without citation ›" tile (§9):
 *                the Table in the list's scope, with the chip of people
 *                without a source when asked.
 *   listMenu     more rows of a list's ⋯, after Duplicate (§7 Freeze, §13
 *                Tick off done, §12 Export ›). Each returns its rows for the
 *                list (none when they do not apply).
 */

import type { PersonList } from '../types.js';
import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import type { UIClass } from './index.js';

/** A row of a list's ⋯ menu (the same rows in the popup and in the phone's sheet). */
export interface ListMenuRow {
    id: string;
    label: string;
    /** A quiet second line ("Becomes fixed with the people it has now"). */
    sub?: string;
    /** A ✓ at the row's end (a switch that is on). */
    checked?: boolean;
    danger?: boolean;
    /** A second level ("Export ›"): its rows open beside the row (a page of the phone's sheet); `run` is not used. */
    children?: ListMenuRow[];
    run: () => void;
}

export interface PersonListHooks {
    newList(ui: UIClass): void;
    editRule: ((ui: UIClass, listId: string) => void) | null;
    addPerson: ((ui: UIClass, listId: string) => void) | null;
    openInTable(ui: UIClass, listId: string, opts?: { noSource?: boolean }): void;
    listMenu: Array<(ui: UIClass, list: PersonList) => ListMenuRow[]>;
}

export const personListHooks: PersonListHooks = {
    newList(ui) {
        ui.showNewPersonList();
    },
    editRule(ui, listId) {
        const list = DataManager.getPersonList(listId);
        if (!list?.rule) return;
        if (list.rule.kind === 'tableFilter') {
            ui.closePersonLists();
            ui.openTableForRule(listId);
        } else ui.showNewPersonList({ listId });
    },
    addPerson(ui, listId) {
        ui.showAddPersonsToList(listId);
    },
    openInTable(ui, listId, opts) {
        ui.closePersonLists();
        ui.openTableInScope(listId, opts ?? {});
    },
    listMenu: [freezeAndChecklistRows, exportRows],
};

/**
 * §7 and §13: an automatic list offers Freeze (fixed with the people it has
 * now, a toast with Undo); a fixed list switches "Tick off done" on and off
 * (off keeps what is done for the next time it is on).
 */
function freezeAndChecklistRows(_ui: UIClass, list: PersonList): ListMenuRow[] {
    const t = strings.lists;
    if (list.dynamic) {
        return [{ id: 'freeze', label: t.menu.freeze, sub: t.freezeSub, run: () => { DataManager.freezePersonList(list.id); } }];
    }
    return [{
        id: 'work', label: t.menu.work, checked: !!list.checklist,
        run: () => { DataManager.setPersonListChecklist(list.id, !list.checklist); },
    }];
}

/**
 * §12: Export › GEDCOM… opens the dialog Export on the list (its list scope),
 * CSV (list order) downloads the People table of the list at once. A list
 * without anyone has nothing to export.
 */
function exportRows(ui: UIClass, list: PersonList): ListMenuRow[] {
    const t = strings.lists;
    if (!DataManager.getPersonListIds(list.id).length) return [];
    return [{
        id: 'export', label: t.menu.export, run: () => {},
        children: [
            { id: 'export-ged', label: t.export.ged, run: () => { ui.closePersonLists(); ui.showExportDialogForList(list.id); } },
            { id: 'export-csv', label: t.export.csv, run: () => { ui.exportPersonListCsv(list.id); } },
        ],
    }];
}
