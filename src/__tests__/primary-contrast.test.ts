/**
 * Text on the green primary fill (main buttons, active segments, badges) must
 * reach WCAG AA 4.5:1 in the light and the dark theme. The pair lives in two
 * tokens (--primary, --on-primary); every rule that paints text on a
 * --primary fill takes its colour from --on-primary, so one token decides it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');

function luminance(hex: string): number {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
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

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name !== '__tests__') out.push(...sourceFiles(p));
        } else if (name.endsWith('.ts')) out.push(p);
    }
    return out;
}

describe('text on the primary fill', () => {
    const themes = { light: tokens(':root {'), dark: tokens('[data-theme="dark"] {') };

    for (const [name, t] of Object.entries(themes)) {
        it(`${name}: --on-primary on --primary and on its hover reaches 4.5:1`, () => {
            expect(t['--primary'] && t['--on-primary'] && t['--primary-dark']).toBeTruthy();
            expect(contrast(t['--on-primary'], t['--primary'])).toBeGreaterThanOrEqual(4.5);
            expect(contrast(t['--on-primary'], t['--primary-dark'])).toBeGreaterThanOrEqual(4.5);
        });
    }

    it('the measured ratios stay where they are documented', () => {
        // Light 6.13:1 (white on #3f6b4f), dark 5.58:1 (#1c1a15 on #6f9c7f).
        expect(contrast(themes.light['--on-primary'], themes.light['--primary'])).toBeCloseTo(6.13, 1);
        expect(contrast(themes.dark['--on-primary'], themes.dark['--primary'])).toBeCloseTo(5.58, 1);
    });

    it('every rule with text on a --primary fill takes --on-primary', () => {
        const fill = /background(?:-color)?\s*:\s*var\(--primary(?:-dark)?(?:,[^)]*)?\)/g;
        const offenders: string[] = [];
        const files = [join(root, 'index.html'), ...sourceFiles(join(root, 'src'))];
        for (const file of files) {
            const s = readFileSync(file, 'utf8');
            if (!s.includes('--primary')) continue;
            for (const m of s.matchAll(fill)) {
                const a = s.lastIndexOf('{', m.index);
                const b = s.indexOf('}', m.index);
                if (a < 0 || b < 0 || b - a > 3000) continue;
                const body = s.slice(a + 1, b);
                const color = /(?:^|[;\s{"'])color\s*:\s*([^;}"']+)/.exec(body)?.[1].trim();
                if (!color || color.includes('--on-primary')) continue;
                // A decorative dot painted in its own colour carries no text.
                if (color === 'var(--primary)') continue;
                const line = s.slice(0, m.index).split('\n').length;
                offenders.push(`${file.replace(root, '')}:${line} color: ${color}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
