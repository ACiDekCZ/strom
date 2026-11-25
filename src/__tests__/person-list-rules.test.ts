/**
 * Custom list rules (spec 136 phase 1, U3): the evaluation of conditions and
 * groups (all / any / except, three levels), the one-condition rules as
 * custom ones and back, "Family of a person" and its quick choices, the
 * periods of a life, a place and its surroundings, loops of lists, missing
 * references, the rule in words in every language, the templates, the
 * stored form an older app reads (K1.8), Person.changedAt and the time for
 * large made-up trees (K1.3).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import {
    customLabel, customMissing, customPersonIds, customToRule, evalNode, evalRuleCounts, fillRuleParams, listCycle, makeListTemplate,
    nearPlaces, ruleIssues, ruleNeeds, ruleToCustom, stripTemplateParams, FAMILY_PRESETS,
} from '../person-list-rules.js';
import {
    keptByRuleLoss, lineageIndexOf, listIsAuto, listKind, listPersonIds, listRuleLabel, onPersonsMerged, rulePersonIds, sanitizePersonList,
    sanitizePersonLists, stampChangedAt, subsetForSubtree, withCustomSnapshot, withFrozen, withKeptByRule,
} from '../person-lists.js';
import { LIST_TEMPLATE_IDS, LIST_TEMPLATES, templateNeeds, templateRoot, templatesFor } from '../person-list-templates.js';
import { setLanguage } from '../strings.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import type {
    CustomRule, Partnership, PartnershipId, Person, PersonId, PersonList, PersonListRule, RuleCond, RuleGroup, RuleNode, StromData, TreeId,
} from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const id = (s: string) => s as PersonId;
const uid = (s: string) => s as PartnershipId;
const NOW = Date.parse('2026-11-16T10:30:00.000Z');

function person(pid: string, firstName: string, lastName: string, gender: Person['gender'], extra: Partial<Person> = {}): Person {
    return { id: id(pid), firstName, lastName, gender, partnerships: [], parentIds: [], childIds: [], ...extra } as Person;
}

/**
 * Four generations, all made up. Viktor Ostrovid + Ilsa Quellmayer have
 * Konstantin (a miller of Mlýnky) and Lena; Oskar Talvanen + Mira Fennimar
 * have Brita. Konstantin + Brita have Ada, Emil and little Pavla (died at 3).
 * Ada married Nils Brodwick, their son Tomas. Lena lives in Horní Vranice.
 */
function family(): StromData {
    const occ = (note: string) => ({ id: `o-${note}`, type: 'occupation', note }) as unknown as NonNullable<Person['events']>[number];
    const res = (place: string) => ({ id: `r-${place}`, type: 'residence', place }) as unknown as NonNullable<Person['events']>[number];
    const persons: Record<string, Person> = {
        viktor: person('viktor', 'Viktor', 'Ostrovid', 'male', { birthDate: '1800', deathDate: '1850', birthPlace: 'Vrbatín', partnerships: [uid('u1')], childIds: [id('konst'), id('lena')] }),
        ilsa: person('ilsa', 'Ilsa', 'Quellmayer', 'female', { birthDate: '~1805', deathDate: '1870', partnerships: [uid('u1')], childIds: [id('konst'), id('lena')] }),
        oskar: person('oskar', 'Oskar', 'Talvanen', 'male', { birthDate: '1810', partnerships: [uid('u2')], childIds: [id('brita')] }),
        mira: person('mira', 'Mira', 'Fennimar', 'female', { partnerships: [uid('u2')], childIds: [id('brita')] }),
        konst: person('konst', 'Konstantin', 'Ostrovid', 'male', {
            birthDate: '1830', deathDate: '1890', birthPlace: 'Mlýnky', parentIds: [id('viktor'), id('ilsa')], partnerships: [uid('u3')],
            childIds: [id('ada'), id('emil'), id('pavla')], events: [occ('Mlynář')], story: { text: 'Kept the MILL by the river.', status: 'final' } as Person['story'],
        }),
        lena: person('lena', 'Lena', 'Ostrovid', 'female', { birthDate: '1833', parentIds: [id('viktor'), id('ilsa')], events: [res('Horní Vranice')] }),
        brita: person('brita', 'Brita', 'Talvanen', 'female', { birthDate: 'before 1835', birthPlace: 'Dolní Krsovec', parentIds: [id('oskar'), id('mira')], partnerships: [uid('u3')], childIds: [id('ada'), id('emil'), id('pavla')], notes: 'Mlýn byl její.' }),
        ada: person('ada', 'Ada', 'Ostrovid', 'female', { birthDate: '1860', birthPlace: 'Mlýnky 12', parentIds: [id('konst'), id('brita')], partnerships: [uid('u4')], childIds: [id('tomas')], events: [occ('mlynářka')] }),
        emil: person('emil', 'Emil', 'Ostrovid', 'male', { birthDate: '1862', parentIds: [id('konst'), id('brita')] }),
        pavla: person('pavla', 'Pavla', 'Ostrovid', 'female', { birthDate: '1865', deathDate: '1868', parentIds: [id('konst'), id('brita')] }),
        nils: person('nils', 'Nils', 'Brodwick', 'male', { birthDate: '1858', partnerships: [uid('u4')], childIds: [id('tomas')] }),
        tomas: person('tomas', 'Tomas', 'Brodwick', 'male', { birthDate: '1890', parentIds: [id('nils'), id('ada')] }),
        q: person('q', '?', '', 'unknown', { isPlaceholder: true }),
    };
    const u = (pid: string, a: string, b: string, kids: string[], extra: Partial<Partnership> = {}): Partnership =>
        ({ id: uid(pid), person1Id: id(a), person2Id: id(b), childIds: kids.map(id), status: 'married', ...extra });
    return {
        version: STROM_DATA_VERSION,
        persons: persons as StromData['persons'],
        partnerships: {
            u1: u('u1', 'viktor', 'ilsa', ['konst', 'lena'], { startDate: '1828' }),
            u2: u('u2', 'oskar', 'mira', ['brita']),
            u3: u('u3', 'konst', 'brita', ['ada', 'emil', 'pavla'], { startDate: '1858', startPlace: 'Mlýnky' }),
            u4: u('u4', 'nils', 'ada', ['tomas'], { startDate: '1885' }),
        } as StromData['partnerships'],
        // Mlýnky and Vrbatín 6 km apart, Dolní Krsovec 40 km away; Horní Vranice without a location.
        places: {
            'mlynky': { lat: 49.5, lon: 15.0 },
            'vrbatin': { lat: 49.554, lon: 15.0 },
            'dolni krsovec': { lat: 49.86, lon: 15.0 },
        } as StromData['places'],
    };
}

