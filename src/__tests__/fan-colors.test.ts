/**
 * Fan chart colours (spec 029 §6.2): hex conversion, contrast of the text on
 * every computed fill, the tokens in index.html, the legend of each mode.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    FAN_PALETTES, FanTheme, oklchToHex, contrastRatio, fanLineColor, fanFill, fanLegend, fanHasRepeats,
    LINE_HUE, parentLineColor, descLineColor, fanRodSlots, fanRodSlotColor, fanRodSlotOklch, fanRodFill, parseFanRodSlot,
    FAN_ROD_GROUPS, FanRodSlot, oklab, deltaE, deltaEDeutan,
    FAN_STYLES, FanStyle, fanPalette, fanStyleFont, fanRodSlotPattern, FAN_PATTERNS, FanPatternId, fanPatternSvg, fanFillLook, fanRodSlotDistance,
} from '../fan-colors.js';
import { assignFanRodColors } from '../fan-rod-assign.js';
import { buildFanModel, buildFanSvg } from '../fan-chart.js';
import { buildLineages } from '../lineage.js';
import { StromData, Person, PersonId, Gender } from '../types.js';
import { readFileSync as readFixture } from 'node:fs';

function person(id: string, gender: Gender, parentIds: string[] = [], o: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: id, lastName: 'Kvítek', gender, isPlaceholder: false, parentIds: parentIds as PersonId[], childIds: [], partnerships: [], ...o };
}
function data(persons: Person[]): StromData {
    for (const p of persons) for (const pid of p.parentIds) persons.find(x => x.id === pid)?.childIds.push(p.id);
    return { persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
}

/** Every fill the fan can compute in a theme. */
function allFills(theme: FanTheme): string[] {
    const T = FAN_PALETTES[theme];
    const out = [T.male, T.female, T.unknown, T.grey];
    for (let g = 2; g <= 10; g++) for (let line = 0; line < 4; line++) out.push(fanLineColor(line, g, theme));
    for (const slot of fanRodSlots()) out.push(fanRodSlotColor(slot, theme));
    const p = person('p', 'male');
    for (const ah of [2, 3]) out.push(fanFill({ kind: 'anc', person: p, generation: 1, ahnentafel: ah }, 'line', theme));
    out.push(fanFill({ kind: 'desc', person: p }, 'line', theme), fanFill({ kind: 'partner', person: p }, 'line', theme));
    return out;
}

describe('oklchToHex', () => {
    it('converts known colours', () => {
        expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
        expect(oklchToHex(0, 0, 0)).toBe('#000000');
        expect(oklchToHex(0.62796, 0.25768, 29.23)).toBe('#ff0000');
    });
});

describe('contrast (spec 029 §6.2)', () => {
    it('keeps the names at least 7:1 on every light fill and 4.6:1 on every dark one', () => {
        for (const [theme, minRatio] of [['light', 7], ['print', 7], ['dark', 4.6]] as const) {
            const text = FAN_PALETTES[theme].text;
            for (const fill of allFills(theme)) {
                expect(contrastRatio(text, fill), `${theme} ${text} on ${fill}`).toBeGreaterThanOrEqual(minRatio);
            }
        }
    });

    it('draws the dates and Kekulé numbers in the text colour too (the lighter text falls under 7:1 on line fills)', () => {
        const svg = buildFanSvg(buildFanModel(data([person('me', 'male', ['f']), person('f', 'male')]), 'me' as PersonId, 3)!, {
            esc: (t: string) => t, editable: false, addParentLabel: '', uid: 'tc',
        });
        expect(svg).toContain(`#tc .fan-years,#tc .fan-kekule{fill:${FAN_PALETTES.light.text}}`);
        expect(svg).toContain(`[data-theme="dark"] #tc .fan-years,[data-theme="dark"] #tc .fan-kekule{fill:${FAN_PALETTES.dark.text}}`);
    });

    it('makes the four grandparent lines tell apart in both themes', () => {
        for (const theme of ['light', 'dark'] as const) {
            expect(new Set([0, 1, 2, 3].map(l => fanLineColor(l, 2, theme))).size).toBe(4);
            // Lighter outward in the light theme, darker outward in the dark one.
            const lum = (h: string) => contrastRatio(h, '#000000');
            if (theme === 'light') expect(lum(fanLineColor(0, 10, theme))).toBeGreaterThan(lum(fanLineColor(0, 2, theme)));
            else expect(lum(fanLineColor(0, 10, theme))).toBeLessThan(lum(fanLineColor(0, 2, theme)));
        }
    });
});

