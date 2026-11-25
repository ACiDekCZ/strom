/**
 * The Connection of a device of the home network (spec 094 P3 §3, 3.5, 3.6,
 * 3.11, 3.12): the computer with the research (its name, the state, since
 * when, the last sync), this device (its name, Rename), the home-screen icon,
 * what is not here, and disconnecting this device. A sheet from below on a
 * phone; elsewhere a dialog, opened from the top block of the tree switcher's
 * dropdown. Outside the device mode nothing of it is drawn.
 *
 * Every action goes through the gateway's tunnel (the bridge, no mark) and is
 * offered only when the gateway announces it (`status.device.actions`).
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { isPhoneToolbar } from './search.js';
import { showToast } from './toast.js';
import { researchDeviceState } from '../research-link.js';
import { pairingNow, queueCounts } from '../device/device-store.js';
import {
    deviceConnection, onDeviceConnection, renameThisDevice, unpairThisDevice, type DeviceConnection,
} from '../device/device-connection.js';
import { onGatewayOutcome } from '../device/gateway-client.js';
import { formatLiveClock } from '../live-time.js';

const DIALOG_ID = 'device-conn-modal';
const SHEET_CLASS = 'device-conn-sheet';
const TOP_ID = 'tree-switcher-conn-top';
/** The name the gateway keeps (`device/rename`: at most 60 characters). */
const NAME_MAX = 60;