const cond = (c: RuleCond): RuleCond => c;
const all = (...items: RuleNode[]): RuleGroup => ({ t: 'group', op: 'all', items });
const any = (...items: RuleNode[]): RuleGroup => ({ t: 'group', op: 'any', items });
const not = <T extends RuleNode>(n: T): T => ({ ...n, not: true });
const fam = (pid: string, over: Partial<Extract<RuleCond, { c: 'family' }>['p']> = {}): RuleCond =>
    ({ t: 'cond', c: 'family', p: { personId: id(pid), personName: pid, ...FAMILY_PRESETS.ancestors, ...over } });
const sorted = (s: Iterable<string>) => [...s].sort();

beforeEach(() => setLanguage('en'));
afterEach(() => vi.useRealTimers());

describe('D2: groups all / any / except', () => {
    it('intersects, unites and takes away over three levels; persons once, no placeholders', () => {
        const ix = lineageIndexOf(family());
        const desc = fam('viktor', FAMILY_PRESETS.descendants);
        const born1860s = cond({ t: 'cond', c: 'born', p: { from: 1860, to: 1869 } });
        const male = cond({ t: 'cond', c: 'gender', p: { value: 'male' } });
        const diedYoung = cond({ t: 'cond', c: 'deathAge', p: { to: 5 } });
        expect(sorted(evalNode(ix, all(desc, born1860s)))).toEqual(['ada', 'emil', 'pavla']);
        expect(sorted(evalNode(ix, all(desc, any(born1860s, male))))).toEqual(['ada', 'emil', 'konst', 'pavla', 'tomas', 'viktor']);
        // Level 3: (born in the 1860s or (male and except Viktor's descendants … male only)) minus died young.
        const root = all(desc, any(born1860s, all(male, not(cond({ t: 'cond', c: 'born', p: { to: 1840 } })))), not(diedYoung));
        expect(sorted(evalNode(ix, root))).toEqual(['ada', 'emil', 'tomas']);
        // A group of excepts only is empty.
        expect(evalNode(ix, all(not(male))).size).toBe(0);
        expect([...evalNode(ix, any(desc, desc))].filter(x => x === 'q')).toEqual([]);
    });

    it('counts each node over the whole tree from the same cache, and points at the item that took the result to 0', () => {
        const ix = lineageIndexOf(family());
        const root = all(
            cond({ t: 'cond', c: 'gender', p: { value: 'female' } }),
            cond({ t: 'cond', c: 'born', p: { from: 1860, to: 1869 } }),
            cond({ t: 'cond', c: 'text', p: { query: 'mill', where: 'both' } }),
            cond({ t: 'cond', c: 'near', p: { placeKey: '', placeName: '', events: ['birth'], km: 0 } }),
        );
        const c = evalRuleCounts(ix, root);
        expect(c.nodes.get('0')).toBe(6);   // ilsa, mira, lena, brita, ada, pavla
        expect(c.nodes.get('1')).toBe(3);
        expect(c.nodes.get('2')).toBe(1);   // Konstantin's story ("MILL", any case)
        expect(c.nodes.get('3')).toBeNull(); // incomplete: left out of the total
        expect(c.total).toBe(0);
        expect(c.zeroAt).toBe('2');
    });

    it('text ignores case and accents in the story and the notes', () => {
        const ix = lineageIndexOf(family());
        const t = (query: string, where: 'story' | 'note' | 'both') => sorted(evalNode(ix, all(cond({ t: 'cond', c: 'text', p: { query, where } }))));
        expect(t('mlyn', 'note')).toEqual(['brita']);
        expect(t('MILL', 'story')).toEqual(['konst']);
        expect(t('mill', 'note')).toEqual([]);
    });

    it('occupations by their folded form', () => {
        const ix = lineageIndexOf(family());
        const r = all(cond({ t: 'cond', c: 'occupation', p: { values: ['mlynar', 'mlynarka'], labels: ['mlynář', 'mlynářka'] } }));
        expect(sorted(evalNode(ix, r))).toEqual(['ada', 'konst']);
    });
});

describe('dates', () => {
    it('born / died / married: the whole span of the date in the period; no date never holds', () => {
        const ix = lineageIndexOf(family());
        const b = (from?: number, to?: number) => sorted(evalNode(ix, all(cond({ t: 'cond', c: 'born', p: { from, to } }))));
        // "~1805" is 1803–1807: inside 1800–1810, not inside 1805–1810.
        expect(b(1800, 1810)).toEqual(['ilsa', 'oskar', 'viktor']);
        expect(b(1805, 1810)).toEqual(['oskar']);
        // "before 1835" has no start: it holds only with an open start.
        expect(b(undefined, 1835)).toContain('brita');
        expect(b(1820, 1835)).not.toContain('brita');
        const m = sorted(evalNode(ix, all(cond({ t: 'cond', c: 'married', p: { from: 1850, to: 1860 } }))));
        expect(m).toEqual(['brita', 'konst']);
    });

    it('livedIn: the life overlaps the period; without a death 90 years at most; without dates never', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const ix = lineageIndexOf(family());
        const l = (from: number, to: number) => sorted(evalNode(ix, all(cond({ t: 'cond', c: 'livedIn', p: { from, to } })), { now: NOW }));
        expect(l(1845, 1846)).toEqual(['brita', 'ilsa', 'konst', 'lena', 'oskar', 'viktor']);
        // Lena (born 1833, no death) counts until 1923, Brita (before 1835) until 1925; Mira (no dates) never.
        expect(l(1920, 1925)).toEqual(['ada', 'brita', 'emil', 'lena', 'nils', 'tomas']);
        expect(l(1924, 1930)).not.toContain('lena');
        expect(l(1700, 2000)).not.toContain('mira');
    });

    it('deathAge and alive come from the Table', () => {
        const ix = lineageIndexOf(family());
        expect(sorted(evalNode(ix, all(cond({ t: 'cond', c: 'deathAge', p: { to: 5 } }))))).toEqual(['pavla']);
        const dead = sorted(evalNode(ix, all(cond({ t: 'cond', c: 'alive', p: { value: 'deceased' } }))));
        expect(dead).toEqual(expect.arrayContaining(['viktor', 'ilsa', 'konst', 'pavla']));
    });

    it('added / changed: hours, days and since a day, by env.now', () => {
        const data = family();
        data.persons[id('ada')].addedAt = new Date(NOW - 2 * 3_600_000).toISOString();
        data.persons[id('emil')].addedAt = new Date(NOW - 3 * 86_400_000).toISOString();
        data.persons[id('tomas')].changedAt = new Date(NOW - 30 * 3_600_000).toISOString();
        const ix = lineageIndexOf(data);
        const run = (c: RuleCond) => sorted(evalNode(ix, all(c), { now: NOW }));
        expect(run({ t: 'cond', c: 'added', p: { hours: 24 } })).toEqual(['ada']);
        expect(run({ t: 'cond', c: 'added', p: { days: 7 } })).toEqual(['ada', 'emil']);
        expect(run({ t: 'cond', c: 'changed', p: { days: 2 } })).toEqual(['tomas']);
        expect(run({ t: 'cond', c: 'changed', p: { hours: 24 } })).toEqual([]);
        expect(run({ t: 'cond', c: 'changed', p: { since: '2026-11-01' } })).toEqual(['tomas']);
    });
});

