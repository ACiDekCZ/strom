/**
 * Tree statistics (spec 138): scopes, the frequency table of every topic,
 * sort, search, share and the CSV. Fictional trees only: every name and
 * place below is invented (Ostrožný, Pětioký, Vochomůrka; Mezihoř, Hrabětice, Žabokřiky).
 */
import { describe, it, expect } from 'vitest';
import { buildLineages, rodOf } from '../lineage.js';
import type { LifeEvent, Partnership, PartnershipId, Person, PersonId, PersonList, PlaceRecord, StromData } from '../types.js';
import {
    DEFAULT_STATS_OPTIONS, STATS_GROUPS, STATS_TOPICS, defaultSort, rowShare, scopePersonIds, searchRows, sexCounts,
    sortRows, statsContext, statsCsv, statsTable, type StatsOptions, type StatsRow, type StatsTable, type StatsTopic,
} from '../tree-stats.js';
import { directLineIds } from '../search-scope.js';

const P = (id: string): PersonId => id as PersonId;

interface Spec {
    first: string; last: string; sex: 'male' | 'female' | 'unknown';
    born?: string; died?: string; bornAt?: string; diedAt?: string; married?: string;
    parents?: string[]; placeholder?: boolean; events?: Partial<LifeEvent>[];
}

function tree(people: Record<string, Spec>, unions: [string, string, string, string[], Partial<Partnership>?][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: P(id), firstName: s.first, lastName: s.last, gender: s.sex, isPlaceholder: s.placeholder === true,
            partnerships: [], parentIds: (s.parents ?? []).map(P), childIds: [],
            ...(s.born ? { birthDate: s.born } : {}), ...(s.died ? { deathDate: s.died } : {}),
            ...(s.bornAt ? { birthPlace: s.bornAt } : {}), ...(s.diedAt ? { deathPlace: s.diedAt } : {}),
            ...(s.married ? { marriedSurname: s.married } : {}),
            ...(s.events ? { events: s.events.map((e, i) => ({ id: `${id}-e${i}`, ...e }) as LifeEvent) } : {}),
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids, extra] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: P(a), person2Id: P(b), childIds: kids.map(P), status: 'married', ...extra };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 26, persons, partnerships } as StromData;
}

const occ = (note: string): Partial<LifeEvent> => ({ type: 'occupation', note });

/** The Ostrožný family of Mezihoř and the Pětioký family of Hrabětice. */
const ostrozni = (): StromData => tree({
    jan: { first: 'Jan', last: 'Ostrožný', sex: 'male', born: '1840-02-10', died: '1904-02-09', bornAt: 'Mezihoř', events: [occ('rolník')] },
    marie: { first: 'Marie', last: 'Vochomůrková', sex: 'female', born: '1845-01-10', bornAt: 'Mezihoř 12', married: 'Ostrožná' },
    jan2: { first: 'jan Karel', last: 'Ostrožný', sex: 'male', born: '1866-05-01', bornAt: 'mezihoř', parents: ['jan', 'marie'], events: [occ('Rolník'), occ('kovář')] },
    anna: { first: 'Anna', last: 'Ostrožná', sex: 'female', born: '~1868', parents: ['jan', 'marie'], married: 'Pětioká' },
    josef: { first: 'Josef', last: 'Pětioký', sex: 'male', born: '1865-03-03', bornAt: 'Hrabětice' },
    joh: { first: 'Joh.', last: 'Vochomůrka', sex: 'male', born: '1871', parents: ['josef', 'anna'] },
    matej: { first: 'Matej', last: 'Pětioký', sex: 'male', born: '1873-08-08', parents: ['josef', 'anna'] },
    matej2: { first: 'Matěj', last: 'Pětioký', sex: 'male', parents: ['josef', 'anna'] },
    noname: { first: '', last: '', sex: 'male', born: '1890-01-01' },
    unknownSex: { first: 'Anna', last: 'Pětioká', sex: 'unknown', born: '1880-04-04' },
    ghost: { first: 'Jan', last: 'Ostrožný', sex: 'male', placeholder: true, born: '1800', bornAt: 'Mezihoř', parents: [] },
    ghostWife: { first: '', last: '', sex: 'female', placeholder: true },
    jan3: { first: 'Jan', last: 'Vochomůrka', sex: 'male', born: '1899-09-09' },
}, [
    ['u1', 'jan', 'marie', ['jan2', 'anna'], { startDate: '1864-06-01', startPlace: 'Mezihoř' }],
    ['u2', 'josef', 'anna', ['joh', 'matej', 'matej2'], { startDate: '1890', startPlace: 'Hrabětice' }],
    ['u3', 'jan3', 'ghostWife', [], { status: 'partners' }],
]);

