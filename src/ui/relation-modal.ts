/**
 * relation modal UI methods. Extracted from the original UIClass;
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
import { normalizeDateInput } from '../dates.js';
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

import { chainLinkSvg } from '../icons.js';
export const relationModalMethods = uiModule({
    // ---- RELATION MODAL ----
    addRelation(personId: PersonId, relationType: RelationType): void {
        const person = DataManager.getPerson(personId);
        if (!person || DataManager.isReadOnly()) return;

        this.relationContext = { personId, relationType };

        // For child with single partner: pre-select (combo in modal allows changing)
        if (relationType === 'child') {
            const partners = DataManager.getPartners(personId);
            if (partners.length === 1) {
                (this.relationContext as RelationContext & { includePartner?: PersonId }).includePartner = partners[0].id;
            }
            // 0 or 2+ partners: combo in showRelationModal handles selection
        }

        this.showRelationModal();
    },

    showRelationModal(): void {
        if (!this.relationContext) return;

        const modal = document.getElementById('relation-modal');
        const title = document.getElementById('relation-title');
        const newFields = document.getElementById('new-person-fields');
        const existingField = document.getElementById('existing-person-field');
        const genderSelect = document.getElementById('rel-gender') as HTMLSelectElement;
        const linkBtn = document.getElementById('toggle-link-mode');
        const submitBtn = document.getElementById('rel-submit-btn');

        if (!modal || !title || !newFields || !existingField || !genderSelect || !linkBtn || !submitBtn) return;

        const titles: Record<RelationType, string> = {
            parent: strings.relationModal.addParent,
            partner: strings.relationModal.addPartner,
            child: strings.relationModal.addChild,
            sibling: strings.relationModal.addSibling
        };

        title.textContent = titles[this.relationContext.relationType];

        // Setup "other parent" combo for child relation type
        const otherParentGroup = document.getElementById('rel-other-parent');
        const otherParentLabel = document.getElementById('rel-other-parent-label');
        const otherParentSelect = document.getElementById('rel-other-parent-select') as HTMLSelectElement;
        if (otherParentGroup && otherParentLabel && otherParentSelect) {
            if (this.relationContext.relationType === 'child') {
                const { personId } = this.relationContext;
                const partners = DataManager.getPartners(personId);
                otherParentLabel.textContent = strings.addChild.selectParent;
                otherParentSelect.innerHTML = '';

                // Add partner options
                for (const partner of partners) {
                    const partnership = DataManager.getPartnerships(personId)
                        .find(p => p.person1Id === partner.id || p.person2Id === partner.id);
                    const statusText = partnership ? strings.partnershipStatus[partnership.status] : '';
                    const birthYear = partner.birthDate?.split('-')[0] || '';
                    let nameStr: string;
                    if (partner.isPlaceholder) {
                        nameStr = strings.addChild.unknownPerson + (statusText ? ` (${statusText})` : '');
                    } else {
                        nameStr = `${partner.firstName} ${partner.lastName}`.trim();
                        const detail = [birthYear ? `*${birthYear}` : '', statusText].filter(Boolean).join(', ');
                        if (detail) nameStr += ` (${detail})`;
                    }
                    const opt = document.createElement('option');
                    opt.value = partner.id;
                    opt.textContent = nameStr;
                    otherParentSelect.appendChild(opt);
                }

                // Add "New person (unknown)" option
                const newOpt = document.createElement('option');
                newOpt.value = '__new_placeholder__';
                newOpt.textContent = strings.addChild.newPlaceholder;
                otherParentSelect.appendChild(newOpt);

                // Pre-select: if includePartner was set (1 partner), select it; otherwise select last partner
                const includePartner = (this.relationContext as RelationContext & { includePartner?: PersonId }).includePartner;
                if (includePartner) {
                    otherParentSelect.value = includePartner;
                } else if (partners.length > 0) {
                    otherParentSelect.value = partners[partners.length - 1].id;
                }

                otherParentGroup.style.display = '';
            } else {
                otherParentGroup.style.display = 'none';
            }
        }

        // Reset form and link mode
        this.linkMode = false;
        linkBtn.classList.remove('active');
        linkBtn.innerHTML = `${chainLinkSvg({ size: 13 })} ${strings.relationModal.linkExisting}`;
        linkBtn.title = strings.relationModal.linkExistingTitle;
        submitBtn.textContent = strings.buttons.add;
        (document.getElementById('rel-firstname') as HTMLInputElement).value = '';
        (document.getElementById('rel-lastname') as HTMLInputElement).value = '';

        // Smart gender pre-fill based on relation context
        if (this.relationContext.relationType === 'partner') {
            // Partner: opposite gender
            const sourcePerson = DataManager.getPerson(this.relationContext.personId);
            genderSelect.value = sourcePerson?.gender === 'male' ? 'female' : 'male';
        } else if (this.relationContext.relationType === 'parent') {
            // Parent: if one parent exists, pre-fill opposite gender
            const child = DataManager.getPerson(this.relationContext.personId);
            const existingParents = child ? child.parentIds.map(pid => DataManager.getPerson(pid)).filter(Boolean) : [];
            if (existingParents.length === 1 && existingParents[0]) {
                genderSelect.value = existingParents[0].gender === 'male' ? 'female' : 'male';
            } else {
                genderSelect.value = 'male';
            }
        } else {
            genderSelect.value = 'male';
        }

        // Reset date and place fields
        (document.getElementById('rel-birthdate') as HTMLInputElement).value = '';
        (document.getElementById('rel-birthplace') as HTMLInputElement).value = '';
        (document.getElementById('rel-deathdate') as HTMLInputElement).value = '';
        (document.getElementById('rel-deathplace') as HTMLInputElement).value = '';
        // Refresh flex-date styling (clear any stale .invalid/.has-value from a
        // previous open) now that the values were reset programmatically.
        this.setupDateInputs();

        // Reset extended fields - collapse by default
        const expandBtn = document.getElementById('rel-expand-btn');
        const extendedFields = document.getElementById('rel-extended-fields');
        if (expandBtn && extendedFields) {
            expandBtn.classList.remove('expanded');
            extendedFields.classList.remove('visible');
            expandBtn.onclick = () => {
                const isExpanded = expandBtn.classList.toggle('expanded');
                extendedFields.classList.toggle('visible', isExpanded);
            };
        }

        // Initialize PersonPicker for existing persons
        this.initRelationPicker();

        // Show new person fields by default
        newFields.style.display = 'block';
        existingField.style.display = 'none';

        // Setup link button toggle
        const previewBtn = document.getElementById('rel-preview-btn');
        linkBtn.onclick = () => {
            this.linkMode = !this.linkMode;
            if (this.linkMode) {
                linkBtn.classList.add('active');
                linkBtn.innerHTML = `+ ${strings.relationModal.createNewTitle}`;
                linkBtn.title = strings.relationModal.createNewTitle;
                // Show link title with relationship type
                const linkTitles: Record<RelationType, string> = {
                    parent: strings.relationModal.linkAsParent,
                    partner: strings.relationModal.linkAsPartner,
                    child: strings.relationModal.linkAsChild,
                    sibling: strings.relationModal.linkAsSibling
                };
                title.textContent = linkTitles[this.relationContext!.relationType];
                submitBtn.textContent = strings.relationModal.linkButton;
                newFields.style.display = 'none';
                existingField.style.display = 'block';
                // Clear picker when switching to link mode
                this.relationPicker?.clear();
                // Hide preview button until selection
                if (previewBtn) previewBtn.style.display = 'none';
            } else {
                linkBtn.classList.remove('active');
                linkBtn.innerHTML = `${chainLinkSvg({ size: 13 })} ${strings.relationModal.linkExisting}`;
                linkBtn.title = strings.relationModal.linkExistingTitle;
                title.textContent = titles[this.relationContext!.relationType];
                submitBtn.textContent = strings.buttons.add;
                newFields.style.display = 'block';
                existingField.style.display = 'none';
                // Hide preview button in create mode
                if (previewBtn) previewBtn.style.display = 'none';
            }
        };

        modal.classList.add('active');

        // Duplicate suggestions while typing a new related person.
        this.initDuplicateSuggest('relation');

        // Setup Enter as Tab for form fields (only when creating new person)
        this.setupEnterAsTab('relation-modal', ['rel-firstname', 'rel-lastname', 'rel-gender'], () => this.saveRelation());
    },

    /**
     * Initialize PersonPicker for relation modal
     */
    initRelationPicker(): void {
        if (!this.relationContext) return;

        const { personId, relationType } = this.relationContext;
        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Destroy existing picker
        if (this.relationPicker) {
            this.relationPicker.destroy();
            this.relationPicker = null;
        }

        const allPersons = DataManager.getAllPersons();
        const currentPartnerIds = DataManager.getPartners(personId).map(p => p.id);

        // Filter based on relation type
        const filteredPersons = allPersons.filter(p => {
            if (p.id === personId) return false; // Exclude self
            if (p.isPlaceholder) return false; // Exclude placeholders

            if (relationType === 'partner') return !currentPartnerIds.includes(p.id);
            // Only people the link would accept: no third parent, no cycle.
            return this.canLinkRelation(personId, p.id, relationType);
        });

        this.relationPicker = new PersonPicker({
            containerId: 'existing-person-picker',
            onSelect: () => {
                // Show/hide preview button based on selection
                const previewBtn = document.getElementById('rel-preview-btn');
                if (previewBtn) {
                    previewBtn.style.display = this.relationPicker?.getValue() ? '' : 'none';
                }
            },
            placeholder: strings.relationModal.selectPerson,
            persons: filteredPersons
        });
    },

    /**
     * Preview person selected in relation modal
     */
    previewRelationPerson(): void {
        const selectedId = this.relationPicker?.getValue();
        if (!selectedId) return;

        const person = DataManager.getPerson(selectedId);
        if (!person) return;

        const data = DataManager.getData();
        const name = `${person.firstName || ''} ${person.lastName || ''}`.trim();
        const year = person.birthDate?.split('-')[0];
        const subtitle = year ? `${name} (*${year})` : name;

        TreePreview.show({
            data,
            focusPersonId: selectedId,
            depthUp: 2,
            depthDown: 2,
            title: strings.treePreview.preview,
            subtitle
        });
    },


    /**
     * The "other parent" chosen in the combo when adding a child; undefined
     * for "new unknown person" (createRelationship then makes a placeholder).
     */
    selectedOtherParent(): PersonId | undefined {
        if (this.relationContext?.relationType !== 'child') return undefined;
        const val = (document.getElementById('rel-other-parent-select') as HTMLSelectElement | null)?.value;
        return val && val !== '__new_placeholder__' ? val as PersonId : undefined;
    },

    saveRelation(): void {
        if (!this.relationContext) return;

        const { personId, relationType } = this.relationContext;
        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Read other parent from combo (for child relation type)
        const includePartner = this.selectedOtherParent();

        let newPersonId: PersonId;
        // Creating the new person and linking it is ONE undo step (review V12).
        let batchOpen = false;

        if (this.linkMode) {
            // Link to existing person via PersonPicker
            const selectedId = this.relationPicker?.getValue();
            if (!selectedId) {
                this.clearDialogStack();
                this.pushDialog('relation-modal');
                this.showAlert(strings.relationModal.selectPersonError, 'warning');
                return;
            }
            if (!this.canLinkRelation(personId, selectedId, relationType)) {
                this.showLinkRefused();
                return;
            }
            newPersonId = selectedId;
        } else {
            // A third parent is refused — before the new person exists.
            if (relationType === 'parent' && person.parentIds.length >= 2) {
                this.showLinkRefused();
                return;
            }
            // Create new person
            const firstName = (document.getElementById('rel-firstname') as HTMLInputElement)?.value.trim() || '';
            const lastName = (document.getElementById('rel-lastname') as HTMLInputElement)?.value.trim() || '';
            const gender = ((document.getElementById('rel-gender') as HTMLSelectElement)?.value || 'male') as Gender;
            // Flex-date normalization mirrors the person modal: null means the
            // text did not parse — block the save and point the user back.
            const birthDateRaw = normalizeDateInput((document.getElementById('rel-birthdate') as HTMLInputElement)?.value || '');
            const deathDateRaw = normalizeDateInput((document.getElementById('rel-deathdate') as HTMLInputElement)?.value || '');
            if (birthDateRaw === null || deathDateRaw === null) {
                this.clearDialogStack();
                this.pushDialog('relation-modal');
                this.showAlert(strings.personModal.invalidDate, 'warning');
                return;
            }
            const birthDate = birthDateRaw || undefined;
            const birthPlace = (document.getElementById('rel-birthplace') as HTMLInputElement)?.value.trim() || undefined;
            const deathDate = deathDateRaw || undefined;
            const deathPlace = (document.getElementById('rel-deathplace') as HTMLInputElement)?.value.trim() || undefined;

            // Begin batch before person creation to suppress individual audit logs
            AuditLogManager.beginBatch();
            DataManager.beginBatch();
            batchOpen = true;

            const isPlaceholder = !firstName && !lastName;
            const newPerson = DataManager.createPerson(
                { firstName: isPlaceholder ? '?' : firstName, lastName, gender, birthDate, birthPlace, deathDate, deathPlace },
                isPlaceholder
            );
            newPersonId = newPerson.id;
        }

        // Create the relationship (endBatch is called inside)
        try {
            this.createRelationship(personId, newPersonId, relationType, includePartner);
        } finally {
            if (batchOpen) DataManager.commitBatch(null, false);
        }

        this.closeRelationModal();
        TreeRenderer.render();
        this.refreshSearch();

        // If relationships panel was open, refresh it (closeRelationModal already handled stack)
        if (this.relationshipsPanelPersonId) {
            this.refreshRelationshipsPanel();
        }
    },

    /**
     * Whether an EXISTING person `otherId` can be linked to `personId` as the
     * given relation without a third parent or a cycle in the ancestry
     * (review V10). The pickers offer only people this accepts, and the save
     * paths refuse the rest with a toast instead of half-linking them.
     */
    canLinkRelation(personId: PersonId, otherId: PersonId, relationType: RelationType): boolean {
        const person = DataManager.getPerson(personId);
        const other = DataManager.getPerson(otherId);
        if (!person || !other || personId === otherId) return false;
        switch (relationType) {
            case 'partner':
                return true;
            case 'parent':
                return !person.parentIds.includes(otherId) && DataManager.canAddParentChild(otherId, personId);
            case 'child':
                return !person.childIds.includes(otherId) && DataManager.canAddParentChild(personId, otherId);
            case 'sibling': {
                if (person.parentIds.length === 0) {
                    // The person joins the sibling's parents (placeholders
                    // are created for both only when neither has any).
                    return other.parentIds.every(par => DataManager.canAddParentChild(par, personId));
                }
                const missing = person.parentIds.filter(par => !other.parentIds.includes(par));
                if (other.parentIds.length + missing.length > 2) return false;
                return missing.every(par => DataManager.canAddParentChild(par, otherId));
            }
        }
        return false;
    },

    /** Toast for a relation link the data model refuses (third parent / cycle). */
    showLinkRefused(): void {
        this.showToast(strings.relationModal.linkRefused);
    },

    /**
     * Link `newPersonId` to `personId` as `relationType`. One user action, so
     * one undo step (review V12) — also when the caller already opened a
     * batch (a new person created just before joins the same step). Returns
     * false when the link was refused (nothing is changed then).
     */
    createRelationship(personId: PersonId, newPersonId: PersonId, relationType: RelationType, includePartner?: PersonId): boolean {
        const person = DataManager.getPerson(personId);
        if (!person) return false;
        if (!this.canLinkRelation(personId, newPersonId, relationType)) {
            if (AuditLogManager.isBatching()) AuditLogManager.cancelBatch();
            this.showLinkRefused();
            return false;
        }
        DataManager.runBatch(null, () => this.createRelationshipInner(person, personId, newPersonId, relationType, includePartner));
        return true;
    },

    createRelationshipInner(person: Person, personId: PersonId, newPersonId: PersonId, relationType: RelationType, includePartner?: PersonId): void {
        const treeId = DataManager.getCurrentTreeId();
        // Begin batch if not already started (new person path starts it earlier)
        if (!AuditLogManager.isBatching()) {
            AuditLogManager.beginBatch();
        }

        switch (relationType) {
            case 'partner': {
                DataManager.createPartnership(personId, newPersonId);
                AuditLogManager.endBatch(treeId, 'partnership.create',
                    strings.auditLog.addedPartner(auditPersonName(person), auditPersonName(DataManager.getPerson(newPersonId))));
                return;
            }

            case 'child': {
                const newChild = DataManager.getPerson(newPersonId);
                DataManager.addParentChild(personId, newPersonId);
                // The second parent only into a FREE slot: a linked child may
                // already have its other parent (never make a third one).
                const freeSlot = (newChild?.parentIds.length ?? 0) < 2;
                if (includePartner) {
                    if (DataManager.canAddParentChild(includePartner, newPersonId)
                        && DataManager.addParentChild(includePartner, newPersonId)) {
                        const partnership = DataManager.getPartnerships(personId)
                            .find(p => p.person1Id === includePartner || p.person2Id === includePartner);
                        if (partnership) {
                            DataManager.addParentChild(personId, newPersonId, partnership.id);
                        }
                    }
                } else if (freeSlot) {
                    const placeholderGender: Gender = person.gender === 'male' ? 'female' : 'male';
                    const placeholder = DataManager.createPerson({
                        firstName: '?',
                        lastName: '',
                        gender: placeholderGender
                    }, true);
                    const partnership = DataManager.createPartnership(personId, placeholder.id);
                    DataManager.addParentChild(placeholder.id, newPersonId);
                    if (partnership) {
                        DataManager.addParentChild(personId, newPersonId, partnership.id);
                    }
                }
                AuditLogManager.endBatch(treeId, 'person.create',
                    strings.auditLog.addedChild(auditPersonName(person), auditPersonName(newChild)));
                return;
            }

            case 'parent': {
                DataManager.addParentChild(newPersonId, personId);
                const child = DataManager.getPerson(personId);
                if (child && child.parentIds.length === 2) {
                    const otherParentId = child.parentIds.find(pid => pid !== newPersonId);
                    if (otherParentId) {
                        const existingPartnership = DataManager.getPartnerships(newPersonId)
                            .find(p => p.person1Id === otherParentId || p.person2Id === otherParentId);
                        const partnership = existingPartnership || DataManager.createPartnership(newPersonId, otherParentId);
                        if (partnership) {
                            DataManager.addParentChild(newPersonId, personId, partnership.id);
                        }
                    }
                }
                AuditLogManager.endBatch(treeId, 'person.create',
                    strings.auditLog.addedParent(auditPersonName(DataManager.getPerson(newPersonId)), auditPersonName(person)));
                return;
            }

            case 'sibling': {
                const sibling = DataManager.getPerson(newPersonId);
                // Share the parents of whichever side has them.
                const [withParents, joining] = person.parentIds.length > 0 || !sibling?.parentIds.length
                    ? [person, newPersonId]
                    : [sibling, personId];
                if (withParents.parentIds.length > 0) {
                    const parents = [...withParents.parentIds];
                    for (const parentId of parents) {
                        DataManager.addParentChild(parentId, joining);
                    }
                    if (parents.length === 2) {
                        const partnership = DataManager.getPartnerships(parents[0])
                            .find(p => p.person1Id === parents[1] || p.person2Id === parents[1]);
                        if (partnership) {
                            DataManager.addParentChild(parents[0], joining, partnership.id);
                        }
                    }
                } else {
                    const father = DataManager.createPerson({
                        firstName: '?',
                        lastName: person.lastName,
                        gender: 'male'
                    }, true);

                    const mother = DataManager.createPerson({
                        firstName: '?',
                        lastName: '',
                        gender: 'female'
                    }, true);

                    const partnership = DataManager.createPartnership(father.id, mother.id);

                    DataManager.addParentChild(father.id, personId, partnership?.id);
                    DataManager.addParentChild(mother.id, personId);
                    DataManager.addParentChild(father.id, newPersonId, partnership?.id);
                    DataManager.addParentChild(mother.id, newPersonId);
                }
                AuditLogManager.endBatch(treeId, 'person.create',
                    strings.auditLog.addedSibling(auditPersonName(person), auditPersonName(DataManager.getPerson(newPersonId))));
                return;
            }
        }

        AuditLogManager.cancelBatch();
    },

    closeRelationModal(): void {
        document.getElementById('relation-modal')?.classList.remove('active');
        this.linkMode = false;  // Reset link mode when closing
        this.relationContext = null;
        // Clean up picker
        if (this.relationPicker) {
            this.relationPicker.destroy();
            this.relationPicker = null;
        }
        // Return to parent dialog (e.g. relationships-modal)
        // Remove relation-modal from stack first
        const relIdx = this.dialogStack.indexOf('relation-modal');
        if (relIdx !== -1) {
            this.dialogStack.splice(relIdx, 1);
            // Reopen parent if exists (only if we found relation-modal in stack)
            if (this.dialogStack.length > 0) {
                const parentDialog = this.dialogStack[this.dialogStack.length - 1];
                // Ensure parent modal element exists and add active class
                const parentEl = document.getElementById(parentDialog);
                if (parentEl) {
                    parentEl.classList.add('active');
                }
            }
        }
    },

    /**
     * Toggle between link existing person and create new person modes
     */
    toggleLinkMode(): void {
        const linkBtn = document.getElementById('toggle-link-mode');
        if (linkBtn) {
            linkBtn.click();
        }
    },

    closeConfirmModal(): void {
        document.getElementById('confirmation-modal')?.classList.remove('active');
        this.relationContext = null;
    },

    // ---- PARTNER SELECTION DIALOG ----
    /**
     * Show a dialog to select from multiple hidden partners
     * Uses the confirmation modal for consistency
     */
    showPartnerSelectionDialog(personId: PersonId, partners: import('../types.js').Person[]): void {
        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Fresh Cancel / OK pair — not whatever the last confirm left there.
        this.resetConfirmButtons();
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        const options = document.getElementById('confirm-options');
        const confirmBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        if (!modal || !title || !message || !options || !confirmBtn) return;

        title.textContent = strings.partnerSelection.title;
        const personName = `${person.firstName} ${person.lastName}`.trim();
        message.textContent = strings.partnerSelection.description(personName);

        // Build options from partners
        options.innerHTML = '';
        for (const partner of partners) {
            const birthYear = partner.birthDate?.split('-')[0] || '';
            const opt = document.createElement('div');
            opt.className = 'confirm-option';
            opt.innerHTML = `
                <input type="radio" name="partner-select" value="${this.escapeHtml(partner.id)}">
                <span>${this.escapeHtml(partner.firstName)} ${this.escapeHtml(partner.lastName)} ${birthYear ? `(${this.escapeHtml(birthYear)})` : ''}</span>
            `;
            opt.onclick = () => {
                options.querySelectorAll('.confirm-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                (opt.querySelector('input') as HTMLInputElement).checked = true;
            };
            options.appendChild(opt);
        }

        const close = () => {
            modal.classList.remove('active');
        };

        // Setup cancel button
        if (cancelBtn) {
            cancelBtn.onclick = close;
        }

        // Setup confirm button
        confirmBtn.onclick = () => {
            const selected = options.querySelector('input:checked') as HTMLInputElement;
            if (selected) {
                const partnerId = selected.value as PersonId;
                TreeRenderer.setFocus(partnerId);
            }
            close();
        };

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) close();
        };

        modal.classList.add('active');
    },
});
