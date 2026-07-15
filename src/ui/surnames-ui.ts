/**
 * Saying which surname spellings mean the same family (K3 v2).
 *
 * Written down once for the tree, because a spelling is a fact about the NAME.
 * The first version put spellings on each person, which meant that thirty Víšeks
 * needed thirty entries — in both directions, since the great-grandfathers are
 * recorded Vyšek and the living are Víšek — and the thirty-first person added
 * later missed out entirely.
 *
 * See src/surnames.ts for the model and src/ui/module.ts for the composition
 * pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { surnamesInTree, surnameKey } from '../surnames.js';
import { uiModule } from './module.js';

export const surnamesMethods = uiModule({
    /** @param parentDialogId dialog to return to on close (the tree manager) */
    showSurnamesDialog(parentDialogId?: string): void {
        this.surnamesParentDialog = parentDialogId ?? null;
        this.surnamePicks = [];

        document.getElementById('surnames-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'surnames-modal';
        overlay.innerHTML = `
            <div class="modal surnames-modal">
                <div class="modal-header">
                    <h2>${strings.surnames.title}</h2>
                    <button class="close-btn" id="surnames-close-x">&times;</button>
                </div>
                <p class="surnames-intro">${strings.surnames.intro}</p>
                <div id="surnames-groups"></div>
                <div class="surnames-add">
                    <div class="surnames-add-title">${strings.surnames.addTitle}</div>
                    <p class="surnames-hint">${strings.surnames.addHint}</p>
                    <div id="surnames-picker" class="surnames-picker"></div>
                    <div class="surnames-add-row">
                        <input type="text" id="surname-other" placeholder="${strings.surnames.addOther}">
                        <button type="button" class="secondary" id="surname-other-add">+</button>
                    </div>
                    <button type="button" class="primary" id="surnames-link" disabled>${strings.surnames.link}</button>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="secondary" id="surnames-close">${strings.buttons.close}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSurnamesDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#surnames-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#surnames-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#surnames-link') as HTMLButtonElement).onclick = () => this.linkSurnames();

        // A spelling the tree has never seen — the register's, which is exactly
        // the one you want to record and which no dropdown could offer.
        const other = overlay.querySelector('#surname-other') as HTMLInputElement;
        const addOther = (): void => {
            const name = other.value.trim();
            if (!name) return;
            if (!this.surnamePicks.some(p => surnameKey(p) === surnameKey(name))) {
                this.surnamePicks.push(name);
            }
            other.value = '';
            this.renderSurnamePicker();
        };
        (overlay.querySelector('#surname-other-add') as HTMLButtonElement).onclick = addOther;
        other.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } };

        this.renderSurnameGroups();
        this.renderSurnamePicker();

        this.clearDialogStack();
        if (this.surnamesParentDialog) {
            this.pushDialog(this.surnamesParentDialog);
            this.closeDialogById(this.surnamesParentDialog);
        }
        this.pushDialog('surnames-modal');
    },

    renderSurnameGroups(): void {
        const box = document.getElementById('surnames-groups');
        if (!box) return;
        const groups = DataManager.getData().surnameVariants ?? [];
        if (groups.length === 0) {
            box.innerHTML = `<p class="surnames-none">${strings.surnames.none}</p>`;
            return;
        }
        box.innerHTML = `<div class="surnames-groups-title">${strings.surnames.groupsTitle}</div>`
            + groups.map(group => `
                <div class="surname-group">
                    <span class="surname-group-names">${group.map(n => this.escapeHtml(n)).join('  =  ')}</span>
                    <button type="button" class="secondary surname-unlink" data-name="${this.escapeHtml(group[0])}">
                        ${strings.surnames.unlink}
                    </button>
                </div>`).join('');

        box.querySelectorAll('.surname-unlink').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                DataManager.removeSurnameGroup(btn.getAttribute('data-name') ?? '');
                this.renderSurnameGroups();
                this.renderSurnamePicker();
                TreeRenderer.render();
            };
        });
    },

    /** The tree's own surnames as toggles, plus whatever was typed in. */
    renderSurnamePicker(): void {
        const box = document.getElementById('surnames-picker');
        if (!box) return;
        const inTree = surnamesInTree(DataManager.getData());
        const typed = this.surnamePicks
            .filter(p => !inTree.some(t => surnameKey(t.surname) === surnameKey(p)))
            .map(surname => ({ surname, count: 0 }));

        box.innerHTML = [...inTree, ...typed].map(({ surname, count }) => {
            const picked = this.surnamePicks.some(p => surnameKey(p) === surnameKey(surname));
            return `
                <button type="button" class="surname-chip${picked ? ' picked' : ''}"
                        data-surname="${this.escapeHtml(surname)}">
                    ${this.escapeHtml(surname)}
                    <span class="surname-chip-count">${count > 0
                        ? strings.surnames.inTree(count) : strings.surnames.notInTree}</span>
                </button>`;
        }).join('');

        box.querySelectorAll('.surname-chip').forEach(chip => {
            (chip as HTMLButtonElement).onclick = () => {
                const name = chip.getAttribute('data-surname') ?? '';
                const at = this.surnamePicks.findIndex(p => surnameKey(p) === surnameKey(name));
                if (at >= 0) this.surnamePicks.splice(at, 1);
                else this.surnamePicks.push(name);
                this.renderSurnamePicker();
            };
        });

        const link = document.getElementById('surnames-link') as HTMLButtonElement | null;
        if (link) link.disabled = this.surnamePicks.length < 2;
    },

    linkSurnames(): void {
        if (this.surnamePicks.length < 2) return;
        DataManager.addSurnameGroup(this.surnamePicks);
        this.surnamePicks = [];
        this.showToast(strings.surnames.linked);
        this.renderSurnameGroups();
        this.renderSurnamePicker();
        TreeRenderer.render();
    },

    closeSurnamesDialog(): void {
        document.getElementById('surnames-modal')?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== 'surnames-modal');
        const parent = this.surnamesParentDialog;
        this.surnamesParentDialog = null;
        if (parent) document.getElementById(parent)?.classList.add('active');
    },
});
