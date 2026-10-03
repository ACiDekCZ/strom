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

export type InstallOs = 'mac' | 'win' | 'linux';
export const INSTALL_OSES: readonly InstallOs[] = ['mac', 'win', 'linux'];

/** Where the release's install scripts live. */
export const INSTALL_RELEASE_URL = 'https://github.com/ACiDekCZ/strom-research/releases/latest';
const DOWNLOAD = `${INSTALL_RELEASE_URL}/download`;

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

/** The line for Terminal (macOS, Linux) or Win + R (Windows), with the tree's token (and this app's address, see installAppUrl). */
export function installLine(os: InstallOs, token: string, appUrl: string | null = null): string {
    return os === 'win'
        ? `powershell -ExecutionPolicy Bypass -c "$env:STROM_FROM_APP='${token}'; ${appUrl ? `$env:STROM_APP_URL='${appUrl}'; ` : ''}irm ${DOWNLOAD}/install.ps1 | iex"`
        : `curl -fsSL ${DOWNLOAD}/install.sh | STROM_FROM_APP=${token} ${appUrl ? `STROM_APP_URL=${appUrl} ` : ''}sh`;
}

/** The npm way for technical users: install, then start with the token (and this app's address). */
export function npmLines(os: InstallOs, token: string, appUrl: string | null = null): [string, string] {
    return ['npm i -g strom-research', os === 'win'
        ? `$env:STROM_FROM_APP='${token}'; ${appUrl ? `$env:STROM_APP_URL='${appUrl}'; ` : ''}strom-research`
        : `STROM_FROM_APP=${token} ${appUrl ? `STROM_APP_URL=${appUrl} ` : ''}strom-research`];
}

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
    return { token, treeId, os, createdAt: r.createdAt as string, expiresAt: r.expiresAt as string };
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
