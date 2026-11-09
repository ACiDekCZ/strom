/**
 * The bridge client of re-verification (spec 065): /verify, /verify/bulk,
 * /facts/confirm and `/status verify` — request shape, feature gating, typed
 * answers and refusals.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    postVerify, postVerifyBulk, postFactConfirm, verifyRequestBody, verifyBulkRequestBody, factConfirmRequestBody,
    verifyReply, verifyBulkReply, factConfirmReply, verifyStatusSaid, researchFactRef, researchLineageRef,
    postVerifyStop, verifyStopRequestBody, verifyStopReply, VERIFY_STOP_FEATURE,
} from '../research-verify.js';
import { sanitizeLiveStatus } from '../research-link.js';
import { getStringsForLang } from '../strings.js';

const BASE = 'http://127.0.0.1:4711/abc123';
const ALL = ['verify', 'verify.bulk', 'facts.confirm'];
const HEAD = 'a'.repeat(40);
const PARENT = 'b'.repeat(40);

interface Call { url: string; init: RequestInit }

function stubFetch(status: number, body: unknown): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }));
    return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('refs', () => {
    it('fact and lineage ids', () => {
        expect(researchFactRef('E0012')).toBe('E0012');
        expect(researchFactRef(' E5 ')).toBe('E5');
        expect(researchFactRef('P12')).toBeNull();
        expect(researchFactRef(12)).toBeNull();
        expect(researchLineageRef('G3')).toBe('G3');
        expect(researchLineageRef('G')).toBeNull();
    });
});

describe('bodies', () => {
    it('/verify takes exactly one valid target', () => {
        expect(verifyRequestBody({ person: 'P12' })).toEqual({ person: 'P12' });
        expect(verifyRequestBody({ family: 'F3' }, true)).toEqual({ family: 'F3', dry: true });
        expect(verifyRequestBody({ fact: 'E0042' })).toEqual({ fact: 'E0042' });
        expect(verifyRequestBody({ person: 'F3' })).toBeNull();
        expect(verifyRequestBody({ person: 'P1', fact: 'E1' } as never)).toBeNull();
        expect(verifyRequestBody({} as never)).toBeNull();
    });

    it('/verify/bulk checks scope, of, order, try and budget', () => {
        expect(verifyBulkRequestBody({ scope: 'tree' })).toEqual({ scope: 'tree' });
        expect(verifyBulkRequestBody({ scope: 'line', of: 'P7', order: 'weakest', try: 10, budget: 5.5, dry: true }))
            .toEqual({ scope: 'line', of: 'P7', order: 'weakest', try: 10, budget: 5.5, dry: true });
        expect(verifyBulkRequestBody({ scope: 'lineage', of: 'G2' })).toEqual({ scope: 'lineage', of: 'G2' });
        expect(verifyBulkRequestBody({ scope: 'tree', of: 'P7' })).toEqual({ scope: 'tree' });
        expect(verifyBulkRequestBody({ scope: 'everything' } as never)).toBeNull();
        expect(verifyBulkRequestBody({ scope: 'line', of: 'X1' })).toBeNull();
        expect(verifyBulkRequestBody({ scope: 'tree', order: 'random' } as never)).toBeNull();
        expect(verifyBulkRequestBody({ scope: 'tree', try: 0 })).toBeNull();
        expect(verifyBulkRequestBody({ scope: 'tree', try: 1.5 })).toBeNull();
        expect(verifyBulkRequestBody({ scope: 'tree', budget: -1 })).toBeNull();
    });

    it('/facts/confirm', () => {
        expect(factConfirmRequestBody('E9', true)).toEqual({ fact: 'E9', confirm: true });
        expect(factConfirmRequestBody('E9', false)).toEqual({ fact: 'E9', confirm: false });
        expect(factConfirmRequestBody('birth', true)).toBeNull();
    });
});

describe('requests', () => {
    it('POST /verify: a simple request with the JSON body', async () => {
        const calls = stubFetch(200, {
            ok: true, task: 'T0042', head: HEAD, parent: PARENT,
            facts: [{ fact: 'E1', kind: 'BIRT', how: 'read' }, { fact: 'E2', kind: 'DEAT', how: 'search' }, { fact: 'x', kind: 'BIRT', how: 'read' }],
            estimate: { sessions: 1, usd: 0.4 },
        });
        const res = await postVerify(BASE, { person: 'P12' }, { features: ALL });
        expect(calls).toHaveLength(1);
        expect(calls[0].url.startsWith(`${BASE}/verify`)).toBe(true);
        expect(calls[0].url).not.toContain('/verify/bulk');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.mode).toBe('cors');
        expect(calls[0].init.credentials).toBe('omit');
        expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ person: 'P12' });
        expect(res).toEqual({
            ok: true, task: 'T0042', head: HEAD, parent: PARENT,
            facts: [{ fact: 'E1', kind: 'BIRT', how: 'read' }, { fact: 'E2', kind: 'DEAT', how: 'search' }],
            estimate: { sessions: 1, usd: 0.4 },
        });
    });

    it('a dry run makes no task', async () => {
        const calls = stubFetch(200, { ok: true, task: null, facts: [], estimate: { sessions: 2 }, head: HEAD });
        const res = await postVerify(BASE, { fact: 'E7' }, { features: ALL, dry: true });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ fact: 'E7', dry: true });
        expect(res).toEqual({ ok: true, task: null, facts: [], estimate: { sessions: 2 }, head: HEAD });
    });

    it('each fact says the record it goes by, and a task made its place in the queue', async () => {
        const record = { source: 'S0042', title: 'Parish register of Kvasilov, births 1840–1860', page: 'img. 112' };
        stubFetch(200, {
            ok: true, task: 'T0043', position: 2, head: HEAD,
            facts: [
                { fact: 'E1', kind: 'BIRT', how: 'read', record },
                { fact: 'E2', kind: 'DEAT', how: 'search', record: { source: 'S7', title: 'Family tree of the Ozubec family' } },
                // A record with no source of the research, or no title, is not said.
                { fact: 'E3', kind: 'BURI', how: 'search', record: { source: 'x', title: 'Something' } },
                { fact: 'E4', kind: 'CHR', how: 'read', record: { source: 'S8', title: '' } },
            ],
            estimate: { sessions: 1 },
        });
        expect(await postVerify(BASE, { person: 'P12' }, { features: ALL })).toEqual({
            ok: true, task: 'T0043', position: 2, head: HEAD,
            facts: [
                { fact: 'E1', kind: 'BIRT', how: 'read', record },
                { fact: 'E2', kind: 'DEAT', how: 'search', record: { source: 'S7', title: 'Family tree of the Ozubec family' } },
                { fact: 'E3', kind: 'BURI', how: 'search' },
                { fact: 'E4', kind: 'CHR', how: 'read' },
            ],
            estimate: { sessions: 1 },
        });
        // A dry run has the records too, and no place (no task made); a place that is not a whole number ≥ 1 is not one.
        expect(verifyReply(200, { ok: true, task: null, position: 1, facts: [{ fact: 'E1', kind: 'BIRT', how: 'read', record }], estimate: {} }))
            .toEqual({ ok: true, task: null, facts: [{ fact: 'E1', kind: 'BIRT', how: 'read', record }], estimate: { sessions: 0 }, head: '' });
        for (const position of [0, -1, 1.5, '2']) {
            const res = verifyReply(200, { ok: true, task: 'T1', position, facts: [], estimate: {} });
            expect(res.ok && res.position).toBeUndefined();
        }
    });

    it('POST /verify/stop: all by default, or the bulk tasks only', async () => {
        expect(VERIFY_STOP_FEATURE).toBe('verify.stop');
        const features = [...ALL, VERIFY_STOP_FEATURE];
        const calls = stubFetch(200, { ok: true, dropped: 3, facts: 14, head: HEAD, parent: PARENT });
        expect(await postVerifyStop(BASE, { features })).toEqual({ ok: true, dropped: 3, facts: 14, head: HEAD, parent: PARENT });
        expect(calls[0].url.startsWith(`${BASE}/verify/stop`)).toBe(true);
        expect(calls[0].init.method).toBe('POST');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({});
        const bulk = stubFetch(200, { ok: true, dropped: 0, facts: 0, head: HEAD });
        expect(await postVerifyStop(BASE, { features, scope: 'bulk' })).toEqual({ ok: true, dropped: 0, facts: 0, head: HEAD });
        expect(JSON.parse(bulk[0].init.body as string)).toEqual({ scope: 'bulk' });
        // Refusals.
        stubFetch(409, { ok: false, code: 'verify.archive', text: 'An archive does not verify.' });
        expect(await postVerifyStop(BASE, { features, scope: 'all' }))
            .toEqual({ ok: false, code: 'verify.archive', status: 409, reason: 'An archive does not verify.' });
        stubFetch(503, { ok: false, code: 'research.busy' });
        expect(await postVerifyStop(BASE, { features })).toMatchObject({ ok: false, code: 'busy', status: 503 });
        stubFetch(409, { ok: false, code: 'verify.nothing' });
        expect(await postVerifyStop(BASE, { features })).toMatchObject({ ok: false, code: 'unknown', status: 409 });
        // Not sent without the feature, or with a scope the research does not take.
        const none = stubFetch(200, { ok: true });
        expect(await postVerifyStop(BASE, { features: ALL })).toEqual({ ok: false, code: 'unsupported', status: 0, reason: '' });
        expect(await postVerifyStop(BASE, { features, scope: 'line' as never })).toEqual({ ok: false, code: 'invalid', status: 0, reason: '' });
        expect(none).toHaveLength(0);
        expect(verifyStopRequestBody()).toEqual({});
        expect(verifyStopReply(200, { ok: true, dropped: -2, facts: 'x' })).toEqual({ ok: true, dropped: 0, facts: 0, head: '' });
    });

    it('POST /verify/bulk', async () => {
        const calls = stubFetch(200, {
            ok: true, people: 4, facts: 11, tasks: ['T1', 'T2', 'T1', 'bad'], left: 3, estimate: { sessions: 3, usd: 2 }, head: HEAD,
        });
        const res = await postVerifyBulk(BASE, { scope: 'line', of: 'P1', try: 5 }, { features: ALL });
        expect(calls[0].url.startsWith(`${BASE}/verify/bulk`)).toBe(true);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ scope: 'line', of: 'P1', try: 5 });
        expect(res).toEqual({ ok: true, people: 4, facts: 11, tasks: ['T1', 'T2'], left: 3, estimate: { sessions: 3, usd: 2 }, head: HEAD });
    });

    it("a bulk round's `left` is the people not taken, and the dialog says people in every language", () => {
        const say = (lang: 'en' | 'cs' | 'de' | 'pl', n: number): string => getStringsForLang(lang).verify.bulkLeft(n);
        expect(say('en', 1)).toBe('1 more person for another round');
        expect(say('en', 3)).toBe('3 more people for another round');
        expect([say('cs', 1), say('cs', 3), say('cs', 5)])
            .toEqual(['1 další osoba na další kolo', '3 další osoby na další kolo', '5 dalších osob na další kolo']);
        expect([say('de', 1), say('de', 3)]).toEqual(['1 weitere Person für eine weitere Runde', '3 weitere Personen für eine weitere Runde']);
        expect([say('pl', 1), say('pl', 3), say('pl', 5)])
            .toEqual(['1 kolejna osoba na następną rundę', '3 kolejne osoby na następną rundę', '5 kolejnych osób na następną rundę']);
    });

    it('POST /facts/confirm', async () => {
        const calls = stubFetch(200, { ok: true, fact: 'E3', owner: 'P9', confirmed: '2026-11-08', head: HEAD });
        const res = await postFactConfirm(BASE, 'E3', true, { features: ALL });
        expect(calls[0].url.startsWith(`${BASE}/facts/confirm`)).toBe(true);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ fact: 'E3', confirm: true });
        expect(res).toEqual({ ok: true, fact: 'E3', owner: 'P9', confirmed: '2026-11-08', head: HEAD });
        stubFetch(200, { ok: true, fact: 'E3', owner: 'F2', head: HEAD });
        expect(await postFactConfirm(BASE, 'E3', false, { features: ALL })).toEqual({ ok: true, fact: 'E3', owner: 'F2', head: HEAD });
    });

    it('nothing is sent without the feature, or with a body the research would not take', async () => {
        const calls = stubFetch(200, { ok: true });
        expect(await postVerify(BASE, { person: 'P1' }, { features: ['verify.bulk', 'facts.confirm'] }))
            .toEqual({ ok: false, code: 'unsupported', status: 0, reason: '' });
        expect(await postVerify(BASE, { person: 'P1' }, { features: null }))
            .toMatchObject({ ok: false, code: 'unsupported' });
        expect(await postVerifyBulk(BASE, { scope: 'tree' }, { features: ['verify'] }))
            .toMatchObject({ ok: false, code: 'unsupported' });
        expect(await postFactConfirm(BASE, 'E1', true, { features: ['verify'] }))
            .toMatchObject({ ok: false, code: 'unsupported' });
        expect(await postVerify(BASE, { person: 'nope' }, { features: ALL })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postVerifyBulk(BASE, { scope: 'x' } as never, { features: ALL })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postFactConfirm(BASE, 'birth', true, { features: ALL })).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
    });

    it('no answer is network, never a throw', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await postVerify(BASE, { person: 'P1' }, { features: ALL })).toEqual({ ok: false, code: 'network', status: 0, reason: '' });
        expect(await postVerifyBulk(BASE, { scope: 'tree' }, { features: ALL })).toMatchObject({ ok: false, code: 'network' });
        expect(await postFactConfirm(BASE, 'E1', true, { features: ALL })).toMatchObject({ ok: false, code: 'network' });
    });

    it('a second ask while one runs gets the same answer', async () => {
        const calls = stubFetch(200, { ok: true, task: 'T5', facts: [], estimate: { sessions: 1 }, head: HEAD });
        const [a, b] = await Promise.all([
            postVerify(BASE, { person: 'P1' }, { features: ALL }),
            postVerify(BASE, { person: 'P1' }, { features: ALL }),
        ]);
        expect(calls).toHaveLength(1);
        expect(a).toEqual(b);
    });
});

describe('refusals', () => {
    const cases: [number, string, string][] = [
        [400, 'verify.invalid', 'verify.invalid'],
        [404, 'verify.unknown', 'verify.unknown'],
        [409, 'verify.archive', 'verify.archive'],
        [409, 'verify.nothing', 'verify.nothing'],
        [409, 'verify.retracted', 'verify.retracted'],
        [503, 'research.busy', 'busy'],
        [423, 'tree.locked', 'locked'],
        [409, 'something.else', 'unknown'],
        [404, 'verify.archive', 'unknown'],
        [500, '', 'unknown'],
    ];
    for (const [status, code, want] of cases) {
        it(`/verify ${status} ${code || '(none)'} → ${want}`, () => {
            expect(verifyReply(status, { ok: false, code, text: 'Said  by the bridge.' }))
                .toEqual({ ok: false, code: want, status, reason: 'Said by the bridge.' });
            expect(verifyBulkReply(status, { ok: false, code, error: 'err' })).toMatchObject({ ok: false, code: want, status });
        });
    }

    const confirmCases: [number, string, string][] = [
        [400, 'factconfirm.invalid', 'factconfirm.invalid'],
        [404, 'factconfirm.unknown', 'factconfirm.unknown'],
        [409, 'factconfirm.retracted', 'factconfirm.retracted'],
        [409, 'factconfirm.merged', 'factconfirm.merged'],
        [503, 'research.busy', 'busy'],
        [409, 'verify.nothing', 'unknown'],
    ];
    for (const [status, code, want] of confirmCases) {
        it(`/facts/confirm ${status} ${code} → ${want}`, () => {
            expect(factConfirmReply('E1', status, { ok: false, code })).toEqual({ ok: false, code: want, status, reason: '' });
        });
    }

    it('a 2xx that is no answer, or about another fact, is unknown', () => {
        expect(verifyReply(200, null)).toMatchObject({ ok: false, code: 'unknown' });
        expect(verifyBulkReply(200, { ok: false })).toMatchObject({ ok: false, code: 'unknown' });
        expect(factConfirmReply('E1', 200, { ok: true, fact: 'E2', head: HEAD })).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('a refusal through the request', async () => {
        stubFetch(409, { ok: false, code: 'verify.nothing', text: 'All facts are confirmed.' });
        expect(await postVerify(BASE, { family: 'F1' }, { features: ALL }))
            .toEqual({ ok: false, code: 'verify.nothing', status: 409, reason: 'All facts are confirmed.' });
    });
});

describe('a busy research (503 research.busy)', () => {
    /** Busy for the first `busy` asks, then the answer; every ask kept. */
    function stubBusy(busy: number, answer: unknown): Call[] {
        const calls: Call[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            const refused = calls.length <= busy;
            return new Response(JSON.stringify(refused ? { ok: false, code: 'research.busy', error: 'the research is busy' } : answer),
                { status: refused ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
        }));
        return calls;
    }
    const BULK = { ok: true, people: 2, facts: 4, tasks: [], left: 0, estimate: { sessions: 1 }, head: HEAD };

    it('a dry run is asked again after a short pause, and its answer comes', async () => {
        const calls = stubBusy(2, BULK);
        expect(await postVerifyBulk(BASE, { scope: 'tree', dry: true }, { features: ALL, busyRetryMs: [1, 1, 1] }))
            .toMatchObject({ ok: true, facts: 4 });
        expect(calls).toHaveLength(3);
        const one = stubBusy(1, { ok: true, task: null, facts: [], estimate: { sessions: 1 }, head: HEAD });
        expect(await postVerify(BASE, { person: 'P1' }, { features: ALL, dry: true, busyRetryMs: [1] })).toMatchObject({ ok: true });
        expect(one).toHaveLength(2);
    });

    it('busy each time: the refusal after the last pause', async () => {
        const calls = stubBusy(99, BULK);
        expect(await postVerifyBulk(BASE, { scope: 'tree', dry: true }, { features: ALL, busyRetryMs: [1, 1] }))
            .toMatchObject({ ok: false, code: 'busy', status: 503 });
        expect(calls).toHaveLength(3);
    });

    it('a start (no dry run) is asked once: the caller decides', async () => {
        const calls = stubBusy(1, BULK);
        expect(await postVerifyBulk(BASE, { scope: 'tree' }, { features: ALL, busyRetryMs: [1] })).toMatchObject({ ok: false, code: 'busy' });
        expect(calls).toHaveLength(1);
    });

    it('another refusal is not asked again', async () => {
        const calls = stubFetch(409, { ok: false, code: 'verify.nothing' });
        expect(await postVerifyBulk(BASE, { scope: 'tree', dry: true }, { features: ALL, busyRetryMs: [1, 1] }))
            .toMatchObject({ ok: false, code: 'verify.nothing' });
        expect(calls).toHaveLength(1);
    });
});