const opts = (o: Partial<StatsOptions> = {}): StatsOptions => ({ ...DEFAULT_STATS_OPTIONS, ...o });
const all = (data: StromData): PersonId[] => scopePersonIds(data, buildLineages(data), { ref: null }).ids;
const table = (data: StromData, topic: StatsTopic, o: Partial<StatsOptions> = {}, ids = all(data)): StatsTable =>
    statsTable(data, ids, topic, opts(o), statsContext(data, { lang: 'cs' }));
const row = (t: StatsTable, label: string): StatsRow | undefined => t.rows.find(r => r.label === label);
const counts = (t: StatsTable): Record<string, number> => Object.fromEntries(t.rows.map(r => [r.label, r.count]));

describe('topics (§0.2)', () => {
    it('thirteen topics in four groups (Houses only in a tree with a house), value topics sorted by value by default', () => {
        expect(STATS_GROUPS.map(g => g.id)).toEqual(['names', 'places', 'life', 'time']);
        expect(STATS_TOPICS).toHaveLength(13);
        expect(defaultSort('firstNames', opts())).toBe('count');
        expect(defaultSort('deathAge', opts())).toBe('value');
        expect(defaultSort('births', opts({ births: 'month' }))).toBe('value');
    });
});

describe('placeholders never count (K1.6)', () => {
    it('a placeholder is in no scope, no row and no Not given', () => {
        const data = ostrozni();
        const ids = all(data);
        expect(ids).not.toContain(P('ghost'));
        expect(ids).not.toContain(P('ghostWife'));
        const t = table(data, 'firstNames');
        expect(row(t, 'Jan')!.ids).not.toContain(P('ghost'));
        expect(t.none).not.toContain(P('ghost'));
        // Even when a caller passes it in.
        const t2 = statsTable(data, [...ids, P('ghost')], 'birthPlaces', opts(), statsContext(data));
        expect(t2.rows.flatMap(r => r.ids)).not.toContain(P('ghost'));
    });
});

describe('first names (§5)', () => {
    it('first name: the first word, case-insensitive, accents tell names apart, "Joh." its own value, empty → Not given', () => {
        const t = table(ostrozni(), 'firstNames');
        expect(counts(t)).toEqual({ Jan: 3, Josef: 1, 'Joh.': 1, Matej: 1, Matěj: 1 });
        expect(row(t, 'Jan')!.ids.sort()).toEqual([P('jan'), P('jan2'), P('jan3')].sort());
        expect(t.none).toEqual([P('noname')]);
        expect(t.noneCount).toBe(1);
        expect(t.units).toBe(8);
        expect(t.known).toBe(7);
        expect(t.occurrences).toBe(7);
    });

    it('every name: a person counts under each of their names once; occurrences above known', () => {
        const t = table(ostrozni(), 'firstNames', { names: 'each' });
        expect(row(t, 'Jan')!.count).toBe(3);
        expect(row(t, 'Karel')!.ids).toEqual([P('jan2')]);
        expect(t.known).toBe(7);
        expect(t.occurrences).toBe(8);
    });

    it('the label is the most used spelling: "jan" and "Jan" are one name shown as "Jan"', () => {
        const t = table(ostrozni(), 'firstNames');
        expect(t.rows.filter(r => r.key === 'jan')).toHaveLength(1);
        expect(row(t, 'Jan')).toBeDefined();
    });

    it('by sex: women and people of no given sex apart; the counts of the choice', () => {
        const data = ostrozni();
        expect(counts(table(data, 'firstNames', { sex: 'female' }))).toEqual({ Marie: 1, Anna: 1 });
        expect(counts(table(data, 'firstNames', { sex: 'unknown' }))).toEqual({ Anna: 1 });
        expect(sexCounts(data, all(data))).toEqual({ male: 8, female: 2, unknown: 1 });
    });

    it('a hyphenated name is one word', () => {
        const data = tree({ a: { first: 'Jan-Křtitel Josef', last: 'Pětioký', sex: 'male' } }, []);
        expect(counts(table(data, 'firstNames', { names: 'each' }))).toEqual({ 'Jan-Křtitel': 1, Josef: 1 });
    });
});

