/**
 * Colours of the ancestors' path on the map (spec 054 §2): the OKLCH table and
 * its hex values, the CSS variables in index.html (light and dark), patterns,
 * widths, the opacity with a chosen person, split points and swatches.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    LINE_TOKENS, LINE_CASING, lineTokenHex, lineColorVar, lineDash, lineCap, lineWidth, lineStyle, pathLineOpacity,
    pointFill, pointSize, sortLineClasses, lineSwatch, lineQuarterOf,
} from '../map-line-colors.js';
import { contrastRatio } from '../fan-colors.js';

const TABLE = {
    light: { q0: '#a94700', q1: '#977e0d', q2: '#0e899f', q3: '#7f2c91', e1: '#743100', e3: '#6f5c00', e5: '#006071', e7: '#581666' },
    dark: { q0: '#ee8545', q1: '#eed059', q2: '#5cd0ea', q3: '#c97adb', e1: '#c36c36', e3: '#bca341', e5: '#3fa8bf', e7: '#ab68ba' },
} as const;

describe('line colours', () => {
    it('the OKLCH sources give the hex values of the table', () => {
        for (const theme of ['light', 'dark'] as const) {
            for (const t of LINE_TOKENS) expect(lineTokenHex(t, theme), `${theme} ${t}`).toBe(TABLE[theme][t]);
        }
    });

    it('every colour stands out from the map tiles (≥ 3:1)', () => {
        for (const t of LINE_TOKENS) {
            expect(contrastRatio(lineTokenHex(t, 'light'), '#ebe6d6'), `light ${t}`).toBeGreaterThanOrEqual(3);
            expect(contrastRatio(lineTokenHex(t, 'dark'), '#2f2d27'), `dark ${t}`).toBeGreaterThanOrEqual(3);
        }
    });

    it('index.html defines the same variables in the light and the dark theme', () => {
        const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
        const at = (re: RegExp) => html.slice(html.search(re));
        const light = at(/:root\s*\{/), dark = at(/\[data-theme="dark"\]\s*\{/);
        const token = (block: string, name: string) => block.match(new RegExp(`--line-${name}:\\s*([^;]+);`))?.[1].trim().toLowerCase();
        for (const t of LINE_TOKENS) {
            expect(token(light, t), `light ${t}`).toBe(TABLE.light[t]);
            expect(token(dark, t), `dark ${t}`).toBe(TABLE.dark[t]);
        }
        expect(token(light, 'casing')).toBe(LINE_CASING.light);
        expect(token(dark, 'casing')).toBe(LINE_CASING.dark);
    });

    it('even eighths take their quarter’s colour, odd ones their own; the trunk is the text colour', () => {
        expect(lineColorVar('q2')).toBe('var(--line-q2)');
        expect(lineColorVar('e0')).toBe('var(--line-q0)');
        expect(lineColorVar('e6')).toBe('var(--line-q3)');
        expect(lineColorVar('e5')).toBe('var(--line-e5)');
        expect(lineColorVar('trunk')).toBe('var(--text)');
        expect(lineColorVar('q1', false)).toBe('var(--primary)');
        expect(lineColorVar('trunk', false)).toBe('var(--primary)');
        expect(lineQuarterOf('e7')).toBe(3);
        expect(lineQuarterOf('trunk')).toBe(-1);
    });
});

describe('line patterns, widths and opacity', () => {
    it('each quarter has its pattern, an eighth its quarter’s; the trunk and colours off are solid', () => {
        expect(['q0', 'q1', 'q2', 'q3'].map(c => lineDash(c as 'q0'))).toEqual([null, '9 5', '0.1 6.5', '12 4 2.5 4']);
        expect(lineDash('e3')).toBe('9 5');
        expect(lineDash('e4')).toBe('0.1 6.5');
        expect(lineDash('trunk')).toBeNull();
        expect(lineDash('q1', false)).toBeNull();
        expect(lineCap('q2')).toBe('round');
        expect(lineCap('q1')).toBe('butt');
    });

    it('3 px, fresh 4 px, the trunk 4.5 px (also without colours); the casing 3 px wider', () => {
        expect(lineWidth('q0', false)).toBe(3);
        expect(lineWidth('q0', true)).toBe(4);
        expect(lineWidth('trunk', false)).toBe(4.5);
        const s = lineStyle('trunk', { age: 3, colors: false });
        expect(s).toMatchObject({ stroke: 'var(--primary)', width: 4.5, dash: null, casing: 'var(--line-casing)', casingWidth: 7.5 });
        expect(lineStyle('e1', { age: 5 })).toMatchObject({ stroke: 'var(--line-e1)', width: 4, dash: null, opacity: pathLineOpacity(5) });
        expect(lineStyle('e5', { age: 12 })).toMatchObject({ width: 3, dash: '0.1 6.5' });
    });

    it('fades from 1 to 0.55 over sixty years and stays there', () => {
        expect(pathLineOpacity(0)).toBe(1);
        expect(pathLineOpacity(30)).toBeCloseTo(0.775, 6);
        expect(pathLineOpacity(60)).toBeCloseTo(0.55, 6);
        expect(pathLineOpacity(200)).toBe(0.55);
    });

    it('a highlighted line leaves the others at 0.15 and the trunk at 0.3', () => {
        expect(lineStyle('q1', { age: 0, focus: 'q2' }).opacity).toBeCloseTo(0.15, 6);
        expect(lineStyle('trunk', { age: 0, focus: 'q2' }).opacity).toBeCloseTo(0.3, 6);
        expect(lineStyle('q2', { age: 0, focus: 'q2' }).opacity).toBe(1);
    });
});

describe('points and swatches', () => {
    it('a split point has equal slices in the fixed order, the trunk last', () => {
        expect(sortLineClasses(['trunk', 'e5', 'q3', 'q0'])).toEqual(['q0', 'q3', 'e5', 'trunk']);
        expect(pointFill(['q2', 'q1'])).toBe('conic-gradient(var(--line-q1) 0% 50%, var(--line-q2) 50% 100%)');
        expect(pointFill(['trunk'])).toBe('var(--text)');
        expect(pointFill(['q0', 'e0'])).toBe('var(--line-q0)');
        expect(pointFill(['q0', 'q1'], false)).toBe('var(--primary)');
        expect(pointSize(1, false)).toBe(13);
        expect(pointSize(2, false)).toBe(17);
        expect(pointSize(2, true)).toBe(18);
    });

    it('the legend swatch draws the line’s pattern', () => {
        expect(lineSwatch('q0')).toBe('var(--line-q0)');
        expect(lineSwatch('e3')).toContain('repeating-linear-gradient(90deg, var(--line-e3) 0 9px');
        expect(lineSwatch('q2')).toContain('radial-gradient');
        expect(lineSwatch('q3')).toContain('12px 16px');
        expect(lineSwatch('q3', false)).toBe('var(--primary)');
        expect(lineSwatch('trunk')).toBe('var(--text)');
    });
});
