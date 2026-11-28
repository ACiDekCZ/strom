/**
 * The day a request went out (spec 149, K057): the bridge's `waiting.sentDay`, the day in a Sent's body
 * (an item's and a place's), the change of a sent item's day, the refusal of a day it does not take
 * (`waiting.bad-date`), `sentDay` of the status shown as it is, and the days counted by the calendar —
 * never a day beside it around midnight or in another time zone. Invented offices and tasks only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { sanitizeWaiting } from '../research-link.js';
import {
    WAITING_SENT_DAY_FEATURE, WAITING_SENT_FEATURE, applyWaitingPending, calendarDay, calendarDaysBetween, localDayOf, postGroupSent, postWaitingSent,
    sentDayAllowed, settleWaitingPending, waitingDayAgo, waitingDayShort, waitingDayShown, waitingSentDayOf, waitingSentReply, waitingWrites,
    type WaitingPending,
} from '../research-waiting-write.js';
import { deviceResearchFeatures } from '../device/device-research-data.js';
import { readOverviewAction } from '../windows/overview-window.js';

const BASE = 'http://127.0.0.1:47321/0123456789abcdef';
const HEAD = 'c'.repeat(40);
const OFFICE = { key: 'to:Úřad Vzorov', name: 'Úřad Vzorov', kind: 'office' };
const letter = (extra: Record<string, unknown> = {}) => ({
    id: 'T0001', what: 'Dopis na úřad', at: '2026-11-01T08:00:00Z', kind: 'letter', section: 'letter', group: OFFICE,
    actions: ['sent', 'chat'], ...extra,
});

describe('the bridge takes the day (waiting.sentDay)', () => {
    it('only with waiting.sent and waiting.sentDay', () => {
        expect(waitingWrites({ features: [WAITING_SENT_FEATURE], accepts: null }).sentDay).toBe(false);
        expect(waitingWrites({ features: [WAITING_SENT_DAY_FEATURE], accepts: null }).sentDay).toBe(false);
        expect(waitingWrites({ features: [WAITING_SENT_FEATURE, WAITING_SENT_DAY_FEATURE], accepts: null }).sentDay).toBe(true);
    });

    it('the phone reads it from the status', () => {
        expect(deviceResearchFeatures({ features: ['glance'] }).sentDay).toBeUndefined();
        expect(deviceResearchFeatures({ features: ['glance', 'waiting.sentDay'] }).sentDay).toBe(true);
    });
});

describe('the status: sentDay', () => {
    it('kept only as a real day of the calendar, with phase sent', () => {
        const [w] = sanitizeWaiting([letter({ phase: 'sent', sentAt: '2026-11-24T12:00:00.000Z', sentDay: '2026-11-24' })], true);
        expect(w).toMatchObject({ phase: 'sent', sentAt: '2026-11-24T12:00:00.000Z', sentDay: '2026-11-24' });
        for (const bad of ['2026-02-30', '24. 11. 2026', '２０２６-１１-２４', 20261124, '2026-11-24T00:00']) {
            expect(sanitizeWaiting([letter({ phase: 'sent', sentAt: '2026-11-24T12:00:00.000Z', sentDay: bad })], true)[0].sentDay).toBeUndefined();
        }
        // Not sent: no day.
        expect(sanitizeWaiting([letter({ sentDay: '2026-11-24' })], true)[0].sentDay).toBeUndefined();
    });

    it('the day shown: sentDay as said; without it the day of sentAt as the research reads it', () => {
        expect(waitingSentDayOf({ sentDay: '2026-11-24', sentAt: '2026-11-25T23:30:00.000Z' })).toBe('2026-11-24');
        // A day given is kept as its noon UTC: that day in every time zone.
        expect(waitingSentDayOf({ sentAt: '2026-11-24T12:00:00.000Z' })).toBe('2026-11-24');
        expect(waitingSentDayOf({ sentAt: '2026-11-24' })).toBe('2026-11-24');
        expect(waitingSentDayOf({})).toBe('');
        // A moment: its day on this calendar.
        const moment = new Date(2026, 10, 24, 23, 50).toISOString();
        expect(waitingSentDayOf({ sentAt: moment })).toBe('2026-11-24');
    });
});

describe('days by the calendar (fixed clocks around midnight)', () => {
    afterEach(() => vi.useRealTimers());

    it('a day never shown as the day beside it', () => {
        for (const day of ['2026-11-24', '2026-01-01', '2026-12-31', '2028-02-29']) {
            expect(waitingDayShort(day, 'cs')).toBe(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).toLocaleDateString('cs', { day: 'numeric', month: 'numeric' }));
        }
        expect(waitingDayShort('2026-11-24', 'cs')).toBe('24. 11.');
        expect(waitingDayShort('2026-02-30', 'cs')).toBe('');
    });

    it('"N days ago" counts days of the calendar, not 24 hours', () => {
        vi.useFakeTimers();
        // Two minutes after midnight: yesterday is a day ago though only minutes passed.
        vi.setSystemTime(new Date(2026, 10, 25, 0, 2));
        expect(calendarDaysBetween('2026-11-24', localDayOf(Date.now()))).toBe(1);
        expect(waitingDayAgo('2026-11-24', Date.now(), 'en')).toBe('yesterday');
        expect(waitingDayAgo('2026-11-25', Date.now(), 'en')).toBe('today');
        // Two minutes before midnight: still the same day.
        vi.setSystemTime(new Date(2026, 10, 24, 23, 58));
        expect(waitingDayAgo('2026-11-24', Date.now(), 'en')).toBe('today');
        expect(waitingDayAgo('2026-10-25', Date.now(), 'en')).toBe('30 days ago');
        // Across the change of summer time (Europe, 25 Oct 2026) still whole days.
        expect(calendarDaysBetween('2026-10-24', '2026-10-26')).toBe(2);
    });

    it('the day a Sent takes: up to today, not one still to come', () => {
        const now = new Date(2026, 10, 24, 23, 58).getTime();
        expect(sentDayAllowed('2026-11-24', now)).toBe(true);
        expect(sentDayAllowed('2025-01-03', now)).toBe(true);
        expect(sentDayAllowed('2026-11-25', now)).toBe(false);
        expect(sentDayAllowed('2026-02-30', now)).toBe(false);
        expect(sentDayAllowed('', now)).toBe(false);
        expect(calendarDay('2026-11-24')).toBe('2026-11-24');
    });

    it('a day of another year is said whole', () => {
        const now = new Date(2026, 10, 24, 12).getTime();
        expect(waitingDayShown('2026-11-20', now, 'cs')).toBe('20. 11.');
        expect(waitingDayShown('2025-12-30', now, 'cs')).toBe('30. 12. 2025');
    });
});

describe('the requests with a day', () => {
    let calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(body), { status });
        }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('an item: {"do":"sent","at":"YYYY-MM-DD"}; the answer says the day', async () => {
        answer(200, { sent: ['T0001'], task: 'T0001', phase: 'sent', sentAt: '2026-11-24T12:00:00.000Z', sentDay: '2026-11-24', head: HEAD });
        expect(await postWaitingSent(BASE, 'T0001', 'sent', { at: '2026-11-24' }))
            .toEqual({ ok: true, sent: ['T0001'], task: 'T0001', phase: 'sent', sentDay: '2026-11-24', head: HEAD });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'sent', at: '2026-11-24' });
        // Without a day: as before.
        answer(200, { sent: ['T0001'], head: HEAD });
        await postWaitingSent(BASE, 'T0001', 'sent');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'sent' });
    });

    it('a malformed day, or a day with unsent: not sent at all', async () => {
        answer(200, { sent: [], head: HEAD });
        for (const at of ['2026-2-3', '2026-02-30', '24.11.2026', '']) {
            expect(await postWaitingSent(BASE, 'T0001', 'sent', { at })).toMatchObject({ ok: false, code: 'invalid' });
        }
        expect(await postWaitingSent(BASE, 'T0001', 'unsent', { at: '2026-11-24' })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postGroupSent(BASE, OFFICE.key, { at: '2026-13-01' })).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
    });

    it('a place: one day for all of them', async () => {
        answer(200, { sent: ['T0002', 'T0003'], group: OFFICE.key, sentDay: '2026-11-20', head: HEAD });
        expect(await postGroupSent(BASE, OFFICE.key, { at: '2026-11-20' })).toMatchObject({ ok: true, sent: ['T0002', 'T0003'], sentDay: '2026-11-20' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'sent', at: '2026-11-20' });
    });

    it('400 waiting.bad-date: its own code (nothing written); other 400s stay bad-body', () => {
        expect(waitingSentReply(400, { error: 'bad date', code: 'waiting.bad-date', params: { at: '2026-12-01' } })).toMatchObject({ ok: false, code: 'bad-date', status: 400 });
        expect(waitingSentReply(400, { code: 'waiting.bad-body' })).toMatchObject({ ok: false, code: 'bad-body' });
    });
});

describe('the row moved at once with its day', () => {
    it('a sent item\'s day changed: shown at once, held until the research says that day', () => {
        const raw = sanitizeWaiting([letter({ phase: 'sent', sentAt: '2026-11-24T08:00:00.000Z', sentDay: '2026-11-24' })], true);
        const pending = new Map<string, WaitingPending>([['T0001', { phase: 'sent', sentAt: '2026-11-20T12:00:00.000Z', sentDay: '2026-11-20', until: Date.now() + 10_000 }]]);
        expect(applyWaitingPending(raw, pending)[0].sentDay).toBe('2026-11-20');
        settleWaitingPending(pending, raw);
        expect(pending.has('T0001')).toBe(true);
        const told = sanitizeWaiting([letter({ phase: 'sent', sentAt: '2026-11-20T12:00:00.000Z', sentDay: '2026-11-20' })], true);
        settleWaitingPending(pending, told);
        expect(pending.has('T0001')).toBe(false);
    });

    it('an older research (no sentDay): the phase is enough', () => {
        const raw = sanitizeWaiting([letter({ phase: 'sent', sentAt: '2026-11-24T08:00:00.000Z' })], true);
        const pending = new Map<string, WaitingPending>([['T0001', { phase: 'sent', sentAt: '2026-11-24T08:00:00.000Z', sentDay: '2026-11-24', until: Date.now() + 10_000 }]]);
        settleWaitingPending(pending, raw);
        expect(pending.has('T0001')).toBe(false);
    });
});

describe('the overview\'s own window passes the day', () => {
    it('a day only as a real day; a change only with a day', () => {
        expect(readOverviewAction('waiting-sent', { itemId: 'T0001', day: '2026-11-24' })).toEqual({ action: 'waiting-sent', args: { itemId: 'T0001', day: '2026-11-24' } });
        expect(readOverviewAction('waiting-sent', { itemId: 'T0001', day: '2026-11-24', change: true }))
            .toEqual({ action: 'waiting-sent', args: { itemId: 'T0001', day: '2026-11-24', change: true } });
        expect(readOverviewAction('waiting-sent', { itemId: 'T0001' })).toEqual({ action: 'waiting-sent', args: { itemId: 'T0001' } });
        expect(readOverviewAction('waiting-sent', { itemId: 'T0001', day: '2026-02-30' })).toBeNull();
        expect(readOverviewAction('waiting-sent', { itemId: 'T0001', change: true })).toBeNull();
        expect(readOverviewAction('waiting-group-sent', { group: OFFICE.key, day: '2026-11-20' })).toEqual({ action: 'waiting-group-sent', args: { group: OFFICE.key, day: '2026-11-20' } });
    });
});
