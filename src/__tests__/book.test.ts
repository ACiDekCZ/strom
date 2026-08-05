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

describe('Register-style chapter ordering', () => {
    it('a child family follows its parents, before an unrelated same-generation family', () => {
        // Two root families A and B (same generation); A's child has a family.
        const mk = (id: string, first: string, o: Record<string, unknown> = {}) => ({
            id, firstName: first, lastName: 'X', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...o,
        });
        const d = {
            persons: {
                a1: mk('a1', 'AdamRoot', { birthDate: '1800', partnerships: ['uA'], childIds: ['ac'] }),
                a2: mk('a2', 'Eva', { gender: 'female', birthDate: '1805', partnerships: ['uA'], childIds: ['ac'] }),
                ac: mk('ac', 'AdamChild', { birthDate: '1830', parentIds: ['a1', 'a2'], partnerships: ['uAC'], childIds: ['acc'] }),
                acw: mk('acw', 'Wife', { gender: 'female', partnerships: ['uAC'], childIds: ['acc'] }),
                acc: mk('acc', 'Grandkid', { birthDate: '1860', parentIds: ['ac', 'acw'] }),
                b1: mk('b1', 'BobRoot', { birthDate: '1810', partnerships: ['uB'], childIds: ['bc'] }),
                b2: mk('b2', 'Bea', { gender: 'female', partnerships: ['uB'], childIds: ['bc'] }),
                bc: mk('bc', 'BobChild', { birthDate: '1840', parentIds: ['b1', 'b2'] }),
            },
            partnerships: {
                uA: { id: 'uA', person1Id: 'a1', person2Id: 'a2', childIds: ['ac'], status: 'married', startDate: '1825' },
                uAC: { id: 'uAC', person1Id: 'ac', person2Id: 'acw', childIds: ['acc'], status: 'married', startDate: '1855' },
                uB: { id: 'uB', person1Id: 'b1', person2Id: 'b2', childIds: ['bc'], status: 'married', startDate: '1835' },
            },
        } as unknown as StromData;

        const html = buildFamilyBook(d, { lang: 'en', privacyMode: 'full' });
        // Chapter headings carry the number span right before the name.
        const posA = html.indexOf('</span> AdamRoot X');
        const posAC = html.indexOf('</span> AdamChild X');
        const posB = html.indexOf('</span> BobRoot X');
        // Register order: Adam's family, then Adam's CHILD's family, then Bob.
        expect(posA).toBeGreaterThan(-1);
        expect(posAC).toBeGreaterThan(posA);
        expect(posB).toBeGreaterThan(posAC);
    });
});

describe('book toolbar', () => {
    it('carries its own Close and Print controls (standalone PWA has no chrome)', () => {
        const html = buildFamilyBook(demo, { lang: 'en', privacyMode: 'full' });
        expect(html).toContain('book-toolbar');
        expect(html).toContain('window.print()');
        expect(html).toContain('window.close()');
        const cs = buildFamilyBook(demo, { lang: 'cs', privacyMode: 'full' });
        expect(cs).toContain('Zavřít');
    });
});

describe('narratives in the book', () => {
    /** Husband with a story, wife without; the couple has one of its own. */
    const tree = {
        persons: mkPersons(
            { ...p('h', 'Jan', 'Novák', 'male', { birthDate: '1863', notes: 'Zápis v matrice.' }),
                story: {
                    title: 'Nemanželský syn z čp. 22',
                    status: 'draft' as const,
                    text: 'První odstavec o **nádeníkovi**.\n\nDruhý odstavec.',
                    facts: ['BIRT 5 MAY 1863 [K-04]'],
                    note: 'Není pramen.',
                } },
            p('w', 'Anna', 'Nováková', 'female', { birthDate: '1865' }),
            p('c', 'Josef', 'Novák', 'male', { birthDate: '1890' }),
        ),
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'h', person2Id: 'w', childIds: ['c'],
                status: 'married' as const, startDate: '1886',
                story: { text: 'Vzali se v srpnu 1886.' },
            },
        },
    } as unknown as StromData;

    const html = buildFamilyBook(tree, { lang: 'cs', privacyMode: 'full' });

    it('prints the story after the facts, one <p> per paragraph', () => {
        expect(html).toContain('<div class="book-story book-story-person">');
        expect(html).toContain('<p>První odstavec o <strong>nádeníkovi</strong>.</p>');
        expect(html).toContain('<p>Druhý odstavec.</p>');
        // After the person's own notes, which are the facts' last word.
        expect(html.indexOf('Zápis v matrice.')).toBeLessThan(html.indexOf('První odstavec'));
    });

    it('shows the subheading, and says nothing about the draft state', () => {
        expect(html).toContain('Nemanželský syn z čp. 22');
        // Draft/approved is a workshop note: it stays in the data and in the
        // GEDCOM, but a printed page does not comment on itself.
        expect(html).not.toContain('book-story-draft');
        expect(html).not.toContain('návrh');
    });

    it('prints the couple’s story in their chapter', () => {
        expect(html).toContain('book-story-couple');
        expect(html).toContain('Vzali se v srpnu 1886.');
    });

    it('keeps the checklist of facts out of the book — it is workshop, not text', () => {
        expect(html).not.toContain('BIRT 5 MAY 1863');
        expect(html).not.toContain('Není pramen.');
    });

    it('escapes before it renders emphasis: no markup rides in from the text', () => {
        const nasty = structuredClone(tree);
        (nasty.persons as Record<string, Person>)['h'].story!.text = '<script>alert(1)</script> a **tučně**';
        const out = buildFamilyBook(nasty, { lang: 'cs', privacyMode: 'full' });
        expect(out).not.toContain('<script>alert(1)</script>');
        expect(out).toContain('&lt;script&gt;');
        expect(out).toContain('<strong>tučně</strong>');
    });
});

describe('a narrative is not squeezed into the medallion', () => {
    /**
     * Two medallions stand side by side, so a story rendered inside one came
     * out as a column of three-word lines. Stories belong below the couple,
     * full width, each headed by whose it is.
     */
    const tree = {
        persons: mkPersons(
            { ...p('h', 'Jan', 'Novák', 'male', { birthDate: '1863' }),
                story: { text: 'Jeho příběh.' } },
            { ...p('w', 'Anna', 'Nováková', 'female', { birthDate: '1865' }),
                story: { text: 'Její příběh.' } },
            p('c', 'Josef', 'Novák', 'male', { birthDate: '1890' }),
        ),
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'h', person2Id: 'w', childIds: ['c'],
                status: 'married' as const, story: { text: 'Jejich příběh.' },
            },
        },
    } as unknown as StromData;

    const html = buildFamilyBook(tree, { lang: 'cs', privacyMode: 'full' });

    it('renders stories outside the side-by-side couple block', () => {
        const couple = /<div class="book-couple">([\s\S]*?)<\/div>\s*<div class="book-story/.exec(html);
        expect(couple, 'stories follow the couple block').not.toBeNull();
        expect(couple![1]).not.toContain('book-story');
    });

    it('names whose story it is, his then hers then theirs', () => {
        const heads = [...html.matchAll(/<h4 class="book-story-head">([\s\S]*?)<\/h4>/g)]
            .map(m => m[1].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim());
        expect(heads).toEqual(['Jan Novák', 'Anna Nováková', 'Jan Novák & Anna Nováková']);
        expect(html.indexOf('Jeho příběh.')).toBeLessThan(html.indexOf('Její příběh.'));
        expect(html.indexOf('Její příběh.')).toBeLessThan(html.indexOf('Jejich příběh.'));
    });
});
