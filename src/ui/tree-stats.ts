/**
 * tree stats UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { upcomingAnniversaries } from '../anniversaries.js';
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
import { totalPhotoBytes } from '../photo.js';
import { totalAttachmentBytes, ATTACHMENT_WARN_BYTES } from '../attachments.js';
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
import { ThemeMode, LanguageSetting, AppMode, AuditLog, personSourceIds } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue, translateValidationType } from '../validation.js';
import { isLivingPerson, inferBirthUpperBounds } from '../privacy.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { yearOf, parseFlexDate } from '../dates.js';
import { computeFamilyStats, computeCompleteness } from '../stats.js';
import { findComponents, componentName } from '../components.js';
import { orphanedPlaceKeys } from '../places.js';
import { shownNameOrEmpty } from '../person-name.js';

export const treeStatsMethods = uiModule({
    /**
     * Show tree validation dialog (checks for genealogical inconsistencies)
     */
    async showTreeValidationDialog(treeId: string, parentDialogId?: string): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        const treeData = await TreeManager.getTreeData(treeId as TreeId);
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

            this.bindTreeValidationActions(content, result, treeId);
        }

        // Handle dialog stack for ESC navigation
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog('tree-validation-modal');

        modal?.classList.add('active');
    },

    closeTreeValidationDialog(): void {
        document.getElementById('tree-validation-modal')?.classList.remove('active');
        this.returnToParentDialog();
    },

    /**
     * Re-render validation dialog with fresh data (after a fix)
     */
    async refreshTreeValidationDialog(treeId: string): Promise<void> {
        const treeData = await TreeManager.getTreeData(treeId as TreeId);
        if (!treeData) return;

        const content = document.getElementById('tree-validation-content');
        if (!content) return;

        const result = validateTreeData(treeData);
        content.innerHTML = this.generateTreeValidationHtml(result, treeData, treeId);

        this.bindTreeValidationActions(content, result, treeId);
    },

    /**
     * Person links and Fix buttons of the validation dialog. The repairs edit
     * the loaded tree, so a Fix on another tree switches to it first —
     * otherwise it would "repair" the active tree (person ids of a duplicated
     * tree even match) and leave the checked one as it was.
     */
    bindTreeValidationActions(content: HTMLElement, result: TreeValidationResult, treeId: string): void {
        const repairIn = async (repair: () => void): Promise<void> => {
            if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
            if (TreeManager.getActiveTreeId() !== treeId) return;
            repair();
            void this.refreshTreeValidationDialog(treeId);
        };
        content.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('validation-person-link')) {
                e.preventDefault();
                const treeIdAttr = target.getAttribute('data-tree-id');
                const personIdAttr = target.getAttribute('data-person-id');
                if (treeIdAttr && personIdAttr) {
                    void this.focusPersonFromValidation(treeIdAttr, personIdAttr);
                }
            } else if (target.classList.contains('validation-fix-btn')) {
                e.preventDefault();
                const issueIdx = target.getAttribute('data-issue-idx');
                const issue = issueIdx !== null ? result.issues[parseInt(issueIdx, 10)] : undefined;
                if (issue) void repairIn(() => { DataManager.repairValidationIssue(issue); });
            } else if (target.classList.contains('validation-fix-all-btn')) {
                e.preventDefault();
                const fixable = result.issues.filter(i => DataManager.isFixableIssue(i));
                void repairIn(() => {
                    const count = DataManager.repairAllFixableIssues(fixable);
                    if (count > 0) this.showAlert(strings.treeManager.valFixed(count), 'info');
                });
            }
        };
    },

    /**
     * Generate HTML for tree validation results
     */
    generateTreeValidationHtml(result: TreeValidationResult, treeData: StromData, treeId: string): string {
        const s = strings.treeManager;

        if (result.issues.length === 0) {
            return `
                <div class="validation-passed">
                    <div class="validation-passed-icon">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
                    </div>
                    <div class="validation-passed-text">${s.validationPassed}</div>
                </div>
            `;
        }

        // Group issues by severity
        const errors = result.issues.filter(i => i.severity === 'error');
        const warnings = result.issues.filter(i => i.severity === 'warning');
        const infos = result.issues.filter(i => i.severity === 'info');

        // Count fixable issues
        const fixableCount = result.issues.filter(i => DataManager.isFixableIssue(i)).length;

        let html = `
            <div class="validation-summary">
                ${result.stats.errors > 0 ? `<span class="validation-count error">${result.stats.errors} ${s.validationErrors}</span>` : ''}
                ${result.stats.warnings > 0 ? `<span class="validation-count warning">${result.stats.warnings} ${s.validationWarnings}</span>` : ''}
                ${result.stats.infos > 0 ? `<span class="validation-count info">${result.stats.infos} ${s.validationInfos}</span>` : ''}
                ${fixableCount > 0 ? `<button class="validation-fix-all-btn">${s.valFixAll} (${fixableCount})</button>` : ''}
            </div>
            <div class="validation-issues">
        `;

        // Translate validation issue type to localized message (shared with R4).
        const translateIssueType = translateValidationType;

        const renderIssue = (issue: ValidationIssue, issueIdx: number) => {
            // Severity now reads from the colored dot + the row's severity class.
            const icon = '';
            const translatedMessage = translateIssueType(issue.type);
            const isFixable = DataManager.isFixableIssue(issue);

            // Create clickable person links with data attributes
            const personLinks = issue.personIds?.map(id => {
                const person = treeData.persons[id];
                const name = person ? shownNameOrEmpty(person) : id;
                return `<a href="#" class="validation-person-link" data-tree-id="${this.escapeHtml(treeId)}" data-person-id="${this.escapeHtml(id)}">${this.escapeHtml(name)}</a>`;
            }).join(', ') || '';

            const fixBtn = isFixable
                ? `<button class="validation-fix-btn" data-issue-idx="${issueIdx}">${s.valFix}</button>`
                : '';

            return `
                <div class="validation-issue ${issue.severity}">
                    <span class="validation-issue-dot" aria-hidden="true"></span>${icon}
                    <div class="validation-issue-content">
                        <div class="validation-issue-message">${this.escapeHtml(translatedMessage)}</div>
                        ${issue.detail ? `<div class="validation-issue-detail">${this.escapeHtml(issue.detail)}</div>` : ''}
                        ${personLinks ? `<div class="validation-issue-persons">${personLinks}</div>` : ''}
                    </div>
                    ${fixBtn}
                </div>
            `;
        };

        // Render errors first, then warnings, then infos
        for (const issue of errors) {
            const idx = result.issues.indexOf(issue);
            html += renderIssue(issue, idx);
        }
        for (const issue of warnings) {
            const idx = result.issues.indexOf(issue);
            html += renderIssue(issue, idx);
        }
        for (const issue of infos) {
            const idx = result.issues.indexOf(issue);
            html += renderIssue(issue, idx);
        }

        html += '</div>';
        return html;
    },

    /**
     * Focus on a person from validation dialog
     * Switches to the tree if needed and focuses on the person
     */
    async focusPersonFromValidation(treeId: string, personId: string): Promise<void> {
        // Close all dialogs (the tree overview too, when validation was opened from it)
        this.closeTreeValidationDialog();
        if (this.isTreeOverviewOpen()) this.closeTreeOverview();
        this.closeTreeManagerDialog();

        // Switch to tree if needed — AWAIT it: switchToTree finishes by
        // restoring the new tree's own focus (restoreFromSession), so calling
        // setFocus before the switch resolves would set the target on the OLD
        // tree and then get overwritten by the restore. Await, then focus.
        const activeTreeId = TreeManager.getActiveTreeId();
        if (activeTreeId !== treeId) {
            await this.switchToTree(treeId as TreeId);
        }

        // Focus on the person
        TreeRenderer.setFocus(personId as PersonId);
    },

    /**
     * Return to parent dialog from stack, or clear stack if no parent
     */
    returnToParentDialog(): void {
        // Remove current dialog from stack
        this.dialogStack.pop();

        // If there's a parent dialog, open it
        if (this.dialogStack.length > 0) {
            const parentDialog = this.dialogStack[this.dialogStack.length - 1];
            this.openDialogById(parentDialog);
        }

        // Clear the stack (we've returned to parent)
        this.dialogStack = [];
    },
});
