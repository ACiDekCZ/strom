import { describe, it, expect } from 'vitest';
import { fetchEventSource, parseSseBlock } from '../device/event-stream';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(ctrl) {
            for (const c of chunks) ctrl.enqueue(enc.encode(c));
            ctrl.close();
        },
    });
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('device event stream read by fetch', () => {
    it('parses a block: data lines, its name, a comment', () => {
        expect(parseSseBlock('data: {"n":"a"}')).toEqual({ event: 'message', data: '{"n":"a"}', comment: false });
        expect(parseSseBlock(': ping')).toEqual({ event: 'message', data: null, comment: true });
        expect(parseSseBlock('event: x\ndata: 1\ndata: 2')).toEqual({ event: 'x', data: '1\n2', comment: false });
    });

    it('a comment is a ping, each data block a message, split across chunks; the end an error', async () => {
        const seen: string[] = [];
        let asked: RequestInit | undefined;
        const fake = (async (_url: string, init?: RequestInit) => {
            asked = init;
            return new Response(streamOf([': ping\n\nda', 'ta: {"n":1}\n', '\n: ping\r\n\r\ndata: {"n":2}\n\n']), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }) as typeof fetch;
        const s = fetchEventSource('/device/events?d=x', fake);
        s.onopen = () => seen.push('open');
        s.onmessage = ev => seen.push(`msg ${ev.data}`);
        s.onerror = ev => seen.push(`error ${JSON.stringify(ev)}`);
        s.addEventListener('ping', () => seen.push('ping'));
        for (let i = 0; i < 5; i++) await settle();
        expect(asked?.cache).toBe('no-store');
        expect(seen).toEqual(['open', 'ping', 'msg {"n":1}', 'ping', 'msg {"n":2}', 'error {"status":0}']);
    });

    it('a refusal says its status and code, never opens', async () => {
        const seen: unknown[] = [];
        const fake = (async () => new Response(JSON.stringify({ code: 'device.unpaired' }), { status: 401 })) as unknown as typeof fetch;
        const s = fetchEventSource('/device/events', fake);
        s.onopen = () => seen.push('open');
        s.onerror = ev => seen.push(ev);
        for (let i = 0; i < 3; i++) await settle();
        expect(seen).toEqual([{ status: 401, code: 'device.unpaired' }]);
    });

    it('closed: nothing more is said', async () => {
        const seen: unknown[] = [];
        const fake = (async () => new Response(streamOf(['data: 1\n\n']), { status: 200 })) as unknown as typeof fetch;
        const s = fetchEventSource('/device/events', fake);
        s.onmessage = ev => seen.push(ev.data);
        s.onerror = ev => seen.push(ev);
        s.close();
        for (let i = 0; i < 3; i++) await settle();
        expect(seen).toEqual([]);
    });
});
