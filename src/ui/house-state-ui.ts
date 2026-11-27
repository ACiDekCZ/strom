/**
 * The research's state of a house (spec 030 §2, K7.5): its badge in the Houses window's row, in the open row's
 * detail and, summed up per town, in Places. Only with `/status.features` `house`; a house the research does not
 * list (`GET /houses`) shows nothing. The list is read again when `/status.houses.rev` changes (each bridge status).
 * Asking for a history (part 2): src/ui/house-request-ui.ts, its action beside the badge.
 */

import { strings, getCurrentLanguage, type Language } from '../strings.js';
import { collectHouses, houseTitle, type TreeHouse } from '../houses.js';
import { houseOfQuestion, houseTaskView, type HouseTaskView } from '../house-tasks.js';
import type { LiveQueueItem } from '../research-link.js';
import { houseGroupIds, type HouseDoneOf } from '../houses-view.js';
import { placeKey } from '../places.js';
import { formatPlaceDate } from '../place-identity.js';
import { formatFlexDate } from '../dates.js';
import { fetchHouses, houseCache, houseFeature, houseStatus, type HouseListRow, type HouseResearch, type HouseState, type HouseWork } from '../house-bridge.js';
import { houseOutputFilter } from '../house-privacy.js';
import { DataManager } from '../data.js';
import type { HouseUserData, StromData } from '../types.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The research's sensitive events of a house in the open row (spec 030 §10, K1.4a): each "hidden in outputs"
 * with "Show in outputs", or once shown "Hide in outputs" (none in a tree that cannot be changed), and the
 * sentence of what outputs leave out of the house. '' when the research sent no `sensitive`.
 */
export function houseSensitiveHtml(house: TreeHouse, research: HouseResearch | null, data: StromData, now: Date, opts: { lang: Language; readOnly: boolean }): string {
    const ids = new Set(research?.sensitive ?? []);
    if (!research || !ids.size) return '';
    const s = strings.houses;
    const revealed = new Set(data.houses?.[house.id]?.revealInOutputs ?? []);
    const rows = research.timeline.filter(e => ids.has(e.id)).map(e => {
        const shown = revealed.has(e.id);
        const date = e.date ? formatFlexDate(e.date, opts.lang) || e.date : '';
        const act = opts.readOnly ? ''
            : `<button type="button" class="house-research-act house-reveal" data-event="${esc(e.id)}" data-reveal="${shown ? 'hide' : 'show'}">${esc(shown ? s.hide : s.reveal)}</button>`;
        return `<div class="house-sens" data-event="${esc(e.id)}"><span class="t">${esc([date, e.text].filter(Boolean).join(' · '))}`
            + `${shown ? '' : `<span class="s">${esc(s.hiddenOut)}</span>`}</span>${act}</div>`;
    });
    if (!rows.length) return '';
    const hidden = houseOutputFilter(house, research, data, now).hidden;
    const summary = hidden.events || hidden.locationBy
        ? `<p class="house-research-note house-hidden-summary">${esc(s.hiddenSummary(hidden.events, hidden.locationBy))}</p>` : '';
    return `<div class="house-sensitive">${summary}<div class="house-sens-list">${rows.join('')}</div></div>`;
}

/** The house's events shown in outputs once a person reveals (or hides again) one of them. */
export function withRevealed(current: readonly string[] | undefined, eventId: string, show: boolean): string[] {
    const set = new Set(current ?? []);
    if (show) set.add(eventId); else set.delete(eventId);
    return [...set];
}

/** What the badge needs of a row of `GET /houses`. */
export interface HouseStateOf {
    state: HouseState;
    at?: string;
    work?: HouseWork;
    /** The task is the house's look (spec 145 T1). */
    look?: true;
    question?: { id: string; text?: string };
}

/**
 * The badge of a house's research state (empty without a row: the research does not know the house).
 * `answer`: the waiting state carries its "Answer" (the question opens as an item of "Awaiting action").
 * `plain`: a line of words (the place menu's item), without the done tag's ✓.
 */
