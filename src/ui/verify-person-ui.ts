/**
 * Verifying facts for a person and for the tree (spec 065, kolo 3, §10 h–m):
 * "Verify facts (N)" in the card mark's tip and "Verify facts · N" in the
 * person menu, the person's preview before a start (one row per fact the
 * research would verify, each with how and how costly), the "Verifying"
 * section of "What the research knows" (waiting facts, Stop, the bulk
 * verification), the bulk dialog (line, lineage or the whole tree, the order,
 * a first try on a few people), and the toast once per run of re-verification
 * the research reports.
 *
 * Everything goes through the research's bridge, no terminal: verifying
 * carries the AI badge alone, stopping nothing (RESEARCH_BRIDGE_MARKS).
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { shownName } from '../person-name.js';
import type { LifeEvent, Partnership, PartnershipId, PersonId } from '../types.js';
import type { LiveStatus } from '../research-link.js';
import { FactHolder, factCitations, factsOf, isPartnership } from '../import-origin.js';
import { factReliability, ReliabilityStepName } from '../reliability.js';
import {
    VERIFY_BULK_FEATURE, VERIFY_FEATURE, VERIFY_STOP_FEATURE, factResearchEid, factVerifyInfo, personResearchRef,
} from '../verify.js';
import {
    VerifyBulkDone, VerifyBulkOrder, VerifyBulkResult, VerifyFact, VerifyTarget, postVerify, postVerifyBulk, postVerifyStop,
} from '../research-verify.js';
import {
    BulkScopeOption, FactOffer, VERIFY_TRY_PEOPLE, bulkScopeOptions, factOffer, personVerifyAskCount, personVerifyCounts, queuedToastDue,
    verifyCostSplit, verifyFactKind, verifyRecordText,
} from '../verify-ui-model.js';
import { VerifyResearch, researchVerifies } from '../verify-offer.js';
import { closeStatusTip, refreshStatusTip, registerStatusTipExtension } from './status-tip.js';
import { reliabilityLabel } from './fact-status.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { activeResearchId, bridgeBase } from './history-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { liveSession } from './research-ui.js';
import { rodIndex } from './rod-view.js';
import { uiModule } from './module.js';
import { factWaitsForVerify, markVerifyPending, verifyKindName } from './verify-ui.js';

export const VERIFY_PERSON_DIALOG_ID = 'verify-person-modal';
export const VERIFY_BULK_DIALOG_ID = 'verify-bulk-modal';
export const VERIFY_TREE_DIALOG_ID = 'verify-tree-modal';

/** How long the toast after a run of re-verification stands. */
const QUEUED_TOAST_MS = 10_000;
const TOAST_KEY = (treeId: string): string => `strom-verify-toast:${treeId}`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ==================== Started here ====================

/** One fact a start here asked the research to verify. */
interface StartedFact {
    holderId: string;
    fact: string;
}

/**
 * The facts a start sent wait at once (their pills' clock, their tips'
 * waiting row) until the tree holds the research's version (verify-ui.ts).
 */
function noteStarted(facts: readonly StartedFact[], position?: number): void {
    const byHolder = new Map<string, string[]>();
    for (const f of facts) byHolder.set(f.holderId, [...(byHolder.get(f.holderId) ?? []), f.fact]);
    for (const [holderId, list] of byHolder) {
        const target = DataManager.getPartnership(holderId as PartnershipId) ? { partnershipId: holderId } : { personId: holderId };
        markVerifyPending(target, list, position);
    }
}

// ==================== The person's facts ====================

/** One fact of a person (or of their couple) as the verification sees it. */
interface PersonFact {
    holder: FactHolder;
    fact: string;
    offer: FactOffer;
    kind: string | null;
    step: ReliabilityStepName | null;
}

/** What a person offers to verify now. */
export interface PersonVerifyState {
    research: VerifyResearch | null;
    facts: PersonFact[];
    /** Facts "Verify facts (N)" would take, as the research's /verify {person} does (only with its `verify`; see personVerifyAskCount). */
    verify: number;
    /** Facts waiting for re-verification. */
    pending: number;
}

/** The value of a fact as the preview names it ("3 Feb 1850, Horní Bříza"). */
function factValueText(holder: FactHolder, fact: string): string {
    const join = (date?: string, place?: string): string => [date ? formatFlexDate(date) : '', place ?? ''].filter(Boolean).join(', ');
    if (isPartnership(holder)) return fact === 'marriage' ? join(holder.startDate, holder.startPlace) : '';
    if (fact === 'birth') return join(holder.birthDate, holder.birthPlace);
    if (fact === 'death') return join(holder.deathDate, holder.deathPlace);
    if (fact.startsWith('event:')) {
        const ev = (holder.events ?? []).find(e => e?.id === fact.slice(6)) as LifeEvent | undefined;
        return ev ? join(ev.date, ev.place) : '';
    }
    return '';
}

/** The fact's name and value ("Birth · 3 Feb 1850, Horní Bříza"). */
function factTitle(kind: string, holder: FactHolder, fact: string): string {
    const name = verifyKindName(kind);
    const value = factValueText(holder, fact);
    return value ? `${name} · ${value}` : name;
}

// ==================== The preview and the bulk dialog ====================

interface PreviewRow {
    eid: string;
    holderId: string;
    fact: string;
    title: string;
    sub: string;
    how: VerifyFact['how'];
    on: boolean;
}

interface PersonPreviewState {
    personId: PersonId;
    rid: string;
    loading: boolean;
    error: string | null;
    rows: PreviewRow[];
    busy: boolean;
    opener: HTMLElement | null;
}

let preview: PersonPreviewState | null = null;

interface BulkScopeRow extends BulkScopeOption {
    /** Facts the scope takes (a dry run without a try); null: not known yet. */
    count: number | null;
}

