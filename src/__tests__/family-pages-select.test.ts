/**
 * Pages of chosen people and a line of ancestors (1102 step B, §4.1–§4.3):
 * the selection of chosen people (families only of two chosen partners), its
 * introduction grouped by line, a parent not chosen as plain text, the file
 * name without names; the ancestors' slots in Kekulé order, the page with
 * the known count, the muted missing ancestor, the folded generation and the
 * file name of a protected starting person.
 */

import { describe, it, expect } from 'vitest';
import { PageSet, buildPageSet, pageSetFileName } from '../family-pages.js';
import { buildPageSetHtml, renderPage } from '../family-pages-html.js';
import { ancestorCount, ancestorSlots, buildLineages, selection } from '../lineage.js';
import { rodPickKey } from '../rod-picker.js';
import { PersonId, StromData } from '../types.js';
import { ancestorsFixture, treePagesFixture, TP_NOW } from './helpers/tree-pages-fixture.js';

function plain(html: string): string {
    return rodPickKey(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' '));
}

function personsSet(data: StromData, ids: PersonId[], extra: Partial<Parameters<typeof buildPageSet>[2]> = {}): PageSet {
    return buildPageSet(data, { kind: 'persons', ids }, { lang: 'cs', now: TP_NOW, ...extra }, { treeName: 'Rodokmen z Lopuchova' });
}

/** Twelve people: three couples (Václav ⚭ Marie, Jan ⚭ Rosálie, Anna ⚭ William) and six without their partner. */
function twelve(): { data: StromData; ids: PersonId[]; f: ReturnType<typeof treePagesFixture> } {
    const f = treePagesFixture();
    const i = f.ids;
    const ids = [i.vaclav, i.marie, i.jan, i.rosalie, i.anna, i.william, i.jiri, i.eva, i.matej, i.petr, i.jakubZ, i.bartolomej];
    return { data: f.data, ids, f };
}

describe('chosen people (§4.1, §4.2)', () => {
    it('the selection keeps the chosen people and only the families of two chosen partners', () => {
        const { data, ids, f } = twelve();
        const sel = selection(buildLineages(data), { kind: 'persons', personIds: ids });
        expect(new Set(sel.personIds)).toEqual(new Set(ids));
        expect(new Set(sel.familyIds)).toEqual(new Set([f.unions.vaclavMarie, f.unions.janRosalie, f.unions.annaWilliam]));
        expect(sel.spouseIds).toEqual([]);
    });

    it('twelve people: three families with a page, no line pages, the introduction grouped by line', () => {
        const { data, ids, f } = twelve();
        const set = personsSet(data, ids);
        expect(set.familySlug.size).toBe(3);
        expect([...set.familySlug.keys()].sort()).toEqual([f.unions.vaclavMarie, f.unions.janRosalie, f.unions.annaWilliam].sort());
        expect(set.pages.filter(p => p.kind === 'rod')).toHaveLength(0);
        const intro = set.bySlug.get(set.introSlug)!;
        expect(intro.kind).toBe('persons');
        expect(intro.title).toBe('Vybrané osoby');
        const html = renderPage(set, set.introSlug);
        expect(html).toContain('class="sp-page sp-page--persons"');
        const text = plain(html);
        expect(text).toContain('vyber osob');
        expect(text).toContain('rodokmenu rodokmen z lopuchova');
        expect(text).toContain('3 rodiny');
        // Groups by line: the Lhoták line first (the tree's order), "Other families" last.
        expect(html).toMatch(/<h2 class="sp-sel-h">Rod Lhoták[^<]* · \d+ osob/);
        expect(html.lastIndexOf('class="sp-sel-h"')).toBe(html.indexOf('class="sp-sel-h">Další rodiny'));
        // Marie married into the Lhoták line: her row says so.
        expect(text).toContain('manzelka v rodu lhotak');
        // The families with a page, with the note.
        expect(count(html, /class="sp-cross-row"/g)).toBe(3);
        expect(text).toContain('stranku ma rodina, kdyz jsou vybrani oba partneri');
        // The protected living Petr has no page and is not listed.
        expect(set.personSlug.has(f.ids.petr)).toBe(false);
        expect(text).not.toContain('petr lhotak');
    });

    it('a parent not chosen stays plain text on the person page', () => {
        const { data, ids, f } = twelve();
        const set = personsSet(data, ids);
        const html = renderPage(set, set.personSlug.get(f.ids.matej)!);
        // Matěj's father Jakub is chosen (a link), his mother Rosálie Kvapilová is not (her name without a link).
        expect(html).toContain(`data-sp-open="person:${f.ids.jakubZ}"`);
        expect(html).not.toContain(`data-sp-open="person:${f.ids.rosalieK}"`);
        expect(plain(html)).toContain('rosalie kvapilova');
    });

    it('the file is named Vybrane-osoby.html, never after a person', () => {
        const { data, ids } = twelve();
        expect(pageSetFileName(personsSet(data, ids))).toBe('Vybrane-osoby.html');
        expect(pageSetFileName(personsSet(data, ids, { lang: 'en' }))).toBe('Selected-people.html');
        expect(pageSetFileName(personsSet(data, ids, { privacy: 'full' }))).toBe('Vybrane-osoby.html');
    });

    it('the file\'s contents start with the introduction of chosen people', () => {
        const { data, ids } = twelve();
        const html = buildPageSetHtml(personsSet(data, ids));
        expect(html).toContain('data-sp-intro');
        expect(html).toMatch(/<section class="sp-page sp-page--persons" id="uvod"/);
    });
});

