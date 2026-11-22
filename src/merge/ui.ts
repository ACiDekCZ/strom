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
import { runHeavy, activatedElement } from '../ui/busy.js';
import {
    MergeState,
    PartnershipConflict,
    PartnershipConflictField
} from './types.js';
import {
    createMergeState,
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
import { shownNameOrEmpty } from '../person-name.js';
import { iconSvg } from '../icons.js';
import { imageLoads } from '../image-loads.js';
import { pendingImageOf } from '../research-image-refs.js';
import { imgStateOf, smallPortraitHtml, type ImgState } from '../ui/image-slot.js';
import { personPhotoKey } from '../ui/person-photo-model.js';
import { personInitials } from '../initials.js';
import { MergeWizard, targetBlock, targetBlockText, type WizardSource } from './wizard-ui.js';
import type { WizardStep } from './wizard-steps.js';
import { isRepeatOf, planTakesAll, scopeExample, type MergePlan, type MergeRecord, type PlanMode, type PlanSource, type ScopeExample } from './plan.js';
import { newTreeName, writePlanAsNewTree } from './write.js';
import type { Step1Env, Step2Env, TargetRow, UnionConflictLine } from './steps/context.js';
import { closeNotTaken, parkGedcomSummary } from './steps/step1-what.js';
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
        step2: () => this.step2Env(),
        compare: () => this.compare(),
        downloadJson: () => this.downloadJson(),
        step1: () => this.step1Env(),
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
        opts: { mode?: PlanMode; gedcomLive?: boolean } = {},
    ): void {
        const existingData = DataManager.getData();
        this.gedcomImport = gedcomImport;
        this.resumedSessionId = undefined;

        // The backup "Before merge" of the target, whatever the way into the
        // merge (file, tree, view, share) and the automatic backups setting
        // (spec 134 K0.4). A view or a read-only tree gets none.
        this.preMergeBackup = DataManager.snapshotNow('pre-merge').catch(() => null);

        // Create merge state: nobody compared yet, step 1's Compare matches
        // the import with the chosen target (spec 134 §3).
        this.mergeState = createMergeState(existingData, incomingData, { match: false });
        this.mergeState.phase = 'reviewing';
        this.resumedState = false;
        this.gedcomLive = !!opts.gedcomLive;
        this.initialMode = opts.mode;
        this.exampleCache = null;
        this.backups.clear();
        // The target and its data as matched, for a resumed merge to compare (spec 134 K0.6).
        // The open tree is the target when it can be one; otherwise the import starts as a new tree.
        const openId = DataManager.isViewMode() ? null : DataManager.getCurrentTreeId();
        const sourceTreeId = sourceTreeIdOrFileName && TreeManager.getTreeMetadata(sourceTreeIdOrFileName as TreeId)
            ? sourceTreeIdOrFileName as TreeId : null;
        const targetId = openId && openId !== sourceTreeId && !targetBlock(openId) ? openId : null;
        if (targetId) this.mergeState.target = { treeId: targetId, fingerprint: contentFingerprint(existingData) };
        this.targetLoaded = targetId;
        // Into an empty tree there is nothing to compare with: New tree first (the tree stays a choice).
        const emptyOpen = !!targetId && Object.values(existingData.persons).every(p => p.isPlaceholder);
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
    }

    /**
     * Resume merge from saved state
     */
    resumeMerge(state: MergeState, fileName?: string, targetTreeName?: string, sourceTreeName?: string): void {
        this.mergeState = state;
        this.resumedState = true;
        this.gedcomImport = undefined;
        this.gedcomLive = false;
        this.initialMode = undefined;
        this.exampleCache = null;
        this.targetLoaded = state.target?.treeId ?? null;
        this.resumedSessionId = undefined;
        this.preMergeBackup = null;
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
        // Step 1's list of what is not taken over sits above the guide.
        if (closeNotTaken()) return;
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
    /** The mode the guide starts in (none: Add to a tree). */
    private initialMode?: PlanMode;

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

    /** The trees the import can go to (the source tree aside), the open one first. */
    private targetRows(): TargetRow[] {
        const source = this.sourceInfo.kind === 'tree' ? this.sourceInfo.treeId : undefined;
        const rows = TreeManager.getTrees().filter(t => t.id !== source).map(t => this.targetRow(t.id));
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
            const first = this.targetRows().find(r => !r.block);
            if (first) {
                ws.choices = { ...ws.choices, mode, json: false };
                void this.selectTarget(first.treeId);
                return;
            }
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

    /** Step 1's Compare: the import matched with the chosen target (the state replaced). */
    private async compare(): Promise<boolean> {
        const state = this.mergeState;
        const id = state?.wizard?.choices.targetTreeId;
        if (!state || !id) return false;
        if (!await this.loadTarget(id) || this.mergeState !== state) return false;
        const target = state.existingData;
        const targetOf = { treeId: id, fingerprint: contentFingerprint(target) };
        const done = await runHeavy(document.getElementById('merge-next'), () => (
            this.mergeState === state ? rebaseMergeState(state, target, targetOf) : null
        ), { label: strings.merge.analyzing, atOnce: mergeAnalysisLong(target, state.incomingData) });
        if (!done || this.mergeState !== state) return false;
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
                this.markUnsavedChanges();
                this.renderModalContent();
            },
            decideMany: (ids, decision) => {
                const state = this.mergeState;
                if (!state || ids.length === 0) return;
                for (const id of ids) updateMatchDecision(state, id, decision);
                this.markUnsavedChanges();
                this.renderModalContent();
            },
            other: id => this.showManualMatchDialog(id),
            resolve: id => this.showConflictResolution(id),
            unionConflicts: id => this.unionConflictLines(id),
            resolveUnion: id => this.showPartnershipConflictResolution(id),
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
                resolved: state.partnershipResolutions?.has(first.incomingPartnershipId) ?? false,
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

    /** A partnership conflict value as text; status is localized. */
    private partnershipValueText(field: PartnershipConflictField, v: string): string {
        if (field === 'status' && v in strings.partnershipStatus) return strings.partnershipStatus[v as PartnershipStatus];
        return v || '—';
    }

    /** A partnership conflict value as safe HTML; status is localized. */
    private partnershipValueHtml(field: PartnershipConflictField, v: string): string {
        if (field === 'status' && v in strings.partnershipStatus) {
            return this.escapeHtml(strings.partnershipStatus[v as PartnershipStatus]);
        }
        return this.escapeHtml(v || '—');
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
    private async write(plan: MergePlan): Promise<void> {
        const state = this.mergeState;
        if (!state) return;

        // A GEDCOM file as a new tree, whole: today's import of a new tree
        // (it opens, the empty starting tree goes, the "What next" card).
        if (plan.mode === 'new' && this.gedcomImport && planTakesAll(plan)) {
            await this.writeGedcomNewTree(plan, state);
            return;
        }

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
        this.endGedcom();
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
