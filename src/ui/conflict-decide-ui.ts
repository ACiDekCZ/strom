/**
 * The card of a conflict decidable by a side in "What the research knows":
 * "From the app" and "In the research" side by side, each with its choice and
 * the sentence saying what follows, and the card's states (deciding, decided,
 * sending first, an error, decided elsewhere, by a link, not on this device).
 * The card's state is kept in this page only (no change of the tree, nothing
 * to undo); the decision itself goes through the research's bridge
 * (postDecide) or a link into the research. No shared parts with the
 * hypotheses: a conflict is amber and two sides, a hypothesis a ghost.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, ResearchConflict, ResearchConflictValue, StromData } from '../types.js';
import { formatFlexDate } from '../dates.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import {
    researchConflictRef, ResearchConflictTake, ResearchHeader, parseLiveBridge, readResearchHeader, stabilizeIds, keepTitles, researchHasTitles,
} from '../research-link.js';
import { storedResearchBridge, researchAutoState } from '../research-device.js';
import { diffValues } from '../research-changes.js';
import { canDecideInApp, conflictSides, DecideResult } from '../research-decide.js';
import {
    ConflictCardState, ConflictCardView, ConflictDecidedValues, DecidedFact, DECIDED_CARD_MS, conflictCardView, conflictFactParts, conflictSentChanged,
    isDecidedRow, otherLoadChanges,
} from '../research-conflict-card.js';
import { isDateConflict, researchConflictTitle, researchValueText } from './person-research-ui.js';
import { fetchGedcomText, researchDateLabel } from './research-ui.js';
import { researchSendMode } from './research-sync-ui.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'person-research-modal';

/** Each card's state, by tree and conflict (a couple's conflict is one: both partners show the same). */
const cardStates = new Map<string, ConflictCardState>();
/** What each card in the dialog was last drawn from: drawn again only when that changes. */
const drawn = new WeakMap<Element, string>();

/** The research's version as read from its bridge (for "The research has N more changes"), by research and head. */
interface ResearchVersion { key: string; data: StromData; header: ResearchHeader }
let versionRead: ResearchVersion | null = null;
/** A read on its way (one at a time, by the same key). */
let versionAsk: { key: string; job: Promise<ResearchVersion | null> } | null = null;
/** A key read and found unreadable: not asked again for the note (a decision reads afresh). */
let versionFailed = '';
/** "N more changes" per conflict, with what it was counted from. */
const takeCounts = new Map<string, { key: string; n: number }>();

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stateKey(conflictId: string): string {
    return `${DataManager.getCurrentTreeId() ?? ''}|${conflictId}`;
}

/** A value of a side as people read it (the sex by its machine value when the research said it). */
function sideText(c: ResearchConflict, v: ResearchConflictValue): string {
    return researchValueText(c.fact, v.raw ?? v.value);
}

/** An ISO time's day in the app's date style ('' = none). */
function dayOf(iso: string | undefined): string {
    return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? formatFlexDate(iso.slice(0, 10)) : '';
}

/** "9. 10. 2026, 14:32": the day and the time of a decision. */
function dayAndTime(ts: number): string {
    const d = new Date(ts);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = new Intl.DateTimeFormat(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }).format(d);
    return `${formatFlexDate(iso)}, ${time}`;
}

