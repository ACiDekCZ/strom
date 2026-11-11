/**
 * The person page and the family book stay byte for byte as they were when
 * the family pages (spec 026) shared their blocks: digests of whole outputs
 * (every person of two trees, file and window, a set's links, two privacy
 * modes; books of lineages and of a branch). A changed digest means a
 * changed page — set FP_DUMP=<dir> to write the outputs for a diff. The
 * saved person page's inline scripts are left out of its digest (they serve
 * a set of pages too and are checked in the browser), its markup is whole.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageOptions, buildPersonPageBody, buildPersonPageDocument, preparePersonPageData, protectPersonPageTree,
} from '../person-page.js';
import { buildFamilyBook } from '../book.js';
import { buildLineages, rods } from '../lineage.js';
import { getDemoTree } from '../demo-tree.js';
import { PrivacyMode } from '../privacy.js';
import { PersonId, StromData } from '../types.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

const dump = process.env.FP_DUMP;

function digest(name: string, text: string): string {
    if (dump) { mkdirSync(dump, { recursive: true }); writeFileSync(join(dump, `${name}.html`), text); }
    return `${text.length}:${createHash('sha1').update(text).digest('hex')}`;
}

/** A saved page without the contents of its inline scripts. */
function withoutScripts(html: string): string {
    return html.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>');
}

function opts(personId: PersonId, privacy: PrivacyMode, mode: 'app' | 'file', set?: ReadonlySet<PersonId>): PersonPageOptions {
    return {
        personId, lang: 'cs', mode, links: set ? 'set' : mode === 'app' ? 'app' : 'plain', ...(set ? { setMembers: set } : {}),
        groups: { ...PERSON_PAGE_ALL_GROUPS }, privacy, toggles: { history: true, childEvents: true }, research: false, now: FP_NOW, toc: true,
    };
}

function personPages(tag: string, data: StromData): Record<string, string> {
    const out: Record<string, string> = {};
    const all = new Set(Object.keys(data.persons) as PersonId[]);
    for (const privacy of ['full', 'initials'] as const) {
        const prot = protectPersonPageTree(data, privacy, FP_NOW);
        for (const id of [...all].sort()) {
            const file = opts(id, privacy, 'file', all);
            const page = preparePersonPageData(data, file, { protected: prot });
            out[`${tag}-${privacy}-${id}-file`] = digest(`${tag}-${privacy}-${id}-file`, withoutScripts(buildPersonPageDocument(page, file)));
            if (privacy === 'full') {
                const app = opts(id, privacy, 'app');
                const appPage = preparePersonPageData(data, app, { protected: prot });
                out[`${tag}-${id}-app`] = digest(`${tag}-${id}-app`, buildPersonPageBody(appPage, app));
                const plain = opts(id, privacy, 'file');
                out[`${tag}-${id}-plain`] = digest(`${tag}-${id}-plain`, withoutScripts(buildPersonPageDocument(preparePersonPageData(data, plain, { protected: prot }), plain)));
            }
        }
    }
    return out;
}

/** A safety net for a loaded machine (the full suite with other runs beside it); the tests check no time. */
const LOADED_TIMEOUT = { timeout: 60_000 };

describe('outputs unchanged by the family pages', LOADED_TIMEOUT, () => {
    it('person pages of the sample tree', () => {
        expect(personPages('fp', familyPagesFixture().data)).toMatchSnapshot();
    });

    it('person pages of the demo tree', () => {
        expect(personPages('demo', getDemoTree())).toMatchSnapshot();
    });

    it('family books of the sample tree', () => {
        const { data, ids } = familyPagesFixture();
        const index = buildLineages(data);
        const rodIds = rods(index).filter(r => !r.small).map(r => r.id);
        const env = { now: FP_NOW, dateLabel: 'sestaveno 29. 10. 2026' };
        expect({
            rods: digest('book-rods', buildFamilyBook(data, { lang: 'cs', selection: { kind: 'rods', rods: rodIds }, detail: 'all' }, env)),
            rodsSave: digest('book-rods-save', buildFamilyBook(data, { lang: 'de', selection: { kind: 'rods', rods: rodIds.slice(0, 1) } }, { ...env, forSave: true })),
            branch: digest('book-branch', buildFamilyBook(data, { lang: 'en', selection: { kind: 'descendants', person: ids.josef }, privacy: 'full' }, env)),
            demo: digest('book-demo', buildFamilyBook(getDemoTree(), { lang: 'cs' }, env)),
        }).toMatchSnapshot();
    });
});
