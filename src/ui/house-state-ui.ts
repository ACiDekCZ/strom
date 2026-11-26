/**
 * The research's state of a house (spec 030 §2, K7.5): its badge in the Houses window's row, in the open row's
 * detail and, summed up per town, in Places. Only with `/status.features` `house`; a house the research does not
 * list (`GET /houses`) shows nothing. The list is read again when `/status.houses.rev` changes (each bridge status).
 * Part 1 only shows the state and the way to answer a waiting question; asking for a history is part 2.
 */

import { strings, getCurrentLanguage, type Language } from '../strings.js';
import type { TreeHouse } from '../houses.js';
import { houseGroupIds } from '../houses-view.js';
import { placeKey } from '../places.js';
import { formatPlaceDate } from '../place-identity.js';
import { fetchHouses, houseFeature, houseStatus, type HouseListRow, type HouseState, type HouseWork } from '../house-bridge.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** What the badge needs of a row of `GET /houses`. */
export interface HouseStateOf {
    state: HouseState;
    at?: string;
    work?: HouseWork;
    question?: { id: string; text?: string };
}

/**
 * The badge of a house's research state (empty without a row: the research does not know the house).
 * `answer`: the waiting state carries its "Answer" (the question opens as an item of "Awaiting action").
 */
export function houseStateHtml(row: HouseStateOf | null | undefined, opts: { lang: Language; answer?: boolean }): string {
    if (!row) return '';
    const st = strings.houses.st;
    switch (row.state) {
        case 'none': return `<span class="hs is-text" data-state="none">${esc(st.none)}</span>`;
        case 'queued':
            if (row.work === 'takeover') {
                return `<span class="hs" data-state="takeover">${esc(st.takeover)}</span>`
                    + `<span class="hs-note">${esc(strings.houses.takeoverNote)}</span>`;
            }
            return `<span class="hs" data-state="queued">${esc(st.queued)}</span>`;
        case 'running':
            return `<span class="hs" data-state="running"><span class="hs-pulse" aria-hidden="true"></span>${esc(st.running)}</span>`;
        case 'done':
            return `<span class="hs is-text" data-state="done">${esc(st.done(formatPlaceDate(row.at, opts.lang)).trim())}</span>`;
        case 'waiting': {
            const q = row.question;
            const act = opts.answer && q?.id
                ? `<button type="button" class="hs-act house-answer" data-question="${esc(q.id)}"${q.text ? ` title="${esc(q.text)}"` : ''}>${esc(strings.houses.answer)}</button>`
                : '';
            return `<span class="hs is-wait" data-state="waiting">${esc(st.waiting)}</span>${act}`;
        }
        case 'held': return `<span class="hs is-text" data-state="held">${esc(st.held)}</span>`;
        default: return '';
    }
}

/** How many of a town's research houses are in each state ("1 done, 1 being researched"); none: ''. */
export function houseTownStatesText(rows: readonly HouseStateOf[], lang: Language): string {
    const st = strings.houses.st;
    const n = { done: 0, running: 0, queued: 0, waiting: 0, held: 0 };
    for (const r of rows) if (r.state in n) n[r.state as keyof typeof n]++;
    const parts = ([
        ['done', st.done('').trim()], ['running', st.running], ['waiting', st.waiting], ['queued', st.queued], ['held', st.held],
    ] as const).filter(([k]) => n[k] > 0).map(([k, label]) => `${n[k].toLocaleString(lang)} ${label}`);
    return parts.join(', ');
}

/** The research's list as last read, per bridge (`base`). */
let list: { base: string; rev: string; rows: HouseListRow[]; byKey: Map<string, HouseListRow> } | null = null;
let loading: string | null = null;
let listening = false;

