/**
 * Step 3 – Whom to add (spec 134 §5, frames 3, 5a–5d, 13h, 14c).
 *
 * The variants tick the new people (All new · Only linked within N steps ·
 * Ancestors of… · Descendants of… · Family / surname… · By hand), then each
 * person can be changed by hand. The list goes by family or by the tree's
 * person the people link through, each group with a checkbox for all of it;
 * a row says where the person links. Only the rows near the view are drawn
 * (§13h). Unticking a person (or a group) others link to the tree through
 * asks what happens to them (5a), and the toast can undo it (5b). The
 * branch preview shows a group in the import with its new people dashed.
 *
 * The step keeps no state of the merge: the ticks go into the choices
 * (`leftOut`, `leftOutReason`, `placeholders`, `skipLiving`, `variant`), the
 * counts come from the plan. What the view shows (tab, filters, grouping,
 * open groups, the preview) is the view's, kept per merge state; a redraw
 * of the same step updates the view in place and keeps its scroll.
 */

import { strings } from '../../strings.js';
import type { MergeState } from '../types.js';
import type { PersonId } from '../../types.js';
import type { SelectVariant, WizardChoices } from '../plan.js';
import {
    connectedNew, connectionTerm, dependentsVia, displayName, leftOutFor, livingNew, newPersons, selectionOf, unlinkedGroups,
    variantSelection, type GroupDecision, type Generations, type NewConnection, type Selection, type UnlinkedGroup,
} from '../plan-select.js';
import { existingTargetOf } from '../executor.js';
import type { StepContext } from './context.js';
import { escapeHtml, stepHeading } from './context.js';
import { VirtualList } from '../virtual-list.js';
import {
    NO_FILTERS, fold, groupPeople, hasFilters, linkingPeople, listRows, matchesFilters, relationText, rodsOf, selectionCounts,
    step3People, triState, yearsText, type S3Filters, type S3Group, type S3GroupBy, type S3Person, type S3Row,
} from './step3-model.js';
import { renderTreeThumbnail } from '../../tree-preview.js';
import { getUI } from '../../ui-ref.js';
import { yearOf } from '../../dates.js';

type FilterPanel = 'surname' | 'years' | 'place';

/** Above this many new people the groups start closed (§13h). */
const OPEN_UP_TO = 200;

/** Below this width the branch preview is behind a button, as a sheet. */
const PREVIEW_SIDE_FROM = 1100;

interface Base {
    people: S3Person[];
    index: Map<PersonId, S3Person>;
    /** With tabs (adding to a tree): the list is "Linked new". */
    tabs: boolean;
}

interface View {
    root: HTMLElement | null;
    ctx: StepContext;
    base: Base | null;
    tab: 'linked' | 'groups';
    filters: S3Filters;
    panel: FilterPanel | null;
    groupBy: S3GroupBy;
    /** Groups opened or closed against their default. */
    toggled: Set<string>;
    list: VirtualList | null;
    rows: S3Row[];
    shown: S3Person[];
    groups: S3Group[];
    sel: Selection;
    preview: string | null;
    previewDrawn: string;
    terms: Map<PersonId, string>;
}

const views = new WeakMap<MergeState, View>();
/** The view of the step drawn last (for Esc from the guide). */
let current: View | null = null;

function viewOf(ctx: StepContext): View {
    let v = views.get(ctx.state);
    if (!v) {
        v = {
            root: null, ctx, base: null, tab: 'linked', filters: { ...NO_FILTERS }, panel: null, groupBy: 'rod', toggled: new Set(),
            list: null, rows: [], shown: [], groups: [], sel: { ticked: new Set(), standIns: new Set() },
            preview: null, previewDrawn: '', terms: new Map(),
        };
        views.set(ctx.state, v);
    }
    v.ctx = ctx;
    current = v;
    return v;
}

// ==================== CHOICES ====================

/** The person's name as the import has it, '?' for none. */
function nameOf(state: MergeState, id: PersonId): string {
    return displayName(state.incomingData.persons[id]) || '?';
}

/** The sub-line of step 3 in the step list: the variant that ticked last. */
export function variantSub(state: MergeState | null, choices: WizardChoices): string {
    const W = strings.mergeWizard;
    const v = choices.variant;
    const name = (id: PersonId): string => (state ? nameOf(state, id) : '?');
    switch (v?.kind) {
        case undefined: case 'all': return W.subAllNew;
        case 'linked': return W.subLinked(v.steps);
        case 'ancestors': return W.subAnc(name(v.person));
        case 'descendants': return W.subDesc(name(v.person));
        case 'rod': return W.subRod(v.surname);
        case 'manual': return W.subManual;
    }
}

/** Tick what a variant ticks (the others unticked; "?" and branches undone). */
export function applyVariant(ctx: StepContext, v: SelectVariant): void {
    const ticked = variantSelection(ctx.state, ctx.choices, v);
    ctx.update({ variant: v, leftOut: leftOutFor(ctx.state, ctx.choices, ticked), leftOutReason: {}, placeholders: [] });
}

interface Snapshot {
    leftOut: readonly PersonId[];
    leftOutReason: Readonly<Record<string, 'branch'>>;
    placeholders: readonly PersonId[];
    groups: WizardChoices['groups'];
}

function snapshot(c: WizardChoices): Snapshot {
    return { leftOut: [...(c.leftOut ?? [])], leftOutReason: { ...(c.leftOutReason ?? {}) }, placeholders: [...(c.placeholders ?? [])], groups: c.groups };
}

