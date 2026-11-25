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
 * Custom rule (spec 136 §1): the last tile opens the builder of conditions
 * and groups (src/ui/person-list-rule-ui.ts) in place of the tiles; its
 * "Custom rule ▾" goes back to a tile (a one-condition rule the tile knows
 * takes its parameters), ⋯ clears the rule. A rule the tiles know is saved
 * as `rule` as before, anything else as the list's `custom` rule (D3).
 * Ancestors / descendants offer "More options: family of a person…" (the
 * builder with one Family of a person). Edit the rule of a list with a custom
 * rule opens the builder at once. Create / Save wait for a complete rule (the
 * reason in the footer and in the button's `title`); closing an unfinished
 * rule of more than one edited condition asks first (§15).
 *
 * On a phone the dialog fills the screen; on a phone held sideways it is a
 * 560 px sheet from below (index.html, `.pln-*`).
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PersonId, PersonList, PersonListRule, RuleGroup } from '../types.js';
import { listIsAuto, rulePersonIds } from '../person-lists.js';
import { customPersonIds, customToRule, ruleToCustom } from '../person-list-rules.js';
import { cloneRuleNode, editedConditions, emptyRuleRoot } from '../person-list-rule-edit.js';
import {
    newRuleBuilder, ruleBuilderBlock, ruleBuilderCounts, ruleBuilderCountsBusy, type RuleBuilderState, type RuleMenuRow,
} from './person-list-rule-ui.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import type { ViewMode } from '../types.js';
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
 *  - `custom`: open the builder with this custom rule (new or edit).
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
    custom?: RuleGroup;
    openLists?: boolean;
    onSaved?: (list: PersonList) => void;
}

type Opt = 'empty' | 'rods' | 'ancestors' | 'descendants' | 'line' | 'added' | 'custom';

/** The tiles a custom rule can go back to ("Custom rule ▾"). */
const SIMPLE_OPTS: readonly Opt[] = ['empty', 'rods', 'ancestors', 'descendants', 'line', 'added'];

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
    /** The custom rule's builder (kept while the dialog is open, also when a tile is chosen again). */
    rb: RuleBuilderState | null;
}

let state: NewListState | null = null;

/** The rule's preview in the tree (§6): what was hidden for it and the view to go back to. */
let preview: { overlays: HTMLElement[]; stack: string[]; view: ViewMode | null } | null = null;

function phoneBar(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MQ_PHONE_BAR).matches;
}
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
        case 'custom': return st.rb ? customToRule(st.rb.root) : null;
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
        case 'custom': {
            // One Family of a person: "Family – {person}"; else the name is typed (or a template's).
            const items = st.rb?.root.items ?? [];
            const only = items.length === 1 ? items[0] : null;
            if (only?.t === 'cond' && only.c === 'family' && only.p.personId && !only.not) {
                const p = personOf(only.p.personId);
                return t.new.nameFamily(p ? shownName(p) : only.p.personName);
            }
            return '';
        }
    }
}

/** Whether "Keep up to date" can be on (an automatic list needs a rule). */
function canKeep(st: NewListState): boolean {
    if (st.mode === 'save') return !!st.saveRule && st.source !== 'search';
    return st.opt !== 'empty';
}

