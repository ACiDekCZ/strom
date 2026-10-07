/**
 * The custom card's labels style, the years under the name and the name in
 * two rows (U02, src/card-width.ts, src/card-fields.ts) and the poster drawing
 * them like the screen (src/export-image.ts). Widths come from a made-up
 * measure, so the arithmetic is checked exactly. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    MeasureTexts, CustomCardEntry, customCardMetrics, customCardRows, customCardHeight, customCardViewHeight,
    customCardSpouseLineY, cardHeadBlock, cardLinesTop, wrapCardText,
} from '../card-width.js';
import { cardLines, cardLineHtml, cardYears, normalizeCardFields, customCardSize, CardLine } from '../card-fields.js';
import { buildTreeSvg, PosterLayout } from '../export-image.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, PartnershipId, StromData } from '../types.js';

/** Per character: the name 8px, a label 7px, the years 5px, a date or a place 6px. */
const measure: MeasureTexts = (kind, texts) => {
    const out = new Map<string, number>();
    const per = kind === 'name' ? 8 : kind === 'label' ? 7 : kind === 'years' ? 5 : 6;
    for (const t of texts) out.set(t, t.length * per);
    return out;
};

const line = (label: string, date: string, rest: string, extra: Partial<CardLine> = {}): CardLine =>
    ({ key: 'birth', mark: '*', text: `${date} ${rest}`.trim(), spoken: '', date, rest, label, ...extra });

const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function person(extra: Partial<Person> = {}): Person {
    return { id: 'p' as PersonId, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra };
}

const noUnions = {} as Record<PartnershipId, never>;

describe('the label column (U02)', () => {
    beforeEach(() => setLanguage('en'));

    it('is the longest label the view shows, the stand-ins\' own words among them, and not in the marks style', () => {
        // Jan has a birth and a death; Marie only a baptism and a burial, which stand in under their own words.
        const jan = person({ birthDate: '1862', deathDate: '1919' });
        const marie = person({ id: 'm' as PersonId, firstName: 'Marie', events: [
            { id: 'e1', type: 'baptism', date: '1865' }, { id: 'e2', type: 'burial', date: '1920' },
        ] });
        const data: StromData = { persons: { [jan.id]: jan, [marie.id]: marie }, partnerships: noUnions };
        const s = normalizeCardFields({ on: ['birth', 'death'], style: 'labels' });
        const entries = [jan, marie].map(p => ({ name: p.firstName, avatar: true, lines: cardLines(p, data, s) }));
        expect(entries[1].lines.map(l => l.label)).toEqual(['Baptism', 'Burial']);
        // "Baptism" is the longest: 7 × 7 = 49 (Birth 35, Death 35, Burial 42).
        expect(customCardMetrics(entries, measure, 320, 0, 'labels')).toEqual({ cardWidth: 200, dateColumn: 0, labelColumn: 49 });
        // Without Marie only Birth and Death: 35.
        expect(customCardMetrics(entries.slice(0, 1), measure, 320, 0, 'labels').labelColumn).toBe(35);
        // The marks style has a date column and no label column.
        expect(customCardMetrics(entries, measure, 320, 0, 'marks')).toEqual({ cardWidth: 200, dateColumn: 24 });
    });

    it('follows the language: the German burial is wider than the Czech, a cremation says its own word', () => {
        const p = person({ events: [{ id: 'e', type: 'burial', date: '1920' }] });
        const cremated = person({ id: 'c' as PersonId, events: [{ id: 'e', type: 'cremation', date: '1920' }] });
        const data: StromData = { persons: { [p.id]: p, [cremated.id]: cremated }, partnerships: noUnions };
        const s = normalizeCardFields({ on: ['death'], style: 'labels' });
        const column = (who: Person[]) => customCardMetrics(who.map(x => ({ name: 'A', avatar: true, lines: cardLines(x, data, s) })),
            measure, 320, 0, 'labels').labelColumn!;
        setLanguage('cs');
        expect(cardLines(p, data, s)[0].label).toBe('Pohřeb');
        const cs = column([p]);
        setLanguage('de');
        expect(cardLines(p, data, s)[0].label).toBe('Beerdigung');
        expect(cardLines(cremated, data, s)[0].label).toBe('Einäscherung');
        expect(column([p])).toBeGreaterThan(cs);
        expect(column([p, cremated])).toBe(12 * 7);
        setLanguage('en');
    });

    it('the width: the label column, 8px, the date, 5px, the place; the cause of its own counts alone', () => {
        // 35 + 8 + 4 × 6 + 5 + 30 × 6 = 252 → 278 → 280.
        const birth = line('Birth', '1862', 'x'.repeat(30));
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [birth] }], measure, 320, 0, 'labels'))
            .toEqual({ cardWidth: 280, dateColumn: 0, labelColumn: 35 });
        // An occupation has no date: 70 + 8 + 20 × 6 = 198 → 224.
        const job = line('Occupation', '', 'o'.repeat(20), { key: 'occupation', wide: true });
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [job] }], measure, 320, 0, 'labels').cardWidth).toBe(224);
        // Whole: the cause on a row of its own (35 + 8 + 25 × 6 = 193 → 219 → 220), not after the date.
        const death = line('Death', '1919', 'Brno · ' + 'c'.repeat(25), { key: 'death', place: 'Brno', cause: 'c'.repeat(25) });
        expect(customCardMetrics([{ name: 'A', avatar: true, lines: [death] }], measure, 320, 0, 'labels').cardWidth).toBe(220);
    });
});

