/**
 * Title… / Kind… / Date… for many files at once (spec 102 §8d, §8e, §8h).
 *
 * The tree's own files change through DataManager (one undo step per batch
 * of 500), material only in the archive through `POST /material/edit` (one
 * call per batch of the same change, Undo in the toast). While a large change
 * runs the window's footer shows its progress with Cancel: finished batches
 * stay.
 */

import { DataManager } from '../data.js';
import { MaterialKind } from '../types.js';
import { strings } from '../strings.js';
import { EditRequest, EditWas, MaterialItem, materialDateFromInput, materialErrorText } from '../materials.js';
import { button, materialDialog } from './material-actions-ui.js';
import { treeFileOf } from './material-details-ui.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';

export type BulkField = 'title' | 'kind' | 'date';

/** One file's new value. */
export interface BulkChange {
    item: MaterialItem;
    title?: string;
    kind?: MaterialKind | null;
    date?: string;
}

/** Files per write (a tree transaction, a research call). */
export const BULK_CHUNK = 500;
const TOAST_MS = 8000;
const KINDS: readonly MaterialKind[] = ['photo', 'document', 'record', 'other'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

export function chunked<T>(rows: readonly T[], size = BULK_CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
}

/**
 * The titles a prefix gives (8d): files that already have a title stay unless
 * `overwrite`; with `number` the changed files get 1, 2, 3… in their order.
 */
export function bulkTitlePlan(items: readonly MaterialItem[], prefix: string, opts: { number: boolean; overwrite: boolean }): BulkChange[] {
    const text = prefix.trim();
    const todo = items.filter(i => opts.overwrite || !i.titled);
    if (!text) return [];
    return todo.map((item, i) => ({ item, title: opts.number ? `${text} ${i + 1}` : text }));
}

/** Kind (8e): every file (a file with a kind only with `overwrite`). */
export function bulkKindPlan(items: readonly MaterialItem[], kind: MaterialKind | null, overwrite: boolean): BulkChange[] {
    return items.filter(i => (overwrite || !i.kind) && (i.kind ?? null) !== kind).map(item => ({ item, kind }));
}

/** Date (8e): an empty date clears it (then every file with one). */
export function bulkDatePlan(items: readonly MaterialItem[], date: string, overwrite: boolean): BulkChange[] {
    if (!date) return items.filter(i => !!i.date).map(item => ({ item, date: '' }));
    return items.filter(i => (overwrite || !i.date) && i.date !== date).map(item => ({ item, date }));
}

/** Research edits for archive changes: one request per same value, at most 500 ids each. */
export function bulkEditRequests(changes: readonly BulkChange[]): { req: EditRequest; items: MaterialItem[] }[] {
    const byValue = new Map<string, BulkChange[]>();
    for (const c of changes) {
        if (!c.item.file) continue;
        const key = JSON.stringify([c.title, c.kind, c.date]);
        const rows = byValue.get(key);
        if (rows) rows.push(c); else byValue.set(key, [c]);
    }
    const out: { req: EditRequest; items: MaterialItem[] }[] = [];
    for (const rows of byValue.values()) {
        for (const part of chunked(rows)) {
            const c = part[0];
            const req: EditRequest = { ids: part.map(r => r.item.file!.id) };
            if (c.title !== undefined) req.title = c.title;
            if (c.kind !== undefined) req.kind = c.kind ?? '';
            if (c.date !== undefined) req.date = c.date;
            out.push({ req, items: part.map(r => r.item) });
        }
    }
    return out;
}

/** The undo of research edits: one request per same earlier value. */
export function bulkUndoRequests(was: EditWas): EditRequest[] {
    const byValue = new Map<string, { ids: string[]; v: EditWas[string] }>();
    for (const [id, v] of Object.entries(was)) {
        if (!Object.keys(v).length) continue;
        const key = JSON.stringify([v.title, v.kind, v.date]);
        const row = byValue.get(key);
        if (row) row.ids.push(id); else byValue.set(key, { ids: [id], v });
    }
    const out: EditRequest[] = [];
    for (const { ids, v } of byValue.values()) for (const part of chunked(ids)) out.push({ ids: part, ...v });
    return out;
}

export const materialBulkMethods = uiModule({
    /** Can this file's title, kind and date change here now? */
    bulkEditable(item: MaterialItem, mc: MaterialsContext | null): boolean {
        if (DataManager.isReadOnly()) return false;
        const own = treeFileOf(item);
        if (own) return DataManager.canEditMedia(own);
        return !!item.file && !item.hidden && !!mc?.caps.edit && mc.caps.bridgeUp && !!mc.base;
    },

    /**
     * The dialog for one field over the selection (in the window's order).
     * `done` runs after the change was written (the selection ends).
     */
    openBulkEditDialog(field: BulkField, all: MaterialItem[], opts: { done?: (changed: MaterialItem[]) => void; refused?: (items: MaterialItem[]) => void } = {}): void {
        const m = strings.materials;
        const mc = this.materialsContext();
        const items = all.filter(i => this.bulkEditable(i, mc));
        if (!items.length) return;
        const n = items.length;
        const dialog = materialDialog({ title: field === 'title' ? m.titleNTitle(n) : field === 'kind' ? m.kindNTitle(n) : m.dateNTitle(n), modifier: 'bulk' });
        dialog.box.dataset.field = field;
        const skipped = all.length - n;
        const check = (label: string, on: boolean, name: string): HTMLInputElement => {
            const row = h('label', 'mdlg-check');
            const input = h('input');
            input.type = 'checkbox';
            input.name = name;
            input.checked = on;
            row.append(input, h('span', 'mdlg-check-text', label));
            dialog.body.appendChild(row);
            input.addEventListener('change', () => refresh());
            return input;
        };
        let plan: () => BulkChange[] = () => [];
        const preview = h('div', 'mdlg-bulk-preview');
        const apply = button(m.applyN(0), 'is-primary', () => go());
        const one = n === 1;
        if (field === 'title') {
            const label = h('label', 'mdlg-label', m.f.title);
            const input = h('input', 'mdlg-input');
            input.type = 'text';
            input.name = 'mdlg-bulk-title';
            input.autocomplete = 'off';
            input.maxLength = 200;
            input.placeholder = m.titlePh;
            if (one && items[0].titled) input.value = items[0].title;
            label.htmlFor = input.name;
            input.id = input.name;
            dialog.body.append(label, input);
            input.addEventListener('input', () => refresh());
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            const titled = items.filter(i => i.titled).length;
            const number = one ? null : check(m.titleNumber, true, 'mdlg-bulk-number');
            const overwrite = one || !titled ? null : check(m.titleOverwrite(titled), false, 'mdlg-bulk-overwrite');
            if (!one) {
                dialog.body.appendChild(h('div', 'mdlg-label', m.titlePreview));
                dialog.body.appendChild(preview);
            }
            plan = () => bulkTitlePlan(items, input.value, { number: !!number?.checked, overwrite: one || !!overwrite?.checked });
            setTimeout(() => input.focus(), 0);
        } else if (field === 'kind') {
            const set = h('fieldset', 'mdlg-radios');
            set.appendChild(h('legend', '', m.f.kind));
            const first = one ? items[0].kind ?? 'none' : 'photo';
            for (const k of [...KINDS, 'none' as const]) {
                const row = h('label', 'mdlg-radio');
                const input = h('input');
                input.type = 'radio';
                input.name = 'mdlg-bulk-kind';
                input.value = k;
                input.checked = k === first;
                input.addEventListener('change', () => refresh());
                row.append(input, h('span', '', k === 'none' ? m.kindNone : m.kind[k]));
                set.appendChild(row);
            }
            dialog.body.appendChild(set);
            const kinded = items.filter(i => !!i.kind).length;
            const overwrite = one || !kinded ? null : check(m.kindOverwrite(kinded), false, 'mdlg-bulk-overwrite');
            plan = () => {
                const v = set.querySelector<HTMLInputElement>('input:checked')?.value ?? 'none';
                return bulkKindPlan(items, v === 'none' ? null : v as MaterialKind, one || !!overwrite?.checked);
            };
            setTimeout(() => set.querySelector<HTMLInputElement>('input:checked')?.focus(), 0);
        } else {
            const label = h('label', 'mdlg-label', m.f.date);
            const input = h('input', 'mdlg-input flex-date');
            input.type = 'text';
            input.name = 'mdlg-bulk-date';
            input.id = input.name;
            input.autocomplete = 'off';
            input.placeholder = m.datePh;
            label.htmlFor = input.name;
            dialog.body.append(label, input, h('p', 'mdlg-check-hint', m.bulkDateHint));
            input.addEventListener('input', () => refresh());
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            const dated = items.filter(i => !!i.date).length;
            const overwrite = one || !dated ? null : check(m.dateOverwrite(dated), false, 'mdlg-bulk-overwrite');
            plan = () => {
                const d = materialDateFromInput(input.value);
                input.classList.toggle('invalid', d === null);
                if (d === null) { input.setAttribute('aria-invalid', 'true'); return []; }
                input.removeAttribute('aria-invalid');
                return bulkDatePlan(items, d, one || !!overwrite?.checked);
            };
            setTimeout(() => input.focus(), 0);
        }
        if (skipped > 0) dialog.body.appendChild(h('p', 'mdlg-check-hint mdlg-bulk-skipped', m.selUnchanged(skipped)));
        const refresh = (): void => {
            const changes = plan();
            apply.textContent = m.applyN(changes.length);
            apply.disabled = changes.length === 0;
            if (field !== 'title' || one) return;
            preview.replaceChildren();
            for (const c of changes.slice(0, 4)) preview.appendChild(h('div', 'mdlg-bulk-row', `${c.title} · ${c.item.name}`));
            if (changes.length > 4) preview.appendChild(h('div', 'mdlg-bulk-more', m.previewMore(changes.length - 4)));
        };
        const go = (): void => {
            const changes = plan();
            if (!changes.length) return;
            dialog.close();
            void this.runBulkEdit(changes, { ...opts, of: all.length });
        };
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), apply);
        refresh();
    },

    /** Write the changes in batches of 500 with the window's progress; one toast at the end. */
    async runBulkEdit(changes: BulkChange[], opts: { done?: (changed: MaterialItem[]) => void; refused?: (items: MaterialItem[]) => void; of?: number } = {}): Promise<void> {
        const m = strings.materials;
        const mc = this.materialsContext();
        const total = changes.length;
        const tree = changes.filter(c => treeFileOf(c.item));
        const archive = changes.filter(c => !treeFileOf(c.item) && c.item.file);
        let done = 0;
        let cancelled = false;
        let treeChanged = false;
        const changed: MaterialItem[] = [];
        const refused: MaterialItem[] = [];
        let reason = '';
        const was: EditWas = {};
        const big = total > BULK_CHUNK;
        const progress = (): void => { if (big) this.mwBulkProgress(done, total, () => { cancelled = true; }); };
        progress();
        // The tree's files in one go: one undo step however many (spec 102 §8d).
        if (tree.length) {
            const ids = new Set(DataManager.setMediaDetailsMany(tree.map(c => ({
                id: treeFileOf(c.item)!,
                details: { ...(c.title !== undefined ? { title: c.title } : {}), ...(c.kind !== undefined ? { kind: c.kind } : {}), ...(c.date !== undefined ? { date: c.date } : {}) },
            }))));
            for (const c of tree) if (ids.has(treeFileOf(c.item)!)) changed.push(c.item);
            treeChanged = ids.size > 0;
            done += tree.length;
            progress();
            if (big) await new Promise(r => setTimeout(r, 0));
        }
        if (archive.length && mc?.base && mc.caps.edit && mc.caps.bridgeUp) {
            for (const { req, items } of bulkEditRequests(archive)) {
                if (cancelled) break;
                const res = await this.writeMaterialEdit(mc, req);
                if (res.ok) {
                    changed.push(...items);
                    Object.assign(was, res.value.was);
                } else {
                    refused.push(...items);
                    reason = materialErrorText(res.error, mc.agent);
                }
                done += items.length;
                progress();
            }
        }
        if (big) this.mwBulkProgress(null, total, null);
        if (changed.length) this.afterMediaChange();
        const undo = bulkUndoRequests(was);
        // "2 of 3 files updated.": of the selection (files left unchanged count in it).
        const text = changed.length ? m.bulkDone(changed.length, Math.max(total, opts.of ?? 0)) : m.bulkNothing;
        if (refused.length) {
            this.showToast(`${text} ${m.bulkRejected(refused.length, reason)}`, TOAST_MS, {
                closable: true, kind: 'materials',
                action: { label: m.bulkShow, run: () => opts.refused?.(refused) },
            });
        } else {
            this.showToast(text, TOAST_MS, {
                closable: true, kind: 'materials',
                ...((undo.length && mc) || treeChanged ? {
                    action: {
                        label: strings.undo.undo,
                        run: () => void (async () => {
                            if (treeChanged) DataManager.undo();
                            if (mc) for (const req of undo) await this.undoMaterialEdit(mc, req);
                            this.afterMediaChange();
                            this.refreshMaterialsWindow();
                        })(),
                    },
                } : {}),
            });
        }
        this.refreshMaterialsWindow();
        opts.done?.(changed);
    },
});
