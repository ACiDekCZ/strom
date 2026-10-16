import { describe, it, expect } from 'vitest';
import {
    decideResearchWhatsNew,
    researchChangelogUrl,
    researchNotesBlocks,
    sanitizeResearchWhatsNew,
    MAX_RESEARCH_POINTS,
    MAX_RESEARCH_POINT_LENGTH,
    ResearchWhatsNewContext,
} from '../research-whats-new.js';
import { compareAppVersions } from '../app-version.js';

const URL_OK = 'https://github.com/ACiDekCZ/strom-research/blob/beta/CHANGELOG.cs.md#1150';

describe('the bridge\'s /whats-new answer', () => {
    it('takes a well-formed answer', () => {
        expect(sanitizeResearchWhatsNew({
            version: '1.15.0-beta.6', lang: 'cs', url: URL_OK, points: ['**A.** b', 'c `strom update`'],
        })).toEqual({ version: '1.15.0-beta.6', lang: 'cs', url: URL_OK, points: ['**A.** b', 'c `strom update`'] });
    });

    it('turns down nonsense', () => {
        for (const bad of [null, 'x', 42, [], {}, { version: '1.15.0' }, { version: 'abc', points: [] },
            { version: '1.15.0', points: 'a' }, { version: '1.15.0<script>', points: [] }]) {
            expect(sanitizeResearchWhatsNew(bad)).toBeNull();
        }
    });

    it('reads another language as English', () => {
        expect(sanitizeResearchWhatsNew({ version: '1.15.0', lang: 'fr', points: [] })?.lang).toBe('en');
        expect(sanitizeResearchWhatsNew({ version: '1.15.0', points: [] })?.lang).toBe('en');
        expect(sanitizeResearchWhatsNew({ version: '1.15.0', lang: 'de', points: [] })?.lang).toBe('de');
    });

    it('keeps a link only into the research\'s repository on GitHub', () => {
        expect(researchChangelogUrl(URL_OK)).toBe(URL_OK);
        for (const bad of ['https://github.com/ACiDekCZ/strom/blob/main/CHANGELOG.md', 'http://github.com/ACiDekCZ/strom-research/x',
            'javascript:alert(1)', 'https://github.com/ACiDekCZ/strom-research.evil.com/', 'https://evil.com/https://github.com/ACiDekCZ/strom-research/',
            42, null, `${URL_OK}${'x'.repeat(600)}`]) {
            expect(researchChangelogUrl(bad)).toBeNull();
        }
        expect(sanitizeResearchWhatsNew({ version: '1.15.0', url: 'https://evil.com/', points: ['a'] })?.url).toBeNull();
    });

    it('takes at most 20 points of text, each cut to 1000 characters, empty ones left out', () => {
        const many = Array.from({ length: 30 }, (_, i) => `point ${i}`);
        const answer = sanitizeResearchWhatsNew({ version: '1.15.0', points: ['', '  ', 7, { a: 1 }, 'x'.repeat(1500), ...many] })!;
        expect(answer.points).toHaveLength(MAX_RESEARCH_POINTS);
        expect(answer.points[0]).toHaveLength(MAX_RESEARCH_POINT_LENGTH);
        expect(answer.points[1]).toBe('point 0');
    });

    it('turns the points into bullet blocks, markup as literal text', () => {
        const blocks = researchNotesBlocks(['**New**: `strom update`', '<img src=x onerror=alert(1)> <b>b</b>']);
        expect(blocks.map(b => b.kind)).toEqual(['item', 'item']);
        expect(blocks[0].inline).toEqual([{ text: 'New', bold: true }, { text: ': ' }, { text: 'strom update', code: true }]);
        expect(blocks[1].inline).toEqual([{ text: '<img src=x onerror=alert(1)> <b>b</b>' }]);
    });
});

describe('when to ask the research', () => {
    const ctx = (over: Partial<ResearchWhatsNewContext>): ResearchWhatsNewContext => ({
        seenVersion: '1.14.0', bridgeVersion: '1.15.0-beta.6', hasFeature: true, enabled: true, ...over,
    });

    it('a newer version with the feature: ask', () => {
        expect(decideResearchWhatsNew(ctx({}))).toBe('ask');
        expect(decideResearchWhatsNew(ctx({ seenVersion: '1.15.0-beta.5' }))).toBe('ask');
    });

    it('the first link here: only remember', () => {
        expect(decideResearchWhatsNew(ctx({ seenVersion: null }))).toBe('remember');
        expect(decideResearchWhatsNew(ctx({ seenVersion: 'garbage' }))).toBe('remember');
    });

    it('the same version: nothing', () => {
        expect(decideResearchWhatsNew(ctx({ seenVersion: '1.15.0-beta.6' }))).toBe('skip');
    });

    it('an older version (back from a beta to a release): only remember', () => {
        expect(decideResearchWhatsNew(ctx({ seenVersion: '1.15.0-beta.6', bridgeVersion: '1.14.0' }))).toBe('remember');
        expect(decideResearchWhatsNew(ctx({ seenVersion: '1.15.0', bridgeVersion: '1.15.0-beta.6' }))).toBe('remember');
    });

    it('an older bridge without the feature or the setting off: only remember', () => {
        expect(decideResearchWhatsNew(ctx({ hasFeature: false }))).toBe('remember');
        expect(decideResearchWhatsNew(ctx({ enabled: false }))).toBe('remember');
    });

    it('no usable version from the bridge: nothing', () => {
        expect(decideResearchWhatsNew(ctx({ bridgeVersion: '' }))).toBe('skip');
        expect(decideResearchWhatsNew(ctx({ bridgeVersion: '1.15' }))).toBe('skip');
    });

    it('versions compare by semver, a pre-release below its release', () => {
        expect(compareAppVersions('1.15.0-beta.6', '1.15.0')).toBeLessThan(0);
        expect(compareAppVersions('1.15.0-beta.10', '1.15.0-beta.9')).toBeGreaterThan(0);
        expect(compareAppVersions('1.15.0-rc.1', '1.15.0-beta.9')).toBeGreaterThan(0);
        expect(compareAppVersions('1.15.0', '1.14.9')).toBeGreaterThan(0);
    });
});
