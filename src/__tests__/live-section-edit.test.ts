/**
 * Customize panel (spec 044, 057): the rows each place shows (order, words,
 * notes), the state shown dashed while a section has no choice, a section
 * menu's head and the segment's arrow keys; moving a section (↑ ↓, the
 * menu, a drag) and the card "At the top".
 */
import { describe, it, expect } from 'vitest';
import {
    OVERVIEW_ORDER, SECTION_STATES, droppedOrder, movedNote, sectionDefaultNote, sectionEditRows, sectionMenuHead,
    sectionMoves, sectionStateLabel, sectionTitle, segmentArrowTarget, topEditRows,
} from '../ui/live-section-edit.js';
import { DEFAULT_ORDER, TOP_DEFAULTS } from '../ui/live-section-prefs.js';
import type { PrefKey, TopKey } from '../ui/live-section-prefs.js';
import type { SectionNow } from '../ui/live-section-edit.js';
import { strings } from '../strings.js';

const L = strings.live;
const expanded = (): SectionNow => ({ current: 'expanded', autoFolded: false });

describe('sectionEditRows', () => {
    it('panel: all six in the sections\' order, in one list; the two the overview alone has say so', () => {
        const rows = sectionEditRows('panel', {}, expanded);
        expect(rows.map(r => r.key)).toEqual([...DEFAULT_ORDER]);
        expect(rows[0].label).toBe(strings.research.atWork);
        expect(rows[0].note).toBe(`${L.sectionDefault} · ${L.inOverview(L.now)}`);
        expect(rows.find(r => r.key === 'directions')!.note).toBe(`${L.sectionDefault} · ${L.onlyInOverview}`);
        expect(rows[1].note).toBe(L.sectionDefault);
    });

    it('a stored order is the rows\' order in every place', () => {
        const order = ['queue', 'knows', 'working', 'changes', 'waiting', 'directions'] as const;
        for (const surface of ['panel', 'overview', 'settings'] as const) {
            expect(sectionEditRows(surface, {}, expanded, order).map(r => r.key)).toEqual([...order]);
        }
    });

    it('overview: its own order and words, no line, the panel name as the alias', () => {
        const rows = sectionEditRows('overview', {}, expanded);
        expect(rows.map(r => r.key)).toEqual([...OVERVIEW_ORDER]);
        expect(rows.map(r => r.label)).toEqual([L.now, strings.research.waiting, L.dirTitleEmpty, L.timeline, L.queueTitle, L.knowsTitle]);
        expect(rows[3].note).toBe(`${L.sectionDefault} · ${L.inPanel(strings.research.changes)}`);
    });

    it('a choice is checked and drops "default"; without one the state now is shown, folded to fit said', () => {
        const rows = sectionEditRows('panel', { waiting: 'hidden' }, (k) => k === 'queue'
            ? { current: 'collapsed', autoFolded: true }
            : expanded());
        const waiting = rows.find(r => r.key === 'waiting')!;
        expect(waiting.chosen).toBe('hidden');
        expect(waiting.current).toBeNull();
        expect(waiting.note).toBe('');
        const queue = rows.find(r => r.key === 'queue')!;
        expect(queue.chosen).toBeUndefined();
        expect(queue.current).toBe('collapsed');
        expect(queue.note).toBe(`${L.sectionDefault}, ${L.autoFoldedNote}`);
    });

    it('Settings: the panel words, no state shown (the default differs by place)', () => {
        let asked = 0;
        const rows = sectionEditRows('settings', { knows: 'collapsed' }, () => { asked++; return expanded(); });
        expect(asked).toBe(0);
        expect(rows.map(r => r.key)).toEqual([...DEFAULT_ORDER]);
        expect(rows.every(r => r.current === null)).toBe(true);
        expect(rows.find(r => r.key === 'knows')!.note).toBe(L.onlyInOverview);
        expect(rows.find(r => r.key === 'queue')!.note).toBe(L.sectionDefault);
    });
});

describe('section menu and labels', () => {
    it('head: the title, with the default note while there is no choice', () => {
        expect(sectionMenuHead('Queue', undefined, false)).toBe(`Queue · ${L.sectionDefault}`);
        expect(sectionMenuHead('Queue', undefined, true)).toBe(`Queue · ${L.sectionDefault}, ${L.autoFoldedNote}`);
        expect(sectionMenuHead('Queue', 'collapsed', true)).toBe('Queue');
        expect(sectionDefaultNote('expanded', true)).toBe('');
    });

    it('titles differ by place for the two sections named twice', () => {
        expect(sectionTitle('panel', 'changes')).toBe(strings.research.changes);
        expect(sectionTitle('overview', 'changes')).toBe(L.timeline);
        expect(sectionTitle('settings', 'working')).toBe(strings.research.atWork);
    });

    it('the three states in order, each with its word', () => {
        expect(SECTION_STATES).toEqual(['expanded', 'collapsed', 'hidden']);
        expect(SECTION_STATES.map(sectionStateLabel)).toEqual([L.sectionExpanded, L.sectionCollapsed, L.sectionHidden]);
    });
});

