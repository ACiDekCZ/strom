/**
 * "Research on" (spec 064): the research's bridge switched off from the app
 * (`POST <token>/live {"do": "stop"}`, as `strom live stop` but keeping its
 * address), switched on by the link `live?tree=…&do=start` (no window, no
 * terminal), and the computer's choice how long a bridge stays on without
 * work (`POST <token>/live {"idleMinutes": 0 | 120}` = `strom config set
 * live.idleMinutes`). Each only with its feature in the research's status
 * (`live.stop`, `live.start`, `live.idle`); without it the app shows the state
 * and the command, and sends nothing.
 *
 * A bridge that is off cannot be asked: what its research could do and how it
 * ended (switched off, or after a time without work) is remembered here per
 * research, on this device, from its last status and its `end` event. The
 * features remembered are the research's word only with the version that said
 * them, and only while no newer research is known on this computer (a newer
 * one out, or another bridge of the same install answering with a newer
 * version): after an update the old word is out of date (see
 * `liveFeaturesWord`).
 * Simple requests (text/plain JSON, no cookies) like the other writes; replies
 * typed; never throws.
 */

import {
    LIVE_IDLE_FEATURE, LIVE_START_FEATURE, LIVE_STOP_FEATURE, LIVE_IDLE_MAX, cleanText, researchLinkScheme, sanitizeLiveIdle,
    withAppVersion, DEFAULT_RESEARCH_SCHEME, type LiveIdle, type LiveStatus,
} from './research-link.js';
import { compareAppVersions, isAppVersion } from './app-version.js';

export const LIVE_WRITE_TIMEOUT_MS = 15_000;
/** The features of the switch, the only ones remembered. */
export const LIVE_FEATURES: readonly string[] = [LIVE_IDLE_FEATURE, LIVE_STOP_FEATURE, LIVE_START_FEATURE];
/** The two choices the app sends (spec 064 K2.1): until the computer shuts down, after 2 hours without work. */
export const LIVE_IDLE_FOREVER = 0;
export const LIVE_IDLE_TWO_HOURS = 120;

const STORE_KEY = 'strom-research-live:';

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

// ==================== BODIES AND REPLIES ====================

/** The body of `POST /live` for a choice of minutes (null: not a whole number of minutes the bridge takes). */
export function liveIdleBody(minutes: number): { idleMinutes: number } | null {
    return Number.isInteger(minutes) && minutes >= 0 && minutes <= LIVE_IDLE_MAX ? { idleMinutes: minutes } : null;
}

/** The body of `POST /live` that switches the bridge off. */
export const LIVE_STOP_BODY: Readonly<{ do: 'stop' }> = { do: 'stop' };

/**
 * Why a write of `/live` did not go:
 * - `invalid`: 400 live.body (the app's fault; never again as is);
 * - `refused`: 403 app.only (not the Strom app, as the bridge sees it);
 * - `busy`: 503 research.busy (another write from the app is under way; again in a moment);
 * - `failed`: 500 live.failed (the research could not write its setting);
 * - `network`: no answer; `unknown`: anything else (an older bridge without the feature).
 */
export type LiveWriteCode = 'invalid' | 'refused' | 'busy' | 'failed' | 'network' | 'unknown';

export interface LiveWriteRefusal {
    ok: false;
    code: LiveWriteCode;
    status: number;
    /** The bridge's own sentence ('' none). */
    reason: string;
}

export type LiveIdleResult = { ok: true; live: LiveIdle | null } | LiveWriteRefusal;
export type LiveStopResult = { ok: true } | LiveWriteRefusal;

function bridgeCode(body: unknown): string {
    const r = asRecord(body);
    return typeof r?.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
}

function bridgeSentence(body: unknown): string {
    const r = asRecord(body);
    return cleanText(r?.error, 200);
}

function refusal(status: number, body: unknown): LiveWriteRefusal {
    const code = bridgeCode(body);
    const reason = bridgeSentence(body);
    const out = (c: LiveWriteCode): LiveWriteRefusal => ({ ok: false, code: c, status, reason });
    if (status === 400 && code === 'live.body') return out('invalid');
    if (status === 403 && code === 'app.only') return out('refused');
    if (status === 503 || code === 'research.busy') return out('busy');
    if (status === 500 && code === 'live.failed') return out('failed');
    return out('unknown');
}

