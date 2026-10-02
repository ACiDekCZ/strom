/**
 * Where a research tree stands with its research, and sending changes straight
 * to it (Strom Research 1.12+, which says so in its status: `accepts`).
 *
 * The app remembers the research's bridge (its address comes with every
 * ?live= / ?send=), asks it now and then how things are (`/status?poll=1`, which
 * does not keep the bridge awake) and shows ONE state: a block at the top of
 * ⋯ → Research, a dot on ⋯ when the user has something to do, a pill in the
 * toolbar only when changes would be lost. "Send changes" POSTs the tree
 * without the terminal round trip; the research still writes nothing without
 * the user. An older research (no `accepts`) keeps every old path unchanged.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId, ResearchLink, ResearchSend } from '../types.js';
import { formatLiveClock } from '../live-time.js';
import {
    LiveStatus, contentFingerprint, fingerprintLike, sanitizeLiveStatus, sanitizeSyncReply, isSafariBrowser,
    parseLiveBridge, researchSchemeUrl,
} from '../research-link.js';
import {
    noteResearchLinks, noteResearchWaiting, noteResearchBridgeStatus, storedResearchBridge, researchLinksEnabled,
} from '../research-device.js';
import {
    ResearchSyncState, ResearchSyncKind, researchSyncState, researchSyncWantsAttention, researchSyncUnsent,
    pendingSendFate, sourceReadings, THEN_LOAD_MAX_AGE_MS,
} from '../research-sync.js';
import { uiModule } from './module.js';
import { fetchWithTimeout, postSync, onComputer, readTree, researchGedcom } from './research-ui.js';

/** How often the bridge is asked, the window visible: normally / while a send waits. */
const POLL_MS = 60_000;
const POLL_PENDING_MS = 30_000;
/** A status this fresh counts as "the bridge runs" without asking again. */
const FRESH_MS = 30_000;
/** Timeouts: the background ask, the ask before a send. */
const POLL_TIMEOUT_MS = 3000;
const PING_TIMEOUT_MS = 1500;
/** An answer younger than this is not asked again when the menu opens or the window comes back. */
const RECHECK_MS = 5000;
/** Quiet after the last edit before the state is worked out again. */
const RECOMPUTE_DEBOUNCE_MS = 1500;

/** What the app knows about one research's bridge in this page. */
interface BridgeRuntime {
    up: boolean;
    checkedAt: number;
    status: LiveStatus | null;
    /** The last ask failed the way Safari fails (a TypeError on a local address). */
    blocked: boolean;
}

const runtime = new Map<string, BridgeRuntime>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let sending = false;
let started = false;
/** The fingerprints of the active tree, worked out lazily (cleared by every edit). */
let fpCache: { treeId: TreeId; current: string; matchesBase: boolean; base: string } | null = null;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const call = (method: string, arg = ''): string => `window.Strom.UI.${method}(${arg})`;

function safariBrowser(): boolean {
    return typeof navigator !== 'undefined' && isSafariBrowser(navigator.userAgent || '')
        && /apple/i.test(navigator.vendor || '');
}

function visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/** "14:32" today, a date otherwise. */
function when(iso: string | undefined): string {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? formatLiveClock(t, Date.now(), getCurrentLanguage()) : '';
}

/** A status the bridge gave elsewhere (?live=, ?send=, following): it runs, and this is what it said. */
export function rememberBridgeStatus(researchId: string, status: LiveStatus): void {
    runtime.set(researchId, { up: true, checkedAt: Date.now(), status, blocked: false });
}

/** The research's name as its bridge said it (else the generic one). */
export function researchDisplayName(researchId: string): string {
    return runtime.get(researchId)?.status?.name || strings.research.defaultName;
}

