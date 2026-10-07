/**
 * Installing Strom Research from the app — the pure half: which system the
 * computer runs, the one line to paste for it (with the tree's token, the
 * same kind as a strom-research://new?app= link), and the install record the
 * app keeps while the research is being installed (24 h).
 *
 * The lines are the research's (ZADANI_VYZKUM "Instalace výzkumu z
 * aplikace"); keep them here, in one place, so the research can change them.
 */

import { TreeId } from './types.js';
import { researchAdoptToken } from './research-link.js';
import { AppBrowser, APP_BROWSERS, isTransferFileName } from './research-transfer.js';

export type InstallOs = 'mac' | 'win' | 'linux';
export const INSTALL_OSES: readonly InstallOs[] = ['mac', 'win', 'linux'];

/** Where the release's install scripts live. */
export const INSTALL_RELEASE_URL = 'https://github.com/ACiDekCZ/strom-research/releases/latest';
const DOWNLOAD = `${INSTALL_RELEASE_URL}/download`;

/**
 * The beta app's lines lead to the research's beta channel (its branch `beta`,
 * STROM_CHANNEL=beta, npm's `beta` tag). Off until the research's first beta
 * is out (the branch exists from then on): flipping this one literal is all.
 */
export const INSTALL_BETA_CHANNEL = true;

/** Which research the line installs: its releases (`stable`) or its beta channel. */
export type InstallChannel = 'stable' | 'beta';

/** The channel for this app: the beta channel only in the beta build, and only while INSTALL_BETA_CHANNEL is on. */
export function installChannel(betaBuild: boolean, betaChannelOn: boolean = INSTALL_BETA_CHANNEL): InstallChannel {
    return betaBuild && betaChannelOn ? 'beta' : 'stable';
}

/** The beta channel's install scripts (the research's branch `beta`). */
const BETA_DOWNLOAD = 'https://raw.githubusercontent.com/ACiDekCZ/strom-research/beta/install';
/** Every release, prereleases (the betas) among them. */
export const INSTALL_RELEASES_URL = 'https://github.com/ACiDekCZ/strom-research/releases';

/** The page with the research's releases for the line's channel (under the npm way). */
export function installReleasePage(channel: InstallChannel = 'stable'): string {
    return channel === 'beta' ? INSTALL_RELEASES_URL : INSTALL_RELEASE_URL;
}

/** The public app: the research opens it by itself, its address needs no saying. */
export const PUBLIC_APP_URL = 'https://stromapp.info/run/';

/**
 * The app's own address for the line, when it is another copy than the public
 * one (the beta, a development copy on this computer): the research then
 * opens THIS app with ?adopt=, not stromapp.info (whose trees are others).
 * Only the app's pages (stromapp.info, beta.stromapp.info, localhost /
 * 127.0.0.1), only characters safe in a shell line. Null: say nothing.
 */
export function installAppUrl(href: string): string | null {
    let u: URL;
    try { u = new URL(href); } catch { return null; }
    const appOrigin = u.origin === 'https://stromapp.info' || u.origin === 'https://beta.stromapp.info'
        || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.origin);
    if (!appOrigin || u.username || u.password) return null;
    const url = `${u.origin}${u.pathname}`;
    if (url === PUBLIC_APP_URL || !/^[A-Za-z0-9:/._~-]+$/.test(url)) return null;
    return url;
}

/** What else the line tells the research: the browser it came from, the file a tree moves by (see research-transfer.ts). */
export interface InstallExtra {
    browser?: AppBrowser;
    file?: string;
}

/**
 * The line carries one variable, STROM_FROM (research 1.12.1+), in place of
 * the five of before (STROM_FROM_APP, _APP_NAME, _BROWSER, _FILE, STROM_APP_URL).
 * The installers take the newest research from GitHub: on only once 1.12.1 is
 * its latest release (before that, tests run against an rc by STROM_DOWNLOAD_BASE).
 */
export const INSTALL_LINE_STROM_FROM = true;