/** The reply to `POST /live {"idleMinutes"}`, typed (200 `{"live": {…}}`). */
export function liveIdleReply(status: number, body: unknown): LiveIdleResult {
    if (status >= 200 && status < 300) return { ok: true, live: sanitizeLiveIdle(asRecord(body)?.live) };
    return refusal(status, body);
}

/** The reply to `POST /live {"do": "stop"}`, typed (202 `{"stopping": true}`). */
export function liveStopReply(status: number, body: unknown): LiveStopResult {
    if (status >= 200 && status < 300) return asRecord(body)?.stopping === true ? { ok: true } : { ok: false, code: 'unknown', status, reason: '' };
    return refusal(status, body);
}

async function post(base: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: unknown } | null> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(`${base}/live`), {
            method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body), signal: ctl?.signal,
        });
        const text = await res.text();
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* not JSON: typed as unknown */ }
        return { status: res.status, body: json };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Write the computer's choice how long a bridge stays on without work (only a choice the bridge takes). */
export async function postLiveIdle(base: string, minutes: number, timeoutMs = LIVE_WRITE_TIMEOUT_MS): Promise<LiveIdleResult> {
    const body = liveIdleBody(minutes);
    if (!body) return { ok: false, code: 'invalid', status: 0, reason: '' };
    const res = await post(base, body, timeoutMs);
    return res ? liveIdleReply(res.status, res.body) : { ok: false, code: 'network', status: 0, reason: '' };
}

/** Switch the bridge off (it ends after a write under way; new work in the tree does not start it again). */
export async function postLiveStop(base: string, timeoutMs = LIVE_WRITE_TIMEOUT_MS): Promise<LiveStopResult> {
    const res = await post(base, LIVE_STOP_BODY, timeoutMs);
    return res ? liveStopReply(res.status, res.body) : { ok: false, code: 'network', status: 0, reason: '' };
}

// ==================== WHAT IS REMEMBERED ====================

/** How the bridge ended, as the app last learned it: switched off (`by: 'app'` from here) or after a time without work. */
export interface LiveEnded {
    kind: 'stopped' | 'idle';
    by?: 'app';
    at: number;
}

/** What the app remembers of a research's bridge for the switch while it is off. */
export interface StoredLiveState {
    /** The switch's features its last status named (`live.idle`, `live.stop`, `live.start`). */
    features: string[];
    /** The research's version that named them (absent: not said — an older store, or a status without `features`). */
    version?: string;
    /** A newer research out, as that status said (`update.version`). */
    newer?: string;
    /** Its link scheme (a second install); absent: the default. */
    scheme?: string;
    /** Its last `/status.live`. */
    idle?: LiveIdle;
    /** How it ended last (cleared once it answers again). */
    ended?: LiveEnded;
}

function sanitizeEnded(value: unknown): LiveEnded | undefined {
    const r = asRecord(value);
    if (!r || (r.kind !== 'stopped' && r.kind !== 'idle')) return undefined;
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
    return { kind: r.kind, ...(r.by === 'app' ? { by: 'app' as const } : {}), at };
}

/** The remembered state of a research's bridge (null: none). */
export function storedLiveState(researchId: string): StoredLiveState | null {
    try {
        const raw = localStorage.getItem(STORE_KEY + researchId.toLowerCase());
        if (!raw) return null;
        const r = asRecord(JSON.parse(raw));
        if (!r) return null;
        const features = Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === 'string' && LIVE_FEATURES.includes(f)) : [];
        const scheme = researchLinkScheme(r.scheme);
        const idle = sanitizeLiveIdle(r.idle);
        const ended = sanitizeEnded(r.ended);
        const version = typeof r.version === 'string' && isAppVersion(r.version) ? r.version : '';
        const newer = typeof r.newer === 'string' && isAppVersion(r.newer) ? r.newer : '';
        return {
            features, ...(version ? { version } : {}), ...(newer ? { newer } : {}),
            ...(scheme !== DEFAULT_RESEARCH_SCHEME ? { scheme } : {}), ...(idle ? { idle } : {}), ...(ended ? { ended } : {}),
        };
    } catch {
        return null;
    }
}

