/**
 * tree stats UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { upcomingAnniversaries } from '../anniversaries.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import {
    Person,
    PersonId,
    PartnershipId,
    PartnershipStatus,
    Gender,
    RelationType,
    RelationContext,
    StromData,
    TreeId,
    LAST_FOCUSED,
    LastFocusedMarker
} from '../types.js';
import { strings } from '../strings.js';
import { totalPhotoBytes } from '../photo.js';
import { totalAttachmentBytes, ATTACHMENT_WARN_BYTES } from '../attachments.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from '../ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog, personSourceIds } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import {
    validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue, translateValidationType,
    groupValidationIssues, validationCounts, issueCategory, type IssueCategory, type ValidationGroup,
} from '../validation.js';
import { visibleValidation, summaryKind, dismissalFor, dismissalKey, dismissBody } from '../quality-dismiss.js';
import { QUALITY_CHANGED_EVENT } from './quality-ui.js';
import type { QualityDismissal } from '../types.js';
import { isLivingPerson, inferBirthUpperBounds } from '../privacy.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { yearOf, parseFlexDate, formatFlexDate } from '../dates.js';
import { computeFamilyStats, computeCompleteness } from '../stats.js';
import { findComponents, componentName } from '../components.js';
import { orphanedPlaceKeys } from '../places.js';
import { shownNameOrEmpty } from '../person-name.js';

/**
 * What a finding of the tree check shows besides the app's own word: the
 * research's verdict on a possible duplicate (ZADANI_DEV §3). The hook
 * `validationRowExtra` gives none today; the verdicts fill it in.
 */
export interface ValidationRowExtra {
    /** A label (and its reason) above the row's people, as trusted HTML. */
    badgeHtml?: string;
    /** The monospace detail is not shown under a verdict. */
    hideDetail?: boolean;
    /** Actions before "Not an error" / "Two different people" (e.g. Merge…), as trusted HTML. */
    actionsHtml?: string;
    /** Order inside the group: lower first; rows without a rank after those with one, in the app's order. */
    rank?: number;
    /** Told apart elsewhere: not counted, not in the group's rows, kept for `validationAsideHtml`. */
    setAside?: boolean;
}

/** What the tree check shows: the findings counted, and those set aside per group type (validationRowExtra). */
export interface ValidationShown {
    issues: ValidationIssue[];
    aside: Map<string, ValidationIssue[]>;
}

/** The dialog's own state while it is open (not kept between openings). */
interface ValidationView {
    treeId: string;
    /** Sections opened or closed by hand (else the default). */
    sections: Partial<Record<IssueCategory, boolean>>;
    /** Groups opened or closed by hand (else open when the group holds an error). */
    groups: Map<string, boolean>;
    /** Rows shown of a long group. */
    shown: Map<string, number>;
    dismissedOpen: boolean;
    /** Watches the toast with Undo (the body's room under the last row ends with it). */
    toastTimer: number | null;
}

/** A long group (≥ 50 rows) shows its rows by this many. */
const LONG_GROUP = 50;
const GROUP_STEP = 20;
/** The toast with Undo after "Not an error" stays this long (ms). */
const DISMISS_TOAST_MS = 6000;
const DISMISS_TOAST_KIND = 'quality-dismiss';

let view: ValidationView | null = null;
let listening = false;

const isPhone = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;

/** The title of a group: the type's name; a possible duplicate without the old "(same name and birth year)". */
export function validationGroupTitle(type: string): string {
    return type === 'possibleDuplicate' ? strings.treeManager.valGroupPossibleDuplicate : translateValidationType(type);
}

/** The summary sentence of the dialog and the Tree overview (ZADANI_DEV §1.1), from the counts shown. */
export function validationSummaryText(c: { errors: number; warnings: number; traces: number }): string {
    const s = strings.treeManager;
    switch (summaryKind(c)) {
        case 'errors': return s.summaryErrors(c.errors, c.warnings, c.traces);
        case 'noErrors': return s.summaryNoErrors(c.warnings, c.traces);
        case 'leadsOnly': return s.summaryLeadsOnly(c.traces);
        default: return s.validationPassed;
    }
}

