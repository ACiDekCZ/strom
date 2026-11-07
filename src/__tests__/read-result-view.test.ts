/**
 * "Read a document", the result screen's builders (spec 059 P7): the places of the shown entry, the text with one
 * mark per place, "To check" with minor details folded, the bubble of a place; and how the phone's strip frames its
 * entry and line. Invented data only (Vlk, Pištěnice).
 */

import { describe, it, expect } from 'vitest';
import { resultPlaces, lineMarksHtml, checkHtml, placePopHtml, type ShownPlace } from '../ui/read-result-view.js';
import { stripLayout, type MergedVariant } from '../read-result.js';
import { getStringsForLang } from '../strings.js';

const TEXT = 'Joannes Vlk filius legitimus\nJosephi Vlk[?] in Pištěnice N. 7\net Catharinae [...]';
const v = (at: string, other: string, over: Partial<MergedVariant> = {}): MergedVariant => ({ at, other, ...over });
const opts = { isSource: false, shown: 1 as const, kinded: false, focus: '' };
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

describe('resultPlaces', () => {
    it('a disagreement found on its line, an uncertain word and an illegible spot with their spans, a place of the data off the text', () => {
        const { lines, places } = resultPlaces({
            text: TEXT, dis: [v('Pištěnice', 'Dubrava')], disSide: 'at', disKinded: false,
            data: [{ v: v('Vlk', 'Wolf'), label: 'Josef Vlk · surname' }], chg: null,
        });
        expect(lines).toHaveLength(3);
        const byKind = (k: string): ShownPlace[] => places.filter(p => p.kind === k);
        expect(byKind('dis').map(p => [p.id, p.line])).toEqual([['d0', 1], ['d1', -1]]);
        expect(byKind('dis')[1].label).toBe('Josef Vlk · surname');
        const dis = byKind('dis')[0];
        expect(lines[1].slice(dis.span![0], dis.span![1])).toBe('Pištěnice');
        expect(byKind('unc')).toHaveLength(1);
        expect(byKind('unc')[0].word).toBe('Vlk');
        expect(byKind('ill').map(p => p.line)).toEqual([2]);
        expect(byKind('chg')).toHaveLength(0);
    });

    it('an uncertain word inside a disagreement belongs to that place\'s row', () => {
        const { places } = resultPlaces({ text: TEXT, dis: [v('Vlk[?] in', 'Wolf in')], disSide: 'at', disKinded: false, data: [], chg: null });
        expect(places.find(p => p.kind === 'unc')!.inside).toBe(true);
    });

    it('changes against the existing transcript found by their new reading; their kind from the app without named kinds', () => {
        const { places } = resultPlaces({ text: TEXT, dis: [], disSide: 'at', disKinded: false, data: [], chg: [v('Dubrava', 'Pištěnice'), v('legitimus,', 'legitimus')] });
        const chg = places.filter(p => p.kind === 'chg');
        expect(chg.map(p => [p.line, p.cls!.minor])).toEqual([[1, false], [0, true]]);
    });

    it('the readers\' minor places fold only when the research named their kinds', () => {
        const dis = [v('Pištěnice', 'Pištěnice,', { kind: 'punctuation' })];
        const named = resultPlaces({ text: TEXT, dis, disSide: 'at', disKinded: true, data: [], chg: null }).places[0];
        const unnamed = resultPlaces({ text: TEXT, dis, disSide: 'at', disKinded: false, data: [], chg: null }).places[0];
        expect(named.cls).toEqual({ minor: true, kinds: ['punctuation'] });
        expect(unnamed.cls).toEqual({ minor: false, kinds: [] });
    });

    it('a repeated word is marked where the readers differ, by its neighbours in the other text (not its first occurrence)', () => {
        const r1 = 'Kropacek Habrovany 12 | 3. Martii | 12 | Pištěnice';
        const r2 = 'Kropacek Habrovany 12 | 3. Martii | 14 | Pištěnice';
        const span = (o: Parameters<typeof resultPlaces>[0]): string => {
            const { lines, places } = resultPlaces(o);
            const d = places.find(p => p.kind === 'dis')!;
            return `${d.line}:${d.span![0]}`;
        };
        const second = r1.lastIndexOf('12');
        // Reader 1's text: the second 12 (the house number), with reader 2's text beside it.
        expect(span({ text: r1, dis: [v('12', '14')], disSide: 'at', disKinded: false, data: [], chg: null, disCounter: r2 })).toBe(`0:${second}`);
        // Over lines too, and a change against the transcript the same way.
        const lines1 = 'Kropacek Habrovany 12\n3. Martii\n12 Pištěnice';
        const { lines, places } = resultPlaces({
            text: lines1, dis: [], disSide: 'at', disKinded: false, data: [], chg: [v('14', '12')], chgCounter: 'Kropacek Habrovany 12 3. Martii 14 Pištěnice',
        });
        const c = places.find(p => p.kind === 'chg')!;
        expect([c.line, lines[c.line].slice(c.span![0], c.span![1])]).toEqual([2, '12']);
        // No other text: the first occurrence, as before.
        expect(span({ text: r1, dis: [v('12', '14')], disSide: 'at', disKinded: false, data: [], chg: null })).toBe('0:19');
        // The other text tells nothing (the same neighbours everywhere): the first occurrence.
        expect(span({ text: '12 a 12 a', dis: [v('12', '14')], disSide: 'at', disKinded: false, data: [], chg: null, disCounter: '9 b 9 b' })).toBe('0:0');
    });
});

