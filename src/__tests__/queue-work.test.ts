/**
 * "Work on the queue…" (spec 052 §5): the research's `work` link, what the
 * status says about it (`work.link`, `run.tasks`, `/status.work`), when the
 * action is offered, and what the dialog reads and sends.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    RUN_TASKS_FEATURE, STATUS_BUSY_FEATURE, WORK_LINK_FEATURE, researchSchemeUrl, sanitizeLiveStatus, sanitizeLiveWork, workTaskIds, workTasksCount,
    type LiveQueueItem,
} from '../research-link.js';
import {
    queueWorkCounted, queueWorkFirst, queueWorkMore, queueWorkMoreCount, queueWorkOffer, queueWorkParams, queueWorkRest, queueWorkSessionLine,
    type QueueWorkContext, type QueueWorkState,
} from '../ui/queue-work-dialog.js';
import { setLanguage, strings } from '../strings.js';

const TREE = '0b9e1c2a-4f3d-4c5e-8a7b-1d2e3f4a5b6c';
const OK: QueueWorkContext = { live: true, linkAvailable: true, noAgent: false, phone: false };
const task = (id: string, extra: Partial<LiveQueueItem> = {}): LiveQueueItem => ({ id, text: `Task ${id}`, state: 'next', ...extra });

describe('the work link', () => {
    it('is built for automatic work or a count of 1–100 only', () => {
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'loop' })).toBe(`strom-research://work?tree=${TREE}&do=loop`);
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'tasks', n: 7 })).toBe(`strom-research://work?tree=${TREE}&do=tasks&n=7`);
        // As the overview's window hands it over: text.
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'tasks', n: '100' })).toBe(`strom-research://work?tree=${TREE}&do=tasks&n=100`);
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'tasks', n: 0 })).toBeNull();
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'tasks', n: 101 })).toBeNull();
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'tasks' })).toBeNull();
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'loop', n: 5 })).toBeNull();
        expect(researchSchemeUrl('work', { tree: TREE })).toBeNull();
    });

    it('names exactly the tasks of "Process now": 1–100 task ids, never with a count (spec 065 K7.2)', () => {
        const link = (workTasks: readonly string[], extra: { n?: number } = {}) => researchSchemeUrl('work', { tree: TREE, workDo: 'tasks', workTasks, ...extra });
        expect(link(['T0412', 'T0413', 'T0414'])).toBe(`strom-research://work?tree=${TREE}&do=tasks&task=T0412,T0413,T0414`);
        // Each task once, in its first place.
        expect(link(['T0413', 'T0412', 'T0413'])).toBe(`strom-research://work?tree=${TREE}&do=tasks&task=T0413,T0412`);
        const hundred = Array.from({ length: 100 }, (_, i) => `T${1000 + i}`);
        expect(link(hundred)).toBe(`strom-research://work?tree=${TREE}&do=tasks&task=${hundred.join(',')}`);
        expect(link([...hundred, 'T2000'])).toBeNull();
        expect(link([])).toBeNull();
        for (const bad of ['P0412', 'T', 'T12345678', '', ' T0412', 'T0412;', 'Т0412', 'T04,12', 'task']) expect(link(['T0001', bad])).toBeNull();
        expect(link(['T0412'], { n: 3 })).toBeNull();
        expect(researchSchemeUrl('work', { tree: TREE, workDo: 'loop', workTasks: ['T0412'] })).toBeNull();
        expect(workTaskIds('T0412')).toBeNull();
        expect(workTaskIds([1, 2])).toBeNull();
    });

    it('reads a count as a whole number 1–100', () => {
        expect([workTasksCount(1), workTasksCount('5'), workTasksCount(' 42 '), workTasksCount('007'), workTasksCount(100)]).toEqual([1, 5, 42, 7, 100]);
        for (const bad of [0, 101, 2.5, '', '1e2', '-3', 'abc', '1000', null, undefined, NaN]) expect(workTasksCount(bad)).toBeNull();
    });

    it('the dialog\'s choice makes the link\'s parameters (a wrong count none)', () => {
        expect(queueWorkParams('loop', '999')).toEqual({ workDo: 'loop' });
        expect(queueWorkParams('tasks', '12')).toEqual({ workDo: 'tasks', n: '12' });
        expect(queueWorkParams('tasks', '0')).toBeNull();
        expect(queueWorkParams('tasks', '')).toBeNull();
        expect(queueWorkParams('tasks', undefined)).toBeNull();
    });
});

describe('the status of work', () => {
    it('reads /status.work only with work.link', () => {
        const raw = { tree: TREE, features: [WORK_LINK_FEATURE, RUN_TASKS_FEATURE], work: { gate: 'Plan 80 %', minutes: 60 } };
        expect(sanitizeLiveStatus(raw)!.work).toEqual({ gate: 'Plan 80 %', minutes: 60 });
        expect(sanitizeLiveStatus({ ...raw, work: { gate: null, minutes: 90 } })!.work).toEqual({ gate: null, minutes: 90 });
        expect(sanitizeLiveStatus({ ...raw, features: [] })!.work).toBeUndefined();
        expect(sanitizeLiveStatus({ ...raw, work: 'yes' })!.work).toBeUndefined();
    });

    it('a gate is a name or null; minutes a count', () => {
        expect(sanitizeLiveWork({ gate: null })).toEqual({ gate: null, minutes: 0 });
        expect(sanitizeLiveWork({ minutes: 30 })).toBeNull();
        expect(sanitizeLiveWork({ gate: 7, minutes: 30 })).toBeNull();
        expect(sanitizeLiveWork({ gate: 'x'.repeat(300), minutes: 30 })!.gate!.length).toBeLessThanOrEqual(120);
    });
});

describe('when Work on the queue is offered', () => {
    const state = (extra: Partial<QueueWorkState> = {}): QueueWorkState => ({ features: [WORK_LINK_FEATURE, RUN_TASKS_FEATURE], queue: [task('T1')], ...extra });

    it('with work.link, a live bridge, an agent, the link opened here, not on a phone', () => {
        expect(queueWorkOffer(state(), OK)).toBe('offer');
        expect(queueWorkOffer(state({ features: [RUN_TASKS_FEATURE] }), OK)).toBe('none');
        expect(queueWorkOffer(state({ features: null }), OK)).toBe('none');
        expect(queueWorkOffer(state(), { ...OK, live: false })).toBe('none');
        expect(queueWorkOffer(state(), { ...OK, noAgent: true })).toBe('none');
        expect(queueWorkOffer(state(), { ...OK, linkAvailable: false })).toBe('none');
        expect(queueWorkOffer(state(), { ...OK, phone: true })).toBe('none');
        expect(queueWorkOffer(null, OK)).toBe('none');
    });

    it('while a session or a run works: At work in its place', () => {
        const features = [WORK_LINK_FEATURE, RUN_TASKS_FEATURE, STATUS_BUSY_FEATURE];
        expect(queueWorkOffer(state({ features, busy: { sessions: 1, runs: 0 } }), OK)).toBe('busy');
        expect(queueWorkOffer(state({ features, busy: { sessions: 0, runs: 1 } }), OK)).toBe('busy');
        expect(queueWorkOffer(state({ features, busy: { sessions: 0, runs: 0 } }), OK)).toBe('offer');
        // Nothing offered stays nothing (a phone, an archive) even at work.
        expect(queueWorkOffer(state({ features, busy: { sessions: 1, runs: 0 } }), { ...OK, phone: true })).toBe('none');
    });

    it('Only [n] tasks with run.tasks', () => {
        expect(queueWorkCounted(state())).toBe(true);
        expect(queueWorkCounted(state({ features: [WORK_LINK_FEATURE] }))).toBe(false);
    });
});

describe('what the dialog shows', () => {
    beforeEach(() => setLanguage('en'));

    it('first up: a task set next, else the first of the whole queue, else the first up next', () => {
        expect(queueWorkFirst([task('T1', { state: 'parked' }), task('T2'), task('T3', { own: 'next' })])!.id).toBe('T3');
        expect(queueWorkFirst([task('T5', { pos: 2 }), task('T4', { pos: 1 })])!.id).toBe('T4');
        expect(queueWorkFirst([task('T1', { state: 'parked' }), task('T7')])!.id).toBe('T7');
        expect(queueWorkFirst([task('T1', { state: 'parked' })])).toBeNull();
    });

    it('the session\'s line from what the bridge says', () => {
        expect(queueWorkSessionLine(undefined)).toBe('');
        expect(queueWorkSessionLine({ gate: null, minutes: 0 })).toBe('');
        expect(queueWorkSessionLine({ gate: null, minutes: 45 })).toBe('Session up to 45 min');
        expect(queueWorkSessionLine({ gate: 'Plan 80 %', minutes: 180 })).toBe('Session up to 3 h · subscription gate: Plan 80 %');
        expect(queueWorkSessionLine({ gate: 'Plan', minutes: 90 })).toBe('Session up to 1 h 30 min · subscription gate: Plan');
    });

    it('a count\'s words agree with it in every language', () => {
        const words = (): string[] => [1, 2, 5].map(n => strings.live.queueWorkOnlyWord(n));
        expect(words()).toEqual(['task', 'tasks', 'tasks']);
        expect(strings.live.queueWorkOnlyHint(1)).toMatch(/^Stops after 1 completed task;/);
        setLanguage('cs');
        expect(words()).toEqual(['úkol', 'úkoly', 'úkolů']);
        expect(strings.live.queueWorkOnlyHint(1)).toMatch(/^Skončí po 1 vyřízeném úkolu;/);
        setLanguage('de');
        expect(words()).toEqual(['Aufgabe', 'Aufgaben', 'Aufgaben']);
        setLanguage('pl');
        expect(words()).toEqual(['zadanie', 'zadania', 'zadań']);
        setLanguage('en');
    });
});

describe('More under First up', () => {
    beforeEach(() => setLanguage('en'));
    const counts = (next: number) => ({ research: {}, branch: {}, next, parked: 0, rev: '0123456789abcdef' });
    const ids = (q: readonly LiveQueueItem[]) => q.map(x => x.id);

    it('the tasks after the first: not parked, not "never", the one set next first, then by place', () => {
        const queue = [
            task('T1', { pos: 1 }), task('T2', { state: 'parked' }), task('T3', { pos: 4 }), task('T4', { pos: 3, offLine: 'never' }),
            task('T5', { pos: 2 }), task('T6', { own: 'next' }), task('T7'),
        ];
        const first = queueWorkFirst(queue);
        expect(first!.id).toBe('T6');
        // T6 is the first: T1 comes after it; a task without a place after those with one.
        expect(ids(queueWorkMore(queue, first))).toEqual(['T1', 'T5', 'T3', 'T7']);
        // A second task set next stays before the placed ones.
        const two = [task('T1', { pos: 1 }), task('T2', { own: 'next', pos: 3 }), task('T3', { own: 'next', pos: 2 })];
        expect(ids(queueWorkMore(two, queueWorkFirst(two)))).toEqual(['T3', 'T1']);
    });

    it('without places: the status\'s order, stable', () => {
        const queue = [task('T9'), task('T2'), task('T5', { state: 'parked' }), task('T4')];
        expect(ids(queueWorkMore(queue, queueWorkFirst(queue)))).toEqual(['T2', 'T4']);
        const alone = [task('T1')];
        expect(queueWorkMore(alone, queueWorkFirst(alone))).toEqual([]);
        expect(queueWorkMore([], null)).toEqual([]);
    });

    it('the count: none without more, the counts\' next less the first, "n+" for a full status without counts', () => {
        const state = (queue: LiveQueueItem[], extra: Partial<QueueWorkState> = {}): QueueWorkState => ({ queue, ...extra });
        const one = [task('T1')];
        expect(queueWorkMoreCount(state(one), queueWorkMore(one, one[0]))).toBeNull();
        const three = [task('T1'), task('T2'), task('T3')];
        const more3 = queueWorkMore(three, three[0]);
        expect(queueWorkMoreCount(state(three), more3)).toBe('2');
        expect(queueWorkMoreCount(state(three, { queueCounts: counts(57) }), more3)).toBe('56');
        // Counts behind what is listed (a status between two counts): never fewer than the rows.
        expect(queueWorkMoreCount(state(three, { queueCounts: counts(1) }), more3)).toBe('2');
        const full = Array.from({ length: 20 }, (_, i) => task(`T${i + 1}`));
        expect(queueWorkMoreCount(state(full), queueWorkMore(full, full[0]))).toBe('19+');
        expect(queueWorkMoreCount(state(full, { queueCounts: counts(20) }), queueWorkMore(full, full[0]))).toBe('19');
    });

    it('the rest past the rows: unknown without counts, never below 0', () => {
        const three = [task('T1'), task('T2'), task('T3')];
        const more = queueWorkMore(three, three[0]);
        expect(queueWorkRest({ queue: three }, more)).toBeNull();
        expect(queueWorkRest({ queue: three, queueCounts: counts(57) }, more)).toBe(54);
        expect(queueWorkRest({ queue: three, queueCounts: counts(3) }, more)).toBe(0);
        expect(queueWorkRest({ queue: three, queueCounts: counts(1) }, more)).toBe(0);
    });

    it('its words in every language', () => {
        const L = () => strings.live;
        expect([L().queueWorkMore('12'), L().queueWorkLess, L().queueWorkRest(1), L().queueWorkRest(37)])
            .toEqual(['More (12)', 'Hide more', 'and 1 more task in the queue', 'and 37 more tasks in the queue']);
        setLanguage('cs');
        expect([L().queueWorkMore('19+'), L().queueWorkLess, L().queueWorkRest(1), L().queueWorkRest(3), L().queueWorkRest(37)])
            .toEqual(['Další (19+)', 'Skrýt další', 'a ještě 1 úkol ve frontě', 'a ještě 3 úkoly ve frontě', 'a ještě 37 úkolů ve frontě']);
        setLanguage('de');
        expect([L().queueWorkMore('12'), L().queueWorkRest(1), L().queueWorkRest(37)])
            .toEqual(['Weitere (12)', 'und 1 weitere Aufgabe in der Warteschlange', 'und 37 weitere Aufgaben in der Warteschlange']);
        setLanguage('pl');
        expect([L().queueWorkMore('12'), L().queueWorkRest(1), L().queueWorkRest(3), L().queueWorkRest(37)])
            .toEqual(['Kolejne (12)', 'i jeszcze 1 zadanie w kolejce', 'i jeszcze 3 zadania w kolejce', 'i jeszcze 37 zadań w kolejce']);
        setLanguage('en');
    });
});
