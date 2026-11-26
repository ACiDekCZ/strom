/**
 * The Houses window (spec 030 §1, K1.1–K1.2): the houses of the tree worked
 * out from its facts, by town. Houses with history (2 generations or 30
 * years) first, the others folded under "More houses". A row opens in place
 * with its interesting facts and its people by year (a click puts the person
 * in the middle of the tree). Its ⋯ menu joins it with another house or tells
 * a number apart (StromData.houses), one undo step each.
 *
 * The research's state of a house and its actions come from the hooks
 * `renderHouseStateSlot`, `houseStateSlotClick`, `houseMenuResearchItems`
 * (spec 030 §2 fills them); `houseResearchNumbers` reads the research's row.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import type { HouseId, Person, PersonId, StromData } from '../types.js';
import {
    collectHouses, houseFacts, houseInteresting, houseTownKey, withResearchNumbers,
    type HouseFact, type HouseNumber, type ResearchHouseNumber, type TreeHouse,
} from '../houses.js';
import {
    houseFormerNumbers, houseGroupIds, houseMatches, houseSearchText, houseTownGroups, mergeHouseChanges, readHousesSort,
    splitHouseChanges, type HousesFilter, type HousesSort, type HouseTownGroup,
} from '../houses-view.js';
import { houseIsStreet, houseKey, placeKey } from '../places.js';
import { foldSearch } from '../history-manage.js';
import { confirmHouse, houseFeature } from '../house-bridge.js';
import { districtText } from '../places-dialog.js';
import { shownName } from '../person-name.js';
import { coupleEventLabel } from '../events.js';
import { eventTypeLabel } from './person-events.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { helpMark } from './help-mark.js';

/** Rows of a town drawn at once; the rest come as the list scrolls to them. */
export const HOUSES_BATCH = 40;
/** People of a house's detail before "and N more records…". */
export const HOUSE_DETAIL_ROWS = 8;

const MODAL_ID = 'houses-modal';
const MERGE_ID = 'house-merge-modal';
const SPLIT_ID = 'house-split-modal';

/** A number of a house the research knows (with its id, for its word on it). */
export interface HouseResearchNumber extends ResearchHouseNumber {
    id?: string;
}

/** A row of a house's ⋯ menu. */
export interface HouseMenuItem {
    key: string;
    label: string;
    run: () => void;
}

interface HousesWindowState {
    filter: HousesFilter;
    sort: HousesSort;
    parent: string | null;
    houses: TreeHouse[];
    byId: Map<HouseId, TreeHouse>;
    texts: Map<HouseId, string>;
    open: Set<HouseId>;
    allRecords: Set<HouseId>;
    closedTowns: Set<string>;
    moreOpen: Set<string>;
    shown: Map<string, number>;
    observer: IntersectionObserver | null;
    closeMenu: (() => void) | null;
}

let state: HousesWindowState | null = null;

function freshState(parent: string | null): HousesWindowState {
    return {
        filter: { query: '', onlyHistory: false }, sort: 'number', parent,
        houses: [], byId: new Map(), texts: new Map(),
        open: new Set(), allRecords: new Set(), closedTowns: new Set(), moreOpen: new Set(), shown: new Map(),
        observer: null, closeMenu: null,
    };
}

/** "Bělokamen čp. 16" for the change log and the dialogs' subtitles. */
export function houseLabel(h: TreeHouse): string {
    return `${h.ref.town} ${h.text}`;
}

/** A number as "formerly" shows it beside the house's own: "9" of "čp. 9", a street whole. */
function shortNumber(text: string): string {
    return houseIsStreet(text) ? text.trim() : houseKey(text);
}

function yearsText(h: Pick<TreeHouse, 'period'>): string {
    if (!h.period) return '';
    return h.period.from === h.period.to ? String(h.period.from) : `${h.period.from}–${h.period.to}`;
}

const femaleOf = (p: Person | undefined): boolean => p?.gender === 'female';

