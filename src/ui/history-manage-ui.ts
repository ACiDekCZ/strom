/**
 * History of places — the manager (#history-modal, spec 020 K4.3/K4.4): the
 * header with the research's state, the Regions / Places / Hidden (/ Deleted)
 * switch with a search, the rows and their actions. The pure model is
 * src/history-manage.ts; the page's history state is history-ui.ts.
 *
 * Detail of a region (§2) nests in the same dialog: `openHistoryManageDetail`
 * draws its frame ("‹ History of places", title, state) and leaves
 * `.hm-detail-body` to the detail's own drawing.
 */

import { strings, getCurrentLanguage, type Language } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { shownName } from '../person-name.js';
import { placeKey } from '../places.js';
import { MQ_MOBILE, MQ_DESKTOP } from '../breakpoints.js';
import { announcedResearchScheme } from '../research-device.js';
import { treePlaceNames, type HistoryPayload, type EffectiveHidden } from '../history.js';
import {
    regionGroups, placeGroups, hiddenRows, deletedRows, manageHeader, manageCan, matchesQuery, regionName, manageSearchOn,
    type ManageEnv, type ManageNames, type ManageTab, type RegionRow, type PlaceRow, type RegionGroup, type PlaceGroup,
    type HiddenRow, type DeletedRow, type PlaceSort,
} from '../history-manage.js';
import {
    postBridgeFirst, postBridgeSkip, postBridgeDelete, type HistoryWriteRefusal, type HistorySkipBody,
} from '../history-bridge.js';
import { HISTORY_MANAGE_DIALOG_ID } from './history-ui.js';
import { uiModule } from './module.js';

/** Rows drawn at once per group; "Show n more rows" adds as many again. */
const PAGE = 200;

type RowNote = { text: string; tone: 'info' | 'error'; link?: { label: string; run: () => void } };

interface ManageView {
    tab: ManageTab;
    query: string;
    /** A region's detail (§2) open in the dialog: its row key. */
    detail: string | null;
    /** Rows shown per group (paging). */
    shown: Map<string, number>;
    /** A sentence under a row (busy, "comes first", archive): by row key. */
    notes: Map<string, RowNote>;
    /** Rows whose write is on its way. */
    busy: Set<string>;
    /** A place to bring into view on the Places tab (payload key). */
    focusPlace: string | null;
    /** Phone sideways: pace and summary unfolded. */
    stateOpen: boolean;
}

function freshView(): ManageView {
    return { tab: 'regions', query: '', detail: null, shown: new Map(), notes: new Map(), busy: new Set(), focusPlace: null, stateOpen: false };
}

let view: ManageView = freshView();

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

function formatDate(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    return new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(t));
}

function formatTime(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    return new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
}

function nowIso(): string {
    return new Date().toISOString();
}

function langAttr(code: string): string {
    return code && code !== lang() && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code) ? ` lang="${esc(code)}"` : '';
}

/** Names the tree gives: a payload place key's spelling in the tree, a person's shown name. */
function treeNames(p: HistoryPayload): ManageNames {
    const data = DataManager.getData();
    const spelled = treePlaceNames(data, p);
    return {
        place: key => spelled.get(key) ?? key,
        person: (refn, id) => {
            const byId = id ? data.persons[id as keyof typeof data.persons] : undefined;
            const person = byId ?? (refn ? Object.values(data.persons).find(x => x.refn === refn) : undefined);
            return person ? shownName(person) : '';
        },
    };
}

/** What the manager draws now (null: no tree with a research). */
export interface Drawn {
    rid: string;
    payload: HistoryPayload | null | undefined;
    env: ManageEnv;
    names: ManageNames;
    base: string | null;
    features: readonly string[];
}

/** The tab's rows that match the query, and how many there are in all. */
interface TabRows {
    regions: RegionGroup[];
    places: PlaceGroup[];
    hidden: HiddenRow[];
    deleted: DeletedRow[];
}

