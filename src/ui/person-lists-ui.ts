/**
 * The dialog Lists of people (spec 084 §2, §15, §16): every list of the tree
 * in one place. On the left the overview (by name or by change, a search
 * from 9 lists), on the right the chosen list: its name (edited in place),
 * its kind, its rule, what it says of its people (the tiles) and its people.
 * On a phone (and a phone held sideways) the two take turns on the whole
 * screen: the overview, then the list with ‹ back.
 *
 * Every change goes through DataManager (one undo step each, the main window
 * writes); a read-only tree (an exported page, a locked tree) shows the
 * lists without any way to change them — the actions are not there at all.
 *
 * What other parts add (the New list dialog, Edit rule…, Add person…, the
 * Table's scope, more rows of ⋯) comes through ./person-list-hooks.ts.
 * Manual order by dragging, freezing and the checklist (D2b) come into the
 * places marked "D2b" below.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PersonId, PersonList, PersonListSort } from '../types.js';
import {
    foldListName, listDisplayName, listGenerations, listKind, listPersonIds, listSummary, ruleBroken, ruleLabel,
    PERSON_LIST_SORTS, type ListKind,
} from '../person-lists.js';
import { addedTime } from '../person-lists-data.js';
import { shownName } from '../person-name.js';
import { cardYears } from '../card-fields.js';
import { listKindIcon, LIST_KIND_COLOR } from './list-kind-icon.js';
import { personListHooks, type ListMenuRow } from './person-list-hooks.js';
import { uiModule } from './module.js';

const OVERLAY_ID = 'person-lists-modal';
/** People rows drawn in the detail at most (16b): the rest is in the Table. */
export const LIST_DETAIL_ROWS = 200;
/** From this many lists the overview has a search (2d). */
const SEARCH_FROM = 9;
/** The version from which a person's date added is recorded. */
const ADDED_SINCE = '3.30';
/** The phone, and a phone held sideways: the overview and the list take turns. */
const NARROW_QUERY = '(max-width: 640px), (max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

type Order = 'name' | 'change';

interface ListsState {
    selId: string | null;
    order: Order;
    search: string;
    /** On a narrow screen: the overview or the chosen list. */
    view: 'list' | 'detail';
    renaming: boolean;
    draft: string;
    /** The open popup: a list's ⋯ (by its anchor) or the sort choice. */
    menu: { kind: 'list'; listId: string; from: 'row' | 'detail' } | { kind: 'sort' } | null;
}

let state: ListsState | null = null;
let unsubscribe: (() => void) | null = null;
let renderQueued = false;
let narrowMql: MediaQueryList | null = null;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isNarrow(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_QUERY).matches;
}

function fmtNum(n: number): string {
    return n.toLocaleString(getCurrentLanguage());
}

/** "12. 11." / "12 Nov" (with the year when it is not this year). */
function shortDate(iso: string | undefined, withYear = false): string {
    const t = addedTime(iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const lang = getCurrentLanguage();
    const year = withYear || d.getFullYear() !== new Date().getFullYear();
    const opts: Intl.DateTimeFormatOptions = lang === 'en'
        ? { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }
        : { day: 'numeric', month: 'numeric', ...(year ? { year: 'numeric' } : {}) };
    return d.toLocaleDateString(lang, opts);
}

function kindWord(kind: ListKind): string {
    return strings.lists.kind[kind];
}

/** The overview's order: by name (the language's collation) or by the latest change. */
function orderedLists(lists: PersonList[], order: Order): PersonList[] {
    const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'base', numeric: true });
    const out = lists.slice();
    if (order === 'name') out.sort((a, b) => collator.compare(listDisplayName(a), listDisplayName(b)));
    else out.sort((a, b) => (addedTime(b.updated) || 0) - (addedTime(a.updated) || 0) || collator.compare(listDisplayName(a), listDisplayName(b)));
    return out;
}

/** The lists the overview shows: in its order, narrowed by the search (without diacritics). */
function shownLists(st: ListsState): PersonList[] {
    const all = orderedLists(DataManager.getPersonLists(), st.order);
    const q = foldListName(st.search);
    return q ? all.filter(l => foldListName(listDisplayName(l)).includes(q)) : all;
}

/** The line under a list's name in the overview: its kind and what tells it apart. */
function rowMeta(list: PersonList): string {
    const kind = listKind(list);
    const index = DataManager.getLineageIndex();
    if (kind === 'auto') return `${kindWord(kind)} · ${list.rule ? ruleLabel(list.rule, index) : ''}`;
    if (kind === 'work') {
        const s = listSummary(index, list);
        return `${kindWord(kind)} · ${strings.lists.left(s.left ?? 0, s.persons)}`;
    }
    const d = shortDate(list.updated);
    return d ? `${kindWord(kind)} · ${strings.lists.changed(d)}` : kindWord(kind);
}

const DOTS = '<span aria-hidden="true">⋯</span>';

