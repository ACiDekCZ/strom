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
import { yearOf, parseFlexDate } from '../dates.js';
import { computeFamilyStats } from '../stats.js';
import { findComponents, componentName } from '../components.js';

/** Escape text for safe inclusion in SVG/HTML (names come from user data). */
function escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
                'orphanedParticipantRef': 'valOrphanedParticipantRef',
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
                'possibleDuplicate': 'valPossibleDuplicate',
                'placeSpelling': 'valPlaceSpelling',
                'recurringGodparent': 'valRecurringGodparent',
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

        // Year span for the hero tile ("1430–1542"); single year shown alone.
        const firstYear = datedBirths[0]?.y;
        const lastYear = datedBirths[datedBirths.length - 1]?.y;
        const yearSpan = firstYear === undefined ? '–'
            : firstYear === lastYear ? String(firstYear) : `${firstYear}–${lastYear}`;
        const familyStats = computeFamilyStats(treeData);

        // Proportional two-color split bar with counted labels above it.
        const splitBar = (leftLabel: string, leftN: number, leftCls: string,
            rightLabel: string, rightN: number, rightCls: string): string => {
            const total = leftN + rightN;
            if (total === 0) return '';
            const leftPct = (leftN / total * 100).toFixed(1);
            return `
                <div class="stats-split">
                    <div class="stats-split-labels">
                        <span>${leftLabel} <b>${leftN}</b></span>
                        <span><b>${rightN}</b> ${rightLabel}</span>
                    </div>
                    <div class="stats-split-bar">
                        <span class="${leftCls}" style="width:${leftPct}%"></span>
                        <span class="${rightCls}"></span>
                    </div>
                </div>`;
        };

        const progress = (label: string, pct: number): string => `
            <div class="stats-progress">
                <span class="label">${label}</span>
                <span class="stats-progress-track"><span class="stats-progress-fill" style="width:${pct}%"></span></span>
                <span class="pct">${pct}%</span>
            </div>`;

        // A tree that holds several unconnected families is worth saying out
        // loud — it is usually a surprise, and it is the thing the split acts on.
        const components = findComponents(treeData);
        const unrelated = components.length > 1
            ? `<div class="tree-stats-unrelated">
                   <strong>${strings.split.unrelated(components.length)}</strong>
                   <span>${components.map(c =>
                       `${escXml(componentName(c, strings.split.familyName, strings.split.noSurname))} (${strings.split.persons(c.count)})`)
                       .join('  ·  ')}</span>
                   <span class="tree-stats-unrelated-hint">${strings.split.unrelatedHint}</span>
               </div>`
            : '';

        return `
            ${unrelated}
            <div class="tree-stats-header">
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value">${totalPersons}</div>
                    <div class="tree-stats-header-label">${s.statsPeople}</div>
                </div>
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value">${totalFamilies}</div>
                    <div class="tree-stats-header-label">${s.statsFamilies}</div>
                </div>
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value">${familyStats.generations}</div>
                    <div class="tree-stats-header-label">${s.statsGenerations}</div>
                </div>
                <div class="tree-stats-header-item">
                    <div class="tree-stats-header-value tree-stats-header-span">${yearSpan}</div>
                    <div class="tree-stats-header-label">${s.statsYearSpan}</div>
                </div>
            </div>

            <div class="tree-stats-section">
                ${splitBar(s.statsMales, males, 'stats-split-male', s.statsFemales, females, 'stats-split-female')}
                ${splitBar(s.statsLiving, living, 'stats-split-living', s.statsDeceased, deceased, 'stats-split-deceased')}
            </div>

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${s.statsData}</div>
                ${progress(s.statsWithBirthDate, birthDatePct)}
                ${progress(s.statsWithDeathDate, deathDatePct)}
                ${progress(s.statsWithBirthPlace, birthPlacePct)}
                ${totalSources > 0 ? progress(s.statsSourceCoverage, sourceCoveragePct) : ''}
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

            <div class="tree-stats-section">
                <div class="tree-stats-section-title">${strings.stats.section}</div>
                ${this.generateFamilyStatsHtml(treeData, familyStats, avgChildren)}
            </div>
        `;
    },

    /** Visual family statistics (charts + record cards) for the dialog. */
    generateFamilyStatsHtml(treeData: StromData, stats: ReturnType<typeof computeFamilyStats>, avgChildren: string): string {
        const st = strings.stats;
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

        // Records as highlight cards.
        const card = (icon: string, label: string, value: string): string => `
            <div class="stats-record-card">
                <span class="stats-record-icon">${icon}</span>
                <div class="stats-record-text">
                    <div class="stats-record-label">${label}</div>
                    <div class="stats-record-value">${value}</div>
                </div>
            </div>`;
        const cards: string[] = [];
        if (stats.oldest) {
            cards.push(card('\u{1F3C6}', st.oldest, `${escXml(stats.oldest.name)} · ${stats.oldest.years} ${st.years}`));
        }
        if (stats.longestMarriage) {
            cards.push(card('\u{1F48D}', st.longestMarriage, `${escXml(stats.longestMarriage.names)} · ${stats.longestMarriage.years} ${st.years}`));
        }
        if (stats.largestFamily) {
            cards.push(card('\u{1F46A}', st.largestFamily, `${escXml(stats.largestFamily.names)} · ${st.childrenCount(stats.largestFamily.count)}`));
        }
        cards.push(card('\u{1F4CA}', strings.treeManager.statsAvgChildren, avgChildren));
        blocks.push(`<div class="stats-record-cards">${cards.join('')}</div>`);

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
        const items = upcomingAnniversaries(treeData, new Date(), 30, SettingsManager.isDeathAnniversariesEnabled()).slice(0, 10);
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