describe('surnames (§3)', () => {
    it('the male and female form of one surname count together under the more used form, the other as alt', () => {
        const t = table(ostrozni(), 'surnames');
        const o = row(t, 'Ostrožný')!;
        expect(o.count).toBe(3);
        expect(o.alt).toBe('Ostrožná');
        expect(o.ids.sort()).toEqual([P('anna'), P('jan'), P('jan2')].sort());
        expect(row(t, 'Pětioký')!.count).toBe(4); // Josef, Matej, Matěj and Anna Pětioká (no sex given)
        expect(row(t, 'Vochomůrka')!.count).toBe(3); // Joh., Jan and Marie Vochomůrková
        expect(t.none).toEqual([P('noname')]);
    });

    it('"women\'s married too": a married woman counts under her birth and her married surname, once per surname', () => {
        const t = table(ostrozni(), 'surnames', { surnames: 'withMarried' });
        expect(row(t, 'Ostrožný')!.count).toBe(4); // + Marie (Ostrožná by marriage)
        expect(row(t, 'Pětioký')!.count).toBe(5);   // + Anna (Pětioká by marriage)
        expect(t.known).toBe(10);
        expect(t.occurrences).toBe(12);
        // Married within the same family: still once.
        const data = tree({ a: { first: 'Anna', last: 'Pětioká', sex: 'female', married: 'Pětioká' } }, []);
        expect(table(data, 'surnames', { surnames: 'withMarried' }).rows[0]!.count).toBe(1);
    });
});