/** Tick people again (out of the left out and the "?"). */
function tick(view: View, ids: readonly PersonId[]): void {
    const c = view.ctx.choices;
    const on = new Set(ids);
    const reason = { ...(c.leftOutReason ?? {}) };
    for (const id of ids) delete reason[id];
    view.ctx.update({
        leftOut: (c.leftOut ?? []).filter(id => !on.has(id)),
        leftOutReason: reason,
        placeholders: (c.placeholders ?? []).filter(id => !on.has(id)),
    });
}

/** Leave people out; `branch`: those who go with them. */
function leaveOut(view: View, ids: readonly PersonId[], branch: readonly PersonId[] = [], extra: Partial<WizardChoices> = {}): void {
    const c = view.ctx.choices;
    const out = new Set(c.leftOut ?? []);
    const reason = { ...(c.leftOutReason ?? {}) };
    for (const id of ids) { out.add(id); delete reason[id]; }
    for (const id of branch) { out.add(id); reason[id] = 'branch'; }
    const gone = new Set([...ids, ...branch]);
    view.ctx.update({ leftOut: [...out], leftOutReason: reason, placeholders: (c.placeholders ?? []).filter(id => !gone.has(id)), ...extra });
}

/** The toast after leaving people out (5b), with Undo. */
function leftOutToast(view: View, n: number, what: string, before: Snapshot): void {
    const W = strings.mergeWizard;
    getUI().showToast(W.leftOut(n, what), 8000, {
        kind: 'merge-guide',
        action: { label: W.undo, run: () => view.ctx.update({ ...before }) },
        clearOf: '#merge-modal .merge-actions',
    });
}

/**
 * Untick people (a person or a group's ticked ones). When others lose
 * their only way to the tree, ask first (5a); else they are left out at once.
 */
function untick(view: View, ids: readonly PersonId[], what: string, single: PersonId | null): void {
    const { state, choices } = view.ctx;
    const sel = selectionOf(state, choices);
    const off = ids.filter(id => sel.ticked.has(id) || sel.standIns.has(id));
    if (!off.length) return;
    const deps = choices.mode === 'add' ? dependentsVia(state, choices, off, sel) : [];
    if (!deps.length) {
        const before = snapshot(choices);
        leaveOut(view, off);
        if (off.length > 1) leftOutToast(view, off.length, what, before);
        return;
    }
    openUnlink(view, off, deps, what, single);
}

// ==================== RENDER ====================

export function renderStep3(host: HTMLElement, ctx: StepContext): void {
    const view = viewOf(ctx);
    if (!view.root || !host.contains(view.root)) build(host, view);
    update(view);
}

/** Close what step 3 opened above the guide (a dialog, the preview sheet); true when something was open. */
export function closeStep3Overlay(): boolean {
    const open = document.querySelector<HTMLElement>('.merge-s3-dialog.active');
    if (open) { closeDialog(open); return true; }
    const root = current?.root;
    if (root?.isConnected && root.classList.contains('is-sheet')) {
        setSheet(root, false);
        return true;
    }
    return false;
}

function setSheet(root: HTMLElement, on: boolean): void {
    root.classList.toggle('is-sheet', on);
    root.querySelector<HTMLElement>(on ? '.merge-s3-preview-close' : '.merge-s3-preview-open')?.focus();
}

function computeBase(ctx: StepContext): Base {
    const { state, choices } = ctx;
    const fresh = newPersons(state, choices);
    const tabs = choices.mode === 'add';
    const conns = tabs ? connectedNew(state, choices) : new Map<PersonId, NewConnection>();
    const listed = tabs ? fresh.filter(id => conns.has(id)) : fresh;
    const living = new Set(livingNew(state, choices));
    const people = step3People(state.incomingData, listed, living, conns, linkingPeople(conns));
    return { people, index: new Map(people.map(p => [p.id, p])), tabs };
}

function chip(attrs: string, label: string, caret = false): string {
    return `<button type="button" class="sel-opt merge-s3-chip" data-sel-form="chip" aria-pressed="false" ${attrs}><span class="merge-s3-chip-l">${escapeHtml(label)}</span>${caret ? '<span class="merge-s3-caret-d" aria-hidden="true">▾</span>' : ''}</button>`;
}

