/**
 * merge ui UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
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
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';

export const mergeUiMethods = uiModule({
    // ---- PENDING MERGES ----
    /**
     * Check for pending merges and show dialog if found
     */
    async checkPendingMerges(): Promise<void> {
        const currentMerge = await getCurrentMergeInfo();
        const savedSessions = await listMergeSessionsInfo();

        if (!currentMerge && savedSessions.length === 0) {
            return;
        }

        this.showPendingMergeDialog();
    },

    /**
     * Show pending merge dialog
     */
    async showPendingMergeDialog(): Promise<void> {
        const modal = document.getElementById('pending-merge-modal');
        const list = document.getElementById('pending-merge-list');
        if (!modal || !list) return;

        const currentMerge = await getCurrentMergeInfo();
        const savedSessions = await listMergeSessionsInfo();

        let html = '';

        // Current auto-saved merge
        if (currentMerge) {
            const date = new Date(currentMerge.savedAt).toLocaleString();
            const progress = strings.merge.reviewedCount(currentMerge.stats.reviewed, currentMerge.stats.total);
            html += `
                <div class="pending-merge-item" data-session-id="current">
                    <div class="pending-merge-info">
                        <div class="pending-merge-name">${this.escapeHtml(currentMerge.incomingFileName || 'Auto-saved merge')}</div>
                        <div class="pending-merge-meta">${date} • ${progress}</div>
                    </div>
                    <div class="pending-merge-actions">
                        <button class="btn-resume" onclick="window.Strom.UI.resumePendingMerge('current')">${strings.merge.resume}</button>
                        <button class="btn-discard" onclick="window.Strom.UI.discardPendingMerge('current')">${strings.merge.discard}</button>
                    </div>
                </div>
            `;
        }

        // Saved sessions
        for (const session of savedSessions) {
            const date = new Date(session.savedAt).toLocaleString();
            const progress = strings.merge.reviewedCount(session.stats.reviewed, session.stats.total);
            html += `
                <div class="pending-merge-item" data-session-id="${session.id}">
                    <div class="pending-merge-info">
                        <div class="pending-merge-name">${this.escapeHtml(session.incomingFileName || 'Saved merge')}</div>
                        <div class="pending-merge-meta">${date} • ${progress}</div>
                    </div>
                    <div class="pending-merge-actions">
                        <button class="btn-resume" onclick="window.Strom.UI.resumePendingMerge('${session.id}')">${strings.merge.resume}</button>
                        <button class="btn-discard" onclick="window.Strom.UI.discardPendingMerge('${session.id}')">${strings.merge.discard}</button>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html;
        modal.classList.add('active');
    },

    /**
     * Close pending merge dialog
     */
    closePendingMergeDialog(): void {
        document.getElementById('pending-merge-modal')?.classList.remove('active');
    },

    /**
     * Resume a pending merge
     */
    resumePendingMerge(sessionId: string): void {
        this.closePendingMergeDialog();

        if (sessionId === 'current') {
            MergerUI.resumeCurrentMerge();
        } else {
            MergerUI.resumeSavedMerge(sessionId);
        }
    },

    /**
     * Discard a pending merge
     */
    async discardPendingMerge(sessionId: string): Promise<void> {
        if (sessionId === 'current') {
            MergerUI.discardCurrentMerge();
        } else {
            MergerUI.discardSavedMerge(sessionId);
        }

        // Refresh the list
        const currentMerge = await getCurrentMergeInfo();
        const savedSessions = await listMergeSessionsInfo();

        if (!currentMerge && savedSessions.length === 0) {
            this.closePendingMergeDialog();
        } else {
            this.showPendingMergeDialog();
        }
    },

    /**
     * Resume pending merge from tree manager
     */
    resumePendingMergeFromManager(sessionId: string): void {
        this.closeTreeManagerDialog();
        MergerUI.resumeSavedMerge(sessionId, true); // true = opened from tree manager
    },

    /**
     * Discard pending merge from tree manager
     */
    async discardPendingMergeFromManager(sessionId: string, displayName: string): Promise<void> {
        this.pushDialog('tree-manager-modal');
        const confirmed = await this.showConfirm(`${strings.merge.discard} "${displayName}"?`);
        if (!confirmed) return;

        deleteMergeSession(sessionId);
        this.updateTreeManagerList();
    },

    /**
     * Rename pending merge from tree manager
     */
    async renamePendingMergeFromManager(sessionId: string, currentName: string): Promise<void> {
        this.pushDialog('tree-manager-modal');
        const newName = await this.showPrompt(strings.treeManager.rename, currentName);
        if (!newName) return;

        renameMergeSession(sessionId, newName);
        this.updateTreeManagerList();
    },

    // ---- PERSON MERGE (DUPLICATE RESOLUTION) ----
    /**
     * Show person merge dialog
     */
    showPersonMergeDialog(keepId: PersonId): void {
        const person = DataManager.getPerson(keepId);
        if (!person) return;

        this.personMergeKeepId = keepId;
        this.personMergeOtherId = null;
        this.personMergeFieldResolutions.clear();
        this.personMergePartnershipResolutions.clear();

        const modal = document.getElementById('person-merge-modal');
        const keepDisplay = document.getElementById('person-merge-keep');
        const previewSection = document.getElementById('person-merge-preview');
        const conflictsSection = document.getElementById('person-merge-conflicts');
        const partnershipSection = document.getElementById('person-merge-partnership-conflicts');
        const noConflictsSection = document.getElementById('person-merge-no-conflicts');
        const mergeBtn = document.getElementById('person-merge-btn') as HTMLButtonElement;

        if (!modal || !keepDisplay) return;

        // Show keep person info
        const birthYear = person.birthDate?.split('-')[0] || '';
        const name = `${person.firstName} ${person.lastName}`.trim();
        keepDisplay.textContent = birthYear ? `${name} (*${birthYear})` : name;

        // Hide sections initially
        if (previewSection) previewSection.style.display = 'none';
        if (conflictsSection) conflictsSection.style.display = 'none';
        if (partnershipSection) partnershipSection.style.display = 'none';
        if (noConflictsSection) noConflictsSection.style.display = 'none';
        if (mergeBtn) mergeBtn.disabled = true;

        // Destroy existing picker
        if (this.personMergePicker) {
            this.personMergePicker.destroy();
            this.personMergePicker = null;
        }

        // Get persons to choose from (exclude the keep person and placeholders)
        const allPersons = Object.values(DataManager.getData().persons)
            .filter(p => p.id !== keepId && !p.isPlaceholder);

        // Initialize PersonPicker
        this.personMergePicker = new PersonPicker({
            containerId: 'person-merge-picker',
            onSelect: (selectedId) => {
                if (selectedId) {
                    this.updatePersonMergePreview(selectedId);
                }
            },
            placeholder: strings.personMerge.selectPerson,
            persons: allPersons
        });

        modal.classList.add('active');
    },

    /**
     * Update merge preview when a person is selected
     */
    updatePersonMergePreview(otherId: PersonId): void {
        if (!this.personMergeKeepId) return;

        const keepPerson = DataManager.getPerson(this.personMergeKeepId);
        const otherPerson = DataManager.getPerson(otherId);
        if (!keepPerson || !otherPerson) return;

        this.personMergeOtherId = otherId;
        this.personMergeFieldResolutions.clear();
        this.personMergePartnershipResolutions.clear();

        const previewSection = document.getElementById('person-merge-preview');
        const otherDisplay = document.getElementById('person-merge-other');
        const deleteInfo = document.getElementById('person-merge-delete-info');
        const conflictsSection = document.getElementById('person-merge-conflicts');
        const fieldConflictsList = document.getElementById('person-merge-field-conflicts');
        const partnershipSection = document.getElementById('person-merge-partnership-conflicts');
        const partnershipList = document.getElementById('person-merge-partnership-list');
        const noConflictsSection = document.getElementById('person-merge-no-conflicts');
        const mergeBtn = document.getElementById('person-merge-btn') as HTMLButtonElement;

        // Show other person info
        if (otherDisplay) {
            const birthYear = otherPerson.birthDate?.split('-')[0] || '';
            const name = `${otherPerson.firstName} ${otherPerson.lastName}`.trim();
            otherDisplay.textContent = birthYear ? `${name} (*${birthYear})` : name;
        }

        // Show delete warning
        if (deleteInfo) {
            const name = `${otherPerson.firstName} ${otherPerson.lastName}`.trim();
            deleteInfo.textContent = `"${name}" ${strings.personMerge.willBeDeleted}. ${strings.personMerge.relationshipsTransferred}.`;
        }

        if (previewSection) previewSection.style.display = 'block';

        // Detect field conflicts
        const fieldConflicts = this.detectFieldConflicts(keepPerson, otherPerson);

        if (fieldConflicts.length > 0 && conflictsSection && fieldConflictsList) {
            fieldConflictsList.innerHTML = fieldConflicts.map(conflict => `
                <div class="person-merge-conflict-row" data-field="${conflict.field}">
                    <div class="person-merge-conflict-label">
                        ${strings.labels[conflict.field as keyof typeof strings.labels] || conflict.field}
                    </div>
                    <div class="person-merge-conflict-options">
                        <label class="person-merge-conflict-option selected" data-value="keep">
                            <input type="radio" name="conflict-${conflict.field}" value="keep" checked>
                            <span class="person-merge-conflict-value">${this.escapeHtml(conflict.keepValue || '—')}</span>
                            <span class="person-merge-conflict-badge">${strings.personMerge.keepValue}</span>
                        </label>
                        <label class="person-merge-conflict-option" data-value="other">
                            <input type="radio" name="conflict-${conflict.field}" value="other">
                            <span class="person-merge-conflict-value">${this.escapeHtml(conflict.otherValue || '—')}</span>
                            <span class="person-merge-conflict-badge">${strings.personMerge.useOther}</span>
                        </label>
                    </div>
                </div>
            `).join('');

            // Add event listeners for conflict resolution
            fieldConflictsList.querySelectorAll('input[type="radio"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    const row = target.closest('.person-merge-conflict-row');
                    const field = row?.getAttribute('data-field');
                    if (field) {
                        this.personMergeFieldResolutions.set(field, target.value as 'keep' | 'other');
                        // Update selected styling
                        row?.querySelectorAll('.person-merge-conflict-option').forEach(opt => {
                            opt.classList.toggle('selected', opt.getAttribute('data-value') === target.value);
                        });
                    }
                });
            });

            // Set default resolutions
            fieldConflicts.forEach(c => this.personMergeFieldResolutions.set(c.field, 'keep'));

            conflictsSection.style.display = 'block';
        } else if (conflictsSection) {
            conflictsSection.style.display = 'none';
        }

        // Detect partnership conflicts (both have partnership with same person)
        const partnershipConflicts = this.detectPartnershipConflicts(keepPerson, otherPerson);

        if (partnershipConflicts.length > 0 && partnershipSection && partnershipList) {
            partnershipList.innerHTML = partnershipConflicts.map(conflict => {
                const partnerName = `${conflict.partner.firstName} ${conflict.partner.lastName}`.trim();
                return `
                    <div class="person-merge-conflict-row" data-partnership="${conflict.keepPartnership.id}">
                        <div class="person-merge-conflict-label">
                            ${strings.labels.partner}: ${this.escapeHtml(partnerName)}
                        </div>
                        <div class="person-merge-conflict-options">
                            <label class="person-merge-conflict-option selected" data-value="merge">
                                <input type="radio" name="partnership-${conflict.keepPartnership.id}" value="merge" checked>
                                <span class="person-merge-conflict-value">${strings.personMerge.mergePartnership}</span>
                            </label>
                            <label class="person-merge-conflict-option" data-value="keep_both">
                                <input type="radio" name="partnership-${conflict.keepPartnership.id}" value="keep_both">
                                <span class="person-merge-conflict-value">${strings.personMerge.keepBoth}</span>
                            </label>
                        </div>
                    </div>
                `;
            }).join('');

            // Add event listeners
            partnershipList.querySelectorAll('input[type="radio"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    const target = e.target as HTMLInputElement;
                    const row = target.closest('.person-merge-conflict-row');
                    const partnershipId = row?.getAttribute('data-partnership') as PartnershipId;
                    if (partnershipId) {
                        this.personMergePartnershipResolutions.set(partnershipId, target.value as 'merge' | 'keep_both');
                        row?.querySelectorAll('.person-merge-conflict-option').forEach(opt => {
                            opt.classList.toggle('selected', opt.getAttribute('data-value') === target.value);
                        });
                    }
                });
            });

            // Set default resolutions
            partnershipConflicts.forEach(c => this.personMergePartnershipResolutions.set(c.keepPartnership.id, 'merge'));

            partnershipSection.style.display = 'block';
        } else if (partnershipSection) {
            partnershipSection.style.display = 'none';
        }

        // Show no conflicts message if applicable
        if (noConflictsSection) {
            noConflictsSection.style.display = fieldConflicts.length === 0 && partnershipConflicts.length === 0 ? 'block' : 'none';
        }

        // Enable merge button
        if (mergeBtn) mergeBtn.disabled = false;
    },

    /**
     * Detect field conflicts between two persons
     */
    detectFieldConflicts(keep: Person, other: Person): Array<{ field: string; keepValue: string; otherValue: string }> {
        const conflicts: Array<{ field: string; keepValue: string; otherValue: string }> = [];

        // Check each field for conflicts
        const checkField = (field: keyof Person, keepVal: string | undefined, otherVal: string | undefined) => {
            if (keepVal && otherVal && keepVal !== otherVal) {
                conflicts.push({ field: field as string, keepValue: keepVal, otherValue: otherVal });
            }
        };

        checkField('firstName', keep.firstName, other.firstName);
        checkField('lastName', keep.lastName, other.lastName);
        checkField('birthDate', keep.birthDate, other.birthDate);
        checkField('birthPlace', keep.birthPlace, other.birthPlace);
        checkField('deathDate', keep.deathDate, other.deathDate);
        checkField('deathPlace', keep.deathPlace, other.deathPlace);

        return conflicts;
    },

    /**
     * Detect partnership conflicts (both persons have partnership with same person)
     */
    detectPartnershipConflicts(keepPerson: { id: PersonId; partnerships: PartnershipId[] }, otherPerson: { id: PersonId; partnerships: PartnershipId[] }): Array<{
        partner: { firstName: string; lastName: string };
        keepPartnership: { id: PartnershipId };
        otherPartnership: { id: PartnershipId };
    }> {
        const conflicts: Array<{
            partner: { firstName: string; lastName: string };
            keepPartnership: { id: PartnershipId };
            otherPartnership: { id: PartnershipId };
        }> = [];

        // Get partners of keep person
        const keepPartners = new Map<PersonId, PartnershipId>();
        for (const pId of keepPerson.partnerships) {
            const partnership = DataManager.getPartnership(pId);
            if (partnership) {
                const partnerId = partnership.person1Id === keepPerson.id ? partnership.person2Id : partnership.person1Id;
                keepPartners.set(partnerId, pId);
            }
        }

        // Check if other person has same partners
        for (const pId of otherPerson.partnerships) {
            const partnership = DataManager.getPartnership(pId);
            if (partnership) {
                const partnerId = partnership.person1Id === otherPerson.id ? partnership.person2Id : partnership.person1Id;
                if (keepPartners.has(partnerId)) {
                    const partner = DataManager.getPerson(partnerId);
                    if (partner) {
                        conflicts.push({
                            partner: { firstName: partner.firstName, lastName: partner.lastName },
                            keepPartnership: { id: keepPartners.get(partnerId)! },
                            otherPartnership: { id: pId }
                        });
                    }
                }
            }
        }

        return conflicts;
    },

    /**
     * Close person merge dialog
     */
    closePersonMergeDialog(): void {
        const modal = document.getElementById('person-merge-modal');
        modal?.classList.remove('active');

        if (this.personMergePicker) {
            this.personMergePicker.destroy();
            this.personMergePicker = null;
        }

        this.personMergeKeepId = null;
        this.personMergeOtherId = null;
        this.personMergeFieldResolutions.clear();
        this.personMergePartnershipResolutions.clear();

        // Return to parent dialog (person-modal)
        const mergeIdx = this.dialogStack.indexOf('person-merge-modal');
        if (mergeIdx !== -1) {
            this.dialogStack.splice(mergeIdx, 1);
        }
        if (this.dialogStack.length > 0) {
            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
            this.dialogStack.pop();
            this.openDialogById(parentDialog);
        }
    },

    /**
     * Preview persons in person merge dialog - shows single or comparison based on selection
     */
    previewPersonMerge(): void {
        if (!this.personMergeKeepId) return;

        const keepPerson = DataManager.getPerson(this.personMergeKeepId);
        if (!keepPerson) return;

        const data = DataManager.getData();
        const formatPerson = (p: Person) => {
            const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const year = p.birthDate?.split('-')[0];
            return year ? `${name} (*${year})` : name;
        };

        if (this.personMergeOtherId) {
            // Both selected - show comparison
            const otherPerson = DataManager.getPerson(this.personMergeOtherId);
            if (!otherPerson) return;

            TreeCompare.showComparison({
                left: {
                    data,
                    focusPersonId: this.personMergeKeepId,
                    depthUp: 2,
                    depthDown: 2,
                    title: strings.personMerge.keepPerson,
                    subtitle: formatPerson(keepPerson)
                },
                right: {
                    data,
                    focusPersonId: this.personMergeOtherId,
                    depthUp: 2,
                    depthDown: 2,
                    title: strings.personMerge.mergeWith,
                    subtitle: formatPerson(otherPerson)
                }
            });
        } else {
            // Only keep person - show single preview
            TreePreview.show({
                data,
                focusPersonId: this.personMergeKeepId,
                depthUp: 2,
                depthDown: 2,
                title: strings.personMerge.keepPerson,
                subtitle: formatPerson(keepPerson)
            });
        }
    },

    /**
     * Execute person merge
     */
    executePersonMerge(): void {
        if (!this.personMergeKeepId || !this.personMergeOtherId) return;

        // Build resolved field values
        const resolvedFields: { [key: string]: string | undefined } = {};
        for (const [field, resolution] of this.personMergeFieldResolutions) {
            if (resolution === 'other') {
                const otherPerson = DataManager.getPerson(this.personMergeOtherId);
                if (otherPerson) {
                    resolvedFields[field] = (otherPerson as unknown as { [key: string]: string | undefined })[field];
                }
            }
        }

        // Execute merge in DataManager
        const success = DataManager.mergePersons(
            this.personMergeKeepId,
            this.personMergeOtherId,
            resolvedFields,
            this.personMergePartnershipResolutions
        );

        if (success) {
            this.showToast(strings.personMerge.mergeComplete);
            this.closePersonMergeDialog();
            // The merge was started from the person edit modal — close it
            // too, its form still shows the pre-merge state
            this.closeModal();
            TreeRenderer.render();
        } else {
            this.showAlert('Merge failed', 'error');
        }
    },

    // ---- MERGE TREES DIALOG ----
    /**
     * Show merge trees dialog
     */
    showMergeTreesDialog(sourceTreeId: string, parentDialogId?: string): void {
        const modal = document.getElementById('merge-trees-modal');
        const description = document.getElementById('merge-trees-description');
        const options = document.getElementById('merge-trees-options');
        if (!modal || !description || !options) return;

        this.mergeSourceTreeId = sourceTreeId as TreeId;
        this.mergeTargetTreeId = null;

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('merge-trees-modal');

        const sourceTree = TreeManager.getTreeMetadata(this.mergeSourceTreeId);
        if (!sourceTree) return;

        description.innerHTML = `${strings.treeManager.mergeSourceTree} <strong>${this.escapeHtml(sourceTree.name)}</strong> ${strings.treeManager.mergeIntoTree}:`;

        // Build target options (all trees except source)
        const trees = TreeManager.getTrees().filter(t => t.id !== sourceTreeId);
        let html = '';
        for (const tree of trees) {
            html += `
                <div class="merge-trees-option" onclick="window.Strom.UI.selectMergeTarget('${tree.id}')">
                    <input type="radio" name="merge-target" value="${tree.id}">
                    <div class="merge-trees-option-info">
                        <div class="merge-trees-option-name">${this.escapeHtml(tree.name)}</div>
                        <div class="merge-trees-option-stats">${tree.personCount} ${strings.treeManager.persons}</div>
                    </div>
                </div>
            `;
        }

        if (trees.length === 0) {
            html = `<p style="text-align:center;color:var(--text-light);">${strings.merge.noItems}</p>`;
        }

        options.innerHTML = html;
        modal.classList.add('active');
    },

    /**
     * Select merge target tree
     */
    selectMergeTarget(targetId: string): void {
        this.mergeTargetTreeId = targetId as TreeId;

        // Update UI
        document.querySelectorAll('.merge-trees-option').forEach(opt => {
            opt.classList.remove('selected');
            const radio = opt.querySelector('input[type="radio"]') as HTMLInputElement;
            if (radio) radio.checked = false;
        });

        const selected = document.querySelector(`.merge-trees-option input[value="${targetId}"]`)?.closest('.merge-trees-option');
        if (selected) {
            selected.classList.add('selected');
            const radio = selected.querySelector('input[type="radio"]') as HTMLInputElement;
            if (radio) radio.checked = true;
        }
    },

    /**
     * Close merge trees dialog
     */
    closeMergeTreesDialog(): void {
        document.getElementById('merge-trees-modal')?.classList.remove('active');
        this.mergeSourceTreeId = null;
        this.mergeTargetTreeId = null;
        this.returnToParentDialog();
    },

    /**
     * Start tree merge process
     */
    async startTreeMerge(): Promise<void> {
        if (!this.mergeSourceTreeId || !this.mergeTargetTreeId) {
            this.clearDialogStack();
            this.pushDialog('merge-trees-modal');
            this.showAlert(strings.treeManager.selectTargetTree, 'warning');
            return;
        }

        const sourceData = await TreeManager.getTreeData(this.mergeSourceTreeId);
        if (!sourceData) return;

        // Switch to target tree first
        await DataManager.switchTree(this.mergeTargetTreeId);
        // Update URL to reflect target tree
        this.updateUrlTreeParam(this.mergeTargetTreeId);

        // Back up the target tree before merging into it.
        await DataManager.snapshotNow('pre-merge');

        // Start merge with source data (fromTreeManager = true)
        MergerUI.startMerge(sourceData, this.mergeSourceTreeId, true);

        this.closeMergeTreesDialog();
        this.closeTreeManagerDialog();
    },
});