describe('a line of ancestors (§4.3)', () => {
    it('the slots in Kekulé order: 2 + 4 + 7 + 13 = 26 known of 30', () => {
        const { data, petr } = ancestorsFixture();
        const gens = ancestorSlots(data, petr, 4);
        expect(gens.map(g => g.length)).toEqual([1, 2, 4, 7, 13]);
        expect(gens[3].map(a => a.k)).toEqual([8, 9, 10, 11, 12, 13, 14]);
        expect(gens[4].some(a => a.k === 29 || a.k === 30 || a.k === 31)).toBe(false);
        expect(ancestorCount(data, petr, 4)).toEqual({ known: 26, total: 30, generations: 4 });
        expect(ancestorCount(data, petr, 2)).toEqual({ known: 6, total: 6, generations: 2 });
        // All generations: as deep as someone is known.
        expect(ancestorCount(data, petr).generations).toBe(4);
    });

    it('four generations of the living Petr: Predci.html, 26 known, "neuvedena" in generation IV, generation V folded', () => {
        const { data, petr } = ancestorsFixture();
        const set = buildPageSet(data, { kind: 'ancestors', person: petr, generations: 4 }, { lang: 'cs', now: TP_NOW });
        expect(pageSetFileName(set)).toBe('Predci.html');
        const intro = set.bySlug.get(set.introSlug)!;
        expect(intro.kind).toBe('ancestors');
        const html = renderPage(set, set.introSlug);
        const text = plain(html);
        expect(text).toContain('4 generace predku');
        expect(text).toContain('26 znamych ze 30');
        expect(text).toContain('nejstarsi 1851');
        const gens = html.split('<section class="sp-anc-gen">').slice(1);
        expect(gens).toHaveLength(5);
        expect(gens[0]).toContain('<span class="sp-roman">I</span>');
        expect(plain(gens[1])).toContain('rodice');
        expect(plain(gens[1])).toContain('2 ze 2');
        expect(plain(gens[3])).toContain('7 z 8');
        expect(gens[3]).toContain('neuvedena');
        expect(plain(gens[3])).toContain('matka · matka matky neuvedena');
        // Generation V: 16 places → folded; the mother of Ondřej shown as missing, the parents of the missing one not.
        expect(gens[4]).toContain('<details class="sp-anc-more" open>');
        expect(count(gens[4], /sp-anc-row--none/g)).toBe(1);
        expect(plain(gens[4])).toContain('zobrazit 14 osob');
        expect(gens[3]).not.toContain('<details');
        // The protected starting person's name stays out of the title and the file name.
        expect(intro.title).not.toContain('Petr');
        expect(set.pages.filter(p => p.kind === 'family').length).toBeGreaterThan(0);
    });

    it('a starting person not protected names the file; the default depth is four', () => {
        const { data, ondrej } = ancestorsFixture();
        const set = buildPageSet(data, { kind: 'ancestors', person: ondrej }, { lang: 'cs', now: TP_NOW });
        expect(pageSetFileName(set)).toBe('Predci-Ondrej-Salvej.html');
        expect(set.spec.kind === 'ancestors' && set.spec.generations).toBe(4);
        const html = renderPage(set, set.introSlug);
        // Ondřej's father is known, his mother not: "neuvedena" in generation II.
        expect(html).toContain('neuvedena');
        expect(plain(html)).toContain('karel salvej');
    });

    it('the English page: "Ancestors of", the relation as "father’s mother"', () => {
        const { data, petr } = ancestorsFixture();
        const set = buildPageSet(data, { kind: 'ancestors', person: petr, generations: 3 }, { lang: 'en', now: TP_NOW, privacy: 'full' });
        expect(pageSetFileName(set)).toBe('Ancestors.html');
        const html = renderPage(set, set.introSlug);
        expect(html).toContain('Ancestors of Petr Lhoták');
        expect(html).toContain('father’s mother');
    });
});

function count(html: string, re: RegExp): number {
    return (html.match(re) ?? []).length;
}
