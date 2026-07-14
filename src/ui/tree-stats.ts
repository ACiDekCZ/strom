/**
 * tree stats UI methods. Extracted from the original UIClass;
 * see src/ui/module.ts for the composition pattern.
 */

import { DataManager, auditPersonName } from '../data.js';
import { upcomingAnniversaries } from '../anniversaries.js';
import { ANNIVERSARY_ICON } from './anniversaries-ui.js';
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
import { ThemeMode, LanguageSetting, AppMode, AuditLog } from '../types.js';
import { CryptoSession, isEncrypted, encrypt, decrypt, EncryptedData } from '../crypto.js';
import { validateTreeData, ValidationResult as TreeValidationResult, ValidationIssue } from '../validation.js';
import { isLivingPerson, inferBirthUpperBounds } from '../privacy.js';
import * as CrossTree from '../cross-tree.js';
import { AuditLogManager } from '../audit-log.js';
import { uiModule } from './module.js';
import { yearOf, parseFlexDate, formatFlexDate } from '../dates.js';
import { computeFamilyStats } from '../stats.js';

/** Escape text for safe inclusion in SVG/HTML (names come from user data). */
function escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Responsive inline-SVG horizontal bar chart (no library). Internal coordinate
 * system is fixed; the SVG scales to the container via width:100% + viewBox.
 * Labels are escaped; values are numbers.
 */
