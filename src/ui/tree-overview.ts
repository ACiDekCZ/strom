/**
 * Tree overview: one dialog for the state of a tree and what to do next
 * (spec 005). A fixed header (title, the header numbers, the person the
 * rooted sections are calculated from), an accordion of sections and a
 * footer with Close.
 *
 * - The header numbers are computed at once. "Where to focus", "Ancestors"
 *   and any other section remembered open are computed when the dialog
 *   opens; the rest on idle callbacks (life → time → quality → highlights,
 *   one per callback) or at once when expanded first.
 * - A section still calculating shows "Calculating…" after 150 ms and keeps
 *   it at least 300 ms once shown (aria-busy on its body).
 * - Results are cached by section + tree + chosen person + revision; the
 *   revision moves on every data change (edits and undo included) and tree
 *   switch. An open overview of the open tree is refreshed after an edit
 *   (debounced; open sections, the chosen person and the scroll position
 *   kept; postponed while a question is being edited).
 * - Device memory: which sections are open (`overview.open`), whether
 *   Ancestors › Ask the family is open (`overview.rememberers`), the chosen
 *   person per tree (`overview.root.{treeId}`) and the recently chosen ones
 *   (`overview.recent.{treeId}`). Every storage access may fail.
 * - A tree that is not open is read only: actions that change data are
 *   disabled with a hint, "Show in tree" becomes "Open tree and show".
 * - "Show in tree" closes the overview and highlights the group (the
 *   evidence pill with "Back to overview", which reopens it where it was).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { LAST_FOCUSED, Person, PersonId, StromData, TreeId } from '../types.js';
import {
    validateTreeData, translateValidationType, groupValidationIssues, validationCounts, ValidationResult, ValidationIssue,
} from '../validation.js';
import { validationSummaryText, validationGroupTitle } from './tree-stats.js';
import { QUALITY_CHANGED_EVENT } from './quality-ui.js';
import {
    AncestorOverview, FocusCard, GrandparentLine, ancestorGenerationLabel, ancestorGenerations, birthYearOf,
    deathDateOf, focusBirthNoSource, grandparentLines, lineEndIds, overviewHeader, selectFocusCards, OverviewHeader,
    deathAgeSummary, adultLifespanByBirthPeriod, hasEnoughSample, relativeGenerations, childrenPerCoupleByGeneration,
    DeathAgeSummary, PeriodMedian, GenerationChildren, Rememberer, rememberers, remembererGaps, remembererDeathGaps,
    researchCertainty, ResearchCertainty, CertaintyCounts, percentNumber,
} from '../tree-overview.js';
import { FACT_STATUSES } from '../types.js';
import { factStatusLabel } from './fact-status.js';
import { computeFamilyStats, computeCompleteness, computeEvidenceGaps, EvidenceKind, FamilyStats, Completeness } from '../stats.js';
import { isLivingPerson, inferBirthUpperBounds } from '../privacy.js';
import { findComponents, componentName } from '../components.js';
import { orphanedPlaceKeys } from '../places.js';
import { totalPhotoBytes } from '../photo.js';
import { totalAttachmentBytes, ATTACHMENT_WARN_BYTES } from '../attachments.js';
import { upcomingAnniversaries, Anniversary } from '../anniversaries.js';
import { SettingsManager } from '../settings.js';
import { shownName } from '../person-name.js';
import { filterAndSort } from '../person-picker.js';
import { displayYear, yearOf } from '../dates.js';
import { MQ_MOBILE } from '../breakpoints.js';
import { uiModule } from './module.js';
import { evidenceIds, type HighlightGroup } from './evidence-ui.js';

export type SectionId = 'focus' | 'ancestors' | 'life' | 'time' | 'quality' | 'highlights';

export interface TreeOverviewOptions {
    /** Expand this section (the others as remembered). */
    section?: SectionId;
    /** Scroll the section into view. */
    scroll?: boolean;
    /** A dialog hidden while the overview is open and shown again on a plain close (the tree manager). */
    parent?: string;
}

const OVERLAY_ID = 'tree-overview-modal';
/** The dialog a plain close returns to (set by `parent`, dropped by any other close). */
let returnParent: string | null = null;
const ALL_SECTIONS: readonly SectionId[] = ['focus', 'ancestors', 'life', 'time', 'quality', 'highlights'];
/** Computed when the dialog opens (the rest: idle callbacks, or when expanded). */
const EAGER_SECTIONS: readonly SectionId[] = ['focus', 'ancestors'];
/** The order the idle callbacks compute the other sections in, one per callback. */
const IDLE_SECTIONS: readonly SectionId[] = ['life', 'time', 'quality', 'highlights'];
/**
 * Sections calculated from the chosen person (marked ◉). "Life and health"
 * shows only the whole-tree age at death for now, so it is not rooted.
 */
const ROOTED: ReadonlySet<SectionId> = new Set<SectionId>(['focus', 'ancestors', 'time']);
/**
 * Sections recomputed when the chosen person changes: the marked ones, and
 * Data quality, whose "Births without a source" and "Line ends" rows count the
 * chosen person's direct ancestors (marked per row, not on the section).
 */
const ROOT_DEPENDENT: readonly SectionId[] = ['focus', 'ancestors', 'time', 'quality'];
/** Findings listed under Consistency (the rest via "and N more…"). */
const TOP_ISSUES = 5;
/** Upcoming anniversaries: the horizon in days and the most listed. */
const ANNIVERSARY_DAYS = 30;
const MAX_ANNIVERSARIES = 10;
/** Anniversaries this close also say when ("in 3 days", "tomorrow", "today"). */
const ANNIVERSARY_SOON_DAYS = 7;
/** A completeness bar below this share is drawn in the accent (a thin spot). */
const LOW_SHARE = 0.5;
const DEFAULT_OPEN: readonly SectionId[] = ['focus', 'ancestors'];
const OPEN_KEY = 'overview.open';
/** Ancestors › Ask the family: '1' when open (collapsed by default). */
const REMEMBERERS_KEY = 'overview.rememberers';
/** Edits close together refresh an open overview once. */
const REFRESH_DELAY_MS = 120;
const rootKey = (treeId: string): string => `overview.root.${treeId}`;
const recentKey = (treeId: string): string => `overview.recent.${treeId}`;
const MAX_RECENT = 3;
/** "Calculating…" appears after this long … */
const BUSY_DELAY_MS = 150;
/** … and, once shown, stays at least this long. */
const BUSY_MIN_MS = 300;
/** Ancestor rows shown at least (empty generations padded). */
const MIN_ANCESTOR_ROWS = 3;
const PICK_LIMIT = 50;
/** A touch screen: no tooltips to read. */
const MQ_COARSE = '(pointer: coarse)';

/** What one open dialog is about. */
interface OverviewState {
    treeId: string;
    treeName: string;
    data: StromData;
    active: boolean;
    research: boolean;
    rootId: PersonId | null;
    focusId: PersonId | null;
}

let state: OverviewState | null = null;
let revision = 0;
/** The idle chain running (a newer one stops the older). */
let idleRun = 0;
let listening = false;
const cache = new Map<string, unknown>();
/** Where each tree's overview was scrolled when it closed (this session). */
const scrollMemory = new Map<string, number>();
/** Closes the person popover (null: none open). */
let closePopover: (() => void) | null = null;
/** The debounced refresh after an edit (null: none scheduled). */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** An edit came while a question was being edited: refresh when the editor closes. */
let refreshPending = false;
/**
 * The section the overview was opened at (`scroll`): the sections above it
 * fill after a frame and grow, so it is brought into view again as each one
 * fills, until the dialog is scrolled, clicked or typed into.
 */
let scrollTarget: SectionId | null = null;

/**
 * Scroll the overview so `el` starts right under the sticky header. The header
 * sits inside the same scroller (desktop: `.tov-head`; phone: the title bar and
 * the person choice, each sticky on its own), so `scrollIntoView` alone would
 * leave the target's heading under it.
 */
function scrollBelowHeader(el: HTMLElement): void {
    const scroller = el.closest<HTMLElement>('.tov-scroll');
    if (!scroller) { el.scrollIntoView({ block: 'start' }); return; }
    let covered = 0;
    for (const bar of scroller.querySelectorAll<HTMLElement>('.tov-head, .tov-titlebar, .tov-root')) {
        const style = getComputedStyle(bar);
        if (style.position !== 'sticky') continue;
        covered = Math.max(covered, (parseFloat(style.top) || 0) + bar.getBoundingClientRect().height);
    }
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - covered;
}

function isSection(x: unknown): x is SectionId {
    return typeof x === 'string' && (ALL_SECTIONS as readonly string[]).includes(x);
}

function readOpen(): Set<SectionId> {
    try {
        const raw = localStorage.getItem(OPEN_KEY);
        if (raw) {
            const list: unknown = JSON.parse(raw);
            if (Array.isArray(list)) return new Set(list.filter(isSection));
        }
    } catch { /* no storage: defaults */ }
    return new Set(DEFAULT_OPEN);
}

function writeOpen(open: ReadonlySet<SectionId>): void {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* not kept */ }
}

/** Ask the family open, for this session: what a refresh keeps when the device storage cannot. */
let remembersOpen = false;

function readRemembersOpen(): boolean {
    try {
        const v = localStorage.getItem(REMEMBERERS_KEY);
        if (v !== null) return v === '1';
    } catch { /* no storage: this session's state */ }
    return remembersOpen;
}

function writeRemembersOpen(open: boolean): void {
    remembersOpen = open;
    try { localStorage.setItem(REMEMBERERS_KEY, open ? '1' : '0'); } catch { /* kept for this session only */ }
}

/** What can take the keyboard focus inside the dialog. */
const FOCUSABLE = 'button, a[href], input, textarea, select, [tabindex]';

/**
 * Give every focusable element of freshly rendered HTML a `data-key` that the
 * same element gets again after a re-render (scope, action, person or kind,
 * then the occurrence), so a refresh can put the keyboard focus back on it.
 * Elements whose template sets a key keep it.
 */
function stampFocusKeys(scope: HTMLElement, prefix: string): void {
    const seen = new Map<string, number>();
    for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        if (el.dataset.key) continue;
        const d = el.dataset;
        const base = [prefix, d.tov ?? el.tagName.toLowerCase(), d.id ?? '', d.kind ?? '', d.n ?? '', d.month ?? ''].join('|');
        const i = seen.get(base) ?? 0;
        seen.set(base, i + 1);
        d.key = i === 0 ? base : `${base}#${i}`;
    }
}

