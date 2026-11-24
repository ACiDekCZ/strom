/**
 * Change structure… › From a selection (spec 139 §3–§4): the step "who to
 * take" — one component for a new tree and for Join › A selection — and the
 * summary before a new tree or a copy of the whole tree is created.
 *
 * Who to take: seven sources as vertical tabs (the current view, a family
 * line, a list or research line, the ancestors, descendants or direct line of
 * a person, people chosen by hand); under the source the line "Selected: …"
 * with the real count of people. Its result is `{ ids, what }`.
 *
 * The summary counts what the new tree gets with the rules of creating it
 * (src/structure-options.ts summarizeSubset, extractSubtree's glue): people,
 * couples, sources and images — images only by reference, never loaded. A
 * large selection is counted in batches under the create button, which stays
 * disabled until the count ends; leaving the step stops the count.
 *
 * A new tree from a selection and a copy are never tied to a research
 * (TreeMetadata.fromTree / copyOf, K2.4).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage, countText } from '../strings.js';
import type { Person, PersonId, TreeId, ViewMode } from '../types.js';
import { extractSubtree } from '../subtree.js';
import {
    summarizeSubset, summarizeSubsetSteps, summarizeCopy, type SubsetSummary, type SubsetIslandPerson,
} from '../structure-options.js';
import { rodPickKey, rodPickerItems, rodPickerSmallItems, selectionIcon, type RodPickerItem } from '../rod-picker.js';
import { selectionPersonIds, type SelectionRef } from '../view-selection.js';
import { listDisplayName, listKind, ruleLabel } from '../person-lists.js';
import { PersonPicker, MultiPersonPicker } from '../person-picker.js';
import { shownName } from '../person-name.js';
import { yearOf } from '../dates.js';
import { freeCopyName, treeNameTaken } from '../tree-copy-name.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { selectionLines } from './table-view/table-research.js';
import { researchTableLive } from './research-ui.js';
import { selectionIndex } from './view-selection-ui.js';
import { listKindIcon } from './list-kind-icon.js';
import { computeUnder } from './canvas-busy.js';
import { busyLocal, spinEl } from './busy.js';
import { showToast } from './toast.js';
import { SPLIT_SHOWN_AT_ONCE } from './split-ui.js';
import { uiModule } from './module.js';
import { barEl, setBarShare } from './prog-bar.js';
import { el, footerButton, structureOpenFor, type StructureStep, type StructureView } from './structure-ui.js';

/** The sources of who to take, in the tabs' order. */
export type StructureWhoKind = 'view' | 'rod' | 'list' | 'ancestors' | 'descendants' | 'direct' | 'hand';
const WHO_KINDS: readonly StructureWhoKind[] = ['view', 'rod', 'list', 'ancestors', 'descendants', 'direct', 'hand'];

/** What the step "who to take" gives on Continue. */
export interface StructureWhoResult {
    /** The chosen people (real ones; the creating adds the glue partners itself). */
    ids: Set<PersonId>;
    /** What was chosen, as the tree's name and the summary say it ("Jesenský line"). */
    what: string;
    kind: StructureWhoKind;
}

export interface StructureWhoOptions {
    /**
     * 'new': a new tree from the selection (step 2 of 3, Continue leads to the
     * summary); 'join': Join › A selection (no step numbers, back to "what to
     * join", Continue says "Continue to the guide").
     */
    mode: 'new' | 'join';
    /** Continue with a non-empty selection. Default ('new'): the summary step. */
    onDone?: (result: StructureWhoResult) => void;
}

/** What the summary is of. */
export type StructureSummaryInput =
    | { kind: 'selection'; ids: ReadonlySet<PersonId>; what: string }
    | { kind: 'copy' };

/** The icons of the tabs (18 px, the design's). */
const KIND_ICON: Record<StructureWhoKind, string> = {
    view: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10h3M13 10h3M10 14h4"/>',
    rod: '<path d="M12 3v18M6 8h12M8 13h8M9.5 18h5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1M4 12h1M4 18h1"/>',
    ancestors: '<circle cx="12" cy="17" r="2.5"/><path d="M12 14.5V11M12 11L6 6M12 11l6-5"/>',
    descendants: '<circle cx="12" cy="7" r="2.5"/><path d="M12 9.5V13M12 13l-6 5M12 13l6 5"/>',
    direct: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21"/>',
    hand: '<path d="M5 12l4 4 10-10"/>',
};

function kindIcon(kind: StructureWhoKind): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" `
        + `stroke-linejoin="round" aria-hidden="true" focusable="false">${KIND_ICON[kind]}</svg>`;
}

