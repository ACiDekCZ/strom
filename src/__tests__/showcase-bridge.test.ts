/**
 * The showcase research's bridge (spec 143 K4): its snapshot answered in the
 * page at `<origin>/__showcase/<research>` — GET of status, a status part,
 * log, material and queue (narrowed as the bridge narrows it), an unknown GET
 * 404, every write refused (403 `showcase.read-only`), the live events one
 * `hello`; kept for the next start, gone with its tree; the page's fetch
 * untouched while no snapshot is kept. All data is invented (the Berg family).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
    keepShowcaseResearch, forgetShowcaseResearch, restoreShowcaseResearch, showcaseSnapshot, resetShowcaseBridgeForTest,
    showcaseBridgeAnswer, showcaseFetchInstalled, showcaseEventSource, showcaseQueuePage, showcaseUnanswered, SHOWCASE_READ_ONLY,
} from '../showcase-bridge.js';
import { parseLiveBridge, showcaseBridgeBase, showcaseResearchKnown, withAppVersion } from '../research-link.js';
import { storedResearchBridge, hasStoredResearchBridge, noteResearchWaiting, storedResearchWaiting } from '../research-device.js';
import { EXCERPT_FEATURE } from '../research-images.js';
import { MATERIAL_THUMB_FEATURE } from '../materials.js';
import type { ShowcaseResearch } from '../showcase-format.js';

const ORIGIN = 'https://stromapp.info';
const RID = '5e6f7a8b-1c2d-4e3f-9a0b-bergovi00001';

function fakeLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

function snapshot(): ShowcaseResearch {
    return {
        id: RID,
        status: {
            name: 'Bergovi', head: 'h1', features: ['queue.page', EXCERPT_FEATURE, MATERIAL_THUMB_FEATURE, 'media.app', 'media.known', 'waiting.groups', 'status.parts', 'sources.confirm', 'facts.confirm', 'facts.confirm.value'],
            tree: { kind: 'research', state: 'research' }, queueCounts: { next: 3 }, waiting: [],
        },
        log: { entries: [{ at: '2026-10-02T09:00:00Z', text: 'Matrika Dolní Lhota přečtena' }] },
        material: { files: [{ id: 'I0001', name: 'svatba-1924.jpg' }] },
        queue: {
            rev: 'q7', head: 'h1',
            items: [
                { id: 'T0001', state: 'next', text: 'Ověřit narození Anny Bergové', taskKind: 'verify', person: 'I12' },
                { id: 'T0002', state: 'next', text: 'Najít sňatek Karla Berga', taskKind: 'records' },
                { id: 'T0003', state: 'next', text: 'Sčítání 1921, Dolní Lhota', taskKind: 'census' },
                { id: 'T0004', state: 'later', text: 'Dům č. 14', taskKind: 'house' },
                { id: 'T0005', state: 'next', text: 'Něco nového', taskKind: 'brandnew' },
            ],
        },
    };
}

let pageFetch: typeof fetch;

beforeEach(() => {
    pageFetch = vi.fn(async () => new Response('page', { status: 200 })) as unknown as typeof fetch;
    globalThis.fetch = pageFetch;
});

afterEach(() => {
    resetShowcaseBridgeForTest();
    vi.unstubAllGlobals();
});

async function body(r: Response): Promise<unknown> {
    return JSON.parse(await r.text());
}

describe('the snapshot answered', () => {
    beforeEach(() => keepShowcaseResearch(snapshot(), ORIGIN));

    it('answers the reads of the snapshot through the page fetch', async () => {
        const base = showcaseBridgeBase(RID);
        expect(base).toBe(`${ORIGIN}/__showcase/${RID.toLowerCase()}`);
        const status = await fetch(`${base}/status`);
        expect(status.status).toBe(200);
        expect((await body(status) as { name: string }).name).toBe('Bergovi');
        expect(await body(await fetch(`${base}/log`))).toEqual(snapshot().log);
        expect(await body(await fetch(`${base}/material`))).toEqual(snapshot().material);
        const queue = await body(await fetch(`${base}/queue?from=0&count=2`)) as { items: { id: string }[]; total: number; next?: number; rev: string };
        expect(queue.items.map(i => i.id)).toEqual(['T0001', 'T0002']);
        expect(queue.total).toBe(5);
        expect(queue.next).toBe(2);
        expect(queue.rev).toBe('q7');
        expect(pageFetch).not.toHaveBeenCalled();
    });

    it('answers a part of the status', async () => {
        const r = showcaseBridgeAnswer('GET', RID, 'status/queue');
        expect(r.status).toBe(200);
        const part = await body(r) as Record<string, unknown>;
        expect(part.part).toBe('queue');
        expect(typeof part.rev).toBe('string');
        expect(showcaseBridgeAnswer('GET', RID, 'status/no-such-part').status).toBe(404);
    });

    it('leaves out of the status what the shim cannot answer, and the writes offered by a feature alone', async () => {
        const st = await body(showcaseBridgeAnswer('GET', RID, 'status')) as { features: string[] };
        expect(st.features).toEqual(['queue.page', 'waiting.groups', 'status.parts']);
        expect(showcaseUnanswered(EXCERPT_FEATURE)).toBe(true);
        expect(showcaseUnanswered('media.list')).toBe(true);
        expect(showcaseUnanswered('queue.page')).toBe(false);
    });

    it('refuses every write, and nothing goes to the network', async () => {
        const base = showcaseBridgeBase(RID);
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            const r = await fetch(`${base}/sync`, { method, body: '{}' });
            expect(r.status).toBe(403);
            expect(await body(r)).toEqual({ error: SHOWCASE_READ_ONLY });
        }
        const req = await fetch(new Request(`${base}/queue/T0001`, { method: 'POST', body: '{}' }));
        expect(req.status).toBe(403);
        expect(pageFetch).not.toHaveBeenCalled();
    });

    it('says 404 to an unknown GET, as an older bridge', async () => {
        const base = showcaseBridgeBase(RID);
        expect((await fetch(`${base}/tree.ged`)).status).toBe(404);
        expect((await fetch(`${base}/media/I0001`)).status).toBe(404);
        expect(showcaseBridgeAnswer('HEAD', RID, 'status').status).toBe(200);
        expect(pageFetch).not.toHaveBeenCalled();
    });

    it('lets any other address go to the network', async () => {
        await fetch('https://stromapp.info/research/');
        await fetch(`${ORIGIN}/__showcase/another-research/status`);
        expect(pageFetch).toHaveBeenCalledTimes(2);
    });

    it('is a bridge to the research code: parsed, stored, never stamped', () => {
        const base = showcaseBridgeBase(RID);
        expect(showcaseResearchKnown(RID)).toBe(true);
        expect(parseLiveBridge(base)?.status).toBe(`${base}/status`);
        expect(parseLiveBridge(base)?.events).toBe(`${base}/events`);
        expect(storedResearchBridge(RID)?.base).toBe(base);
        expect(hasStoredResearchBridge(RID)).toBe(true);
        expect(withAppVersion(`${base}/status`)).toBe(`${base}/status`);
    });

    it('keeps nothing of what waits in the showcase research as waiting here', () => {
        const ls = fakeLocalStorage();
        vi.stubGlobal('localStorage', ls);
        noteResearchWaiting(RID, [{ id: 'W1', what: 'Která Anna Bergová?', at: '2026-10-01T10:00:00Z' } as never]);
        expect(ls.length).toBe(0);
        expect(storedResearchWaiting(RID)).toBeNull();
    });

    it('says one hello with the status on its events', async () => {
        vi.useFakeTimers();
        try {
            const src = showcaseEventSource(`${showcaseBridgeBase(RID)}/events`);
            expect(src).not.toBeNull();
            const heard: unknown[] = [];
            src!.addEventListener('hello', ev => heard.push(JSON.parse((ev as MessageEvent).data)));
            src!.addEventListener('status', () => heard.push('status'));
            vi.runAllTimers();
            expect(heard).toHaveLength(1);
            expect((heard[0] as { name: string }).name).toBe('Bergovi');
            expect(showcaseEventSource('http://127.0.0.1:47900/abc/events')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('the queue narrowed as the bridge narrows it', () => {
    const queue = snapshot().queue!;
    const ids = (p: Record<string, unknown>) => (p.items as { id: string }[]).map(i => i.id);

    it('by kind, `other` beyond the first list and beyond `known`', () => {
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('kind=verify')))).toEqual(['T0001']);
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('kind=census')))).toEqual(['T0003']);
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('kind=other')))).toEqual(['T0003', 'T0004', 'T0005']);
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('kind=other&known=census,house')))).toEqual(['T0005']);
    });

    it('by state and by words, accents aside', () => {
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('state=later')))).toEqual(['T0004']);
        const found = showcaseQueuePage(queue, new URLSearchParams('q=bergove'));
        expect(ids(found)).toEqual(['T0001']);
        expect(found.q).toBe('bergove');
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('q=nikde')))).toEqual([]);
        expect(ids(showcaseQueuePage(queue, new URLSearchParams('from=4&count=10')))).toEqual(['T0005']);
    });
});

describe('kept and forgotten', () => {
    it('leaves the page fetch as it was while no snapshot is kept', async () => {
        expect(showcaseFetchInstalled()).toBe(false);
        expect(globalThis.fetch).toBe(pageFetch);
        expect(showcaseResearchKnown(RID)).toBe(false);
        expect(parseLiveBridge(`${ORIGIN}/__showcase/${RID}`)).toBeNull();
        keepShowcaseResearch(snapshot(), ORIGIN);
        expect(showcaseFetchInstalled()).toBe(true);
        forgetShowcaseResearch(RID);
        expect(showcaseFetchInstalled()).toBe(false);
        expect(globalThis.fetch).toBe(pageFetch);
        expect(storedResearchBridge(RID)).toBeNull();
    });

    it('is kept for the next start, only for a tree still here', () => {
        const ls = fakeLocalStorage();
        vi.stubGlobal('localStorage', ls);
        keepShowcaseResearch(snapshot(), ORIGIN);
        keepShowcaseResearch({ ...snapshot(), id: 'other-showcase' }, ORIGIN);
        resetShowcaseBridgeForTest();
        expect(showcaseSnapshot(RID)).toBeNull();
        const back = restoreShowcaseResearch(id => id === RID.toLowerCase(), ORIGIN);
        expect(back.map(s => s.id)).toEqual([RID.toLowerCase()]);
        expect(showcaseSnapshot(RID)?.log).toEqual(snapshot().log);
        expect(ls.getItem(`strom-showcase-research:other-showcase`)).toBeNull();
        forgetShowcaseResearch(RID);
        expect(ls.length).toBe(0);
    });

    it('keeps it in memory when the browser stores nothing', () => {
        vi.stubGlobal('localStorage', { ...fakeLocalStorage(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
        keepShowcaseResearch(snapshot(), ORIGIN);
        expect(showcaseSnapshot(RID)).not.toBeNull();
        expect(showcaseResearchKnown(RID)).toBe(true);
    });
});
