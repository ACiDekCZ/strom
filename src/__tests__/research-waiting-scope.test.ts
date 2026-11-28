/**
 * Awaiting action at a direction and a person (spec 150 U2): everyone a task is about (`persons`, kept as
 * `personIds`), the card's ! counting `person` or `persons` once, the scope of a direction (by `research`) and of
 * a person, and the overview window's action that sets or drops it. An older research (no `persons`, no
 * `research`) as before. Invented tasks only.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeWaiting } from '../research-link.js';
import { personWaiting, sameWaitingScope, scopedWaiting, waitingInScope, waitingNames } from '../research-waiting.js';
import { readOverviewAction } from '../windows/overview-window.js';

const task = (id: string, extra: Record<string, unknown> = {}) => ({
    id, what: `Úkol ${id}`, at: '2026-11-20T08:00:00Z', kind: 'images', section: 'images', ...extra,
});

describe('everyone a task is about (persons)', () => {
    it('read as personIds: valid REFNs, once each, in order; none valid or none: absent', () => {
        const [a, b, c, d] = sanitizeWaiting([
            task('T0001', { persons: ['P0002', 'P0001', 'P0002', 'x', 7, 'P1'] }),
            task('T0002', { person: 'P0003' }),
            task('T0003', { persons: [] }),
            task('T0004', { persons: ['nope'] }),
        ], true);
        expect(a.personIds).toEqual(['P0002', 'P0001', 'P1']);
        expect(b.personIds).toBeUndefined();
        expect(c.personIds).toBeUndefined();
        expect(d.personIds).toBeUndefined();
    });

    it('kept on this device as it was read (the stored list is read again)', () => {
        const [w] = sanitizeWaiting([task('T0001', { persons: ['P0002', 'P0001'] })], true);
        const [again] = sanitizeWaiting(JSON.parse(JSON.stringify([w])), true);
        expect(again.personIds).toEqual(['P0002', 'P0001']);
    });

    it('a branch\'s persons stay its count of people', () => {
        const [b] = sanitizeWaiting([{ id: 'W-B-P0012', what: 'Větev roste', kind: 'branch', branch: 'B-P0012', tasks: 3, persons: 5 }], true, true);
        expect(b).toMatchObject({ kind: 'branch', persons: 5 });
        expect(b.personIds).toBeUndefined();
    });
});

describe('the card\'s ! and "Answer · N" (K2.2, K2.4)', () => {
    const items = sanitizeWaiting([
        task('T0001', { person: 'P0001', persons: ['P0001'] }),
        task('T0002', { persons: ['P0002', 'P0001'] }),
        task('T0003', { person: 'P0002' }),
        task('T0004', { persons: ['P0001'], phase: 'sent', sentAt: '2026-11-21T12:00:00.000Z' }),
    ], true);

    it('person or persons, each item once; what was sent asks nothing now', () => {
        expect(personWaiting(items, 'P0001').map(w => w.id)).toEqual(['T0001', 'T0002']);
        expect(personWaiting(items, 'P0002').map(w => w.id)).toEqual(['T0002', 'T0003']);
        expect(personWaiting(items, 'P0009')).toEqual([]);
        expect(personWaiting(items, undefined)).toEqual([]);
    });

    it('an older research (no persons): only person, as before', () => {
        const old = sanitizeWaiting([task('T0001', { person: 'P0001' }), task('T0002', {})], true);
        expect(personWaiting(old, 'P0001').map(w => w.id)).toEqual(['T0001']);
        expect(waitingNames({ person: 'P0001' }, 'P0001')).toBe(true);
        expect(waitingNames({}, 'P0001')).toBe(false);
    });
});

describe('the scope of Awaiting action (K1.2, K1.3, K2.3)', () => {
    const items = sanitizeWaiting([
        task('T0001', { research: 'G0001', person: 'P0001' }),
        task('T0002', { research: 'G0002', persons: ['P0002', 'P0001'] }),
        task('T0003', {}),
        { id: 'S0001', what: 'Nová verze příběhu', kind: 'story', person: 'P0003', partner: 'P0001' },
    ], true);

    it('a direction: by research only (an item without it never)', () => {
        const line = { kind: 'line' as const, id: 'G0001', name: 'Předci Jana' };
        expect(scopedWaiting(items, line).map(w => w.id)).toEqual(['T0001']);
        expect(scopedWaiting(items, { kind: 'line', id: 'G0009', name: '' })).toEqual([]);
        expect(items.filter(w => waitingInScope(w, line)).length).toBe(1);
    });

    it('a person: person, persons, a story of their couple', () => {
        expect(scopedWaiting(items, { kind: 'person', ref: 'P0001', name: 'Jan' }).map(w => w.id)).toEqual(['T0001', 'T0002', 'S0001']);
        expect(scopedWaiting(items, { kind: 'person', ref: 'P0002', name: '' }).map(w => w.id)).toEqual(['T0002']);
    });

    it('none: all of it', () => {
        expect(scopedWaiting(items, null)).toBe(items);
    });

    it('the same scope whatever its name', () => {
        expect(sameWaitingScope({ kind: 'line', id: 'G0001', name: 'a' }, { kind: 'line', id: 'G0001', name: 'b' })).toBe(true);
        expect(sameWaitingScope({ kind: 'line', id: 'G0001', name: 'a' }, { kind: 'line', id: 'G0002', name: 'a' })).toBe(false);
        expect(sameWaitingScope({ kind: 'person', ref: 'P0001', name: '' }, { kind: 'line', id: 'G0001', name: '' })).toBe(false);
        expect(sameWaitingScope(null, undefined)).toBe(true);
        expect(sameWaitingScope(null, { kind: 'person', ref: 'P0001', name: '' })).toBe(false);
    });
});

describe('the overview\'s own window asks the main window for the scope', () => {
    it('a direction, a person, or none; anything else refused', () => {
        expect(readOverviewAction('waiting-scope', { scope: { kind: 'line', id: 'G0001', name: 'Předci Jana' } }))
            .toEqual({ action: 'waiting-scope', args: { scope: { kind: 'line', id: 'G0001', name: 'Předci Jana' } } });
        expect(readOverviewAction('waiting-scope', { scope: { kind: 'person', ref: 'P0001', name: 'Jan' } }))
            .toEqual({ action: 'waiting-scope', args: { scope: { kind: 'person', ref: 'P0001', name: 'Jan' } } });
        expect(readOverviewAction('waiting-scope', { scope: null })).toEqual({ action: 'waiting-scope', args: { scope: null } });
        expect(readOverviewAction('waiting-scope', { scope: { kind: 'line', id: 'x', name: '' } })).toBeNull();
        expect(readOverviewAction('waiting-scope', { scope: { kind: 'person', ref: 'P0001' } })).toBeNull();
        expect(readOverviewAction('waiting-scope', {})).toBeNull();
    });
});
