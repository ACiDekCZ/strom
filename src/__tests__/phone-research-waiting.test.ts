/**
 * Waiting of a phone's Research screen (spec 094 K3.13 §5): an item's kind, its actions only as its `do` offers
 * them (and in the order of its kind), at most five items with the rest counted, what is new, a sent row's meta.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage } from '../strings';
import {
    PHONE_WAITING_MAX, phoneWaitingActions, phoneWaitingKind, phoneWaitingRowData, phoneWaitingSentMeta, phoneWaitingShown, waitingIsNew,
} from '../ui/phone-research-ui';
import type { DeviceGlance, DeviceGlanceWaiting } from '../device/device-research-data';

const NOW = Date.parse('2026-11-25T14:40:00Z');

function item(id: string, o: Partial<DeviceGlanceWaiting> = {}): DeviceGlanceWaiting {
    return {
        id, kind: 'letter', section: 'letter', phase: 'todo', what: `Item ${id}`, at: '2026-11-25T10:00:00Z',
        group: { key: 'g', name: 'G', kind: 'office' }, do: [], ...o,
    };
}

beforeAll(() => setLanguage('en'));

describe('an item of Waiting', () => {
    it('is a task, a branch, a hypothesis or a conflict', () => {
        expect(phoneWaitingKind(item('T0007'))).toBe('task');
        expect(phoneWaitingKind(item('W-B-P0012', { kind: 'branch', section: 'branch' }))).toBe('branch');
        expect(phoneWaitingKind(item('W-B-P0012-2', { kind: 'growing', section: 'other' }))).toBe('branch');
        expect(phoneWaitingKind(item('H0003', { kind: 'hypothesis', section: 'hypothesis' }))).toBe('hypothesis');
        expect(phoneWaitingKind(item('X1', { kind: 'other', hypothesis: { variants: [] } }))).toBe('hypothesis');
        expect(phoneWaitingKind(item('C0002', { kind: 'conflict', section: 'conflict' }))).toBe('conflict');
    });
});

describe('the actions of an item, only as its do offers them', () => {
    it('a task to do: Answer, Sent, Retry (when it can go back), in that order whatever the order of do', () => {
        const t = item('T1', { do: ['retry', 'sent', 'answer'], retry: { can: true, says: '' } });
        expect(phoneWaitingActions(t)).toEqual(['answer', 'sent', 'retry']);
        expect(phoneWaitingActions({ ...t, retry: { can: false, says: '' } })).toEqual(['answer', 'sent']);
        expect(phoneWaitingActions({ ...t, do: ['answer'] })).toEqual(['answer']);
        expect(phoneWaitingActions({ ...t, do: [] })).toEqual([]);
    });

    it('a sent task: Back to To do, never Sent again', () => {
        expect(phoneWaitingActions(item('T1', { phase: 'sent', do: ['sent', 'unsent', 'answer'] }))).toEqual(['answer', 'unsent']);
        expect(phoneWaitingActions(item('T1', { phase: 'todo', do: ['unsent'] }))).toEqual([]);
    });

    it('a branch: line, keep, never; a hypothesis: decide; a conflict: keep only', () => {
        expect(phoneWaitingActions(item('W-B-P0001', { kind: 'branch', do: ['never', 'keep', 'line'] }))).toEqual(['line', 'keep', 'never']);
        expect(phoneWaitingActions(item('H1', { kind: 'hypothesis', do: ['decide', 'answer'] }))).toEqual(['decide']);
        expect(phoneWaitingActions(item('C1', { kind: 'conflict', do: ['keep', 'decide', 'answer'] }))).toEqual(['keep']);
        // The research offers no action of a conflict now: none drawn.
        expect(phoneWaitingActions(item('C1', { kind: 'conflict', do: [] }))).toEqual([]);
    });

    it('none once decided here, none this device may not do', () => {
        const h = item('H1', { kind: 'hypothesis', do: ['decide'] });
        expect(phoneWaitingActions(h, { decided: true })).toEqual([]);
        expect(phoneWaitingActions(h, { allows: d => d !== 'decide' })).toEqual([]);
        expect(phoneWaitingActions(item('T1', { do: ['answer', 'sent'] }), { allows: d => d !== 'sent' })).toEqual(['answer']);
    });
});

describe('at most five items, the rest counted', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`T000${i + 1}`));
    it('seven: five and 2 more', () => {
        const shown = phoneWaitingShown(items, 7);
        expect(PHONE_WAITING_MAX).toBe(5);
        expect(shown.items.map(i => i.id)).toEqual(['T0001', 'T0002', 'T0003', 'T0004', 'T0005']);
        expect(shown.more).toBe(2);
    });
    it('the research cut its list: the rest by its count', () => {
        expect(phoneWaitingShown(items.slice(0, 3), 60).more).toBe(57);
    });
    it('five or fewer: no more', () => {
        expect(phoneWaitingShown(items.slice(0, 5), 5).more).toBe(0);
        expect(phoneWaitingShown([], 0)).toEqual({ items: [], more: 0 });
    });
});

describe('what is new', () => {
    it('after the finds last seen here; nothing seen yet, within the last 24 hours', () => {
        expect(waitingIsNew('2026-11-25T14:00:00Z', '2026-11-25T13:00:00Z', NOW)).toBe(true);
        expect(waitingIsNew('2026-11-25T12:00:00Z', '2026-11-25T13:00:00Z', NOW)).toBe(false);
        expect(waitingIsNew('2026-11-25T10:00:00Z', null, NOW)).toBe(true);
        expect(waitingIsNew('2026-11-23T10:00:00Z', null, NOW)).toBe(false);
        expect(waitingIsNew('not a time', null, NOW)).toBe(false);
    });
});

describe('a sent row', () => {
    it('says when, and the photos when any went', () => {
        expect(phoneWaitingSentMeta('14:41', 1)).toBe('Sent 14:41 · 1 photo');
        expect(phoneWaitingSentMeta('14:41', 0)).toBe('Sent 14:41');
    });
});

describe('the day a request went out (spec 149)', () => {
    const row = (it: DeviceGlanceWaiting, sentDay: boolean) => phoneWaitingRowData(it, undefined, {
        g: { people: {} } as unknown as DeviceGlance, lang: 'en', now: NOW, seen: null, pc: 'PC', allows: () => true, sentDay,
    });
    const sent = (sentAt: string) => item('T1', { phase: 'sent', sentAt, do: ['sent', 'unsent', 'answer'] });

    it('a day given is said as that day, never a clock or the day beside it; today\'s moment as its clock', () => {
        expect(row(sent('2026-11-20T12:00:00.000Z'), true).meta).toBe('Sent 11/20');
        // Today's moment, two hours before now (in any time zone).
        const moment = row(sent(new Date(NOW - 2 * 3600_000).toISOString()), true).meta;
        expect(moment).toMatch(/^Sent \d{1,2}:\d{2}/);
        expect(moment).not.toMatch(/\d+\/\d+/);
    });

    it('Change the day after Back to To do, only with waiting.sentDay', () => {
        expect(row(sent('2026-11-20T12:00:00.000Z'), true).acts.map(a => a.do)).toEqual(['answer', 'unsent', 'sent-day']);
        expect(row(sent('2026-11-20T12:00:00.000Z'), false).acts.map(a => a.do)).toEqual(['answer', 'unsent']);
        expect(row(item('T1', { do: ['sent', 'answer'] }), true).acts.map(a => a.do)).toEqual(['answer', 'sent']);
    });
});
