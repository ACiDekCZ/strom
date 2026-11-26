/**
 * Houses in the Table, the lists' rules, the statistics and the search (spec 030 §15). The tree is invented:
 * Bělokamen čp. 16 (once čp. 9, joined by hand), the Prouzals and the Kvitelkas; Mlýnkovice čp. 8.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Partnership, PartnershipId, Person, PersonId, RuleCond, RuleParamsMap, StromData } from '../types.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import { houseLinkHtml } from '../ui/table-view/table-grid.js';
import { lineageIndexOf } from '../person-lists.js';
import { condLabel, condMissing, condNeed, evalNode, livedInHouseIds, ruleHouseChoices, stripTemplateParams } from '../person-list-rules.js';
import { sanitizeCustomRule } from '../person-lists-data.js';
import { ruleCatalog } from '../ui/person-list-rule-editors.js';
import '../ui/person-list-rule-near.js';
import { withYears } from '../ui/person-list-rule-house.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import { DEFAULT_STATS_OPTIONS, STATS_GROUPS, statsContext, statsGroupsOf, statsTable } from '../tree-stats.js';
import { houseStatsParts } from '../ui/tree-stats-ui.js';

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o };
}

function union(id: string, a: string, b: string, children: string[], o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: children as PersonId[], status: 'married', ...o };
}

/**
 * Svatobor Prouzal (1801 čp. 9, † 1856 čp. 16) ∞ 1830 Radegunda (from Mlýnkovice čp. 8)
 *   └ Hostivít Prouzal (1838 čp. 16, census 1880 čp. 16, † 1901 čp. 16) ∞ 1862 Kunhuta Kvitelková (1840, Mlýnkovice čp. 8)
 *       └ Lubor Prouzal (1866 čp. 16, † 1934 čp. 16)
 * Dobromil Kvitelka (1810 Mlýnkovice čp. 8, † 1874 Mlýnkovice čp. 8). Vratislav Hejl (1862 Zálesí, no house).
 */
export function village(): StromData {
    const persons = [
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1801', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1856',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[],
        }),
        person('radegunda', 'Radegunda', 'Prouzalová', 'female', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1806', partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1838', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1901',
            parentIds: ['svatobor', 'radegunda'] as PersonId[], partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
            events: [{ id: 'e-host-census', type: 'census', place: 'Bělokamen', address: 'čp. 16', date: '1880' }],
        }),
        person('kunhuta', 'Kunhuta', 'Kvitelková', 'female', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1840', partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
        }),
        person('lubor', 'Lubor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1866', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1934',
            parentIds: ['hostivit', 'kunhuta'] as PersonId[],
        }),
        person('dobromil', 'Dobromil', 'Kvitelka', 'male', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1810', deathPlace: 'Mlýnkovice', deathAddress: 'čp. 8', deathDate: '1874',
        }),
        person('vratislav', 'Vratislav', 'Hejl', 'male', { birthPlace: 'Zálesí', birthDate: '1862' }),
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {
            u1: union('u1', 'svatobor', 'radegunda', ['hostivit'], { startDate: '1830', startPlace: 'Bělokamen', address: 'čp. 9' }),
            u2: union('u2', 'hostivit', 'kunhuta', ['lubor'], { startDate: '1862', startPlace: 'Bělokamen', address: 'čp. 16' }),
        } as StromData['partnerships'],
        houses: { 'belokamen|16': { merged: ['belokamen|9'] } },
    };
}