export const researchSyncMethods = uiModule({
    /** Start watching the active research tree (after the first render; once). */
    initResearchSync(): void {
        if (started || typeof window === 'undefined') return;
        started = true;
        const changed = (): void => {
            fpCache = null;
            if (recomputeTimer) clearTimeout(recomputeTimer);
            recomputeTimer = setTimeout(() => { recomputeTimer = null; this.refreshResearchSyncUi(); }, RECOMPUTE_DEBOUNCE_MS);
        };
        window.addEventListener('strom:file-copy', changed);
        window.addEventListener('strom:data-changed', changed);
        window.addEventListener('strom:tree-switched', () => {
            fpCache = null;
            this.refreshResearchSyncUi();
            void this.pollResearchBridge();
        });
        // Back to the window: ask at once (a hidden window does not ask at all).
        document.addEventListener('visibilitychange', () => {
            if (visible()) this.refreshResearchStateSoon();
        });
        window.addEventListener('focus', () => this.refreshResearchStateSoon());
        void this.pollResearchBridge();
    },

    /** The active tree's research link, when the new behaviour applies to it (else null). */
    researchSyncLink(): { treeId: TreeId; link: ResearchLink } | null {
        if (DataManager.isViewMode()) return null;
        const treeId = DataManager.getCurrentTreeId();
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        return treeId && link ? { treeId, link } : null;
    },

    /** The research said what it takes (now or before): sending straight and the states are on. */
    researchSyncCapable(researchId: string): boolean {
        return !!(runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts);
    },

    /** It knows how much a transcript weighs (Research for this tree, "Transcription verified"). */
    researchTranscriptsCapable(researchId: string | undefined): boolean {
        if (!researchId) return false;
        const accepts = runtime.get(researchId)?.status?.accepts ?? storedResearchBridge(researchId)?.accepts;
        return !!accepts?.verified;
    },

    /** The bridge answered within FRESH_MS. */
    researchBridgeFresh(researchId: string): boolean {
        const rt = runtime.get(researchId);
        return !!rt?.up && Date.now() - rt.checkedAt < FRESH_MS;
    },

    /** The fingerprints of the active tree now (cached until the next edit). */
    researchSyncFingerprints(treeId: TreeId, link: ResearchLink): { current: string; matchesBase: boolean } {
        if (fpCache && fpCache.treeId === treeId && fpCache.base === link.fingerprint) return fpCache;
        const data = DataManager.getData();
        const current = contentFingerprint(data);
        const matchesBase = !!link.fingerprint && fingerprintLike(data, link.fingerprint) === link.fingerprint;
        fpCache = { treeId, current, matchesBase, base: link.fingerprint };
        return fpCache;
    },

    /** The one state of the active tree (kind 'none': nothing new is shown). */
    currentResearchSyncState(): ResearchSyncState {
        const ctx = this.researchSyncLink();
        if (!ctx) return { kind: 'none' };
        const { treeId, link } = ctx;
        const shown = onComputer() && researchLinksEnabled() && !DataManager.isTreeLocked();
        const capable = this.researchSyncCapable(link.id);
        if (!shown || !capable) return { kind: 'none' };
        const rt = runtime.get(link.id);
        const fps = this.researchSyncFingerprints(treeId, link);
        const remoteHead = rt?.status?.head || storedResearchBridge(link.id)?.head || '';
        const safari = safariBrowser() && (!rt || rt.blocked || !storedResearchBridge(link.id)?.base);
        return researchSyncState({
            link, capable, shown,
            matchesBase: fps.matchesBase,
            current: fps.current,
            bridgeUp: !!rt?.up,
            safari,
            remoteHead,
        });
    },

    // ==================== ASKING THE BRIDGE ====================

    /**
     * Ask the active research's bridge how things are (`/status?poll=1`, short
     * timeout), take in what it says, settle a waiting send, redraw. Schedules
     * the next ask. Never throws.
     */
    async pollResearchBridge(opts: { timeout?: number; reschedule?: boolean } = {}): Promise<boolean> {
        if (opts.reschedule !== false) this.scheduleResearchPoll();
        const ctx = this.researchSyncLink();
        if (!ctx || !onComputer() || !researchLinksEnabled()) return false;
        const researchId = ctx.link.id;
        const stored = storedResearchBridge(researchId);
        const bridge = parseLiveBridge(stored?.base);
        // Only a research that said what it takes (at a ?live= / ?send=) is
        // asked on its own; an older one is never contacted unasked.
        if (!bridge || !this.researchSyncCapable(researchId)) {
            this.refreshResearchSyncUi();
            return false;
        }
        if (polling && opts.timeout === undefined) return this.researchBridgeFresh(researchId);
        polling = true;
        let status: LiveStatus | null = null;
        let blocked = false;
        try {
            const res = await fetchWithTimeout(`${bridge.status}?poll=1`, opts.timeout ?? POLL_TIMEOUT_MS);
            if (res.ok) status = sanitizeLiveStatus(await res.json());
        } catch (err) {
            blocked = err instanceof TypeError;
        } finally {
            polling = false;
        }
        // An address of another research (the port went to another tree's bridge): not ours.
        if (status && status.treeId !== researchId) status = null;
        runtime.set(researchId, { up: !!status, checkedAt: Date.now(), status, blocked: !status && blocked });
        if (status) {
            noteResearchLinks(status.links);
            noteResearchWaiting(researchId, status.waiting, status);
            noteResearchBridgeStatus(researchId, status.accepts, status.head);
            await this.settleResearchSend(ctx.treeId, status);
        }
        this.refreshResearchSyncUi();
        return !!status;
    },

    /** Ask now unless the last answer is only seconds old (menu opened, window back). */
    refreshResearchStateSoon(): void {
        const ctx = this.researchSyncLink();
        const rt = ctx ? runtime.get(ctx.link.id) : undefined;
        if (rt && Date.now() - rt.checkedAt < RECHECK_MS) return;
        void this.pollResearchBridge();
    },

    scheduleResearchPoll(): void {
        if (pollTimer) clearTimeout(pollTimer);
        const ctx = this.researchSyncLink();
        const waiting = ctx?.link.sent?.state === 'pending';
        pollTimer = setTimeout(() => {
            pollTimer = null;
            if (visible()) void this.pollResearchBridge();
            else this.scheduleResearchPoll();
        }, waiting ? POLL_PENDING_MS : POLL_MS);
    },

    /** A send waiting in the research's inbox: written, discarded, or still there. */
    async settleResearchSend(treeId: TreeId, status: LiveStatus): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        const sent = link?.sent;
        if (!link || !sent || sent.state !== 'pending') return;
        // "Send, then load" waits a day at most.
        if (sent.thenLoad && Date.now() - Date.parse(sent.at) > THEN_LOAD_MAX_AGE_MS) {
            TreeManager.patchResearchLink(treeId, { sent: { ...sent, thenLoad: false } });
        }
        const fate = pendingSendFate(sent, treeId, link.id, status);
        if (fate === null || fate.state === 'pending') return;
        const closed: ResearchSend = {
            ...sent, state: fate.state, closedAt: fate.at || new Date().toISOString(),
            ...(fate.reason ? { reason: fate.reason } : {}),
            ...(fate.nothing ? { changes: 0 } : {}),
        };
        TreeManager.patchResearchLink(treeId, { sent: closed });
        if (fate.state === 'discarded') {
            if (!sent.noticed) {
                TreeManager.patchResearchLink(treeId, { sent: { ...closed, noticed: true } });
                const s = strings.sync;
                this.showToast(s.rejectedToast(when(sent.at), fate.reason), Infinity, {
                    closable: true,
                    action: { label: s.sendAgain, run: () => { void this.researchSendNow(); } },
                });
            }
            return;
        }
        // Written: "Send, then load" loads the version that has the changes now.
        if (sent.thenLoad && DataManager.getCurrentTreeId() === treeId) {
            const fps = this.researchSyncFingerprints(treeId, link);
            if (fps.current === sent.fingerprint) await this.researchLoadNewer({ afterSend: true });
            else await this.researchLoadNewer();
        }
    },

    // ==================== SENDING ====================

    /** Is the bridge up right now? A fresh status, else a quick ask. */
    async researchBridgeReady(researchId: string): Promise<boolean> {
        if (this.researchBridgeFresh(researchId)) return true;
        return this.pollResearchBridge({ timeout: PING_TIMEOUT_MS, reschedule: false });
    },

    /**
     * "Send changes": straight to the bridge when it runs (no dialog; the
     * research shows them and writes nothing without the user), else the old
     * way through the terminal. `thenLoad`: load the research's new version
     * once the send is written there.
     */
    async researchSendNow(opts: { thenLoad?: boolean; treeId?: TreeId } = {}): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || sending) return;
        // Asked for one tree: never send another (the open tree changed meanwhile).
        if (opts.treeId && ctx.treeId !== opts.treeId) return;
        const { treeId, link } = ctx;
        const s = strings.sync;
        if (!this.researchSyncCapable(link.id) || !await this.researchBridgeReady(link.id)) {
            // The old way: the research starts it in the terminal (?send= comes back).
            await this.sendTreeToResearch(treeId);
            return;
        }
        if (!await this.ensureLocalUnlocked()) return;
        const data = await readTree(treeId);
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (!data || !bridge) return;
        const fps = this.researchSyncFingerprints(treeId, link);
        if (fps.matchesBase) {
            TreeManager.patchResearchLink(treeId, { refused: undefined });
            this.showToast(s.nothingToast, 4000);
            if (opts.thenLoad) await this.researchLoadNewer();
            this.refreshResearchSyncUi();
            return;
        }
        const meta = TreeManager.getTreeMetadata(treeId);
        const head = runtime.get(link.id)?.status?.head ?? '';
        const gedcom = researchGedcom(data, meta?.name ?? '', {
            id: link.id, head: link.head, appTree: treeId, transcripts: link.transcripts, sent: fps.current,
        });
        sending = true;
        this.refreshResearchSyncUi();
        let res: Response;
        try {
            res = await postSync(`${bridge.base}/sync`, gedcom, 120000);
        } catch (err) {
            console.warn('Sending to the research failed', err);
            sending = false;
            runtime.set(link.id, { up: false, checkedAt: Date.now(), status: null, blocked: err instanceof TypeError });
            this.refreshResearchSyncUi();
            await this.sendTreeToResearch(treeId);
            return;
        }
        let reply = sanitizeSyncReply(null);
        try { reply = sanitizeSyncReply(await res.json()); } catch { /* a refusal without a reason */ }
        sending = false;
        if (!res.ok || !reply.ok) {
            TreeManager.patchResearchLink(treeId, { refused: { reason: reply.error, at: new Date().toISOString() } });
            this.refreshResearchSyncUi();
            await this.showResearchRefused(reply.error, opts);
            return;
        }
        const now = new Date().toISOString();
        // Nothing the research could take (0 changes), or written at once: no inbox to wait for.
        const written = reply.inbox === false || reply.changes === 0;
        TreeManager.patchResearchLink(treeId, {
            refused: undefined,
            sentSources: sourceReadings(data),
            sent: {
                fingerprint: fps.current, at: now, changes: reply.changes, head,
                ...(reply.intake ? { intake: reply.intake } : {}),
                state: written ? 'written' : 'pending',
                ...(written ? { closedAt: now } : {}),
                ...(opts.thenLoad && !written ? { thenLoad: true } : {}),
            },
        });
        this.refreshResearchSyncUi();
        this.scheduleResearchPoll();
        if (reply.changes === 0) {
            this.showToast(s.nothingToast, 4000);
        } else if (written) {
            this.showToast(s.writtenToast, 6000);
        } else {
            const open = this.researchLinkAvailable('open') ? researchSchemeUrl('open', { tree: link.id }) : null;
            this.showToast(s.sentToast(reply.changes), 6000, open
                ? { action: { label: s.openResearch, run: () => this.launchResearchLink(open) } } : {});
        }
        if (opts.thenLoad && written) await this.researchLoadNewer({ afterSend: true });
    },

    /** Tree menus' "Send changes": the same send for any tree (switched to first when a running research takes it straight). */
    async researchSendTree(treeId: TreeId, opts: { thenLoad?: boolean } = {}): Promise<void> {
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link) return;
        if (!this.researchSyncCapable(link.id)) {
            await this.sendTreeToResearch(treeId);
            return;
        }
        if (DataManager.getCurrentTreeId() !== treeId) {
            await this.switchToTree(treeId);
            if (DataManager.getCurrentTreeId() !== treeId) return;
        }
        await this.researchSendNow({ ...opts, treeId });
    },

    /** The bridge refused the send: say why, offer to try again. */
    async showResearchRefused(reason: string, opts: { thenLoad?: boolean } = {}): Promise<void> {
        const s = strings.sync;
        const message = [reason ? s.refusedReason(reason) : '', s.refusedBody].filter(Boolean).join('\n\n');
        const pick = await this.showChoice(message, s.refusedTitle, [{ id: 'retry', label: s.retry }], undefined,
            { cancelLabel: strings.buttons.close });
        if (pick === 'retry') await this.researchSendNow(opts);
    },

    /**
     * Load the research's version: straight from the bridge when it runs (the
     * usual update path asks when the tree has changes), else the old link.
     * `afterSend`: the version holds the user's changes (they were sent and
     * written): replace without asking.
     */
    async researchLoadNewer(opts: { afterSend?: boolean } = {}): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const { treeId, link } = ctx;
        const bridge = parseLiveBridge(storedResearchBridge(link.id)?.base);
        if (bridge && await this.researchBridgeReady(link.id)) {
            await this.importResearchFromUrl(`${bridge.base}/tree.ged`, opts.afterSend ? { afterSend: treeId } : {});
            return;
        }
        const url = this.activeResearchLink('app');
        if (url) this.launchResearchLink(url, 'version');
    },

    /** "Cancel loading": the send stays, the new version is not loaded by itself. */
    researchCancelThenLoad(): void {
        const ctx = this.researchSyncLink();
        const sent = ctx?.link.sent;
        if (!ctx || !sent) return;
        TreeManager.patchResearchLink(ctx.treeId, { sent: { ...sent, thenLoad: false } });
        this.refreshResearchSyncUi();
    },

    /** A button of the state block / pill / data row. */
    researchSyncAction(action: string): void {
        const ctx = this.researchSyncLink();
        if (!ctx) return;
        const keepMenu = action === 'cancelLoad';
        if (!keepMenu) this.closeActionsMenu();
        switch (action) {
            case 'send': case 'retry': case 'sendAgain': void this.researchSendNow(); break;
            case 'sendThenLoad': void this.researchSendNow({ thenLoad: true }); break;
            case 'loadNewer': void this.researchLoadNewer(); break;
            case 'cancelLoad': this.researchCancelThenLoad(); break;
            case 'startResearch': {
                const url = this.activeResearchLink('open') ?? this.activeResearchLink('live');
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'startAndSend': void this.sendTreeToResearch(ctx.treeId); break;
            case 'openResearch': {
                const url = this.activeResearchLink('open');
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'downloadGedcom': void this.downloadResearchGedcom(ctx.treeId); break;
        }
    },

    // ==================== SHOWING IT ====================

    /** Redraw everything that shows the state (menu block, ⋯ dot, pill). */
    refreshResearchSyncUi(): void {
        this.refreshActionMenuBadges();
        this.renderResearchSyncPill();
    },

    /** The state block at the top of ⋯ → Research ('' when there is none). */
    researchSyncBlockHtml(): string {
        const state = this.currentResearchSyncState();
        if (state.kind === 'none') return '';
        const s = strings.sync;
        const ctx = this.researchSyncLink();
        const link = ctx?.link;
        type Block = { tone: 'warn' | 'neutral' | 'quiet'; title: string; sub?: string; action?: string; label?: string; asLink?: boolean };
        const changed = ctx ? when(TreeManager.getTreeMetadata(ctx.treeId)?.changedAt) : '';
        const blocks: Record<Exclude<ResearchSyncKind, 'none'>, () => Block> = {
            inSync: () => ({ tone: 'quiet', title: s.stateInSync,
                sub: s.sinceTime(when(link?.sent?.state === 'written' ? link.sent.closedAt : link?.syncedAt)) }),
            unsent: () => ({ tone: 'warn', title: s.stateUnsent, sub: changed ? s.changedAt(changed) : undefined, action: 'send', label: s.send }),
            sentPending: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.statePendingSub, action: this.researchLinkAvailable('open') ? 'openResearch' : undefined, label: s.openResearch, asLink: true }),
            newer: () => {
                const at = runtime.get(link?.id ?? '')?.status?.headAt;
                return { tone: 'neutral', title: s.stateNewer, sub: at ? s.fromTime(when(at)) : undefined, action: 'loadNewer', label: s.loadNewer };
            },
            unsentAndNewer: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentNewerSub, action: 'sendThenLoad', label: s.sendThenLoad }),
            waitThenLoad: () => ({ tone: 'neutral', title: s.stateSent(when(state.sent?.at), state.sent?.changes ?? null),
                sub: s.waitThenLoadSub, action: 'cancelLoad', label: s.cancelLoad, asLink: true }),
            bridgeDown: () => ({ tone: 'quiet', title: s.stateBridgeDown, sub: s.bridgeDownSub,
                action: this.researchLinkAvailable('open') || this.researchLinkAvailable('live') ? 'startResearch' : undefined,
                label: s.startResearch, asLink: true }),
            unsentBridgeDown: () => ({ tone: 'warn', title: s.stateUnsent, sub: s.unsentBridgeDownSub,
                action: this.researchLinkAvailable('send') ? 'startAndSend' : undefined, label: s.startAndSend }),
            refused: () => ({ tone: 'warn', title: s.stateRefused,
                sub: [state.reason, s.staysHere].filter(Boolean).join(' '), action: 'retry', label: s.retry }),
            rejected: () => ({ tone: 'warn', title: s.stateRejected(when(state.sent?.at)),
                sub: [s.rejectedSub(when(state.sent?.closedAt)), state.sent?.reason ? `(${state.sent.reason})` : ''].filter(Boolean).join(' '),
                action: 'sendAgain', label: s.sendAgain }),
            safari: () => ({ tone: 'neutral', title: s.stateSafari, sub: s.safariSub, action: 'downloadGedcom', label: s.downloadGedcom, asLink: true }),
        };
        const b = blocks[state.kind]();
        const busy = sending && b.action !== undefined && ['send', 'sendThenLoad', 'retry', 'sendAgain'].includes(b.action);
        const button = !b.action ? '' : b.asLink
            ? `<button type="button" class="research-sync-link" onclick="${call('researchSyncAction', `'${b.action}'`)}">${esc(b.label ?? '')}</button>`
            : `<button type="button" class="primary btn-sm research-sync-btn"${busy ? ' disabled aria-busy="true"' : ''}`
                + ` onclick="${call('researchSyncAction', `'${b.action}'`)}">${busy ? `<span class="research-sync-spinner" aria-hidden="true"></span>${esc(s.sending)}` : esc(b.label ?? '')}</button>`;
        return `<div class="research-sync-block research-sync-block--${b.tone}" id="research-sync-block" data-state="${state.kind}" role="status" aria-live="polite">`
            + `<div class="research-sync-title">${esc(b.title)}</div>`
            + (b.sub ? `<div class="research-sync-sub">${esc(b.sub)}</div>` : '')
            + (button ? `<div class="research-sync-actions">${button}</div>` : '')
            + '</div>';
    },

    /** The ⋯ dot and label for the sync state (refreshActionMenuBadges calls this). */
    researchSyncAttention(): boolean {
        const kind = this.currentResearchSyncState().kind;
        const attention = researchSyncWantsAttention(kind);
        const btn = document.querySelector<HTMLElement>('.actions-menu-btn');
        if (btn) {
            if (btn.dataset.baseLabel === undefined) btn.dataset.baseLabel = btn.getAttribute('aria-label') ?? '';
            btn.setAttribute('aria-label', researchSyncUnsent(kind) ? strings.sync.moreHint : btn.dataset.baseLabel || strings.menu.actions);
        }
        const rowDot = document.getElementById('actions-research-dot');
        if (rowDot) rowDot.style.display = attention ? 'inline-block' : 'none';
        return attention;
    },

    /** The toolbar pill: only when changes would be lost, and while "Send, then load" waits. */
    renderResearchSyncPill(): void {
        const pill = document.getElementById('research-sync-pill');
        if (!pill) return;
        const kind = this.currentResearchSyncState().kind;
        const s = strings.sync;
        if (kind !== 'unsentAndNewer' && kind !== 'waitThenLoad') {
            pill.style.display = 'none';
            pill.innerHTML = '';
            return;
        }
        pill.style.display = '';
        pill.classList.toggle('is-warn', kind === 'unsentAndNewer');
        pill.classList.toggle('is-wait', kind === 'waitThenLoad');
        const text = kind === 'unsentAndNewer' ? s.barUnsent : s.waitThenLoad;
        pill.title = text;
        const icon = kind === 'waitThenLoad'
            ? '<span class="research-sync-spinner" aria-hidden="true"></span>'
            : '<span class="research-sync-pill-mark" aria-hidden="true">!</span>';
        const send = kind === 'unsentAndNewer'
            ? `<button type="button" class="research-sync-pill-send" onclick="event.stopPropagation(); ${call('researchSyncAction', "'sendThenLoad'")}">${esc(s.barSend)}</button>`
            : '';
        const html = `${icon}<span class="research-sync-pill-label" onclick="${call('openResearchSyncMenu')}">${esc(text)}</span>${send}`;
        if (pill.dataset.html !== html) {
            pill.innerHTML = html;
            pill.dataset.html = html;
        }
    },

    /** The pill's text: open ⋯ → Research. */
    openResearchSyncMenu(): void {
        this.toggleActionsMenu();
        if (document.getElementById('actions-menu-dropdown')?.classList.contains('active')) this.openActionsResearchSubmenu();
    },

    /** The row in "Where your data is" while the research lacks the changes (null otherwise). */
    researchSyncDataRow(): HTMLElement | null {
        const kind = this.currentResearchSyncState().kind;
        if (!researchSyncUnsent(kind)) return null;
        const s = strings.sync;
        const row = document.createElement('div');
        row.className = 'storage-status-research';
        const label = document.createElement('span');
        label.className = 'storage-status-research-label';
        const strong = document.createElement('strong');
        strong.textContent = s.dataRowLabel;
        label.append(strong, document.createTextNode(` ${s.stateUnsent}`));
        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'link-button storage-status-research-send';
        send.textContent = s.barSend;
        send.onclick = () => {
            this.closeStorageStatusDialog();
            void this.researchSendNow();
        };
        row.append(label, send);
        return row;
    },
});
