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
    LastFocusedMarker
} from '../types.js';
import { LAST_FOCUSED } from '../model-values.js';
import { strings } from '../strings.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from '../ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    getCurrentMerge,
    loadMergeSession,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from '../merge/index.js';
import { PersonPicker } from '../person-picker.js';
import { extractSubtree } from '../subtree.js';
import { AppExporter } from '../export.js';
import { SettingsManager } from '../settings.js';
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { targetBlock } from '../merge/wizard-ui.js';
import { treeEditCount } from '../merge/resume-change.js';
import { contentFingerprint } from '../research-link.js';
import type { MergeState } from '../merge/types.js';
import { shownNameOrEmpty, fitNameHtml } from '../person-name.js';
import { personMergeShares, type PersonMergeShareRow } from '../shared-events.js';
import { lifeEventLabel } from '../person-sources.js';
import { formatFlexDate } from '../dates.js';
import { sharedEventMarkSvg } from '../icons.js';

export const mergeUiMethods = uiModule({
    // ---- PENDING MERGES ----
    /**
     * Check for pending merges and show dialog if found
     */
    async checkPendingMerges(): Promise<void> {
        // Only a merge the wizard auto-saved and never closed (a reload or a
        // crash mid-review) is offered at startup; sessions saved on purpose
        // ("Save for later") wait in the tree manager.
        if (!await getCurrentMergeInfo()) return;
        void this.showPendingMergeDialog({ atStart: true });
    },

    /**
     * Show pending merge dialog. At start (`atStart`) a merge left open is
     * one that did not finish (13g): the line above says so and that its
     * tree and the file are unchanged.
     */
    async showPendingMergeDialog(opts: { atStart?: boolean } = {}): Promise<void> {
        const modal = document.getElementById('pending-merge-modal');
        const list = document.getElementById('pending-merge-list');
        if (!modal || !list) return;

        const currentMerge = await getCurrentMergeInfo();
        const savedSessions = await listMergeSessionsInfo();
        const current = currentMerge ? await getCurrentMerge() : null;

        const message = modal.querySelector<HTMLElement>('.pending-merge-message');
        if (message) {
            const choices = current?.wizard?.choices;
            const targetName = choices && choices.mode !== 'new'
                ? choices.targetName || (current?.target ? TreeManager.getTreeMetadata(current.target.treeId)?.name ?? '' : '')
                : '';
            const crashed = !!(opts.atStart && currentMerge && targetName);
            message.textContent = crashed ? strings.mergeWizard.crashed(targetName) : strings.merge.pendingMergeFound;
        }

        let html = '';

        // Current auto-saved merge
        if (currentMerge) {
            const date = new Date(currentMerge.savedAt).toLocaleString();
            const { meta, changed } = await this.pendingMergeLines(current, currentMerge.stats);
            html += `
                <div class="pending-merge-item" data-session-id="current">
                    <div class="pending-merge-info">
                        <div class="pending-merge-name">${this.escapeHtml(currentMerge.incomingFileName || strings.merge.pendingMergeLabel)}</div>
                        <div class="pending-merge-meta">${this.escapeHtml([date, ...meta].join(' • '))}</div>${changed}
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
            const { meta, changed } = await this.pendingMergeLines(await loadMergeSession(session.id), session.stats);
            html += `
                <div class="pending-merge-item" data-session-id="${session.id}">
                    <div class="pending-merge-info">
                        <div class="pending-merge-name">${this.escapeHtml(session.incomingFileName || strings.merge.pendingMergeLabel)}</div>
                        <div class="pending-merge-meta">${this.escapeHtml([date, ...meta].join(' • '))}</div>${changed}
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
     * A saved merge's lines in the offer to go on (spec 134 §2, 13c): the
     * guide's step and the decisions made, and when its target changed since
     * the matching, by how many edits (the merge goes on and finds the
     * suggestions again; nothing is decided here).
     */
    async pendingMergeLines(state: MergeState | null, stats: { reviewed: number; total: number }): Promise<{ meta: string[]; changed: string }> {
        const W = strings.mergeWizard;
        const meta: string[] = [];
        const step = state?.wizard?.step;
        if (step) meta.push(W.stepShort(step, W.steps[step - 1] ?? ''));
        meta.push(strings.merge.reviewedCount(stats.reviewed, stats.total));
        const target = state?.target;
        if (!state || !target) return { meta, changed: '' };
        try {
            const current = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === target.treeId
                ? DataManager.getData()
                : TreeManager.getTreeMetadata(target.treeId) ? await TreeManager.getTreeData(target.treeId) : null;
            if (!current || contentFingerprint(current) === target.fingerprint) return { meta, changed: '' };
            const name = TreeManager.getTreeMetadata(target.treeId)?.name ?? '';
            const n = Math.max(1, treeEditCount(state.existingData, current));
            return { meta, changed: `<div class="pending-merge-changed">${this.escapeHtml(W.resumeChanged(name, n))}</div>` };
        } catch {
            return { meta, changed: '' };
        }
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
        const d = strings.danger;
        const confirmed = await this.showConfirm(d.discardMergeMessage, d.discardMergeTitle(displayName),
            { confirmLabel: d.discardMerge, variant: 'danger' });
        if (!confirmed) return;

        deleteMergeSession(sessionId);
        this.updateTreeManagerList();
    },

    /**
     * Rename pending merge from tree manager
     */
    async renamePendingMergeFromManager(sessionId: string, currentName: string): Promise<void> {
        this.pushDialog('tree-manager-modal');
        const newName = await this.showPrompt(strings.treeManager.renameTitle, currentName);
        if (!newName) return;

        renameMergeSession(sessionId, newName);
        this.updateTreeManagerList();
    },

    // ---- PERSON MERGE (DUPLICATE RESOLUTION) ----
    /**
     * Show person merge dialog. `otherId`: the person to merge with already
     * chosen (a possible duplicate the research takes for one person).
     */
    showPersonMergeDialog(keepId: PersonId, otherId?: PersonId): void {
        const person = DataManager.getPerson(keepId);
        if (!person) return;

        this.personMergeKeepId = keepId;
        this.personMergeOtherId = null;
        this.personMergeFieldResolutions.clear();
        this.personMergePartnershipResolutions.clear();
        this.personMergeShareDetach.clear();
        const sharedSection = document.getElementById('person-merge-shared');
        if (sharedSection) sharedSection.hidden = true;

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
        keepDisplay.innerHTML = fitNameHtml(person, shownNameOrEmpty(person), birthYear ? `(*${birthYear})` : '');

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
        if (otherId && allPersons.some(p => p.id === otherId)) {
            this.personMergePicker.setValue(otherId);
            this.updatePersonMergePreview(otherId);
        }

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
        this.personMergeShareDetach.clear();

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
            otherDisplay.innerHTML = fitNameHtml(otherPerson, shownNameOrEmpty(otherPerson), birthYear ? `(*${birthYear})` : '');
        }

        // Show delete warning
        if (deleteInfo) {
            const name = shownNameOrEmpty(otherPerson);
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
                        <label class="person-merge-conflict-option sel-opt selected" data-sel-form="tile" data-value="keep">
                            <input type="radio" name="conflict-${conflict.field}" value="keep" checked>
                            <span class="person-merge-conflict-value">${this.escapeHtml(conflict.keepValue || '—')}</span>
                            <span class="person-merge-conflict-badge">${strings.personMerge.keepValue}</span>
                        </label>
                        <label class="person-merge-conflict-option sel-opt" data-sel-form="tile" data-value="other">
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
                const partnerName = shownNameOrEmpty(conflict.partner);
                return `
                    <div class="person-merge-conflict-row" data-partnership="${this.escapeHtml(conflict.keepPartnership.id)}">
                        <div class="person-merge-conflict-label">
                            ${strings.labels.partner}: ${this.escapeHtml(partnerName)}
                        </div>
                        <div class="person-merge-conflict-options">
                            <label class="person-merge-conflict-option sel-opt selected" data-sel-form="tile" data-value="merge">
                                <input type="radio" name="partnership-${this.escapeHtml(conflict.keepPartnership.id)}" value="merge" checked>
                                <span class="person-merge-conflict-value">${strings.personMerge.mergePartnership}</span>
                            </label>
                            <label class="person-merge-conflict-option sel-opt" data-sel-form="tile" data-value="keep_both">
                                <input type="radio" name="partnership-${this.escapeHtml(conflict.keepPartnership.id)}" value="keep_both">
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

        // Shared events: in one once, an own record joining one (spec 085 §7).
        const shareRows = this.renderPersonMergeShares(keepPerson.id, otherPerson.id);

        // Show no conflicts message if applicable
        if (noConflictsSection) {
            const ageChoices = shareRows.filter(r => r.ageDiffers).length;
            noConflictsSection.style.display = fieldConflicts.length === 0 && partnershipConflicts.length === 0 && ageChoices === 0 ? 'block' : 'none';
        }

        // Enable merge button
        if (mergeBtn) mergeBtn.disabled = false;
    },

    /**
     * The person merge's shared events (7a): each with its date and place or
     * age, a note for one both records are in (with the choice of the age
     * when theirs differ) and a checkbox, ticked, for an own record joining
     * one. Returns the rows shown.
     */
    renderPersonMergeShares(keepId: PersonId, otherId: PersonId): PersonMergeShareRow[] {
        const section = document.getElementById('person-merge-shared');
        const list = document.getElementById('person-merge-shared-list');
        const rows = personMergeShares(DataManager.getData(), keepId, otherId);
        if (!section || !list) return rows;
        section.hidden = rows.length === 0;
        const esc = (t: string) => this.escapeHtml(t);
        list.innerHTML = rows.map(row => {
            const ev = row.event;
            const meta = [formatFlexDate(ev.date), row.kind === 'once' ? (ev.age ?? '').trim() : (ev.place ?? '').trim()]
                .filter(Boolean).map(esc).join(' · ');
            const head = `<div class="person-merge-shared-head"><span class="person-merge-shared-title">${esc(lifeEventLabel(ev))}</span>`
                + (meta ? `<span class="person-merge-shared-meta">${meta}</span>` : '') + `</div>`;
            if (row.kind === 'attach') {
                return `<div class="person-merge-shared-row" data-share="${esc(row.shareId)}">${head}`
                    + `<label class="person-merge-shared-check"><input type="checkbox" checked data-share="${esc(row.shareId)}">`
                    + `<span>${esc(strings.merge.sharedAttach(row.persons))}</span></label></div>`;
            }
            const keepAge = (ev.age ?? '').trim();
            const otherAge = (row.other.age ?? '').trim();
            const ages = !row.ageDiffers ? '' : `<div class="person-merge-conflict-options" data-share-age="${esc(row.shareId)}">`
                + `<div class="person-merge-conflict-label">${esc(strings.fields.age)}</div>`
                + `<label class="person-merge-conflict-option sel-opt selected" data-sel-form="tile" data-value="keep"><input type="radio" name="share-age-${esc(row.shareId)}" value="keep" checked>`
                + `<span class="person-merge-conflict-value">${esc(keepAge)}</span><span class="person-merge-conflict-badge">${esc(strings.personMerge.keepValue)}</span></label>`
                + `<label class="person-merge-conflict-option sel-opt" data-sel-form="tile" data-value="other"><input type="radio" name="share-age-${esc(row.shareId)}" value="other">`
                + `<span class="person-merge-conflict-value">${esc(otherAge)}</span><span class="person-merge-conflict-badge">${esc(strings.personMerge.useOther)}</span></label>`
                + `</div>`;
            return `<div class="person-merge-shared-row" data-share="${esc(row.shareId)}">${head}`
                + `<span class="person-merge-shared-note">${sharedEventMarkSvg(16)}<span>${esc(strings.merge.sharedOnce)}</span></span>${ages}</div>`;
        }).join('');
        list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-share]').forEach(box => {
            box.addEventListener('change', () => {
                const id = box.dataset.share!;
                if (box.checked) this.personMergeShareDetach.delete(id);
                else this.personMergeShareDetach.add(id);
            });
        });
        list.querySelectorAll<HTMLElement>('[data-share-age]').forEach(group => {
            const key = `sharedAge:${group.dataset.shareAge}`;
            this.personMergeFieldResolutions.set(key, 'keep');
            group.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    this.personMergeFieldResolutions.set(key, radio.value as 'keep' | 'other');
                    group.querySelectorAll('.person-merge-conflict-option').forEach(opt => {
                        opt.classList.toggle('selected', opt.getAttribute('data-value') === radio.value);
                    });
                });
            });
        });
        return rows;
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
            if (parentDialog === 'tree-validation-modal') {
                // Back to the tree check it was opened from (it stays on the stack), redrawn: the pair may be one person now.
                this.openDialogById(parentDialog);
                const treeId = this.treeValidationOpenFor();
                if (treeId) void this.refreshTreeValidationDialog(treeId);
                return;
            }
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
            const name = shownNameOrEmpty(p);
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
        // The age of a shared event both records are in, as chosen.
        const ages = new Map<string, string>();
        const shareRows = personMergeShares(DataManager.getData(), this.personMergeKeepId, this.personMergeOtherId);
        for (const [field, resolution] of this.personMergeFieldResolutions) {
            if (field.startsWith('sharedAge:')) {
                const row = shareRows.find(r => r.kind === 'once' && `sharedAge:${r.shareId}` === field);
                if (row && resolution === 'other') ages.set(row.shareId, row.other.age ?? '');
                continue;
            }
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
            this.personMergePartnershipResolutions,
            { detach: new Set(this.personMergeShareDetach), ages },
        );

        if (success) {
            this.showToast(strings.personMerge.mergeComplete);
            this.closePersonMergeDialog();
            // The merge was started from the person edit modal — close it
            // too, its form still shows the pre-merge state
            this.closeModal();
            TreeRenderer.render();
        } else {
            this.showAlert(strings.merge.failed, 'error');
        }
    },

    // ---- MERGE CURRENT VIEW INTO A TREE (Primitive 3) ----
    /**
     * "Merge this view into…": take exactly the persons currently shown (the
     * WYSIWYG subtree of the focus view) as the import of the guide, whose
     * step 1 chooses the target among the other trees (spec 134 §2, 2d). No
     * intermediate tree is created — the subtree lives only in memory. Edit-flow only.
     */
    async mergeViewInto(): Promise<void> {
        if (DataManager.isReadOnly()) return;
        const visibleIds = TreeRenderer.getVisiblePersonIds();
        // Empty view (e.g. fan/timeline/map don't populate layout positions, or
        // nothing is focused): nothing to merge.
        if (visibleIds.size === 0) {
            this.showToast(strings.merge.mergeViewEmpty);
            return;
        }
        // Merging a view into its OWN tree is person-merge territory, not this flow.
        const activeTreeId = TreeManager.getActiveTreeId();
        if (!await this.mergeTargetReady(activeTreeId)) return;

        // Snapshot the subtree now, while the active tree is still current.
        const data = extractSubtree(DataManager.getData(), visibleIds);
        const activeName = activeTreeId ? TreeManager.getTreeMetadata(activeTreeId)?.name : undefined;
        const label = activeName
            ? `${activeName} — ${strings.merge.mergeViewSourceLabel}`
            : strings.merge.mergeViewSourceLabel;
        MergerUI.startMerge(data, label, false, undefined, { kind: 'view' }, activeTreeId ? { exclude: activeTreeId } : {});
    },

    // ---- MERGE A TREE INTO ANOTHER ----
    /**
     * Manage trees → ⋯ → "Merge into another tree…": the guide with the row's
     * tree as the import and the open tree as the target (another one when the
     * row is the open tree), Swap in its step 1 (spec 134 §2, 2c). The target
     * is read for the comparison only; nothing is switched to before the write.
     */
    async showMergeTreesDialog(sourceTreeId: string, parentDialogId?: string): Promise<void> {
        const sourceId = sourceTreeId as TreeId;
        if (!TreeManager.getTreeMetadata(sourceId)) return;
        if (!await this.mergeTargetReady(sourceId)) return;
        const open = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === sourceId;
        const data = open ? structuredClone(DataManager.getData()) : await TreeManager.getTreeData(sourceId);
        if (!data) {
            this.showAlert(strings.mergeWizard.unreadable(TreeManager.getTreeMetadata(sourceId)?.name ?? ''), 'error');
            return;
        }
        // From Manage trees, closing the guide goes back there.
        const fromManager = parentDialogId === 'tree-manager-modal';
        if (fromManager) this.closeTreeManagerDialog();
        MergerUI.startMerge(data, sourceId, fromManager, undefined, { kind: 'tree' });
    },

    /**
     * Whether a tree other than `except` can take the import (§2): none at all
     * says so; every one blocked (locked, followed live…) says why in a dialog
     * with its way out (Open Manage trees, End following), false unless that
     * way frees the tree.
     */
    async mergeTargetReady(except: TreeId | null): Promise<boolean> {
        const others = TreeManager.getTrees().filter(t => t.id !== except);
        if (others.length === 0) {
            this.showToast(strings.merge.mergeViewNoTarget);
            return false;
        }
        if (others.some(t => !targetBlock(t.id))) return true;
        return MergerUI.blockDialog(others[0].id);
    },
});
