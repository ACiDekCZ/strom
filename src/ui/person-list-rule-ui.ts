/**
 * The builder of a custom list rule (spec 136 §2, §5) inside the dialog New
 * list / Edit the rule (src/ui/person-list-new-ui.ts): the conditions as
 * rows, "and" / "or" before each row after the first, "except" in bold at
 * the end of its group, groups indented under a 1 px line (no fill), at most
 * three levels. Each row: a handle (a mouse only), the joining word, the
 * condition's name and parameters (its editor, src/ui/person-list-rule-editors.ts),
 * its own count over the whole tree and ⋯ (Except / Include, Move up / down,
 * Group with…, Duplicate, Remove). A group's ⋯: Except, Ungroup, Move,
 * Remove group. Rows move by dragging the handle, Alt+↑/↓ or ⋯; Ctrl+Z
 * (⌘Z) undoes the builder's last step (its own stack, not the tree's).
 * "+ Add condition" opens the catalog; "+ Add group" a group of one condition
 * picked from it (not in the third level). On a phone the joining word goes
 * before the name and the menus are sheets from below.
 *
 * The rule's tree is changed by the pure steps of src/person-list-rule-edit.ts;
 * the dialog owns the state (RuleBuilderState) and draws the builder's HTML
 * where it wants it.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import type { PersonId, RuleCond, RuleGroup, RuleNode } from '../types.js';
import type { LineageIndex } from '../lineage.js';
import { condNeed, evalRuleCounts, nodeLabel, ruleIssues, type RuleCounts, type RuleNeed } from '../person-list-rules.js';
import {
    addCondition, addGroup, canAddGroup, canExcept, cloneRuleNode, dissolveGroup, duplicateNode, firstIncomplete,
    groupWithNext, groupWithNextState, joinPath, moveBounds, moveNode, moveNodeTo, nodeAt, normalizeRule,
    parentOf, removeNode, replaceCondition, setGroupOp, toggleExcept, type RuleEdit,
} from '../person-list-rule-edit.js';
import { escHtml as esc, newRuleCond, ruleCatalog, ruleCondEditor, type RuleEditorCtx, type RulePickOpts, type RulePickRow } from './person-list-rule-editors.js';
import './person-list-rule-cond-editors.js';
import './person-list-rule-near.js';
import './person-list-rule-family.js';
import { foldSearch2 } from '../section-search-match.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import { getUI } from '../ui-ref.js';
import { TreeRenderer } from '../renderer.js';
import { MQ_PHONE_BAR } from '../breakpoints.js';
import { uiModule } from './module.js';

/** The builder's state, kept by the dialog while it is open. */
export interface RuleBuilderState {
    root: RuleGroup;
    /** The rule the dialog opened with (null: none) – "Discard the unfinished rule?". */
    start: RuleGroup | null;
    /** The steps back (Ctrl+Z, "Undo" of a removal). */
    undo: RuleGroup[];
    /** The root before typing started in a field (one undo step per field). */
    typingFrom: RuleGroup | null;
    /** The list being edited (a list condition must not lead back to it). */
    listId: string | null;
    /** What to focus after the next drawing: a row, or a control of it. */
    focus: { path: string; ctl?: string } | { add: string } | null;
    counts: { key: string; index: LineageIndex; value: RuleCounts } | null;
}

/** What the dialog does when the rule changes. */
export interface RuleBuilderHost {
    /** The rule changed (the name follows it): draw the dialog again, or (`render` false) only its counts and buttons. */
    changed(render: boolean): void;
}

/** A row of the builder's menus (the same rows in the popup and in the phone's sheet). */
export type RuleMenuRow = RulePickRow;

const UNDO_MAX = 50;
const UNDO_MS = 6000;

let rb: RuleBuilderState | null = null;
let host: RuleBuilderHost | null = null;
let menuClose: (() => void) | null = null;
let menuAnchor: HTMLElement | null = null;
let closePersonPick: (() => void) | null = null;
let drag: { cleanup: () => void; path: string; lo: number; k: number } | null = null;

export function newRuleBuilder(root: RuleGroup, listId: string | null, start: RuleGroup | null = null): RuleBuilderState {
    return { root: normalizeRule(root), start, undo: [], typingFrom: null, listId, focus: null, counts: null };
}

function isNarrow(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MQ_PHONE_BAR).matches;
}

function index(): LineageIndex {
    return DataManager.getLineageIndex();
}

function focusId(): PersonId | null {
    return TreeRenderer.getFocusPersonId();
}

/** A change counts after this pause (spec 136 §6). */
export const RULE_COUNT_DEBOUNCE_MS = 120;
/** A count that took longer shows "Counting…" (and the previous total) while the next one runs. */
export const RULE_COUNT_SLOW_MS = 200;

let countTimer: ReturnType<typeof setTimeout> | null = null;
/** How long the last count took (ms). */
let lastCountMs = 0;
/** "Counting…" is shown (the rows' counts "…"). */
let countBusy = false;

function countNow(st: RuleBuilderState, key: string, ix: LineageIndex): void {
    const t0 = performance.now();
    st.counts = { key, index: ix, value: evalRuleCounts(ix, st.root, { now: Date.now() }, st.listId ?? undefined) };
    lastCountMs = performance.now() - t0;
}

function countsFresh(st: RuleBuilderState): boolean {
    return !!st.counts && st.counts.key === JSON.stringify(st.root) && st.counts.index === index();
}

/**
 * The counts of the rule (each node's own over the whole tree, and the
 * total), kept while the rule and the tree are the same. The first count is
 * made at once; after a change the last counts are returned and the new ones
 * follow after a pause (RULE_COUNT_DEBOUNCE_MS): the rows and the footer are
 * written again then, without a drawing.
 */
