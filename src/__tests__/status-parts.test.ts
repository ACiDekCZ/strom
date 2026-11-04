/**
 * The light status of a research's bridge (research 1.26.0, `status.parts`):
 * a bridge that names the feature is asked `parts=1`, its heavy parts read
 * (`GET <token>/status/<part>`) only when their rev changed and put back into
 * the status in the shape of the full one; an older bridge is asked the full
 * status as before. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { STATUS_PARTS_FEATURE, completeStatus, forgetStatusParts, statusAskUrl } from '../status-parts.js';
import { sanitizeLiveStatus } from '../research-link.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const BASE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
const URL_POLL = `${BASE}/status?poll=1`;

const WAITING = [{ id: 'W1', kind: 'question', text: 'Where was Anna Fíšková born?', person: 'P0003' }];
const QUEUE = [{ task: 'T1', title: 'Baptism of Jan', person: 'P0001' }];

function full(): Record<string, unknown> {
    return { tree: { id: TREE, name: 'Fíškovi' }, head: 'h1', links: ['open'], features: [STATUS_PARTS_FEATURE],
        waiting: WAITING, queue: QUEUE, queueMore: 0, queueCounts: { next: 1, rev: 'aa11bb22cc33dd44' } };
}
function light(revs: Record<string, string>, head = 'h1'): Record<string, unknown> {
    return { tree: { id: TREE, name: 'Fíškovi' }, head, links: ['open'], features: [STATUS_PARTS_FEATURE], parts: revs };
}

describe('the light status and its parts', () => {
    let reads: string[];
    let parts: Record<string, Record<string, unknown>>;
    const readPart = async (url: string): Promise<unknown> => {
        reads.push(url.slice(BASE.length));
        const name = url.split('/').pop()!;
        const p = parts[name];
        if (!p) throw new Error('HTTP 404');
        return p;
    };

    beforeEach(() => {
        forgetStatusParts();
        reads = [];
        parts = {
            waiting: { part: 'waiting', rev: '3f2a000000000001', head: 'h1', waiting: WAITING },
            queue: { part: 'queue', rev: '91c0000000000001', head: 'h1', queue: QUEUE, queueMore: 0, queueCounts: { next: 1, rev: 'aa11bb22cc33dd44' } },
            // An archive: no off-line part, only its rev.
            offLine: { part: 'offLine', rev: '77d1000000000001', head: 'h1' },
            researches: { part: 'researches', rev: 'a0b4000000000001', head: 'h1', researches: [] },
        };
    });

    it('an older bridge (no status.parts): always the full status, nothing read apart', async () => {
        const old = { ...full(), features: ['person.titles'] };
        expect(statusAskUrl(URL_POLL)).toBe(URL_POLL);
        expect(await completeStatus(URL_POLL, old, readPart)).toEqual(old);
        expect(statusAskUrl(URL_POLL)).toBe(URL_POLL);
        expect(reads).toEqual([]);
    });

    it('a bridge with status.parts: asked parts=1 from then on; the first light status reads every part, at once', async () => {
        await completeStatus(URL_POLL, full(), readPart);
        expect(statusAskUrl(URL_POLL)).toBe(`${URL_POLL}&parts=1`);
        expect(statusAskUrl(`${BASE}/status`)).toBe(`${BASE}/status?parts=1`);
        const revs = { waiting: '3f2a000000000001', queue: '91c0000000000001', offLine: '77d1000000000001', researches: 'a0b4000000000001' };
        const got = await completeStatus(URL_POLL, light(revs), readPart) as Record<string, unknown>;
        expect(reads.sort()).toEqual(['/status/offLine', '/status/queue', '/status/researches', '/status/waiting']);
        // The shape of the full status: the parts' fields in, `parts` out, a part without fields leaves them out.
        expect(got).not.toHaveProperty('parts');
        expect(got).not.toHaveProperty('offLine');
        expect(got.waiting).toEqual(WAITING);
        expect(got.queueCounts).toEqual({ next: 1, rev: 'aa11bb22cc33dd44' });
        expect(sanitizeLiveStatus(got)?.waiting).toEqual(sanitizeLiveStatus(full())?.waiting);
    });

    it('revs the same: nothing read again; one changed: only that part', async () => {
        await completeStatus(URL_POLL, full(), readPart);
        const revs = { waiting: '3f2a000000000001', queue: '91c0000000000001', offLine: '77d1000000000001', researches: 'a0b4000000000001' };
        await completeStatus(URL_POLL, light(revs), readPart);
        reads = [];
        const same = await completeStatus(URL_POLL, light(revs, 'h2'), readPart) as Record<string, unknown>;
        expect(reads).toEqual([]);
        expect(same.waiting).toEqual(WAITING);
        expect(same.head).toBe('h2');
        // A new task awaits the user: only waiting is read; the rev kept is the one the part came with.
        const more = [...WAITING, { id: 'W2', kind: 'question', text: 'Which Jan?', person: 'P0001' }];
        parts.waiting = { part: 'waiting', rev: '3f2a000000000003', head: 'h3', waiting: more };
        const changed = await completeStatus(URL_POLL, light({ ...revs, waiting: '3f2a000000000002' }, 'h3'), readPart) as Record<string, unknown>;
        expect(reads).toEqual(['/status/waiting']);
        expect(changed.waiting).toEqual(more);
        reads = [];
        await completeStatus(URL_POLL, light({ ...revs, waiting: '3f2a000000000003' }, 'h3'), readPart);
        expect(reads).toEqual([]);
    });

    it('a part that cannot be read keeps its older copy; with none kept the ask fails', async () => {
        await completeStatus(URL_POLL, full(), readPart);
        const revs = { waiting: '3f2a000000000001', queue: '91c0000000000001', offLine: '77d1000000000001', researches: 'a0b4000000000001' };
        await completeStatus(URL_POLL, light(revs), readPart);
        delete parts.waiting;
        const got = await completeStatus(URL_POLL, light({ ...revs, waiting: '3f2a0000000000ff' }), readPart) as Record<string, unknown>;
        expect(got.waiting).toEqual(WAITING);
        forgetStatusParts(BASE);
        await completeStatus(URL_POLL, full(), readPart);
        await expect(completeStatus(URL_POLL, light({ ...revs, waiting: '3f2a0000000000ff' }), readPart)).rejects.toThrow();
    });

    it('another address (a new token): its parts are its own, read again', async () => {
        await completeStatus(URL_POLL, full(), readPart);
        const revs = { waiting: '3f2a000000000001' };
        await completeStatus(URL_POLL, light(revs), readPart);
        const other = 'http://127.0.0.1:5998/fedcba9876543210fedcba9876543210';
        expect(statusAskUrl(`${other}/status?poll=1`)).toBe(`${other}/status?poll=1`);
        reads = [];
        await completeStatus(`${other}/status?poll=1`, light(revs), async (u) => { reads.push(u); return parts.waiting; });
        expect(reads).toEqual([`${other}/status/waiting`]);
    });

    it('a bridge that no longer names the feature (downgraded): the full status again', async () => {
        await completeStatus(URL_POLL, full(), readPart);
        expect(statusAskUrl(URL_POLL)).toContain('parts=1');
        await completeStatus(URL_POLL, { ...full(), features: [] }, readPart);
        expect(statusAskUrl(URL_POLL)).toBe(URL_POLL);
    });
});
