/**
 * UI texts end with the ellipsis character ("Merge with…"), never with three
 * dots: in every language's strings, in the labels built from them in the UI
 * code and in the page's own markup. The debug panel is not a UI text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const THREE_DOTS = /[\p{L}}]\.\.\.['"`<]|'\.\.\.'|>\.\.\.</u;
const NOT_UI = new Set(['src/debug-panel.ts']);

function sources(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap(name => {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) return name === '__tests__' ? [] : sources(rel);
        return rel.endsWith('.ts') && !NOT_UI.has(rel) ? [rel] : [];
    });
}

describe('UI texts use the ellipsis character', () => {
    it('no label, placeholder or string ends with three dots', () => {
        const hits = [...sources('src'), 'index.html'].flatMap(rel =>
            readFileSync(join(ROOT, rel), 'utf8').split('\n')
                .map((line, i) => ({ line: line.trim(), at: `${rel}:${i + 1}` }))
                .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && THREE_DOTS.test(line))
                .map(({ line, at }) => `${at}: ${line}`));
        expect(hits).toEqual([]);
    });
});
