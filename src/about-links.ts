/**
 * Links of the About dialog that depend on the UI language. The Czech users'
 * group on Facebook is a Czech community, so it is offered only in the Czech
 * UI (same gating idea as isCzechRelevant in archives.ts); other languages get
 * no link at all. A plain link — no Facebook script, widget or remote icon.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';
import { BETA_HOSTNAME, PWA_HOSTNAME } from './model-values.js';

export const USERS_GROUP_URL = 'https://www.facebook.com/groups/stromapp';

/** The changelog files on GitHub: blob/<branch>/<file>. */
export const CHANGELOG_BASE_URL = 'https://github.com/ACiDekCZ/strom/blob/';

export interface AboutExternalLink {
    href: string;
    label: string;
    target: '_blank';
    rel: string;
}

/** The users' group link for the given UI language, or null where it is not offered. */
export function aboutUsersGroupLink(lang: Language): AboutExternalLink | null {
    if (lang !== 'cs') return null;
    return {
        href: USERS_GROUP_URL,
        label: getStringsForLang(lang).about.usersGroup,
        target: '_blank',
        rel: 'noopener noreferrer',
    };
}

/**
 * GitHub's anchor of a version section of the changelog: the heading
 * "## 3.12.0" becomes "#3120". A pre-release suffix is dropped, so a beta of
 * 3.12.0 points at the section of the version it prepares.
 */
export function changelogAnchor(version: string): string {
    return version.split(/[-+]/)[0].replace(/[^0-9]/g, '');
}

/** The UI languages with a changelog file of their own; any other reads the English one. */
function changelogLanguage(lang: Language): Language {
    return lang === 'cs' || lang === 'de' || lang === 'pl' ? lang : 'en';
}

/** The changelog file of a changelog language (en → CHANGELOG.md, cs → CHANGELOG.cs.md, …). */
function changelogFile(lang: Language): string {
    return lang === 'en' ? 'CHANGELOG.md' : `CHANGELOG.${lang}.md`;
}

/**
 * Whether the changelog link of this build points at the beta branch. The
 * same rule as importFromFileUrl (pwa.ts): the beta site always, the public
 * site never, and anywhere else (a dev server, an exported or embedded file)
 * by the version, so a local beta build reads the beta changelog while a
 * released version always reads main. Pure for testing.
 */
export function changelogIsBeta(hostname: string, appVersion: string): boolean {
    return hostname === BETA_HOSTNAME || (hostname !== PWA_HOSTNAME && /-beta\b/.test(appVersion));
}

/**
 * The "What's new" link of the About dialog: the changelog on GitHub in the
 * UI language, at the section of the running version. A beta build reads the
 * beta branch (the section in preparation); every other build reads main,
 * which carries released versions only. Offered in every language.
 */
export function aboutChangelogLink(lang: Language, version: string, beta: boolean): AboutExternalLink {
    const known = changelogLanguage(lang);
    return {
        href: `${CHANGELOG_BASE_URL}${beta ? 'beta' : 'main'}/${changelogFile(known)}#${changelogAnchor(version)}`,
        label: getStringsForLang(known).about.whatsNew,
        target: '_blank',
        rel: 'noopener noreferrer',
    };
}

/** The website's home page. */
export const WEBSITE_URL = 'https://stromapp.info/';

/**
 * The website's home page in a page's language: English at the root, the
 * other languages under their prefix (/cs/, /de/, /pl/).
 */
export function websiteUrl(lang: Language): string {
    return lang === 'en' ? WEBSITE_URL : `${WEBSITE_URL}${lang}/`;
}

/** The author's profile on X, offered in About in every language. */
export const AUTHOR_X_URL = 'https://x.com/visekm';

/** The author-on-X link of the About dialog (a web page in a new tab). */
export function aboutAuthorXLink(lang: Language): AboutExternalLink {
    return {
        href: AUTHOR_X_URL,
        label: getStringsForLang(lang).about.authorX,
        target: '_blank',
        rel: 'noopener noreferrer',
    };
}

/**
 * The address "Share Strom" passes on: the production website in the UI
 * language (/cs/, /de/, /pl/; English and any other language at the root).
 * Always the public site, from a beta build or a saved file too.
 */
export function shareStromUrl(lang: Language): string {
    return lang === 'cs' || lang === 'de' || lang === 'pl' ? `${WEBSITE_URL}${lang}/` : WEBSITE_URL;
}

