/**
 * Back to the agent from "Awaiting action" (spec 089): an item's `retry`
 * read only with `waiting.retry`, the bridge's writes (`{do: "retry"}` at an
 * item and at a place) and their answers typed, where the action stands
 * among an item's actions, and the texts of the Now line, the counts, the
 * limit and a place's band. Invented research "Hrotkovi z Lipníku".
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { LiveWaiting, WAITING_RETRY_FEATURE, sanitizeLiveStatus, sanitizeWaiting, sanitizeWaitingRetry } from '../research-link.js';
import {
    NO_WAITING_WRITES, WaitingWrites, groupRetryReply, retryGroup, retryWaiting, waitingRetryReply, waitingWrites,
} from '../research-waiting-write.js';
import {
    IMAGES_ORDER, ANSWER_ORDER, groupRetryAria, groupRetryConfirmText, groupRetryCountText, groupRetryFailText, groupRetryLaterText,
    retryWhenText, splitWaitingActions, waitingActions, waitingGroupRetry, waitingGroupRetryReason, waitingRetryCount, waitingRetryLimitText,
    waitingRetryMain, waitingRetryReason, waitingRetryRefusedText,
} from '../research-waiting.js';
import { getStringsForLang } from '../strings.js';

const BASE = 'http://127.0.0.1:47321/0123456789abcdef';
const HEAD = 'c'.repeat(40);
const AT = '2026-11-24T10:00:00.000Z';
const MZA = { key: 'repo:R0003', name: 'Moravský zemský archiv v Brně', kind: 'archive' };

const raw = (id: string, retry: unknown, extra: Record<string, unknown> = {}) => ({
    id, what: `Matrika Lipník ${id}`, on: 'snímky', at: AT, kind: 'images', group: MZA, retry, ...extra,
});
const item = (id: string, retry: unknown, extra: Record<string, unknown> = {}): LiveWaiting =>
    sanitizeWaiting([raw(id, retry, extra)], true, false, false, false, true)[0];

describe('an item\'s retry is read only with waiting.retry', () => {
    it('without the feature the field is dropped; with it, a well-formed one is kept', () => {
        const r = { why: 'held', host: 'www.mza.cz', images: 3, says: 'prohlížeč zadržel stahování', can: true };
        expect(sanitizeWaiting([raw('T0412', r)], true)[0].retry).toBeUndefined();
        expect(sanitizeWaiting([raw('T0412', r)], true, false, false, false, true)[0].retry)
            .toEqual({ why: 'held', host: 'www.mza.cz', images: 3, says: 'prohlížeč zadržel stahování', can: true });
    });

    it('through the status: only when the features announce it', () => {
        const status = (features: string[]) => sanitizeLiveStatus({
            tree: { id: 'hrotkovi', name: 'Hrotkovi z Lipníku' }, features: ['waiting.groups', ...features],
            waiting: [raw('T0412', { why: 'stopped', can: true })],
        })!;
        expect(status([]).waiting[0].retry).toBeUndefined();
        expect(status([WAITING_RETRY_FEATURE]).waiting[0].retry).toEqual({ why: 'stopped', can: true });
    });

    it('invalid values are dropped: no can, no why, a bad host, images not a whole count, times Date.parse refuses', () => {
        expect(sanitizeWaitingRetry({ why: 'held' })).toBeNull();
        expect(sanitizeWaitingRetry({ why: 'held', can: 'yes' })).toBeNull();
        expect(sanitizeWaitingRetry({ can: true })).toBeNull();
        expect(sanitizeWaitingRetry({ why: 'Held now!', can: true })).toBeNull();
        expect(sanitizeWaitingRetry('held')).toBeNull();
        expect(sanitizeWaitingRetry({
            why: 'held', host: 'not a host', images: 2.5, screen: 'yes', says: 42, again: { at: 'yesterday' }, can: true,
        })).toEqual({ why: 'held', can: true });
        expect(sanitizeWaitingRetry({ why: 'screen', screen: true, images: -1, can: true })).toEqual({ why: 'screen', screen: true, can: true });
        expect(sanitizeWaitingRetry({ why: 'held', can: false, until: 'soon' })).toEqual({ why: 'held', can: false });
        expect(sanitizeWaitingRetry({ why: 'held', can: false, until: '2026-11-25T09:12:00.000Z', again: { at: '2026-11-24T17:40:00.000Z' } }))
            .toEqual({ why: 'held', can: false, until: '2026-11-25T09:12:00.000Z', again: { at: '2026-11-24T17:40:00.000Z' } });
        // `until` only goes with can: false.
        expect(sanitizeWaitingRetry({ why: 'held', can: true, until: '2026-11-25T09:12:00.000Z' })).toEqual({ why: 'held', can: true });
        // An unknown why is kept (its line comes from `says`).
        expect(sanitizeWaitingRetry({ why: 'archive-closed', says: 'archiv je zavřený', can: true })).toEqual({ why: 'archive-closed', says: 'archiv je zavřený', can: true });
    });

    it('only at a task', () => {
        expect(item('B0003', { why: 'held', can: true }).retry).toBeUndefined();
        expect(item('T0412', { why: 'held', can: true }).retry).toBeDefined();
    });
});

describe('what the bridge takes', () => {
    it('waiting.retry gives writes.retry; no bridge: none', () => {
        expect(waitingWrites({ features: [WAITING_RETRY_FEATURE], accepts: null }).retry).toBe(true);
        expect(waitingWrites({ features: ['waiting.sent'], accepts: null }).retry).toBe(false);
        expect(NO_WAITING_WRITES.retry).toBe(false);
    });
});

describe('where Retry with the agent stands among an item\'s actions', () => {
    const W: WaitingWrites = { ...NO_WAITING_WRITES, answer: true, images: true, retry: true };
    const keys = (w: LiveWaiting, ctx: Partial<Parameters<typeof waitingActions>[1]> = {}) =>
        waitingActions(w, { writes: W, links: true, phone: false, retry: true, ...ctx })!.map(v => v.key);
    const actions = { actions: ['images', 'answer', 'chat', 'folder'], url: 'https://www.mza.cz/actapublica/' };

    it('the orders put it first', () => {
        expect(IMAGES_ORDER[0]).toBe('retry');
        expect(ANSWER_ORDER[0]).toBe('retry');
    });

    it('the main one first (held, stopped, ready, screen, an unknown why), through the bridge without the AI badge', () => {
        for (const why of ['held', 'stopped', 'ready', 'screen', 'archive-closed']) {
            const w = item('T0412', { why, can: true }, actions);
            expect(waitingRetryMain(w.retry!)).toBe(true);
            expect(keys(w)).toEqual(['retry', 'images', 'web', 'answer', 'chat', 'folder']);
            expect(waitingActions(w, { writes: W, links: true, phone: false, retry: true })![0]).toEqual({ key: 'retry', via: 'bridge', ai: false });
        }
    });

    it('an outlined one right after the first action (the extension not connected, the agent without a browser)', () => {
        for (const why of ['no-extension', 'agent-without-browser']) {
            const w = item('T0412', { why, can: true }, actions);
            expect(waitingRetryMain(w.retry!)).toBe(false);
            expect(keys(w)).toEqual(['images', 'retry', 'web', 'answer', 'chat', 'folder']);
        }
        // A website without a book: after Answer.
        const web = item('T0413', { why: 'no-extension', can: true }, { kind: 'web', url: 'https://www.mza.cz/', actions: ['answer'] });
        expect(keys(web)).toEqual(['answer', 'retry', 'web']);
    });

    it('never under More actions', () => {
        const main = waitingActions(item('T0412', { why: 'held', can: true }, actions), { writes: W, links: true, phone: false, retry: true })!;
        const side = waitingActions(item('T0412', { why: 'no-extension', can: true }, actions), { writes: W, links: true, phone: false, retry: true })!;
        for (const list of [main, side]) {
            for (const wide of [false, true]) {
                const { shown, more } = splitWaitingActions(list, { phone: false, wide });
                expect(shown.some(v => v.key === 'retry')).toBe(true);
                expect(more.some(v => v.key === 'retry')).toBe(false);
            }
        }
    });

    it('not offered: can false, no retry, no waiting.retry, a phone, nor where the caller does not ask (the small panel, the Deliver block)', () => {
        const base = ['images', 'web', 'answer', 'chat', 'folder'];
        expect(keys(item('T0412', { why: 'held', can: false, until: '2026-11-25T09:12:00.000Z' }, actions))).toEqual(base);
        expect(keys(item('T0412', undefined, actions))).toEqual(base);
        expect(keys(item('T0412', { why: 'held', can: true }, actions), { writes: { ...W, retry: false } })).toEqual(base);
        expect(keys(item('T0412', { why: 'held', can: true }, actions), { writes: { answer: true, images: true } })).toEqual(base);
        expect(keys(item('T0412', { why: 'held', can: true }, actions), { phone: true, links: false })).toEqual(['web', 'answer']);
        expect(keys(item('T0412', { why: 'held', can: true }, actions), { retry: false })).toEqual(base);
        expect(keys(item('T0412', { why: 'held', can: true }, actions), { retry: undefined })).toEqual(base);
    });
});

describe('the Now line', () => {
    // 24 Nov 2026 19:00 local time; the clock fixed, away from midnight.
    const NOW = new Date(2026, 10, 24, 19, 0).getTime();
    const today = new Date(2026, 10, 24, 18, 40).toISOString();
    const yesterday = new Date(2026, 10, 23, 18, 40).toISOString();
    const older = new Date(2026, 10, 20, 18, 40).toISOString();
    const tomorrow = new Date(2026, 10, 25, 9, 12).toISOString();
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });
    const cs = getStringsForLang('cs');
    const R = cs.live.waitingRetry;

    it('by why, in the UI language', () => {
        expect(waitingRetryReason(item('T0412', { why: 'held', host: 'www.mza.cz', can: true }), 'cs'))
            .toEqual({ text: R.held('www.mza.cz'), extLink: false });
        expect(waitingRetryReason(item('T0412', { why: 'held', can: true }), 'cs')!.text).toBe(R.heldNoHost);
        expect(waitingRetryReason(item('T0412', { why: 'stopped', can: true }), 'cs')!.text).toBe(R.stopped);
        expect(waitingRetryReason(item('T0412', { why: 'ready', can: true }), 'cs')!.text).toBe(R.ready);
        expect(waitingRetryReason(item('T0412', { why: 'screen', screen: true, can: true }), 'cs')!.text).toBe(R.screen);
        expect(waitingRetryReason(item('T0412', { why: 'no-extension', can: true }), 'cs'))
            .toEqual({ text: `${cs.research.browser.waitNoExt} ${R.afterExt}`, extLink: true });
        expect(waitingRetryReason(item('T0412', { why: 'agent-without-browser', can: true }), 'cs'))
            .toEqual({ text: cs.research.browser.waitAgent, extLink: false });
        expect(waitingRetryReason(item('T0412', { why: 'held', host: 'www.mza.cz', can: true }), 'en')!.text)
            .toBe(getStringsForLang('en').live.waitingRetry.held('www.mza.cz'));
    });

    it('an unknown why: the research\'s says as it is; without says, no line; no retry, no line', () => {
        expect(waitingRetryReason(item('T0412', { why: 'archive-closed', says: 'archiv má do 1. 12. zavřeno', can: true }), 'cs'))
            .toEqual({ text: 'archiv má do 1. 12. zavřeno', extLink: false });
        expect(waitingRetryReason(item('T0412', { why: 'archive-closed', can: true }), 'cs')).toBeNull();
        expect(waitingRetryReason(item('T0412', undefined), 'cs')).toBeNull();
    });

    it('went back and waits again: today, yesterday, an older day', () => {
        const held = (at: string) => waitingRetryReason(item('T0412', { why: 'held', host: 'www.mza.cz', can: true, again: { at } }), 'cs')!.text;
        expect(held(today)).toBe('Prohlížeč agenta zadržel stahování z www.mza.cz. Po povolení automatického stahování v profilu prohlížeče agenta je uloží agent sám – zkoušeno znovu 18:40, zase zadrženo.');
        expect(held(yesterday)).toMatch(/– zkoušeno znovu včera 18:40, zase zadrženo\.$/);
        expect(held(older)).toMatch(/– zkoušeno znovu 20\. ?11\. 18:40, zase zadrženo\.$/);
        expect(waitingRetryReason(item('T0412', { why: 'stopped', can: true, again: { at: today } }), 'cs')!.text)
            .toBe('Ukládání snímků se zastavilo, sezení agenta skončilo uprostřed – zkoušeno znovu 18:40, zase čeká.');
        // An unknown why: says carries it already.
        expect(waitingRetryReason(item('T0412', { why: 'archive-closed', says: 'zavřeno; zkoušeno znovu 18:40, zase čeká', can: true, again: { at: today } }), 'cs')!.text)
            .toBe('zavřeno; zkoušeno znovu 18:40, zase čeká');
    });

    it('when: today, yesterday, tomorrow, another day; nothing for no time', () => {
        expect(retryWhenText(today, NOW, 'cs')).toBe('18:40');
        expect(retryWhenText(yesterday, NOW, 'cs')).toBe('včera 18:40');
        expect(retryWhenText(tomorrow, NOW, 'cs')).toBe('zítra 9:12');
        expect(retryWhenText(older, NOW, 'cs')).toMatch(/^20\. ?11\. 18:40$/);
        expect(retryWhenText(yesterday, NOW, 'en')).toMatch(/^yesterday 6:40\sPM$/);
        expect(retryWhenText(undefined, NOW, 'cs')).toBe('');
        expect(retryWhenText('never', NOW, 'cs')).toBe('');
    });

    it('the limit instead of the button', () => {
        expect(waitingRetryLimitText({ can: false, until: tomorrow }, 'cs')).toBe('Agentovi jde vrátit znovu zítra 9:12 – 3 pokusy za 24 hodin.');
        expect(waitingRetryLimitText({ can: true }, 'cs')).toBeNull();
    });
});

describe('the count on the button', () => {
    it('images, read only, both, nothing', () => {
        expect(waitingRetryCount({ images: 2 }, 'cs')).toBe('· 2 snímky');
        expect(waitingRetryCount({ images: 5 }, 'cs')).toBe('· 5 snímků');
        expect(waitingRetryCount({ images: 1 }, 'en')).toBe('· 1 image');
        expect(waitingRetryCount({ screen: true }, 'cs')).toBe('· jen čtení');
        expect(waitingRetryCount({ images: 2, screen: true }, 'cs')).toBe('· 2 snímky, jen čtení');
        expect(waitingRetryCount({ images: 3 }, 'pl')).toBe('· 3 skany');
        expect(waitingRetryCount({ images: 3 }, 'de')).toBe('· 3 Bilder');
        expect(waitingRetryCount({}, 'cs')).toBe('');
        expect(waitingRetryCount({ images: 0 }, 'cs')).toBe('');
    });
});

describe('a place\'s Retry all with the agent', () => {
    const NOW = new Date(2026, 10, 24, 19, 0).getTime();
    const tomorrow = new Date(2026, 10, 25, 9, 12).toISOString();
    const later = new Date(2026, 10, 25, 11, 0).toISOString();

    it('counts every item of the place: can, images added up, at least, read only, later', () => {
        const group = [
            item('T0412', { why: 'held', host: 'www.mza.cz', images: 3, can: true }),
            item('T0413', { why: 'held', host: 'www.mza.cz', images: 7, can: true }),
            item('T0414', { why: 'held', host: 'www.mza.cz', can: false, until: later }),
            item('T0415', { why: 'held', host: 'www.mza.cz', can: false, until: tomorrow }),
            item('T0416', undefined),
        ];
        const g = waitingGroupRetry(group);
        expect(g).toEqual({ n: 2, images: 10, atLeast: false, readOnly: false, later: { n: 2, until: tomorrow } });
        expect(groupRetryCountText(g, 'cs')).toBe('(2 úkoly, 10 snímků)');
        expect(groupRetryConfirmText(g, 'cs')).toBe('Vrátit agentovi 2 úkoly (10 snímků)? Na řadu přijdou hned.');
        expect(groupRetryAria('Moravský zemský archiv v Brně', g, 'cs')).toBe('Zkusit znovu vše přes agenta · Moravský zemský archiv v Brně · 2 úkoly, 10 snímků');
        expect(groupRetryLaterText(g, 'cs', NOW)).toBe('2 jde až zítra 9:12');
    });

    it('at least: an item without a number (not read on screen); read only: all on screen; neither number nor screen', () => {
        const some = waitingGroupRetry([
            item('T0412', { why: 'held', images: 4, can: true }), item('T0413', { why: 'stopped', can: true }),
            item('T0414', { why: 'screen', screen: true, can: true }),
        ]);
        expect(some).toMatchObject({ n: 3, images: 4, atLeast: true, readOnly: false, later: null });
        expect(groupRetryCountText(some, 'cs')).toBe('(3 úkoly, nejméně 4 snímky)');
        const screen = waitingGroupRetry([item('T0412', { why: 'screen', screen: true, can: true }), item('T0413', { why: 'screen', screen: true, can: true })]);
        expect(screen).toMatchObject({ n: 2, readOnly: true, atLeast: false });
        expect(groupRetryCountText(screen, 'cs')).toBe('(2 úkoly, jen čtení)');
        const unknown = waitingGroupRetry([item('T0412', { why: 'stopped', can: true }), item('T0413', { why: 'stopped', can: true })]);
        expect(groupRetryCountText(unknown, 'en')).toBe('(2 tasks)');
        expect(groupRetryConfirmText(unknown, 'en')).toBe('Return 2 tasks to the agent? They go to the front of the queue.');
        expect(groupRetryLaterText(unknown, 'en', NOW)).toBeNull();
        expect(waitingGroupRetry([])).toEqual({ n: 0, images: 0, atLeast: false, readOnly: false, later: null });
    });

    it('a shared Now line: two or more items with retry, all for the same reason and host', () => {
        const same = [
            item('T0412', { why: 'held', host: 'www.mza.cz', images: 3, can: true }),
            item('T0413', { why: 'held', host: 'www.mza.cz', can: false, until: tomorrow }),
            item('T0416', undefined),
        ];
        expect(waitingGroupRetryReason(same, 'cs', NOW)).toEqual({
            text: getStringsForLang('cs').live.waitingRetry.held('www.mza.cz'), extLink: false, ids: ['T0412', 'T0413'],
        });
        expect(waitingGroupRetryReason(same.slice(0, 1), 'cs', NOW)).toBeNull();
        expect(waitingGroupRetryReason([same[0], item('T0414', { why: 'held', host: 'actapublica.eu', can: true })], 'cs', NOW)).toBeNull();
        expect(waitingGroupRetryReason([same[0], item('T0414', { why: 'stopped', can: true })], 'cs', NOW)).toBeNull();
        // One went back already: its line differs.
        expect(waitingGroupRetryReason([same[0], item('T0414', { why: 'held', host: 'www.mza.cz', can: true, again: { at: tomorrow } })], 'cs', NOW)).toBeNull();
        // An unknown why without says has no line to share.
        expect(waitingGroupRetryReason([item('T0412', { why: 'x', can: true }), item('T0413', { why: 'x', can: true })], 'cs', NOW)).toBeNull();
    });
});

describe('the writes and their answers', () => {
    let calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(body), { status });
        }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('an item: POST <token>/waiting/<T…> {do: retry, expect}', async () => {
        answer(200, { task: 'T0412', state: 'open', head: HEAD, parent: 'd'.repeat(40) });
        expect(await retryWaiting(BASE, 'T0412', { expect: AT })).toEqual({ ok: true, task: 'T0412', head: HEAD, parent: 'd'.repeat(40) });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/\/waiting\/T0412\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'retry', expect: AT });
        answer(200, { task: 'T0412' });
        await retryWaiting(BASE, 'T0412');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'retry' });
    });

    it('an item not sent: not a task', async () => {
        answer(200, {});
        expect(await retryWaiting(BASE, 'P0001')).toMatchObject({ ok: false, code: 'bad' });
        expect(calls).toHaveLength(0);
    });

    it('a place: POST <token>/group/<key> {do: retry}, the key encoded, retried listed', async () => {
        answer(200, { retried: ['T0412', 'T0413', 'bogus'], group: 'repo:R0003', head: HEAD });
        expect(await retryGroup(BASE, 'repo:R0003')).toEqual({ ok: true, retried: ['T0412', 'T0413'], group: 'repo:R0003', head: HEAD });
        expect(calls[0].url).toMatch(/\/group\/repo%3AR0003\?app=/);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'retry' });
        answer(200, { retried: [], group: 'repo:R0003', head: HEAD });
        expect(await retryGroup(BASE, 'repo:R0003')).toMatchObject({ ok: true, retried: [] });
        expect(await retryGroup(BASE, '  ')).toMatchObject({ ok: false, code: 'bad' });
    });

    it('refusals: 409 changed / not / limit with until, 404, 403, 400, a failure, no answer', async () => {
        answer(409, { error: 'changed', code: 'waiting.changed', params: { id: 'T0412', at: '2026-11-24T11:00:00.000Z' } });
        expect(await retryWaiting(BASE, 'T0412', { expect: AT })).toMatchObject({ ok: false, code: 'changed', status: 409, at: '2026-11-24T11:00:00.000Z' });
        answer(409, { error: 'not', code: 'retry.not', params: { id: 'T0412' } });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'not' });
        answer(409, { error: 'limit', code: 'retry.limit', params: { id: 'T0412', until: '2026-11-25T09:12:00.000Z' } });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'limit', until: '2026-11-25T09:12:00.000Z' });
        answer(404, { error: 'none', code: 'waiting.none', params: { id: 'T0412' } });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'none', status: 404 });
        answer(404, { error: 'none', code: 'group.none', params: { group: 'repo:R0003' } });
        expect(await retryGroup(BASE, 'repo:R0003')).toMatchObject({ ok: false, code: 'none' });
        answer(409, { error: 'limit', code: 'retry.limit', params: { id: 'T0413', until: '2026-11-25T09:12:00.000Z' } });
        expect(await retryGroup(BASE, 'repo:R0003')).toMatchObject({ ok: false, code: 'limit', until: '2026-11-25T09:12:00.000Z' });
        answer(403, { error: 'app only', code: 'app.only' });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'app-only', status: 403 });
        answer(400, { error: 'bad', code: 'waiting.bad-body' });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'bad' });
        answer(503, { error: 'busy', code: 'research.busy' });
        expect(await retryWaiting(BASE, 'T0412')).toMatchObject({ ok: false, code: 'down', status: 503 });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await retryWaiting(BASE, 'T0412')).toEqual({ ok: false, code: 'down', status: 0, reason: '' });
        expect(await retryGroup(BASE, 'repo:R0003')).toEqual({ ok: false, code: 'down', status: 0, reason: '' });
    });

    it('the parsers alone: a 200 without a body, the params beside the code, an unknown 409', () => {
        expect(waitingRetryReply(200, null)).toMatchObject({ ok: false, code: 'down' });
        expect(groupRetryReply(200, 'x')).toMatchObject({ ok: false, code: 'down' });
        expect(waitingRetryReply(409, { code: 'retry.limit', until: '2026-11-25T09:12:00.000Z' })).toMatchObject({ code: 'limit', until: '2026-11-25T09:12:00.000Z' });
        expect(waitingRetryReply(409, { code: 'retry.limit', params: { until: 'later' } })).toEqual({ ok: false, code: 'limit', status: 409, reason: '' });
        expect(waitingRetryReply(409, { code: 'something.else' })).toMatchObject({ code: 'down' });
        expect(waitingRetryReply(500, {})).toMatchObject({ code: 'down' });
    });
});

describe('the refusals as said', () => {
    const NOW = new Date(2026, 10, 24, 19, 0).getTime();
    const tomorrow = new Date(2026, 10, 25, 9, 12).toISOString();
    it('an item\'s row and a place\'s toast', () => {
        expect(waitingRetryRefusedText({ code: 'changed' }, 'cs', NOW)).toBe('Úkol mezitím čeká na něco jiného; nevráceno.');
        expect(waitingRetryRefusedText({ code: 'not' }, 'cs', NOW)).toBe('Úkol už se vrátit nedá.');
        expect(waitingRetryRefusedText({ code: 'none' }, 'cs', NOW)).toBe('Úkol už se vrátit nedá.');
        expect(waitingRetryRefusedText({ code: 'down' }, 'cs', NOW)).toBe('Výzkum teď neodpovídá; nic se nevrátilo.');
        expect(waitingRetryRefusedText({ code: 'app-only' }, 'cs', NOW)).toBe('Výzkum teď neodpovídá; nic se nevrátilo.');
        expect(waitingRetryRefusedText({ code: 'limit', until: tomorrow }, 'cs', NOW)).toBe('Agentovi jde vrátit znovu zítra 9:12 – 3 pokusy za 24 hodin.');
        expect(groupRetryFailText({ code: 'down' }, 'cs', NOW)).toBe('Nic se nevrátilo: výzkum teď neodpovídá; nic se nevrátilo');
        expect(groupRetryFailText({ code: 'limit', until: tomorrow }, 'en', NOW)).toMatch(/^Nothing was returned: can go back to the agent again tomorrow 9:12\sAM – 3 attempts in 24 hours$/);
    });
});
