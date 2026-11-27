/**
 * Asking the research for a house's history (spec 030 §2, K2.1a): the action of a house by its research state
 * and the setting "House history" (`/status.houses.on`), and the dialog of the request.
 *
 * - The setting off: "Find the house history…" opens the dialog; its button asks the bridge (`POST
 *   /houses/request`), which answers `403 house.link` with the terminal's link (AI + terminal mark): the research's
 *   terminal says the estimate and, on a yes, puts the house on top of the queue and the agent works.
 * - The setting on: "Move to the top" asks the bridge at once (no terminal, no mark); a house done asks again
 *   through the dialog (the button without a mark).
 * Only houses of the tree (a person of the tree lived there), only with `house.request` in `/status.features`.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { collectHouses, findHouse, houseContext, houseLabel, houseOfFact, type TreeHouse } from '../houses.js';
import { placeKey } from '../places.js';
import { houseGroupIds } from '../houses-view.js';
import {
    HOUSE_WRITE_TIMEOUT_MS, houseFeature, houseStatus, requestHouse, type HouseRequestResult,
} from '../house-bridge.js';
import { HOUSE_REQUEST_WITH_MAX, researchDeviceAllows, researchLinkMark, type LiveHouseEstimate, type ResearchActionMark } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import type { HouseId } from '../types.js';
import { researchActionLabel } from './research-open-mark.js';
import { houseUsd, houseWorkDuration } from './houses-auto-view.js';
import { workConfirmText } from './queue-work-dialog.js';
import { houseStateHtml, type HouseStateOf } from './house-state-ui.js';
import { runBusy } from './busy.js';
import { uiModule } from './module.js';

export const HOUSE_REQUEST_DIALOG_ID = 'house-request-modal';

/** The research's default estimate (§4.5) while `/status.houses.estimate` is absent: minutes per house and per town. */
export const HOUSE_DEFAULT_MINUTES = { house: 30, town: 20 } as const;

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** What a house offers: ask for its history (dialog), move it to the top (no dialog), ask again (dialog). */
export type HouseAction = 'request' | 'top' | 'again';

/** What decides a house's action besides its state. */
export interface HouseActionGate {
    /** `/status.houses.on`: the setting "House history". */
    on: boolean;
    /** `house.request` in `/status.features`. */
    request: boolean;
    /** The research's terminal may be opened from here (not on a device of the home network). */
    terminal: boolean;
}

/**
 * A house's action by its research state (§2's table): none / postponed → ask (off) or move to the top (on);
 * queued → move to the top (on only: off, the bridge would answer with the terminal); done → ask again;
 * being researched, waiting (its "Answer" is the badge's), taken over → none.
 */
export function houseActionOf(row: HouseStateOf | null | undefined, gate: HouseActionGate): HouseAction | null {
    if (!gate.request || row?.work === 'takeover') return null;
    switch (row?.state ?? 'none') {
        case 'none':
        case 'held': return gate.on ? 'top' : gate.terminal ? 'request' : null;
        case 'queued': return gate.on ? 'top' : null;
        case 'done': return gate.on || gate.terminal ? 'again' : null;
        default: return null;
    }
}

/** An action's mark: through the terminal (setting off) the agent's (AI + terminal), through the bridge none. */
export function houseActionMark(action: HouseAction, on: boolean): ResearchActionMark {
    return action === 'top' || on ? 'none' : researchLinkMark('house', { houseDo: 'search' });
}

/** A house offered to go with the request ("s ním i"): another house of the family in the same town. */
export interface HouseNeighbour {
    id: HouseId;
    /** The key the research knows it by (its row's), else the tree's. */
    key: string;
    text: string;
    overThreshold: boolean;
}

/**
 * The other houses of the family in the house's town that may go with it: not the house (nor a number joined
 * into it), not one the research is already at (queued, being researched, waiting). Houses with history first.
 */
export function houseNeighbours(house: TreeHouse, all: readonly TreeHouse[],
    rowOf: (h: TreeHouse) => (HouseStateOf & { key?: string }) | null): HouseNeighbour[] {
    const own = new Set(houseGroupIds(house));
    const out: HouseNeighbour[] = [];
    for (const h of all) {
        if (h.townKey !== house.townKey || own.has(h.id) || houseGroupIds(h).some(id => own.has(id))) continue;
        const row = rowOf(h);
        if (row && (row.state === 'queued' || row.state === 'running' || row.state === 'waiting')) continue;
        out.push({ id: h.id, key: row?.key ?? h.id, text: h.text, overThreshold: h.overThreshold });
    }
    return out.sort((a, b) => Number(b.overThreshold) - Number(a.overThreshold));
}

