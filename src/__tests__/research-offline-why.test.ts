/**
 * Why a task stands where it stands in the queue (spec 038 K7, `queue[].why`):
 * each kind of reason in words, the direction by its name, the branch by its
 * person, an older research (no `why`) with nothing said here. Invented data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { strings } from '../strings.js';
import type { LiveQueueItem } from '../research-link.js';

type Why = (q: LiveQueueItem, s: unknown) => string;

describe('the reason of a task in the queue', () => {
    let queueWhyText: Why;
    let taskOrderOffered: (s: unknown) => boolean;

    beforeAll(async () => {
        const m = await import('../ui/research-offline-ui.js') as unknown as { queueWhyText: Why; taskOrderOffered: (s: unknown) => boolean };
        queueWhyText = m.queueWhyText;
        taskOrderOffered = m.taskOrderOffered;
    }, 60000);

    const session = {
        researches: [
            { id: 'G0003', name: 'Předci: Eva Lhotáková', state: 'active' },
            { id: 'G0005', name: 'Potomci: Jan Fíšek', state: 'paused' },
        ],
    };
    const task = (why: LiveQueueItem['why'], branch?: string): LiveQueueItem =>
        ({ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', ...(why ? { why } : {}), ...(branch ? { branch } : {}) }) as LiveQueueItem;
    const L = strings.live;

    it('set by hand: next and at the end', () => {
        expect(queueWhyText(task({ kind: 'own', do: 'next' }), session)).toBe(L.qWhyManualNext);
        expect(queueWhyText(task({ kind: 'own', do: 'last' }), session)).toBe(L.qWhyManualLast);
    });

    it('in a direction, by its name (its id when the research does not list it)', () => {
        expect(queueWhyText(task({ kind: 'line', research: 'G0003' }), session)).toBe(L.qWhyLine('Předci: Eva Lhotáková'));
        expect(queueWhyText(task({ kind: 'line', research: 'G0009' }), session)).toBe(L.qWhyLine('G0009'));
    });

    it('helps a direction: how, an added branch by its person', () => {
        for (const by of ['question', 'joins', 'agent', 'partner'] as const) {
            expect(queueWhyText(task({ kind: 'helps', research: 'G0003', by }), session)).toBe(L.qWhyHelps('Předci: Eva Lhotáková', L.qWhyHow[by]));
        }
        expect(queueWhyText(task({ kind: 'helps', research: 'G0003', by: 'branch' }, 'B-P0031'), session))
            .toBe(L.qWhyHelps('Předci: Eva Lhotáková', L.qWhyHowBranch('P0031')));
    });

    it('outside the directions: how it is taken, its branch', () => {
        expect(queueWhyText(task({ kind: 'off', mode: 'occasional', branch: 'B-P0031' }), session)).toBe(L.qWhyOut(L.offMode.occasional, 'P0031'));
        expect(queueWhyText(task({ kind: 'off', mode: 'last' }, 'B-P0040'), session)).toBe(L.qWhyOut(L.offMode.last, 'P0040'));
        expect(queueWhyText(task({ kind: 'off', mode: 'normal' }), session)).toBe(L.qWhyOutNoBranch(L.offMode.normal));
    });

    it('waiting for a paused direction', () => {
        expect(queueWhyText(task({ kind: 'paused', research: 'G0005' }), session)).toBe(L.qWhyPaused);
    });

    it('an older research says no reason: nothing here (its own note stays)', () => {
        expect(queueWhyText(task(undefined), session)).toBe('');
        expect(queueWhyText(task({ kind: 'own', do: 'next' }), null)).toBe('');
    });

    it('a task\'s own place only with a research that takes it and a bridge that answers', () => {
        const base = { ended: false, lostSince: null, features: ['queue.own'], caps: { offLineBranches: true } };
        expect(taskOrderOffered(base)).toBe(true);
        expect(taskOrderOffered({ ...base, features: [] })).toBe(false);
        expect(taskOrderOffered({ ...base, caps: {} })).toBe(false);
        expect(taskOrderOffered({ ...base, lostSince: 1 })).toBe(false);
        expect(taskOrderOffered({ ...base, ended: true })).toBe(false);
    });
});
