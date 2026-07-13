/**
 * tree stats UI methods. Extracted from the original UIClass;
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
import { yearOf, parseFlexDate, formatFlexDate } from '../dates.js';


/**
 * Flex-date components for anniversary math: [year, month, day].
 * Missing parts come back as NaN so existing `if (month && day)` guards
 * skip partial dates; qualified dates still yield a numeric year.
 */
function flexDateParts(value: string): [number, number, number] {
    const d = parseFlexDate(value);
    if (!d) return [NaN, NaN, NaN];
    return [d.year, d.month ?? NaN, d.day ?? NaN];
}

export const treeStatsMethods = uiModule({
    /**
     * Show tree statistics dialog
     */
    async showTreeStatsDialog(treeId: string, parentDialogId?: string): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId as TreeId);
        const treeData = await TreeManager.getTreeData(treeId as TreeId);
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
    },

    /**
     * Show stats for the currently active tree (called from focus bar)
     */
    showActiveTreeStats(): void {
        const activeTreeId = TreeManager.getActiveTreeId();
        if (activeTreeId) {
            this.showTreeStatsDialog(activeTreeId);
        }
    },

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

            // Add click handler for person links and fix buttons using event delegation
            content.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.classList.contains('validation-person-link')) {
                    e.preventDefault();
                    const treeIdAttr = target.getAttribute('data-tree-id');
                    const personIdAttr = target.getAttribute('data-person-id');
                    if (treeIdAttr && personIdAttr) {
                        this.focusPersonFromValidation(treeIdAttr, personIdAttr);
                    }
                } else if (target.classList.contains('validation-fix-btn')) {
                    e.preventDefault();
                    const issueIdx = target.getAttribute('data-issue-idx');
                    if (issueIdx !== null) {
                        const issue = result.issues[parseInt(issueIdx, 10)];
                        if (issue) {
                            DataManager.repairValidationIssue(issue);
                            // Re-render with fresh validation
                            this.refreshTreeValidationDialog(treeId);
                        }
                    }
                } else if (target.classList.contains('validation-fix-all-btn')) {
                    e.preventDefault();
                    const fixable = result.issues.filter(i => DataManager.isFixableIssue(i));
                    const count = DataManager.repairAllFixableIssues(fixable);
                    if (count > 0) {
                        this.showAlert(strings.treeManager.valFixed(count), 'info');
                    }
                    // Re-render with fresh validation
                    this.refreshTreeValidationDialog(treeId);
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

        // Re-attach click handler
        content.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('validation-person-link')) {
                e.preventDefault();
                const treeIdAttr = target.getAttribute('data-tree-id');
                const personIdAttr = target.getAttribute('data-person-id');
                if (treeIdAttr && personIdAttr) {
                    this.focusPersonFromValidation(treeIdAttr, personIdAttr);
                }
            } else if (target.classList.contains('validation-fix-btn')) {
                e.preventDefault();
                const issueIdx = target.getAttribute('data-issue-idx');
                if (issueIdx !== null) {
                    const issue = result.issues[parseInt(issueIdx, 10)];
                    if (issue) {
                        DataManager.repairValidationIssue(issue);
                        this.refreshTreeValidationDialog(treeId);
                    }
                }
            } else if (target.classList.contains('validation-fix-all-btn')) {
                e.preventDefault();
                const fixable = result.issues.filter(i => DataManager.isFixableIssue(i));
                const count = DataManager.repairAllFixableIssues(fixable);
                if (count > 0) {
                    this.showAlert(strings.treeManager.valFixed(count), 'info');
                }
                this.refreshTreeValidationDialog(treeId);
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
                    <div class="validation-passed-icon">✅</div>
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
                ${result.stats.errors > 0 ? `<span class="validation-count error">❌ ${result.stats.errors} ${s.validationErrors}</span>` : ''}
                ${result.stats.warnings > 0 ? `<span class="validation-count warning">⚠️ ${result.stats.warnings} ${s.validationWarnings}</span>` : ''}
                ${result.stats.infos > 0 ? `<span class="validation-count info">ℹ️ ${result.stats.infos} ${s.validationInfos}</span>` : ''}
                ${fixableCount > 0 ? `<button class="validation-fix-all-btn">${s.valFixAll} (${fixableCount})</button>` : ''}
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

        const renderIssue = (issue: ValidationIssue, issueIdx: number) => {
            const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
            const translatedMessage = translateIssueType(issue.type);
            const isFixable = DataManager.isFixableIssue(issue);

            // Create clickable person links with data attributes
            const personLinks = issue.personIds?.map(id => {
                const person = treeData.persons[id];
                const name = person ? `${person.firstName} ${person.lastName}`.trim() : id;
                return `<a href="#" class="validation-person-link" data-tree-id="${treeId}" data-person-id="${id}">${this.escapeHtml(name)}</a>`;
            }).join(', ') || '';

            const fixBtn = isFixable
                ? `<button class="validation-fix-btn" data-issue-idx="${issueIdx}">${s.valFix}</button>`
                : '';

            return `
                <div class="validation-issue ${issue.severity}">
                    <span class="validation-issue-icon">${icon}</span>
                    <div class="validation-issue-content">
                        <div class="validation-issue-message">${this.escapeHtml(translatedMessage)}</div>
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
    },

    /**
     * Generate HTML for tree statistics
     */
    generateTreeStatsHtml(treeData: StromData): string {
        const persons = Object.values(treeData.persons);
        const partnerships = Object.values(treeData.partnerships);
        const currentYear = new Date().getFullYear();
        const MAX_AGE = 120;

        // Helper to check if person is presumed deceased (death date OR age > 120)
        const isPresumedDeceased = (p: { birthDate?: string; deathDate?: string }): boolean => {
            if (p.deathDate) return true;
            if (p.birthDate) {
                const birthYear = yearOf(p.birthDate);
                if (birthYear !== null && (currentYear - birthYear) > MAX_AGE) return true;
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
        const withPhoto = persons.filter(p => p.photo).length;
        const photoKb = Math.round(totalPhotoBytes(treeData) / 1024);
        const totalEvents = persons.reduce((sum, p) => sum + (p.events?.length ?? 0), 0);

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
                ${withPhoto > 0 ? `
                <div class="tree-stats-row">
                    <span class="label">${s.statsPhotos}</span>
                    <span class="value">${withPhoto} (${photoKb} kB)</span>
                </div>` : ''}
                ${totalEvents > 0 ? `
                <div class="tree-stats-row">
                    <span class="label">${s.statsEvents}</span>
                    <span class="value">${totalEvents}</span>
                </div>` : ''}
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsAnniversaries}</div>
                <div class="tree-stats-anniversaries">
                    ${this.generateAnniversariesHtml(treeData)}
                </div>
            </div>
        `;
    },

    /**
     * Generate HTML for upcoming anniversaries
     */
    generateAnniversariesHtml(treeData: StromData): string {
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
                const birthYear = yearOf(person.birthDate);
                if (birthYear !== null && (todayYear - birthYear) > MAX_AGE) {
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
                const [year, month, day] = flexDateParts(person.birthDate);
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
                const [year, month, day] = flexDateParts(person.deathDate);
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
                const [year, month, day] = flexDateParts(partnership.startDate);
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
    },

    /**
     * Format date for display (short format)
     */
    formatDateShort(dateStr: string): string {
        if (!dateStr || dateStr === '-') return '-';
        return formatFlexDate(dateStr);
    },

    /**
     * Close tree stats dialog
     */
    closeTreeStatsDialog(): void {
        document.getElementById('tree-stats-modal')?.classList.remove('active');
        this.returnToParentDialog();
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
