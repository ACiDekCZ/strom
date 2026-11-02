import { describe, it, expect, vi } from 'vitest';
import {
    getHistoryAlign, historyAlignPreviewReply, historyAlignReply, historyAlignUndoReply, historyKindsLink, historyKindsReply,
    historyKindsValue, postHistoryAlign, postHistoryAlignUndo, postHistoryKinds,
} from '../history-bridge.js';
import {
    alignBackfillCounts, alignHideCount, parseHistoryAlignPreview, parseHistoryKindList, parseHistoryPayload, parseKindsFill,
    type HistoryKind,
} from '../history.js';
import {
    HISTORY_ALIGN_FEATURE, HISTORY_KINDS_FEATURE, historyKindsLinkValue, researchSchemeUrl, sanitizeLiveStatus,
} from '../research-link.js';

const TREE = '0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const ALL: HistoryKind[] = ['war', 'epidemic', 'census', 'state', 'emigration', 'law', 'economy', 'disaster', 'other'];
const PREVIEW = {
    kinds: ['war', 'epidemic', 'census', 'state', 'emigration', 'disaster', 'other'], plan: '9fe746d33f6665ac',
    hide: { general: { n: 2, kinds: { law: 1, economy: 1 } }, local: { n: 1, kinds: { law: 1, nonsense: 4 } } },
    show: { n: 0, kinds: {} },
    backfill: [
        { region: 'cz-lhota', label: 'Lhotsko', kinds: ['law', 'magic'], years: ['1800–1925'] },
        { place: 'L0012', label: 'Dolní Ves', kinds: ['law'] },
        { region: 'bad id!', label: 'x', kinds: ['law'] },
    ],
    sessions: 3, pace: 'sometimes',
    busy: [{ id: 'N0001', label: 'Session' }],
    shared: { n: 2, kinds: { law: 1, economy: 1 } },
};
const OK_HEADS = { head: 'abcdef1', parent: '1234567' };

describe('kinds of events in the status (spec 035)', () => {
    it('reads kinds, kindsOwn and kindsDefault only with history.kinds; unknown kinds dropped, kind order', () => {
        const raw = {
            tree: TREE,
            features: ['experiments', HISTORY_KINDS_FEATURE],
            experiments: { history: true, kinds: ['other', 'war', 'magic', 'war', 7], kindsOwn: true, kindsDefault: ALL },
        };
        const st = sanitizeLiveStatus(raw)!;
        expect(st.experiments).toEqual({ history: true, kinds: ['war', 'other'], kindsOwn: true, kindsDefault: ALL });
        const without = sanitizeLiveStatus({ ...raw, features: ['experiments'] })!;
        expect(without.experiments).toEqual({ history: true });
        const none = sanitizeLiveStatus({ ...raw, experiments: { history: false, kinds: [], kindsOwn: 'yes', kindsDefault: 'all' } })!;
        expect(none.experiments).toEqual({ history: false, kinds: [] });
    });

    it('parses a list of kinds', () => {
        expect(parseHistoryKindList(['law', 'war', 'x'])).toEqual(['war', 'law']);
        expect(parseHistoryKindList('war')).toBeNull();
        expect(HISTORY_ALIGN_FEATURE).toBe('history.align');
    });
});

