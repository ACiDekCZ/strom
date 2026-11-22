/**
 * Merge Import - UI Module
 * Handles the merge review modal and user interactions
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { getUI } from '../ui-ref.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import { PersonId, PartnershipId, Person, StromData, TreeId, PartnershipStatus } from '../types.js';
import { contentFingerprint } from '../research-link.js';
import { isGender } from '../model-values.js';
import { strings } from '../strings.js';
import { runHeavy, activatedElement, busyButtonHtml } from '../ui/busy.js';
import {
    MergeState,
    PersonMatch,
    MatchFilter,
    MergeStats,
    PartnershipConflict,
    PartnershipConflictField
} from './types.js';
import {
    createMergeState,
    calculateMergeStats,
    updateMatchDecision,
    updateConflictResolution,
    reanalyzeMatches,
    rebaseMergeState
} from './matching.js';
import {
    AUTO_CONFIRM_SCORE,
    detectPartnershipConflicts,
    updatePartnershipConflictResolution
} from './executor.js';
import { validateTreeData, ValidationResult } from '../validation.js';
import { PersonPicker } from '../person-picker.js';
import {
    saveCurrentMerge,
    getCurrentMerge,
    getCurrentMergeInfo,
    clearCurrentMerge,
    saveMergeSession,
    loadMergeSession,
    deleteMergeSession,
    updateMergeSession,
    listMergeSessionsInfo,
    hasPendingMerges
} from './persistence.js';
import { shownNameOrEmpty, fitNameHtml } from '../person-name.js';
import { iconSvg } from '../icons.js';
import { imageLoads } from '../image-loads.js';
import { pendingImageOf } from '../research-image-refs.js';
import { imgStateOf, smallPortraitHtml, type ImgState } from '../ui/image-slot.js';
import { personPhotoKey } from '../ui/person-photo-model.js';
import { personInitials } from '../initials.js';
import { MergeWizard, type WizardSource } from './wizard-ui.js';
import type { WizardStep } from './wizard-steps.js';
import type { MergePlan, PlanSource } from './plan.js';
import { newTreeName, writePlanAsNewTree } from './write.js';

// Auto-save debounce delay (ms)
const AUTO_SAVE_DELAY = 2000;

/** The warning mark of the merge (no emoji): a stroked triangle in the warning colour, the text beside it says what. */
const MERGE_WARNING_MARK = iconSvg('alert-triangle', { size: 14, className: 'merge-warning-mark' });

/** A row's conflict mark: the triangle, named by its count for screen readers and on hover. */
function conflictMark(count: number): string {
    const label = `${strings.merge.conflicts}: ${count}`;
    return `<span class="conflict-indicator" role="img" title="${label}" aria-label="${label}">${MERGE_WARNING_MARK}</span>`;
}

/**
 * MergerUI class - handles merge modal UI
 */

/** From this many people in both trees the matching says its state at once (it runs longer than 120 ms). */
export const MERGE_ANALYSIS_LONG_AT = 1000;

/** The matching of `a` and `b` runs long (§8: its words at once). */
export function mergeAnalysisLong(a: StromData, b: StromData): boolean {
    return Object.keys(a.persons).length + Object.keys(b.persons).length >= MERGE_ANALYSIS_LONG_AT;
}

class MergerUIClass {
    private mergeState: MergeState | null = null;
    private currentFilter: MatchFilter = 'all';
    private selectedMatchIndex: number = -1;
    private manualMatchPicker: PersonPicker | null = null;

    // Escape handling and auto-save
    private hasUnsavedChanges: boolean = false;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
    private incomingFileName?: string;
    /** A merge of a GEDCOM file: its import record in the incoming data (spec 066). */
    private gedcomImport?: { gedcom: true; importId?: string };

    // Track if opened from tree manager (for returning to it)
    private openedFromTreeManager: boolean = false;
    private targetTreeName?: string;
    private sourceTreeName?: string;
    /**
     * A resumed saved merge: its session, kept until the merge is written or
     * thrown away; its state is saved back into it (spec 134 K0.6).
     */
    private resumedSessionId?: string;
    /** The backup "Before merge" of the target started with the merge, awaited before writing (spec 134 K0.4). */
    private preMergeBackup: Promise<string | null> | null = null;
    /** What the import is, for the guide's fresh choices (spec 134 §1). */
    private sourceInfo: Pick<PlanSource, 'kind' | 'fingerprint' | 'treeId'> = { kind: 'json' };

    /** The import guide's frame: steps, counts, footer (spec 134 §1). */
    private readonly wizard = new MergeWizard({
        state: () => this.mergeState,
        changed: () => this.markUnsavedChanges(),
        moved: () => { if (this.hasUnsavedChanges) this.scheduleAutoSave(); },
        saveForLater: () => this.saveForLater(),
        finishCompare: () => this.closeMergeModalInternal(),
        write: plan => this.write(plan),
        renderPairs: host => this.renderPairs(host),
    });

    // ==================== INITIALIZATION ====================

    /**
     * Start merge process with incoming data
     * @param incomingData The data to merge into current tree
     * @param sourceTreeIdOrFileName Either a TreeId (for tree-to-tree merge) or a filename (for file import)
     * @param fromTreeManager Whether this merge was opened from the tree manager
     * @param source What the import is (a shared packet, a view…) and its fingerprint, for the guide
     */
    startMerge(
        incomingData: StromData, sourceTreeIdOrFileName?: string | TreeId, fromTreeManager: boolean = false,
        gedcomImport?: { gedcom: true; importId?: string },
        source?: Partial<Pick<PlanSource, 'kind' | 'fingerprint'>>,
    ): void {
        const existingData = DataManager.getData();
        this.gedcomImport = gedcomImport;
        this.resumedSessionId = undefined;

        // The backup "Before merge" of the target, whatever the way into the
        // merge (file, tree, view, share) and the automatic backups setting
        // (spec 134 K0.4). A view or a read-only tree gets none.
        this.preMergeBackup = DataManager.snapshotNow('pre-merge').catch(() => null);

        // Create merge state
        this.mergeState = createMergeState(existingData, incomingData);
        this.mergeState.phase = 'reviewing';
        this.resumedState = false;
        // The target and its data as matched, for a resumed merge to compare (spec 134 K0.6).
        const targetId = DataManager.isViewMode() ? null : DataManager.getCurrentTreeId();
        if (targetId) this.mergeState.target = { treeId: targetId, fingerprint: contentFingerprint(existingData) };
        this.currentFilter = 'all';
        this.selectedMatchIndex = -1;
        this.hasUnsavedChanges = false;
        this.openedFromTreeManager = fromTreeManager;

        // Get current (target) tree name
        const activeTreeId = TreeManager.getActiveTreeId();
        this.targetTreeName = activeTreeId ? TreeManager.getTreeMetadata(activeTreeId)?.name : undefined;

        // Determine if this is a tree-to-tree merge or file import
        const fromTree = !!sourceTreeIdOrFileName && !!TreeManager.getTreeMetadata(sourceTreeIdOrFileName as TreeId);
        if (fromTree) {
            const sourceTreeId = sourceTreeIdOrFileName as TreeId;
            this.sourceTreeName = TreeManager.getTreeMetadata(sourceTreeId)?.name;
            this.incomingFileName = this.sourceTreeName;
        } else {
            this.sourceTreeName = undefined;
            this.incomingFileName = sourceTreeIdOrFileName as string | undefined;
        }
        this.sourceInfo = {
            kind: source?.kind ?? (gedcomImport ? 'ged' : fromTree ? 'tree' : 'json'),
            ...(source?.fingerprint ? { fingerprint: source.fingerprint } : {}),
            ...(fromTree ? { treeId: sourceTreeIdOrFileName as TreeId } : {}),
        };

        // Setup escape handler
        this.setupEscapeHandler();

        // Show modal
        this.showMergeModal();
    }

