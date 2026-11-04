/**
 * The research's questions about places in "Awaiting action" (spec 034 §9):
 * one window for the group "Places", one card per question — where a place
 * is (candidates A–C beside a small map), a location against the research's
 * suggestion, or a change of how the facts write it — answered with one
 * click through the research's bridge (`places.answer`), with Undo in the
 * toast (`places.undo`). The group's head takes them in bulk (every
 * suggestion, keep every conflict, or the suggestions of one area) after a
 * preview of what changes; one Undo takes the whole step back.
 *
 * Without `places.answer` nothing changes: the items stay in "Awaiting
 * action" as before (answered through the task link on the computer). The
 * Places dialog, the map and the person card open the window at a place's
 * card. Bridge text is set as text, never HTML.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { isPhoneBar } from '../breakpoints.js';
import type { LiveWaiting, WaitingPlaceCandidate } from '../research-link.js';
import {
    postPlacesAnswer, postPlacesUndo, PLACES_ANSWER_FEATURE, PLACES_UNDO_FEATURE,
    type PlaceAnswerTake, type PlacesWriteRefusal,
} from '../places-bridge.js';
import { waitingDaysAgo, waitingPhase } from '../research-waiting.js';
import {
    isPlaceQuestion, placeQuestionChoices, placesUnknownEverywhere, pickableCandidates, candidateLetter, placeQuestionKeys, placeQuestionFacts,
    placeQuestionsPersons, conflictOrigin, bulkAcceptable, bulkKeepable, bulkHandConflicts, placeAreas,
    waitingMapPoints, waitingMapView, spreadPins,
    type PlaceQuestion, type PlaceChoiceButton,
} from '../waiting-places.js';
import { checkCandidate } from '../place-check.js';
import { checkFindingText } from '../places-dialog.js';
import { findTreePoints } from '../place-find.js';
import { formatPlaceDate } from '../place-identity.js';
import { collectPlaces } from '../places.js';
import { pointInViewport } from '../map.js';
import { distanceKm } from '../person-page-map.js';
import { sameCoords } from '../place-records.js';
import { drawTiles, dotsHtml, mapSize, type SmallMapView } from './places-find-ui.js';
import { fetchStatus, liveSession } from './research-ui.js';
import { normalizeModal } from './modal-skeleton.js';
import { uiModule } from './module.js';

const MODAL_ID = 'waiting-places-modal';
/** How long the toasts with Undo stand. */
const TOAST_MS = 8000;
/** An answered question stays hidden this long while the research's status still lists it. */
const ANSWERED_HIDE_MS = 30_000;
/** The small map beside the candidates (CSS px; on a phone it takes the card's width). */
const MAP_W = 300;
const MAP_H = 260;
/** How long the research's status is waited for after an answer (not followed live). */
const STATUS_TIMEOUT_MS = 4000;
/** "Keep all" names the places up to this many. */
const KEEP_NAMES = 3;

interface Preview {
    kind: 'accept' | 'keep';
    /** The area chosen ("By area"), when the step is for one. */
    area?: string;
    places: string[];
    /** The research's answer to `dry` (accept): null while it is asked, 'local' when it did not answer. */
    dry: { places: number; facts: number } | null | 'local';
}

const view = {
    /** The highlighted candidate of each question (row and map point). */
    selected: new Map<string, string>(),
    preview: null as Preview | null,
    /** Questions answered here and when they stop being hidden. */
    answered: new Map<string, number>(),
    /** A write runs (one at a time). */
    busy: false,
    /** Questions whose map is shown (a phone held sideways). */
    mapOpen: new Set<string>(),
    /** The question the window was opened at (its card stays marked through redraws). */
    focus: '',
};

export interface WaitingPlacesAccess {
    /** The bridge takes answers here. */
    canAnswer: boolean;
    canUndo: boolean;
    base: string | null;
    features: readonly string[];
    /** The research takes Don't know for a conflict and a form too. */
    unknownAll: boolean;
}

function geos(): Record<string, import('../types.js').PlaceGeo> | undefined {
    return DataManager.getData().places;
}

/** The years of a question's facts ("1820–1871", one year alone, '' none). */
function yearsText(from?: number, to?: number): string {
    if (from === undefined || to === undefined) return '';
    return from === to ? String(from) : `${from}–${to}`;
}

/** A candidate as one line: its name, with its district in brackets. */
function candidateLabel(c: WaitingPlaceCandidate): string {
    return c.district ? `${c.name} (${c.district})` : c.name;
}

