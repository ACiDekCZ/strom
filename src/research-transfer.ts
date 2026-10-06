/**
 * Moving a tree to the browser the research opens — the pure half.
 *
 * The research opens the app in a browser of its choosing. It opens the one
 * the installation came from when the line says which (STROM_FROM_BROWSER).
 * Safari cannot reach the research at all: there the tree goes over as a file
 * (the whole tree, images too, marked with its token first), the research
 * hands it back to the browser it opens (GET <bridge>/transfer), and the app
 * there imports it before the usual hand-over.
 */

import type { StromData } from './types.js';
import { researchAdoptToken } from './research-link.js';

/**
 * The browser the app runs in, as the research is told (STROM_FROM_BROWSER,
 * &browser=). `mobile`: a phone or tablet — the research runs on a computer,
 * so the tree always goes over by a file, whatever the phone's browser.
 */
export type AppBrowser = 'chrome' | 'edge' | 'brave' | 'opera' | 'firefox' | 'safari' | 'chromium' | 'other' | 'mobile';

export const APP_BROWSERS: readonly AppBrowser[] = ['chrome', 'edge', 'brave', 'opera', 'firefox', 'safari', 'chromium', 'other', 'mobile'];

/**
 * Firefox treats http://127.0.0.1 as a secure origin and reaches the bridge
 * (proven by the research 1.12.1, Firefox 151 and 157). One switch: were it
 * to fail, it would move the tree like Safari and get the notice.
 */
export const FIREFOX_REACHES_RESEARCH = true;

/** The Chromium family: proven to reach the research on this computer. */
const REACHES_RESEARCH: readonly AppBrowser[] = ['chrome', 'edge', 'brave', 'opera', 'chromium'];

/**
 * The browser from the User-Agent Client Hints' brands, the User-Agent and
 * Brave's own flag. Vivaldi and Arc show no mark of their own: a Chromium
 * without Google Chrome among its brands is "chromium".
 */
export function detectAppBrowser(userAgent: string, brands: readonly string[] | undefined, brave = false): AppBrowser {
    const has = (name: string): boolean => !!brands?.some(b => b === name);
    if (brave) return 'brave';
    if (has('Microsoft Edge') || /\bEdg(e|A|iOS)?\//.test(userAgent)) return 'edge';
    if (has('Opera') || /\bOPR\//.test(userAgent)) return 'opera';
    if (/\bFirefox\//.test(userAgent) || /\bFxiOS\//.test(userAgent)) return 'firefox';
    if (/safari/i.test(userAgent) && !/chrome|chromium|crios|android/i.test(userAgent)) return 'safari';
    if (has('Google Chrome')) return 'chrome';
    if (brands?.length) return has('Chromium') ? 'chromium' : 'other';
    if (/\bChrome\//.test(userAgent)) return 'chrome';
    return 'other';
}

/** The browser this page runs in. */
export function currentAppBrowser(): AppBrowser {
    if (typeof navigator === 'undefined') return 'other';
    const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] }; brave?: unknown };
    const brands = nav.userAgentData?.brands?.map(b => b.brand);
    return detectAppBrowser(nav.userAgent || '', brands, !!nav.brave);
}

/**
 * The browser cannot reach the research on this computer (Safari and other
 * WebKit browsers, anything unknown, a phone): the tree moves by a file.
 */
export function needsTransfer(browser: AppBrowser): boolean {
    if (browser === 'firefox') return !FIREFOX_REACHES_RESEARCH;
    return !REACHES_RESEARCH.includes(browser);
}

/** A browser's name in a sentence (its product name, the same in every language). */
export function appBrowserName(browser: AppBrowser): string {
    return ({
        chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', firefox: 'Firefox', safari: 'Safari', chromium: 'Chromium', other: '', mobile: '',
    } as Record<AppBrowser, string>)[browser];
}

// ---- the transfer file ----

/** The file's first key: the mark of a transfer. */
export const TRANSFER_KEY = 'stromTransfer';

export interface TransferMark {
    v: 1;
    /** The tree's token, the same as the line's STROM_FROM_APP. */
    token: string;
    from: AppBrowser;
    /** The tree's name and how many people go over (for the research's question). */
    tree: string;
    persons: number;
    at: string;
    /**
     * This app's address when it is another copy than the public one (see
     * installAppUrl): the research opens that copy with ?adopt= even when the
     * Win + R line had no room left for STROM_APP_URL (1.12.1-rc.3 reads it).
     */
    app?: string;
}

/** The name the app asks the browser to save the file under: ASCII only, safe unquoted in a shell line. */
export function transferFileName(token: string): string {
    return `strom-prenos-${token.slice(0, 8)}.json`;
}

/** A file name the line may carry (STROM_FROM_FILE): only what transferFileName makes. */
export function isTransferFileName(name: unknown): name is string {
    return typeof name === 'string' && /^strom-prenos-[A-Za-z0-9_-]{8}\.json$/.test(name);
}

/** The file's text: the mark first (the research reads only the head), then the tree as a full JSON export. */
export function buildTransferJson(mark: TransferMark, data: StromData): string {
    const { [TRANSFER_KEY]: _old, ...tree } = data as StromData & { [TRANSFER_KEY]?: unknown };
    return JSON.stringify({ [TRANSFER_KEY]: mark, ...tree });
}

/**
 * The mark of a transfer file and the tree's JSON without it, or null when it
 * is not one or not for `token`. Untrusted: the tree itself goes through the
 * usual JSON import checks afterwards.
 */
export function readTransferJson(text: string, token: string): { mark: TransferMark; json: string } | null {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { [TRANSFER_KEY]: rawMark, ...tree } = parsed as Record<string, unknown>;
    const m = rawMark && typeof rawMark === 'object' ? rawMark as Record<string, unknown> : null;
    if (!m || m.v !== 1 || researchAdoptToken(m.token) !== token) return null;
    const from = APP_BROWSERS.includes(m.from as AppBrowser) ? m.from as AppBrowser : 'other';
    const mark: TransferMark = {
        v: 1, token, from,
        tree: typeof m.tree === 'string' ? m.tree.slice(0, 200) : '',
        persons: typeof m.persons === 'number' && Number.isFinite(m.persons) ? Math.max(0, Math.floor(m.persons)) : 0,
        at: typeof m.at === 'string' ? m.at : '',
    };
    return { mark, json: JSON.stringify(tree) };
}

/** The bridge feature of a research that hands a moved tree over (GET <bridge>/transfer, Strom Research 1.12.1). */
export const TRANSFER_FEATURE = 'adopt.transfer';

/** The bridge feature of a research that takes a tree with nobody in it yet (POST <bridge>/adopt, 1.12.1-rc.6). */
export const EMPTY_FEATURE = 'adopt.empty';

/**
 * Whether a research's `/status` says its bridge moves trees from another
 * browser. False for an older research (1.12.0 and before: no `features`, or
 * without this one), whose line and links take no tree from Safari or a phone.
 */
export function bridgeMovesTrees(status: unknown): boolean {
    return hasFeature(status, TRANSFER_FEATURE);
}

/**
 * Whether a research's `/status` says its bridge takes a tree with nobody
 * in it yet (installed from the welcome screen, a tree handed over before its
 * first person). False for an older one, which answers 400 tree.empty.
 */
export function bridgeTakesEmpty(status: unknown): boolean {
    return hasFeature(status, EMPTY_FEATURE);
}

function hasFeature(status: unknown, feature: string): boolean {
    const features = status && typeof status === 'object' ? (status as Record<string, unknown>).features : null;
    return Array.isArray(features) && features.includes(feature);
}
