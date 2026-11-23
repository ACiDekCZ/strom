/**
 * The name offered for a copy of a tree (134 S-N4): a second Duplicate does
 * not offer the name of the first copy again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '../strings.js';
import { freeCopyName, treeNameTaken } from '../tree-copy-name.js';

describe('freeCopyName', () => {
    afterEach(() => setLanguage('en'));

    it('offers "(copy)", then "(copy 2)", "(copy 3)" while a tree of that name exists', () => {
        setLanguage('en');
        expect(freeCopyName('Jilmovi', ['Jilmovi'])).toBe('Jilmovi (copy)');
        expect(freeCopyName('Jilmovi', ['Jilmovi', 'Jilmovi (copy)'])).toBe('Jilmovi (copy 2)');
        expect(freeCopyName('Jilmovi', ['Jilmovi', 'Jilmovi (copy)', 'jilmovi (COPY 2) '])).toBe('Jilmovi (copy 3)');
        // A gap is taken first.
        expect(freeCopyName('Jilmovi', ['Jilmovi', 'Jilmovi (copy)', 'Jilmovi (copy 3)'])).toBe('Jilmovi (copy 2)');
    });

    it('in the UI language', () => {
        setLanguage('cs');
        expect(freeCopyName('Ostružník', ['Ostružník', 'Ostružník (kopie)'])).toBe('Ostružník (kopie 2)');
        setLanguage('de');
        expect(freeCopyName('Ostružník', ['Ostružník', 'Ostružník (Kopie)'])).toBe('Ostružník (Kopie 2)');
        setLanguage('pl');
        expect(freeCopyName('Ostružník', ['Ostružník', 'Ostružník (kopia)'])).toBe('Ostružník (kopia 2)');
    });
});

describe('treeNameTaken', () => {
    it('compares trimmed names regardless of case; an empty name is never taken', () => {
        expect(treeNameTaken(' jilmovi ', ['Jilmovi'])).toBe(true);
        expect(treeNameTaken('Jilmovi 2', ['Jilmovi'])).toBe(false);
        expect(treeNameTaken('  ', ['', ' '])).toBe(false);
    });
});
