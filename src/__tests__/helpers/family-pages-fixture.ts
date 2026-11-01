/**
 * A fictional tree for the family pages (spec 026, ZADANI_DEV sample data):
 * the Fíšek line of Čapkov from Jan (* about 1702) down to the living Eva
 * (* 1952), the Kvapil line of Kvasín joined to it by Josef's first marriage
 * (1846, Anna Kvapilová 1824–1874), Josef's second marriage (1876, Terezie
 * Vrbátková, widowed Lhotáková) with the son Antonín (1877), the Řepík line
 * of Řepíkov, a single daughter (Kateřina), a union without a partner and
 * two namesakes with the same years (the slug's "-2").
 * Every name and place is made up.
 */

import { Gender, Partnership, PartnershipId, Person, PersonId, Source, StromData } from '../../types.js';
import { placeKey } from '../../places.js';

/** A 1×1 JPEG (the marriage record's excerpt). */
export const CLIP_IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
/** Another tiny JPEG (Josef's portrait): differs from the excerpt in one byte. */
export const PHOTO_IMG = CLIP_IMG.replace('KCIsIx', 'KCIsIy');

export const FP_NOW = new Date('2026-10-29T12:00:00Z');

interface P { id: string; first: string; last: string; g: Gender; b?: string; d?: string; bp?: string; dp?: string; extra?: Partial<Person> }

export interface FamilyPagesFixture {
    data: StromData;
    /** Named people of the sample (ids). */
    ids: Record<'jan' | 'josef' | 'anna' | 'terezie' | 'antonin' | 'katerina' | 'eva' | 'petr' | 'jaroslav' | 'jana' | 'marie' | 'josefA' | 'josefB', PersonId>;
    unions: Record<'f9' | 'f10' | 'f24' | 'jaroslavJana' | 'single', PartnershipId>;
}

