/**
 * "Delete permanently…" (spec 102 §9, K1.17): files of the research deleted
 * for good, behind `material.delete`. Only through this dialog: the count,
 * previews, what refers to the files as the research's dry run says it, and
 * the ticked "cannot be undone in the app" box; the danger button works only
 * then. Never automatic, no Undo. A list that changed meanwhile (409
 * `material.delete-changed`) or a confirmation that ran out is shown again
 * and asks again. The places of the files in the tree are taken off by the
 * tree's next version from the research (the research retracts them; the
 * app takes that version in as any other).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import {
    DELETE_MAX_FILES, deleteMaterial, deleteMaterialDry, dropFromCache, getCachedThumb,
    type DeleteImpact, type MaterialItem,
} from '../materials.js';
import {
    deletableFiles, deleteCanGo, deleteChanged, deleteListed, deleteStart, deleteSummary, deleteTicked, deleteWarns,
    type DeleteState,
} from '../material-delete.js';
import { button, materialDialog } from './material-actions-ui.js';
import { previewEl } from './material-sort-ui.js';
import type { MaterialActionCtx } from './materials-ui.js';
import { uiModule } from './module.js';

const TOAST_MS = 8000;
/** Previews of several files (the rest as "and N more"). */
const PREVIEWS = 5;
/** Source rows shown before "and N more". */
const SOURCES_SHOWN = 6;
/** People named before "+ N". */
const PEOPLE_SHOWN = 3;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** Does deleting touch the tree (its places, its sources): the research's next version is then loaded, not taken as its own. */
function touchesTree(impacts: readonly DeleteImpact[]): boolean {
    return impacts.some(i => i.links > 0 || i.sources.length > 0);
}

