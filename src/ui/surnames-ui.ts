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
import { buildLineages, previewOverride, rodLabels, rodsOfSurnameGroup, type LineageChange, type RodId } from '../lineage.js';
import { lineagePreviewTexts } from '../lineage-preview.js';
import { shownName } from '../person-name.js';
import { uiModule } from './module.js';

/** The form whose × was pressed: its preview stands under its group until Cancel or Remove. */
let formPreview: string | null = null;
import { emptyStateHtml } from './empty-state.js';

export const surnamesMethods = uiModule({
    /** @param parentDialogId dialog to return to on close (the tree manager) */
    showSurnamesDialog(parentDialogId?: string): void {
        this.surnamesParentDialog = parentDialogId ?? null;
        this.surnamePicks = [];
        formPreview = null;
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
                <div id="surnames-suggest" class="surnames-suggest" hidden></div>
                <div id="surnames-groups"></div>
                <button type="button" class="ss-fold surnames-manual-toggle" id="surnames-manual-toggle" hidden></button>
                <div class="surnames-add">
                    <div class="surnames-add-title">${strings.surnames.addTitle}</div>
                    <p class="surnames-hint">${strings.surnames.addHint}</p>
                    <input type="search" id="surnames-filter" class="surnames-filter" placeholder="${strings.surnameSuggest.filter}"
                           aria-label="${strings.surnameSuggest.filter}" autocomplete="off">
                    <div id="surnames-picker" class="surnames-picker"></div>
                    <div class="surnames-add-row">
                        <input type="text" id="surname-other" placeholder="${strings.surnames.addOther}"
                               aria-label="${strings.surnames.addOther}">
                        <button type="button" class="secondary" id="surname-other-add">${strings.surnames.addSpelling}</button>
                    </div>
                </div>
                <div id="surnames-rejected" class="surnames-rejected" hidden></div>
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
        const filter = overlay.querySelector('#surnames-filter') as HTMLInputElement;
        filter.oninput = () => this.setSurnameFilter(filter.value);

        // Suggestions from the research (spec 021 §4): only for a research that makes them.
        this.resetSurnameSuggestView();
        this.renderSurnamesDialogParts();

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
        const ro = DataManager.isReadOnly() || DataManager.isTreeLocked();
        const data = DataManager.getData();
        const esc = (s: string): string => this.escapeHtml(s);
        // Which lineages each group concerns (grey "… line" after it), and the
        // lineage a removed form's preview is about.
        const index = buildLineages(data);
        const labels = rodLabels(index);
        const rodText = (ids: RodId[]): string => {
            if (ids.length === 0) return '';
            const names = ids.slice(0, 3).map(id => labels.get(id) ?? '');
            const text = ids.length === 1 ? strings.surnames.rodOf(names[0]) : strings.surnames.rodsOf(`${names.join(', ')}${ids.length > 3 ? ', …' : ''}`);
            return ` <span class="surname-group-rod">${esc(text)}</span>`;
        };
        const changeFor = (group: string[], form: string): LineageChange => {
            const rodId = rodsOfSurnameGroup(index, group)
                .find(id => surnameKey(index.rods.get(id)!.surname) !== surnameKey(form)) ?? null;
            return { kind: 'removeForm', rodId, form };
        };
        box.innerHTML = `<div class="surnames-groups-title">${strings.surnames.groupsTitle}</div>`
            + groups.map(group => {
                const marks = this.surnameGroupMarks(group);
                // × on every form but the first (the group's name): takes out that form alone.
                const names = group.map((n, i) => i === 0 || ro
                    ? `<span class="surname-form">${esc(n)}</span>`
                    : `<span class="surname-form">${esc(n)}<button type="button" class="surname-form-x" data-form="${esc(n)}"
                        aria-label="${esc(strings.surnames.removeForm(n))}" title="${esc(strings.surnames.removeForm(n))}"></button></span>`).join('  =  ');
                const open = !ro && formPreview !== null && group.some(n => surnameKey(n) === surnameKey(formPreview!));
                let preview = '';
                if (open) {
                    const form = group.find(n => surnameKey(n) === surnameKey(formPreview!))!;
                    const pv = previewOverride(data, changeFor(group, form), index);
                    const texts = lineagePreviewTexts(pv.lines, data, p => shownName(p));
                    const relation = pv.lines.find(l => l.kind === 'linkedByRelation');
                    const split = relation && relation.kind === 'linkedByRelation' && relation.personId
                        ? `<button type="button" class="secondary surname-form-split" data-id="${esc(relation.personId)}">${esc(strings.lineage.edit.splitBtn)}</button>` : '';
                    preview = `<div class="surname-form-preview" data-form="${esc(form)}">
                        <div class="le-preview" role="status">
                            <div class="le-preview-title">${esc(strings.lineage.preview.title)}</div>
                            ${texts.map((t, i) => `<p class="${pv.lines[i]?.kind === 'formWholeTree' ? 'le-faint' : ''}">${esc(t)}</p>`).join('')}
                        </div>
                        <div class="le-actions">
                            <button type="button" class="secondary surname-form-cancel">${esc(strings.buttons.cancel)}</button>
                            ${split}
                            <button type="button" class="primary surname-form-remove" data-form="${esc(form)}"${pv.patch ? '' : ' disabled'}>${esc(strings.lineage.edit.removeFormBtn)}</button>
                        </div>
                    </div>`;
                }
                return `
                <div class="surname-group${marks.isNew ? ' is-new' : ''}">
                    <span class="surname-group-text">
                        <span class="surname-group-names">${names}</span>${rodText(rodsOfSurnameGroup(index, group))}${marks.html}
                    </span>
                    ${ro ? '' : `<button type="button" class="secondary surname-unlink" data-name="${esc(group[0])}">
                        ${strings.surnames.unlink}
                    </button>`}
                    ${preview}
                </div>`;
            }).join('');

        box.querySelectorAll('.surname-unlink').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                formPreview = null;
                DataManager.removeSurnameGroup(btn.getAttribute('data-name') ?? '');
                this.renderSurnamesDialogParts();
                TreeRenderer.render();
            };
        });
        box.querySelectorAll<HTMLButtonElement>('.surname-form-x').forEach(btn => {
            btn.onclick = () => {
                formPreview = btn.dataset.form ?? null;
                this.renderSurnameGroups();
                box.querySelector<HTMLElement>('.surname-form-remove:not([disabled]), .surname-form-cancel')?.focus();
            };
        });
        box.querySelector<HTMLButtonElement>('.surname-form-cancel')?.addEventListener('click', () => {
            const form = formPreview;
            formPreview = null;
            this.renderSurnameGroups();
            if (form) box.querySelector<HTMLElement>(`.surname-form-x[data-form="${CSS.escape(form)}"]`)?.focus();
        });
        box.querySelector<HTMLButtonElement>('.surname-form-remove')?.addEventListener('click', (e) => {
            const form = (e.currentTarget as HTMLElement).dataset.form ?? '';
            const group = groups.find(g => g.some(n => surnameKey(n) === surnameKey(form)));
            if (!group) return;
            const pv = previewOverride(data, changeFor(group, form), index);
            formPreview = null;
            if (pv.patch) {
                const done = strings.auditLog.surnameFormRemoved(form, group.join(' · '));
                DataManager.applyLineagePatch(pv.patch, strings.undo.removeSurnameForm(form), { action: 'surnames.removeForm', text: done });
                // The undo pill's "Undo" rides in the toast over the dialog.
                this.showToast(`${done}.`, 6000, { kind: 'lineage-edit', clearOf: '#surnames-modal .buttons' });
            }
            this.renderSurnamesDialogParts();
            TreeRenderer.render();
        });
        // The form is joined to the line by a parent–child link: a line of its own instead.
        box.querySelector<HTMLButtonElement>('.surname-form-split')?.addEventListener('click', (e) => {
            const id = (e.currentTarget as HTMLElement).dataset.id as PersonId;
            formPreview = null;
            this.closeSurnamesDialog();
            this.openLineageSplitFrom(id);
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
        // The filter narrows the chips (by surnameKey, as search compares); a picked one always stays.
        const want = surnameKey(this.surnameFilterValue());
        const isPicked = (surname: string): boolean => this.surnamePicks.some(p => surnameKey(p) === surnameKey(surname));
        box.innerHTML = [...inTree, ...typed].filter(({ surname }) => !want || isPicked(surname) || surnameKey(surname).includes(want)).map(({ surname, count }) => {
            const picked = isPicked(surname);
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
        // The filter only once there are enough chips to look for one.
        const filter = document.getElementById('surnames-filter') as HTMLInputElement | null;
        if (filter) filter.hidden = inTree.length < 8 && !filter.value;
    },

    linkSurnames(): void {
        if (this.surnamePicks.length < 2) return;
        DataManager.addSurnameGroup(this.surnamePicks);
        this.surnamePicks = [];
        this.showToast(strings.surnames.linked);
        this.renderSurnamesDialogParts();
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
