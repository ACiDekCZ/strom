/**
 * The undo of a change is "Vrátit" in Czech (GitHub #4, round 7 §48): the
 * undo pill and a message carrying its button, the toolbar's tooltip, the
 * bottom sheet's row, the history entry and the delete confirmations' hint.
 * "↩ Zpět" stays the return to the previous view; en/de keep their words.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage, strings } from '../strings.js';

describe('undo label', () => {
    afterEach(() => setLanguage('en'));

    it('is "Vrátit" in Czech everywhere the undo of a change is named', () => {
        setLanguage('cs');
        expect(strings.undo.undo).toBe('Vrátit');
        expect(strings.actions.undoLabel('úprava osoby Jan')).toBe('Vrátit: úprava osoby Jan');
        expect(strings.auditLog.undoAction('úprava osoby Jan')).toBe('Vrátit: úprava osoby Jan');
        expect(strings.danger.undoHint).toBe('Smazání jde vrátit tlačítkem Vrátit.');
        // The return to the previous view keeps its "Zpět"
        expect(strings.focus.focusToastBack).toBe('↩ Zpět');
    });

    it('keeps "Undo" / "Rückgängig" apart from "Back" / "Zurück" in en and de', () => {
        setLanguage('en');
        expect(strings.undo.undo).toBe('Undo');
        expect(strings.actions.undoLabel('x')).toBe('Undo: x');
        expect(strings.danger.undoHint).toMatch(/Undo/);
        expect(strings.focus.focusToastBack).toMatch(/Back/);
        setLanguage('de');
        expect(strings.undo.undo).toBe('Rückgängig');
        expect(strings.actions.undoLabel('x')).toBe('Rückgängig: x');
        expect(strings.danger.undoHint).toMatch(/Rückgängig/);
        expect(strings.focus.focusToastBack).not.toMatch(/Rückgängig/);
    });
});