describe('line mode in the P2 lineage hues (spec 112 §3)', () => {
    it('takes the hues of the cards: paternal blue, maternal pink, descendants ochre, grandparents 258/232/352/5', () => {
        expect([...LINE_HUE]).toEqual([258, 232, 352, 5]);
        expect(parentLineColor(true, 'light')).toBe('#a8b9d1');
        expect(parentLineColor(false, 'light')).toBe(oklchToHex(0.78, 0.04, 352));
        expect(parentLineColor(true, 'dark')).toBe('#55647a');
        expect(descLineColor(false, 'light')).toBe('#e7d5b7');
        expect(descLineColor(true, 'light')).toBe(oklchToHex(0.93, 0.03, 82));
        expect(fanLineColor(0, 2, 'light')).toBe('#aabfde');
        expect(fanLineColor(1, 2, 'light')).toBe('#9ec4d9');
        expect(fanLineColor(2, 2, 'light')).toBe('#d8b1c1');
        expect(fanLineColor(0, 2, 'dark')).toBe('#495c77');
    });

    it('keeps the text at least 7:1 on the parents\', the descendants\' and the grandparents\' fills in the light theme and print', () => {
        for (const theme of ['light', 'print'] as const) {
            const text = FAN_PALETTES[theme].text;
            const fills = [
                parentLineColor(true, theme), parentLineColor(false, theme), descLineColor(false, theme), descLineColor(true, theme),
                ...[0, 1, 2, 3].flatMap(l => [2, 6, 10].map(g => fanLineColor(l, g, theme))),
            ];
            for (const fill of fills) expect(contrastRatio(text, fill), `${theme} ${fill}`).toBeGreaterThanOrEqual(7);
        }
        const dark = FAN_PALETTES.dark.text;
        for (const fill of [parentLineColor(true, 'dark'), parentLineColor(false, 'dark'), descLineColor(false, 'dark'), descLineColor(true, 'dark')]) {
            expect(contrastRatio(dark, fill), `dark ${fill}`).toBeGreaterThanOrEqual(4.6);
        }
    });
});

