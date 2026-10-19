/**
 * Saying which surname spellings mean the same family (K3 v2).
 *
 * Written down once for the tree, because a spelling is a fact about the NAME.
 * The first version put spellings on each person, which meant that thirty Fíšeks
 * needed thirty entries — in both directions, since the great-grandfathers are
 * recorded Fyšek and the living are Fíšek — and the thirty-first person added
 * later missed out entirely.
 *
 * See src/surnames.ts for the model and src/ui/module.ts for the composition
 * pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { surnamesInTree, surnameKey, marriedSurnameHolders } from '../surnames.js';
import { shownNameFull } from '../person-name.js';
import { displayYear } from '../dates.js';
import { PersonId } from '../types.js';
import { uiModule } from './module.js';
import { emptyStateHtml } from './empty-state.js';

export const surnamesMethods = uiModule({
    /** @param parentDialogId dialog to return to on close (the tree manager) */
    showSurnamesDialog(parentDialogId?: string): void {
        this.surnamesParentDialog = parentDialogId ?? null;
        this.surnamePicks = [];
        this.surnameMarriedOpen = null;

        document.getElementById('surnames-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'surnames-modal';
        overlay.innerHTML = `
            <div class="modal surnames-modal modal--md" role="dialog" data-dialog-kind="info" aria-modal="true">
                <div class="modal-header">
                    <h2>${strings.surnames.title}</h2>
                    <button class="close-btn" id="surnames-close-x" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <div class="surnames-intro">
                    <p>${strings.surnames.introShort}</p>
                    <details class="surnames-more">
                        <summary>${strings.surnames.more}</summary>
                        <p>${strings.surnames.intro}</p>
                    </details>
                </div>
                <div id="surnames-groups"></div>
                <div class="surnames-add">
                    <div class="surnames-add-title">${strings.surnames.addTitle}</div>
                    <p class="surnames-hint">${strings.surnames.addHint}</p>
                    <div id="surnames-picker" class="surnames-picker"></div>
                    <div class="surnames-add-row">
                        <input type="text" id="surname-other" placeholder="${strings.surnames.addOther}"
                               aria-label="${strings.surnames.addOther}">
                        <button type="button" class="secondary" id="surname-other-add">${strings.surnames.addSpelling}</button>
                    </div>
                </div>
                <div class="buttons">
                    <button type="button" class="secondary" id="surnames-close" data-dismiss>${strings.buttons.close}</button>
                    <button type="button" class="primary" id="surnames-link" disabled>${strings.surnames.link}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSurnamesDialog();
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        (overlay.querySelector('#surnames-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#surnames-close') as HTMLButtonElement).onclick = close;
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
        // Empty: heading only — the one-sentence intro right above already
        // says what linking is for, and the "Link spellings" form follows.
        if (groups.length === 0) {
            box.innerHTML = emptyStateHtml({
                title: strings.emptyStates.surnamesTitle,
                className: 'surnames-none',
                compact: true,
            });
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

        const data = DataManager.getData();
        box.innerHTML = [...inTree, ...typed].map(({ surname, count }) => {
            const picked = this.surnamePicks.some(p => surnameKey(p) === surnameKey(surname));
            const chip = `
                <button type="button" class="surname-chip${picked ? ' picked' : ''}"
                        data-surname="${this.escapeHtml(surname)}">
                    ${this.escapeHtml(surname)}
                    <span class="surname-chip-count">${count > 0
                        ? strings.surnames.inTree(count) : strings.surnames.notInTree}</span>
                </button>`;
            // Married surnames are shown beside the count, never added to it.
            const married = count > 0 ? marriedSurnameHolders(surname, data) : [];
            if (married.length === 0) return chip;
            const key = surnameKey(surname);
            const open = this.surnameMarriedOpen === key;
            const list = open ? `
                <div class="surname-married-list" id="surname-married-${this.escapeHtml(key)}">
                    ${married.map(p => {
                        const year = displayYear(p.birthDate);
                        return `<button type="button" class="surname-married-person" data-person-id="${this.escapeHtml(p.id)}">${
                            this.escapeHtml(shownNameFull(p))}${year ? ` <span class="surname-married-year">*${this.escapeHtml(year)}</span>` : ''}</button>`;
                    }).join('')}
                </div>` : '';
            return `
                <span class="surname-item">${chip}
                    <button type="button" class="surname-married-toggle" data-key="${this.escapeHtml(key)}"
                            aria-expanded="${open}">${this.escapeHtml(strings.surnames.alsoMarried(married.length))} ${open ? '▴' : '▾'}</button>
                </span>${list}`;
        }).join('');

        box.querySelectorAll<HTMLButtonElement>('.surname-married-toggle').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key ?? '';
                this.surnameMarriedOpen = this.surnameMarriedOpen === key ? null : key;
                this.renderSurnamePicker();
                (document.querySelector(`.surname-married-toggle[data-key="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
            };
        });
        // A person in the list: close the dialog and bring that person to the
        // tree's focus, as a found person does.
        box.querySelectorAll<HTMLButtonElement>('.surname-married-person').forEach(btn => {
            btn.onclick = () => {
                const id = btn.dataset.personId ?? '';
                this.surnamesParentDialog = null;
                this.closeSurnamesDialog();
                this.clearDialogStack();
                TreeRenderer.setFocus(id as PersonId);
                TreeRenderer.render();
            };
        });

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
