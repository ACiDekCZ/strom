/**
 * "Originally from the family tree:" under a fact of the person card the
 * research changed (spec 066 §3): the family tree's value, the record it was
 * changed by ("per …", opens the source), "(accepted proposal)" for a
 * proposal a person took, and Revert through the research's bridge
 * (POST …/facts/revert, conflict-decide-ui.ts researchRevertFact) — with its
 * confirmation, "Reverting…", the refusals under the row and the phone's
 * sentence. Under it the research's proposal on the fact (a conflict of the
 * kind import / user) with "Conflict ›" or "Decide in the research".
 * Only for the research's tree whose bridge names `origin`
 * (researchShowsOriginNow); otherwise nothing of it.
 *
 * Where: the birth, the death and the events in the events list
 * (person-events.ts), the name under the name fields and the sex under its
 * segment (here). The data come from src/origin-was.ts.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { gedcomTagEventType } from '../ged-parser.js';
import { factParts, factValue, importRecordOf } from '../import-origin.js';
import { researchLinkMark } from '../research-link.js';
import { canDecideInApp, conflictSides } from '../research-decide.js';
import {
    conflictFact, proposalModel, revertAvailability, revertControls, revertOutcome, RevertUiState, wasRowModel, WasRowModel,
} from '../origin-was.js';
import type { FactPart, LifeEvent, Person, PersonId, ResearchConflict } from '../types.js';
import type { ResearchConflictTake } from '../research-link.js';
import type { ConflictCardView } from '../research-conflict-card.js';
import { conflictScope, researchValueText } from './person-research-ui.js';
import { eventTypeLabel } from './person-events.js';
import { importOriginParts } from './fact-status.js';
import { researchActionLabel } from './research-open-mark.js';
import { onComputer } from './research-ui.js';
import { uiModule } from './module.js';

const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Where each revert stands, per person and fact (a card drawn again keeps it). */
const states = new Map<string, RevertUiState>();
let clicksInstalled = false;

const stateKey = (personId: string, fact: string): string => `${personId}|${fact}`;

/** The parts of a fact in the order they are said. */
const PART_ORDER: readonly FactPart[] = ['VAL', 'GIVN', 'SURN', 'DATE', 'PLAC', 'SEX'];

