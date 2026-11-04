/**
 * Customize panel (spec 044): the rows each place shows (order, words,
 * notes, the line before the overview's own sections), the state shown
 * dashed while a section has no choice, a section menu's head and the
 * segment's arrow keys.
 */
import { describe, it, expect } from 'vitest';
import {
    OVERVIEW_ORDER, SECTION_STATES, sectionDefaultNote, sectionEditRows, sectionMenuHead, sectionStateLabel,
    sectionTitle, segmentArrowTarget,
} from '../ui/live-section-edit.js';
import { PREF_KEYS } from '../ui/live-section-prefs.js';
import type { SectionNow } from '../ui/live-section-edit.js';
import { strings } from '../strings.js';

const L = strings.live;
const expanded = (): SectionNow => ({ current: 'expanded', autoFolded: false });

describe('sectionEditRows', () => {
    it('panel: its four sections, a line, then the two the overview alone has', () => {
        const rows = sectionEditRows('panel', {}, expanded);
        expect(rows.map(r => r.key)).toEqual([...PREF_KEYS]);
        expect(rows.map(r => r.sep)).toEqual([false, false, false, false, true, false]);
        expect(rows[0].label).toBe(strings.research.atWork);
        expect(rows[0].note).toBe(`${L.sectionDefault} · ${L.inOverview(L.now)}`);
        expect(rows[4].note).toBe(`${L.sectionDefault} · ${L.onlyInOverview}`);
        expect(rows[1].note).toBe(L.sectionDefault);
    });

    it('overview: its own order and words, no line, the panel name as the alias', () => {
        const rows = sectionEditRows('overview', {}, expanded);
        expect(rows.map(r => r.key)).toEqual([...OVERVIEW_ORDER]);
        expect(rows.some(r => r.sep)).toBe(false);
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

    it('Settings: the panel words, no line, no state shown (the default differs by place)', () => {
        let asked = 0;
        const rows = sectionEditRows('settings', { knows: 'collapsed' }, () => { asked++; return expanded(); });
        expect(asked).toBe(0);
        expect(rows.map(r => r.key)).toEqual([...PREF_KEYS]);
        expect(rows.every(r => r.current === null && !r.sep)).toBe(true);
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
