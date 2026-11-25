/**
 * Switching "without asking" on from the app (spec 123 P2): `/status.work.confirm` read with `run.confirm` (even
 * without `work.link`), `POST /settings/run {confirm}` with every reply of the contract, the `reason` of a refused
 * raise (403 `sort.raise` / `run.raise`), the switch never offered for switching on on a device, and the texts in
 * four languages, none addressing the reader. Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    RUN_CONFIRM_FEATURE, SORT_CONFIRM_APP_FEATURE, SORT_CONFIRM_FEATURE, WORK_LINK_FEATURE, confirmSwitchLocked, runConfirmOf, sanitizeLiveStatus,
} from '../research-link.js';
import { runConfirmReply, postBridgeRunConfirm, sortConfirmReply } from '../history-bridge.js';
import { getStringsForLang } from '../strings.js';

const BASE = 'http://127.0.0.1:7777/abc123';
const RUN_COMMAND = 'strom config set run.confirm no';
const SORT_COMMAND = 'strom config set sort.confirm no --for-tree';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the features', () => {
    it('are the contract\'s names', () => {
        expect(SORT_CONFIRM_APP_FEATURE).toBe('sort.confirm.app');
        expect(RUN_CONFIRM_FEATURE).toBe('run.confirm');
    });
});

describe('/status.work.confirm', () => {
    const status = (features: string[], work?: unknown) =>
        sanitizeLiveStatus({ tree: { id: 'R1' }, features, ...(work !== undefined ? { work } : {}) })!;

    it('is read with run.confirm, even without work.link', () => {
        expect(runConfirmOf(status([RUN_CONFIRM_FEATURE], { gate: null, minutes: 60, confirm: 'no' }))).toBe('no');
        expect(runConfirmOf(status([RUN_CONFIRM_FEATURE, WORK_LINK_FEATURE], { gate: 'pro', minutes: 60, confirm: 'ask' }))).toBe('ask');
    });

    it('offers no switch without run.confirm, nor when the value is not said', () => {
        const linkOnly = status([WORK_LINK_FEATURE], { gate: null, minutes: 60, confirm: 'no' });
        expect(linkOnly.work?.confirm).toBe('no');
        expect(runConfirmOf(linkOnly)).toBeNull();
        expect(runConfirmOf(status([RUN_CONFIRM_FEATURE], { gate: null, minutes: 60 }))).toBeNull();
        expect(runConfirmOf(status([RUN_CONFIRM_FEATURE], { gate: null, minutes: 60, confirm: 'yes' }))).toBeNull();
        expect(runConfirmOf(status([RUN_CONFIRM_FEATURE]))).toBeNull();
        expect(runConfirmOf(null)).toBeNull();
    });

    it('stays unread without either feature, as before', () => {
        expect('work' in status([], { gate: null, minutes: 60, confirm: 'no' })).toBe(false);
    });
});

describe('POST /settings/run', () => {
    const all = [RUN_CONFIRM_FEATURE];

    it('200: the value kept now, no commit', () => {
        expect(runConfirmReply(200, { run: { confirm: 'no' } }, all)).toEqual({ ok: true, confirm: 'no' });
        expect(runConfirmReply(200, { run: { confirm: 'ask' } }, all)).toEqual({ ok: true, confirm: 'ask' });
        expect(runConfirmReply(200, { run: { confirm: 'maybe' } }, all)).toEqual({ ok: true, confirm: null });
        expect(runConfirmReply(200, null, all)).toEqual({ ok: true, confirm: null });
    });

    it('403 run.raise: its command and who it came from (device or browser)', () => {
        const raise = (reason: unknown, command: unknown = RUN_COMMAND) =>
            runConfirmReply(403, { error: 'Not here.', code: 'run.raise', command, reason }, all);
        expect(raise('device')).toEqual({ ok: false, code: 'raise', status: 403, reason: 'Not here.', bridgeCode: 'run.raise', command: RUN_COMMAND, raiseReason: 'device' });
        expect(raise('browser')).toMatchObject({ ok: false, code: 'raise', command: RUN_COMMAND, raiseReason: 'browser' });
        expect(raise(undefined)).not.toHaveProperty('raiseReason');
        expect(raise('elsewhere')).not.toHaveProperty('raiseReason');
        expect(raise('device', 'rm -rf /')).not.toHaveProperty('command');
    });

    it('every other refusal of the contract', () => {
        const r = (status: number, code: string, extra: object = {}) =>
            runConfirmReply(status, { error: 'Said by the research.', code, ...extra }, all);
        expect(r(400, 'run.body')).toMatchObject({ ok: false, code: 'invalid', status: 400 });
        expect(r(409, 'run.archive', { reasonCode: 'archive' })).toMatchObject({ ok: false, code: 'archive' });
        expect(r(503, 'research.busy')).toMatchObject({ ok: false, code: 'busy' });
        expect(r(403, 'app.only')).toMatchObject({ ok: false, code: 'unknown', bridgeCode: 'app.only' });
        expect(r(500, 'run.failed')).toMatchObject({ ok: false, code: 'unknown', reason: 'Said by the research.', bridgeCode: 'run.failed' });
    });

    it('the write: its path and exactly {"confirm": …}; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ run: { confirm: 'no' } }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        expect(await postBridgeRunConfirm(BASE, 'no', all)).toEqual({ ok: true, confirm: 'no' });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe(`${BASE}/settings/run`);
        expect(init.method).toBe('POST');
        expect(String(init.body)).toBe('{"confirm":"no"}');
        await postBridgeRunConfirm(BASE, 'ask', all);
        expect(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toBe('{"confirm":"ask"}');
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeRunConfirm(BASE, 'ask', all)).toEqual({ ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' });
    });
});

describe('403 sort.raise with its reason', () => {
    const features = [SORT_CONFIRM_FEATURE, SORT_CONFIRM_APP_FEATURE];
    it('says who it came from; without a reason as before', () => {
        expect(sortConfirmReply(403, { error: 'x', code: 'sort.raise', command: SORT_COMMAND, reason: 'device' }, features))
            .toEqual({ ok: false, code: 'raise', status: 403, reason: 'x', bridgeCode: 'sort.raise', command: SORT_COMMAND, raiseReason: 'device' });
        expect(sortConfirmReply(403, { error: 'x', code: 'sort.raise', command: SORT_COMMAND, reason: 'browser' }, features))
            .toMatchObject({ code: 'raise', raiseReason: 'browser' });
        expect(sortConfirmReply(403, { error: 'x', code: 'sort.raise', command: SORT_COMMAND }, features)).not.toHaveProperty('raiseReason');
    });
});

describe('switching on on a device', () => {
    it('is never offered; switching off is', () => {
        expect(confirmSwitchLocked(false, true)).toBe(true);
        expect(confirmSwitchLocked(true, true)).toBe(false);
        expect(confirmSwitchLocked(false, false)).toBe(false);
        expect(confirmSwitchLocked(true, false)).toBe(false);
    });
});

describe('the texts', () => {
    const langs = ['en', 'cs', 'de', 'pl'] as const;
    const reader = /\b(you|your|Sie|Ihr|Ihre|du|dein|vy|ty|váš|vaše|tvůj|twój|wy|Pan|Pani)\b/;

    it('are in every language and never address the reader', () => {
        for (const lang of langs) {
            const h = getStringsForLang(lang).history;
            for (const t of [h.sortConfirmDesc, h.sortConfirmTerminalOnly, h.sortConfirmAskTitle, h.sortConfirmAskText, h.confirmSwitchOn,
                h.confirmComputerOnly, h.confirmRaiseComputer, h.runConfirmSection, h.runConfirmTitle, h.runConfirmDesc,
                h.runConfirmAskTitle, h.runConfirmAskText]) {
                expect(t, lang).toBeTruthy();
                expect(t, `${lang}: ${t}`).not.toMatch(reader);
            }
        }
        const cs = getStringsForLang('cs').history;
        expect(cs.runConfirmTitle).toBe('Spouštět agenta bez potvrzení');
        expect(cs.sortConfirmDesc).toContain('Platí pro tento strom.');
        expect(cs.sortConfirmDesc).not.toContain('terminálu');
        expect(cs.runConfirmDesc).toContain('Platí pro všechny výzkumy na tomto počítači.');
        expect(cs.runConfirmAskText).toContain('všechny výzkumy');
    });
});
