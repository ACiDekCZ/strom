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
import { TASKS_AUDIT_FEATURE, auditExplain, knownAuditKinds, sanitizeWaitingAudit } from '../research-audit.js';
import { postWaitingAudit, waitingAuditReply } from '../research-waiting-write.js';
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
            'Snímky jsou zapsané jen textem, bez knihy – uložené snímky úkol neprobudí. Čeká na snímky dvou knih; jednu z nich výzkum nezná.');
    });

    it('several books all known: the sentence ends with a full stop', () => {
        expect(auditExplain(['several-books'], 'whole', true, en)).toBe('Waits for images from two books.');
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
