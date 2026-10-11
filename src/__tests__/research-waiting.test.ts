/**
 * "Awaiting action" from a research with `waiting.groups` (Strom Research
 * 1.13.2-beta.13): the item's kind, chip, place, phase, order, address, query
 * text, addressee, images folder and actions are read only with the feature
 * and dropped when wrong; to do and sent, chips, groups by place, the small
 * panel's first five, the task link's actions and the counts that go by what
 * is to do. Invented archives and offices only.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import {
    LiveWaiting, MAX_WAITING, ResearchLinkAction, researchSchemeUrl, sanitizeLiveStatus, sanitizeWaiting, WAITING_GROUPS_FEATURE,
} from '../research-link.js';
import { noteResearchWaiting, storedResearchWaiting } from '../research-device.js';
import {
    effectiveWaitingFilter, filterWaiting, groupWaiting, orderWaiting, panelWaiting, textWithLinks, todoWaiting, waitingActionDo,
    waitingChatLeads, waitingChips, waitingDaysAgo, waitingGroupChatTask, waitingPhase, waitingPhases, waitingSection, waitingTaskActions,
    waitingTodoCount,
} from '../research-waiting.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

const letter = (id: string, extra: Record<string, unknown> = {}) => ({
    id, what: `Dopis ${id}`, on: 'odpověď úřadu', at: '2026-10-01T08:00:00Z', kind: 'letter', section: 'letter',
    group: { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' }, ...extra,
});

const FULL = {
    id: 'T0197', what: 'Napsat matrice do Vzorova', on: 'odpověď matriky', at: '2026-09-20T08:00:00Z', person: 'P0012', research: 'G0002',
    kind: 'letter', section: 'letter', group: { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' },
    phase: 'sent', sentAt: '2026-10-02T09:00:00Z', order: 7, priority: 2,
    url: 'https://archiv-vzorov.example/kniha/12', note: 'notes/T0197-dotaz-vzorov.md', to: 'MěÚ Vzorov',
    inbox: { dir: 'inbox/T0197', have: 3, want: 10 }, actions: ['chat', 'answer', 'file', 'note', 'sent', 'folder'],
};

describe('sanitizeWaiting with waiting.groups', () => {
    it('reads every field of the research', () => {
        const [w] = sanitizeWaiting([FULL], true);
        expect(w).toEqual({
            id: 'T0197', what: 'Napsat matrice do Vzorova', on: 'odpověď matriky', at: '2026-09-20T08:00:00Z', person: 'P0012', research: 'G0002',
            kind: 'letter', section: 'letter', group: { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' },
            phase: 'sent', sentAt: '2026-10-02T09:00:00Z', order: 7, priority: 2,
            url: 'https://archiv-vzorov.example/kniha/12', note: 'notes/T0197-dotaz-vzorov.md', to: 'MěÚ Vzorov',
            inbox: { dir: 'inbox/T0197', have: 3, want: 10 },
            // The known actions only, in their own order.
            actions: ['answer', 'file', 'note', 'folder', 'sent', 'chat'],
        });
    });

    it('reads none of them without the feature', () => {
        const [w] = sanitizeWaiting([FULL]);
        expect(w).toEqual({
            id: 'T0197', what: 'Napsat matrice do Vzorova', on: 'odpověď matriky', at: '2026-09-20T08:00:00Z', person: 'P0012', research: 'G0002',
        });
    });

    it('takes the feature from the status', () => {
        expect(sanitizeLiveStatus({ waiting: [FULL], features: [WAITING_GROUPS_FEATURE] })?.waiting[0].group?.name).toBe('MěÚ Vzorov');
        expect(sanitizeLiveStatus({ waiting: [FULL], features: ['status.recent'] })?.waiting[0].group).toBeUndefined();
        expect(sanitizeLiveStatus({ waiting: [FULL] })?.waiting[0].phase).toBeUndefined();
    });

    it('drops what is wrong and keeps the item', () => {
        const [w] = sanitizeWaiting([{
            ...FULL, phase: 'done', sentAt: '2026-10-02T09:00:00Z', order: -1, priority: 6,
            url: 'javascript:alert(1)', note: 'notes/../secret.md', to: '', inbox: { dir: 'x', have: -1, want: 3 }, actions: ['delete', 'answer', 7],
            group: { key: 'repo:R0001', name: '' },
        }], true);
        expect(w.id).toBe('T0197');
        expect(w.phase).toBeUndefined();
        expect(w.sentAt).toBeUndefined();
        expect(w.order).toBeUndefined();
        expect(w.priority).toBeUndefined();
        expect(w.url).toBeUndefined();
        expect(w.note).toBeUndefined();
        expect(w.to).toBeUndefined();
        expect(w.inbox).toBeUndefined();
        expect(w.group).toBeUndefined();
        expect(w.actions).toEqual(['answer']);
    });

    it('takes only http(s) addresses', () => {
        for (const url of ['ftp://archiv.example/x', 'data:text/html,x', 'archiv.example/x', 'https://archiv .example/x', 42]) {
            expect(sanitizeWaiting([{ ...FULL, url }], true)[0].url).toBeUndefined();
        }
        expect(sanitizeWaiting([{ ...FULL, url: 'http://archiv.example/a?b=1' }], true)[0].url).toBe('http://archiv.example/a?b=1');
    });

    it('takes only a relative notes/….md path as the query text', () => {
        for (const note of ['/notes/a.md', 'notes/a.txt', 'notes/a b.md', 'notes//a.md', 'notes/./a.md', 'notes\\a.md', '../notes/a.md', 'other/a.md']) {
            expect(sanitizeWaiting([{ ...FULL, note }], true)[0].note).toBeUndefined();
        }
        expect(sanitizeWaiting([{ ...FULL, note: 'notes/2026/T0197.md' }], true)[0].note).toBe('notes/2026/T0197.md');
    });

    it('a sent item without a valid time stays sent', () => {
        const [w] = sanitizeWaiting([{ ...FULL, sentAt: 'včera' }], true);
        expect(w.phase).toBe('sent');
        expect(w.sentAt).toBeUndefined();
        expect(waitingPhase(w)).toBe('sent');
    });

    it('an unknown kind is "other", whatever chip it names; a missing chip comes from the kind', () => {
        const [a, b, c] = sanitizeWaiting([
            { id: 'T0001', what: 'Něco nového', kind: 'teleport', section: 'letter' },
            { id: 'T0002', what: 'Snímky', kind: 'images', section: 'nonsense' },
            { id: 'T0003', what: 'Bez druhu' },
        ], true);
        expect([a.kind, a.section]).toEqual(['other', 'other']);
        expect([b.kind, b.section]).toEqual(['images', 'images']);
        expect([c.kind, c.section]).toEqual(['other', 'other']);
    });

    it('a group needs a key and a name; an unknown kind of place is "other"', () => {
        const [a, b] = sanitizeWaiting([
            letter('T0001', { group: { key: 'host:rodokmen.example', name: 'rodokmen.example', kind: 'forum' } }),
            letter('T0002', { group: { name: 'Bez klíče', kind: 'office' } }),
        ], true);
        expect(a.group).toEqual({ key: 'host:rodokmen.example', name: 'rodokmen.example', kind: 'other' });
        expect(b.group).toBeUndefined();
    });

    it('keeps a story, an archive\'s question, a takeover and a check as they work', () => {
        const [story, permission, takeover, check] = sanitizeWaiting([
            { id: 'P0001', kind: 'story', what: 'Nová verze vyprávění', person: 'P0001', group: { key: 'stories', name: 'Vyprávění', kind: 'other' } },
            { id: 'x', kind: 'permission', host: 'archiv-vzorov.example', what: 'Stahování', on: 'Podmínky', group: { key: 'repo:R0001', name: 'Archiv Vzorov', kind: 'archive' } },
            { id: 'takeover', kind: 'takeover', what: 'Převzít stahovače' },
            { id: 'T0005', kind: 'check', what: 'Ověřit web', url: 'https://badatelna.example/' },
        ], true);
        expect([story.kind, story.section, story.id]).toEqual(['story', 'decide', 'P0001']);
        expect([permission.kind, permission.host, permission.id, permission.section, permission.group?.kind])
            .toEqual(['permission', 'archiv-vzorov.example', 'permission:archiv-vzorov.example', 'decide', 'archive']);
        expect([takeover.kind, takeover.section]).toEqual(['takeover', 'decide']);
        expect([check.kind, check.section, check.url]).toEqual(['check', 'decide', 'https://badatelna.example/']);
    });

    it('takes up to 200 items (other lists keep 50)', () => {
        const many = Array.from({ length: 250 }, (_, i) => letter(`T${String(i + 1).padStart(4, '0')}`));
        expect(MAX_WAITING).toBe(200);
        expect(sanitizeWaiting(many, true)).toHaveLength(200);
        expect(sanitizeWaiting(many)).toHaveLength(200);
        expect(sanitizeLiveStatus({ queue: [], working: Array.from({ length: 80 }, () => ({ who: 'agent' })) })?.working).toHaveLength(50);
    });

    it('keeps the id when an item moves from to do to sent', () => {
        const [todo] = sanitizeWaiting([letter('T0042')], true);
        const [sent] = sanitizeWaiting([letter('T0042', { phase: 'sent', sentAt: '2026-10-03T10:00:00Z' })], true);
        expect(todo.id).toBe('T0042');
        expect(sent.id).toBe(todo.id);
        expect([waitingPhase(todo), waitingPhase(sent)]).toEqual(['todo', 'sent']);
    });
});

describe('the remembered list', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps the new fields when the research announced them, and only then', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
        const items = sanitizeWaiting([FULL], true);
        noteResearchWaiting(TREE, items, { features: [WAITING_GROUPS_FEATURE] });
        const [w] = storedResearchWaiting(TREE)!.items;
        expect(w).toMatchObject({
            id: 'T0197', kind: 'letter', section: 'letter', group: { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' },
            phase: 'sent', sentAt: '2026-10-02T09:00:00Z', order: 7, url: 'https://archiv-vzorov.example/kniha/12',
            note: 'notes/T0197-dotaz-vzorov.md', to: 'MěÚ Vzorov', inbox: { have: 3, want: 10 }, actions: ['answer', 'file', 'note', 'folder', 'sent', 'chat'],
        });
        noteResearchWaiting(TREE, items, {});
        expect(storedResearchWaiting(TREE)!.items[0]).toEqual({ id: 'T0197', what: 'Napsat matrice do Vzorova', on: '', at: '2026-09-20T08:00:00Z', person: 'P0012' });
    });
});

const items = (list: Record<string, unknown>[]): LiveWaiting[] => sanitizeWaiting(list, true);

describe('to do, sent, chips and groups', () => {
    const list = items([
        { id: 'T0001', what: 'Rozhodnout o webu', kind: 'check', order: 0, group: { key: 'host:badatelna.example', name: 'badatelna.example', kind: 'web' } },
        { id: 'T0002', what: 'Snímek 1', kind: 'images', order: 1, group: { key: 'repo:R0001', name: 'Archiv Vzorov', kind: 'archive' } },
        { id: 'T0003', what: 'Nejistá věc', kind: 'other', order: 2, group: { key: 'other', name: 'Ostatní', kind: 'other' } },
        { id: 'T0004', what: 'Snímek 2', kind: 'images', order: 3, group: { key: 'repo:R0001', name: 'Archiv Vzorov', kind: 'archive' } },
        { id: 'T0005', what: 'Zeptat se tety', kind: 'family', order: 4, group: { key: 'family', name: 'Rodina', kind: 'family' } },
        { id: 'T0006', what: 'Dopis', kind: 'letter', order: 5, phase: 'sent', sentAt: '2026-10-02T09:00:00Z', group: { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' } },
        { id: 'T0007', what: 'Bez místa', kind: 'web', order: 6 },
    ]);

    it('counts only what is to do', () => {
        expect(waitingTodoCount(list)).toBe(6);
        expect(todoWaiting(list).map(w => w.id)).not.toContain('T0006');
        // An older research has no phases: everything is to do.
        expect(waitingTodoCount(sanitizeWaiting([FULL]))).toBe(1);
        expect(waitingTodoCount(sanitizeWaiting([FULL], true))).toBe(0);
    });

    it('groups by place where the first item stands, "other" at the bottom', () => {
        const groups = groupWaiting(todoWaiting(list));
        expect(groups.map(g => g.key)).toEqual(['host:badatelna.example', 'repo:R0001', 'family', 'other']);
        expect(groups[1].items.map(w => w.id)).toEqual(['T0002', 'T0004']);
        // An item without a place joins "other".
        expect(groups[3].items.map(w => w.id)).toEqual(['T0003', 'T0007']);
        expect(groups[3].group?.name).toBe('Ostatní');
    });

    it('splits the phases after the filter', () => {
        const all = waitingPhases(list, 'all');
        expect(all.todo.flatMap(g => g.items).length).toBe(6);
        expect(all.sent.map(g => g.key)).toEqual(['to:MěÚ Vzorov']);
        const images = waitingPhases(list, 'images');
        expect(images.todo.map(g => g.key)).toEqual(['repo:R0001']);
        expect(images.sent).toEqual([]);
    });

    it('keeps the research\'s order, settled by `order` after a filter', () => {
        const shuffled = [list[3], list[0], list[1]];
        expect(orderWaiting(shuffled).map(w => w.id)).toEqual(['T0001', 'T0002', 'T0004']);
        // Without `order`: as it came.
        const plain = sanitizeWaiting([{ id: 'T0009', what: 'b' }, { id: 'T0008', what: 'a' }]);
        expect(orderWaiting(plain).map(w => w.id)).toEqual(['T0009', 'T0008']);
        expect(filterWaiting(list, 'decide').map(w => w.id)).toEqual(['T0001']);
    });

    it('has chips for the sections present only, when two or more', () => {
        expect(waitingChips(list)).toEqual([
            { section: 'decide', count: 1 }, { section: 'images', count: 2 }, { section: 'letter', count: 1 },
            { section: 'family', count: 1 }, { section: 'web', count: 1 }, { section: 'other', count: 1 },
        ]);
        expect(waitingChips(items([{ id: 'T1', what: 'a', kind: 'images' }, { id: 'T2', what: 'b', kind: 'images' }]))).toEqual([]);
    });

    it('a filter that has nothing left falls back to all', () => {
        expect(effectiveWaitingFilter(list, 'family')).toBe('family');
        expect(effectiveWaitingFilter(list.filter(w => w.kind !== 'family'), 'family')).toBe('all');
        expect(effectiveWaitingFilter(list.filter(w => w.kind === 'images'), 'images')).toBe('all');
    });

    it('a section from an older research comes from the kind', () => {
        const [story, plain] = sanitizeWaiting([{ id: 'P0001', kind: 'story', what: 'Vyprávění', person: 'P0001' }, { id: 'T0001', what: 'Úkol' }]);
        expect(waitingSection(story)).toBe('decide');
        expect(waitingSection(plain)).toBe('other');
    });

    it('the small panel lists the first five to do, in order, and counts the rest', () => {
        const many = items(Array.from({ length: 9 }, (_, i) => ({
            id: `T${String(i + 1).padStart(4, '0')}`, what: `Úkol ${i + 1}`, kind: 'letter', order: 8 - i, ...(i === 0 ? { phase: 'sent' } : {}),
        })));
        const { shown, more } = panelWaiting(many);
        expect(shown.map(w => w.id)).toEqual(['T0009', 'T0008', 'T0007', 'T0006', 'T0005']);
        expect(more).toBe(3);
        expect(panelWaiting(many.slice(0, 3))).toMatchObject({ more: 0 });
    });
});

describe('the task link\'s actions', () => {
    it('offers only those the research named, Chat right next to Answer', () => {
        const [w] = items([{ ...FULL, phase: undefined }]);
        expect(waitingTaskActions(w)).toEqual(['answer', 'chat', 'file', 'note', 'folder', 'sent']);
        const [few] = items([{ ...FULL, phase: undefined, actions: ['folder'] }]);
        expect(waitingTaskActions(few)).toEqual(['folder']);
    });

    it('images: Chat leads as the main button (nothing is answered there)', () => {
        const [images] = items([{ id: 'T0010', what: 'Snímky', kind: 'images', actions: ['folder', 'chat', 'answer'] }]);
        expect(waitingTaskActions(images)).toEqual(['chat', 'answer', 'folder']);
        expect(waitingChatLeads(images)).toBe(true);
        expect(waitingChatLeads(items([FULL])[0])).toBe(false);
    });

    it('a group\'s chat opens the first item in order that offers one', () => {
        const group = items([
            { id: 'T0001', what: 'Kontrola', kind: 'check', order: 0, actions: ['answer'] },
            { id: 'T0005', what: 'Web 2', kind: 'web', order: 4, actions: ['answer', 'chat'] },
            { id: 'T0003', what: 'Web 1', kind: 'web', order: 2, actions: ['chat'] },
        ]);
        expect(waitingGroupChatTask(group)).toBe('T0003');
        expect(waitingGroupChatTask(group.slice(0, 1))).toBeNull();
        // A story or an archive's question never chats by the task link.
        expect(waitingGroupChatTask(items([{ id: 'x', kind: 'permission', host: 'archiv-vzorov.example', what: 'Stahování', actions: ['chat'] }]))).toBeNull();
        expect(waitingGroupChatTask(sanitizeWaiting([FULL]))).toBeNull();
    });

    it('none named: Answer as before (null); an empty list: none', () => {
        expect(waitingTaskActions(sanitizeWaiting([FULL])[0])).toBeNull();
        expect(waitingTaskActions(items([{ ...FULL, actions: undefined }])[0])).toBeNull();
        expect(waitingTaskActions(items([{ ...FULL, actions: [] }])[0])).toEqual([]);
    });

    it('what was sent is not marked sent again', () => {
        expect(waitingTaskActions(items([FULL])[0])).toEqual(['answer', 'chat', 'file', 'note', 'folder']);
    });

    it('a story, an archive\'s question and a takeover never go by the task link', () => {
        const [story, permission, takeover] = items([
            { id: 'P0001', kind: 'story', what: 'Vyprávění', person: 'P0001', actions: ['answer'] },
            { id: 'x', kind: 'permission', host: 'archiv-vzorov.example', what: 'Stahování', actions: ['answer'] },
            { id: 'takeover', kind: 'takeover', what: 'Převzít', actions: ['answer'] },
        ]);
        expect([waitingTaskActions(story), waitingTaskActions(permission), waitingTaskActions(takeover)]).toEqual([null, null, null]);
    });

    it('each action is the task link with its do (answer: none)', () => {
        const t = `strom-research://task?tree=${TREE}&task=T0197`;
        expect(researchSchemeUrl('task', { tree: TREE, task: 'T0197', taskDo: waitingActionDo('answer') })).toBe(t);
        for (const a of ['file', 'note', 'folder', 'sent', 'chat'] as const) {
            expect(researchSchemeUrl('task', { tree: TREE, task: 'T0197', taskDo: waitingActionDo(a) })).toBe(`${t}&do=${a}`);
        }
        expect(researchSchemeUrl('task', { tree: TREE, task: 'T0197', taskDo: 'unsent' as never })).toBeNull();
    });
});

describe('how long ago it was sent', () => {
    it('in days, in the UI language', () => {
        const now = Date.parse('2026-10-11T12:00:00Z');
        expect(waitingDaysAgo(now - 9 * 86_400_000, now, 'en')).toBe('9 days ago');
        expect(waitingDaysAgo(now - 9 * 86_400_000, now, 'cs')).toBe('před 9 dny');
        expect(waitingDaysAgo(now - 9 * 86_400_000, now, 'de')).toBe('vor 9 Tagen');
        expect(waitingDaysAgo(now - 3_600_000, now, 'en')).toBe('today');
    });
});

describe('addresses in the text', () => {
    it('become links, closing punctuation outside, anything else plain', () => {
        expect(textWithLinks('Viz https://archiv-vzorov.example/kniha/12, pak (https://badatelna.example/a_(b)).')).toEqual([
            { text: 'Viz ' }, { text: 'https://archiv-vzorov.example/kniha/12', url: 'https://archiv-vzorov.example/kniha/12' },
            { text: ', pak (' }, { text: 'https://badatelna.example/a_(b)', url: 'https://badatelna.example/a_(b)' }, { text: ').' },
        ]);
        expect(textWithLinks('notes/T0197-dotaz.md a javascript:alert(1)')).toEqual([{ text: 'notes/T0197-dotaz.md a javascript:alert(1)' }]);
        expect(textWithLinks('')).toEqual([]);
    });
});

type CountUi = { researchWaitingCount(): number };

describe('the counts go by what is to do', () => {
    let actions: Record<string, unknown>;
    let liveState: (s: unknown) => { cls: string };
    beforeAll(async () => {
        ({ researchActionsMethods: actions } = await import('../ui/research-actions-ui.js') as unknown as { researchActionsMethods: Record<string, unknown> });
        ({ liveState } = await import('../ui/research-ui.js') as unknown as { liveState: typeof liveState });
    }, 60000);

    const mixed = items([
        { id: 'T0001', what: 'Dopis', kind: 'letter', phase: 'sent', sentAt: '2026-10-02T09:00:00Z' },
        { id: 'T0002', what: 'Dopis 2', kind: 'letter', phase: 'sent' },
        { id: 'T0003', what: 'Snímky', kind: 'images' },
    ]);

    it('in the Research menu', () => {
        const ctx = {
            ...actions,
            researchMenuShown: () => true, researchAnyAnnounced: () => true, activeResearchModeKnown: () => true,
            researchWaiting: () => ({ items: mixed, at: 0, live: true, update: null, lastIntake: null }),
            researchLinkAvailable: (_a: ResearchLinkAction) => true,
        } as unknown as CountUi;
        expect(ctx.researchWaitingCount()).toBe(1);
    });

    it('in the state: only sent items are not "awaiting action"', () => {
        const s = (waiting: LiveWaiting[]) => ({ lostSince: null, ended: false, working: [], waiting });
        expect(liveState(s(mixed)).cls).toBe('is-waiting');
        expect(liveState(s(mixed.filter(w => w.phase === 'sent'))).cls).toBe('is-idle');
    });
});