describe('places (§6)', () => {
    it('streets and houses belong to the town; spellings of one key are one value with their forms', () => {
        const t = table(ostrozni(), 'birthPlaces');
        const m = row(t, 'Mezihoř')!;
        expect(m.count).toBe(3);
        expect(m.forms).toEqual(expect.arrayContaining(['Mezihoř', 'Mezihoř 12', 'mezihoř']));
        expect(m.forms).toHaveLength(3);
        expect(row(t, 'Hrabětice')!.count).toBe(1);
        expect(t.hasLevels).toBe(false);
        expect(t.noneCount).toBe(t.units - t.known);
    });

    it('a baptism stands in for a missing birth place, a burial for a missing death place', () => {
        const data = tree({
            a: { first: 'Jan', last: 'Pětioký', sex: 'male', events: [{ type: 'baptism', place: 'Žabokřiky', date: '1800-01-02' }] },
            b: { first: 'Josef', last: 'Pětioký', sex: 'male', events: [{ type: 'burial', place: 'Hrabětice' }] },
        }, []);
        expect(counts(table(data, 'birthPlaces'))).toEqual({ Žabokřiky: 1 });
        expect(counts(table(data, 'deathPlaces'))).toEqual({ Hrabětice: 1 });
    });

    /** Hrabětice identified by the research under two spellings, in the district of Žabokřiky from 1850, in the land of Morava. */
    const withRecords = (): StromData => {
        const data = tree({
            a: { first: 'Jan', last: 'Pětioký', sex: 'male', born: '1860', bornAt: 'Hrabětice' },
            b: { first: 'Josef', last: 'Pětioký', sex: 'male', born: '1862', bornAt: 'Hrabetice u Žabokřik' },
            c: { first: 'Jan', last: 'Vochomůrka', sex: 'male', born: '1840', bornAt: 'Hrabětice' },
            d: { first: 'Anna', last: 'Vochomůrková', sex: 'female', born: '1841', bornAt: 'Mezihoř' },
            e: { first: 'Marie', last: 'Vochomůrková', sex: 'female', born: '1842', bornAt: 'Žabokřiky' },
        }, []);
        const rec = (r: Partial<PlaceRecord> & { id: string }): PlaceRecord => ({ names: [], ...r }) as PlaceRecord;
        data.placeRecords = {
            L1: rec({ id: 'L1', names: [{ name: 'Hrabětice' }, { name: 'Hrabetice u Žabokřik', kind: 'form' }], parent: 'L9',
                jurisdictions: [{ kind: 'district', name: 'okres Žabokřiky', from: 1850 }] }),
            L2: rec({ id: 'L2', names: [{ name: 'Mezihoř' }], jurisdictions: [{ kind: 'state', name: 'Čechy' }] }),
            L9: rec({ id: 'L9', names: [{ name: 'Morava' }] }),
        };
        data.placeRefs = { 'hrabetice': 'L1', 'hrabetice u zabokrik': 'L1', 'mezihor': 'L2' };
        return data;
    };

    it('the research\'s record unites spellings under its name', () => {
        const t = table(withRecords(), 'birthPlaces');
        const h = row(t, 'Hrabětice')!;
        expect(h.count).toBe(3);
        expect(h.forms).toEqual(['Hrabětice', 'Hrabetice u Žabokřik']);
        expect(t.hasLevels).toBe(true);
    });

    it('district: the jurisdiction valid in the year; outside it or without a record "no district known", muted and last', () => {
        const data = withRecords();
        const ctx = statsContext(data, { labels: { ...labels, noDistrict: 'bez určeného okresu', noCountry: 'bez určené země' } });
        const t = statsTable(data, all(data), 'birthPlaces', opts({ level: 'district' }), ctx);
        expect(counts(t)).toEqual({ 'okres Žabokřiky': 2, 'bez určeného okresu': 3 });
        const sorted = sortRows(t.rows, 'count', 'cs');
        expect(sorted[sorted.length - 1]!.muted).toBe(true);
        expect(sorted[sorted.length - 1]!.ids.sort()).toEqual([P('c'), P('d'), P('e')]);
    });

    it('country: the state, else the top parent record\'s name', () => {
        const data = withRecords();
        const ctx = statsContext(data, { labels: { ...labels, noDistrict: '?', noCountry: 'bez určené země' } });
        const t = statsTable(data, all(data), 'birthPlaces', opts({ level: 'country' }), ctx);
        expect(counts(t)).toEqual({ Morava: 3, Čechy: 1, 'bez určené země': 1 });
    });

    it('without a hierarchy the level is ignored: towns', () => {
        const data = ostrozni();
        expect(counts(table(data, 'birthPlaces', { level: 'district' }))).toEqual(counts(table(data, 'birthPlaces')));
    });

    it('places of marriage: a marriage is the unit, a click shows both partners', () => {
        const t = table(ostrozni(), 'marriagePlaces');
        expect(t.units).toBe(2); // u3 are partners, not married
        expect(row(t, 'Mezihoř')!.ids.sort()).toEqual([P('jan'), P('marie')]);
        expect(row(t, 'Mezihoř')!.count).toBe(1);
    });
});

