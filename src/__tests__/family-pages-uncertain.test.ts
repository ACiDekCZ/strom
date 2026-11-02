/**
 * Surnames with an unreadable place of a transcription in the tree pages'
 * indexes (1102): a surname of "[?]" alone stands without a surname, one that
 * starts with "[?]" goes to the uncertain readings ("?") after the letters,
 * the index opens on the first real letter and "[?]" gets no feminine form.
 * Invented names on the synthetic tree.
 */

import { describe, it, expect } from 'vitest';
import {
    INDEX_UNCERTAIN, PageSet, buildPageSet, familyIndexLetter, indexLetter, isGapOnlyName, personIndexLetter, personIndexSort,
} from '../family-pages.js';
import { pageSetSectionHtml } from '../family-pages-html.js';
import { feminineForm } from '../surnames.js';
import { Person, StromData } from '../types.js';
import { syntheticTree } from './helpers/synthetic-tree.js';

const NOW = new Date(2026, 10, 2);

function treeSet(data: StromData): PageSet {
    return buildPageSet(data, { kind: 'tree' }, { lang: 'cs', now: NOW });
}

/** A synthetic tree whose some surnames are "[?]", "[?]o[?]ral" or "[?]ebrouch" (invented). */
function gapTree(persons: number, founders?: number): StromData {
    const { data } = syntheticTree(founders ? { persons, founders } : { persons });
    const ps = Object.values(data.persons) as Person[];
    ps.forEach((p, i) => {
        if (i % 13 === 0) p.lastName = '[?]';
        else if (i % 17 === 0) p.lastName = '[?]o[?]ral';
        else if (i % 19 === 0) p.lastName = '[?]ebrouch';
    });
    return data;
}

function person(lastName: string, firstName = 'Bořivoj'): Person {
    return { id: 'x', firstName, lastName, gender: 'male', partnerships: [], parentIds: [], childIds: [] } as unknown as Person;
}

describe('the letter of a surname with an unreadable place (1102)', () => {
    it('"[?]" alone is no surname; one starting with "[?]" is an uncertain reading; letters stay letters', () => {
        expect(isGapOnlyName('[?]')).toBe(true);
        expect(isGapOnlyName('[?] [nečitelné]')).toBe(true);
        expect(isGapOnlyName('[?]o[?]ral')).toBe(false);
        expect(isGapOnlyName('')).toBe(false);
        expect(personIndexLetter(person('[?]'), 'cs')).toBe('');
        expect(personIndexLetter(person('[?]o[?]ral'), 'cs')).toBe(INDEX_UNCERTAIN);
        expect(indexLetter('[...]ov', 'en')).toBe(INDEX_UNCERTAIN);
        expect(indexLetter('Šlechtová', 'cs')).toBe('Š');
        // A leading quote or bracket other than "[" is skipped.
        expect(indexLetter('„Kolínská“', 'cs')).toBe('K');
        expect(indexLetter('(Pazderník)', 'cs')).toBe('P');
    });

    it('the sort: the letters first, then the uncertain readings, those without a surname last', () => {
        const keys = [person('Zbořil'), person('[?]o[?]ral'), person('[?]'), person('Adámek')].map(personIndexSort).sort();
        expect(keys.map(k => k[0])).toEqual(['0', '0', '1', '2']);
    });

    it('a family of a husband with "[?]" goes under the given name; with "[?]o…" under the uncertain readings', () => {
        const tree = {
            persons: { h1: { ...person('[?]', 'Kryštof'), id: 'h1' }, h2: { ...person('[?]o[?]ral'), id: 'h2' }, w: { ...person('Lipská', 'Ludmila'), id: 'w', gender: 'female' } },
            partnerships: {},
        } as unknown as StromData;
        expect(familyIndexLetter(tree, { id: 'u1', person1Id: 'h1', person2Id: 'w' } as never, 'cs')).toBe('K');
        expect(familyIndexLetter(tree, { id: 'u2', person1Id: 'h2', person2Id: 'w' } as never, 'cs')).toBe(INDEX_UNCERTAIN);
    });

    it('no feminine form of a surname without a letter at its end', () => {
        expect(feminineForm('[?]')).toBeNull();
        expect(feminineForm('Nov[?]')).toBeNull();
        expect(feminineForm('[?]o[?]ral')).toBe('[?]o[?]ralová');
    });
});

