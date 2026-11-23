/**
 * The tree's merges after the write (spec 134 §9, §10): the Merge history
 * (9a), a merge's list read from its record (9b) and undoing a merge
 * (10a–10f). The words: src/merge/undo-view.ts; the undo itself:
 * src/merge/undo-plan.ts and writeUndo / writeRestore (src/merge/write.ts).
 * See src/ui/module.ts for the composition pattern.
 */

import type { MergeRecord, StromData, TreeId, TreeMetadata } from '../types.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { AuditLogManager } from '../audit-log.js';
import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { MergerUI } from '../merge/index.js';
import { writeRestore, writeUndo } from '../merge/write.js';
import { targetBlock } from '../merge/wizard-ui.js';
import { renderDone, writtenWhen } from '../merge/steps/step6-done.js';
import { renderGroupsReadOnly } from '../merge/steps/step5-plan.js';
import type { Step6Env } from '../merge/steps/context.js';
import { MERGE_HOLD_EVENT, noteResearchSends, resolveSentInput, settleMergeHold, treeHold, unsentMerges } from '../merge/research-hold.js';
import { lastBridgeStatus, onBridgeStatus } from './research-sync-ui.js';
import { HELP_LINKS } from '../help/topics.js';
import { bindResearchUndoStep, researchUndoStep, researchUndoStepHtml, type ResearchUndoStep } from './research-undo-step.js';
import type { SendCounts } from '../research-changes.js';
import {
    canUndoRecord, dayText, historyLine, peopleRemoved, recordGroups, recordText, stateLabel, undoModel, undoResearchView, undoShown,
    type UndoLine, type UndoModel,
} from '../merge/undo-view.js';

const HISTORY_ID = 'merge-history-modal';
const RECORD_ID = 'merge-record-modal';
const UNDO_ID = 'merge-undo-modal';
/** Names listed under a heading of the undo before "and n more" (all of them while choosing). */
const UNDO_LINES = 40;

function esc(text: string): string {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The tree's data as stored or open (the open tree's newest). */
async function treeData(treeId: TreeId): Promise<StromData | null> {
    return DataManager.getDataFor(treeId) ?? await TreeManager.getTreeData(treeId);
}

function treeName(treeId: TreeId): string {
    return TreeManager.getTreeMetadata(treeId)?.name ?? '';
}

/** The Merge history's tree, and its record shown (9b). */
let historyTree: TreeId | null = null;
let shownRecord: { treeId: TreeId; record: MergeRecord; key: object } | null = null;

/** The undo dialog's state: what is chosen to go anyway, what is picked (null: all). */
interface UndoState {
    treeId: TreeId;
    recordId: string;
    record: MergeRecord;
    data: StromData;
    model: UndoModel;
    /** Kept items chosen to be undone anyway (Undo of the segment). */
    undo: Set<string>;
    /** Choose only some…: the ticked items; null undoes everything. */
    only: Set<string> | null;
    parent?: string;
    busy: boolean;
    error: string;
}
let undoState: UndoState | null = null;
/** The listeners of the research after a merge are in (listenForMergeHold). */
let holdListening = false;

