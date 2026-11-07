/**
 * Spec 059: who reads a document and who read it — the readers the research
 * offers (`accepts.read.choices`, feature `read.choose`), `with` sent only
 * where a reader differs from the default, who read (`readers.who`, `who`),
 * a source read again from its original (`POST sources/read`, feature
 * `read.source`) and the bridge's refusals of all of it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    readersChanged, readersFromStored, readerDefault, readerHeld, readerWithAgent, readWhoLabel, readWhoOtherAgents,
    readWhoSame, readWith, sanitizeReadChoices, sanitizeReadWho, type ReadChoices,
} from '../read-choices.js';
import {
    readAgain, readFailure, readSourceAgainClip, readSourceAgainOffered, sanitizeLiveRead, sanitizeReadAccepts,
    sanitizeReadHistory, sanitizeReadResult, startRead, startSourceRead,
} from '../research-read.js';
import { sanitizeLiveStatus } from '../research-link.js';

const ID = 'D20261106120000-a1b2';

/** As the research's bridge sends it (strom-research src/core/readchoice.ts). */
const CHOICES = {
    agents: [
        {
            id: 'claude', name: 'Claude Code', ready: true,
            models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: '', name: '' }],
            efforts: ['high', 'low', 'medium', 'xhigh', 'max', ''], default: { model: '', effort: '' },
        },
        {
            id: 'codex', name: 'OpenAI Codex CLI', ready: false, why: 'limit', resets: '2026-11-06T18:00:00Z',
            models: [{ id: 'gpt-5.1-codex', name: 'gpt-5.1-codex' }, { id: '', name: '' }],
            efforts: ['high', 'medium', ''], default: { model: 'gpt-5.1-codex', effort: 'high' },
        },
        {
            id: 'opencode', name: 'OpenCode', ready: true,
            models: [{ id: 'anthropic/claude-opus-4', name: 'anthropic/claude-opus-4' }, { id: '', name: '' }],
            efforts: [], default: { model: 'anthropic/claude-opus-4', effort: '' },
        },
    ],
    default: [{ agent: 'claude', model: '', effort: '' }, { agent: 'claude', model: '', effort: '' }],
};

const choices = (): ReadChoices => sanitizeReadChoices(CHOICES)!;