/** What "Share Strom" ended with: the system sheet, a copy, nothing (cancelled) or neither worked. */
export type ShareStromOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The parts of `navigator` that sharing uses (injectable for tests). */
export interface ShareNavigator {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
    clipboard?: { writeText(text: string): Promise<void> };
}

/**
 * How long a share sheet may take to answer before the address is copied too:
 * Chrome in an app window on a Mac (an installed web app) may open no sheet
 * and its share() never settles, so the click would do nothing.
 */
export const SHARE_SHEET_WAIT_MS = 1500;

/**
 * A sheet that answers sooner than this was never seen: nobody picks a target
 * or closes a sheet that fast. Chrome in an installed web app on a Mac
 * resolves share() at once (0 ms) with no sheet; a success or a cancel that
 * quick is taken as "no sheet" and the address is copied.
 */
export const SHARE_SHEET_MIN_MS = 300;

/** How `shareStrom` waits for the sheet (injectable for tests). */
export interface ShareStromOptions {
    /** A desktop app window (an installed web app): no sheet, the copy at once. */
    appWindow?: boolean;
    waitMs?: number;
    minMs?: number;
    now?: () => number;
}

/** The parts of `window` that tell a desktop app window (injectable for tests). */
export interface AppWindowEnv {
    matchMedia?: (query: string) => { matches: boolean };
    /** `navigator.userAgentData` (Chromium only: `mobile`, `platform`) is read from it. */
    navigator?: object;
}

/**
 * Chromium on a Mac running Strom as an installed web app (its own window,
 * standalone or with the window controls overlay): there the share sheet
 * opens nowhere, so "Share Strom" copies at once. Windows and ChromeOS app
 * windows, phones, tablets (touch), Safari and a browser tab keep the sheet.
 */
export function isDesktopAppWindow(env: AppWindowEnv): boolean {
    const mq = env.matchMedia;
    if (typeof mq !== 'function') return false;
    const own = mq('(display-mode: standalone)').matches || mq('(display-mode: window-controls-overlay)').matches;
    if (!own) return false;
    // userAgentData exists in Chromium only; `mobile` is false on a computer.
    const uad = (env.navigator as { userAgentData?: { mobile?: unknown; platform?: unknown } } | undefined)?.userAgentData;
    if (uad?.mobile !== false) return false;
    // Only Chrome on macOS opens no sheet; Windows and ChromeOS show theirs.
    if (uad.platform !== 'macOS') return false;
    return mq('(pointer: fine)').matches && mq('(hover: hover)').matches;
}

/**
 * Share the website: the system share sheet where the browser has one (a
 * phone, a tablet, a Mac), otherwise a copy of the address to the clipboard.
 * A sheet closed without sharing is 'cancelled' (nothing to show); a sheet
 * that cannot open (no user gesture, a blocked context) falls back to the
 * copy, and so does one that answers sooner than `minMs` (it never showed)
 * or not within `waitMs` (it may open nowhere; a sheet that is open meanwhile
 * stays). A desktop app window skips the sheet. Nothing is measured or sent
 * anywhere else.
 */
export async function shareStrom(lang: Language, nav: ShareNavigator, title: string,
    opts: ShareStromOptions = {}): Promise<ShareStromOutcome> {
    const { appWindow = false, waitMs = SHARE_SHEET_WAIT_MS, minMs = SHARE_SHEET_MIN_MS, now = Date.now } = opts;
    const data = { title, url: shareStromUrl(lang) };
    if (!appWindow && typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
        const share = nav.share;
        const started = now();
        const sheet = await new Promise<'shared' | 'cancelled' | 'copy'>((resolve) => {
            const timer = setTimeout(() => resolve('copy'), waitMs);
            // An answer too quick for a person means no sheet was shown.
            const settle = (outcome: 'shared' | 'cancelled' | 'copy') => {
                clearTimeout(timer);
                resolve(outcome !== 'copy' && now() - started < minMs ? 'copy' : outcome);
            };
            const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === 'AbortError';
            try {
                // Called on `nav`: a detached navigator.share throws "Illegal invocation".
                share.call(nav, data).then(() => settle('shared'), (e: unknown) => settle(isAbort(e) ? 'cancelled' : 'copy'));
            } catch (e) {
                settle(isAbort(e) ? 'cancelled' : 'copy');
            }
        });
        if (sheet !== 'copy') return sheet;
    }
    try {
        if (!nav.clipboard) return 'failed';
        await nav.clipboard.writeText(data.url);
        return 'copied';
    } catch {
        return 'failed';
    }
}
