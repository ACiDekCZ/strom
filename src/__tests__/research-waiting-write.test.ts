/**
 * "Awaiting action" written through the bridge (variant B of Strom Research
 * 1.13.2-beta.13): which writes the bridge takes (`waiting.sent`,
 * `waiting.note`, `accepts.media.task`), which items and places offer them,
 * the requests (paths with the key encoded, method, body, `X-Strom-Task`),
 * every answer typed, one request at a time per write, and the optimistic
 * move with its rollback. Invented offices, families and hosts only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LiveWaiting, sanitizeAccepts, sanitizeWaiting } from '../research-link.js';
import {
    WAITING_NOTE_FEATURE, WAITING_SENT_FEATURE, WaitingPending, applyWaitingPending, getGroupNote, groupNoteReply, postGroupSent, postGroupUnsent, postWaitingSent,
    putWaitingFile, retryAfterSeconds, settleWaitingPending, waitingFileReply, waitingFileTaken, waitingGroupHasNote, waitingGroupPath,
    waitingGroupSendable, waitingSendable, waitingSentReply, waitingUnsendable, waitingWrites, waitingWrittenPhase, waitingFileWritable,
} from '../research-waiting-write.js';
import { waitingPhases } from '../research-waiting.js';

const BASE = 'http://127.0.0.1:47321/0123456789abcdef';
const OFFICE = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };
const HEAD = 'b'.repeat(40);

const items = (raw: Record<string, unknown>[]): LiveWaiting[] => sanitizeWaiting(raw, true);
const letter = (id: string, extra: Record<string, unknown> = {}) => ({
    id, what: `Dopis ${id}`, at: '2026-10-01T08:00:00Z', kind: 'letter', section: 'letter', group: OFFICE,
    note: `notes/${id}-dotaz.md`, actions: ['answer', 'file', 'note', 'sent', 'chat'], ...extra,
});

describe('which writes the bridge takes', () => {
    it('only what it announces', () => {
        expect(waitingWrites({ features: null, accepts: null })).toEqual({ sent: false, note: false, file: false });
        expect(waitingWrites({ features: ['waiting.groups'], accepts: sanitizeAccepts({ media: {} }) })).toEqual({ sent: false, note: false, file: false });
        expect(waitingWrites({ features: [WAITING_SENT_FEATURE], accepts: null })).toEqual({ sent: true, note: false, file: false });
        expect(waitingWrites({ features: [WAITING_NOTE_FEATURE], accepts: null })).toEqual({ sent: false, note: true, file: false });
        expect(waitingWrites({ features: [], accepts: sanitizeAccepts({ media: { task: true } }) })).toEqual({ sent: false, note: false, file: true });
    });

    it('accepts.media.task only when exactly true; absent otherwise', () => {
        expect(sanitizeAccepts({ media: { task: true } })?.mediaTask).toBe(true);
        for (const task of ['true', 1, {}, false, undefined]) {
            const a = sanitizeAccepts({ media: { task } });
            expect(a?.mediaTask).toBeUndefined();
            expect(a && 'mediaTask' in a).toBe(false);
        }
        expect(sanitizeAccepts({})?.mediaTask).toBeUndefined();
    });
});

describe('what offers a write', () => {
    it('an item to do with sent in its actions; not one sent, without it, of a decision, or without a task id', () => {
        const [todo, sent, noSent, check, permission, bad] = items([
            letter('T0001'),
            letter('T0002', { phase: 'sent', sentAt: '2026-10-02T09:00:00Z' }),
            letter('T0003', { actions: ['answer', 'file'] }),
            { id: 'T0004', what: 'Ověřit web', kind: 'check', section: 'decide', actions: ['answer', 'sent'] },
            { id: 'x', what: 'Svolení', kind: 'permission', host: 'archiv.example', actions: ['sent'] },
            letter('K12'),
        ]);
        expect(waitingSendable(todo)).toBe(true);
        expect(waitingSendable(sent)).toBe(false);
        expect(waitingSendable(noSent)).toBe(false);
        // A check is a kind the bridge does not mark sent (409): its link stays (part a).
        expect(waitingSendable(check)).toBe(false);
        expect(waitingSendable(permission)).toBe(false);
        expect(waitingSendable(bad)).toBe(false);
    });

    it('a file through the bridge: a task with file in its actions, never a check, a permission, a takeover or a story', () => {
        const [withFile, noFile, check, permission, takeover, story, bad] = items([
            letter('T0021', { actions: ['answer', 'file'] }),
            letter('T0022', { actions: ['answer'] }),
            { id: 'T0023', what: 'Ověřit web', kind: 'check', section: 'decide', actions: ['answer', 'file'] },
            { id: 'T0024', what: 'Svolení', kind: 'permission', host: 'archiv.example', actions: ['file'] },
            { id: 'T0025', what: 'Převzetí', kind: 'takeover', actions: ['file'] },
            { id: 'T0026', what: 'Příběh', kind: 'story', person: 'P0001', actions: ['file'] },
            letter('K12', { actions: ['file'] }),
        ]);
        expect(waitingFileWritable(withFile)).toBe(true);
        for (const w of [noFile, check, permission, takeover, story, bad]) expect(waitingFileWritable(w)).toBe(false);
    });

    it('back to do: a sent letter, family or other task; never one to do or a decision', () => {
        const [sentLetter, sentFamily, sentWeb, todo] = items([
            letter('T0011', { phase: 'sent', actions: ['answer', 'file', 'chat'] }),
            { id: 'T0012', what: 'Dotaz rodině', kind: 'family', section: 'family', phase: 'sent', actions: ['answer'] },
            { id: 'T0013', what: 'Web', kind: 'web', section: 'web', phase: 'sent', actions: ['answer'] },
            letter('T0014'),
        ]);
        expect(waitingUnsendable(sentLetter)).toBe(true);
        expect(waitingUnsendable(sentFamily)).toBe(true);
        expect(waitingUnsendable(sentWeb)).toBe(false);
        expect(waitingUnsendable(todo)).toBe(false);
    });

    it('a place: its sendable items to do, and whether any has a query text', () => {
        const list = items([
            letter('T0021'), letter('T0022', { actions: ['answer'] }), letter('T0023', { phase: 'sent' }), letter('T0024'),
        ]);
        expect(waitingGroupSendable(list).map(w => w.id)).toEqual(['T0021', 'T0024']);
        expect(waitingGroupHasNote(list)).toBe(true);
        expect(waitingGroupHasNote(items([letter('T0031', { note: undefined })]))).toBe(false);
    });

    it('a file: images and PDF only', () => {
        expect(waitingFileTaken({ type: 'image/jpeg', name: 'a.jpg' })).toBe(true);
        expect(waitingFileTaken({ type: 'application/pdf', name: 'a.pdf' })).toBe(true);
        expect(waitingFileTaken({ type: '', name: 'odpoved.PDF' })).toBe(true);
        expect(waitingFileTaken({ type: 'text/plain', name: 'a.txt' })).toBe(false);
    });
});

describe('the answers, typed', () => {
    it('200: what it wrote and its version', () => {
        expect(waitingSentReply(200, { sent: ['T0001', 'T0002', 'bad', 'T0001'], head: HEAD })).toEqual({ ok: true, sent: ['T0001', 'T0002'], head: HEAD });
        expect(waitingSentReply(200, { sent: 'T0001', head: 'nope' })).toEqual({ ok: true, sent: [], head: '' });
        expect(waitingSentReply(200, null)).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('an item\'s answer: its task and the phase it is in now; the row follows that phase', () => {
        // Already sent: nothing changed (`sent: []`), the task is in phase sent.
        const already = waitingSentReply(200, { sent: [], task: 'T0001', phase: 'sent', head: HEAD });
        expect(already).toEqual({ ok: true, sent: [], head: HEAD, task: 'T0001', phase: 'sent' });
        expect(waitingWrittenPhase(already, 'T0001', 'sent')).toBe('sent');
        // Asked sent, the research has it to do: the row goes to To do; asked back, it is still sent.
        expect(waitingWrittenPhase(waitingSentReply(200, { sent: [], task: 'T0001', phase: 'todo' }), 'T0001', 'sent')).toBe('todo');
        expect(waitingWrittenPhase(waitingSentReply(200, { unsent: [], task: 'T0001', phase: 'sent' }, null, 'either'), 'T0001', 'todo')).toBe('sent');
        // No phase, a phase of another task, or a phase it does not know: the one asked for.
        expect(waitingWrittenPhase(waitingSentReply(200, { sent: ['T0001'] }), 'T0001', 'sent')).toBe('sent');
        expect(waitingWrittenPhase(waitingSentReply(200, { sent: [], task: 'T0002', phase: 'todo' }), 'T0001', 'sent')).toBe('sent');
        expect(waitingSentReply(200, { sent: [], task: 'T0001', phase: 'done' })).toEqual({ ok: true, sent: [], head: '' });
        expect(waitingSentReply(200, { sent: [], task: 'P0001', phase: 'sent' })).toEqual({ ok: true, sent: [], head: '' });
        expect(waitingWrittenPhase(waitingSentReply(423, { code: 'locked' }), 'T0001', 'sent')).toBe('sent');
    });

    it('every refusal by its status and code', () => {
        const r = (status: number, body: unknown, retry?: string) => waitingSentReply(status, body, retry);
        expect(r(404, { code: 'waiting.none' })).toMatchObject({ ok: false, code: 'none', status: 404 });
        expect(r(404, null)).toMatchObject({ ok: false, code: 'unknown', status: 404 });
        expect(r(409, { code: 'waiting.not-sendable', text: 'Not a letter.' })).toMatchObject({ ok: false, code: 'not-sendable', status: 409, reason: 'Not a letter.' });
        // 409: a task waiting no more (a file for it) goes quietly like a 404; a task that takes no file; anything else unknown, never busy.
        expect(r(409, { code: 'waiting.none' })).toMatchObject({ ok: false, code: 'none', status: 409 });
        expect(r(409, { code: 'waiting.no-file' })).toMatchObject({ ok: false, code: 'no-file', status: 409 });
        // A place gone meanwhile (its writes and its queries' text): quietly, like a task waiting no more.
        expect(r(404, { code: 'group.none' })).toMatchObject({ ok: false, code: 'none', status: 404 });
        expect(r(409, { code: 'group.none' })).toMatchObject({ ok: false, code: 'none', status: 409 });
        expect(groupNoteReply(404, { code: 'group.none' })).toMatchObject({ ok: false, code: 'none', status: 404 });
        expect(groupNoteReply(409, { code: 'group.none' })).toMatchObject({ ok: false, code: 'none', status: 409 });
        expect(r(409, { code: 'other' })).toMatchObject({ ok: false, code: 'unknown', status: 409, retryAfter: null });
        expect(r(409, null, '5')).toMatchObject({ ok: false, code: 'unknown', retryAfter: null });
        // 400: any bad request, the body's or a file's headers.
        expect(r(400, { code: 'waiting.bad-body' })).toMatchObject({ ok: false, code: 'bad-body', status: 400 });
        expect(r(400, { code: 'media.bad-header' })).toMatchObject({ ok: false, code: 'bad-body', status: 400 });
        expect(r(400, null)).toMatchObject({ ok: false, code: 'bad-body', status: 400 });
        expect(r(423, { code: 'locked' })).toMatchObject({ ok: false, code: 'locked', status: 423, retryAfter: null });
        expect(r(403, { code: 'app.only' })).toMatchObject({ ok: false, code: 'app-only', status: 403 });
        expect(r(503, { code: 'research.busy' }, '5')).toMatchObject({ ok: false, code: 'busy', status: 503, retryAfter: 5 });
        expect(r(503, { code: 'research.busy' }, 'Wed, 21 Oct 2026 07:28:00 GMT')).toMatchObject({ code: 'busy', retryAfter: null });
        // 5xx: busy only for 503, full for 507, else the research could not write it.
        expect(r(500, { code: 'waiting.failed' })).toMatchObject({ ok: false, code: 'failed', status: 500 });
        expect(r(500, null)).toMatchObject({ ok: false, code: 'failed', status: 500 });
        expect(r(502, null)).toMatchObject({ ok: false, code: 'failed', status: 502 });
        expect(r(507, null)).toMatchObject({ ok: false, code: 'full' });
        expect(waitingFileReply(409, { code: 'waiting.none' })).toMatchObject({ ok: false, code: 'none' });
        expect(waitingFileReply(409, { code: 'waiting.no-file' })).toMatchObject({ ok: false, code: 'no-file' });
        expect(waitingFileReply(400, { code: 'media.bad-header' })).toMatchObject({ ok: false, code: 'bad-body' });
        expect(waitingFileReply(500, { code: 'waiting.failed' })).toMatchObject({ ok: false, code: 'failed' });
        expect(retryAfterSeconds(' 12 ')).toBe(12);
        expect(retryAfterSeconds('-1')).toBeNull();
    });

    it('a place\'s queries: the text with its lines, only notes/….md paths, only task ids; no text: none', () => {
        const r = groupNoteReply(200, {
            text: 'Vážený úřade,\r\nprosím o zápis.\u0007\n\n— T0021\tT0024',
            notes: ['notes/T0021-dotaz.md', '../etc/passwd', 'notes/T0021-dotaz.md', 'notes/a b.md'],
            tasks: ['T0021', 'T0024', 'P0001'],
        });
        expect(r).toEqual({
            ok: true, text: 'Vážený úřade,\nprosím o zápis.\n\n— T0021\tT0024', notes: ['notes/T0021-dotaz.md'], tasks: ['T0021', 'T0024'],
        });
        expect(groupNoteReply(200, { text: '  ' })).toMatchObject({ ok: false, code: 'none' });
        expect(groupNoteReply(404, { code: 'waiting.none' })).toMatchObject({ ok: false, code: 'none' });
        expect(groupNoteReply(503, {}, '3')).toMatchObject({ ok: false, code: 'busy', retryAfter: 3 });
    });

    it('a file: its id, or why not', () => {
        expect(waitingFileReply(200, { input: 'I0042' })).toEqual({ ok: true, input: 'I0042' });
        expect(waitingFileReply(201, {})).toEqual({ ok: true, input: '' });
        expect(waitingFileReply(413, null)).toMatchObject({ ok: false, code: 'too-large' });
        expect(waitingFileReply(415, null)).toMatchObject({ ok: false, code: 'type' });
        expect(waitingFileReply(507, null)).toMatchObject({ ok: false, code: 'full' });
        expect(waitingFileReply(404, { code: 'waiting.none' })).toMatchObject({ ok: false, code: 'none' });
    });
});

describe('the requests', () => {
    let calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        calls = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers });
        }));
    };
    afterEach(() => vi.unstubAllGlobals());

    it('an item: POST <token>/waiting/<T…> with {"do":"sent"} / {"do":"unsent"}, a simple request with the app\'s version', async () => {
        answer(200, { sent: ['T0001'], head: HEAD });
        expect(await postWaitingSent(BASE, 'T0001', 'sent')).toEqual({ ok: true, sent: ['T0001'], head: HEAD });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:47321\/0123456789abcdef\/waiting\/T0001\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store' });
        expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/);
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'sent' });
        answer(200, { sent: [], head: HEAD });
        await postWaitingSent(BASE, 'T0001', 'unsent');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'unsent' });
        // An item back to do: its answer's `unsent` or `sent`, or no list at all, is done.
        answer(200, { unsent: ['T0001'], head: HEAD });
        expect(await postWaitingSent(BASE, 'T0001', 'unsent')).toEqual({ ok: true, sent: ['T0001'], head: HEAD });
        answer(200, { sent: ['T0001'], head: HEAD });
        expect(await postWaitingSent(BASE, 'T0001', 'unsent')).toEqual({ ok: true, sent: ['T0001'], head: HEAD });
        answer(200, { head: HEAD });
        expect(await postWaitingSent(BASE, 'T0001', 'unsent')).toEqual({ ok: true, sent: [], head: HEAD });
    });

    it('a place: POST <token>/group/<key> with the key encoded; its queries: GET …/note', async () => {
        answer(200, { sent: ['T0021', 'T0024'], head: HEAD });
        await postGroupSent(BASE, 'to:MěÚ Vzorov/2');
        expect(calls[0].url).toMatch(/\/group\/to%3AM%C4%9B%C3%9A%20Vzorov%2F2\?app=/);
        expect(calls[0].init.method).toBe('POST');
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'sent' });
        // Back to do: exactly the tasks named (well-formed, each once); the answer's `unsent` is what went back.
        answer(200, { unsent: ['T0021'], sent: ['T0099'], head: HEAD });
        expect(await postGroupUnsent(BASE, 'to:MěÚ Vzorov/2', ['T0021', 'P0001', 'T0024', 'T0021', ' x'])).toEqual({ ok: true, sent: ['T0021'], head: HEAD });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/\/group\/to%3AM%C4%9B%C3%9A%20Vzorov%2F2\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit' });
        expect(JSON.parse(calls[0].init.body as string)).toEqual({ do: 'unsent', tasks: ['T0021', 'T0024'] });
        answer(200, { sent: ['T0021'], head: HEAD });
        expect(await postGroupUnsent(BASE, 'family', ['T0021'])).toEqual({ ok: true, sent: [], head: HEAD });
        answer(200, {});
        expect(await postGroupUnsent(BASE, '  ', ['T0021'])).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postGroupUnsent(BASE, 'family', [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postGroupUnsent(BASE, 'family', ['bad', 'P0001'])).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
        answer(400, { error: 'tasks missing', code: 'waiting.bad-body' });
        expect(await postGroupUnsent(BASE, 'family', ['T0021'])).toMatchObject({ ok: false, code: 'bad-body', status: 400 });
        answer(200, { text: 'Text', notes: [], tasks: ['T0021'] });
        expect(await getGroupNote(BASE, 'to:MěÚ Vzorov/2')).toEqual({ ok: true, text: 'Text', notes: [], tasks: ['T0021'] });
        expect(calls[0].url).toMatch(/\/group\/to%3AM%C4%9B%C3%9A%20Vzorov%2F2\/note\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit' });
        expect(calls[0].init.body).toBeUndefined();
    });

    it('a 503 carries its Retry-After', async () => {
        answer(503, { code: 'research.busy' }, { 'Retry-After': '7' });
        expect(await postWaitingSent(BASE, 'T0001', 'sent')).toMatchObject({ ok: false, code: 'busy', retryAfter: 7 });
    });

    it('not sent at all: a wrong task id, an empty key, another verb', async () => {
        answer(200, {});
        expect(await postWaitingSent(BASE, 'P0001', 'sent')).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postWaitingSent(BASE, 'T0001', 'answer' as 'sent')).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postGroupSent(BASE, '  ')).toMatchObject({ ok: false, code: 'invalid' });
        expect(await getGroupNote(BASE, 'x'.repeat(201))).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
        expect(waitingGroupPath('family')).toBe('family');
    });

    it('no answer, or not in time: network', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        expect(await postWaitingSent(BASE, 'T0001', 'sent')).toMatchObject({ ok: false, code: 'network', status: 0 });
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })));
        expect(await postGroupSent(BASE, 'family', { timeoutMs: 20 })).toMatchObject({ ok: false, code: 'network' });
    });

    it('a double click: one request, the same answer; done, a new one goes', async () => {
        let release: (r: Response) => void = () => {};
        const fetchMock = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
        vi.stubGlobal('fetch', fetchMock);
        const first = postWaitingSent(BASE, 'T0001', 'sent');
        const second = postWaitingSent(BASE, 'T0001', 'sent');
        expect(second).toBe(first);
        // Another task, or back to do, is its own request.
        void postWaitingSent(BASE, 'T0002', 'sent');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        release(new Response(JSON.stringify({ sent: ['T0002'] }), { status: 200 }));
        const g1 = postGroupSent(BASE, 'family');
        const g2 = postGroupSent(BASE, 'family');
        expect(g2).toBe(g1);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        release(new Response(JSON.stringify({ sent: [] }), { status: 200 }));
        await Promise.all([g1, g2]);
        answer(200, { sent: ['T0021'] });
        await postGroupSent(BASE, 'family');
        expect(calls).toHaveLength(1);
    });

    it('a file: PUT <token>/media/<sha256> with X-Strom-Task and its name, the file as the body', async () => {
        answer(200, { input: 'I0042' });
        const file = new File(['%PDF-1.4 odpověď úřadu'], 'odpověď.pdf', { type: 'application/pdf' });
        expect(await putWaitingFile(BASE, 'T0021', file)).toEqual({ ok: true, input: 'I0042' });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/\/media\/[0-9a-f]{64}\?app=/);
        expect(calls[0].init).toMatchObject({ method: 'PUT', mode: 'cors', credentials: 'omit' });
        const headers = calls[0].init.headers as Record<string, string>;
        expect(headers['X-Strom-Task']).toBe('T0021');
        expect(headers['X-Strom-Name']).toBe(encodeURIComponent('odpověď.pdf'));
        expect(headers['Content-Type']).toBe('application/pdf');
        expect(headers['X-Strom-Person']).toBeUndefined();
        expect(calls[0].init.body).toBe(file);
    });

    it('a file too large for the research, or for a wrong task: not sent', async () => {
        answer(200, {});
        const file = new File(['x'.repeat(100)], 'a.jpg', { type: 'image/jpeg' });
        expect(await putWaitingFile(BASE, 'T0021', file, { maxBytes: 10 })).toMatchObject({ ok: false, code: 'too-large' });
        expect(await putWaitingFile(BASE, 'X0001', file)).toMatchObject({ ok: false, code: 'invalid' });
        expect(calls).toHaveLength(0);
    });
});

describe('the optimistic move', () => {
    const list = () => items([letter('T0001'), letter('T0002'), letter('T0003', { phase: 'sent', sentAt: '2026-10-02T09:00:00Z' })]);

    it('a row marked sent moves to Awaiting a reply at once; back to do moves the other way; gone goes', () => {
        const pending = new Map<string, WaitingPending>([
            ['T0001', { phase: 'sent', sentAt: '2026-10-11T10:00:00.000Z', until: Infinity }],
            ['T0003', { phase: 'todo', until: Infinity }],
        ]);
        const shown = applyWaitingPending(list(), pending);
        expect(shown.map(w => [w.id, w.phase ?? 'todo', w.sentAt])).toEqual([
            ['T0001', 'sent', '2026-10-11T10:00:00.000Z'], ['T0002', 'todo', undefined], ['T0003', 'todo', undefined],
        ]);
        const phases = waitingPhases(shown, 'all');
        expect(phases.sent.flatMap(g => g.items.map(w => w.id))).toEqual(['T0001']);
        expect(phases.todo.flatMap(g => g.items.map(w => w.id))).toEqual(['T0002', 'T0003']);
        expect(applyWaitingPending(list(), new Map([['T0002', { phase: 'sent', gone: true, until: Infinity }]])).map(w => w.id)).toEqual(['T0001', 'T0003']);
        // The research's own list is untouched.
        expect(list()[0].phase).toBeUndefined();
    });

    it('rollback: without the move the row is where the research has it; a move whose time ran out counts no more', () => {
        const pending = new Map<string, WaitingPending>([['T0001', { phase: 'sent', until: Infinity }]]);
        expect(applyWaitingPending(list(), pending)[0].phase).toBe('sent');
        pending.delete('T0001');
        expect(applyWaitingPending(list(), pending)[0].phase).toBeUndefined();
        expect(applyWaitingPending(list(), new Map([['T0001', { phase: 'sent', until: 1000 }]]), 2000)[0].phase).toBeUndefined();
    });

    it('settled: dropped once the status agrees, the item is gone or the time ran out; kept while it is written or the status lags', () => {
        const pending = new Map<string, WaitingPending>([
            ['T0001', { phase: 'sent', until: 5000 }],       // the status still says to do: kept
            ['T0002', { phase: 'sent', until: Infinity }],   // still written: kept whatever the status says
            ['T0003', { phase: 'sent', until: 5000 }],       // the status agrees: dropped
            ['T0009', { phase: 'sent', until: 5000 }],       // gone from the list: dropped
        ]);
        settleWaitingPending(pending, list(), 1000);
        expect([...pending.keys()]).toEqual(['T0001', 'T0002']);
        settleWaitingPending(pending, list(), 6000);
        expect([...pending.keys()]).toEqual(['T0002']);
        // A row reported gone (404) stays hidden until the status drops it.
        const gone = new Map<string, WaitingPending>([['T0001', { phase: 'sent', gone: true, until: 5000 }]]);
        settleWaitingPending(gone, list(), 1000);
        expect(gone.size).toBe(1);
        settleWaitingPending(gone, list().slice(1), 1000);
        expect(gone.size).toBe(0);
    });
});
