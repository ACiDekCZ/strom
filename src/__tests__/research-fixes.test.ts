import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    parseFixesReply, fixRows, availableFixCount, fixesEmpty, fixText, fetchResearchFixes, type FixesReply,
} from '../research-fixes';
import { getStringsForLang } from '../strings';

/** A fictional research's reply (the shape of ZADANI_VYZKUM §1). */
const RAW = {
    rev: '8c1e2f0-3a91',
    fixes: [
        { id: 'blind-reduced', title: { cs: 'Čtení ze zmenšeného snímku', en: 'Readings from a reduced image', de: 'Lesungen aus einem verkleinerten Bild' },
            summary: { cs: 'Čte se znovu.', en: 'Read again.', de: 'Neu lesen.' },
            unit: 'reading', count: 12, state: 'pending', undoable: false, cost: 'medium', since: '1.19.0', paid: true },
        { id: 'new-model', title: { en: 'Earlier readings by another model' }, summary: { en: '…' },
            unit: 'reading', count: 0, state: 'declined', undoable: false, at: '2026-10-20T09:12:44.000Z', since: '1.20.0', paid: true },
        { id: 'participant-names', title: { en: 'Names of godparents' }, summary: { en: '…' },
            unit: 'participant', count: 0, state: 'fixed', undoable: true, applied: 3, at: '2026-10-28T15:40:02.000Z', since: '1.21.0', paid: false },
        { id: 'app-shapes', title: { en: 'Periods and ages' }, summary: { en: '…' },
            unit: 'finding', count: 0, state: 'nothing', undoable: false, since: '1.22.0', paid: false },
        { id: 'street-places', title: { en: 'Streets in places' }, summary: { en: '…' },
            unit: 'fact', count: 14, left: 1, state: 'pending', undoable: false, since: '1.24.0', paid: false },
        { id: 'old-undo', title: { en: 'An undone fix' }, summary: { en: '…' },
            unit: 'place', count: 0, state: 'declined', undone: true, undoable: false, at: '2026-10-29T08:00:00.000Z', paid: false },
        { id: 'early-fixed', title: { en: 'Fixed long ago' }, summary: { en: '…' },
            unit: 'brick', count: 0, state: 'fixed', undoable: false, at: '2026-09-01T08:00:00.000Z', paid: false },
    ],
};

function reply(): FixesReply {
    return parseFixesReply(RAW)!;
}

