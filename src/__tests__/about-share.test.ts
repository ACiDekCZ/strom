/**
 * About: "Share Strom" passes on the production website in the UI language
 * through the system share sheet where there is one, otherwise copies the
 * address; a cancelled sheet ends quietly. The author's X link and the texts
 * exist in every UI language, without addressing the reader.
 */
import { describe, it, expect, vi } from 'vitest';
import { shareStrom, shareStromUrl, SHARE_SHEET_WAIT_MS, SHARE_SHEET_MIN_MS, isDesktopAppWindow, aboutAuthorXLink, type ShareNavigator } from '../about-links.js';
import { getStringsForLang, type Language } from '../strings.js';

const LANGS: Language[] = ['en', 'cs', 'de', 'pl'];

/** A sheet a person answers: after a while, as a real choice takes. */
function after(ms: number, fail = false): () => Promise<void> {
    return () => new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(abortError()) : resolve()), ms));
}

/** Run `body` on fixed clocks (fake timers, outside midnight UTC). */
async function onFixedClock(body: () => Promise<void>): Promise<void> {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-15T10:30:00Z'));
        await body();
    } finally {
        vi.useRealTimers();
    }
}

function abortError(): Error {
    const e = new Error('Share canceled');
    e.name = 'AbortError';
    return e;
}

