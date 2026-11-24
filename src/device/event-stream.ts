/**
 * An event stream read by fetch (spec 094 P3): the gateway's GET /device/events
 * says `: ping` as an SSE comment, which the browser's EventSource never shows.
 * Read by fetch, a comment is a `ping` (the stream lives), a refusal tells its
 * status and code (401 device.unpaired, 404 of an older gateway, …).
 *
 * The same small shape as EventSource (EventSourceLike), so the connection
 * takes either.
 */

import type { EventSourceLike } from './device-connection';

/** What a failed stream says: its HTTP status (0: no answer, the network, the stream fell) and the refusal's code. */
export interface EventStreamError {
    status: number;
    code?: string;
}

/** One SSE block parsed: its event's name (`message` without one), its data lines joined, and whether it had a comment. */
export interface SseBlock {
    event: string;
    data: string | null;
    comment: boolean;
}

/** One block of an SSE stream (the text between two blank lines). */
export function parseSseBlock(text: string): SseBlock {
    let event = 'message';
    const data: string[] = [];
    let comment = false;
    for (const line of text.split('\n')) {
        if (line.startsWith(':')) {
            comment = true;
            continue;
        }
        if (!line) continue;
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    return { event, data: data.length ? data.join('\n') : null, comment };
}

/** The longest block taken (an event of the bridge is far smaller); longer: the stream is given up. */
const BLOCK_MAX = 4 * 1024 * 1024;

/** An event stream at `url` read by fetch; a comment calls the `ping` listeners, a data block `onmessage`. */
export function fetchEventSource(url: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): EventSourceLike {
    const ctrl = new AbortController();
    const listeners = new Map<string, Set<(ev: { data?: string }) => void>>();
    let closed = false;
    const source: EventSourceLike = {
        onopen: null,
        onmessage: null,
        onerror: null,
        addEventListener(type, cb) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, (set = new Set()));
            set.add(cb);
        },
        close() {
            if (closed) return;
            closed = true;
            ctrl.abort();
        },
    };
    const fire = (type: string, ev: { data?: string }): void => {
        for (const cb of [...(listeners.get(type) ?? [])]) {
            try { cb(ev); } catch { /* its own */ }
        }
    };
    const fail = (err: EventStreamError): void => {
        if (closed) return;
        closed = true;
        ctrl.abort();
        source.onerror?.(err);
    };
    void (async () => {
        let res: Response;
        try {
            res = await fetchImpl(url, { method: 'GET', cache: 'no-store', headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
        } catch {
            return fail({ status: 0 });
        }
        if (closed) return;
        if (res.status !== 200 || !res.body) {
            let code: string | undefined;
            try {
                const j = await res.json() as Record<string, unknown>;
                if (typeof j?.code === 'string') code = j.code;
            } catch { /* no body */ }
            return fail({ status: res.status, ...(code ? { code } : {}) });
        }
        source.onopen?.({});
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (closed) return;
                if (done) break;
                buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
                let i: number;
                while ((i = buffer.indexOf('\n\n')) >= 0) {
                    const block = parseSseBlock(buffer.slice(0, i));
                    buffer = buffer.slice(i + 2);
                    if (block.comment) fire('ping', {});
                    if (block.data === null) continue;
                    if (block.event === 'message') {
                        try { source.onmessage?.({ data: block.data }); } catch { /* its own */ }
                    } else fire(block.event, { data: block.data });
                    if (closed) return;
                }
                if (buffer.length > BLOCK_MAX) return fail({ status: 0 });
            }
        } catch {
            return fail({ status: 0 });
        }
        // the stream ended (the bridge stopped, the device unpaired): the connection looks again
        fail({ status: 0 });
    })();
    return source;
}
