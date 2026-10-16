import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    changelogSection,
    changelogLanguageOf,
    decideReleaseNotes,
    parseInline,
    parseReleaseNotes,
    releaseNotesFor,
    releaseVersion,
    ReleaseNotesContext,
} from '../release-notes.js';

const CHANGELOG = `# Changelog

English · [Čeština](CHANGELOG.cs.md)

## 3.12.0

*This version is in preparation; the section grows with every test version.*

- **Strom archive**: the mode is called *Strom archive*.
- **Fixes**: one fix;
  continued on the next line.

## 3.11.0

- **Older**: an older point.
`;

describe('changelog section', () => {
    it('drops a pre-release or build suffix from the version', () => {
        expect(releaseVersion('3.12.0-beta.5')).toBe('3.12.0');
        expect(releaseVersion('3.12.0-rc.1')).toBe('3.12.0');
        expect(releaseVersion('3.12.0+build.7')).toBe('3.12.0');
        expect(releaseVersion('3.12.0')).toBe('3.12.0');
    });

    it('cuts the section of the version (a beta reads the section it prepares) up to the next one', () => {
        const section = changelogSection(CHANGELOG, '3.12.0-beta.5');
        expect(section).not.toBeNull();
        expect(section).toContain('**Strom archive**');
        expect(section).not.toContain('Older');
        expect(changelogSection(CHANGELOG, '3.11.0')).toBe('- **Older**: an older point.');
    });

    it('has no section for a version the changelog does not name, nor for a prefix of another', () => {
        expect(changelogSection(CHANGELOG, '3.13.0')).toBeNull();
        expect(changelogSection(CHANGELOG, '3.12.0'.slice(0, 4))).toBeNull();
        expect(changelogSection('## 3.12.10\n\n- x', '3.12.1')).toBeNull();
        expect(changelogSection('## 3.12.0\n\n## 3.11.0\n- y', '3.12.0')).toBeNull();
    });

    it('accepts Windows line ends and a date after the version', () => {
        expect(changelogSection('## 3.12.0 (2026-10-20)\r\n\r\n- a\r\n', '3.12.0')).toBe('- a');
    });

    it('every changelog file of the repository has the section of the version in package.json', () => {
        const version = JSON.parse(readFileSync('package.json', 'utf-8')).version as string;
        for (const file of ['CHANGELOG.md', 'CHANGELOG.cs.md', 'CHANGELOG.de.md']) {
            const section = changelogSection(readFileSync(file, 'utf-8'), version);
            expect(section, file).not.toBeNull();
            expect(parseReleaseNotes(section!).length, file).toBeGreaterThan(0);
        }
    });

    it('the language versions of the section have the same points', () => {
        const version = JSON.parse(readFileSync('package.json', 'utf-8')).version as string;
        const counts = ['CHANGELOG.md', 'CHANGELOG.cs.md', 'CHANGELOG.de.md'].map(file =>
            changelogSection(readFileSync(file, 'utf-8'), version)!.split('\n').filter(line => line.startsWith('- ')).length);
        expect(counts[1]).toBe(counts[0]);
        expect(counts[2]).toBe(counts[0]);
    });
});

describe('markdown subset', () => {
    it('reads **bold** and *italic*, the rest as plain text', () => {
        expect(parseInline('**Bold**: text with *italic* and more')).toEqual([
            { text: 'Bold', bold: true },
            { text: ': text with ' },
            { text: 'italic', italic: true },
            { text: ' and more' },
        ]);
    });

    it('keeps markup-like text literal (nothing becomes HTML)', () => {
        expect(parseInline('<img src=x onerror=alert(1)> & <b>bold</b>')).toEqual([
            { text: '<img src=x onerror=alert(1)> & <b>bold</b>' },
        ]);
        expect(parseInline('3 * 4 * 5')).toEqual([{ text: '3 * 4 * 5' }]);
        expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    });

    it('reads `code` as a run of its own, its content literal', () => {
        expect(parseInline('After `strom update` and **bold**')).toEqual([
            { text: 'After ' },
            { text: 'strom update', code: true },
            { text: ' and ' },
            { text: 'bold', bold: true },
        ]);
        expect(parseInline('`**not bold**` and `<b>x</b>`')).toEqual([
            { text: '**not bold**', code: true },
            { text: ' and ' },
            { text: '<b>x</b>', code: true },
        ]);
        // A lone backtick stays text.
        expect(parseInline('a ` b')).toEqual([{ text: 'a ` b' }]);
    });

    it('turns the section into bullet points, leaving out the italic "in preparation" note', () => {
        const blocks = parseReleaseNotes(changelogSection(CHANGELOG, '3.12.0')!);
        expect(blocks.map(b => b.kind)).toEqual(['item', 'item']);
        expect(blocks[0].inline[0]).toEqual({ text: 'Strom archive', bold: true });
        expect(blocks[0].inline).toContainEqual({ text: 'Strom archive', italic: true });
        // A continuation line belongs to its point.
        expect(blocks[1].inline.map(r => r.text).join('')).toBe('Fixes: one fix; continued on the next line.');
    });

    it('the Czech note line of the real changelog is not shown', () => {
        const blocks = parseReleaseNotes('*Tato verze se připravuje; oddíl se doplňuje s každou testovací verzí.*\n\n- **A**: b');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].kind).toBe('item');
    });

    it('keeps a paragraph that is not entirely italic', () => {
        const blocks = parseReleaseNotes('Some *text* here.\n\n- a');
        expect(blocks.map(b => b.kind)).toEqual(['para', 'item']);
    });
});

