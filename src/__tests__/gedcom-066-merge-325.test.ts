/**
 * The same file merged again into the tree Strom 3.25.0 made of it (spec 066).
 *
 * test/gedcom-066-merge-325.ged is a MyHeritage file of what a tree 3.25.0
 * loaded has nothing to pair by: no ids (3.25.0 kept none), children known by
 * a given name alone (no surname, no dates), nameless records ("1 NAME  //")
 * as a child, as spouses and as both parents of a family, couples with no MARR,
 * a family of one named parent (no surname) and a nameless wife.
 * test/gedcom-066-merge-325.v3.25.0.json is the tree 3.25.0 made of it, made
 * with the parser of tag v3.25.0 (`git archive v3.25.0 src`, then a tsx
 * script): `convertToStrom(parseGedcom(text)).data`, `version = 14` set as its
 * createTreeFromImport did, written as JSON.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy } from '../privacy.js';
import { StorageManager } from '../storage.js';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { AUTO_CONFIRM_SCORE, executeMerge, isEffectivelyConfirmed } from '../merge/executor.js';
import type { MergeState } from '../merge/types.js';
import type { Person, StromData } from '../types.js';

const FILE = readFileSync(join(process.cwd(), 'test', 'gedcom-066-merge-325.ged'), 'utf-8');
const OLD = readFileSync(join(process.cwd(), 'test', 'gedcom-066-merge-325.v3.25.0.json'), 'utf-8');

const load = (text: string): StromData =>
    migrateData(convertToStrom(parseGedcom(text), { importOrigin: { at: '2026-11-09', file: 'Klobouček.ged', encoding: 'utf-8' } }).data);
/** The stored tree 3.25.0 made, as the app opens it (DataManager → migrateData). */
const oldTree = (): StromData => migrateData(JSON.parse(OLD));
/** The wizard's "Merge with existing", every match it leaves to confirm confirmed. */
const mergeAll = async (state: MergeState): Promise<StromData> => {
    for (const m of state.matches) if (!isEffectivelyConfirmed(state, m)) updateMatchDecision(state, m.incomingId, 'confirm');
    return (await executeMerge(state)).mergedData!;
};
const size = (d: StromData) => ({
    persons: Object.values(d.persons).filter(p => !p.isPlaceholder).length,
    standIns: Object.values(d.persons).filter(p => p.isPlaceholder).length,
    families: Object.keys(d.partnerships).length,
});
const lines = (d: StromData): string[] => exportToGedcom(applyLivingPrivacy(d, 'full', 2026), 'Klobouček', {}).content.split(/\r?\n/);
/** `1 MARR` lines, and those with nothing under them. */
const marriages = (l: string[]) => [l.filter(x => /^1 MARR/.test(x)).length, l.filter((x, i) => x === '1 MARR' && !/^[2-9] /.test(l[i + 1] ?? '')).length];
const all = (d: StromData, first: string, last = ''): Person[] =>
    Object.values(d.persons).filter(p => !p.isPlaceholder && (p.firstName ?? '').replace(/^\?$/, '') === first && (p.lastName ?? '') === last);
const parentsOf = (d: StromData, p: Person): string[] => p.parentIds.map(id => d.persons[id]).filter(q => q && !q.isPlaceholder).map(q => q.firstName).sort();
/** The match of the file's person of that name, if any. */
const matchOf = (state: MergeState, first: string, last = '') => {
    const incoming = all(state.incomingData, first, last);
    expect(incoming, `${first} ${last}`).toHaveLength(1);
    return state.matches.find(m => m.incomingId === incoming[0].id);
};

