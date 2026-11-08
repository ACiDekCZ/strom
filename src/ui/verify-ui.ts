/**
 * "Verify facts" at one fact (spec 065 §10.1, kolo 3): what the status tip of
 * a fact's pill (and of the origin row's pill standing for one fact) offers
 * beside the step — the research's reason a fact stays as it is, "Verify"
 * (the research's AI agent through its bridge, the AI badge alone) with its
 * preview in the same tip, the row of a fact waiting to be verified,
 * "Checked against the scan" and its "Undo", and without the research one
 * sentence with the way to it. Table 10z decides (src/verify-ui-model.ts).
 *
 * What the bridge took is shown at once (optimistic) and never written into
 * the tree: the research writes it, and its next version brings the same
 * (`_STROM_VERIFY`, `_STROM_CONFIRMED`). Until the tree holds that version
 * (its holder replaced by a load, an undo, another tree) the answer stands
 * over the fact's own state. A confirmation without the research is the
 * app's own (DataManager.confirmFact), sent on the next sync.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import type { LifeEvent, PartnershipId, PersonId } from '../types.js';
import { FactHolder, factCitations, isPartnership, localIsoDay } from '../import-origin.js';
import { factConfirmation, factPendingPosition, factSourceIds, factVerifyInfo, factVerifyReaders, type FactVerifyInfo } from '../verify.js';
import { postFactConfirm, postVerify, type FactConfirmResult, type VerifyFact, type VerifyResult } from '../research-verify.js';
import type { VerifyResearch } from '../verify-offer.js';
import type { ReliabilityInput, ReliabilityStepName } from '../reliability.js';
import { type FactOffer, factOffer, verifyFactKind, verifyRecordText } from '../verify-ui-model.js';
import { type FactPillTarget, reliabilityLabel, setFactPendingResolver } from './fact-status.js';
import {
    type StatusTipContext, type StatusTipSlots, closeStatusTip, openStatusTip, refreshStatusTip, registerStatusTipExtension,
} from './status-tip.js';
import { researchBridgeActionLabel } from './research-open-mark.js';
import { lastBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lowerFirst = (t: string): string => (t ? t.charAt(0).toLocaleLowerCase() + t.slice(1) : t);

type Lang = 'cs' | 'en' | 'de' | 'pl';
function uiLang(): Lang {
    const l = getCurrentLanguage();
    return l === 'cs' || l === 'de' || l === 'pl' ? l : 'en';
}

/** The clock of the waiting row (12 px, the pill's own is 10 px). */
const CLOCK_SVG = '<svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true" focusable="false">'
    + '<circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1"/>'
    + '<path d="M5 2.6V5l1.7 1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';

/** Steps a research would verify (the sentence without the research stands only at them). */
const VERIFIABLE_STEPS: readonly ReliabilityStepName[] = ['probable', 'possible', 'lead', 'import', 'none'];

// ==================== What the bridge took, until the tree has it ====================

/** A person's (`personId`) or a couple's (`partnershipId`) fact. */
export type VerifyTarget = { personId: string } | { partnershipId: string };

interface LocalState {
    /** The holder as it was when the bridge took it: another one (a load, an undo) ends the state. */
    holder: FactHolder;
    /** Started here: waits for re-verification (its place in the research's queue, when said). */
    pending?: { position: number | null };
    /** Confirmed through the research (its day), or taken back there (null). */
    confirmed?: string | null;
}

const local = new Map<string, LocalState>();

function holderKey(holder: FactHolder): string {
    return isPartnership(holder) ? `u:${holder.id}` : `p:${holder.id}`;
}

function stateKey(holder: FactHolder, fact: string): string {
    return `${DataManager.getCurrentTreeId() ?? ''}|${holderKey(holder)}|${fact}`;
}

function holderOf(target: FactPillTarget): FactHolder | null {
    if (target.partnershipId) return DataManager.getPartnership(target.partnershipId as PartnershipId);
    if (target.personId) return DataManager.getPerson(target.personId as PersonId);
    return null;
}

/** The fact's state the bridge took, while the tree does not hold it yet. */
function localOf(holder: FactHolder, fact: string): LocalState | null {
    const key = stateKey(holder, fact);
    const s = local.get(key);
    if (!s) return null;
    if (s.holder !== holder) { local.delete(key); return null; }
    return s;
}

function setLocal(holder: FactHolder, fact: string, patch: Partial<Omit<LocalState, 'holder'>>): void {
    const key = stateKey(holder, fact);
    const was = local.get(key);
    const base: LocalState = was && was.holder === holder ? was : { holder };
    local.set(key, { ...base, ...patch, holder });
}