/** The axis of the lines' bars (as the window's selection draws them). */
const AXIS_LO = 1650;
const AXIS_HI = 2030;
/** The generations' stepper: 1 … 10, then all. */
const MAX_GENERATIONS = 10;
/** Views whose people on the screen make a cut (the layout's positions). */
const CUT_VIEWS: readonly ViewMode[] = ['family', 'descendants'];

/** What the step remembers while it is in the dialog's history (back from the summary keeps it). */
interface WhoState {
    kind: StructureWhoKind | null;
    rodId: string | null;
    /** An encoded list or research line ('list:<id>', 'line:<id>'). */
    list: string | null;
    personId: PersonId | null;
    /** Generations per stepper (undefined: all). */
    gen: { ancestors?: number; descendants?: number; directUp?: number; directDown?: number };
    hand: PersonId[];
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function realPerson(id: PersonId | null | undefined): Person | null {
    if (!id) return null;
    const p = DataManager.getPerson(id);
    return p && !p.isPlaceholder ? p : null;
}

/** "1841–1909", "* 1851", "† 1880" or ''. */
function yearsOf(p: Person): string {
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

/** The real people of a set (placeholders out). */
function realIds(ids: Iterable<PersonId>): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const id of ids) if (realPerson(id)) out.add(id);
    return out;
}

/** The people on the screen make a cut: the Family or Descendants view with two people at least. */
function viewCutReady(): boolean {
    return CUT_VIEWS.includes(TreeRenderer.getViewMode()) && TreeRenderer.getVisiblePersonIds().size >= 2;
}

/** The list rows of a list or research line, in sections. */
interface ListRow { sel: string; label: string; sub: string; icon: string; count: number; q: string }

function stepperHtml(label: string, key: string, g: number | undefined): string {
    return `<span class="depth-stepper" data-stepper="${key}"><span class="depth-stepper-label">${esc(label)}</span>`
        + `<span class="depth-stepper-group" role="group" aria-label="${esc(label)}">`
        + `<button type="button" class="depth-stepper-btn" data-gen="-1" aria-label="${esc(strings.focus.depthDecrease)}"${g === 1 ? ' disabled' : ''}>−</button>`
        + `<span class="depth-stepper-value" aria-live="polite">${g ? g : esc(strings.selection.genAll)}</span>`
        + `<button type="button" class="depth-stepper-btn" data-gen="1" aria-label="${esc(strings.focus.depthIncrease)}"${g ? '' : ' disabled'}>+</button>`
        + `</span></span>`;
}

/** One step of the stepper: 1 … 10, then all (undefined); down from all to 10. */
function stepGen(g: number | undefined, by: number): number | undefined {
    if (by > 0) return g === undefined ? undefined : g >= MAX_GENERATIONS ? undefined : g + 1;
    return g === undefined ? MAX_GENERATIONS : Math.max(1, g - 1);
}

/** "Selected: <b>…</b>" — the text before and after the bold part from the one string. */
function chosenInto(host: HTMLElement, text: string | null): void {
    host.replaceChildren();
    if (!text) return;
    const [pre, post = ''] = strings.structure.chosen('\u0001').split('\u0001');
    host.append(pre, el('b', undefined, text), post);
}