function readString(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function readRecent(treeId: string): PersonId[] {
    try {
        const list: unknown = JSON.parse(localStorage.getItem(recentKey(treeId)) ?? '[]');
        return Array.isArray(list) ? list.filter((x): x is PersonId => typeof x === 'string') : [];
    } catch { return []; }
}

function rememberRoot(treeId: string, id: PersonId): void {
    try {
        localStorage.setItem(rootKey(treeId), id);
        const recent = [id, ...readRecent(treeId).filter(x => x !== id)].slice(0, MAX_RECENT);
        localStorage.setItem(recentKey(treeId), JSON.stringify(recent));
    } catch { /* not kept */ }
}

const realPerson = (data: StromData, id: string | null | undefined): Person | null => {
    const p = id ? data.persons[id as PersonId] : undefined;
    return p && !p.isPlaceholder ? p : null;
};

/**
 * The person a tree that is not open would start with (its default person
 * setting, as `DataManager.getStartupFocus` reads it, else the first person).
 */
function startupFocusOf(data: StromData): PersonId | null {
    const setting = data.defaultPersonId;
    const chosen = setting === LAST_FOCUSED ? data.lastFocusPersonId : setting;
    const found = realPerson(data, chosen);
    if (found) return found.id;
    return Object.values(data.persons).find(p => !p.isPlaceholder)?.id ?? null;
}

/** One cached computation of the open dialog. */
function cached<T>(section: string, rooted: boolean, compute: () => T): T {
    const st = state!;
    const key = `${section}|${st.treeId}|${rooted ? st.rootId ?? '' : ''}|${revision}`;
    if (cache.has(key)) return cache.get(key) as T;
    const value = compute();
    cache.set(key, value);
    return value;
}

const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** A validation type's name inside a sentence: lower-case first letter, except in German (nouns). */
function typeInSentence(type: string): string {
    const name = translateValidationType(type);
    return getCurrentLanguage() === 'de' ? name : name.charAt(0).toLocaleLowerCase() + name.slice(1);
}

/** "62 %", "5 %", "0,2 %", "< 0,1 %" (percentNumber: the one format of the overview). */
function percentText(part: number, whole: number): string {
    return strings.treeOverview.percent(percentNumber(part, whole, getCurrentLanguage()));
}

/** A generation label split into its faint number and the name ("4." + "generace předků", "5" + "3rd great-…"). */
function generationCell(n: number, esc: (s: string) => string): string {
    const label = ancestorGenerationLabel(n, getCurrentLanguage());
    const prefix = `${n}. `;
    if (label.startsWith(prefix)) {
        return `<span class="tov-gen-n">${n}.</span> ${esc(label.slice(prefix.length))}`;
    }
    return `<span class="tov-gen-n">${n}</span> ${esc(label)}`;
}

/** A grandparent's years: "1801–1870", "* 1801", "† 1870" or "". */
function lifeYears(p: Person): string {
    const b = birthYearOf(p);
    const d = yearOf(deathDateOf(p));
    const born = b ? `${b.approx ? '~' : ''}${b.year}` : '';
    if (born && d !== null) return `${born}–${d}`;
    if (born) return `* ${born}`;
    if (d !== null) return `† ${d}`;
    return '';
}

/** A rememberer's years: "1929–2001", "* 1934, death unknown", "† 2001". */
function remembererYears(r: Rememberer): string {
    const born = r.birthYear ? `${r.birthYear.approx ? '~' : ''}${r.birthYear.year}` : '';
    if (born && r.deathYear !== null) return `${born}–${r.deathYear}`;
    if (born) return strings.treeOverview.remBornDeathUnknown(born);
    return r.deathYear !== null ? `† ${r.deathYear}` : '';
}

/** A section's content and its closed-state summary (both HTML, escaped). */
interface SectionContent {
    body: string;
    summary: string;
}

/** Run on an idle callback (fallback: a 50 ms timeout). */
function whenIdle(run: () => void): void {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 50);
}

