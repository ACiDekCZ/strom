/**
 * "Delete source?" of a followed tree (spec 117 §2, §3): the source is
 * retracted in its research through the bridge, never in the app alone. The
 * dialog asks the research first what rests on the source (its dry run with a
 * confirmation of exactly that list) and draws it: the citations counted by
 * the research, the facts left without a source, those becoming less certain,
 * the stories, the conflicts marked for review, the tasks and the files. The
 * danger button works only with that confirmation. A list changed meanwhile
 * or a confirmation run out is shown again and asked again. Once deleted, the
 * research's new version is loaded and a toast offers Undo (the research
 * puts the source back with its citations).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import type { FactStatus } from '../types.js';
import { researchSourceRef } from '../research-link.js';
import {
    rememberDeletedSource, restoreSource, retractCanGo, retractChanged, retractExpired, retractFailed, retractListed, retractNotSent,
    retractSending, retractSource, retractSourceDry, retractStart, retractSummary, retractTaskTitles, sourceRetractOffered,
    type RestoreDone, type RetractError, type RetractResult, type RetractState, type RetractSummary,
} from '../source-retract.js';
import type { BridgeOptions } from '../materials.js';
import type { ToastWorkEnd } from './toast.js';
import { factStatusHtml } from './fact-status.js';
import { researchConflictTitle, researchFactLabel } from './person-research-ui.js';
import { button, materialDialog } from './material-actions-ui.js';
import { liveSession } from './research-ui.js';
import { lastBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

const TOAST_MS = 8000;
/** How long the status of the research is waited for when the tree is loaded again. */
const RELOAD_STATUS_MS = 5000;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** What an error leaves of the dialog: send again, load the tree again, or nothing (the danger button gone). */
export type RetractDialogEnd = 'retry' | 'reload' | 'stop';

/**
 * How the dialog says a refusal of the bridge (§2 states, §9): its sentence
 * and what stays possible ("Try again" repeats what was refused: the
 * preview, or the deletion with the same confirmation).
 */
export function retractDialogError(err: RetractError): { text: string; end: RetractDialogEnd } {
    const R = strings.sources.retract;
    switch (err.kind) {
        case 'gone': return { text: R.gone, end: 'reload' };
        case 'already': return { text: R.already, end: 'reload' };
        case 'readonly': return { text: R.readonly, end: 'stop' };
        // A bridge without the route (the research went back to an older version): the action is not known.
        case 'missing': return { text: R.unknownAction, end: 'stop' };
        case 'held': return { text: err.held?.said || R.failed, end: 'stop' };
        case 'down': case 'aborted': return { text: R.down, end: 'retry' };
        case 'busy': return { text: R.busyWait, end: 'retry' };
        default: return { text: R.failed, end: 'retry' };
    }
}

/** Undo's answer as the toast says it (§3): back, back without some citations, or why not. */
export function restoreToastEnd(res: RetractResult<RestoreDone> | null, title: string): ToastWorkEnd | 'reload' {
    const R = strings.sources.retract;
    if (!res) return { ok: false, text: R.restoreDown, whole: true, retry: false };
    if (res.ok) {
        // Only citations whose fact is gone are said; one cited again already or with another main citation is no loss.
        const gone = res.value.skipped.filter(s => s.why === 'gone').length;
        return { ok: true, text: gone > 0 ? R.restoredPart(gone) : R.restored(title) };
    }
    const k = res.error.kind;
    if (k === 'notRetracted') return 'reload';
    if (k === 'notRestorable') return { ok: false, text: R.notRestorable, whole: true, retry: false };
    if (k === 'down' || k === 'aborted' || k === 'missing') return { ok: false, text: R.restoreDown, whole: true, retry: false };
    if (k === 'readonly') return { ok: false, text: R.readonly, whole: true, retry: false };
    if (k === 'held') return { ok: false, text: res.error.held?.said || R.failed, whole: true, retry: false };
    return { ok: false, text: R.failed, whole: true };
}