describe('lineMarksHtml', () => {
    const { lines, places } = resultPlaces({ text: TEXT, dis: [v('Pištěnice', 'Dubrava')], disSide: 'at', disKinded: false, data: [], chg: [v('Vlk', 'Wolf')] });

    it('one mark per place: a disagreement tinted, the uncertain word and the illegible spot as their own marks', () => {
        const html = lineMarksHtml(lines[1], 1, places, '');
        expect(count(html, /class="read-mk read-mk-dis"/g)).toBe(1);
        expect(html).toContain('>Pištěnice</span>');
        expect(count(html, /read-mk-unc/g)).toBe(1);
        expect(lineMarksHtml(lines[2], 2, places, '')).toContain('read-mk-ill');
        // A line without places: plain text.
        expect(lineMarksHtml(lines[0], 0, places, '')).toBe('Joannes Vlk filius legitimus');
    });

    it('the focused place told apart; a change listed elsewhere left unmarked', () => {
        expect(lineMarksHtml(lines[1], 1, places, 'd0')).toContain('read-mk-dis is-focus');
        const chg: ShownPlace = { id: 'c0', kind: 'chg', line: 0, span: [8, 11], v: v('Vlk', 'Wolf'), cls: { minor: false, kinds: [] }, word: '', label: '', inside: false };
        expect(lineMarksHtml(lines[0], 0, [chg], '')).toContain('read-mk-chg');
        expect(lineMarksHtml(lines[0], 0, [{ ...chg, elsewhere: true }], '')).not.toContain('read-mk-chg');
    });

    it('text is escaped', () => {
        expect(lineMarksHtml('Vlk <b>&', 0, [], '')).toBe('Vlk &lt;b&gt;&amp;');
    });
});

describe('checkHtml', () => {
    const place = (id: string, over: Partial<ShownPlace>): ShownPlace =>
        ({ id, kind: 'dis', line: 0, span: null, v: v('Vlk', 'Wolf'), cls: { minor: false, kinds: [] }, word: '', label: '', inside: false, ...over });

    it('groups in a fixed order with their counts; nothing to check: empty', () => {
        const html = checkHtml([
            place('i0-1', { kind: 'ill', v: null, cls: null }),
            place('d0', {}),
            place('u0-1', { kind: 'unc', v: null, cls: null, word: 'Vlk' }),
        ], opts);
        expect([...html.matchAll(/data-group="(\w+)"/g)].map(m => m[1])).toEqual(['dis', 'unc', 'ill']);
        expect(html).toContain('· 1 place');
        expect(html).toContain('· 1 word');
        expect(checkHtml([], opts)).toBe('');
        // A place inside another's row has no row of its own.
        expect(checkHtml([place('u0-1', { kind: 'unc', v: null, cls: null, word: 'Vlk', inside: true })], opts)).toBe('');
    });

    it('minor details folded with their count and kinds; "and" only after substantive rows', () => {
        const minor = (id: string) => place(id, { kind: 'chg', cls: { minor: true, kinds: ['punctuation'] } });
        const both = checkHtml([place('c0', { kind: 'chg' }), minor('c1'), minor('c2')], { ...opts, isSource: true });
        expect(both).toContain('<summary>and 2 minor details (punctuation)</summary>');
        expect(count(both, /data-act="place"/g)).toBe(3);
        const alone = checkHtml([minor('c1')], { ...opts, isSource: true });
        expect(alone).toContain('<summary>1 minor detail (punctuation)</summary>');
        // A minor group alone in the other languages: no joining word either.
        expect(getStringsForLang('cs').read.minorsOnly(2, '')).toBe('2 drobnosti');
        expect(getStringsForLang('de').read.minorsOnly(2, '')).toBe('2 Kleinigkeiten');
        expect(getStringsForLang('pl').read.minorsOnly(5, 'interpunkcja')).toBe('5 drobiazgów (interpunkcja)');
    });

    it('beyond 8 substantive rows: the rest hidden behind "and N more"', () => {
        const html = checkHtml(Array.from({ length: 10 }, (_, i) => place(`d${i}`, {})), opts);
        expect(count(html, /data-more hidden/g)).toBe(2);
        expect(html).toContain('and 2 more');
    });

    it('reader 2\'s text shown: the changes said to be reader 1\'s', () => {
        expect(checkHtml([place('c0', { kind: 'chg' })], { ...opts, isSource: true, shown: 2 })).toContain('in the text of reader 1');
    });
});

