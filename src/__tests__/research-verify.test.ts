/**
 * The bridge client of re-verification (spec 065): /verify, /verify/bulk,
 * /facts/confirm and `/status verify` — request shape, feature gating, typed
 * answers and refusals.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    postVerify, postVerifyBulk, postFactConfirm, verifyRequestBody, verifyBulkRequestBody, factConfirmRequestBody,
    verifyReply, verifyBulkReply, factConfirmReply, verifyStatusSaid, researchFactRef, researchLineageRef,
} from '../research-verify.js';
import { sanitizeLiveStatus } from '../research-link.js';

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

    it('POST /verify/bulk', async () => {
        const calls = stubFetch(200, {
            ok: true, people: 4, facts: 11, tasks: ['T1', 'T2', 'T1', 'bad'], left: 3, estimate: { sessions: 3, usd: 2 }, head: HEAD,
        });
        const res = await postVerifyBulk(BASE, { scope: 'line', of: 'P1', try: 5 }, { features: ALL });
        expect(calls[0].url.startsWith(`${BASE}/verify/bulk`)).toBe(true);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ scope: 'line', of: 'P1', try: 5 });
        expect(res).toEqual({ ok: true, people: 4, facts: 11, tasks: ['T1', 'T2'], left: 3, estimate: { sessions: 3, usd: 2 }, head: HEAD });
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

describe('/status verify', () => {
    const verify = { waiting: 3, asked: 1, images: 2, permission: 0, kept: 4, confirmed: 7, fix: { at: '2026-11-08T10:00:00Z', facts: 12, people: 3 } };

    it('read with the feature', () => {
        expect(verifyStatusSaid({ verify }, ['verify'])).toEqual({ verify });
        expect(verifyStatusSaid({ verify: { waiting: 'x', asked: -1, confirmed: 2 } }, ['verify']))
            .toEqual({ verify: { waiting: 0, asked: 0, images: 0, permission: 0, kept: 0, confirmed: 2 } });
        expect(verifyStatusSaid({ verify: { ...verify, fix: { at: 'never' } } }, ['verify']).verify?.fix).toBeUndefined();
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
