/**
 * A queued task's kind (Strom Research 1.31.0-beta.5): `kind: 'story' |
 * 'history'` in the status's `queue[]` and in `GET /queue` is read, any other
 * value dropped; the row's small tag says it in English, Czech, German and
 * Polish, and a task without it has none. Invented tasks only.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { QUEUE_TASK_KINDS, queueTaskKindOf, sanitizeLiveStatus, sanitizeQueue, sanitizeQueueCounts } from '../research-link.js';
import { fetchQueuePage, queueFilterKey, queuePageQuery } from '../research-queue-pages.js';
import { setLanguage, strings } from '../strings.js';
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

/**
 * The queue by its kind of work (`queue.kind`, spec 065 K7.4): `taskKind` of each task, `/status.queueCounts.kind`
 * for the chips, `kind=` in `GET /queue` beside the line, the branch and the searched text; without the feature
 * no kind is ever picked or sent.
 */
describe('the queue by kind of work (queue.kind)', () => {
    type KindUi = typeof import('../ui/queue-kind-ui.js');
    let ui: KindUi;
    beforeAll(async () => {
        ui = await import('../ui/queue-kind-ui.js');
    }, 60000);
    afterEach(() => ui.setQueueKindFilter(null, null));

    const session = (features: string[], base = BASE) => ({ features, bridge: { base } });

    it('reads a task\'s kind: the known ones in any case, another word as other, no kind without a word', () => {
        expect(['verify', 'Records', 'STORY', 'archive-letters', '', 'ověřit', 3, null].map(queueTaskKindOf))
            .toEqual(['verify', 'records', 'story', 'other', null, null, null, null]);
        const q = sanitizeQueue([
            { id: 'T0410', text: 'Křest Hrabaňáka', state: 'next', taskKind: 'verify' },
            { id: 'T0411', text: 'Matriky Zálesné', state: 'next', taskKind: 'records' },
            { id: 'T0412', text: 'Dopis do archivu', state: 'next', taskKind: 'letters' },
            { id: 'T0413', text: 'Sčítání 1921', state: 'parked' },
        ]);
        expect(q.map(t => t.taskKind ?? null)).toEqual(['verify', 'records', 'other', null]);
    });

    it('reads queueCounts.kind: kinds with a task, a newer kind counted as other; none said: none', () => {
        const c = sanitizeQueueCounts({
            research: {}, branch: {}, next: 190, parked: 3, rev: 'a1b2c3d4e5f60718',
            kind: { records: 171, verify: 12, story: 3, letters: 2, inquest: 1, places: 0, '': 5, history: -1 },
        })!;
        expect(c.kind).toEqual({ records: 171, verify: 12, story: 3, other: 3 });
        expect(sanitizeQueueCounts({ research: {}, branch: {}, next: 1, parked: 0, rev: 'a1b2c3d4e5f60718' })!.kind).toBeUndefined();
        // Through the status, with queue.page.
        const s = sanitizeLiveStatus({ tree: { id: 'R1' }, features: ['queue.page', 'queue.kind'], queue: [],
            queueCounts: { research: {}, branch: {}, kind: { verify: 4 }, next: 4, parked: 0, rev: 'a1b2c3d4e5f60718' } })!;
        expect(s.queueCounts?.kind).toEqual({ verify: 4 });
    });

    it('asks GET /queue with kind beside the branch, the line and the text; never a kind not known here', async () => {
        expect(queuePageQuery({ kind: 'verify', branch: 'B-P0004', q: '  Hrabaňák ' }, 50, 50).toString())
            .toBe('from=50&count=50&branch=B-P0004&kind=verify&q=Hraba%C5%88%C3%A1k');
        expect(queuePageQuery({ kind: 'verify', research: 'G0001' }, 0, 50).toString()).toBe('count=50&research=G0001&kind=verify');
        expect(queuePageQuery({ kind: 'ověřit' as never }, 0, 50).has('kind')).toBe(false);
        expect(queuePageQuery({ research: 'G0001' }, 0, 50).has('kind')).toBe(false);
        expect(queueFilterKey({ research: 'G0001', kind: 'verify', q: 'x' })).toBe('research=G0001&kind=verify&q=x');
        const asked: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => {
            asked.push(url);
            return new Response(JSON.stringify({ items: [{ id: 'T0410', text: 'Křest Hrabaňáka', state: 'next', pos: 7, taskKind: 'verify' }],
                total: 1, from: 0, rev: 'a1b2c3d4e5f60718' }), { status: 200 });
        });
        const r = await fetchQueuePage(BASE, { kind: 'verify', research: 'G0001' }, 0, 50);
        expect(new URL(asked[0]).searchParams.get('kind')).toBe('verify');
        expect(new URL(asked[0]).searchParams.get('research')).toBe('G0001');
        expect(r.ok && r.items[0].taskKind).toBe('verify');
    });

    it('the chips: the kinds with a task in their fixed order, the picked one kept at 0', () => {
        const counts = { kind: { records: 171, story: 3, verify: 12, other: 2 } };
        expect(ui.queueKindChips(counts, null)).toEqual([
            { kind: 'verify', n: 12 }, { kind: 'records', n: 171 }, { kind: 'story', n: 3 }, { kind: 'other', n: 2 },
        ]);
        expect(ui.queueKindChips({ kind: { records: 5 } }, 'verify').map(c => c.kind)).toEqual(['verify', 'records']);
        expect(ui.queueKindChips({}, null)).toEqual([]);
        expect(ui.queueKindChips(undefined, null)).toEqual([]);
    });

    it('the kind picked holds only with queue.kind and the same bridge; without the feature none is ever sent', () => {
        const withKind = session(['queue.page', 'queue.kind']);
        ui.setQueueKindFilter(withKind, 'verify');
        expect(ui.queueKindFilter(withKind)).toBe('verify');
        expect(ui.queueKindFilter(session(['queue.page']))).toBeNull();
        expect(ui.queueKindFilter(session(['queue.page', 'queue.kind'], 'http://127.0.0.1:7777/other9'))).toBeNull();
        expect(ui.queueKindsSaid(session(['queue.page']))).toBe(false);
        ui.setQueueKindFilter(withKind, null);
        expect(ui.queueKindFilter(withKind)).toBeNull();
    });

    it('the kinds\' names and the filter\'s name in four languages', () => {
        const names: Record<string, [string, string, string]> = {
            en: ['Verification', 'Registers', 'Task type'], cs: ['Ověřování', 'Matriky', 'Druh úkolu'],
            de: ['Prüfung', 'Kirchenbücher', 'Aufgabenart'], pl: ['Weryfikacja', 'Metryki', 'Rodzaj zadania'],
        };
        for (const [lang, [verify, records, label]] of Object.entries(names)) {
            setLanguage(lang as never);
            expect(ui.queueKindName('verify')).toBe(verify);
            expect(ui.queueKindName('records')).toBe(records);
            expect(strings.live.taskKindLabel).toBe(label);
            for (const k of QUEUE_TASK_KINDS) expect(strings.live.taskKinds[k]).toBeTruthy();
        }
    });
});
