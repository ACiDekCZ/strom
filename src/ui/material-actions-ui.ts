/**
 * The research's writes on materials (spec 017 §5, §6, §8.5): Assign to a
 * person (5a), removing a person from a file or from its whole batch (5b),
 * Hide with a reason and Restore (6a–6c), each with its toast and Undo.
 * Refusals of the research change nothing here: in a dialog its sentence
 * stays in the dialog with "Reload" / "Try again", elsewhere a toast says it.
 *
 * Every entry goes through `materialAction` (the section's ⋯, the viewer,
 * the window's batch / folder ⋯, its selection bar and "Restore").
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { Person, PersonId } from '../types.js';
import { strings } from '../strings.js';
import { researchPersonRef } from '../research-link.js';
import {
    MaterialItem, MaterialFile, MaterialBatch, MaterialActionId, MaterialError, MaterialResult, AssignRequest, AssignAnswer,
    HiddenReason, assignMaterial, hideMaterial, fetchMaterial, saveMaterialList, mergeAssignIntoCache, mergeIntoCache,
    cachedMaterialList, addedPersons, assignUndoRequests, batchUndoRequest, directPersons,
    materialErrorText, materialErrorAction,
} from '../materials.js';
import { MultiPersonPicker } from '../person-picker.js';
import { nameWithoutYears } from '../materials-overview.js';
import { MaterialActionCtx, MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';

const TOAST_MS = 8000;
const PICKER_ID = 'mdlg-assign-picker';
const MAX_PEOPLE = 50;

/** One open dialog over the materials (and over the viewer). */
interface MaterialDialog {
    box: HTMLElement;
    body: HTMLElement;
    foot: HTMLElement;
    /** The research's refusal inside the dialog (null: hide it). */
    error(text: string | null, action?: { label: string; run: () => void }): void;
    /** The confirm button busy while the research answers. */
    busy(on: boolean): void;
    close(): void;
}

let openDialog: MaterialDialog | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function button(label: string, cls: string, run: () => void): HTMLButtonElement {
    const b = h('button', `mdlg-btn${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A dialog of the materials: its own overlay above the viewer (the viewer
 * leaves keys alone while it is open), Esc and the backdrop close it, Tab
 * stays inside.
 */
function materialDialog(opts: { title: string; sub?: string; modifier?: string; bubbleAt?: HTMLElement; onClose?: () => void }): MaterialDialog {
    openDialog?.close();
    const back = document.activeElement as HTMLElement | null;
    const overlay = h('div', `mdlg-overlay${opts.bubbleAt ? ' is-bubble' : ''}`);
    overlay.dataset.overViewer = '';
    const box = h('div', `mdlg${opts.modifier ? ` mdlg--${opts.modifier}` : ''}`);
    box.setAttribute('role', opts.bubbleAt ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    const titleId = `mdlg-title-${Date.now()}`;
    box.setAttribute('aria-labelledby', titleId);
    const head = h('div', 'mdlg-head');
    const title = h('h2', 'mdlg-title', opts.title);
    title.id = titleId;
    head.appendChild(title);
    if (opts.sub) head.appendChild(h('p', 'mdlg-sub', opts.sub));
    const body = h('div', 'mdlg-body');
    const err = h('div', 'mdlg-error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    const foot = h('div', 'mdlg-foot');
    if (opts.bubbleAt) {
        // The bubble speaks through its sentence; its title only names it.
        head.style.display = 'none';
        box.append(head, body, err, foot);
    } else {
        box.append(head, body, err, foot);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    if (opts.bubbleAt) {
        // By the chip it came from, inside the screen.
        const r = opts.bubbleAt.getBoundingClientRect();
        const w = Math.min(340, window.innerWidth - 16);
        box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        const below = r.bottom + 8;
        const height = box.offsetHeight || 160;
        box.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 8) : below}px`;
    }

    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            dialog.close();
            return;
        }
        if (e.key === 'Tab') {
            const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
            if (!all.length) return;
            const first = all[0], last = all[all.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
    window.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) dialog.close(); });

    let closed = false;
    const dialog: MaterialDialog = {
        box, body, foot,
        error(text, action) {
            err.replaceChildren();
            err.hidden = !text;
            if (!text) return;
            err.appendChild(h('span', '', text));
            if (action) err.appendChild(button(action.label, '', action.run));
        },
        busy(on) {
            box.setAttribute('aria-busy', String(on));
            foot.querySelectorAll<HTMLButtonElement>('.mdlg-btn.is-primary, .mdlg-btn.is-danger').forEach(b => {
                if (on) { b.dataset.wasDisabled = String(b.disabled); b.disabled = true; }
                else { b.disabled = b.dataset.wasDisabled === 'true'; delete b.dataset.wasDisabled; }
            });
        },
        close() {
            if (closed) return;
            closed = true;
            window.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (openDialog === dialog) openDialog = null;
            opts.onClose?.();
            if (back?.isConnected) back.focus();
        },
    };
    openDialog = dialog;
    return dialog;
}

