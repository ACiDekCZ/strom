/**
 * Fan chart colours (spec 029 §6.2): hex conversion, contrast of the text on
 * every computed fill, the tokens in index.html, the legend of each mode.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    FAN_PALETTES, FanTheme, oklchToHex, contrastRatio, fanLineColor, fanRodColor, fanFill, fanLegend, fanRodColors, fanHasRepeats,
} from '../fan-colors.js';
import { buildFanModel, buildFanSvg } from '../fan-chart.js';
import { buildLineages } from '../lineage.js';
import { StromData, Person, PersonId, Gender } from '../types.js';

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
    for (let r = 0; r < 10; r++) out.push(fanRodColor(r, theme));
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
        const rc = fanRodColors(buildLineages(d));
        expect(fanRodColors(buildLineages(d)).rank.size).toBe(rc.rank.size);
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
