/**
 * The Statistics window (spec 138): full frequency tables of a tree's values
 * (names, places, life, time) over a scope (the whole tree, a family line, a
 * person's direct line, a list) and a birth period.
 *
 * - The frame shows at once; the chosen topic is computed on an idle
 *   callback, then the numbers of the other topics, one per callback. A topic
 *   still calculating shows "Calculating…" after 120 ms (CSS).
 * - Tables are cached by data revision + scope + topic + the options the
 *   topic reads; a change of the open tree's data computes again.
 * - The window's state (topic, options, scope, search, sort) lasts until it
 *   closes; nothing is stored in the tree or the settings.
 * - A tree that is not open is read only: the rows are no buttons.
 * - A click on a row goes through `onStatsRowOpen` (the Table shows the
 *   row's people).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { Person, PersonId, PersonList, StromData, TreeId } from '../types.js';
import { buildLineages, rodLabels, rods, type LineageIndex, type RodId } from '../lineage.js';
import {
    STATS_GROUPS, STATS_TOPICS, DEFAULT_STATS_OPTIONS, type StatsTopic, type StatsOptions, type StatsSort, type StatsScope,
    type StatsScopeRef, type StatsTable, type StatsRow, type StatsContext, type StatsValueLabels,
    statsContext, isValueTopic, defaultSort, directLineIds, scopePersonIds, sexCounts, statsTable, sortRows, searchRows,
    rowShare, shareText, statsCsv,
} from '../tree-stats.js';
import { encodeSelectionRef, decodeSelectionRef, selectionLabel, selectionLabelText, selectionPersonIds, type SelectionRef } from '../view-selection.js';
import { personListsOf } from '../person-lists-data.js';
import { listDisplayName, listKind } from '../person-lists.js';
import {
    rodPickerItems, rodPickerSmallItems, selectionFoundRowsHtml, selectionIcon, selectionPickerHtml,
    rodPickKey, type SelectionPickRow, type SelectionPickerMarkup, type SelectionPickerTexts,
} from '../rod-picker.js';
import { wireRodPicker } from './rod-picker-ui.js';
import { ensureFamilyPagesAppCss } from '../family-pages-css.js';
import { listKindIcon } from './list-kind-icon.js';
import { openPersonPopover } from './person-popover.js';
import { readRecent } from './tree-overview.js';
import { highlightHtml } from './table-view/table-filter.js';
import { tableCsvFileName } from './table-view/table-export.js';
import { filterAndSort } from '../person-picker.js';
import { shownName } from '../person-name.js';
import { displayYear } from '../dates.js';
import { uiModule } from './module.js';

const OVERLAY_ID = 'tree-stats-modal';
/** The search waits as the Table's does. */
const SEARCH_DELAY_MS = 150;
/** An edit of the open tree is shown once the edits settle. */
const REFRESH_DELAY_MS = 120;
/** More rows than this are drawn only where they are seen. */
const VIRTUAL_MIN = 300;
const OVERSCAN = 12;
/** People a scope search finds at most (each a direct line). */
const FOUND_LIMIT = 5;
/** The axis of the lines' bars (as the window's selection). */
const AXIS_LO = 1650;
const AXIS_HI = 2030;
/** Swipe down from a sheet's head closes it. */
const SHEET_SWIPE_CLOSE_PX = 80;

/** What the window shows; lasts until it closes (§0.3). */
export interface StatsWindowState {
    treeId: string;
    topic: StatsTopic;
    opts: StatsOptions;
    scope: StatsScope;
    search: string;
    /** Each topic's sort, until the window closes. */
    sort: Partial<Record<StatsTopic, StatsSort>>;
}

/**
 * How the window opens: any part of the state ("In detail" of the overview,
 * "Back to Statistics" of the Table) and the dialog it was opened from
 * (`parent`: a dialog id). The tree overview stays open under the window;
 * another parent is hidden and comes back on a plain close.
 */
export interface TreeStatsOpen {
    topic?: StatsTopic;
    opts?: Partial<StatsOptions>;
    scope?: StatsScope;
    search?: string;
    sort?: Partial<Record<StatsTopic, StatsSort>>;
    parent?: string;
}

/** A click on a value or on "Not given": the people to show and the way back. */
export interface StatsRowOpen {
    treeId: string;
    ids: PersonId[];
    /** The Table's chip ("Statistics: first name Jan · Ostrožný line"). */
    label: string;
    /** The window's state, for "Back to Statistics". */
    back: StatsWindowState;
}

/** The event a row click sends; the Table takes it over (`listenForStatsRowOpen`). */
export const STATS_ROW_OPEN_EVENT = 'strom:stats-row-open';

interface Runtime {
    win: StatsWindowState;
    treeName: string;
    data: StromData;
    active: boolean;
    index: LineageIndex;
    labels: Map<RodId, string>;
    ctx: StatsContext;
    focusId: PersonId | null;
    /** The scope's people (null: not computed yet). */
    scoped: { ids: PersonId[]; noYear: number } | null;
    sex: Record<StatsOptions['sex'], number> | null;
    tables: Map<string, StatsTable>;
    /** The rows shown (sorted, searched) and the keyboard's row. */
    shown: StatsRow[];
    focusIndex: number;
    /** The period fields hold no valid period: nothing is computed again. */
    periodInvalid: boolean;
}

let rt: Runtime | null = null;
let revision = 0;
let idleRun = 0;
let listening = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let returnParent: string | null = null;
let returnFocus: HTMLElement | null = null;
let closePicker: (() => void) | null = null;
let closePop: (() => void) | null = null;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The numbers of a sentence in bold ("Total <strong>1 248</strong> people"). */
function strongNumbers(text: string): string {
    return esc(text).replace(/\d[\d\s  .,]*\d|\d/g, m => `<strong>${m}</strong>`);
}

function whenIdle(run: () => void): void {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 0);
}

function lang(): string {
    return getCurrentLanguage();
}

function num(n: number): string {
    return n.toLocaleString(lang());
}

function capFirst(s: string): string {
    return s ? s.charAt(0).toLocaleUpperCase(lang()) + s.slice(1) : s;
}

function realPerson(data: StromData, id: PersonId | null | undefined): Person | null {
    if (!id) return null;
    const p = data.persons[id];
    return p && !p.isPlaceholder ? p : null;
}

/** The first real person of a tree that is not open (its focus when opened). */
function defaultPersonOf(data: StromData): PersonId | null {
    const meta = data as StromData & { lastFocusPersonId?: PersonId; defaultPersonId?: PersonId };
    for (const id of [meta.lastFocusPersonId, meta.defaultPersonId]) if (realPerson(data, id)) return id!;
    for (const id in data.persons) if (realPerson(data, id as PersonId)) return id as PersonId;
    return null;
}

function valueLabels(): StatsValueLabels {
    const t = strings.treeStats;
    return {
        ageGroup: t.ageGroup, ageTop: t.ageTop, decade: t.decade,
        month: (m: number) => capFirst(strings.treeOverview.monthNames[m - 1] ?? String(m)),
        children: t.children, childrenTop: t.childrenTop, noDistrict: t.noDistrict, noCountry: t.noCountry,
    };
}

// ==================== scope ====================

function encodeScope(ref: StatsScopeRef | null): string {
    if (!ref) return '';
    return ref.kind === 'direct' ? `direct:${encodeURIComponent(ref.personId)}` : encodeSelectionRef(ref);
}

function decodeScope(sel: string): StatsScopeRef | null {
    if (!sel || sel === 'none') return null;
    if (sel.startsWith('direct:')) return { kind: 'direct', personId: decodeURIComponent(sel.slice(7)) as PersonId };
    return decodeSelectionRef(sel);
}

function listOf(data: StromData, id: string): PersonList | null {
    return personListsOf(data).find(l => l.id === id) ?? null;
}

/** The scope's name for the button ("Ostrožný line", "Direct line: Jan Pětioký"). */
function scopeName(r: Runtime): string {
    const ref = r.win.scope.ref;
    const t = strings.treeStats.scope;
    if (!ref) return t.tree;
    switch (ref.kind) {
        case 'rod': return t.rod(r.labels.get(ref.rodId) ?? ref.rodId);
        case 'direct': { const p = realPerson(r.data, ref.personId); return t.direct(p ? shownName(p) : '?'); }
        case 'list': { const l = listOf(r.data, ref.listId); return t.list(l ? listDisplayName(l) : ref.listId); }
        default: return selectionLabelText(selectionLabel(ref, r.data, r.labels));
    }
}

/** The scope inside a sentence, with the period ("Ostrožný line, born 1800–1900"). */
function scopeDescText(r: Runtime): string {
    const ref = r.win.scope.ref;
    const t = strings.treeStats.scopeDesc;
    let s: string;
    if (!ref) s = t.tree;
    else if (ref.kind === 'rod') s = t.rod(r.labels.get(ref.rodId) ?? ref.rodId);
    else if (ref.kind === 'direct') { const p = realPerson(r.data, ref.personId); s = t.direct(p ? shownName(p) : '?'); }
    else if (ref.kind === 'list') { const l = listOf(r.data, ref.listId); s = t.list(l ? listDisplayName(l) : ref.listId); }
    else s = selectionLabelText(selectionLabel(ref, r.data, r.labels));
    const period = periodText(r.win.scope);
    return period ? `${s}, ${period}` : s;
}

