/**
 * The device mode (spec 094 §3): the app on a device of the home network,
 * paired with the computer's research. The tree switcher carries a second
 * line with the connection (a dot and "on computer {pc}" / "connecting…" /
 * "not reachable" / "not paired"), and what belongs to the computer (new tree,
 * import, managing and deleting trees, a linked file, browser backups, the
 * export reminder) is not offered here: one quiet sentence says where it is.
 * Outside the device mode none of this is drawn and the app is as before.
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { deviceConnection, onDeviceConnection, type DeviceConnection } from '../device/device-connection.js';
import { researchDeviceState } from '../research-link.js';

const CONN_ID = 'current-tree-conn';

/** The computer's name last known (kept once unpaired, when the device's state is gone). */
let lastComputer = '';
let unwatch: (() => void) | null = null;

/** The app runs as a device of the research's gateway (paired, or unpaired since). */
export function inDeviceMode(): boolean {
    return researchDeviceState() !== null || deviceConnection() !== null;
}

/** The computer's name for the device's texts ('' when never known). */
export function deviceComputerName(): string {
    const pc = researchDeviceState()?.computer;
    if (pc) lastComputer = pc;
    return lastComputer;
}

export type DeviceSwitcherDot = 'is-on' | 'is-wait' | 'is-error';

/** The switcher's second line for a connection's state (3.1–3.3). */
export function deviceSwitcherLine(conn: Pick<DeviceConnection, 'state'> | null, pc: string): { dot: DeviceSwitcherDot; text: string } {
    const d = strings.device;
    switch (conn?.state) {
        case undefined:
        case 'connected':
            return { dot: 'is-on', text: d.onComputer(pc) };
        case 'connecting':
            return { dot: 'is-wait', text: d.connectingShort(pc) };
        case 'unpaired':
            return { dot: 'is-error', text: d.unpairedShort(pc) };
        default:
            return { dot: 'is-error', text: d.downShort(pc) };
    }
}

/** The quiet sentence where the trees' own actions would be (the Trees sheet, the switcher's list). */
export function deviceTreesNotHere(): string {
    return strings.device.treesNotHere(deviceComputerName() || undefined);
}

/** The quiet paragraph of the Connection sheet: what is only on the computer with the research. */
export function deviceNotHere(): string {
    return strings.device.notHere;
}

export const deviceModeMethods = uiModule({
    /** The connection followed: each change redraws the switcher's second line (called once the device is paired). */
    watchDeviceConnection(): void {
        unwatch?.();
        unwatch = onDeviceConnection(() => this.refreshDeviceModeUi());
        this.refreshDeviceModeUi();
    },

    /** The device mode's marks on the page: the body's class and the switcher's second line. */
    refreshDeviceModeUi(): void {
        const on = inDeviceMode();
        document.body.classList.toggle('device-mode', on);
        const el = document.getElementById(CONN_ID);
        if (!el) return;
        if (!on) {
            el.hidden = true;
            el.textContent = '';
            return;
        }
        const line = deviceSwitcherLine(deviceConnection(), deviceComputerName());
        el.hidden = false;
        el.dataset.state = line.dot;
        el.replaceChildren();
        const dot = document.createElement('span');
        dot.className = `phone-dot ${line.dot}`;
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'tree-switcher-conn-text';
        text.textContent = line.text;
        el.append(dot, text);
        el.title = line.text;
    },
});
