/**
 * Research hypotheses in "What waits" and the overview (spec 074, DEV §9,
 * §10): the research's hypothesis item read (V13), the row each hypothesis
 * gets (a proposal with Accept and Leave open, two or three versions to
 * choose, a sentence, nothing), the boxes of accepting proposals at once,
 * the picked ones up to 50, the large links in the foot, and the wait of a
 * list asked at once with what became of it. Invented data only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeWaiting, MAX_HYPOTHESES_ACCEPT } from '../research-link.js';
import { waitingSection, waitingActions } from '../research-waiting.js';
import {
    acceptBatch, acceptBatchRowResult, acceptBatchWaitingCount, acceptBigJoins, acceptSelection, acceptSelectionFull,
    clearAcceptBatch, clearAcceptSelection, finishAcceptBatch, hypothesisAcceptAsk, hypothesisAcceptBox, hypothesisOpenProposal,
    inWaitingAcceptBatch, noteAcceptOutcome, pruneAcceptSelection, selectAllAccept, startAcceptBatch, stopAcceptBatch,
    toggleAcceptSelection, waitingHypothesisPlan,
} from '../research-hypothesis-waiting.js';
import { newPendingHypothesis } from '../research-hypothesis-wait.js';
import { hypothesisCardPlan } from '../research-hypothesis-card.js';
import type { ResearchHypothesis } from '../types.js';

const NOW = Date.UTC(2026, 10, 11, 10, 30);
const RID = 'r-kvitkovice';

function hypo(extra: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
    return {
        id: 'H0022', title: 'Whose son is Kvido Mlynařík?', status: 'open', pickable: true,
        variants: [
            { id: 'A', title: 'Son of Vítězslav Mlynařík', links: [{ kind: 'child', a: 'I1', b: 'I2' }] as never },
            { id: 'B', title: 'Son of Zbyhněv Mlynařík', links: [{ kind: 'child', a: 'I1', b: 'I3' }] as never, people: 3 },
        ],
        ...extra,
    };
}

const item = (extra: Record<string, unknown> = {}) => ({
    id: 'H0022', what: 'Whose son is Kvido Mlynařík?', on: 'user', at: '2026-11-10T09:00:00Z', kind: 'hypothesis',
    section: 'decide', group: { key: 'hypotheses', name: 'Hypotheses', kind: 'other' }, person: 'P12', actions: [], ...extra,
});

afterEach(() => {
    clearAcceptSelection();
    clearAcceptBatch();
});

describe('the research\'s hypothesis item (V13)', () => {
    it('is read with its proposal and pick under Decide, with no task actions', () => {
        const [w] = sanitizeWaiting([item({ proposal: 'B', pick: true })], true);
        expect(w).toMatchObject({ id: 'H0022', kind: 'hypothesis', proposal: 'B', pick: true, person: 'P12' });
        expect(waitingSection(w)).toBe('decide');
        expect(waitingActions(w, { writes: { sent: true, note: true, answer: true } as never, links: true, phone: false })).toBeNull();
    });

    it('keeps "none" as a proposal and drops anything else', () => {
        expect(sanitizeWaiting([item({ proposal: 'none' })], true)[0].proposal).toBe('none');
        const [w] = sanitizeWaiting([item({ proposal: 'b; rm', pick: 'yes' })], true);
        expect(w.proposal).toBeUndefined();
        expect(w.pick).toBeUndefined();
    });

    it('without a valid hypothesis id, or from a research without groups, is no hypothesis', () => {
        expect(sanitizeWaiting([item({ id: 'X0022' })], true)[0].kind).not.toBe('hypothesis');
        expect(sanitizeWaiting([item()], false)[0].kind).not.toBe('hypothesis');
    });
});

describe('hypothesisOpenProposal', () => {
    it('takes the tree\'s proposal, else the item\'s for a version the tree knows', () => {
        expect(hypothesisOpenProposal(hypo({ proposal: { variant: 'B', text: 'The marriage record names both parents.' } }))).toBe('B');
        expect(hypothesisOpenProposal(hypo({ proposal: { variant: null } }))).toBeNull();
        expect(hypothesisOpenProposal(hypo(), { proposal: 'A' })).toBe('A');
        expect(hypothesisOpenProposal(hypo(), { proposal: 'none' })).toBeNull();
        expect(hypothesisOpenProposal(hypo(), { proposal: 'Q' })).toBeUndefined();
    });

    it('has none once decided or left open', () => {
        expect(hypothesisOpenProposal(hypo({ status: 'decided', chosen: 'B', proposal: { variant: 'B' } }))).toBeUndefined();
        expect(hypothesisOpenProposal(hypo({ leftOpen: '2026-11-01', proposal: { variant: 'B' } }))).toBeUndefined();
        expect(hypothesisOpenProposal(undefined, { proposal: 'B' })).toBeUndefined();
    });
});

describe('waitingHypothesisPlan', () => {
    it('with a proposal: the strip, Accept and Leave open, More', () => {
        const plan = waitingHypothesisPlan({ proposal: 'B' }, hypo(), 'pick');
        expect(plan).toMatchObject({ kind: 'proposal', proposal: 'B', accept: 'on', leave: 'on', text: null, rowWait: false, more: true, big: 0 });
    });

    it('a proposal joining more than 50 people gets the large link\'s pill', () => {
        const h = hypo({ proposal: { variant: 'A' } });
        h.variants![0].people = 214;
        expect(waitingHypothesisPlan({}, h, 'pick').big).toBe(214);
    });

    it('"no version holds" proposed: Accept asks to abandon', () => {
        const plan = waitingHypothesisPlan({ proposal: 'none' }, hypo(), 'pick');
        expect(plan.proposal).toBeNull();
        expect(hypothesisAcceptAsk(plan.proposal!)).toEqual({ do: 'abandon' });
        expect(hypothesisAcceptAsk('B')).toEqual({ do: 'decide', variant: 'B' });
    });

    it('a wait switches the buttons off and shows under them; a decision not loaded too, without the wait', () => {
        const h = hypo();
        const pending = newPendingHypothesis(h, 'decide', 'strom-research://hypothesis?id=H0022&do=decide&variant=B', 'head1', NOW, 'B');
        expect(waitingHypothesisPlan({ proposal: 'B' }, h, 'pick', { pending })).toMatchObject({ accept: 'off', leave: 'off', rowWait: true });
        expect(waitingHypothesisPlan({ proposal: 'B' }, h, 'pick', { held: true })).toMatchObject({ accept: 'off', leave: 'off', rowWait: false });
    });

    it('away from the research: the strip and the sentence, no buttons; merging: its sentence', () => {
        expect(waitingHypothesisPlan({ proposal: 'B' }, hypo(), 'remote')).toMatchObject({ kind: 'proposal', accept: null, leave: null, text: 'remote' });
        expect(waitingHypothesisPlan({}, hypo({ pickable: undefined }), 'merge')).toMatchObject({ kind: 'text', text: 'merge', more: true });
    });

    it('without a proposal and with two or three versions: each with Choose, the wait at the one chosen', () => {
        const h = hypo();
        expect(waitingHypothesisPlan({}, h, 'pick').versions.map(v => [v.id, v.pick])).toEqual([['A', 'on'], ['B', 'on']]);
        const pending = newPendingHypothesis(h, 'decide', 'u', 'head1', NOW, 'A');
        const waiting = waitingHypothesisPlan({}, h, 'pick', { pending });
        expect(waiting.versions.map(v => [v.pick, v.waiting])).toEqual([['off', true], ['off', false]]);
        expect(waiting.rowWait).toBe(false);
        // Asked from the card (Leave open): the wait under the row.
        expect(waitingHypothesisPlan({}, h, 'pick', { pending: newPendingHypothesis(h, 'keep-open', 'u', 'head1', NOW) }).rowWait).toBe(true);
    });

    it('more versions: a sentence and More; today\'s card or not in the tree: nothing', () => {
        const h = hypo({ variants: ['A', 'B', 'C', 'D'].map(id => ({ id, title: id, links: [{ kind: 'child', a: 'I1', b: `I${id}` }] as never })) });
        expect(waitingHypothesisPlan({}, h, 'pick')).toMatchObject({ kind: 'text', text: 'versions', more: true });
        expect(waitingHypothesisPlan({}, hypo(), 'old')).toMatchObject({ kind: 'plain', more: true });
        expect(waitingHypothesisPlan({ proposal: 'B' }, undefined, 'old')).toMatchObject({ kind: 'plain', more: false });
        expect(waitingHypothesisPlan({}, hypo({ status: 'decided', chosen: 'A' }), 'pick')).toMatchObject({ kind: 'plain', more: false });
    });

    it('a hypothesis without a link (K1.6): its choices say the tree stays, once for the row or at each such version', () => {
        const noLink = hypo({
            title: 'Where did Kvido Mlynařík come from?',
            variants: [{ id: 'A', title: 'From Kvítkovice', links: [] }, { id: 'B', title: 'From Zálesí', links: [] }],
        });
        const versions = waitingHypothesisPlan({}, noLink, 'pick');
        expect(versions).toMatchObject({ kind: 'versions', keepsTree: true });
        expect(versions.versions.map(v => [v.id, v.pick, v.keepsTree])).toEqual([['A', 'on', true], ['B', 'on', true]]);
        expect(waitingHypothesisPlan({ proposal: 'B' }, noLink, 'pick')).toMatchObject({ kind: 'proposal', accept: 'on', keepsTree: true });
        // Linked versions promise their links: no such sentence.
        expect(waitingHypothesisPlan({}, hypo(), 'pick').keepsTree).toBe(false);
        expect(waitingHypothesisPlan({ proposal: 'B' }, hypo(), 'pick').keepsTree).toBe(false);
        // Mixed: only the version without a link says it.
        const mixed = hypo({ variants: [hypo().variants![0], { id: 'B', title: 'From Zálesí', links: [] }] });
        const plan = waitingHypothesisPlan({}, mixed, 'pick');
        expect(plan.keepsTree).toBe(false);
        expect(plan.versions.map(v => v.keepsTree)).toEqual([false, true]);
        // Nothing to choose here: nothing said.
        expect(waitingHypothesisPlan({ proposal: 'B' }, noLink, 'remote').keepsTree).toBe(false);
    });
});

describe('accepting proposals at once (P2)', () => {
    it('a box for a proposal decided here, a switched-off one where only the research decides, none without a proposal', () => {
        const h = hypo({ proposal: { variant: 'B' } });
        expect(hypothesisAcceptBox(h, 'pick')).toBe('on');
        expect(hypothesisAcceptBox(h, 'merge')).toBe('only-research');
        expect(hypothesisAcceptBox(h, 'old')).toBe('only-research');
        expect(hypothesisAcceptBox(hypo(), 'pick')).toBe('none');
        expect(hypothesisAcceptBox(hypo(), 'pick', { proposal: 'A' })).toBe('on');
    });

    it('picks up to 50, select all stops there, the rest cannot be picked', () => {
        const ids = Array.from({ length: 60 }, (_, i) => `H${String(i + 1).padStart(4, '0')}`);
        selectAllAccept(RID, ids);
        expect(acceptSelection(RID).size).toBe(MAX_HYPOTHESES_ACCEPT);
        expect(acceptSelectionFull(RID)).toBe(true);
        expect(toggleAcceptSelection(RID, 'H0055', true)).toBe(false);
        expect(acceptSelection(RID).has('H0055')).toBe(false);
        expect(toggleAcceptSelection(RID, 'H0001', false)).toBe(true);
        expect(toggleAcceptSelection(RID, 'H0055', true)).toBe(true);
        expect(acceptSelectionFull(RID)).toBe(true);
    });

    it('one choice per research, its case aside; ones that cannot be picked any more go', () => {
        toggleAcceptSelection(RID, 'H0022', true);
        toggleAcceptSelection(RID, 'H0031', true);
        expect([...acceptSelection(RID.toUpperCase())]).toEqual(['H0022', 'H0031']);
        expect(acceptSelection('another').size).toBe(0);
        pruneAcceptSelection(RID, new Set(['H0031']));
        expect([...acceptSelection(RID)]).toEqual(['H0031']);
    });

    it('the foot names each large link among the picked ones', () => {
        const big = hypo({ id: 'H0052', proposal: { variant: 'A' } });
        big.variants![0].people = 214;
        const small = hypo({ proposal: { variant: 'B' } });
        expect(acceptBigJoins([{ id: 'H0022', h: small }, { id: 'H0052', h: big }])).toEqual([{ id: 'H0052', variant: 'A', people: 214 }]);
    });
});

describe('the wait of a list asked at once', () => {
    it('waits while one waits, then says how many of them were accepted', () => {
        const b = startAcceptBatch(RID, ['H0022', 'H0052', 'H0058'], 'strom-research://hypotheses?do=accept&ids=H0022,H0052,H0058', NOW);
        const waiting = new Set(['H0022', 'H0052', 'H0058']);
        expect(inWaitingAcceptBatch(RID, 'H0052')).toBe(true);
        expect(inWaitingAcceptBatch(RID, 'H0099')).toBe(false);
        expect(acceptBatchWaitingCount(b, id => waiting.has(id))).toBe(3);
        expect(noteAcceptOutcome(RID, 'H0022', { kind: 'asked', variant: 'B' })).toBe(true);
        expect(noteAcceptOutcome(RID, 'H0099', { kind: 'asked', variant: 'B' })).toBe(false);
        noteAcceptOutcome(RID, 'H0052', { kind: 'asked', variant: 'A' });
        waiting.delete('H0022');
        waiting.delete('H0052');
        expect(finishAcceptBatch(RID, id => waiting.has(id))).toBeNull();
        noteAcceptOutcome(RID, 'H0058', { kind: 'elsewhere', status: 'decided', variant: 'B', by: 'agent' });
        waiting.delete('H0058');
        expect(finishAcceptBatch(RID, id => waiting.has(id))).toEqual({ accepted: 2, of: 3 });
        // Told once.
        expect(finishAcceptBatch(RID, () => false)).toBeNull();
        expect(acceptBatchRowResult(acceptBatch(RID), 'H0022')).toBe('accepted');
        expect(acceptBatchRowResult(acceptBatch(RID), 'H0058')).toBe('elsewhere');
        expect(acceptBatchRowResult(acceptBatch(RID), 'H0099')).toBeNull();
        expect(inWaitingAcceptBatch(RID, 'H0022')).toBe(false);
    });

    it('Stop waiting ends it without its notice; a new list replaces the old one', () => {
        startAcceptBatch(RID, ['H0022'], 'u1', NOW);
        stopAcceptBatch(RID);
        expect(finishAcceptBatch(RID, () => false)).toBeNull();
        expect(acceptBatchRowResult(acceptBatch(RID), 'H0022')).toBeNull();
        startAcceptBatch(RID, ['H0031'], 'u2', NOW + 1000);
        expect(acceptBatch(RID)?.ids).toEqual(['H0031']);
        expect(acceptBatch(RID)?.done).toBe(false);
    });
});

describe('the card after "Later"', () => {
    it('switches its choices off until the version loads', () => {
        const plan = hypothesisCardPlan(hypo(), 'pick', { held: true, linkable: true });
        expect(plan.variants.map(v => v.pick)).toEqual(['off', 'off']);
        expect(plan.foot?.none).toBe('off');
    });
});
