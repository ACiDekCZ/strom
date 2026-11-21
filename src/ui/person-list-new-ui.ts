/**
 * The dialog New list / Save as list (spec 084 §3, §6, §15d, §16c).
 *
 * New list: a name and what the list is based on — Empty (people are added
 * by hand, or the people it was opened with), a family line, the ancestors
 * or descendants of a person (with the generations), a research line (only
 * when the tree has one), the people added in a period. Only the chosen
 * option shows its controls; each option says how many people it finds.
 * "Keep up to date" makes the list automatic (the rule is worked out each
 * time); off, the people are chosen now and the rule is kept for "Add from
 * the rule".
 *
 * Save as list: the same dialog with the rule and the people given by the
 * caller (the Table's view, a family line, a research line, the results of a
 * search): a sentence with the count instead of the choice.
 *
 * Edit rule: the choice of an automatic list's rule, without the name and
 * without Empty.
 *
 * The name follows the chosen rule until it is typed over. A name another
 * list has is framed and the next free one is suggested; Create takes the
 * suggested one. A read-only tree never opens the dialog.
 *
 * On a phone the dialog fills the screen; on a phone held sideways it is a
 * 560 px sheet from below (index.html, `.pln-*`).
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PersonId, PersonList, PersonListRule } from '../types.js';
import { rulePersonIds } from '../person-lists.js';
import { rodLabels, type RodId } from '../lineage.js';
import { rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { researchLinesOf, selectionLines } from './table-view/table-research.js';
import { researchTableLive } from './research-ui.js';
import { shownName } from '../person-name.js';
import { cardYears } from '../card-fields.js';
import { TreeRenderer } from '../renderer.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import { uiModule } from './module.js';

const NEW_ID = 'person-list-new';
const SAVE_ID = 'person-list-save';
/** The periods offered for "Added in a period" (any other number of days is typed). */
const PERIODS = [7, 30, 90] as const;
/** Generations offered for ancestors / descendants (0 = all). */
const MAX_GENERATIONS = 10;
const MAX_DAYS = 3650;

/** Where the dialog comes from: the rule choice (new), or a view saved as a list. */
export type NewListSource = 'new' | 'table' | 'unions' | 'search' | 'rod' | 'line' | 'selection';

/**
 * What the dialog opens with (D3b and D4 call it with a rule or people):
 *  - `rule`: the rule chosen at the start (new) or the rule saved (save).
 *  - `personIds`: the people of the list — new: the option Empty with these
 *    people; save: the people of a fixed list in this order (the Table's rows).
 *  - `dynamic`: "Keep up to date" at the start (default off; on for a family
 *    line and a research line saved as a list).
 *  - `name`: the name at the start (else from the rule).
 *  - `source`: new (default) or the view saved as a list.
 *  - `pinOut`: the pinned rows outside the filter (names), said in amber (§6b).
 *  - `listId`: Edit rule… of this list (the choice without name and Empty).
 *  - `openLists`: open Lists of people on the new list afterwards (default true).
 *  - `onSaved`: called with the list made or changed.
 */
export interface NewPersonListOptions {
    rule?: PersonListRule;
    personIds?: PersonId[];
    dynamic?: boolean;
    name?: string;
    source?: NewListSource;
    pinOut?: string;
    listId?: string;
    openLists?: boolean;
    onSaved?: (list: PersonList) => void;
}

type Opt = 'empty' | 'rods' | 'ancestors' | 'descendants' | 'line' | 'added';

interface NewListState {
    mode: 'new' | 'save' | 'edit';
    source: NewListSource;
    overlayId: string;
    listId: string | null;
    opt: Opt;
    rodId: string | null;
    personId: PersonId | null;
    /** 0 = all generations. */
    gens: number;
    lineId: string | null;
    days: number;
    customDays: boolean;
    dynamic: boolean;
    name: string;
    /** The name was typed: it no longer follows the rule. */
    nameTouched: boolean;
    given: PersonId[] | null;
    saveRule: PersonListRule | null;
    pinOut: string;
    openLists: boolean;
    onSaved: ((list: PersonList) => void) | null;
    opener: HTMLElement | null;
    counts: Map<string, number>;
}

