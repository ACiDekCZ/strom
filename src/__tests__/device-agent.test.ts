import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { b64url, deriveKey, openRequest, sealResponse, type RequestEnvelope } from '../device/device-crypto';
import { configureGateway } from '../device/gateway-client';
import { setDeviceKv, memoryKv, savePairing } from '../device/device-store';
import {
    deviceAgentStart, sanitizeDeviceAgentAnswer, deviceAgentFailureKind, deviceAgentLinkOk, deviceAgentKindOf,
    applyDeviceAgentResult, noteDeviceAgentStarting, noteDeviceAgentWaitPc, noteDeviceAgentGlance, deviceAgentStartOf,
    onDeviceAgentStart, clearDeviceAgentStart, resetDeviceAgentStarts, deviceAgentProof, DEVICE_AGENT_PROOF_MS,
    type DeviceAgentResult, type DeviceAgentStartEntry,
} from '../device/device-agent';
import { sanitizeGlance, type DeviceGlance } from '../device/device-research-data';

/**
 * The agent's work started from a device (spec 094 K3.15): `POST device/agent {link, yes?}` through the tunnel,
 * its answers and refusals by code (D14), and the start's state proved by the glance within 30 s (D15).
 * Invented data only (Pýchavkovi z Mlýnků, the computer "Pracovna").
 */

const NOW = Date.UTC(2026, 10, 25, 14, 30, 0);
const SECRET = new Uint8Array(32).map((_, i) => i + 11);
const PAIR_ID = 'pairPychavkaMlynky7';
const KEY = deriveKey(SECRET, PAIR_ID);
const DEVICE = 'dv_mlynkypychavkaab';
const TREE = 'pychavkovi';
const QUEUE = `strom-research://work?tree=${TREE}&do=tasks&n=5`;
const LINE = `strom-research://work?tree=${TREE}&do=loop&research=G0001`;
const CHAT = `strom-research://chat?tree=${TREE}&research=G0001`;

function fakeLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

/** A gateway answering each tunnel request with `inner(request)`. */
function gateway(inner: (req: NonNullable<ReturnType<typeof openRequest>>) => { s: number; body?: unknown }): typeof fetch {
    return (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const env = JSON.parse(String(init.body)) as RequestEnvelope;
        const req = openRequest(KEY, env)!;
        const a = inner(req);
        const bytes = a.body === undefined ? null : new TextEncoder().encode(JSON.stringify(a.body));
        const sealed = sealResponse(KEY, DEVICE, env.n, { s: a.s, h: { 'Content-Type': 'application/json' }, b: bytes ? b64url(bytes) : null });
        return new Response(JSON.stringify(sealed), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
}

async function paired(): Promise<void> {
    await savePairing({
        deviceId: DEVICE, key: KEY, name: 'iPhone · Safari', kind: 'phone',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: TREE, name: 'Pýchavkovi z Mlýnků' }],
        origin: 'http://192.168.1.20:47800', pairedAt: new Date(NOW).toISOString(),
    });
}

const ASK = {
    state: 'ask', yes: 'Zk3-pQ_x9', expiresAt: '2026-11-25T14:40:00Z',
    ask: { tree: 'Pýchavkovi z Mlýnků', what: 'Spustit agenta na 5 úkolech fronty?', note: ['Odhad: asi 40 minut, čerpá předplatné.'] },
};