export const mergeHistoryMethods = uiModule({
    // ==================== MERGE HISTORY (9a) ====================

    /** The tree's merges, newest first: when, its state, where from, what it brought; Open the list · Undo…. */
    async showMergeHistory(treeId: TreeId, parentDialogId?: string): Promise<void> {
        this.closeMobileMenu?.();
        historyTree = treeId;
        this.clearDialogStack();
        if (parentDialogId) {
            this.pushDialog(parentDialogId);
            this.closeDialogById(parentDialogId);
        }
        this.pushDialog(HISTORY_ID);
        document.getElementById(HISTORY_ID)?.classList.add('active');
        await this.renderMergeHistory();
        document.querySelector<HTMLElement>(`#${HISTORY_ID} .close-btn`)?.focus({ preventScroll: true });
    },

    async renderMergeHistory(): Promise<void> {
        const treeId = historyTree;
        const modal = document.getElementById(HISTORY_ID);
        if (!treeId || !modal) return;
        const W = strings.mergeWizard;
        const data = await treeData(treeId);
        const records = [...(data?.merges ?? [])].reverse();
        modal.querySelector('#merge-history-title')!.textContent = W.histTitle(treeName(treeId));
        const list = modal.querySelector<HTMLElement>('.merge-hist-list')!;
        list.innerHTML = records.map(r => {
            const undo = canUndoRecord(r)
                ? `<span class="merge-hist-sep" aria-hidden="true">·</span><button type="button" class="link-button" data-act="undo">${esc(W.undoEllipsis)}</button>` : '';
            return `<li class="merge-hist-row" data-id="${esc(r.id)}" data-state="${r.state}">
  <div class="merge-hist-top"><span class="merge-hist-at">${esc(writtenWhen(r.at))}</span><span class="merge-state-tag" data-state="${r.state}">${esc(stateLabel(r.state))}</span></div>
  <div class="merge-hist-what" title="${esc(historyLine(r))}">${esc(historyLine(r))}</div>
  <div class="merge-hist-acts"><button type="button" class="link-button" data-act="open">${esc(W.openList)}</button>${undo}</div>
</li>`;
        }).join('');
        list.onclick = e => {
            const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
            const id = b?.closest<HTMLElement>('.merge-hist-row')?.dataset.id;
            if (!b || !id) return;
            if (b.dataset.act === 'open') void this.openMergeRecord(id);
            else this.showUndoMerge(treeId, id, HISTORY_ID);
        };
        const changes = modal.querySelector<HTMLElement>('[data-act="changes"]');
        if (changes) {
            const open = !DataManager.isViewMode() && DataManager.getCurrentTreeId() === treeId;
            changes.hidden = !(open && (AuditLogManager.isEnabled() || await AuditLogManager.hasEntries(treeId)));
        }
    },

    closeMergeHistory(): void {
        document.getElementById(HISTORY_ID)?.classList.remove('active');
        historyTree = null;
        if (this.dialogStack[this.dialogStack.length - 1] === HISTORY_ID) this.returnToParentDialog();
    },

    /** The history's footer: Backups… and Change history… of its tree, Close coming back here. */
    mergeHistoryFooter(act: 'backups' | 'changes'): void {
        const treeId = historyTree;
        if (!treeId) return;
        if (act === 'backups') void this.showSnapshotsDialog(treeId, HISTORY_ID);
        else this.showAuditLogDialog(treeId, HISTORY_ID);
    },

    // ==================== A MERGE'S LIST (9b) ====================

    /**
     * Open the list: step 6 of the merge again, read only and without the
     * steps, read from its record and the tree as it is (the import is not
     * kept). Over the Merge history.
     */
    async openMergeRecord(id: string): Promise<void> {
        const treeId = historyTree;
        if (!treeId) return;
        const data = await treeData(treeId);
        const record = data?.merges?.find(r => r.id === id);
        const modal = document.getElementById(RECORD_ID);
        if (!data || !record || !modal) return;
        const W = strings.mergeWizard;
        const name = treeName(treeId);
        // Drawn again while open: its search and open groups stay; opened anew (also after Escape): fresh.
        const again = modal.classList.contains('active') && shownRecord?.treeId === treeId && shownRecord.record.id === id;
        const key = again ? shownRecord!.key : {};
        shownRecord = { treeId, record, key };
        const body = modal.querySelector<HTMLElement>('.merge-record-body')!;
        const shown = { treeId, name, record, mode: record.target.newTree ? 'new' as const : 'add' as const };
        const env: Step6Env = {
            record, treeId, treeName: name, intoExisting: canUndoRecord(record), noNextCard: false,
            showInTree: () => {
                this.closeMergeRecord();
                this.closeMergeHistory();
                void MergerUI.showWrittenInTree(shown);
            },
            saveAsList: () => void MergerUI.saveWrittenAsList(shown, body),
            checkTree: () => void this.showTreeValidationDialog(treeId, RECORD_ID),
            undoMerge: () => this.showUndoMerge(treeId, record.id, RECORD_ID),
        };
        modal.querySelector('#merge-record-title')!.textContent = W.recTitle(dayText(record.at));
        renderDone(body, env, list => renderGroupsReadOnly(list, key, () => recordGroups(record, data)), {
            title: W.doneTitle(name),
            tag: { text: stateLabel(record.state), state: record.state },
            notes: [historyLine(record)],
        });
        if (!modal.classList.contains('active')) {
            this.clearDialogStack();
            this.pushDialog(HISTORY_ID);
            this.closeDialogById(HISTORY_ID);
            this.pushDialog(RECORD_ID);
            modal.classList.add('active');
        }
        body.querySelector<HTMLElement>('.merge-step-title')?.focus({ preventScroll: true });
    },

    closeMergeRecord(): void {
        document.getElementById(RECORD_ID)?.classList.remove('active');
        shownRecord = null;
        if (this.dialogStack[this.dialogStack.length - 1] === RECORD_ID) this.returnToParentDialog();
    },

    /** Save the list…: the record's list as a text file. */
    saveMergeRecordList(): void {
        const shown = shownRecord;
        if (!shown) return;
        void treeData(shown.treeId).then(data => {
            if (!data) return;
            const text = recordText(shown.record, treeName(shown.treeId), recordGroups(shown.record, data));
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            a.download = `${(shown.record.source.label || 'merge').replace(/\.(ged|gedcom|json)$/i, '')}-${shown.record.at.slice(0, 10)}.txt`;
            a.click();
            URL.revokeObjectURL(a.href);
        });
    },

    // ==================== UNDO (10a–10f) ====================

    /**
     * Undo merge `recordId` of tree `treeId` (K8.1–K8.4), over the dialog
     * `parentDialogId` when given (step 6, the Merge history, a record):
     * what goes, what comes back, what is kept because it changed since.
     */
    showUndoMerge(treeId: TreeId, recordId: string, parentDialogId?: string): void {
        void (async () => {
            const data = await treeData(treeId);
            const record = data?.merges?.find(r => r.id === recordId);
            if (!data || !record) {
                this.showToast(strings.merge.failed, 4000);
                return;
            }
            undoState = {
                treeId, recordId, record, data, model: undoModel(record, data),
                undo: new Set(), only: null, ...(parentDialogId ? { parent: parentDialogId } : {}), busy: false, error: '',
            };
            this.clearDialogStack();
            if (parentDialogId) {
                this.pushDialog(parentDialogId);
                this.closeDialogById(parentDialogId);
            }
            this.pushDialog(UNDO_ID);
            const modal = document.getElementById(UNDO_ID);
            modal?.classList.add('active');
            this.renderUndoMerge();
            modal?.querySelector<HTMLElement>('.close-btn')?.focus({ preventScroll: true });
        })();
    },

    renderUndoMerge(): void {
        const st = undoState;
        const modal = document.getElementById(UNDO_ID);
        if (!st || !modal) return;
        const W = strings.mergeWizard;
        const { model, record } = st;
        const block = targetBlock(st.treeId);
        const name = treeName(st.treeId);
        const day = dayText(record.at);
        const picking = !!st.only;
        // What goes and what stays with the choices made (10b): a kept person is not among what goes.
        const now = undoShown(model, record, st.data, st.undo);
        const parts: string[] = [];
        parts.push(`<p class="merge-undo-lead">${esc(W.undoLead(record.source.label || '?', day))}</p>`);
        if (block === 'locked') parts.push(`<p class="merge-undo-warn" data-why="locked">${esc(W.lockedUndo(name))}</p>`);
        else if (block) parts.push(`<p class="merge-undo-warn" data-why="read-only">${esc(W.undoReadOnly(name))}</p>`);
        if (model.partly) parts.push(`<p class="merge-undo-partly">${esc(model.partly)}</p>`);
        for (const line of model.builtOn) parts.push(`<p class="merge-undo-warn" data-why="built-on">${esc(line)}</p>`);

        if (model.empty) {
            parts.push(`<p class="merge-undo-none">${esc(W.undoNothing)}</p>`);
        } else {
            parts.push(`<h3 class="merge-undo-h">${esc(W.uWhat)}</h3>`);
            if (picking) parts.push(`<p class="merge-undo-note">${esc(W.pickLead)}</p>`);
            const group = (key: UndoLine['group'], title: string, count: number, desc: string): void => {
                const lines = now.lines.filter(l => l.group === key);
                if (!count && !lines.length) return;
                const shown = picking ? lines : lines.slice(0, UNDO_LINES);
                const items = shown.map(l => {
                    if (!picking) return `<li class="merge-undo-line"><span>${esc(l.name)}</span></li>`;
                    const on = st.only!.has(l.id) ? ' checked' : '';
                    return `<li class="merge-undo-line"><label><input type="checkbox" data-pick="${esc(l.id)}"${on}><span>${esc(l.name)}</span></label></li>`;
                }).join('');
                const more = lines.length > shown.length ? `<li class="merge-undo-more">${esc(W.moreItems(lines.length - shown.length))}</li>` : '';
                parts.push(`<details class="merge-undo-grp" data-group="${key}"${picking ? ' open' : ''}>
  <summary><span class="merge-undo-gname">${esc(title)}</span><span class="merge-undo-gcount">${count.toLocaleString()}</span><span class="merge-undo-gdesc">${esc(desc)}</span></summary>
  <ul class="merge-undo-lines">${items}${more}</ul>
</details>`);
            };
            group('remove', W.uRemove, now.people, W.uRemoveDesc(now.couples, now.sources, now.places, now.files));
            group('restore', W.uRestore, now.restored, W.uRestoreDesc);
            group('unjoin', W.uUnjoin, now.unjoined, W.uUnjoinDesc);

            if (now.keep.length) {
                const rows = now.keep.map(k => {
                    const undo = st.undo.has(k.id);
                    const seg = k.canUndo ? `<div class="sel-seg merge-undo-seg" role="radiogroup" aria-label="${esc(k.name)}">
      <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-keep="${esc(k.id)}" data-v="keep" aria-checked="${!undo}" tabindex="${undo ? -1 : 0}">${esc(W.segKeep)}</button>
      <button type="button" class="sel-opt" data-sel-form="seg" role="radio" data-keep="${esc(k.id)}" data-v="undo" aria-checked="${undo}" tabindex="${undo ? 0 : -1}">${esc(W.segUndo)}</button>
    </div>` : '';
                    return `<li class="merge-undo-krow" data-id="${esc(k.id)}">
    <div class="merge-undo-ktext"><span class="merge-undo-kname">${esc(k.name)}</span><span class="merge-undo-kwhy${k.warn ? ' is-warn' : ''}">${esc(k.text)}</span></div>
    ${seg}
  </li>`;
                }).join('');
                parts.push(`<section class="merge-undo-keep"><h3 class="merge-undo-h">${esc(W.uKeepHead(now.keep.length))}</h3><ul class="merge-undo-klist">${rows}</ul></section>`);
            }
            if (record.backupId) parts.push(`<p class="merge-undo-note merge-undo-vs">${esc(W.vsBackup(day))}</p>`);
        }
        // The research's part (11c): only for a merge already sent there.
        // Its step is the research terminal's (134 V-N3): the command with the send's input, "I…" while not known.
        const res = model.empty ? null : undoResearchView(record, now.people);
        let step: ResearchUndoStep | null = null;
        if (res) {
            const researchId = TreeManager.getTreeMetadata(st.treeId)?.research?.id ?? '';
            step = researchUndoStep(researchId, res.input, !!researchId && this.researchLinkAvailable('sync-undo'));
            const help = res.input ? '' : `<p><button type="button" class="link-button merge-undo-help" data-act="undo-help">${esc(W.resUndoHelpLink)}</button></p>`;
            parts.push(`<section class="merge-undo-research">
  <p class="merge-undo-sent">${esc(res.sent)}</p>
  ${researchUndoStepHtml(step, { lead: res.step, cmdClass: 'merge-undo-cmd' })}
  ${help}
  ${res.comesBack ? `<p class="merge-undo-note">${esc(res.comesBack)}</p>` : ''}
</section>`);
        }
        if (st.error) parts.push(`<p class="merge-undo-err" role="alert">${esc(st.error)}</p>`);

        const body = modal.querySelector<HTMLElement>('.merge-undo-body')!;
        body.innerHTML = parts.join('\n');
        body.onclick = e => {
            const t = e.target as HTMLElement;
            const b = t.closest<HTMLButtonElement>('button[data-keep]');
            if (b) this.chooseUndoKeep(b.dataset.keep!, b.dataset.v === 'undo');
            const act = t.closest<HTMLButtonElement>('button[data-act]');
            if (act?.dataset.act === 'undo-help') this.showHelp(HELP_LINKS.mergeUndoResearch, act);
        };
        body.onkeydown = e => {
            const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-keep]');
            if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            this.chooseUndoKeep(b.dataset.keep!, b.dataset.v !== 'undo');
        };
        body.onchange = e => {
            const t = e.target as HTMLInputElement;
            if (!t.dataset.pick || !st.only) return;
            if (t.checked) st.only.add(t.dataset.pick); else st.only.delete(t.dataset.pick);
            this.updateUndoButton();
        };

        const section = body.querySelector<HTMLElement>('.merge-undo-research');
        if (step && section) bindResearchUndoStep(section, step, url => void this.launchResearchLink(url), () => this.showToast(strings.install.copyManual, 6000));

        // The input of a send not named yet: the research's sends may name it now (redrawn when they do).
        if (res && !res.input && record.sentIntake) void this.resolveUndoResearchInput(st);

        const pick = modal.querySelector<HTMLButtonElement>('[data-act="pick"]')!;
        pick.hidden = !!block || model.empty;
        pick.textContent = picking ? W.pickAll : W.pickSome;
        this.updateUndoButton();
    },

    /** The send's input read from the research's last sends (11c); the dialog redrawn when it is named now. */
    async resolveUndoResearchInput(st: UndoState): Promise<void> {
        const link = TreeManager.getTreeMetadata(st.treeId)?.research;
        const sends = link ? lastBridgeStatus(link.id)?.sends : null;
        if (!sends?.length) return;
        const record = await resolveSentInput(st.treeId, st.recordId, sends);
        if (!record?.sentToResearch || undoState !== st) return;
        st.record = { ...st.record, sentToResearch: record.sentToResearch };
        this.renderUndoMerge();
    },

    /** Keep or Undo of a kept item's segment; focus stays on the chosen cell. */
    chooseUndoKeep(id: string, undo: boolean): void {
        const st = undoState;
        if (!st) return;
        if (undo) st.undo.add(id); else st.undo.delete(id);
        // What goes changes with the choice (10b): drawn again, its open groups and its scroll kept.
        const body = document.querySelector<HTMLElement>(`#${UNDO_ID} .merge-undo-body`);
        const open = new Set([...body?.querySelectorAll<HTMLDetailsElement>('.merge-undo-grp') ?? []].filter(d => d.open).map(d => d.dataset.group));
        const top = body?.scrollTop ?? 0;
        this.renderUndoMerge();
        body?.querySelectorAll<HTMLDetailsElement>('.merge-undo-grp').forEach(d => { if (open.has(d.dataset.group)) d.open = true; });
        if (body) body.scrollTop = top;
        const row = [...document.querySelectorAll<HTMLElement>(`#${UNDO_ID} .merge-undo-krow`)].find(r => r.dataset.id === id);
        row?.querySelector<HTMLButtonElement>(`button[data-keep][data-v="${undo ? 'undo' : 'keep'}"]`)?.focus({ preventScroll: true });
    },

    /** Choose only some… / Undo everything. */
    toggleUndoPick(): void {
        const st = undoState;
        if (!st) return;
        st.only = st.only ? null : new Set(st.model.lines.map(l => l.id));
        this.renderUndoMerge();
    },

    /** The primary button: Remove {n} people (or Undo the merge), none when the tree cannot be written. */
    updateUndoButton(): void {
        const st = undoState;
        const btn = document.querySelector<HTMLButtonElement>(`#${UNDO_ID} [data-act="undo"]`);
        if (!st || !btn) return;
        const W = strings.mergeWizard;
        const n = peopleRemoved(st.model, st.undo, st.only, st.data);
        btn.hidden = !!targetBlock(st.treeId) || st.model.empty;
        btn.textContent = n > 0 ? W.btnUndo(n) : W.undoTitle;
        btn.disabled = st.busy || (!!st.only && st.only.size === 0);
    },

    closeUndoMerge(): void {
        if (undoState?.busy) return;
        document.getElementById(UNDO_ID)?.classList.remove('active');
        undoState = null;
        if (this.dialogStack[this.dialogStack.length - 1] === UNDO_ID) this.returnToParentDialog();
    },

    /** The undo as chosen (10f): written with its backup, the toast "Merge undone" · Redo the merge. */
    async confirmUndoMerge(): Promise<void> {
        const st = undoState;
        if (!st || st.busy || targetBlock(st.treeId)) return;
        st.busy = true;
        st.error = '';
        this.updateUndoButton();
        const res = await writeUndo(st.treeId, st.recordId, {
            undo: [...st.undo], ...(st.only ? { only: [...st.only] } : {}),
        });
        st.busy = false;
        if (!res.ok) {
            st.error = res.why;
            this.renderUndoMerge();
            return;
        }
        const { treeId, recordId, parent } = st;
        const removed = res.items.filter(id => id.startsWith('p:') && !res.before.persons[id.slice(2) as keyof StromData['persons']]?.isPlaceholder).length;
        const kept = new Set(res.kept.map(k => k.id)).size;
        // The dialog closes; the guide's step 6 and the toast of its Done (stale now) go with it, a history comes back with the new state.
        document.getElementById(UNDO_ID)?.classList.remove('active');
        undoState = null;
        this.clearDialogStack();
        MergerUI.closeUndone(recordId);
        await this.afterMergeUndoWrite(treeId);
        if (parent === HISTORY_ID || parent === RECORD_ID) {
            document.getElementById(RECORD_ID)?.classList.remove('active');
            shownRecord = null;
            await this.showMergeHistory(treeId);
        }
        const W = strings.mergeWizard;
        const before = res.before;
        this.showToast(W.undone(removed, kept), 10000, {
            closable: true,
            action: {
                label: W.redo,
                run: () => {
                    void writeRestore(treeId, before, recordId).then(async ok => {
                        if (!ok) {
                            this.showToast(strings.merge.saveFailed, 5000);
                            return;
                        }
                        await this.afterMergeUndoWrite(treeId);
                        if (historyTree === treeId) await this.renderMergeHistory();
                    });
                },
            },
        });
    },

    // ==================== THE RESEARCH AFTER A MERGE (§11) ====================

    /**
     * Send a merge waiting in the app to the research (step 6, Manage trees'
     * Send…; 11a): on the tree (switched to when another is open), today's
     * "What will be sent" with the merge's words. An older research: the
     * whole tree as today, through its terminal (11e).
     */
    async sendMergeToResearch(treeId: TreeId): Promise<void> {
        if (DataManager.isViewMode()) return;
        if (DataManager.getCurrentTreeId() !== treeId) {
            await this.switchToTree(treeId, { follow: false });
            if (DataManager.getCurrentTreeId() !== treeId) return;
        }
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link || link.copy) return;
        if (!this.researchSyncCapable(link.id)) {
            const goes = this.researchLinkAvailable('send');
            await this.researchSendTree(treeId);
            if (goes) await settleMergeHold(treeId, DataManager.getData(), undefined);
            return;
        }
        const pending = unsentMerges(DataManager.getData(), link);
        const W = strings.mergeWizard;
        const sum = (f: (r: MergeRecord) => number): number => pending.reduce((n, r) => n + f(r), 0);
        const list = await this.researchChangesReady();
        if (DataManager.getCurrentTreeId() !== treeId) return;
        this.showResearchChanges('send', {
            confirm: true, inexact: list === null,
            ...(pending.length ? {
                merge: {
                    // The list's numbers (134 V-N5); without an exact list, what the merges brought.
                    lead: (c: SendCounts | null) => c
                        ? W.resSendLeadList(treeName(treeId), c.added, c.changed, c.couples, c.sources)
                        : W.resSendLead(treeName(treeId), sum(r => r.counts.added), sum(r => r.counts.links), sum(r => r.sources.length)),
                    note: W.resSendNote, keep: W.keepLocal, go: W.resSendGo,
                },
            } : {}),
        });
    },

    /** A tree waiting for a send after a merge (11b): "not sent to the research · {n people}" ('' for none). */
    treeHoldText(tree: TreeMetadata | null | undefined): string {
        const hold = treeHold(tree);
        return hold ? strings.mergeWizard.notSent(hold.persons) : '';
    },

    /** Manage trees' row of a tree waiting for a send after a merge (11b): "not sent: merge of {d}" · Send…. */
    treeManagerHoldHtml(tree: TreeMetadata): string {
        const hold = treeHold(tree);
        if (!hold || DataManager.isViewMode()) return '';
        const W = strings.mergeWizard;
        return `<div class="tree-manager-item-hold"><span>${esc(W.notSentMerge(dayText(hold.at)))}</span>`
            + ` <button type="button" class="link-button tree-manager-hold-send" onclick="window.Strom.UI.sendMergeFromManager('${esc(tree.id)}')">${esc(W.sendShort)}</button></div>`;
    },

    /** Send… of Manage trees: the dialog closes, the tree opens with "What will be sent". */
    sendMergeFromManager(treeId: TreeId): void {
        this.closeTreeManagerDialog();
        void this.sendMergeToResearch(treeId);
    },

    /** Once: the switcher follows a hold that comes or goes; the research's sends name the input of a merge sent. */
    listenForMergeHold(): void {
        if (holdListening || typeof window === 'undefined') return;
        holdListening = true;
        window.addEventListener(MERGE_HOLD_EVENT, () => {
            this.updateTreeSwitcher();
            const manager = document.getElementById('tree-manager-modal');
            if (manager?.classList.contains('active')) void this.updateTreeManagerList();
        });
        onBridgeStatus((id, status) => noteResearchSends(id, status.sends));
    },

    /** The open tree drawn again after an undo (or its redo) of a merge. */
    async afterMergeUndoWrite(treeId: TreeId): Promise<void> {
        if (DataManager.isViewMode() || DataManager.getCurrentTreeId() !== treeId) return;
        await TreeRenderer.renderAsync();
        this.refreshSearch();
        this.updateTreeSwitcher();
    },
});