export const housesMethods = uiModule({
    // ==================== HOOKS (spec 030 §2 fills them) ====================

    // The research's state in the row's right column (renderHouseStateSlot, houseStateSlotClick) and in the
    // detail (renderHouseResearchDetail, houseResearchDetailClick): src/ui/house-state-ui.ts.

    // The research's rows of a house's ⋯ menu (above the line), houseMenuResearchItems: src/ui/house-material-ui.ts.

    /** The numbers the research knows of a house (its own included): its row of `GET /houses`. */
    houseResearchNumbers(id: HouseId, house?: Pick<TreeHouse, 'id' | 'townKey' | 'numbers'>): HouseResearchNumber[] {
        const h = house ?? state?.byId.get(id) ?? { id, townKey: houseTownKey(id), numbers: [] };
        return this.houseResearchRow(h)?.numbers ?? [];
    },

    // ==================== WINDOW ====================

    /**
     * Open the Houses window: `town` shows one town only, `house` opens its
     * row; `parent` is the dialog it came from (back to it on close).
     */
    showHousesWindow(opts: { town?: string; house?: HouseId; parent?: string } = {}): void {
        const data = DataManager.getData();
        const parent = opts.parent ?? null;
        state = freshState(parent);
        if (opts.town) state.filter.town = placeKey(opts.town);
        this.loadHouses(data);
        if (opts.house) {
            const h = state.byId.get(opts.house);
            if (h) {
                state.open.add(h.id);
                state.filter.town ??= h.townKey;
            }
        }
        const s = strings.houses;
        document.getElementById(MODAL_ID)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = MODAL_ID;
        overlay.innerHTML = `
            <div class="modal houses-modal modal--lg" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="houses-title">
                <div class="modal-header">
                    <h2 id="houses-title">${this.escapeHtml(s.title)}</h2>
                    <button type="button" class="houses-head-more" id="houses-head-more" aria-haspopup="menu" aria-label="${this.escapeHtml(s.headerMenu)}">⋯</button>
                    <button class="close-btn" id="houses-close-x" aria-label="${this.escapeHtml(strings.buttons.close)}">&times;</button>
                </div>
                <p class="houses-intro">${this.escapeHtml(s.intro)}</p>
                <div class="houses-list" id="houses-list"></div>
                <div class="buttons houses-footer">
                    <button type="button" class="houses-terms-link" id="houses-terms-link" aria-expanded="false" aria-controls="houses-terms">${this.escapeHtml(s.terms)}</button>
                    <button type="button" class="secondary" id="houses-close" data-dismiss>${this.escapeHtml(strings.buttons.close)}</button>
                </div>
            </div>`;
        overlay.querySelector('#houses-head-more')?.before(helpMark('houses'));
        document.body.appendChild(overlay);
        const modal = overlay.querySelector('.modal') as HTMLElement;
        normalizeModal(modal);
        const bar = document.createElement('div');
        bar.className = 'places-bar houses-bar';
        bar.innerHTML = `
            <div class="hm-search">
                <svg class="hm-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>
                <input type="search" id="houses-filter" autocomplete="off" spellcheck="false" enterkeyhint="search"
                       placeholder="${this.escapeHtml(s.searchPh)}" aria-label="${this.escapeHtml(s.searchPh)}">
                <span class="hm-search-count" id="houses-filter-count" aria-live="polite"></span>
                <button type="button" class="hm-search-clear" id="houses-filter-clear" hidden aria-label="${this.escapeHtml(s.searchClear)}">&times;</button>
            </div>
            <span class="houses-town-chip-host"></span>
            <button type="button" class="places-chip sel-opt houses-history-chip" id="houses-only-history" aria-pressed="false">${this.escapeHtml(s.onlyHistory)}</button>
            <select class="places-sort" id="houses-sort" aria-label="${this.escapeHtml(s.sortLabel)}" title="${this.escapeHtml(s.sortLabel)}">
                ${([['number', s.sortNumber], ['oldest', s.sortOldest], ['people', s.sortPeople]] as const)
                    .map(([v, label]) => `<option value="${v}">${this.escapeHtml(label)}</option>`).join('')}
            </select>
            <span class="houses-count" id="houses-count"></span>`;
        modal.insertBefore(bar, modal.querySelector(':scope > .modal-content'));
        this.bindHousesWindow(overlay);

        // Back to the dialog it came from on close; a parent already in the stack (Places opened
        // from the tree's menu) keeps the dialogs under it.
        if (parent && this.dialogStack.includes(parent)) {
            this.dialogStack = this.dialogStack.slice(0, this.dialogStack.indexOf(parent) + 1);
        } else {
            this.clearDialogStack();
            if (parent) this.pushDialog(parent);
        }
        if (parent) this.closeDialogById(parent);
        this.pushDialog(MODAL_ID);
        this.renderHousesList();
        if (opts.house) {
            const row = overlay.querySelector<HTMLElement>(`.house-row[data-house="${CSS.escape(opts.house)}"]`);
            row?.scrollIntoView({ block: 'center' });
        }
    },

    /** The houses of the tree with the research's numbers, and their search texts. */
    loadHouses(data: StromData): void {
        if (!state) return;
        const houses = collectHouses(data).map(h => {
            const research = this.houseResearchNumbers(h.id, h);
            return research.length ? { ...h, numbers: withResearchNumbers(h, research, data.houses?.[h.id]) } : h;
        });
        state.houses = houses;
        state.byId = new Map(houses.map(h => [h.id, h]));
        state.texts = new Map(houses.map(h => [h.id, houseSearchText(h, data)]));
    },

    bindHousesWindow(overlay: HTMLElement): void {
        const input = overlay.querySelector('#houses-filter') as HTMLInputElement;
        const setQuery = (q: string): void => {
            if (!state) return;
            state.filter.query = q;
            state.shown.clear();
            this.renderHousesList();
        };
        input.addEventListener('input', () => setQuery(input.value));
        input.addEventListener('keydown', (e) => {
            // Escape empties the search first; the next one closes the window.
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                e.stopPropagation();
                input.value = '';
                setQuery('');
            }
        });
        (overlay.querySelector('#houses-filter-clear') as HTMLButtonElement).onclick = () => {
            input.value = '';
            setQuery('');
            input.focus();
        };
        const chip = overlay.querySelector('#houses-only-history') as HTMLButtonElement;
        chip.onclick = () => {
            if (!state) return;
            state.filter.onlyHistory = !state.filter.onlyHistory;
            state.shown.clear();
            this.renderHousesList();
        };
        const sort = overlay.querySelector('#houses-sort') as HTMLSelectElement;
        sort.onchange = () => {
            if (!state) return;
            state.sort = readHousesSort(sort.value);
            state.shown.clear();
            this.renderHousesList();
        };
        const close = (): void => this.closeHousesWindow();
        (overlay.querySelector('#houses-close-x') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#houses-close') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('#houses-terms-link') as HTMLButtonElement).onclick = () => this.toggleHousesTerms();
        const headMore = overlay.querySelector('#houses-head-more') as HTMLButtonElement;
        headMore.onclick = () => this.openHousesMenu(headMore, strings.houses.headerMenu, [
            { key: 'terms', label: strings.houses.terms, run: () => this.toggleHousesTerms(true) },
        ]);
        overlay.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            if (t === overlay) { close(); return; }
            this.housesListClick(t);
        });
    },

    /** A click in the list: a town, More houses, Show more, a person, ⋯, the state column, a row. */
    housesListClick(t: HTMLElement): void {
        if (!state) return;
        const terms = document.getElementById('houses-terms');
        if (terms && !t.closest('#houses-terms, #houses-terms-link, .houses-head-more')) this.toggleHousesTerms(false);
        const townChip = t.closest<HTMLElement>('.houses-town-chip');
        if (townChip) {
            delete state.filter.town;
            state.shown.clear();
            this.renderHousesList();
            (document.getElementById('houses-filter') as HTMLInputElement | null)?.focus();
            return;
        }
        if (t.closest('.houses-empty-clear')) {
            state.filter.query = '';
            state.filter.onlyHistory = false;
            const input = document.getElementById('houses-filter') as HTMLInputElement | null;
            if (input) input.value = '';
            this.renderHousesList();
            input?.focus();
            return;
        }
        const town = t.closest<HTMLElement>('.house-town-h');
        if (town) {
            const key = town.closest<HTMLElement>('.house-town')?.dataset.town ?? '';
            if (state.closedTowns.has(key)) state.closedTowns.delete(key); else state.closedTowns.add(key);
            this.renderHousesList();
            return;
        }
        const moreH = t.closest<HTMLElement>('.house-more-h');
        if (moreH) {
            const key = moreH.closest<HTMLElement>('.house-town')?.dataset.town ?? '';
            if (state.moreOpen.has(key)) state.moreOpen.delete(key); else state.moreOpen.add(key);
            this.renderHousesList();
            return;
        }
        const load = t.closest<HTMLElement>('.houses-load-more');
        if (load) {
            this.loadMoreHouses(load);
            return;
        }
        const person = t.closest<HTMLElement>('[data-person-id]');
        if (person) {
            const id = person.dataset.personId ?? '';
            this.closeHousesWindow(false);
            this.focusFromMap(id);
            return;
        }
        const research = t.closest<HTMLElement>('.house-research');
        if (research) {
            const h = state.byId.get(research.closest<HTMLElement>('.house-detail')?.dataset.house ?? '');
            if (h) this.houseResearchDetailClick(t, h);
            return;
        }
        const records = t.closest<HTMLElement>('.house-more-records');
        if (records) {
            const id = records.closest<HTMLElement>('.house-detail')?.dataset.house ?? '';
            state.allRecords.add(id);
            this.redrawHouseRow(id);
            return;
        }
        const rowEl = t.closest<HTMLElement>('.house-row');
        const house = rowEl ? state.byId.get(rowEl.dataset.house ?? '') : undefined;
        if (!rowEl || !house) return;
        const more = t.closest<HTMLElement>('.house-more-btn');
        if (more) {
            this.openHouseRowMenu(more, house);
            return;
        }
        const side = t.closest<HTMLElement>('.house-side');
        if (side && this.houseStateSlotClick(t, house)) return;
        if (t.closest('a, input, select')) return;
        if (state.open.has(house.id)) state.open.delete(house.id); else state.open.add(house.id);
        this.redrawHouseRow(house.id);
    },

    /** Draw the list (towns, rows, the counts and the empty state) from the state. */
    renderHousesList(): void {
        const list = document.getElementById('houses-list');
        if (!state || !list) return;
        state.observer?.disconnect();
        state.observer = null;
        const s = strings.houses;
        const lang = getCurrentLanguage();
        const result = houseTownGroups(state.houses, state.filter, state.sort, state.texts, lang);
        const ids = state.filter.town || result.groups.length ? this.placeIdentitiesNowSafe(result.groups.map(g => g.townKey)) : new Map<string, string>();
        // The bar: search count, town chip, chip state, the sort, the totals.
        const q = state.filter.query.trim();
        const count = document.getElementById('houses-filter-count');
        if (count) count.textContent = q ? s.searchCount(result.shown, result.total) : '';
        const clear = document.getElementById('houses-filter-clear');
        if (clear) clear.hidden = !q;
        const chip = document.getElementById('houses-only-history');
        chip?.setAttribute('aria-pressed', String(state.filter.onlyHistory));
        const sort = document.getElementById('houses-sort') as HTMLSelectElement | null;
        if (sort) sort.value = state.sort;
        const totals = document.getElementById('houses-count');
        if (totals) totals.textContent = s.count(result.shown, result.towns);
        const host = document.querySelector('#houses-modal .houses-town-chip-host');
        if (host) {
            const town = state.filter.town ? state.houses.find(h => h.townKey === state!.filter.town)?.ref.town ?? state.filter.town : '';
            host.innerHTML = town
                ? `<button type="button" class="places-chip sel-opt houses-town-chip" aria-pressed="true" title="${this.escapeHtml(s.townAll)}">${this.escapeHtml(s.townOnly(town))}<span class="houses-town-chip-x" aria-hidden="true">&times;</span></button>`
                : '';
        }
        if (result.groups.length === 0) {
            const text = q ? s.empty(q) : s.emptyHistory;
            list.innerHTML = `<div class="houses-empty"><p>${this.escapeHtml(text)}</p>
                <button type="button" class="secondary houses-empty-clear">${this.escapeHtml(s.clearSearch)}</button></div>`;
            return;
        }
        list.innerHTML = result.groups.map(g => this.renderHouseTown(g, ids.get(g.townKey) ?? '')).join('');
        this.watchHousesLoadMore(list);
    },

    /** Today's district of the towns, from the research's place records (none without them). */
    placeIdentitiesNowSafe(townKeys: readonly string[]): Map<string, string> {
        const out = new Map<string, string>();
        if (!townKeys.length || !this.placesResearchContext().researchId) return out;
        try {
            const ids = this.placeIdentitiesNow(townKeys);
            for (const k of townKeys) {
                const d = ids.get(k)?.today?.district;
                if (d) out.set(k, districtText(d, getCurrentLanguage()));
            }
        } catch { /* no identities: no district */ }
        return out;
    },

    renderHouseTown(g: HouseTownGroup, district: string): string {
        if (!state) return '';
        const s = strings.houses;
        const closed = state.closedTowns.has(g.townKey);
        const searching = !!state.filter.query.trim();
        const full = [district, s.townMeta(g.withHistory, g.numbers, g.persons)].filter(Boolean).join(' · ');
        const short = s.townMetaShort(g.withHistory, g.numbers);
        const meta = searching ? [district, s.searchCount(g.houses.length + g.more.length, g.total)].filter(Boolean).join(' · ') : full;
        const limit = state.shown.get(g.townKey) ?? HOUSES_BATCH;
        const rows = g.houses.slice(0, limit).map(h => this.renderHouseRowHtml(h)).join('');
        const rest = g.houses.length - Math.min(limit, g.houses.length);
        const moreOpen = state.moreOpen.has(g.townKey) || (searching && g.houses.length === 0);
        const moreLimit = state.shown.get(`${g.townKey}\u0000more`) ?? HOUSES_BATCH;
        const more = g.more.length ? `
            <div class="house-more">
                <button type="button" class="house-more-h" aria-expanded="${moreOpen}">
                    <span class="tw" aria-hidden="true">${moreOpen ? '▾' : '▸'}</span>${this.escapeHtml(s.more(g.more.length))}<span class="c"> · ${this.escapeHtml(s.moreWhy)}</span>
                </button>
                ${moreOpen ? `<div class="house-more-list">
                    ${g.more.slice(0, moreLimit).map(h => this.renderHouseRowHtml(h, true)).join('')}
                    ${g.more.length > moreLimit ? this.loadMoreHtml(`${g.townKey}\u0000more`, g.more.length - moreLimit) : ''}
                </div>` : ''}
            </div>` : '';
        return `
            <section class="house-town${closed ? ' is-closed' : ''}" data-town="${this.escapeHtml(g.townKey)}">
                <button type="button" class="house-town-h" aria-expanded="${!closed}">
                    <span class="t">${this.escapeHtml(g.town)}</span>
                    <span class="c"><span class="c-full">${this.escapeHtml(meta)}</span><span class="c-short">${this.escapeHtml(searching ? meta : short)}</span></span>
                    <span class="tw" aria-hidden="true">${closed ? '▸' : '▾'}</span>
                </button>
                ${closed ? '' : `<div class="house-town-list">${rows}${rest > 0 ? this.loadMoreHtml(g.townKey, rest) : ''}</div>${more}`}
            </section>`;
    },

    loadMoreHtml(key: string, rest: number): string {
        return `<button type="button" class="houses-load-more" data-key="${this.escapeHtml(key)}">${this.escapeHtml(strings.houses.loadMore(rest))}</button>`;
    },

    /** "Show more": the next batch of rows of that town (or of its More houses). */
    loadMoreHouses(btn: HTMLElement): void {
        if (!state) return;
        const key = btn.dataset.key ?? '';
        state.shown.set(key, (state.shown.get(key) ?? HOUSES_BATCH) + HOUSES_BATCH);
        const list = document.getElementById('houses-list');
        const top = list?.closest('.modal-content')?.scrollTop ?? 0;
        this.renderHousesList();
        const content = document.getElementById('houses-list')?.closest('.modal-content');
        if (content) content.scrollTop = top;
    },

    /** The next batch comes by itself when "Show more" scrolls into view. */
    watchHousesLoadMore(list: HTMLElement): void {
        if (!state || typeof IntersectionObserver === 'undefined') return;
        const buttons = list.querySelectorAll<HTMLElement>('.houses-load-more');
        if (!buttons.length) return;
        const root = list.closest('.modal-content');
        state.observer = new IntersectionObserver((entries) => {
            const hit = entries.find(e => e.isIntersecting);
            if (hit) this.loadMoreHouses(hit.target as HTMLElement);
        }, { root, rootMargin: '200px' });
        buttons.forEach(b => state!.observer!.observe(b));
    },

    /** A row (with its detail when open); `simple`: a house below the threshold. */
    renderHouseRowHtml(h: TreeHouse, simple = false): string {
        if (!state) return '';
        const s = strings.houses;
        const open = state.open.has(h.id);
        const data = DataManager.getData();
        const former = houseFormerNumbers(h, h.numbers);
        const fromResearch = h.numbers.some(n => n.source === 'research');
        const was = former.length
            ? ` <span class="was"${fromResearch ? ` title="${this.escapeHtml(s.probablySame)}"` : ''}>${this.escapeHtml(s.was(former.join(', ')))}</span>` : '';
        const name = h.name ? `<span class="hn">${this.escapeHtml(h.name)}</span>` : '';
        const detailId = `house-detail-${this.housesDomId(h.id)}`;
        const chev = `<button type="button" class="house-chev" aria-expanded="${open}" aria-controls="${detailId}" aria-label="${this.escapeHtml(houseLabel(h))}">${open ? '▾' : '▸'}</button>`;
        const no = `<span class="house-no"><b>${this.escapeHtml(h.text)}</b>${was}${name}</span>`;
        if (simple) {
            const first = h.personIds[0] ? data.persons[h.personIds[0]] : undefined;
            const line = [first ? shownName(first) : '', yearsText(h)].filter(Boolean).join(' · ');
            return `
                <div class="house-row house-simple${open ? ' open' : ''}" data-house="${this.escapeHtml(h.id)}">
                    ${chev}${no}<span class="house-main"><span class="l1">${this.escapeHtml(line)}</span></span>
                </div>${open ? this.renderHouseDetailHtml(h, detailId) : ''}`;
        }
        const query = foldSearch(state.filter.query.trim());
        const seq = h.surnames.map(n => {
            const text = this.escapeHtml(n);
            return query && query.split(/\s+/).some(w => w && foldSearch(n).includes(w)) ? `<mark>${text}</mark>` : text;
        }).join(' <span class="ar">→</span> ');
        const married = h.marriedIn.map(m => {
            const p = data.persons[m.personId];
            if (!p) return '';
            return `<span class="house-tag">${this.escapeHtml(m.sex === 'f' ? s.marriedInF : s.marriedInM)} <span class="nm">${this.escapeHtml(shownName(p))}</span></span>`;
        }).filter(Boolean);
        const side = this.renderHouseStateSlot(h);
        const readOnly = DataManager.isReadOnly();
        const menu = readOnly && !this.houseMenuResearchItems(h).length ? '' :
            `<button type="button" class="house-more-btn" aria-haspopup="menu" aria-label="${this.escapeHtml(s.rowMenu(houseLabel(h)))}">⋯</button>`;
        return `
            <div class="house-row${open ? ' open' : ''}${side ? ' has-side' : ''}" data-house="${this.escapeHtml(h.id)}">
                ${chev}${no}
                <span class="house-main">
                    <span class="l1"><span class="per">${this.escapeHtml(yearsText(h))}</span> <span class="seq">${seq}</span></span>
                    <span class="l2"><span class="l2-n">${this.escapeHtml(`${s.persons(h.persons)} · ${s.generations(h.generations)}`)}</span>${married.join('')}</span>
                </span>
                ${side ? `<span class="house-side">${side}</span>` : ''}
                ${menu}
            </div>${open ? this.renderHouseDetailHtml(h, detailId) : ''}`;
    },

    housesDomId(id: HouseId): string {
        return foldSearch(id).replace(/[^a-z0-9]+/g, '-');
    },

    /** The detail of an open row: the interesting facts, then the people by year. */
    renderHouseDetailHtml(h: TreeHouse, domId: string): string {
        if (!state) return '';
        const s = strings.houses;
        const data = DataManager.getData();
        const facts = houseInteresting(h).map(it => it.kind === 'family' ? s.family(it.years)
            : it.kind === 'numbers' ? s.numbers(it.count) : s.oldest(it.year)).join(' · ');
        const line = facts ? facts.charAt(0).toLocaleUpperCase(getCurrentLanguage()) + facts.slice(1) : '';
        const groups = this.houseRecordGroups(h);
        const all = state.allRecords.has(h.id);
        const shown = all ? groups : groups.slice(0, HOUSE_DETAIL_ROWS);
        const rows = shown.map(g => {
            const names = g.persons.map(pid => {
                const p = data.persons[pid];
                return p ? `<button type="button" class="p" data-person-id="${this.escapeHtml(pid)}" title="${this.escapeHtml(s.showInTree)}">${this.escapeHtml(shownName(p))}</button>` : '';
            }).filter(Boolean);
            return `<div class="house-person"><span class="y">${g.year ?? '—'}</span><span class="e">${this.escapeHtml(g.label)}</span><span class="ps">${this.joinNamesHtml(names)}</span></div>`;
        }).join('');
        const rest = groups.length - shown.length;
        return `
            <div class="house-detail" id="${domId}" data-house="${this.escapeHtml(h.id)}">
                ${line ? `<p class="house-facts">${this.escapeHtml(line)}</p>` : ''}
                <div class="house-people">${rows}</div>
                ${rest > 0 ? `<button type="button" class="house-more-records">${this.escapeHtml(s.moreRecords(rest))}</button>` : ''}
                ${this.renderHouseResearchDetail(h)}
            </div>`;
    },

    joinNamesHtml(names: string[]): string {
        if (names.length <= 1) return names[0] ?? '';
        const lang = getCurrentLanguage();
        const and = joinAnd(lang, ['\u0001', '\u0002']).replace('\u0001', '').replace('\u0002', '');
        return `${names.slice(0, -1).join(', ')}${this.escapeHtml(and)}${names[names.length - 1]}`;
    },

    /** The house's records as rows: one per fact (a wedding with both partners), by year. */
    houseRecordGroups(h: TreeHouse): { year?: number; label: string; persons: PersonId[] }[] {
        const data = DataManager.getData();
        const s = strings.houses;
        const married = new Map(h.marriedIn.map(m => [m.personId, m.sex]));
        const groups = new Map<string, { year?: number; label: string; persons: PersonId[] }>();
        for (const f of houseFacts(h)) {
            const g = groups.get(f.factRef);
            if (g) {
                if (!g.persons.includes(f.personId)) g.persons.push(f.personId);
                continue;
            }
            groups.set(f.factRef, { year: f.year, label: '', persons: [f.personId] });
        }
        for (const [ref, g] of groups) {
            const fact = houseFacts(h).find(f => f.factRef === ref)!;
            g.label = this.houseFactLabel(fact, data);
            if (fact.kind === 'marriage') {
                const inPerson = g.persons.find(p => married.has(p));
                if (inPerson) g.label += ` · ${married.get(inPerson) === 'f' ? s.marriedInF : s.marriedInM}`;
            }
        }
        return [...groups.values()];
    },

    /** What a record is: born, died, marriage, census, residence or the event's own name. */
    houseFactLabel(f: HouseFact, data: StromData): string {
        const ev = strings.houses.ev;
        const p = data.persons[f.personId];
        const fem = femaleOf(p);
        if (f.kind === 'birth') return fem ? ev.bornF : ev.bornM;
        if (f.kind === 'death') return fem ? ev.diedF : ev.diedM;
        if (f.kind === 'marriage') return ev.marriage;
        if (f.kind === 'census') return ev.census;
        if (f.kind === 'residence') return ev.residence;
        const [kind, id] = [f.factRef.slice(0, f.factRef.indexOf(':')), f.factRef.slice(f.factRef.indexOf(':') + 1)];
        if (kind === 'event') {
            const e = p?.events?.find(x => x.id === id);
            if (e) return eventTypeLabel(e);
        }
        if (kind === 'coupleEvent') {
            for (const u of Object.values(data.partnerships)) {
                const e = u.events?.find(x => x.id === id);
                if (e) return coupleEventLabel(e);
            }
        }
        return ev.event;
    },

    /** Draw one row again (opened, closed, all its records) without the rest of the list. */
    redrawHouseRow(id: HouseId): void {
        if (!state) return;
        const h = state.byId.get(id);
        const row = document.querySelector<HTMLElement>(`#houses-modal .house-row[data-house="${CSS.escape(id)}"]`);
        if (!h || !row) return;
        const detail = row.nextElementSibling?.classList.contains('house-detail') ? row.nextElementSibling : null;
        const tmp = document.createElement('div');
        tmp.innerHTML = this.renderHouseRowHtml(h, row.classList.contains('house-simple'));
        detail?.remove();
        row.replaceWith(...tmp.childNodes);
        document.querySelector<HTMLElement>(`#houses-modal .house-row[data-house="${CSS.escape(id)}"] .house-chev`)?.focus({ preventScroll: true });
    },

    // ==================== MENUS ====================

    openHouseRowMenu(btn: HTMLElement, h: TreeHouse): void {
        const s = strings.houses;
        const research = this.houseMenuResearchItems(h);
        const own: HouseMenuItem[] = DataManager.isReadOnly() ? [] : [
            { key: 'merge', label: s.merge, run: () => this.showHouseMergeDialog(h.id) },
            ...(this.houseSplitCandidates(h).length ? [{ key: 'split', label: s.split, run: () => this.showHouseSplitDialog(h.id) }] : []),
        ];
        this.openHousesMenu(btn, s.rowMenu(houseLabel(h)), research, own);
    },

    /** A small `.context-menu` under its button: arrows move, Enter runs, Escape or a press outside closes it. */
    openHousesMenu(btn: HTMLElement, title: string, items: HouseMenuItem[], after: HouseMenuItem[] = []): void {
        if (!state) return;
        state.closeMenu?.();
        const all = [...items, ...after];
        if (!all.length) return;
        const menu = document.createElement('div');
        menu.className = 'context-menu houses-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', title);
        const rows: HTMLElement[] = [];
        const add = (it: HouseMenuItem): void => {
            const row = document.createElement('div');
            row.className = 'context-menu-item';
            row.setAttribute('role', 'menuitem');
            row.tabIndex = -1;
            row.dataset.action = it.key;
            row.textContent = it.label;
            menu.appendChild(row);
            rows.push(row);
        };
        items.forEach(add);
        if (items.length && after.length) {
            const hr = document.createElement('div');
            hr.className = 'context-menu-divider';
            hr.setAttribute('role', 'separator');
            menu.appendChild(hr);
        }
        after.forEach(add);
        (btn.closest('.modal-overlay') ?? document.body).appendChild(menu);
        const M = 8, w = menu.offsetWidth, hgt = menu.offsetHeight;
        const r = btn.getBoundingClientRect();
        let x = r.right - w, y = r.bottom + 4;
        if (x < M) x = M;
        if (x + w > window.innerWidth - M) x = Math.max(M, window.innerWidth - M - w);
        if (y + hgt > window.innerHeight - M) y = Math.max(M, r.top - hgt - 4);
        menu.style.left = `${Math.round(x)}px`;
        menu.style.top = `${Math.round(y)}px`;
        btn.setAttribute('aria-expanded', 'true');
        let open = true;
        const close = (focusBack: boolean): void => {
            if (!open) return;
            open = false;
            window.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('resize', onAway);
            menu.remove();
            btn.setAttribute('aria-expanded', 'false');
            if (state) state.closeMenu = null;
            if (focusBack && btn.isConnected) btn.focus({ preventScroll: true });
        };
        const run = (row: HTMLElement): void => {
            const it = all.find(x => x.key === row.dataset.action);
            close(false);
            it?.run();
        };
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = (e.target as Element).closest<HTMLElement>('[role="menuitem"]');
            if (row) run(row);
        });
        const onKey = (e: KeyboardEvent): void => {
            const i = rows.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
            if (e.key === 'Tab') { e.preventDefault(); close(true); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
                e.preventDefault(); e.stopPropagation();
                const n = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
                    : (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
                rows[n]?.focus();
                return;
            }
            if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); e.stopPropagation(); run(rows[i]); }
        };
        const onDown = (e: PointerEvent): void => {
            if (!menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close(false);
        };
        const onAway = (): void => close(false);
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('resize', onAway);
        state.closeMenu = () => close(false);
        rows[0]?.focus({ preventScroll: true });
    },

    /** The glossary panel over the footer (open / close / toggle). */
    toggleHousesTerms(force?: boolean): void {
        const modal = document.querySelector('#houses-modal .houses-modal');
        if (!modal) return;
        const link = document.getElementById('houses-terms-link');
        const existing = document.getElementById('houses-terms');
        const want = force ?? !existing;
        if (!want) {
            existing?.remove();
            link?.setAttribute('aria-expanded', 'false');
            return;
        }
        if (existing) return;
        const s = strings.houses;
        const panel = document.createElement('div');
        panel.className = 'houses-terms';
        panel.id = 'houses-terms';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', s.terms);
        panel.tabIndex = -1;
        panel.innerHTML = `<h3>${this.escapeHtml(s.terms)}</h3><dl>${s.glossary.map(g =>
            `<dt>${this.escapeHtml(g.term)}</dt><dd>${this.escapeHtml(g.text)}</dd>`).join('')}</dl>`;
        modal.appendChild(panel);
        link?.setAttribute('aria-expanded', 'true');
        panel.focus({ preventScroll: true });
    },

    // ==================== MERGE / SPLIT ====================

    /** The numbers that can be told apart from a house: those joined into it, the research's. */
    houseSplitCandidates(h: TreeHouse): { id: HouseId; text: string; research?: HouseResearchNumber }[] {
        const out: { id: HouseId; text: string; research?: HouseResearchNumber }[] = [];
        const seen = new Set<HouseId>([h.id]);
        for (const n of h.numbers) {
            const id = `${h.townKey}|${houseKey(n.house)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const research = n.source === 'research' ? this.houseResearchNumbers(h.id).find(r => houseKey(r.number) === houseKey(n.house)) : undefined;
            out.push({ id, text: n.house, ...(research ? { research } : {}) });
        }
        for (const r of this.houseResearchNumbers(h.id)) {
            const id = `${h.townKey}|${houseKey(r.number)}`;
            if (seen.has(id) || !r.proposed) continue;
            seen.add(id);
            out.push({ id, text: r.number, research: r });
        }
        return out;
    },

    /** A small dialog of its own over the window: header ×, body, Cancel + the primary. */
    openHouseSubDialog(id: string, title: string, sub: string, body: string, primary: string): HTMLElement {
        document.getElementById(id)?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active house-sub-overlay';
        overlay.id = id;
        overlay.innerHTML = `
            <div class="modal modal--sm house-sub-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
                <div class="modal-header">
                    <h2 id="${id}-title">${this.escapeHtml(title)}</h2>
                    <button class="close-btn" aria-label="${this.escapeHtml(strings.buttons.close)}">&times;</button>
                </div>
                <p class="house-sub-sub">${this.escapeHtml(sub)}</p>
                ${body}
                <div class="buttons">
                    <button type="button" class="secondary" data-dismiss>${this.escapeHtml(strings.buttons.cancel)}</button>
                    <button type="button" class="primary house-sub-go" disabled>${this.escapeHtml(primary)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        const close = (): void => this.closeHouseSubDialog(id);
        (overlay.querySelector('.close-btn') as HTMLButtonElement).onclick = close;
        (overlay.querySelector('[data-dismiss]') as HTMLButtonElement).onclick = close;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        return overlay;
    },

    closeHouseSubDialog(id: string): void {
        document.getElementById(id)?.remove();
        (document.querySelector('#houses-modal .house-more-btn[aria-expanded="false"]:focus') as HTMLElement | null)?.focus();
    },

    /** "Merge with another house…": the other houses of the town to pick from, with a search. */
    showHouseMergeDialog(id: HouseId): void {
        const h = state?.byId.get(id);
        if (!state || !h) return;
        const s = strings.houses;
        const others = state.houses.filter(x => x.townKey === h.townKey && x.id !== h.id);
        const sub = [houseLabel(h), h.name ? `(${h.name})` : ''].filter(Boolean).join(' ');
        const overlay = this.openHouseSubDialog(MERGE_ID, s.mergeTitle, sub, `
            <p class="house-sub-note">${this.escapeHtml(s.mergeNote)}</p>
            ${others.length ? `<div class="hm-search house-pick-search">
                <input type="search" class="house-pick-q" autocomplete="off" spellcheck="false" placeholder="${this.escapeHtml(s.mergeSearchPh)}" aria-label="${this.escapeHtml(s.mergeSearchPh)}">
            </div>
            <div class="house-pick" role="listbox" aria-label="${this.escapeHtml(s.mergeTitle)}"></div>
            <p class="house-pick-after" aria-live="polite"></p>` : `<p class="house-sub-note">${this.escapeHtml(s.mergeNone)}</p>`}`, s.mergeBtn);
        const list = overlay.querySelector('.house-pick') as HTMLElement | null;
        const after = overlay.querySelector('.house-pick-after') as HTMLElement | null;
        const go = overlay.querySelector('.house-sub-go') as HTMLButtonElement;
        let picked: TreeHouse | null = null;
        const data = DataManager.getData();
        const draw = (q: string): void => {
            if (!list) return;
            const shown = others.filter(o => houseMatches(o, q, state?.texts.get(o.id)));
            list.innerHTML = shown.map(o => {
                const first = o.personIds[0] ? data.persons[o.personIds[0]] : undefined;
                const years = [...new Set(o.facts.map(f => f.year).filter((y): y is number => y !== undefined))].slice(0, 3).join(', ');
                const on = picked?.id === o.id;
                return `<button type="button" class="r sel-opt" data-sel-form="row" role="option" aria-selected="${on}" data-house="${this.escapeHtml(o.id)}">
                    <span class="n">${this.escapeHtml(o.text)}</span>
                    <span class="w">${this.escapeHtml([first ? shownName(first) : '', years].filter(Boolean).join(' · '))}</span>
                    <span class="t">${this.escapeHtml(o.ref.town)}</span>
                </button>`;
            }).join('');
        };
        draw('');
        const q = overlay.querySelector('.house-pick-q') as HTMLInputElement | null;
        q?.addEventListener('input', () => draw(q.value));
        list?.addEventListener('click', (e) => {
            const r = (e.target as HTMLElement).closest<HTMLElement>('.r');
            const o = r ? others.find(x => x.id === r.dataset.house) : undefined;
            if (!o) return;
            picked = o;
            for (const el of list.querySelectorAll<HTMLElement>('.r')) el.setAttribute('aria-selected', String(el.dataset.house === o.id));
            const label = `${h.text} ${s.was([...houseFormerNumbers(h, h.numbers), shortNumber(o.text)].join(', '))}`;
            if (after) after.textContent = s.mergeAfter(label, houseFacts(o).length);
            go.disabled = false;
        });
        go.onclick = () => {
            if (!picked) return;
            const changes = mergeHouseChanges(DataManager.getData().houses, h.id, picked.id);
            this.closeHouseSubDialog(MERGE_ID);
            if (DataManager.setHousesUserData(changes, houseLabel(h))) this.refreshHousesWindow();
        };
        (q ?? go).focus();
    },

    /** "It is a different house…": which number leaves, and (with the research) its answer. */
    showHouseSplitDialog(id: HouseId): void {
        const h = state?.byId.get(id);
        if (!state || !h) return;
        const s = strings.houses;
        const candidates = this.houseSplitCandidates(h);
        if (!candidates.length) return;
        const ctx = this.placesResearchContext();
        const canSend = !!ctx.base && houseFeature(ctx.features, 'house.confirm');
        const label = `${h.text}${houseFormerNumbers(h, h.numbers).length ? ` ${s.was(houseFormerNumbers(h, h.numbers).join(', '))}` : ''}`;
        const textOf = (c: (typeof candidates)[number]): string => c.research && !state?.byId.has(c.id) && !houseGroupIds(h).includes(c.id)
            ? s.splitTextResearch(c.text, h.text) : s.splitText(c.text, h.text);
        const choose = candidates.length > 1 ? `
            <fieldset class="house-split-which"><legend>${this.escapeHtml(s.splitWhich)}</legend>
                ${candidates.map((c, i) => `<label><input type="radio" name="house-split-which" value="${i}"${i === 0 ? ' checked' : ''}> ${this.escapeHtml(c.text)}</label>`).join('')}
            </fieldset>` : '';
        const overlay = this.openHouseSubDialog(SPLIT_ID, s.splitTitle, `${h.ref.town} ${label}`, `
            ${choose}
            <p class="house-split-text">${this.escapeHtml(textOf(candidates[0]))}</p>
            ${canSend ? `<label class="house-split-send"><input type="checkbox" checked> <span>${this.escapeHtml(s.splitSend)}<span class="sub">${this.escapeHtml(s.splitSendSub)}</span></span></label>` : ''}`, s.splitBtn);
        const go = overlay.querySelector('.house-sub-go') as HTMLButtonElement;
        go.disabled = false;
        let pick = candidates[0];
        overlay.querySelectorAll<HTMLInputElement>('input[name="house-split-which"]').forEach(r => {
            r.onchange = () => {
                pick = candidates[Number(r.value)] ?? candidates[0];
                (overlay.querySelector('.house-split-text') as HTMLElement).textContent = textOf(pick);
            };
        });
        go.onclick = () => {
            const send = canSend && !!(overlay.querySelector('.house-split-send input') as HTMLInputElement | null)?.checked;
            const changes = splitHouseChanges(DataManager.getData().houses, h.id, pick.id, houseGroupIds(h));
            this.closeHouseSubDialog(SPLIT_ID);
            if (DataManager.setHousesUserData(changes, houseLabel(h))) this.refreshHousesWindow();
            if (send && ctx.base) {
                void confirmHouse(ctx.base, { house: h.id, what: 'notSame', ...(pick.research?.id ? { id: pick.research.id } : {}) }, ctx.features)
                    .then(r => { if (!r.ok) this.showToast(s.splitSendFailed(r.reason || r.code)); });
            }
        };
        go.focus();
    },

    // ==================== CLOSE / REDRAW ====================

    /** Redraw the open window (filter, open rows and scroll kept). */
    refreshHousesWindow(): void {
        if (!state || !document.getElementById(MODAL_ID)) return;
        const content = document.querySelector('#houses-modal .modal-content');
        const top = content?.scrollTop ?? 0;
        this.loadHouses(DataManager.getData());
        for (const id of [...state.open]) if (!state.byId.has(id)) state.open.delete(id);
        if (state.filter.town && !state.houses.some(h => h.townKey === state!.filter.town)) delete state.filter.town;
        this.renderHousesList();
        if (content) content.scrollTop = top;
    },

    /** The tree changed under the open window (Undo, Redo): redraw it, if it is open. */
    housesWindowTreeChanged(): void {
        if (!document.getElementById(MODAL_ID)) return;
        if (!state) return;
        if (!collectHouses(DataManager.getData()).length) { this.closeHousesWindow(); return; }
        this.refreshHousesWindow();
    },

    /** Close the window (its menus and small dialogs too); `back`: return to the dialog it came from. */
    closeHousesWindow(back = true): void {
        state?.closeMenu?.();
        state?.observer?.disconnect();
        document.getElementById(MERGE_ID)?.remove();
        document.getElementById(SPLIT_ID)?.remove();
        document.getElementById(MODAL_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== MODAL_ID);
        state = null;
        if (!back) {
            // To the tree: every dialog under the window closes too (Places is drawn afresh next time).
            for (const id of [...this.dialogStack].reverse()) {
                if (id === 'places-modal') document.getElementById(id)?.remove();
                else this.closeFloatingDialog(id);
            }
            this.clearDialogStack();
            return;
        }
        const parent = this.dialogStack[this.dialogStack.length - 1];
        if (parent) this.openDialogById(parent);
    },

    /**
     * Escape in the window (`topId`: the top dialog): a small dialog closes
     * first, then the glossary, then the window. False: not the window's.
     */
    housesEscape(topId: string | undefined): boolean {
        if (topId === MERGE_ID || topId === SPLIT_ID) {
            this.closeHouseSubDialog(topId);
            return true;
        }
        if (topId !== MODAL_ID) return false;
        if (document.getElementById('houses-terms')) {
            this.toggleHousesTerms(false);
            document.getElementById('houses-terms-link')?.focus();
            return true;
        }
        this.closeHousesWindow();
        return true;
    },

    /** "Houses of the town ›" (Places dialog, the map's town bubble): the window on that town. */
    showTownHouses(town: string, parent?: string): void {
        this.showHousesWindow({ town, ...(parent ? { parent } : {}) });
    },
});

/** The houses of a town in the tree (for "Houses of the town ›"): their count. */
export function townHouseCount(data: StromData, town: string): number {
    const key = placeKey(town);
    return collectHouses(data).filter(h => h.townKey === key).length;
}

export type { HouseNumber };
