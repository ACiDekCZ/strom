/**
 * Spec 074 DEV §4, §5: what a hypothesis asked from the app turns into once
 * the research has confirmed it — the long wait's timer, the card's line of a
 * decision made otherwise or put off, the notice, the Load dialog's rows and
 * the history's lines decided in the Strom app.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { setLanguage, type Language } from '../strings.js';
import type { ResearchHypothesis } from '../types.js';
import {
    HYPOTHESIS_WAIT_LONG_MS, clearHypothesisCardNotes, clearPendingHypotheses, hypothesisCardNote, hypothesisNoteOf, hypothesisStateKey,
    newPendingHypothesis, nextPendingHypothesisLongAt, onPendingHypothesisChange, setHypothesisCardNote, setPendingHypothesis, touchPendingHypotheses,
} from '../research-hypothesis-wait.js';
import {
    researchHypothesisChangeText, researchHypothesisLoadRows, researchHypothesisLogLine, researchHypothesisNoteText, researchHypothesisOutcomeToast,
} from '../research-hypotheses.js';

const RID = 'R-TEST';
const T0 = Date.UTC(2026, 10, 11, 9, 30);

function hypo(over: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
    return {
        id: 'H0041', title: 'Rodiče Hostivíta Ořechovského', status: 'open',
        variants: [
            { id: 'A', title: 'Rodiče ze Zálesí', links: [] },
            { id: 'B', title: 'Rodiče ze Strání', links: [] },
        ],
        ...over,
    } as ResearchHypothesis;
}

const lang = (l: Language): void => { setLanguage(l); };

describe('the long wait\'s timer and the notes (spec 074 DEV §4)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
    afterEach(() => { clearPendingHypotheses(); clearHypothesisCardNotes(); vi.useRealTimers(); });

    it('the next wait turns long ten minutes after it was asked; none without a wait or once long', () => {
        expect(nextPendingHypothesisLongAt(T0)).toBeNull();
        setPendingHypothesis(RID, 'H0041', newPendingHypothesis(hypo(), 'decide', 'strom-research://x', 'a1', T0, 'B'));
        setPendingHypothesis(RID, 'H0042', newPendingHypothesis(hypo({ id: 'H0042' }), 'abandon', 'strom-research://y', 'a1', T0 + 60_000));
        expect(nextPendingHypothesisLongAt(T0)).toBe(T0 + HYPOTHESIS_WAIT_LONG_MS);
        expect(nextPendingHypothesisLongAt(T0 + HYPOTHESIS_WAIT_LONG_MS)).toBe(T0 + 60_000 + HYPOTHESIS_WAIT_LONG_MS);
        expect(nextPendingHypothesisLongAt(T0 + 60_000 + HYPOTHESIS_WAIT_LONG_MS)).toBeNull();
        clearPendingHypotheses();
        expect(nextPendingHypothesisLongAt(T0)).toBeNull();
    });

    it('touching the waits tells every listener (the card and the bubble draw again)', () => {
        const told: string[] = [];
        onPendingHypothesisChange((rid, id) => told.push(`${rid}|${id}`));
        touchPendingHypotheses();
        expect(told).toContain('|');
    });

    it('a note is kept by research and hypothesis, dropped by kind', () => {
        setHypothesisCardNote(RID, 'H0041', { kind: 'later', status: 'decided', variant: 'B', by: 'app' });
        setHypothesisCardNote(RID, 'H0042', { kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent', state: 'x' });
        expect(hypothesisCardNote('r-test', 'H0041')?.kind).toBe('later');
        clearHypothesisCardNotes(RID, 'later');
        expect(hypothesisCardNote(RID, 'H0041')).toBeNull();
        expect(hypothesisCardNote(RID, 'H0042')?.kind).toBe('elsewhere');
        clearHypothesisCardNotes(RID);
        expect(hypothesisCardNote(RID, 'H0042')).toBeNull();
    });

    it('an outcome leaves a note: decided otherwise (with the state it holds), or any decision put off', () => {
        const other = hypo({ status: 'decided', chosen: 'A', decidedBy: 'agent', decidedAt: '2026-11-11' });
        expect(hypothesisNoteOf({ kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent' }, other, false))
            .toEqual({ kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent', state: hypothesisStateKey(other) });
        const asked = hypo({ status: 'decided', chosen: 'B', decidedBy: 'app' });
        expect(hypothesisNoteOf({ kind: 'asked', variant: 'B' }, asked, false)).toBeNull();
        expect(hypothesisNoteOf({ kind: 'asked', variant: 'B' }, asked, true)).toEqual({ kind: 'later', status: 'decided', variant: 'B', by: 'app' });
        expect(hypothesisNoteOf({ kind: 'waiting' }, asked, true)).toBeNull();
        expect(hypothesisNoteOf({ kind: 'gone' }, undefined, true)).toBeNull();
    });
});

describe('the words of a decision confirmed (spec 074 DEV §4, §5)', () => {
    afterEach(() => lang('en'));

    it('the notice: decided for a version, no version holds, open again; nothing for left open or elsewhere', () => {
        lang('en');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'asked', variant: 'B' })).toBe('Hypothesis H0041 decided: B');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'asked', variant: null })).toBe('Hypothesis H0041 decided: no version holds');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'reopened' })).toBe('Hypothesis H0041 is open again');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'left-open' })).toBe('');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent' })).toBe('');
        lang('cs');
        expect(researchHypothesisOutcomeToast('H0041', { kind: 'asked', variant: 'B' })).toBe('Hypotéza H0041 rozhodnuta: B');
    });

    it('the card\'s line names the version (or no version holds) and who decided', () => {
        lang('cs');
        expect(researchHypothesisNoteText({ kind: 'later', status: 'decided', variant: 'B', by: 'app' }))
            .toBe('Ve výzkumu už rozhodnuto: B (rozhodl člověk v aplikaci)');
        expect(researchHypothesisNoteText({ kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent', state: '' }))
            .toBe('Ve výzkumu už rozhodnuto: A (rozhodl agent)');
        expect(researchHypothesisNoteText({ kind: 'elsewhere', status: 'abandoned', variant: null, by: 'person', state: '' }))
            .toBe('Ve výzkumu už rozhodnuto: žádná verze neplatí');
        lang('de');
        expect(researchHypothesisNoteText({ kind: 'later', status: 'decided', variant: 'B', by: 'app' }))
            .toBe('In der Forschung bereits entschieden: B (in der App entschieden)');
    });

    it('a change of a hypothesis as one row: decided, changed, no version holds, reopened, left open; nothing unchanged', () => {
        lang('cs');
        const open = hypo();
        const decidedB = hypo({ status: 'decided', chosen: 'B', decidedBy: 'app' });
        expect(researchHypothesisChangeText(open, decidedB)).toBe('H0041 rozhodnuto pro B');
        expect(researchHypothesisChangeText(hypo({ status: 'decided', chosen: 'A' }), decidedB)).toBe('H0041 změněno na B');
        expect(researchHypothesisChangeText(open, hypo({ status: 'abandoned' }))).toBe('H0041: žádná verze neplatí');
        expect(researchHypothesisChangeText(decidedB, open)).toBe('H0041 vráceno na otevřenou');
        expect(researchHypothesisChangeText(open, hypo({ leftOpen: '2026-11-11' }))).toBe('H0041 nechána otevřená');
        expect(researchHypothesisChangeText(decidedB, { ...decidedB })).toBe('');
        lang('en');
        expect(researchHypothesisChangeText(open, decidedB)).toBe('H0041 decided for B');
    });

    it('the Load dialog lists the hypotheses decided in the app or asked from this page, never the agent\'s', () => {
        lang('cs');
        const here = new Map([
            ['H0041', hypo()],
            ['H0042', hypo({ id: 'H0042' })],
            ['H0043', hypo({ id: 'H0043' })],
        ]);
        const there = new Map([
            ['H0041', hypo({ status: 'decided', chosen: 'B', decidedBy: 'app' })],
            ['H0042', hypo({ id: 'H0042', status: 'decided', chosen: 'A', decidedBy: 'agent' })],
            ['H0043', hypo({ id: 'H0043', status: 'abandoned' })],
        ]);
        const rows = researchHypothesisLoadRows(here, there, new Set(['H0043']), id => id === 'H0041' ? 'Hostivít Ořechovský' : 'Matěj Cvrkal');
        expect(rows).toEqual([
            { id: 'H0041', personName: 'Hostivít Ořechovský', text: 'H0041 rozhodnuto pro B', inApp: true },
            { id: 'H0043', personName: 'Matěj Cvrkal', text: 'H0043: žádná verze neplatí', inApp: true },
        ]);
        // Nothing changed: no rows.
        expect(researchHypothesisLoadRows(there, there, new Set(['H0041']), () => '')).toEqual([]);
    });

    it('the history\'s lines decided in the Strom app are known by their `what`, others are not', () => {
        lang('cs');
        expect(researchHypothesisLogLine('H0022 decided for B in the Strom app')).toEqual({ id: 'H0022', text: 'H0022 rozhodnuto pro B' });
        expect(researchHypothesisLogLine('H0022 decided again for C in the Strom app')).toEqual({ id: 'H0022', text: 'H0022 změněno na C' });
        expect(researchHypothesisLogLine('H0022 abandoned in the Strom app')).toEqual({ id: 'H0022', text: 'H0022: žádná verze neplatí' });
        expect(researchHypothesisLogLine('H0022 reopened in the Strom app')).toEqual({ id: 'H0022', text: 'H0022 vráceno na otevřenou' });
        expect(researchHypothesisLogLine('H0031 left open in the Strom app')).toEqual({ id: 'H0031', text: 'H0031 nechána otevřená' });
        expect(researchHypothesisLogLine('H0022 decided for B')).toBeNull();
        expect(researchHypothesisLogLine('+P0012 Hostivít Ořechovský')).toBeNull();
        expect(researchHypothesisLogLine('S0004: transcript confirmed by the user in the Strom app')).toBeNull();
        lang('pl');
        expect(researchHypothesisLogLine('H0022 decided for B in the Strom app')?.text).toBe('H0022 rozstrzygnięta na B');
    });
});