describe('family-line palette (spec 114 §2)', () => {
    const REF: { hex: Record<string, [string, string]> } = JSON.parse(readFixture(new URL('./fixtures/fan-rod-reference.json', import.meta.url), 'utf8'));
    const slots = fanRodSlots();
    const of = (g: string, t: string) => slots.filter(s => s.startsWith(g + t));

    it('has the slots of the table widened for K1.7: P 8 strong + 9 muted, M 8 + 6, D 4 + 4', () => {
        expect(slots.length).toBe(39);
        expect(FAN_ROD_GROUPS.map(g => [of(g, 'S').length, of(g, 'T').length])).toEqual([[8, 9], [8, 6], [4, 4]]);
        expect(slots.every(s => parseFanRodSlot(s))).toBe(true);
        for (const bad of ['PS8', 'MT6', 'DS4', 'XS0', 'PS', 'ps0', 'PS00x']) expect(parseFanRodSlot(bad), bad).toBeNull();
    });

    it('equals the hex table of §2 in the light (= print) and the dark theme (test 2); the added slots keep clear of their group', () => {
        // The design's table is the start of each group's list; the slots after it are K1.7's.
        const table = Object.keys(REF.hex);
        expect(table.length).toBe(26);
        expect(table.every(s => slots.includes(s as FanRodSlot))).toBe(true);
        for (const s of table as FanRodSlot[]) {
            expect(fanRodSlotColor(s, 'light'), s).toBe(REF.hex[s][0]);
            expect(fanRodSlotColor(s, 'print'), s).toBe(REF.hex[s][0]);
            expect(fanRodSlotColor(s, 'dark'), s).toBe(REF.hex[s][1]);
        }
        expect(fanRodSlotColor('PS0', 'light')).toBe('#8bbff9');
        expect(fanRodSlotColor('MS1', 'dark')).toBe('#7b432c');
        expect(fanRodSlotOklch('PS0', 'light')).toEqual([0.79, 0.1, 252]);
        expect(fanRodFill(null, 'light')).toBe(FAN_PALETTES.light.grey);
        expect(fanRodFill(null, 'dark')).toBe('#3a372f');
        expect(fanRodFill('DS0', 'print')).toBe('#ddbf80');
        for (const s of slots.filter(x => !table.includes(x))) {
            const g = s[0];
            for (const o of slots.filter(x => x !== s && x[0] === g)) {
                expect(deltaE(fanRodSlotColor(s, 'light'), fanRodSlotColor(o, 'light')), `${s} × ${o} light`).toBeGreaterThanOrEqual(0.03);
                expect(deltaE(fanRodSlotColor(s, 'dark'), fanRodSlotColor(o, 'dark')), `${s} × ${o} dark`).toBeGreaterThanOrEqual(0.0225);
            }
        }
    });

    it('keeps the slots apart (test 3): the first strong ones of a group, strong × muted, the groups\' cores', () => {
        const minPair = (xs: FanRodSlot[], ys: FanRodSlot[], theme: 'light' | 'dark') => {
            let m = 9;
            for (const x of xs) for (const y of ys) if (x !== y) m = Math.min(m, deltaE(fanRodSlotColor(x, theme), fanRodSlotColor(y, theme)));
            return m;
        };
        for (const g of FAN_ROD_GROUPS) {
            const first = of(g, 'S').slice(0, 4);
            expect(minPair(first, first, 'light'), `${g} light`).toBeGreaterThanOrEqual(0.038);
            expect(minPair(first, first, 'dark'), `${g} dark`).toBeGreaterThanOrEqual(0.030);
            for (const th of ['light', 'dark'] as const) expect(minPair(of(g, 'S'), of(g, 'T'), th), `${g} S×T ${th}`).toBeGreaterThanOrEqual(0.045);
        }
        const cores: FanRodSlot[] = ['PS0', 'MS0', 'DS0'];
        for (const th of ['light', 'dark'] as const) expect(minPair(cores, cores, th), `cores ${th}`).toBeGreaterThanOrEqual(0.10);
    });

    it('measures colours in OKLab, also as a deuteranope sees them', () => {
        expect(oklab('#ffffff')[0]).toBeCloseTo(1, 3);
        expect(oklab('#000000')[0]).toBeCloseTo(0, 6);
        expect(deltaE('#8bbff9', '#8bbff9')).toBe(0);
        expect(deltaE('#ff0000', '#00ff00')).toBeGreaterThan(0.4);
        // Red and green, far apart, come close for a deuteranope.
        expect(deltaEDeutan('#ff0000', '#00ff00')).toBeLessThan(deltaE('#ff0000', '#00ff00') / 2);
    });
});