/** "* 1820, † 1881" of a person, or '' without either year. */
function lifeYears(p: Person | undefined): string {
    if (!p) return '';
    const b = yearOf(p.birthDate);
    const d = yearOf(p.deathDate);
    return [b !== null ? `* ${b}` : '', d !== null ? `† ${d}` : ''].filter(Boolean).join(', ');
}

/** The name of a mark's or a finding's person in this tree (the id when it is gone). */
function personLabel(data: StromData, id: string): string {
    const p = data.persons[id as PersonId];
    return p ? (shownNameOrEmpty(p) || id) : id;
}

export const treeStatsMethods = uiModule({
    /**
     * Show tree validation dialog (checks for genealogical inconsistencies).
     * `opts.leads`: opened from the Tree overview's "n leads" — the Problems
     * closed, the Leads open and scrolled to.
     */
    async showTreeValidationDialog(treeId: string, parentDialogId?: string, opts: { leads?: boolean } = {}): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        const treeData = await this.treeValidationData(treeId);
        if (!tree || !treeData) return;

        const modal = document.getElementById('tree-validation-modal');
        const title = document.getElementById('tree-validation-title');
        const content = document.getElementById('tree-validation-content');

        if (title) {
            title.textContent = `${strings.treeManager.validationTitle}: ${tree.name}`;
        }

        this.listenForQualityMarks();
        this.endDismissToastRoom();
        view = {
            treeId, sections: {}, groups: new Map(), shown: new Map(), dismissedOpen: false, toastTimer: null,
        };
        if (opts.leads) view.sections = { problem: false, trace: true };

        if (content) {
            const result = validateTreeData(treeData);
            content.innerHTML = this.generateTreeValidationHtml(result, treeData, treeId);
            this.bindTreeValidationActions(content, result, treeId);
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('tree-validation-modal');

        modal?.classList.add('active');
        if (opts.leads && content) {
            requestAnimationFrame(() => {
                content.querySelector<HTMLElement>('.vq-section[data-section="trace"]')?.scrollIntoView({ block: 'start' });
            });
        }
    },

    closeTreeValidationDialog(): void {
        document.getElementById('tree-validation-modal')?.classList.remove('active');
        this.endDismissToastRoom();
        view = null;
        this.returnToParentDialog();
    },

    /** The data of the checked tree: the open tree as it is in memory, another one as stored. */
    async treeValidationData(treeId: string): Promise<StromData | null> {
        if (!DataManager.isViewMode() && TreeManager.getActiveTreeId() === treeId) return DataManager.getData();
        return TreeManager.getTreeData(treeId as TreeId);
    },

    /** Nothing in the checked tree can be changed: a read-only view, or the tree is locked. */
    treeValidationReadOnly(treeId: string): boolean {
        return DataManager.isReadOnly() || TreeManager.isTreeUnreadable(treeId as TreeId);
    },

    /** Redraw the open dialog when the marks change (the research's bridge, an undo, another edit). */
    listenForQualityMarks(): void {
        if (listening) return;
        listening = true;
        const redraw = (): void => {
            if (!view || !document.getElementById('tree-validation-modal')?.classList.contains('active')) return;
            void this.refreshTreeValidationDialog(view.treeId);
        };
        window.addEventListener(QUALITY_CHANGED_EVENT, redraw);
        window.addEventListener('strom:user-change', redraw);
    },

    /**
     * Re-render validation dialog with fresh data (after a fix), keeping the
     * scroll position and the keyboard focus.
     */
    async refreshTreeValidationDialog(treeId: string): Promise<void> {
        const treeData = await this.treeValidationData(treeId);
        if (!treeData) return;

        const content = document.getElementById('tree-validation-content');
        if (!content) return;

        const scroller = content.closest<HTMLElement>('.modal-content') ?? content;
        const top = scroller.scrollTop;
        const focusKey = document.activeElement instanceof HTMLElement && content.contains(document.activeElement)
            ? document.activeElement.dataset.focusKey ?? null : null;

        const result = validateTreeData(treeData);
        content.innerHTML = this.generateTreeValidationHtml(result, treeData, treeId);
        this.bindTreeValidationActions(content, result, treeId);

        scroller.scrollTop = top;
        if (focusKey) content.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    },

    /**
     * Person links and Fix buttons of the validation dialog. The repairs edit
     * the loaded tree, so a Fix on another tree switches to it first —
     * otherwise it would "repair" the active tree (person ids of a duplicated
     * tree even match) and leave the checked one as it was. "Not an error"
     * and Restore do the same.
     */
    bindTreeValidationActions(content: HTMLElement, result: TreeValidationResult, treeId: string): void {
        const inTree = async (change: () => void): Promise<void> => {
            if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
            if (TreeManager.getActiveTreeId() !== treeId) return;
            change();
            void this.refreshTreeValidationDialog(treeId);
        };
        const redraw = (): void => { void this.refreshTreeValidationDialog(treeId); };
        content.onclick = (e) => {
            const target = e.target as HTMLElement;
            const issueAt = (el: HTMLElement): ValidationIssue | undefined => {
                const idx = el.getAttribute('data-issue-idx');
                return idx !== null ? result.issues[parseInt(idx, 10)] : undefined;
            };
            if (target.classList.contains('validation-person-link')) {
                e.preventDefault();
                const treeIdAttr = target.getAttribute('data-tree-id');
                const personIdAttr = target.getAttribute('data-person-id');
                if (treeIdAttr && personIdAttr) {
                    void this.focusPersonFromValidation(treeIdAttr, personIdAttr);
                }
                return;
            }
            if (target.classList.contains('validation-fix-btn')) {
                e.preventDefault();
                const issue = issueAt(target);
                if (issue) void inTree(() => { DataManager.repairValidationIssue(issue); });
                return;
            }
            if (target.classList.contains('validation-fix-all-btn')) {
                e.preventDefault();
                void inTree(() => {
                    // In the tree now: the fixable findings it shows (its marks left out).
                    const data = DataManager.getData();
                    const fixable = this.treeValidationShown(validateTreeData(data), data, treeId).issues
                        .filter(i => DataManager.isFixableIssue(i));
                    const count = DataManager.repairAllFixableIssues(fixable);
                    if (count > 0) this.showAlert(strings.treeManager.valFixed(count), 'info');
                });
                return;
            }
            const el = target.closest<HTMLElement>('[data-vq]');
            if (!el || !view || !content.contains(el)) return;
            e.preventDefault();
            switch (el.dataset.vq) {
                case 'section': {
                    const cat = el.dataset.section as IssueCategory;
                    view.sections[cat] = el.getAttribute('aria-expanded') !== 'true';
                    redraw();
                    return;
                }
                case 'group': {
                    const type = el.dataset.type ?? '';
                    view.groups.set(type, el.getAttribute('aria-expanded') !== 'true');
                    redraw();
                    return;
                }
                case 'more': {
                    const type = el.dataset.type ?? '';
                    view.shown.set(type, (view.shown.get(type) ?? GROUP_STEP) + GROUP_STEP);
                    redraw();
                    return;
                }
                case 'dismissed':
                    view.dismissedOpen = !view.dismissedOpen;
                    redraw();
                    return;
                case 'dismiss': {
                    const issue = issueAt(el);
                    if (!issue || this.treeValidationReadOnly(treeId)) return;
                    void inTree(() => this.dismissValidationIssue(issue, treeId));
                    return;
                }
                case 'restore': {
                    const key = el.dataset.key ?? '';
                    if (!key || this.treeValidationReadOnly(treeId)) return;
                    void inTree(() => {
                        const mark = (DataManager.getData().qualityDismissed ?? []).find(d => dismissalKey(d) === key);
                        if (!mark) return;
                        if (DataManager.restoreQualityDismissal(key, this.qualityMarkLabel(mark, DataManager.getData()))) {
                            this.qualityMarksChanged();
                        }
                    });
                    return;
                }
            }
        };
    },

    /** "Not an error" / "Two different people" on a finding of the open tree: marked, a toast with Undo. */
    dismissValidationIssue(issue: ValidationIssue, treeId: string): void {
        const mark = dismissalFor(issue);
        const data = DataManager.getData();
        const label = this.qualityMarkLabel(mark, data);
        if (!DataManager.dismissQualityFinding(mark, label)) return;
        this.qualityMarksChanged();
        const s = strings.treeManager;
        const key = dismissalKey(mark);
        this.startDismissToastRoom();
        this.showToast(issue.type === 'possibleDuplicate' ? s.dismissedPairToast : s.dismissedToast, DISMISS_TOAST_MS, {
            kind: DISMISS_TOAST_KIND,
            clearOf: '#tree-validation-modal .buttons',
            action: {
                label: s.valUndo,
                run: () => {
                    this.endDismissToastRoom();
                    if (TreeManager.getActiveTreeId() !== treeId || DataManager.isReadOnly()) return;
                    if (DataManager.restoreQualityDismissal(key, label)) this.qualityMarksChanged();
                    void this.refreshTreeValidationDialog(treeId);
                },
            },
        });
    },

    /** While the toast stands, the dialog's body ends 84 px lower: its last row can be scrolled above the toast. */
    startDismissToastRoom(): void {
        const content = document.getElementById('tree-validation-content');
        if (!content) return;
        content.classList.add('vq-toast-room');
        if (view?.toastTimer) window.clearInterval(view.toastTimer);
        let seen = false;
        const started = Date.now();
        const timer = window.setInterval(() => {
            const toast = document.querySelector(`.toast[data-kind="${DISMISS_TOAST_KIND}"]`);
            if (toast) seen = true;
            if ((seen && !toast) || (!seen && Date.now() - started > DISMISS_TOAST_MS * 3)) this.endDismissToastRoom();
        }, 300);
        if (view) view.toastTimer = timer;
    },

    endDismissToastRoom(): void {
        document.getElementById('tree-validation-content')?.classList.remove('vq-toast-room');
        if (view?.toastTimer) {
            window.clearInterval(view.toastTimer);
            view.toastTimer = null;
        }
    },

    /** A mark named for the undo step and the change log: "type: people". */
    qualityMarkLabel(mark: Pick<QualityDismissal, 'kind' | 'persons' | 'subject'>, data: StromData): string {
        return `${validationGroupTitle(mark.kind)}: ${this.qualityMarkWhat(mark, data, false)}`;
    },

    /** What a mark is about, as text: the subject and the people ("Václav Hrubeš – Jan Lhoták, Marie Lhotáková"). */
    qualityMarkWhat(mark: Pick<QualityDismissal, 'kind' | 'persons' | 'subject'>, data: StromData, years = true): string {
        const dup = mark.kind === 'possibleDuplicate';
        const people = mark.persons.map(id => {
            const y = years ? lifeYears(data.persons[id as PersonId]) : '';
            return personLabel(data, id) + (y ? ` (${y})` : '');
        }).join(dup ? ' × ' : ', ');
        if (!mark.subject) return people;
        const dated = mark.kind === 'eventAfterDeath' || mark.kind === 'weddingAfterDeath';
        if (dated) return people ? `${people} · ${mark.subject}` : mark.subject;
        return people ? `${mark.subject} – ${people}` : mark.subject;
    },

    /**
     * Hook for the research's verdict on a finding (§3): extra label, actions,
     * order, or "told apart" (set aside). None today.
     */
    validationRowExtra(_issue: ValidationIssue, _treeId: string): ValidationRowExtra | null {
        return null;
    },

    /** Hook (§3): a line under a group's title ("Assessed by the research"). None today. */
    validationGroupNote(_type: string, _treeId: string): string {
        return '';
    },

    /** Hook (§3): the end of a group — the findings set aside ("Told apart by the research: n"), as trusted HTML. None today. */
    validationAsideHtml(_type: string, _aside: readonly ValidationIssue[], _treeId: string): string {
        return '';
    },

    /**
     * The findings shown and counted (the dialog and the Tree overview count
     * the same): those marked "not an error" left out, and those the hook
     * sets aside.
     */
    treeValidationShown(result: TreeValidationResult, data: StromData, treeId: string): ValidationShown {
        const issues: ValidationIssue[] = [];
        const aside = new Map<string, ValidationIssue[]>();
        for (const issue of visibleValidation(result, data).issues) {
            if (this.validationRowExtra(issue, treeId)?.setAside) {
                (aside.get(issue.type) ?? aside.set(issue.type, []).get(issue.type)!).push(issue);
            } else {
                issues.push(issue);
            }
        }
        return { issues, aside };
    },

    /**
     * Generate HTML for tree validation results (ZADANI_DEV §1, §2): the
     * summary sentence, the Problems and the Leads, each by type in groups,
     * and the findings marked "not an error" at the end.
     */
    generateTreeValidationHtml(result: TreeValidationResult, treeData: StromData, treeId: string): string {
        const s = strings.treeManager;
        const esc = (t: string): string => this.escapeHtml(t);
        const v: ValidationView = view && view.treeId === treeId ? view
            : { treeId, sections: {}, groups: new Map(), shown: new Map(), dismissedOpen: false, toastTimer: null };
        const ro = this.treeValidationReadOnly(treeId);
        const shown = this.treeValidationShown(result, treeData, treeId);
        const counts = validationCounts(shown.issues);
        const sections = groupValidationIssues(shown.issues, validationGroupTitle);
        // A group of findings all set aside still shows its sub-list.
        for (const [type, aside] of shown.aside) {
            if (aside.length === 0 || sections.some(sec => sec.groups.some(g => g.type === type))) continue;
            const severity = aside[0].severity;
            const category = issueCategory({ severity });
            let sec = sections.find(x => x.category === category);
            if (!sec) {
                sec = { category, count: 0, groups: [] };
                if (category === 'problem') sections.unshift(sec); else sections.push(sec);
            }
            sec.groups.push({ type, severity, category, issues: [], expanded: false });
        }
        const indexOf = new Map(result.issues.map((issue, i) => [issue, i]));
        const dismissed = treeData.qualityDismissed ?? [];

        let html = ro ? `<p class="vq-readonly">${esc(s.valReadOnly)}</p>` : '';

        if (shown.issues.length === 0 && shown.aside.size === 0) {
            html += `
                <div class="validation-passed">
                    <div class="validation-passed-icon">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
                    </div>
                    <div class="validation-passed-text">${esc(s.validationPassed)}</div>
                </div>
            `;
        } else {
            const fixableCount = ro ? 0 : shown.issues.filter(i => DataManager.isFixableIssue(i)).length;
            html += `<div class="validation-summary vq-summary">
                <span class="vq-summary-text">${esc(validationSummaryText(counts))}</span>
                ${fixableCount > 0 ? `<button type="button" class="validation-fix-all-btn">${esc(s.valFixAll)} (${fixableCount})</button>` : ''}
            </div>`;
        }

        const hasProblems = sections.some(sec => sec.category === 'problem' && sec.count > 0);
        for (const sec of sections) {
            const open = v.sections[sec.category] ?? (sec.category === 'problem' || !(isPhone() && hasProblems));
            const label = sec.category === 'problem' ? s.valProblems : s.valLeads;
            html += `<section class="vq-section" data-section="${sec.category}">
                <button type="button" class="vq-section-head" data-vq="section" data-section="${sec.category}"
                    data-focus-key="sec:${sec.category}" aria-expanded="${open}">
                    <span class="vq-section-title">${esc(label)}</span>
                    <span class="vq-section-count">${sec.count}</span>
                    <span class="vq-chev" aria-hidden="true">${open ? '▼' : '▶'}</span>
                </button>`;
            if (open) {
                if (sec.category === 'trace') {
                    html += `<div class="vq-leads-intro"><span class="vq-leads-text">${esc(s.leadsIntro)}</span>`
                        + `<span class="vq-leads-skipped">${esc(s.leadsSkipped)}</span></div>`;
                }
                html += '<div class="vq-groups">';
                for (const group of sec.groups) {
                    html += this.validationGroupHtml(group, v, treeData, treeId, ro, indexOf, shown.aside.get(group.type) ?? []);
                }
                html += '</div>';
            }
            html += '</section>';
        }

        if (dismissed.length > 0) html += this.qualityDismissedHtml(dismissed, treeData, treeId, ro, v.dismissedOpen);
        return html;
    },

    /** One group: its head (arrow, dot, title, count) and, open, its rows by 20 when long. */
    validationGroupHtml(group: ValidationGroup, v: ValidationView, treeData: StromData, treeId: string, ro: boolean,
        indexOf: ReadonlyMap<ValidationIssue, number>, aside: readonly ValidationIssue[]): string {
        const s = strings.treeManager;
        const esc = (t: string): string => this.escapeHtml(t);
        const open = v.groups.get(group.type) ?? group.expanded;
        const note = this.validationGroupNote(group.type, treeId);
        const extras = new Map(group.issues.map(i => [i, this.validationRowExtra(i, treeId)]));
        // The hook's order first (a verdict), the app's order kept otherwise.
        const rows = group.issues.some(i => extras.get(i)?.rank !== undefined)
            ? group.issues.map((issue, at) => ({ issue, at }))
                .sort((a, b) => (extras.get(a.issue)?.rank ?? Infinity) - (extras.get(b.issue)?.rank ?? Infinity) || a.at - b.at)
                .map(x => x.issue)
            : group.issues;
        let html = `<div class="vq-group vq-group--${group.severity}" data-type="${esc(group.type)}">
            <button type="button" class="vq-group-head" data-vq="group" data-type="${esc(group.type)}"
                data-focus-key="grp:${esc(group.type)}" aria-expanded="${open}">
                <span class="vq-chev" aria-hidden="true">${open ? '▼' : '▶'}</span>
                <span class="vq-dot" aria-hidden="true"></span>
                <span class="vq-group-titles">
                    <span class="vq-group-name">${esc(validationGroupTitle(group.type))}</span>
                    ${note ? `<span class="vq-group-note">${esc(note)}</span>` : ''}
                </span>
                <span class="vq-group-count">${group.issues.length}</span>
            </button>`;
        if (open) {
            const limit = rows.length >= LONG_GROUP ? Math.min(rows.length, v.shown.get(group.type) ?? GROUP_STEP) : rows.length;
            html += '<div class="vq-rows">';
            for (const issue of rows.slice(0, limit)) {
                html += this.validationRowHtml(issue, indexOf.get(issue) ?? -1, extras.get(issue) ?? null, treeData, treeId, ro);
            }
            const rest = rows.length - limit;
            if (rest > 0) {
                html += `<button type="button" class="vq-more" data-vq="more" data-type="${esc(group.type)}"
                    data-focus-key="more:${esc(group.type)}">${esc(s.valShowMore(Math.min(GROUP_STEP, rest), rest))}</button>`;
            }
            if (aside.length > 0) html += this.validationAsideHtml(group.type, aside, treeId);
            html += '</div>';
        }
        return html + '</div>';
    },

    /** One finding: a dot, the subject, the people with their years, the detail, the actions. */
    validationRowHtml(issue: ValidationIssue, issueIdx: number, extra: ValidationRowExtra | null,
        treeData: StromData, treeId: string, ro: boolean): string {
        const s = strings.treeManager;
        const esc = (t: string): string => this.escapeHtml(t);
        const dup = issue.type === 'possibleDuplicate';
        const ids = issue.personIds ?? [];
        const people = ids.map((id, k) => {
            const person = treeData.persons[id];
            const name = person ? (shownNameOrEmpty(person) || id) : id;
            const years = lifeYears(person);
            const sep = k < ids.length - 1 ? (dup ? ' ×' : ',') : '';
            return `<span class="vq-person"><a href="#" class="validation-person-link" data-tree-id="${esc(treeId)}" data-person-id="${esc(id)}">${esc(name)}</a>`
                + `${years ? `<span class="vq-years">(${esc(years)})</span>` : ''}${sep ? `<span class="vq-sep">${sep}</span>` : ''}</span>`;
        }).join(' ');
        // The godparent's detail begins with the name the row already shows in bold.
        let detail = issue.detail ?? '';
        if (issue.subject && detail.startsWith(`${issue.subject} — `)) detail = detail.slice(issue.subject.length + 3);
        if (extra?.hideDetail) detail = '';
        const actions: string[] = [];
        if (!ro) {
            if (DataManager.isFixableIssue(issue)) {
                actions.push(`<button type="button" class="validation-fix-btn" data-issue-idx="${issueIdx}">${esc(s.valFix)}</button>`);
            }
            if (extra?.actionsHtml) actions.push(extra.actionsHtml);
            actions.push(`<button type="button" class="vq-dismiss" data-vq="dismiss" data-issue-idx="${issueIdx}">${esc(dup ? s.twoPeople : s.notAnError)}</button>`);
        }
        return `<div class="validation-issue vq-row ${issue.severity}" data-type="${esc(issue.type)}">
            <span class="validation-issue-dot" aria-hidden="true"></span>
            <div class="validation-issue-content">
                ${extra?.badgeHtml ?? ''}
                ${issue.subject ? `<div class="vq-subject">${esc(issue.subject)}</div>` : ''}
                ${people ? `<div class="validation-issue-persons">${people}</div>` : ''}
                ${detail ? `<div class="validation-issue-detail">${esc(detail)}</div>` : ''}
            </div>
            ${actions.length ? `<div class="vq-actions">${actions.join('')}</div>` : ''}
        </div>`;
    },

    /**
     * The findings marked "not an error" (ZADANI_DEV §2.3): a closed row with
     * their count; open, the newest first, each with its date (or "Marked in
     * the research"), its send state (a research tree whose bridge takes the
     * marks) and Restore (not while read-only).
     */
    qualityDismissedHtml(list: readonly QualityDismissal[], treeData: StromData, treeId: string, ro: boolean, open: boolean): string {
        const s = strings.treeManager;
        const esc = (t: string): string => this.escapeHtml(t);
        let html = `<div class="vq-dismissed">
            <button type="button" class="vq-dismissed-head" data-vq="dismissed" data-focus-key="dismissed" aria-expanded="${open}">
                <span class="vq-dismissed-label">${esc(s.dismissedRow(list.length))}</span>
                <span class="vq-chev" aria-hidden="true">${open ? '▼' : '▶'}</span>
            </button>`;
        if (open) {
            const sends = this.qualitySendsToResearch(treeId);
            const newest = [...list].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
            html += '<div class="vq-dismissed-list">';
            for (const d of newest) {
                const type = d.kind === 'possibleDuplicate' ? `${s.valGroupPossibleDuplicate} · ${s.twoPeople}` : validationGroupTitle(d.kind);
                const meta = d.by === 'research' ? s.markedInResearch : s.dismissedOn(formatFlexDate((d.at ?? '').slice(0, 10)));
                let state = '';
                if (sends && d.by !== 'research') {
                    const sync = d.sync ?? (dismissBody(d, treeData.persons) ? 'queued' : 'app');
                    const text = sync === 'sent' ? s.sentToResearch : sync === 'queued' ? s.waitingForResearch : s.appOnly;
                    state = `<span class="vq-sync vq-sync--${sync}">${esc(text)}</span>`;
                }
                const key = dismissalKey(d);
                html += `<div class="vq-dismissed-row${d.by === 'research' ? ' vq-dismissed-row--research' : ''}" data-key="${esc(key)}">
                    <div class="vq-dismissed-text">
                        <span class="vq-dismissed-type">${esc(type)}</span>
                        <span class="vq-dismissed-what">${esc(this.qualityMarkWhat(d, treeData))}</span>
                        <span class="vq-dismissed-meta">${esc(meta)}</span>
                    </div>
                    ${state}
                    ${ro ? '' : `<button type="button" class="vq-restore" data-vq="restore" data-key="${esc(key)}">${esc(s.restoreDismissed)}</button>`}
                </div>`;
            }
            html += '</div>';
        }
        return html + '</div>';
    },

    /**
     * Focus on a person from validation dialog
     * Switches to the tree if needed and focuses on the person
     */
    async focusPersonFromValidation(treeId: string, personId: string): Promise<void> {
        // Close all dialogs (the tree overview too, when validation was opened from it)
        this.closeTreeValidationDialog();
        if (this.isTreeOverviewOpen()) this.closeTreeOverview();
        this.closeTreeManagerDialog();

        // Switch to tree if needed — AWAIT it: switchToTree finishes by
        // restoring the new tree's own focus (restoreFromSession), so calling
        // setFocus before the switch resolves would set the target on the OLD
        // tree and then get overwritten by the restore. Await, then focus.
        const activeTreeId = TreeManager.getActiveTreeId();
        if (activeTreeId !== treeId) {
            await this.switchToTree(treeId as TreeId);
        }

        // Focus on the person
        TreeRenderer.setFocus(personId as PersonId);
    },

    /**
     * Return to parent dialog from stack, or clear stack if no parent
     */
    returnToParentDialog(): void {
        // Remove current dialog from stack
        this.dialogStack.pop();

        // If there's a parent dialog, open it
        if (this.dialogStack.length > 0) {
            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
            this.openDialogById(parentDialog);
        }

        // Clear the stack (we've returned to parent)
        this.dialogStack = [];
    },
});
