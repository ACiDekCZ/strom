/**
 * How Strom works, a rule newer than what runs here: under its Since line a
 * note says the connected research's version (only when a research is
 * connected) and, as a safeguard, this app's; numbers only, a beta suffix left
 * out, versions compared part by part.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { helpVersionNotes } from '../ui/help-ui.js';
import { setLanguage } from '../strings.js';

afterEach(() => setLanguage('en'));

describe('help: the version notes of a rule', () => {
    it('a research older than the rule: its note; none connected: nothing', () => {
        setLanguage('en');
        expect(helpVersionNotes({ research: '1.27.0' }, '1.25.2', '3.23.0')).toEqual([
            'The research connected to this tree is version 1.25.2; this applies from 1.27.0.',
        ]);
        expect(helpVersionNotes({ research: '1.27.0' }, '', '3.23.0')).toEqual([]);
        expect(helpVersionNotes({ research: '1.27.0' }, '1.27.0', '3.23.0')).toEqual([]);
        expect(helpVersionNotes({ research: '1.9.0' }, '1.10.0', '3.23.0')).toEqual([]);
    });

    it('an app older than the rule: its note, after the research note; a beta suffix is not shown', () => {
        setLanguage('cs');
        expect(helpVersionNotes({ app: '3.24.0', research: '1.27.0' }, '1.20.0-beta.3', '3.23.0-beta.8')).toEqual([
            'Výzkum připojený k tomuto stromu má verzi 1.20.0, tohle platí od 1.27.0.',
            'Tahle aplikace má verzi 3.23.0, tohle platí od 3.24.0.',
        ]);
        expect(helpVersionNotes({ app: '3.23.0' }, '', '3.23.0-beta.8')).toEqual([]);
        expect(helpVersionNotes(undefined, '1.0.0', '1.0.0')).toEqual([]);
    });
});
