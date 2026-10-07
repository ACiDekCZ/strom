/**
 * Picking the app's @font-face rules for the image export (src/poster-fonts.ts, T05).
 */

import { describe, it, expect } from 'vitest';
import { pickFontFaceCss, POSTER_SERIF_FACES, POSTER_LINE_FACES } from '../poster-fonts.js';

const rule = (family: string, weight: string) => ({
    family, weight, cssText: `@font-face { font-family: ${family}; font-weight: ${weight}; src: url("data:font/woff2;base64,${family.length}${weight}"); }`,
});

describe('pickFontFaceCss', () => {
    const rules = [
        rule('"Source Serif 4"', '400'), rule('"Source Serif 4"', '600'),
        rule("'Instrument Sans'", 'normal'), rule('"Instrument Sans"', '500'), rule('"Instrument Sans"', '600'),
    ];

    it('copies only the faces asked for, in their order, quotes and "normal" understood', () => {
        const css = pickFontFaceCss(rules, [...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]);
        expect(css.split('\n')).toEqual([rules[0].cssText, rules[1].cssText, rules[2].cssText, rules[3].cssText]);
        expect(css).not.toContain(rules[4].cssText);
    });

    it('leaves out a face it cannot find and gives nothing when none is there', () => {
        expect(pickFontFaceCss(rules.slice(0, 1), POSTER_SERIF_FACES)).toBe(rules[0].cssText);
        expect(pickFontFaceCss([], POSTER_LINE_FACES)).toBe('');
    });

    it('never copies a rule that would close the SVG\'s CDATA section', () => {
        expect(pickFontFaceCss([{ ...rules[0], cssText: '@font-face { src: url("x]]>") }' }], POSTER_SERIF_FACES)).toBe('');
    });
});
