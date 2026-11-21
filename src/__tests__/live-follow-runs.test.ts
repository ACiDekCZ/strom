/**
 * Following the agent while several runs work (spec 126 U10 §7): each run's number and label
 * by its block in Now, the run followed in the primary colour, the phone's marks of the run
 * followed alone, the default run followed and what follows its end. Without runs: sessions
 * exactly as before.
 */

import { describe, it, expect } from 'vitest';
import {
    followTargets, rowMarks, runNumbers, runLabel, runTone, defaultFollowedRun, followedRunOf, leadFirst, runOfRow,
    type FollowRun, type WorkingRow,
} from '../live-follow-targets.js';
import { PersonId } from '../types.js';

const P = (s: string) => s as PersonId;
const tree: Record<string, PersonId> = { P0001: P('rozalie'), P0002: P('karel'), P0004: P('vojtech') };
const personOf = (r: string) => tree[r] ?? null;

/** Two runs as Now orders them: the whole queue first, then the line G0001 (↑). */
function twoRuns(): { working: WorkingRow[]; runs: FollowRun[] } {
    const working: WorkingRow[] = [
        { who: 'Claude', task: 'Matriky Dolní Lhota', person: 'P0004', session: 'N0141' },
        { who: 'Claude', task: 'Sčítání 1921', person: 'P0001', session: 'N0142', research: 'G0001' },
    ];
    const runs: FollowRun[] = [
        { id: 'run-8f2c', kind: 'queue', state: 'working', session: 'N0141', workers: [working[0]] },
        { id: 'run-1a07', kind: 'line', research: 'G0001', state: 'working', session: 'N0142', workers: [working[1]], glyph: '↑' },
    ];
    return { working, runs };
}

describe('runNumbers and labels', () => {
    it('numbers the runs by their block in Now, the ended ones left out; numbered from two', () => {
        const { numbers, numbered } = runNumbers([
            { id: 'a', state: 'working' }, { id: 'b', state: 'ended' }, { id: 'c', state: 'waiting' },
        ]);
        expect([...numbers]).toEqual([['a', 1], ['c', 2]]);
        expect(numbered).toBe(true);
        expect(runNumbers([{ id: 'a', state: 'working' }, { id: 'b', state: 'ended' }]).numbered).toBe(false);
    });

    it('labels the whole queue by its number and a line run by its glyph and number', () => {
        expect(runLabel({ kind: 'queue' }, 1)).toBe('1');
        expect(runLabel({ kind: 'line', glyph: '↑' }, 2)).toBe('↑ 2');
        expect(runLabel({ kind: 'line' }, 3)).toBe('3');
    });

    it('gives the run followed the primary colour and every other one the accent', () => {
        expect(runTone('run-1a07', 'run-1a07')).toBe('primary');
        expect(runTone('run-8f2c', 'run-1a07')).toBe('accent');
        expect(runTone(undefined, 'run-1a07')).toBe('accent');
        expect(runTone('run-8f2c', null)).toBe('accent');
    });
});

describe('followTargets with runs', () => {
    it('marks each row by its run: label, number and the colour of the run followed', () => {
        const { working, runs } = twoRuns();
        const t = followTargets(working, personOf, { runs, followedRunId: 'run-1a07' });
        expect(t.map(x => [x.personId, x.session, x.label, x.tone, x.runId])).toEqual([
            ['vojtech', 1, '1', 'accent', 'run-8f2c'],
            ['rozalie', 2, '↑ 2', 'primary', 'run-1a07'],
        ]);
        // The primary one leads on a shared spot.
        expect([...t].sort(leadFirst)[0].runId).toBe('run-1a07');
    });

    it('keeps the run followed alone on a phone (onlyRun)', () => {
        const { working, runs } = twoRuns();
        const t = followTargets(working, personOf, { runs, followedRunId: 'run-8f2c', onlyRun: 'run-8f2c' });
        expect(t.map(x => x.personId)).toEqual(['vojtech']);
        expect(followTargets(working, personOf, { runs, followedRunId: null, onlyRun: null })).toEqual([]);
    });

    it('finds a row\'s run by `run`, by the run holding it, or by its session', () => {
        const { working, runs } = twoRuns();
        expect(runOfRow({ who: 'x', task: '', run: 'run-1a07' }, runs)?.id).toBe('run-1a07');
        expect(runOfRow(working[0], runs)?.id).toBe('run-8f2c');
        expect(runOfRow({ who: 'x', task: '', session: 'N0142' }, runs)?.id).toBe('run-1a07');
        expect(runOfRow({ who: 'x', task: '' }, runs)).toBeNull();
    });

    it('numbers a row of no run (a conversation) after the runs, in the accent', () => {
        const { working, runs } = twoRuns();
        const all = [...working, { who: 'Claude', task: 'Rozhovor', person: 'P0002' }];
        const { marks, numbered } = rowMarks(all, { runs, followedRunId: 'run-8f2c' });
        expect(marks.map(m => m && [m.label, m.tone])).toEqual([['1', 'primary'], ['↑ 2', 'accent'], ['3', 'accent']]);
        expect(numbered).toBe(true);
    });

    it('without runs: the session numbers and colours as before', () => {
        const working: WorkingRow[] = [
            { who: 'a', task: '', person: 'P0001' },
            { who: 'b', task: '', person: 'P0002', paused: { until: '', reason: 'limit' } },
            { who: 'c', task: '', person: 'P0004' },
        ];
        const t = followTargets(working, personOf);
        expect(t.map(x => [x.session, x.label, x.tone, x.runId])).toEqual([[1, '1', 'primary', undefined], [2, '2', 'accent', undefined]]);
        expect(followTargets(working, personOf, { runs: [] })).toEqual(t);
        // onlyRun means nothing without runs.
        expect(followTargets(working, personOf, { onlyRun: 'run-x' })).toEqual(t);
    });
});

describe('the run followed', () => {
    it('defaults to the first run in Now that is not waiting and works on a person of the tree', () => {
        const { runs } = twoRuns();
        expect(defaultFollowedRun(runs)).toBe('run-8f2c');
        const waiting = runs.map(r => r.id === 'run-8f2c' ? { ...r, state: 'waiting' } : r);
        expect(defaultFollowedRun(waiting)).toBe('run-1a07');
        // The first one works outside the tree: the next with a person of the tree.
        expect(defaultFollowedRun(runs, r => r.id === 'run-1a07')).toBe('run-1a07');
        // None of them on a person of the tree: the first not waiting.
        expect(defaultFollowedRun(runs, () => false)).toBe('run-8f2c');
        expect(defaultFollowedRun(runs.map(r => ({ ...r, state: 'waiting' })))).toBeNull();
    });

    it('keeps the run chosen while it runs, and the default once it ends', () => {
        const { runs } = twoRuns();
        expect(followedRunOf(runs, 'run-1a07')).toBe('run-1a07');
        const ended = runs.map(r => r.id === 'run-1a07' ? { ...r, state: 'ended' } : r);
        expect(followedRunOf(ended, 'run-1a07')).toBe('run-8f2c');
        expect(followedRunOf(runs, 'run-gone')).toBe('run-8f2c');
        expect(followedRunOf(runs, null)).toBe('run-8f2c');
        // A new run in Now does not take the following over.
        const three = [...runs, { id: 'run-77aa', kind: 'line' as const, research: 'G0002', state: 'working', workers: [], glyph: '↓' }];
        expect(followedRunOf(three, null)).toBe('run-8f2c');
    });
});
