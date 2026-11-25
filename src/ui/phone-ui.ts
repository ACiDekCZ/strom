/**
 * "Connect phone" (spec 012): the dialog that turns the research's phone
 * connection on and off, shows the pairing QR code (made by the research,
 * shown here as an image), and lists the paired phones with "Unpair" / "Undo".
 * Everything goes to the open tree's bridge (`/phone*`); the connection itself
 * belongs to the whole computer. While the dialog is open (and the tab
 * visible) the bridge is asked every 2 s; nothing is asked once it is closed.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { parseLiveBridge, withAppVersion } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { formatLiveClock } from '../live-time.js';
import {
    PhoneState, PhoneEntry, PhoneAddress, PhoneView, PhonePlatform, sanitizePhoneState, sanitizePhoneSummary, phoneView,
    newlyPaired, phoneSilent, pairCountdown, seenAgo, phoneDate, phoneIp, phonePort, phonePlatform, phoneAddressChanged,
    DeviceEntry, DeviceKind, PhoneDevices, DeviceGatewayCaps, deviceGatewayCaps, deviceKindOf, phonePairedCount, pairMinutesLeft,
    sanitizePhoneDevices, sanitizeDeviceEvent, DEVICE_NAME_MAX,
} from '../phone.js';
import { fetchWithTimeout, bridgeFailure, researchHere } from './research-ui.js';
import { uiModule } from './module.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { runBusy } from './busy.js';
import { tallyBridgeAsk } from '../bridge-ask.js';
import { iconSvg } from '../icons.js';

const DIALOG_ID = 'phone-modal';

/** The open tree's research id (as activeResearchId: none in a view of a shared file or on a copy) — of this module's own. */
function openResearchId(): string | null {
    if (DataManager.isViewMode()) return null;
    const id = DataManager.getCurrentTreeId();
    return (id && TreeManager.canSendToResearch(id) ? TreeManager.getTreeMetadata(id)?.research?.id : undefined) ?? null;
}
const POLL_MS = 2000;
const ASK_TIMEOUT_MS = 5000;
/** How long an unpaired row stays struck through with "Undo" (the research keeps it 15 s). */
const UNDO_MS = 15_000;
/** The research's port when it does not say one. */
const DEFAULT_PORT = 47800;

interface Qr {
    researchId: string;
    blobUrl: string;
    /** Valid until (ms); NaN: not said. */
    expiresAt: number;
    /** The address without the code, as the research names it. */
    pairUrl: string;
    /** The address chosen ('' = the research's first). */
    address: string;
    shownAt: number;
    /** Phones there when the code was shown: a new one is the one just paired. */
    known: Set<string>;
    /** The gateway of the devices: the whole address with its one-time code (shown and copied, never logged). */
    url?: string;
}

interface Removed {
    entry: PhoneEntry;
    index: number;
    until: number;
    /** A device of the app (the gateway): put back by `restore` with this token. */
    device?: DeviceEntry;
    undo?: string;
}

interface PhoneDialog {
    researchId: string;
    /**
     * The research behind it: `running` — its bridge has the phone connection (the dialog as it is);
     * `down` — not running or not answering (yet): it is watched until it answers; `older` — it
     * answered without the phone connection (a version that has none).
     */
    research: 'running' | 'down' | 'older';
    /** "Start the research" pressed: waiting for it to answer. */
    starting: boolean;
    /** Its bridge being asked (in the `down` state). */
    watching: boolean;
    state: PhoneState | null;
    /** The bridge did not answer the last ask (or, slow, several in a row): the last state stays, greyed. */
    lost: boolean;
    /** Asks in a row without an answer in time (a slow research is not lost at the first). */
    misses?: number;
    enabling: boolean;
    noDialog: boolean;
    refused: boolean;
    wantQr: boolean;
    paired: PhoneEntry | null;
    /** "What happens when turned on" open (connection off, phones paired). */
    explain: boolean;
    /** "How to" (the box of what appears on the computer) in place of the QR. */
    how: boolean;
    qr: Qr | null;
    qrLoading: boolean;
    /** A short line after an action the research turned down. */
    note: string;
    removed: Map<string, Removed>;
    replacedDone: Set<string>;
    asking: boolean;
    html: string;
    /** The gateway: "Open only the phone page" ticked (the next code opens the phone's page). */
    pageOnly?: boolean;
    /** The gateway: the device being renamed in its row ('' = none) and the field's text. */
    renaming?: string;
    renameValue?: string;
}

let ph: PhoneDialog | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** What the last tick drew: a change redraws the whole body (expired code, the phone silent). */
let tickKey = '';
/** Per research: its devices connected now and paired (the gateway), as `GET phone` last said them. */
const devicesNow = new Map<string, { connected: number; paired: number }>();
/** Per research: when the menu last looked at its devices (a look at most every PEEK_MS). */
const peekedAt = new Map<string, number>();
const PEEK_MS = 15_000;
/** A removed device's key in the dialog's `removed` (a phone's page row keys by its own id). */
const DEV_KEY = 'dev:';

type PhoneTexts = typeof strings.phone;

/** The dialog's texts: with the gateway of the devices "device(s)" over today's "phone(s)". */
function phoneTexts(gateway: boolean): PhoneTexts {
    return gateway ? { ...strings.phone, ...strings.phoneDevices } : strings.phone;
}

/** A device's kind as a word (no icons). */
function kindWord(kind: DeviceKind | null): string {
    const t = strings.phoneDevices;
    return kind === 'tablet' ? t.typeTablet : kind === 'computer' ? t.typeComputer : t.typePhone;
}

/** A just-paired device of the app as the "Paired" view shows it. */
function deviceAsEntry(x: DeviceEntry): PhoneEntry {
    return { id: x.id, name: x.name, pairedAt: x.pairedAt, lastSeenAt: x.lastSeenAt, address: '', stale: x.stale, maybeReplaces: [] };
}

