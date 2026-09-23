/**
 * dialogs UI methods. Extracted from the original UIClass;
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

/** Options of UI.showConfirm (see there). */
export interface ConfirmOptions {
    /** Confirm button text; for destructive actions the verb ("Delete tree"). */
    confirmLabel?: string;
    /** Older alias of confirmLabel. */
    ok?: string;
    cancel?: string;
    /** 'danger' paints the confirm button in --danger instead of the primary green. */
    variant?: 'default' | 'danger';
}

export const dialogsMethods = uiModule({
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

            // Severity now reads from the dialog's type class + a colored dot.
            const titles = {
                info: strings.dialog.info,
                warning: strings.dialog.warning,
                error: strings.dialog.error
            };

            titleEl.innerHTML = `<span class="dialog-dot" aria-hidden="true"></span>${title || titles[type]}`;
            messageEl.textContent = message;

            // Hide options (not used for alert)
            if (optionsEl) optionsEl.innerHTML = '';

            // Show only OK button
            buttonsEl.innerHTML = `
                <button class="primary" id="confirm-ok-btn">${strings.buttons.ok}</button>
            `;

            const okBtn = document.getElementById('confirm-ok-btn');
            const close = () => {
                this.confirmEscape = null;
                modal.classList.remove('active');
                this.returnToParentDialog();
                resolve();
            };
            if (okBtn) okBtn.onclick = close;
            // A previous confirm/prompt left its overlay handler here — it
            // would settle THAT (long gone) promise and close this alert.
            modal.onclick = null;
            // Escape acknowledges the alert like OK does.
            this.confirmEscape = close;

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');
        });
    },

    /**
     * Show a custom confirm dialog (replacement for native confirm())
     * @param message The message to display
     * @param title Optional custom title — for a destructive action it names
     *   the object ("Delete Jan Novák?").
     * @param options Button labels and variant:
     *   - `confirmLabel` (alias `ok`): the confirm button's text. A destructive
     *     confirm says the verb ("Delete person"), never "Yes"/"OK".
     *   - `cancel`: the cancel button's text.
     *   - `variant: 'danger'`: the confirm button is painted in --danger, so a
     *     destructive dialog never offers a green primary button.
     */
    showConfirm(message: string, title?: string, options?: ConfirmOptions): Promise<boolean> {
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

            const danger = options?.variant === 'danger';
            // Set dialog type class
            modal.className = 'modal-overlay dialog-confirm' + (danger ? ' dialog-danger' : '');

            titleEl.textContent = title || strings.dialog.confirm;
            messageEl.textContent = message;

            // Hide options (not used for simple confirm)
            if (optionsEl) optionsEl.innerHTML = '';

            // Show Cancel and OK buttons
            const cancelLabel = options?.cancel || strings.buttons.cancel;
            const okLabel = options?.confirmLabel || options?.ok || strings.buttons.yes;

            buttonsEl.innerHTML = `
                <button class="secondary" id="confirm-cancel-btn">${this.escapeHtml(cancelLabel)}</button>
                <button class="primary${danger ? ' is-danger' : ''}" id="confirm-ok-btn">${this.escapeHtml(okLabel)}</button>
            `;

            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const okBtn = document.getElementById('confirm-ok-btn');

            // Helper to close and return to parent
            const closeAndReturn = () => {
                this.confirmEscape = null;
                modal.classList.remove('active');
                this.returnToParentDialog();
            };
            const cancel = () => {
                closeAndReturn();
                resolve(false);
            };

            if (cancelBtn) cancelBtn.onclick = cancel;

            if (okBtn) {
                okBtn.onclick = () => {
                    closeAndReturn();
                    resolve(true);
                };
            }

            // Also close on overlay click
            modal.onclick = (e) => {
                if (e.target === modal) cancel();
            };
            // Escape cancels — the awaiting caller must not hang forever.
            this.confirmEscape = cancel;

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');
        });
    },

    /**
     * A question with more than two answers. Resolves with the chosen
     * choice's `id`, or null when cancelled (Cancel button, Escape, overlay).
     * Choices are laid out left to right; the last one is the primary button.
     */
    showChoice(
        message: string,
        title: string,
        choices: { id: string; label: string; variant?: 'default' | 'danger' }[]
    ): Promise<string | null> {
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
            modal.className = 'modal-overlay dialog-confirm';
            titleEl.textContent = title;
            messageEl.textContent = message;
            if (optionsEl) optionsEl.innerHTML = '';

            buttonsEl.innerHTML = '';
            const closeAndReturn = () => {
                this.confirmEscape = null;
                modal.classList.remove('active');
                this.returnToParentDialog();
            };
            const settle = (value: string | null) => {
                closeAndReturn();
                resolve(value);
            };
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'secondary';
            cancelBtn.id = 'confirm-cancel-btn';
            cancelBtn.textContent = strings.buttons.cancel;
            cancelBtn.onclick = () => settle(null);
            buttonsEl.appendChild(cancelBtn);
            choices.forEach((choice, i) => {
                const btn = document.createElement('button');
                const primary = i === choices.length - 1;
                btn.className = (primary ? 'primary' : 'secondary') + (choice.variant === 'danger' ? ' is-danger' : '');
                btn.dataset.choice = choice.id;
                btn.textContent = choice.label;
                btn.onclick = () => settle(choice.id);
                buttonsEl.appendChild(btn);
            });

            modal.onclick = (e) => {
                if (e.target === modal) settle(null);
            };
            this.confirmEscape = () => settle(null);
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');
        });
    },

    /**
     * Ask before deleting a person: title names them, the message lists the
     * links that vanish with them, and says Undo brings it all back.
     * @param lead optional sentence put before the links (e.g. "has no
     *   relationships left" when offered after removing the last one).
     */
    confirmDeletePersonDialog(personId: PersonId, lead?: string, cancelLabel?: string): Promise<boolean> {
        const person = DataManager.getPerson(personId);
        if (!person) return Promise.resolve(false);
        const d = strings.danger;
        const name = `${person.firstName} ${person.lastName}`.trim() || '?';
        const birthYear = person.birthDate?.split('-')[0];
        const label = birthYear ? `${name} (*${birthYear})` : name;
        const partners = new Set<string>();
        for (const pid of person.partnerships) {
            const ps = DataManager.getPartnership(pid);
            if (!ps) continue;
            const other = ps.person1Id === personId ? ps.person2Id : ps.person1Id;
            if (other) partners.add(other);
        }
        const links = d.personLinks(person.gender, person.parentIds.length, partners.size, person.childIds.length);
        const message = [lead, links, d.undoHint].filter(Boolean).join(' ');
        return this.showConfirm(message, d.deletePersonTitle(label), {
            confirmLabel: d.deletePerson,
            cancel: cancelLabel,
            variant: 'danger',
        });
    },

    /**
     * Put the confirm box's default Cancel / OK pair back. Dialogs that reuse
     * the confirmation modal for a pick-one list (search results, hidden
     * partners) would otherwise inherit the last confirm's buttons — a red
     * "Delete person" offering to focus a search hit.
     */
    resetConfirmButtons(okLabel: string = strings.buttons.ok): void {
        const modal = document.getElementById('confirmation-modal');
        const buttonsEl = document.getElementById('confirm-buttons');
        if (modal) modal.className = 'modal-overlay dialog-confirm' + (modal.classList.contains('active') ? ' active' : '');
        if (!buttonsEl) return;
        buttonsEl.innerHTML = `
            <button class="secondary" id="confirm-cancel-btn">${this.escapeHtml(strings.buttons.cancel)}</button>
            <button class="primary" id="confirm-ok-btn">${this.escapeHtml(okLabel)}</button>
        `;
    },

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

            titleEl.textContent = strings.dialog.confirm;
            messageEl.textContent = message;

            // Add input field in options area
            if (optionsEl) {
                optionsEl.innerHTML = `
                    <input type="text" id="prompt-input" class="prompt-input" value="${this.escapeHtml(defaultValue || '')}" autocomplete="off">
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
                this.confirmEscape = null;
                modal.classList.remove('active');
                this.returnToParentDialog();
            };
            const cancel = () => {
                closeAndReturn();
                resolve(null);
            };

            if (cancelBtn) cancelBtn.onclick = cancel;

            if (okBtn) {
                okBtn.onclick = () => {
                    const value = inputEl?.value?.trim() || null;
                    closeAndReturn();
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
                        // Handled here — the global Escape handler must not
                        // then close the dialog underneath as well.
                        e.stopPropagation();
                        cancelBtn?.click();
                    }
                };
            }

            // Also close on overlay click
            modal.onclick = (e) => {
                if (e.target === modal) cancel();
            };
            // Escape cancels — the awaiting caller must not hang forever.
            this.confirmEscape = cancel;

            // Add to dialog stack
            this.pushDialog('confirmation-modal');
            modal.classList.add('active');

            // Focus input
            setTimeout(() => inputEl?.select(), 50);
        });
    },
});
