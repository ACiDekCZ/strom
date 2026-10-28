/**
 * History in the life timeline (spec 020) — the DOM half and the
 * page's state: the research's events of the time per research (read from its
 * bridge, kept on the device), the hidings waiting for the bridge, the
 * Settings row in "Person card" with its status row and the row opening
 * the manager "History of places" (#history-modal, history-manage-ui.ts).
 *
 * The pure model is src/history.ts, the bridge's routes src/history-bridge.ts,
 * the device's copy src/history-store.ts. Off (the user's choice) = the person card
 * is as it was: nothing is read, not even the device's copy.
 *
 * Reads go by `/status.history.rev` (or the stream's `history {rev}` event),
 * never by `head`; gates only by `/status.features`. Switching the research's
 * search on is the research terminal's (the `experiment` link); the bridge
 * only switches it off.
 *
 * For the card (part B): historyForPerson(), hideHistoryItem(),
 * restoreHistoryItem(), toggleLifelineHistory(), historyEnableSearch().
 */

import { strings, getCurrentLanguage, type Language } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { shownName } from '../person-name.js';
import {
    parseLiveBridge, researchSchemeUrl, cleanText, type LiveStatus,
    HISTORY_EVENTS_FEATURE, HISTORY_HIDE_FEATURE, HISTORY_FIRST_FEATURE, HISTORY_PLACE_FEATURE, EXPERIMENTS_OFF_FEATURE, EXPERIMENTS_LINK_FEATURE,
} from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme } from '../research-device.js';
import {
    computePersonHistory, historyCardShows, historyStripShows, historyFindRegions, historyMainPlace, historyPlaceRow, historyWaiting, historySettingsStatus, queueHideOp,
    historyKindsShown, historyKindLocked, HISTORY_SCOPE_KINDS, type HistoryKinds,
    type HistoryPayload, type HistoryDeleted, type HistoryHideOp, type PersonHistory, type LifelineHistoryItem, type HiddenHistoryItem,
    type HistorySettingsAction, type EffectiveHidden,
} from '../history.js';
import { manageSummaries } from '../history-manage.js';
import { fetchBridgeHistory, hideRequestBody, postBridgeHide, postBridgeExperimentsOff } from '../history-bridge.js';
import { loadHistoryCache, saveHistoryCache, loadHideQueue, saveHideQueue } from '../history-store.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

/** The manager "History of places" (history-manage-ui.ts). */
export const HISTORY_MANAGE_DIALOG_ID = 'history-modal';
/** Fired on window whenever what the layer shows may have changed (a read, a hiding, the setting). */
export const HISTORY_CHANGED_EVENT = 'strom:history-changed';

/** What the person card's layer gets (null from historyForPerson: the card stays as it was — states 1, 2, 10). */
/** Where the card's "⋯" hides an event: this whole tree or the person only. */
export type HistoryHideScope = 'tree' | 'person';

export interface PersonHistoryView {
    /** The research of the open tree. */
    researchId: string;
    /** The card's "History" chip is on (SettingsManager.isLifelineHistory). */
    chipOn: boolean;
    /** The person's history; null while nothing is read yet (the chip shows, the body says nothing). */
    history: PersonHistory | null;
    /** "Switch the search on" may be offered (state 3; the `experiment` link, §1.3 canLinkOn). */
    canLinkOn: boolean;
}

// ─── Page state, per research id ────────────────────────────────────────────

/** The payload in use (null: none on this device). Absent: not loaded yet. */
const cache = new Map<string, HistoryPayload | null>();
/** Loading the device's copy (one at a time per research). */
const loading = new Map<string, Promise<void>>();
/** The hidings waiting for the bridge, in order (without the one on its way). */
const queues = new Map<string, HistoryHideOp[]>();
/** The hiding on its way to the bridge now. */
const inFlight = new Map<string, HistoryHideOp>();
/** The `history.rev` the payload in use was read for ('' = not said). */
const loadedRev = new Map<string, string>();
/** Read from the bridge in this page (a research that says no rev is read once per page). */
const readHere = new Set<string>();
/** A read running; the rev asked meanwhile waits for it. */
const reading = new Set<string>();
const readAgain = new Map<string, string | undefined>();
/** Sending the queue now. */
const flushing = new Set<string>();
/** The search was switched off from here (until the status agrees or says otherwise): when. */
const offDone = new Map<string, number>();
/** Per research: the features of its last status in this page (they stay while the bridge is down, so hidings can wait in the queue). */
const lastFeatures = new Map<string, readonly string[]>();
/** The bridge's sentence after a failed switch-off, and its link (until Settings close). */
let offError: { researchId: string; text: string; link?: string } | null = null;
let listening = false;