export function houseStateHtml(row: HouseStateOf | null | undefined, opts: { lang: Language; answer?: boolean; plain?: boolean }): string {
    if (!row) return '';
    const st = strings.houses.st;
    switch (row.state) {
        case 'none': return `<span class="hs is-text" data-state="none">${esc(st.none)}</span>`;
        case 'queued':
            if (row.work === 'takeover') {
                return `<span class="hs" data-state="takeover">${esc(st.takeover)}</span>`
                    + `<span class="hs-note">${esc(strings.houses.takeoverNote)}</span>`;
            }
            if (row.look) return `<span class="hs" data-state="queued" data-work="look">${esc(st.queuedLook)}</span>`;
            return `<span class="hs" data-state="queued">${esc(st.queued)}</span>`;
        case 'running':
            return `<span class="hs" data-state="running"><span class="hs-pulse" aria-hidden="true"></span>${esc(st.running)}</span>`;
        case 'done':
            // Researched: a tag with ✓ and its day (Milan 27 Nov 2026: seen at once, the day kept).
            return `<span class="hs${opts.plain ? ' is-text' : ' is-done'}" data-state="done">${opts.plain ? '' : '<span class="hs-ok" aria-hidden="true">✓</span>'}${esc(st.done(formatPlaceDate(row.at, opts.lang)).trim())}</span>`;
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
        this.refreshHousePage();
        this.refreshPlaceTownHouseStates();
        this.refreshPlaceHousesRows();
        this.refreshMapHouses();
        this.refreshPlaceMenuHouses();
    },

    /** The rev of the list read now ('' none). */
    houseStatesRev(): string {
        return list?.rev ?? '';
    },

    /**
     * The houses' done days for the Houses window's "Researched" and "Recently researched" (houses-view
     * HouseDoneOf), null without the research's houses (no research with `house`, its list not read yet).
     */
    houseDoneOf(): HouseDoneOf | null {
        const b = this.houseResearchBridge();
        if (!b) return null;
        this.houseStatesSync();
        if (list?.base !== b.base) return null;
        return h => {
            const row = this.houseResearchRow(h);
            return row?.state === 'done' ? row.at ?? '' : null;
        };
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

    /**
     * The queue's tasks of houses in words (spec 030 §14), for one drawing of a list: the tree's houses
     * are read once, at the first task of a house.
     */
    houseTaskViews(): (q: Pick<LiveQueueItem, 'id' | 'text' | 'taskKind' | 'house'>) => HouseTaskView | null {
        let houses: TreeHouse[] | null = null;
        return q => {
            if (q.taskKind !== 'house') return null;
            const b = this.houseResearchBridge();
            if (b) this.houseStatesSync();
            const rows = b && list?.base === b.base ? list.rows : [];
            const towns = b ? houseCache(b.base).townTasks : null;
            return houseTaskView(q, {
                rows,
                treeHouse: key => {
                    houses ??= collectHouses(DataManager.getData());
                    return houses.find(h => h.id === key) ?? houses.find(h => houseGroupIds(h).includes(key as TreeHouse['id'])) ?? null;
                },
                townOfTask: t => towns?.get(t) ?? null,
            });
        };
    },

    /** After a queued task of a house: "House page ›", after a town's frame "Houses in this town ›" (spec 030 §14). */
    appendHouseTaskLink(text: HTMLElement, v: HouseTaskView | null): void {
        if (!v || (!v.house && !v.town)) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-button live-queue-house';
        btn.textContent = v.house ? strings.houses.familyHouses.page : strings.houses.townHouses;
        if (v.house) btn.dataset.house = v.house;
        btn.onclick = (e) => {
            e.stopPropagation();
            if (v.house) this.openHouse(v.house);
            else if (v.town) this.showTownHouses(v.town);
        };
        text.append(' ', btn);
    },

    /** The research's row of the house a waiting item asks about (spec 030 §14), or null. */
    houseOfWaiting(id: string): HouseListRow | null {
        const b = this.houseResearchBridge();
        if (!b) return null;
        this.houseStatesSync();
        return list?.base === b.base ? houseOfQuestion(id, list.rows) : null;
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
        const badge = houseStateHtml(row, { lang: getCurrentLanguage(), answer: true }) + this.houseActionHtml(h);
        const more = this.renderHouseMaterialsHtml(h);
        const sensitive = houseSensitiveHtml(h, this.houseResearchOf(h), DataManager.getData(), new Date(),
            { lang: getCurrentLanguage(), readOnly: DataManager.housesReadOnly() });
        return badge || more || sensitive
            ? `<div class="house-research">${badge ? `<div class="house-research-state">${badge}</div>` : ''}${sensitive}${more}</div>` : '';
    },

    /** A click in the detail's research part: true when handled. */
    houseResearchDetailClick(target: HTMLElement, house: TreeHouse): boolean {
        return this.houseStateSlotClick(target, house) || this.houseActionClick(target) || this.houseRevealClick(target, house)
            || this.houseMaterialClick(target, house);
    },

    /** "Show in outputs" / "Hide in outputs" of a sensitive event: one step of undo. */
    houseRevealClick(target: HTMLElement, house: TreeHouse): boolean {
        const btn = target.closest<HTMLElement>('.house-reveal');
        if (!btn?.dataset.event) return false;
        const user = DataManager.getData().houses?.[house.id];
        const reveal = withRevealed(user?.revealInOutputs, btn.dataset.event, btn.dataset.reveal === 'show');
        const next: HouseUserData = { ...(user ?? {}), revealInOutputs: reveal };
        if (!reveal.length) delete next.revealInOutputs;
        if (DataManager.setHousesUserData({ [house.id]: Object.keys(next).length ? next : undefined }, houseTitle(house))) {
            this.refreshHousesWindow();
            document.querySelector<HTMLElement>(`#houses-modal .house-detail[data-house="${CSS.escape(house.id)}"] .house-reveal[data-event="${CSS.escape(btn.dataset.event)}"]`)?.focus({ preventScroll: true });
        }
        return true;
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
