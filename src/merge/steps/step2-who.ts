/**
 * Step 2 – Who is who (spec 134 §4, frames 2, 4b, 4c, 4e).
 *
 * Left (300 px): the groups Maybe the same · The same · New with their
 * counts, a search and the list of pairs, each row with its fate as a glyph
 * (✓ joined, + new, ⊘ not added, ? to decide). Right: the chosen pair side by
 * side (name, birth, death, parents, partners, children, records; a row
 * that differs on a soft warning ground, joined relatives with ✓), why yes
 * and what speaks against, the decisions with their keys and, for the pairs
 * still to decide, the undecided rest at once. No other window opens for a
 * decision; "Another person…" picks the tree's person in its own dialog.
 *
 * The step keeps no state of the merge: the decisions go through the
 * facade (`Step2Env`), the guide draws the step again. What is chosen in the
 * view (group, pair, search, the candidate, the ticked joins) is the view's,
 * kept per merge state.
 */

import { strings } from '../../strings.js';
import type { MergeState, PersonMatch, MatchDecision, MatchReason } from '../types.js';
import type { Partnership, Person, PersonId, StromData } from '../../types.js';
import { AUTO_CONFIRM_SCORE, existingTargetOf } from '../executor.js';
import { candidatesFor, timeConflict, type MatchCandidateInfo } from '../matching.js';
import { bringsNothingNew, planFates, type MergePlan, type PersonFate } from '../plan.js';
import type { StepContext, Step2Env, PairDecision } from './context.js';
import { escapeHtml, glyph, stepHeading } from './context.js';
import { shownName } from '../../person-name.js';
import { formatFlexDate, yearOf } from '../../dates.js';
import { personSourceRows } from '../../person-sources.js';
import { factReliability, reliabilityOptionsOf } from '../../reliability.js';
import { factReliabilityHtml } from '../../ui/fact-status.js';
import { SettingsManager } from '../../settings.js';
import { busyButtonHtml } from '../../ui/busy.js';
import { isPhoneBar, MQ_PHONE_BAR } from '../../breakpoints.js';

export type PairGroup = 'maybe' | 'same' | 'new';

/** One row of the list: an import's person with its pair (none for a new one). */
export interface PairRow {
    id: PersonId;
    group: PairGroup;
    match: PersonMatch | null;
}

/** What the view holds of one merge (not saved: the decisions are the state's). */
interface PairView {
    group: PairGroup | null;
    selected: PersonId | null;
    query: string;
    /** The candidate chosen for a pair with several (rámec 4b). */
    cand: Map<PersonId, PersonId>;
    /** The joins ticked in The same. */
    checked: Set<PersonId>;
    /** After a decision: the next pair to decide after this one. */
    advanceFrom: PersonId | null;
    /** The decision came from the step: its row takes the focus again. */
    focusRow: boolean;
    /** "To decide N" chosen (K10.5): with the list hidden, the pair takes the focus instead of its row. */
    focusPair: boolean;
    scrollTop: number;
    /** The undecided pairs whose offer the last decision changed (K3.3). */
    recalc: PersonId[];
    /** The list shows only those (Show). */
    onlyRecalc: boolean;
    /** A phone: the pair's column shown (§14, 14b), and the list open as a sheet. */
    side: 'tree' | 'import';
    listOpen: boolean;
    /**
     * A copy of the tree (13b): the comparison shown on Show the comparison.
     * Also set by any decision made in the list: the sentence stands only
     * right after the comparison, never in place of the list being worked in.
     */
    showCopy: boolean;
    /** A wider window (dotaz 10, 4h): the list of pairs folded to a rail; kept until the guide closes, never saved. */
    pairsHidden: boolean;
    /** The pair whose records are shown whole ("2 more ▸", 4f); one pair at a time. */
    recordsOpen: PersonId | null;
}

const views = new WeakMap<MergeState, PairView>();

function viewOf(state: MergeState): PairView {
    let v = views.get(state);
    if (!v) {
        v = {
            group: null, selected: null, query: '', cand: new Map(), checked: new Set(), advanceFrom: null, focusRow: false, focusPair: false, scrollTop: 0,
            recalc: [], onlyRecalc: false, side: 'tree', listOpen: false, showCopy: false, pairsHidden: false, recordsOpen: null,
        };
        views.set(state, v);
    }
    return v;
}

/**
 * After a decision: the undecided pairs whose offer it changed (K3.3), said
 * under the decisions until the next one; Show filters the list to them.
 */
export function noteRecalc(state: MergeState, changed: readonly PersonId[]): void {
    const view = viewOf(state);
    view.recalc = [...changed];
    view.onlyRecalc = false;
}

/** The import's persons in the three groups, in the matching's order ("?" stand-ins go with their named partner). */
export function pairRows(state: MergeState): PairRow[] {
    const rows: PairRow[] = [];
    const seen = new Set<PersonId>();
    for (const m of state.matches) {
        const p = state.incomingData.persons[m.incomingId];
        if (!p || p.isPlaceholder || seen.has(m.incomingId)) continue;
        seen.add(m.incomingId);
        rows.push({ id: m.incomingId, group: m.score >= AUTO_CONFIRM_SCORE ? 'same' : 'maybe', match: m });
    }
    for (const id of state.unmatchedIncoming) {
        const p = state.incomingData.persons[id];
        if (!p || p.isPlaceholder || seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, group: 'new', match: null });
    }
    return rows;
}

/** The group shown first: Maybe the same when there are any, otherwise The same, otherwise New. */
export function defaultGroup(rows: readonly PairRow[]): PairGroup {
    if (rows.some(r => r.group === 'maybe')) return 'maybe';
    if (rows.some(r => r.group === 'same')) return 'same';
    return 'new';
}

/** The pairs still to decide in the plan (K10.5): offered below the joining score, nobody decided (a person of an undecided unlinked group is step 3's). */
export function pendingPairs(plan: MergePlan | null): Set<PersonId> {
    const out = new Set<PersonId>();
    if (plan) for (const i of plan.items) if (i.kind === 'person-pending') out.add(i.id);
    return out;
}

/** The first pair still to decide (K10.5): in Maybe the same first, in the list's order. Null when none waits. */
export function firstPending(rows: readonly PairRow[], pending: ReadonlySet<PersonId>): PairRow | null {
    const waiting = rows.filter(r => pending.has(r.id));
    return waiting.find(r => r.group === 'maybe') ?? waiting[0] ?? null;
}

/**
 * Where step 2 opens (K10.5): on Maybe the same at its first undecided pair
 * when one waits there; otherwise the group shown last (the default one the
 * first time) and its pair, as they were.
 */
export function openingView(rows: readonly PairRow[], pending: ReadonlySet<PersonId>,
    group: PairGroup | null, selected: PersonId | null): { group: PairGroup; selected: PersonId | null } {
    const first = rows.find(r => r.group === 'maybe' && pending.has(r.id));
    if (first) return { group: 'maybe', selected: first.id };
    return { group: group ?? defaultGroup(rows), selected };
}

/** The tree's person a row stands against now: the hand-picked one, else the offered one. */
function treePersonOf(state: MergeState, row: PairRow): PersonId | null {
    const d = state.decisions.get(row.id);
    if (d?.type === 'manual_match') return d.targetId;
    return row.match?.existingId ?? null;
}

type DecKind = 'same' | 'new' | 'other' | 'skip';

/** Which decision stands on a row (null: none yet). */
export function decisionKind(state: MergeState, row: PairRow): DecKind | null {
    const d: MatchDecision | undefined = state.decisions.get(row.id);
    if (d?.type === 'skip') return 'skip';
    if (d?.type === 'reject') return 'new';
    if (d?.type === 'confirm') return 'same';
    if (d?.type === 'manual_match') return row.match && row.match.existingId === d.targetId ? 'same' : 'other';
    if (row.group === 'same') return 'same';
    if (row.group === 'new') return 'new';
    return null;
}