describe('About: Share Strom', () => {
    it('points at the production website in the UI language', () => {
        expect(shareStromUrl('en')).toBe('https://stromapp.info/');
        expect(shareStromUrl('cs')).toBe('https://stromapp.info/cs/');
        expect(shareStromUrl('de')).toBe('https://stromapp.info/de/');
        expect(shareStromUrl('pl')).toBe('https://stromapp.info/pl/');
    });

    it('opens the system share sheet with the title and the address where there is one', () => onFixedClock(async () => {
        const share = vi.fn(after(2 * SHARE_SHEET_MIN_MS));
        const writeText = vi.fn(async () => undefined);
        const nav: ShareNavigator = { share, clipboard: { writeText } };
        const outcome = shareStrom('de', nav, 'Strom');
        await vi.advanceTimersByTimeAsync(SHARE_SHEET_WAIT_MS);
        expect(await outcome).toBe('shared');
        expect(share).toHaveBeenCalledWith({ title: 'Strom', url: 'https://stromapp.info/de/' });
        expect(writeText).not.toHaveBeenCalled();
    }));

    it('calls share() and canShare() on the navigator (a detached navigator.share throws "Illegal invocation")', () => onFixedClock(async () => {
        const writeText = vi.fn(async (_t: string) => undefined);
        const nav: ShareNavigator = {
            share(this: unknown) {
                if (this !== nav) throw new TypeError('Illegal invocation');
                return after(2 * SHARE_SHEET_MIN_MS)();
            },
            canShare(this: unknown) {
                if (this !== nav) throw new TypeError('Illegal invocation');
                return true;
            },
            clipboard: {
                writeText(this: unknown, t: string) {
                    if (this !== nav.clipboard) throw new TypeError('Illegal invocation');
                    return writeText(t);
                },
            },
        };
        const outcome = shareStrom('cs', nav, 'Strom');
        await vi.advanceTimersByTimeAsync(SHARE_SHEET_WAIT_MS);
        expect(await outcome).toBe('shared');
        expect(writeText).not.toHaveBeenCalled();
        // The copy, too, keeps clipboard as `this`.
        expect(await shareStrom('cs', { clipboard: nav.clipboard }, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/cs/');
    }));

    it('copies the address where the browser cannot share', async () => {
        const writeText = vi.fn(async () => undefined);
        expect(await shareStrom('pl', { clipboard: { writeText } }, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/pl/');
    });

    it('copies the address when canShare refuses the data', async () => {
        const share = vi.fn(async () => undefined);
        const writeText = vi.fn(async () => undefined);
        const nav: ShareNavigator = { share, canShare: () => false, clipboard: { writeText } };
        expect(await shareStrom('en', nav, 'Strom')).toBe('copied');
        expect(share).not.toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/');
    });

    it('ends quietly when the share sheet is closed without sharing', () => onFixedClock(async () => {
        const writeText = vi.fn(async () => undefined);
        const nav: ShareNavigator = { share: after(2 * SHARE_SHEET_MIN_MS, true), clipboard: { writeText } };
        const outcome = shareStrom('cs', nav, 'Strom');
        await vi.advanceTimersByTimeAsync(SHARE_SHEET_WAIT_MS);
        expect(await outcome).toBe('cancelled');
        expect(writeText).not.toHaveBeenCalled();
    }));

    it('copies the address when share() succeeds at once (an installed web app on a Mac shows no sheet)', () => onFixedClock(async () => {
        // Measured in an installed Chrome web app on a Mac: share() resolved in 0 ms, no sheet.
        const writeText = vi.fn(async () => undefined);
        const share = vi.fn(async () => undefined);
        expect(await shareStrom('cs', { share, clipboard: { writeText } }, 'Strom')).toBe('copied');
        expect(share).toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/cs/');
        // Just under the shortest human answer: still no sheet seen.
        writeText.mockClear();
        const quick = shareStrom('en', { share: after(SHARE_SHEET_MIN_MS - 1), clipboard: { writeText } }, 'Strom');
        await vi.advanceTimersByTimeAsync(SHARE_SHEET_MIN_MS);
        expect(await quick).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/');
    }));

    it('copies the address when the sheet is "cancelled" at once (it never showed)', () => onFixedClock(async () => {
        const writeText = vi.fn(async () => undefined);
        const nav: ShareNavigator = { share: async () => { throw abortError(); }, clipboard: { writeText } };
        expect(await shareStrom('de', nav, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/de/');
        writeText.mockClear();
        const thrown: ShareNavigator = { share: () => { throw abortError(); }, clipboard: { writeText } };
        expect(await shareStrom('de', thrown, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledTimes(1);
    }));

    it('a desktop app window copies at once without calling share()', async () => {
        const share = vi.fn(async () => undefined);
        const writeText = vi.fn(async () => undefined);
        expect(await shareStrom('pl', { share, clipboard: { writeText } }, 'Strom', { appWindow: true })).toBe('copied');
        expect(share).not.toHaveBeenCalled();
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/pl/');
    });

    it('falls back to the copy when the share sheet cannot open', async () => {
        const writeText = vi.fn(async () => undefined);
        const notAllowed = new Error('no gesture');
        notAllowed.name = 'NotAllowedError';
        const nav: ShareNavigator = { share: async () => { throw notAllowed; }, clipboard: { writeText } };
        expect(await shareStrom('cs', nav, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/cs/');
    });

    it('copies the address when the share sheet never answers (an app window on a Mac opens none)', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-11-15T10:30:00Z'));
            const writeText = vi.fn(async () => undefined);
            const nav: ShareNavigator = { share: () => new Promise<void>(() => {}), clipboard: { writeText } };
            const outcome = shareStrom('cs', nav, 'Strom');
            await vi.advanceTimersByTimeAsync(SHARE_SHEET_WAIT_MS - 1);
            expect(writeText).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(await outcome).toBe('copied');
            expect(writeText).toHaveBeenCalledWith('https://stromapp.info/cs/');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a sheet answering within the wait is the outcome: shared or cancelled, no copy', () => onFixedClock(async () => {
        const writeText = vi.fn(async () => undefined);
        for (const ms of [SHARE_SHEET_MIN_MS, SHARE_SHEET_WAIT_MS - 100]) {
            const shared = shareStrom('en', { share: after(ms), clipboard: { writeText } }, 'Strom');
            const cancelled = shareStrom('en', { share: after(ms, true), clipboard: { writeText } }, 'Strom');
            await vi.advanceTimersByTimeAsync(SHARE_SHEET_WAIT_MS * 2);
            expect(await shared).toBe('shared');
            expect(await cancelled).toBe('cancelled');
        }
        expect(writeText).not.toHaveBeenCalled();
    }));

    it('copies the address when share throws at once', async () => {
        const writeText = vi.fn(async () => undefined);
        const nav: ShareNavigator = { share: () => { throw new TypeError('not allowed'); }, clipboard: { writeText } };
        expect(await shareStrom('de', nav, 'Strom')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('https://stromapp.info/de/');
    });

    it('reports failure when neither sharing nor the clipboard works', async () => {
        expect(await shareStrom('en', {}, 'Strom')).toBe('failed');
        const nav: ShareNavigator = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
        expect(await shareStrom('en', nav, 'Strom')).toBe('failed');
    });
});

describe('About: Share Strom in a desktop app window', () => {
    type Media = Record<string, boolean>;
    const env = (media: Media, mobile: boolean | null = false, platform = 'macOS') => ({
        matchMedia: (q: string) => ({ matches: media[q] === true }),
        navigator: mobile === null ? {} : { userAgentData: { mobile, platform } },
    });
    const computer: Media = { '(pointer: fine)': true, '(hover: hover)': true };

    it('is only a Mac: Windows, ChromeOS and Linux app windows keep the share sheet', () => {
        const app: Media = { ...computer, '(display-mode: standalone)': true };
        expect(isDesktopAppWindow(env(app, false, 'macOS'))).toBe(true);
        for (const platform of ['Windows', 'Chrome OS', 'Linux', '']) {
            expect(isDesktopAppWindow(env(app, false, platform))).toBe(false);
            expect(isDesktopAppWindow(env({ ...computer, '(display-mode: window-controls-overlay)': true }, false, platform))).toBe(false);
        }
    });

    it('is an installed web app of Chromium on a Mac (standalone or window controls overlay)', () => {
        expect(isDesktopAppWindow(env({ ...computer, '(display-mode: standalone)': true }))).toBe(true);
        expect(isDesktopAppWindow(env({ ...computer, '(display-mode: window-controls-overlay)': true }))).toBe(true);
    });

    it('is not a browser tab, a phone or tablet, or Safari (no userAgentData)', () => {
        expect(isDesktopAppWindow(env({ ...computer, '(display-mode: browser)': true }))).toBe(false);
        // A phone or a tablet: touch, no hover; Chromium says mobile.
        expect(isDesktopAppWindow(env({ '(display-mode: standalone)': true, '(pointer: coarse)': true }))).toBe(false);
        expect(isDesktopAppWindow(env({ ...computer, '(display-mode: standalone)': true }, true))).toBe(false);
        // Safari's web app in the Dock keeps its share sheet.
        expect(isDesktopAppWindow(env({ ...computer, '(display-mode: standalone)': true }, null))).toBe(false);
        expect(isDesktopAppWindow({})).toBe(false);
    });
});

describe('About: the author on X and the sharing texts', () => {
    it('links the author on X in a new tab with noopener, in every language', () => {
        for (const lang of LANGS) {
            const link = aboutAuthorXLink(lang);
            expect(link.href).toBe('https://x.com/visekm');
            expect(link.target).toBe('_blank');
            expect(link.rel).toMatch(/\bnoopener\b/);
            // A web page in a new window: the ↗ mark.
            expect(link.label).toMatch(/ X ↗$/);
        }
    });

    it('has the texts in every language, the button without the web mark', () => {
        const expected: Record<Language, { share: string; note: RegExp; copied: string; x: string }> = {
            en: { share: 'Share Strom', note: /^Sharing helps too/, copied: 'Link copied', x: 'Author on X ↗' },
            cs: { share: 'Sdílet Strom', note: /^Pomůže i sdílení: čím víc lidí o Stromu ví, tím víc se může rozvíjet\.$/, copied: 'Odkaz zkopírován', x: 'Autor na X ↗' },
            de: { share: 'Strom teilen', note: /^Auch Teilen hilft/, copied: 'Link kopiert', x: 'Autor auf X ↗' },
            pl: { share: 'Udostępnij Strom', note: /^Udostępnianie też pomaga/, copied: 'Link skopiowany', x: 'Autor na X ↗' },
        } as Record<Language, { share: string; note: RegExp; copied: string; x: string }>;
        for (const lang of LANGS) {
            const a = getStringsForLang(lang).about;
            expect(a.share).toBe(expected[lang].share);
            expect(a.shareNote).toMatch(expected[lang].note);
            expect(a.shareCopied).toBe(expected[lang].copied);
            expect(a.authorX).toBe(expected[lang].x);
            expect(a.share).not.toMatch(/[↗◆]/);
        }
    });

    it('does not address the reader', () => {
        const addressing: Record<string, RegExp> = {
            en: /\b(you|your)\b/i,
            cs: /\b(vy|vás|váš|vaše|ty|tvůj|tvoje)\b/i,
            de: /\b(Sie|Ihr|Ihre|du|dein)\b/,
            pl: /\b(ty|twój|twoje|pan|pani|wy|wasz)\b/i,
        };
        for (const lang of LANGS) {
            const a = getStringsForLang(lang).about;
            for (const text of [a.shareNote, a.share, a.shareCopied, a.authorX]) {
                expect(text).not.toMatch(addressing[lang]);
            }
        }
    });
});