/** The public app's beta, said as `beta` in STROM_FROM. */
const BETA_APP_URL = 'https://beta.stromapp.info/run/';

/**
 * STROM_FROM's value, form 1: `1|<token>|<browser>|<file>|<app>|<name>` —
 * always six fields, empty ones kept in place. The file is the 8 characters
 * of strom-prenos-XXXXXXXX.json; the app empty for the public one, `beta`, or
 * this copy's address (installAppUrl: no `|`); the name last (installTreeName:
 * no `|` either — the research takes all after the fifth `|`).
 */
export function installFromValue(token: string, appUrl: string | null, name: string, extra: InstallExtra = {}): string {
    const c = cleanExtra(extra);
    const file = c.file ? c.file.slice('strom-prenos-'.length, -'.json'.length) : '';
    const app = !appUrl ? '' : appUrl === BETA_APP_URL ? 'beta' : appUrl;
    return ['1', token, c.browser ?? '', file, app, name].join('|');
}

/**
 * The line for Terminal (macOS, Linux) or Win + R (Windows), with the tree's
 * token (and this app's address, see installAppUrl). The beta channel: the
 * scripts from the research's branch `beta` and STROM_CHANNEL=beta (a redirect
 * would not carry the variable, so the line says it).
 */
export function installLine(os: InstallOs, token: string, appUrl: string | null = null, treeName = '', extra: InstallExtra = {}, channel: InstallChannel = 'stable'): string {
    if (!INSTALL_LINE_STROM_FROM) return legacyInstallLine(os, token, appUrl, treeName, extra);
    const name = installTreeName(treeName);
    const beta = channel === 'beta';
    const from = beta ? BETA_DOWNLOAD : DOWNLOAD;
    if (os !== 'win') return `curl -fsSL ${from}/install.sh | ${beta ? 'STROM_CHANNEL=beta ' : ''}STROM_FROM=${shQuote(installFromValue(token, appUrl, name, extra))} sh`;
    const line = (n: string): string =>
        `powershell -ExecutionPolicy Bypass -c "${beta ? winSet('STROM_CHANNEL', 'beta') : ''}${winSet('STROM_FROM', installFromValue(token, appUrl, n, extra).replace(/'/g, "''"))}irm ${from}/install.ps1 | iex"`;
    // Win + R takes 259 characters: only the name is shortened (or left out under 3 characters).
    let fit = name;
    while (fit && line(fit).length > WIN_RUN_MAX) fit = fit.slice(0, -1).trim();
    return line(fit.length >= 3 ? fit : '');
}