export function ruleBuilderCounts(st: RuleBuilderState): RuleCounts {
    const key = JSON.stringify(st.root);
    const ix = index();
    if (!st.counts) countNow(st, key, ix);
    else if (st.counts.key !== key || st.counts.index !== ix) scheduleCount(st);
    return st.counts!.value;
}

/** The counts shown are not the rule's yet and "Counting…" is up (a slow count runs). */
export function ruleBuilderCountsBusy(st: RuleBuilderState): boolean {
    return countBusy && !countsFresh(st);
}

/** Count the rule (now, without the pause): the tests and the preview in the tree need the result at once. */
export function ruleBuilderCountsNow(st: RuleBuilderState): RuleCounts {
    if (!countsFresh(st)) countNow(st, JSON.stringify(st.root), index());
    if (countTimer) { clearTimeout(countTimer); countTimer = null; }
    countBusy = false;
    return st.counts!.value;
}

function scheduleCount(st: RuleBuilderState): void {
    if (countTimer) clearTimeout(countTimer);
    countTimer = setTimeout(() => {
        countTimer = null;
        if (rb !== st || countsFresh(st)) return;
        const run = (): void => {
            if (rb !== st) return;
            if (!countsFresh(st)) countNow(st, JSON.stringify(st.root), index());
            countBusy = false;
            const ui = getUI() as unknown as { ruleBuilderRefreshCounts(): void };
            ui.ruleBuilderRefreshCounts();
            host?.changed(false);
        };
        if (lastCountMs <= RULE_COUNT_SLOW_MS) { run(); return; }
        // A slow count: "Counting…" first (the previous total beside it), then the count after a paint.
        countBusy = true;
        (getUI() as unknown as { ruleBuilderRefreshCounts(): void }).ruleBuilderRefreshCounts();
        host?.changed(false);
        requestAnimationFrame(() => setTimeout(run, 0));
    }, RULE_COUNT_DEBOUNCE_MS);
}

/**
 * Why the rule cannot be saved now (the footer's sentence), or null: no
 * condition, an incomplete condition ("Condition 2 is incomplete"), a group
 * of excepts only, another issue.
 */
export function ruleBuilderBlock(st: RuleBuilderState): string | null {
    const t = strings.lists.rules;
    if (!st.root.items.length) return t.noConditions;
    const inc = firstIncomplete(st.root);
    if (inc) return t.incomplete(inc.n);
    const issues = ruleIssues(st.root, { lists: DataManager.getPersonLists(), listId: st.listId ?? undefined });
    if (!issues.length) return null;
    return issues.some(i => i.kind === 'exceptFirst' || i.kind === 'exceptOnly') ? t.needPlus : t.cantSave;
}

/** What an incomplete condition shows in place of its count. */
function fillText(need: RuleNeed): string {
    const f = strings.lists.rules.fill;
    switch (need) {
        case 'person': return f.person;
        case 'place': return f.place;
        case 'list': return f.list;
        case 'years': return f.year;
        case 'text': case 'occupation': return f.text;
        default: return '–';
    }
}

/**
 * The row where the rule's people fell to nobody ("0 here", §6): only when the
 * total is 0, the rule's own group is "all" and the counts are the rule's.
 */
function zeroPath(st: RuleBuilderState, counts: RuleCounts): string | null {
    if (counts.total !== 0 || st.root.op !== 'all' || !countsFresh(st)) return null;
    return counts.zeroAt;
}

function rowKey(path: string, name: string): string {
    return `plr-${path || 'root'}-${name}`;
}