function build(host: HTMLElement, view: View): void {
    const W = strings.mergeWizard;
    view.list?.destroy();
    view.list = null;
    view.base = computeBase(view.ctx);
    view.previewDrawn = '';
    view.terms.clear();
    const v = view.ctx.choices.variant;
    const steps = v?.kind === 'linked' ? v.steps : 2;
    const stepOpts = [1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === steps ? ' selected' : ''}>${n}</option>`).join('');
    const tabs = view.base.tabs;
    host.innerHTML = `${stepHeading(3)}
<div class="merge-s3" data-tab="${view.tab}">
  <div class="merge-s3-variants" role="group" aria-label="${escapeHtml(W.variants)}">
    ${chip('data-v="all"', W.vAll)}
    <span class="merge-s3-linked">${chip('data-v="linked"', W.vLinked(steps))}<select class="merge-s3-steps" aria-label="${escapeHtml(W.linkedSteps)}">${stepOpts}</select></span>
    ${chip('data-v="ancestors" aria-haspopup="dialog"', W.vAnc)}
    ${chip('data-v="descendants" aria-haspopup="dialog"', W.vDesc)}
    ${chip('data-v="rod" aria-haspopup="dialog"', W.vRod)}
    ${chip('data-v="manual"', W.vManual)}
  </div>
  ${tabs ? `<div class="merge-s3-tabs" role="tablist">
    <button type="button" class="merge-tab sel-tab" role="tab" data-sel-dir="down" data-tab="linked" id="merge-s3-tab-linked" aria-controls="merge-s3-linked"><span class="merge-tab-label">${escapeHtml(W.tabLinked)}</span> <span class="cnt"></span></button>
    <button type="button" class="merge-tab sel-tab" role="tab" data-sel-dir="down" data-tab="groups" id="merge-s3-tab-groups" aria-controls="merge-s3-groups"><span class="merge-tab-label">${escapeHtml(W.tabGroups)}</span> <span class="cnt"></span> <span class="merge-s3-undecided" hidden></span></button>
  </div>` : ''}
  <div class="merge-s3-panel" id="merge-s3-linked"${tabs ? ' role="tabpanel" aria-labelledby="merge-s3-tab-linked"' : ''}>
    <div class="merge-s3-tools">
      <input type="search" class="merge-s3-search" placeholder="${escapeHtml(W.s3Search)}" aria-label="${escapeHtml(W.s3Search)}" autocomplete="off" spellcheck="false">
      <div class="merge-s3-filters">
        ${chip('data-f="surname" aria-expanded="false"', W.fSurname, true)}
        ${chip('data-f="years" aria-expanded="false"', W.fYears, true)}
        ${chip('data-f="place" aria-expanded="false"', W.fPlace, true)}
        ${chip('data-t="withSource"', W.fSource)}
        ${tabs ? chip('data-t="linking"', W.fLinking) : ''}
        ${chip('data-t="living"', W.fLiving)}
      </div>
      <div class="merge-s3-fpanel" hidden data-kind=""></div>
      <div class="merge-s3-bar">
        ${tabs ? `<div class="merge-s3-groupby"><span class="merge-s3-groupby-l" id="merge-s3-groupby-l">${escapeHtml(W.groupBy)}</span>
        <div class="sel-seg" role="radiogroup" aria-labelledby="merge-s3-groupby-l">
          <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-by="rod">${escapeHtml(W.byRod)}</button>
          <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-by="via">${escapeHtml(W.byPlace)}</button>
        </div></div>` : ''}
        <label class="merge-s3-living"><input type="checkbox" class="merge-s3-living-cb"> <span></span></label>
        <span class="merge-s3-count" aria-live="polite"></span>
        <span class="merge-s3-all">
          <button type="button" class="link-button" data-act="all">${escapeHtml(W.selectAll)}</button>
          <button type="button" class="link-button" data-act="none">${escapeHtml(W.selectNone)}</button>
        </span>
        <button type="button" class="secondary merge-s3-preview-open">${escapeHtml(W.previewBtn)}</button>
      </div>
    </div>
    <div class="merge-s3-main">
      <div class="merge-s3-scroll">
        <ul class="merge-s3-list" role="listbox" aria-multiselectable="true" aria-label="${escapeHtml(W.s3List)}"></ul>
        <p class="merge-s3-empty" hidden></p>
      </div>
      <aside class="merge-s3-preview" aria-labelledby="merge-s3-preview-t">
        <div class="merge-s3-preview-head"><h4 id="merge-s3-preview-t" class="merge-s3-preview-t"></h4>
          <button type="button" class="close-btn merge-s3-preview-close" aria-label="${escapeHtml(strings.buttons.close)}">&times;</button></div>
        <div class="merge-s3-thumb"></div>
        <p class="merge-s3-preview-cap">${escapeHtml(W.previewCaption)}</p>
      </aside>
    </div>
  </div>
  ${tabs ? '<div class="merge-s3-panel merge-s3-groups" id="merge-s3-groups" role="tabpanel" aria-labelledby="merge-s3-tab-groups" hidden></div>' : ''}
</div>`;
    const root = host.querySelector<HTMLElement>('.merge-s3')!;
    view.root = root;
    const scroller = root.querySelector<HTMLElement>('.merge-s3-scroll')!;
    const list = root.querySelector<HTMLElement>('.merge-s3-list')!;
    view.list = new VirtualList(scroller, list, () => rowHeight(list), i => rowHtml(view, i), () => afterDraw(view));
    wire(root, view);
}

/** The rows' height from the stylesheet (taller on a phone, where a row has two lines). */
function rowHeight(list: HTMLElement): number {
    const h = parseFloat(getComputedStyle(list).getPropertyValue('--s3-row'));
    return Number.isFinite(h) && h > 0 ? h : 32;
}

function isOpen(view: View, key: string): boolean {
    if (hasFilters(view.filters)) return true;
    const byDefault = (view.base?.people.length ?? 0) <= OPEN_UP_TO;
    return byDefault !== view.toggled.has(key);
}

/** Everything that follows the choices and the view, drawn into the built step. */
function update(view: View): void {
    const root = view.root!;
    const W = strings.mergeWizard;
    const { state, choices, plan } = view.ctx;
    const base = view.base!;
    view.sel = selectionOf(state, choices);
    root.dataset.tab = view.tab;

    // Variants: the one that ticked last.
    const kind = choices.variant?.kind ?? 'all';
    root.querySelectorAll<HTMLButtonElement>('.merge-s3-variants [data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === kind)));

    // Tabs, the unlinked groups (§6 draws them in full).
    if (base.tabs) {
        const groups = unlinkedGroups(state, choices, view.sel);
        root.querySelectorAll<HTMLButtonElement>('.merge-s3-tabs [role="tab"]').forEach(b => {
            const on = b.dataset.tab === view.tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        root.querySelector('#merge-s3-tab-linked .cnt')!.textContent = base.people.length.toLocaleString();
        const inGroups = groups.reduce((n, g) => n + g.persons.length, 0);
        root.querySelector('#merge-s3-tab-groups .cnt')!.textContent = inGroups.toLocaleString();
        const undecided = choices.groups ? groups.filter(g => !choices.groups![g.key]).length : 0;
        const und = root.querySelector<HTMLElement>('.merge-s3-undecided')!;
        und.textContent = undecided ? W.groupsUndecided(undecided) : '';
        und.hidden = !undecided;
        root.querySelector<HTMLElement>('#merge-s3-linked')!.hidden = view.tab !== 'linked';
        const gp = root.querySelector<HTMLElement>('#merge-s3-groups')!;
        gp.hidden = view.tab !== 'groups';
        gp.innerHTML = `<p class="merge-step-note">${escapeHtml(W.groupsNote)}</p>`
            + (groups.length ? `<ul class="merge-s3-glist">${groups.map(g => groupRowHtml(g, choices.groups?.[g.key])).join('')}</ul>` : '');
        root.querySelectorAll<HTMLButtonElement>('.merge-s3-groupby [data-by]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.by === view.groupBy)));
    }

    // Filters.
    const f = view.filters;
    const fOn: Record<string, boolean> = {
        surname: !!f.surname, years: f.yearFrom !== null || f.yearTo !== null, place: !!f.place.trim(),
        withSource: f.withSource, linking: f.linking, living: f.living,
    };
    root.querySelectorAll<HTMLButtonElement>('.merge-s3-filters [data-f], .merge-s3-filters [data-t]').forEach(b => {
        const k = b.dataset.f ?? b.dataset.t!;
        b.setAttribute('aria-pressed', String(fOn[k] || view.panel === k));
        if (b.dataset.f) b.setAttribute('aria-expanded', String(view.panel === k));
    });
    drawPanel(view);

    // Leave out the living, the count.
    const living = livingNew(state, choices).length;
    root.querySelector<HTMLInputElement>('.merge-s3-living-cb')!.checked = !!choices.skipLiving;
    root.querySelector('.merge-s3-living span')!.textContent = W.skipLiving(living);
    root.querySelector<HTMLElement>('.merge-s3-living')!.hidden = living === 0;
    if (plan) {
        const c = selectionCounts(plan);
        root.querySelector('.merge-s3-count')!.textContent = W.selected(c.selected, c.of);
    }

    // The list.
    view.shown = base.people.filter(p => matchesFilters(p, f));
    view.groups = groupPeople(view.shown, view.groupBy, state.existingData, state.incomingData);
    view.rows = listRows(view.groups, key => isOpen(view, key));
    const empty = root.querySelector<HTMLElement>('.merge-s3-empty')!;
    empty.hidden = view.rows.length > 0;
    empty.textContent = base.people.length ? W.s3Empty : W.s3NoNew;
    view.list!.refresh(view.rows.length, i => rowHtml(view, i));
    drawPreview(view);
}

/**
 * A row of the unlinked groups' tab. Until the tab is drawn in full (§6:
 * link to a person, a separate tree), a group can be added unlinked or left
 * out, so a group sent there from the list never holds the guide up.
 */
function groupRowHtml(g: UnlinkedGroup, d: GroupDecision | undefined): string {
    const W = strings.mergeWizard;
    const key = escapeHtml(g.key);
    const opt = (kind: 'loose' | 'skip', label: string): string =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-gkey="${key}" data-decide="${kind}" aria-checked="${d?.kind === kind}">${escapeHtml(label)}</button>`;
    return `<li class="merge-s3-grow" data-gkey="${key}"><span class="merge-s3-gname">${escapeHtml(g.title)}</span> <span class="tag merge-s3-gcount">${g.persons.length.toLocaleString()}</span>`
        + `${g.years ? ` <span class="merge-s3-years">${g.years.from}–${g.years.to}</span>` : ''}`
        + `<div class="sel-seg merge-s3-gdecide" role="radiogroup" aria-label="${escapeHtml(W.gDecision(g.title))}">${opt('loose', W.gLoose)}${opt('skip', W.gSkip)}</div></li>`;
}