describe('§4 Family of a person', () => {
    it('with the axes of ancestors / descendants it is the same set as the one-condition rule', () => {
        const { data, rootId } = syntheticTree({ persons: 1500 });
        const ix = lineageIndexOf(data);
        const anc = evalNode(ix, all(fam(rootId, FAMILY_PRESETS.ancestors)));
        expect(sorted(anc)).toEqual(sorted(rulePersonIds(ix, { kind: 'ancestors', personId: id(rootId) })));
        const founder = Object.values(data.persons).find(p => !p.isPlaceholder && !p.parentIds.length && p.childIds.length)!;
        const des = evalNode(ix, all(fam(founder.id, FAMILY_PRESETS.descendants)));
        expect(sorted(des)).toEqual(sorted(rulePersonIds(ix, { kind: 'descendants', personId: founder.id })));
        const des2 = evalNode(ix, all(fam(founder.id, { ...FAMILY_PRESETS.descendants, down: 2 })));
        expect(sorted(des2)).toEqual(sorted(rulePersonIds(ix, { kind: 'descendants', personId: founder.id, generations: 2 })));
    });

    it('the quick choices: closest, paternal, maternal, blood, whole family', () => {
        const ix = lineageIndexOf(family());
        const f = (pid: string, preset: keyof typeof FAMILY_PRESETS) => sorted(evalNode(ix, all(fam(pid, FAMILY_PRESETS[preset]))));
        // Siblings of the person and of every ancestor in range: Lena, Konstantin's sister, too.
        expect(f('ada', 'closest')).toEqual(['ada', 'brita', 'emil', 'konst', 'lena', 'nils', 'pavla', 'tomas']);
        expect(f('ada', 'paternal')).toEqual(['ada', 'konst', 'viktor']);
        expect(f('ada', 'maternal')).toEqual(['ada', 'brita', 'mira']);
        expect(f('tomas', 'blood')).toEqual(['ada', 'brita', 'emil', 'ilsa', 'konst', 'lena', 'mira', 'nils', 'oskar', 'pavla', 'tomas', 'viktor']);
        expect(f('emil', 'wholeFamily')).toContain('nils');
        expect(f('emil', 'blood')).not.toContain('nils');
    });
});

describe('§3.3 Place and surroundings', () => {
    it('the place with the parts of its town, then every located place within km', () => {
        const ix = lineageIndexOf(family());
        const near = (km: number, events: ('birth' | 'death' | 'marriage' | 'residence')[] = ['birth', 'death', 'marriage', 'residence']) =>
            sorted(evalNode(ix, all(cond({ t: 'cond', c: 'near', p: { placeKey: 'mlynky', placeName: 'Mlýnky', events, km } }))));
        // km 0: Mlýnky and "Mlýnky 12" (birth of Konstantin and Ada; the wedding of Konstantin and Brita).
        expect(near(0)).toEqual(['ada', 'brita', 'konst']);
        expect(near(0, ['birth'])).toEqual(['ada', 'konst']);
        // 10 km take in Vrbatín (6 km), not Dolní Krsovec (40 km).
        expect(near(10)).toEqual(['ada', 'brita', 'konst', 'viktor']);
        expect(near(50, ['birth'])).toEqual(['ada', 'brita', 'konst', 'viktor']);
        const pl = nearPlaces(ix, { placeKey: 'mlynky', placeName: 'Mlýnky', events: ['birth'], km: 10 });
        expect(pl.places.map(p => p.name)).toEqual(expect.arrayContaining(['Mlýnky', 'Vrbatín']));
        expect(pl.places.find(p => p.name === 'Vrbatín')?.km).toBe(6);
    });

    it('a place without a location counts by name only', () => {
        const ix = lineageIndexOf(family());
        const r = all(cond({ t: 'cond', c: 'near', p: { placeKey: 'horni vranice', placeName: 'Horní Vranice', events: ['residence'], km: 25 } }));
        expect(sorted(evalNode(ix, r))).toEqual(['lena']);
    });
});

describe('has / count', () => {
    it('has a value or not, as the Table sees it', () => {
        const ix = lineageIndexOf(family());
        const has = (what: Parameters<typeof hasCond>[0], have = true) => sorted(evalNode(ix, all(hasCond(what, have))));
        expect(has('story')).toEqual(['konst']);
        expect(has('note')).toEqual(['brita']);
        expect(has('parents', false)).toEqual(['ilsa', 'mira', 'nils', 'oskar', 'viktor']);
        expect(has('birthPlace')).toEqual(['ada', 'brita', 'konst', 'viktor']);
    });

    it('counts children and marriages', () => {
        const ix = lineageIndexOf(family());
        const n = (what: 'children' | 'marriages', cmp: 'min' | 'max', k: number) =>
            sorted(evalNode(ix, all(cond({ t: 'cond', c: 'count', p: { what, cmp, n: k } }))));
        expect(n('children', 'min', 3)).toEqual(['brita', 'konst']);
        expect(n('marriages', 'min', 1)).toEqual(['ada', 'brita', 'ilsa', 'konst', 'mira', 'nils', 'oskar', 'viktor']);
    });
});

