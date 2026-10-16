/**
 * About: "What's new" opens the changelog on GitHub in the UI language, at the
 * section of the running version; a beta build reads the beta branch, every
 * other build reads main (released versions only).
 */
import { describe, it, expect } from 'vitest';
import { aboutChangelogLink, changelogAnchor, changelogIsBeta } from '../about-links.js';
import type { Language } from '../strings.js';

const BASE = 'https://github.com/ACiDekCZ/strom/blob';

describe('About: the changelog anchor', () => {
    it('is the version without dots and without a pre-release suffix', () => {
        expect(changelogAnchor('3.12.0')).toBe('3120');
        expect(changelogAnchor('3.12.0-beta.5')).toBe('3120');
        expect(changelogAnchor('3.11.0')).toBe('3110');
        expect(changelogAnchor('3.10.1')).toBe('3101');
    });
});

describe("About: the What's new link", () => {
    const cases: Array<[Language, boolean, string, string]> = [
        ['en', false, '3.12.0', `${BASE}/main/CHANGELOG.md#3120`],
        ['cs', false, '3.12.0', `${BASE}/main/CHANGELOG.cs.md#3120`],
        ['de', false, '3.12.0', `${BASE}/main/CHANGELOG.de.md#3120`],
        ['en', true, '3.12.0-beta.5', `${BASE}/beta/CHANGELOG.md#3120`],
        ['cs', true, '3.12.0-beta.5', `${BASE}/beta/CHANGELOG.cs.md#3120`],
        ['de', true, '3.12.0-beta.5', `${BASE}/beta/CHANGELOG.de.md#3120`],
        ['cs', false, '3.11.0', `${BASE}/main/CHANGELOG.cs.md#3110`],
        ['de', true, '3.12.0', `${BASE}/beta/CHANGELOG.de.md#3120`],
    ];
    for (const [lang, beta, version, href] of cases) {
        it(`${lang}, ${beta ? 'beta' : 'main'}, ${version} → ${href}`, () => {
            expect(aboutChangelogLink(lang, version, beta).href).toBe(href);
        });
    }

    it('falls back to the English file for a language without its own', () => {
        expect(aboutChangelogLink('fr' as Language, '3.12.0', false).href).toBe(`${BASE}/main/CHANGELOG.md#3120`);
    });

    it('has its label in every language and opens in a new tab with noopener', () => {
        expect(aboutChangelogLink('en', '3.12.0', false).label).toBe("What's new ↗");
        expect(aboutChangelogLink('cs', '3.12.0', false).label).toBe('Co je nového ↗');
        expect(aboutChangelogLink('de', '3.12.0', false).label).toBe('Was ist neu ↗');
        const link = aboutChangelogLink('en', '3.12.0', true);
        expect(link.target).toBe('_blank');
        expect(link.rel).toMatch(/\bnoopener\b/);
        expect(link.rel).toMatch(/\bnoreferrer\b/);
        // The label is the same in a beta build: production never mentions the beta.
        expect(link.label).toBe("What's new ↗");
    });
});

describe('About: which branch the changelog link reads', () => {
    it('reads beta on the beta site and main on the public site, whatever the version', () => {
        expect(changelogIsBeta('beta.stromapp.info', '3.12.0-beta.5')).toBe(true);
        expect(changelogIsBeta('beta.stromapp.info', '3.12.0')).toBe(true);
        expect(changelogIsBeta('stromapp.info', '3.12.0')).toBe(false);
        expect(changelogIsBeta('stromapp.info', '3.12.0-beta.5')).toBe(false);
    });

    it('goes by the version elsewhere (dev server, exported or embedded file)', () => {
        expect(changelogIsBeta('localhost', '3.12.0-beta.5')).toBe(true);
        expect(changelogIsBeta('', '3.12.0-beta.5')).toBe(true);
        expect(changelogIsBeta('localhost', '3.12.0')).toBe(false);
        expect(changelogIsBeta('', '3.11.0')).toBe(false);
    });
});
