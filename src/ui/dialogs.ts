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
    },

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

            titleEl.innerHTML = `<span class="dialog-icon">✏️</span>${strings.dialog.confirm}`;
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
    },
});