describe('segmentArrowTarget', () => {
    it('arrows move and wrap, Home and End go to the ends, other keys do nothing', () => {
        expect(segmentArrowTarget('ArrowRight', 0, 3)).toBe(1);
        expect(segmentArrowTarget('ArrowRight', 2, 3)).toBe(0);
        expect(segmentArrowTarget('ArrowLeft', 0, 3)).toBe(2);
        expect(segmentArrowTarget('ArrowDown', 1, 3)).toBe(2);
        expect(segmentArrowTarget('ArrowUp', 1, 3)).toBe(0);
        expect(segmentArrowTarget('Home', 2, 3)).toBe(0);
        expect(segmentArrowTarget('End', 0, 3)).toBe(2);
        expect(segmentArrowTarget('Enter', 0, 3)).toBeNull();
    });
});

describe('moving a section', () => {
    const order: readonly PrefKey[] = DEFAULT_ORDER;

    it('the menu offers only moves that stay inside this place\'s order', () => {
        // The panel skips Directions and What the research knows: Latest changes can go up past Directions.
        expect(sectionMoves(order, 'working', 'panel')).toEqual({ up: false, down: true });
        expect(sectionMoves(order, 'changes', 'panel')).toEqual({ up: true, down: true });
        expect(sectionMoves(order, 'queue', 'panel')).toEqual({ up: true, down: false });
        // The overview and Settings list all six.
        expect(sectionMoves(order, 'queue', 'overview')).toEqual({ up: true, down: true });
        expect(sectionMoves(order, 'knows', 'overview')).toEqual({ up: true, down: false });
        expect(sectionMoves(order, 'working', 'settings')).toEqual({ up: false, down: true });
        // A section the panel does not draw: no move from the panel.
        expect(sectionMoves(order, 'knows', 'panel')).toEqual({ up: false, down: false });
    });

    it('a drop puts the section at its place among the others; past the ends it stops there', () => {
        expect(droppedOrder(order, 'queue', 0)).toEqual(['queue', 'working', 'waiting', 'directions', 'changes', 'knows']);
        expect(droppedOrder(order, 'working', 5)).toEqual(['waiting', 'directions', 'changes', 'queue', 'knows', 'working']);
        expect(droppedOrder(order, 'working', 99)).toEqual(droppedOrder(order, 'working', 5));
        expect(droppedOrder(order, 'changes', -3)).toEqual(['changes', 'working', 'waiting', 'directions', 'queue', 'knows']);
        // Back where it was: the same order.
        expect(droppedOrder(order, 'directions', 2)).toEqual([...order]);
    });

    it('what a screen reader hears: the place\'s name, the new position of all six', () => {
        const moved: readonly PrefKey[] = ['waiting', 'working', 'directions', 'changes', 'queue', 'knows'];
        expect(movedNote('panel', moved, 'working')).toBe(L.movedSr(strings.research.atWork, 2, 6));
        expect(movedNote('overview', moved, 'working')).toBe(L.movedSr(L.now, 2, 6));
        expect(movedNote('settings', moved, 'knows')).toBe(L.movedSr(L.knowsTitle, 6, 6));
    });
});

describe('topEditRows', () => {
    const top = (over: Partial<Record<TopKey, boolean>> = {}): Record<TopKey, boolean> => ({ ...TOP_DEFAULTS, ...over });
    const row = (rows: ReturnType<typeof topEditRows>, key: string) => rows.find(r => r.key === key)!;

    it('the state always shown, both tiles on, the cost off with a word why', () => {
        const rows = topEditRows(top(), { phone: false, long: false });
        expect(rows.map(r => r.key)).toEqual(['state', 'day', 'month', 'followIn']);
        expect(row(rows, 'state')).toMatchObject({ locked: true, on: true, parts: [] });
        expect(row(rows, 'day').parts.map(p => [p.key, p.on, p.disabled])).toEqual([['day.persons', true, false], ['day.sources', true, false]]);
        expect(row(rows, 'month').parts.map(p => [p.key, p.on])).toEqual([['month.sessions', true], ['month.price', false]]);
        expect(row(rows, 'month').help).toBe(L.priceHelp);
        expect(topEditRows(top(), { phone: false, long: true })[2].help).toBe(L.priceHelpLong);
        expect(row(rows, 'followIn')).toMatchObject({ on: true, help: L.followInHelp, parts: [] });
    });

    it('a tile with both parts off is off, its parts greyed; the cost on drops the word', () => {
        const rows = topEditRows(top({ 'day.persons': false, 'day.sources': false, 'month.price': true }), { phone: false, long: false });
        expect(row(rows, 'day').on).toBe(false);
        expect(row(rows, 'day').parts.every(p => p.disabled)).toBe(true);
        expect(row(rows, 'month').help).toBe('');
        expect(row(rows, 'month').parts.map(p => p.on)).toEqual([true, true]);
    });

    it('on a phone this month cannot be switched there and says so', () => {
        const m = row(topEditRows(top(), { phone: true, long: false }), 'month');
        expect(m).toMatchObject({ disabled: true, on: true, help: L.monthPhoneNote });
        expect(m.parts.every(p => p.disabled)).toBe(true);
    });

    it('Follow in off is a row like any other', () => {
        expect(row(topEditRows(top({ followIn: false }), { phone: false, long: false }), 'followIn').on).toBe(false);
    });
});