describe('The same file merged into the tree 3.25.0 made of it', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('gives what a fresh import of the file gives: no person, "?" or family twice, no MARR the file does not have', async () => {
        const fresh = load(FILE);
        const merged = await mergeAll(createMergeState(oldTree(), load(FILE)));
        expect(size(merged)).toEqual(size(fresh));
        expect(marriages(lines(merged))).toEqual(marriages(lines(fresh)));
        expect(marriages(lines(fresh))).toEqual([2, 0]);
        // The two of the same given name stay each with own parents.
        const radmils = all(merged, 'Radmil');
        expect(radmils).toHaveLength(2);
        expect(radmils.map(p => parentsOf(merged, p).join('+')).sort()).toEqual(['Bělislava+Zbyhoň', 'Vrbislav']);
    });

    it('pairs a given name alone through a matched parent, a sibling of nameless parents and an in-law through a nameless spouse — for review', () => {
        const state = createMergeState(oldTree(), load(FILE));
        const child = matchOf(state, 'Kvasoslav');
        const sibling = matchOf(state, '', 'Klobouček');
        const inLaw = matchOf(state, 'Lubomír');
        expect(child?.reasons).toContain('child_of_matched');
        expect(sibling?.reasons).toContain('sibling_of_matched');
        expect(inLaw?.reasons).toContain('in_law_of_matched');
        for (const m of [child!, sibling!, inLaw!]) {
            expect(m.score).toBeLessThan(AUTO_CONFIRM_SCORE);
            expect(isEffectivelyConfirmed(state, m)).toBe(false);
        }
        // Each Radmil with the one of the same parents.
        for (const r of all(state.incomingData, 'Radmil')) {
            const m = state.matches.find(x => x.incomingId === r.id)!;
            expect(parentsOf(state.existingData, state.existingData.persons[m.existingId])).toEqual(parentsOf(state.incomingData, r));
        }
    });

    it('two sons of one name nothing tells apart are not paired with either', () => {
        const twins = FILE.replace('0 @I4@ INDI\n1 NAME Radmil', '0 @I4@ INDI\n1 NAME Kvasoslav');
        const tree = oldTree();
        const second = Object.values(tree.persons).find(p => p.firstName === 'Radmil' && parentsOf(tree, p).includes('Vrbislav'))!;
        second.firstName = 'Kvasoslav';
        const state = createMergeState(tree, load(twins));
        const kvasoslavs = all(state.incomingData, 'Kvasoslav');
        expect(kvasoslavs).toHaveLength(2);
        for (const k of kvasoslavs) expect(state.matches.find(m => m.incomingId === k.id), JSON.stringify(state.matches.find(m => m.incomingId === k.id)?.reasons)).toBeUndefined();
    });

    it('the same name with a birth year far apart, under other parents or with a matched spouse the tree\'s one does not have is not the same person', () => {
        const dated = FILE.replace('1 NAME Kvasoslav\n1 SEX M\n', '1 NAME Kvasoslav\n1 SEX M\n1 BIRT\n2 DATE 1860\n');
        const tree = oldTree();
        all(tree, 'Kvasoslav')[0].birthDate = '1830';
        expect(matchOf(createMergeState(tree, load(dated)), 'Kvasoslav')?.reasons).toBeUndefined();

        // In the file a child of the other couple: the tree's one is a child of Vrbislav.
        const moved = FILE
            .replace('1 FAMC @F1@\n1 RIN MH:I3', '1 FAMC @F7@\n1 RIN MH:I3')
            .replace('1 CHIL @I3@\n', '')
            .replace('1 CHIL @I20@\n', '1 CHIL @I20@\n1 CHIL @I3@\n');
        expect(matchOf(createMergeState(oldTree(), load(moved)), 'Kvasoslav')?.reasons).toBeUndefined();

        // In the file also the husband of a matched woman the tree's one is not married to.
        const married = FILE
            .replace('1 FAMC @F1@\n1 RIN MH:I3', '1 FAMC @F1@\n1 FAMS @F8@\n1 RIN MH:I3')
            .replace('1 FAMS @F7@\n1 RIN MH:I19', '1 FAMS @F7@\n1 FAMS @F8@\n1 RIN MH:I19')
            .replace('0 TRLR', '0 @F8@ FAM\n1 HUSB @I3@\n1 WIFE @I19@\n0 TRLR');
        expect(matchOf(createMergeState(oldTree(), load(married)), 'Kvasoslav')?.reasons).toBeUndefined();
    });
});
