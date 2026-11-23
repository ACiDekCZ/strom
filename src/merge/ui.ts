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
import { PersonId, PartnershipId, Person, StromData, TreeId, PartnershipStatus, type PersonList } from '../types.js';
import { contentFingerprint } from '../research-link.js';
import { strings } from '../strings.js';
import { runHeavy, activatedElement } from '../ui/busy.js';
import {
    MergeState,
    PersonMatch,
    PartnershipConflict,
    PartnershipConflictField
} from './types.js';
import {
    createMergeState,
    updateMatchDecision,
    updateConflictResolution,
    reanalyzeMatches,
    rebaseMergeState,
    findMatchesAsync,
    recalcUndecided
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
import { shownNameOrEmpty } from '../person-name.js';
import { iconSvg } from '../icons.js';
import { MergeWizard, targetBlock, targetBlockText, wizardRoute, type CompareRun, type WizardSource } from './wizard-ui.js';
import type { WizardStep } from './wizard-steps.js';
import { isRepeatOf, planCounts, planTakesAll, scopeExample, type MergePlan, type MergeRecord, type PlanMode, type PlanSource, type ScopeExample } from './plan.js';
import { newTreeName, writePlan, type TargetChange, type WritePhase } from './write.js';
import { heldLinks, unsentMerges } from './research-hold.js';
import { exportPlan } from './plan-export.js';
import type { Step1Env, Step2Env, Step6Env, TargetRow, UnionConflictLine, WriteStatus } from './steps/context.js';
import { closeNotTaken, parkGedcomSummary } from './steps/step1-what.js';
import { closeStep3Overlay } from './steps/step3-whom.js';
import { closeStep5Overlay } from './steps/step5-plan.js';
import { writtenWhen } from './steps/step6-done.js';
import { newPersonListId, personListsOf, suggestListName } from '../person-lists-data.js';
import { listDisplayName } from '../person-lists.js';
import { closeStep2Overlay, noteRecalc } from './steps/step2-who.js';
import { notTakenText } from './wizard-text.js';
import { listSnapshots } from '../snapshots.js';
import { formatRelativeDateTime } from '../format.js';
import { getCurrentLanguage } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { CryptoSession } from '../crypto.js';
import { importProgramName } from '../import-next.js';
import type { GedcomDroppedTag } from '../ged-parser.js';

// Auto-save debounce delay (ms)
const AUTO_SAVE_DELAY = 2000;

/** The warning mark of the merge (no emoji): a stroked triangle in the warning colour, the text beside it says what. */
const MERGE_WARNING_MARK = iconSvg('alert-triangle', { size: 14, className: 'merge-warning-mark' });

/**
 * MergerUI class - handles merge modal UI
 */

/** From this many people in both trees the matching says its state at once (it runs longer than 120 ms). */
export const MERGE_ANALYSIS_LONG_AT = 1000;

/** The matching of `a` and `b` runs long (§8: its words at once). */
export function mergeAnalysisLong(a: StromData, b: StromData): boolean {
    return Object.keys(a.persons).length + Object.keys(b.persons).length >= MERGE_ANALYSIS_LONG_AT;
}

/** A merge shown with its record (step 6, the Merge history's record): its tree, the tree's name, how it was written. */
export interface ShownMerge {
    treeId: TreeId;
    name: string;
    record: MergeRecord;
    mode: PlanMode;
}

/** A merge just written (spec 134 §9): what step 6, its actions and the toast after it need. */
interface WrittenMerge {
    treeId: TreeId;
    /** The tree written into, or the new tree's name. */
    name: string;
    record: MergeRecord;
    mode: PlanMode;
    /** Written into a new tree (New tree, or Into a new tree of K6.3). */
    newTree: boolean;
    /** A GEDCOM file; `importId` its import record in the written tree. */
    gedcom: boolean;
    importId?: string;
    /** The guide started in Manage trees: Done goes back there. */
    fromTreeManager: boolean;
    /** The toast after Done was shown (not again when What happened opens the step once more). */
    toasted?: boolean;
    /** Keep in the app for now (§11): step 6's research block folded. */
    keptLocal?: boolean;
}

class MergerUIClass {
    private mergeState: MergeState | null = null;
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
    /** A tree the import cannot go to beside the source tree (a view's own tree, §2). */
    private excludeTarget?: TreeId;
    /** The target chosen at the start that is not the open tree: read after the guide opens (§2). */
    private initialTarget: TreeId | null = null;
    /** What the import is, for the guide's fresh choices (spec 134 §1). */
    private sourceInfo: Pick<PlanSource, 'kind' | 'fingerprint' | 'treeId'> = { kind: 'json' };
    /** The merge just written: the guide stands on step 6 until Done (§9). */
    private written: WrittenMerge | null = null;
    /** The last merge written and closed, with its state: the toast's What happened opens its step 6 again. */
    private lastWritten: { w: WrittenMerge; state: MergeState; plan: MergePlan } | null = null;
    /** The toast of the last Done ("{n} added…" · Undo · What happened): it goes when its merge is undone. */
    private writtenToast: { recordId: string; close: () => void } | null = null;

    /** The import guide's frame: steps, counts, footer (spec 134 §1). */
    private readonly wizard = new MergeWizard({
        state: () => this.mergeState,
        changed: () => this.markUnsavedChanges(),
        moved: () => { if (this.hasUnsavedChanges) this.scheduleAutoSave(); },
        saveForLater: () => this.saveForLater(),
        finishCompare: () => this.closeMergeModalInternal(),
        write: (plan, opts) => this.write(plan, opts),
        openBackups: () => this.openTargetDialog('backups'),
        saveTargetFile: () => this.openTargetDialog('export'),
        step2: () => this.step2Env(),
        compare: run => this.compare(run),
        downloadJson: () => this.downloadJson(),
        step1: () => this.step1Env(),
        savePlan: plan => this.savePlan(plan),
        step6: () => this.step6Env(),
        finishDone: () => void this.finishDone(),
    });

    /** Step 1: the target whose data is the merge state's `existingData` (null: none loaded). */
    private targetLoaded: TreeId | null = null;
    /** Step 1: the latest backup of each tree, as said ("today 9:12"), once read. */
    private readonly backups = new Map<TreeId, string | null>();
    /** Step 1: the import is a GEDCOM file being read now; its summary (`#gedcom-summary`) is step 1's left column. */
    private gedcomLive = false;
    /** Step 1: the scope's example, for the target and comparison it was found over. */
    private exampleCache: { key: string; value: ScopeExample | null } | null = null;

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
        opts: { mode?: PlanMode; gedcomLive?: boolean; exclude?: TreeId } = {},
    ): void {
        const existingData = DataManager.getData();
        this.gedcomImport = gedcomImport;
        this.resumedSessionId = undefined;
        this.excludeTarget = opts.exclude;

        // Create merge state: nobody compared yet, step 1's Compare matches
        // the import with the chosen target (spec 134 §3).
        // Another merge: the toast's What happened no longer opens the last one.
        this.lastWritten = null;
        this.written = null;
        this.mergeState = createMergeState(existingData, incomingData, { match: false });
        this.mergeState.phase = 'reviewing';
        this.resumedState = false;
        this.gedcomLive = !!opts.gedcomLive;
        this.initialMode = opts.mode;
        this.exampleCache = null;
        this.backups.clear();
        // The target and its data as matched, for a resumed merge to compare (spec 134 K0.6).
        // The open tree is the target when it can be one; otherwise the import starts as a new tree.
        // Two trees or a view (§2): the open tree, else the first tree that can take it, read only
        // for the comparison; nothing is switched to before the write.
        const openId = DataManager.isViewMode() ? null : DataManager.getCurrentTreeId();
        const sourceTreeId = sourceTreeIdOrFileName && TreeManager.getTreeMetadata(sourceTreeIdOrFileName as TreeId)
            ? sourceTreeIdOrFileName as TreeId : null;
        const usable = (id: TreeId | null): id is TreeId => !!id && id !== sourceTreeId && id !== opts.exclude && !targetBlock(id);
        const twoTrees = source?.kind === 'tree' || source?.kind === 'view';
        const targetId = usable(openId) ? openId
            : twoTrees ? TreeManager.getTrees().map(t => t.id).find(usable) ?? null : null;
        const targetOpen = !!targetId && targetId === openId;
        if (targetOpen) this.mergeState.target = { treeId: targetId, fingerprint: contentFingerprint(existingData) };
        this.targetLoaded = targetOpen ? targetId : null;
        this.initialTarget = targetId && !targetOpen ? targetId : null;
        // Into an empty tree there is nothing to compare with: New tree first (the tree stays a choice).
        const emptyOpen = targetOpen && Object.values(existingData.persons).every(p => p.isPlaceholder);
        if (!targetId) this.initialMode = 'new';
        else if (emptyOpen && !this.initialMode) this.initialMode = 'new';
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
        // A target that is not the open tree: read for the comparison, the step drawn again with it.
        const later = this.initialTarget;
        if (later) void this.loadTarget(later).then(ok => { if (ok) this.wizard.refresh({ body: true }); });
    }

    /**
     * Resume merge from saved state
     */
    resumeMerge(state: MergeState, fileName?: string, targetTreeName?: string, sourceTreeName?: string): void {
        // Another merge: the toast's What happened no longer opens the last one.
        this.lastWritten = null;
        this.written = null;
        this.mergeState = state;
        this.resumedState = true;
        this.gedcomImport = undefined;
        this.gedcomLive = false;
        this.initialMode = undefined;
        this.exampleCache = null;
        this.targetLoaded = state.target?.treeId ?? null;
        this.resumedSessionId = undefined;
        this.excludeTarget = undefined;
        this.initialTarget = null;
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
            // A dialog opened from the guide (Backups…, Export) stands in its place: Esc is its.
            if (e.key === 'Escape' && document.getElementById('merge-modal')?.classList.contains('active')) {
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
        // Step 1's list of what is not taken over sits above the guide.
        if (closeNotTaken()) return;
        // Step 2's sheet of pairs (a phone).
        if (closeStep2Overlay()) return;
        // Step 3's dialogs (5a, 5c) and its branch preview sheet.
        if (closeStep3Overlay()) return;
        // Step 5's preview sheet.
        if (closeStep5Overlay()) return;
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

        // Check if the manual match dialog is open
        const manualDialog = document.getElementById('merge-manual-dialog');

        if (manualDialog?.classList.contains('active')) {
            this.closeManualMatchDialog();
            return;
        }

        // Check if close confirmation        // Check if close confirmation is open
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
                const open = state.matches.filter(m => !state.decisions.has(m.incomingId) && m.score < AUTO_CONFIRM_SCORE).length;
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
        this.storeForLater();
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
     * Store the open merge as a saved session (a resumed one in its own place)
     * and say where it waits (13j): "Saved for later · {source → target} ·
     * step {i} · in Manage trees under Unfinished merges".
     */
    private storeForLater(): void {
        const state = this.mergeState;
        if (!state) return;
        if (this.resumedSessionId) {
            void updateMergeSession(this.resumedSessionId, state);
        } else {
            // Generate display name from tree names
            const displayName = this.targetTreeName && this.sourceTreeName
                ? `${this.targetTreeName} + ${this.sourceTreeName}`
                : this.incomingFileName || 'Merge';
            void saveMergeSession(state, displayName, this.targetTreeName, this.sourceTreeName);
        }
        const ws = state.wizard;
        getUI().showToast(ws ? strings.mergeWizard.savedLater(wizardRoute(ws.choices), ws.step) : strings.merge.closeSave, 6000);
    }

    /**
     * Save current merge for later (direct action from button)
     */
    saveForLater(): void {
        // Written (step 6): the footer's link saves the list of what happened (Save the list…).
        if (this.written) {
            const plan = this.wizard.currentPlan;
            if (plan) this.savePlan(plan);
            return;
        }
        this.storeForLater();
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
    /** The mode the guide starts in (none: Add to a tree). */
    private initialMode?: PlanMode;

    /** The import and its target, for the guide's fresh choices. */
    private wizardSource(): WizardSource {
        const state = this.mergeState!;
        const targetTreeId = state.target?.treeId ?? this.initialTarget ?? null;
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
            ...(this.initialMode ? { mode: this.initialMode } : {}),
            targetTreeId,
            targetName: (targetTreeId ? this.targetTreeName || TreeManager.getTreeMetadata(targetTreeId)?.name : undefined)
                || strings.treeManager.newTree,
            ...(targetTreeId && TreeManager.getTreeMetadata(targetTreeId)?.research ? { research: true } : {}),
        };
    }

    // ==================== STEP 1 (spec 134 §3) ====================

    /** What step 1 reads and does beyond the choices. */
    private step1Env(): Step1Env {
        return {
            gedcomSummary: () => (this.gedcomLive ? document.getElementById('gedcom-summary') : null),
            sourceMeta: () => this.sourceMeta(),
            sourceTiles: () => this.sourceTiles(),
            notTaken: () => this.notTaken(),
            sourceTree: () => {
                const id = this.sourceInfo.kind === 'tree' ? this.sourceInfo.treeId : undefined;
                const meta = id ? TreeManager.getTreeMetadata(id) : undefined;
                return id && meta ? this.targetRow(id) : null;
            },
            targets: () => this.targetRows(),
            setMode: mode => this.setStep1Mode(mode),
            selectTarget: id => { void this.selectTarget(id); },
            swapBlocked: () => {
                const id = this.sourceInfo.treeId;
                const block = id ? targetBlock(id) : 'readOnly';
                return block && id ? targetBlockText(block, id) : block ? strings.mergeWizard.blockReadOnly : '';
            },
            swap: () => { void this.swap(); },
            endFollow: () => this.endFollow(),
            encLocked: () => this.encLocked(),
            unlock: () => { void this.unlockTarget(); },
            example: () => this.example(),
            repeat: () => this.repeatLine(),
            saveNotTaken: () => this.saveNotTaken(),
        };
    }

    /** The GEDCOM file's program, date and encoding ("MyHeritage · 14 NOV 2026 · UTF-8"). */
    private sourceMeta(): string {
        const state = this.mergeState;
        const importId = this.gedcomImport?.importId;
        const rec = importId ? state?.incomingData.imports?.find(r => r.id === importId) : undefined;
        if (!rec) return '';
        const names = strings.gedcom.encodingNames as Record<string, string>;
        const enc = rec.encoding ? names[rec.encoding] ?? rec.encoding : '';
        return [importProgramName(rec), rec.fileDate ?? '', enc].filter(Boolean).join(' · ');
    }

    /** What the import holds, as tiles (an import that is not a GEDCOM file being read). */
    private sourceTiles(): Array<[string, number]> {
        const data = this.mergeState?.incomingData;
        if (!data) return [];
        const G = strings.gedcom;
        const persons = Object.values(data.persons);
        return [
            [G.persons, persons.filter(p => !p.isPlaceholder).length],
            [G.partnerships, Object.keys(data.partnerships).length],
            [G.photos, persons.filter(p => !!p.photo).length],
            [G.sources, Object.keys(data.sources ?? {}).length],
            [G.events, persons.reduce((n, p) => n + (p.events?.length ?? 0), 0)],
        ];
    }

    private notTaken(): readonly GedcomDroppedTag[] {
        if (!this.gedcomLive) return [];
        try {
            return getUI().gedcomResult?.stats.droppedTags ?? [];
        } catch {
            return [];
        }
    }

    /** A tree as a row of step 1's list: its line and why it cannot be the target. */
    private targetRow(id: TreeId): TargetRow {
        const meta = TreeManager.getTreeMetadata(id);
        const block = targetBlock(id);
        return {
            treeId: id,
            name: meta?.name ?? '',
            persons: meta?.personCount ?? 0,
            open: !DataManager.isViewMode() && DataManager.getCurrentTreeId() === id,
            research: !!meta?.research,
            backup: this.backups.get(id) ?? null,
            block,
            why: block ? targetBlockText(block, id) : '',
        };
    }

    /**
     * A tree that cannot take the import, when it is the only one (§2: 2f,
     * 2g, 2j): a dialog says why with its way out. Locked: Open Manage trees;
     * followed live: End following (true, the tree takes it then). False:
     * another tree to choose, or nothing to do now.
     */
    async blockDialog(treeId: TreeId): Promise<boolean> {
        const block = targetBlock(treeId);
        if (!block) return true;
        const W = strings.mergeWizard;
        const name = TreeManager.getTreeMetadata(treeId)?.name ?? '';
        const ui = getUI();
        if (block === 'live') {
            const end = await ui.showConfirm(W.blockLive, W.blockLiveTitle(name),
                { ok: strings.research.stop, cancel: W.pickOther });
            if (!end) return false;
            ui.setLiveFollow(false);
            return !targetBlock(treeId);
        }
        if (block === 'locked') {
            const manage = await ui.showConfirm(targetBlockText(block, treeId), W.blockLiveTitle(name),
                { ok: strings.treeManager.manageTreesTitle, cancel: W.pickOther });
            if (manage) ui.showTreeManagerDialog();
            return false;
        }
        await ui.showAlert(targetBlockText(block, treeId), 'warning', W.blockLiveTitle(name));
        return false;
    }

    /** "End following" of step 1's line (2f): the open tree is written to again, step 1 goes on with it as the target. */
    private endFollow(): void {
        const ws = this.mergeState?.wizard;
        if (!ws) return;
        getUI().setLiveFollow(false);
        const id = DataManager.isViewMode() ? null : DataManager.getCurrentTreeId();
        if (!id || targetBlock(id)) {
            this.wizard.refresh({ body: true });
            return;
        }
        if (ws.choices.mode === 'new') ws.choices = { ...ws.choices, mode: 'add', json: false };
        void this.selectTarget(id);
    }

    /** The trees the import can go to (the source tree aside), the open one first. */
    private targetRows(): TargetRow[] {
        const source = this.sourceInfo.kind === 'tree' ? this.sourceInfo.treeId : undefined;
        const rows = TreeManager.getTrees().filter(t => t.id !== source && t.id !== this.excludeTarget).map(t => this.targetRow(t.id));
        rows.sort((a, b) => Number(b.open) - Number(a.open));
        this.loadBackups(rows.map(r => r.treeId));
        return rows;
    }

    /** The latest backup of each tree, read once; the rows' lines follow in place. */
    private loadBackups(ids: TreeId[]): void {
        for (const id of ids) {
            if (this.backups.has(id)) continue;
            this.backups.set(id, null);
            void listSnapshots(id).then(list => {
                const at = list[0]?.createdAt;
                if (!at) return;
                this.backups.set(id, formatRelativeDateTime(at, getCurrentLanguage()));
                const row = this.targetRow(id);
                if (row.block) return;
                const line = document.querySelector(`#merge-step-body .merge-s1-target[data-tree="${CSS.escape(id)}"] .merge-s1-tline`);
                if (line) line.textContent = strings.mergeWizard.treeLine(row.persons, row.open, row.research, row.backup);
            }).catch(() => undefined);
        }
    }

    /** Step 1's mode: New tree, Add to a tree, Only compare, or Save as JSON (a mode 'new' that writes nothing). */
    private setStep1Mode(mode: PlanMode | 'json'): void {
        const ws = this.mergeState?.wizard;
        if (!ws) return;
        if (mode === 'json' || mode === 'new') {
            this.wizard.update({ mode: 'new', json: mode === 'json' });
            return;
        }
        if (!ws.choices.targetTreeId) {
            const rows = this.targetRows();
            const first = rows.find(r => !r.block);
            if (first) {
                ws.choices = { ...ws.choices, mode, json: false };
                void this.selectTarget(first.treeId);
                return;
            }
            // Every tree blocked: the first one's reason in a dialog with its way out (2f, 2g); the step shows the list.
            this.wizard.update({ mode, json: false });
            const blocked = rows[0];
            if (blocked) {
                void this.blockDialog(blocked.treeId).then(free => {
                    if (free && this.mergeState?.wizard === ws) void this.selectTarget(blocked.treeId);
                    else this.wizard.refresh({ body: true });
                });
            }
            return;
        }
        this.wizard.update({ mode, json: false });
    }

    /** The chosen target is encrypted and locked: compared once unlocked (13f). */
    private encLocked(): boolean {
        const id = this.mergeState?.wizard?.choices.targetTreeId;
        if (!id || this.targetLoaded === id) return false;
        return SettingsManager.isEncryptionEnabled() && !CryptoSession.isUnlocked();
    }

    /** Load a tree's data as the merge's target; false when it cannot be read (yet). */
    private async loadTarget(id: TreeId): Promise<boolean> {
        const state = this.mergeState;
        if (!state) return false;
        if (this.targetLoaded === id) return true;
        const open = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === id;
        if (!open && SettingsManager.isEncryptionEnabled() && !CryptoSession.isUnlocked()) return false;
        const data = open ? DataManager.getData() : await TreeManager.getTreeData(id);
        if (!data || this.mergeState !== state || state.wizard?.choices.targetTreeId !== id) return false;
        const fingerprint = contentFingerprint(data);
        state.existingData = data;
        state.matches = [];
        state.unmatchedExisting = [];
        state.target = { treeId: id, fingerprint };
        this.targetLoaded = id;
        if (state.wizard) state.wizard.choices = { ...state.wizard.choices, targetFingerprint: fingerprint };
        return true;
    }

    /** Another target chosen in step 1: its data loaded, the comparison to run again. */
    private async selectTarget(id: TreeId): Promise<void> {
        const state = this.mergeState;
        const ws = state?.wizard;
        const meta = TreeManager.getTreeMetadata(id);
        if (!state || !ws || !meta || targetBlock(id)) return;
        const { targetResearch: _r, targetFingerprint: _f, ...rest } = ws.choices;
        ws.choices = { ...rest, targetTreeId: id, targetName: meta.name, ...(meta.research ? { targetResearch: true } : {}) };
        ws.compared = false;
        ws.reached = 1;
        this.exampleCache = null;
        this.targetTreeName = meta.name;
        if (this.targetLoaded !== id) this.targetLoaded = null;
        await this.loadTarget(id);
        if (this.mergeState !== state) return;
        this.wizard.update();
    }

    /** "Unlock" of an encrypted locked target (13f): the password asked, the tree read. */
    private async unlockTarget(): Promise<void> {
        const id = this.mergeState?.wizard?.choices.targetTreeId;
        if (!id) return;
        if (!await getUI().ensureLocalUnlocked()) return;
        await this.loadTarget(id);
        this.wizard.refresh({ body: true });
    }

    /** Swap of two trees (3b): the target becomes the source and the other way round; compared again. */
    private async swap(): Promise<void> {
        const state = this.mergeState;
        const ws = state?.wizard;
        const sourceId = this.sourceInfo.treeId;
        const targetId = ws?.choices.targetTreeId;
        if (!state || !ws || !sourceId || !targetId || targetBlock(sourceId)) return;
        const openId = DataManager.isViewMode() ? null : DataManager.getCurrentTreeId();
        const read = async (id: TreeId): Promise<StromData | null> =>
            id === openId ? structuredClone(DataManager.getData()) : TreeManager.getTreeData(id);
        const [incoming, target] = await Promise.all([read(targetId), read(sourceId)]);
        if (!incoming || !target || this.mergeState !== state) return;
        const sourceName = TreeManager.getTreeMetadata(targetId)?.name ?? '';
        const targetName = TreeManager.getTreeMetadata(sourceId)?.name ?? '';
        const fingerprint = contentFingerprint(target);
        const next = createMergeState(target, incoming, { match: false });
        next.phase = 'reviewing';
        next.target = { treeId: sourceId, fingerprint };
        const { targetResearch: _r, targetFingerprint: _f, ...rest } = ws.choices;
        next.wizard = {
            ...ws, step: 1, reached: 1, compared: false,
            choices: {
                ...rest,
                swapped: !ws.choices.swapped,
                source: { ...ws.choices.source, label: sourceName, treeId: targetId, persons: Object.values(incoming.persons).filter(p => !p.isPlaceholder).length },
                targetTreeId: sourceId,
                targetName,
                targetFingerprint: fingerprint,
                ...(TreeManager.getTreeMetadata(sourceId)?.research ? { targetResearch: true } : {}),
            },
        };
        this.mergeState = next;
        this.sourceInfo = { ...this.sourceInfo, treeId: targetId };
        this.sourceTreeName = sourceName;
        this.incomingFileName = sourceName;
        this.targetTreeName = targetName;
        this.targetLoaded = sourceId;
        this.exampleCache = null;
        this.renderValidationBanner();
        this.markUnsavedChanges();
        this.wizard.refresh({ body: true });
    }

    /**
     * Step 1's Compare: the import matched with the chosen target (the state
     * replaced), in parts with the window free between them (K3.5); stopped
     * by `run.signal`: false, the state and step 1's choices as they were.
     */
    private async compare(run: CompareRun = {}): Promise<boolean> {
        const state = this.mergeState;
        const id = state?.wizard?.choices.targetTreeId;
        if (!state || !id) return false;
        if (!await this.loadTarget(id) || this.mergeState !== state || run.signal?.aborted) return false;
        const target = state.existingData;
        let found: PersonMatch[];
        try {
            found = await findMatchesAsync(target, state.incomingData, {
                ...(run.onProgress ? { onProgress: run.onProgress } : {}),
                ...(run.signal ? { signal: run.signal } : {}),
            });
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') return false;
            throw e;
        }
        if (this.mergeState !== state || run.signal?.aborted) return false;
        // The pairs just found serve the rebase and the merge's later recalculations.
        const done = rebaseMergeState(state, target, { treeId: id, fingerprint: contentFingerprint(target) }, found);
        if (this.mergeState !== state) return false;
        done.phase = 'reviewing';
        this.mergeState = done;
        this.exampleCache = null;
        return true;
    }

    /** The scope's options said on one person of the target (§3), once per target and comparison. */
    private example(): ScopeExample | null {
        const state = this.mergeState;
        const ws = state?.wizard;
        if (!state || !ws || !this.targetLoaded) return null;
        const key = `${this.targetLoaded}|${ws.compared}`;
        if (this.exampleCache?.key !== key) {
            this.exampleCache = { key, value: scopeExample(state.incomingData, state.existingData, ws.compared ? state : undefined) };
        }
        return this.exampleCache.value;
    }

    /** The same import merged into the target before (13c); '' when not. */
    private repeatLine(): string {
        const state = this.mergeState;
        const ws = state?.wizard;
        if (!state || !ws || !this.targetLoaded) return '';
        const merges = (state.existingData as StromData & { merges?: readonly MergeRecord[] }).merges;
        const before = isRepeatOf(ws.choices.source, merges);
        if (!before) return '';
        const day = formatRelativeDateTime(Date.parse(before.at), getCurrentLanguage());
        const joined = Math.min(ws.choices.source.persons, before.added.length + before.joined.length);
        return strings.mergeWizard.repeat(day, Math.max(0, ws.choices.source.persons - joined), joined);
    }

    /** Step 5's "Save the list…" (K6.4): the plan as a .txt to read and a .json, living people protected. */
    savePlan(plan: MergePlan): void {
        const state = this.mergeState;
        if (!state) return;
        const { txt, json } = exportPlan(plan, { source: state.incomingData, target: state.existingData });
        const base = `${(state.wizard?.choices.source.label ?? '').replace(/\.(ged|gedcom|json)$/i, '') || 'import'}-plan`;
        const save = (text: string, ext: string, type: string): void => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type }));
            a.download = `${base}.${ext}`;
            a.click();
            URL.revokeObjectURL(a.href);
        };
        save(txt, 'txt', 'text/plain;charset=utf-8');
        save(json, 'json', 'application/json');
    }

    /** "Save list…": every kind of line not taken over, as a .txt file. */
    saveNotTaken(): void {
        const dropped = this.notTaken();
        const label = this.mergeState?.wizard?.choices.source.label ?? '';
        if (dropped.length === 0) return;
        const blob = new Blob([notTakenText(label, dropped)], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${label.replace(/\.(ged|gedcom)$/i, '') || 'import'}-not-taken.txt`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /** The "Show all" list's ×, Close and backdrop. */
    closeNotTaken(): void {
        closeNotTaken();
    }

    /** Download JSON (step 1, a GEDCOM file): the converted data saved, nothing written, the guide closed. */
    private downloadJson(): void {
        if (!this.gedcomLive) return;
        getUI().downloadGedcomAsJson();
        this.hasUnsavedChanges = false;
        this.closeMergeModalInternal();
    }

    /**
     * The GEDCOM file's data changed in step 1 (another encoding, images left
     * out, media attached): the import is that data now, compared again.
     */
    replaceIncoming(data: StromData): void {
        const state = this.mergeState;
        const ws = state?.wizard;
        if (!state || !ws || !this.gedcomLive) return;
        state.incomingData = data;
        state.matches = [];
        state.unmatchedExisting = [];
        ws.choices = { ...ws.choices, source: { ...ws.choices.source, persons: Object.values(data.persons).filter(p => !p.isPlaceholder).length } };
        ws.compared = false;
        ws.reached = 1;
        this.exampleCache = null;
        this.wizard.refresh();
    }

    /** The guide shows a GEDCOM file being read now (its summary is step 1's). */
    hasGedcomGuide(): boolean {
        return this.gedcomLive && !!this.mergeState;
    }

    /** The GEDCOM file read for the guide is let go: its summary home, the read data dropped. */
    private endGedcom(): void {
        parkGedcomSummary();
        if (!this.gedcomLive) return;
        this.gedcomLive = false;
        try {
            getUI().endGedcomGuide();
        } catch { /* no UI (unit tests) */ }
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
        // Written (step 6): × and Esc are Done (§9), nothing to save for later.
        if (this.written) {
            void this.finishDone();
            return;
        }
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
        this.endGedcom();

        // Cleanup
        this.removeEscapeHandler();
        this.clearAutoSave();
        clearCurrentMerge();

        // Check if we should return to tree manager
        const shouldReturnToTreeManager = this.openedFromTreeManager;

        this.mergeState = null;
        this.written = null;
        this.hasUnsavedChanges = false;
        this.incomingFileName = undefined;
        this.targetTreeName = undefined;
        this.sourceTreeName = undefined;
        this.openedFromTreeManager = false;
        this.resumedSessionId = undefined;
        this.excludeTarget = undefined;
        this.initialTarget = null;

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
        // Step 2 draws its list and pair again; the other steps keep their body.
        this.wizard.refresh({ body: this.wizard.step === 2 });
    }

    /** Step 2: the decisions on the pairs and what opens from them (spec 134 §4). */
    private step2Env(): Step2Env {
        return {
            decide: (id, decision) => {
                const state = this.mergeState;
                if (!state) return;
                if (decision === null) state.decisions.delete(id);
                else updateMatchDecision(state, id, decision);
                // The undecided pairs again (K3.3); the step says whose offer changed.
                noteRecalc(state, recalcUndecided(state, id).changed);
                this.markUnsavedChanges();
                this.renderModalContent();
            },
            decideMany: (ids, decision) => {
                const state = this.mergeState;
                if (!state || ids.length === 0) return;
                for (const id of ids) updateMatchDecision(state, id, decision);
                noteRecalc(state, recalcUndecided(state, ids[0]).changed);
                this.markUnsavedChanges();
                this.renderModalContent();
            },
            other: id => this.showManualMatchDialog(id),
            unionConflicts: id => this.unionConflictLines(id),
            compare: (id, treeId) => this.showCompareView(id, treeId),
            preview: id => this.showPreviewView(id),
            reanalyze: () => { void this.reanalyze(); },
        };
    }

    /** The couples of an import's person both trees know that differ, as lines of "What speaks against". */
    private unionConflictLines(incomingId: PersonId): UnionConflictLine[] {
        const state = this.mergeState;
        if (!state) return [];
        return this.groupPartnershipConflicts().filter(group => {
            const u = state.incomingData.partnerships[group[0].incomingPartnershipId];
            return !!u && (u.person1Id === incomingId || u.person2Id === incomingId);
        }).map(group => {
            const first = group[0];
            const fields = group.map(c => `${this.partnershipFieldLabel(c.field)}: ${this.partnershipValueText(c.field, c.existingValue)} → ${this.partnershipValueText(c.field, c.incomingValue)}`);
            return {
                id: first.incomingPartnershipId,
                text: `${strings.merge.partnershipConflict} ${this.partnershipCoupleName(first.existingPartnershipId)}: ${fields.join(', ')}`,
            };
        });
    }

    private formatPersonInfo(person: Person): string {
        const name = shownNameOrEmpty(person);
        const year = person.birthDate?.split('-')[0] || '';
        return year ? `${name} (*${year})` : name;
    }

    /** The pair side by side in both trees (the tree's person: the one chosen in the step). */
    private showCompareView(incomingId: PersonId, treeId?: PersonId): void {
        const state = this.mergeState;
        if (!state) return;
        const match = state.matches.find(m => m.incomingId === incomingId);
        const existingId = treeId ?? match?.existingId;
        const existing = existingId ? state.existingData.persons[existingId] : undefined;
        const incoming = state.incomingData.persons[incomingId];
        if (!existingId || !existing || !incoming) return;
        TreeCompare.showComparison({
            left: {
                data: state.existingData,
                focusPersonId: existingId,
                depthUp: 2,
                depthDown: 2,
                title: this.targetTreeName || strings.merge.existingTree,
                subtitle: this.formatPersonInfo(existing),
            },
            right: {
                data: state.incomingData,
                focusPersonId: incomingId,
                depthUp: 2,
                depthDown: 2,
                title: this.sourceTreeName || this.incomingFileName || strings.merge.incomingTree,
                subtitle: this.formatPersonInfo(incoming),
            },
        });
    }

    /** The import's person in its own tree (a new person has no pair). */
    private showPreviewView(incomingId: PersonId): void {
        const state = this.mergeState;
        const person = state?.incomingData.persons[incomingId];
        if (!state || !person) return;
        TreePreview.show({
            data: state.incomingData,
            focusPersonId: incomingId,
            depthUp: 2,
            depthDown: 2,
            title: this.sourceTreeName || this.incomingFileName || strings.merge.incomingTree,
            subtitle: this.formatPersonInfo(person),
        });
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

        // The hand-picked pair, and the undecided pairs again (K3.3).
        noteRecalc(this.mergeState, recalcUndecided(this.mergeState, incomingId).changed);

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

    // ==================== PARTNERSHIP CONFLICTS ====================
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

    /** A partnership conflict value as text; status is localized. */
    private partnershipValueText(field: PartnershipConflictField, v: string): string {
        if (field === 'status' && v in strings.partnershipStatus) return strings.partnershipStatus[v as PartnershipStatus];
        return v || '—';
    }

    // ==================== MERGE ACTIONS ====================

    /**
     * Re-analyze matches after user changes
     */
    reanalyze(): Promise<void> {
        const state = this.mergeState;
        if (!state) return Promise.resolve();
        // §8: the matching runs again over both trees, under the working state of the button,
        // in parts (the window stays usable, K3.5).
        return runHeavy(activatedElement(), async () => {
            const found = await findMatchesAsync(state.existingData, state.incomingData);
            if (this.mergeState !== state) return;
            reanalyzeMatches(state, found);
            this.wizard.refresh({ body: true });
        }, { label: strings.merge.analyzing, atOnce: mergeAnalysisLong(state.existingData, state.incomingData) }).then(() => undefined);
    }

    /** A failed write's state above step 5's list (spec 134 §8 8b, 8d, 8e); 8c is `replan`'s. */
    private writeFailureStatus(result: Exclude<Awaited<ReturnType<typeof writePlan>>, { ok: true } | { need: 'replan' }>): WriteStatus {
        if ('need' in result) return { kind: 'retention', date: new Date(result.date).toLocaleDateString(getCurrentLanguage()) };
        if (result.reason === 'backup') return { kind: 'backupFailed', why: result.why, detail: result.detail };
        if (result.reason === 'save') return { kind: 'failed', message: result.message };
        // The plan's own findings lead with "The totals do not match": said once, in bold.
        const message = result.message.startsWith(strings.mergeWizard.badTotals)
            ? result.message.slice(strings.mergeWizard.badTotals.length).trim() : result.message;
        const detail = result.issues.map(i => JSON.stringify(i)).join('\n');
        return { kind: 'bad', message, detail };
    }

    /** How the target changed meanwhile, in words: "2 new people, 1 edited person" (8c). */
    private changeText(changed: TargetChange): string {
        const W = strings.mergeWizard;
        const parts = [
            ...(changed.added ? [W.changedAdded(changed.added)] : []),
            ...(changed.edited ? [W.changedEdited(changed.edited)] : []),
        ];
        const at = changed.when ? new Date(changed.when).toLocaleString(getCurrentLanguage(), { dateStyle: 'short', timeStyle: 'short' }) : '?';
        return W.targetChanged(this.mergeState?.wizard?.choices.targetName ?? '', at, parts.length ? parts.join(', ') : W.changedOther);
    }

    /**
     * The target changed since the comparison (8c, K6.5): its data as they are
     * now become the merge's, the people matched again (the decisions kept),
     * the plan and the button recalculated. Nothing is written.
     */
    private async replan(changed: TargetChange): Promise<void> {
        const state = this.mergeState;
        const id = state?.target?.treeId ?? state?.wizard?.choices.targetTreeId;
        if (!state || !id) return;
        const now = DataManager.getDataFor(id) ?? await TreeManager.getTreeData(id).catch(() => null);
        if (!now || this.mergeState !== state) return;
        const fingerprint = contentFingerprint(now);
        state.existingData = now;
        state.target = { treeId: id, fingerprint };
        if (state.wizard) state.wizard.choices = { ...state.wizard.choices, targetFingerprint: fingerprint };
        const found = await findMatchesAsync(now, state.incomingData);
        if (this.mergeState !== state) return;
        reanalyzeMatches(state, found);
        this.exampleCache = null;
        this.markUnsavedChanges();
        this.wizard.refresh({ body: true });
        this.wizard.setWriteStatus({ kind: 'changed', text: this.changeText(changed) });
    }

    /** 8d: Backups… or Export of the target over the guide; Esc comes back to it. */
    private openTargetDialog(which: 'backups' | 'export'): void {
        const id = this.mergeState?.target?.treeId ?? this.mergeState?.wizard?.choices.targetTreeId;
        if (!id) return;
        if (which === 'backups') void getUI().showSnapshotsDialog(id, 'merge-modal');
        else getUI().showExportDialog(id, 'merge-modal');
    }

    /** Where the write stands (8a check, 8f backup and people), above step 5's list. */
    private writeProgress(plan: MergePlan, name: string, phase: WritePhase, a: number, n: number): void {
        if (phase === 'done') return;
        if (phase === 'check') {
            const c = planCounts(plan);
            const sources = Object.keys(this.mergeState?.incomingData.sources ?? {}).length;
            this.wizard.setWriteStatus({ kind: 'checking', p: c.total, l: c.partnerships + c.links, s: sources });
        } else if (phase === 'backup') {
            this.wizard.setWriteStatus({ kind: 'backup', t: plan.target.name });
        } else {
            this.wizard.setWriteStatus({ kind: 'writing', t: name, a, n });
        }
    }

    /** A whole GEDCOM file written as a new tree named after the file, the guide closed (spec 134 §3). */
    private async writeGedcomNewTree(plan: MergePlan, state: MergeState): Promise<void> {
        const importId = this.gedcomImport?.importId;
        await getUI().importGuideNewTree(state.incomingData, newTreeName(plan), importId, () => {
            if (state.wizard) state.wizard.choices = { ...state.wizard.choices, writtenAt: new Date().toISOString() };
            if (this.resumedSessionId) void deleteMergeSession(this.resumedSessionId);
            this.gedcomImport = undefined;
            this.hasUnsavedChanges = false;
            // Back to Manage trees only when the import started there.
            this.closeMergeModalInternal();
        });
    }

    /**
     * Write the guide's plan (step 5): a new tree "{target} + {source}"
     * through applyPlan and its check before saving (spec 134 §8, the interim
     * way). On a failure nothing is saved and the guide stays open; after the
     * write, today's ending: Manage trees and the offer to switch.
     */
    private async write(plan: MergePlan, opts: { retention?: 'keep-both' | 'drop-oldest' } = {}): Promise<void> {
        const state = this.mergeState;
        if (!state) return;

        // A GEDCOM file as a new tree, whole: today's import of a new tree
        // (it opens, the empty starting tree goes, the "What next" card).
        if (plan.mode === 'new' && this.gedcomImport && planTakesAll(plan)) {
            await this.writeGedcomNewTree(plan, state);
            return;
        }

        state.phase = 'executing';

        // Nothing created, nothing saved on a failure: the wizard stays open
        // with its answers, the message says what would have gone wrong
        // (spec 134 K0.2, K0.5). The backup "Before merge" of the target as it
        // is at the write, whatever the way into the merge (file, tree, view,
        // share, a resumed merge) and the automatic backups setting (K0.4, §2),
        // is taken by the write. Into the tree itself or a new tree (Where to write, K6.3).
        const into = plan.mode === 'add' && (state.wizard?.choices.into ?? 'tree') === 'tree' ? 'tree' : 'new';
        const name = into === 'tree' ? plan.target.name : newTreeName(plan);
        const result = await writePlan(plan, {
            target: state.existingData, source: state.incomingData, into, ...(into === 'new' ? { name } : {}),
            ...(opts.retention ? { retention: opts.retention } : {}),
            onProgress: (phase, a, n) => this.writeProgress(plan, name, phase, a, n),
        });
        if (!result.ok) {
            state.phase = 'reviewing';
            if (this.mergeState !== state) return;
            if ('need' in result && result.need === 'replan') {
                this.wizard.setWriteStatus(null);
                await this.replan(result.changed);
                return;
            }
            this.wizard.setWriteStatus(this.writeFailureStatus(result));
            return;
        }
        if (state.wizard) state.wizard.choices = { ...state.wizard.choices, writtenAt: result.record.at || new Date().toISOString() };

        // A resumed saved merge is done: its session goes.
        if (this.resumedSessionId) await deleteMergeSession(this.resumedSessionId);
        this.resumedSessionId = undefined;
        // Written: nothing is left to save for later or to ask about on closing.
        this.hasUnsavedChanges = false;
        this.clearAutoSave();
        void clearCurrentMerge();
        window.dispatchEvent(new CustomEvent('strom:merge-session-changed'));

        // What the import brought, for the card after Done (a new tree from another program).
        const gedcomImport = this.gedcomImport;
        const importId = gedcomImport?.importId ? result.importMap?.get(gedcomImport.importId) : undefined;
        this.written = {
            treeId: result.treeId, name: result.name, record: result.record, mode: plan.mode,
            newTree: result.into !== 'tree', gedcom: !!gedcomImport, ...(importId ? { importId } : {}),
            fromTreeManager: this.openedFromTreeManager,
        };

        // The open tree written into shows the result at once under the guide (one step of Undo).
        if (result.into === 'tree' && !DataManager.isViewMode() && DataManager.getCurrentTreeId() === result.treeId) {
            await TreeRenderer.renderAsync();
            getUI().refreshSearch();
            getUI().updateTreeSwitcher();
        }
        if (this.mergeState !== state) return;
        // Step 6 (§9): what happened, until Done.
        this.wizard.showDone();
    }

    /** Step 6 (§9): the written merge and its actions. */
    private step6Env(): Step6Env | null {
        const w = this.written;
        if (!w) return null;
        return {
            record: w.record, treeId: w.treeId, treeName: w.name, intoExisting: !w.newTree,
            noNextCard: !w.newTree && w.gedcom,
            showInTree: () => void this.finishDone({ show: true }),
            saveAsList: () => void this.saveWrittenAsList(w),
            checkTree: () => void getUI().showTreeValidationDialog(w.treeId, 'merge-modal'),
            undoMerge: () => getUI().showUndoMerge(w.treeId, w.record.id, 'merge-modal'),
            research: this.step6Research(w),
        };
    }

    /**
     * Step 6's research block (§11): a tree with a research whose merge waits
     * for a send (K9.2). An agent at work, an older research said (11d, 11e).
     */
    private step6Research(w: WrittenMerge): Step6Env['research'] {
        if (w.newTree) return undefined;
        const link = TreeManager.getTreeMetadata(w.treeId)?.research;
        const hold = link && !link.copy ? link.mergeHold : undefined;
        if (!link || !hold) return undefined;
        const data = DataManager.getDataFor(w.treeId);
        const pending = data ? unsentMerges(data, link) : [w.record];
        if (!pending.some(r => r.id === w.record.id)) return undefined;
        const status = getUI().researchStatusOf(link.id);
        const worker = status?.working?.find(x => !x.paused);
        const line = worker ? worker.research || worker.person || worker.branch || '' : '';
        return {
            persons: hold.persons, links: heldLinks(pending), kept: !!w.keptLocal,
            agent: line || null,
            old: status && !status.accepts ? status.version || '?' : null,
            send: () => void this.sendWrittenToResearch(w),
            keepLocal: () => {
                w.keptLocal = true;
                this.wizard.refresh({ body: true });
            },
        };
    }

    /**
     * Send to the research… of step 6 (§11, 11a): the guide closes on the
     * tree, then today's "What will be sent" with the merge's words (Keep in
     * the app for now · Send to the research); a send that lands takes the
     * hold away (research-hold.ts). An older research: the whole tree as
     * today (11e).
     */
    private async sendWrittenToResearch(w: WrittenMerge): Promise<void> {
        await this.finishDone({ show: true });
        await getUI().sendMergeToResearch(w.treeId);
    }

    /**
     * Done (Esc, ×) of step 6, or Show in the tree: the guide closes. A
     * tree that was there: the toast "{n} added to the tree {t} · Undo ·
     * What happened" (10g, K8.5). A new tree: Manage trees shows it (Show
     * in the tree opens it), the "What next" card of a file from another
     * program follows without its data check (the step had it).
     */
    private async finishDone(opts: { show?: boolean } = {}): Promise<void> {
        const w = this.written;
        const state = this.mergeState;
        const plan = this.wizard.currentPlan;
        if (!w || !state || !plan) return;
        // Manage trees comes back only for a new tree (it shows there) or when the guide started there.
        const backToManager = !opts.show && (w.newTree || w.fromTreeManager);
        this.openedFromTreeManager = false;
        this.gedcomImport = undefined;
        this.written = null;
        this.closeMergeModalInternal();
        // What happened (the toast) opens this step again.
        this.lastWritten = { w, state, plan };

        if (opts.show) await this.showWrittenInTree(w);
        else if (backToManager) getUI().showTreeManagerDialog();

        if (w.newTree) {
            if (w.gedcom && w.importId) {
                void getUI().afterImport(w.treeId, {
                    gedcom: true, path: 'merge', importId: w.importId, noCheck: true,
                    added: w.record.counts.added, updated: w.record.counts.joined,
                });
            }
            return;
        }
        if (!w.toasted) {
            w.toasted = true;
            this.toastWritten(w);
        }
    }

    /**
     * Switch to the tree written into (when another is open) and highlight
     * the people the merge added (step 6, the Merge history's record).
     */
    async showWrittenInTree(w: ShownMerge): Promise<void> {
        if (DataManager.isViewMode() || DataManager.getCurrentTreeId() !== w.treeId) {
            if (!await DataManager.switchTree(w.treeId)) return;
            getUI().updateTreeSwitcher();
            TreeRenderer.restoreFromSession();
            await TreeRenderer.renderAsync();
            getUI().refreshSearch();
            ZoomPan.centerOnFocusWithContext();
            window.dispatchEvent(new CustomEvent('strom:tree-switched'));
            getUI().closeTreeManagerDialog();
        }
        // An import alone as a new tree: everyone in it is new, nothing to pick out.
        if (w.mode === 'new') return;
        const data = DataManager.getData();
        const ids = w.record.added.filter(id => data.persons[id] && !data.persons[id].isPlaceholder);
        if (!ids.length) return;
        getUI().highlightGroup({
            kind: 'merged', title: n => strings.mergeWizard.toastAdded(n, w.name),
            personIds: ids, recount: null, cite: false,
        });
    }

    /** "{n} added to the tree {t}" · Undo (while the write is Undo's last step) · What happened. */
    private toastWritten(w: WrittenMerge): void {
        const W = strings.mergeWizard;
        const toast = getUI().showToast(W.toastAdded(w.record.counts.added, w.name), 10000, {
            closable: true,
            ...(this.undoableWrite(w) ? { action: { label: strings.undo.undo, run: () => this.undoWritten(w) } } : {}),
            more: { label: W.whatHappened, run: () => this.reopenWritten(w) },
        });
        this.writtenToast = { recordId: w.record.id, close: () => toast.close() };
    }

    /** The write is the open tree's last step of Undo: one Undo takes it back whole (K8.5). */
    private undoableWrite(w: WrittenMerge): boolean {
        if (DataManager.isViewMode() || DataManager.getCurrentTreeId() !== w.treeId) return false;
        if (DataManager.lastUndoDescription() !== strings.undo.mergeTrees) return false;
        const merges = DataManager.getData().merges ?? [];
        return merges[merges.length - 1]?.id === w.record.id;
    }

    /** The toast's Undo: the one step of Undo while it is still the write's, else the merge's undo. */
    private undoWritten(w: WrittenMerge): void {
        if (this.undoableWrite(w)) getUI().performUndo();
        else getUI().showUndoMerge(w.treeId, w.record.id);
    }

    /** The toast's What happened: step 6 of the merge again (nothing is written). */
    private reopenWritten(w: WrittenMerge): void {
        const last = this.lastWritten;
        if (!last || last.w !== w || this.mergeState) return;
        this.mergeState = last.state;
        this.written = w;
        this.hasUnsavedChanges = false;
        this.openedFromTreeManager = false;
        this.lastWritten = null;
        document.getElementById('merge-modal')?.classList.add('active');
        this.setupEscapeHandler();
        this.wizard.showDone(last.plan);
    }

    /**
     * Save as a list of people (spec 084): the people the merge added, named
     * "From {source} {day}". `host` holds the done button (step 6's by default).
     */
    async saveWrittenAsList(w: ShownMerge, host?: ParentNode): Promise<void> {
        const W = strings.mergeWizard;
        const name = W.listName(w.record.source.label || '?', writtenWhen(w.record.at));
        if (!DataManager.isViewMode() && DataManager.getCurrentTreeId() === w.treeId) {
            const list = DataManager.createPersonList({ name, dynamic: false, personIds: [...w.record.added] });
            if (list) this.listSaved(host);
            return;
        }
        // Another tree than the open one: the list goes into its data as stored.
        const data = await TreeManager.getTreeData(w.treeId);
        if (!data) return;
        const lists = personListsOf(data);
        const listName = suggestListName(lists, name, undefined, listDisplayName);
        const list: PersonList = {
            id: newPersonListId(lists), name: listName, dynamic: false, sort: 'manual', updated: new Date().toISOString(),
            personIds: [...new Set(w.record.added)].filter(id => !!data.persons[id] && !data.persons[id].isPlaceholder),
        };
        data.personLists = [...(data.personLists ?? []), list];
        if (!await TreeManager.saveTreeDataConfirmed(w.treeId, data)) return;
        getUI().showToast(strings.lists.toast.saved(listName), 4000);
        this.listSaved(host);
    }

    /**
     * Merge `recordId` was undone (§10): the guide on its step 6 closes
     * without its toast, and the toast of an earlier Done goes (its Undo and
     * What happened would speak of a merge no longer there).
     */
    closeUndone(recordId: string): void {
        if (this.lastWritten?.w.record.id === recordId) this.lastWritten = null;
        if (this.writtenToast?.recordId === recordId) {
            this.writtenToast.close();
            this.writtenToast = null;
        }
        if (this.written?.record.id !== recordId) return;
        this.openedFromTreeManager = false;
        this.gedcomImport = undefined;
        this.closeMergeModalInternal();
    }

    /** Saved once: the button is done (a second list would only be a copy). */
    private listSaved(host: ParentNode | null = document.getElementById('merge-step-body')): void {
        const b = host?.querySelector<HTMLButtonElement>('.merge-s6-act[data-act="list"]');
        if (b) b.disabled = true;
    }

    // ==================== HELPERS ====================

    private escapeHtml(text: string): string {
        // Must also escape quotes: callers interpolate into HTML attributes.
        return (text || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export const MergerUI = new MergerUIClass();