describe('the index split by letters with "[?]" surnames (1102)', () => {
    const set = treeSet(gapTree(1400));
    const letters = set.indexLetters.persons;
    const keys = letters.map(l => l.key);

    it('opens on the first real letter; "?" and Without a surname close the alphabet; no "[" letter', () => {
        expect(keys.length).toBeGreaterThan(3);
        expect(keys).not.toContain('[');
        expect(keys.slice(-2)).toEqual([INDEX_UNCERTAIN, '']);
        expect(set.indexSlug.persons).toBe(letters[0].slug);
        expect(letters[0].key).toMatch(/^\p{L}/u);
        const q = letters.find(l => l.key === INDEX_UNCERTAIN)!;
        expect(q.slug).toBe('rejstrik-osoby-nejiste-cteni');
        expect(set.bySlug.get(q.slug)?.title).toBe('Rejstřík osob · Nejisté čtení');
    });

    it('the uncertain page: "?" named in full in the alphabet, its surnames grouped, the pager by name', () => {
        const q = letters.find(l => l.key === INDEX_UNCERTAIN)!;
        const html = pageSetSectionHtml(set, q.slug);
        expect(html).toMatch(/<span class="sp-abc-l" aria-current="page" title="Nejisté čtení" aria-label="Nejisté čtení">\?<\/span>/);
        expect(html).toContain('[?]o[?]ral');
        expect(html).toContain('[?]ebrouch');
        expect(html).not.toMatch(/sp-ix-letter">\[\?\]</);
        // The other letters' pages name it too.
        const first = pageSetSectionHtml(set, letters[0].slug);
        expect(first).toMatch(/title="Nejisté čtení" aria-label="Nejisté čtení"[^>]*>\?</);
        expect(first).not.toMatch(/sp-abc-l[^>]*>\[</);
    });

    it('the page without a surname carries the "[?]" people, without "[?]ová"', () => {
        const none = letters.find(l => l.key === '')!;
        const html = pageSetSectionHtml(set, none.slug);
        expect(html).toContain('[?], ');
        expect(html).not.toContain('[?]ová');
        expect(html).not.toMatch(/sp-ix-letter">\[\?\]/);
    });
});

describe('the index on one page with "[?]" surnames (1102)', () => {
    const set = treeSet(gapTree(300, 20));

    it('the groups: letters, then "?" named in full, then Without a surname', () => {
        expect(set.indexLetters.persons).toEqual([]);
        const html = pageSetSectionHtml(set, set.indexSlug.persons);
        const nav = html.match(/<nav class="sp-letters"[^]*?<\/nav>/)![0];
        const texts = [...nav.matchAll(/>([^<>]+)<\/button>/g)].map(m => m[1]);
        expect(texts.slice(-2)).toEqual(['?', 'Bez příjmení']);
        expect(texts).not.toContain('[');
        expect(nav).toContain('title="Nejisté čtení"');
        const heads = [...html.matchAll(/<h2 class="sp-ix-letter">([^<]+)<\/h2>/g)].map(m => m[1]);
        expect(heads.slice(-2)).toEqual(['Nejisté čtení', 'Bez příjmení']);
    });

    it('the birth surnames leave out "[?]" alone and list "[?]o…" after the others', () => {
        const html = pageSetSectionHtml(set, set.indexSlug.surnames);
        const born = html.slice(html.indexOf('sp-ix-folds'));
        const names = [...born.matchAll(/<span class="sp-ix-n">([^<]+)<\/span>/g)].map(m => m[1]);
        expect(names).not.toContain('[?]');
        const firstGap = names.findIndex(n => n.startsWith('['));
        if (firstGap >= 0) expect(names.slice(firstGap).every(n => n.startsWith('['))).toBe(true);
    });
});
