/**
 * Sort with the agent without asking (spec 102 U8): `/status.sort` read only from a research with `sort.confirm`,
 * whether the dialog says the cost, `POST /settings/sort {confirm}` with every reply of the contract (403
 * `sort.raise` with the terminal's command: only a person in the research's terminal sets `no`) and the texts in
 * four languages, none addressing the reader. Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    SORT_CONFIRM_FEATURE, DISK_FULL_FEATURE, NOT_DOWNLOADED_FEATURE, SEAL_FOREIGN_FEATURE, sanitizeSortSetting, sanitizeLiveStatus, sortAsksCost,
} from '../research-link.js';
import { sortConfirmReply, postBridgeSortConfirm } from '../history-bridge.js';
import { getStringsForLang } from '../strings.js';

const BASE = 'http://127.0.0.1:7777/abc123';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PARENT = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';
const COMMAND = 'strom config set sort.confirm no --for-tree';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/status.sort', () => {
    const status = (features: string[], sort?: unknown) =>
        sanitizeLiveStatus({ tree: { id: 'R1' }, features, ...(sort !== undefined ? { sort } : {}) })!;

    it('is read with the feature', () => {
        expect(status([SORT_CONFIRM_FEATURE], { confirm: 'ask' }).sort).toEqual({ confirm: 'ask' });
        expect(status([SORT_CONFIRM_FEATURE], { confirm: 'no' }).sort).toEqual({ confirm: 'no' });
    });

    it('is never read without the feature; missing or another value is not said (no switch)', () => {
        expect('sort' in status([], { confirm: 'no' })).toBe(false);
        expect('sort' in status([SORT_CONFIRM_FEATURE])).toBe(false);
        expect('sort' in status([SORT_CONFIRM_FEATURE], { confirm: 'yes' })).toBe(false);
        expect('sort' in status([SORT_CONFIRM_FEATURE], { confirm: false })).toBe(false);
        expect('sort' in status([SORT_CONFIRM_FEATURE], 'no')).toBe(false);
        expect(sanitizeSortSetting(null)).toBeNull();
        expect(sanitizeSortSetting({ confirm: 'no', extra: 1 })).toEqual({ confirm: 'no' });
    });
});

describe('the dialog says the cost', () => {
    it('always, unless the research says no', () => {
        expect(sortAsksCost(null)).toBe(true);
        expect(sortAsksCost(undefined)).toBe(true);
        expect(sortAsksCost({})).toBe(true);
        expect(sortAsksCost({ sort: { confirm: 'ask' } })).toBe(true);
        expect(sortAsksCost({ sort: { confirm: 'no' } })).toBe(false);
    });

    it('not from a research without the feature, whatever its status carries', () => {
        const s = sanitizeLiveStatus({ tree: { id: 'R1' }, features: ['material.sort'], sort: { confirm: 'no' } })!;
        expect(sortAsksCost(s)).toBe(true);
        const on = sanitizeLiveStatus({ tree: { id: 'R1' }, features: ['material.sort', SORT_CONFIRM_FEATURE], sort: { confirm: 'no' } })!;
        expect(sortAsksCost(on)).toBe(false);
    });
});

describe('POST /settings/sort', () => {
    const all = [SORT_CONFIRM_FEATURE, SEAL_FOREIGN_FEATURE, NOT_DOWNLOADED_FEATURE, DISK_FULL_FEATURE];

    it('200: the setting kept now and its commit', () => {
        expect(sortConfirmReply(200, { sort: { confirm: 'ask' }, head: HEAD, parent: PARENT }, all))
            .toEqual({ ok: true, sort: { confirm: 'ask' }, head: HEAD, parent: PARENT });
        expect(sortConfirmReply(200, { sort: { confirm: 'no' }, head: HEAD, parent: HEAD }, all))
            .toEqual({ ok: true, sort: { confirm: 'no' }, head: HEAD, parent: HEAD });
        expect(sortConfirmReply(200, null, all)).toEqual({ ok: true, sort: null, head: '', parent: '' });
    });

    it('403 sort.raise: switching on is the terminal\'s, with its command (only when it looks like one)', () => {
        const raise = (command: unknown) => sortConfirmReply(403, { error: 'Only a person in the terminal.', code: 'sort.raise', command }, all);
        expect(raise(COMMAND)).toEqual({ ok: false, code: 'raise', status: 403, reason: 'Only a person in the terminal.', bridgeCode: 'sort.raise', command: COMMAND });
        expect(raise('rm -rf /')).toEqual({ ok: false, code: 'raise', status: 403, reason: 'Only a person in the terminal.', bridgeCode: 'sort.raise' });
        expect(raise(undefined)).not.toHaveProperty('command');
        // Another 403 is not the raise.
        expect(sortConfirmReply(403, { code: 'other', command: COMMAND }, all)).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('every other refusal of the contract', () => {
        const r = (status: number, code: string, extra: object = {}) =>
            sortConfirmReply(status, { error: 'Said by the research.', code, params: {}, ...extra }, all);
        expect(r(400, 'sort.body')).toMatchObject({ ok: false, code: 'invalid', status: 400 });
        expect(r(409, 'sort.archive', { reasonCode: 'archive' })).toMatchObject({ ok: false, code: 'archive' });
        expect(r(409, 'seal.foreign')).toMatchObject({ ok: false, code: 'held', held: { kind: 'seal' } });
        expect(r(409, 'tree.not-downloaded', { params: { n: 2 } })).toMatchObject({ ok: false, code: 'held', held: { kind: 'cloud', n: 2 } });
        expect(r(423, 'locked')).toMatchObject({ ok: false, code: 'locked' });
        expect(r(503, 'research.busy')).toMatchObject({ ok: false, code: 'busy' });
        expect(sortConfirmReply(507, { code: 'disk.full' }, [SORT_CONFIRM_FEATURE])).toMatchObject({ ok: false, code: 'full' });
        expect(r(500, 'sort.failed')).toMatchObject({ ok: false, code: 'unknown', reason: 'Said by the research.', bridgeCode: 'sort.failed' });
    });

    it('the write: its path and exactly {"confirm": …}; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ sort: { confirm: 'ask' }, head: HEAD, parent: PARENT }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        expect(await postBridgeSortConfirm(BASE, 'ask', all)).toEqual({ ok: true, sort: { confirm: 'ask' }, head: HEAD, parent: PARENT });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe(`${BASE}/settings/sort`);
        expect(init.method).toBe('POST');
        expect(String(init.body)).toBe('{"confirm":"ask"}');
        await postBridgeSortConfirm(BASE, 'no', all);
        expect(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toBe('{"confirm":"no"}');
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeSortConfirm(BASE, 'ask', all)).toEqual({ ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' });
    });
});

describe('the texts', () => {
    const langs = ['en', 'cs', 'de', 'pl'] as const;
    const reader = /\b(you|your|Sie|Ihr|Ihre|du|dein|vy|ty|váš|vaše|tvůj|twój|wy|Pan|Pani)\b/;

    it('are in every language and never address the reader', () => {
        for (const lang of langs) {
            const h = getStringsForLang(lang).history;
            for (const t of [h.sortConfirmTitle, h.sortConfirmDesc, h.sortConfirmRaise]) {
                expect(t, lang).toBeTruthy();
                expect(t, `${lang}: ${t}`).not.toMatch(reader);
            }
        }
        expect(getStringsForLang('cs').history.sortConfirmTitle).toBe('Třídit agentem bez ptaní');
    });
});
