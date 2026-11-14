/**
 * The whole tree's pages (spec 026 P3 step A): the introduction (cards up to
 * twelve lines, rows from thirteen), "Other families" (the small lines with
 * an unprotected member), the breadcrumbs through the line of a person, the
 * protection of the living in the indexes, the search and the file names,
 * the choice of a line (its items, the file's `<details>`), the marriages
 * between lines, and the window's lazy pages.
 */

import { describe, it, expect } from 'vitest';
import { PageSet, buildPageSet } from '../family-pages.js';
import {
    HUB_ROWS_FROM, RENDER_PAGE_CACHE, buildPageSetFilesAsync, buildPageSetHtml, pageSetRenderedPages, renderPage, renderPageBar,
} from '../family-pages-html.js';
import { buildLineages, rodOfPersonForCrumbs, rods } from '../lineage.js';
import { sortRods } from '../rods-overview.js';
import { rodPickKey, rodPickerItems, rodPickerHtml } from '../rod-picker.js';
import { PersonId, StromData } from '../types.js';
import { manyLinesFixture, treePagesFixture, TP_NOW } from './helpers/tree-pages-fixture.js';

function treeSet(data: StromData, extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    return buildPageSet(data, { kind: 'tree' }, { lang: 'cs', now: TP_NOW, ...extra }, { treeName: 'Rodokmen z Lopuchova' });
}

function introHtml(set: PageSet): string {
    return renderPage(set, set.introSlug);
}

function count(html: string, re: RegExp): number {
    return (html.match(re) ?? []).length;
}

/** The text of the markup, lower case, without diacritics. */
function plain(html: string): string {
    return rodPickKey(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' '));
}

function crumbLabels(set: PageSet, id: PersonId): string[] {
    return set.bySlug.get(set.personSlug.get(id) ?? '')?.crumbs.map(c => c.label) ?? [];
}

describe('the whole tree\'s introduction (§1)', () => {
    it('eight lines are cards with "Other families" last; the sorting keys of size, age and name', () => {
        const set = treeSet(treePagesFixture().data);
        expect(set.rodIds).toHaveLength(8);
        const html = introHtml(set);
        expect(html).toContain('class="sp-page sp-page--tree"');
        expect(html).toContain('<div class="sp-cards sp-sortable">');
        expect(count(html, /class="sp-card"/g)).toBe(8);
        expect(count(html, /class="sp-card sp-card--other"/g)).toBe(1);
        expect(html).not.toContain('sp-rrows');
        // The other families' card after the lines; every line card carries its three ranks.
        expect(html.indexOf('sp-card--other')).toBeGreaterThan(html.lastIndexOf('data-sp-o='));
        expect(count(html, /data-sp-o="\d+ \d+ \d+"/g)).toBe(8);
        expect(html).toContain('data-sp-sort="0" aria-checked="true"');
        // Counts: people, lines, families.
        expect(html).toMatch(/<p class="sp-sub sp-counts"><span>1760–\d{4}<\/span>/);
        expect(plain(html)).toContain('8 rodu');
        // The main places: the dot stays at the end of the line with the place before it, never starting a line.
        const main = html.slice(html.indexOf('<p class="sp-mainpl">'), html.indexOf('</p>', html.indexOf('<p class="sp-mainpl">')));
        expect(main).toContain('<span class="sp-sep" aria-hidden="true">·</span>');
        expect(main).not.toMatch(/ <span class="sp-sep"/);
        expect(count(main, /\u00a0<span class="sp-sep"/g)).toBe(count(main, /class="sp-sep"/g));
    });

    it(`${HUB_ROWS_FROM} and more lines are rows (sixty: the first twenty, then "Show all 60")`, () => {
        const set = treeSet(manyLinesFixture(60));
        expect(set.rodIds).toHaveLength(60);
        const html = introHtml(set);
        expect(html).toContain('class="sp-rods sp-rods--rows"');
        expect(count(html, /<li class="sp-rrow"/g)).toBe(60);
        expect(html).toContain('data-sp-cut="20"');
        expect(html).toContain('data-sp-shown="20"');
        expect(html).not.toContain('class="sp-card"');
        // Without the script every row is there (no `hidden` in the markup).
        expect(html).not.toMatch(/<li class="sp-rrow"[^>]*hidden/);
    });

    it('the marriages between lines grouped by pairs: the first open, the rest folded by the script; all of them in the index of families', () => {
        const set = treeSet(treePagesFixture().data);
        const html = introHtml(set);
        expect(html).toContain('<section class="sp-pairs">');
        const pairs = html.match(/<span class="sp-pair-n">([^<]+)<\/span>/g) ?? [];
        expect(pairs.length).toBe(6);
        expect(count(html, /data-sp-fold/g)).toBe(5);
        expect(html).toContain('Fíšek · Lhoták (Lopuchov)');
        expect(html).toContain('Lhoták (Lopuchov) · Thornbury');
        const fams = renderPage(set, set.indexSlug.families);
        expect(fams).toContain(`id="${set.indexSlug.families}--mezi-rody"`);
        // A small line's marriage (Žbánek ⚭ Kvapilová) is not between two lines of the tree.
        expect(html).not.toContain('Žbánek');
    });
});

