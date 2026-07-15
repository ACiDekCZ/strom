/**
 * Splitting a tree into the families it actually holds (N3).
 *
 * Only families that nothing connects are offered — see src/components.ts for
 * why. The split is a COPY: the chosen families become new trees and the
 * original is left exactly as it was, for the user to delete when they are
 * happy. Cutting up someone's family tree is not a thing to do without a way
 * back, and "the original is still there" is the simplest way back there is.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, TreeId, StromData } from '../types.js';
import { findComponents, componentName, TreeComponent } from '../components.js';
import { extractSubtree } from '../subtree.js';
import { uiModule } from './module.js';

export const splitMethods = uiModule({
    /** The active tree is in memory; any other has to be read from storage. */
    async splitDataFor(id: TreeId): Promise<StromData | null> {
        return id === DataManager.getCurrentTreeId()
            ? DataManager.getData()
            : await TreeManager.getTreeData(id);
    },

    /**
     * @param treeId which tree to split (defaults to the active one)
     * @param parentDialogId dialog to return to on close (the tree manager)
     */
    async showSplitDialog(treeId?: string, parentDialogId?: string): Promise<void> {
        const id = (treeId as TreeId) || DataManager.getCurrentTreeId();
        if (!id) return;
        const data = await this.splitDataFor(id);
        if (!data) return;

        this.splitTreeId = id;
        this.splitComponents = findComponents(data);
        this.splitParentDialog = parentDialogId ?? null;

        document.getElementById('split-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'split-modal';
        overlay.innerHTML = `
            <div class="modal split-modal">
                <div class="modal-header">
                    <h2>${strings.split.title}</h2>
                    <button class="close-btn" id="split-close-x">&times;</button>
                </div>
                ${this.splitComponents.length < 2
                    ? `<p class="split-intro">${strings.split.single}</p>`
                    : `<p class="split-intro">${strings.split.intro}</p>
                       <div class="split-list">${this.splitComponents.map((c, i) => this.splitRowHtml(c, i)).join('')}</div>
                       <p class="split-note">${strings.split.keepsOriginal}</p>`}
                <div class="modal-buttons">
                    <button type="button" class="secondary" id="split-close">${strings.buttons.close}</button>
                    ${this.splitComponents.length >= 2
                        ? `<button type="button" class="primary" id="split-go">${strings.split.selected(0)}</button>` : ''}
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSplitDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#split-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#split-close-x') as HTMLButtonElement).onclick = close;
        overlay.querySelectorAll('.split-check').forEach(box => {
            (box as HTMLInputElement).onchange = () => this.updateSplitButton();
        });
        (overlay.querySelector('#split-go') as HTMLButtonElement | null)?.addEventListener(
            'click', () => void this.performSplit());

        this.clearDialogStack();
        if (this.splitParentDialog) {
            this.pushDialog(this.splitParentDialog);
            this.closeDialogById(this.splitParentDialog);
        }
        this.pushDialog('split-modal');
        this.updateSplitButton();
    },

    /** One family, described so it can be told apart from the others. */
    splitRowHtml(component: TreeComponent, index: number): string {
        const esc = (t: string): string => this.escapeHtml(t);
        const name = componentName(component, strings.split.familyName, strings.split.noSurname);
        const bits = [strings.split.persons(component.count)];
        if (component.oldest) bits.push(strings.split.oldest(component.oldest.name, component.oldest.year));
        // A one-person "family" is the interesting case: someone linked to nobody.
        if (component.count === 1) bits.push(strings.split.alone);

        return `
            <label class="split-row">
                <input type="checkbox" class="split-check" data-index="${index}">
                <span class="split-row-text">
                    <strong>${esc(name)}</strong>
                    <span class="split-row-meta">${esc(bits.join('  ·  '))}</span>
                    ${component.surnames.length > 1
                        ? `<span class="split-row-names">${esc(component.surnames.join(', '))}</span>` : ''}
                </span>
            </label>`;
    },

    selectedSplitIndexes(): number[] {
        return [...document.querySelectorAll('.split-check')]
            .filter(b => (b as HTMLInputElement).checked)
            .map(b => Number(b.getAttribute('data-index')));
    },

    updateSplitButton(): void {
        const btn = document.getElementById('split-go') as HTMLButtonElement | null;
        if (!btn) return;
        const n = this.selectedSplitIndexes().length;
        btn.textContent = strings.split.selected(n);
        btn.disabled = n === 0;
    },

    /**
     * Copy each chosen family into a tree of its own. The original is not
     * touched — no data is moved, only duplicated, so a wrong pick costs a
     * delete rather than a family.
     */
    async performSplit(): Promise<void> {
        const chosen = this.selectedSplitIndexes();
        if (chosen.length === 0 || !this.splitTreeId) return;

        const data = await this.splitDataFor(this.splitTreeId);
        if (!data) return;

        for (const index of chosen) {
            const component = this.splitComponents[index];
            const subtree = extractSubtree(data, new Set<PersonId>(component.personIds));
            const name = componentName(component, strings.split.familyName, strings.split.noSurname);
            TreeManager.createTreeFromImport(subtree, name);
        }

        this.closeSplitDialog();
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        this.showToast(strings.split.done(chosen.length));
    },

    closeSplitDialog(): void {
        document.getElementById('split-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'split-modal');
        const parent = this.splitParentDialog;
        this.splitParentDialog = null;
        if (parent) document.getElementById(parent)?.classList.add('active');
    },
});
