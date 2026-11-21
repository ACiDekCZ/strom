/**
 * The choice of the window's selection (spec 098 §2, §10): "Selection ▾" in
 * the tree view's toolbar (Family, Descendants, the fan; the tablet's at the
 * right end of its bar), the pill's label ▾ and the phone's sheet (More →
 * Selection). One list for every kind of selection: no selection, the family
 * lines, the people a query finds, the ancestors and descendants of the
 * person in focus (or another one), the research lines and the lists of
 * people; the ancestors' and descendants' person and generations set on top.
 * The state lives in src/ui/view-selection-ui.ts, the markup in
 * src/rod-picker.ts (selectionPickerHtml), the keys and the search in
 * src/ui/rod-picker-ui.ts (wireRodPicker).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { rods } from '../lineage.js';
import {
    SelectionPickRow, SelectionPickerMarkup, SelectionPickerTexts, rodPickKey, rodPickerItems, rodPickerSmallItems, selectionFoundRowsHtml,
    selectionIcon, selectionPickerHtml,
} from '../rod-picker.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { listDisplayName, listKind, listSummary, ruleLabel } from '../person-lists.js';
import { researchLinesOf, selectionLines } from './table-view/table-research.js';
import { researchTableLive } from './research-ui.js';
import { filterAndSort } from '../person-picker.js';
import { shownName } from '../person-name.js';
import { displayYear } from '../dates.js';
import { isPhoneBar } from '../breakpoints.js';
import type { Person, PersonId, PersonList } from '../types.js';
import { encodeSelectionRef, decodeSelectionRef, selectionLabel, selectionPersonIds, type SelectionRef } from '../view-selection.js';
import { wireRodPicker } from './rod-picker-ui.js';
import { listKindIcon } from './list-kind-icon.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import type { NewPersonListOptions } from './person-list-new-ui.js';
import { uiModule } from './module.js';
import { clearSelection, getSelection, selectionIndex, selectionIndexGeneration, selectionText, setSelection } from './view-selection-ui.js';

/** The axis of the lines' bars (the tree pages' introduction). */
const AXIS_LO = 1650;
const AXIS_HI = 2030;
/** The generations' stepper: 1 … 10, then all. */
const MAX_GENERATIONS = 10;
/** People a query finds at most (each with "Ancestors:" and "Descendants:"). */
const FOUND_LIMIT = 5;
const HOST_DELAY_MS = 150;
/** Swipe down from the sheet's head closes it (the list itself scrolls). */
const SHEET_SWIPE_CLOSE_PX = 80;

let hostAbort: AbortController | null = null;
let hostKey = '';
let hostGeneration = -1;
/** The person in focus when the toolbar's list was built (its Ancestors and descendants rows). */
let hostFocus: string | null = null;
let hostTimer: ReturnType<typeof setTimeout> | null = null;

