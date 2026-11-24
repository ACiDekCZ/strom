/**
 * Adding people to a list and taking them out (spec 084 §4): the rows "Add
 * to list ›" of the person menu, of a Table row and of the search results,
 * and the dialog "Add person" of a fixed list (4d). Only fixed lists take
 * people by hand; an automatic list fills itself from its rule, which the
 * note under the lists says. Every change is one Undo step with its toast
 * (DataManager.addPersonsToList / removePersonsFromList).
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import type { PersonId, PersonList } from '../types.js';
import { listDisplayName, listIsAuto } from '../person-lists.js';
import { filterAndSort } from '../person-picker.js';
import { shownName } from '../person-name.js';
import { cardYears } from '../card-fields.js';
import { listKindIcon } from './list-kind-icon.js';
import type { PersonMenuAction } from './context-menu.js';
import type { MenuEntry } from './table-view/table-headmenu.js';
import { uiModule } from './module.js';
import type { UIClass } from './index.js';

/** Person menu actions of the lists' second level. */
export const LIST_TOGGLE_ACTION = 'list-toggle:';
export const LIST_NEW_WITH_ACTION = 'list-new-with';
export const LISTS_MORE_ACTION = 'lists-more';

/** At most this many lists in a menu; the rest behind "More lists…". */
const MENU_LISTS = 8;
const PICK_ID = 'person-list-add';
/** Rows the pick dialog draws at most (the search narrows the rest). */
const PICK_ROWS = 200;

/** The fixed lists a menu offers, the most recently changed first; `more` when some did not fit. */
export function addTargets(): { lists: PersonList[]; more: boolean } {
    const fixed = DataManager.getPersonLists().filter(l => !listIsAuto(l))
        .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
    return { lists: fixed.slice(0, MENU_LISTS), more: fixed.length > MENU_LISTS };
}

function inList(list: PersonList, id: PersonId): boolean {
    return (list.personIds ?? []).includes(id);
}

/**
 * "Add to list ›" of the person menu: always a second level (heading, the
 * fixed lists with ✓ where the person is, More lists…, New list with this
 * person…, the note about automatic lists). None in a read-only or locked
 * tree.
 */
export function personListMenuRows(personId: PersonId): PersonMenuAction[] {
    if (DataManager.listsReadOnly()) return [];
    const c = strings.contextMenu;
    const { lists, more } = addTargets();
    const rows: PersonMenuAction[] = lists.map((l, i) => {
        const name = listDisplayName(l);
        const has = inList(l, personId);
        return {
            action: LIST_TOGGLE_ACTION + l.id, label: name, iconHtml: listKindIcon('fixed', 14),
            meta: has ? '✓' : String(l.personIds?.length ?? 0),
            ariaLabel: has ? `${name}, ${strings.lists.inList}` : undefined,
            ...(i === 0 ? { header: strings.lists.title } : {}),
        };
    });
    if (more) rows.push({ action: LISTS_MORE_ACTION, label: c.moreLists });
    rows.push({ action: LIST_NEW_WITH_ACTION, label: c.newListWith, divider: rows.length > 0 });
    rows.push({ action: 'lists-hint', label: c.autoListsNote, hint: true });
    return [{ action: 'add-to-list', label: c.toList, submenu: rows }];
}

/**
 * The lists as entries of a Table / search menu. One person: ✓ where they
 * are (a click takes them out); more people: a click adds those not in yet.
 * `extra` comes first (search: "New list from the results").
 */
export function listMenuEntries(ui: UIClass, ids: PersonId[], onNew: () => void, newLabel: string, newFirst = false): MenuEntry[] {
    const c = strings.contextMenu;
    const { lists, more } = addTargets();
    const one = ids.length === 1 ? ids[0] : null;
    const listRows: MenuEntry[] = lists.map(l => ({
        id: `list-${l.id}`, label: listDisplayName(l), icon: '', iconHtml: listKindIcon('fixed', 14),
        hint: one && inList(l, one) ? undefined : String(l.personIds?.length ?? 0),
        ...(one && inList(l, one) ? { checked: true } : {}),
        run: () => {
            if (one && inList(l, one)) DataManager.removePersonsFromList(l.id, [one]);
            else addOrSay(ui, l, ids);
        },
    }));
    if (more) listRows.push({ id: 'lists-more', label: c.moreLists, icon: '', run: () => ui.showPersonLists() });
    const newRow: MenuEntry = { id: 'list-new', label: newLabel, icon: '+', run: onNew };
    const head: MenuEntry[] = lists.length ? [{ heading: strings.lists.title }] : [];
    const out: MenuEntry[] = newFirst
        ? [newRow, ...(lists.length ? [null] : []), ...head, ...listRows]
        : [...head, ...listRows, ...(lists.length ? [null] : []), newRow];
    out.push({ note: c.autoListsNote });
    return out;
}

