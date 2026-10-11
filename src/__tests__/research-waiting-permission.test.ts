/**
 * An archive's question in the research's waiting list (kind "permission"):
 * the item keeps its host and whole terms, its id is made of the host, and
 * "Answer ↗" opens that question in the research (an older research: the
 * research itself). Invented archives.
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { LiveWaiting, ResearchLinkAction, researchSchemeUrl, sanitizeLiveStatus, sanitizeWaiting } from '../research-link.js';
import { noteResearchWaiting, storedResearchWaiting } from '../research-device.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const TERMS = 'Podmínky podle stahovače: Snímky jen jednotlivě, standardními prostředky prohlížeče. '
    + 'Hromadné stahování není dovoleno, každý snímek se otevírá zvlášť a ukládá ručně. '.repeat(3)
    + '(https://archive.example.org/terms)';

const permission = (host: unknown, extra: Record<string, unknown> = {}) => ({
    kind: 'permission', id: `permission:${String(host)}`, what: 'Stahování snímků z archivu Testovací archiv', on: TERMS,
    at: '2026-10-11T10:00:00Z', host, title: 'Testovací archiv', terms: 'https://archive.example.org/terms',
    tasks: ['T0001', 'T0002'], choices: ['slow', 'manual'], ...extra,
});

describe('the waiting item of an archive', () => {
    it('keeps the kind, the host and the whole terms', () => {
        expect(TERMS.length).toBeGreaterThan(120);
        const [w] = sanitizeWaiting([permission('archive.example.org')]);
        expect(w).toEqual({
            id: 'permission:archive.example.org', what: 'Stahování snímků z archivu Testovací archiv', on: TERMS,
            at: '2026-10-11T10:00:00Z', kind: 'permission', host: 'archive.example.org',
        });
    });

    it('lowercases the host', () => {
        const [w] = sanitizeWaiting([permission('Archive.Example.ORG')]);
        expect(w.host).toBe('archive.example.org');
        expect(w.id).toBe('permission:archive.example.org');
    });

    it('stays a plain item without a valid host', () => {
        for (const host of ['https://archive.example.org', 'archive.example.org/terms', 'archive.example.org:8080',
            'archive example.org', '-archive.example.org', 'archive..example.org', '', 42, undefined, `${'a'.repeat(60)}.`.repeat(5) + 'org']) {
            const [w] = sanitizeWaiting([permission(host)]);
            expect(w.kind).toBeUndefined();
            expect(w.host).toBeUndefined();
            expect(w.on.length).toBeLessThanOrEqual(120);
            expect(w.id.length).toBeLessThanOrEqual(40);
        }
    });

    it('never gives two long hosts one id', () => {
        const label = 'a'.repeat(60);
        const one = `${label}.${label}.${label}.digitalni-archiv-jedna.example.org`;
        const two = `${label}.${label}.${label}.digitalni-archiv-dva.example.org`;
        const [a, b] = sanitizeWaiting([permission(one), permission(two)]);
        expect(a.id).toBe(`permission:${one}`);
        expect(b.id).toBe(`permission:${two}`);
        expect(a.id).not.toBe(b.id);
    });

    it('leaves a story, a plain task and a takeover as they were', () => {
        expect(sanitizeWaiting([
            { id: 'P0001', kind: 'story', what: 'Nová verze vyprávění', person: 'P0001', host: 'archive.example.org', on: TERMS },
            { id: 'T0003', what: 'Úkol', on: TERMS, person: 'P0002', host: 'archive.example.org' },
            { kind: 'takeover', id: 'takeover', what: 'Převzít stahovače', on: '', at: '2026-10-11T10:00:00Z', connectors: ['a'] },
        ])).toEqual([
            { id: 'P0001', what: 'Nová verze vyprávění', on: TERMS.slice(0, 119) + '…', at: '', person: 'P0001', kind: 'story' },
            { id: 'T0003', what: 'Úkol', on: TERMS.slice(0, 119) + '…', at: '', person: 'P0002' },
            { id: 'takeover', what: 'Převzít stahovače', on: '', at: '2026-10-11T10:00:00Z' },
        ]);
    });
});

describe('the remembered list', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps what answers an archive\'s question there', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
        noteResearchWaiting(TREE, sanitizeWaiting([permission('archive.example.org'), { id: 'T0003', what: 'Úkol', on: 'user' }]));
        const items = storedResearchWaiting(TREE)?.items;
        expect(items?.[0]).toEqual({
            id: 'permission:archive.example.org', what: 'Stahování snímků z archivu Testovací archiv', on: TERMS,
            at: '2026-10-11T10:00:00Z', kind: 'permission', host: 'archive.example.org',
        });
        expect(items?.[1]).toEqual({ id: 'T0003', what: 'Úkol', on: '', at: '' });
    });
});

describe('the archive link', () => {
    it('is a known action and names the host', () => {
        expect(sanitizeLiveStatus({ treeId: TREE, links: ['open', 'archive'] })?.links).toEqual(['open', 'archive']);
        expect(researchSchemeUrl('archive', { tree: TREE, host: 'archive.example.org' }))
            .toBe(`strom-research://archive?tree=${TREE}&host=archive.example.org`);
    });

    it('refuses a bad host or none', () => {
        expect(researchSchemeUrl('archive', { tree: TREE, host: 'archive.example.org/x?y=1' })).toBeNull();
        expect(researchSchemeUrl('archive', { tree: TREE })).toBeNull();
    });
});

type AnswerUi = {
    answerResearchTask(w: LiveWaiting): void;
    canAnswerResearchWaiting(w: LiveWaiting): boolean;
};

describe('"Answer ↗" at an archive\'s question', () => {
    let methods: Record<string, unknown>;
    beforeAll(async () => {
        ({ researchUiMethods: methods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> });
    }, 60000);

    function ui(announced: ResearchLinkAction[]): { ui: AnswerUi; opened: string[] } {
        const opened: string[] = [];
        const ctx = {
            ...methods,
            researchLinkAvailable: (a: ResearchLinkAction) => announced.includes(a),
            activeResearchId: () => TREE,
            launchResearchLink: (url: string) => { opened.push(url); },
        };
        return { ui: ctx as unknown as AnswerUi, opened };
    }
    const [archive] = sanitizeWaiting([permission('archive.example.org')]);
    const [takeover] = sanitizeWaiting([{ kind: 'takeover', id: 'takeover', what: 'Převzít stahovače', on: '', connectors: [] }]);

    it('opens that archive\'s question in the research', () => {
        const { ui: u, opened } = ui(['open', 'task', 'archive']);
        u.answerResearchTask(archive);
        expect(opened).toEqual([`strom-research://archive?tree=${TREE}&host=archive.example.org`]);
    });

    it('opens the research when it does not take archive links', () => {
        const { ui: u, opened } = ui(['open', 'task']);
        u.answerResearchTask(archive);
        expect(opened).toEqual([`strom-research://open?tree=${TREE}`]);
    });

    it('opens the research for a takeover', () => {
        const { ui: u, opened } = ui(['open', 'task', 'archive']);
        u.answerResearchTask(takeover);
        expect(opened).toEqual([`strom-research://open?tree=${TREE}`]);
    });

    it('is offered when the archive link or the open link is there', () => {
        expect(ui(['archive']).ui.canAnswerResearchWaiting(archive)).toBe(true);
        expect(ui(['open']).ui.canAnswerResearchWaiting(archive)).toBe(true);
        expect(ui(['task']).ui.canAnswerResearchWaiting(archive)).toBe(false);
        expect(ui(['task']).ui.canAnswerResearchWaiting(takeover)).toBe(true);
        expect(ui(['archive']).ui.canAnswerResearchWaiting(takeover)).toBe(false);
    });
});
