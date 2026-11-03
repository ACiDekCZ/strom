/**
 * Managing the research's directions from the app (spec 038): the order the
 * Directions section shows, moves, a series of moves written once, one retry
 * of a busy write, the bridge's caps and a direction's new fields, and the
 * typed answers of the direction writes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    LiveDirection, sanitizeDirections, sanitizeDirectionFound, sanitizeDirectionLimits, sanitizeLiveStatus, sanitizeResearchCaps,
} from '../research-link.js';
import {
    orderDirections, withPendingOrder, moveInOrder, dropInOrder, sameOrder, DirectionOrderWriter, withBusyRetry,
    foundParts, directionUnstarted, calendarDaysAgo,
} from '../research-directions.js';
import {
    createDirection, editDirection, setDirectionState, writeDirectionOrder, fetchDirectionPeople, forgetDirectionPeople,
    directionRefusal,
} from '../research-directions-write.js';

const d = (id: string, state: LiveDirection['state'], extra: Partial<LiveDirection> = {}): LiveDirection =>
    ({ id, name: `Linie ${id}`, state, ...extra });

describe('orderDirections', () => {
    it('keeps the bridge order with paused ones in place and ended ones apart', () => {
        const list = [
            d('G0003', 'active', { order: 3 }),
            d('G0001', 'paused', { order: 2 }),
            d('G0004', 'done'),
            d('G0002', 'active', { order: 1, working: true }),
        ];
        const r = orderDirections(list, true);
        expect(r.active.map(x => x.id)).toEqual(['G0002', 'G0001', 'G0003']);
        expect(r.inactive.map(x => x.id)).toEqual(['G0004']);
    });

    it('keeps the sent order when the bridge says no order numbers', () => {
        const r = orderDirections([d('G0005', 'active'), d('G0002', 'active'), d('G0009', 'paused')], true);
        expect(r.active.map(x => x.id)).toEqual(['G0005', 'G0002', 'G0009']);
    });

    it('an older research: running first (worked on, then newest), paused and ended apart', () => {
        const list = [
            d('G0001', 'active', { since: '2026-10-01T10:00:00Z' }),
            d('G0002', 'active', { since: '2026-10-05T10:00:00Z' }),
            d('G0003', 'active', { since: '2026-09-01T10:00:00Z', working: true }),
            d('G0004', 'paused', { since: '2026-10-02T10:00:00Z' }),
            d('G0005', 'done', { since: '2026-10-03T10:00:00Z' }),
        ];
        const r = orderDirections(list);
        expect(r.active.map(x => x.id)).toEqual(['G0003', 'G0002', 'G0001']);
        expect(r.inactive.map(x => x.id)).toEqual(['G0005', 'G0004']);
    });
});

describe('moves in the order', () => {
    const order = ['G0001', 'G0002', 'G0003', 'G0004'];

    it('moves up, down and to the top; edges stay', () => {
        expect(moveInOrder(order, 'G0003', 'up')).toEqual(['G0001', 'G0003', 'G0002', 'G0004']);
        expect(moveInOrder(order, 'G0002', 'down')).toEqual(['G0001', 'G0003', 'G0002', 'G0004']);
        expect(moveInOrder(order, 'G0004', 'top')).toEqual(['G0004', 'G0001', 'G0002', 'G0003']);
        expect(moveInOrder(order, 'G0001', 'up')).toEqual(order);
        expect(moveInOrder(order, 'G0004', 'down')).toEqual(order);
        expect(moveInOrder(order, 'G0099', 'top')).toEqual(order);
    });

    it('drops before a row (index in the order before the move)', () => {
        expect(dropInOrder(order, 'G0004', 1)).toEqual(['G0001', 'G0004', 'G0002', 'G0003']);
        expect(dropInOrder(order, 'G0001', 3)).toEqual(['G0002', 'G0003', 'G0001', 'G0004']);
        expect(dropInOrder(order, 'G0002', 4)).toEqual(['G0001', 'G0003', 'G0004', 'G0002']);
        expect(sameOrder(dropInOrder(order, 'G0002', 1), order)).toBe(true);
    });

    it('a pending order rearranges the rows; rows it does not name keep their place after', () => {
        const rows = [d('G0001', 'active'), d('G0002', 'active'), d('G0003', 'paused')];
        expect(withPendingOrder(rows, ['G0002', 'G0001']).map(x => x.id)).toEqual(['G0002', 'G0001', 'G0003']);
        expect(withPendingOrder(rows, null).map(x => x.id)).toEqual(['G0001', 'G0002', 'G0003']);
    });
});

describe('DirectionOrderWriter', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a series of moves is written once, after the quiet moment', async () => {
        const write = vi.fn(async (_order: string[]) => {});
        const w = new DirectionOrderWriter(write, 400);
        w.move(['G0002', 'G0001', 'G0003']);
        await vi.advanceTimersByTimeAsync(200);
        w.move(['G0002', 'G0003', 'G0001']);
        await vi.advanceTimersByTimeAsync(300);
        w.move(['G0003', 'G0002', 'G0001']);
        expect(write).not.toHaveBeenCalled();
        expect(w.busy).toBe(true);
        await vi.advanceTimersByTimeAsync(400);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(['G0003', 'G0002', 'G0001']);
        expect(w.busy).toBe(false);
    });

    it('a move while a write runs is written after it', async () => {
        let release: () => void = () => {};
        const write = vi.fn((_order: string[]) => new Promise<void>(r => { release = r; }));
        const w = new DirectionOrderWriter(write, 400);
        w.move(['G0002', 'G0001']);
        await vi.advanceTimersByTimeAsync(400);
        expect(write).toHaveBeenCalledTimes(1);
        w.move(['G0001', 'G0002']);
        await vi.advanceTimersByTimeAsync(400);
        expect(write).toHaveBeenCalledTimes(1);
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenLastCalledWith(['G0001', 'G0002']);
    });

    it('cancel drops what waits', async () => {
        const write = vi.fn(async () => {});
        const w = new DirectionOrderWriter(write, 400);
        w.move(['G0002', 'G0001']);
        w.cancel();
        await vi.advanceTimersByTimeAsync(1000);
        expect(write).not.toHaveBeenCalled();
    });
});

describe('withBusyRetry', () => {
    it('a busy answer is tried once more after the wait; the second answer is the one shown', async () => {
        const answers = [{ ok: false, code: 'busy' }, { ok: false, code: 'busy' }, { ok: true }];
        const run = vi.fn(async () => answers.shift()!);
        const sleep = vi.fn(async (_ms: number) => {});
        const r = await withBusyRetry(run, 3000, sleep);
        expect(run).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(3000);
        expect(r).toEqual({ ok: false, code: 'busy' });
    });

    it('no retry after success or another refusal', async () => {
        const sleep = vi.fn(async (_ms: number) => {});
        const ok = vi.fn(async () => ({ ok: true }));
        await withBusyRetry(ok, 3000, sleep);
        const refused = vi.fn(async () => ({ ok: false, code: 'locked' }));
        await withBusyRetry(refused, 3000, sleep);
        expect(ok).toHaveBeenCalledTimes(1);
        expect(refused).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('a direction from the status', () => {
    it('reads order, limits, question, review, created, parent and found', () => {
        const [x] = sanitizeDirections([{
            id: 'G0004', name: 'Lhotákovi z Lhoty', state: 'active', direction: 'ancestors', focus: 'P0012',
            order: 2, limits: { generations: 4, before: 1700 }, question: 'Kdo byl otec Václava?',
            review: { scope: 'person' }, created: '2026-10-20T08:00:00Z', parent: 'G0001',
            found: { days: 7, sessions: 3, persons: 2, sources: 0, people: ['P0031', 'P0031', 'bad', 'P0032'] },
        }]);
        expect(x.order).toBe(2);
        expect(x.limits).toEqual({ generations: 4, before: 1700 });
        expect(x.question).toBe('Kdo byl otec Václava?');
        expect(x.review).toEqual({ scope: 'person' });
        expect(x.created).toBe('2026-10-20T08:00:00Z');
        expect(x.parent).toBe('G0001');
        expect(x.found).toEqual({ days: 7, sessions: 3, persons: 2, sources: 0, people: ['P0031', 'P0032'] });
    });

    it('limits out of range and an empty found are left out', () => {
        expect(sanitizeDirectionLimits({ generations: 0, before: 900 })).toBeNull();
        expect(sanitizeDirectionLimits({ generations: 120, before: 1850 })).toEqual({ before: 1850 });
        expect(sanitizeDirectionFound({ days: 7, sessions: 0, persons: 0, sources: 0, people: [] })).toBeNull();
        expect(sanitizeDirectionFound({ days: 7, sessions: 'x', persons: 1, sources: 0 })).toBeNull();
        expect(foundParts({ sessions: 2, persons: 0, sources: 5 })).toEqual(['sessions', 'sources']);
    });

    it('a new direction without tasks is unstarted', () => {
        expect(directionUnstarted(d('G0001', 'active'))).toBe(true);
        expect(directionUnstarted(d('G0001', 'active', { tasks: 1 }))).toBe(false);
        expect(directionUnstarted(d('G0001', 'paused'))).toBe(false);
    });

    it('calendar days between two moments', () => {
        const now = new Date(2026, 10, 3, 9, 0).getTime();
        expect(calendarDaysAgo(new Date(2026, 10, 3, 1, 0).getTime(), now)).toBe(0);
        expect(calendarDaysAgo(new Date(2026, 10, 2, 23, 0).getTime(), now)).toBe(1);
    });
});

describe('caps', () => {
    it('each field read only when of its type', () => {
        expect(sanitizeResearchCaps({
            directionsWrite: true, directionsOrder: 'yes', orderMode: 'strict', directionKinds: ['ancestors', 'x', 'question', 'ancestors'],
            duplicateDirections: true,
        })).toEqual({
            directionsWrite: true, directionsOrder: false, orderMode: 'strict', directionKinds: ['ancestors', 'question'],
            duplicateDirections: true, offLineBranches: false,
        });
        expect(sanitizeResearchCaps(null)).toBeNull();
    });

    it('the status carries caps only when sent (an older research has none)', () => {
        const base = { tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'Fíškovi' }, head: 'abc1234' };
        expect(sanitizeLiveStatus(base)!.caps).toBeUndefined();
        expect(sanitizeLiveStatus({ ...base, caps: { directionsWrite: true } })!.caps?.directionsWrite).toBe(true);
    });
});

describe('direction writes', () => {
    const BASE = 'http://127.0.0.1:5996/tok';
    let calls: { url: string; init: RequestInit }[] = [];
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return new Response(JSON.stringify(body), { status, headers });
        }) as typeof fetch;
    };
    const realFetch = globalThis.fetch;

    beforeEach(() => { calls = []; forgetDirectionPeople(); });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('create: the body as text/plain JSON; 200 gives the direction and head', async () => {
        reply(200, { direction: { id: 'G0007', name: 'Fíškovi', state: 'active', order: 4 }, head: 'abcdef1', parent: '1234567' });
        const r = await createDirection(BASE, { person: 'P0012', direction: 'ancestors', name: ' Fíškovi ', limits: { generations: 3 } });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.direction?.id).toBe('G0007');
        expect(r.head).toBe('abcdef1');
        expect(r.parent).toBe('1234567');
        expect(calls[0].url).toContain('/tok/directions');
        expect(calls[0].init.method).toBe('POST');
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ person: 'P0012', direction: 'ancestors', name: 'Fíškovi', limits: { generations: 3 } });
    });

    it('create is not sent for a question without its text or a bad person', async () => {
        reply(200, {});
        expect((await createDirection(BASE, { person: 'P0012', direction: 'question' })).ok).toBe(false);
        expect((await createDirection(BASE, { person: 'X1', direction: 'ancestors' })).ok).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('409 directions.exists names the direction that is there', async () => {
        reply(409, { error: 'directions.exists', existing: { id: 'G0002', name: 'Lhotákovi', state: 'paused' } });
        const r = await createDirection(BASE, { person: 'P0012', direction: 'ancestors' });
        expect(r).toMatchObject({ ok: false, code: 'exists', status: 409, existing: { id: 'G0002', name: 'Lhotákovi', state: 'paused' } });
    });

    it('503 research.busy with Retry-After', async () => {
        reply(503, { error: 'research.busy' }, { 'Retry-After': '3' });
        const r = await setDirectionState(BASE, 'G0002', 'pause');
        expect(r).toMatchObject({ ok: false, code: 'busy', retryAfter: 3 });
    });

    it('other refusals by status', () => {
        expect(directionRefusal(409, { error: 'directions.archive' }).code).toBe('archive');
        expect(directionRefusal(423, {}).code).toBe('locked');
        expect(directionRefusal(400, { error: 'directions.limits' }).code).toBe('bad-body');
        expect(directionRefusal(404, { error: 'directions.person' }).code).toBe('person');
        expect(directionRefusal(404, { error: 'directions.none' }).code).toBe('none');
        expect(directionRefusal(500, {}).code).toBe('failed');
    });

    it('state: do and reason; edit: the effect sentence', async () => {
        reply(200, { direction: { id: 'G0002', name: 'Lhotákovi', state: 'done' }, head: 'abcdef2' });
        await setDirectionState(BASE, 'G0002', 'done', ' hotovo ');
        expect(calls[0].url).toContain('/tok/directions/G0002/state');
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ do: 'done', reason: 'hotovo' });
        reply(200, { direction: { id: 'G0002', name: 'Lhotákovi', state: 'active' }, effect: { said: '2 úkoly jsou teď mimo linii.', outside: 2 } });
        const r = await editDirection(BASE, 'G0002', { limits: { generations: 2, before: null } });
        expect(r.ok && r.effect).toEqual({ said: '2 úkoly jsou teď mimo linii.', outside: 2 });
    });

    it('order: unknown ids come back as ignored', async () => {
        reply(200, { order: ['G0002', 'G0001'], ignored: ['G0009'], head: 'abcdef3' });
        const r = await writeDirectionOrder(BASE, ['G0002', 'G0001', 'G0009', 'bad']);
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ order: ['G0002', 'G0001', 'G0009'] });
        expect(r.ok && r.ignored).toEqual(['G0009']);
    });

    it('people are read again only when the head moved', async () => {
        reply(200, { people: { P0012: ['G0001', 'G0002'], bad: ['G0001'] }, head: 'abcdef4' });
        const a = await fetchDirectionPeople(BASE, 'abcdef4');
        expect(a.ok && [...a.people.entries()]).toEqual([['P0012', ['G0001', 'G0002']]]);
        await fetchDirectionPeople(BASE, 'abcdef4');
        expect(calls).toHaveLength(1);
        await fetchDirectionPeople(BASE, 'abcdef5');
        expect(calls).toHaveLength(2);
    });

    it('no answer is a network refusal, never a throw', async () => {
        globalThis.fetch = vi.fn(async () => { throw new TypeError('down'); }) as typeof fetch;
        expect(await writeDirectionOrder(BASE, ['G0001'])).toMatchObject({ ok: false, code: 'network' });
    });
});
