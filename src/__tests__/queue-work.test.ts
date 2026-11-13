/**
 * "Work on the queue…" (spec 052 §5): the research's `work` link, what the
 * status says about it (`work.link`, `run.tasks`, `/status.work`), when the
 * action is offered, and what the dialog reads and sends.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    RUN_TASKS_FEATURE, STATUS_BUSY_FEATURE, WORK_LINK_FEATURE, researchSchemeUrl, sanitizeLiveStatus, sanitizeLiveWork, workTasksCount,
    type LiveQueueItem,
} from '../research-link.js';
import {
    queueWorkCounted, queueWorkFirst, queueWorkOffer, queueWorkParams, queueWorkSessionLine, type QueueWorkContext, type QueueWorkState,
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