describe('the history-kinds and history-align links', () => {
    it('builds only fixed values', () => {
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kindsScope: 'tree', kinds: 'war,law' }))
            .toBe(`strom-research://history-kinds?tree=${TREE}&scope=tree&kinds=war,law`);
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kindsScope: 'default', kinds: 'all,-law' }))
            .toBe(`strom-research://history-kinds?tree=${TREE}&scope=default&kinds=all,-law`);
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kindsScope: 'tree', inherit: true }))
            .toBe(`strom-research://history-kinds?tree=${TREE}&scope=tree&inherit=1`);
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kindsScope: 'default', inherit: true })).toBeNull();
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kindsScope: 'tree', kinds: 'war,magic' })).toBeNull();
        expect(researchSchemeUrl('history-kinds', { tree: TREE, kinds: 'war' })).toBeNull();
        expect(researchSchemeUrl('history-align', { tree: TREE })).toBe(`strom-research://history-align?tree=${TREE}`);
        expect(researchSchemeUrl('history-align', { tree: TREE, prune: true })).toBe(`strom-research://history-align?tree=${TREE}&prune=1`);
        expect(historyKindsLinkValue('all,-law,-economy')).toBe('all,-law,-economy');
        expect(historyKindsLinkValue('all,law')).toBeNull();
        expect(historyKindsLinkValue('war,war')).toBeNull();
        expect(historyKindsLinkValue('none')).toBe('none');
    });

    it('writes the value as all / none / kinds', () => {
        expect(historyKindsValue(ALL)).toBe('all');
        expect(historyKindsValue([])).toBe('none');
        expect(historyKindsValue(['law', 'war'])).toBe('war,law');
        expect(historyKindsLink({ kinds: ['law'], scope: 'default' }, TREE)).toContain('scope=default&kinds=law');
    });
});

describe('POST /history/kinds', () => {
    const check = { tree: TREE };
    it('200: the state after the write and whether an alignment is suggested', () => {
        const r = historyKindsReply(200, { experiments: { kinds: ['war'], kindsOwn: true, kindsDefault: ALL }, alignSuggested: true, ...OK_HEADS },
            [], { kinds: ['war'], scope: 'tree' }, check);
        expect(r).toEqual({ ok: true, ...OK_HEADS, state: { kinds: ['war'], kindsOwn: true, kindsDefault: ALL }, alignSuggested: true });
    });

    it('403 link: the research\'s own link when the app would build it (any value shape), else the app\'s', () => {
        const said = `strom-research://history-kinds?tree=${TREE}&scope=tree&kinds=all,-economy`;
        expect(historyKindsReply(403, { code: 'history.kinds.link', link: said, added: ['law', 'nope'], error: 'Přidat lze jen v terminálu.' },
            [], { kinds: ALL.filter(k => k !== 'economy'), scope: 'tree' }, check))
            .toMatchObject({ ok: false, code: 'link', link: said, added: ['law'], reason: 'Přidat lze jen v terminálu.' });
        const evil = historyKindsReply(403, { code: 'history.kinds.link', link: 'javascript:alert(1)' }, [], { kinds: ['war', 'law'], scope: 'tree' }, check);
        expect(evil).toMatchObject({ code: 'link', link: `strom-research://history-kinds?tree=${TREE}&scope=tree&kinds=war,law` });
        const foreign = historyKindsReply(403, { code: 'history.kinds.link', link: `strom-research://history-kinds?tree=other&scope=tree&kinds=war` },
            [], { scope: 'tree', inherit: true }, check);
        expect(foreign).toMatchObject({ code: 'link', link: `strom-research://history-kinds?tree=${TREE}&scope=tree&inherit=1` });
    });

    it('maps the errors', () => {
        const sent = { kinds: ['war'] as HistoryKind[], scope: 'tree' as const };
        expect(historyKindsReply(503, { code: 'research.busy' }, [], sent, check)).toMatchObject({ code: 'busy' });
        expect(historyKindsReply(500, { code: 'history.kinds.failed' }, [], sent, check)).toMatchObject({ code: 'failed' });
        expect(historyKindsReply(400, { code: 'history.kinds.body' }, [], sent, check)).toMatchObject({ code: 'invalid' });
        expect(historyKindsReply(409, { code: 'history.archive', error: 'Archiv.' }, [], sent, check)).toMatchObject({ code: 'archive', reason: 'Archiv.' });
        expect(historyKindsReply(418, {}, [], sent, check)).toMatchObject({ code: 'unknown' });
    });

    it('sends the kinds in kind order, or inherit', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ experiments: { kinds: ['war'], kindsOwn: true, kindsDefault: ALL }, alignSuggested: false, ...OK_HEADS }), { status: 200 });
        });
        try {
            expect(await postHistoryKinds('http://127.0.0.1:1/t', { kinds: ['law', 'war'], scope: 'default' }, [], check)).toMatchObject({ ok: true });
            await postHistoryKinds('http://127.0.0.1:1/t', { scope: 'tree', inherit: true }, [], check);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(bodies).toEqual([{ kinds: ['war', 'law'], scope: 'default' }, { scope: 'tree', inherit: true }]);
    });
});

