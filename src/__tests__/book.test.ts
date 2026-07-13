/**
 * Family book generator tests: chapter ordering, cross-references, a complete
 * person index (childless persons included), per-chapter source footnotes,
 * privacy stripping and the English variant. Pure — no DOM.
 */

import { describe, it, expect } from 'vitest';
import { buildFamilyBook } from '../book.js';
import { getDemoTree } from '../demo-trees.js';
import { StromData, PersonId, PartnershipId, Person, Source, Gender } from '../types.js';

const demo = getDemoTree('cs');

/** Extract the chapter <section> blocks in order. */
function chapters(html: string): string[] {
    return html.match(/<section class="book-chapter">[\s\S]*?<\/section>/g) ?? [];
}

interface Opts {
    birthDate?: string; deathDate?: string; birthPlace?: string; deathPlace?: string;
    notes?: string; photo?: string; isDeceased?: boolean;
    parentIds?: string[]; childIds?: string[]; partnerships?: string[]; sourceIds?: string[];
}

function p(id: string, first: string, last: string, gender: Gender, opts: Opts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false,
        parentIds: (opts.parentIds ?? []) as PersonId[],
        childIds: (opts.childIds ?? []) as PersonId[],
        partnerships: (opts.partnerships ?? []) as PartnershipId[],
        ...(opts.birthDate ? { birthDate: opts.birthDate } : {}),
        ...(opts.deathDate ? { deathDate: opts.deathDate } : {}),
        ...(opts.birthPlace ? { birthPlace: opts.birthPlace } : {}),
        ...(opts.deathPlace ? { deathPlace: opts.deathPlace } : {}),
        ...(opts.notes ? { notes: opts.notes } : {}),
        ...(opts.photo ? { photo: opts.photo } : {}),
        ...(opts.isDeceased !== undefined ? { isDeceased: opts.isDeceased } : {}),
        ...(opts.sourceIds ? { sourceIds: opts.sourceIds } : {}),
    };
}

function mkPersons(...ps: Person[]): StromData['persons'] {
    const out: StromData['persons'] = {};
    for (const person of ps) out[person.id] = person;
    return out;
}

/** Build a couple-with-child partnership record. */
function union(id: string, p1: string, p2: string, kids: string[]) {
    return { [id]: { id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId, status: 'married' as const, childIds: kids as PersonId[] } } as StromData['partnerships'];
}

describe('buildFamilyBook (demo)', () => {
    const html = buildFamilyBook(demo, { lang: 'cs', privacyMode: 'full', dateLabel: 'červenec 2026' });

    it('produces a self-contained HTML document', () => {
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('Kniha rodu');
        expect(html).not.toContain('<script');
    });

    it('orders chapters oldest-first (Bořivoj is chapter 1)', () => {
        const first = chapters(html)[0];
        expect(first).toContain('book-chapter-num">1<');
        expect(first).toContain('Bořivoj');
    });

    it('emits chapter cross-references for children who head their own chapter', () => {
        expect(html).toContain('→ kap.');
    });

    it('includes every non-placeholder person in the index (childless kept)', () => {
        const realPersons = Object.values(demo.persons).filter(p => !p.isPlaceholder);
        const indexRows = html.match(/class="book-index-row"/g) ?? [];
        expect(indexRows.length).toBe(realPersons.length);
        // Václav III died childless — no chapter, but must still be in the index.
        expect(html).toContain('Přemyslovec, Václav III.');
    });

    it('respects maxGenerations by trimming deeper chapters', () => {
        const shallow = buildFamilyBook(demo, { lang: 'cs', privacyMode: 'full', maxGenerations: 2 });
        expect(chapters(shallow).length).toBeLessThan(chapters(html).length);
    });

    it('renders the English variant', () => {
        const en = buildFamilyBook(demo, { lang: 'en', privacyMode: 'full' });
        expect(en).toContain('Families');
        expect(en).toContain('Person Index');
    });
});

describe('buildFamilyBook (synthetic)', () => {
    it('strips living-person names under the initials privacy mode', () => {
        const data: StromData = {
            persons: mkPersons(
                p('dad', 'Alois', 'Starý', 'male', { isDeceased: true, birthDate: '1900', childIds: ['kid'], partnerships: ['u'] }),
                p('mom', 'Marie', 'Živá', 'female', { isDeceased: false, birthDate: '1990', childIds: ['kid'], partnerships: ['u'] }),
                p('kid', 'Petr', 'Starý', 'male', { birthDate: '2015', parentIds: ['dad', 'mom'] }),
            ),
            partnerships: union('u', 'dad', 'mom', ['kid']),
        };
        const html = buildFamilyBook(data, { lang: 'cs', privacyMode: 'initials' });
        expect(html).not.toContain('Marie'); // living mother's name is reduced
        expect(html).toContain('Alois');      // deceased father kept
    });

    it('renders per-chapter source footnotes for citations', () => {
        const source: Source = { id: 's1', title: 'Matrika Děčín 1900', repository: 'SOA Litoměřice', reference: 'sign. 12' };
        const data: StromData = {
            persons: mkPersons(
                p('dad', 'Josef', 'Novák', 'male', { birthDate: '1900', deathDate: '1970', childIds: ['kid'], partnerships: ['u'], sourceIds: ['s1'] }),
                p('mom', 'Anna', 'Nováková', 'female', { birthDate: '1905', deathDate: '1980', childIds: ['kid'], partnerships: ['u'] }),
                p('kid', 'Petr', 'Novák', 'male', { birthDate: '1930', deathDate: '1990', parentIds: ['dad', 'mom'] }),
            ),
            partnerships: union('u', 'dad', 'mom', ['kid']),
            sources: { s1: source },
        };
        const html = buildFamilyBook(data, { lang: 'cs', privacyMode: 'full' });
        expect(html).toContain('[1]');
        expect(html).toContain('Matrika Děčín 1900');
        expect(html).toContain('SOA Litoměřice');
    });
});
