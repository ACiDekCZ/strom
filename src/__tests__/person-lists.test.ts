/**
 * Lists of people (spec 084, D1): stored form and migration (data version
 * 22), the ready-made "Added in the last 30 days", who is in a list for each
 * rule, the orders, the changes a list allows, the cleanup when people are
 * deleted or merged, a subtree's lists, unique names, Person.addedAt from
 * every source, the DataManager methods (undo, toasts, read-only, another
 * window) and the time for a 5 000-person tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager, migrateData, type WindowEditSink } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StorageManager } from '../storage.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState } from '../merge/index.js';
import { executeMerge } from '../merge/executor.js';
import { extractSubtree } from '../subtree.js';
import { carryOverMedia } from '../research-link.js';
import { validateJsonImport } from '../merge/validation.js';
import { applyContentOptions, applyLivingPrivacy } from '../privacy.js';
import { exportToGedcom } from '../ged-exporter.js';
import {
    ADDED30_ID, builtinAdded30, foldListName, keepPersonListData, listCount, listDisplayName, listKind, listPersonIds, listSummary,
    onPersonDeleted, onPersonsMerged, personListsOf, ruleBroken, ruleLabel, sanitizePersonList, sanitizePersonLists, stampResearchTree,
    subsetForSubtree, suggestListName, withChecklist, withDoneToggled, withFrozen, withPersonMoved, withPersonsAdded,
    withPersonsRemoved, withRuleFilled, withSort, lineageIndexOf,
} from '../person-lists.js';
import { listKindIcon } from '../ui/list-kind-icon.js';
import { buildLineages } from '../lineage.js';
import { setLanguage, strings } from '../strings.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { STROM_DATA_VERSION, type Partnership, type PartnershipId, type Person, type PersonId, type PersonList, type StromData, type TreeId } from '../types.js';

const id = (s: string) => s as PersonId;
const uid = (s: string) => s as PartnershipId;

function person(pid: string, firstName: string, lastName: string, gender: Person['gender'], extra: Partial<Person> = {}): Person {
    return { id: id(pid), firstName, lastName, gender, partnerships: [], parentIds: [], childIds: [], ...extra } as Person;
}

/**
 * Two generations above two children: Viktor Ostrovid + Ilsa Quellmayer have
 * Konstantin, who married Brita Talvanen; their children Ada and Emil.
 * Brita's parents: Oskar Talvanen + Mira Fennimar. Plus a "?" stand-in.
 */
function family(): StromData {
    const persons: Record<string, Person> = {
        viktor: person('viktor', 'Viktor', 'Ostrovid', 'male', { birthDate: '1850-03-01', partnerships: [uid('u1')], childIds: [id('konst')] }),
        ilsa: person('ilsa', 'Ilsa', 'Quellmayer', 'female', { birthDate: '1852', partnerships: [uid('u1')], childIds: [id('konst')] }),
        oskar: person('oskar', 'Oskar', 'Talvanen', 'male', { birthDate: '1849', partnerships: [uid('u2')], childIds: [id('brita')] }),
        mira: person('mira', 'Mira', 'Fennimar', 'female', { partnerships: [uid('u2')], childIds: [id('brita')] }),
        konst: person('konst', 'Konstantin', 'Ostrovid', 'male', { birthDate: '1880-05-02', parentIds: [id('viktor'), id('ilsa')], partnerships: [uid('u3')], childIds: [id('ada'), id('emil')], photo: 'data:image/jpeg;base64,AA==' }),
        brita: person('brita', 'Brita', 'Talvanen', 'female', { birthDate: '1884', parentIds: [id('oskar'), id('mira')], partnerships: [uid('u3')], childIds: [id('ada'), id('emil')], birthSourceIds: ['s1'] }),
        ada: person('ada', 'Ada', 'Ostrovid', 'female', { birthDate: '1910-01-10', parentIds: [id('konst'), id('brita')], story: { text: 'Ada kept the bakery.', status: 'final' } as Person['story'] }),
        emil: person('emil', 'Emil', 'Ostrovid', 'male', { birthDate: '1912', parentIds: [id('konst'), id('brita')] }),
        q: person('q', '?', '', 'unknown', { isPlaceholder: true }),
    };
    const u = (pid: string, a: string, b: string, kids: string[]): Partnership =>
        ({ id: uid(pid), person1Id: id(a), person2Id: id(b), childIds: kids.map(id), status: 'married' });
    return {
        version: STROM_DATA_VERSION,
        persons: persons as StromData['persons'],
        partnerships: { u1: u('u1', 'viktor', 'ilsa', ['konst']), u2: u('u2', 'oskar', 'mira', ['brita']), u3: u('u3', 'konst', 'brita', ['ada', 'emil']) } as StromData['partnerships'],
        sources: { s1: { id: 's1', title: 'Parish register' } } as StromData['sources'],
    };
}

function fixed(over: Partial<PersonList> = {}): PersonList {
    return { id: 'pl1', name: 'Archive request', dynamic: false, personIds: [], sort: 'manual', updated: '', ...over };
}

const NOW = Date.parse('2026-11-16T10:30:00.000Z');