export const houseStateMethods = uiModule({
    /** The bridge and its features for the houses, or null (no research, bridge down, no `house`). */
    houseResearchBridge(): { researchId: string; base: string; features: readonly string[] } | null {
        const ctx = this.placesResearchContext();
        if (!ctx.researchId || !ctx.base || !houseFeature(ctx.features, 'house')) return null;
        return { researchId: ctx.researchId, base: ctx.base, features: ctx.features };
    },

    /** Read the list when the research's rev differs from the one read (or none is read yet). */
    houseStatesSync(): void {
        if (!listening) {
            listening = true;
            onBridgeStatus((rid, status) => {
                const b = this.houseResearchBridge();
                if (!b || b.researchId.toLowerCase() !== rid.toLowerCase()) return;
                const rev = houseStatus(status)?.rev;
                if (rev && list?.base === b.base && list.rev === rev) return;
                void this.loadHouseStates(rev);
            });
        }
        const b = this.houseResearchBridge();
        if (b && list?.base !== b.base) void this.loadHouseStates();
    },

    async loadHouseStates(rev?: string): Promise<void> {
        const b = this.houseResearchBridge();
        if (!b || loading === b.base) return;
        loading = b.base;
        try {
            const r = await fetchHouses(b.base, rev ? { rev } : {});
            if (!r.ok) return;
            const changed = list?.base !== b.base || list.rev !== r.rev;
            list = { base: b.base, rev: r.rev, rows: r.houses, byKey: new Map(r.houses.map(h => [h.key, h])) };
            if (changed) this.houseStatesChanged();
        } finally {
            loading = null;
        }
    },

    /** The list changed: the open Houses window and Places' town lines show it. */
    houseStatesChanged(): void {
        this.refreshHousesWindow();
        this.refreshPlaceTownHouseStates();
    },

    /** The rev of the list read now ('' none). */
    houseStatesRev(): string {
        return list?.rev ?? '';
    },

    /** The research's row of a house of the tree (any of its joined numbers), or null. */
    houseResearchRow(h: Pick<TreeHouse, 'id' | 'townKey' | 'numbers'>): HouseListRow | null {
        const b = this.houseResearchBridge();
        if (!b || list?.base !== b.base) return null;
        for (const id of houseGroupIds(h)) {
            const row = list.byKey.get(id);
            if (row) return row;
        }
        return null;
    },

    /** The research's rows of one town (its placeKey). */
    houseResearchTownRows(townKey: string): HouseListRow[] {
        const b = this.houseResearchBridge();
        if (!b || list?.base !== b.base) return [];
        return list.rows.filter(r => r.place.key === townKey || placeKey(r.place.name) === townKey);
    },

    renderHouseStateSlot(house: TreeHouse): string {
        this.houseStatesSync();
        return houseStateHtml(this.houseResearchRow(house), { lang: getCurrentLanguage(), answer: true });
    },

    houseStateSlotClick(target: HTMLElement, _house: TreeHouse): boolean {
        const answer = target.closest<HTMLElement>('.house-answer');
        if (!answer?.dataset.question) return false;
        this.answerHouseQuestion(answer.dataset.question);
        return true;
    },

    /** "Answer": the question opens as an item of "Awaiting action" in the research's overview. */
    answerHouseQuestion(questionId: string): void {
        this.closeHousesWindow(false);
        this.showOverviewWaitingItem(questionId);
    },

    /** The research's part of an open row's detail: its state (with "Answer"), its materials and links (§7). */
    renderHouseResearchDetail(h: TreeHouse): string {
        if (!this.houseResearchBridge()) return '';
        const row = this.houseResearchRow(h);
        const badge = houseStateHtml(row, { lang: getCurrentLanguage(), answer: true });
        const more = this.renderHouseMaterialsHtml(h);
        return badge || more
            ? `<div class="house-research">${badge ? `<div class="house-research-state">${badge}</div>` : ''}${more}</div>` : '';
    },

    /** A click in the detail's research part: true when handled. */
    houseResearchDetailClick(target: HTMLElement, house: TreeHouse): boolean {
        return this.houseStateSlotClick(target, house) || this.houseMaterialClick(target, house);
    },

    /** Places: a town's line of its research houses ("1 done, 1 being researched"), or ''. */
    placeTownHouseStatesHtml(town: string): string {
        if (!this.houseResearchBridge()) return '';
        this.houseStatesSync();
        const text = houseTownStatesText(this.houseResearchTownRows(placeKey(town)), getCurrentLanguage());
        return `<span class="place-town-house-states" data-town="${esc(placeKey(town))}"${text ? '' : ' hidden'}>${esc(text)}</span>`;
    },

    /** The towns' lines in an open Places, from the list now. */
    refreshPlaceTownHouseStates(): void {
        document.querySelectorAll<HTMLElement>('.place-town-house-states[data-town]').forEach(el => {
            const text = houseTownStatesText(this.houseResearchTownRows(el.dataset.town ?? ''), getCurrentLanguage());
            el.textContent = text;
            el.hidden = !text;
        });
    },
});
