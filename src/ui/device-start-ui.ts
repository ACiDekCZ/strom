/**
 * The first start on a device of the home network (spec 094 §2): the start
 * screen (connecting → paired → the tree; a code that paired nothing; the
 * home-screen icon not paired), the chooser of the research's trees, and the
 * quiet line of the home-screen icon with its "How" by system. Only in the
 * device mode (a page at the research's gateway); the app elsewhere never
 * draws any of it.
 */

import { strings, getStringsForLang, SUPPORTED_LANGUAGES } from '../strings.js';
import { uiModule } from './module.js';
import { iconSvg } from '../icons.js';
import { TreeManager } from '../tree-manager.js';
import { DataManager } from '../data.js';
import {
    deviceModeCandidate, takeDeviceCode, startDeviceMode, restartDeviceMode, type DeviceModeStart,
} from '../device/device-mode.js';
import { hasPairingMark, chosenTreeId, chooseTree, computerLabelOf, deviceTreeIdOk, pairingNow, type DevicePairing, type DeviceTree } from '../device/device-store.js';
import { retryDeviceConnection, deviceConnection } from '../device/device-connection.js';
import { phoneResearchReady, phoneResearchTreeId, type PhoneTreeOpen } from './phone-research-ui.js';
import { startTreeLoad, currentTreeLoad } from './tree-load-progress.js';
import { bridgeGivesImagesByHash } from '../research-tree-file.js';
import { imagesUrlOf } from '../research-image-refs.js';
import { deviceFetch, type GatewayHello } from '../device/gateway-client.js';
import {
    deviceStartEnd, deviceStartScreen, deviceTreeToOpen, deviceTreeRename, deviceTreeRow, deviceTreeChoices, homeHowSystem, homeLineDue, homeAddressHere,
    type DeviceTreeRow, type DeviceTreeChoice, type HomeHowSystem,
} from '../device/device-start.js';
import { setResearchDevicePage, deviceBridgeBase, researchDeviceState } from '../research-link.js';

const BOOT_ID = 'device-boot';
const HOME_LINE_ID = 'device-home-line';
const HOME_DIALOG_ID = 'device-home-modal';
/** The quiet line of the home-screen icon hidden for good (×, or this origin paired by an icon's code). */
const HOME_LINE_KEY = 'strom-device-home-line';
/** How long a tree's row waits for its status in the chooser. */
const ROW_STATUS_MS = 4000;
/** A tree's row in the switcher asks its status again only after this long (it is asked at each opening otherwise). */
const ROW_FRESH_MS = 20_000;
/** What each research tree's status said last (its persons, working, waiting): the rows drawn from it at once. */
const treeRows = new Map<string, { row: DeviceTreeRow; at: number }>();

/** The chooser of the research's trees standing now: picks a tree as a tap on its row does (null: none). */
let chooserPick: ((id: string) => void) | null = null;

/** How long "Paired with …" stays before the tree opens (it is read, not waited for). */
const PAIRED_SHOWN_MS = 700;

/**
 * How long "Opening the research…" may stand with nothing on its way to be seen (no download's progress, no
 * question over it) before it says so with Try again and Cancel: never a spinner without an end.
 */
const OPENING_LIMIT_MS = 60_000;
/** How often the start screen's "Opening…" is looked at. */
const OPENING_LOOK_MS = 1000;

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
    return computerLabelOf(pairing?.computer) || computerLabelOf(said);
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

/** A tree's second line: its persons, what its research does now, the archive's label (what is known so far). */
function treeSubHtml(row: DeviceTreeRow | null, archive: boolean): string {
    const d = strings.device;
    const parts: string[] = [];
    if (row?.persons != null) parts.push(`<span>${esc(d.persons(row.persons))}</span>`);
    if (row?.working) parts.push(`<span class="device-tree-state"><span class="phone-dot is-on" aria-hidden="true"></span>${esc(d.treeWorking)}</span>`);
    else if (row && row.waiting > 0) parts.push(`<span class="device-tree-state"><span class="research-count-badge">${row.waiting}</span>${esc(d.treeWaiting)}</span>`);
    if (archive) parts.push(`<span class="research-sync-tag">${esc(strings.sync.archiveTag)}</span>`);
    return parts.join('<span class="device-tree-sep" aria-hidden="true">·</span>');
}

