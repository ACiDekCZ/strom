/**
 * A material's title, kind and date (spec 102 §2). The fields are shared by
 * the viewer's in-place edit and the Attachment dialog (which adds the note).
 * Saving writes the tree's file through DataManager (one undo step) and
 * material outside the tree through the research (`POST /material/edit`,
 * only with `material.edit` and a running bridge) with a toast and Undo.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { MaterialKind } from '../types.js';
import { strings } from '../strings.js';
import {
    MaterialItem, EditRequest, EditAnswer, MaterialResult, editMaterial, mergeIntoCache,
    materialDateForInput, materialDateFromInput,
} from '../materials.js';
import { button, materialDialog } from './material-actions-ui.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';

const TOAST_MS = 8000;
const TITLE_MAX = 300;
const KINDS: MaterialKind[] = ['photo', 'document', 'record', 'other'];

/** What the fields hold (the date as GEDCOM-like text, '' = none). */
export interface MaterialDetails {
    title: string;
    kind: MaterialKind | null;
    date: string;
    note?: string;
}

export interface DetailsFields {
    root: HTMLElement;
    title: HTMLInputElement;
    /** The values; null when the date cannot be read (the field is marked and focused). */
    read(): MaterialDetails | null;
}

/** How a material's details may be changed here: on, off (the research is not running), older (the research cannot), or not at all. */
export type DetailsEdit = 'on' | 'off' | 'older' | null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

let fieldsSeq = 0;

/** The item's details as the fields start (the title only when it has one). */
export function materialDetailsOf(item: MaterialItem): MaterialDetails {
    return {
        title: item.titled ? item.title : '',
        kind: item.kind ?? null,
        date: item.date ?? '',
        ...(item.attachment ? { note: item.attachment.note ?? '' } : {}),
    };
}

/** The tree's own file of an item (one the tree keeps, not only the research). */
export function treeFileOf(item: MaterialItem): string | null {
    const att = item.attachment;
    return att && DataManager.getMedia(att.id) ? att.id : null;
}

/** May the item's title, kind and date change here, and how. */
export function materialDetailsEdit(item: MaterialItem, ctx: MaterialsContext | null): DetailsEdit {
    if (DataManager.isReadOnly()) return null;
    const own = treeFileOf(item);
    if (own) return DataManager.canEditMedia(own) ? 'on' : null;
    if (!item.file || !ctx?.caps.list) return null;
    // A research that cannot even assign already says it needs a newer version: one sentence, not two.
    if (!ctx.caps.edit) return ctx.caps.assign ? 'older' : null;
    return ctx.caps.bridgeUp && ctx.base ? 'on' : 'off';
}

/**
 * The fields: Title (with its hint in the dialog), Kind (a segment; the
 * chosen kind clicked again is no kind), Date (a flexible date), and the
 * note when `init.note` is given.
 */
