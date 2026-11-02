/**
 * A fictional tree for the whole tree's pages (spec 026 P3): eight big lines
 * — two unrelated Lhoták lines (Lopuchov, Smrkov), Fíšek, Kvapil, Řepík,
 * Thornbury, Hrnčířík, Jalovec — fourteen small ones ("Other families"; the
 * Brambůrek line only of the living), two people without a surname, the
 * marriages between the lines, and the living Petr Lhoták (* 1978) and Eva
 * Lhotáková (* 1952). `manyLinesFixture` has sixty big lines (the rows).
 * Every name and place is made up.
 */

import { Gender, Partnership, PartnershipId, Person, PersonId, StromData } from '../../types.js';

export const TP_NOW = new Date('2026-11-02T12:00:00Z');

interface P { first: string; last: string; g: Gender; b?: string; d?: string; place?: string; extra?: Partial<Person> }

class Builder {
    persons: Record<string, Person> = {};
    partnerships: Record<string, Partnership> = {};
    private n = 0;
    private un = 0;

    add(x: P, id?: string): PersonId {
        const pid = (id ?? `p${++this.n}`) as PersonId;
        this.persons[pid] = {
            id: pid, firstName: x.first, lastName: x.last, gender: x.g, isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [],
            ...(x.b ? { birthDate: x.b, birthPlace: x.place ?? 'Lopuchov' } : {}),
            ...(x.d ? { deathDate: x.d, deathPlace: x.place ?? 'Lopuchov' } : {}),
            ...(x.extra ?? {}),
        } as Person;
        return pid;
    }

    marry(a: PersonId, b: PersonId | null, date: string | null, kids: PersonId[] = [], place = 'Lopuchov'): PartnershipId {
        const id = `u${++this.un}` as PartnershipId;
        this.partnerships[id] = {
            id, person1Id: a, person2Id: (b ?? '') as PersonId, childIds: [...kids],
            status: date ? 'married' : 'partners', ...(date ? { startDate: date, startPlace: place } : {}),
        };
        this.persons[a].partnerships.push(id);
        if (b) this.persons[b].partnerships.push(id);
        for (const k of kids) {
            this.persons[k].parentIds.push(a);
            this.persons[a].childIds.push(k);
            if (b) { this.persons[k].parentIds.push(b); this.persons[b].childIds.push(k); }
        }
        return id;
    }

    /** A big line: the founder, his wife from nowhere, `sons` sons (and the given extra children). */
    line(surname: string, place: string, from: number, sons = 4): { founder: PersonId; wife: PersonId; union: PartnershipId; kids: PersonId[] } {
        const founder = this.add({ first: 'Vojtěch', last: surname, g: 'male', b: String(from), d: String(from + 60), place });
        const wife = this.add({ first: 'Ludmila', last: 'Šalvějová', g: 'female', b: String(from + 3), d: String(from + 62), place });
        const kids: PersonId[] = [];
        const names = ['Jan', 'Tomáš', 'Šimon', 'Pavel', 'Jindřich', 'Karel'];
        for (let i = 0; i < sons; i++) kids.push(this.add({ first: names[i % names.length], last: surname, g: 'male', b: String(from + 25 + i * 2), d: String(from + 80 + i), place }));
        const union = this.marry(founder, wife, String(from + 24), kids, place);
        return { founder, wife, union, kids };
    }

    data(): StromData {
        return { persons: this.persons, partnerships: this.partnerships } as unknown as StromData;
    }
}

export interface TreePagesFixture {
    data: StromData;
    ids: Record<'marie' | 'vaclav' | 'anna' | 'jan' | 'rosalie' | 'william' | 'matej' | 'jakubZ' | 'rosalieK' | 'petr' | 'eva' | 'jiri' | 'marta'
        | 'tomasB' | 'ondrejB' | 'anezka' | 'bartolomej', PersonId>;
    unions: Record<'vaclavMarie' | 'janRosalie' | 'annaWilliam' | 'jakubRosalie' | 'jiriMarta', PartnershipId>;
}