/** A research tree's name and second line, as in the chooser (the switcher's list and the Trees sheet). */
export function deviceTreeTextHtml(c: Pick<DeviceTreeChoice, 'researchId' | 'name' | 'archive'>): string {
    const row = c.researchId ? treeRows.get(c.researchId)?.row ?? null : null;
    const sub = c.researchId ? ` data-device-sub="${esc(c.researchId)}"` : '';
    return `<span class="device-tree-text"><span class="device-tree-name">${esc(c.name)}</span>`
        + `<span class="device-tree-sub"${sub}${c.archive ? ' data-archive="1"' : ''}>${treeSubHtml(row, c.archive)}</span></span>`;
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
                const pc = computerLabelOf(said);
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
            // The switcher's second line follows the connection from now on (spec 094 §3).
            this.watchDeviceConnection();
            if (started.paired && code?.kind === 'home') hideHomeLineForGood();
            if (screen && started.paired) {
                this.renderDeviceBoot('paired', { pc, host: location.hostname });
                await new Promise(r => setTimeout(r, PAIRED_SHOWN_MS));
            }
            const choose = async (): Promise<string> => {
                const id = await this.chooseDeviceTree(pairing.trees, pc);
                await chooseTree(id);
                // The event stream is of a tree: asked for now that one is chosen.
                started.connection?.retryNow();
                return id;
            };
            let treeId = deviceTreeToOpen(pairing.trees, chosenTreeId(pairing));
            if (!treeId) {
                treeId = await choose();
            } else if (pairing.trees.length > 1 && !pairing.treeId) {
                await chooseTree(treeId);
            }
            // A phone (spec 094 K3.13, §8 points 6–7): the Research screen first, the tree never downloaded for it —
            // it comes when asked for (phoneOpenTree). A research that gives the screen nothing: the tree as before.
            if (deviceTreeIdOk(treeId) && await this.phoneResearchFirst(treeId)) {
                this.closeDeviceBoot();
                this.showPhoneResearch();
                this.showDeviceHomeLine();
                this.refreshResearchMenu();
                return;
            }
            // A first open cancelled (or failed, Try again not taken) with no research's tree open here: the
            // chooser again, never the app's own empty tree under the research's connection.
            // A tree held here already (paired again, its earlier pairing's tree) opens as it is, never downloaded again:
            // the research's newer version is offered afterwards, as on the computer (pollResearchBridge).
            while (!await this.openDeviceTree(treeId, !TreeManager.findTreeByResearchId(treeId), pairing.trees.find(t => t.id === treeId)?.name)) {
                treeId = await choose();
            }
        };
        await run(false);
    },

    /**
     * The research's tree through the gateway, as the research's tree on the computer: editable (its people, the
     * sync block, Send changes), "Follow live" only as a read-only choice (spec 094 §4 point 8). Its first time the
     * tree is loaded from the bridge (as ?import-url= does); afterwards the tree held here opens and the research's
     * newer version (the agent's, another device's) is offered as on the computer, by the status asked now and then.
     */
    async openDeviceTree(treeId: string, first: boolean, pairedName?: string): Promise<boolean> {
        // A research's tree has the research's id (strom.json's): an opaque string (U9d), never checked for a UUID.
        if (!deviceTreeIdOk(treeId)) {
            this.closeDeviceBoot();
            return true;
        }
        const base = deviceBridgeBase(treeId, researchDeviceState()?.origin ?? location.origin);
        const boot = document.getElementById(BOOT_ID);
        if (boot && !boot.classList.contains('is-opening')) this.renderDeviceBoot('opening', { pc: '', host: location.hostname });
        let back = false;
        const open = async (): Promise<'done'> => {
            const held = TreeManager.findTreeByResearchId(treeId);
            if (held && !first) {
                if (DataManager.getCurrentTreeId() !== held.id) await this.switchToTree(held.id);
            } else {
                // The download's progress with Cancel over the start screen (as a tree chosen in the switcher);
                // a failure says so with Try again: the same tree picked again in the chooser standing under it,
                // else opened again from the start screen.
                const load = startTreeLoad({ treeId: null, retry: () => {
                    if (chooserPick) {
                        chooserPick(treeId);
                        return;
                    }
                    this.showDeviceBoot();
                    void this.openDeviceTree(treeId, first, pairedName);
                } });
                await this.importResearchFromUrl(`${base}/tree.ged`, { takeSame: true, load });
            }
            return 'done';
        };
        // "Opening…" with nothing to be seen on its way for too long: said, with Try again and Cancel (the chooser).
        const stuck = this.watchDeviceOpening();
        let outcome: 'done' | 'retry' | 'cancel' = 'done';
        try {
            outcome = await Promise.race([open(), stuck.answer]);
        } finally {
            stuck.stop();
            // Nothing of the research open after a first open (Cancel, a failure): the caller's chooser takes the
            // start screen; a research's tree open here already (another one, or this one's older copy) stays.
            if (outcome === 'done') {
                back = first && !this.deviceResearchTreeOpen();
                if (!back) this.closeDeviceBoot();
            }
        }
        if (outcome !== 'done') {
            // Whatever was still on its way stops (a download nobody sees).
            currentTreeLoad()?.cancel();
            if (outcome === 'cancel') return false;
            this.renderDeviceBoot('opening', { pc: '', host: location.hostname });
            return this.openDeviceTree(treeId, !TreeManager.findTreeByResearchId(treeId), pairedName);
        }
        if (back) return false;
        const held = TreeManager.findTreeByResearchId(treeId);
        // A phone's first open from its Research screen chooses the view itself (phoneOpenTree).
        if (first && held && DataManager.getCurrentTreeId() === held.id && !phoneResearchReady()) this.setDisplayViewMode('family');
        this.showDeviceHomeLine();
        this.refreshResearchMenu();
        // A file whose header names nothing: the research's name now (its status, `tree.name`), the pairing's only
        // when the status says none (U9d) — never the default one.
        void this.pollResearchBridge({ reschedule: true }).then(() => {
            this.deviceTreeNamed(treeId, pairedName);
            this.deviceResumeImages(treeId);
        });
        return true;
    },

    /**
     * The images of the research's tree held here that had not come when the page closed (spec 116, I1): asked
     * again through the gateway, as the live follow asks them on the computer — once the research's status says
     * it gives its images by hash. Nothing while a load of the tree's images runs already.
     */
    deviceResumeImages(researchId: string): void {
        const held = TreeManager.findTreeByResearchId(researchId);
        if (!held?.pendingImages || DataManager.getCurrentTreeId() !== held.id) return;
        if (!bridgeGivesImagesByHash(this.researchStatusOf(researchId)?.features)) return;
        const base = deviceBridgeBase(researchId, researchDeviceState()?.origin ?? location.origin);
        this.researchResumePendingImages(held.id, researchId, imagesUrlOf(`${base}/tree.ged`));
    },

    /**
     * The start screen's "Opening the research…" watched: standing for OPENING_LIMIT_MS with nothing on its way to
     * be seen — no download's progress over it, no question asked over it — it says the research is not opening,
     * with Try again and Cancel; `answer` resolves with the one taken. Measured by the clock (a phone's page put
     * aside and back counts the time it was away).
     */
    watchDeviceOpening(): { answer: Promise<'retry' | 'cancel'>; stop(): void } {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        let since: number | null = null;
        let answered!: (a: 'retry' | 'cancel') => void;
        const answer = new Promise<'retry' | 'cancel'>(resolve => { answered = resolve; });
        const look = (): void => {
            if (stopped) return;
            const boot = document.getElementById(BOOT_ID);
            const waiting = boot?.dataset.state === 'opening'
                && !document.querySelector('.toast[data-kind="tree-load"]')
                && !document.querySelector('.modal-overlay.active');
            const now = Date.now();
            since = waiting ? since ?? now : null;
            if (!boot || since === null || now - since < OPENING_LIMIT_MS) {
                timer = setTimeout(look, OPENING_LOOK_MS);
                return;
            }
            this.renderDeviceBoot('openStuck', { pc: '', host: location.hostname });
            boot.querySelector<HTMLButtonElement>('[data-act="retry"]')?.addEventListener('click', () => answered('retry'), { once: true });
            boot.querySelector<HTMLButtonElement>('[data-act="cancel"]')?.addEventListener('click', () => answered('cancel'), { once: true });
            boot.querySelector<HTMLButtonElement>('[data-act="retry"]')?.focus();
        };
        timer = setTimeout(look, OPENING_LOOK_MS);
        return {
            answer,
            stop: () => {
                stopped = true;
                if (timer !== undefined) clearTimeout(timer);
            },
        };
    },

    /** A copy of the research's tree is held on this device (it opens without a download). */
    deviceTreeHeldHere(researchId: string): boolean {
        return !!TreeManager.findTreeByResearchId(researchId);
    },

    /**
     * The research's tree opened from a phone's Research screen (spec 094 §7): the copy held here at once (its newer
     * version afterwards, as on the computer); else downloaded through the gateway with the progress's toast (over
     * the screen's dock) and its Cancel; a failure said by that toast with Try again (`retry`). No connection and no
     * copy: nothing asked ('offline').
     */
    async deviceOpenPhoneTree(researchId: string, retry: () => void): Promise<PhoneTreeOpen> {
        if (!deviceTreeIdOk(researchId)) return 'failed';
        const pairedName = pairingNow()?.trees.find(t => t.id === researchId)?.name;
        const after = (): void => {
            this.refreshResearchMenu();
            void this.pollResearchBridge({ reschedule: true }).then(() => {
                this.deviceTreeNamed(researchId, pairedName);
                this.deviceResumeImages(researchId);
            });
        };
        const held = TreeManager.findTreeByResearchId(researchId);
        if (held) {
            if (DataManager.getCurrentTreeId() !== held.id && await this.switchToTree(held.id) !== 'switched') return 'cancel';
            after();
            return 'open';
        }
        const conn = deviceConnection()?.state;
        if (conn && conn !== 'connected' && conn !== 'connecting') return 'offline';
        const load = startTreeLoad({ treeId: null, retry });
        const base = deviceBridgeBase(researchId, researchDeviceState()?.origin ?? location.origin);
        await this.importResearchFromUrl(`${base}/tree.ged`, { takeSame: true, load });
        const now = TreeManager.findTreeByResearchId(researchId);
        if (!now || DataManager.getCurrentTreeId() !== now.id) return load.cancelled ? 'cancel' : 'failed';
        after();
        return 'open';
    },

    /** A person of the research's tree open here (P…, its REFN) in focus, brought into view (§7 point 8). */
    deviceShowResearchPerson(refn: string): void {
        const person = Object.values(DataManager.getData().persons).find(p => p.refn === refn);
        if (person) this.showLivePerson(person.id);
    },

    /** The tree open now is one of the pairing's research trees (never the app's own tree of its first start). */
    deviceResearchTreeOpen(): boolean {
        const researchId = TreeManager.getActiveTreeMetadata()?.research?.id;
        if (!researchId) return false;
        const held = TreeManager.findTreeByResearchId(researchId);
        if (!held || DataManager.getCurrentTreeId() !== held.id) return false;
        return (pairingNow()?.trees ?? []).some(t => t.id === researchId);
    },

    /** The research's tree held here named from the research (its status's `tree.name`, else the pairing's name). */
    deviceTreeNamed(treeId: string, pairedName?: string): void {
        const held = TreeManager.findTreeByResearchId(treeId);
        if (!held) return;
        const said = this.researchStatusOf(held.research?.id ?? treeId)?.name;
        const rename = deviceTreeRename(held.name, said || pairedName, SUPPORTED_LANGUAGES.map(l => getStringsForLang(l.code).research.defaultName));
        if (!rename) return;
        TreeManager.renameTree(held.id, rename);
        if (DataManager.getCurrentTreeId() === held.id) this.updateUrlTreeParam(held.id);
        this.updateTreeSwitcher();
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

    /** One state of the start screen (2.1, 2.2, 2.3, 2.8a, 2.8b; `openStuck`: "Opening…" too long with nothing to see). */
    renderDeviceBoot(state: 'connecting' | 'paired' | 'opening' | 'openStuck' | 'codeBad' | 'homeUnpaired', o: { pc: string; host: string; home?: boolean }): void {
        const el = document.getElementById(BOOT_ID);
        if (!el) return;
        const d = strings.device;
        const pcB = (text: string): string => o.pc ? esc(text).replace(esc(o.pc), `<b>${esc(o.pc)}</b>`) : esc(text);
        el.classList.remove('is-trees');
        el.classList.toggle('is-opening', state === 'opening');
        el.setAttribute('role', state === 'codeBad' || state === 'homeUnpaired' || state === 'openStuck' ? 'alert' : 'status');
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
        } else if (state === 'openStuck') {
            body = `<span class="device-boot-msg"><b>${esc(d.openStuck)}</b></span>`
                + `<span class="device-boot-msg device-boot-how">${esc(d.openStuckHow)}</span>`
                + '<span class="device-boot-acts">'
                + `<button type="button" class="secondary device-boot-retry" data-act="cancel">${esc(strings.buttons.cancel)}</button>`
                + `<button type="button" class="primary device-boot-retry" data-act="retry">${esc(d.retry)}</button>`
                + '</span>';
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
                ${deviceTreeTextHtml({ researchId: t.id, name: t.name, archive: !!t.archive })}
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
            const pick = (id: string): void => {
                if (chooserPick !== pick) return;
                chooserPick = null;
                el!.onclick = null;
                this.renderDeviceBoot('opening', { pc: '', host: location.hostname });
                resolve(id);
            };
            chooserPick = pick;
            // One listener on the start screen, whichever time the chooser is drawn on it.
            el!.onclick = (e) => {
                const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('.device-tree-row')?.dataset.tree;
                if (id) pick(id);
            };
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
        treeRows.set(tree.id, { row, at: Date.now() });
        // Wherever the tree's row stands now (the chooser, the switcher's list, the Trees sheet).
        for (const sub of document.querySelectorAll<HTMLElement>(`[data-device-sub="${CSS.escape(tree.id)}"]`)) {
            sub.innerHTML = treeSubHtml(row, sub.dataset.archive === '1');
        }
    },

    /** The rows of the switcher's "Research trees" now (spec 094 3.7): the pairing's trees, then what is held here only. */
    deviceTreeChoicesNow(): DeviceTreeChoice[] {
        const held = TreeManager.getVisibleTrees().map(t => ({
            id: t.id, name: t.name, persons: t.personCount ?? 0, ...(t.research?.id ? { researchId: t.research.id } : {}),
        }));
        const researchId = TreeManager.getActiveTreeMetadata()?.research?.id;
        const choices = deviceTreeChoices(pairingNow()?.trees ?? [], held, {
            currentId: TreeManager.getActiveTreeId(),
            statusName: researchId ? this.researchStatusOf(researchId)?.name ?? null : null,
        });
        // A phone's Research screen: its tree is the one marked (the tree open under it may be another).
        if (!this.phoneResearchActive()) return choices;
        const shown = phoneResearchTreeId();
        return choices.map(c => ({ ...c, current: !!c.researchId && c.researchId === shown }));
    },

    /** The trees' second lines asked of the research (each at most every 20 s), drawn where they stand. */
    kickDeviceTreeRows(): void {
        const now = Date.now();
        for (const t of pairingNow()?.trees ?? []) {
            const known = treeRows.get(t.id);
            if (known && now - known.at < ROW_FRESH_MS) continue;
            treeRows.set(t.id, { row: known?.row ?? { persons: null, working: false, waiting: 0 }, at: now });
            void this.fillDeviceTreeRow(t);
        }
    },

    /**
     * Another research tree chosen in the switcher (spec 094 3.7): one held here opens as any tree does (its
     * edits not sent stay in it, its changes go first when they go by themselves); one never opened here is
     * loaded through the gateway as at the start ("Loading the tree from the research…", Cancel, Try again).
     * The choice is remembered and the research's events follow it.
     */
    async pickDeviceTree(c: DeviceTreeChoice): Promise<void> {
        if (c.current) return;
        if (!c.researchId) {
            if (c.localId) await this.switchToTree(c.localId);
            return;
        }
        const researchId = c.researchId;
        if (!deviceTreeIdOk(researchId)) return;
        // On a phone's Research screen only the screen's data change: nothing downloaded (§1 point 8).
        if (this.phoneResearchActive()) {
            await this.phonePickTree(researchId);
            return;
        }
        const held = TreeManager.findTreeByResearchId(researchId);
        if (held) {
            if (DataManager.getCurrentTreeId() !== held.id && await this.switchToTree(held.id) !== 'switched') return;
        } else {
            const load = startTreeLoad({ treeId: null, retry: () => { void this.pickDeviceTree(c); } });
            const base = deviceBridgeBase(researchId, researchDeviceState()?.origin ?? location.origin);
            await this.importResearchFromUrl(`${base}/tree.ged`, { takeSame: true, load });
            const now = TreeManager.findTreeByResearchId(researchId);
            if (!now || DataManager.getCurrentTreeId() !== now.id) return;
            this.setDisplayViewMode('family');
        }
        await chooseTree(researchId);
        // The event stream is of the chosen tree.
        retryDeviceConnection();
        this.refreshResearchMenu();
        const pairedName = pairingNow()?.trees.find(t => t.id === researchId)?.name;
        void this.pollResearchBridge({ reschedule: true }).then(() => {
            this.deviceTreeNamed(researchId, pairedName);
            this.deviceResumeImages(researchId);
        });
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

    /** The home-screen icon's quiet line said again in the UI's language (UI.setLanguage), where it stands. */
    retranslateDeviceHomeLine(): void {
        const el = document.getElementById(HOME_LINE_ID);
        if (!el) return;
        const d = strings.device;
        const text = el.querySelector('.device-home-line-text');
        const how = el.querySelector('.device-home-line-how');
        if (text) text.textContent = d.homeLine;
        if (how) how.textContent = d.homeHow;
        el.querySelector('.device-home-line-x')?.setAttribute('aria-label', d.homeHide);
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