export const personListRuleMethods = uiModule({
    /** Take the builder's state and the dialog that shows it (until ruleBuilderDetach). */
    ruleBuilderAttach(state: RuleBuilderState, h: RuleBuilderHost): void {
        rb = state;
        host = h;
    },

    ruleBuilderDetach(): void {
        this.closeRuleMenu();
        drag?.cleanup();
        drag = null;
        rb = null;
        host = null;
        if (countTimer) { clearTimeout(countTimer); countTimer = null; }
        countBusy = false;
    },

    /** The builder's HTML (`.plr`). */
    ruleBuilderHtml(): string {
        const st = rb;
        if (!st) return '';
        const t = strings.lists.rules;
        const counts = ruleBuilderCounts(st);
        const seg = (path: string, g: RuleGroup, label: string): string =>
            `<div class="sel-seg plr-seg" role="group" aria-label="${esc(label)}">`
            + (['all', 'any'] as const).map(op => `<button type="button" class="sel-opt" data-sel-form="seg" data-rb="op" data-op="${op}" data-key="${esc(rowKey(path, `op-${op}`))}" aria-pressed="${g.op === op}">${esc(op === 'all' ? t.all : t.any)}</button>`).join('')
            + `</div>`;
        return `<div class="plr" role="group" aria-label="${esc(t.conditions)}" data-path="">`
            + `<div class="plr-top"><span class="plr-tk">${esc(t.conditions)}</span>${seg('', st.root, t.conditions)}</div>`
            + `<div class="plr-rows">${st.root.items.map((n, i) => this.ruleRowHtml(st.root, n, String(i), i, counts)).join('')}</div>`
            + this.ruleAddHtml('')
            + `</div>`;
    },

    /** "+ Add condition" and (not in the last level) "+ Add group" of a group. */
    ruleAddHtml(groupPath: string): string {
        const t = strings.lists.rules;
        return `<div class="plr-add">`
            + `<button type="button" class="pl-link" data-rb="add" data-key="${esc(rowKey(groupPath, 'add'))}" aria-haspopup="menu" aria-expanded="false">+ ${esc(t.addCondition)}</button>`
            + (canAddGroup(groupPath) ? `<button type="button" class="pl-link" data-rb="add-group" data-key="${esc(rowKey(groupPath, 'addg'))}" aria-haspopup="menu" aria-expanded="false">+ ${esc(t.addGroup)}</button>` : '')
            + `</div>`;
    },

    /** One row: a condition, or a group with its rows under it. */
    ruleRowHtml(parent: RuleGroup, node: RuleNode, path: string, i: number, counts: RuleCounts): string {
        const t = strings.lists.rules;
        const ix = index();
        const conj = i === 0 ? '' : node.not ? t.except : parent.op === 'all' ? t.and : t.or;
        const ex = node.not ? ' ex' : '';
        const n = counts.nodes.get(path);
        const need = node.t === 'cond' ? condNeed(node) : null;
        const busy = !need && rb ? ruleBuilderCountsBusy(rb) : false;
        const countText = need ? fillText(need) : busy ? '…' : n === null || n === undefined ? '–' : strings.lists.persons(n);
        const miss = need ? ' miss' : busy ? ' is-busy' : '';
        const zero = rb && zeroPath(rb, counts) === path ? `<span class="plr-zero">${esc(t.zeroHere)}</span>` : '';
        const name = node.t === 'cond' ? t.cond[node.c] : t.group;
        const words = need ? name : nodeLabel(node, ix);
        const aria = `${node.not ? `${t.except} ` : ''}${words}, ${countText}`;
        const head = `<span class="plr-h" aria-hidden="true" title="${esc(strings.lists.handle)}">⠿</span>`
            + `<span class="plr-c${ex}">${esc(conj)}</span>`;
        const inline = conj ? `<span class="plr-ci${ex}">${esc(conj)}</span>` : '';
        const k2 = `<span class="plr-k2${miss}">${esc(countText)}</span>`;
        const tail = `<span class="plr-k${miss}">${esc(countText)}</span>`
            + `<button type="button" class="plr-d" data-rb="menu" data-key="${esc(rowKey(path, 'menu'))}" aria-haspopup="menu" aria-expanded="false"`
            + ` aria-label="${esc(node.t === 'cond' ? t.condMore : t.groupMore)}"><span aria-hidden="true">⋯</span></button>`;
        const attrs = `role="group" tabindex="0" data-path="${esc(path)}" data-not="${node.not ? 1 : 0}" data-key="${esc(rowKey(path, 'row'))}" aria-label="${esc(aria)}"`;
        if (node.t === 'group') {
            return `<div class="plr-row plr-grp" ${attrs}>${head}`
                + `<div class="plr-m plr-gh">${inline}<span class="plr-n">${esc(t.group)}</span>${zero}${k2}`
                + `<div class="sel-seg plr-seg" role="group" aria-label="${esc(t.group)}">`
                + (['all', 'any'] as const).map(op => `<button type="button" class="sel-opt" data-sel-form="seg" data-rb="op" data-op="${op}" data-key="${esc(rowKey(path, `op-${op}`))}" aria-pressed="${node.op === op}">${esc(op === 'all' ? t.all : t.any)}</button>`).join('')
                + `</div></div>${tail}`
                + `<div class="plr-kids">${node.items.map((kid, j) => this.ruleRowHtml(node, kid, joinPath(path, j), j, counts)).join('')}`
                + this.ruleAddHtml(path) + `</div></div>`;
        }
        const editor = ruleCondEditor(node.c);
        const ctx = this.ruleEditorCtx(path);
        const params = editor ? editor.paramsHtml(node as never, ctx) : need ? '' : `<span class="plr-w">${esc(words)}</span>`;
        const hint = editor?.hintHtml ? '' : editor?.hint ? editor.hint(node as never, ctx) : '';
        const hintHtml = editor?.hintHtml ? editor.hintHtml(node as never, ctx) : '';
        return `<div class="plr-row" ${attrs}>${head}`
            + `<div class="plr-m">${inline}<span class="plr-n">${esc(name)}</span>${zero}${k2}`
            + (params ? `<span class="plr-p">${params}</span>` : '')
            + (hint ? `<span class="plr-s">${esc(hint)}</span>` : '')
            + (hintHtml ? `<div class="plr-s plr-sx">${hintHtml}</div>` : '')
            + `</div>${tail}</div>`;
    },

    /** What an editor of the row at `path` gets. */
    ruleEditorCtx(path: string): RuleEditorCtx {
        const overlay = document.querySelector<HTMLElement>('.pln-overlay');
        return {
            path, index: index(), focusId: focusId(), host: overlay, listId: rb?.listId ?? null,
            key: (name: string) => rowKey(path, `p-${name}`),
            menu: (anchor, title, rows, onPick, opts) => this.openRuleMenu(anchor, title, rows, onPick, opts),
            pickPerson: (anchor, selectedId, onPick) => this.ruleBuilderPickPerson(anchor, selectedId, onPick),
            update: (cond: RuleCond, opts?: { render?: boolean }) => {
                const st = rb;
                if (!st) return;
                const render = opts?.render !== false;
                if (render) {
                    this.ruleBuilderSet(replaceCondition(st.root, path, cond), null, st.typingFrom ?? undefined);
                    st.typingFrom = null;
                } else {
                    st.typingFrom ??= st.root;
                    st.root = replaceCondition(st.root, path, cond);
                    this.ruleBuilderRefreshCounts();
                    host?.changed(false);
                }
            },
        };
    },

    /**
     * A new rule from a step: the step before goes on the undo stack (`from`:
     * the root before typing started), what to focus, the dialog drawn again.
     */
    ruleBuilderSet(root: RuleGroup, focus: RuleBuilderState['focus'], from?: RuleGroup): void {
        const st = rb;
        if (!st) return;
        const before = from ?? st.root;
        if (JSON.stringify(before) !== JSON.stringify(root)) {
            st.undo.push(before);
            if (st.undo.length > UNDO_MAX) st.undo.shift();
        }
        st.root = root;
        st.typingFrom = null;
        if (focus) st.focus = focus;
        host?.changed(true);
    },

    /** Ctrl+Z (⌘Z) in the dialog: the builder's last step back. */
    ruleBuilderUndo(): boolean {
        const st = rb;
        const prev = st?.undo.pop();
        if (!st || !prev) return false;
        st.root = prev;
        st.typingFrom = null;
        st.focus = null;
        host?.changed(true);
        return true;
    },

    /** After a drawing: focus what the last step asked for. */
    ruleBuilderFocus(): void {
        const st = rb;
        const f = st?.focus;
        if (!st || !f) return;
        st.focus = null;
        const box = document.querySelector<HTMLElement>('.pln-overlay .plr');
        if (!box) return;
        let el: HTMLElement | null = null;
        if ('add' in f) el = box.querySelector<HTMLElement>(`[data-key="${CSS.escape(rowKey(f.add, 'add'))}"]`);
        else if (f.ctl) el = box.querySelector<HTMLElement>(`[data-key="${CSS.escape(rowKey(f.path, `p-${f.ctl}`))}"]`);
        if (!el && !('add' in f)) el = box.querySelector<HTMLElement>(`.plr-row[data-path="${CSS.escape(f.path)}"]`);
        el ??= box.querySelector<HTMLElement>('[data-rb="add"]');
        el?.focus({ preventScroll: false });
    },

    /** The counts in the rows without a new drawing (while a year is typed). */
    ruleBuilderRefreshCounts(): void {
        const st = rb;
        const box = document.querySelector<HTMLElement>('.pln-overlay .plr');
        if (!st || !box) return;
        const counts = ruleBuilderCounts(st);
        const busy = ruleBuilderCountsBusy(st);
        const zeroAt = zeroPath(st, counts);
        for (const row of box.querySelectorAll<HTMLElement>('.plr-row')) {
            const path = row.dataset.path ?? '';
            const node = nodeAt(st.root, path);
            if (!node) continue;
            const need = node.t === 'cond' ? condNeed(node) : null;
            const n = counts.nodes.get(path);
            const text = need ? fillText(need) : busy ? '…' : n === null || n === undefined ? '–' : strings.lists.persons(n);
            for (const cell of row.querySelectorAll<HTMLElement>(':scope > .plr-k, :scope > .plr-m > .plr-k2')) {
                cell.textContent = text;
                cell.classList.toggle('miss', !!need);
                cell.classList.toggle('is-busy', !need && busy);
            }
            const m = row.querySelector<HTMLElement>(':scope > .plr-m');
            const mark = m?.querySelector<HTMLElement>(':scope > .plr-zero');
            if (zeroAt === path && m && !mark) {
                const z = document.createElement('span');
                z.className = 'plr-zero';
                z.textContent = strings.lists.rules.zeroHere;
                m.querySelector(':scope > .plr-n')?.after(z);
            } else if (zeroAt !== path) mark?.remove();
        }
    },

    /** A click in the builder (true: it was the builder's). */
    ruleBuilderClick(e: MouseEvent): boolean {
        const st = rb;
        const target = e.target as HTMLElement;
        if (!st || !target.closest('.plr')) return false;
        const el = target.closest<HTMLElement>('[data-rb], [data-pc]');
        if (!el) return true;
        const row = el.closest<HTMLElement>('.plr-row');
        const path = row?.dataset.path ?? '';
        if (el.dataset.pc !== undefined) {
            if (el.tagName !== 'BUTTON' || !row || el.getAttribute('aria-disabled') === 'true') return true;
            const node = nodeAt(st.root, path);
            const editor = node?.t === 'cond' ? ruleCondEditor(node.c) : null;
            if (node?.t === 'cond' && editor?.click) editor.click(node as never, el, this.ruleEditorCtx(path));
            return true;
        }
        const groupPath = el.closest<HTMLElement>('.plr-add')?.parentElement?.closest<HTMLElement>('[data-path]')?.dataset.path ?? '';
        switch (el.dataset.rb) {
            case 'op': {
                const gPath = el.closest('.plr-top') ? '' : path;
                const op = el.dataset.op === 'any' ? 'any' : 'all';
                const g = nodeAt(st.root, gPath);
                if (g?.t === 'group' && g.op !== op) this.ruleBuilderSet(setGroupOp(st.root, gPath, op), null);
                return true;
            }
            case 'add': this.ruleBuilderOpenCatalog(el, groupPath, false); return true;
            case 'add-group': this.ruleBuilderOpenCatalog(el, groupPath, true); return true;
            case 'menu': this.ruleBuilderOpenRowMenu(el, path); return true;
            default: return true;
        }
    },

    /** A `change` of an editor's control (true: it was the builder's). */
    ruleBuilderChange(e: Event): boolean {
        return this.ruleBuilderControl(e, 'change');
    },

    /** Typing in an editor's field: its counts only (true: it was the builder's). */
    ruleBuilderInput(e: Event): boolean {
        return this.ruleBuilderControl(e, 'input');
    },

    ruleBuilderControl(e: Event, kind: 'change' | 'input'): boolean {
        const st = rb;
        const el = e.target as HTMLInputElement | HTMLSelectElement;
        if (!st || !el.closest?.('.plr')) return false;
        const row = el.closest<HTMLElement>('.plr-row');
        if (el.dataset.pc === undefined || !row) return true;
        const path = row.dataset.path ?? '';
        const node = nodeAt(st.root, path);
        if (node?.t !== 'cond') return true;
        const editor = ruleCondEditor(node.c);
        const ctx = this.ruleEditorCtx(path);
        const fn = kind === 'change' ? editor?.change : editor?.input;
        const p = fn ? fn(node as never, el, ctx) : null;
        if (!p) return true;
        // A typed field's change (leaving it, Enter) keeps the drawing: drawing again here would take the
        // focus from where it is going (the next field). The typing becomes one step back.
        const typed = el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio';
        if (kind === 'change' && typed) {
            ctx.update({ ...node, p } as RuleCond, { render: false });
            const from = st.typingFrom;
            st.typingFrom = null;
            if (from && JSON.stringify(from) !== JSON.stringify(st.root)) {
                st.undo.push(from);
                if (st.undo.length > UNDO_MAX) st.undo.shift();
            }
            return true;
        }
        ctx.update({ ...node, p } as RuleCond, { render: kind === 'change' });
        return true;
    },

    /** Keys in the builder: Alt+↑/↓ on a focused row moves it (true: handled). */
    ruleBuilderKey(e: KeyboardEvent): boolean {
        const st = rb;
        const target = e.target as HTMLElement;
        if (!st || !target.closest?.('.plr')) return false;
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && target.classList.contains('plr-row')) {
            e.preventDefault();
            const r = moveNode(st.root, target.dataset.path ?? '', e.key === 'ArrowUp' ? -1 : 1);
            if (r) this.ruleBuilderSet(r.root, { path: r.path });
            return true;
        }
        // Enter in a parameter's field does not confirm the dialog.
        if (e.key === 'Enter' && target.dataset.pc !== undefined && target.tagName === 'INPUT') {
            e.preventDefault();
            (target as HTMLInputElement).blur();
            return true;
        }
        return false;
    },

    /** The catalog under "+ Add condition" (or "+ Add group": the condition picked starts a new group). */
    ruleBuilderOpenCatalog(anchor: HTMLElement, groupPath: string, asGroup: boolean): void {
        const st = rb;
        if (!st) return;
        const t = strings.lists.rules;
        const items = ruleCatalog(index());
        const heads = t.catalog.head as Partial<Record<string, string>>;
        const subs = t.catalog.sub as Partial<Record<string, string>>;
        let last = '';
        const rows: RuleMenuRow[] = items.map(({ c, group }) => {
            // Groups f and g (count, text) sit under the facts' heading.
            const g = group === 'f' || group === 'g' ? 'e' : group;
            const row: RuleMenuRow = { id: c, label: t.cond[c], ...(subs[c] ? { sub: subs[c] } : {}), ...(g !== last && heads[g] ? { head: heads[g] } : {}) };
            last = g;
            return row;
        });
        this.openRuleMenu(anchor, asGroup ? t.addGroup : t.addCondition, rows, (c) => {
            const s = rb;
            if (!s) return;
            const cond = newRuleCond(c as RuleCond['c'], { index: index(), focusId: focusId() });
            if (!cond) return;
            const r: RuleEdit | null = asGroup ? addGroup(s.root, groupPath, cond) : addCondition(s.root, groupPath, cond);
            if (!r) return;
            const editor = ruleCondEditor(cond.c);
            this.ruleBuilderSet(r.root, { path: r.path, ctl: editor?.firstControl });
            if (editor?.openOnAdd && editor.firstControl) {
                const ctl = document.querySelector<HTMLElement>(`.pln-overlay [data-key="${CSS.escape(rowKey(r.path, `p-${editor.firstControl}`))}"]`);
                ctl?.click();
            }
        }, { wide: true, search: t.catalog.search });
    },

    /** A person's choice by an editor's control (the dialog's person popover). */
    ruleBuilderPickPerson(anchor: HTMLElement, selectedId: PersonId | null, onPick: (id: PersonId) => void): void {
        if (closePersonPick) { closePersonPick(); return; }
        const overlay = anchor.closest<HTMLElement>('.modal-overlay');
        if (!overlay) return;
        const tt = strings.treeOverview;
        const suggested: Array<{ id: PersonId; meta: string }> = [];
        if (selectedId) suggested.push({ id: selectedId, meta: '' });
        const focus = focusId();
        if (focus && focus !== selectedId) suggested.push({ id: focus, meta: tt.inFocus });
        const treeId = DataManager.getCurrentTreeId();
        if (treeId) for (const id of readRecent(treeId)) suggested.push({ id, meta: tt.recent });
        anchor.setAttribute('aria-expanded', 'true');
        closePersonPick = openPersonPopover({
            host: overlay, anchor, data: DataManager.getData(), selectedId, suggested,
            labels: { search: strings.lists.pickSearch, list: strings.lists.rules.pick.person, noMatch: tt.noMatch },
            onClose: () => { closePersonPick = null; if (anchor.isConnected) anchor.setAttribute('aria-expanded', 'false'); },
            onPick: (id) => onPick(id),
        });
    },

    /** ⋯ of a condition or a group. */
    ruleBuilderOpenRowMenu(anchor: HTMLElement, path: string): void {
        const st = rb;
        const node = st ? nodeAt(st.root, path) : null;
        if (!st || !node || path === '') return;
        const t = strings.lists.rules;
        const l = strings.lists;
        const moves = moveBounds(st.root, path);
        const rows: RuleMenuRow[] = [];
        const exceptOk = canExcept(st.root, path);
        rows.push({
            id: 'except', label: node.not ? t.include : t.except,
            disabled: !exceptOk, ...(!exceptOk ? { why: t.firstOfGroup } : {}),
        });
        if (node.t === 'group') rows.push({ id: 'dissolve', label: t.dissolve });
        rows.push({ id: 'up', label: l.up, kbd: 'Alt+↑', disabled: !moves.up, sep: true });
        rows.push({ id: 'down', label: l.down, kbd: 'Alt+↓', disabled: !moves.down });
        if (node.t === 'cond') {
            const g = groupWithNextState(st.root, path);
            if (g !== 'hidden') rows.push({ id: 'group', label: t.intoGroup, disabled: g === 'disabled' });
            rows.push({ id: 'dup', label: l.menu.dup });
        }
        rows.push({ id: 'remove', label: node.t === 'group' ? t.removeGroup : t.remove, danger: true, sep: true });
        const label = node.t === 'cond' ? t.cond[node.c] : t.group;
        this.openRuleMenu(anchor, label, rows, (id) => this.ruleBuilderRowAction(path, id));
    },

    /** A row's ⋯ action. */
    ruleBuilderRowAction(path: string, id: string): void {
        const st = rb;
        if (!st) return;
        const root = st.root;
        let r: RuleEdit | null = null;
        switch (id) {
            case 'except': r = toggleExcept(root, path); break;
            case 'dissolve': r = dissolveGroup(root, path); break;
            case 'up': r = moveNode(root, path, -1); break;
            case 'down': r = moveNode(root, path, 1); break;
            case 'group': r = groupWithNext(root, path); break;
            case 'dup': r = duplicateNode(root, path); break;
            case 'remove': {
                r = removeNode(root, path);
                const groupPath = parentOf(path).parent;
                this.ruleBuilderSet(r.root, r.path ? { path: r.path } : { add: nodeAt(r.root, groupPath)?.t === 'group' ? groupPath : '' });
                const was = root;
                this.showToast(strings.lists.rules.removed, UNDO_MS, {
                    clearOf: '.pln-foot',
                    action: {
                        label: strings.undo.undo,
                        run: () => {
                            if (rb !== st) return;
                            this.ruleBuilderSet(cloneRuleNode(was), { path });
                        },
                    },
                });
                return;
            }
            default: return;
        }
        if (r) this.ruleBuilderSet(r.root, { path: r.path });
    },

    /** The handle pressed (a mouse): the row follows within its part of its group; a line shows where it lands. */
    ruleBuilderPointerDown(e: PointerEvent): void {
        const st = rb;
        const handle = (e.target as HTMLElement).closest<HTMLElement>('.plr-h');
        if (!st || !handle || drag || e.button !== 0) return;
        const row = handle.closest<HTMLElement>('.plr-row');
        const box = row?.parentElement;
        const path = row?.dataset.path;
        if (!row || !box || path === undefined) return;
        const sibs = [...box.children].filter((el): el is HTMLElement =>
            el instanceof HTMLElement && el.classList.contains('plr-row') && el.dataset.not === row.dataset.not);
        const others = sibs.filter(r => r !== row);
        if (!others.length) return;
        e.preventDefault();
        this.closeRuleMenu();
        const lo = Math.min(...sibs.map(r => parentOf(r.dataset.path ?? '').index));
        const line = document.createElement('div');
        line.className = 'pl-drop';
        line.setAttribute('aria-hidden', 'true');
        box.appendChild(line);
        box.classList.add('is-dragging');
        row.classList.add('is-lifted');
        const startY = e.clientY;
        const place = (y: number): void => {
            if (!drag) return;
            row.style.transform = `translateY(${Math.round(y - startY)}px)`;
            let k = 0;
            for (const r of others) {
                const b = r.getBoundingClientRect();
                if (y > b.top + b.height / 2) k++; else break;
            }
            drag.k = k;
            const ref = others[k] ?? others[others.length - 1];
            const rb2 = ref.getBoundingClientRect();
            const top = (others[k] ? rb2.top : rb2.bottom) - box.getBoundingClientRect().top;
            line.style.top = `${Math.round(top - 1.5)}px`;
        };
        const move = (ev: PointerEvent): void => { if (ev.pointerId === e.pointerId) place(ev.clientY); };
        const end = (ev: PointerEvent, drop: boolean): void => {
            if (ev.pointerId !== e.pointerId || !drag) return;
            const d = drag;
            d.cleanup();
            drag = null;
            if (!drop || !rb) return;
            const r = moveNodeTo(rb.root, d.path, d.lo + d.k);
            if (r) this.ruleBuilderSet(r.root, { path: r.path });
        };
        const up = (ev: PointerEvent): void => end(ev, true);
        const cancel = (ev: PointerEvent): void => end(ev, false);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        try { handle.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
        drag = {
            path, lo, k: 0,
            cleanup: () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', cancel);
                try { handle.releasePointerCapture(e.pointerId); } catch { /* released */ }
                row.classList.remove('is-lifted');
                row.style.transform = '';
                box.classList.remove('is-dragging');
                line.remove();
            },
        };
        place(e.clientY);
    },

    /**
     * A menu of the dialog: a popup by its button (arrows, Enter, Escape, a
     * click outside closes it), on a phone a sheet from below. `onPick` gets
     * the row's id (a disabled row does nothing).
     */
    openRuleMenu(anchor: HTMLElement, title: string, rows: RuleMenuRow[], onPick: (id: string) => void, opts: RulePickOpts = {}): void {
        const same = menuAnchor === anchor;
        this.closeRuleMenu();
        if (same) return;
        if (isNarrow()) { this.openRuleSheet(anchor, title, rows, onPick, opts); return; }
        const overlay = anchor.closest<HTMLElement>('.modal-overlay');
        if (!overlay) return;
        const multi = !!opts.multi;
        const menu = document.createElement('div');
        menu.className = `pl-menu plr-menu${opts.wide ? ' plr-menu--wide' : ''}${opts.search ? ' plr-menu--search' : ''}`;
        menu.setAttribute('role', opts.search ? 'dialog' : 'menu');
        menu.setAttribute('aria-label', title);
        const listRole = multi ? 'listbox' : 'menu';
        const rowsHtml = rows.map(r => (r.sep ? '<div class="pl-menu-sep" role="separator"></div>' : '')
            + (r.head ? `<div class="pl-mh" role="presentation">${esc(r.head)}</div>` : '')
            + `<button type="button" class="pl-menu-item${r.danger ? ' is-danger' : ''}" role="${multi ? 'option' : r.checked !== undefined ? 'menuitemradio' : 'menuitem'}"`
            + `${r.checked !== undefined ? ` aria-${multi ? 'selected' : 'checked'}="${!!r.checked}"` : ''} data-id="${esc(r.id)}"`
            + ` data-find="${esc(foldSearch2(`${r.label} ${r.sub ?? ''}`))}"${r.disabled ? ' aria-disabled="true"' : ''}${r.why ? ` title="${esc(r.why)}"` : ''}>`
            + `<span class="pl-menu-label">${esc(r.label)}${r.sub ? `<span class="pl-menu-sub">${esc(r.sub)}</span>` : ''}</span>`
            + (r.value ? `<span class="pl-menu-val">${esc(r.value)}</span>` : '')
            + (r.kbd ? `<span class="pl-menu-key" aria-hidden="true">${esc(r.kbd)}</span>` : '')
            + (r.checked !== undefined ? `<span class="pl-menu-check" aria-hidden="true">${r.checked ? '✓' : ''}</span>` : '')
            + `</button>`).join('');
        menu.innerHTML = opts.search
            ? `<input type="search" class="pl-msearch" placeholder="${esc(opts.search)}" aria-label="${esc(opts.search)}" autocomplete="off" spellcheck="false">`
                + `<div class="pl-mlist" role="${listRole}" aria-label="${esc(title)}"${multi ? ' aria-multiselectable="true"' : ''}>${rowsHtml}</div>`
                + `<div class="pl-mnone" hidden>${esc(strings.lists.rules.pick.none)}</div>`
            : rowsHtml;
        overlay.appendChild(menu);
        const search = menu.querySelector<HTMLInputElement>('.pl-msearch');
        const a = anchor.getBoundingClientRect();
        const w = menu.offsetWidth;
        const room = window.innerHeight - a.bottom - 12;
        const h = menu.offsetHeight;
        let left = Math.min(a.left, window.innerWidth - w - 8);
        if (anchor.classList.contains('plr-d') || anchor.classList.contains('pln-more')) left = Math.min(a.right - w, window.innerWidth - w - 8);
        left = Math.max(8, left);
        let top = a.bottom + 4;
        if (h > room && a.top - 4 - h > 8) top = a.top - 4 - h;
        else if (h > room) menu.style.maxHeight = `${Math.max(160, room)}px`;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        anchor.setAttribute('aria-expanded', 'true');
        anchor.classList.add('open');
        const items = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('.pl-menu-item:not([aria-disabled="true"]):not([hidden])')];
        const close = (refocus: boolean): void => {
            menu.remove();
            document.removeEventListener('pointerdown', outside, true);
            overlay.querySelector('.pln-body')?.removeEventListener('scroll', onScroll);
            anchor.setAttribute('aria-expanded', 'false');
            anchor.classList.remove('open');
            if (menuClose === closeFn) { menuClose = null; menuAnchor = null; }
            if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
            opts.onClose?.();
        };
        const closeFn = (): void => close(false);
        const outside = (ev: Event): void => {
            const tgt = ev.target as Node;
            if (menu.contains(tgt)) return;
            // The menu's own button toggles it on its click.
            if (anchor.contains(tgt)) return;
            close(false);
        };
        const onScroll = (): void => close(false);
        const pick = (item: HTMLElement): void => {
            if (item.getAttribute('aria-disabled') === 'true') return;
            if (multi) {
                const on = item.getAttribute('aria-selected') !== 'true';
                item.setAttribute('aria-selected', String(on));
                const mark = item.querySelector('.pl-menu-check');
                if (mark) mark.textContent = on ? '✓' : '';
                onPick(item.dataset.id ?? '');
                return;
            }
            close(true);
            onPick(item.dataset.id ?? '');
        };
        menu.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const item = (ev.target as HTMLElement).closest<HTMLElement>('.pl-menu-item');
            if (item) pick(item);
        });
        search?.addEventListener('input', () => {
            const q = foldSearch2(search.value.trim());
            let shown = 0;
            for (const it of menu.querySelectorAll<HTMLElement>('.pl-menu-item')) {
                const hit = !q || (it.dataset.find ?? '').includes(q);
                it.hidden = !hit;
                if (hit) shown++;
            }
            // A heading or a line stays only over a row still shown.
            for (const el of menu.querySelectorAll<HTMLElement>('.pl-mh, .pl-menu-sep')) {
                let n = el.nextElementSibling as HTMLElement | null;
                while (n && !n.classList.contains('pl-menu-item')) n = n.nextElementSibling as HTMLElement | null;
                el.hidden = !n || n.hidden;
            }
            const none = menu.querySelector<HTMLElement>('.pl-mnone');
            if (none) none.hidden = shown > 0;
        });
        menu.addEventListener('keydown', (ev) => {
            const list = items();
            const inSearch = ev.target === search;
            const at = list.indexOf(document.activeElement as HTMLElement);
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (inSearch) { (ev.key === 'ArrowDown' ? list[0] : list[list.length - 1])?.focus(); }
                else if (search && ev.key === 'ArrowUp' && at === 0) search.focus();
                else {
                    const next = ev.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
                    list[next]?.focus();
                }
            } else if ((ev.key === 'Home' || ev.key === 'End') && !inSearch) {
                ev.preventDefault();
                (ev.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
            } else if (ev.key === 'Enter' && inSearch) {
                // Enter in the search takes the first row shown.
                ev.preventDefault();
                if (list[0]) pick(list[0]);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                close(true);
            } else if (ev.key === 'Tab') {
                close(false);
            }
            ev.stopPropagation();
        });
        document.addEventListener('pointerdown', outside, true);
        overlay.querySelector('.pln-body')?.addEventListener('scroll', onScroll, { passive: true });
        menuClose = closeFn;
        menuAnchor = anchor;
        if (search) search.focus({ preventScroll: true });
        else items()[0]?.focus({ preventScroll: true });
    },

    /**
     * The phone's sheet of a menu or a choice: its rows from below, a search
     * field over them (16 px, 44 px high) and, for several rows (`multi`),
     * a tap ticks a row and the sheet stays.
     */
    openRuleSheet(_anchor: HTMLElement, title: string, rows: RuleMenuRow[], onPick: (id: string) => void, opts: RulePickOpts): void {
        const blocks: Array<{ rows: Array<{ id: string; label: string; run: () => void; danger?: boolean; disabled?: boolean; why?: string; active?: boolean; sub?: string; value?: string }>; divider?: boolean; header?: string }> = [];
        rows.forEach((r, i) => {
            if (!blocks.length || r.sep || r.head) blocks.push({ rows: [], divider: blocks.length > 0, ...(r.head ? { header: r.head } : {}) });
            blocks[blocks.length - 1].rows.push({
                id: `plr-opt-${i}`, label: r.label, run: () => { if (!r.disabled) onPick(r.id); },
                ...(r.danger ? { danger: true } : {}), ...(r.disabled ? { disabled: true } : {}),
                ...(r.why && r.disabled ? { why: r.why } : {}), ...(r.checked !== undefined ? { active: !!r.checked } : {}),
                ...(r.sub ? { sub: r.sub } : {}), ...(r.value ? { value: r.value } : {}),
            });
        });
        this.presentMenuSheet(title, blocks, opts.onClose ? { onClose: opts.onClose } : {});
        const sheet = (this.bottomSheet as HTMLElement | null)?.querySelector<HTMLElement>('.bottom-sheet');
        const list = sheet?.querySelector<HTMLElement>('.bottom-sheet-items');
        if (!sheet || !list) return;
        sheet.classList.add('plr-sheet');
        rows.forEach((r, i) => {
            const btn = list.querySelector<HTMLElement>(`#plr-opt-${i}`);
            if (!btn) return;
            btn.removeAttribute('id');
            btn.dataset.id = r.id;
            btn.dataset.find = foldSearch2(`${r.label} ${r.sub ?? ''}`);
            if (!opts.multi || r.disabled) return;
            // Several rows: a tap ticks (the sheet stays open).
            const tick = btn.cloneNode(true) as HTMLElement;
            tick.setAttribute('role', 'menuitemcheckbox');
            tick.setAttribute('aria-checked', String(!!r.checked));
            tick.addEventListener('click', () => {
                const on = tick.getAttribute('aria-checked') !== 'true';
                tick.setAttribute('aria-checked', String(on));
                tick.classList.toggle('active', on);
                onPick(r.id);
            });
            btn.replaceWith(tick);
        });
        if (!opts.search) return;
        const box = document.createElement('div');
        box.className = 'plr-sheet-search';
        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'pl-msearch';
        input.placeholder = opts.search;
        input.setAttribute('aria-label', opts.search);
        input.autocomplete = 'off';
        input.spellcheck = false;
        box.appendChild(input);
        const none = document.createElement('div');
        none.className = 'pl-mnone';
        none.hidden = true;
        none.textContent = strings.lists.rules.pick.none;
        list.before(box);
        list.after(none);
        input.addEventListener('input', () => {
            const q = foldSearch2(input.value.trim());
            let shown = 0;
            for (const it of list.querySelectorAll<HTMLElement>('.bottom-sheet-item')) {
                const hit = !q || (it.dataset.find ?? '').includes(q);
                it.hidden = !hit;
                if (hit) shown++;
            }
            for (const el of list.querySelectorAll<HTMLElement>('.bottom-sheet-section, .bottom-sheet-divider')) {
                let n = el.nextElementSibling as HTMLElement | null;
                while (n && !n.classList.contains('bottom-sheet-item')) n = n.nextElementSibling as HTMLElement | null;
                el.hidden = !n || n.hidden;
            }
            none.hidden = shown > 0;
        });
    },

    /** Close the builder's open menu (true: one was open). */
    closeRuleMenu(): boolean {
        if (closePersonPick) { closePersonPick(); return true; }
        if (!menuClose) return false;
        const f = menuClose;
        menuClose = null;
        menuAnchor = null;
        f();
        return true;
    },
});
