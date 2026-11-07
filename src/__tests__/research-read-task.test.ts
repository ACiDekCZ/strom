/**
 * Who creates the task after a source is read again (spec 059, `read.sourceTask`): the research's fields are
 * checked and cleaned, an older research (no feature, no fields) gives "nothing said", the app's choice goes
 * through one call, `taskChoice` only with the feature. Invented data only (Vlk, Doubrava).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    READ_SOURCE_TASK_FEATURE, readTaskChoiceFor, readTaskPath, sanitizeSourceTaskInfo, sanitizeVariantTask, sanitizeReadTaskReply,
    sanitizeReadSourceProposal, sanitizeReadSourceState, sanitizeReadAgain, sanitizeTaskSetting, readTaskId,
    readJudgedId, readJudgedKept, readTaskRefusal, readProposalStale, READ_TASK_CODES,
} from '../research-read-task.js';
import { sanitizeReadAccepts, sanitizeReadResult, startSourceRead, postReadTask, postReadProposal } from '../research-read.js';

const ID = 'D20261019153012-a1b2';
const BASE = 'http://127.0.0.1:1/t';

const result = (source: Record<string, unknown>) => ({
    id: ID, state: 'done', lang: 'cs',
    doc: { kind: 'register.baptism', language: ['la'], legible: 'yes', why: null },
    readers: { asked: 2, ran: 2, agree: 'differ' },
    pages: [],
    entries: [{ id: 'e1', page: 1, transcript: 'Josephi Vlk in Doubrava N. 7', variants: [] }],
    source,
});

describe('the research\'s fields', () => {
    it('a source read again with the setting, the offer, the task for whom, a decision made before, the open task', () => {
        const r = sanitizeReadResult(result({
            id: 'S0042', agree: 'differ', task: 'T0417', taskSetting: 'ask', taskOffer: true, taskFor: 'person', decided: 'saved', openTask: 'T0399',
            variants: [{ at: 'Dubrava', other: 'Doubrava', sure: true }, { at: 'N. 4', other: 'N. 7', sure: false }, { at: 'Wlk', other: 'Vlk', judged: 'T0399' }],
        }))!;
        expect(r.source).toMatchObject({ id: 'S0042', task: 'T0417', taskSetting: 'ask', taskOffer: true, taskFor: 'person', decided: 'saved', openTask: 'T0399' });
        expect(r.source!.variants).toEqual([
            { at: 'Dubrava', other: 'Doubrava', sure: true }, { at: 'N. 4', other: 'N. 7', sure: false }, { at: 'Wlk', other: 'Vlk', judged: 'T0399' },
        ]);
    });

    it('without the fields (an older research): nothing added, the result as before', () => {
        const r = sanitizeReadResult(result({ id: 'S0042', agree: 'differ', task: 'T0417', variants: [{ at: 'Dubrava', other: 'Doubrava' }] }))!;
        expect(r.source).toEqual({ id: 'S0042', agree: 'differ', task: 'T0417', variants: [{ at: 'Dubrava', other: 'Doubrava' }] });
        expect(sanitizeSourceTaskInfo({})).toBeNull();
        expect(sanitizeVariantTask({ at: 'a', other: 'b' })).toEqual({});
        expect(sanitizeReadAccepts({ ready: true })?.sourceTask).toBeUndefined();
    });

    it('cleans what is not the contract', () => {
        expect(sanitizeSourceTaskInfo({ taskSetting: 'sometimes', taskOffer: true })).toBeNull();
        expect(sanitizeSourceTaskInfo({ taskSetting: 'never', taskOffer: 'yes', taskFor: 'robot', decided: 'later', openTask: '../x' }))
            .toEqual({ taskSetting: 'never', taskOffer: false });
        expect(sanitizeVariantTask({ sure: 'no', judged: 'T04x' })).toEqual({});
        expect(sanitizeTaskSetting('always')).toBe('always');
        expect(readTaskId('T0417')).toBe('T0417');
        expect(readTaskId('S0417')).toBe('');
        expect(sanitizeReadAccepts({ ready: true, sourceTask: 'ask' })?.sourceTask).toBe('ask');
        expect(sanitizeReadAccepts({ ready: true, sourceTask: 'often' })?.sourceTask).toBeUndefined();
    });

    it('judged: a task (T…) or a reading a person kept (D…); anything else none', () => {
        const KEPT = 'D20261105101500-c3d4';
        expect(sanitizeVariantTask({ judged: KEPT })).toEqual({ judged: KEPT });
        expect(sanitizeVariantTask({ judged: 'T0399', sure: true })).toEqual({ judged: 'T0399', sure: true });
        expect(readJudgedId('D2026-x')).toBe('');
        expect(readJudgedKept(KEPT)).toBe(true);
        expect(readJudgedKept('T0399')).toBe(false);
        expect(readJudgedKept(undefined)).toBe(false);
        const r = sanitizeReadResult(result({ id: 'S0042', agree: 'differ', variants: [{ at: 'Wlk', other: 'Vlk', judged: KEPT }] }))!;
        expect(r.source!.variants).toEqual([{ at: 'Wlk', other: 'Vlk', judged: KEPT }]);
    });

    it('source.state: the source\'s state after this reading, in the shape of /status.readAgain', () => {
        const r = sanitizeReadResult(result({ id: 'S0042', agree: 'differ', task: 'T0417', taskSetting: 'ask', taskOffer: true,
            state: { read: ID, state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true, taskQueued: true }, variants: [] }))!;
        expect(r.source!.state).toEqual({ read: ID, state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true, taskQueued: true });
        // Without its `read`, or a bare word: of this reading.
        expect(sanitizeReadResult(result({ id: 'S0042', agree: 'differ', taskSetting: 'ask', state: { state: 'unchecked' }, variants: [] }))!.source!.state)
            .toEqual({ read: ID, state: 'unchecked' });
        expect(sanitizeReadResult(result({ id: 'S0042', agree: 'differ', taskSetting: 'ask', state: 'saved', variants: [] }))!.source!.state)
            .toEqual({ read: ID, state: 'saved' });
        expect(sanitizeReadResult(result({ id: 'S0042', agree: 'differ', taskSetting: 'ask', state: 'later', variants: [] }))!.source).not.toHaveProperty('state');
    });

    it('the answer to a choice: the task, a chat asked for, the places added to the open task', () => {
        expect(sanitizeReadTaskReply({ task: 'T0418', chat: 'C12', appended: true })).toEqual({ task: 'T0418', chat: 'C12', appended: true });
        expect(sanitizeReadTaskReply(null)).toEqual({ task: '', chat: '', appended: false });
        expect(sanitizeReadTaskReply({ task: 'rm -rf', appended: 'yes' })).toEqual({ task: '', chat: '', appended: false });
    });
});

describe('/status.readAgain and the agent\'s proposal (for the source\'s row)', () => {
    const proposal = { text: 'Josephi Vlk\nin Doubrava N. 7', by: { program: 'agent', model: 'm-1' }, task: 'T0417', at: '2026-11-06T10:00:00Z',
        places: [{ at: 'in Doubrava', old: 'Dubrava', new: 'Doubrava', kind: 'spelling' }, { old: '', new: '' }] };

    it('each source\'s state with its task and flags; a proposal with its places', () => {
        const m = sanitizeReadAgain({
            S0042: { read: ID, state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true, taskQueued: false, proposal },
            S0043: { read: ID, state: 'saved', minorOnly: true, unsureOnly: 'yes' },
            S0044: { read: 'nope', state: 'task' },
            '../x': { read: ID, state: 'saved' },
        });
        expect([...m.keys()]).toEqual(['S0042', 'S0043']);
        expect(m.get('S0042')).toEqual({
            read: ID, state: 'task', task: 'T0417', taskFor: 'agent', taskOpen: true,
            proposal: { text: 'Josephi Vlk\nin Doubrava N. 7', by: 'agent · m-1', task: 'T0417', at: '2026-11-06T10:00:00Z',
                places: [{ at: 'in Doubrava', old: 'Dubrava', new: 'Doubrava', kind: 'spelling' }] },
        });
        expect(m.get('S0043')).toEqual({ read: ID, state: 'saved', minorOnly: true });
        expect(sanitizeReadAgain(undefined).size).toBe(0);
        expect(sanitizeReadSourceState({ read: ID, state: 'done' })).toBeNull();
    });

    it('a proposal without its text or task is none; no places said: the app counts them itself', () => {
        expect(sanitizeReadSourceProposal({ ...proposal, text: '' })).toBeNull();
        expect(sanitizeReadSourceProposal({ ...proposal, task: 'x' })).toBeNull();
        const { places: _p, ...noPlaces } = proposal;
        expect(sanitizeReadSourceProposal(noPlaces)).not.toHaveProperty('places');
        // The research's own shape: `by` a string, no places.
        expect(sanitizeReadSourceProposal({ text: 'x', by: 'agent · opus · high + agent · m-2', task: 'T0417', at: '2026-11-06T10:00:00Z' }))
            .toEqual({ text: 'x', by: 'agent · opus · high + agent · m-2', task: 'T0417', at: '2026-11-06T10:00:00Z' });
    });
});

describe('the bridge calls', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
        const f = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', f);
        return f;
    }
    const sent = (f: ReturnType<typeof vi.fn>): { url: string; body: Record<string, unknown> } => {
        const [url, init] = f.mock.calls[0] as [string, RequestInit];
        return { url: url.replace(/[?&]v=[^&]*/, ''), body: JSON.parse(String(init.body)) };
    };

    it('taskChoice only with the feature: an older research gets the request as before', async () => {
        expect(readTaskChoiceFor(null)).toEqual({});
        expect(readTaskChoiceFor(['read', 'read.source'])).toEqual({});
        expect(readTaskChoiceFor(['read', 'read.source', READ_SOURCE_TASK_FEATURE])).toEqual({ taskChoice: true });
        for (const features of [['read.source'], ['read.source', READ_SOURCE_TASK_FEATURE]]) {
            const f = stubFetch(202, { read: ID, state: 'queued' });
            await startSourceRead(BASE, { source: 'S0042', readers: 2, ...readTaskChoiceFor(features) });
            const { body } = sent(f);
            if (features.includes(READ_SOURCE_TASK_FEATURE)) expect(body.taskChoice).toBe(true);
            else expect(body).not.toHaveProperty('taskChoice');
            vi.unstubAllGlobals();
        }
    });

    it('the choice: one call `sources/<S>/read/<D>/task {how}`', async () => {
        expect(readTaskPath('S0042', ID)).toBe(`/sources/S0042/read/${ID}/task`);
        const f = stubFetch(200, { task: 'T0418', chat: '', appended: false });
        const r = await postReadTask(BASE, 'S0042', ID, 'queue');
        expect(r).toEqual({ ok: true, value: { task: 'T0418', chat: '', appended: false } });
        const { url, body } = sent(f);
        expect(url).toContain(`${BASE}/sources/S0042/read/${ID}/task`);
        expect(body).toEqual({ how: 'queue' });
    });

    it('a refused or bad choice is a failure; a bad id is not sent', async () => {
        stubFetch(500, { code: 'oops' });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect((await postReadTask(BASE, 'S0042', ID, 'now')).ok).toBe(false);
        const f = stubFetch(200, {});
        expect((await postReadTask(BASE, '../S', ID, 'now')).ok).toBe(false);
        expect(f).not.toHaveBeenCalled();
    });

    it('the proposal\'s answer goes to its own path, with the task also for undo', async () => {
        let f = stubFetch(200, { ok: true });
        await postReadProposal(BASE, 'S0042', 'T0417', 'keep');
        expect(sent(f).url).toContain(`${BASE}/sources/proposal`);
        expect(sent(f).body).toEqual({ source: 'S0042', task: 'T0417', take: 'keep' });
        vi.unstubAllGlobals();
        f = stubFetch(200, { ok: true });
        await postReadProposal(BASE, 'S0042', 'T0417', 'undo');
        expect(sent(f).body).toEqual({ source: 'S0042', task: 'T0417', take: 'undo' });
    });

    it('409 read.decide.task: the task that holds the places, an answer (the task beside the code or in params)', async () => {
        stubFetch(409, { code: 'read.decide.task', task: 'T0410', error: 'A task holds it.' });
        expect(await postReadTask(BASE, 'S0042', ID, 'queue')).toEqual({ ok: true, value: { task: 'T0410', chat: '', appended: false, outcome: 'held' } });
        vi.unstubAllGlobals();
        stubFetch(409, { code: 'read.decide.task', params: { task: 'T0411' } });
        expect(await postReadTask(BASE, 'S0042', ID, 'save')).toMatchObject({ ok: true, value: { task: 'T0411', outcome: 'held' } });
        vi.unstubAllGlobals();
        // Without a task to open: a failure as before.
        stubFetch(409, { code: 'read.decide.task' });
        expect((await postReadTask(BASE, 'S0042', ID, 'save')).ok).toBe(false);
    });

    it('409 read.decide.done / nothing: nothing left to decide, an answer; busy and the other refusals: failures', async () => {
        for (const code of [READ_TASK_CODES.done, READ_TASK_CODES.nothing]) {
            stubFetch(409, { code });
            expect(await postReadTask(BASE, 'S0042', ID, 'now')).toEqual({ ok: true, value: { task: '', chat: '', appended: false, outcome: 'settled' } });
            vi.unstubAllGlobals();
        }
        for (const [status, code] of [[503, 'research.busy'], [409, 'read.decide.confirmed'], [409, 'read.decide.declined'], [404, 'read.decide.none'], [400, 'read.decide.invalid']] as const) {
            stubFetch(status, { code });
            const r = await postReadTask(BASE, 'S0042', ID, 'now');
            expect(r.ok).toBe(false);
            vi.unstubAllGlobals();
        }
        expect(readTaskRefusal(400, { code: 'read.decide.done' })).toBeNull();
    });

    it('the proposal moved on meanwhile (decided, changed, nothing to undo): stale, not a failure', async () => {
        for (const code of [READ_TASK_CODES.proposalDecided, READ_TASK_CODES.proposalChanged, READ_TASK_CODES.proposalUndo]) {
            expect(readProposalStale(409, code)).toBe(true);
            stubFetch(409, { code });
            const r = await postReadProposal(BASE, 'S0042', 'T0417', 'proposal');
            expect(r.ok === false && readProposalStale(r.failure.status, r.failure.code)).toBe(true);
            vi.unstubAllGlobals();
        }
        expect(readProposalStale(409, 'proposal.archive')).toBe(false);
        expect(readProposalStale(503, 'research.busy')).toBe(false);
        expect(readProposalStale(400, 'proposal.decided')).toBe(false);
    });
});