describe('occupations and religions', () => {
    it('a person with several occupations counts under each, spellings folded', () => {
        const t = table(ostrozni(), 'occupations');
        expect(row(t, 'rolník')?.count ?? row(t, 'Rolník')!.count).toBe(2);
        expect(t.rows).toHaveLength(2);
        expect(t.known).toBe(2);
        expect(t.occurrences).toBe(3);
    });
});

const labels = {
    ageGroup: (a: number, b: number) => `${a}–${b}`, ageTop: (a: number) => `${a} a více`, decade: (a: number) => `${a}–${a + 9}`,
    month: (m: number) => ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'][m - 1]!,
    children: (n: number) => String(n), childrenTop: '10 a více', noDistrict: 'bez určeného okresu', noCountry: 'bez určené země',
};

describe('ages (§3)', () => {
    const ages = (): StromData => tree({
        a: { first: 'Jan', last: 'Pětioký', sex: 'male', born: '1860-06-01', died: '1925-05-31' },   // 64
        b: { first: 'Josef', last: 'Pětioký', sex: 'male', born: '1860-06-01', died: '1925-06-01' }, // 65
        c: { first: 'Anna', last: 'Pětioká', sex: 'female', born: '1860', died: '1865-03-01' },   // 4–5 → lower group
        d: { first: 'Marie', last: 'Pětioká', sex: 'female', born: '1800-01-01', died: '1901-01-01' }, // 101
        e: { first: 'Jan', last: 'Vochomůrka', sex: 'male', born: '1900-01-01' },                      // living / no death
    }, []);

    it('five-year groups by the border, a range across a border in the lower group, 100 and over, the rest Not given', () => {
        const data = ages();
        const t = statsTable(data, all(data), 'deathAge', opts(), statsContext(data, { labels }));
        expect(counts(t)).toEqual({ '60–64': 1, '65–69': 1, '0–4': 1, '100 a více': 1 });
        expect(t.none).toEqual([P('e')]);
        expect(sortRows(t.rows, 'value', 'cs').map(r => r.label)).toEqual(['0–4', '60–64', '65–69', '100 a více']);
    });

    it('age at first marriage: the earliest wedding of the person', () => {
        const t = table(ostrozni(), 'firstMarriageAge');
        // Jan 1840-02-10 → 1864-06-01: 24; Marie 1845-01-10 → 19; Josef 1865-03-03 → "1890": 24–25 → 20–24; Anna ~1868 → ~22.
        expect(counts(t)).toEqual({ '20–24': 3, '15–19': 1 });
        expect(t.none).toContain(P('jan3')); // partners, no wedding: Not given
    });

    it('age at first child: from the eldest child\'s birth, father and mother', () => {
        const t = table(ostrozni(), 'firstChildAge');
        // Jan → Anna ~1868 / Jan Karel 1866-05-01: 26; Marie: 21; Josef → Joh. 1871: 5–6 → 5–9 lower; Anna ~1868 → 1871: ~3.
        expect(row(t, '25–29')!.ids).toEqual([P('jan')]);
        expect(row(t, '20–24')!.ids).toEqual([P('marie')]);
        expect(row(t, '5–9')!.ids).toEqual([P('josef')]);
        expect(row(t, '0–4')!.ids).toEqual([P('anna')]);
    });
});

