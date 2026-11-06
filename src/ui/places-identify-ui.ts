/**
 * Place identification in the Places dialog (spec 034 §1–§5, §10): each
 * place's state from the tree, the app's own check and — with the research
 * on this computer — its live bridge; the summary with its state chips, the
 * context line, the research's steps (one place, a selection, all of them after a
 * preview) with their Undo, "Keep" on a check mark and "Why here".
 *
 * The dialog itself (rows, search, rename, split, towns) is
 * ui/places-manager-ui.ts; this module owns what the research adds to it.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { collectPlaces, knownStreets, type PlaceUsage } from '../places.js';
import {
    placeIdentities, placeStateSummary, placeSummaryChips, bulkCounts, bulkLookPreview, bulkCheckPreview,
    placeOriginBadge, formatPlaceDate, placeGlyphClass, PLACE_STATE_GLYPHS, type PlaceIdentity, type PlaceStateFilter, type PlaceStateSummary,
} from '../place-identity.js';
import {
    fetchBridgePlaces, postPlacesIdentify, placeCheckFlag, withBridgePlace, PLACES_IDENTIFY_FEATURE,
    type BridgePlace, type BridgePlaces, type PlacesIdentifyBody, type PlacesIdentifyOk, type PlacesWriteRefusal, type PlaceCheckFlag,
} from '../places-bridge.js';
import { checkPlacesCached } from '../place-check.js';
import { placeGeoHash } from '../place-records.js';
import { patchResearchAutoState, researchAutoState, storedResearchWaiting } from '../research-device.js';
import {
    canCheck, canLookUp, groupCheckState, placeContextLine, placesOfferStep, placeWhyRows, selectionCounts,
} from '../places-dialog.js';
import { placeAliasMap, placeVariantGroups } from '../place-groups.js';
import { researchLinkMark, type ResearchActionMark } from '../research-link.js';
import { researchActionLabel, researchLinkFlags } from './research-open-mark.js';
import { uiModule } from './module.js';
import { helpMark } from './help-mark.js';

/** How long the toasts of the research's steps stand. */
const TOAST_MS = 6000;
/** How long the offer after an import or a link stands (it stays while the keyboard or pointer is on it). */
const OFFER_MS = 15000;
/** The offer is being counted (one at a time). */
let offerBusy = false;
/** A dialog or an editor is open (the offer does not come over it). */
function dialogOpen(): boolean {
    return !!document.querySelector('.modal-overlay.active');
}
/** A press this long on a row (touch) starts the selection. */
const LONG_PRESS_MS = 500;

/** The glyph of each chip (aria-hidden; the label says it). */
const CHIP_GLYPHS: Readonly<Record<Exclude<PlaceStateFilter, 'all'>, string>> = {
    map: '⌖', check: '!', confirm: '?', undet: '⊘', research: '◌', none: '○',
};

/** What the dialog shows of the places' states, kept over a redraw. */
export const placesView = {
    /** placeKey → its identity, as last drawn. */
    ids: new Map<string, PlaceIdentity>(),
    /** The places of the dialog (placeKey → usage), as last drawn. */
    usages: new Map<string, PlaceUsage>(),
    /** Spellings of a place shown in its group (§4): on the map as the place, not counted as places of their own. */
    same: new Set<string>(),
    /** The research's last `/places`, for the tree it was read for. */
    live: null as { researchId: string; payload: BridgePlaces } | null,
    /** Queued by this page and not yet in a newer `/places`. */
    queuedLocal: new Set<string>(),
    selecting: false,
    selected: new Set<string>(),
    menu: false,
    bulk: null as 'look' | 'check' | null,
    /** Rows with "Why here" open. */
    why: new Set<string>(),
};

/** A fresh open: no selection, menu, preview or open "Why here". */
export function resetPlacesView(): void {
    placesView.selecting = false;
    placesView.selected = new Set();
    placesView.menu = false;
    placesView.bulk = null;
    placesView.why = new Set();
}

/** The texts of a place as the facts write them (what the bridge's `forms` take). */
function formsOf(keys: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const k of keys) for (const v of placesView.usages.get(k)?.variants.keys() ?? []) out.add(v);
    return [...out];
}

/** The read of the research's places under way (one at a time). */
let liveLoading: Promise<boolean> | null = null;
/** When the research's places were last read (for the map and the person card, which read them on opening). */
let liveReadAt: { researchId: string; at: number } | null = null;

