/**
 * The window texts (spec 079 §Texty): counts are declined in Czech and Polish,
 * and the window titles name the view, the tree and the app.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../../strings.js';

describe('window texts', () => {
    it('"other windows" is declined by the count', () => {
        const cs = getStringsForLang('cs').win;
        expect([1, 2, 5].map(n => cs.otherWindows(n))).toEqual([
            expect.stringContaining('další okno'), expect.stringContaining('další okna'), expect.stringContaining('dalších oken'),
        ]);
        const pl = getStringsForLang('pl').win;
        expect([1, 2, 5].map(n => pl.otherWindows(n))).toEqual([
            expect.stringContaining('inne okno'), expect.stringContaining('inne okna'), expect.stringContaining('innych okien'),
        ]);
        expect(getStringsForLang('en').win.otherWindows(1)).toMatch(/\bwindow$/);
        expect(getStringsForLang('en').win.otherWindows(2)).toMatch(/\bwindows$/);
        expect(getStringsForLang('de').win.otherWindows(1)).toBe('1 weiteres Fenster');
        expect(getStringsForLang('de').win.otherWindows(3)).toBe('3 weitere Fenster');
    });

    it('titles: view – tree – app, and the main window tree – app', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            const w = getStringsForLang(lang).win;
            expect(w.windowTitle('Tabulka', 'Hrachovcovi', 'Strom')).toBe('Tabulka – Hrachovcovi – Strom');
            expect(w.windowTitle('Tabulka', '', 'Strom Beta')).toBe('Tabulka – Strom Beta');
            expect(w.mainTitle('Hrachovcovi', 'Strom')).toBe('Hrachovcovi – Strom');
            expect(w.mainTitle('', 'Strom')).toBe('Strom');
        }
    });
});