describe('the gateway\'s answer to device/agent', () => {
    it('reads the four answers and drops what is not theirs', () => {
        expect(sanitizeDeviceAgentAnswer({ ...ASK, extra: 1 })).toEqual({
            state: 'ask', yes: 'Zk3-pQ_x9', expiresAt: '2026-11-25T14:40:00Z',
            ask: { tree: 'Pýchavkovi z Mlýnků', what: 'Spustit agenta na 5 úkolech fronty?', note: ['Odhad: asi 40 minut, čerpá předplatné.'], said: [] },
        });
        expect(sanitizeDeviceAgentAnswer({ state: 'started' })).toEqual({ state: 'started' });
        expect(sanitizeDeviceAgentAnswer({ state: 'started', terminal: 'fallback' })).toEqual({ state: 'started', terminal: 'fallback' });
        expect(sanitizeDeviceAgentAnswer({ state: 'computer', why: 'price' })).toEqual({ state: 'computer', why: 'price' });
        // A newer research's other reason: a question in the terminal.
        expect(sanitizeDeviceAgentAnswer({ state: 'computer', why: 'later' })).toEqual({ state: 'computer', why: 'question' });
        expect(sanitizeDeviceAgentAnswer({ state: 'said', text: 'Fronta je prázdná.', refused: 'archive' }))
            .toEqual({ state: 'said', text: 'Fronta je prázdná.', refused: 'archive' });
        expect(sanitizeDeviceAgentAnswer({ state: 'said', text: 'Linie\u0000 je\n ukončená.', refused: 'other' }))
            .toEqual({ state: 'said', text: 'Linie je ukončená.' });
    });

    it('refuses an answer of another shape', () => {
        for (const bad of [null, [], 'started', {}, { state: 'run' }, { state: 'said' }, { state: 'said', text: '  ' },
            { ...ASK, yes: '' }, { ...ASK, yes: 'a b' }, { ...ASK, expiresAt: 'soon' }, { ...ASK, ask: { what: '' } }, { ...ASK, ask: null }]) {
            expect(sanitizeDeviceAgentAnswer(bad)).toBeNull();
        }
        // Lines that are no text are dropped, too many cut.
        const many = sanitizeDeviceAgentAnswer({ ...ASK, ask: { ...ASK.ask, note: [1, '', 'a', ...Array(20).fill('b')], said: 'x' } });
        expect(many?.state === 'ask' && many.ask.note.length).toBe(10);
        expect(many?.state === 'ask' && many.ask.said).toEqual([]);
    });

    it('sorts the refusals by their code, never by their text (D14)', () => {
        expect(deviceAgentFailureKind('agent.noterminal', 503)).toBe('noTerminal');
        expect(deviceAgentFailureKind('research.locked', 409)).toBe('researchNewer');
        expect(deviceAgentFailureKind('agent.recent', 409)).toBe('recent');
        expect(deviceAgentFailureKind('agent.yes-expired', 410)).toBe('yesExpired');
        expect(deviceAgentFailureKind('device.computer-only', 403)).toBe('computerOnly');
        expect(deviceAgentFailureKind('device.unpaired', 401)).toBe('unpaired');
        expect(deviceAgentFailureKind('device.unknown-action', 404)).toBe('unknown');
        expect(deviceAgentFailureKind('device.replay', 409)).toBe('replay');
        expect(deviceAgentFailureKind('network', 0)).toBe('down');
        expect(deviceAgentFailureKind('timeout', 0)).toBe('down');
        expect(deviceAgentFailureKind('device.link', 400)).toBe('bad');
        expect(deviceAgentFailureKind('device.body', 400)).toBe('bad');
        expect(deviceAgentFailureKind('http.502', 502)).toBe('down');
    });

    it('takes only the research\'s links up to 2048 characters', () => {
        expect(deviceAgentLinkOk(QUEUE)).toBe(true);
        expect(deviceAgentLinkOk(`strom-research-beta://work?tree=${TREE}&do=loop`)).toBe(true);
        expect(deviceAgentLinkOk('https://example.org/work')).toBe(false);
        expect(deviceAgentLinkOk(`${QUEUE}&x=${'a'.repeat(2048)}`)).toBe(false);
        expect(deviceAgentLinkOk(`${QUEUE} rm`)).toBe(false);
        expect(deviceAgentLinkOk(42)).toBe(false);
    });

    it('tells the queue, a line\'s run and a conversation apart', () => {
        expect(deviceAgentKindOf(QUEUE)).toEqual({ kind: 'queue' });
        expect(deviceAgentKindOf(LINE)).toEqual({ kind: 'line', line: 'G0001' });
        expect(deviceAgentKindOf(CHAT)).toEqual({ kind: 'chat', line: 'G0001' });
        expect(deviceAgentKindOf(`strom-research://task?tree=${TREE}&id=T0001&do=chat`)).toEqual({ kind: 'chat' });
        expect(deviceAgentKindOf(`strom-research://places?tree=${TREE}&do=run`)).toEqual({ kind: 'other' });
    });
});

