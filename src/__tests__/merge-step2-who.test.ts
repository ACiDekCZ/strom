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
import { decisionKind, defaultGroup, pairRows } from '../merge/steps/step2-who.js';
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
