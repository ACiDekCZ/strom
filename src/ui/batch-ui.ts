/**
 * "Add materials…" (C2): a folder, many files or a ZIP for Strom Research,
 * sent as one batch straight to its running bridge (nothing waits in the
 * browser). A wizard: Choose · Review · Send, then the progress (it can be
 * paused, cancelled or hidden while the user works on) and a summary. An
 * unfinished batch is remembered by its counts only: choosing the same
 * folder again goes on, the files the research has are skipped.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import { sha256OfBlob } from '../sha256.js';
import { originalTargets, mediaReplyId } from '../originals.js';
import { parseLiveBridge, withAppVersion, researchSchemeUrl, sanitizeLiveStatus } from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme } from '../research-device.js';
import {
    BatchSkip, BatchFolder, batchSkip, batchLimitsOf, batchOverLimit, batchEstimate, batchDefaultName, batchTree,
    batchFolderFiles, newBatchId, batchPathHeader, isZip, UnfinishedBatch, sanitizeUnfinishedBatch,
} from '../batch.js';
import { formatBytesShort } from './originals-ui.js';
import { onComputer, fetchWithTimeout, bridgeFailure } from './research-ui.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'batch-modal';
const UNFINISHED_KEY = 'strom-batch:';
/** At most this many file rows drawn at once (the rest: "and N more" — search narrows it). */
const MAX_ROWS = 400;
const ASK_TIMEOUT_MS = 5000;
const PUT_MIN_TIMEOUT_MS = 60_000;

interface Item {
    file: File;
    path: string;
    size: number;
    checked: boolean;
    skip: BatchSkip | null;
    fixed: boolean;
}

type Step = 'pick' | 'check' | 'send' | 'progress' | 'done';

interface DoneReply { inputs: number; known: number; refused: number; tasks: number }

interface Run {
    id: string;
    treeId: string;
    researchId: string;
    base: string;
    name: string;
    person: string;
    personId: string;
    note: string;
    queue: Item[];
    index: number;
    total: number;
    totalBytes: number;
    doneBytes: number;
    received: number;
    /** Files the research answered it had (PUT → known): in its own count at the close. */
    skipped: number;
    /** Files skipped before sending (GET said the research has them): never in the batch, counted here. */
    skippedAsked: number;
    refused: { path: string; why: string }[];
    current: string;
    paused: boolean;
    lost: boolean;
    cancelled: boolean;
    finished: boolean;
    hidden: boolean;
    result: DoneReply | null;
    resume: (() => void) | null;
}

