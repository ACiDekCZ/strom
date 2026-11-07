/**
 * "Read again…" in the source viewer (spec 059 §4): the research reads a
 * source again from its original (`POST sources/read`) and compares the new
 * reading with the source's transcript. The transcript never changes; a
 * difference becomes a task of the research.
 *
 * Offered only while the research's bridge reads sources again
 * (`read.source`), reads now (`accepts.read.ready`) and its file says it has
 * the source's original (`_STROM_ORIG Y`). The action goes through the bridge
 * and an agent reads: the AI badge alone. A source whose original or
 * transcript the research turned down (409 noscan / notext) loses the action
 * until the research's next file. On a phone (touch, no bridge) a sentence
 * says where reading again works, for a source the computer would offer it at.
 */

import { DataManager } from '../data.js';
import { Source, SourceExcerpt } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { researchBridgeAgentLabel } from './research-open-mark.js';
import { readSourceAgainOffered, readSourceAgainCandidate, readSourceAgainClip, readSourceId, LiveRead, ReadResult } from '../research-read.js';
import { onComputer } from './research-ui.js';
import { researchLinksEnabled } from '../research-device.js';
import { lastBridgeStatus } from './research-sync-ui.js';
import {
    READ_SOURCE_TASK_FEATURE, READ_PROPOSAL_FEATURE, READ_PROPOSAL_UNDO_FEATURE, READ_TASK_HOWS, readProposalStale, readUnsureOn,
    type ReadProposalTake, type ReadSourceProposal, type ReadSourceState, type ReadTaskHow,
} from '../research-read-task.js';
import { postReadTask, postReadProposal } from '../research-read.js';
import {
    sourceRowHtml, sourceRowKind, sourceRowChoices, proposalHtml, proposalActions, readIdDate, readStateShortDate, readStateLongDate,
    type SourceRowAct, type ProposalAct,
} from './read-source-state-view.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sources turned down (`tree|S…`) → the research's file they were turned down at. */
const held = new Map<string, string>();
/** What the open viewer shows of reading its source again (redrawn when it changes). */
let drawnKey = '';

/**
 * The source's row after a newer reading (spec 059 §2), per `tree|S…`: the choices open, a choice on its way or
 * failed, and the state a choice made here (or in the dialog) said until the research's status moves on (`seen`:
 * the status's state when it was made).
 */
const rowOpen = new Set<string>();
const rowAct = new Map<string, SourceRowAct>();
const rowLocal = new Map<string, { state: ReadSourceState; seen: string }>();
/** A reading's counts (sure substantive changes, uncertain places), by its id; asked once. */
const rowCounts = new Map<string, { major: number; unsure: number }>();
const rowCountsAsked = new Set<string>();
/**
 * The agent's proposal (spec 059 §3), per `tree|S…`: the whole text open, an answer on its way or failed, and the
 * answer the research took (`asked`: the transcript it was taken against; shown until undone or the viewer's session ends).
 */
const propWhole = new Set<string>();
const propAct = new Map<string, ProposalAct>();
const propDone = new Map<string, { take: 'proposal' | 'keep'; proposal: ReadSourceProposal; asked: string; at: string }>();

const stateMark = (s: ReadSourceState | null | undefined): string => s ? JSON.stringify(s) : '';

/** The focused button of the row or the proposal, found again after a redraw. */
function focusSelector(el: HTMLElement): string {
    for (const k of ['readHow', 'proposalTake', 'readState', 'proposalAct'] as const) {
        const v = el.dataset[k];
        if (v) return `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${v.replace(/"/g, '')}"]`;
    }
    return '';
}

/** What the viewer shows of reading a source again. */
interface SourceAgainView {
    /** The research's source (S…), '' none. */
    refn: string;
    /** "Read again…" offered now. */
    offered: boolean;
    /** Its reading under way. */
    running: LiveRead | null;
    /** The last reading of it known here that differs from the transcript. */
    after: ReadResult | null;
    /** A phone: the sentence saying reading again works on the computer with the research. */
    phone: boolean;
}

