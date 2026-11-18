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
import {
    decomposeIntoFamilies, seedIdsFor, bestRenderFocus, perspectiveCutCandidates,
    FamilyComponent, SplitMode,
} from '../split-families.js';
import { extractSubtree } from '../subtree.js';
import { TreePreview, renderTreeThumbnail } from '../tree-preview.js';
import { AuditLogManager } from '../audit-log.js';
import { PersonPicker } from '../person-picker.js';
import * as CrossTree from '../cross-tree.js';
import { uiModule } from './module.js';
import { shownName } from '../person-name.js';
import { runBusy, runHeavy, activatedElement, nextPaint, type BusyCtl } from './busy.js';
import { computeUnder } from './canvas-busy.js';
import { SPLIT_SHOWN_AT_ONCE } from './split-ui.js';
import { busyProg } from './busy-prog.js';

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

/** The run's tree is large: its families' computation says its state at once (§8). */
function splitRunLong(run: SplitFamiliesRun): boolean {
    return Object.keys(run.data.persons).length >= SPLIT_SHOWN_AT_ONCE;
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
        const name = shownName(person);
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
    showSplitFamiliesDialog(): Promise<void> {
        if (DataManager.isReadOnly()) return Promise.resolve();
        const treeId = DataManager.getCurrentTreeId();
        const data = DataManager.getData();
        const focus = TreeRenderer.getFocusPersonId();
        const realCount = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        if (!treeId || !focus || realCount < 2) {
            this.showToast(strings.splitFamilies.tooSmall);
            return Promise.resolve();
        }
        // §8: the families found (and their previews drawn) under the working state of the choice, or the canvas
        // overlay when its menu closed; at once for a large tree.
        return computeUnder(activatedElement(), () => this.openSplitFamiliesDialog({
            treeId,
            data,
            focusPersonId: focus,
        }), { label: strings.busy.findingFamilies, atOnce: realCount >= SPLIT_SHOWN_AT_ONCE }).then(() => undefined);
    },

    /**
     * Tree-manager entry: the partition never depends on a person (invariant
     * #0), so no picker — open the proposals straight away. The tree's default
     * person (or its first real member) just orders the list.
     */
    async showSplitFamiliesPickerDialog(treeId: string, parentDialogId?: string): Promise<void> {
        const id = treeId as TreeId;
        const people = TreeManager.getTreeMetadata(id)?.personCount ?? 0;
        await computeUnder(activatedElement(), () => this.openSplitFamiliesFor(id, parentDialogId),
            { label: strings.busy.findingFamilies, atOnce: people >= SPLIT_SHOWN_AT_ONCE });
    },

    /** The tree read and its families proposed (`showSplitFamiliesPickerDialog`). */
    async openSplitFamiliesFor(id: TreeId, parentDialogId?: string): Promise<void> {
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

    /** The 'perspective' cut config for this run, created on first use. */
    splitFamiliesPerspectiveOpts(run: SplitFamiliesRun): {
        baseIds: PersonId[]; cousinDepth: number; cutOverrides: Map<PersonId, boolean>;
    } {
        if (!this.splitFamiliesPerspective) {
            this.splitFamiliesPerspective = {
                baseIds: [run.focusPersonId],
                cousinDepth: 1,
                cutOverrides: new Map(),
            };
        }
        return this.splitFamiliesPerspective;
    },

    openSplitFamiliesDialog(run: SplitFamiliesRun): void {
        // 'surname' and 'lineage' are focus-invariant: the same tree always
        // yields the same families, whoever the focus is (it only orders the
        // list). 'perspective' is the deliberate exception — it is built from
        // the chosen people (this run's config).
        const persp = this.splitFamiliesPerspectiveOpts(run);
        let components = decomposeIntoFamilies(run.data, run.focusPersonId, this.splitFamiliesMode, persp);
        // One family in the preferred cut: another cut may still split (a
        // one-surname tree can hold several in-law branches, and vice versa) —
        // fall over to it rather than telling the user there is nothing here.
        if (components.length < 2) {
            for (const other of (['surname', 'lineage', 'perspective'] as SplitMode[])) {
                if (other === this.splitFamiliesMode) continue;
                const retry = decomposeIntoFamilies(run.data, run.focusPersonId, other, persp);
                if (retry.length >= 2) {
                    this.splitFamiliesMode = other;
                    components = retry;
                    break;
                }
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
            <div class="modal splitfam-modal modal--lg" role="dialog" data-dialog-kind="form" aria-modal="true">
                <div class="modal-header">
                    <h2>${s.title}</h2>
                    <button class="close-btn" id="splitfam-close-x" aria-label="${strings.buttons.close}">&times;</button>
                </div>
                <p class="splitfam-intro">${s.intro}</p>
                <div class="splitfam-mode sel-seg" role="radiogroup" aria-label="${s.modeLabel}">
                    ${([['surname', s.modeSurname], ['lineage', s.modeLineage], ['perspective', s.modePerspective]] as [SplitMode, string][])
                        .map(([m, label]) => `<button type="button" class="splitfam-mode-btn sel-opt${this.splitFamiliesMode === m ? ' active' : ''}" data-sel-form="seg"
                            data-mode="${m}" aria-pressed="${this.splitFamiliesMode === m}">${label}</button>`).join('')}
                </div>
                <p class="splitfam-mode-hint">${{
                    surname: s.modeSurnameHint, lineage: s.modeLineageHint, perspective: s.modePerspectiveHint,
                }[this.splitFamiliesMode]}</p>
                ${this.splitFamiliesMode === 'perspective' ? this.splitFamiliesPerspectiveHtml(run) : ''}
                <div class="splitfam-list">
                    ${components.map((c, i) => this.splitFamiliesRowHtml(c, i)).join('')}
                </div>
                <p class="splitfam-note">${s.keepsOriginal}</p>
                <div class="buttons splitfam-footer">
                    <span class="splitfam-summary" id="splitfam-summary"></span>
                    <button type="button" class="secondary" id="splitfam-cancel" data-dismiss>${strings.buttons.cancel}</button>
                    <button type="button" class="primary" id="splitfam-go"></button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = (): void => this.closeSplitFamiliesDialog();
        (overlay.querySelector('#splitfam-cancel') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#splitfam-close-x') as HTMLButtonElement).onclick = close;
        const go = overlay.querySelector('#splitfam-go') as HTMLButtonElement;
        // One working state from the click (§8): painted first, each tree's step said; a second click makes nothing more.
        // 8b: the button says "Creating…", the step with "k/n" and a bar above the footer; the end ✓ "Created" and the
        // sentence in the dialog, the button then locked (the trees are made once).
        go.onclick = () => void runBusy(go, ctl => this.performSplitFamilies(ctl),
            { label: strings.busy.creating, heavy: 'now', stepsInToast: true, done: strings.busy.done.created });
        // Switching what counts as one family recomputes and redraws the whole
        // dialog in place (same run) — unless the other cut cannot split at all.
        overlay.querySelectorAll('.splitfam-mode-btn').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                const m = btn.getAttribute('data-mode') as SplitMode;
                if (m === this.splitFamiliesMode) return;
                // §8: the other cut computed and the dialog drawn again under the button's working state.
                void runHeavy(btn as HTMLElement, () => {
                    if (decomposeIntoFamilies(run.data, run.focusPersonId, m, persp).length < 2) {
                        this.showToast(strings.splitFamilies.oneFamilyInMode);
                        return;
                    }
                    this.splitFamiliesMode = m;
                    this.openSplitFamiliesDialog(run);
                }, { label: strings.busy.findingFamilies, atOnce: splitRunLong(run) });
            };
        });
        if (this.splitFamiliesMode === 'perspective') this.bindSplitFamiliesPerspective(overlay, run);
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

    /** The 'perspective' cut's config block: depth, base people, cut list. */
    splitFamiliesPerspectiveHtml(run: SplitFamiliesRun): string {
        const s = strings.splitFamilies;
        const persp = this.splitFamiliesPerspectiveOpts(run);
        const cuts = perspectiveCutCandidates(run.data, run.focusPersonId, persp);
        const chip = (id: PersonId): string => `
            <span class="splitfam-persp-chip" data-id="${this.escapeHtml(id)}">${this.escapeHtml(this.splitFamilyPersonLabel(id))}${
                persp.baseIds.length > 1 ? `<button type="button" class="splitfam-persp-chip-x" data-id="${this.escapeHtml(id)}" aria-label="${s.cancel}">&times;</button>` : ''
            }</span>`;
        return `
            <div class="splitfam-persp">
                <label class="splitfam-persp-depth">
                    <span>${s.perspDepthLabel}</span>
                    <select id="splitfam-persp-depth">
                        <option value="1"${persp.cousinDepth === 1 ? ' selected' : ''}>${s.perspDepthCousins}</option>
                        <option value="2"${persp.cousinDepth === 2 ? ' selected' : ''}>${s.perspDepthSecond}</option>
                        <option value="0"${persp.cousinDepth === 0 ? ' selected' : ''}>${s.perspDepthNone}</option>
                    </select>
                </label>
                <div class="splitfam-persp-bases">
                    <span class="splitfam-persp-label">${s.perspBasesLabel}:</span>
                    ${persp.baseIds.map(chip).join('')}
                    <button type="button" class="splitfam-preview-btn" id="splitfam-persp-add">${s.perspAddPerson}</button>
                </div>
                <div id="splitfam-persp-picker" class="splitfam-persp-picker" style="display:none"></div>
                ${cuts.length > 0 ? `
                <details class="splitfam-persp-cuts">
                    <summary>${s.perspCutsLabel(cuts.length)}</summary>
                    <p class="splitfam-mode-hint">${s.perspCutHint}</p>
                    <div class="splitfam-persp-cut-list">
                        ${cuts.map(c => `
                        <label class="splitfam-persp-cut">
                            <input type="checkbox" class="splitfam-persp-cut-box" data-id="${this.escapeHtml(c.id)}"${c.kept ? '' : ' checked'}>
                            <span>${this.escapeHtml(this.splitFamilyPersonLabel(c.id))} — ${s.persons(c.familySize)}</span>
                        </label>`).join('')}
                    </div>
                </details>` : ''}
            </div>`;
    },

    /** Wire the 'perspective' config block (rebuilds the dialog on change). */
    bindSplitFamiliesPerspective(overlay: HTMLElement, run: SplitFamiliesRun): void {
        const persp = this.splitFamiliesPerspectiveOpts(run);
        const reopen = (): void => this.openSplitFamiliesDialog(run);
        overlay.querySelector('#splitfam-persp-depth')?.addEventListener('change', (e) => {
            persp.cousinDepth = Number((e.target as HTMLSelectElement).value);
            persp.cutOverrides.clear();   // a new depth means a fresh default cut
            reopen();
        });
        overlay.querySelectorAll('.splitfam-persp-cut-box').forEach(box => {
            (box as HTMLInputElement).onchange = () => {
                const id = box.getAttribute('data-id') as PersonId;
                persp.cutOverrides.set(id, (box as HTMLInputElement).checked);
                reopen();
            };
        });
        overlay.querySelectorAll('.splitfam-persp-chip-x').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                const id = btn.getAttribute('data-id') as PersonId;
                persp.baseIds = persp.baseIds.filter(b => b !== id);
                void runHeavy(btn as HTMLElement, reopen, { label: strings.busy.findingFamilies, atOnce: splitRunLong(run) });
            };
        });
        const addBtn = overlay.querySelector('#splitfam-persp-add') as HTMLButtonElement | null;
        addBtn?.addEventListener('click', () => {
            const box = overlay.querySelector('#splitfam-persp-picker') as HTMLElement | null;
            if (!box) return;
            const open = box.style.display !== 'none';
            box.style.display = open ? 'none' : '';
            if (!open && !box.hasChildNodes()) {
                new PersonPicker({
                    containerId: 'splitfam-persp-picker',
                    persons: Object.values(run.data.persons)
                        .filter(p => !p.isPlaceholder && !persp.baseIds.includes(p.id as PersonId)),
                    onSelect: (id) => {
                        if (!persp.baseIds.includes(id)) persp.baseIds.push(id);
                        reopen();
                    },
                });
            }
        });
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
    async performSplitFamilies(ctl?: BusyCtl): Promise<void> {
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
        // 8b: the progress above the footer (its own line, not the button's words).
        const modal = document.querySelector<HTMLElement>('#split-families-modal .splitfam-modal');
        const footer = modal?.querySelector('.splitfam-footer') ?? null;
        modal?.querySelector('.busy-prog, .busy-prog-done')?.remove();
        const prog = ctl && modal ? busyProg(modal, footer) : null;

        for (const [k, index] of chosen.entries()) {
            const component = this.splitFamiliesComponents[index];
            // "Creating tree 2 of 5: …", painted before that tree's work (B214).
            if (ctl) {
                const words = strings.busy.creatingTreeK(k + 1, chosen.length, this.readSplitFamilyName(index));
                ctl.step(words, k + 1, chosen.length);
                prog?.set(words, k + 1, chosen.length);
                await nextPaint();
            }
            // The exact tree previewed (structuredClone so tree creation cannot
            // mutate the cache), opened on the family's default person.
            const src = this.splitFamiliesShown[index]?.data ?? extractSubtree(data, seedIdsFor(component));
            const subtree = structuredClone(src);
            subtree.defaultPersonId = component.defaultPersonId;
            createdPersons += Object.keys(subtree.persons).length;
            TreeManager.createTreeFromImport(subtree, this.readSplitFamilyName(index), false);
        }

        // The split copies; restore the tree the user was on (createTreeFromImport
        // may switch the active tree to the last created family).
        if (activeBefore) TreeManager.setActiveTree(activeBefore);
        AuditLogManager.log(splitTreeId, 'tree.split',
            strings.auditLog.splitFamilies(chosen.length, createdPersons));

        // New trees mean new cross-tree matches (the shared connector cards).
        CrossTree.invalidateCache();

        this.updateTreeSwitcher();
        void this.updateTreeManagerList();
        TreeRenderer.render();
        if (prog && modal?.isConnected) {
            // 8b: the dialog stays with "3 trees created."; Create is locked, Cancel becomes Close.
            prog.done(`${strings.splitFamilies.done(chosen.length)}.`);
            const go = modal.querySelector<HTMLButtonElement>('#splitfam-go');
            if (go) go.disabled = true;
            modal.querySelectorAll<HTMLElement>('.splitfam-row input, .splitfam-mode-btn, .splitfam-persp input, .splitfam-persp select, .splitfam-persp button')
                .forEach(x => { (x as HTMLInputElement).disabled = true; });
            const cancel = modal.querySelector<HTMLButtonElement>('#splitfam-cancel');
            if (cancel) cancel.textContent = strings.buttons.close;
            return;
        }
        this.closeSplitFamiliesDialog();
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
        // not run state; everything else (incl. the perspective config) resets.
        this.splitFamiliesRun = null;
        this.splitFamiliesPerspective = null;
        this.splitFamiliesData = null;
        this.splitFamiliesTreeId = null;
        this.splitFamiliesComponents = [];
        this.splitFamiliesShown = [];
        if (parent) document.getElementById(parent)?.classList.add('active');
    },
});
