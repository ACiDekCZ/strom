/**
 * Every element id written in the page template appears once: two elements
 * with one id (the import dialog's tree-name field and the view-mode import
 * dialog's tree name) made getElementById pick whichever came first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('index.html element ids', () => {
    it('no id is used by two elements', () => {
        const counts = new Map<string, number>();
        for (const m of html.matchAll(/<[a-zA-Z][^>]*?\sid="([^"]+)"/g)) {
            counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
        }
        expect(counts.size).toBeGreaterThan(100);
        const duplicates = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
        expect(duplicates).toEqual([]);
    });
});
