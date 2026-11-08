import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ORIGIN_FEATURE, researchShowsOrigin, revertRequestBody, revertReply, postBridgeRevert,
    revertedFact, isRevertedRow, otherRevertChanges,
} from '../research-revert.js';
import type { ValueChange, ValueDiff } from '../research-changes.js';
import type { Partnership, Person } from '../types.js';

const BASE = 'http://127.0.0.1:4321/secret';
const HELD_FEATURES = ['origin', 'seal.foreign', 'tree.notDownloaded', 'disk.full'];

describe('the origin feature gate', () => {
    it('is on only when the bridge names it', () => {
        expect(ORIGIN_FEATURE).toBe('origin');
        expect(researchShowsOrigin(['sync.again', 'origin'])).toBe(true);
        expect(researchShowsOrigin(['sync.again'])).toBe(false);
        expect(researchShowsOrigin(['origin.x'])).toBe(false);
        expect(researchShowsOrigin([])).toBe(false);
        expect(researchShowsOrigin(null)).toBe(false);
        expect(researchShowsOrigin(undefined)).toBe(false);
    });
});

describe('the revert request', () => {
    it('takes a person, a ref and maybe a part', () => {
        expect(revertRequestBody({ person: ' P0004 ', ref: 'E0012' })).toEqual({ person: 'P0004', ref: 'E0012' });
        expect(revertRequestBody({ person: 'P0004', ref: 'N:P0004:1', part: 'GIVN' })).toEqual({ person: 'P0004', ref: 'N:P0004:1', part: 'GIVN' });
        expect(revertRequestBody({ person: 'P0004', ref: 'SEX:P0004' })).toEqual({ person: 'P0004', ref: 'SEX:P0004' });
    });

    it('refuses what the research would not take', () => {
        expect(revertRequestBody({ person: 'I12', ref: 'E1' })).toBeNull();
        expect(revertRequestBody({ person: 'P1', ref: '' })).toBeNull();
        expect(revertRequestBody({ person: 'P1', ref: 'E1; rm' })).toBeNull();
        expect(revertRequestBody({ person: 'P1', ref: 'E'.repeat(65) })).toBeNull();
        expect(revertRequestBody({ person: 'P1', ref: 'E1', part: 'NOTE' as never })).toBeNull();
    });
});

describe('the bridge\'s answer', () => {
    it('200: the versions before and after', () => {
        expect(revertReply(200, { ok: true, reverted: { owner: 'P0004', ref: 'E0012', parts: ['date'] }, head: 'ABCDEF1', parent: '1234567' }))
            .toEqual({ kind: 'ok', head: 'abcdef1', parent: '1234567' });
        expect(revertReply(200, { ok: true })).toEqual({ kind: 'ok', head: '', parent: '' });
        expect(revertReply(200, null).kind).toBe('error');
    });

    it('404 revert.unknown and 409 revert.nothing', () => {
        expect(revertReply(404, { error: 'no fact E9', code: 'revert.unknown' })).toEqual({ kind: 'unknown', reason: 'no fact E9' });
        expect(revertReply(409, { error: 'nothing changed', code: 'revert.nothing' })).toEqual({ kind: 'nothing', reason: 'nothing changed' });
        expect(revertReply(404, { code: 'other' }).kind).toBe('error');
    });

    it('503 research.busy, with the time to wait from the header or the body', () => {
        expect(revertReply(503, { error: 'busy', code: 'research.busy', retry: 2 }, [], '5')).toEqual({ kind: 'busy', reason: 'busy', retryAfter: 5 });
        expect(revertReply(503, { code: 'research.busy', retry: 2 })).toEqual({ kind: 'busy', reason: '', retryAfter: 2 });
        expect(revertReply(503, null)).toEqual({ kind: 'busy', reason: '' });
        expect(revertReply(503, null, [], 'soon')).toEqual({ kind: 'busy', reason: '' });
    });

    it('a held write, as the bridge announces it', () => {
        const sealed = revertReply(409, { error: 'sealed on Pracovna', code: 'seal.foreign', params: { computer: 'Pracovna' } }, HELD_FEATURES);
        expect(sealed).toMatchObject({ kind: 'writeHeld', computer: 'Pracovna', held: { kind: 'seal' } });
        // The failure of the command carries the code as reasonCode.
        expect(revertReply(500, { error: 'x', code: 'revert.failed', reasonCode: 'seal.foreign' }, HELD_FEATURES))
            .toMatchObject({ kind: 'writeHeld', held: { kind: 'seal' } });
        expect(revertReply(507, { error: 'full', code: 'disk.full' }, HELD_FEATURES)).toMatchObject({ kind: 'writeHeld', held: { kind: 'disk' } });
        // Not announced: an ordinary refusal.
        expect(revertReply(409, { code: 'seal.foreign' }, ['origin']).kind).toBe('error');
    });

    it('403: held by another computer, unless the app is not let in', () => {
        expect(revertReply(403, { error: 'held', code: 'write.held', params: { computer: 'Pracovna\u0007' } }))
            .toEqual({ kind: 'writeHeld', computer: 'Pracovna', reason: 'held' });
        expect(revertReply(403, { error: 'held', code: 'write.held' })).toEqual({ kind: 'writeHeld', reason: 'held' });
        expect(revertReply(403, { code: 'app.only' }).kind).toBe('error');
    });

    it('anything else is an error, no answer is no bridge', () => {
        expect(revertReply(400, { code: 'revert.invalid', error: 'the body' })).toEqual({ kind: 'error', status: 400, code: 'revert.invalid', reason: 'the body' });
        expect(revertReply(404, null)).toEqual({ kind: 'error', status: 404, code: '', reason: '' });
        expect(revertReply(0, null)).toEqual({ kind: 'noBridge' });
    });
});