/** The houses chosen at first: those with history, at most two (with the house at most three, K6.3). */
export function houseNeighboursChosen(list: readonly HouseNeighbour[]): HouseId[] {
    return list.filter(n => n.overThreshold).slice(0, HOUSE_REQUEST_WITH_MAX).map(n => n.id);
}

/**
 * The estimate of a request: per house (the house and those going with it) and the town's frame when the town
 * has none yet; the price only once the research measured it (`measured`), else the time alone.
 */
export function houseRequestEstimate(est: LiveHouseEstimate | undefined, houses: number, townFramed: boolean): { minutes: number; usd: number | null } {
    const perHouse = est?.perHouse.minutes ?? HOUSE_DEFAULT_MINUTES.house;
    const perTown = est?.perTown.minutes ?? HOUSE_DEFAULT_MINUTES.town;
    const minutes = perHouse * houses + (townFramed ? 0 : perTown);
    const hu = est?.perHouse.usd;
    const tu = est?.perTown.usd;
    const usd = est?.measured && hu !== undefined && (townFramed || tu !== undefined)
        ? hu * houses + (townFramed ? 0 : tu ?? 0) : null;
    return { minutes, usd };
}

/** The dialog's cost sentence. */
export function houseRequestCostText(e: { minutes: number; usd: number | null }): string {
    return strings.houses.req.cost(houseWorkDuration(e.minutes), e.usd === null ? null : houseUsd(e.usd));
}

/** The sentence of a refused request (the bridge's words when it gave them). */
export function houseRequestRefusal(r: Exclude<HouseRequestResult, { ok: true } | { code: 'link' }>, heldText: () => string): string {
    const W = strings.live.waitingWrite;
    switch (r.code) {
        case 'held': return heldText();
        case 'locked': return W.locked;
        case 'busy': return W.busy;
        case 'full': return W.fileFull;
        case 'network': case 'timeout': return W.failed;
        default: return r.reason || W.writeFailed;
    }
}

interface RequestState {
    house: TreeHouse;
    key: string;
    again: boolean;
    neighbours: HouseNeighbour[];
    chosen: Set<HouseId>;
    busy: boolean;
    note: string | null;
    opener: HTMLElement | null;
}

let req: RequestState | null = null;

/** The family houses of a town as Places lists them (§5): its houses with history and those the research knows. */
export function townFamilyHouses(all: readonly TreeHouse[], townKey: string, known: (h: TreeHouse) => boolean): TreeHouse[] {
    return all.filter(h => h.townKey === townKey && (h.overThreshold || known(h)));
}

/** A house's line under its number in Places: its name, its years, its surnames. */
export function placeHouseMeta(h: Pick<TreeHouse, 'name' | 'period' | 'surnames'>): string {
    const years = h.period ? (h.period.from === h.period.to ? String(h.period.from) : `${h.period.from}–${h.period.to}`) : '';
    return [h.name ?? '', years, h.surnames.join(' → ')].filter(Boolean).join(' · ');
}

/** The tree's houses by town for one drawing (a list of many rows asks per row); dropped after it. */
let byTownNow: Map<string, TreeHouse[]> | null = null;
function housesByTownNow(): Map<string, TreeHouse[]> {
    if (byTownNow) return byTownNow;
    const map = new Map<string, TreeHouse[]>();
    for (const h of collectHouses(DataManager.getData())) {
        const list = map.get(h.townKey);
        if (list) list.push(h); else map.set(h.townKey, [h]);
    }
    byTownNow = map;
    queueMicrotask(() => { byTownNow = null; });
    return map;
}

/** Towns whose family houses are open in Places (town keys). */
const openTowns = new Set<string>();
/** The tree's houses by town while Places is drawn (prepared with its data). */
let townHouses: Map<string, TreeHouse[]> | null = null;

