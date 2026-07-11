/**
 * search UI methods. Extracted from the original UIClass;
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

export const searchMethods = uiModule({
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
    },

    /**
     * Refresh toolbar search picker (e.g., after data import)
     */
    refreshSearch(): void {
        this.initSearch();
    },

    /**
     * Handle search results from URL parameter
     */
    handleSearchResults(results: import('../types.js').Person[], query: string): void {
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
    },

    showSearchResultsModal(results: import('../types.js').Person[], _query: string): void {
        // Use confirmation modal for search results
        const modal = document.getElementById('confirmation-modal');
        const title = document.getElementById('confirm-title');
        const message = document.getElementById('confirm-message');
        const options = document.getElementById('confirm-options');
        const confirmBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

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
                const personId = selected.value as PersonId;
                TreeRenderer.setFocus(personId);
                setTimeout(() => {
                    ZoomPan.centerOnPerson(personId);
                    ZoomPan.highlightPerson(personId);
                }, 100);
            }
            close();
        };

        // Close on overlay click
        modal.onclick = (e) => {
            if (e.target === modal) close();
        };

        modal.classList.add('active');
    },

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    },
});