/**
 * The lists as a second page of a phone's sheet (15e): the lists with ✓
 * where the one person is (else their count), More lists…, the new list,
 * and the note about automatic lists under them.
 */
export function listSheetPage(ui: UIClass, ids: PersonId[], onNew: () => void, newLabel: string): {
    title: string; note: string;
    rows: Array<{ label: string; icon: string; iconHtml?: string; value?: string; ariaLabel?: string; id?: string; run: () => void }>;
} {
    const c = strings.contextMenu;
    const { lists, more } = addTargets();
    const one = ids.length === 1 ? ids[0] : null;
    const rows: ReturnType<typeof listSheetPage>['rows'] = lists.map(l => {
        const name = listDisplayName(l);
        const has = !!one && inList(l, one);
        return {
            id: `list-${l.id}`, label: name, icon: '', iconHtml: listKindIcon('fixed', 16), value: has ? '✓' : String(l.personIds?.length ?? 0),
            ...(has ? { ariaLabel: `${name}, ${strings.lists.inList}` } : {}),
            run: () => { if (has && one) DataManager.removePersonsFromList(l.id, [one]); else addOrSay(ui, l, ids); },
        };
    });
    if (more) rows.push({ id: 'lists-more', label: c.moreLists, icon: '', run: () => ui.showPersonLists() });
    rows.push({ id: 'list-new', label: newLabel, icon: '+', run: onNew });
    return { title: c.toList, note: c.autoListsNote, rows };
}

/** Add the people; when all of them are in already, a toast says so (nothing changed, no Undo). */
function addOrSay(ui: UIClass, list: PersonList, ids: PersonId[]): void {
    if (DataManager.addPersonsToList(list.id, ids)) return;
    ui.showToast(strings.lists.toast.allIn(listDisplayName(list)));
}

