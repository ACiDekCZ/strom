import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings';

/** The Places previews' "can be undone" note names the undo toast's real button in every language (1101). */
describe('places undo note', () => {
    for (const lang of ['en', 'cs', 'de'] as const) {
        it(lang, () => {
            const s = getStringsForLang(lang);
            const note = s.map.undoableUndo(s.undo.undo);
            expect(note).toContain(s.undo.undo);
        });
    }
    it('Czech says Vrátit, as the button does', () => {
        expect(getStringsForLang('cs').map.undoableUndo(getStringsForLang('cs').undo.undo)).toBe('Lze vrátit: Vrátit.');
    });
});