describe('placePopHtml', () => {
    const dis: ShownPlace = { id: 'd0', kind: 'dis', line: 1, span: [0, 8], v: v('Pištěnice', 'Dubrava'), cls: { minor: false, kinds: ['name'] }, word: '', label: '', inside: false };

    it('each reader\'s reading, the shown one bold, its kind under a line; Show on the scan only as a phone\'s sheet', () => {
        const html = placePopHtml([dis], 2, false);
        expect(count(html, /class="read-pop-row[ "]/g)).toBe(2);
        expect(html).toMatch(/read-pop-row is-shown"><span class="read-pop-sym"><span class="read-rd" aria-hidden="true">2<\/span>/);
        expect(html).toContain('<p class="read-pop-note has-rows">name</p>');
        expect(html).not.toContain('pop-scan');
        expect(placePopHtml([dis], 1, true)).toContain('data-act="pop-scan">Show on the scan</button>');
    });

    it('a change: the new reading and the existing transcript, its weight; an illegible spot in one sentence', () => {
        const chg: ShownPlace = { ...dis, id: 'c0', kind: 'chg', v: v('Dubrava', 'Pištěnice'), cls: { minor: false, kinds: ['spelling'] } };
        const html = placePopHtml([chg], 1, false);
        expect(count(html, /class="read-pop-row[ "]/g)).toBe(2);
        expect(html).toContain('Existing transcript');
        expect(html).toContain('spelling · substantive change');
        const ill: ShownPlace = { ...dis, id: 'i2-3', kind: 'ill', v: null, cls: null };
        expect(placePopHtml([ill], 1, false)).toBe('<p class="read-pop-note">This place could not be read.</p>');
    });
});

describe('stripLayout', () => {
    const W = 358, H = 116;

    it('the entry across the strip\'s width; a short entry centred, a tall one scrolled to the chosen line', () => {
        const entry: [number, number, number, number] = [0.1, 0.1, 0.8, 0.6];
        const wide = stripLayout(entry, null, W, H, 0.75);
        expect(wide.width).toBeCloseTo(W / 0.84, 3);
        expect(wide.height).toBeCloseTo(wide.width / 0.75, 3);
        // Centred on the entry when no line is chosen.
        expect(wide.top + (0.1 + 0.3) * wide.height).toBeCloseTo(H / 2, 3);
        // A line chosen at the entry's bottom: that line in the middle of the strip.
        const line: [number, number, number, number] = [0.1, 0.6, 0.8, 0.1];
        const low = stripLayout(entry, line, W, H, 0.75);
        expect(low.top + 0.65 * low.height).toBeCloseTo(H / 2, 3);
        // Never past the page's edges.
        const top = stripLayout([0.1, 0, 0.8, 0.6], [0.1, 0, 0.8, 0.05], W, H, 0.75);
        expect(top.top).toBe(0);
        const short = stripLayout([0.1, 0.4, 0.8, 0.02], [0.1, 0.4, 0.8, 0.02], W, H, 0.75);
        expect(short.top + 0.41 * short.height).toBeCloseTo(H / 2, 3);
    });

    it('no entry: the whole page across; an empty box: nothing', () => {
        const page = stripLayout(null, null, W, H, 0.5);
        expect(page.width).toBeCloseTo(W, 3);
        expect(page.left).toBe(0);
        expect(stripLayout([0, 0, 1, 1], null, 0, H, 0.75)).toEqual({ width: 0, height: 0, left: 0, top: 0 });
        // A broken ratio falls back to a portrait page.
        expect(stripLayout(null, null, W, H, Number.NaN).height).toBeCloseTo(W / 0.75, 3);
    });
});