function writeLiveState(researchId: string, state: StoredLiveState): void {
    try {
        localStorage.setItem(STORE_KEY + researchId.toLowerCase(), JSON.stringify(state));
    } catch { /* no storage: the switch learns it again at the next status */ }
}

/**
 * A status of the research's bridge: it runs. Its switch features (with the
 * version that said them, when it named its features at all), a newer
 * research out, its scheme and idle choice are kept; how it ended before is
 * forgotten (it is on again). True: something remembered changed.
 */
export function noteLiveStatus(
    researchId: string,
    status: Pick<LiveStatus, 'features' | 'linkScheme' | 'live'> & Partial<Pick<LiveStatus, 'version' | 'update'>>,
): boolean {
    const prev = storedLiveState(researchId);
    const version = status.features && status.version && isAppVersion(status.version) ? status.version : '';
    const newer = status.update?.version && isAppVersion(status.update.version) ? status.update.version : '';
    const next: StoredLiveState = {
        features: (status.features ?? []).filter(f => LIVE_FEATURES.includes(f)),
        ...(version ? { version } : {}),
        ...(newer ? { newer } : {}),
        ...(status.linkScheme && status.linkScheme !== DEFAULT_RESEARCH_SCHEME ? { scheme: status.linkScheme } : {}),
        ...(status.live ? { idle: status.live } : {}),
    };
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return false;
    writeLiveState(researchId, next);
    return true;
}

/** The bridge ended (its `end` event, or a stop asked from here): how, kept for the switch's text. */
export function noteLiveEnded(researchId: string, kind: LiveEnded['kind'], by?: 'app', now = Date.now()): void {
    const prev = storedLiveState(researchId) ?? { features: [] };
    writeLiveState(researchId, { ...prev, ended: { kind, ...(by ? { by } : {}), at: now } });
}

/** The `end` event's reason as the switch keeps it (`stopped` / `idle`); any other reason (a restart, gone) is not an end of this kind. */
export function liveEndKind(reason: string): LiveEnded['kind'] | null {
    return reason === 'stopped' || reason === 'idle' ? reason : null;
}

/**
 * How far the remembered features of a research's bridge (off now) are its word:
 * - `said`: its last status named them with its version and nothing newer is
 *   known — a feature missing there is missing (the switch only says the command);
 * - `unknown`: no version said them (an older store, a status without `features`);
 * - `stale`: a newer version is known on this computer for the same install
 *   (its scheme): a newer research out as its status said, or another research's
 *   bridge that answered with a newer version — it may have been updated since.
 * Unknown and stale: the switch offers the start link (an older research knows
 * `live` too and starts the bridge) and learns the features from its answer.
 */
export type LiveFeaturesWord = 'said' | 'unknown' | 'stale';

export function liveFeaturesWord(researchId: string): LiveFeaturesWord {
    const own = storedLiveState(researchId);
    if (!own?.version) return 'unknown';
    const scheme = own.scheme ?? DEFAULT_RESEARCH_SCHEME;
    const newest = newestLiveVersion(scheme);
    return newest && compareAppVersions(newest, own.version) > 0 ? 'stale' : 'said';
}

/** The newest research version this device knows for an install (its scheme): every bridge's status remembered, and a newer one out. */
export function newestLiveVersion(scheme: string = DEFAULT_RESEARCH_SCHEME): string {
    let newest = '';
    const consider = (v: string | undefined): void => {
        if (v && (!newest || compareAppVersions(v, newest) > 0)) newest = v;
    };
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k?.startsWith(STORE_KEY)) continue;
            const s = storedLiveState(k.slice(STORE_KEY.length));
            if (!s || (s.scheme ?? DEFAULT_RESEARCH_SCHEME) !== scheme) continue;
            consider(s.version);
            consider(s.newer);
        }
    } catch { /* no storage: nothing newer known */ }
    return newest;
}
