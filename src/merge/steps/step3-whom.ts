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
import type { PersonId, StromData } from '../../types.js';
import type { SelectVariant, WizardChoices } from '../plan.js';
import {
    connectRefusal, connectedNew, connectionTerm, dependentsVia, displayName, familyName, leftOutFor, livingNew, newPersons, selectionOf, unlinkedGroups,
    variantSelection, type GroupDecision, type Generations, type NewConnection, type NewRel, type Selection, type UnlinkedGroup,
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
    /** Unlinked groups ticked for a decision at once (§6). */
    gTicked: Set<string>;
    /** Decided groups whose choice is shown again (Change). */
    gChanging: Set<string>;
    /** Individuals unticked in their list here, shown unticked so they can be ticked again (6e). */
    singlesOff: PersonId[];
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
            preview: null, previewDrawn: '', terms: new Map(), gTicked: new Set(), gChanging: new Set(), singlesOff: [],
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
    leftOutReason: Readonly<Record<string, 'branch' | 'step5'>>;
    placeholders: readonly PersonId[];
    groups: WizardChoices['groups'];
}

function snapshot(c: WizardChoices): Snapshot {
    return { leftOut: [...(c.leftOut ?? [])], leftOutReason: { ...(c.leftOutReason ?? {}) }, placeholders: [...(c.placeholders ?? [])], groups: c.groups };
}

