/**
 * "Edit family line…" (package 1031 §2): one dialog for a lineage's boundary
 * and name forms — the founder, the forms of the name and a separate line.
 * Every action is chosen first, then "What will change" says what it does
 * (previewOverride in src/lineage.ts, the sentences in src/lineage-preview.ts)
 * and nothing is stored before Apply: one undo step, one entry in the change
 * history. The dialog stays open with the new state afterwards.
 *
 * The UI computes no lineage itself: everything comes from src/lineage.ts.
 * The markup shell is static (#lineage-edit-modal in index.html); the body is
 * drawn here.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import type { PersonId, StromData } from '../types.js';
import {
    buildLineages, previewOverride, rodGenerations, rodLabels, rodNameForms, rodOf,
    type LineageChange, type LineageIndex, type LineagePreview, type Rod, type RodId,
} from '../lineage.js';
import { lineagePreviewTexts } from '../lineage-preview.js';
import { czechRulesApply, surnameKey, surnamesInTree, withSurnameRules } from '../surnames.js';
import { romanNumeral } from '../rods-overview.js';
import { shownName } from '../person-name.js';
import { normalizeSearchText } from '../name-search.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'lineage-edit-modal';
/** How many spellings from the tree the "+ form" list offers at once. */
const ADD_FORM_SHOWN = 8;

/** The tree the dialog is about (the overview may show a tree that is not open). */
export interface LineageEditContext {
    treeId: string;
    data: StromData;
    /** The tree is the open one (only an open tree can be changed). */
    active: boolean;
    /** The tree is linked with a research. */
    research: boolean;
}

/** What the dialog opens with besides the lineage itself. */
export interface LineageEditOptions {
    /** Another tree than the open one (the tree overview of a tree that is not open). */
    context?: LineageEditContext;
    /** Start with this action's choice (or preview) open. */
    action?: 'founder' | 'split' | 'revert';
}

/** The action being chosen: a list of members, a form, or straight to the preview. */
type Panel =
    | { kind: 'founder' | 'split'; query: string; chosen: PersonId | null }
    | { kind: 'addForm'; query: string; chosen: string | null }
    | { kind: 'removeForm'; form: string }
    | { kind: 'revert' };

/** Why nothing can be changed (null = it can). */
type Lock = 'notOpen' | 'followed' | 'readOnly' | null;

let ctx: LineageEditContext | null = null;
/** A member of the lineage shown: the lineage is found again by them after every change. */
let anchor: PersonId | null = null;
let panel: Panel | null = null;
let indexCache: { data: StromData; revision: number; index: LineageIndex; labels: Map<RodId, string> } | null = null;
let revision = 0;
/** The dialogs under this one when it opened (the Surnames dialog resets the stack). */
let stackBelow: string[] = [];
let listening = false;

const fold = (s: string): string => normalizeSearchText(s);

/** The tree's lineages, computed once per change. */
function lineagesOf(data: StromData): { index: LineageIndex; labels: Map<RodId, string> } {
    if (!indexCache || indexCache.data !== data || indexCache.revision !== revision) {
        const index = buildLineages(data);
        indexCache = { data, revision, index, labels: rodLabels(index) };
    }
    return indexCache;
}

