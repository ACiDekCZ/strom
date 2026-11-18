/**
 * The one progress bar (waiting buttons §2.8, 2h): `barHtml` draws `.bar > i` with the share as a width (an unknown
 * share runs as `.ind`, a paused one is `.is-paused`), the stylesheet gives it 4 px, a pill and a track in the text's
 * colour at 22 %, still under reduced motion; the older bars (the batch's, the upload's, the sources' images', the
 * excerpt slot's, the surname suggestion's) are gone from the sources and the stylesheet.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { barHtml } from '../ui/prog-bar';

const SRC = join(__dirname, '..');
const INDEX = join(SRC, '..', 'index.html');

function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name !== '__tests__') out.push(...sources(path));
        } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
            out.push(path);
        }
    }
    return out;
}

const OLD_BARS = [
    'batch-bar', 'batch-progress-bytes', 'waiting-upload__bar', 'waiting-upload__fill', 'waiting-upload__progress-text',
    'sources-bulk-bar', 'viewer-excerpt-slot-bar', 'research-image-bar', 'ss-bar',
];

describe('barHtml', () => {
    it('draws the share as the width of its fill, never past the ends, hidden from a reader without its own role', () => {
        expect(barHtml(0.42)).toBe('<span class="bar" aria-hidden="true"><i style="width:42%"></i></span>');
        expect(barHtml(1.7)).toContain('width:100%');
        expect(barHtml(-1)).toContain('width:0%');
    });

    it('an unknown share runs, a paused one keeps its width, more classes and attributes as given', () => {
        expect(barHtml(null)).toBe('<span class="bar ind" aria-hidden="true"><i></i></span>');
        expect(barHtml(0.5, { paused: true })).toBe('<span class="bar is-paused" aria-hidden="true"><i style="width:50%"></i></span>');
        const own = barHtml(0.25, { cls: 'read-bar', attrs: 'role="progressbar" aria-valuenow="1"' });
        expect(own).toBe('<span class="bar read-bar" role="progressbar" aria-valuenow="1"><i style="width:25%"></i></span>');
    });
});

describe('progress bar look (2h)', () => {
    const index = readFileSync(INDEX, 'utf8');

    it('4 px, a pill, the track the text colour at 22 %; under reduced motion no transition and a still bar', () => {
        const rule = /\n\s*\.bar \{([^}]*)\}/.exec(index)?.[1] ?? '';
        expect(rule).toMatch(/height:\s*4px/);
        expect(rule).toMatch(/border-radius:\s*var\(--r-pill\)/);
        expect(rule).toMatch(/currentColor 22%/);
        const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*\.bar > i \{ transition: none; \}\s*\.bar\.ind > i \{ animation: none;/;
        expect(index).toMatch(reduced);
    });

    it('no older bar class in src/ or index.html', () => {
        const files = sources(SRC).map(path => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));
        const found: string[] = [];
        for (const name of OLD_BARS) {
            const re = new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
            if (re.test(index)) found.push(`index.html: ${name}`);
            for (const f of files) if (re.test(f.text)) found.push(`${f.path}: ${name}`);
        }
        expect(found).toEqual([]);
    });
});
