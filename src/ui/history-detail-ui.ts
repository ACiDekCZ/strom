/**
 * History of places — a detail in the manager (#history-modal, spec 1028 §2,
 * §3.1, §3.2, §3.7): the events of a region, of the research's local findings
 * or of a place's own history, with filters, centuries, "who sees it", the
 * event's menu (hide in the tree, at a place, for a person; delete) and the
 * delete confirmation.
 *
 * The frame (back, title, state) is history-manage-ui.ts; it calls
 * `renderHistoryRegionDetail` for the body. The pure model is
 * src/history-manage.ts. Filters, folded centuries and opened excerpts are
 * remembered only while the dialog stays open.
 */

import { strings, getCurrentLanguage, type Language } from '../strings.js';
import { DataManager } from '../data.js';
import { shownName } from '../person-name.js';
import { yearOf } from '../dates.js';
import { MQ_MOBILE } from '../breakpoints.js';
import { HISTORY_KINDS, type HistoryPayload, type HistoryEvent, type HistoryHideOp, type EffectiveHidden } from '../history.js';
import {
    detailEvents, detailOwner, filterDetailEvents, detailFacets, detailCenturies, centuryGroups, centuryLabel,
    emptyDetailFilter, historyAudience, audiencePlaces, manageCan, regionName,
    type DetailEvent, type DetailFilter, type EventAudience, type RegionRow,
} from '../history-manage.js';
import { postBridgeDelete, type HistoryWriteRefusal } from '../history-bridge.js';
import type { StromData, PersonId } from '../types.js';
import { HISTORY_MANAGE_DIALOG_ID } from './history-ui.js';
import { historyEventDescHtml } from './history-card-ui.js';
import { historyKindSvg } from '../history-symbols.js';
import type { Drawn } from './history-manage-ui.js';
import { uiModule } from './module.js';

/** Persons shown in "who sees it" before "n more ›". */
const WHO_FIRST = 6;
/** From this many persons the second level "Hide for one person only" has a search. */
const PERSON_SEARCH_FROM = 10;
/** A hiding's toast. */
const HIDE_TOAST_MS = 6000;

interface DetailMemory {
    filters: Map<string, DetailFilter>;
    /** Centuries the viewer folded or unfolded, by detail. */
    toggled: Map<string, Set<number>>;
    /** Details whose period is a custom range. */
    custom: Set<string>;
    quotes: Set<string>;
    /** A sentence under an event (busy, retracted). */
    notes: Map<string, string>;
    busy: Set<string>;
    /** Deleted here, gone from the list before the copy is read again. */
    gone: Set<string>;
    /** Phone: the search field over the chips. */
    searchOpen: boolean;
}

function freshMemory(): DetailMemory {
    return {
        filters: new Map(), toggled: new Map(), custom: new Set(), quotes: new Set(), notes: new Map(),
        busy: new Set(), gone: new Set(), searchOpen: false,
    };
}

let mem: DetailMemory = freshMemory();

/** Who sees each event, for one payload, queue, tree and language. */
let audienceCache: { payload: HistoryPayload; queue: string; data: StromData; lang: string; map: Map<string, EventAudience> } | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function lang(): Language {
    return getCurrentLanguage();
}

function media(query: string): boolean {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
}

function nowIso(): string {
    return new Date().toISOString();
}