/** A part's value as people read it (`raw`: the research's GEDCOM words, or the app's own value). */
function partText(part: FactPart | undefined, value: string, raw: boolean): string {
    const v = (value ?? '').trim();
    if (!v) return '';
    if (part === 'SEX') {
        if (raw) return researchValueText('SEX', v);
        return v === 'male' ? strings.gender.male : v === 'female' ? strings.gender.female : strings.gender.unknown;
    }
    if (part === 'DATE') return raw ? researchValueText('DATE', v) : (formatFlexDate(v) || v);
    if (part === 'GIVN' || part === 'SURN') return v.replace(/\//g, '').trim();
    // The whole fact as the research wrote it: a date read as one, a name without its slashes.
    return raw ? researchValueText('', v.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()) : v;
}

function joinParts(fact: string, values: string[]): string {
    return values.filter(Boolean).join(fact === 'name' ? ' ' : ', ');
}

/** The fact's name in sentences ("Birth", "Name", "Occupation"). */
export function originFactLabel(person: Person, fact: string): string {
    if (fact === 'name') return strings.research.factName;
    if (fact === 'sex') return strings.labels.gender;
    if (fact === 'birth') return strings.events.types.birth;
    if (fact === 'death') return strings.events.types.death;
    if (fact.startsWith('event:')) {
        const ev = (person.events ?? []).find(e => e?.id === fact.slice(6)) as LifeEvent | undefined;
        if (ev) return eventTypeLabel(ev);
    }
    return fact;
}

/** The fact's value now, as people read it. */
export function originFactNow(person: Person, fact: string): string {
    const parts = factParts(person, fact);
    return joinParts(fact, PART_ORDER.filter(p => parts[p]).map(p => partText(p, factValue(person, parts[p]!), false)));
}

/** The row's earlier value: the changed parts', with the words for several. */
export function originWasText(model: WasRowModel, fact: string): string {
    const text = joinParts(fact, model.values.map(v => partText(v.part, v.value, true)));
    const o = strings.origin;
    const label = model.partsLabel === 'datePlace' ? o.partsDatePlace
        : model.partsLabel === 'name' ? o.partsName
        : model.partsLabel === 'other' ? `(${strings.reliability.joinParts(model.values.filter(v => v.part).map(v => strings.reliability.part[v.part!]))})`
        : '';
    return label ? `${text} ${label}` : text;
}

/** The whole fact as it would be after the revert (the confirmation's {was}): the changed parts put back. */
export function originWasWhole(person: Person, fact: string, model: WasRowModel): string {
    if (model.values.length === 1 && !model.values[0].part) return partText(undefined, model.values[0].value, true);
    const parts = factParts(person, fact);
    const back = new Map(model.values.map(v => [v.part, v.value]));
    const order = PART_ORDER.filter(p => parts[p] || back.has(p));
    return joinParts(fact, order.map(p => back.has(p) ? partText(p, back.get(p)!, true) : partText(p, factValue(person, parts[p]!), false)));
}

export const factOriginMethods = uiModule({
    /**
     * The research's origin in this page: `live` (its bridge answers and
     * names `origin`), `down` (its bridge does not answer here — the
     * research not running, a phone: the rows stand, Revert waits or the
     * phone's sentence says where it works; only a research with `origin`
     * writes them into its tree), `off` (no research tree, or a bridge
     * answering without `origin`: nothing of §3).
     */
    researchOriginBridge(): 'live' | 'down' | 'off' {
        const id = this.activeResearchId();
        if (!id) return 'off';
        if (this.researchShowsOriginNow()) return 'live';
        return this.researchStatusOf(id) ? 'off' : 'down';
    },

    /** The open conflicts of a kind (import / user) at a person's facts, by fact. */
    originProposalsOf(person: Person): Map<string, ResearchConflict> {
        const out = new Map<string, ResearchConflict>();
        for (const c of person.research?.conflicts ?? []) {
            if (c.status !== 'open' || !c.kind) continue;
            const fact = conflictFact(c, person, gedcomTagEventType);
            if (fact && !out.has(fact)) out.set(fact, c);
        }
        return out;
    },

    /**
     * The rows under one fact of a person: "Originally…" with its Revert and
     * the sentence of a refusal, then the research's proposal ('' for none).
     */
    factOriginHtml(person: Person, fact: string, bridgeNow?: 'live' | 'down' | 'off', proposalsNow?: Map<string, ResearchConflict>): string {
        const bridge = bridgeNow ?? this.researchOriginBridge();
        if (bridge === 'off') return '';
        const proposals = proposalsNow ?? this.originProposalsOf(person);
        const o = strings.origin;
        const sources = DataManager.getData().sources ?? {};
        const origin = person.researchOrigins?.[fact];
        const model = wasRowModel(origin, id => !!sources[id]);
        const key = stateKey(person.id, fact);
        if (!model) states.delete(key);
        let html = '';
        if (model) {
            const available = revertAvailability({ ref: model.ref, onComputer: onComputer(), bridge: bridge === 'live' ? 'live' : 'down' });
            const c = revertControls(available, states.get(key));
            const source = model.sourceId
                ? `<button type="button" class="fact-origin-link fact-was-source" data-origin-act="source" data-source="${esc(model.sourceId)}">${esc(o.by(sources[model.sourceId].title))}</button>` : '';
            const accepted = model.accepted ? `<span class="fact-was-accepted">${esc(o.accepted)}</span>` : '';
            const revert = c.revert === 'button'
                ? `<button type="button" class="fact-origin-act fact-was-revert" data-origin-act="revert">${esc(o.revert)}</button>`
                : c.revert === 'disabled'
                    ? `<button type="button" class="fact-origin-act fact-was-revert" data-origin-act="revert" disabled>${esc(o.revert)}</button>`
                    : c.revert === 'live'
                        ? `<span class="fact-was-live" role="status"><i aria-hidden="true"></i>${esc(o.reverting)}</span>` : '';
            html += `
                <div class="fact-was" data-fact="${esc(fact)}">
                    <span class="fact-was-key">${esc(o.was)}</span>
                    <span class="fact-was-value">${esc(originWasText(model, fact))}</span>
                    ${source}${accepted}${revert}
                </div>`;
            if (c.note) {
                const n = c.note;
                const text = n.kind === 'held' ? o.held('computer' in n ? n.computer ?? '' : '')
                    : n.kind === 'busy' ? o.busy
                    : n.kind === 'gone' ? o.gone
                    : n.kind === 'noBridge' ? o.noBridge
                    : n.kind === 'phone' ? o.phone
                    : o.error;
                const faint = n.kind === 'noBridge' || n.kind === 'phone';
                html += `
                <div class="fact-was-note${faint ? ' fact-was-note--faint' : ''}" data-note="${n.kind}"${faint ? '' : ' role="status"'}>
                    <span>${esc(text)}</span>${c.retry ? `
                    <button type="button" class="fact-origin-act fact-was-retry" data-origin-act="retry">${esc(strings.conflict.retry)}</button>` : ''}
                </div>`;
            }
        }
        const conflict = proposals.get(fact);
        if (conflict) html += this.factProposalHtml(person, fact, conflict, !!model);
        return html ? `<div class="fact-origin" data-origin-fact="${esc(fact)}">${html}</div>` : '';
    },

    /** The research's proposal at a fact: what it proposes, the record, and the way to decide it. */
    factProposalHtml(person: Person, fact: string, c: ResearchConflict, hasWas: boolean): string {
        const o = strings.origin;
        const origin = person.researchOrigins?.[fact];
        const partial = hasWas || (origin?.kind === 'import' && !!origin.parts?.length);
        const model = proposalModel(c, {
            scope: conflictScope(c), partial, event: fact !== 'name' && fact !== 'sex',
            canDecide: canDecideInApp(c, person),
            decideLink: !!this.activeResearchLink('conflict', { conflict: c.id, conflictDo: 'decide' }),
        });
        if (!model) return '';
        const lead = model.lead === 'user' ? o.proposeUser
            : model.lead === 'importPart' && model.part ? o.proposeImportPart(strings.reliability.part[model.part])
            : o.proposeImport;
        const sources = DataManager.getData().sources ?? {};
        const value = model.value ? researchValueText(c.fact, model.value.raw ?? model.value.value) : '';
        const sid = model.value?.sourceIds?.find(s => sources[s]);
        const source = sid
            ? `<button type="button" class="fact-origin-link fact-proposal-source" data-origin-act="source" data-source="${esc(sid)}">${esc(o.by(sources[sid].title))}</button>` : '';
        const action = model.action === 'open'
            ? `<button type="button" class="fact-origin-act fact-proposal-open" data-origin-act="conflict" data-conflict="${esc(c.id)}">${esc(o.conflictOpen)}</button>`
            : model.action === 'decide'
                ? `<button type="button" class="fact-origin-act fact-proposal-decide" data-origin-act="decide" data-conflict="${esc(c.id)}">${researchActionLabel(strings.research.decide, researchLinkMark('conflict', { conflictDo: 'decide' }))}</button>`
                : '';
        return `
                <div class="fact-proposal" data-conflict-kind="${c.kind}">
                    <span class="fact-proposal-lead">${esc(lead)}</span>
                    ${value ? `<span class="fact-proposal-value">${esc(value)}</span>` : ''}
                    ${source}${action}
                </div>`;
    },

    /**
     * The name's and the sex's rows on the person card (under the name
     * fields, under the sex's segment); the events list draws its own.
     */
    renderPersonFactOrigins(personId: PersonId | null): void {
        this.installFactOriginClicks();
        const person = personId ? DataManager.getPerson(personId) : null;
        const bridge = person ? this.researchOriginBridge() : 'off';
        const proposals = person ? this.originProposalsOf(person) : new Map<string, ResearchConflict>();
        const slot = (name: string, place: () => Element | null | undefined, after: boolean): void => {
            let el = document.querySelector<HTMLElement>(`#person-modal .fact-origin-slot[data-slot="${name}"]`);
            const html = person ? this.factOriginHtml(person, name, bridge, proposals) : '';
            if (!html) {
                el?.remove();
                return;
            }
            if (!el) {
                const at = place();
                if (!at) return;
                el = document.createElement('div');
                el.className = 'fact-origin-slot';
                el.dataset.slot = name;
                if (after) at.after(el);
                else at.appendChild(el);
            }
            el.innerHTML = html;
        };
        slot('name', () => document.getElementById('input-firstname')?.closest('.form-grid'), true);
        slot('sex', () => document.getElementById('gender-segment')?.closest('.form-group'), false);
    },

    /** One handler for the rows of the person card (they are drawn again often). */
    installFactOriginClicks(): void {
        if (clicksInstalled) return;
        clicksInstalled = true;
        document.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('#person-modal [data-origin-act]');
            if (!btn || btn.disabled) return;
            const personId = this.currentId;
            const fact = btn.closest<HTMLElement>('.fact-origin')?.dataset.originFact;
            if (!personId || !fact) return;
            e.preventDefault();
            e.stopPropagation();
            const act = btn.dataset.originAct;
            if (act === 'revert') void this.confirmFactRevert(personId, fact);
            else if (act === 'retry') void this.runFactRevert(personId, fact);
            else if (act === 'source') this.showSourceViewer(btn.dataset.source ?? '', { personId, ...(fact.startsWith('event:') ? { eventId: fact.slice(6) } : {}) });
            else if (act === 'conflict') this.openOriginConflict(personId, btn.dataset.conflict ?? '');
            else if (act === 'decide') {
                const url = this.activeResearchLink('conflict', { conflict: btn.dataset.conflict, conflictDo: 'decide' });
                if (url) this.launchResearchLink(url, 'terminal');
            }
        });
    },

    /** "Conflict ›": the conflict's panel by its field (the tag there), else the dialog at its card. */
    openOriginConflict(personId: PersonId, conflictId: string): void {
        const tag = conflictId ? document.querySelector<HTMLElement>(`#person-modal .pm-conflict-tag[data-conflict="${CSS.escape(conflictId)}"]`) : null;
        if (tag) {
            tag.scrollIntoView({ block: 'nearest' });
            tag.click();
            return;
        }
        this.showPersonResearchDialog(personId, { conflict: conflictId });
    },

    /** Revert asked: the confirmation, then the revert. */
    async confirmFactRevert(personId: PersonId, fact: string): Promise<void> {
        const person = DataManager.getPerson(personId);
        const sources = DataManager.getData().sources ?? {};
        const model = wasRowModel(person?.researchOrigins?.[fact], id => !!sources[id]);
        if (!person || !model?.ref) return;
        const o = strings.origin;
        const src = model.sourceId ? sources[model.sourceId].title : '';
        const message = `${o.confirmText(originFactLabel(person, fact), originFactNow(person, fact), src, originWasWhole(person, fact, model))}\n${o.confirmNote}`;
        if (!await this.showConfirm(message, o.confirmTitle, { ok: o.revert, cancel: strings.buttons.cancel })) return;
        await this.runFactRevert(personId, fact);
    },

    /**
     * The revert through the bridge: "Reverting…" meanwhile; written (or
     * nothing to put back) — the row goes with the research's new version and
     * a notice says so; a refusal stays under the row.
     */
    async runFactRevert(personId: PersonId, fact: string): Promise<void> {
        const person = DataManager.getPerson(personId);
        const sources = DataManager.getData().sources ?? {};
        const model = wasRowModel(person?.researchOrigins?.[fact], id => !!sources[id]);
        const key = stateKey(personId, fact);
        if (!person || !model?.ref || states.get(key)?.kind === 'reverting') return;
        const label = originFactLabel(person, fact);
        states.set(key, { kind: 'reverting' });
        this.refreshPersonReliability();
        const result = await this.researchRevertFact(personId, fact, model.ref, model.part);
        const out = revertOutcome(result);
        states.set(key, out.state);
        if (out.toast === 'reverted') this.showToast(strings.origin.toast(label), 5000);
        else if (out.toast === 'already') this.showToast(strings.origin.already, 5000);
        this.refreshPersonReliability();
    },

    /** The import's file under today's side of a conflict about a family tree's value ('' when not known). */
    originConflictImportSource(personId: PersonId, c: ResearchConflict): string {
        const person = DataManager.getPerson(personId);
        if (!person) return '';
        const fact = conflictFact(c, person, gedcomTagEventType);
        const origin = fact ? person.researchOrigins?.[fact] : undefined;
        const id = origin?.kind === 'import' ? origin.importId : origin?.was?.importId;
        const record = importRecordOf(DataManager.getData(), id);
        if (!record) return '';
        const { prog, date } = importOriginParts(record);
        return strings.origin.sourceImport(prog, date);
    },

    /**
     * The choices of a conflict of a kind in one row under both sides: keep
     * (the family tree's, or the person's) and "Accept the proposal" (the
     * primary one), then what accepting leaves at the fact. Buttons through
     * the bridge, or links into the research (with its mark) as today.
     */
    originConflictChoicesHtml(c: ResearchConflict, view: ConflictCardView, id: string): string {
        if (view.choices === 'none') return '';
        const k = strings.conflict;
        const o = strings.origin;
        const was = c.kind === 'import' && view.notes ? this.originConflictWas(c) : '';
        const noteId = `prc-note-${id}-kind`;
        const choice = (which: ResearchConflictTake): string => {
            const busy = view.busyTake === which;
            const off = view.disabled || (view.busyTake !== null && !busy);
            const label = which === 'research' ? o.accept : c.kind === 'import' ? o.keepImport : k.keep;
            const cls = `prc-choice prc-kind-choice${which === 'research' ? ' prc-kind-choice--primary' : ''}`;
            const described = was ? ` aria-describedby="${noteId}"` : '';
            if (view.choices === 'buttons') {
                return `<button type="button" class="${cls}" data-decide="${which}" data-focus="choice-${which}"${busy ? ' aria-busy="true" aria-disabled="true"' : ''}${off ? ' disabled' : ''}${described}>${busy
                    ? `<span class="prc-spinner" aria-hidden="true"></span>${esc(k.busy)}` : esc(label)}</button>`;
            }
            return `<button type="button" class="${cls}" data-conflict="${esc(id)}" data-do="decide" data-take="${which}" data-focus="choice-${which}"${off ? ' disabled' : ''}${described}>${researchActionLabel(label, researchLinkMark('conflict', { conflictDo: 'decide' }))}</button>`;
        };
        return `
                <div class="prc-kind-choices">${choice('user')}${choice('research')}</div>${was ? `
                <p class="prc-kind-note" id="${noteId}">${esc(o.acceptNote(was))}</p>` : ''}`;
    },

    /** Today's value of a conflict of a kind, as the "Originally…" row will say it once the proposal is accepted. */
    originConflictWas(c: ResearchConflict): string {
        const sides = conflictSides(c);
        const v = sides?.user ?? c.values.find(x => x.side === 'user');
        return v ? researchValueText(c.fact, v.raw ?? v.value) : '';
    },
});
