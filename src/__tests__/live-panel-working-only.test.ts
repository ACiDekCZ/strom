import { describe, expect, it } from 'vitest';
import { livePanelDrawnSections, livePanelNothingAtWork, livePanelWorkingOnly } from '../ui/live-panel-working-only.js';
import { strings, setLanguage } from '../strings.js';

/**
 * The small research panel beside the overview's own window (spec 079 U9):
 * on a computer the head and "Working" only; phones, tablets, an ended
 * following and no window: all sections as before.
 */
describe('live panel beside the overview window', () => {
    it('keeps "Working" alone only with the overview in a window, at a computer width, while following', () => {
        expect(livePanelWorkingOnly({ overviewInWindow: true, desktop: true, ended: false })).toBe(true);
        expect(livePanelWorkingOnly({ overviewInWindow: false, desktop: true, ended: false })).toBe(false);
        // Tablet and phone widths: unchanged.
        expect(livePanelWorkingOnly({ overviewInWindow: true, desktop: false, ended: false })).toBe(false);
        // An ended following: unchanged.
        expect(livePanelWorkingOnly({ overviewInWindow: true, desktop: true, ended: true })).toBe(false);
    });

    it('draws "Working" alone whatever the order, else every section in the user\'s order', () => {
        expect(livePanelDrawnSections(['queue', 'changes', 'waiting', 'working'], true)).toEqual(['working']);
        // An order without "Working": still "Working" alone.
        expect(livePanelDrawnSections(['waiting', 'changes'], true)).toEqual(['working']);
        expect(livePanelDrawnSections(['queue', 'changes', 'waiting', 'working'], false)).toEqual(['queue', 'changes', 'waiting', 'working']);
    });

    it('says nothing is being worked on when nobody works', () => {
        expect(livePanelNothingAtWork([])).toBe(true);
        expect(livePanelNothingAtWork([{ who: 'agent' }])).toBe(false);
    });

    it('has the line in four languages, none addressing the user', () => {
        const want = { en: 'Nothing is being worked on now', cs: 'Teď se nepracuje', de: 'Gerade wird nicht gearbeitet', pl: 'Teraz nie trwa żadna praca' } as const;
        for (const [lang, text] of Object.entries(want)) {
            setLanguage(lang as never);
            expect(strings.live.nothingAtWork).toBe(text);
            expect(text).not.toMatch(/\b(you|your|vy|váš|Sie|Ihr|du)\b/i);
        }
        setLanguage('en' as never);
    });
});