/** The scope for the Table's chip: none for the whole tree without a period. */
function chipScope(r: Runtime): string | undefined {
    return r.win.scope.ref || hasPeriod(r.win.scope) ? scopeDescText(r) : undefined;
}

function hasPeriod(s: StatsScope): boolean {
    return s.from !== undefined || s.to !== undefined;
}

function periodText(s: StatsScope): string {
    return hasPeriod(s) ? strings.treeStats.scope.period(s.from ?? null, s.to ?? null) : '';
}

function scopeIcon(ref: StatsScopeRef | null): string {
    if (!ref) return selectionIcon('none');
    if (ref.kind === 'direct') return selectionIcon('ancestors');
    if (ref.kind === 'list') return selectionIcon('none');
    if (ref.kind === 'rod' || ref.kind === 'ancestors' || ref.kind === 'descendants' || ref.kind === 'line') return selectionIcon(ref.kind);
    return selectionIcon('none');
}

// ==================== tables ====================

/** The options a topic reads (the cache key). */
function optsKey(topic: StatsTopic, o: StatsOptions): string {
    switch (topic) {
        case 'firstNames': return `${o.sex}|${o.names}`;
        case 'surnames': return o.surnames;
        case 'birthPlaces': case 'deathPlaces': case 'marriagePlaces': return o.level;
        case 'births': return o.births;
        default: return '';
    }
}

function tableKey(topic: StatsTopic, o: StatsOptions): string {
    return `${topic}|${optsKey(topic, o)}`;
}

function cachedTable(r: Runtime, topic: StatsTopic): StatsTable | null {
    return r.tables.get(tableKey(topic, r.win.opts)) ?? null;
}

function computeTable(r: Runtime, topic: StatsTopic): StatsTable {
    const key = tableKey(topic, r.win.opts);
    let t = r.tables.get(key);
    if (!t) {
        t = statsTable(r.data, r.scoped?.ids ?? [], topic, r.win.opts, r.ctx);
        r.tables.set(key, t);
    }
    return t;
}

function sortOf(r: Runtime, topic: StatsTopic): StatsSort {
    return r.win.sort[topic] ?? defaultSort(topic, r.win.opts);
}

/** The place level that applies (a hierarchy of places, else towns). */
function levelOf(r: Runtime, t: StatsTable): StatsOptions['level'] {
    return t.hasLevels ? r.win.opts.level : 'town';
}

function isPlaceTopic(topic: StatsTopic): boolean {
    return topic === 'birthPlaces' || topic === 'deathPlaces' || topic === 'marriagePlaces';
}

function isAgeTopic(topic: StatsTopic): boolean {
    return topic === 'deathAge' || topic === 'firstMarriageAge' || topic === 'firstChildAge';
}

/** The topic's options as words ("men, first name"); '' for a topic without options. */
function optsDesc(r: Runtime, topic: StatsTopic, t: StatsTable | null): string {
    const d = strings.treeStats.optDesc;
    const o = r.win.opts;
    switch (topic) {
        case 'firstNames': return `${d[o.sex === 'unknown' ? 'unknownSex' : o.sex]}, ${d[o.names]}`;
        case 'surnames': return d[o.surnames === 'birth' ? 'birthName' : 'withMarried'];
        case 'births': return d[o.births === 'decade' ? 'decades' : 'months'];
        default: return isPlaceTopic(topic) && t?.hasLevels ? d[o.level] : '';
    }
}

function topicWithOpts(r: Runtime, topic: StatsTopic, t: StatsTable | null): string {
    const name = strings.treeStats.topics[topic];
    const o = optsDesc(r, topic, t);
    return o ? strings.treeStats.topicOpts(name, o) : name;
}

function totalText(r: Runtime, t: StatsTable, shown: readonly StatsRow[]): string {
    const T = strings.treeStats.total;
    const q = r.win.search.trim();
    const values = t.rows.filter(row => !row.muted).length;
    if (q) return T.search(q, shown.length, t.rows.length, shown.reduce((s, row) => s + row.count, 0));
    switch (t.topic) {
        case 'firstNames': return r.win.opts.names === 'each' ? T.each(t.units, t.occurrences, t.rows.length) : T.persons(t.units, t.rows.length);
        case 'birthPlaces': case 'deathPlaces': return T.places(t.units, values, levelOf(r, t));
        case 'marriagePlaces': return T.marriages(t.units, values, levelOf(r, t));
        case 'deathAge': case 'firstMarriageAge': case 'firstChildAge': return T.ages(t.units, t.known, t.rows.length);
        case 'childrenPerCouple': return T.couples(t.units, t.rows.length);
        case 'births': return r.win.opts.births === 'month' ? T.months(t.units, t.known, t.rows.length) : T.births(t.units, t.known, t.rows.length);
        default: return T.persons(t.units, t.rows.length);
    }
}

function noteText(r: Runtime, t: StatsTable): string {
    const N = strings.treeStats.note;
    if (r.win.search.trim()) return `${N.search} ${N.real}`;
    const parts: string[] = [];
    const topic = t.topic;
    if (topic === 'firstNames' && r.win.opts.names === 'each') parts.push(N.each);
    if (topic === 'surnames') {
        parts.push(N.surnames);
        if (r.win.opts.surnames === 'withMarried') parts.push(N.withMarried);
    }
    if (isPlaceTopic(topic)) parts.push(N.places, t.hasLevels ? N.placesLevel : N.placesTown);
    if (topic === 'occupations') parts.push(N.occupations);
    if (isAgeTopic(topic)) parts.push(N.ages, N.ageNone);
    if (topic === 'childrenPerCouple') parts.push(N.couples);
    if (topic === 'births') parts.push(N.births);
    if (!(topic === 'firstNames' && r.win.opts.names === 'each')) parts.push(N.share);
    parts.push(N.real);
    return parts.join(' ');
}

function valueColumn(r: Runtime, topic: StatsTopic): string {
    const v = strings.treeStats.col.value;
    switch (topic) {
        case 'firstNames': return v.name;
        case 'surnames': return v.surname;
        case 'birthPlaces': case 'deathPlaces': case 'marriagePlaces': return v.place;
        case 'occupations': return v.occupation;
        case 'religions': return v.religion;
        case 'childrenPerCouple': return v.children;
        case 'births': return r.win.opts.births === 'month' ? v.month : v.decade;
        default: return v.age;
    }
}

function valueSortLabel(topic: StatsTopic): string {
    const s = strings.treeStats.sort;
    return topic === 'births' ? s.byPeriod : topic === 'childrenPerCouple' ? s.byChildren : s.byAge;
}

function searchPlaceholder(topic: StatsTopic): string {
    const s = strings.treeStats.search;
    if (topic === 'firstNames') return s.names;
    if (topic === 'surnames') return s.surnames;
    if (isPlaceTopic(topic)) return s.places;
    return s.other;
}

/** The empty sentence of a topic (§11): the tree's, or the scope's. */
function emptyText(r: Runtime, topic: StatsTopic): string {
    const e = strings.treeStats.empty;
    if (!r.win.scope.ref && !hasPeriod(r.win.scope)) return e[topic];
    return e.inScope(scopeDescText(r), strings.treeStats.emptyShort[topic]);
}

// ==================== markup ====================

const DOWNLOAD_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

function seg(name: string, label: string, items: ReadonlyArray<{ v: string; html: string; on: boolean }>, cls = ''): string {
    return `<div class="stv-opt${cls}"><span class="stv-opt-l">${esc(label)}</span>`
        + `<div class="sel-seg stv-seg" role="group" aria-label="${esc(label)}">`
        + items.map(i => `<button type="button" class="sel-opt" data-sel-form="seg" data-${name}="${esc(i.v)}" aria-pressed="${i.on}">${i.html}</button>`).join('')
        + '</div></div>';
}

