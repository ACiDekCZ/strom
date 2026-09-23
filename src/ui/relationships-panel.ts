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
import { autoGrowAll } from './autogrow.js';
import { onAllDialogsClosed } from './dialog-focus.js';

import { iconSvg } from '../icons.js';
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

        // A fresh open starts the staged session: immediate operations
        // (relation type, witnesses, citations, add/remove, reassign) apply
        // live, but only Save keeps them — as one undo step (review S9).
        if (!preservePending) this.beginRelationshipsSession();

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

        // "Reassign" moves the parent link to a different person in one step.
        content.querySelectorAll('.rel-reassign-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                this.openReassignPicker(personId,
                    target.dataset.relId as PersonId,
                    target.dataset.relType as 'parent' | 'child');
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

        // Partnership citations: cite opens the source picker, the remove cross uncites.
        content.querySelectorAll('.partnership-cite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const partnershipId = (e.currentTarget as HTMLElement).dataset.partnershipId as PartnershipId;
                this.showSourcePickerForPartnership(partnershipId);
            });
        });
        content.querySelectorAll('.partnership-uncite').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget as HTMLElement;
                const partnershipId = el.dataset.partnershipId as PartnershipId;
                const sourceId = el.dataset.sourceId!;
                DataManager.uncitePartnership(partnershipId, sourceId);
                this.refreshRelationshipsPanel();
            });
        });

        // Wedding witnesses: the register names them, so they are typed in as
        // written; the remove cross removes one.
        content.querySelectorAll('.partnership-witness-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const partnershipId = (e.currentTarget as HTMLElement).dataset.partnershipId as PartnershipId;
                const name = await this.showPrompt(strings.relationships.witnessPrompt);
                if (!name?.trim()) return;
                DataManager.addPartnershipParticipant(partnershipId, { name: name.trim() });
                this.refreshRelationshipsPanel();
            });
        });
        content.querySelectorAll('.partnership-witness-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget as HTMLElement;
                DataManager.removePartnershipParticipant(
                    el.dataset.partnershipId as PartnershipId, el.dataset.participantId!);
                this.refreshRelationshipsPanel();
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
        // A register note runs to paragraphs; let the box show them.
        autoGrowAll(content, '.partnership-note');

        // Attach event listeners for start date (pending change)
        content.querySelectorAll('.partnership-start-date').forEach(input => {
            input.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                const partnershipId = target.dataset.partnershipId as PartnershipId;
                const normalized = normalizeDateInput(target.value);
                target.classList.toggle('invalid', normalized === null);
                if (normalized === null) return;
                // Keep the locale's input form (15.5.1880), not raw ISO.
                target.value = formatDateForInput(normalized);
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
                target.value = formatDateForInput(normalized);
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
        content.querySelectorAll('.partnership-start-date').forEach(input => {
            (input as HTMLInputElement).onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const partnershipId = (input as HTMLInputElement).dataset.partnershipId;
                    const placeInput = content.querySelector(`.partnership-start-place[data-partnership-id="${CSS.escape(partnershipId ?? '')}"]`) as HTMLInputElement;
                    placeInput?.focus();
                }
            };
        });

        content.querySelectorAll('.partnership-start-place').forEach(input => {
            (input as HTMLInputElement).onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const partnershipId = (input as HTMLInputElement).dataset.partnershipId;
                    const noteInput = content.querySelector(`.partnership-note[data-partnership-id="${CSS.escape(partnershipId ?? '')}"]`) as HTMLTextAreaElement;
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
                    <select class="parent-rel-type-select" data-rel-child="${this.escapeHtml(childId)}" data-rel-parent="${this.escapeHtml(parentId)}">
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
                        <select class="rel-status-select" data-partnership-id="${this.escapeHtml(partnership.id)}">
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
                                data-partnership-id="${this.escapeHtml(partnership.id)}"
                                data-person-id="${this.escapeHtml(currentPersonId)}"
                                ${partnership.isPrimary ? 'checked' : ''}>
                            ${strings.labels.isPrimary}
                        </label>
                    ` : '';

                    partnershipDetailsHtml = `
                        <div class="partnership-dates">
                            <input type="text" class="partnership-start-date flex-date" autocomplete="off"
                                placeholder="${strings.placeholders.flexDate}"
                                data-partnership-id="${this.escapeHtml(partnership.id)}"
                                value="${this.escapeHtml(formatDateForInput(partnership.startDate))}"
                                title="${startDateLabel}">
                            <input type="text" class="partnership-start-place" list="places-datalist"
                                data-partnership-id="${this.escapeHtml(partnership.id)}"
                                value="${this.escapeHtml(partnership.startPlace || '')}"
                                placeholder="${strings.labels.startPlace}">
                            <input type="text" class="partnership-end-date flex-date" autocomplete="off"
                                placeholder="${strings.placeholders.flexDate}"
                                data-partnership-id="${this.escapeHtml(partnership.id)}"
                                value="${this.escapeHtml(formatDateForInput(partnership.endDate))}"
                                title="${endDateLabel}">
                        </div>
                        ${primaryCheckboxHtml}
                        <textarea class="partnership-note" data-partnership-id="${this.escapeHtml(partnership.id)}"
                            placeholder="${strings.labels.note}...">${this.escapeHtml(partnership.note || '')}</textarea>
                        <div class="partnership-citations sources-chips"${
                            // Citing a marriage record is research: same rule as on a
                            // person — hidden unless asked for, but never hidden once
                            // something is actually cited.
                            SettingsManager.isAdvancedFields() || partnership.sourceIds?.length
                                ? '' : ' style="display:none"'}>
                            ${(partnership.sourceIds ?? []).map(sid => {
                                const src = DataManager.getData().sources?.[sid];
                                return src ? `<span class="source-chip"><span class="source-chip-label" title="${this.escapeHtml(src.title)}">${this.escapeHtml(src.title)}</span><button type="button" class="source-chip-remove partnership-uncite" title="${this.escapeHtml(strings.sources.remove)}" aria-label="${this.escapeHtml(strings.sources.remove)}" data-partnership-id="${this.escapeHtml(partnership.id)}" data-source-id="${this.escapeHtml(sid)}">&times;</button></span>` : '';
                            }).join('')}
                            <button type="button" class="partnership-cite-btn" data-partnership-id="${this.escapeHtml(partnership.id)}">${iconSvg('book', { size: 13 })} ${strings.sources.citePartnership}</button>
                        </div>
                        <div class="partnership-witnesses sources-chips"${
                            // Wedding witnesses: research, like the citation
                            // above — shown on request, never hidden once the
                            // marriage entry actually named someone.
                            SettingsManager.isAdvancedFields() || partnership.participants?.length
                                ? '' : ' style="display:none"'}>
                            ${(partnership.participants ?? []).map(part => {
                                const linked = part.personId ? DataManager.getPerson(part.personId) : null;
                                const name = linked ? `${linked.firstName} ${linked.lastName}`.trim() : (part.name ?? '');
                                const title = [name, part.note].filter(Boolean).join(' — ');
                                return `<span class="source-chip"><span class="source-chip-label" title="${this.escapeHtml(title)}">${this.escapeHtml(name)}</span><button type="button" class="source-chip-remove partnership-witness-remove" title="${this.escapeHtml(strings.relationships.remove)}" aria-label="${this.escapeHtml(strings.relationships.remove)}" data-partnership-id="${this.escapeHtml(partnership.id)}" data-participant-id="${this.escapeHtml(part.id)}">&times;</button></span>`;
                            }).join('')}
                            <button type="button" class="partnership-witness-btn" data-partnership-id="${this.escapeHtml(partnership.id)}">${strings.relationships.addWitness}</button>
                        </div>
                    `;
                }
            }
            return `
                <div class="rel-item">
                    <span class="rel-item-name">
                        <span class="rel-item-icon">${iconSvg('user', { size: 16 })}</span>
                        ${this.escapeHtml(`${p.firstName} ${p.lastName}`)}
                    </span>
                    ${statusHtml}
                    ${relTypeHtml}
                    ${!isLocked && (type === 'parents' || type === 'children')
                        ? `<button class="rel-reassign-btn" data-rel-type="${relType[type]}" data-rel-id="${this.escapeHtml(p.id)}" title="${strings.relationships.reassignHeading}">⇄ ${strings.relationships.reassign}</button>`
                        : ''}
                    ${!isLocked ? `<button class="rel-remove-btn" data-rel-type="${relType[type]}" data-rel-id="${this.escapeHtml(p.id)}">
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

    /**
     * "I linked them to the wrong person": pick a different parent for the
     * link, nothing retyped. A 'parent' row moves THIS person's parent link;
     * a 'child' row moves that child away from this person.
     */
    openReassignPicker(personId: PersonId, relatedId: PersonId, relType: 'parent' | 'child'): void {
        const childId = relType === 'parent' ? personId : relatedId;
        const oldParentId = relType === 'parent' ? relatedId : personId;
        const child = DataManager.getPerson(childId);
        const oldParent = DataManager.getPerson(oldParentId);
        if (!child || !oldParent) return;
        const name = (p: Person) => `${p.firstName} ${p.lastName}`.trim() || '?';

        document.getElementById('reassign-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'reassign-modal';
        overlay.innerHTML = `
            <div class="modal reassign-modal modal--sm" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h2>${strings.relationships.reassignHeading}</h2>
                    <button class="close-btn" id="reassign-close" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <p class="reassign-hint">${this.escapeHtml(strings.relationships.reassignHint(name(child), name(oldParent)))}</p>
                <div id="reassign-picker"></div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (): void => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#reassign-close') as HTMLButtonElement).onclick = close;

        // Only valid new parents are offered: not the child, not its current
        // parents, and nobody from the child's own descendants (a cycle).
        const excluded = new Set<PersonId>([childId, ...child.parentIds]);
        const stack: PersonId[] = [childId];
        while (stack.length > 0) {
            const cur = DataManager.getPerson(stack.pop()!);
            for (const ch of cur?.childIds ?? []) {
                if (!excluded.has(ch)) { excluded.add(ch); stack.push(ch); }
            }
        }
        new PersonPicker({
            containerId: 'reassign-picker',
            persons: DataManager.getAllPersons().filter(p => !excluded.has(p.id as PersonId)),
            onSelect: (newParentId) => {
                close();
                const newParent = DataManager.getPerson(newParentId);
                if (DataManager.reassignParentChild(childId, oldParentId, newParentId)) {
                    this.showToast(strings.relationships.reassignDone(
                        name(child), newParent ? name(newParent) : '?'));
                } else {
                    this.showToast(strings.relationships.reassignFailed);
                }
                TreeRenderer.render();
                this.refreshSearch();
                if (this.relationshipsPanelPersonId) this.refreshRelationshipsPanel();
            },
        });
    },

    async removeRelationship(personId: PersonId, relatedId: PersonId, type: 'parent' | 'partner' | 'child' | 'sibling'): Promise<void> {
        // A locked person's links cannot change — say so instead of silently
        // doing nothing (the data layer refuses the removal).
        const involved: PersonId[] = [personId, relatedId];
        if (type === 'sibling') {
            const sib = DataManager.getPerson(relatedId);
            for (const par of DataManager.getPerson(personId)?.parentIds ?? []) {
                if (sib?.parentIds.includes(par)) involved.push(par);
            }
        }
        if (involved.some(id => DataManager.isPersonLocked(id))) {
            this.showToast(strings.relationships.removeLocked);
            return;
        }
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
                    // One removal for the user, one undo step.
                    DataManager.runBatch(null, () => {
                        for (const parentId of [...person.parentIds]) {
                            if (sibling.parentIds.includes(parentId)) {
                                DataManager.removeParentChild(parentId, relatedId);
                            }
                        }
                    });
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

            const shouldDelete = await this.confirmDeletePersonDialog(
                relatedId,
                strings.danger.orphanMessage(name),
                strings.relationships.orphanKeep,
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

        // Apply all pending partnership changes — one Save, one undo step.
        DataManager.runBatch(null, () => {
            for (const [partnershipId, changes] of this.pendingPartnershipChanges) {
                DataManager.updatePartnership(partnershipId, changes);
            }
        });

        if (this.pendingPartnershipChanges.size > 1) {
            const treeId = DataManager.getCurrentTreeId();
            AuditLogManager.endBatch(treeId, 'partnership.update',
                strings.auditLog.updatedPartnership('…', '…'));
        }

        // Clear pending changes
        this.pendingPartnershipChanges.clear();

        // Keep everything done in the dialog: ONE undo step, one save.
        if (this.relSessionOwned) {
            this.relSessionOwned = false;
            DataManager.commitEditSession(null);
        }

        // Re-render tree
        TreeRenderer.render();

        // Close panel and return to parent dialog via stack
        this.closeRelationshipsPanel();
    },

    /** Open the panel's DataManager edit session (see beginEditSession). */
    beginRelationshipsSession(): void {
        if (this.relSessionOwned) DataManager.rollbackEditSession();
        this.relSessionOwned = DataManager.beginEditSession();
        if (this.relSessionListener) return;
        this.relSessionListener = true;
        // The data was replaced under the panel (tree switch, restore, ...):
        // the data layer already dropped the session, so the panel goes too.
        window.addEventListener('strom:data-changed', () => {
            if (this.relSessionOwned && !DataManager.isEditSessionActive()) {
                this.relSessionOwned = false;
                this.pendingPartnershipChanges.clear();
                this.closeRelationshipsPanel();
            }
        });
        // Safety net: some flow closed every dialog without going through the
        // panel (e.g. "go to person" from a suggestion) — never leave the
        // session open behind a closed panel.
        onAllDialogsClosed(() => {
            if (!this.relSessionOwned) return;
            this.pendingPartnershipChanges.clear();
            this.relationshipsPanelPersonId = null;
            this.returnToEditPersonId = null;
            const idx = this.dialogStack.indexOf('relationships-modal');
            if (idx !== -1) this.dialogStack.splice(idx, 1);
            this.endRelationshipsSession();
        });
    },

    /** Discard the session's changes (no-op when nothing was changed). */
    endRelationshipsSession(): void {
        if (!this.relSessionOwned) return;
        this.relSessionOwned = false;
        if (DataManager.rollbackEditSession()) {
            TreeRenderer.render();
            this.refreshSearch();
        }
    },

    /** Unsaved = a pending form change OR an immediate operation since open. */
    hasRelationshipsChanges(): boolean {
        return this.pendingPartnershipChanges.size > 0
            || (this.relSessionOwned && DataManager.editSessionHasChanges());
    },

    /**
     * Cancel relationship editing - check for unsaved changes first
     */
    cancelRelationshipsPanel(): void {
        if (this.hasRelationshipsChanges()) {
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
        // Not a promise dialog — drop any stale Escape handler of one.
        this.confirmEscape = null;

        titleEl.innerHTML = `<span class="dialog-dot"></span>${strings.relationships.unsavedTitle}`;
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
        // Closing without Save discards the staged session (after Save it is
        // already committed and this is a no-op).
        this.endRelationshipsSession();

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
