import { describe, it, expect } from 'vitest';
import {
    hasUnsavedChanges, shouldNoticeUnsaved, shouldShowUnsavedIndicator, unsavedTrees, storageAdvice, isIosDevice, browserFamily,
    FILE_COPY_NOTICE_MIN_PERSONS, FILE_COPY_REMIND_MS,
} from '../file-copy.js';

const T0 = Date.parse('2026-09-20T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('hasUnsavedChanges', () => {
    it('is true only for edits newer than the last file copy', () => {
        expect(hasUnsavedChanges({})).toBe(false);
        expect(hasUnsavedChanges({ fileCopyAt: iso(T0) })).toBe(false);
        expect(hasUnsavedChanges({ changedAt: iso(T0) })).toBe(true);
        expect(hasUnsavedChanges({ changedAt: iso(T0), fileCopyAt: iso(T0 + 1) })).toBe(false);
        expect(hasUnsavedChanges({ changedAt: iso(T0 + 1), fileCopyAt: iso(T0) })).toBe(true);
    });
});

describe('shouldNoticeUnsaved', () => {
    const base = {
        state: 'best-effort' as const,
        info: { changedAt: iso(T0 + 1000), fileCopyAt: iso(T0) },
        personCount: FILE_COPY_NOTICE_MIN_PERSONS,
        viewMode: false,
        enabled: true,
        now: T0 + 2000,
    };

    it('notices the first unsaved change when the browser may clear the data', () => {
        expect(shouldNoticeUnsaved(base)).toBe(true);
        expect(shouldNoticeUnsaved({ ...base, state: 'unsupported' })).toBe(true);
    });

    it('stays quiet for persistent storage, small trees, shared copies, the setting off, saved work', () => {
        expect(shouldNoticeUnsaved({ ...base, state: 'persistent' })).toBe(false);
        expect(shouldNoticeUnsaved({ ...base, personCount: FILE_COPY_NOTICE_MIN_PERSONS - 1 })).toBe(false);
        expect(shouldNoticeUnsaved({ ...base, viewMode: true })).toBe(false);
        expect(shouldNoticeUnsaved({ ...base, enabled: false })).toBe(false);
        expect(shouldNoticeUnsaved({ ...base, info: { changedAt: iso(T0), fileCopyAt: iso(T0 + 1) } })).toBe(false);
    });

    it('once per stretch of unsaved work: again after a newer file copy', () => {
        const noticed = { ...base.info, fileCopyNoticeAt: iso(T0 + 1500) };
        expect(shouldNoticeUnsaved({ ...base, info: noticed })).toBe(false);
        // Exported after the notice, then edited again: a new stretch.
        const again = { changedAt: iso(T0 + 4000), fileCopyAt: iso(T0 + 3000), fileCopyNoticeAt: iso(T0 + 1500) };
        expect(shouldNoticeUnsaved({ ...base, info: again, now: T0 + 5000 })).toBe(true);
    });

    it('reminds once more when the work stayed unsaved for a week', () => {
        const noticed = { ...base.info, fileCopyNoticeAt: iso(T0 + 1500) };
        expect(shouldNoticeUnsaved({ ...base, info: noticed, now: T0 + 1500 + FILE_COPY_REMIND_MS - 1 })).toBe(false);
        expect(shouldNoticeUnsaved({ ...base, info: noticed, now: T0 + 1500 + FILE_COPY_REMIND_MS })).toBe(true);
    });
});

describe('unsavedTrees / shouldShowUnsavedIndicator', () => {
    it('collects trees with people and edits no file holds', () => {
        const trees = [
            { id: 'a', personCount: 5, changedAt: iso(T0) },
            { id: 'b', personCount: 5, changedAt: iso(T0), fileCopyAt: iso(T0 + 1) },
            { id: 'c', personCount: 0, changedAt: iso(T0) },
            { id: 'd', personCount: 3 },
        ];
        expect(unsavedTrees(trees).map(t => t.id)).toEqual(['a']);
    });

    it('shows while any tree is unsaved and the browser may clear it', () => {
        const base = { state: 'best-effort' as const, unsavedCount: 1, viewMode: false };
        expect(shouldShowUnsavedIndicator(base)).toBe(true);
        expect(shouldShowUnsavedIndicator({ ...base, state: 'persistent' })).toBe(false);
        expect(shouldShowUnsavedIndicator({ ...base, unsavedCount: 0 })).toBe(false);
        expect(shouldShowUnsavedIndicator({ ...base, viewMode: true })).toBe(false);
    });
});

describe('storageAdvice', () => {
    it('picks the advice for the device', () => {
        const env = { ios: false, standalone: false, canInstall: false, browser: 'other' as const };
        expect(storageAdvice({ ...env, ios: true })).toBe('ios-safari');
        expect(storageAdvice({ ...env, ios: true, standalone: true })).toBe('ios-app');
        expect(storageAdvice({ ...env, canInstall: true, browser: 'chromium' })).toBe('install');
        expect(storageAdvice({ ...env, browser: 'chromium' })).toBe('install-menu');
        expect(storageAdvice({ ...env, browser: 'safari' })).toBe('mac-dock');
        expect(storageAdvice({ ...env, browser: 'firefox' })).toBe('firefox');
        expect(storageAdvice({ ...env, standalone: true, canInstall: true, browser: 'chromium' })).toBe('file');
        expect(storageAdvice(env)).toBe('file');
    });

    it('tells the browser family apart', () => {
        const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
        expect(browserFamily(`${mac} Chrome/129.0 Safari/537.36`)).toBe('chromium');
        expect(browserFamily(`${mac} Chrome/129.0 Safari/537.36 Edg/129.0`)).toBe('chromium');
        expect(browserFamily(`${mac} Version/18.0 Safari/605.1.15`)).toBe('safari');
        expect(browserFamily('Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('firefox');
        expect(browserFamily('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')).toBe('other');
        expect(browserFamily('anything', ['Not A Brand', 'Chromium'])).toBe('chromium');
    });

    it('recognises iPhone and iPadOS', () => {
        expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
        expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
        expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
        expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 5)).toBe(false);
    });
});