describe('the alignment preview', () => {
    it('keeps what the app reads; drops unknown kinds and invalid places', () => {
        const p = parseHistoryAlignPreview(PREVIEW)!;
        expect(p.plan).toBe('9fe746d33f6665ac');
        expect(p.hide.local.kinds).toEqual({ law: 1 });
        expect(p.backfill).toEqual([
            { region: 'cz-lhota', label: 'Lhotsko', kinds: ['law'], years: ['1800–1925'] },
            { place: 'L0012', label: 'Dolní Ves', kinds: ['law'] },
        ]);
        expect(p.pace).toBe('sometimes');
        expect(alignHideCount(p)).toBe(3);
        expect(alignBackfillCounts(p)).toEqual({ regions: 1, places: 1 });
        expect(parseHistoryAlignPreview({ ...PREVIEW, plan: 'XYZ' })).toBeNull();
        expect(parseHistoryAlignPreview(null)).toBeNull();
    });

    it('reads GET /history/align with and without kinds', async () => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => {
            urls.push(url);
            return new Response(JSON.stringify(PREVIEW), { status: 200 });
        });
        try {
            expect(await getHistoryAlign('http://127.0.0.1:1/t')).toMatchObject({ ok: true });
            await getHistoryAlign('http://127.0.0.1:1/t', ['law', 'war']);
            await getHistoryAlign('http://127.0.0.1:1/t', []);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(new URL(urls[0]).searchParams.get('kinds')).toBeNull();
        expect(new URL(urls[1]).searchParams.get('kinds')).toBe('war,law');
        expect(new URL(urls[2]).searchParams.get('kinds')).toBe('none');
        expect(historyAlignPreviewReply(503, { code: 'research.busy' })).toMatchObject({ ok: false, code: 'busy' });
        expect(historyAlignPreviewReply(409, { code: 'history.archive' })).toMatchObject({ ok: false, code: 'archive' });
        expect(historyAlignPreviewReply(200, { plan: 'bad' })).toMatchObject({ ok: false, code: 'unknown' });
    });
});

