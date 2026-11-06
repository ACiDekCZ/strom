/**
 * "Research on" (spec 064): the bridge's `/status.live` read only with its
 * feature, the bodies of `POST /live` and their replies, the link that starts
 * the bridge quietly, and what is remembered of a bridge while it is off.
 * Invented data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    sanitizeLiveStatus, sanitizeLiveIdle, sanitizeLiveEnd, researchSchemeUrl, researchUrlMark, researchLinkMark,
} from '../research-link.js';
import {
    liveIdleBody, LIVE_STOP_BODY, liveIdleReply, liveStopReply, postLiveIdle, postLiveStop,
    storedLiveState, noteLiveStatus, noteLiveEnded, liveEndKind,
} from '../research-live.js';

const UUID = '6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8';
const BASE = 'http://127.0.0.1:47123/abcdefabcdefabcdefabcdef';

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

describe('/status.live', () => {
    it('is read only with the feature live.idle', () => {
        const live = { idleMinutes: 0, idleChoices: [0, 120] };
        expect(sanitizeLiveStatus({ tree: UUID, features: ['live.idle'], live })!.live).toEqual(live);
        expect(sanitizeLiveStatus({ tree: UUID, features: ['live.stop'], live })!.live).toBeUndefined();
        expect(sanitizeLiveStatus({ tree: UUID, live })!.live).toBeUndefined();
    });

    it('keeps a value set in the terminal as it is, and the default choices when none come', () => {
        expect(sanitizeLiveIdle({ idleMinutes: 30 })).toEqual({ idleMinutes: 30, idleChoices: [0, 120] });
        expect(sanitizeLiveIdle({ idleMinutes: 120, idleChoices: [120, 0, 0, 'x', -5, 1.5] })).toEqual({ idleMinutes: 120, idleChoices: [120, 0] });
    });

    it('drops what is not a whole number of minutes the bridge takes', () => {
        expect(sanitizeLiveIdle({ idleMinutes: -1 })).toBeNull();
        expect(sanitizeLiveIdle({ idleMinutes: 10081 })).toBeNull();
        expect(sanitizeLiveIdle({ idleMinutes: '120' })).toBeNull();
        expect(sanitizeLiveIdle(null)).toBeNull();
        expect(sanitizeLiveIdle([0])).toBeNull();
    });
});

describe('the end of a bridge', () => {
    it('tells a switch-off from the app from one in the terminal', () => {
        expect(sanitizeLiveEnd({ reason: 'stopped', back: false, by: 'app' })).toEqual({ back: false, reason: 'stopped', by: 'app' });
        expect(sanitizeLiveEnd({ reason: 'stopped', back: false })).toEqual({ back: false, reason: 'stopped' });
        expect(sanitizeLiveEnd({ reason: 'stopped', by: 'someone' }).by).toBeUndefined();
    });

    it('keeps only a manual end and one after a time without work', () => {
        expect(liveEndKind('stopped')).toBe('stopped');
        expect(liveEndKind('idle')).toBe('idle');
        expect(liveEndKind('restart')).toBeNull();
        expect(liveEndKind('gone')).toBeNull();
        expect(liveEndKind('')).toBeNull();
    });
});

describe('the bodies of POST /live', () => {
    it('sends the computer\'s choice as whole minutes', () => {
        expect(liveIdleBody(0)).toEqual({ idleMinutes: 0 });
        expect(liveIdleBody(120)).toEqual({ idleMinutes: 120 });
        expect(liveIdleBody(1.5)).toBeNull();
        expect(liveIdleBody(-1)).toBeNull();
        expect(liveIdleBody(10081)).toBeNull();
    });

    it('switches off with do=stop', () => {
        expect(JSON.stringify(LIVE_STOP_BODY)).toBe('{"do":"stop"}');
    });
});

describe('the replies of POST /live', () => {
    it('reads the choice back from 200', () => {
        expect(liveIdleReply(200, { live: { idleMinutes: 120, idleChoices: [0, 120] } }))
            .toEqual({ ok: true, live: { idleMinutes: 120, idleChoices: [0, 120] } });
    });

    it('takes the stop only with stopping: true', () => {
        expect(liveStopReply(202, { stopping: true })).toEqual({ ok: true });
        expect(liveStopReply(202, {})).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('types the refusals the bridge names', () => {
        expect(liveIdleReply(400, { code: 'live.body', error: 'Bad body.' })).toEqual({ ok: false, code: 'invalid', status: 400, reason: 'Bad body.' });
        expect(liveIdleReply(403, { code: 'app.only' })).toMatchObject({ code: 'refused' });
        expect(liveStopReply(503, { code: 'research.busy' })).toMatchObject({ code: 'busy' });
        expect(liveIdleReply(500, { code: 'live.failed' })).toMatchObject({ code: 'failed' });
        expect(liveStopReply(404, null)).toMatchObject({ code: 'unknown', status: 404 });
    });
});

describe('the requests', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('POSTs the choice to <token>/live as a simple request', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ live: { idleMinutes: 0, idleChoices: [0, 120] } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await postLiveIdle(BASE, 0);
        expect(res).toEqual({ ok: true, live: { idleMinutes: 0, idleChoices: [0, 120] } });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.startsWith(`${BASE}/live`)).toBe(true);
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('omit');
        expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/);
        expect(JSON.parse(init.body as string)).toEqual({ idleMinutes: 0 });
    });

    it('POSTs the stop, and sends nothing for a choice the bridge does not take', async () => {
        const fetchMock = vi.fn(async () => new Response('{"stopping":true}', { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await postLiveStop(BASE)).toEqual({ ok: true });
        expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ do: 'stop' });
        expect(await postLiveIdle(BASE, 2.5)).toMatchObject({ ok: false, code: 'invalid' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('answers network without a reply', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await postLiveStop(BASE)).toEqual({ ok: false, code: 'network', status: 0, reason: '' });
    });
});

describe('the link that switches the bridge on', () => {
    it('adds only do=start, and has no mark (no window, no terminal)', () => {
        const url = researchSchemeUrl('live', { tree: UUID, liveDo: 'start' })!;
        expect(url).toBe(`strom-research://live?tree=${UUID}&do=start`);
        expect(researchSchemeUrl('live', { tree: UUID })).toBe(`strom-research://live?tree=${UUID}`);
        expect(researchUrlMark(url)).toBe('none');
        expect(researchLinkMark('live')).toBe('none');
    });

    it('goes by a second install\'s scheme too', () => {
        expect(researchSchemeUrl('live', { tree: UUID, liveDo: 'start' }, 'strom-research-beta'))
            .toBe(`strom-research-beta://live?tree=${UUID}&do=start`);
    });
});

describe('what is remembered while the bridge is off', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the switch features, the scheme and the choice from the last status', () => {
        const changed = noteLiveStatus(UUID, {
            features: ['sync.ids', 'live.idle', 'live.stop', 'live.start'], linkScheme: 'strom-research-beta',
            live: { idleMinutes: 120, idleChoices: [0, 120] },
        });
        expect(changed).toBe(true);
        expect(storedLiveState(UUID.toUpperCase())).toEqual({
            features: ['live.idle', 'live.stop', 'live.start'], scheme: 'strom-research-beta',
            idle: { idleMinutes: 120, idleChoices: [0, 120] },
        });
        expect(noteLiveStatus(UUID, {
            features: ['live.idle', 'live.stop', 'live.start'], linkScheme: 'strom-research-beta',
            live: { idleMinutes: 120, idleChoices: [0, 120] },
        })).toBe(false);
    });

    it('remembers how it ended until it answers again', () => {
        noteLiveStatus(UUID, { features: ['live.stop'] });
        noteLiveEnded(UUID, 'stopped', 'app', 1000);
        expect(storedLiveState(UUID)).toEqual({ features: ['live.stop'], ended: { kind: 'stopped', by: 'app', at: 1000 } });
        noteLiveEnded(UUID, 'idle', undefined, 2000);
        expect(storedLiveState(UUID)!.ended).toEqual({ kind: 'idle', at: 2000 });
        noteLiveStatus(UUID, { features: ['live.stop'] });
        expect(storedLiveState(UUID)!.ended).toBeUndefined();
    });

    it('reads nothing broken', () => {
        expect(storedLiveState(UUID)).toBeNull();
        localStorage.setItem(`strom-research-live:${UUID}`, '{broken');
        expect(storedLiveState(UUID)).toBeNull();
        localStorage.setItem(`strom-research-live:${UUID}`, JSON.stringify({ features: ['live.stop', 'evil', 3], ended: { kind: 'gone' } }));
        expect(storedLiveState(UUID)).toEqual({ features: ['live.stop'] });
    });
});
