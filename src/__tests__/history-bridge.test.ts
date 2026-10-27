import { describe, it, expect } from 'vitest';
import { experimentsOffReply, hideReply, hideRequestBody, historyReadReply } from '../history-bridge.js';
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