function rowHtml(view: View, i: number): string {
    const row = view.rows[i];
    if (!row) return '';
    const W = strings.mergeWizard;
    const { sel } = view;
    const skipLiving = !!view.ctx.choices.skipLiving;
    if (row.kind === 'group') {
        const g = row.group;
        const t = triState(g.ids, sel.ticked);
        const key = escapeHtml(g.key);
        const via = g.via ? displayName(view.ctx.state.existingData.persons[g.via]) : '';
        const note = g.surnames ? W.s3Various : view.groupBy === 'rod' && via ? W.linksVia(via) : '';
        return `<li class="merge-s3-gh${row.open ? ' is-open' : ''}" role="option" aria-selected="${t === 'all'}" data-group="${key}">`
            + `<button type="button" class="merge-s3-caret" aria-expanded="${row.open}" aria-label="${escapeHtml(W.s3Expand(g.title))}" data-vkey="c:${key}"><span aria-hidden="true">▸</span></button>`
            + `<label class="merge-s3-check"><input type="checkbox" data-vkey="g:${key}" data-group="${key}"${t === 'all' ? ' checked' : ''}${t === 'some' ? ' data-mixed="1"' : ''}>`
            + `<span class="merge-s3-gname">${escapeHtml(g.title)}</span></label>`
            + `<span class="tag merge-s3-gcount">${g.ids.length.toLocaleString()}</span>`
            + `<span class="merge-s3-gvia">${escapeHtml(note)}</span>`
            + `<button type="button" class="link-button merge-s3-gprev" data-prev="${key}" data-vkey="v:${key}">${escapeHtml(W.branchPreview)}</button>`
            + '</li>';
    }
    const p = view.base!.index.get(row.id)!;
    const on = sel.ticked.has(p.id);
    const disabled = skipLiving && p.living;
    const id = escapeHtml(p.id);
    return `<li class="merge-s3-row${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}" role="option" aria-selected="${on}" data-id="${id}">`
        + `<label class="merge-s3-check"><input type="checkbox" data-vkey="p:${id}" data-id="${id}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>`
        + `<span class="merge-s3-name">${escapeHtml(p.name)}</span></label>`
        + `<span class="merge-s3-years">${escapeHtml(yearsText(p))}</span>`
        + (p.living ? `<span class="tag merge-s3-living-tag">${escapeHtml(W.livingTag)}</span>` : '')
        + `<span class="merge-s3-rel">${escapeHtml(relationOf(view, p))}</span>`
        + '</li>';
}

