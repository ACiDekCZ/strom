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
import { runBusy, nextPaint, activatedElement, type BusyCtl } from './busy.js';
import { computeUnder } from './canvas-busy.js';
import { busyProg } from './busy-prog.js';


/** From this many people splitting a tree says its state at once (finding its parts takes longer than 120 ms). */
export const SPLIT_SHOWN_AT_ONCE = 3000;
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
        // §8: the tree read and its parts found under the working state of the choice (the canvas overlay
        // when its menu closed), at once for a large tree.
        const people = TreeManager.getTreeMetadata(id)?.personCount ?? 0;
        const found = await computeUnder(activatedElement(), async () => {
            const data = await this.splitDataFor(id);
            return data ? findComponents(data) : null;
        }, { label: strings.busy.findingParts, atOnce: people >= SPLIT_SHOWN_AT_ONCE });
        if (!found) return;

        this.splitTreeId = id;
        this.splitComponents = found;
        this.splitParentDialog = parentDialogId ?? null;

        document.getElementById('split-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'split-modal';
        overlay.innerHTML = `
            <div class="modal split-modal modal--md" role="dialog" data-dialog-kind="${this.splitComponents.length < 2 ? 'info' : 'form'}" aria-modal="true">
                <div class="modal-header">
                    <h2>${strings.split.title}</h2>
                    <button class="close-btn" id="split-close-x" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                ${this.splitComponents.length < 2
                    ? `<p class="split-intro">${strings.split.single}</p>`
                    : `<p class="split-intro">${strings.split.intro}</p>
                       <div class="split-list">${this.splitComponents.map((c, i) => this.splitRowHtml(c, i)).join('')}</div>
                       <p class="split-note">${strings.split.keepsOriginal}</p>`}
                ${this.splitComponents.length >= 2
                    ? `<div class="buttons">
                        <button type="button" class="secondary" id="split-close" data-dismiss>${strings.buttons.cancel}</button>
                        <button type="button" class="primary" id="split-go">${strings.split.selected(0)}</button>
                       </div>`
                    : `<div class="buttons">
                        <button type="button" class="secondary" id="split-close" data-dismiss>${strings.buttons.close}</button>
                       </div>`}
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSplitDialog();
        (overlay.querySelector('#split-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#split-close') as HTMLButtonElement).onclick = close;
        overlay.querySelectorAll('.split-check').forEach(box => {
            (box as HTMLInputElement).onchange = () => this.updateSplitButton();
        });
        const go = overlay.querySelector<HTMLButtonElement>('#split-go');
        // One working state from the click (§8): a second click splits nothing more.
        // 8b: the steps above the footer, the end ✓ "Created" and the sentence in the dialog.
        go?.addEventListener('click', () => void runBusy(go, ctl => this.performSplit(ctl),
            { label: strings.busy.creating, heavy: 'now', stepsInToast: true, done: strings.busy.done.created }));

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
    async performSplit(ctl?: BusyCtl): Promise<void> {
        const chosen = this.selectedSplitIndexes();
        if (chosen.length === 0 || !this.splitTreeId) return;

        const data = await this.splitDataFor(this.splitTreeId);
        if (!data) return;

        const modal = document.querySelector<HTMLElement>('#split-modal .split-modal');
        const footer = modal?.querySelector('.buttons') ?? null;
        modal?.querySelector('.busy-prog, .busy-prog-done')?.remove();
        const prog = ctl && modal ? busyProg(modal, footer) : null;
        for (const [k, index] of chosen.entries()) {
            const component = this.splitComponents[index];
            const name = componentName(component, strings.split.familyName, strings.split.noSurname);
            // Several trees: each one's step painted before its work (§8), above the footer (8b).
            if (ctl && chosen.length > 1) {
                const words = strings.busy.creatingTreeK(k + 1, chosen.length, name);
                ctl.step(words, k + 1, chosen.length);
                prog?.set(words, k + 1, chosen.length);
                await nextPaint();
            }
            const subtree = extractSubtree(data, new Set<PersonId>(component.personIds));
            TreeManager.createTreeFromImport(subtree, name, false);
        }

        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
        if (prog && modal?.isConnected) {
            // 8b: the dialog stays with the sentence; Split off locked, Cancel becomes Close.
            prog.done(strings.split.done(chosen.length));
            const go = modal.querySelector<HTMLButtonElement>('#split-go');
            if (go) go.disabled = true;
            modal.querySelectorAll<HTMLInputElement>('.split-check').forEach(x => { x.disabled = true; });
            const cancel = modal.querySelector<HTMLButtonElement>('#split-close');
            if (cancel) cancel.textContent = strings.buttons.close;
            return;
        }
        this.closeSplitDialog();
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