export const personListsMethods = uiModule({
    /**
     * Open the dialog Lists of people (⋯ › Lists of people…, More on a
     * phone). `listId` chooses a list (on a phone: its detail); `rename`
     * opens its name for editing (a list just made).
     */
    showPersonLists(opts: { listId?: string; rename?: boolean } = {}): void {
        const reopen = !!state && !!document.getElementById(OVERLAY_ID);
        if (!reopen) {
            state = { selId: null, order: 'name', search: '', view: 'list', renaming: false, draft: '', menu: null };
        }
        const st = state!;
        if (opts.listId && DataManager.getPersonList(opts.listId)) {
            st.selId = opts.listId;
            st.view = 'detail';
            st.search = '';
        }
        st.menu = null;
        st.renaming = false;
        if (opts.rename && st.selId && !DataManager.listsReadOnly()) {
            st.renaming = true;
            st.draft = listDisplayName(DataManager.getPersonList(st.selId)!);
        }
        if (!reopen) this.openPersonListsOverlay();
        this.renderPersonLists();
        if (!reopen || opts.rename) this.focusPersonLists(st.renaming ? '[data-key="name-input"]' : null);
    },

    /** Build the overlay and start following the tree's changes. */
    openPersonListsOverlay(): void {
        document.getElementById(OVERLAY_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active pl-overlay';
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `<div class="modal modal--lg pl-modal" role="dialog" aria-modal="true" aria-labelledby="pl-title" data-dialog-kind="info" data-skeleton="skip"></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.closePersonLists();
        });
        overlay.addEventListener('click', (e) => this.onPersonListsClick(e));
        overlay.addEventListener('keydown', (e) => this.onPersonListsKey(e));
        overlay.addEventListener('input', (e) => this.onPersonListsInput(e));
        overlay.addEventListener('focusout', (e) => this.onPersonListsFocusOut(e));
        this.clearDialogStack();
        this.pushDialog(OVERLAY_ID);
        const refresh = (): void => this.queuePersonListsRender();
        const offSaved = DataManager.onTreeSaved(refresh);
        window.addEventListener('strom:data-changed', refresh);
        window.addEventListener('strom:tree-switched', refresh);
        narrowMql = window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
        narrowMql?.addEventListener?.('change', refresh);
        unsubscribe = () => {
            offSaved();
            window.removeEventListener('strom:data-changed', refresh);
            window.removeEventListener('strom:tree-switched', refresh);
            narrowMql?.removeEventListener?.('change', refresh);
            narrowMql = null;
        };
    },

    isPersonListsOpen(): boolean {
        return !!document.getElementById(OVERLAY_ID);
    },

    closePersonLists(): void {
        document.getElementById(OVERLAY_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(id => id !== OVERLAY_ID);
        unsubscribe?.();
        unsubscribe = null;
        state = null;
    },

    /** Escape: an open menu, then the name being edited, then the dialog. */
    personListsEscape(): void {
        const st = state;
        if (!st) return;
        if (st.menu) {
            const back = st.menu.kind === 'sort' ? '[data-act="sort"]' : st.menu.from === 'detail' ? '[data-act="menu-detail"]' : null;
            st.menu = null;
            this.renderPersonLists();
            this.focusPersonLists(back);
            return;
        }
        if (st.renaming) {
            st.renaming = false;
            this.renderPersonLists();
            this.focusPersonLists(isNarrow() ? '[data-act="menu-detail"]' : '[data-key="name"]');
            return;
        }
        this.closePersonLists();
    },

    queuePersonListsRender(): void {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            if (state && this.isPersonListsOpen()) this.renderPersonLists();
        });
    },

    /** Draw the dialog from the state, keeping the keyboard focus on the same control. */
    renderPersonLists(): void {
        const st = state;
        const modal = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .pl-modal`);
        if (!st || !modal) return;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && modal.contains(active) ? active.dataset.key ?? null : null;
        const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
        const listScroll = modal.querySelector<HTMLElement>('.pl-rows')?.scrollTop ?? 0;
        const peopleScroll = modal.querySelector<HTMLElement>('.pl-people')?.scrollTop ?? 0;

        const all = DataManager.getPersonLists();
        const shown = shownLists(st);
        const narrow = isNarrow();
        // The chosen list: kept while it exists; else the one in its place, else the first.
        if (st.selId && !all.some(l => l.id === st.selId)) {
            st.selId = shown[0]?.id ?? null;
            st.renaming = false;
            if (narrow) st.view = 'list';
        }
        if (!st.selId && !narrow) st.selId = shown[0]?.id ?? null;
        if (narrow && (!st.selId || all.length === 0)) st.view = 'list';
        const sel = st.selId ? all.find(l => l.id === st.selId) ?? null : null;
        if (st.menu?.kind === 'list' && !all.some(l => l.id === (st.menu as { listId: string }).listId)) st.menu = null;

        const view = narrow ? st.view : 'both';
        modal.dataset.view = view;
        modal.classList.toggle('pl-narrow', narrow);
        modal.innerHTML = this.personListsHeadHtml(sel, narrow, all.length)
            + `<div class="pl-body">${all.length === 0 ? this.personListsNoneHtml()
                : this.personListsSideHtml(shown, all.length, narrow) + `<div class="pl-detail">${sel ? this.personListDetailHtml(sel, narrow) : ''}</div>`}</div>`
            + this.personListsMenuHtml();

        modal.querySelector<HTMLElement>('.pl-rows')?.scrollTo(0, listScroll);
        modal.querySelector<HTMLElement>('.pl-people')?.scrollTo(0, peopleScroll);
        this.placePersonListsMenu();
        if (focusKey) {
            const el = modal.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`);
            if (el) {
                el.focus({ preventScroll: true });
                if (el instanceof HTMLInputElement && caret !== null) el.setSelectionRange(caret, caret);
            }
        }
    },

    /** Focus a control of the dialog (a selector), else the chosen row, else the first row. */
    focusPersonLists(selector: string | null): void {
        const modal = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .pl-modal`);
        if (!modal) return;
        const el = (selector ? modal.querySelector<HTMLElement>(selector) : null)
            ?? modal.querySelector<HTMLElement>('.pl-row[tabindex="0"]')
            ?? modal.querySelector<HTMLElement>('.pl-close');
        el?.focus({ preventScroll: true });
        if (el instanceof HTMLInputElement) el.select();
    },

    personListsHeadHtml(sel: PersonList | null, narrow: boolean, count: number): string {
        const t = strings.lists;
        const ro = DataManager.listsReadOnly();
        const detail = narrow && state!.view === 'detail' && !!sel;
        const back = detail
            ? `<button type="button" class="pl-back" data-act="back" data-key="back" aria-label="${esc(t.back)}" title="${esc(t.back)}"><span aria-hidden="true">‹</span></button>` : '';
        const title = detail ? listDisplayName(sel!) : t.title;
        const newBtn = !ro && !narrow && count > 0
            ? `<button type="button" class="primary pl-new" data-act="new" data-key="new">+ ${esc(t.new.button)}</button>` : '';
        const roBadge = ro ? `<span class="pl-ro">${esc(t.readOnly)}</span>` : '';
        return `<div class="pl-head">${back}<h2 class="pl-title${detail ? ' pl-title--list' : ''}" id="pl-title"${detail ? ` title="${esc(title)}"` : ''}>${esc(title)}</h2>${roBadge}<span class="pl-head-gap"></span>${newBtn}`
            + `<button type="button" class="pl-close" data-act="close" data-key="close" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">&times;</button></div>`;
    },

    /** No list at all (2c): what a list is for, and New list…. */
    personListsNoneHtml(): string {
        const t = strings.lists;
        const btn = DataManager.listsReadOnly() ? ''
            : `<button type="button" class="primary pl-new" data-act="new" data-key="new-empty">+ ${esc(t.new.button)}</button>`;
        return `<div class="pl-none"><span class="pl-none-icon">${listKindIcon('fixed', 26)}</span>`
            + `<p class="pl-none-title">${esc(t.empty)}</p><p class="pl-none-sub">${esc(t.emptySub)}</p>${btn}</div>`;
    },

    /** The overview: order, search, one row per list. */
    personListsSideHtml(shown: PersonList[], total: number, narrow: boolean): string {
        const st = state!;
        const t = strings.lists;
        const ro = DataManager.listsReadOnly();
        const index = DataManager.getLineageIndex();
        const seg = (['name', 'change'] as const).map(o => `<button type="button" class="sel-opt pl-order-opt" data-sel-form="seg" data-act="order" data-order="${o}" data-key="order-${o}" aria-pressed="${st.order === o}">${esc(o === 'name' ? t.byName : t.byChange)}</button>`).join('');
        const newBtn = !ro && narrow
            ? `<button type="button" class="primary pl-new" data-act="new" data-key="new">+ ${esc(t.new.button)}</button>` : '';
        const search = total >= SEARCH_FROM || st.search
            ? `<input type="search" class="pl-search" data-key="search" placeholder="${esc(t.search)}" aria-label="${esc(t.search)}" value="${esc(st.search)}" autocomplete="off">` : '';
        const focusable = shown.some(l => l.id === st.selId) ? st.selId : shown[0]?.id;
        const rows = shown.map(l => {
            const kind = listKind(l);
            const name = listDisplayName(l);
            const n = listPersonIds(index, l).length;
            const on = !narrow && l.id === st.selId;
            const hot = st.menu?.kind === 'list' && st.menu.listId === l.id && st.menu.from === 'row';
            const aria = `${name}, ${kindWord(kind)}, ${t.persons(n)}`;
            const dots = ro ? '' : `<button type="button" class="pl-dots${hot ? ' is-open' : ''}" data-act="menu-row" data-key="dots-${esc(l.id)}" tabindex="-1" aria-label="${esc(t.actions)}" aria-haspopup="menu" aria-expanded="${hot}">${DOTS}</button>`;
            return `<div class="sel-opt pl-row" data-sel-form="row" role="option" data-list="${esc(l.id)}" data-key="row-${esc(l.id)}" data-kind="${kind}" aria-selected="${on}" aria-label="${esc(aria)}" tabindex="${l.id === focusable ? 0 : -1}">`
                + `<span class="pl-row-icon">${listKindIcon(kind, 16)}</span>`
                + `<span class="pl-row-mid"><span class="pl-row-name" title="${esc(name)}">${esc(name)}</span><span class="pl-row-meta">${esc(rowMeta(l))}</span></span>`
                + `<span class="pl-row-count">${fmtNum(n)}</span>${dots}</div>`;
        }).join('');
        return `<div class="pl-side"><div class="pl-tools">${newBtn}<div class="sel-seg pl-order" role="group" aria-label="${esc(t.title)}">${seg}</div></div>${search}`
            + `<div class="pl-rows" role="listbox" aria-label="${esc(t.title)}">${rows}</div></div>`;
    },

    /** The chosen list: name, kind, rule, actions, tiles, people. */
    personListDetailHtml(list: PersonList, narrow: boolean): string {
        const st = state!;
        const t = strings.lists;
        const ro = DataManager.listsReadOnly();
        const index = DataManager.getLineageIndex();
        const kind = listKind(list);
        const name = listDisplayName(list);
        const auto = list.dynamic;

        // Name: edited in place (click, ✎, F2); Enter saves, Escape returns.
        let nameRow: string;
        if (st.renaming && !ro) {
            const draft = st.draft.trim();
            const taken = !!draft && DataManager.isPersonListNameTaken(draft, list.id);
            const err = taken ? `<p class="pl-name-err" id="pl-name-err">${esc(t.save.dup(DataManager.suggestPersonListName(draft, list.id)))}</p>` : '';
            nameRow = `<div class="pl-name-row is-renaming"><input type="text" class="pl-name-input" data-key="name-input" value="${esc(st.draft)}" aria-label="${esc(t.menu.rename)}"${taken || !draft ? ' aria-invalid="true"' : ''}${taken ? ' aria-describedby="pl-name-err"' : ''} maxlength="200"></div>${err}`;
        } else if (narrow) {
            // A phone: the name stands in the head (‹ back · name), Rename is in ⋯.
            nameRow = '';
        } else {
            const pencil = ro ? '' : `<button type="button" class="pl-pencil" data-act="rename" data-key="pencil" aria-label="${esc(t.menu.rename)}" title="${esc(t.menu.rename)}"><span aria-hidden="true">✎</span></button>`;
            nameRow = `<div class="pl-name-row"><h3 class="pl-name" title="${esc(name)}"${ro ? '' : ` data-act="rename" data-key="name" tabindex="0"`}>${esc(name)}</h3>${pencil}`
                + `<span class="pl-badge" style="color:${LIST_KIND_COLOR[kind]}">${listKindIcon(kind, 13)}<span>${esc(t.badge[kind])}</span></span></div>`;
        }

        // The rule: what an automatic list is worked out from, what a fixed one was made from.
        const broken = auto ? ruleBroken(index, list.rule) : null;
        let ruleRow = '';
        if (list.rule) {
            const link = ro || broken ? ''
                : auto ? (personListHooks.editRule ? `<button type="button" class="pl-link" data-act="edit-rule" data-key="edit-rule">${esc(t.editRule)}</button>` : '')
                    : `<button type="button" class="pl-link" data-act="fill" data-key="fill">${esc(t.fill)}</button>`;
            ruleRow = `<div class="pl-rule"><span class="pl-rule-k">${esc(auto ? t.rule.key : t.rule.origin)}</span> <span class="pl-rule-v">${esc(ruleLabel(list.rule, index))}</span>${link}</div>`;
        }
        let note = '';
        if (broken) {
            const text = broken.kind === 'person' ? t.ruleGone(broken.name) : broken.kind === 'rod' ? t.ruleGoneRod : t.ruleGoneLine;
            const acts = ro ? '' : (personListHooks.editRule ? `<button type="button" class="secondary" data-act="edit-rule" data-key="note-edit-rule">${esc(t.editRule)}</button>` : '')
                + `<button type="button" class="secondary" data-act="delete" data-key="note-delete">${esc(t.deleteList)}</button>`;
            note = `<div class="pl-note pl-note--warn" role="note"><span class="pl-note-dot" aria-hidden="true"></span><span class="pl-note-text">${esc(text)}</span>${acts}</div>`;
        } else if (auto) {
            note = `<div class="pl-note" role="note"><span class="pl-note-dot" aria-hidden="true"></span><span class="pl-note-text">${esc(t.autoInfo)}</span></div>`;
        }

        const menuOpen = st.menu?.kind === 'list' && st.menu.from === 'detail';
        const more = ro ? '' : `<button type="button" class="secondary pl-more${menuOpen ? ' is-open' : ''}" data-act="menu-detail" data-key="menu-detail" aria-label="${esc(t.actions)}" title="${esc(t.actions)}" aria-haspopup="menu" aria-expanded="${menuOpen}">${DOTS}</button>`;
        const acts = `<div class="pl-acts"><button type="button" class="primary" data-act="open-table" data-key="open-table">${esc(t.openTable)}</button>${more}</div>`;

        // The tiles (K8.2): only "without citation" leads on (the Table's chip).
        const s = listSummary(index, list);
        const tiles: Array<{ v: string; k: string; link?: string }> = [];
        if (s.left !== undefined) tiles.push({ v: `${fmtNum(s.left)} / ${fmtNum(s.persons)}`, k: t.sum.left });
        tiles.push({ v: fmtNum(s.persons), k: t.sum.persons });
        tiles.push({ v: s.birthMin === null ? '–' : s.birthMin === s.birthMax ? String(s.birthMin) : `${s.birthMin}–${s.birthMax}`, k: t.sum.birth });
        tiles.push({ v: fmtNum(s.withPhoto), k: t.sum.photo });
        tiles.push({ v: fmtNum(s.withCitation), k: t.sum.cite, link: s.noCite > 0 && s.persons > 0 ? t.sum.noCite(s.noCite) : undefined });
        tiles.push({ v: fmtNum(s.withStory), k: t.sum.story });
        const tilesHtml = `<div class="pl-tiles${tiles.length > 5 ? ' pl-tiles--6' : ''}">${tiles.map(x => `<div class="pl-tile${x.k === t.sum.birth ? ' pl-tile--wide' : ''}"><span class="pl-tile-v">${esc(x.v)}</span><span class="pl-tile-k">${esc(x.k)}</span>`
            + (x.link ? `<button type="button" class="pl-tile-link" data-act="no-cite" data-key="no-cite">${esc(x.link)}</button>` : '') + '</div>').join('')}</div>`;

        // The people.
        const ids = listPersonIds(index, list);
        const sortOpen = st.menu?.kind === 'sort';
        const sortBtn = `<button type="button" class="pl-sort" data-act="sort" data-key="sort" aria-haspopup="menu" aria-expanded="${sortOpen}">${esc(t.sortBy(t.sort[list.sort]))}<span class="pl-caret" aria-hidden="true">▾</span></button>`;
        // D2b: the checklist's All / Left / Done segment goes between the title and the sort.
        const peopleHead = `<div class="pl-people-head"><span class="pl-people-title">${esc(t.people(ids.length))}</span><span class="pl-head-gap"></span>${sortBtn}</div>`;
        let people: string;
        if (ids.length === 0) {
            const empty = list.rule?.kind === 'added' ? t.addedNone(ADDED_SINCE) : t.emptyList;
            const add = !ro && !auto && personListHooks.addPerson
                ? `<button type="button" class="secondary" data-act="add-person" data-key="add-person-empty">${esc(t.addPerson)}</button>` : '';
            people = `<div class="pl-people pl-people--empty"><p class="pl-empty-text">${esc(empty)}</p>${add}</div>`;
        } else {
            people = `<div class="pl-people" role="list" aria-label="${esc(t.people(ids.length))}">${this.personListRowsHtml(list, ids.slice(0, LIST_DETAIL_ROWS), narrow)}</div>`;
        }
        const footParts: string[] = [];
        if (!ro && !auto && ids.length > 0 && personListHooks.addPerson) {
            footParts.push(`<button type="button" class="pl-link" data-act="add-person" data-key="add-person">+ ${esc(t.addPerson)}</button>`);
        }
        if (ids.length > LIST_DETAIL_ROWS) {
            footParts.push(`<span class="pl-foot-note">${esc(t.large(LIST_DETAIL_ROWS, ids.length))}</span>`);
            footParts.push(`<button type="button" class="pl-link" data-act="open-table" data-key="open-table-foot">${esc(t.openTable)}</button>`);
        }
        const foot = footParts.length ? `<div class="pl-foot">${footParts.join('')}</div>` : '';

        return `${nameRow}${ruleRow}${note}${acts}${tilesHtml}${peopleHead}${people}${foot}`;
    },

    /** The people's rows: position, name, years, what the order goes by, × (a fixed list). */
    personListRowsHtml(list: PersonList, ids: PersonId[], narrow: boolean): string {
        const t = strings.lists;
        const data = DataManager.getData();
        const ro = DataManager.listsReadOnly();
        const removable = !ro && !list.dynamic;
        const rule = list.rule;
        const byRule = rule && (rule.kind === 'ancestors' || rule.kind === 'descendants') && list.sort === 'gen';
        const gens = byRule ? listGenerations(DataManager.getLineageIndex(), list, ids) : null;
        const metaOf = (id: PersonId): { text: string; quiet?: boolean } => {
            const p = data.persons[id];
            if (gens && rule) {
                const g = gens.get(id) ?? 0;
                return { text: g === 0 ? t.ruleSelf : rule.kind === 'ancestors' ? strings.treeOverview.ancestorGeneration(g) : strings.treeOverview.descendantGeneration(g) };
            }
            if (list.sort === 'added') {
                const d = shortDate(p?.addedAt, true);
                return d ? { text: d } : { text: t.earlier, quiet: true };
            }
            return { text: p?.birthPlace ?? '' };
        };
        return ids.map((id, i) => {
            const p = data.persons[id];
            if (!p) return '';
            const name = shownName(p);
            const meta = metaOf(id);
            // D2b: the drag handle (manual order) and the checklist's box go before the name.
            const x = removable && !narrow
                ? `<button type="button" class="pl-x" data-act="remove" data-key="x-${esc(id)}" aria-label="${esc(`${t.remove}: ${name}`)}" title="${esc(t.remove)}"><span aria-hidden="true">×</span></button>` : '';
            const dots = removable && narrow
                ? `<button type="button" class="pl-dots pl-person-dots" data-act="person-menu" data-key="pdots-${esc(id)}" aria-label="${esc(`${t.actions}: ${name}`)}" aria-haspopup="menu">${DOTS}</button>` : '';
            return `<div class="pl-person" role="listitem" data-pid="${esc(id)}"><span class="pl-num">${i + 1}</span>`
                + `<span class="pl-pname" title="${esc(name)}">${esc(name)}</span><span class="pl-years">${esc(cardYears(p))}</span>`
                + `<span class="pl-meta${meta.quiet ? ' is-quiet' : ''}" title="${esc(meta.text)}">${esc(meta.text)}</span>${x}${dots}</div>`;
        }).join('');
    },

    /** The rows of a list's ⋯: Open in Table · Rename · Duplicate · (D2b, D5 rows) · Delete. */
    personListMenuRows(list: PersonList): ListMenuRow[] {
        const t = strings.lists;
        const rows: ListMenuRow[] = [
            { id: 'open', label: t.openTable, run: () => personListHooks.openInTable(this, list.id) },
            { id: 'rename', label: t.menu.rename, run: () => this.startPersonListRename(list.id) },
            { id: 'dup', label: t.menu.dup, run: () => this.duplicatePersonListUi(list.id) },
        ];
        for (const extra of personListHooks.listMenu) rows.push(...extra(this, list));
        rows.push({ id: 'delete', label: t.menu.delete, danger: true, run: () => this.deletePersonListUi(list.id) });
        return rows;
    },

    /** The open popup (a list's ⋯, the sort choice) as markup; placed after drawing. */
    personListsMenuHtml(): string {
        const st = state!;
        const menu = st.menu;
        if (!menu) return '';
        const t = strings.lists;
        if (menu.kind === 'sort') {
            const list = st.selId ? DataManager.getPersonList(st.selId) : undefined;
            if (!list) return '';
            const ro = DataManager.listsReadOnly();
            const items = PERSON_LIST_SORTS.map(s => {
                const off = s === 'manual' && list.dynamic;
                const on = list.sort === s;
                const sub = off ? `<span class="pl-menu-sub">${esc(t.manualOff)}</span>` : '';
                return `<button type="button" class="pl-menu-item" role="menuitemradio" aria-checked="${on}" data-act="set-sort" data-sort="${s}" data-key="sort-${s}"${off || ro ? ' aria-disabled="true"' : ''}>`
                    + `<span class="pl-menu-label">${esc(t.sort[s])}${sub}</span><span class="pl-menu-check" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
            }).join('');
            return `<div class="pl-menu" role="menu" aria-label="${esc(t.sortBy(t.sort[list.sort]))}" data-anchor="sort">${items}</div>`;
        }
        const list = DataManager.getPersonList(menu.listId);
        if (!list) return '';
        const rows = this.personListMenuRows(list);
        const items = rows.map((r, i) => {
            const sep = r.id === 'rename' || r.id === 'delete' ? '<div class="pl-menu-sep" role="separator"></div>' : '';
            return `${i ? sep : ''}<button type="button" class="pl-menu-item${r.danger ? ' is-danger' : ''}" role="menuitem" data-act="menu-run" data-run="${esc(r.id)}" data-key="menu-${esc(r.id)}">`
                + `<span class="pl-menu-label">${esc(r.label)}${r.sub ? `<span class="pl-menu-sub">${esc(r.sub)}</span>` : ''}</span><span class="pl-menu-check" aria-hidden="true">${r.checked ? '✓' : ''}</span></button>`;
        }).join('');
        const anchor = menu.from === 'detail' ? 'menu-detail' : `row:${menu.listId}`;
        return `<div class="pl-menu" role="menu" aria-label="${esc(listDisplayName(list))}" data-anchor="${esc(anchor)}">${items}</div>`;
    },

    /** Put the open popup under (or above) its button, inside the dialog. */
    placePersonListsMenu(): void {
        const modal = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .pl-modal`);
        const menu = modal?.querySelector<HTMLElement>('.pl-menu');
        if (!modal || !menu) return;
        const anchorKey = menu.dataset.anchor ?? '';
        const anchor = anchorKey === 'sort' ? modal.querySelector<HTMLElement>('[data-act="sort"]')
            : anchorKey === 'menu-detail' ? modal.querySelector<HTMLElement>('[data-act="menu-detail"]')
                : modal.querySelector<HTMLElement>(`.pl-row[data-list="${CSS.escape(anchorKey.slice(4))}"] .pl-dots`);
        if (!anchor) return;
        const box = modal.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        let left = Math.min(a.right - box.left - w, box.width - w - 8);
        if (anchorKey.startsWith('row:')) left = Math.min(a.left - box.left, box.width - w - 8);
        left = Math.max(8, left);
        let top = a.bottom - box.top + 4;
        if (top + h > box.height - 8) top = Math.max(8, a.top - box.top - h - 4);
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    },

    /** A list's ⋯: a popup by its button; on a phone a sheet from below. */
    openPersonListMenu(listId: string, from: 'row' | 'detail'): void {
        const st = state;
        const list = DataManager.getPersonList(listId);
        if (!st || !list || DataManager.listsReadOnly()) return;
        if (isNarrow()) {
            st.menu = null;
            const rows = this.personListMenuRows(list);
            const blocks = [
                { rows: rows.filter(r => r.id === 'open'), divider: false },
                { rows: rows.filter(r => r.id !== 'open' && r.id !== 'delete'), divider: true },
                { rows: rows.filter(r => r.id === 'delete'), divider: true },
            ].map(b => ({ ...b, rows: b.rows.map(r => ({ label: r.label, sub: r.sub, danger: r.danger, value: r.checked ? '✓' : undefined, id: `pl-sheet-${r.id}`, run: r.run })) }));
            this.presentMenuSheet(listDisplayName(list), blocks, { subtitle: rowMeta(list) });
            return;
        }
        st.menu = st.menu?.kind === 'list' && st.menu.listId === listId && st.menu.from === from ? null : { kind: 'list', listId, from };
        this.renderPersonLists();
        if (st.menu) this.focusPersonLists('.pl-menu .pl-menu-item');
    },

    /** A person's ⋯ on a phone (no × there): Remove from the list. D2b adds Move up / down. */
    openPersonListPersonMenu(listId: string, personId: PersonId): void {
        const list = DataManager.getPersonList(listId);
        const p = DataManager.getData().persons[personId];
        if (!list || !p || DataManager.listsReadOnly() || list.dynamic) return;
        const t = strings.lists;
        this.presentMenuSheet(shownName(p), [{ rows: [
            { label: t.remove, id: 'pl-sheet-remove', icon: '×', run: () => { DataManager.removePersonsFromList(listId, [personId]); } },
        ] }], { subtitle: cardYears(p) || undefined });
    },

    selectPersonList(listId: string, focus = true): void {
        const st = state;
        if (!st) return;
        if (st.selId !== listId) {
            st.selId = listId;
            st.renaming = false;
        }
        st.menu = null;
        if (isNarrow()) st.view = 'detail';
        this.renderPersonLists();
        if (focus) this.focusPersonLists(isNarrow() ? '[data-act="back"]' : `.pl-row[data-list="${CSS.escape(listId)}"]`);
    },

    startPersonListRename(listId: string): void {
        const st = state;
        const list = DataManager.getPersonList(listId);
        if (!st || !list || DataManager.listsReadOnly()) return;
        st.selId = listId;
        st.menu = null;
        st.renaming = true;
        st.draft = listDisplayName(list);
        if (isNarrow()) st.view = 'detail';
        this.renderPersonLists();
        this.focusPersonLists('[data-key="name-input"]');
    },

    /** Save the edited name; an empty or taken one is not saved (the field says why). True when the editing ended. */
    commitPersonListRename(): boolean {
        const st = state;
        if (!st || !st.renaming || !st.selId) return true;
        const list = DataManager.getPersonList(st.selId);
        const draft = st.draft.trim();
        if (!list) { st.renaming = false; return true; }
        if (!draft || DataManager.isPersonListNameTaken(draft, list.id)) return false;
        st.renaming = false;
        if (draft !== listDisplayName(list)) DataManager.renamePersonList(list.id, draft);
        this.renderPersonLists();
        this.focusPersonLists(isNarrow() ? '[data-act="menu-detail"]' : '[data-key="name"]');
        return true;
    },

    duplicatePersonListUi(listId: string): void {
        const copy = DataManager.duplicatePersonList(listId);
        if (copy && state) this.selectPersonList(copy.id);
    },

    /** Delete without asking (2e): the toast offers Undo; the next list is chosen. */
    deletePersonListUi(listId: string): void {
        const st = state;
        if (!st) return;
        const shown = shownLists(st);
        const at = shown.findIndex(l => l.id === listId);
        if (!DataManager.deletePersonList(listId)) return;
        st.menu = null;
        if (st.selId === listId) {
            const rest = shown.filter(l => l.id !== listId);
            st.selId = rest[Math.min(Math.max(at, 0), rest.length - 1)]?.id ?? null;
            st.renaming = false;
            if (isNarrow()) st.view = 'list';
        }
        this.renderPersonLists();
        this.focusPersonLists(null);
    },

    setPersonListSortUi(sort: PersonListSort): void {
        const st = state;
        if (!st?.selId) return;
        const list = DataManager.getPersonList(st.selId);
        st.menu = null;
        if (list && !(sort === 'manual' && list.dynamic) && list.sort !== sort) DataManager.setPersonListSort(list.id, sort);
        this.renderPersonLists();
        this.focusPersonLists('[data-act="sort"]');
    },

    onPersonListsClick(e: MouseEvent): void {
        const st = state;
        const target = e.target as HTMLElement;
        if (!st) return;
        const el = target.closest<HTMLElement>('[data-act]');
        const act = el?.dataset.act;
        // A click beside an open popup closes it (and does nothing else).
        if (st.menu && !target.closest('.pl-menu') && act !== 'menu-row' && act !== 'menu-detail' && act !== 'sort') {
            st.menu = null;
            this.renderPersonLists();
            return;
        }
        const row = target.closest<HTMLElement>('.pl-row');
        if (!act) {
            if (row?.dataset.list) this.selectPersonList(row.dataset.list);
            return;
        }
        const listId = st.selId;
        switch (act) {
            case 'close': this.closePersonLists(); return;
            case 'back':
                st.view = 'list';
                st.renaming = false;
                st.menu = null;
                this.renderPersonLists();
                this.focusPersonLists(listId ? `.pl-row[data-list="${CSS.escape(listId)}"]` : null);
                return;
            case 'new': personListHooks.newList(this); return;
            case 'order':
                st.order = (el!.dataset.order as Order) ?? 'name';
                this.renderPersonLists();
                return;
            case 'menu-row': if (row?.dataset.list) this.openPersonListMenu(row.dataset.list, 'row'); return;
            case 'menu-detail': if (listId) this.openPersonListMenu(listId, 'detail'); return;
            case 'menu-run': {
                const menu = st.menu;
                if (menu?.kind !== 'list') return;
                const list = DataManager.getPersonList(menu.listId);
                const item = list ? this.personListMenuRows(list).find(r => r.id === el!.dataset.run) : undefined;
                st.menu = null;
                this.renderPersonLists();
                item?.run();
                return;
            }
            case 'sort':
                st.menu = st.menu?.kind === 'sort' ? null : { kind: 'sort' };
                this.renderPersonLists();
                if (st.menu) this.focusPersonLists('.pl-menu [aria-checked="true"]');
                return;
            case 'set-sort':
                if (el!.getAttribute('aria-disabled') === 'true') return;
                this.setPersonListSortUi(el!.dataset.sort as PersonListSort);
                return;
            case 'rename': if (listId) this.startPersonListRename(listId); return;
            case 'open-table': if (listId) personListHooks.openInTable(this, listId); return;
            case 'no-cite': if (listId) personListHooks.openInTable(this, listId, { noSource: true }); return;
            case 'edit-rule': if (listId) personListHooks.editRule?.(this, listId); return;
            case 'add-person': if (listId) personListHooks.addPerson?.(this, listId); return;
            case 'fill': {
                if (!listId) return;
                if (DataManager.fillPersonList(listId) === 0) this.showToast(strings.lists.toast.full);
                return;
            }
            case 'delete': if (listId) this.deletePersonListUi(listId); return;
            case 'remove': {
                const pid = target.closest<HTMLElement>('.pl-person')?.dataset.pid as PersonId | undefined;
                if (listId && pid) {
                    // Keep the keyboard in the rows: the next person's ×, else the previous one's.
                    const next = target.closest('.pl-person')?.nextElementSibling ?? target.closest('.pl-person')?.previousElementSibling;
                    const nextKey = (next as HTMLElement | null)?.querySelector<HTMLElement>('.pl-x')?.dataset.key;
                    DataManager.removePersonsFromList(listId, [pid]);
                    this.renderPersonLists();
                    this.focusPersonLists(nextKey ? `[data-key="${CSS.escape(nextKey)}"]` : '[data-act="sort"]');
                }
                return;
            }
            case 'person-menu': {
                const pid = target.closest<HTMLElement>('.pl-person')?.dataset.pid as PersonId | undefined;
                if (listId && pid) this.openPersonListPersonMenu(listId, pid);
                return;
            }
        }
    },

    onPersonListsKey(e: KeyboardEvent): void {
        const st = state;
        const target = e.target as HTMLElement;
        if (!st) return;
        // The name being edited: Enter saves, Escape (the global handler) returns.
        if (target.classList.contains('pl-name-input')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.commitPersonListRename();
            }
            return;
        }
        // An open popup: arrows move, Home / End jump (Escape: the global handler).
        const menu = target.closest<HTMLElement>('.pl-menu');
        if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
            e.preventDefault();
            const items = [...menu.querySelectorAll<HTMLElement>('.pl-menu-item')];
            const i = items.indexOf(target.closest('.pl-menu-item') as HTMLElement);
            const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[n]?.focus();
            return;
        }
        if (e.key === 'Tab' && st.menu) {
            st.menu = null;
            this.renderPersonLists();
            return;
        }
        if (target.dataset.key === 'name' && (e.key === 'Enter' || e.key === ' ' || e.key === 'F2')) {
            e.preventDefault();
            if (st.selId) this.startPersonListRename(st.selId);
            return;
        }
        if (e.key === 'F2' && st.selId && !target.closest('input')) {
            e.preventDefault();
            this.startPersonListRename(st.selId);
            return;
        }
        const row = target.classList.contains('pl-row') ? target : null;
        if (!row) return;
        const rows = [...document.querySelectorAll<HTMLElement>(`#${OVERLAY_ID} .pl-row`)];
        const i = rows.indexOf(row);
        const go = (n: number): void => {
            const r = rows[Math.max(0, Math.min(rows.length - 1, n))];
            if (!r?.dataset.list) return;
            if (isNarrow()) {
                rows.forEach(x => { x.tabIndex = x === r ? 0 : -1; });
                r.focus();
            } else this.selectPersonList(r.dataset.list);
        };
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); go(i + 1); return;
            case 'ArrowUp': e.preventDefault(); go(i - 1); return;
            case 'Home': e.preventDefault(); go(0); return;
            case 'End': e.preventDefault(); go(rows.length - 1); return;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (!row.dataset.list) return;
                if (isNarrow()) this.selectPersonList(row.dataset.list);
                else if (e.key === 'Enter') this.startPersonListRename(row.dataset.list);
                return;
            case 'Delete':
                e.preventDefault();
                if (row.dataset.list && !DataManager.listsReadOnly()) this.deletePersonListUi(row.dataset.list);
                return;
        }
    },

    onPersonListsInput(e: Event): void {
        const st = state;
        const el = e.target as HTMLElement;
        if (!st || !(el instanceof HTMLInputElement)) return;
        if (el.classList.contains('pl-search')) {
            st.search = el.value;
            this.renderPersonLists();
        } else if (el.classList.contains('pl-name-input')) {
            st.draft = el.value;
            // Only the warning under the field changes: redraw it without losing the caret.
            const draft = st.draft.trim();
            const taken = !!draft && !!st.selId && DataManager.isPersonListNameTaken(draft, st.selId);
            el.setAttribute('aria-invalid', String(taken || !draft));
            const row = el.closest('.pl-name-row');
            let err = row?.nextElementSibling?.classList.contains('pl-name-err') ? row.nextElementSibling as HTMLElement : null;
            if (taken) {
                if (!err) {
                    err = document.createElement('p');
                    err.className = 'pl-name-err';
                    err.id = 'pl-name-err';
                    row?.after(err);
                }
                err.textContent = strings.lists.save.dup(DataManager.suggestPersonListName(draft, st.selId!));
                el.setAttribute('aria-describedby', 'pl-name-err');
            } else {
                err?.remove();
                el.removeAttribute('aria-describedby');
            }
        }
    },

    /** Leaving the name field saves it (an empty or taken name: the old one stays). */
    onPersonListsFocusOut(e: FocusEvent): void {
        const st = state;
        const el = e.target as HTMLElement;
        if (!st || !st.renaming || !el.classList.contains('pl-name-input')) return;
        // A redraw takes the field away too: only a real move of the focus elsewhere ends the editing.
        setTimeout(() => {
            if (!state || !state.renaming) return;
            const now = document.activeElement;
            if (now instanceof HTMLElement && now.classList.contains('pl-name-input')) return;
            if (!this.commitPersonListRename()) {
                state.renaming = false;
                this.renderPersonLists();
            }
        }, 0);
    },
});
