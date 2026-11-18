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
import { strings } from '../strings.js';
import type { Attachment, MaterialKind, MediaPlace, PersonId } from '../types.js';
import {
    MaterialItem, MaterialError, SortJob, SortLink, SORT_MAX_TEXT, type EditRequest,
    startMaterialSort, fetchMaterialSort, cancelMaterialSort, fetchMaterial, cachedMaterialList,
    getCachedThumb, fileExt, mergeIntoCache, materialErrorText, materialKindLabel,
} from '../materials.js';
import { overviewItems, nameWithoutYears } from '../materials-overview.js';
import {
    sortCandidates, sortNeeds, sortRows, sortRowProposes, sortWrite, sortTreeIndex, sortChip, parseSortRevert,
    type SortRow, type SortChoice, type SortChip, type SortRevert, type SortWrite,
} from '../material-sort.js';
import { researchPersonRef } from '../research-link.js';
import { PersonPicker } from '../person-picker.js';
import { researchAutoState, patchResearchAutoState, type ResearchSortRemembered } from '../research-device.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { materialDialog, button, type MaterialDialog } from './material-actions-ui.js';
import { treeRecords, materialsWindowOpen } from './materials-window.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';
import { runBusy } from './busy.js';

/** Asking about a sorting at work: every 2 s, 10 s while the page is hidden, 15 s while the bridge is down (spec 102 §13). */
const POLL_MS = 2_000;
const POLL_HIDDEN_MS = 10_000;
const POLL_DOWN_MS = 15_000;
const PREVIEWS = 6;
const TOAST_MS = 8000;

/** Whether sorting is offered: on, offered but off (not running), only said (an older research), or not at all. */
export type SortGate = 'on' | 'offRun' | 'older' | null;

/** What a strip or a selection would send. */
export interface SortTarget {
    items: MaterialItem[];
    /** The batch's name (the dialog's "from the batch …"). */
    batch: string | null;
    /** The files of a review filter (Without title / Without person), not of a batch. */
    filter?: boolean;
}

/** Where the strips stand in the Materials window: under batch headers (by group key) and over the list. */
export interface SortPlan {
    rows: Map<string, { target: SortTarget; state: boolean }>;
    top: { target: SortTarget | null; state: boolean } | null;
}