describe('POST device/agent through the tunnel', () => {
    beforeEach(async () => {
        vi.stubGlobal('localStorage', fakeLocalStorage());
        setDeviceKv(memoryKv());
        configureGateway(null);
        await paired();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        setDeviceKv(null);
        configureGateway(null);
    });

    it('asks without yes, then starts with it — the link exactly, the tree of the envelope', async () => {
        const seen: unknown[] = [];
        configureGateway({
            now: () => NOW, sleep: async () => undefined,
            fetch: gateway((req) => {
                seen.push({ m: req.m, p: req.p, tree: req.tree, b: req.b });
                return (req.b as { yes?: string }).yes ? { s: 200, body: { state: 'started' } } : { s: 200, body: ASK };
            }),
        });
        const first = await deviceAgentStart(TREE, QUEUE);
        expect(first.ok && first.answer.state).toBe('ask');
        const yes = first.ok && first.answer.state === 'ask' ? first.answer.yes : '';
        expect(await deviceAgentStart(TREE, QUEUE, yes)).toEqual({ ok: true, answer: { state: 'started' } });
        expect(seen).toEqual([
            { m: 'POST', p: 'device/agent', tree: TREE, b: { link: QUEUE } },
            { m: 'POST', p: 'device/agent', tree: TREE, b: { link: QUEUE, yes: 'Zk3-pQ_x9' } },
        ]);
    });

    it('answers the gateway\'s refusals by code, with the refused action', async () => {
        const cases: [number, Record<string, unknown>, string][] = [
            [503, { code: 'agent.noterminal', text: 'Na počítači nejde otevřít terminál.' }, 'noTerminal'],
            [409, { code: 'research.locked', text: '…' }, 'researchNewer'],
            [409, { code: 'agent.recent' }, 'recent'],
            [410, { code: 'agent.yes-expired' }, 'yesExpired'],
            [400, { code: 'device.link' }, 'bad'],
            [400, { code: 'device.body' }, 'bad'],
            [404, { code: 'device.unknown-action' }, 'unknown'],
        ];
        for (const [s, body, kind] of cases) {
            configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway(() => ({ s, body })) });
            const r = await deviceAgentStart(TREE, QUEUE);
            expect(r).toEqual({ ok: false, kind, code: body.code, status: s });
        }
        configureGateway({ now: () => NOW, sleep: async () => undefined,
            fetch: gateway(() => ({ s: 403, body: { code: 'device.computer-only', action: 'link.send', text: 'only on the computer: send' } })) });
        expect(await deviceAgentStart(TREE, QUEUE)).toEqual({ ok: false, kind: 'computerOnly', code: 'device.computer-only', status: 403, action: 'link.send' });
        // An answer that is no answer, a status without a body.
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway(() => ({ s: 200, body: { state: 'maybe' } })) });
        expect(await deviceAgentStart(TREE, QUEUE)).toMatchObject({ ok: false, kind: 'bad', code: 'agent.answer' });
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway(() => ({ s: 500 })) });
        expect(await deviceAgentStart(TREE, QUEUE)).toMatchObject({ ok: false, kind: 'bad', code: 'http.500', status: 500 });
    });

    it('a gateway not reachable is "down"; a bad link is not sent at all', async () => {
        let sent = 0;
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: (async () => { sent++; throw new TypeError('Failed to fetch'); }) as typeof fetch });
        expect(await deviceAgentStart(TREE, QUEUE)).toMatchObject({ ok: false, kind: 'down', status: 0 });
        const before = sent;
        expect(await deviceAgentStart(TREE, 'https://example.org/')).toMatchObject({ ok: false, kind: 'bad', code: 'device.link' });
        expect(sent).toBe(before);
    });
});

/** A glance of the invented tree with these runs and questions at the computer. */
function glance(o: Record<string, unknown> = {}): DeviceGlance {
    return sanitizeGlance({
        head: 'abc', tree: { id: TREE, name: 'Pýchavkovi z Mlýnků', lang: 'cs', state: 'research', persons: 3, families: 1 },
        now: [], runs: [], lines: [], waiting: { n: 0, items: [] }, people: {}, ...o,
    })!;
}

describe('the glance: what waits at the computer and who started a run (K3.15)', () => {
    it('reads onComputer and the runs\' onComputer and device, cleaned', () => {
        const g = glance({
            onComputer: [
                { kind: 'consent', since: '2026-11-25T14:31:00Z', run: 'run-7', device: DEVICE, extra: 1 },
                { kind: 'other', since: 'never' },
                'x',
            ],
            runs: [
                { id: 'run-7', line: 'G0001', way: 'up', since: '2026-11-25T14:30:30Z', state: 'working',
                    onComputer: { kind: 'question', since: '2026-11-25T14:31:00Z' }, device: { id: DEVICE, name: 'iPhone · Safari', x: 2 } },
                { id: 'run-8', line: null, since: '2026-11-25T14:00:00Z', state: 'working', device: { name: 'no id' }, onComputer: 'yes' },
            ],
        });
        expect(g.onComputer).toEqual([
            { kind: 'consent', since: '2026-11-25T14:31:00Z', run: 'run-7', device: DEVICE },
            { kind: 'question', since: '' },
        ]);
        expect(g.runs[0]).toEqual({ id: 'run-7', line: 'G0001', way: 'up', since: '2026-11-25T14:30:30Z', state: 'working',
            onComputer: { kind: 'question', since: '2026-11-25T14:31:00Z' }, device: { id: DEVICE, name: 'iPhone · Safari' } });
        expect(g.runs[1]).toEqual({ id: 'run-8', line: null, way: 'other', since: '2026-11-25T14:00:00Z', state: 'working' });
        // Nothing waits: no field.
        expect('onComputer' in glance()).toBe(false);
        expect('onComputer' in glance({ onComputer: [] })).toBe(false);
    });
});

