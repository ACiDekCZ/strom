/**
 * Now and Lines of a phone's Research screen (spec 094 K3.13 §2, §3): the order of work after a move (and its new
 * numbers), what Now says on its heading, on a row and when nobody works, and which refusal is "being written".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage, strings } from '../strings';
import {
    lineWriteBusy, linesInOrder, movedLineOrder, phoneComputerOnlyNote, phoneNowIdle, phoneNowMeta, phoneNowTitle, wayGlyph,
} from '../ui/phone-research-ui';
import type { DeviceGlance, DeviceGlanceLine, DeviceGlanceNow } from '../device/device-research-data';

const NOW = Date.parse('2026-11-25T14:40:00Z');

function line(id: string, n: number, o: Partial<DeviceGlanceLine> = {}): DeviceGlanceLine {
    return { id, n, name: `Line ${id}`, direction: 'ancestors', way: 'up', state: 'active', tasks: 2, waiting: 0, working: false, since: '2026-11-20T10:00:00Z', ...o };
}

function glance(o: Partial<DeviceGlance> = {}): DeviceGlance {
    return {
        head: 'h1', tree: { id: 't', name: 'Tree', lang: 'en', state: 'research', persons: 10, families: 4 },
        now: [], runs: [], lines: [], waiting: { n: 0, items: [] }, people: {}, ...o,
    };
}

beforeAll(() => setLanguage('en'));

describe('the order of work after a move', () => {
    const ids = ['G1', 'G2', 'G3', 'G4'];
    it.each([
        { id: 'G3', move: 'up' as const, out: ['G1', 'G3', 'G2', 'G4'] },
        { id: 'G2', move: 'down' as const, out: ['G1', 'G3', 'G2', 'G4'] },
        { id: 'G4', move: 'first' as const, out: ['G4', 'G1', 'G2', 'G3'] },
    ])('$id $move', ({ id, move, out }) => {
        expect(movedLineOrder(ids, id, move)).toEqual(out);
    });

    it('changes nothing at the ends, nor for a line not in it', () => {
        expect(movedLineOrder(ids, 'G1', 'up')).toBeNull();
        expect(movedLineOrder(ids, 'G1', 'first')).toBeNull();
        expect(movedLineOrder(ids, 'G4', 'down')).toBeNull();
        expect(movedLineOrder(ids, 'G9', 'up')).toBeNull();
    });
});

describe('the lines in the order of work', () => {
    const lines = [line('G2', 2), line('G1', 1), line('G3', 3)];

    it('go by their numbers without a move', () => {
        expect(linesInOrder(lines).map(l => [l.id, l.n])).toEqual([['G1', 1], ['G2', 2], ['G3', 3]]);
    });

    it('go by the move on its way, numbered again from 1', () => {
        expect(linesInOrder(lines, ['G3', 'G1', 'G2']).map(l => [l.id, l.n])).toEqual([['G3', 1], ['G1', 2], ['G2', 3]]);
    });

    it('keep a line the move does not name after it', () => {
        expect(linesInOrder(lines, ['G2', 'G1']).map(l => l.id)).toEqual(['G2', 'G1', 'G3']);
    });

    it('back where they were once the move is dropped (a refusal)', () => {
        const moved = linesInOrder(lines, movedLineOrder(['G1', 'G2', 'G3'], 'G2', 'up'));
        expect(moved.map(l => l.id)).toEqual(['G2', 'G1', 'G3']);
        expect(linesInOrder(lines, null).map(l => l.id)).toEqual(['G1', 'G2', 'G3']);
    });
});

describe('what Now says', () => {
    const at = (o: Partial<DeviceGlanceNow>): DeviceGlanceNow => ({ since: '2026-11-25T14:05:00Z', way: 'up', ...o });

    it('heading: "Now", with more lines at work their count', () => {
        expect(phoneNowTitle([])).toBe(strings.deviceResearch.nowTitle);
        expect(phoneNowTitle([at({ line: 'G1' }), at({ line: 'G1' })])).toBe(strings.deviceResearch.nowTitle);
        expect(phoneNowTitle([at({ line: 'G1' }), at({ line: 'G2' })])).toBe(strings.deviceResearch.nowTitleLines(2));
    });

    it('a row: since when, paused until when, or stopping', () => {
        const lang = 'en';
        const since = phoneNowMeta(at({}), { stopping: false, lang, now: NOW });
        expect(since).toBe(strings.deviceResearch.nowSince(since.replace(/^working since /, '')));
        expect(since).toMatch(/^working since \d/);
        const paused = phoneNowMeta(at({ paused: { until: '2026-11-25T15:00:00Z' } }), { stopping: false, lang, now: NOW });
        expect(paused).toMatch(/^paused · goes on at \d/);
        expect(phoneNowMeta(at({ paused: { until: '2026-11-25T15:00:00Z' } }), { stopping: true, lang, now: NOW })).toBe(strings.deviceResearch.nowStopping);
    });

    it('nobody at work: never worked on, or when it was last', () => {
        expect(phoneNowIdle(null, { lang: 'en', now: NOW })).toEqual({ kind: 'never' });
        expect(phoneNowIdle(glance(), { lang: 'en', now: NOW })).toEqual({ kind: 'never' });
        const idle = phoneNowIdle(glance({ lastWorked: '2026-11-25T12:00:00Z' }), { lang: 'en', now: NOW });
        expect(idle?.kind).toBe('idle');
        expect(idle && idle.kind === 'idle' ? idle.last : '').toMatch(/^Last worked \d/);
        expect(phoneNowIdle(glance({ now: [at({})], lastWorked: '2026-11-25T12:00:00Z' }), { lang: 'en', now: NOW })).toBeNull();
    });

    it('the way glyph', () => {
        expect([wayGlyph('up'), wayGlyph('down'), wayGlyph('other')]).toEqual(['↑', '↓', '?']);
    });
});

describe('the writes of the lines', () => {
    it('a 409 or 503 refusal is the research being written ("linesBusy"), others are not', () => {
        const refused = (status: number) => ({ ok: false as const, code: 'busy' as const, status, errorCode: '', retryAfter: null, reason: '' });
        expect(lineWriteBusy(refused(409))).toBe(true);
        expect(lineWriteBusy(refused(503))).toBe(true);
        expect(lineWriteBusy(refused(400))).toBe(false);
        expect(lineWriteBusy({ ok: true, head: 'h2' })).toBe(false);
    });

    it('the quiet sentence of what stays on the computer comes from one place', () => {
        expect(phoneComputerOnlyNote('line-work', 'Study')).toBe(strings.device.dirWorkOnComputer('Study'));
        expect(phoneComputerOnlyNote('conflict', 'Study')).toBe(strings.deviceResearch.conflictOnComputer('Study'));
    });
});