describe('language of the notes', () => {
    const embedded = {
        version: '3.12.0-beta.5',
        sections: { en: '- **A**: English', cs: '- **A**: česky', de: null },
    };

    it('reads the changelog of the UI language, any other one the English', () => {
        expect(changelogLanguageOf('cs')).toBe('cs');
        expect(changelogLanguageOf('de')).toBe('de');
        expect(changelogLanguageOf('en')).toBe('en');
        expect(changelogLanguageOf('sk')).toBe('en');
        expect(releaseNotesFor(embedded, 'cs')![0].inline[1].text).toBe(': česky');
        expect(releaseNotesFor(embedded, 'en')![0].inline[1].text).toBe(': English');
    });

    it('a language without the section falls back to English', () => {
        expect(releaseNotesFor(embedded, 'de')![0].inline[1].text).toBe(': English');
    });

    it('no notes at all: null', () => {
        expect(releaseNotesFor(null, 'en')).toBeNull();
        expect(releaseNotesFor({ version: '1.0.0', sections: { en: null } }, 'cs')).toBeNull();
        // Only the note line: nothing to show.
        expect(releaseNotesFor({ version: '1.0.0', sections: { en: '*In preparation.*' } }, 'en')).toBeNull();
    });
});

describe('when the dialog appears', () => {
    const base: ReleaseNotesContext = {
        seenVersion: '3.12.0-beta.4',
        currentVersion: '3.12.0-beta.5',
        hasData: true,
        enabled: true,
        busy: false,
        embedded: false,
        hasNotes: true,
    };

    it('a new version (a new beta too) with notes, the app free: show', () => {
        expect(decideReleaseNotes(base)).toBe('show');
        expect(decideReleaseNotes({ ...base, seenVersion: '3.11.0', currentVersion: '3.12.0' })).toBe('show');
    });

    it('the version already seen: nothing', () => {
        expect(decideReleaseNotes({ ...base, seenVersion: '3.12.0-beta.5' })).toBe('skip');
    });

    it('a first start of a new user (nothing stored, no trees): stored silently', () => {
        expect(decideReleaseNotes({ ...base, seenVersion: null, hasData: false })).toBe('mark-seen');
    });

    it('an existing user from a version before the dialog (nothing stored, but trees): show', () => {
        expect(decideReleaseNotes({ ...base, seenVersion: null, hasData: true })).toBe('show');
    });

    it('turned off, or no notes for this version: stored silently', () => {
        expect(decideReleaseNotes({ ...base, enabled: false })).toBe('mark-seen');
        expect(decideReleaseNotes({ ...base, hasNotes: false })).toBe('mark-seen');
    });

    it('something in the way: wait', () => {
        expect(decideReleaseNotes({ ...base, busy: true })).toBe('wait');
        expect(decideReleaseNotes({ ...base, seenVersion: null, busy: true })).toBe('wait');
    });

    it('an exported or embedded file: nothing, not even stored', () => {
        expect(decideReleaseNotes({ ...base, embedded: true })).toBe('skip');
        expect(decideReleaseNotes({ ...base, embedded: true, seenVersion: null, hasData: false })).toBe('skip');
    });

    it('existing data, nothing stored, turned off by a user setting: stored silently', () => {
        expect(decideReleaseNotes({ ...base, seenVersion: null, enabled: false })).toBe('mark-seen');
    });
});
