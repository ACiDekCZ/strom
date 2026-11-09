/**
 * Cross-tree matching by first-name groups gives exactly what comparing every
 * person did, and stays fast with many large trees.
 *
 * A card used to run quickMatch against every person of every other tree,
 * each call outside a matching pass (the surname rules counted the tree's
 * people on every call): with 28 trees of 77 000 people a large tree froze
 * the browser for minutes. Now the cards of a render are matched in one
 * pass, and each other tree is indexed by normalized first name, so only the
 * people whose first name can pass quickMatch's name test are compared.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    findCrossTreeMatches, prepareCrossTreeMatches, invalidateCache, invalidateCacheForTree, CrossTreeMatch,
} from '../cross-tree.js';
import { quickMatch, stringSimilarity, normalizeName, firstNameMayQuickMatch } from '../merge/matching.js';
import { shownNameOrEmpty } from '../person-name.js';
import { setLanguage } from '../strings.js';
import { Person, StromData, TreeId } from '../types.js';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

type Trees = Map<TreeId, { name: string; data: StromData }>;

/** The matching as it was: quickMatch against every person of every other tree, outside any pass. */
function bruteForce(currentTreeId: TreeId, person: Person, allTrees: Trees): CrossTreeMatch[] {
    if (person.isPlaceholder) return [];
    const matches: CrossTreeMatch[] = [];
    const currentData = allTrees.get(currentTreeId)?.data;
    for (const [treeId, tree] of allTrees) {
        if (treeId === currentTreeId) continue;
        for (const other of Object.values(tree.data.persons)) {
            if (other.isPlaceholder) continue;
            const { score, reasons } = quickMatch(person, other, currentData, tree.data);
            if (score >= 50) {
                const name = shownNameOrEmpty(other);
                const year = other.birthDate?.split('-')[0];
                matches.push({
                    treeId, treeName: tree.name, personId: other.id,
                    personName: year ? `${name} (*${year})` : name, confidence: score, reasons,
                });
            }
        }
    }
    return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/**
 * Another tree of the same people as written elsewhere: names with and
 * without accents, typos, a feminine surname form, another spelling of a
 * given name, dates a year off or only the year, people without a first
 * name, a name only in the surname, placeholders and unknown sex.
 */
function variant(data: StromData, seed: number): StromData {
    const r = rng(seed);
    const out = structuredClone(data);
    const typo = (s: string): string => {
        if (s.length < 3) return s + 'a';
        const i = 1 + Math.floor(r() * (s.length - 2));
        return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
    };
    for (const p of Object.values(out.persons)) {
        const x = r();
        if (x < 0.08) p.firstName = p.firstName.normalize('NFD').replace(/\p{M}/gu, '');
        else if (x < 0.16) p.firstName = typo(p.firstName);
        else if (x < 0.2) p.firstName = p.firstName + 'a';
        else if (x < 0.23) p.firstName = p.firstName.slice(0, 2);
        else if (x < 0.26) p.firstName = '';
        else if (x < 0.28) { p.lastName = `${p.firstName} ${p.lastName}`; p.firstName = ''; }
        else if (x < 0.3) p.firstName = '--';
        else if (x < 0.32) p.firstName = p.firstName.toUpperCase() + ' Marie';
        const y = r();
        if (y < 0.06 && p.lastName && !p.lastName.endsWith('ová')) p.lastName = p.lastName + 'ová';
        else if (y < 0.1) p.lastName = typo(p.lastName);
        else if (y < 0.12) p.lastName = '';
        const z = r();
        if (z < 0.1 && p.birthDate) p.birthDate = p.birthDate.slice(0, 4);
        else if (z < 0.15 && p.birthDate) p.birthDate = String(Number(p.birthDate.slice(0, 4)) + 1);
        else if (z < 0.18) delete p.birthDate;
        if (r() < 0.03) p.gender = 'unknown' as Person['gender'];
        if (r() < 0.02) p.isPlaceholder = true;
    }
    return out;
}

function fixture(name: string): StromData {
    return JSON.parse(readFileSync(join(__dirname, '../../test', name), 'utf-8')) as StromData;
}

function treesOf(list: StromData[]): Trees {
    return new Map(list.map((data, i) => [`t${i}` as TreeId, { name: `Tree ${i}`, data }]));
}

/** Every person of the current tree (t0): matched card by card, after a prepare, and by the old loop. */
function expectSameAsBruteForce(trees: Trees): number {
    const current = 't0' as TreeId;
    const persons = Object.values(trees.get(current)!.data.persons);
    const reference = persons.map(p => bruteForce(current, p, trees));
    invalidateCache();
    expect(persons.map(p => findCrossTreeMatches(current, p, trees))).toEqual(reference);
    invalidateCache();
    prepareCrossTreeMatches(current, persons, trees);
    expect(persons.map(p => findCrossTreeMatches(current, p, trees))).toEqual(reference);
    // An edit in the current tree drops the results but keeps the other trees' indexes.
    invalidateCacheForTree(current);
    prepareCrossTreeMatches(current, persons, trees);
    expect(persons.map(p => findCrossTreeMatches(current, p, trees))).toEqual(reference);
    return reference.reduce((n, m) => n + m.length, 0);
}

describe('cross-tree matching by first-name groups', () => {
    beforeEach(() => { invalidateCache(); });
    afterEach(() => { invalidateCache(); setLanguage('en'); });

    it('the first-name test is exactly quickMatch\'s name test with the surname the same', () => {
        const names = new Set<string>(['', ' ', '--', 'Jan', 'Jana', 'Ján', 'Johann', 'John', 'Joan', 'J', 'Jo', 'Ivo', 'Iva',
            'Łukasz', 'Lukasz', 'Straße', 'Strasse', 'Анна', 'Анна Мария', 'Maria', 'Marie', 'Mária', 'Anna Marie',
            'Bartholomew', 'Bartolomej', 'Bartoloměj', 'Wilhelmina', 'Vilemína', 'Alžběta', 'Elisabeth', 'Eliška', 'İsmail']);
        for (const f of readdirSync(join(__dirname, '../../test')).filter(n => n.endsWith('.json') && n !== 'real-large.json')) {
            for (const p of Object.values(fixture(f).persons ?? {})) names.add(p.firstName ?? '');
        }
        for (const p of Object.values(variant(syntheticTree({ persons: 600 }).data, 7).persons)) names.add(p.firstName);
        const list = [...names];
        let passing = 0;
        for (const a of list) {
            for (const b of list) {
                const expected = (stringSimilarity(a, b) + 1.0) / 2 >= 0.7;
                const got = firstNameMayQuickMatch(normalizeName(a), normalizeName(b));
                if (got !== expected) throw new Error(`"${a}" / "${b}": ${got}, expected ${expected}`);
                if (got) passing++;
            }
        }
        // Both answers occur (the test is no tautology of one side).
        expect(passing).toBeGreaterThan(list.length);
        expect(passing).toBeLessThan(list.length * list.length);
    }, 120_000);

    for (const lang of ['en', 'cs'] as const) {
        it(`matches the fixtures exactly as comparing every person did (${lang})`, () => {
            setLanguage(lang);
            const comprehensive = fixture('comprehensive.json');
            const trees = treesOf([
                comprehensive, variant(comprehensive, 1), fixture('etalon-stress-all.json'),
                variant(comprehensive, 2), fixture('edge-unknown-gender.json'), fixture('etalon-incomplete-data.json'),
            ]);
            expect(expectSameAsBruteForce(trees)).toBeGreaterThan(20);
        }, 120_000);

        it(`matches synthetic trees exactly as comparing every person did (${lang})`, () => {
            setLanguage(lang);
            const base = syntheticTree({ persons: 400, founders: 30 }).data;
            const trees = treesOf([
                variant(base, 11), base, variant(base, 12), syntheticTree({ persons: 300, founders: 25, seed: 99 }).data, variant(base, 13),
            ]);
            expect(expectSameAsBruteForce(trees)).toBeGreaterThan(200);
        }, 120_000);
    }

    it('a tree read anew is indexed anew', () => {
        const base = syntheticTree({ persons: 200, founders: 20 }).data;
        const other = structuredClone(base);
        const trees = treesOf([base, other]);
        const subject = Object.values(base.persons).find(p => !p.isPlaceholder && p.firstName)!;
        const twin = other.persons[subject.id];
        expect(findCrossTreeMatches('t0' as TreeId, subject, trees).map(m => m.personId)).toContain(twin.id);

        // Renamed in the other tree, which comes back as a new copy (a new lastModifiedAt).
        const renamed = structuredClone(other);
        renamed.persons[subject.id].firstName = 'Zbyhněv';
        trees.set('t1' as TreeId, { name: 'Tree 1', data: renamed });
        invalidateCacheForTree('t1' as TreeId);
        expect(findCrossTreeMatches('t0' as TreeId, subject, trees)).toEqual(bruteForce('t0' as TreeId, subject, trees));
        expect(findCrossTreeMatches('t0' as TreeId, subject, trees).map(m => m.personId)).not.toContain(twin.id);

        // Changed in place and invalidated: the index of that tree goes too.
        renamed.persons[subject.id].firstName = subject.firstName;
        invalidateCacheForTree('t1' as TreeId);
        expect(findCrossTreeMatches('t0' as TreeId, subject, trees).map(m => m.personId)).toContain(twin.id);
    });
});

/**
 * 100 cards against three other trees: about 0.06 s on the reference machine;
 * before the fix 120 cards against four trees took about 110 s (normalized).
 */
const BUDGET_MS = 1000;
/** Calibration rounds: about as long as the measured work. */
const CALIBRATION_ROUNDS = 32;
/** The calibration's best time on the reference machine at rest (5.5 ms a round, as in the other perf tests). */
const CALIBRATION_REFERENCE_MS = 176;

describe('cross-tree matching performance', () => {
    it('matches 100 cards of a 2 500-person tree against three other trees of 2 500 within the budget', () => {
        setLanguage('cs');
        const base = syntheticTree({ persons: 2500 }).data;
        const trees = treesOf([
            base, variant(base, 21), syntheticTree({ persons: 2500, seed: 4242 }).data, variant(base, 22),
        ]);
        const cards = Object.values(base.persons).filter(p => !p.isPlaceholder).slice(0, 100);
        // Card by card, as a bubble or the chooser asks (each call its own pass), from cold caches.
        const run = (): number => {
            invalidateCache();
            return cards.reduce((n, p) => n + findCrossTreeMatches('t0' as TreeId, p, trees).length, 0);
        };
        expect(run()).toBeGreaterThan(100);

        const m = measureAgainstBudget(run, {
            budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('cross-tree 100 cards × 3 trees of 2500', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 600_000);
});