beforeEach(() => setLanguage('en'));
afterEach(() => vi.useRealTimers());

describe('stored lists (data version 22)', () => {
    it('reads back only what the app can use', () => {
        const lists = sanitizePersonLists([
            { id: 'a', name: '  Archive  ', dynamic: false, personIds: ['x', 'x', 7, 'y'], sort: 'manual', updated: 't', done: ['y'], removed: ['z'], checklist: true },
            { id: 'a', name: 'Duplicate id', dynamic: false, sort: 'old', updated: '' },
            { id: 'b', name: 'No rule', dynamic: true, sort: 'old', updated: '' },
            { id: 'c', name: 'Auto', dynamic: true, rule: { kind: 'ancestors', personId: 'p', generations: 3.7 }, sort: 'manual', personIds: ['q'], checklist: true, updated: '' },
            { id: 'd', name: '', dynamic: false, sort: 'old', updated: '' },
            { id: 'e', name: 'Bad sort', dynamic: false, sort: 'nope', updated: '' },
            'junk',
        ])!;
        expect(lists.map(l => l.id)).toEqual(['a', 'c', 'e']);
        expect(lists[0]).toEqual({ id: 'a', name: 'Archive', dynamic: false, personIds: ['x', 'y'], removed: ['z'], sort: 'manual', checklist: true, done: ['y'], updated: 't' });
        // An automatic list: no manual order, no people of its own, no ticking off.
        expect(lists[1]).toEqual({ id: 'c', name: 'Auto', dynamic: true, rule: { kind: 'ancestors', personId: 'p', generations: 3 }, sort: 'old', updated: '' });
        expect(lists[2].sort).toBe('old');
        expect(sanitizePersonLists([])).toBeUndefined();
        expect(sanitizePersonList({ id: 'x', name: '', builtin: 'added30', dynamic: true, rule: { kind: 'added', days: 30 }, sort: 'added', updated: '' })?.builtin).toBe('added30');
    });

    it('a load keeps the lists, the deleted ready-made list and the date a person came; junk goes', () => {
        const d = family() as StromData & Record<string, unknown>;
        d.persons[id('ada')].addedAt = '2026-11-01T08:00:00.000Z';
        (d.persons[id('emil')] as unknown as Record<string, unknown>).addedAt = 42;
        d.personLists = [fixed({ personIds: [id('ada')] })];
        d.personListsDropped = ['added30', 'other'] as never;
        d.tableViews = [{ id: 'v', name: 'V', rowType: 'persons', columns: [], pinned: 1, collapsedGroups: [], coverageRow: true, filter: { op: 'and', items: [] }, sort: [],
            scope: { listId: 'pl1' }, group: { by: 'nonsense' as never, collapsed: [] }, updated: '' }];
        const out = migrateData(JSON.parse(JSON.stringify(d)));
        expect(out.personLists).toEqual(d.personLists);
        expect(out.personListsDropped).toEqual(['added30']);
        expect(out.persons[id('ada')].addedAt).toBe('2026-11-01T08:00:00.000Z');
        expect('addedAt' in out.persons[id('emil')]).toBe(false);
        expect(out.tableViews![0].scope).toEqual({ listId: 'pl1' });
        expect(out.tableViews![0].group).toBeUndefined();
    });

    it('an older tree gets no list and no date stored: the ready-made list exists without being stored', () => {
        const out = migrateData({ version: 21, persons: family().persons, partnerships: family().partnerships });
        expect(out.personLists).toBeUndefined();
        expect(Object.values(out.persons).some(p => p.addedAt)).toBe(false);
        expect(personListsOf(out).map(l => l.id)).toEqual([ADDED30_ID]);
        expect(listDisplayName(personListsOf(out)[0])).toBe('Added in the last 30 days');
    });

    it('a JSON import carries the lists', () => {
        const d = { ...family(), personLists: [fixed({ personIds: [id('ada')] })] };
        const r = validateJsonImport(JSON.stringify(d));
        expect(r.data?.personLists).toEqual(d.personLists);
    });

    it('a full JSON export or backup carries the lists, the deleted ready-made list and the dates added', () => {
        const d = family();
        d.persons[id('ada')].addedAt = '2026-11-01T08:00:00.000Z';
        d.personLists = [fixed({ personIds: [id('ada')] })];
        d.personListsDropped = ['added30'];
        const out = JSON.parse(JSON.stringify(applyContentOptions(applyLivingPrivacy(d, 'full'), true))) as StromData;
        expect(out.personLists).toEqual(d.personLists);
        expect(out.personListsDropped).toEqual(['added30']);
        expect(out.persons[id('ada')].addedAt).toBe('2026-11-01T08:00:00.000Z');
        // Read back: still no ready-made list (deleted for good), the fixed one stays.
        const back = validateJsonImport(JSON.stringify(out)).data!;
        expect(personListsOf(back).map(l => l.id)).toEqual(['pl1']);
    });

    it('a GEDCOM export carries neither the lists nor the dates added', () => {
        const d = family();
        d.persons[id('ada')].addedAt = '2026-11-01T08:00:00.000Z';
        d.personLists = [fixed({ name: 'Archive request', personIds: [id('ada')] })];
        const { content } = exportToGedcom(d, 'T');
        expect(content).not.toContain('Archive request');
        expect(content).not.toContain('2026-11-01');
        expect(content).not.toMatch(/1 NOV 2026/);
    });
});

