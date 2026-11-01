/**
 * The footers of the family pages (the window, the saved file, the set of
 * files) and of the saved person page name the Strom app as an ordinary link
 * to the website in the pages' language; no author, no script.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildPageSet } from '../family-pages.js';
import { buildPageSetFilesAsync, buildPageSetHtml, pageSetSectionHtml } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { websiteUrl } from '../about-links.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageOptions, buildPersonPageDocument, createdWithStromHtml, preparePersonPageData,
} from '../person-page.js';
import { Language, setLanguage } from '../strings.js';
import { StromData } from '../types.js';
import { familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

afterEach(() => setLanguage('cs'));

const link = (lang: Language) => `<a class="pp-site" href="${websiteUrl(lang)}" rel="noopener noreferrer" target="_blank">Strom</a>`;

function set(data: StromData, lang: Language) {
    const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
    return buildPageSet(data, { kind: 'rods', rods: [rodIds[0]] }, { lang, now: FP_NOW });
}

/** The footers of a document. */
const footers = (html: string) => [...html.matchAll(/<footer class="(?:sp|pp)-foot">[\s\S]*?<\/footer>/g)].map(m => m[0]);

describe('the footer\'s link to the website', () => {
    it('leads to the site in the pages\' language: Czech and German paths, English at the root', () => {
        expect(websiteUrl('cs')).toBe('https://stromapp.info/cs/');
        expect(websiteUrl('de')).toBe('https://stromapp.info/de/');
        expect(websiteUrl('en')).toBe('https://stromapp.info/');
    });

    it('is the app\'s name inside the footer\'s sentence, in every language', () => {
        expect(createdWithStromHtml('cs', '1. 11. 2026')).toBe(`Vytvořeno v aplikaci ${link('cs')} · 1. 11. 2026`);
        expect(createdWithStromHtml('en', '1 Nov 2026')).toBe(`Created with the ${link('en')} app · 1 Nov 2026`);
        expect(createdWithStromHtml('de', '1.11.2026')).toBe(`Erstellt mit der App ${link('de')} · 1.11.2026`);
    });

    it('the family pages\' file: every page\'s footer carries it', () => {
        const { data } = familyPagesFixture();
        for (const lang of ['cs', 'en', 'de'] as const) {
            const html = buildPageSetHtml(set(data, lang));
            const own = footers(html).filter(f => f.startsWith('<footer class="sp-foot">'));
            expect(own.length).toBeGreaterThan(0);
            for (const f of own) expect(f).toContain(link(lang));
        }
    });

    it('the window\'s page and the set of files: the same link', async () => {
        const { data } = familyPagesFixture();
        const s = set(data, 'de');
        expect(pageSetSectionHtml(s, s.introSlug)).toContain(`<footer class="sp-foot"><p>Erstellt mit der App ${link('de')}`);
        const files = await buildPageSetFilesAsync(s);
        const html = files.find(e => e.path === 'index.html')!.data as string;
        expect(html).toContain(`<footer class="sp-foot"><p>Erstellt mit der App ${link('de')}`);
    });

    it('the saved person page\'s footer', () => {
        const { data, ids } = familyPagesFixture();
        const op: PersonPageOptions = {
            personId: ids.josef, lang: 'en', mode: 'file', links: 'plain', groups: { ...PERSON_PAGE_ALL_GROUPS },
            privacy: 'full', toggles: { history: true, childEvents: true }, research: false, now: FP_NOW,
        };
        const html = buildPersonPageDocument(preparePersonPageData(data, op), op);
        expect(footers(html)).toEqual([expect.stringContaining(`Created with the ${link('en')} app`)]);
    });
});