describe('tree fixes of the research (§7)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the reply; an unknown unit is an item; a fix the app cannot read is left out', () => {
        const r = parseFixesReply({ ...RAW, fixes: [...RAW.fixes, { id: 'Bad Id', title: { en: 'x' }, state: 'pending' },
            { id: 'no-state', title: { en: 'x' } }, { id: 'no-title', state: 'pending' }, { id: 'street-places', title: { en: 'dup' }, state: 'pending' }] })!;
        expect(r.rev).toBe('8c1e2f0-3a91');
        expect(r.fixes.map(f => f.id)).toEqual(['blind-reduced', 'new-model', 'participant-names', 'app-shapes', 'street-places', 'old-undo', 'early-fixed']);
        expect(r.fixes.find(f => f.id === 'early-fixed')!.unit).toBe('item');
        expect(r.fixes.find(f => f.id === 'blind-reduced')!.paid).toBe(true);
        expect(parseFixesReply({ rev: 'x' })).toBeNull();
        expect(parseFixesReply(null)).toBeNull();
    });

    it('maps the research states: pending → Open, fixed+undoable → Undo, fixed → none, undone / left → Open, nothing hidden', () => {
        const rows = fixRows(reply());
        const by = Object.fromEntries(rows.map(r => [r.fix.id, r]));
        expect(by['blind-reduced']).toMatchObject({ view: 'available', action: 'open' });
        expect(by['street-places']).toMatchObject({ view: 'available', action: 'open' });
        expect(by['participant-names']).toMatchObject({ view: 'applied', action: 'undo' });
        expect(by['early-fixed']).toMatchObject({ view: 'applied', action: null });
        expect(by['old-undo']).toMatchObject({ view: 'undone', action: 'open' });
        expect(by['new-model']).toMatchObject({ view: 'declined', action: 'open' });
        expect(by['app-shapes']).toBeUndefined();
    });

    it('sorts: available, opened, applied newest first, then undone and left as they are newest first', () => {
        expect(fixRows(reply()).map(r => r.fix.id))
            .toEqual(['blind-reduced', 'street-places', 'participant-names', 'early-fixed', 'old-undo', 'new-model']);
        // Opened from here in this session: after the available ones, no action until the research says more.
        const rows = fixRows(reply(), new Set(['blind-reduced', 'participant-names', 'new-model', 'early-fixed']));
        expect(rows.map(r => `${r.fix.id}:${r.view}`)).toEqual([
            'street-places:available', 'blind-reduced:opened', 'new-model:opened', 'participant-names:opened', 'early-fixed:applied', 'old-undo:undone',
        ]);
        expect(rows.find(r => r.fix.id === 'blind-reduced')!.action).toBeNull();
    });

    it('counts the available fixes; empty without pending and without an undoable applied one', () => {
        expect(availableFixCount(reply())).toBe(2);
        expect(fixesEmpty(reply())).toBe(false);
        const onlyUndo = parseFixesReply({ fixes: RAW.fixes.filter(f => f.state !== 'pending') })!;
        expect(availableFixCount(onlyUndo)).toBe(0);
        expect(fixesEmpty(onlyUndo)).toBe(false);
        const none = parseFixesReply({ fixes: RAW.fixes.filter(f => f.state !== 'pending' && !(f.state === 'fixed' && f.undoable)) })!;
        expect(fixesEmpty(none)).toBe(true);
        expect(fixesEmpty(null)).toBe(true);
    });

    it('a text in the language of the app, else another', () => {
        const fix = reply().fixes[0];
        expect(fixText(fix.title, 'de')).toBe('Lesungen aus einem verkleinerten Bild');
        expect(fixText(reply().fixes[1].title, 'cs')).toBe('Earlier readings by another model');
    });

    it('the count names its unit with the right plural (cs 1 / 2–4 / 5+)', () => {
        const cs = getStringsForLang('cs').research.fixes;
        expect(cs.count('place', 1)).toBe('1 místo');
        expect(cs.count('place', 3)).toBe('3 místa');
        expect(cs.count('fact', 14)).toBe('14 údajů');
        expect(cs.count('brick', 14)).toBe('14 položek');
        expect(getStringsForLang('en').research.fixes.count('reading', 12)).toBe('12 readings');
        expect(getStringsForLang('de').research.fixes.count('participant', 1)).toBe('1 Beteiligter');
    });

    it('asks a busy research once more after its Retry-After; an older bridge is missing', async () => {
        const calls: string[] = [];
        let n = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            calls.push(url);
            n++;
            return n === 1
                ? new Response(JSON.stringify({ code: 'research.busy' }), { status: 503, headers: { 'Retry-After': '5' } })
                : new Response(JSON.stringify(RAW), { status: 200 });
        }));
        const waits: number[] = [];
        const res = await fetchResearchFixes('http://127.0.0.1:7000/abc', { wait: async (ms) => { waits.push(ms); } });
        expect(res.ok).toBe(true);
        expect(waits).toEqual([5000]);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatch(/^http:\/\/127\.0\.0\.1:7000\/abc\/fixes/);

        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
        expect(await fetchResearchFixes('http://127.0.0.1:7000/abc')).toEqual({ ok: false, code: 'missing' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        expect(await fetchResearchFixes('http://127.0.0.1:7000/abc')).toEqual({ ok: false, code: 'error' });
    });
});
