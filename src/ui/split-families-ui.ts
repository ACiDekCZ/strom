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
import { PersonId, StromData, TreeId, LAST_FOCUSED } from '../types.js';
import { decomposeIntoFamilies, seedIdsFor, bestRenderFocus, FamilyComponent, SplitMode } from '../split-families.js';
import { extractSubtree } from '../subtree.js';
import { TreePreview, renderTreeThumbnail } from '../tree-preview.js';
import { AuditLogManager } from '../audit-log.js';
import { PersonPicker } from '../person-picker.js';
import * as CrossTree from '../cross-tree.js';
import { uiModule } from './module.js';

/** Everything the shared split-families dialog needs, whatever opened it. */
interface SplitFamiliesRun {
    /** The tree being split (the active tree, or any tree from the manager). */
    treeId: TreeId;
    /** That tree's data (live for the active tree, loaded for any other). */
    data: StromData;
    /** Presentation focus: orders the list, never changes the partition. */
    focusPersonId: PersonId;
    /** Dialog to reopen on close (e.g. the tree manager). */
    parentDialogId?: string;
}

export const splitFamiliesMethods = uiModule({
    /** The real person a family is named after (never a placeholder). */
    splitFamilyNameAnchor(component: FamilyComponent): PersonId {
        return component.nameAnchorId;
    },

    /** "First Last (*1942)" — the birth year disambiguates two same-named people. */
    splitFamilyPersonLabel(id: PersonId): string {
        const person = this.splitFamiliesData?.persons[id];
        if (!person) return '?';
        const name = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || '?';
        const year = person.birthDate?.split('-')[0];
        return year ? `${name} (*${year})` : name;
    },

    /** "Rodina {full name (*year)}" suggested tree name for a family. */
    splitFamilyDefaultName(component: FamilyComponent): string {
        return strings.splitFamilies.familyName(this.splitFamilyPersonLabel(this.splitFamilyNameAnchor(component)));
    },

    /**
     * Live entry (actions menu / mobile sheet): split the ACTIVE tree. The focus
     * is the person on screen — it only decides which family is listed first; the
     * partition is the same whatever it is.
     */
    showSplitFamiliesDialog(): void {
        if (DataManager.isViewMode()) return;
        const treeId = DataManager.getCurrentTreeId();
        const data = DataManager.getData();
        const focus = TreeRenderer.getFocusPersonId();
        const realCount = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        if (!treeId || !focus || realCount < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            return;
        }
        this.openSplitFamiliesDialog({
            treeId,
            data,
            focusPersonId: focus,
        });
    },

    /**
     * Tree-manager entry: the partition never depends on a person (invariant
     * #0), so no picker — open the proposals straight away. The tree's default
     * person (or its first real member) just orders the list.
     */
    async showSplitFamiliesPickerDialog(treeId: string, parentDialogId?: string): Promise<void> {
        const id = treeId as TreeId;
        const data = id === DataManager.getCurrentTreeId()
            ? DataManager.getData()
            : await TreeManager.getTreeData(id);
        if (!data) return;

        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
        if (persons.length < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            return;
        }
        const def = data.defaultPersonId;
        const focus = (def && def !== LAST_FOCUSED && data.persons[def])
            ? def
            : (persons[0].id as PersonId);
        this.openSplitFamiliesDialog({ treeId: id, data, focusPersonId: focus, parentDialogId });
    },

    openSplitFamiliesDialog(run: SplitFamiliesRun): void {
        // The partition is focus-invariant: the same tree always yields the same
        // families, whoever the focus is. The focus only decides which family is
        // listed first (its own) and which person a new tree opens on.
        let components = decomposeIntoFamilies(run.data, run.focusPersonId, this.splitFamiliesMode);
        // One family in the preferred mode: the OTHER cut may still split (a
        // one-surname tree can hold several in-law branches, and vice versa) —
        // fall over to it rather than telling the user there is nothing here.
        if (components.length < 2) {
            const other: SplitMode = this.splitFamiliesMode === 'surname' ? 'lineage' : 'surname';
            const retry = decomposeIntoFamilies(run.data, run.focusPersonId, other);
            if (retry.length >= 2) {
                this.splitFamiliesMode = other;
                components = retry;
            }
        }
        // A single family either way means there is nothing to split — say so.
        if (components.length < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            // Nothing opened; hand control back to the parent dialog if any.
            if (run.parentDialogId) document.getElementById(run.parentDialogId)?.classList.add('active');
            return;
        }
        this.splitFamiliesRun = run;
        this.splitFamiliesComponents = components;
        this.splitFamiliesData = run.data;
        this.splitFamiliesTreeId = run.treeId;
        this.splitFamiliesParentDialog = run.parentDialogId ?? null;
        // Precompute each family's exact self-contained tree once: the count
        // line, the thumbnail and the full preview all read from this, so what
        // you are told matches what you see and what gets created (WYSIWYG).
        this.splitFamiliesShown = components.map(c => {
            const data = extractSubtree(run.data, seedIdsFor(c));
            const ids = new Set(Object.keys(data.persons) as PersonId[]);
            let real = 0, unknown = 0;
            for (const id of ids) (data.persons[id].isPlaceholder ? unknown++ : real++);
            return { data, renderFocus: bestRenderFocus(data), ids, real, unknown };
        });

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
                <div class="splitfam-mode" role="radiogroup" aria-label="${s.modeLabel}">
                    <button type="button" class="splitfam-mode-btn${this.splitFamiliesMode === 'surname' ? ' active' : ''}"
                        data-mode="surname" aria-pressed="${this.splitFamiliesMode === 'surname'}">${s.modeSurname}</button>
                    <button type="button" class="splitfam-mode-btn${this.splitFamiliesMode === 'lineage' ? ' active' : ''}"
                        data-mode="lineage" aria-pressed="${this.splitFamiliesMode === 'lineage'}">${s.modeLineage}</button>
                </div>
                <p class="splitfam-mode-hint">${this.splitFamiliesMode === 'surname' ? s.modeSurnameHint : s.modeLineageHint}</p>
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
        // Switching what counts as one family recomputes and redraws the whole
        // dialog in place (same run) — unless the other cut cannot split at all.
        overlay.querySelectorAll('.splitfam-mode-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                const m = btn.getAttribute('data-mode') as SplitMode;
                if (m === this.splitFamiliesMode) return;
                if (decomposeIntoFamilies(run.data, run.focusPersonId, m).length < 2) {
                    this.showToast(strings.splitFamilies.oneFamilyInMode);
                    return;
                }
                this.splitFamiliesMode = m;
                this.openSplitFamiliesDialog(run);
            };
        });
        overlay.querySelectorAll('.splitfam-check').forEach(box => {
            (box as HTMLInputElement).onchange = () => this.updateSplitFamiliesFooter();
        });
        overlay.querySelectorAll('.splitfam-preview-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => this.previewSplitFamily(Number(btn.getAttribute('data-index')));
        });

        // Thumbnails render after the boxes are in the DOM (they size to the box).
        components.forEach((c, i) => {
            const box = overlay.querySelector(`.splitfam-thumb[data-index="${i}"]`) as HTMLElement | null;
            if (box) this.renderSplitFamilyThumb(box, i, c);
        });

        this.clearDialogStack();
        // From the tree manager, the components dialog returns there on close.
        if (this.splitFamiliesParentDialog) {
            this.pushDialog(this.splitFamiliesParentDialog);
            this.closeDialogById(this.splitFamiliesParentDialog);
        }
        this.pushDialog('split-families-modal');
        this.updateSplitFamiliesFooter();
    },

    /** One proposed family, with its name field, count, thumbnail and checkbox. */
    splitFamiliesRowHtml(component: FamilyComponent, index: number): string {
        const s = strings.splitFamilies;
        const shown = this.splitFamiliesShown[index];
        const countLine = s.personsWithUnknown(shown?.real ?? component.personIds.length, shown?.unknown ?? 0);
        // Mark the family that holds the person the dialog was opened on — a
        // presentation cue only (the partition itself never depends on it).
        const badge = component.isFirst
            ? `<span class="splitfam-badge">${s.focusHere}</span>` : '';
        // How this family connects, told from the VIEWER's side: the person the
        // focus walks through to reach it (viaFromFocusId). Falls back to the
        // carve connector; hidden when the family is named after that person or
        // the link is a placeholder.
        const c = component.viaFromFocusId ?? component.connectorId;
        const crossRef = (c != null && c !== component.nameAnchorId
            && this.splitFamiliesData?.persons[c] && !this.splitFamiliesData.persons[c].isPlaceholder)
            ? `<span class="splitfam-crossref">${this.escapeHtml(s.connectsTo(this.splitFamilyPersonLabel(c)))}</span>`
            : '';
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
                        <span>${countLine}</span>${badge}${crossRef}
                        <button type="button" class="splitfam-preview-btn" data-index="${index}">${s.preview}</button>
                    </div>
                </div>
            </div>`;
    },

    /** The self-contained data behind a family's proposed tree (precomputed). */
    splitFamilySubtree(index: number, component: FamilyComponent): StromData {
        return this.splitFamiliesShown[index]?.data
            ?? extractSubtree(this.splitFamiliesData ?? DataManager.getData(), seedIdsFor(component));
    },

    /** Draw the small tree preview for a row — the WHOLE family, so the drawing
     *  matches the count exactly. */
    renderSplitFamilyThumb(box: HTMLElement, index: number, component: FamilyComponent): void {
        try {
            const subtree = this.splitFamilySubtree(index, component);
            const big = Object.keys(subtree.persons).length > 40;
            renderTreeThumbnail(box, {
                data: subtree,
                // Big families: a recognizable vignette around the family head
                // beats an unreadable smear of the whole forest.
                focusPersonId: big
                    ? component.nameAnchorId
                    : (this.splitFamiliesShown[index]?.renderFocus ?? component.defaultPersonId),
                wholeTree: !big,
            });
        } catch {
            // A thumbnail is a nicety; never let it block the split.
        }
    },

    /** Open the full, pannable preview for one proposed family (whole family). */
    previewSplitFamily(index: number): void {
        const component = this.splitFamiliesComponents[index];
        if (!component) return;
        const subtree = this.splitFamilySubtree(index, component);
        const big = Object.keys(subtree.persons).length > 40;
        TreePreview.show({
            data: subtree,
            focusPersonId: big
                ? component.nameAnchorId
                : (this.splitFamiliesShown[index]?.renderFocus ?? component.defaultPersonId),
            wholeTree: !big,
            ...(big ? { depthUp: 3, depthDown: 3, subtitle: strings.treePreview.bigFamilyHint } : {}),
            title: this.readSplitFamilyName(index),
            focusDisplayId: component.nameAnchorId,
            linkPersonIds: component.connectorId ? [component.connectorId] : [],
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
        // Distinct people across the ticked families: a person shared as a link
        // anchor between two families is counted once, so the total stays honest.
        const seen = new Set<PersonId>();
        for (const i of chosen) for (const id of this.splitFamiliesShown[i]?.ids ?? []) seen.add(id);
        let real = 0, unknown = 0;
        const data = this.splitFamiliesData;
        for (const id of seen) (data?.persons[id]?.isPlaceholder ? unknown++ : real++);
        const summary = document.getElementById('splitfam-summary');
        if (summary) summary.textContent = strings.splitFamilies.summary(chosen.length, real, unknown);
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

        // The tree being split (audit target) and its data — the active tree for
        // the WYSIWYG path, any tree for the tree-manager path.
        const splitTreeId = this.splitFamiliesTreeId ?? DataManager.getCurrentTreeId();
        const data = this.splitFamiliesData ?? DataManager.getData();
        // Whatever tree the user had active before must stay active afterwards —
        // splitting a non-active tree from the manager must not switch context.
        const activeBefore = TreeManager.getActiveTreeId();
        let createdPersons = 0;

        for (const index of chosen) {
            const component = this.splitFamiliesComponents[index];
            // The exact tree previewed (structuredClone so tree creation cannot
            // mutate the cache), opened on the family's default person.
            const src = this.splitFamiliesShown[index]?.data ?? extractSubtree(data, seedIdsFor(component));
            const subtree = structuredClone(src);
            subtree.defaultPersonId = component.defaultPersonId;
            createdPersons += Object.keys(subtree.persons).length;
            TreeManager.createTreeFromImport(subtree, this.readSplitFamilyName(index));
        }

        // The split copies; restore the tree the user was on (createTreeFromImport
        // may switch the active tree to the last created family).
        if (activeBefore) TreeManager.setActiveTree(activeBefore);
        AuditLogManager.log(splitTreeId, 'tree.split',
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
        // Reopen the tree manager when the split was launched from it.
        const parent = this.splitFamiliesParentDialog;
        // Reset EVERYTHING the run held, so the next open always recomputes from
        // scratch and never shows a previous split's state (whatever close path
        // — X, Cancel, overlay, Escape or after-split — got us here).
        this.splitFamiliesParentDialog = null;
        // The chosen mode deliberately survives the close — it is a preference,
        // not run state; everything else resets.
        this.splitFamiliesRun = null;
        this.splitFamiliesData = null;
        this.splitFamiliesTreeId = null;
        this.splitFamiliesComponents = [];
        this.splitFamiliesShown = [];
        if (parent) document.getElementById(parent)?.classList.add('active');
    },
});
