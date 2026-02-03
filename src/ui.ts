/**
 * UI - User interface logic and modals
 * Handles context menus, relation dialogs, and form interactions
 */

import { DataManager, auditPersonName } from './data.js';
import { TreeManager } from './tree-manager.js';
import { TreeRenderer } from './renderer.js';
import { ZoomPan } from './zoom.js';
import { TreePreview, TreeCompare } from './tree-preview.js';
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
} from './types.js';
import { strings } from './strings.js';
import { parseGedcom, convertToStrom, GedcomConversionResult } from './ged-parser.js';
import {
    validateJsonImport,
    ValidationResult,
    MergerUI,
    getCurrentMergeInfo,
    listMergeSessionsInfo,
    deleteMergeSession,
    renameMergeSession
} from './merge/index.js';
import { PersonPicker } from './person-picker.js';
import { AppExporter } from './export.js';
import { SettingsManager } from './settings.js';
import { ThemeMode, LanguageSetting, AppMode } from './types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from './crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from './validation.js';
import * as CrossTree from './cross-tree.js';
import { AuditLogManager } from './audit-log.js';

class UIClass {
    private currentId: PersonId | null = null;
    private relationContext: RelationContext | null = null;
    private contextMenu: HTMLElement | null = null;
    private contextMenuCloseHandler: ((e: Event) => void) | null = null;
    private linkMode = false;
    private gedcomResult: GedcomConversionResult | null = null;
    private saveCurrentCallback: (() => void) | null = null;
    private relationPicker: PersonPicker | null = null;
    private toolbarSearchPicker: PersonPicker | null = null;

    // Tree management state
    private renameTreeId: TreeId | null = null;
    private duplicateTreeId: TreeId | null = null;
    private mergeSourceTreeId: TreeId | null = null;
    private mergeTargetTreeId: TreeId | null = null;
    private importTreeData: StromData | null = null;
    private exportTargetTreeId: TreeId | null = null;
    private defaultPersonTreeId: TreeId | null = null;
    private defaultPersonPicker: PersonPicker | null = null;

    // Encryption state
    private passwordPromptCallback: ((password: string) => void) | null = null;
    private passwordPromptCallbackManagesDialog: boolean = false;  // If true, callback handles dialog close
    private exportPasswordCallback: ((password: string | null) => void) | null = null;
    private pendingEncryptedData: EncryptedData | null = null;
    private pendingEncryptedImport: EncryptedData | null = null;

    // Dialog stack for ESC navigation (child -> parent)
    private dialogStack: string[] = [];

    // Embedded mode state
    private appMode: AppMode = 'pwa';
    private lastExportTime: number = Date.now();
    private lastChangeTime: number = 0;

    // Track if import is coming from tree manager
    private importFromTreeManager: boolean = false;

    // Person modal: snapshot of original values for unsaved changes detection
    private personModalSnapshot: {
        firstName: string; lastName: string; gender: string;
        birthDate: string; birthPlace: string; deathDate: string; deathPlace: string;
    } | null = null;

    // ==================== CONTEXT MENU (NEW UX) ====================