interface BulkState {
    rid: string;
    scopes: BulkScopeRow[];
    scope: number;
    order: VerifyBulkOrder;
    tryFirst: boolean;
    /** The dry run of the chosen scope, order and try (null: being asked). */
    estimate: VerifyBulkDone | null;
    /** Each ask of the estimate gets the next number: a late answer to an older one is dropped. */
    ask: number;
    /** The dialog's requests to the bridge, one after another (the research takes one at a time). */
    queue: Promise<void>;
    busy: boolean;
    error: string | null;
    opener: HTMLElement | null;
}

let bulk: BulkState | null = null;

/** Run `job` after the dialog's requests before it (the research's bridge takes one at a time). */
function bulkQueued(st: BulkState, job: () => Promise<void>): Promise<void> {
    const next = st.queue.then(job, job);
    st.queue = next.catch(() => { /* a failed request does not hold up the next */ });
    return next;
}

const ORDERS: readonly VerifyBulkOrder[] = ['ancestors', 'weakest', 'oldest'];

function orderLabel(o: VerifyBulkOrder): string {
    const v = strings.verify;
    return o === 'ancestors' ? v.orderAncestors : o === 'weakest' ? v.orderWeakest : v.orderOldest;
}

function scopeLabel(s: BulkScopeOption): string {
    const v = strings.verify;
    return s.scope === 'line' ? v.scopeLine(s.name ?? '') : s.scope === 'lineage' ? v.scopeSurname(s.name ?? '') : v.scopeTree;
}

/** USD as the language writes it ("$1.20", "1,20 US$"). */
function usdText(usd: number | undefined): string {
    if (usd === undefined) return '';
    try {
        return new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency: 'USD', maximumFractionDigits: usd < 10 ? 2 : 0 }).format(usd);
    } catch {
        return `$${usd.toFixed(2)}`;
    }
}

/**
 * A refusal said in the app's words: nothing to verify, the research busy or
 * held by another session, else that it could not start. Never the bridge's
 * own sentence (`reason`, English and for the details only).
 */
export function verifyRefusalText(code: string): string {
    const v = strings.verify;
    if (code === 'verify.nothing') return v.nothing;
    if (code === 'busy') return v.busy;
    if (code === 'locked') return v.locked;
    return v.failed;
}

/**
 * Before a dialog's content is drawn again: the control that has the focus,
 * so the new content gives it back (else the dialog's Cancel/Close), and Esc
 * keeps closing the dialog. Focus outside the dialog stays where it is.
 */
function keepFocus(modal: HTMLElement): () => void {
    const el = document.activeElement;
    const inside = el instanceof HTMLElement && modal.contains(el);
    if (!inside && el && el !== document.body) return () => { /* the focus is elsewhere */ };
    let key = '';
    if (inside) {
        for (const a of ['data-row', 'data-dismiss', 'data-vfy', 'data-act']) {
            const v = el.getAttribute(a);
            if (v !== null) { key = v ? `[${a}="${CSS.escape(v)}"]` : `[${a}]`; break; }
        }
        const input = el as HTMLInputElement;
        if (!key && input.name) key = `[name="${CSS.escape(input.name)}"][value="${CSS.escape(input.value)}"]`;
    }
    return () => {
        const target = key ? modal.querySelector<HTMLElement>(key) : null;
        target?.focus({ preventScroll: true });
        if (!modal.contains(document.activeElement)) modal.querySelector<HTMLElement>('[data-dismiss]')?.focus({ preventScroll: true });
    };
}

/** Close a dialog of this module and give the focus back. */
function removeDialog(id: string, opener: HTMLElement | null, ui: { dialogStack: string[] }): void {
    document.getElementById(id)?.remove();
    ui.dialogStack = ui.dialogStack.filter(d => d !== id);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
}

let listening = false;

