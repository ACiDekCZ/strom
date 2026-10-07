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
import { countFamilies } from '../ged-exporter.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFileSize, formatRelativeDateTime } from '../format.js';
import { uiModule } from './module.js';
import { shownNameOrEmpty } from '../person-name.js';

/** Drag on the sheet's head: this far up expands it, this far down closes it. */
const SHEET_EXPAND_PX = 40;
const SHEET_CLOSE_PX = 80;

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

/** Touch in the bottom-navigation regime: the tree manager's ⋯ opens the sheet. */
export function treeActionsAsSheet(): boolean {
    try { return window.matchMedia?.('(max-width: 1024px) and (pointer: coarse)').matches ?? false; } catch { return false; }
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
            defaultPerson = shownNameOrEmpty(p);
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

    /**
     * The tree-actions sheet (2.2): the tree's name and summary on top, the
     * groups as 48px rows below. Opens at 80% of the window, a drag up on its
     * head takes the full height, down closes it. "Open at startup" toggles in
     * place; every other row closes the sheet and runs. From the tree manager
     * it is a second layer: the manager stays open under it.
     */
    async presentTreeActionsSheet(treeId: TreeId, opts: { source: TreeActionSource }): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        const readOnly = document.body.classList.contains('view-mode');
        const groups = (await this.treeActionGroups(treeId, opts.source))
            .map(group => ({ ...group, rows: group.rows.filter(row => !(readOnly && row.editOnly)) }))
            .filter(group => group.rows.length > 0);
        const isActive = treeId === TreeManager.getActiveTreeId();
        const t = strings.treeActions;

        this.noteBottomSheetTrigger();
        this.hideBottomSheet();
        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        const sheet = document.createElement('div');
        sheet.className = 'bottom-sheet bottom-sheet-menu bottom-sheet-tree-actions';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', tree.name);

        // Head: handle, name + ×, subtitle, summary.
        const head = document.createElement('div');
        head.className = 'tree-actions-head';
        const handle = document.createElement('div');
        handle.className = 'bottom-sheet-handle';
        const titleRow = document.createElement('div');
        titleRow.className = 'tree-actions-title-row';
        const title = document.createElement('div');
        title.className = 'tree-actions-title';
        title.textContent = tree.name;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tree-actions-close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.textContent = '\u00d7';
        close.addEventListener('click', () => this.hideBottomSheet());
        titleRow.append(title, close);
        const sub = document.createElement('div');
        sub.className = 'tree-actions-sub';
        sub.textContent = isActive ? t.subActive : t.subOther;
        const summary = document.createElement('div');
        summary.className = 'tree-actions-summary';
        const treeData = await TreeManager.getTreeData(treeId);
        const lang = getCurrentLanguage();
        const facts = [
            strings.treeManager.persons(tree.personCount),
            strings.treeManager.families(treeData ? countFamilies(treeData) : 0),
            formatFileSize(tree.sizeBytes, lang),
            isActive
                ? t.edited(formatRelativeDateTime(new Date(tree.lastModifiedAt).getTime(), lang))
                : (tree.research ? t.researchLinked : t.researchNone),
        ].filter(Boolean);
        for (const fact of facts) {
            const span = document.createElement('span');
            span.textContent = fact;
            summary.appendChild(span);
        }
        head.append(handle, titleRow, sub, summary);
        sheet.appendChild(head);

        const list = document.createElement('div');
        list.className = 'bottom-sheet-items tree-actions-list';
        list.setAttribute('role', 'menu');
        list.setAttribute('aria-label', tree.name);
        for (const group of groups) {
            const header = document.createElement('div');
            header.className = 'bottom-sheet-section';
            header.setAttribute('role', 'presentation');
            header.textContent = group.header;
            list.appendChild(header);
            for (const row of group.rows) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'bottom-sheet-item tree-actions-row' + (row.danger ? ' danger' : '');
                btn.dataset.action = row.key;
                const label = document.createElement('span');
                label.className = 'bottom-sheet-label';
                label.textContent = row.label;
                btn.appendChild(label);
                if (row.checked !== undefined) {
                    btn.setAttribute('role', 'menuitemcheckbox');
                    btn.setAttribute('aria-checked', String(row.checked));
                    const toggle = document.createElement('span');
                    toggle.className = 'tree-actions-switch';
                    toggle.setAttribute('aria-hidden', 'true');
                    btn.appendChild(toggle);
                    btn.addEventListener('click', () => {
                        row.run();
                        btn.setAttribute('aria-checked', String(TreeManager.getDefaultTree() === treeId));
                    });
                } else {
                    btn.setAttribute('role', 'menuitem');
                    if (row.value !== undefined || row.key === 'defaultPerson') {
                        const value = document.createElement('span');
                        value.className = 'tree-actions-value';
                        value.textContent = row.value ?? '';
                        btn.appendChild(value);
                        const chevron = document.createElement('span');
                        chevron.className = 'tree-actions-chevron';
                        chevron.setAttribute('aria-hidden', 'true');
                        chevron.textContent = '\u203a';
                        btn.appendChild(chevron);
                    }
                    btn.addEventListener('click', () => {
                        this.hideBottomSheet();
                        row.run();
                    });
                }
                list.appendChild(btn);
            }
        }
        if (!isActive && !readOnly) {
            const note = document.createElement('p');
            note.className = 'tree-actions-note';
            note.textContent = t.moreWhenOpen;
            list.appendChild(note);
        }
        sheet.appendChild(list);
        overlay.appendChild(sheet);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.hideBottomSheet();
        });

        // A drag on the head: up = full height, down = close (the list scrolls itself).
        let startY = 0;
        let dragging = false;
        head.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            dragging = true;
            sheet.style.transition = 'none';
        }, { passive: true });
        head.addEventListener('touchmove', (e) => {
            if (!dragging) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        }, { passive: true });
        head.addEventListener('touchend', (e) => {
            dragging = false;
            sheet.style.transition = '';
            sheet.style.transform = '';
            const dy = e.changedTouches[0].clientY - startY;
            if (dy > SHEET_CLOSE_PX) this.hideBottomSheet();
            else if (dy < -SHEET_EXPAND_PX) sheet.classList.add('expanded');
        });

        document.body.appendChild(overlay);
        this.bottomSheet = overlay;
        requestAnimationFrame(() => overlay.classList.add('active'));
        list.querySelector<HTMLElement>('.tree-actions-row')?.focus({ preventScroll: true });
    },
});