describe('the ready-made "Added in the last 30 days" (Q3)', () => {
    it('is there until stored or deleted, and never comes back once deleted', () => {
        expect(personListsOf({}).map(l => l.id)).toEqual([ADDED30_ID]);
        expect(personListsOf({ personListsDropped: ['added30'] })).toEqual([]);
        const stored = { ...builtinAdded30(), name: 'New this month', updated: 't' };
        expect(personListsOf({ personLists: [stored] })).toEqual([stored]);
    });

    it('its name follows its period until renamed', () => {
        const b = builtinAdded30();
        expect(listDisplayName(b)).toBe('Added in the last 30 days');
        expect(listDisplayName({ ...b, rule: { kind: 'added', days: 7 } })).toBe('Added in the last 7 days');
        expect(listDisplayName({ ...b, rule: { kind: 'added', days: 7 }, name: 'This week' })).toBe('This week');
        setLanguage('cs');
        expect(listDisplayName(b)).toBe('Přidáno za posledních 30 dní');
    });
});

describe('who is in a list', () => {
    it('ancestors and descendants: blood members only, no placeholders, no spouses', () => {
        const ix = buildLineages(family());
        const anc = { ...fixed(), dynamic: true, sort: 'gen' as const, rule: { kind: 'ancestors' as const, personId: id('ada') } };
        expect(listPersonIds(ix, anc)).toEqual(['ada', 'konst', 'brita', 'oskar', 'viktor', 'ilsa', 'mira']);
        const two = { ...anc, rule: { kind: 'ancestors' as const, personId: id('ada'), generations: 1 } };
        expect(listPersonIds(ix, two)).toEqual(['ada', 'konst', 'brita']);
        const des = { ...anc, rule: { kind: 'descendants' as const, personId: id('viktor') } };
        // Konstantin's wife Brita married in: not a descendant.
        expect(listPersonIds(ix, des)).toEqual(['viktor', 'konst', 'ada', 'emil']);
    });

    it('a family line: its blood members', () => {
        const ix = buildLineages(family());
        const rod = [...ix.rods.values()].find(r => r.surname === 'Ostrovid')!;
        const l = { ...fixed(), dynamic: true, sort: 'old' as const, rule: { kind: 'rods' as const, rodIds: [rod.id] } };
        expect(listPersonIds(ix, l)).toEqual(['viktor', 'konst', 'ada', 'emil']);
        expect(ruleLabel(l.rule, ix)).toContain('Ostrovid');
        expect(ruleBroken(ix, { kind: 'rods', rodIds: ['gone'] })).toEqual({ kind: 'rod' });
    });

    it('a research line: the people the Table\'s line chip shows', () => {
        const d = family();
        d.researchDirections = { complete: true, lines: [{ id: 'G1', name: 'Ostrovid line' }, { id: 'G2', name: 'Other' }], branches: [] };
        for (const [pid, refn, line] of [['konst', 'P1', 'G1'], ['ada', 'P2', 'G1'], ['emil', 'P3', 'G2']] as const) {
            d.persons[id(pid)].refn = refn;
            d.persons[id(pid)].research = { places: [{ role: 'line', line }] } as Person['research'];
        }
        const ix = buildLineages(d);
        const l = { ...fixed(), dynamic: true, sort: 'old' as const, rule: { kind: 'line' as const, directionId: 'G1' } };
        expect(listPersonIds(ix, l)).toEqual(['konst', 'ada']);
        expect(ruleLabel(l.rule, ix)).toBe('Research line: G1 Ostrovid line');
        expect(ruleBroken(ix, { kind: 'line', directionId: 'G9' })).toEqual({ kind: 'line' });
    });

    it('a Table filter: the rows it passes in its order; for unions both partners', () => {
        const ix = buildLineages(family());
        const born = { ...fixed(), dynamic: true, sort: 'old' as const, rule: { kind: 'tableFilter' as const, rowType: 'persons' as const, filter: { op: 'and' as const, items: [{ chip: 'noBirth' }] }, sort: [] } };
        expect(listPersonIds(ix, born)).toEqual(['mira']);
        const unions = { ...born, rule: { ...born.rule, rowType: 'unions' as const, filter: { op: 'and' as const, items: [] } } };
        expect(new Set(listPersonIds(ix, unions))).toEqual(new Set(['viktor', 'ilsa', 'oskar', 'mira', 'konst', 'brita']));
    });

    it('added in the last n days: today counts as the first day; people without the date never', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        const d = family();
        d.persons[id('ada')].addedAt = '2026-11-16T09:00:00.000Z';
        d.persons[id('emil')].addedAt = '2026-10-18T12:00:00.000Z';   // 29 days back: in
        d.persons[id('konst')].addedAt = '2026-10-10T12:00:00.000Z';  // 37 days back: out
        d.persons[id('brita')].addedAt = '2026-11-02';                // a GEDCOM import's bare day
        const ix = buildLineages(d);
        expect(listPersonIds(ix, builtinAdded30())).toEqual(['ada', 'brita', 'emil']);
        expect(listPersonIds(ix, { ...builtinAdded30(), rule: { kind: 'added', days: 1 } })).toEqual(['ada']);
    });

    it('a fixed list: its people still in the tree, never a placeholder', () => {
        const ix = buildLineages(family());
        const l = fixed({ personIds: [id('emil'), id('gone'), id('q'), id('ada')] });
        expect(listPersonIds(ix, l)).toEqual(['emil', 'ada']);
        expect(listCount(ix, l)).toBe(2);
        expect(listPersonIds(ix, l)).toBe(listPersonIds(ix, l));   // one evaluation per data revision
    });

    it('a deleted rule person: nothing found, the stored name tells who', () => {
        const ix = buildLineages(family());
        const rule = { kind: 'ancestors' as const, personId: id('gone'), personName: 'Ilsa Quellmayer' };
        expect(listPersonIds(ix, { ...fixed(), dynamic: true, sort: 'gen', rule })).toEqual([]);
        expect(ruleBroken(ix, rule)).toEqual({ kind: 'person', name: 'Ilsa Quellmayer' });
        expect(ruleLabel(rule, ix)).toBe('Ancestors of Ilsa Quellmayer, all generations');
    });
});

