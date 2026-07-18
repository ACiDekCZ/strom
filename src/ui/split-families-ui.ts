/**
 * "Split into families" (N4): break the whole tree into clean new trees, seen
 * from the focused person. The first tree is the current view; the rest are the
 * families that branch off it, discovered by following boundary persons. The
 * original tree is never touched — the split copies, it does not move.
 *
 * The heavy lifting (who lands in which family) is pure and lives in
 * src/split-families.ts; this module is only the dialog and the tree creation,
 * both built on the same primitives as "Make a tree from this view".
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, StromData, TreeId } from '../types.js';
import { decomposeIntoFamilies, seedIdsFor, FamilyComponent } from '../split-families.js';
import { extractSubtree } from '../subtree.js';
import { TreePreview, renderTreeThumbnail } from '../tree-preview.js';
import { AuditLogManager } from '../audit-log.js';
import * as CrossTree from '../cross-tree.js';
import { uiModule } from './module.js';

export const splitFamiliesMethods = uiModule({
    /** The person a family should be named after (connector, or the focus itself). */
    splitFamilyNameAnchor(component: FamilyComponent): PersonId {
        return component.connectorId ?? component.focusId;
    },

    /** "Rodina {full name}" suggested tree name for a family. */
    splitFamilyDefaultName(component: FamilyComponent): string {
        const person = DataManager.getPerson(this.splitFamilyNameAnchor(component));
        const name = person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : '';
        return strings.splitFamilies.familyName(name || '?');
    },

    /**
     * Open the split dialog. WYSIWYG: the first family is exactly the persons on
     * screen now, at the current depths; the rest follow from there.
     */
    showSplitFamiliesDialog(): void {
        if (DataManager.isViewMode()) return;
        const focus = TreeRenderer.getFocusPersonId();
        const firstViewIds = TreeRenderer.getVisiblePersonIds();
        if (!focus || firstViewIds.size < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            return;
        }

        const components = decomposeIntoFamilies(DataManager.getData(), focus, {
            ancestorDepth: TreeRenderer.getFocusDepthUp(),
            descendantDepth: TreeRenderer.getFocusDepthDown(),
            includeAuntsUncles: true,
            includeCousins: true,
            firstViewIds,
        });
        // A single family means there is nothing to split — say so plainly.
        if (components.length < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            return;
        }
        this.splitFamiliesComponents = components;

        const s = strings.splitFamilies;
        document.getElementById('split-families-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'split-families-modal';
        overlay.innerHTML = `
            <div class="modal splitfam-modal">
                <div class="modal-header">
                    <h2>${s.title}</h2>
                    <button class="close-btn" id="splitfam-close-x">&times;</button>
                </div>
                <p class="splitfam-intro">${s.intro}</p>
                <div class="splitfam-list">
                    ${components.map((c, i) => this.splitFamiliesRowHtml(c, i)).join('')}
                </div>
                <p class="splitfam-note">${s.keepsOriginal}</p>
                <div class="modal-buttons splitfam-footer">
                    <span class="splitfam-summary" id="splitfam-summary"></span>
                    <span class="splitfam-footer-buttons">
                        <button type="button" class="secondary" id="splitfam-cancel">${s.cancel}</button>
                        <button type="button" class="primary" id="splitfam-go"></button>
                    </span>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSplitFamiliesDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#splitfam-cancel') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#splitfam-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#splitfam-go') as HTMLButtonElement).onclick = () => void this.performSplitFamilies();
        overlay.querySelectorAll('.splitfam-check').forEach(box => {
            (box as HTMLInputElement).onchange = () => this.updateSplitFamiliesFooter();
        });
        overlay.querySelectorAll('.splitfam-preview-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => this.previewSplitFamily(Number(btn.getAttribute('data-index')));
        });

        // Thumbnails render after the boxes are in the DOM (they size to the box).
        components.forEach((c, i) => {
            const box = overlay.querySelector(`.splitfam-thumb[data-index="${i}"]`) as HTMLElement | null;
            if (box) this.renderSplitFamilyThumb(box, c);
        });

        this.clearDialogStack();
        this.pushDialog('split-families-modal');
        this.updateSplitFamiliesFooter();
    },

    /** One proposed family, with its name field, count, thumbnail and checkbox. */
    splitFamiliesRowHtml(component: FamilyComponent, index: number): string {
        const s = strings.splitFamilies;
        const count = component.personIds.length;
        const badge = component.isFirst ? `<span class="splitfam-badge">${s.yourView}</span>` : '';
        return `
            <div class="splitfam-row">
                <label class="splitfam-check-wrap">
                    <input type="checkbox" class="splitfam-check" data-index="${index}" checked>
                </label>
                <div class="splitfam-thumb" data-index="${index}"></div>
                <div class="splitfam-row-body">
                    <input type="text" class="splitfam-name" data-index="${index}"
                        value="${this.escapeHtml(this.splitFamilyDefaultName(component))}"
                        placeholder="${s.namePlaceholder}" aria-label="${s.namePlaceholder}">
                    <div class="splitfam-row-meta">
                        <span>${s.persons(count)}</span>${badge}
                        <button type="button" class="splitfam-preview-btn" data-index="${index}">${s.preview}</button>
                    </div>
                </div>
            </div>`;
    },

    /** The self-contained data behind a family's proposed tree (with its anchor). */
    splitFamilySubtree(component: FamilyComponent): StromData {
        return extractSubtree(DataManager.getData(), seedIdsFor(component));
    },

    /** Draw the small tree preview for a row. */
    renderSplitFamilyThumb(box: HTMLElement, component: FamilyComponent): void {
        try {
            renderTreeThumbnail(box, {
                data: this.splitFamilySubtree(component),
                focusPersonId: component.defaultPersonId,
                depthUp: 2,
                depthDown: 2,
            });
        } catch {
            // A thumbnail is a nicety; never let it block the split.
        }
    },

    /** Open the full, pannable preview for one proposed family. */
    previewSplitFamily(index: number): void {
        const component = this.splitFamiliesComponents[index];
        if (!component) return;
        const data = this.splitFamilySubtree(component);
        TreePreview.show({
            data,
            focusPersonId: component.defaultPersonId,
            depthUp: 3,
            depthDown: 3,
            title: this.readSplitFamilyName(index),
        });
    },

    /** The (possibly edited) name typed for a row, falling back to the default. */
    readSplitFamilyName(index: number): string {
        const input = document.querySelector(`.splitfam-name[data-index="${index}"]`) as HTMLInputElement | null;
        const typed = input?.value.trim();
        return typed || this.splitFamilyDefaultName(this.splitFamiliesComponents[index]);
    },

    selectedSplitFamiliesIndexes(): number[] {
        return [...document.querySelectorAll('.splitfam-check')]
            .filter(b => (b as HTMLInputElement).checked)
            .map(b => Number(b.getAttribute('data-index')));
    },

    updateSplitFamiliesFooter(): void {
        const chosen = this.selectedSplitFamiliesIndexes();
        const persons = chosen.reduce((sum, i) => sum + this.splitFamiliesComponents[i].personIds.length, 0);
        const summary = document.getElementById('splitfam-summary');
        if (summary) summary.textContent = strings.splitFamilies.summary(chosen.length, persons);
        const btn = document.getElementById('splitfam-go') as HTMLButtonElement | null;
        if (btn) {
            btn.textContent = strings.splitFamilies.create(chosen.length);
            btn.disabled = chosen.length === 0;
        }
    },

    /**
     * Create a new tree from each ticked family. Each carries its full data
     * (photos, notes, events, sources, registries) via extractSubtree, opens on
     * its own focus/connector, and shares that connector card with its neighbour
     * so the cross-tree badge links the families. The original is left as it was;
     * one audit entry records the split. Unticked families are simply not made.
     */
    async performSplitFamilies(): Promise<void> {
        const chosen = this.selectedSplitFamiliesIndexes();
        if (chosen.length === 0) return;

        const originalTreeId = DataManager.getCurrentTreeId();
        const data = DataManager.getData();
        let createdPersons = 0;

        for (const index of chosen) {
            const component = this.splitFamiliesComponents[index];
            const subtree = extractSubtree(data, seedIdsFor(component));
            subtree.defaultPersonId = component.defaultPersonId;
            createdPersons += Object.keys(subtree.persons).length;
            TreeManager.createTreeFromImport(subtree, this.readSplitFamilyName(index));
        }

        // The split copies; the user stays on the untouched original.
        if (originalTreeId) TreeManager.setActiveTree(originalTreeId);
        AuditLogManager.log(originalTreeId, 'tree.split',
            strings.auditLog.splitFamilies(chosen.length, createdPersons));

        // New trees mean new cross-tree matches (the shared connector cards).
        CrossTree.invalidateCache();

        this.closeSplitFamiliesDialog();
        this.updateTreeSwitcher();
        void this.updateTreeManagerList();
        TreeRenderer.render();
        this.showToast(strings.splitFamilies.done(chosen.length));
    },

    closeSplitFamiliesDialog(): void {
        document.getElementById('split-families-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'split-families-modal');
    },
});
