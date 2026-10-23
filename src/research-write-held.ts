/**
 * Writes the research turns down until something there is settled (spec 017
 * U7): the tree sealed on another computer (409 `seal.foreign`), files of its
 * cloud folder not downloaded yet (409 `tree.not-downloaded`), its disk full
 * (507 `disk.full`). Nothing of it is ever sent again by itself: the edits
 * wait here, unsent, until the user sends; the research's own sentence says
 * what to do there. Read only from a bridge that names the capability in
 * `/status.features`; without it a code like that is an ordinary refusal.
 */

import type { ResearchWriteHeld } from './types.js';
import { DISK_FULL_FEATURE, LiveStatus, NOT_DOWNLOADED_FEATURE, SEAL_FOREIGN_FEATURE } from './research-link.js';

export type { ResearchWriteHeld };

/** The refusal codes and their kind. */
const HELD_CODES: Record<string, ResearchWriteHeld['kind']> = {
    'seal.foreign': 'seal',
    'tree.not-downloaded': 'cloud',
    'disk.full': 'disk',
};

/** The capability that announces a kind (read at call time: the modules import each other). */
function heldFeature(kind: ResearchWriteHeld['kind']): string {
    return kind === 'seal' ? SEAL_FOREIGN_FEATURE : kind === 'cloud' ? NOT_DOWNLOADED_FEATURE : DISK_FULL_FEATURE;
}

/** Longest sentence of the research kept. */
const MAX_SAID = 400;

/** A refusal's code is one of those (whatever the bridge announced). */
export function isWriteHeldCode(code: unknown): boolean {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(HELD_CODES, code);
}

/**
 * A refusal of a write (`{error, code, params}`), as a held write — only
 * from a bridge whose `features` name its capability. Untrusted: the
 * sentence is cleaned, the count checked. Null: another refusal.
 */
export function writeHeldOfRefusal(code: unknown, error: unknown, features: readonly string[] | null | undefined, params?: unknown): ResearchWriteHeld | null {
    if (!isWriteHeldCode(code) || !features?.includes(heldFeature(HELD_CODES[code as string]))) return null;
    return writeHeldOfCode(code, error, params);
}

/**
 * The same, whatever the bridge announced: for a write that would otherwise
 * be tried again by itself (a file of the queue, a batch), a code like that
 * always stops it. Null: another refusal.
 */
export function writeHeldOfCode(code: unknown, error: unknown, params?: unknown): ResearchWriteHeld | null {
    if (!isWriteHeldCode(code)) return null;
    const kind = HELD_CODES[code as string];
    const said = typeof error === 'string' ? error.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_SAID) : '';
    const p = params && typeof params === 'object' ? params as Record<string, unknown> : null;
    const n = typeof p?.n === 'number' && Number.isInteger(p.n) && p.n > 0 && p.n < 1e9 ? p.n : undefined;
    return { kind, said, ...(kind === 'cloud' && n ? { n } : {}) };
}

/**
 * What the research's status says before anything is sent: the tree sealed
 * on another computer, or files not downloaded yet (each read only with its
 * capability, see sanitizeLiveStatus). Null: writes go.
 */
export function writeHeldOfStatus(status: Pick<LiveStatus, 'seal' | 'notDownloaded'> | null | undefined): ResearchWriteHeld | null {
    if (!status) return null;
    if (status.seal === 'elsewhere') return { kind: 'seal', said: '' };
    if ((status.notDownloaded ?? 0) > 0) return { kind: 'cloud', said: '', n: status.notDownloaded };
    return null;
}

/** Two sentences as one text (a full stop between them unless the first has one). */
export function joinSaid(first: string, second: string): string {
    const a = first.trim();
    if (!a) return second;
    return /[.!?…:]$/.test(a) ? `${a} ${second}` : `${a}. ${second}`;
}