    /**
     * Resume merge from saved state
     */
    resumeMerge(state: MergeState, fileName?: string, targetTreeName?: string, sourceTreeName?: string): void {
        this.mergeState = state;
        this.resumedState = true;
        this.gedcomImport = undefined;
        this.resumedSessionId = undefined;
        this.preMergeBackup = null;
        this.currentFilter = 'all';
        this.selectedMatchIndex = -1;
        this.hasUnsavedChanges = false;
        this.incomingFileName = fileName;
        this.targetTreeName = targetTreeName;
        this.sourceTreeName = sourceTreeName;
        this.sourceInfo = { kind: sourceTreeName ? 'tree' : 'json' };

        // Setup escape handler
        this.setupEscapeHandler();

        // Show modal
        this.showMergeModal();
    }

    /**
     * Resume current pending merge (auto-saved)
     */
    async resumeCurrentMerge(): Promise<boolean> {
        const saved = await getCurrentMerge();
        if (!saved) return false;
        const state = await this.overCurrentTarget(saved);

        const info = await getCurrentMergeInfo();
        this.resumeMerge(state, info?.incomingFileName);
        if (state !== saved) this.markUnsavedChanges();
        return true;
    }

    /**
     * Resume saved merge session by ID
     * @param sessionId The session ID to resume
     * @param fromTreeManager Whether this was opened from tree manager (for returning to it)
     */
    async resumeSavedMerge(sessionId: string, fromTreeManager: boolean = false): Promise<boolean> {
        const sessions = await listMergeSessionsInfo();
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return false;

        const saved = await loadMergeSession(sessionId);
        if (!saved) return false;
        const state = await this.overCurrentTarget(saved);

        // The session stays until the merge is written or thrown away: the
        // state goes back into it (spec 134 K0.6). Deleting it here lost the
        // merge when the wizard closed before the next save.
        this.openedFromTreeManager = fromTreeManager;
        this.resumeMerge(state, session.incomingFileName, session.targetTreeName, session.sourceTreeName);
        this.resumedSessionId = sessionId;
        if (state !== saved) this.markUnsavedChanges();
        return true;
    }

    /**
     * A resumed merge over its target as the tree is now (spec 134 K0.6):
     * when the tree changed since the matching, the person is told and the
     * matches can be found again over the current data, the answers kept
     * where their people still exist. Otherwise (or when the tree cannot be
     * read) the merge goes on over the copy from the matching, said so.
     */
    private async overCurrentTarget(state: MergeState): Promise<MergeState> {
        const target = state.target;
        if (!target) return state;   // a session saved before the target was kept
        const current = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === target.treeId
            ? DataManager.getData()
            : TreeManager.getTreeMetadata(target.treeId) ? await TreeManager.getTreeData(target.treeId) : null;
        if (!current) {
            await getUI().showAlert(strings.merge.resumeTargetMissing, 'warning');
            return state;
        }
        const fingerprint = contentFingerprint(current);
        if (fingerprint === target.fingerprint) return state;
        const again = await getUI().showConfirm(strings.merge.resumeTargetChanged, strings.merge.resumeTargetChangedTitle,
            { ok: strings.merge.resumeRecompute, cancel: strings.merge.resumeKeepCopy });
        if (!again) return state;
        return rebaseMergeState(state, current, { treeId: target.treeId, fingerprint });
    }

    // ==================== ESCAPE HANDLING ====================

