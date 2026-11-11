/**
 * A queued task's kind (Strom Research 1.31.0-beta.5): `kind: 'story' |
 * 'history'` in the status's `queue[]` and in `GET /queue` is read, any other
 * value dropped; the row's small tag says it in English, Czech, German and
 * Polish, and a task without it has none. Invented tasks only.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { sanitizeLiveStatus, sanitizeQueue } from '../research-link.js';
import { fetchQueuePage } from '../research-queue-pages.js';
import { setLanguage } from '../strings.js';
import type { queueKindText as KindText } from '../ui/research-ui.js';

const BASE = 'http://127.0.0.1:7777/abc123';
const tasks = [
    { id: 'T0001', text: 'Příběh Matěje Kroupy', state: 'next', kind: 'story' },
    { id: 'T0002', text: 'Povodeň v Lhotce 1897', state: 'next', kind: 'history' },
    { id: 'T0003', text: 'Matriky Lhotky', state: 'next' },
    { id: 'T0004', text: 'Sčítání 1921', state: 'parked', kind: 'census' },
];

let kindText: typeof KindText;
beforeAll(async () => {
    ({ queueKindText: kindText } = await import('../ui/research-ui.js'));
}, 60000);
afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
});

describe('a queued task\'s kind', () => {
    it('is read from the status\'s queue: story and history, nothing else', () => {
        const q = sanitizeLiveStatus({ tree: { id: 'R1' }, queue: tasks })!.queue;
        expect(q.map(t => t.kind ?? null)).toEqual(['story', 'history', null, null]);
        expect(sanitizeQueue(tasks).map(t => 'kind' in t)).toEqual([true, true, false, false]);
    });

    it('is read from a page of GET /queue', async () => {
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
            items: tasks.map((t, i) => ({ ...t, pos: i + 1 })), total: 4, next: 3, rev: 'a1b2c3d4e5f60718',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const r = await fetchQueuePage(BASE, {}, 0, 10);
        expect(r.ok && r.items.map(t => t.kind ?? null)).toEqual(['story', 'history', null, null]);
    });

    it('the tag in four languages; none without a kind', () => {
        const words: Record<string, [string, string]> = {
            en: ['story', 'history'], cs: ['příběh', 'dějiny'], de: ['Erzählung', 'Zeitgeschehen'], pl: ['opowieść', 'historia'],
        };
        for (const [lang, [story, history]] of Object.entries(words)) {
            setLanguage(lang as never);
            expect(kindText({ kind: 'story' })).toBe(story);
            expect(kindText({ kind: 'history' })).toBe(history);
            expect(kindText({})).toBe('');
        }
    });
});