    showContextMenu(personId: PersonId, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        // Remove existing menu
        this.hideContextMenu();

        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Check if in view mode (read-only)
        const isViewMode = DataManager.isViewMode();

        // Create context menu - show only non-editing actions in view mode
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        if (isViewMode) {
            // View mode: only Focus action
            menu.innerHTML = `
                <div class="context-menu-item" data-action="focus">
                    <span class="icon">&#127919;</span> ${strings.contextMenu.focus}
                </div>
            `;
        } else {
            // Normal mode: all actions
            menu.innerHTML = `
                <div class="context-menu-item" data-action="edit">
                    <span class="icon">&#9998;</span> ${strings.contextMenu.edit}
                </div>
                <div class="context-menu-item" data-action="focus">
                    <span class="icon">&#127919;</span> ${strings.contextMenu.focus}
                </div>
                <div class="context-menu-divider"></div>
                ${person.parentIds.length < 2 ? `
                <div class="context-menu-item" data-action="parent">
                    <span class="icon">&uarr;</span> ${strings.contextMenu.addParent}
                </div>
                ` : ''}
                <div class="context-menu-item" data-action="partner">
                    <span class="icon">&harr;</span> ${strings.contextMenu.addPartner}
                </div>
                <div class="context-menu-item" data-action="child">
                    <span class="icon">&darr;</span> ${strings.contextMenu.addChild}
                </div>
                <div class="context-menu-item" data-action="sibling">
                    <span class="icon">&#8596;</span> ${strings.contextMenu.addSibling}
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" data-action="merge">
                    <span class="icon">&#128279;</span> ${strings.personMerge.mergeWith}...
                </div>
                <div class="context-menu-item danger" data-action="delete">
                    <span class="icon">&#128465;</span> ${strings.contextMenu.delete}
                </div>
            `;
        }

        // Position menu near click (will be adjusted after DOM insert)
        const rect = (event.target as HTMLElement).closest('.person-card')?.getBoundingClientRect();
        let menuX = rect ? rect.right + 10 : event.clientX;
        let menuY = rect ? rect.top : event.clientY;
        menu.style.left = `${menuX}px`;
        menu.style.top = `${menuY}px`;

        // Add event listeners
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = (item as HTMLElement).dataset.action;
                this.hideContextMenu();

                switch (action) {
                    case 'edit':
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('person-modal');
                        this.showEditPersonModal(personId);
                        break;
                    case 'focus':
                        TreeRenderer.setFocus(personId);
                        break;
                    case 'parent':
                    case 'partner':
                    case 'child':
                    case 'sibling':
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('relation-modal');
                        this.addRelation(personId, action as RelationType);
                        break;
                    case 'merge':
                        // Setup stack for ESC handling
                        this.clearDialogStack();
                        this.pushDialog('person-merge-modal');
                        this.showPersonMergeDialog(personId);
                        break;
                    case 'delete':
                        this.confirmDelete(personId);
                        break;
                }
            });
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Adjust position to keep menu on screen
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 10;

            let newLeft = parseFloat(menu.style.left);
            let newTop = parseFloat(menu.style.top);

            // Check right edge - if menu overflows, position to left of card or screen edge
            if (menuRect.right > viewportWidth - padding) {
                if (rect) {
                    newLeft = rect.left - menuRect.width - 10;
                } else {
                    newLeft = viewportWidth - menuRect.width - padding;
                }
            }

            // Check left edge - ensure menu doesn't go off left side
            if (newLeft < padding) {
                newLeft = padding;
            }

            // Check bottom edge
            if (menuRect.bottom > viewportHeight - padding) {
                newTop = viewportHeight - menuRect.height - padding;
            }

            // Check top edge
            if (newTop < padding) {
                newTop = padding;
            }

            menu.style.left = `${newLeft}px`;
            menu.style.top = `${newTop}px`;
        });

        // Close menu when clicking/touching outside
        this.contextMenuCloseHandler = (e: Event) => {
            const target = e.target as Node;
            // Don't close if clicking inside the menu
            if (this.contextMenu && this.contextMenu.contains(target)) return;
            // Don't close if clicking on a person card (will open new menu)
            if ((target as Element).closest?.('.person-card')) return;
            this.hideContextMenu();
        };

        setTimeout(() => {
            // Capture phase ensures we get the event before other handlers
            document.addEventListener('mousedown', this.contextMenuCloseHandler!, true);
            document.addEventListener('touchstart', this.contextMenuCloseHandler!, true);
        }, 10);
    }

    private hideContextMenu(): void {
        // Remove event listeners
        if (this.contextMenuCloseHandler) {
            document.removeEventListener('mousedown', this.contextMenuCloseHandler, true);
            document.removeEventListener('touchstart', this.contextMenuCloseHandler, true);
            this.contextMenuCloseHandler = null;
        }
        // Remove menu element
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }

    // ==================== PERSON MODAL ====================

    showAddPersonModal(): void {
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

        const mergeBtn = document.getElementById('btn-merge');

        if (!modal || !title || !deleteBtn || !firstNameInput || !lastNameInput || !genderSelect) return;

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

        // Snapshot original values (all empty for add)
        this.personModalSnapshot = {
            firstName: '', lastName: '', gender: 'male',
            birthDate: '', birthPlace: '', deathDate: '', deathPlace: '',
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
    }

    /**
     * Setup Enter key to move to next field (like Tab), and submit on last field
     */
    private setupEnterAsTab(modalId: string, fieldIds: string[], onSubmit: () => void): void {
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
    }

    private setupGenderChangeListener(): void {
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
    }

    private setupDateInputs(): void {
        // Add/remove 'has-value' class on date inputs to control placeholder styling
        const dateInputs = document.querySelectorAll('.modal input[type="date"]');
        dateInputs.forEach(input => {
            const dateInput = input as HTMLInputElement;
            const updateClass = () => {
                if (dateInput.value) {
                    dateInput.classList.add('has-value');
                } else {
                    dateInput.classList.remove('has-value');
                }
            };
            dateInput.addEventListener('change', updateClass);
            updateClass(); // Initial state
        });
    }

    private setupExpandButton(hasExtendedData: boolean): void {
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
    }

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

        // Snapshot original values for unsaved changes detection
        this.personModalSnapshot = {
            firstName: firstNameInput.value,
            lastName: lastNameInput.value,
            gender: genderSelect.value,
            birthDate: birthDateInput?.value || '',
            birthPlace: birthPlaceInput?.value || '',
            deathDate: deathDateInput?.value || '',
            deathPlace: deathPlaceInput?.value || '',
        };

        // Setup gender change listener for dynamic labels
        this.setupGenderChangeListener();
        // Setup date input styling
        this.setupDateInputs();

        // Setup expand button - expand if there's death data (deathDate or deathPlace)
        const hasExtendedData = !!(person.deathDate || person.deathPlace);
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

        modal.classList.add('active');
        firstNameInput.focus();

        // Setup Enter as Tab for form fields
        this.setupEnterAsTab('person-modal', ['input-firstname', 'input-lastname', 'input-gender', 'input-birthdate', 'input-birthplace', 'input-deathdate', 'input-deathplace'], () => this.savePerson());
    }

    savePerson(): void {
        const firstNameInput = document.getElementById('input-firstname') as HTMLInputElement;
        const lastNameInput = document.getElementById('input-lastname') as HTMLInputElement;
        const genderSelect = document.getElementById('input-gender') as HTMLSelectElement;
        const birthDateInput = document.getElementById('input-birthdate') as HTMLInputElement;
        const birthPlaceInput = document.getElementById('input-birthplace') as HTMLInputElement;
        const deathDateInput = document.getElementById('input-deathdate') as HTMLInputElement;
        const deathPlaceInput = document.getElementById('input-deathplace') as HTMLInputElement;

        const firstName = firstNameInput?.value.trim() || '';
        const lastName = lastNameInput?.value.trim() || '';
        const gender = (genderSelect?.value || 'male') as Gender;
        const birthDate = birthDateInput?.value || '';
        const birthPlace = birthPlaceInput?.value.trim() || '';
        const deathDate = deathDateInput?.value || '';
        const deathPlace = deathPlaceInput?.value.trim() || '';

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
                deathPlace
            });
        } else {
            // Create new
            const newPerson = DataManager.createPerson({ firstName, lastName, gender });
            // Update with extended info if provided
            if (birthDate || birthPlace || deathDate || deathPlace) {
                DataManager.updatePerson(newPerson.id, {
                    birthDate,
                    birthPlace,
                    deathDate,
                    deathPlace
                });
            }
        }

        this.forceCloseModal();
        TreeRenderer.render();
    }

    private async confirmDelete(personId: PersonId, parentDialogId?: string): Promise<void> {
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
    }

    async deletePerson(): Promise<void> {
        if (!this.currentId) return;
        await this.confirmDelete(this.currentId, 'person-modal');
        this.currentId = null;
    }

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
    }

    closeModal(): void {
        if (this.hasPersonModalChanges()) {
            this.showPersonUnsavedChangesDialog();
            return;
        }
        this.forceCloseModal();
    }

    private forceCloseModal(): void {
        document.getElementById('person-modal')?.classList.remove('active');
        this.currentId = null;
        this.personModalSnapshot = null;
    }

    /**
     * Check if person modal form has unsaved changes compared to snapshot
     */
    private hasPersonModalChanges(): boolean {
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

        return firstName !== s.firstName || lastName !== s.lastName || gender !== s.gender
            || birthDate !== s.birthDate || birthPlace !== s.birthPlace
            || deathDate !== s.deathDate || deathPlace !== s.deathPlace;
    }

    /**
     * Show unsaved changes dialog for person modal
     */
    private showPersonUnsavedChangesDialog(): void {
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
    }

    // ==================== RELATION MODAL ====================

    addRelation(personId: PersonId, relationType: RelationType): void {
        const person = DataManager.getPerson(personId);
        if (!person) return;

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
    }

    private showRelationModal(): void {
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
        linkBtn.innerHTML = `&#128279; ${strings.relationModal.linkExisting}`;
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
                linkBtn.innerHTML = `&#128279; ${strings.relationModal.linkExisting}`;
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

        // Setup Enter as Tab for form fields (only when creating new person)
        this.setupEnterAsTab('relation-modal', ['rel-firstname', 'rel-lastname', 'rel-gender'], () => this.saveRelation());
    }

    /**
     * Initialize PersonPicker for relation modal
     */
    private initRelationPicker(): void {
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

            switch (relationType) {
                case 'partner':
                    return !currentPartnerIds.includes(p.id);
                case 'parent':
                    return !person.parentIds.includes(p.id);
                case 'child':
                    return !person.childIds.includes(p.id);
                default:
                    return true;
            }
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
    }

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
    }


    saveRelation(): void {
        if (!this.relationContext) return;

        const { personId, relationType } = this.relationContext;
        const person = DataManager.getPerson(personId);
        if (!person) return;

        // Read other parent from combo (for child relation type)
        let includePartner: PersonId | undefined;
        if (relationType === 'child') {
            const otherParentSelect = document.getElementById('rel-other-parent-select') as HTMLSelectElement;
            if (otherParentSelect) {
                const val = otherParentSelect.value;
                if (val === '__new_placeholder__') {
                    // Leave includePartner undefined — createRelationship() will create placeholder
                } else if (val) {
                    includePartner = val as PersonId;
                }
            }
        }

        let newPersonId: PersonId;

        if (this.linkMode) {
            // Link to existing person via PersonPicker
            const selectedId = this.relationPicker?.getValue();
            if (!selectedId) {
                this.clearDialogStack();
                this.pushDialog('relation-modal');
                this.showAlert(strings.relationModal.selectPersonError, 'warning');
                return;
            }
            newPersonId = selectedId;
        } else {
            // Create new person
            const firstName = (document.getElementById('rel-firstname') as HTMLInputElement)?.value.trim() || '';
            const lastName = (document.getElementById('rel-lastname') as HTMLInputElement)?.value.trim() || '';
            const gender = ((document.getElementById('rel-gender') as HTMLSelectElement)?.value || 'male') as Gender;
            const birthDate = (document.getElementById('rel-birthdate') as HTMLInputElement)?.value || undefined;
            const birthPlace = (document.getElementById('rel-birthplace') as HTMLInputElement)?.value.trim() || undefined;
            const deathDate = (document.getElementById('rel-deathdate') as HTMLInputElement)?.value || undefined;
            const deathPlace = (document.getElementById('rel-deathplace') as HTMLInputElement)?.value.trim() || undefined;

            // Begin batch before person creation to suppress individual audit logs
            AuditLogManager.beginBatch();

            const isPlaceholder = !firstName && !lastName;
            const newPerson = DataManager.createPerson(
                { firstName: isPlaceholder ? '?' : firstName, lastName, gender, birthDate, birthPlace, deathDate, deathPlace },
                isPlaceholder
            );
            newPersonId = newPerson.id;
        }

        // Create the relationship (endBatch is called inside)
        this.createRelationship(personId, newPersonId, relationType, includePartner);

        this.closeRelationModal();
        TreeRenderer.render();
        this.refreshSearch();

        // If relationships panel was open, refresh it (closeRelationModal already handled stack)
        if (this.relationshipsPanelPersonId) {
            this.refreshRelationshipsPanel();
        }
    }

    private createRelationship(personId: PersonId, newPersonId: PersonId, relationType: RelationType, includePartner?: PersonId): void {
        const person = DataManager.getPerson(personId);
        if (!person) return;

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
                if (includePartner) {
                    DataManager.addParentChild(personId, newPersonId);
                    DataManager.addParentChild(includePartner, newPersonId);
                    const partnership = DataManager.getPartnerships(personId)
                        .find(p => p.person1Id === includePartner || p.person2Id === includePartner);
                    if (partnership) {
                        DataManager.addParentChild(personId, newPersonId, partnership.id);
                    }
                } else {
                    const placeholderGender: Gender = person.gender === 'male' ? 'female' : 'male';
                    const placeholder = DataManager.createPerson({
                        firstName: '?',
                        lastName: '',
                        gender: placeholderGender
                    }, true);
                    const partnership = DataManager.createPartnership(personId, placeholder.id);
                    DataManager.addParentChild(personId, newPersonId);
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
                if (person.parentIds.length > 0) {
                    for (const parentId of person.parentIds) {
                        DataManager.addParentChild(parentId, newPersonId);
                    }
                    if (person.parentIds.length === 2) {
                        const partnership = DataManager.getPartnerships(person.parentIds[0])
                            .find(p => p.person1Id === person.parentIds[1] || p.person2Id === person.parentIds[1]);
                        if (partnership) {
                            DataManager.addParentChild(person.parentIds[0], newPersonId, partnership.id);
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
    }

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
    }

    /**
     * Toggle between link existing person and create new person modes
     */
    private toggleLinkMode(): void {
        const linkBtn = document.getElementById('toggle-link-mode');
        if (linkBtn) {
            linkBtn.click();
        }
    }

    closeConfirmModal(): void {
        document.getElementById('confirmation-modal')?.classList.remove('active');
        this.relationContext = null;
    }

    // ==================== CUSTOM DIALOGS ====================

    private dialogResolve: ((value: boolean) => void) | null = null;

    /**
     * Show a custom alert dialog (replacement for native alert())
     * @param message The message to display
     * @param type Dialog type: 'info', 'warning', 'error'
     * @param title Optional custom title
     */
    showAlert(message: string, type: 'info' | 'warning' | 'error' = 'info', title?: string): Promise<void> {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmation-modal');
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const buttonsEl = document.getElementById('confirm-buttons');
            const optionsEl = document.getElementById('confirm-options');

            if (!modal || !titleEl || !messageEl || !buttonsEl) {
                resolve();
                return;
            }

            // Set dialog type class
            modal.className = 'modal-overlay dialog-' + type;

            // Set icon based on type
            const icons = { info: 'ℹ️', warning: '⚠️', error: '❌' };
            const titles = {
                info: strings.dialog.info,
                warning: strings.dialog.warning,
                error: strings.dialog.error
            };

            titleEl.innerHTML = `<span class="dialog-icon">${icons[type]}</span>${title || titles[type]}`;
            messageEl.textContent = message;

            // Hide options (not used for alert)
            if (optionsEl) optionsEl.innerHTML = '';

            // Show only OK button
            buttonsEl.innerHTML = `
                <button class="primary" id="confirm-ok-btn">${strings.buttons.ok}</button>
            `;

            const okBtn = document.getElementById('confirm-ok-btn');
            if (okBtn) {
                okBtn.onclick = () => {
                    modal.classList.remove('active');
                    this.returnToParentDialog();
                    resolve();
                };
            }

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');
        });
    }

    /**
     * Show a custom confirm dialog (replacement for native confirm())
     * @param message The message to display
     * @param title Optional custom title
     * @param options Optional button labels { ok?: string, cancel?: string }
     */
    showConfirm(message: string, title?: string, options?: { ok?: string; cancel?: string }): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmation-modal');
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const buttonsEl = document.getElementById('confirm-buttons');
            const optionsEl = document.getElementById('confirm-options');

            if (!modal || !titleEl || !messageEl || !buttonsEl) {
                resolve(false);
                return;
            }

            // Set dialog type class
            modal.className = 'modal-overlay dialog-confirm';

            titleEl.innerHTML = `<span class="dialog-icon">❓</span>${title || strings.dialog.confirm}`;
            messageEl.textContent = message;

            // Hide options (not used for simple confirm)
            if (optionsEl) optionsEl.innerHTML = '';

            // Show Cancel and OK buttons
            const cancelLabel = options?.cancel || strings.buttons.cancel;
            const okLabel = options?.ok || strings.buttons.yes;

            buttonsEl.innerHTML = `
                <button class="secondary" id="confirm-cancel-btn">${cancelLabel}</button>
                <button class="primary" id="confirm-ok-btn">${okLabel}</button>
            `;

            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const okBtn = document.getElementById('confirm-ok-btn');

            // Helper to close and return to parent
            const closeAndReturn = () => {
                modal.classList.remove('active');
                this.returnToParentDialog();
            };

            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    closeAndReturn();
                    resolve(false);
                };
            }

            if (okBtn) {
                okBtn.onclick = () => {
                    modal.classList.remove('active');
                    this.returnToParentDialog();
                    resolve(true);
                };
            }

            // Also close on overlay click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    closeAndReturn();
                    resolve(false);
                }
            };

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');
        });
    }

    /**
     * Show prompt dialog with input field
     */
    showPrompt(message: string, defaultValue?: string): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmation-modal');
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const buttonsEl = document.getElementById('confirm-buttons');
            const optionsEl = document.getElementById('confirm-options');

            if (!modal || !titleEl || !messageEl || !buttonsEl) {
                resolve(null);
                return;
            }

            // Set dialog type class
            modal.className = 'modal-overlay dialog-prompt';

            titleEl.innerHTML = `<span class="dialog-icon">✏️</span>${strings.dialog.confirm}`;
            messageEl.textContent = message;

            // Add input field in options area
            if (optionsEl) {
                optionsEl.innerHTML = `
                    <input type="text" id="prompt-input" class="prompt-input" value="${this.escapeHtml(defaultValue || '')}">
                `;
            }

            // Show Cancel and OK buttons
            buttonsEl.innerHTML = `
                <button class="secondary" id="confirm-cancel-btn">${strings.buttons.cancel}</button>
                <button class="primary" id="confirm-ok-btn">${strings.buttons.save}</button>
            `;

            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const okBtn = document.getElementById('confirm-ok-btn');
            const inputEl = document.getElementById('prompt-input') as HTMLInputElement;

            // Helper to close and return to parent
            const closeAndReturn = () => {
                modal.classList.remove('active');
                this.returnToParentDialog();
            };

            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    closeAndReturn();
                    resolve(null);
                };
            }

            if (okBtn) {
                okBtn.onclick = () => {
                    const value = inputEl?.value?.trim() || null;
                    modal.classList.remove('active');
                    this.returnToParentDialog();
                    resolve(value);
                };
            }

            // Handle enter key
            if (inputEl) {
                inputEl.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        okBtn?.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelBtn?.click();
                    }
                };
            }

            // Also close on overlay click
            modal.onclick = (e) => {
                if (e.target === modal) {
                    closeAndReturn();
                    resolve(null);
                }
            };

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');

            // Focus input
            setTimeout(() => inputEl?.select(), 50);
        });
    }

    // ==================== RELATIONSHIPS PANEL ====================

    private relationshipsPanelPersonId: PersonId | null = null;
    private returnToEditPersonId: PersonId | null = null;  // Track if we should return to edit dialog

    // Pending changes for relationships (not saved until user clicks Save)
    private pendingPartnershipChanges: Map<PartnershipId, {
        status?: PartnershipStatus;
        startDate?: string;
        startPlace?: string;
        endDate?: string;
        note?: string;
        isPrimary?: boolean;
    }> = new Map();

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
            .filter((p): p is import('./types.js').Person => p !== null);

        const partners = DataManager.getPartners(personId);
        const children = person.childIds
            .map(id => DataManager.getPerson(id))
            .filter((p): p is import('./types.js').Person => p !== null);

        const siblings = DataManager.getSiblings(personId);

        content.innerHTML = `
            ${this.buildRelSection('parents', strings.relationships.parents, parents, personId, person.parentIds.length < 2)}
            ${this.buildRelSection('partners', strings.relationships.partners, partners, personId, true)}
            ${this.buildRelSection('children', strings.relationships.children, children, personId, true)}
            ${this.buildRelSection('siblings', strings.relationships.siblings, siblings, personId, true)}
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
                this.setPendingPartnershipChange(partnershipId, { startDate: target.value });
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
                this.setPendingPartnershipChange(partnershipId, { endDate: target.value });
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
    }

    private buildRelSection(type: string, title: string, persons: import('./types.js').Person[], currentPersonId: PersonId, canAdd: boolean): string {
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
                            <input type="date" class="partnership-start-date"
                                data-partnership-id="${partnership.id}"
                                value="${partnership.startDate || ''}"
                                title="${startDateLabel}">
                            <input type="text" class="partnership-start-place"
                                data-partnership-id="${partnership.id}"
                                value="${partnership.startPlace || ''}"
                                placeholder="${strings.labels.startPlace}">
                            <input type="date" class="partnership-end-date"
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
                    <button class="rel-remove-btn" data-rel-type="${relType[type]}" data-rel-id="${p.id}">
                        ${strings.relationships.remove}
                    </button>
                </div>
                ${partnershipDetailsHtml}
            `;
        }).join('');

        return `
            <div class="rel-section">
                <div class="rel-section-title">${title}</div>
                ${items || `<div style="color: var(--text-light); font-size: 13px; padding: 8px 0;">—</div>`}
                ${canAdd ? `<button class="rel-add-btn" data-rel-type="${relType[type]}">${addBtnText[type]}</button>` : ''}
            </div>
        `;
    }

    private async removeRelationship(personId: PersonId, relatedId: PersonId, type: 'parent' | 'partner' | 'child' | 'sibling'): Promise<void> {
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
    }

    /**
     * Check if a person has no remaining relationships (orphan)
     */
    private isOrphan(person: Person): boolean {
        return person.parentIds.length === 0
            && person.childIds.length === 0
            && person.partnerships.length === 0;
    }

    /**
     * Helper to set pending partnership change (merges with existing pending changes)
     */
    private setPendingPartnershipChange(partnershipId: PartnershipId, changes: {
        status?: PartnershipStatus;
        startDate?: string;
        startPlace?: string;
        endDate?: string;
        note?: string;
        isPrimary?: boolean;
    }): void {
        const existing = this.pendingPartnershipChanges.get(partnershipId) || {};
        this.pendingPartnershipChanges.set(partnershipId, { ...existing, ...changes });
    }

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
    }

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
    }

    /**
     * Show unsaved changes confirmation dialog
     */
    private showUnsavedChangesDialog(): void {
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
    }

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
    }

    /**
     * Refresh relationships panel after structural change, preserving pending changes
     */
    private refreshRelationshipsPanel(): void {
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
    }

    /**
     * Apply pending partnership changes back to form elements after a refresh
     */
    private applyPendingToForm(partnershipId: PartnershipId, changes: {
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
    }

    // ==================== PARTNER SELECTION DIALOG ====================

    /**
     * Show a dialog to select from multiple hidden partners
     * Uses the confirmation modal for consistency
     */
    showPartnerSelectionDialog(personId: PersonId, partners: import('./types.js').Person[]): void {
        const person = DataManager.getPerson(personId);
        if (!person) return;

        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        const options = document.getElementById('confirm-options');
        const confirmBtn = document.getElementById('confirm-ok-btn');

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
                <input type="radio" name="partner-select" value="${partner.id}">
                <span>${this.escapeHtml(partner.firstName)} ${this.escapeHtml(partner.lastName)} ${birthYear ? `(${birthYear})` : ''}</span>
            `;
            opt.onclick = () => {
                options.querySelectorAll('.confirm-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                (opt.querySelector('input') as HTMLInputElement).checked = true;
            };
            options.appendChild(opt);
        }

        // Setup confirm button
        confirmBtn.onclick = () => {
            const selected = options.querySelector('input:checked') as HTMLInputElement;
            if (selected) {
                const partnerId = selected.value as PersonId;
                TreeRenderer.setFocus(partnerId);
            }
            modal.classList.remove('active');
        };

        modal.classList.add('active');
    }

    // ==================== ABOUT DIALOG ====================

    showAboutDialog(): void {
        const modal = document.getElementById('about-modal');
        if (!modal) return;

        // Set version
        const versionEl = document.getElementById('about-version');
        if (versionEl) {
            versionEl.textContent = '1.0';
        }

        // Calculate and display stats
        this.updateAboutStats();

        // Update storage info
        this.updateAboutStorage();

        modal.classList.add('active');
    }

    private updateAboutStats(): void {
        const persons = DataManager.getAllPersons();
        const partnerships = DataManager.getAllPartnerships();

        // Count persons (excluding placeholders)
        const realPersons = persons.filter(p => !p.isPlaceholder);
        const men = realPersons.filter(p => p.gender === 'male').length;
        const women = realPersons.filter(p => p.gender === 'female').length;

        // Count families (partnerships)
        const families = partnerships.length;

        // Calculate generations
        const generations = this.calculateMaxGenerations(persons);

        // Find oldest person (by birth year)
        const oldest = this.findOldestPerson(realPersons);

        // Get current tree name
        const activeTree = TreeManager.getActiveTreeMetadata();
        const treeName = activeTree?.name || '-';

        // Update tree name
        const treeNameEl = document.getElementById('stat-tree-name');
        if (treeNameEl) treeNameEl.textContent = treeName;

        // Update compact stats row for current tree
        const statsRow = document.getElementById('about-stats-row');
        if (statsRow) {
            const parts = [
                `${realPersons.length} persons`,
                `${men}♂ ${women}♀`,
                `${families} families`,
                `${generations} gen`
            ];
            if (oldest !== '-') {
                parts.push(`since ${oldest}`);
            }
            statsRow.textContent = parts.join(' • ');
        }

        // Calculate and update aggregate stats across all trees
        this.updateAboutTotalStats();
    }

    /**
     * Calculate and display aggregate statistics across all trees
     */
    private updateAboutTotalStats(): void {
        const trees = TreeManager.getTrees();
        const totalStatsRow = document.getElementById('about-stats-total-row');
        const totalStatsSection = document.getElementById('about-stats-total');

        // Hide total stats if only one tree
        if (totalStatsSection) {
            totalStatsSection.style.display = trees.length > 1 ? 'block' : 'none';
        }

        if (!totalStatsRow || trees.length <= 1) return;

        let totalPersons = 0;
        let totalMen = 0;
        let totalWomen = 0;
        let totalFamilies = 0;

        for (const tree of trees) {
            const treeData = TreeManager.getTreeData(tree.id);
            if (!treeData) continue;

            const persons = Object.values(treeData.persons).filter(p => !p.isPlaceholder);
            totalPersons += persons.length;
            totalMen += persons.filter(p => p.gender === 'male').length;
            totalWomen += persons.filter(p => p.gender === 'female').length;
            totalFamilies += Object.keys(treeData.partnerships).length;
        }

        const parts = [
            `${trees.length} ${strings.about.stats.trees}`,
            `${totalPersons} ${strings.about.stats.persons.toLowerCase()}`,
            `${totalMen}♂ ${totalWomen}♀`,
            `${totalFamilies} ${strings.about.stats.families.toLowerCase()}`
        ];

        totalStatsRow.textContent = parts.join(' • ');
    }

    private calculateMaxGenerations(persons: import('./types.js').Person[]): number {
        if (persons.length === 0) return 0;

        // Find a root person (someone without parents)
        const roots = persons.filter(p => p.parentIds.length === 0 && !p.isPlaceholder);
        if (roots.length === 0) return 1;

        // BFS to find max depth
        let maxDepth = 0;
        const visited = new Set<PersonId>();

        const getDepth = (personId: PersonId, depth: number): number => {
            if (visited.has(personId)) return depth;
            visited.add(personId);

            const person = DataManager.getPerson(personId);
            if (!person) return depth;

            let maxChildDepth = depth;
            for (const childId of person.childIds) {
                const childDepth = getDepth(childId, depth + 1);
                maxChildDepth = Math.max(maxChildDepth, childDepth);
            }
            return maxChildDepth;
        };

        for (const root of roots) {
            const depth = getDepth(root.id, 1);
            maxDepth = Math.max(maxDepth, depth);
        }

        return maxDepth;
    }

    private findOldestPerson(persons: import('./types.js').Person[]): string {
        let oldestYear = Infinity;
        let oldestName = '-';

        for (const person of persons) {
            if (person.birthDate) {
                const year = parseInt(person.birthDate.split('-')[0], 10);
                if (year && year < oldestYear) {
                    oldestYear = year;
                    oldestName = `${year}`;
                }
            }
        }

        return oldestName;
    }

    closeAboutDialog(): void {
        document.getElementById('about-modal')?.classList.remove('active');
    }

    // ==================== SETTINGS DIALOG ====================

    showSettingsDialog(): void {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;

        // Set current theme selection
        const currentTheme = SettingsManager.getTheme();
        const themeRadios = modal.querySelectorAll<HTMLInputElement>('input[name="theme"]');
        themeRadios.forEach(radio => {
            radio.checked = radio.value === currentTheme;
        });

        // Set current language selection
        const currentLanguage = SettingsManager.getLanguage();
        const languageRadios = modal.querySelectorAll<HTMLInputElement>('input[name="language"]');
        languageRadios.forEach(radio => {
            radio.checked = radio.value === currentLanguage;
        });

        // Set current encryption state
        const encryptionToggle = document.getElementById('encryption-toggle') as HTMLInputElement;
        const encryptionStatus = document.getElementById('encryption-status');
        if (encryptionToggle) {
            encryptionToggle.checked = SettingsManager.isEncryptionEnabled();
        }
        if (encryptionStatus) {
            encryptionStatus.textContent = SettingsManager.isEncryptionEnabled()
                ? strings.encryption.encryptionEnabled
                : strings.encryption.encryptionDisabled;
        }

        // Set current audit log state
        const auditLogToggle = document.getElementById('audit-log-toggle') as HTMLInputElement;
        const auditLogStatus = document.getElementById('audit-log-status');
        if (auditLogToggle) {
            auditLogToggle.checked = AuditLogManager.isEnabled();
        }
        if (auditLogStatus) {
            auditLogStatus.textContent = AuditLogManager.isEnabled()
                ? strings.auditLog.enabled
                : strings.auditLog.disabled;
        }

        modal.classList.add('active');
    }

    closeSettingsDialog(): void {
        document.getElementById('settings-modal')?.classList.remove('active');
    }

    setTheme(theme: ThemeMode): void {
        SettingsManager.setTheme(theme);
    }

    setLanguage(language: LanguageSetting): void {
        SettingsManager.setLanguage(language);
        // Refresh UI to update all strings
        this.initializeStrings();
        // Refresh dynamically created components
        this.initSearch();
        this.updateTreeSwitcher();
        this.updateEncryptionStatus();
        TreeRenderer.render();
    }

    // ==================== EXPORT/IMPORT DIALOGS ====================

    showExportDialog(treeId?: TreeId, parentDialogId?: string): void {
        this.exportTargetTreeId = treeId || TreeManager.getActiveTreeId();

        // Show/hide Export Focus button - only available for active tree
        const exportFocusBtn = document.getElementById('export-focus-btn');
        if (exportFocusBtn) {
            const isActiveTree = this.exportTargetTreeId === TreeManager.getActiveTreeId();
            exportFocusBtn.style.display = isActiveTree ? '' : 'none';
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('export-modal');

        document.getElementById('export-modal')?.classList.add('active');
    }

    /**
     * Show export dialog from Tree Manager (uses dialog stack for ESC to return)
     */
    showExportDialogFromManager(treeId: TreeId): void {
        this.showExportDialog(treeId, 'tree-manager-modal');
    }

    closeExportDialog(): void {
        document.getElementById('export-modal')?.classList.remove('active');
        this.exportTargetTreeId = null;
        this.returnToParentDialog();
    }

    /**
     * Get the current export target tree ID
     */
    getExportTargetTreeId(): TreeId | null {
        return this.exportTargetTreeId || TreeManager.getActiveTreeId();
    }

    /**
     * Export target tree as JSON
     * Shows password dialog for optional encryption
     */
    async exportTargetTreeJSON(): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }

        this.closeExportDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            await DataManager.exportTreeJSON(treeId, password);
        });
    }

    /**
     * Export target tree as standalone App
     * Shows password dialog for optional encryption
     */
    async exportTargetTreeApp(): Promise<void> {
        const treeId = this.getExportTargetTreeId();
        if (!treeId) {
            this.closeExportDialog();
            return;
        }

        this.closeExportDialog();

        // Show export password dialog
        this.showExportPasswordDialog(async (password: string | null) => {
            const { AppExporter } = await import('./export.js');
            await AppExporter.exportApp(treeId, password);
        });
    }

    /**
     * Export target tree as GEDCOM file
     */
    async exportTargetTreeGedcom(): Promise<void> {
        const { exportToGedcom } = await import('./ged-exporter.js');
        const treeId = this.getExportTargetTreeId();
        const data = treeId ? TreeManager.getTreeData(treeId) : null;
        const metadata = treeId ? TreeManager.getTreeMetadata(treeId) : null;

        if (!data) {
            this.closeExportDialog();
            return;
        }

        const result = exportToGedcom(data, metadata?.name);

        // Download file
        const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata?.name || 'family-tree'}.ged`;
        a.click();
        URL.revokeObjectURL(url);

        this.closeExportDialog();
    }

    /**
     * Export current tree as App (from Save Current dialog)
     * Shows password dialog for optional encryption
     */
    async exportCurrentTreeApp(): Promise<void> {
        this.closeSaveCurrentDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const { AppExporter } = await import('./export.js');
            await AppExporter.exportApp(undefined, password);
        });
    }

    /**
     * Export all trees as App (from Export All dialog)
     * Shows password dialog for optional encryption
     */
    async exportAllTreesApp(): Promise<void> {
        this.closeExportAllDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const { AppExporter } = await import('./export.js');
            await AppExporter.exportAllAsApp(password);
        });
    }

    /**
     * Export focused data as JSON (from main export dialog)
     */
    async exportFocusedJSON(): Promise<void> {
        this.closeExportDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const visibleIds = TreeRenderer.getVisiblePersonIds();
            await DataManager.exportFocusedJSON(visibleIds, password);
        });
    }

    /**
     * Export focused data as JSON (from focus export dialog)
     */
    async exportFocusedJSONFromDialog(): Promise<void> {
        this.closeExportFocusDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const visibleIds = TreeRenderer.getVisiblePersonIds();
            await DataManager.exportFocusedJSON(visibleIds, password);
        });
    }

    showImportDialog(): void {
        document.getElementById('import-modal')?.classList.add('active');
    }

    closeImportDialog(): void {
        document.getElementById('import-modal')?.classList.remove('active');
    }

    // ==================== MOBILE MENU ====================

    toggleMobileMenu(): void {
        const menu = document.getElementById('mobile-menu');
        menu?.classList.toggle('active');
    }

    closeMobileMenu(): void {
        document.getElementById('mobile-menu')?.classList.remove('active');
    }

    // ==================== KEYBOARD SHORTCUTS ====================

    initKeyboard(): void {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Check if merge modal is open - it handles its own escape
                const mergeModal = document.getElementById('merge-modal');
                if (mergeModal?.classList.contains('active')) {
                    // Merge modal has its own escape handler
                    return;
                }

                // Special check for relation-modal in link mode (regardless of stack state)
                const relationModal = document.getElementById('relation-modal');
                if (relationModal?.classList.contains('active') && this.linkMode) {
                    // First close any open PersonPicker dropdown
                    this.relationPicker?.hide();
                    // Toggle back to create mode
                    this.toggleLinkMode();
                    return;
                }

                // Handle dialog stack - return to parent dialog
                if (this.dialogStack.length > 0) {
                    const currentDialog = this.dialogStack[this.dialogStack.length - 1];

                    // Intercept Escape for relationships-modal to check pending changes
                    if (currentDialog === 'relationships-modal' && this.pendingPartnershipChanges.size > 0) {
                        this.showUnsavedChangesDialog();
                        return;
                    }

                    // Special handling for relation-modal
                    if (currentDialog === 'relation-modal') {
                        this.closeRelationModal();
                        return;
                    }

                    // Special handling for person-merge-modal: closePersonMergeDialog handles stack and parent
                    if (currentDialog === 'person-merge-modal') {
                        this.closePersonMergeDialog();
                        return;
                    }

                    this.dialogStack.pop();

                    this.closeDialogById(currentDialog);

                    // Special handling for relationships-modal: use closeRelationshipsPanel for proper cleanup
                    if (currentDialog === 'relationships-modal') {
                        // Don't re-close (already closed above), but do the cleanup
                        this.pendingPartnershipChanges.clear();
                        const returnToId = this.returnToEditPersonId;
                        this.relationshipsPanelPersonId = null;
                        this.returnToEditPersonId = null;
                        if (this.dialogStack.length > 0) {
                            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
                            if (returnToId && parentDialog === 'person-modal') {
                                this.openDialogById(parentDialog);
                            }
                            this.dialogStack = [];
                        }
                        return;
                    }

                    // Reopen parent if exists
                    if (this.dialogStack.length > 0) {
                        const parentDialog = this.dialogStack[this.dialogStack.length - 1];
                        this.openDialogById(parentDialog);
                    }
                    return;
                }

                // Close all dialogs (fallback for dialogs not in stack)
                // Check for unsaved relationship changes before closing
                if (this.relationshipsPanelPersonId && this.pendingPartnershipChanges.size > 0) {
                    this.showUnsavedChangesDialog();
                    return;
                }
                // Check for unsaved person modal changes before closing
                if (this.hasPersonModalChanges()) {
                    this.showPersonUnsavedChangesDialog();
                    return;
                }
                this.forceCloseModal();
                this.closeRelationModal();
                this.closeConfirmModal();
                this.closeRelationshipsPanel();
                this.closeAboutDialog();
                this.closeSettingsDialog();
                this.closeExportDialog();
                this.closeImportDialog();
                this.closeMobileMenu();
                this.hideContextMenu();
                this.closeGedcomResultDialog();
                this.closeSaveCurrentDialog();
                this.closeValidationDialog();
                this.closePendingMergeDialog();
                this.closeNewTreeMenu();
                this.closeExportAllDialog();
                this.closeExportFocusDialog();
                this.closeDefaultPersonDialog();
                this.closeTreeManagerDialog();
                this.closePersonMergeDialog();
            }
        });
    }

    /**
     * Close dialog by ID
     */
    private closeDialogById(dialogId: string | undefined): void {
        if (!dialogId) return;
        document.getElementById(dialogId)?.classList.remove('active');
    }

    /**
     * Open dialog by ID
     */
    private openDialogById(dialogId: string | undefined): void {
        if (!dialogId) return;
        document.getElementById(dialogId)?.classList.add('active');
    }

    /**
     * Push dialog to stack (for nested dialogs)
     */
    pushDialog(dialogId: string): void {
        this.dialogStack.push(dialogId);
    }

    /**
     * Clear dialog stack
     */
    private clearDialogStack(): void {
        this.dialogStack = [];
    }

    // ==================== GEDCOM IMPORT ====================

    handleGedcomFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const gedcom = parseGedcom(content);
                this.gedcomResult = convertToStrom(gedcom);
                this.showGedcomResultDialog();
            } catch (error) {
                this.showAlert(strings.gedcom.parseError, 'error');
                console.error('GEDCOM parse error:', error);
            }
        };
        reader.readAsText(file);

        // Reset input so same file can be re-imported
        input.value = '';
    }

    private showGedcomResultDialog(): void {
        if (!this.gedcomResult) return;

        const modal = document.getElementById('gedcom-result-modal');
        if (!modal) return;

        // Handle dialog stack - if from tree manager, keep it in stack
        if (this.importFromTreeManager) {
            // tree-manager is already in stack from startGedcomImportFromManager
            this.pushDialog('gedcom-result-modal');
        } else if (this.importToCurrentTree) {
            this.pushDialog('gedcom-result-modal');
        }

        // Update stats
        const personsEl = document.getElementById('gedcom-stat-persons');
        const partnershipsEl = document.getElementById('gedcom-stat-partnerships');
        const skippedEl = document.getElementById('gedcom-stat-skipped');

        if (personsEl) personsEl.textContent = String(this.gedcomResult.stats.totalPersons);
        if (partnershipsEl) partnershipsEl.textContent = String(this.gedcomResult.stats.totalPartnerships);
        if (skippedEl) skippedEl.textContent = String(this.gedcomResult.stats.skippedPersons);

        // Show/hide buttons based on context
        const newTreeBtn = document.getElementById('gedcom-new-tree-btn');
        const mergeBtn = document.getElementById('gedcom-merge-btn');
        const saveJsonBtn = document.getElementById('gedcom-save-json-btn');
        const insertBtn = document.getElementById('gedcom-insert-btn');

        if (this.importToCurrentTree) {
            // Importing to current tree (from empty state) - show only "Insert into tree"
            if (newTreeBtn) newTreeBtn.style.display = 'none';
            if (mergeBtn) mergeBtn.style.display = 'none';
            if (saveJsonBtn) saveJsonBtn.style.display = 'none';
            if (insertBtn) insertBtn.style.display = '';
        } else if (this.importFromTreeManager) {
            // From tree manager "New Tree" - only "Import as New Tree" and "Save as JSON"
            // Merge is available via tree manager's "Merge into..." action
            if (newTreeBtn) newTreeBtn.style.display = '';
            if (mergeBtn) mergeBtn.style.display = 'none';
            if (saveJsonBtn) saveJsonBtn.style.display = '';
            if (insertBtn) insertBtn.style.display = 'none';
        } else {
            // Normal import - show standard options
            if (newTreeBtn) newTreeBtn.style.display = '';
            if (mergeBtn) mergeBtn.style.display = '';
            if (saveJsonBtn) saveJsonBtn.style.display = '';
            if (insertBtn) insertBtn.style.display = 'none';
        }

        modal.classList.add('active');
    }

    closeGedcomResultDialog(): void {
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        if (this.importFromTreeManager) {
            this.returnToParentDialog();
            this.importFromTreeManager = false;
        }
    }

    downloadGedcomAsJson(): void {
        if (!this.gedcomResult) return;

        const dataStr = JSON.stringify(this.gedcomResult.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree.json';
        a.click();
        URL.revokeObjectURL(a.href);

        this.closeGedcomResultDialog();
    }

    importGedcomAsNewTree(): void {
        if (!this.gedcomResult) return;

        // Check if importing directly to current tree (from empty state)
        if (this.importToCurrentTree) {
            this.importToCurrentTree = false;
            // Close gedcom result dialog
            document.getElementById('gedcom-result-modal')?.classList.remove('active');
            this.clearDialogStack();
            // Load data directly into current tree
            DataManager.loadStromData(this.gedcomResult.data);
            TreeRenderer.render();
            this.showToast(strings.buttons.importComplete);
            this.gedcomResult = null;
            return;
        }

        // Save flag before close (which resets it)
        const fromManager = this.importFromTreeManager;

        // Close gedcom result but don't return to parent yet
        document.getElementById('gedcom-result-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove gedcom-result-modal

        // Show import tree dialog with parent preserved
        this.showImportTreeDialog(this.gedcomResult.data, strings.treeManager.importTreeName, fromManager);
        this.gedcomResult = null;
    }

    /**
     * Merge GEDCOM data with existing tree
     */
    mergeGedcomWithExisting(): void {
        if (!this.gedcomResult) return;

        // Start merge process
        MergerUI.startMerge(this.gedcomResult.data);
        this.gedcomResult = null;
        this.closeGedcomResultDialog();
    }

    // ==================== VALIDATION DIALOG ====================

    /**
     * Show validation errors/warnings dialog
     */
    showValidationDialog(result: ValidationResult, onContinue?: () => void): void {
        const modal = document.getElementById('validation-modal');
        const content = document.getElementById('validation-content');
        const continueBtn = document.getElementById('validation-continue-btn');

        if (!modal || !content || !continueBtn) return;

        let html = '';

        // Show errors
        if (result.errors.length > 0) {
            html += `
                <div class="validation-section">
                    <div class="validation-section-title errors">
                        ❌ ${strings.validation.errors} (${result.errors.length})
                    </div>
                    ${result.errors.map(err => `
                        <div class="validation-item">${this.formatValidationMessage(err)}</div>
                    `).join('')}
                </div>
            `;
        }

        // Show warnings
        if (result.warnings.length > 0) {
            html += `
                <div class="validation-section">
                    <div class="validation-section-title warnings">
                        ⚠️ ${strings.validation.warnings} (${result.warnings.length})
                    </div>
                    ${result.warnings.map(warn => `
                        <div class="validation-item">${this.formatValidationMessage(warn)}</div>
                    `).join('')}
                </div>
            `;
        }

        content.innerHTML = html;

        // Show continue button only if there are no errors (only warnings)
        if (result.errors.length === 0 && onContinue) {
            continueBtn.style.display = 'block';
            continueBtn.onclick = () => {
                this.closeValidationDialog();
                onContinue();
            };
        } else {
            continueBtn.style.display = 'none';
        }

        modal.classList.add('active');
    }

    closeValidationDialog(): void {
        document.getElementById('validation-modal')?.classList.remove('active');
    }

    private formatValidationMessage(code: string): string {
        // Parse error code: type:detail1:detail2
        const parts = code.split(':');
        const type = parts[0];
        const detail = parts.slice(1).join(':');

        switch (type) {
            case 'parseError':
                return strings.validation.parseError;
            case 'invalidStructure':
                return strings.validation.invalidStructure;
            case 'missingPersons':
                return strings.validation.missingPersons;
            case 'missingPersonId':
            case 'missingFirstName':
            case 'missingLastName':
            case 'invalidGender':
                return `${strings.validation.missingField}: ${detail || type}`;
            case 'invalidParentRef':
            case 'invalidChildRef':
            case 'invalidPartnershipRef':
                return `${strings.validation.invalidReference}: ${detail}`;
            case 'missingHeader':
                return strings.validation.missingGedcomHeader;
            case 'noIndividuals':
                return strings.validation.noIndividuals;
            case 'invalidLine':
                return `${strings.validation.invalidLine}: ${detail}`;
            case 'noVersion':
                return strings.validation.noVersion;
            case 'olderVersion':
                return strings.validation.olderVersion?.replace('{0}', detail) || `Older version: ${detail}`;
            case 'newerVersion':
                return strings.validation.newerVersion?.replace('{0}', detail) || `Newer version: ${detail}`;
            default:
                return code;
        }
    }

    // ==================== JSON IMPORT WITH VALIDATION ====================

    /**
     * Handle JSON file import with validation
     */
    handleJsonFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target?.result as string;

            // Try to parse JSON first
            let parsed: unknown;
            try {
                parsed = JSON.parse(content);
            } catch {
                this.showValidationDialog({ valid: false, errors: ['validation.invalidJson'], warnings: [] });
                return;
            }

            // Check if data is encrypted
            const { isEncrypted } = await import('./crypto.js');
            if (isEncrypted(parsed)) {
                // Store encrypted data and show password prompt
                this.handleEncryptedJsonImport(parsed);
                return;
            }

            // Not encrypted - validate normally
            const result = validateJsonImport(content);

            if (!result.valid) {
                this.showValidationDialog(result);
                return;
            }

            if (result.warnings.length > 0) {
                // Show warnings with option to continue
                this.showValidationDialog(result, () => {
                    this.processJsonImport(result.data!);
                });
            } else {
                // No issues, proceed
                this.processJsonImport(result.data!);
            }
        };
        reader.readAsText(file);

        // Reset input
        input.value = '';
    }

    private processJsonImport(data: StromData): void {
        // Check if importing directly to current tree (from empty state)
        if (this.importToCurrentTree) {
            this.importToCurrentTree = false;
            this.closeImportDialog();
            // Load data directly into current tree
            DataManager.loadStromData(data);
            TreeRenderer.render();
            this.showToast(strings.buttons.importComplete);
            return;
        }

        // Always import as new tree
        const fromManager = this.importFromTreeManager;
        this.closeImportDialog();
        this.showImportTreeDialog(data, strings.treeManager.importTreeName, fromManager);
    }

    /**
     * Handle encrypted JSON import - show password prompt with retry
     */
    private handleEncryptedJsonImport(encryptedData: EncryptedData): void {
        this.pendingEncryptedImport = encryptedData;
        this.showEncryptedImportPrompt();
    }

    /**
     * Show password prompt for encrypted import
     */
    private showEncryptedImportPrompt(): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');

        if (!modal || !input) return;

        // Clear fields but keep modal behind tree manager
        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        // Set callback for this specific import - callback manages dialog
        this.passwordPromptCallback = async (password: string) => {
            await this.tryDecryptImport(password);
        };
        this.passwordPromptCallbackManagesDialog = true;

        modal.classList.add('active');
        input.focus();
    }

    /**
     * Try to decrypt and import with given password
     */
    private async tryDecryptImport(password: string): Promise<void> {
        if (!this.pendingEncryptedImport) return;

        const error = document.getElementById('password-prompt-error');

        try {
            const { decrypt } = await import('./crypto.js');
            const decrypted = await decrypt(this.pendingEncryptedImport, password);

            // Success - close dialog and reset flag
            document.getElementById('password-prompt-modal')?.classList.remove('active');
            this.passwordPromptCallbackManagesDialog = false;
            this.pendingEncryptedImport = null;

            // Validate decrypted content
            const result = validateJsonImport(decrypted);

            if (!result.valid) {
                this.showValidationDialog(result);
                return;
            }

            if (result.warnings.length > 0) {
                this.showValidationDialog(result, () => {
                    this.processJsonImport(result.data!);
                });
            } else {
                this.processJsonImport(result.data!);
            }
        } catch {
            // Wrong password - show error and keep dialog open
            if (error) {
                error.textContent = strings.encryption.wrongPassword;
                error.style.display = 'block';
            }
            // Clear input for retry
            const input = document.getElementById('password-prompt-input') as HTMLInputElement;
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    }

    // ==================== SAVE CURRENT DATA DIALOG ====================

    showSaveCurrentDialog(onContinue: () => void): void {
        const modal = document.getElementById('save-current-modal');
        const continueBtn = document.getElementById('save-current-continue-btn');
        if (!modal || !continueBtn) return;

        this.saveCurrentCallback = onContinue;

        continueBtn.onclick = () => {
            this.closeSaveCurrentDialog();
            if (this.saveCurrentCallback) {
                this.saveCurrentCallback();
                this.saveCurrentCallback = null;
            }
        };

        modal.classList.add('active');
    }

    closeSaveCurrentDialog(): void {
        document.getElementById('save-current-modal')?.classList.remove('active');
        this.saveCurrentCallback = null;
    }

    // ==================== SEARCH ====================

    initSearch(): void {
        const container = document.getElementById('toolbar-search-picker');
        if (!container) return;

        // Destroy existing picker if any
        if (this.toolbarSearchPicker) {
            this.toolbarSearchPicker.destroy();
        }

        this.toolbarSearchPicker = new PersonPicker({
            containerId: 'toolbar-search-picker',
            onSelect: (personId) => {
                TreeRenderer.setFocus(personId);
                ZoomPan.centerOnPerson(personId);
                ZoomPan.highlightPerson(personId);
                // Clear picker after selection
                this.toolbarSearchPicker?.clear();
            },
            placeholder: strings.search.placeholder,
            filter: (p) => !p.isPlaceholder
        });
    }

    /**
     * Refresh toolbar search picker (e.g., after data import)
     */
    refreshSearch(): void {
        this.initSearch();
    }

    /**
     * Handle search results from URL parameter
     */
    handleSearchResults(results: import('./types.js').Person[], query: string): void {
        if (results.length === 0) {
            // No results - show info
            this.showAlert(`${strings.search.noResults}: "${query}"`, 'info');
        } else if (results.length === 1) {
            // Single result - auto focus and center
            TreeRenderer.setFocus(results[0].id);
            // Need to wait for render to complete before centering
            setTimeout(() => {
                ZoomPan.centerOnPerson(results[0].id);
                ZoomPan.highlightPerson(results[0].id);
            }, 100);
        } else {
            // Multiple results - show selection modal
            this.showSearchResultsModal(results, query);
        }
    }

    private showSearchResultsModal(results: import('./types.js').Person[], _query: string): void {
        // Use confirmation modal for search results
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        const options = document.getElementById('confirm-options');
        const confirmBtn = document.getElementById('confirm-ok-btn');

        if (!modal || !title || !message || !options || !confirmBtn) return;

        title.textContent = strings.search.multipleResults;
        message.textContent = strings.search.selectPerson;

        // Build options from results
        options.innerHTML = '';
        for (const person of results.slice(0, 10)) {  // Max 10 in modal
            const birthYear = person.birthDate?.split('-')[0] || '';
            const opt = document.createElement('div');
            opt.className = 'confirm-option';
            opt.innerHTML = `
                <input type="radio" name="search-result" value="${person.id}">
                <span>${this.escapeHtml(person.firstName)} ${this.escapeHtml(person.lastName)} ${birthYear ? `(${birthYear})` : ''}</span>
            `;
            opt.onclick = () => {
                options.querySelectorAll('.confirm-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                (opt.querySelector('input') as HTMLInputElement).checked = true;
            };
            options.appendChild(opt);
        }

        // Setup confirm button
        confirmBtn.onclick = () => {
            const selected = options.querySelector('input:checked') as HTMLInputElement;
            if (selected) {
                const personId = selected.value as PersonId;
                TreeRenderer.setFocus(personId);
                setTimeout(() => {
                    ZoomPan.centerOnPerson(personId);
                    ZoomPan.highlightPerson(personId);
                }, 100);
            }
            modal.classList.remove('active');
        };

        modal.classList.add('active');
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // ==================== PENDING MERGES ====================

    /**
     * Check for pending merges and show dialog if found
     */
    checkPendingMerges(): void {
        const currentMerge = getCurrentMergeInfo();
        const savedSessions = listMergeSessionsInfo();

        if (!currentMerge && savedSessions.length === 0) {
            return;
        }

        this.showPendingMergeDialog();
    }

    /**
     * Show pending merge dialog
     */
    showPendingMergeDialog(): void {
        const modal = document.getElementById('pending-merge-modal');
        const list = document.getElementById('pending-merge-list');
        if (!modal || !list) return;

        const currentMerge = getCurrentMergeInfo();
        const savedSessions = listMergeSessionsInfo();

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
    }

    /**
     * Close pending merge dialog
     */
    closePendingMergeDialog(): void {
        document.getElementById('pending-merge-modal')?.classList.remove('active');
    }

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
    }

    /**
     * Discard a pending merge
     */
    discardPendingMerge(sessionId: string): void {
        if (sessionId === 'current') {
            MergerUI.discardCurrentMerge();
        } else {
            MergerUI.discardSavedMerge(sessionId);
        }

        // Refresh the list
        const currentMerge = getCurrentMergeInfo();
        const savedSessions = listMergeSessionsInfo();

        if (!currentMerge && savedSessions.length === 0) {
            this.closePendingMergeDialog();
        } else {
            this.showPendingMergeDialog();
        }
    }

    /**
     * Resume pending merge from tree manager
     */
    resumePendingMergeFromManager(sessionId: string): void {
        this.closeTreeManagerDialog();
        MergerUI.resumeSavedMerge(sessionId, true); // true = opened from tree manager
    }

    /**
     * Discard pending merge from tree manager
     */
    async discardPendingMergeFromManager(sessionId: string, displayName: string): Promise<void> {
        this.pushDialog('tree-manager-modal');
        const confirmed = await this.showConfirm(`${strings.merge.discard} "${displayName}"?`);
        if (!confirmed) return;

        deleteMergeSession(sessionId);
        this.updateTreeManagerList();
    }

    /**
     * Rename pending merge from tree manager
     */
    async renamePendingMergeFromManager(sessionId: string, currentName: string): Promise<void> {
        this.pushDialog('tree-manager-modal');
        const newName = await this.showPrompt(strings.treeManager.rename, currentName);
        if (!newName) return;

        renameMergeSession(sessionId, newName);
        this.updateTreeManagerList();
    }

    // ==================== PERSON MERGE (DUPLICATE RESOLUTION) ====================

    private personMergeKeepId: PersonId | null = null;
    private personMergePicker: PersonPicker | null = null;
    private personMergeOtherId: PersonId | null = null;
    private personMergeFieldResolutions: Map<string, 'keep' | 'other'> = new Map();
    private personMergePartnershipResolutions: Map<PartnershipId, 'merge' | 'keep_both'> = new Map();

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
    }

    /**
     * Update merge preview when a person is selected
     */
    private updatePersonMergePreview(otherId: PersonId): void {
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
    }

    /**
     * Detect field conflicts between two persons
     */
    private detectFieldConflicts(keep: Person, other: Person): Array<{ field: string; keepValue: string; otherValue: string }> {
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
    }

    /**
     * Detect partnership conflicts (both persons have partnership with same person)
     */
    private detectPartnershipConflicts(keepPerson: { id: PersonId; partnerships: PartnershipId[] }, otherPerson: { id: PersonId; partnerships: PartnershipId[] }): Array<{
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
    }

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
    }

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
    }

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
            TreeRenderer.render();
        } else {
            this.showAlert('Merge failed', 'error');
        }
    }

    // ==================== STRING INITIALIZATION ====================

    initializeStrings(): void {
        // Helper to get nested property from strings object
        const getString = (path: string): string => {
            const parts = path.split('.');
            let value: unknown = strings;
            for (const part of parts) {
                if (value && typeof value === 'object' && part in value) {
                    value = (value as Record<string, unknown>)[part];
                } else {
                    console.warn(`String not found: ${path}`);
                    return path;
                }
            }
            return typeof value === 'string' ? value : path;
        };

        // Set text content for data-i18n elements
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = getString(key);
            }
        });

        // Set placeholder for data-i18n-placeholder elements
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key && el instanceof HTMLInputElement) {
                el.placeholder = getString(key);
            }
        });

        // Set title for data-i18n-title elements
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key && el instanceof HTMLElement) {
                el.title = getString(key);
            }
        });
    }

    /**
     * Public helper to get localized string
     */
    getString(path: string): string {
        const parts = path.split('.');
        let value: unknown = strings;
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = (value as Record<string, unknown>)[part];
            } else {
                return path;
            }
        }
        return typeof value === 'string' ? value : path;
    }

    // ==================== TOAST NOTIFICATIONS ====================

    /**
     * Show a toast notification
     */
    showToast(message: string, duration = 3000): void {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-hide
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ==================== TREE SWITCHER ====================

    /**
     * Initialize tree switcher
     */
    initTreeSwitcher(): void {
        this.updateTreeSwitcher();

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('tree-switcher-dropdown');
            const btn = document.querySelector('.tree-switcher-btn');
            if (dropdown?.classList.contains('active') &&
                !dropdown.contains(e.target as Node) &&
                !btn?.contains(e.target as Node)) {
                dropdown.classList.remove('active');
            }
        });
    }

    /**
     * Update tree switcher display
     */
    updateTreeSwitcher(): void {
        const nameEl = document.getElementById('current-tree-name');
        const dropdown = document.getElementById('tree-switcher-dropdown');

        // View mode: show embedded trees
        if (DataManager.isViewMode()) {
            const embeddedTrees = DataManager.getEmbeddedTrees();
            const currentName = DataManager.getCurrentEmbeddedTreeName();

            if (nameEl) {
                nameEl.textContent = currentName || '...';
            }

            if (dropdown) {
                let html = '';

                // Show embedded trees (only if more than one)
                if (embeddedTrees.length > 1) {
                    for (const tree of embeddedTrees) {
                        html += `
                            <div class="tree-switcher-item ${tree.isActive ? 'active' : ''}"
                                 onclick="window.Strom.UI.switchEmbeddedTree('${tree.id}')">
                                <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                                ${tree.isActive ? '<span class="tree-item-check">✓</span>' : ''}
                            </div>
                        `;
                    }
                } else if (embeddedTrees.length === 1) {
                    // Single tree - just show it as active (no click handler needed)
                    html += `
                        <div class="tree-switcher-item active">
                            <span class="tree-item-name">${this.escapeHtml(embeddedTrees[0].name)}</span>
                            <span class="tree-item-check">✓</span>
                        </div>
                    `;
                }

                // Divider and actions (hidden by CSS in view mode, but include for consistency)
                html += `
                    <div class="tree-switcher-divider"></div>
                    <div class="tree-switcher-action" onclick="window.Strom.UI.showTreeManagerDialog()">
                        <span>⚙</span> ${strings.treeManager.manageTreesTitle}...
                    </div>
                `;

                dropdown.innerHTML = html;
            }
            return;
        }

        // Normal mode: show storage trees
        const activeTree = TreeManager.getActiveTreeMetadata();
        if (nameEl) {
            nameEl.textContent = activeTree?.name || '...';
        }

        if (!dropdown) return;

        // Use getVisibleTrees() to exclude hidden trees from switcher
        const trees = TreeManager.getVisibleTrees();
        const activeId = TreeManager.getActiveTreeId();

        let html = '';

        // Tree list (only visible trees)
        for (const tree of trees) {
            const isActive = tree.id === activeId;
            html += `
                <div class="tree-switcher-item ${isActive ? 'active' : ''}"
                     onclick="window.Strom.UI.switchToTree('${tree.id}')">
                    <span class="tree-item-name">${this.escapeHtml(tree.name)}</span>
                    ${isActive ? '<span class="tree-item-check">✓</span>' : ''}
                </div>
            `;
        }

        // Divider and actions
        html += `
            <div class="tree-switcher-divider"></div>
            <div class="tree-switcher-action" onclick="window.Strom.UI.showTreeManagerDialog()">
                <span>⚙</span> ${strings.treeManager.manageTreesTitle}...
            </div>
        `;

        dropdown.innerHTML = html;
    }

    /**
     * Toggle tree switcher dropdown
     */
    toggleTreeSwitcher(): void {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('active');
            if (dropdown.classList.contains('active')) {
                this.updateTreeSwitcher();
            }
        }
    }

    /**
     * Switch to a different tree
     */
    async switchToTree(treeId: string): Promise<void> {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        dropdown?.classList.remove('active');

        if (await DataManager.switchTreeAsync(treeId as TreeId)) {
            this.updateTreeSwitcher();
            // Restore focus from per-tree session state (uses tree's defaultPersonId setting)
            TreeRenderer.restoreFromSession();
            TreeRenderer.render();
            this.refreshSearch();

            // Center view on focused person
            setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);

            // Update URL with tree parameter (enables refresh persistence and bookmarking)
            this.updateUrlTreeParam(treeId);
        }
    }

    /**
     * Update URL with tree slug parameter without page reload
     * Also clears search parameter as the person may not exist in the new tree
     */
    private updateUrlTreeParam(treeId: string): void {
        const treeSlug = TreeManager.getTreeSlug(treeId as TreeId);
        if (!treeSlug) return;

        const url = new URL(window.location.href);
        url.searchParams.set('tree', treeSlug);
        url.searchParams.delete('search');
        history.replaceState(null, '', url.toString());
    }

    /**
     * Switch to a different embedded tree (view mode only)
     */
    switchEmbeddedTree(treeId: string): void {
        const dropdown = document.getElementById('tree-switcher-dropdown');
        dropdown?.classList.remove('active');

        if (DataManager.switchEmbeddedTree(treeId)) {
            this.updateTreeSwitcher();
            TreeRenderer.render();
            this.refreshSearch();

            // Center view on first person
            setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
        }
    }

    // ==================== TREE MANAGER DIALOG ====================

    /**
     * Show tree manager dialog
     */
    showTreeManagerDialog(): void {
        const modal = document.getElementById('tree-manager-modal');
        if (!modal) return;

        // Listen for merge session changes to refresh list
        const refreshHandler = () => this.updateTreeManagerList();
        window.addEventListener('strom:merge-session-changed', refreshHandler);

        // Clean up listener when modal closes
        const closeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'class' && !modal.classList.contains('active')) {
                    window.removeEventListener('strom:merge-session-changed', refreshHandler);
                    closeObserver.disconnect();
                }
            }
        });
        closeObserver.observe(modal, { attributes: true });

        this.updateTreeManagerList();
        this.updateStorageDisplay();
        modal.classList.add('active');
    }

    /**
     * Close tree manager dialog
     */
    closeTreeManagerDialog(): void {
        document.getElementById('tree-manager-modal')?.classList.remove('active');
        this.clearDialogStack();
    }

    /**
     * Update tree manager list
     */
    private updateTreeManagerList(): void {
        const list = document.getElementById('tree-manager-list');
        if (!list) return;

        const trees = TreeManager.getTrees();
        const activeId = TreeManager.getActiveTreeId();

        // Get storage info to show size per tree
        const storageInfo = TreeManager.getStorageUsage();
        const treeSizes = new Map(storageInfo.trees.map(t => [t.id, t.size]));

        let html = '';
        for (const tree of trees) {
            const isActive = tree.id === activeId;

            // Get tree data for additional stats
            const treeData = TreeManager.getTreeData(tree.id);
            const familyCount = treeData ? Object.keys(treeData.partnerships).length : 0;

            // Get tree size
            const treeSize = treeSizes.get(tree.id) || 0;
            const treeSizeFormatted = TreeManager.formatBytes(treeSize);

            // Get default person setting
            const defaultPersonSetting = treeData?.defaultPersonId;
            let defaultPersonDisplay = '';

            if (defaultPersonSetting === LAST_FOCUSED) {
                defaultPersonDisplay = `⭐ ${strings.treeManager.defaultPersonLastFocused}`;
            } else if (defaultPersonSetting && treeData?.persons[defaultPersonSetting]) {
                const person = treeData.persons[defaultPersonSetting];
                const birthYear = person.birthDate ? person.birthDate.split('-')[0] : '';
                const name = `${person.firstName} ${person.lastName}`.trim();
                defaultPersonDisplay = birthYear ? `⭐ ${name} (*${birthYear})` : `⭐ ${name}`;
            }
            // If undefined, don't show anything (first person is implicit default)

            // Visibility toggle button - icon shows current state, text shows action
            const visibilityIcon = tree.isHidden ? '🚫' : '👁';
            const visibilityLabel = tree.isHidden ? strings.treeManager.showTree : strings.treeManager.hideTree;
            const visibilityHint = tree.isHidden ? strings.treeManager.showTreeHint : strings.treeManager.hideTreeHint;

            const hiddenLabel = tree.isHidden ? ` <span style="color:var(--text-light);font-weight:normal">${strings.treeManager.hiddenLabel}</span>` : '';

            html += `
                <div class="tree-manager-item ${isActive ? 'active' : ''} ${tree.isHidden ? 'hidden-tree' : ''}">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator"></span>
                        <span class="tree-manager-item-name">${this.escapeHtml(tree.name)}${hiddenLabel}</span>
                        <span class="tree-manager-item-stats">
                            ${tree.personCount} ${strings.treeManager.persons} • ${familyCount} ${strings.treeManager.families}
                            ${defaultPersonDisplay ? ` • ${this.escapeHtml(defaultPersonDisplay)}` : ''}
                        </span>
                        <span class="tree-manager-item-size">${treeSizeFormatted}</span>
                    </div>
                    <div class="tree-manager-item-actions">
                        <button onclick="window.Strom.UI.showTreeStatsDialog('${tree.id}', 'tree-manager-modal')" title="${strings.treeManager.stats}"><span class="btn-icon">📊</span><span class="btn-text">${strings.treeManager.stats}</span></button>
                        <button onclick="window.Strom.UI.showTreeValidationDialog('${tree.id}', 'tree-manager-modal')" title="${strings.treeManager.validate}"><span class="btn-icon">✅</span><span class="btn-text">${strings.treeManager.validate}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.toggleTreeVisibility('${tree.id}')" title="${visibilityHint}"><span class="btn-icon">${visibilityIcon}</span><span class="btn-text">${visibilityLabel}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.showRenameTreeDialog('${tree.id}', 'tree-manager-modal')" title="${strings.treeManager.rename}"><span class="btn-icon">✏️</span><span class="btn-text">${strings.treeManager.rename}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.showDefaultPersonDialog('${tree.id}', 'tree-manager-modal')" title="${strings.treeManager.defaultPerson}"><span class="btn-icon">⭐</span><span class="btn-text">${strings.treeManager.defaultPerson}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.duplicateTree('${tree.id}')" title="${strings.treeManager.duplicate}"><span class="btn-icon">⧉</span><span class="btn-text">${strings.treeManager.duplicate}</span></button>
                        <button onclick="window.Strom.UI.showExportDialogFromManager('${tree.id}')" title="${strings.treeManager.export}"><span class="btn-icon">💾</span><span class="btn-text">${strings.treeManager.export}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.showMergeTreesDialog('${tree.id}', 'tree-manager-modal')" title="${strings.treeManager.mergeInto}"><span class="btn-icon">🔀</span><span class="btn-text">${strings.treeManager.mergeInto}</span></button>
                        ${AuditLogManager.isEnabled() || AuditLogManager.hasEntries(tree.id) ? `<button onclick="window.Strom.UI.showAuditLogDialog('${tree.id}', 'tree-manager-modal')" title="${strings.auditLog.viewLog}"><span class="btn-icon">📋</span><span class="btn-text">${strings.auditLog.viewLog}</span></button>` : ''}
                        <button class="danger edit-only" onclick="window.Strom.UI.confirmDeleteTree('${tree.id}')" title="${strings.treeManager.delete}"><span class="btn-icon">❌</span><span class="btn-text">${strings.treeManager.delete}</span></button>
                    </div>
                </div>
            `;
        }

        // Add pending merge sessions
        const pendingMerges = listMergeSessionsInfo();
        for (const session of pendingMerges) {
            const date = new Date(session.savedAt).toLocaleString();

            // Display name - use incomingFileName or generate from tree names
            const displayName = session.incomingFileName
                || (session.sourceTreeName && session.targetTreeName
                    ? `${session.targetTreeName} + ${session.sourceTreeName}`
                    : strings.merge.pendingMergeLabel);

            // Stats info showing source/target trees
            const mergeInfo = session.sourceTreeName && session.targetTreeName
                ? strings.merge.pendingMergeInto(session.sourceTreeName, session.targetTreeName)
                : '';
            const conflictsInfo = session.stats.conflicts > 0
                ? ` • ${strings.merge.pendingMergeConflicts(session.stats.conflicts)}`
                : '';
            const progressInfo = strings.merge.reviewedCount(session.stats.reviewed, session.stats.total);
            const statsText = mergeInfo ? `${mergeInfo}${conflictsInfo} • ${progressInfo}` : `${progressInfo}${conflictsInfo}`;

            const escapedName = this.escapeHtml(displayName).replace(/'/g, "\\'");
            html += `
                <div class="tree-manager-item pending-merge">
                    <div class="tree-manager-item-header">
                        <span class="tree-manager-item-indicator pending"></span>
                        <span class="tree-manager-item-name">${this.escapeHtml(displayName)}</span>
                        <span class="tree-manager-item-stats">${statsText}</span>
                        <span class="tree-manager-item-size">${date}</span>
                    </div>
                    <div class="tree-manager-item-actions">
                        <button class="edit-only" onclick="window.Strom.UI.resumePendingMergeFromManager('${session.id}')" title="${strings.merge.resume}"><span class="btn-icon">▶️</span><span class="btn-text">${strings.merge.resume}</span></button>
                        <button class="edit-only" onclick="window.Strom.UI.renamePendingMergeFromManager('${session.id}', '${escapedName}')" title="${strings.treeManager.rename}"><span class="btn-icon">✏️</span><span class="btn-text">${strings.treeManager.rename}</span></button>
                        <button class="danger edit-only" onclick="window.Strom.UI.discardPendingMergeFromManager('${session.id}', '${escapedName}')" title="${strings.merge.discard}"><span class="btn-icon">❌</span><span class="btn-text">${strings.merge.discard}</span></button>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html || `<p style="text-align:center;color:var(--text-light);">${strings.merge.noItems}</p>`;
    }

    /**
     * Update storage display in tree manager
     */
    private updateStorageDisplay(): void {
        const usage = TreeManager.getStorageUsage();
        const percentage = Math.round((usage.used / usage.total) * 100);

        // Tree manager storage
        const fill = document.getElementById('storage-bar-fill');
        const text = document.getElementById('storage-text');

        if (fill) {
            fill.style.width = `${percentage}%`;
            fill.classList.remove('warning', 'danger');
            if (percentage > 80) fill.classList.add('danger');
            else if (percentage > 60) fill.classList.add('warning');
        }
        if (text) {
            text.textContent = `${TreeManager.formatBytes(usage.used)} / ${TreeManager.formatBytes(usage.total)} (${percentage}%)`;
        }
    }

    // ==================== NEW TREE MENU ====================

    /**
     * Show new tree menu dialog with options (Empty, JSON, GEDCOM, Focus)
     * @param showIntro If true, shows intro text for users coming from offline version
     */
    showNewTreeMenu(showIntro?: boolean): void {
        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('new-tree-menu-modal');

        // Show/hide intro text
        const introEl = document.getElementById('new-tree-menu-intro');
        if (introEl) {
            introEl.style.display = showIntro ? 'block' : 'none';
        }

        document.getElementById('new-tree-menu-modal')?.classList.add('active');
    }

    /**
     * Close new tree menu dialog
     */
    closeNewTreeMenu(): void {
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    // ==================== IMPORT FILE DIALOG (EMPTY STATE) ====================

    /**
     * Show import file dialog for empty state
     */
    showImportFileDialog(): void {
        this.clearDialogStack();
        this.pushDialog('import-file-modal');
        document.getElementById('import-file-modal')?.classList.add('active');
    }

    /**
     * Close import file dialog
     */
    closeImportFileDialog(): void {
        document.getElementById('import-file-modal')?.classList.remove('active');
        this.clearDialogStack();
    }

    /**
     * Import JSON directly to current tree (from empty state)
     */
    importJsonToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('file-input')?.click();
    }

    /**
     * Import GEDCOM directly to current tree (from empty state)
     */
    importGedcomToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('gedcom-input')?.click();
    }

    // Flag for importing to current tree
    private importToCurrentTree: boolean = false;

    /**
     * Start JSON import from tree manager
     * Sets up dialog stack for proper navigation
     */
    startJsonImportFromManager(): void {
        this.importFromTreeManager = true;
        // Close new-tree-menu but keep tree-manager in stack
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove new-tree-menu, keep tree-manager
        // Trigger file input
        document.getElementById('file-input')?.click();
    }

    /**
     * Start GEDCOM import from tree manager
     * Sets up dialog stack for proper navigation
     */
    startGedcomImportFromManager(): void {
        this.importFromTreeManager = true;
        // Close new-tree-menu but keep tree-manager in stack
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop(); // Remove new-tree-menu, keep tree-manager
        // Trigger file input
        document.getElementById('gedcom-input')?.click();
    }

    /**
     * Start HTML import from tree manager
     */
    startHtmlImportFromManager(): void {
        this.importFromTreeManager = true;
        document.getElementById('new-tree-menu-modal')?.classList.remove('active');
        this.dialogStack.pop();
        document.getElementById('html-input')?.click();
    }

    /**
     * Import HTML directly to current tree (from empty state)
     */
    importHtmlToCurrentTree(): void {
        this.importToCurrentTree = true;
        this.closeImportFileDialog();
        document.getElementById('html-input')?.click();
    }

    /**
     * Handle HTML file import
     */
    handleHtmlFile(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const htmlContent = e.target?.result as string;
            const data = this.extractDataFromHtml(htmlContent);

            if (!data) {
                this.showAlert(strings.treeManager.htmlNoData, 'warning');
                input.value = '';
                return;
            }

            // Use the same flow as JSON import
            this.processJsonImport(data);
        };
        reader.readAsText(file);
        input.value = '';
    }

    /**
     * Extract embedded data from Strom HTML file
     */
    private extractDataFromHtml(html: string): StromData | null {
        // Try to find STROM_EMBEDDED_DATA (single tree)
        const singleMatch = html.match(/window\.STROM_EMBEDDED_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
        if (singleMatch) {
            try {
                const envelope = JSON.parse(singleMatch[1]);
                // Handle encrypted data
                if (envelope.data && typeof envelope.data === 'object') {
                    if ('encrypted' in envelope.data && envelope.data.encrypted === true) {
                        // Encrypted data - would need password, show error for now
                        this.showAlert('Encrypted HTML files are not supported for import', 'warning');
                        return null;
                    }
                    return envelope.data as StromData;
                }
            } catch {
                // Parse error
            }
        }

        // Try to find STROM_EMBEDDED_ALL (multiple trees) - use first tree
        const allMatch = html.match(/window\.STROM_EMBEDDED_ALL\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
        if (allMatch) {
            try {
                const envelope = JSON.parse(allMatch[1]);
                if (envelope.trees && typeof envelope.trees === 'object') {
                    const treeIds = Object.keys(envelope.trees);
                    if (treeIds.length > 0) {
                        const firstTree = envelope.trees[treeIds[0]];
                        if (firstTree.data) {
                            return firstTree.data as StromData;
                        }
                    }
                }
            } catch {
                // Parse error
            }
        }

        return null;
    }

    // ==================== EMBEDDED MODE INFO ====================

    /**
     * Show embedded mode info dialog
     */
    showEmbeddedInfoDialog(): void {
        this.clearDialogStack();
        this.pushDialog('embedded-info-modal');
        document.getElementById('embedded-info-modal')?.classList.add('active');
    }

    /**
     * Close embedded mode info dialog
     */
    closeEmbeddedInfoDialog(): void {
        document.getElementById('embedded-info-modal')?.classList.remove('active');
        this.clearDialogStack();
    }

    /**
     * Export JSON for transferring to online version
     */
    exportJsonForOnline(): void {
        const data = DataManager.exportJSON();
        const dataStr = JSON.stringify(data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'strom-data.json';
        a.click();
        URL.revokeObjectURL(a.href);
        this.showToast(strings.buttons.exportComplete);
    }

    // ==================== EXPORT ALL DIALOG ====================

    /**
     * Show export all dialog
     */
    showExportAllDialog(): void {
        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('export-all-modal');

        document.getElementById('export-all-modal')?.classList.add('active');
    }

    /**
     * Close export all dialog
     */
    closeExportAllDialog(): void {
        document.getElementById('export-all-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    // ==================== EXPORT FOCUS DIALOG ====================

    /**
     * Show export focus dialog
     */
    showExportFocusDialog(parentDialogId?: string): void {
        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('export-focus-modal');

        document.getElementById('export-focus-modal')?.classList.add('active');
    }

    /**
     * Show export focus dialog from Tree Manager (uses dialog stack for ESC to return)
     */
    showExportFocusDialogFromManager(): void {
        this.showExportFocusDialog('tree-manager-modal');
    }

    /**
     * Close export focus dialog
     */
    closeExportFocusDialog(): void {
        document.getElementById('export-focus-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    /**
     * Export focused data as standalone App
     */
    async exportFocusAsApp(): Promise<void> {
        const focusedData = TreeRenderer.getFocusedData();
        if (!focusedData || Object.keys(focusedData.persons).length === 0) {
            this.clearDialogStack();
            this.pushDialog('export-focus-modal');
            this.showAlert(strings.treeManager.noFocusedData, 'warning');
            return;
        }

        await AppExporter.exportFocusAsApp(focusedData, 'strom-focus.html');
        this.closeExportFocusDialog();
    }

    /**
     * Export all trees as single JSON file
     * Shows password dialog for optional encryption
     */
    async exportAllAsJson(): Promise<void> {
        this.closeExportAllDialog();

        this.showExportPasswordDialog(async (password: string | null) => {
            const trees = TreeManager.getTrees();
            const allData: Record<string, { name: string; data: StromData }> = {};

            for (const tree of trees) {
                const data = TreeManager.getTreeData(tree.id);
                if (data) {
                    allData[tree.id] = {
                        name: tree.name,
                        data
                    };
                }
            }

            let dataStr: string;
            if (password) {
                const { encrypt } = await import('./crypto.js');
                const encrypted = await encrypt(JSON.stringify(allData), password);
                dataStr = JSON.stringify(encrypted, null, 2);
            } else {
                dataStr = JSON.stringify(allData, null, 2);
            }

            const blob = new Blob([dataStr], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'strom-all-trees.json';
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    // ==================== CREATE TREE FROM FOCUS ====================

    /**
     * Create a new tree from currently focused family data
     */
    createTreeFromFocus(): void {
        const focusedData = TreeRenderer.getFocusedData();
        if (!focusedData || Object.keys(focusedData.persons).length === 0) {
            this.showAlert(strings.treeManager.noFocusedData, 'warning');
            return;
        }

        // Close new-tree-menu visually, keep tree-manager in stack for proper ESC navigation
        this.closeDialogById('new-tree-menu-modal');
        this.dialogStack.pop(); // Remove new-tree-menu-modal, keep tree-manager
        this.showImportTreeDialog(focusedData, strings.treeManager.defaultTreeName, true);
    }

    // ==================== NEW TREE DIALOG ====================

    /**
     * Show new tree dialog
     */
    showNewTreeDialog(): void {
        const modal = document.getElementById('new-tree-modal');
        const input = document.getElementById('new-tree-name') as HTMLInputElement;
        if (!modal || !input) return;

        // Handle dialog stack - keep existing stack (tree-manager, new-tree-menu), just add new-tree-modal
        // Close new-tree-menu visually but keep in stack
        this.closeDialogById('new-tree-menu-modal');
        this.pushDialog('new-tree-modal');

        input.value = '';
        modal.classList.add('active');
        input.focus();

        // Handle Enter key
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.createNewTreeFromDialog();
            }
        };
    }

    /**
     * Close new tree dialog
     */
    closeNewTreeDialog(): void {
        document.getElementById('new-tree-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    /**
     * Create new tree from dialog
     */
    createNewTreeFromDialog(): void {
        const input = document.getElementById('new-tree-name') as HTMLInputElement;
        const name = input?.value.trim() || strings.treeManager.defaultTreeName;

        const newTreeId = DataManager.createNewTree(name);

        // Close dialogs and return to tree manager (skip new-tree-menu)
        this.closeDialogById('new-tree-modal');
        this.closeDialogById('new-tree-menu-modal');
        this.clearDialogStack();

        // Update and show tree manager with new tree
        this.updateTreeManagerList();
        this.updateStorageDisplay();
        this.showTreeManagerDialog();

        this.updateTreeSwitcher();
        TreeRenderer.render();
        this.refreshSearch();
        // Update URL to reflect new tree
        this.updateUrlTreeParam(newTreeId);
    }

    // ==================== RENAME TREE DIALOG ====================

    /**
     * Show rename tree dialog
     */
    showRenameTreeDialog(treeId: string, parentDialogId?: string): void {
        const modal = document.getElementById('rename-tree-modal');
        const input = document.getElementById('rename-tree-name') as HTMLInputElement;
        if (!modal || !input) return;

        this.renameTreeId = treeId as TreeId;
        const tree = TreeManager.getTreeMetadata(this.renameTreeId);
        input.value = tree?.name || '';

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('rename-tree-modal');

        modal.classList.add('active');
        input.focus();
        input.select();

        // Handle Enter key
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmRenameTree();
            }
        };
    }

    /**
     * Close rename tree dialog
     */
    closeRenameTreeDialog(): void {
        document.getElementById('rename-tree-modal')?.classList.remove('active');
        this.renameTreeId = null;
        this.returnToParentDialog();
    }

    /**
     * Confirm rename tree
     */
    confirmRenameTree(): void {
        if (!this.renameTreeId) return;

        const input = document.getElementById('rename-tree-name') as HTMLInputElement;
        const name = input?.value.trim();
        if (!name) return;

        const isActiveTree = TreeManager.getActiveTreeId() === this.renameTreeId;
        TreeManager.renameTree(this.renameTreeId, name);

        // Update URL if renamed tree is the active one
        if (isActiveTree) {
            this.updateUrlTreeParam(this.renameTreeId);
        }

        this.closeRenameTreeDialog();
        this.updateTreeManagerList();
        this.updateTreeSwitcher();
    }

    // ==================== DUPLICATE TREE ====================

    /**
     * Show duplicate tree dialog
     */
    duplicateTree(treeId: string): void {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        if (!tree) return;

        this.duplicateTreeId = treeId as TreeId;
        const defaultName = tree.name + ' ' + strings.treeManager.duplicateSuffix;

        const modal = document.getElementById('duplicate-tree-modal');
        const input = document.getElementById('duplicate-tree-name') as HTMLInputElement;

        // Handle dialog stack - tree-manager is parent
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('duplicate-tree-modal');

        if (input) {
            input.value = defaultName;
        }

        modal?.classList.add('active');
        input?.focus();
        input?.select();

        // Handle Enter key
        if (input) {
            input.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.confirmDuplicateTree();
                }
            };
        }
    }

    /**
     * Close duplicate tree dialog
     */
    closeDuplicateTreeDialog(): void {
        const modal = document.getElementById('duplicate-tree-modal');
        modal?.classList.remove('active');
        this.returnToParentDialog();
        this.duplicateTreeId = null;
    }

    /**
     * Confirm duplicate tree
     */
    confirmDuplicateTree(): void {
        if (!this.duplicateTreeId) return;

        const input = document.getElementById('duplicate-tree-name') as HTMLInputElement;
        const newName = input?.value.trim();

        if (!newName) {
            input?.focus();
            return;
        }

        TreeManager.duplicateTree(this.duplicateTreeId, newName);
        this.closeDuplicateTreeDialog();
        this.updateTreeManagerList();
        this.updateStorageDisplay();
        this.updateTreeSwitcher();
    }

    // ==================== TREE VISIBILITY ====================

    /**
     * Toggle tree visibility (hidden from switcher and cross-tree matching)
     */
    toggleTreeVisibility(treeId: string): void {
        const id = treeId as TreeId;

        // Toggle visibility
        TreeManager.toggleTreeVisibility(id);

        // Refresh displays
        this.updateTreeManagerList();
        this.updateTreeSwitcher();

        // Invalidate cross-tree cache and re-render to update badges
        CrossTree.invalidateCache();
        TreeRenderer.render();
    }

    // ==================== TREE STATS ====================

    /**
     * Show tree statistics dialog
     */
    showTreeStatsDialog(treeId: string, parentDialogId?: string): void {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        const treeData = TreeManager.getTreeData(treeId as TreeId);
        if (!tree || !treeData) return;

        const modal = document.getElementById('tree-stats-modal');
        const title = document.getElementById('tree-stats-title');
        const content = document.getElementById('tree-stats-content');

        if (title) {
            title.textContent = tree.name;
        }

        if (content) {
            content.innerHTML = this.generateTreeStatsHtml(treeData);
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('tree-stats-modal');

        modal?.classList.add('active');
    }

    /**
     * Show stats for the currently active tree (called from focus bar)
     */
    showActiveTreeStats(): void {
        const activeTreeId = TreeManager.getActiveTreeId();
        if (activeTreeId) {
            this.showTreeStatsDialog(activeTreeId);
        }
    }

    /**
     * Show tree validation dialog (checks for genealogical inconsistencies)
     */
    showTreeValidationDialog(treeId: string, parentDialogId?: string): void {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        const treeData = TreeManager.getTreeData(treeId as TreeId);
        if (!tree || !treeData) return;

        const modal = document.getElementById('tree-validation-modal');
        const title = document.getElementById('tree-validation-title');
        const content = document.getElementById('tree-validation-content');

        if (title) {
            title.textContent = `${strings.treeManager.validationTitle}: ${tree.name}`;
        }

        if (content) {
            const result = validateTreeData(treeData);
            content.innerHTML = this.generateTreeValidationHtml(result, treeData, treeId);

            // Add click handler for person links using event delegation
            content.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.classList.contains('validation-person-link')) {
                    e.preventDefault();
                    const treeIdAttr = target.getAttribute('data-tree-id');
                    const personIdAttr = target.getAttribute('data-person-id');
                    if (treeIdAttr && personIdAttr) {
                        this.focusPersonFromValidation(treeIdAttr, personIdAttr);
                    }
                }
            };
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('tree-validation-modal');

        modal?.classList.add('active');
    }

    closeTreeValidationDialog(): void {
        document.getElementById('tree-validation-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    /**
     * Generate HTML for tree validation results
     */
    private generateTreeValidationHtml(result: TreeValidationResult, treeData: StromData, treeId: string): string {
        const s = strings.treeManager;

        if (result.issues.length === 0) {
            return `
                <div class="validation-passed">
                    <div class="validation-passed-icon">✅</div>
                    <div class="validation-passed-text">${s.validationPassed}</div>
                </div>
            `;
        }

        // Group issues by severity
        const errors = result.issues.filter(i => i.severity === 'error');
        const warnings = result.issues.filter(i => i.severity === 'warning');
        const infos = result.issues.filter(i => i.severity === 'info');

        let html = `
            <div class="validation-summary">
                ${result.stats.errors > 0 ? `<span class="validation-count error">❌ ${result.stats.errors} ${s.validationErrors}</span>` : ''}
                ${result.stats.warnings > 0 ? `<span class="validation-count warning">⚠️ ${result.stats.warnings} ${s.validationWarnings}</span>` : ''}
                ${result.stats.infos > 0 ? `<span class="validation-count info">ℹ️ ${result.stats.infos} ${s.validationInfos}</span>` : ''}
            </div>
            <div class="validation-issues">
        `;

        // Translate validation issue type to localized message
        const translateIssueType = (type: string): string => {
            const typeToKey: Record<string, keyof typeof s> = {
                'cycle': 'valCycle',
                'selfPartnership': 'valSelfPartnership',
                'duplicatePartnership': 'valDuplicatePartnership',
                'missingChildRef': 'valMissingChildRef',
                'missingParentRef': 'valMissingParentRef',
                'missingPartnershipRef': 'valMissingPartnershipRef',
                'partnershipChildMismatch': 'valPartnershipChildMismatch',
                'orphanedParentRef': 'valOrphanedRef',
                'orphanedChildRef': 'valOrphanedRef',
                'orphanedPartnershipRef': 'valOrphanedRef',
                'orphanedPartnerRef': 'valOrphanedRef',
                'orphanedPartnershipChildRef': 'valOrphanedRef',
                'tooManyParents': 'valTooManyParents',
                'parentYoungerThanChild': 'valParentYoungerThanChild',
                'parentTooYoung': 'valParentTooYoung',
                'parentTooOld': 'valParentTooOld',
                'generationConflict': 'valGenerationConflict',
                'partnerIsParent': 'valPartnerIsParent',
                'partnerIsChild': 'valPartnerIsChild',
                'siblingIsParent': 'valSiblingIsParent',
                'siblingIsChild': 'valSiblingIsChild',
            };
            const key = typeToKey[type];
            return key ? (s[key] as string) : type;
        };

        const renderIssue = (issue: ValidationIssue) => {
            const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
            const translatedMessage = translateIssueType(issue.type);

            // Create clickable person links with data attributes
            const personLinks = issue.personIds?.map(id => {
                const person = treeData.persons[id];
                const name = person ? `${person.firstName} ${person.lastName}`.trim() : id;
                return `<a href="#" class="validation-person-link" data-tree-id="${treeId}" data-person-id="${id}">${this.escapeHtml(name)}</a>`;
            }).join(', ') || '';

            return `
                <div class="validation-issue ${issue.severity}">
                    <span class="validation-issue-icon">${icon}</span>
                    <div class="validation-issue-content">
                        <div class="validation-issue-message">${this.escapeHtml(translatedMessage)}</div>
                        ${personLinks ? `<div class="validation-issue-persons">${personLinks}</div>` : ''}
                    </div>
                </div>
            `;
        };

        // Render errors first, then warnings, then infos
        for (const issue of errors) {
            html += renderIssue(issue);
        }
        for (const issue of warnings) {
            html += renderIssue(issue);
        }
        for (const issue of infos) {
            html += renderIssue(issue);
        }

        html += '</div>';
        return html;
    }

    /**
     * Focus on a person from validation dialog
     * Switches to the tree if needed and focuses on the person
     */
    focusPersonFromValidation(treeId: string, personId: string): void {
        // Close all dialogs
        this.closeTreeValidationDialog();
        this.closeTreeManagerDialog();

        // Switch to tree if needed
        const activeTreeId = TreeManager.getActiveTreeId();
        if (activeTreeId !== treeId) {
            this.switchToTree(treeId as TreeId);
        }

        // Focus on the person
        TreeRenderer.setFocus(personId as PersonId);
    }

    /**
     * Generate HTML for tree statistics
     */
    private generateTreeStatsHtml(treeData: StromData): string {
        const persons = Object.values(treeData.persons);
        const partnerships = Object.values(treeData.partnerships);
        const currentYear = new Date().getFullYear();
        const MAX_AGE = 120;

        // Helper to check if person is presumed deceased (death date OR age > 120)
        const isPresumedDeceased = (p: { birthDate?: string; deathDate?: string }): boolean => {
            if (p.deathDate) return true;
            if (p.birthDate) {
                const birthYear = parseInt(p.birthDate.split('-')[0], 10);
                if (!isNaN(birthYear) && (currentYear - birthYear) > MAX_AGE) return true;
            }
            return false;
        };

        // Basic counts
        const totalPersons = persons.length;
        const males = persons.filter(p => p.gender === 'male').length;
        const females = persons.filter(p => p.gender === 'female').length;
        const deceased = persons.filter(p => isPresumedDeceased(p)).length;
        const living = totalPersons - deceased;

        // Family stats
        const totalFamilies = partnerships.length;
        const childCounts = partnerships.map(p => p.childIds?.length || 0);
        const avgChildren = totalFamilies > 0
            ? (childCounts.reduce((a, b) => a + b, 0) / totalFamilies).toFixed(1)
            : '0';
        const maxChildren = childCounts.length > 0 ? Math.max(...childCounts) : 0;

        // Date stats
        const birthDates = persons
            .map(p => p.birthDate)
            .filter((d): d is string => !!d)
            .sort();
        const oldestBirth = birthDates[0] || '-';
        const newestBirth = birthDates[birthDates.length - 1] || '-';

        // Data completeness
        const withBirthDate = persons.filter(p => p.birthDate).length;
        const withDeathDate = persons.filter(p => p.deathDate).length;
        const withBirthPlace = persons.filter(p => p.birthPlace).length;

        const s = strings.treeManager;

        // Calculate percentages
        const birthDatePct = totalPersons > 0 ? Math.round(withBirthDate / totalPersons * 100) : 0;
        const deathDatePct = totalPersons > 0 ? Math.round(withDeathDate / totalPersons * 100) : 0;
        const birthPlacePct = totalPersons > 0 ? Math.round(withBirthPlace / totalPersons * 100) : 0;

        return `
            <div class="tree-stats-header">
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value">${totalPersons}</div>
                    <div class="tree-stats-header-label">${s.statsPeople}</div>
                </div>
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value">${totalFamilies}</div>
                    <div class="tree-stats-header-label">${s.statsFamilies}</div>
                </div>
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-grid">
                    <div class="tree-stats-row">
                        <span class="label">${s.statsMales}</span>
                        <span class="value">${males}</span>
                    </div>
                    <div class="tree-stats-row">
                        <span class="label">${s.statsFemales}</span>
                        <span class="value">${females}</span>
                    </div>
                    <div class="tree-stats-row">
                        <span class="label">${s.statsLiving}</span>
                        <span class="value">${living}</span>
                    </div>
                    <div class="tree-stats-row">
                        <span class="label">${s.statsDeceased}</span>
                        <span class="value">${deceased}</span>
                    </div>
                    <div class="tree-stats-row">
                        <span class="label">${s.statsAvgChildren}</span>
                        <span class="value">${avgChildren}</span>
                    </div>
                    <div class="tree-stats-row">
                        <span class="label">${s.statsMaxChildren}</span>
                        <span class="value">${maxChildren}</span>
                    </div>
                </div>
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsDates}</div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsOldestBirth}</span>
                    <span class="value">${this.formatDateShort(oldestBirth)}</span>
                </div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsNewestBirth}</span>
                    <span class="value">${this.formatDateShort(newestBirth)}</span>
                </div>
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsData}</div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsWithBirthDate}</span>
                    <span class="value">${birthDatePct}%</span>
                </div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsWithDeathDate}</span>
                    <span class="value">${deathDatePct}%</span>
                </div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsWithBirthPlace}</span>
                    <span class="value">${birthPlacePct}%</span>
                </div>
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsAnniversaries}</div>
                <div class="tree-stats-anniversaries">
                    ${this.generateAnniversariesHtml(treeData)}
                </div>
            </div>
        `;
    }

    /**
     * Generate HTML for upcoming anniversaries
     */
    private generateAnniversariesHtml(treeData: StromData): string {
        const s = strings.treeManager;
        const today = new Date();
        const todayMonth = today.getMonth();
        const todayDay = today.getDate();
        const todayYear = today.getFullYear();

        interface Anniversary {
            date: Date;
            daysUntil: number;
            icon: string;
            name: string;
            detail: string;
            isToday: boolean;
        }

        const anniversaries: Anniversary[] = [];

        const MAX_AGE = 120; // Same rule as in renderer.ts

        // Helper to check if person is presumed deceased (death date OR age > 120)
        const isPresumedDeceased = (person: { birthDate?: string; deathDate?: string }): boolean => {
            if (person.deathDate) return true;
            if (person.birthDate) {
                const birthYear = parseInt(person.birthDate.split('-')[0], 10);
                if (!isNaN(birthYear) && (todayYear - birthYear) > MAX_AGE) {
                    return true;
                }
            }
            return false;
        };

        // Helper to calculate days until anniversary this year
        const getDaysUntil = (month: number, day: number): number => {
            const thisYear = new Date(todayYear, month, day);
            const nextYear = new Date(todayYear + 1, month, day);

            const diffThis = Math.ceil((thisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffThis >= 0) return diffThis;

            return Math.ceil((nextYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        };

        // Process persons for birthdays and death anniversaries
        for (const person of Object.values(treeData.persons)) {
            const name = `${person.firstName} ${person.lastName}`.trim();
            const isDeceased = isPresumedDeceased(person);

            // Birthday / Birth anniversary
            if (person.birthDate) {
                const [year, month, day] = person.birthDate.split('-').map(Number);
                if (month && day) {
                    const daysUntil = getDaysUntil(month - 1, day);
                    if (daysUntil <= 30) {
                        const age = todayYear - year + (daysUntil === 0 ? 0 : (daysUntil > 0 && month - 1 < todayMonth ? 1 : 0));
                        const actualAge = todayYear - year + (daysUntil <= 0 ? 0 : 0);
                        const yearsOld = todayYear - year + (daysUntil === 0 ? 0 : (month - 1 > todayMonth || (month - 1 === todayMonth && day > todayDay) ? 0 : 1));

                        if (isDeceased) {
                            anniversaries.push({
                                date: new Date(todayYear, month - 1, day),
                                daysUntil,
                                icon: '✱',
                                name,
                                detail: `${s.statsBirthAnniversary} ${yearsOld} ${s.statsYears}`,
                                isToday: daysUntil === 0
                            });
                        } else {
                            anniversaries.push({
                                date: new Date(todayYear, month - 1, day),
                                daysUntil,
                                icon: '🎂',
                                name,
                                detail: `${yearsOld} ${s.statsYears}`,
                                isToday: daysUntil === 0
                            });
                        }
                    }
                }
            }

            // Death memorial
            if (person.deathDate) {
                const [year, month, day] = person.deathDate.split('-').map(Number);
                if (month && day) {
                    const daysUntil = getDaysUntil(month - 1, day);
                    if (daysUntil <= 30) {
                        const yearsSince = todayYear - year + (daysUntil === 0 ? 0 : (month - 1 > todayMonth || (month - 1 === todayMonth && day > todayDay) ? 0 : 1));
                        anniversaries.push({
                            date: new Date(todayYear, month - 1, day),
                            daysUntil,
                            icon: '🕯',
                            name,
                            detail: `${s.statsMemorial} ${yearsSince} ${s.statsYears}`,
                            isToday: daysUntil === 0
                        });
                    }
                }
            }
        }

        // Process partnerships for wedding/relationship anniversaries
        for (const partnership of Object.values(treeData.partnerships)) {
            if (partnership.startDate) {
                const [year, month, day] = partnership.startDate.split('-').map(Number);
                if (month && day) {
                    const daysUntil = getDaysUntil(month - 1, day);
                    if (daysUntil <= 30) {
                        const partner1 = treeData.persons[partnership.person1Id];
                        const partner2 = treeData.persons[partnership.person2Id];
                        if (partner1 && partner2) {
                            const name = `${partner1.firstName} & ${partner2.firstName}`;
                            const yearsSince = todayYear - year + (daysUntil === 0 ? 0 : (month - 1 > todayMonth || (month - 1 === todayMonth && day > todayDay) ? 0 : 1));
                            anniversaries.push({
                                date: new Date(todayYear, month - 1, day),
                                daysUntil,
                                icon: '💍',
                                name,
                                detail: `${s.statsWeddingAnniversary} ${yearsSince} ${s.statsYears}`,
                                isToday: daysUntil === 0
                            });
                        }
                    }
                }
            }
        }

        // Sort by days until
        anniversaries.sort((a, b) => a.daysUntil - b.daysUntil);

        // Limit to 10 items
        const limited = anniversaries.slice(0, 10);

        if (limited.length === 0) {
            return `<div class="tree-stats-none">${s.statsAnniversariesNone}</div>`;
        }

        return limited.map(ann => {
            const dateStr = `${ann.date.getDate()}.${ann.date.getMonth() + 1}.`;
            const todayClass = ann.isToday ? ' tree-stats-anniversary-today' : '';
            const dateLabel = ann.isToday ? s.statsToday : dateStr;

            return `
                <div class="tree-stats-anniversary${todayClass}">
                    <span class="tree-stats-anniversary-icon">${ann.icon}</span>
                    <div class="tree-stats-anniversary-info">
                        <div class="tree-stats-anniversary-name">${this.escapeHtml(ann.name)}</div>
                        <div class="tree-stats-anniversary-detail">${ann.detail}</div>
                    </div>
                    <span class="tree-stats-anniversary-date">${dateLabel}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Format date for display (short format)
     */
    private formatDateShort(dateStr: string): string {
        if (!dateStr || dateStr === '-') return '-';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        return dateStr;
    }

    /**
     * Close tree stats dialog
     */
    closeTreeStatsDialog(): void {
        document.getElementById('tree-stats-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    /**
     * Return to parent dialog from stack, or clear stack if no parent
     */
    private returnToParentDialog(): void {
        // Remove current dialog from stack
        this.dialogStack.pop();

        // If there's a parent dialog, open it
        if (this.dialogStack.length > 0) {
            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
            this.openDialogById(parentDialog);
        }

        // Clear the stack (we've returned to parent)
        this.dialogStack = [];
    }

    // ==================== DELETE TREE ====================

    /**
     * Confirm delete tree
     */
    async confirmDeleteTree(treeId: string): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        if (!tree) return;

        // Setup dialog stack - tree manager is parent of confirm
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');

        const confirmed = await this.showConfirm(strings.treeManager.confirmDelete(tree.name), strings.buttons.delete);
        if (confirmed) {
            const wasActive = TreeManager.getActiveTreeId() === treeId;
            TreeManager.deleteTree(treeId as TreeId);

            // If no trees left, create a new empty one
            if (!TreeManager.hasTrees()) {
                const newTreeId = DataManager.createNewTree(strings.treeManager.defaultTreeName);
                this.updateUrlTreeParam(newTreeId);
            } else if (wasActive) {
                // Reload data from the new active tree
                const newActiveId = TreeManager.getActiveTreeId()!;
                DataManager.switchTree(newActiveId);
                // Update URL to reflect new active tree
                this.updateUrlTreeParam(newActiveId);
            }

            this.updateTreeManagerList();
            this.updateStorageDisplay();
            this.updateTreeSwitcher();
            TreeRenderer.render();
        }
        // If not confirmed, tree manager stays open (returnToParentDialog handles it)
    }

    // ==================== MERGE TREES DIALOG ====================

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
    }

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
    }

    /**
     * Close merge trees dialog
     */
    closeMergeTreesDialog(): void {
        document.getElementById('merge-trees-modal')?.classList.remove('active');
        this.mergeSourceTreeId = null;
        this.mergeTargetTreeId = null;
        this.returnToParentDialog();
    }

    /**
     * Start tree merge process
     */
    startTreeMerge(): void {
        if (!this.mergeSourceTreeId || !this.mergeTargetTreeId) {
            this.clearDialogStack();
            this.pushDialog('merge-trees-modal');
            this.showAlert(strings.treeManager.selectTargetTree, 'warning');
            return;
        }

        const sourceData = TreeManager.getTreeData(this.mergeSourceTreeId);
        if (!sourceData) return;

        // Switch to target tree first
        DataManager.switchTree(this.mergeTargetTreeId);
        // Update URL to reflect target tree
        this.updateUrlTreeParam(this.mergeTargetTreeId);

        // Start merge with source data (fromTreeManager = true)
        MergerUI.startMerge(sourceData, this.mergeSourceTreeId, true);

        this.closeMergeTreesDialog();
        this.closeTreeManagerDialog();
    }

    // ==================== IMPORT AS NEW TREE ====================

    /**
     * Show import tree dialog (for creating new tree from import)
     */
    showImportTreeDialog(data: StromData, suggestedName: string, fromTreeManager: boolean = false): void {
        const modal = document.getElementById('import-tree-modal');
        const nameInput = document.getElementById('import-tree-name') as HTMLInputElement;
        const personsEl = document.getElementById('import-tree-persons');
        const partnershipsEl = document.getElementById('import-tree-partnerships');

        if (!modal || !nameInput || !personsEl || !partnershipsEl) return;

        this.importTreeData = data;
        this.importFromTreeManager = fromTreeManager;

        // Handle dialog stack - if from tree manager, it's already in stack
        if (fromTreeManager) {
            this.pushDialog('import-tree-modal');
        }

        nameInput.value = suggestedName;
        personsEl.textContent = String(Object.keys(data.persons).length);
        partnershipsEl.textContent = String(Object.keys(data.partnerships).length);

        modal.classList.add('active');
        nameInput.focus();
        nameInput.select();
    }

    /**
     * Close import tree dialog
     */
    closeImportTreeDialog(): void {
        document.getElementById('import-tree-modal')?.classList.remove('active');
        this.importTreeData = null;
        if (this.importFromTreeManager) {
            this.returnToParentDialog();
            this.importFromTreeManager = false;
        }
    }

    /**
     * Confirm import as new tree
     */
    confirmImportTree(): void {
        if (!this.importTreeData) return;

        const nameInput = document.getElementById('import-tree-name') as HTMLInputElement;
        const name = nameInput?.value.trim() || strings.treeManager.importTreeName;

        const newTreeId = DataManager.importAsNewTree(this.importTreeData, name);

        this.closeImportTreeDialog();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.updateStorageDisplay();
        TreeRenderer.render();
        this.refreshSearch();
        // Update URL to reflect new tree
        this.updateUrlTreeParam(newTreeId);
    }

    // ==================== DEFAULT PERSON DIALOG ====================

    /**
     * Show default person dialog for a tree
     */
    showDefaultPersonDialog(treeId: string, parentDialogId?: string): void {
        const modal = document.getElementById('default-person-modal');
        if (!modal) return;

        this.defaultPersonTreeId = treeId as TreeId;

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('default-person-modal');

        // Get tree data
        const treeData = TreeManager.getTreeData(this.defaultPersonTreeId);
        const currentSetting = treeData?.defaultPersonId;

        // Get first person name for display
        const persons = treeData ? Object.values(treeData.persons).filter(p => !p.isPlaceholder) : [];
        const firstPerson = persons[0];
        const firstPersonName = firstPerson ? `${firstPerson.firstName} ${firstPerson.lastName}`.trim() : '?';

        // Update "First person" label to show who that is
        const firstPersonLabel = document.getElementById('default-person-first-label');
        if (firstPersonLabel) {
            firstPersonLabel.textContent = `${strings.treeManager.defaultPersonFirstPerson} (${firstPersonName})`;
        }

        // Select appropriate radio button
        const radioFirst = document.getElementById('default-person-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-person-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;

        if (currentSetting === undefined) {
            radioFirst.checked = true;
        } else if (currentSetting === LAST_FOCUSED) {
            radioLast.checked = true;
        } else {
            radioSpecific.checked = true;
        }

        // Initialize person picker with persons from this tree
        this.initDefaultPersonPicker(treeData, currentSetting);

        // Update picker visibility based on radio selection
        this.updateDefaultPersonPickerVisibility();

        // Add radio change listeners
        [radioFirst, radioLast, radioSpecific].forEach(radio => {
            radio.onchange = () => this.updateDefaultPersonPickerVisibility();
        });

        modal.classList.add('active');
    }

    /**
     * Initialize PersonPicker for default person selection
     */
    private initDefaultPersonPicker(treeData: StromData | null, currentSetting?: PersonId | LastFocusedMarker): void {
        // Destroy existing picker
        if (this.defaultPersonPicker) {
            this.defaultPersonPicker.destroy();
            this.defaultPersonPicker = null;
        }

        if (!treeData) return;

        const persons = Object.values(treeData.persons).filter(p => !p.isPlaceholder);

        this.defaultPersonPicker = new PersonPicker({
            containerId: 'default-person-picker',
            onSelect: () => {
                // When a person is selected, automatically check the "specific" radio
                const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;
                if (radioSpecific) radioSpecific.checked = true;
            },
            placeholder: strings.personPicker.placeholder,
            persons
        });

        // Pre-select current default if it's a specific person ID
        if (currentSetting && currentSetting !== LAST_FOCUSED && treeData.persons[currentSetting]) {
            this.defaultPersonPicker.setValue(currentSetting);
        }
    }

    /**
     * Update picker visibility based on radio selection
     */
    private updateDefaultPersonPickerVisibility(): void {
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;
        const pickerContainer = document.getElementById('default-person-picker-container');
        if (pickerContainer) {
            pickerContainer.style.display = radioSpecific?.checked ? 'block' : 'none';
        }
    }

    /**
     * Close default person dialog
     */
    closeDefaultPersonDialog(): void {
        document.getElementById('default-person-modal')?.classList.remove('active');

        if (this.defaultPersonPicker) {
            this.defaultPersonPicker.destroy();
            this.defaultPersonPicker = null;
        }

        this.defaultPersonTreeId = null;
        this.returnToParentDialog();
    }

    /**
     * Confirm and save default person
     */
    confirmDefaultPerson(): void {
        if (!this.defaultPersonTreeId) return;

        const radioFirst = document.getElementById('default-person-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-person-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-person-specific') as HTMLInputElement;

        let value: PersonId | LastFocusedMarker | undefined;

        if (radioFirst?.checked) {
            value = undefined;  // First person
        } else if (radioLast?.checked) {
            value = LAST_FOCUSED;  // Last focused
        } else if (radioSpecific?.checked) {
            value = this.defaultPersonPicker?.getValue() || undefined;
            if (!value) {
                // No person selected, treat as "first person"
                value = undefined;
            }
        }

        TreeManager.setDefaultPerson(this.defaultPersonTreeId, value);

        // If this is the current tree, also update DataManager
        if (this.defaultPersonTreeId === DataManager.getCurrentTreeId()) {
            DataManager.setDefaultPerson(value);
        }

        this.closeDefaultPersonDialog();
        this.updateTreeManagerList();
    }

    // ==================== DEFAULT TREE DIALOG ====================

    /**
     * Show default tree dialog
     */
    showDefaultTreeDialog(): void {
        const modal = document.getElementById('default-tree-modal');
        if (!modal) return;

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        this.pushDialog('tree-manager-modal');
        this.closeDialogById('tree-manager-modal');
        this.pushDialog('default-tree-modal');

        const currentSetting = TreeManager.getDefaultTree();
        const trees = TreeManager.getTrees();

        // Get first tree name for display
        const firstTree = trees[0];
        const firstTreeName = firstTree ? firstTree.name : '?';

        // Update "First tree" label to show which tree that is
        const firstTreeLabel = document.getElementById('default-tree-first-label');
        if (firstTreeLabel) {
            firstTreeLabel.textContent = `${strings.treeManager.defaultTreeFirstTree} (${firstTreeName})`;
        }

        // Select appropriate radio button
        const radioFirst = document.getElementById('default-tree-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-tree-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;

        if (currentSetting === undefined) {
            radioFirst.checked = true;
        } else if (currentSetting === LAST_FOCUSED) {
            radioLast.checked = true;
        } else {
            radioSpecific.checked = true;
        }

        // Populate tree select
        const treeSelect = document.getElementById('default-tree-select') as HTMLSelectElement;
        if (treeSelect) {
            treeSelect.innerHTML = trees.map(tree =>
                `<option value="${tree.id}"${currentSetting === tree.id ? ' selected' : ''}>${this.escapeHtml(tree.name)}</option>`
            ).join('');
        }

        // Update select visibility
        this.updateDefaultTreeSelectVisibility();

        // Add radio change listeners
        [radioFirst, radioLast, radioSpecific].forEach(radio => {
            radio.onchange = () => this.updateDefaultTreeSelectVisibility();
        });

        modal.classList.add('active');
    }

    /**
     * Update tree select visibility based on radio selection
     */
    private updateDefaultTreeSelectVisibility(): void {
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;
        const selectContainer = document.getElementById('default-tree-select-container');
        if (selectContainer) {
            selectContainer.style.display = radioSpecific?.checked ? 'block' : 'none';
        }
    }

    /**
     * Close default tree dialog
     */
    closeDefaultTreeDialog(): void {
        document.getElementById('default-tree-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    /**
     * Confirm and save default tree
     */
    confirmDefaultTree(): void {
        const radioFirst = document.getElementById('default-tree-first') as HTMLInputElement;
        const radioLast = document.getElementById('default-tree-last') as HTMLInputElement;
        const radioSpecific = document.getElementById('default-tree-specific') as HTMLInputElement;
        const treeSelect = document.getElementById('default-tree-select') as HTMLSelectElement;

        let value: TreeId | LastFocusedMarker | undefined;

        if (radioFirst?.checked) {
            value = undefined;  // First tree
        } else if (radioLast?.checked) {
            value = LAST_FOCUSED;  // Last focused
        } else if (radioSpecific?.checked) {
            value = treeSelect?.value as TreeId || undefined;
        }

        TreeManager.setDefaultTree(value);
        this.closeDefaultTreeDialog();
    }

    // ==================== MODIFIED NEW TREE HANDLER ====================

    /**
     * Handle new tree creation (replaces old handleNewTree)
     */
    handleNewTree(): void {
        this.showNewTreeDialog();
    }

    // ==================== ABOUT DIALOG STORAGE ====================

    /**
     * Update about dialog with storage info
     */
    private updateAboutStorage(): void {
        const usage = TreeManager.getStorageUsage();
        const percentage = Math.round((usage.used / usage.total) * 100);

        const fill = document.getElementById('about-storage-bar-fill');
        const text = document.getElementById('about-storage-text');

        if (fill) {
            fill.style.width = `${percentage}%`;
            fill.classList.remove('warning', 'danger');
            if (percentage > 80) fill.classList.add('danger');
            else if (percentage > 60) fill.classList.add('warning');
        }
        if (text) {
            text.textContent = `${TreeManager.formatBytes(usage.used)} / ${TreeManager.formatBytes(usage.total)}`;
        }
    }

    // ==================== ENCRYPTION ====================

    /**
     * Toggle encryption on/off
     * When enabling, prompts for password
     * When disabling, requires password verification first
     */
    async toggleEncryption(enabled: boolean): Promise<void> {
        if (enabled) {
            // Show password setup dialog
            this.showPasswordSetupDialog();
        } else {
            // Disable encryption - require password verification first
            this.showDisableEncryptionPrompt();
        }
    }

    /**
     * Show password prompt to disable encryption
     */
    private showDisableEncryptionPrompt(): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');

        if (!modal || !input) {
            // Reset checkbox if dialog not available
            const toggle = document.getElementById('encryption-toggle') as HTMLInputElement;
            if (toggle) toggle.checked = true;
            return;
        }

        // Clear fields
        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        // Set callback for password verification - callback manages dialog
        this.passwordPromptCallback = async (password: string) => {
            await this.tryDisableEncryption(password);
        };
        this.passwordPromptCallbackManagesDialog = true;

        modal.classList.add('active');
        input.focus();
    }

    /**
     * Try to disable encryption with given password
     */
    private async tryDisableEncryption(password: string): Promise<void> {
        const error = document.getElementById('password-prompt-error');

        try {
            // Get any encrypted tree data to verify password against
            const trees = TreeManager.getTrees();
            let verified = false;

            for (const tree of trees) {
                const encryptedData = TreeManager.getEncryptedData(tree.id);
                if (encryptedData) {
                    // Try to decrypt to verify password
                    await decrypt(encryptedData, password);
                    verified = true;
                    break;
                }
            }

            // If no encrypted data found but session is unlocked, verify against session
            if (!verified && CryptoSession.isUnlocked()) {
                // Session is unlocked, assume password is correct
                verified = true;
            }

            if (!verified) {
                // No encrypted data to verify against - just disable
                verified = true;
            }

            // Password verified - unlock session to decrypt data
            // Find salt from any encrypted tree
            let salt: Uint8Array | undefined;
            for (const tree of trees) {
                const encryptedData = TreeManager.getEncryptedData(tree.id);
                if (encryptedData) {
                    salt = new Uint8Array(atob(encryptedData.salt).split('').map(c => c.charCodeAt(0)));
                    break;
                }
            }
            if (salt) {
                await CryptoSession.unlock(password, salt);
            }

            // Disable encryption setting FIRST (so saves will be unencrypted)
            SettingsManager.setEncryption(false);

            // Re-save all trees to decrypt them
            for (const tree of trees) {
                const data = await TreeManager.getTreeDataAsync(tree.id as TreeId);
                if (data) {
                    await TreeManager.saveTreeDataAsync(tree.id as TreeId, data);
                }
            }

            // Now lock the session
            CryptoSession.lock();

            // Close dialog and update UI
            document.getElementById('password-prompt-modal')?.classList.remove('active');
            this.passwordPromptCallback = null;
            this.passwordPromptCallbackManagesDialog = false;

            this.updateEncryptionStatus();
            this.showToast(strings.encryption.encryptionDisabled);

        } catch {
            // Wrong password - show error and keep dialog open
            if (error) {
                error.textContent = strings.encryption.wrongPassword;
                error.style.display = 'block';
            }
            // Clear input for retry
            const input = document.getElementById('password-prompt-input') as HTMLInputElement;
            if (input) {
                input.value = '';
                input.focus();
            }

            // Keep checkbox checked since disable failed
            const toggle = document.getElementById('encryption-toggle') as HTMLInputElement;
            if (toggle) toggle.checked = true;
        }
    }

    /**
     * Update encryption status label
     */
    private updateEncryptionStatus(): void {
        const status = document.getElementById('encryption-status');
        const toggle = document.getElementById('encryption-toggle') as HTMLInputElement;
        if (status) {
            status.textContent = SettingsManager.isEncryptionEnabled()
                ? strings.encryption.encryptionEnabled
                : strings.encryption.encryptionDisabled;
        }
        if (toggle) {
            toggle.checked = SettingsManager.isEncryptionEnabled();
        }
    }

    // ==================== PASSWORD SETUP DIALOG ====================

    /**
     * Show password setup dialog (for enabling encryption)
     */
    showPasswordSetupDialog(): void {
        const modal = document.getElementById('password-setup-modal');
        const input = document.getElementById('password-setup-input') as HTMLInputElement;
        const confirm = document.getElementById('password-setup-confirm') as HTMLInputElement;
        const error = document.getElementById('password-setup-error');

        if (!modal || !input || !confirm) return;

        // Clear fields
        input.value = '';
        confirm.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        modal.classList.add('active');
        input.focus();

        // Handle Enter key - first input focuses second, second confirms
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirm.focus();
            }
        };
        confirm.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmPasswordSetup();
            }
        };
    }

    /**
     * Close password setup dialog
     */
    closePasswordSetupDialog(): void {
        document.getElementById('password-setup-modal')?.classList.remove('active');
        // Reset encryption toggle if user cancels
        this.updateEncryptionStatus();
    }

    /**
     * Confirm password setup and enable encryption
     */
    async confirmPasswordSetup(): Promise<void> {
        const input = document.getElementById('password-setup-input') as HTMLInputElement;
        const confirm = document.getElementById('password-setup-confirm') as HTMLInputElement;
        const error = document.getElementById('password-setup-error');

        if (!input || !confirm) return;

        const password = input.value;
        const confirmPassword = confirm.value;

        // Validate password
        if (password.length < 6) {
            if (error) {
                error.textContent = strings.encryption.minLength;
                error.style.display = 'block';
            }
            return;
        }

        if (password !== confirmPassword) {
            if (error) {
                error.textContent = strings.encryption.passwordMismatch;
                error.style.display = 'block';
            }
            return;
        }

        try {
            // Unlock session with new password
            await CryptoSession.unlock(password);

            // Enable encryption in settings
            SettingsManager.setEncryption(true);

            // Re-save all trees to encrypt them immediately
            const trees = TreeManager.getTrees();
            for (const tree of trees) {
                const data = await TreeManager.getTreeDataAsync(tree.id as TreeId);
                if (data) {
                    await TreeManager.saveTreeDataAsync(tree.id as TreeId, data);
                }
            }

            // Close dialog and update UI
            document.getElementById('password-setup-modal')?.classList.remove('active');
            this.updateEncryptionStatus();
            this.showToast(strings.encryption.encryptionEnabled);
        } catch (err) {
            if (error) {
                error.textContent = strings.encryption.decryptionFailed;
                error.style.display = 'block';
            }
        }
    }

    // ==================== PASSWORD PROMPT DIALOG ====================

    /**
     * Show password prompt dialog
     * @param callback Called with password when user submits
     */
    showPasswordPrompt(callback: (password: string) => void): void {
        this.passwordPromptCallback = callback;

        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');

        if (!modal || !input) return;

        // Clear fields
        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        modal.classList.add('active');
        input.focus();

        // Handle Enter key
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitPasswordPrompt();
            }
        };
    }

    /**
     * Submit password from prompt dialog
     */
    async submitPasswordPrompt(): Promise<void> {
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');

        if (!input || !this.passwordPromptCallback) return;

        const password = input.value;

        if (!password) {
            if (error) {
                error.textContent = strings.encryption.enterPassword;
                error.style.display = 'block';
            }
            return;
        }

        // Check if we have pending encrypted data to validate against
        if (this.pendingEncryptedData) {
            try {
                // Try to decrypt to validate password
                await decrypt(this.pendingEncryptedData, password);

                // Password is correct - unlock session
                const salt = new Uint8Array(atob(this.pendingEncryptedData.salt).split('').map(c => c.charCodeAt(0)));
                await CryptoSession.unlock(password, salt);

                // Close dialog
                document.getElementById('password-prompt-modal')?.classList.remove('active');

                // Call callback
                this.passwordPromptCallback(password);
                this.passwordPromptCallback = null;
                this.pendingEncryptedData = null;
            } catch {
                // Wrong password
                if (error) {
                    error.textContent = strings.encryption.wrongPassword;
                    error.style.display = 'block';
                }
                input.select();
            }
        } else if (this.passwordPromptCallbackManagesDialog) {
            // Callback handles validation and closing
            const callback = this.passwordPromptCallback;
            this.passwordPromptCallback = null;
            await callback(password);
        } else {
            // No validation data - just pass password through
            document.getElementById('password-prompt-modal')?.classList.remove('active');
            this.passwordPromptCallback(password);
            this.passwordPromptCallback = null;
        }
    }

    /**
     * Cancel password prompt
     * Resets encryption checkbox if this was for disabling encryption
     */
    cancelPasswordPrompt(): void {
        document.getElementById('password-prompt-modal')?.classList.remove('active');
        this.passwordPromptCallback = null;
        this.passwordPromptCallbackManagesDialog = false;
        this.pendingEncryptedData = null;
        this.pendingEncryptedImport = null;

        // Reset encryption checkbox to checked (if it was being disabled)
        if (SettingsManager.isEncryptionEnabled()) {
            const toggle = document.getElementById('encryption-toggle') as HTMLInputElement;
            if (toggle) toggle.checked = true;
        }
    }

    /**
     * Set pending encrypted data for password validation
     */
    setPendingEncryptedData(data: EncryptedData): void {
        this.pendingEncryptedData = data;
    }

    /**
     * Check if CryptoSession is unlocked
     */
    isCryptoUnlocked(): boolean {
        return CryptoSession.isUnlocked();
    }

    // ==================== EXPORT PASSWORD DIALOG ====================

    /**
     * Show export password dialog
     * @param callback Called with password (or null for no password) when user confirms
     */
    showExportPasswordDialog(callback: (password: string | null) => void): void {
        this.exportPasswordCallback = callback;

        const modal = document.getElementById('export-password-modal');
        const input = document.getElementById('export-password-input') as HTMLInputElement;
        const confirm = document.getElementById('export-password-confirm') as HTMLInputElement;
        const error = document.getElementById('export-password-error');

        if (!modal || !input || !confirm) return;

        // Setup dialog stack - this is a terminal dialog (no parent to return to)
        this.clearDialogStack();
        this.pushDialog('export-password-modal');

        // Clear fields
        input.value = '';
        confirm.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }

        // Show/hide audit log checkbox based on whether tree has entries
        const auditLogSection = document.getElementById('export-audit-log-section');
        const auditLogToggle = document.getElementById('export-audit-log-toggle') as HTMLInputElement;
        const exportTreeId = this.getExportTargetTreeId() || DataManager.getCurrentTreeId();
        if (auditLogSection && auditLogToggle && exportTreeId) {
            const hasEntries = AuditLogManager.hasEntries(exportTreeId);
            auditLogSection.style.display = hasEntries ? 'block' : 'none';
            auditLogToggle.checked = false;
        }

        modal.classList.add('active');
        input.focus();

        // Handle Enter key - first input focuses second, second confirms
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirm.focus();
            }
        };
        confirm.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmExportPassword();
            }
        };
    }

    /**
     * Close export password dialog
     */
    closeExportPasswordDialog(): void {
        document.getElementById('export-password-modal')?.classList.remove('active');
        this.clearDialogStack();
        if (this.exportPasswordCallback) {
            this.exportPasswordCallback = null;
        }
    }

    /**
     * Export without password (no encryption)
     */
    exportWithoutPassword(): void {
        if (!this.exportPasswordCallback) return;

        document.getElementById('export-password-modal')?.classList.remove('active');
        this.clearDialogStack();
        this.exportPasswordCallback(null);
        this.exportPasswordCallback = null;
    }

    /**
     * Confirm export password and proceed with encrypted export
     */
    confirmExportPassword(): void {
        const input = document.getElementById('export-password-input') as HTMLInputElement;
        const confirm = document.getElementById('export-password-confirm') as HTMLInputElement;
        const error = document.getElementById('export-password-error');

        if (!input || !confirm || !this.exportPasswordCallback) return;

        const password = input.value;
        const confirmPassword = confirm.value;

        // Password is required for encrypted export
        if (password.length < 6) {
            if (error) {
                error.textContent = strings.encryption.minLength;
                error.style.display = 'block';
            }
            return;
        }

        if (password !== confirmPassword) {
            if (error) {
                error.textContent = strings.encryption.passwordMismatch;
                error.style.display = 'block';
            }
            return;
        }

        // Close dialog and call callback with password
        document.getElementById('export-password-modal')?.classList.remove('active');
        this.clearDialogStack();
        this.exportPasswordCallback(password);
        this.exportPasswordCallback = null;
    }

    /**
     * Get CryptoSession for external use
     */
    getCryptoSession(): typeof CryptoSession {
        return CryptoSession;
    }

    // ==================== VIEW MODE ====================

    /**
     * Check if in view mode (proxy to DataManager)
     */
    isViewMode(): boolean {
        return DataManager.isViewMode();
    }

    /**
     * Show the view mode banner
     */
    showViewModeBanner(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('view-mode');

        // Update go-online link with tree name
        this.updateViewModeGoOnlineLink();
    }

    /**
     * Update view mode go-online link with tree name
     */
    private updateViewModeGoOnlineLink(): void {
        const treeName = DataManager.getCurrentEmbeddedTreeName();
        if (!treeName) return;

        const encodedName = encodeURIComponent(treeName);
        const url = `https://stromapp.info?import=from-file&name=${encodedName}`;

        const link = document.getElementById('view-mode-go-online');
        if (link) {
            link.setAttribute('href', url);
        }
    }

    /**
     * Hide the view mode banner
     */
    hideViewModeBanner(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.remove('visible');
        }
        document.body.classList.remove('view-mode');
    }

    /**
     * Show the existing export dialog (tree from this export already exists)
     */
    showExistingExportDialog(): void {
        const existingTree = DataManager.getExistingTreeFromExport();
        if (existingTree) {
            const nameEl = document.getElementById('existing-export-tree-name');
            if (nameEl) {
                nameEl.textContent = `"${existingTree.name}"`;
            }
        }
        document.getElementById('existing-export-modal')?.classList.add('active');
    }

    /**
     * Close existing export dialog
     */
    closeExistingExportDialog(): void {
        document.getElementById('existing-export-modal')?.classList.remove('active');
    }

    /**
     * View the stored version (switch to localStorage tree)
     */
    viewStoredVersion(): void {
        this.closeExistingExportDialog();
        DataManager.switchToStoredVersion();
        this.hideViewModeBanner();
        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * View the embedded version (stay in view mode)
     */
    viewEmbeddedVersion(): void {
        this.closeExistingExportDialog();
        // Already in view mode, just render
        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * Update stored version with embedded data
     */
    updateStoredVersion(): void {
        this.closeExistingExportDialog();
        DataManager.importFromViewMode('update');
        this.hideViewModeBanner();
        this.showToast(strings.viewMode.updateSuccess);
        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * Show the view mode import dialog (from view mode banner)
     */
    showViewModeImportDialog(): void {
        const envelope = DataManager.getEmbeddedEnvelope();
        if (envelope) {
            const nameEl = document.getElementById('import-tree-name');
            if (nameEl) {
                nameEl.textContent = `"${envelope.treeName}"`;
            }
        }
        document.getElementById('import-view-mode-modal')?.classList.add('active');
    }

    /**
     * Close import view mode dialog
     */
    closeImportViewModeDialog(): void {
        document.getElementById('import-view-mode-modal')?.classList.remove('active');
    }

    /**
     * Import embedded trees to storage (handles both single and multiple trees)
     * Always creates new trees, adds date suffix if name already exists
     */
    importAsNew(): void {
        this.closeImportViewModeDialog();
        this.closeExistingExportDialog();

        // Import all embedded trees (works for single tree too)
        const result = DataManager.importAllEmbeddedTrees();
        this.hideViewModeBanner();

        if (result.imported > 1) {
            this.showToast(strings.viewMode.importAllSuccess(result.imported));
        } else {
            this.showToast(strings.viewMode.importSuccess);
        }

        this.updateTreeSwitcher();
        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * Import as copy
     */
    importAsCopy(): void {
        this.closeImportViewModeDialog();
        DataManager.importFromViewMode('copy');
        this.hideViewModeBanner();
        this.showToast(strings.viewMode.importSuccess);
        this.updateTreeSwitcher();
        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * Initialize view mode UI based on DataManager state
     * Called after init to set up view mode banner if needed
     */
    initViewMode(): void {
        // First check for newer version data (embedded)
        if (DataManager.hasNewerVersionData()) {
            const source = DataManager.getNewerVersionSource();
            if (source === 'embedded') {
                this.showNewerVersionViewModeDialog();
            }
            return;
        }

        if (DataManager.isViewMode()) {
            // Check if import is blocked due to version
            if (DataManager.isImportBlocked()) {
                this.showViewModeBannerNoImport();
            } else {
                this.showViewModeBanner();
                // Update tree switcher to show embedded trees
                this.updateTreeSwitcher();
            }
        }
    }

    // ==================== VERSION COMPATIBILITY ====================

    /**
     * Show newer version warning dialog for storage (blocking - no continue option)
     */
    showNewerVersionStorageDialog(): void {
        const check = DataManager.checkStorageVersion();

        const yourVersionEl = document.getElementById('storage-your-version');
        const dataVersionEl = document.getElementById('storage-data-version');

        if (yourVersionEl) {
            yourVersionEl.textContent = String(check.currentVersion);
        }
        if (dataVersionEl) {
            dataVersionEl.textContent = String(check.dataVersion ?? '?');
        }

        document.getElementById('newer-version-storage-modal')?.classList.add('active');
    }

    /**
     * Show newer version warning dialog for view mode (allows viewing, blocks import)
     */
    showNewerVersionViewModeDialog(): void {
        const info = DataManager.getNewerVersionInfo();

        const yourVersionEl = document.getElementById('viewmode-your-version');
        const dataVersionEl = document.getElementById('viewmode-data-version');

        if (yourVersionEl) {
            yourVersionEl.textContent = String(info?.currentVersion ?? 1);
        }
        if (dataVersionEl) {
            dataVersionEl.textContent = String(info?.dataVersion ?? '?');
        }

        document.getElementById('newer-version-viewmode-modal')?.classList.add('active');
    }

    /**
     * Close newer version view mode dialog
     */
    closeNewerVersionViewMode(): void {
        document.getElementById('newer-version-viewmode-modal')?.classList.remove('active');
    }

    /**
     * Export storage data and close (for storage version mismatch)
     */
    exportStorageAndClose(): void {
        // Export all trees as JSON
        const trees = TreeManager.getTrees();
        const allData: Record<string, unknown> = {};

        for (const tree of trees) {
            const rawData = localStorage.getItem(`strom-tree-${tree.id}`);
            if (rawData) {
                try {
                    allData[tree.id] = {
                        name: tree.name,
                        data: JSON.parse(rawData)
                    };
                } catch {
                    // Skip invalid data
                }
            }
        }

        const dataStr = JSON.stringify(allData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'strom-backup-all-trees.json';
        a.click();
        URL.revokeObjectURL(a.href);

        // Don't close dialog - let user close the app/tab manually
    }

    /**
     * View newer version data in read-only mode (import will be blocked)
     */
    viewNewerVersionData(): void {
        document.getElementById('newer-version-viewmode-modal')?.classList.remove('active');
        DataManager.viewNewerVersionData();

        // Show view mode banner (without import button functional)
        this.showViewModeBannerNoImport();

        TreeRenderer.render();
        setTimeout(() => ZoomPan.centerOnFocusWithContext(), 50);
    }

    /**
     * Show view mode banner with import disabled
     */
    showViewModeBannerNoImport(): void {
        const banner = document.getElementById('view-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('view-mode');

        // Disable import button
        const importBtn = document.getElementById('view-mode-import-btn');
        if (importBtn) {
            importBtn.setAttribute('disabled', 'true');
            importBtn.textContent = strings.validation.importBlocked;
            importBtn.onclick = () => {
                this.showAlert(strings.validation.importBlockedNewer, 'warning');
            };
        }
    }

    /**
     * Check storage version on startup
     * @returns true if OK to continue, false if blocked
     */
    checkStorageVersionOnStartup(): boolean {
        const check = DataManager.checkStorageVersion();
        if (!check.compatible) {
            this.showNewerVersionStorageDialog();
            return false;
        }
        return true;
    }

    /**
     * Check JSON version before import
     * @returns true if OK to import, false if blocked
     */
    checkJsonVersionBeforeImport(data: StromData): boolean {
        const check = DataManager.checkJsonVersion(data);
        if (!check.compatible) {
            const message = strings.validation.jsonNewerVersion
                .replace('%d', String(check.dataVersion))
                .replace('%d', String(check.currentVersion));
            this.showAlert(message, 'error');
            return false;
        }
        return true;
    }

    // ==================== EMBEDDED MODE ====================

    /**
     * Initialize embedded mode based on detected app mode
     */
    initEmbeddedMode(mode: AppMode): void {
        this.appMode = mode;

        if (mode === 'embedded') {
            this.showEmbeddedBanner();
            this.updateExportButtonForEmbedded();
            this.setupBeforeUnloadWarning();
        }
    }

    /**
     * Show the embedded mode banner
     */
    showEmbeddedBanner(): void {
        const banner = document.getElementById('embedded-mode-banner');
        if (banner) {
            banner.classList.add('visible');
        }
        document.body.classList.add('embedded-mode');

        // Update go-online links with tree name parameter
        this.updateGoOnlineLinks();
    }

    /**
     * Update go-online links with current tree name in URL
     */
    private updateGoOnlineLinks(): void {
        const metadata = TreeManager.getActiveTreeMetadata();
        const treeName = metadata?.name;
        if (!treeName) return;

        const encodedName = encodeURIComponent(treeName);
        const url = `https://stromapp.info?import=from-file&name=${encodedName}`;

        // Update banner link
        const bannerLink = document.getElementById('go-online-link');
        if (bannerLink) {
            bannerLink.setAttribute('href', url);
        }

        // Update info dialog link
        const infoLink = document.getElementById('embedded-info-go-online');
        if (infoLink) {
            infoLink.setAttribute('href', url);
        }
    }

    /**
     * Hide the embedded mode banner
     */
    hideEmbeddedBanner(): void {
        const banner = document.getElementById('embedded-mode-banner');
        if (banner) {
            banner.classList.remove('visible');
        }
        // Keep embedded-mode class on body for potential other UI adjustments
    }

    /**
     * Update export button text/title for embedded mode
     */
    private updateExportButtonForEmbedded(): void {
        // Update toolbar export button title
        const exportBtn = document.querySelector('.toolbar-buttons .menu-btn[onclick*="showExportMenu"]');
        if (exportBtn) {
            exportBtn.setAttribute('title', strings.embeddedMode.saveFileTitle);
        }
    }

    /**
     * Setup beforeunload warning for embedded mode
     */
    private setupBeforeUnloadWarning(): void {
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = strings.embeddedMode.unsavedWarning;
                return e.returnValue;
            }
        });
    }

    /**
     * Mark that data has changed (call after any data modification)
     */
    markDataChanged(): void {
        this.lastChangeTime = Date.now();
    }

    /**
     * Mark that data was exported (call after successful export)
     */
    markExported(): void {
        this.lastExportTime = Date.now();
    }

    /**
     * Check if there are unsaved changes since last export
     */
    hasUnsavedChanges(): boolean {
        return this.lastChangeTime > this.lastExportTime;
    }

    /**
     * Get current app mode
     */
    getAppMode(): AppMode {
        return this.appMode;
    }

    // ==================== CROSS-TREE NAVIGATION ====================

    /**
     * Switch to another tree and focus on a specific person
     * Used for cross-tree link navigation
     */
    switchToTreeAndFocus(treeId: TreeId, personId: PersonId): void {
        // Reset cross-tree navigation index when switching trees
        CrossTree.resetNavigationIndex();

        // Switch to the target tree
        if (DataManager.switchTree(treeId)) {
            // Update UI to reflect tree switch
            this.updateTreeSwitcher();

            // Re-render the tree
            TreeRenderer.restoreFromSession();
            TreeRenderer.render();

            // Focus on the person
            TreeRenderer.setFocus(personId, false);

            // Center view on the person
            ZoomPan.centerOnPerson(personId);
        }
    }

    // ==================== AUDIT LOG ====================

    toggleAuditLog(enabled: boolean): void {
        AuditLogManager.setEnabled(enabled);
        const status = document.getElementById('audit-log-status');
        if (status) {
            status.textContent = enabled
                ? strings.auditLog.enabled
                : strings.auditLog.disabled;
        }
    }

    showAuditLogDialog(treeId?: TreeId | string, parentDialogId?: string): void {
        const modal = document.getElementById('audit-log-modal');
        if (!modal) return;

        const targetTreeId = (treeId || DataManager.getCurrentTreeId()) as TreeId;
        if (!targetTreeId) return;

        // Store target tree id for clear action
        modal.dataset.treeId = targetTreeId;

        // Set tree name in header
        const titleEl = modal.querySelector('.audit-log-title-text');
        const treeMeta = TreeManager.getTreeMetadata(targetTreeId);
        if (titleEl && treeMeta) {
            titleEl.textContent = `${strings.auditLog.title} — ${treeMeta.name}`;
        }

        this.renderAuditLogEntries(targetTreeId);

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('audit-log-modal');
        modal.classList.add('active');
    }

    private renderAuditLogEntries(treeId: TreeId): void {
        const listEl = document.getElementById('audit-log-list');
        if (!listEl) return;

        const log = AuditLogManager.load(treeId);

        if (log.entries.length === 0) {
            listEl.innerHTML = `<div class="audit-log-empty">${strings.auditLog.empty}</div>`;
            const countEl = document.getElementById('audit-log-count');
            if (countEl) countEl.textContent = strings.auditLog.entries(0);
            return;
        }

        const countEl = document.getElementById('audit-log-count');
        if (countEl) countEl.textContent = strings.auditLog.entries(log.entries.length);

        // Render newest first
        const entries = [...log.entries].reverse();
        let html = '';
        for (const entry of entries) {
            const date = new Date(entry.t);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Icon based on action type
            let icon = '+';
            if (entry.a.includes('update')) icon = '✎';
            else if (entry.a.includes('delete') || entry.a.includes('remove')) icon = '−';
            else if (entry.a.includes('merge')) icon = '⇄';
            else if (entry.a === 'data.clear') icon = '!';
            else if (entry.a === 'data.load' || entry.a === 'data.import') icon = '↓';

            html += `
                <div class="audit-log-entry">
                    <span class="audit-log-time">${this.escapeHtml(timeStr)}</span>
                    <span class="audit-log-icon">${icon}</span>
                    <span class="audit-log-desc">${this.escapeHtml(entry.d)}</span>
                </div>
            `;
        }

        listEl.innerHTML = html;
    }

    closeAuditLogDialog(): void {
        document.getElementById('audit-log-modal')?.classList.remove('active');
        this.returnToParentDialog();
    }

    exportAuditLogTxt(): void {
        const modal = document.getElementById('audit-log-modal');
        const treeId = modal?.dataset.treeId as TreeId;
        if (!treeId) return;

        const log = AuditLogManager.load(treeId);
        if (log.entries.length === 0) return;

        const treeMeta = TreeManager.getTreeMetadata(treeId);
        const treeName = treeMeta?.name || 'tree';

        const lines: string[] = [];
        lines.push(`${strings.auditLog.title} — ${treeName}`);
        lines.push(`${strings.auditLog.entries(log.entries.length)}`);
        lines.push('');

        // Chronological order (oldest first) for TXT export
        for (const entry of log.entries) {
            const date = new Date(entry.t);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            lines.push(`${timeStr}  ${entry.d}`);
        }

        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${treeName.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async clearAuditLog(): Promise<void> {
        const modal = document.getElementById('audit-log-modal');
        const treeId = modal?.dataset.treeId as TreeId;
        if (!treeId) return;

        const confirmed = await this.showConfirm(strings.auditLog.clearConfirm);
        if (!confirmed) return;

        AuditLogManager.clear(treeId);
        this.renderAuditLogEntries(treeId);
    }
}

export const UI = new UIClass();