export const sourceRetractMethods = uiModule({
    /**
     * The dialog "Delete source?" (spec 117 §2) for a source of the followed
     * tree. True once the source is deleted in the research. `editMode`: a
     * tree tied to its research but not followed (§4) — the list still comes
     * from the research, but deleting is the app's own (Undo works) and the
     * research retracts the source with the next write of changes.
     */
    async openSourceRetractDialog(sourceId: string, opts: { editMode?: boolean } = {}): Promise<boolean> {
        const R = strings.sources.retract;
        const editMode = !!opts.editMode;
        const src = DataManager.getData().sources?.[sourceId];
        const ref = researchSourceRef(src?.refn);
        const ctx = this.researchSyncLink();
        if (!src || !ref || !ctx || (!editMode && sourceRetractOffered() !== 'on')) return false;
        const researchId = ctx.link.id;
        const title = src.title;

        const dialog = materialDialog({ title: R.title, sub: title, modifier: 'remove' });
        dialog.box.classList.add('mdlg--delete', 'mdlg--source');
        dialog.box.dataset.sourceRetract = ref;
        const sub = dialog.box.querySelector<HTMLElement>('.mdlg-sub');
        if (sub) sub.append(' ', h('span', 'mdlg-sub-id', `· ${ref}`));

        const intro = h('p', 'mdlg-text', R.intro);
        // "Changed meanwhile" / "expired": a sentence above the list (the dialog's one warning stays the bare facts').
        const changed = h('p', 'mdlg-changed');
        changed.setAttribute('role', 'status');
        const list = h('div', 'mdlg-src-list');
        list.setAttribute('aria-live', 'polite');
        dialog.body.append(intro, changed, list);
        // The research is writing: said between the body and the footer while the deletion waits to be tried again.
        const waitNote = h('p', 'mdlg-note mdlg-busy-prog', R.busyWait);
        waitNote.hidden = true;
        dialog.box.insertBefore(waitNote, dialog.foot);

        let state: RetractState = retractStart();
        let done = false;
        let stopped = false;
        let asked = 0;
        const abort = new AbortController();
        const bridgeOpts: BridgeOptions = {
            signal: abort.signal,
            sleep: (ms: number) => new Promise<void>(resolve => {
                waitNote.hidden = false;
                const t = setTimeout(resolve, ms);
                abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
            }),
        };

        const cancel = button(strings.buttons.cancel, '', () => dialog.close());
        const go = button(R.go, 'is-danger', () => void send());
        go.disabled = true;
        const acts = h('div', 'mdlg-foot-acts');
        acts.append(cancel, go);
        dialog.foot.append(acts);

        const draw = () => {
            changed.hidden = !state.note;
            changed.textContent = state.note === 'changed' ? R.changed : state.note === 'expired' ? R.expired : '';
            list.replaceChildren();
            const impact = state.impacts.find(i => i.id === ref) ?? state.impacts[0];
            if (!impact && editMode && state.phase === 'failed') {
                // Edit mode without the research's list: what the app knows, deleting still the app's own.
                const count = DataManager.countSourceCitations(sourceId);
                if (count > 0) list.appendChild(h('p', 'mdlg-text', strings.danger.sourceCited(count)));
                list.appendChild(h('p', 'mdlg-note', `${R.editMode} ${strings.danger.undoHint}`));
            } else if (!impact) {
                if (state.phase === 'failed') list.appendChild(h('p', 'mdlg-note', R.failedPreview));
                else {
                    const p = h('p', 'mdlg-note');
                    const spin = h('i', 'busy-spin s12');
                    spin.setAttribute('aria-hidden', 'true');
                    p.append(spin, ' ', R.loading);
                    list.appendChild(p);
                }
            } else {
                list.append(...this.sourceRetractList(retractSummary(impact, DataManager.getData())));
                list.appendChild(h('p', 'mdlg-note', editMode ? `${R.editMode} ${strings.danger.undoHint}` : R.undoLater));
            }
            go.hidden = stopped;
            go.disabled = stopped || !(editMode ? editCanGo() : retractCanGo(state));
        };

        // Edit mode: deleting here once the research's list is read (or could not be: the app's counts).
        const editCanGo = () => state.phase !== 'loading' && (state.impacts.length > 0 || state.phase === 'failed');

        // Nothing more can be deleted here: the danger button goes, Cancel becomes Close.
        const stop = () => {
            stopped = true;
            go.hidden = true;
            cancel.textContent = strings.buttons.close;
        };

        const showError = (err: RetractError, retry: () => void) => {
            const said = retractDialogError(err);
            if (said.end === 'retry') {
                dialog.error(said.text, { label: strings.materials.retry, run: () => { dialog.error(null); retry(); } });
            } else if (said.end === 'reload') {
                stop();
                dialog.error(said.text, { label: strings.materials.reload, run: () => { dialog.close(); void this.sourceRetractReload(); } });
            } else {
                stop();
                dialog.error(said.text);
            }
            draw();
        };

        // The dry run: what deleting would take now, and the bridge's confirmation of that list.
        const dry = async () => {
            const mine = ++asked;
            if (!state.impacts.length) state = { ...state, phase: 'loading' };
            draw();
            dialog.error(null);
            const res = await this.postResearchBridgeWrite(base => retractSourceDry(base, [ref], bridgeOpts), { dry: true, load: false });
            waitNote.hidden = true;
            if (done || abort.signal.aborted || mine !== asked) return;
            if (!res || !res.ok) {
                state = state.impacts.length ? { ...state, phase: 'ready', confirm: null } : retractFailed(state);
                // Edit mode: the list only informs; without it, the app's own counts (deleting stays here).
                if (editMode) { draw(); return; }
                showError(res ? res.error : { kind: 'down', status: 0 }, () => void dry());
                return;
            }
            state = retractListed(state, res.value.impacts, res.value.confirm);
            draw();
        };

        const send = async () => {
            if (editMode) {
                if (!editCanGo()) return;
                // Deleted here (Undo works); the research retracts it with the next write of changes (§4).
                done = true;
                DataManager.removeSource(sourceId);
                rememberDeletedSource(ctx.treeId, ref);
                dialog.close();
                this.renderSourcesList();
                this.refreshCitationChips();
                return;
            }
            if (!retractCanGo(state)) return;
            // The research went back to a version without deleting meanwhile.
            if (sourceRetractOffered() === null) {
                stop();
                dialog.error(R.unknownAction);
                draw();
                return;
            }
            const confirm = state.confirm!;
            state = retractSending(state);
            dialog.error(null);
            dialog.busy(true, R.sending);
            const res = await this.postResearchBridgeWrite(base => retractSource(base, [ref], confirm, bridgeOpts), { load: false });
            waitNote.hidden = true;
            dialog.busy(false);
            if (done || abort.signal.aborted) return;
            if (!res || !res.ok) {
                if (res?.error.kind === 'changed') {
                    // Changed meanwhile: the new list at once, asked again (a new confirmation comes with a new dry run).
                    state = retractChanged(state, res.changed);
                    draw();
                    void dry();
                    return;
                }
                if (res?.error.kind === 'expired') {
                    state = retractExpired(state);
                    draw();
                    void dry();
                    return;
                }
                state = retractNotSent(state);
                // Sent again with the same confirmation (it holds 15 minutes).
                showError(res ? res.error : { kind: 'down', status: 0 }, () => void send());
                return;
            }
            done = true;
            // The deletion changes the tree: the research's new head is noted, never taken as the tree's own version.
            this.researchTakeOwnWriteHead(researchId, '', res.value.head);
            dialog.close();
            await this.sourceRetractTreeLoaded(res.value.head);
            this.showToast(R.toast(title), TOAST_MS, {
                closable: true, kind: 'source-retract',
                action: {
                    label: R.undo,
                    run: () => this.sourceRetractUndo(ref, title),
                    work: { label: strings.busy.reverting },
                },
            });
        };

        cancel.focus();
        return new Promise<boolean>((resolve) => {
            const close = dialog.close;
            dialog.close = () => { abort.abort(); close(); resolve(done); };
            void dry();
        });
    },

    /**
     * What rests on a source (§2 body, also the source's part of §7): the
     * counts as the research says them, the one warning (facts left without a
     * source) and "What rests on the source" with its rows. Plain names: a
     * dialog that deletes never leads elsewhere.
     */
    sourceRetractList(sum: RetractSummary, opts: { inputIsTree?: boolean } = {}): HTMLElement[] {
        const R = strings.sources.retract;
        const out: HTMLElement[] = [];
        if (sum.noCites) {
            out.push(h('p', 'mdlg-text', R.noCites));
        } else {
            const box = h('div', 'mdlg-src-sum');
            box.dataset.retractSum = '';
            box.append(h('span', 'mdlg-src-sum-line', R.counts(sum.citations, sum.stories)),
                h('span', 'mdlg-src-sum-parts', sum.parts.map(p => `${R.parts[p.kind]} ${p.n}`).join(' · ')));
            out.push(box);
        }
        if (sum.bare > 0) {
            const warn = h('div', 'mdlg-warn');
            warn.dataset.deleteWarn = '';
            warn.appendChild(h('p', 'mdlg-warn-text', R.bare(sum.bare)));
            out.push(warn);
        }

        const grid = h('div', 'mv-uses-grid');
        const row = (kind: string, type: string, ...content: (HTMLElement | null)[]) => {
            const cell = h('span', 'mv-use-main');
            cell.dataset.retractRow = kind;
            cell.append(...content.filter((c): c is HTMLElement => !!c));
            grid.append(h('span', 'mv-use-type', type), cell, h('span'));
        };
        const person = (name: string) => h('span', 'is-person', name);
        const fact = (tag: string) => (tag === 'FAM' ? null : h('span', '', `· ${researchFactLabel(tag)}`));
        const line = (...parts: (HTMLElement | null)[]) => {
            const l = h('span', 'mv-use-line');
            l.append(...parts.filter((c): c is HTMLElement => !!c));
            return l;
        };
        const item = (...parts: HTMLElement[]) => {
            const it = h('span', 'mv-use-item');
            it.append(...parts);
            return it;
        };
        const items = (list: HTMLElement[], more: number) => {
            const box = h('span', 'mv-use-items');
            box.append(...list);
            if (more > 0) box.appendChild(h('span', 'mv-use-more', R.more(more)));
            return box;
        };
        const step = (status: string) => {
            const span = h('span');
            const html = factStatusHtml(status as FactStatus, { inert: true });
            if (html) span.innerHTML = html;
            else span.textContent = status;
            return span.firstElementChild as HTMLElement ?? span;
        };

        if (sum.cites.length) {
            row('cites', R.rows.cites, items(sum.cites.map(c => {
                const main = c.main ? h('span', 'person-source-main', '★︎') : null;
                if (main) {
                    main.setAttribute('role', 'img');
                    main.setAttribute('aria-label', strings.sources.mainMark);
                }
                const sub = h('span', 'mv-use-sub');
                if (c.hasOther) sub.textContent = R.hasOther;
                else sub.appendChild(h('span', 'is-bare', R.bareOne));
                return item(line(person(c.owner.name), fact(c.fact), main, c.locator ? h('span', 'is-faint', c.locator) : null), sub);
            }), sum.citesMore));
        }
        if (sum.bare > 0) {
            const sub = h('span', 'mv-use-sub');
            sum.bareRows.forEach((b, i) => {
                if (i) sub.append(', ');
                sub.append(person(b.owner.name));
                if (b.fact !== 'FAM') sub.append(` · ${researchFactLabel(b.fact)}`);
            });
            if (sum.bareMore > 0) sub.append(sum.bareRows.length ? `, ${R.more(sum.bareMore)}` : R.more(sum.bareMore));
            row('bare', R.rows.bare, h('span', 'mv-use-text', R.bareN(sum.bare)), sub);
        }
        if (sum.lowered > 0) {
            row('lowered', R.rows.lowered, h('span', 'mv-use-text', R.lowered(sum.lowered)), items(sum.loweredRows.map(l => {
                const s = h('span', 'mv-use-step');
                s.append(step(l.from), h('span', '', '→'), step(l.to));
                return item(line(person(l.owner.name), fact(l.fact), s));
            }), sum.loweredMore));
        }
        if (sum.stories > 0) {
            row('stories', R.rows.stories, h('span', 'mv-use-text', R.storiesN(sum.stories)),
                h('span', 'mv-use-sub', sum.storyInText ? `${R.storyKeep} ${R.storyCode}` : R.storyKeep));
        }
        if (sum.conflicts.length) {
            const list = sum.conflicts.map(c => {
                const decided = c.status === 'decided';
                const tag = h('span', `person-research-open-tag${decided ? ' prc-tag--done' : ''}`,
                    decided ? strings.conflict.decidedTag : strings.research.conflictOpen);
                return item(line(h('span', '', c.conflict ? researchConflictTitle(c.conflict) : c.id), tag),
                    h('span', 'mv-use-sub', decided ? `${R.conflictReview} · ${R.conflictDecided}` : R.conflictReview));
            });
            list.push(h('span', 'mv-use-sub', R.conflictNever));
            row('conflicts', R.rows.conflicts, items(list, 0));
        }
        if (sum.tasks.length) {
            // The task's name where the research said it (its queue, its waiting list); else its id.
            const titles = this.sourceRetractTaskTitles();
            const list = sum.tasks.map(t => {
                const said = [t.becomes === 'dropped' ? R.taskDropped : R.taskNarrowed];
                if (t.state === 'doing') said.push(R.taskDoing);
                const name = h('span', '', titles.get(t.id) ?? t.id);
                name.dataset.task = t.id;
                return item(line(name, h('span', 'is-faint', `· ${R.taskState[t.state] ?? t.state}`)),
                    h('span', 'mv-use-sub', said.join(' · ')));
            });
            list.push(h('span', 'mv-use-sub', R.tasksBack));
            row('tasks', R.rows.tasks, items(list, 0));
        }
        if (sum.files.length || sum.images > 0) {
            const said = [sum.files.length ? R.filesStay : '', sum.images > 0 ? R.images(sum.images) : ''].filter(Boolean).join(' · ');
            row('files', R.rows.files,
                sum.files.length ? h('span', 'mv-use-text mv-use-files', sum.files.join(', ')) : null,
                h('span', 'mv-use-sub', said),
                opts.inputIsTree ? h('span', 'mv-use-sub', R.fileTree) : null);
        }
        if (grid.childElementCount) {
            const sec = h('section', 'mv-uses');
            sec.dataset.retractUses = '';
            const head = h('div', 'mv-uses-head');
            head.appendChild(h('h3', 'mv-uses-title', R.usesTitle));
            sec.append(head, grid);
            out.push(sec);
        }
        return out;
    },

    /** The names of the research's tasks this page knows (the followed research's queue and waiting list), by id. */
    sourceRetractTaskTitles(): Map<string, string> {
        const rid = this.researchSyncLink()?.link.id ?? '';
        const s = liveSession();
        return retractTaskTitles([
            s && rid && s.researchId.toLowerCase() === rid.toLowerCase() ? s : null,
            rid ? this.researchStatusOf(rid) ?? lastBridgeStatus(rid) : null,
        ]);
    },

    /**
     * The followed tree loaded again after its research changed under this
     * page (a source deleted or put back here): the research's version at
     * `head` (none said: its status asked), then the Sources window and the
     * citation chips redrawn.
     */
    async sourceRetractTreeLoaded(head: string): Promise<void> {
        await this.liveLoadAfterWrite(head);
        if (document.getElementById('sources-modal')?.classList.contains('active')) this.renderSourcesList();
        this.refreshCitationChips();
    },

    /** "Load again": the research's status asked now and its version loaded (the source gone there meanwhile). */
    async sourceRetractReload(): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const status = await this.askResearchBridge(ctx.link.id, RELOAD_STATUS_MS).catch(() => null);
        await this.sourceRetractTreeLoaded(status?.head ?? '');
    },

    /** The toast's Undo (§3): the source put back in the research, its version loaded. */
    /**
     * "Restore the source in the research" of a "What was written" row (§4):
     * through the bridge, said in a toast; the row's action goes once done.
     */
    async sourceRestoreFromChanges(btn: HTMLButtonElement): Promise<void> {
        const ref = btn.dataset.restoreSource ?? '';
        const title = btn.dataset.title || ref;
        if (!ref || btn.disabled) return;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        const res = await this.postResearchBridgeWrite(base => restoreSource(base, [ref]), { load: false });
        btn.removeAttribute('aria-busy');
        const end = restoreToastEnd(res, title);
        // Not retracted there (any more): it is there, as restoring would leave it.
        if (end === 'reload' || end.ok) {
            btn.remove();
            this.showToast(end === 'reload' ? strings.sources.retract.restored(title) : end.text, TOAST_MS, { closable: true });
            return;
        }
        btn.disabled = false;
        this.showToast(end.text, TOAST_MS, { closable: true });
    },

    async sourceRetractUndo(ref: string, title: string): Promise<ToastWorkEnd | void> {
        const ctx = this.researchSyncLink();
        const res = ctx ? await this.postResearchBridgeWrite(base => restoreSource(base, [ref]), { load: false }) : null;
        const end = restoreToastEnd(res, title);
        if (end === 'reload') {
            // Not deleted there (any more): only the tree loaded again.
            await this.sourceRetractReload();
            return;
        }
        if (res?.ok && ctx) {
            this.researchTakeOwnWriteHead(ctx.link.id, '', res.value.head);
            await this.sourceRetractTreeLoaded(res.value.head);
        }
        return end;
    },
});

