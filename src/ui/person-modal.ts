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
import { isLivingPerson, inferBirthUpperBounds } from '../privacy.js';
import { compressPhoto, dataUrlByteSize, rotatePhotoDataUrl } from '../photo.js';
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
import { isValidDateInput, normalizeDateInput, formatDateForInput } from '../dates.js';

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
        const variantsClear = document.getElementById('input-name-variants') as HTMLInputElement | null;
        if (variantsClear) variantsClear.value = '';
        const refnClear = document.getElementById('input-refn') as HTMLInputElement | null;
        if (refnClear) refnClear.value = '';
        const questionClear = document.getElementById('input-question') as HTMLInputElement | null;
        if (questionClear) questionClear.value = '';
        const addDeceased = document.getElementById('input-is-deceased') as HTMLInputElement;
        if (addDeceased) addDeceased.checked = false;
        this.setPhotoPreview(undefined);

        this.applyAdvancedFieldVisibility(null);

        // Snapshot original values (all empty for add)
        this.personModalSnapshot = {
            firstName: '', lastName: '', gender: 'male',
            birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', notes: '',
            nameVariants: '', refn: '', question: '',
        };

        // Setup gender change listener for dynamic labels
        this.setupGenderChangeListener();
        // Setup date input styling
        this.setupDateInputs();
        // Setup expand button
        this.setupExpandButton(true);

        // Relationships need somebody to relate TO, which means a saved person —
        // so the button is not here while adding. The offer after Save is what
        // leads on to relatives (see savePerson).
        const linkRelBtn = document.getElementById('link-relationships');
        if (linkRelBtn) linkRelBtn.style.display = 'none';

        // Events, citations and attachments need a saved person — hide.
        const eventsSection = document.getElementById('events-section');
        if (eventsSection) eventsSection.style.display = 'none';
        const sourcesSection = document.getElementById('person-sources-section');
        if (sourcesSection) sourcesSection.style.display = 'none';
        const attachmentsSection = document.getElementById('attachments-section');
        if (attachmentsSection) attachmentsSection.style.display = 'none';

        modal.classList.add('active');
        firstNameInput.focus();

        // Duplicate suggestions (new-person mode only).
        this.initDuplicateSuggest('person');

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

    /**
     * The fields most people never touch. Sources, attachments, reference
     * numbers and name spellings are for working from archives; an open question
     * ("does anyone know when she was born?") is for the moment you send the file
     * to your aunt — a real flow, but not one you meet while writing down your
     * grandmother, who gets a note instead.
     *
     * The rule that matters: hiding only ever applies to an EMPTY field. A
     * person who HAS a source cited shows the sources section whatever the
     * setting says — hiding filled data would be the invisible-value bug again,
     * just with a switch on it.
     */
    applyAdvancedFieldVisibility(person: Person | null): void {
        const advanced = SettingsManager.isAdvancedFields();
        const filled: Record<string, boolean> = {
            'name-variants-group': !!person?.nameVariants?.length,
            'refn-group': !!person?.refn?.trim(),
            'question-group': !!person?.question?.trim(),
            'person-sources-section': !!person?.sourceIds?.length,
            'attachments-section': !!person?.attachments?.length,
        };
        for (const [id, hasValue] of Object.entries(filled)) {
            const el = document.getElementById(id);
            if (el) el.style.display = (advanced || hasValue) ? '' : 'none';
        }
    },

    /**
     * "More info" is for ADDING someone quickly — name, year, Save — so the rest
     * of the form starts out of the way. Editing shows everything: you opened
     * the record to look at it, and hunting for a collapsed section to find the
     * death date is not looking at it.
     *
     * It used to auto-expand when the person "had extended data", which meant a
     * hand-written list of every field behind it. Miss one and its value was
     * invisible until the user expanded by hand — which happened twice
     * (refn/question, then name variants). With editing always expanded, that
     * list has nothing to be wrong about.
     *
     * @param collapsible true while adding, false while editing
     */
    setupExpandButton(collapsible: boolean): void {
        const expandBtn = document.getElementById('expand-details');
        const extendedFields = document.getElementById('extended-fields');
        if (!expandBtn || !extendedFields) return;

        if (!collapsible) {
            expandBtn.style.display = 'none';
            extendedFields.classList.add('visible');
            return;
        }

        expandBtn.style.display = '';
        expandBtn.classList.remove('expanded');
        extendedFields.classList.remove('visible');
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

        // Extended info (dates shown in the locale's input form, e.g. 15.5.1880)
        if (birthDateInput) birthDateInput.value = formatDateForInput(person.birthDate);
        this.updateBirthEstimate(person);
        if (birthPlaceInput) birthPlaceInput.value = person.birthPlace || '';
        if (deathDateInput) deathDateInput.value = formatDateForInput(person.deathDate);
        if (deathPlaceInput) deathPlaceInput.value = person.deathPlace || '';
        if (notesInput) notesInput.value = person.notes || '';
        const variantsInput = document.getElementById('input-name-variants') as HTMLInputElement | null;
        if (variantsInput) variantsInput.value = (person.nameVariants ?? []).join(', ');
        const refnInput = document.getElementById('input-refn') as HTMLInputElement | null;
        if (refnInput) refnInput.value = person.refn || '';
        const questionInput = document.getElementById('input-question') as HTMLInputElement | null;
        if (questionInput) questionInput.value = person.question || '';

        // "Deceased" checkbox reflects the current (heuristic or explicit) status.
        const deceasedInput = document.getElementById('input-is-deceased') as HTMLInputElement;
        if (deceasedInput) {
            deceasedInput.checked = !isLivingPerson(
                person, new Date().getFullYear(), inferBirthUpperBounds(DataManager.getData()));
        }

        // Photo preview
        this.setPhotoPreview(person.photo);

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
            nameVariants: (document.getElementById('input-name-variants') as HTMLInputElement | null)?.value || '',
            refn: (document.getElementById('input-refn') as HTMLInputElement | null)?.value || '',
            question: (document.getElementById('input-question') as HTMLInputElement | null)?.value || '',
        };

        // Setup gender change listener for dynamic labels
        this.setupGenderChangeListener();
        // Setup date input styling
        this.setupDateInputs();

        // Editing shows the whole record — no list of fields to keep in sync.
        this.setupExpandButton(false);

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

        // Life events section: visible for existing persons, list rendered fresh.
        const eventsSection = document.getElementById('events-section');
        if (eventsSection) eventsSection.style.display = '';
        this.renderEventsList();

        // Sources/citations section (same lifecycle as events).
        const sourcesSection = document.getElementById('person-sources-section');
        if (sourcesSection) sourcesSection.style.display = '';
        const citeBtn = document.getElementById('btn-cite-person');
        if (citeBtn) citeBtn.style.display = DataManager.isPersonLocked(id) ? 'none' : '';
        this.renderPersonSourcesChips();

        // Attachments section (same lifecycle as events/sources).
        const attachmentsSection = document.getElementById('attachments-section');
        if (attachmentsSection) attachmentsSection.style.display = '';
        this.renderAttachmentsList();

        // LAST: the lines above switch sources/attachments on for edit mode, so
        // deciding what a research field should do has to come after them.
        this.applyAdvancedFieldVisibility(person);

        // Editing an existing person → no duplicate suggestions.
        this.disableDuplicateSuggest('person');

        modal.classList.add('active');
        if (!DataManager.isPersonLocked(id)) firstNameInput.focus();

        // Setup Enter as Tab for form fields
        this.setupEnterAsTab('person-modal', ['input-firstname', 'input-lastname', 'input-gender', 'input-birthdate', 'input-birthplace', 'input-deathdate', 'input-deathplace'], () => this.savePerson());
    },

    /**
     * K11: when a person has no birth date, show the latest-possible birth year
     * inferred from their other dates (death, events, wedding, children), with
     * a one-click "use" that fills the field as an approximate year.
     */
    updateBirthEstimate(person: import('../types.js').Person): void {
        const hint = document.getElementById('birthdate-estimate');
        if (!hint) return;
        if (person.birthDate) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
        const bounds = inferBirthUpperBounds(DataManager.getData());
        const year = bounds.get(person.id);
        if (year === undefined) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
        hint.style.display = '';
        hint.textContent = strings.personModal.birthEstimate(year) + ' ';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'field-hint-apply';
        btn.textContent = strings.personModal.birthEstimateApply;
        btn.onclick = () => {
            const input = document.getElementById('input-birthdate') as HTMLInputElement | null;
            if (input) { input.value = `~${year}`; input.dispatchEvent(new Event('input', { bubbles: true })); }
            hint.style.display = 'none';
        };
        hint.appendChild(btn);
    },

    /** Update the modal's photo preview, remove button and size label. */
    setPhotoPreview(dataUrl: string | undefined): void {
        const preview = document.getElementById('photo-preview');
        const removeBtn = document.getElementById('photo-remove-btn');
        const sizeEl = document.getElementById('photo-size');
        if (preview) {
            // Note: this slot's <img> IS the person's photo when saving, so
            // nothing decorative may be put here — it would be saved as theirs.
            preview.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : '';
        }
        if (removeBtn) removeBtn.style.display = dataUrl ? '' : 'none';
        for (const id of ['photo-rotate-left', 'photo-rotate-right']) {
            const b = document.getElementById(id);
            if (b) b.style.display = dataUrl ? '' : 'none';
        }
        if (sizeEl) sizeEl.textContent = dataUrl ? `${Math.round(dataUrlByteSize(dataUrl) / 1024)} kB` : '';
    },

    /** Rotate the previewed photo 90° (saved only when the modal is saved). */
    async rotatePersonPhoto(quarterTurns: number): Promise<void> {
        const img = document.querySelector('#photo-preview img') as HTMLImageElement | null;
        const current = img?.getAttribute('src');
        if (!current) return;
        try {
            this.setPhotoPreview(await rotatePhotoDataUrl(current, quarterTurns));
        } catch (e) {
            console.error('Photo rotate failed:', e);
        }
    },

    /** Compress the selected file and show it in the preview. */
    async handlePhotoInput(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';  // allow re-selecting the same file
        if (!file) return;
        try {
            const dataUrl = await compressPhoto(file);
            this.setPhotoPreview(dataUrl);
        } catch (e) {
            console.error('Photo processing failed:', e);
            this.showAlert(strings.personModal.photoError, 'error');
        }
    },

    removePersonPhoto(): void {
        this.setPhotoPreview(undefined);
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
        // Comma-separated in the field, a list in the data.
        const nameVariants = ((document.getElementById('input-name-variants') as HTMLInputElement | null)?.value ?? '')
            .split(',').map(v => v.trim()).filter(Boolean);
        const refn = (document.getElementById('input-refn') as HTMLInputElement | null)?.value.trim() || '';
        const question = (document.getElementById('input-question') as HTMLInputElement | null)?.value.trim() || '';
        // Explicit alive/deceased override; a death date already implies deceased.
        const deceasedChecked = (document.getElementById('input-is-deceased') as HTMLInputElement)?.checked || false;
        const isDeceased = deathDate ? undefined : deceasedChecked;
        // Current photo from the preview (data URL) or none.
        const photoImg = document.querySelector('#photo-preview img') as HTMLImageElement | null;
        const photo = photoImg?.getAttribute('src') || undefined;

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

        let createdFirstId: PersonId | null = null;

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
                notes,
                nameVariants,
                refn,
                question,
                isDeceased,
                photo
            });
        } else {
            // Create new
            const newPerson = DataManager.createPerson({ firstName, lastName, gender });
            // Update with extended info if provided
            if (birthDate || birthPlace || deathDate || deathPlace || notes || refn || question
                || photo || nameVariants.length > 0) {
                DataManager.updatePerson(newPerson.id, {
                    birthDate,
                    birthPlace,
                    deathDate,
                    deathPlace,
                    notes,
                    nameVariants,
                    refn,
                    question,
                    photo
                });
            }
            // A person added from the toolbar has no relatives yet — the form
            // cannot offer relationships, because there was nobody to relate
            // until Save. Rather than leaving them floating (the tree's own
            // statistics call that "linked to nobody"), offer the family wizard,
            // which is where relatives get added. Non-blocking, auto-dismisses.
            createdFirstId = newPerson.id;
        }

        this.forceCloseModal();
        TreeRenderer.render();
        // The toolbar picker caches the person list — without this, a person
        // added or renamed here is unfindable until an import or tree switch.
        this.refreshSearch();

        // After the very first person, offer to add the rest of the family — as
        // a non-blocking action toast, so it never interrupts other flows.
        if (createdFirstId) this.showFamilyOffer(createdFirstId);
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
            this.refreshSearch();
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
        const refn = (document.getElementById('input-refn') as HTMLInputElement)?.value || '';
        const question = (document.getElementById('input-question') as HTMLInputElement)?.value || '';

        return firstName !== s.firstName || lastName !== s.lastName || gender !== s.gender
            || birthDate !== s.birthDate || birthPlace !== s.birthPlace
            || deathDate !== s.deathDate || deathPlace !== s.deathPlace
            || notes !== s.notes || refn !== s.refn || question !== s.question;
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
