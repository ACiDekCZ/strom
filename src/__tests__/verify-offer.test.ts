/**
 * Which re-verification actions a fact offers (spec 065, table 10z), row by row.
 */
import { describe, it, expect } from 'vitest';
import { verifyOffer, personVerifyOffer, researchVerifies, researchConfirms, VerifyResearch } from '../verify-offer.js';

const FULL: VerifyResearch = { features: ['verify', 'verify.bulk', 'facts.confirm'] };
const CONFIRM_ONLY: VerifyResearch = { features: ['facts.confirm'] };
const OLD: VerifyResearch = { features: ['origin'] };

describe('table 10z', () => {
    it('row 1: confirmed — only "Take back" and who/when', () => {
        for (const research of [null, FULL, OLD]) {
            expect(verifyOffer({ step: 'human', research, cited: true, confirmedBy: 'app' }))
                .toEqual({ verify: false, scan: false, undo: true, row: 'confirmed' });
        }
        // The research's confirmation is taken back through it (facts.confirm).
        expect(verifyOffer({ step: 'human', research: FULL, cited: true, confirmedBy: 'research' }))
            .toEqual({ verify: false, scan: false, undo: true, row: 'confirmed' });
        expect(verifyOffer({ step: 'human', research: OLD, cited: true, confirmedBy: 'research' }))
            .toEqual({ verify: false, scan: false, undo: false, row: 'confirmed' });
        // The person's own edit (origin user) is no confirmation: nothing to take back.
        expect(verifyOffer({ step: 'human', research: FULL, cited: true }))
            .toEqual({ verify: false, scan: false, undo: false, row: null });
    });

    it('row 2: proven (●●, ●○) with the research — the scan only', () => {
        expect(verifyOffer({ step: 'proven', research: FULL, cited: true }))
            .toEqual({ verify: false, scan: true, undo: false, row: null });
    });

    it('row 3: probable / possible — Verify (cheap when cited, costlier without), scan, the reason it stays', () => {
        for (const step of ['probable', 'possible'] as const) {
            expect(verifyOffer({ step, research: FULL, cited: true }))
                .toEqual({ verify: true, cost: 'low', scan: true, undo: false, row: null });
            // Without a citation the scan stands only on the record the research read the value from.
            expect(verifyOffer({ step, research: FULL, cited: false, source: true }))
                .toEqual({ verify: true, cost: 'high', scan: true, undo: false, row: null });
            expect(verifyOffer({ step, research: FULL, cited: false }))
                .toEqual({ verify: true, cost: 'high', scan: false, undo: false, row: null });
            expect(verifyOffer({ step, research: FULL, cited: true, why: 'Two records disagree' }))
                .toEqual({ verify: true, cost: 'low', scan: true, undo: false, row: 'reason' });
        }
    });

    it('row 4: lead — Verify (costlier), scan, the reason if any', () => {
        expect(verifyOffer({ step: 'lead', research: FULL, cited: true }))
            .toEqual({ verify: true, cost: 'high', scan: true, undo: false, row: null });
        expect(verifyOffer({ step: 'lead', research: FULL, cited: false, source: true, why: 'No record found yet' }))
            .toEqual({ verify: true, cost: 'high', scan: true, undo: false, row: 'reason' });
        expect(verifyOffer({ step: 'lead', research: FULL, cited: false, why: 'No record found yet' }))
            .toEqual({ verify: true, cost: 'high', scan: false, undo: false, row: 'reason' });
    });

    it('row 5: from the family tree — Verify (cheap with its citation), the scan only when cited', () => {
        expect(verifyOffer({ step: 'import', research: FULL, cited: true }))
            .toEqual({ verify: true, cost: 'low', scan: true, undo: false, row: 'importCited' });
        expect(verifyOffer({ step: 'import', research: FULL, cited: false }))
            .toEqual({ verify: true, cost: 'high', scan: false, undo: false, row: 'importUncited' });
    });

    it('a fact without a source never offers "Confirm against the scan" (no scan to confirm against)', () => {
        for (const research of [FULL, CONFIRM_ONLY, null]) {
            for (const step of ['proven', 'probable', 'possible', 'lead', 'import', null] as const) {
                expect(verifyOffer({ step, research, cited: false }).scan).toBe(false);
                expect(verifyOffer({ step, research, cited: false, source: false }).scan).toBe(false);
            }
        }
        // The record the research read the value from is a source the scan confirms against.
        expect(verifyOffer({ step: 'probable', research: FULL, cited: false, source: true }).scan).toBe(true);
        expect(verifyOffer({ step: 'probable', research: null, cited: false, source: true }).scan).toBe(true);
    });

    it('row 6: no source — Verify (costlier), no scan', () => {
        expect(verifyOffer({ step: 'none', research: FULL, cited: false }))
            .toEqual({ verify: true, cost: 'high', scan: false, undo: false, row: null });
    });

    it('row 7: waiting — no Verify, the scan, the waiting row', () => {
        for (const pending of ['wait', 'asked', 'images', 'permission'] as const) {
            expect(verifyOffer({ step: 'probable', research: FULL, cited: true, pending }))
                .toEqual({ verify: false, scan: true, undo: false, row: 'pending' });
        }
    });

    it('row 7: one the research queued by itself further than next — "Verify first" (1109)', () => {
        expect(verifyOffer({ step: 'probable', research: FULL, cited: true, pending: 'wait', position: 3 }))
            .toEqual({ verify: false, scan: true, undo: false, prioritize: true, row: 'pending' });
        // Next already, the place not said, asked for by a person, or waiting for images or a decision: none.
        for (const position of [1, null, undefined]) {
            expect(verifyOffer({ step: 'probable', research: FULL, cited: true, pending: 'wait', position }).prioritize).toBeUndefined();
        }
        for (const pending of ['asked', 'images', 'permission'] as const) {
            expect(verifyOffer({ step: 'probable', research: FULL, cited: true, pending, position: 3 }).prioritize).toBeUndefined();
        }
        // A research that does not verify (no feature, an archive) does not move it either.
        expect(verifyOffer({ step: 'probable', research: CONFIRM_ONLY, cited: true, pending: 'wait', position: 3 }).prioritize).toBeUndefined();
        expect(verifyOffer({ step: 'probable', research: { ...FULL, treeState: 'archive' }, cited: true, pending: 'wait', position: 3 }).prioritize)
            .toBeUndefined();
    });

    it('row 8: a research without 065 — no Verify; the scan only with facts.confirm', () => {
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import'] as const) {
            expect(verifyOffer({ step, research: OLD, cited: true }))
                .toEqual({ verify: false, scan: false, undo: false, row: null });
            expect(verifyOffer({ step, research: CONFIRM_ONLY, cited: true }))
                .toEqual({ verify: false, scan: true, undo: false, row: null });
        }
    });

    it('row 9: no research — the scan when the fact cites a source, and the research row', () => {
        for (const step of ['proven', 'probable', 'possible', 'lead', 'import', 'none'] as const) {
            expect(verifyOffer({ step, research: null, cited: true }))
                .toEqual({ verify: false, scan: true, undo: false, row: 'noResearch' });
            expect(verifyOffer({ step, research: null, cited: false }))
                .toEqual({ verify: false, scan: false, undo: false, row: 'noResearch' });
        }
    });

    it('row 10: the person card — "Verify facts (N)" with the count, and the waiting ones', () => {
        const offers = [
            verifyOffer({ step: 'probable', research: FULL, cited: true }),
            verifyOffer({ step: 'proven', research: FULL, cited: true }),
            verifyOffer({ step: 'import', research: FULL, cited: false }),
            verifyOffer({ step: 'lead', research: FULL, cited: true, pending: 'wait' }),
        ];
        expect(personVerifyOffer(offers, 1, FULL)).toEqual({ verify: true, count: 2, pending: 1 });
        expect(personVerifyOffer([offers[1]], 0, FULL)).toEqual({ verify: false, count: 0, pending: 0 });
        expect(personVerifyOffer(offers, 1, OLD)).toEqual({ verify: false, count: 0, pending: 1 });
        expect(personVerifyOffer(offers, 0, null)).toEqual({ verify: false, count: 0, pending: 0 });
    });

    it('a fact with no mark: the scan with a source, no row', () => {
        expect(verifyOffer({ step: null, research: null, cited: true })).toEqual({ verify: false, scan: true, undo: false, row: null });
        expect(verifyOffer({ step: null, research: FULL, cited: true })).toEqual({ verify: false, scan: true, undo: false, row: null });
    });
});

describe('the state of the research tree', () => {
    it('an archive or a waiting tree does not verify, but still takes a confirmation', () => {
        for (const treeState of ['archive', 'waiting'] as const) {
            const research = { ...FULL, treeState };
            expect(researchVerifies(research)).toBe(false);
            expect(researchConfirms(research)).toBe(true);
            expect(verifyOffer({ step: 'probable', research, cited: true }))
                .toEqual({ verify: false, scan: true, undo: false, row: null });
        }
        expect(researchVerifies({ ...FULL, treeState: 'research' })).toBe(true);
    });
});