/** The selection, the data or the person in focus changed since the toolbar's list was built. */
function hostStale(): boolean {
    return hostKey !== currentHostKey() || hostGeneration !== selectionIndexGeneration() || hostFocus !== TreeRenderer.getFocusPersonId();
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The window's selection is offered (spec 098 §2, §10): in every tree that has
 * someone to choose; an empty tree has nobody to select, and its bar keeps the
 * room for the search field.
 */
export function selectionOffered(): boolean {
    const persons = DataManager.getData()?.persons;
    if (!persons) return false;
    for (const id in persons) if (!persons[id as PersonId].isPlaceholder) return true;
    return false;
}

/** The tree has a line worth choosing (not only small families): the section Family lines is offered (§2). */
export function rodPickerOffered(): boolean {
    return rods(selectionIndex().index).some(r => !r.small);
}

function pickerTexts(): SelectionPickerTexts {
    const s = strings.selection;
    return {
        button: s.button, pickLabel: s.pickLabel, search: s.search, none: s.none, noneSub: s.noneSub,
        secRods: s.secRods, secPerson: s.secPerson, secPersons: s.secPersons, secLines: s.secLines, secLists: s.secLists,
        otherPerson: s.otherPerson, current: s.current, person: s.person, changePerson: s.changePerson,
        generations: s.generations, genAll: s.genAll, noLists: s.noLists, noMatch: s.noMatch, saveList: s.saveList, manage: s.manage,
        other: strings.familyPages.otherFams, members: strings.familyPages.nPersons,
        fewer: strings.focus.depthDecrease, more: strings.focus.depthIncrease,
    };
}

function realPerson(id: PersonId | null | undefined): Person | null {
    if (!id) return null;
    const p = DataManager.getData().persons[id];
    return p && !p.isPlaceholder ? p : null;
}

/** The people of a selection (0 when gone). */
function countOf(ref: SelectionRef): number {
    const { index } = selectionIndex();
    return selectionPersonIds(index.data, index, ref)?.size ?? 0;
}

/** "1868 – 1931 · Hamburg": what tells a found person apart. */
function personSub(p: Person): string {
    const b = displayYear(p.birthDate);
    const d = displayYear(p.deathDate);
    const years = b || d ? `${b}${d ? ` – ${d}` : ''}` : '';
    const place = (p.birthPlace ?? '').split(',')[0].trim();
    return [years, place].filter(Boolean).join(' · ');
}

/** "Ancestors: X" and "Descendants: X" of a person (the current one marked). */
function personRows(id: PersonId, sub: string): SelectionPickRow[] {
    const cur = getSelection().ref;
    return (['ancestors', 'descendants'] as const).map(kind => {
        const ref: SelectionRef = { kind, personId: id };
        return {
            sel: encodeSelectionRef(ref), label: selectionText(ref), sub, count: countOf(ref), icon: selectionIcon(kind),
            current: cur?.kind === kind && cur.personId === id,
        };
    });
}

/** The line under a list's name: its kind, and the rule of an automatic one or what a checklist has left. */
function listSub(list: PersonList): string {
    const kind = listKind(list);
    const word = strings.lists.kind[kind];
    if (list.builtin) return word;
    const { index } = selectionIndex();
    if (kind === 'auto') return list.rule ? `${word} · ${ruleLabel(list.rule, index)}` : word;
    if (kind === 'work') {
        const s = listSummary(index, list);
        return `${word} · ${strings.lists.left(s.left ?? 0, s.persons)}`;
    }
    return word;
}

/** The rows of the people a query finds (at most five, without diacritics). */
function foundRowsHtml(query: string): string {
    const data = DataManager.getData();
    const persons = Object.values(data.persons).filter(p => p && !p.isPlaceholder);
    const found = filterAndSort(query, persons, data).slice(0, FOUND_LIMIT);
    return selectionFoundRowsHtml(found.flatMap(p => personRows(p.id, personSub(p))));
}

/** Everything the choice shows, from the window's selection and the open tree. */
function pickerMarkup(): SelectionPickerMarkup {
    const { index } = selectionIndex();
    const data = index.data;
    const lang = getCurrentLanguage();
    const ref = getSelection().ref;
    const current = ref ? encodeSelectionRef(ref) : '';
    const items = rodPickerItems(index, undefined, undefined, lang);
    const offered = rodPickerOffered();
    const focus = realPerson(TreeRenderer.getFocusPersonId());
    // An ended line is not offered, unless it is the selection now; the bridge's states as the Table reads them.
    const lines: SelectionPickRow[] = selectionLines(data, researchTableLive().places, ref?.kind === 'line' ? ref.directionId : null).map(l => {
        const r: SelectionRef = { kind: 'line', directionId: l.id };
        const name = l.name || l.id;
        return { sel: encodeSelectionRef(r), label: name, sub: strings.selection.lineSub, count: countOf(r), icon: selectionIcon('line'), q: rodPickKey(name), current: encodeSelectionRef(r) === current };
    });
    // In the order of the dialog Lists of people (the ready-made one first).
    const lists: SelectionPickRow[] = DataManager.getPersonLists()
        .map(l => {
            const r: SelectionRef = { kind: 'list', listId: l.id };
            const name = listDisplayName(l);
            return { sel: encodeSelectionRef(r), label: name, sub: listSub(l), count: countOf(r), icon: listKindIcon(listKind(l), 15), q: rodPickKey(name), current: encodeSelectionRef(r) === current };
        });
    let block: SelectionPickerMarkup['block'] = null;
    if (ref && (ref.kind === 'ancestors' || ref.kind === 'descendants')) {
        const p = realPerson(ref.personId);
        if (p) block = { title: selectionText(ref), count: countOf(ref), person: shownName(p), generations: ref.generations };
    }
    const label = ref ? selectionLabel(ref, data, selectionIndex().labels) : null;
    return {
        label, current, treeCount: items[0]?.members ?? 0,
        rods: offered ? { items, small: rodPickerSmallItems(index, lang), lo: AXIS_LO, hi: AXIS_HI } : null,
        focus: focus ? personRows(focus.id, strings.selection.focusSub) : [],
        lines, lists, block,
        canSave: !!ref && ref.kind !== 'list' && !DataManager.listsReadOnly(),
        texts: pickerTexts(),
    };
}

/**
 * A few selections to change to at once (the phone's map scope sheet, §10
 * 10e): the family lines, the ancestors of the person in focus and the
 * lists, the current one left out, at most `limit` (two lines first, then
 * the ancestors, the lists, more lines).
 */
export function selectionQuickRows(limit = 5): SelectionPickRow[] {
    const m = pickerMarkup();
    const rodIc = selectionIcon('rod');
    const rods: SelectionPickRow[] = (m.rods?.items ?? [])
        .filter(i => i.id !== 'tree' && i.id !== 'other')
        .map(i => ({ sel: `rod:${encodeURIComponent(i.id)}`, label: i.label, count: i.members, icon: rodIc }))
        .filter(r => r.sel !== m.current);
    const anc = m.focus.filter(r => r.sel.startsWith('anc:') && !r.current);
    const lists = m.lists.filter(r => !r.current);
    const out: SelectionPickRow[] = [...rods.slice(0, 2), ...anc, ...lists, ...rods.slice(2)];
    return out.slice(0, limit);
}

/** A pick of the list: 'none' clears the selection, a ref chooses it. */
function pickSelection(sel: string, origin: 'picker' | 'map' = 'picker'): void {
    if (sel === 'none') { clearSelection(); return; }
    const ref = decodeSelectionRef(sel);
    if (ref) setSelection(ref, origin);
}

/** The selection as the dialog "Save as list of people" takes it. */
function saveListOptions(ref: SelectionRef): NewPersonListOptions | null {
    switch (ref.kind) {
        case 'rod': return { source: 'rod', rule: { kind: 'rods', rodIds: [ref.rodId] } };
        case 'line': {
            const line = researchLinesOf(DataManager.getData()).lines.find(l => l.id === ref.directionId);
            return { source: 'line', rule: { kind: 'line', directionId: ref.directionId, ...(line?.name ? { lineName: line.name } : {}) } };
        }
        case 'ancestors':
        case 'descendants':
            return { source: 'selection', rule: { kind: ref.kind, personId: ref.personId, ...(ref.generations ? { generations: ref.generations } : {}) } };
        case 'list': return null;
    }
}

/** The selection as a key of the built choice (built again when it changes). */
function selectionKey(): string {
    const ref = getSelection().ref;
    return ref ? encodeSelectionRef(ref) : '';
}

/** What the toolbar's choice was built for: the tree, the selection, the language. */
function currentHostKey(): string {
    return `${DataManager.getCurrentTreeId() ?? ''}|${selectionKey()}|${getCurrentLanguage()}`;
}

/** The next value of the generations' stepper: − from all to 10, + from 10 to all. */
export function stepGenerations(g: number | undefined, delta: number): number | undefined {
    if (delta < 0) return g === undefined ? MAX_GENERATIONS : Math.max(1, g - 1);
    if (g === undefined) return undefined;
    return g + 1 > MAX_GENERATIONS ? undefined : g + 1;
}

export const selectionPickerMethods = uiModule({
    /**
     * The choice's own controls (wireRodPicker has the rows, the search, the
     * keys): "Another person…", the block's "Change…" and generations, the
     * footer. `close` closes the choice (and the sheet), `popHost` holds the
     * person popover.
     */
    wireSelectionPickerExtras(pick: HTMLDetailsElement, popHost: HTMLElement, close: () => void, signal?: AbortSignal): void {
        let closePop: (() => void) | null = null;
        const openPop = (anchor: HTMLElement, selectedId: PersonId | null, onPick: (id: PersonId) => void): void => {
            if (closePop) { closePop(); return; }
            const suggested: Array<{ id: PersonId; meta: string }> = [];
            const focus = TreeRenderer.getFocusPersonId();
            if (focus) suggested.push({ id: focus, meta: strings.treeOverview.inFocus });
            const treeId = DataManager.getCurrentTreeId();
            if (treeId) for (const id of readRecent(treeId)) suggested.push({ id, meta: strings.treeOverview.recent });
            closePop = openPersonPopover({
                host: popHost, anchor, data: DataManager.getData(), selectedId, suggested,
                labels: { search: strings.lists.pickSearch, list: strings.lists.new.person, noMatch: strings.treeOverview.noMatch },
                onClose: () => { closePop = null; },
                onPick,
            });
        };
        pick.addEventListener('toggle', () => { if (!pick.open) closePop?.(); }, { signal });
        pick.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const other = t.closest<HTMLElement>('.sp-selpick-other');
            if (other) {
                e.preventDefault();
                // Another person's two rows in place of the person in focus's (the choice stays open).
                openPop(other, null, (id) => {
                    const p = realPerson(id);
                    const list = pick.querySelector<HTMLElement>('.sp-rodpick-list');
                    const head = list?.querySelector<HTMLElement>('.sp-selpick-sh[data-sec="focus"]');
                    if (!p || !list || !head) return;
                    list.querySelectorAll('li[data-sec="focus"]:not(.sp-selpick-sh)').forEach(li => li.remove());
                    head.insertAdjacentHTML('afterend', selectionFoundRowsHtml(personRows(id, personSub(p)), 'focus'));
                    head.nextElementSibling?.querySelector<HTMLElement>('.sp-rodpick-a')?.focus({ preventScroll: true });
                });
                return;
            }
            const ref = getSelection().ref;
            const change = t.closest<HTMLElement>('.sp-selpick-change');
            if (change && ref && (ref.kind === 'ancestors' || ref.kind === 'descendants')) {
                e.preventDefault();
                openPop(change, ref.personId, (id) => {
                    close();
                    setSelection({ kind: ref.kind, personId: id, ...(ref.generations ? { generations: ref.generations } : {}) }, 'picker');
                });
                return;
            }
            const gen = t.closest<HTMLButtonElement>('.sp-selpick-gen button[data-gen]');
            if (gen && ref && (ref.kind === 'ancestors' || ref.kind === 'descendants')) {
                e.preventDefault();
                const g = stepGenerations(ref.generations, Number(gen.dataset.gen));
                const next: SelectionRef = { kind: ref.kind, personId: ref.personId, ...(g ? { generations: g } : {}) };
                setSelection(next, 'picker');
                // The block follows in place (the list is built again once closed).
                const block = pick.querySelector<HTMLElement>('.sp-selpick-cur');
                const value = block?.querySelector('.depth-stepper-value');
                if (value) value.textContent = g ? String(g) : strings.selection.genAll;
                const c = block?.querySelector('.sp-selpick-cur-c');
                if (c) c.textContent = `· ${strings.familyPages.nPersons(countOf(next))}`;
                const dec = block?.querySelector<HTMLButtonElement>('button[data-gen="-1"]');
                const inc = block?.querySelector<HTMLButtonElement>('button[data-gen="1"]');
                if (dec) dec.disabled = g === 1;
                if (inc) inc.disabled = g === undefined;
                if (document.activeElement === gen && gen.disabled) (gen === dec ? inc : dec)?.focus();
                return;
            }
            if (t.closest('.sp-selpick-save')) {
                e.preventDefault();
                const opts = ref ? saveListOptions(ref) : null;
                close();
                if (opts) this.showNewPersonList(opts);
                return;
            }
            if (t.closest('.sp-selpick-manage')) {
                e.preventDefault();
                close();
                this.showPersonLists();
            }
        }, { signal });
    },

    /**
     * The toolbar's choice (§2, §10): in Family, Descendants and the fan
     * (not on the timeline, the map, the table), in every tree; built again (a
     * moment after a change) when the selection, the tree or the language
     * changed, as it opens when the data or the person in focus did. Not while
     * it is open.
     */
    syncSelectionPickerHost(): void {
        const el = document.getElementById('view-rod-picker');
        if (!el) return;
        const view = TreeRenderer.getViewMode();
        const off = view === 'timeline' || view === 'map' || view === 'table' || !selectionOffered();
        if (off) { el.hidden = true; return; }
        const key = currentHostKey();
        const built = !!el.querySelector('details.sp-rodpick');
        // The same tree and selection after a change of the data: the list is built again when it
        // opens, not after every edit; a chosen selection's name may have changed, so it is now.
        if (key === hostKey && built && (selectionIndexGeneration() === hostGeneration || !getSelection().ref)) {
            el.hidden = false;
            return;
        }
        if (el.querySelector('details[open]')) return;
        if (hostTimer) return;
        hostTimer = setTimeout(() => {
            hostTimer = null;
            this.renderSelectionPickerHost();
        }, built ? HOST_DELAY_MS : 0);
    },

    /** Build the toolbar's choice now (`reopen`: built again as it opens, the data having changed). */
    renderSelectionPickerHost(reopen = false): void {
        const el = document.getElementById('view-rod-picker');
        if (!el) return;
        if (!reopen && el.querySelector('details[open]')) return;
        if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
        hostKey = currentHostKey();
        hostGeneration = selectionIndexGeneration();
        hostFocus = TreeRenderer.getFocusPersonId();
        // A query typed before the open's toggle came (it arrives as a task of its own) stays.
        const typed = reopen ? el.querySelector<HTMLInputElement>('.sp-rodpick-q')?.value ?? '' : '';
        hostAbort?.abort();
        hostAbort = null;
        ensureFamilyPagesAppCss();
        const m = pickerMarkup();
        el.innerHTML = selectionPickerHtml(m);
        const pick = el.querySelector<HTMLDetailsElement>('details.sp-rodpick');
        if (!pick) return;
        const summary = pick.querySelector<HTMLElement>('summary');
        if (summary) {
            summary.title = m.label ? selectionText(getSelection().ref!) : strings.selection.pickLabel;
            summary.setAttribute('aria-expanded', 'false');
            summary.setAttribute('aria-haspopup', 'listbox');
        }
        hostAbort = new AbortController();
        const signal = hostAbort.signal;
        // A click (or Enter, Space) opening a list built before the selection, the data or the person
        // in focus changed (the deferred rebuild not yet done): the list again, open, in this click,
        // so the open list is the one that stays (built again at the toggle, it was replaced a task
        // after it showed).
        summary?.addEventListener('click', (e) => {
            if (pick.open || !hostStale()) return;
            e.preventDefault();
            this.renderSelectionPickerHost(true);
        }, { signal });
        pick.addEventListener('toggle', () => {
            summary?.setAttribute('aria-expanded', String(pick.open));
            const chev = pick.querySelector('.sp-rodpick-chev');
            if (chev) chev.textContent = pick.open ? '▴' : '▾';
            if (pick.open && pick.isConnected && hostStale()) {
                // Opened another way before the deferred rebuild: the list again, open.
                this.renderSelectionPickerHost(true);
                return;
            }
            // Built again once closed when something changed while it was open.
            if (!pick.open) this.syncSelectionPickerHost();
        }, { signal });
        const pop = pick.querySelector<HTMLElement>('.sp-rodpick-pop') ?? el;
        this.wireSelectionPickerExtras(pick, pop, () => { pick.open = false; }, signal);
        wireRodPicker(el, pickSelection, { pick, signal, outside: document, markFirst: true, findPersons: foundRowsHtml });
        el.hidden = false;
        if (reopen) {
            pick.open = true;
            const q = pick.querySelector<HTMLInputElement>('.sp-rodpick-q');
            q?.focus({ preventScroll: true });
            if (q && typed) {
                q.value = typed;
                q.dispatchEvent(new Event('input'));
            }
        }
    },

    /**
     * The pill's label ▾ (§8): the toolbar's choice opened (desktop, tablet);
     * on the phone the sheet.
     */
    openSelectionPicker(): void {
        if (!isPhoneBar()) {
            const pick = document.querySelector<HTMLDetailsElement>('#view-rod-picker details.sp-rodpick');
            if (pick && !pick.closest<HTMLElement>('[hidden]') && pick.getClientRects().length > 0) {
                // After this click is over (a click outside closes the choice).
                setTimeout(() => {
                    pick.open = true;
                    pick.querySelector<HTMLInputElement>('.sp-rodpick-q')?.focus({ preventScroll: true });
                }, 0);
                return;
            }
        }
        this.showSelectionSheet();
    },

    /**
     * The choice as a popover of its own in `host` (the map's scope, §3):
     * built now, open at once (its button hidden by CSS). A pick sets the
     * window's selection (origin 'map') and then calls `onPicked`; a close
     * by any way (a pick, Escape, a click outside) calls `onClose` once.
     */
    mountSelectionPicker(host: HTMLElement, opts: { onPicked: (sel: string) => void; onClose: () => void; signal: AbortSignal }): void {
        ensureFamilyPagesAppCss();
        host.innerHTML = selectionPickerHtml(pickerMarkup());
        const pick = host.querySelector<HTMLDetailsElement>('details.sp-rodpick');
        if (!pick) return;
        const { signal } = opts;
        const close = (): void => { pick.open = false; };
        const pop = pick.querySelector<HTMLElement>('.sp-rodpick-pop') ?? host;
        this.wireSelectionPickerExtras(pick, pop, close, signal);
        wireRodPicker(host, (sel) => {
            close();
            pickSelection(sel, 'map');
            opts.onPicked(sel);
        }, { pick, signal, outside: document, markFirst: true, findPersons: foundRowsHtml });
        pick.open = true;
        pick.addEventListener('toggle', () => { if (!pick.open) opts.onClose(); }, { signal });
        pick.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault(), { signal });
        requestAnimationFrame(() => {
            if (!pick.isConnected) return;
            pick.querySelector<HTMLElement>('.sp-rodpick-list li[aria-current]')?.scrollIntoView({ block: 'nearest' });
            pick.querySelector<HTMLInputElement>('.sp-rodpick-q')?.focus({ preventScroll: true });
        });
    },

    /**
     * The phone's list (§10, 10c): a bottom sheet of the window's height less
     * 40px (beside the side bar when the phone is held sideways) with the
     * title, ×, the search field on top (focused only when tapped: no keyboard
     * over the list), the sections under it, rows of 52px, the footer.
     * Opened from More → Selection and from the pill's label.
     */
    showSelectionSheet(onPicked?: (sel: string) => void): void {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        ensureFamilyPagesAppCss();
        const title = strings.selection.sheetTitle;
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay rod-pick-overlay';
        overlay.innerHTML = `<div class="bottom-sheet rod-pick-sheet" role="dialog" aria-modal="true" aria-labelledby="rod-pick-sheet-title">`
            + `<div class="rod-pick-sheet-head"><div class="bottom-sheet-handle"></div>`
            + `<div class="rod-pick-sheet-bar"><h2 class="rod-pick-sheet-title" id="rod-pick-sheet-title">${esc(title)}</h2>`
            + `<button type="button" class="rod-pick-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div></div>`
            + selectionPickerHtml(pickerMarkup())
            + '</div>';
        const sheet = overlay.querySelector<HTMLElement>('.rod-pick-sheet')!;
        const pick = sheet.querySelector<HTMLDetailsElement>('details.sp-rodpick')!;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        sheet.querySelector('.rod-pick-sheet-x')?.addEventListener('click', close);
        // The list stays open in the sheet: a pick, Escape (its own) and nothing else closes it — and the sheet with it.
        wireRodPicker(sheet, (sel) => { close(); pickSelection(sel, onPicked ? 'map' : 'picker'); onPicked?.(sel); }, { pick, outside: new EventTarget(), markFirst: true, findPersons: foundRowsHtml });
        this.wireSelectionPickerExtras(pick, overlay, close);
        pick.addEventListener('toggle', () => { if (!pick.open) close(); });
        pick.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault());
        // Swipe down from the head closes (as the other sheets; the list scrolls on its own).
        const head = sheet.querySelector<HTMLElement>('.rod-pick-sheet-head')!;
        let startY = 0;
        head.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
        head.addEventListener('touchmove', (e) => {
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        head.addEventListener('touchend', (e) => {
            sheet.style.transition = '';
            if (e.changedTouches[0].clientY - startY > SHEET_SWIPE_CLOSE_PX) close();
            else sheet.style.transform = '';
        });
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        pick.open = true;
        // The chosen row in view (a long list scrolls to it).
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            sheet.querySelector<HTMLElement>('.sp-rodpick-list li[aria-current]')?.scrollIntoView({ block: 'nearest' });
            if (document.activeElement === document.body || !sheet.contains(document.activeElement)) {
                sheet.querySelector<HTMLElement>('.rod-pick-sheet-x')?.focus({ preventScroll: true });
            }
        });
    },
});