function relationOf(view: View, p: S3Person): string {
    if (!p.conn) return '';
    let t = view.terms.get(p.id);
    if (t === undefined) {
        t = relationText(view.ctx.state.incomingData, p.conn, connectionTerm(view.ctx.state, p.id, p.conn));
        view.terms.set(p.id, t);
    }
    return t;
}

function afterDraw(view: View): void {
    view.root?.querySelectorAll<HTMLInputElement>('.merge-s3-list input[data-mixed]').forEach(cb => { cb.indeterminate = true; });
}

/** The filter's own part under the chips (surname list, years, place). */
function drawPanel(view: View): void {
    const W = strings.mergeWizard;
    const panel = view.root!.querySelector<HTMLElement>('.merge-s3-fpanel')!;
    const kind = view.panel;
    if (panel.dataset.kind === (kind ?? '')) return;
    panel.dataset.kind = kind ?? '';
    panel.hidden = !kind;
    const f = view.filters;
    const off = `<button type="button" class="link-button" data-off="${kind}">${escapeHtml(W.fOff)}</button>`;
    if (kind === 'surname') {
        const opts = rodsOf(view.base!.people).map(r => `<option value="${escapeHtml(r.key)}"${r.key === f.surname ? ' selected' : ''}>${escapeHtml(r.name || W.s3NoSurname)} (${r.count.toLocaleString()})</option>`).join('');
        panel.innerHTML = `<select class="merge-s3-fsurname" aria-label="${escapeHtml(W.fSurname)}"><option value="">${escapeHtml(W.fAny)}</option>${opts}</select>${off}`;
    } else if (kind === 'years') {
        panel.innerHTML = `<label>${escapeHtml(W.fFrom)} <input type="number" inputmode="numeric" class="merge-s3-ffrom" value="${f.yearFrom ?? ''}" aria-label="${escapeHtml(`${W.fYears} ${W.fFrom}`)}"></label>`
            + `<label>${escapeHtml(W.fTo)} <input type="number" inputmode="numeric" class="merge-s3-fto" value="${f.yearTo ?? ''}" aria-label="${escapeHtml(`${W.fYears} ${W.fTo}`)}"></label>${off}`;
    } else if (kind === 'place') {
        panel.innerHTML = `<input type="search" class="merge-s3-fplace" value="${escapeHtml(f.place)}" aria-label="${escapeHtml(W.fPlace)}" placeholder="${escapeHtml(W.fPlace)}">${off}`;
    } else panel.innerHTML = '';
}

/** The branch preview: the chosen group (or the first one) in the import, its new people dashed, the others faded. */
function drawPreview(view: View): void {
    const root = view.root!;
    const W = strings.mergeWizard;
    const box = root.querySelector<HTMLElement>('.merge-s3-thumb')!;
    const title = root.querySelector<HTMLElement>('.merge-s3-preview-t')!;
    const g = view.groups.find(x => x.key === view.preview) ?? view.groups[0];
    // Only the ticked are dashed: a branch left out goes faded with the others.
    const hits = g ? g.ids.filter(id => view.sel.ticked.has(id)) : [];
    const key = g ? `${g.key}|${g.ids.length}|${hits.length}|${g.viaSource ?? ''}` : '';
    if (key === view.previewDrawn) return;
    view.previewDrawn = key;
    if (!g) {
        title.textContent = W.branchPreview;
        box.innerHTML = `<p class="merge-s3-preview-none">${escapeHtml(W.previewNone)}</p>`;
        return;
    }
    title.textContent = g.title;
    try {
        renderTreeThumbnail(box, {
            data: view.ctx.state.incomingData, focusPersonId: g.viaSource ?? g.ids[0], depthUp: 3, depthDown: 3, labels: true, hits: new Set(hits),
        });
    } catch {
        box.innerHTML = `<p class="merge-s3-preview-none">${escapeHtml(W.previewNone)}</p>`;
    }
}

// ==================== EVENTS ====================