describe('tokens in index.html', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const token = (block: string, name: string) => block.match(new RegExp(`--fan-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1].toLowerCase();

    it('match the hex values of the light and the dark palette', () => {
        const at = (re: RegExp) => html.slice(html.search(re));
        const light = at(/:root\s*\{/);
        const dark = at(/\[data-theme="dark"\]\s*\{/);
        for (const name of ['male', 'female', 'unknown', 'hatch'] as const) {
            expect(token(light, name), `light ${name}`).toBe(FAN_PALETTES.light[name]);
            expect(token(dark, name), `dark ${name}`).toBe(FAN_PALETTES.dark[name]);
        }
    });
});

describe('fills and legend', () => {
    const d = data([
        person('me', 'male', ['f', 'm']),
        person('f', 'male', ['ff', 'fm'], { firstName: 'Bohumil' }), person('m', 'female', ['mf', 'mm'], { lastName: 'Ostružníková' }),
        person('ff', 'male', [], { firstName: 'Václav' }), person('fm', 'female', [], { firstName: 'Marie', lastName: 'Zrzavá' }),
        person('mf', 'male', [], { firstName: 'Jan', lastName: 'Ostružník' }), person('mm', 'female', [], { firstName: 'Anna', lastName: 'Lobkovcová' }),
    ]);
    const m = buildFanModel(d, 'me' as PersonId, 4)!;

    it('colours ancestors by the grandparent line their Kekulé number leads to', () => {
        const fill = (n: number) => {
            const s = m.sectors.find(x => x.ahnentafel === n)!;
            return fanFill({ kind: 'anc', person: s.person ?? person('x', 'male'), generation: s.generation, ahnentafel: n }, 'line', 'light');
        };
        expect(fill(4)).toBe(fanLineColor(0, 2, 'light'));
        expect(fill(7)).toBe(fanLineColor(3, 2, 'light'));
        // 13 = 6·2+1: the mother's father's mother.
        expect(fill(13)).toBe(fanLineColor(2, 3, 'light'));
        expect(fill(2)).not.toBe(fill(3));
    });

    it('lists sex, the four lines with the grandparents, or the family lines with counts', () => {
        expect(fanLegend(m, 'gender', 'light').map(i => i.key)).toEqual(['male', 'female', 'unknown']);
        const lines = fanLegend(m, 'line', 'dark');
        expect(lines.map(i => i.who)).toEqual(['Václav Kvítek', 'Marie Zrzavá', 'Jan Ostružník', 'Anna Lobkovcová']);
        expect(lines[0].color).toBe(fanLineColor(0, 2, 'dark'));
        expect(lines[0].color2).toBe(fanLineColor(0, 4, 'dark'));
        const rc = assignFanRodColors(m, buildLineages(d));
        expect([...assignFanRodColors(m, buildLineages(d)).slotOf]).toEqual([...rc.slotOf]);
        const rods = fanLegend(m, 'rod', 'light', rc);
        const total = rods.reduce((a, i) => a + parseInt(i.who!, 10), 0);
        expect(total).toBe(7);
        for (const i of rods) expect(i.who).toMatch(/^\d+×$/);
        expect(fanHasRepeats(m)).toBe(false);
    });

    it('fills the focus with the surface and an unknown partner with the "unknown" fill', () => {
        expect(fanFill({ kind: 'focus', person: d.persons['me' as PersonId] }, 'rod', 'dark')).toBe(FAN_PALETTES.dark.surface);
        expect(fanFill({ kind: 'partner', person: null }, 'gender', 'print')).toBe(FAN_PALETTES.print.unknown);
        expect(FAN_PALETTES.print.bg).toBe('#ffffff');
    });
});

describe('styles (spec 118 §4)', () => {
    const p = person('p', 'male');

    /** Every fill the fan can compute in a style and theme. */
    function styleFills(style: FanStyle, theme: FanTheme): string[] {
        const T = fanPalette(theme, style);
        const out = [T.male, T.female, T.unknown, T.grey];
        for (let g = 2; g <= 10; g++) for (let line = 0; line < 4; line++) out.push(fanLineColor(line, g, theme, style));
        for (const slot of fanRodSlots()) out.push(fanRodSlotColor(slot, theme, style));
        out.push(parentLineColor(true, theme, style), parentLineColor(false, theme, style));
        out.push(descLineColor(false, theme, style), descLineColor(true, theme, style));
        return out;
    }

    it('keeps the names at least 7:1 on every light and print fill and 4.6:1 on every dark one, in every style', () => {
        expect([...FAN_STYLES]).toEqual(['color', 'pastel', 'antique', 'mono']);
        for (const style of FAN_STYLES) {
            for (const [theme, minRatio] of [['light', 7], ['print', 7], ['dark', 4.6]] as const) {
                const text = fanPalette(theme, style).text;
                for (const fill of styleFills(style, theme)) {
                    expect(contrastRatio(text, fill), `${style} ${theme} ${text} on ${fill}`).toBeGreaterThanOrEqual(minRatio);
                }
            }
        }
    });

    it('leaves the colour style as it was: the same palettes and slots', () => {
        for (const theme of ['light', 'dark', 'print'] as const) {
            expect(fanPalette(theme)).toEqual(FAN_PALETTES[theme]);
            expect(fanPalette(theme, 'color')).toEqual(FAN_PALETTES[theme]);
            for (const slot of fanRodSlots()) expect(fanRodSlotColor(slot, theme, 'color')).toBe(fanRodSlotColor(slot, theme));
        }
        expect(fanStyleFont()).toBe('sans');
        expect(fanStyleFont('antique')).toBe('serif');
        expect(fanStyleFont('mono')).toBe('sans');
    });

    it('equals the hex table of the design (appendix C) in samples of each style', () => {
        const C: Array<[FanStyle, FanRodSlot, string, string]> = [
            ['pastel', 'PS0', '#b7d8fd', '#395677'], ['pastel', 'MS0', '#f7cdde', '#5f3d4c'], ['pastel', 'DT3', '#fff0e4', '#47382c'],
            ['antique', 'PS0', '#b8c499', '#566039'], ['antique', 'MS2', '#f4c8c3', '#724d49'], ['antique', 'DT3', '#f2e4d1', '#4a3f2f'],
            ['mono', 'PS0', '#b7b7b7', '#696969'], ['mono', 'MS6', '#bebebe', '#636363'], ['mono', 'DS2', '#eeeeee', '#383838'],
        ];
        for (const [style, slot, light, dark] of C) {
            expect(fanRodSlotColor(slot, 'light', style), `${style} ${slot}`).toBe(light);
            expect(fanRodSlotColor(slot, 'print', style), `${style} ${slot}`).toBe(light);
            expect(fanRodSlotColor(slot, 'dark', style), `${style} ${slot}`).toBe(dark);
        }
        expect([fanLineColor(0, 2, 'light', 'pastel'), fanLineColor(0, 10, 'light', 'pastel')]).toEqual(['#c6d4e8', '#e0eeff']);
        expect([fanLineColor(3, 2, 'light', 'antique'), fanLineColor(3, 10, 'light', 'antique')]).toEqual(['#e0b9b9', '#ffdddd']);
        expect([parentLineColor(true, 'light', 'antique'), parentLineColor(false, 'light', 'antique')]).toEqual(['#c1c0a2', '#d5b6a9']);
        expect([descLineColor(false, 'light', 'pastel'), descLineColor(true, 'light', 'pastel')]).toEqual(['#efe3cf', '#f5eee0']);
        expect([fanLineColor(1, 6, 'light', 'mono'), parentLineColor(true, 'light', 'mono'), descLineColor(true, 'light', 'mono')])
            .toEqual(['#e8e8e8', '#bebebe', '#f8f8f8']);
        expect(fanPalette('print', 'antique').surface).toBe('#ffffff');
        expect(fanPalette('print', 'mono')).toEqual(fanPalette('light', 'mono'));
    });

    it('black and white: a pattern on every strong slot, none on a muted one, none at the repeats\' 45° or 135°', () => {
        for (const slot of fanRodSlots()) {
            const pat = fanRodSlotPattern(slot, 'mono');
            if (parseFanRodSlot(slot)!.tier === 'S') expect(pat, slot).toBeDefined();
            else expect(pat, slot).toBeUndefined();
            for (const style of ['color', 'pastel', 'antique'] as const) expect(fanRodSlotPattern(slot, style)).toBeUndefined();
        }
        for (const [id, pat] of Object.entries(FAN_PATTERNS)) {
            expect([45, 135], id).not.toContain(((pat.angle % 180) + 180) % 180);
            expect(fanPatternSvg(id as FanPatternId, '#1a1a1a'), id).toMatch(/^<svg [^>]*width="\d+(\.\d+)?" height="\d+(\.\d+)?"/);
        }
        expect(Object.keys(FAN_PATTERNS).length).toBeLessThanOrEqual(8);
        // The female sector carries the dot; a family line outside the patterns has none.
        expect(fanFillLook({ kind: 'anc', person: person('w', 'female'), generation: 1, ahnentafel: 3 }, 'gender', 'light', null, 'mono'))
            .toEqual({ fill: fanPalette('light', 'mono').female, pattern: 'dot' });
        expect(fanFillLook({ kind: 'anc', person: p, generation: 1, ahnentafel: 2 }, 'gender', 'light', null, 'mono').pattern).toBeUndefined();
        expect(fanFillLook({ kind: 'anc', person: p, generation: 1, ahnentafel: 2 }, 'gender', 'light', null, 'pastel').pattern).toBeUndefined();
    });

    it('measures distinctness in the style; different patterns are always distinct', () => {
        expect(fanRodSlotDistance('PS0', 'PS1', 'light', 'mono')).toBe(9);
        expect(fanRodSlotDistance('PS0', 'PS3', 'light', 'mono')).toBeLessThan(9);
        expect(fanRodSlotDistance('PS0', 'PS1', 'light')).toBe(Math.min(
            deltaE(fanRodSlotColor('PS0', 'light'), fanRodSlotColor('PS1', 'light')) / 0.04,
            deltaEDeutan(fanRodSlotColor('PS0', 'light'), fanRodSlotColor('PS1', 'light')) / 0.02,
        ));
    });
});