interface PickState { listId: string; query: string; chosen: Set<PersonId>; opener: HTMLElement | null }
let pick: PickState | null = null;

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const personListAddMethods = uiModule({
    /** The person menu's list actions (false: not one of them). */
    runPersonListAction(personId: PersonId, action: string): boolean {
        if (action.startsWith(LIST_TOGGLE_ACTION)) {
            const list = DataManager.getPersonList(action.slice(LIST_TOGGLE_ACTION.length));
            if (!list || listIsAuto(list)) return true;
            if (inList(list, personId)) DataManager.removePersonsFromList(list.id, [personId]);
            else DataManager.addPersonsToList(list.id, [personId]);
            return true;
        }
        if (action === LIST_NEW_WITH_ACTION) {
            this.showNewPersonList({ personIds: [personId] });
            return true;
        }
        if (action === LISTS_MORE_ACTION) {
            this.showPersonLists();
            return true;
        }
        return action === 'lists-hint';
    },

    /**
     * "+ Add person…" of a fixed list (4d): a search over the tree, several
     * people taken by their boxes, those already in the list greyed with
     * "already in the list"; Add (n) adds them at the end of the list.
     */
    showAddPersonsToList(listId: string): void {
        const list = DataManager.getPersonList(listId);
        if (!list || listIsAuto(list) || DataManager.listsReadOnly()) return;
        this.closeAddPersonsToList(false);
        const active = document.activeElement;
        pick = { listId, query: '', chosen: new Set(), opener: active instanceof HTMLElement ? active : null };
        const t = strings.lists;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active pln-overlay';
        overlay.id = PICK_ID;
        overlay.innerHTML = `<div class="modal modal--md pln-modal pla-modal" role="dialog" aria-modal="true" aria-labelledby="pla-title" data-dialog-kind="form">`
            + `<div class="modal-header pln-head"><h2 id="pla-title">${esc(t.pickTitle)}</h2>`
            + `<button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + `<div class="modal-content pln-body pla-body"><input type="search" class="pla-search" id="pla-search" autocomplete="off" placeholder="${esc(t.pickSearch)}" aria-label="${esc(t.pickSearch)}">`
            + `<p class="pla-sub">${esc(listDisplayName(list))}</p>`
            + '<div class="pla-rows" role="group"></div></div>'
            + `<div class="buttons pln-foot"><button type="button" class="secondary" data-dismiss data-act="close">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" data-act="add" disabled>${esc(t.addN(0))}</button></div></div>`;
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeAddPersonsToList(); });
        overlay.addEventListener('click', (e) => {
            const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
            if (act === 'close') this.closeAddPersonsToList();
            else if (act === 'add') this.confirmAddPersonsToList();
        });
        overlay.addEventListener('change', (e) => {
            const box = e.target as HTMLInputElement;
            if (!pick || !box.matches('.pla-check')) return;
            const id = box.value as PersonId;
            if (box.checked) pick.chosen.add(id); else pick.chosen.delete(id);
            this.updateAddPersonsCount();
        });
        overlay.addEventListener('input', (e) => {
            const input = e.target as HTMLInputElement;
            if (!pick || !input.matches('.pla-search')) return;
            pick.query = input.value;
            this.renderAddPersonsRows();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).matches('.pla-search') && pick?.chosen.size) {
                e.preventDefault();
                this.confirmAddPersonsToList();
            }
        });
        document.body.appendChild(overlay);
        this.pushDialog(PICK_ID);
        this.renderAddPersonsRows();
        overlay.querySelector<HTMLElement>('.pla-search')?.focus({ preventScroll: true });
    },

    isAddPersonsToListOpen(): boolean {
        return !!pick && !!document.getElementById(PICK_ID);
    },

    closeAddPersonsToList(restoreFocus = true): void {
        const st = pick;
        pick = null;
        document.getElementById(PICK_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== PICK_ID);
        if (restoreFocus && st?.opener?.isConnected) st.opener.focus({ preventScroll: true });
    },

    renderAddPersonsRows(): void {
        const st = pick;
        const host = document.querySelector<HTMLElement>(`#${PICK_ID} .pla-rows`);
        const list = st ? DataManager.getPersonList(st.listId) : undefined;
        if (!st || !host || !list) return;
        const data = DataManager.getData();
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
        const found = filterAndSort(st.query, persons, data).slice(0, PICK_ROWS);
        const have = new Set(list.personIds ?? []);
        host.innerHTML = found.length === 0
            ? `<p class="pla-none">${esc(strings.treeOverview.noMatch)}</p>`
            : found.map(p => {
                const inIt = have.has(p.id);
                const years = cardYears(p);
                return `<label class="sel-opt pla-row" data-sel-form="row"${inIt ? ' aria-disabled="true"' : ''}>`
                    + `<input type="checkbox" class="pla-check" value="${esc(p.id)}"${inIt ? ' checked disabled' : st.chosen.has(p.id) ? ' checked' : ''}>`
                    + `<span class="pla-name">${esc(shownName(p))}</span>`
                    + (years ? `<span class="pla-years">${esc(years)}</span>` : '')
                    + (inIt ? `<span class="pla-in">${esc(strings.lists.inList)}</span>` : '')
                    + '</label>';
            }).join('');
        this.updateAddPersonsCount();
    },

    updateAddPersonsCount(): void {
        const btn = document.querySelector<HTMLButtonElement>(`#${PICK_ID} [data-act="add"]`);
        if (!btn || !pick) return;
        btn.textContent = strings.lists.addN(pick.chosen.size);
        btn.disabled = pick.chosen.size === 0;
    },

    confirmAddPersonsToList(): void {
        const st = pick;
        if (!st || st.chosen.size === 0) return;
        const ids = [...st.chosen];
        this.closeAddPersonsToList();
        DataManager.addPersonsToList(st.listId, ids);
    },
});