describe('the labels style\'s rows (U02)', () => {
    // Width 200: room 174; label column 35 → the value is 174 − 35 − 8 = 131 wide (21 characters).
    const metrics = { cardWidth: 200, dateColumn: 0, labelColumn: 35 };
    const rowsOf = (l: CardLine, lines: 0 | 1 | 2 = 0) =>
        customCardRows([{ name: 'A', avatar: true, lines: [l] }], metrics, measure, lines, 'labels').rows.get(l)!;

    it('the date and the place on the first row, the place going on under the value\'s start', () => {
        // After "1862" (24) and 5px: 102px (17 characters) on the first row, then 131 (21).
        const l = line('Birth', '1862', 'Dolní Lhota, kostel sv. Petra a Pavla');
        expect(rowsOf(l)).toEqual({
            rows: [{ date: '1862', text: 'Dolní Lhota,' }, { text: 'kostel sv. Petra a' }, { text: 'Pavla' }],
            cut: false,
        });
    });

    it('a place whose first word does not fit beside the date starts on the next row', () => {
        // "12. 12. 1850" (72) + 5 leaves 54px (9 characters); "Sázavoulhota," is 13.
        const l = line('Birth', '12. 12. 1850', 'Sázavoulhota, okres');
        expect(rowsOf(l).rows).toEqual([{ date: '12. 12. 1850', text: '' }, { text: 'Sázavoulhota, okres' }]);
        // One row a detail: it cannot move, so it shortens beside the date (8 characters and "…").
        expect(rowsOf(l, 1)).toEqual({ rows: [{ date: '12. 12. 1850', text: 'Sázavoul…' }], cut: true });
    });

    it('a date that does not fit wraps like the value, and its rows count against the rows allowed', () => {
        // 25 characters (150px) in a 131px value (21 characters): it breaks after the last space that fits.
        const l = line('Birth', '12. 12. 1850–13. 12. 1855', 'Brno');
        expect(rowsOf(l).rows).toEqual([{ date: '12. 12. 1850–13. 12.', text: '' }, { date: '1855', text: 'Brno' }]);
        // Two rows: the place shares the date's last row.
        expect(rowsOf(l, 2)).toEqual({ rows: [{ date: '12. 12. 1850–13. 12.', text: '' }, { date: '1855', text: 'Brno' }], cut: false });
        // One row: the date ends in "…", the place is left out.
        const one = rowsOf(l, 1);
        expect(one.cut).toBe(true);
        expect(one.rows).toHaveLength(1);
        expect(one.rows[0].date!.endsWith('…')).toBe(true);
        expect(one.rows[0].text).toBe('');
    });

    it('whole: the cause on rows of its own under the place; two rows: "place · cause" ends in "…"', () => {
        const death = line('Death', '1919', 'Horní Lhota · náhlé zapálení mozkových blan', {
            key: 'death', place: 'Horní Lhota', cause: 'náhlé zapálení mozkových blan',
        });
        expect(rowsOf(death).rows).toEqual([
            { date: '1919', text: 'Horní Lhota' },
            { text: 'náhlé zapálení', cause: true }, { text: 'mozkových blan', cause: true },
        ]);
        const two = rowsOf(death, 2);
        expect(two.cut).toBe(true);
        // After "1919" and 5px: 102px (17 characters) on the first row.
        expect(two.rows).toEqual([{ date: '1919', text: 'Horní Lhota ·' }, { text: 'náhlé zapálení mozko…' }]);
    });

    it('"+1" stays glued to the marriage\'s place; an occupation is a value without a date', () => {
        const m = line('Marriage', '1888', 'Dolní Lhota', { key: 'marriage', more: '+1' });
        expect(rowsOf(m).rows).toEqual([{ date: '1888', text: 'Dolní Lhota', tail: ' +1' }]);
        const job = line('Occupation', '', 'mlynář a hostinský v Dolní Lhotě', { key: 'occupation', wide: true });
        expect(rowsOf(job).rows).toEqual([{ text: 'mlynář a hostinský v' }, { text: 'Dolní Lhotě' }]);
    });

    it('the card draws the label and the value\'s rows, the date at the start of its row, a title when cut', () => {
        const l = line('Baptism', '1862', 'Dolní Lhota, kostel sv. Petra a Pavla');
        const html = cardLineHtml(l, esc, false, rowsOf(l), 'labels');
        expect(html).toContain('class="card-line card-line--label card-line--birth card-line--rows"');
        expect(html).toContain('<span class="card-line-label">Baptism</span>');
        expect(html).not.toContain('card-line-mark');
        expect(html).toContain('<span class="card-line-row"><span class="card-line-date">1862</span><span class="card-line-text">Dolní Lhota,</span></span>');
        expect(html).toContain('<span class="card-line-row"><span class="card-line-text">Pavla</span></span>');
        expect(html).not.toContain('title=');
        const cut = cardLineHtml(l, esc, false, rowsOf(l, 2), 'labels');
        expect(cut).toContain(`<span class="card-line-value" title="${l.text}">`);
        // One row: the browser shortens the place after the date.
        const one = cardLineHtml(l, esc, true, undefined, 'labels');
        expect(one).toContain('<span class="card-line-value"><span class="card-line-date">1862</span><span class="card-line-rest" title=');
    });
});