describe('posting a revert', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        vi.fn(async () => ({ status, json: async () => body, headers: new Headers(headers) }));

    it('POSTs the body as text to <token>/facts/revert and types the answer', async () => {
        const fetchMock = reply(200, { ok: true, head: 'aaaaaaa', parent: 'bbbbbbb' });
        vi.stubGlobal('fetch', fetchMock);
        const r = await postBridgeRevert(BASE, { person: 'P0004', ref: 'E0012', part: 'DATE' }, ['origin']);
        expect(r).toEqual({ kind: 'ok', head: 'aaaaaaa', parent: 'bbbbbbb' });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.startsWith(`${BASE}/facts/revert`)).toBe(true);
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('omit');
        expect(JSON.parse(init.body as string)).toEqual({ person: 'P0004', ref: 'E0012', part: 'DATE' });
    });

    it('reads Retry-After of a busy research', async () => {
        vi.stubGlobal('fetch', reply(503, { code: 'research.busy' }, { 'Retry-After': '3' }));
        expect(await postBridgeRevert(BASE, { person: 'P0004', ref: 'E0012' })).toEqual({ kind: 'busy', reason: '', retryAfter: 3 });
    });

    it('no answer is no bridge; a bad request is not sent', async () => {
        const failing = vi.fn(async () => { throw new TypeError('failed to fetch'); });
        vi.stubGlobal('fetch', failing);
        expect(await postBridgeRevert(BASE, { person: 'P0004', ref: 'E0012' })).toEqual({ kind: 'noBridge' });
        expect(await postBridgeRevert(BASE, { person: 'X', ref: 'E0012' })).toEqual({ kind: 'error', status: 0, code: 'invalid', reason: '' });
        expect(await postBridgeRevert('', { person: 'P0004', ref: 'E0012' })).toEqual({ kind: 'noBridge' });
        expect(failing).toHaveBeenCalledTimes(1);
    });

    it('a second ask while the first runs gets the same answer', async () => {
        let release: (v: unknown) => void = () => {};
        const fetchMock = vi.fn(() => new Promise(res => { release = res; }));
        vi.stubGlobal('fetch', fetchMock);
        const a = postBridgeRevert(BASE, { person: 'P0004', ref: 'E0012' });
        const b = postBridgeRevert(BASE, { person: 'P0004', ref: 'E0012' });
        release({ status: 409, json: async () => ({ code: 'revert.nothing' }), headers: new Headers() });
        expect(await a).toEqual({ kind: 'nothing', reason: '' });
        expect(await b).toBe(await a);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('loading the research\'s version after a revert', () => {
    const p = { id: 'p1', events: [{ id: 'e1', type: 'occupation' }] } as unknown as Person;
    const ps = { id: 'u1', person1Id: 'p1', person2Id: 'p2' } as unknown as Partnership;
    const row = (personId: string, field: ValueChange['field'], of?: string): ValueChange =>
        ({ personId, name: '', field, here: 'a', there: 'b', ...(of ? { of } : {}) }) as ValueChange;
    const diff = (rows: ValueChange[], extra: Partial<ValueDiff> = {}): ValueDiff =>
        ({ rows, addedPersons: 0, addedFacts: 0, filled: [], ...extra }) as ValueDiff;

    it('names the fact\'s people and rows', () => {
        expect(revertedFact(p, 'birth')).toEqual({ persons: ['p1'], fields: ['birthDate', 'birthPlace'] });
        expect(revertedFact(p, 'name').fields).toContain('name');
        expect(revertedFact(p, 'event:e1')).toEqual({ persons: ['p1'], fields: ['eventDate', 'eventPlace', 'eventValue'], of: 'occupation' });
        expect(revertedFact(ps, 'marriage')).toEqual({ persons: ['p1', 'p2'], fields: ['marriageDate', 'marriagePlace'] });
        expect(isRevertedRow(row('p1', 'eventDate', 'occupation'), revertedFact(p, 'event:e1'))).toBe(true);
        expect(isRevertedRow(row('p1', 'eventDate', 'baptism'), revertedFact(p, 'event:e1'))).toBe(false);
    });

    it('quiet only when the version changes nothing else here', () => {
        const birth = revertedFact(p, 'birth');
        expect(otherRevertChanges(diff([row('p1', 'birthDate')]), birth)).toBe(0);
        expect(otherRevertChanges(diff([row('p1', 'birthDate'), row('p2', 'birthDate')]), birth)).toBe(1);
        expect(otherRevertChanges(diff([row('p1', 'deathDate')]), birth)).toBe(1);
        expect(otherRevertChanges(diff([], { addedPersons: 1 }), birth)).toBe(1);
        // The value coming back into a field emptied here is the value put back.
        expect(otherRevertChanges(diff([], { addedFacts: 1, filled: [row('p1', 'birthPlace')] }), birth)).toBe(0);
    });
});
