/**
 * relationships panel UI methods. Extracted from the original UIClass;
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
    ParentChildRelType,
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
import { normalizeDateInput, formatDateForInput } from '../dates.js';

export const relationshipsPanelMethods = uiModule({
    showRelationshipsPanel(personId: PersonId, returnToEdit: boolean = false, preservePending: boolean = false): void {
        // Setup dialog stack for standalone mode (when opened directly from card, not from edit dialog)
        if (!returnToEdit && !preservePending) {
            this.clearDialogStack();
            this.pushDialog('relationships-modal');
        }

        // Clear pending changes only if not preserving (e.g. on refresh after structural change)
        if (!preservePending) {
            this.pendingPartnershipChanges.clear();
        }

        // Track if we should return to edit dialog when closing
        this.returnToEditPersonId = returnToEdit ? personId : null;
        const person = DataManager.getPerson(personId);
        if (!person) return;

        this.relationshipsPanelPersonId = personId;

        const modal = document.getElementById('relationships-modal');
        const title = document.getElementById('relationships-title');
        const content = document.getElementById('relationships-content');

        if (!modal || !title || !content) return;

        const name = `${person.firstName} ${person.lastName}`.trim();
        title.textContent = strings.relationships.title(name);

        // Build relationships content
        const parents = person.parentIds
            .map(id => DataManager.getPerson(id))
            .filter((p): p is import('../types.js').Person => p !== null);

        const partners = DataManager.getPartners(personId);
        const children = person.childIds
            .map(id => DataManager.getPerson(id))
            .filter((p): p is import('../types.js').Person => p !== null);

        const siblings = DataManager.getSiblings(personId);

        const isLocked = DataManager.isPersonLocked(personId);

        content.innerHTML = `
            ${this.buildRelSection('parents', strings.relationships.parents, parents, personId, person.parentIds.length < 2, isLocked)}
            ${this.buildRelSection('partners', strings.relationships.partners, partners, personId, true, isLocked)}
            ${this.buildRelSection('children', strings.relationships.children, children, personId, true, isLocked)}
            ${this.buildRelSection('siblings', strings.relationships.siblings, siblings, personId, true, isLocked)}
        `;

        // Attach event listeners for remove buttons
        content.querySelectorAll('.rel-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const relType = target.dataset.relType;
                const relId = target.dataset.relId as PersonId;
                this.removeRelationship(personId, relId, relType as 'parent' | 'partner' | 'child' | 'sibling');
            });
        });

        // Attach event listeners for add buttons
        content.querySelectorAll('.rel-add-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const relType = target.dataset.relType as RelationType;
                // Hide relationships panel (don't close - keep pending changes)
                this.closeDialogById('relationships-modal');
                // Push relation-modal onto stack (relationships-modal is already there)
                this.pushDialog('relation-modal');
                this.addRelation(personId, relType);
            });
        });

        // Attach event listeners for status select (pending change, not immediate save)
        content.querySelectorAll('.rel-status-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const target = e.target as HTMLSelectElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                const status = target.value as PartnershipStatus;
                this.setPendingPartnershipChange(partnershipId, { status });
            });
        });

        // Parent→child relationship type (applied immediately — own undo action).
        content.querySelectorAll('.parent-rel-type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const target = e.target as HTMLSelectElement;
                const childId = target.dataset.relChild as PersonId;
                const parentId = target.dataset.relParent as PersonId;
                DataManager.setParentRelType(childId, parentId, target.value as ParentChildRelType);
                TreeRenderer.render();
            });
        });

        // Attach event listeners for partnership notes (pending change)
        content.querySelectorAll('.partnership-note').forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                const target = e.target as HTMLTextAreaElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                this.setPendingPartnershipChange(partnershipId, { note: target.value });
            });
        });

        // Attach event listeners for start date (pending change)
        content.querySelectorAll('.partnership-start-date').forEach(input => {
            input.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                const normalized = normalizeDateInput(target.value);
                target.classList.toggle('invalid', normalized === null);
                if (normalized === null) return;
                target.value = normalized;
                this.setPendingPartnershipChange(partnershipId, { startDate: normalized });
            });
        });

        // Attach event listeners for start place (pending change)
        content.querySelectorAll('.partnership-start-place').forEach(input => {
            input.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                this.setPendingPartnershipChange(partnershipId, { startPlace: target.value });
            });
        });

        // Attach event listeners for end date (pending change)
        content.querySelectorAll('.partnership-end-date').forEach(input => {
            input.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                const normalized = normalizeDateInput(target.value);
                target.classList.toggle('invalid', normalized === null);
                if (normalized === null) return;
                target.value = normalized;
                this.setPendingPartnershipChange(partnershipId, { endDate: normalized });
            });
        });

        // Attach event listeners for isPrimary checkbox (pending change)
        content.querySelectorAll('.partnership-primary-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                const currentPersonId = target.dataset.personId as PersonId;
                const isChecked = target.checked;

                if (isChecked) {
                    // Unset isPrimary on all other partnerships of this person (in pending state)
                    const person = DataManager.getPerson(currentPersonId);
                    if (person) {
                        for (const otherPartnershipId of person.partnerships) {
                            if (otherPartnershipId !== partnershipId) {
                                this.setPendingPartnershipChange(otherPartnershipId, { isPrimary: false });
                            }
                        }
                    }
                    // Set this one as primary (in pending state)
                    this.setPendingPartnershipChange(partnershipId, { isPrimary: true });
                    // Update other checkboxes in the UI
                    content.querySelectorAll('.partnership-primary-checkbox').forEach(cb => {
                        if (cb !== target) {
                            (cb as HTMLInputElement).checked = false;
                        }
                    });
                } else {
                    this.setPendingPartnershipChange(partnershipId, { isPrimary: false });
                }
            });
        });

        // Setup Enter key navigation for partnership fields (date → place → note)
        content.querySelectorAll('.partnership-wedding-date').forEach(input => {
            (input as HTMLInputElement).onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const partnershipId = (input as HTMLInputElement).dataset.partnershipId;
                    const placeInput = content.querySelector(`.partnership-wedding-place[data-partnership-id="${partnershipId}"]`) as HTMLInputElement;
                    placeInput?.focus();
                }
            };
        });

        content.querySelectorAll('.partnership-wedding-place').forEach(input => {
            (input as HTMLInputElement).onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const partnershipId = (input as HTMLInputElement).dataset.partnershipId;
                    const noteInput = content.querySelector(`.partnership-note[data-partnership-id="${partnershipId}"]`) as HTMLTextAreaElement;
                    noteInput?.focus();
                }
            };
        });

        modal.classList.add('active');
    },

    buildRelSection(type: string, title: string, persons: import('../types.js').Person[], currentPersonId: PersonId, canAdd: boolean, isLocked: boolean = false): string {
        const addBtnText: Record<string, string> = {
            parents: strings.relationships.addParent,
            partners: strings.relationships.addPartner,
            children: strings.relationships.addChild,
            siblings: strings.relationships.addSibling
        };

        const relType: Record<string, RelationType> = {
            parents: 'parent',
            partners: 'partner',
            children: 'child',
            siblings: 'sibling'
        };

        const items = persons.map(p => {
            let statusHtml = '';
            let partnershipDetailsHtml = '';
            // Parent→child relationship type select (parents/children sections).
            let relTypeHtml = '';
            if ((type === 'parents' || type === 'children') && !isLocked) {
                const childId = type === 'parents' ? currentPersonId : p.id;
                const parentId = type === 'parents' ? p.id : currentPersonId;
                const childPerson = DataManager.getPerson(childId);
                const current = childPerson?.parentRelTypes?.[parentId] ?? 'biological';
                const opt = (v: string, label: string) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`;
                relTypeHtml = `
                    <select class="parent-rel-type-select" data-rel-child="${childId}" data-rel-parent="${parentId}">
                        ${opt('biological', strings.parentRelType.biological)}
                        ${opt('adoptive', strings.parentRelType.adoptive)}
                        ${opt('step', strings.parentRelType.step)}
                        ${opt('foster', strings.parentRelType.foster)}
                    </select>
                `;
            }
            if (type === 'partners') {
                const partnership = DataManager.getPartnershipBetween(currentPersonId, p.id);
                if (partnership) {
                    const status = partnership.status || 'married';
                    statusHtml = `
                        <select class="rel-status-select" data-partnership-id="${partnership.id}">
                            <option value="married" ${status === 'married' ? 'selected' : ''}>${strings.partnershipStatus.married}</option>
                            <option value="partners" ${status === 'partners' ? 'selected' : ''}>${strings.partnershipStatus.partners}</option>
                            <option value="divorced" ${status === 'divorced' ? 'selected' : ''}>${strings.partnershipStatus.divorced}</option>
                            <option value="separated" ${status === 'separated' ? 'selected' : ''}>${strings.partnershipStatus.separated}</option>
                        </select>
                    `;
                    const isMarriedType = status === 'married' || status === 'divorced';
                    const startDateLabel = isMarriedType ? strings.labels.startDateMarried : strings.labels.startDatePartners;
                    const endDateLabel = isMarriedType ? strings.labels.endDateMarried : strings.labels.endDatePartners;
                    // Only show primary checkbox when person has 2+ partnerships
                    const showPrimaryCheckbox = persons.length >= 2;
                    const primaryCheckboxHtml = showPrimaryCheckbox ? `
                        <label class="partnership-primary-label">
                            <input type="checkbox" class="partnership-primary-checkbox"
                                data-partnership-id="${partnership.id}"
                                data-person-id="${currentPersonId}"
                                ${partnership.isPrimary ? 'checked' : ''}>
                            ${strings.labels.isPrimary}
                        </label>
                    ` : '';

                    partnershipDetailsHtml = `
                        <div class="partnership-dates">
                            <input type="text" class="partnership-start-date flex-date" autocomplete="off"
                                placeholder="${strings.placeholders.flexDate}"
                                data-partnership-id="${partnership.id}"
                                value="${formatDateForInput(partnership.startDate)}"
                                title="${startDateLabel}">
                            <input type="text" class="partnership-start-place"
                                data-partnership-id="${partnership.id}"
                                value="${partnership.startPlace || ''}"
                                placeholder="${strings.labels.startPlace}">
                            <input type="text" class="partnership-end-date flex-date" autocomplete="off"
                                placeholder="${strings.placeholders.flexDate}"
                                data-partnership-id="${partnership.id}"
                                value="${partnership.endDate || ''}"
                                title="${endDateLabel}">
                        </div>
                        ${primaryCheckboxHtml}
                        <textarea class="partnership-note" data-partnership-id="${partnership.id}"
                            placeholder="${strings.labels.note}...">${partnership.note || ''}</textarea>
                    `;
                }
            }
            return `
                <div class="rel-item">
                    <span class="rel-item-name">
                        <span class="rel-item-icon">${p.gender === 'male' ? '👤' : '👤'}</span>
                        ${p.firstName} ${p.lastName}
                    </span>
                    ${statusHtml}
                    ${relTypeHtml}
                    ${!isLocked ? `<button class="rel-remove-btn" data-rel-type="${relType[type]}" data-rel-id="${p.id}">
                        ${strings.relationships.remove}
                    </button>` : ''}
                </div>
                ${partnershipDetailsHtml}
            `;
        }).join('');

        return `
            <div class="rel-section">
                <div class="rel-section-title">${title}</div>
                ${items || `<div style="color: var(--text-light); font-size: 13px; padding: 8px 0;">—</div>`}
                ${canAdd && !isLocked ? `<button class="rel-add-btn" data-rel-type="${relType[type]}">${addBtnText[type]}</button>` : ''}
            </div>
        `;
    },

    async removeRelationship(personId: PersonId, relatedId: PersonId, type: 'parent' | 'partner' | 'child' | 'sibling'): Promise<void> {
        switch (type) {
            case 'parent':
                DataManager.removeParentChild(relatedId, personId);
                break;
            case 'partner':
                DataManager.removePartnership(personId, relatedId);
                break;
            case 'child':
                DataManager.removeParentChild(personId, relatedId);
                break;
            case 'sibling': {
                // For siblings, we need to remove from common parents
                // This is tricky - we remove the sibling from all shared parents
                const person = DataManager.getPerson(personId);
                const sibling = DataManager.getPerson(relatedId);
                if (person && sibling) {
                    for (const parentId of person.parentIds) {
                        if (sibling.parentIds.includes(parentId)) {
                            DataManager.removeParentChild(parentId, relatedId);
                        }
                    }
                }
                break;
            }
        }

        TreeRenderer.render();
        this.refreshSearch();

        // Check if the removed person is now an orphan (no relationships left)
        const removedPerson = DataManager.getPerson(relatedId);
        if (removedPerson && this.isOrphan(removedPerson)) {
            const name = `${removedPerson.firstName} ${removedPerson.lastName}`.trim();
            // Hide relationships panel temporarily for confirm dialog
            this.closeDialogById('relationships-modal');
            // Setup stack: relationships-modal is parent of confirmation
            const savedStack = [...this.dialogStack];
            this.clearDialogStack();
            this.pushDialog('relationships-modal');

            const shouldDelete = await this.showConfirm(
                strings.relationships.orphanConfirm(name),
                strings.relationships.orphanDelete,
                { ok: strings.relationships.orphanDelete, cancel: strings.relationships.orphanKeep }
            );

            if (shouldDelete) {
                DataManager.deletePerson(relatedId);
                TreeRenderer.render();
                this.refreshSearch();
            }

            // Restore stack and reopen relationships panel
            this.dialogStack = savedStack;
            this.openDialogById('relationships-modal');
        }

        // Refresh the panel (preserving pending changes for other partnerships)
        if (this.relationshipsPanelPersonId) {
            this.refreshRelationshipsPanel();
        }
    },

    /**
     * Check if a person has no remaining relationships (orphan)
     */
    isOrphan(person: Person): boolean {
        return person.parentIds.length === 0
            && person.childIds.length === 0
            && person.partnerships.length === 0;
    },

    /**
     * Helper to set pending partnership change (merges with existing pending changes)
     */
    setPendingPartnershipChange(partnershipId: PartnershipId, changes: {
        status?: PartnershipStatus;
        startDate?: string;
        startPlace?: string;
        endDate?: string;
        note?: string;
        isPrimary?: boolean;
    }): void {
        const existing = this.pendingPartnershipChanges.get(partnershipId) || {};
        this.pendingPartnershipChanges.set(partnershipId, { ...existing, ...changes });
    },

    /**
     * Save all pending relationship changes
     */
    saveRelationships(): void {
        // Batch multiple partnership updates into one log entry
        if (this.pendingPartnershipChanges.size > 1) {
            AuditLogManager.beginBatch();
        }

        // Apply all pending partnership changes
        for (const [partnershipId, changes] of this.pendingPartnershipChanges) {
            DataManager.updatePartnership(partnershipId, changes);
        }

        if (this.pendingPartnershipChanges.size > 1) {
            const treeId = DataManager.getCurrentTreeId();
            AuditLogManager.endBatch(treeId, 'partnership.update',
                strings.auditLog.updatedPartnership('…', '…'));
        }

        // Clear pending changes
        this.pendingPartnershipChanges.clear();

        // Re-render tree
        TreeRenderer.render();

        // Close panel and return to parent dialog via stack
        this.closeRelationshipsPanel();
    },

    /**
     * Cancel relationship editing - check for unsaved changes first
     */
    cancelRelationshipsPanel(): void {
        if (this.pendingPartnershipChanges.size > 0) {
            this.showUnsavedChangesDialog();
            return;
        }
        // No pending changes - close normally
        this.pendingPartnershipChanges.clear();
        this.closeRelationshipsPanel();
    },

    /**
     * Show unsaved changes confirmation dialog
     */
    showUnsavedChangesDialog(): void {
        const modal = document.getElementById('confirmation-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const buttonsEl = document.getElementById('confirm-buttons');
        const optionsEl = document.getElementById('confirm-options');

        if (!modal || !titleEl || !messageEl || !buttonsEl) return;

        // Set dialog type class
        modal.className = 'modal-overlay dialog-warning';

        titleEl.innerHTML = `<span class="dialog-icon">⚠️</span>${strings.relationships.unsavedTitle}`;
        messageEl.textContent = strings.relationships.unsavedMessage;

        // Hide options
        if (optionsEl) optionsEl.innerHTML = '';

        // Three buttons: Save & Close | Discard | Stay
        buttonsEl.innerHTML = `
            <button class="secondary" id="confirm-stay-btn">${strings.relationships.unsavedStay}</button>
            <button class="secondary" id="confirm-discard-btn">${strings.relationships.unsavedDiscard}</button>
            <button class="primary" id="confirm-save-btn">${strings.relationships.unsavedSave}</button>
        `;

        const stayBtn = document.getElementById('confirm-stay-btn');
        const discardBtn = document.getElementById('confirm-discard-btn');
        const saveBtn = document.getElementById('confirm-save-btn');

        const closeConfirm = () => {
            modal.classList.remove('active');
        };

        if (stayBtn) {
            stayBtn.onclick = () => {
                closeConfirm();
                // Stay on relationships panel - do nothing
            };
        }

        if (discardBtn) {
            discardBtn.onclick = () => {
                closeConfirm();
                this.pendingPartnershipChanges.clear();
                this.closeRelationshipsPanel();
            };
        }

        if (saveBtn) {
            saveBtn.onclick = () => {
                closeConfirm();
                this.saveRelationships();
            };
        }

        // Overlay click = stay
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeConfirm();
            }
        };

        modal.classList.add('active');
    },

    closeRelationshipsPanel(): void {
        document.getElementById('relationships-modal')?.classList.remove('active');

        // Check if we should return to edit person dialog
        const returnToId = this.returnToEditPersonId;

        this.relationshipsPanelPersonId = null;
        this.returnToEditPersonId = null;

        // Return to parent dialog via stack
        // Remove relationships-modal from stack
        const relIdx = this.dialogStack.indexOf('relationships-modal');
        if (relIdx !== -1) {
            this.dialogStack.splice(relIdx, 1);
        }

        // If there's a parent dialog in the stack (person-modal), open it
        if (this.dialogStack.length > 0) {
            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
            if (returnToId && parentDialog === 'person-modal') {
                this.openDialogById(parentDialog);
            } else {
                this.openDialogById(parentDialog);
            }
            this.dialogStack = [];
        } else if (returnToId) {
            // Fallback: reopen edit dialog if we came from there
            this.showEditPersonModal(returnToId);
        }
    },

    /**
     * Refresh relationships panel after structural change, preserving pending changes
     */
    refreshRelationshipsPanel(): void {
        if (!this.relationshipsPanelPersonId) return;

        const savedPending = new Map(this.pendingPartnershipChanges);
        const returnToEdit = this.returnToEditPersonId !== null;
        const personId = this.relationshipsPanelPersonId;

        // Rebuild panel content (preservePending=true to not clear pending map)
        this.showRelationshipsPanel(personId, returnToEdit, true);

        // Restore pending changes and apply values back to form elements
        for (const [partnershipId, changes] of savedPending) {
            this.pendingPartnershipChanges.set(partnershipId, changes);
            this.applyPendingToForm(partnershipId, changes);
        }
    },

    /**
     * Apply pending partnership changes back to form elements after a refresh
     */
    applyPendingToForm(partnershipId: PartnershipId, changes: {
        status?: PartnershipStatus;
        startDate?: string;
        startPlace?: string;
        endDate?: string;
        note?: string;
        isPrimary?: boolean;
    }): void {
        const content = document.getElementById('relationships-content');
        if (!content) return;

        if (changes.status !== undefined) {
            const select = content.querySelector(`.rel-status-select[data-partnership-id="${partnershipId}"]`) as HTMLSelectElement;
            if (select) select.value = changes.status;
        }
        if (changes.startDate !== undefined) {
            const input = content.querySelector(`.partnership-start-date[data-partnership-id="${partnershipId}"]`) as HTMLInputElement;
            if (input) input.value = changes.startDate;
        }
        if (changes.startPlace !== undefined) {
            const input = content.querySelector(`.partnership-start-place[data-partnership-id="${partnershipId}"]`) as HTMLInputElement;
            if (input) input.value = changes.startPlace;
        }
        if (changes.endDate !== undefined) {
            const input = content.querySelector(`.partnership-end-date[data-partnership-id="${partnershipId}"]`) as HTMLInputElement;
            if (input) input.value = changes.endDate;
        }
        if (changes.note !== undefined) {
            const textarea = content.querySelector(`.partnership-note[data-partnership-id="${partnershipId}"]`) as HTMLTextAreaElement;
            if (textarea) textarea.value = changes.note;
        }
        if (changes.isPrimary !== undefined) {
            const checkbox = content.querySelector(`.partnership-primary-checkbox[data-partnership-id="${partnershipId}"]`) as HTMLInputElement;
            if (checkbox) checkbox.checked = changes.isPrimary;
        }
    },
});
