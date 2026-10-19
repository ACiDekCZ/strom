/**
 * "Connect phone" (spec 012): what the research's loopback bridge says about
 * the phone connection, read without trusting it, and the pure choices the
 * dialog makes from it (which body, when a phone was paired, whether the phone
 * reached the computer, how long ago a phone was seen, the code's validity).
 * The connection and the pairing belong to the whole computer; the bridge of
 * the open tree only reports them (`GET phone`, `status.phone`).
 */

/** The summary in `/status.phone`: enough for the menu item and the button's dot. */
export interface PhoneSummary {
    state: 'off' | 'on' | 'error';
    phones: number;
}

export type PhoneConnState = 'off' | 'confirm' | 'on' | 'declined' | 'error';

export interface PhoneAddress {
    /** `http://192.168.1.23:47800` (the port is in it). */
    url: string;
    iface: string;
    kind: 'wifi' | 'ethernet' | null;
}

export interface PhoneEntry {
    id: string;
    name: string;
    pairedAt: string;
    lastSeenAt: string;
    /** The origin it was paired at. */
    address: string;
    /** Paired at an address the computer no longer has. */
    stale: boolean;
    /** Entries of the same phone at an older address (a hint; the user decides). */
    maybeReplaces: string[];
}

export type PhoneErrorCode = 'no-lan' | 'port-busy' | 'bind-failed';

export type PhonePlatform = 'win' | 'mac' | 'linux';

/** `GET phone`, sanitized. */
export interface PhoneState {
    state: PhoneConnState;
    since: string;
    addresses: PhoneAddress[];
    addressChangedAt: string;
    lanSeenAt: string;
    pair: { expiresAt: string } | null;
    phones: PhoneEntry[];
    error: { code: PhoneErrorCode; detail: string } | null;
    platform: PhonePlatform | null;
    network: { category: 'private' | 'public' | 'domain' | null } | null;
    firewall: { on: boolean | null } | null;
}

/** The dialog's body, chosen from the state (DEV §4) and what the user did in it. */
export type PhoneView = 'intro' | 'wait' | 'refused' | 'noGui' | 'offList' | 'qr' | 'paired' | 'list' | 'error';