function fullName(p: Person): string {
    return `${p.firstName} ${p.lastName}`.trim();
}

/** The research files among the items (the tree's own attachments take no research writes). */
function researchFiles(items: MaterialItem[]): MaterialItem[] {
    return items.filter(i => i.origin !== 'tree' && !!i.file);
}

/** The file records as remembered now (for working out what an answer really changed). */
function currentRecords(treeId: string, items: MaterialItem[]): MaterialFile[] {
    const list = cachedMaterialList(treeId);
    return items.map(i => list?.files.find(f => f.id === i.file!.id) ?? i.file!);
}

function batchOf(treeId: string, id: string): MaterialBatch | null {
    return cachedMaterialList(treeId)?.batches.find(b => b.id === id) ?? null;
}

export const materialActionsMethods = uiModule({
    /**
     * The research's writes on items (assign, remove from a person, hide,
     * restore). True: handled (also while the research does not run — then
     * nothing happens; the entries are shown disabled). From the window: a
     * batch's / folder's ⋯ (`ctx.batch`, `ctx.folder`), the selection bar
     * (`ctx.selection`) and "Restore" under a hidden tile.
     */
    materialAction(id: MaterialActionId, items: MaterialItem[], ctx: MaterialActionCtx = {}): boolean {
        if (!['assign', 'removeFromPerson', 'hide', 'restore'].includes(id)) return false;
        const mc = this.materialsContext();
        if (!mc) return false;
        if (!mc.caps.bridgeUp || !mc.base || !mc.caps.assign) return true;
        const files = researchFiles(items);
        const wholeBatch = ctx.batch && !ctx.folder ? ctx.batch : null;
        switch (id) {
            case 'assign':
                if (files.length || wholeBatch) this.openAssignDialog(mc, files, ctx);
                break;
            case 'removeFromPerson':
                if (wholeBatch && !ctx.person) this.openBatchRemoveDialog(mc, wholeBatch, ctx);
                else if (ctx.person && files.length) this.removeMaterialPerson(mc, files, ctx.person, ctx);
                break;
            case 'hide':
                if (files.length) this.openHideDialog(mc, files.filter(i => !i.hidden), ctx);
                break;
            case 'restore':
                if (files.length) void this.restoreMaterials(mc, files.filter(i => i.hidden), ctx);
                break;
        }
        return true;
    },

    /** A person's name for the texts: the tree's name, else the research's (without years), else the REFN. */
    materialPersonName(refn: string): string {
        for (const p of DataManager.getAllPersons()) {
            if (researchPersonRef(p.refn) === refn) return fullName(p) || refn;
        }
        const ctx = this.materialsContext();
        const known = ctx ? cachedMaterialList(ctx.treeId)?.people?.[refn] : undefined;
        return known ? nameWithoutYears(known) : refn;
    },

    /** After a write went through: the selection ends, the window redraws. */
    materialActionDone(ctx: MaterialActionCtx): void {
        if (ctx.selection) this.clearMaterialsSelection();
        this.refreshMaterialsWindow();
    },

    /** A refusal outside a dialog: its sentence in a toast, with Reload / Try again. */
    materialErrorToast(mc: MaterialsContext, err: MaterialError, retry: () => void): void {
        const m = strings.materials;
        const act = materialErrorAction(err);
        const action = act === 'reload' ? { label: m.reload, run: () => void this.reloadMaterialList() }
            : act === 'retry' ? { label: m.retry, run: retry } : undefined;
        this.showToast(materialErrorText(err, mc.agent), TOAST_MS, { closable: true, kind: 'materials', ...(action ? { action } : {}) });
    },

    /** A refusal inside a dialog (it stays open; Reload closes it once the list is loaded again). */
    materialErrorInDialog(dialog: MaterialDialog, mc: MaterialsContext, err: MaterialError, retry: () => void): void {
        const m = strings.materials;
        const act = materialErrorAction(err);
        dialog.error(materialErrorText(err, mc.agent), act === 'reload'
            ? { label: m.reload, run: () => { dialog.close(); void this.reloadMaterialList(); } }
            : act === 'retry' ? { label: m.retry, run: retry } : undefined);
    },

    /** The whole list again from the research (after it said a person or a file is gone). */
    async reloadMaterialList(): Promise<void> {
        const mc = this.materialsContext();
        if (!mc?.base) return;
        const res = await fetchMaterial(mc.base, {});
        if (res.ok) await saveMaterialList(mc.treeId, res.value, { kind: 'all' });
    },

    /** An assign written and its answer remembered (the undo's requests run one after another). */
    async writeAssign(mc: MaterialsContext, req: AssignRequest): Promise<MaterialResult<AssignAnswer>> {
        const res = await assignMaterial(mc.base!, req);
        if (res.ok) {
            const batch = req.batch ? { id: req.batch, ...(req.add ? { add: req.add } : {}), ...(req.remove ? { remove: req.remove } : {}) } : undefined;
            await mergeAssignIntoCache(mc.treeId, res.value.files, res.value.people, batch);
        }
        return res;
    },

    /** Undo of assigns: the requests in order; a refusal stops and says so. */
    async undoMaterialAssign(mc: MaterialsContext, reqs: AssignRequest[]): Promise<void> {
        for (let i = 0; i < reqs.length; i++) {
            const res = await this.writeAssign(mc, reqs[i]);
            if (!res.ok) {
                const rest = reqs.slice(i);
                this.materialErrorToast(mc, res.error, () => void this.undoMaterialAssign(mc, rest));
                return;
            }
        }
        this.refreshMaterialsWindow();
    },

    // ==================== ASSIGN (5a) ====================

    openAssignDialog(mc: MaterialsContext, files: MaterialItem[], ctx: MaterialActionCtx): void {
        const m = strings.materials;
        const wholeBatch = ctx.batch && !ctx.folder ? ctx.batch : null;
        const batchNames = new Set(files.map(i => i.batch?.name ?? ''));
        const sub = wholeBatch ? m.assignWhat.batch(wholeBatch.name, wholeBatch.files)
            : files.length === 1 ? m.assignWhat.file(files[0].title)
                : batchNames.size === 1 && files[0].batch ? m.assignWhat.files(files.length, files[0].batch.name)
                    : m.assignWhat.filesOnly(files.length);
        const already = (refn: string) => wholeBatch
            ? (wholeBatch.persons ?? []).includes(refn)
            : files.every(i => i.persons.includes(refn));
        const dialog = materialDialog({ title: m.assignTitle, sub, modifier: 'assign' });
        const host = h('div');
        host.id = PICKER_ID;
        dialog.body.appendChild(host);
        let chosen: PersonId[] = [];
        const confirm = button(m.assignN(0), 'is-primary', () => void run());
        confirm.disabled = true;
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), confirm);
        const picker = new MultiPersonPicker({
            containerId: PICKER_ID,
            multi: true,
            persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder),
            max: MAX_PEOPLE,
            blocked: p => (researchPersonRef(p.refn) ? null : mc.agent ? m.noRefnPickResearch : m.noRefnPick),
            fixed: p => {
                const refn = researchPersonRef(p.refn);
                return !!refn && already(refn);
            },
            onChange: ids => {
                chosen = ids;
                confirm.textContent = m.assignN(ids.length);
                confirm.disabled = ids.length === 0;
                dialog.error(null);
            },
            noneLabel: m.noneChosen,
            removeLabel: m.removePerson,
            maxLabel: m.assignMax,
            fixedLabel: m.alreadyOn,
        });
        const close = dialog.close;
        dialog.close = () => { picker.destroy(); close(); };
        picker.focusInput();

        const run = async () => {
            const add = chosen.map(id => researchPersonRef(DataManager.getPerson(id)?.refn)).filter((r): r is string => !!r);
            if (!add.length) return;
            dialog.busy(true);
            dialog.error(null);
            const before = currentRecords(mc.treeId, files);
            const batchBefore = wholeBatch ? batchOf(mc.treeId, wholeBatch.id) ?? wholeBatch : null;
            const req: AssignRequest = wholeBatch ? { batch: wholeBatch.id, add } : { files: files.map(i => i.file!.id), add };
            const res = await this.writeAssign(mc, req);
            dialog.busy(false);
            if (!res.ok) {
                this.materialErrorInDialog(dialog, mc, res.error, () => void run());
                return;
            }
            dialog.close();
            let undo: AssignRequest[];
            let names: string[];
            let n: number;
            if (batchBefore) {
                const u = batchUndoRequest(batchBefore, add, []);
                undo = u ? [u] : [];
                names = add.filter(p => !(batchBefore.persons ?? []).includes(p)).map(p => this.materialPersonName(p));
                n = batchBefore.files;
            } else {
                undo = assignUndoRequests(before, res.value.files);
                const got = addedPersons(before, res.value.files, add);
                names = (got.length ? got : add).map(p => this.materialPersonName(p));
                n = files.length;
            }
            this.showToast(m.assignedToast(n, names.length ? names : add.map(p => this.materialPersonName(p))), TOAST_MS, {
                closable: true, kind: 'materials',
                ...(undo.length ? { action: { label: strings.undo.undo, run: () => void this.undoMaterialAssign(mc, undo) } } : {}),
            });
            this.materialActionDone(ctx);
        };
    },

    // ==================== REMOVE A PERSON (5b) ====================

    /** One person off files: directly, or (on a file only through its batch) the bubble offers the whole batch. */
    removeMaterialPerson(mc: MaterialsContext, files: MaterialItem[], refn: string, ctx: MaterialActionCtx): void {
        const m = strings.materials;
        const name = this.materialPersonName(refn);
        const onlyViaBatch = files.length === 1 && files[0].viaBatch.includes(refn) && files[0].batch
            && !directPersons(files[0].file!).includes(refn);
        if (onlyViaBatch) {
            const item = files[0];
            const batch = batchOf(mc.treeId, item.batch!.id);
            const count = batch?.files ?? 1;
            const batchName = item.batch!.name;
            const dialog = materialDialog({ title: m.removeFromThis, modifier: 'bubble', bubbleAt: ctx.anchor });
            dialog.body.appendChild(h('p', 'mdlg-text', m.viaBatchText(name, batchName, count)));
            const go = button(m.removeFromBatch, 'is-primary', () => void run());
            dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
            go.focus();
            const run = async () => {
                dialog.busy(true);
                const res = await this.writeAssign(mc, { batch: item.batch!.id, remove: [refn] });
                dialog.busy(false);
                if (!res.ok) {
                    this.materialErrorInDialog(dialog, mc, res.error, () => void run());
                    return;
                }
                dialog.close();
                this.materialBatchRemovedToast(mc, item.batch!.id, batchName, refn, ctx);
            };
            return;
        }
        void this.removeFromFiles(mc, files, refn, ctx);
    },

    async removeFromFiles(mc: MaterialsContext, files: MaterialItem[], refn: string, ctx: MaterialActionCtx): Promise<void> {
        const m = strings.materials;
        const name = this.materialPersonName(refn);
        const before = currentRecords(mc.treeId, files);
        const res = await this.writeAssign(mc, { files: files.map(i => i.file!.id), remove: [refn] });
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.removeFromFiles(mc, files, refn, ctx));
            return;
        }
        const kept = res.value.kept.filter(k => k.person === refn);
        if (kept.length) {
            // Still there through the batch: offer that instead (no undo of the direct part).
            const batchId = kept[0].batch;
            const batchName = batchOf(mc.treeId, batchId)?.name ?? batchId;
            this.showToast(m.keptToast(kept.length, name, batchName), TOAST_MS, {
                closable: true, kind: 'materials',
                action: { label: m.removeFromBatch, run: () => void this.removeFromWholeBatch(mc, batchId, batchName, refn, ctx) },
            });
        } else {
            const undo = assignUndoRequests(before, res.value.files);
            const what = files.length === 1 ? files[0].title : m.assignWhat.filesOnly(files.length);
            this.showToast(m.removedToast(name, what), TOAST_MS, {
                closable: true, kind: 'materials',
                ...(undo.length ? { action: { label: strings.undo.undo, run: () => void this.undoMaterialAssign(mc, undo) } } : {}),
            });
        }
        this.materialActionDone(ctx);
    },

    async removeFromWholeBatch(mc: MaterialsContext, batchId: string, batchName: string, refn: string, ctx: MaterialActionCtx): Promise<void> {
        const res = await this.writeAssign(mc, { batch: batchId, remove: [refn] });
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.removeFromWholeBatch(mc, batchId, batchName, refn, ctx));
            return;
        }
        this.materialBatchRemovedToast(mc, batchId, batchName, refn, ctx);
    },

    materialBatchRemovedToast(mc: MaterialsContext, batchId: string, batchName: string, refn: string, ctx: MaterialActionCtx): void {
        const undo: AssignRequest = { batch: batchId, add: [refn] };
        this.showToast(strings.materials.removedToast(this.materialPersonName(refn), batchName), TOAST_MS, {
            closable: true, kind: 'materials',
            action: { label: strings.undo.undo, run: () => void this.undoMaterialAssign(mc, [undo]) },
        });
        this.materialActionDone(ctx);
    },

    /** A batch's ⋯ "Remove a person from the whole batch…": which of its people. */
    openBatchRemoveDialog(mc: MaterialsContext, batch: MaterialBatch, ctx: MaterialActionCtx): void {
        const m = strings.materials;
        const persons = batch.persons ?? [];
        if (!persons.length) return;
        const dialog = materialDialog({ title: m.batchRemoveTitle, sub: m.batchRemoveText(batch.name, batch.files) });
        const set = h('fieldset', 'mdlg-radios');
        set.appendChild(h('legend', '', m.f.persons));
        persons.forEach((refn, i) => {
            const label = h('label', 'mdlg-radio');
            const input = h('input');
            input.type = 'radio';
            input.name = 'mdlg-batch-person';
            input.value = refn;
            input.checked = i === 0;
            label.append(input, h('span', '', this.materialPersonName(refn)));
            set.appendChild(label);
        });
        dialog.body.appendChild(set);
        const go = button(m.removeFromBatch, 'is-danger', () => void run());
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
        set.querySelector<HTMLInputElement>('input')?.focus();
        const run = async () => {
            const refn = set.querySelector<HTMLInputElement>('input:checked')?.value;
            if (!refn) return;
            dialog.busy(true);
            dialog.error(null);
            const res = await this.writeAssign(mc, { batch: batch.id, remove: [refn] });
            dialog.busy(false);
            if (!res.ok) {
                this.materialErrorInDialog(dialog, mc, res.error, () => void run());
                return;
            }
            dialog.close();
            this.materialBatchRemovedToast(mc, batch.id, batch.name, refn, ctx);
        };
    },

    // ==================== HIDE AND RESTORE (6a–6c) ====================

    openHideDialog(mc: MaterialsContext, files: MaterialItem[], ctx: MaterialActionCtx): void {
        const m = strings.materials;
        if (!files.length) return;
        const dialog = materialDialog({ title: m.hideTitle(files.length) });
        dialog.body.appendChild(h('p', 'mdlg-text', mc.agent ? m.hideTextResearch : m.hideText));
        const set = h('fieldset', 'mdlg-radios');
        set.appendChild(h('legend', '', m.reasonLabel));
        for (const reason of ['unrelated', 'duplicate', 'none']) {
            const label = h('label', 'mdlg-radio');
            const input = h('input');
            input.type = 'radio';
            input.name = 'mdlg-hide-reason';
            input.value = reason;
            input.checked = reason === 'unrelated';
            label.append(input, h('span', '', m.reason[reason]));
            set.appendChild(label);
        }
        dialog.body.appendChild(set);
        // Files that are also the tree's attachments: deleting those is a separate, unticked choice.
        const withAttachment = files.filter(i => i.origin === 'both' && i.attachment);
        let alsoDelete: HTMLInputElement | null = null;
        if (withAttachment.length) {
            const label = h('label', 'mdlg-check');
            alsoDelete = h('input');
            alsoDelete.type = 'checkbox';
            alsoDelete.name = 'mdlg-hide-delete';
            const text = h('span', 'mdlg-check-text');
            text.append(
                h('span', '', withAttachment.length === 1 ? m.hideAlsoDelete : m.hideAlsoDeleteN(withAttachment.length)),
                h('span', 'mdlg-check-hint', m.hideAlsoDeleteHint),
            );
            label.append(alsoDelete, text);
            dialog.body.appendChild(label);
        }
        const go = button(m.hideConfirm, 'is-primary', () => void run());
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
        set.querySelector<HTMLInputElement>('input:checked')?.focus();
        const run = async () => {
            const value = set.querySelector<HTMLInputElement>('input:checked')?.value ?? 'unrelated';
            const reason = value === 'unrelated' || value === 'duplicate' ? value as HiddenReason : undefined;
            const ids = files.map(i => i.file!.id);
            dialog.busy(true);
            dialog.error(null);
            const res = await hideMaterial(mc.base!, { files: ids, hidden: true, ...(reason ? { reason } : {}) });
            dialog.busy(false);
            if (!res.ok) {
                this.materialErrorInDialog(dialog, mc, res.error, () => void run());
                return;
            }
            dialog.close();
            await mergeIntoCache(mc.treeId, res.value.files, res.value.people);
            const undoDesc = alsoDelete?.checked ? this.deleteMaterialAttachments(withAttachment) : null;
            this.showToast((mc.agent ? m.hiddenToastResearch : m.hiddenToast)(files.length), TOAST_MS, {
                closable: true, kind: 'materials',
                action: {
                    label: strings.undo.undo,
                    run: () => {
                        if (undoDesc && DataManager.lastUndoDescription() === undoDesc) this.performUndo();
                        void this.writeHidden(mc, ids, false, undefined);
                    },
                },
            });
            this.materialActionDone(ctx);
        };
    },

    /** The tree's attachments of hidden files deleted as one undo step; its description (null: nothing deleted). */
    deleteMaterialAttachments(items: MaterialItem[]): string | null {
        const targets: { personId: PersonId; attId: string }[] = [];
        for (const item of items) {
            const attId = item.attachment?.id;
            if (!attId) continue;
            const owner = DataManager.getAllPersons().find(p => p.attachments?.some(a => a.id === attId));
            if (owner && !DataManager.isPersonLocked(owner.id)) targets.push({ personId: owner.id, attId });
        }
        if (!targets.length) return null;
        const first = DataManager.getPerson(targets[0].personId);
        const desc = first ? strings.undo.removeAttachment(fullName(first)) : null;
        DataManager.runBatch(desc, () => {
            for (const t of targets) DataManager.removeAttachment(t.personId, t.attId);
        });
        if (document.getElementById('person-modal')?.classList.contains('active')) {
            this.renderAttachmentsList();
            this.renderMaterialsSection();
        }
        this.refreshMaterialsWindow();
        this.materialViewerListChanged();
        return DataManager.lastUndoDescription();
    },

    /** Hide or restore files quietly (an undo); a refusal says so in a toast. */
    async writeHidden(mc: MaterialsContext, ids: string[], hidden: boolean, reason: HiddenReason | undefined): Promise<boolean> {
        const res = await hideMaterial(mc.base!, { files: ids, hidden, ...(reason ? { reason } : {}) });
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.writeHidden(mc, ids, hidden, reason));
            return false;
        }
        await mergeIntoCache(mc.treeId, res.value.files, res.value.people);
        this.refreshMaterialsWindow();
        return true;
    },

    async restoreMaterials(mc: MaterialsContext, files: MaterialItem[], ctx: MaterialActionCtx): Promise<void> {
        if (!files.length) return;
        const m = strings.materials;
        const ids = files.map(i => i.file!.id);
        const res = await hideMaterial(mc.base!, { files: ids, hidden: false });
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.restoreMaterials(mc, files, ctx));
            return;
        }
        await mergeIntoCache(mc.treeId, res.value.files, res.value.people);
        // Undo hides them again, each with the reason it had.
        const byReason = new Map<string, string[]>();
        for (const i of files) {
            const key = i.hidden?.reason ?? '';
            byReason.set(key, [...(byReason.get(key) ?? []), i.file!.id]);
        }
        this.showToast(m.restoredToast(files.length), TOAST_MS, {
            closable: true, kind: 'materials',
            action: {
                label: strings.undo.undo,
                run: () => void (async () => {
                    for (const [reason, group] of byReason) {
                        if (!await this.writeHidden(mc, group, true, (reason || undefined) as HiddenReason | undefined)) return;
                    }
                })(),
            },
        });
        this.materialActionDone(ctx);
    },
});