describe('POST /history/align and its undo', () => {
    const check = { tree: TREE };
    const own = `strom-research://history-align?tree=${TREE}`;
    it('200 with the undo id and the backfill link (the app\'s own)', () => {
        const r = historyAlignReply(200, {
            done: { hidden: 2, shown: 1, tasks: 0 }, undo: '20261102125010-a1b2c3',
            backfill: { code: 'history.align.link', link: `${own}&prune=1`, n: 2, sessions: 3, pace: 'rare' }, ...OK_HEADS,
        }, [], check);
        expect(r).toEqual({
            ok: true, ...OK_HEADS, done: { hidden: 2, shown: 1 }, undo: '20261102125010-a1b2c3',
            backfill: { link: own, n: 2, sessions: 3, pace: 'rare' },
        });
        expect(historyAlignReply(200, { done: { hidden: 0, shown: 0, tasks: 0 }, ...OK_HEADS }, [], check))
            .toEqual({ ok: true, ...OK_HEADS, done: { hidden: 0, shown: 0 } });
    });

    it('403 link, 409 changed with the preview, 503, 500', () => {
        expect(historyAlignReply(403, { code: 'history.align.link', link: own, backfill: { n: 1 } }, [], check)).toMatchObject({ code: 'link', link: own });
        expect(historyAlignReply(403, { code: 'history.align.link', link: 'evil://x' }, [], check)).toMatchObject({ code: 'link', link: own });
        const changed = historyAlignReply(409, { code: 'history.align.changed', preview: PREVIEW }, [], check);
        expect(changed).toMatchObject({ code: 'changed', preview: { plan: '9fe746d33f6665ac' } });
        expect(historyAlignReply(503, { code: 'research.busy' }, [], check)).toMatchObject({ code: 'busy' });
        expect(historyAlignReply(500, { code: 'history.align.failed' }, [], check)).toMatchObject({ code: 'failed' });
        expect(historyAlignReply(409, { code: 'history.archive' }, [], check)).toMatchObject({ code: 'archive' });
    });

    it('sends the plan with what was asked; refuses a bad plan without a request', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ undone: { shown: 2, hidden: 0 }, done: { hidden: 2, shown: 0 }, ...OK_HEADS }), { status: 200 });
        });
        try {
            expect(await postHistoryAlign('http://127.0.0.1:1/t', 'bad', { hide: true }, [], check)).toMatchObject({ code: 'invalid' });
            expect(await postHistoryAlign('http://127.0.0.1:1/t', '9fe746d33f6665ac', {}, [], check)).toMatchObject({ code: 'invalid' });
            await postHistoryAlign('http://127.0.0.1:1/t', '9fe746d33f6665ac', { hide: true, backfill: true }, [], check);
            expect(await postHistoryAlignUndo('http://127.0.0.1:1/t', '20261102125010-a1b2c3', [])).toMatchObject({ ok: true, undone: { shown: 2, hidden: 0 } });
        } finally {
            vi.unstubAllGlobals();
        }
        expect(bodies).toEqual([{ plan: '9fe746d33f6665ac', hide: true, backfill: true }, { undo: '20261102125010-a1b2c3' }]);
    });

    it('undo errors', () => {
        expect(historyAlignUndoReply(404, { code: 'history.align.undo' }, [])).toMatchObject({ code: 'gone' });
        expect(historyAlignUndoReply(409, { code: 'history.align.undone' }, [])).toMatchObject({ code: 'undone' });
        expect(historyAlignUndoReply(400, { code: 'history.align.body' }, [])).toMatchObject({ code: 'invalid' });
    });
});

describe('GET /history: kindsFill and hidings by an alignment', () => {
    it('reads kindsFill of regions and places', () => {
        expect(parseKindsFill({ kinds: ['law', 'x'], state: 'queued' })).toEqual({ kinds: ['law'], state: 'queued' });
        expect(parseKindsFill({ kinds: ['law'], state: 'done' })).toBeUndefined();
        expect(parseKindsFill({ kinds: [], state: 'running' })).toBeUndefined();
        const p = parseHistoryPayload({
            state: { on: true, search: 'done' }, events: [],
            places: { Lhota: { events: [], kindsFill: { kinds: ['law'], state: 'running' } } },
            regions: { 'cz-lhota': { state: 'done', kindsFill: { kinds: ['economy'], state: 'queued' } } },
            hidden: [
                { event: 'e1', tree: true, by: 'align', align: '20261102125010-a1b2c3' },
                { event: 'e2', by: 'align', align: 'bad id!' },
                { event: 'e3', tree: true },
            ],
        }, '2026-11-02T10:00:00Z')!;
        expect(p.places.Lhota.kindsFill).toEqual({ kinds: ['law'], state: 'running' });
        expect(p.regions?.['cz-lhota']?.kindsFill).toEqual({ kinds: ['economy'], state: 'queued' });
        expect(p.hidden).toEqual([
            { event: 'e1', tree: true, by: 'align', align: '20261102125010-a1b2c3' },
            { event: 'e2', tree: true, by: 'align' },
            { event: 'e3', tree: true },
        ]);
    });
});