const MAX_PHONES = 50;
const MAX_ADDRESSES = 8;

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function text(v: unknown, max: number): string {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** An ISO time, or '' (not said, not a time). */
function isoTime(v: unknown): string {
    const s = text(v, 40);
    return s && Number.isFinite(Date.parse(s)) ? s : '';
}

/** An http address on a private network as the bridge names it, or ''. */
function httpUrl(v: unknown): string {
    const s = text(v, 200);
    if (!/^http:\/\/[^/\s?#]+(:\d{1,5})?\/?$/.test(s)) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'http:' ? `${u.protocol}//${u.host}` : '';
    } catch {
        return '';
    }
}

/** `status.phone`; absent or unreadable reads as off with no phones. `confirm` / `declined` read as off. */
export function sanitizePhoneSummary(value: unknown): PhoneSummary {
    const r = asRecord(value);
    const state = r?.state === 'on' || r?.state === 'error' ? r.state : 'off';
    const n = typeof r?.phones === 'number' && Number.isFinite(r.phones) && r.phones > 0 ? Math.min(999, Math.floor(r.phones)) : 0;
    return { state, phones: n };
}

function sanitizePhone(value: unknown): PhoneEntry | null {
    const r = asRecord(value);
    if (!r) return null;
    const id = text(r.id, 40);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
    const replaces = Array.isArray(r.maybeReplaces)
        ? r.maybeReplaces.slice(0, 10).map(x => text(x, 40)).filter(x => /^[A-Za-z0-9_-]{1,40}$/.test(x) && x !== id) : [];
    return {
        id,
        name: text(r.name, 80),
        pairedAt: isoTime(r.pairedAt),
        lastSeenAt: isoTime(r.lastSeenAt),
        address: httpUrl(r.address),
        stale: r.stale === true,
        maybeReplaces: replaces,
    };
}

/** `GET phone` without trusting it: unknown or missing values tolerated, an unreadable answer is null. */
export function sanitizePhoneState(value: unknown): PhoneState | null {
    const r = asRecord(value);
    if (!r) return null;
    const states: PhoneConnState[] = ['off', 'confirm', 'on', 'declined', 'error'];
    const state = states.includes(r.state as PhoneConnState) ? r.state as PhoneConnState : 'off';
    const addresses: PhoneAddress[] = Array.isArray(r.addresses)
        ? r.addresses.slice(0, MAX_ADDRESSES).flatMap((a): PhoneAddress[] => {
            const ar = asRecord(a);
            const url = httpUrl(ar?.url);
            if (!ar || !url) return [];
            return [{ url, iface: text(ar.iface, 40), kind: ar.kind === 'wifi' || ar.kind === 'ethernet' ? ar.kind : null }];
        }) : [];
    const seen = new Set<string>();
    const phones: PhoneEntry[] = Array.isArray(r.phones)
        ? r.phones.slice(0, MAX_PHONES).map(sanitizePhone).filter((p): p is PhoneEntry => {
            if (!p || seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        }) : [];
    const pair = asRecord(r.pair);
    const pairExpires = isoTime(pair?.expiresAt);
    const err = asRecord(r.error);
    const codes: PhoneErrorCode[] = ['no-lan', 'port-busy', 'bind-failed'];
    // An error state without a known reason still reads as one (said in general words).
    const errCode: PhoneErrorCode | null = err && codes.includes(err.code as PhoneErrorCode) ? err.code as PhoneErrorCode
        : state === 'error' ? 'bind-failed' : null;
    const platform = r.platform === 'win32' ? 'win' : r.platform === 'darwin' ? 'mac' : r.platform === 'linux' ? 'linux' : null;
    const net = asRecord(r.network);
    const cat = net?.category;
    const fw = asRecord(r.firewall);
    return {
        state,
        since: isoTime(r.since),
        addresses,
        addressChangedAt: isoTime(r.addressChangedAt),
        lanSeenAt: isoTime(r.lanSeenAt),
        pair: pairExpires ? { expiresAt: pairExpires } : null,
        phones,
        error: errCode ? { code: errCode, detail: text(err?.detail, 200) } : null,
        platform,
        network: net ? { category: cat === 'private' || cat === 'public' || cat === 'domain' ? cat : null } : null,
        firewall: fw ? { on: typeof fw.on === 'boolean' ? fw.on : null } : null,
    };
}

/** The host of an address ("192.168.1.23"), or ''. */
export function phoneIp(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

/** The port of an address (47800), or null when it has none. */
export function phonePort(url: string | undefined): number | null {
    if (!url) return null;
    try {
        const p = new URL(url).port;
        return p ? Number(p) : null;
    } catch {
        return null;
    }
}

/** The computer's system: the bridge's word, else the browser's (it runs on the same computer). */
export function phonePlatform(fromBridge: PhonePlatform | null, ua: string, uaPlatform = ''): PhonePlatform {
    if (fromBridge) return fromBridge;
    const s = `${uaPlatform} ${ua}`;
    if (/Win/i.test(s)) return 'win';
    if (/Mac|iPhone|iPad/i.test(s)) return 'mac';
    return 'linux';
}

/** What the user did in the dialog, beside what the bridge says. */
export interface PhoneViewContext {
    /** "Turn connection on" pressed, the answer not in yet. */
    enabling: boolean;
    /** The research cannot show its window: turned on in the terminal. */
    noDialog: boolean;
    /** The system window was turned down (kept until the user tries again). */
    refused: boolean;
    /** The QR chosen (from the list, "New QR", or right after turning on). */
    wantQr: boolean;
    /** A phone just paired: its name stays until Done. */
    paired: boolean;
}

/** Which body the dialog shows (DEV §4 at opening, then by what happens). */
export function phoneView(s: PhoneState, ctx: PhoneViewContext): PhoneView {
    if (s.state === 'confirm') return 'wait';
    if (s.state === 'declined') return 'refused';
    if (s.state === 'error') return 'error';
    if (s.state === 'on') {
        if (ctx.paired) return 'paired';
        return ctx.wantQr || s.phones.length === 0 ? 'qr' : 'list';
    }
    // Off.
    if (ctx.noDialog) return 'noGui';
    if (ctx.refused) return 'refused';
    // Pressed, the bridge has not said "confirm" yet: waiting already.
    if (ctx.enabling) return 'wait';
    return s.phones.length === 0 ? 'intro' : 'offList';
}

/** A phone in the list now that was not when the QR was shown: the one just paired (null: none). */
export function newlyPaired(phones: PhoneEntry[], before: ReadonlySet<string>): PhoneEntry | null {
    return phones.find(p => !before.has(p.id)) ?? null;
}

/** The phone reached the computer (any request from the home network) after the QR was shown. */
export function lanSeenSince(lanSeenAt: string, shownAt: number): boolean {
    const t = Date.parse(lanSeenAt);
    return Number.isFinite(t) && t >= shownAt;
}

/** After this long without the phone reaching the computer, the checklist opens. */
export const PHONE_SILENT_MS = 60_000;

/** "The phone has not reached the computer yet": shown a minute after the QR, until it does. */
export function phoneSilent(lanSeenAt: string, shownAt: number, now: number): boolean {
    return now - shownAt >= PHONE_SILENT_MS && !lanSeenSince(lanSeenAt, shownAt);
}

/** How long the code is still valid, "9:12" (0:00 once it has expired); null: not known. */
export function pairCountdown(expiresAt: number, now: number): string | null {
    if (!Number.isFinite(expiresAt)) return null;
    const left = Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const m = Math.floor(left / 60);
    const sec = left % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

/** When a phone was last seen, as the list says it. */
export type SeenAgo =
    | { kind: 'never' }
    | { kind: 'seconds'; n: number }
    | { kind: 'minutes'; n: number }
    | { kind: 'today'; time: string }
    | { kind: 'yesterday'; time: string }
    | { kind: 'date'; date: string };

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "N s ago" under a minute, "N min ago" under an hour, "today HH:MM", "yesterday HH:MM", else the date. */
export function seenAgo(iso: string, now: number, lang: string): SeenAgo {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return { kind: 'never' };
    const diff = Math.max(0, now - t);
    if (diff < 60_000) return { kind: 'seconds', n: Math.floor(diff / 1000) };
    if (diff < 3_600_000) return { kind: 'minutes', n: Math.floor(diff / 60_000) };
    const d = new Date(t);
    const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d);
    if (sameDay(d, new Date(now))) return { kind: 'today', time };
    if (sameDay(d, new Date(now - 86_400_000))) return { kind: 'yesterday', time };
    return { kind: 'date', date: phoneDate(iso, lang) };
}

/** A day as the list says it ("19. 10.", "19.10.", "10/19"); '' when not a time. */
export function phoneDate(iso: string, lang: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric' }).format(new Date(t));
}

/** The address changed while phones were paired at the old one: the yellow bar. */
export function phoneAddressChanged(s: PhoneState): boolean {
    return !!s.addressChangedAt && s.phones.some(p => p.stale);
}