let st: {
    step: Step;
    items: Item[];
    name: string;
    nameTouched: boolean;
    personId: string;
    note: string;
    search: string;
    full: Set<string>;
    collapsed: Set<string>;
    resume: UnfinishedBatch | null;
} | null = null;
let run: Run | null = null;
let downTimer: ReturnType<typeof setInterval> | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readUnfinished(treeId: string): UnfinishedBatch | null {
    try {
        const raw = localStorage.getItem(UNFINISHED_KEY + treeId);
        return raw ? sanitizeUnfinishedBatch(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

function writeUnfinished(treeId: string, rec: UnfinishedBatch | null): void {
    try {
        if (rec) localStorage.setItem(UNFINISHED_KEY + treeId, JSON.stringify(rec));
        else localStorage.removeItem(UNFINISHED_KEY + treeId);
    } catch { /* not remembered: a closed tab starts anew */ }
}

function retryAfterMs(value: string | null): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(60_000, Math.max(1000, n * 1000)) : 5000;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function onLeave(e: BeforeUnloadEvent): void {
    if (!run || run.finished || run.cancelled) return;
    e.preventDefault();
    e.returnValue = strings.batch.leaveWarning;
}

/** Every file under a dropped folder (DataTransferItem entries), with its relative path. */
async function filesOfEntry(entry: FileSystemEntry, prefix = ''): Promise<{ file: File; path: string }[]> {
    if (entry.isFile) {
        const file = await new Promise<File | null>(resolve => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
        return file ? [{ file, path: prefix + entry.name }] : [];
    }
    if (!entry.isDirectory) return [];
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    // readEntries gives a part at a time, until an empty one.
    for (;;) {
        const part = await new Promise<FileSystemEntry[]>(resolve => reader.readEntries(resolve, () => resolve([])));
        if (part.length === 0) break;
        all.push(...part);
    }
    const out: { file: File; path: string }[] = [];
    for (const child of all) out.push(...await filesOfEntry(child, `${prefix}${entry.name}/`));
    return out;
}

export const batchMethods = uiModule({
    /** "Add materials…" is offered: on a computer, a tree linked to a research that takes batches (not Safari). */
    batchAvailable(): boolean {
        const link = this.researchOriginalsLink();
        if (!link || !onComputer() || bridgeFailure(null) === 'safari') return false;
        return !!batchLimitsOf(this.researchAcceptsOf(link.researchId)) && !!this.researchMediaAccepts(link.researchId);
    },

    /** Open the wizard (from the menu, the material dialog with its person, a drop, the unfinished line). */
    showBatchDialog(opts: { personId?: string; files?: { file: File; path: string }[] } = {}): void {
        if (run && !run.finished && !run.cancelled) {
            run.hidden = false;
            this.openBatchOverlay();
            this.renderBatchDialog();
            return;
        }
        const link = this.researchOriginalsLink();
        if (!link || !this.batchAvailable()) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        const resume = readUnfinished(link.treeId);
        st = {
            step: 'pick', items: [], name: resume?.name ?? '', nameTouched: !!resume, personId: opts.personId ?? resume?.personId ?? '',
            note: resume?.note ?? '', search: '', full: new Set(), collapsed: new Set(), resume,
        };
        run = null;
        this.openBatchOverlay();
        if (opts.files?.length) this.addBatchFiles(opts.files);
        else this.renderBatchDialog();
    },

    openBatchOverlay(): void {
        let overlay = document.getElementById(DIALOG_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = DIALOG_ID;
            overlay.className = 'modal-overlay active';
            document.body.appendChild(overlay);
            this.pushDialog(DIALOG_ID);
        }
    },

    /** Picked or dropped files: kept with their paths, the rules tick or untick them; then the review. */
    addBatchFiles(files: { file: File; path: string }[]): void {
        if (!st) return;
        const link = this.researchOriginalsLink();
        const limits = link ? batchLimitsOf(this.researchAcceptsOf(link.researchId)) : null;
        const known = new Set(st.items.map(i => `${i.path}\u0000${i.size}`));
        for (const { file, path } of files) {
            const clean = path.replace(/^\/+/, '') || file.name;
            if (known.has(`${clean}\u0000${file.size}`)) continue;
            known.add(`${clean}\u0000${file.size}`);
            const skip = batchSkip({ path: clean, size: file.size }, limits?.maxFile ?? 0);
            // A ZIP the research does not unpack goes as a plain file (it may refuse it).
            st.items.push({ file, path: clean, size: file.size, checked: !skip, skip: skip?.reason ?? null, fixed: skip?.fixed ?? false });
        }
        if (!st.nameTouched) {
            const date = new Date().toLocaleDateString(getCurrentLanguage());
            st.name = batchDefaultName(st.items.map(i => i.path), strings.batch.defaultName(date));
        }
        if (st.items.length) st.step = 'check';
        this.renderBatchDialog();
    },

    // ==================== RENDERING ====================

    renderBatchDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay) return;
        if (run && (st?.step === 'progress' || st?.step === 'done' || !st)) {
            overlay.innerHTML = this.batchFrameHtml(run.finished ? this.batchDoneHtml() : this.batchProgressHtml(), null);
        } else if (st) {
            const body = st.step === 'pick' ? this.batchPickHtml() : st.step === 'check' ? this.batchCheckHtml() : this.batchSendHtml();
            overlay.innerHTML = this.batchFrameHtml(body, st.step);
        }
        this.wireBatchDialog(overlay);
        this.watchBatchBridge();
    },

    batchFrameHtml(body: string, step: Step | null): string {
        const b = strings.batch;
        const link = this.researchOriginalsLink();
        const tree = link ? TreeManager.getTreeMetadata(link.treeId)?.name ?? '' : '';
        const research = link ? this.researchStatusOf(link.researchId)?.name || tree : tree;
        const steps: [Step, string][] = [['pick', b.stepPick], ['check', b.stepCheck], ['send', b.stepSend]];
        const at = step ? steps.findIndex(s => s[0] === step) : -1;
        const pills = step ? `<ol class="batch-steps">${steps.map(([k, label], i) =>
            `<li class="batch-step${i === at ? ' is-active' : i < at ? ' is-done' : ''}"${i === at ? ' aria-current="step"' : ''}>${i < at ? '✓ ' : ''}${esc(label)}</li>`).join('')}</ol>` : '';
        return `
            <div class="modal batch-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-title">
                <div class="modal-header batch-header">
                    <div class="audit-log-heading">
                        <h2 id="batch-title">${esc(b.title)}</h2>
                        <div class="audit-log-subtitle">${esc(b.subtitle(tree, research))}</div>
                    </div>
                    ${pills}
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${body}
            </div>`;
    },

    batchPickHtml(): string {
        const b = strings.batch;
        const s = st!;
        const link = this.researchOriginalsLink();
        const limits = link ? batchLimitsOf(this.researchAcceptsOf(link.researchId)) : null;
        const up = !!link && this.researchBridgeUp(link.researchId);
        const banner = s.resume ? `
            <div class="batch-banner">
                <div class="batch-banner-text"><strong>${esc(b.unfinishedTitle(s.resume.name))}</strong>
                <span>${esc(b.unfinishedBanner(s.resume.done, s.resume.total, this.batchWhen(s.resume.startedAt)))}</span></div>
                <div class="batch-banner-actions">
                    <button type="button" class="research-sync-link" data-act="discard">${esc(b.discard)}</button>
                    <button type="button" class="primary btn-sm" data-act="pick-folder">${esc(b.pickFolderAgain)}</button>
                </div>
            </div>` : '';
        const area = up ? `
            <div class="batch-drop" tabindex="-1">
                <div class="batch-drop-title">${esc(b.dropHere)}</div>
                <div class="batch-drop-note">${esc(b.zipNote)}</div>
                <div class="batch-drop-buttons">
                    <button type="button" class="secondary" data-act="pick-files">${esc(b.pickFiles)}</button>
                    <button type="button" class="secondary" data-act="pick-folder">${esc(b.pickFolder)}</button>
                </div>
            </div>` : `
            <div class="batch-drop is-down">
                <div class="batch-drop-title">${esc(b.bridgeDownTitle)}</div>
                <div class="batch-drop-note">${esc(b.bridgeDownText)}</div>
                ${this.researchLinkAvailable('open') || this.researchLinkAvailable('live')
                    ? `<div class="batch-drop-buttons"><button type="button" class="primary" data-act="start">${esc(strings.sync.startResearch)}</button></div>` : ''}
            </div>`;
        return `
                <div class="modal-content batch-content">
                    ${banner}
                    ${area}
                    <input type="file" id="batch-input-files" multiple hidden>
                    <input type="file" id="batch-input-folder" webkitdirectory multiple hidden>
                    ${this.batchFieldsHtml()}
                </div>
                <div class="buttons batch-footer">
                    <span class="batch-foot-note">${limits ? esc(b.limits(formatBytesShort(limits.maxFile), limits.files, formatBytesShort(limits.bytes))) : ''}</span>
                    <button type="button" class="secondary" data-act="close">${esc(strings.buttons.cancel)}</button>
                    <button type="button" class="primary" data-act="next" disabled>${esc(strings.buttons.continue)}</button>
                </div>`;
    },

    batchFieldsHtml(): string {
        const b = strings.batch;
        const s = st!;
        const data = DataManager.getData();
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
        const label = (id: string): string => {
            const p = data.persons[id as PersonId];
            return p ? `${p.firstName} ${p.lastName}`.trim() : '';
        };
        return `
                    <div class="batch-fields">
                        <label class="batch-field"><span>${esc(b.name)}</span>
                            <input type="text" id="batch-name" maxlength="120" value="${esc(s.name)}" placeholder="${esc(b.namePlaceholder)}"></label>
                        <label class="batch-field"><span>${esc(b.person)} <span class="batch-optional">${esc(b.optional)}</span></span>
                            <input type="text" id="batch-person" list="batch-person-list" value="${esc(label(s.personId))}" autocomplete="off"></label>
                        <datalist id="batch-person-list">${persons.slice(0, 5000).map(p =>
                            `<option value="${esc(`${p.firstName} ${p.lastName}`.trim())}" data-id="${esc(p.id)}"></option>`).join('')}</datalist>
                        <label class="batch-field batch-field-wide"><span>${esc(b.note)} <span class="batch-optional">${esc(b.optional)}</span></span>
                            <textarea id="batch-note" rows="2" maxlength="500" placeholder="${esc(b.notePlaceholder)}">${esc(s.note)}</textarea></label>
                    </div>`;
    },

    batchCheckHtml(): string {
        const b = strings.batch;
        const s = st!;
        const link = this.researchOriginalsLink();
        const limits = link ? batchLimitsOf(this.researchAcceptsOf(link.researchId)) : null;
        const chosen = s.items.filter(i => i.checked);
        const bytes = chosen.reduce((sum, i) => sum + i.size, 0);
        const total = s.items.reduce((sum, i) => sum + i.size, 0);
        const over = limits ? batchOverLimit(chosen.length, bytes, limits) : null;
        const rows = this.batchRowsHtml();
        return `
                <div class="modal-content batch-content">
                    <div class="batch-list-head">
                        <div><div class="batch-list-title">${esc(s.name || b.namePlaceholder)}</div>
                        <div class="batch-list-sub">${esc(b.listSummary(s.items.length, formatBytesShort(total), s.items.length - chosen.length))}</div></div>
                    </div>
                    <div class="batch-toolbar">
                        <input type="search" id="batch-search" placeholder="${esc(b.search)}" value="${esc(s.search)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
                        <button type="button" class="research-sync-link" data-act="expand-all">${esc(b.expandAll)}</button>
                        <button type="button" class="research-sync-link" data-act="add-more">${esc(b.addMore)}</button>
                    </div>
                    <div class="batch-list" role="tree">
                        <div class="batch-row batch-row-head" aria-hidden="true"><span>${esc(b.colName)}</span><span>${esc(b.colType)}</span><span>${esc(b.colSize)}</span><span>${esc(b.colReason)}</span></div>
                        ${rows}
                    </div>
                    <input type="file" id="batch-input-files" multiple hidden>
                    ${this.batchFieldsHtml()}
                </div>
                ${over ? `<p class="batch-over">${esc(b.overLimit(over.files, formatBytesShort(over.bytes)))}</p>` : ''}
                <div class="buttons batch-footer">
                    <span class="batch-foot-note"><strong>${esc(b.willSend(chosen.length, formatBytesShort(bytes)))}</strong>${limits
                        ? `<br>${esc(b.limitLine(limits.files, formatBytesShort(limits.bytes), formatBytesShort(limits.maxFile)))}` : ''}</span>
                    <button type="button" class="secondary" data-act="back">${esc(strings.batch.back)}</button>
                    <button type="button" class="primary" data-act="next"${over || chosen.length === 0 ? ' disabled' : ''}>${esc(strings.buttons.continue)}</button>
                </div>`;
    },

    /** The review list: the folder tree (folders open only for their unticked files), or a flat search. */
    batchRowsHtml(): string {
        const s = st!;
        const b = strings.batch;
        const link = this.researchOriginalsLink();
        const limits = link ? batchLimitsOf(this.researchAcceptsOf(link.researchId)) : null;
        let drawn = 0;
        const reasonText = (i: Item): string => {
            switch (i.skip) {
                case 'system': return b.reasonSystem;
                case 'secret': return b.reasonSecret;
                case 'program': return b.reasonProgram;
                case 'archive': return b.reasonArchive;
                case 'tooBig': return b.reasonTooBig(formatBytesShort(limits?.maxFile ?? 0));
                case 'ged': return b.reasonGed;
                default: return '';
            }
        };
        const typeOf = (i: Item): string => i.skip === 'system' ? b.typeSystem : (/\.([^./]+)$/.exec(i.path)?.[1] ?? '').toUpperCase();
        const fileRow = (index: number, depth: number, showPath: boolean): string => {
            if (drawn >= MAX_ROWS) return '';
            drawn++;
            const i = s.items[index];
            const name = showPath ? i.path : i.path.split('/').pop() ?? i.path;
            const unticked = !i.checked;
            return `<div class="batch-row batch-file${unticked ? ' is-off' : ''}" role="treeitem" style="--depth:${depth}">
                <label class="batch-name"><input type="checkbox" data-file="${index}"${i.checked ? ' checked' : ''}${i.fixed ? ' disabled' : ''}>
                <span class="batch-name-text">${esc(name)}</span></label>
                <span class="batch-type">${esc(typeOf(i))}</span>
                <span class="batch-size">${esc(formatBytesShort(i.size))}</span>
                <span class="batch-reason">${unticked && i.skip ? esc(reasonText(i)) : ''}</span>
            </div>`;
        };
        if (s.search.trim()) {
            const q = s.search.trim().toLowerCase();
            const hits = s.items.map((_, k) => k).filter(k => s.items[k].path.toLowerCase().includes(q));
            const html = hits.map(k => fileRow(k, 0, true)).join('');
            return html + (hits.length > drawn ? `<div class="batch-row batch-more-note">${esc(b.moreFiles(hits.length - drawn))}</div>` : '');
        }
        const tree = batchTree(s.items.map(i => i.path));
        const folderHtml = (f: BatchFolder, depth: number): string => {
            const all = batchFolderFiles(f);
            const on = all.filter(k => s.items[k].checked).length;
            const off = all.length - on;
            const open = s.full.has(f.path) || (off > 0 && !s.collapsed.has(f.path));
            const bytes = all.reduce((sum, k) => sum + s.items[k].size, 0);
            const state = on === 0 ? 'false' : off === 0 ? 'true' : 'mixed';
            const head = f.path === '' ? '' : `<div class="batch-row batch-folder" role="treeitem" aria-expanded="${open}" style="--depth:${depth}">
                <span class="batch-name">
                    <button type="button" class="batch-chevron" data-folder="${esc(f.path)}" aria-label="${esc(f.name)}">${open ? '▾' : '▸'}</button>
                    <input type="checkbox" data-folder-check="${esc(f.path)}" aria-checked="${state}"${on > 0 ? ' checked' : ''}>
                    <span class="batch-name-text">${esc(f.name)}</span></span>
                <span class="batch-type">${esc(b.typeFolder)}</span>
                <span class="batch-size">${esc(b.folderMeta(all.length, formatBytesShort(bytes)))}</span>
                <span class="batch-reason"></span>
            </div>`;
            if (!open && f.path !== '') return head;
            const inner = depth + (f.path === '' ? 0 : 1);
            const subs = f.folders.map(sub => folderHtml(sub, inner)).join('');
            const full = s.full.has(f.path) || f.path === '' && !f.folders.length;
            const shown = full ? f.files : f.files.filter(k => !s.items[k].checked);
            const hidden = f.files.length - shown.length;
            const files = shown.map(k => fileRow(k, inner, false)).join('');
            const more = hidden > 0 ? `<div class="batch-row batch-more" style="--depth:${inner}"><button type="button" class="research-sync-link" data-more="${esc(f.path)}">${esc(b.moreFiles(hidden))} ›</button></div>` : '';
            return head + subs + files + more;
        };
        return folderHtml(tree, 0) + (drawn >= MAX_ROWS ? `<div class="batch-row batch-more-note">…</div>` : '');
    },

    batchSendHtml(): string {
        const b = strings.batch;
        const s = st!;
        const link = this.researchOriginalsLink()!;
        const archive = this.researchModeOf(link.researchId) === 'archive';
        const chosen = s.items.filter(i => i.checked);
        const bytes = chosen.reduce((sum, i) => sum + i.size, 0);
        const rates = this.researchAcceptsOf(link.researchId)?.mediaEstimate ?? null;
        const est = batchEstimate(chosen.length, rates);
        // Fewer files than one task takes: the price of one task is the most it costs, not a typical amount.
        const smallBatch = !!rates && chosen.length < rates.filesPerTask;
        const money = (n: number, cur: string): string => {
            try { return new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency: cur, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n); }
            catch { return `${n} ${cur}`; }
        };
        const info = archive
            ? `<p class="material-box"><span class="research-not-retroactive-icon" aria-hidden="true">i</span><span>${esc(b.archiveInfo)}</span></p>`
            : `<div class="batch-confirm-block"><div class="batch-confirm-label">${esc(b.privacyTitle)}</div><p>${esc(b.privacy)}</p></div>
               <div class="batch-confirm-block"><div class="batch-confirm-label">${esc(b.costTitle)}</div>${est
                    ? `<div class="batch-cost-row"><span>${esc(b.costSort)}</span><strong>${esc(smallBatch ? b.atMost(money(est.amount, est.currency)) : b.about(money(est.amount, est.currency)))}</strong></div><p class="batch-cost-note">${esc(b.costNote)}</p>`
                    : `<p>${esc(b.costUnknown)}</p>`}</div>`;
        return `
                <div class="modal-content batch-content">
                    <h3 class="batch-confirm-title">${esc(archive ? b.confirmTitleArchive : b.confirmTitle)}${archive ? ` <span class="research-sync-tag">${esc(strings.sync.archiveTag)}</span>` : ''}</h3>
                    <p class="batch-confirm-sum">${esc(b.confirmSum(s.name, chosen.length, formatBytesShort(bytes)))}</p>
                    ${info}
                    <p class="batch-keep-tab">${esc(b.keepTab)}</p>
                </div>
                <div class="buttons batch-footer">
                    <span class="batch-foot-note"></span>
                    <button type="button" class="secondary" data-act="back">${esc(strings.batch.back)}</button>
                    <button type="button" class="primary" data-act="go">${esc(archive ? b.saveN(chosen.length) : b.sendN(chosen.length))}</button>
                </div>`;
    },

    batchProgressHtml(): string {
        const b = strings.batch;
        const r = run!;
        const done = r.index;
        const pct = r.totalBytes > 0 ? Math.min(100, Math.round(r.doneBytes / r.totalBytes * 100)) : 0;
        const link = this.researchOriginalsLink();
        const research = link ? this.researchStatusOf(link.researchId)?.name || r.name : r.name;
        const cur = r.queue[r.index];
        const refused = r.refused.length ? `
            <details class="batch-refused"${r.refused.length <= 3 ? ' open' : ''}>
                <summary>${esc(b.refused)} · ${r.refused.length}</summary>
                <ul>${r.refused.slice(0, 200).map(x => `<li>${esc(`${x.path}: ${x.why}`)}</li>`).join('')}</ul>
            </details>` : '';
        return `
                <div class="modal-content batch-content batch-progress${r.paused ? ' is-paused' : ''}">
                    <div class="batch-progress-title">${r.paused ? '' : '<span class="research-sync-spinner" aria-hidden="true"></span>'}${esc(r.paused ? b.paused : b.progressTitle)}</div>
                    <div class="batch-progress-sub">${esc(b.progressSub(r.name, research))}</div>
                    <div class="batch-progress-count" role="status"><strong>${esc(b.progressCount(done, r.total))}</strong>
                        <span>${esc(b.progressBytes(formatBytesShort(r.doneBytes), formatBytesShort(r.totalBytes)))}</span></div>
                    <div class="batch-bar"><span style="width:${pct}%"></span></div>
                    ${r.paused ? `<p class="batch-paused-note">${esc(r.lost ? b.bridgeLost : b.pausedNote)}</p>`
                        : cur ? `<p class="batch-now">${esc(b.now(cur.path, formatBytesShort(cur.size)))}</p>` : ''}
                    ${r.skipped + r.skippedAsked ? `<p class="batch-skipped">${esc(b.skipped)} · ${r.skipped + r.skippedAsked}</p>` : ''}
                    ${refused}
                    <p class="batch-keep-tab">${esc(b.keepTabHide)}</p>
                </div>
                <div class="buttons batch-footer">
                    <button type="button" class="secondary is-danger-text" data-act="cancel-run">${esc(b.cancel)}</button>
                    <span class="batch-foot-note"></span>
                    <button type="button" class="secondary" data-act="hide">${esc(b.hide)}</button>
                    <button type="button" class="primary" data-act="${r.paused ? 'resume' : 'pause'}">${esc(r.paused ? b.resumeBtn : b.pause)}</button>
                </div>`;
    },

    batchDoneHtml(): string {
        const b = strings.batch;
        const r = run!;
        const link = this.researchOriginalsLink();
        const archive = !!link && this.researchModeOf(link.researchId) === 'archive';
        const received = r.result?.inputs ?? r.received;
        // What the research already had: its count at the close (sent and known) plus what was skipped before sending.
        const known = (r.result ? r.result.known : r.skipped) + r.skippedAsked;
        const refusedRow = r.refused.length === 1
            ? `<div class="batch-done-row is-warn"><span>${esc(b.refusedRow(r.refused[0].path, r.refused[0].why))}</span></div>`
            : r.refused.length > 1 ? `<details class="batch-refused"><summary>${esc(b.refused)} · ${r.refused.length}</summary><ul>${r.refused.slice(0, 200)
                .map(x => `<li>${esc(`${x.path}: ${x.why}`)}</li>`).join('')}</ul></details>` : '';
        const open = link && this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.researchId }, announcedResearchScheme()) : null;
        return `
                <div class="modal-content batch-content batch-done">
                    <h3 class="batch-confirm-title">✓ ${esc(archive ? b.doneTitleArchive(r.name) : b.doneTitle(r.name))}</h3>
                    <div class="batch-done-row"><span>${esc(archive ? b.receivedArchive : b.received)}</span><strong>${received}</strong></div>
                    ${known ? `<div class="batch-done-row"><span>${esc(archive ? b.alreadyHadArchive : b.alreadyHad)}</span><strong>${known}</strong></div>` : ''}
                    ${refusedRow}
                    ${!archive && r.result?.tasks ? `<div class="batch-done-row"><span>${esc(b.tasks)}</span><strong>${r.result.tasks}</strong></div>` : ''}
                    <p class="batch-done-text">${esc(archive ? b.doneTextArchive : b.doneText)}</p>
                    ${open ? `<button type="button" class="research-sync-link" data-act="open-research">${esc(b.openInResearch)}</button>` : ''}
                </div>
                <div class="buttons batch-footer">
                    <span class="batch-foot-note"></span>
                    <button type="button" class="primary" data-act="close">${esc(strings.batch.done)}</button>
                </div>`;
    },

    batchWhen(iso: string): string {
        const t = Date.parse(iso);
        return Number.isFinite(t) ? new Date(t).toLocaleString(getCurrentLanguage(), { dateStyle: 'short', timeStyle: 'short' }) : '';
    },

    // ==================== WIRING ====================

    wireBatchDialog(overlay: HTMLElement): void {
        const s = st;
        const readFields = (): void => {
            if (!s) return;
            const name = overlay.querySelector<HTMLInputElement>('#batch-name');
            if (name && name.value !== s.name) { s.name = name.value; s.nameTouched = true; }
            const note = overlay.querySelector<HTMLTextAreaElement>('#batch-note');
            if (note) s.note = note.value.slice(0, 500);
            const person = overlay.querySelector<HTMLInputElement>('#batch-person');
            if (person) {
                const opt = Array.from(overlay.querySelectorAll<HTMLOptionElement>('#batch-person-list option')).find(o => o.value === person.value.trim());
                s.personId = opt?.dataset.id ?? '';
            }
        };
        overlay.querySelectorAll<HTMLElement>('[data-act]').forEach(el => el.addEventListener('click', () => {
            readFields();
            const act = el.dataset.act;
            switch (act) {
                case 'close': this.cancelBatchDialog(); break;
                case 'pick-files': overlay.querySelector<HTMLInputElement>('#batch-input-files')?.click(); break;
                case 'pick-folder': overlay.querySelector<HTMLInputElement>('#batch-input-folder')?.click(); break;
                case 'add-more': overlay.querySelector<HTMLInputElement>('#batch-input-files')?.click(); break;
                case 'start': this.researchSyncAction('startResearch'); break;
                case 'discard': {
                    const link = this.researchOriginalsLink();
                    if (link) writeUnfinished(link.treeId, null);
                    if (s) s.resume = null;
                    this.renderBatchDialog();
                    this.refreshResearchSyncUi();
                    break;
                }
                case 'back': if (s) { s.step = s.step === 'send' ? 'check' : 'pick'; this.renderBatchDialog(); } break;
                case 'next': if (s && s.step === 'check') { s.step = 'send'; this.renderBatchDialog(); } break;
                case 'expand-all': if (s) { batchFolderPaths(s.items).forEach(p => s.full.add(p)); s.full.add(''); s.collapsed.clear(); this.renderBatchDialog(); } break;
                case 'go': void this.startBatchRun(); break;
                case 'pause': if (run) { run.paused = true; this.renderBatchDialog(); } break;
                case 'resume': this.resumeBatchRun(); break;
                case 'hide': this.hideBatchDialog(); break;
                case 'cancel-run': void this.cancelBatchRun(); break;
                case 'open-research': {
                    const link = this.researchOriginalsLink();
                    const url = link ? researchSchemeUrl('open', { tree: link.researchId }, announcedResearchScheme()) : null;
                    if (url) this.launchResearchLink(url);
                    break;
                }
            }
        }));
        const fromInput = (input: HTMLInputElement | null): void => {
            input?.addEventListener('change', () => {
                readFields();
                const files = Array.from(input.files ?? []).map(file => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
                input.value = '';
                this.addBatchFiles(files);
            });
        };
        fromInput(overlay.querySelector('#batch-input-files'));
        fromInput(overlay.querySelector('#batch-input-folder'));
        const drop = overlay.querySelector<HTMLElement>('.batch-drop:not(.is-down)');
        drop?.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('is-over'); });
        drop?.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop?.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            drop.classList.remove('is-over');
            readFields();
            void this.batchFilesFromDrop(e.dataTransfer).then(files => this.addBatchFiles(files));
        });
        if (!s) return;
        overlay.querySelectorAll<HTMLInputElement>('input[data-file]').forEach(box => box.addEventListener('change', () => {
            const item = s.items[Number(box.dataset.file)];
            if (item && !item.fixed) item.checked = box.checked;
            readFields();
            this.renderBatchKeepScroll();
        }));
        overlay.querySelectorAll<HTMLInputElement>('input[data-folder-check]').forEach(box => {
            box.indeterminate = box.getAttribute('aria-checked') === 'mixed';
            box.addEventListener('change', () => {
                const path = box.dataset.folderCheck ?? '';
                const prefix = `${path}/`;
                for (const item of s.items) if (item.path.startsWith(prefix) && !item.fixed) item.checked = box.checked;
                readFields();
                this.renderBatchKeepScroll();
            });
        });
        overlay.querySelectorAll<HTMLButtonElement>('[data-folder]').forEach(btn => btn.addEventListener('click', () => {
            const path = btn.dataset.folder ?? '';
            const open = btn.closest('[aria-expanded]')?.getAttribute('aria-expanded') === 'true';
            if (open) { s.full.delete(path); s.collapsed.add(path); } else { s.collapsed.delete(path); s.full.add(path); }
            readFields();
            this.renderBatchKeepScroll();
        }));
        overlay.querySelectorAll<HTMLButtonElement>('[data-more]').forEach(btn => btn.addEventListener('click', () => {
            s.full.add(btn.dataset.more ?? '');
            readFields();
            this.renderBatchKeepScroll();
        }));
        const search = overlay.querySelector<HTMLInputElement>('#batch-search');
        search?.addEventListener('input', () => {
            s.search = search.value;
            readFields();
            this.renderBatchKeepScroll();
            const again = document.querySelector<HTMLInputElement>('#batch-search');
            again?.focus();
            again?.setSelectionRange(again.value.length, again.value.length);
        });
        // The pick step's Continue: on once files are picked (picking itself goes on).
        const next = overlay.querySelector<HTMLButtonElement>('[data-act="next"]');
        if (next && s.step === 'pick') next.disabled = s.items.length === 0;
    },

    /** Redraw the review without losing the list's scroll. */
    renderBatchKeepScroll(): void {
        const top = document.querySelector('#batch-modal .batch-content')?.scrollTop ?? 0;
        this.renderBatchDialog();
        const content = document.querySelector('#batch-modal .batch-content');
        if (content) content.scrollTop = top;
    },

    /** While the pick step waits for the research to run: look every few seconds, the area turns into the picker. */
    watchBatchBridge(): void {
        const waiting = st?.step === 'pick' && !run && !!document.getElementById(DIALOG_ID);
        const link = this.researchOriginalsLink();
        if (!waiting || !link || this.researchBridgeUp(link.researchId)) {
            if (downTimer) { clearInterval(downTimer); downTimer = null; }
            return;
        }
        if (downTimer) return;
        downTimer = setInterval(() => {
            const l = this.researchOriginalsLink();
            if (!document.getElementById(DIALOG_ID) || !l || st?.step !== 'pick') {
                if (downTimer) { clearInterval(downTimer); downTimer = null; }
                return;
            }
            void this.askResearchBridge(l.researchId, ASK_TIMEOUT_MS).then(status => { if (status) this.renderBatchDialog(); });
        }, 4000);
    },

    /** Files of a drop: folders walked (their relative paths kept), loose files as they are. */
    async batchFilesFromDrop(dt: DataTransfer | null): Promise<{ file: File; path: string }[]> {
        if (!dt) return [];
        const entries = Array.from(dt.items ?? [])
            .map(item => (item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
            .filter((e): e is FileSystemEntry => !!e);
        if (entries.length === 0) return Array.from(dt.files ?? []).map(file => ({ file, path: file.name }));
        const out: { file: File; path: string }[] = [];
        for (const entry of entries) out.push(...await filesOfEntry(entry));
        return out;
    },

    // ==================== SENDING ====================

    async startBatchRun(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        const bridge = link ? parseLiveBridge(storedResearchBridge(link.researchId)?.base) : null;
        if (!s || !link || !bridge) return;
        const queue = s.items.filter(i => i.checked);
        const person = s.personId ? originalTargets({ personId: s.personId as PersonId }, DataManager.getData()).person ?? '' : '';
        const resume = s.resume;
        run = {
            id: resume?.id ?? newBatchId(), treeId: link.treeId, researchId: link.researchId, base: bridge.base,
            name: s.name.trim() || strings.batch.defaultName(new Date().toLocaleDateString(getCurrentLanguage())),
            person, personId: s.personId, note: s.note.trim(), queue, index: 0, total: queue.length,
            totalBytes: queue.reduce((sum, i) => sum + i.size, 0), doneBytes: 0, received: 0, skipped: 0, skippedAsked: 0, refused: [],
            current: '', paused: false, lost: false, cancelled: false, finished: false, hidden: false, result: null, resume: null,
        };
        s.step = 'progress';
        window.addEventListener('beforeunload', onLeave);
        this.batchRemember();
        this.renderBatchDialog();
        await this.batchLoop();
    },

    batchRemember(): void {
        const r = run;
        if (!r) return;
        writeUnfinished(r.treeId, {
            id: r.id, name: r.name, total: r.total, done: r.index, bytes: r.totalBytes, startedAt: new Date().toISOString(),
            ...(r.personId ? { personId: r.personId } : {}), ...(r.note ? { note: r.note } : {}),
        });
    },

    async batchLoop(): Promise<void> {
        const r = run;
        if (!r) return;
        let lastDraw = 0;
        const draw = (force = false): void => {
            if (r.hidden) { if (force || Date.now() - lastDraw > 1000) { lastDraw = Date.now(); this.refreshResearchSyncUi(); } return; }
            if (force || Date.now() - lastDraw > 250) { lastDraw = Date.now(); this.renderBatchDialog(); }
        };
        while (r.index < r.queue.length && !r.cancelled) {
            if (r.paused) {
                draw(true);
                await new Promise<void>(resolve => { r.resume = resolve; });
                r.resume = null;
                continue;
            }
            const item = r.queue[r.index];
            r.current = item.path;
            draw();
            const outcome = await this.batchSendOne(r, item);
            if (outcome === 'down') { r.paused = true; r.lost = true; continue; }
            if (outcome === 'again') continue;
            r.doneBytes += item.size;
            r.index++;
            if (r.index % 5 === 0 || r.index === r.queue.length) this.batchRemember();
        }
        // Closed with what came (cancelled too: what was sent stays and is sorted). Its address turned
        // down meanwhile (a new token, N37): paused like a file, Continue closes it at the new one.
        for (;;) {
            const closed = await this.batchClose(r);
            if (closed !== 'down' || r.cancelled) { r.result = closed === 'down' ? null : closed; break; }
            r.paused = true;
            r.lost = true;
            draw(true);
            await new Promise<void>(resolve => { r.resume = resolve; });
            r.resume = null;
        }
        r.finished = true;
        window.removeEventListener('beforeunload', onLeave);
        writeUnfinished(r.treeId, null);
        if (r.hidden || !document.getElementById(DIALOG_ID)) {
            const link = this.researchOriginalsLink();
            const archive = !!link && this.researchModeOf(link.researchId) === 'archive';
            this.showToast(strings.batch.doneToast(r.name, r.result?.inputs ?? r.received, r.refused.length), 8000, {
                closable: true, action: { label: strings.batch.summary, run: () => { r.hidden = false; this.openBatchOverlay(); this.renderBatchDialog(); } },
            });
            void archive;
        } else {
            draw(true);
        }
        this.refreshResearchSyncUi();
    },

    /** One file: asked whether the research has it (not a ZIP), else sent with the batch's headers. */
    async batchSendOne(r: Run, item: Item): Promise<'ok' | 'again' | 'down'> {
        let sha: string;
        try {
            sha = await sha256OfBlob(item.file);
        } catch {
            r.refused.push({ path: item.path, why: strings.material.whyUnreadable });
            return 'ok';
        }
        const url = `${r.base}/media/${sha}`;
        const zip = isZip(item.path);
        if (!zip) {
            try {
                const res = await fetchWithTimeout(url, ASK_TIMEOUT_MS);
                if (res.ok && mediaReplyId(await res.json().catch(() => null))) { r.skippedAsked++; return 'ok'; }
            } catch {
                return 'down';
            }
        }
        const headers: Record<string, string> = {
            'Content-Type': item.file.type || 'application/octet-stream',
            'X-Strom-Name': encodeURIComponent(item.path.split('/').pop() || 'file'),
            'X-Strom-Batch': r.id,
            'X-Strom-Path': batchPathHeader(item.path),
            ...(r.person ? { 'X-Strom-Person': r.person } : {}),
            ...(zip ? { 'X-Strom-Zip': '1' } : {}),
        };
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), Math.max(PUT_MIN_TIMEOUT_MS, item.size / 2000)) : null;
        try {
            const res = await fetch(withAppVersion(url), {
                method: 'PUT', mode: 'cors', credentials: 'omit', cache: 'no-store', headers, body: item.file, signal: ctl?.signal,
            });
            const body = await res.json().catch(() => null) as Record<string, unknown> | null;
            if (res.ok) {
                const z = body?.zip && typeof body.zip === 'object' ? body.zip as Record<string, unknown> : null;
                if (z) {
                    r.received += Array.isArray(z.inputs) ? z.inputs.length : 0;
                    r.skipped += Array.isArray(z.known) ? z.known.length : 0;
                    for (const x of Array.isArray(z.refused) ? z.refused.slice(0, 200) : []) {
                        const rec = x as Record<string, unknown>;
                        r.refused.push({ path: String(rec.path ?? item.path), why: String(rec.why ?? '') });
                    }
                } else if (body && typeof body.known === 'string') r.skipped++;
                else r.received++;
                return 'ok';
            }
            if (res.status === 503) {
                await sleep(retryAfterMs(res.headers.get('Retry-After')));
                return 'again';
            }
            // Closed meanwhile (24 h without a file): the rest goes as a new batch.
            if (res.status === 409) {
                r.id = newBatchId();
                this.batchRemember();
                return 'again';
            }
            // Turned down at this address: the research started again with a new token (it answers an
            // unknown token 404, N37) — paused until its new address comes. A 404 of its own (a person it
            // does not have) while it answers at this address: that file refused, the batch goes on.
            if (await this.batchAddressGone(r, res.status)) return 'down';
            r.refused.push({ path: item.path, why: typeof body?.error === 'string' ? body.error.slice(0, 200) : `HTTP ${res.status}` });
            return 'ok';
        } catch {
            return 'down';
        } finally {
            if (timer) clearTimeout(timer);
        }
    },

    /**
     * A 401 / 403 / 404 from the bridge: is it the address (its token) that is turned down?
     * Asked at the same address's `/status`: answering there for this research, the refusal
     * was the research's own matter about this request, never a reason to pause (no loop).
     */
    async batchAddressGone(r: Run, status: number): Promise<boolean> {
        if (status !== 401 && status !== 403 && status !== 404) return false;
        try {
            const res = await fetchWithTimeout(`${r.base}/status?poll=1`, ASK_TIMEOUT_MS);
            if (!res.ok) return true;
            return sanitizeLiveStatus(await res.json().catch(() => null))?.treeId !== r.researchId;
        } catch {
            return true;
        }
    },

    /** `POST /batch/<id>/done`: the research closes the batch and makes its tasks ('down': its address turned down). */
    async batchClose(r: Run): Promise<DoneReply | null | 'down'> {
        const body = JSON.stringify({ name: r.name, files: r.received + r.skipped + r.skippedAsked + r.refused.length,
            ...(r.person ? { person: r.person } : {}), ...(r.note ? { note: r.note } : {}) });
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch(withAppVersion(`${r.base}/batch/${encodeURIComponent(r.id)}/done`), {
                    method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body,
                });
                if (res.status === 503) { await sleep(retryAfterMs(res.headers.get('Retry-After'))); continue; }
                if (!res.ok) return await this.batchAddressGone(r, res.status) ? 'down' : null;
                const j = await res.json().catch(() => null) as Record<string, unknown> | null;
                const n = (v: unknown): number => (typeof v === 'number' && v >= 0 ? Math.floor(v) : 0);
                return j ? { inputs: n(j.inputs), known: n(j.known), refused: n(j.refused), tasks: Array.isArray(j.tasks) ? j.tasks.length : 0 } : null;
            } catch {
                return null;
            }
        }
        return null;
    },

    resumeBatchRun(): void {
        if (!run) return;
        // The bridge's address now: the research may have started again since the pause (a new token,
        // N20) — the rest goes there, without choosing the files again (those it has are skipped).
        const bridge = parseLiveBridge(storedResearchBridge(run.researchId)?.base);
        if (bridge) run.base = bridge.base;
        run.paused = false;
        run.lost = false;
        run.resume?.();
        this.renderBatchDialog();
    },

    async cancelBatchRun(): Promise<void> {
        const r = run;
        if (!r) return;
        const ok = await this.showConfirm(strings.batch.cancelConfirm(r.received), strings.batch.cancel, { confirmLabel: strings.batch.cancel, variant: 'danger' });
        if (!ok) return;
        r.cancelled = true;
        r.paused = false;
        r.resume?.();
    },

    /** Hide the window while it sends: the block in ⋯ → Research says how far it is, with "Show". */
    hideBatchDialog(): void {
        if (run) run.hidden = true;
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        this.refreshResearchSyncUi();
    },

    /** Close / Esc: from the review on it asks first; while sending it hides. */
    async cancelBatchDialog(): Promise<void> {
        if (run && !run.finished) { this.hideBatchDialog(); return; }
        if (!run && st && (st.step === 'check' || st.step === 'send') && st.items.some(i => i.checked)) {
            const ok = await this.showConfirm(strings.batch.closeConfirm, strings.batch.title, { confirmLabel: strings.buttons.close, cancel: strings.batch.closeKeep });
            if (!ok) return;
        }
        this.closeBatchDialog();
    },

    closeBatchDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        if (downTimer) { clearInterval(downTimer); downTimer = null; }
        if (run?.finished) run = null;
        st = null;
    },

    // ==================== THE BLOCK'S LINE ====================

    /** The research block's line for batches: sending (hidden), unfinished, or how far the research sorted ('' for none). */
    batchLineHtml(): string {
        const link = this.researchOriginalsLink();
        if (!link) return '';
        const b = strings.batch;
        const line = (text: string, links: string, warn = false): string =>
            `<div class="research-sync-line2 batch-line${warn ? ' is-warn' : ''}">${warn ? '<span class="media-warn-dot" aria-hidden="true"></span>' : '<span class="media-ring" aria-hidden="true"></span>'}`
            + `<span class="research-sync-line2-text">${esc(text)}</span>${links}</div>`;
        const btn = (label: string, call: string): string =>
            `<button type="button" class="research-sync-link" onclick="window.Strom.UI.${call}">${esc(label)}</button>`;
        if (run && !run.finished && run.treeId === link.treeId) {
            return line(`${b.sendingTitle(run.name)} · ${b.sendingSub(run.index, run.total)}`, btn(b.show, 'showBatchDialog()'));
        }
        const rec = readUnfinished(link.treeId);
        if (rec) {
            return line(`${b.unfinishedTitle(rec.name)} · ${b.unfinishedSub(rec.done, rec.total)}`,
                btn(b.resume, 'showBatchDialog()') + btn(b.discard, 'discardUnfinishedBatch()'), true);
        }
        const batches = this.researchStatusOf(link.researchId)?.batches ?? [];
        const pending = batches.find(x => x.state === 'closed' && x.sorted < x.files);
        if (!pending) return '';
        const archive = this.researchModeOf(link.researchId) === 'archive';
        const open = this.researchLinkAvailable('open') ? btn(b.overview, 'researchSyncAction(\'openResearch\')') : '';
        return line(archive ? b.archiveWaiting(pending.name, pending.files - pending.sorted) : b.sortedLine(pending.name, pending.sorted, pending.files), open);
    },

    discardUnfinishedBatch(): void {
        const link = this.researchOriginalsLink();
        if (link) writeUnfinished(link.treeId, null);
        this.refreshResearchSyncUi();
    },
});

/** Every folder path of the files (for "Expand all"). */
function batchFolderPaths(items: readonly Item[]): string[] {
    const out = new Set<string>();
    for (const i of items) {
        const parts = i.path.split('/');
        for (let k = 1; k < parts.length; k++) out.add(parts.slice(0, k).join('/'));
    }
    return [...out];
}
