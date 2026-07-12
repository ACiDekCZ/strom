/**
 * Czech register (matriky) archive portals: which regional archive digitizes
 * records for a given place, plus prefilled external search links.
 *
 * Matching is keyword-based against district seats and district names — the
 * user enters free-form places, so this is a best-effort suggestion, never
 * an authority. All portals are always offered as a fallback list.
 */

import { Person } from './types.js';
import { yearOf } from './dates.js';

export interface ArchivePortal {
    id: string;
    /** Portal name shown to the user. */
    name: string;
    /** Institution (archive) the portal belongs to. */
    institution: string;
    url: string;
    /** Region description shown as hint. */
    coverage: { cs: string; en: string };
    /** Lowercase, diacritics-stripped district/city keywords for matching. */
    keywords: string[];
}

/** Strip diacritics and lowercase for tolerant matching. */
export function normalizePlace(place: string): string {
    return place.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export const ARCHIVE_PORTALS: ArchivePortal[] = [
    {
        id: 'ahmp',
        name: 'Archiv hl. m. Prahy (AMP katalog)',
        institution: 'Archiv hlavního města Prahy',
        url: 'https://katalog.ahmp.cz/pragapublica/',
        coverage: { cs: 'Praha', en: 'Prague' },
        keywords: ['praha', 'prague'],
    },
    {
        id: 'ebadatelna',
        name: 'eBadatelna',
        institution: 'SOA Praha',
        url: 'https://ebadatelna.soapraha.cz/',
        coverage: { cs: 'Středočeský kraj', en: 'Central Bohemia' },
        keywords: ['benesov', 'beroun', 'kladno', 'kolin', 'kutna hora', 'melnik',
            'mlada boleslav', 'nymburk', 'pribram', 'rakovnik', 'brandys', 'ricany', 'slany'],
    },
    {
        id: 'trebon',
        name: 'DigiArchiv',
        institution: 'SOA Třeboň',
        url: 'https://digi.ceskearchivy.cz/',
        coverage: { cs: 'Jihočeský kraj + Pelhřimovsko', en: 'South Bohemia' },
        keywords: ['ceske budejovice', 'cesky krumlov', 'jindrichuv hradec', 'pisek',
            'prachatice', 'strakonice', 'tabor', 'pelhrimov', 'trebon'],
    },
    {
        id: 'portafontium',
        name: 'Porta fontium',
        institution: 'SOA Plzeň',
        url: 'https://www.portafontium.eu/',
        coverage: { cs: 'Plzeňský a Karlovarský kraj', en: 'Pilsen and Karlovy Vary regions' },
        keywords: ['plzen', 'domazlice', 'klatovy', 'rokycany', 'tachov',
            'cheb', 'karlovy vary', 'sokolov'],
    },
    {
        id: 'litomerice',
        name: 'Vademecum',
        institution: 'SOA Litoměřice',
        url: 'http://vademecum.soalitomerice.cz/vademecum/',
        coverage: { cs: 'Ústecký a Liberecký kraj', en: 'Ústí and Liberec regions' },
        keywords: ['usti nad labem', 'decin', 'chomutov', 'litomerice', 'louny', 'most',
            'teplice', 'ceska lipa', 'jablonec', 'liberec', 'semily', 'zatec'],
    },
    {
        id: 'zamrsk',
        name: 'Východočeské archivy (ARON)',
        institution: 'SOA Zámrsk',
        url: 'https://aron.vychodoceskearchivy.cz/',
        coverage: { cs: 'Královéhradecký a Pardubický kraj', en: 'Hradec Králové and Pardubice regions' },
        keywords: ['hradec kralove', 'jicin', 'nachod', 'rychnov', 'trutnov',
            'chrudim', 'pardubice', 'svitavy', 'usti nad orlici', 'jaromer'],
    },
    {
        id: 'actapublica',
        name: 'Acta Publica',
        institution: 'Moravský zemský archiv v Brně',
        url: 'https://www.actapublica.eu/',
        coverage: { cs: 'Jihomoravský a Zlínský kraj + Vysočina', en: 'South Moravia, Zlín and Vysočina regions' },
        keywords: ['brno', 'blansko', 'breclav', 'hodonin', 'vyskov', 'znojmo',
            'kromeriz', 'uherske hradiste', 'vsetin', 'zlin',
            'jihlava', 'trebic', 'zdar nad sazavou', 'havlickuv brod', 'rajecko'],
    },
    {
        id: 'opava',
        name: 'Digitální archiv ZA Opava',
        institution: 'Zemský archiv v Opavě',
        url: 'https://digi.archives.cz/da/',
        coverage: { cs: 'Moravskoslezský a Olomoucký kraj', en: 'Moravia-Silesia and Olomouc regions' },
        keywords: ['bruntal', 'frydek', 'mistek', 'karvina', 'novy jicin', 'opava', 'ostrava',
            'jesenik', 'olomouc', 'prostejov', 'prerov', 'sumperk'],
    },
];

/**
 * Suggest portals whose coverage keywords match the given place.
 * Empty array when nothing matches (caller shows the full list instead).
 */
export function suggestArchives(place: string): ArchivePortal[] {
    const norm = normalizePlace(place);
    if (!norm) return [];
    return ARCHIVE_PORTALS.filter(portal =>
        portal.keywords.some(keyword => norm.includes(keyword)));
}

/** All places recorded on a person (deduplicated, order preserved). */
export function personPlaces(person: Person): string[] {
    const places: string[] = [];
    for (const p of [person.birthPlace, person.deathPlace]) {
        if (p && !places.includes(p)) places.push(p);
    }
    return places;
}


/**
 * Czech portals are only relevant when the app runs in Czech OR the person
 * has a place matching a Czech district — international users researching
 * non-Czech families should not see them.
 */
export function isCzechRelevant(person: Person, lang: string): boolean {
    if (lang === 'cs') return true;
    return personPlaces(person).some(place => suggestArchives(place).length > 0);
}

/**
 * Prefilled FamilySearch record search for the person
 * (surname + birth year range ±2 + place when available).
 */
export function familySearchUrl(person: Person): string {
    const params = new URLSearchParams();
    if (person.lastName) params.set('q.surname', person.lastName);
    if (person.firstName && person.firstName !== '?') params.set('q.givenName', person.firstName);
    const birthYear = yearOf(person.birthDate);
    if (birthYear !== null) {
        params.set('q.birthLikeDate.from', String(birthYear - 2));
        params.set('q.birthLikeDate.to', String(birthYear + 2));
    }
    const place = person.birthPlace || person.deathPlace;
    if (place) params.set('q.anyPlace', place);
    return `https://www.familysearch.org/search/record/results?${params.toString()}`;
}