function hasCond(what: Extract<RuleCond, { c: 'has' }>['p']['what'], have: boolean): RuleCond {
    return { t: 'cond', c: 'has', p: { have, what } };
}

describe('one-condition rules and custom rules', () => {
    const rules: PersonListRule[] = [
        { kind: 'ancestors', personId: id('ada'), personName: 'Ada Ostrovid' },
        { kind: 'ancestors', personId: id('ada'), generations: 2, personName: 'Ada Ostrovid' },
        { kind: 'descendants', personId: id('viktor'), personName: 'Viktor Ostrovid' },
        { kind: 'line', directionId: 'L1', lineName: 'L1 Mill' },
        { kind: 'tableFilter', rowType: 'persons', filter: { op: 'and', items: [{ chip: 'deceased' }] }, sort: [] },
        { kind: 'added', days: 30 },
    ];
    it('there and back gives the same rule', () => {
        for (const r of rules) expect(customToRule({ v: 1, root: all(ruleToCustom(r)) })).toEqual(r);
        expect(customToRule({ v: 1, root: all(ruleToCustom({ kind: 'rods', rodIds: ['r1'] })) })).toEqual({ kind: 'rods', rodIds: ['r1'] });
    });
    it('gives the same people', () => {
        const ix = lineageIndexOf(family());
        for (const r of rules.filter(r => r.kind === 'ancestors' || r.kind === 'descendants')) {
            expect(sorted(evalNode(ix, all(ruleToCustom(r, ix))))).toEqual(sorted(rulePersonIds(ix, r)));
        }
    });
    it('more than one condition, an except or another family is no one-condition rule', () => {
        expect(customToRule({ v: 1, root: all(fam('ada'), hasCond('photo', false)) })).toBeNull();
        expect(customToRule({ v: 1, root: all(fam('ada', FAMILY_PRESETS.paternal)) })).toBeNull();
        expect(customToRule({ v: 1, root: all(cond({ t: 'cond', c: 'alive', p: { value: 'living' } })) })).toBeNull();
    });
});

describe('§11 loops, issues and missing references', () => {
    const listOf = (lid: string, name: string, target?: string): PersonList => ({
        id: lid, name, dynamic: false, personIds: [], sort: 'old', updated: '',
        ...(target ? { custom: { v: 1, auto: true, root: all(cond({ t: 'cond', c: 'list', p: { listId: target, listName: target } })) } } : {}),
    });

    it('listCycle names the loop, null without one', () => {
        const lists = [listOf('a', 'Millers', 'b'), listOf('b', 'Mill workers', 'c'), listOf('c', 'Neighbours')];
        expect(listCycle(lists, 'c', 'a')).toEqual(['Neighbours', 'Millers', 'Mill workers', 'Neighbours']);
        expect(listCycle(lists, 'a', 'c')).toBeNull();
        expect(ruleIssues(all(cond({ t: 'cond', c: 'list', p: { listId: 'a', listName: 'Millers' } })), { lists, listId: 'c' }))
            .toEqual([{ kind: 'cycle', path: '0', names: ['Neighbours', 'Millers', 'Mill workers', 'Neighbours'] }]);
    });

    it('a loop in stored data gives nothing rather than running forever', () => {
        const data = family();
        data.personLists = [listOf('a', 'A', 'b'), listOf('b', 'B', 'a')];
        const ix = lineageIndexOf(data);
        expect(listPersonIds(ix, data.personLists[0])).toEqual([]);
    });

    it('incomplete, too deep, an except first or alone: cannot be saved', () => {
        const deep = all(all(all(all(hasCond('photo', true)))));
        expect(ruleIssues(deep).map(i => i.kind)).toContain('depth');
        expect(ruleIssues(all(fam('')))).toEqual([{ kind: 'incomplete', path: '0', need: 'person' }]);
        expect(ruleIssues(all(not(hasCond('photo', true)), hasCond('story', true))).map(i => i.kind)).toEqual(['exceptFirst']);
        expect(ruleIssues(all(not(hasCond('photo', true)))).map(i => i.kind)).toEqual(['exceptOnly']);
        expect(ruleIssues(all())).toEqual([{ kind: 'empty', path: '' }]);
        expect(ruleIssues(all(hasCond('photo', true), any(hasCond('story', true), not(hasCond('note', true)))))).toEqual([]);
    });

    it('a person, place or list no longer in the tree is missing and counts as nobody', () => {
        const ix = lineageIndexOf(family());
        const root = any(
            fam('gone', { personName: 'Jorun Talvanen' }),
            cond({ t: 'cond', c: 'near', p: { placeKey: 'zaniklo', placeName: 'Zaniklo', events: ['birth'], km: 5 } }),
            cond({ t: 'cond', c: 'list', p: { listId: 'x', listName: 'Old list' } }),
        );
        expect(evalNode(ix, root).size).toBe(0);
        expect(customMissing(ix, root)).toEqual([
            { kind: 'person', name: 'Jorun Talvanen', path: '0' },
            { kind: 'place', name: 'Zaniklo', path: '1' },
            { kind: 'list', name: 'Old list', path: '2' },
        ]);
        setLanguage('cs');
        expect(customLabel(root, ix)).toContain('Jorun Talvanen – chybí');
    });
});