describe('the start\'s state per tree (D15)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Away from midnight UTC: nothing turns a day meanwhile.
        vi.setSystemTime(new Date(NOW));
        resetDeviceAgentStarts();
    });
    afterEach(() => {
        resetDeviceAgentStarts();
        vi.useRealTimers();
    });

    it('starting without a proof in 30 s did not start', () => {
        const seen: (string | null)[] = [];
        const off = onDeviceAgentStart((tree, s) => seen.push(s ? `${tree}:${s.state}` : `${tree}:none`));
        noteDeviceAgentStarting(TREE, { link: QUEUE, label: 'Fronta' });
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'starting', kind: 'queue', noConfirm: false, since: NOW, label: 'Fronta' });
        vi.advanceTimersByTime(DEVICE_AGENT_PROOF_MS - 1);
        expect(deviceAgentStartOf(TREE)?.state).toBe('starting');
        vi.advanceTimersByTime(1);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'notStarted', why: 'timeout', since: NOW + DEVICE_AGENT_PROOF_MS });
        expect(seen).toEqual([`${TREE}:starting`, `${TREE}:notStarted`]);
        off();
        clearDeviceAgentStart(TREE);
        expect(deviceAgentStartOf(TREE)).toBeNull();
        expect(seen).toHaveLength(2);
    });

    it('a new run of this device proves it: running, then over when its run ends', () => {
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-1', line: 'G0002', since: '2026-11-25T13:00:00Z', state: 'working' }] }), DEVICE);
        noteDeviceAgentStarting(TREE, { link: QUEUE, noConfirm: true });
        expect(deviceAgentStartOf(TREE)?.runsBefore).toEqual(['run-1']);
        vi.advanceTimersByTime(10_000);
        // A run that was there before proves nothing.
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-1', line: 'G0002', since: '2026-11-25T13:00:00Z', state: 'working' }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)?.state).toBe('starting');
        const runs = [
            { id: 'run-1', line: 'G0002', since: '2026-11-25T13:00:00Z', state: 'working' },
            { id: 'run-2', line: 'G0005', since: '2026-11-25T14:30:10Z', state: 'working', device: { id: DEVICE } },
        ];
        noteDeviceAgentGlance(TREE, glance({ runs }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'running', run: 'run-2', noConfirm: true, since: NOW + 10_000 });
        // The timer is gone with the proof.
        vi.advanceTimersByTime(DEVICE_AGENT_PROOF_MS * 2);
        expect(deviceAgentStartOf(TREE)?.state).toBe('running');
        noteDeviceAgentGlance(TREE, glance({ runs: [runs[0]] }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toBeNull();
    });

    it('a new run of the same action proves it (the queue: no line; a line: its own)', () => {
        noteDeviceAgentStarting(TREE, { link: LINE });
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-3', line: null, since: '2026-11-25T14:30:05Z', state: 'working' }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)?.state).toBe('starting');
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-4', line: 'G0001', since: '2026-11-25T14:30:05Z', state: 'working' }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'running', run: 'run-4', kind: 'line', line: 'G0001' });
        const entry = deviceAgentStartOf(TREE)!;
        expect(deviceAgentProof({ ...entry, kind: 'queue', run: undefined, runsBefore: [] },
            glance({ runs: [{ id: 'run-5', line: null, since: '', state: 'working' }] }), null)).toEqual({ run: 'run-5', waitPc: false });
    });

    it('a question at the computer of this device: waiting there, then running once it is answered', () => {
        noteDeviceAgentStarting(TREE, { link: QUEUE });
        noteDeviceAgentGlance(TREE, glance({ onComputer: [{ kind: 'question', since: '2026-11-25T14:30:20Z', device: 'dv_jinezarizeni0001' }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)?.state).toBe('starting');
        noteDeviceAgentGlance(TREE, glance({ onComputer: [{ kind: 'consent', since: '2026-11-25T14:30:20Z', device: DEVICE }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'waitPc', proved: true });
        vi.advanceTimersByTime(DEVICE_AGENT_PROOF_MS * 3);
        expect(deviceAgentStartOf(TREE)?.state).toBe('waitPc');
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-9', line: null, since: '2026-11-25T14:31:00Z', state: 'working', device: { id: DEVICE } }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'running', run: 'run-9' });
        // The run asks again: waiting at the computer.
        noteDeviceAgentGlance(TREE, glance({ runs: [{ id: 'run-9', line: null, since: '', state: 'working', onComputer: { kind: 'question', since: '' } }] }), DEVICE);
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'waitPc', run: 'run-9' });
    });

    it('waiting at the computer from the answer (computer) has no timer; a question that goes without a run ends it', () => {
        noteDeviceAgentWaitPc(TREE, { link: QUEUE });
        vi.advanceTimersByTime(DEVICE_AGENT_PROOF_MS * 2);
        expect(deviceAgentStartOf(TREE)?.state).toBe('waitPc');
        // Not proved yet: a glance without it keeps it.
        noteDeviceAgentGlance(TREE, glance(), DEVICE);
        expect(deviceAgentStartOf(TREE)?.state).toBe('waitPc');
        noteDeviceAgentGlance(TREE, glance({ onComputer: [{ kind: 'question', since: '', device: DEVICE }] }), DEVICE);
        noteDeviceAgentGlance(TREE, glance(), DEVICE);
        expect(deviceAgentStartOf(TREE)).toBeNull();
    });

    it('a conversation is at the computer at once: no run to prove it, no timer', () => {
        noteDeviceAgentStarting(TREE, { link: CHAT, label: 'Předci Jana Pýchavky' });
        expect(deviceAgentStartOf(TREE)).toMatchObject({ state: 'running', kind: 'chat' });
        vi.advanceTimersByTime(DEVICE_AGENT_PROOF_MS * 2);
        noteDeviceAgentGlance(TREE, glance(), DEVICE);
        expect(deviceAgentStartOf(TREE)?.state).toBe('running');
    });

    it('notes what the gateway answered and says what comes next', () => {
        const at = (r: DeviceAgentResult, yesSent = false): [string, DeviceAgentStartEntry | null] => {
            clearDeviceAgentStart(TREE);
            const next = applyDeviceAgentResult(TREE, { link: QUEUE, yesSent }, r);
            return [next, deviceAgentStartOf(TREE)];
        };
        const fail = (kind: string, code = kind): DeviceAgentResult => ({ ok: false, kind: kind as never, code, status: 409 });
        expect(at({ ok: true, answer: sanitizeDeviceAgentAnswer(ASK)! })).toEqual(['ask', null]);
        // Started without a yes: the computer's setting "without confirmation" (10.7).
        expect(at({ ok: true, answer: { state: 'started' } })[1]).toMatchObject({ state: 'starting', noConfirm: true });
        expect(at({ ok: true, answer: { state: 'started' } }, true)[1]).toMatchObject({ state: 'starting', noConfirm: false });
        expect(at({ ok: true, answer: { state: 'computer', why: 'price' } })[1]).toMatchObject({ state: 'waitPc' });
        expect(at({ ok: true, answer: { state: 'said', text: 'Fronta je prázdná.' } })[1])
            .toMatchObject({ state: 'notStarted', why: 'said', text: 'Fronta je prázdná.' });
        expect(at(fail('noTerminal', 'agent.noterminal'))[1]).toMatchObject({ state: 'notStarted', why: 'noTerminal' });
        expect(at(fail('down', 'network'))[1]).toMatchObject({ state: 'notStarted', why: 'down' });
        expect(at(fail('researchNewer', 'research.locked'))[1]).toMatchObject({ state: 'notStarted', why: 'researchNewer' });
        expect(at(fail('recent', 'agent.recent'), true)[1]).toMatchObject({ state: 'starting' });
        expect(at(fail('yesExpired', 'agent.yes-expired'), true)).toEqual(['askAgain', null]);
        expect(at(fail('replay', 'device.replay'))).toEqual(['askAgain', null]);
        expect(at(fail('replay', 'device.replay'), true)[1]).toMatchObject({ state: 'starting' });
        expect(at(fail('computerOnly', 'device.computer-only'))).toEqual(['refused', null]);
        expect(at(fail('bad', 'device.link'))).toEqual(['error', null]);
    });
});