const FATE_GLYPH: Record<PersonFate, string> = {
    joined: glyph('joined', 12, 3),
    added: glyph('added', 12, 3),
    skipped: glyph('skipped', 12, 2.5),
    pending: '?',
};

function fateLabel(fate: PersonFate): string {
    const W = strings.mergeWizard;
    return fate === 'joined' ? W.cntJoined : fate === 'added' ? W.cntNew : fate === 'skipped' ? W.cntSkipped : W.cntPending;
}

function yearText(p: Person | undefined): string {
    if (!p) return '';
    const y = yearOf(p.birthDate);
    return y === null ? '' : String(y);
}

/** A given name the file does not know ('' or "?"). */
function noGiven(p: Person): boolean {
    const g = (p.firstName ?? '').trim();
    return g === '' || g === '?';
}

function nameText(p: Person): string {
    return shownName(p, '?');
}

/** A row's name: serif, the year beside it; a person of no given name says so (4c). */
function nameHtml(p: Person, cls = 'merge-pn'): string {
    const missing = noGiven(p) ? ` <span class="merge-mut">${escapeHtml(strings.mergeWizard.noName)}</span>` : '';
    return `<span class="${cls}">${escapeHtml(nameText(p))}</span>${missing}`;
}

function matchesQuery(state: MergeState, row: PairRow, q: string): boolean {
    if (!q) return true;
    const names: string[] = [];
    const inc = state.incomingData.persons[row.id];
    if (inc) names.push(nameText(inc));
    const at = treePersonOf(state, row);
    const tree = at ? state.existingData.persons[at] : undefined;
    if (tree) names.push(nameText(tree));
    const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const needle = norm(q.trim());
    return names.some(n => norm(n).includes(needle));
}

// ==================== THE PAIR ====================

const partnerOf = (u: Partnership, id: PersonId): PersonId => u.person1Id === id ? u.person2Id : u.person1Id;

function partnersOf(p: Person, data: StromData): Array<{ id: PersonId; u: Partnership }> {
    return p.partnerships.map(id => data.partnerships[id]).filter((u): u is Partnership => !!u)
        .map(u => ({ id: partnerOf(u, p.id), u }));
}

/** The tree's ids the import's persons are joined with (for the ✓ beside a relative). */
function joinedTreeIds(state: MergeState, ids: readonly PersonId[]): Set<PersonId> {
    return new Set(ids.map(id => existingTargetOf(state, id)).filter((id): id is PersonId => !!id));
}

function lifeFact(p: Person | undefined, kind: 'birth' | 'death'): string {
    if (!p) return '';
    const date = kind === 'birth' ? p.birthDate : p.deathDate;
    const place = kind === 'birth' ? p.birthPlace : p.deathPlace;
    return [date ? formatFlexDate(date) : '', place ?? ''].filter(Boolean).join(', ');
}

/** The fact's pill of reliability (S7), only shown, nothing to click. */
function factMark(data: StromData, p: Person | undefined, fact: 'name' | 'birth' | 'death'): string {
    if (!p || !SettingsManager.isReliabilityCardEnabled()) return '';
    const opts = reliabilityOptionsOf(data, false, false);
    try {
        const r = factReliability(data, p, fact, opts);
        return r ? ` ${factReliabilityHtml(r, { inert: true, fact })}` : '';
    } catch {
        return '';
    }
}

const OK_MARK = `<span class="merge-ok" title="${'{t}'}">${glyph('joined', 11, 3)}</span>`;

function okMark(): string {
    return OK_MARK.replace('{t}', escapeHtml(strings.mergeWizard.cntJoined));
}

/** "Name, Name ✓" of relatives; `joined` marks those joined across the trees. */
function relativesHtml(ids: readonly PersonId[], data: StromData, joined: (id: PersonId) => boolean, max = 3): string {
    const names = ids.map(id => data.persons[id]).filter((p): p is Person => !!p);
    if (names.length === 0) return '—';
    const shown = names.slice(0, max).map(p => `${escapeHtml(nameText(p))}${joined(p.id) ? ` ${okMark()}` : ''}`);
    return names.length > max ? `${names.length}: ${shown.join(', ')}…` : shown.join(', ');
}

/** A relative's years ("1871–1933", "1873"); '' with none known. */
function lifeYears(p: Person): string {
    const by = yearOf(p.birthDate);
    const dy = yearOf(p.deathDate);
    if (by === null && dy === null) return '';
    return dy === null ? String(by) : `${by ?? ''}–${dy}`;
}

/** A wider window (4f): every relative on a line of its own, "Name (1871–1933) ✓". */
function relativeLinesHtml(ids: readonly PersonId[], data: StromData, joined: (id: PersonId) => boolean): string {
    const list = ids.map(id => data.persons[id]).filter((p): p is Person => !!p);
    if (list.length === 0) return '—';
    return list.map(p => {
        const years = lifeYears(p);
        return `<span class="ln">${escapeHtml(nameText(p))}${years ? ` (${escapeHtml(years)})` : ''}${joined(p.id) ? ` ${okMark()}` : ''}</span>`;
    }).join('');
}

function partnersHtml(p: Person, data: StromData, joined: (id: PersonId) => boolean, lines = false): string {
    const list = partnersOf(p, data).filter(x => data.persons[x.id] && !data.persons[x.id].isPlaceholder);
    if (list.length === 0) return '—';
    return list.map(({ id, u }) => {
        const y = yearOf(u.startDate);
        const name = `${escapeHtml(nameText(data.persons[id]))}${y !== null ? ` (${y})` : ''}`;
        const html = `${name}${joined(id) ? ` ${okMark()}` : ''}`;
        return lines ? `<span class="ln">${html}</span>` : html;
    }).join(lines ? '' : ', ');
}

/** How many records a wider window shows before "N more ▸" (4f). */
const RECORDS_SHOWN = 3;

function sourceRowsOf(data: StromData, p: Person): ReturnType<typeof personSourceRows> {
    try {
        return personSourceRows(data, p.id);
    } catch {
        return [];
    }
}

/** A wider window (4f): the first three records on lines, then "2 more ▸" (or all and Collapse). */
function recordLinesHtml(data: StromData, p: Person, open: boolean): string {
    const W = strings.mergeWizard;
    const rows = sourceRowsOf(data, p);
    if (rows.length === 0) return '—';
    const shown = open ? rows : rows.slice(0, RECORDS_SHOWN);
    const lines = shown.map(r => `<span class="ln">${escapeHtml(r.source.title || '?')}</span>`).join('');
    if (rows.length <= RECORDS_SHOWN) return lines;
    const label = open ? W.recordsLess : W.recordsMore(rows.length - RECORDS_SHOWN);
    return `${lines}<button type="button" class="link-button merge-records-more" aria-expanded="${open}">${escapeHtml(label)}</button>`;
}