export function materialDetailsFields(init: MaterialDetails, opts: { hint?: boolean } = {}): DetailsFields {
    const m = strings.materials;
    const id = `mat-edit-${++fieldsSeq}`;
    const root = h('div', 'mat-edit-fields');

    const titleRow = h('div', 'mat-edit-row');
    const titleLabel = h('label', 'mat-edit-label', m.f.title);
    titleLabel.htmlFor = `${id}-title`;
    const title = h('input', 'mat-edit-title');
    title.type = 'text';
    title.id = `${id}-title`;
    title.maxLength = TITLE_MAX;
    title.placeholder = m.titlePh;
    title.autocomplete = 'off';
    title.value = init.title;
    titleRow.append(titleLabel, title);
    if (opts.hint) {
        const hint = h('div', 'mat-edit-hint', m.titleHint);
        hint.id = `${id}-title-hint`;
        title.setAttribute('aria-describedby', hint.id);
        titleRow.appendChild(hint);
    }

    const kindRow = h('div', 'mat-edit-row');
    const kindLabel = h('span', 'mat-edit-label', m.f.kind);
    kindLabel.id = `${id}-kind`;
    const seg = h('div', 'mat-edit-kind sel-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-labelledby', kindLabel.id);
    let kind: MaterialKind | null = init.kind;
    const opts2 = KINDS.map(k => {
        const b = h('button', 'mat-edit-kind-opt sel-opt', m.kind[k]);
        b.type = 'button';
        b.dataset.selForm = 'seg';
        b.dataset.kind = k;
        b.addEventListener('click', () => {
            kind = kind === k ? null : k;
            paint();
        });
        return b;
    });
    // One stop for Tab (the chosen kind, else the first); arrows go along.
    const paint = () => opts2.forEach((b, i) => {
        b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
        b.tabIndex = (kind ? b.dataset.kind === kind : i === 0) ? 0 : -1;
    });
    seg.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const i = opts2.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        e.preventDefault();
        const next = opts2[(i + (e.key === 'ArrowRight' ? 1 : opts2.length - 1)) % opts2.length];
        opts2.forEach(b => { b.tabIndex = b === next ? 0 : -1; });
        next.focus();
    });
    seg.append(...opts2);
    paint();
    kindRow.append(kindLabel, seg);

    const dateRow = h('div', 'mat-edit-row');
    const dateLabel = h('label', 'mat-edit-label', m.f.date);
    dateLabel.htmlFor = `${id}-date`;
    const date = h('input', 'mat-edit-date flex-date');
    date.type = 'text';
    date.id = `${id}-date`;
    date.placeholder = m.datePh;
    date.autocomplete = 'off';
    date.value = materialDateForInput(init.date);
    const mark = (bad: boolean) => {
        date.classList.toggle('invalid', bad);
        if (bad) date.setAttribute('aria-invalid', 'true'); else date.removeAttribute('aria-invalid');
        date.title = bad ? m.dateInvalid : '';
    };
    date.addEventListener('input', () => mark(materialDateFromInput(date.value) === null));
    dateRow.append(dateLabel, date);
    root.append(titleRow, kindRow, dateRow);

    let note: HTMLTextAreaElement | null = null;
    if (init.note !== undefined) {
        const noteRow = h('div', 'mat-edit-row');
        const noteLabel = h('label', 'mat-edit-label', m.f.note);
        noteLabel.htmlFor = `${id}-note`;
        note = h('textarea', 'mat-edit-note');
        note.id = `${id}-note`;
        note.rows = 3;
        note.placeholder = strings.attachments.notePlaceholder;
        note.value = init.note;
        noteRow.append(noteLabel, note);
        root.appendChild(noteRow);
    }

    return {
        root, title,
        read() {
            const d = materialDateFromInput(date.value);
            if (d === null) {
                mark(true);
                date.focus();
                return null;
            }
            // A date the field cannot show in its own form stays as written.
            const kept = date.value.trim() === materialDateForInput(init.date).trim() ? init.date : d;
            return { title: title.value.trim(), kind, date: kept, ...(note ? { note: note.value.trim() } : {}) };
        },
    };
}

/** Enter (in a field, not the note) saves, Esc cancels: the form's own keys, never the viewer's or the dialog's below. */
export function detailsKeys(root: HTMLElement, save: () => void, cancel: () => void): void {
    root.dataset.ownKeys = '';
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            save();
        }
    });
}