describe('couples and births', () => {
    it('children per couple: every union with a real partner in the scope, real children only, both partners clicked', () => {
        const data = ostrozni();
        const t = table(data, 'childrenPerCouple');
        expect(counts(t)).toEqual({ 0: 1, 2: 1, 3: 1 });
        expect(row(t, '3')!.ids.sort()).toEqual([P('anna'), P('josef')]);
        expect(row(t, '0')!.ids).toEqual([P('jan3')]); // the placeholder partner is not shown
        expect(t.units).toBe(3);
        expect(t.noneCount).toBe(0);
        // Scope: only Anna → her marriage with Josef counts (one partner is enough).
        const one = statsTable(data, [P('anna')], 'childrenPerCouple', opts(), statsContext(data));
        expect(one.units).toBe(1);
        expect(one.rows[0]!.ids.sort()).toEqual([P('anna'), P('josef')]);
    });

    it('ten and more children in one group', () => {
        const kids: Record<string, Spec> = {};
        for (let i = 0; i < 11; i++) kids[`k${i}`] = { first: 'Jan', last: 'Pětioký', sex: 'male', parents: ['f', 'm'] };
        const data = tree({ f: { first: 'Josef', last: 'Pětioký', sex: 'male' }, m: { first: 'Anna', last: 'Pětioká', sex: 'female' }, ...kids },
            [['u', 'f', 'm', Object.keys(kids)]]);
        const t = statsTable(data, all(data), 'childrenPerCouple', opts(), statsContext(data, { labels }));
        expect(counts(t)).toEqual({ '10 a více': 1 });
    });

    it('births by decade (an estimate counts to its year) and by month (only a known month)', () => {
        const data = ostrozni();
        const ctx = statsContext(data, { labels });
        const dec = statsTable(data, all(data), 'births', opts(), ctx);
        expect(row(dec, '1860–1869')!.count).toBe(3); // Jan Karel 1866, Anna ~1868, Josef 1865
        expect(dec.none).toEqual([P('matej2')]);
        const mon = statsTable(data, all(data), 'births', opts({ births: 'month' }), ctx);
        expect(row(mon, 'leden')!.count).toBe(2); // Marie, the nameless one
        expect(mon.none.sort()).toEqual([P('anna'), P('joh'), P('matej2')].sort());
    });
});

describe('share, sort and search (§4)', () => {
    it('the share is of the units with a value', () => {
        const t = table(ostrozni(), 'firstNames');
        expect(rowShare(t, row(t, 'Jan')!)).toBeCloseTo((3 / 7) * 100);
    });

    it('by count (a tie A–Z), A–Z by the language, by value', () => {
        const rows: StatsRow[] = [
            { key: 'b', label: 'Čeněk', order: 3, count: 2, ids: [] },
            { key: 'a', label: 'Cyril', order: 1, count: 2, ids: [] },
            { key: 'c', label: 'Hynek', order: 2, count: 5, ids: [] },
        ];
        expect(sortRows(rows, 'count', 'cs').map(r => r.label)).toEqual(['Hynek', 'Cyril', 'Čeněk']);
        expect(sortRows(rows, 'name', 'cs').map(r => r.label)).toEqual(['Cyril', 'Čeněk', 'Hynek']);
        expect(sortRows(rows, 'value', 'cs').map(r => r.label)).toEqual(['Cyril', 'Hynek', 'Čeněk']);
    });

    it('search ignores case and diacritics, finds the other form and the spellings', () => {
        const data = ostrozni();
        const names = table(data, 'firstNames');
        expect(searchRows(names.rows, 'MATE').map(r => r.label).sort()).toEqual(['Matej', 'Matěj']);
        expect(searchRows(names.rows, '  ')).toHaveLength(names.rows.length);
        expect(searchRows(table(data, 'surnames').rows, 'ostrozna').map(r => r.label)).toEqual(['Ostrožný']);
        expect(searchRows(table(data, 'birthPlaces').rows, 'mezihor 12').map(r => r.label)).toEqual(['Mezihoř']);
    });
});