/** The builder's rule now (the custom option), or null. */
function customRoot(st: NewListState): RuleGroup | null {
    return st.opt === 'custom' && st.rb ? st.rb.root : null;
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
            dynamic: editList ? listIsAuto(editList) : opts.dynamic ?? (mode === 'save' && (source === 'rod' || source === 'line' || source === 'selection')),
            name: opts.name ?? '', nameTouched: opts.name !== undefined,
            given: opts.personIds ? [...opts.personIds] : null,
            saveRule: mode === 'save' ? opts.rule ?? null : null,
            pinOut: opts.pinOut ?? '',
            openLists: opts.openLists ?? true,
            onSaved: opts.onSaved ?? null,
            opener: active instanceof HTMLElement ? active : null,
            counts: new Map(),
            rb: null,
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
        // A custom rule (the list's, or given): the builder at once.
        const custom = mode === 'save' ? null : editList?.custom?.root ?? opts.custom ?? null;
        if (custom) {
            st.opt = 'custom';
            st.rb = newRuleBuilder(cloneRuleNode(custom), st.listId, editList?.custom ? cloneRuleNode(custom) : null);
        }
        if (mode === 'edit' && st.opt === 'empty') st.opt = 'ancestors';
        if (!canKeep(st)) st.dynamic = false;
        if (!st.nameTouched) st.name = defaultName(st);
        state = st;
        if (st.rb) this.newPersonListAttachRule(st.rb);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active pln-overlay';
        overlay.id = st.overlayId;
        const wide = getCurrentLanguage() === 'de' ? ' pln-modal--de' : '';
        overlay.innerHTML = `<div class="modal modal--md pln-modal${mode === 'save' ? ' pln-modal--save' : ''}${wide}" role="dialog" aria-modal="true"`
            + ` aria-labelledby="pln-title" data-dialog-kind="form" data-skeleton="done"></div>`;
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.requestCloseNewPersonList(); });
        overlay.addEventListener('pointerdown', (e) => this.ruleBuilderPointerDown(e));
        overlay.addEventListener('click', (e) => this.onNewPersonListClick(e));
        overlay.addEventListener('change', (e) => this.onNewPersonListChange(e));
        overlay.addEventListener('input', (e) => this.onNewPersonListInput(e));
        overlay.addEventListener('keydown', (e) => this.onNewPersonListKey(e));
        document.body.appendChild(overlay);
        if (!this.isPersonListsOpen()) this.clearDialogStack();
        this.pushDialog(st.overlayId);
        this.renderNewPersonList();
        const first = overlay.querySelector<HTMLElement>(mode !== 'edit' ? '#pln-name'
            : st.opt === 'custom' ? '.plr-row, .plr [data-rb="add"]' : '.pln-opt input:checked');
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
        this.ruleBuilderDetach();
        const st = state;
        state = null;
        for (const id of [NEW_ID, SAVE_ID]) {
            document.getElementById(id)?.remove();
            this.dialogStack = this.dialogStack.filter(d => d !== id);
        }
        if (restoreFocus && st?.opener?.isConnected) st.opener.focus({ preventScroll: true });
    },

    /** Escape: an open menu or person choice closes on its own; then the dialog (asking first about an unfinished rule). */
    newPersonListEscape(): void {
        if (this.closeRuleMenu()) return;
        if (closePicker) { closePicker(); return; }
        this.requestCloseNewPersonList();
    },

    /**
     * Cancel, ×, Escape, a click beside the dialog: a custom rule with more
     * than one edited condition asks "Discard the unfinished rule?" first
     * (§15); else the dialog closes.
     */
    requestCloseNewPersonList(): void {
        const st = state;
        const root = st ? customRoot(st) : null;
        const edited = st?.rb && root ? editedConditions(st.rb.start, root) : 0;
        if (!st || edited <= 1) { this.closeNewPersonList(); return; }
        const d = strings.lists.rules.discard;
        void this.showConfirm(d.text(edited), d.title, { confirmLabel: d.discard, cancel: d.keep, variant: 'danger' }).then(ok => {
            if (ok && state === st) this.closeNewPersonList();
        });
    },

    /** Give the builder its state and how the dialog follows its changes. */
    newPersonListAttachRule(rb: RuleBuilderState): void {
        this.ruleBuilderAttach(rb, {
            changed: (render: boolean) => {
                const st = state;
                if (!st) return;
                if (!st.nameTouched) {
                    st.name = defaultName(st);
                    if (!render) {
                        const input = document.querySelector<HTMLInputElement>(`#${st.overlayId} #pln-name`);
                        if (input) input.value = st.name;
                    }
                }
                if (render) this.renderNewPersonList();
                else this.updateNewPersonListName();
            },
        });
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
        const rule = st.opt === 'custom' && st.mode !== 'save';
        modal.classList.toggle('pln-modal--rule', rule);
        // The custom rule's footer: the count (or why it cannot be saved yet) on the left (§6).
        const total = rule ? `<div class="pln-total" data-count="custom" aria-live="polite"></div>${this.newPersonListFootExtraHtml()}` : '';
        modal.innerHTML = `<div class="modal-header pln-head"><h2 id="pln-title">${esc(title)}</h2>`
            + `<button type="button" class="close-btn" data-act="cancel" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + `<div class="modal-content pln-body">${body}</div>`
            + `<div class="buttons pln-foot">${total}<button type="button" class="secondary" data-dismiss data-act="cancel">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" data-act="create" data-key="create">${esc(primary)}</button></div>`;
        modal.querySelector<HTMLElement>('.pln-body')?.scrollTo(0, scroll);
        this.updateNewPersonListName();
        if (focusKey) modal.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
        if (rule) this.ruleBuilderFocus();
    },

    /**
     * Beside the count in a custom rule's footer: "Show in the tree" (§6;
     * hidden while nobody matches, on a phone in ⋯ instead).
     */
    newPersonListFootExtraHtml(): string {
        return `<button type="button" class="secondary pln-show" data-act="show-tree" data-key="show-tree" hidden>${esc(strings.lists.rules.showInTree)}</button>`;
    },

    /**
     * "Start from a template ▾" on the right of the line "Based on" (§1.2,
     * §7; new lists only): the next part draws the button here (`.pln-tbtn`,
     * `data-act="templates"`). Empty for now.
     */
    newPersonListTemplateHtml(): string {
        return '';
    },

    /**
     * More rows of the custom rule's ⋯ (`.pln-more`) before "Clear the rule":
     * Save as template… (§7), on a phone also Start from a template… and Show
     * in the tree (§14). Each row's id goes to newPersonListMoreAction.
     */
    newPersonListMoreRows(): RuleMenuRow[] {
        const st = state;
        if (!st?.rb || !phoneBar()) return [];
        const n = ruleBuilderBlock(st.rb) === null ? ruleBuilderCounts(st.rb).total : 0;
        return [{ id: 'show-tree', label: strings.lists.rules.showInTree, ...(n ? {} : { disabled: true }) }];
    },

    /** A row of the custom rule's ⋯ other than "Clear the rule". */
    newPersonListMoreAction(id: string): void {
        if (id === 'show-tree') this.showNewPersonListInTree();
    },

    /**
     * "Show in the tree" (§6): the dialog (and the Lists of people under it)
     * hidden, not closed; the Family view (switched to when another view is
     * on); the rule's people highlighted with "Back to the rule". Back, × and
     * Escape end the highlight, return the view and show the dialog again as
     * it was, the focus on "Show in the tree".
     */
    showNewPersonListInTree(): void {
        const st = state;
        if (!st?.rb || preview || ruleBuilderBlock(st.rb) !== null) return;
        const ids = customPersonIds(DataManager.getLineageIndex(), { v: 1, root: st.rb.root }, { now: Date.now() }, st.listId ?? undefined);
        if (!ids.length) return;
        this.closeRuleMenu();
        const overlays = [...document.querySelectorAll<HTMLElement>('.modal-overlay.active')];
        for (const o of overlays) { o.classList.remove('active'); o.hidden = true; }
        const view = TreeRenderer.getViewMode();
        preview = { overlays, stack: [...this.dialogStack], view: view === 'family' ? null : view };
        this.dialogStack = [];
        if (view !== 'family') TreeRenderer.setViewMode('family');
        const r = strings.lists.rules;
        this.highlightGroup({
            kind: 'rulePreview', title: (n: number) => r.preview(n), personIds: ids, recount: null, cite: false,
            returnTo: () => this.backToNewPersonList(), returnLabel: r.backToRule,
        });
    },

    /** Back from the rule's preview in the tree: the view as it was, the dialog shown again. */
    backToNewPersonList(): void {
        const p = preview;
        if (!p) return;
        preview = null;
        if (p.view) TreeRenderer.setViewMode(p.view);
        for (const o of p.overlays) {
            if (!o.isConnected) continue;
            o.hidden = false;
            o.classList.add('active');
        }
        this.dialogStack = [...p.stack, ...this.dialogStack.filter(d => !p.stack.includes(d))];
        const st = state;
        const modal = st ? document.querySelector<HTMLElement>(`#${st.overlayId} .pln-modal`) : null;
        const btn = modal?.querySelector<HTMLElement>('[data-act="show-tree"]:not([hidden])') ?? modal?.querySelector<HTMLElement>('.pln-more');
        btn?.focus({ preventScroll: true });
    },

    /** The custom rule: "Based on: Custom rule ▾", the template button, ⋯, then the builder. */
    newPersonListRuleHtml(): string {
        const st = state!;
        const t = strings.lists;
        return `<div class="pln-by"><span class="pln-legend pln-by-k" id="pln-based">${esc(t.new.basedOn)}:</span>`
            + `<button type="button" class="pln-ctl pln-bybtn" data-act="by" data-key="by" aria-haspopup="menu" aria-expanded="false">`
            + `<span class="pln-ctl-t">${esc(t.new.customRule)}</span><span class="pln-caret" aria-hidden="true">▾</span></button>`
            + `<span class="pln-by-gap"></span>${st.mode === 'new' ? this.newPersonListTemplateHtml() : ''}`
            + `<button type="button" class="pln-more" data-act="more" data-key="more" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t.rules.more)}"><span aria-hidden="true">⋯</span></button>`
            + `</div>`
            + this.ruleBuilderHtml();
    },

    /** The rule choice: one tile per option, the chosen one with its controls; the count on the right. */
    newPersonListOptionsHtml(): string {
        const st = state!;
        if (st.opt === 'custom') return this.newPersonListRuleHtml();
        const t = strings.lists;
        const n = t.new;
        const opts: Array<[Opt, string, string]> = [];
        if (st.mode !== 'edit') opts.push(['empty', n.empty, n.emptySub]);
        const rods = rodChoices();
        opts.push(['rods', n.rod, ''], ['ancestors', n.anc, ''], ['descendants', n.des, '']);
        if (offeredResearchLines(st.lineId).length) opts.push(['line', n.line, '']);
        opts.push(['added', n.added, '']);
        opts.push(['custom', n.customRule, n.customRuleSub]);
        const tpl = st.mode === 'new' ? this.newPersonListTemplateHtml() : '';
        let html = `<div class="pln-tline"><div class="pln-legend" id="pln-based">${esc(n.basedOn)}</div>${tpl}</div>`
            + `<div class="pln-opts" role="radiogroup" aria-labelledby="pln-based">`;
        for (const [opt, label, sub] of opts) {
            const on = st.opt === opt;
            const disabled = opt === 'rods' && !rods.big.length && !rods.small.length;
            const rule = ruleOf(st, opt);
            const count = opt === 'empty' ? (st.given ? t.persons(st.given.length) : '–') : opt !== 'custom' && rule ? t.persons(ruleCount(st, rule)) : '–';
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
                // §1.5: the builder with one Family of a person (the same people to start with).
                const more = st.mode !== 'save' ? `<button type="button" class="pl-link pln-famlink" data-act="family-more" data-key="family-more">${esc(n.moreFamily)}</button>` : '';
                return `<div class="pln-ctls">${person}${select('gens', n.generations, gens)}</div>${more}`;
            }
            case 'line':
                return `<div class="pln-ctls">${select('line', n.line, offeredResearchLines(st.lineId).map(l => option(l.id, `${l.id} ${l.name}`, l.id === st.lineId)).join(''))}</div>`;
            case 'custom': return '';
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
        // A custom rule: complete, or the reason it cannot be saved yet (in the footer and the button's title).
        const block = st.opt === 'custom' && st.mode !== 'save' ? (st.rb ? ruleBuilderBlock(st.rb) : strings.lists.rules.noConditions) : null;
        const ready = (st.mode === 'edit' || !!name)
            && (st.mode === 'save' ? (!!st.saveRule || !!st.given)
                : st.opt === 'custom' ? block === null
                    : st.opt === 'empty' || !!currentRule(st));
        const create = modal.querySelector<HTMLButtonElement>('[data-act="create"]');
        if (create) {
            create.disabled = !ready;
            if (block) create.title = block; else create.removeAttribute('title');
        }
        const total = modal.querySelector<HTMLElement>('.pln-total');
        if (total && st.rb) {
            const r = strings.lists.rules;
            const n = block === null ? ruleBuilderCounts(st.rb).total : null;
            const busy = block === null && ruleBuilderCountsBusy(st.rb);
            total.classList.toggle('is-block', block !== null);
            total.classList.toggle('is-busy', busy);
            // A slow count: "Counting…" and, quietly, the total so far (§6); no spinner.
            if (busy) total.innerHTML = `<span>${esc(r.computing)}</span> <span class="pln-prev">${esc(r.previous(n ?? 0))}</span>`;
            else total.textContent = block ?? (n ? r.match(n) : r.nobody);
            const show = modal.querySelector<HTMLElement>('[data-act="show-tree"]');
            if (show) show.hidden = !n;
        }
    },

    onNewPersonListClick(e: MouseEvent): void {
        const st = state;
        if (!st) return;
        const target = e.target as HTMLElement;
        const el = target.closest<HTMLElement>('[data-act]');
        const act = el?.dataset.act;
        if (this.ruleBuilderClick(e)) return;
        if (act === 'cancel') { this.requestCloseNewPersonList(); return; }
        if (act === 'show-tree') { this.showNewPersonListInTree(); return; }
        if (act === 'create') { this.saveNewPersonList(); return; }
        if (act === 'keep') {
            if (el!.getAttribute('aria-disabled') === 'true') return;
            st.dynamic = !st.dynamic;
            this.renderNewPersonList();
            return;
        }
        if (act === 'person') { this.openNewPersonListPicker(el!); return; }
        if (act === 'family-more') { this.newPersonListToFamily(); return; }
        if (act === 'by') { this.openNewPersonListByMenu(el!); return; }
        if (act === 'more') { this.openNewPersonListMoreMenu(el!); return; }
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
        if (this.ruleBuilderChange(e)) return;
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
        if (this.ruleBuilderInput(e)) return;
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
        if (!st) return;
        const el = e.target as HTMLElement;
        // Ctrl+Z (⌘Z) outside a text field: the builder's last step back, never the tree's undo.
        if (st.opt === 'custom' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
            const typing = (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio') || el instanceof HTMLTextAreaElement;
            if (!typing) {
                e.preventDefault();
                e.stopPropagation();
                this.ruleBuilderUndo();
                return;
            }
        }
        if (this.ruleBuilderKey(e)) return;
        if (e.key !== 'Enter') return;
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
        if (opt === 'custom' && !st.rb) {
            // The builder starts from the tile's rule when it is complete (the same people), else empty.
            const rule = st.opt !== 'custom' ? ruleOf(st, st.opt) : null;
            const root: RuleGroup = rule ? { t: 'group', op: 'all', items: [ruleToCustom(rule, DataManager.getLineageIndex())] } : emptyRuleRoot();
            st.rb = newRuleBuilder(root, st.listId);
            st.rb.focus = rule ? { path: '0' } : { add: '' };
        }
        if (opt === 'custom' && st.rb) this.newPersonListAttachRule(st.rb);
        else if (st.opt === 'custom') {
            // Back to a tile: a one-condition rule it knows gives its parameters.
            this.closeRuleMenu();
            const simple = st.rb ? customToRule(st.rb.root) : null;
            if (simple) this.newPersonListTakeRule(simple, opt);
        }
        st.opt = opt;
        if (!canKeep(st)) st.dynamic = false;
        this.newPersonListRuleChanged();
        if (opt !== 'custom') {
            document.querySelector<HTMLElement>(`#${st.overlayId} .pln-opt[data-opt="${opt}"] .pln-radio`)?.focus({ preventScroll: true });
        }
    },

    /** A one-condition rule's parameters into the tile it belongs to (only when it is that tile). */
    newPersonListTakeRule(rule: PersonListRule, opt: Opt): void {
        const st = state;
        if (!st) return;
        switch (rule.kind) {
            case 'rods': if (opt === 'rods' && rule.rodIds[0]) st.rodId = rule.rodIds[0]; break;
            case 'ancestors':
            case 'descendants':
                if (opt === rule.kind) {
                    if (personOf(rule.personId)) st.personId = rule.personId;
                    st.gens = rule.generations ?? 0;
                }
                break;
            case 'line': if (opt === 'line') st.lineId = rule.directionId; break;
            case 'added':
                if (opt === 'added') {
                    st.days = rule.days;
                    st.customDays = !(PERIODS as readonly number[]).includes(rule.days);
                }
                break;
            default: break;
        }
    },

    /**
     * "More options: family of a person…" (§1.5): the builder with one Family
     * of a person – ancestors: up the generations, down 0; descendants the
     * other way round; the direct line, both parents, no spouses.
     */
    newPersonListToFamily(): void {
        const st = state;
        const p = st ? personOf(st.personId) : null;
        if (!st || !p || (st.opt !== 'ancestors' && st.opt !== 'descendants')) return;
        const g: number | 'all' = st.gens || 'all';
        const root: RuleGroup = {
            t: 'group', op: 'all', items: [{
                t: 'cond', c: 'family', p: {
                    personId: p.id, personName: shownName(p), via: 'both', width: 'line', spouses: 'none',
                    up: st.opt === 'ancestors' ? g : 0, down: st.opt === 'descendants' ? g : 0,
                },
            }],
        };
        const before = st.rb;
        st.rb = newRuleBuilder(root, st.listId, before?.start ?? null);
        st.rb.focus = { path: '0' };
        this.setNewPersonListOpt('custom');
    },

    /** "Custom rule ▾": back to a tile (the custom rule stays until the dialog closes). */
    openNewPersonListByMenu(anchor: HTMLElement): void {
        const st = state;
        if (!st) return;
        const n = strings.lists.new;
        const label: Record<Opt, string> = {
            empty: n.empty, rods: n.rod, ancestors: n.anc, descendants: n.des, line: n.line, added: n.added, custom: n.customRule,
        };
        const rods = rodChoices();
        const rows: RuleMenuRow[] = [];
        for (const opt of SIMPLE_OPTS) {
            if (opt === 'empty' && st.mode === 'edit') continue;
            if (opt === 'line' && !offeredResearchLines(st.lineId).length) continue;
            const off = opt === 'rods' && !rods.big.length && !rods.small.length;
            rows.push({ id: opt, label: label[opt], checked: false, ...(off ? { disabled: true } : {}) });
        }
        rows.push({ id: 'custom', label: n.customRule, checked: true, sep: true });
        this.openRuleMenu(anchor, n.basedOn, rows, (id) => {
            if (id !== 'custom') this.setNewPersonListOpt(id as Opt);
        });
    },

    /** The custom rule's ⋯: the next parts' rows, then "Clear the rule". */
    openNewPersonListMoreMenu(anchor: HTMLElement): void {
        const st = state;
        if (!st?.rb) return;
        const r = strings.lists.rules;
        const extra = this.newPersonListMoreRows();
        const rows: RuleMenuRow[] = [...extra, { id: 'clear', label: r.clear, disabled: !st.rb.root.items.length, sep: extra.length > 0 }];
        this.openRuleMenu(anchor, r.more, rows, (id) => {
            if (id === 'clear') {
                this.ruleBuilderSet(emptyRuleRoot(), { add: '' });
                return;
            }
            this.newPersonListMoreAction(id);
        });
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
        // A custom rule: one the tiles know is saved as `rule` (customToRule in currentRule), else as `custom` (D3).
        const root = st.mode !== 'save' ? customRoot(st) : null;
        if (root && (!st.rb || ruleBuilderBlock(st.rb) !== null)) return;
        const rule = currentRule(st);
        const custom = root && !rule ? { v: 1 as const, root: cloneRuleNode(root), auto: st.dynamic } : null;
        let list: PersonList | null = null;
        if (st.mode === 'edit') {
            const before = st.listId ? DataManager.getPersonList(st.listId) : undefined;
            if (!before || (!rule && !custom)) return;
            if (custom) {
                const same = JSON.stringify(before.custom?.root ?? null) === JSON.stringify(custom.root) && listIsAuto(before) === st.dynamic;
                if (!same) DataManager.setPersonListCustomRule(before.id, custom);
            } else if (rule) {
                const same = !before.custom && JSON.stringify(before.rule ?? null) === JSON.stringify(rule) && listIsAuto(before) === st.dynamic;
                if (!same) DataManager.setPersonListRule(before.id, rule, st.dynamic);
            }
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
            } else if (custom) {
                list = DataManager.createCustomPersonList({ name, custom });
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
