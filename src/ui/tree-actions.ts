/**
 * Tree actions: ONE list of whole-tree actions in six groups (Overview ·
 * Outputs · Research · Tree settings · Structure · Manage). The tree manager's
 * ⋯ menu (desktop), its sheet (touch) and More → "Tree: {name}" all render it,
 * so the actions and their order never drift apart. A tree that is not open
 * gets the list without the rows that need the open tree.
 */

import { TreeId, LAST_FOCUSED } from '../types.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { strings } from '../strings.js';
import { uiModule } from './module.js';

/** Where the list is opened from: the tree manager (its dialogs return there) or More. */
export type TreeActionSource = 'manager' | 'more';

export interface TreeActionRow {
    /** Stable key (tests, focus). */
    key: string;
    label: string;
    run: () => void;
    danger?: boolean;
    /** Hidden in read-only (view) mode. */
    editOnly?: boolean;
    /** A checkable row toggled in place ("Open at startup"). */
    checked?: boolean;
    /** A value shown at the row's end ("Default person: Johan Berg"). */
    value?: string;
    /** A quiet hint (tooltip). */
    hint?: string;
}

export interface TreeActionGroup {
    key: 'overview' | 'outputs' | 'research' | 'settings' | 'structure' | 'manage';
    header: string;
    rows: TreeActionRow[];
}

/**
 * Strom Research runs in a terminal on a computer: phones and tablets (a
 * coarse pointer) never reach its bridge, so they get no "send to research".
 */
export function researchRunsHere(): boolean {
    try { return !(window.matchMedia?.('(pointer: coarse)').matches ?? false); } catch { return true; }
}

export const treeActionsMethods = uiModule({
    /** The tree's action groups; empty groups are left out. */
    async treeActionGroups(treeId: TreeId, source: TreeActionSource): Promise<TreeActionGroup[]> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return [];
        const s = strings.treeManager;
        const g = strings.treeActions.group;
        const isActive = treeId === TreeManager.getActiveTreeId();
        // The tree manager's dialogs return to it on close.
        const parent = source === 'manager' ? 'tree-manager-modal' : undefined;
        const id = tree.id;

        const treeData = await TreeManager.getTreeData(id);
        const defaultSetting = treeData?.defaultPersonId;
        let defaultPerson = '';
        if (defaultSetting === LAST_FOCUSED) {
            defaultPerson = s.defaultPersonLastFocused;
        } else if (defaultSetting && treeData?.persons[defaultSetting]) {
            const p = treeData.persons[defaultSetting];
            defaultPerson = `${p.firstName} ${p.lastName}`.trim();
        }
        const auditOffered = isActive && (AuditLogManager.isEnabled() || await AuditLogManager.hasEntries(id));

        const groups: TreeActionGroup[] = [
            { key: 'overview', header: g.overview, rows: [
                { key: 'stats', label: s.stats, run: () => void this.showTreeStatsDialog(id, parent) },
                { key: 'health', label: strings.treeHealth.menu, run: () => void this.showTreeHealthDialog(id, parent) },
                ...(auditOffered ? [{ key: 'audit', label: strings.auditLog.viewLog, run: () => this.showAuditLogDialog(id, parent) }] : []),
            ] },
            { key: 'outputs', header: g.outputs, rows: [
                { key: 'export', label: s.export, run: () => source === 'manager' ? this.showExportDialogFromManager(id) : this.showExportDialog() },
                { key: 'snapshots', label: strings.snapshots.menu, editOnly: true, run: () => void this.showSnapshotsDialog(id, parent) },
                // Only for a tree linked to a file (linking is in Export).
                ...(isActive && this.activeFileHandleName
                    ? [{ key: 'saveToFile', label: strings.fileAccess.saveToFile, editOnly: true, run: () => void this.saveActiveTreeToFile() }]
                    : []),
            ] },
            { key: 'research', header: g.research, rows: [
                ...(tree.research && researchRunsHere()
                    ? [{ key: 'researchSend', label: strings.research.sendMenu, editOnly: true, run: () => void this.researchSendTree(id) }] : []),
                ...(this.researchAdoptAvailable(tree)
                    ? [{ key: 'researchAdopt', label: strings.research.adoptTree, editOnly: true, run: () => this.treeActionStartResearch(id) }] : []),
                ...(tree.research && this.researchTranscriptsCapable(tree.research.id)
                    ? [{ key: 'researchSettings', label: strings.sync.treeSettingsRow, run: () => void this.showResearchTreeSettings(id) }] : []),
            ] },
            { key: 'settings', header: g.settings, rows: [
                { key: 'rename', label: s.rename, editOnly: true, run: () => this.showRenameTreeDialog(id, parent) },
                { key: 'defaultPerson', label: s.defaultPerson, value: defaultPerson || undefined, editOnly: true, run: () => void this.showDefaultPersonDialog(id, parent) },
                { key: 'startup', label: s.openAtStartup, checked: TreeManager.getDefaultTree() === id, editOnly: true, run: () => this.toggleStartupTree(id) },
                ...(isActive ? [
                    { key: 'places', label: strings.map.placesTitle, editOnly: true, run: () => this.showPlacesManager(undefined, parent) },
                    { key: 'surnames', label: strings.surnames.menu, editOnly: true, run: () => this.showSurnamesDialog(parent) },
                ] : []),
            ] },
            { key: 'structure', header: g.structure, rows: [
                ...(isActive ? [
                    { key: 'makeTree', label: strings.menu.makeTree, editOnly: true, run: () => this.makeTreeFromCurrentView() },
                    { key: 'mergeView', label: strings.menu.mergeViewInto, editOnly: true, run: () => this.mergeViewInto() },
                    { key: 'splitFamilies', label: strings.menu.splitFamilies, hint: strings.menu.splitFamiliesHint, editOnly: true,
                        run: () => source === 'manager' ? void this.showSplitFamiliesPickerDialog(id, parent) : this.showSplitFamiliesDialog() },
                    { key: 'split', label: strings.split.menu, hint: strings.split.menuHint, editOnly: true, run: () => void this.showSplitDialog(id, parent) },
                ] : []),
                { key: 'mergeInto', label: s.mergeInto, editOnly: true, run: () => this.showMergeTreesDialog(id, parent) },
                { key: 'duplicate', label: s.duplicate, editOnly: true, run: () => this.duplicateTree(id) },
            ] },
            { key: 'manage', header: g.manage, rows: [
                { key: 'visibility', label: tree.isHidden ? s.showTree : s.hideTree, editOnly: true, run: () => void this.toggleTreeVisibility(id) },
                { key: 'lock', label: tree.isLocked ? strings.lock.unlockTree : strings.lock.lockTree, editOnly: true, run: () => this.toggleTreeLock(id) },
                { key: 'delete', label: s.delete, danger: true, editOnly: true, run: () => void this.confirmDeleteTree(id) },
            ] },
        ];
        return groups.filter(group => group.rows.length > 0);
    },
});
