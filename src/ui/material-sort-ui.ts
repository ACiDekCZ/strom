/**
 * Sort with the agent (spec 102 §13): the dialog that sends files to the
 * research's agent, the sorting's progress, and the agent's proposal.
 *
 * The agent uses the subscription or credit and what it opens goes to the
 * model provider: a sorting is sent ONLY by an explicit click on "Sort with
 * the agent" in the dialog (or Ctrl/⌘+Enter there), after its sentences say
 * so. Nothing starts one by itself — not a finished batch, not a reload, not
 * coming back to the window. A remembered sorting is only asked about (GET).
 *
 * The proposal writes nothing until accepted (O2): the tree's files with the
 * tree in one undo step, material outside the tree through the bridge. What
 * a person set (title, date, kind) stays unless the proposal is used on purpose.
 */

import { DataManager } from '../data.js';
import { allMedia } from '../media.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { Attachment, MaterialKind, MediaPlace, PersonId } from '../types.js';
import {
    MaterialItem, MaterialError, SortJob, SortLink, SORT_MAX_FILES, SORT_MAX_TEXT, type EditRequest,
    startMaterialSort, fetchMaterialSort, cancelMaterialSort, fetchMaterialSortRun, cancelMaterialSortRun, fetchMaterial, cachedMaterialList,
    type SortRunState,
    getCachedThumb, fileExt, mergeIntoCache, materialErrorText, materialKindLabel, isPortraitCandidate, materialType,
} from '../materials.js';
import { overviewItems, nameWithoutYears } from '../materials-overview.js';
import {
    sortNeedy, sortRows, sortRowProposes, sortWrite, sortTreeIndex, sortChip, parseSortRevert, sortUnrelatedHideable,
    sortNext, sortLeftMap, sortCopyOf, sortStripState, sortRunBatches, sortProposalCounts, sortLeftIds, sortBackRow,
    sortJobsMerged, sortRunView, sortRunAdvance, sortRunEnded, sortRunCancelled, sortRunRest, sortFinishedSorts, sortRunContinued, type SortRunView,
    sortJobWithout, sortRememberedWithout,
    type SortNext, type SortNextOpts, type SortRow, type SortChoice, type SortChip, type SortRevert, type SortWrite, type SortCounts, type SortStripState,
} from '../material-sort.js';
import { researchPersonRef } from '../research-link.js';
import { PersonPicker } from '../person-picker.js';
import { researchAutoState, patchResearchAutoState, type ResearchSortRemembered, type ResearchAutoState, type ResearchSortLeft } from '../research-device.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { materialDialog, button, type MaterialDialog } from './material-actions-ui.js';
import { treeRecords, materialsWindowOpen } from './materials-window.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';
import { runBusy } from './busy.js';
import { canEditPortrait } from './portrait-actions-ui.js';

/** Asking about a sorting at work: every 2 s, 10 s while the page is hidden, 15 s while the bridge is down (spec 102 §13). */
const POLL_MS = 2_000;
const POLL_HIDDEN_MS = 10_000;
const POLL_DOWN_MS = 15_000;
const PREVIEWS = 6;
/** Over this many batches the dialog says the cost loudly and offers First 50 only (spec 102 §2, §12). */
const SORT_MANY_BATCHES = 10;

/** What the dialog sorts (spec 102 §2): every unsorted file, the selected ones, a batch's, the first 50 only. */
type SortScope = 'all' | 'selection' | 'batch' | 'first' | 'rest';
const TOAST_MS = 8000;

/** Whether sorting is offered: on, offered but off (not running), only said (an older research), or not at all. */
export type SortGate = 'on' | 'offRun' | 'older' | null;

/** What a strip or a selection would send. */
export interface SortTarget {
    items: MaterialItem[];
    /** The batch's name (the dialog's "from the batch …"). */
    batch: string | null;
    /** Every file without a title or a person (the window's whole view), closed with its ×. */
    whole?: boolean;
    /** The files selected by hand: sent as selected, finished ones too. */
    selection?: boolean;
    /**
     * What is left of a run (Try again, Continue; spec 102 §3): the files of
     * its batches that did not run, sent as the run sent them; the new
     * batches join the proposal still open.
     */
    rest?: boolean;
    /** What was said about the files before (the dialog starts with it). */
    text?: string;
}

/**
 * The one strip of sorting over the Materials window (spec 102 §1): its
 * state, its markup, and the files its actions take.
 */
export interface SortStripView {
    /** A–F, a sorting ended without a proposal, a batch of a run that did not run, a run stopped elsewhere (spec 102 §3). */
    state: SortStripState | 'ended' | 'error' | 'stopped' | null;
    html: string;
    /** The strip's modifier: '' (at work, waiting), is-done (E, F), is-off (not running, read-only, older), is-error (failed). */
    mod: '' | 'is-done' | 'is-off' | 'is-error';
    /** What Sort with the agent… / Sort the next… sends (the dialog decides). */
    next: MaterialItem[];
    /** What Go through by hand opens: A the files to sort, E the ones the agent left unassigned. */
    review: MaterialItem[];
}

/** Proposal closed and nothing left (F): said this long, then the strip goes (spec 102 §1). */
const ALL_SORTED_MS = 4000;
let allSortedTimer: ReturnType<typeof setTimeout> | null = null;

/** A chip for counting only (the counts never show a chip). */
const countChip = (link: SortLink): SortChip => ({ link, place: null, person: null, kind: 'person', label: '' });

/** The open proposal's redraw with the files as remembered now (a file hidden or restored meanwhile). */
let proposalRedraw: (() => void) | null = null;

/**
 * The sorting asked about now (one per page: the active tree's), by its key
 * (sortKey). A run of batches (spec 102 §3): `run` as the research said it
 * last, `jobs` the finished batches' sortings (read once each), `job` their
 * proposals merged into one.
 */
let watch: {
    treeId: string; id: string; timer: ReturnType<typeof setTimeout> | null; job: SortJob | null; busy: boolean;
    run?: SortRunState | null; jobs?: Map<string, SortJob>;
    /** Waiting for the bridge to come up (asked at once when it does). */
    down?: boolean;
    /** The proposal's earlier sortings (Try again, Continue: spec 102 §3), read once each; null: the research no longer has it. */
    earlier?: Map<string, SortJob | null>;
    /** Why a run's batch did not run (its sorting's reason), read once each. */
    reasons?: Map<string, string>;
} | null = null;

/**
 * The finished sortings a proposal had before Try again or Continue (spec
 * 102 §3), read once each; `missing`: one could not be read now (asked again
 * with the next answer).
 */
async function earlierJobs(w: NonNullable<typeof watch>, base: string, ids: readonly string[] | undefined): Promise<{ jobs: SortJob[]; missing: boolean }> {
    if (!ids?.length) return { jobs: [], missing: false };
    const got = (w.earlier ??= new Map());
    let missing = false;
    for (const id of ids) {
        if (got.has(id)) continue;
        const one = await fetchMaterialSort(base, id);
        if (watch !== w) return { jobs: [], missing: true };
        if (one.ok) got.set(id, one.value);
        else if (one.error.status === 404) got.set(id, null);
        else missing = true;
    }
    return { jobs: ids.map(id => got.get(id)).filter((j): j is SortJob => !!j), missing };
}

/** The open proposal takes in what a run's batch just finished brought (spec 102 §3), and redraws its run line. */
let proposalRun: ((job: SortJob) => void) | null = null;

/** The key a sorting is watched by: its run (spec 102 §3), else its sorting. */
function sortKey(r: Pick<ResearchSortRemembered, 'id' | 'run'>): string {
    return r.run?.id ?? r.id;
}

/** What is known now of the remembered sorting (a run's batches merged), null before the first answer. */
function watchedJob(r: ResearchSortRemembered | null): SortJob | null {
    const job = r && watch?.id === sortKey(r) ? watch.job : null;
    // Files deleted for good meanwhile (spec 102 §12): their proposals are not shown.
    return job && r?.gone?.length ? sortJobWithout(job, r.gone) : job;
}

/** Where the remembered run is (spec 102 §3): as the research said it last, else as remembered. */
function runViewOf(r: ResearchSortRemembered | null): SortRunView | null {
    if (!r?.run?.id) return null;
    return sortRunView(r.run, watch?.id === r.run.id ? watch.run ?? null : null);
}

/**
 * A run's progress bar (spec 102 §3): one for the whole run, its ticks where
 * one batch ends and the next starts. Without the research's word on the
 * files judged in the batch at work: a progress without a number.
 */
function runBarHtml(v: SortRunView, label: string): string {
    if (v.running && !v.starting && v.batchDone === undefined) {
        return `<span class="mw-sort-bar is-run is-indeterminate" role="progressbar" aria-label="${esc(label)}"><span></span></span>`;
    }
    const pct = v.files ? Math.round((v.filesDone / v.files) * 1000) / 10 : 0;
    const ticks = v.marks.map(m => `<i style="left: ${m}%"></i>`).join('');
    return `<span class="mw-sort-bar is-run" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${v.files}" aria-valuenow="${v.filesDone}"><span style="width: ${pct}%"></span>${ticks}</span>`;
}

/** The strip's line of a run at work (spec 102 §3): which batch, how far in it, or that it waits. */
function runLabel(v: SortRunView): string {
    const s = strings.materials.agentSort;
    if (v.waiting) return s.runWaiting(v.batch, v.batches);
    if (v.starting) return s.runStarting(v.batch, v.batches);
    return v.batchDone !== undefined ? s.runBatch(v.batch, v.batches, v.batchDone, v.batchFiles) : s.runBatchFiles(v.batch, v.batches, v.batchFiles);
}

/**
 * Why a run's next batch waits (spec 102 §3, the research's `waiting`): the
 * app's readings, the readers' limit or another word of theirs, and when it
 * starts by itself.
 */
function runWaitText(w: { why: string; retry?: number }): string {
    const s = strings.materials.agentSort;
    const why = w.why === 'read.app' ? s.waitApp : w.why === 'limit' ? s.errLimit : w.why === 'archive' ? s.errNone : s.errNotReady(w.why);
    if (!w.retry) return why;
    const min = Math.max(1, Math.ceil(w.retry / 60));
    return `${why} ${min >= 90 ? s.waitRetry(Math.round(min / 60), true) : s.waitRetry(min, false)}`;
}

