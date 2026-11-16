/**
 * Where the dialog Lists of people (src/ui/person-lists-ui.ts) hands over to
 * the parts built beside it (spec 084): one object of entry points, each
 * replaced by its own part when it comes.
 *
 *   newList      "+ New list…" in the dialog's head and its empty state. The
 *                New list dialog (§3) takes it over; until then an empty
 *                fixed list is made under a free name and its name opens
 *                for editing at once.
 *   editRule     "Edit rule…" of an automatic list (§3). null: no link.
 *   addPerson    "+ Add person…" of a fixed list (§4). null: no link.
 *   openInTable  "Open in Table" and the "N without citation ›" tile (§9):
 *                the Table in the list's scope, with the chip of people
 *                without a source when asked. Until the Table knows a
 *                list's scope it opens the Table's people.
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
        const list = DataManager.createPersonList({ name: strings.lists.new.title, dynamic: false });
        if (list) ui.showPersonLists({ listId: list.id, rename: true });
    },
    editRule: null,
    addPerson: null,
    openInTable(ui) {
        ui.closePersonLists();
        ui.setDisplayViewMode('table');
    },
    listMenu: [],
};
