/**
 * Merge Import - UI Module
 * Handles the merge review modal and user interactions
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { UI } from '../ui.js';
import { ZoomPan } from '../zoom.js';
import { TreePreview, TreeCompare } from '../tree-preview.js';
import { PersonId, Person, StromData, TreeId } from '../types.js';
import { strings } from '../strings.js';
import {
    MergeState,
    PersonMatch,
    MatchFilter,
    MergeStats
} from './types.js';
import {
    createMergeState,
    calculateMergeStats,
    updateMatchDecision,
    updateConflictResolution,
    reanalyzeMatches
} from './matching.js';
import { executeMerge, deleteBackup } from './executor.js';
import { AuditLogManager } from '../audit-log.js';
import { PersonPicker } from '../person-picker.js';
import {
    saveCurrentMerge,
    getCurrentMerge,
    getCurrentMergeInfo,
    clearCurrentMerge,
    saveMergeSession,
    loadMergeSession,
    deleteMergeSession,
    listMergeSessionsInfo,
    hasPendingMerges
} from './persistence.js';

// Auto-save debounce delay (ms)
const AUTO_SAVE_DELAY = 2000;

/**
 * MergerUI class - handles merge modal UI
 */
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

    // Track if opened from tree manager (for returning to it)
    private openedFromTreeManager: boolean = false;
    private targetTreeName?: string;
    private sourceTreeName?: string;

    // ==================== INITIALIZATION ====================

    /**
     * Start merge process with incoming data
     * @param incomingData The data to merge into current tree
     * @param sourceTreeIdOrFileName Either a TreeId (for tree-to-tree merge) or a filename (for file import)
     * @param fromTreeManager Whether this merge was opened from the tree manager
     */
    startMerge(incomingData: StromData, sourceTreeIdOrFileName?: string | TreeId, fromTreeManager: boolean = false): void {
        const existingData = DataManager.getData();

        // Create merge state
        this.mergeState = createMergeState(existingData, incomingData);
        this.mergeState.phase = 'reviewing';
        this.currentFilter = 'all';
        this.selectedMatchIndex = -1;
        this.hasUnsavedChanges = false;
        this.openedFromTreeManager = fromTreeManager;

        // Get current (target) tree name
        const activeTreeId = TreeManager.getActiveTreeId();
        this.targetTreeName = activeTreeId ? TreeManager.getTreeMetadata(activeTreeId)?.name : undefined;

        // Determine if this is a tree-to-tree merge or file import
        if (sourceTreeIdOrFileName && TreeManager.getTreeMetadata(sourceTreeIdOrFileName as TreeId)) {
            const sourceTreeId = sourceTreeIdOrFileName as TreeId;
            this.sourceTreeName = TreeManager.getTreeMetadata(sourceTreeId)?.name;
            this.incomingFileName = this.sourceTreeName;
        } else {
            this.sourceTreeName = undefined;
            this.incomingFileName = sourceTreeIdOrFileName as string | undefined;
        }

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
        this.currentFilter = 'all';
        this.selectedMatchIndex = -1;
        this.hasUnsavedChanges = false;
        this.incomingFileName = fileName;
        this.targetTreeName = targetTreeName;
        this.sourceTreeName = sourceTreeName;

        // Setup escape handler
        this.setupEscapeHandler();

        // Show modal
        this.showMergeModal();
    }

    /**
     * Resume current pending merge (auto-saved)
     */
    async resumeCurrentMerge(): Promise<boolean> {
        const state = await getCurrentMerge();
        if (!state) return false;

        const info = await getCurrentMergeInfo();
        this.resumeMerge(state, info?.incomingFileName);
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

        const state = await loadMergeSession(sessionId);
        if (!state) return false;

        // Delete the saved session after loading (will be auto-saved again)
        await deleteMergeSession(sessionId);

        this.openedFromTreeManager = fromTreeManager;
        this.resumeMerge(state, session.incomingFileName, session.targetTreeName, session.sourceTreeName);
        return true;
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
        // Check if tree preview/compare is open - let it handle its own ESC
        const previewOverlay = document.querySelector('.tree-preview-overlay');
        const compareOverlay = document.querySelector('.tree-compare-overlay');
        if (previewOverlay || compareOverlay) {
            // Preview has its own ESC handler, don't interfere
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
        void clearCurrentMerge();
        this.closeMergeModalInternal();
    }

    /**
     * Handle close confirmation: save for later
     */
    handleCloseSave(): void {
        if (this.mergeState) {
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
        if (this.mergeState) {
            // Generate display name from tree names
            const displayName = this.targetTreeName && this.sourceTreeName
                ? `${this.targetTreeName} + ${this.sourceTreeName}`
                : this.incomingFileName || 'Merge';
            void saveMergeSession(this.mergeState, displayName, this.targetTreeName, this.sourceTreeName);
            UI.showToast(strings.merge.closeSave);
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
        if (this.mergeState) {
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

        this.renderModalContent();
        modal.classList.add('active');
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

        // Return to tree manager if it was opened from there
        if (shouldReturnToTreeManager) {
            UI.showTreeManagerDialog();
        }
    }

    /**
     * Render modal content based on current state
     */
    private renderModalContent(): void {
        if (!this.mergeState) return;

        const stats = calculateMergeStats(this.mergeState);

        // Update wizard header
        this.updateWizardHeader(stats);

        // Update stats display
        this.updateStatsDisplay(stats);

        // Update filter tabs
        this.updateFilterTabs(stats);

        // Render match list
        this.renderMatchList();
    }

    /**
     * Update wizard header and progress steps
     */
    private updateWizardHeader(stats: MergeStats): void {
        // Update explanation text
        const explanation = document.getElementById('merge-wizard-explanation');
        if (explanation) {
            explanation.textContent = strings.merge.wizardExplanation;
        }

        // Calculate progress
        const totalItems = stats.total;
        const reviewedItems = this.mergeState?.decisions.size || 0;
        const itemsWithConflicts = stats.withConflicts;
        const resolvedConflicts = this.mergeState?.conflictResolutions.size || 0;

        // Update step indicators
        const step1 = document.getElementById('merge-step-review');
        const step2 = document.getElementById('merge-step-resolve');
        const step3 = document.getElementById('merge-step-execute');

        if (step1) {
            const isComplete = reviewedItems >= totalItems * 0.5; // At least 50% reviewed
            step1.classList.toggle('complete', isComplete);
            step1.classList.toggle('active', !isComplete);
        }

        if (step2) {
            const hasConflicts = itemsWithConflicts > 0;
            const allResolved = resolvedConflicts >= itemsWithConflicts;
            step2.classList.toggle('complete', hasConflicts && allResolved);
            step2.classList.toggle('active', hasConflicts && !allResolved);
            step2.style.display = hasConflicts ? '' : 'none';
        }

        if (step3) {
            step3.classList.add('active');
        }
    }

    /**
     * Update stats display
     */
    private updateStatsDisplay(stats: MergeStats): void {
        const importCount = document.getElementById('merge-stat-import');
        const existingCount = document.getElementById('merge-stat-existing');
        const matchCount = document.getElementById('merge-stat-matches');
        const conflictCount = document.getElementById('merge-stat-conflicts');
        const newCount = document.getElementById('merge-stat-new');

        if (importCount) importCount.textContent = String(stats.total);
        if (existingCount) existingCount.textContent = String(Object.keys(this.mergeState!.existingData.persons).length);
        if (matchCount) matchCount.textContent = String(stats.matched);
        if (conflictCount) conflictCount.textContent = String(stats.withConflicts);
        if (newCount) newCount.textContent = String(stats.unmatched);
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
                case 'conflicts': count = stats.withConflicts; break;
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
        document.querySelectorAll('.merge-tab').forEach(tab => {
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

        if (items.length === 0) {
            listContainer.innerHTML = `<div class="merge-empty">${strings.merge.noItems}</div>`;
            return;
        }

        listContainer.innerHTML = items.map((item, index) => this.renderMatchItem(item, index)).join('');

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

        // Determine status: confirmed, rejected, or pending (needs review)
        // Score >= 50 is pre-confirmed, score < 50 requires explicit user action
        const isConfirmed = decision?.type === 'confirm' || (!decision && match.score >= 50);
        const isRejected = decision?.type === 'reject';
        const isPending = !decision && match.score < 50; // Needs user review

        const confidenceClass = match.confidence;
        const confidenceLabel = strings.merge[`${match.confidence}Confidence`] || match.confidence;
        const confidenceTooltip = this.getConfidenceTooltip(match.confidence);

        // Format person info
        const existingInfo = this.formatPersonInfo(match.existingPerson);
        const incomingInfo = this.formatPersonInfo(match.incomingPerson);

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
        const conflictIndicator = hasConflicts ? `<span class="conflict-indicator" title="${match.conflicts.length} conflicts">⚠</span>` : '';

        // Resolve conflicts button
        const resolveBtn = hasConflicts
            ? `<button class="merge-btn-resolve" data-action="resolve">${strings.merge.resolveConflicts}</button>`
            : '';

        return `
            <div class="merge-item ${isConfirmed ? 'confirmed' : ''} ${isRejected ? 'rejected' : ''} ${isPending ? 'pending' : ''}"
                 data-index="${index}" data-incoming-id="${match.incomingId}">
                <div class="merge-item-header">
                    <span class="merge-item-status ${isConfirmed ? 'confirmed' : isRejected ? 'rejected' : 'pending'}">
                        ${isConfirmed ? '✓' : isRejected ? '✗' : '?'}
                    </span>
                    <span class="merge-item-names">
                        ${this.escapeHtml(existingInfo)} ↔ ${this.escapeHtml(incomingInfo)}
                    </span>
                    ${conflictIndicator}
                    <span class="merge-item-score confidence-${confidenceClass}" title="${confidenceTooltip}">
                        [${match.score}%] ${confidenceLabel}
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
                    <button class="merge-btn-change" data-action="change">
                        ${strings.merge.changeMatch}
                    </button>
                    ${resolveBtn}
                    <button class="merge-btn-preview" data-action="compare" title="${strings.treePreview.comparePersons}">
                        👁
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render unmatched item
     */
    private renderUnmatchedItem(person: Person, personId: PersonId, index: number): string {
        const info = this.formatPersonInfo(person);

        return `
            <div class="merge-item unmatched" data-index="${index}" data-incoming-id="${personId}">
                <div class="merge-item-header">
                    <span class="merge-item-status new">+</span>
                    <span class="merge-item-names">
                        ${this.escapeHtml(info)}
                    </span>
                    <span class="merge-item-badge new" title="${strings.merge.newPersonTooltip}">${strings.merge.newPerson}</span>
                </div>
                <div class="merge-item-actions">
                    <button class="merge-btn-change" data-action="manual">
                        ${strings.merge.manualMatch}
                    </button>
                    <button class="merge-btn-preview" data-action="preview" title="${strings.treePreview.preview}">
                        👁
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
        const name = `${person.firstName} ${person.lastName}`.trim();
        const year = person.birthDate?.split('-')[0] || '';
        return year ? `${name} (*${year})` : name;
    }

    /**
     * Attach event listeners to match list
     */
    private attachMatchListeners(): void {
        const listContainer = document.getElementById('merge-match-list');
        if (!listContainer) return;

        // Action buttons
        listContainer.querySelectorAll('.merge-btn-confirm, .merge-btn-reject, .merge-btn-change, .merge-btn-resolve, .merge-btn-preview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = (e.target as HTMLElement).closest('.merge-item');
                const incomingId = item?.getAttribute('data-incoming-id') as PersonId;
                const action = (e.target as HTMLElement).dataset.action;

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
            UI.showAlert(strings.merge.selectExistingError, 'warning');
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

        content.innerHTML = match.conflicts.map(conflict => `
            <div class="conflict-row" data-field="${conflict.field}">
                <div class="conflict-label">
                    ${strings.labels[conflict.field as keyof typeof strings.labels] || conflict.field}
                </div>
                <div class="conflict-options">
                    <label class="conflict-option">
                        <input type="radio" name="conflict-${conflict.field}" value="keep_existing"
                            ${conflict.resolution === 'keep_existing' ? 'checked' : ''}>
                        <span class="conflict-value existing">${this.escapeHtml(conflict.existingValue || '—')}</span>
                        <span class="conflict-badge">${strings.merge.keepExisting}</span>
                    </label>
                    <label class="conflict-option">
                        <input type="radio" name="conflict-${conflict.field}" value="use_incoming"
                            ${conflict.resolution === 'use_incoming' ? 'checked' : ''}>
                        <span class="conflict-value incoming">${this.escapeHtml(conflict.incomingValue || '—')}</span>
                        <span class="conflict-badge">${strings.merge.useImport}</span>
                    </label>
                </div>
            </div>
        `).join('');

        dialog.setAttribute('data-incoming-id', incomingId);
        dialog.classList.add('active');
    }

    /**
     * Save conflict resolutions
     */
    saveConflictResolutions(): void {
        if (!this.mergeState) return;

        const dialog = document.getElementById('merge-conflict-dialog');
        if (!dialog) return;

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
    reanalyze(): void {
        if (!this.mergeState) return;

        reanalyzeMatches(this.mergeState);
        this.renderModalContent();
    }

    /**
     * Execute the merge - prompts for new tree name and creates a new tree
     */
    async executeMerge(): Promise<void> {
        if (!this.mergeState) return;

        // Generate default name for new tree
        const defaultName = this.targetTreeName && this.sourceTreeName
            ? `${this.targetTreeName} + ${this.sourceTreeName}`
            : this.targetTreeName
                ? `${this.targetTreeName} (merged)`
                : strings.treeManager.newTree;

        // Prompt for new tree name
        const newTreeName = await UI.showPrompt(
            strings.merge.newTreeNamePrompt,
            defaultName
        );

        if (!newTreeName) {
            // User cancelled
            return;
        }

        this.mergeState.phase = 'executing';

        const result = await executeMerge(this.mergeState);

        if (result.success) {
            // Create new tree with merged data
            const newTreeId = TreeManager.createTree(newTreeName);
            TreeManager.saveTreeData(newTreeId, result.mergedData);

            // Audit log - record merge summary in the new tree
            const sourceName = this.sourceTreeName || this.incomingFileName || '?';
            AuditLogManager.log(
                newTreeId, 'data.import',
                strings.auditLog.treeMerge(result.stats.merged, result.stats.added, sourceName)
            );

            // Clean up backup after success
            if (result.backupKey) {
                await deleteBackup(result.backupKey);
            }

            // Mark as no unsaved changes to prevent close confirmation
            this.hasUnsavedChanges = false;

            // Close merge modal first
            const modal = document.getElementById('merge-modal');
            modal?.classList.remove('active');
            this.removeEscapeHandler();
            this.clearAutoSave();
            void clearCurrentMerge();

            // Reset state
            this.mergeState = null;
            this.selectedMatchIndex = -1;
            this.incomingFileName = undefined;
            this.targetTreeName = undefined;
            this.sourceTreeName = undefined;
            this.openedFromTreeManager = false;

            // Show success message and offer to switch to new tree
            const stats = strings.merge.stats(result.stats.merged, result.stats.added);

            // Dispatch event to update tree list
            window.dispatchEvent(new CustomEvent('strom:merge-session-changed'));

            // Show tree manager with new tree visible
            UI.showTreeManagerDialog();

            // Push tree manager to dialog stack so ESC returns to it
            UI.pushDialog('tree-manager-modal');

            // Show confirmation dialog to switch to new tree
            const shouldSwitch = await UI.showConfirm(
                `${strings.merge.complete}\n${stats}\n\n${strings.merge.switchToNewTree}`,
                strings.merge.complete
            );

            if (shouldSwitch) {
                // Switch to new tree and close tree manager
                await DataManager.switchTree(newTreeId);
                UI.updateTreeSwitcher();
                TreeRenderer.restoreFromSession();
                TreeRenderer.render();
                UI.refreshSearch();
                // Center view on focused person
                setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
                window.dispatchEvent(new CustomEvent('strom:tree-switched'));
                UI.closeTreeManagerDialog();
            }
            // If user cancels (ESC), stay in tree manager
        } else {
            UI.showAlert(strings.merge.failed + '\n' + (result.errors?.join('\n') || ''), 'error');
        }
    }

    // ==================== HELPERS ====================

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

export const MergerUI = new MergerUIClass();
