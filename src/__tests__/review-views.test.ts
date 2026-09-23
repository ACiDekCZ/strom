/**
 * Review fixes for the views (search with name forms, anniversaries, generations,
 * statistics, the family book, kinship terms, fan chart markers). Invented data.
 */

import { describe, it, expect } from 'vitest';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender, ParentChildRelType, PartnershipStatus } from '../types.js';
import { filterPersons } from '../search-filter.js';
import { filterAndSort } from '../person-picker.js';
import { searchableNameText } from '../name-search.js';
import { upcomingAnniversaries, onThisDay } from '../anniversaries.js';
import { assignGenerations } from '../generations.js';
import { computeFamilyStats } from '../stats.js';
import { buildFamilyBook } from '../book.js';
import { findRelationship } from '../kinship.js';
import { buildFanModel, buildFanSvg } from '../fan-chart.js';
import { treeStatsMethods } from '../ui/tree-stats.js';
import { ARCHIVE_PORTALS } from '../archives.js';

interface Opts {
    birthDate?: string; deathDate?: string; parentIds?: string[]; childIds?: string[];
    partnerships?: string[]; nameVariants?: string[]; isPlaceholder?: boolean;
    parentRelTypes?: Record<string, ParentChildRelType>;
}
function p(id: string, first: string, last: string, gender: Gender, o: Opts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: !!o.isPlaceholder,
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
        partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.nameVariants ? { nameVariants: o.nameVariants } : {}),
        ...(o.parentRelTypes ? { parentRelTypes: o.parentRelTypes as Record<PersonId, ParentChildRelType> } : {}),
    };
}
function u(id: string, a: string, b: string, o: { status?: PartnershipStatus; startDate?: string; endDate?: string; childIds?: string[] } = {}): Partnership {
    return {
        id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId,
        childIds: (o.childIds ?? []) as PersonId[], status: o.status ?? 'married',
        ...(o.startDate ? { startDate: o.startDate } : {}),
        ...(o.endDate ? { endDate: o.endDate } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = [], extra: Partial<StromData> = {}): StromData {
    return {
        persons: Object.fromEntries(persons.map(x => [x.id, x])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(x => [x.id, x])) as StromData['partnerships'],
        ...extra,
    };
}

describe('V19 search finds every name form', () => {
    const d = data([
        p('a', 'Marie', 'Víšková', 'female'),
        p('b', 'Jan', 'Novák', 'male', { nameVariants: ['Wischek'] }),
        p('c', 'Karel', 'Dvořák', 'male'),
    ]);

    it('advanced filter: "visek" finds Víšková, "Wischek" finds the name variant', () => {
        expect(filterPersons(d, { query: 'visek' })).toEqual(['a']);
        expect(filterPersons(d, { query: 'Wischek' })).toEqual(['b']);
        expect(filterPersons(d, { lastName: 'visek' })).toEqual(['a']);
        expect(filterPersons(d, { query: 'marie visek' })).toEqual(['a']);
    });

    it('toolbar picker scoring uses the same forms', () => {
        const persons = Object.values(d.persons);
        expect(filterAndSort('visek', persons, d).map(x => x.id)).toEqual(['a']);
        expect(filterAndSort('wisch', persons, d).map(x => x.id)).toEqual(['b']);
        // Direct name matches still rank first.
        expect(filterAndSort('nov', persons, d)[0].id).toBe('b');
    });

    it('user surname groups count too', () => {
        const g = data([p('x', 'Petr', 'Vyšek', 'male')], [], { surnameVariants: [['Vyšek', 'Wyschek']] });
        expect(searchableNameText(g.persons['x' as PersonId], g)).toContain('wyschek');
        expect(filterPersons(g, { query: 'wyschek' })).toEqual(['x']);
    });
});

describe('S26 wedding anniversaries only for lasting marriages', () => {
    const TODAY = new Date(2026, 5, 15);
    const people = [
        p('h', 'Jan', 'A', 'male', { birthDate: '1980-01-01' }),
        p('w', 'Eva', 'A', 'female', { birthDate: '1982-01-01' }),
    ];
    const upcoming = (x: Partnership) => upcomingAnniversaries(data(people, [x]), TODAY).filter(r => r.type === 'wedding');

    it('married without end → anniversary', () => {
        expect(upcoming(u('u', 'h', 'w', { startDate: '2005-06-20' }))).toHaveLength(1);
    });
    it('divorced, separated, ended or partners → none', () => {
        expect(upcoming(u('u', 'h', 'w', { startDate: '2005-06-20', status: 'divorced' }))).toHaveLength(0);
        expect(upcoming(u('u', 'h', 'w', { startDate: '2005-06-20', status: 'separated' }))).toHaveLength(0);
        expect(upcoming(u('u', 'h', 'w', { startDate: '2005-06-20', endDate: '2015-01-01' }))).toHaveLength(0);
        expect(upcoming(u('u', 'h', 'w', { startDate: '2005-06-20', status: 'partners' }))).toHaveLength(0);
    });
    it('on this day keeps historical weddings, not unmarried unions', () => {
        const today = new Date(2026, 5, 20);
        const div = onThisDay(data(people, [u('u', 'h', 'w', { startDate: '2005-06-20', status: 'divorced' })]), today);
        expect(div.filter(e => e.type === 'wedding')).toHaveLength(1);
        const prt = onThisDay(data(people, [u('u', 'h', 'w', { startDate: '2005-06-20', status: 'partners' })]), today);
        expect(prt.filter(e => e.type === 'wedding')).toHaveLength(0);
    });
});

describe('S27 in-laws take their partner\'s generation', () => {
    it('a parentless spouse joins the spouse\'s generation, and so do their children', () => {
        const d = data([
            p('gf', 'Old', 'A', 'male', { childIds: ['f'], birthDate: '1900-01-01', deathDate: '1970-01-01' }),
            p('f', 'Son', 'A', 'male', { parentIds: ['gf'], childIds: ['c'] }),
            p('m', 'Inlaw', 'B', 'female', { childIds: ['c'], birthDate: '1930-01-01', deathDate: '2000-01-01' }),
            p('c', 'Kid', 'A', 'male', { parentIds: ['f', 'm'] }),
        ], [u('u', 'f', 'm', { childIds: ['c'] })]);
        const gen = assignGenerations(d);
        expect(gen.get('gf')).toBe(0);
        expect(gen.get('f')).toBe(1);
        expect(gen.get('m')).toBe(1);
        expect(gen.get('c')).toBe(2);
        const stats = computeFamilyStats(d);
        expect(stats.lifespanByGen.map(g => g.generation)).toEqual([0, 1]);
    });
});

describe('stats: longest marriage ends at divorce or the first death', () => {
    it('uses the earlier partner death when no end date is recorded', () => {
        const d = data([
            p('h', 'Jan', 'A', 'male', { deathDate: '1960-01-01' }),
            p('w', 'Eva', 'A', 'female', { deathDate: '1990-01-01' }),
            p('x', 'Ota', 'B', 'male'),
            p('y', 'Ida', 'B', 'female'),
        ], [
            u('u1', 'h', 'w', { startDate: '1920-01-01' }),
            u('u2', 'x', 'y', { startDate: '1950-01-01' }),  // no end known → skipped
        ]);
        expect(computeFamilyStats(d).longestMarriage?.years).toBe(40);
    });
});

describe('S28 tree stats skip placeholders', () => {
    it('placeholder is not counted as a person or as living', () => {
        const d = data([
            p('a', 'Jan', 'A', 'male', { birthDate: '1990-01-01' }),
            p('ph', '', '', 'female', { isPlaceholder: true }),
        ]);
        const ctx = { ...treeStatsMethods, escapeHtml: (t: string) => t };
        const html = (treeStatsMethods.generateTreeStatsHtml as (this: unknown, d: StromData) => string).call(ctx, d);
        const header = (label: string) => new RegExp(`header-value">(\\d+)</div>\\s*<div class="tree-stats-header-label">${label}<`).exec(html)?.[1];
        expect(header('People')).toBe('1');
        expect(html).toMatch(/Males <b>1<\/b>/);
        expect(html).not.toContain('tree-stats-unrelated');
    });
});

describe('S33 family book shows how unions ended and non-biological children', () => {
    it('renders divorce and adoption markers', () => {
        const d = data([
            p('h', 'Jan', 'Kovář', 'male', { childIds: ['c', 's'], birthDate: '1900-01-01', deathDate: '1970-01-01' }),
            p('w', 'Eva', 'Kovářová', 'female', { childIds: ['c', 's'], birthDate: '1902-01-01', deathDate: '1975-01-01' }),
            p('c', 'Petr', 'Kovář', 'male', { parentIds: ['h', 'w'], birthDate: '1925-01-01', deathDate: '1990-01-01', parentRelTypes: { h: 'adoptive', w: 'adoptive' } }),
            p('s', 'Ota', 'Kovář', 'male', { parentIds: ['h', 'w'], birthDate: '1927-01-01', deathDate: '1995-01-01', parentRelTypes: { h: 'step' } }),
        ], [u('u', 'h', 'w', { status: 'divorced', startDate: '1924-05-01', endDate: '1940', childIds: ['c', 's'] })]);
        const html = buildFamilyBook(d, { lang: 'en', privacyMode: 'full' });
        expect(html).toContain('⚭ 5/1/1924 · divorced 1940');
        expect(html).toContain('— adopted');
        expect(html).toContain('stepchild of Jan Kovář');
    });

    it('unmarried partners get no wedding symbol', () => {
        const d = data([
            p('h', 'Jan', 'A', 'male', { childIds: ['c'], birthDate: '1900-01-01', deathDate: '1970-01-01' }),
            p('w', 'Eva', 'B', 'female', { childIds: ['c'], birthDate: '1902-01-01', deathDate: '1975-01-01' }),
            p('c', 'Kid', 'A', 'male', { parentIds: ['h', 'w'], birthDate: '1925-01-01', deathDate: '1990-01-01' }),
        ], [u('u', 'h', 'w', { status: 'partners', startDate: '1924', childIds: ['c'] })]);
        const html = buildFamilyBook(d, { lang: 'en', privacyMode: 'full' });
        expect(html).toContain('<div class="book-marriage-line">Partners 1924</div>');
    });
});

describe('S34 kinship terms in German and the low-severity term fixes', () => {
    // gp → dad, uncle; dad + mom → me, sis; mom alone (second union) → half?
    const d = data([
        p('ggf', 'Ur', 'A', 'male', { childIds: ['gf'] }),
        p('gf', 'Opa', 'A', 'male', { parentIds: ['ggf'], childIds: ['dad', 'unc'] }),
        p('dad', 'Papa', 'A', 'male', { parentIds: ['gf'], childIds: ['me', 'sis'], partnerships: ['u1'] }),
        p('mom', 'Mama', 'B', 'female', { childIds: ['me', 'sis'], partnerships: ['u1', 'u2'] }),
        p('step', 'Stief', 'C', 'male', { partnerships: ['u2'] }),
        p('unc', 'Onkel', 'A', 'male', { parentIds: ['gf'], childIds: ['cou'] }),
        p('cou', 'Vetter', 'A', 'female', { parentIds: ['unc'] }),
        p('me', 'Ich', 'A', 'male', { parentIds: ['dad', 'mom'], partnerships: ['u3'] }),
        p('sis', 'Schwester', 'A', 'female', { parentIds: ['dad'] }),
        p('ex', 'Ex', 'D', 'female', { partnerships: ['u3'] }),
    ], [
        u('u1', 'dad', 'mom', { childIds: ['me'] }),
        u('u2', 'step', 'mom', { status: 'married' }),
        u('u3', 'me', 'ex', { status: 'divorced' }),
    ]);
    const rel = (a: string, b: string) => findRelationship(d, a as PersonId, b as PersonId)!;

    it('German blood terms', () => {
        expect(rel('me', 'gf').term.de).toBe('Großvater');
        expect(rel('me', 'ggf').term.de).toBe('Urgroßvater');
        expect(rel('me', 'unc').term.de).toBe('Onkel');
        expect(rel('me', 'cou').term.de).toBe('Cousine');
        expect(rel('ggf', 'me').term.de).toBe('Urenkel');
        expect(rel('unc', 'me').term.de).toBe('Neffe');
    });

    it('a sibling with one recorded parent is a plain sibling, not a half-sibling', () => {
        expect(rel('me', 'sis').term.en).toBe('sister');
        expect(rel('me', 'sis').term.de).toBe('Schwester');
    });

    it('divorced partner is an ex; mother\'s husband is a stepfather', () => {
        expect(rel('me', 'ex').term.en).toBe('ex-wife / ex-partner');
        expect(rel('me', 'ex').term.de).toContain('Ex-Ehefrau');
        expect(rel('me', 'step').term.en).toBe('stepfather');
        expect(rel('me', 'step').term.de).toBe('Stiefvater');
    });

    it('half-siblings still detected with two different known parents each', () => {
        const h = data([
            p('f', 'F', 'A', 'male', { childIds: ['x', 'y'] }),
            p('m1', 'M1', 'A', 'female', { childIds: ['x'] }),
            p('m2', 'M2', 'A', 'female', { childIds: ['y'] }),
            p('x', 'X', 'A', 'male', { parentIds: ['f', 'm1'] }),
            p('y', 'Y', 'A', 'female', { parentIds: ['f', 'm2'] }),
        ]);
        expect(findRelationship(h, 'x' as PersonId, 'y' as PersonId)!.term.de).toBe('Halbschwester');
    });

    it('archive coverage has German labels', () => {
        for (const portal of ARCHIVE_PORTALS) expect(portal.coverage.de).toBeTruthy();
    });
});

describe('fan chart marks non-biological parents', () => {
    it('adoptive parent sector is dashed and labelled', () => {
        const d = data([
            p('me', 'Ich', 'A', 'male', { parentIds: ['f', 'm'], parentRelTypes: { f: 'adoptive' } }),
            p('f', 'Papa', 'A', 'male', { childIds: ['me'] }),
            p('m', 'Mama', 'B', 'female', { childIds: ['me'] }),
        ]);
        const model = buildFanModel(d, 'me' as PersonId, 2)!;
        expect(model.sectors.find(s => s.person?.id === 'f')?.relType).toBe('adoptive');
        expect(model.sectors.find(s => s.person?.id === 'm')?.relType).toBeUndefined();
        const svg = buildFanSvg(model, { esc: t => t, editable: false, addParentLabel: '', relTypeLabel: () => 'Adoptive' });
        expect(svg).toContain('fan-sector male fan-nonbio');
        expect(svg).toContain('· Adoptive</title>');
    });
});