/** The sorting asked about now (one per page: the active tree's). */
let watch: { treeId: string; id: string; timer: ReturnType<typeof setTimeout> | null; job: SortJob | null; busy: boolean } | null = null;

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
function previewEl(treeId: string, item: MaterialItem | null, cls: string): HTMLElement {
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

    /** The sorting remembered for the active tree (null: none). */
    materialSortRemembered(): ResearchSortRemembered | null {
        const mc = this.materialsContext();
        return mc ? researchAutoState(mc.treeId).materialSort ?? null : null;
    },

    /** A sorting is at work now (a new one waits until it ends). */
    materialSortBusy(): boolean {
        const r = this.materialSortRemembered();
        if (!r || r.ended) return false;
        return watch?.id === r.id ? running(watch.job) : true;
    },

    /**
     * The sorting on the research menu's Materials row (13e): 'run' while the
     * agent works (a green dot), 'ready' once its proposal waits (the waiting
     * dot). Asking about a remembered sorting starts here too (GET only).
     */
    materialSortMenuMark(): 'run' | 'ready' | null {
        const r = this.materialSortRemembered();
        if (!r || r.ended || !this.materialSortGate()) return null;
        this.materialSortWatch();
        const job = watch?.id === r.id ? watch.job : null;
        if (hasProposal(job)) return job!.proposals.some(p => !r.decided[p.id] && (p.title || p.date || p.kind || p.links.length)) ? 'ready' : null;
        return running(job) ? 'run' : null;
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
        const { send, over } = sortCandidates(target.items);
        if (!send.length) return;
        const n = send.length;
        const dialog = materialDialog({ title: s.title(n), sub: s.what(n, target.batch), modifier: 'sort' });
        dialog.box.classList.add('mdlg--sort');

        const strip = h('div', 'mdlg-sort-previews');
        for (const item of send.slice(0, PREVIEWS)) {
            const tile = previewEl(mc.treeId, item, 'mdlg-sort-preview');
            tile.title = item.title;
            strip.appendChild(tile);
        }
        if (n > PREVIEWS) strip.appendChild(h('span', 'mdlg-sort-more', s.more(n - PREVIEWS)));
        dialog.body.appendChild(strip);
        if (over) dialog.body.appendChild(h('p', 'mdlg-note', s.tooMany(n)));

        const field = h('label', 'mdlg-sort-know');
        field.appendChild(h('span', 'mdlg-sort-know-label', s.know));
        const area = h('textarea', 'mdlg-sort-text');
        area.maxLength = SORT_MAX_TEXT;
        area.rows = 3;
        area.placeholder = s.knowPh;
        area.id = 'mdlg-sort-text';
        const hint = h('span', 'mdlg-check-hint', s.knowHint);
        hint.id = 'mdlg-sort-hint';
        area.setAttribute('aria-describedby', hint.id);
        field.append(area, hint);
        dialog.body.appendChild(field);
        dialog.body.appendChild(h('p', 'mdlg-text', s.will));
        dialog.body.appendChild(h('p', 'mdlg-text', s.keep));
        const note = h('p', 'mdlg-note mdlg-sort-note');
        note.append(h('span', 'mdlg-sort-privacy', s.privacy), document.createTextNode(' '), h('span', 'mdlg-sort-cost', s.cost));
        dialog.body.appendChild(note);

        const go = button(s.go, 'is-primary mdlg-sort-go', () => void run());
        go.innerHTML = researchBridgeActionLabel(s.go, 'material-sort');
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
        dialog.box.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!go.disabled) go.click();
            }
        });
        area.focus();

        let sent = false;
        const run = async () => {
            if (sent) return;
            const now = this.materialsContext();
            if (!now?.base || !now.caps.sort || !now.caps.bridgeUp) {
                dialog.error(s.offRun);
                return;
            }
            sent = true;
            dialog.busy(true, strings.busy.sending);
            dialog.error(null);
            const ids = send.map(i => i.file!.id);
            const text = area.value.trim().slice(0, SORT_MAX_TEXT);
            const res = await startMaterialSort(now.base, { ids, text });
            dialog.busy(false);
            if (!res.ok) {
                sent = false;
                dialog.error(sortErrorText(res.error, now.agent));
                return;
            }
            const remembered: ResearchSortRemembered = {
                id: res.value.id, files: ids, text, at: new Date().toISOString(), decided: {},
                ...(target.batch ? { batch: target.batch } : {}),
            };
            patchResearchAutoState(now.treeId, { materialSort: remembered });
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
        if (!mc || !r || r.ended) { if (watch && (!r || watch.id !== r.id)) this.materialSortStop(); return; }
        if (watch && (watch.id !== r.id || watch.treeId !== mc.treeId)) this.materialSortStop();
        if (!watch) watch = { treeId: mc.treeId, id: r.id, timer: null, job: null, busy: false };
        if (watch.timer || watch.busy || (watch.job && !running(watch.job))) return;
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
        const mc = this.materialsContext();
        const again = (ms: number) => { if (watch === w) w.timer = setTimeout(() => void this.materialSortTick(), ms); };
        if (!mc || mc.treeId !== w.treeId) { this.materialSortStop(); return; }
        if (!mc.base || !mc.caps.bridgeUp) { again(POLL_DOWN_MS); return; }
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
        w.job = res.value;
        if (running(res.value)) {
            again(document.hidden ? POLL_HIDDEN_MS : POLL_MS);
        } else if (hasProposal(res.value)) {
            if (was && running(was)) {
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

    /** Cancel the sorting; with proposals already made, whether to keep them (default) is asked. */
    async materialSortCancel(): Promise<void> {
        const mc = this.materialsContext();
        const w = watch;
        // Asked already and not answered (the strip drawn anew meanwhile has a new button): nothing more.
        if (!mc?.base || !w || cancelAsking) return;
        cancelAsking = true;
        let res: Awaited<ReturnType<typeof cancelMaterialSort>>;
        try {
            res = await cancelMaterialSort(mc.base, w.id);
        } finally {
            cancelAsking = false;
        }
        if (!res.ok) { this.materialErrorToast(mc, res.error, () => void this.materialSortCancel()); return; }
        const made = w.job?.proposals.length ?? 0;
        if (made > 0) {
            const s = strings.materials.agentSort;
            const dialog = materialDialog({ title: s.discardAsk });
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
     * The strip in the Materials window (13b, 13e) for the remembered sorting:
     * at work (progress, Cancel), its proposal ready (Open), or ended (Close).
     */
    materialSortStateHtml(): string {
        const s = strings.materials.agentSort;
        const r = this.materialSortRemembered();
        if (!r || !this.materialSortGate()) return '';
        if (r.ended) {
            return `<span class="mw-sort-text">${esc(r.ended === 'cancelled' ? s.cancelled : s.failed)}</span>
                <button type="button" class="link-button" data-sort="dismiss">${esc(s.dismiss)}</button>`;
        }
        const job = watch?.id === r.id ? watch.job : null;
        if (hasProposal(job)) {
            return `<span class="mw-sort-text">${esc(s.ready)}</span>
                <button type="button" class="link-button mw-sort-open" data-sort="open">${esc(s.open)}</button>`;
        }
        const total = job?.files.length || r.files.length;
        const k = Math.min(total, job?.proposals.length ?? 0);
        const pct = total ? Math.round((k / total) * 100) : 0;
        const label = job && job.state !== 'queued' ? s.run(k, total) : s.queued;
        return `<span class="mw-sort-text"><span class="mw-sort-run">${esc(label)}</span>
                <span class="mw-sort-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${k}"><span style="width: ${pct}%"></span></span>
                <span class="mw-sort-note">${esc(s.runNote)}</span></span>
                <button type="button" class="link-button" data-sort="cancel">${esc(strings.buttons.cancel)}</button>`;
    },

    /** The offer over a batch's (or a review filter's) files without a title or a person; '' = none. */
    materialSortOfferHtml(target: SortTarget | null): string {
        const s = strings.materials.agentSort;
        const gate = this.materialSortGate();
        if (!target || !gate) return '';
        const needs = sortNeeds(target.items.filter(i => !!i.file && !i.hidden));
        if (!needs.n || (!needs.t && !needs.p)) return '';
        // An older research is said beside a batch only (spec 102 §13: elsewhere nothing).
        if (gate === 'older') return target.filter ? '' : `<span class="mw-sort-text">${esc(s.older)}</span>`;
        const what = target.filter ? s.stripFilter(needs.n) : s.strip(needs.n, needs.t, needs.p);
        const off = gate === 'offRun' ? ` aria-disabled="true" title="${esc(s.offRun)}"` : '';
        return `<span class="mw-sort-text">${esc(what)}${gate === 'offRun' ? ` · ${esc(s.offRun)}` : ''}</span>
            <button type="button" class="secondary mw-sort-btn" data-sort="sort"${off}>${researchBridgeActionLabel(s.sort, 'material-sort')}</button>`;
    },

    /** A click in the strip. */
    materialSortStripClick(e: MouseEvent, target: SortTarget | null): void {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
        if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
        const mc = this.materialsContext();
        switch (btn.dataset.sort) {
            case 'sort': if (target) this.openSortDialog(target); return;
            case 'open': void this.openSortProposal(); return;
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
        let job = watch?.id === r.id ? watch.job : null;
        if (!hasProposal(job)) {
            if (!mc.base || !mc.caps.bridgeUp) return;
            const res = await fetchMaterialSort(mc.base, r.id);
            if (!res.ok || !hasProposal(res.value)) return;
            job = res.value;
            if (watch?.id === r.id) watch.job = job;
        }
        if (job) this.materialSortProposalWindow(mc, r, job);
    },

    materialSortProposalWindow(mc: MaterialsContext, r: ResearchSortRemembered, job: SortJob): void {
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
        const rows = sortRows(job, id => byId.get(id) ?? null, chipOf);
        const decided: Record<string, 'accepted' | 'rejected'> = { ...r.decided };
        // What undoes each accepted row (Undo under Done): kept with the sorting, so it outlives a reload.
        const reverts: Record<string, unknown> = { ...(r.reverts ?? {}) };
        const choices = new Map<string, SortChoice>();
        const selected = new Set<string>();
        let tab: 'proposals' | 'unassigned' | 'done' = 'proposals';
        let editing: string | null = null;
        let focusId: string | null = null;

        const assigned = rows.filter(sortRowProposes);
        const unassigned = rows.filter(x => !sortRowProposes(x));
        const open = () => assigned.filter(x => !decided[x.id]);
        const done = () => assigned.filter(x => decided[x.id]);
        const remember = () => {
            const now = researchAutoState(mc.treeId).materialSort;
            if (now?.id !== r.id) return;
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
            onClose: () => this.refreshMaterialsWindow(),
        });
        dialog.box.id = 'material-sort-proposal';
        if (r.text) dialog.box.querySelector('.mdlg-head')?.appendChild(h('p', 'mdlg-sub msp-know', s.propKnow(r.text)));

        const tabs = h('div', 'msp-tabs');
        tabs.setAttribute('role', 'tablist');
        const list = h('div', 'msp-list');
        list.setAttribute('role', 'list');
        dialog.body.append(tabs, list);
        const foot = dialog.foot;
        const write = h('p', 'mdlg-note msp-write', s.write);
        const accSel = button('', 'msp-accept-sel', () => void accept([...selected]));
        const accAll = button('', 'is-primary msp-accept-all', () => void accept(open().map(x => x.id)));
        foot.append(write, button(strings.buttons.close, '', () => dialog.close()), accSel, accAll);

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

        const rowEl = (row: SortRow): HTMLElement => {
            const item = row.item;
            const p = row.proposal;
            const el = h('div', 'msp-row');
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
            el.appendChild(previewEl(mc.treeId, item, 'msp-thumb'));
            const main = h('div', 'msp-main');
            if (editing === row.id && tab === 'proposals') {
                main.appendChild(editForm(row));
            } else {
                main.appendChild(h('div', 'msp-title', titleShown));
                if (item && item.name !== titleShown) main.appendChild(h('div', 'msp-file', item.name));
                const meta = h('div', 'msp-meta');
                const date = row.date && (row.date.human === undefined || use.date) ? row.date.proposed : row.date?.human;
                const kind = row.kind && (row.kind.human === undefined || use.kind) ? row.kind.proposed : row.kind?.human;
                const bits = [date ?? '', kind ? kindText(kind) : ''].filter(Boolean);
                if (bits.length) meta.appendChild(document.createTextNode(`${bits.join(' · ')} · `));
                if (p) {
                    const conf = h('span', `msp-conf is-${p.sure}`, s.conf[p.sure === 'medium' ? 'medium' : p.sure]);
                    meta.appendChild(conf);
                }
                main.appendChild(meta);
                for (const line of [fieldLine(row, 'title', v => v), fieldLine(row, 'date', v => v), fieldLine(row, 'kind', kindText)]) if (line) main.appendChild(line);
                if (row.chips.length) {
                    const chips = h('div', 'msp-chips');
                    for (const c of row.chips) chips.appendChild(h('span', `msp-chip is-${c.kind}${c.place || c.person ? '' : ' is-unknown'}`, c.label));
                    main.appendChild(chips);
                }
                if (p?.why) main.appendChild(h('div', 'msp-why', tab === 'unassigned' ? `${s.unassignedWhy}: ${p.why}` : p.why));
            }
            el.appendChild(main);
            const acts = h('div', 'msp-acts');
            if (tab === 'proposals' && editing !== row.id) {
                acts.append(
                    button(s.accept, 'is-primary msp-accept', () => void accept([row.id])),
                    button(s.edit, 'msp-edit', () => { editing = row.id; focusId = row.id; draw(); }),
                    button(s.reject, 'msp-reject', () => { decided[row.id] = 'rejected'; selected.delete(row.id); remember(); draw(); }),
                );
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
            accAll.textContent = s.acceptAll(n);
            accAll.disabled = tab !== 'proposals' || n === 0;
            accSel.textContent = s.acceptSel(selected.size);
            accSel.disabled = tab !== 'proposals' || selected.size === 0;
            accSel.hidden = accAll.hidden = tab !== 'proposals';
        };

        const draw = () => {
            const counts = { proposals: open().length, unassigned: unassigned.length, done: done().length };
            tabs.replaceChildren(...(['proposals', 'unassigned', 'done'] as const).map(t => {
                const b = button(s.tabs[t](counts[t]), `msp-tab${t === tab ? ' is-active' : ''}`, () => { tab = t; editing = null; focusId = null; draw(); });
                b.setAttribute('role', 'tab');
                b.dataset.tab = t;
                b.setAttribute('aria-selected', String(t === tab));
                return b;
            }));
            const shown = tab === 'proposals' ? open() : tab === 'unassigned' ? unassigned : done();
            if (!focusId || !shown.some(x => x.id === focusId)) focusId = shown[0]?.id ?? null;
            const children: HTMLElement[] = [];
            if (tab === 'unassigned' && unassigned.length) {
                const head = h('div', 'msp-unassigned-head');
                head.appendChild(h('p', 'mdlg-note', s.unassignedNote));
                const items = unassigned.map(x => x.item).filter((i): i is MaterialItem => !!i);
                if (items.length && materialsWindowOpen()) {
                    head.appendChild(button(s.reviewByHand(items.length), 'msp-review', () => { dialog.close(); this.mwReview(items); }));
                }
                children.push(head);
            }
            children.push(...shown.map(rowEl));
            if (!shown.length) children.push(h('p', 'msp-empty', s.empty));
            list.replaceChildren(...children);
            drawFoot();
            if (editing) return;
            const f = list.querySelector<HTMLElement>(`.msp-row[data-id="${CSS.escape(focusId ?? '')}"]`);
            if (f && list.contains(document.activeElement)) f.focus();
        };

        const accept = async (ids: string[]) => {
            const picked = ids.map(id => assigned.find(x => x.id === id)).filter((x): x is SortRow => !!x && !decided[x.id]);
            if (!picked.length) return;
            const writes = picked.map(x => ({ row: x, w: sortWrite(x, choices.get(x.id)) }));
            const ok = new Set<string>(writes.filter(x => !x.w).map(x => x.row.id));
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
            for (const id of ok) { decided[id] = 'accepted'; selected.delete(id); }
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

        draw();
        list.querySelector<HTMLElement>('.msp-row')?.focus();
    },
});