export const materialDeleteMethods = uiModule({
    /** "Delete permanently…" can be offered (the research says it can, the tree can change). */
    materialDeleteOffered(): boolean {
        const mc = this.materialsContext();
        return !!mc?.caps.delete && !DataManager.isReadOnly();
    },

    /**
     * The dialog of "Delete permanently…" (spec 102 §9). `leave`: called once
     * the files are deleted (the viewer has nothing left to show). True: deleted.
     */
    async openDeleteDialog(items: MaterialItem[], opts: { leave?: () => void; ctx?: MaterialActionCtx } = {}): Promise<boolean> {
        const m = strings.materials;
        const d = m.del;
        const mc = this.materialsContext();
        const files = deletableFiles(items);
        if (!mc || !mc.caps.delete || !mc.caps.bridgeUp || !mc.base || DataManager.isReadOnly() || !files.length) return false;
        if (files.length > DELETE_MAX_FILES) {
            this.showToast(d.tooMany(DELETE_MAX_FILES), TOAST_MS, { closable: true, kind: 'materials' });
            return false;
        }
        const base = mc.base;
        const ids = files.map(i => i.file!.id);
        const n = files.length;
        const one = n === 1 ? files[0] : null;
        const batches = new Set(files.map(i => i.batch?.name ?? ''));
        const batchName = batches.size === 1 ? files[0].batch?.name ?? '' : '';
        const sub = one ? [one.name, batchName].filter(Boolean).join(' · ') : batchName || undefined;
        const dialog = materialDialog({ title: one ? d.ask : d.askN(n), ...(sub ? { sub } : {}), modifier: 'remove' });
        dialog.box.classList.add('mdlg--delete');
        dialog.box.dataset.delete = '';

        // One file: its thumbnail in the head; several: the first few and "and N more".
        if (one?.file?.sha) {
            const headEl = dialog.box.querySelector<HTMLElement>('.mdlg-head')!;
            void getCachedThumb(mc.treeId, one.file.sha, 256).then(blob => {
                if (!blob || !headEl.isConnected) return;
                const img = h('img', 'mdlg-attach-thumb');
                img.alt = '';
                img.src = URL.createObjectURL(blob);
                img.onload = () => URL.revokeObjectURL(img.src);
                headEl.prepend(img);
                headEl.classList.add('has-thumb');
            }).catch(() => { /* no thumbnail: the head without one */ });
        }
        if (!one) {
            const strip = h('div', 'mdlg-sort-previews');
            for (const item of files.slice(0, PREVIEWS)) {
                const tile = previewEl(mc, item, 'mdlg-sort-preview');
                tile.title = item.title;
                strip.appendChild(tile);
            }
            if (n > PREVIEWS) strip.appendChild(h('span', 'mdlg-sort-more', d.more(n - PREVIEWS)));
            dialog.body.appendChild(strip);
        }

        // What the research says, redrawn with each answer.
        const note = h('div', 'mdlg-warn mdlg-delete-note');
        note.setAttribute('role', 'status');
        const list = h('div', 'mdlg-delete-list');
        list.setAttribute('aria-live', 'polite');
        const text = h('p', 'mdlg-text', mc.agent ? d.text(n) : d.textArchive(n));
        const check = h('label', 'mdlg-check');
        const box = h('input');
        box.type = 'checkbox';
        box.name = 'mdlg-delete-understand';
        const checkText = h('span', 'mdlg-check-text');
        checkText.append(h('span', '', d.understand), h('span', 'mdlg-check-hint', mc.agent ? d.understandHint(n) : d.understandHintArchive(n)));
        check.append(box, checkText);
        dialog.body.append(note, list, text, check);

        let state: DeleteState = deleteStart();
        let done = false;
        let asked = 0;

        const draw = () => {
            note.replaceChildren();
            note.hidden = !state.note;
            if (state.note) note.appendChild(h('p', 'mdlg-warn-text', state.note === 'changed' ? d.changed : d.expired));
            list.replaceChildren();
            if (state.phase === 'loading' && !state.impacts.length) list.appendChild(h('p', 'mdlg-note', d.loading(n)));
            else if (state.phase === 'failed' && !state.impacts.length) list.appendChild(h('p', 'mdlg-note', d.failed));
            else list.append(...this.materialDeleteList(state.impacts, n));
            box.checked = state.understood;
            box.disabled = state.phase !== 'ready' || !state.impacts.length;
            go.disabled = !deleteCanGo(state);
        };

        // The dry run: what deleting would take now, and the bridge's confirmation of that list.
        const dry = async () => {
            const mine = ++asked;
            if (!state.impacts.length) state = { ...state, phase: 'loading' };
            draw();
            dialog.error(null);
            const res = await deleteMaterialDry(base, ids);
            if (done || mine !== asked) return;
            if (!res.ok) {
                state = { ...state, phase: state.impacts.length ? 'ready' : 'failed', confirm: null };
                draw();
                this.materialErrorInDialog(dialog, mc, res.error, () => void dry());
                return;
            }
            state = deleteListed(state, res.value.impacts, res.value.confirm);
            draw();
        };

        const send = async () => {
            if (!deleteCanGo(state)) return;
            const confirm = state.confirm!;
            const shown = state.impacts;
            state = { ...state, phase: 'sending' };
            dialog.error(null);
            dialog.busy(true, d.sending);
            // A write that changes the tree (its places, its sources) is loaded as the research's next version.
            const before = touchesTree(shown) ? '' : await this.researchHeadBeforeWrite(mc.researchId);
            const res = await deleteMaterial(base, ids, confirm);
            dialog.busy(false);
            if (done) return;
            if (!res.ok) {
                if (res.changed) {
                    // Changed meanwhile: the new list at once, asked again (a new confirmation comes with a new dry run).
                    state = deleteChanged(state, 'changed', res.changed);
                    draw();
                    void dry();
                    return;
                }
                if (res.error.kind === 'body' && res.error.code === 'material.body') {
                    state = deleteChanged(state, 'expired');
                    draw();
                    void dry();
                    return;
                }
                state = { ...state, phase: 'ready' };
                draw();
                this.materialErrorInDialog(dialog, mc, res.error, () => void send());
                return;
            }
            done = true;
            const deleted = res.value.deleted.length ? res.value.deleted : ids;
            this.researchTakeOwnWriteHead(mc.researchId, before, res.value.head);
            dialog.close();
            await dropFromCache(mc.treeId, deleted);
            this.materialSortDropFiles(deleted);
            this.showToast(d.toast(deleted.length), TOAST_MS, { closable: true, kind: 'materials' });
            opts.leave?.();
            this.materialActionDone(opts.ctx ?? {});
        };

        const hideable = files.filter(i => !i.hidden && !i.attachment?.places?.length);
        const cancel = button(strings.buttons.cancel, '', () => dialog.close());
        const go = button(d.go(n), 'is-danger', () => void send());
        go.disabled = true;
        if (hideable.length && mc.caps.assign) {
            const hide = h('button', 'link-button mdlg-delete-hide', d.hideInstead);
            hide.type = 'button';
            hide.addEventListener('click', () => {
                dialog.close();
                this.materialAction('hide', hideable, opts.ctx ?? {});
            });
            dialog.foot.append(hide);
        }
        // Cancel and the danger button as one group: a footer that has to wrap never leaves the danger button alone.
        const acts = h('div', 'mdlg-foot-acts');
        acts.append(cancel, go);
        dialog.foot.append(acts);
        box.addEventListener('change', () => {
            state = deleteTicked(state, box.checked);
            go.disabled = !deleteCanGo(state);
        });
        cancel.focus();
        return new Promise<boolean>((resolve) => {
            const close = dialog.close;
            dialog.close = () => { close(); resolve(done); };
            void dry();
        });
    },

    /** The list of what refers to the files: the warning, "What refers to the file" and its rows, or none. */
    materialDeleteList(impacts: readonly DeleteImpact[], n: number): HTMLElement[] {
        const d = strings.materials.del;
        const s = deleteSummary(impacts);
        const out: HTMLElement[] = [];
        const unlinked = s.sources.filter(x => x.effect === 'unlinked');
        const image = s.sources.filter(x => x.effect === 'image');
        if (deleteWarns(s)) {
            const warn = h('div', 'mdlg-warn');
            warn.dataset.deleteWarn = '';
            const head = n === 1 && unlinked.length === 1 ? d.sourceWarn(unlinked[0].title) : n > 1 ? d.manyRefs(s.withRefs, n) : '';
            const said = [
                unlinked.length ? d.cInput(unlinked.length) : '',
                image.length ? d.cImage(image.length) : '',
                s.excerpts ? d.cExcerpts(s.excerpts) : '',
                s.links ? d.cTree(s.links) : '',
            ].filter(Boolean).join(' ');
            const p = h('p', 'mdlg-warn-text');
            if (head) p.append(h('b', '', head), ' ');
            p.append(said);
            warn.appendChild(p);
            out.push(warn);
        }
        if (s.withRefs) {
            const sec = h('section', 'mv-uses');
            sec.dataset.deleteRefs = '';
            const head = h('div', 'mv-uses-head');
            const counts = [
                s.sources.length ? d.countSources(s.sources.length) : '',
                s.excerpts ? d.countExcerpts(s.excerpts) : '',
                s.people.length ? d.countPeople(s.people.length) : '',
                s.links ? d.countPlaces(s.links) : '',
                s.tasks.length ? d.countTasks(s.tasks.length) : '',
            ].filter(Boolean).join(' · ');
            head.append(h('h3', 'mv-uses-title', d.refs(n)), h('span', 'mv-uses-count', counts));
            const grid = h('div', 'mv-uses-grid');
            const row = (kind: string, type: string, main: string, sub: string) => {
                const t = h('span', 'mv-use-type', type);
                const cell = h('span', 'mv-use-main');
                cell.dataset.deleteRow = kind;
                // Plain names: a dialog that deletes for good never leads elsewhere.
                cell.append(h('span', 'mv-use-text', main), h('span', 'mv-use-sub', sub));
                grid.append(t, cell, h('span'));
            };
            for (const src of s.sources.slice(0, SOURCES_SHOWN)) {
                const what = src.effect === 'unlinked' ? d.subInput : src.effect === 'image' ? d.subImage : d.subUnchanged;
                const parts = [what];
                if (src.citedCount) parts.push(d.citedN(src.citedCount));
                if (n > 1) parts.push(d.subOf(src.files.join(', ')));
                row('source', d.rowSource, src.title, parts.join(' · '));
            }
            if (s.sources.length > SOURCES_SHOWN) grid.append(h('span'), h('span', 'mv-use-sub', d.more(s.sources.length - SOURCES_SHOWN)), h('span'));
            if (s.excerpts) row('excerpts', d.rowExcerpts, d.excerptsN(s.excerpts, n), d.subExcerpts(n));
            if (s.links) row('tree', d.rowTree, d.placesN(s.links), d.subTree);
            if (s.people.length) {
                const names = s.people.slice(0, PEOPLE_SHOWN).map(r => this.materialPersonName(r));
                const more = s.people.length - names.length;
                row('people', d.rowPeople(s.people.length), `${names.join(', ')}${more > 0 ? `, + ${more}` : ''}`, d.subPeople(s.peopleFiles, n));
            }
            if (s.tasks.length) row('tasks', d.rowTasks, d.tasksN(s.tasks.length), d.subTasks(n));
            sec.append(head, grid);
            out.push(sec);
        } else if (impacts.length) {
            out.push(h('p', 'mdlg-note', d.noRefs(n)));
        }
        if (s.kept) {
            const kept = h('p', 'mdlg-note', d.kept(s.kept, s.keptOther));
            kept.dataset.deleteKept = '';
            out.push(kept);
        }
        return out;
    },
});