describe('the years under the name and the name in two rows (U02)', () => {
    beforeEach(() => setLanguage('en'));

    it('says the years as the detailed card: a range, estimates in words, the living, nothing without a year', () => {
        expect(cardYears(person({ birthDate: '1841', deathDate: '1922' }))).toBe('1841 – 1922');
        expect(cardYears(person({ birthDate: '~1855', deathDate: '>1919' }))).toBe('c. 1855 – after 1919');
        expect(cardYears(person({ deathDate: '1919' }))).toBe('? – 1919');
        expect(cardYears(person({ birthDate: '1958' }))).toBe('* 1958');
        expect(cardYears(person({ birthDate: '1841' }), true)).toBe('1841 †');
        expect(cardYears(person())).toBe('');
        expect(cardYears(person({ isPlaceholder: true, birthDate: '1841' }))).toBe('');
    });

    it('the header: the avatar\'s 30px, 19 + 14 = 33 with the years, 38 for two name rows, 52 with both', () => {
        expect(cardHeadBlock(1, false)).toBe(30);
        expect(cardHeadBlock(1, true)).toBe(33);
        expect(cardHeadBlock(2, false)).toBe(38);
        expect(cardHeadBlock(2, true)).toBe(52);
        expect(customCardHeight([], 33)).toBe(53);
        expect(customCardHeight([1], 33)).toBe(76);
        expect(customCardHeight([1, 2], 52)).toBe(10 + 52 + 6 + 3 * 17 + 3 + 10);
        expect(cardLinesTop(33)).toBe(49);
        expect(cardLinesTop()).toBe(46);
    });

    it('the view: 3px taller with the years on the one-row card, the partner line at the middle of the taller header', () => {
        expect(customCardViewHeight(3, 1, [], true)).toBe(110);
        expect(customCardViewHeight(3, 1, [], false)).toBe(107);
        expect(customCardSize(3, true).cardHeight).toBe(110);
        expect(customCardSpouseLineY(0, true)).toBe(26.5);
        expect(customCardSpouseLineY(2, true)).toBe(26.5);
        expect(customCardSpouseLineY(0, false)).toBe(25);
        expect(customCardSpouseLineY(1, true)).toBeUndefined();
    });

    it('the years count for the width and the height; a card without a year has no years row', () => {
        // 30 + 8 + 30 × 5 = 188 → 214 → 216 (the name "A" alone is 8).
        const entries: CustomCardEntry[] = [
            { name: 'A', avatar: true, lines: [], years: 'y'.repeat(30) },
            { name: 'B', avatar: true, lines: [], years: '' },
        ];
        expect(customCardMetrics(entries, measure, 320, 0).cardWidth).toBe(216);
        const { heads, heights } = customCardRows(entries, { cardWidth: 216, dateColumn: 0 }, measure, 0);
        expect(heads.map(h => [h.years, h.block])).toEqual([['y'.repeat(30), 33], ['', 30]]);
        expect(heights).toEqual([53, 50]);
    });

    it('a long name wraps into two rows when details may wrap, the second ending in "…"; one row a detail keeps it whole', () => {
        // Room 174 − 38 = 136 (17 characters of the name).
        const metrics = { cardWidth: 200, dateColumn: 0 };
        const names = ['Kateřina Výšková-Hlavatá z Lipan', 'Bartoloměj Wolfensteiner von Hohenberg', 'Jan Vlk'];
        const entries = names.map(name => ({ name, avatar: true, lines: [] }));
        const heads = customCardRows(entries, metrics, measure, 0).heads;
        expect(heads.map(h => [h.name, h.cut])).toEqual([
            [['Kateřina Výšková-', 'Hlavatá z Lipan'], false],
            [['Bartoloměj', 'Wolfensteiner vo…'], true],
            [['Jan Vlk'], false],
        ]);
        expect(heads.map(h => h.block)).toEqual([38, 38, 30]);
        // The same rule with two rows a detail; with one the name is one row (the screen shrinks it).
        expect(customCardRows(entries, metrics, measure, 2).heads.map(h => h.name.length)).toEqual([2, 2, 1]);
        expect(customCardRows(entries, metrics, measure, 1).heads.map(h => h.name)).toEqual(names.map(n => [n]));
        // Without the avatar the room is 174 (21 characters).
        expect(customCardRows([{ name: names[0], avatar: false, lines: [] }], metrics, measure, 0).heads[0].name)
            .toEqual(['Kateřina Výšková-', 'Hlavatá z Lipan']);
    });

    it('wrapping with less room on the first row: as much as fits there, the rest at the full width', () => {
        expect(wrapCardText({ text: 'aaaa bbbb cccc', width: 60, firstWidth: 30, maxLines: 0 }, measure).rows.map(r => r.text))
            .toEqual(['aaaa', 'bbbb cccc']);
        // Not even the first word: the first row stays empty when another row is allowed.
        expect(wrapCardText({ text: 'aaaaaaa bb', width: 60, firstWidth: 30, maxLines: 2 }, measure).rows.map(r => r.text))
            .toEqual(['', 'aaaaaaa bb']);
        expect(wrapCardText({ text: 'aaaaaaa bb', width: 60, firstWidth: 30, maxLines: 1 }, measure))
            .toEqual({ rows: [{ text: 'aaaa…' }], cut: true });
    });
});