/** Whether a fact waits for re-verification: started here, or as the research's file says. */
export function factWaitsForVerify(holder: FactHolder, fact: string): boolean {
    return !!localOf(holder, fact)?.pending || !!holder.researchVerify?.[fact]?.pending;
}

/**
 * The confirmation the bridge took, over the fact's own (ReliabilityOptions.evidence):
 * a confirmation said at once, one taken back there no longer counted (the app's own still does).
 */
export function verifyLocalEvidence(holder: FactHolder, fact: string): Pick<ReliabilityInput, 'confirmedByHuman'> | undefined {
    const s = localOf(holder, fact);
    if (!s || s.confirmed === undefined) return undefined;
    if (s.confirmed) return { confirmedByHuman: true };
    return factConfirmation(holder, fact) ? undefined : { confirmedByHuman: false };
}

/** The fact's confirmation and verification with what the bridge took over it. */
function infoWithLocal(holder: FactHolder, fact: string): FactVerifyInfo {
    const info = factVerifyInfo(holder, fact);
    const s = localOf(holder, fact);
    if (!s || s.confirmed === undefined) return info;
    if (s.confirmed) return { ...info, confirmed: s.confirmed, confirmedBy: 'research' };
    if (info.confirmedBy !== 'research') return info;
    const { confirmed: _c, confirmedBy: _b, ...rest } = info;
    return rest;
}

/** Redraws the pills and the tip after a change (set when the UI installs it). */
let redraw: (() => void) | null = null;

/**
 * Facts the research took for re-verification elsewhere (the person's
 * preview, the card's tip): their pills show the clock and their tips the
 * waiting row at once, until the tree holds the research's version.
 */
export function markVerifyPending(target: VerifyTarget, facts: string[], position?: number): void {
    const holder = holderOf(target);
    if (!holder) return;
    for (const fact of facts) setLocal(holder, fact, { pending: { position: position ?? null } });
    redraw?.();
}

// ==================== Keeping a pinned tip over a redraw ====================