/** Tick people again (out of the left out and the "?"). */
function tick(view: Pick<View, 'ctx'>, ids: readonly PersonId[]): void {
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

/** Leave people out; `branch`: those who go with them; `why`: unticked in step 5 (else by hand in step 3). */
function leaveOut(view: Pick<View, 'ctx'>, ids: readonly PersonId[], branch: readonly PersonId[] = [], extra: Partial<WizardChoices> = {}, why?: 'step5'): void {
    const c = view.ctx.choices;
    const out = new Set(c.leftOut ?? []);
    const reason = { ...(c.leftOutReason ?? {}) };
    for (const id of ids) { out.add(id); if (why) reason[id] = why; else delete reason[id]; }
    for (const id of branch) { out.add(id); reason[id] = 'branch'; }
    const gone = new Set([...ids, ...branch]);
    view.ctx.update({ leftOut: [...out], leftOutReason: reason, placeholders: (c.placeholders ?? []).filter(id => !gone.has(id)), ...extra });
}

/** The toast after leaving people out (5b), with Undo. */
function leftOutToast(view: Pick<View, 'ctx'>, n: number, what: string, before: Snapshot): void {
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
function untick(view: Pick<View, 'ctx'>, ids: readonly PersonId[], what: string, single: PersonId | null, why?: 'step5'): void {
    const { state, choices } = view.ctx;
    const sel = selectionOf(state, choices);
    const off = ids.filter(id => sel.ticked.has(id) || sel.standIns.has(id));
    if (!off.length) return;
    const deps = choices.mode === 'add' ? dependentsVia(state, choices, off, sel) : [];
    if (!deps.length) {
        const before = snapshot(choices);
        leaveOut(view, off, [], {}, why);
        if (off.length > 1) leftOutToast(view, off.length, what, before);
        return;
    }
    openUnlink(view, off, deps, what, single, why);
}

/**
 * Untick new people from the list of step 5 (§8): out of the plan as
 * "unticked (step 5)"; when others link to the tree only through them, the
 * same question as in step 3 (K4.3).
 */
export function untickPeople(ctx: StepContext, ids: readonly PersonId[], what: string, single: PersonId | null): void {
    untick({ ctx }, ids, what, single, 'step5');
}

/** Tick people again from the list of step 5. */
export function tickPeople(ctx: StepContext, ids: readonly PersonId[]): void {
    tick({ ctx }, ids);
}

// ==================== RENDER ====================

export function renderStep3(host: HTMLElement, ctx: StepContext): void {
    const view = viewOf(ctx);
    if (!view.root || !host.contains(view.root) || view.base?.tabs !== (ctx.choices.mode === 'add')) build(host, view);
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
    // Nothing linked (6f): the unlinked groups' tab first.
    if (view.base.tabs && !view.base.people.length) view.tab = 'groups';
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

    // Tabs, the unlinked groups (§6): the tab only when there are some (6c).
    if (base.tabs) {
        const groups = unlinkedGroups(state, choices, view.sel);
        const tabGroups = root.querySelector<HTMLElement>('#merge-s3-tab-groups')!;
        tabGroups.hidden = groups.length === 0;
        if (!groups.length && view.tab === 'groups') { view.tab = 'linked'; root.dataset.tab = view.tab; }
        root.querySelectorAll<HTMLButtonElement>('.merge-s3-tabs [role="tab"]').forEach(b => {
            const on = b.dataset.tab === view.tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        root.querySelector('#merge-s3-tab-linked .cnt')!.textContent = base.people.length.toLocaleString();
        tabGroups.querySelector('.cnt')!.textContent = groups.length.toLocaleString();
        const undecided = (plan?.groups ?? []).filter(g => g.decision === null).length;
        const und = root.querySelector<HTMLElement>('.merge-s3-undecided')!;
        und.textContent = undecided ? W.groupsUndecided(undecided) : '';
        und.hidden = !undecided;
        root.querySelector<HTMLElement>('#merge-s3-linked')!.hidden = view.tab !== 'linked';
        const gp = root.querySelector<HTMLElement>('#merge-s3-groups')!;
        gp.hidden = view.tab !== 'groups';
        const keys = new Set(groups.map(g => g.key));
        for (const k of [...view.gTicked]) if (!keys.has(k)) view.gTicked.delete(k);
        gp.innerHTML = groupsHtml(view, groups);
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

// ==================== UNLINKED GROUPS (§6) ====================

type GroupKind = GroupDecision['kind'];
const DECISIONS: readonly GroupKind[] = ['connect', 'loose', 'own-tree', 'skip'];

function decisionLabel(k: GroupKind): string {
    const W = strings.mergeWizard;
    return k === 'connect' ? W.gConnect : k === 'loose' ? W.gLoose : k === 'own-tree' ? W.gOwn : W.gSkip;
}

function relLabel(rel: NewRel): string {
    const W = strings.mergeWizard;
    return rel === 'parent' ? W.relParent : rel === 'child' ? W.relChild : W.relPartner;
}

/** A person as "Name (1790–1855)", from the import or the tree. */
function personText(data: StromData, id: PersonId): string {
    const p = data.persons[id];
    const name = displayName(p) || '?';
    const years = p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
    return years ? `${name} (${years})` : name;
}

/** The surnames of a group's people (their family names, "?" left out). */
function rodCount(source: StromData, persons: readonly PersonId[]): number {
    const names = new Set<string>();
    for (const id of persons) {
        const n = familyName(source, source.persons[id]);
        if (n) names.add(fold(n));
    }
    return names.size;
}

/** The segment of a group's decisions (or of the ticked groups: `bulk`); the individuals have Add unlinked and Do not add only (6e). */
function decideSeg(label: string, kinds: readonly GroupKind[], checked: GroupKind | null, attrs: (k: GroupKind) => string): string {
    return `<div class="sel-seg merge-s3-gdecide" role="radiogroup" aria-label="${escapeHtml(label)}">${kinds.map(k =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" aria-checked="${k === checked}" ${attrs(k)}>${escapeHtml(decisionLabel(k))}</button>`).join('')}</div>`;
}

/** What a decided group becomes, in words. */
function decisionText(view: View, g: UnlinkedGroup, d: GroupDecision, ownTreeName: string): string {
    const W = strings.mergeWizard;
    const { state } = view.ctx;
    const n = g.persons.length;
    switch (d.kind) {
        case 'connect': {
            const to = d.in === 'tree' ? personText(state.existingData, d.to) : personText(state.incomingData, d.to);
            return W.gConnectDone(personText(state.incomingData, d.person), relLabel(d.rel), to);
        }
        case 'loose': return W.gLooseDone(n);
        case 'own-tree': return W.gOwnDone(ownTreeName);
        case 'skip': return W.gSkipDone(n);
    }
}

/** The unlinked groups' tab: the lead (or 6f's explanation), the decision for the ticked, a row per group. */
function groupsHtml(view: View, groups: readonly UnlinkedGroup[]): string {
    const W = strings.mergeWizard;
    const { state, choices, plan } = view.ctx;
    if (!groups.length) return '';
    const planned = new Map((plan?.groups ?? []).map(g => [g.key, g] as const));
    const nothingLinked = groups.every(g => g.key === 'all' || g.key.startsWith('all/'));
    const total = groups.reduce((n, g) => n + g.persons.length, 0);
    const head = nothingLinked
        ? `<div class="merge-s3-nolink"><h4 class="merge-s3-nolink-t">${escapeHtml(W.nothingLinkedTitle(choices.targetName))}</h4>
<p class="merge-s3-glead">${escapeHtml(W.nothingLinked(total))}</p>
<div class="merge-s3-nolink-btns"><button type="button" class="secondary" data-nl="connect" aria-haspopup="dialog">${escapeHtml(W.gConnect)}</button>`
            + `<button type="button" class="secondary" data-nl="new">${escapeHtml(W.modeNew)}</button>`
            + `<button type="button" class="secondary" data-nl="loose">${escapeHtml(W.gLoose)}</button></div></div>`
        : `<p class="merge-s3-glead">${escapeHtml(W.groupsLead(choices.targetName))}</p>`;
    const ticked = view.gTicked.size;
    const bulk = groups.length > 1
        ? `<div class="merge-s3-gbulk"><span class="merge-s3-gbulk-l">${escapeHtml(W.groupsTicked(ticked))}</span>${decideSeg(W.groupsTicked(ticked), DECISIONS, null,
            k => `data-bulk="${k}"${!ticked || (k === 'connect' && ticked !== 1) ? ' disabled' : ''}${k === 'connect' ? ' aria-haspopup="dialog"' : ''}`)}</div>`
        : '';
    const source = state.incomingData;
    const rows = groups.map(g => {
        const key = escapeHtml(g.key);
        const pg = planned.get(g.key);
        const given = choices.groups?.[g.key];
        const decision = pg ? pg.decision : null;
        const blocked = !!given && !decision;
        const singles = g.kind === 'singles';
        const meta = [g.years ? (g.years.from === g.years.to ? `${g.years.from}` : `${g.years.from}–${g.years.to}`) : '', g.places.join(', ')].filter(Boolean).join(' · ');
        const headRow = `<div class="merge-s3-ghead">`
            + `<label class="merge-s3-gcheck"><input type="checkbox" data-gtick="${key}"${view.gTicked.has(g.key) ? ' checked' : ''}>`
            + `<span class="merge-s3-gname" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</span></label>`
            + `<span class="merge-s3-gcount">${g.persons.length.toLocaleString()}</span>`
            + (decision ? '' : `<span class="merge-s3-gtag">${escapeHtml(W.undecided)}</span>`)
            + (meta ? `<span class="merge-s3-gmeta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>` : '')
            + `</div>`;
        let who: string;
        if (singles) {
            const off = view.singlesOff.filter(id => !view.sel.ticked.has(id) && !g.persons.includes(id));
            const li = (id: PersonId, on: boolean): string => {
                const p = source.persons[id];
                const years = p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
                const place = p ? (p.birthPlace || p.deathPlace || '') : '';
                return `<li><label class="merge-s3-gcheck"><input type="checkbox" data-single="${escapeHtml(id)}"${on ? ' checked' : ''}>`
                    + `<span class="merge-s3-name">${escapeHtml(displayName(p) || '?')}</span></label>`
                    + `${years ? `<span class="merge-s3-years">${escapeHtml(years)}</span>` : ''}<span class="merge-s3-gplace">${escapeHtml(place)}</span></li>`;
            };
            who = `<p class="merge-s3-gwho">${escapeHtml(W.singles(g.persons.length))}</p>`
                + `<ul class="merge-s3-gsingles" aria-label="${escapeHtml(g.title)}">${g.persons.map(id => li(id, true)).join('')}${off.map(id => li(id, false)).join('')}</ul>`;
        } else {
            const names = g.persons.slice(0, 3).map(id => displayName(source.persons[id]) || '?').join(', ');
            const more = g.persons.length > 3 ? ` ${W.groupAndMore(g.persons.length - 3)}` : '';
            const rods = rodCount(source, g.persons);
            const split = (g.kind === 'family' || g.kind === 'all') && rods >= 2 && g.persons.length >= 10;
            who = `<p class="merge-s3-gwho"><span class="merge-s3-gnames">${escapeHtml(names + more)}</span>`
                + `${split ? ` · <span class="merge-s3-grods">${escapeHtml(W.groupRods(rods))}</span>` : ''}`
                + ` · <button type="button" class="link-button merge-s3-gprev" data-gprev="${key}" aria-haspopup="dialog">${escapeHtml(W.previewBtn)}</button>`
                + `${split ? ` · <button type="button" class="link-button" data-gsplit="${key}">${escapeHtml(W.splitByRod)}</button>` : ''}</p>`;
        }
        const kinds: readonly GroupKind[] = singles ? ['loose', 'skip'] : DECISIONS;
        const doRow = decision && !view.gChanging.has(g.key)
            ? `<p class="merge-s3-gresult"><span>${escapeHtml(decisionText(view, g, decision, pg?.ownTreeName ?? ''))}</span> · `
                + `<button type="button" class="link-button" data-gchange="${key}">${escapeHtml(W.gChange)}</button></p>`
            : decideSeg(W.gDecision(g.title), kinds, given?.kind ?? null,
                k => `data-gkey="${key}" data-decide="${k}"${k === 'connect' ? ' aria-haspopup="dialog"' : ''}`)
                + (blocked ? `<p class="merge-s3-gblocked">${escapeHtml(W.gBlocked)}</p>` : '');
        return `<li class="merge-s3-grow${decision ? ' is-decided' : ''}" data-gkey="${key}">${headRow}${who}<div class="merge-s3-gdo">${doRow}</div></li>`;
    }).join('');
    return `${head}${bulk}<ul class="merge-s3-glist">${rows}</ul>`;
}

/** Set groups' decisions; the focus back on what was pressed once the tab is drawn again. */
function decideGroups(view: View, keys: readonly string[], d: GroupDecision, focus: string | null): void {
    const groups = { ...(view.ctx.choices.groups ?? {}) };
    for (const k of keys) { groups[k] = d; view.gChanging.delete(k); }
    view.ctx.update({ groups });
    if (focus) view.root?.querySelector<HTMLElement>(focus)?.focus();
}

function groupsClick(view: View, e: Event): void {
    const t = e.target as HTMLElement;
    const { state, choices } = view.ctx;
    const groups = unlinkedGroups(state, choices, view.sel);
    const byKey = (k: string | undefined): UnlinkedGroup | undefined => groups.find(g => g.key === k);
    const q = (k: string): string => CSS.escape(k);
    const decide = t.closest<HTMLButtonElement>('[data-decide]');
    if (decide) {
        const g = byKey(decide.dataset.gkey);
        if (!g) return;
        const kind = decide.dataset.decide as GroupKind;
        if (kind === 'connect') { openConnect(view, g, decide); return; }
        decideGroups(view, [g.key], { kind } as GroupDecision, `[data-gchange="${q(g.key)}"]`);
        return;
    }
    const bulk = t.closest<HTMLButtonElement>('[data-bulk]');
    if (bulk) {
        const keys = groups.filter(g => view.gTicked.has(g.key)).map(g => g.key);
        if (!keys.length) return;
        const kind = bulk.dataset.bulk as GroupKind;
        if (kind === 'connect') {
            const g = byKey(keys[0]);
            if (g && keys.length === 1) openConnect(view, g, bulk);
            return;
        }
        view.gTicked.clear();
        decideGroups(view, keys, { kind } as GroupDecision, '.merge-s3-glead');
        return;
    }
    const change = t.closest<HTMLButtonElement>('[data-gchange]');
    if (change) {
        const k = change.dataset.gchange!;
        view.gChanging.add(k);
        update(view);
        view.root?.querySelector<HTMLElement>(`[data-gkey="${q(k)}"][data-decide][aria-checked="true"], [data-gkey="${q(k)}"][data-decide]`)?.focus();
        return;
    }
    const prev = t.closest<HTMLButtonElement>('[data-gprev]');
    if (prev) {
        const g = byKey(prev.dataset.gprev);
        if (g) openGroupPreview(view, g);
        return;
    }
    const split = t.closest<HTMLButtonElement>('[data-gsplit]');
    if (split) {
        view.ctx.update({ splitGroups: [...new Set([...(choices.splitGroups ?? []), split.dataset.gsplit!])] });
        view.root?.querySelector<HTMLElement>('.merge-s3-glist [data-gtick]')?.focus();
        return;
    }
    const nl = t.closest<HTMLButtonElement>('[data-nl]');
    if (nl) {
        if (nl.dataset.nl === 'connect' && groups[0]) openConnect(view, groups[0], nl);
        else if (nl.dataset.nl === 'loose') decideGroups(view, groups.map(g => g.key), { kind: 'loose' }, '.merge-s3-glead');
        // 6f "New tree": the import goes into a new tree with the people ticked here (the tree stays as it is).
        else if (nl.dataset.nl === 'new') view.ctx.update({ mode: 'new', json: false, pickPeople: true });
    }
}

function groupsChange(view: View, e: Event): void {
    const cb = e.target as HTMLInputElement;
    if (cb.dataset.gtick !== undefined) {
        if (cb.checked) view.gTicked.add(cb.dataset.gtick); else view.gTicked.delete(cb.dataset.gtick);
        update(view);
        view.root?.querySelector<HTMLElement>(`[data-gtick="${CSS.escape(cb.dataset.gtick)}"]`)?.focus();
        return;
    }
    const id = cb.dataset.single as PersonId | undefined;
    if (!id) return;
    if (cb.checked) {
        view.singlesOff = view.singlesOff.filter(x => x !== id);
        tick(view, [id]);
    } else {
        if (!view.singlesOff.includes(id)) view.singlesOff.push(id);
        leaveOut(view, [id]);
    }
    view.root?.querySelector<HTMLElement>(`[data-single="${CSS.escape(id)}"]`)?.focus();
}

/** A group in the import (Preview): its people dashed. */
function openGroupPreview(view: View, g: UnlinkedGroup): void {
    const W = strings.mergeWizard;
    const html = `<div class="modal-header"><h2 id="merge-s3-gpreview-t">${escapeHtml(g.title)}</h2>
  <button type="button" class="close-btn" data-dismiss aria-label="${escapeHtml(strings.buttons.close)}">&times;</button></div>
<div class="merge-s3-thumb merge-s3-gthumb"></div>
<p class="merge-s3-preview-cap">${escapeHtml(W.previewCaption)}</p>`;
    const overlay = openDialog('merge-s3-gpreview', html, 'merge-s3-gpreview-t', 'picker', 'md');
    overlay.querySelector('[data-dismiss]')!.addEventListener('click', () => closeDialog(overlay));
    const box = overlay.querySelector<HTMLElement>('.merge-s3-gthumb')!;
    try {
        renderTreeThumbnail(box, { data: view.ctx.state.incomingData, focusPersonId: g.persons[0], depthUp: 3, depthDown: 3, labels: true, hits: new Set(g.persons) });
    } catch {
        box.innerHTML = `<p class="merge-s3-preview-none">${escapeHtml(W.previewNone)}</p>`;
    }
    overlay.querySelector<HTMLElement>('[data-dismiss]')!.focus();
}

interface ConnectHit { id: PersonId; in: 'tree' | 'import' }

/**
 * 6b Link to a person…: a person of the group is the parent, child or
 * partner of a person in the tree, or of one of the import that is added
 * (linked new, or of a group added); the sentence says the result, a link
 * that would give a child a third parent is said and cannot be pressed.
 */
function openConnect(view: View, g: UnlinkedGroup, opener: HTMLElement): void {
    const W = strings.mergeWizard;
    const { state, choices } = view.ctx;
    const source = state.incomingData;
    const tree = state.existingData;
    const given = choices.groups?.[g.key];
    let from: PersonId = given?.kind === 'connect' && g.persons.includes(given.person) ? given.person : g.persons[0];
    let rel: NewRel = given?.kind === 'connect' ? given.rel : 'parent';
    let to: ConnectHit | null = given?.kind === 'connect' ? { id: given.to, in: given.in } : null;
    // The import's people a group can link to: ticked, not in this group, and not in a group left out or still to decide.
    const inGroups = new Map<PersonId, string>();
    for (const x of unlinkedGroups(state, choices, view.sel)) for (const id of x.persons) inGroups.set(id, x.key);
    const decided = new Map((view.ctx.plan?.groups ?? []).map(x => [x.key, x.decision] as const));
    const importOk = (id: PersonId): boolean => {
        if (!view.sel.ticked.has(id)) return false;
        const k = inGroups.get(id);
        if (!k) return true;
        if (k === g.key) return false;
        const d = decided.get(k);
        return d?.kind === 'loose' || d?.kind === 'connect';
    };
    const treeIds = (Object.keys(tree.persons) as PersonId[]).filter(id => !tree.persons[id]?.isPlaceholder);
    const importIds = (Object.keys(source.persons) as PersonId[]).filter(importOk);
    const opt = (id: PersonId): string => `<option value="${escapeHtml(id)}"${id === from ? ' selected' : ''}>${escapeHtml(personText(source, id))}</option>`;
    const relSeg = (['parent', 'child', 'partner'] as NewRel[]).map(r =>
        `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-rel="${r}" aria-checked="${r === rel}">${escapeHtml(relLabel(r))}</button>`).join('');
    const html = `<div class="modal-header"><h2 id="merge-connect-t">${escapeHtml(W.connectTitle(g.title))}</h2>
  <button type="button" class="close-btn" data-dismiss aria-label="${escapeHtml(strings.buttons.close)}">&times;</button></div>
<div class="merge-connect-f"><label for="merge-connect-from">${escapeHtml(W.connectFrom)}</label>
<select id="merge-connect-from" class="merge-connect-from">${g.persons.map(opt).join('')}</select></div>
<div class="merge-connect-f"><span id="merge-connect-is">${escapeHtml(W.connectIs)}</span>
<div class="sel-seg merge-connect-rel" role="radiogroup" aria-labelledby="merge-connect-is">${relSeg}</div></div>
<div class="merge-connect-f"><span id="merge-connect-to-l">${escapeHtml(W.connectTo)}</span>
<input type="search" class="merge-s3-pick-q merge-connect-q" placeholder="${escapeHtml(W.connectSearch(choices.targetName))}" aria-label="${escapeHtml(W.connectSearch(choices.targetName))}" autocomplete="off" spellcheck="false">
<ul class="merge-s3-pick-list merge-connect-list" role="listbox" aria-labelledby="merge-connect-to-l"></ul></div>
<p class="merge-s3-pick-sentence merge-connect-sentence" aria-live="polite"></p>
<div class="buttons">
  <button type="button" class="secondary" data-dismiss>${escapeHtml(strings.buttons.cancel)}</button>
  <button type="button" class="primary merge-connect-go"></button>
</div>`;
    const overlay = openDialog('merge-connect-modal', html, 'merge-connect-t', 'picker', 'md');
    returnFocus = opener;
    const fromSel = overlay.querySelector<HTMLSelectElement>('.merge-connect-from')!;
    const q = overlay.querySelector<HTMLInputElement>('.merge-connect-q')!;
    const listEl = overlay.querySelector<HTMLElement>('.merge-connect-list')!;
    const sentence = overlay.querySelector<HTMLElement>('.merge-connect-sentence')!;
    const go = overlay.querySelector<HTMLButtonElement>('.merge-connect-go')!;
    const first = (data: StromData, id: PersonId): string => {
        const p = data.persons[id];
        return p?.firstName?.trim() || displayName(p) || '?';
    };
    const decision = (): Extract<GroupDecision, { kind: 'connect' }> | null =>
        to ? { kind: 'connect', person: from, rel, to: to.id, in: to.in } : null;
    const drawList = (): void => {
        const want = fold(q.value.trim()).split(/\s+/).filter(Boolean);
        const hits: ConnectHit[] = [];
        const scan = (data: StromData, ids: readonly PersonId[], where: ConnectHit['in']): void => {
            for (const id of ids) {
                if (hits.length >= 50) return;
                const p = data.persons[id]!;
                const hay = fold(`${displayName(p)} ${yearOf(p.birthDate) ?? ''}`);
                if (want.every(w => hay.includes(w))) hits.push({ id, in: where });
            }
        };
        scan(tree, treeIds, 'tree');
        scan(source, importIds, 'import');
        if (to && !hits.some(h => h.id === to!.id && h.in === to!.in)) hits.unshift(to);
        listEl.innerHTML = hits.length ? hits.map(h => {
            const data = h.in === 'tree' ? tree : source;
            const p = data.persons[h.id];
            const years = p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
            const where = h.in === 'tree' ? W.connectInTree : W.connectInImport;
            const on = !!to && to.id === h.id && to.in === h.in;
            return `<li role="option" tabindex="-1" data-to="${escapeHtml(h.id)}" data-in="${h.in}" aria-selected="${on}"><span class="merge-s3-name">${escapeHtml(displayName(p) || '?')}</span>`
                + ` <span class="merge-s3-pick-side">${years ? `${escapeHtml(years)} · ` : ''}${escapeHtml(where)}</span></li>`;
        }).join('') : `<li class="merge-connect-none">${escapeHtml(W.connectNoHit)}</li>`;
    };
    const drawResult = (): void => {
        const d = decision();
        go.textContent = W.connectBtn(g.persons.length);
        if (!d) { sentence.textContent = W.pickNone; go.disabled = true; return; }
        if (connectRefusal(state, choices, d, view.sel)) { sentence.textContent = W.connectThird; go.disabled = true; return; }
        const b = first(d.in === 'tree' ? tree : source, d.to);
        sentence.textContent = W.connectResult(g.persons.length, first(source, d.person), b);
        go.disabled = false;
    };
    const choose = (li: HTMLElement): void => {
        to = { id: li.dataset.to as PersonId, in: li.dataset.in as ConnectHit['in'] };
        listEl.querySelectorAll('[role="option"]').forEach(o => o.setAttribute('aria-selected', String(o === li)));
        drawResult();
    };
    fromSel.addEventListener('change', () => { from = fromSel.value as PersonId; drawResult(); });
    overlay.querySelector('.merge-connect-rel')!.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rel]');
        if (!b) return;
        rel = b.dataset.rel as NewRel;
        overlay.querySelectorAll('[data-rel]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        drawResult();
    });
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
    overlay.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => closeDialog(overlay)));
    go.addEventListener('click', () => {
        const d = decision();
        if (!d || go.disabled) return;
        returnFocus = null;
        closeDialog(overlay);
        decideGroups(view, [g.key], d, `[data-gchange="${CSS.escape(g.key)}"]`);
    });
    drawList();
    drawResult();
    q.focus();
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