export const readSourceMethods = uiModule({
    /** The research's file now (its head and import time): a new one lifts what it turned down. */
    readSourceFileMark(): string {
        const ctx = this.researchSyncLink();
        return ctx ? `${ctx.link.head ?? ''}|${ctx.link.syncedAt}` : '';
    },

    /** 409 read.source.noscan / notext: no action at the source until the research's next file. */
    holdReadSourceAgain(refn: string): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        held.set(`${treeId}|${refn}`, this.readSourceFileMark());
        this.refreshReadSourceViewer();
    },

    /** The action is held for the source in the research's present file. */
    readSourceAgainHeld(refn: string): boolean {
        const treeId = DataManager.getCurrentTreeId();
        const mark = treeId ? held.get(`${treeId}|${refn}`) : undefined;
        return mark !== undefined && mark === this.readSourceFileMark();
    },

    readSourceAgainView(src: Source): SourceAgainView {
        const none: SourceAgainView = { refn: '', offered: false, running: null, after: null, phone: false };
        const refn = readSourceId(src.refn?.trim());
        if (!onComputer()) {
            // The bridge is on the computer: the research's file alone says the source could be read again there.
            const phone = !!refn && !this.sourceViewerReadOnly && !!this.researchSyncLink() && researchLinksEnabled()
                && !this.activeResearchAgentless() && readSourceAgainCandidate(src);
            return { ...none, refn: phone ? refn : '', phone };
        }
        const link = this.researchOriginalsLink();
        if (!refn || !link || this.sourceViewerReadOnly || !this.readDocumentAccepts()) return none;
        const up = this.researchBridgeUp(link.researchId);
        const running = up ? this.readSourceRunning(refn) : null;
        const offered = up && !running && !this.readSourceAgainHeld(refn)
            && readSourceAgainOffered(this.researchStatusOf(link.researchId), src);
        const last = this.readSourceResultOf(refn);
        return { refn, offered, running, after: last?.source?.agree === 'differ' ? last : null, phone: false };
    },

    /**
     * The links row under the transcript: "Reading result…" (`reading`, when the source has one),
     * "Read again…" or its reading under way, and after a reading that differs, a line saying so.
     */
    readSourceLinksHtml(src: Source, reading: string): string {
        const t = strings.read;
        const view = this.readSourceAgainView(src);
        drawnKey = this.readSourceViewKey(src, view);
        const action = view.running
            ? `<span class="viewer-read-again-live" id="source-viewer-read-again-live"><span class="viewer-read-again-dot" aria-hidden="true"></span>`
              + `<span>${esc(t.readingAgain)}</span> <button type="button" class="link-button viewer-read-again-show" data-read-again-open="${esc(view.running.id)}">${esc(t.show)}</button></span>`
            : view.offered
                ? `<button type="button" class="link-button viewer-read-again" id="source-viewer-read-again" title="${esc(t.sourceAgainTitle)}">${researchBridgeAgentLabel(t.sourceAgain)}</button>`
                : '';
        const row = reading || action ? `<p class="viewer-reading">${reading}${action}</p>` : '';
        // The research says the source's state (spec 059 §2): its row and the agent's proposal; else the line as before.
        const state = view.running ? '' : this.readSourceStateHtml(src);
        const after = state || (view.after && !view.running ? this.readSourceAfterHtml(view.after) : '');
        // A phone: no action, a quiet sentence where it works (spec 059 §5); nothing at an excerpt.
        const phone = view.phone ? `<p class="viewer-read-again-phone" id="source-viewer-read-again-phone">${esc(t.againPhone)}</p>` : '';
        return `${row}${after}${phone}`;
    },

    /** The research's word on the source (`read.sourceTask`, `/status.readAgain`); null: not said (the viewer as before). */
    readSourceStateCtx(src: Source): { rid: string; key: string; refn: string; state: ReadSourceState | null; proposal: ReadSourceProposal | null; features: readonly string[]; up: boolean; phone: boolean } | null {
        const treeId = DataManager.getCurrentTreeId();
        const refn = readSourceId(src.refn?.trim());
        if (!treeId || !refn || this.sourceViewerReadOnly || this.activeResearchAgentless()) return null;
        const rid = this.researchOriginalsLink()?.researchId ?? this.researchSyncLink()?.link.id ?? '';
        if (!rid) return null;
        const status = this.researchStatusOf(rid) ?? lastBridgeStatus(rid);
        const features = status?.features ?? [];
        if (!features.includes(READ_SOURCE_TASK_FEATURE)) return null;
        const key = `${treeId}|${refn}`;
        const said = this.readSourceSaidState(refn);
        const local = rowLocal.get(key);
        let state = said;
        if (local) {
            if (local.seen === stateMark(said)) state = local.state;
            else rowLocal.delete(key);
        }
        // The agent's proposal: with the newer reading's state, else from the waiting list (a source with no differing newer reading).
        const proposal = state?.proposal ?? said?.proposal ?? status?.sourceProposals?.[refn] ?? null;
        return { rid, key, refn, state, proposal, features, up: this.researchBridgeUp(rid), phone: !onComputer() };
    },

    /** §2: the row under the links (and §3 the proposal under it); '' when the research says nothing of the source. */
    readSourceStateHtml(src: Source): string {
        const c = this.readSourceStateCtx(src);
        if (!c) return '';
        const lang = getCurrentLanguage();
        let row = '';
        if (c.state) {
            const s = c.state;
            const kind = sourceRowKind(s);
            const counts = rowCounts.get(s.read) ?? null;
            if (!counts && (kind === 'unchecked' || kind === 'unsure') && c.up) void this.loadReadSourceStateCounts(c.rid, s.read);
            const live = this.readsOfResearch(c.rid).find(r => r.id === s.read);
            const at = readIdDate(s.read) ?? (live?.at ? new Date(live.at) : null);
            row = sourceRowHtml({
                state: s, date: at ? readStateShortDate(at, lang) : '', counts,
                confirmed: !!this.sourceConfirmState(src).conf, unsure: this.readSourceUnsure(c), phone: c.phone, bridgeUp: c.up,
                canOpenTask: !c.phone && this.researchLinkAvailable('task'),
                open: rowOpen.has(c.key), act: rowAct.get(c.key) ?? null,
            });
        }
        return row + this.readSourceProposalHtml(src, c);
    },

    /** The research offers the source's uncertain places to hand over (spec 059 K8.2; only with `read.sourceTask.unsure`). */
    readSourceUnsure(c: { state: ReadSourceState | null; features: readonly string[] }): boolean {
        return !!c.state?.unsureOffer && readUnsureOn(c.features);
    },

    /** §3: the agent's proposal for the confirmed transcript ('' none). */
    readSourceProposalHtml(src: Source, ctx?: ReturnType<typeof readSourceMethods.readSourceStateCtx>): string {
        const c = ctx === undefined ? this.readSourceStateCtx(src) : ctx;
        if (!c) return '';
        const done = propDone.get(c.key);
        const proposal = done?.proposal ?? c.proposal;
        if (!proposal) return '';
        return proposalHtml({
            proposal, transcript: done?.asked ?? src.transcript ?? '', lang: getCurrentLanguage(), ...proposalActions(c.features, c.phone, c.up),
            canOpenTask: !c.phone && this.researchLinkAvailable('task'),
            whole: propWhole.has(c.key), done: done?.take ?? '', act: propAct.get(c.key) ?? null,
        });
    },

    /** The transcript the viewer shows: the accepted proposal's text and its note until the tree has it (null: the tree's own). */
    readSourceTranscriptShown(src: Source): { text: string; note: string } | null {
        const treeId = DataManager.getCurrentTreeId();
        const refn = readSourceId(src.refn?.trim());
        const done = treeId && refn ? propDone.get(`${treeId}|${refn}`) : undefined;
        if (!done || done.take !== 'proposal') return null;
        const own = src.transcript ?? '';
        if (own !== done.asked && own !== done.proposal.text) return null;
        const at = new Date(done.at);
        return { text: done.proposal.text, note: strings.read.pChanged(done.proposal.task, readStateLongDate(at, getCurrentLanguage())) };
    },

    /** A reading's counts for the row's sentence, from its result (once); the viewer redrawn when they come. */
    async loadReadSourceStateCounts(rid: string, read: string): Promise<void> {
        if (rowCountsAsked.has(read)) return;
        rowCountsAsked.add(read);
        const res = await this.loadReadResult(rid, read);
        if (!res?.source) return;
        let counts: { major: number; unsure: number };
        try {
            const sorted = this.readSourceCounts(res);
            counts = { major: sorted.major, unsure: sorted.unsure };
        } catch {
            return;
        }
        rowCounts.set(read, counts);
        this.refreshReadSourceViewer();
    },

    /** A choice made for a source's newer reading (here or in the dialog): the row says it until the research's status does. */
    noteReadSourceTask(refn: string, read: string, how: ReadTaskHow, task: string): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId) return;
        const key = `${treeId}|${refn}`;
        const seen = stateMark(this.readSourceSaidState(refn));
        const state: ReadSourceState = how === 'save'
            ? { read, state: 'saved' }
            : { read, state: 'task', ...(task ? { task } : {}), taskFor: how === 'review' ? 'person' : 'agent', taskOpen: true, ...(how === 'queue' ? { taskQueued: true } : {}) };
        rowLocal.set(key, { state, seen });
    },

    /**
     * The research's own state of a source (no local word): its status, or the newest reading's word on the source
     * (`source.state`) when the status is older than that reading: it names an older reading, or it was taken
     * while this one still ran (just read, the status not asked since).
     */
    readSourceSaidState(refn: string): ReadSourceState | null {
        const rid = this.researchOriginalsLink()?.researchId ?? this.researchSyncLink()?.link.id ?? '';
        const status = rid ? this.researchStatusOf(rid) ?? lastBridgeStatus(rid) : null;
        const fromStatus = status?.readAgain?.[refn] ?? null;
        const fromResult = this.readSourceResultOf(refn)?.source?.state ?? null;
        if (!fromResult) return fromStatus;
        const newer = fromStatus ? fromResult.read > fromStatus.read
            : !!status?.reads?.some(r => r.id === fromResult.read && r.state !== 'done');
        return newer ? fromResult : fromStatus;
    },

    /**
     * §2: a choice at the row — the bridge as in the dialog's footer; "Check now" opens the task's conversation.
     * `unsure`: only the uncertain places, where the research offers them (spec 059 K8.2).
     */
    async readSourceStateChoose(src: Source, how: ReadTaskHow, unsure = false): Promise<void> {
        const c = this.readSourceStateCtx(src);
        if (!c?.state || !c.up || rowAct.get(c.key)?.busy || !READ_TASK_HOWS.includes(how)) return;
        const offer = sourceRowChoices(sourceRowKind(c.state), !!this.sourceConfirmState(src).conf, this.readSourceUnsure(c));
        if (!offer?.choices.some(x => x.how === how && !!x.unsure === unsure)) return;
        const u = unsure ? { unsure } : {};
        const act: SourceRowAct = { how, ...u, busy: true };
        rowAct.set(c.key, act);
        this.redrawReadSourceState(src);
        const reply = await postReadTask(this.readBridgeBase(c.rid), c.refn, c.state.read, how, unsure);
        if (rowAct.get(c.key) !== act) return;
        if (!reply.ok) {
            rowAct.set(c.key, { how, ...u, busy: false, failed: true });
            this.redrawReadSourceState(src);
            return;
        }
        if (reply.value.outcome) {
            // Decided meanwhile, or a task already holds the places: the research's state asked again, nothing guessed here.
            const outcome = reply.value.outcome;
            if (outcome === 'settled') rowAct.set(c.key, { how, ...u, busy: false, settled: true });
            else if (outcome === 'held') { rowAct.delete(c.key); rowOpen.delete(c.key); }
            else rowAct.set(c.key, { how, ...u, busy: false, answer: outcome });
            this.redrawReadSourceState(src);
            void this.pollResearchBridge({ reschedule: false });
            return;
        }
        rowAct.delete(c.key);
        rowOpen.delete(c.key);
        const task = reply.value.task;
        this.noteReadSourceTask(c.refn, c.state.read, how, task);
        this.redrawReadSourceState(src);
        if (how === 'now' && task) {
            const url = this.activeResearchLink('task', { task, taskDo: 'chat' });
            if (url) this.launchResearchLink(url);
        }
    },

    /** §3: Accept / Keep / Undo through the bridge, no confirmation dialog. */
    async readSourceProposalTake(src: Source, take: ReadProposalTake): Promise<void> {
        const c = this.readSourceStateCtx(src);
        if (!c || !c.up || propAct.get(c.key)?.busy) return;
        const done = propDone.get(c.key);
        const proposal = done?.proposal ?? c.proposal;
        if (!proposal || (take === 'undo') !== !!done) return;
        const act: ProposalAct = { take, busy: true };
        propAct.set(c.key, act);
        this.redrawReadSourceState(src);
        const reply = await postReadProposal(this.readBridgeBase(c.rid), c.refn, proposal.task, take);
        if (propAct.get(c.key) !== act) return;
        if (!reply.ok) {
            // The proposal moved on meanwhile (answered, another wording, nothing to undo): its state asked again.
            const stale = readProposalStale(reply.failure.status, reply.failure.code);
            propAct.set(c.key, { take, busy: false, ...(stale ? { stale: true } : { failed: true }) });
            if (stale && take === 'undo') propDone.delete(c.key);
            this.redrawReadSourceState(src);
            if (stale) void this.pollResearchBridge({ reschedule: false });
            return;
        }
        propAct.delete(c.key);
        if (take === 'undo') propDone.delete(c.key);
        else propDone.set(c.key, { take, proposal, asked: src.transcript ?? '', at: new Date().toISOString() });
        // The transcript shown changes with the answer: the whole viewer.
        this.renderSourceViewer();
    },

    /** The row and the proposal redrawn in place (the viewer keeps its scroll and the focused button). */
    redrawReadSourceState(src: Source): void {
        const modal = document.getElementById('source-viewer-modal');
        const old = modal ? [...modal.querySelectorAll<HTMLElement>('#source-viewer-read-state, #source-viewer-proposal')] : [];
        if (!old.length) { this.refreshReadSourceViewer(); return; }
        const active = document.activeElement as HTMLElement | null;
        const focus = active && old.some(o => o.contains(active)) ? focusSelector(active) : '';
        const tmp = document.createElement('div');
        tmp.innerHTML = this.readSourceStateHtml(src);
        const nodes = [...tmp.children] as HTMLElement[];
        for (const n of nodes) old[0].before(n);
        old.forEach(o => o.remove());
        nodes.forEach(n => this.wireReadSourceState(n, src, true));
        if (focus) nodes.map(n => n.querySelector<HTMLElement>(focus)).find(Boolean)?.focus({ preventScroll: true });
        drawnKey = this.readSourceViewKey(src, this.readSourceAgainView(src));
    },

    /** The row's and the proposal's buttons. */
    wireReadSourceState(root: HTMLElement, src: Source, results: boolean): void {
        const key = (): string => this.readSourceStateCtx(src)?.key ?? '';
        root.querySelectorAll<HTMLElement>('[data-read-state="toggle"]').forEach(el => el.addEventListener('click', () => {
            const k = key();
            if (!k) return;
            if (rowOpen.has(k)) { rowOpen.delete(k); if (!rowAct.get(k)?.busy) rowAct.delete(k); } else rowOpen.add(k);
            this.redrawReadSourceState(src);
        }));
        root.querySelectorAll<HTMLElement>('[data-read-how]').forEach(el => el.addEventListener('click', () => {
            void this.readSourceStateChoose(src, el.dataset.readHow as ReadTaskHow, el.dataset.readUnsure === 'true');
        }));
        root.querySelectorAll<HTMLElement>('[data-read-state="task"], [data-proposal-act="task"]').forEach(el => el.addEventListener('click', () => {
            const url = el.dataset.task ? this.activeResearchLink('task', { task: el.dataset.task }) : null;
            if (url) this.launchResearchLink(url);
        }));
        root.querySelectorAll<HTMLElement>('[data-proposal-act="whole"]').forEach(el => el.addEventListener('click', () => {
            const k = key();
            if (!k) return;
            if (propWhole.has(k)) propWhole.delete(k); else propWhole.add(k);
            this.redrawReadSourceState(src);
        }));
        root.querySelectorAll<HTMLElement>('[data-proposal-take]').forEach(el => el.addEventListener('click', () => {
            void this.readSourceProposalTake(src, el.dataset.proposalTake as ReadProposalTake);
        }));
        // Redrawn in place: the result link wired here (the viewer's own wiring went with the old row).
        if (results) {
            root.querySelectorAll<HTMLElement>('[data-read-again-open]').forEach(el => {
                el.addEventListener('click', () => this.showReadDocumentDialog({ readId: el.dataset.readAgainOpen }));
            });
        }
    },

    /** "Read again 6 Nov 2026 · 2 places differ from the transcript · Result ›". */
    readSourceAfterHtml(res: ReadResult): string {
        const t = strings.read;
        const link = this.researchOriginalsLink();
        const live = link ? this.readsOfResearch(link.researchId).find(r => r.id === res.id) : undefined;
        const at = new Date(live?.at || Date.now());
        const date = at.toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
        const n = Math.max(1, res.source?.variants.length ?? 1);
        return `<p class="viewer-read-again-after" id="source-viewer-read-again-after"><span>${esc(t.againAfter(date, n))}</span>`
            + ` <button type="button" class="link-button viewer-read-again-result" data-read-again-open="${esc(res.id)}">${esc(t.againResultLink)}</button></p>`;
    },

    /**
     * "Read again…" beside an excerpt's "Full quality": that excerpt alone, only for a source of one
     * excerpt (a single excerpt of several would be compared with the whole transcript).
     */
    readSourceExcerptHtml(src: Source, excerpts: SourceExcerpt[], i: number): string {
        const view = this.readSourceAgainView(src);
        if (!view.offered || !this.readSourceExcerptClip(src, excerpts, i)) return '';
        const t = strings.read;
        return `<button type="button" class="link-button viewer-read-again viewer-read-again--excerpt" data-read-again-clip="${i}"
                    title="${esc(t.sourceAgainTitle)}">${researchBridgeAgentLabel(t.sourceAgain)}</button>`;
    },

    /** The clip to read the viewer's excerpt `i` by ('' none: the source has other excerpts in the research). */
    readSourceExcerptClip(src: Source, excerpts: SourceExcerpt[], i: number): string {
        const exc = excerpts[i];
        if (!exc) return '';
        // Excerpts the research holds back from the file count too.
        const heldOnes = (src.heldClips ?? []).filter(c => !excerpts.some(e => e.clip === c))
            .map(c => ({ id: `held-${c}`, clip: c }) as SourceExcerpt);
        return readSourceAgainClip({ excerpts: [...excerpts, ...heldOnes] }, exc.id) ?? '';
    },

    wireReadSourceAgain(body: HTMLElement, src: Source, excerpts: SourceExcerpt[]): void {
        body.querySelector('#source-viewer-read-again')?.addEventListener('click', () => this.showReadSourceAgain(src.id));
        body.querySelectorAll<HTMLElement>('[data-read-again-clip]').forEach(el => {
            el.addEventListener('click', () => this.showReadSourceAgain(src.id, this.readSourceExcerptClip(src, excerpts, Number(el.dataset.readAgainClip))));
        });
        body.querySelectorAll<HTMLElement>('[data-read-again-open]').forEach(el => {
            el.addEventListener('click', () => this.showReadDocumentDialog({ readId: el.dataset.readAgainOpen }));
        });
        body.querySelectorAll<HTMLElement>('#source-viewer-read-state, #source-viewer-proposal').forEach(el => this.wireReadSourceState(el, src, false));
    },

    readSourceViewKey(src: Source, view: SourceAgainView): string {
        // The research's state of the source (and what was done here with it) redraws the viewer when it moves.
        const c = this.readSourceStateCtx(src);
        const state = c ? [stateMark(c.state), c.proposal ? JSON.stringify(c.proposal) : '', c.up, rowCounts.get(c.state?.read ?? '')?.major ?? '', rowCounts.get(c.state?.read ?? '')?.unsure ?? '',
            propDone.get(c.key)?.take ?? '', c.features.includes(READ_PROPOSAL_FEATURE), c.features.includes(READ_PROPOSAL_UNDO_FEATURE), readUnsureOn(c.features)].join('/') : '';
        return [src.id, view.refn, view.offered, view.running?.id ?? '', view.after?.id ?? '', view.after?.source?.variants.length ?? '', view.phone, state].join('|');
    },

    /** After readings, a refusal or a status: the open viewer redrawn when what it shows of reading again changed. */
    refreshReadSourceViewer(): void {
        const id = this.sourceViewerId;
        if (!id || !document.getElementById('source-viewer-modal')?.classList.contains('active')) return;
        const src = DataManager.getData().sources?.[id];
        if (!src) return;
        if (this.readSourceViewKey(src, this.readSourceAgainView(src)) === drawnKey) return;
        this.renderSourceViewer();
    },
});
