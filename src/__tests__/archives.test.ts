/**
 * Czech archive portal suggestions and external search links.
 */

import { describe, it, expect } from 'vitest';
import { ARCHIVE_PORTALS, suggestArchives, normalizePlace, familySearchUrl, personPlaces, isCzechRelevant } from '../archives.js';
import { Person, PersonId } from '../types.js';

describe('normalizePlace', () => {
    it('strips diacritics and lowercases', () => {
        expect(normalizePlace('Havlíčkův Brod')).toBe('havlickuv brod');
        expect(normalizePlace('Děčín')).toBe('decin');
        expect(normalizePlace('PLZEŇ')).toBe('plzen');
    });
});

describe('suggestArchives', () => {
    it('maps district seats to their regional archive', () => {
        expect(suggestArchives('Havlíčkův Brod').map(a => a.id)).toContain('actapublica');
        expect(suggestArchives('Děčín').map(a => a.id)).toContain('litomerice');
        expect(suggestArchives('Brno-Židenice').map(a => a.id)).toContain('actapublica');
        expect(suggestArchives('Ostrava').map(a => a.id)).toContain('opava');
        expect(suggestArchives('Tábor').map(a => a.id)).toContain('trebon');
        expect(suggestArchives('Cheb').map(a => a.id)).toContain('portafontium');
        expect(suggestArchives('Praha 5').map(a => a.id)).toContain('ahmp');
        expect(suggestArchives('Pardubice').map(a => a.id)).toContain('zamrsk');
        expect(suggestArchives('Kutná Hora').map(a => a.id)).toContain('ebadatelna');
    });

    it('matches case- and diacritics-insensitively', () => {
        expect(suggestArchives('okres kolin').map(a => a.id)).toContain('ebadatelna');
    });

    it('returns empty for unknown places', () => {
        expect(suggestArchives('Neznámá Lhota')).toEqual([]);
        expect(suggestArchives('')).toEqual([]);
    });

    it('all portals have https-or-http urls and non-empty keywords', () => {
        for (const p of ARCHIVE_PORTALS) {
            expect(p.url).toMatch(/^https?:\/\//);
            expect(p.keywords.length).toBeGreaterThan(0);
            // keywords must already be normalized
            for (const k of p.keywords) expect(k).toBe(normalizePlace(k));
        }
    });
});

describe('familySearchUrl', () => {
    const person: Person = {
        id: 'p1' as PersonId, firstName: 'Jan', lastName: 'Novák', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        birthDate: '~1880', birthPlace: 'Děčín',
    };

    it('prefills surname, given name, year range and place', () => {
        const url = familySearchUrl(person);
        expect(url).toContain('q.surname=Nov%C3%A1k');
        expect(url).toContain('q.givenName=Jan');
        expect(url).toContain('q.birthLikeDate.from=1878');
        expect(url).toContain('q.birthLikeDate.to=1882');
        expect(url).toContain('q.anyPlace=D%C4%9B%C4%8D%C3%ADn');
    });

    it('omits missing fields', () => {
        const minimal = { ...person, firstName: '?', lastName: '', birthDate: undefined, birthPlace: undefined };
        const url = familySearchUrl(minimal);
        expect(url).not.toContain('q.surname');
        expect(url).not.toContain('q.givenName');
        expect(url).not.toContain('birthLikeDate');
    });
});

describe('personPlaces', () => {
    it('deduplicates birth and death places', () => {
        const p = {
            birthPlace: 'Brno', deathPlace: 'Brno',
        } as Person;
        expect(personPlaces(p)).toEqual(['Brno']);
        const q = { birthPlace: 'Brno', deathPlace: 'Praha' } as Person;
        expect(personPlaces(q)).toEqual(['Brno', 'Praha']);
    });
});

describe('isCzechRelevant (gating for non-Czech users)', () => {
    const base = {
        id: 'p1', firstName: 'John', lastName: 'Smith', gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    } as unknown as Person;

    it('always relevant for Czech UI language', () => {
        expect(isCzechRelevant(base, 'cs')).toBe(true);
    });

    it('hidden for English UI without Czech places', () => {
        expect(isCzechRelevant({ ...base, birthPlace: 'London' }, 'en')).toBe(false);
        expect(isCzechRelevant(base, 'en')).toBe(false);
    });

    it('shown for English UI when a place matches a Czech district', () => {
        expect(isCzechRelevant({ ...base, birthPlace: 'Brno' }, 'en')).toBe(true);
        expect(isCzechRelevant({ ...base, deathPlace: 'Děčín' }, 'en')).toBe(true);
    });
});