/** A status saying the search is on this soon after a switch-off may have been asked before it. */
const OFF_SETTLE_MS = 5000;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function lang(): Language {
    return getCurrentLanguage();
}

/** The open tree's research id (lower case), or null (none, or a view of a shared file). */
function activeResearchId(): string | null {
    if (DataManager.isViewMode()) return null;
    const treeId = DataManager.getCurrentTreeId();
    const id = treeId ? TreeManager.getTreeMetadata(treeId)?.research?.id : undefined;
    return id ? id.toLowerCase() : null;
}

function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

/** The queue as it applies (the hiding on its way first). */
function displayQueue(researchId: string): HistoryHideOp[] {
    const sent = inFlight.get(researchId);
    const q = queues.get(researchId) ?? [];
    return sent ? [sent, ...q] : q;
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

/** The undo of a hiding (`do: "show"` for the same target), or the hiding again of an undo. */
function reverseOp(op: HistoryHideOp): HistoryHideOp {
    const { do: d, ...rest } = op;
    return d === 'show' ? { ...rest, at: nowIso() } : { ...rest, do: 'show', at: nowIso() };
}

export const historyMethods = uiModule({
    /** At startup (after the first render): listen for bridge statuses and tree switches, load the open tree's copy. */
    initHistoryLayer(): void {
        if (!listening) {
            listening = true;
            onBridgeStatus((researchId, status) => this.noteHistoryStatus(researchId, status));
            window.addEventListener('strom:tree-switched', () => {
                offError = null;
                void this.refreshHistoryForActiveTree();
            });
        }
        void this.refreshHistoryForActiveTree();
    },

    /** The open tree: its device copy in (layer on), then what its bridge said last. */
    async refreshHistoryForActiveTree(): Promise<void> {
        const rid = activeResearchId();
        if (!rid || !SettingsManager.isHistoryLayer()) {
            this.historyChanged();
            return;
        }
        await this.ensureHistoryCache(rid);
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        if (status) this.noteHistoryStatus(rid, status);
        else this.historyChanged();
    },

    /** Load the device's copy and queue of a research once per page. */
    async ensureHistoryCache(researchId: string): Promise<void> {
        const rid = researchId.toLowerCase();
        if (cache.has(rid)) return;
        let pending = loading.get(rid);
        if (!pending) {
            pending = (async () => {
                const [payload, queue] = await Promise.all([loadHistoryCache(rid), loadHideQueue(rid)]);
                // A read from the bridge may have come first: it wins.
                if (!cache.has(rid)) {
                    cache.set(rid, payload);
                    if (payload?.rev) loadedRev.set(rid, payload.rev);
                }
                if (!queues.has(rid)) queues.set(rid, queue);
            })().finally(() => loading.delete(rid));
            loading.set(rid, pending);
        }
        await pending;
    },

    /**
     * Local data unlocked: the device's copies read while it was locked came
     * back empty, so they are read again now (not at the bridge's next
     * status — the bridge may not run at all). Hidings made meanwhile stay.
     */
    async reloadHistoryAfterUnlock(): Promise<void> {
        for (const rid of [...cache.keys()]) {
            await loading.get(rid);
            if (cache.get(rid)) continue;
            const kept = queues.get(rid) ?? [];
            cache.delete(rid);
            loadedRev.delete(rid);
            queues.delete(rid);
            await this.ensureHistoryCache(rid);
            if (kept.length) {
                let q = queues.get(rid) ?? [];
                for (const op of kept) q = queueHideOp(q, op, cache.get(rid) ?? null);
                queues.set(rid, q);
                await saveHideQueue(rid, displayQueue(rid));
            }
        }
        await this.refreshHistoryForActiveTree();
    },

    /**
     * A status of a research's bridge: read its events when the layer is on,
     * the tree is open, `history.events` is said and its `history.rev` is not
     * the one read; send the waiting hidings; redraw the Settings row.
     */
    noteHistoryStatus(researchId: string, status: LiveStatus): void {
        const rid = researchId.toLowerCase();
        lastFeatures.set(rid, status.features ?? []);
        const since = offDone.get(rid);
        if (since !== undefined && status.experiments) {
            if (!status.experiments.history || Date.now() - since > OFF_SETTLE_MS) offDone.delete(rid);
        }
        if (!SettingsManager.isHistoryLayer() || rid !== activeResearchId()) {
            this.renderHistorySettingsIfOpen();
            return;
        }
        void this.ensureHistoryCache(rid).then(() => {
            const features = status.features ?? [];
            if (features.includes(HISTORY_EVENTS_FEATURE)) {
                const rev = status.historyRev;
                const stale = !cache.get(rid) || (rev ? loadedRev.get(rid) !== rev : !readHere.has(rid));
                if (stale) void this.readBridgeHistory(rid, rev);
            }
            if (features.includes(HISTORY_HIDE_FEATURE)) void this.flushHistoryQueue(rid);
            this.syncHistoryStrip();
            this.renderHistorySettingsIfOpen();
            // The manager's header and actions follow the status (search on/off, pace, features).
            if (document.getElementById(HISTORY_MANAGE_DIALOG_ID)?.classList.contains('active')) this.renderHistoryManage();
        });
    },

    /** The stream's `history {rev}` event: a change without a new commit (spec 020 A3). */
    noteHistoryEvent(researchId: string, raw: unknown): void {
        const rid = researchId.toLowerCase();
        if (!SettingsManager.isHistoryLayer() || rid !== activeResearchId()) return;
        const rev = raw && typeof raw === 'object' ? cleanText((raw as { rev?: unknown }).rev, 128) : '';
        if (!rev || loadedRev.get(rid) === rev) return;
        const features = this.researchStatusOf(rid)?.features ?? [];
        if (!features.includes(HISTORY_EVENTS_FEATURE)) return;
        void this.readBridgeHistory(rid, rev);
    },

    /** `GET /history`: the new payload in use and on the device; a refused or too big one leaves the old. */
    async readBridgeHistory(researchId: string, rev?: string): Promise<void> {
        const rid = researchId.toLowerCase();
        if (reading.has(rid)) {
            readAgain.set(rid, rev);
            return;
        }
        const base = bridgeBase(rid);
        if (!base) return;
        reading.add(rid);
        try {
            const r = await fetchBridgeHistory(base, rev ? { rev } : {});
            if (r.ok) {
                await this.ensureHistoryCache(rid);
                cache.set(rid, r.payload);
                loadedRev.set(rid, r.payload.rev ?? rev ?? '');
                readHere.add(rid);
                await saveHistoryCache(rid, r.payload);
                this.historyChanged();
            }
        } finally {
            reading.delete(rid);
        }
        if (readAgain.has(rid)) {
            const next = readAgain.get(rid);
            readAgain.delete(rid);
            if (next !== loadedRev.get(rid)) await this.readBridgeHistory(rid, next);
        }
    },

    /**
     * Send the waiting hidings in order while the bridge runs, says
     * `history.hide` and takes writes. A person without a research REFN waits
     * until the person gets one; a refused body is dropped; anything else
     * stays for the next status. The answer is the app's own write.
     */
    async flushHistoryQueue(researchId: string): Promise<void> {
        const rid = researchId.toLowerCase();
        if (flushing.has(rid)) return;
        flushing.add(rid);
        try {
            const skipped: HistoryHideOp[] = [];
            for (;;) {
                const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
                const base = bridgeBase(rid);
                if (!status || !base || !(status.features ?? []).includes(HISTORY_HIDE_FEATURE) || this.researchWriteHeldNow(rid)) break;
                const queue = queues.get(rid) ?? [];
                const op = queue.find(q => !skipped.includes(q));
                if (!op) break;
                // A person who got a REFN since the hiding (a send of the tree): it goes now.
                const withRefn = op.personId && !op.personRefn ? this.historyPersonRefn(op.personId) : undefined;
                const ready: HistoryHideOp = withRefn ? { ...op, personRefn: withRefn } : op;
                const body = hideRequestBody(ready);
                if (!body) { skipped.push(op); continue; }
                queues.set(rid, queue.filter(q => q !== op));
                inFlight.set(rid, ready);
                const before = this.researchHeadNow(rid);
                const r = await postBridgeHide(base, body, status.features);
                inFlight.delete(rid);
                if (r.ok) {
                    const p = cache.get(rid);
                    if (p) {
                        cache.set(rid, { ...p, hidden: r.hidden });
                        await saveHistoryCache(rid, cache.get(rid)!);
                    }
                    await saveHideQueue(rid, displayQueue(rid));
                    if (r.head) this.researchTakeOwnWriteHead(rid, before, r.head, r.parent);
                    this.historyChanged();
                    continue;
                }
                if (r.code === 'invalid') {
                    await saveHideQueue(rid, displayQueue(rid));
                    this.historyChanged();
                    continue;
                }
                // Kept for later: back at the front (an undo queued meanwhile cancels it).
                const rest = queues.get(rid) ?? [];
                const merged = queueHideOp(rest, ready, cache.get(rid) ?? null);
                queues.set(rid, merged.length === rest.length + 1 ? [ready, ...rest] : merged);
                await saveHideQueue(rid, displayQueue(rid));
                this.historyChanged();
                break;
            }
        } finally {
            flushing.delete(rid);
        }
    },

    /** The research REFN of a person of the open tree ('' none). */
    historyPersonRefn(personId: string): string {
        const person = DataManager.getData().persons[personId as keyof ReturnType<typeof DataManager.getData>['persons']];
        return person?.refn ?? '';
    },

    /** R4: the bridge's `deleted` after a delete or restore, in use at once (deleted events leave the events; the next read brings the rest). */
    historyTakeDeleted(researchId: string, deleted: HistoryDeleted[]): void {
        const rid = researchId.toLowerCase();
        const p = cache.get(rid);
        if (!p) return;
        const gone = new Set(deleted.map(d => d.event));
        const next: HistoryPayload = { ...p, events: p.events.filter(e => !gone.has(e.id)) };
        if (deleted.length) next.deleted = deleted; else delete next.deleted;
        cache.set(rid, next);
        this.historyChanged();
    },

    /** Something the layer shows may have changed: the open card, Settings and the hidden list follow. */
    historyChanged(): void {
        // Switched off: the card drops its chip too (the head as it was).
        const shown = SettingsManager.isHistoryLayer() || !!document.querySelector('#pm-lifeline-head .pm-lifeline-chips');
        if (shown && this.currentId && document.getElementById('person-modal')?.classList.contains('active')) {
            this.renderPersonLifeline(this.currentId, true);
        }
        this.renderHistorySettingsIfOpen();
        if (document.getElementById(HISTORY_MANAGE_DIALOG_ID)?.classList.contains('active')) this.renderHistoryManage();
        this.refreshPlacesHistoryRows();
        this.refreshHistoryRegionPicker();
        window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_EVENT));
    },

    // ─── Card API (part B) ─────────────────────────────────────────────────

    /**
     * The person's history for the card, or null when the card stays as it
     * was: the layer off (1), the tree not tied to a research (2), nothing on
     * this device and the research not saying `history.events` (10), no
     * events and no search for the tree (K1.3: the state is Settings' only).
     * The chip shows whenever this is not null.
     */
    historyForPerson(personId: string): PersonHistoryView | null {
        if (!SettingsManager.isHistoryLayer()) return null;
        const rid = activeResearchId();
        if (!rid) return null;
        if (!cache.has(rid)) {
            void this.ensureHistoryCache(rid).then(() => this.historyChanged());
            return null;
        }
        const payload = cache.get(rid) ?? null;
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        if (!payload && !(status?.features ?? []).includes(HISTORY_EVENTS_FEATURE)) return null;
        const searchOn = offDone.has(rid) ? false : status?.experiments ? status.experiments.history : undefined;
        if (!historyCardShows(payload, {
            ...(searchOn !== undefined ? { searchOn } : {}),
            ...(status?.treeState ? { treeState: status.treeState } : {}),
        })) return null;
        const canLinkOn = this.historyCanLinkOn(rid);
        const chipOn = SettingsManager.isLifelineHistory(DataManager.getCurrentTreeId());
        if (!payload) return { researchId: rid, chipOn, history: null, canLinkOn };
        const history = computePersonHistory(DataManager.getData(), personId, payload, lang(), {
            queue: displayQueue(rid),
            kinds: this.historyKindsNow().kinds,
            ...(searchOn !== undefined ? { searchOn } : {}),
            ...(status?.treeState ? { treeState: status.treeState } : {}),
        });
        if (history.state.kind === 'noSearch') history.state = { kind: 'noSearch', link: canLinkOn };
        // §5: "Find the history of the region" in place of "still looking" — `history.first`, R1 regions, the bridge running.
        const looking = history.state.kind === 'searching' || (history.state.kind === 'events' && history.state.somePending);
        if (looking && status && (status.features ?? []).includes(HISTORY_FIRST_FEATURE) && payload.regions) {
            const find = historyFindRegions(DataManager.getData(), personId, payload, status.treeState ? { treeState: status.treeState } : {});
            if (find.length) history.find = find;
        }
        // §6a: the main place's own history as the last row, only when §5 offers nothing (always one offer).
        const { kinds, placeShown } = this.historyKindsNow();
        const placeState = ['events', 'searching', 'none', 'allHidden'].includes(history.state.kind);
        if (placeShown && kinds.place && placeState && !history.find?.length && payload.regions) {
            const canOffer = !!status && (status.features ?? []).includes(HISTORY_PLACE_FEATURE)
                && (searchOn ?? payload.state.on) && !historyWaiting(payload, status.treeState);
            const row = historyPlaceRow(payload, historyMainPlace(DataManager.getData(), personId, payload), canOffer);
            if (row) history.placeRow = row;
        }
        return { researchId: rid, chipOn, history, canLinkOn };
    },

    /**
     * The card's line "the research does not look for history yet" (spec 020
     * K1.6), for a card whose timeline shows no layer: the tree tied to its
     * research, the bridge running, the search off there.
     */
    historyStripWanted(): boolean {
        const rid = activeResearchId();
        if (!rid || !SettingsManager.isHistoryLayer() || SettingsManager.isHistoryStripClosed()) return false;
        // Not read yet (historyForPerson asks): its events may still put the layer there instead.
        if (!cache.has(rid)) return false;
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        return historyStripShows({
            layerOn: true,
            closed: false,
            following: DataManager.isLiveFollowing(),
            bridgeHistory: !!status && (status.features ?? []).includes(HISTORY_EVENTS_FEATURE),
            searchOn: status?.experiments?.history,
            offDone: offDone.has(rid),
            canLinkOn: this.historyCanLinkOn(rid),
            payload: cache.get(rid) ?? null,
            ...(status?.treeState ? { treeState: status.treeState } : {}),
        });
    },

    /** An open card redraws its timeline when the strip's answer changed (the search switched on, the bridge up or gone). */
    syncHistoryStrip(): void {
        if (!this.currentId || !document.getElementById('person-modal')?.classList.contains('active')) return;
        const body = document.getElementById('pm-lifeline-body');
        if (document.getElementById('pm-lifeline-section')?.style.display === 'none') return;
        if (!body || body.querySelector('.k-history, .k-historyGroup, .k-historyState:not(.is-strip)')) return;
        if (!!body.querySelector('[data-history-strip]') !== this.historyStripWanted()) this.renderPersonLifeline(this.currentId, true);
    },

    /** The card's line closed: it does not come back in this browser (Settings keeps the switch). */
    closeHistoryStrip(): void {
        SettingsManager.setHistoryStripClosed(true);
        this.historyChanged();
    },

    /** The card's "History" chip (remembered for every card of this tree, K4.5). */
    toggleLifelineHistory(on: boolean): void {
        SettingsManager.setLifelineHistory(DataManager.getCurrentTreeId(), on);
        this.historyChanged();
    },

    /**
     * Hide an event of the card: in this whole tree (spec 020 K4.1a) or for
     * this person only (by REFN). At once on the device, then to the research;
     * a toast with "Undo". Allowed in a locked tree (not an edit of the tree).
     */
    hideHistoryItem(personId: string, item: LifelineHistoryItem, scope: HistoryHideScope): void {
        const h = strings.history;
        const op: HistoryHideOp = scope === 'tree' ? { event: item.ev.id, tree: true, at: nowIso() }
            : { event: item.ev.id, personId, ...(this.historyPersonRefn(personId) ? { personRefn: this.historyPersonRefn(personId) } : {}), at: nowIso() };
        void this.applyHistoryHide(op);
        const person = DataManager.getPerson(personId as Parameters<typeof DataManager.getPerson>[0]);
        const text = scope === 'tree' ? h.toastHiddenTree : h.toastPerson(person ? shownName(person) : '');
        this.showToast(text, 8000, { kind: 'history-hide', clearOf: '#person-modal.active .pm-footer', action: { label: h.undo, run: () => { void this.applyHistoryHide(reverseOp(op)); } } });
    },

    /** "Restore" of a hidden event in the card ("Hidden: n"). */
    restoreHistoryItem(item: HiddenHistoryItem): void {
        this.restoreHistoryHide(item.hiddenBy);
    },

    /** Undo a hiding as it applies (the card's "Restore", the manager's Hidden tab): the same target with `do: "show"`. */
    restoreHistoryHide(by: EffectiveHidden): void {
        const at = nowIso();
        const op: HistoryHideOp = by.region && !by.event ? { region: by.region, do: 'show', at }
            : by.tree ? { event: by.event, tree: true, do: 'show', at }
                : by.place ? { event: by.event, place: by.place, do: 'show', at }
                    : { event: by.event, ...(by.personId ? { personId: by.personId } : {}), ...(by.person ? { personRefn: by.person } : {}), do: 'show', at };
        void this.applyHistoryHide(op);
    },

    /**
     * What the manager needs of the open tree's history: its research, the
     * payload in use (null none; undefined not loaded yet), the hidings as they
     * apply, the bridge's last status and whether it runs now.
     */
    historyManageContext(): {
        researchId: string; payload: HistoryPayload | null | undefined; queue: HistoryHideOp[];
        status: LiveStatus | null; lastStatus: LiveStatus | null; features: readonly string[];
        base: string | null; offDone: boolean; canLinkOn: boolean;
    } | null {
        const rid = activeResearchId();
        if (!rid) return null;
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        return {
            researchId: rid,
            payload: cache.has(rid) ? cache.get(rid) ?? null : undefined,
            queue: displayQueue(rid),
            status,
            lastStatus: status ?? this.researchStatusOf(rid),
            features: status?.features ?? this.researchStatusOf(rid)?.features ?? lastFeatures.get(rid) ?? [],
            base: status ? bridgeBase(rid) : null,
            offDone: offDone.has(rid),
            canLinkOn: this.historyCanLinkOn(rid),
        };
    },

    /** The manager has an entry (§1.1): the layer on, a tree tied to a research with a copy here or `history.events`. */
    historyManageAvailable(): boolean {
        if (!SettingsManager.isHistoryLayer()) return false;
        const ctx = this.historyManageContext();
        if (!ctx) return false;
        return !!ctx.payload || ctx.features.includes(HISTORY_EVENTS_FEATURE);
    },

    /** A hiding (or its undo) of the open tree's research: into the queue, kept, shown, sent. */
    async applyHistoryHide(op: HistoryHideOp): Promise<void> {
        const rid = activeResearchId();
        if (!rid) return;
        await this.ensureHistoryCache(rid);
        queues.set(rid, queueHideOp(queues.get(rid) ?? [], op, cache.get(rid) ?? null));
        await saveHideQueue(rid, displayQueue(rid));
        this.historyChanged();
        void this.flushHistoryQueue(rid);
    },

    // ─── Settings (§1) ─────────────────────────────────────────────────────

    /** The layer switched on or off in Settings. Switching it on reads; it never writes to the research. */
    toggleHistoryLayer(on: boolean): void {
        SettingsManager.setHistoryLayer(on);
        if (on) void this.refreshHistoryForActiveTree();
        else this.historyChanged();
    },

    /** The `experiment` link may be offered for the research (§1.3 canLinkOn / canLinkOff). */
    historyCanLinkOn(researchId: string): boolean {
        const status = this.researchBridgeUp(researchId) ? this.researchStatusOf(researchId) : null;
        if (!status || !(status.features ?? []).includes(EXPERIMENTS_LINK_FEATURE)) return false;
        if (status.treeState && status.treeState !== 'research') return false;
        return this.researchLinkAvailable('experiment');
    },

    renderHistorySettingsIfOpen(): void {
        if (document.getElementById('settings-modal')?.classList.contains('active')) this.renderHistorySettings();
    },

    /** The layer's toggle, status row and "History of places ›" (`fresh`: Settings just opened). */
    renderHistorySettings(fresh = false): void {
        if (fresh) offError = null;
        const toggle = document.getElementById('history-setting-toggle') as HTMLInputElement | null;
        const row = document.getElementById('history-setting-status');
        const link = document.getElementById('history-manage-link');
        const layerOn = SettingsManager.isHistoryLayer();
        if (toggle) toggle.checked = layerOn;
        if (!row || !link) return;
        const rid = activeResearchId();
        if (rid && layerOn && !cache.has(rid)) {
            void this.ensureHistoryCache(rid).then(() => this.renderHistorySettingsIfOpen());
        }
        const status = rid && this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        const features = status?.features ?? [];
        const payload = rid && layerOn ? cache.get(rid) ?? null : null;
        const canLink = !!rid && this.historyCanLinkOn(rid);
        const err = offError && offError.researchId === rid ? offError : null;
        const said = historySettingsStatus({
            layerOn,
            linked: !!rid,
            bridgeUp: !!status,
            noHistory: !!status && !features.includes(HISTORY_EVENTS_FEATURE),
            payload,
            ...(status?.experiments ? { statusSearching: status.experiments.history } : {}),
            ...(status?.treeState ? { treeState: status.treeState } : {}),
            canLinkOn: canLink,
            canOff: !!status && features.includes(EXPERIMENTS_OFF_FEATURE),
            canLinkOff: canLink,
            offDone: !!rid && offDone.has(rid),
            ...(err ? { offError: err.text } : {}),
            formatDate,
            formatTime,
        }, lang());
        if (!said) {
            row.hidden = true;
            row.innerHTML = '';
        } else {
            const h = strings.history;
            const button = (action: HistorySettingsAction | 'errLink', label: string): string =>
                ` <button type="button" class="link" data-history-action="${action}" onclick="window.Strom.UI.historySettingsAction('${action}')">${esc(label)}</button>`;
            let html = esc(said.text);
            if (said.action === 'linkOn') html += `${button('linkOn', h.enableSearch)} ${esc(h.enableSearchAlso)}`;
            else if (said.action) html += button(said.action, h.disableSearch);
            else if (err?.link) html += button('errLink', h.disableSearch);
            row.innerHTML = html;
            row.hidden = false;
        }
        this.renderHistoryKinds();
        const sub = document.getElementById('history-manage-link-sub');
        link.hidden = !this.historyManageAvailable();
        if (sub) sub.textContent = payload ? manageSummaries(payload, lang(), displayQueue(rid!)).settings : '';
    },

    /**
     * §6: the kinds the card shows and whether the place kind is offered
     * (`history.place` in the research's last status, the bridge up or not).
     */
    historyKindsNow(): { kinds: HistoryKinds; placeShown: boolean } {
        const rid = activeResearchId();
        const placeShown = !!rid && (this.researchStatusOf(rid)?.features ?? []).includes(HISTORY_PLACE_FEATURE);
        return { kinds: historyKindsShown(SettingsManager.getHistoryKinds(), placeShown), placeShown };
    },

    /** §6: the three sub-options under the main one: muted while it is off, the last one on locked with its sentence. */
    renderHistoryKinds(): void {
        const box = document.getElementById('history-kinds');
        if (!box) return;
        const layerOn = SettingsManager.isHistoryLayer();
        const { kinds, placeShown } = this.historyKindsNow();
        let locked = false;
        for (const kind of HISTORY_SCOPE_KINDS) {
            const row = box.querySelector<HTMLElement>(`[data-kind="${kind}"]`);
            const input = document.getElementById(`history-kind-${kind}`) as HTMLInputElement | null;
            if (!row || !input) continue;
            row.hidden = kind === 'place' && !placeShown;
            const last = layerOn && historyKindLocked(kinds, kind, placeShown);
            if (last) locked = true;
            input.checked = kinds[kind];
            row.classList.toggle('is-muted', !layerOn);
            row.classList.toggle('is-locked', last);
            if (!layerOn || last) input.setAttribute('aria-disabled', 'true');
            else input.removeAttribute('aria-disabled');
        }
        const note = document.getElementById('history-kinds-note');
        if (note) note.hidden = !locked;
    },

    /** A sub-option's click (§6): the last one on and all while the main option is off stay as they are. */
    historyKindClick(event: Event, kind: keyof HistoryKinds): void {
        const input = event.currentTarget as HTMLInputElement;
        if (input.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
        }
        SettingsManager.setHistoryKind(kind, input.checked);
        this.renderHistoryKinds();
        this.historyChanged();
    },

    /** A link or button of the status row. */
    historySettingsAction(action: HistorySettingsAction | 'errLink'): void {
        if (action === 'linkOn') this.historyEnableSearch();
        else if (action === 'off') void this.historyDisableSearch();
        else if (action === 'linkOff') this.historyLaunchExperiment('off');
        else if (action === 'errLink' && offError?.link) this.launchResearchLink(offError.link, 'terminal');
    },

    /** "Switch the search on in the research": its terminal asks (never through the bridge). Nothing waits for it here. */
    historyEnableSearch(): void {
        this.historyLaunchExperiment('on');
    },

    historyLaunchExperiment(d: 'on' | 'off'): void {
        const rid = activeResearchId();
        if (!rid) return;
        const url = researchSchemeUrl('experiment', { tree: rid, experiment: 'history', experimentDo: d }, announcedResearchScheme());
        if (url) this.launchResearchLink(url, 'terminal');
    },

    /** "Switch the search off for this tree": through the bridge at once when it says `experiments.off`, else its link. */
    async historyDisableSearch(): Promise<void> {
        const rid = activeResearchId();
        if (!rid) return;
        const status = this.researchBridgeUp(rid) ? this.researchStatusOf(rid) : null;
        const base = bridgeBase(rid);
        if (!status || !base || !(status.features ?? []).includes(EXPERIMENTS_OFF_FEATURE)) {
            if (this.historyCanLinkOn(rid)) this.historyLaunchExperiment('off');
            return;
        }
        const before = this.researchHeadNow(rid);
        const r = await postBridgeExperimentsOff(base, status.features, rid, announcedResearchScheme());
        if (r.ok) {
            offDone.set(rid, Date.now());
            offError = null;
            if (r.head) this.researchTakeOwnWriteHead(rid, before, r.head, r.parent);
            this.showToast(strings.history.toastSearchOff, 4000);
        } else {
            const text = r.reason || (r.held ? this.researchWriteHeldText(r.held, false).toast : strings.live.waitingWrite.writeFailed);
            offError = { researchId: rid, text, ...(r.link ? { link: r.link } : {}) };
        }
        this.renderHistorySettingsIfOpen();
        this.historyChanged();
    },

    /** Test hook: forget the page's history state (a new page). */
    resetHistoryLayerState(): void {
        cache.clear(); queues.clear(); inFlight.clear(); loadedRev.clear(); readHere.clear();
        reading.clear(); readAgain.clear(); flushing.clear(); offDone.clear(); offError = null;
    },
});