describe('§8 the rule in words', () => {
    const root: RuleGroup = all(
        fam('j', { personName: 'Jorun Talvanen', up: 0, down: 4 }),
        any(
            cond({ t: 'cond', c: 'born', p: { from: 1800, to: 1850 } }),
            all(
                cond({ t: 'cond', c: 'near', p: { placeKey: 'mlynky', placeName: 'Mlýnky', events: ['birth', 'death', 'marriage', 'residence'], km: 10 } }),
                cond({ t: 'cond', c: 'occupation', p: { values: ['mlynar', 'mlynarka'], labels: ['mlynář', 'mlynářka'] } }),
            ),
        ),
        not(cond({ t: 'cond', c: 'deathAge', p: { to: 5 } })),
    );
    it.each([
        ['cs', 'Potomci: Jorun Talvanen, do 4 generací · a zároveň (narození 1800–1850 nebo (místo Mlýnky do 10 km a zároveň povolání mlynář, mlynářka)) · kromě věk při úmrtí do 5 let'],
        ['en', 'Descendants: Jorun Talvanen, up to 4 generations · and (birth 1800–1850 or (place Mlýnky within 10 km and occupation mlynář, mlynářka)) · except age at death up to 5 years'],
        ['de', 'Nachkommen: Jorun Talvanen, bis 4 Generationen · und (Geburt 1800–1850 oder (Ort Mlýnky bis 10 km und Beruf mlynář, mlynářka)) · außer Sterbealter bis 5 Jahre'],
        ['pl', 'Potomkowie: Jorun Talvanen, do 4 pokoleń · i (urodzenie 1800–1850 lub (miejsce Mlýnky do 10 km i zawód mlynář, mlynářka)) · oprócz wiek w chwili śmierci do 5 lat'],
    ] as const)('%s', (lang, text) => {
        setLanguage(lang);
        expect(customLabel({ v: 1, root })).toBe(text);
        expect(listRuleLabel({ id: 'l', name: 'L', dynamic: false, sort: 'old', updated: '', custom: { v: 1, root, auto: true } })).toBe(text);
    });
});