function wire(root: HTMLElement, view: View): void {
    const W = strings.mergeWizard;
    const stepsSel = root.querySelector<HTMLSelectElement>('.merge-s3-steps')!;
    const linkedSteps = (): 1 | 2 | 3 | 4 | 5 => Number(stepsSel.value) as 1 | 2 | 3 | 4 | 5;
    root.querySelector('.merge-s3-variants')!.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
        if (!b) return;
        switch (b.dataset.v) {
            case 'all': applyVariant(view.ctx, { kind: 'all' }); break;
            case 'manual': applyVariant(view.ctx, { kind: 'manual' }); break;
            case 'linked': applyVariant(view.ctx, { kind: 'linked', steps: linkedSteps() }); break;
            case 'ancestors': case 'descendants': case 'rod': openPick(view, b.dataset.v, b); break;
        }
    });
    stepsSel.addEventListener('change', () => {
        root.querySelector<HTMLElement>('[data-v="linked"] .merge-s3-chip-l')!.textContent = W.vLinked(linkedSteps());
        applyVariant(view.ctx, { kind: 'linked', steps: linkedSteps() });
    });
    root.querySelector('#merge-s3-groups')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-decide]');
        if (!b) return;
        const d: GroupDecision = b.dataset.decide === 'skip' ? { kind: 'skip' } : { kind: 'loose' };
        view.ctx.update({ groups: { ...(view.ctx.choices.groups ?? {}), [b.dataset.gkey!]: d } });
        root.querySelector<HTMLElement>(`#merge-s3-groups [data-gkey="${CSS.escape(b.dataset.gkey!)}"][data-decide="${d.kind}"]`)?.focus();
    });
    const tabs = root.querySelector<HTMLElement>('.merge-s3-tabs');
    tabs?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
        if (!b) return;
        view.tab = b.dataset.tab as View['tab'];
        update(view);
    });
    tabs?.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        view.tab = view.tab === 'linked' ? 'groups' : 'linked';
        update(view);
        root.querySelector<HTMLElement>(`.merge-s3-tabs [data-tab="${view.tab}"]`)?.focus();
    });
    const search = root.querySelector<HTMLInputElement>('.merge-s3-search')!;
    search.addEventListener('input', () => { view.filters.query = search.value; update(view); });
    root.querySelector('.merge-s3-filters')!.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-f], [data-t]');
        if (!b) return;
        if (b.dataset.f) view.panel = view.panel === b.dataset.f ? null : b.dataset.f as FilterPanel;
        else {
            const k = b.dataset.t as 'withSource' | 'linking' | 'living';
            view.filters[k] = !view.filters[k];
        }
        update(view);
        if (b.dataset.f && view.panel) root.querySelector<HTMLElement>('.merge-s3-fpanel select, .merge-s3-fpanel input')?.focus();
    });
    const panel = root.querySelector<HTMLElement>('.merge-s3-fpanel')!;
    const onPanel = (e: Event): void => {
        const t = e.target as HTMLInputElement;
        const num = (v: string): number | null => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
        if (t.classList.contains('merge-s3-ffrom')) view.filters.yearFrom = num(t.value);
        else if (t.classList.contains('merge-s3-fto')) view.filters.yearTo = num(t.value);
        else if (t.classList.contains('merge-s3-fplace')) view.filters.place = t.value;
        else if (t.classList.contains('merge-s3-fsurname')) view.filters.surname = t.value;
        else return;
        update(view);
    };
    panel.addEventListener('input', onPanel);
    panel.addEventListener('change', onPanel);
    panel.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-off]');
        if (!b) return;
        const k = b.dataset.off;
        if (k === 'surname') view.filters.surname = '';
        if (k === 'years') { view.filters.yearFrom = null; view.filters.yearTo = null; }
        if (k === 'place') view.filters.place = '';
        view.panel = null;
        update(view);
        root.querySelector<HTMLElement>(`.merge-s3-filters [data-f="${k}"]`)?.focus();
    });
    root.querySelector('.merge-s3-groupby')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-by]');
        if (!b) return;
        view.groupBy = b.dataset.by as S3GroupBy;
        view.toggled.clear();
        view.preview = null;
        update(view);
    });
    root.querySelector<HTMLInputElement>('.merge-s3-living-cb')!.addEventListener('change', e => {
        view.ctx.update({ skipLiving: (e.target as HTMLInputElement).checked });
    });
    root.querySelector('.merge-s3-all')!.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
        if (!b) return;
        const ids = view.shown.map(p => p.id);
        if (b.dataset.act === 'all') tick(view, ids);
        else leaveOut(view, ids.filter(id => view.sel.ticked.has(id) || view.sel.standIns.has(id)));
    });
    root.querySelector('.merge-s3-preview-open')!.addEventListener('click', () => setSheet(root, true));
    root.querySelector('.merge-s3-preview-close')!.addEventListener('click', () => setSheet(root, false));
    const list = root.querySelector<HTMLElement>('.merge-s3-list')!;
    list.addEventListener('change', e => {
        const cb = e.target as HTMLInputElement;
        if (cb.type !== 'checkbox') return;
        if (cb.dataset.id) {
            const id = cb.dataset.id as PersonId;
            if (cb.checked) { tick(view, [id]); return; }
            cb.checked = true;
            untick(view, [id], view.base!.index.get(id)?.name ?? nameOf(view.ctx.state, id), id);
        } else if (cb.dataset.group) {
            const g = view.groups.find(x => x.key === cb.dataset.group);
            if (!g) return;
            if (cb.checked) {
                const skipLiving = !!view.ctx.choices.skipLiving;
                tick(view, skipLiving ? g.ids.filter(id => !view.base!.index.get(id)?.living) : g.ids);
                return;
            }
            cb.checked = true;
            untick(view, g.ids, g.title, null);
        }
    });
    list.addEventListener('click', e => {
        const t = e.target as HTMLElement;
        const caret = t.closest<HTMLElement>('.merge-s3-caret');
        if (caret) {
            const key = caret.closest<HTMLElement>('[data-group]')!.dataset.group!;
            if (view.toggled.has(key)) view.toggled.delete(key); else view.toggled.add(key);
            update(view);
            return;
        }
        const prev = t.closest<HTMLElement>('[data-prev]');
        if (prev) {
            view.preview = prev.dataset.prev!;
            drawPreview(view);
            if (window.innerWidth < PREVIEW_SIDE_FROM) setSheet(root, true);
        }
    });
}

// ==================== DIALOGS ====================

let returnFocus: HTMLElement | null = null;