export function familyPagesFixture(): FamilyPagesFixture {
    const persons: Record<string, Person> = {};
    const partnerships: Record<string, Partnership> = {};
    const add = (x: P): PersonId => {
        persons[x.id] = {
            id: x.id as PersonId, firstName: x.first, lastName: x.last, gender: x.g, isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [],
            ...(x.b ? { birthDate: x.b, birthPlace: x.bp ?? 'Čapkov' } : {}),
            ...(x.d ? { deathDate: x.d, deathPlace: x.dp ?? x.bp ?? 'Čapkov' } : {}),
            ...(x.extra ?? {}),
        } as Person;
        return x.id as PersonId;
    };
    let un = 0;
    const marry = (a: string, b: string | null, date: string | null, kids: string[] = [], extra: Partial<Partnership> = {}, place = 'Čapkov'): PartnershipId => {
        const id = `u${++un}` as PartnershipId;
        partnerships[id] = {
            id, person1Id: a as PersonId, person2Id: (b ?? '') as PersonId, childIds: kids as PersonId[],
            status: date ? 'married' : 'partners', ...(date ? { startDate: date, startPlace: place } : {}), ...extra,
        };
        persons[a].partnerships.push(id);
        if (b) persons[b].partnerships.push(id);
        for (const k of kids) {
            persons[k].parentIds.push(a as PersonId);
            persons[a].childIds.push(k as PersonId);
            if (b) { persons[k].parentIds.push(b as PersonId); persons[b].childIds.push(k as PersonId); }
        }
        return id;
    };

    // ── The Fíšek line of Čapkov ──
    add({ id: 'jan', first: 'Jan', last: 'Fíšek', g: 'male', b: '~1702', d: '1761' });
    add({ id: 'rozina', first: 'Rozina', last: 'Hrabánková', g: 'female', b: '1708', d: '1770', bp: 'Hrabanov' });
    add({ id: 'vaclav', first: 'Václav', last: 'Fíšek', g: 'male', b: '1740', d: '1805' });
    add({ id: 'dorota', first: 'Dorota', last: 'Fíšková', g: 'female', b: '1743', d: '1800' });
    add({ id: 'matej', first: 'Matěj', last: 'Fíšek', g: 'male', b: '1746', d: '1748' });
    marry('jan', 'rozina', '1730', ['vaclav', 'dorota', 'matej']);

    add({ id: 'ludmila', first: 'Ludmila', last: 'Vrbátková', g: 'female', b: '1748', d: '1810', bp: 'Kvasín' });
    add({ id: 'jakub', first: 'Jakub', last: 'Fíšek', g: 'male', b: '1782', d: '1850' });
    add({ id: 'martin', first: 'Martin', last: 'Fischek', g: 'male', b: '1785', d: '1840' });
    add({ id: 'marie1788', first: 'Marie', last: 'Fíšková', g: 'female', b: '1788', d: '1789' });
    marry('vaclav', 'ludmila', '1770', ['jakub', 'martin', 'marie1788']);

    add({ id: 'magdalena', first: 'Magdalena', last: 'Hrabánková', g: 'female', b: '1790', d: '1860', bp: 'Hrabanov' });
    add({ id: 'josef', first: 'Josef', last: 'Fíšek', g: 'male', b: '1820-03-19', d: '1894-01-08', extra: { photo: PHOTO_IMG, events: [{ id: 'jo-occ', type: 'occupation', date: '1850', note: 'rolník' }] } });
    add({ id: 'katerina', first: 'Kateřina', last: 'Fíšková', g: 'female', b: '1823', d: '1880' });
    add({ id: 'jan1826', first: 'Jan', last: 'Fíšek', g: 'male', b: '1826', d: '1890' });
    marry('jakub', 'magdalena', '1812', ['josef', 'katerina', 'jan1826']);

    // ── The Kvapil line of Kvasín ──
    add({ id: 'vojtechK', first: 'Vojtěch', last: 'Kvapil', g: 'male', b: '1795', d: '1860', bp: 'Kvasín' });
    add({ id: 'johana', first: 'Johana', last: 'Vrbátková', g: 'female', b: '1798', d: '1865', bp: 'Kvasín' });
    add({ id: 'anna', first: 'Anna', last: 'Kvapilová', g: 'female', b: '1824-07-02', d: '1874-05-30', bp: 'Kvasín', dp: 'Čapkov' });
    add({ id: 'karelK', first: 'Karel', last: 'Kvapil', g: 'male', b: '1827', d: '1890', bp: 'Kvasín' });
    marry('vojtechK', 'johana', '1820', ['anna', 'karelK'], {}, 'Kvasín');
    add({ id: 'barboraK', first: 'Barbora', last: 'Hrabánková', g: 'female', b: '1830', d: '1895', bp: 'Hrabanov' });
    add({ id: 'karelK2', first: 'Karel', last: 'Kvapil', g: 'male', b: '1853', d: '1920', bp: 'Kvasín' });
    add({ id: 'alzbeta', first: 'Alžběta', last: 'Kvapilová', g: 'female', b: '1848', d: '1912', bp: 'Kvasín' });
    marry('karelK', 'barboraK', '1847', ['alzbeta', 'karelK2'], {}, 'Kvasín');

    // Josef ⚭1 1846 Anna: seven children (f9).
    add({ id: 'jan1847', first: 'Jan', last: 'Fíšek', g: 'male', b: '1847', d: '1910' });
    add({ id: 'rosalie1849', first: 'Rosálie', last: 'Fíšková', g: 'female', b: '1849', d: '1851' });
    add({ id: 'frantisek', first: 'František', last: 'Fíšek', g: 'male', b: '1851', d: '1920' });
    add({ id: 'anna1853', first: 'Anna', last: 'Fíšková', g: 'female', b: '1853', d: '1930' });
    add({ id: 'vaclav1856', first: 'Václav', last: 'Fíšek', g: 'male', b: '1856', d: '1858' });
    add({ id: 'marie', first: 'Marie', last: 'Fíšková', g: 'female', b: '1859', d: '1940' });
    add({ id: 'josef1862', first: 'Josef', last: 'Fíšek', g: 'male', b: '1862', d: '1863' });
    const f9 = marry('josef', 'anna', '1846-02-12', ['jan1847', 'rosalie1849', 'frantisek', 'anna1853', 'vaclav1856', 'marie', 'josef1862'],
        { sourceIds: ['s-marr1846'], participants: [{ id: 'w1', role: 'witness', name: 'Jiří Vrbátek' }] });

    // Josef ⚭2 1876 Terezie (born Vrbátková, the widow Lhotáková): Antonín (f10).
    add({ id: 'terezie', first: 'Terezie', last: 'Vrbátková', g: 'female', b: '1835', d: '1900', bp: 'Kvasín', extra: { marriedSurname: 'Lhotáková' } });
    add({ id: 'antonin', first: 'Antonín', last: 'Fíšek', g: 'male', b: '1877', d: '1950' });
    const f10 = marry('josef', 'terezie', '1876', ['antonin']);

    // Kateřina stays single; Marie has a son, the father not recorded.
    add({ id: 'alois', first: 'Alois', last: 'Fíšek', g: 'male', b: '1885', d: '1950' });
    const single = marry('marie', null, null, ['alois']);

    // Jan (1847) ⚭ Rosálie: Josef (1873) and Anna (1875).
    add({ id: 'rosalieH', first: 'Rosálie', last: 'Hrabánková', g: 'female', b: '1850', d: '1915', bp: 'Hrabanov' });
    add({ id: 'josef1873', first: 'Josef', last: 'Fíšek', g: 'male', b: '1873', d: '1940' });
    add({ id: 'anna1875', first: 'Anna', last: 'Fíšková', g: 'female', b: '1875', d: '1950' });
    marry('jan1847', 'rosalieH', '1872', ['josef1873', 'anna1875']);

    // František ⚭ Johana: two sons.
    add({ id: 'johanaV', first: 'Johana', last: 'Vrbátková', g: 'female', b: '1855', d: '1925', bp: 'Kvasín' });
    add({ id: 'karel1880', first: 'Karel', last: 'Fíšek', g: 'male', b: '1880', d: '1944', dp: 'Kvasín' });
    add({ id: 'vojtech1883', first: 'Vojtěch', last: 'Fyšek', g: 'male', b: '1883', d: '1960', dp: 'Kvasín' });
    marry('frantisek', 'johanaV', '1879', ['karel1880', 'vojtech1883']);

    // Jan (1826) ⚭ Rosálie: Jan (1851), Václav (1854), Rosálie (1857–1859).
    add({ id: 'rosalie1828', first: 'Rosálie', last: 'Hrabánková', g: 'female', b: '1828', d: '1900', bp: 'Hrabanov' });
    add({ id: 'jan1851', first: 'Jan', last: 'Fíšek', g: 'male', b: '1851', d: '1920' });
    add({ id: 'vaclav1854', first: 'Václav', last: 'Fíšek', g: 'male', b: '1854', d: '1915' });
    add({ id: 'rosalie1857', first: 'Rosálie', last: 'Fíšková', g: 'female', b: '1857', d: '1859' });
    marry('jan1826', 'rosalie1828', '1850', ['jan1851', 'vaclav1854', 'rosalie1857']);
    add({ id: 'marieV', first: 'Marie', last: 'Vrbátková', g: 'female', b: '1856', d: '1930', bp: 'Kvasín' });
    add({ id: 'jan1880', first: 'Jan', last: 'Fíšek', g: 'male', b: '1880', d: '1945' });
    add({ id: 'ludvik', first: 'Ludvík', last: 'Fíšek', g: 'male', b: '1883', d: '1950' });
    marry('jan1851', 'marieV', '1878', ['jan1880', 'ludvik']);

    // Martin (1785) ⚭ Barbora: Tomáš, whose children include a second "Josef Fíšek 1862–1863".
    add({ id: 'barbora', first: 'Barbora', last: 'Hrabánková', g: 'female', b: '1788', d: '1850', bp: 'Hrabanov' });
    add({ id: 'tomas', first: 'Tomáš', last: 'Fíšek', g: 'male', b: '1812', d: '1870' });
    marry('martin', 'barbora', '1810', ['tomas']);
    add({ id: 'kristina', first: 'Kristina', last: 'Vrbátková', g: 'female', b: '1815', d: '1880', bp: 'Kvasín' });
    add({ id: 'matej1840', first: 'Matěj', last: 'Fíšek', g: 'male', b: '1840', d: '1900' });
    add({ id: 'josefa', first: 'Josefa', last: 'Fíšková', g: 'female', b: '1842', d: '1844' });
    add({ id: 'vojtech1845', first: 'Vojtěch', last: 'Fíšek', g: 'male', b: '1845', d: '1910' });
    add({ id: 'josef1862b', first: 'Josef', last: 'Fíšek', g: 'male', b: '1862', d: '1863' });
    marry('tomas', 'kristina', '1838', ['matej1840', 'josefa', 'vojtech1845', 'josef1862b']);
    // Vojtěch (1845) ⚭ Alžběta Kvapilová: the second marriage between the lines.
    add({ id: 'ignac', first: 'Ignác', last: 'Fíšek', g: 'male', b: '1872', d: '1930' });
    marry('vojtech1845', 'alzbeta', '1870', ['ignac'], {}, 'Kvasín');

    // ── The Řepík line of Řepíkov ──
    add({ id: 'tomasR', first: 'Tomáš', last: 'Řepík', g: 'male', b: '1740', d: '1800', bp: 'Řepíkov' });
    add({ id: 'ondrej', first: 'Ondřej', last: 'Řepík', g: 'male', b: '1768', d: '1830', bp: 'Řepíkov' });
    marry('tomasR', 'dorota', '1765', ['ondrej'], {}, 'Řepíkov');
    add({ id: 'ludmilaV', first: 'Ludmila', last: 'Vrbátková', g: 'female', b: '1772', d: '1840', bp: 'Kvasín' });
    add({ id: 'jiri', first: 'Jiří', last: 'Řepík', g: 'male', b: '1800', d: '1870', bp: 'Řepíkov' });
    marry('ondrej', 'ludmilaV', '1795', ['jiri'], {}, 'Řepíkov');
    add({ id: 'kristinaH', first: 'Kristina', last: 'Hrabánková', g: 'female', b: '1805', d: '1880', bp: 'Hrabanov' });
    add({ id: 'karelR', first: 'Karel', last: 'Řepík', g: 'male', b: '1845', d: '1920', bp: 'Řepíkov' });
    add({ id: 'matous', first: 'Matouš', last: 'Řepík', g: 'male', b: '1848', d: '1910', bp: 'Řepíkov' });
    marry('jiri', 'kristinaH', '1840', ['karelR', 'matous'], {}, 'Řepíkov');
    // Anna Fíšková (1853) marries into the Řepík line.
    marry('matous', 'anna1853', '1874', [], {}, 'Řepíkov');
    add({ id: 'johanaH', first: 'Johana', last: 'Hrabánková', g: 'female', b: '1850', d: '1925', bp: 'Hrabanov' });
    add({ id: 'ludmilaR', first: 'Ludmila', last: 'Řepíková', g: 'female', b: '1883', d: '1960', bp: 'Řepíkov' });
    add({ id: 'vojtechR', first: 'Vojtěch', last: 'Řepík', g: 'male', b: '1880', d: '1950', bp: 'Řepíkov' });
    marry('karelR', 'johanaH', '1878', ['vojtechR', 'ludmilaR'], {}, 'Řepíkov');
    add({ id: 'bohumil', first: 'Bohumil', last: 'Řepík', g: 'male', b: '1915', d: '1990', bp: 'Řepíkov' });
    add({ id: 'hedvika', first: 'Hedvika', last: 'Hrabánková', g: 'female', b: '1918', d: '1995', bp: 'Hrabanov' });
    add({ id: 'petr', first: 'Petr', last: 'Řepík', g: 'male', b: '1950', bp: 'Řepíkov' });
    marry('vojtechR', null, null, ['bohumil']);
    marry('bohumil', 'hedvika', '1946', ['petr'], {}, 'Řepíkov');

    // Antonín ⚭ Ludmila Řepíková: Jaroslav; Jaroslav ⚭ 1950 the living Jana: Eva (* 1952), Pavel.
    add({ id: 'jaroslav', first: 'Jaroslav', last: 'Fíšek', g: 'male', b: '1910', d: '1985' });
    marry('antonin', 'ludmilaR', '1905', ['jaroslav']);
    add({ id: 'jana', first: 'Jana', last: 'Hrabánková', g: 'female', b: '1928', bp: 'Hrabanov' });
    add({ id: 'eva', first: 'Eva', last: 'Fíšková', g: 'female', b: '1952-04-04' });
    add({ id: 'pavel', first: 'Pavel', last: 'Fíšek', g: 'male', b: '1955', d: '2010' });
    const jaroslavJana = marry('jaroslav', 'jana', '1950', ['eva', 'pavel']);
    // Eva ⚭ 1975 Petr Řepík: both living (f24, no family page).
    const f24 = marry('petr', 'eva', '1975');

    const sources: StromData['sources'] = {
        's-marr1846': {
            id: 's-marr1846', title: 'Oddací matrika Čapkov 1840–1860', reference: 'fol. 12',
            excerpts: [{ id: 'x1', dataUrl: CLIP_IMG, width: 1, height: 1, sizeBytes: 300, caption: 'Oddací záznam' }],
        } as Source,
    };
    const places: StromData['places'] = {
        [placeKey('Čapkov')]: { lat: 49.80, lon: 15.20 },
        [placeKey('Kvasín')]: { lat: 49.85, lon: 15.30 },
        [placeKey('Hrabanov')]: { lat: 49.75, lon: 15.10 },
        [placeKey('Řepíkov')]: { lat: 49.90, lon: 15.15 },
    };

    const data: StromData = {
        persons: persons as StromData['persons'], partnerships: partnerships as StromData['partnerships'], sources, places,
        surnameVariants: [['Fíšek', 'Fyšek', 'Fischek']],
    };
    const id = (x: string) => x as PersonId;
    return {
        data,
        ids: {
            jan: id('jan'), josef: id('josef'), anna: id('anna'), terezie: id('terezie'), antonin: id('antonin'), katerina: id('katerina'),
            eva: id('eva'), petr: id('petr'), jaroslav: id('jaroslav'), jana: id('jana'), marie: id('marie'),
            josefA: id('josef1862'), josefB: id('josef1862b'),
        },
        unions: { f9, f10, f24, jaroslavJana, single },
    };
}