describe('the Table\'s House column (§15)', () => {
    const model = buildTableModel(village(), { rev: 1, homeId: null, lang: 'cs', year: 2026 });
    const col = columnById('persons', 'house')!;
    const cell = (id: string) => cellOf(model, model.persons.find(r => r.id === id)!, col);

    it('a person\'s birth house: the tree\'s house, the older number faint in brackets, none without a house', () => {
        expect(col).toBeTruthy();
        expect(cell('hostivit')).toMatchObject({ text: 'Bělokamen čp. 16', house: { id: 'belokamen|16', title: 'Bělokamen čp. 16' }, empty: false });
        expect(cell('hostivit').house!.old).toBeUndefined();
        expect(cell('svatobor')).toMatchObject({ text: 'Bělokamen čp. 16 (9)', house: { id: 'belokamen|16', old: '9' } });
        expect(cell('kunhuta').house?.id).toBe('mlynkovice|8');
        expect(cell('vratislav')).toMatchObject({ empty: true, text: '' });
        expect(cell('vratislav').house).toBeUndefined();
    });

    it('sorts by town, then number; the people without a house last', () => {
        const order = sortRows(model, 'persons', model.persons, [{ col: 'house', dir: 'asc' }]).map(r => r.id);
        expect(order.indexOf('hostivit')).toBeLessThan(order.indexOf('kunhuta'));
        expect(order[order.length - 1]).toBe('vratislav');
    });

    it('an event\'s house: a census, a wedding and a death', () => {
        const ev = columnById('events', 'evHouse')!;
        expect(ev).toBeTruthy();
        const of = (pred: (r: typeof model.events[number]) => boolean) => cellOf(model, model.events.find(pred)!, ev);
        expect(of(r => r.event?.id === 'e-host-census').house?.id).toBe('belokamen|16');
        expect(of(r => r.source === 'marriage' && r.union?.id === 'u1')).toMatchObject({ text: 'Bělokamen čp. 16 (9)' });
        expect(of(r => r.source === 'death' && r.persons[0]?.id === 'dobromil').house?.id).toBe('mlynkovice|8');
    });

    it('the cell is a link to the house page with the older number outside it', () => {
        const html = houseLinkHtml({ id: 'belokamen|16', title: 'Bělokamen čp. 16', old: '9' });
        expect(html).toContain('class="tv-house" data-house="belokamen|16"');
        expect(html).toContain('<span class="tv-house-old"> (9)</span>');
        expect(houseLinkHtml({ id: 'a|<1>', title: '<b>' })).not.toContain('<b>');
    });
});

describe('the lists\' rule Lived in the house (§15)', () => {
    afterEach(() => setLanguage('cs'));
    const index = lineageIndexOf(village());
    const cond = (p: RuleParamsMap['livedInHouse']): RuleCond => ({ t: 'cond', c: 'livedInHouse', p });
    const ids = (p: RuleParamsMap['livedInHouse']) => [...livedInHouseIds(index, p)].sort();

    it('takes in a birth, marriage, census, residence or death at the house, the joined older number too', () => {
        expect(ids({ house: 'belokamen|16', houseName: '' })).toEqual(['hostivit', 'kunhuta', 'lubor', 'radegunda', 'svatobor']);
        // The older number is the same house.
        expect(ids({ house: 'belokamen|9', houseName: '' })).toEqual(ids({ house: 'belokamen|16', houseName: '' }));
        expect(ids({ house: 'mlynkovice|8', houseName: '' })).toEqual(['dobromil', 'kunhuta', 'radegunda']);
    });

    it('in the years: only the facts dated within them', () => {
        expect(ids({ house: 'belokamen|16', houseName: '', years: { from: 1860, to: 1870 } })).toEqual(['hostivit', 'kunhuta', 'lubor']);
        expect(ids({ house: 'belokamen|16', houseName: '', years: { to: 1835 } })).toEqual(['radegunda', 'svatobor']);
        expect(evalNode(index, cond({ house: 'mlynkovice|8', houseName: '', years: { from: 1870 } })).size).toBe(1);
    });

    it('needs a house; a house gone from the tree is missing; a template forgets it', () => {
        expect(condNeed(cond({ house: '', houseName: '' }))).toBe('place');
        expect(condNeed(cond({ house: 'belokamen|16', houseName: '' }))).toBeNull();
        expect(condNeed(cond({ house: 'belokamen|16', houseName: '', years: { from: 1900, to: 1800 } }))).toBe('years');
        expect(condMissing(index, cond({ house: 'zalesi|1', houseName: 'Zálesí čp. 1' }))).toEqual({ kind: 'place', name: 'Zálesí čp. 1' });
        expect(condMissing(index, cond({ house: 'belokamen|9', houseName: '' }))).toBeNull();
        const root = stripTemplateParams({ t: 'group', op: 'all', items: [cond({ house: 'belokamen|16', houseName: 'x', years: { from: 1800 } })] });
        expect(root.items[0]).toMatchObject({ c: 'livedInHouse', p: { house: '', houseName: '', years: { from: 1800 } } });
    });

    it('in words, in every language', () => {
        setLanguage('cs');
        expect(condLabel(cond({ house: 'belokamen|16', houseName: '' }), index)).toBe('žil(a) v domě Bělokamen čp. 16');
        expect(condLabel(cond({ house: 'belokamen|16', houseName: '', years: { from: 1850, to: 1900 } }), index)).toBe('žil(a) v domě Bělokamen čp. 16 v letech 1850–1900');
        setLanguage('en');
        expect(condLabel(cond({ house: 'belokamen|16', houseName: '' }), index)).toBe('lived in the house Bělokamen čp. 16');
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const t = getStringsForLang(lang);
            expect(t.lists.rules.cond.livedInHouse, lang).toBeTruthy();
            expect(t.lists.rules.say.livedInHouse('B 16', '1850–1900'), lang).toContain('1850–1900');
            expect(t.houses.integration.rulePreview(5), lang).toMatch(/5/);
        }
    });

    it('is kept by the list\'s data; the years only when one end is set', () => {
        const ok = sanitizeCustomRule({ v: 1, root: { t: 'group', op: 'all', items: [{ t: 'cond', c: 'livedInHouse', p: { house: 'belokamen|16', houseName: 'U Prouzalů', years: { from: 1850 } } }] } });
        expect(ok?.root.items[0]).toMatchObject({ c: 'livedInHouse', p: { house: 'belokamen|16', houseName: 'U Prouzalů', years: { from: 1850 } } });
        const bare = sanitizeCustomRule({ v: 1, root: { t: 'group', op: 'all', items: [{ t: 'cond', c: 'livedInHouse', p: { house: 'belokamen|16', years: {} } }] } });
        expect((bare?.root.items[0] as RuleCond).p).toEqual({ house: 'belokamen|16', houseName: '' });
        expect(withYears({ house: 'a|1', houseName: '' }, {})).toEqual({ house: 'a|1', houseName: '' });
    });

    it('is offered next to Place and surroundings, only in a tree with houses', () => {
        const cat = ruleCatalog(index).map(e => e.c);
        expect(cat.indexOf('livedInHouse')).toBe(cat.indexOf('near') + 1);
        expect(ruleHouseChoices(index).map(h => h.name)).toEqual(['Bělokamen čp. 16', 'Mlýnkovice čp. 8']);
        const none = village();
        for (const p of Object.values(none.persons)) { delete p!.birthAddress; delete p!.deathAddress; delete p!.events; }
        for (const u of Object.values(none.partnerships)) delete u!.address;
        expect(ruleCatalog(lineageIndexOf(none)).map(e => e.c)).not.toContain('livedInHouse');
    });
});

