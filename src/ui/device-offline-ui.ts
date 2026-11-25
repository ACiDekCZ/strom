/**
 * A device of the home network without its computer (spec 094 §7, 7.1–7.14):
 * five states — not reachable (also switched off on the computer), another
 * address, another network or none, unpaired — each with the tree switcher's
 * second line (§3) and a quiet line over the content (`.qline`, no box, no
 * stripe) that links to what waits on this device ("Waiting to be sent: n
 * photos, m edits ›"). Meanwhile the tree is read-only as last known (cards
 * dimmed, nothing edited), the research's actions are grey but "Add
 * materials…" goes on (its photos wait here). Nothing that waits is ever
 * dropped without "Discard…" and its confirmation; an unpairing keeps it.
 * Back again: a toast says what is being sent, then the batch's own progress
 * (§5) and the sync block's sending; a conflict goes to §9.
 *
 * Outside the device mode none of this exists.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { DataManager, LIVE_FOLLOW_EVENT } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { isPhoneToolbar } from './search.js';
import { showToast } from './toast.js';
import { inDeviceMode, deviceComputerName } from './device-mode-ui.js';
import { saveDevicePhotos } from './device-photos-ui.js';
import { changeKindsText } from './research-changes-ui.js';
import {
    deviceConnection, onDeviceConnection, retryDeviceConnection, type DeviceConnectionState,
} from '../device/device-connection.js';
import { deviceQueue, queueCounts } from '../device/device-store.js';
import { deviceDrafts, type DeviceBatchDraft } from '../device/device-photos.js';
import { onGatewayOutcome } from '../device/gateway-client.js';
import { formatLiveClock } from '../live-time.js';
import type { TreeId } from '../types.js';

/** Why the device is without its computer (null: connected, or not in the device mode). */
export type DeviceDownKind = 'unreachable' | 'moved' | 'offline' | 'unpaired';

const QLINE_ID = 'device-qline';
const DIALOG_ID = 'device-waiting-modal';
const SHEET_CLASS = 'device-waiting-sheet';
/** Thumbnails shown of the photos waiting (the rest is in the count). */
const THUMBS_MAX = 12;

/**
 * The state behind a connection's state: a try between two failures
 * (`connecting`) keeps the state it had, so nothing flickers while it tries;
 * switched off on the computer reads as not reachable.
 */
export function deviceDownKindOf(state: DeviceConnectionState, prev: DeviceDownKind | null): DeviceDownKind | null {
    switch (state) {
        case 'connected': return null;
        case 'connecting': return prev;
        case 'otherAddress': return 'moved';
        case 'offline': return 'offline';
        case 'unpaired': return 'unpaired';
        default: return 'unreachable';
    }
}

/** The quiet line's sentence for a state (`t`: the last known state's time, '' when none; `held`: a tree to show). */
export function deviceDownText(kind: DeviceDownKind, pc: string, t: string, held: boolean): string {
    const d = strings.device;
    switch (kind) {
        case 'moved': return d.moved(pc);
        case 'offline': return d.homeOnly(pc);
        case 'unpaired': return `${d.unpaired(pc)} ${d.repair}`;
        default: return held ? (t ? d.down(pc, t) : d.downNoTime(pc)) : `${d.downNoTime(pc)} ${d.downEmpty}`;
    }
}

let down: DeviceDownKind | null = null;
/** When the gateway last answered (the last known state's time). */
let lastOkAt: number | null = null;
onGatewayOutcome((o) => { if (o.ok) lastOkAt = Date.now(); });
let hooked = false;
let renderSeq = 0;
let unwatchWaiting: (() => void) | null = null;
let thumbUrls: string[] = [];

/** The device is without its computer now (null: connected, connecting the first time, or not a device). */
export function deviceDownNow(): DeviceDownKind | null {
    return down;
}

