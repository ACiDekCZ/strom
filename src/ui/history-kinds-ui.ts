/**
 * The kinds of events the research searches (spec 035, part A): the Search
 * column of Settings → Person card beside the Show switches of the history
 * layer — the history of regions and of places (`experiments.split`), the nine
 * kinds of events (`history.kinds`), whose choice it is (this tree's or the
 * default of the computer's researches) and the row aligning the found events
 * with the choice (`history.align`; the dialog is history-align-ui.ts). The
 * history manager shows the same kinds in its header (`historyKindsManageHtml`).
 *
 * Taking a kind away is written at once through the bridge; adding one is
 * never written here: it waits on this page with the research's estimate
 * until the research's terminal confirms it (the `history-kinds` link), and
 * the next status says it. Without `history.kinds` in the research's status
 * Settings stay exactly as they were.
 */

import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import {
    researchSchemeUrl, HISTORY_KINDS_FEATURE, HISTORY_ALIGN_FEATURE, EXPERIMENTS_SPLIT_FEATURE, type LiveStatus,
} from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { HISTORY_KINDS, alignBackfillCounts, alignHideCount, type HistoryAlignPreview, type HistoryKind } from '../history.js';
import { getHistoryAlign, postHistoryKinds, type HistoryKindsBody, type HistoryKindsRefusal } from '../history-bridge.js';
import { historyKindSvg } from '../history-symbols.js';
import { researchOpenLabel } from './research-open-mark.js';
import { activeResearchId, bridgeBase } from './history-ui.js';
import { uiModule } from './module.js';

/** What changes of the kinds searched wait on this page (never in storage). */
export interface HistoryKindsDraft {
    /** Kinds to switch on: they wait for the research's terminal. */
    pend: Set<HistoryKind>;
    /** Kinds switched off from here (the sentence under the kinds). */
    off: HistoryKind[];
    /** The research's terminal was opened for `pend`; the switches wait for its answer. */
    waiting: boolean;
}

type Origin = 'regions' | 'places';

interface KindsPage extends HistoryKindsDraft {
    /** The research said an alignment would change something now (after a switch-off). */
    alignSuggested: boolean;
    /** The terminal's link of the waiting change (Open again). */
    link?: string;
    /** The waiting change drops the tree's own choice (`inherit`), which adds kinds. */
    inherit?: boolean;
    /** The kinds as the last write from here left them, until the status says the same (or it settles). */
    written?: { kinds: HistoryKind[]; own?: boolean; at: number };
    /** A write on its way (the switches wait). */
    busy: boolean;
    /** Searches of origin switched off from here (their sentence), and those waiting for the terminal. */
    originOff: Set<Origin>;
    originWait: Set<Origin>;
}

const pages = new Map<string, KindsPage>();
/** The estimate of the waiting kinds (`GET /history/align?kinds=`), per research, for the kinds it was asked for. */
const estimates = new Map<string, { key: string; preview: HistoryAlignPreview | null; loading: boolean }>();
/** The alignment's preview for the badge (`GET /history/align`), per research, for the status it was asked at. */
const previews = new Map<string, { key: string; preview: HistoryAlignPreview | null; loading: boolean }>();
/** Writes go one after another (each takes the kinds the previous one left). */
const chains = new Map<string, Promise<void>>();
/** The last status of each research in this page: the column stays (disabled) while its bridge is gone (§5). */
const lastStatus = new Map<string, LiveStatus>();
/** Whether each research's bridge was up at the last look (the column redraws when that changes). */
const lastUp = new Map<string, boolean>();

/** The history manager's kinds box open (this page only). */
let manageOpen = false;

/** How long a written value stands against a status that does not say it yet. */
const WRITTEN_SETTLE_MS = 15_000;
const OPEN_KEY = 'strom.historyKindsOpen';
/** Marks every node this module adds to #history-kinds (removed without the feature). */
const ADDED = 'hk-added';