/** The branch preview: the chosen group (or the first one) in the import, its ticked new people dashed, the others faded. */
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
    const gp = root.querySelector<HTMLElement>('#merge-s3-groups');
    gp?.addEventListener('click', e => groupsClick(view, e));
    gp?.addEventListener('change', e => groupsChange(view, e));
    const tabs = root.querySelector<HTMLElement>('.merge-s3-tabs');
    tabs?.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
        if (!b) return;
        view.tab = b.dataset.tab as View['tab'];
        update(view);
    });
    tabs?.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (root.querySelector<HTMLElement>('#merge-s3-tab-groups')?.hidden) return;
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

function openDialog(id: string, html: string, labelled: string, kind: 'decision' | 'picker', size: 'sm' | 'md' = 'sm'): HTMLElement {
    document.getElementById(id)?.remove();
    returnFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay merge-s3-dialog';
    overlay.id = id;
    overlay.innerHTML = `<div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="${labelled}" data-dialog-kind="${kind}">${html}</div>`;
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
function openUnlink(view: Pick<View, 'ctx'>, off: readonly PersonId[], deps: readonly PersonId[], what: string, single: PersonId | null, why?: 'step5'): void {
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
            leaveOut(view, off, deps, {}, why);
            leftOutToast(view, off.length + deps.length, what, before);
        } else if (c === 'loose') {
            // The unlinked groups are asked about from now on (§6).
            leaveOut(view, off, [], { groups: ch.groups ?? {} }, why);
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