export const waitingPlacesMethods = uiModule({
    /** Whether the research's bridge here takes answers to its place questions. */
    waitingPlacesAccess(): WaitingPlacesAccess {
        const ctx = this.placesResearchContext();
        const canAnswer = !!ctx.researchId && !!ctx.base && ctx.features.includes(PLACES_ANSWER_FEATURE);
        const version = ctx.researchId ? this.researchStatusOf(ctx.researchId)?.version : undefined;
        return {
            canAnswer, canUndo: canAnswer && ctx.features.includes(PLACES_UNDO_FEATURE), base: ctx.base, features: ctx.features,
            unknownAll: placesUnknownEverywhere(version),
        };
    },

    /** The place questions to do, in the research's order, without those just answered here. */
    waitingPlaceQuestions(): PlaceQuestion[] {
        const now = Date.now();
        for (const [id, until] of view.answered) if (until <= now) view.answered.delete(id);
        const items: readonly LiveWaiting[] = this.researchWaiting()?.items ?? [];
        return items.filter(isPlaceQuestion).filter(w => waitingPhase(w) === 'todo' && !view.answered.has(w.place));
    },

    /** The window goes: the bridge answers, or a phone shows what waits (answered on the computer). */
    waitingPlacesShown(): boolean {
        return this.waitingPlacesAccess().canAnswer || (isPhoneBar() && this.waitingPlaceQuestions().length > 0);
    },

    /**
     * "Answer in Waiting" from the Places dialog, the map or the person card:
     * the window at that place's card; without the bridge's answers,
     * "Awaiting action" as before.
     */
    openWaitingPlaces(place?: string): void {
        if (this.waitingPlacesShown()) this.showWaitingPlaces(place);
        else this.showResearchWaiting();
    },

    /** The window of the group "Places", scrolled to one question's card when given. */
    showWaitingPlaces(focus?: string): void {
        const W = strings.places.waiting;
        const existing = document.getElementById(MODAL_ID);
        if (!existing) {
            view.preview = null;
            view.mapOpen = new Set();
        }
        view.focus = focus ?? '';
        existing?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== MODAL_ID);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = MODAL_ID;
        overlay.innerHTML = `
            <div class="modal waiting-places-modal modal--lg" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="waiting-places-title">
                <div class="modal-header">
                    <h2 id="waiting-places-title">${this.escapeHtml(W.title)}</h2>
                    <button type="button" class="close-btn" id="waiting-places-x" aria-label="${this.escapeHtml(strings.buttons.close)}">&times;</button>
                </div>
                <div class="waiting-places-body"></div>
                <div class="buttons">
                    <button type="button" class="secondary" id="waiting-places-close" data-dismiss>${this.escapeHtml(strings.buttons.close)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const modal = overlay.querySelector('.modal') as HTMLElement;
        normalizeModal(modal);
        overlay.onclick = (e) => { if (e.target === overlay) this.closeWaitingPlaces(); };
        (overlay.querySelector('#waiting-places-x') as HTMLButtonElement).onclick = () => this.closeWaitingPlaces();
        (overlay.querySelector('#waiting-places-close') as HTMLButtonElement).onclick = () => this.closeWaitingPlaces();
        this.dialogStack.push(MODAL_ID);
        this.renderWaitingPlaces();
        const card = focus ? overlay.querySelector<HTMLElement>(`.waiting-place[data-place="${CSS.escape(focus)}"]`) : null;
        if (card) {
            card.scrollIntoView({ block: 'start' });
            card.querySelector<HTMLElement>('button:not([disabled])')?.focus();
        } else {
            // A phone held sideways hides the footer: the header's × takes the focus.
            const close = overlay.querySelector('#waiting-places-close') as HTMLButtonElement;
            (close.offsetParent ? close : overlay.querySelector('#waiting-places-x') as HTMLButtonElement).focus();
        }
        // What the research says now (an older list may be shown first).
        void this.refreshWaitingPlacesStatus();
    },

    closeWaitingPlaces(): void {
        document.getElementById(MODAL_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== MODAL_ID);
        view.preview = null;
        view.focus = '';
    },

    /** Escape: a bulk preview closes first, then the window. */
    waitingPlacesEscape(): void {
        if (view.preview) {
            view.preview = null;
            this.renderWaitingPlaces();
            return;
        }
        this.closeWaitingPlaces();
    },

    isWaitingPlacesOpen(): boolean {
        return !!document.getElementById(MODAL_ID);
    },

    /** Draw the window's group head and cards again (a write, a new status). */
    renderWaitingPlaces(): void {
        const overlay = document.getElementById(MODAL_ID);
        const body = overlay?.querySelector<HTMLElement>('.waiting-places-body');
        if (!overlay || !body) return;
        const W = strings.places.waiting;
        const access = this.waitingPlacesAccess();
        const items = this.waitingPlaceQuestions();
        // A preview whose questions went (answered elsewhere) closes.
        if (view.preview && !view.preview.places.some(p => items.some(w => w.place === p))) view.preview = null;
        const scroller = overlay.querySelector<HTMLElement>('.modal-content');
        const scroll = scroller?.scrollTop ?? 0;
        const focusPlace = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.waiting-place')?.dataset.place;
        const focusAction = (document.activeElement as HTMLElement | null)?.dataset.waitAct;
        body.replaceChildren();
        body.classList.toggle('is-busy', view.busy);
        if (items.length === 0) {
            body.appendChild(Object.assign(document.createElement('p'), { className: 'waiting-places-empty', textContent: W.empty }));
            return;
        }
        body.appendChild(this.waitingPlacesHead(items, access));
        const list = document.createElement('div');
        list.className = 'waiting-places-list';
        for (const w of items) list.appendChild(this.waitingPlaceCard(w, access));
        body.appendChild(list);
        if (scroller) scroller.scrollTop = scroll;
        if (focusPlace) {
            const card = body.querySelector<HTMLElement>(`.waiting-place[data-place="${CSS.escape(focusPlace)}"]`);
            (card?.querySelector<HTMLElement>(focusAction ? `[data-wait-act="${CSS.escape(focusAction)}"]` : 'button') ?? card?.querySelector<HTMLElement>('button'))?.focus();
        }
        requestAnimationFrame(() => this.drawWaitingPlaceMaps());
    },

    /** The group's head: its name and count, the bulk steps, "By area" and the open preview. */
    waitingPlacesHead(items: readonly PlaceQuestion[], access: WaitingPlacesAccess): HTMLElement {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const head = document.createElement('section');
        head.className = 'waiting-places-head';
        const accept = bulkAcceptable(items, geos());
        const keep = bulkKeepable(items);
        const areas = placeAreas(accept);
        const p = view.preview;
        head.innerHTML = `
            <div class="waiting-places-title"><span class="waiting-places-name">${esc(W.group)}</span>
                <span class="waiting-places-count">${esc(W.questions(items.length))}</span></div>
            ${access.canAnswer && (accept.length > 0 || keep.length > 0) ? `<div class="waiting-places-bulk">
                ${accept.length > 0 ? `<button type="button" class="secondary waiting-places-accept${p?.kind === 'accept' && !p.area ? ' is-on' : ''}" data-wait-act="accept-all">${esc(W.acceptAll(accept.length))}</button>` : ''}
                ${keep.length > 0 ? `<button type="button" class="secondary waiting-places-keep${p?.kind === 'keep' ? ' is-on' : ''}" data-wait-act="keep-all">${esc(W.keepAll(keep.length))}</button>` : ''}
            </div>` : ''}
            ${access.canAnswer && areas.length > 0 ? `<div class="waiting-places-areas" role="group" aria-label="${esc(W.byArea)}">
                <span class="waiting-places-areas-label">${esc(W.byArea)}</span>
                ${areas.map((a, i) => `<button type="button" class="waiting-places-area${p?.area === a.name ? ' is-on' : ''}" data-area="${i}" data-wait-act="area-${i}" aria-pressed="${p?.area === a.name}">${esc(W.area(a.name, a.places.length))}</button>`).join('')}
            </div>` : ''}
            ${p ? this.waitingPlacesPreviewHtml(p, items, access) : ''}`;
        head.querySelector<HTMLButtonElement>('.waiting-places-accept')?.addEventListener('click', () =>
            this.openWaitingPlacesPreview({ kind: 'accept', places: accept.map(w => w.place), dry: null }));
        head.querySelector<HTMLButtonElement>('.waiting-places-keep')?.addEventListener('click', () =>
            this.openWaitingPlacesPreview({ kind: 'keep', places: keep.map(w => w.place), dry: null }));
        head.querySelectorAll<HTMLButtonElement>('.waiting-places-area').forEach(btn => {
            const a = areas[Number(btn.dataset.area)]!;
            btn.onclick = () => this.openWaitingPlacesPreview({ kind: 'accept', area: a.name, places: a.places, dry: null });
        });
        head.querySelector<HTMLButtonElement>('.waiting-places-go')?.addEventListener('click', () => void this.runWaitingPlacesBulk());
        head.querySelector<HTMLButtonElement>('.waiting-places-cancel')?.addEventListener('click', () => {
            view.preview = null;
            this.renderWaitingPlaces();
        });
        return head;
    },

    /** The ochre preview of a bulk step: what it does, what stays, one Undo; Accept N / Cancel. */
    waitingPlacesPreviewHtml(p: Preview, items: readonly PlaceQuestion[], access: WaitingPlacesAccess): string {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const chosen = items.filter(w => p.places.includes(w.place));
        const n = chosen.length;
        const data = DataManager.getData();
        let title: string;
        const lines: string[] = [];
        if (p.kind === 'accept') {
            title = p.area ? W.pvArea(p.area, n) : W.pvAccept(n);
            lines.push(W.pvFirst);
            if (p.dry === null) {
                lines.push(W.pvAsking);
            } else {
                const facts = p.dry === 'local' ? placeQuestionFacts(data, chosen.flatMap(w => w.forms ?? [])).facts : p.dry.facts;
                const places = p.dry === 'local' ? n : p.dry.places;
                lines.push(W.pvWill(places, facts, placeQuestionsPersons(data, chosen)));
            }
            const hand = bulkHandConflicts(items, geos()).length;
            if (hand > 0 && !p.area) lines.push(W.pvHand(hand));
        } else {
            title = W.pvKeep(n);
            const names = chosen.map(w => w.current?.label || w.forms?.[0] || w.place);
            lines.push(n <= KEEP_NAMES
                ? W.pvKeepNames(this.joinWaitingNames(names), n)
                : W.pvKeepMany(n));
            lines.push(W.pvKeepNone);
        }
        if (access.canUndo) lines.push(W.oneUndo);
        const go = p.kind === 'accept' ? W.pvGo(n) : W.pvKeepGo(n);
        return `<div class="waiting-places-preview" role="region" aria-label="${esc(title)}">
            <strong class="waiting-places-preview-title">${esc(title)}</strong>
            <ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
            <div class="waiting-places-preview-buttons">
                <button type="button" class="primary waiting-places-go" data-wait-act="bulk-go"${view.busy || (p.kind === 'accept' && p.dry === null) ? ' disabled' : ''}>${esc(go)}</button>
                <button type="button" class="secondary waiting-places-cancel" data-wait-act="bulk-cancel">${esc(W.cancel)}</button>
            </div>
        </div>`;
    },

    /** Names joined as a sentence says them ("A, B and C"). */
    joinWaitingNames(names: readonly string[]): string {
        const lang = getCurrentLanguage();
        const and = lang === 'cs' ? 'a' : lang === 'de' ? 'und' : lang === 'pl' ? 'i' : 'and';
        return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
    },

    /** Open a bulk step's preview; accepting asks the research first what it would change (`dry`). */
    async openWaitingPlacesPreview(p: Preview): Promise<void> {
        view.preview = p;
        this.renderWaitingPlaces();
        if (p.kind !== 'accept') return;
        const access = this.waitingPlacesAccess();
        if (!access.canAnswer || !access.base) return;
        const res = await postPlacesAnswer(access.base, { places: p.places, take: 'first', dry: true }, access.features);
        if (view.preview !== p) return;
        if (res.ok && res.kind === 'dry') {
            p.dry = { places: res.places, facts: res.facts };
        } else {
            p.dry = 'local';
            if (!res.ok && res.code === 'changed') {
                view.preview = null;
                this.showWaitingPlacesRefusal(res);
            }
        }
        this.renderWaitingPlaces();
    },

    /** One question's card: its head, the candidates beside the map (or the form's change) and its choices. */
    waitingPlaceCard(w: PlaceQuestion, access: WaitingPlacesAccess): HTMLElement {
        const W = strings.places.waiting;
        const lang = getCurrentLanguage();
        const esc = (s: string): string => this.escapeHtml(s);
        const data = DataManager.getData();
        const facts = placeQuestionFacts(data, w.forms ?? []);
        const card = document.createElement('article');
        card.className = w.place === view.focus ? 'waiting-place is-focus' : 'waiting-place';
        card.dataset.place = w.place;
        card.dataset.question = w.question;
        const ts = Date.parse(w.at);
        const age = Number.isFinite(ts) ? waitingDaysAgo(ts, Date.now(), lang) : '';
        const sub = [
            facts.persons.length > 0 ? W.sub(facts.persons.length, yearsText(facts.from, facts.to)) : (w.on && w.on !== 'user' ? w.on : ''),
            (w.forms ?? []).slice(0, 4).join(', '),
        ].filter(Boolean).join(' · ');
        const titleId = `waiting-place-${w.place}`;
        card.setAttribute('aria-labelledby', titleId);
        const choices = access.canAnswer ? placeQuestionChoices(w, { unknownAll: access.unknownAll }) : [];
        const sel = view.selected.get(w.place) ?? (w.question === 'conflict' ? 'c1' : '');
        card.innerHTML = `
            <header class="waiting-place-head">
                <div class="waiting-place-meta">
                    <span class="waiting-place-kind">${esc(W.kind[w.question])}</span>
                    <span class="waiting-place-age">${esc(W.decide(age))}</span>
                </div>
                <h3 class="waiting-place-title" id="${esc(titleId)}">${esc(w.what)}</h3>
                ${sub ? `<p class="waiting-place-sub">${esc(sub)}</p>` : ''}
            </header>
            ${w.question === 'form' ? this.waitingPlaceFormHtml(w) : `
            <div class="waiting-place-body${view.mapOpen.has(w.place) ? ' is-map-open' : ''}">
                <div class="waiting-place-cands">${w.question === 'conflict'
                    ? this.waitingPlaceConflictHtml(w, sel)
                    : pickableCandidates(w).map(c => this.waitingPlaceCandHtml(w, c, sel === c.id, access.canAnswer)).join('')}</div>
                <button type="button" class="link waiting-place-maptoggle" aria-expanded="${view.mapOpen.has(w.place)}">⌖ ${esc(view.mapOpen.has(w.place) ? W.hideMap : W.showMap)}</button>
                <div class="waiting-place-mapbox">
                    <div class="place-mini-map waiting-place-map" role="group" aria-label="${esc(W.mapLabel)}"><div class="place-mini-tiles"></div><div class="place-mini-marks"></div></div>
                    <span class="place-mini-legend"><span class="place-mini-dot is-legend" aria-hidden="true"></span>${esc(W.legend)}</span>
                </div>
            </div>`}
            <footer class="waiting-place-foot">
                ${access.canAnswer
                    ? choices.map(c => this.waitingPlaceChoiceHtml(w, c)).join('')
                    : `<p class="waiting-place-note">${esc(W.onComputer)}</p>`}
            </footer>`;
        card.querySelectorAll<HTMLElement>('.waiting-place-cand[data-cand]').forEach(row => {
            row.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('a, .waiting-place-pick')) return;
                this.selectWaitingCandidate(w.place, row.dataset.cand!);
            });
        });
        card.querySelectorAll<HTMLButtonElement>('.waiting-place-pick').forEach(btn => {
            btn.onclick = () => void this.answerWaitingPlace(w, btn.dataset.cand as PlaceAnswerTake);
        });
        card.querySelectorAll<HTMLButtonElement>('.waiting-place-choice').forEach(btn => {
            btn.onclick = () => void this.answerWaitingPlace(w, btn.dataset.take as PlaceAnswerTake);
        });
        const toggle = card.querySelector<HTMLButtonElement>('.waiting-place-maptoggle');
        if (toggle) toggle.onclick = () => {
            if (view.mapOpen.has(w.place)) view.mapOpen.delete(w.place);
            else view.mapOpen.add(w.place);
            this.renderWaitingPlaces();
        };
        if (view.busy) card.querySelectorAll<HTMLButtonElement>('.waiting-place-pick, .waiting-place-choice').forEach(b => { b.disabled = true; });
        return card;
    },

    /** A candidate row of a "where is" question: its letter, name, where, why, source and "It is A". */
    waitingPlaceCandHtml(w: PlaceQuestion, c: WaitingPlaceCandidate, selected: boolean, canAnswer: boolean): string {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const letter = candidateLetter(c.id);
        const warn = this.waitingCandidateWarning(w, c);
        const where = [c.district, c.country].filter(Boolean).join(' · ');
        return `<div class="waiting-place-cand${selected ? ' is-selected' : ''}" data-cand="${c.id}" data-tone="${warn ? 'warn' : 'plain'}">
            <span class="waiting-place-letter" aria-hidden="true">${letter}</span>
            <div class="waiting-place-cand-text">
                <span class="waiting-place-cand-name">${esc(c.name)}</span>
                ${where ? `<span class="waiting-place-cand-where">${esc(where)}</span>` : ''}
                ${c.why ? `<span class="waiting-place-cand-why">${esc(c.why)}</span>` : ''}
                ${warn ? `<span class="waiting-place-cand-warn">! ${esc(warn)}</span>` : ''}
                ${this.waitingSourceHtml(c)}
            </div>
            ${canAnswer ? `<button type="button" class="secondary waiting-place-pick" data-cand="${c.id}" data-wait-act="${c.id}" aria-label="${esc(W.isThisLabel(letter, c.name))}">${esc(W.isThis(letter))}</button>` : ''}
        </div>`;
    },

    /** A conflict: the location now (who gave it) and the research's suggestion. */
    waitingPlaceConflictHtml(w: PlaceQuestion, sel: string): string {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const origin = conflictOrigin(w, geos());
        const src = origin.origin === 'map' ? W.nowMap(formatPlaceDate(origin.at, getCurrentLanguage()))
            : origin.origin === 'hand' ? W.nowHand : origin.origin === 'research' ? W.nowResearch : W.nowOther;
        const now = w.current?.label || w.forms?.[0] || w.place;
        const c = w.candidates?.[0];
        const where = c ? [c.district, c.country].filter(Boolean).join(' · ') : '';
        // Where the location now is and how far from the suggestion: decidable without the map.
        const nowWhere = w.current ? [this.waitingNowWhere(w, now), c ? this.waitingNowFar(w.current, c) : ''].filter(Boolean).join(' · ') : '';
        return `<div class="waiting-place-cand is-current${sel === 'now' ? ' is-selected' : ''}" data-cand="now">
                <span class="waiting-place-letter is-current" aria-hidden="true">•</span>
                <div class="waiting-place-cand-text">
                    <span class="waiting-place-cand-name">${esc(W.now(now))}</span>
                    ${nowWhere ? `<span class="waiting-place-cand-where waiting-place-now-where">${esc(nowWhere)}</span>` : ''}
                    <span class="waiting-place-cand-where">${esc(src)}</span>
                </div>
            </div>
            ${c ? `<div class="waiting-place-cand${sel === c.id ? ' is-selected' : ''}" data-cand="${c.id}" data-tone="plain">
                <span class="waiting-place-letter" aria-hidden="true">${candidateLetter(c.id)}</span>
                <div class="waiting-place-cand-text">
                    <span class="waiting-place-cand-name">${esc(W.suggested(c.name))}</span>
                    ${where ? `<span class="waiting-place-cand-where">${esc(where)}</span>` : ''}
                    ${c.why ? `<span class="waiting-place-cand-why">${esc(c.why)}</span>` : ''}
                    ${this.waitingSourceHtml(c)}
                </div>
            </div>` : ''}`;
    },

    /**
     * Where a conflict's location now is: the geocoder's full name of the
     * place at that point without the name itself, at most three parts
     * ("Lhotov, Lhotov District, Czechia"), else its coordinates.
     */
    waitingNowWhere(w: PlaceQuestion, name: string): string {
        const cur = w.current!;
        const all = geos();
        for (const key of placeQuestionKeys(w)) {
            const geo = all?.[key];
            if (!geo?.label || !sameCoords(geo, cur)) continue;
            const parts = geo.label.split(',').map(x => x.trim()).filter(Boolean);
            const own = parts[0] && parts[0].toLocaleLowerCase() === name.trim().toLocaleLowerCase() ? parts.slice(1) : parts;
            // A geocoder's long name (municipality, district, region, …, postcode, country): three parts are enough.
            const rest = own.filter(x => !/^[\d\s-]+$/.test(x));
            if (rest.length) return (rest.length > 3 ? [rest[0]!, rest[1]!, rest[rest.length - 1]!] : rest).join(', ');
        }
        // As the app writes coordinates elsewhere (a point placed by hand): a decimal point, four places.
        return strings.places.waiting.nowAt(cur.lat.toFixed(4), cur.lon.toFixed(4));
    },

    /** How far the location now is from the suggestion ("34 km from the suggestion"). */
    waitingNowFar(cur: { lat: number; lon: number }, c: WaitingPlaceCandidate): string {
        const W = strings.places.waiting;
        const km = distanceKm(cur, c);
        if (km < 1) return W.nowNear;
        return W.nowFar(km.toLocaleString(getCurrentLanguage(), { maximumFractionDigits: km < 10 ? 1 : 0 }));
    },

    /** A form question: how the facts write it, and what Yes and No do. */
    waitingPlaceFormHtml(w: PlaceQuestion): string {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const ch = w.change!;
        const from = W.formPlace(ch.from.place, ch.from.house);
        const to = W.formPlace(ch.to.place, ch.to.house);
        const forms = (w.forms ?? []).slice(0, 8);
        return `<div class="waiting-place-form">
            ${forms.length ? `<div class="waiting-place-forms"><span class="waiting-place-forms-label">${esc(W.writtenAs)}</span>
                ${forms.map(f => `<span class="waiting-place-chip">${esc(f)}</span>`).join('')}</div>` : ''}
            <p class="waiting-place-explain">${esc(W.formExplain(from, to, ch.facts))}</p>
        </div>`;
    },

    /** A candidate's source: a link (a new tab) when it has an address, its title otherwise. */
    waitingSourceHtml(c: WaitingPlaceCandidate): string {
        if (!c.source) return '';
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const text = `${W.source}: ${c.source.title}`;
        return c.source.url
            ? `<a class="waiting-place-cand-src" href="${esc(c.source.url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`
            : `<span class="waiting-place-cand-src">${esc(text)}</span>`;
    },

    /** A footer button of a question. */
    waitingPlaceChoiceHtml(w: PlaceQuestion, c: PlaceChoiceButton): string {
        const W = strings.places.waiting;
        const esc = (s: string): string => this.escapeHtml(s);
        const first = w.candidates?.[0];
        const label = c.choice === 'none' ? W.none : c.choice === 'unknown' ? W.dunno : c.choice === 'keep' ? W.keep
            : c.choice === 'yes' ? W.yes : c.choice === 'no' ? W.no
                : c.choice === 'fix' && first ? W.fixTo(candidateLabel(first)) : W.chat;
        const primary = c.choice === 'fix' || c.choice === 'yes';
        return `<button type="button" class="${primary ? 'primary' : 'secondary'} waiting-place-choice" data-choice="${c.choice}" data-take="${c.take ?? ''}" data-wait-act="${c.choice}">${esc(label)}</button>`;
    },

    /** The app's own check of a candidate (§5): its first warning's text, '' none. */
    waitingCandidateWarning(w: PlaceQuestion, c: WaitingPlaceCandidate): string {
        const key = placeQuestionKeys(w)[0];
        if (!key) return '';
        const f = checkCandidate(DataManager.getData(), key, { lat: c.lat, lon: c.lon, label: c.name })[0];
        return f ? checkFindingText(f, getCurrentLanguage()) : '';
    },

    /** Highlight a candidate and its point on the map. */
    selectWaitingCandidate(place: string, cand: string): void {
        view.selected.set(place, cand);
        const card = document.querySelector<HTMLElement>(`#${MODAL_ID} .waiting-place[data-place="${CSS.escape(place)}"]`);
        if (!card) return;
        card.querySelectorAll<HTMLElement>('.waiting-place-cand').forEach(r => r.classList.toggle('is-selected', r.dataset.cand === cand));
        card.querySelectorAll<HTMLElement>('.place-mini-pin').forEach(p => p.classList.toggle('is-selected', p.dataset.cand === cand));
    },

    /** Draw the small maps of the cards that show one (laid out by now). */
    drawWaitingPlaceMaps(): void {
        const overlay = document.getElementById(MODAL_ID);
        if (!overlay) return;
        const items = this.waitingPlaceQuestions();
        const data = DataManager.getData();
        const usages = collectPlaces(data);
        const nameOf = (k: string): string | undefined => usages.get(k)?.display;
        overlay.querySelectorAll<HTMLElement>('.waiting-place').forEach(card => {
            const map = card.querySelector<HTMLElement>('.waiting-place-map');
            const w = items.find(i => i.place === card.dataset.place);
            if (!map || !w || map.offsetParent === null) return;
            const own = new Set(placeQuestionKeys(w));
            const tree = findTreePoints(data, '', nameOf).filter(p => !own.has(p.key));
            const cands = w.question === 'conflict' ? (w.candidates ?? []).slice(0, 1) : pickableCandidates(w);
            const { width, height } = mapSize(map, MAP_W, MAP_H);
            // The question's own points decide the view; the family's places are dots where they fall in it.
            const v: SmallMapView = waitingMapView(waitingMapPoints(w), tree, width, height);
            drawTiles(map.querySelector('.place-mini-tiles') as HTMLElement, v, width, height);
            const esc = (s: string): string => this.escapeHtml(s);
            const sel = view.selected.get(w.place) ?? (w.question === 'conflict' ? 'c1' : '');
            const marks: { at: { lat: number; lon: number }; cand: string; text: string; tone: string; title: string }[] = [
                ...(w.current ? [{ at: w.current, cand: 'now', text: '•', tone: 'current', title: w.current.label || w.forms?.[0] || w.place }] : []),
                ...cands.map(c => ({ at: c, cand: c.id, text: candidateLetter(c.id), tone: this.waitingCandidateWarning(w, c) ? 'warn' : 'near', title: c.name })),
            ];
            // Pins on one spot stand side by side: the location now never hides under a letter.
            const xy = spreadPins(marks.map(m => pointInViewport(m.at, v.center, v.zoom, width, height)), width, height);
            const pins = marks.map((m, i) =>
                `<button type="button" class="place-mini-pin${sel === m.cand ? ' is-selected' : ''}" data-cand="${m.cand}" data-tone="${m.tone}" style="left:${xy[i]!.x.toFixed(1)}px;top:${xy[i]!.y.toFixed(1)}px" title="${esc(m.title)}" aria-label="${esc(`${m.text}: ${m.title}`)}" tabindex="-1">${esc(m.text)}</button>`).join('');
            const layer = map.querySelector('.place-mini-marks') as HTMLElement;
            layer.innerHTML = dotsHtml(tree, v, width, height, esc) + pins;
            layer.querySelectorAll<HTMLButtonElement>('.place-mini-pin').forEach(b => {
                b.onclick = () => this.selectWaitingCandidate(w.place, b.dataset.cand!);
            });
        });
    },

    /**
     * Answer one question through the bridge: the card goes at once, the
     * toast says what was written, with Undo when the bridge undoes it.
     * Refused: why, and nothing changes (a question changed meanwhile:
     * "Awaiting action" is read again).
     */
    async answerWaitingPlace(w: PlaceQuestion, take: PlaceAnswerTake): Promise<void> {
        const access = this.waitingPlacesAccess();
        if (view.busy || !access.canAnswer || !access.base || !take) return;
        view.busy = true;
        this.renderWaitingPlaces();
        const res = await postPlacesAnswer(access.base, { place: w.place, take }, access.features);
        view.busy = false;
        if (!res.ok) {
            this.showWaitingPlacesRefusal(res);
            this.renderWaitingPlaces();
            return;
        }
        view.answered.set(w.place, Date.now() + ANSWERED_HIDE_MS);
        view.selected.delete(w.place);
        // The place as the research has it now: Places and the person card show it at once.
        if (res.kind === 'one' && res.place) this.applyPlaceReply(res.place);
        if (view.preview) view.preview.places = view.preview.places.filter(p => p !== w.place);
        const undo = res.kind === 'one' && res.undo && access.canUndo ? res.undo : '';
        this.showToast(this.waitingAnswerText(w, take), TOAST_MS, undo ? {
            action: { label: strings.places.waiting.undo, run: () => void this.undoWaitingPlaces(undo, [w.place]) },
        } : {});
        this.renderWaitingPlaces();
        await this.waitingPlacesWritten();
    },

    /** What a toast says after an answer. */
    waitingAnswerText(w: PlaceQuestion, take: PlaceAnswerTake): string {
        const W = strings.places.waiting;
        const facts = placeQuestionFacts(DataManager.getData(), w.forms ?? []).facts;
        const c = w.candidates?.find(x => x.id === take);
        switch (take) {
            case 'c1': case 'c2': case 'c3':
                if (!c) return W.tKept;
                return w.question === 'conflict' ? W.tFixed(candidateLabel(c), facts)
                    : W.tPicked(w.forms?.[0] || w.what, candidateLabel(c), facts);
            case 'keep': return W.tKept;
            case 'none': return W.tNone;
            case 'unknown': return W.tDunno;
            case 'yes': return w.change ? W.tYes(W.formPlace(w.change.to.place, w.change.to.house), w.change.facts) : W.tNo;
            case 'no': return W.tNo;
        }
    },

    /** Run the open bulk preview: one step at the research, one toast, one Undo. */
    async runWaitingPlacesBulk(): Promise<void> {
        const p = view.preview;
        const access = this.waitingPlacesAccess();
        if (!p || view.busy || !access.canAnswer || !access.base) return;
        const W = strings.places.waiting;
        view.busy = true;
        this.renderWaitingPlaces();
        const res = await postPlacesAnswer(access.base, { places: p.places, take: p.kind === 'accept' ? 'first' : 'keep' }, access.features);
        view.busy = false;
        if (!res.ok || res.kind !== 'bulk') {
            if (!res.ok) this.showWaitingPlacesRefusal(res);
            this.renderWaitingPlaces();
            return;
        }
        view.preview = null;
        for (const id of res.done) view.answered.set(id, Date.now() + ANSWERED_HIDE_MS);
        const facts = p.dry && p.dry !== 'local' ? p.dry.facts : 0;
        const main = p.kind === 'accept' ? W.tBulk(res.done.length, res.done.length === p.places.length ? facts : 0) : W.tBulkKept(res.done.length);
        const sub = res.skipped.length ? W.tSkipped(res.skipped.length) : '';
        const undo = res.undo && access.canUndo && res.done.length ? res.undo : '';
        this.showToast(sub || main, TOAST_MS, {
            ...(sub ? { title: main } : {}),
            ...(undo ? { action: { label: W.undo, run: () => void this.undoWaitingPlaces(undo, res.done) } } : {}),
        });
        this.renderWaitingPlaces();
        await this.waitingPlacesWritten();
    },

    /** Undo an answer step (one question or a bulk step) at the research. */
    async undoWaitingPlaces(undo: string, places: readonly string[]): Promise<void> {
        const access = this.waitingPlacesAccess();
        if (!access.canUndo || !access.base) return;
        const res = await postPlacesUndo(access.base, { undo }, access.features);
        if (!res.ok) {
            this.showWaitingPlacesRefusal(res);
            return;
        }
        for (const id of places) view.answered.delete(id);
        this.showToast(strings.places.waiting.undone, 4000);
        this.renderWaitingPlaces();
        await this.waitingPlacesWritten();
    },

    /** After a write: the research's status (its waiting list) and its places are read again. */
    async waitingPlacesWritten(): Promise<void> {
        await Promise.all([this.refreshWaitingPlacesStatus(), this.refreshPlacesLive()]);
    },

    /** Read the research's status now: "Awaiting action" everywhere and this window show what it says. */
    async refreshWaitingPlacesStatus(): Promise<void> {
        const ctx = this.placesResearchContext();
        if (ctx.base && ctx.researchId) {
            const s = liveSession();
            if (s && !s.ended && s.researchId === ctx.researchId) {
                try {
                    const status = await fetchStatus(`${ctx.base}/status?poll=1`);
                    if (status && !s.ended) this.onLiveStatus(s, status);
                } catch { /* not answering: what is known stays */ }
            } else {
                // Not followed live: the remembered list is what the research says now.
                await this.askResearchBridge(ctx.researchId, STATUS_TIMEOUT_MS);
            }
        }
        // A question the research no longer lists is no longer hidden here.
        const listed = new Set((this.researchWaiting()?.items ?? []).filter(isPlaceQuestion).map(w => w.place));
        for (const id of [...view.answered.keys()]) if (!listed.has(id)) view.answered.delete(id);
        this.refreshActionMenuBadges();
        this.renderLivePanel();
        this.renderWaitingPlaces();
    },

    /** A refused answer or undo, said; a question changed meanwhile reads "Awaiting action" again. */
    showWaitingPlacesRefusal(res: PlacesWriteRefusal): void {
        const W = strings.places.waiting;
        const r = strings.places.research;
        let text: string;
        switch (res.code) {
            case 'changed': text = W.errChanged; void this.waitingPlacesWritten(); break;
            case 'later': text = r.errUndoLater; break;
            case 'busy': text = W.errBusy; break;
            case 'locked': text = W.errLocked; break;
            case 'network': text = r.errNetwork; break;
            case 'archive': text = res.reason || r.errArchive; break;
            default: text = res.reason || W.errFailed;
        }
        this.showToast(text, 6000, { kind: 'waiting-failed' });
    },
});
