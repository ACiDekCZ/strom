/**
 * A task's finding in "Awaiting action" (spec 109 §1, §4): the item's `audit`
 * read only from a research that announces `tasks.audit` (an unknown `fix`
 * is none, unknown codes kept for the heading alone, a bad one dropped), the
 * explanation's sentences in their order, the writes of Leave as is and its
 * Undo (`{do, expect}`; no `expect` with `unkeep`), and the row shown until
 * the finding is left as it is (Discuss goes back to the item's actions).
 * Invented tasks and books only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { sanitizeLiveStatus, type LiveWaiting } from '../research-link.js';
import {
    TASKS_AUDIT_FEATURE, asAuditPreview, auditChangeLines, auditExplain, auditFixError, auditImagesSeveral, auditLeftLines,
    knownAuditKinds, sanitizeAuditPreview, sanitizeWaitingAudit,
} from '../research-audit.js';
import { getWaitingAuditPreview, postWaitingAudit, waitingAuditPreviewReply, waitingAuditReply } from '../research-waiting-write.js';
import { setWaitingAuditState, waitingAuditShown } from '../ui/waiting-task-ui.js';
import { getStringsForLang } from '../strings.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

const status = (features: string[], waiting: unknown[]) => sanitizeLiveStatus({
    tree: { id: 'R1', name: 'Smyšlenka' }, head: 'a1', persons: 1, families: 0, features, waiting,
})!;

const item = (id: string, audit: unknown, extra: Record<string, unknown> = {}) => ({
    id, what: 'Snímky 57–58 z knihy Smyšlenka 3, N 1784–1820 a snímek 14 z knihy Vymyšlov 9, O 1801–1850', on: 'user', at: '2026-11-12T09:00:00Z',
    kind: 'images', section: 'images', actions: ['answer', 'chat'], audit, ...extra,
});

const T0412 = { kinds: ['images-as-text', 'several-books', 'book-unknown'], fix: 'part', stamp: 'T0412@2026-11-12T09:00:00Z' };

describe('the finding read from the status (§1.1)', () => {
    it('only from a research that announces tasks.audit', () => {
        const older = status(['waiting.groups'], [item('T0412', T0412)]);
        expect(older.waiting[0].audit).toBeUndefined();
        const newer = status(['waiting.groups', TASKS_AUDIT_FEATURE], [item('T0412', T0412)]);
        expect(newer.waiting[0].audit).toEqual(T0412);
    });

    it('only at a task, only a well-formed one', () => {
        const s = status(['waiting.groups', TASKS_AUDIT_FEATURE], [
            item('H0003', T0412, { kind: 'hypothesis' }),
            item('T0001', { ...T0412, stamp: '' }),
            item('T0002', { ...T0412, kinds: [] }),
            item('T0003', 'images-as-text'),
        ]);
        expect(s.waiting.map(w => w.audit)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('an unknown fix is none; unknown codes stay (the heading alone), bad ones go', () => {
        expect(sanitizeWaitingAudit({ kinds: ['archive-setting', 'Bad Code', 7, 'images-as-text', 'images-as-text'], fix: 'all', stamp: 'T1@x' }))
            .toEqual({ kinds: ['archive-setting', 'images-as-text'], fix: 'none', stamp: 'T1@x' });
        expect(knownAuditKinds(['archive-setting', 'book-unknown', 'images-as-text'])).toEqual(['images-as-text', 'book-unknown']);
    });
});

describe('what the finding means (§1.3, D1, D2)', () => {
    const cs = getStringsForLang('cs').live.waitingAudit;
    const en = getStringsForLang('en').live.waitingAudit;

    it('T0412: images as text, then two books one of which the research does not know', () => {
        expect(auditExplain(T0412.kinds, 'part', true, cs)).toBe(
            'Snímky jsou zapsané jen textem, bez knihy – uložené snímky úkol neprobudí. Čeká na snímky z více knih; jednu z nich výzkum nezná.');
    });

    it('several books all known: the sentence ends with a full stop', () => {
        expect(auditExplain(['several-books'], 'whole', true, en)).toBe('Waits for images from several books.');
    });

    it('several books names no number (the status says none; three books or more are no "two")', () => {
        const said = (['cs', 'en', 'de', 'pl'] as const).map(l => getStringsForLang(l).live.waitingAudit.auditKindBooks);
        expect(said).toEqual(['Čeká na snímky z více knih', 'Waits for images from several books', 'Wartet auf Scans aus mehreren Büchern', 'Czeka na skany z kilku ksiąg']);
        for (const text of said) expect(text).not.toMatch(/dvou|two|zwei|dwóch|\d/);
    });

    it('T0377 (whole): the images-as-text sentence alone', () => {
        expect(auditExplain(['images-as-text'], 'whole', true, cs)).toBe(cs.auditKindText);
    });

    it('T0520 (none, with an agent): the unknown book, then that the agent adds it', () => {
        expect(auditExplain(['book-unknown'], 'none', true, cs)).toBe(`${cs.auditKindUnknown} ${cs.auditAgentAdds}`);
        // Without an agent (an archive): no sentence about the agent.
        expect(auditExplain(['book-unknown'], 'none', false, cs)).toBe(cs.auditKindUnknown);
    });

    it('folder-missing has its own sentence (D1)', () => {
        expect(auditExplain(['folder-missing'], 'whole', true, en)).toBe('The folder for images is missing – the fix creates it.');
    });

    it('only unknown codes: no sentence, the heading alone (D2)', () => {
        expect(auditExplain(['archive-setting'], 'none', true, en)).toBe('');
    });
});

describe('Leave as is and its Undo through the bridge (§4, D4)', () => {
    const sent: { url: string; body: unknown }[] = [];
    const answer = (status: number, json: unknown) => vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return { status, json: async () => json, headers: { get: () => null } } as unknown as Response;
    });

    it('keep sends the stamp as expect, unkeep none', async () => {
        sent.length = 0;
        vi.stubGlobal('fetch', answer(200, { task: 'T0412', kept: { at: '2026-11-18T10:00:00Z', by: 'person', givenIn: 'app' }, head: 'b2b2b2b2', parent: 'a1a1a1a1' }));
        const kept = await postWaitingAudit('http://127.0.0.1:9/tok', 'T0412', 'keep', { expect: T0412.stamp });
        expect(kept).toEqual({ ok: true, task: 'T0412', tasks: [], woke: [], kept: { at: '2026-11-18T10:00:00Z' }, head: 'b2b2b2b2', parent: 'a1a1a1a1' });
        vi.stubGlobal('fetch', answer(200, { task: 'T0412', kept: null, head: 'c3c3c3c3', parent: 'b2b2b2b2' }));
        const back = await postWaitingAudit('http://127.0.0.1:9/tok', 'T0412', 'unkeep', { expect: T0412.stamp });
        expect(back).toMatchObject({ ok: true, kept: null, head: 'c3c3c3c3' });
        expect(sent.map(x => x.body)).toEqual([{ do: 'keep', expect: T0412.stamp }, { do: 'unkeep' }]);
        expect(sent[0].url).toContain('/waiting/T0412');
    });

    it('refusals: a finding gone, the stamp changed, the research busy, its disk full', () => {
        expect(waitingAuditReply(409, { code: 'audit.none' })).toMatchObject({ ok: false, code: 'audit-none' });
        expect(waitingAuditReply(409, { code: 'waiting.changed', id: 'T0412', at: '2026-11-18T10:00:00Z' })).toMatchObject({ ok: false, code: 'changed' });
        expect(waitingAuditReply(409, { code: 'audit.changed', id: 'T0412', changed: ['T0412', 'T0413'] })).toMatchObject({ code: 'audit-changed', changed: ['T0412', 'T0413'] });
        expect(waitingAuditReply(503, { code: 'research.busy' })).toMatchObject({ code: 'busy' });
        expect(waitingAuditReply(507, { code: 'disk.full', error: 'Disk full' })).toMatchObject({ code: 'held', held: { kind: 'disk' } });
    });
});

describe('the row stays until the finding is left as it is (§3, §4)', () => {
    const s = { treeId: 'tree-a' };
    const w = (audit: typeof T0412 | undefined): LiveWaiting => ({ id: 'T0412', what: 'x', on: 'user', at: '', ...(audit ? { audit: { ...audit, fix: 'part' as const } } : {}) });

    it('kept: hidden while the status still carries that finding; a new finding shows again', () => {
        expect(waitingAuditShown(s, w(T0412))?.stamp).toBe(T0412.stamp);
        setWaitingAuditState('tree-a|T0412', { phase: 'kept', stamp: T0412.stamp });
        expect(waitingAuditShown(s, w(T0412))).toBeNull();
        // The agent rewrote the waiting and the finding came again: shown, the old state gone.
        const again = { ...T0412, stamp: 'T0412@2026-11-19T08:00:00Z' };
        expect(waitingAuditShown(s, w(again))?.stamp).toBe(again.stamp);
        expect(waitingAuditShown(s, w(T0412))?.stamp).toBe(T0412.stamp);
    });

    it('no finding: nothing shown (Discuss stays in the item\'s actions)', () => {
        expect(waitingAuditShown(s, w(undefined))).toBeNull();
    });
});

describe('the fix\'s preview (§2.2, §2.3, D3–D5)', () => {
    const en = getStringsForLang('en').live.waitingAudit;
    const BOOK = 'Smyšlenka 3, N 1784–1820';
    const OTHER = 'Vymyšlov 9, O 1801–1850';
    const body = (changes: unknown[], left: unknown[] = [], unknown: unknown[] = []) => ({
        task: 'T0412', at: '2026-11-18T10:00:00Z',
        findings: [{ kind: 'images-as-text' }, { kind: 'book-unknown', unknown }],
        fix: { can: 'part', stamp: 'T0412@2026-11-12T09:14:03Z', changes, left },
        kept: null, fixed: null,
    });
    const lines = (changes: unknown[], titleOf: (t: string) => string | null = () => null) =>
        auditChangeLines(sanitizeAuditPreview(body(changes))!, titleOf, en).map(l => [l.kind, l.lead, l.text, l.sub?.text ?? null, l.sub?.folder ?? null]);

    it('read with its stamp; bad changes and codes dropped, a hyphen between numbers an en dash', () => {
        const p = sanitizeAuditPreview(body([
            { op: 'wait-images', task: 'T0412', book: 'B0003', title: BOOK, images: '57-58', folder: 'Smyšlenka 3 N' },
            { op: 'delete', task: 'T0412' },
            { op: 'split', task: null, from: 'T0412', title: OTHER, images: '14', waits: 'text' },
        ], ['book-unknown', 'Bad Code', 'book-unknown'], [OTHER, OTHER]));
        expect(p).toMatchObject({ task: 'T0412', can: 'part', stamp: 'T0412@2026-11-12T09:14:03Z', left: ['book-unknown'], unknown: [OTHER] });
        expect(p!.changes.map(c => c.op)).toEqual(['wait-images', 'split']);
        expect(p!.changes[0]).toMatchObject({ images: '57–58' });
        expect(sanitizeAuditPreview({ task: 'T0412', fix: { stamp: 'has space' } })).toBeNull();
        expect(sanitizeAuditPreview({ task: 'nope', fix: { stamp: 'x' } })).toBeNull();
    });

    it('several images from a range or a list, one image alone', () => {
        expect([auditImagesSeveral('57–58'), auditImagesSeveral('1–3, 7'), auditImagesSeveral('3,7'), auditImagesSeveral('14')]).toEqual([true, true, true, false]);
    });

    it('the lines: this task or another\'s title, images or a book, the folder, a split known or not (D1–D4)', () => {
        expect(lines([
            { op: 'wait-images', task: 'T0412', book: 'B0003', title: BOOK, images: '57–58', folder: 'Smyšlenka 3 N' },
            { op: 'wait-images', task: 'T0413', book: 'B0003', title: '', images: '14', folder: '' },
            { op: 'wait-book', task: 'T0499', book: 'B0003', title: BOOK, folder: 'Smyšlenka 3 N' },
            { op: 'folder', task: 'T0412', book: 'B0003', folder: 'Smyšlenka 3 N' },
            { op: 'split', task: null, from: 'T0412', book: 'B0007', title: OTHER, images: '1–3, 7', folder: 'Vymyšlov 9 O', waits: 'images' },
            { op: 'split', task: null, from: 'T0412', title: OTHER, images: '14', waits: 'text' },
            { op: 'split', task: null, from: 'T0412', book: 'B0007', title: OTHER, waits: 'book', folder: 'Vymyšlov 9 O' },
        ], t => (t === 'T0413' ? 'Sňatek ve Vymyšlově, 1820' : null))).toEqual([
            ['change', 'This task', `will wait for images 57–58 of the book ${BOOK}`, 'Folder Smyšlenka 3 N', true],
            ['change', 'Sňatek ve Vymyšlově, 1820', 'will wait for image 14 of the book B0003', null, null],
            ['change', 'T0499', `will wait for images of the book ${BOOK}; image numbers are not known`, 'Folder Smyšlenka 3 N', true],
            ['change', 'This task', 'the folder Smyšlenka 3 N will be created', null, null],
            ['new', 'New task', `for images 1–3, 7 of the book ${OTHER}`, 'Folder Vymyšlov 9 O', true],
            ['new', 'New task', `for image 14 of the book ${OTHER}`, 'the book is not in the research, the new task keeps waiting as text', false],
            ['new', 'New task', `for the book ${OTHER}`, 'Folder Vymyšlov 9 O', true],
        ]);
    });

    it('what remains: each unknown book, with or without the agent', () => {
        const p = sanitizeAuditPreview(body([{ op: 'folder', task: 'T0412', book: 'B0003', folder: 'x' }], ['book-unknown'], [OTHER]))!;
        expect(auditLeftLines(p, true, en)).toEqual([`The book ${OTHER} is missing from the research – the agent adds it.`]);
        expect(auditLeftLines(p, false, en)).toEqual([`The book ${OTHER} is missing from the research.`]);
        expect(auditLeftLines({ ...p, left: [] }, true, en)).toEqual([]);
    });

    it('a preview handed over by the main window is read again as the research\'s', () => {
        const p = sanitizeAuditPreview(body([{ op: 'wait-images', task: 'T0412', book: 'B0003', title: BOOK, images: '57–58', folder: 'x' }], ['book-unknown'], [OTHER]))!;
        expect(asAuditPreview(JSON.parse(JSON.stringify(p)))).toEqual(p);
        expect(asAuditPreview({ ...p, stamp: '' })).toBeNull();
        expect(asAuditPreview('nope')).toBeNull();
    });

    it('GET <base>/waiting/<T…>/fix; refusals mapped to what the preview says', async () => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            urls.push(`${init.method} ${url}`);
            return { status: 200, json: async () => body([{ op: 'folder', task: 'T0412', book: 'B0003', folder: 'x' }]), headers: { get: () => null } } as unknown as Response;
        }));
        const r = await getWaitingAuditPreview('http://127.0.0.1:9/tok', 'T0412');
        expect(r).toMatchObject({ ok: true, preview: { task: 'T0412', changes: [{ op: 'folder' }] } });
        expect(urls[0]).toMatch(/^GET http:\/\/127\.0\.0\.1:9\/tok\/waiting\/T0412\/fix/);
        expect(waitingAuditPreviewReply(200, { nope: 1 })).toMatchObject({ ok: false, code: 'invalid' });
        const err = (status: number, b: unknown) => {
            const x = waitingAuditPreviewReply(status, b);
            return x.ok ? 'ok' : auditFixError(x);
        };
        expect([
            err(404, { code: 'waiting.none' }), err(409, { code: 'audit.none' }), err(409, { code: 'waiting.changed' }),
            err(409, { code: 'audit.changed', changed: ['T0412'] }), err(503, { code: 'research.busy' }), err(423, { code: 'locked' }),
            err(507, { code: 'disk.full', error: 'Disk full' }), err(500, {}),
        ]).toEqual(['gone', 'gone', 'changed', 'changed', 'busy', 'locked', 'disk', 'other']);
    });
});