let state: NewListState | null = null;
let closePicker: (() => void) | null = null;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rodChoices(): { big: Array<{ id: string; label: string; members: number }>; small: Array<{ id: string; label: string; members: number }> } {
    const index = DataManager.getLineageIndex();
    const lang = getCurrentLanguage();
    const labels = rodLabels(index);
    const big = rodPickerItems(index, undefined, undefined, lang)
        .filter(i => i.id !== 'tree' && i.id !== 'other')
        .map(i => ({ id: i.id as string, label: i.label, members: i.members }));
    const small = rodPickerSmallItems(index, lang, labels).map(i => ({ id: i.id as string, label: i.label, members: i.members }));
    return { big, small };
}

function rodLabel(id: string | null): string {
    if (!id) return '';
    return rodLabels(DataManager.getLineageIndex()).get(id as RodId) ?? '';
}

function researchLines(): ReadonlyArray<{ id: string; name: string }> {
    return researchLinesOf(DataManager.getData()).lines;
}

/** The lines offered to choose from: an ended one only while it is the one chosen (`keep`), as in the window's selection. */
function offeredResearchLines(keep: string | null): ReadonlyArray<{ id: string; name: string }> {
    return selectionLines(DataManager.getData(), researchTableLive().places, keep);
}

function personOf(id: PersonId | null) {
    if (!id) return null;
    const p = DataManager.getData().persons[id];
    return p && !p.isPlaceholder ? p : null;
}

/** The rule an option stands for with its controls (null: not complete, e.g. no person). */
function ruleOf(st: NewListState, opt: Opt): PersonListRule | null {
    switch (opt) {
        case 'empty': return null;
        case 'rods': return st.rodId ? { kind: 'rods', rodIds: [st.rodId] } : null;
        case 'ancestors':
        case 'descendants':
            return personOf(st.personId) ? { kind: opt, personId: st.personId!, ...(st.gens ? { generations: st.gens } : {}) } : null;
        case 'line': {
            const line = researchLines().find(l => l.id === st.lineId);
            return line ? { kind: 'line', directionId: line.id, lineName: line.name } : null;
        }
        case 'added': return { kind: 'added', days: st.days };
    }
}

/** The rule the dialog saves now. */
function currentRule(st: NewListState): PersonListRule | null {
    return st.mode === 'save' ? st.saveRule : ruleOf(st, st.opt);
}

/** How many people a rule finds (remembered per rule while the dialog is open). */
function ruleCount(st: NewListState, rule: PersonListRule): number {
    const key = JSON.stringify(rule);
    let n = st.counts.get(key);
    if (n === undefined) {
        n = rulePersonIds(DataManager.getLineageIndex(), rule).length;
        st.counts.set(key, n);
    }
    return n;
}

/** The name an option suggests (what the name field shows until it is typed over). */
function defaultName(st: NewListState): string {
    const t = strings.lists;
    if (st.mode === 'save') {
        const r = st.saveRule;
        if (r?.kind === 'rods') return t.rule.rod(rodLabel(r.rodIds[0]) || '?');
        if (r?.kind === 'line') return researchLines().find(l => l.id === r.directionId)?.name ?? r.lineName ?? '';
        // The window's selection of ancestors or descendants (spec 098 §2).
        if (r?.kind === 'ancestors' || r?.kind === 'descendants') {
            const p = personOf(r.personId);
            return p ? (r.kind === 'ancestors' ? t.new.nameAnc(shownName(p)) : t.new.nameDes(shownName(p))) : '';
        }
        return '';
    }
    switch (st.opt) {
        case 'empty': return '';
        case 'rods': return st.rodId ? t.rule.rod(rodLabel(st.rodId)) : '';
        case 'ancestors':
        case 'descendants': {
            const p = personOf(st.personId);
            if (!p) return '';
            return st.opt === 'ancestors' ? t.new.nameAnc(shownName(p)) : t.new.nameDes(shownName(p));
        }
        case 'line': return researchLines().find(l => l.id === st.lineId)?.name ?? '';
        case 'added': return t.rule.added(st.days);
    }
}

