/**
 * The first start on a device of the home network (spec 094 §2): the start
 * screen (connecting → paired → the tree; a code that paired nothing; the
 * home-screen icon not paired), the chooser of the research's trees, and the
 * quiet line of the home-screen icon with its "How" by system. Only in the
 * device mode (a page at the research's gateway); the app elsewhere never
 * draws any of it.
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { iconSvg } from '../icons.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import {
    deviceModeCandidate, takeDeviceCode, startDeviceMode, restartDeviceMode, type DeviceModeStart,
} from '../device/device-mode.js';
import { hasPairingMark, chosenTreeId, chooseTree, type DevicePairing, type DeviceTree } from '../device/device-store.js';
import { deviceFetch, type GatewayHello } from '../device/gateway-client.js';
import {
    deviceStartEnd, deviceStartScreen, deviceTreeToOpen, deviceTreeRow, homeHowSystem, homeLineDue, homeAddressHere,
    type DeviceTreeRow, type HomeHowSystem,
} from '../device/device-start.js';
import { setResearchDevicePage, deviceBridgeBase, researchDeviceState, normalizeResearchId } from '../research-link.js';

const BOOT_ID = 'device-boot';
const HOME_LINE_ID = 'device-home-line';
const HOME_DIALOG_ID = 'device-home-modal';
/** The quiet line of the home-screen icon hidden for good (×, or this origin paired by an icon's code). */
const HOME_LINE_KEY = 'strom-device-home-line';
/** How long a tree's row waits for its status in the chooser. */
const ROW_STATUS_MS = 4000;
/** How long "Paired with …" stays before the tree opens (it is read, not waited for). */
const PAIRED_SHOWN_MS = 700;

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

function homeLineHidden(): boolean {
    try { return localStorage.getItem(HOME_LINE_KEY) === 'hidden'; } catch { return false; }
}

function hideHomeLineForGood(): void {
    try { localStorage.setItem(HOME_LINE_KEY, 'hidden'); } catch { /* shown again next time */ }
}

function computerOf(said: GatewayHello | null, pairing: DevicePairing | null): string {
    return pairing?.computer.label || pairing?.computer.name || said?.label || said?.name || '';
}

function thisSystem(): HomeHowSystem {
    try {
        const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } };
        return homeHowSystem({
            userAgent: nav.userAgent || '',
            brands: nav.userAgentData?.brands?.map(b => b.brand),
            platform: nav.userAgentData?.platform,
            maxTouchPoints: nav.maxTouchPoints ?? 0,
        });
    } catch {
        return 'computer';
    }
}

const wordmark = (): string => '<span class="device-boot-logo" aria-hidden="true">Strom<i></i></span>';

