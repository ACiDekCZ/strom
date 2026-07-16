/**
 * Family wizard: one form to add a whole family around an anchor person —
 * parents, a partner, siblings and children — saved as a single undo step via
 * DataManager.addFamily. Each name row offers a duplicate hint ("use existing")
 * so the wizard never creates duplicates.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, Gender, FamilyWizardMember, FamilyWizardSpec } from '../types.js';
import { findSimilarPersons } from '../merge/matching.js';
import { normalizeDateInput } from '../dates.js';
import { uiModule } from './module.js';

type RowKind = 'father' | 'mother' | 'partner' | 'sibling' | 'child';

export const familyWizardMethods = uiModule({
    /**
     * Toolbar "Add family" shortcut: the wizard needs an anchor person, so it
     * opens around the current focus; on an empty tree it falls back to the
     * plain add-person dialog.
     */
    startFamilyWizardFromToolbar(): void {
        const focusId = TreeRenderer.getFocusPersonId();
        if (!focusId || !DataManager.getPerson(focusId)) {
            this.showAddPersonModal();
            return;
        }
        this.showFamilyWizard(focusId);
    },

    /** Open the wizard for the given anchor person. */
    showFamilyWizard(anchorId: PersonId): void {
        const anchor = DataManager.getPerson(anchorId);
        if (!anchor || DataManager.isViewMode()) return;
        this.clearDialogStack?.();
        this.closeMobileMenu?.();
        this.hideContextMenu?.();
        this.wizardAnchorId = anchorId;
        const fw = strings.familyWizard;

        const surname = anchor.lastName;
        document.getElementById('family-wizard-anchor')!.textContent = fw.aroundName(`${anchor.firstName} ${anchor.lastName}`.trim());
        document.getElementById('wiz-parents')!.innerHTML =
            this.wizardRowHtml('father', 'male', surname) + this.wizardRowHtml('mother', 'female', surname);
        document.getElementById('wiz-partner')!.innerHTML = this.wizardRowHtml('partner', 'female', '');
        document.getElementById('wiz-siblings')!.innerHTML = this.wizardRowHtml('sibling', 'male', surname);
        document.getElementById('wiz-children')!.innerHTML = this.wizardRowHtml('child', 'male', surname);

        document.getElementById('family-wizard-modal')!.classList.add('active');
        this.wireFamilyWizardOnce();
    },

    closeFamilyWizard(): void {
        document.getElementById('family-wizard-modal')?.classList.remove('active');
        this.wizardAnchorId = null;
    },

    /**
     * Non-blocking offer (after the first person) to add the whole family. A
     * small action toast — it never steals focus or blocks the canvas, so it
     * cannot interrupt other flows. Auto-dismisses.
     */
    showFamilyOffer(personId: PersonId): void {
        document.querySelector('.family-offer')?.remove();
        const fw = strings.familyWizard;
        const el = document.createElement('div');
        el.className = 'family-offer';
        el.innerHTML = `<span>${this.escapeHtml(fw.continuePrompt)}</span>`
            + `<button type="button" class="family-offer-btn">${this.escapeHtml(fw.continueYes)}</button>`
            + `<button type="button" class="family-offer-close" aria-label="close">&times;</button>`;
        el.querySelector('.family-offer-btn')!.addEventListener('click', () => {
            el.remove();
            this.showFamilyWizard(personId);
        });
        el.querySelector('.family-offer-close')!.addEventListener('click', () => el.remove());
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => el.remove(), 12000);
    },

    /** One editable person row. `partner` also carries a wedding-year field. */
    wizardRowHtml(kind: RowKind, gender: Gender, lastName: string): string {
        const fw = strings.familyWizard;
        const label = fw.roles[kind];
        const removable = kind === 'sibling' || kind === 'child';
        const ls = this.escapeHtml(lastName);
        return `<div class="wiz-row" data-kind="${kind}">
            <span class="wiz-role">${label}</span>
            <input class="wiz-first" type="text" placeholder="${fw.firstName}">
            <input class="wiz-last" type="text" placeholder="${fw.lastName}" value="${ls}">
            <select class="wiz-gender">
                <option value="male"${gender === 'male' ? ' selected' : ''}>${strings.gender.male}</option>
                <option value="female"${gender === 'female' ? ' selected' : ''}>${strings.gender.female}</option>
            </select>
            <input class="wiz-birth" type="text" placeholder="${fw.year}">
            ${kind === 'partner' ? `<input class="wiz-wedding" type="text" placeholder="${fw.weddingYear}">` : ''}
            ${removable ? `<button class="wiz-remove" type="button" title="${fw.remove}">×</button>` : '<span class="wiz-spacer"></span>'}
            <div class="wiz-hint"></div>
        </div>`;
    },

    /** Append another sibling/child row. */
    wizardAddRow(kind: 'sibling' | 'child'): void {
        const anchor = this.wizardAnchorId ? DataManager.getPerson(this.wizardAnchorId) : null;
        const surname = anchor?.lastName ?? '';
        const container = document.getElementById(kind === 'sibling' ? 'wiz-siblings' : 'wiz-children');
        container?.insertAdjacentHTML('beforeend', this.wizardRowHtml(kind, 'male', surname));
    },

    /** Read one row into a member (empty rows collapse to a blank member). */
    readWizardRow(row: HTMLElement): FamilyWizardMember & { weddingDate?: string } {
        const val = (sel: string) => (row.querySelector(sel) as HTMLInputElement | null)?.value.trim() ?? '';
        const existingId = row.dataset.existingId as PersonId | undefined;
        // Normalize flex dates the same way the person modal does — raw input
        // like "5.6.1980" must not land in the data unparsed.
        const birth = normalizeDateInput(val('.wiz-birth'));
        const wedding = normalizeDateInput(val('.wiz-wedding'));
        return {
            ...(existingId ? { existingId } : {}),
            firstName: val('.wiz-first'),
            lastName: val('.wiz-last'),
            gender: ((row.querySelector('.wiz-gender') as HTMLSelectElement | null)?.value as Gender) ?? 'male',
            ...(birth ? { birthDate: birth } : {}),
            ...(wedding ? { weddingDate: wedding } : {}),
        };
    },

    saveFamilyWizard(): void {
        const anchorId = this.wizardAnchorId;
        if (!anchorId) return;
        const rows = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
        const one = (sel: string) => {
            const el = document.querySelector<HTMLElement>(sel);
            return el ? this.readWizardRow(el) : undefined;
        };

        const spec: FamilyWizardSpec = {
            anchorId,
            father: one('.wiz-row[data-kind="father"]'),
            mother: one('.wiz-row[data-kind="mother"]'),
            partner: one('.wiz-row[data-kind="partner"]'),
            siblings: rows('.wiz-row[data-kind="sibling"]').map(r => this.readWizardRow(r)),
            children: rows('.wiz-row[data-kind="child"]').map(r => this.readWizardRow(r)),
        };

        const created = DataManager.addFamily(spec);
        this.closeFamilyWizard();
        TreeRenderer.render();
        this.refreshSearch();
        this.showToast(strings.familyWizard.added(created));
    },

    /** Duplicate hint for a row: suggest linking to an existing similar person. */
    checkWizardDuplicate(row: HTMLElement): void {
        const hint = row.querySelector('.wiz-hint') as HTMLElement | null;
        if (!hint || row.dataset.existingId) return;
        const first = (row.querySelector('.wiz-first') as HTMLInputElement).value.trim();
        const last = (row.querySelector('.wiz-last') as HTMLInputElement).value.trim();
        const gender = (row.querySelector('.wiz-gender') as HTMLSelectElement).value as Gender;
        const birthDate = (row.querySelector('.wiz-birth') as HTMLInputElement).value.trim();
        if (!first && !last) { hint.innerHTML = ''; return; }

        const matches = findSimilarPersons(DataManager.getData(), { firstName: first, lastName: last, gender, birthDate });
        const top = matches.filter(m => m.person.id !== this.wizardAnchorId).slice(0, 1)[0];
        if (!top) { hint.innerHTML = ''; return; }
        const name = `${top.person.firstName} ${top.person.lastName}`.trim();
        hint.innerHTML = `<span class="wiz-hint-text">${strings.familyWizard.maybe(this.escapeHtml(name))}</span>`
            + `<button class="wiz-use" type="button" data-existing="${top.person.id}">${strings.familyWizard.useExisting}</button>`;
    },

    /** Link a row to an existing person instead of creating a new one. */
    useWizardExisting(row: HTMLElement, personId: PersonId): void {
        const p = DataManager.getPerson(personId);
        if (!p) return;
        row.dataset.existingId = personId;
        (row.querySelector('.wiz-first') as HTMLInputElement).value = p.firstName;
        (row.querySelector('.wiz-last') as HTMLInputElement).value = p.lastName;
        (row.querySelector('.wiz-gender') as HTMLSelectElement).value = p.gender;
        row.classList.add('wiz-linked');
        const hint = row.querySelector('.wiz-hint') as HTMLElement | null;
        if (hint) hint.innerHTML = `<span class="wiz-linked-label">${strings.familyWizard.linked}</span>`
            + `<button class="wiz-unlink" type="button">×</button>`;
    },

    /** Attach the modal's delegated listeners exactly once. */
    wireFamilyWizardOnce(): void {
        const modal = document.getElementById('family-wizard-modal');
        if (!modal || modal.dataset.wired) return;
        modal.dataset.wired = '1';

        modal.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t.classList.contains('wiz-remove')) { t.closest('.wiz-row')?.remove(); return; }
            if (t.classList.contains('wiz-use')) {
                const row = t.closest('.wiz-row') as HTMLElement | null;
                const id = t.dataset.existing as PersonId | undefined;
                if (row && id) this.useWizardExisting(row, id);
                return;
            }
            if (t.classList.contains('wiz-unlink')) {
                const row = t.closest('.wiz-row') as HTMLElement | null;
                if (row) { delete row.dataset.existingId; row.classList.remove('wiz-linked'); this.checkWizardDuplicate(row); }
            }
        });
        modal.addEventListener('change', (e) => {
            const row = (e.target as HTMLElement).closest('.wiz-row') as HTMLElement | null;
            if (row && !row.dataset.existingId) this.checkWizardDuplicate(row);
        });
    },
});
