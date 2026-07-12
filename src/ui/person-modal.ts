/**
 * person modal UI methods. Extracted from the original UIClass;
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
import { isValidDateInput, normalizeDateInput } from '../dates.js';

export const personModalMethods = uiModule({
    showAddPersonModal(): void {
        // Block adding persons when tree is locked
        if (DataManager.isTreeLocked()) return;

        this.currentId = null;
        const modal = document.getElementById('person-modal');
        const title = document.getElementById('modal-title');
        const deleteBtn = document.getElementById('btn-delete');
        const firstNameInput = document.getElementById('input-firstname') as HTMLInputElement;
        const lastNameInput = document.getElementById('input-lastname') as HTMLInputElement;
        const genderSelect = document.getElementById('input-gender') as HTMLSelectElement;
        const birthDateInput = document.getElementById('input-birthdate') as HTMLInputElement;
        const birthPlaceInput = document.getElementById('input-birthplace') as HTMLInputElement;
        const deathDateInput = document.getElementById('input-deathdate') as HTMLInputElement;
        const deathPlaceInput = document.getElementById('input-deathplace') as HTMLInputElement;
        const notesInput = document.getElementById('input-notes') as HTMLTextAreaElement;

        const mergeBtn = document.getElementById('btn-merge');
        const saveBtn = document.getElementById('btn-save');

        if (!modal || !title || !deleteBtn || !firstNameInput || !lastNameInput || !genderSelect) return;

        // Reset readonly states (may have been set by edit modal for locked person)
        firstNameInput.readOnly = false;
        lastNameInput.readOnly = false;
        genderSelect.disabled = false;
        if (birthDateInput) birthDateInput.readOnly = false;
        if (birthPlaceInput) birthPlaceInput.readOnly = false;
        if (deathDateInput) deathDateInput.readOnly = false;
        if (deathPlaceInput) deathPlaceInput.readOnly = false;
        if (notesInput) notesInput.readOnly = false;
        if (saveBtn) saveBtn.style.display = '';

        title.textContent = strings.personModal.addTitle;
        deleteBtn.style.display = 'none';
        if (mergeBtn) mergeBtn.style.display = 'none';
        firstNameInput.value = '';
        lastNameInput.value = '';
        genderSelect.value = 'male';
        if (birthDateInput) birthDateInput.value = '';
        if (birthPlaceInput) birthPlaceInput.value = '';
        if (deathDateInput) deathDateInput.value = '';
        if (deathPlaceInput) deathPlaceInput.value = '';
        if (notesInput) notesInput.value = '';

        // Snapshot original values (all empty for add)
        this.personModalSnapshot = {
            firstName: '', lastName: '', gender: 'male',
            birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', notes: '',
        };

        // Setup gender change listener for dynamic labels
        this.setupGenderChangeListener();
        // Setup date input styling
        this.setupDateInputs();
        // Setup expand button
        this.setupExpandButton(false);

        // Hide link-relationships button (new person has no relationships)
        const linkRelBtn = document.getElementById('link-relationships');
        if (linkRelBtn) linkRelBtn.style.display = 'none';

        modal.classList.add('active');
        firstNameInput.focus();

        // Setup Enter as Tab for form fields
        this.setupEnterAsTab('person-modal', ['input-firstname', 'input-lastname', 'input-gender', 'input-birthdate', 'input-birthplace', 'input-deathdate', 'input-deathplace'], () => this.savePerson());
    },

    /**
     * Setup Enter key to move to next field (like Tab), and submit on last field
     */
    setupEnterAsTab(modalId: string, fieldIds: string[], onSubmit: () => void): void {
        const fields = fieldIds.map(id => document.getElementById(id) as HTMLInputElement | HTMLSelectElement).filter(f => f);

        fields.forEach((field, index) => {
            field.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // Find next visible field
                    let nextIndex = index + 1;
                    while (nextIndex < fields.length) {
                        const nextField = fields[nextIndex];
                        // Check if field is visible (not in collapsed section)
                        if (nextField.offsetParent !== null) {
                            nextField.focus();
                            return;
                        }
                        nextIndex++;
                    }
                    // No more visible fields - submit
                    onSubmit();
                }
            };
        });
    },

    setupGenderChangeListener(): void {
        const genderSelect = document.getElementById('input-gender') as HTMLSelectElement;
        const lastnameLabel = document.getElementById('lastname-label');
        const lastnameInput = document.getElementById('input-lastname') as HTMLInputElement;
        if (!genderSelect || !lastnameLabel) return;

        const updateLastnameLabel = () => {
            const isFemale = genderSelect.value === 'female';
            lastnameLabel.textContent = isFemale
                ? strings.labels.maidenName
                : strings.labels.lastName;
            if (lastnameInput) {
                lastnameInput.placeholder = isFemale
                    ? strings.placeholders.maidenName
                    : strings.placeholders.lastName;
            }
        };

        genderSelect.onchange = updateLastnameLabel;
        updateLastnameLabel();
    },

    setupDateInputs(): void {
        // Flex-date text inputs: live validation (red border while the value
        // doesn't parse) + 'has-value' class for placeholder styling
        const dateInputs = document.querySelectorAll('.modal input[type="date"], .modal input.flex-date');
        dateInputs.forEach(input => {
            const dateInput = input as HTMLInputElement;
            const updateClass = () => {
                if (dateInput.value) {
                    dateInput.classList.add('has-value');
                } else {
                    dateInput.classList.remove('has-value');
                }
                if (dateInput.classList.contains('flex-date')) {
                    dateInput.classList.toggle('invalid', !isValidDateInput(dateInput.value));
                }
            };
            dateInput.addEventListener('change', updateClass);
            dateInput.addEventListener('input', updateClass);
            updateClass(); // Initial state
        });
    },

    setupExpandButton(hasExtendedData: boolean): void {
        const expandBtn = document.getElementById('expand-details');
        const extendedFields = document.getElementById('extended-fields');
        if (!expandBtn || !extendedFields) return;

        // Show expanded if there's existing data
        if (hasExtendedData) {
            expandBtn.classList.add('expanded');
            extendedFields.classList.add('visible');
        } else {
            expandBtn.classList.remove('expanded');
            extendedFields.classList.remove('visible');
        }

        expandBtn.onclick = () => {
            expandBtn.classList.toggle('expanded');
            extendedFields.classList.toggle('visible');
        };
    },

    showEditPersonModal(id: PersonId): void {
        const person = DataManager.getPerson(id);
        if (!person) return;

        this.currentId = id;
        const modal = document.getElementById('person-modal');
        const title = document.getElementById('modal-title');
        const deleteBtn = document.getElementById('btn-delete');
        const firstNameInput = document.getElementById('input-firstname') as HTMLInputElement;
        const lastNameInput = document.getElementById('input-lastname') as HTMLInputElement;
        const genderSelect = document.getElementById('input-gender') as HTMLSelectElement;
        const birthDateInput = document.getElementById('input-birthdate') as HTMLInputElement;
        const birthPlaceInput = document.getElementById('input-birthplace') as HTMLInputElement;
        const deathDateInput = document.getElementById('input-deathdate') as HTMLInputElement;
        const deathPlaceInput = document.getElementById('input-deathplace') as HTMLInputElement;
        const notesInput = document.getElementById('input-notes') as HTMLTextAreaElement;

        const mergeBtn = document.getElementById('btn-merge');

        if (!modal || !title || !deleteBtn || !firstNameInput || !lastNameInput || !genderSelect) return;

        title.textContent = person.isPlaceholder ? strings.personModal.completeTitle : strings.personModal.editTitle;
        deleteBtn.style.display = 'block';
        if (mergeBtn) mergeBtn.style.display = 'block';
        firstNameInput.value = person.isPlaceholder ? '' : person.firstName;
        lastNameInput.value = person.lastName;
        genderSelect.value = person.gender;

        // Extended info
        if (birthDateInput) birthDateInput.value = person.birthDate || '';
        if (birthPlaceInput) birthPlaceInput.value = person.birthPlace || '';
        if (deathDateInput) deathDateInput.value = person.deathDate || '';
        if (deathPlaceInput) deathPlaceInput.value = person.deathPlace || '';
        if (notesInput) notesInput.value = person.notes || '';

        // Snapshot original values for unsaved changes detection
        this.personModalSnapshot = {
            firstName: firstNameInput.value,
            lastName: lastNameInput.value,
            gender: genderSelect.value,
            birthDate: birthDateInput?.value || '',
            birthPlace: birthPlaceInput?.value || '',
            deathDate: deathDateInput?.value || '',
            deathPlace: deathPlaceInput?.value || '',
            notes: notesInput?.value || '',
        };

        // Setup gender change listener for dynamic labels
        this.setupGenderChangeListener();
        // Setup date input styling
        this.setupDateInputs();

        // Setup expand button - expand if there's death data or notes
        const hasExtendedData = !!(person.deathDate || person.deathPlace || person.notes);
        this.setupExpandButton(hasExtendedData);

        // Show link-relationships button
        const linkRelBtn = document.getElementById('link-relationships');
        if (linkRelBtn) {
            linkRelBtn.style.display = 'block';
            linkRelBtn.onclick = () => {
                // Setup dialog stack: person-modal -> relationships-modal
                this.clearDialogStack();
                this.pushDialog('person-modal');
                this.closeDialogById('person-modal');
                this.showRelationshipsPanel(id, true);  // Return to edit dialog when closing
                this.pushDialog('relationships-modal');
            };
        }

        // Lock handling: make form read-only if person is locked
        const saveBtn = document.getElementById('btn-save');
        if (DataManager.isPersonLocked(id)) {
            firstNameInput.readOnly = true;
            lastNameInput.readOnly = true;
            genderSelect.disabled = true;
            if (birthDateInput) birthDateInput.readOnly = true;
            if (birthPlaceInput) birthPlaceInput.readOnly = true;
            if (deathDateInput) deathDateInput.readOnly = true;
            if (deathPlaceInput) deathPlaceInput.readOnly = true;
            if (notesInput) notesInput.readOnly = true;
            if (saveBtn) saveBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
            if (mergeBtn) mergeBtn.style.display = 'none';
            if (linkRelBtn) linkRelBtn.style.display = 'none';
        }

        modal.classList.add('active');
        if (!DataManager.isPersonLocked(id)) firstNameInput.focus();

        // Setup Enter as Tab for form fields
        this.setupEnterAsTab('person-modal', ['input-firstname', 'input-lastname', 'input-gender', 'input-birthdate', 'input-birthplace', 'input-deathdate', 'input-deathplace'], () => this.savePerson());
    },

    savePerson(): void {
        const firstNameInput = document.getElementById('input-firstname') as HTMLInputElement;
        const lastNameInput = document.getElementById('input-lastname') as HTMLInputElement;
        const genderSelect = document.getElementById('input-gender') as HTMLSelectElement;
        const birthDateInput = document.getElementById('input-birthdate') as HTMLInputElement;
        const birthPlaceInput = document.getElementById('input-birthplace') as HTMLInputElement;
        const deathDateInput = document.getElementById('input-deathdate') as HTMLInputElement;
        const deathPlaceInput = document.getElementById('input-deathplace') as HTMLInputElement;
        const notesInput = document.getElementById('input-notes') as HTMLTextAreaElement;

        const firstName = firstNameInput?.value.trim() || '';
        const lastName = lastNameInput?.value.trim() || '';
        const gender = (genderSelect?.value || 'male') as Gender;
        const birthDate = normalizeDateInput(birthDateInput?.value || '');
        const birthPlace = birthPlaceInput?.value.trim() || '';
        const deathDate = normalizeDateInput(deathDateInput?.value || '');
        const deathPlace = deathPlaceInput?.value.trim() || '';
        const notes = notesInput?.value.trim() || '';

        if (birthDate === null || deathDate === null) {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showAlert(strings.personModal.invalidDate, 'warning');
            return;
        }

        if (!firstName && !lastName && !this.currentId) {
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showAlert(strings.personModal.enterName, 'warning');
            return;
        }

        if (this.currentId) {
            // Update existing
            DataManager.updatePerson(this.currentId, {
                firstName,
                lastName,
                gender,
                birthDate,
                birthPlace,
                deathDate,
                deathPlace,
                notes
            });
        } else {
            // Create new
            const newPerson = DataManager.createPerson({ firstName, lastName, gender });
            // Update with extended info if provided
            if (birthDate || birthPlace || deathDate || deathPlace || notes) {
                DataManager.updatePerson(newPerson.id, {
                    birthDate,
                    birthPlace,
                    deathDate,
                    deathPlace,
                    notes
                });
            }
        }

        this.forceCloseModal();
        TreeRenderer.render();
    },

    async confirmDelete(personId: PersonId, parentDialogId?: string): Promise<void> {
        const person = DataManager.getPerson(personId);
        if (!person) return;

        const name = person.firstName + (person.lastName ? ' ' + person.lastName : '');
        const birthYear = person.birthDate?.split('-')[0];

        // Setup dialog stack if there's a parent dialog
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
        }

        const confirmed = await this.showConfirm(strings.deleteConfirm.message(name, birthYear), strings.buttons.delete);

        if (confirmed) {
            DataManager.deletePerson(personId);
            if (parentDialogId) {
                document.getElementById(parentDialogId)?.classList.remove('active');
            }
            TreeRenderer.render();
        }
        // If not confirmed, parent dialog stays open (returnToParentDialog handles it)
    },

    async deletePerson(): Promise<void> {
        if (!this.currentId) return;
        await this.confirmDelete(this.currentId, 'person-modal');
        this.currentId = null;
    },

    mergePersonFromModal(): void {
        if (!this.currentId) return;
        const personId = this.currentId;
        // Setup dialog stack: person-modal -> person-merge-modal
        this.clearDialogStack();
        this.pushDialog('person-modal');
        this.closeDialogById('person-modal');
        this.pushDialog('person-merge-modal');
        // Keep currentId so we can return to edit modal
        this.showPersonMergeDialog(personId);
    },

    closeModal(): void {
        if (this.hasPersonModalChanges()) {
            this.showPersonUnsavedChangesDialog();
            return;
        }
        this.forceCloseModal();
    },

    forceCloseModal(): void {
        document.getElementById('person-modal')?.classList.remove('active');
        this.currentId = null;
        this.personModalSnapshot = null;
    },

    /**
     * Check if person modal form has unsaved changes compared to snapshot
     */
    hasPersonModalChanges(): boolean {
        if (!this.personModalSnapshot) return false;
        // Only check if the modal is actually visible
        const modal = document.getElementById('person-modal');
        if (!modal || !modal.classList.contains('active')) return false;

        const s = this.personModalSnapshot;
        const firstName = (document.getElementById('input-firstname') as HTMLInputElement)?.value || '';
        const lastName = (document.getElementById('input-lastname') as HTMLInputElement)?.value || '';
        const gender = (document.getElementById('input-gender') as HTMLSelectElement)?.value || 'male';
        const birthDate = (document.getElementById('input-birthdate') as HTMLInputElement)?.value || '';
        const birthPlace = (document.getElementById('input-birthplace') as HTMLInputElement)?.value || '';
        const deathDate = (document.getElementById('input-deathdate') as HTMLInputElement)?.value || '';
        const deathPlace = (document.getElementById('input-deathplace') as HTMLInputElement)?.value || '';
        const notes = (document.getElementById('input-notes') as HTMLTextAreaElement)?.value || '';

        return firstName !== s.firstName || lastName !== s.lastName || gender !== s.gender
            || birthDate !== s.birthDate || birthPlace !== s.birthPlace
            || deathDate !== s.deathDate || deathPlace !== s.deathPlace
            || notes !== s.notes;
    },

    /**
     * Show unsaved changes dialog for person modal
     */
    showPersonUnsavedChangesDialog(): void {
        const modal = document.getElementById('confirmation-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const buttonsEl = document.getElementById('confirm-buttons');
        const optionsEl = document.getElementById('confirm-options');

        if (!modal || !titleEl || !messageEl || !buttonsEl) return;

        modal.className = 'modal-overlay dialog-warning';
        titleEl.innerHTML = `<span class="dialog-icon">⚠️</span>${strings.relationships.unsavedTitle}`;
        messageEl.textContent = strings.personModal.unsavedMessage;
        if (optionsEl) optionsEl.innerHTML = '';

        buttonsEl.innerHTML = `
            <button class="secondary" id="confirm-stay-btn">${strings.relationships.unsavedStay}</button>
            <button class="secondary" id="confirm-discard-btn">${strings.relationships.unsavedDiscard}</button>
            <button class="primary" id="confirm-save-btn">${strings.relationships.unsavedSave}</button>
        `;

        const closeConfirm = () => { modal.classList.remove('active'); };

        document.getElementById('confirm-stay-btn')!.onclick = () => { closeConfirm(); };
        document.getElementById('confirm-discard-btn')!.onclick = () => { closeConfirm(); this.forceCloseModal(); };
        document.getElementById('confirm-save-btn')!.onclick = () => { closeConfirm(); this.savePerson(); };

        modal.onclick = (e) => { if (e.target === modal) closeConfirm(); };
        modal.classList.add('active');
    },
});