export const verifyPersonMethods = uiModule({
    /** At startup: the card tip's button, the toast after a run of re-verification. */
    initVerifyPerson(): void {
        if (listening) return;
        listening = true;
        registerStatusTipExtension((ctx, slots) => {
            if (ctx.kind !== 'card' || !ctx.personId) return;
            this.verifyCardTipActions(ctx.personId as PersonId, slots.actions);
        });
        onBridgeStatus((rid, status) => this.noteVerifyStatus(rid, status));
    },

    /** The research the open tree is linked to, as the offers need it (null: none, or its bridge is not answering). */
    verifyBridgeNow(): { rid: string; research: VerifyResearch; status: LiveStatus } | null {
        const rid = activeResearchId();
        if (!rid || !this.researchBridgeUp(rid)) return null;
        const status = this.researchStatusOf(rid);
        if (!status) return null;
        return { rid, status, research: { features: status.features ?? [], ...(status.treeState ? { treeState: status.treeState } : {}) } };
    },

    /** A person's facts and their couples' marriages, each with its offer. */
    personVerifyState(personId: PersonId): PersonVerifyState | null {
        const data = DataManager.getData();
        const person = data.persons[personId];
        if (!person) return null;
        const now = this.verifyBridgeNow();
        const research = now?.research ?? null;
        const opts = this.reliabilityOptionsNow();
        const editable = !DataManager.isViewMode();
        const holders: FactHolder[] = [person, ...(person.partnerships ?? [])
            .map(id => data.partnerships[id as PartnershipId]).filter((p): p is Partnership => !!p)];
        const facts: PersonFact[] = [];
        for (const holder of holders) {
            for (const fact of factsOf(holder)) {
                const kind = verifyFactKind(holder, fact);
                const info = factVerifyInfo(holder, fact);
                const waits = factWaitsForVerify(holder, fact);
                // A fact the research holds (its id) is one /verify {person} takes too, whatever its kind.
                if (!kind && !waits && !factResearchEid(holder, fact)) continue;
                const step = factReliability(data, holder, fact, opts)?.step ?? null;
                const offer = factOffer(holder, fact, {
                    step, research, researchTree: opts.researchTree, cited: factCitations(data, holder, fact).length > 0, info,
                    localPending: waits, editable,
                });
                facts.push({ holder, fact, offer, kind, step });
            }
        }
        const counts = personVerifyCounts(facts.map(f => f.offer));
        return { research, facts, verify: researchVerifies(research) ? personVerifyAskCount(facts) : 0, pending: counts.pending };
    },

    /** "Verify facts (N)" in a card mark's tip, else "N facts waiting to be verified". */
    verifyCardTipActions(personId: PersonId, actions: HTMLElement): void {
        const st = this.personVerifyState(personId);
        if (!st) return;
        if (st.verify > 0 && personResearchRef(DataManager.getData().persons[personId] ?? {})) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'st-v-btn st-verify-person';
            btn.innerHTML = researchBridgeActionLabel(strings.verify.personBtn(st.verify), 'verify');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeStatusTip();
                this.showVerifyPersonDialog(personId);
            });
            actions.appendChild(btn);
        } else if (st.pending > 0) {
            const row = document.createElement('div');
            row.className = 'st-verify-pending';
            row.textContent = strings.verify.personPending(st.pending);
            actions.appendChild(row);
        }
    },

    /** The person menu's item: "Verify facts · N" (AI badge), "Verifying · N", or nothing. */
    personVerifyMenu(personId: PersonId): { kind: 'verify' | 'pending'; n: number } | null {
        const st = this.personVerifyState(personId);
        if (!st) return null;
        if (st.verify > 0 && personResearchRef(DataManager.getData().persons[personId] ?? {})) return { kind: 'verify', n: st.verify };
        return st.pending > 0 ? { kind: 'pending', n: st.pending } : null;
    },

    /**
     * The person card's row above its events: "Verify facts (N)" (AI badge) as
     * in the card mark's tip and the person menu, else "N facts waiting to be
     * verified", else none. Null: the card of no saved person.
     */
    renderPersonVerifyRow(personId: PersonId | null): void {
        const events = document.getElementById('events-section');
        if (!events) return;
        let row = document.getElementById('pm-verify-row');
        const state = personId ? this.personVerifyMenu(personId) : null;
        if (!personId || !state) { row?.remove(); return; }
        if (!row) {
            row = document.createElement('div');
            row.id = 'pm-verify-row';
            row.className = 'form-group pm-verify-row';
        }
        if (row.nextElementSibling !== events) events.before(row);
        row.dataset.person = personId;
        row.dataset.kind = state.kind;
        if (state.kind === 'verify') {
            row.innerHTML = `<button type="button" class="secondary pm-verify-btn">${researchBridgeActionLabel(strings.verify.personBtn(state.n), 'verify')}</button>`;
            row.querySelector('button')!.addEventListener('click', () => this.showVerifyPersonDialog(personId));
        } else {
            row.innerHTML = '';
            const text = document.createElement('div');
            text.className = 'pm-verify-pending';
            text.textContent = strings.verify.personPending(state.n);
            row.appendChild(text);
        }
    },

    // ==================== The person's preview (10j) ====================

    /** "Verify facts (N)": what the research would verify of the person, asked first (dry run). */
    showVerifyPersonDialog(personId: PersonId): void {
        const now = this.verifyBridgeNow();
        const person = DataManager.getPerson(personId);
        const ref = person ? personResearchRef(person) : null;
        if (!now || !person || !ref) {
            this.showToast(strings.verify.failed, 5000);
            return;
        }
        this.hideContextMenu();
        const active = document.activeElement;
        preview = { personId, rid: now.rid, loading: true, error: null, rows: [], busy: false, opener: active instanceof HTMLElement ? active : null };
        document.getElementById(VERIFY_PERSON_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active vfy-overlay';
        overlay.id = VERIFY_PERSON_DIALOG_ID;
        overlay.innerHTML = '<div class="modal modal--sm vfy-modal vfy-person" role="dialog" data-dialog-kind="form" aria-modal="true"'
            + ' aria-labelledby="vfy-person-title" data-skeleton="done"></div>';
        overlay.addEventListener('click', (e) => this.verifyPersonClick(e));
        overlay.addEventListener('change', (e) => this.verifyPersonChange(e));
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            this.closeVerifyPersonDialog();
        });
        document.body.appendChild(overlay);
        this.pushDialog(VERIFY_PERSON_DIALOG_ID);
        this.renderVerifyPerson();
        overlay.querySelector<HTMLElement>('[data-dismiss]')?.focus({ preventScroll: true });
        void this.verifyPersonRead(ref);
    },

    closeVerifyPersonDialog(): void {
        const opener = preview?.opener ?? null;
        preview = null;
        removeDialog(VERIFY_PERSON_DIALOG_ID, opener, this);
    },

    /** The dry run: the facts the research would verify, mapped onto the tree's facts by their ids. */
    async verifyPersonRead(ref: string): Promise<void> {
        const st = preview;
        if (!st) return;
        const base = bridgeBase(st.rid);
        const features = this.researchStatusOf(st.rid)?.features ?? null;
        const r = base ? await postVerify(base, { person: ref }, { features, dry: true }) : null;
        if (preview !== st) return;
        st.loading = false;
        if (!r || !r.ok) {
            st.error = r ? verifyRefusalText(r.code) : strings.verify.failed;
        } else {
            const state = this.personVerifyState(st.personId);
            const byEid = new Map<string, PersonFact>();
            for (const f of state?.facts ?? []) if (f.offer.eid) byEid.set(f.offer.eid, f);
            st.rows = r.facts.map(f => {
                const local = byEid.get(f.fact);
                const title = local ? factTitle(f.kind, local.holder, local.fact) : verifyKindName(f.kind);
                const record = verifyRecordText(f.record);
                const how = f.how === 'read' ? strings.verify.howRead(record) : strings.verify.howSearch(record);
                const step = local?.step ? reliabilityLabel(local.step) : '';
                return {
                    eid: f.fact, holderId: local?.holder.id ?? '', fact: local?.fact ?? '', title,
                    sub: [step, how].filter(Boolean).join(' · '), how: f.how, on: true,
                };
            });
            if (st.rows.length === 0) st.error = strings.verify.nothing;
        }
        this.renderVerifyPerson();
    },

    renderVerifyPerson(): void {
        const st = preview;
        const modal = document.querySelector<HTMLElement>(`#${VERIFY_PERSON_DIALOG_ID} .vfy-modal`);
        if (!st || !modal) return;
        const v = strings.verify;
        const person = DataManager.getPerson(st.personId);
        const name = person ? shownName(person) : '';
        const checked = st.rows.filter(r => r.on);
        let body = '';
        if (st.loading) body = `<p class="vfy-loading" role="status">${esc(v.loading)}</p>`;
        else if (st.error) body = `<p class="vfy-error" role="alert">${esc(st.error)}</p>`;
        else {
            body = `<ul class="vfy-rows">${st.rows.map((r, i) => `
                <li><label class="vfy-row">
                    <input type="checkbox" class="vfy-check" data-row="${i}"${r.on ? ' checked' : ''}${st.busy ? ' disabled' : ''}>
                    <span class="vfy-row-main"><span class="vfy-row-title">${esc(r.title)}</span>${r.sub ? `<span class="vfy-row-sub">${esc(r.sub)}</span>` : ''}</span>
                    <span class="vfy-cost${r.how === 'read' ? ' is-low' : ' is-high'}">${esc(r.how === 'read' ? v.low : v.high)}</span>
                </label></li>`).join('')}</ul>`;
            const split = verifyCostSplit(checked);
            body += `<div class="vfy-est"><p class="vfy-est-head">${esc(v.estimate(split.low, split.high))}</p><p class="vfy-est-note">${esc(v.estimateNote)}</p></div>`;
        }
        const n = checked.length;
        const startOff = st.loading || !!st.error || n === 0 || st.busy;
        const restoreFocus = keepFocus(modal);
        modal.innerHTML = `
            <div class="modal-header vfy-header">
                <div class="vfy-heading"><h2 id="vfy-person-title">${esc(v.personTitle)}</h2>
                <div class="vfy-sub">${esc(v.personSub(name, st.loading || st.error ? 0 : st.rows.length))}</div></div>
                <button type="button" class="close-btn" data-vfy="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
            </div>
            <div class="vfy-body">${body}</div>
            <div class="buttons vfy-foot">
                <button type="button" class="secondary" data-dismiss data-vfy="close">${esc(strings.buttons.cancel)}</button>
                <button type="button" class="primary" data-vfy="start"${startOff ? ' disabled' : ''}${st.busy ? ' aria-busy="true"' : ''}>${researchBridgeActionLabel(v.startN(n), 'verify')}</button>
            </div>`;
        // The sub says the count of the facts offered, not 0 while asking.
        if (st.loading || st.error) modal.querySelector('.vfy-sub')!.textContent = name;
        restoreFocus();
    },

    verifyPersonClick(e: Event): void {
        const t = e.target as HTMLElement;
        const act = t.closest<HTMLElement>('[data-vfy]')?.dataset.vfy;
        if (act === 'close') this.closeVerifyPersonDialog();
        else if (act === 'start') void this.verifyPersonStart();
    },

    verifyPersonChange(e: Event): void {
        const st = preview;
        const box = (e.target as HTMLElement).closest<HTMLInputElement>('input.vfy-check');
        if (!st || !box) return;
        const row = st.rows[Number(box.dataset.row)];
        if (!row) return;
        row.on = box.checked;
        // The estimate and the button follow; the checkbox keeps the focus.
        const modal = document.querySelector<HTMLElement>(`#${VERIFY_PERSON_DIALOG_ID} .vfy-modal`);
        const checked = st.rows.filter(r => r.on);
        const split = verifyCostSplit(checked);
        const head = modal?.querySelector('.vfy-est-head');
        if (head) head.textContent = strings.verify.estimate(split.low, split.high);
        const start = modal?.querySelector<HTMLButtonElement>('[data-vfy="start"]');
        if (start) {
            start.innerHTML = researchBridgeActionLabel(strings.verify.startN(checked.length), 'verify');
            start.disabled = checked.length === 0 || st.busy;
        }
    },

    /** Start: the whole person when every fact is checked, else each checked fact by its id. */
    async verifyPersonStart(): Promise<void> {
        const st = preview;
        if (!st || st.busy) return;
        const person = DataManager.getPerson(st.personId);
        const ref = person ? personResearchRef(person) : null;
        const checked = st.rows.filter(r => r.on);
        if (!ref || checked.length === 0) return;
        st.busy = true;
        this.renderVerifyPerson();
        const all = checked.length === st.rows.length;
        const targets: VerifyTarget[] = all ? [{ person: ref }] : checked.map(r => ({ fact: r.eid }));
        const started: StartedFact[] = [];
        /** The facts the research queued, by its answers (each target's checked rows when one names none). */
        const queued = new Set<string>();
        let failure = '';
        let position: number | undefined;
        // One write under the window lock; the research's new version follows quietly.
        const answer = await this.postResearchBridgeWrite<{ ok: boolean; head?: string }>(async (base, features) => {
            let last: { ok: boolean; head?: string } = { ok: false };
            for (const target of targets) {
                const r = await postVerify(base, target, { features });
                if (!r.ok) { failure = verifyRefusalText(r.code); break; }
                const asked = new Set(r.facts.map(f => f.fact));
                const rows = 'person' in target ? checked.filter(x => asked.size === 0 || asked.has(x.eid)) : checked.filter(x => 'fact' in target && x.eid === target.fact);
                started.push(...rows.filter(x => x.holderId && x.fact).map(x => ({ holderId: x.holderId, fact: x.fact })));
                for (const id of asked.size ? asked : rows.map(x => x.eid)) queued.add(id);
                if (r.position !== undefined) position = r.position;
                last = r;
            }
            return last;
        });
        if (!answer && !failure && started.length === 0 && queued.size === 0) failure = strings.verify.failed;
        noteStarted(started, targets.length === 1 ? position : undefined);
        if (preview !== st) return;
        if (failure && started.length === 0 && queued.size === 0) {
            st.busy = false;
            st.error = failure;
            this.renderVerifyPerson();
            return;
        }
        this.closeVerifyPersonDialog();
        // What the research says it queued: a residence it verifies too, though the tree holds no such fact to mark.
        this.showToast(failure || strings.verify.bulkStarted(queued.size || started.length || checked.length), 5000, failure ? { alert: true } : {});
        this.afterVerifyStarted();
    },

    /** A start went through: the marks follow, and the research's new version is asked for. */
    afterVerifyStarted(): void {
        refreshStatusTip();
        this.refreshVerifySections();
        void this.pollResearchBridge();
    },

    // ==================== The "Verifying" section ====================

    /** The tree's verification now: waiting facts, Stop and the bulk dialog (null: the research does not verify). */
    treeVerifyNow(): { waiting: number; stop: boolean; bulk: boolean } | null {
        const now = this.verifyBridgeNow();
        if (!now || !researchVerifies(now.research, VERIFY_FEATURE) || DataManager.isViewMode()) return null;
        const v = now.status.verify;
        return {
            // The research's `asked` (and `images`, `permission`) are counted among its `waiting`.
            waiting: v?.waiting ?? 0,
            stop: researchVerifies(now.research, VERIFY_STOP_FEATURE),
            bulk: researchVerifies(now.research, VERIFY_BULK_FEATURE),
        };
    },

    /** The rows of "Verifying" (HTML): waiting facts with Stop, the bulk verification. `pending`: the count said. */
    verifyRowsHtml(pending: number, opts: { stop: boolean; bulk: boolean }): string {
        const v = strings.verify;
        const rows: string[] = [];
        if (pending > 0) {
            rows.push(`<div class="vfy-sec-row vfy-sec-pending"><span class="vfy-sec-main"><span class="vfy-sec-title">${esc(v.pendingRow(pending))}</span>`
                + `<span class="vfy-sec-sub">${esc(v.pendingRowSub)}</span></span>`
                + (opts.stop ? `<button type="button" class="link-button vfy-sec-stop" data-verify-act="stop">${researchBridgeActionLabel(v.stop, 'verify-stop')}</button>` : '')
                + '</div>');
        }
        if (opts.bulk) {
            rows.push(`<button type="button" class="vfy-sec-row vfy-sec-bulk" data-verify-act="bulk"><span class="vfy-sec-main">`
                + `<span class="vfy-sec-title">${researchBridgeActionLabel(v.bulkRow, 'verify-bulk')}</span>`
                + `<span class="vfy-sec-sub">${esc(v.bulkRowSub)}</span></span></button>`);
        }
        return rows.join('');
    },

    /** The section in the person's "What the research knows" ('' when there is nothing to say). */
    personVerifySectionHtml(personId: PersonId): string {
        const st = this.personVerifyState(personId);
        const tree = this.treeVerifyNow();
        const pending = st?.pending ?? 0;
        // The person's own waiting facts; Stop drops the tree's whole queue, so it stays in the tree's place.
        const rows = this.verifyRowsHtml(pending, { stop: false, bulk: !!tree?.bulk });
        if (!rows || (pending === 0 && !tree)) return '';
        return `<section class="person-research-section vfy-section" data-verify-section="person"><h3 class="menu-section-header">${esc(strings.verify.section)}</h3>${rows}</section>`;
    },

    /** The tree's "Verifying" block (DOM), or null when there is nothing to say. */
    treeVerifyBlock(onBulk?: () => void): HTMLElement | null {
        const tree = this.treeVerifyNow();
        if (!tree || (tree.waiting === 0 && !tree.bulk)) return null;
        const block = document.createElement('div');
        block.className = 'vfy-section vfy-section--tree';
        block.dataset.verifySection = 'tree';
        block.innerHTML = `<h4 class="vfy-section-head">${esc(strings.verify.section)}</h4>${this.verifyRowsHtml(tree.waiting, tree)}`;
        this.bindVerifySection(block, onBulk);
        return block;
    },

    /** The section's Stop and its way into the bulk dialog. */
    bindVerifySection(host: HTMLElement, onBulk?: () => void): void {
        host.addEventListener('click', (e) => {
            const act = (e.target as HTMLElement).closest<HTMLElement>('[data-verify-act]');
            if (!act || !host.contains(act)) return;
            if (act.dataset.verifyAct === 'stop') void this.verifyStop(act as HTMLButtonElement);
            else if (act.dataset.verifyAct === 'bulk') {
                onBulk?.();
                this.showVerifyBulkDialog();
            }
        });
    },

    /** Stop: the research drops what it has not begun to verify. */
    async verifyStop(btn: HTMLButtonElement | null): Promise<void> {
        if (!this.verifyBridgeNow()) return;
        if (btn) btn.disabled = true;
        const r = await this.postResearchBridgeWrite((base, features) => postVerifyStop(base, { features }));
        if (btn) btn.disabled = false;
        if (!r || !r.ok) {
            this.showToast(r ? verifyRefusalText(r.code) : strings.verify.failed, 5000, { alert: true });
            return;
        }
        this.showToast(strings.verify.stopped, 4000);
        this.afterVerifyStarted();
    },

    /** The open places that show the verification, drawn again (a start, a stop, a new status). */
    refreshVerifySections(): void {
        const card = document.getElementById('person-modal');
        if (card?.classList.contains('active') && document.getElementById('events-section')) {
            this.renderPersonVerifyRow(DataManager.getPerson(this.currentId as PersonId) ? this.currentId as PersonId : null);
        }
        const person = document.querySelector<HTMLElement>('#person-research-modal[data-person]');
        const section = person?.querySelector<HTMLElement>('[data-verify-section="person"]');
        if (person && section) {
            const html = this.personVerifySectionHtml(person.dataset.person as PersonId);
            const tmp = document.createElement('template');
            tmp.innerHTML = html.trim();
            const next = tmp.content.firstElementChild as HTMLElement | null;
            if (next) {
                section.replaceWith(next);
                this.bindVerifySection(next, () => this.closePersonResearchDialog());
            } else section.remove();
        }
        const tree = document.getElementById(VERIFY_TREE_DIALOG_ID);
        if (tree) this.renderVerifyTreeDialog();
        if (document.getElementById('research-overview')) this.renderResearchOverview();
    },

    /**
     * "Details" of the toast: the overview's "What the research knows" while
     * following the research; else a small dialog with the tree's "Verifying".
     */
    openVerifyDetails(): void {
        const s = liveSession();
        if (s && !s.ended) {
            this.unfoldOverviewSection('knows');
            this.openResearchOverview();
            const head = document.querySelector<HTMLElement>('#research-overview [data-verify-section="tree"]');
            head?.scrollIntoView({ block: 'nearest' });
            return;
        }
        this.showVerifyTreeDialog();
    },

    /** The tree's "What the research knows" with its "Verifying" section (no following). */
    showVerifyTreeDialog(): void {
        document.getElementById(VERIFY_TREE_DIALOG_ID)?.remove();
        const active = document.activeElement;
        const opener = active instanceof HTMLElement ? active : null;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active vfy-overlay';
        overlay.id = VERIFY_TREE_DIALOG_ID;
        overlay.innerHTML = '<div class="modal modal--sm vfy-modal vfy-tree" role="dialog" data-dialog-kind="info" aria-modal="true"'
            + ' aria-labelledby="vfy-tree-title" data-skeleton="done"></div>';
        const close = (): void => removeDialog(VERIFY_TREE_DIALOG_ID, opener, this);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
        overlay.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('[data-vfy="close"]')) close();
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close();
        });
        document.body.appendChild(overlay);
        this.pushDialog(VERIFY_TREE_DIALOG_ID);
        this.renderVerifyTreeDialog();
        overlay.querySelector<HTMLElement>('[data-dismiss]')?.focus({ preventScroll: true });
    },

    renderVerifyTreeDialog(): void {
        const modal = document.querySelector<HTMLElement>(`#${VERIFY_TREE_DIALOG_ID} .vfy-modal`);
        if (!modal) return;
        const treeId = DataManager.getCurrentTreeId();
        const name = treeId ? TreeManager.getTreeMetadata(treeId)?.name ?? '' : '';
        const restoreFocus = keepFocus(modal);
        modal.innerHTML = `
            <div class="modal-header vfy-header">
                <div class="vfy-heading"><h2 id="vfy-tree-title">${esc(strings.research.knows)}</h2>${name ? `<div class="vfy-sub">${esc(name)}</div>` : ''}</div>
                <button type="button" class="close-btn" data-vfy="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
            </div>
            <div class="vfy-body"></div>
            <div class="buttons vfy-foot"><button type="button" class="secondary" data-dismiss data-vfy="close">${esc(strings.buttons.close)}</button></div>`;
        const block = this.treeVerifyBlock(() => removeDialog(VERIFY_TREE_DIALOG_ID, null, this));
        const body = modal.querySelector<HTMLElement>('.vfy-body')!;
        if (block) body.appendChild(block);
        else body.innerHTML = `<p class="vfy-loading">${esc(strings.verify.nothing)}</p>`;
        restoreFocus();
    },

    // ==================== The bulk dialog (10l) ====================

    /** The bulk verification is offered now (the research's `verify.bulk`, its bridge answering, the tree editable). */
    verifyBulkAvailable(): boolean {
        const now = this.verifyBridgeNow();
        return !!now && researchVerifies(now.research, VERIFY_BULK_FEATURE) && !DataManager.isViewMode();
    },

    /** The scopes for the focused person: the research's direction they are in, their lineage, the whole tree. */
    verifyBulkScopes(rid: string): BulkScopeOption[] {
        const data = DataManager.getData();
        const focus = (TreeRenderer.getFocusPersonId() ?? this.currentId) as PersonId | null;
        const person = focus ? data.persons[focus] : undefined;
        let line: { id: string; name: string } | null = null;
        if (person) {
            const inLine = this.personInLine(person.id);
            const refn = personResearchRef(person);
            const status = this.researchStatusOf(rid);
            const direction = inLine[0] ?? (refn ? status?.researches?.find(d => d.focus === refn && d.state !== 'done') : undefined);
            if (direction) line = { id: direction.id, name: direction.name };
        }
        let lineage: { founderRef: string | null; surname: string } | null = null;
        if (person) {
            const { index } = rodIndex();
            const rodId = index.rodByPerson.get(person.id);
            const rod = rodId ? index.rods.get(rodId) : undefined;
            const founder = rod ? data.persons[rod.founderId] : undefined;
            if (rod && founder) lineage = { founderRef: personResearchRef(founder), surname: rod.surname };
        }
        return bulkScopeOptions({ line, lineage });
    },

    /** "Verify facts in the tree…": the scope, the order and a first try, with the research's estimate. */
    showVerifyBulkDialog(): void {
        const now = this.verifyBridgeNow();
        if (!now || !researchVerifies(now.research, VERIFY_BULK_FEATURE)) {
            this.showToast(strings.verify.failed, 5000);
            return;
        }
        this.hideContextMenu();
        if (this.isResearchMenuOpen?.()) this.closeResearchMenu?.();
        const active = document.activeElement;
        bulk = {
            rid: now.rid, scopes: this.verifyBulkScopes(now.rid).map(s => ({ ...s, count: null })), scope: 0,
            order: 'ancestors', tryFirst: true, estimate: null, ask: 0, queue: Promise.resolve(), busy: false, error: null,
            opener: active instanceof HTMLElement ? active : null,
        };
        document.getElementById(VERIFY_BULK_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active vfy-overlay';
        overlay.id = VERIFY_BULK_DIALOG_ID;
        overlay.innerHTML = '<div class="modal modal--md vfy-modal vfy-bulk" role="dialog" data-dialog-kind="form" aria-modal="true"'
            + ' aria-labelledby="vfy-bulk-title" data-skeleton="done"></div>';
        overlay.addEventListener('click', (e) => {
            const act = (e.target as HTMLElement).closest<HTMLElement>('[data-vfy]')?.dataset.vfy;
            if (act === 'close') this.closeVerifyBulkDialog();
            else if (act === 'start') void this.verifyBulkStart();
        });
        overlay.addEventListener('change', (e) => this.verifyBulkChange(e));
        overlay.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            this.closeVerifyBulkDialog();
        });
        document.body.appendChild(overlay);
        this.pushDialog(VERIFY_BULK_DIALOG_ID);
        this.renderVerifyBulk();
        overlay.querySelector<HTMLElement>('input[name="vfy-scope"]:checked')?.focus({ preventScroll: true });
        // One request at a time: the estimate of the chosen scope first, then each scope's count.
        void this.verifyBulkEstimate();
        void this.verifyBulkCounts();
    },

    closeVerifyBulkDialog(): void {
        const opener = bulk?.opener ?? null;
        bulk = null;
        removeDialog(VERIFY_BULK_DIALOG_ID, opener, this);
    },

    /** Each scope's count of facts (dry runs, no try), one scope after another. */
    async verifyBulkCounts(): Promise<void> {
        const st = bulk;
        const base = st ? bridgeBase(st.rid) : null;
        if (!st || !base) return;
        const features = this.researchStatusOf(st.rid)?.features ?? null;
        await bulkQueued(st, async () => {
            for (const s of st.scopes) {
                // Closed, or started: the counts no longer matter.
                if (bulk !== st || st.busy) return;
                const r = await postVerifyBulk(base, { scope: s.scope, ...(s.of ? { of: s.of } : {}), dry: true }, { features });
                if (bulk !== st) return;
                s.count = r.ok ? r.facts : null;
                const count = document.querySelector<HTMLElement>(`#${VERIFY_BULK_DIALOG_ID} [data-scope-count="${s.scope}"]`);
                if (count) count.textContent = s.count !== null ? strings.verify.scopeCount(s.count) : '';
            }
        });
    },

    /** The estimate of the chosen scope, order and try (a dry run). */
    async verifyBulkEstimate(): Promise<void> {
        const st = bulk;
        const base = st ? bridgeBase(st.rid) : null;
        if (!st || !base) return;
        const ask = ++st.ask;
        st.estimate = null;
        st.error = null;
        this.renderVerifyBulkEstimate();
        await bulkQueued(st, async () => {
            // A newer choice asks its own estimate: this one is not sent at all.
            if (bulk !== st || st.ask !== ask || st.busy) return;
            const s = st.scopes[st.scope];
            const r = await postVerifyBulk(base, {
                scope: s.scope, ...(s.of ? { of: s.of } : {}), order: st.order, ...(st.tryFirst ? { try: VERIFY_TRY_PEOPLE } : {}), dry: true,
            }, { features: this.researchStatusOf(st.rid)?.features ?? null });
            if (bulk !== st || st.ask !== ask) return;
            if (r.ok) st.estimate = r;
            else st.error = verifyRefusalText(r.code);
            this.renderVerifyBulkEstimate();
        });
    },

    renderVerifyBulk(): void {
        const st = bulk;
        const modal = document.querySelector<HTMLElement>(`#${VERIFY_BULK_DIALOG_ID} .vfy-modal`);
        if (!st || !modal) return;
        const v = strings.verify;
        const scopes = st.scopes.map((s, i) => `
            <label class="vfy-opt">
                <input type="radio" name="vfy-scope" value="${i}"${i === st.scope ? ' checked' : ''}>
                <span class="vfy-opt-main"><span class="vfy-opt-title">${esc(scopeLabel(s))}</span></span>
                <span class="vfy-opt-count" data-scope-count="${s.scope}">${s.count !== null ? esc(v.scopeCount(s.count)) : ''}</span>
            </label>`).join('');
        const orders = ORDERS.map(o => `
            <label class="vfy-opt">
                <input type="radio" name="vfy-order" value="${o}"${o === st.order ? ' checked' : ''}>
                <span class="vfy-opt-main"><span class="vfy-opt-title">${esc(orderLabel(o))}</span></span>
            </label>`).join('');
        const restoreFocus = keepFocus(modal);
        modal.innerHTML = `
            <div class="modal-header vfy-header">
                <div class="vfy-heading"><h2 id="vfy-bulk-title">${esc(v.bulkTitle)}</h2><div class="vfy-sub">${esc(v.bulkSub)}</div></div>
                <button type="button" class="close-btn" data-vfy="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
            </div>
            <div class="vfy-body">
                <fieldset class="vfy-group"><legend class="vfy-group-head">${esc(v.scope)}</legend>${scopes}</fieldset>
                <fieldset class="vfy-group"><legend class="vfy-group-head">${esc(v.order)}</legend>${orders}</fieldset>
                <label class="vfy-opt vfy-try">
                    <input type="checkbox" name="vfy-try"${st.tryFirst ? ' checked' : ''}>
                    <span class="vfy-opt-main"><span class="vfy-opt-title">${esc(v.tryFirst(VERIFY_TRY_PEOPLE))}</span>
                    <span class="vfy-opt-sub">${esc(v.tryFirstSub(VERIFY_TRY_PEOPLE))}</span></span>
                </label>
                <div class="vfy-est" aria-live="polite"></div>
            </div>
            <div class="buttons vfy-foot">
                <button type="button" class="secondary" data-dismiss data-vfy="close">${esc(strings.buttons.cancel)}</button>
                <button type="button" class="primary" data-vfy="start" disabled></button>
            </div>`;
        this.renderVerifyBulkEstimate();
        restoreFocus();
    },

    /** The estimate and the start button of the bulk dialog. */
    renderVerifyBulkEstimate(): void {
        const st = bulk;
        const modal = document.querySelector<HTMLElement>(`#${VERIFY_BULK_DIALOG_ID} .vfy-modal`);
        if (!st || !modal) return;
        const v = strings.verify;
        const est = modal.querySelector<HTMLElement>('.vfy-est');
        const start = modal.querySelector<HTMLButtonElement>('[data-vfy="start"]');
        const e = st.estimate;
        if (est) {
            if (st.error) est.innerHTML = `<p class="vfy-error" role="alert">${esc(st.error)}</p>`;
            else if (!e) est.innerHTML = `<p class="vfy-loading">${esc(v.loading)}</p>`;
            else {
                const head = [v.bulkEstimate(e.facts, e.people), e.estimate.sessions > 0 || e.estimate.usd !== undefined ? v.sessions(e.estimate.sessions, usdText(e.estimate.usd)) : '']
                    .filter(Boolean).join(' · ');
                est.innerHTML = `<p class="vfy-est-head">${esc(head)}</p>`
                    + (e.left > 0 ? `<p class="vfy-est-left">${esc(v.bulkLeft(e.left))}</p>` : '')
                    + `<p class="vfy-est-note">${esc(v.bulkNote)}</p>`;
            }
        }
        if (start) {
            const scopeCount = st.scopes[st.scope]?.count;
            const n = e ? e.facts : scopeCount ?? 0;
            start.innerHTML = researchBridgeActionLabel(st.tryFirst ? v.tryN(VERIFY_TRY_PEOPLE) : v.startN(n), 'verify-bulk');
            start.disabled = !e || e.facts === 0 || st.busy;
            if (st.busy) start.setAttribute('aria-busy', 'true');
            else start.removeAttribute('aria-busy');
        }
    },

    verifyBulkChange(e: Event): void {
        const st = bulk;
        const input = e.target as HTMLInputElement;
        if (!st || !(input instanceof HTMLInputElement)) return;
        if (input.name === 'vfy-scope') st.scope = Number(input.value) || 0;
        else if (input.name === 'vfy-order' && (ORDERS as readonly string[]).includes(input.value)) st.order = input.value as VerifyBulkOrder;
        else if (input.name === 'vfy-try') st.tryFirst = input.checked;
        else return;
        void this.verifyBulkEstimate();
    },

    async verifyBulkStart(): Promise<void> {
        const st = bulk;
        if (!st || st.busy || !st.estimate) return;
        st.busy = true;
        this.renderVerifyBulkEstimate();
        const s = st.scopes[st.scope];
        // After the dialog's dry run under way (the counts still to come are not asked any more).
        const answer: { r: VerifyBulkResult | null } = { r: null };
        await bulkQueued(st, async () => {
            answer.r = await this.postResearchBridgeWrite((base, features) => postVerifyBulk(base, {
                scope: s.scope, ...(s.of ? { of: s.of } : {}), order: st.order, ...(st.tryFirst ? { try: VERIFY_TRY_PEOPLE } : {}),
            }, { features }));
        });
        const r = answer.r;
        if (bulk !== st) return;
        st.busy = false;
        if (!r || !r.ok) {
            st.error = r ? verifyRefusalText(r.code) : strings.verify.failed;
            this.renderVerifyBulkEstimate();
            return;
        }
        this.closeVerifyBulkDialog();
        this.showToast(strings.verify.bulkStarted(r.facts), 5000);
        this.afterVerifyStarted();
    },

    // ==================== The toast after a run (10m) ====================

    /**
     * A status of the open tree's research: the toast once per run of
     * re-verification it reports (`verify.fix.at`, kept per tree), while
     * facts wait. The open places of the verification follow.
     */
    noteVerifyStatus(rid: string, status: LiveStatus): void {
        if (rid.toLowerCase() !== activeResearchId()) return;
        if (document.querySelector('[data-verify-section]')) this.refreshVerifySections();
        const v = status.verify;
        const treeId = DataManager.getCurrentTreeId();
        if (!v || !treeId) return;
        let shown: string | null = null;
        try { shown = localStorage.getItem(TOAST_KEY(treeId)); } catch { /* no storage: shown once per page */ }
        if (shown === null) shown = shownThisPage.get(treeId) ?? null;
        const waiting = v.waiting;
        if (!queuedToastDue(v.fix, waiting, shown)) return;
        const at = v.fix!.at;
        shownThisPage.set(treeId, at);
        try { localStorage.setItem(TOAST_KEY(treeId), at); } catch { /* kept for this page only */ }
        this.showToast(strings.verify.queuedToast(v.fix!.facts || waiting), QUEUED_TOAST_MS, {
            closable: true, kind: 'verify-queued',
            action: { label: strings.verify.details, run: () => this.openVerifyDetails() },
        });
    },
});

/** The run each tree's toast was shown for, when the browser keeps no storage. */
const shownThisPage = new Map<string, string>();