/** A number in the UI language ("3,4" in Czech). */
function localNumber(n: number, digits = 0): string {
    return n.toLocaleString(getCurrentLanguage(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Bytes as "14,2 MB" or "640 kB". */
function sizeText(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${localNumber(mb, 1)}\u00a0MB`;
    return `${localNumber(Math.max(1, Math.round(bytes / 1024)))}\u00a0kB`;
}

/** Bar width for `part` of `whole` as a CSS percentage. */
const barWidth = (part: number, whole: number): string => `${whole > 0 ? Math.min(100, (part / whole) * 100).toFixed(2) : '0'}%`;

interface LifeData {
    summary: DeathAgeSummary;
    periods: PeriodMedian[];
}

interface TimeData {
    men: number;
    women: number;
    unknown: number;
    living: number;
    deceased: number;
    /** Children per couple by generation relative to the chosen person (null: no person). */
    children: GenerationChildren[] | null;
}

interface QualityData {
    validation: ValidationResult;
    completeness: Completeness;
    deceased: number;
    deceasedWithDeathDate: number;
    photos: number;
    photoBytes: number;
    events: number;
    sources: number;
    attachments: number;
    attachmentBytes: number;
    /** Real persons, and those without a source (the whole tree; the header's share is the rest). */
    persons: number;
    noSource: number;
    unions: number;
    parts: { name: string; count: number }[];
    orphanPlaces: number;
}

interface HighlightsData {
    stats: FamilyStats;
    avgChildren: number | null;
    anniversaries: Anniversary[];
}

interface FocusData {
    cards: FocusCard[];
    topErrorType: string | null;
}

interface AncestorData {
    overview: AncestorOverview | null;
    lines: GrandparentLine[];
    lineEnds: PersonId[];
}

export const treeOverviewMethods = uiModule({
    /**
     * Open the overview of a tree (the active one or another, read only).
     * `section` expands that section, `scroll` brings it into view.
     */
    async showTreeOverview(treeId: string, opts: TreeOverviewOptions = {}): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId as TreeId);
        const active = TreeManager.getActiveTreeId() === treeId;
        const data = active ? DataManager.getData() : await TreeManager.getTreeData(treeId as TreeId);
        if (!meta || !data) return;
        this.listenForOverviewChanges();
        this.closeTreeOverview();
        if (opts.parent) {
            this.closeDialogById(opts.parent);
            returnParent = opts.parent;
        }

        const focusId = active
            ? realPerson(data, TreeRenderer.getFocusPersonId())?.id ?? null
            : startupFocusOf(data);
        const stored = realPerson(data, readString(rootKey(treeId)))?.id ?? null;
        state = {
            treeId, treeName: meta.name, data, active, research: !!meta.research,
            rootId: stored ?? focusId, focusId,
        };

        const open = readOpen();
        if (opts.section && !open.has(opts.section)) {
            open.add(opts.section);
            writeOpen(open);
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = this.treeOverviewShellHtml(overviewHeader(data), open);
        document.body.appendChild(overlay);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.dismissTreeOverview();
        });
        overlay.addEventListener('click', (e) => this.onTreeOverviewClick(e));
        this.clearDialogStack();
        this.pushDialog(OVERLAY_ID);

        this.fillTreeOverviewSections(open);
        if (opts.section && opts.scroll) {
            scrollTarget = opts.section;
            const stop = (): void => { scrollTarget = null; };
            const scroller = overlay.querySelector<HTMLElement>('.tov-scroll');
            for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) {
                (type === 'keydown' ? overlay : scroller)?.addEventListener(type, stop, { once: true, passive: true });
            }
            this.scrollTreeOverviewToTarget();
        }
        overlay.querySelector<HTMLElement>('.tov-close')?.focus({ preventScroll: true });
    },

    /** Bring the section the overview was opened at right under the dialog's header. */
    scrollTreeOverviewToTarget(): void {
        if (!scrollTarget) return;
        const sec = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-sec[data-section="${scrollTarget}"]`);
        if (sec) scrollBelowHeader(sec);
    },

    /** The focus bar's person count: the overview of the open tree. */
    showActiveTreeOverview(): void {
        const id = TreeManager.getActiveTreeId();
        if (id) void this.showTreeOverview(id);
    },

    /** Close the overview (its scroll position is kept for "Back to overview"). */
    closeTreeOverview(): void {
        closePopover?.();
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            const scroller = overlay.querySelector<HTMLElement>('.tov-scroll');
            if (state && scroller) scrollMemory.set(state.treeId, scroller.scrollTop);
            overlay.remove();
        }
        this.dialogStack = this.dialogStack.filter(id => id !== OVERLAY_ID);
        idleRun++;
        returnParent = null;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        refreshPending = false;
        scrollTarget = null;
    },

    /** A plain close (×, Escape, backdrop): back to the dialog it was opened from, if any. */
    dismissTreeOverview(): void {
        const parent = returnParent;
        this.closeTreeOverview();
        if (parent) {
            this.clearDialogStack();
            this.pushDialog(parent);
            this.openDialogById(parent);
        }
    },

    /** Escape on the overview: the person popover first, then an open question field. True when it closed something. */
    closeTreeOverviewPopover(): boolean {
        if (closePopover) {
            closePopover();
            return true;
        }
        const row = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-rem-row.is-editing`);
        if (!row) return false;
        this.closeTreeOverviewQuestion(row);
        return true;
    },

    isTreeOverviewOpen(): boolean {
        return !!document.getElementById(OVERLAY_ID);
    },

    listenForOverviewChanges(): void {
        if (listening) return;
        listening = true;
        const bump = (): void => {
            revision++;
            cache.clear();
        };
        // An edit or an undo of the open tree (strom:user-change) and a load
        // or import into it (strom:data-changed): the numbers move on, and an
        // open overview of that tree is refreshed once the edits settle.
        const changed = (treeId: string | null | undefined): void => {
            bump();
            if (!state || !state.active || !this.isTreeOverviewOpen()) return;
            if ((treeId ?? TreeManager.getActiveTreeId()) !== state.treeId) return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                this.refreshTreeOverview();
            }, REFRESH_DELAY_MS);
        };
        window.addEventListener('strom:user-change', (e) => changed((e as CustomEvent<{ treeId?: string }>).detail?.treeId));
        window.addEventListener('strom:data-changed', () => changed(null));
        window.addEventListener('strom:tree-switched', bump);
        // A finding marked "not an error" or restored (also by the research).
        window.addEventListener(QUALITY_CHANGED_EVENT, () => changed(null));
    },

    /**
     * Show the open tree's current data in the open overview: the header
     * numbers, the chosen person (another one when the chosen person was
     * deleted) and every section computed so far — open ones at once, closed
     * ones again on the idle callbacks — keeping the scroll position, the
     * expanded parts (sections, Ancestors › Ask the family) and the keyboard
     * focus (back on the element with the same `data-key`, else on the head
     * of its section). Waits while a question is being edited (the editor
     * would be lost).
     */
    refreshTreeOverview(): void {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = null;
        const overlay = document.getElementById(OVERLAY_ID);
        const st = state;
        if (!overlay || !st || !st.active) return;
        if (overlay.querySelector('.tov-rem-editor')) {
            refreshPending = true;
            return;
        }
        refreshPending = false;
        closePopover?.();
        const focused = document.activeElement instanceof HTMLElement && overlay.contains(document.activeElement)
            ? document.activeElement : null;
        const focusKey = focused?.dataset.key ?? null;
        const focusSection = focused?.closest<HTMLElement>('.tov-sec')?.dataset.section ?? null;
        const restoreFocus = (): void => {
            if (!focused || (focused.isConnected && overlay.contains(focused))) return;
            const again = (focusKey ? overlay.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`) : null)
                ?? (focusSection ? overlay.querySelector<HTMLElement>(`#tov-head-${focusSection}`) : null)
                ?? overlay.querySelector<HTMLElement>('.tov-close');
            again?.focus({ preventScroll: true });
        };
        revision++;
        cache.clear();
        st.data = DataManager.getData();
        if (st.focusId && !realPerson(st.data, st.focusId)) st.focusId = null;
        if (!realPerson(st.data, st.rootId)) st.rootId = st.focusId ?? realPerson(st.data, TreeRenderer.getFocusPersonId())?.id ?? null;
        const scroller = overlay.querySelector<HTMLElement>('.tov-scroll');
        const top = scroller?.scrollTop ?? 0;
        const header = overviewHeader(st.data);
        const nums = overlay.querySelector<HTMLElement>('.tov-nums');
        if (!nums || header.persons === 0) {
            // Emptied, or no longer empty: the frame itself changes.
            overlay.innerHTML = this.treeOverviewShellHtml(header, readOpen());
            this.fillTreeOverviewSections(readOpen());
            restoreFocus();
            return;
        }
        nums.innerHTML = this.treeOverviewNumsHtml(header);
        const root = overlay.querySelector<HTMLElement>('.tov-root');
        if (root) root.innerHTML = this.treeOverviewRootHtml();
        for (const id of ALL_SECTIONS) {
            const sec = overlay.querySelector<HTMLElement>(`.tov-sec[data-section="${id}"]`);
            if (!sec || sec.dataset.fill === undefined) continue;
            const isOpen = sec.querySelector('.tov-sec-head')?.getAttribute('aria-expanded') === 'true';
            if (isOpen || EAGER_SECTIONS.includes(id)) {
                this.fillTreeOverviewSection(id, true);
            } else {
                delete sec.dataset.fill;
                sec.dataset.ready = 'false';
                const sum = sec.querySelector<HTMLElement>('.tov-sum');
                if (sum) sum.textContent = '';
            }
        }
        restoreFocus();
        if (scroller) scroller.scrollTop = top;
        this.startTreeOverviewIdle();
    },

    /** The dialog frame: header (title, numbers, read-only banner, person), sections, footer. */
    treeOverviewShellHtml(header: OverviewHeader, open: ReadonlySet<SectionId>): string {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const titleBar = `
            <div class="tov-titlebar">
                <h2 class="tov-title" id="tov-title">${esc(t.title(st.treeName))}</h2>
                <button type="button" class="tov-close" data-tov="close" data-key="close" aria-label="${esc(t.close)}" title="${esc(t.close)}">&times;</button>
            </div>`;
        if (header.persons === 0) {
            return `
            <div class="modal tov tov--empty" role="dialog" aria-modal="true" aria-labelledby="tov-title" data-dialog-kind="info" data-skeleton="skip">
                <div class="tov-scroll">
                    <div class="tov-head">${titleBar}</div>
                    <p class="tov-empty">${esc(t.empty)}</p>
                </div>
                <div class="tov-foot"><button type="button" class="secondary" data-tov="close" data-key="foot-close">${esc(t.close)}</button></div>
            </div>`;
        }
        const nums = this.treeOverviewNumsHtml(header);
        const banner = st.active ? '' : `
            <div class="tov-inactive" role="note">
                <span class="tov-inactive-text">${esc(t.inactive)}</span>
                <button type="button" class="secondary tov-open-tree" data-tov="open-tree" data-key="open-tree">${esc(t.openTree)}</button>
            </div>`;
        const sections = ALL_SECTIONS.map(id => this.treeOverviewSectionHtml(id, open.has(id))).join('');
        return `
            <div class="modal tov" role="dialog" aria-modal="true" aria-labelledby="tov-title" data-dialog-kind="info" data-skeleton="skip">
                <div class="tov-scroll">
                    <div class="tov-head">
                        ${titleBar}
                        <div class="tov-nums">${nums}</div>
                        ${banner}
                        <div class="tov-root">${this.treeOverviewRootHtml()}</div>
                    </div>
                    <div class="tov-sections">${sections}</div>
                </div>
                <div class="tov-foot"><button type="button" class="secondary" data-tov="close" data-key="foot-close">${esc(t.close)}</button></div>
            </div>`;
    },

    /** The header numbers: people · generations · year span · with a source. */
    treeOverviewNumsHtml(header: OverviewHeader): string {
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const num = (value: string, label: string, cls = ''): string =>
            `<span class="tov-num${cls}"><strong>${esc(value)}</strong>${label ? ` ${label}` : ''}</span>`;
        return [
            num(String(header.persons), esc(t.numPersons(header.persons))),
            num(String(header.generations),
                `<span class="tov-gen-long">${esc(t.numGenerations(header.generations))}</span><span class="tov-gen-short">${esc(t.numGenerationsShort)}</span>`),
            header.yearSpan ? num(`${header.yearSpan.first}–${header.yearSpan.last}`, '') : '',
            num(percentText(header.withSource, header.persons), esc(t.numWithSource)),
        ].filter(Boolean).join('<span class="tov-num-sep" aria-hidden="true"> · </span>');
    },

    /** "Ancestors of: [name ▾]  ◉ section is calculated from this person". */
    treeOverviewRootHtml(): string {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const root = realPerson(st.data, st.rootId);
        const name = root ? shownName(root) : t.notSelected;
        return `
            <span class="tov-root-label" id="tov-root-label">${esc(t.rootLabel)}</span>
            <button type="button" class="tov-root-btn${root ? '' : ' tov-root-btn--none'}" data-tov="pick" data-key="root"
                aria-haspopup="listbox" aria-expanded="false" aria-describedby="tov-root-label">
                <span class="tov-root-name">${esc(name)}</span><span class="tov-root-caret" aria-hidden="true">▾</span>
            </button>
            <span class="tov-root-hint"><span aria-hidden="true">◉</span> ${esc(t.rootHint)}</span>`;
    },

    treeOverviewSectionHtml(id: SectionId, open: boolean): string {
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const mark = ROOTED.has(id)
            ? `<span class="tov-mark" title="${esc(t.rootMark)}" aria-label="${esc(t.rootMark)}">◉</span>`
            : '';
        return `
            <section class="tov-sec" data-section="${id}">
                <h3 class="tov-sec-h">
                    <button type="button" class="tov-sec-head" data-tov="toggle" data-key="sec-${id}" aria-expanded="${open}"
                        aria-controls="tov-body-${id}" id="tov-head-${id}">
                        <span class="tov-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
                        <span class="tov-sec-title">${esc(t.sections[id])}</span>${mark}
                        <span class="tov-sum"></span>
                    </button>
                </h3>
                <div class="tov-sec-body" id="tov-body-${id}" role="region" aria-labelledby="tov-head-${id}"${open ? '' : ' hidden'}></div>
            </section>`;
    },

    /**
     * On open: fill "Where to focus", "Ancestors" and every other section
     * that is open, then the remaining ones on idle callbacks.
     */
    fillTreeOverviewSections(open: ReadonlySet<SectionId>): void {
        for (const id of ALL_SECTIONS) {
            if (EAGER_SECTIONS.includes(id) || open.has(id)) this.fillTreeOverviewSection(id);
        }
        this.startTreeOverviewIdle();
    },

    /**
     * Compute the sections not computed yet on idle callbacks, one per
     * callback (life → time → quality → highlights), so their summaries
     * appear without expanding them. Stops when the dialog closes.
     */
    startTreeOverviewIdle(): void {
        const run = ++idleRun;
        const step = (): void => {
            if (run !== idleRun || !state) return;
            const overlay = document.getElementById(OVERLAY_ID);
            if (!overlay) return;
            const next = IDLE_SECTIONS.find(id =>
                overlay.querySelector<HTMLElement>(`.tov-sec[data-section="${id}"]`)?.dataset.fill === undefined);
            if (!next) return;
            this.fillTreeOverviewSection(next, true);
            whenIdle(step);
        };
        whenIdle(step);
    },

    /** One section's content and summary. */
    treeOverviewSectionContent(id: SectionId): SectionContent {
        switch (id) {
            case 'focus': return this.treeOverviewFocusHtml();
            case 'ancestors': return this.treeOverviewAncestorsHtml();
            case 'life': return this.treeOverviewLifeHtml();
            case 'time': return this.treeOverviewTimeHtml();
            case 'quality': return this.treeOverviewQualityHtml();
            case 'highlights': return this.treeOverviewHighlightsHtml();
        }
    },

    /**
     * Fill one section: "Calculating…" (visible after 150 ms) while the
     * result is computed after the next frame, then the content and summary.
     * `now` (the idle callbacks): compute right away, without the indicator.
     */
    fillTreeOverviewSection(id: SectionId, now = false): void {
        const overlay = document.getElementById(OVERLAY_ID);
        const sec = overlay?.querySelector<HTMLElement>(`.tov-sec[data-section="${id}"]`);
        const body = sec?.querySelector<HTMLElement>('.tov-sec-body');
        const sum = sec?.querySelector<HTMLElement>('.tov-sum');
        if (!sec || !body || !sum || !state) return;
        const token = `${state.treeId}|${state.rootId ?? ''}|${revision}|${Date.now()}`;
        sec.dataset.fill = token;
        if (now) {
            const content = this.treeOverviewSectionContent(id);
            body.innerHTML = content.body;
            stampFocusKeys(body, id);
            sum.innerHTML = content.summary;
            body.removeAttribute('aria-busy');
            sec.dataset.ready = 'true';
            return;
        }
        sum.textContent = '';
        body.setAttribute('aria-busy', 'true');
        body.innerHTML = `
            <div class="tov-busy" role="status">
                <span class="tov-busy-text">${this.escapeHtml(strings.treeOverview.calculating)}</span>
                <span class="tov-busy-bar"></span><span class="tov-busy-bar"></span><span class="tov-busy-bar"></span>
            </div>`;
        const start = performance.now();
        const run = (): void => {
            if (sec.dataset.fill !== token || !state) return;
            const html = this.treeOverviewSectionContent(id);
            const elapsed = performance.now() - start;
            const wait = elapsed >= BUSY_DELAY_MS ? Math.max(0, BUSY_DELAY_MS + BUSY_MIN_MS - elapsed) : 0;
            const show = (): void => {
                if (sec.dataset.fill !== token) return;
                body.innerHTML = html.body;
                stampFocusKeys(body, id);
                sum.innerHTML = html.summary;
                body.removeAttribute('aria-busy');
                sec.dataset.ready = 'true';
                this.scrollTreeOverviewToTarget();
            };
            if (wait > 0) setTimeout(show, wait);
            else show();
        };
        sec.dataset.ready = 'false';
        requestAnimationFrame(() => setTimeout(run, 0));
    },

    /**
     * The findings the validation dialog shows (the same counts): those
     * marked "not an error" and those the dialog sets aside left out.
     */
    treeOverviewValidation(): ValidationResult {
        return cached('validation', false, () => {
            const st = state!;
            const { issues } = this.treeValidationShown(validateTreeData(st.data), st.data, st.treeId);
            const { errors, warnings, traces } = validationCounts(issues);
            return { valid: errors === 0, issues, stats: { errors, warnings, infos: traces } };
        });
    },

    treeOverviewAncestorData(): AncestorData {
        return cached('ancestors', true, () => {
            const st = state!;
            if (!st.rootId) return { overview: null, lines: [], lineEnds: [] };
            return {
                overview: ancestorGenerations(st.data, st.rootId),
                lines: grandparentLines(st.data, st.rootId),
                lineEnds: lineEndIds(st.data, st.rootId),
            };
        });
    },

    treeOverviewFocusData(): FocusData {
        return cached('focus', true, () => {
            const st = state!;
            const validation = this.treeOverviewValidation();
            const counts = new Map<string, number>();
            for (const issue of validation.issues) {
                if (issue.severity === 'error') counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
            }
            let topErrorType: string | null = null;
            for (const [type, n] of counts) if (!topErrorType || n > counts.get(topErrorType)!) topErrorType = type;
            const anc = this.treeOverviewAncestorData().overview;
            const cards = selectFocusCards({
                validationErrors: validation.stats.errors,
                generations: anc?.generations ?? [],
                ancestorBirthsNoSource: anc ? focusBirthNoSource(anc) : [],
                rememberers: remembererDeathGaps(this.treeOverviewRemembererData()),
                researchWaiting: st.active && st.research ? this.researchWaitingCount() : undefined,
            });
            return { cards, topErrorType };
        });
    },

    /** A button that changes data: disabled with the hint outside the open tree. */
    treeOverviewActionHtml(action: string, label: string, cls: string, attrs = ''): string {
        const st = state!;
        const esc = (s: string): string => this.escapeHtml(s);
        if (st.active) return `<button type="button" class="${cls}" data-tov="${action}" ${attrs}>${esc(label)}</button>`;
        const hint = strings.treeOverview.disabledHint;
        return `<span class="tov-disabled-wrap"><button type="button" class="${cls} is-disabled" data-tov="disabled" aria-disabled="true"
            title="${esc(hint)}" ${attrs}>${esc(label)}</button><span class="tov-disabled-hint" hidden>${esc(hint)}</span></span>`;
    },

    treeOverviewFocusHtml(): SectionContent {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const { cards, topErrorType } = this.treeOverviewFocusData();
        if (cards.length === 0) return { body: `<p class="tov-good">${esc(t.goodShape)}</p>`, summary: esc(t.focusGood) };
        const show = st.active ? t.actShowInTree : t.openAndShow;
        const lang = getCurrentLanguage();
        const items = cards.map(card => {
            let text = '';
            let button = '';
            let error = false;
            switch (card.kind) {
                case 'validation':
                    error = true;
                    text = t.cardValidation(card.count, topErrorType ? typeInSentence(topErrorType) : '');
                    // Outside the open tree nothing can be fixed, but the details only read:
                    // "Validation details" instead of a disabled "Fix".
                    button = `<button type="button" class="tov-btn tov-btn--danger" data-tov="validation">${esc(st.active ? t.actFix : t.actValidation)}</button>`;
                    break;
                case 'ancestorGap':
                    text = t.cardGap(capitalize(ancestorGenerationLabel(card.n, lang)), card.known, card.expected);
                    button = `<button type="button" class="tov-btn" data-tov="gap" data-n="${card.n}">${esc(show)}</button>`;
                    break;
                case 'birthNoSource':
                    text = t.cardBirth(card.count);
                    button = `<button type="button" class="tov-btn" data-tov="births">${esc(show)}</button>`;
                    break;
                case 'researchWaiting':
                    text = t.cardResearch(card.count);
                    button = `<button type="button" class="tov-btn" data-tov="research">${esc(t.actOpen)}</button>`;
                    break;
                case 'rememberers':
                    text = t.cardRememberers(card.count);
                    button = `<button type="button" class="tov-btn" data-tov="rememberers">${esc(t.actShow)}</button>`;
                    break;
            }
            return `
                <div class="tov-card${error ? ' tov-card--error' : ''}" data-card="${card.kind}">
                    <span class="tov-dot" aria-hidden="true"></span>
                    <span class="tov-card-text">${esc(text)}</span>
                    ${button}
                </div>`;
        }).join('');
        return { body: `<div class="tov-cards">${items}</div>`, summary: esc(t.focusSummary(cards.length)) };
    },

    treeOverviewAncestorsHtml(): SectionContent {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const root = realPerson(st.data, st.rootId);
        if (!root) {
            return {
                body: `<div class="tov-need"><p>${esc(t.needPerson)}</p>
                    <button type="button" class="primary tov-btn-primary" data-tov="pick">${esc(t.choosePerson)}</button></div>`,
                summary: '',
            };
        }
        const { overview, lines, lineEnds } = this.treeOverviewAncestorData();
        const gens = overview?.generations ?? [];
        if (gens.length === 0) {
            return {
                body: `<p class="tov-muted">${esc(t.noParents(shownName(root)))}
                    <button type="button" class="tov-link" data-tov="pick">${esc(t.chooseOther)}</button></p>`,
                summary: esc(t.ancestorsNoParentsSummary),
            };
        }
        const rows = gens.map(g => ({ n: g.n, expected: g.expected, known: g.known, proven: g.proven }));
        for (let n = rows.length + 1; rows.length < MIN_ANCESTOR_ROWS; n++) rows.push({ n, expected: 2 ** n, known: 0, proven: 0 });
        const width = (part: number, whole: number): string => `${Math.min(100, (part / whole) * 100).toFixed(2)}%`;
        const table = rows.map(r => `
            <div class="tov-anc-row" data-n="${r.n}">
                <span class="tov-anc-name">${generationCell(r.n, esc)}</span>
                <span class="tov-bar" aria-hidden="true"><span class="tov-bar-known" style="width:${width(r.known, r.expected)}"></span><span class="tov-bar-doc" style="width:${width(r.proven, r.expected)}"></span></span>
                <span class="tov-anc-ratio">${r.known} / ${r.expected}</span>
                <span class="tov-anc-pct">${esc(percentText(r.known, r.expected))}</span>
                <span class="tov-anc-doc"><span class="tov-anc-doc-short">${esc(t.docShort)} </span>${r.proven}</span>
            </div>`).join('');
        const legend = `
            <div class="tov-anc-row tov-anc-legend" aria-hidden="true">
                <span class="tov-anc-name">${esc(t.colGeneration)}</span>
                <span class="tov-legend">
                    <span><i class="tov-key tov-key--known"></i>${esc(t.colKnown)}</span>
                    <span><i class="tov-key tov-key--doc"></i>${esc(t.colDocumented)}</span>
                    <span><i class="tov-key tov-key--exp"></i>${esc(t.colExpected)}</span>
                </span>
                <span class="tov-anc-ratio">${esc(t.colRatio)}</span>
                <span class="tov-anc-pct">%</span>
                <span class="tov-anc-doc">${esc(t.colDocumented)}</span>
            </div>`;
        // A research tree counts a graded birth as documented only when proven (K3.2).
        const docNote = st.research ? `<p class="tov-note tov-anc-note">${esc(t.docResearchNote)}</p>` : '';
        const collapse = overview && overview.pedigreeCollapse.length > 0
            ? `<p class="tov-collapse">${esc(t.collapse(overview.pedigreeCollapse.length))}</p>` : '';

        const tiles = lines.map(line => {
            const label = `<span class="tov-line-label">${esc(t.lineLabels[line.slot])}</span>`;
            const gp = realPerson(st.data, line.grandparentId);
            if (!gp || line.deepest === null || !line.personId) {
                return `<div class="tov-line" data-slot="${line.slot}">${label}<span class="tov-line-main tov-muted">${esc(t.lineUnknown)}</span></div>`;
            }
            const far = st.data.persons[line.personId];
            const year = line.year ? `, ${esc(t.lineBorn(`${line.year.approx ? '~' : ''}${line.year.year}`))}` : '';
            const via = far.id !== gp.id
                ? `<span class="tov-line-via">${esc(t.lineVia(shownName(gp), lifeYears(gp)))}</span>` : '';
            return `
                <div class="tov-line" data-slot="${line.slot}">
                    ${label}
                    <span class="tov-line-main"><strong>${esc(t.lineDepth(line.deepest))}</strong> · <button type="button" class="tov-link" data-tov="person" data-id="${esc(far.id)}">${esc(shownName(far))}</button>${year}</span>
                    ${via}
                </div>`;
        }).join('');
        const endsButton = lineEnds.length === 0 ? '' : st.active
            ? `<button type="button" class="tov-btn" data-tov="line-ends">${esc(t.lineEndsCount(lineEnds.length))}</button>`
            : `<span class="tov-lines-ends-label">${esc(t.hlLineEnds(lineEnds.length))}</span><button type="button" class="tov-btn" data-tov="line-ends">${esc(t.openAndShow)}</button>`;
        const body = `
            <div class="tov-anc">
                <div class="tov-anc-table">${legend}${table}</div>
                ${docNote}
                ${collapse}
            </div>
            <div class="tov-lines">
                <div class="tov-lines-head"><span class="tov-lines-title">${esc(t.linesTitle)}</span>${endsButton}</div>
                <div class="tov-lines-grid">${tiles}</div>
            </div>
            ${this.treeOverviewRemembererHtml()}`;
        const deepest = gens[gens.length - 1].n;
        return { body, summary: esc(t.ancestorsSummary(overview?.generationOf.size ?? 0, deepest)) };
    },

    /** Everyone within living memory of the chosen person (the list shows those with gaps). */
    treeOverviewRemembererData(): Rememberer[] {
        return cached('rememberers', true, () => {
            const st = state!;
            return st.rootId ? rememberers(st.data, st.rootId, new Date().getFullYear()) : [];
        });
    },

    /**
     * Ancestors › Ask the family: a collapsible block at the end of the
     * section (collapsed by default, remembered), the people who died in the
     * last 100 years with what is missing and the question for relatives.
     */
    treeOverviewRemembererHtml(): string {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const all = this.treeOverviewRemembererData();
        const shown = new Set(remembererGaps(all));
        const list = all.filter(r => shown.has(r.id));
        const open = readRemembersOpen();
        const rows = list.map(r => {
            const p = st.data.persons[r.id];
            const relation = r.kind === 'ancestor'
                ? t.remRelation(r.path)
                : t.remRelation(r.path, { gender: p.gender, half: r.half });
            const meta = [remembererYears(r), relation].filter(Boolean).join(' \u00b7 ');
            const chips = r.missing.map(m => `<span class="tov-chip" data-missing="${m}">${esc(t.remFacts[m])}</span>`).join('');
            const question = r.question
                ? `<span class="tov-rem-q" title="${esc(r.question)}">${esc(t.remQuestion)} ${esc(r.question)}</span>` : '';
            const label = r.question ? t.remEdit : t.remAdd;
            return `
                <div class="tov-rem-row" data-id="${esc(r.id)}">
                    <div class="tov-rem-main">
                        <span class="tov-rem-who"><button type="button" class="tov-link" data-tov="person" data-id="${esc(r.id)}">${esc(shownName(p))}</button>
                            <span class="tov-rem-meta">${esc(meta)}</span></span>
                        <span class="tov-rem-miss">${esc(t.remMissing)}${chips}</span>
                        ${question}
                    </div>
                    ${this.treeOverviewActionHtml('rem-question', label, 'tov-btn tov-rem-btn', `data-id="${esc(r.id)}"`)}
                </div>`;
        }).join('');
        const content = list.length > 0
            ? `<p class="tov-rem-intro">${esc(t.remIntro)}</p><div class="tov-rem-list">${rows}</div>`
            : `<p class="tov-rem-empty">${esc(t.remEmpty)}</p>`;
        return `
            <div class="tov-rem" data-count="${list.length}">
                <h4 class="tov-rem-h">
                    <button type="button" class="tov-rem-head" data-tov="rem-toggle" aria-expanded="${open}" aria-controls="tov-rem-body">
                        <span class="tov-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
                        <span class="tov-rem-title">${esc(list.length > 0 ? t.remTitleCount(list.length) : t.remTitle)}</span>
                        <span class="tov-rem-aside">${esc(t.remAside)}</span>
                    </button>
                </h4>
                <div class="tov-rem-body" id="tov-rem-body"${open ? '' : ' hidden'}>${content}</div>
            </div>`;
    },

    /** Open or close Ancestors › Ask the family (remembered). */
    setTreeOverviewRemembersOpen(open: boolean): void {
        writeRemembersOpen(open);
        const box = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-rem`);
        const head = box?.querySelector<HTMLElement>('.tov-rem-head');
        const body = box?.querySelector<HTMLElement>('.tov-rem-body');
        if (!head || !body) return;
        head.setAttribute('aria-expanded', String(open));
        head.querySelector('.tov-chev')!.textContent = open ? '▾' : '▸';
        body.hidden = !open;
    },

    /** The "Where to focus" card: expand Ancestors › Ask the family and scroll to it. */
    showTreeOverviewRememberers(): void {
        const overlay = document.getElementById(OVERLAY_ID);
        const sec = overlay?.querySelector<HTMLElement>('.tov-sec[data-section="ancestors"]');
        if (!sec) return;
        if (sec.querySelector('.tov-sec-head')?.getAttribute('aria-expanded') !== 'true') this.toggleTreeOverviewSection('ancestors');
        if (!sec.querySelector('.tov-rem')) this.fillTreeOverviewSection('ancestors', true);
        this.setTreeOverviewRemembersOpen(true);
        const box = sec.querySelector<HTMLElement>('.tov-rem');
        if (box) scrollBelowHeader(box);
        box?.querySelector<HTMLElement>('.tov-rem-head')?.focus({ preventScroll: true });
    },

    /** "Add a question" / "Edit question": the field opens inside the row (one editor at a time). */
    openTreeOverviewQuestion(id: PersonId): void {
        if (!state?.active) return;
        const overlay = document.getElementById(OVERLAY_ID);
        const row = overlay?.querySelector<HTMLElement>(`.tov-rem-row[data-id="${CSS.escape(id)}"]`);
        const person = realPerson(state.data, id);
        if (!row || !person) return;
        if (row.querySelector('.tov-rem-editor')) return;
        overlay!.querySelectorAll<HTMLElement>('.tov-rem-row.is-editing').forEach(r => this.closeTreeOverviewQuestion(r, false));
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const fieldId = `tov-rem-field-${row.dataset.id}`;
        const editor = document.createElement('div');
        editor.className = 'tov-rem-editor';
        editor.innerHTML = `
            <label class="tov-rem-label" for="${esc(fieldId)}">${esc(t.remField)}</label>
            <textarea class="tov-rem-input" id="${esc(fieldId)}" rows="3">${esc(person.question ?? '')}</textarea>
            <div class="tov-rem-editor-actions">
                <button type="button" class="tov-btn tov-rem-cancel" data-tov="rem-cancel">${esc(t.remCancel)}</button>
                <button type="button" class="primary tov-btn-primary tov-rem-save" data-tov="rem-save">${esc(t.remSave)}</button>
            </div>`;
        row.classList.add('is-editing');
        row.appendChild(editor);
        const field = editor.querySelector<HTMLTextAreaElement>('textarea')!;
        field.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                this.saveTreeOverviewQuestion(row);
            }
        });
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
    },

    /** Close a row's question editor; `focus` puts the focus back on its button. A refresh postponed meanwhile runs now. */
    closeTreeOverviewQuestion(row: HTMLElement, focus = true): void {
        row.querySelector('.tov-rem-editor')?.remove();
        row.classList.remove('is-editing');
        if (focus) row.querySelector<HTMLElement>('.tov-rem-btn')?.focus({ preventScroll: true });
        if (refreshPending && !document.querySelector(`#${OVERLAY_ID} .tov-rem-editor`)) this.refreshTreeOverview();
    },

    /** "Save question": Person.question through the usual edit (undo, history, save); an empty field clears it. */
    saveTreeOverviewQuestion(row: HTMLElement): void {
        const st = state;
        const id = row.dataset.id as PersonId | undefined;
        const field = row.querySelector<HTMLTextAreaElement>('.tov-rem-input');
        if (!st?.active || !id || !field) return;
        const value = field.value.trim();
        const before = (DataManager.getPerson(id)?.question ?? '').trim();
        row.querySelector('.tov-rem-editor')?.remove();
        row.classList.remove('is-editing');
        if (value !== before) {
            DataManager.updatePerson(id, { question: value });
            TreeRenderer.render();
        }
        this.refreshTreeOverview();
        document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-rem-row[data-id="${CSS.escape(id)}"] .tov-rem-btn`)
            ?.focus({ preventScroll: true });
    },

    /** The research's certainty of births, deaths and marriages (research trees). */
    treeOverviewCertaintyHtml(): string {
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const c = cached<ResearchCertainty>('certainty', false, () => researchCertainty(state!.data));
        // Most certain first, as the legend reads.
        const order = [...FACT_STATUSES].reverse();
        const legend = order.map(k => `<span class="tov-cert-leg"><i class="tov-cert-key tov-cert--${k}" aria-hidden="true"></i>${esc(factStatusLabel(k))}</span>`).join('');
        const row = (fact: keyof ResearchCertainty, counts: CertaintyCounts): string => {
            const label = t.certaintyRows[fact];
            if (counts.total === 0) {
                return `<div class="tov-cert-row" data-fact="${fact}"><span class="tov-cert-label">${esc(label)}</span>
                    <span class="tov-cert-counts tov-muted">${esc(t.certaintyNone)}</span></div>`;
            }
            const parts = order.filter(k => counts[k] > 0);
            const text = parts.map(k => `${factStatusLabel(k)} ${counts[k]}`).join(' \u00b7 ');
            const segments = parts.map(k =>
                `<span class="tov-cert-seg tov-cert--${k}" data-status="${k}" style="width:${barWidth(counts[k], counts.total)}"></span>`).join('');
            return `<div class="tov-cert-row" data-fact="${fact}"><span class="tov-cert-label">${esc(label)}</span>
                <span class="tov-cert-cell"><span class="tov-cert-bar" role="img" aria-label="${esc(`${label}: ${text}`)}">${segments}</span>
                <span class="tov-cert-counts">${esc(text)}</span></span></div>`;
        };
        return `<div class="tov-block tov-cert" data-block="certainty">
            <span class="tov-block-title">${esc(t.certaintyTitle)}</span>
            <span class="tov-note tov-cert-desc">${esc(t.certaintyDesc)}</span>
            <div class="tov-cert-legend">${legend}</div>
            ${row('birth', c.birth)}${row('death', c.death)}${row('marriage', c.marriage)}
        </div>`;
    },

    treeOverviewLifeData(): LifeData {
        return cached('life', false, () => ({
            summary: deathAgeSummary(state!.data),
            periods: adultLifespanByBirthPeriod(state!.data),
        }));
    },

    /** Life and health: for now only the age at death in the whole tree (spec 005 K5.1). */
    treeOverviewLifeHtml(): SectionContent {
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const { summary: s, periods } = this.treeOverviewLifeData();
        const under5 = hasEnoughSample(s.diedUnder5.n);
        const adults = hasEnoughSample(s.adultMedian.n) && s.adultMedian.median !== null;
        const head = `<div class="tov-block-head"><span class="tov-block-title">${esc(t.deathAgeTitle)}</span><span class="tov-block-scope">${esc(t.deathAgeScope)}</span></div>`;
        if (!under5 && !adults) {
            return { body: `<div class="tov-block">${head}<p class="tov-muted">${esc(t.deathAgeNotEnough(s.diedUnder5.n))}</p></div>`, summary: '' };
        }
        const median = adults ? Math.round(s.adultMedian.median!) : 0;
        const tile = (label: string, value: string, note: string, kind: string): string => `
            <div class="tov-tile" data-tile="${kind}">
                <span class="tov-tile-label">${esc(label)}</span>
                ${value ? `<span class="tov-tile-value">${esc(value)}</span>` : ''}
                <span class="tov-tile-note">${esc(note)}</span>
            </div>`;
        const tiles = [
            under5
                ? tile(t.diedUnder5, percentText(s.diedUnder5.count, s.diedUnder5.n), t.diedUnder5Of(s.diedUnder5.count, s.diedUnder5.n), 'under5')
                : tile(t.diedUnder5, '', t.deathAgeNotEnough(s.diedUnder5.n), 'under5'),
            adults
                ? tile(t.adultLifespan, t.adultMedian(median), t.adultOf(s.adultMedian.n), 'adults')
                : tile(t.adultLifespan, '', t.adultNotEnough(s.adultMedian.n), 'adults'),
        ].join('');
        const top = Math.max(...periods.map(p => p.median), 1);
        const bars = periods.length === 0 ? '' : `
            <div class="tov-chart" data-chart="periods">
                <span class="tov-chart-title">${esc(t.periodsTitle)}</span>
                ${periods.map(p => `
                <div class="tov-hbar-row" data-from="${p.from}">
                    <span class="tov-hbar-label">${esc(t.periodLabel(p.from, p.to))}</span>
                    <span class="tov-hbar" aria-hidden="true"><span class="tov-hbar-fill" style="width:${barWidth(p.median, top)}"></span></span>
                    <span class="tov-hbar-value">${esc(t.periodValue(Math.round(p.median)))} <span class="tov-faint">(${esc(t.sampleN(p.n))})</span></span>
                </div>`).join('')}
            </div>`;
        return {
            body: `<div class="tov-block">${head}<div class="tov-tiles">${tiles}</div>${bars}</div>`,
            summary: adults ? esc(t.lifeSummary(median)) : '',
        };
    },

    /** Computed once for "Family through time" and "Highlights" (names, months, records). */
    treeOverviewFamilyStats(): FamilyStats {
        return cached('familyStats', false, () => computeFamilyStats(state!.data));
    },

    treeOverviewTimeData(): TimeData {
        return cached('time', true, () => {
            const st = state!;
            const persons = Object.values(st.data.persons).filter(p => !p.isPlaceholder);
            const year = new Date().getFullYear();
            const bounds = inferBirthUpperBounds(st.data);
            let men = 0, women = 0, unknown = 0, deceased = 0;
            for (const p of persons) {
                if (p.gender === 'male') men++; else if (p.gender === 'female') women++; else unknown++;
                if (!isLivingPerson(p, year, bounds)) deceased++;
            }
            const children = st.rootId && realPerson(st.data, st.rootId)
                ? childrenPerCoupleByGeneration(st.data, relativeGenerations(st.data, st.rootId))
                : null;
            return { men, women, unknown, living: persons.length - deceased, deceased, children };
        });
    },

    /** Family through time: men / women, living / deceased, children per couple, births by month, names. */
    treeOverviewTimeHtml(): SectionContent {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const lang = getCurrentLanguage();
        const d = this.treeOverviewTimeData();
        const stats = this.treeOverviewFamilyStats();
        const split = (kind: string, label: string, parts: { text: string; n: number; cls: string }[]): string => {
            const total = parts.reduce((sum, x) => sum + x.n, 0);
            const shown = parts.filter(x => x.n > 0);
            return `
                <div class="tov-split" data-split="${kind}">
                    <span class="tov-split-label">${esc(label)}</span>
                    <span class="tov-split-counts">${shown.map(x => esc(x.text).replace(/^(\d+)/, '<strong>$1</strong>')).join(' · ')}</span>
                    <span class="tov-split-bar" aria-hidden="true">${shown.map(x =>
                        `<span class="${x.cls}" style="width:${barWidth(x.n, total)}"></span>`).join('')}</span>
                </div>`;
        };
        const splits = `
            <div class="tov-splits">
                ${split('sex', t.menWomen, [
                    { text: t.men(d.men), n: d.men, cls: 'tov-split-male' },
                    { text: t.women(d.women), n: d.women, cls: 'tov-split-female' },
                    { text: t.unknownSex(d.unknown), n: d.unknown, cls: 'tov-split-unknown' },
                ])}
                ${split('living', t.livingDeceased, [
                    { text: t.living(d.living), n: d.living, cls: 'tov-split-living' },
                    { text: t.deceased(d.deceased), n: d.deceased, cls: 'tov-split-deceased' },
                ])}
            </div>`;

        // Children per couple, by generation relative to the chosen person.
        let children: string;
        const root = realPerson(st.data, st.rootId);
        if (!d.children || !root) {
            children = `<div class="tov-need"><p>${esc(t.childrenNeedPerson)}</p>
                <button type="button" class="primary tov-btn-primary" data-tov="pick">${esc(t.choosePerson)}</button></div>`;
        } else {
            const couples = d.children.reduce((sum, g) => sum + g.n, 0);
            const rows = d.children.filter(g => g.n >= 2);
            if (!hasEnoughSample(couples) || rows.length === 0) {
                children = `<p class="tov-muted">${esc(t.childrenNotEnough(couples))}</p>`;
            } else {
                const top = Math.max(...rows.map(g => g.avgChildren), 1);
                children = rows.map(g => `
                    <div class="tov-hbar-row" data-generation="${g.generation}" title="${esc(t.couplesN(g.n))}">
                        <span class="tov-hbar-label">${esc(capitalize(ancestorGenerationLabel(-g.generation, lang, 'of')))}</span>
                        <span class="tov-hbar" aria-hidden="true"><span class="tov-hbar-fill" style="width:${barWidth(g.avgChildren, top)}"></span></span>
                        <span class="tov-hbar-value">${esc(localNumber(g.avgChildren, 1))}</span>
                    </div>`).join('') + `<span class="tov-note">${esc(t.childrenGenNote(shownName(root)))}</span>`;
            }
        }
        const childrenBlock = `<div class="tov-chart" data-chart="children"><span class="tov-chart-title">${esc(t.childrenByGen)}</span>${children}</div>`;

        // Births by month.
        let months: string;
        if (!hasEnoughSample(stats.birthsByMonthN)) {
            months = `<p class="tov-muted">${esc(t.monthsNotEnough(stats.birthsByMonthN))}</p>`;
        } else {
            const top = Math.max(...stats.birthsByMonth.map(m => m.count), 1);
            // The full month and its count: a tooltip for the mouse, the label for
            // a screen reader, and on touch (no tooltip) a tap shows it under the chart.
            months = `
                <div class="tov-months">${stats.birthsByMonth.map(m => {
                    const text = esc(t.monthBirths(t.monthNames[m.month - 1], m.count));
                    return `
                    <span class="tov-month" role="img" data-tov="month" data-month="${m.month}" title="${text}" aria-label="${text}">
                        <span class="tov-month-col" aria-hidden="true"><span class="tov-month-fill" style="height:${barWidth(m.count, top)}"></span></span>
                        <span class="tov-month-label" aria-hidden="true">${esc(t.monthMarks[m.month - 1])}</span>
                    </span>`;
                }).join('')}
                </div>
                <p class="tov-month-detail tov-note" aria-live="polite" hidden></p>`;
        }
        const monthsBlock = `<div class="tov-chart" data-chart="months"><span class="tov-chart-title">${esc(t.birthsByMonth)}</span>${months}</div>`;

        // Most common first names.
        const names = (title: string, list: { name: string; count: number }[], kind: string): string => list.length === 0 ? '' : `
            <div class="tov-names-col" data-names="${kind}">
                <span class="tov-chart-title">${esc(title)}</span>
                ${list.map(n => `<div class="tov-name-row"><span>${esc(n.name)}</span><span class="tov-name-n">${n.count}</span></div>`).join('')}
            </div>`;
        const namesHtml = names(t.topMaleNames, stats.topMaleNames, 'male') + names(t.topFemaleNames, stats.topFemaleNames, 'female');
        const namesBlock = namesHtml ? `<div class="tov-names">${namesHtml}</div>` : '';

        return {
            body: splits + childrenBlock + monthsBlock + namesBlock,
            summary: esc(t.timeSummary(d.men, d.women)),
        };
    },

    treeOverviewQualityData(): QualityData {
        return cached('quality', false, () => {
            const st = state!;
            const data = st.data;
            const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
            const year = new Date().getFullYear();
            const bounds = inferBirthUpperBounds(data);
            let deceased = 0, deceasedWithDeathDate = 0, photos = 0, events = 0, attachments = 0;
            for (const p of persons) {
                if (!isLivingPerson(p, year, bounds)) {
                    deceased++;
                    if (p.deathDate) deceasedWithDeathDate++;
                }
                if (p.photo) photos++;
                events += p.events?.length ?? 0;
                attachments += p.attachments?.length ?? 0;
            }
            const parts = findComponents(data).filter(c => c.count > 0).map(c => ({
                name: componentName(c, strings.split.familyName, strings.split.noSurname), count: c.count,
            }));
            return {
                validation: this.treeOverviewValidation(),
                completeness: computeCompleteness(data),
                deceased, deceasedWithDeathDate,
                photos, photoBytes: totalPhotoBytes(data), events,
                sources: Object.keys(data.sources ?? {}).length,
                attachments, attachmentBytes: totalAttachmentBytes(data),
                persons: persons.length,
                noSource: computeEvidenceGaps(data).noSource.length,
                unions: Object.keys(data.partnerships).length,
                parts: parts.length > 1 ? parts : [],
                orphanPlaces: orphanedPlaceKeys(data).length,
            };
        });
    },

    /** Data quality: consistency, completeness, missing evidence, structure, quick actions. */
    treeOverviewQualityHtml(): SectionContent {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const q = this.treeOverviewQualityData();
        const v = q.validation.stats;
        const block = (kind: string, title: string, content: string): string =>
            `<div class="tov-block" data-block="${kind}"><span class="tov-block-title">${esc(title)}</span>${content}</div>`;

        // Consistency (ZADANI_DEV §1.5): the dialog's summary sentence, the five
        // most serious Problems in the dialog's group order, "and N more…" (the
        // other Problems), and the Leads as one line that opens the dialog on them.
        const sections = groupValidationIssues(q.validation.issues, validationGroupTitle);
        const problems = sections.find(sec => sec.category === 'problem')?.groups.flatMap(g => g.issues) ?? [];
        const leads = sections.find(sec => sec.category === 'trace')?.count ?? 0;
        const counts = problems.length + leads === 0
            ? `<p class="tov-muted">${esc(t.noErrors(0, 0))}</p>`
            : `<p class="tov-summary${v.errors > 0 ? ' tov-summary--err' : ''}">${esc(validationSummaryText({ errors: v.errors, warnings: v.warnings, traces: v.infos }))}</p>`;
        const findings = problems.slice(0, TOP_ISSUES).map(issue => {
            const who = (issue.personIds ?? []).map(id => realPerson(st.data, id)).filter((p): p is Person => !!p)
                .map(p => `<button type="button" class="tov-link" data-tov="person" data-id="${esc(p.id)}">${esc(shownName(p))}</button>`)
                .join(', ');
            // The godparent or the place the finding is about: without it the line
            // says "a godparent keeps turning up" and never which one.
            const subject = !issue.subject ? ''
                : issue.type === 'recurringGodparent' ? t.findingGodparent(issue.subject)
                : issue.type === 'placeSpelling' ? t.findingPlace(issue.subject) : '';
            return `<div class="tov-finding tov-finding--${issue.severity}"><span class="tov-dot" aria-hidden="true"></span>`
                + `${who ? `<span class="tov-finding-who">${who}</span>` : ''}<span class="tov-finding-what">${esc(translateValidationType(issue.type))}</span>`
                + `${subject ? `<span class="tov-finding-subject">${esc(subject)}</span>` : ''}</div>`;
        }).join('');
        const more = problems.length > TOP_ISSUES
            ? `<button type="button" class="tov-link tov-more" data-tov="validation">${esc(t.moreIssues(problems.length - TOP_ISSUES))}</button>` : '';
        const leadsRow = leads > 0
            ? `<div class="tov-leads"><span class="tov-dot" aria-hidden="true"></span>`
                + `<button type="button" class="tov-link" data-tov="validation-leads">${esc(`${strings.treeManager.overviewLeads(leads)} ›`)}</button></div>`
            : '';
        const consistency = block('consistency', t.consistencyTitle, counts + (findings ? `<div class="tov-findings">${findings}</div>` : '') + more + leadsRow);

        // Completeness: four bars (the share with a source is the header's
        // number, so it is not repeated here), the tree's content, the media warning.
        const c = q.completeness;
        const bar = (kind: string, label: string, part: number, whole: number): string => {
            if (whole === 0) return '';
            const low = part / whole < LOW_SHARE;
            return `<div class="tov-comp-row" data-field="${kind}">
                <span class="tov-comp-label">${esc(label)}</span>
                <span class="tov-comp-track" aria-hidden="true"><span class="tov-comp-fill${low ? ' is-low' : ''}" style="width:${barWidth(part, whole)}"></span></span>
                <span class="tov-comp-pct">${esc(percentText(part, whole))}</span></div>`;
        };
        const content = [
            q.photos > 0 ? t.contentPhotos(q.photos, sizeText(q.photoBytes)) : '',
            q.events > 0 ? t.contentEvents(q.events) : '',
            q.sources > 0 ? t.contentSources(q.sources) : '',
            q.attachments > 0 ? t.contentAttachments(q.attachments, sizeText(q.attachmentBytes)) : '',
        ].filter(Boolean);
        const completeness = block('completeness', t.completenessTitle,
            bar('birthDate', t.fieldBirthDate, c.withBirthDate, c.total)
            + bar('deathDate', t.fieldDeathDate, q.deceasedWithDeathDate, q.deceased)
            + bar('birthPlace', t.fieldBirthPlace, c.withBirthPlace, c.total)
            + bar('photo', t.fieldPhoto, c.withPhoto, c.total)
            + (content.length ? `<span class="tov-note tov-content">${esc(`${t.contentLabel} ${content.join(' · ')}`)}</span>` : '')
            + (q.photoBytes + q.attachmentBytes > ATTACHMENT_WARN_BYTES ? `<span class="tov-warn">${esc(t.mediaWarning)}</span>` : ''));

        // Where evidence is missing: people without a source in the whole tree
        // (with the header's "N % with a source" it makes all people); births
        // without a source and line ends among the chosen person's direct
        // ancestors ("X of N ancestors", marked ◉).
        const show = st.active ? t.actShowInTree : t.openAndShow;
        const anc = this.treeOverviewAncestorData();
        const ancestors = anc.overview?.generationOf.size ?? 0;
        const mark = `<span class="tov-mark" title="${esc(t.rootMark)}" aria-label="${esc(t.rootMark)}">◉</span>`;
        const evRows: { kind: EvidenceKind; label: string; count: string; rooted: boolean; n: number }[] = [
            { kind: 'noSource', label: t.evNoSource, count: t.evOfTotal(q.noSource, q.persons), rooted: false, n: q.noSource },
        ];
        if (anc.overview && ancestors > 0) {
            const births = anc.overview.birthNoSource.length;
            evRows.push(
                { kind: 'birthNoSource', label: st.research ? t.evBirthUnproven : t.evBirthNoSource, count: t.evOfAncestors(births, ancestors), rooted: true, n: births },
                { kind: 'lineEnds', label: t.evLineEnds, count: t.evOfAncestors(anc.lineEnds.length, ancestors), rooted: true, n: anc.lineEnds.length },
            );
        }
        const rows = evRows.filter(r => r.n > 0);
        const evidence = block('evidence', t.evidenceTitle,
            (rows.length === 0
                ? `<p class="tov-muted">${esc(t.evAllGood)}</p>`
                : rows.map(r => `
                    <div class="tov-ev-row" data-evidence="${r.kind}">
                        <span class="tov-ev-label">${esc(r.label)}${r.rooted ? ` ${mark}` : ''}</span>
                        <span class="tov-ev-count">${esc(r.count)}</span>
                        <button type="button" class="tov-btn" data-tov="evidence" data-kind="${r.kind}">${esc(show)}</button>
                    </div>`).join(''))
            + `<button type="button" class="tov-link tov-ev-levels" data-tov="levels">${esc(t.evLevels)}</button>`);

        // Structure: unions and the unconnected parts.
        const structure = block('structure', t.structureTitle, q.parts.length > 1
            ? `<span class="tov-struct-line">${esc(t.unions(q.unions))} · ${esc(t.parts(q.parts.length))}</span>
               <ul class="tov-parts">${q.parts.map(part => `<li>${esc(t.partItem(part.name, part.count))}</li>`).join('')}</ul>
               <span class="tov-note">${esc(t.partsHint)}</span>
               <div class="tov-actions">${this.treeOverviewActionHtml('separate', t.separateParts, 'tov-btn')}</div>`
            : `<span class="tov-struct-line">${esc(t.unions(q.unions))}. ${esc(t.allConnected)}</span>`);

        // Quick actions.
        const clean = st.active && q.orphanPlaces === 0
            ? `<button type="button" class="tov-btn is-disabled" disabled>${esc(t.actCleanPlaces(0))}</button>`
            : this.treeOverviewActionHtml('clean-places', t.actCleanPlaces(q.orphanPlaces), 'tov-btn');
        const actions = block('actions', t.quickActions, `<div class="tov-actions">
            <button type="button" class="tov-btn" data-tov="validation">${esc(t.actValidation)}</button>
            ${clean}
            ${this.treeOverviewActionHtml('split-families', t.actSplitFamilies, 'tov-btn')}
        </div>`);

        const summary = [
            v.errors > 0
                ? `<span class="tov-sum-err">${esc(t.countErrors(v.errors))}</span>${v.warnings > 0 ? `, ${esc(t.countWarnings(v.warnings))}` : ''}`
                : esc(t.qualityNoErrors) + (v.warnings > 0 ? ` · ${esc(t.countWarnings(v.warnings))}` : ''),
            q.parts.length > 1 ? esc(t.qualityParts(q.parts.length)) : '',
        ].filter(Boolean).join(' · ');
        const certainty = st.research ? this.treeOverviewCertaintyHtml() : '';
        return { body: consistency + completeness + certainty + evidence + structure + actions, summary };
    },

    treeOverviewHighlightsData(): HighlightsData {
        return cached('highlights', false, () => {
            const data = state!.data;
            const unions = Object.values(data.partnerships);
            const children = unions.reduce((sum, u) => sum + (u.childIds?.length ?? 0), 0);
            return {
                stats: this.treeOverviewFamilyStats(),
                avgChildren: unions.length > 0 ? children / unions.length : null,
                anniversaries: upcomingAnniversaries(data, new Date(), ANNIVERSARY_DAYS, SettingsManager.isDeathAnniversariesEnabled())
                    .slice(0, MAX_ANNIVERSARIES),
            };
        });
    },

    /** Highlights: the records (names link to the person) and the anniversaries of the next 30 days. */
    treeOverviewHighlightsHtml(): SectionContent {
        const st = state!;
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const lang = getCurrentLanguage();
        const { stats, avgChildren, anniversaries } = this.treeOverviewHighlightsData();
        const who = (id: PersonId | undefined, text: string): string => id && realPerson(st.data, id)
            ? `<button type="button" class="tov-link tov-tile-who" data-tov="person" data-id="${esc(id)}">${esc(text)}</button>`
            : `<span class="tov-tile-who">${esc(text)}</span>`;
        const tile = (kind: string, label: string, value: string, person = ''): string => `
            <div class="tov-tile" data-tile="${kind}">
                <span class="tov-tile-label">${esc(label)}</span>
                <span class="tov-tile-value">${esc(value)}</span>
                ${person}
            </div>`;
        const tiles = [
            stats.oldest ? tile('oldest', t.recOldest, t.recYears(stats.oldest.years), who(stats.oldest.id, stats.oldest.name)) : '',
            stats.longestMarriage ? tile('marriage', t.recMarriage, t.recYears(stats.longestMarriage.years),
                who(stats.longestMarriage.ids[0], stats.longestMarriage.names)) : '',
            stats.largestFamily ? tile('children', t.recChildren, t.recChildCount(stats.largestFamily.count),
                who(stats.largestFamily.ids[0], stats.largestFamily.names)) : '',
            avgChildren !== null ? tile('average', t.recAverage, localNumber(avgChildren, 1)) : '',
        ].filter(Boolean).join('');
        const items = anniversaries.map(item => {
            const names = item.personIds.map(id => {
                const p = st.data.persons[id as PersonId];
                return p ? shownName(p) : '';
            });
            // English day first, as every date of the app ('15 May'), not the US 'May 15'.
            const date = item.date.toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { day: 'numeric', month: 'long' });
            const label = this.anniversaryLabel(item, names);
            // Within a week also "in 3 days" / "tomorrow" / "today" on the right; later ones only the date.
            const a = strings.anniversaries;
            const when = item.daysUntil > ANNIVERSARY_SOON_DAYS ? ''
                : item.daysUntil === 0 ? a.today : item.daysUntil === 1 ? a.tomorrow : a.inDays(item.daysUntil);
            return `<div class="tov-anni${item.daysUntil === 0 ? ' tov-anni--today' : ''}">
                <span class="tov-anni-date">${esc(date)}</span>
                <span class="tov-anni-sep" aria-hidden="true">·</span>
                ${who(item.personIds[0] as PersonId, label)}${when ? `<span class="tov-anni-when">${esc(when)}</span>` : ''}</div>`;
        }).join('');
        const annis = `<div class="tov-block" data-block="anniversaries"><span class="tov-block-title">${esc(t.anniversariesTitle)}</span>
            ${items || `<p class="tov-muted">${esc(t.noAnniversaries)}</p>`}</div>`;
        return {
            body: (tiles ? `<div class="tov-tiles tov-tiles--records">${tiles}</div>` : '') + annis,
            summary: anniversaries.length > 0 ? esc(t.highlightsSummary(anniversaries.length)) : '',
        };
    },

    /** One click handler for the whole dialog (delegated by data-tov). */
    onTreeOverviewClick(e: MouseEvent): void {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tov]');
        if (!target || !state) return;
        const st = state;
        switch (target.dataset.tov) {
            case 'close':
                this.dismissTreeOverview();
                return;
            case 'toggle':
                this.toggleTreeOverviewSection(target.closest<HTMLElement>('.tov-sec')?.dataset.section as SectionId);
                return;
            case 'pick':
                this.openTreeOverviewPicker();
                return;
            case 'open-tree':
                void this.openTreeFromOverview();
                return;
            case 'disabled': {
                const hint = target.parentElement?.querySelector<HTMLElement>('.tov-disabled-hint');
                if (hint) hint.hidden = !hint.hidden;
                return;
            }
            case 'validation':
                void this.showTreeValidationDialog(st.treeId, OVERLAY_ID);
                return;
            case 'validation-leads':
                void this.showTreeValidationDialog(st.treeId, OVERLAY_ID, { leads: true });
                return;
            case 'research':
                this.closeTreeOverview();
                this.showResearchWaiting();
                return;
            case 'rememberers':
                this.showTreeOverviewRememberers();
                return;
            case 'rem-toggle':
                this.setTreeOverviewRemembersOpen(target.getAttribute('aria-expanded') !== 'true');
                return;
            case 'rem-question':
                if (target.dataset.id) this.openTreeOverviewQuestion(target.dataset.id as PersonId);
                return;
            case 'rem-cancel': {
                const row = target.closest<HTMLElement>('.tov-rem-row');
                if (row) this.closeTreeOverviewQuestion(row);
                return;
            }
            case 'rem-save': {
                const row = target.closest<HTMLElement>('.tov-rem-row');
                if (row) this.saveTreeOverviewQuestion(row);
                return;
            }
            case 'gap': {
                const n = Number(target.dataset.n);
                const card = this.treeOverviewFocusData().cards.find(c => c.kind === 'ancestorGap');
                if (!card || card.kind !== 'ancestorGap') return;
                const label = capitalize(ancestorGenerationLabel(n, getCurrentLanguage()));
                const root = st.rootId!;
                let missing = card.count;
                void this.startTreeOverviewHighlight({
                    kind: 'ancestorGap', cite: false, personIds: card.ids,
                    title: () => strings.treeOverview.hlGap(label, missing),
                    recount: () => {
                        const g = ancestorGenerations(DataManager.getData(), root).generations.find(x => x.n === n);
                        missing = g ? g.expected - g.filled : 0;
                        return g?.gapIds ?? [];
                    },
                });
                return;
            }
            case 'births': {
                const root = st.rootId!;
                const ids = focusBirthNoSource(this.treeOverviewAncestorData().overview!);
                void this.startTreeOverviewHighlight({
                    kind: 'birthNoSource', cite: true, personIds: ids,
                    title: (n) => (st.research ? strings.treeOverview.hlBirthUnproven : strings.treeOverview.hlBirth)(n),
                    recount: () => focusBirthNoSource(ancestorGenerations(DataManager.getData(), root)),
                });
                return;
            }
            case 'line-ends': {
                const root = st.rootId!;
                void this.startTreeOverviewHighlight({
                    kind: 'lineEnds', cite: false, personIds: this.treeOverviewAncestorData().lineEnds,
                    title: (n) => strings.treeOverview.hlLineEnds(n),
                    recount: () => lineEndIds(DataManager.getData(), root),
                });
                return;
            }
            case 'person': {
                const id = target.dataset.id as PersonId;
                void this.focusPersonFromOverview(id);
                return;
            }
            case 'evidence': {
                const kind = target.dataset.kind as EvidenceKind;
                const t = strings.treeOverview;
                if (kind === 'noSource') {
                    // The whole tree.
                    void this.startTreeOverviewHighlight({
                        kind, cite: true, title: t.hlNoSource,
                        personIds: evidenceIds(st.data, kind, null),
                        recount: () => evidenceIds(DataManager.getData(), kind, null),
                    });
                    return;
                }
                // The chosen person's direct ancestors.
                const root = st.rootId;
                if (!root) return;
                const ids = (data: StromData): PersonId[] => kind === 'birthNoSource'
                    ? ancestorGenerations(data, root).birthNoSource
                    : lineEndIds(data, root);
                void this.startTreeOverviewHighlight({
                    kind, cite: kind === 'birthNoSource',
                    title: kind === 'birthNoSource' ? (st.research ? t.hlBirthUnproven : t.hlBirth) : t.hlLineEnds,
                    personIds: ids(st.data),
                    recount: () => ids(DataManager.getData()),
                });
                return;
            }
            case 'levels':
                void this.showEvidenceLevelsFromOverview();
                return;
            case 'month':
                this.showTreeOverviewMonth(target);
                return;
            case 'separate':
                void this.showSplitDialog(st.treeId, OVERLAY_ID);
                return;
            case 'clean-places':
                void Promise.resolve(this.cleanOrphanPlaces()).then(() => {
                    if (state !== st || !this.isTreeOverviewOpen()) return;
                    st.data = DataManager.getData();
                    cache.clear();
                    this.fillTreeOverviewSection('quality');
                });
                return;
            case 'split-families':
                this.closeTreeOverview();
                this.showSplitFamiliesDialog();
                return;
        }
    },

    /**
     * Births by month on touch, where the tooltip cannot be seen: a tap on a
     * column writes its month and count under the chart (a second tap on the
     * same column hides it again).
     */
    showTreeOverviewMonth(column: HTMLElement): void {
        if (!window.matchMedia(MQ_COARSE).matches) return;
        const chart = column.closest<HTMLElement>('.tov-chart');
        const detail = chart?.querySelector<HTMLElement>('.tov-month-detail');
        if (!chart || !detail) return;
        const again = column.classList.contains('is-picked');
        chart.querySelectorAll('.tov-month.is-picked').forEach(el => el.classList.remove('is-picked'));
        if (again) {
            detail.hidden = true;
            detail.textContent = '';
            return;
        }
        column.classList.add('is-picked');
        detail.textContent = column.getAttribute('aria-label') ?? '';
        detail.hidden = false;
    },

    /** "Evidence in the tree": close the overview (opening its tree first) and frame every card by its level. */
    async showEvidenceLevelsFromOverview(): Promise<void> {
        if (!state) return;
        const { treeId, active } = state;
        this.closeTreeOverview();
        if (!active) await this.switchToTree(treeId as TreeId);
        this.listenForEvidenceChanges();
        this.showEvidenceLevels();
    },

    toggleTreeOverviewSection(id: SectionId): void {
        if (!isSection(id)) return;
        const sec = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-sec[data-section="${id}"]`);
        const head = sec?.querySelector<HTMLElement>('.tov-sec-head');
        const body = sec?.querySelector<HTMLElement>('.tov-sec-body');
        if (!sec || !head || !body) return;
        const open = readOpen();
        const nowOpen = head.getAttribute('aria-expanded') !== 'true';
        if (nowOpen) open.add(id); else open.delete(id);
        writeOpen(open);
        head.setAttribute('aria-expanded', String(nowOpen));
        head.querySelector('.tov-chev')!.textContent = nowOpen ? '▾' : '▸';
        body.hidden = !nowOpen;
        if (nowOpen && sec.dataset.ready !== 'true' && sec.dataset.fill === undefined) this.fillTreeOverviewSection(id);
    },

    /** A new person for the rooted sections: remembered for the tree, the sections recomputed. */
    setTreeOverviewRoot(id: PersonId): void {
        if (!state || !realPerson(state.data, id)) return;
        state.rootId = id;
        rememberRoot(state.treeId, id);
        const overlay = document.getElementById(OVERLAY_ID);
        const root = overlay?.querySelector<HTMLElement>('.tov-root');
        if (root) root.innerHTML = this.treeOverviewRootHtml();
        // The rooted sections computed (or computing) are recomputed: an open
        // one at once, a closed one again on the idle callbacks.
        for (const sid of ROOT_DEPENDENT) {
            const sec = overlay?.querySelector<HTMLElement>(`.tov-sec[data-section="${sid}"]`);
            if (!sec || sec.dataset.fill === undefined) continue;
            if (sec.querySelector('.tov-sec-head')?.getAttribute('aria-expanded') === 'true') {
                this.fillTreeOverviewSection(sid);
            } else {
                delete sec.dataset.fill;
                sec.dataset.ready = 'false';
                const sum = sec.querySelector<HTMLElement>('.tov-sum');
                if (sum) sum.textContent = '';
            }
        }
        this.startTreeOverviewIdle();
    },

    /** The person popover: search, then the person in focus and the recently chosen. */
    openTreeOverviewPicker(): void {
        if (!state) return;
        const st = state;
        const overlay = document.getElementById(OVERLAY_ID);
        const button = overlay?.querySelector<HTMLElement>('.tov-root-btn');
        if (!overlay || !button) return;
        closePopover?.();
        const t = strings.treeOverview;
        const esc = (s: string): string => this.escapeHtml(s);
        const pop = document.createElement('div');
        pop.className = 'tov-pop';
        pop.innerHTML = `
            <input type="search" class="tov-pop-search" placeholder="${esc(t.searchPerson)}" aria-label="${esc(t.searchPerson)}"
                autocomplete="off" spellcheck="false">
            <div class="tov-pop-list" role="listbox" aria-label="${esc(t.rootLabel)}"></div>`;
        overlay.appendChild(pop);
        const place = (): void => {
            if (window.matchMedia(MQ_MOBILE).matches) {
                pop.style.left = '16px';
                pop.style.right = '16px';
                pop.style.width = 'auto';
            } else {
                const r = button.getBoundingClientRect();
                pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`;
            }
            const r = button.getBoundingClientRect();
            pop.style.top = `${r.bottom + 6}px`;
            pop.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 22)}px`;
        };
        place();
        const input = pop.querySelector<HTMLInputElement>('.tov-pop-search')!;
        const list = pop.querySelector<HTMLElement>('.tov-pop-list')!;
        const persons = Object.values(st.data.persons).filter(p => !p.isPlaceholder);
        const row = (p: Person, meta: string): string => {
            const born = p.birthDate ? `* ${displayYear(p.birthDate)}` : '';
            const sub = [born, meta].filter(Boolean).join(' · ');
            return `<button type="button" class="tov-pop-row" role="option" data-id="${esc(p.id)}" aria-selected="${p.id === st.rootId}">
                <span class="tov-pop-name">${esc(shownName(p))}</span>${sub ? `<span class="tov-pop-meta">${esc(sub)}</span>` : ''}</button>`;
        };
        const render = (): void => {
            const q = input.value.trim();
            let html = '';
            if (!q) {
                const seen = new Set<PersonId>();
                const focus = realPerson(st.data, st.focusId);
                if (focus) { html += row(focus, t.inFocus); seen.add(focus.id); }
                for (const id of readRecent(st.treeId)) {
                    const p = realPerson(st.data, id);
                    if (p && !seen.has(p.id)) { html += row(p, t.recent); seen.add(p.id); }
                }
                if (!html) html = filterAndSort('', persons, st.data).slice(0, PICK_LIMIT).map(p => row(p, '')).join('');
            } else {
                const found = filterAndSort(q, persons, st.data).slice(0, PICK_LIMIT);
                html = found.length ? found.map(p => row(p, '')).join('') : `<div class="tov-pop-none">${esc(t.noMatch)}</div>`;
            }
            list.innerHTML = html;
        };
        render();
        button.setAttribute('aria-expanded', 'true');
        const onDown = (e: MouseEvent): void => {
            if (!pop.contains(e.target as Node) && !button.contains(e.target as Node)) close();
        };
        const close = (): void => {
            pop.remove();
            document.removeEventListener('mousedown', onDown, true);
            button.setAttribute('aria-expanded', 'false');
            if (closePopover === close) closePopover = null;
        };
        closePopover = close;
        document.addEventListener('mousedown', onDown, true);
        input.addEventListener('input', render);
        pop.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
                button.focus();
                return;
            }
            const rows = [...list.querySelectorAll<HTMLElement>('.tov-pop-row')];
            const at = rows.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                rows[Math.min(rows.length - 1, at + 1)]?.focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (at <= 0) input.focus(); else rows[at - 1]?.focus();
            } else if (e.key === 'Enter' && document.activeElement === input && rows[0]) {
                e.preventDefault();
                rows[0].click();
            }
        });
        list.addEventListener('click', (e) => {
            const r = (e.target as HTMLElement).closest<HTMLElement>('.tov-pop-row');
            if (!r) return;
            e.stopPropagation();
            close();
            this.setTreeOverviewRoot(r.dataset.id as PersonId);
            document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-root-btn`)?.focus();
        });
        input.focus();
    },

    /** "Open tree" in the read-only banner: switch to the tree and show its overview again. */
    async openTreeFromOverview(): Promise<void> {
        if (!state) return;
        const { treeId } = state;
        const scroller = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-scroll`);
        const top = scroller?.scrollTop ?? 0;
        this.closeTreeOverview();
        await this.switchToTree(treeId as TreeId);
        await this.showTreeOverview(treeId);
        const again = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-scroll`);
        if (again) again.scrollTop = top;
    },

    /** "Show in tree": close the overview, open its tree, highlight the group with "Back to overview". */
    async startTreeOverviewHighlight(group: Omit<HighlightGroup, 'returnTo'>): Promise<void> {
        if (!state) return;
        const { treeId, active } = state;
        this.closeTreeOverview();
        if (!active) await this.switchToTree(treeId as TreeId);
        this.highlightGroup({ ...group, returnTo: () => void this.reopenTreeOverview(treeId) });
    },

    /** Back to the overview where it was (sections as remembered, the same scroll position). */
    async reopenTreeOverview(treeId: string): Promise<void> {
        const top = scrollMemory.get(treeId) ?? 0;
        await this.showTreeOverview(treeId);
        const scroller = document.querySelector<HTMLElement>(`#${OVERLAY_ID} .tov-scroll`);
        if (!scroller) return;
        // The sections fill after a frame: restore once they have their height.
        const restore = (): void => { scroller.scrollTop = top; };
        restore();
        requestAnimationFrame(() => setTimeout(restore, 0));
        setTimeout(restore, BUSY_DELAY_MS + BUSY_MIN_MS + 20);
    },

    /** A person's name in the lines: close the overview and centre them (opening their tree first). */
    async focusPersonFromOverview(id: PersonId): Promise<void> {
        if (!state) return;
        const { treeId, active } = state;
        this.closeTreeOverview();
        if (!active) await this.switchToTree(treeId as TreeId);
        TreeRenderer.setFocus(id);
    },
});