/** A selector finding a pill again after its row is drawn anew (same holder, fact and place). */
function pillSelector(pill: HTMLElement): string {
    const q = (v: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'));
    const parts = ['button.fact-status'];
    if (pill.dataset.stPerson) parts.push(`[data-st-person="${q(pill.dataset.stPerson)}"]`);
    if (pill.dataset.stPartnership) parts.push(`[data-st-partnership="${q(pill.dataset.stPartnership)}"]`);
    if (pill.dataset.fact) parts.push(`[data-fact="${q(pill.dataset.fact)}"]`);
    parts.push(pill.dataset.stFacts ? `[data-st-facts="${q(pill.dataset.stFacts)}"]` : ':not([data-st-facts])');
    const box = pill.parentElement?.closest<HTMLElement>('[id]')?.id;
    return box ? `#${q(box)} ${parts.join('')}` : parts.join('');
}

/**
 * Run a redraw of pills (`fn`) keeping the pinned status tip: on the pill
 * drawn in its place it opens again (pinned), else it is drawn again.
 */
export function keepPinnedStatusTip(fn: () => void): void {
    const was = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('button.fact-status.st-pinned') : null;
    const sel = was ? pillSelector(was) : null;
    fn();
    if (!was || !sel) return;
    if (was.isConnected) { refreshStatusTip(); return; }
    const next = document.querySelector<HTMLElement>(sel);
    if (next) openStatusTip(next, { pinned: true });
}

// ==================== The tip's own state ====================

/** What the open tip shows of one fact beside its step (the preview, a refusal). */
interface TipState {
    tip: Element;
    key: string;
    preview?: { loading: boolean; result?: VerifyResult; starting?: boolean; failed?: boolean };
    /** A request on its way (its action's buttons wait). */
    busy?: 'scan' | 'undo';
    /** A sentence under the buttons (the bridge did not take it). */
    error?: string;
}

let tipState: TipState | null = null;

function stateFor(tip: Element | null, key: string): TipState | null {
    return tipState && tipState.tip === tip && tipState.key === key ? tipState : null;
}

// ==================== Words ====================

/** A fact's name in the preview's header ("birth", "baptism"; German nouns keep their capital). */
function factNameText(holder: FactHolder, fact: string): string {
    if (fact === 'marriage') return strings.verify.marriage;
    if (fact === 'birth' || fact === 'death' || fact === 'name') return strings.reliability.cardFact[fact];
    const kind = verifyFactKind(holder, fact);
    const word = kind ? strings.verify.kinds[kind] ?? '' : '';
    if (word) return uiLang() === 'de' ? word : lowerFirst(word);
    if (fact === 'sex') return strings.reliability.part.SEX;
    return fact;
}

/** The fact's value as the preview's "What" says it: its date and place. */
function factValueText(holder: FactHolder, fact: string): string {
    const lang = uiLang();
    const join = (date?: string, place?: string): string => [date ? formatFlexDate(date, lang) : '', place ?? ''].filter(Boolean).join(', ');
    if (isPartnership(holder)) return fact === 'marriage' ? join(holder.startDate, holder.startPlace) : '';
    if (fact === 'birth') return join(holder.birthDate, holder.birthPlace);
    if (fact === 'death') return join(holder.deathDate, holder.deathPlace);
    if (fact.startsWith('event:')) {
        const ev = (holder.events ?? []).find(e => e?.id === fact.slice(6)) as LifeEvent | undefined;
        return ev ? join(ev.date, ev.place) : '';
    }
    return '';
}

function usdText(usd: number | undefined): string {
    if (usd === undefined) return '';
    try {
        return new Intl.NumberFormat(uiLang(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);
    } catch {
        return `$${usd.toFixed(2)}`;
    }
}

function dayText(day: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFlexDate(day, uiLang()) : day;
}

// ==================== Drawing ====================

/** One button of the tip's actions. */
function button(act: string, labelHtml: string, opts: { primary?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `st-v-btn${opts.primary ? ' is-primary' : ''}`;
    b.dataset.vAct = act;
    b.innerHTML = labelHtml;
    if (opts.disabled) b.disabled = true;
    return b;
}

function block(cls: string, html: string): HTMLElement {
    const d = document.createElement('div');
    d.className = `st-v-block ${cls}`;
    d.innerHTML = html;
    return d;
}

/** What one fact's tip needs: its holder, offer, state. */
interface FactView {
    holder: FactHolder;
    fact: string;
    target: FactPillTarget;
    offer: FactOffer;
    info: FactVerifyInfo;
    step: ReliabilityStepName | null;
    key: string;
}

export const verifyUiMethods = uiModule({
    /** The fact-level "Verify facts" (status tip extension, the pills' clock), installed once. */
    installVerifyUi(): void {
        if (verifyUiInstalled) return;
        verifyUiInstalled = true;
        const ui = this;
        setFactPendingResolver((target, fact) => {
            const holder = holderOf(target);
            return !!holder && factWaitsForVerify(holder, fact);
        });
        redraw = () => ui.verifyRedraw();
        registerStatusTipExtension((ctx, slots) => ui.drawVerifyTip(ctx, slots));
    },

    /** The research the active tree is linked to, as the offer needs it (null: none). */
    verifyResearchNow(): VerifyResearch | null {
        const rid = this.activeResearchId();
        if (!rid) return null;
        const status = this.researchStatusOf(rid) ?? lastBridgeStatus(rid);
        return { features: status?.features ?? [], treeState: this.researchTreeSaid(rid)?.state };
    },

    /** One fact's offer as the tip shows it now. */
    verifyFactView(ctx: StatusTipContext): FactView | null {
        if (ctx.kind !== 'fact' && ctx.kind !== 'origin') return null;
        // The origin row's pill for several facts: the person's own actions are elsewhere.
        if (ctx.facts.length !== 1) return null;
        const fact = ctx.facts[0];
        const target: FactPillTarget = ctx.partnershipId ? { partnershipId: ctx.partnershipId } : { personId: ctx.personId };
        const holder = holderOf(target);
        if (!holder) return null;
        const info = infoWithLocal(holder, fact);
        const step = ctx.step ?? null;
        const offer = factOffer(holder, fact, {
            step,
            research: this.verifyResearchNow(),
            researchTree: this.reliabilityOptionsNow().researchTree,
            cited: factCitations(DataManager.getData(), holder, fact).length > 0,
            info,
            localPending: !!localOf(holder, fact)?.pending,
            editable: !DataManager.isReadOnly(),
        });
        return { holder, fact, target, offer, info, step, key: stateKey(holder, fact) };
    },

    /** The status tip's extension: the reason, the actions, the preview of one fact. */
    drawVerifyTip(ctx: StatusTipContext, slots: StatusTipSlots): void {
        const tip = slots.actions.closest<HTMLElement>('.status-tip');
        tip?.classList.remove('st-previewing');
        const v = this.verifyFactView(ctx);
        if (!v || !tip) return;
        const st = stateFor(tip, v.key);
        if (st?.preview && v.offer.verify) {
            tip.classList.add('st-previewing');
            this.drawVerifyPreview(v, st, slots);
            return;
        }
        if (st?.preview) st.preview = undefined;
        this.drawVerifyReason(v, tip, slots);
        this.drawVerifyActions(v, st, slots);
    },

    /** The reason it stays, "confirmed by a person on …", "two readers agree". */
    drawVerifyReason(v: FactView, tip: HTMLElement, slots: StatusTipSlots): void {
        const { offer, info } = v;
        if (offer.row === 'confirmed' && info.confirmed) {
            // The tip's sentence says who confirmed it and when.
            const text = strings.verify.confirmedAt(dayText(info.confirmed));
            let sentence = tip.querySelector<HTMLElement>('.st-sentence');
            if (!sentence) {
                sentence = document.createElement('div');
                sentence.className = 'st-sentence';
                slots.reason.before(sentence);
            }
            sentence.textContent = text;
        }
        const checked = info.checked;
        if (offer.row === 'reason' && checked?.why && v.step) {
            const label = lowerFirst(reliabilityLabel(v.step));
            const data = DataManager.getData();
            const srcId = factSourceIds(v.holder, v.fact).find(id => data.sources?.[id]);
            const src = srcId ? data.sources![srcId] : null;
            const ctxJson = JSON.stringify(isPartnership(v.holder) ? { partnershipId: v.holder.id } : { personId: v.holder.id });
            slots.reason.insertAdjacentHTML('beforeend', `<div class="st-v-box st-v-reason">
                <div class="st-v-head">${esc(strings.verify.reasonHead(label, checked.date ? dayText(checked.date) : ''))}</div>
                <div class="st-v-why">${esc(checked.why)}</div>
                ${src ? `<button type="button" class="st-src st-link st-v-src" data-source-id="${esc(src.id)}" data-ctx="${esc(ctxJson)}">${esc(src.title)}</button>` : ''}
            </div>`);
        }
        const readers = factVerifyReaders(v.holder, v.fact) ?? 0;
        const agree = strings.reliability.readersAgree;
        if (readers >= 2 && !(tip.textContent ?? '').includes(agree)) {
            slots.reason.insertAdjacentHTML('beforeend', `<div class="st-v-line st-v-readers">${esc(agree.charAt(0).toLocaleUpperCase() + agree.slice(1))}</div>`);
        }
    },

    /** The waiting row, the buttons, a refusal, the sentence without the research. */
    drawVerifyActions(v: FactView, st: TipState | null, slots: StatusTipSlots): void {
        const { offer } = v;
        const s = strings.verify;
        if (offer.row === 'pending') {
            const pos = localOf(v.holder, v.fact)?.pending?.position ?? factPendingPosition(v.holder, v.fact);
            slots.actions.appendChild(block('st-v-state', `${CLOCK_SVG}<span>${esc(pos ? s.pending(pos) : s.pendingNoPos)}</span>`));
        }
        if (offer.verify) {
            const b = button('verify', researchBridgeActionLabel(s.btn, 'verify'), { disabled: !!st?.busy });
            b.addEventListener('click', () => this.verifyOpenPreview(v));
            slots.actions.appendChild(b);
        }
        if (offer.scan) {
            const b = button('scan', `<span class="st-v-check" aria-hidden="true">✓</span>${researchBridgeActionLabel(s.scan, 'fact-confirm')}`,
                { disabled: !!st?.busy });
            b.addEventListener('click', () => { void this.verifyConfirm(v, true); });
            slots.actions.appendChild(b);
        }
        if (offer.undo) {
            const b = button('undo', researchBridgeActionLabel(s.undo, 'fact-confirm'), { disabled: !!st?.busy });
            b.addEventListener('click', () => { void this.verifyConfirm(v, false); });
            slots.actions.appendChild(b);
        }
        if (st?.error) slots.actions.appendChild(block('st-v-note is-error', esc(st.error)));
        if (offer.row === 'noResearch' && v.step && VERIFIABLE_STEPS.includes(v.step) && verifyFactKind(v.holder, v.fact)) {
            const aside = block('st-v-aside', `<div>${esc(s.noResearch)}</div>`);
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'st-link st-v-promo';
            link.textContent = `${strings.research.menuItem} ›`;
            link.addEventListener('click', () => {
                tipState = null;
                closeStatusTip();
                this.showResearchInfoDialog();
            });
            aside.appendChild(link);
            slots.actions.appendChild(aside);
        }
    },

    /** The preview in place of the sources: What / How / Estimate, Back and Start. */
    drawVerifyPreview(v: FactView, st: TipState, slots: StatusTipSlots): void {
        const s = strings.verify;
        const p = st.preview!;
        const rows: string[] = [];
        const row = (label: string, value: string, sub = ''): string => `<div class="st-preview-row">
            <span class="st-preview-label">${esc(label)}</span>
            <span class="st-preview-value">${esc(value)}${sub ? `<span class="st-preview-sub">${esc(sub)}</span>` : ''}</span></div>`;
        let note = '';
        let canStart = false;
        let failed = !!p.failed;
        if (p.loading) {
            rows.push(`<div class="st-v-line">${esc(s.loading)}</div>`);
        } else if (p.result?.ok) {
            const eid = v.offer.eid;
            const f: VerifyFact | undefined = p.result.facts.find(x => x.fact === eid) ?? p.result.facts[0];
            if (!f) {
                rows.push(`<div class="st-v-line">${esc(s.nothing)}</div>`);
            } else {
                const cited = factCitations(DataManager.getData(), v.holder, v.fact)[0]?.source.title ?? '';
                const record = verifyRecordText(f.record) || cited;
                const what = factValueText(v.holder, v.fact);
                if (what) rows.push(row(s.what, what));
                rows.push(row(s.how, f.how === 'read' ? s.howRead(record) : s.howSearch(record)));
                const est = p.result.estimate;
                rows.push(row(s.estimate1, f.how === 'read' ? s.costLow : s.costHigh,
                    est.sessions > 0 ? s.sessions(est.sessions, usdText(est.usd)) : ''));
                note = f.how === 'search' ? s.previewNoteSearch : s.previewNote;
                canStart = true;
            }
        } else if (p.result && !p.result.ok) {
            if (p.result.code === 'verify.nothing') rows.push(`<div class="st-v-line">${esc(s.nothing)}</div>`);
            else failed = true;
        }
        slots.actions.appendChild(block('st-preview', `<div class="st-preview-head">${esc(s.previewHead(factNameText(v.holder, v.fact)))}</div>`
            + rows.join('') + (note ? `<div class="st-preview-note">${esc(note)}</div>` : '')));
        const back = button('back', esc(s.back));
        back.addEventListener('click', () => this.verifyClosePreview(v));
        const start = button('start', researchBridgeActionLabel(s.start, 'verify'), { primary: true, disabled: !canStart || !!p.starting });
        start.addEventListener('click', () => { void this.verifyStart(v); });
        slots.actions.append(back, start);
        if (failed) slots.actions.appendChild(block('st-v-note is-error', esc(s.failed)));
    },

    /** "Verify": the preview from a dry run of the research, in the same tip. */
    verifyOpenPreview(v: FactView): void {
        const tip = document.querySelector('#status-tip');
        const eid = v.offer.eid;
        if (!tip || !eid) return;
        const preview: NonNullable<TipState['preview']> = { loading: true };
        tipState = { tip, key: v.key, preview };
        this.verifyTipRedrawn('back');
        void this.postResearchBridgeWrite((base, features) => postVerify(base, { fact: eid }, { features, dry: true }), { load: false })
            .then((result) => {
                if (tipState?.preview !== preview) return;
                preview.loading = false;
                if (result) preview.result = result;
                else preview.failed = true;
                this.verifyTipRedrawn(result?.ok ? 'start' : 'back');
            });
    },

    /** "Back": the tip as it was. */
    verifyClosePreview(v: FactView): void {
        if (tipState?.key === v.key) tipState = null;
        this.verifyTipRedrawn('verify');
    },

    /** "Start verifying": the research takes the fact first in its queue; the pill waits. */
    async verifyStart(v: FactView): Promise<void> {
        const eid = v.offer.eid;
        const preview = tipState?.key === v.key ? tipState.preview : undefined;
        if (!eid || !preview || preview.starting) return;
        preview.starting = true;
        preview.failed = false;
        this.verifyTipRedrawn('start');
        const result = await this.postResearchBridgeWrite((base, features) => postVerify(base, { fact: eid }, { features }));
        if (tipState?.preview !== preview) return;
        preview.starting = false;
        if (!result?.ok) {
            preview.failed = true;
            this.verifyTipRedrawn('start');
            return;
        }
        tipState = null;
        const holder = holderOf(v.target);
        if (holder) setLocal(holder, v.fact, { pending: { position: result.position ?? null } });
        this.verifyRedraw('scan');
    },

    /**
     * "Checked against the scan" (`confirm`) or its "Undo": through the
     * research when the fact is its (by its id), else the app's own
     * confirmation. Undone: a toast with "Redo".
     */
    async verifyConfirm(v: FactView, confirm: boolean): Promise<void> {
        const tip = document.querySelector('#status-tip');
        const viaBridge = confirm ? v.offer.scanViaBridge : v.offer.undoViaBridge;
        // Undone: "Redo" confirms it again the same way.
        const done = (): void => {
            if (confirm) return;
            const again: FactView = { ...v, offer: { ...v.offer, scanViaBridge: viaBridge } };
            // Undone in the person editor or the relationships panel: the toast stands above
            // the dialog's overlay (its "Redo" reachable) and clear of the dialog's buttons.
            const clearOf = document.querySelector('#person-modal.active') ? '#person-modal.active .pm-footer'
                : document.querySelector('#relationships-modal.active') ? '#relationships-modal.active .buttons' : undefined;
            this.showToast(strings.verify.undone, 5000, {
                kind: 'verify-confirm', ...(clearOf ? { clearOf } : {}),
                action: { label: strings.undo.redo, run: () => { void this.verifyConfirm(again, true); } },
            });
        };
        if (!viaBridge) {
            const target = v.target.partnershipId
                ? { partnershipId: v.target.partnershipId as PartnershipId } : { personId: v.target.personId as PersonId };
            const ok = confirm ? DataManager.confirmFact(target, v.fact) : DataManager.unconfirmFact(target, v.fact);
            if (tipState?.key === v.key) tipState = null;
            this.verifyRedraw(confirm ? 'undo' : 'scan');
            if (ok) done();
            return;
        }
        const eid = v.offer.eid;
        if (!eid) return;
        // "Redo" from the toast comes with the tip closed: the request goes all the same.
        if (tip) {
            tipState = { tip, key: v.key, busy: confirm ? 'scan' : 'undo' };
            this.verifyTipRedrawn(confirm ? 'scan' : 'undo');
        }
        const result: FactConfirmResult | null = await this.postResearchBridgeWrite(
            (base, features) => postFactConfirm(base, eid, confirm, { features }));
        if (tipState?.key === v.key) tipState = null;
        if (!result?.ok) {
            if (tip && document.querySelector('#status-tip') === tip) {
                tipState = { tip, key: v.key, error: strings.verify.confirmFailed };
                this.verifyTipRedrawn(confirm ? 'scan' : 'undo');
            } else {
                this.showToast(strings.verify.confirmFailed, 5000, { alert: true, kind: 'verify-confirm' });
            }
            return;
        }
        const holder = holderOf(v.target);
        if (holder) setLocal(holder, v.fact, { confirmed: confirm ? result.confirmed ?? localIsoDay() : null });
        this.verifyRedraw(confirm ? 'undo' : 'scan');
        done();
    },

    /** The tip drawn again (its own state changed), the focus kept on its action. */
    verifyTipRedrawn(focus?: string): void {
        const tip = document.querySelector<HTMLElement>('#status-tip');
        const hadFocus = !!tip && tip.contains(document.activeElement);
        refreshStatusTip();
        if (hadFocus) this.verifyFocusAct(focus);
    },

    /** The pills and the open tip drawn again (a fact's state changed). */
    verifyRedraw(focus?: string): void {
        const tip = document.querySelector<HTMLElement>('#status-tip');
        const hadFocus = !!tip && tip.contains(document.activeElement);
        keepPinnedStatusTip(() => {
            this.refreshPersonReliability();
            if (this.relationshipsPanelPersonId) this.refreshRelationshipsPanel();
        });
        if (hadFocus) this.verifyFocusAct(focus);
    },

    verifyFocusAct(focus?: string): void {
        const tip = document.querySelector<HTMLElement>('#status-tip');
        if (!tip) return;
        const el = (focus ? tip.querySelector<HTMLElement>(`[data-v-act="${focus}"]:not(:disabled)`) : null)
            ?? tip.querySelector<HTMLElement>('.st-v-btn:not(:disabled)')
            ?? tip.querySelector<HTMLElement>('.st-help');
        el?.focus({ preventScroll: true });
    },

});

let verifyUiInstalled = false;

/** For tests: forget what the bridge took. */
export function resetVerifyUiState(): void {
    local.clear();
    tipState = null;
}