describe('"Other families" (§1.4, §6.3)', () => {
    it('13 small lines under the default protection (the Brambůrek line has only the living), 14 with full data', () => {
        const { data } = treePagesFixture();
        const shielded = treeSet(data);
        const full = treeSet(data, { privacy: 'full' });
        expect(shielded.otherRodIds).toHaveLength(13);
        expect(full.otherRodIds).toHaveLength(14);
        expect(plain(renderPage(shielded, shielded.otherSlug))).not.toContain('brambur');
        expect(plain(renderPage(full, full.otherSlug))).toContain('brambur');
    });

    it('a block per small line with its anchor, the people without a surname last, the letters leading to the blocks', () => {
        const { data, ids } = treePagesFixture();
        const set = treeSet(data);
        expect(set.otherPersonIds.sort()).toEqual([ids.anezka, ids.bartolomej].sort());
        const page = buildPageSetHtml(set).split('<section class="sp-page ').find(s => s.includes(`id="${set.otherSlug}"`))!;
        expect(count(page, /<section class="sp-ofam" id="/g)).toBe(13);
        expect(page).toContain(`id="${set.otherSlug}--zbanek"`);
        expect(page).toContain(`id="${set.otherSlug}--bez-prijmeni"`);
        expect(page).toContain(`<a class="sp-letter" href="#${set.otherSlug}--zbanek">Ž</a>`);
        // Jakub Žbánek's marriage names his wife of the Kvapil line and leads to the family.
        expect(page).toMatch(/Jakub Žbánek[\s\S]{0,300}<span class="sp-ofam-u"><span class="sp-sym">⚭<\/span> 1815 <a [^>]*>Rosálie Kvapilová<\/a>/);
    });
});

describe('breadcrumbs through the line (§2.1)', () => {
    it('Marie Fíšková (married surname Lhotáková) through Lhoták (Lopuchov) › Václav a Marie', () => {
        const { data, ids } = treePagesFixture();
        const set = treeSet(data);
        expect(crumbLabels(set, ids.marie)).toEqual(['Strom', 'Rod Lhoták (Lopuchov)', 'Václav a Marie', 'Marie Lhotáková']);
        expect(rodOfPersonForCrumbs(buildLineages(data), ids.marie).rodId).toBe(set.bySlug.get(set.personSlug.get(ids.vaclav)!)!.under);
    });

    it('Anna Lhotáková married elsewhere (no married surname) stays under her line, through Jan a Rosálie', () => {
        const { data, ids } = treePagesFixture();
        expect(crumbLabels(treeSet(data), ids.anna)).toEqual(['Strom', 'Rod Lhoták (Lopuchov)', 'Jan a Rosálie', 'Anna Lhotáková']);
    });

    it('Matěj Žbánek of a small line through "Other families"; the person page\'s Rod row leads to his block there', () => {
        const { data, ids } = treePagesFixture();
        const set = treeSet(data);
        expect(crumbLabels(set, ids.matej)).toEqual(['Strom', 'Další rodiny', 'Jakub a Rosálie', 'Matěj Žbánek']);
        const page = renderPage(set, set.personSlug.get(ids.matej)!);
        expect(page).toContain(`data-sp-open="page:${set.otherSlug}"`);
        expect(page).toContain('Další rodiny · Žbánek');
    });

    it('a line\'s, a family\'s and an index page start with the tree; the picker\'s line follows the breadcrumbs', () => {
        const { data, ids, unions } = treePagesFixture();
        const set = treeSet(data);
        const rodPage = set.pages.find(p => p.kind === 'rod')!;
        expect(rodPage.crumbs.map(c => c.slug)).toEqual([set.introSlug, rodPage.slug]);
        const fam = set.bySlug.get(set.familySlug.get(unions.annaWilliam)!)!;
        expect(fam.crumbs[0].slug).toBe(set.introSlug);
        expect(set.bySlug.get(set.indexSlug.persons)!.crumbs[0].label).toBe('Strom');
        expect(set.bySlug.get(set.personSlug.get(ids.matej)!)!.under).toBe('other');
        expect(set.bySlug.get(set.introSlug)!.under).toBeUndefined();
    });
});

describe('protection of the living in the whole tree (§6)', () => {
    it('neither the search index nor the indexes nor the introduction name Brambůrek, Petr Lhoták or Eva', async () => {
        const set = treeSet(treePagesFixture().data);
        const texts = [
            rodPickKey(JSON.stringify(set.searchIndex)),
            ...(['persons', 'families', 'surnames', 'places'] as const).map(k => plain(renderPage(set, set.indexSlug[k]))),
            plain(introHtml(set)), plain(renderPage(set, set.otherSlug)),
        ];
        for (const text of texts) {
            expect(text).not.toContain('brambur');
            expect(text).not.toContain('petr lhotak');
            expect(text).not.toMatch(/\beva\b/);
        }
        const files = await buildPageSetFilesAsync(set);
        for (const f of files) {
            expect(f.path).not.toMatch(/brambur|petr-lhotak|(^|[-/])eva[-.]/);
        }
    });

    it('full data names them (the window\'s set)', () => {
        const set = treeSet(treePagesFixture().data, { privacy: 'full' });
        expect(rodPickKey(JSON.stringify(set.searchIndex))).toContain('petr lhotak');
    });
});

describe('the choice of a line (§2.3)', () => {
    it('items: the whole tree first, the lines largest first, "Other families" last with the count of the small lines', () => {
        const { data } = treePagesFixture();
        const set = treeSet(data);
        const items = rodPickerItems(set.protectedTree.lineages, set);
        expect(items[0].id).toBe('tree');
        expect(items[0].slug).toBe(set.introSlug);
        expect(items.slice(1, -1).map(i => i.id)).toEqual(set.rodIds);
        // The set's lines in the tree overview's size order (1102 N1).
        const lin = set.protectedTree.lineages;
        expect(set.rodIds).toEqual(sortRods(rods(lin).filter(r => !r.small), 'size', set.protectedTree.rodLabels, 'cs').map(r => r.id));
        expect(items[1].label).toBe('Lhoták (Lopuchov)');
        expect(items[1].members).toBeGreaterThan(items[2].members - 1);
        expect(items[items.length - 1]).toMatchObject({ id: 'other', members: 13, slug: set.otherSlug });
        // Without a set: the tree's lines.
        const bare = rodPickerItems(buildLineages(data));
        expect(bare.filter(i => i.id !== 'tree' && i.id !== 'other')).toHaveLength(rods(buildLineages(data)).filter(r => !r.small).length);
        expect(rodPickKey('  Hrnčířík  (Zálesí) ')).toBe('hrncirik (zalesi)');
    });

    it('the markup: a <details> with the current line marked and the search field for the script only', () => {
        const set = treeSet(treePagesFixture().data);
        const items = rodPickerItems(set.protectedTree.lineages, set);
        const html = rodPickerHtml({
            items, current: set.rodIds[1], treeTitle: 'T', lo: 1700, hi: 2030,
            texts: { prefix: 'Rod', all: 'Rody', wholeTree: 'Celý strom', other: 'Další rodiny', placeholder: 'Hledat', none: 'Nic', label: 'Volba', members: n => `${n}` },
            link: (item, inner, cls) => `<a class="${cls}" href="#${item.slug}">${inner}</a>`,
        });
        expect(html.startsWith('<details class="sp-rodpick"')).toBe(true);
        expect(html).toContain('<div class="sp-rodpick-f js-only">');
        expect(count(html, /aria-current="true"/g)).toBe(1);
        expect(html).toContain(`<span class="sp-rodpick-v">Rod <b>${items[2].label}</b></span>`);
    });

    it('the single file\'s bar has the choice; a page of a line marks it', () => {
        const set = treeSet(treePagesFixture().data);
        const bar = renderPageBar(set, set.rodSlug.get(set.rodIds[0])!);
        expect(bar).toContain('sp-fbar--tree sp-fbar--rod');
        expect(bar).toContain('<details class="sp-rodpick"');
        expect(bar).toContain(`data-sp-open="page:${set.otherSlug}"`);
        expect(renderPageBar(set, set.introSlug)).not.toContain('sp-fbar--rod');
    });

    it('the set of files: the bar without the script (sp-zip), the choice as links to the files', async () => {
        const set = treeSet(treePagesFixture().data);
        const files = await buildPageSetFilesAsync(set);
        const index = String(files.find(f => f.path === 'index.html')!.data);
        expect(index).toContain('<html lang="cs" class="no-js sp-zip">');
        expect(index).toContain("document.documentElement.className='js sp-zip'");
        const rodFile = `rody/${set.rodSlug.get(set.rodIds[0])}.html`;
        expect(index).toContain(`<a class="sp-rodpick-a" href="${rodFile}">`);
        expect(index).toContain(`href="rody/${set.otherSlug}.html"`);
        const rod = String(files.find(f => f.path === rodFile)!.data);
        // From a page in a folder the choice leads one folder up and back (1102 §7.5).
        expect(rod).toContain(`href="../rody/${set.otherSlug}.html"`);
        expect(rod).toMatch(/<li class="sp-rodpick-rod sel-opt is-cur" data-sel-form="row" data-rod="[^"]+" data-q="[^"]+" aria-current="true">/);
        // A lineages' set keeps its bar for the script only.
        const lines = buildPageSet(treePagesFixture().data, { kind: 'rods', rods: set.rodIds.slice(0, 2) }, { lang: 'cs', now: TP_NOW });
        const linesIndex = String((await buildPageSetFilesAsync(lines)).find(f => f.path === 'index.html')!.data);
        expect(linesIndex).toContain('class="no-js"');
        expect(linesIndex).not.toContain('sp-rodpick');
    });
});

describe('the window\'s lazy pages (§3.3)', () => {
    it('renderPage draws a page once and keeps the last ones; an unknown slug is empty', () => {
        const set = treeSet(treePagesFixture().data, { privacy: 'full' });
        const slugs = pageSetRenderedPages(set).map(p => p.slug);
        expect(slugs.length).toBeGreaterThan(RENDER_PAGE_CACHE);
        const first = renderPage(set, slugs[0]);
        expect(renderPage(set, slugs[0])).toBe(first);
        for (const s of slugs.slice(1, RENDER_PAGE_CACHE + 5)) expect(renderPage(set, s)).not.toBe('');
        // Evicted, drawn again: the same markup.
        expect(renderPage(set, slugs[0])).toBe(first);
        expect(renderPage(set, 'nic-takoveho')).toBe('');
        // The window's markup: buttons, no anchors to the file's pages.
        expect(first).toContain('data-sp-open="');
        expect(first).not.toContain('href="#');
    });
});