export const historyManageMethods = uiModule({
    /**
     * Open "History of places" (§1.1): `tab`, `place` (Places with the search
     * set to it) or `region` (its detail at once). Over the dialog it came from
     * (Settings, the person card); Close returns there.
     */
    openHistoryManage(opts: { tab?: ManageTab; place?: string; region?: string } = {}): void {
        const modal = document.getElementById(HISTORY_MANAGE_DIALOG_ID);
        if (!modal) return;
        const reopen = modal.classList.contains('active');
        view = freshView();
        this.resetHistoryDetail();
        if (opts.tab) view.tab = opts.tab;
        if (opts.place) {
            view.tab = 'places';
            view.focusPlace = opts.place;
        }
        if (opts.region) view.detail = opts.region;
        const ctx = this.historyManageContext();
        if (ctx && ctx.payload === undefined) void this.ensureHistoryCache(ctx.researchId).then(() => this.renderHistoryManage());
        // A fresh read whenever it opens with the bridge running (the copy may be older than the research).
        if (ctx?.status && (ctx.status.features ?? []).includes('history.events')) void this.readBridgeHistory(ctx.researchId);
        const input = document.getElementById('history-manage-search') as HTMLInputElement | null;
        if (input) {
            input.value = '';
            if (opts.place && ctx?.payload) {
                const name = treeNames(ctx.payload).place(opts.place);
                input.value = name;
                view.query = name;
            }
        }
        if (!reopen) {
            this.pushDialog(HISTORY_MANAGE_DIALOG_ID);
            modal.classList.add('active');
        }
        this.renderHistoryManage();
        const first = view.detail
            ? modal.querySelector<HTMLElement>('.hm-detail-title')
            : modal.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        first?.focus({ preventScroll: true });
    },

    /** A menu or link opening it (string arguments for inline handlers). */
    openHistoryManageFrom(from: string): void {
        if (from === 'legend') this.closeLifelineHistoryPopups();
        if (from === 'hidden') this.openHistoryManage({ tab: 'hidden' });
        else this.openHistoryManage({ tab: 'regions' });
    },

    closeHistoryManage(): void {
        this.closeLifelineHistoryPopups();
        document.getElementById(HISTORY_MANAGE_DIALOG_ID)?.classList.remove('active');
        this.dialogStack = this.dialogStack.filter(d => d !== HISTORY_MANAGE_DIALOG_ID);
        view = freshView();
        this.resetHistoryDetail();
        this.renderHistorySettingsIfOpen();
    },

    /** The environment of the pure model for the open tree. */
    historyManageDrawn(): Drawn | null {
        const ctx = this.historyManageContext();
        if (!ctx) return null;
        const features = ctx.features;
        const status = ctx.status;
        const env: ManageEnv = {
            lang: lang(),
            features,
            bridgeUp: !!status && !!ctx.base,
            queue: ctx.queue,
            ...(status?.treeState ? { treeState: status.treeState } : {}),
            ...(status?.experiments ? { searchOn: status.experiments.history } : {}),
            offDone: ctx.offDone,
            canLinkOn: ctx.canLinkOn,
            ...(status?.historyPace ? { pace: status.historyPace } : {}),
            formatDate,
            formatTime,
        };
        return {
            rid: ctx.researchId, payload: ctx.payload, env,
            names: ctx.payload ? treeNames(ctx.payload) : { place: k => k, person: () => '' },
            base: ctx.base, features,
        };
    },

    /** Redraw the open dialog (a read, a hiding, a write): the header, the tabs and the list; the search keeps its focus. */
    renderHistoryManage(): void {
        const modal = document.getElementById(HISTORY_MANAGE_DIALOG_ID);
        if (!modal) return;
        const h = strings.history;
        const treeId = DataManager.getCurrentTreeId();
        const tree = document.getElementById('history-manage-tree');
        if (tree) tree.textContent = (treeId ? TreeManager.getTreeMetadata(treeId)?.name : '') ?? '';
        const top = modal.querySelector<HTMLElement>('.hm-top');
        const stateEl = document.getElementById('history-manage-state');
        const body = document.getElementById('history-manage-body');
        if (!stateEl || !body || !top) return;
        const d = this.historyManageDrawn();
        modal.classList.toggle('is-detail', !!view.detail);
        const back = modal.querySelector<HTMLElement>('.hm-back');
        if (back) back.hidden = !view.detail;
        if (!d || !d.payload) {
            stateEl.innerHTML = `<p class="hm-state-text">${esc(d && d.payload === null && !d.env.bridgeUp ? h.manageNoBridge : h.manageLoading)}</p>`;
            this.renderHistoryManageTabs(null);
            body.innerHTML = '';
            return;
        }
        // Header (§1.2).
        const head = manageHeader(d.payload, d.env);
        const link = head.link === 'enable'
            ? ` <button type="button" class="link hm-state-link" data-hm="enable">${esc(h.enableSearch)}</button>` : '';
        const extra = (head.pace ? `<p class="hm-state-pace">${esc(head.pace)}</p>` : '')
            + `<p class="hm-state-summary">${esc(head.summary)}</p>`;
        stateEl.innerHTML = `<p class="hm-state-text">${esc(head.text)}${link}</p>`
            + head.notes.map(n => `<p class="hm-state-note">${esc(n)}</p>`).join('')
            + `<button type="button" class="hm-state-toggle" data-hm="state" aria-expanded="${view.stateOpen}">${esc(h.manageStateToggle)} <span aria-hidden="true">▾</span></button>`
            + `<div class="hm-state-extra${view.stateOpen ? ' is-open' : ''}">${extra}</div>`;

        const rows = this.historyManageRows(d);
        this.renderHistoryManageTabs(rows);
        if (view.detail) {
            this.renderHistoryManageDetail(d, rows);
            return;
        }
        const scrollTop = body.scrollTop;
        body.innerHTML = this.historyManageList(d, rows);
        body.scrollTop = scrollTop;
        if (view.focusPlace && view.tab === 'places') {
            const row = body.querySelector<HTMLElement>(`[data-place="${CSS.escape(view.focusPlace)}"]`);
            row?.classList.add('is-focus');
            row?.scrollIntoView({ block: 'center' });
            view.focusPlace = null;
        }
    },

    /** Every tab's rows (search applied to the active one only — the counts of the others stay whole). */
    historyManageRows(d: Drawn): TabRows {
        const p = d.payload!;
        const sort: PlaceSort = SettingsManager.getHistoryPlacesSort();
        return {
            regions: regionGroups(p, d.env, d.names),
            places: placeGroups(p, d.env, d.names, sort),
            hidden: hiddenRows(p, d.env, d.names),
            deleted: deletedRows(p, d.env, d.names),
        };
    },

    /** The switch (§1.3): Regions · Places · Hidden (· Deleted while there is one), with counts; the search's count. */
    renderHistoryManageTabs(rows: TabRows | null): void {
        const tabs = document.getElementById('history-manage-tabs');
        if (!tabs) return;
        const h = strings.history;
        const regionCount = rows ? rows.regions.reduce((n, g) => n + g.rows.length, 0) : 0;
        const placeCount = rows ? rows.places.find(g => g.key === 'all')?.rows.length ?? 0 : 0;
        const list: [ManageTab, string, number][] = [
            ['regions', h.tabRegions, regionCount],
            ['places', h.tabPlaces, placeCount],
            ['hidden', h.tabHidden, rows?.hidden.length ?? 0],
        ];
        if (rows && rows.deleted.length) list.push(['deleted', h.tabDeleted, rows.deleted.length]);
        // Nothing deleted (any more): Hidden. While the copy loads the asked tab stays.
        if (rows && view.tab === 'deleted' && !rows.deleted.length) view.tab = 'hidden';
        tabs.innerHTML = list.map(([tab, label, n]) => {
            const on = tab === view.tab;
            return `<button type="button" role="tab" class="hm-tab${on ? ' is-active' : ''}" id="hm-tab-${tab}" data-tab="${tab}"`
                + ` aria-selected="${on}" aria-controls="history-manage-body" tabindex="${on ? 0 : -1}">`
                + `${esc(label)} <span class="hm-tab-count">${n}</span></button>`;
        }).join('');
        const count = document.getElementById('history-manage-count');
        const clear = document.getElementById('history-manage-clear');
        if (count) {
            const total = !rows ? 0 : view.tab === 'regions' ? regionCount : view.tab === 'places' ? Object.keys(this.historyManageDrawn()?.payload?.places ?? {}).length
                : view.tab === 'hidden' ? rows.hidden.length : rows.deleted.length;
            const found = !rows || !view.query ? 0 : this.historyManageMatches(rows).length;
            count.textContent = view.query ? h.searchCount(found, total) : '';
        }
        if (clear) clear.hidden = !view.query;
    },

    /** Keys of the active tab's rows matching the query. */
    historyManageMatches(rows: TabRows): string[] {
        const q = view.query;
        if (view.tab === 'regions') return rows.regions.flatMap(g => g.rows).filter(r => matchesQuery(r.search, q)).map(r => r.key);
        if (view.tab === 'places') {
            const all = rows.places.find(g => g.key === 'all')?.rows ?? [];
            return all.filter(r => matchesQuery(r.search, q)).map(r => r.key);
        }
        if (view.tab === 'hidden') return rows.hidden.filter(r => matchesQuery(r.search, q)).map((_, i) => String(i));
        return rows.deleted.filter(r => matchesQuery(r.search, q)).map(r => r.event);
    },

    /** The active tab's list. */
    historyManageList(d: Drawn, rows: TabRows): string {
        const h = strings.history;
        const q = view.query;
        const none = `<p class="hm-empty">${esc(h.searchNone)}</p>`;
        const page = (key: string, items: string[]): string => {
            const limit = view.shown.get(key) ?? PAGE;
            const more = items.length - limit;
            return items.slice(0, limit).join('')
                + (more > 0 ? `<button type="button" class="hm-more" data-hm="more" data-group="${esc(key)}">${esc(h.showMore(Math.min(more, PAGE)))}</button>` : '');
        };
        if (view.tab === 'regions') {
            if (!rows.regions.length) return `<p class="hm-empty">${esc(h.regionsEmpty)}</p>`;
            const groups = rows.regions.map(g => ({ g, rows: g.rows.filter(r => matchesQuery(r.search, q)) })).filter(x => x.rows.length);
            if (!groups.length) return none;
            return groups.map(({ g, rows: rs }) => {
                const title = g.key === 'queue' ? h.groupQueue : g.key === 'done' ? h.groupDone : g.key === 'skip' ? h.groupSkip
                    : g.key === 'noRegion' ? h.groupNoRegion : '';
                const note = g.key === 'queue' ? (g.archive ? h.groupArchiveNote : h.groupQueueNote) : '';
                return `<section class="hm-group" data-group="${g.key}">`
                    + (title ? `<div class="hm-group-head"><h3 class="hm-group-title">${esc(title)}</h3>${note ? `<span class="hm-group-note">${esc(note)}</span>` : ''}</div>` : '')
                    + `<div class="hm-rows">${page(g.key, rs.map(r => this.historyManageRegionRow(r, g.key === 'all')))}</div></section>`;
            }).join('');
        }
        if (view.tab === 'places') {
            if (!Object.keys(d.payload!.places).length) return `<p class="hm-empty">${esc(h.placesEmpty)}</p>`;
            const r1 = !!d.payload!.regions;
            // The suggestions lead only to "Find local history…" (R6): without that flow they are not shown.
            const canFind = !!this.historyManagePlaceHook('find');
            const groups = rows.places.filter(g => g.key !== 'suggest' || canFind)
                .map(g => ({ g, rows: g.rows.filter(r => matchesQuery(r.search, q)) })).filter(x => x.rows.length);
            if (!groups.length) return none;
            return groups.map(({ g, rows: rs }) => {
                const title = g.key === 'unassigned' ? h.unassigned : g.key === 'suggest' ? h.suggest : `${h.allPlaces} · ${g.rows.length}`;
                const note = g.key === 'suggest' ? `<span class="hm-group-note">${esc(h.suggestNote)}</span>` : '';
                const sort = g.key === 'all' && r1
                    ? `<label class="hm-sort"><span class="sr-only">${esc(h.sortLabel)}</span><select data-hm="sort" aria-label="${esc(h.sortLabel)}">`
                        + `<option value="persons"${SettingsManager.getHistoryPlacesSort() === 'persons' ? ' selected' : ''}>${esc(h.sortPersons)}</option>`
                        + `<option value="alpha"${SettingsManager.getHistoryPlacesSort() === 'alpha' ? ' selected' : ''}>${esc(h.sortAlpha)}</option></select></label>`
                    : '';
                return `<section class="hm-group" data-group="${g.key}"><div class="hm-group-head"><h3 class="hm-group-title">${esc(title)}</h3>${note}${sort}</div>`
                    + `<div class="hm-rows">${page(g.key, rs.map(r => this.historyManagePlaceRow(r, g.key)))}</div></section>`;
            }).join('');
        }
        if (view.tab === 'hidden') {
            const note = `<p class="hm-note">${esc(h.hiddenListNote)}</p>`;
            if (!rows.hidden.length) return note + `<p class="hm-empty">${esc(h.hiddenEmpty)}</p>`;
            const items = rows.hidden.map((r, i) => ({ r, i })).filter(x => matchesQuery(x.r.search, q));
            if (!items.length) return note + none;
            const canHide = manageCan(d.env, 'hide') || manageCan(d.env, 'hideAll');
            return note + `<div class="hm-rows">${page('hidden', items.map(({ r, i }) => this.historyManageHiddenRow(r, i, canHide)))}</div>`;
        }
        const note = `<p class="hm-note">${esc(h.deletedNote)}</p>`;
        const items = rows.deleted.filter(r => matchesQuery(r.search, q));
        if (!items.length) return note + none;
        const canRestore = manageCan(d.env, 'delete');
        return note + `<div class="hm-rows">${page('deleted', items.map(r => this.historyManageDeletedRow(r, canRestore)))}</div>`;
    },

    historyManageRegionRow(r: RegionRow, plain: boolean): string {
        const h = strings.history;
        const mark = r.kind === 'local' ? '<span class="hm-mark is-local" aria-hidden="true"></span>'
            : r.kind === 'place' ? '<span class="hm-mark is-place" aria-hidden="true">▲</span>' : '';
        const busy = view.busy.has(r.key);
        const link = r.link
            ? ` <button type="button" class="link hm-row-link" data-hm="${r.link}" data-key="${esc(r.key)}"${busy ? ' disabled' : ''}>${esc(r.link === 'searchAgain' ? h.searchAgain : h.showAgain)}</button>` : '';
        const state = r.state
            ? `<span class="hm-r-state-line"><span class="hm-glyph" aria-hidden="true">${esc(r.glyph)}</span><span>${esc(r.state)}</span></span>`
                + (r.why ? `<span class="hm-r-why">${esc(r.why)}</span>` : '') + link
            : link;
        const actions = this.historyManageRegionActions(r);
        const note = view.notes.get(r.key);
        return `<div class="hm-row hm-region${r.dim ? ' is-dim' : ''}${plain ? ' is-plain' : ''}${r.open ? ' is-open' : ''}" data-key="${esc(r.key)}"`
            + `${r.open ? ` data-hm="open" tabindex="0" role="button" aria-label="${esc(r.name)}"` : ''}>`
            + `<div class="hm-r-name"><span class="hm-r-title-line">${mark}<span class="hm-r-title">${esc(r.name)}</span>`
            + (r.parent ? `<span class="hm-r-parent">${esc(r.parent)}</span>` : '') + '</span>'
            + (r.meta ? `<span class="hm-r-meta">${esc(r.meta)}</span>` : '')
            + (r.gaps ? `<span class="hm-r-gaps">${esc(r.gaps)}</span>` : '') + '</div>'
            + `<div class="hm-r-state tone-${r.tone}">${state}</div>`
            + `<div class="hm-r-count"><span class="hm-r-events">${r.events === null ? '–' : r.events}</span>`
            + (r.hidden ? `<span class="hm-r-hidden">${esc(h.regionHidden(r.hidden))}</span>` : '') + '</div>'
            + `<div class="hm-r-act">${actions.length
                ? `<button type="button" class="hm-dots" data-hm="menu" data-kind="region" data-key="${esc(r.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(h.more)}"${busy ? ' disabled' : ''}>⋯</button>` : ''}`
            + `<span class="hm-chev" aria-hidden="true">${r.open ? '›' : ''}</span></div>`
            + '</div>'
            + (note ? this.historyManageNote(r.key, note) : '');
    },

    /** The "⋯" items a region row has. */
    historyManageRegionActions(r: RegionRow): { id: string; label: string; sub: string }[] {
        const h = strings.history;
        const out: { id: string; label: string; sub: string }[] = [];
        if (r.actions.includes('first')) out.push({ id: 'first', label: h.findFirst, sub: h.findFirstSub });
        if (r.actions.includes('hideAll')) out.push({ id: 'hideAll', label: h.hideAllMenu, sub: h.hideAllSub });
        if (r.actions.includes('skip')) out.push({ id: 'skip', label: h.skipRegionMenu, sub: h.skipRegionSub });
        return out;
    },

    historyManagePlaceRow(r: PlaceRow, group: string): string {
        const h = strings.history;
        const busy = view.busy.has(`place:${r.key}`);
        const actions = this.historyManagePlaceActions(r);
        const assign = r.assign && this.historyManagePlaceHook('assign');
        const find = r.find && this.historyManagePlaceHook('find');
        const note = view.notes.get(`place:${r.key}`);
        return `<div class="hm-row hm-place${r.dim ? ' is-dim' : ''}" data-place="${esc(r.key)}" data-group="${esc(group)}">`
            + `<div class="hm-p-main"><span class="hm-p-name">${esc(r.name)}</span>`
            + (r.meta ? `<span class="hm-p-meta">${esc(r.meta)}</span>` : '')
            + (group === 'unassigned' && !r.meta && r.persons ? `<span class="hm-p-meta">${esc(h.placePersons(r.persons))}</span>` : '')
            + (r.why ? `<span class="hm-p-why">${esc(r.why)}</span>` : '') + '</div>'
            + (r.state || r.link ? `<span class="hm-p-state tone-${r.tone}">${esc(r.state)}`
                + (r.link ? ` <button type="button" class="link hm-row-link" data-hm="searchAgainPlace" data-key="${esc(r.key)}"${busy ? ' disabled' : ''}>${esc(h.searchAgain)}</button>` : '')
                + '</span>' : '')
            + (r.events !== null && group === 'all' ? `<span class="hm-p-count">${r.events}</span>` : '')
            + (assign ? `<button type="button" class="hm-assign" data-hm="assign" data-key="${esc(r.key)}">${esc(h.assign)}</button>` : '')
            + (find ? `<button type="button" class="link hm-row-link" data-hm="find" data-key="${esc(r.key)}">${esc(h.placeFind)}</button>` : '')
            + (actions.length ? `<button type="button" class="hm-dots" data-hm="menu" data-kind="place" data-key="${esc(r.key)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(h.more)}"${busy ? ' disabled' : ''}>⋯</button>` : '')
            + '</div>'
            + (note ? this.historyManageNote(`place:${r.key}`, note) : '');
    },

    /** A place's "⋯" items (R5 / R6 only once their flows are there). */
    historyManagePlaceActions(r: PlaceRow): { id: string; label: string; sub: string }[] {
        const h = strings.history;
        const out: { id: string; label: string; sub: string }[] = [];
        if (r.actions.includes('changeRegion') && this.historyManagePlaceHook('assign')) out.push({ id: 'assign', label: h.changeRegion, sub: '' });
        if (r.actions.includes('placeFind') && this.historyManagePlaceHook('find')) out.push({ id: 'find', label: h.placeFind, sub: '' });
        if (r.actions.includes('skip')) out.push({ id: 'skipPlace', label: h.skipPlaceMenu, sub: '' });
        if (r.actions.includes('openInPlaces')) out.push({ id: 'openInPlaces', label: `${h.openInPlaces} ›`, sub: '' });
        return out;
    },

    /**
     * A place flow of a later part: region choice (R5, `openHistoryRegionPicker(key)`)
     * or its own history (R6, `openHistoryPlaceFind(key)`). Not there: not offered.
     */
    historyManagePlaceHook(which: 'assign' | 'find'): ((key: string) => void) | null {
        const ui = this as unknown as Record<string, unknown>;
        const fn = ui[which === 'assign' ? 'openHistoryRegionPicker' : 'openHistoryPlaceFind'];
        return typeof fn === 'function' ? (key: string) => (fn as (k: string) => void).call(this, key) : null;
    },

    historyManageHiddenRow(r: HiddenRow, index: number, canShow: boolean): string {
        const h = strings.history;
        return `<div class="hm-row hm-hidden${r.region ? ' is-region' : ''}" data-index="${index}">`
            + `<span class="hm-h-year">${esc(r.year)}</span>`
            + `<span class="hm-h-main"><span class="hm-h-text"${langAttr(r.textLang)}>${esc(r.text)}</span><span class="hm-h-meta">${esc(r.meta)}</span></span>`
            + (canShow ? `<button type="button" class="link hm-h-act" data-hm="restoreHidden" data-index="${index}">${esc(r.region ? h.showAgain : h.restore)}</button>` : '')
            + '</div>';
    },

    historyManageDeletedRow(r: DeletedRow, canRestore: boolean): string {
        const h = strings.history;
        const note = view.notes.get(`deleted:${r.event}`);
        return `<div class="hm-row hm-hidden hm-deleted" data-event="${esc(r.event)}">`
            + `<span class="hm-h-year">${esc(r.year)}</span>`
            + `<span class="hm-h-main"><span class="hm-h-text"${langAttr(r.textLang)}>${esc(r.text)}</span><span class="hm-h-meta">${esc(r.meta)}</span></span>`
            + (canRestore ? `<button type="button" class="link hm-h-act" data-hm="restoreDeleted" data-key="${esc(r.event)}"${view.busy.has(`deleted:${r.event}`) ? ' disabled' : ''}>${esc(h.restoreDeleted)}</button>` : '')
            + '</div>'
            + (note ? this.historyManageNote(`deleted:${r.event}`, note) : '');
    },

    historyManageNote(key: string, note: RowNote): string {
        return `<p class="hm-row-note is-${note.tone}" data-note="${esc(key)}" role="status">${esc(note.text)}`
            + (note.link ? ` <button type="button" class="link" data-hm="noteLink" data-key="${esc(key)}">${esc(note.link.label)}</button>` : '')
            + '</p>';
    },

    /**
     * A detail (§2), nested: its mark, name, sub-line, state (with the gaps)
     * and the region's "⋯" under the header's "‹ History of places" (the
     * header's own title and the switch step aside). The events (filters,
     * list, menus) are drawn into `.hm-detail-body` by history-detail-ui.ts.
     * A redraw of the same detail keeps its scroll and the focused control
     * (`data-hfocus`, with the caret of a text field).
     */
    renderHistoryManageDetail(d: Drawn, rows: TabRows): void {
        const body = document.getElementById('history-manage-body');
        if (!body || !view.detail) return;
        const key = view.detail;
        const same = body.querySelector<HTMLElement>('.hm-detail')?.dataset.key === key;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = same && active && body.contains(active) ? active.closest<HTMLElement>('[data-hfocus]')?.dataset.hfocus ?? null : null;
        const caret = active instanceof HTMLInputElement && active.type === 'search' ? [active.selectionStart, active.selectionEnd] as const : null;
        const scrollTop = same ? body.scrollTop : 0;

        const row = rows.regions.flatMap(g => g.rows).find(r => r.key === key);
        const owner = row?.kind ?? (key === 'local' ? 'local' : key.startsWith('place:') ? 'place' : 'region');
        const title = row?.name ?? regionName({ id: key }, lang());
        const head = this.historyDetailHead(d, key, row);
        const state = [head.state, head.gaps].filter(Boolean).join(' · ');
        const mark = owner === 'local' ? '<span class="hm-mark is-local" aria-hidden="true"></span>'
            : owner === 'place' ? '<span class="hm-mark is-place" aria-hidden="true">▲</span>'
                : '<span class="hm-mark is-region" aria-hidden="true"></span>';
        const dots = row?.actions.length
            ? `<button type="button" class="hm-dots hm-detail-dots" data-hm="menu" data-kind="region" data-key="${esc(key)}" aria-haspopup="menu" aria-expanded="false"`
                + ` aria-label="${esc(strings.history.more)}" data-hfocus="dots"${view.busy.has(key) ? ' disabled' : ''}>⋯</button>` : '';
        const note = view.notes.get(key);
        body.innerHTML = `<div class="hm-detail" data-key="${esc(key)}">`
            + '<div class="hm-detail-head"><div class="hm-detail-line">'
            + `<h3 class="hm-detail-title" tabindex="-1" data-hfocus="title">${mark}<span class="hm-detail-name">${esc(title)}</span>`
            + (head.sub ? ` <span class="hm-detail-sub">${esc(head.sub)}</span>` : '') + '</h3>' + dots + '</div>'
            + (state ? `<p class="hm-detail-state">${esc(state)}</p>` : '')
            + (note ? `<p class="hm-detail-note is-${note.tone}" role="status">${esc(note.text)}</p>` : '')
            + '</div><div class="hm-detail-body"></div></div>';
        this.renderHistoryRegionDetail(body.querySelector('.hm-detail-body') as HTMLElement, key, d);
        body.scrollTop = scrollTop;
        if (!focusKey) return;
        const target = body.querySelector<HTMLElement>(`[data-hfocus="${CSS.escape(focusKey)}"]`);
        target?.focus({ preventScroll: true });
        if (caret && target instanceof HTMLInputElement) {
            try { target.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
        }
    },

    /** Open a row's detail (a click on the row). */
    openHistoryManageDetail(key: string): void {
        view.detail = key;
        this.renderHistoryManage();
        document.querySelector<HTMLElement>(`#${HISTORY_MANAGE_DIALOG_ID} .hm-detail-title`)?.focus({ preventScroll: true });
    },

    /**
     * Escape (§2.1): on a desktop it closes the dialog, detail or not; on a
     * tablet or a phone it leaves a detail first.
     */
    historyManageEscape(): void {
        if (view.detail && !media(MQ_DESKTOP)) this.closeHistoryManageDetail();
        else this.closeHistoryManage();
    },

    /** "‹ History of places": back to the list, its row focused. */
    closeHistoryManageDetail(): void {
        const key = view.detail;
        view.detail = null;
        this.renderHistoryManage();
        if (key) document.querySelector<HTMLElement>(`#history-manage-body [data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    },

    // ─── Events of the dialog (wired once) ────────────────────────────────

    /** Wire the static dialog's handlers (once, at startup). */
    initHistoryManage(): void {
        const modal = document.getElementById(HISTORY_MANAGE_DIALOG_ID);
        if (!modal || modal.dataset.wired) return;
        modal.dataset.wired = '1';
        const input = document.getElementById('history-manage-search') as HTMLInputElement | null;
        input?.addEventListener('input', () => {
            view.query = input.value;
            view.shown.clear();
            this.renderHistoryManage();
        });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                e.stopPropagation();
                input.value = '';
                view.query = '';
                this.renderHistoryManage();
            }
        });
        document.getElementById('history-manage-clear')?.addEventListener('click', () => {
            if (!input) return;
            input.value = '';
            view.query = '';
            this.renderHistoryManage();
            input.focus();
        });
        const tabs = document.getElementById('history-manage-tabs');
        tabs?.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
            if (tab) this.historyManageTab(tab.dataset.tab as ManageTab);
        });
        tabs?.addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const all = Array.from(tabs.querySelectorAll<HTMLElement>('[data-tab]'));
            const at = all.findIndex(t => t.dataset.tab === view.tab);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1
                : e.key === 'ArrowRight' ? (at + 1) % all.length : (at + all.length - 1) % all.length;
            e.preventDefault();
            this.historyManageTab(all[next].dataset.tab as ManageTab);
            tabs.querySelector<HTMLElement>(`[data-tab="${all[next].dataset.tab}"]`)?.focus();
        });
        modal.addEventListener('click', (e) => this.historyManageClick(e));
        modal.addEventListener('change', (e) => {
            const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-hm="sort"]');
            if (!sel) return;
            SettingsManager.setHistoryPlacesSort(sel.value === 'alpha' ? 'alpha' : 'persons');
            this.renderHistoryManage();
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target as HTMLElement;
            if (row.matches?.('.hm-region[data-hm="open"]')) {
                e.preventDefault();
                this.openHistoryManageDetail(row.dataset.key ?? '');
            }
        });
    },

    historyManageTab(tab: ManageTab): void {
        if (view.tab === tab) return;
        view.tab = tab;
        view.shown.clear();
        this.renderHistoryManage();
    },

    /** One click handler for the dialog's buttons and rows. */
    historyManageClick(e: MouseEvent): void {
        const t = e.target as HTMLElement;
        const el = t.closest<HTMLElement>('[data-hm]');
        if (!el || !(e.currentTarget as HTMLElement).contains(el)) return;
        const act = el.dataset.hm;
        const key = el.dataset.key ?? '';
        switch (act) {
            case 'open':
                if (t.closest('button, a, select')) return;
                this.openHistoryManageDetail(key);
                return;
            case 'back': this.closeHistoryManageDetail(); return;
            case 'enable': this.historyEnableSearch(); return;
            case 'state':
                view.stateOpen = !view.stateOpen;
                this.renderHistoryManage();
                document.querySelector<HTMLElement>(`#${HISTORY_MANAGE_DIALOG_ID} .hm-state-toggle`)?.focus();
                return;
            case 'more': {
                const g = el.dataset.group ?? '';
                view.shown.set(g, (view.shown.get(g) ?? PAGE) + PAGE);
                this.renderHistoryManage();
                return;
            }
            case 'menu': this.historyManageMenu(el.dataset.kind as 'region' | 'place', key, el); return;
            case 'searchAgain': void this.historyManageSkip({ region: key, do: 'undo' }, key); return;
            case 'searchAgainPlace': void this.historyManageSkip({ place: key, do: 'undo' }, `place:${key}`); return;
            case 'showAgain': this.historyManageShowAgain(key); return;
            case 'assign': this.historyManagePlaceHook('assign')?.(key); return;
            case 'find': this.historyManagePlaceHook('find')?.(key); return;
            case 'restoreHidden': this.historyManageRestoreHidden(Number(el.dataset.index)); return;
            case 'restoreDeleted': void this.historyManageRestoreDeleted(key); return;
            case 'noteLink': view.notes.get(key)?.link?.run(); return;
            default: return;
        }
    },

    /** A row's "⋯": a menu by the button; on a phone a bottom sheet with Cancel. */
    historyManageMenu(kind: 'region' | 'place', key: string, anchor: HTMLElement): void {
        const d = this.historyManageDrawn();
        if (!d?.payload) return;
        const rows = this.historyManageRows(d);
        let head = '';
        let items: { id: string; label: string; sub: string }[] = [];
        if (kind === 'region') {
            const r = rows.regions.flatMap(g => g.rows).find(x => x.key === key);
            if (!r) return;
            head = [r.name, r.state].filter(Boolean).join(' · ');
            items = this.historyManageRegionActions(r);
        } else {
            const r = rows.places.flatMap(g => g.rows).find(x => x.key === key);
            if (!r) return;
            head = [r.name, r.meta].filter(Boolean).join(' · ');
            items = this.historyManagePlaceActions(r);
        }
        if (!items.length) return;
        const run = (id: string): void => this.historyManageRowAction(id, key);
        const item = (cls: string, it: { id: string; label: string; sub: string }): string =>
            `<button type="button" role="menuitem" class="${cls}" data-scope="${esc(it.id)}">`
            + `<span class="pm-lifeline-hmenu-label">${esc(it.label)}</span>${it.sub ? `<span class="pm-lifeline-hmenu-hint">${esc(it.sub)}</span>` : ''}</button>`;
        if (media(MQ_MOBILE)) {
            const sheet = this.showLifelineHistorySheet('hm-menu-sheet', 'menu', head,
                `<div class="pm-lifeline-hsheet-head">${esc(head)}</div><div class="bottom-sheet-items">${items.map(it => item('bottom-sheet-item pm-lifeline-hsheet-item', it)).join('')}</div>`
                + `<button type="button" class="bottom-sheet-item pm-lifeline-hsheet-cancel">${esc(strings.buttons.cancel)}</button>`);
            sheet.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const row = target.closest<HTMLElement>('[data-scope]');
                if (row) {
                    this.hideBottomSheet();
                    run(row.dataset.scope ?? '');
                } else if (target.closest('.pm-lifeline-hsheet-cancel')) {
                    this.hideBottomSheet();
                }
            });
            sheet.addEventListener('keydown', (e) => this.lifelineHistoryMenuKeys(e, sheet));
            sheet.querySelector<HTMLElement>('[data-scope]')?.focus({ preventScroll: true });
            return;
        }
        if (anchor.getAttribute('aria-expanded') === 'true') {
            this.closeLifelineHistoryPopups();
            anchor.focus();
            return;
        }
        this.closeLifelineHistoryPopups();
        const menu = document.createElement('div');
        menu.className = 'pm-lifeline-hmenu hm-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', head);
        menu.innerHTML = `<div class="pm-lifeline-hmenu-head" role="presentation">${esc(head)}</div>`
            + items.map(it => item('pm-lifeline-hmenu-item', it)).join('');
        menu.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-scope]');
            if (!row) return;
            e.stopPropagation();
            this.closeLifelineHistoryPopups();
            anchor.setAttribute('aria-expanded', 'false');
            run(row.dataset.scope ?? '');
        });
        this.openLifelineHistoryPopup(menu, anchor, (e) => this.lifelineHistoryMenuKeys(e, menu));
        menu.querySelector<HTMLElement>('[data-scope]')?.focus();
    },

    historyManageRowAction(id: string, key: string): void {
        switch (id) {
            case 'first': void this.historyManageFirst(key); return;
            case 'hideAll': void this.historyManageHideAll(key); return;
            case 'skip': void this.historyManageSkipRegion(key); return;
            case 'skipPlace': void this.historyManageSkipPlace(key); return;
            case 'assign': this.historyManagePlaceHook('assign')?.(key); return;
            case 'find': this.historyManagePlaceHook('find')?.(key); return;
            case 'openInPlaces': this.historyManageOpenInPlaces(key); return;
            default: return;
        }
    },

    // ─── Row actions (§3.3–§3.5, §5.2) ─────────────────────────────────────

    /** A region's name in the UI language (its id when the payload has none). */
    historyManageRegionName(key: string): string {
        const d = this.historyManageDrawn();
        const r = d?.payload?.regions?.[key] ?? d?.payload?.events.find(e => e.region?.id === key)?.region;
        return regionName(r ?? { id: key }, lang());
    },

    /** A refusal of a write (§3.7): busy under the row, the rest a toast with the bridge's sentence. The rows stay. */
    historyManageRefused(rowKey: string, r: HistoryWriteRefusal): void {
        const h = strings.history;
        if (r.code === 'busy') {
            view.notes.set(rowKey, { text: h.errBusy, tone: 'error' });
        } else if (r.code === 'off') {
            view.notes.set(rowKey, {
                text: h.manageOff, tone: 'info',
                ...(r.link || this.historyManageContext()?.canLinkOn ? {
                    link: { label: h.enableSearch, run: () => (r.link ? this.launchResearchLink(r.link, 'terminal') : this.historyEnableSearch()) },
                } : {}),
            });
        } else if (r.code === 'archive') {
            view.notes.set(rowKey, { text: h.findArchive(r.reason), tone: 'info' });
        } else if (r.code === 'gone' || r.code === 'done') {
            const ctx = this.historyManageContext();
            if (ctx) void this.readBridgeHistory(ctx.researchId);
        } else {
            const text = r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed);
            this.showToast(text, 5000);
        }
        this.renderHistoryManage();
    },

    /** A write accepted: the research's head is the app's own, the history is read again. */
    historyManageWritten(rid: string, before: string | null | undefined, r: { head: string; parent: string }): void {
        if (r.head) this.researchTakeOwnWriteHead(rid, before ?? '', r.head, r.parent);
        void this.readBridgeHistory(rid);
    },

    /** "Find first" (§5.2): the sentence under the row; again = the same sentence. */
    async historyManageFirst(key: string): Promise<void> {
        const d = this.historyManageDrawn();
        if (!d?.base || view.busy.has(key)) return;
        const h = strings.history;
        view.busy.add(key);
        view.notes.delete(key);
        this.renderHistoryManage();
        const before = this.researchHeadNow(d.rid);
        const scheme = announcedResearchScheme();
        const r = await postBridgeFirst(d.base, key, d.features, { tree: d.rid, ...(scheme ? { scheme } : {}) });
        view.busy.delete(key);
        if (!r.ok) {
            if (r.code === 'invalid' && r.bridgeCode === 'history.region') view.notes.set(key, { text: h.findMapping, tone: 'info' });
            else { this.historyManageRefused(key, r); return; }
            this.renderHistoryManage();
            return;
        }
        const pace = d.env.pace === 'rare' ? h.firstPaceRare : d.env.pace === 'idle' ? h.firstPaceIdle : d.env.pace ? h.firstPaceSometimes : '';
        view.notes.set(key, { text: h.firstDone(this.historyManageRegionName(key), pace), tone: 'info' });
        this.historyManageWritten(d.rid, before, r);
        this.renderHistoryManage();
    },

    /** "Hide all in this tree" (§3.4): confirmed, then into the queue like every hiding; a toast with Undo. */
    async historyManageHideAll(key: string): Promise<void> {
        const h = strings.history;
        const name = this.historyManageRegionName(key);
        const ok = await this.showConfirm(`${h.hideAllBody} ${h.hideAllUndo}`, h.hideAllTitle(name), {
            confirmLabel: h.hideAllConfirm,
        });
        if (!ok) return;
        void this.applyHistoryHide({ region: key, at: nowIso() });
        this.showToast(h.toastHiddenAll(name), 8000, {
            kind: 'history-hide',
            action: { label: h.undo, run: () => { void this.applyHistoryHide({ region: key, do: 'show', at: nowIso() }); } },
        });
    },

    /** "Show again" of a region hidden as a whole. */
    historyManageShowAgain(key: string): void {
        const h = strings.history;
        const name = this.historyManageRegionName(key);
        void this.applyHistoryHide({ region: key, do: 'show', at: nowIso() });
        this.showToast(h.toastShownAgain(name), 6000, {
            kind: 'history-hide',
            action: { label: h.undo, run: () => { void this.applyHistoryHide({ region: key, at: nowIso() }); } },
        });
    },

    /** "Do not search for this tree" (§3.5), confirmed. */
    async historyManageSkipRegion(key: string): Promise<void> {
        const h = strings.history;
        const name = this.historyManageRegionName(key);
        const ok = await this.showConfirm(h.skipRegionBody, h.skipRegionTitle(name), { confirmLabel: h.skipConfirm });
        if (ok) await this.historyManageSkip({ region: key }, key);
    },

    /** "Do not search for this place" (§3.5), confirmed. */
    async historyManageSkipPlace(key: string): Promise<void> {
        const h = strings.history;
        const d = this.historyManageDrawn();
        const name = d ? d.names.place(key) : key;
        const ok = await this.showConfirm(h.skipPlaceBody, h.skipPlaceTitle(name), { confirmLabel: h.skipConfirm });
        if (ok) await this.historyManageSkip({ place: key }, `place:${key}`);
    },

    /** `POST /history/skip` (or its undo): a toast, Undo for a skip; the history read again. */
    async historyManageSkip(body: HistorySkipBody, rowKey: string): Promise<void> {
        const d = this.historyManageDrawn();
        if (!d?.base || view.busy.has(rowKey)) return;
        const h = strings.history;
        view.busy.add(rowKey);
        view.notes.delete(rowKey);
        this.renderHistoryManage();
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeSkip(d.base, body, d.features);
        view.busy.delete(rowKey);
        if (!r.ok) { this.historyManageRefused(rowKey, r); return; }
        this.historyManageWritten(d.rid, before, r);
        const undo = body.do === 'undo';
        const name = 'region' in body ? this.historyManageRegionName(body.region) : d.names.place(body.place);
        const text = 'region' in body ? (undo ? h.toastSearchAgain(name) : h.toastSkipped(name))
            : (undo ? h.toastSearchAgainPlace(name) : h.toastSkippedPlace(name));
        const back: HistorySkipBody = 'region' in body ? { region: body.region, ...(undo ? {} : { do: 'undo' as const }) }
            : { place: body.place, ...(undo ? {} : { do: 'undo' as const }) };
        this.showToast(text, undo ? 4000 : 8000, undo ? {} : {
            action: { label: h.undo, run: () => { void this.historyManageSkip(back, rowKey); } },
        });
        this.renderHistoryManage();
    },

    /** The Hidden tab's "Restore" / "Show again". */
    historyManageRestoreHidden(index: number): void {
        const d = this.historyManageDrawn();
        if (!d?.payload) return;
        const row = hiddenRows(d.payload, d.env, d.names)[index];
        if (!row) return;
        const by: EffectiveHidden = row.hide;
        if (by.region && !by.event) {
            this.historyManageShowAgain(by.region);
            return;
        }
        this.restoreHistoryHide(by);
    },

    /** The Deleted tab's "Restore" (`do: "restore"`). */
    async historyManageRestoreDeleted(event: string): Promise<void> {
        const d = this.historyManageDrawn();
        const rowKey = `deleted:${event}`;
        if (!d?.base || view.busy.has(rowKey)) return;
        view.busy.add(rowKey);
        this.renderHistoryManage();
        const before = this.researchHeadNow(d.rid);
        const r = await postBridgeDelete(d.base, { event, do: 'restore' }, d.features);
        view.busy.delete(rowKey);
        if (!r.ok) { this.historyManageRefused(rowKey, r); return; }
        this.historyManageWritten(d.rid, before, r);
        this.showToast(strings.history.toastRestored, 4000);
        this.renderHistoryManage();
    },

    /** "Open in Places": the places manager on the tree's spelling of the place; its Close comes back here. */
    historyManageOpenInPlaces(key: string): void {
        const d = this.historyManageDrawn();
        const spelled = d ? d.names.place(key) : key;
        this.showPlacesManager(placeKey(spelled), HISTORY_MANAGE_DIALOG_ID, 'tree');
    },

    /** The research menu's summary under "History of places" ('' none). */
    historyManageMenuSub(): string {
        const ctx = this.historyManageContext();
        if (!ctx?.payload) return '';
        const d = this.historyManageDrawn();
        if (!d) return '';
        const p = ctx.payload;
        const regions = regionGroups(p, d.env, d.names).reduce((n, g) => n + g.rows.filter(r => r.kind === 'region').length, 0);
        return strings.history.manageSummary(regions, p.events.length);
    },

    /** Search on for the tree (the manager's view of it). */
    historyManageSearching(): boolean {
        const d = this.historyManageDrawn();
        return !!d?.payload && manageSearchOn(d.payload, d.env);
    },
});