function esc(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function dropThumbs(): void {
    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = [];
}

export const deviceOfflineMethods = uiModule({
    /** Called with each change of the connection (refreshDeviceModeUi): the state, the lock, the quiet line, the return. */
    refreshDeviceOffline(): void {
        const conn = deviceConnection();
        const was = down;
        down = inDeviceMode() && conn ? deviceDownKindOf(conn.state, down) : null;
        if (!hooked && inDeviceMode()) {
            hooked = true;
            DataManager.setHeldReadOnly(() => down !== null);
            // An edit, a load, a discard: the line counts again.
            window.addEventListener('strom:data-changed', () => { if (down) void this.renderDeviceQline(); });
        }
        document.body.classList.toggle('device-down', down !== null);
        if ((was === null) !== (down === null)) {
            if (down) {
                // Whatever edits the tree goes: nothing is written while the computer is away.
                this.hideContextMenu();
            }
            window.dispatchEvent(new CustomEvent(LIVE_FOLLOW_EVENT));
            this.refreshUndoRedoToolbar();
            TreeRenderer.render();
            this.refreshResearchMenu();
        }
        if (was && was !== 'unpaired' && !down && conn?.state === 'connected') void this.deviceReconnected();
        if (down === 'unpaired' && was !== 'unpaired') {
            // The research's last state went with the pairing (forgetPairing): the phone's screen forgets it too.
            this.phoneResearchForget();
            void this.deviceForgetHeldTree();
        }
        // The phone's Research screen: its actions grey while away, back with the connection.
        if (was !== down && this.phoneResearchActive()) this.renderPhoneResearch();
        void this.renderDeviceQline();
    },

    /** Why the device is without its computer now (null: connected, or not a device). */
    deviceDownKind(): DeviceDownKind | null {
        return down;
    },

    /** The research group's state line on the More sheet while away (7.3): "The computer … is not reachable · last known state 14:05". */
    deviceDownStateLine(): string {
        const d = strings.device;
        const pc = deviceComputerName();
        if (down === 'unpaired' || down === 'moved' || down === 'offline') return deviceDownText(down, pc, '', true);
        return lastOkAt !== null ? d.downState(pc, formatLiveClock(lastOkAt, Date.now(), getCurrentLanguage())) : d.downNoTime(pc);
    },

    /** The photos and edits waiting on this device: the queue, and the open research tree's changes not sent. */
    async deviceWaitingCounts(): Promise<{ photos: number; edits: number }> {
        const q = await queueCounts();
        const ctx = this.researchSyncLink();
        return { photos: q.photos, edits: q.edits + (ctx ? this.researchChangesWaitingCount(ctx.treeId) : 0) };
    },

    /** The quiet line over the content (7.1, 7.2, 7.6–7.8, 7.10–7.13), or none while connected. */
    async renderDeviceQline(): Promise<void> {
        const seq = ++renderSeq;
        if (!down) {
            this.closeDeviceQline();
            return;
        }
        const waiting = await this.deviceWaitingCounts();
        if (seq !== renderSeq || !down) return;
        const d = strings.device;
        const pc = deviceComputerName();
        const clock = (at: number | null): string => (at !== null && Number.isFinite(at) ? formatLiveClock(at, Date.now(), getCurrentLanguage()) : '');
        // The phone's Research screen shows the research's last state (§8 points 1–2): its time, or none held.
        const screenAt = this.phoneResearchStateAt();
        const text = screenAt !== undefined
            ? deviceDownText(down, pc, screenAt ? clock(lastOkAt ?? Date.parse(screenAt)) : '', true)
            : deviceDownText(down, pc, clock(lastOkAt), !!this.researchSyncLink());
        const pending = waiting.photos + waiting.edits > 0
            ? `<button type="button" class="qline-link" data-act="pending" aria-haspopup="dialog">${esc(d.pending(waiting.photos, waiting.edits))}<span aria-hidden="true"> ›</span></button>`
            : '';
        const trying = deviceConnection()?.state === 'connecting';
        const retry = down === 'unpaired' ? ''
            : `<button type="button" class="qline-act" data-act="retry"${trying ? ' disabled' : ''}>${esc(d.retry)}</button>`;
        let el = document.getElementById(QLINE_ID);
        if (!el) {
            // The home-screen icon's line gives way (it comes back with the connection).
            this.closeDeviceHomeLine();
            el = document.createElement('div');
            el.id = QLINE_ID;
            el.className = 'qline device-qline';
            el.setAttribute('role', 'status');
            el.addEventListener('click', (e) => {
                const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-act]');
                if (!btn || btn.disabled) return;
                if (btn.dataset.act === 'retry') {
                    btn.disabled = true;
                    retryDeviceConnection();
                } else if (btn.dataset.act === 'pending') void this.showDeviceWaiting();
            });
            document.body.appendChild(el);
            // On the phone's Research screen: under its header (§8 point 1).
            this.placePhoneScreenLines();
        }
        el.dataset.state = down;
        const focused = (document.activeElement as HTMLElement | null)?.closest('#' + QLINE_ID) ? (document.activeElement as HTMLElement).dataset.act : '';
        el.innerHTML = `<span class="qline-body"><span class="qline-text">${esc(text)}</span>${pending}</span>${retry}`;
        if (focused) el.querySelector<HTMLElement>(`[data-act="${focused}"]`)?.focus();
        document.body.classList.add('device-home-line-on', 'device-qline-on');
        document.body.style.setProperty('--device-home-line-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    },

    closeDeviceQline(): void {
        const el = document.getElementById(QLINE_ID);
        if (!el) return;
        el.remove();
        document.body.classList.remove('device-home-line-on', 'device-qline-on');
        document.body.style.removeProperty('--device-home-line-h');
    },

    /**
     * Back again (7.9, 7.14): a paused batch goes on, photos handed over whose batch a reload cut
     * go again (once the research's status is read), changes sent by themselves go; the toast
     * says what goes.
     */
    async deviceReconnected(): Promise<void> {
        this.batchDeviceResumeAgain();
        let photos = this.batchResumeAfterReconnect();
        if (!photos) photos = await this.batchResumeDevicePhotos({ count: true });
        const ctx = this.researchSyncLink();
        let edits = 0;
        if (ctx && this.researchAutoOn(ctx.link)) {
            edits = this.researchChangesWaitingCount(ctx.treeId);
            if (edits > 0) this.scheduleResearchAutoSend(ctx.treeId, 1500);
        }
        const d = strings.device;
        showToast(photos + edits > 0 ? d.back(photos, edits) : d.backNone, 5000, { kind: 'device-back' });
        this.showDeviceHomeLine();
        void this.pollResearchBridge({ reschedule: true });
    },

    // ==================== "WAITING ON THIS DEVICE" (7.4, 7.5) ====================

    deviceWaitingHost(): HTMLElement | null {
        return document.querySelector<HTMLElement>(`#${DIALOG_ID} .device-waiting, .${SHEET_CLASS} .device-waiting`);
    },

    /** The list of what waits: a sheet from below on a phone, a dialog elsewhere. */
    async showDeviceWaiting(): Promise<void> {
        if (!inDeviceMode() || this.deviceWaitingHost()) return;
        const d = strings.device;
        let host: HTMLElement;
        if (isPhoneToolbar()) {
            const body = this.presentPortraitSheet(esc(d.pendingTitle), { label: d.pendingTitle, onClose: () => this.deviceWaitingClosed() });
            body.parentElement?.classList.add(SHEET_CLASS);
            body.className = 'device-waiting device-waiting--sheet';
            host = body;
        } else {
            const overlay = document.createElement('div');
            overlay.id = DIALOG_ID;
            overlay.className = 'modal-overlay active';
            overlay.innerHTML = `
                <div class="modal modal--md device-waiting-dialog" role="dialog" aria-modal="true" aria-labelledby="device-waiting-title">
                    <div class="modal-header">
                        <h2 id="device-waiting-title">${esc(d.pendingTitle)}</h2>
                        <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                    </div>
                    <div class="modal-content device-waiting"></div>
                    <div class="buttons"><button type="button" class="secondary" data-act="close">${esc(d.connDone)}</button></div>
                </div>`;
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeDeviceWaiting();
            });
            document.body.appendChild(overlay);
            this.pushDialog(DIALOG_ID);
            host = overlay.querySelector<HTMLElement>('.device-waiting')!;
        }
        host.closest('.modal, .bottom-sheet')?.addEventListener('click', (e) => this.deviceWaitingClick(e));
        await this.renderDeviceWaiting();
        unwatchWaiting?.();
        unwatchWaiting = onDeviceConnection(() => void this.renderDeviceWaiting());
        const first = this.deviceWaitingHost()?.querySelector<HTMLElement>('button') ?? document.querySelector<HTMLElement>(`#${DIALOG_ID} [data-act="close"]`);
        first?.focus();
    },

    async renderDeviceWaiting(): Promise<void> {
        const host = this.deviceWaitingHost();
        if (!host) return;
        const d = strings.device;
        const drafts = await deviceDrafts();
        const waiting = await this.deviceWaitingCounts();
        if (this.deviceWaitingHost() !== host) return;
        const pc = deviceComputerName();
        const note = waiting.photos + waiting.edits === 0 ? d.pendingNone
            : down === 'unpaired' ? d.pendingStay
            : down ? this.deviceWaitingNote(drafts, waiting.edits) : '';
        dropThumbs();
        const photos = drafts.flatMap(x => x.photos);
        const thumbs = photos.slice(0, THUMBS_MAX).map(p => {
            const url = URL.createObjectURL(p.blob);
            thumbUrls.push(url);
            return `<span class="device-waiting-th"><img src="${url}" alt="" loading="lazy"></span>`;
        }).join('');
        const photoBlock = photos.length
            ? `<div class="device-waiting-photos"><div class="device-waiting-thumbs" aria-hidden="true">${thumbs}</div>`
                + `<p class="device-waiting-count">${esc(d.pendingPhotos(photos.length))}</p></div>`
            : '';
        const changes = this.researchSyncLink() ? this.researchChangesShown() ?? [] : [];
        const rows = changes.map(ch => '<div class="device-waiting-row">'
            + `<span class="device-waiting-name">${esc(ch.name)}</span>`
            + `<span class="device-waiting-kinds">${esc(changeKindsText(ch.kinds, ch))}</span></div>`).join('');
        const any = waiting.photos + waiting.edits > 0;
        const actions = any
            ? '<div class="device-waiting-actions">'
                + (waiting.photos > 0 ? `<button type="button" class="secondary device-waiting-save" data-act="save">${esc(d.savePhotos)}</button>` : '')
                + `<button type="button" class="device-waiting-discard" data-act="discard">${esc(strings.batch.discardDevice)}</button>`
                + '</div>'
            : '';
        host.innerHTML = (note ? `<p class="device-waiting-note">${esc(note)}</p>` : '')
            + photoBlock
            + (rows ? `<div class="device-waiting-rows">${rows}</div>` : '')
            + actions;
    },

    /**
     * What happens to what waits once the computer is back, as it will (K3.8): photos handed
     * over (Send) and a batch the computer cut go by themselves, photos only chosen go with
     * Add materials…; edits go by themselves only with sending by itself on, else with Send.
     */
    deviceWaitingNote(drafts: readonly DeviceBatchDraft[], edits: number): string {
        const d = strings.device;
        const pc = deviceComputerName();
        const going = this.batchRunTree();
        let photosAuto = 0;
        let photosManual = 0;
        for (const x of drafts) {
            if (x.handedAt || x.treeId === going) photosAuto += x.photos.length;
            else photosManual += x.photos.length;
        }
        const ctx = this.researchSyncLink();
        const editsAuto = edits > 0 && !!ctx && this.researchAutoOn(ctx.link);
        const editsManual = edits > 0 && !editsAuto;
        if (!photosManual && !editsManual) return d.pendingAuto(pc);
        const auto = photosAuto > 0 && editsAuto ? d.pendingAuto(pc)
            : photosAuto > 0 ? d.pendingPhotosAuto(pc)
            : editsAuto ? d.pendingEditsAuto(pc) : '';
        return [
            auto,
            editsManual ? d.pendingEditsManual(pc, strings.sync.sendButton) : '',
            photosManual ? d.pendingPhotosManual(strings.batch.menu) : '',
        ].filter(Boolean).join(' ');
    },

    deviceWaitingClick(e: Event): void {
        const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-act]');
        if (!btn || btn.disabled) return;
        const act = btn.dataset.act;
        if (act === 'close') this.closeDeviceWaiting();
        else if (act === 'save') void saveDevicePhotos();
        else if (act === 'discard') void this.askDiscardDeviceWaiting();
    },

    /**
     * "Discard…" (7.5): asks first, then the photos go (a batch of theirs still
     * going stops), the queue's edits go and the open research tree goes back to
     * the research's last version. Unpaired, the tree kept here goes with them.
     * How many went (0: kept).
     */
    async askDiscardDeviceWaiting(): Promise<number> {
        const waiting = await this.deviceWaitingCounts();
        const unpaired = down === 'unpaired';
        const gone = await this.askDiscardDevicePhotos({
            edits: waiting.edits,
            ...(unpaired ? { note: strings.device.discardUnpairedText } : {}),
            then: async () => {
                for (const id of await deviceQueue.ids().catch(() => [] as string[])) {
                    if (!id.startsWith('batch:')) await deviceQueue.delete(id).catch(() => undefined);
                }
                if (unpaired) await this.forgetDeviceTrees();
                else {
                    const base = this.researchChangesBase();
                    if (base && base !== 'same') DataManager.replaceWithSourceData(base.treeId, base.base);
                }
            },
        });
        if (gone === 0) {
            this.deviceWaitingHost()?.querySelector<HTMLElement>('[data-act="discard"]')?.focus();
            return 0;
        }
        this.closeDeviceWaiting();
        void this.renderDeviceQline();
        this.refreshResearchSyncUi();
        return gone;
    },

    /**
     * Unpaired (decision 3): the tree kept as last known goes — unless edits of it
     * were not sent yet; then it stays, read only, until they are saved or discarded.
     */
    async deviceForgetHeldTree(): Promise<void> {
        const treeId = DataManager.getCurrentTreeId();
        const link = treeId ? TreeManager.getTreeMetadata(treeId)?.research : undefined;
        if (treeId && link && !this.researchSyncFingerprints(treeId, link).matchesBase) return;
        await this.forgetDeviceTrees();
        void this.renderDeviceQline();
    },

    /** Unpaired and discarded: the research's trees kept on this device go (the device sees nothing of the research any more). */
    async forgetDeviceTrees(): Promise<void> {
        const ids = TreeManager.getTrees().filter(t => !!t.research?.id).map(t => t.id as TreeId);
        if (ids.length === 0) return;
        const open = DataManager.getCurrentTreeId();
        for (const id of ids) await TreeManager.deleteTree(id);
        if (!TreeManager.hasTrees()) {
            const fresh = DataManager.createNewTree(strings.treeManager.defaultTreeName);
            this.updateUrlTreeParam(fresh);
        } else if (open && ids.includes(open)) {
            const next = TreeManager.getActiveTreeId()!;
            await DataManager.switchTree(next);
            this.updateUrlTreeParam(next);
        }
        this.updateTreeSwitcher();
        TreeRenderer.render();
    },

    closeDeviceWaiting(): void {
        if (document.getElementById(DIALOG_ID)) {
            document.getElementById(DIALOG_ID)?.remove();
            this.dialogStack = this.dialogStack.filter(id => id !== DIALOG_ID);
            this.deviceWaitingClosed();
        } else if (document.querySelector(`.${SHEET_CLASS}`)) {
            this.hideBottomSheet();
        }
    },

    deviceWaitingClosed(): void {
        unwatchWaiting?.();
        unwatchWaiting = null;
        dropThumbs();
        // Back to the quiet line's link it was opened from.
        document.querySelector<HTMLElement>(`#${QLINE_ID} [data-act="pending"]`)?.focus();
    },
});
