/**
 * "House history" in Research for this tree (spec 030 §6, K6.1): the estimate
 * while off (the price only once measured), the question before switching on
 * and the summary while on, from `/status.houses`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../strings.js';
import { sanitizeLiveHouses } from '../research-link.js';
import { houseUsd, houseWorkDuration, housesAutoConfirmOn, housesAutoEstimate, housesAutoSummary } from '../ui/houses-auto-view.js';

const COUNTS = { done: 2, running: 1, queued: 4, waiting: 0, held: 0 };
const measured = sanitizeLiveHouses({
    on: false, rev: 'r1', counts: COUNTS, auto: { houses: 7, towns: 3 },
    estimate: { houses: 7, towns: 3, minutes: 270, usd: 11.2, measured: true, perHouse: { minutes: 30, usd: 1.2 }, perTown: { minutes: 20, usd: 0.9 } },
})!;
const unmeasured = sanitizeLiveHouses({
    on: false, rev: 'r1', counts: COUNTS, auto: { houses: 1, towns: 1 },
    estimate: { houses: 1, towns: 1, minutes: 50, usd: 3, measured: false, perHouse: { minutes: 30 }, perTown: { minutes: 20 } },
})!;

afterEach(() => setLanguage('en'));

describe('House history setting texts', () => {
    it('says the estimate with the price once measured (cs)', () => {
        setLanguage('cs');
        expect(housesAutoEstimate(measured)).toBe('Úkol dostane 7 domů ve 3 obcích · asi 5\u00a0h práce agenta (≈\u00a011\u00a0USD) · čerpá předplatné AI');
        expect(housesAutoConfirmOn(measured)).toBe(
            'Úkol dostane 7 domů ve 3 obcích, asi 5\u00a0h práce agenta (≈\u00a011\u00a0USD). Čerpá předplatné AI. Další domy přibudou samy, až splní práh.');
    });

    it('says the time alone before the price is measured', () => {
        setLanguage('cs');
        expect(housesAutoEstimate(unmeasured)).toBe('Úkol dostane 1 dům v 1 obci · asi 50\u00a0min práce agenta · čerpá předplatné AI');
        setLanguage('en');
        expect(housesAutoEstimate(unmeasured)).toBe('The task covers 1 house in 1 town · about 50\u00a0min of agent work · uses the AI subscription');
        setLanguage('de');
        expect(housesAutoEstimate(measured)).toBe('Der Auftrag umfasst 7 Häuser in 3 Orten · etwa 5\u00a0Std. Arbeit des Agenten (≈\u00a011\u00a0USD) · verbraucht das KI-Abo');
    });

    it('keeps the price and the time whole on a line break (no space to break inside them)', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            const text = housesAutoEstimate(measured)!;
            expect(text).toMatch(/\(≈\u00a011\u00a0USD\)/);
            expect(text).toMatch(/5\u00a0(h|Std\.)/);
            expect(housesAutoConfirmOn(measured)).toMatch(/\(≈\u00a011\u00a0USD\)/);
        }
    });

    it('says nothing when the tree gives no house (no auto, or zero)', () => {
        expect(housesAutoEstimate(sanitizeLiveHouses({ on: false, rev: 'r1', counts: COUNTS }))).toBeNull();
        expect(housesAutoEstimate({ ...measured, auto: { houses: 0, towns: 0 } })).toBeNull();
        setLanguage('cs');
        expect(housesAutoConfirmOn(null)).toBe('Čerpá předplatné AI. Domy přibudou samy, až splní práh.');
    });

    it('sums up the tasks while on', () => {
        setLanguage('cs');
        expect(housesAutoSummary(COUNTS)).toBe('Zapnuto · 7 domů: 2 hotovo, 1 zkoumá se, 4 ve frontě');
        expect(housesAutoSummary({ ...COUNTS, waiting: 1 })).toBe('Zapnuto · 8 domů: 2 hotovo, 1 zkoumá se, 5 ve frontě');
        setLanguage('pl');
        expect(housesAutoSummary(COUNTS)).toBe('Włączone · 7 domów: 2 gotowe, 1 w badaniu, 4 w kolejce');
    });

    it('rounds the work and the price', () => {
        setLanguage('en');
        expect(houseWorkDuration(3)).toBe('5\u00a0min');
        expect(houseWorkDuration(87)).toBe('90\u00a0min');
        expect(houseWorkDuration(90)).toBe('2\u00a0h');
        expect(houseUsd(0.94)).toBe('0.9');
        expect(houseUsd(11.2)).toBe('11');
        expect(houseUsd(undefined)).toBeNull();
        setLanguage('cs');
        expect(houseUsd(2.45)).toBe('2,5');
    });
});