describe('the order of a list', () => {
    const all = [id('emil'), id('mira'), id('ada'), id('viktor'), id('konst')];
    it('oldest first, by generation, by name, by date added, manual', () => {
        const d = family();
        d.persons[id('ada')].addedAt = '2026-11-10T08:00:00.000Z';
        d.persons[id('emil')].addedAt = '2026-11-12T08:00:00.000Z';
        const ix = buildLineages(d);
        const l = (sort: PersonList['sort']) => listPersonIds(ix, fixed({ personIds: all, sort }));
        expect(l('manual')).toEqual(all);
        expect(l('old')).toEqual(['viktor', 'konst', 'ada', 'emil', 'mira']);   // no year last
        expect(l('name')).toEqual(['mira', 'ada', 'emil', 'konst', 'viktor']);
        expect(l('added')).toEqual(['emil', 'ada', 'viktor', 'konst', 'mira']);
        // By generation from the rule's person: Ada 0, her parents 1, grandparents 2 (oldest first within).
        const anc = { ...fixed(), dynamic: true, sort: 'gen' as const, rule: { kind: 'ancestors' as const, personId: id('ada') } };
        expect(listPersonIds(ix, anc)).toEqual(['ada', 'konst', 'brita', 'oskar', 'viktor', 'ilsa', 'mira']);
    });
});

describe('changes of a list', () => {
    const T = '2026-11-16T10:30:00.000Z';
    it('add, remove, move, sort', () => {
        const rule = { kind: 'descendants' as const, personId: id('viktor') };
        let l = fixed({ personIds: [id('ada')], rule, removed: [id('emil')] });
        l = withPersonsAdded(l, [id('emil'), id('ada')], T);
        expect(l.personIds).toEqual(['ada', 'emil']);
        expect(l.removed).toBeUndefined();
        l = withChecklist(l, true, T);
        l = withDoneToggled(l, id('emil'), T);
        expect(l.done).toEqual(['emil']);
        l = withPersonsRemoved(l, [id('emil')], T);
        expect(l).toMatchObject({ personIds: ['ada'], removed: ['emil'] });
        expect(l.done).toBeUndefined();
        l = withPersonsAdded(l, [id('konst'), id('viktor')], T);
        l = withPersonMoved(l, id('viktor'), -5, T);
        expect(l.personIds).toEqual(['viktor', 'ada', 'konst']);
        expect(withSort({ ...l, dynamic: true }, 'manual', T).sort).toBe('manual');   // unchanged: an automatic list has no manual order
        expect(withSort(l, 'old', T)).toMatchObject({ sort: 'old', personIds: ['viktor', 'ada', 'konst'] });
    });

    it('"Add from the rule" skips the taken-out and adds at the end', () => {
        const ix = buildLineages(family());
        const l = fixed({ personIds: [id('ada')], removed: [id('emil')], rule: { kind: 'descendants', personId: id('viktor') } });
        const r = withRuleFilled(ix, l, T);
        expect(r.added).toBe(2);
        expect(r.list.personIds).toEqual(['ada', 'viktor', 'konst']);
        expect(withRuleFilled(ix, r.list, T).added).toBe(0);
    });

    it('"Freeze": fixed with the people of now, in their order now; the rule stays as the origin', () => {
        const ix = buildLineages(family());
        const auto: PersonList = { id: 'a', name: 'Descendants – Viktor', dynamic: true, sort: 'old', updated: '', rule: { kind: 'descendants', personId: id('viktor') } };
        const f = withFrozen(ix, auto, T);
        expect(f).toMatchObject({ dynamic: false, personIds: ['viktor', 'konst', 'ada', 'emil'], sort: 'old', rule: auto.rule, updated: T });
        expect(listKind(f)).toBe('fixed');
        expect(listKind(auto)).toBe('auto');
        expect(listKind(withChecklist(f, true, T))).toBe('work');
    });

    it('ticking off is for a checklist; off keeps what is done', () => {
        let l = withChecklist(fixed({ personIds: [id('ada'), id('emil')] }), true, T);
        l = withDoneToggled(l, id('emil'), T);
        l = withChecklist(l, false, T);
        expect(l.done).toEqual(['emil']);
        expect(withDoneToggled(l, id('ada'), T)).toBe(l);
    });

    it('the summary: people, birth years, photo, citation, story, left', () => {
        const ix = buildLineages(family());
        const l = withDoneToggled(withChecklist(fixed({ personIds: [id('konst'), id('brita'), id('ada'), id('mira')] }), true, T), id('ada'), T);
        expect(listSummary(ix, l)).toEqual({ persons: 4, birthMin: 1880, birthMax: 1910, withPhoto: 1, withCitation: 1, withStory: 1, noCite: 3, left: 3 });
    });
});