export const materialDetailsMethods = uiModule({
    /**
     * Save what changed. The tree's file: DataManager (one undo step, the
     * app's redraw follows); material outside the tree: the research, with a
     * toast and Undo. True: saved (or nothing to save).
     */
    async saveMaterialDetails(item: MaterialItem, before: MaterialDetails, after: MaterialDetails): Promise<boolean> {
        const changed: Partial<MaterialDetails> = {};
        if (after.title !== before.title) changed.title = after.title;
        if (after.kind !== before.kind) changed.kind = after.kind;
        if (after.date !== before.date) changed.date = after.date;
        if (after.note !== undefined && after.note !== before.note) changed.note = after.note;
        if (Object.keys(changed).length === 0) return true;
        const own = treeFileOf(item);
        if (own) return DataManager.setMediaDetails(own, changed);
        const mc = this.materialsContext();
        if (!item.file || !mc?.base || !mc.caps.edit || !mc.caps.bridgeUp) return false;
        const req: EditRequest = { ids: [item.file.id] };
        if (changed.title !== undefined) req.title = changed.title;
        if (changed.kind !== undefined) req.kind = changed.kind ?? '';
        if (changed.date !== undefined) req.date = changed.date;
        if (Object.keys(req).length === 1) return true;
        const res = await this.writeMaterialEdit(mc, req);
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.saveMaterialDetails(item, before, after));
            return false;
        }
        const was = res.value.was[item.file.id];
        const shown = after.title || item.name;
        this.showToast(strings.materials.editedToast(shown), TOAST_MS, {
            closable: true, kind: 'materials',
            ...(was && Object.keys(was).length ? { action: { label: strings.undo.undo, run: () => void this.undoMaterialEdit(mc, { ids: [item.file!.id], ...was }) } } : {}),
        });
        this.refreshMaterialsWindow();
        return true;
    },

    /** The research's edit; its new head taken as the tree's own, its files remembered. */
    async writeMaterialEdit(mc: MaterialsContext, req: EditRequest): Promise<MaterialResult<EditAnswer>> {
        const before = await this.researchHeadBeforeWrite(mc.researchId);
        const res = await editMaterial(mc.base!, req);
        if (res.ok) {
            this.researchTakeOwnWriteHead(mc.researchId, before, res.value.head, res.value.parent);
            await mergeIntoCache(mc.treeId, res.value.files, res.value.people);
        }
        return res;
    },

    async undoMaterialEdit(mc: MaterialsContext, req: EditRequest): Promise<void> {
        const res = await this.writeMaterialEdit(mc, req);
        if (!res.ok) {
            this.materialErrorToast(mc, res.error, () => void this.undoMaterialEdit(mc, req));
            return;
        }
        this.refreshMaterialsWindow();
    },

    /**
     * The Attachment dialog (2e): the file on top, its title, kind, date and
     * (for the tree's file) the note, then "Where used" (§3); Save writes
     * what changed.
     */
    openMaterialDetailsDialog(item: MaterialItem): void {
        const m = strings.materials;
        const ctx = this.materialsContext();
        if (materialDetailsEdit(item, ctx) !== 'on') return;
        const dialog = materialDialog({ title: m.attachmentDialog, modifier: 'details' });
        const file = h('div', 'mdlg-file', item.name);
        file.title = item.name;
        dialog.body.appendChild(file);
        const before = materialDetailsOf(item);
        const fields = materialDetailsFields(before, { hint: true });
        dialog.body.appendChild(fields.root);
        // Where it is used (§3), drawn again after a "×".
        let usesOpen = false;
        let uses: HTMLElement | null = null;
        const drawUses = () => {
            const next = this.materialUsesBlock(item, this.materialsContext(), {
                expanded: usesOpen, where: 'dialog',
                expand: () => { usesOpen = true; drawUses(); },
                leave: () => dialog.close(),
                changed: () => { if (DataManager.getMedia(item.attachment?.id ?? '')?.places.length) drawUses(); else dialog.close(); },
            });
            if (uses) uses.replaceWith(next);
            else dialog.body.appendChild(next);
            uses = next;
        };
        drawUses();
        const save = async () => {
            const after = fields.read();
            if (!after) return;
            dialog.busy(true);
            const ok = await this.saveMaterialDetails(item, before, after);
            dialog.busy(false);
            if (ok) dialog.close();
        };
        detailsKeys(fields.root, () => void save(), () => dialog.close());
        // Create a source from this file… (spec 102 §5): the file as the evidence of a new source.
        const inTree = !!item.attachment?.places?.length && DataManager.canEditMedia(item.attachment.id);
        const outside = !item.attachment && !!item.file && item.origin !== 'tree' && !!ctx?.caps.assign;
        if ((inTree || outside) && this.canEditSources() && !DataManager.isReadOnly()) {
            const make = h('button', 'link-button mdlg-make-source', m.makeSource);
            make.type = 'button';
            make.addEventListener('click', () => {
                dialog.close();
                void this.makeSourceFromMaterial(item, { personId: this.materialContextPerson() });
            });
            dialog.foot.appendChild(make);
        }
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), button(strings.buttons.save, 'is-primary', () => void save()));
        fields.title.focus();
        fields.title.select();
    },
});
