import { describe, it, expect } from 'vitest';
import { HISTORY_KINDS, type HistoryKind } from '../history';
import { HISTORY_KIND_SVG, RESEARCH_OPEN_SVG, historyKindSvg, researchOpenSvg } from '../history-symbols';

describe('history symbols', () => {
    it('every kind has its own symbol', () => {
        for (const k of HISTORY_KINDS) expect(HISTORY_KIND_SVG[k]?.d).toBeTruthy();
        expect(Object.keys(HISTORY_KIND_SVG).sort()).toEqual([...HISTORY_KINDS].sort());
        const paths = HISTORY_KINDS.map(k => HISTORY_KIND_SVG[k].d);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('is decorative: aria-hidden, no <text>, no <title>, nothing for textContent', () => {
        for (const k of HISTORY_KINDS) {
            const svg = historyKindSvg(k);
            expect(svg).toMatch(/^<svg class="hist-kind-svg" /);
            expect(svg).toContain('aria-hidden="true"');
            expect(svg).toContain('focusable="false"');
            expect(svg).not.toMatch(/<text|<title/);
            expect(svg.replace(/<[^>]+>/g, '')).toBe('');
            expect(svg).toContain(`d="${HISTORY_KIND_SVG[k].d}"`);
        }
    });

    it('draws the filled parts without a stroke', () => {
        const svg = historyKindSvg('epidemic');
        expect(svg).toContain(`<path d="${HISTORY_KIND_SVG.epidemic.fill}" fill="currentColor" stroke="none"/>`);
        expect(historyKindSvg('war').match(/<path /g)).toHaveLength(1);
    });

    it('an unknown kind draws "other"', () => {
        expect(historyKindSvg('flood' as HistoryKind)).toBe(historyKindSvg('other'));
    });

    it('the stroke is thicker at 12 px and below, the size is the given one', () => {
        expect(historyKindSvg('war', 14)).toContain('stroke-width="2"');
        expect(historyKindSvg('war', 16)).toContain('stroke-width="2"');
        expect(historyKindSvg('war', 12)).toContain('stroke-width="2.2"');
        expect(historyKindSvg('war', 12)).toContain('width="12" height="12"');
        expect(historyKindSvg('war')).toContain('width="14" height="14"');
        expect(historyKindSvg('war', 24)).toContain('viewBox="0 0 24 24"');
    });

    it('the research mark: the terminal window, decorative, same stroke rule', () => {
        const svg = researchOpenSvg(12);
        expect(svg).toMatch(/^<svg class="research-open-svg" /);
        expect(svg).toContain(`d="${RESEARCH_OPEN_SVG}"`);
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).toContain('stroke-width="2.2"');
        expect(svg).not.toMatch(/<text|<title/);
        expect(researchOpenSvg()).toContain('stroke-width="2"');
        expect(researchOpenSvg(16)).toContain('width="16" height="16"');
    });

    it('the same string is returned again (built once per kind and size)', () => {
        expect(historyKindSvg('law', 12)).toBe(historyKindSvg('law', 12));
        expect(researchOpenSvg(14)).toBe(researchOpenSvg(14));
    });
});