function esc(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** This page runs as a home-screen icon (iOS: navigator.standalone; elsewhere display-mode). */
function runsStandalone(): boolean {
    try {
        if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
        return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
    } catch {
        return false;
    }
}

/** The last answer of the gateway (the tree, the research's state, …): "last synced". */
let lastSyncAt: number | null = null;
onGatewayOutcome((o) => { if (o.ok) lastSyncAt = Date.now(); });

/**
 * Saving the photos that wait on this device (given by the photos' part; until
 * then the disconnect confirmation offers no saving).
 */
let photoSaver: (() => Promise<void>) | null = null;
export function setDevicePhotoSaver(save: (() => Promise<void>) | null): void {
    photoSaver = save;
}

/** The dot and the words of the connection's state (`top`: the switcher's top block). */
export function deviceConnLine(c: DeviceConnection | null, pc: string, top: boolean): { dot: string; text: string } {
    const d = strings.device;
    const state = c?.state ?? 'connecting';
    if (state === 'connected') return { dot: 'is-on', text: top ? d.connTop(pc) : d.connState };
    if (state === 'connecting') return { dot: 'is-wait', text: d.connectingShort(pc) };
    if (state === 'unpaired') return { dot: 'is-error', text: d.unpairedShort(pc) };
    return { dot: 'is-error', text: d.downShort(pc) };
}

let hooked = false;
let unwatch: (() => void) | null = null;

export const deviceConnMethods = uiModule({
    /** In the device mode (paired, through the gateway). */
    deviceConnOn(): boolean {
        return researchDeviceState() !== null;
    },

    /**
     * The top block of the tree switcher's dropdown in the device mode (3.11):
     * the connection's state and "Connection…"; empty elsewhere.
     */
    deviceConnTopHtml(): string {
        if (!this.deviceConnOn()) return '';
        this.hookDeviceConn();
        const pc = researchDeviceState()?.computer ?? '';
        const line = deviceConnLine(deviceConnection(), pc, true);
        return `<div id="${TOP_ID}" class="tree-switcher-conn-top" role="menuitem" tabindex="0" data-device-conn>`
            + `<span class="phone-dot ${line.dot}" aria-hidden="true"></span>`
            + `<span class="tree-switcher-conn-top-t">${esc(line.text)}</span>`
            + `<span class="tree-switcher-conn-top-a">${esc(strings.device.connOpen)}</span>`
            + '</div><div class="tree-switcher-divider"></div>';
    },

    /** Once: a tap on the top block opens the Connection; on a phone the switcher's second line opens it too
     *  (elsewhere that line belongs to the switcher's button, whose dropdown carries the top block). */
    hookDeviceConn(): void {
        if (hooked) return;
        hooked = true;
        const open = (e: Event): void => {
            const el = (e.target as Element | null)?.closest?.('[data-device-conn], #current-tree-conn');
            if (!el || !this.deviceConnOn()) return;
            if (el.id === 'current-tree-conn' && !isPhoneToolbar()) return;
            if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            document.getElementById('tree-switcher-dropdown')?.classList.remove('active');
            this.showDeviceConnection();
        };
        document.addEventListener('click', open, true);
        document.addEventListener('keydown', open, true);
        onDeviceConnection(() => this.refreshDeviceConn());
    },

    /** The state drawn again where it shows (the top block, the open Connection). */
    refreshDeviceConn(): void {
        const top = document.getElementById(TOP_ID);
        if (top) {
            const line = deviceConnLine(deviceConnection(), researchDeviceState()?.computer ?? '', true);
            top.querySelector('.phone-dot')?.setAttribute('class', `phone-dot ${line.dot}`);
            const t = top.querySelector('.tree-switcher-conn-top-t');
            if (t) t.textContent = line.text;
        }
        const pcEl = this.deviceConnHost()?.querySelector<HTMLElement>('.device-conn-pc');
        if (pcEl) pcEl.outerHTML = this.deviceConnPcHtml();
    },

    /** The open Connection's body (the dialog's or the sheet's), or null. */
    deviceConnHost(): HTMLElement | null {
        return document.querySelector<HTMLElement>(`#${DIALOG_ID} .device-conn, .${SHEET_CLASS} .device-conn`);
    },

    deviceConnPcHtml(): string {
        const d = strings.device;
        const pc = researchDeviceState()?.computer ?? '';
        const c = deviceConnection();
        const line = deviceConnLine(c, pc, false);
        const lang = getCurrentLanguage();
        const now = Date.now();
        let sub = '';
        if (c?.state === 'connected') {
            const since = formatLiveClock(c.since, now, lang);
            sub = lastSyncAt !== null ? d.connSince(since, formatLiveClock(lastSyncAt, now, lang)) : d.connSinceOnly(since);
        }
        return '<section class="device-conn-row device-conn-pc">'
            + '<div class="device-conn-text">'
            + `<span class="device-conn-label">${esc(d.connComputer)}</span>`
            + `<span class="device-conn-name" title="${esc(pc)}">${esc(pc)}</span>`
            + `<span class="device-conn-state"><span class="phone-dot ${line.dot}" aria-hidden="true"></span><span class="device-conn-ell">${esc(line.text)}</span></span>`
            + (sub ? `<span class="device-conn-sub">${esc(sub)}</span>` : '')
            + '</div></section>';
    },

    deviceConnMeHtml(): string {
        const d = strings.device;
        const name = pairingNow()?.name ?? '';
        const canRename = researchDeviceState()?.actions.includes('device.rename') ?? false;
        return '<section class="device-conn-row device-conn-me">'
            + '<div class="device-conn-text">'
            + `<span class="device-conn-label">${esc(d.thisDevice)}</span>`
            + `<span class="device-conn-name" title="${esc(name)}">${esc(name)}</span>`
            // "{n} more devices connected" waits for a gateway that tells the count.
            + '</div>'
            + (canRename ? `<button type="button" class="secondary device-conn-btn" data-act="rename">${esc(d.rename)}</button>` : '')
            + '</section>';
    },

    /** The Connection's own view (3.5 / 3.12). */
    deviceConnMainHtml(sheet: boolean): string {
        const d = strings.device;
        const canUnpair = researchDeviceState()?.actions.includes('device.unpair') ?? false;
        const home = sheet && !runsStandalone()
            ? `<button type="button" class="device-conn-home" data-act="home"><span>${esc(d.homeTitle)}</span><span class="device-conn-chev" aria-hidden="true">›</span></button>`
            : '';
        return this.deviceConnPcHtml()
            + this.deviceConnMeHtml()
            + home
            + `<p class="device-conn-quiet">${esc(d.notHere)}</p>`
            + '<p class="device-conn-err" role="alert" hidden></p>'
            + (sheet && canUnpair ? `<button type="button" class="secondary device-conn-off" data-act="disconnect">${esc(d.disconnect)}</button>` : '');
    },

    /** The Connection: a sheet from below on a phone, a dialog elsewhere. */
    showDeviceConnection(): void {
        if (!this.deviceConnOn() || this.deviceConnHost()) return;
        this.hookDeviceConn();
        const d = strings.device;
        let host: HTMLElement;
        if (isPhoneToolbar()) {
            const body = this.presentPortraitSheet(esc(d.connTitle), { label: d.connTitle, onClose: () => this.deviceConnClosed() });
            body.parentElement?.classList.add(SHEET_CLASS);
            body.className = 'device-conn device-conn--sheet';
            host = body;
        } else {
            const overlay = document.createElement('div');
            overlay.id = DIALOG_ID;
            overlay.className = 'modal-overlay active';
            overlay.innerHTML = `
                <div class="modal modal--md device-conn-dialog" role="dialog" aria-modal="true" aria-labelledby="device-conn-title">
                    <div class="modal-header">
                        <h2 id="device-conn-title">${esc(d.connTitle)}</h2>
                        <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                    </div>
                    <div class="modal-content device-conn"></div>
                    <div class="buttons device-conn-buttons"></div>
                </div>`;
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeDeviceConnection();
            });
            document.body.appendChild(overlay);
            this.pushDialog(DIALOG_ID);
            host = overlay.querySelector<HTMLElement>('.device-conn')!;
        }
        host.addEventListener('click', (e) => this.deviceConnClick(e));
        host.closest('.modal')?.querySelector('.modal-header')?.addEventListener('click', (e) => this.deviceConnClick(e));
        host.closest('.modal')?.querySelector('.buttons')?.addEventListener('click', (e) => this.deviceConnClick(e));
        this.renderDeviceConnMain();
        unwatch?.();
        unwatch = onDeviceConnection(() => this.refreshDeviceConn());
    },

    renderDeviceConnMain(): void {
        const host = this.deviceConnHost();
        if (!host) return;
        const d = strings.device;
        const sheet = host.classList.contains('device-conn--sheet');
        this.deviceConnTitle(d.connTitle);
        host.innerHTML = this.deviceConnMainHtml(sheet);
        const buttons = host.closest('.modal')?.querySelector<HTMLElement>('.device-conn-buttons');
        if (buttons) {
            const canUnpair = researchDeviceState()?.actions.includes('device.unpair') ?? false;
            buttons.innerHTML = (canUnpair ? `<button type="button" class="secondary device-conn-off" data-act="disconnect">${esc(d.disconnect)}</button>` : '')
                + `<button type="button" class="secondary" data-act="close">${esc(d.connDone)}</button>`;
            buttons.querySelector<HTMLElement>('[data-act="close"]')?.focus();
        }
    },

    deviceConnTitle(text: string): void {
        const host = this.deviceConnHost();
        const title = host?.closest('.modal')?.querySelector('#device-conn-title') ?? host?.parentElement?.querySelector('.bottom-sheet-menu-title');
        if (title) title.textContent = text;
    },

    deviceConnClick(e: Event): void {
        const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
        if (!btn || (btn as HTMLButtonElement).disabled) return;
        const act = btn.dataset.act;
        if (act === 'close') this.closeDeviceConnection();
        else if (act === 'rename') this.startDeviceRename();
        else if (act === 'rename-save') void this.saveDeviceRename();
        else if (act === 'rename-cancel') this.renderDeviceConnMain();
        else if (act === 'home') {
            this.closeDeviceConnection();
            void this.showDeviceHomeHow();
        } else if (act === 'disconnect') void this.showDeviceDisconnect();
        else if (act === 'disconnect-cancel') this.renderDeviceConnMain();
        else if (act === 'disconnect-ok') void this.disconnectThisDevice();
        else if (act === 'save-photos') void photoSaver?.();
        else if (act === 'discard-photos') void this.discardDevicePhotosHere();
    },

    /** Rename: the name in a field in place, Save / Cancel. */
    startDeviceRename(): void {
        const row = this.deviceConnHost()?.querySelector<HTMLElement>('.device-conn-me');
        if (!row) return;
        const d = strings.device;
        const name = pairingNow()?.name ?? '';
        row.classList.add('is-editing');
        row.innerHTML = '<div class="device-conn-text">'
            + `<label class="device-conn-label" for="device-conn-name">${esc(d.thisDevice)}</label>`
            + `<input id="device-conn-name" class="device-conn-input" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" aria-label="${esc(d.renameAria)}" value="${esc(name)}">`
            + '<span class="device-conn-edit-buttons">'
            + `<button type="button" class="secondary device-conn-btn" data-act="rename-cancel">${esc(strings.buttons.cancel)}</button>`
            + `<button type="button" class="primary device-conn-btn" data-act="rename-save">${esc(strings.buttons.save)}</button>`
            + '</span></div>';
        const input = row.querySelector<HTMLInputElement>('input')!;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.saveDeviceRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.renderDeviceConnMain();
            }
        });
        input.focus();
        input.select();
    },

    async saveDeviceRename(): Promise<void> {
        const host = this.deviceConnHost();
        const input = host?.querySelector<HTMLInputElement>('#device-conn-name');
        if (!host || !input) return;
        const name = input.value.trim().normalize('NFC').slice(0, NAME_MAX);
        if (!name) {
            input.focus();
            return;
        }
        if (name === pairingNow()?.name) {
            this.renderDeviceConnMain();
            return;
        }
        host.querySelectorAll<HTMLButtonElement>('.device-conn-me button').forEach(b => { b.disabled = true; });
        input.disabled = true;
        try {
            await renameThisDevice(name);
            if (this.deviceConnHost() === host) this.renderDeviceConnMain();
        } catch {
            if (this.deviceConnHost() !== host) return;
            host.querySelectorAll<HTMLButtonElement>('.device-conn-me button').forEach(b => { b.disabled = false; });
            input.disabled = false;
            input.focus();
            this.deviceConnError(strings.device.renameFailed);
        }
    },

    deviceConnError(text: string): void {
        const el = this.deviceConnHost()?.querySelector<HTMLElement>('.device-conn-err');
        if (!el) return;
        el.textContent = text;
        el.hidden = !text;
    },

    /** "Disconnect this device?" (3.6): what waits on the device stays there; then `device/unpair`. */
    async showDeviceDisconnect(): Promise<void> {
        const host = this.deviceConnHost();
        if (!host) return;
        const d = strings.device;
        const pc = researchDeviceState()?.computer ?? '';
        const waiting = await queueCounts();
        if (this.deviceConnHost() !== host) return;
        const pending = waiting.photos + waiting.edits > 0
            ? `<p class="device-conn-quiet">${esc(`${d.pending(waiting.photos, waiting.edits)}. ${d.pendingStay}`)}</p>`
            : '';
        // Save photos to the device (when the photos' part gives a saver) · Discard… (confirmed; the edits stay)
        const save = waiting.photos > 0
            ? '<div class="device-conn-keep">'
                + (photoSaver ? `<button type="button" class="device-conn-link" data-act="save-photos">${esc(d.savePhotos)}</button>` : '')
                + `<button type="button" class="device-conn-link device-conn-discard" data-act="discard-photos">${esc(strings.batch.discardDevice)}</button>`
                + '</div>'
            : '';
        this.deviceConnTitle(d.disconnectAsk);
        const cancel = `<button type="button" class="secondary" data-act="disconnect-cancel">${esc(strings.buttons.cancel)}</button>`;
        const ok = `<button type="button" class="danger device-conn-ok" data-act="disconnect-ok">${esc(d.disconnectOk)}</button>`;
        const sheet = host.classList.contains('device-conn--sheet');
        host.innerHTML = `<p class="device-conn-ask">${esc(d.disconnectText(pc))}</p>`
            + pending + save
            + '<p class="device-conn-err" role="alert" hidden></p>'
            + (sheet ? `<div class="device-conn-pair">${cancel}${ok}</div>` : '');
        const buttons = host.closest('.modal')?.querySelector<HTMLElement>('.device-conn-buttons');
        if (buttons) buttons.innerHTML = cancel + ok;
        (buttons ?? host).querySelector<HTMLElement>('[data-act="disconnect-cancel"]')?.focus();
    },

    /** Discard… in the disconnect confirmation: once confirmed, the confirmation counts again. */
    async discardDevicePhotosHere(): Promise<void> {
        const host = this.deviceConnHost();
        if (!host) return;
        const gone = await this.askDiscardDevicePhotos();
        if (gone > 0 && this.deviceConnHost() === host) await this.showDeviceDisconnect();
        else host.querySelector<HTMLElement>('[data-act="discard-photos"]')?.focus();
    },

    async disconnectThisDevice(): Promise<void> {
        const host = this.deviceConnHost();
        if (!host) return;
        const scope = host.closest('.modal') ?? host;
        scope.querySelectorAll<HTMLButtonElement>('[data-act^="disconnect"]').forEach(b => { b.disabled = true; });
        const pc = researchDeviceState()?.computer ?? '';
        try {
            await unpairThisDevice();
        } catch {
            if (this.deviceConnHost() !== host) return;
            scope.querySelectorAll<HTMLButtonElement>('[data-act^="disconnect"]').forEach(b => { b.disabled = false; });
            this.deviceConnError(strings.device.disconnectFailed);
            return;
        }
        this.closeDeviceConnection();
        this.updateTreeSwitcher();
        showToast(`${strings.device.unpaired(pc)} ${strings.device.repair}`, Infinity, { closable: true, kind: 'device-unpaired' });
    },

    closeDeviceConnection(): void {
        if (document.getElementById(DIALOG_ID)) {
            document.getElementById(DIALOG_ID)?.remove();
            this.dialogStack = this.dialogStack.filter(id => id !== DIALOG_ID);
            this.deviceConnClosed();
        } else if (document.querySelector(`.${SHEET_CLASS}`)) {
            this.hideBottomSheet();
        }
    },

    deviceConnClosed(): void {
        unwatch?.();
        unwatch = null;
    },
});