/** The npm way for technical users: install (the beta channel: npm's `beta` tag), then start with the token (and this app's address). */
export function npmLines(os: InstallOs, token: string, appUrl: string | null = null, treeName = '', extra: InstallExtra = {}, channel: InstallChannel = 'stable'): [string, string] {
    if (!INSTALL_LINE_STROM_FROM) return legacyNpmLines(os, token, appUrl, treeName, extra);
    const value = installFromValue(token, appUrl, installTreeName(treeName), extra);
    return [channel === 'beta' ? 'npm i -g strom-research@beta' : 'npm i -g strom-research', os === 'win'
        ? psSet('STROM_FROM', value.replace(/'/g, "''")) + 'strom-research'
        : `STROM_FROM=${shQuote(value)} strom-research`];
}

const shQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/** The five variables of before (research up to 1.12.0). */
export function legacyInstallLine(os: InstallOs, token: string, appUrl: string | null = null, treeName = '', extra: InstallExtra = {}): string {
    const name = installTreeName(treeName);
    if (os !== 'win') return `curl -fsSL ${DOWNLOAD}/install.sh | STROM_FROM_APP=${token} ${shName(name)}${shExtra(extra)}${appUrl ? `STROM_APP_URL=${appUrl} ` : ''}sh`;
    const line = (n: string, x: InstallExtra, url: string | null = appUrl): string =>
        `powershell -ExecutionPolicy Bypass -c "${winSet('STROM_FROM_APP', token)}${winName(n, winSet)}${winExtra(x, winSet)}${url ? winSet('STROM_APP_URL', url) : ''}irm ${DOWNLOAD}/install.ps1 | iex"`;
    // Win + R takes 259 characters: the name shortened to what is left, or left out (the research suggests one);
    // then the browser (the research then picks one itself); then this app's address when the tree moves by a
    // file (the file carries it, TransferMark.app) — the file never (the tree moves by it).
    const fitName = (x: InstallExtra, url: string | null = appUrl): string => {
        let fit = name;
        while (fit && line(fit, x, url).length > WIN_RUN_MAX) fit = fit.slice(0, -1).trim();
        return fit.length >= 3 ? fit : '';
    };
    const withName = fitName(extra);
    if (line(withName, extra).length <= WIN_RUN_MAX) return line(withName, extra);
    const lean: InstallExtra = { ...extra, browser: undefined };
    if (line(fitName(lean), lean).length <= WIN_RUN_MAX || !extra.file || !appUrl) return line(fitName(lean), lean);
    return line(fitName(lean, null), lean, null);
}

/** The Run dialog's (Win + R) limit. */
export const WIN_RUN_MAX = 259;

/** The npm lines with the five variables of before. */
export function legacyNpmLines(os: InstallOs, token: string, appUrl: string | null = null, treeName = '', extra: InstallExtra = {}): [string, string] {
    const name = installTreeName(treeName);
    return ['npm i -g strom-research', os === 'win'
        ? `${psSet('STROM_FROM_APP', token)}${winName(name, psSet)}${winExtra(extra, psSet)}${appUrl ? psSet('STROM_APP_URL', appUrl) : ''}strom-research`
        : `STROM_FROM_APP=${token} ${shName(name)}${shExtra(extra)}${appUrl ? `STROM_APP_URL=${appUrl} ` : ''}strom-research`];
}

/**
 * The tree's name as the research's suggested name (`STROM_FROM_APP_NAME`):
 * letters, digits, spaces and . , ( ) ' - only — the name may come from a
 * foreign file and goes into a shell command (inside PowerShell's double
 * quotes `$`, `"` and the backtick would be live) — at most 80 characters.
 */
export function installTreeName(raw: string): string {
    return raw.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} .,()'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
}

/** A variable for the line typed in PowerShell itself (the npm way). */
type WinSet = (name: string, value: string) => string;
const psSet: WinSet = (name, value) => `$env:${name}='${value}'; `;
/**
 * A variable inside the Win + R line's `-c "…"`: Set-Item, no `$` — pasted into
 * an open PowerShell instead of Win + R, that PowerShell would expand
 * `$env:X` inside the double quotes to nothing before the inner one runs.
 * Works the same from Win + R and cmd.
 */
const winSet: WinSet = (name, value) => `si env:${name} '${value}'; `;
const winName = (name: string, set: WinSet): string => (name ? set('STROM_FROM_APP_NAME', name.replace(/'/g, "''")) : '');
const shName = (name: string): string => (name ? `STROM_FROM_APP_NAME='${name.replace(/'/g, "'\\''")}' ` : '');
// Both values are from fixed sets of plain characters (APP_BROWSERS, isTransferFileName): no quoting needed.
const cleanExtra = (x: InstallExtra): InstallExtra => ({
    ...(x.browser && APP_BROWSERS.includes(x.browser) ? { browser: x.browser } : {}),
    ...(isTransferFileName(x.file) ? { file: x.file } : {}),
});
const shExtra = (x: InstallExtra): string => {
    const c = cleanExtra(x);
    return `${c.browser ? `STROM_FROM_BROWSER=${c.browser} ` : ''}${c.file ? `STROM_FROM_FILE=${c.file} ` : ''}`;
};
const winExtra = (x: InstallExtra, set: WinSet): string => {
    const c = cleanExtra(x);
    return `${c.browser ? set('STROM_FROM_BROWSER', c.browser) : ''}${c.file ? set('STROM_FROM_FILE', c.file) : ''}`;
};

/**
 * The system from the browser: User-Agent Client Hints when there are
 * any, else the User-Agent. ChromeOS runs Linux apps; anything unknown is
 * taken for a Mac (the user can switch).
 */
export function detectInstallOs(platform: string | undefined, userAgent: string): InstallOs {
    const from = (text: string): InstallOs | null =>
        /\bWin/.test(text) ? 'win'
        : /\bmacOS\b|\bMac|iPhone|iPad/.test(text) ? 'mac'
        : /Linux|CrOS|X11|Chrome OS|ChromeOS/.test(text) ? 'linux'
        : null;
    // The hint names the platform alone; the User-Agent only when there is none.
    return (platform && from(platform)) || from(userAgent) || 'mac';
}

/** localStorage key of the install record (no "strom-research" prefix: it is not the research's own state). */
export const INSTALL_KEY = 'strom-install';
/** The token holds this long: installing, git on a Mac and the research's wizard take time. */
export const INSTALL_TTL_MS = 24 * 60 * 60 * 1000;
/** After this long the waiting step says more (git on a Mac, an error in the terminal). */
export const INSTALL_LONG_MS = 15 * 60 * 1000;

/** The installation under way: the token in the line, the tree it takes over, when. */
export interface InstallRecord {
    token: string;
    /** The tree the research takes over; null from the welcome screen (an empty tree is made then). */
    treeId: TreeId | null;
    os: InstallOs;
    createdAt: string;
    expiresAt: string;
    /** Safari: the transfer file it downloaded for the research (research-transfer.ts), once it did. */
    file?: string;
}

/** A record as stored, or null when it is not one (hand-edited, another version's). */
export function sanitizeInstallRecord(raw: unknown): InstallRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const token = typeof r.token === 'string' ? researchAdoptToken(r.token) : null;
    const os = INSTALL_OSES.includes(r.os as InstallOs) ? r.os as InstallOs : null;
    const created = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : NaN;
    const expires = typeof r.expiresAt === 'string' ? Date.parse(r.expiresAt) : NaN;
    if (!token || !os || !Number.isFinite(created) || !Number.isFinite(expires)) return null;
    const treeId = typeof r.treeId === 'string' && r.treeId ? r.treeId as TreeId : null;
    return {
        token, treeId, os, createdAt: r.createdAt as string, expiresAt: r.expiresAt as string,
        ...(isTransferFileName(r.file) ? { file: r.file } : {}),
    };
}

/** A new record for `token`, now. */
export function newInstallRecord(token: string, treeId: TreeId | null, os: InstallOs, now = Date.now()): InstallRecord {
    return {
        token, treeId, os,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + INSTALL_TTL_MS).toISOString(),
    };
}

export type InstallPhase = 'none' | 'waiting' | 'long' | 'expired';

/** Where an installation stands: waiting, waiting long (15 min), or the token expired. */
export function installPhase(record: InstallRecord | null, now = Date.now()): InstallPhase {
    if (!record) return 'none';
    if (now >= Date.parse(record.expiresAt)) return 'expired';
    return now - Date.parse(record.createdAt) >= INSTALL_LONG_MS ? 'long' : 'waiting';
}

/** The install record, or null (none, unreadable, or storage blocked). */
export function readInstallRecord(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): InstallRecord | null {
    try {
        const text = storage?.getItem(INSTALL_KEY);
        return text ? sanitizeInstallRecord(JSON.parse(text)) : null;
    } catch {
        return null;
    }
}

export function writeInstallRecord(record: InstallRecord, storage: Pick<Storage, 'setItem'> | null = safeLocalStorage()): void {
    try { storage?.setItem(INSTALL_KEY, JSON.stringify(record)); } catch { /* storage blocked: the line still works this session */ }
}

export function clearInstallRecord(storage: Pick<Storage, 'removeItem'> | null = safeLocalStorage()): void {
    try { storage?.removeItem(INSTALL_KEY); } catch { /* nothing to clear */ }
}

function safeLocalStorage(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