describe('/status verify', () => {
    const verify = { waiting: 3, asked: 1, images: 2, permission: 0, kept: 4, confirmed: 7, fix: { at: '2026-11-08T10:00:00Z', facts: 12, people: 3 } };

    it('read with the feature', () => {
        expect(verifyStatusSaid({ verify }, ['verify'])).toEqual({ verify });
        expect(verifyStatusSaid({ verify: { waiting: 'x', asked: -1, confirmed: 2 } }, ['verify']))
            .toEqual({ verify: { waiting: 0, asked: 0, images: 0, permission: 0, kept: 0, confirmed: 2 } });
        expect(verifyStatusSaid({ verify: { ...verify, fix: { at: 'never' } } }, ['verify']).verify?.fix).toBeUndefined();
    });

    it('a run of re-verification only with an ISO UTC time and whole counts', () => {
        const fixOf = (fix: unknown) => verifyStatusSaid({ verify: { ...verify, fix } }, ['verify']).verify?.fix;
        expect(fixOf({ at: '2026-11-08T22:41:07.123Z', facts: 0, people: 0 })).toEqual({ at: '2026-11-08T22:41:07.123Z', facts: 0, people: 0 });
        // A day alone, a local time, an offset or a date in another shape is not it.
        expect(fixOf({ at: '2026-11-08', facts: 12, people: 3 })).toBeUndefined();
        expect(fixOf({ at: '2026-11-08T22:41:07', facts: 12, people: 3 })).toBeUndefined();
        expect(fixOf({ at: '2026-11-08T22:41:07+01:00', facts: 12, people: 3 })).toBeUndefined();
        expect(fixOf({ at: 'Sun, 08 Nov 2026 22:41:07 GMT', facts: 12, people: 3 })).toBeUndefined();
        expect(fixOf({ at: '2026-13-40T22:41:07Z', facts: 12, people: 3 })).toBeUndefined();
        // Counts must be whole numbers ≥ 0.
        expect(fixOf({ at: '2026-11-08T22:41:07Z', facts: 1.5, people: 3 })).toBeUndefined();
        expect(fixOf({ at: '2026-11-08T22:41:07Z', facts: 12, people: -1 })).toBeUndefined();
        expect(fixOf({ at: '2026-11-08T22:41:07Z', facts: '12', people: 3 })).toBeUndefined();
        expect(fixOf({ at: '2026-11-08T22:41:07Z', facts: 12 })).toBeUndefined();
    });

    it('not without the feature, nor for an archive or a waiting tree', () => {
        expect(verifyStatusSaid({ verify }, ['tree.state'])).toEqual({});
        expect(verifyStatusSaid({ verify }, null)).toEqual({});
        expect(verifyStatusSaid({ verify, tree: { state: 'archive' } }, ['verify', 'tree.state'])).toEqual({});
        expect(verifyStatusSaid({ verify, tree: { state: 'waiting' } }, ['verify', 'tree.state'])).toEqual({});
        expect(verifyStatusSaid({ verify, tree: { kind: 'archive' } }, ['verify', 'tree.kind'])).toEqual({});
        expect(verifyStatusSaid({ verify, tree: { state: 'research' } }, ['verify', 'tree.state'])).toEqual({ verify });
        expect(verifyStatusSaid({ verify: 5 }, ['verify'])).toEqual({});
    });

    it('in the bridge status', () => {
        const status = sanitizeLiveStatus({ ok: true, tree: { id: 'r1', name: 'Tree' }, features: ['verify'], verify });
        expect(status?.verify).toEqual(verify);
        expect(sanitizeLiveStatus({ ok: true, tree: { id: 'r1', name: 'Tree' }, features: [], verify })?.verify).toBeUndefined();
    });
});