export const houseRequestMethods = uiModule({
    /** What decides the actions of the houses now (null: no research with `house`). */
    houseActionGate(): HouseActionGate | null {
        const b = this.houseResearchBridge();
        if (!b) return null;
        const status = this.researchStatusOf(b.researchId);
        return {
            on: !!houseStatus(status)?.on,
            request: houseFeature(b.features, 'house.request'),
            terminal: researchDeviceAllows('house'),
        };
    },

    /** A house's action now and its label with its mark (null: none); `size` 12 a link in text, 14 a menu item. */
    houseActionNow(house: TreeHouse, size: 12 | 14 = 12): { action: HouseAction; html: string } | null {
        const gate = this.houseActionGate();
        const action = gate ? houseActionOf(this.houseResearchRow(house), gate) : null;
        if (!gate || !action) return null;
        const r = strings.houses.req;
        const label = action === 'top' ? r.top : action === 'again' ? r.again : r.request;
        return { action, html: researchActionLabel(label, houseActionMark(action, gate.on), { size }) };
    },

    /** The action of a house as a link ('' none): `data-house-act` and the tree's house id. */
    houseActionHtml(house: TreeHouse): string {
        const now = this.houseActionNow(house);
        if (!now) return '';
        return `<button type="button" class="house-req" data-house-act="${now.action}" data-house="${esc(house.id)}">${now.html}</button>`;
    },

    /**
     * What a house's action does: move it to the top over the bridge, or the dialog (ask, ask again). `opener`: the
     * focus back from the dialog; `busyEl`: the button that shows the bridge's wait (a menu's item is gone: a toast).
     */
    runHouseAction(house: TreeHouse, action: HouseAction, opener?: HTMLElement | null, busyEl?: HTMLElement): void {
        if (action === 'top') void this.houseMoveTop(house, busyEl);
        else this.openHouseRequest(house, action === 'again', opener);
    },

    /** The tree's house of an id (or of a number joined into it), now. */
    treeHouseOf(id: string): TreeHouse | null {
        const all = collectHouses(DataManager.getData());
        return all.find(h => h.id === id) ?? all.find(h => houseGroupIds(h).includes(id as HouseId)) ?? null;
    },

    /** A click on a house's action: true when handled. */
    houseActionClick(target: HTMLElement): boolean {
        const btn = target.closest<HTMLElement>('.house-req[data-house-act]');
        if (!btn) return false;
        const house = this.treeHouseOf(btn.dataset.house ?? '');
        if (!house) return true;
        const act = btn.dataset.houseAct;
        this.runHouseAction(house, act === 'top' || act === 'again' ? act : 'request', btn, btn);
        return true;
    },

    /** The key the research knows a house by: its row's, else the tree's id. */
    houseRequestKey(house: TreeHouse): string {
        return this.houseResearchRow(house)?.key ?? house.id;
    },

    /** "Move to the top" (the setting on): the bridge at once, a toast; with the setting off after all, the terminal. */
    async houseMoveTop(house: TreeHouse, el?: HTMLElement): Promise<void> {
        const b = this.houseResearchBridge();
        if (!b) return;
        const send = () => requestHouse(b.base, this.houseRequestKey(house), [], b.features,
            { tree: b.researchId, scheme: announcedResearchScheme() });
        const r = el ? await runBusy(el, send, { label: strings.busy.sending, kind: 'write', timeoutMs: HOUSE_WRITE_TIMEOUT_MS + 5000 }) : await send();
        if (!r) return;
        this.houseRequestDone(house, r);
    },

    /** What a request's answer does outside the dialog: a toast, the terminal, or the refusal's sentence. */
    houseRequestDone(house: TreeHouse, r: HouseRequestResult): void {
        if (r.ok) {
            this.showToast(strings.houses.req.toastTop(houseLabel(house.text)), 6000);
            void this.loadHouseStates();
            return;
        }
        if (r.code === 'link') {
            if (r.link) void this.launchResearchLink(r.link, 'terminal');
            return;
        }
        this.showToast(houseRequestRefusal(r, () => (r.held ? this.researchWriteHeldText(r.held, false).toast : '')), 6000);
    },

    /** The dialog of a request (§2): what is searched, the estimate, the houses going with it, how it starts. */
    openHouseRequest(house: TreeHouse, again = false, opener?: HTMLElement | null): void {
        if (!this.houseActionGate()?.request) return;
        const all = collectHouses(DataManager.getData());
        const neighbours = again ? [] : houseNeighbours(house, all, h => this.houseResearchRow(h));
        const active = opener ?? document.activeElement;
        req = {
            house, key: this.houseRequestKey(house), again, neighbours, chosen: new Set(houseNeighboursChosen(neighbours)),
            busy: false, note: null, opener: active instanceof HTMLElement ? active : null,
        };
        document.getElementById(HOUSE_REQUEST_DIALOG_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = HOUSE_REQUEST_DIALOG_ID;
        overlay.innerHTML = '<div class="modal hpf-modal house-req-modal" role="dialog" data-dialog-kind="info" aria-modal="true"'
            + ' aria-labelledby="hrq-title" aria-describedby="hrq-cost" data-skeleton="done"></div>';
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) this.closeHouseRequest(); });
        overlay.addEventListener('click', e => this.houseRequestClick(e));
        overlay.addEventListener('change', e => this.houseRequestChange(e));
        document.body.appendChild(overlay);
        this.pushDialog(HOUSE_REQUEST_DIALOG_ID);
        this.renderHouseRequest();
        // Nothing starts without a click: Cancel has the focus.
        overlay.querySelector<HTMLElement>('[data-hrq="cancel"].secondary')?.focus({ preventScroll: true });
    },

    closeHouseRequest(): void {
        const opener = req?.opener;
        req = null;
        document.getElementById(HOUSE_REQUEST_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== HOUSE_REQUEST_DIALOG_ID);
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    },

    renderHouseRequest(): void {
        const modal = document.querySelector<HTMLElement>(`#${HOUSE_REQUEST_DIALOG_ID} .house-req-modal`);
        const st = req;
        const b = this.houseResearchBridge();
        if (!modal || !st || !b) return;
        const r = strings.houses.req;
        const status = this.researchStatusOf(b.researchId);
        const houses = houseStatus(status);
        const on = !!houses?.on;
        // The town has its frame once the research works or worked on a house of it.
        const townFramed = this.houseResearchTownRows(st.house.townKey).some(row => row.state !== 'none' && row.state !== 'held');
        const cost = houseRequestCostText(houseRequestEstimate(houses?.estimate, 1 + st.chosen.size, townFramed));
        const full = st.chosen.size >= HOUSE_REQUEST_WITH_MAX;
        const withHtml = st.neighbours.length
            ? `<fieldset class="hrq-with"><legend>${esc(r.neighbours)} <span class="hrq-max">· ${esc(r.max)}</span></legend>`
                + st.neighbours.map(n => {
                    const on = st.chosen.has(n.id);
                    return `<label class="hrq-with-item"><input type="checkbox" data-hrq-with="${esc(n.id)}"${on ? ' checked' : ''}${!on && full ? ' disabled' : ''}>`
                        + `<span>${esc(n.text)}</span></label>`;
                }).join('') + '</fieldset>'
            : '';
        const attach = !st.again && houseFeature(b.features, 'house.material')
            ? `<p class="hrq-attach-line"><button type="button" class="link" data-hrq="attach">${esc(r.attach)}</button></p>` : '';
        const mode = on ? r.modeQueue : workConfirmText(status?.work);
        const note = st.note ? `<p class="hpf-note" role="status">${esc(st.note)}</p>` : '';
        const label = strings.houses.req.go;
        modal.innerHTML = '<div class="modal-header hpf-header">'
            + `<h2 id="hrq-title">${esc(r.title(houseLabel(st.house.text), st.house.ref.town))}</h2>`
            + `<button type="button" class="close-btn" data-hrq="cancel" aria-label="${esc(strings.buttons.close)}">&times;</button></div>`
            + '<div class="modal-content hpf-body">'
            + `<p class="hpf-area"><strong>${esc(r.what)}</strong></p>`
            + (st.again ? `<p class="hrq-again">${esc(r.againWhat)}</p>` : '')
            + `<p class="hpf-cost" id="hrq-cost">${esc(cost)}</p>`
            + withHtml + attach
            + `<p class="hpf-mode">${esc(mode)}</p>`
            + note
            + '</div>'
            + '<div class="buttons hpf-foot">'
            + `<button type="button" class="secondary" data-hrq="cancel">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary" id="hrq-go" data-hrq="go"${st.busy ? ' aria-disabled="true"' : ''}>`
            + `${researchActionLabel(label, houseActionMark('request', on))}</button>`
            + '</div>';
    },

    houseRequestClick(e: MouseEvent): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-hrq]');
        const st = req;
        if (!el || !st) return;
        switch (el.dataset.hrq) {
            case 'cancel': this.closeHouseRequest(); return;
            case 'go': void this.houseRequestGo(); return;
            // The material dialog over this one (§7): the request stays open under it.
            case 'attach': this.showHouseMaterialDialog(st.house); return;
            default: return;
        }
    },

    /** A house going with it ticked or not: at most two, the others disabled once two are. */
    houseRequestChange(e: Event): void {
        const box = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-hrq-with]');
        const st = req;
        if (!box || !st) return;
        const id = box.dataset.hrqWith as HouseId;
        if (box.checked && st.chosen.size < HOUSE_REQUEST_WITH_MAX) st.chosen.add(id);
        else st.chosen.delete(id);
        this.renderHouseRequest();
        document.querySelector<HTMLElement>(`#${HOUSE_REQUEST_DIALOG_ID} input[data-hrq-with="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    },

    /** The dialog's button: the bridge's request; the setting off gives the terminal's link, which opens. */
    async houseRequestGo(): Promise<void> {
        const st = req;
        const b = this.houseResearchBridge();
        if (!st || st.busy) return;
        if (!b) {
            st.note = strings.live.waitingWrite.failed;
            this.renderHouseRequest();
            return;
        }
        const more = st.neighbours.filter(n => st.chosen.has(n.id)).map(n => n.key);
        const send = async (): Promise<HouseRequestResult> => {
            st.busy = true;
            st.note = null;
            this.renderHouseRequest();
            try {
                return await requestHouse(b.base, st.key, more, b.features, { tree: b.researchId, scheme: announcedResearchScheme() });
            } finally {
                st.busy = false;
            }
        };
        const el = document.getElementById('hrq-go');
        const r = el ? await runBusy(el, send, { label: strings.busy.sending, kind: 'write', timeoutMs: HOUSE_WRITE_TIMEOUT_MS + 5000 }) : await send();
        if (req !== st) return;
        if (!r) { this.renderHouseRequest(); return; }
        if (r.ok || r.code === 'link') {
            this.closeHouseRequest();
            this.houseRequestDone(st.house, r);
            return;
        }
        st.note = houseRequestRefusal(r, () => (r.held ? this.researchWriteHeldText(r.held, false).toast : ''));
        this.renderHouseRequest();
    },

    // ─── An event's house (§5) ────────────────────────────────────────────

    /**
     * Finds the tree's house of an event by its place and address (null: none). The tree's houses are read once,
     * at its first address, for one drawing of the timeline.
     */
    eventHouseFinder(): (place: string | undefined, address: string | undefined) => TreeHouse | null {
        let all: { data: ReturnType<typeof DataManager.getData>; houses: TreeHouse[]; ctx: ReturnType<typeof houseContext> } | null = null;
        return (place, address) => {
            if (!place?.trim() || !address?.trim()) return null;
            if (!all) {
                const data = DataManager.getData();
                all = { data, houses: collectHouses(data), ctx: houseContext(data) };
            }
            const ref = houseOfFact({ place, house: address }, all.ctx);
            return ref ? findHouse(all.data, ref.town, ref.house, all.houses) : null;
        };
    },

    /** An event's address as the link to its house. */
    houseLinkHtml(house: TreeHouse, address: string): string {
        return `<button type="button" class="link pm-house-link" data-house="${esc(house.id)}" title="${esc(strings.houses.familyHouses.menuItem(houseLabel(house.text)))}">${esc(houseLabel(address))}</button>`;
    },

    /**
     * The place menu's item of an event's house: "House history čp. 16", under it in muted text the research's
     * state (with the research, "not researched" too) and where the item goes: "house page", or "Houses window"
     * in a satellite (openHouse; spec 030 §5, question 28). The item only opens the house; no action in it.
     */
    placeMenuHouseHtml(houseId: string): string {
        const h = this.treeHouseOf(houseId);
        if (!h) return '';
        const f = strings.houses.familyHouses;
        // The research's list read when not yet (the menu may be the first view of a house): its line follows.
        if (this.houseResearchBridge()) this.houseStatesSync();
        return `<button type="button" role="menuitem" class="place-menu-item place-menu-house" data-action="house" data-house="${esc(h.id)}">`
            + `<span class="place-menu-house-name">${esc(f.menuItem(houseLabel(h.text)))}</span>`
            + `<span class="place-menu-house-line">${this.placeMenuHouseLineHtml(h)}</span></button>`;
    },

    /** The place menu item's second line: the research's state (when its list has the house) · where it opens. */
    placeMenuHouseLineHtml(h: TreeHouse): string {
        const f = strings.houses.familyHouses;
        const row = this.houseResearchRow(h);
        const state = row ? `${houseStateHtml(row, { lang: getCurrentLanguage(), plain: true })} · ` : '';
        return `${state}${esc(this.houseOpenMain() ? f.windowLine : f.pageLine)}`;
    },

    /** An open place menu's house lines, from the research's list now (it came after the menu opened). */
    refreshPlaceMenuHouses(): void {
        document.querySelectorAll<HTMLElement>('.place-menu-house[data-house]').forEach(item => {
            const h = this.treeHouseOf(item.dataset.house ?? '');
            const line = item.querySelector<HTMLElement>('.place-menu-house-line');
            if (h && line) line.innerHTML = this.placeMenuHouseLineHtml(h);
        });
    },

    // ─── Places: a town's family houses (§5) ──────────────────────────────

    /** How many family houses a town has (as its "Family houses" line in Places). */
    townFamilyHouseCount(town: string): number {
        const key = placeKey(town);
        if (!key) return 0;
        return townFamilyHouses(housesByTownNow().get(key) ?? [], key, h => !!this.houseResearchRow(h)).length;
    },

    /** Places is drawn anew: the tree's houses by town, once for all its rows. */
    placeHousesPrepare(): void {
        townHouses = housesByTownNow();
    },

    /**
     * The "Family houses" line of a town ('' without a house with history or known to the research): how many,
     * the research's states, and the link that opens its houses under it — each with its state, its action (§2)
     * and "House page ›". Without the research only the houses and their pages.
     */
    placeHousesHtml(town: string): string {
        const key = placeKey(town);
        if (!townHouses) this.placeHousesPrepare();
        const houses = townFamilyHouses(townHouses?.get(key) ?? [], key, h => !!this.houseResearchRow(h));
        if (!houses.length) return '';
        const f = strings.houses.familyHouses;
        const open = openTowns.has(key);
        const subId = `place-houses-${key.replace(/[^a-z0-9]+/g, '-')}`;
        return `<div class="place-houses-wrap" data-town="${esc(key)}" data-town-name="${esc(town)}">`
            + `<div class="place-houses"><span class="place-history-label">${esc(f.label)}</span>`
            + `<span class="place-history-text">${esc(f.summary(houses.length))}${this.placeTownHouseStatesHtml(town)}</span>`
            + `<button type="button" class="link place-history-link place-houses-toggle" aria-expanded="${open}" aria-controls="${subId}">`
            + `${esc(f.link(houses.length))} <span aria-hidden="true">${open ? '▾' : '›'}</span></button></div>`
            + (open ? `<div class="place-houses-sub" id="${subId}">${houses.map(h => this.placeHouseRowHtml(h)).join('')}</div>` : '')
            + '</div>';
    },

    placeHouseRowHtml(h: TreeHouse): string {
        const row = this.houseResearchRow(h);
        const badge = row && row.state !== 'none' ? houseStateHtml(row, { lang: getCurrentLanguage() }) : '';
        return `<div class="r" data-house="${esc(h.id)}"><b>${esc(houseLabel(h.text))}</b><span class="m">${esc(placeHouseMeta(h))}</span>`
            + `<span class="a">${badge}${this.houseActionHtml(h)}`
            + `<button type="button" class="link place-history-link place-house-page" data-house="${esc(h.id)}">${esc(strings.houses.familyHouses.page)}</button>`
            + '</span></div>';
    },

    /** A click in a town's family houses: true when handled. */
    placeHousesClick(target: HTMLElement): boolean {
        const toggle = target.closest<HTMLElement>('.place-houses-toggle');
        if (toggle) {
            const wrap = toggle.closest<HTMLElement>('.place-houses-wrap');
            const key = wrap?.dataset.town ?? '';
            if (openTowns.has(key)) openTowns.delete(key); else openTowns.add(key);
            this.refreshPlaceHousesRows();
            document.querySelector<HTMLElement>(`#places-modal .place-houses-wrap[data-town="${CSS.escape(key)}"] .place-houses-toggle`)?.focus({ preventScroll: true });
            return true;
        }
        if (target.closest('.place-houses-wrap .house-req')) return this.houseActionClick(target);
        const page = target.closest<HTMLElement>('.place-house-page');
        if (page?.dataset.house) {
            this.openHouse(page.dataset.house, 'places-modal');
            return true;
        }
        return false;
    },

    /** The research's houses changed (or a town opened): the open Places draws its family houses again. */
    refreshPlaceHousesRows(): void {
        document.querySelectorAll<HTMLElement>('#places-modal .place-houses-wrap[data-town]').forEach(wrap => {
            const html = this.placeHousesHtml(wrap.dataset.townName ?? '');
            if (!html) { wrap.remove(); return; }
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            if (tmp.firstElementChild) wrap.replaceWith(tmp.firstElementChild);
        });
    },
});