describe('keeping lists right when people go', () => {
    it('a deleted person leaves every list; the count is of the lists that had them', () => {
        const d = family();
        d.personLists = [
            fixed({ id: 'a', personIds: [id('ada'), id('emil')], done: [id('ada')] }),
            fixed({ id: 'b', personIds: [id('emil')], removed: [id('ada')] }),
            fixed({ id: 'c', personIds: [id('emil')] }),
        ];
        expect(onPersonDeleted(d, id('ada'))).toBe(1);
        expect(d.personLists[0]).toEqual(fixed({ id: 'a', personIds: [id('emil')] }));
        expect(d.personLists[1].removed).toBeUndefined();
        expect(d.personLists[2]).toBe(d.personLists[2]);
    });

    it('merged people: the earlier position stays, done if either, taken out only if both, the rule follows', () => {
        const d = family();
        d.personLists = [
            fixed({ id: 'a', personIds: [id('emil'), id('konst'), id('ada')], done: [id('ada')] }),
            fixed({ id: 'b', personIds: [id('konst')], removed: [id('ada')] }),
            fixed({ id: 'c', personIds: [], removed: [id('ada'), id('emil')] }),
            { id: 'd', name: 'Auto', dynamic: true, sort: 'gen', updated: '', rule: { kind: 'ancestors', personId: id('ada') } },
        ];
        onPersonsMerged(d, id('emil'), id('ada'));
        expect(d.personLists[0]).toMatchObject({ personIds: ['emil', 'konst'], done: ['emil'] });
        expect(d.personLists[1].removed).toBeUndefined();
        expect(d.personLists[2].removed).toEqual(['emil']);
        expect(d.personLists[3].rule).toEqual({ kind: 'ancestors', personId: 'emil' });
    });

    it('a part of the tree: fixed lists narrowed (none left = gone), automatic ones whole', () => {
        const lists: PersonList[] = [
            fixed({ id: 'a', personIds: [id('ada'), id('mira')], removed: [id('mira'), id('emil')], done: [id('mira')] }),
            fixed({ id: 'b', personIds: [id('mira')] }),
            { id: 'c', name: 'Auto', dynamic: true, sort: 'old', updated: '', rule: { kind: 'added', days: 30 } },
        ];
        const out = subsetForSubtree(lists, new Set(['ada', 'emil']))!;
        expect(out.map(l => l.id)).toEqual(['a', 'c']);
        expect(out[0]).toEqual(fixed({ id: 'a', personIds: [id('ada')], removed: [id('emil')] }));
        const sub = extractSubtree({ ...family(), personLists: lists }, new Set([id('ada'), id('emil')]));
        expect(sub.personLists?.map(l => l.id)).toEqual(['a', 'c']);
    });

    it('a part of the tree: no one left behind stays in an automatic list\'s own data either', () => {
        const auto: PersonList = {
            id: 'd', name: 'Auto', dynamic: true, sort: 'manual', updated: '', rule: { kind: 'ancestors', personId: id('ada') },
            personIds: [id('mira'), id('ada')], removed: [id('mira')],
        };
        const [out] = subsetForSubtree([auto], new Set(['ada']))!;
        expect(out.personIds).toEqual(['ada']);
        expect(out.removed).toBeUndefined();
        expect(out.rule).toEqual(auto.rule);
        const [none] = subsetForSubtree([auto], new Set(['emil']))!;
        expect(none.personIds).toBeUndefined();
    });
});

describe('names', () => {
    it('unique without diacritics and case; the next free "(n)" is suggested', () => {
        const lists = [fixed({ id: 'a', name: 'Předci – Ilsa' }), fixed({ id: 'b', name: 'predci – ilsa (2)' })];
        expect(foldListName('  Předci –  ILSA ')).toBe('predci – ilsa');
        expect(suggestListName(lists, 'PREDCI – Ilsa')).toBe('PREDCI – Ilsa (3)');
        expect(suggestListName(lists, 'Předci – Ilsa', 'a')).toBe('Předci – Ilsa');
        expect(suggestListName(lists, 'Other')).toBe('Other');
    });
});