describe('accepts.read.choices', () => {
    it('takes the agents, their models, efforts and defaults as the bridge sends them', () => {
        const c = choices();
        expect(c.agents.map(a => a.id)).toEqual(['claude', 'codex', 'opencode']);
        expect(c.agents[0]).toEqual({
            id: 'claude', name: 'Claude Code', ready: true, why: '', resets: '',
            models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: '', name: '' }],
            efforts: ['high', 'low', 'medium', 'xhigh', 'max', ''], default: { model: '', effort: '' },
        });
        expect(c.agents[1]).toMatchObject({ ready: false, why: 'limit', resets: '2026-11-06T18:00:00Z' });
        // An agent without efforts: none to choose.
        expect(c.agents[2].efforts).toEqual([]);
        expect(c.default).toEqual([{ agent: 'claude', model: '', effort: '' }, { agent: 'claude', model: '', effort: '' }]);
    });

    it('drops what is not an agent, model or effort; no agents or a default of none: no choices', () => {
        const c = sanitizeReadChoices({
            agents: [
                { id: 'claude', name: 'Claude Code', models: [{ id: 'opus', name: 'Opus' }, { id: 'a b', name: 'x' }, { id: 'opus', name: 'dup' }, 'x', { id: '' }], efforts: ['high', 'HIGH', 3, ''], default: { model: 'opus', effort: 'nope!' } },
                { id: '../evil', name: 'x' },
                { id: 'claude', name: 'twice' },
            ],
        })!;
        expect(c.agents).toHaveLength(1);
        expect(c.agents[0].models).toEqual([{ id: 'opus', name: 'Opus' }, { id: '', name: '' }]);
        expect(c.agents[0].efforts).toEqual(['high', '']);
        // ready unless it says not; no default said: the first agent's own.
        expect(c.agents[0].ready).toBe(true);
        expect(c.default[0]).toEqual({ agent: 'claude', model: 'opus', effort: '' });
        expect(c.default[1]).toEqual(c.default[0]);
        expect(sanitizeReadChoices({ agents: [] })).toBeNull();
        expect(sanitizeReadChoices({ agents: [{ id: 'claude' }], default: [{ agent: 'grok' }] })).toBeNull();
        expect(sanitizeReadChoices(null)).toBeNull();
        expect(sanitizeReadChoices({ agents: 'claude' })).toBeNull();
    });

    it('in accepts.read only when ready, in /status only with read.choose', () => {
        const read = { ready: true, readers: 2, types: ['image/jpeg'], max: 1000, pages: 3, choices: CHOICES };
        expect(sanitizeReadAccepts(read)?.choices?.agents).toHaveLength(3);
        expect(sanitizeReadAccepts({ ...read, ready: false, why: 'agent.cli-missing' })).not.toHaveProperty('choices');
        expect(sanitizeReadAccepts({ ...read, choices: undefined })).not.toHaveProperty('choices');
        const status = (features: string[]) => sanitizeLiveStatus({ tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'N' }, head: 'abc1234', features, accepts: { read } });
        expect(status(['read.now', 'read.choose'])?.accepts?.read?.choices?.default[0].agent).toBe('claude');
        expect(status(['read.now'])?.accepts?.read).not.toHaveProperty('choices');
        expect(status(['read.now'])?.accepts?.read?.ready).toBe(true);
        expect(status(['read.choose'])?.accepts?.read).toBeUndefined();
    });

    it('what an alias runs on now (read.choices.now): a label only, the id stays the alias; without the feature none', () => {
        const claude = {
            ...CHOICES.agents[0],
            models: [
                { id: 'opus', name: 'Opus', now: 'claude-opus-5-5', nowName: 'Opus 5.5' },
                { id: 'sonnet', name: 'Sonnet' },
                { id: '', name: '', now: 'claude-opus-5-5', nowName: 'Opus 5.5' },
                { id: 'claude-opus-5', name: 'Opus 5', nowName: 'Opus 5' },
            ],
        };
        const read = { ready: true, readers: 2, types: ['image/jpeg'], max: 1000, pages: 3, choices: { ...CHOICES, agents: [claude] } };
        const status = (features: string[]) => sanitizeLiveStatus({ tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'N' }, head: 'abc1234', features, accepts: { read } });
        const on = status(['read.now', 'read.choose', 'read.choices.now'])!.accepts!.read!.choices!.agents[0].models;
        expect(on.map(m => [m.id, m.nowName ?? ''])).toEqual([['opus', 'Opus 5.5'], ['sonnet', ''], ['', 'Opus 5.5'], ['claude-opus-5', '']]);
        expect(JSON.stringify(on)).not.toContain('claude-opus-5-5');
        const off = status(['read.now', 'read.choose'])!.accepts!.read!.choices!.agents[0].models;
        expect(off.some(m => 'nowName' in m)).toBe(false);
        // A label a bridge could misuse is capped; one of another type is none.
        const odd = sanitizeReadChoices({ agents: [{ ...claude, models: [{ id: 'opus', name: 'Opus', nowName: 7 }, { id: 'sonnet', name: 'Sonnet', nowName: 'x'.repeat(200) }] }] }, true)!;
        expect(odd.agents[0].models[0]).not.toHaveProperty('nowName');
        expect(odd.agents[0].models[1].nowName!.length).toBeLessThanOrEqual(60);
    });

    it('a Codex catalog newer than the Codex installed: its models marked unsure, both versions; without catalogNewer none', () => {
        const codex = {
            ...CHOICES.agents[1], ready: true,
            models: [{ id: 'gpt-5.1-codex', name: 'gpt-5.1-codex' }, { id: 'gpt-6-astra', name: 'gpt-6-astra', unsure: true }, { id: '', name: '' }],
            catalogNewer: { catalog: '0.60.0', installed: '0.57.1' },
        };
        const a = sanitizeReadChoices({ agents: [codex] })!.agents[0];
        expect(a.catalogNewer).toEqual({ catalog: '0.60.0', installed: '0.57.1' });
        expect(a.models.map(m => !!m.unsure)).toEqual([false, true, false]);
        const { catalogNewer: _gone, ...without } = codex;
        const b = sanitizeReadChoices({ agents: [without] })!.agents[0];
        expect(b).not.toHaveProperty('catalogNewer');
        expect(b.models.some(m => m.unsure)).toBe(false);
        expect(sanitizeReadChoices({ agents: [{ ...codex, catalogNewer: { catalog: '<b>', installed: '0.57.1' } }] })!.agents[0]).not.toHaveProperty('catalogNewer');
    });

    it('a failed reading: the research\'s own sentence for a model refused (failure.code model); another code or state none', () => {
        const failure = { code: 'model', text: 'Model gpt-6-astra není v nainstalované verzi Codex CLI dostupný.', params: { agent: 'codex', model: 'gpt-6-astra' } };
        expect(sanitizeReadResult({ id: ID, state: 'failed', readers: { asked: 1, ran: 1 }, failure })?.readerFailure)
            .toEqual({ code: 'model', text: failure.text });
        expect(sanitizeReadResult({ id: ID, state: 'failed', readers: { asked: 1, ran: 1 }, failure: { ...failure, code: 'other' } })).not.toHaveProperty('readerFailure');
        expect(sanitizeReadResult({ id: ID, state: 'done', readers: { asked: 1, ran: 1 }, failure })).not.toHaveProperty('readerFailure');
        expect(sanitizeReadResult({ id: ID, state: 'failed', readers: { asked: 1, ran: 1 }, failure: { code: 'model', text: '' } })).not.toHaveProperty('readerFailure');
    });
});