/** Why a batch of a run did not run, in words (spec 102 §3): the readers' limit, else the agent did not finish it. */
function runErrorText(code: string): string {
    const s = strings.materials.agentSort;
    return code === 'limit' ? s.errLimit : s.batchErr;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** A preview: the research's cached one, else the file's extension in letters. */
export function previewEl(treeId: string, item: MaterialItem | null, cls: string): HTMLElement {
    const box = h('span', cls);
    box.setAttribute('aria-hidden', 'true');
    const name = item?.name ?? '';
    box.textContent = (fileExt(name) || '?').slice(0, 4).toUpperCase();
    const sha = item?.file?.sha;
    if (sha) {
        void getCachedThumb(treeId, sha, 256).then(blob => {
            if (!blob || !box.isConnected) return;
            const img = h('img');
            img.alt = '';
            img.src = URL.createObjectURL(blob);
            img.onload = () => URL.revokeObjectURL(img.src);
            box.replaceChildren(img);
        }).catch(() => { /* letters stay */ });
    }
    return box;
}

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

function sortErrorText(err: MaterialError, agent: boolean): string {
    const s = strings.materials.agentSort;
    switch (err.code) {
        case 'sort.none': return s.errNone;
        case 'sort.limit': return s.errLimit;
        case 'sort.queue': return s.errQueue;
        case 'sort.not-ready': {
            const why = typeof err.params?.why === 'string' ? err.params.why : '';
            return s.errNotReady(why.slice(0, 200));
        }
    }
    return materialErrorText(err, agent);
}

/** The sorting is still at work (queued or working). */
function running(job: SortJob | null): boolean {
    return !job || job.state === 'queued' || job.state === 'working';
}

/** The sorting left a proposal (done, or cancelled after some proposals and kept). */
function hasProposal(job: SortJob | null): boolean {
    return !!job && (job.state === 'done' || (job.state === 'cancelled' && job.proposals.length > 0));
}

/** A sorting's cancel asked and not answered yet (one request however often clicked). */
let cancelAsking = false;

export const materialSortMethods = uiModule({
    // ==================== GATES ====================

    /**
     * Sort with the agent here (spec 102 §13, Q3): a research with its agent
     * (never the Strom archive nor a research waiting for its agent), on a
     * computer, listing materials. Without `material.sort`: only said (older);
     * the bridge down: offered, off.
     */
    materialSortGate(): SortGate {
        const mc = this.materialsContext();
        if (!mc || !mc.agent || !mc.caps.list) return null;
        if (!mc.caps.sort) return 'older';
        return mc.caps.bridgeUp ? 'on' : 'offRun';
    },

    /**
     * Files deleted for good (spec 102 §9, §12): they leave the remembered
     * sorting — its batches waiting, its proposal and what was decided here.
     */
    materialSortDropFiles(gone: readonly string[]): void {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r || !gone.length) return;
        const next = sortRememberedWithout(r, gone);
        if (next) patchResearchAutoState(mc.treeId, { materialSort: next });
    },

    /** The sorting remembered for the active tree (null: none). */
    materialSortRemembered(): ResearchSortRemembered | null {
        const mc = this.materialsContext();
        return mc ? researchAutoState(mc.treeId).materialSort ?? null : null;
    },

    /** A sorting is at work now (a new one waits until it ends). */
    materialSortBusy(): boolean {
        const r = this.materialSortRemembered();
        if (!r || r.ended) return false;
        // A run that ended (a batch did not run, stopped, cancelled here): nothing at work.
        if (r.run?.error || r.run?.stopped || r.run?.cancelled) return false;
        return watch?.id === sortKey(r) ? running(watch.job) : true;
    },

    /**
     * The sorting on the research menu's Materials row (spec 102 §1): 'run'
     * while the agent works and nothing waits (B, a green dot), 'ready' while
     * proposals wait (C, D: the waiting dot); none once the proposal is
     * closed. Asking about a remembered sorting starts here too (GET only).
     */
    materialSortMenuMark(): 'run' | 'ready' | null {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r || r.ended || !this.materialSortGate()) return null;
        this.materialSortWatch();
        const job = watchedJob(r);
        const pending = job ? this.materialSortCounts(mc.treeId, r, job).open : 0;
        if (pending > 0) return 'ready';
        return running(job) ? 'run' : null;
    },

    /** A proposal's rows counted as the proposal window shows them (spec 102 §1, §5). */
    materialSortCounts(treeId: string, r: ResearchSortRemembered, job: SortJob): SortCounts {
        const byId = this.materialSortItemMap(treeId);
        return sortProposalCounts(sortRows(job, id => byId.get(id) ?? null, countChip), r.decided);
    },

    /**
     * Close the proposal (spec 102 §6): what is waiting is not written, the
     * files the agent left unassigned are remembered as such (not sent
     * again), the strip says what was done. Accepted rows stay; the app's
     * Undo still undoes them, the proposal window does not come back.
     */
    materialSortForget(): void {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r) return;
        const job = watchedJob(r);
        const patch: Partial<ResearchAutoState> = { materialSort: undefined };
        if (job && hasProposal(job)) {
            const byId = this.materialSortItemMap(mc.treeId);
            const rows = sortRows(job, id => byId.get(id) ?? null, countChip);
            const c = sortProposalCounts(rows, r.decided);
            const at = new Date().toISOString();
            const left: Record<string, ResearchSortLeft> = { ...(researchAutoState(mc.treeId).sortLeft ?? {}) };
            for (const x of sortLeftIds(rows, job.unproposed, r.decided)) left[x.id] = { at, ...(x.why ? { why: x.why } : {}) };
            if (Object.keys(left).length) patch.sortLeft = left;
            patch.sortClosed = { at, handled: c.accepted + c.rejected, unassigned: c.unassigned, files: c.files, batches: r.run?.batches.length ?? 1 };
        }
        patchResearchAutoState(mc.treeId, patch);
        this.materialSortStop();
        this.refreshMaterialsWindow();
    },

    /**
     * "Close the proposal…" before all of it is handled (spec 102 §6): asked
     * first; Keep (or Esc) leaves it as it is (`keep`: what comes back then).
     */
    materialSortCloseAsk(keep?: () => void): void {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r) return;
        const s = strings.materials.agentSort;
        const job = watchedJob(r);
        const n = job ? this.materialSortCounts(mc.treeId, r, job).open : 0;
        let closing = false;
        const dialog = materialDialog({ title: s.closeAsk, modifier: 'sortclose', onClose: () => { if (!closing) keep?.(); } });
        dialog.body.appendChild(h('p', 'mdlg-text', s.closeText(n)));
        const stay = button(s.closeKeep, 'msp-close-keep', () => dialog.close());
        dialog.foot.append(stay, button(s.closeGo, 'is-primary msp-close-go', () => {
            closing = true;
            dialog.close();
            this.materialSortForget();
        }));
        stay.focus();
    },

    /**
     * What the agent left unassigned and which files are copies of an older
     * one (spec 102 §4.2, §4.4), over every file known here: as the research
     * says it behind its gates (`material.left`, `material.sameAs`), else as
     * this app remembers it (closed proposals) and by the files' hashes.
     */
    materialSortMarks(all: readonly MaterialItem[]): { left: Map<string, { why?: string; said?: string }>; copyOf: Map<string, string> } {
        const mc = this.materialsContext();
        const app = mc ? researchAutoState(mc.treeId).sortLeft ?? {} : {};
        return {
            left: sortLeftMap(all, { research: !!mc?.caps.left, app }),
            copyOf: sortCopyOf(all, !!mc?.caps.sameAs),
        };
    },

    /**
     * What the next sorting sends (spec 102 §4): `items` the files it may take
     * (the whole archive, a batch's, the selected ones), `all` every file known
     * (copies and what the agent left are found over them), `alsoLeft` files a
     * proposal still open leaves unassigned.
     */
    materialSortNext(items: readonly MaterialItem[], opts: { scope?: SortNextOpts['scope']; withText?: boolean; all?: readonly MaterialItem[]; alsoLeft?: readonly string[] } = {}): SortNext {
        const mc = this.materialsContext();
        const marks = this.materialSortMarks(opts.all ?? items);
        for (const id of opts.alsoLeft ?? []) if (!marks.left.has(id)) marks.left.set(id, {});
        return sortNext(items, {
            scope: opts.scope ?? 'all', left: marks.left, copyOf: marks.copyOf, sourceOf: !!mc?.caps.sourceOf,
            ...(opts.withText ? { withText: true } : {}),
        });
    },

    /** The items the window shows (the research's list with the tree's files), by the research's I…. */
    materialSortItemMap(treeId: string): Map<string, MaterialItem> {
        const items = overviewItems(cachedMaterialList(treeId), treeRecords(true));
        const out = new Map<string, MaterialItem>();
        for (const i of items) if (i.file?.id && !out.has(i.file.id)) out.set(i.file.id, i);
        return out;
    },

    // ==================== THE DIALOG (13d) ====================

    /**
     * What is sent and what it means, before anything is sent. Only the
     * dialog's own button (or Ctrl/⌘+Enter in it) sends the sorting.
     */
    openSortDialog(target: SortTarget): void {
        const mc = this.materialsContext();
        if (!mc || this.materialSortGate() !== 'on' || this.materialSortBusy()) return;
        const s = strings.materials.agentSort;
        // The research keeps a run of batches (material.sortRun); an older one takes one batch, the rest is for the next.
        const runs = !!mc.caps.sortRun;
        const all = [...this.materialSortItemMap(mc.treeId).values()];
        // The scopes (spec 102 §2): the one it came from first; every file without a title or a person always.
        // What is left of a run (Try again, Continue): only that, it goes on with the proposal still open.
        const base: SortScope = target.rest ? 'rest' : target.selection ? 'selection' : target.batch ? 'batch' : 'all';
        const plans = new Map<string, SortNext>();
        const planOf = (scope: SortScope, withText: boolean): SortNext => {
            const key = `${scope}:${withText}`;
            const known = plans.get(key);
            if (known) return known;
            const from = scope === 'rest' ? sortNeedy(target.items) : scope === 'selection' || scope === 'batch' ? target.items : all;
            // A batch's files come with the target: over them as over everything. What is left of a run goes as it went.
            let plan = this.materialSortNext(from, { scope: scope === 'selection' || scope === 'rest' ? 'selection' : 'all', all, withText });
            if (!runs || scope === 'first') {
                const first = plan.batches.slice(0, 1);
                plan = { ...plan, batches: first, over: plan.send.length - (first[0]?.length ?? 0) };
            }
            plans.set(key, plan);
            return plan;
        };
        const filesOf = (p: SortNext) => p.batches.flat();
        // The research cuts a run 50 to a batch, in the order sent.
        const batchesOf = (p: SortNext) => sortRunBatches(filesOf(p).map(i => i.file!.id)).length;
        const candidates = (p: SortNext) => p.send.length + p.skipped.copies.length + p.skipped.text.length + p.skipped.sources.length + p.skipped.left.length;
        if (!filesOf(planOf(base, false)).length && !filesOf(planOf(base, true)).length) return;
        const scopes: SortScope[] = base === 'all' || base === 'rest' ? [base] : [base, 'all'];
        // Many batches: First 50 only, to try (§12).
        if (runs && scopes.includes('all') && batchesOf(planOf('all', false)) > SORT_MANY_BATCHES) scopes.splice(scopes.indexOf('all') + 1, 0, 'first');
        const marks = this.materialSortMarks(all);
        const flagged = (i: MaterialItem) => marks.copyOf.has(i.file!.id) || (!!mc.caps.sourceOf && !!i.file!.uses?.of?.length);

        let scope: SortScope = base;
        let withText = false;
        let open = false;
        const dialog = materialDialog({ title: s.title(0), sub: ' ', modifier: 'sort' });
        dialog.box.classList.add('mdlg--sort');
        const title = dialog.box.querySelector<HTMLElement>('.mdlg-title')!;
        const sub = dialog.box.querySelector<HTMLElement>('.mdlg-sub')!;

        const set = h('fieldset', 'mdlg-radios mdlg-scopes');
        set.appendChild(h('legend', '', s.scopeLegend));
        for (const sc of scopes) {
            const off = planOf(sc, false);
            const nb = batchesOf(off);
            const label = h('label', 'mdlg-scope sel-opt');
            label.dataset.selForm = 'tile';
            label.dataset.scope = sc;
            const input = h('input');
            input.type = 'radio';
            input.name = 'mdlg-sort-scope';
            input.value = sc;
            input.checked = sc === scope;
            input.addEventListener('change', () => { if (input.checked) { scope = sc; draw(); } });
            const name = h('span', 'mdlg-scope-name', sc === 'all' ? s.scopeAll : sc === 'selection' ? s.scopeSel : sc === 'batch' ? s.scopeBatch(target.batch ?? '')
                : sc === 'rest' ? s.scopeRest : s.scopeFirst);
            const subText = sc === 'first' ? s.scopeFirstSub : runs && nb > SORT_MANY_BATCHES ? s.scopeRun(nb) : '';
            if (subText) name.appendChild(h('span', 'mdlg-scope-sub', subText));
            const n = sc === 'first' ? filesOf(off).length : candidates(off);
            label.append(input, name, h('span', 'mdlg-scope-n', n.toLocaleString(getCurrentLanguage())));
            set.appendChild(label);
        }
        dialog.body.appendChild(set);

        const strip = h('div', 'mdlg-sort-previews');
        const plan = h('p', 'mdlg-note mdlg-sort-note mdlg-sort-plan');
        const over = h('p', 'mdlg-note mdlg-sort-over');
        const big = h('p', 'mdlg-note mdlg-sort-note is-warn mdlg-sort-big');
        const warn = h('div', 'mdlg-warn mdlg-sort-warn');
        const left = h('div', 'mdlg-left');
        dialog.body.append(strip, plan, over, big, warn, left);

        const field = h('label', 'mdlg-sort-know');
        field.appendChild(h('span', 'mdlg-sort-know-label', s.know));
        const area = h('textarea', 'mdlg-sort-text');
        area.maxLength = SORT_MAX_TEXT;
        area.rows = 3;
        area.placeholder = s.knowPh;
        area.id = 'mdlg-sort-text';
        area.value = (target.text ?? '').slice(0, SORT_MAX_TEXT);
        const hint = h('span', 'mdlg-check-hint', s.knowHint);
        hint.id = 'mdlg-sort-hint';
        area.setAttribute('aria-describedby', hint.id);
        field.append(area, hint);
        dialog.body.appendChild(field);
        dialog.body.appendChild(h('p', 'mdlg-text', s.will));
        dialog.body.appendChild(h('p', 'mdlg-text', s.keep));
        const note = h('p', 'mdlg-note mdlg-sort-note');
        const cost = h('span', 'mdlg-sort-cost');
        note.append(h('span', 'mdlg-sort-privacy', s.privacy), document.createTextNode(' '), cost);
        dialog.body.appendChild(note);

        const go = button(s.go, 'is-primary mdlg-sort-go', () => void run());
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
        dialog.box.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!go.disabled) go.click();
            }
        });

        // What is not sent (§2, §4): one sentence; Details says each reason with its action.
        const drawLeft = (p: SortNext, text: number) => {
            left.replaceChildren();
            const k = p.skipped;
            const total = k.copies.length + k.text.length + k.sources.length + k.left.length;
            left.hidden = !total && !text;
            if (total) {
                const head = h('div', 'mdlg-left-head');
                const sum = h('span', 'mdlg-left-sum');
                sum.appendChild(h('b', '', open ? s.leftHead(total) : `${s.leftHead(total)}:`));
                if (!open) sum.append(' ', s.leftShort(k.copies.length, k.text.length, k.sources.length, k.left.length));
                const toggle = h('button', 'link-button mdlg-left-toggle', open ? s.detailsHide : s.details);
                toggle.type = 'button';
                toggle.setAttribute('aria-expanded', String(open));
                toggle.setAttribute('aria-controls', 'mdlg-left-list');
                toggle.addEventListener('click', () => {
                    open = !open;
                    draw();
                    left.querySelector<HTMLElement>('.mdlg-left-toggle')?.focus();
                });
                head.append(sum, toggle);
                const list = h('div', 'mdlg-left-list');
                list.id = 'mdlg-left-list';
                list.hidden = !open;
                const files = (items: MaterialItem[]) => {
                    const names = items.slice(0, 5).map(i => i.name);
                    if (items.length > 5) names.push(s.more(items.length - 5));
                    list.appendChild(h('span', 'mdlg-left-files', names.join(' · ')));
                };
                const row = (text: string, act?: HTMLElement) => list.append(h('span', '', text), act ?? h('span'));
                const link = (label: string, cls: string, act: () => void) => {
                    const b = h('button', `link-button ${cls}`, label);
                    b.type = 'button';
                    b.addEventListener('click', act);
                    return b;
                };
                const readOnly = DataManager.isReadOnly();
                if (k.copies.length) {
                    // The copies hidden as duplicates; the dialog comes back after.
                    row(s.leftCopies(k.copies.length), readOnly ? undefined : link(s.hideCopies(k.copies.length), 'mdlg-left-hide',
                        () => { dialog.close(); this.materialAction('hide', k.copies, { where: 'window', hideReason: 'duplicate', back: () => this.openSortDialog(target) }); }));
                    files(k.copies);
                }
                if (k.text.length) { row(s.leftText(k.text.length)); files(k.text); }
                if (k.sources.length) row(s.leftSources(k.sources.length));
                if (k.left.length) {
                    row(s.leftLeft(k.left.length), materialsWindowOpen()
                        ? link(s.showLeft, 'mdlg-left-show', () => { dialog.close(); this.mwShowLeft(); }) : undefined);
                }
                left.append(head, list);
            }
            if (text) {
                const check = h('label', 'mdlg-check mdlg-sort-withtext');
                const input = h('input');
                input.type = 'checkbox';
                input.checked = withText;
                input.addEventListener('change', () => {
                    withText = input.checked;
                    draw();
                    left.querySelector<HTMLInputElement>('.mdlg-sort-withtext input')?.focus();
                });
                const words = h('span', 'mdlg-check-text');
                words.append(h('span', '', s.withText(text)), h('span', 'mdlg-check-hint', s.withTextHint));
                check.append(input, words);
                left.appendChild(check);
            }
        };

        const draw = () => {
            const p = planOf(scope, withText);
            const off = planOf(scope, false);
            const files = filesOf(p);
            const n = files.length;
            const nb = batchesOf(p);
            title.textContent = s.title(n);
            sub.textContent = scope === 'selection' ? s.what(n, null) : scope === 'rest' ? s.what(n, target.batch)
                : scope === 'batch' ? s.what(candidates(off), target.batch) : s.stripWhole(candidates(planOf('all', false)));
            strip.replaceChildren();
            for (const item of files.slice(0, PREVIEWS)) {
                const tile = previewEl(mc.treeId, item, 'mdlg-sort-preview');
                tile.title = item.title;
                strip.appendChild(tile);
            }
            if (n > PREVIEWS) strip.appendChild(h('span', 'mdlg-sort-more', s.more(n - PREVIEWS)));
            plan.textContent = nb > 1 ? s.plan(n, nb) : s.planOne(n);
            plan.hidden = !n;
            // Over 30 batches the rest is for the next sorting; an older research takes 50 at once.
            over.textContent = scope === 'first' || !p.over ? '' : runs ? s.overRun(n) : s.olderRun;
            over.hidden = !over.textContent;
            big.textContent = nb > SORT_MANY_BATCHES ? s.costBig(nb) : '';
            big.hidden = !big.textContent;
            // A selection sends everything selected; copies and sources' files are said.
            const odd = scope === 'selection' ? files.filter(flagged).length : 0;
            warn.replaceChildren(...(odd ? [h('p', 'mdlg-warn-text', s.selWarn(odd))] : []));
            warn.hidden = !odd;
            drawLeft(p, off.skipped.text.length);
            cost.textContent = nb > SORT_MANY_BATCHES ? '' : nb > 1 ? s.costRun(nb) : s.cost;
            const label = nb > 1 ? s.goRun(nb) : s.go;
            go.innerHTML = researchBridgeActionLabel(label, 'material-sort');
            go.disabled = !n;
        };
        draw();
        area.focus();

        let sent = false;
        const run = async () => {
            if (sent) return;
            const now = this.materialsContext();
            if (!now?.base || !now.caps.sort || !now.caps.bridgeUp) {
                dialog.error(s.offRun);
                return;
            }
            const ids = filesOf(planOf(scope, withText)).map(i => i.file!.id);
            const batches = sortRunBatches(ids);
            const many = batches.length > 1;
            if (!ids.length) return;
            if (many && !now.caps.sortRun) {
                dialog.error(s.older);
                return;
            }
            sent = true;
            dialog.busy(true, strings.busy.sending);
            dialog.error(null);
            const text = area.value.trim().slice(0, SORT_MAX_TEXT);
            const res = await startMaterialSort(now.base, { ids: batches.flat(), text, ...(many ? { run: true } : {}) });
            dialog.busy(false);
            if (!res.ok) {
                sent = false;
                dialog.error(sortErrorText(res.error, now.agent));
                return;
            }
            let remembered: ResearchSortRemembered = {
                id: res.value.id, files: batches[0], text, at: new Date().toISOString(), decided: {},
                ...(scope === 'batch' && target.batch ? { batch: target.batch } : {}),
                // A run (spec 102 §3): the research keeps it; the app reads how far it is.
                ...(many && res.value.run && res.value.parts ? {
                    run: { id: res.value.run, batches, sorts: res.value.parts.slice(0, batches.length), next: 0, scope: scope === 'first' ? 'all' : scope === 'rest' ? 'selection' : scope },
                } : {}),
            };
            // What is left of a run (Try again, Continue): the proposal still open goes on, its finished proposals stay.
            const old = this.materialSortRemembered();
            if (scope === 'rest' && old && !old.ended) remembered = sortRunContinued(old, remembered, sortFinishedSorts(old, runViewOf(old)));
            // A new sorting: the last proposal's "Done: …" line goes.
            patchResearchAutoState(now.treeId, { materialSort: remembered, sortClosed: undefined });
            dialog.close();
            this.materialSortStop();
            this.materialSortWatch();
            this.refreshMaterialsWindow();
        };
    },

    /** The files of a batch just sent (the Add materials dialog's end, 13a): asked for from the research, then the dialog. */
    async openSortForBatch(batchId: string, batchName: string): Promise<void> {
        const mc = this.materialsContext();
        if (!mc?.base || this.materialSortGate() !== 'on') return;
        const res = await fetchMaterial(mc.base, { batch: batchId });
        if (!res.ok) { this.materialErrorToast(mc, res.error, () => void this.openSortForBatch(batchId, batchName)); return; }
        await mergeIntoCache(mc.treeId, res.value.files, res.value.people ?? {});
        const byId = this.materialSortItemMap(mc.treeId);
        const items = res.value.files.map(f => byId.get(f.id)).filter((i): i is MaterialItem => !!i);
        this.openSortDialog({ items, batch: batchName });
    },

    // ==================== PROGRESS (13e) ====================

    /** Ask about the remembered sorting (GET only), until it ends. */
    materialSortWatch(): void {
        const mc = this.materialsContext();
        const r = mc ? researchAutoState(mc.treeId).materialSort : undefined;
        if (!mc || !r || r.ended) { if (watch && (!r || watch.id !== sortKey(r))) this.materialSortStop(); return; }
        const key = sortKey(r);
        if (watch && (watch.id !== key || watch.treeId !== mc.treeId)) this.materialSortStop();
        // A run (spec 102 §3): read again after a reload or the app's start too; it goes on in the research.
        if (!watch) watch = { treeId: mc.treeId, id: key, timer: null, job: null, busy: false, ...(r.run?.id ? { run: null, jobs: new Map() } : {}) };
        // The bridge came up (after a reload, the app's start): asked now, not after the long wait.
        if (watch.timer && watch.down && mc.base && mc.caps.bridgeUp) { clearTimeout(watch.timer); watch.timer = null; }
        if (watch.timer || watch.busy || (watch.job && !running(watch.job) && !watch.run)) return;
        if (watch.run && !runViewOf(r)?.running && watch.job && !running(watch.job)) return;
        void this.materialSortTick();
    },

    materialSortStop(): void {
        if (watch?.timer) clearTimeout(watch.timer);
        watch = null;
    },

    async materialSortTick(): Promise<void> {
        const w = watch;
        if (!w) return;
        w.timer = null;
        w.down = false;
        const mc = this.materialsContext();
        const again = (ms: number) => { if (watch === w) w.timer = setTimeout(() => void this.materialSortTick(), ms); };
        if (!mc || mc.treeId !== w.treeId) { this.materialSortStop(); return; }
        if (!mc.base || !mc.caps.bridgeUp) { again(POLL_DOWN_MS); w.down = true; return; }
        if (w.jobs) { await this.materialSortRunTick(w, mc.base, again); return; }
        w.busy = true;
        const res = await fetchMaterialSort(mc.base, w.id);
        w.busy = false;
        if (watch !== w) return;
        if (!res.ok) {
            if (res.error.status === 404) {
                // The research no longer knows it: forgotten here too.
                patchResearchAutoState(w.treeId, { materialSort: undefined });
                this.materialSortStop();
                this.refreshMaterialsWindow();
                return;
            }
            again(POLL_DOWN_MS);
            return;
        }
        const was = w.job;
        // Try again / Continue of a proposal (spec 102 §3): its earlier sortings' proposals stay in it.
        const rNow = researchAutoState(w.treeId).materialSort;
        w.busy = true;
        const earlier = rNow && sortKey(rNow) === w.id ? await earlierJobs(w, mc.base, rNow.earlier) : { jobs: [], missing: false };
        w.busy = false;
        if (watch !== w) return;
        let job = res.value;
        if (earlier.jobs.length) {
            // This sorting brought nothing (failed, cancelled): the earlier proposals stay as they were.
            const state = !running(res.value) && !hasProposal(res.value) ? 'done' : res.value.state;
            job = sortJobsMerged(w.id, state, [...earlier.jobs, res.value]);
            if (res.value.filesDone !== undefined) job.filesDone = res.value.filesDone;
        }
        w.job = job;
        if (running(job) || earlier.missing) {
            again(document.hidden ? POLL_HIDDEN_MS : POLL_MS);
        } else if (hasProposal(job)) {
            // Not over the proposal window already open: it shows the end itself (spec 102 §3, §5).
            if (was && running(was) && !proposalRun) {
                this.showToast(strings.materials.agentSort.ready, TOAST_MS, {
                    closable: true, kind: 'materials',
                    action: { label: strings.materials.agentSort.open, run: () => void this.openSortProposal() },
                });
            }
        } else {
            const r = researchAutoState(w.treeId).materialSort;
            if (r?.id === w.id) patchResearchAutoState(w.treeId, { materialSort: { ...r, ended: res.value.state === 'cancelled' ? 'cancelled' : 'failed' } });
        }
        this.refreshMaterialsWindow();
    },

    /**
     * A run of batches (spec 102 §3): the research keeps it and the app only
     * reads it (GET). Each finished batch's sorting is read once; its
     * proposals join the one proposal at its end, the remembered run moves on
     * with the research (it outlives a reload).
     */
    async materialSortRunTick(w: NonNullable<typeof watch>, base: string, again: (ms: number) => void): Promise<void> {
        const jobs = w.jobs!;
        w.busy = true;
        const res = await fetchMaterialSortRun(base, w.id);
        if (watch !== w) { w.busy = false; return; }
        if (!res.ok) {
            w.busy = false;
            if (res.error.status === 404) {
                // The research no longer knows it: forgotten here too.
                patchResearchAutoState(w.treeId, { materialSort: undefined });
                this.materialSortStop();
                this.refreshMaterialsWindow();
                return;
            }
            again(POLL_DOWN_MS);
            return;
        }
        w.run = res.value;
        const r0 = researchAutoState(w.treeId).materialSort;
        if (!r0?.run || sortKey(r0) !== w.id) { w.busy = false; return; }
        const view = sortRunView(r0.run, res.value);
        // The batches finished since: their proposals (a batch not read now is read with the next answer).
        let missing = false;
        for (const i of view.done) {
            const id = view.sorts[i];
            if (!id || jobs.has(id)) continue;
            const one = await fetchMaterialSort(base, id);
            if (watch !== w) { w.busy = false; return; }
            if (one.ok) jobs.set(id, one.value);
            else missing = true;
        }
        // Once the run ended: why a batch did not run (its sorting's reason), read once.
        const reasons = (w.reasons ??= new Map());
        const why = new Map<number, string>();
        for (const i of view.running ? [] : view.failed) {
            const id = view.sorts[i];
            if (!id) continue;
            if (!reasons.has(id)) {
                const one = await fetchMaterialSort(base, id);
                if (watch !== w) { w.busy = false; return; }
                reasons.set(id, one.ok ? one.value.reason ?? '' : '');
            }
            if (reasons.get(id)) why.set(i, reasons.get(id)!);
        }
        // Try again / Continue (spec 102 §3): the proposal's earlier sortings stay in it.
        const earlier = await earlierJobs(w, base, r0.earlier);
        if (watch !== w) { w.busy = false; return; }
        missing ||= earlier.missing;
        w.busy = false;
        const was = w.job;
        const merged = [...earlier.jobs, ...view.done.map(i => jobs.get(view.sorts[i]))];
        // A run whose every batch failed keeps the proposals it went on with.
        const state = view.running ? (res.value.state === 'queued' ? 'queued' : 'working')
            : res.value.state === 'failed' && earlier.jobs.length ? 'done' : res.value.state;
        const job = sortJobsMerged(w.id, state, merged);
        const current = res.value.parts.find(p => p.part === view.batch);
        if (view.running && current?.filesDone !== undefined) job.filesDone = current.filesDone;
        w.job = job;
        // The remembered run moves on (what was decided meanwhile stays: read anew); once it ended,
        // a batch that did not run or a stop from elsewhere is remembered (spec 102 §3).
        const r = researchAutoState(w.treeId).materialSort;
        const moved = r && sortKey(r) === w.id ? sortRunAdvance(r, view) : null;
        const ended = r && sortKey(r) === w.id && !missing ? sortRunEnded(moved ?? r, view, res.value, why) : null;
        const now = ended ?? moved;
        if (now) patchResearchAutoState(w.treeId, { materialSort: now });
        const outcome = !!(now ?? r)?.run && !!((now ?? r)!.run!.error || (now ?? r)!.run!.stopped);
        if (view.running || missing) {
            again(document.hidden ? POLL_HIDDEN_MS : POLL_MS);
        } else if (hasProposal(job)) {
            // Not over the proposal window already open: it shows the end itself (spec 102 §3, §5).
            if (was && running(was) && !proposalRun) {
                this.showToast(strings.materials.agentSort.ready, TOAST_MS, {
                    closable: true, kind: 'materials',
                    action: { label: strings.materials.agentSort.open, run: () => void this.openSortProposal() },
                });
            }
        } else if (r && sortKey(r) === w.id && !outcome) {
            // Nothing came of it and nothing is left to try again (the strip says the sorting ended).
            patchResearchAutoState(w.treeId, { materialSort: { ...(now ?? r), ended: res.value.state === 'cancelled' ? 'cancelled' : 'failed' } });
        }
        proposalRun?.(job);
        this.refreshMaterialsWindow();
    },

    /** Cancel the sorting; with proposals already made, whether to keep them (default) is asked. */
    async materialSortCancel(): Promise<void> {
        const mc = this.materialsContext();
        const w = watch;
        // Asked already and not answered (the strip drawn anew meanwhile has a new button): nothing more.
        if (!mc?.base || !w || cancelAsking) return;
        cancelAsking = true;
        // How far the run got before it stops (what the question says, what stays remembered).
        const before = researchAutoState(mc.treeId).materialSort;
        const view = before && sortKey(before) === w.id ? runViewOf(before) : null;
        let res: Awaited<ReturnType<typeof cancelMaterialSort>>;
        try {
            // A run (spec 102 §3): the batch at work stops, the waiting ones do not start.
            res = w.jobs ? await cancelMaterialSortRun(mc.base, w.id) : await cancelMaterialSort(mc.base, w.id);
        } finally {
            cancelAsking = false;
        }
        if (!res.ok) { this.materialErrorToast(mc, res.error, () => void this.materialSortCancel()); return; }
        // A run cancelled here (spec 102 §3): not said as stopped, the batches not finished stay unsorted.
        const r = researchAutoState(mc.treeId).materialSort;
        if (r?.run && sortKey(r) === w.id) patchResearchAutoState(mc.treeId, { materialSort: sortRunCancelled(r, view) });
        const made = w.job?.proposals.length ?? 0;
        if (made > 0) {
            const s = strings.materials.agentSort;
            const dialog = materialDialog({ title: s.discardAsk });
            if (r?.run && view) {
                // Which batches will not run and how many files stay unsorted; the proposals still to go through.
                const rest = sortRunRest(r.run, view, r.gone);
                const open = r && w.job ? this.materialSortCounts(mc.treeId, r, w.job).open : made;
                const from = Math.min(view.batches, Math.max(1, view.batches - rest.batches + 1));
                if (rest.batches > 0) dialog.body.append(h('p', 'mdlg-text', s.discardRun(from, view.batches, rest.files.length, open)));
            }
            // The Cancel that asked is drawn anew: the focus goes to the strip's action, not to the page.
            const refocus = () => requestAnimationFrame(() => {
                if (document.activeElement && document.activeElement !== document.body) return;
                document.querySelector<HTMLElement>('#materials-modal .mw-sort [data-sort]')?.focus();
            });
            const keep = button(s.discardKeep, 'is-primary', () => { dialog.close(); void this.materialSortTick().then(refocus); });
            dialog.foot.append(button(s.discard, '', () => {
                dialog.close();
                patchResearchAutoState(mc.treeId, { materialSort: undefined });
                this.materialSortStop();
                this.refreshMaterialsWindow();
                refocus();
            }), keep);
            keep.focus();
            return;
        }
        patchResearchAutoState(mc.treeId, { materialSort: undefined });
        this.materialSortStop();
        this.refreshMaterialsWindow();
    },

    /**
     * The one strip of sorting over the Materials window (spec 102 §1): the
     * state of the whole archive (A–F), whatever the filter shows. `items`:
     * every file the window knows; `phone`: the state only, no action (the
     * proposal is in the app on the computer, §11); `added`: the files of a
     * batch just added (A says them).
     */
    materialSortStripView(items: readonly MaterialItem[], opts: { phone?: boolean; added?: number } = {}): SortStripView {
        const none: SortStripView = { state: null, html: '', mod: '', next: [], review: [] };
        const mc = this.materialsContext();
        const gate = this.materialSortGate();
        if (!mc || !gate) return none;
        const s = strings.materials.agentSort;
        const auto = researchAutoState(mc.treeId);
        const r = auto.materialSort ?? null;
        const marks = this.materialSortMarks(items);
        const next = this.materialSortNext(items).send;
        if (r?.ended) {
            return {
                ...none, state: 'ended', mod: r.ended === 'failed' ? 'is-error' : 'is-done',
                html: `<span class="mw-sort-text">${esc(r.ended === 'cancelled' ? s.cancelled : s.failed)}</span>${opts.phone ? ''
                    : `<button type="button" class="link-button" data-sort="dismiss">${esc(s.dismiss)}</button>`}`,
            };
        }
        if (r) this.materialSortWatch();
        const job = watchedJob(r);
        const counts = r && job ? this.materialSortCounts(mc.treeId, r, job) : null;
        const byId = new Map(items.filter(i => i.file).map(i => [i.file!.id, i]));
        // E: the files the agent left unassigned (this proposal's, or remembered from the closed ones) still without a title or a person.
        const leftItems = (): MaterialItem[] => {
            const ids = new Set(marks.left.keys());
            if (r && job) {
                const rows = sortRows(job, id => byId.get(id) ?? null, countChip);
                for (const row of rows) if (!r.decided[row.id] && !sortRowProposes(row)) ids.add(row.id);
            }
            return sortNeedy([...ids].map(id => byId.get(id)).filter((i): i is MaterialItem => !!i));
        };
        const left = leftItems();
        const state = sortStripState({ remembered: !!r, running: !!r && running(job), pending: counts?.open ?? 0, closed: !!auto.sortClosed, next: next.length, left: left.length });
        if (!state) return none;
        if (state === 'F') {
            if (!allSortedTimer) {
                const treeId = mc.treeId;
                allSortedTimer = setTimeout(() => {
                    allSortedTimer = null;
                    patchResearchAutoState(treeId, { sortClosed: undefined });
                    this.refreshMaterialsWindow();
                }, ALL_SORTED_MS);
            }
        } else if (allSortedTimer) { clearTimeout(allSortedTimer); allSortedTimer = null; }

        const readOnly = DataManager.isReadOnly();
        const quiet = !!opts.phone || readOnly;
        const note = (text: string) => `<span class="mw-sort-note">${esc(text)}</span>`;
        // The state alone: on a phone the proposal is on the computer (its short form on a phone held sideways).
        const phoneNote = opts.phone ? `<span class="mw-sort-note mw-sort-phone">${esc(s.phone)}</span><span class="mw-sort-note mw-sort-phone-short">${esc(s.phoneShort)}</span>` : '';
        const roNote = readOnly && !opts.phone ? note(s.readOnlyNote) : '';
        const closeX = quiet ? '' : `<button type="button" class="mw-sort-close" data-sort="close" aria-label="${esc(s.closeWhole)}" title="${esc(s.closeWhole)}">×</button>`;
        const sortBtn = (label: string, act: 'sort' | 'next') => {
            if (quiet || gate === 'older') return '';
            const off = gate === 'offRun' ? ` aria-disabled="true" title="${esc(s.offRun)}"` : '';
            return `<button type="button" class="mw-sort-btn primary" data-sort="${act}"${off}>${researchBridgeActionLabel(label, 'material-sort')}</button>`;
        };
        const gateNote = gate === 'older' ? note(s.older) : gate === 'offRun' ? note(s.offRun) : '';
        const offMod = (fallback: SortStripView['mod']): SortStripView['mod'] => readOnly || gate === 'older' || gate === 'offRun' ? 'is-off' : fallback;
        const review = (list: MaterialItem[]) => quiet || !list.length ? '' : `<button type="button" class="link-button" data-sort="review">${esc(s.reviewHand)}</button>`;

        // A run that ended before all its batches ran (spec 102 §3): a batch did not run, or it stopped elsewhere.
        const run = r?.run;
        if (run && !run.closed && (run.error || run.stopped)) {
            const nb = run.batches.length;
            const done = run.done ?? [];
            const rest = sortRunRest(run, { done }, r?.gone);
            const p = counts?.open ?? 0;
            const handle = quiet || p <= 0 ? '' : `<button type="button" class="mw-sort-btn secondary" data-sort="open">${esc(s.handle(p))}</button>`;
            const go = (label: string, act: 'retry' | 'resume') => {
                if (quiet || !rest.files.length || gate === 'older') return '';
                const off = gate === 'offRun' ? ` aria-disabled="true" title="${esc(s.offRun)}"` : '';
                return `<button type="button" class="mw-sort-btn primary" data-sort="${act}"${off}>${researchBridgeActionLabel(label, 'material-sort')}</button>`;
            };
            const close = quiet ? '' : `<button type="button" class="link-button" data-sort="close-run">${esc(s.dismiss)}</button>`;
            if (run.error) {
                return {
                    state: 'error', mod: 'is-error', next, review: [],
                    html: `<span class="mw-sort-text"><span class="mw-sort-err">${esc(s.batchFailed(run.error.batch + 1, nb))}</span><span>${esc(runErrorText(run.error.code))}</span>${note(s.leftAfterError(rest.files.length, p))}${quiet ? '' : gateNote}${roNote}${phoneNote}</span>${handle}${go(s.retry, 'retry')}${close}`,
                };
            }
            // The last batch that finished (none: nothing ran before the stop).
            const last = done.length ? done[done.length - 1] + 1 : 0;
            const what = last ? s.stopped(last, nb) : s.cancelled;
            return {
                state: 'stopped', mod: offMod('is-done'), next, review: [],
                html: `<span class="mw-sort-text"><span><b>${esc(what)}</b></span>${note(s.stoppedNote(rest.files.length))}${quiet ? '' : gateNote}${roNote}${phoneNote}</span>${handle}${go(s.resume(rest.batches), 'resume')}${close}`,
            };
        }

        if (state === 'A') {
            const what = opts.added ? s.stripAdded(opts.added, next.length) : s.stripWhole(next.length);
            return {
                state, mod: offMod(''), next, review: next,
                html: `<span class="mw-sort-text" title="${esc(what)}"><span class="mw-sort-what">${esc(what)}</span>${quiet ? '' : gateNote}${roNote}${phoneNote}</span>
                    ${sortBtn(s.sort, 'sort')}${review(next)}${closeX}`,
            };
        }
        if (state === 'E' || state === 'F') {
            const closed = auto.sortClosed;
            const handled = counts ? counts.accepted + counts.rejected : closed?.handled ?? 0;
            const unassigned = counts ? counts.unassigned : closed?.unassigned ?? 0;
            if (state === 'F') {
                return { state, mod: 'is-done', next, review: [], html: `<span class="mw-sort-text"><span class="mw-sort-what">${esc(s.allSorted)}</span></span>` };
            }
            const line = s.doneLine(handled, unassigned, next.length);
            // An older research takes 50 files at once: "Sort the next 50…" says so (spec 102 §12).
            const fifty = !mc.caps.sortRun && next.length > SORT_MAX_FILES;
            return {
                state, mod: offMod('is-done'), next, review: left,
                html: `<span class="mw-sort-text" title="${esc(line)}"><span class="mw-sort-what">${esc(line)}</span>${quiet ? '' : gate === 'on' && fifty && next.length ? note(s.olderRun) : gateNote}${roNote}${phoneNote}</span>
                    ${next.length ? sortBtn(fifty ? s.olderNext : s.sortNextN(next.length), 'next') : ''}${review(left)}${closeX}`,
            };
        }
        if (state === 'D') {
            const n = counts?.open ?? 0;
            const nb = r?.run?.batches.length ?? 1;
            const files = r?.run ? r.run.batches.reduce((t, b) => t + b.length, 0) : (job?.files.length || r?.files.length || 0);
            return {
                state, mod: readOnly ? 'is-off' : '', next, review: [],
                html: `<span class="mw-sort-text"><span class="mw-sort-run">${esc(s.pending(n))}</span>${note(s.runSize(nb, files))}${roNote}${phoneNote}</span>${quiet ? ''
                    : `<button type="button" class="mw-sort-btn primary" data-sort="open">${esc(s.handle(n))}</button>
                    <button type="button" class="link-button" data-sort="close-proposal">${esc(s.closeProposal)}</button>`}`,
            };
        }
        // B, C: the agent works.
        // A sorting that goes on with a proposal (Try again, Continue) counts its own files, not the earlier ones'.
        const total = (r!.earlier ? r!.files.length : 0) || job?.files.length || r!.files.length;
        const working = !!job && job.state !== 'queued';
        // A number only when the research says how many files its readers have judged; else a progress without one.
        const counted = working && typeof job.filesDone === 'number' && total > 0;
        const k = counted ? Math.min(total, job.filesDone ?? 0) : 0;
        // A run (spec 102 §3): which batch and how far in it, one bar for the whole run with a tick between batches.
        const rv = runViewOf(r);
        const label = rv ? runLabel(rv) : !working ? s.queued : counted ? s.run(k, total) : s.runFiles(total);
        const bar = rv ? runBarHtml(rv, label) : counted
            ? `<span class="mw-sort-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${k}"><span style="width: ${Math.round((k / total) * 100)}%"></span></span>`
            : `<span class="mw-sort-bar is-indeterminate" role="progressbar" aria-label="${esc(label)}"><span></span></span>`;
        const n = counts?.open ?? 0;
        // The next batch waits (spec 102 §3): why and when it starts by itself, in place of the run's note.
        const wait = rv?.waiting ? note(runWaitText(rv.waiting)) : '';
        const after = state === 'C' ? `${wait}<span class="mw-sort-wait">${esc(s.waiting(n))}</span>` : wait || (opts.phone ? '' : note(s.runNote));
        return {
            state, mod: readOnly ? 'is-off' : '', next, review: [],
            html: `<span class="mw-sort-text"><span class="mw-sort-run">${esc(label)}</span>
                ${bar}
                ${after}${roNote}${phoneNote}</span>${quiet ? '' : `${state === 'C' ? `<button type="button" class="mw-sort-btn primary" data-sort="open">${esc(s.handle(n))}</button>` : ''}
                <button type="button" class="link-button" data-sort="cancel">${esc(strings.buttons.cancel)}</button>`}`,
        };
    },

    /**
     * Try again… / Continue (N batches)… (spec 102 §3): the sorting dialog
     * over what is left of the run (the files of the batches that did not
     * run, still without a title or a person), with what was said before.
     */
    materialSortRestDialog(): void {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r?.run) return;
        const rest = sortRunRest(r.run, { done: r.run.done ?? [] }, r.gone);
        const byId = this.materialSortItemMap(mc.treeId);
        const items = rest.files.map(id => byId.get(id)).filter((i): i is MaterialItem => !!i);
        this.openSortDialog({ items, batch: r.batch ?? null, rest: true, text: r.text });
    },

    /**
     * Close the error or the stop of a run (spec 102 §3): with proposals
     * still waiting the strip says them (D), else the proposal closes as
     * Close the proposal does.
     */
    materialSortCloseRun(): void {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r?.run) return;
        const job = watchedJob(r);
        const open = job ? this.materialSortCounts(mc.treeId, r, job).open : 0;
        if (open > 0) {
            patchResearchAutoState(mc.treeId, { materialSort: { ...r, run: { ...r.run, closed: true } } });
            this.refreshMaterialsWindow();
            requestAnimationFrame(() => document.querySelector<HTMLElement>('#materials-modal .mw-sort [data-sort]')?.focus());
            return;
        }
        this.materialSortForget();
        this.refreshMaterialsWindow();
    },

    /** A click in the strip (Go through by hand and × are the window's). */
    materialSortStripClick(e: MouseEvent, view: SortStripView): void {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
        if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
        const mc = this.materialsContext();
        switch (btn.dataset.sort) {
            case 'sort': this.openSortDialog({ items: view.next, batch: null, whole: true }); return;
            // Sort the next: a proposal handled to the end closes first (spec 102 §6).
            case 'next':
                if (this.materialSortRemembered()) this.materialSortForget();
                this.openSortDialog({ items: view.next, batch: null, whole: true });
                return;
            case 'open': void this.openSortProposal(); return;
            case 'close-proposal': this.materialSortCloseAsk(); return;
            // What is left of a run (spec 102 §3): the dialog over the batches that did not run, nothing sent before its Send.
            case 'retry':
            case 'resume': this.materialSortRestDialog(); return;
            case 'close-run': this.materialSortCloseRun(); return;
            // Said from the click until the research answers (a strip drawn anew meanwhile: a toast says it).
            case 'cancel': void runBusy(btn, () => this.materialSortCancel(), { label: strings.busy.cancelling, kind: 'bridge', toastWhenGone: true }); return;
            case 'dismiss':
                if (mc) patchResearchAutoState(mc.treeId, { materialSort: undefined });
                this.materialSortStop();
                this.refreshMaterialsWindow();
                return;
        }
    },

    // ==================== THE PROPOSAL (13f–13i) ====================

    /** The agent's proposal: Proposals · Unassigned · Done; nothing is written until accepted. */
    async openSortProposal(): Promise<void> {
        const mc = this.materialsContext();
        const r = this.materialSortRemembered();
        if (!mc || !r) return;
        let job = watchedJob(r);
        // A run (spec 102 §3): the proposals of the batches finished so far, while the next ones work.
        if (r.run?.id) {
            if (job?.files.length) this.materialSortProposalWindow(mc, r, job);
            return;
        }
        if (!hasProposal(job)) {
            if (!mc.base || !mc.caps.bridgeUp) return;
            const res = await fetchMaterialSort(mc.base, r.id);
            if (!res.ok || !hasProposal(res.value)) return;
            job = res.value;
            if (watch?.id === sortKey(r)) watch.job = job;
        }
        if (job) this.materialSortProposalWindow(mc, r, job);
    },

    /** The open proposal shows its files as remembered now (called with every redraw of the Materials window). */
    materialSortProposalRefresh(): void {
        proposalRedraw?.();
    },

    /** `opts.tab`: the tab it opens on (back from Hide… of Unassigned). */
    materialSortProposalWindow(mc: MaterialsContext, r: ResearchSortRemembered, opened: SortJob, opts: { tab?: 'unassigned' } = {}): void {
        let job = opened;
        const s = strings.materials.agentSort;
        const byId = this.materialSortItemMap(mc.treeId);
        const tree = sortTreeIndex(DataManager.getData(), personName);
        const names = {
            event: (tag: string) => s.eventName[tag] ?? tag,
            unknown: (ref: string) => s.unknownRef(ref),
            eventLabel: s.event,
            sourceLabel: s.source,
            newSource: s.newSource,
        };
        const chipOf = (link: SortLink, title?: string) => sortChip(link, tree, names, title);
        // A photo the agent says is a portrait of a person who has none yet: offered as a chip (spec 102 §10).
        const withPortraits = (list: SortRow[]): SortRow[] => {
            for (const row of list) {
                const it = row.item;
                const ref = row.proposal?.portrait;
                if (!ref || row.unrelated || !it || it.hidden) continue;
                const image = it.attachment && !it.removedId ? isPortraitCandidate(it.attachment) : !it.attachment && materialType(it.file?.mime, it.name) === 'image';
                const known = tree.person(ref);
                const person = image && known ? DataManager.getPerson(known.id) : null;
                if (!person || person.photo || !canEditPortrait(person.id)) continue;
                row.portrait = { person: person.id, name: known!.name };
            }
            return list;
        };
        // A run's batches finished later join at the end (spec 102 §3): the rows drawn stay where they are.
        let rows = withPortraits(sortRows(job, id => byId.get(id) ?? null, chipOf));
        /** The sorting as known now (a run's batches merged), else as opened. */
        const jobNow = (): SortJob => watchedJob(this.materialSortRemembered()) ?? job;
        // Chips taken off a proposal (×): its back side, its portrait.
        const dropped = new Map<string, { back?: true; portrait?: true }>();
        const backOn = (row: SortRow) => !!row.back && !dropped.get(row.id)?.back;
        const portraitOn = (row: SortRow) => !!row.portrait && !dropped.get(row.id)?.portrait;
        // Why a file has no proposal, as the research says it (an older research says nothing: no reason shown).
        let unproposed = new Map((job.unproposed ?? []).map(u => [u.id, u]));
        const decided: Record<string, 'accepted' | 'rejected'> = { ...r.decided };
        // What undoes each accepted row (Undo under Done): kept with the sorting, so it outlives a reload.
        const reverts: Record<string, unknown> = { ...(r.reverts ?? {}) };
        const choices = new Map<string, SortChoice>();
        const selected = new Set<string>();
        let tab: 'proposals' | 'unassigned' | 'done' = opts.tab ?? 'proposals';
        let editing: string | null = null;
        let focusId: string | null = null;

        let assigned: SortRow[] = [];
        let unassigned: SortRow[] = [];
        const split = () => {
            // A row decided already stays with the proposals (Done), also when the file now has what was proposed (after a reload).
            const proposes = (x: SortRow) => !!decided[x.id] || sortRowProposes(x);
            assigned = rows.filter(proposes);
            // The files the agent says are not about the family first: Hide as Not about the family stands over them.
            const unassignedAll = rows.filter(x => !proposes(x));
            unassigned = [...unassignedAll.filter(x => x.unrelated), ...unassignedAll.filter(x => !x.unrelated)];
        };
        split();
        const open = () => assigned.filter(x => !decided[x.id]);
        const done = () => assigned.filter(x => decided[x.id]);
        const remember = () => {
            const now = researchAutoState(mc.treeId).materialSort;
            if (!now || sortKey(now) !== sortKey(r)) return;
            const kept = Object.fromEntries(Object.entries(reverts).filter(([k]) => decided[k] === 'accepted'));
            const { reverts: _old, ...rest } = now;
            patchResearchAutoState(mc.treeId, { materialSort: { ...rest, decided: { ...decided }, ...(Object.keys(kept).length ? { reverts: kept } : {}) } });
        };

        const dialog: MaterialDialog = materialDialog({
            title: s.propTitle,
            sub: [r.batch ?? '', s.propSub(rows.length, assigned.length, unassigned.length)].filter(Boolean).join(' · '),
            modifier: 'sortprop',
            escape: () => {
                if (!editing) return false;
                editing = null;
                draw();
                return true;
            },
            onClose: () => {
                if (proposalRedraw === redraw) proposalRedraw = null;
                // Closed with nothing waiting and nothing at work: the proposal closes itself (spec 102 §6).
                // Not when the window only steps aside (Hide…, Close the proposal…: it comes back or asks).
                const now = this.materialSortRemembered();
                if (proposalRun === absorb) proposalRun = null;
                if (!handover && now && sortKey(now) === sortKey(r) && !open().length && !running(jobNow())) { this.materialSortForget(); return; }
                this.refreshMaterialsWindow();
            },
        });
        dialog.box.id = 'material-sort-proposal';
        // Hide… has a dialog of its own: this one comes back on Unassigned when it ends (hidden or not).
        const reopen = () => {
            const now = this.materialsContext();
            const rNow = this.materialSortRemembered();
            if (now && rNow && sortKey(rNow) === sortKey(r)) this.materialSortProposalWindow(now, rNow, jobNow(), { tab: 'unassigned' });
        };
        // The window steps aside for a dialog that brings it back (it does not close the proposal then).
        let handover = false;
        const hide = (items: MaterialItem[], hideReason?: 'duplicate') => {
            if (!items.length) return;
            handover = true;
            this.materialAction('hide', items, { where: 'window', back: reopen, ...(hideReason ? { hideReason } : {}) });
        };
        /** Hide… and Restore here: the research's write on material, while it runs. */
        const hideCan = (): 'yes' | 'off' | null => {
            const now = this.materialsContext();
            if (!now?.caps.assign) return null;
            return now.caps.bridgeUp && now.base ? 'yes' : 'off';
        };
        if (r.text) dialog.box.querySelector('.mdlg-head')?.appendChild(h('p', 'mdlg-sub msp-know', s.propKnow(r.text)));

        const tabs = h('div', 'msp-tabs');
        tabs.setAttribute('role', 'tablist');
        const list = h('div', 'msp-list');
        list.setAttribute('role', 'list');
        // A run at work (spec 102 §3): which batch runs, the run's bar, Cancel; new proposals join at the end and are said below.
        const runLine = h('div', 'msp-run');
        runLine.setAttribute('role', 'status');
        runLine.hidden = true;
        const runBody = h('span', 'msp-run-body');
        const runCancel = h('button', 'link-button msp-run-cancel', strings.buttons.cancel);
        runCancel.type = 'button';
        runCancel.addEventListener('click', () => void runBusy(runCancel, () => this.materialSortCancel(), { label: strings.busy.cancelling, kind: 'bridge', toastWhenGone: true }));
        runLine.append(runBody, runCancel);
        const more = h('div', 'msp-more');
        more.setAttribute('role', 'status');
        more.setAttribute('aria-live', 'polite');
        more.hidden = true;
        const moreText = h('span', 'msp-more-text');
        const moreShow = h('button', 'link-button msp-more-show', s.show);
        moreShow.type = 'button';
        more.append(moreText, moreShow);
        /** The first of the proposals that joined last (Show goes to it). */
        let moreFirst: string | null = null;
        const moreHide = () => { more.hidden = true; moreFirst = null; };
        moreShow.addEventListener('click', () => {
            const first = moreFirst;
            moreHide();
            const el = first ? list.querySelector<HTMLElement>(`.msp-row[data-id="${CSS.escape(first)}"]`) : null;
            if (!el) return;
            focusId = first;
            list.querySelectorAll<HTMLElement>('.msp-row').forEach(x => { x.tabIndex = x === el ? 0 : -1; });
            el.scrollIntoView({ block: 'nearest' });
            el.focus();
        });
        dialog.body.append(tabs, runLine, list, more);
        const foot = dialog.foot;
        const write = h('p', 'mdlg-note msp-write', s.write);
        const accSel = button('', 'msp-accept-sel', () => void accept([...selected]));
        const accAll = button('', 'is-primary msp-accept-all', () => void accept(open().map(x => x.id)));
        // Close the proposal… before the end (spec 102 §6): asked first; Keep brings the window back.
        const closeLink = h('button', 'link-button msp-close-proposal', s.closeProposal);
        closeLink.type = 'button';
        closeLink.addEventListener('click', () => {
            handover = true;
            this.materialSortCloseAsk(() => {
                const now = this.materialsContext();
                const rNow = this.materialSortRemembered();
                if (now && rNow && sortKey(rNow) === sortKey(r)) this.materialSortProposalWindow(now, rNow, jobNow());
            });
        });
        const closeBtn = button(strings.buttons.close, 'msp-close', () => dialog.close());
        foot.append(write, closeLink, closeBtn, accSel, accAll);

        const fieldLine = (row: SortRow, name: 'title' | 'date' | 'kind', show: (v: string) => string): HTMLElement | null => {
            const f = row[name] as { proposed: string; human?: string } | undefined;
            if (!f || f.human === undefined || choices.get(row.id)?.use?.[name]) return null;
            const line = h('div', 'msp-kept');
            line.append(h('span', 'msp-kept-human', `${s.humanKept[name]}: ${show(f.human)}`), h('span', 'msp-kept-other', ` · ${s.agentOther} `), h('q', 'msp-kept-proposal', show(f.proposed)), document.createTextNode(' '));
            line.appendChild(button(s.useProposal, 'is-link msp-use', () => {
                const c = choices.get(row.id) ?? {};
                choices.set(row.id, { ...c, use: { ...c.use, [name]: true } });
                draw();
            }));
            return line;
        };
        const kindText = (k: string) => k ? materialKindLabel({ kind: k as MaterialKind }) : s.fNoKind;

        // Each row's preview is made once and kept across redraws: drawn anew it showed the extension's letters until its image came again.
        const thumbs = new Map<string, HTMLElement>();
        const thumb = (row: SortRow): HTMLElement => {
            const key = `${row.id}|${row.item?.file?.sha ?? row.item?.name ?? ''}`;
            let el = thumbs.get(key);
            if (!el) {
                el = previewEl(mc.treeId, row.item, 'msp-thumb');
                thumbs.set(key, el);
            }
            return el;
        };

        const rowEl = (row: SortRow): HTMLElement => {
            const item = row.item;
            const p = row.proposal;
            const el = h('div', `msp-row${tab === 'proposals' ? '' : ' is-nocheck'}`);
            el.setAttribute('role', 'listitem');
            el.dataset.id = row.id;
            el.tabIndex = focusId === row.id ? 0 : -1;
            const use = choices.get(row.id)?.use ?? {};
            const titleShown = row.title && (row.title.human === undefined || use.title) ? row.title.proposed : (row.title?.human ?? item?.title ?? row.id);
            el.setAttribute('aria-label', s.rowLabel(titleShown));
            const state = decided[row.id];
            if (tab === 'proposals') {
                const cb = h('input', 'msp-check');
                cb.type = 'checkbox';
                cb.checked = selected.has(row.id);
                cb.tabIndex = -1;
                cb.setAttribute('aria-label', s.rowLabel(titleShown));
                cb.addEventListener('change', () => { if (cb.checked) selected.add(row.id); else selected.delete(row.id); drawFoot(); });
                el.appendChild(cb);
            }
            el.appendChild(thumb(row));
            const main = h('div', 'msp-main');
            if (editing === row.id && tab === 'proposals') {
                main.appendChild(editForm(row));
            } else {
                main.appendChild(h('div', 'msp-title', titleShown));
                const back = backOn(row) ? row.back! : null;
                if (item && back) main.appendChild(h('div', 'msp-file', s.rubFiles(item.name, back.item.name)));
                else if (item && item.name !== titleShown) main.appendChild(h('div', 'msp-file', item.name));
                const meta = h('div', 'msp-meta');
                const date = row.date && (row.date.human === undefined || use.date) ? row.date.proposed : row.date?.human;
                const kind = row.kind && (row.kind.human === undefined || use.kind) ? row.kind.proposed : row.kind?.human;
                const bits = [date ?? '', kind ? kindText(kind) : '', back ? s.twoSides : ''].filter(Boolean);
                if (bits.length) meta.appendChild(document.createTextNode(`${bits.join(' · ')} · `));
                if (row.unrelated) {
                    meta.appendChild(h('span', 'msp-flag is-unrelated', strings.materials.reason.unrelated));
                    meta.appendChild(document.createTextNode(' · '));
                }
                if (p) {
                    const conf = h('span', `msp-conf is-${p.sure}`, s.conf[p.sure === 'medium' ? 'medium' : p.sure]);
                    meta.appendChild(conf);
                }
                main.appendChild(meta);
                for (const line of [fieldLine(row, 'title', v => v), fieldLine(row, 'date', v => v), fieldLine(row, 'kind', kindText)]) if (line) main.appendChild(line);
                if (row.chips.length || back || portraitOn(row)) {
                    const chips = h('div', 'msp-chips');
                    for (const c of row.chips) chips.appendChild(h('span', `msp-chip is-${c.kind}${c.place || c.person ? '' : ' is-unknown'}`, c.label));
                    // The proposal's own chips (§10): × takes one off while the proposal is open.
                    const own = (cls: string, label: string, text: string, which: 'back' | 'portrait', lead?: HTMLElement) => {
                        const chip = h('span', `msp-chip ${cls}`);
                        chip.dataset.chip = which;
                        if (lead) chip.appendChild(lead);
                        chip.append(h('span', 'msp-chip-label', label), document.createTextNode(` ${text}`));
                        if (tab === 'proposals' && !state) {
                            const x = button('×', 'msp-chip-x', () => { dropped.set(row.id, { ...dropped.get(row.id), [which]: true }); draw(); });
                            x.setAttribute('aria-label', s.removeLink(label.replace(/:$/, '')));
                            chip.appendChild(x);
                        }
                        chips.appendChild(chip);
                    };
                    if (back) own('is-back', s.rubChip, back.item.name, 'back', previewEl(mc.treeId, back.item, 'msp-chip-thumb'));
                    if (portraitOn(row)) own('is-person', s.portraitChip, row.portrait!.name, 'portrait');
                    main.appendChild(chips);
                }
                if (p?.why) main.appendChild(h('div', 'msp-why', tab === 'unassigned' ? `${s.unassignedWhy}: ${p.why}` : p.why));
                const un = tab === 'unassigned' && !p ? unproposed.get(row.id) : undefined;
                if (un) {
                    main.appendChild(h('div', 'msp-why msp-unproposed', s.unproposed[un.why]));
                    if (un.said) {
                        const said = h('div', 'msp-why msp-said', un.said);
                        said.title = un.said;
                        main.appendChild(said);
                    }
                }
            }
            el.appendChild(main);
            const acts = h('div', 'msp-acts');
            if (tab === 'proposals' && editing !== row.id) {
                acts.append(
                    button(s.accept, 'is-primary msp-accept', () => void accept([row.id])),
                    button(s.edit, 'msp-edit', () => { editing = row.id; focusId = row.id; draw(); }),
                    button(s.reject, 'msp-reject', () => { decided[row.id] = 'rejected'; selected.delete(row.id); remember(); draw(); }),
                );
            } else if (tab === 'unassigned' && row.unrelated && item) {
                const can = hideCan();
                if (item.hidden) {
                    acts.appendChild(h('span', 'msp-state is-hidden', strings.materials.hiddenLabel[item.hidden.reason ?? 'none'] ?? strings.materials.hiddenLabel.none));
                    if (can) {
                        const back = button(strings.materials.restore, 'msp-restore', () => { this.materialAction('restore', [item], { where: 'window' }); });
                        back.disabled = can === 'off';
                        acts.appendChild(back);
                    }
                } else if (can && sortUnrelatedHideable([row]).length) {
                    const one = button(strings.materials.hide, 'msp-hide', () => hide([item]));
                    one.disabled = can === 'off';
                    acts.appendChild(one);
                }
            } else if (tab === 'done' && state) {
                acts.appendChild(h('span', `msp-state is-${state}`, state === 'accepted' ? s.accepted : s.rejected));
                // A rejected row comes back to the proposals; an accepted one is written back as it was, then comes back too.
                if (state === 'rejected') acts.appendChild(button(s.undoRow, 'msp-undo', () => { delete decided[row.id]; remember(); draw(); }));
                else if (parseSortRevert(reverts[row.id])) acts.appendChild(button(s.undoRow, 'msp-undo', () => void revert(row.id)));
            }
            el.appendChild(acts);
            return el;
        };

        const editForm = (row: SortRow): HTMLElement => {
            const form = h('div', 'msp-edit-form');
            const use = choices.get(row.id)?.use ?? {};
            const cur = (name: 'title' | 'date' | 'kind', fallback: string | undefined) => {
                const f = row[name] as { proposed: string; human?: string } | undefined;
                return f ? (f.human !== undefined && !use[name] ? f.human : f.proposed) : fallback ?? '';
            };
            const input = (label: string, value: string, cls: string): HTMLInputElement => {
                const wrap = h('label', 'msp-field');
                wrap.appendChild(h('span', 'msp-field-label', label));
                const el = h('input', cls);
                el.type = 'text';
                el.value = value;
                wrap.appendChild(el);
                form.appendChild(wrap);
                return el;
            };
            const title = input(s.fTitle, cur('title', row.item?.titled ? row.item.title : ''), 'msp-edit-title');
            const date = input(s.fDate, cur('date', row.item?.date), 'msp-edit-date');
            const kindWrap = h('label', 'msp-field');
            kindWrap.appendChild(h('span', 'msp-field-label', s.fKind));
            const kind = h('select', 'msp-edit-kind');
            const kinds: Array<MaterialKind | ''> = ['', 'photo', 'document', 'record', 'other'];
            const kindNow = cur('kind', row.item?.kind);
            for (const k of kinds) {
                const o = h('option', '', kindText(k));
                o.value = k;
                o.selected = k === kindNow;
                kind.appendChild(o);
            }
            kindWrap.appendChild(kind);
            form.appendChild(kindWrap);
            let chips: SortChip[] = [...row.chips];
            const chipBox = h('div', 'msp-chips');
            const drawChips = () => {
                chipBox.replaceChildren(...chips.map((c, i) => {
                    const chip = h('span', `msp-chip is-${c.kind}`, c.label);
                    const x = button('×', 'msp-chip-x', () => { chips = chips.filter((_, j) => j !== i); drawChips(); });
                    x.setAttribute('aria-label', s.removeLink(c.label));
                    chip.appendChild(x);
                    return chip;
                }));
            };
            drawChips();
            form.appendChild(chipBox);
            // + Person… (13g): a person of the tree, as Link to… picks one.
            const addPerson = button(s.addPerson, 'is-link msp-add-person', () => {
                if (form.querySelector('#msp-person-picker')) return;
                const host = h('div', 'msp-person-pick');
                host.id = 'msp-person-picker';
                addPerson.after(host);
                const picker = new PersonPicker({
                    containerId: host.id,
                    placeholder: strings.materials.attachPersonPh,
                    showBirthYear: true,
                    persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder),
                    onSelect: (id) => {
                        host.remove();
                        if (!chips.some(c => c.kind === 'person' && c.place && 'personId' in c.place && c.place.personId === id)) {
                            const ref = researchPersonRef(DataManager.getPerson(id)?.refn) ?? null;
                            chips = [...chips, { link: { type: 'person', ref: ref ?? '' }, kind: 'person', person: ref, place: { personId: id }, label: personName(id) }];
                            drawChips();
                        }
                        addPerson.focus();
                    },
                });
                picker.focusInput();
            });
            form.appendChild(addPerson);
            const save = () => {
                choices.set(row.id, { ...choices.get(row.id), edit: { title: title.value.trim(), date: date.value.trim(), kind: kind.value as MaterialKind | '', chips } });
                editing = null;
                void accept([row.id]);
            };
            const go = button(s.acceptEdited, 'is-primary msp-accept-edited', save);
            form.appendChild(go);
            form.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target as HTMLElement).closest('.msp-person-pick')) { e.preventDefault(); e.stopPropagation(); save(); }
            });
            setTimeout(() => title.focus(), 0);
            return form;
        };

        const drawFoot = () => {
            const n = open().length;
            // The end (spec 102 §5): closing the window closes the proposal, Close is the one action.
            const end = n === 0 && !running(jobNow());
            write.textContent = end ? s.endFoot : s.write;
            closeLink.hidden = end;
            closeBtn.classList.toggle('is-primary', end);
            accAll.textContent = s.acceptAll(n);
            accAll.disabled = tab !== 'proposals' || n === 0;
            accSel.textContent = s.acceptSel(selected.size);
            accSel.disabled = tab !== 'proposals' || selected.size === 0;
            accSel.hidden = accAll.hidden = tab !== 'proposals' || end;
        };

        /**
         * The end of the proposal (spec 102 §5): what was done, what is left
         * in the archive (Sort the next…), what the agent left unassigned.
         * In place of the empty list; the tab stays where it is.
         */
        const endEl = (): HTMLElement => {
            const a = done().filter(x => decided[x.id] === 'accepted').length;
            const rj = done().length - a;
            const box = h('div', 'msp-end');
            const head = h('div', 'msp-end-head');
            // A run still at work (spec 102 §3, §5): what is done so far, and that more proposals will come.
            const v = running(jobNow()) ? runNow() : null;
            if (v) {
                head.append(h('h3', 'msp-end-title', s.endSoFar(a, rj)), h('p', 'msp-end-sub', s.endRunSoFar(v.done.length, v.batches, rows.length)));
                const sec = h('div', 'msp-end-sec');
                const line = h('div', 'msp-run msp-end-run');
                line.innerHTML = runInner(v, s.moreComing(v.batch, v.batches));
                sec.append(line, h('p', 'mdlg-note', s.runNote));
                box.append(head, sec);
                return box;
            }
            head.append(h('h3', 'msp-end-title', s.endTitle(a, rj, unassigned.length)), h('p', 'msp-end-sub', endRunText()));
            box.appendChild(head);
            const now = this.materialsContext();
            const gate = this.materialSortGate();
            const readOnly = DataManager.isReadOnly();
            // What "Sort the next" takes: as the strip counts it, without the files this proposal leaves unassigned.
            const next = this.materialSortNext([...this.materialSortItemMap(mc.treeId).values()], { alsoLeft: unassigned.map(x => x.id) }).send;
            const items = unassigned.map(x => x.item).filter((i): i is MaterialItem => !!i && !i.hidden);
            const sec = (line: string, note?: string): { el: HTMLElement; acts: HTMLElement } => {
                const el = h('div', 'msp-end-sec');
                el.appendChild(h('p', 'msp-end-line', line));
                if (note) el.appendChild(h('p', 'mdlg-note', note));
                const acts = h('div', 'msp-end-acts');
                el.appendChild(acts);
                box.appendChild(el);
                return { el, acts };
            };
            if (next.length && gate && gate !== 'older' && !readOnly) {
                const { acts } = sec(s.restLine(next.length), s.restNote);
                const fifty = !now?.caps.sortRun && next.length > SORT_MAX_FILES;
                const label = fifty ? s.olderNext : s.sortNextN(next.length);
                const go = button(label, 'is-primary msp-sort-next', () => {
                    // Closing the window closes the proposal (nothing waits), then the dialog opens.
                    dialog.close();
                    const rNow = this.materialSortRemembered();
                    if (rNow && sortKey(rNow) === sortKey(r)) this.materialSortForget();
                    this.openSortDialog({ items: next, batch: null, whole: true });
                });
                go.innerHTML = researchBridgeActionLabel(label, 'material-sort');
                if (gate === 'offRun') { go.disabled = true; go.title = s.offRun; }
                acts.appendChild(go);
                if (fifty) acts.appendChild(h('p', 'mdlg-note', s.olderRun));
            }
            // The copies of the files sent that were not sent themselves (§2, §5): hidden as duplicates from here.
            const known = [...this.materialSortItemMap(mc.treeId).values()];
            const copyOf = this.materialSortMarks(known).copyOf;
            const sentIds = new Set(r.run ? r.run.batches.flat() : r.files);
            const copies = known.filter(i => !i.hidden && !!i.file && sentIds.has(copyOf.get(i.file.id) ?? '') && !i.attachment?.places?.length);
            if (copies.length) {
                const { acts } = sec(s.copiesLine(copies.length));
                const can = readOnly ? null : hideCan();
                if (can) {
                    const b = button(s.hideCopies(copies.length), 'msp-hide-copies', () => hide(copies, 'duplicate'));
                    b.disabled = can === 'off';
                    acts.appendChild(b);
                } else acts.remove();
            }
            if (unassigned.length) {
                const { el, acts } = sec(s.leftLine(unassigned.length), s.leftNote);
                if (!next.length) el.insertBefore(h('p', 'mdlg-note msp-end-nothing', s.nothingLeft), el.firstChild);
                if (items.length && materialsWindowOpen()) {
                    acts.appendChild(button(s.reviewByHand(items.length), `msp-review${next.length ? '' : ' is-primary'}`, () => { dialog.close(); this.mwReview(items); }));
                }
                const unrelated = sortUnrelatedHideable(unassigned);
                const can = hideCan();
                if (unrelated.length && can) {
                    const all = button(s.hideUnrelated(unrelated.length), 'msp-hide-unrelated', () => hide(unrelated));
                    all.disabled = can === 'off';
                    acts.appendChild(all);
                }
                if (!acts.childElementCount) acts.remove();
            } else if (!next.length) {
                sec(s.allSorted).acts.remove();
            }
            return box;
        };

        const drawTabs = () => {
            const counts = { proposals: open().length, unassigned: unassigned.length, done: done().length };
            const had = (tabs.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.tab : null) ?? null;
            tabs.replaceChildren(...(['proposals', 'unassigned', 'done'] as const).map(t => {
                const b = button(s.tabs[t](counts[t]), `msp-tab sel-tab${t === tab ? ' is-active' : ''}`, () => { tab = t; editing = null; focusId = null; moreHide(); draw(); });
                b.setAttribute('role', 'tab');
                b.dataset.tab = t;
                b.setAttribute('aria-selected', String(t === tab));
                return b;
            }));
            if (had) tabs.querySelector<HTMLElement>(`[data-tab="${had}"]`)?.focus();
        };
        const draw = () => {
            drawTabs();
            const shown = tab === 'proposals' ? open() : tab === 'unassigned' ? unassigned : done();
            // "N proposals from batch b arrived" goes once the proposals it points to are handled (spec 102 §3).
            if (moreFirst && !open().some(x => x.id === moreFirst)) moreHide();
            if (!focusId || !shown.some(x => x.id === focusId)) focusId = shown[0]?.id ?? null;
            const children: HTMLElement[] = [];
            if (tab === 'unassigned' && unassigned.length) {
                const head = h('div', 'msp-unassigned-head');
                head.appendChild(h('p', 'mdlg-note', s.unassignedNote));
                const items = unassigned.map(x => x.item).filter((i): i is MaterialItem => !!i && !i.hidden);
                const acts = h('div', 'msp-unassigned-acts');
                const unrelated = sortUnrelatedHideable(unassigned);
                const can = hideCan();
                if (unrelated.length && can) {
                    const all = button(s.hideUnrelated(unrelated.length), 'msp-hide-unrelated', () => hide(unrelated));
                    all.disabled = can === 'off';
                    acts.appendChild(all);
                }
                if (items.length && materialsWindowOpen()) {
                    acts.appendChild(button(s.reviewByHand(items.length), 'msp-review', () => { dialog.close(); this.mwReview(items); }));
                }
                if (acts.childElementCount) head.appendChild(acts);
                children.push(head);
            }
            children.push(...shown.map(rowEl));
            // The end (spec 102 §5); a run still at work: what is done so far and that more will come (§3).
            if (!shown.length) children.push(tab === 'proposals' && (!running(jobNow()) || r.run?.id) ? endEl() : h('p', 'msp-empty', s.empty));
            list.replaceChildren(...children);
            drawnKey = shownKey();
            drawFoot();
            drawRun();
            if (editing) return;
            const f = list.querySelector<HTMLElement>(`.msp-row[data-id="${CSS.escape(focusId ?? '')}"]`);
            if (f && list.contains(document.activeElement)) f.focus();
        };

        const accept = async (ids: string[]) => {
            const picked = ids.map(id => assigned.find(x => x.id === id)).filter((x): x is SortRow => !!x && !decided[x.id]);
            if (!picked.length) return;
            // A back side is written with its front, as a row of its own (§10); it is never decided by itself.
            const backIds = new Set<string>();
            const writes = picked.flatMap(x => {
                const front = { row: x, w: sortWrite(x, choices.get(x.id)) };
                const b = backOn(x) && !decided[x.back!.id] ? sortBackRow(x, s.rubSuffix, choices.get(x.id)) : null;
                // A portrait needs the file in the tree, at its person.
                const pid = portraitOn(x) ? x.portrait!.person : null;
                if (pid && front.w && !front.w.places.some(pl => 'personId' in pl && pl.personId === pid && !pl.fact && !pl.eventId)) {
                    front.w.places.push({ personId: pid, by: 'agent' });
                }
                if (!b) return [front];
                backIds.add(b.row.id);
                return [front, { row: b.row, w: sortWrite(b.row, b.choice) }];
            });
            const ok = new Set<string>(writes.filter(x => !x.w && !backIds.has(x.row.id)).map(x => x.row.id));
            const readOnly = DataManager.isReadOnly();
            const byOf = (row: SortRow): 'user' | 'agent' => choices.get(row.id)?.edit?.chips ? 'user' : 'agent';
            let refused = 0;
            const now = this.materialsContext();
            // Material outside the tree: its details and people through the bridge; what the research's
            // assign does not carry (an event, a couple, a source) makes it a file of the tree (§4).
            const staged: Array<{ row: SortRow; w: SortWrite; rv: SortRevert; id: string | null; record: Omit<Attachment, 'id' | 'places'> | null }> = [];
            dialog.busy(true);
            for (const { row, w } of writes) {
                if (!w || w.mediaId || !w.fileId) continue;
                if (!now?.base || !now.caps.bridgeUp) { refused++; continue; }
                const rv: SortRevert = {};
                let good = true;
                const edit: EditRequest = { ids: [w.fileId] };
                if (w.title) edit.title = w.title.value;
                if (w.kind) edit.kind = w.kind.value;
                if (w.date) edit.date = w.date.value;
                if (Object.keys(edit).length > 1) {
                    if (!now.caps.edit) good = false;
                    else {
                        const res = await this.writeMaterialEdit(now, edit);
                        good = res.ok;
                        if (res.ok) {
                            const was = res.value.was[w.fileId] ?? {};
                            rv.was = {};
                            for (const k of ['title', 'kind', 'date'] as const) if (edit[k] !== undefined) rv.was[k] = (was[k] as string | undefined) ?? '';
                        }
                    }
                }
                if (good && w.persons.length) {
                    const added = w.persons.filter(p => !(row.item?.persons ?? []).includes(p));
                    if (!now.caps.assign) good = false;
                    else if (added.length) {
                        good = (await this.writeAssign(now, { files: [w.fileId], add: added })).ok;
                        if (good) rv.persons = added;
                    }
                }
                if (good && (w.places.length || w.newSources.length)) {
                    const id = row.item?.removedId ?? null;
                    const record = readOnly || id || !row.item ? null : await this.materialWorkingCopy(row.item, now);
                    if (readOnly || (!id && !record)) good = false;
                    else staged.push({ row, w, rv, id, record });
                }
                if (good) {
                    ok.add(row.id);
                    if (!staged.some(x => x.row === row) && Object.keys(rv).length) reverts[row.id] = rv;
                } else refused++;
            }
            dialog.busy(false);
            const tree = writes.filter(x => x.w?.mediaId);
            const treeOk = tree.filter(x => !readOnly && DataManager.canEditMedia(x.w!.mediaId!));
            refused += tree.length - treeOk.length;
            for (const { row } of treeOk) ok.add(row.id);
            for (const id of ok) if (!backIds.has(id)) { decided[id] = 'accepted'; selected.delete(id); }
            const a = Object.values(decided).filter(d => d === 'accepted').length;
            const rj = Object.values(decided).filter(d => d === 'rejected').length;
            const text = s.done(a, rj, unassigned.length);
            const toast = refused ? `${text} ${s.notWritten(refused)}` : text;
            if (treeOk.length || staged.length) {
                // The tree's part in one undo step; its Undo toast says what was accepted.
                DataManager.runBatch(s.undoStep, () => {
                    // A source of the research the tree does not know yet: made with the research's number (REFN S…),
                    // as one loaded from it, so a send pairs it with the research's own and a load never doubles it.
                    // Once per number: several files of one source, or a source already made, take the same one.
                    // One an accepted proposal made is each such row's to take out (the last of them does, see revert).
                    const sortMade = (sid: string): boolean => Object.values(reverts).some(x => parseSortRevert(x)?.sources?.includes(sid));
                    const sourcesFor = (w: SortWrite, by: 'user' | 'agent'): { ids: string[]; places: MediaPlace[] } => {
                        const ids: string[] = [];
                        const made: string[] = [];
                        for (const ns of w.newSources) {
                            const known = Object.values(DataManager.getData().sources ?? {}).find(x => x.refn?.trim() === ns.ref);
                            if (known) {
                                if (!ids.includes(known.id)) ids.push(known.id);
                                if (sortMade(known.id) && !made.includes(known.id)) made.push(known.id);
                                continue;
                            }
                            const src = DataManager.addSource({ title: ns.title, refn: ns.ref });
                            if (src) { ids.push(src.id); made.push(src.id); }
                        }
                        return { ids: made, places: ids.map(sourceId => ({ sourceId, by })) };
                    };
                    for (const { row, w } of treeOk) {
                        const id = w!.mediaId!;
                        const att = DataManager.getMedia(id);
                        if (!att) continue;
                        const rv: SortRevert = { media: id, fields: {} };
                        if (w!.title) { rv.fields!.title = { value: att.title ?? '', ...(att.titleBy === 'agent' ? { agent: true } : {}) }; DataManager.setMediaTitle(id, w!.title.value, w!.title.by); }
                        if (w!.kind) { rv.fields!.kind = { value: att.kind ?? '', ...(att.kindBy === 'agent' ? { agent: true } : {}) }; DataManager.setMediaKind(id, w!.kind.value || undefined, w!.kind.by); }
                        if (w!.date) { rv.fields!.date = { value: att.date ?? '', ...(att.dateBy === 'agent' ? { agent: true } : {}) }; DataManager.setMediaDate(id, w!.date.value, w!.date.by); }
                        const made = sourcesFor(w!, byOf(row));
                        const added: MediaPlace[] = [];
                        for (const place of [...w!.places, ...made.places]) if (DataManager.addMediaPlace(id, place)) added.push(place);
                        if (added.length) rv.places = added;
                        if (made.ids.length) rv.sources = made.ids;
                        reverts[row.id] = rv;
                    }
                    for (const st of staged) {
                        const made = sourcesFor(st.w, byOf(st.row));
                        const places = [...st.w.places, ...made.places];
                        const [mid] = DataManager.linkMedia([st.id ? { id: st.id } : { record: st.record! }], places);
                        if (mid) {
                            st.rv.media = mid;
                            if (!st.id) st.rv.created = true;
                            else st.rv.places = places;
                        }
                        if (made.ids.length) st.rv.sources = made.ids;
                        if (Object.keys(st.rv).length) reverts[st.row.id] = st.rv;
                    }
                }, { text: toast });
                this.afterMediaChange();
            } else {
                this.showToast(toast, TOAST_MS, { closable: true, kind: 'materials' });
            }
            remember();
            draw();
            // A portrait accepted with its photo: the portrait editor, one person after another (the crop as always).
            for (const row of picked) {
                if (decided[row.id] !== 'accepted' || !portraitOn(row)) continue;
                const mid = parseSortRevert(reverts[row.id])?.media ?? (row.item?.attachment && !row.item.removedId ? row.item.attachment.id : null);
                if (mid) await this.useAttachmentAsPortrait(row.portrait!.person, mid);
            }
        };

        /** Undo of an accepted row: the research's part through the bridge, the tree's in one undo step; then it is a proposal again. */
        const revert = async (id: string) => {
            const rv = parseSortRevert(reverts[id]);
            if (!rv) return;
            const now = this.materialsContext();
            if (rv.was || rv.persons) {
                if (!now?.base || !now.caps.bridgeUp) {
                    this.showToast(strings.materials.actionsWhenRunning, TOAST_MS, { closable: true, kind: 'materials' });
                    return;
                }
                dialog.busy(true, strings.busy.reverting);
                let good = true;
                if (rv.was) {
                    const edit: EditRequest = { ids: [id] };
                    if (rv.was.title !== undefined) edit.title = rv.was.title;
                    if (rv.was.kind !== undefined) edit.kind = rv.was.kind as MaterialKind | '';
                    if (rv.was.date !== undefined) edit.date = rv.was.date;
                    good = (await this.writeMaterialEdit(now, edit)).ok;
                }
                if (good && rv.persons) good = (await this.writeAssign(now, { files: [id], remove: rv.persons })).ok;
                dialog.busy(false);
                if (!good) {
                    this.showToast(s.revertFailed, TOAST_MS, { closable: true, kind: 'materials' });
                    return;
                }
            }
            if ((rv.media || rv.sources) && !DataManager.isReadOnly()) {
                DataManager.runBatch(s.revertStep, () => {
                    const mid = rv.media;
                    if (mid && rv.created) {
                        DataManager.removeMedia(mid);
                    } else if (mid) {
                        const f = rv.fields ?? {};
                        if (f.title) DataManager.setMediaTitle(mid, f.title.value, f.title.agent ? 'agent' : 'user');
                        if (f.kind) DataManager.setMediaKind(mid, (f.kind.value || undefined) as MaterialKind | undefined, f.kind.agent ? 'agent' : 'user');
                        if (f.date) DataManager.setMediaDate(mid, f.date.value, f.date.agent ? 'agent' : 'user');
                        for (const place of rv.places ?? []) DataManager.removeMediaPlace(mid, place, { keep: true });
                    }
                    // A source it made that another accepted file still has (one source of several files) stays.
                    const inUse = (sid: string): boolean => allMedia(DataManager.getData()).some(a => a.places.some(pl => 'sourceId' in pl && pl.sourceId === sid));
                    for (const sid of rv.sources ?? []) if (!inUse(sid)) DataManager.removeSource(sid);
                }, { text: s.reverted });
                this.afterMediaChange();
            } else {
                this.showToast(s.reverted, TOAST_MS, { closable: true, kind: 'materials' });
            }
            delete decided[id];
            delete reverts[id];
            remember();
            draw();
            // Its back side, written with it, goes back with it.
            const backId = rows.find(x => x.id === id)?.back?.id;
            if (backId && reverts[backId]) await revert(backId);
        };

        list.addEventListener('keydown', e => {
            if (editing) return;
            const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.msp-row');
            if (!rowEl || e.target !== rowEl) {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && tab === 'proposals' && selected.size) { e.preventDefault(); void accept([...selected]); }
                return;
            }
            const id = rowEl.dataset.id ?? '';
            const all = [...list.querySelectorAll<HTMLElement>('.msp-row')];
            const i = all.indexOf(rowEl);
            const move = (j: number) => {
                const next = all[Math.max(0, Math.min(all.length - 1, j))];
                if (!next) return;
                all.forEach(x => { x.tabIndex = -1; });
                next.tabIndex = 0;
                focusId = next.dataset.id ?? null;
                next.focus();
            };
            const key = e.key.toLowerCase();
            if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (tab === 'proposals' && selected.size) void accept([...selected]); }
            else if (tab !== 'proposals' || e.ctrlKey || e.metaKey || e.altKey) return;
            else if (e.key === ' ') {
                e.preventDefault();
                if (selected.has(id)) selected.delete(id); else selected.add(id);
                const cb = rowEl.querySelector<HTMLInputElement>('.msp-check');
                if (cb) cb.checked = selected.has(id);
                drawFoot();
            } else if (key === 'a') { e.preventDefault(); focusId = all[i + 1]?.dataset.id ?? null; void accept([id]); }
            else if (key === 'e') { e.preventDefault(); editing = id; draw(); }
            else if (key === 'r') {
                e.preventDefault();
                decided[id] = 'rejected';
                selected.delete(id);
                focusId = all[i + 1]?.dataset.id ?? all[i - 1]?.dataset.id ?? null;
                remember();
                draw();
                list.querySelector<HTMLElement>(`.msp-row[data-id="${CSS.escape(focusId ?? '')}"]`)?.focus();
            }
        });
        list.addEventListener('focusin', e => {
            const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.msp-row');
            if (rowEl?.dataset.id) focusId = rowEl.dataset.id;
        });
        dialog.box.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !editing && tab === 'proposals' && selected.size && !list.contains(e.target as Node)) {
                e.preventDefault();
                void accept([...selected]);
            }
        });

        // A file hidden or restored meanwhile (Restore here, the toast's Undo): the rows say it as it is now.
        // Only then: the Materials window is redrawn with every poll of the research, the proposal stays as it is.
        const shownKey = () => JSON.stringify([hideCan(), materialsWindowOpen(),
            unassigned.map(x => [x.id, x.item?.hidden ? x.item.hidden.reason ?? 'none' : ''])]);
        let drawnKey = '';
        const redraw = () => {
            if (editing) return;
            const fresh = this.materialSortItemMap(mc.treeId);
            for (const row of unassigned) row.item = fresh.get(row.id) ?? row.item;
            if (shownKey() === drawnKey) return;
            draw();
        };
        proposalRedraw = redraw;

        /** Where this proposal's run is now (spec 102 §3); null without a run. */
        function runNow(): SortRunView | null {
            const now = researchAutoState(mc.treeId).materialSort ?? null;
            return now && sortKey(now) === sortKey(r) ? runViewOf(now) : null;
        }
        /** A run's line: what it says, the run's bar, how far the batch at work is or why it waits. */
        function runInner(v: SortRunView, label: string): string {
            const k = v.batchDone !== undefined ? `<span class="mw-sort-note">${esc(strings.materials.countOf(v.batchDone, v.batchFiles))}</span>` : '';
            const wait = v.waiting ? `<span class="mw-sort-note msp-run-wait">${esc(runWaitText(v.waiting))}</span>` : '';
            const said = v.waiting ? s.runWaiting(v.batch, v.batches) : label;
            return `<span class="mw-sort-run">${esc(said)}</span>${runBarHtml(v, said)}${k}${wait}`;
        }
        /**
         * What the proposal came from (the end's line): the whole run, or only
         * its batches that finished when it was cancelled, stopped or a batch
         * did not run (spec 102 §3); with Try again or Continue the earlier
         * sortings' batches too.
         */
        function endRunText(): string {
            const now = researchAutoState(mc.treeId).materialSort ?? null;
            const cur = now && sortKey(now) === sortKey(r) ? now : r;
            const run = cur.run;
            const cut = !!run && !!(run.cancelled || run.stopped || run.error);
            const own = run ? (cut ? run.done ?? [] : run.batches.map((_, i) => i)) : [0];
            const files = run ? own.reduce((n, i) => n + (run.batches[i]?.length ?? 0), 0) : cur.files.length;
            const earlier = cur.earlier?.length ?? 0;
            if (earlier) return s.endRun(earlier + own.length, rows.length);
            return s.endRun(Math.max(1, own.length), run ? files : rows.length);
        }
        /** The run's line over the list while it works; the end below says it when nothing waits (spec 102 §3, §5). */
        function drawRun(): void {
            const v = running(jobNow()) ? runNow() : null;
            const endShown = tab === 'proposals' && !open().length;
            runLine.hidden = !v || endShown;
            if (v && !endShown) {
                const html = runInner(v, s.runInWindow(v.batch, v.batches));
                if (runBody.innerHTML !== html) runBody.innerHTML = html;
            }
            const endRun = list.querySelector<HTMLElement>('.msp-end-run');
            if (v && endRun) {
                const html = runInner(v, s.moreComing(v.batch, v.batches));
                if (endRun.innerHTML !== html) endRun.innerHTML = html;
            }
        }
        /**
         * A run's batch finished (spec 102 §3): its rows join at the end, the
         * list does not jump and the focus stays; "N proposals from batch b
         * arrived" with Show says it while proposals are being gone through.
         */
        const absorb = (fresh: SortJob) => {
            const wasRunning = running(job);
            job = fresh;
            const known = new Set(rows.map(x => x.id));
            const items = this.materialSortItemMap(mc.treeId);
            const added = withPortraits(sortRows(fresh, id => items.get(id) ?? byId.get(id) ?? null, chipOf).filter(x => !known.has(x.id)));
            const openBefore = open().length;
            if (added.length) {
                rows = [...rows, ...added];
                for (const u of fresh.unproposed ?? []) if (!unproposed.has(u.id)) unproposed.set(u.id, u);
                split();
                const sub = dialog.box.querySelector<HTMLElement>('.mdlg-head .mdlg-sub:not(.msp-know)');
                if (sub) sub.textContent = [r.batch ?? '', s.propSub(rows.length, assigned.length, unassigned.length)].filter(Boolean).join(' · ');
                const proposed = added.filter(sortRowProposes);
                const runR = researchAutoState(mc.treeId).materialSort?.run ?? r.run;
                const batch = proposed.length && runR ? runR.batches.findIndex(b => b.includes(proposed[0].id)) + 1 : 0;
                if (proposed.length && openBefore > 0 && tab === 'proposals' && batch > 0) {
                    moreText.textContent = s.moreArrived(proposed.length, batch);
                    moreFirst = proposed[0].id;
                    more.hidden = false;
                }
            }
            if (editing) { drawRun(); return; }
            if (added.length && tab === 'proposals' && openBefore > 0) {
                // The rows drawn stay as they are: the new ones join at the end.
                for (const row of added.filter(x => sortRowProposes(x) && !decided[x.id])) list.appendChild(rowEl(row));
                drawnKey = shownKey();
                drawTabs();
                drawFoot();
                drawRun();
                return;
            }
            if (added.length || wasRunning !== running(fresh)) {
                const had = list.contains(document.activeElement);
                draw();
                if (had) list.querySelector<HTMLElement>(`.msp-row[data-id="${CSS.escape(focusId ?? '')}"]`)?.focus();
                return;
            }
            drawRun();
        };
        proposalRun = absorb;

        draw();
        list.querySelector<HTMLElement>('.msp-row')?.focus();
    },
});
