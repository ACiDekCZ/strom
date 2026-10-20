/**
 * Tree actions: ONE list of whole-tree actions ("Tree: {name} ›", menu 1020
 * §3). The ⋯ actions menu's flyout (desktop), More → "Tree: {name}" (the
 * sheet) and the tree manager's ⋯ (its menu, its sheet on touch) all render
 * it, so the actions and their order never drift apart:
 *   Overview · [Export… — manager] · Research · Tree settings ·
 *   "Change structure ⌄" (collapsed) · Manage · [Manage trees… — not manager]
 * A tree that is not open gets the list without the rows that need the open
 * tree; a read-only tree (locked, followed live, locked data) only the rows
 * that read it (overview, quality, history) and Unlock when it is locked.
 */

import { TreeId, LAST_FOCUSED } from '../types.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { DataManager } from '../data.js';
import { countFamilies } from '../ged-exporter.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFileSize, formatRelativeDateTime } from '../format.js';
import { uiModule } from './module.js';
import { shownNameOrEmpty } from '../person-name.js';
import { onComputer } from './research-ui.js';

/** Drag on the sheet's head: this far up expands it, this far down closes it. */
const SHEET_EXPAND_PX = 40;
const SHEET_CLOSE_PX = 80;

/**
 * Where the list is opened from: the tree manager (its dialogs return there),
 * More (the sheet) or the ⋯ actions menu (its flyout).
 */
export type TreeActionSource = 'manager' | 'more' | 'actions';

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
    /** A secondary shortcut drawn muted (the overview's "Data quality" under "Tree overview"). */
    quiet?: boolean;
}

export type TreeActionGroupKey = 'overview' | 'outputs' | 'research' | 'settings' | 'structure' | 'manage' | 'trees';

export interface TreeActionGroup {
    key: TreeActionGroupKey;
    /** A heading over the rows (Research, Tree settings); without one a divider separates the group. */
    header?: string;
    /**
     * The rows fold under one row of this label ("Change structure ⌄"),
     * opened in place; closed again whenever the menu or sheet opens anew.
     */
    collapsedLabel?: string;
    rows: TreeActionRow[];
}

/**
 * The only rows that depend on where the list is opened (menu 1020 §3.1).
 * Export… and Send changes are one level up in Actions / More (the Research
 * menu sends), so the list carries them in the tree manager only, where they
 * act on any tree; "Manage trees…" closes the list everywhere but there.
 */
function sourceRows(source: TreeActionSource): { export: boolean; researchSend: boolean; manageTrees: boolean } {
    return {
        export: source === 'manager',
        researchSend: source === 'manager',
        manageTrees: source !== 'manager',
    };
}

/** Id of the "Change structure" group in a rendered list (aria-controls of its row). */
export const TREE_STRUCTURE_GROUP_SUFFIX = 'structure-group';

/**
 * Strom Research runs in a terminal on a computer: phones and tablets (a
 * coarse pointer) never reach its bridge, so they get no "send to research".
 */
export function researchRunsHere(): boolean {
    try { return !(window.matchMedia?.('(pointer: coarse)').matches ?? false); } catch { return true; }
}

/** View mode or locked data: rows marked editOnly are left out. */
export function editOnlyHidden(): boolean {
    const body = document.body.classList;
    return body.contains('view-mode') || body.contains('data-locked');
}

/** Touch in the bottom-navigation regime: the tree manager's ⋯ opens the sheet. */
export function treeActionsAsSheet(): boolean {
    try { return window.matchMedia?.('(max-width: 1024px) and (pointer: coarse)').matches ?? false; } catch { return false; }
}

/**
 * The row that folds a group ("Change structure ⌄"): a menu item that says
 * whether its group is open and which group it controls.
 */
export function collapsedToggle(label: string, groupId: string, className: string, labelClass: string, tag: 'button' | 'div' = 'button'): HTMLElement {
    const toggle = document.createElement(tag);
    if (toggle instanceof HTMLButtonElement) toggle.type = 'button';
    else toggle.tabIndex = -1;
    toggle.className = className;
    toggle.dataset.action = 'structure';
    toggle.setAttribute('role', 'menuitem');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', groupId);
    const text = document.createElement('span');
    text.className = labelClass;
    text.textContent = label;
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'tree-actions-structure-chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('width', '14');
    chevron.setAttribute('height', '14');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 9l6 6 6-6');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    chevron.appendChild(path);
    toggle.append(text, chevron);
    return toggle;
}