function svgBarChart(rows: { label: string; value: number; display?: string }[]): string {
    if (rows.length === 0) return '';
    const W = 320, rowH = 24, labelW = 104, barX = labelW + 8;
    // Reserve room for the widest value text ("60.5 let (n = 10)") so a
    // full-length bar never paints over it.
    const maxShownLen = Math.max(...rows.map(r => (r.display ?? String(r.value)).length));
    const valueW = Math.min(150, Math.max(34, maxShownLen * 6.5 + 10));
    const barW = W - barX - valueW;
    const H = rows.length * rowH;
    const max = Math.max(1, ...rows.map(r => r.value));
    const bars = rows.map((r, i) => {
        const y = i * rowH;
        const w = Math.max(r.value > 0 ? 2 : 0, (r.value / max) * barW);
        const shown = r.display ?? String(r.value);
        return `
            <text x="0" y="${y + 16}" class="stats-bar-label">${escXml(r.label)}</text>
            <rect x="${barX}" y="${y + 5}" width="${w.toFixed(1)}" height="14" rx="2" class="stats-bar-rect"></rect>
            <text x="${W}" y="${y + 16}" text-anchor="end" class="stats-bar-value">${escXml(shown)}</text>`;
    }).join('');
    return `<svg class="stats-bar-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${bars}</svg>`;
}


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
                'event-birth-death': 'valEventBirthDeath',
                'event-no-label': 'valEventNoLabel',
                'event-bad-date': 'valEventBadDate',
                'deathBeforeBirth': 'valDeathBeforeBirth',
                'implausibleLifespan': 'valImplausibleLifespan',
                'eventBeforeBirth': 'valEventBeforeBirth',
                'eventAfterDeath': 'valEventAfterDeath',
                'weddingBeforeBirth': 'valWeddingBeforeBirth',
                'weddingAfterDeath': 'valWeddingAfterDeath',
                'childMarriage': 'valChildMarriage',
                'childAfterMotherDeath': 'valChildAfterMotherDeath',
                'childAfterFatherDeath': 'valChildAfterFatherDeath',
                'citationMissingSource': 'valCitationMissingSource',
                'attachmentNoData': 'valAttachmentNoData',
                'partnerAgeGap': 'valPartnerAgeGap',
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

        // Shared smart liveness (same rules as the privacy filter/book):
        // indirect evidence marks clearly-historical people as deceased.
        const bounds = inferBirthUpperBounds(treeData);

        // Basic counts
        const totalPersons = persons.length;
        const males = persons.filter(p => p.gender === 'male').length;
        const females = persons.filter(p => p.gender === 'female').length;
        const deceased = persons.filter(p => !isLivingPerson(p, currentYear, bounds)).length;
        const living = totalPersons - deceased;

        // Family stats
        const totalFamilies = partnerships.length;
        const childCounts = partnerships.map(p => p.childIds?.length || 0);
        const avgChildren = totalFamilies > 0
            ? (childCounts.reduce((a, b) => a + b, 0) / totalFamilies).toFixed(1)
            : '0';
        const maxChildren = childCounts.length > 0 ? Math.max(...childCounts) : 0;

        // Date stats — sort by parsed YEAR, not as strings (flex qualifiers
        // like "~852" would otherwise sort after "1031").
        const datedBirths = persons
            .map(p => ({ d: p.birthDate, y: yearOf(p.birthDate) }))
            .filter((x): x is { d: string; y: number } => !!x.d && x.y !== null)
            .sort((a, b) => a.y - b.y);
        const oldestBirth = datedBirths[0]?.d || '-';
        const newestBirth = datedBirths[datedBirths.length - 1]?.d || '-';

        // Data completeness
        const withBirthDate = persons.filter(p => p.birthDate).length;
        const withDeathDate = persons.filter(p => p.deathDate).length;
        const withBirthPlace = persons.filter(p => p.birthPlace).length;
        const withPhoto = persons.filter(p => p.photo).length;
        const photoKb = Math.round(totalPhotoBytes(treeData) / 1024);
        const totalEvents = persons.reduce((sum, p) => sum + (p.events?.length ?? 0), 0);
        const totalSources = Object.keys(treeData.sources ?? {}).length;
        // A person is "cited" if it or any of its events references a source.
        const personsCited = persons.filter(p =>
            (p.sourceIds?.length ?? 0) > 0 || (p.events ?? []).some(e => (e.sourceIds?.length ?? 0) > 0)
        ).length;
        const totalAttachments = persons.reduce((sum, p) => sum + (p.attachments?.length ?? 0), 0);
        const attachmentBytes = totalAttachmentBytes(treeData);
        const mediaWarn = (totalPhotoBytes(treeData) + attachmentBytes) > ATTACHMENT_WARN_BYTES;

        const s = strings.treeManager;

        // Calculate percentages
        const birthDatePct = totalPersons > 0 ? Math.round(withBirthDate / totalPersons * 100) : 0;
        const deathDatePct = totalPersons > 0 ? Math.round(withDeathDate / totalPersons * 100) : 0;
        const birthPlacePct = totalPersons > 0 ? Math.round(withBirthPlace / totalPersons * 100) : 0;
        const sourceCoveragePct = totalPersons > 0 ? Math.round(personsCited / totalPersons * 100) : 0;

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
                ${totalSources > 0 ? `
                <div class="tree-stats-row">
                    <span class="label">${s.statsSources}</span>
                    <span class="value">${totalSources}</span>
                </div>
                <div class="tree-stats-row">
                    <span class="label">${s.statsSourceCoverage}</span>
                    <span class="value">${personsCited}/${totalPersons} (${sourceCoveragePct}%)</span>
                </div>` : ''}
                ${totalAttachments > 0 ? `
                <div class="tree-stats-row">
                    <span class="label">${s.statsAttachments}</span>
                    <span class="value">${totalAttachments} (${Math.round(attachmentBytes / 1024)} kB)</span>
                </div>` : ''}
                ${mediaWarn ? `
                <div class="tree-stats-row tree-stats-warning">
                    <span class="label">⚠️ ${s.statsMediaWarning}</span>
                </div>` : ''}
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsAnniversaries}</div>
                <div class="tree-stats-anniversaries">
                    ${this.generateAnniversariesHtml(treeData)}
                </div>
            </div>

            <details class="tree-stats-section tree-stats-family">
                <summary class="tree-stats-family-summary">${strings.stats.section}</summary>
                ${this.generateFamilyStatsHtml(treeData)}
            </details>
        `;
    },

    /** Visual family statistics (charts) for the collapsible dialog section. */
    generateFamilyStatsHtml(treeData: StromData): string {
        const st = strings.stats;
        const stats = computeFamilyStats(treeData);
        const blocks: string[] = [];

        const chartBlock = (title: string, body: string): string =>
            `<div class="stats-chart-block"><div class="stats-chart-title">${title}</div>${body}</div>`;
        const notEnough = `<div class="stats-empty">${st.notEnough}</div>`;

        // Most common first names (males / females).
        if (stats.topMaleNames.length) {
            blocks.push(chartBlock(st.topMaleNames,
                svgBarChart(stats.topMaleNames.map(n => ({ label: n.name, value: n.count })))));
        }
        if (stats.topFemaleNames.length) {
            blocks.push(chartBlock(st.topFemaleNames,
                svgBarChart(stats.topFemaleNames.map(n => ({ label: n.name, value: n.count })))));
        }

        // Average lifespan by generation (needs a meaningful sample).
        const lifespanN = stats.lifespanByGen.reduce((sum, g) => sum + g.n, 0);
        blocks.push(chartBlock(st.lifespanByGen, lifespanN >= 5
            ? svgBarChart(stats.lifespanByGen.map(g => ({
                label: st.generation(g.generation), value: g.avgYears,
                display: `${g.avgYears} ${st.years} (${st.sampleN(g.n)})`,
            })))
            : notEnough));

        // Children per couple by generation.
        blocks.push(chartBlock(st.childrenByGen, stats.childrenByGen.length
            ? svgBarChart(stats.childrenByGen.map(g => ({
                label: st.generation(g.generation), value: g.avgChildren,
                display: `${g.avgChildren} (${st.sampleN(g.n)})`,
            })))
            : notEnough));

        // Births by month.
        blocks.push(chartBlock(st.birthsByMonth, stats.birthsByMonthN >= 5
            ? svgBarChart(stats.birthsByMonth.map(m => ({ label: st.months[m.month - 1], value: m.count })))
            : notEnough));

        // Records.
        const records: string[] = [];
        if (stats.oldest) {
            records.push(`<div class="tree-stats-row"><span class="label">${st.oldest}</span>`
                + `<span class="value">${escXml(stats.oldest.name)} · ${stats.oldest.years} ${st.years}</span></div>`);
        }
        if (stats.longestMarriage) {
            records.push(`<div class="tree-stats-row"><span class="label">${st.longestMarriage}</span>`
                + `<span class="value">${escXml(stats.longestMarriage.names)} · ${stats.longestMarriage.years} ${st.years}</span></div>`);
        }
        if (records.length) blocks.push(`<div class="stats-chart-block">${records.join('')}</div>`);

        return blocks.join('');
    },

    /**
     * Generate HTML for upcoming anniversaries
     */
    generateAnniversariesHtml(treeData: StromData): string {
        // ONE source of truth with the anniversaries panel in the menu: the
        // shared module decides what counts (living birthdays, living couples'
        // weddings, round milestones of the deceased) — the two lists must
        // never disagree.
        const items = upcomingAnniversaries(treeData, new Date()).slice(0, 10);
        if (items.length === 0) {
            return `<div class="tree-stats-none">${strings.treeManager.statsAnniversariesNone}</div>`;
        }
        const a = strings.anniversaries;
        return items.map(item => {
            const names = item.personIds.map(id => {
                const p = treeData.persons[id as PersonId];
                return p ? `${p.firstName} ${p.lastName}`.trim() : '';
            });
            const label = this.anniversaryLabel(item, names);
            const when = item.daysUntil === 0 ? a.today
                : item.daysUntil === 1 ? a.tomorrow : a.inDays(item.daysUntil);
            const todayClass = item.daysUntil === 0 ? ' tree-stats-anniversary-today' : '';
            return `
                <div class="tree-stats-anniversary${todayClass}">
                    <span class="tree-stats-anniversary-icon">${ANNIVERSARY_ICON[item.type]}</span>
                    <div class="tree-stats-anniversary-info">
                        <div class="tree-stats-anniversary-name">${this.escapeHtml(label)}</div>
                    </div>
                    <span class="tree-stats-anniversary-date">${this.escapeHtml(when)}</span>
                </div>`;
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
