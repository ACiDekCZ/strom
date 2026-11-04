/**
 * A slow research's bridge is not a stuck one (1104): a big research takes
 * seconds to say its status. One ask at a time per bridge, the ask may take
 * BRIDGE_ANSWER_MS, a caller in a hurry goes on with the last status known,
 * and only HUNG_AFTER_TIMEOUTS asks in a row without an answer say "not
 * responding". A bridge that is not there (connection refused), turns the
 * address down (404) or is busy (503) is said at once, as before. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { BRIDGE_ANSWER_MS, HUNG_AFTER_TIMEOUTS, askOnce, tallyBridgeAsk, waitAtMost } from '../bridge-ask.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';

type Answer = { up: boolean; why: string; busy: boolean; at: number; status: { head?: string } | null } | null;
type Ui = {
    askResearchBridge(researchId: string, timeout: number): Promise<{ head?: string } | null>;
    researchBridgeAnswer(researchId: string): Answer;
    researchConnectionNote(researchId: string): { title: string } | null;
    researchBridgeMoved(researchId: string): void;
};

describe('tallyBridgeAsk: a run of asks without an answer in time', () => {
    it('one or two timeouts keep the last state, the third says not responding, any answer starts again', () => {
        let strikes = 0;
        const seen: string[] = [];
        for (const outcome of ['timeout', 'timeout', 'timeout', 'timeout', 'answer', 'timeout', 'error', 'timeout'] as const) {
            const t = tallyBridgeAsk(strikes, outcome);
            strikes = t.strikes;
            seen.push(t.hung ? 'hung' : t.keepLast ? 'keep' : 'take');
        }
        expect(HUNG_AFTER_TIMEOUTS).toBe(3);
        expect(seen).toEqual(['keep', 'keep', 'hung', 'hung', 'take', 'keep', 'take', 'keep']);
    });
});

describe('askOnce / waitAtMost', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a second caller while one ask is on its way gets that one; after it, a new one starts', async () => {
        let started = 0;
        let finish: (v: string) => void = () => {};
        const start = (): Promise<string> => { started++; return new Promise(r => { finish = r; }); };
        const a = askOnce('k', start);
        const b = askOnce('k', start);
        expect(started).toBe(1);
        finish('one');
        expect(await a).toBe('one');
        expect(await b).toBe('one');
        void askOnce('k', start);
        expect(started).toBe(2);
        finish('two');
    });

    it('a caller waits at most its own time; the ask goes on', async () => {
        let finish: (v: number) => void = () => {};
        const p = new Promise<number>(r => { finish = r; });
        const quick = waitAtMost(p, 1500);
        await vi.advanceTimersByTimeAsync(1500);
        expect(await quick).toEqual({ done: false });
        finish(7);
        expect(await waitAtMost(p, 1500)).toEqual({ done: true, value: 7 });
    });
});

describe('askResearchBridge: slow is not stuck', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    /** How the fake bridge answers the next asks: in ms with a head, never, refused, or a code. */
    let mode: { kind: 'answer'; ms: number; head: string } | { kind: 'hang' } | { kind: 'refused' } | { kind: 'code'; code: number };
    let asks: number;

    beforeAll(async () => {
        const { researchUiMethods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> };
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        methods = { ...researchUiMethods, ...researchSyncMethods };
    }, 60000);

    beforeEach(() => {
        vi.useFakeTimers();
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        asks = 0;
        mode = { kind: 'answer', ms: 0, head: 'a1' };
        vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) => {
            asks++;
            const m = mode;
            if (m.kind === 'refused') return Promise.reject(new TypeError('Failed to fetch'));
            return new Promise<Response>((resolve, reject) => {
                const abort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                init.signal?.addEventListener('abort', abort);
                if (m.kind === 'hang') return;
                const body = m.kind === 'code'
                    ? new Response(JSON.stringify({ error: 'x' }), { status: m.code, headers: { 'Retry-After': '5' } })
                    : new Response(JSON.stringify({ tree: { id: TREE, name: 'Fíškovi' }, head: m.head, links: ['open'] }),
                        { status: 200, headers: { 'content-type': 'application/json' } });
                setTimeout(() => resolve(body), m.kind === 'answer' ? m.ms : 0);
            });
        });
        store.set(`strom-research-bridge:${TREE}`, JSON.stringify({ base: BRIDGE, accepts: { sync: { auto: 'off' } } }));
    });

    afterEach(async () => {
        // An ask still on its way ends (its own limit) before the next test asks.
        await vi.advanceTimersByTimeAsync(BRIDGE_ANSWER_MS + 1000);
        (ui() as Ui).researchBridgeMoved(TREE);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function ui(): Ui {
        return { ...methods, activeResearchId: () => TREE, activeResearchArchive: () => false,
            researchSyncLink: () => null, refreshResearchSyncUi: () => {} } as unknown as Ui;
    }

    async function ask(u: Ui, timeout: number, run = timeout): Promise<{ head?: string } | null> {
        const p = u.askResearchBridge(TREE, timeout);
        await vi.advanceTimersByTimeAsync(run);
        return p;
    }

    it('an answer after 6 s (a big research): a quick caller goes on with the last status, the answer is taken in when it comes', async () => {
        const u = ui();
        expect((await ask(u, 3000, 10))?.head).toBe('a1');
        mode = { kind: 'answer', ms: 6000, head: 'b2' };
        // The old 3 s limit: it would have said "not responding" here.
        expect((await ask(u, 3000))?.head).toBe('a1');
        expect(u.researchBridgeAnswer(TREE)?.up).toBe(true);
        expect(u.researchConnectionNote(TREE)).toBeNull();
        await vi.advanceTimersByTimeAsync(3000);
        expect(u.researchBridgeAnswer(TREE)?.status?.head).toBe('b2');
        expect(asks).toBe(2);
    });

    it('never two asks of one bridge at once: callers meanwhile wait for the one on its way', async () => {
        const u = ui();
        mode = { kind: 'answer', ms: 8000, head: 'c3' };
        const all = [u.askResearchBridge(TREE, 1500), u.askResearchBridge(TREE, 4000), u.askResearchBridge(TREE, BRIDGE_ANSWER_MS + 1000)];
        await vi.advanceTimersByTimeAsync(8000);
        const got = await Promise.all(all);
        expect(asks).toBe(1);
        // The first two had no status known yet when their time was up; the patient one got the answer.
        expect(got.map(s => s?.head ?? null)).toEqual([null, null, 'c3']);
        expect(u.researchBridgeAnswer(TREE)?.status?.head).toBe('c3');
    });

    it('no answer at all: up with its last status through two asks, "not responding" after the third', async () => {
        const u = ui();
        await ask(u, 3000, 10);
        mode = { kind: 'hang' };
        for (let i = 1; i < HUNG_AFTER_TIMEOUTS; i++) {
            expect((await ask(u, BRIDGE_ANSWER_MS + 1000))?.head).toBe('a1');
            expect(u.researchBridgeAnswer(TREE)?.up).toBe(true);
            expect(u.researchConnectionNote(TREE)).toBeNull();
        }
        expect(await ask(u, BRIDGE_ANSWER_MS + 1000)).toBeNull();
        expect(u.researchBridgeAnswer(TREE)).toMatchObject({ up: false, why: 'hung' });
        expect(u.researchConnectionNote(TREE)?.title).toBe("The research doesn't respond");
        expect(asks).toBe(1 + HUNG_AFTER_TIMEOUTS);
        // It answers again: up, the run starts over (one more timeout keeps it up).
        mode = { kind: 'answer', ms: 100, head: 'd4' };
        expect((await ask(u, 3000, 200))?.head).toBe('d4');
        mode = { kind: 'hang' };
        await ask(u, BRIDGE_ANSWER_MS + 1000);
        expect(u.researchBridgeAnswer(TREE)?.up).toBe(true);
    });

    it('quick callers do not count as timeouts: only the bridge\'s own ask does', async () => {
        const u = ui();
        await ask(u, 3000, 10);
        mode = { kind: 'hang' };
        // Ten quick asks within 14 s: one ask on its way, none run out yet.
        for (let i = 0; i < 10; i++) expect((await ask(u, 1400))?.head).toBe('a1');
        expect(asks).toBe(2);
        expect(u.researchBridgeAnswer(TREE)?.up).toBe(true);
    });

    it('a bridge that is not there is said at once, as before (no run of timeouts)', async () => {
        const u = ui();
        await ask(u, 3000, 10);
        mode = { kind: 'refused' };
        expect(await ask(u, 3000, 10)).toBeNull();
        expect(u.researchBridgeAnswer(TREE)).toMatchObject({ up: false, why: '' });
    });

    it('401/403/404: the address turned down at once; 503: busy at once', async () => {
        const u = ui();
        await ask(u, 3000, 10);
        mode = { kind: 'code', code: 404 };
        expect(await ask(u, 3000, 10)).toBeNull();
        expect(u.researchBridgeAnswer(TREE)).toMatchObject({ up: false, why: 'refused' });
        mode = { kind: 'code', code: 503 };
        expect(await ask(u, 3000, 10)).toBeNull();
        expect(u.researchBridgeAnswer(TREE)).toMatchObject({ up: false, busy: true });
    });
});