function shellHtml(r: Runtime): string {
    const t = strings.treeStats;
    const groups = STATS_GROUPS.map(g => `<div class="stv-group" role="presentation">${esc(t.groups[g.id])}</div>`
        + g.topics.map(topic => `<button type="button" class="stv-topic sel-opt" data-sel-form="row" data-topic="${topic}">`
            + `<span class="stv-topic-t">${esc(t.topics[topic])}</span><span class="stv-topic-n" aria-hidden="true"></span></button>`).join('')).join('');
    const sc = t.scope;
    return `<div class="modal stv" role="dialog" aria-modal="true" aria-labelledby="stv-title">
        <header class="stv-head">
            <div class="stv-titlebar">
                <h2 class="stv-title" id="stv-title"><span class="stv-title-d">${esc(t.title(r.treeName))}</span><span class="stv-title-p">${esc(t.phoneTitle)}</span></h2>
                <span class="stv-sub"></span>
                <button type="button" class="stv-pexport" data-stv="export" aria-label="${esc(t.phone.exportAria)}">${DOWNLOAD_ICON}</button>
                <button type="button" class="stv-close" data-stv="close" aria-label="${esc(t.close)}">×</button>
            </div>
            <div class="stv-pbtns">
                <button type="button" class="stv-pbtn" data-stv="topic-sheet" aria-haspopup="dialog"></button>
                <button type="button" class="stv-pbtn" data-stv="scope-sheet" aria-haspopup="dialog"></button>
            </div>
            <div class="stv-scope">
                <span class="stv-scope-label" id="stv-scope-l">${esc(sc.label)}</span>
                <button type="button" class="stv-scope-btn" data-stv="scope" aria-haspopup="listbox" aria-expanded="false" aria-describedby="stv-scope-l"></button>
                <span class="stv-period">
                    <label class="stv-period-l" for="stv-from">${esc(sc.from)}</label>
                    <input type="text" class="stv-year" id="stv-from" data-year="from" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(sc.yearPh)}" aria-label="${esc(sc.fromAria)}">
                    <span aria-hidden="true">–</span>
                    <input type="text" class="stv-year" data-year="to" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(sc.yearPh)}" aria-label="${esc(sc.toAria)}">
                    <button type="button" class="stv-year-x" data-stv="clear-period" aria-label="${esc(sc.clearPeriod)}" title="${esc(sc.clearPeriod)}" hidden>×</button>
                </span>
                <span class="stv-count" aria-live="polite"></span>
            </div>
            <p class="stv-scope-note" hidden></p>
        </header>
        <div class="stv-body">
            <nav class="stv-topics" aria-label="${esc(t.topicsLabel)}">${groups}</nav>
            <div class="stv-main">
                <div class="stv-th"><h3 class="stv-th-t"></h3><span class="stv-th-d"></span></div>
                <p class="stv-readonly"${r.active ? ' hidden' : ''}>${esc(t.readOnly)}</p>
                <div class="stv-opts"></div>
                <div class="stv-tools">
                    <input type="search" class="stv-search" autocomplete="off" spellcheck="false">
                    <span class="stv-matches" aria-live="polite"></span>
                    <span class="stv-sortbox"></span>
                </div>
                <div class="stv-area"></div>
            </div>
        </div>
        <footer class="stv-foot">
            <button type="button" class="stv-btn" data-stv="export">${DOWNLOAD_ICON}<span>${esc(t.export.btn)}</span></button>
            <span class="stv-foot-what"></span>
            <button type="button" class="primary stv-foot-close" data-stv="close">${esc(t.close)}</button>
        </footer>
    </div>`;
}

function overlayEl(): HTMLElement | null {
    return document.getElementById(OVERLAY_ID);
}

function q<T extends HTMLElement = HTMLElement>(sel: string): T | null {
    return overlayEl()?.querySelector<T>(sel) ?? null;
}

function rowHeight(): number {
    const m = q('.modal.stv');
    const v = m ? parseFloat(getComputedStyle(m).getPropertyValue('--stv-row-h')) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 32;
}

// ==================== the picker of the scope ====================

function pickerTexts(): SelectionPickerTexts {
    const s = strings.selection;
    const sc = strings.treeStats.scope;
    return {
        button: sc.label, pickLabel: sc.pickLabel, search: sc.search, none: sc.tree, noneSub: sc.treeSub,
        secRods: s.secRods, secPerson: sc.secDirect, secPersons: s.secPersons, secLines: s.secLines, secLists: s.secLists,
        otherPerson: s.otherPerson, current: s.current, person: s.person, changePerson: s.changePerson,
        generations: s.generations, genAll: s.genAll, noLists: s.noLists, noMatch: s.noMatch, saveList: s.saveList, manage: s.manage,
        other: strings.familyPages.otherFams, members: strings.familyPages.nPersons,
        fewer: strings.focus.depthDecrease, more: strings.focus.depthIncrease,
    };
}

function personSub(p: Person): string {
    const b = displayYear(p.birthDate);
    const d = displayYear(p.deathDate);
    const years = b || d ? `${b}${d ? ` – ${d}` : ''}` : '';
    const place = (p.birthPlace ?? '').split(',')[0].trim();
    return [years, place].filter(Boolean).join(' · ');
}

function directRow(r: Runtime, p: Person, sub: string): SelectionPickRow {
    const sel = encodeScope({ kind: 'direct', personId: p.id });
    return {
        sel, label: shownName(p), sub, count: directLineIds(r.index, p.id).length, icon: selectionIcon('ancestors'),
        current: sel === encodeScope(r.win.scope.ref),
    };
}

function foundRowsHtml(r: Runtime, query: string): string {
    const persons = Object.values(r.data.persons).filter(p => p && !p.isPlaceholder);
    const found = filterAndSort(query, persons, r.data).slice(0, FOUND_LIMIT);
    return selectionFoundRowsHtml(found.map(p => directRow(r, p, personSub(p))));
}

function pickerMarkup(r: Runtime): SelectionPickerMarkup {
    const l = lang();
    const current = encodeScope(r.win.scope.ref);
    const items = rodPickerItems(r.index, undefined, undefined, l);
    const offered = rods(r.index).some(x => !x.small);
    // The direct line: the person in focus, the recently chosen, the current one.
    const focus: SelectionPickRow[] = [];
    const seen = new Set<string>();
    const add = (id: PersonId | null | undefined, sub: string): void => {
        const p = realPerson(r.data, id);
        if (!p || seen.has(p.id)) return;
        seen.add(p.id);
        focus.push(directRow(r, p, sub));
    };
    const cur = r.win.scope.ref;
    if (cur?.kind === 'direct') add(cur.personId, personSub(realPerson(r.data, cur.personId) ?? ({} as Person)));
    add(r.focusId, r.active ? strings.selection.focusSub : strings.treeStats.scope.directSub);
    for (const id of readRecent(r.win.treeId).slice(0, 2)) add(id, strings.treeOverview.recent);
    const lists: SelectionPickRow[] = personListsOf(r.data).map(list => {
        const ref: SelectionRef = { kind: 'list', listId: list.id };
        const name = listDisplayName(list);
        const sel = encodeSelectionRef(ref);
        return {
            sel, label: name, sub: strings.lists.kind[listKind(list)], count: selectionPersonIds(r.data, r.index, ref)?.size ?? 0,
            icon: listKindIcon(listKind(list), 15), q: rodPickKey(name), current: sel === current,
        };
    });
    return {
        label: null, current, treeCount: items[0]?.members ?? 0,
        rods: offered ? { items, small: rodPickerSmallItems(r.index, l, r.labels), lo: AXIS_LO, hi: AXIS_HI } : null,
        focus, lines: [], lists, block: null, canSave: false, texts: pickerTexts(),
    };
}

// ==================== the module ====================