export function treePagesFixture(): TreePagesFixture {
    const t = new Builder();

    // ── Lhoták of Lopuchov ──
    const lhL = t.line('Lhoták', 'Lopuchov', 1800);
    const vaclav = t.add({ first: 'Václav', last: 'Lhoták', g: 'male', b: '1845', d: '1910', place: 'Lopuchov' }, 'vaclav');
    const jan = t.add({ first: 'Jan', last: 'Lhoták', g: 'male', b: '1850', d: '1920', place: 'Lopuchov' }, 'jan');
    t.marry(lhL.kids[0], t.add({ first: 'Barbora', last: 'Kapustová', g: 'female', b: '1828', d: '1890', place: 'Lopuchov' }), '1844', [vaclav, jan], 'Lopuchov');
    const rosalie = t.add({ first: 'Rosálie', last: 'Rebarborová', g: 'female', b: '1855', d: '1925', place: 'Lopuchov' }, 'rosalie');
    const anna = t.add({ first: 'Anna', last: 'Lhotáková', g: 'female', b: '1868', d: '1940', place: 'Lopuchov' }, 'anna');
    const jiriFather = t.add({ first: 'Josef', last: 'Lhoták', g: 'male', b: '1905', d: '1975', place: 'Lopuchov' });
    const janRosalie = t.marry(jan, rosalie, '1866', [anna], 'Lopuchov');
    const grand = t.add({ first: 'Bedřich', last: 'Lhoták', g: 'male', b: '1875', d: '1944', place: 'Lopuchov' });
    t.marry(jan, null, null, [grand]);
    t.marry(grand, t.add({ first: 'Hedvika', last: 'Pažitková', g: 'female', b: '1880', d: '1950', place: 'Lopuchov' }), '1903', [jiriFather], 'Lopuchov');
    const jiri = t.add({ first: 'Jiří', last: 'Lhoták', g: 'male', b: '1940', d: '2015', place: 'Lopuchov' }, 'jiri');
    const eva = t.add({ first: 'Eva', last: 'Lhotáková', g: 'female', b: '1952', place: 'Lopuchov' }, 'eva');
    t.marry(jiriFather, t.add({ first: 'Vlasta', last: 'Pažitková', g: 'female', b: '1910', d: '1990', place: 'Lopuchov' }), '1938', [jiri, eva], 'Lopuchov');
    const petr = t.add({ first: 'Petr', last: 'Lhoták', g: 'male', b: '1978', place: 'Lopuchov' }, 'petr');

    // ── Fíšek: Marie (married surname Lhotáková) marries Václav Lhoták ──
    const fis = t.line('Fíšek', 'Čapkov', 1790);
    const marie = t.add({ first: 'Marie', last: 'Fíšková', g: 'female', b: '1850', d: '1915', place: 'Čapkov', extra: { marriedSurname: 'Lhotáková' } as Partial<Person> }, 'marie');
    t.marry(fis.kids[1], t.add({ first: 'Kristýna', last: 'Kapustová', g: 'female', b: '1820', d: '1880', place: 'Čapkov' }), '1846', [marie], 'Čapkov');
    const vaclavMarie = t.marry(vaclav, marie, '1872', [], 'Lopuchov');

    // ── Kvapil: Rosálie marries into the small Žbánek line, Marta marries Jiří Lhoták ──
    const kv = t.line('Kvapil', 'Kvasín', 1760);
    const rosalieK = t.add({ first: 'Rosálie', last: 'Kvapilová', g: 'female', b: '1795', d: '1860', place: 'Kvasín' }, 'rosalieK');
    const marta = t.add({ first: 'Marta', last: 'Kvapilová', g: 'female', b: '1945', d: '2019', place: 'Kvasín' }, 'marta');
    t.marry(kv.kids[0], t.add({ first: 'Johana', last: 'Kapustová', g: 'female', b: '1790', d: '1850', place: 'Kvasín' }), '1793', [rosalieK], 'Kvasín');
    const kvLate = t.add({ first: 'Alois', last: 'Kvapil', g: 'male', b: '1915', d: '1980', place: 'Kvasín' });
    t.marry(kv.kids[1], null, null, [kvLate]);
    t.marry(kvLate, t.add({ first: 'Irena', last: 'Šalvějová', g: 'female', b: '1918', d: '1990', place: 'Kvasín' }), '1942', [marta], 'Kvasín');
    const jiriMarta = t.marry(jiri, marta, '1970', [petr], 'Lopuchov');

    // ── Thornbury: Anna Lhotáková marries William ──
    const th = t.line('Thornbury', 'Ashford', 1810);
    const william = t.add({ first: 'William', last: 'Thornbury', g: 'male', b: '1862', d: '1931', place: 'Ashford' }, 'william');
    t.marry(th.kids[0], t.add({ first: 'Margaret', last: 'Pažitková', g: 'female', b: '1840', d: '1900', place: 'Ashford' }), '1860', [william], 'Ashford');
    const annaWilliam = t.marry(william, anna, '1889', [], 'Ashford');

    // ── Lhoták of Smrkov, Řepík, Hrnčířík, Jalovec ──
    const lhS = t.line('Lhoták', 'Smrkov', 1830);
    const rep = t.line('Řepík', 'Řepíkov', 1780);
    const hr = t.line('Hrnčířík', 'Zálesí', 1820);
    const ja = t.line('Jalovec', 'Pažitkov', 1840);
    // Marriages between the lines: a Řepík daughter to the Fíšek line, a Hrnčířík daughter to the Jalovec line, a Jalovec daughter to the Smrkov line.
    const repD = t.add({ first: 'Terezie', last: 'Řepíková', g: 'female', b: '1812', d: '1870', place: 'Řepíkov' });
    t.marry(rep.kids[2], null, null, [repD]);
    t.marry(fis.kids[2], repD, '1834', [], 'Čapkov');
    const hrD = t.add({ first: 'Zdenka', last: 'Hrnčířková', g: 'female', b: '1850', d: '1922', place: 'Zálesí' });
    t.marry(hr.kids[1], null, null, [hrD]);
    t.marry(ja.kids[0], hrD, '1872', [], 'Pažitkov');
    const jaD = t.add({ first: 'Klára', last: 'Jalovcová', g: 'female', b: '1870', d: '1930', place: 'Pažitkov' });
    t.marry(ja.kids[1], null, null, [jaD]);
    t.marry(lhS.kids[0], jaD, '1890', [], 'Smrkov');

    // ── Other families: Žbánek (Jakub ⚭ Rosálie Kvapilová, Matěj), Brambůrek (the living only), twelve more ──
    const jakubZ = t.add({ first: 'Jakub', last: 'Žbánek', g: 'male', b: '1790', d: '1850', place: 'Kvasín' }, 'jakubZ');
    const matej = t.add({ first: 'Matěj', last: 'Žbánek', g: 'male', b: '1817', d: '1861', place: 'Kvasín' }, 'matej');
    const jakubRosalie = t.marry(jakubZ, rosalieK, '1815', [matej], 'Kvasín');
    const tomasB = t.add({ first: 'Tomáš', last: 'Brambůrek', g: 'male', b: '1980', place: 'Hráškov' }, 'tomasB');
    const ondrejB = t.add({ first: 'Ondřej', last: 'Brambůrek', g: 'male', b: '2008', place: 'Hráškov' }, 'ondrejB');
    t.marry(tomasB, null, null, [ondrejB]);
    const smalls: [string, string, number, boolean][] = [
        ['Tykvička', 'Kedlubnov', 1801, true], ['Vrabčák', 'Brokolice', 1822, false], ['Bodlák', 'Hráškov', 1833, true],
        ['Hrášek', 'Hráškov', 1844, false], ['Kmínek', 'Kedlubnov', 1855, true], ['Rybíz', 'Brokolice', 1866, false],
        ['Petržel', 'Smrkov', 1811, true], ['Lopuch', 'Lopuchov', 1823, false], ['Celer', 'Zálesí', 1835, true],
        ['Pórek', 'Pažitkov', 1847, false], ['Kedluben', 'Kedlubnov', 1859, true], ['Brokol', 'Brokolice', 1871, false],
    ];
    for (const [last, place, b, withSon] of smalls) {
        const father = t.add({ first: 'Kryštof', last, g: 'male', b: String(b), d: String(b + 55), place });
        if (withSon) t.marry(father, null, null, [t.add({ first: 'Prokop', last, g: 'male', b: String(b + 28), d: String(b + 70), place })]);
    }

    // ── Without a surname ──
    const anezka = t.add({ first: 'Anežka', last: '', g: 'female', b: '1801', d: '1866', place: 'Smrkov' }, 'anezka');
    const bartolomej = t.add({ first: 'Bartoloměj', last: '', g: 'male', b: '1799', d: '1850', place: 'Smrkov' }, 'bartolomej');

    return {
        data: t.data(),
        ids: { marie, vaclav, anna, jan, rosalie, william, matej, jakubZ, rosalieK, petr, eva, jiri, marta, tomasB, ondrejB, anezka, bartolomej },
        unions: { vaclavMarie, janRosalie, annaWilliam, jakubRosalie, jiriMarta },
    };
}

/** Sixty big lines (the introduction's rows, §1.3): three villages per surname. */
export function manyLinesFixture(lines = 60): StromData {
    const t = new Builder();
    const surnames = ['Jalovec', 'Bodlák', 'Hrášek', 'Kmínek', 'Rybíz', 'Petržel', 'Lopuch', 'Celer', 'Pórek', 'Hrnčířík', 'Kedluben', 'Brokol',
        'Tykvička', 'Vrabčák', 'Žbánek', 'Thornbury', 'Lhoták', 'Kvapil', 'Řepík', 'Fíšek'];
    const places = ['Pažitkov', 'Kedlubnov', 'Brokolice'];
    for (let i = 0; i < lines; i++) t.line(surnames[i % surnames.length], places[Math.floor(i / surnames.length) % places.length], 1700 + (i * 7) % 200);
    return t.data();
}