describe('the readers chosen', () => {
    it('another agent reads with its own default model and effort', () => {
        expect(readerWithAgent(choices(), 'opencode')).toEqual({ agent: 'opencode', model: 'anthropic/claude-opus-4', effort: '' });
        expect(readerWithAgent(choices(), 'grok')).toBeNull();
    });

    it('a choice kept in the browser holds while it is offered, else the default', () => {
        const c = choices();
        const kept = [{ agent: 'claude', model: 'opus', effort: 'max' }, { agent: 'opencode', model: 'anthropic/claude-opus-4', effort: '' }];
        expect(readersFromStored(c, kept, 2)).toEqual(kept);
        expect(readersFromStored(c, kept, 1)).toEqual([kept[0]]);
        // An agent no longer here, a model gone, an effort it does not take, junk: that reader by default.
        expect(readersFromStored(c, [{ agent: 'grok', model: '', effort: '' }, { agent: 'claude', model: 'haiku', effort: '' }], 2))
            .toEqual([readerDefault(c, 0), readerDefault(c, 1)]);
        expect(readersFromStored(c, [{ agent: 'opencode', model: 'anthropic/claude-opus-4', effort: 'high' }], 1)).toEqual([readerDefault(c, 0)]);
        expect(readersFromStored(c, 'x', 2)).toEqual([readerDefault(c, 0), readerDefault(c, 1)]);
        // An agent that cannot read now is still a choice (the dialog says why; Read stays off).
        expect(readersFromStored(c, [{ agent: 'codex', model: 'gpt-5.1-codex', effort: 'high' }], 1)[0].agent).toBe('codex');
    });

    it('with: nothing when every reader reads as by default', () => {
        const c = choices();
        expect(readWith(c, [readerDefault(c, 0)], 1)).toBeUndefined();
        expect(readWith(c, [readerDefault(c, 0), readerDefault(c, 1)], 2)).toBeUndefined();
        expect(readersChanged(c, [readerDefault(c, 0), readerDefault(c, 1)])).toBe(false);
        // No choices from the bridge (an older research): never sent.
        expect(readWith(null, [{ agent: 'opencode', model: '', effort: '' }], 1)).toBeUndefined();
    });

    it('with: up to the last changed reader, a reader as by default {}, a changed one whole ("" = as the agent is set)', () => {
        const c = choices();
        const opus = { agent: 'claude', model: 'opus', effort: 'max' };
        expect(readWith(c, [opus], 1)).toEqual([opus]);
        expect(readWith(c, [opus, readerDefault(c, 1)], 2)).toEqual([opus]);
        const other = { agent: 'opencode', model: '', effort: '' };
        expect(readWith(c, [readerDefault(c, 0), other], 2)).toEqual([{}, other]);
        expect(readersChanged(c, [readerDefault(c, 0), other])).toBe(true);
        // Never more items than readers.
        expect(readWith(c, [opus, other], 1)).toEqual([opus]);
    });

    it('a chosen agent that cannot read now holds Read back', () => {
        const c = choices();
        expect(readerHeld(c, [readerDefault(c, 0)])).toBeNull();
        const held = readerHeld(c, [readerDefault(c, 0), { agent: 'codex', model: 'gpt-5.1-codex', effort: 'high' }]);
        expect(held?.at).toBe(1);
        expect(held?.agent).toMatchObject({ id: 'codex', why: 'limit', resets: '2026-11-06T18:00:00Z' });
    });
});