export const deviceStartMethods = uiModule({
    /**
     * The device mode's start (main.ts, only when the page may be a device's):
     * the pairing by the address's code with the start screen, the tree chosen
     * and followed through the gateway, then the home-screen icon's line.
     */
    async startDeviceApp(appVersion: string): Promise<void> {
        if (!deviceModeCandidate()) return;
        // Until it is confirmed or turned down: never the research's own computer (no terminal, no install).
        setResearchDevicePage(true);
        const code = takeDeviceCode();
        const standalone = runsStandalone();
        const screen = deviceStartScreen({ code, paired: hasPairingMark(), standalone });
        if (screen) this.showDeviceBoot();
        const opts = {
            appVersion,
            computerWord: strings.device.computerWord,
            onHello: (said: GatewayHello | null) => {
                if (!screen) return;
                const pc = said?.label || said?.name || '';
                this.renderDeviceBoot('connecting', { pc, host: location.hostname, home: code?.kind === 'home' });
            },
        };
        const run = async (again: boolean): Promise<void> => {
            let started: DeviceModeStart | null = null;
            try {
                started = await (again ? restartDeviceMode(opts) : startDeviceMode(opts));
            } catch (err) {
                console.warn('Device mode did not start', err);
            }
            const end = deviceStartEnd({ hello: !!started?.hello, code, paired: !!started?.pairing, standalone });
            if (end !== 'tree' || !started?.pairing) {
                setResearchDevicePage(false);
                this.refreshResearchMenu();
                if (end === 'codeBad' || end === 'homeUnpaired') {
                    this.renderDeviceBoot(end, { pc: computerOf(started?.hello ?? null, null), host: location.hostname });
                    const retry = document.querySelector<HTMLButtonElement>(`#${BOOT_ID} [data-act="retry"]`);
                    retry?.addEventListener('click', () => {
                        this.renderDeviceBoot('connecting', { pc: '', host: location.hostname, home: code?.kind === 'home' });
                        void run(true);
                    }, { once: true });
                    retry?.focus();
                } else {
                    this.closeDeviceBoot();
                }
                return;
            }
            const pairing = started.pairing;
            const pc = computerOf(started.hello, pairing);
            // The research's places drawn again: the bridge through the gateway now.
            this.refreshResearchMenu();
            if (started.paired && code?.kind === 'home') hideHomeLineForGood();
            if (screen && started.paired) {
                this.renderDeviceBoot('paired', { pc, host: location.hostname });
                await new Promise(r => setTimeout(r, PAIRED_SHOWN_MS));
            }
            let treeId = deviceTreeToOpen(pairing.trees, chosenTreeId(pairing));
            if (!treeId) {
                treeId = await this.chooseDeviceTree(pairing.trees, pc);
                await chooseTree(treeId);
                // The event stream is of a tree: asked for now that one is chosen.
                started.connection?.retryNow();
            } else if (pairing.trees.length > 1 && !pairing.treeId) {
                await chooseTree(treeId);
            }
            await this.openDeviceTree(treeId, !!screen || !TreeManager.findTreeByResearchId(treeId));
        };
        await run(false);
    },

    /** The research's tree through the gateway, as the app follows a research's tree (its bridge's base on this origin). */
    async openDeviceTree(treeId: string, first: boolean): Promise<void> {
        // A research's tree has the research's id (strom.json's); anything else is no tree the app can follow.
        if (!normalizeResearchId(treeId)) {
            this.closeDeviceBoot();
            return;
        }
        const base = deviceBridgeBase(treeId, researchDeviceState()?.origin ?? location.origin);
        const boot = document.getElementById(BOOT_ID);
        if (boot && !boot.classList.contains('is-opening')) this.renderDeviceBoot('opening', { pc: '', host: location.hostname });
        const settle = (): void => this.closeDeviceBoot();
        try {
            await this.startLiveFollow(base, first
                ? { progress: { step: () => undefined, settle, hint: () => undefined } }
                : { resume: true });
        } finally {
            this.closeDeviceBoot();
        }
        const held = TreeManager.findTreeByResearchId(treeId);
        if (first && held && DataManager.getCurrentTreeId() === held.id) this.setDisplayViewMode('family');
        this.showDeviceHomeLine();
        this.refreshResearchMenu();
    },

    /** The start screen over the app (the toolbar and the tree under it, never seen until the tree is in). */
    showDeviceBoot(): void {
        if (document.getElementById(BOOT_ID)) return;
        const el = document.createElement('div');
        el.id = BOOT_ID;
        el.className = 'device-boot';
        document.body.appendChild(el);
        this.renderDeviceBoot('connecting', { pc: '', host: location.hostname });
    },

    closeDeviceBoot(): void {
        document.getElementById(BOOT_ID)?.remove();
    },

    /** One state of the start screen (2.1, 2.2, 2.3, 2.8a, 2.8b). */
    renderDeviceBoot(state: 'connecting' | 'paired' | 'opening' | 'codeBad' | 'homeUnpaired', o: { pc: string; host: string; home?: boolean }): void {
        const el = document.getElementById(BOOT_ID);
        if (!el) return;
        const d = strings.device;
        const pcB = (text: string): string => o.pc ? esc(text).replace(esc(o.pc), `<b>${esc(o.pc)}</b>`) : esc(text);
        el.classList.remove('is-trees');
        el.classList.toggle('is-opening', state === 'opening');
        el.setAttribute('role', state === 'codeBad' || state === 'homeUnpaired' ? 'alert' : 'status');
        el.setAttribute('aria-live', 'polite');
        el.dataset.state = state;
        let body = '';
        if (state === 'connecting') {
            const line = o.home && o.pc ? d.homePairing(o.pc) : o.pc ? d.connecting(o.pc) : d.connectingAny;
            body = `<span class="device-boot-row"><i class="busy-spin s16" aria-hidden="true"></i><span class="device-boot-msg">${pcB(line)}</span></span>`
                + (o.home ? '' : `<span class="device-boot-ins">${esc(d.bootWhere(o.host))}</span>`);
        } else if (state === 'paired' || state === 'opening') {
            const head = state === 'paired'
                ? `<span class="device-boot-ok" aria-hidden="true">${iconSvg('check', { size: 22, strokeWidth: 2.5 })}</span><span class="device-boot-msg">${pcB(d.paired(o.pc))}</span>`
                : `<span class="device-boot-row"><i class="busy-spin s16" aria-hidden="true"></i><span class="device-boot-msg">${esc(d.opening)}</span></span>`;
            body = head + (state === 'paired' ? `<span class="device-boot-ins">${esc(d.opening)}</span>` : '');
        } else {
            const bad = state === 'codeBad';
            body = `<span class="device-boot-msg"><b>${esc(bad ? d.codeBad : d.homeUnpaired)}</b></span>`
                + `<span class="device-boot-msg device-boot-how">${esc(bad ? d.codeBadHow : d.homeUnpairedHow)}</span>`
                + (bad ? `<span class="device-boot-ins">${esc(d.codeBadNote)}</span>` : '')
                + `<button type="button" class="secondary device-boot-retry" data-act="retry">${esc(d.retry)}</button>`;
        }
        el.innerHTML = `<div class="device-boot-inner">${wordmark()}${body}</div>`;
    },

    /** The chooser of the research's trees (2.4, 2.9): resolves with the chosen tree's id. */
    chooseDeviceTree(trees: readonly DeviceTree[], pc: string): Promise<string> {
        let el = document.getElementById(BOOT_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = BOOT_ID;
            el.className = 'device-boot';
            document.body.appendChild(el);
        }
        const d = strings.device;
        el.classList.add('is-trees');
        el.classList.remove('is-opening');
        el.removeAttribute('aria-live');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-labelledby', 'device-trees-title');
        el.dataset.state = 'trees';
        const rows = trees.map(t => `
            <button type="button" class="device-tree-row" data-tree="${esc(t.id)}">
                <span class="device-tree-text">
                    <span class="device-tree-name">${esc(t.name)}</span>
                    <span class="device-tree-sub" data-sub="${esc(t.id)}">${t.archive ? `<span class="research-sync-tag">${esc(strings.sync.archiveTag)}</span>` : ''}</span>
                </span>
                <span class="device-tree-chev" aria-hidden="true">${iconSvg('chevron-down', { size: 16 })}</span>
            </button>`).join('');
        el.innerHTML = `
            <div class="device-trees">
                <div class="device-trees-head">
                    <h1 class="device-trees-title" id="device-trees-title">${esc(d.treesTitle)}</h1>
                    ${pc ? `<span class="device-trees-pc"><span class="phone-dot is-on" aria-hidden="true"></span><span class="device-trees-pc-text">${esc(d.onComputer(pc))}</span></span>` : ''}
                </div>
                <div class="device-trees-list">${rows}</div>
                <p class="device-trees-note">${esc(d.treesNote)}</p>
            </div>`;
        for (const t of trees) void this.fillDeviceTreeRow(t);
        el.querySelector<HTMLButtonElement>('.device-tree-row')?.focus();
        return new Promise(resolve => {
            el!.addEventListener('click', (e) => {
                const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.device-tree-row');
                const id = row?.dataset.tree;
                if (!id) return;
                this.renderDeviceBoot('opening', { pc: '', host: location.hostname });
                resolve(id);
            });
        });
    },

    /** A tree's row: its persons and what its research does now (working / waiting), from its status. */
    async fillDeviceTreeRow(tree: DeviceTree): Promise<void> {
        let row: DeviceTreeRow | null = null;
        try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), ROW_STATUS_MS);
            try {
                const r = await deviceFetch('status', { tree: tree.id, signal: ctl.signal });
                if (r.ok) row = deviceTreeRow(await r.json());
            } finally {
                clearTimeout(timer);
            }
        } catch { /* the row keeps its name alone */ }
        if (!row) return;
        const sub = document.querySelector<HTMLElement>(`#${BOOT_ID} [data-sub="${CSS.escape(tree.id)}"]`);
        if (!sub) return;
        const d = strings.device;
        const parts: string[] = [];
        if (row.persons !== null) parts.push(`<span>${esc(d.persons(row.persons))}</span>`);
        if (row.working) parts.push(`<span class="device-tree-state"><span class="phone-dot is-on" aria-hidden="true"></span>${esc(d.treeWorking)}</span>`);
        else if (row.waiting > 0) parts.push(`<span class="device-tree-state"><span class="research-count-badge">${row.waiting}</span>${esc(d.treeWaiting)}</span>`);
        if (tree.archive) parts.push(`<span class="research-sync-tag">${esc(strings.sync.archiveTag)}</span>`);
        sub.innerHTML = parts.join('<span class="device-tree-sep" aria-hidden="true">·</span>');
    },

    /** The quiet line of the home-screen icon under the toolbar (2.5): once, never in the icon, × hides it for good. */
    showDeviceHomeLine(): void {
        if (document.getElementById(HOME_LINE_ID)) return;
        if (!homeLineDue({ hidden: homeLineHidden(), standalone: runsStandalone() })) return;
        const d = strings.device;
        const el = document.createElement('div');
        el.id = HOME_LINE_ID;
        el.className = 'device-home-line';
        el.setAttribute('role', 'note');
        el.innerHTML = `<span class="device-home-line-text">${esc(d.homeLine)}</span>`
            + `<button type="button" class="device-home-line-how" data-act="how">${esc(d.homeHow)}</button>`
            + `<button type="button" class="device-home-line-x" data-act="hide" aria-label="${esc(d.homeHide)}">&times;</button>`;
        el.addEventListener('click', (e) => {
            const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]')?.dataset.act;
            if (act === 'how') void this.showDeviceHomeHow();
            else if (act === 'hide') {
                hideHomeLineForGood();
                this.closeDeviceHomeLine();
            }
        });
        document.body.appendChild(el);
        document.body.classList.add('device-home-line-on');
    },

    closeDeviceHomeLine(): void {
        document.getElementById(HOME_LINE_ID)?.remove();
        document.body.classList.remove('device-home-line-on');
    },

    /**
     * "How" of the home-screen icon (2.6, 2.7): by this device's system first.
     * When the gateway gives the icon its own code (`device/home`), the address
     * carries it, so the icon added from it pairs itself (2.8a).
     */
    async showDeviceHomeHow(): Promise<void> {
        if (document.getElementById(HOME_DIALOG_ID)) return;
        const d = strings.device;
        const state = researchDeviceState();
        const pc = state?.computer ?? '';
        const sys = thisSystem();
        const section = (key: HomeHowSystem): string => {
            const head = key === 'ios' ? d.homeIosHead : key === 'android' ? d.homeAndroidHead : d.homeComputerHead;
            const text = key === 'ios' ? d.homeIos : key === 'android' ? d.homeAndroid : d.homeComputer;
            return `<section class="device-home-sys" data-sys="${key}"><h3>${esc(head)}</h3><p>${esc(text)}</p></section>`;
        };
        const order: HomeHowSystem[] = [sys, ...(['ios', 'android', 'computer'] as HomeHowSystem[]).filter(k => k !== sys)];
        const overlay = document.createElement('div');
        overlay.id = HOME_DIALOG_ID;
        overlay.className = 'modal-overlay active';
        overlay.innerHTML = `
            <div class="modal device-home-dialog" role="dialog" aria-modal="true" aria-labelledby="device-home-title">
                <div class="modal-header">
                    <h2 id="device-home-title">${esc(d.homeTitle)}</h2>
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="modal-content device-home-content">
                    ${order.map(section).join('')}
                    ${pc ? `<p class="device-home-note">${esc(d.homeNote(pc))}</p>` : ''}
                </div>
                <div class="buttons"><button type="button" class="primary" data-act="close">${esc(d.homeDone)}</button></div>
            </div>`;
        overlay.addEventListener('click', (e) => {
            const t = e.target as HTMLElement | null;
            if (t === overlay || t?.closest('[data-act="close"]')) this.closeDeviceHomeHow();
        });
        document.body.appendChild(overlay);
        this.pushDialog(HOME_DIALOG_ID);
        overlay.querySelector<HTMLElement>('.buttons [data-act="close"]')?.focus();
        if (state?.actions.includes('device.home')) await this.askDeviceHomeAddress();
    },

    closeDeviceHomeHow(): void {
        document.getElementById(HOME_DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(id => id !== HOME_DIALOG_ID);
    },

    /** The icon's own code from the gateway, put into the address the icon is added from (this origin only). */
    async askDeviceHomeAddress(): Promise<void> {
        try {
            const r = await deviceFetch('device/home', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (!r.ok) return;
            const json = await r.json() as { url?: unknown };
            const here = homeAddressHere(json.url, location.origin);
            if (here) history.replaceState(history.state, '', here);
        } catch { /* the steps alone: the icon then opens unpaired (2.8b) or shares this browser's pairing */ }
    },
});
