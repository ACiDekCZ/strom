/**
 * encryption ui UI methods. Extracted from the original UIClass;
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
import { PrivacyMode } from '../privacy.js';
import { totalPhotoBytes } from '../photo.js';
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

export const encryptionUiMethods = uiModule({
    // ---- ENCRYPTION ----
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
    },

    /**
     * Show password prompt to disable encryption
     */
    showDisableEncryptionPrompt(): void {
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
    },

    /**
     * Try to disable encryption with given password
     */
    async tryDisableEncryption(password: string): Promise<void> {
        const error = document.getElementById('password-prompt-error');

        try {
            // Get any encrypted tree data to verify password against
            const trees = TreeManager.getTrees();
            let verified = false;

            for (const tree of trees) {
                const encryptedData = await TreeManager.getEncryptedData(tree.id);
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
                const encryptedData = await TreeManager.getEncryptedData(tree.id);
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
                const data = await TreeManager.getTreeData(tree.id as TreeId);
                if (data) {
                    await TreeManager.saveTreeData(tree.id as TreeId, data);
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
    },

    /**
     * Update encryption status label
     */
    updateEncryptionStatus(): void {
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
    },

    // ---- PASSWORD SETUP DIALOG ----
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
    },

    /**
     * Close password setup dialog
     */
    closePasswordSetupDialog(): void {
        document.getElementById('password-setup-modal')?.classList.remove('active');
        // Reset encryption toggle if user cancels
        this.updateEncryptionStatus();
    },

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
                const data = await TreeManager.getTreeData(tree.id as TreeId);
                if (data) {
                    await TreeManager.saveTreeData(tree.id as TreeId, data);
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
    },

    // ---- PASSWORD PROMPT DIALOG ----
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
    },

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
    },

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
    },

    /**
     * Set pending encrypted data for password validation
     */
    setPendingEncryptedData(data: EncryptedData): void {
        this.pendingEncryptedData = data;
    },

    /**
     * Check if CryptoSession is unlocked
     */
    isCryptoUnlocked(): boolean {
        return CryptoSession.isUnlocked();
    },

    // ---- EXPORT PASSWORD DIALOG ----
    /**
     * Show export password dialog
     * @param callback Called with password (or null for no password) when user confirms
     * @param includeAuditLogOption Show audit log checkbox (only for full backup / Export All)
     */
    /** Current value of the export dialog's privacy-mode selector. */
    readExportPrivacyMode(): PrivacyMode {
        const sel = document.getElementById('export-privacy-mode') as HTMLSelectElement | null;
        const v = sel?.value;
        return (v === 'initials' || v === 'anonymous' || v === 'minimal') ? v : 'full';
    },

    /** Whether the export dialog's "without photos" checkbox is ticked. */
    readExportStripPhotos(): boolean {
        return (document.getElementById('export-strip-photos') as HTMLInputElement | null)?.checked || false;
    },

    showExportPasswordDialog(
        callback: (password: string | null) => void,
        includeAuditLogOption = false,
        options: { defaultPrivacy?: PrivacyMode; passwordless?: boolean } = {}
    ): void {
        this.exportPasswordCallback = callback;

        // Privacy mode selector: default per caller (share exports -> initials).
        const privacySelect = document.getElementById('export-privacy-mode') as HTMLSelectElement | null;
        if (privacySelect) privacySelect.value = options.defaultPrivacy ?? 'full';

        // Passwordless mode (e.g. GEDCOM, which cannot be encrypted): hide the
        // password inputs and the "export encrypted" button; only privacy applies.
        const passwordless = options.passwordless ?? false;
        const pwGroup = document.getElementById('export-password-group');
        const pwConfirmGroup = document.getElementById('export-password-confirm-group');
        const encryptedBtn = document.getElementById('export-with-password-btn');
        if (pwGroup) pwGroup.style.display = passwordless ? 'none' : '';
        if (pwConfirmGroup) pwConfirmGroup.style.display = passwordless ? 'none' : '';
        if (encryptedBtn) encryptedBtn.style.display = passwordless ? 'none' : '';

        // "Export without photos" — shown only when the active tree has photos.
        const photosSection = document.getElementById('export-photos-section');
        const photoSizeEl = document.getElementById('export-photo-size');
        const stripToggle = document.getElementById('export-strip-photos') as HTMLInputElement | null;
        const photoBytes = totalPhotoBytes(DataManager.getData());
        if (photosSection) photosSection.style.display = photoBytes > 0 ? 'block' : 'none';
        if (photoSizeEl) photoSizeEl.textContent = photoBytes > 0 ? ` (${Math.round(photoBytes / 1024)} kB)` : '';
        if (stripToggle) stripToggle.checked = false;

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

        // Show audit log checkbox only for full backup (Export All) when audit logging is enabled
        const auditLogSection = document.getElementById('export-audit-log-section');
        const auditLogToggle = document.getElementById('export-audit-log-toggle') as HTMLInputElement;
        if (auditLogSection && auditLogToggle) {
            if (includeAuditLogOption && SettingsManager.isAuditLogEnabled()) {
                const trees = TreeManager.getTrees();
                const hasAnyEntries = trees.some(t => AuditLogManager.hasEntries(t.id));
                auditLogSection.style.display = hasAnyEntries ? 'block' : 'none';
            } else {
                auditLogSection.style.display = 'none';
            }
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
    },

    /**
     * Close export password dialog
     */
    closeExportPasswordDialog(): void {
        document.getElementById('export-password-modal')?.classList.remove('active');
        this.clearDialogStack();
        if (this.exportPasswordCallback) {
            this.exportPasswordCallback = null;
        }
    },

    /**
     * Export without password (no encryption)
     */
    exportWithoutPassword(): void {
        if (!this.exportPasswordCallback) return;

        document.getElementById('export-password-modal')?.classList.remove('active');
        this.clearDialogStack();
        this.exportPasswordCallback(null);
        this.exportPasswordCallback = null;
    },

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
    },

    /**
     * Get CryptoSession for external use
     */
    getCryptoSession(): typeof CryptoSession {
        return CryptoSession;
    },
});