function openDialog(id: string, html: string, labelled: string, kind: 'decision' | 'picker'): HTMLElement {
    document.getElementById(id)?.remove();
    returnFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay merge-s3-dialog';
    overlay.id = id;
    overlay.innerHTML = `<div class="modal modal--sm" role="dialog" aria-modal="true" aria-labelledby="${labelled}" data-dialog-kind="${kind}">${html}</div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(overlay); });
    document.body.appendChild(overlay);
    overlay.classList.add('active');
    return overlay;
}

function closeDialog(overlay: HTMLElement): void {
    overlay.classList.remove('active');
    overlay.remove();
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus();
    else document.querySelector<HTMLElement>('#merge-step-body .merge-s3-search')?.focus();
}

/** 5a: others link to the tree only through the unticked: leave them out too, keep them unlinked, keep, or keep as "?". */
function openUnlink(view: View, off: readonly PersonId[], deps: readonly PersonId[], what: string, single: PersonId | null): void {
    const W = strings.mergeWizard;
    const { state } = view.ctx;
    const names = deps.map(id => nameOf(state, id));
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` ${W.unlinkMore(names.length - 3)}` : '');
    const p = single ? state.incomingData.persons[single] : undefined;
    const years = p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
    const who = years ? `${what} (${years})` : what;
    type Choice = 'all' | 'loose' | 'keep' | 'q';
    const btnText: Record<Choice, string> = {
        all: W.unlinkBtn(off.length + deps.length), loose: W.unlinkBtn(off.length), keep: W.unlinkKeep(what), q: W.unlinkBtn(off.length),
    };
    const tile = (c: Choice, title: string, desc: string, checked = false): string =>
        `<label class="sel-opt merge-s3-tile" data-sel-form="tile"><input type="radio" name="merge-s3-unlink" value="${c}"${checked ? ' checked' : ''}>`
        + `<span class="merge-s3-tile-x"><span class="merge-s3-tile-t">${escapeHtml(title)}</span><span class="merge-s3-tile-d">${escapeHtml(desc)}</span></span></label>`;
    const html = `<div class="modal-header"><h2 id="merge-s3-unlink-t">${escapeHtml(W.unlinkTitle(what))}</h2></div>
<p class="merge-s3-unlink-text">${escapeHtml(W.unlinkText(who, deps.length, shown))}${names.length > 3 ? ` <button type="button" class="link-button merge-s3-show">${escapeHtml(W.showThem)}</button>` : ''}</p>
<ul class="merge-s3-unlink-names" hidden>${names.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
<div class="merge-s3-tiles" role="radiogroup" aria-labelledby="merge-s3-unlink-t">
${tile('all', W.unlinkAll, W.unlinkAllDesc(off.length + deps.length), true)}
${tile('loose', W.unlinkLoose, W.unlinkLooseDesc(deps.length))}
${tile('keep', W.unlinkKeep(what), W.unlinkKeepDesc)}
${single ? tile('q', W.unlinkQ, W.unlinkQDesc(what)) : ''}
</div>
<div class="buttons">
  <button type="button" class="secondary" data-dismiss>${escapeHtml(strings.buttons.cancel)}</button>
  <button type="button" class="primary merge-s3-unlink-go">${escapeHtml(btnText.all)}</button>
</div>`;
    const overlay = openDialog('merge-s3-unlink', html, 'merge-s3-unlink-t', 'decision');
    const go = overlay.querySelector<HTMLButtonElement>('.merge-s3-unlink-go')!;
    const choice = (): Choice => (overlay.querySelector<HTMLInputElement>('input[name="merge-s3-unlink"]:checked')?.value ?? 'all') as Choice;
    overlay.addEventListener('change', () => { go.textContent = btnText[choice()]; });
    overlay.querySelector('.merge-s3-show')?.addEventListener('click', e => {
        overlay.querySelector<HTMLElement>('.merge-s3-unlink-names')!.hidden = false;
        (e.target as HTMLElement).remove();
        go.focus();
    });
    overlay.querySelector('[data-dismiss]')!.addEventListener('click', () => closeDialog(overlay));
    go.addEventListener('click', () => {
        const c = choice();
        const ch = view.ctx.choices;
        const before = snapshot(ch);
        closeDialog(overlay);
        if (c === 'keep') return;
        if (c === 'all') {
            leaveOut(view, off, deps);
            leftOutToast(view, off.length + deps.length, what, before);
        } else if (c === 'loose') {
            // The unlinked groups are asked about from now on (§6).
            leaveOut(view, off, [], { groups: ch.groups ?? {} });
            leftOutToast(view, off.length, what, before);
        } else {
            const on = new Set(off);
            view.ctx.update({ placeholders: [...new Set([...(ch.placeholders ?? []), ...off])], leftOut: (ch.leftOut ?? []).filter(id => !on.has(id)) });
            leftOutToast(view, off.length, what, before);
        }
    });
    go.focus();
}

/** 5c: Ancestors of… · Descendants of… · Family / surname…: whom, how many generations, the result before it is applied. */
function openPick(view: View, kind: 'ancestors' | 'descendants' | 'rod', opener: HTMLElement): void {
    const W = strings.mergeWizard;
    const { state, choices } = view.ctx;
    const source = state.incomingData;
    const v = choices.variant;
    let person: PersonId | null = v && (v.kind === 'ancestors' || v.kind === 'descendants') ? v.person : null;
    let surname = v?.kind === 'rod' ? v.surname : '';
    let generations: Generations = v && (v.kind === 'ancestors' || v.kind === 'descendants') ? v.generations : 'all';
    const isRod = kind === 'rod';
    const title = isRod ? W.pickTitleRod : kind === 'ancestors' ? W.pickTitleAnc : W.pickTitleDesc;
    const fresh = new Set(newPersons(state, choices));
    const all = (Object.keys(source.persons) as PersonId[]).filter(id => !source.persons[id]?.isPlaceholder);
    const rods = rodsOf(step3People(source, [...fresh], new Set(), new Map(), new Set())).filter(r => r.name);
    const genSeg = isRod ? '' : `<div class="merge-s3-gen"><span id="merge-s3-gen-l">${escapeHtml(W.generations)}</span>
<div class="sel-seg" role="radiogroup" aria-labelledby="merge-s3-gen-l">${([2, 4, 'all'] as Generations[]).map(g =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-gen="${g}" aria-checked="${g === generations}">${g === 'all' ? escapeHtml(W.genAll) : g}</button>`).join('')}</div></div>`;
    const search = isRod ? W.pickSearchRod : W.pickSearch;
    const html = `<div class="modal-header"><h2 id="merge-s3-pick-t">${escapeHtml(title)}</h2>
  <button type="button" class="close-btn" data-dismiss aria-label="${escapeHtml(strings.buttons.close)}">&times;</button></div>
<input type="search" class="merge-s3-pick-q" placeholder="${escapeHtml(search)}" aria-label="${escapeHtml(search)}" autocomplete="off" spellcheck="false">
<ul class="merge-s3-pick-list" role="listbox" aria-labelledby="merge-s3-pick-t"></ul>
${genSeg}
<p class="merge-s3-pick-sentence" aria-live="polite"></p>
<div class="buttons">
  <button type="button" class="secondary" data-dismiss>${escapeHtml(strings.buttons.cancel)}</button>
  <button type="button" class="primary merge-s3-pick-go"></button>
</div>`;
    const overlay = openDialog('merge-s3-pick', html, 'merge-s3-pick-t', 'picker');
    returnFocus = opener;
    const q = overlay.querySelector<HTMLInputElement>('.merge-s3-pick-q')!;
    const listEl = overlay.querySelector<HTMLElement>('.merge-s3-pick-list')!;
    const sentence = overlay.querySelector<HTMLElement>('.merge-s3-pick-sentence')!;
    const go = overlay.querySelector<HTMLButtonElement>('.merge-s3-pick-go')!;
    const variant = (): SelectVariant | null => {
        if (isRod) return surname ? { kind: 'rod', surname } : null;
        if (!person) return null;
        return kind === 'ancestors' ? { kind, person, generations } : { kind: 'descendants', person, generations };
    };
    const drawList = (): void => {
        const want = fold(q.value.trim()).split(/\s+/).filter(Boolean);
        if (isRod) {
            const hits = rods.filter(r => want.every(w => fold(r.name).includes(w))).slice(0, 50);
            listEl.innerHTML = hits.map(r => `<li role="option" tabindex="-1" data-rod="${escapeHtml(r.name)}" aria-selected="${r.name === surname}">`
                + `<span class="merge-s3-name">${escapeHtml(r.name)}</span> <span class="tag">${r.count.toLocaleString()}</span></li>`).join('');
            return;
        }
        const hits: PersonId[] = [];
        for (const id of all) {
            const p = source.persons[id]!;
            const hay = fold(`${displayName(p)} ${yearOf(p.birthDate) ?? ''}`);
            if (want.every(w => hay.includes(w))) hits.push(id);
            if (hits.length >= 50) break;
        }
        if (person && !hits.includes(person)) hits.unshift(person);
        listEl.innerHTML = hits.map(id => {
            const p = source.persons[id]!;
            const born = yearOf(p.birthDate);
            const tree = fresh.has(id) ? undefined : existingTargetOf(state, id);
            const side = fresh.has(id) ? W.pickNew : tree ? W.pickJoined(displayName(state.existingData.persons[tree]) || '?') : '';
            return `<li role="option" tabindex="-1" data-pid="${escapeHtml(id)}" aria-selected="${id === person}"><span class="merge-s3-name">${escapeHtml(displayName(p) || '?')}</span>`
                + `${born !== null ? ` <span class="merge-s3-years">· ${born}</span>` : ''}${side ? ` <span class="merge-s3-pick-side">· ${escapeHtml(side)}</span>` : ''}</li>`;
        }).join('');
    };
    const drawResult = (): void => {
        const v = variant();
        if (!v) {
            sentence.textContent = W.pickNone;
            go.textContent = W.pickBtn(0);
            go.disabled = true;
            return;
        }
        const ticked = variantSelection(state, choices, v);
        const n = ticked.size;
        if (v.kind === 'rod') sentence.textContent = W.pickRod(n, v.surname);
        else if (v.kind === 'ancestors' || v.kind === 'descendants') {
            const others = ticked.has(v.person) ? n - 1 : n;
            const name = nameOf(state, v.person);
            sentence.textContent = v.kind === 'ancestors' ? W.pickAnc(others, name) : W.pickDesc(others, name);
        }
        go.textContent = W.pickBtn(n);
        go.disabled = false;
    };
    const choose = (li: HTMLElement): void => {
        if (li.dataset.pid) person = li.dataset.pid as PersonId;
        if (li.dataset.rod !== undefined) surname = li.dataset.rod;
        listEl.querySelectorAll('[role="option"]').forEach(o => o.setAttribute('aria-selected', String(o === li)));
        drawResult();
    };
    q.addEventListener('input', drawList);
    q.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); listEl.querySelector<HTMLElement>('[role="option"]')?.focus(); }
    });
    listEl.addEventListener('click', e => {
        const li = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
        if (li) choose(li);
    });
    listEl.addEventListener('keydown', e => {
        const li = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
        if (!li) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(li); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (li.nextElementSibling as HTMLElement | null)?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); ((li.previousElementSibling as HTMLElement | null) ?? q).focus(); }
    });
    overlay.querySelector('.merge-s3-gen')?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-gen]');
        if (!b) return;
        generations = (b.dataset.gen === 'all' ? 'all' : Number(b.dataset.gen)) as Generations;
        overlay.querySelectorAll('[data-gen]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        drawResult();
    });
    overlay.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => closeDialog(overlay)));
    go.addEventListener('click', () => {
        const v = variant();
        if (!v) return;
        closeDialog(overlay);
        applyVariant(view.ctx, v);
    });
    drawList();
    drawResult();
    q.focus();
}
