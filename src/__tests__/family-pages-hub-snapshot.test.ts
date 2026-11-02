/**
 * The hub of several lineages (`kind: 'rods'`) stays byte for byte as it was
 * before the whole tree's introduction shared its renderer (spec 026 P3
 * §1.7): digests of the hub's section in the file and in the window, two
 * languages and two privacy modes. A changed digest means a changed hub —
 * set FP_DUMP=<dir> to write the outputs for a diff.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetHtml, pageSetSectionHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

const dump = process.env.FP_DUMP;

function digest(name: string, text: string): string {
    if (dump) { mkdirSync(dump, { recursive: true }); writeFileSync(join(dump, `${name}.html`), text); }
    return `${text.length}:${createHash('sha1').update(text).digest('hex')}`;
}

/** The section of one page in the file. */
function fileSection(html: string, slug: string): string {
    const start = html.indexOf(`<section class="sp-page sp-page--hub" id="${slug}"`);
    const end = html.indexOf('<section class="sp-page', start + 10);
    return html.slice(start, end < 0 ? undefined : end);
}

describe('the hub of several lineages is unchanged', () => {
    it('file and window, cs and en, protected and full data', () => {
        const { data } = familyPagesFixture();
        const ids = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
        const out: Record<string, string> = {};
        for (const lang of ['cs', 'en'] as const) {
            for (const privacy of ['initials', 'full'] as const) {
                const set = buildPageSet(data, { kind: 'rods', rods: ids }, { lang, privacy, now: FP_NOW });
                const file = fileSection(buildPageSetHtml(set), set.introSlug);
                expect(file.length).toBeGreaterThan(100);
                out[`${lang}-${privacy}-file`] = digest(`hub-${lang}-${privacy}-file`, file);
                out[`${lang}-${privacy}-app`] = digest(`hub-${lang}-${privacy}-app`, pageSetSectionHtml(set, set.introSlug));
            }
        }
        // Two lineages: the hub with one marriage between them.
        const two = buildPageSet(data, { kind: 'rods', rods: ids.slice(0, 2) }, { lang: 'cs', now: FP_NOW });
        out['cs-two-app'] = digest('hub-cs-two-app', pageSetSectionHtml(two, two.introSlug));
        expect(out).toMatchSnapshot();
    });
});