export const treeActionsMethods = uiModule({
    /** The tree's action groups; empty groups are left out. */
    async treeActionGroups(treeId: TreeId, source: TreeActionSource): Promise<TreeActionGroup[]> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return [];
        const s = strings.treeManager;
        const g = strings.treeActions.group;
        const isActive = treeId === TreeManager.getActiveTreeId();
        const by = sourceRows(source);
        // The tree manager's dialogs return to it on close.
        const parent = source === 'manager' ? 'tree-manager-modal' : undefined;
        const id = tree.id;
        // Read-only: a locked tree, the open tree followed live or locked data
        // (menu 1020 §10) — only what reads the tree, and Unlock when locked.
        const live = isActive && DataManager.isLiveFollowing();
        const readOnly = tree.isLocked === true || live || (isActive && DataManager.isReadOnly());

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
        const editable = !readOnly;

        const groups: TreeActionGroup[] = [
            { key: 'overview', rows: [
                { key: 'overview', label: strings.treeOverview.menu, run: () => void this.showTreeOverview(id, { parent }) },
                {
                    key: 'overview-quality', label: strings.treeOverview.menuQuality, quiet: true,
                    run: () => void this.showTreeOverview(id, { section: 'quality', scroll: true, parent }),
                },
                ...(editable ? [{ key: 'snapshots', label: strings.snapshots.menu, editOnly: true, run: () => void this.showSnapshotsDialog(id, parent) }] : []),
                ...(auditOffered ? [{ key: 'audit', label: strings.auditLog.viewLog, run: () => this.showAuditLogDialog(id, parent) }] : []),
            ] },
            { key: 'outputs', rows: by.export
                ? [{ key: 'export', label: s.export, run: () => this.showExportDialogFromManager(id) }] : [] },
            { key: 'research', header: g.research, rows: editable ? [
                ...(by.researchSend && tree.research && researchRunsHere()
                    ? [{ key: 'researchSend', label: strings.research.sendMenu, editOnly: true, run: () => void this.researchSendTree(id) }] : []),
                ...this.treeResearchRow(id, isActive),
            ] : [] },
            { key: 'settings', header: g.settings, rows: editable ? [
                { key: 'rename', label: s.rename, editOnly: true, run: () => this.showRenameTreeDialog(id, parent) },
                { key: 'defaultPerson', label: s.defaultPerson, value: defaultPerson || undefined, editOnly: true, run: () => void this.showDefaultPersonDialog(id, parent) },
                { key: 'startup', label: s.openAtStartup, checked: TreeManager.getDefaultTree() === id, editOnly: true, run: () => this.toggleStartupTree(id) },
                ...(isActive ? [
                    { key: 'places', label: strings.map.placesMenu, editOnly: true, run: () => this.showPlacesManager(undefined, parent) },
                    { key: 'surnames', label: strings.surnames.menu, editOnly: true, run: () => this.showSurnamesDialog(parent) },
                ] : []),
            ] : [] },
            { key: 'structure', collapsedLabel: strings.treeActions.structure, rows: editable ? [
                ...(isActive ? [
                    { key: 'makeTree', label: strings.menu.makeTree, editOnly: true, run: () => this.makeTreeFromCurrentView() },
                    { key: 'mergeView', label: strings.menu.mergeViewInto, editOnly: true, run: () => this.mergeViewInto() },
                    { key: 'splitFamilies', label: strings.menu.splitFamilies, hint: strings.menu.splitFamiliesHint, editOnly: true,
                        run: () => source === 'manager' ? void this.showSplitFamiliesPickerDialog(id, parent) : this.showSplitFamiliesDialog() },
                    { key: 'split', label: strings.split.menu, hint: strings.split.menuHint, editOnly: true, run: () => void this.showSplitDialog(id, parent) },
                ] : []),
                { key: 'mergeInto', label: s.mergeInto, editOnly: true, run: () => this.showMergeTreesDialog(id, parent) },
                { key: 'duplicate', label: s.duplicate, editOnly: true, run: () => this.duplicateTree(id, parent) },
            ] : [] },
            { key: 'manage', rows: editable ? [
                { key: 'visibility', label: tree.isHidden ? s.showTree : s.hideTree, editOnly: true, run: () => void this.toggleTreeVisibility(id) },
                { key: 'lock', label: strings.lock.lockTree, editOnly: true, run: () => this.toggleTreeLock(id) },
                { key: 'delete', label: s.delete, danger: true, editOnly: true, run: () => void this.confirmDeleteTree(id, parent) },
            ] : tree.isLocked
                ? [{ key: 'lock', label: strings.lock.unlockTree, editOnly: true, run: () => this.toggleTreeLock(id) }]
                : [] },
            { key: 'trees', rows: by.manageTrees
                ? [{ key: 'manageTrees', label: s.manage, run: () => this.showTreeManagerDialog() }] : [] },
        ];
        return groups.filter(group => group.rows.length > 0);
    },

    /**
     * The Research group's one row for a tree (menu 1020 §3.1): its research's
     * dialog when it has one, else the way in — "Start research ↗" where the
     * research runs on this computer, "Finish installing…" while an
     * installation waits, "Ancestor research" (what it is) otherwise.
     */
    treeResearchRow(id: TreeId, isActive: boolean): TreeActionRow[] {
        const tree = TreeManager.getTreeMetadata(id);
        if (!tree) return [];
        if (tree.research) {
            if (this.researchTranscriptsCapable(tree.research.id)) {
                return [{ key: 'researchSettings', label: strings.sync.treeSettings, run: () => void this.showResearchTreeSettings(id) }];
            }
            // A phone or tablet: where its research is (the explanation dialog says so).
            return isActive && !onComputer() && this.researchMenuItemVisible()
                ? [{ key: 'researchInfo', label: strings.research.menuItem, run: () => this.showResearchInfoDialog() }] : [];
        }
        if (this.researchAdoptAvailable(tree)) {
            return [{ key: 'researchAdopt', label: strings.research.adoptTree, editOnly: true, run: () => this.treeActionStartResearch(id) }];
        }
        if (!isActive || !this.researchMenuItemVisible()) return [];
        if (this.researchInstallPending()) {
            return [{ key: 'researchInstall', label: strings.install.menuResume, editOnly: true, run: () => this.showResearchInfoDialog() }];
        }
        return [{ key: 'researchInfo', label: strings.research.menuItem, run: () => this.showResearchInfoDialog() }];
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
        const readOnly = editOnlyHidden();
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
        const rowButton = (row: TreeActionRow): HTMLButtonElement => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bottom-sheet-item tree-actions-row' + (row.danger ? ' danger' : '') + (row.quiet ? ' is-quiet' : '');
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
            return btn;
        };
        groups.forEach((group, index) => {
            if (group.header) {
                const header = document.createElement('div');
                header.className = 'bottom-sheet-section';
                header.setAttribute('role', 'presentation');
                header.textContent = group.header;
                list.appendChild(header);
            } else if (index > 0) {
                const divider = document.createElement('div');
                divider.className = 'tree-actions-divider';
                divider.setAttribute('role', 'separator');
                list.appendChild(divider);
            }
            if (!group.collapsedLabel) {
                for (const row of group.rows) list.appendChild(rowButton(row));
                return;
            }
            // "Change structure ⌄": the rows open in place under their row.
            const groupId = `tree-actions-sheet-${TREE_STRUCTURE_GROUP_SUFFIX}`;
            const toggle = collapsedToggle(group.collapsedLabel, groupId, 'bottom-sheet-item tree-actions-row tree-actions-structure-toggle', 'bottom-sheet-label');
            const box = document.createElement('div');
            box.id = groupId;
            box.className = 'tree-actions-structure';
            box.setAttribute('role', 'group');
            box.setAttribute('aria-label', group.collapsedLabel);
            box.hidden = true;
            for (const row of group.rows) box.appendChild(rowButton(row));
            toggle.addEventListener('click', () => {
                const open = box.hidden;
                box.hidden = !open;
                toggle.setAttribute('aria-expanded', String(open));
                if (open) box.querySelector<HTMLElement>('.tree-actions-row')?.focus({ preventScroll: true });
            });
            list.append(toggle, box);
        });
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