/** The gateway's answer (`{ devices }`), else what was there. */
function devicesFrom(value: unknown, was: PhoneDevices | null): PhoneDevices | null {
    return sanitizePhoneDevices(value) ?? was;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The open tree's bridge (re-read each time: the research may have started again with a new token). */
function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

async function postBridge(base: string, path: string, body = '{}', method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<Response> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS) : null;
    try {
        return await fetch(withAppVersion(`${base}/${path}`), {
            method, mode: 'cors', credentials: 'omit', cache: 'no-store',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, ...(method === 'DELETE' ? {} : { body }), signal: ctl?.signal,
        });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function revokeQr(): void {
    if (ph?.qr?.blobUrl) {
        try { URL.revokeObjectURL(ph.qr.blobUrl); } catch { /* gone already */ }
    }
    if (ph) ph.qr = null;
}

function platformHere(s: PhoneState | null): PhonePlatform {
    const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { userAgentData?: { platform?: string } } : null;
    return phonePlatform(s?.platform ?? null, nav?.userAgent ?? '', nav?.userAgentData?.platform ?? '');
}

function portOf(s: PhoneState | null): number {
    return phonePort(s?.addresses[0]?.url) ?? DEFAULT_PORT;
}

/** "last seen …" as the list says it. */
function seenText(iso: string, now: number, p: PhoneTexts = strings.phone): string {
    const ago = seenAgo(iso, now, getCurrentLanguage());
    switch (ago.kind) {
        case 'never': return p.rowNotSeen;
        case 'seconds': return p.rowSeen(p.seenSeconds(ago.n));
        case 'minutes': return p.rowSeen(p.seenMinutes(ago.n));
        case 'today': return p.rowSeen(p.seenToday(ago.time));
        case 'yesterday': return p.rowSeen(p.seenYesterday(ago.time));
        default: return p.rowSeen(ago.date);
    }
}

export const phoneMethods = uiModule({
    /**
     * "Connect phone" is offered: the Research menu shows, not Safari. Its research's bridge has
     * `phone`, or it is not known to run now (the dialog offers to start it); not for a research
     * whose bridge answers without `phone` (a version that has none).
     */
    phoneAvailable(): boolean {
        if (!this.researchMenuShown() || !researchHere() || bridgeFailure(null) === 'safari') return false;
        const id = this.activeResearchId();
        if (!id) return false;
        return this.phoneResearchReady(id) || !this.researchBridgeFresh(id);
    },

    /** What the research's bridge offers for the devices (spec 094 P3): nothing of it without `device.gateway`. */
    phoneCaps(researchId?: string | null): DeviceGatewayCaps {
        const id = researchId === undefined ? ph?.researchId ?? openResearchId() : researchId;
        return deviceGatewayCaps(id ? this.researchStatusOf(id)?.features : null);
    },

    /** The phone dialog's and menu's texts: "device(s)" with the gateway, today's "phone(s)" without. */
    phoneT(): PhoneTexts {
        return phoneTexts(this.phoneCaps().gateway);
    },

    /** The research's last status has the phone connection, its bridge is known: the dialog talks to it. */
    phoneResearchReady(researchId: string): boolean {
        return !!this.researchStatusOf(researchId)?.phone && !!bridgeBase(researchId);
    },

    /** The connection as the last status said it (null: not offered, or the research not running — no pill, no dot). */
    phoneSummaryNow(): { state: 'off' | 'on' | 'error'; phones: number } | null {
        if (!this.phoneAvailable()) return null;
        const id = this.activeResearchId();
        return id && this.phoneResearchReady(id) ? this.researchStatusOf(id)?.phone ?? null : null;
    },

    /** Open the dialog (the Research menu's item). */
    showPhoneDialog(): void {
        const researchId = this.activeResearchId();
        if (!researchId || !this.phoneAvailable()) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (ph && document.getElementById(DIALOG_ID)) return;
        const ready = this.phoneResearchReady(researchId);
        ph = {
            researchId, research: ready ? 'running' : 'down', starting: false, watching: false, state: null, lost: false, enabling: false, noDialog: false, refused: false, wantQr: false, paired: null,
            explain: false, how: false, qr: null, qrLoading: false, note: '', removed: new Map(), replacedDone: new Set(), asking: false, html: '',
        };
        let overlay = document.getElementById(DIALOG_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = DIALOG_ID;
            overlay.className = 'modal-overlay active';
            document.body.appendChild(overlay);
            this.pushDialog(DIALOG_ID);
        }
        overlay.addEventListener('click', (e) => this.phoneDialogClick(e));
        overlay.addEventListener('keydown', (e) => this.phoneDialogKey(e as KeyboardEvent));
        overlay.addEventListener('input', (e) => {
            const el = e.target as HTMLInputElement | null;
            if (ph && el?.dataset.act === 'dev-rename-field') ph.renameValue = el.value;
        });
        this.renderPhoneDialog();
        overlay.querySelector<HTMLElement>('[data-act="close"]')?.focus();
        void this.phonePoll();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void this.phonePoll();
        }, POLL_MS);
        if (tickTimer) clearInterval(tickTimer);
        tickKey = '';
        tickTimer = setInterval(() => this.phoneTick(), 1000);
    },

    /** Close / Esc / ×: while the computer's window waits, it is closed too (the connection stays off). */
    closePhoneDialog(): void {
        const d = ph;
        if (d && (d.state?.state === 'confirm' || d.enabling)) {
            const base = bridgeBase(d.researchId);
            if (base) void postBridge(base, 'phone/off').catch(() => undefined);
        }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        revokeQr();
        ph = null;
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        this.refreshResearchMenu();
    },

    /** The dialog's ask every 2 s: the phone connection, or — the research not running — whether it runs now. */
    async phonePoll(): Promise<void> {
        const d = ph;
        if (!d) return;
        if (d.research === 'running') await this.askPhone();
        else if (d.research === 'down') await this.phoneWatchResearch();
    },

    /**
     * The research not running (or not answering yet): its bridge asked as the status poll does;
     * answering with `phone`, the dialog goes on to the connection; without it, says so.
     */
    async phoneWatchResearch(): Promise<void> {
        const d = ph;
        if (!d || d.research !== 'down' || d.watching) return;
        d.watching = true;
        try {
            await this.pollResearchBridge({ reschedule: false });
        } catch {
            /* asked again at the next tick */
        } finally {
            d.watching = false;
        }
        if (ph !== d || d.research !== 'down' || !this.researchBridgeFresh(d.researchId)) return;
        if (this.phoneResearchReady(d.researchId)) {
            d.research = 'running';
            d.starting = false;
            this.renderPhoneDialog();
            void this.askPhone();
            return;
        }
        // An older research: nothing to connect (its menu item goes).
        d.research = 'older';
        d.starting = false;
        this.renderPhoneDialog();
        this.refreshResearchMenu();
    },

    /** "Start the research (research)" (as the state block's): the dialog waits for it to answer. */
    phoneStartResearch(): void {
        const d = ph;
        if (!d || d.research !== 'down') return;
        d.starting = true;
        this.researchSyncAction('startResearch');
        this.renderPhoneDialog();
        void this.phoneWatchResearch();
    },

    /** `GET phone`: take the state in, move the dialog on, redraw. Never throws. */
    async askPhone(): Promise<void> {
        const d = ph;
        if (!d || d.asking || d.research !== 'running') return;
        const base = bridgeBase(d.researchId);
        if (!base) { d.lost = true; this.renderPhoneDialog(); return; }
        d.asking = true;
        let next: PhoneState | null = null;
        let timedOut = false;
        try {
            const res = await fetchWithTimeout(`${base}/phone`, ASK_TIMEOUT_MS);
            if (res.ok) next = sanitizePhoneState(await res.json().catch(() => null));
        } catch (err) {
            next = null;
            const name = (err as { name?: string })?.name;
            timedOut = name === 'AbortError' || name === 'TimeoutError';
        }
        d.asking = false;
        if (ph !== d) return;
        const tally = tallyBridgeAsk(d.misses ?? 0, timedOut ? 'timeout' : 'answer');
        d.misses = tally.strikes;
        // Slow, not gone: the state shown stays as it is until it answers.
        if (tally.keepLast) return;
        if (!next) {
            d.lost = true;
            this.renderPhoneDialog();
            return;
        }
        d.lost = false;
        this.takePhoneState(next);
    },

    /** A new state from the bridge: what it means for the dialog (waiting over, paired, turned off elsewhere). */
    takePhoneState(next: PhoneState): void {
        const d = ph;
        if (!d) return;
        const prev = d.state;
        d.state = next;
        if (next.state !== 'off') d.enabling = false;
        if (next.state === 'declined') d.refused = true;
        if (next.state === 'on') {
            // Turned on from this dialog (its window, or the terminal): straight to the code.
            if (prev?.state === 'confirm' || d.noDialog || d.enabling) d.wantQr = true;
            d.noDialog = false;
            d.refused = false;
            // A phone (with the gateway also a device) that was not there when the code was shown: the one just paired.
            const known = d.qr?.known;
            const freshDevice = known && this.phoneCaps(d.researchId).gateway ? next.devices?.list.find(x => !known.has(x.id)) : undefined;
            const fresh = freshDevice ? deviceAsEntry(freshDevice) : known ? newlyPaired(next.phones, known) : null;
            if (fresh) {
                d.paired = fresh;
                d.wantQr = false;
                d.how = false;
                revokeQr();
            }
        } else {
            d.wantQr = false;
            d.paired = null;
            d.how = false;
            revokeQr();
        }
        const counted = this.phoneNoteDevices(d.researchId, next);
        if (this.notePhoneSummary(d.researchId, sanitizePhoneSummary({ state: next.state, phones: next.phones.length })) || counted) this.refreshResearchMenu();
        if (this.phoneViewNow() === 'qr' && !d.qr && !d.qrLoading) void this.loadPhoneQr();
        this.renderPhoneDialog();
    },

    phoneViewNow(): PhoneView | null {
        const d = ph;
        if (!d?.state) return null;
        return phoneView(d.state, {
            enabling: d.enabling, noDialog: d.noDialog, refused: d.refused, wantQr: d.wantQr, paired: !!d.paired, gateway: this.phoneCaps(d.researchId).gateway,
        });
    },

    /** The devices' counts for the menu (the gateway); true: they changed. */
    phoneNoteDevices(researchId: string, s: PhoneState): boolean {
        if (!this.phoneCaps(researchId).gateway || !s.devices) return false;
        const now = { connected: s.devices.connectedNow, paired: s.devices.list.length + s.phones.length };
        const was = devicesNow.get(researchId);
        devicesNow.set(researchId, now);
        return !was || was.connected !== now.connected || was.paired !== now.paired;
    },

    /**
     * The menu opened (the gateway): a quiet `GET phone` for "on · N connected", at most every 15 s
     * (`force`: a device event said something changed). Never throws.
     */
    async phonePeekDevices(force = false): Promise<void> {
        const id = this.activeResearchId();
        if (!id || !this.phoneCaps(id).gateway || !this.phoneResearchReady(id)) return;
        if (ph?.researchId === id) return;
        const at = Date.now();
        if (!force && at - (peekedAt.get(id) ?? 0) < PEEK_MS) return;
        peekedAt.set(id, at);
        const base = bridgeBase(id);
        if (!base) return;
        try {
            const res = await fetchWithTimeout(`${base}/phone`, ASK_TIMEOUT_MS);
            const next = res.ok ? sanitizePhoneState(await res.json().catch(() => null)) : null;
            if (!next) return;
            const counted = this.phoneNoteDevices(id, next);
            if (this.notePhoneSummary(id, sanitizePhoneSummary({ state: next.state, phones: next.phones.length })) || counted) this.refreshResearchMenu();
        } catch {
            /* the next look tries again */
        }
    },

    /**
     * An event `device` of the bridge's stream (device.events): a new device paired says so in a toast
     * ("Devices…" opens the list), the others refresh the count; with the dialog open it asks again.
     */
    noteDeviceEvent(researchId: string, raw: unknown): void {
        if (!this.phoneCaps(researchId).events) return;
        const ev = sanitizeDeviceEvent(raw);
        if (!ev) return;
        if (ph?.researchId === researchId) { void this.askPhone(); return; }
        if (researchId !== this.activeResearchId()) return;
        void this.phonePeekDevices(true);
        if (ev.what !== 'paired') return;
        const t = strings.device;
        this.showToast(t.newToast(ev.name || strings.phoneDevices.unnamed), 8000, {
            closable: true, action: { label: t.newToastLink, run: () => this.showPhoneDialog() },
        });
    },

    /** `GET phone/qr.svg`: the research makes the code; it is shown as an image. `address`: '' = the research's first. */
    async loadPhoneQr(address = ''): Promise<void> {
        const d = ph;
        if (!d) return;
        if (this.phoneCaps(d.researchId).gateway) { await this.loadDeviceQr(); return; }
        const base = bridgeBase(d.researchId);
        if (!base) return;
        d.qrLoading = true;
        const params = new URLSearchParams({ lang: getCurrentLanguage() });
        if (address) params.set('address', address);
        try {
            const res = await fetchWithTimeout(`${base}/phone/qr.svg?${params.toString()}`, ASK_TIMEOUT_MS);
            if (ph !== d) return;
            if (!res.ok) {
                d.qrLoading = false;
                // 409 phone.off: the connection went off meanwhile; the state says what now.
                void this.askPhone();
                return;
            }
            const blob = await res.blob();
            if (ph !== d) return;
            const svg = blob.type.includes('svg') ? blob : new Blob([await blob.text()], { type: 'image/svg+xml' });
            const expires = Date.parse(res.headers.get('X-Strom-Pair-Expires') ?? '');
            const pairUrl = (res.headers.get('X-Strom-Pair-Url') ?? '').slice(0, 200);
            revokeQr();
            d.qr = {
                researchId: d.researchId, blobUrl: URL.createObjectURL(svg), expiresAt: expires,
                pairUrl: /^http:\/\/[^\s#]+$/.test(pairUrl) ? pairUrl : '', address, shownAt: Date.now(),
                known: new Set(d.state?.phones.map(p => p.id) ?? []),
            };
        } catch {
            if (ph === d) d.lost = true;
        } finally {
            if (ph === d) d.qrLoading = false;
        }
        this.renderPhoneDialog();
    },

    /**
     * The gateway: `POST phone/pair {mode}` — the code for the Strom app, or the phone's page alone
     * ("Open only the phone page" ticked, or no app for the devices on this computer). The address
     * carries its one-time code after `#`: shown and copied, never logged.
     */
    async loadDeviceQr(): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        if (!d || !base) return;
        d.qrLoading = true;
        const mode = d.pageOnly || d.state?.devices?.app === 'none' ? 'page' : 'app';
        const body = JSON.stringify({ mode, lang: getCurrentLanguage() });
        try {
            let res = await postBridge(base, 'phone/pair', body);
            // 503 phone.starting: its server is starting, asked once more a moment later.
            if (res.status === 503) {
                await new Promise(r => setTimeout(r, 1000));
                if (ph !== d) return;
                res = await postBridge(base, 'phone/pair', body);
            }
            if (ph !== d) return;
            const j = res.ok ? await res.json().catch(() => null) as { url?: unknown; qr?: unknown; expiresAt?: unknown } | null : null;
            const svg = typeof j?.qr === 'string' && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(j.qr) ? j.qr : '';
            if (ph !== d) return;
            if (!svg) {
                d.qrLoading = false;
                // 409 phone.off: the connection went off meanwhile; the state says what now.
                void this.askPhone();
                return;
            }
            const url = typeof j?.url === 'string' && /^https?:\/\/[^\s<>"]+$/.test(j.url) ? j.url.slice(0, 600) : '';
            revokeQr();
            d.qr = {
                researchId: d.researchId, blobUrl: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
                expiresAt: typeof j?.expiresAt === 'string' ? Date.parse(j.expiresAt) : NaN,
                pairUrl: '', url, address: '', shownAt: Date.now(),
                known: new Set([...(d.state?.phones.map(x => x.id) ?? []), ...(d.state?.devices?.list.map(x => x.id) ?? [])]),
            };
        } catch {
            if (ph === d) d.lost = true;
        } finally {
            if (ph === d) d.qrLoading = false;
        }
        this.renderPhoneDialog();
    },

    /** Every second: the code's countdown and the "last seen" times in place; a new phase redraws. */
    phoneTick(): void {
        const d = ph;
        if (!d) return;
        const now = Date.now();
        for (const [id, r] of d.removed) if (now >= r.until) d.removed.delete(id);
        const qr = d.qr;
        const key = qr ? `${now >= qr.expiresAt}|${phoneSilent(d.state?.lanSeenAt ?? '', qr.shownAt, now)}|${d.removed.size}`
            : String(d.removed.size);
        if (key !== tickKey) {
            tickKey = key;
            this.renderPhoneDialog();
        } else {
            this.paintPhoneTimes();
        }
    },

    /** Texts that change by the clock (not part of the drawn HTML, so a redraw is not needed for them). */
    paintPhoneTimes(): void {
        const overlay = document.getElementById(DIALOG_ID);
        const d = ph;
        if (!overlay || !d) return;
        const now = Date.now();
        const p = this.phoneT();
        overlay.querySelectorAll<HTMLElement>('[data-seen]').forEach(el => {
            const t = seenText(el.dataset.seen ?? '', now, p);
            if (el.textContent !== t) el.textContent = t;
        });
        const left = overlay.querySelector<HTMLElement>('[data-countdown]');
        if (left && d.qr) {
            const t = pairCountdown(d.qr.expiresAt, now);
            const text = t ? p.qrValid(t) : '';
            if (left.textContent !== text) left.textContent = text;
        }
        // The gateway: a screen reader hears the code's time once a minute, not every second.
        const sr = overlay.querySelector<HTMLElement>('[data-countdown-sr]');
        if (sr && d.qr) {
            const m = pairMinutesLeft(d.qr.expiresAt, now);
            const text = m ? strings.phoneDevices.qrValidSr(m) : '';
            if (sr.textContent !== text) sr.textContent = text;
        }
    },

    // ==================== DRAWING ====================

    renderPhoneDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        const d = ph;
        if (!overlay || !d) return;
        const view = this.phoneViewNow();
        const html = this.phoneFrameHtml(view);
        if (html === d.html) { this.paintPhoneTimes(); return; }
        // Keep keyboard focus across the redraw (by what the element does).
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && overlay.contains(active) ? `${active.dataset.act ?? ''}|${active.dataset.id ?? ''}` : '';
        // A field being typed in keeps its caret through the redraw.
        const caret = active instanceof HTMLInputElement && active.type === 'text' ? [active.selectionStart, active.selectionEnd] as const : null;
        d.html = html;
        overlay.innerHTML = html;
        this.paintPhoneTimes();
        if (focusKey) {
            const [act, id] = focusKey.split('|');
            const again = Array.from(overlay.querySelectorAll<HTMLElement>('[data-act]'))
                .find(el => el.dataset.act === act && (el.dataset.id ?? '') === id);
            (again ?? overlay.querySelector<HTMLElement>('[data-act="close"]'))?.focus();
            if (again instanceof HTMLInputElement && caret && caret[0] !== null && caret[1] !== null) {
                try { again.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ }
            }
        }
    },

    phoneFrameHtml(view: PhoneView | null): string {
        const p = this.phoneT();
        const d = ph!;
        // Back: from "How to" to the code, from the code to the list it was chosen from.
        const back = view === 'qr' && (d.how || (d.state ? phonePairedCount(d.state, this.phoneCaps(d.researchId).gateway) : 0) > 0);
        const narrow = d.research !== 'running' || view === null || view === 'intro' || view === 'wait' || view === 'refused' || view === 'noGui';
        const body = d.research !== 'running' ? this.phoneResearchDownHtml()
            : view === null ? this.phoneLoadingHtml() : this.phoneBodyHtml(view);
        return `
            <div class="modal phone-dialog${narrow ? '' : ' phone-dialog--wide'}" role="dialog" aria-modal="true" aria-labelledby="phone-title">
                <div class="modal-header phone-header">
                    ${back ? `<button type="button" class="phone-back" data-act="back" aria-label="${esc(p.back)}"><span aria-hidden="true">←</span></button>` : ''}
                    <h2 id="phone-title">${esc(p.title)}</h2>
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${body}
            </div>`;
    },

    /** The research not running: the phone connects through it, "Start the research (research)"; or a version without the phone. */
    phoneResearchDownHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const close = `<button type="button" class="${d.research === 'older' ? 'primary' : 'secondary'}" data-act="close">${esc(p.close)}</button>`;
        if (d.research === 'older') {
            return `
                <div class="modal-content phone-content" data-view="older">
                    <div class="phone-body"><div class="phone-state">
                        <span class="phone-dot is-ring" aria-hidden="true"></span>
                        <div class="phone-state-text" role="status"><strong>${esc(p.older)}</strong></div>
                    </div></div>
                </div>
                <div class="buttons phone-footer"><span class="phone-foot-note"></span>${close}</div>`;
        }
        const start = this.researchStartUrl()
            ? `<button type="button" class="primary" data-act="start">${this.researchSyncActionLabel('startResearch', strings.sync.startResearch)}</button>` : '';
        return `
                <div class="modal-content phone-content" data-view="down">
                    <div class="phone-body"><div class="phone-state">
                        <span class="phone-dot is-ring" aria-hidden="true"></span>
                        <div class="phone-state-text"><strong>${esc(p.downTitle)}</strong>
                        <p>${esc(p.downBody)}</p>${d.starting ? `<p class="phone-quiet" role="status">${esc(p.downStarting)}</p>` : ''}</div>
                    </div></div>
                </div>
                <div class="buttons phone-footer"><span class="phone-foot-note"></span>${close}${start}</div>`;
    },

    phoneLoadingHtml(): string {
        const d = ph!;
        return `
                <div class="modal-content phone-content phone-loading">
                    ${d.lost ? `<p class="phone-lost" role="status">${esc(strings.phone.lost)}</p>` : '<i class="busy-spin s16" aria-hidden="true"></i>'}
                </div>
                <div class="buttons phone-footer">
                    <span class="phone-foot-note"></span>
                    <button type="button" class="secondary" data-act="close">${esc(strings.phone.close)}</button>
                </div>`;
    },

    /**
     * The intro's promises: an archive's (what a phone sees there), also for a
     * research waiting for its agent until the agent starts; else the research's.
     */
    phoneIntroLines(): readonly string[] {
        const p = this.phoneT();
        return this.activeResearchAgentless() ? p.introArchive : p.intro;
    },

    phoneBodyHtml(view: PhoneView): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        const gw = this.phoneCaps(d.researchId).gateway;
        const paired = phonePairedCount(s, gw);
        const lost = d.lost ? `<p class="phone-lost" role="status">${esc(p.lost)}</p>` : '';
        const note = d.note ? `<p class="phone-note" role="status">${esc(d.note)}</p>` : '';
        let content = '';
        let footer = '';
        const close = `<button type="button" class="secondary" data-act="close">${esc(p.close)}</button>`;
        const done = `<button type="button" class="primary" data-act="close">${esc(p.done)}</button>`;
        const enable = (cls: string) => `<button type="button" class="${cls}" data-act="enable"${d.lost ? ' disabled' : ''}>${esc(p.enable)}</button>`;
        switch (view) {
            case 'intro':
                content = `
                    <ul class="phone-intro">${this.phoneIntroLines().map(t => `<li><span class="phone-check" aria-hidden="true">✓</span><span>${esc(t)}</span></li>`).join('')}</ul>
                    ${this.phoneSystemHtml()}`;
                footer = `<span class="phone-foot-note"><span class="phone-dot is-ring" aria-hidden="true"></span>${esc(p.off)}</span>${close}${enable('primary')}`;
                break;
            case 'offList':
                content = `
                    <div class="phone-bar sel-opt is-off" data-sel-form="chip">
                        <span class="phone-dot is-ring" aria-hidden="true"></span>
                        <div class="phone-bar-text"><strong>${esc(p.offTitle)}</strong><span>${esc(p.offBody)}
                            <button type="button" class="phone-link" data-act="explain" aria-expanded="${d.explain}">${esc(p.statusWhat)}</button></span></div>
                        ${enable('primary btn-sm')}
                    </div>
                    ${d.explain ? this.phoneSystemHtml() : ''}
                    ${this.phoneListHtml()}`;
                footer = `<span class="phone-foot-note"></span>${done}`;
                break;
            case 'wait':
                content = `
                    <div class="phone-state">
                        <span class="phone-dot is-wait" aria-hidden="true"></span>
                        <div class="phone-state-text"><strong>${esc(p.waitTitle)}</strong>
                        <p>${esc(p.waitBody)}</p><p class="phone-quiet">${esc(p.waitCancel)}</p></div>
                    </div>`;
                footer = `<span class="phone-foot-note"></span>${close}`;
                break;
            case 'refused':
                // The gateway: why (the computer's window) and what turning it on gives, under the state.
                content = `
                    <div class="phone-state">
                        <span class="phone-dot is-ring" aria-hidden="true"></span>
                        <div class="phone-state-text"><strong>${esc(p.refused)}</strong>${gw ? `<p>${esc(strings.phoneDevices.refusedWhy)}</p>` : ''}</div>
                        ${enable('primary btn-sm')}
                    </div>
                    ${gw && !paired ? `<ul class="phone-intro">${this.phoneIntroLines().map(t => `<li><span class="phone-check" aria-hidden="true">✓</span><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
                    ${paired ? this.phoneListHtml() : ''}`;
                footer = `<span class="phone-foot-note"></span>${close}`;
                break;
            case 'noGui':
                content = `
                    <div class="phone-state phone-state--col">
                        <p>${esc(p.noGui)}</p>
                        <code class="phone-cmd">strom phone on</code>
                        <p class="phone-quiet">${esc(p.noGuiAfter)}</p>
                    </div>`;
                footer = `<span class="phone-foot-note"></span>${close}`;
                break;
            case 'qr':
                content = d.how
                    ? this.phoneSystemHtml()
                    : `${this.phoneAddressBarHtml()}${this.phoneStatusBarHtml()}${gw ? this.deviceQrHtml() : this.phoneQrHtml()}`;
                footer = `<span class="phone-foot-note">${d.how ? '' : esc(p.qrWaiting)}</span>${close}`;
                break;
            case 'paired':
                content = `${this.phoneStatusBarHtml()}${this.phonePairedHtml()}`;
                footer = `<span class="phone-foot-note"></span><button type="button" class="secondary" data-act="qr">${esc(p.pairAnother)}</button>`
                    + `<button type="button" class="primary" data-act="paired-done">${esc(p.done)}</button>`;
                break;
            case 'list':
                content = `${this.phoneAddressBarHtml()}${this.phoneStatusBarHtml()}${this.phoneListHtml()}`;
                footer = `<span class="phone-foot-note"></span><button type="button" class="secondary" data-act="qr"${d.lost ? ' disabled' : ''}>${esc(p.connect)}</button>${done}`;
                break;
            case 'error':
                content = `${this.phoneErrorBarHtml()}${paired || d.removed.size ? this.phoneListHtml() : ''}`;
                footer = `<span class="phone-foot-note"></span>${done}`;
                break;
        }
        return `
                <div class="modal-content phone-content${d.lost ? ' is-lost' : ''}" data-view="${view}">
                    ${lost}${note}
                    <div class="phone-body">${content}</div>
                </div>
                <div class="buttons phone-footer">${footer}</div>`;
    },

    /** "What appears on the computer": by the computer's system (Windows with a sketch of the firewall window). */
    phoneSystemHtml(): string {
        const p = this.phoneT();
        const s = ph?.state ?? null;
        const os = platformHere(s);
        const steps = os === 'win' ? [p.sysStep1, p.sysWin] : [p.sysStep1];
        // macOS: the firewall sentence only while the research does not know the firewall is off.
        const extra = os === 'win' ? p.sysWinAdmin : os === 'mac' ? (s?.firewall?.on === false ? '' : p.sysMac) : p.sysLinux(portOf(s));
        const sketch = os === 'win' ? `
                        <div class="phone-fw" aria-hidden="true">
                            <div class="phone-fw-title">Windows Defender Firewall</div>
                            <div class="phone-fw-line">${esc(p.fwTitle)} · node.exe</div>
                            <div class="phone-fw-opt sel-opt is-on"><span class="phone-fw-box">✓</span>${esc(p.fwPrivate)}</div>
                            <div class="phone-fw-opt sel-opt"><span class="phone-fw-box"></span>${esc(p.fwPublic)}</div>
                            <div class="phone-fw-buttons"><span class="phone-fw-btn sel-opt is-on">${esc(p.fwAllow)}</span><span class="phone-fw-btn sel-opt">${esc(p.fwCancel)}</span></div>
                        </div>` : '';
        const pub = os === 'win' && s?.network?.category === 'public' ? `<div class="phone-public">${esc(p.sysPublic)}</div>` : '';
        return `
                    <section class="phone-sys" aria-labelledby="phone-sys-title">
                        <h3 class="phone-section-title" id="phone-sys-title">${esc(p.sysTitle)}</h3>
                        <div class="phone-sys-grid${sketch ? '' : ' is-single'}">
                            <div class="phone-sys-text">
                                <ol>${steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
                                ${extra ? `<p class="phone-quiet">${esc(extra)}</p>` : ''}
                            </div>
                            ${sketch}
                        </div>
                    </section>
                    ${pub}`;
    },

    /** The bar of a connection that is on: its address, since when, "Turn connection off"; under it, that phones stay paired. */
    phoneStatusBarHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        const ip = phoneIp(s.addresses[0]?.url ?? '');
        const since = Date.parse(s.since);
        return `
                    <div class="phone-bar sel-opt is-on" data-sel-form="chip">
                        <span class="phone-dot is-on" aria-hidden="true"></span>
                        <div class="phone-bar-text"><strong>${esc(p.statusOn(ip))}</strong>${Number.isFinite(since)
                            ? `<span>${esc(p.statusSince(formatLiveClock(since, Date.now(), getCurrentLanguage())))}</span>` : ''}</div>
                        <button type="button" class="secondary btn-sm" data-act="disable" data-action="phone-disable"${d.lost ? ' disabled' : ''}>${esc(p.disable)}</button>
                    </div>
                    <p class="phone-keep">${esc(p.statusKeep)}</p>`;
    },

    /** The computer's address changed while phones were paired at the old one. */
    phoneAddressBarHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        if (!phoneAddressChanged(s, this.phoneCaps(d.researchId).gateway) || d.how) return '';
        return `
                    <div class="phone-bar sel-opt is-address" data-sel-form="chip">
                        <div class="phone-bar-text"><strong>${esc(p.addrTitle(phoneIp(s.addresses[0]?.url ?? '')))}</strong>
                        <span>${esc(p.addrBody)}</span><span class="phone-hint">${esc(p.addrHint)}</span></div>
                        ${this.phoneViewNow() === 'qr' ? '' : `<button type="button" class="primary btn-sm" data-act="qr"${d.lost ? ' disabled' : ''}>${esc(p.addrNewQr)}</button>`}
                    </div>`;
    },

    phoneErrorBarHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        const code = s.error?.code ?? 'bind-failed';
        const [title, sub] = code === 'port-busy' ? [p.errPort(phonePort(s.addresses[0]?.url)), p.errRetry]
            : code === 'no-lan' ? [p.errNet, p.errNetRetry] : [p.errBind, p.errBindBody];
        return `
                    <div class="phone-bar sel-opt is-error" data-sel-form="chip" role="status">
                        <span class="phone-dot is-error" aria-hidden="true"></span>
                        <div class="phone-bar-text"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>
                        <button type="button" class="secondary btn-sm" data-act="disable" data-action="phone-disable"${d.lost ? ' disabled' : ''}>${esc(p.disable)}</button>
                    </div>`;
    },

    phoneQrHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        const qr = d.qr;
        const now = Date.now();
        const expired = !!qr && now >= qr.expiresAt;
        const chosen = qr?.address || s.addresses[0]?.url || '';
        const picked: PhoneAddress | undefined = s.addresses.find(a => a.url === chosen) ?? s.addresses[0];
        const nets = s.addresses.length >= 2 && picked
            ? `<div class="phone-nets">${[`<span>${esc(p.qrNet(phoneIp(picked.url), picked.kind))}</span>`,
                ...s.addresses.filter(a => a.url !== picked.url).map(a =>
                    `<button type="button" class="phone-link" data-act="address" data-id="${esc(a.url)}" data-action="${esc(`phone-address:${a.url}`)}" aria-label="${esc(p.qrOtherSr(phoneIp(a.url)))}"${d.lost ? ' disabled' : ''}>${esc(p.qrOther(phoneIp(a.url), a.kind))}</button>`)].join('')}</div>`
            : '';
        const image = qr
            ? `<img class="phone-qr-img" src="${esc(qr.blobUrl)}" alt="${esc(p.qrAlt)}" width="216" height="216">`
            : `<div class="phone-qr-wait">${esc(p.qrLoading)}</div>`;
        const silent = qr && !expired && phoneSilent(s.lanSeenAt, qr.shownAt, now) ? this.phoneChecklistHtml() : '';
        const validity = expired
            ? `<div class="phone-expired" role="status"><strong>${esc(p.qrExpired)}</strong><span>${esc(p.qrExpiredHint)}</span>
                <button type="button" class="primary btn-sm" data-act="new-code" data-action="phone-new-code"${d.lost ? ' disabled' : ''}>${esc(p.qrNew)}</button></div>`
            : qr && Number.isFinite(qr.expiresAt) ? '<p class="phone-valid" data-countdown></p>' : '';
        return `
                    <div class="phone-qr">
                        <div class="phone-qr-box${expired ? ' is-expired' : ''}">${image}</div>
                        <div class="phone-qr-text">
                            <p class="phone-qr-lead">${esc(p.qrScan)}</p>
                            <p class="phone-quiet">${esc(p.qrHow)}</p>
                            ${qr?.pairUrl || chosen ? `<code class="phone-url">${esc(qr?.pairUrl || chosen)}</code>` : ''}
                            ${validity}
                            ${nets}
                            ${silent}
                        </div>
                    </div>`;
    },

    /**
     * The gateway's code (1.8): the QR, how to scan it (a phone, a computer), the address with its
     * one-time code to copy, the time left (a screen reader hears it once a minute), the quiet
     * "Open only the phone page" while the bridge offers it.
     */
    deviceQrHtml(): string {
        const p = this.phoneT();
        const t = strings.phoneDevices;
        const d = ph!;
        const s = d.state!;
        const qr = d.qr;
        const now = Date.now();
        const expired = !!qr && now >= qr.expiresAt;
        const noApp = s.devices?.app === 'none';
        const dis = d.lost ? ' disabled' : '';
        const image = qr
            ? `<img class="phone-qr-img" src="${esc(qr.blobUrl)}" alt="${esc(t.qrAlt)}" width="216" height="216">`
            : `<div class="phone-qr-wait">${esc(p.qrLoading)}</div>`;
        const silent = qr && !expired && phoneSilent(s.lanSeenAt, qr.shownAt, now) ? this.phoneChecklistHtml() : '';
        const validity = expired
            ? `<div class="phone-expired" role="status"><strong>${esc(p.qrExpired)}</strong><span>${esc(t.qrExpiredHint)}</span>
                <button type="button" class="primary btn-sm" data-act="new-code" data-action="phone-new-code"${dis}>${esc(p.qrNew)}</button></div>`
            : qr && Number.isFinite(qr.expiresAt)
                ? '<p class="phone-valid" data-countdown aria-hidden="true"></p><p class="phone-sr" role="status" data-countdown-sr></p>' : '';
        const first = s.addresses[0];
        const nets = s.addresses.length >= 2 && first ? `<div class="phone-nets"><span>${esc(p.qrNet(phoneIp(first.url), first.kind))}</span></div>` : '';
        const address = qr?.url ? `
                            <div class="phone-addr">
                                <code class="phone-url phone-url--code">${esc(qr.url)}</code>
                                <button type="button" class="secondary btn-sm" data-act="copy"${expired ? ' disabled' : ''}>${esc(t.copyAddress)}</button>
                            </div>` : '';
        const pageOnly = this.phoneCaps(d.researchId).phonePage && !noApp ? `
                            <label class="phone-page-only"><input type="checkbox" data-act="page-only"${d.pageOnly ? ' checked' : ''}${dis}><span>${esc(t.pageOnly)}</span></label>` : '';
        return `
                    <div class="phone-qr phone-qr--devices">
                        <div class="phone-qr-box${expired ? ' is-expired' : ''}">${image}</div>
                        <div class="phone-qr-text">
                            <p class="phone-qr-lead">${esc(t.qrScan)}</p>
                            <p class="phone-quiet">${esc(t.qrSameNet)}</p>
                            ${noApp ? `<p class="phone-app-none">${esc(t.appNone)}</p>` : ''}
                            <p class="phone-quiet">${esc(t.qrHow)}</p>
                            <p class="phone-quiet">${esc(t.qrHowPc)}</p>
                            ${address}
                            ${validity}
                            ${nets}
                            ${pageOnly}
                            ${silent}
                        </div>
                    </div>`;
    },

    /**
     * The gateway's list (1.11–1.12): "Paired devices · N" with "connected now K"; a row per device of the
     * app (its kind as a word, connected now / last seen / not seen yet, paired on; a pencil renames it in
     * place while the bridge offers it) and per phone's page ("· phone page"); "Unpair", 15 s "Undo".
     */
    deviceListHtml(): string {
        const t = strings.phoneDevices;
        const d = ph!;
        const s = d.state!;
        const caps = this.phoneCaps(d.researchId);
        const lang = getCurrentLanguage();
        const dis = d.lost ? ' disabled' : '';
        const devs = s.devices?.list ?? [];
        type Row = { key: string; device?: DeviceEntry; phone?: PhoneEntry; removed?: Removed };
        const rows: Row[] = [
            ...devs.map(x => ({ key: DEV_KEY + x.id, device: x })),
            ...s.phones.map(x => ({ key: x.id, phone: x })),
        ];
        const back = [...d.removed.entries()].filter(([key]) => !rows.some(r => r.key === key))
            .map(([key, r]) => ({ key, removed: r, at: r.device ? r.index : devs.length + r.index }))
            .sort((a, b) => a.at - b.at);
        for (const r of back) rows.splice(Math.min(r.at, rows.length), 0, { key: r.key, removed: r.removed });
        const items = rows.map(row => {
            if (row.removed) {
                const r = row.removed;
                const id = r.device?.id ?? r.entry.id;
                return `
                        <li class="phone-row is-removed" data-id="${esc(id)}">
                            <div class="phone-row-text"><s class="phone-row-name">${esc((r.device?.name ?? r.entry.name) || t.unnamed)}</s><span class="phone-row-sub">${esc(t.rowUnpaired)}</span></div>
                            <button type="button" class="phone-link" data-act="${r.device ? 'dev-undo' : 'undo'}" data-action="phone-undo" data-id="${esc(id)}"${dis}>${esc(t.rowUndo)}</button>
                        </li>`;
            }
            const x = row.device;
            const page = row.phone;
            const id = x?.id ?? page!.id;
            const name = (x?.name ?? page!.name) || t.unnamed;
            const kind = x ? x.kind : deviceKindOf(null, page!.name) ?? 'phone';
            const stale = x?.stale ?? page!.stale;
            const pairedOn = phoneDate(x?.pairedAt ?? page!.pairedAt, lang);
            const state = x?.connected
                ? `<span class="phone-row-now"><span class="phone-dot is-on" aria-hidden="true"></span>${esc(t.rowNow)}</span>`
                : stale ? `<span class="phone-row-stale">${esc(t.rowStale)}</span>`
                    : `<span data-seen="${esc(x?.lastSeenAt ?? page!.lastSeenAt)}"></span>`;
            const sub = [state, esc(kindWord(kind)), ...(page ? [esc(t.rowPage)] : []), ...(pairedOn ? [esc(t.rowPaired(pairedOn))] : [])].join(' · ');
            if (x && caps.rename && d.renaming === x.id) {
                return `
                        <li class="phone-row is-renaming" data-id="${esc(id)}">
                            <div class="phone-row-text">
                                <input type="text" class="phone-rename" data-act="dev-rename-field" data-id="${esc(id)}" value="${esc(d.renameValue ?? x.name)}" maxlength="${DEVICE_NAME_MAX}"
                                    aria-label="${esc(t.rowRenameField)}" aria-describedby="phone-rename-hint" autocomplete="off" spellcheck="false"${dis}>
                                <span class="phone-row-sub" id="phone-rename-hint">${esc(kindWord(kind))} · ${esc(x.name || t.unnamed)} · ${esc(t.rowRenameHint)}</span>
                            </div>
                            <button type="button" class="primary btn-sm" data-act="dev-rename-save" data-action="device-rename" data-id="${esc(id)}"${dis}>${esc(t.rowSave)}</button>
                        </li>`;
            }
            const pencil = x && caps.rename
                ? `<button type="button" class="phone-rename-btn" data-act="dev-rename" data-id="${esc(id)}" aria-label="${esc(t.rowRenameSr(name))}" title="${esc(t.rowRename)}"${dis}>${iconSvg('pencil', { size: 14 })}</button>` : '';
            return `
                        <li class="phone-row" data-id="${esc(id)}">
                            <div class="phone-row-text">
                                <span class="phone-row-head"><span class="phone-row-name">${esc(name)}</span>${pencil}</span>
                                <span class="phone-row-sub">${sub}</span>
                            </div>
                            <button type="button" class="secondary btn-sm" data-act="${x ? 'dev-unpair' : 'unpair'}" data-action="phone-unpair" data-id="${esc(id)}" aria-label="${esc(t.rowUnpairSr(name))}"${dis}>${esc(t.rowUnpair)}</button>
                        </li>`;
        }).join('');
        const count = devs.length + s.phones.length;
        const now = s.state === 'on' && s.devices ? `<span class="phone-list-now">${esc(t.listNow(s.devices.connectedNow))}</span>` : '';
        return `
                    <section class="phone-list" aria-labelledby="phone-list-title">
                        <div class="phone-list-head"><h3 class="phone-section-title" id="phone-list-title">${esc(t.listTitle(count))}</h3>${now}</div>
                        ${rows.length ? `<ul class="phone-rows">${items}</ul>` : `<p class="phone-quiet">${esc(t.listEmpty)}</p>`}
                    </section>`;
    },

    /** "The phone has not reached the computer yet": what to check, by the computer's system. */
    phoneChecklistHtml(): string {
        const p = this.phoneT();
        const s = ph?.state ?? null;
        const os = platformHere(s);
        const fw = os === 'win' ? p.checkFwWin : os === 'mac' ? p.checkFwMac : p.checkFwLinux(portOf(s));
        return `
                            <div class="phone-checklist" role="status">
                                <strong>${esc(p.checkTitle)}</strong>
                                <ul>
                                    <li><span>${esc(p.checkWifi)}</span></li>
                                    <li><span>${esc(fw)} <button type="button" class="phone-link" data-act="how">${esc(p.checkHow)}</button></span></li>
                                    ${os === 'win' && s?.network?.category !== 'private' ? `<li><span>${esc(p.checkProfile)}</span></li>` : ''}
                                </ul>
                            </div>`;
    },

    phonePairedHtml(): string {
        const p = this.phoneT();
        const d = ph!;
        const s = d.state!;
        const fresh = d.paired!;
        const old = fresh.maybeReplaces
            .map(id => s.phones.find(x => x.id === id))
            .filter((x): x is PhoneEntry => !!x);
        // One row per older entry; a removed row goes (no Undo, the entry is dead), an empty box goes too.
        const rows = old.filter(o => !d.replacedDone.has(o.id)).map(o => `
                            <div class="phone-replaces-row" data-id="${esc(o.id)}">
                                <div class="phone-replaces-text">
                                    <span>${esc(p.replacesRow(o.name || p.unnamed, phoneDate(o.pairedAt, getCurrentLanguage())))}</span>
                                    ${o.stale ? `<small>${esc(p.replacesStale)}</small>` : ''}
                                </div>
                                <button type="button" class="secondary btn-sm" data-act="replace" data-action="phone-replace" data-id="${esc(o.id)}"${d.lost ? ' disabled' : ''}>${esc(p.replacesBtn)}</button>
                            </div>`).join('');
        const replaces = rows ? `
                        <div class="phone-replaces">${rows}
                        </div>` : '';
        return `
                    <div class="phone-paired" role="status">
                        <span class="phone-paired-mark" aria-hidden="true">✓</span>
                        <div><strong>${esc(p.paired(fresh.name || p.unnamed))}</strong><p>${esc(p.pairedHint)}</p></div>
                    </div>
                    ${replaces}`;
    },

    /** "Paired phones · N": name, paired / last seen, the old address; "Unpair" (struck through 15 s with "Undo", as long as the research keeps it). */
    phoneListHtml(): string {
        const d = ph!;
        if (this.phoneCaps(d.researchId).gateway) return this.deviceListHtml();
        const p = this.phoneT();
        const s = d.state!;
        const lang = getCurrentLanguage();
        const rows: { entry: PhoneEntry; removed: boolean }[] = s.phones.map(entry => ({ entry, removed: false }));
        const back = [...d.removed.values()].filter(r => !s.phones.some(x => x.id === r.entry.id)).sort((a, b) => a.index - b.index);
        for (const r of back) rows.splice(Math.min(r.index, rows.length), 0, { entry: r.entry, removed: true });
        const items = rows.map(({ entry, removed }) => {
            const name = entry.name || p.unnamed;
            if (removed) {
                return `
                        <li class="phone-row is-removed" data-id="${esc(entry.id)}">
                            <div class="phone-row-text"><s class="phone-row-name">${esc(name)}</s><span class="phone-row-sub">${esc(p.rowUnpaired)}</span></div>
                            <button type="button" class="phone-link" data-act="undo" data-action="phone-undo" data-id="${esc(entry.id)}"${d.lost ? ' disabled' : ''}>${esc(p.rowUndo)}</button>
                        </li>`;
            }
            const paired = phoneDate(entry.pairedAt, lang);
            return `
                        <li class="phone-row" data-id="${esc(entry.id)}">
                            <div class="phone-row-text">
                                <span class="phone-row-name">${esc(name)}</span>
                                <span class="phone-row-sub">${paired ? `${esc(p.rowPaired(paired))} · ` : ''}<span data-seen="${esc(entry.lastSeenAt)}"></span></span>
                                ${entry.stale ? `<span class="phone-row-stale">${esc(p.rowStale)}</span>` : ''}
                            </div>
                            <button type="button" class="secondary btn-sm" data-act="unpair" data-action="phone-unpair" data-id="${esc(entry.id)}" aria-label="${esc(p.rowUnpairSr(name))}"${d.lost ? ' disabled' : ''}>${esc(p.rowUnpair)}</button>
                        </li>`;
        }).join('');
        return `
                    <section class="phone-list" aria-labelledby="phone-list-title">
                        <h3 class="phone-section-title" id="phone-list-title">${esc(p.listTitle(s.phones.length))}</h3>
                        ${rows.length ? `<ul class="phone-rows">${items}</ul>` : `<p class="phone-quiet">${esc(p.listEmpty)}</p>`}
                    </section>`;
    },

    // ==================== ACTIONS ====================

    phoneDialogClick(e: Event): void {
        const el = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
        const d = ph;
        if (!el || !d || (el as HTMLButtonElement).disabled) return;
        const id = el.dataset.id ?? '';
        d.note = '';
        switch (el.dataset.act) {
            case 'close': this.closePhoneDialog(); break;
            case 'start': this.phoneStartResearch(); break;
            case 'enable': void this.phoneEnable(); break;
            // Through the bridge: each button says its work from the click until the dialog shows the outcome (C107);
            // `data-action` keeps the state on the button through the dialog's redraws.
            case 'disable': void runBusy(el, () => this.phoneDisable(), { label: strings.busy.turningOff, kind: 'bridge' }); break;
            case 'explain': d.explain = !d.explain; this.renderPhoneDialog(); break;
            case 'how': d.how = true; this.renderPhoneDialog(); break;
            case 'back':
                if (d.how) d.how = false;
                else { d.wantQr = false; revokeQr(); }
                this.renderPhoneDialog();
                break;
            case 'qr':
                d.paired = null;
                d.wantQr = true;
                d.how = false;
                revokeQr();
                this.renderPhoneDialog();
                void this.loadPhoneQr();
                break;
            // The old code stays until the new one comes: the button says it is loading.
            case 'new-code': void runBusy(el, () => this.loadPhoneQr(d.qr?.address ?? ''), { kind: 'bridge' }); break;
            case 'address': void runBusy(el, () => this.loadPhoneQr(id), { kind: 'bridge' }); break;
            case 'paired-done': d.paired = null; d.wantQr = false; this.renderPhoneDialog(); break;
            case 'unpair': void runBusy(el, () => this.phoneUnpair(id), { label: strings.busy.removing, kind: 'bridge' }); break;
            case 'undo': void runBusy(el, () => this.phoneRestore(id), { label: strings.busy.reverting, kind: 'bridge' }); break;
            case 'replace': void runBusy(el, () => this.phoneUnpair(id, true), { label: strings.busy.removing, kind: 'bridge' }); break;
            // The gateway of the devices.
            case 'copy': void this.phoneCopyAddress(); break;
            case 'page-only':
                d.pageOnly = (el as HTMLInputElement).checked;
                void this.loadPhoneQr();
                break;
            case 'dev-rename': this.phoneRenameStart(id); break;
            case 'dev-rename-save': void runBusy(el, () => this.deviceRename(id), { kind: 'bridge' }); break;
            case 'dev-unpair': void runBusy(el, () => this.deviceUnpair(id), { label: strings.busy.removing, kind: 'bridge' }); break;
            case 'dev-undo': void runBusy(el, () => this.deviceRestore(id), { label: strings.busy.reverting, kind: 'bridge' }); break;
        }
    },

    /** The rename field: Enter saves, Esc reverts (and closes nothing else). */
    phoneDialogKey(e: KeyboardEvent): void {
        const el = e.target as HTMLInputElement | null;
        const d = ph;
        if (!d || el?.dataset.act !== 'dev-rename-field') return;
        const id = el.dataset.id ?? '';
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.phoneRenameEnd(id);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            d.renameValue = el.value;
            const save = document.getElementById(DIALOG_ID)?.querySelector<HTMLElement>('[data-act="dev-rename-save"]');
            if (save && !(save as HTMLButtonElement).disabled) void runBusy(save, () => this.deviceRename(id), { kind: 'bridge' });
        }
    },

    /** The pencil: the row's name becomes a field, its text chosen. */
    phoneRenameStart(id: string): void {
        const d = ph;
        const x = d?.state?.devices?.list.find(v => v.id === id);
        if (!d || !x) return;
        d.renaming = id;
        d.renameValue = x.name;
        this.renderPhoneDialog();
        const field = document.getElementById(DIALOG_ID)?.querySelector<HTMLInputElement>('[data-act="dev-rename-field"]');
        field?.focus();
        field?.select();
    },

    /** The field gone (saved or reverted): the pencil of its row takes focus. */
    phoneRenameEnd(id: string): void {
        const d = ph;
        if (!d) return;
        d.renaming = '';
        d.renameValue = '';
        this.renderPhoneDialog();
        const pencil = Array.from(document.getElementById(DIALOG_ID)?.querySelectorAll<HTMLElement>('[data-act="dev-rename"]') ?? [])
            .find(b => b.dataset.id === id);
        pencil?.focus();
    },

    /** "Copy address": the address with its one-time code to the clipboard (never logged). */
    async phoneCopyAddress(): Promise<void> {
        const url = ph?.qr?.url;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            this.showToast(strings.phoneDevices.copied, 2500);
        } catch {
            /* not allowed here: the address stays shown to be copied by hand */
        }
    },

    /** `PUT phone/devices/<id> {name}` (device.rename): an empty or unchanged name reverts. */
    async deviceRename(id: string): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        const was = d?.state?.devices?.list.find(v => v.id === id);
        if (!d || !base || !was) return;
        const name = (d.renameValue ?? '').trim().slice(0, DEVICE_NAME_MAX);
        if (!name || name === was.name) { this.phoneRenameEnd(id); return; }
        try {
            const res = await postBridge(base, `phone/devices/${encodeURIComponent(id)}`, JSON.stringify({ name }), 'PUT');
            if (ph !== d) return;
            if (res.ok) {
                const j = await res.json().catch(() => null) as { devices?: unknown } | null;
                if (ph !== d || !d.state) return;
                d.state = { ...d.state, devices: devicesFrom(j?.devices, d.state.devices) };
                this.phoneRenameEnd(id);
                void this.askPhone();
                return;
            }
            // 400 device.name / 404 device.unknown: the field stays, the line says the research did not take it.
            d.note = strings.phone.failed;
        } catch {
            if (ph === d) d.lost = true;
        }
        this.renderPhoneDialog();
    },

    /** `DELETE phone/devices/<id>`: at once; the row stays struck through with "Undo" for a while. */
    async deviceUnpair(id: string): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        const list = d?.state?.devices?.list ?? [];
        const index = list.findIndex(v => v.id === id);
        const device = list[index];
        if (!d || !base || !device) return;
        try {
            const res = await postBridge(base, `phone/devices/${encodeURIComponent(id)}`, '', 'DELETE');
            if (ph !== d) return;
            if (res.ok) {
                const j = await res.json().catch(() => null) as { undo?: unknown; devices?: unknown } | null;
                if (ph !== d || !d.state) return;
                d.removed.set(DEV_KEY + id, {
                    entry: deviceAsEntry(device), device, index, until: Date.now() + UNDO_MS,
                    ...(typeof j?.undo === 'string' ? { undo: j.undo.slice(0, 200) } : {}),
                });
                const next = devicesFrom(j?.devices, d.state.devices);
                d.state = { ...d.state, devices: next ? { ...next, list: next.list.filter(v => v.id !== id) } : next };
                if (d.renaming === id) d.renaming = '';
                this.renderPhoneDialog();
            }
            // 404 device.unknown: gone already; the list says what is there.
        } catch {
            if (ph === d) d.lost = true;
        }
        await this.askPhone();
    },

    /** `POST phone/devices/<id>/restore {undo}` (the research keeps it 15 s; after that 410 device.gone). */
    async deviceRestore(id: string): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        if (!d || !base) return;
        const r = d.removed.get(DEV_KEY + id);
        try {
            const res = await postBridge(base, `phone/devices/${encodeURIComponent(id)}/restore`, JSON.stringify(r?.undo ? { undo: r.undo } : {}));
            if (ph !== d) return;
            d.removed.delete(DEV_KEY + id);
            if (res.ok) {
                const j = await res.json().catch(() => null) as { devices?: unknown } | null;
                if (ph !== d || !d.state) return;
                d.state = { ...d.state, devices: devicesFrom(j?.devices, d.state.devices) };
                // A device put back is not "just paired".
                if (d.qr) for (const v of d.state.devices?.list ?? []) d.qr.known.add(v.id);
                this.renderPhoneDialog();
            } else {
                d.note = strings.phone.failed;
            }
        } catch {
            if (ph === d) d.lost = true;
        }
        await this.askPhone();
    },

    /** `POST phone/on`: the research asks on the computer (its own window); the dialog waits for the answer. */
    async phoneEnable(): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        if (!d || !base) return;
        d.refused = false;
        d.noDialog = false;
        d.enabling = true;
        this.renderPhoneDialog();
        try {
            const res = await postBridge(base, 'phone/on', JSON.stringify({ lang: getCurrentLanguage() }));
            const j = await res.json().catch(() => null) as { state?: unknown; error?: { code?: unknown } } | null;
            if (ph !== d) return;
            if (j?.error?.code === 'no-dialog') {
                d.enabling = false;
                d.noDialog = true;
            } else if (res.ok && j?.state === 'confirm' && d.state) {
                // Waiting for the computer's window: from now on the state says how it ends.
                d.enabling = false;
                d.state = { ...d.state, state: 'confirm' };
            } else if (!res.ok) {
                d.enabling = false;
                d.note = strings.phone.failed;
            }
        } catch {
            if (ph !== d) return;
            d.enabling = false;
            d.lost = true;
        }
        this.renderPhoneDialog();
        void this.askPhone();
    },

    /** `POST phone/off`, one step: phones stay paired. */
    async phoneDisable(): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        if (!d || !base) return;
        d.wantQr = false;
        d.paired = null;
        revokeQr();
        try {
            const res = await postBridge(base, 'phone/off');
            if (ph === d && !res.ok) d.note = strings.phone.failed;
        } catch {
            if (ph === d) d.lost = true;
        }
        // Its button works until the dialog shows the connection off.
        await this.askPhone();
    },

    /** `POST phone/remove/<id>`: at once; the row stays struck through with "Undo" for a while. */
    async phoneUnpair(id: string, replacing = false): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        const s = d?.state;
        if (!d || !base || !s) return;
        const index = s.phones.findIndex(x => x.id === id);
        const entry = s.phones[index];
        if (!entry) return;
        try {
            const res = await postBridge(base, `phone/remove/${encodeURIComponent(id)}`);
            if (ph !== d) return;
            if (res.ok) {
                if (replacing) d.replacedDone.add(id);
                else d.removed.set(id, { entry, index, until: Date.now() + UNDO_MS });
                await this.phoneTakeList(res);
                return;
            }
            // 404 phone.unknown: gone already; the list says what is there.
        } catch {
            if (ph === d) d.lost = true;
        }
        await this.askPhone();
    },

    /** `POST phone/restore/<id>` (the research keeps it a short while; after that 404 phone.gone). */
    async phoneRestore(id: string): Promise<void> {
        const d = ph;
        const base = d ? bridgeBase(d.researchId) : null;
        if (!d || !base) return;
        try {
            const res = await postBridge(base, `phone/restore/${encodeURIComponent(id)}`);
            if (ph !== d) return;
            d.removed.delete(id);
            if (res.ok) { await this.phoneTakeList(res); return; }
            d.note = strings.phone.failed;
        } catch {
            if (ph === d) d.lost = true;
        }
        await this.askPhone();
    },

    /** A `{ phones }` reply: the list now, the rest of the state as it was (asked again right after). */
    async phoneTakeList(res: Response): Promise<void> {
        const d = ph;
        const j = await res.json().catch(() => null) as { phones?: unknown } | null;
        if (!d || ph !== d || !d.state) return;
        if (Array.isArray(j?.phones)) {
            const next = sanitizePhoneState({ phones: j.phones });
            if (next) {
                d.state = { ...d.state, phones: next.phones };
                // The QR's known phones: a restored one is not "just paired".
                if (d.qr) for (const x of next.phones) d.qr.known.add(x.id);
            }
        }
        this.renderPhoneDialog();
        void this.askPhone();
    },

    /** The Research menu's item: "Connect phone…" off or the research not running; "Phone" with a pill when on or failing. */
    phoneMenuItem(): { label: string; pill?: { text: string; tone: 'on' | 'error' | 'off' } } | null {
        if (!this.phoneAvailable()) return null;
        const sum = this.phoneSummaryNow();
        const p = this.phoneT();
        if (this.phoneCaps().gateway) {
            // The gateway: "Devices" with "on · N connected" (connected now), "off" while devices stay paired.
            const t = strings.phoneDevices;
            const id = this.activeResearchId();
            const counts = id ? devicesNow.get(id) : undefined;
            if (!sum) return { label: t.menuConnect };
            if (sum.state === 'on') return { label: t.menuItem, pill: { text: t.menuOn(counts?.connected ?? 0), tone: 'on' } };
            if (sum.state === 'error') return { label: t.menuItem, pill: { text: t.menuError, tone: 'error' } };
            if ((counts?.paired ?? sum.phones) > 0) return { label: t.menuItem, pill: { text: t.menuOff, tone: 'off' } };
            return { label: t.menuConnect };
        }
        if (!sum) return { label: p.menuConnect };
        if (sum.state === 'on') return { label: p.menuItem, pill: { text: p.menuOn(sum.phones), tone: 'on' } };
        if (sum.state === 'error') return { label: p.menuItem, pill: { text: p.menuError, tone: 'error' } };
        return { label: p.menuConnect };
    },
});
