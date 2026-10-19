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
} from '../phone.js';
import { onComputer, fetchWithTimeout, bridgeFailure } from './research-ui.js';
import { uiModule } from './module.js';

const DIALOG_ID = 'phone-modal';
const POLL_MS = 2000;
const ASK_TIMEOUT_MS = 5000;
/** How long an unpaired row stays struck through with "Undo" (the research keeps it 15 s). */
const UNDO_MS = 8000;
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
}

interface Removed {
    entry: PhoneEntry;
    index: number;
    until: number;
}

interface PhoneDialog {
    researchId: string;
    state: PhoneState | null;
    /** The bridge did not answer the last ask: the last state stays, greyed. */
    lost: boolean;
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
}

let ph: PhoneDialog | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** What the last tick drew: a change redraws the whole body (expired code, the phone silent). */
let tickKey = '';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The open tree's bridge (re-read each time: the research may have started again with a new token). */
function bridgeBase(researchId: string): string | null {
    return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null;
}

async function postBridge(base: string, path: string, body = '{}'): Promise<Response> {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS) : null;
    try {
        return await fetch(withAppVersion(`${base}/${path}`), {
            method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, signal: ctl?.signal,
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
function seenText(iso: string, now: number): string {
    const p = strings.phone;
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
    /** "Connect phone" is offered: the Research menu shows, the research's bridge has `phone`, not Safari. */
    phoneAvailable(): boolean {
        if (!this.researchMenuShown() || !onComputer() || bridgeFailure(null) === 'safari') return false;
        const id = this.activeResearchId();
        return !!id && !!this.researchStatusOf(id)?.phone && !!bridgeBase(id);
    },

    /** The connection as the last status said it (null: not offered). */
    phoneSummaryNow(): { state: 'off' | 'on' | 'error'; phones: number } | null {
        if (!this.phoneAvailable()) return null;
        const id = this.activeResearchId();
        return id ? this.researchStatusOf(id)?.phone ?? null : null;
    },

    /** Open the dialog (the Research menu's item). */
    showPhoneDialog(): void {
        const researchId = this.activeResearchId();
        if (!researchId || !this.phoneAvailable()) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (ph && document.getElementById(DIALOG_ID)) return;
        ph = {
            researchId, state: null, lost: false, enabling: false, noDialog: false, refused: false, wantQr: false, paired: null,
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
        this.renderPhoneDialog();
        overlay.querySelector<HTMLElement>('[data-act="close"]')?.focus();
        void this.askPhone();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void this.askPhone();
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

    /** `GET phone`: take the state in, move the dialog on, redraw. Never throws. */
    async askPhone(): Promise<void> {
        const d = ph;
        if (!d || d.asking) return;
        const base = bridgeBase(d.researchId);
        if (!base) { d.lost = true; this.renderPhoneDialog(); return; }
        d.asking = true;
        let next: PhoneState | null = null;
        try {
            const res = await fetchWithTimeout(`${base}/phone`, ASK_TIMEOUT_MS);
            if (res.ok) next = sanitizePhoneState(await res.json().catch(() => null));
        } catch {
            next = null;
        }
        d.asking = false;
        if (ph !== d) return;
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
            // A phone that was not there when the code was shown: the one just paired.
            const fresh = d.qr ? newlyPaired(next.phones, d.qr.known) : null;
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
        if (this.notePhoneSummary(d.researchId, sanitizePhoneSummary({ state: next.state, phones: next.phones.length }))) this.refreshResearchMenu();
        if (this.phoneViewNow() === 'qr' && !d.qr && !d.qrLoading) void this.loadPhoneQr();
        this.renderPhoneDialog();
    },

    phoneViewNow(): PhoneView | null {
        const d = ph;
        if (!d?.state) return null;
        return phoneView(d.state, { enabling: d.enabling, noDialog: d.noDialog, refused: d.refused, wantQr: d.wantQr, paired: !!d.paired });
    },

    /** `GET phone/qr.svg`: the research makes the code; it is shown as an image. `address`: '' = the research's first. */
    async loadPhoneQr(address = ''): Promise<void> {
        const d = ph;
        if (!d) return;
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
        overlay.querySelectorAll<HTMLElement>('[data-seen]').forEach(el => {
            const t = seenText(el.dataset.seen ?? '', now);
            if (el.textContent !== t) el.textContent = t;
        });
        const left = overlay.querySelector<HTMLElement>('[data-countdown]');
        if (left && d.qr) {
            const t = pairCountdown(d.qr.expiresAt, now);
            const text = t ? strings.phone.qrValid(t) : '';
            if (left.textContent !== text) left.textContent = text;
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
        d.html = html;
        overlay.innerHTML = html;
        this.paintPhoneTimes();
        if (focusKey) {
            const [act, id] = focusKey.split('|');
            const again = Array.from(overlay.querySelectorAll<HTMLElement>('[data-act]'))
                .find(el => el.dataset.act === act && (el.dataset.id ?? '') === id);
            (again ?? overlay.querySelector<HTMLElement>('[data-act="close"]'))?.focus();
        }
    },

    phoneFrameHtml(view: PhoneView | null): string {
        const p = strings.phone;
        const d = ph!;
        // Back: from "How to" to the code, from the code to the list it was chosen from.
        const back = view === 'qr' && (d.how || (d.state?.phones.length ?? 0) > 0);
        const narrow = view === null || view === 'intro' || view === 'wait' || view === 'refused' || view === 'noGui';
        const body = view === null ? this.phoneLoadingHtml() : this.phoneBodyHtml(view);
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

    phoneLoadingHtml(): string {
        const d = ph!;
        return `
                <div class="modal-content phone-content phone-loading">
                    ${d.lost ? `<p class="phone-lost" role="status">${esc(strings.phone.lost)}</p>` : '<div class="phone-spinner" aria-hidden="true"></div>'}
                </div>
                <div class="buttons phone-footer">
                    <span class="phone-foot-note"></span>
                    <button type="button" class="secondary" data-act="close">${esc(strings.phone.close)}</button>
                </div>`;
    },

    phoneBodyHtml(view: PhoneView): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
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
                    <ul class="phone-intro">${p.intro.map(t => `<li><span class="phone-check" aria-hidden="true">✓</span><span>${esc(t)}</span></li>`).join('')}</ul>
                    ${this.phoneSystemHtml()}`;
                footer = `<span class="phone-foot-note"><span class="phone-dot is-ring" aria-hidden="true"></span>${esc(p.off)}</span>${close}${enable('primary')}`;
                break;
            case 'offList':
                content = `
                    <div class="phone-bar is-off">
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
                content = `
                    <div class="phone-state">
                        <span class="phone-dot is-ring" aria-hidden="true"></span>
                        <div class="phone-state-text"><strong>${esc(p.refused)}</strong></div>
                        ${enable('primary btn-sm')}
                    </div>
                    ${s.phones.length ? this.phoneListHtml() : ''}`;
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
                    : `${this.phoneAddressBarHtml()}${this.phoneStatusBarHtml()}${this.phoneQrHtml()}`;
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
                content = `${this.phoneErrorBarHtml()}${s.phones.length || d.removed.size ? this.phoneListHtml() : ''}`;
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
        const p = strings.phone;
        const s = ph?.state ?? null;
        const os = platformHere(s);
        const steps = os === 'win' ? [p.sysStep1, p.sysWin] : [p.sysStep1];
        const extra = os === 'win' ? p.sysWinAdmin : os === 'mac' ? p.sysMac : p.sysLinux(portOf(s));
        const sketch = os === 'win' ? `
                        <div class="phone-fw" aria-hidden="true">
                            <div class="phone-fw-title">Windows Defender Firewall</div>
                            <div class="phone-fw-line">${esc(p.fwTitle)} · node.exe</div>
                            <div class="phone-fw-opt is-on"><span class="phone-fw-box">✓</span>${esc(p.fwPrivate)}</div>
                            <div class="phone-fw-opt"><span class="phone-fw-box"></span>${esc(p.fwPublic)}</div>
                            <div class="phone-fw-buttons"><span class="phone-fw-btn is-on">${esc(p.fwAllow)}</span><span class="phone-fw-btn">${esc(p.fwCancel)}</span></div>
                        </div>` : '';
        const pub = os === 'win' && s?.network?.category === 'public' ? `<div class="phone-public">${esc(p.sysPublic)}</div>` : '';
        return `
                    <section class="phone-sys" aria-labelledby="phone-sys-title">
                        <h3 class="phone-section-title" id="phone-sys-title">${esc(p.sysTitle)}</h3>
                        <div class="phone-sys-grid${sketch ? '' : ' is-single'}">
                            <div class="phone-sys-text">
                                <ol>${steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
                                <p class="phone-quiet">${esc(extra)}</p>
                            </div>
                            ${sketch}
                        </div>
                    </section>
                    ${pub}`;
    },

    /** The bar of a connection that is on: its address, since when, "Turn connection off"; under it, that phones stay paired. */
    phoneStatusBarHtml(): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
        const ip = phoneIp(s.addresses[0]?.url ?? '');
        const since = Date.parse(s.since);
        return `
                    <div class="phone-bar is-on">
                        <span class="phone-dot is-on" aria-hidden="true"></span>
                        <div class="phone-bar-text"><strong>${esc(p.statusOn(ip))}</strong>${Number.isFinite(since)
                            ? `<span>${esc(p.statusSince(formatLiveClock(since, Date.now(), getCurrentLanguage())))}</span>` : ''}</div>
                        <button type="button" class="secondary btn-sm" data-act="disable"${d.lost ? ' disabled' : ''}>${esc(p.disable)}</button>
                    </div>
                    <p class="phone-keep">${esc(p.statusKeep)}</p>`;
    },

    /** The computer's address changed while phones were paired at the old one. */
    phoneAddressBarHtml(): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
        if (!phoneAddressChanged(s) || d.how) return '';
        return `
                    <div class="phone-bar is-address">
                        <div class="phone-bar-text"><strong>${esc(p.addrTitle(phoneIp(s.addresses[0]?.url ?? '')))}</strong>
                        <span>${esc(p.addrBody)}</span><span class="phone-hint">${esc(p.addrHint)}</span></div>
                        ${this.phoneViewNow() === 'qr' ? '' : `<button type="button" class="primary btn-sm" data-act="qr"${d.lost ? ' disabled' : ''}>${esc(p.addrNewQr)}</button>`}
                    </div>`;
    },

    phoneErrorBarHtml(): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
        const code = s.error?.code ?? 'bind-failed';
        const [title, sub] = code === 'port-busy' ? [p.errPort(phonePort(s.addresses[0]?.url)), p.errRetry]
            : code === 'no-lan' ? [p.errNet, p.errNetRetry] : [p.errBind, p.errRetry];
        return `
                    <div class="phone-bar is-error" role="status">
                        <span class="phone-dot is-error" aria-hidden="true"></span>
                        <div class="phone-bar-text"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>
                        <button type="button" class="secondary btn-sm" data-act="disable"${d.lost ? ' disabled' : ''}>${esc(p.disable)}</button>
                    </div>`;
    },

    phoneQrHtml(): string {
        const p = strings.phone;
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
                    `<button type="button" class="phone-link" data-act="address" data-id="${esc(a.url)}" aria-label="${esc(p.qrOtherSr(phoneIp(a.url)))}"${d.lost ? ' disabled' : ''}>${esc(p.qrOther(phoneIp(a.url), a.kind))}</button>`)].join('<span aria-hidden="true"> · </span>')}</div>`
            : '';
        const image = qr
            ? `<img class="phone-qr-img" src="${esc(qr.blobUrl)}" alt="${esc(p.qrAlt)}" width="216" height="216">`
            : `<div class="phone-qr-wait">${esc(p.qrLoading)}</div>`;
        const silent = qr && !expired && phoneSilent(s.lanSeenAt, qr.shownAt, now) ? this.phoneChecklistHtml() : '';
        const validity = expired
            ? `<div class="phone-expired" role="status"><strong>${esc(p.qrExpired)}</strong><span>${esc(p.qrExpiredHint)}</span>
                <button type="button" class="primary btn-sm" data-act="new-code"${d.lost ? ' disabled' : ''}>${esc(p.qrNew)}</button></div>`
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

    /** "The phone has not reached the computer yet": what to check, by the computer's system. */
    phoneChecklistHtml(): string {
        const p = strings.phone;
        const s = ph?.state ?? null;
        const os = platformHere(s);
        const fw = os === 'win' ? p.checkFwWin : os === 'mac' ? p.checkFwMac : p.checkFwLinux(portOf(s));
        return `
                            <div class="phone-checklist" role="status">
                                <strong>${esc(p.checkTitle)}</strong>
                                <ul>
                                    <li><span>${esc(p.checkWifi)}</span></li>
                                    <li><span>${esc(fw)} <button type="button" class="phone-link" data-act="how">${esc(p.checkHow)}</button></span></li>
                                    ${os === 'win' ? `<li><span>${esc(p.checkProfile)}</span></li>` : ''}
                                </ul>
                            </div>`;
    },

    phonePairedHtml(): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
        const fresh = d.paired!;
        const old = fresh.maybeReplaces
            .map(id => s.phones.find(x => x.id === id))
            .filter((x): x is PhoneEntry => !!x);
        const replaces = old.map(o => d.replacedDone.has(o.id) ? '' : `
                        <div class="phone-replaces">
                            <span>${esc(p.replacesRow(phoneDate(o.pairedAt, getCurrentLanguage())))}</span>
                            <button type="button" class="secondary btn-sm" data-act="replace" data-id="${esc(o.id)}"${d.lost ? ' disabled' : ''}>${esc(p.replacesBtn)}</button>
                        </div>`).join('');
        const doneLine = old.some(o => d.replacedDone.has(o.id)) || fresh.maybeReplaces.some(id => d.replacedDone.has(id))
            ? `<p class="phone-quiet" role="status">${esc(p.replacesDone)}</p>` : '';
        return `
                    <div class="phone-paired" role="status">
                        <span class="phone-paired-mark" aria-hidden="true">✓</span>
                        <div><strong>${esc(p.paired(fresh.name || p.unnamed))}</strong><p>${esc(p.pairedHint)}</p></div>
                    </div>
                    ${replaces}${doneLine}`;
    },

    /** "Paired phones · N": name, paired / last seen, the old address; "Unpair" (struck through 8 s with "Undo"). */
    phoneListHtml(): string {
        const p = strings.phone;
        const d = ph!;
        const s = d.state!;
        const lang = getCurrentLanguage();
        const rows: { entry: PhoneEntry; removed: boolean }[] = s.phones.map(entry => ({ entry, removed: false }));
        const back = [...d.removed.values()].filter(r => !s.phones.some(x => x.id === r.entry.id)).sort((a, b) => a.index - b.index);
        for (const r of back) rows.splice(Math.min(r.index, rows.length), 0, { entry: r.entry, removed: true });
        const items = rows.map(({ entry, removed }) => {
            const name = entry.name || p.unnamed;
            if (removed) {
                return `
                        <li class="phone-row is-removed">
                            <div class="phone-row-text"><s class="phone-row-name">${esc(name)}</s><span class="phone-row-sub">${esc(p.rowUnpaired)}</span></div>
                            <button type="button" class="phone-link" data-act="undo" data-id="${esc(entry.id)}"${d.lost ? ' disabled' : ''}>${esc(p.rowUndo)}</button>
                        </li>`;
            }
            const paired = phoneDate(entry.pairedAt, lang);
            return `
                        <li class="phone-row">
                            <div class="phone-row-text">
                                <span class="phone-row-name">${esc(name)}</span>
                                <span class="phone-row-sub">${paired ? `${esc(p.rowPaired(paired))} · ` : ''}<span data-seen="${esc(entry.lastSeenAt)}"></span></span>
                                ${entry.stale ? `<span class="phone-row-stale">${esc(p.rowStale)}</span>` : ''}
                            </div>
                            <button type="button" class="secondary btn-sm" data-act="unpair" data-id="${esc(entry.id)}" aria-label="${esc(p.rowUnpairSr(name))}"${d.lost ? ' disabled' : ''}>${esc(p.rowUnpair)}</button>
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
            case 'enable': void this.phoneEnable(); break;
            case 'disable': void this.phoneDisable(); break;
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
            case 'new-code': void this.loadPhoneQr(d.qr?.address ?? ''); break;
            case 'address': void this.loadPhoneQr(id); break;
            case 'paired-done': d.paired = null; d.wantQr = false; this.renderPhoneDialog(); break;
            case 'unpair': void this.phoneUnpair(id); break;
            case 'undo': void this.phoneRestore(id); break;
            case 'replace': void this.phoneUnpair(id, true); break;
        }
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
        void this.askPhone();
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
        void this.askPhone();
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
        void this.askPhone();
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

    /** The Research menu's item: "Connect phone…" off; "Phone" with a pill when on or failing. */
    phoneMenuItem(): { label: string; pill?: { text: string; tone: 'on' | 'error' } } | null {
        const sum = this.phoneSummaryNow();
        if (!sum) return null;
        const p = strings.phone;
        if (sum.state === 'on') return { label: p.menuItem, pill: { text: p.menuOn(sum.phones), tone: 'on' } };
        if (sum.state === 'error') return { label: p.menuItem, pill: { text: p.menuError, tone: 'error' } };
        return { label: p.menuConnect };
    },
});