describe('when a person came into the tree (Person.addedAt)', () => {
    it('a GEDCOM import writes the day of the import, never for a placeholder', () => {
        const ged = `0 HEAD\n1 SOUR OTHER\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Oskar /Talvanen/\n1 SEX M\n0 TRLR`;
        const withOrigin = convertToStrom(parseGedcom(ged), { importOrigin: { at: '2026-11-08' } }).data;
        expect(Object.values(withOrigin.persons).map(p => p.addedAt)).toEqual(['2026-11-08']);
        const without = convertToStrom(parseGedcom(ged), {}).data;
        expect(Object.values(without.persons).some(p => p.addedAt)).toBe(false);
    });

    it('a research version: the tree\'s own dates and lists stay; a new person gets the research\'s date or now', () => {
        const previous = family();
        previous.persons[id('ada')].addedAt = '2026-01-01T00:00:00.000Z';
        previous.personLists = [fixed({ personIds: [id('ada')] })];
        previous.personListsDropped = ['added30'];
        const next = family();
        delete next.persons[id('emil')];
        next.persons[id('new1')] = person('new1', 'Nora', 'Brodwick', 'female', { research: { added: '2026-11-15T07:00:00.000Z' } as Person['research'] });
        next.persons[id('new2')] = person('new2', 'Ivo', 'Brodwick', 'male');
        const out = keepPersonListData(next, previous, '2026-11-16T10:30:00.000Z');
        expect(out.persons[id('ada')].addedAt).toBe('2026-01-01T00:00:00.000Z');
        expect(out.persons[id('konst')].addedAt).toBeUndefined();
        expect(out.persons[id('new1')].addedAt).toBe('2026-11-15T07:00:00.000Z');
        expect(out.persons[id('new2')].addedAt).toBe('2026-11-16T10:30:00.000Z');
        expect(out.personLists).toEqual(previous.personLists);
        expect(out.personListsDropped).toEqual(['added30']);
        expect(next.persons[id('new2')].addedAt).toBeUndefined();   // the input is not changed
        // carryOverMedia runs it on every research load.
        expect(carryOverMedia(next, previous).data.personLists).toEqual(previous.personLists);
        // A whole new tree from the research: everyone.
        const fresh = stampResearchTree(family(), '2026-11-16T10:30:00.000Z');
        expect(fresh.persons[id('ada')].addedAt).toBe('2026-11-16T10:30:00.000Z');
        expect(fresh.persons[id('q')].addedAt).toBeUndefined();
    });

    it('a tree merge: new people get the merge time, the same person keeps the earlier date', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const existing = family();
        existing.persons[id('ada')].addedAt = '2026-05-01T00:00:00.000Z';
        const incoming = family();
        incoming.persons[id('ada')].addedAt = '2026-03-01T00:00:00.000Z';
        incoming.persons[id('nora')] = person('nora', 'Nora', 'Brodwick', 'female', { birthDate: '1990', addedAt: '2020-01-01T00:00:00.000Z' });
        const state = createMergeState(existing, incoming);
        for (const m of state.matches) state.decisions.set(m.incomingId, { type: 'confirm' } as never);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const byFirst = (n: string) => Object.values(result.mergedData.persons).find(p => p.firstName === n)!;
        expect(byFirst('Ada').addedAt).toBe('2026-03-01T00:00:00.000Z');
        expect(byFirst('Emil').addedAt).toBeUndefined();
        expect(byFirst('Nora').addedAt).toBe(new Date(NOW).toISOString());
    });
});