describe('scope (§7)', () => {
    const data = ostrozni();
    const index = buildLineages(data);

    it('a family line, a list, a direct line', () => {
        const rod = rodOf(index, P('jan'))!;
        const r = scopePersonIds(data, index, { ref: { kind: 'rod', rodId: rod } });
        expect(r.ids).toContain(P('jan2'));
        expect(r.ids).not.toContain(P('josef'));
        const list: PersonList = { id: 'l1', name: 'Hledat', dynamic: false, personIds: [P('joh'), P('ghost'), P('gone')], sort: 'manual', updated: '2026-11-01T10:00:00Z' };
        data.personLists = [list];
        expect(scopePersonIds(data, buildLineages(data), { ref: { kind: 'list', listId: 'l1' } }).ids).toEqual([P('joh')]);
        const direct = scopePersonIds(data, index, { ref: { kind: 'direct', personId: P('anna') } }).ids;
        expect(direct.sort()).toEqual([P('anna'), P('jan'), P('joh'), P('marie'), P('matej'), P('matej2')].sort());
        expect(scopePersonIds(data, index, { ref: { kind: 'direct', personId: P('ghost') } }).ids).toEqual([]);
    });

    it('the direct line is the search scope\'s direct line of the same person (spec 137 helper)', () => {
        for (const p of Object.values(data.persons)) {
            if (p.isPlaceholder) continue;
            const stats = scopePersonIds(data, index, { ref: { kind: 'direct', personId: p.id } }).ids;
            expect(new Set(stats).size).toBe(stats.length);
            expect([...stats].sort()).toEqual([...directLineIds(data, p.id)].sort());
        }
    });

    it('a period: birth years inclusive, people without a year fall out and are counted; from without to', () => {
        const r = scopePersonIds(data, index, { ref: null, from: 1865, to: 1871 });
        expect(r.ids.sort()).toEqual([P('anna'), P('jan2'), P('joh'), P('josef')].sort());
        expect(r.noYear).toBe(1); // Matěj
        const from = scopePersonIds(data, index, { ref: null, from: 1880 });
        expect(from.ids.sort()).toEqual([P('jan3'), P('noname'), P('unknownSex')].sort());
        expect(scopePersonIds(data, index, { ref: null }).noYear).toBe(0);
    });

    it('a gone selection is empty', () => {
        expect(scopePersonIds(data, index, { ref: { kind: 'list', listId: 'nope' } }).ids).toEqual([]);
    });
});

describe('CSV (§9)', () => {
    const texts = { desc: 'Statistiky: Křestní jména – muži, první jméno · Rozsah: Celý strom · Strom: Ostrožní · 23. 11. 2026',
        head: ['Hodnota', 'Počet', 'Podíl %'] as const, none: 'Neuvedeno', total: 'Celkem' };

    it('BOM, ";", CRLF, the decimal comma, Not given and the total', () => {
        const t = table(ostrozni(), 'firstNames');
        const rows = sortRows(t.rows, 'count', 'cs');
        const csv = statsCsv(t, rows, texts, 'cs');
        expect(csv.startsWith('﻿')).toBe(true);
        const lines = csv.slice(1).split('\r\n');
        expect(lines[0]).toBe(`"${texts.desc}"`); // quoted: it holds a comma (the Table's tableCsvField)
        expect(lines[1]).toBe('Hodnota;Počet;Podíl %');
        expect(lines[2]).toBe('Jan;3;42,9');
        expect(lines[3]).toBe('Joh.;1;14,3');
        expect(lines[lines.length - 3]).toBe('Neuvedeno;1;');
        expect(lines[lines.length - 2]).toBe('Celkem;8;');
        expect(lines[lines.length - 1]).toBe('');
        expect(statsCsv(t, rows, texts, 'en').split('\r\n')[2]).toBe('Jan;3;42.9');
    });

    it('a formula in a value is neutralised; while searching no Not given line', () => {
        const data = tree({ a: { first: '=SUM(A1)', last: 'Pětioký', sex: 'male' }, b: { first: '', last: 'Pětioký', sex: 'male' } }, []);
        const t = table(data, 'firstNames');
        const csv = statsCsv(t, t.rows, { ...texts, searching: true }, 'cs');
        expect(csv).toContain("\r\n'=SUM(A1);1;100,0\r\n");
        expect(csv).not.toContain('Neuvedeno');
        expect(csv.endsWith('Celkem;2;\r\n')).toBe(true);
    });
});
