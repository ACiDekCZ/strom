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
import { PrivacyMode, ContentOptions, ContentPreset, CONTENT_PRESETS, matchContentPreset, applyContentOptions } from '../privacy.js';
import { totalPhotoBytes } from '../photo.js';
import { totalAttachmentBytes } from '../attachments.js';
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

/** A button on a storage notice. */
interface NoticeAction { label: string; run: () => void }

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
        const showWrongPassword = () => {
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
        };

        // Verify against ANY encrypted record — trees first, then backups,
        // share baselines and audit logs. Only when nothing at all is
        // encrypted is there nothing to protect; an unlocked session alone
        // used to let ANY password switch encryption off (review S13).
        const { findAnyEncryptedRecord, reencodeSideStores } = await import('../encryption-migrate.js');
        const probe = await findAnyEncryptedRecord();
        if (probe) {
            try {
                await decrypt(probe, password);
            } catch {
                showWrongPassword();
                return;
            }
            // Password verified - unlock session to decrypt data
            const salt = new Uint8Array(atob(probe.salt).split('').map(c => c.charCodeAt(0)));
            await CryptoSession.unlock(password, salt);
        }

        // Close dialog first: from here on failures are not a password issue.
        document.getElementById('password-prompt-modal')?.classList.remove('active');
        this.passwordPromptCallback = null;
        this.passwordPromptCallbackManagesDialog = false;
        this.passwordPromptOnCancel = null;

        try {
            // Disable encryption setting FIRST (so saves will be unencrypted)
            SettingsManager.setEncryption(false);

            // Re-save all trees to decrypt them
            const trees = TreeManager.getTrees();
            for (const tree of trees) {
                const data = await TreeManager.getTreeData(tree.id as TreeId);
                if (data) {
                    TreeManager.saveTreeData(tree.id as TreeId, data);
                }
            }
            await TreeManager.flush();

            // Backups, share baselines and audit logs follow (review S23) —
            // they used to stay encrypted and unreadable forever.
            const failed = await reencodeSideStores();

            this.updateEncryptionStatus();
            this.showToast(strings.encryption.encryptionDisabled);
            if (failed > 0) this.showToast(strings.storageSafety.reencodeFailed(failed), 6000);
        } catch (err) {
            console.error('Disabling encryption failed', err);
            this.updateEncryptionStatus();
            this.showToast(strings.errors.saveFailed, 6000);
        } finally {
            // Now lock the session
            CryptoSession.lock();
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
                    TreeManager.saveTreeData(tree.id as TreeId, data);
                }
            }
            await TreeManager.flush();

            // Backups, share baselines and audit logs are encrypted too
            // (review S23) — they used to keep plaintext copies of the data.
            const { reencodeSideStores } = await import('../encryption-migrate.js');
            const failed = await reencodeSideStores();

            // Close dialog and update UI
            document.getElementById('password-setup-modal')?.classList.remove('active');
            this.updateEncryptionStatus();
            this.showToast(strings.encryption.encryptionEnabled);
            if (failed > 0) this.showToast(strings.storageSafety.reencodeFailed(failed), 6000);
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
                const callback = this.passwordPromptCallback;
                this.passwordPromptCallback = null;
                this.pendingEncryptedData = null;
                this.passwordPromptOnCancel = null;
                callback(password);
            } catch {
                // Wrong password
                if (error) {
                    error.textContent = strings.encryption.wrongPassword;
                    error.style.display = 'block';
                }
                input.select();
            }
        } else if (this.passwordPromptCallbackManagesDialog) {
            // Callback handles validation and closing. On success it clears
            // the managing flag (and closes the dialog); on a wrong password
            // it keeps the dialog open — the callback must survive for the
            // retry, so only drop it once the flag went false.
            await this.passwordPromptCallback(password);
            if (!this.passwordPromptCallbackManagesDialog) {
                this.passwordPromptCallback = null;
                this.passwordPromptOnCancel = null;
            }
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
        const onCancel = this.passwordPromptOnCancel;
        this.passwordPromptOnCancel = null;
        onCancel?.();

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

    // ---- LOCKED STATE / UNLOCK ENTRY ----
    /**
     * Prompt for the LOCAL encryption password (validated against a stored
     * encrypted tree; unlocks the session). Resolves true once unlocked and
     * `onUnlocked` finished, false when cancelled — cancelling leaves an
     * "Unlock" banner so the prompt can always be reopened (review V3).
     */
    async showLocalUnlockPrompt(onUnlocked?: () => Promise<void>): Promise<boolean> {
        const probe = await TreeManager.getFirstEncryptedData();
        if (!probe) return true;
        return new Promise<boolean>((resolve) => {
            this.setPendingEncryptedData(probe);
            this.showPasswordPrompt(async () => {
                // submitPasswordPrompt already verified + unlocked the session.
                this.hideLockedBanner();
                try {
                    await onUnlocked?.();
                } finally {
                    resolve(true);
                }
            });
            this.passwordPromptOnCancel = () => {
                this.showLockedBanner();
                resolve(false);
            };
        });
    },

    /**
     * Encryption is on but the session is locked: ask for the password
     * before an action that must write encrypted data. True when unlocked.
     */
    async ensureLocalUnlocked(): Promise<boolean> {
        if (!SettingsManager.isEncryptionEnabled() || CryptoSession.isUnlocked()) return true;
        if (!await TreeManager.hasEncryptedTrees()) return true;
        this.showToast(strings.storageSafety.unlockToContinue, 5000);
        return this.showLocalUnlockPrompt(async () => {
            await this.onLocalDataUnlocked?.();
        });
    },

    /**
     * Prompt for the password of an encrypted EMBEDDED file. Decrypts with a
     * key derived for that file only — never touches the local session
     * (review K8). The prompt stays open on a wrong password.
     */
    showEmbeddedPasswordPrompt(onDecrypted: () => Promise<void>): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');
        if (!modal || !input) return;

        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }
        this.pendingEncryptedData = null;
        this.passwordPromptCallback = async (password: string) => {
            const ok = await DataManager.decryptEmbeddedData(password);
            if (!ok) {
                if (error) {
                    error.textContent = strings.encryption.wrongPassword;
                    error.style.display = 'block';
                }
                input.select();
                return;
            }
            document.getElementById('password-prompt-modal')?.classList.remove('active');
            this.passwordPromptCallbackManagesDialog = false;
            this.hideLockedBanner();
            await onDecrypted();
        };
        this.passwordPromptCallbackManagesDialog = true;
        this.passwordPromptOnCancel = () => {
            this.showLockedBanner(() => this.showEmbeddedPasswordPrompt(onDecrypted));
        };

        modal.classList.add('active');
        input.focus();
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitPasswordPrompt();
            }
        };
    },

    /**
     * Non-blocking notice bar with an optional action button (shared by the
     * locked banner, the other-tab warning and storage errors).
     */
    showStorageNotice(id: string, message: string, action?: NoticeAction | NoticeAction[]): void {
        document.getElementById(id)?.remove();
        const el = document.createElement('div');
        el.id = id;
        el.className = 'storage-notice';
        el.setAttribute('role', 'status');
        const text = document.createElement('span');
        text.textContent = message;
        el.appendChild(text);
        for (const a of action ? [action].flat() : []) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pwa-update-btn';
            btn.textContent = a.label;
            btn.addEventListener('click', () => a.run());
            el.appendChild(btn);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'pwa-update-close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.textContent = '\u00d7';
        close.addEventListener('click', () => el.remove());
        el.appendChild(close);
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
    },

    /** "Data is locked — Unlock" bar; the button reopens the right prompt. */
    showLockedBanner(reopen?: () => void): void {
        this.lockedDataReopen = reopen ?? null;
        this.showStorageNotice('locked-data-notice', strings.storageSafety.lockedBanner, {
            label: strings.storageSafety.unlock,
            run: () => this.unlockLocalData(),
        });
        this.syncLockedState();
    },

    /**
     * Reopen the prompt that unlocks the data (the banner's and the locked
     * empty state's "Unlock"): the specific one the banner was raised with,
     * else the tree's own password or the local session password.
     */
    unlockLocalData(): void {
        if (this.lockedDataReopen) {
            this.lockedDataReopen();
            return;
        }
        // Session already unlocked, yet the open tree is unreadable: it
        // carries another key, so its own password is needed.
        const treeId = DataManager.getCurrentTreeId();
        if (CryptoSession.isUnlocked() && treeId && TreeManager.isTreeUnreadable(treeId)) {
            this.showTreeKeyPrompt(treeId);
            return;
        }
        void this.showLocalUnlockPrompt(async () => { await this.onLocalDataUnlocked?.(); });
    },

    /**
     * Locked data is read-only like view mode: the `data-locked` body class
     * hides every edit entry point (the `.edit-only` elements and the add
     * buttons) and swaps the empty state for the Unlock message. Called on
     * every data change and whenever the Unlock banner comes or goes.
     */
    syncLockedState(): void {
        const locked = DataManager.isLocked();
        const was = document.body.classList.contains('data-locked');
        document.body.classList.toggle('data-locked', locked);
        if (locked && !was) {
            // Close whatever edit surface was open on the stand-in tree.
            this.hideContextMenu();
            this.hideBottomSheet();
        }
        if (locked !== was) this.refreshUndoRedoToolbar();
    },

    /**
     * A tree could not be read (strom:tree-unreadable). With a locked session
     * the usual Unlock banner applies; with an unlocked one the tree was
     * encrypted with a different key, so ask for THAT tree's password right away.
     */
    handleUnreadableTree(treeId?: TreeId): void {
        const id = treeId ?? DataManager.getCurrentTreeId();
        if (!CryptoSession.isUnlocked() || !id) {
            this.showLockedBanner();
            return;
        }
        this.showTreeKeyPrompt(id);
    },

    /**
     * Ask for the password of ONE tree encrypted with a different key than
     * the session. On success the tree is re-encrypted with the session key
     * (all trees share one key afterwards) and, when it is the open tree,
     * loaded. Cancel keeps it blocked behind the Unlock banner (K8).
     */
    showTreeKeyPrompt(treeId: TreeId): void {
        const modal = document.getElementById('password-prompt-modal');
        const input = document.getElementById('password-prompt-input') as HTMLInputElement;
        const error = document.getElementById('password-prompt-error');
        if (!modal || !input) {
            this.showLockedBanner(() => this.showTreeKeyPrompt(treeId));
            return;
        }

        // The shared prompt explains itself for this case; the generic text
        // comes back when the prompt closes either way.
        const description = modal.querySelector('.modal-description') as HTMLElement | null;
        const originalDescription = description?.textContent ?? null;
        if (description) description.textContent = strings.storageSafety.treeOtherKey;
        const restoreDescription = () => {
            if (description && originalDescription !== null) description.textContent = originalDescription;
        };

        input.value = '';
        if (error) {
            error.style.display = 'none';
            error.textContent = '';
        }
        this.pendingEncryptedData = null;
        this.passwordPromptCallback = async (password: string) => {
            const result = await TreeManager.recoverTreeWithPassword(treeId, password);
            if (result === 'wrong-password') {
                if (error) {
                    error.textContent = strings.encryption.wrongPassword;
                    error.style.display = 'block';
                }
                input.select();
                return;
            }
            modal.classList.remove('active');
            this.passwordPromptCallbackManagesDialog = false;
            restoreDescription();
            if (result === 'locked') {
                // The session itself got locked meanwhile: the normal unlock.
                this.showLockedBanner();
                return;
            }
            this.hideLockedBanner();
            if (result === 'ok') this.showToast(strings.storageSafety.treeRecovered, 4000);
            if (treeId === DataManager.getCurrentTreeId()) await this.onLocalDataUnlocked?.();
        };
        this.passwordPromptCallbackManagesDialog = true;
        this.passwordPromptOnCancel = () => {
            restoreDescription();
            this.showLockedBanner(() => this.showTreeKeyPrompt(treeId));
        };

        modal.classList.add('active');
        input.focus();
        input.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitPasswordPrompt();
            }
        };
    },

    hideLockedBanner(): void {
        document.getElementById('locked-data-notice')?.remove();
        this.lockedDataReopen = null;
        this.syncLockedState();
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

    /** The four export-content checkboxes as a ContentOptions object. */
    readExportContentOptions(): ContentOptions {
        const on = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? true;
        return {
            photos: on('export-content-photos'),
            attachments: on('export-content-attachments'),
            notes: on('export-content-notes'),
            sources: on('export-content-sources'),
        };
    },

    /** UTF-8 byte length of a string (data URLs are ASCII, notes may not be). */
    byteLength(str: string): number {
        return new TextEncoder().encode(str).length;
    },

    /**
     * Measure the tree's export size ONCE per dialog-open, split by category, so
     * the live estimate is a cheap addition afterwards. Photos/attachments come
     * from their dedicated byte counters; notes and sources are measured with a
     * single stringify pass over just those slices; `base` is the skeleton
     * (everything stripped). Stored on `this.exportContentSizes`.
     */
    readExportContentSizes(data: StromData): void {
        const notesSlice: unknown[] = [];
        const sourcesSlice: unknown[] = [data.sources ?? null];
        for (const person of Object.values(data.persons)) {
            if (person.notes) notesSlice.push(person.notes);
            if (person.sourceIds) sourcesSlice.push(person.sourceIds);
            for (const ev of person.events ?? []) {
                if (ev.note) notesSlice.push(ev.note);
                if (ev.sourceIds) sourcesSlice.push(ev.sourceIds);
                for (const part of ev.participants ?? []) if (part.note) notesSlice.push(part.note);
            }
            for (const att of person.attachments ?? []) if (att.sourceId) sourcesSlice.push(att.sourceId);
        }
        for (const partnership of Object.values(data.partnerships)) {
            if (partnership.note) notesSlice.push(partnership.note);
            if (partnership.sourceIds) sourcesSlice.push(partnership.sourceIds);
        }
        const base = this.byteLength(JSON.stringify(
            applyContentOptions(data, { photos: false, attachments: false, notes: false, sources: false })));
        this.exportContentSizes = {
            base,
            photos: totalPhotoBytes(data),
            attachments: totalAttachmentBytes(data),
            notes: this.byteLength(JSON.stringify(notesSlice)),
            sources: this.byteLength(JSON.stringify(sourcesSlice)),
        };
    },

    /** Recompute and show the estimated file size for the current checkbox state. */
    updateExportSizeEstimate(): void {
        const sizes = this.exportContentSizes;
        const el = document.getElementById('export-content-size');
        if (!sizes || !el) return;
        const opts = this.readExportContentOptions();
        const total = sizes.base
            + (opts.photos ? sizes.photos : 0)
            + (opts.attachments ? sizes.attachments : 0)
            + (opts.notes ? sizes.notes : 0)
            + (opts.sources ? sizes.sources : 0);
        el.textContent = strings.privacy.contentEstimate(TreeManager.formatBytes(total));
    },

    /** Highlight the preset whose checkbox pattern matches the current state (if any). */
    syncExportPresetHighlight(): void {
        const active = matchContentPreset(this.readExportContentOptions());
        document.querySelectorAll('#export-content-presets .content-preset').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.preset === active);
        });
    },

    /** Apply a named preset to the four checkboxes, then refresh estimate + highlight. */
    applyExportPreset(preset: ContentPreset): void {
        const p = CONTENT_PRESETS[preset];
        const set = (id: string, v: boolean) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.checked = v;
        };
        set('export-content-photos', p.photos);
        set('export-content-attachments', p.attachments);
        set('export-content-notes', p.notes);
        set('export-content-sources', p.sources);
        this.updateExportSizeEstimate();
        this.syncExportPresetHighlight();
    },

    /** A single content checkbox changed: refresh the estimate and preset highlight. */
    onExportContentChange(): void {
        this.updateExportSizeEstimate();
        this.syncExportPresetHighlight();
    },

    showExportPasswordDialog(
        callback: (password: string | null) => void,
        includeAuditLogOption = false,
        options: { defaultPrivacy?: PrivacyMode; passwordless?: boolean; content?: boolean } = {}
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

        // Granular "Content" section (photos / attachments / notes / sources).
        // Formats that ignore content options (GEDCOM, CSV — passwordless) hide
        // it; every archive/JSON/HTML export shows it, defaulting to all-on.
        const contentSection = document.getElementById('export-content-section');
        const showContent = options.content ?? !passwordless;
        if (contentSection) contentSection.style.display = showContent ? 'block' : 'none';
        if (showContent) {
            for (const id of ['export-content-photos', 'export-content-attachments', 'export-content-notes', 'export-content-sources']) {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el) el.checked = true;
            }
            // Per-category sizes computed once here; toggling never re-stringifies.
            this.readExportContentSizes(DataManager.getData());
            this.updateExportSizeEstimate();
            this.syncExportPresetHighlight();
        }

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
                // hasEntries is async — testing the Promise itself was always
                // truthy. Hide first, reveal once any tree has entries.
                auditLogSection.style.display = 'none';
                const trees = TreeManager.getTrees();
                void Promise.all(trees.map(t => AuditLogManager.hasEntries(t.id).catch(() => false)))
                    .then(results => {
                        auditLogSection.style.display = results.some(Boolean) ? 'block' : 'none';
                    });
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