export const structureSelectMethods = uiModule({
    // ---- Who to take (§3) ----

    /**
     * The step "who to take" of the open tree. `mode` 'new' leads to the
     * summary; 'join' (part C) gets the result in `onDone`.
     */
    structureWhoStep(opts: StructureWhoOptions = { mode: 'new' }): StructureStep {
        const open = structureOpenFor();
        const name = open ? TreeManager.getTreeMetadata(open.treeId)?.name ?? '' : '';
        const t = strings.structure;
        const who: WhoState = { kind: null, rodId: null, list: null, personId: null, gen: { ancestors: 4, directUp: 4 }, hand: [] };
        const join = opts.mode === 'join';
        return {
            key: 'who',
            title: join ? t.joinSelectTitle : t.selectTitle,
            sub: join ? `${name} · ${t.stepWho}` : `${name} · ${t.stepOf(2, 3, t.stepWho)}`,
            back: join ? t.joinWhatStep : undefined,
            render: (view) => this.renderStructureWho(view, who, opts),
        };
    },

    renderStructureWho(view: StructureView, who: WhoState, opts: StructureWhoOptions): void {
        const { body, footer, signal } = view;
        const t = strings.structure;
        ensureFamilyPagesAppCss();
        const viewReady = viewCutReady();
        if (!who.kind) who.kind = viewReady ? 'view' : 'rod';
        if (!who.personId) who.personId = realPerson(TreeRenderer.getFocusPersonId())?.id ?? null;

        const root = el('div', 'structure-who');
        const nav = el('div', 'structure-who-nav');
        const head = el('div', 'structure-who-head', t.whoHeading);
        head.id = 'structure-who-head';
        const tabs = el('div', 'structure-who-tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-orientation', 'vertical');
        tabs.setAttribute('aria-labelledby', head.id);
        nav.append(head, tabs);
        const pane = el('div', 'structure-who-pane');
        pane.id = 'structure-who-pane';
        pane.setAttribute('role', 'tabpanel');
        const content = el('div', 'structure-who-content');
        const chosen = el('div', 'structure-who-chosen');
        chosen.setAttribute('role', 'status');
        pane.append(content, chosen);
        root.append(nav, pane);
        body.appendChild(root);

        const go = footerButton(opts.mode === 'join' ? t.continueGuide : strings.buttons.continue, 'primary', () => {
            const result = current();
            if (!result || result.ids.size === 0) return;
            if (opts.onDone) opts.onDone(result);
            else this.structureGo(this.structureSummaryStep({ kind: 'selection', ids: result.ids, what: result.what }));
        });
        go.dataset.action = 'continue';
        footer.append(footerButton(strings.structure.back, 'secondary', () => this.structureBack()), go);

        // Pickers to put away when the step is left.
        const cleanups: Array<() => void> = [];
        const cleanup = (): void => { while (cleanups.length) cleanups.pop()!(); };
        signal.addEventListener('abort', cleanup, { once: true });

        const { index, labels } = selectionIndex();
        const data = index.data;
        const idsOf = (ref: SelectionRef): Set<PersonId> => realIds(selectionPersonIds(data, index, ref) ?? []);

        /** The selection now: the people and what they are; null while nothing is chosen. */
        const current = (): StructureWhoResult | null => {
            const kind = who.kind!;
            const person = realPerson(who.personId);
            switch (kind) {
                case 'view':
                    return viewReady ? { kind, ids: realIds(TreeRenderer.getVisiblePersonIds()), what: t.whatView } : null;
                case 'rod': {
                    if (!who.rodId) return null;
                    const label = labels.get(who.rodId as never) ?? who.rodId;
                    return { kind, ids: idsOf({ kind: 'rod', rodId: who.rodId as never }), what: t.whatRod(label) };
                }
                case 'list': {
                    if (!who.list) return null;
                    const [k, ...rest] = who.list.split(':');
                    const id = rest.join(':');
                    if (k === 'line') {
                        const line = selectionLines(data, researchTableLive().places, null).find(l => l.id === id);
                        return { kind, ids: idsOf({ kind: 'line', directionId: id }), what: t.whatList(line?.name || id) };
                    }
                    const list = DataManager.getPersonLists().find(l => l.id === id);
                    if (!list) return null;
                    return { kind, ids: idsOf({ kind: 'list', listId: id }), what: t.whatList(listDisplayName(list)) };
                }
                case 'ancestors':
                case 'descendants': {
                    if (!person) return null;
                    const g = who.gen[kind];
                    const ref: SelectionRef = { kind, personId: person.id, ...(g ? { generations: g } : {}) };
                    return { kind, ids: idsOf(ref), what: kind === 'ancestors' ? t.whatAncestors(shownName(person), g) : t.whatDescendants(shownName(person), g) };
                }
                case 'direct': {
                    if (!person) return null;
                    // A line straight up and down (spec 137 K1.2): ancestors ∪ descendants, no siblings.
                    const up = who.gen.directUp, down = who.gen.directDown;
                    const ids = idsOf({ kind: 'ancestors', personId: person.id, ...(up ? { generations: up } : {}) });
                    for (const id of idsOf({ kind: 'descendants', personId: person.id, ...(down ? { generations: down } : {}) })) ids.add(id);
                    return { kind, ids, what: t.whatDirect(shownName(person)) };
                }
                case 'hand': {
                    const ids = realIds(who.hand);
                    return ids.size ? { kind, ids, what: t.whatHand(ids.size) } : null;
                }
            }
        };

        const sync = (): void => {
            const result = current();
            const n = result?.ids.size ?? 0;
            chosenInto(chosen, result && n > 0 ? `${result.what} · ${strings.treeManager.persons(n)}` : null);
            go.disabled = !result || n === 0;
        };

        // ---- The tabs ----
        const tabButtons: HTMLButtonElement[] = [];
        for (const kind of WHO_KINDS) {
            const tab = el('button', 'sel-tab');
            tab.type = 'button';
            tab.id = `structure-who-tab-${kind}`;
            tab.dataset.selDir = 'side';
            tab.dataset.kind = kind;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', pane.id);
            tab.insertAdjacentHTML('afterbegin', kindIcon(kind));
            tab.appendChild(el('span', undefined, t.kind[kind]));
            if (kind === 'view' && !viewReady) {
                tab.setAttribute('aria-disabled', 'true');
                tab.setAttribute('aria-describedby', 'structure-who-view-why');
            }
            tab.addEventListener('click', () => {
                if (tab.getAttribute('aria-disabled') === 'true') return;
                show(kind);
            });
            tabButtons.push(tab);
            tabs.appendChild(tab);
            if (kind === 'view' && !viewReady) {
                const why = el('span', 'structure-who-why', t.viewOnlyFamily);
                why.id = 'structure-who-view-why';
                tabs.appendChild(why);
            }
        }
        // ↑ ↓ Home End move and choose (a greyed tab is skipped).
        tabs.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            const live = tabButtons.filter(b => b.getAttribute('aria-disabled') !== 'true');
            const at = live.findIndex(b => b.dataset.kind === who.kind);
            const to = e.key === 'Home' ? live[0] : e.key === 'End' ? live[live.length - 1]
                : live[(at + (e.key === 'ArrowDown' ? 1 : live.length - 1)) % live.length];
            if (!to) return;
            e.preventDefault();
            show(to.dataset.kind as StructureWhoKind);
            to.focus();
        });

        const show = (kind: StructureWhoKind): void => {
            cleanup();
            who.kind = kind;
            for (const tab of tabButtons) {
                const on = tab.dataset.kind === kind;
                tab.setAttribute('aria-selected', String(on));
                tab.tabIndex = on ? 0 : -1;
            }
            pane.setAttribute('aria-labelledby', `structure-who-tab-${kind}`);
            pane.dataset.kind = kind;
            content.replaceChildren();
            switch (kind) {
                case 'view': paneView(); break;
                case 'rod': paneRod(); break;
                case 'list': paneList(); break;
                case 'ancestors': case 'descendants': panePerson(kind); break;
                case 'direct': panePerson('direct'); break;
                case 'hand': paneHand(); break;
            }
            sync();
        };

        // ---- The panes ----
        const paneView = (): void => {
            content.appendChild(el('p', 'structure-who-lead', t.viewOnScreen));
            const focus = realPerson(TreeRenderer.getFocusPersonId());
            const mode = TreeRenderer.getViewMode();
            const desc = el('p', 'structure-who-view');
            desc.appendChild(el('span', 'structure-who-view-name', strings.viewModeSwitch[mode] ?? mode));
            if (focus) desc.append(' · ', el('span', 'structure-who-view-person', shownName(focus)));
            content.appendChild(desc);
        };

        /** A searchable list of rows; a click chooses the row's `data-sel`. */
        const searchList = (placeholder: string, html: string, none: string, pick: (sel: string) => void): HTMLElement => {
            const q = el('input', 'sp-rodpick-q');
            q.type = 'search';
            q.placeholder = placeholder;
            q.setAttribute('aria-label', placeholder);
            q.autocomplete = 'off';
            q.spellcheck = false;
            const wrap = el('div', 'sp-selpick structure-who-list');
            const ul = el('ul', 'sp-rodpick-list');
            ul.innerHTML = html;
            const empty = el('p', 'structure-who-none', none);
            empty.hidden = true;
            wrap.append(ul, empty);
            content.append(q, wrap);
            const rows = () => [...ul.querySelectorAll<HTMLLIElement>(':scope > li')];
            const filter = (): void => {
                const key = rodPickKey(q.value.trim());
                let shown = 0;
                for (const li of rows()) {
                    if (li.classList.contains('sp-selpick-sh')) continue;
                    if (li.classList.contains('sp-rodpick-other')) { li.hidden = !!key; if (!li.hidden) shown++; continue; }
                    const r = li.dataset.q;
                    // The small lines unfold with "Other families ▸"; a query finds them too.
                    const small = li.classList.contains('sp-rodpick-small');
                    const unfolded = ul.dataset.other === 'open';
                    const match = r !== undefined && (!key || r.includes(key));
                    li.hidden = !(key ? match : (!small || unfolded));
                    if (!li.hidden && match) shown++;
                }
                // A section's head only over rows shown.
                for (const sh of ul.querySelectorAll<HTMLLIElement>(':scope > li.sp-selpick-sh')) {
                    let next = sh.nextElementSibling as HTMLLIElement | null;
                    let any = false;
                    while (next && !next.classList.contains('sp-selpick-sh')) { if (!next.hidden) any = true; next = next.nextElementSibling as HTMLLIElement | null; }
                    sh.hidden = !any;
                }
                empty.hidden = shown > 0;
            };
            q.addEventListener('input', filter);
            ul.addEventListener('click', (e) => {
                const x = (e.target as HTMLElement).closest('button.sp-rodpick-x');
                if (x) {
                    const open = ul.dataset.other !== 'open';
                    ul.dataset.other = open ? 'open' : '';
                    x.setAttribute('aria-expanded', String(open));
                    filter();
                    return;
                }
                const li = (e.target as HTMLElement).closest<HTMLLIElement>('li[data-sel]');
                if (!li) return;
                for (const r of rows()) {
                    const on = r === li;
                    r.classList.toggle('is-cur', on);
                    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
                }
                pick(li.dataset.sel!);
                sync();
            });
            filter();
            return q;
        };

        const paneRod = (): void => {
            const lang = getCurrentLanguage();
            const items = rodPickerItems(index, undefined, undefined, lang);
            const small = rodPickerSmallItems(index, lang);
            const span = Math.max(1, AXIS_HI - AXIS_LO);
            const rodIc = `<span class="sp-selpick-ic" aria-hidden="true">${selectionIcon('rod')}</span>`;
            const row = (item: RodPickerItem, cls: string, hidden: boolean): string => {
                const on = item.id === who.rodId;
                const bar = cls === 'sp-rodpick-rod'
                    ? (item.from !== null && item.to !== null
                        ? `<span class="sp-rodpick-bar" aria-hidden="true"><span style="left:${((item.from - AXIS_LO) / span * 100).toFixed(1)}%;width:${Math.max(2, (item.to - item.from) / span * 100).toFixed(1)}%"></span></span>`
                        : '<span class="sp-rodpick-bar" aria-hidden="true"></span>')
                    : '';
                const years = cls === 'sp-rodpick-small' && item.from !== null && item.to !== null
                    ? ` <span class="sp-rodpick-sub">${item.from === item.to ? item.from : `${item.from}–${item.to}`}</span>` : '';
                return `<li class="${cls} sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-rod="${esc(item.id)}" data-sel="${esc(item.id)}"`
                    + ` data-q="${esc(rodPickKey([item.label, ...item.forms].join(' ')))}"${on ? ' aria-current="true"' : ''}${hidden ? ' hidden' : ''}>`
                    + `<button type="button" class="sp-rodpick-a">${cls === 'sp-rodpick-rod' ? rodIc : ''}<span class="sp-rodpick-n">${esc(item.label)}${years}</span>${bar}`
                    + `<span class="sp-rodpick-c">${countText(item.members)}</span></button></li>`;
            };
            let html = items.filter(i => i.id !== 'tree' && i.id !== 'other').map(i => row(i, 'sp-rodpick-rod', false)).join('');
            const other = items.find(i => i.id === 'other');
            if (other && small.length) {
                html += `<li class="sp-rodpick-other sel-opt" data-sel-form="row"><button type="button" class="sp-rodpick-x" aria-expanded="false">`
                    + `<span class="sp-selpick-ic" aria-hidden="true"></span><span class="sp-rodpick-n">${esc(strings.familyPages.otherFams)} <span class="sp-rodpick-xchev" aria-hidden="true">▸</span></span>`
                    + `<span class="sp-rodpick-c">${countText(other.members)}</span></button></li>`;
                html += small.map(s => row(s, 'sp-rodpick-small', true)).join('');
            }
            const q = searchList(strings.familyPages.rodPickPh, html, strings.selection.noMatch.rods, sel => { who.rodId = sel; });
            // A chosen small line stays shown when the step comes back.
            const ul = content.querySelector<HTMLElement>('.sp-rodpick-list');
            if (ul && who.rodId && small.some(s => s.id === who.rodId)) {
                ul.dataset.other = 'open';
                ul.querySelector('button.sp-rodpick-x')?.setAttribute('aria-expanded', 'true');
                q.dispatchEvent(new Event('input'));
            }
        };

        const paneList = (): void => {
            const lines: ListRow[] = selectionLines(data, researchTableLive().places, null).map(l => {
                const name = l.name || l.id;
                return { sel: `line:${l.id}`, label: name, sub: strings.selection.lineSub, icon: selectionIcon('line'),
                    count: idsOf({ kind: 'line', directionId: l.id }).size, q: rodPickKey(name) };
            });
            const fixed: ListRow[] = [];
            const auto: ListRow[] = [];
            for (const l of DataManager.getPersonLists()) {
                const kind = listKind(l);
                const name = listDisplayName(l);
                const sub = kind === 'auto' && l.rule ? ruleLabel(l.rule, index) : strings.lists.kind[kind];
                const r: ListRow = { sel: `list:${l.id}`, label: name, sub, icon: listKindIcon(kind, 15),
                    count: idsOf({ kind: 'list', listId: l.id }).size, q: rodPickKey(name) };
                (kind === 'auto' ? auto : fixed).push(r);
            }
            const rowHtml = (r: ListRow): string => {
                const on = r.sel === who.list;
                return `<li class="sp-selpick-row sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-sel="${esc(r.sel)}" data-q="${esc(r.q)}"${on ? ' aria-current="true"' : ''}>`
                    + `<button type="button" class="sp-rodpick-a"><span class="sp-selpick-ic" aria-hidden="true">${r.icon}</span>`
                    + `<span class="sp-rodpick-n">${esc(r.label)}<small class="sp-selpick-sub">${esc(r.sub)}</small></span>`
                    + `<span class="sp-rodpick-c">${countText(r.count)}</span></button></li>`;
            };
            const section = (title: string, rows: ListRow[]): string => rows.length
                ? `<li class="sp-selpick-sh" role="presentation"><span>${esc(title)}</span></li>${rows.map(rowHtml).join('')}` : '';
            const html = section(t.listsFixed, fixed) + section(t.listsAuto, auto) + section(strings.selection.secLines, lines);
            const none = fixed.length + auto.length + lines.length ? strings.selection.noMatch.lists : strings.selection.noLists;
            searchList(t.searchList, html, none, sel => { who.list = sel; });
        };

        const panePerson = (kind: 'ancestors' | 'descendants' | 'direct'): void => {
            const block = el('div', 'structure-who-person');
            block.appendChild(el('span', 'structure-who-label', t.personLabel));
            const rowHost = el('div', 'structure-who-prow');
            block.appendChild(rowHost);
            content.appendChild(block);
            const drawRow = (): void => {
                rowHost.replaceChildren();
                const person = realPerson(who.personId);
                if (person) {
                    const text = el('div', 'structure-who-ptext');
                    text.appendChild(el('div', 'structure-who-pname', shownName(person)));
                    const sub = [yearsOf(person), person.id === TreeRenderer.getFocusPersonId() ? strings.selection.focusSub : ''].filter(Boolean).join(' · ');
                    if (sub) text.appendChild(el('div', 'structure-who-pyears', sub));
                    const change = el('button', 'link-button', strings.selection.changePerson);
                    change.type = 'button';
                    change.dataset.action = 'changePerson';
                    change.addEventListener('click', () => drawPicker());
                    rowHost.append(text, change);
                } else {
                    drawPicker();
                }
            };
            const drawPicker = (): void => {
                rowHost.replaceChildren();
                const host = el('div', 'structure-who-picker');
                host.id = 'structure-who-picker';
                rowHost.appendChild(host);
                const picker = new PersonPicker({
                    containerId: host.id,
                    persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder),
                    onSelect: (id) => {
                        who.personId = id;
                        picker.destroy();
                        drawRow();
                        sync();
                    },
                });
                cleanups.push(() => picker.destroy());
                picker.focusInput();
            };
            drawRow();
            const steppers = el('div', 'structure-who-steppers');
            const keys: Array<[keyof WhoState['gen'], string]> = kind === 'direct'
                ? [['directUp', t.genAncestors], ['directDown', t.genDescendants]]
                : [[kind, strings.selection.generations]];
            const drawSteppers = (): void => {
                steppers.innerHTML = keys.map(([key, label]) => stepperHtml(label, key, who.gen[key])).join('');
            };
            steppers.addEventListener('click', (e) => {
                const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button.depth-stepper-btn');
                const key = btn?.closest<HTMLElement>('[data-stepper]')?.dataset.stepper as keyof WhoState['gen'] | undefined;
                if (!btn || !key || btn.disabled) return;
                who.gen[key] = stepGen(who.gen[key], Number(btn.dataset.gen));
                drawSteppers();
                steppers.querySelector<HTMLButtonElement>(`[data-stepper="${key}"] button[data-gen="${btn.dataset.gen}"]:not(:disabled)`)?.focus();
                sync();
            });
            drawSteppers();
            content.appendChild(steppers);
            if (kind === 'direct') content.appendChild(el('p', 'structure-who-note', t.directNote));
        };

        const paneHand = (): void => {
            const host = el('div', 'structure-who-hand');
            content.appendChild(host);
            const picker = new MultiPersonPicker({
                container: host,
                multi: true,
                persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder),
                max: Infinity,
                initial: who.hand,
                onChange: (ids) => { who.hand = ids; sync(); },
                noneLabel: strings.materials.noneChosen,
                removeLabel: strings.materials.removePerson,
            });
            cleanups.push(() => picker.destroy());
        };

        show(who.kind);
        tabButtons.find(b => b.dataset.kind === who.kind)?.focus({ preventScroll: true });
    },

    // ---- The summary (§4) ----

    /** The summary of a new tree from a selection of the open tree (step 3 of 3). */
    structureSummaryStep(input: StructureSummaryInput): StructureStep {
        const open = structureOpenFor();
        const name = open ? TreeManager.getTreeMetadata(open.treeId)?.name ?? '' : '';
        const t = strings.structure;
        // The name typed stays when the step comes back.
        const typed: { name: string | null } = { name: null };
        if (input.kind === 'copy') {
            return {
                key: 'summary',
                title: t.optCopy,
                sub: `${name} · ${t.stepSummary}`,
                render: (view) => this.renderStructureSummary(view, input, typed),
            };
        }
        return {
            key: 'summary',
            title: t.selectTitle,
            sub: `${name} · ${t.stepOf(3, 3, t.stepSummary)}`,
            back: t.whoHeading,
            render: (view) => this.renderStructureSummary(view, input, typed),
        };
    },

    /** Copy of the whole tree: its summary with the name (in place of the old naming dialog). */
    structureCopyStep(): StructureStep {
        return this.structureSummaryStep({ kind: 'copy' });
    },

    async renderStructureSummary(view: StructureView, input: StructureSummaryInput, typed: { name: string | null }): Promise<void> {
        const { treeId, body, footer, signal } = view;
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        const t = strings.structure;
        const copy = input.kind === 'copy';
        const wrap = el('div', 'structure-summary');
        body.appendChild(wrap);

        const lead = el('p', 'structure-lead', copy ? t.copyLead(tree.name) : t.summaryLead(input.what));
        lead.id = 'structure-summary-lead';
        const stats = el('div', 'structure-stats');
        stats.setAttribute('role', 'group');
        stats.setAttribute('aria-labelledby', lead.id);
        const stat = (key: string, label: (n: number) => string): { set(n: number | null): void } => {
            const box = el('div', 'structure-stat');
            box.dataset.stat = key;
            const num = el('b');
            const word = el('span');
            box.append(num, word);
            stats.appendChild(box);
            return {
                set(n) {
                    box.classList.toggle('is-wait', n === null);
                    num.textContent = n === null ? '…' : countText(n);
                    word.textContent = label(n ?? 0);
                },
            };
        };
        const statPersons = stat('persons', t.statPersons);
        const statCouples = stat('couples', t.statCouples);
        const statSources = stat('sources', t.statSources);
        const statImages = stat('images', t.statImages);
        const progress = el('div', 'structure-progress');
        const islands = el('div', 'structure-islands');
        islands.hidden = true;
        wrap.append(lead, stats, progress, islands);

        // The name: its default, the hint when another tree has it (not refused: two trees may share a name).
        const names = TreeManager.getTrees().map(x => x.name);
        const field = el('div', 'form-group structure-name');
        const label = el('label', undefined, strings.treeManager.newTreeNameLabel);
        label.htmlFor = 'structure-name';
        const nameInput = el('input');
        nameInput.type = 'text';
        nameInput.id = 'structure-name';
        nameInput.autocomplete = 'off';
        nameInput.setAttribute('aria-describedby', 'structure-name-taken');
        nameInput.value = typed.name ?? (copy ? freeCopyName(tree.name, names) : t.defaultName(tree.name, input.what));
        const taken = el('p', 'field-hint duplicate-name-taken');
        taken.id = 'structure-name-taken';
        taken.setAttribute('aria-live', 'polite');
        const check = (): void => {
            typed.name = nameInput.value;
            taken.textContent = treeNameTaken(nameInput.value, names) ? strings.treeManager.duplicateNameTaken : '';
        };
        nameInput.addEventListener('input', check);
        check();
        field.append(label, nameInput, taken);
        wrap.append(field, el('p', 'structure-note', copy ? t.copyKeepNote : t.keepNote));

        let summary: Pick<SubsetSummary, 'persons'> | null = null;
        const create = footerButton(copy ? t.createCopy : t.create, 'primary', () => void submit());
        create.dataset.action = 'create';
        footer.append(footerButton(strings.structure.back, 'secondary', () => this.structureBack()), create);
        nameInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            void submit();
        });
        const submit = async (): Promise<void> => {
            const value = nameInput.value.trim();
            if (!value) { nameInput.focus(); return; }
            if (create.disabled || !summary) return;
            if (copy) await this.structureCreateCopy(treeId, value, create);
            else await this.createTreeFromSelection(treeId, input.ids, value, input.what, create);
        };
        nameInput.focus({ preventScroll: true });
        nameInput.select();

        // ---- The count ----
        const fill = (s: Pick<SubsetSummary, 'persons' | 'couples' | 'sources' | 'images'>): void => {
            statPersons.set(s.persons);
            statCouples.set(s.couples);
            statSources.set(s.sources);
            statImages.set(s.images);
        };
        if (copy) {
            // The button waits for the tree's sources and images (a tree not open is read first).
            create.disabled = true;
            const data = treeId === DataManager.getCurrentTreeId() ? DataManager.getData() : await TreeManager.getTreeData(treeId);
            if (signal.aborted) return;
            const counts = data ? summarizeCopy(data) : { sources: 0, images: 0 };
            fill({ persons: tree.personCount, couples: tree.partnershipCount, ...counts });
            summary = { persons: tree.personCount };
            create.disabled = false;
            return;
        }
        const data = DataManager.getData();
        const large = input.ids.size >= SPLIT_SHOWN_AT_ONCE || tree.personCount >= SPLIT_SHOWN_AT_ONCE;
        if (!large) {
            const s = summarizeSubset(data, input.ids);
            fill(s);
            this.structureIslands(islands, s.islands);
            summary = s;
            return;
        }
        // A large selection: in batches, the numbers "…" until the end, the create button disabled meanwhile.
        for (const s of [statPersons, statCouples, statSources, statImages]) s.set(null);
        const status = el('span');
        status.setAttribute('role', 'status');
        const busyRow = el('span', 'busy structure-counting');
        busyRow.append(spinEl(), status);
        // The app's one progress bar (src/ui/prog-bar.ts).
        const bar = barEl(0, { cls: 'structure-bar' });
        progress.append(busyRow, bar, el('p', 'structure-note structure-images-note', t.imagesNotLoaded));
        create.disabled = true;
        const steps = summarizeSubsetSteps(data, input.ids);
        const result = await computeUnder(create, async () => {
            for (;;) {
                if (signal.aborted) return null;
                const next = steps.next();
                if (next.done) return next.value;
                status.textContent = t.counting(next.value.done, next.value.total);
                setBarShare(bar, next.value.done / Math.max(1, next.value.total));
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }, { label: strings.busy.generic, atOnce: true });
        if (signal.aborted || !result) return;
        progress.replaceChildren();
        fill(result);
        this.structureIslands(islands, result.islands);
        summary = result;
        create.disabled = false;
    },

    /** The separate parts: the heading, the sentence and the names (drawn when unfolded). */
    structureIslands(host: HTMLElement, people: readonly SubsetIslandPerson[]): void {
        host.replaceChildren();
        host.hidden = people.length === 0;
        if (!people.length) return;
        const t = strings.structure;
        host.append(el('h3', 'structure-h3', t.islandsHead), el('p', 'structure-note', t.islands(people.length)));
        const details = el('details', 'structure-names');
        const summary = el('summary', undefined, t.showNames(people.length));
        details.appendChild(summary);
        details.addEventListener('toggle', () => {
            summary.textContent = details.open ? t.hideNames : t.showNames(people.length);
            if (!details.open || details.querySelector('ul')) return;
            const ul = el('ul');
            for (const { id, via } of people) {
                const p = realPerson(id);
                if (!p) continue;
                const li = el('li');
                const viaP = realPerson(via);
                const rest = [yearsOf(p), viaP ? t.islandVia(shownName(viaP)) : ''].filter(Boolean).join(' · ');
                li.append(el('span', 'structure-names-n', shownName(p)));
                if (rest) li.append(' ', el('span', 'structure-names-s', rest));
                ul.appendChild(li);
            }
            details.appendChild(ul);
        });
        host.appendChild(details);
    },

    /**
     * A new tree of the selection `ids` of the open tree `treeId`, named
     * `name`: the people with the glue partners (extractSubtree), opened, and
     * a toast with the way back. It names the tree it was made of
     * (fromTree) and is never tied to a research (K2.4).
     */
    async createTreeFromSelection(treeId: TreeId, ids: ReadonlySet<PersonId>, name: string, what: string, btn?: HTMLElement | null): Promise<TreeId | null> {
        const origin = TreeManager.getTreeMetadata(treeId);
        if (!origin || treeId !== DataManager.getCurrentTreeId()) return null;
        const subtree = extractSubtree(DataManager.getData(), new Set(ids));
        const newId = await busyLocal(btn ?? null, strings.busy.creating,
            () => DataManager.importAsNewTree(subtree, name, { fromTree: { treeId, name: origin.name, what } }),
            () => ({ ok: false, kind: 'error', text: strings.busy.failed }));
        if (!newId) return null;
        const open = structureOpenFor();
        this.closeStructureDialog(false);
        if (open?.parent === 'tree-manager-modal') this.closeTreeManagerDialog();
        this.showImportedTree(newId);
        const n = TreeManager.getTreeMetadata(newId)?.personCount ?? 0;
        showToast(strings.structure.createdToast(name, n), 10000, {
            closable: true,
            notice: true,
            action: { label: strings.structure.backTo(origin.name), run: () => { void this.switchToTree(treeId); } },
        });
        return newId;
    },

    /** A copy of the whole tree named `name` (copyOf, no research); the dialog it came from comes back. */
    async structureCreateCopy(treeId: TreeId, name: string, btn: HTMLElement): Promise<TreeId | null> {
        const copied = await busyLocal(btn, strings.busy.saving, () => TreeManager.duplicateTree(treeId, name),
            () => ({ ok: false, kind: 'error', text: strings.busy.failed }));
        if (!copied) return null;
        this.closeStructureDialog();
        this.updateTreeManagerList();
        this.updateTreeSwitcher();
        return copied;
    },
});