export const placesIdentifyMethods = uiModule({
    /** The identities the summary, the context line and the previews count: one per place, its spellings not again. */
    placesCountedIds(): PlaceIdentity[] {
        return [...placesView.ids].filter(([k]) => !placesView.same.has(k)).map(([, id]) => id);
    },

    /** Places with their state now (the tree, the app's check, the research's live state), not stored. */
    placeIdentitiesNow(keys: Iterable<string>): Map<string, PlaceIdentity> {
        const data = DataManager.getData();
        const ctx = this.placesResearchContext();
        const live = ctx.researchId && placesView.live?.researchId === ctx.researchId ? placesView.live.payload : null;
        const waiting = ctx.researchId ? storedResearchWaiting(ctx.researchId)?.items : undefined;
        const ids = placeIdentities(keys, { data, live, checks: checkPlacesCached(data, live), waiting });
        for (const k of placesView.queuedLocal) {
            const id = ids.get(k);
            if (id && id.state !== 'queued' && id.state !== 'running') ids.set(k, { ...id, state: 'queued' });
        }
        return ids;
    },

    /** Every place of the dialog with its state now, kept for the dialog's redraws. */
    computePlaceIdentities(keys: Iterable<string>): Map<string, PlaceIdentity> {
        const ids = this.placeIdentitiesNow(keys);
        placesView.ids = ids;
        return ids;
    },

    /**
     * Read the research's places when its bridge here announces them (also
     * with the dialog closed: the map and the person card show the states).
     * One read at a time, none when the last one is younger than `maxAgeMs`;
     * true when what the research says changed. `fresh`: a read that starts
     * now (after a write), not one already on its way, which may have been
     * answered before the write.
     */
    loadPlacesLive(maxAgeMs = 0, fresh = false): Promise<boolean> {
        if (liveLoading) return fresh ? liveLoading.then(() => this.loadPlacesLive(0, true)) : liveLoading;
        const ctx = this.placesResearchContext();
        const { researchId, base } = ctx;
        if (!researchId || !base || !ctx.features.includes(PLACES_IDENTIFY_FEATURE)) return Promise.resolve(false);
        if (maxAgeMs > 0 && liveReadAt && liveReadAt.researchId === researchId && Date.now() - liveReadAt.at < maxAgeMs) {
            return Promise.resolve(false);
        }
        liveLoading = (async () => {
            const prev = placesView.live?.researchId === researchId ? placesView.live.payload : null;
            // Only what was queued before this read asked is in its answer: a place queued meanwhile stays queued here.
            const queuedBefore = [...placesView.queuedLocal];
            const res = await fetchBridgePlaces(base, { rev: prev?.rev });
            if (!res.ok) return false;
            liveReadAt = { researchId, at: Date.now() };
            const hadLocal = queuedBefore.some(k => placesView.queuedLocal.has(k));
            placesView.live = { researchId, payload: res.payload };
            for (const k of queuedBefore) placesView.queuedLocal.delete(k);
            return hadLocal || JSON.stringify(prev) !== JSON.stringify(res.payload);
        })().finally(() => { liveLoading = null; });
        return liveLoading;
    },

    /**
     * Read the research's places and redraw what shows them: the open
     * dialog when a place's state, record or counts changed (an open search
     * stays otherwise), the open map and person card. Without a bridge
     * everything keeps what the tree knows.
     */
    async refreshPlacesLive(maxAgeMs = 0, fresh = false): Promise<void> {
        const before = JSON.stringify([...placesView.ids]);
        const prevCounts = JSON.stringify(this.placesLivePayload()?.counts);
        const changed = await this.loadPlacesLive(maxAgeMs, fresh);
        if (!changed) return;
        if (document.getElementById('places-modal')) {
            const after = JSON.stringify([...this.computePlaceIdentities(placesView.usages.keys())]);
            if (after !== before || JSON.stringify(this.placesLivePayload()?.counts) !== prevCounts) this.redrawPlacesKeepingSearch();
        }
        this.placesLiveChanged();
    },

    /**
     * A place as a write's reply has it (an answer in "Awaiting action"): in
     * the research's places at once, so Places and the person card show it
     * before the next read (the map's points come from the tree's data).
     */
    applyPlaceReply(place: BridgePlace): void {
        const ctx = this.placesResearchContext();
        if (!ctx.researchId || placesView.live?.researchId !== ctx.researchId) return;
        placesView.live = { researchId: ctx.researchId, payload: withBridgePlace(placesView.live.payload, place) };
        if (document.getElementById('places-modal')) {
            this.computePlaceIdentities(placesView.usages.keys());
            this.redrawPlacesKeepingSearch();
        }
        this.placesLiveChanged();
    },

    /** The research's places changed: the map and an open person card show the new states. */
    placesLiveChanged(): void {
        this.refreshMapPlaceStates();
        this.refreshPersonPlaceStates();
    },

    /** Redraw the open dialog; a row with its search open opens it again. */
    redrawPlacesKeepingSearch(): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        const open = [...modal.querySelectorAll<HTMLElement>('.place-row[data-key]')]
            .find(r => r.querySelector<HTMLElement>('.place-search')?.hidden === false);
        const scroll = modal.querySelector<HTMLElement>('.modal-content')?.scrollTop ?? 0;
        this.showPlacesManager(open?.dataset.key, this.placesManagerParent ?? undefined, this.placesManagerScope, { keepFilter: true });
        if (!open) {
            const content = document.querySelector<HTMLElement>('#places-modal .modal-content');
            if (content) content.scrollTop = scroll;
        }
    },

    // ==================== SUMMARY, CONTEXT, PREVIEW ====================

    /** The summary row: "N places", the state chips, and with the research here Select and ⋯. */
    placesSummaryHtml(summary: PlaceStateSummary): string {
        const d = strings.places.dialog;
        const r = strings.places.research;
        const ctx = this.placesResearchContext();
        const f = this.placesFilter.state;
        const chips = placeSummaryChips(summary, !!ctx.researchId).map(c => `
            <button type="button" class="places-chip" data-filter="${c}" aria-pressed="${f === c}">
                <span class="places-chip-icon ${placeGlyphClass(CHIP_GLYPHS[c])}" aria-hidden="true">${CHIP_GLYPHS[c]}</span>${this.escapeHtml(d.chip[c])}
                <span class="places-chip-n">${summary[c]}</span>
            </button>`).join('');
        const counts = bulkCounts(this.placesCountedIds(), this.placesLivePayload());
        const acts = ctx.canResearch ? `
            <button type="button" class="places-select-btn" aria-pressed="${placesView.selecting}">${this.escapeHtml(placesView.selecting ? d.selectDone : d.select)}</button>
            <button type="button" class="places-more-btn" aria-haspopup="menu" aria-expanded="${placesView.menu}"
                title="${this.escapeHtml(d.more)}" aria-label="${this.escapeHtml(d.more)}"><span aria-hidden="true">⋯</span></button>
            <div class="places-more" role="menu"${placesView.menu ? '' : ' hidden'}>
                <button type="button" role="menuitem" class="places-more-item is-research" data-bulk="look"${counts.offMap ? '' : ' disabled'}>
                    <span class="places-more-title">${this.escapeHtml(r.lookAll(counts.offMap))}</span>
                    <span class="places-more-sub">${this.escapeHtml(d.menuLookSub)}</span>
                </button>
                <button type="button" role="menuitem" class="places-more-item is-research" data-bulk="check"${counts.placed ? '' : ' disabled'}>
                    <span class="places-more-title">${this.escapeHtml(r.checkAll(counts.placed))}</span>
                    <span class="places-more-sub">${this.escapeHtml(d.menuCheckSub)}</span>
                </button>
                <span class="places-more-sep" role="separator"></span>
                <button type="button" role="menuitem" class="places-more-item" data-more="select">${this.escapeHtml(d.selectMode)}</button>
            </div>` : '';
        return `
            <div class="places-summary">
                <div class="places-chips" role="group" aria-label="${this.escapeHtml(d.summaryLabel)}">
                    <span class="places-total">${this.escapeHtml(d.places(summary.total))}</span>
                    ${chips}
                </div>
                ${acts}
            </div>`;
    },

    // ==================== THE OFFER AFTER AN IMPORT OR A LINK ====================

    /**
     * A tree just imported or linked with a research: "N places not on the
     * map – look them up?" once its research here looks up places (spec 034
     * U5 point 7). Once per tree: armed now, done once offered.
     */
    armPlacesOffer(treeId: string): void {
        if (researchAutoState(treeId).placesOffer) return;
        patchResearchAutoState(treeId, { placesOffer: 'armed' });
        void this.maybeOfferPlaces();
    },

    /** The armed offer of the open tree, when its research here takes places (the research's status calls it too). */
    async maybeOfferPlaces(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        if (offerBusy || !treeId || researchAutoState(treeId).placesOffer !== 'armed') return;
        const step = placesOfferStep(true, this.placesResearchContext().access);
        if (step === 'drop') patchResearchAutoState(treeId, { placesOffer: 'done' });
        // Over a dialog it waits for the research's next status.
        if (step !== 'ask' || dialogOpen()) return;
        offerBusy = true;
        try {
            await this.loadPlacesLive();
            if (DataManager.getCurrentTreeId() !== treeId || !this.placesResearchContext().canResearch || dialogOpen()) return;
            const n = this.placesOffMapCount();
            patchResearchAutoState(treeId, { placesOffer: 'done' });
            if (n < 1) return;
            const r = strings.places.research;
            this.showToast(r.offer(n), OFFER_MS, {
                kind: 'places-offer', closable: true, hold: true, notice: true,
                action: { label: r.offerGo, run: () => this.openPlacesLookAll() },
            });
        } finally {
            offerBusy = false;
        }
    },

    /** "Look up all not on the map (N)" for the whole tree, as the Places dialog counts it. */
    placesOffMapCount(): number {
        const live = this.placesLivePayload();
        if (live?.counts) return live.counts.offMap;
        const data = DataManager.getData();
        const places = new Map(this.placesForManager('tree').map(p => [p.key, p.usage] as const));
        const same = new Set(placeVariantGroups(places, { data, live, aliases: placeAliasMap(data), known: knownStreets(data) })
            .flatMap(g => g.members.filter(m => m.same).map(m => m.key)));
        const ids = this.placeIdentitiesNow(places.keys());
        return bulkCounts([...ids].filter(([k]) => !same.has(k)).map(([, id]) => id)).offMap;
    },

    /** Places of the whole tree with those not on the map, and the preview of looking them all up (as the map's button). */
    openPlacesLookAll(): void {
        this.showPlacesManager(undefined, undefined, 'tree', { unplaced: true });
        if (document.getElementById('places-modal')) this.openPlacesBulk('look');
    },

    /** The research's live places for the open tree (null: none read). */
    placesLivePayload(): BridgePlaces | null {
        const id = this.placesResearchContext().researchId;
        return id && placesView.live?.researchId === id ? placesView.live.payload : null;
    },

    /** The context line over the list (§1, §10), '' when there is nothing to say. */
    placesContextHtml(summary: PlaceStateSummary): string {
        const d = strings.places.dialog;
        const r = strings.places.research;
        const ctx = this.placesResearchContext();
        const queued = this.placesCountedIds().filter(id => id.state === 'queued').length;
        const kind = placeContextLine({ access: ctx.access, filter: this.placesFilter.state, summary, queued });
        if (!kind) return '';
        const counts = bulkCounts(this.placesCountedIds(), this.placesLivePayload());
        // An action of the research carries its group's mark (Run now: the terminal and the agent); the bridge's steps none.
        const line = (icon: string, tone: string, text: string, act?: { label: string; cls: string; title?: string; mark?: ResearchActionMark }): string => `
            <div class="places-context" data-context="${kind}">
                <span class="places-context-icon ${placeGlyphClass(icon)}" data-tone="${tone}" aria-hidden="true">${icon}</span>
                <span class="places-context-text">${this.escapeHtml(text)}</span>
                ${act ? `<button type="button" class="places-context-act ${act.cls}"${act.title ? ` title="${this.escapeHtml(act.title)}"` : ''}>${researchActionLabel(act.label, act.mark ?? 'none')}</button>` : ''}
            </div>`;
        switch (kind) {
            case 'elsewhere': return line('ⓘ', 'muted', d.elsewhere);
            case 'phone': return line('ⓘ', 'muted', d.phoneLine);
            case 'old': return line('ⓘ', 'muted', r.oldResearch);
            case 'confirm': return line('?', 'warn', d.ctxConfirm, { label: d.openWaiting(summary.confirm), cls: 'is-primary' });
            case 'none': return line('○', 'faint', d.ctxNone(summary.none), { label: r.lookAll(counts.offMap), cls: 'is-research' });
            case 'check': return line('!', 'warn', d.ctxCheck,
                ctx.canResearch ? { label: r.checkAll(counts.placed), cls: 'is-research' } : undefined);
            case 'queue': return line('◌', 'research', r.queueNote(queued),
                this.placesRunLink() ? { label: r.runNow, cls: 'is-research', title: r.runNowTitle, mark: researchLinkMark('places') } : undefined);
        }
    },

    /** The preview of "Look up all" / "Check all" (§2), '' when closed. */
    placesBulkHtml(): string {
        const kind = placesView.bulk;
        if (!kind || !this.placesResearchContext().canResearch) return '';
        const d = strings.places.dialog;
        const ids = this.placesCountedIds();
        const lines: { icon: string; tone: string; text: string }[] = [];
        let head: string;
        let go: string;
        let n: number;
        if (kind === 'look') {
            const p = bulkLookPreview(ids);
            n = p.total;
            head = d.bulkLookHead(n);
            go = d.bulkLookGo(n);
            lines.push({ icon: PLACE_STATE_GLYPHS.queued, tone: 'research', text: d.bulkLook(p.queue, p.again) });
            if (p.skipConfirm) lines.push({ icon: '–', tone: 'faint', text: d.bulkSkipConfirm(p.skipConfirm) });
            if (p.skipResearch) lines.push({ icon: '–', tone: 'faint', text: d.bulkSkipResearch(p.skipResearch) });
        } else {
            const p = bulkCheckPreview(ids);
            n = p.total;
            head = d.bulkCheckHead(n);
            go = d.bulkCheckGo(n);
            if (p.first) lines.push({ icon: '!', tone: 'warn', text: d.bulkCheckFirst(p.first) });
            if (p.hand) lines.push({ icon: '✛', tone: 'muted', text: d.bulkCheckHand(p.hand) });
            if (p.skipConfirm) lines.push({ icon: '–', tone: 'faint', text: d.bulkSkipConfirm(p.skipConfirm) });
            if (p.skipResearch) lines.push({ icon: '–', tone: 'faint', text: d.bulkSkipResearch(p.skipResearch) });
        }
        return `
            <div class="places-bulk" role="group" data-bulk="${kind}" aria-label="${this.escapeHtml(head)}">
                <div class="places-bulk-headrow"><p class="places-bulk-head">${this.escapeHtml(head)}</p></div>
                <div class="places-bulk-lines">
                    ${lines.map(l => `<p class="places-bulk-line"><span class="places-bulk-icon" data-tone="${l.tone}" aria-hidden="true">${l.icon}</span><span>${this.escapeHtml(l.text)}</span></p>`).join('')}
                </div>
                <p class="places-bulk-note">${this.escapeHtml(d.bulkNote)}</p>
                <div class="places-bulk-buttons">
                    <button type="button" class="places-bulk-go"${n ? '' : ' disabled'}>${this.escapeHtml(go)}</button>
                    <button type="button" class="places-bulk-cancel secondary">${this.escapeHtml(strings.buttons.cancel)}</button>
                </div>
            </div>`;
    },

    /** Draw the context line and the preview again (a chip, the menu, a step). */
    refreshPlacesTop(): void {
        const modal = document.getElementById('places-modal');
        const top = modal?.querySelector<HTMLElement>('.places-top');
        if (!modal || !top) return;
        const summary = placeStateSummary(this.placesCountedIds());
        for (const chip of top.querySelectorAll<HTMLElement>('.places-chip')) {
            chip.setAttribute('aria-pressed', String(chip.dataset.filter === this.placesFilter.state));
        }
        const ctxHost = top.querySelector<HTMLElement>('.places-context-host');
        if (ctxHost) ctxHost.innerHTML = this.placesContextHtml(summary);
        const bulkHost = top.querySelector<HTMLElement>('.places-bulk-host');
        if (bulkHost) bulkHost.innerHTML = this.placesBulkHtml();
        // Looking up places off the map in the research: its rule (A6.5.2), "?" last in the preview's heading row.
        bulkHost?.querySelector('.places-bulk[data-bulk="look"] .places-bulk-headrow')?.append(helpMark('mapLookup'));
        this.bindPlacesTopDynamic(top);
    },

    /** Wire the summary row (chips, Select, ⋯ and its menu). */
    bindPlacesSummary(top: HTMLElement): void {
        for (const chip of top.querySelectorAll<HTMLButtonElement>('.places-chip')) {
            chip.onclick = () => {
                const f = chip.dataset.filter as PlaceStateFilter;
                this.placesFilter.state = this.placesFilter.state === f ? 'all' : f;
                placesView.bulk = null;
                this.setPlacesMenu(false);
                this.refreshPlacesTop();
                this.applyPlacesFilter();
            };
        }
        const select = top.querySelector<HTMLButtonElement>('.places-select-btn');
        if (select) select.onclick = () => this.setPlacesSelecting(!placesView.selecting);
        const more = top.querySelector<HTMLButtonElement>('.places-more-btn');
        if (more) more.onclick = (e) => {
            e.stopPropagation();
            this.setPlacesMenu(!placesView.menu);
        };
        for (const item of top.querySelectorAll<HTMLButtonElement>('.places-more-item')) {
            item.onclick = () => {
                this.setPlacesMenu(false);
                if (item.dataset.more === 'select') { this.setPlacesSelecting(true); return; }
                this.openPlacesBulk(item.dataset.bulk === 'check' ? 'check' : 'look');
            };
        }
        this.bindPlacesTopDynamic(top);
    },

    /** Wire the context line's action and the preview's buttons. */
    bindPlacesTopDynamic(top: HTMLElement): void {
        const act = top.querySelector<HTMLButtonElement>('.places-context-act');
        if (act) act.onclick = () => {
            const kind = top.querySelector<HTMLElement>('.places-context')?.dataset.context;
            if (kind === 'confirm') { this.closePlacesManager(); this.openWaitingPlaces(); return; }
            if (kind === 'none') { this.openPlacesBulk('look'); return; }
            if (kind === 'check') { this.openPlacesBulk('check'); return; }
            if (kind === 'queue') {
                const url = this.placesRunLink();
                if (url) this.launchResearchLink(url);
            }
        };
        const go = top.querySelector<HTMLButtonElement>('.places-bulk-go');
        if (go) go.onclick = () => void this.runPlacesBulk();
        const cancel = top.querySelector<HTMLButtonElement>('.places-bulk-cancel');
        if (cancel) cancel.onclick = () => { placesView.bulk = null; this.refreshPlacesTop(); };
    },

    setPlacesMenu(open: boolean): void {
        placesView.menu = open;
        const modal = document.getElementById('places-modal');
        const menu = modal?.querySelector<HTMLElement>('.places-more');
        if (menu) menu.hidden = !open;
        modal?.querySelector('.places-more-btn')?.setAttribute('aria-expanded', String(open));
        if (open) menu?.querySelector<HTMLButtonElement>('.places-more-item:not([disabled])')?.focus();
    },

    openPlacesBulk(kind: 'look' | 'check'): void {
        placesView.bulk = kind;
        this.refreshPlacesTop();
        document.querySelector<HTMLButtonElement>('#places-modal .places-bulk-go:not([disabled])')?.focus();
    },

    /** "Queue N places" in the preview: everything off the map, or every location to check. */
    async runPlacesBulk(): Promise<void> {
        const kind = placesView.bulk;
        if (!kind) return;
        const ids = placesView.ids;
        const keys = [...ids].filter(([, id]) => kind === 'look'
            ? id.state === 'none' || id.state === 'undet'
            : id.located && (id.state === 'placed' || id.state === 'verified' || id.state === 'check' || id.state === 'town'))
            .map(([k]) => k);
        const body: PlacesIdentifyBody = kind === 'look'
            ? { do: 'queue', all: 'offmap' }
            : { do: 'queue', all: 'placed', check: true, ...this.placeCheckFlags(keys) };
        const ok = await this.sendPlacesIdentify(body, keys, kind === 'check');
        if (ok) placesView.bulk = null;
        this.refreshPlacesTop();
    },

    // ==================== RESEARCH STEPS ====================

    /** The app's check marks of the places, as the bridge's `flags` (by form). */
    placeCheckFlags(keys: readonly string[]): { flags?: Record<string, PlaceCheckFlag> } {
        const flags: Record<string, PlaceCheckFlag> = {};
        for (const k of keys) {
            const flag = placeCheckFlag(placesView.ids.get(k)?.checks);
            if (flag) for (const form of formsOf([k])) flags[form] = flag;
        }
        return Object.keys(flags).length ? { flags } : {};
    },

    /** Look up / Check for these places (a row, or the selection). */
    async queuePlaces(keys: readonly string[], check: boolean): Promise<boolean> {
        if (!document.getElementById('places-modal')) this.preparePlacesOutside(keys);
        const take = keys.filter(k => { const id = placesView.ids.get(k); return !!id && (check ? canCheck(id) : canLookUp(id)); });
        const forms = formsOf(take);
        if (!forms.length) return false;
        const body: PlacesIdentifyBody = check
            ? { do: 'queue', forms, check: true, ...this.placeCheckFlags(take) }
            : { do: 'queue', forms };
        return this.sendPlacesIdentify(body, take, check);
    },

    /**
     * A step of the research from the map or the person card: the places' texts and states
     * from the whole tree, as the dialog would have them.
     */
    preparePlacesOutside(keys: readonly string[]): void {
        const all = collectPlaces(DataManager.getData());
        placesView.usages = new Map(keys.flatMap(k => { const u = all.get(k); return u ? [[k, u] as const] : []; }));
        this.computePlaceIdentities(placesView.usages.keys());
    },

    /** "Remove from the queue" from outside the dialog: every text of the place. */
    async unqueuePlace(key: string): Promise<void> {
        const forms = [...(collectPlaces(DataManager.getData()).get(key)?.variants.keys() ?? [])];
        await this.unqueuePlaceForms(forms, [key]);
    },

    /**
     * Send a queueing step; on success the toast with its Undo (taking out of
     * the queue what this step put there) and a second line with what was
     * skipped. A refusal says why; nothing changes then and a selection stays.
     */
    async sendPlacesIdentify(body: PlacesIdentifyBody, keys: readonly string[], check: boolean): Promise<boolean> {
        const ctx = this.placesResearchContext();
        if (!ctx.canResearch || !ctx.base) return false;
        const res = await postPlacesIdentify(ctx.base, body, ctx.features, ctx.linkCheck ?? undefined);
        if (!res.ok) {
            this.showPlacesRefusal(res);
            return false;
        }
        const skippedForms = new Set(res.skipped.map(s => s.form));
        const queuedKeys = keys.filter(k => formsOf([k]).some(f => !skippedForms.has(f)));
        for (const k of queuedKeys) placesView.queuedLocal.add(k);
        const undoForms = formsOf(queuedKeys).filter(f => !skippedForms.has(f));
        const r = strings.places.research;
        const main = res.queued > 0 ? (check ? r.checked(res.queued) : r.queued(res.queued)) : '';
        const sub = this.placesSkippedText(res);
        if (placesView.selecting) this.setPlacesSelecting(false);
        this.redrawPlacesKeepingSearch();
        this.placesLiveChanged();
        if (main) {
            this.showToast(sub || main, TOAST_MS, {
                ...(sub ? { title: main } : {}),
                ...(undoForms.length ? { action: { label: r.undo, run: () => void this.unqueuePlaceForms(undoForms, queuedKeys) } } : {}),
            });
        } else if (sub) {
            this.showToast(sub, TOAST_MS);
        }
        // A read after the step (one on its way may have been answered before it).
        void this.refreshPlacesLive(0, true);
        return true;
    },

    /** The skipped places of a reply, in one line ('' none). */
    placesSkippedText(res: PlacesIdentifyOk): string {
        const r = strings.places.research;
        const n = (whys: readonly string[]): number => res.skipped.filter(s => whys.includes(s.why)).length;
        const hand = n(['manual']);
        const queued = n(['queued', 'running']);
        const identified = n(['identified']);
        const other = n(['unknown']);
        return [
            hand ? r.skipHand(hand) : '', queued ? r.skipQueued(queued) : '',
            identified ? r.skipIdentified(identified) : '', other ? strings.places.dialog.skipped(other) : '',
        ].filter(Boolean).join(' ');
    },

    /** Why a step did not go, as a toast; a place changed meanwhile reads the places again. */
    showPlacesRefusal(res: PlacesWriteRefusal): void {
        const r = strings.places.research;
        let text: string;
        switch (res.code) {
            case 'busy': text = r.errBusy; break;
            case 'locked': text = r.errLocked; break;
            case 'archive': text = res.reason || r.errArchive; break;
            case 'network': text = r.errNetwork; break;
            case 'later': text = r.errUndoLater; break;
            case 'changed': text = r.errChanged; void this.refreshPlacesLive(0, true); break;
            default: text = res.reason || r.errFailed;
        }
        const link = res.code === 'link' ? res.link : undefined;
        this.showToast(text, TOAST_MS, link ? { action: { label: r.runNow, run: () => this.launchResearchLink(link), ...researchLinkFlags(link) } } : {});
    },

    /** Take these forms out of the research's queue (a step's Undo, or "Remove from the queue"). */
    async unqueuePlaceForms(forms: readonly string[], keys: readonly string[]): Promise<void> {
        const ctx = this.placesResearchContext();
        if (!ctx.canResearch || !ctx.base || !forms.length) return;
        const res = await postPlacesIdentify(ctx.base, { do: 'cancel', forms }, ctx.features, ctx.linkCheck ?? undefined);
        if (!res.ok) {
            this.showPlacesRefusal(res);
            return;
        }
        for (const k of keys) placesView.queuedLocal.delete(k);
        this.showToast(strings.places.research.unqueued, TOAST_MS);
        await this.refreshPlacesLive(0, true);
        this.redrawPlacesKeepingSearch();
        this.placesLiveChanged();
    },

    /** "Keep" on a check mark: the location stays and the mark goes until the location changes (undoable). */
    keepPlaceLocation(key: string): void {
        const geo = DataManager.getData().places?.[key];
        if (!geo) return;
        DataManager.setPlaceGeos(new Map([[key, { ...geo, keptAt: placeGeoHash(geo) }]]), strings.places.dialog.kept);
        placesView.why.delete(key);
        this.refreshPlacesManager();
    },

    // ==================== WHY HERE ====================

    /** The rows of "Why here" for a place, as HTML. */
    placeWhyHtml(key: string): string {
        const id = placesView.ids.get(key);
        if (!id) return '';
        const lang = getCurrentLanguage();
        const geo = DataManager.getData().places?.[key];
        return placeWhyRows(id, geo, lang).map(row => {
            let value: string;
            if (row.origin) {
                const date = row.at ? ` <span class="place-why-date">${this.escapeHtml(formatPlaceDate(row.at, lang))}</span>` : '';
                value = `${placeOriginBadge(row.origin, lang, row.origin === 'research' ? row.at : undefined)}${row.origin === 'research' ? '' : date}`;
            } else if (row.url) {
                value = `${this.escapeHtml(row.text)} <a class="place-why-link" href="${this.escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span></a>`;
            } else {
                value = this.escapeHtml(row.text);
            }
            return `<span class="place-why-k">${this.escapeHtml(row.label)}</span><span class="place-why-v"${row.tone ? ` data-tone="${row.tone}"` : ''} data-kind="${row.kind}">${value}</span>`;
        }).join('');
    },

    /** Open or close a row's "Why here". */
    togglePlaceWhy(row: HTMLElement, key: string): void {
        const panel = row.querySelector<HTMLElement>('.place-why');
        if (!panel) return;
        const open = panel.hidden;
        if (open) { placesView.why.add(key); panel.innerHTML = this.placeWhyHtml(key); } else placesView.why.delete(key);
        panel.hidden = !open;
        const d = strings.places.dialog;
        for (const t of row.querySelectorAll<HTMLElement>(':scope > .place-line .place-why-toggle')) {
            t.setAttribute('aria-expanded', String(open));
            t.textContent = open ? d.hide : `${d.why} ▾`;
        }
    },

    // ==================== SELECTION ====================

    /** Select / Done: the checkboxes and the selection bar in place of the footer. */
    setPlacesSelecting(on: boolean): void {
        if (on && !this.placesResearchContext().canResearch) return;
        placesView.selecting = on;
        if (!on) placesView.selected = new Set();
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        modal.querySelector('.places-modal')?.classList.toggle('is-selecting', on);
        const btn = modal.querySelector<HTMLElement>('.places-select-btn');
        if (btn) {
            btn.setAttribute('aria-pressed', String(on));
            btn.textContent = on ? strings.places.dialog.selectDone : strings.places.dialog.select;
        }
        const footer = modal.querySelector<HTMLElement>('.places-footer');
        const bar = modal.querySelector<HTMLElement>('.places-selbar');
        if (footer) footer.hidden = on;
        if (bar) bar.hidden = !on;
        this.refreshPlacesSelection();
    },

    /** Select or unselect places (a row, or a group with its houses). */
    setPlacesSelected(keys: readonly string[], on: boolean): void {
        for (const k of keys) {
            if (on) placesView.selected.add(k);
            else placesView.selected.delete(k);
        }
        this.refreshPlacesSelection();
    },

    /** The places a checkbox stands for: a group head takes the group's houses too. */
    placeSelectKeys(box: HTMLElement): string[] {
        const group = box.closest<HTMLElement>('.place-group');
        const row = box.closest<HTMLElement>('.place-row[data-key]');
        const isHead = !!group && (!row || row.classList.contains('place-group-head'));
        if (!isHead) return row?.dataset.key ? [row.dataset.key] : [];
        return [...group!.querySelectorAll<HTMLElement>('.place-group-head[data-key], .place-row-sub[data-key]')]
            .map(r => r.dataset.key ?? '').filter(Boolean);
    },

    /** The checkboxes' states and the selection bar's counts. */
    refreshPlacesSelection(): void {
        const modal = document.getElementById('places-modal');
        if (!modal) return;
        for (const box of modal.querySelectorAll<HTMLElement>('.place-select')) {
            const keys = this.placeSelectKeys(box);
            box.setAttribute('aria-checked', groupCheckState(keys.map(k => placesView.selected.has(k))));
        }
        const bar = modal.querySelector<HTMLElement>('.places-selbar');
        if (!bar) return;
        const d = strings.places.dialog;
        const n = selectionCounts([...placesView.selected].map(k => placesView.ids.get(k)).filter((x): x is PlaceIdentity => !!x));
        (bar.querySelector('.places-selbar-count') as HTMLElement).textContent = d.selected(placesView.selected.size);
        const look = bar.querySelector<HTMLButtonElement>('.places-selbar-look')!;
        const check = bar.querySelector<HTMLButtonElement>('.places-selbar-check')!;
        look.textContent = d.lookSelected(n.look);
        check.textContent = d.checkSelected(n.check);
        look.disabled = n.look === 0;
        check.disabled = n.check === 0;
    },

    /** The selection bar's HTML (hidden until Select). */
    placesSelbarHtml(): string {
        const d = strings.places.dialog;
        return `
            <div class="places-selbar" role="group" aria-label="${this.escapeHtml(d.select)}"${placesView.selecting ? '' : ' hidden'}>
                <span class="places-selbar-count" aria-live="polite"></span>
                <button type="button" class="places-selbar-look"></button>
                <button type="button" class="places-selbar-check"></button>
                <button type="button" class="places-selbar-clear">${this.escapeHtml(d.clearSelection)}</button>
            </div>`;
    },

    /** Wire the checkboxes, the long press and the selection bar. */
    bindPlacesSelection(modal: HTMLElement): void {
        const list = modal.querySelector<HTMLElement>('.places-list');
        if (list) {
            list.addEventListener('click', (e) => {
                const box = (e.target as HTMLElement).closest<HTMLElement>('.place-select');
                if (!box) return;
                const keys = this.placeSelectKeys(box);
                this.setPlacesSelected(keys, box.getAttribute('aria-checked') !== 'true');
            });
            this.bindPlacesLongPress(list);
        }
        const bar = modal.querySelector<HTMLElement>('.places-selbar');
        if (!bar) return;
        (bar.querySelector('.places-selbar-look') as HTMLButtonElement).onclick = () => void this.queuePlaces([...placesView.selected], false);
        (bar.querySelector('.places-selbar-check') as HTMLButtonElement).onclick = () => void this.queuePlaces([...placesView.selected], true);
        (bar.querySelector('.places-selbar-clear') as HTMLButtonElement).onclick = () => this.setPlacesSelecting(false);
        this.setPlacesSelecting(placesView.selecting);
    },

    /** A long press on a row (touch) starts the selection with that row. */
    bindPlacesLongPress(list: HTMLElement): void {
        let timer: number | null = null;
        let start: { x: number; y: number } | null = null;
        const stop = (): void => { if (timer !== null) clearTimeout(timer); timer = null; start = null; };
        list.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch' || placesView.selecting || !this.placesResearchContext().canResearch) return;
            const target = e.target as HTMLElement;
            if (target.closest('button, a, input, select, textarea, label')) return;
            const row = target.closest<HTMLElement>('.place-row[data-key]');
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            timer = window.setTimeout(() => {
                timer = null;
                this.setPlacesSelecting(true);
                const box = row.querySelector<HTMLElement>(':scope > .place-line .place-select');
                this.setPlacesSelected(box ? this.placeSelectKeys(box) : [row.dataset.key ?? ''], true);
            }, LONG_PRESS_MS);
        });
        list.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) stop();
        });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) list.addEventListener(ev, stop);
    },

    /** Escape in the Places dialog: the menu, the preview, the selection — one at a time. */
    placesEscape(): boolean {
        if (!document.getElementById('places-modal')) return false;
        if (placesView.menu) { this.setPlacesMenu(false); return true; }
        if (placesView.bulk) { placesView.bulk = null; this.refreshPlacesTop(); return true; }
        if (placesView.selecting) { this.setPlacesSelecting(false); return true; }
        return false;
    },
});