describe('DataManager', () => {
    const TREE = 'lists-test-tree' as TreeId;
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    let toasts: { description: string; toast?: { text: string } }[];

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
        toasts = [];
        DataManager.onMutationCommitted = (description, toast) => { toasts.push({ description, toast }); };
    });
    afterEach(() => {
        DataManager.onMutationCommitted = null;
        DataManager.setWindowSink(null);
        vi.restoreAllMocks();
    });

    it('a new person gets the time it was added; a placeholder only once it becomes a person', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        const p = DataManager.createPerson({ firstName: 'Nora', lastName: 'Brodwick', gender: 'female' });
        expect(p.addedAt).toBe('2026-11-16T10:30:00.000Z');
        const q = DataManager.createPerson({ firstName: '', lastName: '', gender: 'male' }, true);
        expect(q.addedAt).toBeUndefined();
        DataManager.updatePerson(q.id, { firstName: 'Ivo' });
        expect(DataManager.getPerson(q.id)?.addedAt).toBe('2026-11-16T10:30:00.000Z');
    });

    it('create, rename, fill, freeze, delete: undo steps and toasts; names stay unique', () => {
        const a = DataManager.createPersonList({ name: 'Ancestors – Ada', dynamic: false, rule: { kind: 'ancestors', personId: id('ada'), generations: 1 } })!;
        expect(a.personIds).toEqual(['ada', 'konst', 'brita']);
        expect(a.sort).toBe('gen');
        expect((a.rule as { personName?: string }).personName).toBe('Ada Ostrovid');
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('List “Ancestors – Ada” saved.');
        const b = DataManager.createPersonList({ name: 'ANCESTORS – ada', dynamic: true, rule: { kind: 'descendants', personId: id('viktor') } })!;
        expect(b.name).toBe('ANCESTORS – ada (2)');
        expect(DataManager.renamePersonList(b.id, 'Ancestors – Ada')).toBe(false);
        expect(DataManager.renamePersonList(b.id, 'Viktor’s line')).toBe(true);
        expect(DataManager.getPersonListIds(b.id)).toEqual(['viktor', 'konst', 'ada', 'emil']);

        DataManager.removePersonsFromList(a.id, [id('brita')]);
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('Brita Talvanen removed from the list.');
        expect(DataManager.fillPersonList(a.id)).toBe(0);
        DataManager.setPersonListRule(a.id, { kind: 'ancestors', personId: id('ada'), generations: 2 }, false);
        // Grandparents: Viktor, Ilsa, Oskar, Mira; Brita stays out (taken out by hand).
        expect(DataManager.fillPersonList(a.id)).toBe(4);
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('4 people added from the rule.');
        expect(DataManager.getPersonListIds(a.id)).not.toContain('brita');

        expect(DataManager.freezePersonList(b.id)).toBe(true);
        expect(DataManager.getPersonList(b.id)).toMatchObject({ dynamic: false, personIds: ['viktor', 'konst', 'ada', 'emil'] });
        expect(DataManager.deletePersonList(b.id)).toBe(true);
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('List “Viktor’s line” deleted.');
        DataManager.undo();
        expect(DataManager.getPersonList(b.id)?.name).toBe('Viktor’s line');
    });

    it('adding by hand: people already in the list are not added twice, nothing new is no change', () => {
        const a = DataManager.createPersonList({ name: 'Picked', dynamic: false, personIds: [id('ada')] })!;
        const steps = toasts.length;
        expect(DataManager.addPersonsToList(a.id, [id('ada')])).toBe(false);
        expect(toasts.length).toBe(steps);
        expect(DataManager.addPersonsToList(a.id, [id('ada'), id('brita'), id('emil'), id('brita')])).toBe(true);
        expect(DataManager.getPersonListIds(a.id)).toEqual(['ada', 'brita', 'emil']);
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('2 people added to “Picked”.');
        expect(DataManager.addPersonsToList(a.id, [id('viktor')])).toBe(true);
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('Viktor Ostrovid added to “Picked”.');
        DataManager.undo();
        expect(DataManager.getPersonListIds(a.id)).toEqual(['ada', 'brita', 'emil']);
        // An automatic list takes nobody by hand.
        const auto = DataManager.createPersonList({ name: 'Auto', dynamic: true, rule: { kind: 'descendants', personId: id('viktor') } })!;
        expect(DataManager.addPersonsToList(auto.id, [id('brita')])).toBe(false);
    });

        it('the ready-made list is stored when changed; deleting it writes it down for good', () => {
        expect(DataManager.getPersonLists().map(l => l.id)).toEqual([ADDED30_ID]);
        DataManager.setPersonListSort(ADDED30_ID, 'name');
        expect(dm.data.personLists?.[0]).toMatchObject({ id: ADDED30_ID, builtin: 'added30', sort: 'name' });
        DataManager.deletePersonList(ADDED30_ID);
        expect(dm.data.personListsDropped).toEqual(['added30']);
        expect(DataManager.getPersonLists()).toEqual([]);
    });

    it('a deleted person leaves the lists and the toast says from how many', () => {
        DataManager.createPersonList({ name: 'One', dynamic: false, personIds: [id('emil'), id('ada')] });
        DataManager.createPersonList({ name: 'Two', dynamic: false, personIds: [id('emil')] });
        DataManager.deletePerson(id('emil'));
        expect(toasts[toasts.length - 1]?.toast?.text).toBe('Emil Ostrovid (*1912) deleted, also removed from 2 lists.');
        expect(dm.data.personLists?.map(l => l.personIds)).toEqual([['ada'], []]);
        DataManager.deletePerson(id('mira'));
        expect(toasts[toasts.length - 1]?.toast).toBeUndefined();
    });

    it('merging two people moves their places in lists and keeps the earlier date added', () => {
        dm.data.persons[id('emil')].addedAt = '2026-02-01T00:00:00.000Z';
        dm.data.persons[id('ada')].addedAt = '2026-01-01T00:00:00.000Z';
        DataManager.createPersonList({ name: 'One', dynamic: false, personIds: [id('konst'), id('ada')] });
        DataManager.mergePersons(id('emil'), id('ada'), {}, new Map());
        expect(dm.data.personLists?.[0].personIds).toEqual(['konst', 'emil']);
        expect(dm.data.persons[id('emil')].addedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('nothing changes in a read-only or locked tree (Q1)', () => {
        dm.viewMode = true;
        expect(DataManager.listsReadOnly()).toBe(true);
        expect(DataManager.createPersonList({ name: 'X', dynamic: false })).toBeNull();
        dm.viewMode = false;
        vi.spyOn(TreeManager, 'getActiveTreeMetadata').mockReturnValue({ isLocked: true } as never);
        expect(DataManager.listsReadOnly()).toBe(true);
        expect(DataManager.deletePersonList(ADDED30_ID)).toBe(false);
    });

    it('another window sends its list edits to the main window', () => {
        const edits: string[] = [];
        const sink: WindowEditSink = {
            edit: label => { edits.push(label); }, undo: () => {}, redo: () => {}, canUndo: () => false, canRedo: () => false,
            readOnly: () => false, sessionEnded: () => {},
        } as WindowEditSink;
        DataManager.setWindowSink(sink);
        const l = DataManager.createPersonList({ name: 'From a window', dynamic: false, personIds: [id('ada')] })!;
        DataManager.togglePersonListDone(l.id, id('ada'));    // not a checklist: nothing
        DataManager.setPersonListChecklist(l.id, true);
        DataManager.togglePersonListDone(l.id, id('ada'));
        expect(edits).toEqual(['creating the list: From a window', 'changing the list: From a window', 'changing the list: From a window']);
        expect(DataManager.getPersonList(l.id)?.done).toEqual(['ada']);
    });
});

describe('the kind icon', () => {
    it('an inline SVG hidden from assistive technology, neutral but for a checklist', () => {
        const fixedIcon = listKindIcon('fixed', 16);
        expect(fixedIcon).toMatch(/^<svg [^>]*aria-hidden="true"/);
        expect(fixedIcon).toContain('width="16"');
        expect(fixedIcon).toContain('var(--text-light)');
        expect(listKindIcon('auto')).toContain('var(--text-light)');
        expect(listKindIcon('work', 18)).toContain('var(--accent-text)');
    });
});

describe('the texts', () => {
    it('every language has them, impersonal, with plural forms', () => {
        setLanguage('cs');
        expect(strings.lists.toast.filled(1)).toBe('Přidána 1 osoba podle pravidla.');
        expect(strings.lists.toast.filled(3)).toBe('Přidány 3 osoby podle pravidla.');
        expect(strings.lists.toast.filled(5)).toBe('Přidáno 5 osob podle pravidla.');
        expect(strings.lists.toast.personDeleted('Ada', 2)).toBe('Osoba Ada smazána, odebrána i ze 2 seznamů.');
        expect(strings.lists.toast.added('Ada', 'X', 'female')).toBe('Ada přidána do seznamu „X“.');
        expect(strings.lists.toast.addedN(1, 'X')).toBe('Do seznamu „X“ přidána 1 osoba.');
        expect(strings.lists.toast.addedN(3, 'X')).toBe('Do seznamu „X“ přidány 3 osoby.');
        expect(strings.lists.toast.addedN(5, 'X')).toBe('Do seznamu „X“ přidáno 5 osob.');
        expect(strings.table.act.toListN(2)).toBe('Přidat 2 osoby do seznamu');
        expect(strings.lists.rule.anc('Ada', 4)).toBe('Předci osoby Ada, do 4 generací');
        setLanguage('pl');
        expect(strings.lists.toast.filled(5)).toBe('Dodano 5 osób według reguły.');
        setLanguage('de');
        expect(strings.lists.save.count(1)).toBe('Es wird 1 Person in der Reihenfolge der Tabelle gespeichert.');
    });

    it('the empty overview names only what a list is for today: the Table and export, no fly-through yet', () => {
        const flyThrough: Record<string, RegExp> = { en: /slideshow|fly/i, cs: /průlet/i, de: /Diashow|Rundflug/i, pl: /przelot/i };
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(strings.lists.emptySub).not.toMatch(flyThrough[lang]);
        }
        setLanguage('cs');
        expect(strings.lists.emptySub).toBe('Seznam drží vybrané osoby pod jedním jménem – pro Tabulku i export. Vzniká podle rodu, předků, potomků, linie nebo ručně.');
    });
});

