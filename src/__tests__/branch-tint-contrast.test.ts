/**
 * Lineage tint (spec 112): the card's ground in its line's tint must stay
 * readable and, since "No shape" + tint makes the tint the only marking,
 * tell the three lines apart and a tinted card from a plain one, in the light
 * and the dark theme. The tints live in the --branch-*-tint tokens of
 * index.html; the legend's and the Settings' 16px squares of the tint carry a
 * frame in the line's own colour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANCH_TINT } from '../branch-marker-svg.js';

const root = new URL('../../', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');

const LINES = ['paternal', 'maternal', 'descendant'] as const;

function rgb(hex: string): number[] {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function luminance(hex: string): number {
    const [r, g, b] = rgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** OKLab (Ottosson 2020) of an sRGB hex. */
function oklab(hex: string): [number, number, number] {
    const [r, g, b] = rgb(hex);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}

/**
 * Colour difference: the Euclidean distance in OKLab, times 100. OKLab is
 * perceptually uniform enough for this and needs no weighting terms (unlike
 * CIEDE2000); on this scale about 1 is a just noticeable difference of two
 * patches side by side, so the thresholds below ask for a few JNDs.
 *
 * - Tint against the plain card, both themes: ≥ 3.5 — a tinted card must
 *   read as tinted next to an untagged one (partner, sibling) at a glance.
 * - The three tints against each other: ≥ 2 in the light theme, ≥ 5 in the
 *   dark one. On a dark ground the same chroma looks far less colourful (Hunt
 *   effect) and screens add glare to dark tones, so the dark tints need the
 *   larger margin; the light theme's pale tints also differ in lightness.
 *   The dark tints of 3.30.0-beta.6 (#353634 / #3c3431 / #3b3528) were 1.3 to
 *   2.1 apart — the lines could not be told apart without a shape.
 */
function deltaE(a: string, b: string): number {
    const p = oklab(a), q = oklab(b);
    return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The token block of a theme: `:root {` (light) or `[data-theme="dark"] {`. */
function tokens(opener: string): Record<string, string> {
    const start = html.indexOf(opener);
    expect(start).toBeGreaterThan(-1);
    const body = html.slice(start, html.indexOf('\n        }', start));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) out[m[1]] = m[2];
    return out;
}

const themes = { light: tokens(':root {'), dark: tokens('[data-theme="dark"] {') };

/**
 * The faint text on a tinted card: a theme may give the tinted card's body a
 * stronger --text-faint (`[data-theme="…"] body[data-branch-tint] … .card-body`).
 */
function cardText(theme: keyof typeof themes, token: string): string {
    if (token === '--text-faint') {
        const m = new RegExp(`\\[data-theme="${theme}"\\] body\\[data-branch-tint\\][^{]*\\.card-body \\{\\s*--text-faint:\\s*(#[0-9a-fA-F]{6})`).exec(html);
        if (m) return m[1];
    }
    return themes[theme][token];
}
const MIN_PAIR: Record<keyof typeof themes, number> = { light: 2, dark: 5 };
const MIN_CARD = 3.5;

describe('lineage tint on the card (spec 112)', () => {
    for (const [name, t] of Object.entries(themes) as [keyof typeof themes, Record<string, string>][]) {
        const tints = LINES.map(l => t[`--branch-${l}-tint`]);

        it(`${name}: every card text reaches 4.5:1 on every tint`, () => {
            for (const text of ['--text', '--text-light', '--text-faint']) {
                const color = cardText(name, text);
                expect(color, text).toBeTruthy();
                for (const [i, tint] of tints.entries()) {
                    expect(tint, LINES[i]).toBeTruthy();
                    expect(contrast(color, tint), `${text} ${color} on ${LINES[i]} ${tint}`).toBeGreaterThanOrEqual(4.5);
                }
            }
        });

        it(`${name}: a tinted card stands apart from a plain one (ΔE ≥ ${MIN_CARD})`, () => {
            for (const [i, tint] of tints.entries()) {
                expect(deltaE(tint, t['--surface']), `${LINES[i]} ${tint} vs ${t['--surface']}`).toBeGreaterThanOrEqual(MIN_CARD);
            }
        });

        it(`${name}: the three tints tell the lines apart (ΔE ≥ ${MIN_PAIR[name]})`, () => {
            for (let i = 0; i < tints.length; i++) {
                for (let j = i + 1; j < tints.length; j++) {
                    expect(deltaE(tints[i], tints[j]), `${LINES[i]} ${tints[i]} vs ${LINES[j]} ${tints[j]}`)
                        .toBeGreaterThanOrEqual(MIN_PAIR[name]);
                }
            }
        });

        it(`${name}: the tint square's frame in the line's colour stands out of the tint (3:1)`, () => {
            for (const [i, tint] of tints.entries()) {
                expect(contrast(t[`--branch-${LINES[i]}`], tint), LINES[i]).toBeGreaterThanOrEqual(3);
            }
        });
    }

    it("the image export's tints are the light theme's tokens", () => {
        for (const l of LINES) expect(BRANCH_TINT[l]).toBe(themes.light[`--branch-${l}-tint`]);
    });

    it('the square of the tint (No shape) is framed in the line\'s colour, not the hairline', () => {
        const rule = /\.branch-swatch\[data-shape="none"\] > i \{([^}]*)\}/.exec(html);
        expect(rule).not.toBeNull();
        expect(rule![1]).toMatch(/border:\s*1px solid var\(--sw\)/);
    });
});