function recordsHtml(data: StromData, p: Person): string {
    const rows = sourceRowsOf(data, p);
    if (rows.length === 0) return '—';
    const titles = rows.slice(0, 2).map(r => escapeHtml(r.source.title || '?'));
    return rows.length > 2 ? `${rows.length}: ${titles.join(', ')}…` : titles.join(', ');
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The grid of a pair (`tree` null: a new person, the import's column only). */
function pairGridHtml(state: MergeState, targetName: string, inc: Person, tree: Person | null, side: 'tree' | 'import' = 'tree',
    wide: { source: string; recordsOpen: boolean } | null = null): string {
    const W = strings.mergeWizard;
    const T = state.existingData;
    const F = state.incomingData;
    const [rName, rBirth, rDeath, rParents, rPartners, rChildren, rRecords] = W.rows;
    // The import's relatives as they stand in the tree, and the tree's own.
    const parentsIn = joinedTreeIds(state, inc.parentIds);
    const childrenIn = joinedTreeIds(state, inc.childIds);
    const partnersIn = joinedTreeIds(state, partnersOf(inc, F).map(x => x.id));
    const treeJoined = (set: Set<PersonId>) => (id: PersonId): boolean => set.has(id);
    const incJoined = (treeIds: readonly PersonId[]) => (id: PersonId): boolean => {
        const at = existingTargetOf(state, id);
        return !!at && treeIds.includes(at);
    };
    type Cell = { html: string; plain: string };
    const cells: Array<[string, Cell | null, Cell, boolean]> = [];
    const add = (label: string, a: Cell | null, b: Cell, diffable = false): void => {
        const diff = diffable && !!a && a.plain !== '' && b.plain !== '' && norm(a.plain) !== norm(b.plain);
        cells.push([label, a, b, diff]);
    };
    const cell = (html: string, plain: string): Cell => ({ html: html || '—', plain });
    add(rName,
        tree ? cell(nameHtml(tree) + factMark(T, tree, 'name'), noGiven(tree) ? '' : nameText(tree)) : null,
        cell(nameHtml(inc) + factMark(F, inc, 'name'), noGiven(inc) ? '' : nameText(inc)), true);
    add(rBirth,
        tree ? cell(escapeHtml(lifeFact(tree, 'birth')) + (lifeFact(tree, 'birth') ? factMark(T, tree, 'birth') : ''), lifeFact(tree, 'birth')) : null,
        cell(escapeHtml(lifeFact(inc, 'birth')) + (lifeFact(inc, 'birth') ? factMark(F, inc, 'birth') : ''), lifeFact(inc, 'birth')), true);
    add(rDeath,
        tree ? cell(escapeHtml(lifeFact(tree, 'death')) + (lifeFact(tree, 'death') ? factMark(T, tree, 'death') : ''), lifeFact(tree, 'death')) : null,
        cell(escapeHtml(lifeFact(inc, 'death')) + (lifeFact(inc, 'death') ? factMark(F, inc, 'death') : ''), lifeFact(inc, 'death')), true);
    // A wider window lists the relatives on lines and the records by three (4f); a phone keeps its short form.
    const rel = (ids: readonly PersonId[], data: StromData, joined: (id: PersonId) => boolean): string =>
        wide ? relativeLinesHtml(ids, data, joined) : relativesHtml(ids, data, joined);
    const rec = (data: StromData, p: Person): string => wide ? recordLinesHtml(data, p, wide.recordsOpen) : recordsHtml(data, p);
    add(rParents,
        tree ? cell(rel(tree.parentIds, T, treeJoined(parentsIn)), '') : null,
        cell(rel(inc.parentIds, F, tree ? incJoined(tree.parentIds) : () => false), ''));
    add(rPartners,
        tree ? cell(partnersHtml(tree, T, treeJoined(partnersIn), !!wide), '') : null,
        cell(partnersHtml(inc, F, tree ? incJoined(partnersOf(tree, T).map(x => x.id)) : () => false, !!wide), ''));
    add(rChildren,
        tree ? cell(rel(tree.childIds, T, treeJoined(childrenIn)), '') : null,
        cell(rel(inc.childIds, F, tree ? incJoined(tree.childIds) : () => false), ''));
    add(rRecords, tree ? cell(rec(T, tree), '') : null, cell(rec(F, inc), ''));

    const two = !!tree;
    // c1 = the tree's column, c2 = the import's (a phone shows one of them, 14b).
    const importHead = wide ? W.importCol(wide.source) : W.colImport;
    const head = `<div class="hd"></div>${two ? `<div class="hd c1">${escapeHtml(W.mine(targetName))}</div>` : ''}<div class="hd c2" title="${escapeHtml(importHead)}">${escapeHtml(importHead)}</div>`;
    const body = cells.map(([label, a, b, diff]) => {
        const x = diff ? ' x' : '';
        return `<div class="k">${escapeHtml(label)}</div>${two && a ? `<div class="v c1${x}">${a.html}</div>` : ''}<div class="v c2${x}">${b.html}</div>`;
    }).join('');
    const grid = `<div class="pair${two ? ` show-${side}` : ' is-one'}" role="table" aria-label="${escapeHtml(W.rows.join(' · '))}">${head}${body}</div>`;
    // A wider window: only the table scrolls, its head stays (4f).
    return wide ? `<div class="merge-pair-scroll">${grid}</div>` : grid;
}

function reasonText(reason: string): string {
    const r = (strings.merge as Record<string, unknown>).matchReasons as Record<string, string> | undefined;
    return r?.[reason] ?? reason.replace(/_/g, ' ');
}

/** What speaks against a pair: the differing details (tree → import) and another period. */
function againstLines(state: MergeState, inc: Person, tree: Person, match: PersonMatch | null): string[] {
    const out: string[] = [];
    const conflicts = match && match.existingId === tree.id ? match.conflicts : [];
    for (const c of conflicts) {
        const label = strings.labels[c.field as keyof typeof strings.labels] || String(c.field);
        out.push(c.field === 'photo'
            ? `${label}: ${strings.merge.photoConflict}`
            : `${label}: ${c.existingValue || '—'} → ${c.incomingValue || '—'}`);
    }
    if (timeConflict(tree, inc, state)) out.push(strings.mergeWizard.notFirstTime);
    return out;
}

const DEC_ORDER: DecKind[] = ['same', 'new', 'other', 'skip'];

function decLabel(kind: DecKind): string {
    const W = strings.mergeWizard;
    return kind === 'same' ? W.decSame : kind === 'new' ? W.decNew : kind === 'other' ? W.decOther : W.decSkip;
}

function decKey(kind: DecKind): string {
    return strings.mergeWizard.decKeys[DEC_ORDER.indexOf(kind)] ?? '';
}

/** The decisions a row offers: a new person cannot be "the same" (it has no pair). */
function decisionsOf(row: PairRow): DecKind[] {
    return row.group === 'new' ? ['new', 'other', 'skip'] : DEC_ORDER;
}

function keysHintHtml(): string {
    return escapeHtml(strings.mergeWizard.keysHint).replace(/[↑↓]/g, k => `<span class="kbd">${k}</span>`);
}

// ==================== RENDER ====================

interface Drawn {
    rows: PairRow[];
    fates: Map<PersonId, PersonFate>;
    shown: PairRow[];
    row: PairRow | null;
}

function drawData(ctx: StepContext, view: PairView): Drawn {
    const state = ctx.state;
    const rows = pairRows(state);
    const fates = ctx.plan ? planFates(ctx.plan) : new Map<PersonId, PersonFate>();
    if (!view.group) view.group = defaultGroup(rows);
    if (view.onlyRecalc && view.recalc.length === 0) view.onlyRecalc = false;
    const only = view.onlyRecalc ? new Set(view.recalc) : null;
    const inGroup = only ? rows.filter(r => only.has(r.id)) : rows.filter(r => r.group === view.group);
    const shown = inGroup.filter(r => matchesQuery(state, r, view.query));
    // After a decision: the next pair still to decide (in this group's order, around).
    if (view.advanceFrom) {
        const from = inGroup.findIndex(r => r.id === view.advanceFrom);
        view.advanceFrom = null;
        if ((view.group === 'maybe' || only) && from >= 0) {
            const order = [...shown.slice(shown.findIndex(r => r.id === inGroup[from].id) + 1), ...shown];
            const next = order.find(r => fates.get(r.id) === 'pending');
            if (next) view.selected = next.id;
        }
    }
    let row = shown.find(r => r.id === view.selected) ?? null;
    if (!row) {
        row = shown.find(r => fates.get(r.id) === 'pending') ?? shown[0] ?? null;
        view.selected = row?.id ?? null;
    }
    return { rows, fates, shown, row };
}

function tabsHtml(view: PairView, rows: readonly PairRow[]): string {
    const W = strings.mergeWizard;
    const count = (g: PairGroup): number => rows.filter(r => r.group === g).length;
    const tab = (g: PairGroup, label: string): string => {
        const on = view.group === g && !view.onlyRecalc;
        return `<button type="button" class="merge-tab sel-tab${on ? ' active' : ''}" role="tab" aria-selected="${on}" data-sel-dir="down" data-group="${g}">`
            + `<span class="sel-l" data-label="${escapeHtml(label)}">${escapeHtml(label)}</span> <span class="tab-count">${count(g).toLocaleString()}</span></button>`;
    };
    return `<div class="merge-tabs" role="tablist">${tab('maybe', W.grpMaybe)}${tab('same', W.grpSame)}${tab('new', W.grpNew)}</div>`;
}

function rowHtml(state: MergeState, view: PairView, row: PairRow, fate: PersonFate | undefined, selected: boolean): string {
    const inc = state.incomingData.persons[row.id];
    if (!inc) return '';
    const at = treePersonOf(state, row);
    const tree = at ? state.existingData.persons[at] : undefined;
    const f: PersonFate = fate ?? 'pending';
    const first = tree ?? inc;
    const year = yearText(first);
    const other = tree ? `<span class="merge-item-other">↔ ${escapeHtml(nameText(inc))}${yearText(inc) ? ` ${escapeHtml(yearText(inc))}` : ''}</span>` : '';
    const score = row.match ? `<span class="merge-item-score">${row.match.score} %</span>` : '';
    const pick = row.group === 'same'
        // The box is the mouse's: the row (an option) carries the tick for a keyboard and a reader (Space), no control inside an option.
        ? `<span class="merge-item-pick"><input type="checkbox" class="merge-item-check" tabindex="-1" aria-hidden="true"${view.checked.has(row.id) ? ' checked' : ''}></span>`
        : '';
    const checked = row.group === 'same' ? ` aria-checked="${view.checked.has(row.id)}"` : '';
    return `<div class="merge-item sel-opt is-${f}" data-sel-form="row" role="option" aria-selected="${selected}"${checked} tabindex="${selected ? 0 : -1}" data-incoming-id="${escapeHtml(row.id)}" data-fate="${f}">`
        + pick
        + `<span class="merge-item-status" data-fate="${f}" role="img" title="${escapeHtml(fateLabel(f))}" aria-label="${escapeHtml(fateLabel(f))}">${FATE_GLYPH[f]}</span>`
        + `<span class="merge-item-names"><span class="merge-item-name">${nameHtml(first)}${year ? ` <span class="merge-item-year">${escapeHtml(year)}</span>` : ''}</span>${other}</span>`
        + score + '</div>';
}

function listHtml(ctx: StepContext, view: PairView, d: Drawn): string {
    if (d.shown.length === 0) return `<div class="merge-empty">${escapeHtml(strings.merge.noItems)}</div>`;
    return d.shown.map(r => rowHtml(ctx.state, view, r, d.fates.get(r.id), r.id === view.selected)).join('');
}

function candidatesHtml(state: MergeState, inc: Person, cands: readonly MatchCandidateInfo[], chosen: PersonId | null): string {
    const W = strings.mergeWizard;
    const life = [lifeFact(inc, 'birth')].filter(Boolean).join('');
    const items = cands.map(c => {
        const p = state.existingData.persons[c.existingId];
        if (!p) return '';
        const by = yearOf(p.birthDate);
        const dy = yearOf(p.deathDate);
        const years = by !== null || dy !== null ? `${by ?? ''}–${dy ?? ''}` : '';
        return `<label class="sel-opt merge-cand" data-sel-form="row" data-cand="${escapeHtml(c.existingId)}">`
            + `<input type="radio" name="merge-cand" value="${escapeHtml(c.existingId)}"${c.existingId === chosen ? ' checked' : ''}>`
            + `<span class="merge-pn">${escapeHtml(nameText(p))}</span>`
            + (years ? `<span class="merge-mut">${escapeHtml(years)}</span>` : '')
            + (c.relativesJoined > 0 ? okMark() : '')
            + `<span class="merge-cand-sp"></span><span class="merge-item-score">${c.score} %</span>`
            + (c.timeConflict ? `<span class="merge-cand-why">${escapeHtml(W.notFirstTime)}</span>` : '')
            + '</label>';
    }).join('');
    return `<p class="merge-cand-import">${escapeHtml(W.colImport)}: <span class="merge-pn">${escapeHtml(nameText(inc))}</span>${life ? ` <span class="merge-mut">${escapeHtml(life)}</span>` : ''}</p>`
        + `<div class="merge-cands" role="radiogroup" aria-label="${escapeHtml(W.candidates(cands.length))}">${items}</div>`;
}

/** The chosen pair: the import's person, the tree's candidates (several: 4b), the chosen one and the tree's person shown. */
interface PairShown {
    inc: Person;
    cands: MatchCandidateInfo[];
    chosen: PersonId | null;
    tree: Person | null;
}

function pairShown(state: MergeState, view: PairView, row: PairRow): PairShown | null {
    const inc = state.incomingData.persons[row.id];
    if (!inc) return null;
    // Several candidates of the tree (4b): the chosen one stands in the grid.
    let cands: MatchCandidateInfo[] = [];
    if (row.group === 'maybe') {
        try {
            cands = candidatesFor(row.id, state, 3);
        } catch {
            cands = [];
        }
        if (row.match && !cands.some(c => c.existingId === row.match!.existingId)) cands = [];
    }
    const decided = state.decisions.get(row.id);
    const chosen = view.cand.get(row.id)
        ?? (decided?.type === 'manual_match' ? decided.targetId : null)
        ?? treePersonOf(state, row);
    const treeId = row.group === 'new' ? null : chosen;
    const tree = treeId ? state.existingData.persons[treeId] ?? null : null;
    return { inc, cands, chosen, tree };
}

function compareHtml(env: Step2Env | undefined, tree: Person | null): string {
    return env ? `<button type="button" class="link-button merge-btn-preview" data-action="${tree ? 'compare' : 'preview'}"${tree ? ` data-tree="${escapeHtml(tree.id)}"` : ''}>${escapeHtml(tree ? strings.treePreview.comparePersons : strings.treePreview.preview)}</button>` : '';
}

/** Why yes / What speaks against (4d). */
function whysHtml(state: MergeState, env: Step2Env | undefined, row: PairRow, pair: PairShown): string {
    const W = strings.mergeWizard;
    const { inc, tree, cands } = pair;
    if (!tree) return '';
    const cand = cands.find(c => c.existingId === tree.id);
    const reasons = (row.match && row.match.existingId === tree.id ? row.match.reasons : cand?.reasons ?? [])
        .filter(r => r !== 'manual').map(reasonText);
    const against = againstLines(state, inc, tree, row.match);
    const unions = env?.unionConflicts(row.id) ?? [];
    const why: string[] = [];
    if (reasons.length) why.push(`<p class="merge-why"><b>${escapeHtml(W.whyYes)}</b> ${escapeHtml(reasons.join(', '))}</p>`);
    if (against.length || unions.length) {
        const unionLines = unions.map(u => `<span class="merge-why-union" data-union="${escapeHtml(u.id)}">${escapeHtml(u.text)}</span>`).join('');
        why.push(`<p class="merge-why-no"><b>${escapeHtml(W.whyNo)}</b> ${against.map(escapeHtml).join('; ')}${unionLines}</p>`);
    }
    return why.length ? `<div class="merge-whys">${why.join('')}</div>` : '';
}

/** The decisions with their keys (S N A X). */
function decideHtml(state: MergeState, row: PairRow, label: string): string {
    const on = decisionKind(state, row);
    const opts = decisionsOf(row).map(k => {
        const checked = on === k;
        return `<button type="button" class="sel-opt merge-dec" role="radio" aria-checked="${checked}" data-dec="${k}">`
            + `${escapeHtml(decLabel(k))} <span class="kbd" aria-hidden="true">${escapeHtml(decKey(k))}</span></button>`;
    }).join('');
    return `<div class="merge-decide" role="radiogroup" aria-label="${escapeHtml(label)}" aria-keyshortcuts="${decisionsOf(row).map(decKey).join(' ')}">${opts}</div>`;
}

/** A phone (and a phone held sideways): the pair's head, the candidates, the grid, why, the decisions, the rest under them. */
function paneHtml(ctx: StepContext, env: Step2Env | undefined, view: PairView, d: Drawn): string {
    const W = strings.mergeWizard;
    const state = ctx.state;
    const row = d.row;
    const groupName = view.group === 'maybe' ? W.grpMaybe : view.group === 'same' ? W.grpSame : W.grpNew;
    const parts: string[] = [];
    if (view.group === 'same') parts.push(`<p class="merge-s2-note">${escapeHtml(W.sameNote)}</p>`);
    if (!row) return parts.join('') + recalcHtml(state, view) + restHtml(state, d);
    const pair = pairShown(state, view, row);
    if (!pair) return parts.join('');
    const { inc, cands, chosen, tree } = pair;
    const index = d.shown.indexOf(row) + 1;
    const sub = cands.length > 1 ? W.candidates(cands.length) : groupName;
    const compare = compareHtml(env, tree);
    // A phone (14b): the title opens the list as a sheet; the seg shows one column of the pair.
    const seg = tree
        ? `<div class="sel-seg merge-pair-seg" role="radiogroup" aria-label="${escapeHtml(W.pairSide)}">`
            + `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-side="tree" aria-checked="${view.side === 'tree'}" title="${escapeHtml(ctx.choices.targetName)}">${escapeHtml(ctx.choices.targetName)}</button>`
            + `<button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-side="import" aria-checked="${view.side === 'import'}">${escapeHtml(W.colImport)}</button></div>`
        : '';
    parts.push(`<div class="merge-pair-head"><span class="merge-pair-title">${escapeHtml(W.pairOf(index, d.shown.length))}</span>`
        + `<button type="button" class="merge-pair-open" aria-expanded="${view.listOpen}" aria-controls="merge-s2-side">${escapeHtml(W.pairOf(index, d.shown.length))} ▾</button>`
        + `<span class="merge-mut merge-pair-sub"><span class="merge-pair-dot" aria-hidden="true">· </span>${escapeHtml(sub)}</span><span class="merge-cand-sp"></span>${compare}${seg}`
        + `<span class="merge-keys">${keysHintHtml()}</span></div>`);
    if (cands.length > 1) parts.push(candidatesHtml(state, inc, cands, chosen));
    parts.push(pairGridHtml(state, ctx.choices.targetName, inc, tree, view.side));
    parts.push(whysHtml(state, env, row, pair));
    parts.push(decideHtml(state, row, W.pairOf(index, d.shown.length)));
    parts.push(recalcHtml(state, view));
    parts.push(restHtml(state, d));
    return parts.join('');
}

const ICON_HIDE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>';

/** A wider window (4f): the tree's candidates as compact rows of 30 px, the recalculation said in their head. */
function wideCandidatesHtml(ctx: StepContext, view: PairView, cands: readonly MatchCandidateInfo[], chosen: PersonId | null): string {
    const W = strings.mergeWizard;
    const state = ctx.state;
    const items = cands.map(c => {
        const p = state.existingData.persons[c.existingId];
        if (!p) return '';
        const years = lifeYears(p);
        const facts = [years, p.birthPlace ?? ''].filter(Boolean).join(' · ');
        return `<label class="sel-opt merge-cand" data-sel-form="row" data-cand="${escapeHtml(c.existingId)}">`
            + `<input type="radio" name="merge-cand" value="${escapeHtml(c.existingId)}"${c.existingId === chosen ? ' checked' : ''}>`
            + `<span class="merge-pn">${escapeHtml(nameText(p))}</span>`
            + (facts ? `<span class="merge-mut">${escapeHtml(facts)}</span>` : '')
            + (c.relativesJoined > 0 ? okMark() : '')
            + (c.timeConflict ? `<span class="merge-cand-why">· ${escapeHtml(W.notFirstTime)}</span>` : '')
            + `<span class="merge-cand-sp"></span><span class="merge-item-score">${c.score} %</span>`
            + '</label>';
    }).join('');
    return `<div class="merge-cands-box"><div class="merge-cands-head"><span class="merge-mut">${escapeHtml(W.candidatesIn(ctx.choices.targetName, cands.length))}</span>`
        + `<span class="merge-cand-sp"></span>${recalcHtml(state, view)}</div>`
        + `<div class="merge-cands" role="radiogroup" aria-label="${escapeHtml(W.candidates(cands.length))}">${items}</div></div>`;
}

/**
 * A wider window (dotaz 10, 4f): the pair's controls one row that never
 * scrolls (‹ hide the list · Pair 7 of 17 · group · ↑ ↓ · the decisions),
 * the candidates compact, the table filling the rest (only it scrolls, its
 * head stays), why yes and what speaks against under it. The undecided rest
 * stands at the foot of the list.
 */
function widePaneHtml(ctx: StepContext, env: Step2Env | undefined, view: PairView, d: Drawn): string {
    const W = strings.mergeWizard;
    const state = ctx.state;
    const row = d.row;
    const groupName = view.group === 'maybe' ? W.grpMaybe : view.group === 'same' ? W.grpSame : W.grpNew;
    const index = row ? d.shown.indexOf(row) + 1 : 0;
    const toggle = view.pairsHidden ? ''
        : `<button type="button" class="merge-icon-btn merge-pairs-toggle" aria-label="${escapeHtml(W.pairsHide)}" title="${escapeHtml(W.pairsHide)}" aria-expanded="true" aria-controls="merge-s2-side">${ICON_HIDE}</button>`;
    const move = (dir: -1 | 1, label: string, glyphText: string): string => {
        const off = !row || (dir < 0 ? index <= 1 : index >= d.shown.length);
        return `<button type="button" class="merge-icon-btn merge-pair-move" data-move="${dir}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${off ? ' disabled' : ''}>${glyphText}</button>`;
    };
    const head = `${toggle}<span class="merge-pair-title">${escapeHtml(W.pairOf(index, d.shown.length))}</span>`
        + `<span class="merge-mut merge-pair-sub"><span class="merge-pair-dot" aria-hidden="true">· </span>${escapeHtml(groupName)}</span>`
        + move(-1, W.prevPair, '↑') + move(1, W.nextPair, '↓') + '<span class="merge-cand-sp"></span>';
    const note = view.group === 'same' ? `<p class="merge-s2-note">${escapeHtml(W.sameNote)}</p>` : '';
    if (!row) return `<div class="merge-pair-ctl">${head}</div>${note}${recalcHtml(state, view)}`;
    const pair = pairShown(state, view, row);
    if (!pair) return `<div class="merge-pair-ctl">${head}</div>`;
    const { inc, cands, chosen, tree } = pair;
    const parts: string[] = [];
    parts.push(`<div class="merge-pair-ctl">${head}${compareHtml(env, tree)}${decideHtml(state, row, W.pairOf(index, d.shown.length))}</div>`);
    if (note) parts.push(note);
    if (cands.length > 1) parts.push(wideCandidatesHtml(ctx, view, cands, chosen));
    else parts.push(recalcHtml(state, view));
    parts.push(pairGridHtml(state, ctx.choices.targetName, inc, tree, view.side,
        { source: ctx.choices.source.label, recordsOpen: view.recordsOpen === row.id }));
    parts.push(whysHtml(state, env, row, pair));
    return parts.join('');
}

/** "The decision recalculated 3 suggestions for relatives (…). Decided pairs do not change." + Show (K3.3). */
function recalcHtml(state: MergeState, view: PairView): string {
    const W = strings.mergeWizard;
    const ids = view.recalc;
    if (ids.length === 0) return '';
    const names = ids.map(id => state.incomingData.persons[id]).filter((p): p is Person => !!p).map(nameText);
    const list = names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
    return `<p class="merge-recalc" role="status">${escapeHtml(W.recalc(ids.length, list))} `
        + `<button type="button" class="link-button merge-recalc-show" aria-pressed="${view.onlyRecalc}">${escapeHtml(view.onlyRecalc ? W.showAll : W.recalcShow)}</button></p>`;
}

/** Why yes of a pair that shares its parents (one of them), a child or a partner with the tree's person. */
const FAMILY_REASONS: ReadonlySet<MatchReason> = new Set<MatchReason>(['name_gender_parents', 'child_of_matched', 'parent_of_matched', 'sibling_of_matched', 'partner_of_matched', 'partner_shared_children', 'partner_similarity']);

/** The ids of a person's parents, children or partners in one data set. */
function relativeIds(p: Person, data: StromData, rel: 'parents' | 'children' | 'partners'): PersonId[] {
    if (rel === 'parents') return p.parentIds;
    if (rel === 'children') return p.childIds;
    const ids: PersonId[] = [];
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (u) ids.push(u.person1Id === p.id ? u.person2Id : u.person1Id);
    }
    return ids;
}

/**
 * The file's person of a row and the tree's person it stands against share a
 * family: a parent, child or partner of the one is paired with the same
 * relative of the other, whatever the reasons of the pair say (a parent with
 * nothing but the exact name is still the joined child's parent).
 */
function sharesFamily(state: MergeState, row: PairRow, byIncoming: ReadonlyMap<PersonId, PersonId>): boolean {
    const treeId = treePersonOf(state, row);
    const p = state.incomingData.persons[row.id];
    const t = treeId ? state.existingData.persons[treeId] : undefined;
    if (!p || !t) return false;
    for (const rel of ['parents', 'children', 'partners'] as const) {
        const treeRelatives = new Set(relativeIds(t, state.existingData, rel));
        if (relativeIds(p, state.incomingData, rel).some(r => {
            const paired = byIncoming.get(r);
            return !!paired && treeRelatives.has(paired);
        })) return true;
    }
    return false;
}

/**
 * The undecided pairs (`fates` pending) the rest decides at once, and the ones
 * with the same parents, child or partner as the tree's person: added as new
 * they would double a family (a third parent, a second spouse of one name), so
 * they are decided one by one (134 N2) and Continue waits for them.
 */
export function restSplit(state: MergeState, rows: readonly PairRow[], fates: ReadonlyMap<PersonId, PersonFate>): { bulk: PersonId[]; oneByOne: PersonId[] } {
    const byIncoming = new Map<PersonId, PersonId>();
    for (const r of rows) {
        const t = treePersonOf(state, r);
        if (t) byIncoming.set(r.id, t);
    }
    const bulk: PersonId[] = [];
    const oneByOne: PersonId[] = [];
    for (const r of rows) {
        if (fates.get(r.id) !== 'pending') continue;
        const family = r.match?.reasons.some(x => FAMILY_REASONS.has(x)) || sharesFamily(state, r, byIncoming);
        (family ? oneByOne : bulk).push(r.id);
    }
    return { bulk, oneByOne };
}

/**
 * "Remaining N undecided: Add as new · Do not add" (K3.4) under the pair, N
 * without the pairs of one family; a sentence says how many are decided one by one.
 */
function restHtml(state: MergeState, d: Drawn): string {
    const W = strings.mergeWizard;
    const { bulk, oneByOne } = restSplit(state, d.rows, d.fates);
    const n = bulk.length;
    if (n === 0 && oneByOne.length === 0) return '';
    const one = oneByOne.length ? `<span class="merge-rest-one">${escapeHtml(W.restOneByOne(oneByOne.length))}</span>` : '';
    if (n === 0) return `<div class="merge-rest" id="merge-rest">${one}</div>`;
    return `<div class="merge-rest" id="merge-rest"><span class="merge-rest-label">${escapeHtml(W.restLabel(n))}</span>`
        + `<button type="button" class="secondary" data-rest="reject">${escapeHtml(W.restAdd(n))}</button>`
        + `<button type="button" class="secondary" data-rest="skip">${escapeHtml(W.restSkip(n))}</button>`
        + one
        + `<span class="merge-rest-warn">${escapeHtml(W.restAddWarn)}</span></div>`;
}

function footHtml(view: PairView): string {
    const W = strings.mergeWizard;
    const unjoin = view.group === 'same'
        ? `<button type="button" class="secondary merge-unjoin"${view.checked.size === 0 ? ' disabled' : ''}>${escapeHtml(W.unjoinSel)}</button>` : '';
    return `<div class="merge-s2-foot">${unjoin}<button type="button" class="link-button merge-reanalyze" data-busy="idle">${busyButtonHtml(escapeHtml(strings.merge.reanalyze), strings.busy.analyzing, undefined, { own: true })}</button></div>`;
}

/** Draw step 2: the groups and the list left, the pair right. */
/**
 * The import is a copy of the target: everyone joined, the write would change
 * nothing (13b). In scopes c) and d) a differing detail the rules keep is
 * still the import's to bring: step 4 decides it, so that is no copy.
 */
export function isCopyOfTarget(ctx: Pick<StepContext, 'counts' | 'choices'>): boolean {
    if (ctx.choices.mode === 'new' || !ctx.counts || !bringsNothingNew(ctx.counts)) return false;
    return !((ctx.choices.scope === 'c' || ctx.choices.scope === 'd') && ctx.counts.differencesKept > 0);
}

/** The view stands on `row`: its group, the row chosen, a search that hides it cleared. */
function showRow(state: MergeState, view: PairView, row: PairRow): void {
    if (view.group !== row.group || view.onlyRecalc) view.scrollTop = 0;
    view.group = row.group;
    view.onlyRecalc = false;
    view.selected = row.id;
    if (!matchesQuery(state, row, view.query)) view.query = '';
}

/**
 * Step 2 opened (entered from another step, or the guide opened or resumed
 * on it, K10.5): a pair waiting in Maybe the same opens that group at the
 * first one; otherwise the view stays as it was. A group switched by hand
 * inside the step is kept: this runs only when the step opens.
 */
export function step2Opened(state: MergeState, plan: MergePlan | null): void {
    const view = viewOf(state);
    const rows = pairRows(state);
    const pending = pendingPairs(plan);
    const at = openingView(rows, pending, view.group, view.selected);
    const row = at.group === 'maybe' && at.selected ? rows.find(r => r.id === at.selected) : undefined;
    if (row && pending.has(row.id)) showRow(state, view, row);
}

/**
 * "To decide N" chosen (K10.5): the view on the first pair still to decide,
 * in its group, its row to take the focus when the step is drawn. False when
 * no pair waits.
 */
export function showFirstPending(state: MergeState, plan: MergePlan | null): boolean {
    const view = viewOf(state);
    const row = firstPending(pairRows(state), pendingPairs(plan));
    if (!row) return false;
    showRow(state, view, row);
    view.listOpen = false;
    view.focusRow = true;
    view.focusPair = true;
    return true;
}

/** Close step 2's sheet of pairs (a phone; Esc), as its × does; true when it was open. */
export function closeStep2Overlay(): boolean {
    const close = document.querySelector<HTMLButtonElement>('#merge-modal .merge-s2.is-list .merge-s2-sheet-close');
    if (!close || close.getClientRects().length === 0) return false;
    close.click();
    return true;
}

export function renderStep2(host: HTMLElement, ctx: StepContext): void {
    const view = viewOf(ctx.state);
    // A copy of the tree (13b): one sentence, the comparison behind a link.
    if (!view.showCopy && isCopyOfTarget(ctx)) {
        host.innerHTML = stepHeading(2)
            + `<p class="merge-step-note merge-s2-copy">${escapeHtml(strings.mergeWizard.sameAsTarget(ctx.counts!.total, ctx.choices.targetName))} `
            + `<button type="button" class="link-button merge-s2-show-copy">${escapeHtml(strings.mergeWizard.showComparison)}</button></p>`;
        host.querySelector<HTMLButtonElement>('.merge-s2-show-copy')?.addEventListener('click', () => {
            view.showCopy = true;
            view.focusRow = true;
            renderStep2(host, ctx);
        });
        return;
    }
    const oldList = host.querySelector<HTMLElement>('#merge-match-list');
    if (oldList) view.scrollTop = oldList.scrollTop;
    const d = drawData(ctx, view);
    const W = strings.mergeWizard;
    // A copy of the tree with its list shown (Show the comparison, or the last
    // decision made it one): the sentence says why the primary only closes.
    const copyNote = isCopyOfTarget(ctx)
        ? `<p class="merge-step-note merge-s2-copy-note">${escapeHtml(W.sameAsTarget(ctx.counts!.total, ctx.choices.targetName))}</p>` : '';
    // A wider window (dotaz 10, 4f–4h): the pair fills the window, the list
    // can fold to a rail, the undecided rest stands at the list's foot. A
    // phone keeps its sheet and the pane as it was.
    const wide = !isPhoneBar();
    const index = d.row ? d.shown.indexOf(d.row) + 1 : 0;
    const hidden = wide && view.pairsHidden;
    const rail = hidden
        ? `<div class="merge-s2-rail"><button type="button" class="merge-icon-btn merge-pairs-toggle" aria-label="${escapeHtml(W.pairsShow)}" title="${escapeHtml(W.pairsShow)}" aria-expanded="false" aria-controls="merge-s2-side">${ICON_LIST}</button>`
            + `<span class="merge-s2-rail-n" aria-hidden="true">${index}/${d.shown.length}</span></div>`
        : '';
    host.innerHTML = stepHeading(2).replace('class="merge-step-title"', 'class="merge-step-title merge-s2-title"')
        + copyNote
        + `<div class="merge-s2${view.listOpen ? ' is-list' : ''}${wide ? ' is-wide' : ''}${hidden ? ' is-folded' : ''}">`
        + rail
        + `<div class="merge-s2-side" id="merge-s2-side"${hidden ? ' hidden' : ''}>`
        + `<div class="merge-s2-sheet-head"><span class="merge-pair-title">${escapeHtml(W.pairOf(index, d.shown.length))}</span>`
        + `<button type="button" class="merge-s2-sheet-close" aria-label="${escapeHtml(strings.buttons.close)}">×</button></div>`
        + tabsHtml(view, d.rows)
        + `<div class="merge-s2-search"><input type="search" class="merge-s2-q" value="${escapeHtml(view.query)}" placeholder="${escapeHtml(W.searchName)}" aria-label="${escapeHtml(W.searchName)}"></div>`
        + `<div class="merge-match-list" id="merge-match-list" role="listbox" aria-label="${escapeHtml(W.grpMaybe)}">${listHtml(ctx, view, d)}</div>`
        + (wide && !hidden ? restHtml(ctx.state, d) : '')
        + footHtml(view) + '</div>'
        // The list folded to a rail: the undecided rest stands under the pair (never hidden with the list).
        + `<div class="merge-s2-pane" id="merge-pair">${wide ? widePaneHtml(ctx, ctx.step2, view, d) + (hidden ? restHtml(ctx.state, d) : '') : paneHtml(ctx, ctx.step2, view, d)}</div>`
        + '</div>';
    const list = host.querySelector<HTMLElement>('#merge-match-list');
    if (list) {
        const groupLabel = view.group === 'maybe' ? W.grpMaybe : view.group === 'same' ? W.grpSame : W.grpNew;
        list.setAttribute('aria-label', groupLabel);
        list.scrollTop = view.scrollTop;
    }
    wire(host, ctx, view);
    const sel = list?.querySelector<HTMLElement>('.merge-item[aria-selected="true"]');
    sel?.scrollIntoView?.({ block: 'nearest' });
    if (view.focusRow) {
        view.focusRow = false;
        // "To decide N" with the list hidden (a phone's closed sheet, a list folded to a rail): the pair's head or its decisions.
        const shown = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.getClientRects().length > 0;
        const target = view.focusPair && !shown(sel)
            ? [host.querySelector<HTMLElement>('#merge-pair .merge-pair-open'), host.querySelector<HTMLElement>('#merge-pair .merge-decide button')].find(shown)
            : sel;
        view.focusPair = false;
        target?.focus({ preventScroll: true });
    }
    installKeys(host);
    watchWidth(host);
}

/** The window crossing the phone's width (a turn, a resize): step 2 drawn again in its other form. */
function watchWidth(host: HTMLElement): void {
    const h = host as HTMLElement & { __step2Width?: boolean; __step2?: StepContext };
    if (h.__step2Width || typeof window.matchMedia !== 'function') return;
    h.__step2Width = true;
    const mq = window.matchMedia(MQ_PHONE_BAR);
    mq.addEventListener?.('change', () => {
        const ctx = h.__step2;
        if (!ctx || host.dataset.step !== '2' || !host.isConnected || !host.querySelector('.merge-s2')) return;
        redraw(host, ctx, false);
    });
}

/** The view changed (group, pair, search, candidate): the step drawn again, keeping the focus on the step. */
function redraw(host: HTMLElement, ctx: StepContext, focusRow: boolean): void {
    const view = viewOf(ctx.state);
    view.focusRow = focusRow;
    renderStep2(host, ctx);
}

function rowFromEl(ctx: StepContext, el: Element | null): PairRow | null {
    const id = el?.closest<HTMLElement>('[data-incoming-id]')?.dataset.incomingId as PersonId | undefined;
    if (!id) return null;
    return pairRows(ctx.state).find(r => r.id === id) ?? null;
}

function selectedRow(ctx: StepContext): PairRow | null {
    const view = viewOf(ctx.state);
    return view.selected ? pairRows(ctx.state).find(r => r.id === view.selected) ?? null : null;
}

/** A decision on the chosen pair (by its button or its key); then the next pair to decide. */
function decide(ctx: StepContext, kind: DecKind): void {
    const env = ctx.step2;
    const row = selectedRow(ctx);
    if (!env || !row || !decisionsOf(row).includes(kind)) return;
    const view = viewOf(ctx.state);
    view.showCopy = true;
    if (kind === 'other') {
        env.other(row.id);
        return;
    }
    let decision: PairDecision | null;
    if (kind === 'skip') decision = 'skip';
    else if (kind === 'new') decision = row.group === 'new' ? null : 'reject';
    else {
        const chosen = view.cand.get(row.id);
        decision = chosen && row.match && chosen !== row.match.existingId ? { type: 'manual_match', targetId: chosen } : 'confirm';
    }
    view.advanceFrom = row.id;
    view.focusRow = true;
    view.checked.delete(row.id);
    env.decide(row.id, decision);
}

/** A join of The same ticked or not: the box, the row's state and Undo the joins of the selected. */
function setChecked(host: HTMLElement, view: PairView, id: PersonId, on: boolean): void {
    if (on) view.checked.add(id);
    else view.checked.delete(id);
    const item = Array.from(host.querySelectorAll<HTMLElement>('#merge-match-list .merge-item')).find(el => el.dataset.incomingId === id);
    item?.setAttribute('aria-checked', String(on));
    const box = item?.querySelector<HTMLInputElement>('.merge-item-check');
    if (box) box.checked = on;
    const unjoin = host.querySelector<HTMLButtonElement>('.merge-unjoin');
    if (unjoin) unjoin.disabled = view.checked.size === 0;
}

function wire(host: HTMLElement, ctx: StepContext, view: PairView): void {
    const env = ctx.step2;
    host.querySelectorAll<HTMLButtonElement>('.merge-tab').forEach(b => b.addEventListener('click', () => {
        const g = b.dataset.group as PairGroup;
        if (view.group === g && !view.onlyRecalc) return;
        view.group = g;
        view.onlyRecalc = false;
        view.selected = null;
        view.scrollTop = 0;
        redraw(host, ctx, false);
        host.querySelector<HTMLElement>(`.merge-tab[data-group="${g}"]`)?.focus();
    }));
    const q = host.querySelector<HTMLInputElement>('.merge-s2-q');
    q?.addEventListener('input', () => {
        view.query = q.value;
        view.selected = null;
        view.scrollTop = 0;
        const at = q.selectionStart;
        redraw(host, ctx, false);
        const again = host.querySelector<HTMLInputElement>('.merge-s2-q');
        again?.focus();
        if (again && at !== null) again.setSelectionRange(at, at);
    });
    const list = host.querySelector<HTMLElement>('#merge-match-list');
    list?.addEventListener('click', e => {
        const t = e.target as HTMLElement;
        if (t.closest('.merge-item-check')) return;
        const row = rowFromEl(ctx, t);
        if (!row) return;
        view.selected = row.id;
        // A phone: the chosen row closes the sheet, the pair shows.
        const sheet = view.listOpen;
        view.listOpen = false;
        redraw(host, ctx, !sheet);
        if (sheet) host.querySelector<HTMLElement>('.merge-pair-open')?.focus();
    });
    list?.addEventListener('change', e => {
        const box = (e.target as HTMLElement).closest<HTMLInputElement>('.merge-item-check');
        const row = rowFromEl(ctx, box);
        if (!box || !row) return;
        setChecked(host, view, row.id, box.checked);
    });
    host.querySelector<HTMLButtonElement>('.merge-unjoin')?.addEventListener('click', () => {
        if (!env || view.checked.size === 0) return;
        const ids = [...view.checked];
        view.checked.clear();
        view.showCopy = true;
        env.decideMany(ids, 'reject');
    });
    host.querySelector<HTMLButtonElement>('.merge-reanalyze')?.addEventListener('click', () => env?.reanalyze());
    host.querySelector<HTMLButtonElement>('.merge-s2-sheet-close')?.addEventListener('click', () => {
        view.listOpen = false;
        redraw(host, ctx, false);
        host.querySelector<HTMLElement>('.merge-pair-open')?.focus();
    });
    /** "Add as new · Do not add" for the undecided rest: under the pair on a phone, at the list's foot on a wider window. */
    const restClick = (t: HTMLElement): boolean => {
        const rest = t.closest<HTMLElement>('[data-rest]');
        if (!rest || !env) return false;
        const d = drawData(ctx, view);
        view.showCopy = true;
        env.decideMany(restSplit(ctx.state, d.rows, d.fates).bulk, rest.dataset.rest as 'reject' | 'skip');
        return true;
    };
    host.querySelector<HTMLElement>('#merge-s2-side')?.addEventListener('click', e => { restClick(e.target as HTMLElement); });
    // A wider window: the list folds to a rail and back (4h), the focus stays on the toggle.
    host.querySelectorAll<HTMLButtonElement>('.merge-pairs-toggle').forEach(b => b.addEventListener('click', () => {
        view.pairsHidden = !view.pairsHidden;
        redraw(host, ctx, false);
        host.querySelector<HTMLElement>('.merge-pairs-toggle')?.focus();
    }));
    const pane = host.querySelector<HTMLElement>('#merge-pair');
    pane?.addEventListener('click', e => {
        const t = e.target as HTMLElement;
        if (t.closest('.merge-pairs-toggle')) return;
        const move = t.closest<HTMLButtonElement>('.merge-pair-move');
        if (move) {
            const d = drawData(ctx, view);
            const i = d.row ? d.shown.indexOf(d.row) : -1;
            const next = d.shown[i + Number(move.dataset.move)];
            if (!next) return;
            view.selected = next.id;
            redraw(host, ctx, false);
            const again = host.querySelector<HTMLButtonElement>(`.merge-pair-move[data-move="${move.dataset.move}"]`);
            (again && !again.disabled ? again : host.querySelector<HTMLElement>('.merge-pair-move:not(:disabled)'))?.focus();
            return;
        }
        if (t.closest('.merge-records-more')) {
            view.recordsOpen = view.recordsOpen === view.selected ? null : view.selected;
            redraw(host, ctx, false);
            host.querySelector<HTMLElement>('.merge-records-more')?.focus();
            return;
        }
        const dec = t.closest<HTMLElement>('.merge-dec');
        if (dec) {
            decide(ctx, dec.dataset.dec as DecKind);
            return;
        }
        if (t.closest('.merge-pair-open')) {
            view.listOpen = !view.listOpen;
            redraw(host, ctx, false);
            if (view.listOpen) host.querySelector<HTMLElement>('.merge-item[aria-selected="true"]')?.focus({ preventScroll: true });
            return;
        }
        const seg = t.closest<HTMLElement>('.merge-pair-seg [data-side]');
        if (seg) {
            view.side = seg.dataset.side === 'import' ? 'import' : 'tree';
            redraw(host, ctx, false);
            host.querySelector<HTMLElement>(`.merge-pair-seg [data-side="${view.side}"]`)?.focus();
            return;
        }
        if (t.closest('.merge-recalc-show')) {
            view.onlyRecalc = !view.onlyRecalc;
            view.selected = null;
            view.scrollTop = 0;
            redraw(host, ctx, false);
            host.querySelector<HTMLElement>('.merge-recalc-show')?.focus();
            return;
        }
        if (restClick(t)) return;
        const action = t.closest<HTMLElement>('[data-action]')?.dataset.action;
        const id = view.selected;
        if (!action || !id || !env) return;
        if (action === 'compare') env.compare(id, (t.closest<HTMLElement>('[data-tree]')?.dataset.tree as PersonId | undefined));
        else if (action === 'preview') env.preview(id);
    });
    pane?.addEventListener('change', e => {
        const radio = (e.target as HTMLElement).closest<HTMLInputElement>('input[name="merge-cand"]');
        if (!radio || !view.selected) return;
        view.cand.set(view.selected, radio.value as PersonId);
        redraw(host, ctx, false);
        host.querySelector<HTMLInputElement>(`input[name="merge-cand"][value="${CSS.escape(radio.value)}"]`)?.focus();
    });
    // The keys reach the step through the window's handler (installKeys) with this context.
    (host as HTMLElement & { __step2?: StepContext }).__step2 = ctx;
}

/** A key typed into a field, or with a modifier, is the field's own. */
function isTyping(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        const type = (t as HTMLInputElement).type;
        return type !== 'checkbox' && type !== 'radio' && type !== 'button';
    }
    return false;
}