describe('performance: 5 000 people', () => {
    it('evaluates every kind of list with its summary within the budget', () => {
        const { data, rootId } = syntheticTree({ persons: 5000 });
        const ids = Object.keys(data.persons) as PersonId[];
        const rid = rootId as PersonId;
        ids.forEach((pid, i) => { if (i % 3 === 0) data.persons[pid].addedAt = new Date(NOW - (i % 60) * 86_400_000).toISOString(); });
        const lists: PersonList[] = [
            { id: 'f', name: 'Fixed', dynamic: false, personIds: ids.slice(0, 3000), sort: 'name', updated: '' },
            { id: 'a', name: 'Anc', dynamic: true, rule: { kind: 'ancestors', personId: rid }, sort: 'gen', updated: '' },
            { id: 'd', name: 'Des', dynamic: true, rule: { kind: 'descendants', personId: rid }, sort: 'old', updated: '' },
            { ...builtinAdded30() },
            { id: 't', name: 'Filter', dynamic: true, rule: { kind: 'tableFilter', rowType: 'persons', filter: { op: 'and', items: [{ chip: 'deceased' }] }, sort: [{ col: 'bDate', dir: 1 }] }, sort: 'old', updated: '' },
        ];
        let total = 0;
        const run = () => {
            const ix = lineageIndexOf({ ...data });   // a new data revision each time: nothing cached
            for (const l of lists) total += listSummary(ix, l, { now: NOW, homeId: rid, lang: 'en' }).persons;
            return total;
        };
        expect(run()).toBeGreaterThan(3000);
        const BUDGET_MS = 600;
        const m = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 2, maxPairs: 5, maxWallMs: 30_000 });
        console.log(budgetReport('lists of people, 5 kinds + summary, 5000 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