export const conflictDecideMethods = uiModule({
    /** The card's state in this page (undefined: as the data say). */
    researchConflictCardState(conflictId: string): ConflictCardState | undefined {
        const state = cardStates.get(stateKey(conflictId));
        // Left for later, and a version loaded since (by any way): the data say how it stands now.
        if (state?.kind === 'takenPending' && state.base !== undefined && state.base !== (this.researchSyncLink()?.link.head ?? '')) {
            cardStates.delete(stateKey(conflictId));
            return undefined;
        }
        return state;
    },

    /** Set (null: clear) a card's state and draw its cards in the open dialog again. */
    setResearchConflictCardState(conflictId: string, state: ConflictCardState | null): void {
        if (state) cardStates.set(stateKey(conflictId), state);
        else cardStates.delete(stateKey(conflictId));
        this.refreshResearchConflictCards(conflictId);
    },

    /**
     * The field's value here moved since it was last sent (the copy the
     * research last had, research-changes-ui.ts): sending comes first. Not
     * known yet (the copy still loading): no — the cards are drawn again once
     * it is (refreshResearchSyncUi).
     */
    researchConflictSendFirst(personId: PersonId, c: ResearchConflict): boolean {
        const base = this.researchChangesBase();
        if (!base || base === 'same') return false;
        return conflictSentChanged(c.fact, isDateConflict(c), personId, DataManager.getData(), base.base);
    },

    /** What the card shows, for this conflict at this person now. */
    researchConflictCardView(personId: PersonId, c: ResearchConflict): ConflictCardView {
        const id = researchConflictRef(c.id) ?? '';
        const state = this.researchConflictCardState(id) ?? null;
        const mode = this.researchConflictDecideMode();
        // Only an open card asks whether sending comes first (a decided one stays as decided).
        const sendFirst = (!state || state.kind === 'error') && mode !== 'none' && this.researchConflictSendFirst(personId, c);
        return conflictCardView({
            mode, state, sendFirst,
            links: this.researchLinkAvailable('conflict') && this.personResearchRef(personId) !== null,
            noAgent: this.activeResearchNoAgent(),
        });
    },

    /** The values a decided card shows, as they read now. */
    researchConflictDecidedValues(c: ResearchConflict): ConflictDecidedValues {
        const sides = conflictSides(c);
        const sources = DataManager.getData().sources ?? {};
        const sid = sides?.research.sourceIds?.find(s => sources[s]);
        return {
            user: sides ? sideText(c, sides.user) : '',
            research: sides ? sideText(c, sides.research) : '',
            source: sid ? sources[sid].title : '',
        };
    },

    /** The field's value here now, as people read it ("–" when empty). */
    researchConflictValueNow(personId: PersonId, c: ResearchConflict): string {
        const date = isDateConflict(c);
        const parts = conflictFactParts(c.fact, date, personId, DataManager.getData()) ?? [];
        const fact = c.fact.toUpperCase();
        let text: string;
        if (fact === 'SEX') text = parts[0] ? researchValueText('SEX', parts[0] === 'male' ? 'M' : parts[0] === 'female' ? 'F' : 'U') : '';
        else if (fact === 'NAME') text = parts.filter(Boolean).join(' ');
        else text = parts.map(p => date ? formatFlexDate(p) : p.split('\u0000').filter(Boolean).join(', ')).filter(Boolean).join('; ');
        return text || '–';
    },

    /**
     * The card of a conflict canDecideInApp offers, in its state (DEV §2–3):
     * the head with the state's tag, a notice row when there is one, the two
     * sides (or the decided block), the links into the research under a line.
     */
    researchConflictCardHtml(personId: PersonId, c: ResearchConflict): string {
        const id = researchConflictRef(c.id);
        const sides = conflictSides(c);
        if (!id || !sides) return '';
        const k = strings.conflict;
        const r = strings.research;
        const view = this.researchConflictCardView(personId, c);
        if (view.body === 'none') return '';
        const state = this.researchConflictCardState(id);
        const decidedValues = state && 'values' in state ? state.values : this.researchConflictDecidedValues(c);
        const sources = DataManager.getData().sources ?? {};
        const ctx = this.researchSyncLink();

        const tag = view.tag === 'busy'
            ? `<span class="person-research-open-tag prc-tag prc-tag--busy"><span class="prc-spinner prc-spinner--tag" aria-hidden="true"></span>${esc(k.busyTag)}</span>`
            : view.tag === 'done'
                ? `<span class="person-research-open-tag prc-tag prc-tag--done">${esc(k.decidedTag)}</span>`
                : `<span class="person-research-open-tag">${esc(r.conflictOpen)}</span>`;

        let notice = '';
        if (view.notice) {
            const n = view.notice;
            const text = n.text === 'sendFirst' ? k.sendFirst
                : n.text === 'remote' ? k.remote
                : n.text === 'alreadyDecided' ? k.alreadyDecided(state?.kind === 'elsewhere' && state.resolution ? state.resolution
                    : state?.kind === 'elsewhere' && state.take ? (state.take === 'user' ? decidedValues.user : decidedValues.research) : '')
                : n.text === 'takenPending' ? k.takenPending(decidedValues.research)
                : n.text === 'errBusy' ? k.errBusy
                : n.text === 'errLocked' ? k.errLocked
                : k.errNet;
            const label = n.action === 'send' ? strings.sync.barSend : n.action === 'retry' ? k.retry : n.action === 'load' ? strings.sync.load : '';
            notice = `
                <div class="prc-notice prc-notice--${n.tone}" role="status">
                    <span class="prc-notice-text">${esc(text)}</span>${n.action ? `
                    <button type="button" class="prc-notice-action" data-notice-action="${n.action}" data-focus="notice">${esc(label)}</button>` : ''}
                </div>`;
        }

        const sourceLink = (v: ResearchConflictValue, focus: string): string => {
            const sid = v.sourceIds?.find(s => sources[s]);
            return sid
                ? `<button type="button" class="link-button person-research-source prc-source" data-source="${esc(sid)}" data-focus="${focus}">${esc(sources[sid].title)}</button>`
                : '<span class="person-research-nosource">–</span>';
        };

        let body = '';
        if (view.body === 'sides') {
            const side = (which: ResearchConflictTake): string => {
                const v = sides[which];
                const noteId = `prc-note-${id}-${which}`;
                const busy = view.busyTake === which;
                const off = view.disabled || (view.busyTake !== null && !busy);
                const value = which === 'user' && view.unsent ? this.researchConflictValueNow(personId, c) : sideText(c, v);
                const meta = which === 'research'
                    ? sourceLink(v, 'source')
                    : view.unsent
                        ? `<span class="prc-meta">${esc(k.appUnsent(dayOf(ctx ? TreeManager.getTreeMetadata(ctx.treeId)?.changedAt : undefined) || dayOf(new Date().toISOString())))}</span>
                           <span class="prc-knows">${esc(k.researchKnows(sideText(c, v)))}</span>`
                        : `<span class="prc-meta">${esc(k.appSource(dayOf(ctx?.link.sent?.at)))}</span>`;
                let choice = '';
                if (view.choices === 'buttons') {
                    choice = `<button type="button" class="prc-choice" data-decide="${which}" data-focus="choice-${which}"${busy ? ' aria-busy="true" aria-disabled="true"' : ''}${off ? ' disabled' : ''}${view.notes ? ` aria-describedby="${noteId}"` : ''}>${busy
                        ? `<span class="prc-spinner" aria-hidden="true"></span>${esc(k.busy)}`
                        : esc(which === 'user' ? k.keep : k.take)}</button>`;
                } else if (view.choices === 'links') {
                    choice = `<button type="button" class="prc-choice" data-conflict="${esc(id)}" data-do="decide" data-take="${which}" data-focus="choice-${which}"${off ? ' disabled' : ''}${view.notes ? ` aria-describedby="${noteId}"` : ''}>${esc(which === 'user' ? k.keepLink : k.takeLink)}</button>`;
                }
                const note = view.notes && view.choices !== 'none'
                    ? `<p class="prc-note" id="${noteId}">${esc(which === 'user' ? k.keepNote : this.researchConflictTakeNote(c))}</p>` : '';
                return `
                    <div class="prc-side" data-side="${which}">
                        <span class="prc-side-label">${esc(which === 'user' ? k.sideApp : k.sideResearch)}</span>
                        <span class="prc-side-main"><span class="prc-value">${esc(value)}</span>
                        <span class="prc-side-meta">${meta}</span></span>
                        ${choice}${note}
                    </div>`;
            };
            body = `
                <div class="prc-sides${view.choices === 'none' ? ' prc-sides--plain' : ''}">${side('user')}${side('research')}</div>
                ${view.linkNote ? `<p class="prc-link-note">${esc(k.linkNote)}</p>` : ''}`;
        } else if (view.body === 'decided' && state && state.kind !== 'busy' && state.kind !== 'error' && state.kind !== 'gone') {
            const take: ResearchConflictTake | undefined = state.kind === 'kept' ? 'user' : state.kind === 'taken' ? 'research'
                : state.kind === 'elsewhere' ? state.take : undefined;
            const value = take === 'user' ? decidedValues.user : take === 'research' ? decidedValues.research
                : state.kind === 'elsewhere' ? state.resolution : '';
            const sideWords = take === 'user' ? k.fromApp : take === 'research' ? k.fromResearch(decidedValues.source) : '';
            const loaded = (state.kind === 'taken' || state.kind === 'elsewhere') ? state.loaded : undefined;
            const line = state.kind === 'kept' ? k.keptLine(dayAndTime(state.at), decidedValues.research)
                : loaded ? k.takenLine(loaded.from) : '';
            body = value ? `
                <div class="prc-decided">
                    <div class="prc-decided-row">
                        <span class="prc-valid">${esc(k.valid)}</span>
                        <span class="prc-value">${esc(value)}</span>
                        ${sideWords ? `<span class="prc-decided-side">${esc(sideWords)}</span>` : ''}
                    </div>
                    ${line ? `<p class="prc-decided-line">${esc(line)}</p>` : ''}
                </div>` : '';
        }

        const toAgent = view.agent;
        const links = view.researchLinks ? `
            <div class="person-research-conflict-actions prc-links">
                <button type="button" class="link-button" data-conflict="${esc(id)}" data-do="decide" data-focus="link-decide">${esc(r.decide)}</button>${toAgent ? `
                <button type="button" class="link-button person-research-agent" data-conflict="${esc(id)}" data-do="agent" data-focus="link-agent"
                    aria-label="${esc(`${r.leaveToAgent}, ${r.aiBadge}, ${r.opensInResearchSr}`)}">${esc(r.leaveToAgent)}
                    <span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span> ↗</button>` : ''}
            </div>` : '';

        return `
            <div class="person-research-conflict prc" data-conflict-card="${esc(id)}" data-state="${view.row}" tabindex="-1">
                <div class="person-research-conflict-head">
                    <span class="person-research-fact">${esc(researchConflictTitle(c))}</span>
                    ${tag}
                </div>
                ${notice}${body}${links}
            </div>`;
    },

    /**
     * Draw the cards of a conflict (all, without an id) in the open dialog
     * again from their state and the data now; the keyboard stays on the same
     * control, else on the card.
     */
    refreshResearchConflictCards(conflictId?: string): void {
        // The panel by the edit form's field shows the same state.
        this.refreshResearchConflictPanel();
        const dialog = document.getElementById(DIALOG_ID);
        if (!dialog) return;
        const personId = dialog.dataset.person as PersonId | undefined;
        if (!personId) return;
        const sel = conflictId ? `[data-conflict-card="${CSS.escape(conflictId)}"]` : '[data-conflict-card]';
        dialog.querySelectorAll<HTMLElement>(sel).forEach(card => {
            const id = card.dataset.conflictCard!;
            const c = this.researchConflictsShown(personId).find(x => researchConflictRef(x.id) === id);
            const focused = card.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
            const focusKey = focused?.dataset.focus ?? '';
            const html = c && (canDecideInApp(c, DataManager.getPerson(personId)) || this.researchConflictCardState(id))
                ? this.researchConflictCardHtml(personId, c).trim()
                // Folded: today's decided row, as the data say it now.
                : c?.status === 'decided' ? this.researchConflictDecidedRowHtml(c).trim() : '';
            if (html && drawn.get(card) === html) return;
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const next = tmp.firstElementChild as HTMLElement | null;
            if (next && card.classList.contains('prc--highlight')) next.classList.add('prc--highlight');
            // The same card as drawn with the dialog: kept (a reader's place, the keyboard and the
            // layout stay; a redraw for nothing would only swap the node under them).
            if (next?.isEqualNode(card)) {
                drawn.set(card, html);
                return;
            }
            if (next) {
                drawn.set(next, html);
                card.replaceWith(next);
            } else {
                card.remove();
            }
            if (!focused) return;
            const target = next && focusKey ? next.querySelector<HTMLElement>(`[data-focus="${focusKey}"]:not(:disabled)`) : null;
            (target ?? next ?? dialog.querySelector<HTMLElement>('#person-research-close'))?.focus({ preventScroll: true });
        });
    },

    /**
     * Decide a conflict by a side through the research's bridge: the card
     * deciding (a second ask meanwhile does nothing), then the answer.
     */
    async decideResearchConflict(personId: PersonId, conflictId: string, take: ResearchConflictTake): Promise<void> {
        if (this.researchConflictCardState(conflictId)?.kind === 'busy') return;
        const c = this.researchConflictsShown(personId).find(x => researchConflictRef(x.id) === conflictId);
        if (!c) return;
        const values = this.researchConflictDecidedValues(c);
        const treeId = DataManager.getCurrentTreeId();
        this.setResearchConflictCardState(conflictId, { kind: 'busy', take });
        const result = await this.postDecide('conflict', conflictId, { do: 'decide', take });
        // Another tree opened meanwhile: its cards are not this one's; this one's card is open again.
        if (DataManager.getCurrentTreeId() !== treeId) {
            cardStates.delete(`${treeId ?? ''}|${conflictId}`);
            return;
        }
        await this.researchConflictDecideAnswered(personId, c, take, values, result);
    },

    /**
     * The bridge answered a decision: the card's state from its answer; a
     * conflict decided (here, elsewhere, or gone there) stops counting at
     * once (researchConflictSettle) — before any version loads, so the
     * loaded one's decided conflict shows as such — then what follows
     * (researchConflictAfterAnswer).
     */
    async researchConflictDecideAnswered(personId: PersonId, c: ResearchConflict, take: ResearchConflictTake,
        values: ConflictDecidedValues, result: DecideResult): Promise<void> {
        const id = researchConflictRef(c.id) ?? '';
        let state: ConflictCardState;
        if (result.ok) {
            const decided = result.take ?? take;
            state = decided === 'user' ? { kind: 'kept', at: Date.now(), values } : { kind: 'taken', at: Date.now(), values };
        } else if (result.code === 'conflict.decided') {
            state = { kind: 'elsewhere', resolution: result.resolution ?? '', ...(result.take ? { take: result.take } : {}), values };
        } else if (result.code === 'conflict.none') {
            state = { kind: 'gone' };
        } else {
            state = { kind: 'error', take, error: result.code === 'busy' ? 'busy' : result.code === 'locked' ? 'locked' : 'network' };
        }
        this.setResearchConflictCardState(id, state);
        const treeId = DataManager.getCurrentTreeId();
        if (treeId && (result.ok || result.code === 'conflict.decided' || result.code === 'conflict.none')) {
            await this.researchConflictSettle(treeId, id);
        }
        await this.researchConflictAfterAnswer(personId, c, take, result);
    },

    /**
     * Decided for the research's value (here or elsewhere): the value comes
     * only by loading the research's version — quietly when it changes
     * nothing here but the decided values (a backup first), else through the
     * Load dialog with what was decided first. Loaded: the card says the
     * value it had here (`loaded`); "Later", or the version not readable:
     * `takenPending`, its "Load" asks again. Resolves how it went.
     */
    async researchConflictTaken(personId: PersonId, c: ResearchConflict, values: ConflictDecidedValues): Promise<'quiet' | 'asked' | 'later'> {
        const id = researchConflictRef(c.id) ?? '';
        const ctx = this.researchSyncLink();
        if (!ctx) return 'later';
        const { treeId, link } = ctx;
        const from = this.researchConflictValueNow(personId, c);
        const later = (): 'later' => {
            if (DataManager.getCurrentTreeId() === treeId) {
                this.setResearchConflictCardState(id, { kind: 'takenPending', values, base: TreeManager.getTreeMetadata(treeId)?.research?.head ?? '' });
            }
            return 'later';
        };
        const version = await this.researchVersionRead(true);
        if (!version || DataManager.getCurrentTreeId() !== treeId) return later();
        const here = DataManager.getData();
        const there = this.researchVersionAsLoaded(version.data);
        const decided = this.researchConflictsTakenFacts(id, c);
        const quiet = otherLoadChanges(diffValues(here, there), decided) === 0;
        if (!quiet) {
            const st = researchAutoState(treeId);
            const nw = st.notWritten && link.sent?.state === 'written' && st.notWritten.fingerprint === link.sent.fingerprint
                ? st.notWritten.items.length + st.notWritten.unexplained : 0;
            const answer = await this.askResearchLoad(TreeManager.getTreeMetadata(treeId)?.name ?? '', researchDateLabel(version.header.date), here, there, {
                off: researchSendMode(link) === 'off', notWritten: nw,
                decided: { intro: strings.conflict.loadIntro(values.research), later: strings.conflict.loadLater(from), rows: r => isDecidedRow(r, decided) },
            });
            if (!answer || DataManager.getCurrentTreeId() !== treeId) return later();
        }
        if (!await this.ensureLocalUnlocked()) return later();
        // Loading now: no longer left for later (the load's own redraw keeps the card).
        if (this.researchConflictCardState(id)?.kind === 'takenPending') cardStates.set(stateKey(id), { kind: 'taken', at: Date.now(), values });
        const done = await this.applyResearch(version.data, version.header, { force: true, quiet, ...(version.header.head ? { head: version.header.head } : {}) });
        if (done !== treeId) return later();
        const state = this.researchConflictCardState(id);
        if (state?.kind === 'taken' || state?.kind === 'elsewhere') this.setResearchConflictCardState(id, { ...state, loaded: { from } });
        else this.setResearchConflictCardState(id, { kind: 'taken', at: Date.now(), values, loaded: { from } });
        // An edit form open meanwhile shows the value loaded.
        this.syncPersonFormWithData();
        return quiet ? 'quiet' : 'asked';
    },

    /**
     * Decided for the app's value: the research wrote it and moved on. The
     * tree as it was sent (or as loaded) and the new version overwriting
     * nothing here: that version is taken quietly, as after a written send
     * (a backup first). Else nothing loads — it waits as any newer version.
     */
    async researchConflictKeptLoad(head: string): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || !head || head === (ctx.link.head ?? '')) return;
        const { treeId, link } = ctx;
        const fps = this.researchSyncFingerprints(treeId, link);
        if (!fps.matchesBase && fps.current !== link.sent?.fingerprint) return;
        const version = await this.researchVersionRead(true);
        if (!version || DataManager.getCurrentTreeId() !== treeId) return;
        if (diffValues(DataManager.getData(), this.researchVersionAsLoaded(version.data)).rows.length > 0) return;
        if (!await this.ensureLocalUnlocked()) return;
        await this.applyResearch(version.data, version.header, { force: true, quiet: true, head: version.header.head || head });
    },

    /**
     * After every answer of the bridge (the card's state set, the conflict
     * settled): the research's version where the decision brings it, the
     * notice (DEV §7: decided, already decided — with the value that holds —,
     * or, when the card is not in sight, that it could not be decided with
     * "Show"), and the decided card folding into the decided row later.
     */
    async researchConflictAfterAnswer(personId: PersonId, c: ResearchConflict, _take: ResearchConflictTake, result: DecideResult): Promise<void> {
        const id = researchConflictRef(c.id) ?? '';
        const k = strings.conflict;
        const state = this.researchConflictCardState(id);
        const values = state && 'values' in state ? state.values : this.researchConflictDecidedValues(c);
        if (state?.kind === 'kept') {
            await this.researchConflictKeptLoad(result.ok ? result.head : '');
            this.showToast(k.decidedToast(values.user), 6000);
        } else if (state?.kind === 'taken') {
            if (await this.researchConflictTaken(personId, c, values) === 'quiet') this.showToast(k.decidedToast(values.research), 6000);
        } else if (state?.kind === 'elsewhere') {
            const said = state.resolution || (state.take === 'user' ? values.user : state.take === 'research' ? values.research : '');
            this.showToast(k.alreadyDecided(said), 6000);
            if (state.take === 'research') await this.researchConflictTaken(personId, c, values);
        } else if (state?.kind === 'error' && !this.researchConflictCardInSight(id)) {
            this.showToast(k.errToast, 6000, { action: { label: k.show, run: () => this.showPersonResearchDialog(personId, { conflict: id }) } });
        }
        this.researchConflictFoldLater(id);
    },

    /** The card of a conflict is in the open dialog, or its panel by the edit form's field is open. */
    researchConflictCardInSight(conflictId: string): boolean {
        return this.isResearchConflictPanelOpen(conflictId)
            || !!document.getElementById(DIALOG_ID)?.querySelector(`[data-conflict-card="${CSS.escape(conflictId)}"]`);
    },

    /** A decided card whose value is here (or never comes by a load) folds into the decided row after a while. */
    researchConflictFoldLater(conflictId: string): void {
        const state = this.researchConflictCardState(conflictId);
        if (!state || !this.researchConflictCardFolds(state)) return;
        const key = stateKey(conflictId);
        setTimeout(() => {
            if (cardStates.get(key) !== state) return;
            cardStates.delete(key);
            this.refreshResearchConflictCards(conflictId);
        }, DECIDED_CARD_MS);
    },

    /** A decided card done (nothing more to load for it): it folds, and the dialog closing ends it. */
    researchConflictCardFolds(state: ConflictCardState): boolean {
        return state.kind === 'kept' || (state.kind === 'taken' && !!state.loaded)
            || (state.kind === 'elsewhere' && (state.take !== 'research' || !!state.loaded));
    },

    /** The dialog closed: the decided cards of this tree are done (opened again, the data say it). */
    researchConflictCardsClosed(): void {
        const prefix = `${DataManager.getCurrentTreeId() ?? ''}|`;
        for (const [key, state] of [...cardStates]) {
            if (key.startsWith(prefix) && this.researchConflictCardFolds(state)) cardStates.delete(key);
        }
    },

    /**
     * The conflicts whose values a load brings as decided: this one and those
     * decided for the research's value in this page and not loaded yet — at
     * the people they are shown at (a couple's conflict at both partners).
     */
    researchConflictsTakenFacts(conflictId: string, c: ResearchConflict): DecidedFact[] {
        const persons = Object.keys(DataManager.getData().persons) as PersonId[];
        const treeId = DataManager.getCurrentTreeId();
        const held = treeId ? this.researchHeld(treeId) : null;
        const found = new Map<string, { conflict: ResearchConflict; persons: string[] }>();
        for (const pid of persons) {
            const own = DataManager.getPerson(pid)?.research?.conflicts ?? [];
            for (const x of [...own, ...(held?.persons[pid] ?? [])]) {
                const ref = researchConflictRef(x.id);
                if (!ref) continue;
                const st = ref === conflictId ? null : this.researchConflictCardState(ref);
                if (ref !== conflictId && st?.kind !== 'takenPending' && !(st?.kind === 'taken' && !st.loaded)) continue;
                const entry = found.get(ref) ?? { conflict: ref === conflictId ? c : x, persons: [] };
                if (!entry.persons.includes(pid)) entry.persons.push(pid);
                found.set(ref, entry);
            }
        }
        if (!found.has(conflictId)) found.set(conflictId, { conflict: c, persons: [] });
        return [...found.values()].map(e => ({ persons: e.persons, fact: e.conflict.fact, date: isDateConflict(e.conflict) }));
    },

    /**
     * The sentence under "Take the research's value": what loading its
     * version brings besides this value, when read (the version read once
     * per head, quietly — the cards follow); not known: the plain sentence.
     */
    researchConflictTakeNote(c: ResearchConflict): string {
        const k = strings.conflict;
        const ctx = this.researchSyncLink();
        if (!ctx || this.researchConflictDecideMode() !== 'bridge') return k.takeNote;
        const key = this.researchVersionKey();
        if (versionRead?.key !== key) {
            if (key !== versionFailed && versionAsk?.key !== key) {
                void this.researchVersionRead(false).then(v => { if (v) this.refreshResearchConflictCards(); });
            }
            return k.takeNote;
        }
        const id = researchConflictRef(c.id) ?? '';
        const facts = this.researchConflictsTakenFacts(id, c);
        // Counted once per version, state of the tree and decided facts (the cards are drawn often).
        const memoKey = `${versionRead.key}|${this.researchSyncFingerprints(ctx.treeId, ctx.link).current}|${JSON.stringify(facts)}`;
        let n = takeCounts.get(id)?.key === memoKey ? takeCounts.get(id)!.n : -1;
        if (n < 0) {
            n = otherLoadChanges(diffValues(DataManager.getData(), this.researchVersionAsLoaded(versionRead.data)), facts);
            takeCounts.set(id, { key: memoKey, n });
        }
        return n > 0 ? k.takeNoteMore(n) : k.takeNote;
    },

    /** The active research and the head its bridge says it has ('' = not said). */
    researchVersionKey(): string {
        const ctx = this.researchSyncLink();
        if (!ctx) return '';
        return `${ctx.link.id}|${this.researchStatusOf(ctx.link.id)?.head || storedResearchBridge(ctx.link.id)?.head || ''}`;
    },

    /**
     * The research's version from its bridge (tree.ged), not loaded; `fresh`:
     * asked now (after a decision), else the one read for this head. Null:
     * no bridge, no answer, or not this tree's research.
     */
    async researchVersionRead(fresh: boolean): Promise<ResearchVersion | null> {
        const ctx = this.researchSyncLink();
        const bridge = ctx ? parseLiveBridge(storedResearchBridge(ctx.link.id)?.base) : null;
        if (!ctx || !bridge) return null;
        const key = this.researchVersionKey();
        if (!fresh && versionRead?.key === key) return versionRead;
        if (!fresh && versionAsk?.key === key) return versionAsk.job;
        const researchId = ctx.link.id;
        const job = (async (): Promise<ResearchVersion | null> => {
            try {
                const text = await fetchGedcomText(bridge.ged);
                const header = readResearchHeader(text);
                if (!header.isStromResearch || header.treeId !== researchId) return null;
                return { key: header.head ? `${researchId}|${header.head}` : key, data: convertToStrom(parseGedcom(text)).data, header };
            } catch {
                return null;
            }
        })();
        versionAsk = { key, job };
        const got = await job;
        if (versionAsk?.job === job) versionAsk = null;
        if (got) versionRead = got;
        else if (!fresh) versionFailed = key;
        return got;
    },

    /** The research's version as a load puts it over this tree: titles it never got kept, this tree's ids. */
    researchVersionAsLoaded(data: StromData): StromData {
        const link = this.researchSyncLink()?.link;
        const here = DataManager.getData();
        const features = link ? this.researchStatusOf(link.id)?.features : null;
        return stabilizeIds(keepTitles(data, here, features, researchHasTitles(link, features)), here);
    },

    /** A card's notice action: try the same side again, send the tree, load the research's version. */
    researchConflictNoticeAction(personId: PersonId, conflictId: string, action: string): void {
        const state = this.researchConflictCardState(conflictId);
        if (action === 'retry' && state?.kind === 'error') {
            void this.decideResearchConflict(personId, conflictId, state.take);
        } else if (action === 'send') {
            // Today's send; the cards follow when the research has it (refreshResearchSyncUi).
            void this.researchSendNow().then(() => this.refreshResearchConflictCards(conflictId));
        } else if (action === 'load') {
            const c = this.researchConflictsShown(personId).find(x => researchConflictRef(x.id) === conflictId);
            if (state?.kind !== 'takenPending' || !c) {
                void this.researchLoadNewer();
                return;
            }
            // Left for later: the same load as right after the decision (quietly, or the Load dialog).
            void this.researchConflictTaken(personId, c, state.values).then(how => {
                if (how === 'quiet') this.showToast(strings.conflict.decidedToast(state.values.research), 6000);
                this.researchConflictFoldLater(conflictId);
            });
        }
    },
});
