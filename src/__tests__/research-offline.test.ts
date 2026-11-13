/**
 * Work outside the research's directions (spec 038 K7): the branches of
 * `/status.offLine`, a task's reason and own place in the queue, the growing
 * branch in Awaiting action, and the typed writes of the choices.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    sanitizeLiveStatus, sanitizeOffLine, sanitizeQueue, sanitizeQueueWhy, sanitizeWaiting,
} from '../research-link.js';
import {
    setBranchMode, setOffLineTree, setTaskOrder, answerBranchWaiting, fetchBranchTasks, restoreTaskOrder, sanitizeTaskOrderWas,
} from '../research-directions-write.js';
import { setLanguage, strings } from '../strings.js';

const BRANCH = {
    id: 'B-P0031', person: 'P0031', via: { person: 'P0017', rel: 'sibling' }, nearest: 'G0003', tasks: 14, persons: 6,
    samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }, { id: 'bad', text: 'x' }],
    mode: 'occasional', own: false, grows: true,
};

describe('/status.offLine', () => {
    it('reads the tree choice and its branches; a wrong branch is dropped', () => {
        const o = sanitizeOffLine({
            mode: 'occasional', own: true, share: 8, suggest: false, tasks: 24, queued: 21, ownTasks: 2,
            branches: [
                BRANCH,
                { ...BRANCH, id: 'B-P0040', person: 'P0040', mode: 'line', line: 'G0002', own: true, grows: undefined },
                { ...BRANCH, id: 'B-P0050', person: 'P0050', mode: 'line' },
                { ...BRANCH, id: 'X-1' },
                { ...BRANCH, mode: 'sometimes' },
            ],
        })!;
        expect(o).toMatchObject({ mode: 'occasional', own: true, share: 8, suggest: false, tasks: 24, queued: 21, ownTasks: 2 });
        expect(o.branches.map(b => b.id)).toEqual(['B-P0031', 'B-P0040']);
        expect(o.branches[0]).toEqual({
            id: 'B-P0031', person: 'P0031', via: { person: 'P0017', rel: 'sibling' }, nearest: 'G0003', tasks: 14, persons: 6,
            samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }], mode: 'occasional', own: false, grows: true,
        });
        expect(o.branches[1]).toMatchObject({ mode: 'line', line: 'G0002', own: true });
        expect(o.branches[1].grows).toBeUndefined();
    });

    it('defaults: share 10, suggest on; a wrong mode gives nothing', () => {
        expect(sanitizeOffLine({ mode: 'never' })).toMatchObject({ mode: 'never', own: false, share: 10, suggest: true, branches: [] });
        expect(sanitizeOffLine({ mode: 'sometimes' })).toBeNull();
    });

    it('the status carries it only from a research that announces offLine.branches', () => {
        const base = { tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'Fíškovi' }, head: 'abc1234', offLine: { mode: 'last', branches: [BRANCH] } };
        expect(sanitizeLiveStatus(base)!.offLine).toBeUndefined();
        expect(sanitizeLiveStatus({ ...base, features: ['offLine.branches'] })!.offLine?.branches).toHaveLength(1);
    });
});

describe('queue: why, branch, own place', () => {
    it('reads the five reasons and drops a wrong one', () => {
        expect(sanitizeQueueWhy({ kind: 'own', do: 'next' })).toEqual({ kind: 'own', do: 'next' });
        expect(sanitizeQueueWhy({ kind: 'line', research: 'G0003' })).toEqual({ kind: 'line', research: 'G0003' });
        expect(sanitizeQueueWhy({ kind: 'helps', research: 'G0003', by: 'branch' })).toEqual({ kind: 'helps', research: 'G0003', by: 'branch' });
        expect(sanitizeQueueWhy({ kind: 'off', mode: 'occasional', branch: 'B-P0031' })).toEqual({ kind: 'off', mode: 'occasional', branch: 'B-P0031' });
        expect(sanitizeQueueWhy({ kind: 'paused', research: 'G0005' })).toEqual({ kind: 'paused', research: 'G0005' });
        expect(sanitizeQueueWhy({ kind: 'off', mode: 'never' })).toBeNull();
        expect(sanitizeQueueWhy({ kind: 'helps', research: 'G0003', by: 'luck' })).toBeNull();
        expect(sanitizeQueueWhy({ kind: 'line' })).toBeNull();
        expect(sanitizeQueueWhy({ kind: 'history' })).toBeNull();
    });

    it('branch, own and why only from a research with branches', () => {
        const item = { id: 'T0412', text: 'Sňatek', state: 'next', offLine: 'occasional', branch: 'B-P0031', own: 'last', why: { kind: 'own', do: 'last' } };
        expect(sanitizeQueue([item], true, false)[0]).toEqual({ id: 'T0412', text: 'Sňatek', state: 'next' });
        expect(sanitizeQueue([item], true, true)[0]).toEqual({
            id: 'T0412', text: 'Sňatek', state: 'next', offLine: 'occasional', branch: 'B-P0031', own: 'last', why: { kind: 'own', do: 'last' },
        });
    });
});

describe('waiting: a growing branch', () => {
    const item = { id: 'W-B-P0031', kind: 'branch', branch: 'B-P0031', person: 'P0031', research: 'G0003', tasks: 14, persons: 6, at: '2026-11-03T08:10:00Z', what: 'Větev Alois Fíšek' };
    it('read with offLine.branches, under Decide', () => {
        const [w] = sanitizeWaiting([item], true, true);
        expect(w).toMatchObject({ id: 'W-B-P0031', kind: 'branch', branch: 'B-P0031', person: 'P0031', research: 'G0003', tasks: 14, persons: 6, section: 'decide' });
    });
    it('an older app reading (no branches) keeps it as a line', () => {
        const [w] = sanitizeWaiting([item], false, false);
        expect(w.kind).toBeUndefined();
        expect(w.what).toBe('Větev Alois Fíšek');
        expect(sanitizeWaiting([{ ...item, branch: 'nope' }], false, true)[0].kind).toBeUndefined();
    });
});

describe('writes outside the directions', () => {
    const BASE = 'http://127.0.0.1:5996/tok';
    let calls: { url: string; init: RequestInit }[] = [];
    const reply = (status: number, body: unknown) => {
        globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return new Response(JSON.stringify(body), { status });
        }) as typeof fetch;
    };
    const sent = (i = 0) => JSON.parse(String(calls[i].init.body));
    const realFetch = globalThis.fetch;
    beforeEach(() => { calls = []; });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('a branch: mode, a direction, the default; a bad one is not sent', async () => {
        reply(200, { branch: { ...BRANCH, mode: 'normal', own: true }, head: 'abcdef1', parent: '1234567' });
        const r = await setBranchMode(BASE, 'B-P0031', 'normal');
        expect(calls[0].url).toContain('/tok/offline/B-P0031');
        expect(sent()).toEqual({ mode: 'normal' });
        expect(r.ok && r.branch?.mode).toBe('normal');
        await setBranchMode(BASE, 'B-P0031', { line: 'G0003' });
        expect(sent(1)).toEqual({ mode: 'line', line: 'G0003' });
        await setBranchMode(BASE, 'B-P0031', 'default');
        expect(sent(2)).toEqual({ mode: 'default' });
        expect((await setBranchMode(BASE, 'P0031', 'never')).ok).toBe(false);
        expect((await setBranchMode(BASE, 'B-P0031', { line: 'X' })).ok).toBe(false);
        expect(calls).toHaveLength(3);
    });

    it('a gone branch is none; 409 queue.doing is a conflict with its code', async () => {
        reply(404, { error: 'offline.none' });
        expect(await setBranchMode(BASE, 'B-P0031', 'never')).toMatchObject({ ok: false, code: 'none' });
        reply(409, { error: 'queue.doing' });
        expect(await setTaskOrder(BASE, 'T0412', 'next')).toMatchObject({ ok: false, code: 'conflict', errorCode: 'queue.doing' });
    });

    it('the tree: mode and suggest', async () => {
        reply(200, { offLine: { mode: 'last', suggest: false }, head: 'abcdef2' });
        const r = await setOffLineTree(BASE, { mode: 'last' });
        expect(calls[0].url).toMatch(/\/tok\/offline(\?|$)/);
        expect(sent()).toEqual({ mode: 'last' });
        expect(r.ok && r.offLine?.mode).toBe('last');
        await setOffLineTree(BASE, { suggest: false });
        expect(sent(1)).toEqual({ suggest: false });
        expect((await setOffLineTree(BASE, {})).ok).toBe(false);
    });

    it('a task: next / last / default', async () => {
        reply(200, { task: { id: 'T0412', text: 'Sňatek', state: 'next', own: 'next', why: { kind: 'own', do: 'next' } }, head: 'abcdef3' });
        const r = await setTaskOrder(BASE, 'T0412', 'next');
        expect(calls[0].url).toContain('/tok/queue/T0412');
        expect(sent()).toEqual({ do: 'next' });
        expect(r.ok && r.task?.own).toBe('next');
        expect((await setTaskOrder(BASE, 'T0412', 'first' as 'next')).ok).toBe(false);
    });

    it('queue.next: the place before (`was`) read from the answer, sent back by restore as it came', async () => {
        reply(200, { task: { id: 'T0412', text: 'Sňatek', state: 'next', own: 'next' }, was: { own: 'last', at: '2026-11-13T08:00:00Z' }, head: 'abcdef3' });
        const r = await setTaskOrder(BASE, 'T0412', 'next');
        expect(r.ok && r.was).toEqual({ own: 'last', at: '2026-11-13T08:00:00Z' });
        reply(200, { task: null, was: {}, head: 'abcdef4' });
        expect((await setTaskOrder(BASE, 'T0412', 'next')).ok && true).toBe(true);
        const back = await restoreTaskOrder(BASE, 'T0412', { own: 'last', at: '2026-11-13T08:00:00Z' });
        expect(back.ok).toBe(true);
        expect(calls[2].url).toContain('/tok/queue/T0412');
        expect(sent(2)).toEqual({ do: 'restore', was: { own: 'last', at: '2026-11-13T08:00:00Z' } });
        await restoreTaskOrder(BASE, 'T0412', {});
        expect(sent(3)).toEqual({ do: 'restore', was: {} });
        // A `was` the app cannot send back as it came is not sent.
        expect((await restoreTaskOrder(BASE, 'T0412', { own: 'first' as 'next', at: 'x' })).ok).toBe(false);
        expect(calls).toHaveLength(4);
    });

    it('queue.next: the answer to restore read as the research sends it (its place, its reason, no mark of its own)', async () => {
        reply(200, { task: { id: 'T0086', text: 'Matriky', state: 'next', pos: 6, research: 'G0001', why: { kind: 'line', research: 'G0001' } }, was: { own: 'next', at: '2026-11-13T05:10:00Z' }, head: 'abcdef5', parent: 'abcdef4' });
        const r = await restoreTaskOrder(BASE, 'T0086', {});
        expect(r.ok && r.task).toEqual({ id: 'T0086', text: 'Matriky', state: 'next', pos: 6, research: 'G0001', why: { kind: 'line', research: 'G0001' } });
    });

    it('queue.next: the toast of Do next names the task, in every language without addressing anyone', () => {
        const said = (lang: Parameters<typeof setLanguage>[0]) => {
            setLanguage(lang);
            return strings.live.queueMoved('T0103');
        };
        expect(['en', 'cs', 'de', 'pl'].map(l => said(l as Parameters<typeof setLanguage>[0])))
            .toEqual(['T0103 comes up next', 'T0103 jako další', 'T0103 als Nächstes', 'T0103 jako następne']);
        setLanguage('en');
    });

    it('queue.next: a `was` is {} or own + at, nothing else', () => {
        expect(sanitizeTaskOrderWas({})).toEqual({});
        expect(sanitizeTaskOrderWas({ own: 'next', at: '2026-11-13T08:00:00Z' })).toEqual({ own: 'next', at: '2026-11-13T08:00:00Z' });
        expect(sanitizeTaskOrderWas({ own: 'next' })).toBeNull();
        expect(sanitizeTaskOrderWas({ own: 'first', at: '2026-11-13T08:00:00Z' })).toBeNull();
        expect(sanitizeTaskOrderWas({ own: 'next', at: '2026-11-13T08:00:00Z', x: 1 })).toBeNull();
        expect(sanitizeTaskOrderWas(null)).toBeNull();
        expect(sanitizeTaskOrderWas([])).toBeNull();
    });

    it('a growing branch: line (with a direction), keep, never', async () => {
        reply(200, { branch: 'B-P0031', answer: 'line', head: 'abcdef4' });
        await answerBranchWaiting(BASE, 'W-B-P0031', 'line', 'G0003');
        expect(calls[0].url).toContain('/tok/waiting/W-B-P0031');
        expect(sent()).toEqual({ do: 'line', line: 'G0003' });
        await answerBranchWaiting(BASE, 'W-B-P0031', 'keep');
        expect(sent(1)).toEqual({ do: 'keep' });
        expect((await answerBranchWaiting(BASE, 'W-1', 'never')).ok).toBe(false);
    });

    it('a branch\'s tasks', async () => {
        reply(200, { branch: BRANCH, tasks: [{ id: 'T0412', text: 'Sňatek', person: 'P0031', own: 'last' }, { id: 'bad', text: 'x' }] });
        const r = await fetchBranchTasks(BASE, 'B-P0031');
        expect(calls[0].init.method).toBe('GET');
        expect(r.ok && r.tasks).toEqual([{ id: 'T0412', text: 'Sňatek', person: 'P0031', own: 'last' }]);
    });
});
