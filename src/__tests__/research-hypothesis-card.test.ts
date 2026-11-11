/**
 * The card of a research hypothesis decided in the app (spec 074, DEV §1–§6):
 * what each offer (pick, remote, readonly, merge, old) draws, the change mode,
 * the wait at a version or under the box, the notes of a version that changes
 * nothing drawn, and the texts of the decision before, "holds since" and the
 * agent's proposal. Invented data only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { hypothesisCardPlan } from '../research-hypothesis-card.js';
import { newPendingHypothesis } from '../research-hypothesis-wait.js';
import {
    researchHypothesisPreviousText, researchHypothesisHoldsSinceText, researchHypothesisProposalParts,
} from '../research-hypotheses.js';
import { setLanguage } from '../strings.js';
import type { ResearchHypothesis } from '../types.js';

const NOW = Date.UTC(2026, 10, 11, 10, 30);

function openHypo(extra: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
    return {
        id: 'H0007', title: 'Who is the father of Vlastimír?', status: 'open', pickable: true,
        variants: [
            { id: 'A', title: 'Dobroslav', links: [{ kind: 'child', a: 'I1', b: 'I2' }] as never },
            { id: 'B', title: 'Bolemír Zábrodský', links: [{ kind: 'child', a: 'I1', b: 'I3' }] as never },
            { id: 'C', title: 'Unknown', links: [] },
        ],
        ...extra,
    };
}

function decidedHypo(extra: Partial<ResearchHypothesis> = {}): ResearchHypothesis {
    return openHypo({ status: 'decided', chosen: 'B', decidedAt: '2026-10-02', decision: 'The register names him.', ...extra });
}

const ask = (h: ResearchHypothesis, what: 'decide' | 'abandon' | 'keep-open' | 'reopen', variant?: string) =>
    newPendingHypothesis(h, what, `strom-research://hypothesis?id=${h.id}&do=${what}`, 'head1', NOW, variant);

describe('hypothesisCardPlan: an open hypothesis', () => {
    it('offers Choose at every version, No version holds and Leave open, the research quiet below', () => {
        const plan = hypothesisCardPlan(openHypo(), 'pick', { linkable: true });
        expect(plan.extras).toBe(true);
        expect(plan.variants.map(v => v.pick)).toEqual(['on', 'on', 'on']);
        expect(plan.variants.map(v => v.tag)).toEqual([null, null, null]);
        expect(plan.variants.some(v => v.dim)).toBe(false);
        expect(plan.foot).toEqual({ none: 'on', leave: 'on', cancelChange: false });
        expect(plan.decided).toBeNull();
        expect(plan.link).toBe('faint');
        expect(plan.info).toBeNull();
    });

    it('notes a version that links nobody, or that the tree records already', () => {
        const h = openHypo();
        h.variants![2].inTree = [{ kind: 'child', a: 'I1', b: 'I4' }] as never;
        const plan = hypothesisCardPlan(h, 'pick');
        expect(plan.variants.map(v => v.note)).toEqual([null, null, 'inTree']);
        expect(hypothesisCardPlan(openHypo(), 'pick').variants[2].note).toBe('noLink');
        // A version joining people outside the file has no such note.
        const people = openHypo();
        people.variants![2].people = 3;
        expect(hypothesisCardPlan(people, 'pick').variants[2].note).toBeNull();
    });

    it('marks the agent\'s proposal at its version, or under the box for none', () => {
        const plan = hypothesisCardPlan(openHypo({ proposal: { variant: 'B', text: 'Two registers agree.' } }), 'pick');
        expect(plan.variants.map(v => v.proposal)).toEqual([false, true, false]);
        expect(plan.proposalNone).toBe(false);
        const none = hypothesisCardPlan(openHypo({ proposal: { variant: null } }), 'pick');
        expect(none.variants.some(v => v.proposal)).toBe(false);
        expect(none.proposalNone).toBe(true);
    });

    it('drops the proposal and Leave open once it was left open', () => {
        const plan = hypothesisCardPlan(openHypo({ proposal: { variant: 'B' }, leftOpen: '2026-11-01' }), 'pick');
        expect(plan.variants.some(v => v.proposal)).toBe(false);
        expect(plan.foot).toEqual({ none: 'on', leave: null, cancelChange: false });
    });

    it('waits at the version chosen: every choice off, no way into the research', () => {
        const h = openHypo();
        const plan = hypothesisCardPlan(h, 'pick', { pending: ask(h, 'decide', 'B'), linkable: true });
        expect(plan.variants.map(v => v.pick)).toEqual(['off', 'off', 'off']);
        expect(plan.variants.map(v => v.waiting)).toEqual([false, true, false]);
        expect(plan.footWait).toBe(false);
        expect(plan.foot).toEqual({ none: 'off', leave: 'off', cancelChange: false });
        expect(plan.link).toBeNull();
    });

    it('waits under the box for No version holds and Leave open', () => {
        const h = openHypo();
        for (const what of ['abandon', 'keep-open'] as const) {
            const plan = hypothesisCardPlan(h, 'pick', { pending: ask(h, what) });
            expect(plan.footWait).toBe(true);
            expect(plan.variants.some(v => v.waiting)).toBe(false);
        }
    });

    it('away from the research: readable with its marks, no choice, a line why', () => {
        const h = openHypo({ proposal: { variant: 'A' } });
        const plan = hypothesisCardPlan(h, 'remote', { pending: ask(h, 'decide', 'A'), linkable: true });
        expect(plan.extras).toBe(true);
        expect(plan.variants.map(v => v.pick)).toEqual([null, null, null]);
        expect(plan.variants[0].proposal).toBe(true);
        expect(plan.variants.some(v => v.waiting)).toBe(false);
        expect(plan.foot).toBeNull();
        expect(plan.link).toBeNull();
        expect(plan.info).toBe('remote');
    });

    it('read only: only read', () => {
        const plan = hypothesisCardPlan(openHypo(), 'readonly', { linkable: true });
        expect(plan.extras).toBe(true);
        expect(plan.variants.every(v => v.pick === null)).toBe(true);
        expect(plan.foot).toBeNull();
        expect(plan.decided).toBeNull();
        expect(plan.link).toBeNull();
        expect(plan.info).toBeNull();
    });

    it('merging and today\'s card: no new marks, the research the main action', () => {
        const merge = hypothesisCardPlan(openHypo({ proposal: { variant: 'A' } }), 'merge', { linkable: true });
        expect(merge.extras).toBe(false);
        expect(merge.variants.some(v => v.pick || v.proposal)).toBe(false);
        expect(merge.link).toBe('main');
        expect(merge.info).toBe('merge');
        const old = hypothesisCardPlan(openHypo(), 'old', { linkable: true });
        expect(old.extras).toBe(false);
        expect(old.link).toBe('main');
        expect(old.info).toBeNull();
        expect(hypothesisCardPlan(openHypo(), 'old', { linkable: false }).link).toBeNull();
    });
});

describe('hypothesisCardPlan: a decided hypothesis', () => {
    it('tags the chosen one, dims the others, offers Change and Reopen', () => {
        const plan = hypothesisCardPlan(decidedHypo(), 'pick', { linkable: true });
        expect(plan.variants.map(v => v.tag)).toEqual([null, 'chosen', null]);
        expect(plan.variants.map(v => v.dim)).toEqual([true, false, true]);
        expect(plan.variants.every(v => v.pick === null)).toBe(true);
        expect(plan.foot).toBeNull();
        expect(plan.decided).toEqual({ change: true, reopen: true, cannot: false, off: false });
        expect(plan.link).toBe('faint');
    });

    it('cannot be reopened: Change stays, Reopen goes, the reason is said', () => {
        const plan = hypothesisCardPlan(decidedHypo({ reopen: { ok: false, type: 'tree', count: 3 } }), 'pick');
        expect(plan.decided).toEqual({ change: true, reopen: false, cannot: true, off: false });
    });

    it('in the change mode: the other versions offered, the held one "holds now", its reason above', () => {
        const plan = hypothesisCardPlan(decidedHypo(), 'pick', { changing: true, linkable: true });
        expect(plan.variants.map(v => v.pick)).toEqual(['on', 'off', 'on']);
        expect(plan.variants.map(v => v.tag)).toEqual([null, 'holds', null]);
        expect(plan.holdsSince).toBe(true);
        expect(plan.changeHint).toBe(true);
        expect(plan.foot).toEqual({ none: 'on', leave: null, cancelChange: true });
        expect(plan.decided).toBeNull();
        expect(plan.link).toBeNull();
    });

    it('decided in the research, its version not loaded yet ("Later"): every choice switched off, no way into the research', () => {
        const open = hypothesisCardPlan(openHypo(), 'pick', { held: true, linkable: true });
        expect(open.variants.map(v => v.pick)).toEqual(['off', 'off', 'off']);
        expect(open.variants.some(v => v.waiting)).toBe(false);
        expect(open.foot).toEqual({ none: 'off', leave: 'off', cancelChange: false });
        expect(open.link).toBeNull();
        const decided = hypothesisCardPlan(decidedHypo(), 'pick', { held: true, linkable: true });
        expect(decided.decided).toEqual({ change: true, reopen: true, cannot: false, off: true });
        expect(decided.link).toBeNull();
        // Only the card that chooses holds back: a card read away from the research stays as it is.
        expect(hypothesisCardPlan(openHypo(), 'remote', { held: true }).variants.map(v => v.pick)).toEqual([null, null, null]);
    });

    it('a version whose choice leaves the old link says so', () => {
        const h = decidedHypo({ reopen: { ok: false, type: 'work', count: 2, stays: ['A'] } });
        const plan = hypothesisCardPlan(h, 'pick', { changing: true });
        // C links nobody, but changing to it takes B's link out of the tree: no "the tree does not change".
        expect(plan.variants.map(v => v.note)).toEqual(['stays', null, null]);
    });

    it('a version that links nobody says the tree does not change only when its choice keeps the tree', () => {
        // Open: choosing C changes nothing.
        expect(hypothesisCardPlan(openHypo(), 'pick').variants.map(v => v.note)).toEqual([null, null, 'noLink']);
        // Decided for B (linked), changing: C would take B's link out.
        expect(hypothesisCardPlan(decidedHypo(), 'pick', { changing: true }).variants[2].note).toBeNull();
        // Decided for C (links nobody), changing to D (links nobody either): the tree stays.
        const h = decidedHypo({ chosen: 'C', variants: [...openHypo().variants!, { id: 'D', title: 'Someone else', links: [] }] });
        expect(hypothesisCardPlan(h, 'pick', { changing: true }).variants.map(v => v.note)).toEqual([null, null, null, 'noLink']);
    });

    it('a change asked keeps the change mode while it waits, without Cancel', () => {
        const h = decidedHypo();
        const plan = hypothesisCardPlan(h, 'pick', { pending: ask(h, 'decide', 'A') });
        expect(plan.variants.map(v => v.pick)).toEqual(['off', 'off', 'off']);
        expect(plan.variants.map(v => v.waiting)).toEqual([true, false, false]);
        expect(plan.foot).toEqual({ none: 'off', leave: null, cancelChange: false });
        expect(plan.changeHint).toBe(false);
        expect(plan.link).toBeNull();
    });

    it('a reopening asked waits under the box, without Change and Reopen', () => {
        const h = decidedHypo();
        const plan = hypothesisCardPlan(h, 'pick', { pending: ask(h, 'reopen') });
        expect(plan.footWait).toBe(true);
        expect(plan.decided).toBeNull();
        expect(plan.foot).toBeNull();
        expect(plan.variants.every(v => v.pick === null)).toBe(true);
    });

    it('read only: no change mode even when asked', () => {
        const plan = hypothesisCardPlan(decidedHypo(), 'readonly', { changing: true });
        expect(plan.variants.every(v => v.pick === null)).toBe(true);
        expect(plan.variants.map(v => v.tag)).toEqual([null, 'chosen', null]);
        expect(plan.decided).toBeNull();
        expect(plan.holdsSince).toBe(false);
    });
});

describe('hypothesisCardPlan: an abandoned hypothesis', () => {
    it('every version dimmed, Change offers the versions without No version holds', () => {
        const h = openHypo({ status: 'abandoned', decidedAt: '2026-10-05' });
        const plan = hypothesisCardPlan(h, 'pick');
        expect(plan.variants.every(v => v.dim)).toBe(true);
        expect(plan.decided).toEqual({ change: true, reopen: true, cannot: false, off: false });
        const changing = hypothesisCardPlan(h, 'pick', { changing: true });
        expect(changing.variants.map(v => v.pick)).toEqual(['on', 'on', 'on']);
        expect(changing.foot).toEqual({ none: null, leave: null, cancelChange: true });
        expect(changing.holdsSince).toBe(false);
    });
});

describe('the card\'s texts', () => {
    afterEach(() => setLanguage('en'));

    it('the decision before, with its day and reason', () => {
        setLanguage('en');
        expect(researchHypothesisPreviousText(decidedHypo())).toBe('');
        expect(researchHypothesisPreviousText(decidedHypo({ previous: { variant: 'A', day: '2026-09-01', reason: 'An older reading.' } })))
            .toMatch(/^before: A, .*2026 · An older reading\.$/);
        expect(researchHypothesisPreviousText(decidedHypo({ previous: { variant: null } }))).toBe('before: no version held');
        setLanguage('cs');
        expect(researchHypothesisPreviousText(decidedHypo({ previous: { variant: 'A' } }))).toBe('dřív: A');
    });

    it('holds since: only a decided one with its day', () => {
        setLanguage('en');
        expect(researchHypothesisHoldsSinceText(decidedHypo())).toMatch(/^Holds since .*2026: B · The register names him\.$/);
        expect(researchHypothesisHoldsSinceText(decidedHypo({ decidedAt: undefined }))).toBe('');
        expect(researchHypothesisHoldsSinceText(openHypo())).toBe('');
    });

    it('the proposal: its label in bold, then the sentence and the day', () => {
        setLanguage('en');
        expect(researchHypothesisProposalParts(openHypo())).toBeNull();
        expect(researchHypothesisProposalParts(openHypo({ proposal: { variant: 'B', text: 'Two registers agree.' } })))
            .toEqual({ label: 'proposed by the agent:', text: 'Two registers agree.' });
        expect(researchHypothesisProposalParts(openHypo({ proposal: { variant: null, text: 'Nothing fits.' } })))
            .toEqual({ label: 'proposed by the agent:', text: 'no version holds · Nothing fits.' });
        setLanguage('cs');
        expect(researchHypothesisProposalParts(openHypo({ proposal: { variant: null } })))
            .toEqual({ label: 'navrhuje agent:', text: 'žádná verze neplatí' });
    });
});