/** Whether "Keep up to date" can be on (an automatic list needs a rule). */
function canKeep(st: NewListState): boolean {
    if (st.mode === 'save') return !!st.saveRule && st.source !== 'search';
    return st.opt !== 'empty';
}

export const personListNewMethods = uiModule({
    /**
     * Open the dialog New list (no `source`, or 'new'), Save as list (a
     * `source` of a view) or Edit rule (`listId`). Nothing opens in a
     * read-only tree.
     */
    showNewPersonList(opts: NewPersonListOptions = {}): void {
        if (DataManager.listsReadOnly()) return;
        this.closeNewPersonList(false);
        const editList = opts.listId ? DataManager.getPersonList(opts.listId) ?? null : null;
        const source: NewListSource = opts.source ?? 'new';
        const mode: NewListState['mode'] = editList ? 'edit' : source === 'new' ? 'new' : 'save';
        const rule = editList?.rule ?? opts.rule ?? null;
        // One given person ("New list with this person…") is also the person of ancestors / descendants.
        const one = opts.personIds?.length === 1 ? opts.personIds[0] : null;
        const focus = one && personOf(one) ? one : TreeRenderer.getFocusPersonId();
        const firstRod = rodChoices().big[0]?.id ?? rodChoices().small[0]?.id ?? null;
        const lines = offeredResearchLines(null);
        const active = document.activeElement;
        const st: NewListState = {
            mode, source, overlayId: mode === 'save' ? SAVE_ID : NEW_ID,
            listId: editList?.id ?? null,
            opt: 'empty', rodId: firstRod, personId: personOf(focus) ? focus : null, gens: 0,
            lineId: lines[0]?.id ?? null, days: 30, customDays: false,
            dynamic: editList ? editList.dynamic : opts.dynamic ?? (mode === 'save' && (source === 'rod' || source === 'line' || source === 'selection')),
            name: opts.name ?? '', nameTouched: opts.name !== undefined,
            given: opts.personIds ? [...opts.personIds] : null,
            saveRule: mode === 'save' ? opts.rule ?? null : null,
            pinOut: opts.pinOut ?? '',
            openLists: opts.openLists ?? true,
            onSaved: opts.onSaved ?? null,
            opener: active instanceof HTMLElement ? active : null,
            counts: new Map(),
        };
        if (mode !== 'save' && rule) {
            switch (rule.kind) {
                case 'rods': st.opt = 'rods'; st.rodId = rule.rodIds[0] ?? st.rodId; break;
                case 'ancestors':
                case 'descendants':
                    st.opt = rule.kind;
                    if (personOf(rule.personId)) st.personId = rule.personId;
                    st.gens = rule.generations ?? 0;
                    break;
                case 'line': st.opt = 'line'; st.lineId = rule.directionId; break;
                case 'added':
                    st.opt = 'added';
                    st.days = rule.days;
                    st.customDays = !(PERIODS as readonly number[]).includes(rule.days);
                    break;
                default: break;
            }
        }
        if (mode === 'edit' && st.opt === 'empty') st.opt = 'ancestors';
        if (!canKeep(st)) st.dynamic = false;
        if (!st.nameTouched) st.name = defaultName(st);
        state = st;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active pln-overlay';
        overlay.id = st.overlayId;
        const wide = getCurrentLanguage() === 'de' ? ' pln-modal--de' : '';
        overlay.innerHTML = `<div class="modal modal--md pln-modal${mode === 'save' ? ' pln-modal--save' : ''}${wide}" role="dialog" aria-modal="true"`
            + ` aria-labelledby="pln-title" data-dialog-kind="form" data-skeleton="done"></div>`;
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeNewPersonList(); });
        overlay.addEventListener('click', (e) => this.onNewPersonListClick(e));
        overlay.addEventListener('change', (e) => this.onNewPersonListChange(e));
        overlay.addEventListener('input', (e) => this.onNewPersonListInput(e));
        overlay.addEventListener('keydown', (e) => this.onNewPersonListKey(e));
        document.body.appendChild(overlay);
        if (!this.isPersonListsOpen()) this.clearDialogStack();
        this.pushDialog(st.overlayId);
        this.renderNewPersonList();
        const first = overlay.querySelector<HTMLElement>(mode === 'edit' ? '.pln-opt input:checked' : '#pln-name');
        first?.focus({ preventScroll: true });
        if (first instanceof HTMLInputElement && first.type === 'text') first.select();
    },

    isNewPersonListOpen(): boolean {
        return !!state && !!document.getElementById(state.overlayId);
    },

    /** Close without saving; the focus goes back where it was. */
    closeNewPersonList(restoreFocus = true): void {
        closePicker?.();
        closePicker = null;
        const st = state;
        state = null;
        for (const id of [NEW_ID, SAVE_ID]) {
            document.getElementById(id)?.remove();
            this.dialogStack = this.dialogStack.filter(d => d !== id);
        }
        if (restoreFocus && st?.opener?.isConnected) st.opener.focus({ preventScroll: true });
    },

    /** Escape: the open person choice closes on its own; then the dialog. */
    newPersonListEscape(): void {
        if (closePicker) { closePicker(); return; }
        this.closeNewPersonList();
    },

    /** Draw the dialog from the state, keeping the focus and the scroll. */
    renderNewPersonList(): void {
        const st = state;
        const modal = document.querySelector<HTMLElement>(`#${st?.overlayId} .pln-modal`);
        if (!st || !modal) return;
        const t = strings.lists;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && modal.contains(active) ? active.dataset.key ?? null : null;
        const scroll = modal.querySelector<HTMLElement>('.pln-body')?.scrollTop ?? 0;

        const title = st.mode === 'edit' ? t.new.editTitle
            : st.mode === 'new' ? t.new.title
                : st.source === 'rod' ? t.save.rodTitle : st.source === 'line' ? t.save.lineTitle
                    : st.source === 'search' ? t.save.searchTitle : t.save.title;
        let body = '';
        if (st.mode !== 'edit') {
            body += `<div class="pln-field"><label class="pln-label" for="pln-name">${esc(t.new.name)}</label>`
                + `<input type="text" id="pln-name" class="pln-name" data-key="name" maxlength="120" autocomplete="off" spellcheck="false" value="${esc(st.name)}" aria-describedby="pln-name-err">`
                + `<p class="pln-err" id="pln-name-err" hidden></p></div>`;
        }
        if (st.mode === 'save') body += this.newPersonListSaveHtml();
        else body += this.newPersonListOptionsHtml();
        if (canKeep(st) || st.mode !== 'save') body += this.newPersonListKeepHtml();

        const primary = st.mode === 'new' ? t.create : strings.buttons.save;
        modal.innerHTML = `<div class="modal-header pln-head"><h2 id="pln-title">${esc(title)}</h2>`
            + `<button type="button" class="close-btn" data-act="cancel" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + `<div class="modal-content pln-body">${body}</div>`
            + `<div class="buttons pln-foot"><button type="button" class="secondary" data-dismiss data-act="cancel">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" data-act="create" data-key="create">${esc(primary)}</button></div>`;
        modal.querySelector<HTMLElement>('.pln-body')?.scrollTo(0, scroll);
        this.updateNewPersonListName();
        if (focusKey) modal.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    },

    /** The rule choice: one tile per option, the chosen one with its controls; the count on the right. */
    newPersonListOptionsHtml(): string {
        const st = state!;
        const t = strings.lists;
        const n = t.new;
        const opts: Array<[Opt, string, string]> = [];
        if (st.mode !== 'edit') opts.push(['empty', n.empty, n.emptySub]);
        const rods = rodChoices();
        opts.push(['rods', n.rod, ''], ['ancestors', n.anc, ''], ['descendants', n.des, '']);
        if (offeredResearchLines(st.lineId).length) opts.push(['line', n.line, '']);
        opts.push(['added', n.added, '']);
        let html = `<div class="pln-legend" id="pln-based">${esc(n.basedOn)}</div><div class="pln-opts" role="radiogroup" aria-labelledby="pln-based">`;
        for (const [opt, label, sub] of opts) {
            const on = st.opt === opt;
            const disabled = opt === 'rods' && !rods.big.length && !rods.small.length;
            const rule = ruleOf(st, opt);
            const count = opt === 'empty' ? (st.given ? t.persons(st.given.length) : '–') : rule ? t.persons(ruleCount(st, rule)) : '–';
            html += `<div class="pln-opt sel-opt${on ? ' is-on' : ''}" data-sel-form="tile" data-opt="${opt}"${disabled ? ' aria-disabled="true"' : ''}>`
                + `<input type="radio" class="pln-radio" name="pln-rule" id="pln-o-${opt}" value="${opt}" data-key="opt-${opt}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>`
                + `<div class="pln-opt-mid"><label class="pln-opt-label" for="pln-o-${opt}">${esc(label)}</label>`
                + (sub ? `<span class="pln-opt-sub">${esc(sub)}</span>` : '')
                + (on ? this.newPersonListControlsHtml(opt, rods) : '')
                + `</div><span class="pln-count" data-count="${opt}">${esc(count)}</span></div>`;
        }
        return html + `</div>`;
    },

    /** The controls of the chosen option. */
    newPersonListControlsHtml(opt: Opt, rods: ReturnType<typeof rodChoices>): string {
        const st = state!;
        const n = strings.lists.new;
        const select = (ctl: string, label: string, options: string): string =>
            `<select class="pln-ctl pln-select" data-ctl="${ctl}" data-key="ctl-${ctl}" aria-label="${esc(label)}">${options}</select>`;
        const option = (value: string | number, label: string, on: boolean): string =>
            `<option value="${esc(String(value))}"${on ? ' selected' : ''}>${esc(label)}</option>`;
        switch (opt) {
            case 'empty': return '';
            case 'rods': {
                const row = (r: { id: string; label: string; members: number }): string => option(r.id, `${r.label} (${r.members})`, r.id === st.rodId);
                const other = rods.small.length ? `<optgroup label="${esc(strings.familyPages.otherFams)}">${rods.small.map(row).join('')}</optgroup>` : '';
                return `<div class="pln-ctls">${select('rod', n.rod, rods.big.map(row).join('') + other)}</div>`;
            }
            case 'ancestors':
            case 'descendants': {
                const p = personOf(st.personId);
                const years = p ? cardYears(p) : '';
                const text = p ? (years ? `${shownName(p)} · ${years}` : shownName(p)) : n.choosePerson;
                const person = `<button type="button" class="pln-ctl pln-person" data-act="person" data-key="ctl-person" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(`${n.person}: ${text}`)}">`
                    + `<span class="pln-ctl-t">${esc(text)}</span><span class="pln-caret" aria-hidden="true">▾</span></button>`;
                let gens = option(0, n.all, st.gens === 0);
                for (let g = 1; g <= Math.max(MAX_GENERATIONS, st.gens); g++) gens += option(g, n.gens(g), st.gens === g);
                return `<div class="pln-ctls">${person}${select('gens', n.generations, gens)}</div>`;
            }
            case 'line':
                return `<div class="pln-ctls">${select('line', n.line, offeredResearchLines(st.lineId).map(l => option(l.id, `${l.id} ${l.name}`, l.id === st.lineId)).join(''))}</div>`;
            case 'added': {
                const periods = PERIODS.map(d => option(d, n.period(d), !st.customDays && st.days === d)).join('') + option('custom', n.custom, st.customDays);
                const days = st.customDays
                    ? `<input type="number" class="pln-ctl pln-days" data-ctl="days" data-key="ctl-days" min="1" max="${MAX_DAYS}" step="1" inputmode="numeric" value="${st.days}" aria-label="${esc(n.days)}">`
                    : '';
                return `<div class="pln-ctls">${select('period', n.periodLabel, periods)}${days}</div>`;
            }
        }
    },

    /** Save as list: how many people are saved (and a pinned row left out). */
    newPersonListSaveHtml(): string {
        const st = state!;
        const t = strings.lists;
        const n = st.given ? st.given.length : st.saveRule ? ruleCount(st, st.saveRule) : 0;
        const sentence = st.source === 'table' ? t.save.count(n) : st.source === 'unions' ? t.save.unions(n) : t.persons(n);
        let html = `<p class="pln-sentence" data-count="save">${esc(sentence)}</p>`;
        if (st.pinOut) html += `<p class="pln-sentence pln-sentence--warn" role="note">${esc(t.save.pinOut(st.pinOut))}</p>`;
        return html;
    },

    /** "Keep up to date" (a Table view: "Keep in line with the filter") with its sentence. */
    newPersonListKeepHtml(): string {
        const st = state!;
        const t = strings.lists;
        const filter = st.source === 'table' || st.source === 'unions';
        const label = filter ? t.save.keepFilter : t.keep;
        const sub = filter ? (st.dynamic ? t.save.keepFilterOn : t.save.keepFilterOff) : (st.dynamic ? t.keepOn : t.keepOff);
        const off = !canKeep(st);
        return `<div class="pln-keep${off ? ' is-off' : ''}"><button type="button" class="pln-switch" role="switch" data-act="keep" data-key="keep"`
            + ` aria-checked="${st.dynamic}" aria-labelledby="pln-keep-t" aria-describedby="pln-keep-s"${off ? ' aria-disabled="true"' : ''}>`
            + `<span class="pln-switch-track" aria-hidden="true"></span></button>`
            + `<div class="pln-keep-text"><span class="pln-keep-t" id="pln-keep-t">${esc(label)}</span><span class="pln-keep-s" id="pln-keep-s">${esc(sub)}</span></div></div>`;
    },

    /** The name's check (§16c): a taken name is framed and the next free one suggested; Create needs a name and a rule. */
    updateNewPersonListName(): void {
        const st = state;
        const modal = document.querySelector<HTMLElement>(`#${st?.overlayId} .pln-modal`);
        if (!st || !modal) return;
        const input = modal.querySelector<HTMLInputElement>('#pln-name');
        const err = modal.querySelector<HTMLElement>('#pln-name-err');
        const name = st.name.trim();
        const taken = !!name && DataManager.isPersonListNameTaken(name, st.listId ?? undefined);
        if (input && err) {
            input.setAttribute('aria-invalid', String(taken));
            input.classList.toggle('is-taken', taken);
            err.hidden = !taken;
            err.textContent = taken ? strings.lists.save.dup(DataManager.suggestPersonListName(name, st.listId ?? undefined)) : '';
        }
        const ready = (st.mode === 'edit' || !!name)
            && (st.mode === 'save' ? (!!st.saveRule || !!st.given) : st.opt === 'empty' || !!currentRule(st));
        const create = modal.querySelector<HTMLButtonElement>('[data-act="create"]');
        if (create) create.disabled = !ready;
    },

    onNewPersonListClick(e: MouseEvent): void {
        const st = state;
        if (!st) return;
        const target = e.target as HTMLElement;
        const el = target.closest<HTMLElement>('[data-act]');
        const act = el?.dataset.act;
        if (act === 'cancel') { this.closeNewPersonList(); return; }
        if (act === 'create') { this.saveNewPersonList(); return; }
        if (act === 'keep') {
            if (el!.getAttribute('aria-disabled') === 'true') return;
            st.dynamic = !st.dynamic;
            this.renderNewPersonList();
            return;
        }
        if (act === 'person') { this.openNewPersonListPicker(el!); return; }
        // A click anywhere on a tile (not on its controls) chooses it.
        const tile = target.closest<HTMLElement>('.pln-opt');
        if (tile && !target.closest('select, input, button, label') && tile.getAttribute('aria-disabled') !== 'true') {
            const opt = tile.dataset.opt as Opt;
            if (opt !== st.opt) this.setNewPersonListOpt(opt);
            tile.querySelector<HTMLElement>('.pln-radio')?.focus({ preventScroll: true });
        }
    },

    onNewPersonListChange(e: Event): void {
        const st = state;
        if (!st) return;
        const el = e.target as HTMLInputElement | HTMLSelectElement;
        if (el.classList.contains('pln-radio')) {
            this.setNewPersonListOpt(el.value as Opt);
            return;
        }
        switch (el.dataset.ctl) {
            case 'rod': st.rodId = el.value; break;
            case 'gens': st.gens = Number(el.value) || 0; break;
            case 'line': st.lineId = el.value; break;
            case 'period':
                if (el.value === 'custom') st.customDays = true;
                else { st.customDays = false; st.days = Number(el.value) || 30; }
                break;
            case 'days': {
                // Fired on leaving the field, often by pressing Create: a new render here would swallow
                // that click, so the field keeps its node and only the value and the counts change.
                const d = Math.round(Number(el.value));
                st.days = Number.isFinite(d) ? Math.min(MAX_DAYS, Math.max(1, d)) : st.days;
                if (el.value !== String(st.days)) el.value = String(st.days);
                this.refreshNewPersonListCounts();
                return;
            }
            default: return;
        }
        this.newPersonListRuleChanged();
        if (el.dataset.ctl === 'period' && st.customDays) {
            document.querySelector<HTMLInputElement>(`#${st.overlayId} .pln-days`)?.focus();
        }
    },

    onNewPersonListInput(e: Event): void {
        const st = state;
        const el = e.target as HTMLInputElement;
        if (!st) return;
        if (el.id === 'pln-name') {
            st.name = el.value;
            st.nameTouched = el.value.trim() !== '';
            this.updateNewPersonListName();
            return;
        }
        if (el.dataset.ctl === 'days') {
            const d = Math.round(Number(el.value));
            if (!el.value || !Number.isFinite(d) || d < 1) return;
            st.days = Math.min(MAX_DAYS, d);
            this.refreshNewPersonListCounts();
        }
    },

    onNewPersonListKey(e: KeyboardEvent): void {
        const st = state;
        if (!st || e.key !== 'Enter') return;
        const el = e.target as HTMLElement;
        if (el.id === 'pln-name' || el.classList.contains('pln-days')) {
            e.preventDefault();
            if (el.classList.contains('pln-days')) (el as HTMLInputElement).blur();
            const create = document.querySelector<HTMLButtonElement>(`#${st.overlayId} [data-act="create"]`);
            if (create && !create.disabled) this.saveNewPersonList();
        }
    },

    setNewPersonListOpt(opt: Opt): void {
        const st = state;
        if (!st) return;
        st.opt = opt;
        if (!canKeep(st)) st.dynamic = false;
        this.newPersonListRuleChanged();
    },

    /** The rule changed: the name follows it (until typed over) and the dialog is drawn again. */
    newPersonListRuleChanged(): void {
        const st = state;
        if (!st) return;
        if (!st.nameTouched) st.name = defaultName(st);
        this.renderNewPersonList();
    },

    /** The custom number of days typed: the counts only, the field keeps its caret. */
    refreshNewPersonListCounts(): void {
        const st = state;
        if (!st) return;
        const modal = document.querySelector<HTMLElement>(`#${st.overlayId} .pln-modal`);
        const rule = ruleOf(st, st.opt);
        const cell = modal?.querySelector<HTMLElement>(`[data-count="${st.opt}"]`);
        if (cell && rule) cell.textContent = strings.lists.persons(ruleCount(st, rule));
        if (!st.nameTouched) {
            st.name = defaultName(st);
            const input = modal?.querySelector<HTMLInputElement>('#pln-name');
            if (input) input.value = st.name;
        }
        this.updateNewPersonListName();
    },

    /** The person of ancestors / descendants: the person popover (the person in focus and the recently chosen first). */
    openNewPersonListPicker(button: HTMLElement): void {
        const st = state;
        const overlay = st ? document.getElementById(st.overlayId) : null;
        if (!st || !overlay) return;
        if (closePicker) { closePicker(); return; }
        const t = strings.treeOverview;
        const suggested: Array<{ id: PersonId; meta: string }> = [];
        if (st.personId) suggested.push({ id: st.personId, meta: '' });
        const focus = TreeRenderer.getFocusPersonId();
        if (focus) suggested.push({ id: focus, meta: t.inFocus });
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) for (const id of readRecent(treeId)) suggested.push({ id, meta: t.recent });
        closePicker = openPersonPopover({
            host: overlay, anchor: button, data: DataManager.getData(), selectedId: st.personId, suggested,
            labels: { search: strings.lists.pickSearch, list: strings.lists.new.person, noMatch: t.noMatch },
            onClose: () => { closePicker = null; },
            onPick: (id) => {
                if (!state) return;
                state.personId = id;
                this.newPersonListRuleChanged();
                document.querySelector<HTMLElement>(`#${state.overlayId} .pln-person`)?.focus({ preventScroll: true });
            },
        });
    },

    /** Create (or Save): the list made with the suggested name when the typed one is taken. */
    saveNewPersonList(): void {
        const st = state;
        if (!st || DataManager.listsReadOnly()) return;
        const rule = currentRule(st);
        let list: PersonList | null = null;
        if (st.mode === 'edit') {
            const before = st.listId ? DataManager.getPersonList(st.listId) : undefined;
            if (!before || !rule) return;
            const same = JSON.stringify(before.rule ?? null) === JSON.stringify(rule) && before.dynamic === st.dynamic;
            if (!same) DataManager.setPersonListRule(before.id, rule, st.dynamic);
            list = DataManager.getPersonList(before.id) ?? null;
        } else {
            const typed = st.name.trim();
            if (!typed) return;
            const name = DataManager.suggestPersonListName(typed);
            if (st.mode === 'save') {
                const dynamic = st.dynamic && canKeep(st);
                list = DataManager.createPersonList({
                    name, dynamic, ...(st.saveRule ? { rule: st.saveRule } : {}),
                    ...(!dynamic && st.given ? { personIds: st.given } : {}),
                });
            } else if (st.opt === 'empty') {
                list = DataManager.createPersonList({ name, dynamic: false, personIds: st.given ?? [] });
            } else if (rule) {
                list = DataManager.createPersonList({ name, dynamic: st.dynamic, rule });
            }
        }
        if (!list) return;
        const { openLists, onSaved, mode } = st;
        this.closeNewPersonList(false);
        if (openLists) this.showPersonLists({ listId: list.id });
        onSaved?.(list);
        if (mode === 'edit' && !openLists) st.opener?.focus({ preventScroll: true });
    },
});