function page(rid: string): KindsPage {
    let p = pages.get(rid);
    if (!p) {
        p = { pend: new Set(), off: [], waiting: false, alignSuggested: false, busy: false, originOff: new Set(), originWait: new Set() };
        pages.set(rid, p);
    }
    return p;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ordered = (kinds: Iterable<HistoryKind>): HistoryKind[] => {
    const set = new Set(kinds);
    return HISTORY_KINDS.filter(k => set.has(k));
};

const sameKinds = (a: readonly HistoryKind[], b: readonly HistoryKind[]): boolean =>
    a.length === b.length && a.every((k, i) => k === b[i]);

function kindName(k: HistoryKind): string {
    return strings.history.kinds[k];
}

function kindsList(kinds: readonly HistoryKind[]): string {
    return joinAnd(getCurrentLanguage(), kinds.map(kindName));
}

function readOpen(): boolean {
    try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

function writeOpen(open: boolean): void {
    try {
        if (open) sessionStorage.setItem(OPEN_KEY, '1');
        else sessionStorage.removeItem(OPEN_KEY);
    } catch { /* no storage: it stays as it is on this page */ }
}

/** A Search switch (role switch): on, off or waiting for the research's terminal (`pend`). */
function switchHtml(attrs: string, state: 'on' | 'off' | 'pend', label: string, disabled: boolean): string {
    return `<button type="button" role="switch" class="history-search-switch" data-state="${state}" aria-checked="${state === 'on'}"`
        + ` aria-label="${esc(label)}"${disabled ? ' aria-disabled="true"' : ''} ${attrs}><span class="history-search-knob"></span></button>`;
}

export const historyKindsMethods = uiModule({
    /** The research's status for the kinds: the live one, else the last one this page saw (its bridge gone since). */
    historyKindsStatusOf(rid: string): LiveStatus | null {
        return this.researchStatusOf(rid) ?? lastStatus.get(rid) ?? null;
    },

    /** The bridge of the open tree's research came up or went: the Search column follows (§5). */
    historyKindsBridgeChanged(): void {
        const rid = activeResearchId();
        if (!rid || !lastStatus.has(rid)) return;
        const up = this.researchBridgeUp(rid);
        if (lastUp.get(rid) === up) return;
        lastUp.set(rid, up);
        this.renderHistorySettingsIfOpen();
    },

    /**
     * The kinds searched for the open tree's research as the status says them
     * (a write from here stands until the status agrees), or null without `history.kinds`.
     */
    historyKindsSearched(rid: string): { kinds: HistoryKind[]; own?: boolean; def?: HistoryKind[] } | null {
        const status = this.historyKindsStatusOf(rid);
        const ex = status?.experiments;
        if (!status || !(status.features ?? []).includes(HISTORY_KINDS_FEATURE) || !ex?.kinds) return null;
        const w = pages.get(rid)?.written;
        const own = w?.own ?? ex.kindsOwn;
        return {
            kinds: w ? w.kinds : ex.kinds,
            ...(own !== undefined ? { own } : {}),
            ...(ex.kindsDefault ? { def: ex.kindsDefault } : {}),
        };
    },

    /** A status of a research: kinds that came on leave the waiting ones (a toast), the origin switches settle. */
    noteHistoryKindsStatus(rid: string, status: LiveStatus): void {
        lastStatus.set(rid, status);
        lastUp.set(rid, true);
        const p = pages.get(rid);
        const ex = status.experiments;
        if (!p || !ex) return;
        if (p.written && ex.kinds && ((sameKinds(ex.kinds, p.written.kinds) && (p.written.own === undefined || p.written.own === ex.kindsOwn))
            || Date.now() - p.written.at > WRITTEN_SETTLE_MS)) {
            delete p.written;
        }
        if (ex.kinds && p.pend.size) {
            const came = ordered([...p.pend].filter(k => ex.kinds!.includes(k)));
            const settled = p.inherit && ex.kindsOwn === false;
            if (came.length || settled) {
                for (const k of came) p.pend.delete(k);
                if (settled) p.pend.clear();
                p.off = p.off.filter(k => !came.includes(k));
                if (came.length) {
                    const h = strings.history;
                    this.showToast(came.length === 1 ? h.tOnOne(kindsList(came)) : h.tOnMany(kindsList(came)), 5000);
                }
            }
            if (!p.pend.size) {
                p.waiting = false;
                delete p.link;
                delete p.inherit;
            }
        }
        for (const o of [...p.originWait]) if (ex[o] === true) p.originWait.delete(o);
        for (const o of [...p.originOff]) if (ex[o] === true) p.originOff.delete(o);
    },

    /** Settings just opened: the sentences of earlier switch-offs go (what waits for the terminal stays). */
    historyKindsFresh(): void {
        for (const p of pages.values()) {
            p.off = [];
            p.alignSuggested = false;
            p.originOff.clear();
        }
        previews.clear();
    },

    /** Test hook: forget the page's state (a new page). */
    resetHistoryKindsState(): void {
        pages.clear(); estimates.clear(); previews.clear(); chains.clear(); lastStatus.clear(); lastUp.clear();
        manageOpen = false;
    },

    /**
     * The Search column (spec 035 §1, §2, §5): added into #history-kinds only
     * with `history.kinds` in the research's status; without it every added
     * node and class goes and the box is as it always was.
     */
    renderHistorySearch(): void {
        const box = document.getElementById('history-kinds');
        if (!box) return;
        const rid = activeResearchId();
        const status = rid ? this.historyKindsStatusOf(rid) : null;
        const searched = rid ? this.historyKindsSearched(rid) : null;
        // Keep the focus on the same control across the redraw.
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && box.contains(active) && active.closest(`.${ADDED}`)
            ? (active.id ? `#${active.id}` : active.dataset.searchKind ? `[data-search-kind="${active.dataset.searchKind}"]`
                : active.dataset.hkAction ? `[data-hk-action="${active.dataset.hkAction}"]` : '')
            : '';
        box.querySelectorAll(`.${ADDED}`).forEach(n => n.remove());
        box.classList.remove('has-search', 'no-place', 'is-down');
        if (!rid || !status || !searched) return;
        const h = strings.history;
        const region = box.querySelector<HTMLElement>('[data-kind="region"]');
        const place = box.querySelector<HTMLElement>('[data-kind="place"]');
        const local = box.querySelector<HTMLElement>('[data-kind="local"]');
        const notes = document.getElementById('history-kinds-tree');
        if (!region || !local || !notes) return;
        const add = (html: string, after: Element | null, where: InsertPosition = 'afterend'): void => {
            (after ?? box).insertAdjacentHTML(after ? where : 'beforeend', html);
        };

        // §5: an archive (or a research waiting for its agent) does not search — one sentence, nothing to switch.
        if (status.treeState && status.treeState !== 'research') {
            add(`<div class="settings-row-dependent history-kinds-note ${ADDED}" id="history-kinds-archive">${esc(h.findArchive(''))}</div>`, notes);
            return;
        }
        const up = this.researchBridgeUp(rid);
        const features = status.features ?? [];
        const p = page(rid);
        box.classList.add('has-search');
        if (place?.hidden) box.classList.add('no-place');
        if (!up) box.classList.add('is-down');
        const disabled = !up || p.busy;

        // The column header (§1.1).
        add(`<div class="history-kinds-head ${ADDED}" aria-hidden="true">`
            + `<span class="history-kinds-col is-show"><b>${esc(h.colShow)}</b> <small>${esc(h.colShowSub)}</small></span>`
            + `<span class="history-kinds-col is-search"><b>${esc(h.colSearch)}</b><small>${esc(h.colSearchSub)}</small></span></div>`, box, 'afterbegin');

        // The searches of origin (§1.2): regions; places and the research's own records share one cell.
        const split = features.includes(EXPERIMENTS_SPLIT_FEATURE) && status.experiments?.regions !== undefined && status.experiments?.places !== undefined
            ? (up ? this.historySplitNow(rid) : { regions: !!status.experiments?.regions, places: !!status.experiments?.places })
            : null;
        const originState = (o: Origin): 'on' | 'off' | 'pend' => (p.originWait.has(o) ? 'pend' : split?.[o] ? 'on' : 'off');
        const originSwitch = (o: Origin): string => switchHtml(
            `id="history-search-${o}" onclick="window.Strom.UI.historyOriginSearchClick('${o}')"`,
            originState(o), `${h.colSearch}: ${o === 'regions' ? h.kindRegion : h.localPair}`, disabled);
        add(`<span class="history-search-cell is-region ${ADDED}">${split ? originSwitch('regions') : ''}</span>`, region);
        add(`<span class="history-search-pair ${ADDED}">${split ? `${originSwitch('places')}<span class="history-search-pair-label">${esc(h.localPair)}</span>` : ''}</span>`, local);

        // Below the notes: the origins' sentences, then the kinds.
        let html = '';
        if (!up) html += `<div class="history-kinds-down ${ADDED}">${esc(h.storiesBridgeDown)}</div>`;
        const originNotes: string[] = [];
        for (const o of ['regions', 'places'] as const) {
            const name = o === 'regions' ? h.switchRegions : h.switchPlaces;
            if (p.originWait.has(o)) originNotes.push(`<p>${esc(h.originWait(name))}</p>`);
            else if (p.originOff.has(o) && split && !split[o]) {
                originNotes.push(`<p>${esc(h.originOff(name))} <button type="button" class="link" data-hk-action="on-${o}"`
                    + ` onclick="window.Strom.UI.historyOriginSearchClick('${o}')">${researchOpenLabel(h.switchOnLink, { size: 12 })}</button></p>`);
            }
        }
        if (up && originNotes.length) html += `<div class="history-origin-note ${ADDED}" id="history-origin-note">${originNotes.join('')}</div>`;

        // The kinds' row and, open, the kinds (§1.3, §1.4).
        const open = readOpen();
        const on = searched.kinds;
        const offKinds = HISTORY_KINDS.filter(k => !on.includes(k));
        const sum = on.length === HISTORY_KINDS.length ? h.kindsAll : on.length ? h.kindsSum(on.length) : h.kindsNone;
        const parts = [sum];
        if (offKinds.length && on.length) parts.push(h.kindsOffList(kindsList(offKinds)));
        if (searched.own !== undefined) parts.push(searched.own ? h.kindsOwnTag : h.kindsDefTag);
        html += `<button type="button" class="history-kinds-toggle ${ADDED}" aria-expanded="${open}" aria-controls="history-kinds-search"`
            + ` onclick="window.Strom.UI.historyKindsToggle()"><span class="settings-text"><span class="settings-name">${esc(h.kindsTitle)}</span>`
            + `<span class="settings-desc" id="history-kinds-sum">${esc(parts.join(' · '))}</span></span><span class="history-kinds-chev" aria-hidden="true"></span></button>`;
        if (open) html += this.historyKindsPanelHtml(rid, searched, p, up);
        add(html, notes);
        if (open && up && features.includes(HISTORY_ALIGN_FEATURE)) this.historyAlignBadgeLoad(rid, status);
        if (focusKey) box.querySelector<HTMLElement>(focusKey)?.focus();
    },

    /** The open kinds: the sentence, whose choice, nine switches, the notes and the alignment's row. */
    historyKindsPanelHtml(rid: string, searched: { kinds: HistoryKind[]; own?: boolean; def?: HistoryKind[] }, p: KindsPage, up: boolean): string {
        const h = strings.history;
        const status = this.historyKindsStatusOf(rid);
        const features = status?.features ?? [];
        const locked = !up || p.busy || p.waiting;
        let html = `<div class="history-kinds-search ${ADDED}" id="history-kinds-search">`;
        html += `<p class="history-kinds-only">${esc(h.kindsOnlySearch)}</p>`;
        if (searched.own !== undefined) {
            const seg = (scope: 'default' | 'tree', label: string): string => {
                const pressed = (scope === 'tree') === searched.own;
                return `<button type="button" data-scope="${scope}" aria-pressed="${pressed}"${locked ? ' aria-disabled="true"' : ''}`
                    + ` onclick="window.Strom.UI.historyKindsScopeClick('${scope}')">${esc(label)}</button>`;
            };
            const treeId = DataManager.getCurrentTreeId();
            const tree = (treeId ? TreeManager.getTreeMetadata(treeId)?.name : '') ?? '';
            html += `<div class="history-kinds-scope"><span class="history-kinds-scope-label" id="history-kinds-scope-label">${esc(h.scopeLabel)}</span>`
                + `<span class="history-kinds-seg" role="group" aria-labelledby="history-kinds-scope-label">${seg('default', h.scopeDefault)}${seg('tree', h.scopeTree)}</span></div>`
                + `<p class="history-kinds-scope-note">${esc(searched.own ? h.scopeTreeNote(tree) : h.scopeDefaultNote)}</p>`;
        }
        html += '<div class="history-kinds-list">';
        for (const k of HISTORY_KINDS) {
            const state = p.pend.has(k) ? 'pend' : searched.kinds.includes(k) ? 'on' : 'off';
            const name = kindName(k);
            const shown = name.charAt(0).toLocaleUpperCase() + name.slice(1);
            html += `<label class="history-kind-search-row" data-state="${state}"><span class="history-kind-search-mark">${historyKindSvg(k, 16)}</span>`
                + `<span class="history-kind-search-name">${esc(shown)}</span>`
                + switchHtml(`data-search-kind="${k}" onclick="window.Strom.UI.historyKindSearchClick('${k}')"`, state, `${h.colSearch}: ${shown}`, locked)
                + '</label>';
        }
        html += '</div>';
        html += `<div class="history-kinds-search-note" id="history-kinds-search-note" aria-live="polite">${up ? this.historyKindsNotesHtml(rid, searched, p) : ''}</div>`;
        if (up) {
            if (features.includes(HISTORY_ALIGN_FEATURE)) {
                const pv = previews.get(rid)?.preview;
                const n = pv ? alignHideCount(pv) : 0;
                html += `<button type="button" class="settings-row-link history-align-link" id="history-align-link" onclick="window.Strom.UI.openHistoryAlign()">`
                    + `<span class="settings-text"><span class="settings-name">${esc(h.alignLink)}</span><span class="settings-desc">${esc(h.alignDesc)}</span></span>`
                    + (n ? `<span class="history-align-badge">${esc(h.alignBadge(n))}</span>` : '') + '</button>';
            } else {
                html += `<div class="history-align-none" id="history-align-none">${esc(h.alignNoFeature)} <button type="button" class="link" data-hk-action="open-research"`
                    + ` onclick="window.Strom.UI.historyKindsOpenResearch()">${researchOpenLabel(h.openResearch, { size: 12 })}</button></div>`;
            }
        }
        return html + '</div>';
    },

    /**
     * The notes under the kinds (§2): kinds switched off, kinds waiting (with
     * the estimate) or the terminal waited for, none searched. `ids` false: the
     * manager's copy (Settings may be open beneath it with the same notes).
     */
    historyKindsNotesHtml(rid: string, searched: { kinds: HistoryKind[] }, p: KindsPage, ids = true): string {
        const h = strings.history;
        const features = this.historyKindsStatusOf(rid)?.features ?? [];
        const align = features.includes(HISTORY_ALIGN_FEATURE);
        let html = '';
        const off = p.off.filter(k => !searched.kinds.includes(k));
        if (off.length) {
            const pv = previews.get(rid)?.preview;
            const suggest = align && (p.alignSuggested || (!!pv && alignHideCount(pv) > 0));
            html += `<div class="history-kinds-off">${esc(off.length === 1 ? h.offOne(kindsList(off)) : h.offMany(kindsList(off)))} ${esc(h.offKeep)}`
                + (suggest ? ` <button type="button" class="link" data-hk-action="align" onclick="window.Strom.UI.openHistoryAlign()">${esc(h.alignLink)}</button>` : '')
                + '</div>';
        }
        if (p.pend.size) {
            const pend = ordered(p.pend);
            const chips = pend.map(k => `<span class="history-kinds-chip">${historyKindSvg(k, 13)}${esc(kindName(k))}</span>`).join('');
            html += `<div class="history-kinds-pend${p.waiting ? ' is-waiting' : ''}"${ids ? ' id="history-kinds-pend"' : ''}>`;
            if (p.waiting) {
                html += `<p class="history-kinds-pend-title">${esc(h.waitTitle)}</p><div class="history-kinds-chips">${chips}</div>`
                    + `<p>${esc(h.waitBody)}</p><div class="history-kinds-actions">`
                    + `<button type="button" class="primary" data-hk-action="again" onclick="window.Strom.UI.historyKindsPendAction('again')">${researchOpenLabel(h.openAgain, { ai: true })}</button>`;
            } else {
                html += `<p class="history-kinds-pend-title">${esc(h.pendTitle(pend.length))}</p><div class="history-kinds-chips">${chips}</div>`
                    + `<p class="history-kinds-cost">${esc(this.historyKindsCostText(rid, searched.kinds, p))}</p>`
                    + `<p>${esc(h.pendTerminal)}</p><div class="history-kinds-actions">`
                    + `<button type="button" class="primary" data-hk-action="go"${p.busy ? ' aria-disabled="true"' : ''} onclick="window.Strom.UI.historyKindsPendAction('go')">${researchOpenLabel(h.placeGoTerminal, { ai: true })}</button>`;
            }
            html += `<button type="button" class="secondary" data-hk-action="cancel" onclick="window.Strom.UI.historyKindsPendAction('cancel')">${esc(strings.buttons.cancel)}</button></div></div>`;
        }
        if (!searched.kinds.length && !p.pend.size) html += `<div class="history-kinds-alloff">${esc(h.allOff)}</div>`;
        return html;
    },

    /** The estimate of the waiting kinds (`GET /history/align?kinds=…`): loading, the research's numbers, or the plain sentence. */
    historyKindsCostText(rid: string, kinds: HistoryKind[], p: KindsPage): string {
        const h = strings.history;
        const features = this.historyKindsStatusOf(rid)?.features ?? [];
        const base = bridgeBase(rid);
        if (!features.includes(HISTORY_ALIGN_FEATURE) || !base) return h.pendCostNone;
        const want = ordered([...kinds, ...p.pend]);
        const key = want.join(',');
        const e = estimates.get(rid);
        if (!e || e.key !== key) {
            estimates.set(rid, { key, preview: null, loading: true });
            void getHistoryAlign(base, want).then(r => {
                const now = estimates.get(rid);
                if (!now || now.key !== key) return;
                estimates.set(rid, { key, preview: r.ok ? r.preview : null, loading: false });
                this.renderHistorySettingsIfOpen();
            });
            return h.pendCostLoading;
        }
        if (e.loading) return h.pendCostLoading;
        const pv = e.preview;
        if (!pv) return h.pendCostNone;
        const { regions, places } = alignBackfillCounts(pv);
        if (!regions && !places) return h.pendCostNone;
        const pace = pv.pace ?? this.historyKindsStatusOf(rid)?.historyPace;
        const paceText = pace === 'sometimes' ? h.firstPaceSometimes : pace === 'rare' ? h.firstPaceRare : pace === 'idle' ? h.firstPaceIdle : '';
        return h.pendCost(regions, places, pv.sessions, paceText);
    },

    /** The alignment's preview for the badge on its row (asked once per status of the research). */
    historyAlignBadgeLoad(rid: string, status: LiveStatus): void {
        const base = bridgeBase(rid);
        if (!base) return;
        const key = `${status.historyRev ?? ''}|${(status.experiments?.kinds ?? []).join(',')}`;
        const was = previews.get(rid);
        if (was && was.key === key) return;
        // The entry itself marks the load: an answer read before a later write (same key) is dropped.
        const entry = { key, preview: was?.preview ?? null, loading: true };
        previews.set(rid, entry);
        void getHistoryAlign(base).then(r => {
            if (previews.get(rid) !== entry) return;
            previews.set(rid, { key, preview: r.ok ? r.preview : null, loading: false });
            if ((r.ok ? alignHideCount(r.preview) : 0) !== (was?.preview ? alignHideCount(was.preview) : 0)) {
                this.renderHistorySettingsIfOpen();
                this.renderHistoryManageIfOpen();
            }
        });
    },

    /** The alignment dialog read a preview (or aligned: null): the badge takes it, one source for both. */
    historyAlignNotePreview(rid: string, preview: HistoryAlignPreview | null): void {
        const was = previews.get(rid)?.preview ?? null;
        if (!preview) previews.delete(rid);
        else {
            const status = this.historyKindsStatusOf(rid);
            previews.set(rid, { key: `${status?.historyRev ?? ''}|${(status?.experiments?.kinds ?? []).join(',')}`, preview, loading: false });
        }
        if ((preview ? alignHideCount(preview) : 0) !== (was ? alignHideCount(was) : 0)) this.renderHistorySettingsIfOpen();
    },

    /**
     * The history manager's "What the research searches" (spec 035 §1 of part
     * B): under the switches of regions and places, a box with the kinds'
     * summary and "Align history with the settings…"; open, the same nine
     * switches as Settings (one `historyKindSearchClick`) with their notes.
     * '' without `history.kinds`, with the bridge down or for an archive.
     */
    historyKindsManageHtml(rid: string): string {
        const status = this.historyKindsStatusOf(rid);
        const searched = this.historyKindsSearched(rid);
        if (!status || !searched || !this.researchBridgeUp(rid)) return '';
        if (status.treeState && status.treeState !== 'research') return '';
        const h = strings.history;
        const p = page(rid);
        const on = searched.kinds;
        const sum = on.length === HISTORY_KINDS.length ? h.kindsAll : on.length ? h.kindsSum(on.length) : h.kindsNone;
        const align = (status.features ?? []).includes(HISTORY_ALIGN_FEATURE);
        if (manageOpen && align) this.historyAlignBadgeLoad(rid, status);
        const pv = previews.get(rid)?.preview;
        const n = pv ? alignHideCount(pv) : 0;
        let html = '<div class="hm-kinds" id="hm-kinds"><div class="hm-kinds-head">'
            + `<button type="button" class="hm-kinds-toggle" data-hm="kindsToggle" aria-expanded="${manageOpen}" aria-controls="hm-kinds-body">`
            + `<span class="hm-kinds-title">${esc(h.manageKindsTitle)}</span><span class="hm-kinds-chev" aria-hidden="true">▾</span>`
            + `<span class="hm-kinds-sum">${esc(sum)}</span></button>`
            + (align ? `<button type="button" class="link hm-kinds-align" data-hm="align">${esc(h.alignLink)}`
                + (n ? ` <span class="history-align-badge">${esc(h.alignBadge(n))}</span>` : '') + '</button>' : '')
            + '</div>';
        if (manageOpen) {
            const locked = p.busy || p.waiting;
            html += `<div class="hm-kinds-body" id="hm-kinds-body"><p class="hm-kinds-note">${esc(h.manageKindsNote)}</p><div class="hm-kinds-grid">`;
            for (const k of HISTORY_KINDS) {
                const state = p.pend.has(k) ? 'pend' : on.includes(k) ? 'on' : 'off';
                const name = kindName(k);
                const shown = name.charAt(0).toLocaleUpperCase() + name.slice(1);
                html += `<label class="history-kind-search-row hm-kind-row" data-state="${state}"><span class="history-kind-search-mark">${historyKindSvg(k, 15)}</span>`
                    + `<span class="history-kind-search-name">${esc(shown)}</span>`
                    + switchHtml(`data-search-kind="${k}" onclick="window.Strom.UI.historyKindSearchClick('${k}')"`, state, `${h.colSearch}: ${shown}`, locked)
                    + '</label>';
            }
            html += `</div><div class="history-kinds-search-note hm-kinds-notes" aria-live="polite">${this.historyKindsNotesHtml(rid, searched, p, false)}</div></div>`;
        }
        return html + '</div>';
    },

    /** The manager's kinds box open or closed. */
    historyKindsManageToggle(): void {
        manageOpen = !manageOpen;
        this.renderHistoryManageIfOpen();
        document.querySelector<HTMLElement>('#hm-kinds .hm-kinds-toggle')?.focus();
    },

    /** The kinds' row open or closed (kept for the browser tab's session). */
    historyKindsToggle(): void {
        writeOpen(!readOpen());
        this.renderHistorySettingsIfOpen();
        document.querySelector<HTMLElement>('#history-kinds .history-kinds-toggle')?.focus();
    },

    /**
     * A kind's Search switch (§2), shared with the history manager: on → off is
     * written at once; off → it waits (with the estimate) for "Continue in the
     * research"; waiting → it stops waiting.
     */
    historyKindSearchClick(kind: HistoryKind): void {
        const rid = activeResearchId();
        if (!rid || !(HISTORY_KINDS as readonly string[]).includes(kind)) return;
        const searched = this.historyKindsSearched(rid);
        const p = page(rid);
        if (!searched || !this.researchBridgeUp(rid) || p.busy || p.waiting) return;
        if (p.pend.has(kind)) {
            p.pend.delete(kind);
            if (!p.pend.size) delete p.inherit;
        } else if (!searched.kinds.includes(kind)) {
            p.pend.add(kind);
        } else {
            void this.historyKindsWrite(rid, { kinds: searched.kinds.filter(k => k !== kind), scope: searched.own === false ? 'default' : 'tree' }, kind);
            return;
        }
        this.renderHistorySettingsIfOpen();
        this.renderHistoryManageIfOpen();
    },

    /** The history manager redraws its own kinds block when it is open (part B). */
    renderHistoryManageIfOpen(): void {
        if (document.getElementById('history-modal')?.classList.contains('active')) this.renderHistoryManage();
    },

    /**
     * A write of the kinds (taking away, or the choice's owner). Shown at once,
     * taken back with a toast when the research refuses; a refusal that adds a
     * kind (the default had more than the tree) waits like a switch-on.
     */
    async historyKindsWrite(rid: string, body: HistoryKindsBody, offKind?: HistoryKind): Promise<void> {
        const run = async (): Promise<void> => {
            const base = bridgeBase(rid);
            const status = this.historyKindsStatusOf(rid);
            if (!base || !status) return;
            const p = page(rid);
            const h = strings.history;
            const before = p.written;
            const own = this.historyKindsSearched(rid)?.own;
            if ('kinds' in body) p.written = { kinds: ordered(body.kinds), ...(own !== undefined ? { own: body.scope === 'tree' } : {}), at: Date.now() };
            if (offKind && !p.off.includes(offKind)) p.off = [...p.off, offKind];
            p.busy = true;
            this.renderHistorySettingsIfOpen();
            const head = this.researchHeadNow(rid);
            const scheme = announcedResearchScheme();
            const r = await postHistoryKinds(base, body, status.features, { tree: rid, ...(scheme ? { scheme } : {}) });
            p.busy = false;
            if (r.ok) {
                if (r.state) p.written = { kinds: r.state.kinds, own: r.state.kindsOwn, at: Date.now() };
                else if ('inherit' in body) delete p.written;
                if (r.alignSuggested) p.alignSuggested = true;
                if (r.head) this.researchTakeOwnWriteHead(rid, head, r.head, r.parent);
                previews.delete(rid);
            } else {
                if (before) p.written = before;
                else delete p.written;
                if (offKind) p.off = p.off.filter(k => k !== offKind);
                if (r.code === 'link' && 'inherit' in body) {
                    // The default searches more than the tree: dropping the tree's choice adds kinds — the terminal's.
                    const added = r.added?.length ? r.added : ordered((this.historyKindsStatusOf(rid)?.experiments?.kindsDefault ?? [])
                        .filter(k => !(this.historyKindsSearched(rid)?.kinds ?? []).includes(k)));
                    for (const k of added) p.pend.add(k);
                    p.inherit = true;
                    if (r.link) p.link = r.link;
                } else {
                    this.showToast(this.historyKindsRefusalText(r), 6000);
                }
            }
            this.renderHistorySettingsIfOpen();
            this.renderHistoryManageIfOpen();
        };
        const next = (chains.get(rid) ?? Promise.resolve()).then(run, run);
        chains.set(rid, next);
        await next;
    },

    /** The sentence of a refused write of the kinds. */
    historyKindsRefusalText(r: HistoryKindsRefusal): string {
        const h = strings.history;
        if (r.code === 'busy') return h.errBusy;
        if (r.code === 'held' && r.held) return this.researchWriteHeldText(r.held, false).toast;
        if (r.code === 'failed') return h.kindsFailed;
        return r.reason || h.kindsFailed;
    },

    /** The choice's owner (§1.6): this tree's own choice, or the default of the computer's researches. */
    historyKindsScopeClick(scope: 'default' | 'tree'): void {
        const rid = activeResearchId();
        if (!rid) return;
        const searched = this.historyKindsSearched(rid);
        const p = page(rid);
        if (!searched || searched.own === undefined || !this.researchBridgeUp(rid) || p.busy || p.waiting) return;
        if ((scope === 'tree') === searched.own) return;
        void this.historyKindsWrite(rid, scope === 'tree' ? { kinds: searched.kinds, scope: 'tree' } : { scope: 'tree', inherit: true });
    },

    /** The waiting kinds' buttons: continue in the research's terminal, open it again, or cancel. */
    async historyKindsPendAction(action: 'go' | 'again' | 'cancel'): Promise<void> {
        const rid = activeResearchId();
        if (!rid) return;
        const p = page(rid);
        if (action === 'cancel') {
            p.pend.clear();
            p.waiting = false;
            delete p.link;
            delete p.inherit;
        } else if (action === 'again') {
            if (p.link) this.launchResearchLink(p.link, 'terminal');
        } else {
            const searched = this.historyKindsSearched(rid);
            const base = bridgeBase(rid);
            const status = this.historyKindsStatusOf(rid);
            if (!searched || !base || !status || p.busy || !p.pend.size) return;
            const body: HistoryKindsBody = p.inherit ? { scope: 'tree', inherit: true }
                : { kinds: ordered([...searched.kinds, ...p.pend]), scope: searched.own === false ? 'default' : 'tree' };
            p.busy = true;
            this.renderHistorySettingsIfOpen();
            const scheme = announcedResearchScheme();
            const r = await postHistoryKinds(base, body, status.features, { tree: rid, ...(scheme ? { scheme } : {}) });
            p.busy = false;
            if (!r.ok && r.code === 'link' && r.link) {
                p.link = r.link;
                p.waiting = true;
                this.launchResearchLink(r.link, 'terminal');
            } else if (r.ok) {
                // Nothing to add after all (the research has them already).
                if (r.state) p.written = { kinds: r.state.kinds, own: r.state.kindsOwn, at: Date.now() };
                p.pend.clear();
                delete p.inherit;
            } else {
                this.showToast(this.historyKindsRefusalText(r), 6000);
            }
        }
        this.renderHistorySettingsIfOpen();
        this.renderHistoryManageIfOpen();
    },

    /**
     * A search of origin (§2): on → off through the bridge at once with its
     * sentence; off → the research's terminal switches it on (it waits for the
     * status); waiting → it stops waiting.
     */
    async historyOriginSearchClick(which: Origin): Promise<void> {
        const rid = activeResearchId();
        if (!rid || !this.researchBridgeUp(rid)) return;
        const p = page(rid);
        if (p.busy) return;
        const split = this.historySplitNow(rid);
        if (!split) return;
        if (p.originWait.has(which)) {
            p.originWait.delete(which);
        } else if (split[which]) {
            p.busy = true;
            this.renderHistorySettingsIfOpen();
            const ok = await this.historyDisableSearch(which, { quiet: true });
            p.busy = false;
            if (ok) p.originOff.add(which);
        } else {
            p.originOff.delete(which);
            p.originWait.add(which);
            this.historyForgetOffDone(rid, which);
            this.historyLaunchExperiment('on', which);
        }
        this.renderHistorySettingsIfOpen();
    },

    /** "Open the research" beside the sentence that aligning is done there (no `history.align`). */
    historyKindsOpenResearch(): void {
        const rid = activeResearchId();
        if (!rid) return;
        const url = researchSchemeUrl('open', { tree: rid }, announcedResearchScheme());
        if (url) this.launchResearchLink(url, 'terminal');
    },

    /** "Align history with the settings…" (Settings, the sentence of a kind switched off, the manager): the preview dialog. */
    openHistoryAlign(): void {
        this.openHistoryAlignDialog();
    },
});