    /**
     * Setup escape key handler
     */
    private setupEscapeHandler(): void {
        this.removeEscapeHandler();

        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.handleEscapePress();
            }
        };
        document.addEventListener('keydown', this.escapeHandler, true);
    }

    /**
     * Remove escape key handler
     */
    private removeEscapeHandler(): void {
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler, true);
            this.escapeHandler = null;
        }
    }

    /**
     * Handle escape key press
     */
    private handleEscapePress(): void {
        // A tree preview / comparison opened from the wizard sits above it:
        // close that first. This capture handler stops the key, so the central
        // cascade (misc.ts) that closes them elsewhere never sees it.
        if (TreePreview.isOpen()) {
            TreePreview.close();
            return;
        }
        if (TreeCompare.isOpen()) {
            TreeCompare.close();
            return;
        }

        // Check if manual match or conflict dialog is open
        const manualDialog = document.getElementById('merge-manual-dialog');
        const conflictDialog = document.getElementById('merge-conflict-dialog');

        if (manualDialog?.classList.contains('active')) {
            this.closeManualMatchDialog();
            return;
        }

        if (conflictDialog?.classList.contains('active')) {
            this.closeConflictDialog();
            return;
        }

        // Check if close confirmation is open
        const closeConfirm = document.getElementById('merge-close-confirm');
        if (closeConfirm?.classList.contains('active')) {
            this.hideCloseConfirmation();
            return;
        }

        // Main merge modal - check for unsaved changes
        if (this.hasUnsavedChanges) {
            this.showCloseConfirmation();
        } else {
            this.closeMergeModal();
        }
    }

    /**
     * Show close confirmation dialog
     */
    private showCloseConfirmation(): void {
        const dialog = document.getElementById('merge-close-confirm');
        if (dialog) {
            const message = dialog.querySelector('.merge-close-message');
            const state = this.mergeState;
            if (message && state) {
                const pairs = state.matches.length;
                const open = this.openPairs().length;
                message.textContent = strings.mergeWizard.closeMsg(pairs - open, pairs);
            }
            dialog.classList.add('active');
        }
    }

    /**
     * Hide close confirmation dialog
     */
    private hideCloseConfirmation(): void {
        const dialog = document.getElementById('merge-close-confirm');
        if (dialog) {
            dialog.classList.remove('active');
        }
    }

    /**
     * Handle close confirmation: discard changes
     */
    handleCloseDiscard(): void {
        this.hideCloseConfirmation();
        if (this.resumedSessionId) void deleteMergeSession(this.resumedSessionId);
        void clearCurrentMerge();
        this.closeMergeModalInternal();
    }

    /**
     * Handle close confirmation: save for later
     */
    handleCloseSave(): void {
        if (this.mergeState && this.resumedSessionId) {
            void updateMergeSession(this.resumedSessionId, this.mergeState);
        } else if (this.mergeState) {
            // Generate display name from tree names
            const displayName = this.targetTreeName && this.sourceTreeName
                ? `${this.targetTreeName} + ${this.sourceTreeName}`
                : this.incomingFileName || 'Merge';
            void saveMergeSession(this.mergeState, displayName, this.targetTreeName, this.sourceTreeName);
        }
        this.hideCloseConfirmation();
        this.closeMergeModalInternal();

        // Refresh tree manager if open
        window.dispatchEvent(new CustomEvent('strom:merge-session-changed'));
    }

    /**
     * Handle close confirmation: continue merging
     */
    handleCloseCancel(): void {
        this.hideCloseConfirmation();
    }

    /**
     * Save current merge for later (direct action from button)
     */
    saveForLater(): void {
        if (this.mergeState && this.resumedSessionId) {
            void updateMergeSession(this.resumedSessionId, this.mergeState);
            getUI().showToast(strings.merge.closeSave);
        } else if (this.mergeState) {
            // Generate display name from tree names
            const displayName = this.targetTreeName && this.sourceTreeName
                ? `${this.targetTreeName} + ${this.sourceTreeName}`
                : this.incomingFileName || 'Merge';
            void saveMergeSession(this.mergeState, displayName, this.targetTreeName, this.sourceTreeName);
            getUI().showToast(strings.merge.closeSave);
        }
        this.closeMergeModalInternal();

        // Refresh tree manager if open
        window.dispatchEvent(new CustomEvent('strom:merge-session-changed'));
    }

    // ==================== AUTO-SAVE ====================

    /**
     * Mark that changes have been made
     */
    private markUnsavedChanges(): void {
        this.hasUnsavedChanges = true;
        this.scheduleAutoSave();
    }

    /**
     * Schedule auto-save (debounced)
     */
    private scheduleAutoSave(): void {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.performAutoSave();
        }, AUTO_SAVE_DELAY);
    }

    /**
     * Perform auto-save
     */
    private performAutoSave(): void {
        if (this.mergeState && this.resumedSessionId) {
            void updateMergeSession(this.resumedSessionId, this.mergeState);
        } else if (this.mergeState) {
            void saveCurrentMerge(this.mergeState, this.incomingFileName);
        }
    }

    /**
     * Clear auto-save timeout
     */
    private clearAutoSave(): void {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }
    }

    // ==================== PENDING MERGES ====================

    /**
     * Check if there are pending merges
     */
    async hasPendingMerges(): Promise<boolean> {
        return hasPendingMerges();
    }

    /**
     * Get pending merge info for display
     */
    async getPendingMergeInfo(): Promise<{ current: Awaited<ReturnType<typeof getCurrentMergeInfo>>; saved: Awaited<ReturnType<typeof listMergeSessionsInfo>> }> {
        return {
            current: await getCurrentMergeInfo(),
            saved: await listMergeSessionsInfo()
        };
    }

    /**
     * Discard current pending merge
     */
    discardCurrentMerge(): void {
        clearCurrentMerge();
    }

    /**
     * Discard saved merge session
     */
    discardSavedMerge(sessionId: string): void {
        deleteMergeSession(sessionId);
    }

    // ==================== MODAL DISPLAY ====================

    /**
     * Show the merge review modal
     */
    private showMergeModal(): void {
        if (!this.mergeState) return;

        const modal = document.getElementById('merge-modal');
        if (!modal) return;

        // A merge saved before the guide existed had its comparison run.
        this.renderValidationBanner();
        modal.classList.add('active');
        this.wizard.open(this.wizardSource(), { compared: this.resumedState });
    }

    /** Whether the open merge was resumed (its comparison ran), for the guide's start. */
    private resumedState = false;

    /** The import and its target, for the guide's fresh choices. */
    private wizardSource(): WizardSource {
        const state = this.mergeState!;
        const targetTreeId = state.target?.treeId ?? null;
        const label = this.sourceTreeName || this.incomingFileName || strings.mergeWizard.titleImport;
        return {
            source: {
                kind: this.sourceInfo.kind,
                label,
                persons: Object.values(state.incomingData.persons).filter(p => !p.isPlaceholder).length,
                ...(this.sourceInfo.fingerprint ? { fingerprint: this.sourceInfo.fingerprint } : {}),
                ...(this.sourceInfo.treeId ? { treeId: this.sourceInfo.treeId } : {}),
                ...(this.gedcomImport?.importId ? { importId: this.gedcomImport.importId } : {}),
            },
            targetTreeId,
            targetName: this.targetTreeName
                || (targetTreeId ? TreeManager.getTreeMetadata(targetTreeId)?.name : undefined)
                || strings.treeManager.newTree,
        };
    }

    /** The guide's primary button (footer). */
    wizardNext(): Promise<void> {
        return this.wizard.next();
    }

    /** The guide's Back button (footer). */
    wizardBack(): void {
        this.wizard.back();
    }

    /** Go to a step of the guide that can be entered. */
    wizardGo(step: WizardStep): void {
        this.wizard.go(step);
    }

    /**
     * Non-blocking pre-merge warning: if either tree already has error-severity
     * issues, they will be carried into the merged tree. We say so and hint at
     * fixing them first, but never block the merge.
     */
    private renderValidationBanner(): void {
        const banner = document.getElementById('merge-validation-banner');
        if (!banner || !this.mergeState) return;
        const existingErrors = validateTreeData(this.mergeState.existingData).stats.errors;
        const incomingErrors = validateTreeData(this.mergeState.incomingData).stats.errors;
        if (existingErrors === 0 && incomingErrors === 0) {
            banner.classList.remove('has-issues');
            banner.innerHTML = '';
            return;
        }
        banner.classList.add('has-issues');
        banner.innerHTML =
            `<span class="merge-validation-banner-msg">${MERGE_WARNING_MARK}${this.escapeHtml(strings.merge.preValidationWarning(existingErrors, incomingErrors))}</span>`
            + ` <span class="merge-validation-banner-hint">${this.escapeHtml(strings.merge.preValidationHint)}</span>`;
    }

    /**
     * Close the merge modal (public - checks for unsaved changes)
     */
    closeMergeModal(): void {
        if (this.hasUnsavedChanges) {
            this.showCloseConfirmation();
        } else {
            this.closeMergeModalInternal();
        }
    }

    /**
     * Close the merge modal (internal - no check)
     */
    private closeMergeModalInternal(): void {
        const modal = document.getElementById('merge-modal');
        modal?.classList.remove('active');
        this.wizard.close();

        // Cleanup
        this.removeEscapeHandler();
        this.clearAutoSave();
        clearCurrentMerge();

        // Check if we should return to tree manager
        const shouldReturnToTreeManager = this.openedFromTreeManager;

        this.mergeState = null;
        this.selectedMatchIndex = -1;
        this.hasUnsavedChanges = false;
        this.incomingFileName = undefined;
        this.targetTreeName = undefined;
        this.sourceTreeName = undefined;
        this.openedFromTreeManager = false;
        this.resumedSessionId = undefined;
        this.preMergeBackup = null;

        // Return to tree manager if it was opened from there
        if (shouldReturnToTreeManager) {
            getUI().showTreeManagerDialog();
        }
    }

    /**
     * Draw the guide again after a decision: its plan, steps, counts and
     * footer, and step 2's list in place.
     */
    private renderModalContent(): void {
        if (!this.mergeState) return;
        this.wizard.refresh();
        if (!document.getElementById('merge-match-list')) return;
        this.updateFilterTabs(calculateMergeStats(this.mergeState));
        this.renderRest();
        this.renderMatchList();
    }

    /**
     * Today's list of pairs inside step 2's body (until §4 replaces it):
     * the filter tabs, the undecided rest at once, and the list.
     */
    private renderPairs(host: HTMLElement): void {
        const state = this.mergeState;
        if (!state) return;
        const M = strings.merge;
        const W = strings.mergeWizard;
        const tab = (filter: MatchFilter, label: string, count = true): string =>
            `<button type="button" class="merge-tab sel-tab${this.currentFilter === filter ? ' active' : ''}" data-sel-dir="down" data-filter="${filter}">`
            + `<span class="sel-l" data-label="${this.escapeHtml(label)}">${this.escapeHtml(label)}</span>${count ? ` <span class="tab-count" id="tab-count-${filter}">0</span>` : ''}</button>`;
        host.innerHTML = `<div class="merge-tabs">${tab('all', M.tabAll, false)}${tab('high', M.highConfidence)}${tab('medium', M.mediumConfidence)}`
            + `${tab('low', M.lowConfidence)}${tab('unmatched', M.statsNew)}${tab('conflicts', M.conflicts)}</div>`
            + `<div class="merge-rest" id="merge-rest"></div>`
            + `<div class="merge-match-list" id="merge-match-list"></div>`
            // Its working words drawn with it, as the static buttons get theirs (§1.2).
            + `<div class="merge-reanalyze"><button type="button" class="link-button" data-busy="idle">${busyButtonHtml(this.escapeHtml(M.reanalyze), strings.busy.analyzing, undefined, { own: true })}</button></div>`;
        host.querySelectorAll<HTMLButtonElement>('.merge-tab').forEach(b =>
            b.addEventListener('click', () => this.setFilter(b.dataset.filter as MatchFilter)));
        host.querySelector<HTMLElement>('#merge-rest')?.addEventListener('click', e => {
            const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rest]');
            if (b) this.decideRest(b.dataset.rest as 'reject' | 'skip');
        });
        this.renderRest();
        host.querySelector<HTMLButtonElement>('.merge-reanalyze button')?.addEventListener('click', () => { void this.reanalyze(); });
        this.updateFilterTabs(calculateMergeStats(state));
        this.renderMatchList();
    }

    /** The line "Remaining N undecided: Add as new · Do not add" above step 2's list. */
    private renderRest(): void {
        const box = document.getElementById('merge-rest');
        if (!box) return;
        const W = strings.mergeWizard;
        const n = this.openPairs().length;
        box.hidden = n === 0;
        box.innerHTML = n === 0 ? '' : `<span class="merge-rest-label">${this.escapeHtml(W.restLabel(n))}</span>`
            + `<button type="button" class="link-button" data-rest="reject">${this.escapeHtml(W.restAdd(n))}</button>`
            + `<button type="button" class="link-button" data-rest="skip">${this.escapeHtml(W.restSkip(n))}</button>`;
    }

    /** The pairs no one decided and the score does not join (the ones "to decide"). */
    private openPairs(): PersonMatch[] {
        const state = this.mergeState;
        if (!state) return [];
        return state.matches.filter(m => !state.decisions.has(m.incomingId) && m.score < AUTO_CONFIRM_SCORE);
    }

    /** The undecided rest at once: added as new people (reject) or not added (skip). */
    private decideRest(decision: 'reject' | 'skip'): void {
        const state = this.mergeState;
        if (!state) return;
        for (const m of this.openPairs()) updateMatchDecision(state, m.incomingId, decision);
        this.markUnsavedChanges();
        this.wizard.refresh({ body: true });
    }

    /**
     * Update filter tab counts
     */
    private updateFilterTabs(stats: MergeStats): void {
        const tabs: { filter: MatchFilter; countId: string }[] = [
            { filter: 'high', countId: 'tab-count-high' },
            { filter: 'medium', countId: 'tab-count-medium' },
            { filter: 'low', countId: 'tab-count-low' },
            { filter: 'unmatched', countId: 'tab-count-unmatched' },
            { filter: 'conflicts', countId: 'tab-count-conflicts' }
        ];

        for (const { filter, countId } of tabs) {
            const el = document.getElementById(countId);
            if (!el) continue;

            let count = 0;
            switch (filter) {
                case 'high': count = stats.highConfidence; break;
                case 'medium': count = stats.mediumConfidence; break;
                case 'low': count = stats.lowConfidence; break;
                case 'unmatched': count = stats.unmatched; break;
                case 'conflicts': count = stats.withConflicts + stats.partnershipConflicts; break;
            }
            el.textContent = String(count);
        }
    }

    // ==================== FILTER HANDLING ====================

    /**
     * Set current filter
     */
    setFilter(filter: MatchFilter): void {
        this.currentFilter = filter;
        this.selectedMatchIndex = -1;

        // Update active tab
        document.querySelectorAll('#merge-step-body .merge-tab').forEach(tab => {
            tab.classList.toggle('active', (tab as HTMLElement).dataset.filter === filter);
        });

        this.renderMatchList();
    }

    // ==================== MATCH LIST ====================

    /**
     * Render the list of matches based on current filter
     */
    private renderMatchList(): void {
        if (!this.mergeState) return;

        const listContainer = document.getElementById('merge-match-list');
        if (!listContainer) return;

        const items = this.getFilteredItems();
        // Unions both trees know but describe differently are listed first
        // in the "all" and "conflicts" views, like persons with conflicts.
        const unionGroups = (this.currentFilter === 'all' || this.currentFilter === 'conflicts')
            ? this.groupPartnershipConflicts()
            : [];

        if (items.length === 0 && unionGroups.length === 0) {
            listContainer.innerHTML = `<div class="merge-empty">${strings.merge.noItems}</div>`;
            return;
        }

        listContainer.innerHTML =
            unionGroups.map(group => this.renderPartnershipConflictItem(group)).join('')
            + items.map((item, index) => this.renderMatchItem(item, index)).join('');

        // Attach event listeners
        this.attachMatchListeners();
    }

    /**
     * Get items based on current filter
     */
    private getFilteredItems(): Array<PersonMatch | { type: 'unmatched'; person: Person; personId: PersonId }> {
        if (!this.mergeState) return [];

        const items: Array<PersonMatch | { type: 'unmatched'; person: Person; personId: PersonId }> = [];

        if (this.currentFilter === 'all' || this.currentFilter === 'unmatched') {
            // Add unmatched
            for (const id of this.mergeState.unmatchedIncoming) {
                const person = this.mergeState.incomingData.persons[id];
                if (person) {
                    items.push({ type: 'unmatched', person, personId: id });
                }
            }
        }

        if (this.currentFilter !== 'unmatched') {
            // Add matches based on filter
            for (const match of this.mergeState.matches) {
                if (this.currentFilter === 'all') {
                    items.push(match);
                } else if (this.currentFilter === 'high' && match.confidence === 'high') {
                    items.push(match);
                } else if (this.currentFilter === 'medium' && match.confidence === 'medium') {
                    items.push(match);
                } else if (this.currentFilter === 'low' && match.confidence === 'low') {
                    items.push(match);
                } else if (this.currentFilter === 'conflicts' && match.conflicts.length > 0) {
                    items.push(match);
                }
            }
        }

        return items;
    }

    /**
     * Get tooltip for confidence level
     */
    private getConfidenceTooltip(confidence: string): string {
        switch (confidence) {
            case 'high': return strings.merge.highConfidenceTooltip;
            case 'medium': return strings.merge.mediumConfidenceTooltip;
            case 'low': return strings.merge.lowConfidenceTooltip;
            default: return '';
        }
    }

    /**
     * Get localized match reason
     */
    private getMatchReasonText(reason: string): string {
        const reasonStrings = (strings.merge as Record<string, unknown>).matchReasons as Record<string, string> | undefined;
        if (reasonStrings && reasonStrings[reason]) {
            return reasonStrings[reason];
        }
        // Fallback to formatted reason name
        return reason.replace(/_/g, ' ');
    }

    /**
     * Render a single match item
     */
    private renderMatchItem(
        item: PersonMatch | { type: 'unmatched'; person: Person; personId: PersonId },
        index: number
    ): string {
        if ('type' in item && item.type === 'unmatched') {
            return this.renderUnmatchedItem(item.person, item.personId, index);
        }

        const match = item as PersonMatch;
        const decision = this.mergeState?.decisions.get(match.incomingId);

        // Determine status: confirmed, rejected, skipped, or pending (needs review)
        // Score >= AUTO_CONFIRM_SCORE is pre-confirmed, anything below it is
        // only offered and requires explicit user action.
        // Skip is independent: the incoming person is neither merged nor added.
        const isSkipped = decision?.type === 'skip';
        const isConfirmed = decision?.type === 'confirm' || (!decision && match.score >= AUTO_CONFIRM_SCORE);
        const isRejected = decision?.type === 'reject';
        const isPending = !decision && match.score < AUTO_CONFIRM_SCORE; // Needs user review

        const confidenceClass = match.confidence;
        const confidenceLabel = strings.merge[`${match.confidence}Confidence`] || match.confidence;
        const confidenceTooltip = this.getConfidenceTooltip(match.confidence);

        // Format person info
        const existingInfo = this.formatPersonInfoHtml(match.existingPerson);
        const incomingInfo = this.formatPersonInfoHtml(match.incomingPerson);

        // Match reasons
        const reasonsText = match.reasons
            .filter(r => r !== 'manual') // Skip 'manual' as it's obvious
            .map(r => this.getMatchReasonText(r))
            .join(', ');
        const reasonsHtml = reasonsText
            ? `<div class="merge-item-reasons">${this.escapeHtml(reasonsText)}</div>`
            : '';

        // Conflict indicator
        const hasConflicts = match.conflicts.length > 0;
        const conflictIndicator = hasConflicts ? conflictMark(match.conflicts.length) : '';

        // Resolve conflicts button
        const resolveBtn = hasConflicts
            ? `<button class="merge-btn-resolve" data-action="resolve">${strings.merge.resolveConflicts}</button>`
            : '';

        const statusClass = isSkipped ? 'skipped' : isConfirmed ? 'confirmed' : isRejected ? 'rejected' : 'pending';
        const statusSymbol = isSkipped ? '⊘' : isConfirmed ? '✓' : isRejected ? '✗' : '?';

        return `
            <div class="merge-item ${isConfirmed ? 'confirmed' : ''} ${isRejected ? 'rejected' : ''} ${isSkipped ? 'skipped' : ''} ${isPending ? 'pending' : ''}"
                 data-index="${index}" data-incoming-id="${this.escapeHtml(match.incomingId)}">
                <div class="merge-item-header">
                    <span class="merge-item-status ${statusClass}">
                        ${statusSymbol}
                    </span>
                    <span class="merge-item-names">
                        ${existingInfo} ↔ ${incomingInfo}
                    </span>
                    ${conflictIndicator}
                    <span class="merge-item-score confidence-${confidenceClass}" title="${confidenceTooltip}">
                        ${match.score} % · ${confidenceLabel}
                    </span>
                </div>
                ${reasonsHtml}
                ${hasConflicts ? this.renderConflictSummary(match) : ''}
                <div class="merge-item-actions">
                    <button class="merge-btn-confirm ${isConfirmed ? 'active' : ''}" data-action="confirm">
                        ${strings.merge.confirm}
                    </button>
                    <button class="merge-btn-reject ${isRejected ? 'active' : ''}" data-action="reject">
                        ${strings.merge.reject}
                    </button>
                    <button class="merge-btn-skip ${isSkipped ? 'active' : ''}" data-action="skip" title="${this.escapeHtml(strings.merge.skipTooltip)}">
                        ${strings.merge.skip}
                    </button>
                    <button class="merge-btn-change" data-action="change">
                        ${strings.merge.changeMatch}
                    </button>
                    ${resolveBtn}
                    <button class="merge-btn-preview" data-action="compare" title="${strings.treePreview.comparePersons}" aria-label="${strings.treePreview.comparePersons}">
                        ${strings.treePreview.comparePersons}
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render unmatched item
     */
    private renderUnmatchedItem(person: Person, personId: PersonId, index: number): string {
        const info = this.formatPersonInfoHtml(person);
        const isSkipped = this.mergeState?.decisions.get(personId)?.type === 'skip';

        // In updateOnly mode every unmatched person is left out anyway; the badge
        // says so, and per-person skip is redundant (but harmless) there.
        const willBeAdded = !isSkipped && !this.mergeState?.updateOnly;
        const badge = willBeAdded
            ? `<span class="merge-item-badge new" title="${strings.merge.newPersonTooltip}">${strings.merge.newPerson}</span>`
            : `<span class="merge-item-badge skipped" title="${this.escapeHtml(strings.merge.skipTooltip)}">${strings.merge.skipped}</span>`;

        return `
            <div class="merge-item unmatched ${isSkipped ? 'skipped' : ''}" data-index="${index}" data-incoming-id="${this.escapeHtml(personId)}">
                <div class="merge-item-header">
                    <span class="merge-item-status ${isSkipped ? 'skipped' : 'new'}">${isSkipped ? '⊘' : '+'}</span>
                    <span class="merge-item-names">
                        ${info}
                    </span>
                    ${badge}
                </div>
                <div class="merge-item-actions">
                    <button class="merge-btn-change" data-action="manual">
                        ${strings.merge.manualMatch}
                    </button>
                    <button class="merge-btn-skip ${isSkipped ? 'active' : ''}" data-action="skip" title="${this.escapeHtml(strings.merge.skipTooltip)}">
                        ${isSkipped ? strings.merge.unskip : strings.merge.skip}
                    </button>
                    <button class="merge-btn-preview" data-action="preview" title="${strings.treePreview.preview}" aria-label="${strings.treePreview.preview}">
                        ${strings.treePreview.preview}
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render conflict summary
     */
    private renderConflictSummary(match: PersonMatch): string {
        const conflicts = match.conflicts.slice(0, 3); // Show max 3
        const more = match.conflicts.length > 3 ? ` +${match.conflicts.length - 3}` : '';

        return `
            <div class="merge-item-conflicts">
                ${conflicts.map(c => {
                    const fieldLabel = strings.labels[c.field as keyof typeof strings.labels] || c.field;
                    // Never spell out a photo's data URL in the compact summary —
                    // just say the portraits differ (the ⚠ + resolve dialog show them).
                    if (c.field === 'photo') {
                        return `<span class="conflict-field">${fieldLabel}: ${strings.merge.photoConflict}</span>`;
                    }
                    return `<span class="conflict-field">${fieldLabel}: ${this.escapeHtml(c.existingValue || '—')} → ${this.escapeHtml(c.incomingValue || '—')}</span>`;
                }).join('')}
                ${more}
            </div>
        `;
    }

    /**
     * Format person info for display
     */
    private formatPersonInfo(person: Person): string {
        const name = shownNameOrEmpty(person);
        const year = person.birthDate?.split('-')[0] || '';
        return year ? `${name} (*${year})` : name;
    }

    /** formatPersonInfo as HTML for a list row: a married surname's birth note shortens to fit. */
    private formatPersonInfoHtml(person: Person): string {
        const year = person.birthDate?.split('-')[0] || '';
        return fitNameHtml(person, shownNameOrEmpty(person), year ? `(*${year})` : '');
    }

    /**
     * Attach event listeners to match list
     */
    private attachMatchListeners(): void {
        const listContainer = document.getElementById('merge-match-list');
        if (!listContainer) return;

        // Action buttons
        listContainer.querySelectorAll('.merge-btn-confirm, .merge-btn-reject, .merge-btn-skip, .merge-btn-change, .merge-btn-resolve, .merge-btn-preview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = (e.target as HTMLElement).closest('.merge-item');
                const incomingId = item?.getAttribute('data-incoming-id') as PersonId;
                const action = (e.target as HTMLElement).dataset.action;

                const partnershipId = item?.getAttribute('data-partnership-id');
                if (action === 'resolve-partnership' && partnershipId) {
                    this.showPartnershipConflictResolution(partnershipId as PartnershipId);
                    return;
                }

                if (incomingId && action) {
                    this.handleMatchAction(incomingId, action);
                }
            });
        });

        // Item click for expand/details
        listContainer.querySelectorAll('.merge-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't expand if clicking a button
                if ((e.target as HTMLElement).closest('button')) return;

                const index = parseInt(item.getAttribute('data-index') || '-1');
                this.toggleItemDetails(index);
            });
        });
    }

    /**
     * Handle match action (confirm/reject/change/resolve)
     */
    private handleMatchAction(incomingId: PersonId, action: string): void {
        if (!this.mergeState) return;

        switch (action) {
            case 'confirm':
                updateMatchDecision(this.mergeState, incomingId, 'confirm');
                this.markUnsavedChanges();
                break;
            case 'reject':
                updateMatchDecision(this.mergeState, incomingId, 'reject');
                this.markUnsavedChanges();
                break;
            case 'skip': {
                // Toggle skip. Unlike reject (import as a NEW separate person),
                // skip drops the incoming person entirely. Clicking an already
                // skipped row un-skips it back to its default (undecided) state.
                const current = this.mergeState.decisions.get(incomingId);
                if (current?.type === 'skip') {
                    this.mergeState.decisions.delete(incomingId);
                } else {
                    updateMatchDecision(this.mergeState, incomingId, 'skip');
                }
                this.markUnsavedChanges();
                break;
            }
            case 'change':
            case 'manual':
                this.showManualMatchDialog(incomingId);
                return;
            case 'resolve':
                this.showConflictResolution(incomingId);
                return;
            case 'compare':
                this.showCompareView(incomingId);
                return;
            case 'preview':
                this.showPreviewView(incomingId);
                return;
        }

        this.renderModalContent();
    }

    /**
     * Show comparison view for matched persons
     */
    private showCompareView(incomingId: PersonId): void {
        if (!this.mergeState) return;

        // Find the match for this incoming ID
        const match = this.mergeState.matches.find(m => m.incomingId === incomingId);
        if (!match) return;

        const existingData = this.mergeState.existingData;
        const incomingData = this.mergeState.incomingData;

        TreeCompare.showComparison({
            left: {
                data: existingData,
                focusPersonId: match.existingId,
                depthUp: 2,
                depthDown: 2,
                title: this.targetTreeName || strings.merge.existingTree,
                subtitle: this.formatPersonInfo(match.existingPerson)
            },
            right: {
                data: incomingData,
                focusPersonId: match.incomingId,
                depthUp: 2,
                depthDown: 2,
                title: this.sourceTreeName || this.incomingFileName || strings.merge.incomingTree,
                subtitle: this.formatPersonInfo(match.incomingPerson)
            }
        });
    }

    /**
     * Show preview view for unmatched person
     */
    private showPreviewView(incomingId: PersonId): void {
        if (!this.mergeState) return;

        const incomingData = this.mergeState.incomingData;
        const person = incomingData.persons[incomingId];
        if (!person) return;

        TreePreview.show({
            data: incomingData,
            focusPersonId: incomingId,
            depthUp: 2,
            depthDown: 2,
            title: this.sourceTreeName || this.incomingFileName || strings.merge.incomingTree,
            subtitle: this.formatPersonInfo(person)
        });
    }

    /**
     * Toggle item details view
     */
    private toggleItemDetails(index: number): void {
        if (this.selectedMatchIndex === index) {
            this.selectedMatchIndex = -1;
        } else {
            this.selectedMatchIndex = index;
        }
        // Could expand to show conflict resolution UI
    }

    // ==================== MANUAL MATCH DIALOG ====================

    /**
     * Show manual match selection dialog
     */
    private showManualMatchDialog(incomingId: PersonId): void {
        if (!this.mergeState) return;

        const incoming = this.mergeState.incomingData.persons[incomingId];
        if (!incoming) return;

        const dialog = document.getElementById('merge-manual-dialog');
        const incomingName = document.getElementById('merge-manual-incoming');

        if (!dialog || !incomingName) return;

        // Set incoming person name
        incomingName.textContent = this.formatPersonInfo(incoming);

        // Destroy existing picker
        if (this.manualMatchPicker) {
            this.manualMatchPicker.destroy();
            this.manualMatchPicker = null;
        }

        // Get existing persons for picker
        const existingPersons = Object.values(this.mergeState.existingData.persons)
            .filter(p => !p.isPlaceholder);

        // Initialize PersonPicker
        this.manualMatchPicker = new PersonPicker({
            containerId: 'merge-manual-picker',
            onSelect: () => {
                // Selection handled via getValue() in confirmManualMatch
            },
            placeholder: strings.merge.selectExisting,
            persons: existingPersons
        });

        // Store incoming ID for later
        dialog.setAttribute('data-incoming-id', incomingId);

        dialog.classList.add('active');
    }

    /**
     * Confirm manual match
     */
    confirmManualMatch(): void {
        if (!this.mergeState) return;

        const dialog = document.getElementById('merge-manual-dialog');

        if (!dialog) return;

        const incomingId = dialog.getAttribute('data-incoming-id') as PersonId;
        const targetId = this.manualMatchPicker?.getValue();

        if (!targetId) {
            getUI().showAlert(strings.merge.selectExistingError, 'warning');
            return;
        }

        updateMatchDecision(this.mergeState, incomingId, { type: 'manual_match', targetId });
        this.markUnsavedChanges();

        // Re-analyze matches to update matches and unmatchedIncoming lists
        reanalyzeMatches(this.mergeState);

        // Auto-confirm if no conflicts
        const match = this.mergeState.matches.find(m => m.incomingId === incomingId);
        if (match && match.conflicts.length === 0) {
            // No conflicts - auto-confirm the match
            updateMatchDecision(this.mergeState, incomingId, 'confirm');
        }

        this.closeManualMatchDialog();
        this.renderModalContent();
    }

    /**
     * Close manual match dialog
     */
    closeManualMatchDialog(): void {
        const dialog = document.getElementById('merge-manual-dialog');
        dialog?.classList.remove('active');
        // Clean up picker
        if (this.manualMatchPicker) {
            this.manualMatchPicker.destroy();
            this.manualMatchPicker = null;
        }
    }

    /**
     * Preview from manual match dialog - shows single or comparison based on selection
     */
    previewManualMatch(): void {
        if (!this.mergeState) return;

        const dialog = document.getElementById('merge-manual-dialog');
        const incomingId = dialog?.getAttribute('data-incoming-id') as PersonId;
        if (!incomingId) return;

        const incomingPerson = this.mergeState.incomingData.persons[incomingId];
        if (!incomingPerson) return;

        const existingId = this.manualMatchPicker?.getValue();

        if (existingId) {
            // Both selected - show comparison
            const existingPerson = this.mergeState.existingData.persons[existingId];
            if (!existingPerson) return;

            TreeCompare.showComparison({
                left: {
                    data: this.mergeState.existingData,
                    focusPersonId: existingId,
                    depthUp: 2,
                    depthDown: 2,
                    title: this.targetTreeName || strings.merge.existingTree,
                    subtitle: this.formatPersonInfo(existingPerson)
                },
                right: {
                    data: this.mergeState.incomingData,
                    focusPersonId: incomingId,
                    depthUp: 2,
                    depthDown: 2,
                    title: this.sourceTreeName || strings.merge.incomingTree,
                    subtitle: this.formatPersonInfo(incomingPerson)
                }
            });
        } else {
            // Only incoming - show single preview
            TreePreview.show({
                data: this.mergeState.incomingData,
                focusPersonId: incomingId,
                depthUp: 2,
                depthDown: 2,
                title: this.sourceTreeName || strings.merge.incomingTree,
                subtitle: this.formatPersonInfo(incomingPerson)
            });
        }
    }

    // ==================== CONFLICT RESOLUTION ====================

    /**
     * Show conflict resolution for a match
     */
    showConflictResolution(incomingId: PersonId): void {
        if (!this.mergeState) return;

        const match = this.mergeState.matches.find(m => m.incomingId === incomingId);
        if (!match || match.conflicts.length === 0) return;

        const dialog = document.getElementById('merge-conflict-dialog');
        const content = document.getElementById('merge-conflict-content');

        if (!dialog || !content) return;

        // Title says WHOSE conflicts these are.
        const titleEl = dialog.querySelector('.modal-header h2');
        if (titleEl) {
            const p = this.mergeState.incomingData.persons[match.incomingId];
            const name = p ? shownNameOrEmpty(p) : '';
            titleEl.textContent = name ? `${strings.merge.conflicts}: ${name}` : strings.merge.conflicts;
        }

        const suggestedLabel = (c: typeof match.conflicts[number]): string => {
            if (!c.suggestedReason) return '';
            const text = c.suggestedReason === 'more_precise_date'
                ? strings.merge.suggestedPrecise : strings.merge.suggestedComplete;
            return `<span class="conflict-suggested">${text}</span>`;
        };
        content.innerHTML = match.conflicts.map(conflict => `
            <div class="conflict-row" data-field="${conflict.field}">
                <div class="conflict-label">
                    ${strings.labels[conflict.field as keyof typeof strings.labels] || conflict.field}
                </div>
                <div class="conflict-options">
                    <label class="conflict-option sel-opt" data-sel-form="tile">
                        <input type="radio" name="conflict-${conflict.field}" value="keep_existing"
                            ${conflict.resolution === 'keep_existing' ? 'checked' : ''}>
                        <span class="conflict-value existing">${this.conflictValueHtml(conflict.field, conflict.existingValue, match.existingId)}</span>
                        <span class="conflict-badge existing">${strings.merge.keepExisting}</span>
                        ${(conflict.suggested ?? 'keep_existing') === 'keep_existing' ? suggestedLabel(conflict) : ''}
                    </label>
                    <label class="conflict-option sel-opt" data-sel-form="tile">
                        <input type="radio" name="conflict-${conflict.field}" value="use_incoming"
                            ${conflict.resolution === 'use_incoming' ? 'checked' : ''}>
                        <span class="conflict-value incoming">${this.conflictValueHtml(conflict.field, conflict.incomingValue)}</span>
                        <span class="conflict-badge incoming">${strings.merge.useImport}</span>
                        ${conflict.suggested === 'use_incoming' ? suggestedLabel(conflict) : ''}
                    </label>
                </div>
            </div>
        `).join('');

        dialog.removeAttribute('data-partnership-id');
        dialog.setAttribute('data-incoming-id', incomingId);
        dialog.classList.add('active');
    }

    // ==================== PARTNERSHIP CONFLICTS ====================

    /** Current partnership conflicts grouped per incoming union. */
    private groupPartnershipConflicts(): PartnershipConflict[][] {
        if (!this.mergeState) return [];
        const groups = new Map<PartnershipId, PartnershipConflict[]>();
        for (const c of detectPartnershipConflicts(this.mergeState)) {
            const list = groups.get(c.incomingPartnershipId) ?? [];
            list.push(c);
            groups.set(c.incomingPartnershipId, list);
        }
        return [...groups.values()];
    }

    /** "A & B" for the existing union a conflict group refers to. */
    private partnershipCoupleName(existingPartnershipId: PartnershipId): string {
        const data = this.mergeState?.existingData;
        const p = data?.partnerships[existingPartnershipId];
        if (!data || !p) return '';
        const name = (id: PersonId): string => {
            const person = data.persons[id];
            return person ? shownNameOrEmpty(person) : '';
        };
        return strings.merge.partnershipCouple(name(p.person1Id), name(p.person2Id));
    }

    private partnershipFieldLabel(field: PartnershipConflictField): string {
        return strings.merge.partnershipFields[field];
    }

    /** A partnership conflict value as safe HTML; status is localized. */
    private partnershipValueHtml(field: PartnershipConflictField, v: string): string {
        if (field === 'status' && v in strings.partnershipStatus) {
            return this.escapeHtml(strings.partnershipStatus[v as PartnershipStatus]);
        }
        return this.escapeHtml(v || '—');
    }

    /** One list row for a union with conflicts (same look as a person row). */
    private renderPartnershipConflictItem(group: PartnershipConflict[]): string {
        const first = group[0];
        const resolved = this.mergeState?.partnershipResolutions?.has(first.incomingPartnershipId) ?? false;
        const summary = group.map(c =>
            `<span class="conflict-field">${this.escapeHtml(this.partnershipFieldLabel(c.field))}: ${this.partnershipValueHtml(c.field, c.existingValue)} → ${this.partnershipValueHtml(c.field, c.incomingValue)}</span>`
        ).join('');
        return `
            <div class="merge-item partnership-conflict ${resolved ? 'confirmed' : 'pending'}"
                 data-index="-1" data-partnership-id="${this.escapeHtml(first.incomingPartnershipId)}">
                <div class="merge-item-header">
                    <span class="merge-item-status ${resolved ? 'confirmed' : 'pending'}">${resolved ? '✓' : '?'}</span>
                    <span class="merge-item-names">
                        ${this.escapeHtml(strings.merge.partnershipConflict)}: ${this.escapeHtml(this.partnershipCoupleName(first.existingPartnershipId))}
                    </span>
                    ${conflictMark(group.length)}
                </div>
                <div class="merge-item-conflicts">${summary}</div>
                <div class="merge-item-actions">
                    <button class="merge-btn-resolve" data-action="resolve-partnership">${strings.merge.resolveConflicts}</button>
                </div>
            </div>
        `;
    }

    /** Open the conflict dialog for one union (same rows as for a person). */
    showPartnershipConflictResolution(incomingPartnershipId: PartnershipId): void {
        if (!this.mergeState) return;
        const conflicts = detectPartnershipConflicts(this.mergeState)
            .filter(c => c.incomingPartnershipId === incomingPartnershipId);
        if (conflicts.length === 0) return;

        const dialog = document.getElementById('merge-conflict-dialog');
        const content = document.getElementById('merge-conflict-content');
        if (!dialog || !content) return;

        const titleEl = dialog.querySelector('.modal-header h2');
        if (titleEl) {
            const couple = this.partnershipCoupleName(conflicts[0].existingPartnershipId);
            titleEl.textContent = couple ? `${strings.merge.conflicts}: ${couple}` : strings.merge.conflicts;
        }

        content.innerHTML = conflicts.map(conflict => `
            <div class="conflict-row" data-field="${conflict.field}">
                <div class="conflict-label">
                    ${this.escapeHtml(this.partnershipFieldLabel(conflict.field))}
                </div>
                <div class="conflict-options">
                    <label class="conflict-option sel-opt" data-sel-form="tile">
                        <input type="radio" name="conflict-${conflict.field}" value="keep_existing"
                            ${conflict.resolution === 'keep_existing' ? 'checked' : ''}>
                        <span class="conflict-value existing">${this.partnershipValueHtml(conflict.field, conflict.existingValue)}</span>
                        <span class="conflict-badge existing">${strings.merge.keepExisting}</span>
                    </label>
                    <label class="conflict-option sel-opt" data-sel-form="tile">
                        <input type="radio" name="conflict-${conflict.field}" value="use_incoming"
                            ${conflict.resolution === 'use_incoming' ? 'checked' : ''}>
                        <span class="conflict-value incoming">${this.partnershipValueHtml(conflict.field, conflict.incomingValue)}</span>
                        <span class="conflict-badge incoming">${strings.merge.useImport}</span>
                    </label>
                </div>
            </div>
        `).join('');

        dialog.removeAttribute('data-incoming-id');
        dialog.setAttribute('data-partnership-id', incomingPartnershipId);
        dialog.classList.add('active');
    }

    /**
     * Save conflict resolutions
     */
    saveConflictResolutions(): void {
        if (!this.mergeState) return;

        const dialog = document.getElementById('merge-conflict-dialog');
        if (!dialog) return;

        const partnershipId = dialog.getAttribute('data-partnership-id') as PartnershipId | null;
        if (partnershipId) {
            dialog.querySelectorAll('.conflict-row').forEach(row => {
                const field = row.getAttribute('data-field') as PartnershipConflictField;
                const selected = row.querySelector('input[type="radio"]:checked') as HTMLInputElement;
                if (field && selected) {
                    updatePartnershipConflictResolution(this.mergeState!, partnershipId,
                        field, selected.value as 'keep_existing' | 'use_incoming');
                }
            });
            this.markUnsavedChanges();
            this.closeConflictDialog();
            this.renderModalContent();
            return;
        }

        const incomingId = dialog.getAttribute('data-incoming-id') as PersonId;

        // Get all radio selections
        dialog.querySelectorAll('.conflict-row').forEach(row => {
            const field = row.getAttribute('data-field') as keyof Person;
            const selected = row.querySelector('input[type="radio"]:checked') as HTMLInputElement;
            if (field && selected) {
                const resolution = selected.value as 'keep_existing' | 'use_incoming';
                updateConflictResolution(this.mergeState!, incomingId, field, resolution);
            }
        });

        this.markUnsavedChanges();
        this.closeConflictDialog();
        this.renderModalContent();
    }

    /**
     * Close conflict dialog
     */
    closeConflictDialog(): void {
        const dialog = document.getElementById('merge-conflict-dialog');
        dialog?.classList.remove('active');
    }

    // ==================== MERGE ACTIONS ====================

    /**
     * Re-analyze matches after user changes
     */
    reanalyze(): Promise<void> {
        const state = this.mergeState;
        if (!state) return Promise.resolve();
        // §8: the matching runs again over both trees, under the working state of the button.
        return runHeavy(activatedElement(), () => {
            if (this.mergeState !== state) return;
            reanalyzeMatches(state);
            this.wizard.refresh({ body: true });
        }, { label: strings.merge.analyzing, atOnce: mergeAnalysisLong(state.existingData, state.incomingData) }).then(() => undefined);
    }

    /**
     * Write the guide's plan (step 5): a new tree "{target} + {source}"
     * through applyPlan and its check before saving (spec 134 §8, the interim
     * way). On a failure nothing is saved and the guide stays open; after the
     * write, today's ending: Manage trees and the offer to switch.
     */
    private async write(plan: MergePlan): Promise<void> {
        const state = this.mergeState;
        if (!state) return;

        state.phase = 'executing';

        // Snapshot the issues that already exist in BOTH inputs, so we can tell
        // afterwards whether the merge itself INTRODUCED anything new.
        const preIssues = [
            validateTreeData(state.existingData),
            validateTreeData(state.incomingData),
        ];

        // The backup "Before merge" of the target is in place before anything is written (spec 134 K0.4).
        if (this.preMergeBackup) await this.preMergeBackup;

        // Nothing created, nothing saved on a failure: the wizard stays open
        // with its answers, the message says what would have gone wrong
        // (spec 134 K0.2, K0.5).
        const result = await writePlanAsNewTree(plan, state.existingData, state.incomingData, newTreeName(plan));
        if (!result.ok) {
            state.phase = 'reviewing';
            await getUI().showAlert(result.message, 'error');
            return;
        }
        if (state.wizard) state.wizard.choices = { ...state.wizard.choices, writtenAt: new Date().toISOString() };
        const newTreeId = result.treeId;
        const counts = result.record.counts;

        // Did the merge itself introduce new error/warning issues (beyond
        // what the two inputs already carried)? Compared by issue type.
        const newIssueCount = this.countNewMergeIssues(preIssues, validateTreeData(result.data));

        // A resumed saved merge is done: its session goes.
        if (this.resumedSessionId) await deleteMergeSession(this.resumedSessionId);
        this.resumedSessionId = undefined;
        this.preMergeBackup = null;

        // Mark as no unsaved changes to prevent close confirmation
        this.hasUnsavedChanges = false;

        // Close merge modal first
        const modal = document.getElementById('merge-modal');
        modal?.classList.remove('active');
        this.wizard.close();
        this.removeEscapeHandler();
        this.clearAutoSave();
        void clearCurrentMerge();

        // What the import brought, for the steps after it.
        const gedcomImport = this.gedcomImport;
        this.gedcomImport = undefined;
        if (gedcomImport) {
            const importId = gedcomImport.importId ? result.importMap?.get(gedcomImport.importId) : undefined;
            void getUI().afterImport(newTreeId, {
                gedcom: true, path: 'merge', ...(importId ? { importId } : {}),
                added: counts.added, updated: counts.joined,
            });
        }

        // Reset state
        this.mergeState = null;
        this.selectedMatchIndex = -1;
        this.incomingFileName = undefined;
        this.targetTreeName = undefined;
        this.sourceTreeName = undefined;
        this.openedFromTreeManager = false;

        // Show success message and offer to switch to new tree
        const stats = strings.merge.stats(counts.joined, counts.added)
            + (counts.skipped > 0 ? `\n${strings.merge.skippedCount(counts.skipped)}` : '')
            + ((result.sharedJoined ?? 0) > 0 ? `\n${strings.merge.sharedJoined(result.sharedJoined!)}` : '');

        // Dispatch event to update tree list
        window.dispatchEvent(new CustomEvent('strom:merge-session-changed'));

        // Show tree manager with new tree visible
        getUI().showTreeManagerDialog();

        // Push tree manager to dialog stack so ESC returns to it
        getUI().pushDialog('tree-manager-modal');

        // Show confirmation dialog to switch to new tree
        const shouldSwitch = await getUI().showConfirm(
            `${strings.merge.complete}\n${stats}\n\n${strings.merge.switchToNewTree}`,
            strings.merge.complete
        );

        if (shouldSwitch) {
            // Switch to new tree and close tree manager
            await DataManager.switchTree(newTreeId);
            getUI().updateTreeSwitcher();
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();
            getUI().refreshSearch();
            // Center view on focused person
            ZoomPan.centerOnFocusWithContext();
            window.dispatchEvent(new CustomEvent('strom:tree-switched'));
            getUI().closeTreeManagerDialog();
        }
        // If user cancels (ESC), stay in tree manager

        // If the merge introduced new issues, offer to open validation on
        // the merged tree so the user can review (and fix) them right away.
        // A file from another program: its "What next" card carries the data check.
        if (newIssueCount > 0 && !getUI().importNextPendingFor(newTreeId)) {
            const openValidation = await getUI().showConfirm(
                strings.merge.newIssues(newIssueCount),
                strings.merge.newIssuesTitle
            );
            if (openValidation) {
                await getUI().showTreeValidationDialog(newTreeId);
            }
        }
    }

    // ==================== HELPERS ====================

    /**
     * How many error/warning issues the RESULT has beyond what the inputs
     * already had, counted per issue type (a merge that inherits an existing
     * error is not "new"; a merge that manufactures one is). Info-level issues
     * are ignored — they are hints, not defects, and merging naturally shuffles
     * them (e.g. possible-duplicate suggestions).
     */
    private countNewMergeIssues(pre: ValidationResult[], post: ValidationResult): number {
        const countByType = (results: ValidationResult[]): Map<string, number> => {
            const m = new Map<string, number>();
            for (const r of results) {
                for (const issue of r.issues) {
                    if (issue.severity === 'info') continue;
                    m.set(issue.type, (m.get(issue.type) ?? 0) + 1);
                }
            }
            return m;
        };
        const before = countByType(pre);
        const after = countByType([post]);
        let added = 0;
        for (const [type, count] of after) {
            added += Math.max(0, count - (before.get(type) ?? 0));
        }
        return added;
    }

    /**
     * A conflict value rendered as safe HTML. Photos become a thumbnail (a
     * data: URL is inert as an <img src>) so the dialog never dumps a data URL
     * as text; gender is localized; everything else is escaped plain text.
     */
    private conflictValueHtml(field: string, v?: string, existingId?: PersonId): string {
        if (field === 'photo') {
            // The open tree's portrait may still be on its way (spec 116 §5): its state from the evidence.
            const person = existingId ? this.mergeState?.existingData.persons[existingId] : undefined;
            const state = existingId ? imgStateOf(personPhotoKey(existingId), !!v) : 'none';
            return conflictPhotoHtml(v, person ? personInitials(person.firstName, person.lastName) : '', state);
        }
        if (field === 'gender' && isGender(v)) return this.escapeHtml(strings.gender[v]);
        return this.escapeHtml(v || '—');
    }

    private escapeHtml(text: string): string {
        // Must also escape quotes: callers interpolate into HTML attributes.
        return (text || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

/**
 * A photo of a merge conflict (a thumbnail; never a data URL as text): one
 * of the open tree still on its way shows the initials under the veil, one
 * that did not come the initials with a title saying so (spec 116 §5).
 */
export function conflictPhotoHtml(v: string | undefined, initials: string, state: ImgState): string {
    const pending = state === 'loading' || state === 'refresh' || state === 'failed';
    const standIn = v ? pendingImageOf(v) : null;
    if (pending || standIn) {
        const shown = pending ? state : imageLoads.stateOfSha(standIn!.sha)?.state === 'pending' ? 'loading' : 'failed';
        return smallPortraitHtml('conflict-photo', v, initials, shown, strings.photos.failed) || '—';
    }
    if (v && v.startsWith('data:')) {
        return `<img class="conflict-photo" src="${escapeAttr(v)}" alt="${escapeAttr(strings.labels.photo)}">`;
    }
    return '—';
}

function escapeAttr(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const MergerUI = new MergerUIClass();