describe('who read', () => {
    const who = [
        { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high' },
        { agent: 'opencode', name: 'OpenCode', ran: false },
    ];

    it('readers.who in the result, who in /status.reads and GET reads', () => {
        const r = sanitizeReadResult({ id: ID, state: 'done', readers: { asked: 2, ran: 1, agree: 'differ', who }, pages: [], entries: [] })!;
        expect(r.readers.who).toEqual([
            { agent: 'claude', name: 'Claude Code', model: 'opus', modelName: 'Opus', effort: 'high', ran: true },
            { agent: 'opencode', name: 'OpenCode', model: '', modelName: '', effort: '', ran: false },
        ]);
        const entry = { id: ID, state: 'done', version: 1, readers: 2, who: [{ agent: 'codex', name: 'OpenAI Codex CLI', model: 'gpt-5.1-codex', effort: 'high' }] };
        expect(sanitizeLiveRead(entry)?.who?.[0]).toMatchObject({ agent: 'codex', model: 'gpt-5.1-codex', modelName: '', effort: 'high' });
        expect(sanitizeReadHistory({ reads: [entry] })?.[0].who?.[0].name).toBe('OpenAI Codex CLI');
    });

    it('a reading before 059 says nobody: nothing', () => {
        expect(sanitizeReadResult({ id: ID, state: 'done', readers: { asked: 1, ran: 1 } })?.readers).not.toHaveProperty('who');
        expect(sanitizeLiveRead({ id: ID, state: 'done' })).not.toHaveProperty('who');
        expect(sanitizeLiveRead({ id: ID, state: 'done', who: [] })).not.toHaveProperty('who');
        expect(sanitizeReadWho([{ agent: '<x>' }, 'claude'])).toBeUndefined();
    });

    it('as one line: no model = as the agent is set', () => {
        const [a, b] = sanitizeReadWho(who)!;
        expect(readWhoLabel(a, 'as set in the agent')).toBe('Claude Code · Opus · high');
        expect(readWhoLabel(b, 'as set in the agent')).toBe('OpenCode · as set in the agent');
        // A model without its label (status, GET reads): its id.
        expect(readWhoLabel({ name: 'OpenAI Codex CLI', model: 'gpt-5.1-codex', modelName: '', effort: '' }, '-')).toBe('OpenAI Codex CLI · gpt-5.1-codex');
    });

    it('both alike; other agents than the research\'s named', () => {
        const same = sanitizeReadWho([{ agent: 'claude', name: 'Claude Code' }, { agent: 'claude', name: 'Claude Code' }])!;
        expect(readWhoSame(same)).toBe(true);
        expect(readWhoSame(sanitizeReadWho(who)!)).toBe(false);
        expect(readWhoOtherAgents(same, 'claude')).toEqual([]);
        expect(readWhoOtherAgents(sanitizeReadWho(who), 'claude')).toEqual(['Claude Code', 'OpenCode']);
        expect(readWhoOtherAgents(undefined, 'claude')).toEqual([]);
    });
});

describe('a source read again', () => {
    const status = (features: string[], ready = true) => ({ features, accepts: { read: { ready } } });
    const src = { refn: 'S0042', transcript: 'Joannes', originalInResearch: true };

    it('offered with read.source, a ready reader and the original in the research', () => {
        expect(readSourceAgainOffered(status(['read.now', 'read.source']), src)).toBe(true);
        expect(readSourceAgainOffered(status(['read.now']), src)).toBe(false);
        expect(readSourceAgainOffered(status(['read.now', 'read.source'], false), src)).toBe(false);
        expect(readSourceAgainOffered(status(['read.now', 'read.source']), { ...src, originalInResearch: undefined })).toBe(false);
        expect(readSourceAgainOffered(status(['read.now', 'read.source']), { ...src, refn: 'X1' })).toBe(false);
        expect(readSourceAgainOffered(status(['read.now', 'read.source']), { ...src, transcript: ' ' })).toBe(false);
        expect(readSourceAgainOffered(null, src)).toBe(false);
    });

    it('an excerpt by its clip only when it is the source\'s only one', () => {
        const ex = (id: string, clip?: string) => ({ id, dataUrl: '', width: 1, height: 1, sizeBytes: 1, ...(clip ? { clip } : {}) });
        expect(readSourceAgainClip({ excerpts: [ex('x1', 'c0123456789')] }, 'x1')).toBe('c0123456789');
        expect(readSourceAgainClip({ excerpts: [ex('x1', 'c0123456789'), ex('x2', 'cabcdefabcd')] }, 'x1')).toBeUndefined();
        // An excerpt cut in the app (no clip) beside it does not count.
        expect(readSourceAgainClip({ excerpts: [ex('x1', 'c0123456789'), ex('x2')] }, 'x1')).toBe('c0123456789');
        expect(readSourceAgainClip({ excerpts: [ex('x1', 'c0123456789')] })).toBeUndefined();
        expect(readSourceAgainClip({ excerpts: [ex('x1', '../x')] }, 'x1')).toBeUndefined();
    });

    it('its result: alike, or different words and the task', () => {
        const base = { id: ID, state: 'done', readers: { asked: 1, ran: 1 } };
        expect(sanitizeReadResult({ ...base, source: { id: 'S0042', agree: 'same', variants: [] } })?.source)
            .toEqual({ id: 'S0042', agree: 'same', variants: [], task: '' });
        expect(sanitizeReadResult({ ...base, source: { id: 'S0042', agree: 'differ', variants: [{ at: 'Joannes', other: 'Johannes' }, {}], task: 'T0007' } })?.source)
            .toEqual({ id: 'S0042', agree: 'differ', variants: [{ at: 'Joannes', other: 'Johannes' }], task: 'T0007' });
        expect(sanitizeReadResult({ ...base, source: { id: 'S0042', agree: 'maybe' } })).not.toHaveProperty('source');
        expect(sanitizeReadResult({ ...base, source: { id: 'S0042', agree: 'differ', task: '../T1' } })?.source?.task).toBe('');
        expect(sanitizeLiveRead({ id: ID, state: 'reading', source: 'S0042' })?.source).toBe('S0042');
        expect(sanitizeLiveRead({ id: ID, state: 'reading', source: 'x' })).not.toHaveProperty('source');
    });
});

describe('refusals of a choice and of a source read again', () => {
    it('400 read.with: the reader and what of it', () => {
        expect(readFailure(400, { code: 'read.with', params: { at: '1', field: 'model' }, at: '1', field: 'model' }))
            .toMatchObject({ kind: 'with', at: 1, field: 'model' });
        expect(readFailure(400, { code: 'read.with', params: { at: '7', field: 'x' } })).not.toHaveProperty('field');
    });

    it('409 read.agent: the reader, its agent, why and until when', () => {
        expect(readFailure(409, { code: 'read.agent', params: { at: '0', agent: 'codex', why: 'limit', resets: '2026-11-06T18:00:00Z' } }))
            .toMatchObject({ kind: 'agent', at: 0, agent: 'codex', why: 'limit', resets: '2026-11-06T18:00:00Z' });
        expect(readFailure(409, { code: 'read.agent', params: { at: '1', agent: 'grok', why: 'auth' } }))
            .toMatchObject({ kind: 'agent', at: 1, agent: 'grok', why: 'auth', resets: '' });
    });

    it('400 read.bad-body: the app\'s own mistake', () => {
        expect(readFailure(400, { code: 'read.bad-body' }).kind).toBe('refused');
    });

    it('the source refusals', () => {
        expect(readFailure(404, { code: 'read.source.none', params: { source: 'S0042' } })).toMatchObject({ kind: 'source-none', source: 'S0042' });
        expect(readFailure(409, { code: 'read.source.notext', params: { source: 'S0042' } })).toMatchObject({ kind: 'source-notext', source: 'S0042' });
        expect(readFailure(409, { code: 'read.source.noscan', params: { source: 'S0042', clip: 'c0123456789' } }))
            .toMatchObject({ kind: 'source-noscan', source: 'S0042', clip: 'c0123456789' });
        expect(readFailure(409, { code: 'read.source.running', params: { source: 'S0042', read: ID }, read: ID }))
            .toMatchObject({ kind: 'source-running', source: 'S0042', read: ID });
        expect(readFailure(409, { code: 'read.source.running', params: { source: 'S0042', read: 'nope' } })).not.toHaveProperty('read');
    });

    it('503 read.not-ready: why (agent.cli-missing)', () => {
        expect(readFailure(503, { code: 'read.not-ready', params: { why: 'agent.cli-missing' } })).toMatchObject({ kind: 'not-ready', why: 'agent.cli-missing' });
    });
});

describe('the requests', () => {
    afterEach(() => vi.unstubAllGlobals());

    function stub(status: number, body: unknown) {
        const calls: { url: string; body: unknown }[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
            return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
        }));
        return calls;
    }

    it('POST read and again carry with only when given', async () => {
        const calls = stub(202, { read: ID, state: 'queued', version: 1 });
        await startRead('http://127.0.0.1:1/t', { files: ['a'.repeat(64)], readers: 1, lang: 'cs' });
        await startRead('http://127.0.0.1:1/t', { files: ['a'.repeat(64)], readers: 2, lang: 'cs', with: [{}, { agent: 'opencode', model: '', effort: '' }] });
        await readAgain('http://127.0.0.1:1/t', ID, 1, [{ agent: 'claude', model: 'opus', effort: 'max' }]);
        await readAgain('http://127.0.0.1:1/t', ID, 2);
        expect(calls[0].body).not.toHaveProperty('with');
        expect((calls[1].body as Record<string, unknown>).with).toEqual([{}, { agent: 'opencode', model: '', effort: '' }]);
        expect(calls[2].url).toContain(`/read/${ID}/again`);
        expect(calls[2].body).toEqual({ readers: 1, with: [{ agent: 'claude', model: 'opus', effort: 'max' }] });
        expect(calls[3].body).toEqual({ readers: 2 });
    });

    it('POST sources/read: 202 the reading of the source', async () => {
        const calls = stub(202, { read: ID, state: 'queued', version: 1, source: 'S0042' });
        const r = await startSourceRead('http://127.0.0.1:1/t', { source: 'S0042', clip: 'c0123456789', readers: 1, lang: 'cs', with: [{ agent: 'opencode', model: '', effort: '' }] });
        expect(r).toEqual({ ok: true, value: { read: ID, state: 'queued', version: 1, source: 'S0042' } });
        expect(calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:1\/t\/sources\/read/);
        expect(calls[0].body).toEqual({ source: 'S0042', clip: 'c0123456789', readers: 1, lang: 'cs', with: [{ agent: 'opencode', model: '', effort: '' }] });
        // Without a clip or a choice: the whole entry, as by default.
        await startSourceRead('http://127.0.0.1:1/t', { source: 'S0042', readers: 2 });
        expect(calls[1].body).toEqual({ source: 'S0042', readers: 2 });
    });

    it('POST sources/read: a refusal as the app\'s state; a bad source not sent', async () => {
        stub(409, { error: 'x', code: 'read.source.running', params: { source: 'S0042', read: ID }, read: ID });
        const r = await startSourceRead('http://127.0.0.1:1/t', { source: 'S0042', readers: 1 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.failure).toMatchObject({ kind: 'source-running', read: ID, status: 409 });
        const calls = stub(202, {});
        const bad = await startSourceRead('http://127.0.0.1:1/t', { source: '../S1', readers: 1 });
        expect(bad.ok).toBe(false);
        expect(calls).toHaveLength(0);
    });
});
