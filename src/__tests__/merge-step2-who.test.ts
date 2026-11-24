/**
 * Step 2 of the import guide (spec 134 §4): every person of the import
 * stands in exactly one group (Maybe the same below the score that joins,
 * The same from it, New without a pair; "?" stand-ins in none), the guide
 * opens on the first group that has anyone, and a row's decision reads back
 * as the choice it shows. Invented trees only (helpers/merge-trees.ts).
 */

import { describe, it, expect } from 'vitest';
import { AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { createMergeState, updateMatchDecision } from '../merge/matching.js';
import { decisionKind, defaultGroup, firstPending, isCopyOfTarget, openingView, pairRows, pendingPairs, type PairRow } from '../merge/steps/step2-who.js';
import type { PersonId } from '../types.js';
import type { MergePlan, PlanCounts, WizardChoices } from '../merge/plan.js';
import { mulberry32, sourceTree, targetTree } from './helpers/merge-trees.js';

function stateOf(seed: number) {
    const rnd = mulberry32(seed);
    const target = targetTree(rnd);
    return createMergeState(target, sourceTree(target, rnd));
}

describe('step 2 – the groups of the pairs', () => {
    it('puts each named person of the import into one group, by its score', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const state = stateOf(seed);
            const rows = pairRows(state);
            const ids = rows.map(r => r.id);
            expect(new Set(ids).size).toBe(ids.length);
            const named = Object.values(state.incomingData.persons).filter(p => !p.isPlaceholder).map(p => p.id);
            const inPairs = new Set([...state.matches.map(m => m.incomingId), ...state.unmatchedIncoming]);
            expect(new Set(ids)).toEqual(new Set(named.filter(id => inPairs.has(id))));
            for (const r of rows) {
                if (r.group === 'new') expect(r.match).toBeNull();
                else expect(r.match!.score >= AUTO_CONFIRM_SCORE).toBe(r.group === 'same');
            }
        }
    });

    it('opens on Maybe the same when there are any, else The same, else New', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const rows = pairRows(stateOf(seed));
            const first = rows.some(r => r.group === 'maybe') ? 'maybe' : rows.some(r => r.group === 'same') ? 'same' : 'new';
            expect(defaultGroup(rows)).toBe(first);
        }
        expect(defaultGroup([])).toBe('new');
    });

    it('reads a decision back as the choice it shows', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const state = stateOf(seed);
            const maybe = pairRows(state).find(r => r.group === 'maybe');
            if (!maybe) continue;
            expect(decisionKind(state, maybe)).toBeNull();
            updateMatchDecision(state, maybe.id, 'confirm');
            expect(decisionKind(state, maybe)).toBe('same');
            updateMatchDecision(state, maybe.id, 'reject');
            expect(decisionKind(state, maybe)).toBe('new');
            updateMatchDecision(state, maybe.id, 'skip');
            expect(decisionKind(state, maybe)).toBe('skip');
            return;
        }
        throw new Error('no seed gave a pair below the joining score');
    });
});

describe('step 2 – where it opens and "To decide N" (K10.5)', () => {
    const row = (id: string, group: PairRow['group']): PairRow => ({ id: id as PersonId, group, match: null });
    const pending = (...ids: string[]): Set<PersonId> => new Set(ids as PersonId[]);
    const rows = [row('s1', 'same'), row('m1', 'maybe'), row('m2', 'maybe'), row('m3', 'maybe'), row('n1', 'new'), row('n2', 'new')];

    it('opens on Maybe the same at its first undecided pair, whatever group was shown before', () => {
        const f = pending('m2', 'm3');
        expect(openingView(rows, f, 'same', 's1' as PersonId)).toEqual({ group: 'maybe', selected: 'm2' });
        expect(openingView(rows, f, 'new', null)).toEqual({ group: 'maybe', selected: 'm2' });
        expect(openingView(rows, f, null, null)).toEqual({ group: 'maybe', selected: 'm2' });
        expect(openingView(rows, f, 'maybe', 'm3' as PersonId)).toEqual({ group: 'maybe', selected: 'm2' });
    });

    it('keeps the group and pair shown last when nothing waits in Maybe the same (the default group the first time)', () => {
        const f = pending();
        expect(openingView(rows, f, 'same', 's1' as PersonId)).toEqual({ group: 'same', selected: 's1' });
        expect(openingView(rows, f, 'new', 'n1' as PersonId)).toEqual({ group: 'new', selected: 'n1' });
        expect(openingView(rows, f, null, null)).toEqual({ group: 'maybe', selected: null });
        expect(openingView([row('s1', 'same')], pending(), null, null)).toEqual({ group: 'same', selected: null });
    });

    it('finds the first pair to decide in Maybe the same first, in the list\'s order', () => {
        expect(firstPending(rows, pending('m3', 'm2'))?.id).toBe('m2');
        expect(firstPending(rows, pending('s1', 'm3'))?.id).toBe('m3');
        expect(firstPending(rows, pending('n2'))).toEqual(row('n2', 'new'));
        expect(firstPending(rows, pending())).toBeNull();
        expect(firstPending([], pending())).toBeNull();
    });

    it('counts as a pair to decide only an offered pair nobody decided, not a person of an undecided unlinked group (step 3\'s)', () => {
        const plan = { items: [
            { kind: 'person-pending', id: 'm1', candidate: 't1', score: 60 },
            { kind: 'group-pending', id: 'n1', group: 'g1' },
            { kind: 'person-add', id: 'n2', on: true },
        ] } as unknown as MergePlan;
        expect([...pendingPairs(plan)]).toEqual(['m1']);
        expect(pendingPairs(null).size).toBe(0);
    });
});

describe('step 2 – a copy of the tree (13b)', () => {
    const counts = (o: Partial<PlanCounts> = {}): PlanCounts => ({
        joined: 3, added: 0, skipped: 0, pending: 0, total: 3, fieldChanges: 0, fieldFills: 0, differencesKept: 0, alongside: 0, partnerships: 0, links: 0, sourcesJoined: 0, ...o,
    });
    const choices = (scope: WizardChoices['scope']): WizardChoices => ({ mode: 'add', scope } as WizardChoices);

    it('is a copy when everyone is joined and nothing would change', () => {
        expect(isCopyOfTarget({ counts: counts(), choices: choices('c') })).toBe(true);
        expect(isCopyOfTarget({ counts: counts({ differencesKept: 2 }), choices: choices('a') })).toBe(true);
    });

    it('is no copy in scopes c) and d) while a differing detail is kept by the rules: step 4 decides it', () => {
        expect(isCopyOfTarget({ counts: counts({ differencesKept: 1 }), choices: choices('c') })).toBe(false);
        expect(isCopyOfTarget({ counts: counts({ differencesKept: 1 }), choices: choices('d') })).toBe(false);
    });
});