/**
 * The keys of step 2 (§4, §13 13i): the decisions' letters and ↑ ↓ for the
 * previous and next pair, on the guide's window only (not a global handler),
 * and only when the focus is not in a field.
 */
function installKeys(host: HTMLElement): void {
    const modal = host.closest<HTMLElement>('#merge-modal') ?? document.getElementById('merge-modal');
    if (!modal || modal.dataset.step2Keys === '1') return;
    modal.dataset.step2Keys = '1';
    modal.addEventListener('keydown', e => {
        const body = document.getElementById('merge-step-body') as (HTMLElement & { __step2?: StepContext }) | null;
        if (!body || body.dataset.step !== '2' || e.defaultPrevented || isTyping(e)) return;
        const ctx = body.__step2;
        if (!ctx) return;
        const view = viewOf(ctx.state);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            // A radio group of the pane keeps its own arrows.
            if ((e.target as HTMLElement).closest?.('.merge-cands')) return;
            const d = drawData(ctx, view);
            if (d.shown.length === 0) return;
            const i = d.row ? d.shown.indexOf(d.row) : -1;
            const next = e.key === 'ArrowDown' ? Math.min(d.shown.length - 1, i + 1) : Math.max(0, i - 1);
            e.preventDefault();
            view.selected = d.shown[next].id;
            redraw(body, ctx, true);
            return;
        }
        // Space on a row of The same ticks it (its box is the mouse's).
        if (e.key === ' ') {
            const item = (e.target as HTMLElement).closest?.<HTMLElement>('.merge-item[aria-checked]');
            const id = item?.dataset.incomingId as PersonId | undefined;
            if (!item || !id) return;
            e.preventDefault();
            setChecked(body, view, id, !view.checked.has(id));
            return;
        }
        if (e.key.length !== 1) return;
        const key = e.key.toUpperCase();
        const kind = DEC_ORDER.find(k => decKey(k).toUpperCase() === key);
        if (!kind) return;
        const row = selectedRow(ctx);
        if (!row || !decisionsOf(row).includes(kind)) return;
        e.preventDefault();
        decide(ctx, kind);
    });
}