describe('§7 templates', () => {
    it('twelve with stable ids; each gives a valid rule once its person or place is filled in', () => {
        expect(LIST_TEMPLATE_IDS).toHaveLength(12);
        const ix = lineageIndexOf(family());
        for (const tid of LIST_TEMPLATE_IDS) {
            const root = templateRoot(tid)!;
            const need = templateNeeds(tid);
            const filled = fillRuleParams(root, { person: { id: id('ada'), name: 'Ada Ostrovid' }, place: { key: 'mlynky', name: 'Mlýnky' } });
            expect(ruleIssues(filled), tid).toEqual([]);
            expect(ruleIssues(root).length > 0, tid).toBe(need !== null);
            expect(() => evalNode(ix, filled, { now: NOW })).not.toThrow();
        }
        expect(templateNeeds('missingSource')).toBe('person');
        expect(templateNeeds('nearPlace')).toBe('place');
        expect(templateNeeds('living')).toBeNull();
        expect(templateRoot('nope')).toBeNull();
    });

    it('the research ones only in a research tree; a fresh copy each time', () => {
        expect(templatesFor(false).map(t => t.id)).not.toContain('conflicts');
        expect(templatesFor(true)).toHaveLength(12);
        expect(LIST_TEMPLATES.filter(t => t.research).map(t => t.id)).toEqual(['conflicts', 'inProgress']);
        const a = templateRoot('paternal')!;
        (a.items[0] as Extract<RuleCond, { c: 'family' }>).p.personId = id('x');
        expect(ruleNeeds(templateRoot('paternal')!)).toEqual(['person']);
    });

    it('a saved template keeps the conditions, not the people, places or lists (D5)', () => {
        const root = all(fam('ada'), cond({ t: 'cond', c: 'near', p: { placeKey: 'mlynky', placeName: 'Mlýnky', events: ['birth'], km: 10 } }),
            cond({ t: 'cond', c: 'list', p: { listId: 'a', listName: 'Millers' } }), cond({ t: 'cond', c: 'rod', p: { rodIds: ['r1'], rodName: 'Ostrovid' } }));
        const t = makeListTemplate('t1', 'Millers near', root, '2026-11-16T10:30:00.000Z');
        expect(JSON.stringify(t)).not.toMatch(/ada|mlynky|Millers"|r1|Ostrovid/);
        expect(ruleNeeds(t.root).sort()).toEqual(['list', 'person', 'place', 'rod']);
        expect(stripTemplateParams(root).items).toHaveLength(4);
    });
});

const custom: CustomRule & { auto: boolean } = { v: 1, auto: true, root: all(fam('ada', FAMILY_PRESETS.paternal), hasCond('photo', false)) };
const stored = (over: Partial<PersonList> = {}): PersonList => ({
    id: 'c1', name: 'Paternal without photo', dynamic: false, personIds: [id('konst')], sort: 'old', updated: '', custom,
    origin: { by: 'template', template: 'noPhoto', name: 'Ancestors without a photo', at: '2026-11-16T10:30:00.000Z' }, ...over,
});

describe('§10 Keep by the rule', () => {
    const AT = '2026-11-24T10:30:00.000Z';

    it('a fixed custom list: what was done by hand is counted, then dropped; the rule\'s people stored', () => {
        const ix = lineageIndexOf(family());
        // Lena added by hand (the rule does not find her), Viktor taken out, a manual order.
        const fixed = stored({ custom: { ...custom, auto: false }, personIds: [id('lena'), id('konst')], removed: [id('viktor')], sort: 'manual' });
        expect(listIsAuto(fixed)).toBe(false);
        expect(keptByRuleLoss(ix, fixed)).toEqual({ added: 1, removed: 1, manual: true });
        const kept = withKeptByRule(ix, fixed, AT);
        expect(listIsAuto(kept)).toBe(true);
        expect(kept.custom?.auto).toBe(true);
        expect(kept.dynamic).toBe(false);
        expect(kept.removed).toBeUndefined();
        expect(kept.sort).toBe('old');
        expect(kept.updated).toBe(AT);
        expect(kept.personIds).toEqual(['viktor', 'konst', 'ada']);
        expect(kept.origin).toEqual(fixed.origin);
        // Nothing by hand: nothing to ask about.
        expect(keptByRuleLoss(ix, stored({ custom: { ...custom, auto: false }, personIds: [id('konst')] }))).toEqual({ added: 0, removed: 0, manual: false });
    });

    it('a fixed one-condition list becomes dynamic; a checklist, an automatic list and one without a rule are not switched', () => {
        const ix = lineageIndexOf(family());
        const rule: PersonListRule = { kind: 'ancestors', personId: id('ada') };
        const fixed: PersonList = { id: 'r1', name: 'Ancestors of Ada', dynamic: false, rule, personIds: [id('konst')], done: [id('konst')], sort: 'name', updated: '' };
        const kept = withKeptByRule(ix, fixed, AT);
        expect(kept.dynamic).toBe(true);
        expect(kept.personIds).toBeUndefined();
        expect(kept.done).toBeUndefined();
        expect(kept.sort).toBe('name');
        expect(listPersonIds(ix, kept)).toContain('viktor');
        const work = { ...fixed, checklist: true };
        expect(keptByRuleLoss(ix, work)).toBeNull();
        expect(withKeptByRule(ix, work, AT)).toBe(work);
        expect(keptByRuleLoss(ix, kept)).toBeNull();
        const plain: PersonList = { id: 'p1', name: 'Wedding', dynamic: false, personIds: [id('ada')], sort: 'old', updated: '' };
        expect(keptByRuleLoss(ix, plain)).toBeNull();
        expect(withKeptByRule(ix, plain, AT)).toBe(plain);
    });
});

describe('K1.8 storage an older app reads', () => {
    it('the new app works it out from the rule; an older one (no `custom`) shows the stored people', () => {
        const data = family();
        const ix = lineageIndexOf(data);
        const list = stored();
        expect(listIsAuto(list)).toBe(true);
        expect(listKind(list)).toBe('auto');
        expect(listPersonIds(ix, list)).toEqual(['viktor', 'konst', 'ada']);
        // An older app: the same stored list without the fields it does not know.
        const { custom: _c, origin: _o, ...older } = list;
        expect(listPersonIds(ix, older as PersonList)).toEqual(['konst']);
        expect(listKind(older as PersonList)).toBe('fixed');
    });

    it('the stored people follow the rule (withCustomSnapshot), freeze keeps the rule as fixed', () => {
        const ix = lineageIndexOf(family());
        const next = withCustomSnapshot(ix, stored())!;
        expect(next.dynamic).toBe(false);
        expect(next.personIds).toEqual(['viktor', 'konst', 'ada']);
        expect(withCustomSnapshot(ix, next)).toBeNull();
        const frozen = withFrozen(ix, next, '2026-11-17T00:00:00.000Z');
        expect(frozen.custom?.auto).toBe(false);
        expect(listIsAuto(frozen)).toBe(false);
        expect(frozen.personIds).toEqual(['viktor', 'konst', 'ada']);
    });

    it('a JSON round trip and the load keep custom and origin', () => {
        const data = family();
        data.personLists = [stored()];
        const back = migrateData(JSON.parse(JSON.stringify(data)));
        expect(back.personLists?.[0]).toEqual(stored());
        expect(sanitizePersonLists(JSON.parse(JSON.stringify([stored({ origin: { by: 'agent', at: '2026-11-16T10:30:00.000Z', agent: 'x' } })]))))
            .toEqual([stored({ origin: { by: 'agent', at: '2026-11-16T10:30:00.000Z', agent: 'x' } })]);
    });

    it('a rule the app cannot read whole is not used: the list stays fixed with its people', () => {
        const future = { ...stored(), custom: { v: 2, auto: true, root: all() } };
        const odd = { ...stored(), custom: { v: 1, auto: true, root: { t: 'group', op: 'all', items: [{ t: 'cond', c: 'zodiac', p: {} }] } } };
        for (const raw of [future, odd]) {
            const l = sanitizePersonList(raw)!;
            expect(l.custom).toBeUndefined();
            expect(l.personIds).toEqual(['konst']);
            expect(listIsAuto(l)).toBe(false);
            // Kept as it came (N4b): a newer app takes it back.
            expect(l.customUnknown).toEqual(raw.custom);
        }
    });

    it('a merge follows the person in every condition; a subtree keeps an automatic custom list', () => {
        const data = family();
        data.personLists = [stored()];
        onPersonsMerged(data, id('emil'), id('ada'));
        expect((data.personLists[0].custom!.root.items[0] as Extract<RuleCond, { c: 'family' }>).p.personId).toBe('emil');
        expect(subsetForSubtree([stored()], new Set(['tomas']))).toHaveLength(1);
    });

    it('lists are not part of a GEDCOM export (nothing to lose there)', async () => {
        const { exportToGedcom } = await import('../ged-exporter.js');
        const data = family();
        data.personLists = [stored()];
        const ged = exportToGedcom(data).content;
        expect(ged).not.toContain('noPhoto');
        expect(ged).not.toContain('Paternal without photo');
    });
});

describe('Findings of the check of spec 136 (N3, N4)', () => {
    const AT = '2026-11-12T09:00:00.000Z';
    /** A rule of a newer app: a version and a condition this app does not know, with fields of its own. */
    const newer = { v: 2, auto: true, root: { t: 'group', op: 'all', items: [{ t: 'cond', c: 'zodiac', p: { sign: 'leo' } }] }, by: { x: [1, 2] } };

    it('N3: a built-in template is named in the UI language, a template of the device or an unknown one by its stored name', async () => {
        const { listOriginText } = await import('../ui/person-lists-ui.js');
        const near = stored({ origin: { by: 'template', template: 'nearPlace', name: 'From a place and surroundings', at: AT } });
        const own = stored({ origin: { by: 'template', template: 'own:t1', name: 'Mill villages', at: AT } });
        const unknown = stored({ origin: { by: 'template', template: 'zodiac', name: 'By the stars', at: AT } });
        setLanguage('cs');
        expect(listOriginText(near)).toMatch(/^Ze šablony „Z místa a okolí“ · /);
        expect(listOriginText(own)).toMatch(/^Ze šablony „Mill villages“ · /);
        expect(listOriginText(unknown)).toMatch(/^Ze šablony „By the stars“ · /);
        setLanguage('de');
        expect(listOriginText(near)).toMatch(/^Aus Vorlage „Aus Ort und Umgebung“ · /);
        setLanguage('en');
        expect(listOriginText(near)).toMatch(/^From template “From a place and surroundings” · /);
    });

    it('N4a: an automatic custom list read without its people has them at once; people it came with stay until a save', () => {
        const data = family();
        const { personIds: _p, ...bare } = stored();
        data.personLists = [bare as PersonList];
        expect(migrateData(JSON.parse(JSON.stringify(data))).personLists?.[0].personIds).toEqual(['viktor', 'konst', 'ada']);
        data.personLists = [stored()];
        expect(migrateData(JSON.parse(JSON.stringify(data))).personLists?.[0].personIds).toEqual(['konst']);
        // A fixed custom list or a rule this app cannot read is not worked out.
        data.personLists = [{ ...bare, custom: { ...custom, auto: false } } as PersonList, { ...bare, id: 'c2', name: 'Newer', custom: newer } as unknown as PersonList];
        expect(migrateData(JSON.parse(JSON.stringify(data))).personLists?.map(l => l.personIds)).toEqual([[], []]);
    });

    it('N4b: a rule of a newer app is kept as it came, the list fixed with its people; an app that reads it takes it back', () => {
        const data = family();
        data.personLists = [{ ...stored(), custom: newer } as unknown as PersonList];
        const loaded = migrateData(JSON.parse(JSON.stringify(data)));
        const l = loaded.personLists![0];
        expect(l.custom).toBeUndefined();
        expect(listIsAuto(l)).toBe(false);
        expect(listKind(l)).toBe('fixed');
        expect(listPersonIds(lineageIndexOf(loaded), l)).toEqual(['konst']);
        expect(l.customUnknown).toEqual(newer);
        // Stored and read again: the same, nothing added.
        const again = migrateData(JSON.parse(JSON.stringify(loaded))).personLists![0];
        expect(again).toEqual(l);
        // An app that reads the rule uses it as the list's rule again.
        const readable = sanitizePersonList({ ...stored(), custom: undefined, customUnknown: custom })!;
        expect(readable.custom).toEqual(custom);
        expect(readable.customUnknown).toBeUndefined();
        expect(listIsAuto(readable)).toBe(true);
        // A readable rule wins over one kept from a newer app (a rule set since).
        const both = sanitizePersonList({ ...stored(), customUnknown: newer })!;
        expect(both.custom).toEqual(custom);
        expect(both.customUnknown).toBeUndefined();
    });

    describe('DataManager', () => {
        const TREE = 'rules-findings-tree' as TreeId;
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        let saved: StromData[] = [];
        beforeEach(() => {
            saved = [];
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation((_id, d) => { saved.push(JSON.parse(JSON.stringify(d))); });
            vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue(null);
            vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
            dm.data = migrateData(family());
            dm.currentTreeId = TREE;
            dm.viewMode = false;
            dm.pendingBefore = null;
            UndoManager.setActiveTree(null);
            UndoManager.setActiveTree(TREE);
        });
        afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

        it('N4a: a tree loaded and a tree imported as new carry the people of an automatic custom list', async () => {
            const data = family();
            const { personIds: _p, ...bare } = stored();
            data.personLists = [bare as PersonList];
            DataManager.loadStromData(JSON.parse(JSON.stringify(data)));
            expect(dm.data.personLists?.[0].personIds).toEqual(['viktor', 'konst', 'ada']);
            vi.stubGlobal('window', new EventTarget());
            const made: StromData[] = [];
            vi.spyOn(TreeManager, 'createTreeFromImport').mockImplementation((d) => { made.push(JSON.parse(JSON.stringify(d))); return 'imported-tree' as TreeId; });
            vi.spyOn(TreeManager, 'markDemoTree').mockImplementation(() => {});
            vi.spyOn(TreeManager, 'getTrees').mockReturnValue([]);
            await DataManager.importAsNewTree(JSON.parse(JSON.stringify(data)), 'Imported');
            expect(made[0].personLists?.[0].personIds).toEqual(['viktor', 'konst', 'ada']);
            expect(dm.data.personLists?.[0].personIds).toEqual(['viktor', 'konst', 'ada']);
        });

        it('N4b: a save keeps a newer app\'s rule as it came; a rule set in this app replaces it', () => {
            const data = family();
            data.personLists = [{ ...stored(), custom: newer } as unknown as PersonList];
            dm.data = migrateData(JSON.parse(JSON.stringify(data)));
            expect(DataManager.renamePersonList('c1', 'Paternal by the stars')).toBe(true);
            const last = saved[saved.length - 1].personLists![0];
            expect(last.name).toBe('Paternal by the stars');
            expect(last.customUnknown).toEqual(newer);
            expect(last.custom).toBeUndefined();
            expect(last.personIds).toEqual(['konst']);
            expect(DataManager.setPersonListCustomRule('c1', custom)).toBe(true);
            const ruled = DataManager.getPersonList('c1')!;
            expect(ruled.custom).toEqual(custom);
            expect(ruled.customUnknown).toBeUndefined();
        });
    });
});

describe('D4 Person.changedAt', () => {
    it('stampChangedAt marks people changed, in a union changed, not the new ones', () => {
        const before = family();
        const after = structuredClone(before);
        after.persons[id('emil')].birthPlace = 'Vrbatín';
        after.partnerships[uid('u4')].startPlace = 'Mlýnky';
        after.persons[id('neu')] = person('neu', 'Neu', 'Brodwick', 'male');
        expect(stampChangedAt(before, after, 'T')).toBe(3);
        expect(after.persons[id('emil')].changedAt).toBe('T');
        expect(after.persons[id('nils')].changedAt).toBe('T');
        expect(after.persons[id('ada')].changedAt).toBe('T');
        expect(after.persons[id('neu')].changedAt).toBeUndefined();
        expect(after.persons[id('konst')].changedAt).toBeUndefined();
    });

    describe('DataManager', () => {
        const TREE = 'rules-test-tree' as TreeId;
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        beforeEach(() => {
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
            vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue(null);
            vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
            dm.data = migrateData(family());
            dm.currentTreeId = TREE;
            dm.viewMode = false;
            dm.pendingBefore = null;
            UndoManager.setActiveTree(null);
            UndoManager.setActiveTree(TREE);
        });
        afterEach(() => vi.restoreAllMocks());

        it('an edit of a person writes the time of the change; undo takes it back', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            DataManager.updatePerson(id('emil'), { birthPlace: 'Vrbatín' });
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBe('2026-11-16T10:30:00.000Z');
            expect(DataManager.getPerson(id('ada'))?.changedAt).toBeUndefined();
            DataManager.undo();
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBeUndefined();
        });

        it('an edit from another window (079) gets the time where it is saved: the main window', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            const copy = structuredClone(dm.data);
            copy.persons[id('emil')].birthPlace = 'Vrbatín';
            expect(DataManager.applyWindowEdit(JSON.stringify(copy), 'Edit person')).toBe(true);
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBe('2026-11-16T10:30:00.000Z');
            expect(DataManager.getPerson(id('ada'))?.changedAt).toBeUndefined();
            // A change of the lists alone changes no person.
            const lists = structuredClone(dm.data);
            lists.personLists = [{ id: 'l1', name: 'Letters', dynamic: false, personIds: [id('ada')], sort: 'old', updated: '' }];
            vi.setSystemTime(NOW + 60_000);
            expect(DataManager.applyWindowEdit(JSON.stringify(lists), 'New list', true)).toBe(true);
            expect(DataManager.getPerson(id('ada'))?.changedAt).toBeUndefined();
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBe('2026-11-16T10:30:00.000Z');
        });

        it('a merge written here gives the time; its undo and redo put back the people\'s own (keepChangedAt)', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            const original = structuredClone(dm.data);
            const merged = structuredClone(dm.data);
            merged.persons[id('emil')].birthPlace = 'Vrbatín';
            expect(DataManager.adoptMergeResult(TREE, merged, 'Merge')).toBe(true);
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBe('2026-11-16T10:30:00.000Z');
            vi.setSystemTime(NOW + 60_000);
            expect(DataManager.adoptMergeResult(TREE, structuredClone(original), 'Undo the merge', true)).toBe(true);
            expect(DataManager.getPerson(id('emil'))?.changedAt).toBeUndefined();
            expect(DataManager.getPerson(id('emil'))?.birthPlace).toBe(original.persons[id('emil')].birthPlace);
        });

        it('a custom list is stored with dynamic false and its people, refreshed when they change', () => {
            const made = DataManager.createCustomPersonList({ name: 'Paternal without photo', custom: stored().custom!, origin: stored().origin })!;
            const kept = DataManager.getPersonList(made.id)!;
            expect(kept.dynamic).toBe(false);
            expect(kept.custom?.auto).toBe(true);
            expect(kept.origin?.by).toBe('template');
            expect(sorted(kept.personIds ?? [])).toEqual(['ada', 'konst', 'viktor']);
            DataManager.updatePerson(id('konst'), { photo: 'data:image/jpeg;base64,AA==' });
            expect(sorted(DataManager.getPersonList(made.id)!.personIds ?? [])).toEqual(['ada', 'viktor']);
            // A rule the tiles know stays a one-condition rule.
            const simple = DataManager.createCustomPersonList({ name: 'Anc', custom: { v: 1, auto: true, root: all(fam('ada')) } })!;
            expect(simple.rule).toEqual({ kind: 'ancestors', personId: 'ada', personName: 'ada' });
            expect(simple.custom).toBeUndefined();
            // An incomplete rule is refused.
            expect(DataManager.createCustomPersonList({ name: 'X', custom: { v: 1, auto: true, root: all(fam('')) } })).toBeNull();
        });

        it('a list\'s rule replaced by a custom one and back', () => {
            const l = DataManager.createPersonList({ name: 'Anc', dynamic: true, rule: { kind: 'ancestors', personId: id('ada') } })!;
            expect(DataManager.setPersonListCustomRule(l.id, stored().custom!)).toBe(true);
            const c = DataManager.getPersonList(l.id)!;
            expect(c.rule).toBeUndefined();
            expect(c.custom?.auto).toBe(true);
            expect(c.dynamic).toBe(false);
            expect(DataManager.setPersonListRule(l.id, { kind: 'descendants', personId: id('viktor') }, true)).toBe(true);
            expect(DataManager.getPersonList(l.id)!.custom).toBeUndefined();
        });
    });
});