export const lineageEditUiMethods = uiModule({
    /**
     * Open the edit dialog of a lineage (the tree overview's detail; the
     * person card through `openLineageSplitFrom`). Without a context it is a
     * lineage of the open tree.
     */
    openLineageEdit(rodId: RodId, opts: LineageEditOptions = {}): void {
        const context = opts.context ?? this.lineageEditOpenTreeContext();
        if (!context) return;
        const { index } = lineagesOf(context.data);
        const rod = index.rods.get(rodId);
        if (!rod) return;
        ctx = context;
        anchor = rod.founderId;
        panel = null;
        if (opts.action === 'revert' && rod.manual) panel = { kind: 'revert' };
        else if (opts.action === 'founder' || opts.action === 'split') panel = { kind: opts.action, query: '', chosen: null };
        this.showLineageEditDialog();
    },

    /**
     * "Start a family line from this person…" (the person card's ⋯ menu): the
     * dialog of the person's lineage with the person chosen and the preview open.
     */
    openLineageSplitFrom(personId: PersonId): void {
        const context = this.lineageEditOpenTreeContext();
        if (!context) return;
        const { index } = lineagesOf(context.data);
        const rodId = rodOf(index, personId);
        const rod = rodId ? index.rods.get(rodId) : undefined;
        if (!rod) return;
        ctx = context;
        anchor = rod.founderId;
        panel = rod.founderId === personId ? null : { kind: 'split', query: '', chosen: personId };
        this.showLineageEditDialog();
    },

    /** The open tree as the dialog's context, or null when no tree is open. */
    lineageEditOpenTreeContext(): LineageEditContext | null {
        const treeId = TreeManager.getActiveTreeId();
        if (!treeId) return null;
        return {
            treeId, data: DataManager.getData(), active: true,
            research: !!TreeManager.getActiveTreeMetadata()?.research,
        };
    },

    isLineageEditOpen(): boolean {
        return !!document.getElementById(DIALOG_ID)?.classList.contains('active');
    },

    showLineageEditDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay) return;
        this.listenForLineageEditChanges();
        // Over whatever opened it (the tree overview is appended to the body when it opens).
        document.body.appendChild(overlay);
        if (!overlay.classList.contains('active')) {
            stackBelow = this.dialogStack.filter(id => id !== DIALOG_ID);
            overlay.classList.add('active');
        }
        this.dialogStack = [...this.dialogStack.filter(id => id !== DIALOG_ID), DIALOG_ID];
        this.renderLineageEdit();
        const focus = overlay.querySelector<HTMLElement>('.le-search, .le-addform-input, [data-le="apply"]:not([disabled])')
            ?? overlay.querySelector<HTMLElement>('.close-btn');
        focus?.focus({ preventScroll: true });
    },

    closeLineageEdit(): void {
        const overlay = document.getElementById(DIALOG_ID);
        overlay?.classList.remove('active');
        const below = stackBelow.filter(id => id !== DIALOG_ID && !!document.getElementById(id));
        const rest = this.dialogStack.filter(id => id !== DIALOG_ID && !below.includes(id));
        this.dialogStack = [...below, ...rest];
        stackBelow = [];
        panel = null;
        ctx = null;
        anchor = null;
        const body = document.getElementById('lineage-edit-body');
        if (body) body.innerHTML = '';
    },

    /** Escape: an open choice or preview first, then the dialog. */
    lineageEditEscape(): void {
        if (panel) {
            panel = null;
            this.renderLineageEdit();
            return;
        }
        this.closeLineageEdit();
    },

    listenForLineageEditChanges(): void {
        if (listening) return;
        listening = true;
        // An edit, an undo (the toast's or the history's) or a load: draw the
        // lineage again; a choice in progress is dropped (its preview is stale).
        const changed = (): void => {
            revision++;
            // Also while the Surnames dialog stands over it (it comes back with the new forms).
            if (!ctx?.active) return;
            ctx.data = DataManager.getData();
            if (panel && panel.kind !== 'founder' && panel.kind !== 'split' && panel.kind !== 'addForm') panel = null;
            else if (panel && 'chosen' in panel) panel.chosen = null;
            this.renderLineageEdit();
        };
        window.addEventListener('strom:user-change', changed);
        window.addEventListener('strom:data-changed', changed);
        const overlay = document.getElementById(DIALOG_ID);
        overlay?.addEventListener('click', (e) => this.onLineageEditClick(e));
        overlay?.addEventListener('input', (e) => {
            const el = e.target;
            if (!(el instanceof HTMLInputElement) || !panel) return;
            if (el.classList.contains('le-search') && (panel.kind === 'founder' || panel.kind === 'split')) {
                panel.query = el.value;
                this.renderLineageEditList();
            } else if (el.classList.contains('le-addform-input') && panel.kind === 'addForm') {
                panel.query = el.value;
                this.renderLineageEditList();
            }
        });
        overlay?.addEventListener('keydown', (e) => {
            const el = e.target;
            if (e.key !== 'Enter' || !(el instanceof HTMLInputElement)) return;
            // Enter in the search: the first person or form offered.
            const first = overlay.querySelector<HTMLElement>('.le-list [data-le="pick"]:not([disabled]), .le-list [data-le="form-pick"]');
            if (first) {
                e.preventDefault();
                first.click();
            }
        });
    },

    /** Why the lineage cannot be changed now (null: it can). */
    lineageEditLock(): Lock {
        if (!ctx || !ctx.active || ctx.treeId !== TreeManager.getActiveTreeId()) return 'notOpen';
        if (DataManager.isLiveFollowing()) return 'followed';
        if (DataManager.isReadOnly() || DataManager.isTreeLocked()) return 'readOnly';
        return null;
    },

    /** The lineage the dialog shows (found by its anchor member), or null when it is gone. */
    lineageEditRod(): { rod: Rod; index: LineageIndex; labels: Map<RodId, string> } | null {
        if (!ctx || !anchor) return null;
        const { index, labels } = lineagesOf(ctx.data);
        const id = rodOf(index, anchor);
        const rod = id ? index.rods.get(id) : undefined;
        return rod ? { rod, index, labels } : null;
    },

    renderLineageEdit(): void {
        const overlay = document.getElementById(DIALOG_ID);
        const body = document.getElementById('lineage-edit-body');
        const title = document.getElementById('lineage-edit-title');
        const sub = document.getElementById('lineage-edit-sub');
        if (!overlay || !body || !title || !sub || !ctx) return;
        const esc = (s: string): string => this.escapeHtml(s);
        const t = strings.lineage.edit;
        const r = strings.treeOverview.rods;
        const found = this.lineageEditRod();
        if (!found) {
            title.textContent = strings.treeOverview.sections.rods;
            sub.textContent = '';
            body.innerHTML = `<p class="le-gone">${esc(t.gone)}</p>`;
            return;
        }
        const { rod, index, labels } = found;
        const data = ctx.data;
        const label = labels.get(rod.id) ?? rod.surname;
        const lock = this.lineageEditLock();
        title.textContent = t.title(label);
        const gens = rodGenerations(index, rod.id).length;
        const period = rod.period ? (rod.period.from === rod.period.to ? String(rod.period.from) : `${rod.period.from}–${rod.period.to}`) : '';
        sub.textContent = [
            period, r.members(rod.realMemberCount),
            rod.realSpouseCount > 0 ? r.marriedIn(rod.realSpouseCount) : '', r.generations(gens),
        ].filter(Boolean).join(' · ');

        // Disabled controls keep their place and say why (title + aria-disabled).
        const hint = lock === 'notOpen' ? t.notOpen : lock === 'followed' ? t.followed : lock === 'readOnly' ? t.readOnly : '';
        const ctl = (attrs: string): string => lock ? `${attrs} aria-disabled="true" title="${esc(hint)}" data-locked` : attrs;
        const btn = (le: string, text: string, cls = 'secondary le-btn', extra = ''): string =>
            `<button type="button" class="${cls}${lock ? ' is-disabled' : ''}" ${ctl(`data-le="${le}"`)} ${extra}>${esc(text)}</button>`;

        let bar = '';
        if (lock === 'notOpen') {
            bar = `<div class="le-bar" data-state="notOpen"><span>${esc(t.notOpen)}</span>
                <button type="button" class="secondary le-btn" data-le="open-tree">${esc(strings.treeOverview.openTree)}</button></div>`;
        } else if (lock) {
            bar = `<div class="le-bar" data-state="${lock}"><span>${esc(hint)}</span></div>`;
        } else if (ctx.research) {
            bar = `<div class="le-bar le-bar--info" data-state="research"><span>${esc(t.research)}</span></div>`;
        }

        // 1. Founder: computed or set by hand (then a way back), Change….
        const founder = data.persons[rod.founderId];
        const facts = this.treeOverviewRodFounderFacts(rod, data);
        const how = rod.manual
            ? `<span class="le-chip">${esc(t.manual)}</span> ${btn('revert', t.revert, 'le-link')}`
            : `<span class="le-faint">· ${esc(t.auto)}</span>`;
        const founderPanel = panel && (panel.kind === 'founder' || panel.kind === 'revert') ? this.lineageEditPanelHtml(rod, index, labels) : '';
        const founderSec = `<section class="le-sec" data-sec="founder">
            <h3 class="le-sec-title">${esc(t.founder(founder?.gender ?? 'unknown'))}</h3>
            <div class="le-row">
                <span class="le-founder"><span class="le-founder-name">${esc(founder ? shownName(founder) : '?')}${facts ? ` (${esc(facts)})` : ''}</span> ${how}</span>
                ${panel?.kind === 'founder' ? '' : btn('founder', t.change)}
            </div>
            ${this.lineageEditFounderSuggestionHtml(rod)}
            ${founderPanel}
        </section>`;

        // 2. Name forms: the main one first (no ×), the others with ×, "+ form".
        const { forms, feminine } = rodNameForms(rod, data);
        const pills = forms.map((f, i) => i === 0
            ? `<span class="le-pill" data-form="${esc(f)}">${esc(f)} <span class="le-faint">${esc(t.main)}</span></span>`
            : `<span class="le-pill${panel?.kind === 'removeForm' && surnameKey(panel.form) === surnameKey(f) ? ' is-chosen' : ''}" data-form="${esc(f)}">${esc(f)}
                <button type="button" class="le-x${lock ? ' is-disabled' : ''}" ${ctl(`data-le="remove-form" data-form="${esc(f)}"`)} aria-label="${esc(t.removeForm(f))}"${lock ? '' : ` title="${esc(t.removeForm(f))}"`}>×</button></span>`).join('');
        const addBtn = panel?.kind === 'addForm' ? '' : btn('add-form', t.addForm, 'le-pill le-pill--add');
        const fem = feminine.length > 0 && withSurnameRules(data, () => czechRulesApply(data)) ? `${esc(t.feminine(feminine.join(', ')))} ` : '';
        const surnamesLink = lock ? esc(strings.surnames.menu) : `<button type="button" class="le-link" data-le="surnames">${esc(strings.surnames.menu)}</button>`;
        const formsPanel = panel && (panel.kind === 'addForm' || panel.kind === 'removeForm') ? this.lineageEditPanelHtml(rod, index, labels) : '';
        const formsSec = `<section class="le-sec" data-sec="forms">
            <h3 class="le-sec-title">${esc(t.forms)}</h3>
            <div class="le-pills">${pills}${addBtn}</div>
            ${formsPanel}
            <p class="le-note">${fem}${esc(t.formsWholeTree)} · ${surnamesLink}</p>
        </section>`;

        // 3. A separate line.
        const splitPanel = panel?.kind === 'split' ? this.lineageEditPanelHtml(rod, index, labels) : '';
        const splitSec = `<section class="le-sec" data-sec="split">
            <h3 class="le-sec-title">${esc(t.split)}</h3>
            <div class="le-row">
                <span class="le-hint">${esc(t.splitHint)}</span>
                ${panel?.kind === 'split' ? '' : btn('split', t.splitBtn)}
            </div>
            ${splitPanel}
        </section>`;

        const focusedLe = document.activeElement instanceof HTMLElement && overlay.contains(document.activeElement)
            ? document.activeElement.dataset.le ?? (document.activeElement.classList.contains('le-search') ? 'search' : null) : null;
        body.innerHTML = `${bar}${founderSec}${formsSec}${splitSec}`;
        if (focusedLe) {
            const again = focusedLe === 'search'
                ? body.querySelector<HTMLElement>('.le-search, .le-addform-input')
                : body.querySelector<HTMLElement>(`[data-le="${CSS.escape(focusedLe)}"]`);
            again?.focus({ preventScroll: true });
        }
    },

    /**
     * The seam for the research's founder suggestion (U5): "The research
     * suggests the founder … · Accept · Dismiss", drawn like the surname
     * suggestions. Not drawn yet.
     */
    lineageEditFounderSuggestionHtml(rod: Rod): string {
        void rod;
        return '';
    },

    /** The open action: its choice (people or forms), then the preview with Cancel / {verb}. */
    lineageEditPanelHtml(rod: Rod, index: LineageIndex, labels: Map<RodId, string>): string {
        if (!panel || !ctx) return '';
        const esc = (s: string): string => this.escapeHtml(s);
        const t = strings.lineage.edit;
        let choice = '';
        if (panel.kind === 'founder' || panel.kind === 'split') {
            choice = `<input type="search" class="le-search" value="${esc(panel.query)}" placeholder="${esc(t.searchMembers)}"
                aria-label="${esc(t.searchMembers)}" autocomplete="off">
                <div class="le-list" role="list">${this.lineageEditPeopleHtml(rod, index)}</div>`;
        } else if (panel.kind === 'addForm') {
            choice = `<div class="le-panel-title">${esc(t.addFormTitle(labels.get(rod.id) ?? rod.surname))}</div>
                <input type="search" class="le-addform-input" value="${esc(panel.query)}" placeholder="${esc(t.addFormPlaceholder)}"
                aria-label="${esc(t.addFormPlaceholder)}" autocomplete="off">
                <div class="le-list" role="list">${this.lineageEditFormsHtml(rod, index, labels)}</div>`;
        }
        const change = this.lineageEditChange(rod);
        const preview = change ? this.lineageEditPreviewHtml(change, index) : '';
        const cancelOnly = !change
            ? `<div class="le-actions"><button type="button" class="secondary le-btn" data-le="cancel">${esc(strings.buttons.cancel)}</button></div>` : '';
        return `<div class="le-panel" data-panel="${panel.kind}">${choice}${preview}${cancelOnly}</div>`;
    },

    /** The members to choose from, by generation (I = the founder's), filtered by the search. */
    lineageEditPeopleHtml(rod: Rod, index: LineageIndex): string {
        if (!panel || (panel.kind !== 'founder' && panel.kind !== 'split') || !ctx) return '';
        const esc = (s: string): string => this.escapeHtml(s);
        const t = strings.lineage.edit;
        const data = ctx.data;
        const q = fold(panel.query.trim());
        const kind = panel.kind;
        const pickedId = panel.chosen;
        const items: string[] = [];
        rodGenerations(index, rod.id).forEach((ids, g) => {
            for (const id of ids) {
                const p = data.persons[id];
                if (!p) continue;
                const isFounder = id === rod.founderId;
                if (isFounder && kind === 'split') continue;
                const name = shownName(p);
                if (q && !fold(name).includes(q)) continue;
                const years = this.treeOverviewRodYears(p);
                const chosen = pickedId === id;
                items.push(`<button type="button" class="le-item${chosen ? ' is-chosen' : ''}" data-le="pick" data-id="${esc(id)}"
                    ${isFounder ? 'disabled' : ''} aria-pressed="${chosen}">
                    <span class="le-gen">${romanNumeral(g + 1)}</span>
                    <span class="le-item-name">${esc(name)}${years ? ` <span class="le-faint">(${esc(years)})</span>` : ''}${isFounder ? ` <span class="le-faint">· ${esc(t.now)}</span>` : ''}</span>
                </button>`);
            }
        });
        return items.length ? items.join('') : `<p class="le-empty">${esc(t.noMatch)}</p>`;
    },

    /**
     * The spellings of the tree to add (not yet a form of the lineage): count
     * of people and the lineage each one names; "Use “…”" for one typed in.
     */
    lineageEditFormsHtml(rod: Rod, index: LineageIndex, labels: Map<RodId, string>): string {
        if (!panel || panel.kind !== 'addForm' || !ctx) return '';
        const esc = (s: string): string => this.escapeHtml(s);
        const t = strings.lineage.edit;
        const data = ctx.data;
        const own = new Set(rodNameForms(rod, data).forms.map(surnameKey));
        // The largest lineage named by each spelling.
        const rodByForm = new Map<string, RodId>();
        for (const r of [...index.rods.values()].filter(x => !x.small).sort((a, b) => b.realMemberCount - a.realMemberCount)) {
            const key = surnameKey(r.surname);
            if (!rodByForm.has(key)) rodByForm.set(key, r.id);
        }
        const pick = panel.chosen;
        const typed = panel.query.trim();
        const q = fold(typed);
        const list = surnamesInTree(data).filter(s => !own.has(surnameKey(s.surname)) && (!q || fold(s.surname).includes(q)));
        const items = list.slice(0, ADD_FORM_SHOWN).map(s => {
            const rid = rodByForm.get(surnameKey(s.surname));
            const rodText = rid && rid !== rod.id ? ` · ${esc(t.addFormRod(labels.get(rid) ?? s.surname))}` : '';
            const chosen = pick !== null && surnameKey(pick) === surnameKey(s.surname);
            return `<button type="button" class="le-item${chosen ? ' is-chosen' : ''}" data-le="form-pick" data-form="${esc(s.surname)}" aria-pressed="${chosen}">
                <span class="le-item-name">${esc(s.surname)} <span class="le-faint">· ${esc(strings.surnames.inTree(s.count))}${rodText}</span></span></button>`;
        });
        if (typed && !own.has(surnameKey(typed)) && !list.some(s => surnameKey(s.surname) === surnameKey(typed))) {
            const chosen = pick !== null && surnameKey(pick) === surnameKey(typed);
            items.push(`<button type="button" class="le-item${chosen ? ' is-chosen' : ''}" data-le="form-pick" data-form="${esc(typed)}" aria-pressed="${chosen}">
                <span class="le-item-name">${esc(t.addFormUse(typed))}</span></button>`);
        }
        return items.length ? items.join('') : `<p class="le-empty">${esc(t.noMatch)}</p>`;
    },

    /** The change the open panel stands for, once its choice is made. */
    lineageEditChange(rod: Rod): LineageChange | null {
        if (!panel) return null;
        switch (panel.kind) {
            case 'founder': return panel.chosen ? { kind: 'founder', personId: panel.chosen } : null;
            case 'split': return panel.chosen ? { kind: 'split', personId: panel.chosen } : null;
            case 'addForm': return panel.chosen ? { kind: 'addForm', rodId: rod.id, form: panel.chosen } : null;
            case 'removeForm': return { kind: 'removeForm', rodId: rod.id, form: panel.form };
            case 'revert': return { kind: 'revert', rodId: rod.id };
        }
    },

    /** "What will change" and Cancel / {verb}; a form joined by a relation offers a line of its own instead. */
    lineageEditPreviewHtml(change: LineageChange, index: LineageIndex): string {
        if (!ctx) return '';
        const esc = (s: string): string => this.escapeHtml(s);
        const t = strings.lineage.edit;
        const pv: LineagePreview = previewOverride(ctx.data, change, index);
        const texts = lineagePreviewTexts(pv.lines, ctx.data, p => shownName(p));
        const relation = pv.lines.find(l => l.kind === 'linkedByRelation');
        const verb = change.kind === 'founder' ? t.apply : change.kind === 'split' ? t.startLine
            : change.kind === 'addForm' ? t.linkForms : change.kind === 'removeForm' ? t.removeFormBtn : t.restore;
        const lock = this.lineageEditLock();
        const offerSplit = relation && relation.kind === 'linkedByRelation' && !lock
            ? `<button type="button" class="secondary le-btn" data-le="relation-split" data-id="${esc(relation.personId ?? '')}">${esc(t.splitBtn)}</button>` : '';
        const apply = pv.patch && !lock
            ? `<button type="button" class="primary le-btn" data-le="apply">${esc(verb)}</button>`
            : (offerSplit ? '' : `<button type="button" class="primary le-btn" data-le="apply" disabled${lock ? ` title="${esc(this.lineageEditLockText(lock))}"` : ''}>${esc(verb)}</button>`);
        return `<div class="le-preview" role="status" aria-live="polite">
                <div class="le-preview-title">${esc(strings.lineage.preview.title)}</div>
                ${texts.map((s, i) => `<p class="${pv.lines[i]?.kind === 'wholeTreeKeeps' || pv.lines[i]?.kind === 'formWholeTree' ? 'le-faint' : ''}">${esc(s)}</p>`).join('')}
            </div>
            <div class="le-actions">
                <button type="button" class="secondary le-btn" data-le="cancel">${esc(strings.buttons.cancel)}</button>
                ${offerSplit}${apply}
            </div>`;
    },

    lineageEditLockText(lock: Lock): string {
        const t = strings.lineage.edit;
        return lock === 'notOpen' ? t.notOpen : lock === 'followed' ? t.followed : lock === 'readOnly' ? t.readOnly : '';
    },

    /** Only the list under the search (typing keeps the field and its caret). */
    renderLineageEditList(): void {
        const found = this.lineageEditRod();
        const list = document.querySelector<HTMLElement>(`#${DIALOG_ID} .le-list`);
        if (!found || !list || !panel) return;
        list.innerHTML = panel.kind === 'addForm'
            ? this.lineageEditFormsHtml(found.rod, found.index, found.labels)
            : this.lineageEditPeopleHtml(found.rod, found.index);
    },

    onLineageEditClick(e: Event): void {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-le]');
        if (!target || !ctx) return;
        const action = target.dataset.le!;
        if (action === 'close') {
            this.closeLineageEdit();
            return;
        }
        if (target.hasAttribute('data-locked') || target.hasAttribute('disabled')) return;
        const found = this.lineageEditRod();
        switch (action) {
            case 'open-tree':
                void this.lineageEditOpenTree();
                return;
            case 'founder':
            case 'split':
                panel = { kind: action, query: '', chosen: null };
                break;
            case 'revert':
                panel = { kind: 'revert' };
                break;
            case 'add-form':
                panel = { kind: 'addForm', query: '', chosen: null };
                break;
            case 'remove-form':
                panel = { kind: 'removeForm', form: target.dataset.form ?? '' };
                break;
            case 'pick':
                if (panel && (panel.kind === 'founder' || panel.kind === 'split')) panel.chosen = target.dataset.id as PersonId;
                break;
            case 'form-pick':
                if (panel?.kind === 'addForm') panel.chosen = target.dataset.form ?? null;
                break;
            case 'relation-split': {
                // The form is joined by a parent–child link: a line of its own from its first carrier.
                const id = target.dataset.id as PersonId | undefined;
                const form = panel?.kind === 'removeForm' ? panel.form : '';
                panel = { kind: 'split', query: id ? '' : form, chosen: id && found && id !== found.rod.founderId ? id : null };
                break;
            }
            case 'cancel':
                panel = null;
                break;
            case 'apply':
                this.applyLineageEdit();
                return;
            case 'surnames':
                this.showSurnamesDialog(DIALOG_ID);
                return;
            default:
                return;
        }
        this.renderLineageEdit();
        const overlay = document.getElementById(DIALOG_ID);
        // The choice's search, else the preview's button, gets the keyboard.
        if (action === 'founder' || action === 'split' || action === 'add-form' || action === 'relation-split') {
            overlay?.querySelector<HTMLElement>('.le-search, .le-addform-input')?.focus();
        }
        if (action === 'pick' || action === 'form-pick' || action === 'remove-form' || action === 'revert' || action === 'relation-split') {
            const apply = overlay?.querySelector<HTMLElement>('[data-le="apply"]:not([disabled]), [data-le="relation-split"]');
            apply?.scrollIntoView({ block: 'nearest' });
            if (action !== 'relation-split') apply?.focus({ preventScroll: true });
        }
        if (action === 'cancel') overlay?.querySelector<HTMLElement>('.close-btn')?.focus();
    },

    /** Apply the previewed change: one undo step and an entry in the change history. */
    applyLineageEdit(): void {
        const found = this.lineageEditRod();
        if (!found || !ctx || this.lineageEditLock()) return;
        const { rod, index, labels } = found;
        const change = this.lineageEditChange(rod);
        if (!change) return;
        const data = ctx.data;
        const pv = previewOverride(data, change, index);
        if (!pv.patch) return;
        const label = labels.get(rod.id) ?? rod.surname;
        const nameOf = (id: PersonId): string => data.persons[id] ? shownName(data.persons[id]) : '?';
        const u = strings.undo;
        const a = strings.auditLog;
        let nextAnchor: PersonId = rod.founderId;
        // The toast says what was done; the undo pill's "Undo" rides in it over the dialog.
        let done = '';
        switch (change.kind) {
            case 'founder':
                done = a.lineageFounder(label, nameOf(change.personId));
                DataManager.applyLineagePatch(pv.patch, u.lineageFounder(label), { action: 'lineage.founder', text: done });
                nextAnchor = change.personId;
                break;
            case 'split': {
                const after = pv.after.find(s => s.founderId === change.personId);
                done = a.lineageSplit(after?.label ?? rod.surname, nameOf(change.personId));
                DataManager.applyLineagePatch(pv.patch, u.lineageSplit(nameOf(change.personId)), { action: 'lineage.split', text: done });
                break;
            }
            case 'revert':
                done = a.lineageRevert(label);
                DataManager.applyLineagePatch(pv.patch, u.lineageRevert(label),
                    { action: rod.manual === 'split' ? 'lineage.split' : 'lineage.founder', text: done });
                break;
            case 'addForm':
                done = strings.surnames.linked;
                DataManager.applyLineagePatch(pv.patch, u.addSurnameGroup([rod.surname, change.form].join(' = ')));
                break;
            case 'removeForm': {
                const group = (data.surnameVariants ?? []).find(g => g.some(n => surnameKey(n) === surnameKey(change.form))) ?? [];
                done = a.surnameFormRemoved(change.form, group.join(' · '));
                DataManager.applyLineagePatch(pv.patch, u.removeSurnameForm(change.form), { action: 'surnames.removeForm', text: done });
                break;
            }
        }
        this.showToast(/[.!?]$/.test(done) ? done : `${done}.`, 6000, { kind: 'lineage-edit', clearOf: `#${DIALOG_ID} .buttons` });
        revision++;
        panel = null;
        anchor = nextAnchor;
        ctx.data = DataManager.getData();
        this.renderLineageEdit();
        TreeRenderer.render();
        // The overview behind follows the lineage (a new founder gives it a new id).
        const now = this.lineageEditRod();
        if (now) this.followTreeOverviewRod(rod.id, now.rod.id);
        document.querySelector<HTMLElement>(`#${DIALOG_ID} .close-btn`)?.focus({ preventScroll: true });
    },

    /** "Open tree" in the bar of a tree that is not open: open it and show the lineage again. */
    async lineageEditOpenTree(): Promise<void> {
        if (!ctx) return;
        const treeId = ctx.treeId;
        const keep = anchor;
        this.closeLineageEdit();
        if (this.isTreeOverviewOpen()) await this.openTreeFromOverview();
        else await this.switchToTree(treeId);
        const context = this.lineageEditOpenTreeContext();
        if (!context || context.treeId !== treeId || !keep) return;
        const { index } = lineagesOf(context.data);
        const rodId = rodOf(index, keep);
        if (rodId) this.openLineageEdit(rodId);
    },
});