export const statsWindowMethods = uiModule({
    /**
     * Open the Statistics of a tree (the open one or another, read only).
     * `open` sets any part of the window's state and the dialog it was
     * opened from.
     */
    async showTreeStats(treeId: string, open: TreeStatsOpen = {}): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId as TreeId);
        const active = TreeManager.getActiveTreeId() === treeId;
        const data = active ? DataManager.getData() : await TreeManager.getTreeData(treeId as TreeId);
        if (!meta || !data) return;
        this.listenForTreeStatsChanges();
        this.listenForStatsRowOpen();
        const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            && !overlayEl()?.contains(document.activeElement) ? document.activeElement : null;
        this.closeTreeStats();
        returnFocus = opener;
        const overview = open.parent === 'tree-overview-modal';
        if (open.parent && !overview) {
            this.closeDialogById(open.parent);
            returnParent = open.parent;
        }
        const index = buildLineages(data);
        const focusId = active
            ? realPerson(data, TreeRenderer.getFocusPersonId())?.id ?? null
            : defaultPersonOf(data);
        rt = {
            win: {
                treeId,
                topic: open.topic && STATS_TOPICS.includes(open.topic) ? open.topic : 'firstNames',
                opts: { ...DEFAULT_STATS_OPTIONS, ...(open.opts ?? {}) },
                scope: open.scope ? { ...open.scope } : { ref: null },
                search: open.search ?? '',
                sort: { ...(open.sort ?? {}) },
            },
            treeName: meta.name, data, active, index, labels: rodLabels(index),
            ctx: statsContext(data, { live: active ? this.placesLivePayload() : null, lang: lang(), labels: valueLabels() }),
            focusId, scoped: null, sex: null, tables: new Map(), shown: [], focusIndex: 0, periodInvalid: false,
        };
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = shellHtml(rt);
        document.body.appendChild(overlay);
        this.wireTreeStats(overlay);
        if (!overview) this.clearDialogStack();
        this.pushDialog(OVERLAY_ID);
        const r = rt;
        const from = q<HTMLInputElement>('.stv-year[data-year="from"]');
        const to = q<HTMLInputElement>('.stv-year[data-year="to"]');
        if (from && r.win.scope.from !== undefined) from.value = String(r.win.scope.from);
        if (to && r.win.scope.to !== undefined) to.value = String(r.win.scope.to);
        const search = q<HTMLInputElement>('.stv-search');
        if (search) search.value = r.win.search;
        this.renderTreeStatsFrame();
        this.computeTreeStats();
        const topic = q(`.stv-topic[data-topic="${r.win.topic}"]`);
        const phone = q('.stv-topics')?.getClientRects().length === 0;
        (phone ? q('.stv-close') : topic)?.focus({ preventScroll: true });
    },

    /** The open tree's Statistics. */
    showActiveTreeStats(): void {
        const id = TreeManager.getActiveTreeId();
        if (id) void this.showTreeStats(id);
    },

    isTreeStatsOpen(): boolean {
        return !!overlayEl();
    },

    /** The window's state now (null: closed). */
    treeStatsState(): StatsWindowState | null {
        if (!rt || !overlayEl()) return null;
        const w = rt.win;
        return { ...w, opts: { ...w.opts }, scope: { ...w.scope }, sort: { ...w.sort } };
    },

    /** Close the window (no way back to a parent). */
    closeTreeStats(): void {
        closePop?.();
        closePicker?.();
        const overlay = overlayEl();
        overlay?.remove();
        this.dialogStack = this.dialogStack.filter(id => id !== OVERLAY_ID);
        if (this.bottomSheet?.classList.contains('stv-sheet-overlay')) this.hideBottomSheet();
        idleRun++;
        rt = null;
        returnParent = null;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = null;
    },

    /** A plain close (×, Escape, backdrop, Close): back to the dialog it was opened from, and the focus too. */
    dismissTreeStats(): void {
        const parent = returnParent;
        const focus = returnFocus;
        returnFocus = null;
        this.closeTreeStats();
        if (parent) {
            this.clearDialogStack();
            this.pushDialog(parent);
            this.openDialogById(parent);
        }
        if (focus?.isConnected) focus.focus({ preventScroll: true });
    },

    /** Escape on the window: the person popover or the scope's choice first. True when it closed something. */
    closeTreeStatsPopover(): boolean {
        if (closePop) { closePop(); return true; }
        if (closePicker) { closePicker(); return true; }
        return false;
    },

    /**
     * A click on a value or on "Not given": the Table shows the row's people
     * (the Statistics and the overview under them close); the Table takes
     * the event over (openTableForPersons).
     */
    onStatsRowOpen(req: StatsRowOpen): void {
        this.closeTreeStats();
        if (this.isTreeOverviewOpen()) this.closeTreeOverview();
        window.dispatchEvent(new CustomEvent<StatsRowOpen>(STATS_ROW_OPEN_EVENT, { detail: req }));
    },

    listenForTreeStatsChanges(): void {
        if (listening) return;
        listening = true;
        const changed = (treeId: string | null | undefined): void => {
            revision++;
            if (!rt || !rt.active || !overlayEl()) return;
            if ((treeId ?? TreeManager.getActiveTreeId()) !== rt.win.treeId) return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                this.refreshTreeStats();
            }, REFRESH_DELAY_MS);
        };
        window.addEventListener('strom:user-change', (e) => changed((e as CustomEvent<{ treeId?: string }>).detail?.treeId));
        window.addEventListener('strom:data-changed', () => changed(null));
        window.addEventListener('strom:tree-switched', () => {
            revision++;
            if (rt) rt.active = TreeManager.getActiveTreeId() === rt.win.treeId;
        });
    },

    /** The open tree's current data in the open window (state, scroll and focus kept). */
    refreshTreeStats(): void {
        const r = rt;
        if (!r || !r.active || !overlayEl()) return;
        r.data = DataManager.getData();
        r.index = buildLineages(r.data);
        r.labels = rodLabels(r.index);
        r.ctx = statsContext(r.data, { live: this.placesLivePayload(), lang: lang(), labels: valueLabels() });
        if (r.focusId && !realPerson(r.data, r.focusId)) r.focusId = realPerson(r.data, TreeRenderer.getFocusPersonId())?.id ?? null;
        this.recomputeTreeStats();
    },

    /** Throw the scope and the tables away and compute again (the chosen topic first). */
    recomputeTreeStats(): void {
        const r = rt;
        if (!r) return;
        r.scoped = null;
        r.sex = null;
        r.tables.clear();
        this.renderTreeStatsFrame();
        this.computeTreeStats();
    },

    /** The idle steps: the scope and the chosen topic, then each other topic's number. */
    computeTreeStats(): void {
        const run = ++idleRun;
        const step = (): void => {
            const r = rt;
            if (run !== idleRun || !r || !overlayEl()) return;
            if (!r.scoped) {
                r.scoped = scopePersonIds(r.data, r.index, r.win.scope);
                r.sex = sexCounts(r.data, r.scoped.ids);
                this.renderTreeStatsScope();
                this.renderTreeStatsOpts();
            }
            if (r.scoped.ids.length === 0) {
                this.renderTreeStatsMain();
                this.renderTreeStatsCounts();
                return;
            }
            if (!cachedTable(r, r.win.topic)) {
                computeTable(r, r.win.topic);
                this.renderTreeStatsMain();
                this.renderTreeStatsCounts();
                whenIdle(step);
                return;
            }
            const next = STATS_TOPICS.find(t => !cachedTable(r, t));
            if (!next) return;
            computeTable(r, next);
            this.renderTreeStatsCounts();
            whenIdle(step);
        };
        whenIdle(step);
    },

    /** Everything that does not wait for a table: the scope row, the topic's head and options, the busy table. */
    renderTreeStatsFrame(): void {
        this.renderTreeStatsScope();
        this.renderTreeStatsTopics();
        this.renderTreeStatsCounts();
        this.renderTreeStatsOpts();
        this.renderTreeStatsMain();
    },

    renderTreeStatsScope(): void {
        const r = rt;
        if (!r) return;
        const t = strings.treeStats;
        const name = scopeName(r);
        const btn = q('.stv-scope-btn');
        if (btn) {
            btn.innerHTML = `<span class="stv-scope-ic" aria-hidden="true">${scopeIcon(r.win.scope.ref)}</span>`
                + `<span class="stv-scope-v">${esc(name)}</span><span class="stv-caret" aria-hidden="true">▾</span>`;
            btn.title = name;
        }
        const x = q('.stv-year-x');
        if (x) x.hidden = !hasPeriod(r.win.scope);
        const count = q('.stv-count');
        const n = r.scoped?.ids.length;
        if (count) count.innerHTML = n === undefined ? '' : strongNumbers(t.scope.persons(n));
        const note = q('.stv-scope-note');
        if (note) {
            const text = r.periodInvalid ? t.scope.invalid
                : hasPeriod(r.win.scope) && r.scoped && r.scoped.noYear > 0 ? t.scope.outOfPeriod(r.scoped.noYear) : '';
            note.textContent = text;
            note.hidden = !text;
            note.classList.toggle('is-invalid', r.periodInvalid);
        }
        const sub = q('.stv-sub');
        if (sub) sub.textContent = n === undefined ? r.treeName : t.phone.sub(r.treeName, n);
        const pTopic = q('.stv-pbtn[data-stv="topic-sheet"]');
        if (pTopic) pTopic.innerHTML = `<span class="stv-pbtn-v">${esc(t.phone.topic(t.topics[r.win.topic]))}</span><span class="stv-caret" aria-hidden="true">▾</span>`;
        const pScope = q('.stv-pbtn[data-stv="scope-sheet"]');
        const pText = hasPeriod(r.win.scope) ? `${name}, ${periodText(r.win.scope)}` : name;
        if (pScope) pScope.innerHTML = `<span class="stv-pbtn-v">${esc(t.phone.scope(pText))}</span><span class="stv-caret" aria-hidden="true">▾</span>`;
    },

    renderTreeStatsTopics(): void {
        const r = rt;
        if (!r) return;
        q('.stv-topics')?.querySelectorAll<HTMLElement>('.stv-topic').forEach(b => {
            const on = b.dataset.topic === r.win.topic;
            if (on) b.setAttribute('aria-current', 'true');
            else b.removeAttribute('aria-current');
            b.tabIndex = on ? 0 : -1;
        });
        const t = strings.treeStats;
        const head = q('.stv-th-t');
        if (head) head.textContent = t.topics[r.win.topic];
        const d = q('.stv-th-d');
        if (d) d.textContent = r.win.topic === 'surnames' && r.win.opts.surnames === 'withMarried' ? t.desc.surnamesMarried : t.desc[r.win.topic];
        const search = q<HTMLInputElement>('.stv-search');
        if (search) {
            search.placeholder = searchPlaceholder(r.win.topic);
            search.setAttribute('aria-label', searchPlaceholder(r.win.topic));
        }
    },

    /** The topics' numbers: distinct values, "–" for a topic without any. */
    renderTreeStatsCounts(): void {
        const r = rt;
        if (!r) return;
        const emptyScope = r.scoped?.ids.length === 0;
        q('.stv-topics')?.querySelectorAll<HTMLElement>('.stv-topic').forEach(b => {
            const topic = b.dataset.topic as StatsTopic;
            const tab = cachedTable(r, topic);
            const n = emptyScope ? 0 : tab ? tab.rows.length : null;
            const el = b.querySelector('.stv-topic-n');
            if (el) el.textContent = n === null ? '' : n === 0 ? strings.treeStats.noValues : num(n);
            b.classList.toggle('is-empty', n === 0);
        });
    },

    /** The options of the chosen topic as segments, and the sort. */
    renderTreeStatsOpts(): void {
        const r = rt;
        if (!r) return;
        const box = q('.stv-opts');
        const sortBox = q('.stv-sortbox');
        if (!box || !sortBox) return;
        const t = strings.treeStats;
        const o = r.win.opts;
        const topic = r.win.topic;
        const tab = cachedTable(r, topic);
        const empty = !!tab && tab.rows.length === 0;
        const parts: string[] = [];
        if (topic === 'firstNames') {
            const n = (k: StatsOptions['sex']): string => r.sex ? ` <span class="stv-seg-n">${num(r.sex[k])}</span>` : '';
            parts.push(seg('sex', t.opt.sex, [
                { v: 'male', html: esc(t.opt.male) + n('male'), on: o.sex === 'male' },
                { v: 'female', html: esc(t.opt.female) + n('female'), on: o.sex === 'female' },
                { v: 'unknown', html: esc(t.opt.unknownSex) + n('unknown'), on: o.sex === 'unknown' },
            ]));
            if (!empty) {
                const lbl = (long: string, short: string): string => `<span class="stv-l-long">${esc(long)}</span><span class="stv-l-short">${esc(short)}</span>`;
                parts.push(seg('names', t.opt.count, [
                    { v: 'first', html: lbl(t.opt.first, t.opt.firstShort), on: o.names === 'first' },
                    { v: 'each', html: lbl(t.opt.each, t.opt.eachShort), on: o.names === 'each' },
                ]));
            }
        } else if (topic === 'surnames' && !empty) {
            parts.push(seg('surnames', t.opt.surname, [
                { v: 'birth', html: esc(t.opt.birthName), on: o.surnames === 'birth' },
                { v: 'withMarried', html: esc(t.opt.withMarried), on: o.surnames === 'withMarried' },
            ]));
        } else if (isPlaceTopic(topic) && tab?.hasLevels && !empty) {
            parts.push(seg('level', t.opt.level, [
                { v: 'town', html: esc(t.opt.town), on: o.level === 'town' },
                { v: 'district', html: esc(t.opt.district), on: o.level === 'district' },
                { v: 'country', html: esc(t.opt.country), on: o.level === 'country' },
            ]));
        } else if (topic === 'births' && !empty) {
            parts.push(seg('births', t.opt.group, [
                { v: 'decade', html: esc(t.opt.decades), on: o.births === 'decade' },
                { v: 'month', html: esc(t.opt.months), on: o.births === 'month' },
            ]));
        }
        box.innerHTML = parts.join('');
        box.hidden = parts.length === 0;
        const sort = sortOf(r, topic);
        const items = isValueTopic(topic)
            ? [{ v: 'value', html: esc(valueSortLabel(topic)), on: sort === 'value' }, { v: 'count', html: esc(t.sort.byCount), on: sort === 'count' }]
            : [{ v: 'count', html: esc(t.sort.byCount), on: sort === 'count' }, { v: 'name', html: esc(t.sort.byName), on: sort === 'name' }];
        sortBox.innerHTML = seg('sort', t.sort.label, items, ' stv-sort');
        const tools = q('.stv-tools');
        const noTable = !tab || empty || r.scoped?.ids.length === 0;
        if (tools) tools.hidden = !!tab && noTable;
    },

    /** The table area: busy, empty, or the table with "Not given", the total and the note. */
    renderTreeStatsMain(): void {
        const r = rt;
        const area = q('.stv-area');
        if (!r || !area) return;
        const t = strings.treeStats;
        const tab = r.scoped?.ids.length === 0 ? null : cachedTable(r, r.win.topic);
        this.renderTreeStatsOpts();
        if (r.scoped && r.scoped.ids.length === 0) {
            const clear = hasPeriod(r.win.scope) ? ` <button type="button" class="tov-link" data-stv="clear-period">${esc(t.scope.clearPeriod)}</button>` : '';
            area.innerHTML = `<p class="stv-empty">${esc(t.empty.scope(scopeDescText(r)))}${clear}</p>`;
            r.shown = [];
            this.renderTreeStatsFoot();
            return;
        }
        if (!tab) {
            area.innerHTML = `<div class="stv-busy tov-busy" role="status"><span class="tov-busy-text">${esc(t.calculating)}</span>`
                + '<span class="tov-busy-bar"></span><span class="tov-busy-bar"></span><span class="tov-busy-bar"></span></div>';
            area.setAttribute('aria-busy', 'true');
            r.shown = [];
            this.renderTreeStatsFoot();
            return;
        }
        area.removeAttribute('aria-busy');
        if (tab.rows.length === 0) {
            area.innerHTML = `<p class="stv-empty">${esc(emptyText(r, tab.topic))}</p>`;
            r.shown = [];
            this.renderTreeStatsFoot();
            return;
        }
        const sort = sortOf(r, tab.topic);
        const ariaSort = (col: 'value' | 'count'): string => {
            const on = col === 'count' ? sort === 'count' : sort !== 'count';
            return on ? (col === 'count' ? 'descending' : 'ascending') : 'none';
        };
        const mark = (col: 'value' | 'count'): string => ariaSort(col) !== 'none' ? '<span class="stv-sortmark" aria-hidden="true">▾</span>' : '';
        const searching = !!r.win.search.trim();
        const none = !searching && tab.noneCount > 0
            ? (r.active
                ? `<button type="button" class="stv-row stv-grid stv-none-row" data-none="" title="${esc(t.rowTitle(tab.noneCount))}">`
                : '<div class="stv-row stv-grid stv-none-row">')
                + `<span class="stv-val is-none">${esc(t.none)}</span><span class="stv-n">${num(tab.noneCount)}</span><span class="stv-pct"></span><span></span><span class="stv-go" aria-hidden="true">›</span>`
                + (r.active ? '</button>' : '</div>')
            : '';
        area.innerHTML = `<div class="stv-table" role="table" aria-label="${esc(t.topics[tab.topic])}">`
            + '<div class="stv-rows" tabindex="-1">'
            + `<div class="stv-hrow stv-grid" role="row" aria-rowindex="1">`
            + `<span role="columnheader" aria-sort="${ariaSort('value')}"><button type="button" class="stv-hsort" data-hsort="value">${esc(valueColumn(r, tab.topic))}${mark('value')}</button></span>`
            + `<span role="columnheader" class="r" aria-sort="${ariaSort('count')}"><button type="button" class="stv-hsort" data-hsort="count">${esc(t.col.count)}${mark('count')}</button></span>`
            + `<span role="columnheader" class="r">${esc(t.col.share)}</span><span role="presentation"></span><span role="presentation" class="stv-go-h"></span></div>`
            + '<div class="stv-vbody" role="rowgroup"></div></div></div>'
            + `<div class="stv-sum">${none}<p class="stv-total" aria-live="polite"></p></div>`
            + `<p class="stv-note"></p>`;
        const rows = area.querySelector<HTMLElement>('.stv-rows');
        rows?.addEventListener('scroll', () => this.renderTreeStatsRows(false), { passive: true });
        this.applyTreeStatsSearch();
    },

    /** Sort and search the chosen table and show it from the top. */
    applyTreeStatsSearch(): void {
        const r = rt;
        if (!r) return;
        const tab = cachedTable(r, r.win.topic);
        if (!tab) return;
        const sorted = sortRows(tab.rows, sortOf(r, tab.topic), lang());
        r.shown = searchRows(sorted, r.win.search);
        r.focusIndex = 0;
        const table = q('.stv-table');
        table?.setAttribute('aria-rowcount', String(r.shown.length + 1));
        const rows = q('.stv-rows');
        if (rows) rows.scrollTop = 0;
        const searching = !!r.win.search.trim();
        const matches = q('.stv-matches');
        if (matches) matches.textContent = searching ? strings.table.matches(r.shown.length) : '';
        const noneRow = q('.stv-none-row');
        if (noneRow) noneRow.hidden = searching;
        const total = q('.stv-total');
        if (total) total.innerHTML = strongNumbers(totalText(r, tab, r.shown));
        const note = q('.stv-note');
        if (note) note.textContent = noteText(r, tab);
        this.renderTreeStatsRows(true);
        this.renderTreeStatsFoot();
    },

    /** The rows in view (all up to VIRTUAL_MIN), each at its fixed place. */
    renderTreeStatsRows(force: boolean): void {
        const r = rt;
        const scroller = q('.stv-rows');
        const body = scroller?.querySelector<HTMLElement>('.stv-vbody');
        if (!r || !scroller || !body) return;
        const tab = cachedTable(r, r.win.topic);
        if (!tab) return;
        const n = r.shown.length;
        const h = rowHeight();
        body.style.height = `${n * h}px`;
        let from = 0;
        let to = n;
        if (n > VIRTUAL_MIN) {
            const head = scroller.querySelector<HTMLElement>('.stv-hrow')?.offsetHeight ?? 34;
            const top = Math.max(0, scroller.scrollTop - head);
            from = Math.max(0, Math.floor(top / h) - OVERSCAN);
            to = Math.min(n, Math.ceil((top + scroller.clientHeight) / h) + OVERSCAN);
        }
        const range = `${from}:${to}:${h}`;
        if (!force && body.dataset.range === range) return;
        body.dataset.range = range;
        const hadFocus = document.activeElement instanceof HTMLElement && body.contains(document.activeElement);
        const l = lang();
        const t = strings.treeStats;
        const q2 = r.win.search.trim();
        const max = tab.rows.reduce((m, row) => Math.max(m, row.count), 0) || 1;
        const tabStop = r.focusIndex >= from && r.focusIndex < to ? r.focusIndex : from;
        const out: string[] = [];
        for (let i = from; i < to; i++) {
            const row = r.shown[i];
            const share = rowShare(tab, row);
            const v2: string[] = [];
            if (row.alt) v2.push(`<span class="v2">${esc(t.alsoForm(row.alt))}</span>`);
            if (row.forms && row.forms.length >= 2) v2.push(`<span class="v2" title="${esc(t.formsTip(row.forms.join(', ')))}">${esc(t.forms(row.forms.length))}</span>`);
            const label = q2 ? highlightHtml(row.label, q2) : esc(row.label);
            const attrs = r.active
                ? ` tabindex="${i === tabStop ? 0 : -1}" title="${esc(t.rowTitle(row.count))}"`
                : '';
            out.push(`<div class="stv-row stv-grid${row.muted ? ' is-muted' : ''}${r.active ? ' is-link' : ''}" role="row" aria-rowindex="${i + 2}" data-i="${i}" style="top:${i * h}px"${attrs}>`
                + `<span class="stv-val" role="cell">${label}${v2.join('')}</span>`
                + `<span class="stv-n" role="cell">${num(row.count)}</span>`
                + `<span class="stv-pct" role="cell">${share === null ? '' : `${shareText(share, l)} %`}</span>`
                + `<span class="stv-bar" aria-hidden="true"><span style="width:${(row.count / max * 100).toFixed(1)}%"></span></span>`
                + '<span class="stv-go" aria-hidden="true">›</span></div>');
        }
        body.innerHTML = out.join('');
        if (hadFocus) body.querySelector<HTMLElement>(`.stv-row[data-i="${r.focusIndex}"]`)?.focus({ preventScroll: true });
    },

    /** The keyboard's row: in view, drawn and focused. */
    focusTreeStatsRow(i: number): void {
        const r = rt;
        const scroller = q('.stv-rows');
        if (!r || !scroller || r.shown.length === 0) return;
        i = Math.max(0, Math.min(r.shown.length - 1, i));
        r.focusIndex = i;
        const h = rowHeight();
        const head = scroller.querySelector<HTMLElement>('.stv-hrow')?.offsetHeight ?? 34;
        const top = head + i * h;
        if (top - head < scroller.scrollTop) scroller.scrollTop = top - head;
        else if (top + h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + h - scroller.clientHeight;
        this.renderTreeStatsRows(true);
        scroller.querySelectorAll<HTMLElement>('.stv-vbody .stv-row').forEach(el => { el.tabIndex = Number(el.dataset.i) === i ? 0 : -1; });
        scroller.querySelector<HTMLElement>(`.stv-row[data-i="${i}"]`)?.focus({ preventScroll: true });
    },

    /** The footer: what Export saves, or why it cannot yet. */
    renderTreeStatsFoot(): void {
        const r = rt;
        if (!r) return;
        const t = strings.treeStats;
        const tab = r.scoped?.ids.length === 0 ? null : cachedTable(r, r.win.topic);
        const waiting = !tab && !(r.scoped && r.scoped.ids.length === 0);
        const nothing = !waiting && (!tab || tab.rows.length === 0 || r.shown.length === 0);
        let what: string;
        if (waiting) what = t.export.waiting;
        else if (nothing) what = t.export.nothing;
        else {
            const parts = [topicWithOpts(r, r.win.topic, tab), scopeDescText(r)];
            const qs = r.win.search.trim();
            if (qs) parts.push(t.export.search(qs));
            what = t.export.what(parts.join(' · '));
        }
        const foot = q('.stv-foot-what');
        if (foot) { foot.textContent = what; foot.title = what; }
        overlayEl()?.querySelectorAll<HTMLElement>('[data-stv="export"]').forEach(b => {
            b.setAttribute('aria-disabled', String(waiting || nothing));
            b.title = what;
        });
    },

    /** Export CSV (§9): the table as shown, saved as a file; nothing is sent. */
    exportTreeStatsCsv(): void {
        const r = rt;
        if (!r) return;
        const tab = r.scoped?.ids.length === 0 ? null : cachedTable(r, r.win.topic);
        if (!tab || tab.rows.length === 0 || r.shown.length === 0) return;
        const t = strings.treeStats;
        const l = lang();
        const qs = r.win.search.trim();
        const what = topicWithOpts(r, tab.topic, tab) + (qs ? `, ${t.export.search(qs)}` : '');
        const desc = t.export.desc(what, scopeDescText(r), r.treeName, new Date().toLocaleDateString(l));
        const csv = statsCsv(tab, r.shown, { desc, head: t.export.head, none: t.export.none, total: t.export.total, searching: !!qs }, l);
        const file = tableCsvFileName(r.treeName, t.export.view(t.topics[tab.topic]), new Date());
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.showToast(t.export.toast(file), 5000);
    },

    /** Choose a topic (the search is the topic's own: cleared). */
    setTreeStatsTopic(topic: StatsTopic): void {
        const r = rt;
        if (!r || r.win.topic === topic) return;
        r.win.topic = topic;
        r.win.search = '';
        const search = q<HTMLInputElement>('.stv-search');
        if (search) search.value = '';
        this.renderTreeStatsTopics();
        this.renderTreeStatsScope();
        this.renderTreeStatsMain();
        if (!cachedTable(r, topic) && r.scoped?.ids.length !== 0) this.computeTreeStats();
    },

    setTreeStatsOption(name: keyof StatsOptions, value: string): void {
        const r = rt;
        if (!r || (r.win.opts as unknown as Record<string, string>)[name] === value) return;
        (r.win.opts as unknown as Record<string, string>)[name] = value;
        if (name === 'births') delete r.win.sort.births;
        this.renderTreeStatsTopics();
        this.renderTreeStatsMain();
        if (!cachedTable(r, r.win.topic)) this.computeTreeStats();
        else this.renderTreeStatsCounts();
        // Other topics' numbers do not read this option; the chosen one's number follows.
        if (!cachedTable(r, r.win.topic)) return;
        this.renderTreeStatsCounts();
    },

    setTreeStatsSort(sort: StatsSort): void {
        const r = rt;
        if (!r) return;
        if (sort === 'value' && !isValueTopic(r.win.topic)) sort = 'name';
        if (sort === 'name' && isValueTopic(r.win.topic)) sort = 'value';
        r.win.sort[r.win.topic] = sort;
        this.renderTreeStatsMain();
    },

    setTreeStatsScope(ref: StatsScopeRef | null): void {
        const r = rt;
        if (!r) return;
        r.win.scope = { ...r.win.scope, ref };
        this.recomputeTreeStats();
    },

    /**
     * The period from the fields: a year as a number, "from" not after
     * "to"; invalid fields are marked and nothing is computed again.
     */
    applyTreeStatsPeriod(root: ParentNode): boolean {
        const r = rt;
        if (!r) return false;
        const fromEl = root.querySelector<HTMLInputElement>('.stv-year[data-year="from"]');
        const toEl = root.querySelector<HTMLInputElement>('.stv-year[data-year="to"]');
        const read = (el: HTMLInputElement | null): number | undefined | false => {
            const v = (el?.value ?? '').trim();
            if (!v) return undefined;
            return /^\d{1,4}$/.test(v) ? Number(v) : false;
        };
        const from = read(fromEl);
        const to = read(toEl);
        const order = typeof from === 'number' && typeof to === 'number' && from > to;
        const badFrom = from === false || order;
        const badTo = to === false || order;
        fromEl?.setAttribute('aria-invalid', String(badFrom));
        toEl?.setAttribute('aria-invalid', String(badTo));
        r.periodInvalid = badFrom || badTo;
        if (r.periodInvalid) {
            this.renderTreeStatsScope();
            return false;
        }
        const scope: StatsScope = { ref: r.win.scope.ref };
        if (typeof from === 'number') scope.from = from;
        if (typeof to === 'number') scope.to = to;
        const same = scope.from === r.win.scope.from && scope.to === r.win.scope.to;
        r.win.scope = scope;
        // The desktop fields follow a period set in the phone's sheet.
        const dFrom = q<HTMLInputElement>('.stv-scope .stv-year[data-year="from"]');
        const dTo = q<HTMLInputElement>('.stv-scope .stv-year[data-year="to"]');
        if (dFrom && dFrom !== fromEl) dFrom.value = scope.from === undefined ? '' : String(scope.from);
        if (dTo && dTo !== toEl) dTo.value = scope.to === undefined ? '' : String(scope.to);
        dFrom?.setAttribute('aria-invalid', 'false');
        dTo?.setAttribute('aria-invalid', 'false');
        if (same) this.renderTreeStatsScope();
        else this.recomputeTreeStats();
        return true;
    },

    clearTreeStatsPeriod(): void {
        const r = rt;
        if (!r) return;
        overlayEl()?.querySelectorAll<HTMLInputElement>('.stv-year').forEach(el => { el.value = ''; el.setAttribute('aria-invalid', 'false'); });
        r.periodInvalid = false;
        if (!hasPeriod(r.win.scope)) { this.renderTreeStatsScope(); return; }
        r.win.scope = { ref: r.win.scope.ref };
        this.recomputeTreeStats();
    },

    /** The window's events (one listener per kind on the overlay). */
    wireTreeStats(overlay: HTMLElement): void {
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.dismissTreeStats();
        });
        overlay.addEventListener('click', (e) => {
            const el = e.target as HTMLElement;
            const r = rt;
            if (!r) return;
            const act = el.closest<HTMLElement>('[data-stv]');
            if (act) {
                const what = act.dataset.stv;
                if (what === 'close') { this.dismissTreeStats(); return; }
                if (what === 'export') { if (act.getAttribute('aria-disabled') !== 'true') this.exportTreeStatsCsv(); return; }
                if (what === 'clear-period') { this.clearTreeStatsPeriod(); return; }
                if (what === 'scope') {
                    // The choice closes on a click outside it: the click that opens it is not one.
                    e.stopPropagation();
                    this.openTreeStatsScopePicker(act);
                    return;
                }
                if (what === 'topic-sheet') { this.showTreeStatsTopicSheet(); return; }
                if (what === 'scope-sheet') { this.showTreeStatsScopeSheet(); return; }
            }
            const topic = el.closest<HTMLElement>('.stv-topic');
            if (topic?.dataset.topic) { this.setTreeStatsTopic(topic.dataset.topic as StatsTopic); return; }
            const opt = el.closest<HTMLElement>('.stv-seg > .sel-opt');
            if (opt) {
                const d = opt.dataset;
                if (d.sort) this.setTreeStatsSort(d.sort as StatsSort);
                else if (d.sex) this.setTreeStatsOption('sex', d.sex);
                else if (d.names) this.setTreeStatsOption('names', d.names);
                else if (d.surnames) this.setTreeStatsOption('surnames', d.surnames);
                else if (d.level) this.setTreeStatsOption('level', d.level);
                else if (d.births) this.setTreeStatsOption('births', d.births);
                return;
            }
            const hs = el.closest<HTMLElement>('.stv-hsort');
            if (hs) { this.setTreeStatsSort(hs.dataset.hsort === 'count' ? 'count' : 'value'); return; }
            if (!r.active) return;
            if (el.closest('.stv-none-row')) { this.openTreeStatsRow(null); return; }
            const row = el.closest<HTMLElement>('.stv-vbody .stv-row');
            if (row) this.openTreeStatsRow(Number(row.dataset.i));
        });
        overlay.addEventListener('input', (e) => {
            const el = e.target;
            if (!(el instanceof HTMLInputElement) || !el.classList.contains('stv-search')) return;
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchTimer = null;
                if (!rt) return;
                rt.win.search = el.value;
                this.applyTreeStatsSearch();
            }, SEARCH_DELAY_MS);
        });
        overlay.addEventListener('change', (e) => {
            const el = e.target;
            if (el instanceof HTMLInputElement && el.classList.contains('stv-year')) this.applyTreeStatsPeriod(q('.stv-scope') ?? overlay);
        });
        overlay.addEventListener('keydown', (e) => {
            const el = e.target as HTMLElement;
            if (el instanceof HTMLInputElement && el.classList.contains('stv-year') && e.key === 'Enter') {
                e.preventDefault();
                this.applyTreeStatsPeriod(q('.stv-scope') ?? overlay);
                return;
            }
            const topic = el.closest<HTMLElement>('.stv-topic');
            if (topic) {
                const all = [...overlay.querySelectorAll<HTMLElement>('.stv-topic')];
                const i = all.indexOf(topic);
                const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
                if (to === null) return;
                e.preventDefault();
                const next = all[Math.max(0, Math.min(all.length - 1, to))];
                all.forEach(b => { b.tabIndex = b === next ? 0 : -1; });
                next.focus();
                return;
            }
            const row = el.closest<HTMLElement>('.stv-vbody .stv-row');
            if (row && rt) {
                const i = Number(row.dataset.i);
                const scroller = q('.stv-rows');
                const page = Math.max(1, Math.floor((scroller?.clientHeight ?? 320) / rowHeight()) - 1);
                const keys: Record<string, number> = {
                    ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rt.shown.length - 1, PageDown: i + page, PageUp: i - page,
                };
                if (e.key in keys) { e.preventDefault(); this.focusTreeStatsRow(keys[e.key]); return; }
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openTreeStatsRow(i); }
            }
        });
    },

    /** A value's people (index into the shown rows) or "Not given" (null) to the Table. */
    openTreeStatsRow(i: number | null): void {
        const r = rt;
        if (!r || !r.active) return;
        const tab = cachedTable(r, r.win.topic);
        if (!tab) return;
        const t = strings.treeStats;
        const row = i === null ? null : r.shown[i];
        if (i !== null && !row) return;
        const ids = row ? row.ids : tab.none;
        const label = t.table.chip(t.chipWhat[tab.topic](row ? row.label : t.chipNone), chipScope(r));
        const back = this.treeStatsState();
        if (!back) return;
        this.onStatsRowOpen({ treeId: r.win.treeId, ids: [...ids], label, back });
    },

    /** The scope's choice under its button (§7.2): a picked scope is the Statistics' own. */
    openTreeStatsScopePicker(anchor: HTMLElement): void {
        const r = rt;
        const overlay = overlayEl();
        if (!r || !overlay) return;
        if (closePicker) { closePicker(); return; }
        ensureFamilyPagesAppCss();
        const host = document.createElement('div');
        host.className = 'scope-pick stv-scope-pick';
        overlay.appendChild(host);
        const box = overlay.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        host.style.left = `${Math.max(8, Math.min(a.left - box.left, box.width - 396))}px`;
        host.style.top = `${a.bottom - box.top}px`;
        const modal = overlay.querySelector<HTMLElement>('.modal.stv')?.getBoundingClientRect();
        host.style.setProperty('--scope-pick-room', `${Math.max(200, (modal?.bottom ?? box.bottom) - a.bottom - 24)}px`);
        host.innerHTML = selectionPickerHtml(pickerMarkup(r));
        const pick = host.querySelector<HTMLDetailsElement>('details.sp-rodpick');
        if (!pick) { host.remove(); return; }
        const abort = new AbortController();
        let closed = false;
        const close = (refocus: boolean): void => {
            if (closed) return;
            closed = true;
            closePicker = null;
            closePop?.();
            abort.abort();
            host.remove();
            anchor.setAttribute('aria-expanded', 'false');
            anchor.classList.remove('is-open');
            if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
        };
        closePicker = () => close(true);
        this.wireTreeStatsPickerExtras(pick, host, () => close(false), abort.signal);
        wireRodPicker(host, (sel) => {
            close(true);
            this.setTreeStatsScope(decodeScope(sel));
        }, { pick, signal: abort.signal, outside: document, markFirst: true, findPersons: (query) => foundRowsHtml(r, query) });
        pick.open = true;
        pick.addEventListener('toggle', () => {
            if (pick.open) return;
            const at = document.activeElement;
            close(!at || at === document.body || host.contains(at));
        }, { signal: abort.signal });
        pick.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault(), { signal: abort.signal });
        anchor.setAttribute('aria-expanded', 'true');
        anchor.classList.add('is-open');
        requestAnimationFrame(() => {
            if (!pick.isConnected) return;
            pick.querySelector<HTMLElement>('.sp-rodpick-list li[aria-current]')?.scrollIntoView({ block: 'nearest' });
            pick.querySelector<HTMLInputElement>('.sp-rodpick-q')?.focus({ preventScroll: true });
        });
    },

    /**
     * The choice's own controls: "Another person…" adds that person's direct
     * line; the footer opens Lists of people (the open tree only).
     */
    wireTreeStatsPickerExtras(pick: HTMLDetailsElement, popHost: HTMLElement, close: () => void, signal?: AbortSignal): void {
        const r = rt;
        if (!r) return;
        if (!r.active) pick.querySelector('.sp-selpick-foot')?.remove();
        pick.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const other = t.closest<HTMLElement>('.sp-selpick-other');
            if (other) {
                e.preventDefault();
                if (closePop) { closePop(); return; }
                const suggested: Array<{ id: PersonId; meta: string }> = [];
                if (r.focusId) suggested.push({ id: r.focusId, meta: strings.treeOverview.inFocus });
                for (const id of readRecent(r.win.treeId)) suggested.push({ id, meta: strings.treeOverview.recent });
                closePop = openPersonPopover({
                    host: popHost, anchor: other, data: r.data, selectedId: null, suggested,
                    labels: { search: strings.lists.pickSearch, list: strings.lists.new.person, noMatch: strings.treeOverview.noMatch },
                    onClose: () => { closePop = null; },
                    onPick: (id) => {
                        const p = realPerson(r.data, id);
                        const list = pick.querySelector<HTMLElement>('.sp-rodpick-list');
                        const head = list?.querySelector<HTMLElement>('.sp-selpick-sh[data-sec="focus"]');
                        if (!p || !list || !head) return;
                        const sel = encodeScope({ kind: 'direct', personId: id });
                        list.querySelectorAll<HTMLElement>('li[data-sec="focus"]:not(.sp-selpick-sh)').forEach(li => { if (li.dataset.sel === sel) li.remove(); });
                        head.insertAdjacentHTML('afterend', selectionFoundRowsHtml([directRow(r, p, personSub(p))], 'focus'));
                        head.nextElementSibling?.querySelector<HTMLElement>('.sp-rodpick-a')?.focus({ preventScroll: true });
                    },
                });
                return;
            }
            if (t.closest('.sp-selpick-manage')) {
                e.preventDefault();
                close();
                this.closeTreeStats();
                this.showPersonLists();
            }
        }, { signal });
    },

    /** A bottom sheet over the window (phone): head with title and ×, the given body. */
    openTreeStatsSheet(title: string, body: string, cls: string): { overlay: HTMLElement; sheet: HTMLElement; close: () => void } {
        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay stv-sheet-overlay';
        overlay.innerHTML = `<div class="bottom-sheet bottom-sheet-menu stv-sheet ${cls}" role="dialog" aria-modal="true" aria-labelledby="stv-sheet-title">`
            + `<div class="stv-sheet-head"><div class="bottom-sheet-handle"></div>`
            + `<div class="stv-sheet-bar"><h2 class="stv-sheet-title" id="stv-sheet-title">${esc(title)}</h2>`
            + `<button type="button" class="stv-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div></div>`
            + `<div class="stv-sheet-body">${body}</div></div>`;
        const sheet = overlay.querySelector<HTMLElement>('.stv-sheet')!;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        sheet.querySelector('.stv-sheet-x')?.addEventListener('click', close);
        const head = sheet.querySelector<HTMLElement>('.stv-sheet-head')!;
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
        requestAnimationFrame(() => overlay.classList.add('active'));
        return { overlay, sheet, close };
    },

    /** The phone's sheet "Topic" (§10.2): the groups and the topics with their numbers. */
    showTreeStatsTopicSheet(): void {
        const r = rt;
        if (!r) return;
        const t = strings.treeStats;
        const body = STATS_GROUPS.map(g => `<div class="bottom-sheet-section">${esc(t.groups[g.id])}</div>`
            + g.topics.map(topic => {
                const tab = cachedTable(r, topic);
                const n = r.scoped?.ids.length === 0 ? 0 : tab ? tab.rows.length : null;
                const on = topic === r.win.topic;
                return `<button type="button" class="bottom-sheet-item sel-opt stv-sheet-row${n === 0 ? ' is-empty' : ''}" data-sel-form="row" data-topic="${topic}"${on ? ' aria-current="true"' : ''}>`
                    + `<span>${esc(t.topics[topic])}</span><span class="stv-sheet-n">${n === null ? '' : n === 0 ? t.noValues : num(n)}</span></button>`;
            }).join('')).join('');
        const { sheet, close } = this.openTreeStatsSheet(t.phone.topicSheet, body, 'stv-topic-sheet');
        sheet.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('[data-topic]');
            if (!b) return;
            close();
            this.setTreeStatsTopic(b.dataset.topic as StatsTopic);
        });
        requestAnimationFrame(() => sheet.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView({ block: 'nearest' }));
    },

    /** The phone's sheet "Scope" (§10.2): the whole tree, the kinds of scope, the birth period, Done. */
    showTreeStatsScopeSheet(): void {
        const r = rt;
        if (!r) return;
        const t = strings.treeStats;
        const sc = t.scope;
        const kind = r.win.scope.ref?.kind ?? null;
        const row = (what: string, label: string, icon: string, on: boolean, chev: boolean): string =>
            `<button type="button" class="bottom-sheet-item sel-opt stv-sheet-row" data-sel-form="row" data-scope-kind="${what}"${on ? ' aria-current="true"' : ''}>`
            + `<span class="stv-sheet-ic" aria-hidden="true">${icon}</span><span class="stv-sheet-l">${esc(label)}</span>`
            + (on && what !== 'tree' ? `<span class="stv-sheet-n">${esc(scopeName(r))}</span>` : '')
            + (chev ? '<span class="stv-sheet-chev" aria-hidden="true">›</span>' : '') + '</button>';
        const offered = rods(r.index).some(x => !x.small);
        const val = (v: number | undefined): string => (v === undefined ? '' : String(v));
        const body = row('tree', sc.tree, selectionIcon('none'), !kind, false)
            + (offered ? row('rods', sc.rodMore, selectionIcon('rod'), kind === 'rod', true) : '')
            + row('focus', sc.directMore, selectionIcon('ancestors'), kind === 'direct', true)
            + row('lists', sc.listMore, selectionIcon('none'), kind === 'list', true)
            + `<div class="bottom-sheet-section">${esc(sc.periodSec)}</div>`
            + `<div class="stv-sheet-period"><label class="stv-sheet-pl"><span>${esc(sc.from)}</span>`
            + `<input type="text" class="stv-year" data-year="from" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(sc.yearPh)}" aria-label="${esc(sc.fromAria)}" value="${val(r.win.scope.from)}"></label>`
            + `<label class="stv-sheet-pl"><span>${esc(sc.to)}</span>`
            + `<input type="text" class="stv-year" data-year="to" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="${esc(sc.yearPh)}" aria-label="${esc(sc.toAria)}" value="${val(r.win.scope.to)}"></label></div>`
            + `<p class="stv-sheet-hint">${esc(sc.periodHint)}</p>`
            + `<div class="stv-sheet-foot"><button type="button" class="primary stv-sheet-done">${esc(t.done)}</button></div>`;
        const { sheet, close } = this.openTreeStatsSheet(t.phone.scopeSheet, body, 'stv-scope-sheet');
        sheet.addEventListener('click', (e) => {
            const el = e.target as HTMLElement;
            if (el.closest('.stv-sheet-done')) {
                if (this.applyTreeStatsPeriod(sheet)) close();
                return;
            }
            const b = el.closest<HTMLElement>('[data-scope-kind]');
            if (!b) return;
            const k = b.dataset.scopeKind!;
            if (k === 'tree') {
                close();
                if (r.win.scope.ref) this.setTreeStatsScope(null);
                return;
            }
            this.showTreeStatsPickerSheet(k);
        });
        sheet.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).classList.contains('stv-year')) {
                e.preventDefault();
                if (this.applyTreeStatsPeriod(sheet)) close();
            }
        });
    },

    /** The scope's choice as a sheet (phone), opened at a section ('rods', 'focus', 'lists'). */
    showTreeStatsPickerSheet(section: string): void {
        const r = rt;
        if (!r) return;
        ensureFamilyPagesAppCss();
        this.hideBottomSheet();
        const title = strings.treeStats.scope.pickLabel;
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay rod-pick-overlay stv-sheet-overlay';
        overlay.innerHTML = `<div class="bottom-sheet rod-pick-sheet" role="dialog" aria-modal="true" aria-labelledby="stv-pick-sheet-title">`
            + `<div class="rod-pick-sheet-head"><div class="bottom-sheet-handle"></div>`
            + `<div class="rod-pick-sheet-bar"><h2 class="rod-pick-sheet-title" id="stv-pick-sheet-title">${esc(title)}</h2>`
            + `<button type="button" class="rod-pick-sheet-x" aria-label="${esc(strings.buttons.close)}">×</button></div></div>`
            + selectionPickerHtml(pickerMarkup(r))
            + '</div>';
        const sheet = overlay.querySelector<HTMLElement>('.rod-pick-sheet')!;
        const pick = sheet.querySelector<HTMLDetailsElement>('details.sp-rodpick')!;
        const close = (): void => { if (this.bottomSheet === overlay) this.hideBottomSheet(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        sheet.querySelector('.rod-pick-sheet-x')?.addEventListener('click', close);
        wireRodPicker(sheet, (sel) => { close(); this.setTreeStatsScope(decodeScope(sel)); },
            { pick, outside: new EventTarget(), markFirst: true, findPersons: (query) => foundRowsHtml(r, query) });
        this.wireTreeStatsPickerExtras(pick, overlay, close);
        pick.addEventListener('toggle', () => { if (!pick.open) close(); });
        pick.querySelector('summary')?.addEventListener('click', (e) => e.preventDefault());
        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        pick.open = true;
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            const head = pick.querySelector<HTMLElement>(`.sp-selpick-sh[data-sec="${CSS.escape(section)}"]`);
            head?.scrollIntoView({ block: 'start' });
        });
    },
});