describe('the statistics of houses (§15)', () => {
    afterEach(() => setLanguage('cs'));
    const data = village();
    const all = Object.keys(data.persons) as PersonId[];
    const table = (ids: PersonId[]) => statsTable(data, ids, 'houses', { ...DEFAULT_STATS_OPTIONS }, statsContext(data));

    it('a topic Houses among the places, only in a tree with a house', () => {
        expect(STATS_GROUPS.find(g => g.id === 'places')!.topics).toContain('houses');
        expect(statsGroupsOf(data, statsContext(data)).find(g => g.id === 'places')!.topics).toEqual(['birthPlaces', 'deathPlaces', 'marriagePlaces', 'houses']);
        const none: StromData = { persons: { vratislav: data.persons['vratislav' as PersonId]! } as StromData['persons'], partnerships: {} };
        expect(statsGroupsOf(none, statsContext(none)).flatMap(g => g.topics)).not.toContain('houses');
    });

    it('ranks the houses by their people (a person under each house), those at none Not given', () => {
        const t = table(all);
        expect(t.rows.map(r => [r.label, r.count])).toEqual([['Bělokamen čp. 16', 5], ['Mlýnkovice čp. 8', 3]]);
        expect(t.none).toEqual(['vratislav']);
        expect(t.units).toBe(7);
        expect(t.known).toBe(6);
        // A scope counts only its people.
        expect(table(['dobromil', 'vratislav'] as PersonId[]).rows.map(r => [r.label, r.count])).toEqual([['Mlýnkovice čp. 8', 1]]);
    });

    it('the house one family held longest and the houses with history somebody married into', () => {
        const t = table(all);
        expect(t.houses?.longest).toMatchObject({ id: 'belokamen|16', title: 'Bělokamen čp. 16' });
        expect(t.houses!.longest!.years).toBeGreaterThanOrEqual(100);
        expect(t.houses!.marriedIn.of).toBeGreaterThanOrEqual(1);
        expect(t.houses!.marriedIn.houses).toBeGreaterThanOrEqual(1);
        setLanguage('cs');
        const parts = houseStatsParts(t);
        expect(parts[0]).toBe(`Nejdéle jedna rodina: Bělokamen čp. 16, ${t.houses!.longest!.years} let`);
        expect(parts[1]).toMatch(/^Přiženění nebo přivdání: \d+ z \d+ dom/);
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const S = getStringsForLang(lang);
            expect(S.treeStats.topics.houses, lang).toBeTruthy();
            expect(S.treeStats.empty.houses, lang).toBeTruthy();
            expect(S.treeStats.note.houses, lang).toBeTruthy();
            expect(S.houses.integration.statsMarriedIn(1, 2), lang).toMatch(/1.*2/);
        }
    });
});
