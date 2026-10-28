import { describe, it, expect, vi } from 'vitest';
import {
    experimentsOffReply, hideReply, hideRequestBody, historyReadReply, deleteReply, firstReply, skipReply, mapReply,
    storiesReply, placeReply, historyWriteRefusal, historyMapNote, HISTORY_MAP_NOTE_MAX,
    postBridgeFirst, postBridgePlace, postBridgeDelete, postBridgeMap, postBridgeExperimentsOff,
} from '../history-bridge.js';
import { researchSchemeUrl } from '../research-link.js';

const TREE = '0b6f5e1c-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const AT = '2026-10-27T20:00:00.000Z';

describe('history bridge replies', () => {
    it('reads a payload and refuses other statuses', () => {
        const ok = historyReadReply(200, JSON.stringify({ state: { on: true, search: 'done' }, events: {}, places: {}, hidden: [] }), AT, 'r1');
        expect(ok.ok).toBe(true);
        expect(historyReadReply(404, '{}', AT).ok).toBe(false);
        expect(historyReadReply(200, 'not json', AT)).toMatchObject({ ok: false, code: 'invalid' });
        expect(historyReadReply(200, '\u0000too-big', AT)).toMatchObject({ ok: false, code: 'too-big' });
    });

    it('builds hide bodies only with a place or a research REFN', () => {
        expect(hideRequestBody({ event: 'E1', place: 'L1', at: AT })).toEqual({ event: 'E1', place: 'L1' });
        expect(hideRequestBody({ event: 'E1', personRefn: 'P12', do: 'show', at: AT })).toEqual({ event: 'E1', person: 'P12', do: 'show' });
        expect(hideRequestBody({ event: 'E1', personId: 'x' as never, at: AT })).toBeNull();
        expect(hideRequestBody({ event: 'bad id!', place: 'L1', at: AT })).toBeNull();
    });

    it('types hide refusals', () => {
        expect(hideReply(200, { hidden: [], head: 'abcdef1', parent: '1234567' }, [])).toMatchObject({ ok: true, head: 'abcdef1' });
        expect(hideReply(404, { code: 'history.event' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(hideReply(400, { code: 'history.body' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(hideReply(503, { code: 'research.busy' }, [])).toMatchObject({ ok: false, code: 'busy' });
        expect(hideReply(500, {}, [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('offers only a link the app would build itself', () => {
        const off = researchSchemeUrl('experiment', { tree: TREE, experiment: 'history', experimentDo: 'off' })!;
        expect(off).toContain('name=history&do=off');
        expect(experimentsOffReply(403, { code: 'experiments.link', link: 'evil://x' }, [], TREE)).toMatchObject({ code: 'link', link: off });
        expect(experimentsOffReply(403, { code: 'experiments.link', link: off }, [], TREE)).toMatchObject({ code: 'link', link: off });
        expect(experimentsOffReply(200, { head: 'abcdef1' }, [], TREE)).toMatchObject({ ok: true, head: 'abcdef1' });
    });
});

describe('history manager writes (1028)', () => {
    const HEAD = { head: 'abcdef1', parent: '1234567' };

    it('builds region and tree hide bodies', () => {
        expect(hideRequestBody({ region: 'cz-bohemia', at: AT })).toEqual({ region: 'cz-bohemia' });
        expect(hideRequestBody({ region: 'cz-bohemia', do: 'show', at: AT })).toEqual({ region: 'cz-bohemia', do: 'show' });
        expect(hideRequestBody({ event: 'E1', tree: true, at: AT })).toEqual({ event: 'E1', tree: true });
        expect(hideRequestBody({ region: 'bad region!', at: AT })).toBeNull();
        expect(hideReply(404, { code: 'history.region' }, [])).toMatchObject({ ok: false, code: 'invalid' });
    });

    it('types the common refusals', () => {
        expect(deleteReply(404, { code: 'history.event' }, [])).toMatchObject({ ok: false, code: 'gone' });
        expect(deleteReply(400, { code: 'history.body' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(firstReply(409, { code: 'history.archive' }, [])).toMatchObject({ ok: false, code: 'archive' });
        expect(firstReply(409, { code: 'history.done' }, [])).toMatchObject({ ok: false, code: 'done' });
        expect(deleteReply(409, { code: 'history.retracted' }, [])).toMatchObject({ ok: false, code: 'retracted' });
        // R4: "first" of a region skipped for this tree.
        expect(firstReply(409, { code: 'history.skipped' }, [])).toMatchObject({ ok: false, code: 'skipped' });
        expect(skipReply(503, { code: 'research.busy' }, [])).toMatchObject({ ok: false, code: 'busy' });
        expect(mapReply(500, {}, [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('accepts only links the app builds itself', () => {
        const on = researchSchemeUrl('experiment', { tree: TREE, experiment: 'history', experimentDo: 'on' })!;
        const place = researchSchemeUrl('history', { tree: TREE, place: 'L0042', historyDo: 'search' })!;
        expect(storiesReply(409, { code: 'history.off', link: 'evil://x' }, [], { tree: TREE })).toMatchObject({ code: 'off', link: on });
        expect(placeReply(403, { code: 'history.link', link: place }, [], { tree: TREE, place: 'L0042' })).toMatchObject({ code: 'link', link: place });
        expect(placeReply(403, { code: 'history.link', link: 'https://x' }, [], { tree: TREE, place: 'L0042' })).toMatchObject({ code: 'link', link: place });
        expect(historyWriteRefusal(403, { code: 'history.link' }, [])).not.toHaveProperty('link');
    });

    it('parses successful replies', () => {
        expect(firstReply(200, { ...HEAD, region: 'cz-bohemia', first: [{ region: 'cz-bohemia', at: AT }, { region: 'bad id!' }] }, []))
            .toEqual({ ok: true, ...HEAD, region: 'cz-bohemia', first: [{ region: 'cz-bohemia', at: AT }] });
        expect(skipReply(200, { ...HEAD, skip: { regions: ['cz-moravia', 'cz-moravia', 7], places: ['Lhota', ''] } }, []))
            .toEqual({ ok: true, ...HEAD, skip: { regions: ['cz-moravia'], places: ['Lhota'] } });
        // R5: the place's regions now, by hand or not; null while it waits to be placed.
        expect(mapReply(200, { ...HEAD, place: 'Dolní Ves', map: { regions: [{ id: 'cz-bohemia', from: 1850, to: 1918 }, { id: 'bad id!' }], manual: true, at: AT } }, []))
            .toEqual({ ok: true, ...HEAD, place: 'Dolní Ves', map: { regions: [{ id: 'cz-bohemia', from: 1850, to: 1918 }], manual: true, at: AT } });
        expect(mapReply(200, { ...HEAD, place: 'Nová Lhota', map: null }, [])).toEqual({ ok: true, ...HEAD, place: 'Nová Lhota', map: null });
        expect(mapReply(200, { ...HEAD, place: 'Lhota', map: { regions: [{ id: 'cz-bohemia' }], at: 'not a time' } }, []))
            .toEqual({ ok: true, ...HEAD, place: 'Lhota', map: { regions: [{ id: 'cz-bohemia' }], manual: false } });
        expect(mapReply(200, 'x', [])).toMatchObject({ ok: false, code: 'unknown' });
        expect(deleteReply(200, HEAD, [])).toEqual({ ok: true, ...HEAD });
        // R4: {event, scope, deleted, head, parent}; a regional one has head == parent (no commit) and is still done.
        const same = { head: HEAD.head, parent: HEAD.head };
        expect(deleteReply(200, { event: 'cz-bohemia-0007', scope: 'region', deleted: [{ event: 'cz-bohemia-0007', scope: 'region', at: AT, from: 1866 }, { scope: 'x' }], ...same }, []))
            .toEqual({ ok: true, ...same, event: 'cz-bohemia-0007', scope: 'region', deleted: [{ event: 'cz-bohemia-0007', scope: 'region', at: AT, from: 1866 }] });
        expect(deleteReply(200, { event: 'L0003', scope: 'local', deleted: [], ...HEAD }, [])).toEqual({ ok: true, ...HEAD, event: 'L0003', scope: 'local', deleted: [] });
        expect(deleteReply(200, 'x', [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('cleans the note for the research', () => {
        expect(historyMapNote('  Lhota u Kolína� ')).toBe('Lhota u Kolína');
        expect(historyMapNote('é')).toBe('é');
        const long = '😀'.repeat(HISTORY_MAP_NOTE_MAX + 5);
        expect(Array.from(historyMapNote(long))).toHaveLength(HISTORY_MAP_NOTE_MAX);
    });

    it('refuses invalid write arguments without a request', async () => {
        expect(await postBridgeFirst('http://127.0.0.1:1/t', 'bad id!', [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postBridgePlace('http://127.0.0.1:1/t', 'Lhota', [], { tree: TREE })).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postBridgeDelete('http://127.0.0.1:1/t', { event: 'bad id!' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(await postBridgeMap('http://127.0.0.1:1/t', { place: 'Lhota', regions: [{ id: 'bad id!' }] }, [])).toMatchObject({ ok: false, code: 'invalid' });
    });
});

describe('the history of regions and of places apart (experiments.split, 1029)', () => {
    const link = (experiment: 'history' | 'regions' | 'placeHistory', d: 'on' | 'off') =>
        researchSchemeUrl('experiment', { tree: TREE, experiment, experimentDo: d })!;

    it('builds the links of both switches', () => {
        expect(link('regions', 'on')).toContain('name=regions&do=on');
        expect(link('placeHistory', 'on')).toContain('name=placeHistory&do=on');
        expect(researchSchemeUrl('experiment', { tree: TREE, experiment: 'places' as never, experimentDo: 'on' })).toBeNull();
    });

    it('switches one search off with its own key, and offers its own link', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ experiments: { regions: false }, head: 'abcdef1', parent: '1234567' }), { status: 200 });
        });
        try {
            expect(await postBridgeExperimentsOff('http://127.0.0.1:1/t', [], TREE, undefined, { which: 'regions' })).toMatchObject({ ok: true, head: 'abcdef1' });
            await postBridgeExperimentsOff('http://127.0.0.1:1/t', [], TREE, undefined, { which: 'places' });
            await postBridgeExperimentsOff('http://127.0.0.1:1/t', [], TREE);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(bodies).toEqual([{ regions: false }, { places: false }, { history: false }]);
        expect(experimentsOffReply(403, { code: 'experiments.link', link: 'evil://x' }, [], TREE, undefined, 'places'))
            .toMatchObject({ code: 'link', link: link('placeHistory', 'off') });
    });

    it('409 history.off of a place or a region keeps the research\'s link of that switch', () => {
        const places = link('placeHistory', 'on');
        const regions = link('regions', 'on');
        expect(placeReply(409, { code: 'history.off', link: places }, [], { tree: TREE, place: 'L0042' })).toMatchObject({ code: 'off', link: places });
        expect(firstReply(409, { code: 'history.off', params: { link: regions } }, [], { tree: TREE })).toMatchObject({ code: 'off', link: regions });
        // No link of its own (or a foreign one): the app's own for the switch it names, else both.
        expect(placeReply(409, { code: 'history.off' }, [], { tree: TREE, place: 'L0042', experiment: 'placeHistory' })).toMatchObject({ link: places });
        expect(firstReply(409, { code: 'history.off', link: 'evil://x' }, [], { tree: TREE, experiment: 'regions' })).toMatchObject({ link: regions });
        expect(firstReply(409, { code: 'history.off' }, [], { tree: TREE })).toMatchObject({ link: link('history', 'on') });
    });
});
