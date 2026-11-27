/**
 * "Did this come from a family tree (import, merge)?" (1127, `waiting.import`):
 * the item of Awaiting action read only with the feature and only when well
 * formed, its preview and its answer through the bridge (GET preview, POST
 * import / own), how a refused read or answer ends (404 gone, 503 busy with
 * Retry-After), the overview window's ask, and the texts in four languages
 * (impersonal). Invented people (Pomněnkový, Kapradinová).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WAITING_IMPORT_FEATURE, sanitizeLiveStatus, sanitizeWaiting } from '../research-link.js';
import { waitingSection, waitingTaskActions } from '../research-waiting.js';
import {
    answerImportAsk, importAskOutcomeOf, importAskStayParts, importAskWho, readImportAskOutcome, readImportAskPreview, readImportAskWritten,
    sanitizeImportAskPreview,
} from '../research-import-ask.js';
import { readOverviewAction } from '../windows/overview-window.js';
import { noteResearchWaiting, storedResearchWaiting } from '../research-device.js';
import { getStringsForLang } from '../strings.js';

const TREE = '3c1d9e40-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const BASE = 'http://127.0.0.1:5997/tok';

const ask = {
    id: 'W-S-I0042', kind: 'import', section: 'decide', phase: 'todo', actions: ['answer'],
    group: { key: 'app', name: 'Strom' }, at: '2026-11-25T17:01:01Z',
    what: 'Odeslání z aplikace 25. 11. přidalo 142 lidí – přišli z rodokmenu?',
    input: 'I0042', day: '2026-11-25', persons: 142,
    samples: [
        { id: 'P0101', name: 'Vratislav Pomněnkový' }, { id: 'P0102', name: 'Ludmila Kapradinová' },
        { id: 'P0103', name: 'Zikmund Rozrazilovský z Javorné' }, { id: 'P0104', name: 'Anežka Bezinková' },
    ],
};

function status(features: string[], waiting: unknown[] = [ask]): Record<string, unknown> {
    return { tree: { id: TREE, name: 'Pomněnkovi' }, features, waiting };
}

const preview = {
    input: 'I0042', day: '2026-11-25', persons: 142,
    change: { values: 512, persons: 138, names: 140, sexes: 138, facts: 234 },
    stay: { values: 21, changed: 15, confirmed: 4, was: 2, other: 0 },
    samples: [{ id: 'P0101', name: 'Vratislav Pomněnkový', values: ['NAME', 'SEX', 'BIRT'] }],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the import question in Awaiting action', () => {
    it('is read only with waiting.import: without it the item is not shown at all', () => {
        expect(sanitizeLiveStatus(status(['waiting.groups']))!.waiting).toEqual([]);
        const items = sanitizeLiveStatus(status(['waiting.groups', WAITING_IMPORT_FEATURE]))!.waiting;
        expect(items).toHaveLength(1);
        const w = items[0];
        expect(w).toMatchObject({ id: 'W-S-I0042', kind: 'import', section: 'decide', at: '2026-11-25T17:01:01Z', group: { key: 'app', name: 'Strom' } });
        // Up to 3 people, in the send's order.
        expect(w.importAsk).toEqual({
            input: 'I0042', day: '2026-11-25', persons: 142,
            samples: [{ id: 'P0101', name: 'Vratislav Pomněnkový' }, { id: 'P0102', name: 'Ludmila Kapradinová' }, { id: 'P0103', name: 'Zikmund Rozrazilovský z Javorné' }],
        });
        // A decision, never by the task link (its `answer` is the app's own buttons).
        expect(waitingSection(w)).toBe('decide');
        expect(waitingTaskActions(w)).toBeNull();
        expect(w.actions).toBeUndefined();
    });

    it('takes only a well-formed one: its id, its input, a count of people and a day', () => {
        const read = (patch: Record<string, unknown>) => sanitizeWaiting([{ ...ask, ...patch }], true, false, false, false, false, true);
        expect(read({ id: 'T0042' })).toEqual([]);
        expect(read({ id: 'W-B-P0001' })).toEqual([]);
        expect(read({ input: 'S0042' })).toEqual([]);
        expect(read({ persons: 0 })).toEqual([]);
        expect(read({ persons: '142' })).toEqual([]);
        expect(read({ day: '2026-02-30', at: 'yesterday' })).toEqual([]);
        // No day: the day of `at`.
        expect(read({ day: undefined })[0].importAsk?.day).toBe('2026-11-25');
        // People without a valid id or name are left out; none at all is still a question.
        const bad = read({ samples: [{ id: 'X1', name: 'A' }, { id: 'P0105', name: '' }, { id: 'P0106', name: 'Anežka Bezinková' }] });
        expect(bad[0].importAsk?.samples).toEqual([{ id: 'P0106', name: 'Anežka Bezinková' }]);
        expect(read({ samples: 'none' })[0].importAsk?.samples).toEqual([]);
        // The other items of the list are read as ever.
        const both = sanitizeWaiting([ask, { id: 'T0001', what: 'Napsat faře', kind: 'letter', section: 'letter' }], true, false, false, false, false, false);
        expect(both.map(w => w.id)).toEqual(['T0001']);
    });

    it('is kept on this device as the research said it, read again as the same item', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        const s = sanitizeLiveStatus(status(['waiting.groups', WAITING_IMPORT_FEATURE], [ask, { id: 'T0001', what: 'Napsat faře', kind: 'letter', section: 'letter', order: 1 }]))!;
        noteResearchWaiting(TREE, s.waiting, { features: s.features });
        const back = storedResearchWaiting(TREE)!.items;
        expect(back.map(w => w.id)).toEqual(['T0001', 'W-S-I0042']);
        expect(back.find(w => w.kind === 'import')).toEqual(s.waiting.find(w => w.kind === 'import'));
        // A status without the feature keeps none.
        noteResearchWaiting(TREE, sanitizeLiveStatus(status(['waiting.groups']))!.waiting, { features: ['waiting.groups'] });
        expect(storedResearchWaiting(TREE)!.items).toEqual([]);
    });

    it('says who it is about in one line', () => {
        const w = sanitizeWaiting([ask], true, false, false, false, false, true)[0];
        expect(importAskWho(w, n => `${n} people`)).toBe('142 people: Vratislav Pomněnkový, Ludmila Kapradinová, Zikmund Rozrazilovský z Javorné');
        expect(importAskWho({ importAsk: { ...w.importAsk!, samples: [] } }, n => `${n} people`)).toBe('142 people');
    });
});

describe('the preview and the answer through the bridge', () => {
    it('reads the preview: what goes ✓ → ○○ and what stays, and why', () => {
        const p = sanitizeImportAskPreview(preview)!;
        expect(p.change).toEqual({ values: 512, persons: 138 });
        expect(p.stay).toEqual({ values: 21, changed: 15, confirmed: 4, was: 2, other: 0 });
        expect(importAskStayParts(p.stay)).toEqual([{ key: 'changed', n: 15 }, { key: 'confirmed', n: 4 }, { key: 'was', n: 2 }]);
        expect(p.samples).toEqual([{ id: 'P0101', name: 'Vratislav Pomněnkový' }]);
        // Without the counts of what changes it is no preview.
        expect(sanitizeImportAskPreview({ ...preview, change: { persons: 3 } })).toBeNull();
        expect(sanitizeImportAskPreview(null)).toBeNull();
        // The stay's sum when the research does not say it.
        expect(sanitizeImportAskPreview({ ...preview, stay: { changed: 1, other: 2 } })!.stay.values).toBe(3);
    });

    it('GET waiting/W-S-I…/preview, nothing written', async () => {
        const sent: { url: string; method: string }[] = [];
        vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
            sent.push({ url, method: String(init.method) });
            return new Response(JSON.stringify(preview), { status: 200 });
        });
        const r = await readImportAskPreview(BASE, 'W-S-I0042');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.preview.change.values).toBe(512);
        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('GET');
        expect(sent[0].url).toMatch(/\/tok\/waiting\/W-S-I0042\/preview(\?|$)/);
        // Not an import question: not sent.
        expect((await readImportAskPreview(BASE, 'T0042')).ok).toBe(false);
        expect(sent).toHaveLength(1);
    });

    it('POST waiting/W-S-I… {do: import} and {do: own}, the research\'s answer read', async () => {
        const sent: { url: string; body: unknown }[] = [];
        vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as { do: string };
            sent.push({ url, body });
            const head = 'b'.repeat(40);
            return new Response(JSON.stringify(body.do === 'import'
                ? { input: 'I0042', answer: 'import', values: 512, persons: 138, backup: true, head, parent: 'a'.repeat(40) }
                : { input: 'I0042', answer: 'own', head, parent: 'a'.repeat(40) }), { status: 200 });
        });
        const yes = await answerImportAsk(BASE, 'W-S-I0042', 'import');
        expect(yes.ok).toBe(true);
        if (yes.ok) {
            expect(yes.written).toEqual({ answer: 'import', values: 512, persons: 138, backup: true });
            expect(yes.head).toBe('b'.repeat(40));
        }
        const no = await answerImportAsk(BASE, 'W-S-I0042', 'own');
        expect(no.ok && no.written).toEqual({ answer: 'own' });
        expect(sent.map(x => x.body)).toEqual([{ do: 'import' }, { do: 'own' }]);
        expect(sent[0].url).toMatch(/\/tok\/waiting\/W-S-I0042(\?|$)/);
        // Another answer than asked is no answer.
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answer: 'own' }), { status: 200 }));
        expect((await answerImportAsk(BASE, 'W-S-I0042', 'import')).ok).toBe(false);
    });

    it('404 waiting.none: gone; 503 research.busy: busy with Retry-After; no answer: the research is not running', async () => {
        const T = { busy: (s: number | null) => `busy ${s}`, down: 'down', notSaved: 'not saved', notSavedSaid: (t: string) => `not saved: ${t}` };
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'waiting.none' }), { status: 404 }));
        const gone = await answerImportAsk(BASE, 'W-S-I0042', 'own');
        expect(gone.ok).toBe(false);
        if (!gone.ok) expect(importAskOutcomeOf(gone, T)).toEqual({ ok: false, gone: true });
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'research.busy' }), { status: 503, headers: { 'Retry-After': '7' } }));
        const busy = await readImportAskPreview(BASE, 'W-S-I0042');
        expect(busy.ok).toBe(false);
        if (!busy.ok) {
            expect(busy.code).toBe('busy');
            expect(busy.retryAfter).toBe(7);
            expect(importAskOutcomeOf(busy, T)).toEqual({ ok: false, text: 'busy 7', retry: true, tone: 'warn' });
        }
        vi.stubGlobal('fetch', async () => { throw new TypeError('failed'); });
        const down = await answerImportAsk(BASE, 'W-S-I0042', 'import');
        if (!down.ok) expect(importAskOutcomeOf(down, T)).toMatchObject({ text: 'down', retry: true });
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'disk.full', text: 'Disk voll' }), { status: 507 }));
        const full = await answerImportAsk(BASE, 'W-S-I0042', 'import');
        if (!full.ok) expect(importAskOutcomeOf(full, T)).toMatchObject({ retry: false, tone: 'danger' });
    });

    it('the overview window\'s ask and its outcome are checked', () => {
        expect(readOverviewAction('waiting-import', { itemId: 'W-S-I0042', do: 'preview' })).toEqual({ action: 'waiting-import', args: { itemId: 'W-S-I0042', do: 'preview' } });
        expect(readOverviewAction('waiting-import', { itemId: 'W-S-I0042', do: 'own' })).toEqual({ action: 'waiting-import', args: { itemId: 'W-S-I0042', do: 'own' } });
        expect(readOverviewAction('waiting-import', { itemId: 'W-S-I0042', do: 'undo' })).toBeNull();
        expect(readOverviewAction('waiting-import', { do: 'import' })).toBeNull();
        expect(readImportAskOutcome({ ok: true, value: { answer: 'import', values: 5 } }, readImportAskWritten)).toEqual({ ok: true, value: { answer: 'import', values: 5 } });
        expect(readImportAskOutcome({ ok: true, value: preview }, sanitizeImportAskPreview)).toMatchObject({ ok: true, value: { change: { values: 512 } } });
        expect(readImportAskOutcome({ ok: false, gone: true }, readImportAskWritten)).toEqual({ ok: false, gone: true });
        expect(readImportAskOutcome({ ok: true, value: { answer: 'maybe' } }, readImportAskWritten)).toBeNull();
        expect(readImportAskOutcome(null, readImportAskWritten)).toBeNull();
    });
});

describe('the texts of the import question', () => {
    const PERSONAL: Record<string, RegExp> = {
        en: /\b(you|your|yours)\b/i,
        cs: /(^|[^\p{L}])(vy|vás|vám|váš|vaše|vaši|ty|tě|tvůj|tvoje)(?![\p{L}])/iu,
        de: /\b(Sie|Ihr|Ihre|Ihren|Ihnen|du|dein|deine|dich|dir)\b/,
        pl: /(^|[^\p{L}])(ty|wy|twój|twoja|wasz|wasza|pan|pani)(?![\p{L}])/iu,
    };
    for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
        it(`${lang}: every text there, impersonal`, () => {
            const T = getStringsForLang(lang).live.importAsk;
            const texts = [
                T.question, T.count(142), T.previewLoading, T.change(512, 138), T.change(1, 1), T.changeNone,
                T.stay(21, 'x'), T.stay(1, ''), T.stayPart.changed(15), T.stayPart.confirmed(4), T.stayPart.was(2), T.stayPart.other(1), T.meaning, T.yes, T.no,
                T.doneImport(512, 138), T.doneImport(null, null), T.doneOwn, T.gone, T.previewFailed, T.busy(7), T.busy(null), T.notSaved, T.notSavedSaid('x'),
            ];
            for (const t of texts) {
                expect(t.trim().length).toBeGreaterThan(0);
                expect(t).not.toMatch(PERSONAL[lang]);
            }
            // The marks as the app draws them.
            expect(T.meaning).toContain('✓');
            expect(T.meaning).toContain('○○');
            expect(T.change(512, 138)).toMatch(/512.*138/);
        });
    }
});
