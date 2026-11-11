/**
 * Splitting older locations through the research's bridge (spec 075 §5,
 * `sources.split`): the replies of `GET /sources/split`, `POST
 * /sources/split` and its undo typed as the research answers them
 * (core/live.ts of Strom Research), and the research's version compared
 * apart from the sources' places. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { bridgeSplitApplyReply, bridgeSplitReadReply, bridgeSplitUndoReply, parseBridgeSplit } from '../source-split-bridge.js';
import { withSourcePlaces } from '../source-split.js';
import type { Source } from '../types.js';

const row = (i: number) => ({
    source: `S000${i}`, title: `Matrika N ${i} Vzorov`,
    before: { locator: `fol. 1${i}v, snímek 3${i}` }, after: { folio: `fol. 1${i}v`, image: `3${i}` },
});
const preview = (n: number, shown = Math.min(n, 10)) => ({
    split: Array.from({ length: shown }, (_, i) => row(i + 1)), count: n, unrecognized: 2, nothing: 1,
    undos: [{ id: '20261111101500-a1b2c3', at: '2026-11-11T10:15:00.000Z', sources: 4 }], plan: '0123456789abcdef',
});

describe('the preview (GET /sources/split)', () => {
    it('reads the rows with the locator as the other location, the count apart from the rows, the newest undo', () => {
        const r = bridgeSplitReadReply(200, preview(12), false);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const { preview: p, undo } = r.reading;
        expect(p.rows).toHaveLength(10);
        expect(p.rows[0]).toEqual({ source: 'S0001', title: 'Matrika N 1 Vzorov', before: { reference: 'fol. 11v, snímek 31' }, after: { folio: 'fol. 11v', image: '31' } });
        expect(p.count).toBe(12);
        expect(p.complete).toBe(false);
        expect(p.unrecognized).toBe(2);
        expect(p.unrecognizedExamples).toEqual([]);
        expect(p.fromNote).toBe(0);
        expect(p.plan).toBe('0123456789abcdef');
        expect(undo).toEqual({ id: '20261111101500-a1b2c3', at: Date.parse('2026-11-11T10:15:00.000Z'), count: 4 });
    });

    it('is complete with ?all=1 or when every row came', () => {
        const all = bridgeSplitReadReply(200, preview(12, 12), true);
        expect(all.ok && all.reading.preview.complete).toBe(true);
        const few = bridgeSplitReadReply(200, preview(3), false);
        expect(few.ok && few.reading.preview.complete).toBe(true);
    });

    it('says an archive, a busy research and a reply it does not read', () => {
        expect(bridgeSplitReadReply(409, { error: 'x', code: 'source.split.archive' }, false)).toMatchObject({ ok: false, code: 'archive' });
        expect(bridgeSplitReadReply(503, { error: 'x', code: 'research.busy' }, false)).toMatchObject({ ok: false, code: 'busy' });
        expect(bridgeSplitReadReply(200, { nothing: 1 }, false)).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('keeps no undo it cannot give back', () => {
        expect(parseBridgeSplit({ ...preview(1), undos: [{ id: 'bad', at: 'x', sources: 1 }] }, false)?.undo).toBeNull();
        expect(parseBridgeSplit({ ...preview(1), undos: [] }, false)?.undo).toBeNull();
    });
});

describe('the split (POST /sources/split)', () => {
    it('reads what was done, its undo and the heads', () => {
        expect(bridgeSplitApplyReply(200, { done: { split: 8 }, undo: '20261111101500-a1b2c3', head: 'c0ffee000001', parent: '3f2a9c1e5b7d' }))
            .toEqual({ ok: true, count: 8, undo: '20261111101500-a1b2c3', head: 'c0ffee000001', parent: '3f2a9c1e5b7d' });
        expect(bridgeSplitApplyReply(200, { done: { split: 0 }, head: '3f2a9c1e5b7d', parent: '3f2a9c1e5b7d' }))
            .toEqual({ ok: true, count: 0, head: '3f2a9c1e5b7d', parent: '3f2a9c1e5b7d' });
    });

    it('gives the preview as it is now on another plan, and says busy and an archive', () => {
        const r = bridgeSplitApplyReply(409, { error: 'x', code: 'source.split.plan', preview: { ...preview(9), plan: 'fedcba9876543210' } });
        expect(r.ok).toBe(false);
        if (r.ok || r.code !== 'plan') throw new Error('not a plan refusal');
        expect(r.reading?.preview.count).toBe(9);
        expect(r.reading?.preview.plan).toBe('fedcba9876543210');
        expect(bridgeSplitApplyReply(503, { error: 'x', code: 'research.busy' })).toMatchObject({ ok: false, code: 'busy' });
        expect(bridgeSplitApplyReply(409, { error: 'x', code: 'source.split.archive' })).toMatchObject({ ok: false, code: 'archive' });
        expect(bridgeSplitApplyReply(400, { error: 'x', code: 'source.split.body' })).toMatchObject({ ok: false, code: 'unknown' });
    });
});

describe('its undo (POST /sources/split/undo)', () => {
    it('reads what was restored', () => {
        expect(bridgeSplitUndoReply(200, { undone: { restored: 8 }, head: 'c0ffee000002', parent: 'c0ffee000001' }))
            .toEqual({ ok: true, restored: 8, head: 'c0ffee000002', parent: 'c0ffee000001' });
    });

    it('names the sources changed since (count and titles), a split gone and busy', () => {
        const r = bridgeSplitUndoReply(409, { error: 'x', code: 'source.split.changed', count: 4,
            sources: [{ id: 'S0001', title: 'Matrika N 1 Vzorov' }, { id: 'S0002', title: 'Matrika N 2 Vzorov' }, { id: 'S0003' }] });
        expect(r).toEqual({ ok: false, code: 'changed', status: 409, count: 4, titles: ['Matrika N 1 Vzorov', 'Matrika N 2 Vzorov', 'S0003'] });
        expect(bridgeSplitUndoReply(404, { error: 'x', code: 'source.split.undo' })).toMatchObject({ ok: false, code: 'gone' });
        expect(bridgeSplitUndoReply(503, { error: 'x', code: 'research.busy' })).toMatchObject({ ok: false, code: 'busy' });
    });
});

describe('withSourcePlaces', () => {
    it('takes the places of the other side and nothing else', () => {
        const here = { sources: {
            a: { id: 'a', title: 'Matrika N 7 Vzorov', reference: 'fol. 12v, snímek 34', note: 'n' } as Source,
            b: { id: 'b', title: 'Kniha zápisů Pokusov', reference: 'zápis 3' } as Source,
        } };
        const there = { sources: { a: { id: 'a', title: 'Jiný název', folio: 'fol. 12v', image: '34' } as Source } };
        const out = withSourcePlaces(here, there);
        expect(out.sources.a).toEqual({ id: 'a', title: 'Matrika N 7 Vzorov', folio: 'fol. 12v', image: '34', note: 'n' });
        expect(out.sources.b).toBe(here.sources.b);
        expect(here.sources.a.reference).toBe('fol. 12v, snímek 34');
    });
});