function cap(s: string): string {
    return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

function filterOf(key: string): DetailFilter {
    let f = mem.filters.get(key);
    if (!f) { f = emptyDetailFilter(); mem.filters.set(key, f); }
    return f;
}

function audienceOf(d: Drawn): Map<string, EventAudience> {
    const p = d.payload!;
    const data = DataManager.getData();
    const queue = JSON.stringify(d.env.queue ?? []);
    const l = d.env.lang;
    if (audienceCache && audienceCache.payload === p && audienceCache.queue === queue && audienceCache.data === data && audienceCache.lang === l) {
        return audienceCache.map;
    }
    const map = historyAudience(data, p, l, { queue: d.env.queue ?? [] });
    audienceCache = { payload: p, queue, data, lang: l, map };
    return map;
}

function personYears(id: string): string {
    const person = DataManager.getPerson(id as PersonId);
    if (!person) return '';
    const b = yearOf(person.birthDate);
    const dd = yearOf(person.deathDate);
    if (b === null && dd === null) return '';
    return `${b ?? '?'}–${dd ?? ''}`;
}

function personName(id: string): string {
    const person = DataManager.getPerson(id as PersonId);
    return person ? shownName(person) : id;
}

/** A chip of a kind (not "All", not a place) carries the kind's symbol before its name. */
function kindChip(by: 'kinds' | 'places', key: string): boolean {
    return by === 'kinds' && (HISTORY_KINDS as readonly string[]).includes(key);
}

export const historyDetailMethods = uiModule({
    /** The dialog opens or closes: nothing of the details stays. */
    resetHistoryDetail(): void {
        mem = freshMemory();
        audienceCache = null;
    },

    /** The detail's rows (without the events deleted here a moment ago). */
    historyDetailRows(d: Drawn, key: string): DetailEvent[] {
        return detailEvents(d.payload!, d.env, d.names, key).filter(r => !mem.gone.has(r.ev.id));
    },

    /**
     * The detail's head (§2.1): its sub-line, the state sentence and the gaps.
     * Region: "Done · 52 events · completed 28. 10. 2026 · 3 hidden"; place: its
     * area and state; the local findings: what they are.
     */
    historyDetailHead(d: Drawn, key: string, row: RegionRow | undefined): { sub: string; state: string; gaps: string } {
        const h = strings.history;
        const owner = detailOwner(key);
        const rows = d.payload ? this.historyDetailRows(d, key) : [];
        const hidden = rows.filter(r => r.hide !== 'none').length;
        if (owner.kind === 'local') return { sub: h.detailLocalSub, state: h.detailLocalNote(rows.length), gaps: '' };
        if (owner.kind === 'place') {
            return { sub: h.kindPlace, state: [row?.meta, row?.state, row?.why].filter(Boolean).join(' · '), gaps: '' };
        }
        const region = d.payload?.regions?.[key];
        const parts: string[] = [];
        if (region?.state === 'done') {
            parts.push(h.rsDone(''), h.placeEvents(rows.length));
            if (region.at) parts.push(h.detailDoneOn(d.env.formatDate(region.at)));
        } else {
            if (row?.state) parts.push(row.state);
            if (row?.why) parts.push(row.why);
            if (rows.length) parts.push(h.placeEvents(rows.length));
        }
        if (hidden) parts.push(h.regionHidden(hidden));
        return { sub: row?.parent ?? '', state: parts.join(' · '), gaps: row?.gaps ?? '' };
    },

    /** The detail's body (§2.2, §2.3): filters and the events. */
    renderHistoryRegionDetail(el: HTMLElement, key: string, d: Drawn): void {
        if (!d.payload) return;
        const all = this.historyDetailRows(d, key);
        const shown = filterDetailEvents(all, filterOf(key));
        el.dataset.key = key;
        el.innerHTML = (all.length ? this.historyDetailFilters(d, key, all) : '')
            + `<div class="hd-list">${this.historyDetailList(d, key, all, shown)}</div>`;
        if (el.dataset.wired) return;
        el.dataset.wired = '1';
        el.addEventListener('click', (e) => this.historyDetailClick(e, el));
        el.addEventListener('input', (e) => {
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-hd="q"]');
            if (!input) return;
            filterOf(el.dataset.key ?? '').query = input.value;
            this.renderHistoryManage();
        });
        el.addEventListener('change', (e) => this.historyDetailChange(e, el));
        el.addEventListener('keydown', (e) => {
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-hd="q"]');
            if (input && e.key === 'Escape' && (input.value || mem.searchOpen)) {
                e.preventDefault();
                e.stopPropagation();
                filterOf(el.dataset.key ?? '').query = '';
                const wasOpen = mem.searchOpen;
                mem.searchOpen = false;
                this.renderHistoryManage();
                if (wasOpen) document.querySelector<HTMLElement>(`#${HISTORY_MANAGE_DIALOG_ID} [data-hfocus="m:search"]`)?.focus();
            }
        });
    },

    /** Filters: desktop and tablet in two rows; a phone one row of chips (the sheet does the rest). */
    historyDetailFilters(d: Drawn, key: string, all: DetailEvent[]): string {
        const h = strings.history;
        const owner = detailOwner(key);
        const f = filterOf(key);
        const by = owner.kind === 'local' ? 'places' as const : 'kinds' as const;
        const chosen = by === 'kinds' ? f.kinds : f.places;
        const facets = detailFacets(all, f, by, d.names);
        const hiddenN = all.filter(r => r.hide !== 'none').length;
        const chip = (k: string, label: string, n: number | null, on: boolean): string =>
            `<button type="button" class="hd-chip" data-hd="facet" data-by="${by}" data-k="${esc(k)}" aria-pressed="${on}" data-hfocus="f:${esc(k)}"`
            + `${kindChip(by, k) ? ` title="${esc(label)}"` : ''}>`
            + `${kindChip(by, k) ? historyKindSvg(k as HistoryEvent['kind'], 12) : ''}${esc(label)}${n === null ? '' : ` <span class="hd-chip-n">${n}</span>`}</button>`;
        const chips = facets.length > 1 || chosen.length
            ? `<div class="hd-chips" role="group" aria-label="${esc(by === 'kinds' ? h.filterKind : h.filterPlace)}">`
                + chip('', h.filterAll, null, !chosen.length)
                + facets.map(x => chip(x.key, by === 'kinds' ? cap(h.kinds[x.key as HistoryEvent['kind']] ?? x.key) : x.label, x.count, chosen.includes(x.key))).join('')
                + '</div>'
            : '';
        const centuries = detailCenturies(all);
        const custom = mem.custom.has(key);
        const periodValue = custom ? 'custom' : f.from === undefined && f.to === undefined ? '' : `c:${Math.floor((f.from ?? 0) / 100)}`;
        const period = `<label class="hd-period"><span>${esc(h.filterPeriod)}:</span>`
            + `<select data-hd="period" data-hfocus="period" aria-label="${esc(h.filterPeriod)}">`
            + `<option value=""${periodValue === '' ? ' selected' : ''}>${esc(h.periodAll)}</option>`
            + centuries.map(c => `<option value="c:${c}"${periodValue === `c:${c}` ? ' selected' : ''}>${esc(centuryLabel(c))}</option>`).join('')
            + `<option value="custom"${custom ? ' selected' : ''}>${esc(h.periodCustom)}</option></select></label>`
            + (custom ? `<span class="hd-range"><input type="number" inputmode="numeric" data-hd="from" data-hfocus="from" value="${f.from ?? ''}" placeholder="${esc(h.periodFrom)}" aria-label="${esc(h.periodFrom)}">`
                + `<span aria-hidden="true">–</span><input type="number" inputmode="numeric" data-hd="to" data-hfocus="to" value="${f.to ?? ''}" placeholder="${esc(h.periodTo)}" aria-label="${esc(h.periodTo)}"></span>` : '');
        const search = `<input type="search" class="hd-search" data-hd="q" data-hfocus="q" value="${esc(f.query)}" placeholder="${esc(h.textSearchPh)}" aria-label="${esc(h.textSearchPh)}" autocomplete="off" spellcheck="false">`;
        const hiddenOnly = hiddenN
            ? `<label class="hd-hidden-only"><input type="checkbox" data-hd="hiddenOnly" data-hfocus="hiddenOnly"${f.hiddenOnly ? ' checked' : ''}> ${esc(h.hiddenOnly)} <span class="hd-chip-n">${hiddenN}</span></label>` : '';
        const wide = `<div class="hd-filters">${chips}<div class="hd-filter-row">${period}${search}${hiddenOnly}</div></div>`;

        // Phone: Kind ▾ · Period ▾ · Hidden only · Search (the search field over the row while open).
        const kindOn = chosen.length > 0;
        const periodOn = f.from !== undefined || f.to !== undefined;
        const periodLabel = periodOn ? (f.from !== undefined && f.to !== undefined ? `${f.from}–${f.to}` : f.from !== undefined ? `${f.from}–` : `–${f.to}`) : '';
        const mchip = (id: string, label: string, on: boolean, extra = ''): string =>
            `<button type="button" class="hd-mchip${on ? ' is-on' : ''}" data-hd="${id}" data-hfocus="m:${id}"${extra}>${esc(label)}</button>`;
        const narrow = mem.searchOpen
            ? `<div class="hd-mfilters is-search">${search.replace('data-hfocus="q"', 'data-hfocus="mq"')}`
                + `<button type="button" class="hd-mclose" data-hd="searchClose" aria-label="${esc(strings.buttons.close)}">×</button></div>`
            : '<div class="hd-mfilters">'
                + mchip('sheet', kindOn ? (by === 'kinds' ? h.filterKindN(chosen.length) : `${h.filterPlace} · ${chosen.length}`) : `${by === 'kinds' ? h.filterKind : h.filterPlace} ▾`, kindOn, ' aria-haspopup="dialog"')
                + mchip('sheetPeriod', periodOn ? periodLabel : `${h.filterPeriod} ▾`, periodOn, ' aria-haspopup="dialog"')
                + (hiddenN ? mchip('hiddenOnlyChip', h.hiddenOnly, f.hiddenOnly, ` aria-pressed="${f.hiddenOnly}"`) : '')
                + mchip('search', f.query ? `${h.filterSearch}: ${f.query}` : h.filterSearch, !!f.query)
                + '</div>';
        return wide + narrow;
    },

    /** The list: by centuries for a region, plain for the local findings and a place. */
    historyDetailList(d: Drawn, key: string, all: DetailEvent[], shown: DetailEvent[]): string {
        const h = strings.history;
        if (!all.length) return `<p class="hm-empty">${esc(h.searchNone)}</p>`;
        if (!shown.length) return `<p class="hm-empty">${esc(h.detailEmpty)}</p>`;
        const audience = audienceOf(d);
        const owner = detailOwner(key);
        const rowsHtml = (rows: DetailEvent[]): string => rows.map(r => this.historyDetailEventRow(d, key, r, audience.get(r.ev.id))).join('');
        if (owner.kind !== 'region') return `<div class="hd-rows">${rowsHtml(shown)}</div>`;
        const toggled = mem.toggled.get(key) ?? new Set<number>();
        return centuryGroups(shown, toggled).map(g =>
            `<section class="hd-century${g.open ? ' is-open' : ''}">`
            + `<button type="button" class="hd-century-head" data-hd="century" data-c="${g.century}" aria-expanded="${g.open}" data-hfocus="c:${g.century}"`
            + ` aria-label="${esc(h.centuryToggle(g.label))}"><span class="hd-century-chev" aria-hidden="true">${g.open ? '▾' : '▸'}</span>`
            + `<span>${esc(g.label)} · ${g.rows.length}</span></button>`
            + (g.open ? `<div class="hd-rows">${rowsHtml(g.rows)}</div>` : '')
            + '</section>').join('');
    },

    /** One event (§2.3): the card layer's row with place, audience, hiding and its "⋯". */
    historyDetailEventRow(d: Drawn, key: string, r: DetailEvent, a: EventAudience | undefined): string {
        const h = strings.history;
        const ev = r.ev;
        const id = esc(ev.id);
        const meta: string[] = [];
        if (r.place) meta.push(`<span class="hd-place">${esc(r.place)}</span>`);
        const n = a?.sees.length ?? 0;
        meta.push(n
            ? `<button type="button" class="hd-sees" data-hd="who" data-ev="${id}" aria-haspopup="dialog" aria-expanded="false" data-hfocus="who:${id}">${esc(h.sees(n))}</button>`
            : `<span class="hd-sees-none">${esc(h.seesNobody)}</span>`);
        const canUndo = manageCan(d.env, 'hide') || manageCan(d.env, 'hideAll');
        let tail = '';
        if (r.hide !== 'none') {
            tail += `<span class="hd-hide-note">${esc(r.hideNote)}`
                + (canUndo ? ` <button type="button" class="link hd-unhide" data-hd="unhide" data-ev="${id}" data-hfocus="unhide:${id}">${esc(h.undo)}</button>` : '')
                + '</span>';
        }
        const note = mem.notes.get(ev.id);
        if (note) tail += `<span class="hd-ev-note" role="status">${esc(note)}</span>`;
        const desc = historyEventDescHtml(ev, r, {
            meta, quoteOpen: mem.quotes.has(ev.id), langBadge: true, tail,
            cite: `data-hd="cite" data-ev="${id}" data-hfocus="cite:${id}"`,
            quote: `data-hd="quote" data-ev="${id}" data-hfocus="quote:${id}"`,
        });
        const dim = r.hide === 'tree' || r.hide === 'region';
        const menu = this.historyDetailMenuItems(d, key, r, a).length > 0;
        return `<div class="pm-lifeline-row k-history is-${ev.scope} hd-ev${dim ? ' is-dim' : ''}${mem.busy.has(ev.id) ? ' is-busy' : ''}" data-history-id="${id}">`
            + `<span class="pm-lifeline-year">${esc(r.year)}</span>`
            // The kind's symbol in place of the origin's mark (the detail's head carries the origin).
            + `<span class="hd-mark hd-kind" title="${esc(h.kinds[ev.kind] ?? h.kinds.other)}">${historyKindSvg(ev.kind, 14)}</span>`
            + `<span class="pm-lifeline-desc">${desc}</span>`
            + (menu ? `<button type="button" class="pm-lifeline-hmore" data-hd="menu" data-ev="${id}" aria-haspopup="menu" aria-expanded="false"`
                + ` aria-label="${esc(h.more)}" data-hfocus="more:${id}"${mem.busy.has(ev.id) ? ' disabled' : ''}>⋯</button>` : '')
            + '</div>';
    },

    /** The event menu's items (§3.1), each only with its feature. */
    historyDetailMenuItems(d: Drawn, key: string, r: DetailEvent, a: EventAudience | undefined): { id: string; label: string; sub: string; danger?: boolean; note?: boolean }[] {
        const h = strings.history;
        const out: { id: string; label: string; sub: string; danger?: boolean; note?: boolean }[] = [];
        const pending = d.env.bridgeUp ? '' : ` · ${h.pendingSync}`;
        const sees = a?.sees ?? [];
        if (sees.length) out.push({ id: 'who', label: `${h.whoMenu} ›`, sub: h.whoMenuSub(sees.length) });
        if (manageCan(d.env, 'hideAll') && r.hide !== 'tree') out.push({ id: 'hideTree', label: h.hideTree, sub: h.hideTreeSub + pending });
        if (manageCan(d.env, 'hide') && r.hide !== 'tree' && r.hide !== 'region') {
            const places = audiencePlaces(a, d.names);
            if (places.length) out.push({ id: 'place', label: `${h.hidePlaceMenu} ›`, sub: h.hidePlaceSub(places.length) + pending });
            if (sees.length) out.push({ id: 'person', label: `${h.hidePersonMenu} ›`, sub: h.hidePersonSub(sees.length) + pending });
        }
        if (d.features.includes('history.delete')) {
            if (d.env.bridgeUp) out.push({ id: 'delete', label: h.deleteMenu, sub: r.ev.scope === 'local' ? h.deleteSubLocal : h.deleteSub, danger: true });
            else if (out.length) out.push({ id: '', label: h.deleteNeedsBridge, sub: '', note: true });
        }
        return out;
    },

    // ─── Events of the body ────────────────────────────────────────────────

    historyDetailClick(e: MouseEvent, el: HTMLElement): void {
        const t = e.target as HTMLElement;
        const btn = t.closest<HTMLElement>('[data-hd]');
        if (!btn || !el.contains(btn) || btn.tagName === 'INPUT' || btn.tagName === 'SELECT') return;
        const key = el.dataset.key ?? '';
        const f = filterOf(key);
        const evId = btn.dataset.ev ?? '';
        switch (btn.dataset.hd) {
            case 'facet': {
                const list = btn.dataset.by === 'places' ? f.places : f.kinds;
                const k = btn.dataset.k ?? '';
                if (!k) list.length = 0;
                else if (list.includes(k)) list.splice(list.indexOf(k), 1);
                else list.push(k);
                this.renderHistoryManage();
                return;
            }
            case 'century': {
                const c = Number(btn.dataset.c);
                let set = mem.toggled.get(key);
                if (!set) { set = new Set(); mem.toggled.set(key, set); }
                if (!set.delete(c)) set.add(c);
                this.renderHistoryManage();
                return;
            }
            case 'quote':
                if (!mem.quotes.delete(evId)) mem.quotes.add(evId);
                this.renderHistoryManage();
                return;
            case 'cite': {
                const ev = this.historyManageDrawn()?.payload?.events.find(x => x.id === evId);
                if (ev) this.openLifelineHistoryCite({ ev, year: ev.from, age: '', place: '', placeKey: '', text: '', textLang: '' });
                return;
            }
            case 'unhide': this.historyDetailUnhide(key, evId); return;
            case 'who': this.historyDetailMenu(key, evId, btn, 'who'); return;
            case 'menu': this.historyDetailMenu(key, evId, btn, 'main'); return;
            case 'sheet': this.historyDetailFilterSheet(key); return;
            case 'sheetPeriod': this.historyDetailFilterSheet(key); return;
            case 'hiddenOnlyChip':
                f.hiddenOnly = !f.hiddenOnly;
                this.renderHistoryManage();
                return;
            case 'search':
                mem.searchOpen = true;
                this.renderHistoryManage();
                document.querySelector<HTMLInputElement>(`#${HISTORY_MANAGE_DIALOG_ID} [data-hfocus="mq"]`)?.focus();
                return;
            case 'searchClose':
                mem.searchOpen = false;
                this.renderHistoryManage();
                document.querySelector<HTMLElement>(`#${HISTORY_MANAGE_DIALOG_ID} [data-hfocus="m:search"]`)?.focus();
                return;
            default: return;
        }
    },

    historyDetailChange(e: Event, el: HTMLElement): void {
        const t = e.target as HTMLInputElement | HTMLSelectElement;
        const key = el.dataset.key ?? '';
        const f = filterOf(key);
        switch (t.dataset.hd) {
            case 'period': {
                const v = t.value;
                if (v === 'custom') {
                    mem.custom.add(key);
                } else {
                    mem.custom.delete(key);
                    if (v.startsWith('c:')) {
                        const c = Number(v.slice(2));
                        f.from = c * 100;
                        f.to = c * 100 + 99;
                    } else {
                        delete f.from;
                        delete f.to;
                    }
                }
                this.renderHistoryManage();
                return;
            }
            case 'from':
            case 'to': {
                const n = parseInt(t.value, 10);
                if (Number.isFinite(n)) f[t.dataset.hd] = n; else delete f[t.dataset.hd as 'from' | 'to'];
                this.renderHistoryManage();
                return;
            }
            case 'hiddenOnly':
                f.hiddenOnly = (t as HTMLInputElement).checked;
                this.renderHistoryManage();
                return;
            default: return;
        }
    },

    /** Phone: the bottom sheet "Filter" — kinds (or places), periods, from–to, the live count, Clear. */
    historyDetailFilterSheet(key: string): void {
        const d = this.historyManageDrawn();
        if (!d?.payload) return;
        const h = strings.history;
        const owner = detailOwner(key);
        const by = owner.kind === 'local' ? 'places' as const : 'kinds' as const;
        const sheet = this.showLifelineHistorySheet('hd-fsheet', 'dialog', h.filterTitle, '<div class="hd-fsheet-body"></div>');
        const box = sheet.querySelector<HTMLElement>('.hd-fsheet-body')!;
        const draw = (focus?: string): void => {
            const dd = this.historyManageDrawn();
            if (!dd?.payload) return;
            const all = this.historyDetailRows(dd, key);
            const f = filterOf(key);
            const chosen = by === 'kinds' ? f.kinds : f.places;
            const facets = detailFacets(all, f, by, dd.names);
            const chip = (attrs: string, label: string, on: boolean, n: number | null = null, kind = ''): string =>
                `<button type="button" class="hd-chip" ${attrs} aria-pressed="${on}"${kind ? ` title="${esc(label)}"` : ''}>`
                + `${kind ? historyKindSvg(kind as HistoryEvent['kind'], 14) : ''}${esc(label)}${n === null ? '' : ` <span class="hd-chip-n">${n}</span>`}</button>`;
            const centuries = detailCenturies(all);
            const isCentury = (c: number) => f.from === c * 100 && f.to === c * 100 + 99;
            const count = filterDetailEvents(all, f).length;
            box.innerHTML = `<div class="pm-lifeline-hsheet-head">${esc(h.filterTitle)}</div>`
                + `<div class="hd-fs-section"><div class="hd-fs-title">${esc(by === 'kinds' ? h.filterKind : h.filterPlace)}</div><div class="hd-chips">`
                + chip('data-fs="facet" data-k=""', h.filterAll, !chosen.length)
                + facets.map(x => chip(`data-fs="facet" data-k="${esc(x.key)}"`, by === 'kinds' ? cap(h.kinds[x.key as HistoryEvent['kind']] ?? x.key) : x.label, chosen.includes(x.key), x.count,
                    kindChip(by, x.key) ? x.key : '')).join('')
                + '</div></div>'
                + `<div class="hd-fs-section"><div class="hd-fs-title">${esc(h.filterPeriod)}</div><div class="hd-chips">`
                + chip('data-fs="period" data-c=""', h.periodAll, f.from === undefined && f.to === undefined)
                + centuries.map(c => chip(`data-fs="period" data-c="${c}"`, centuryLabel(c), isCentury(c))).join('')
                + '</div><div class="hd-range">'
                + `<input type="number" inputmode="numeric" data-fs="from" value="${f.from ?? ''}" placeholder="${esc(h.periodFrom)}" aria-label="${esc(h.periodFrom)}">`
                + `<span aria-hidden="true">–</span><input type="number" inputmode="numeric" data-fs="to" value="${f.to ?? ''}" placeholder="${esc(h.periodTo)}" aria-label="${esc(h.periodTo)}"></div></div>`
                + `<button type="button" class="primary hd-fs-show" data-fs="show">${esc(h.filterShow(count))}</button>`
                + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel" data-fs="clear">${esc(h.filterClear)}</button>`;
            if (focus) box.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
        };
        draw('[data-fs="facet"]');
        box.addEventListener('click', (e) => {
            const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fs]');
            if (!b || b.tagName === 'INPUT') return;
            const f = filterOf(key);
            const which = b.dataset.fs;
            if (which === 'facet') {
                const list = by === 'kinds' ? f.kinds : f.places;
                const k = b.dataset.k ?? '';
                if (!k) list.length = 0;
                else if (list.includes(k)) list.splice(list.indexOf(k), 1);
                else list.push(k);
            } else if (which === 'period') {
                mem.custom.delete(key);
                const c = b.dataset.c;
                if (c) { f.from = Number(c) * 100; f.to = Number(c) * 100 + 99; } else { delete f.from; delete f.to; }
            } else if (which === 'show') {
                this.hideBottomSheet();
                return;
            } else if (which === 'clear') {
                mem.filters.set(key, emptyDetailFilter());
                mem.custom.delete(key);
                this.hideBottomSheet();
                this.renderHistoryManage();
                return;
            }
            this.renderHistoryManage();
            draw(`[data-fs="${which}"]${b.dataset.k !== undefined ? `[data-k="${CSS.escape(b.dataset.k)}"]` : b.dataset.c !== undefined ? `[data-c="${CSS.escape(b.dataset.c)}"]` : ''}`);
        });
        box.addEventListener('change', (e) => {
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-fs]');
            if (!input) return;
            const f = filterOf(key);
            const which = input.dataset.fs as 'from' | 'to';
            const n = parseInt(input.value, 10);
            if (Number.isFinite(n)) f[which] = n; else delete f[which];
            mem.custom.add(key);
            this.renderHistoryManage();
            draw(`[data-fs="${which}"]`);
        });
    },

    // ─── The event's menu (§3.1) and "who sees it" (§2.4) ──────────────────

    /**
     * The event's "⋯" (or "{n} people will see it"): a menu by the button, on
     * a phone a bottom sheet. A second level (who, places, persons) replaces
     * the content with "‹" back; Escape there goes back to the first.
     */
    historyDetailMenu(key: string, evId: string, anchor: HTMLElement, start: 'main' | 'who'): void {
        const d = this.historyManageDrawn();
        if (!d?.payload) return;
        const h = strings.history;
        const first = this.historyDetailRows(d, key).find(x => x.ev.id === evId);
        if (!first) return;
        const head = `${first.year} · ${first.text}`;
        const mobile = media(MQ_MOBILE);
        let level: 'main' | 'who' | 'place' | 'person' = start;
        let query = '';
        let whoAll = false;
        let box: HTMLElement;
        let close: () => void;

        const now = (): { d: Drawn; r: DetailEvent; a: EventAudience | undefined } | null => {
            const dd = this.historyManageDrawn();
            if (!dd?.payload) return null;
            const r = this.historyDetailRows(dd, key).find(x => x.ev.id === evId);
            return r ? { d: dd, r, a: audienceOf(dd).get(evId) } : null;
        };
        const back = (): string => start === 'main'
            ? `<button type="button" class="hd-menu-back" data-scope="back">‹ ${esc(strings.contextMenu.back)}</button>` : '';
        const item = (it: { id: string; label: string; sub: string; danger?: boolean }): string =>
            `<button type="button" role="menuitem" class="${mobile ? 'bottom-sheet-item pm-lifeline-hsheet-item' : 'pm-lifeline-hmenu-item'}${it.danger ? ' is-danger' : ''}" data-scope="${esc(it.id)}">`
            + `<span class="pm-lifeline-hmenu-label">${esc(it.label)}</span>${it.sub ? `<span class="pm-lifeline-hmenu-hint">${esc(it.sub)}</span>` : ''}</button>`;
        const whereNote = (r: DetailEvent): string => {
            const ev = r.ev;
            const where = ev.scope === 'region' && ev.region ? regionName(d.payload!.regions?.[ev.region.id] ?? ev.region, lang())
                : ev.scope === 'place' && ev.place ? d.names.place(ev.place.key) : r.place ?? '';
            return where ? `<p class="hd-who-note">${esc(h.whoNote(where, r.year))}</p>` : '';
        };
        const html = (): string => {
            const x = now();
            if (!x) return '';
            const { d: dd, r, a } = x;
            const sees = a?.sees ?? [];
            const headHtml = `<div class="${mobile ? 'pm-lifeline-hsheet-head' : 'pm-lifeline-hmenu-head'}" role="presentation">${esc(head)}</div>`;
            if (level === 'main') {
                const items = this.historyDetailMenuItems(dd, key, r, a);
                return headHtml + items.map(it => it.note
                    ? `<p class="hd-menu-note">${esc(it.label)}</p>`
                    : (it.id === 'delete' ? '<div class="hd-menu-sep" role="separator"></div>' : '') + item(it)).join('')
                    + (mobile ? `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel" data-scope="cancel">${esc(strings.buttons.cancel)}</button>` : '');
            }
            if (level === 'who') {
                const collator = new Intl.Collator(lang());
                const list = [...sees].sort((p, q) => collator.compare(personName(p.personId), personName(q.personId)));
                const visible = whoAll ? list : list.slice(0, WHO_FIRST);
                return back() + `<div class="hd-who-title">${esc(h.whoTitle(sees.length))}</div>` + whereNote(r)
                    + '<div class="hd-who-list">'
                    + visible.map(p => `<button type="button" class="hd-who-person" data-scope="see:${esc(p.personId)}">`
                        + `<span class="hd-who-name">${esc(personName(p.personId))}</span>`
                        + `<span class="hd-who-meta">${esc([personYears(p.personId), p.place].filter(Boolean).join(' · '))}</span></button>`).join('')
                    + '</div>'
                    + (list.length > visible.length ? `<button type="button" class="hd-who-more" data-scope="whoMore">${esc(h.whoMore(list.length - visible.length))}</button>` : '')
                    + (mobile ? `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel" data-scope="cancel">${esc(strings.buttons.close)}</button>` : '');
            }
            if (level === 'place') {
                return back() + headHtml + audiencePlaces(a, dd.names).map(pl => item({ id: `p:${pl.key}`, label: pl.name, sub: h.placePersons(pl.persons) })).join('');
            }
            const collator = new Intl.Collator(lang());
            const people = [...sees].sort((p, q) => collator.compare(personName(p.personId), personName(q.personId)));
            const search = people.length >= PERSON_SEARCH_FROM
                ? `<input type="search" class="hd-menu-search" data-menu="q" value="${esc(query)}" placeholder="${esc(h.personSearchPh)}" aria-label="${esc(h.personSearchPh)}" autocomplete="off">` : '';
            return back() + headHtml + search + `<div class="hd-menu-people">${this.historyDetailPeople(people, query, item)}</div>`;
        };
        const draw = (): void => {
            box.innerHTML = html();
            const target = box.querySelector<HTMLElement>('[data-menu="q"]') ?? box.querySelector<HTMLElement>(level === 'main' ? '[data-scope]:not([data-scope="cancel"])' : '[data-scope]:not([data-scope="back"])') ?? box.querySelector<HTMLElement>('[data-scope]');
            target?.focus({ preventScroll: true });
        };
        const act = (scope: string): void => {
            const x = now();
            if (!x) { close(); return; }
            if (scope === 'cancel') { close(); return; }
            if (scope === 'back') { level = 'main'; query = ''; draw(); return; }
            if (scope === 'who' || scope === 'place' || scope === 'person') { level = scope; draw(); return; }
            if (scope === 'whoMore') { whoAll = true; draw(); return; }
            close();
            if (scope === 'hideTree') this.historyDetailHide({ event: evId, tree: true, at: nowIso() }, h.toastHiddenTree);
            else if (scope === 'delete') void this.historyDetailDelete(key, evId);
            else if (scope.startsWith('p:')) {
                const pk = scope.slice(2);
                const entry = x.a?.sees.find(s => s.placeKey === pk);
                const place = entry?.place ?? x.d.names.place(pk);
                this.historyDetailHide({ event: evId, place, at: nowIso() }, h.toastPlace(place));
            } else if (scope.startsWith('o:')) {
                const pid = scope.slice(2);
                const refn = this.historyPersonRefn(pid);
                this.historyDetailHide({ event: evId, personId: pid, ...(refn ? { personRefn: refn } : {}), at: nowIso() }, h.toastPerson(personName(pid)));
            } else if (scope.startsWith('see:')) {
                this.historyDetailOpenPerson(scope.slice(4), evId);
            }
        };

        if (mobile) {
            const sheet = this.showLifelineHistorySheet('hd-menu-sheet', start === 'who' ? 'dialog' : 'menu', start === 'who' ? h.whoMenu : head, '<div class="hd-sheet-body"></div>');
            box = sheet.querySelector<HTMLElement>('.hd-sheet-body')!;
            close = () => this.hideBottomSheet();
            sheet.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && level !== start) {
                    e.preventDefault();
                    e.stopPropagation();
                    level = start;
                    query = '';
                    draw();
                    return;
                }
                this.lifelineHistoryMenuKeys(e, sheet);
            });
        } else {
            if (anchor.getAttribute('aria-expanded') === 'true') {
                this.closeLifelineHistoryPopups();
                anchor.focus();
                return;
            }
            this.closeLifelineHistoryPopups();
            box = document.createElement('div');
            box.className = start === 'who' ? 'pm-lifeline-hmenu hm-menu hd-who-pop' : 'pm-lifeline-hmenu hm-menu hd-menu';
            box.setAttribute('role', start === 'who' ? 'dialog' : 'menu');
            box.setAttribute('aria-label', start === 'who' ? h.whoMenu : head);
            close = () => {
                this.closeLifelineHistoryPopups();
                if (anchor.isConnected) anchor.focus({ preventScroll: true });
            };
            draw();
            this.openLifelineHistoryPopup(box, anchor, (e) => this.lifelineHistoryMenuKeys(e, box), () => {
                if (level === start) return false;
                level = start;
                query = '';
                draw();
                return true;
            });
        }
        if (mobile) draw();
        box.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-scope]');
            if (!row) return;
            e.stopPropagation();
            act(row.dataset.scope ?? '');
        });
        box.addEventListener('input', (e) => {
            const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-menu="q"]');
            if (!input) return;
            query = input.value;
            const x = now();
            const list = box.querySelector<HTMLElement>('.hd-menu-people');
            if (!x || !list) return;
            const collator = new Intl.Collator(lang());
            const people = [...(x.a?.sees ?? [])].sort((p, q) => collator.compare(personName(p.personId), personName(q.personId)));
            list.innerHTML = this.historyDetailPeople(people, query, item);
        });
    },

    /** The persons of "Hide for one person only", narrowed by the search. */
    historyDetailPeople(people: { personId: string; place: string }[], query: string, item: (it: { id: string; label: string; sub: string }) => string): string {
        const q = query.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        return people
            .filter(p => !q || personName(p.personId).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q))
            .map(p => item({ id: `o:${p.personId}`, label: personName(p.personId), sub: [personYears(p.personId), p.place].filter(Boolean).join(' · ') }))
            .join('');
    },

    /** A hiding from the detail: at once (queued without the bridge), a toast with Undo. */
    historyDetailHide(op: HistoryHideOp, toast: string): void {
        void this.applyHistoryHide(op);
        this.showToast(toast, HIDE_TOAST_MS, {
            kind: 'history-hide',
            action: { label: strings.history.undo, run: () => { void this.applyHistoryHide({ ...op, do: 'show', at: nowIso() }); } },
        });
    },

    /** "Undo" on a hidden event: every hiding of it (or the region's "show again"). */
    historyDetailUnhide(key: string, evId: string): void {
        const d = this.historyManageDrawn();
        if (!d?.payload) return;
        const r = this.historyDetailRows(d, key).find(x => x.ev.id === evId);
        if (!r) return;
        if (r.hide === 'region' && r.ev.region) {
            this.historyManageShowAgain(r.ev.region.id);
            return;
        }
        r.hidings.forEach((by: EffectiveHidden) => this.restoreHistoryHide(by));
    },

    /** A person of "who sees it": the dialog closes, the person's card opens on the event's row. */
    historyDetailOpenPerson(personId: string, evId: string): void {
        if (!DataManager.getPerson(personId as PersonId)) return;
        this.closeHistoryManage();
        const open = (): void => {
            document.querySelectorAll<HTMLElement>('.modal-overlay.active').forEach(m => {
                if (m.id !== 'person-modal') m.classList.remove('active');
            });
            this.clearDialogStack();
            this.pushDialog('person-modal');
            this.showEditPersonModal(personId as PersonId);
            this.highlightHistoryEvent(evId);
        };
        if (document.getElementById('person-modal')?.classList.contains('active')) this.leavePersonModalThen(open);
        else open();
    },

    // ─── Delete (§3.2 variant A) ────────────────────────────────────────────

    /** "Delete…": confirmed; "Only hide" instead when it can; a toast with Undo (restore). */
    async historyDetailDelete(key: string, evId: string): Promise<void> {
        const d = this.historyManageDrawn();
        if (!d?.payload || !d.base) return;
        const h = strings.history;
        const r = this.historyDetailRows(d, key).find(x => x.ev.id === evId);
        if (!r) return;
        const ev = r.ev;
        const owner = detailOwner(key);
        const local = ev.scope === 'local';
        const group = ev.scope === 'region' && ev.region ? regionName(d.payload.regions?.[ev.region.id] ?? ev.region, lang())
            : ev.scope === 'place' && ev.place ? d.names.place(ev.place.key) : h.kindLocal;
        const body = ev.scope === 'region' ? h.deleteRegion(group) : ev.scope === 'place' ? h.deletePlace(group) : h.deleteLocal;
        // "Only hide": in the whole tree (R2); without it at the place of a place's detail; otherwise none.
        const hideTree = manageCan(d.env, 'hideAll');
        const hidePlace = !hideTree && owner.kind === 'place' && manageCan(d.env, 'hide');
        const choices: { id: string; label: string; variant?: 'default' | 'danger' }[] = [];
        if (hideTree) choices.push({ id: 'hide', label: h.deleteOnlyHide });
        else if (hidePlace) choices.push({ id: 'hide', label: h.deleteOnlyHidePlace });
        choices.push({ id: 'delete', label: h.deleteConfirm, variant: 'danger' });
        const asked = this.showChoice(`${body} ${h.deleteRestoreNote}`, local ? h.deleteTitleLocal : h.deleteTitle, choices, undefined, {
            subtitle: [r.year, r.text, group].filter(Boolean).join(' · '),
        });
        // Cancel is the default (Enter cancels).
        requestAnimationFrame(() => document.getElementById('confirm-cancel-btn')?.focus());
        const pick = await asked;
        if (pick === 'hide') {
            if (hideTree) this.historyDetailHide({ event: evId, tree: true, at: nowIso() }, h.toastHiddenTree);
            else {
                const place = d.names.place(owner.id);
                this.historyDetailHide({ event: evId, place, at: nowIso() }, h.toastPlace(place));
            }
            return;
        }
        if (pick !== 'delete') return;
        await this.historyDetailWriteDelete(evId, local, false);
    },

    /** `POST /history/delete` (or its restore); errors by §3.7. */
    async historyDetailWriteDelete(evId: string, local: boolean, restore: boolean): Promise<void> {
        const d = this.historyManageDrawn();
        if (!d?.base || mem.busy.has(evId)) return;
        const h = strings.history;
        mem.busy.add(evId);
        mem.notes.delete(evId);
        this.renderHistoryManage();
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeDelete(d.base, restore ? { event: evId, do: 'restore' } : { event: evId }, d.features);
        mem.busy.delete(evId);
        if (!r.ok) {
            this.historyDetailRefused(d.rid, evId, r);
            return;
        }
        if (restore) mem.gone.delete(evId); else mem.gone.add(evId);
        this.historyManageWritten(d.rid, before, r);
        if (restore) this.showToast(h.toastRestored, 4000);
        else {
            this.showToast(local ? h.toastDeletedLocal : h.toastDeleted, 6000, {
                action: { label: h.undo, run: () => { void this.historyDetailWriteDelete(evId, local, true); } },
            });
        }
        this.renderHistoryManage();
    },

    /** A refused delete (§3.7): busy and retracted under the row, gone a toast and a fresh read, the rest the bridge's sentence. */
    historyDetailRefused(rid: string, evId: string, r: HistoryWriteRefusal): void {
        const h = strings.history;
        if (r.code === 'busy' || r.code === 'retracted') {
            const text = r.code === 'busy' ? h.errBusy : h.errRetracted;
            // A restore (Undo) of a row deleted here: no row to say it under.
            if (mem.gone.has(evId)) this.showToast(text, 5000);
            else mem.notes.set(evId, text);
        } else if (r.code === 'gone') {
            this.showToast(h.errGone, 5000);
            void this.readBridgeHistory(rid);
        } else {
            const text = r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed);
            this.showToast(text, 5000);
        }
        this.renderHistoryManage();
    },
});