describe('K1.3 performance on made-up trees', () => {
    /** The rule of frame 6 / §8 over a founder's descendants, with occupations and located places in the tree. */
    function setup(n: number) {
        const { data } = syntheticTree({ persons: n });
        const ids = Object.keys(data.persons) as PersonId[];
        ids.forEach((pid, i) => {
            const p = data.persons[pid];
            if (p.isPlaceholder) return;
            if (i % 7 === 0) p.events = [...(p.events ?? []), { id: `occ${i}`, type: 'occupation', note: i % 14 ? 'Mlynář' : 'mlynářka' } as NonNullable<Person['events']>[number]];
        });
        data.places = {};
        for (let k = 0; k < 120; k++) data.places[`ves ${k}`] = { lat: 49 + (k % 12) * 0.05, lon: 15 + Math.floor(k / 12) * 0.05 };
        const founder = Object.values(data.persons).find(p => !p.isPlaceholder && !p.parentIds.length && p.childIds.length)!;
        const root: RuleGroup = all(
            fam(founder.id, { up: 0, down: 'all', width: 'cousins', cousins: 'all' }),
            any(
                cond({ t: 'cond', c: 'born', p: { from: 1800, to: 1850 } }),
                all(
                    cond({ t: 'cond', c: 'near', p: { placeKey: 'ves 1', placeName: 'Ves 1', events: ['birth', 'death', 'marriage', 'residence'], km: 10 } }),
                    cond({ t: 'cond', c: 'occupation', p: { values: ['mlynar', 'mlynarka'], labels: ['mlynář', 'mlynářka'] } }),
                ),
            ),
            not(cond({ t: 'cond', c: 'deathAge', p: { to: 5 } })),
        );
        const list: PersonList = { id: 'p', name: 'Perf', dynamic: false, sort: 'old', updated: '', custom: { v: 1, root, auto: true } };
        return { data, root, list };
    }

    it.each([[5000, 200], [20000, 1000]] as const)('%i people within %i ms (list and per-row counts)', (n, budget) => {
        const { data, root, list } = setup(n);
        let total = 0;
        const run = () => {
            const ix = lineageIndexOf({ ...data });   // a new data revision each time: nothing cached
            total += listPersonIds(ix, list, { now: NOW, lang: 'en' }).length;
            total += evalRuleCounts(ix, root, { now: NOW, lang: 'en' }).total;
            return total;
        };
        const first = customPersonIds(lineageIndexOf({ ...data }), list.custom!, { now: NOW, lang: 'en' });
        expect(first.length).toBeGreaterThan(0);
        const m = measureAgainstBudget(run, { budgetMs: budget, calibrationRounds: 4, referenceMs: 22, minPairs: 2, maxPairs: 5, maxWallMs: 60_000 });
        console.log(budgetReport(`custom rule of frame 6, ${n} people`, m, budget));
        if (m.judged) expect(m.ms).toBeLessThan(budget);
    }, 180_000);
});
