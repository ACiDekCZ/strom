/**
 * A toast's Undo working in the toast (waiting buttons §4, 4d): the words of its end. The working look and
 * its timing are covered in the browser (e2e live-overview, "Sent at an item").
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { workFailedText, undoInToast } = await import('../ui/toast.js');
const S = await import('../strings.js');
const { setLanguage } = S;

beforeEach(() => setLanguage('en'));

describe('workFailedText', () => {
    it('joins the prefix and the reason as one sentence', () => {
        expect(workFailedText(S.strings.busy.notUndone, 'The research did not answer within 30 s.'))
            .toBe('Not undone: the research did not answer within 30 s.');
    });
    it('keeps a capital that is not the first word of a sentence (a name, Strom)', () => {
        expect(workFailedText(S.strings.busy.notUndone, 'Strom Research is not running.')).toBe('Not undone: Strom Research is not running.');
    });
    it('in Czech too', () => {
        setLanguage('cs');
        expect(workFailedText(S.strings.busy.notUndone, 'Výzkum neodpověděl do 30 s.')).toBe('Nevráceno: výzkum neodpověděl do 30 s.');
    });
});

describe('undoInToast', () => {
    it('done: "Undone." (or its own words)', async () => {
        expect(await undoInToast(async () => true)).toEqual({ ok: true, text: 'Undone.' });
        expect(await undoInToast(async () => true, 'Back in To do')).toEqual({ ok: true, text: 'Back in To do' });
    });
    it('refused with a sentence: that sentence whole, Try again unless final', async () => {
        expect(await undoInToast(async said => { said('The research is busy.'); return false; }))
            .toEqual({ ok: false, text: 'The research is busy.', whole: true });
        expect(await undoInToast(async said => { said('Undo failed, the change stays.', true); return false; }))
            .toEqual({ ok: false, text: 'Undo failed, the change stays.', whole: true, retry: false });
    });
    it('not done without a word: the generic failure', async () => {
        expect(await undoInToast(async () => false)).toEqual({ ok: false, text: S.strings.busy.failed });
    });
});