describe('the poster draws labels, years and the name\'s rows like the screen (U02)', () => {
    beforeEach(() => setLanguage('en'));
    const a = person({ id: 'a' as PersonId, firstName: 'Kateřina', lastName: 'Výšková-Hlavatá z Lipan', gender: 'female' });
    const data: StromData = { persons: { [a.id]: a }, partnerships: noUnions };
    const layout: PosterLayout = { positions: new Map([[a.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
    const texts = (svg: string, cls: string) => [...svg.matchAll(new RegExp(`<text class="${cls}" x="([\\d.]+)" y="([\\d.]+)"[^>]*>([^<]*)</text>`, 'g'))]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));

    it('the label at the content\'s left, the value 8px after the label column: the date, 5px, the place, rows at the value\'s start', () => {
        const l = line('Birth', '1862', 'Dolní Lhota, kostel sv. Petra a Pavla');
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 200 } as never,
            cardLines: new Map([['a', [l]]]), cardDateColumn: 0, cardLabelColumn: 35, cardStyle: 'labels',
            measureCardTexts: measure, cardValueLines: 0,
        });
        // The name in two rows (38px) → the lines start at 10 + 38 + 6 = 54; the baseline 12.5 into a row.
        expect(texts(svg, 'card-line-label')).toEqual([{ x: 12, y: 66.5, text: 'Birth' }]);
        expect(svg).toMatch(/<text class="card-line-label"[^>]*font-weight="600"[^>]*textLength="35.0"/);
        // Value at 12 + 35 + 8 = 55: the date there, the place 24 + 5 after it, the next rows at 55.
        expect(texts(svg, 'card-line-date')).toEqual([{ x: 55, y: 66.5, text: '1862' }]);
        expect(texts(svg, 'card-line-place')).toEqual([
            { x: 84, y: 66.5, text: 'Dolní Lhota,' }, { x: 55, y: 83.5, text: 'kostel sv. Petra a' }, { x: 55, y: 100.5, text: 'Pavla' },
        ]);
        expect(svg).not.toContain('class="card-line-mark"');
    });

    it('the name\'s two rows and the years under them, the avatar in the middle of the taller header', () => {
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 200 } as never,
            cardLines: new Map([['a', []]]), cardDateColumn: 0, measureCardTexts: measure, cardValueLines: 0,
            cardYears: new Map([['a', '1846 – 1919']]),
        });
        // Header 19 × 2 + 14 = 52: rows at 10 + 14.5 and + 19, the years 10.5 into theirs.
        expect(texts(svg, 'card-name-row')).toEqual([
            { x: 50, y: 24.5, text: 'Kateřina Výšková-' }, { x: 50, y: 43.5, text: 'Hlavatá z Lipan' },
        ]);
        expect(texts(svg, 'card-years')).toEqual([{ x: 50, y: 58.5, text: '1846 – 1919' }]);
        expect(svg).toMatch(/<circle cx="27.0" cy="36.0" r="15"/);
    });

    it('one row a detail: the name stays one text shrunk into the room, the years under it at 33px', () => {
        const svg = buildTreeSvg(data, layout, {
            config: { cardWidth: 200, cardHeight: 110 } as never,
            cardLines: new Map([['a', []]]), cardDateColumn: 0, measureCardTexts: measure, cardValueLines: 1,
            cardYears: new Map([['a', '1846 – 1919']]),
        });
        expect(svg).not.toContain('card-name-row');
        // (33 − 33) / 2 = 0 → the name's baseline 10 + 14.5, the years 10 + 19 + 10.5.
        expect(svg).toMatch(/<text x="50.0" y="24.5" font-size="13" font-weight="600"[^>]*>Kateřina Výšková-Hlavatá z Lipan<\/text>/);
        expect(texts(svg, 'card-years')).toEqual([{ x: 50, y: 39.5, text: '1846 – 1919' }]);
    });
});
