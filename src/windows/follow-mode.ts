/**
 * "Follow selection" of a satellite (spec 079 K2.1): what another window's
 * choice of a person does here.
 * - `switch`: the window's centre moves to the person (Descendants: their
 *   descendants, Fan: their ancestors, Family: their family), as the card's
 *   Focus does in this window;
 * - `mark`: the person is only marked (the card's ring, the Fan's sectors,
 *   the Timeline's row, the Map's places, the Table's row);
 * - `off`: this window has its own selection (it neither sends nor takes one).
 * The default comes from the view: `switch` where a choice can move the
 * centre (Family, Descendants, Fan), `mark` elsewhere (Timeline, Map, Table).
 * A mode chosen in the header is kept for the window (sessionStorage);
 * choosing the view's default again drops the choice, so the default of
 * another view applies after a switch of views.
 */

import type { SatelliteKind } from './window-role.js';

export type FollowMode = 'switch' | 'mark' | 'off';

const RECENTERING: readonly SatelliteKind[] = ['family', 'descendants', 'fan'];

/** Whether another window's choice can move this view's centre. */
export function viewRecenters(kind: SatelliteKind | string): boolean {
    return (RECENTERING as readonly string[]).includes(kind);
}

/** The mode a view follows the selection with while nothing was chosen in the window. */
export function defaultFollowMode(kind: SatelliteKind): FollowMode {
    return viewRecenters(kind) ? 'switch' : 'mark';
}

/** The modes the header offers in a view (no `switch` where the centre cannot move). */
export function followModesFor(kind: SatelliteKind): readonly FollowMode[] {
    return viewRecenters(kind) ? ['switch', 'mark', 'off'] : ['mark', 'off'];
}

/**
 * The stored choice ('' or anything unknown: none). Before K2.1 the window
 * kept '0' (off) and '1' (on, now the view's default).
 */
export function parseFollowChoice(raw: string | null | undefined): FollowMode | null {
    if (raw === 'switch' || raw === 'mark' || raw === 'off') return raw;
    if (raw === '0') return 'off';
    return null;
}

/** What the window does now: the choice, else the view's default; `switch` is `mark` where the centre cannot move. */
export function effectiveFollowMode(choice: FollowMode | null, kind: SatelliteKind): FollowMode {
    const mode = choice ?? defaultFollowMode(kind);
    return mode === 'switch' && !viewRecenters(kind) ? 'mark' : mode;
}

/** What to store for a mode chosen in a view ('' = no choice: the view's default). */
export function followChoiceToStore(mode: FollowMode, kind: SatelliteKind): string {
    return mode === defaultFollowMode(kind) ? '' : mode;
}

/**
 * What a choice made in this window does in the main window (spec 110 §1,
 * §6): `mark` marks the person there, its centre stays; `focus` makes the
 * person the main window's centre, as its card's Focus does. Until one is
 * chosen, the view decides: a Table focuses, the Timeline and the Map mark. Offered where the window's choice is a person picked in a list (the
 * Table, the Timeline, the Map); a chart (Family, Descendants, Fan) moves its
 * own centre with a choice, so it only marks. Kept for the window
 * (sessionStorage), also while another view shows (it comes back with the
 * Table).
 */
export type SendMode = 'mark' | 'focus';

const SENDING: readonly SatelliteKind[] = ['table', 'timeline', 'map'];

/** Whether the view offers what its choice does in the main window. */
export function sendModeAvailable(kind: SatelliteKind | string): boolean {
    return (SENDING as readonly string[]).includes(kind);
}

/** sessionStorage key of the window's send mode (survives its reload, not other windows). */
export function sendModeKey(windowId: string): string {
    return `strom.win.send.${windowId}`;
}

/** What a choice does in the main window until one is chosen: the Table focuses, the other views mark. */
export function defaultSendMode(kind: SatelliteKind | string): SendMode {
    return kind === 'table' ? 'focus' : 'mark';
}

/** The stored send mode (nothing or anything else: the view's default). */
export function parseSendMode(raw: string | null | undefined, kind: SatelliteKind | string = ''): SendMode {
    return raw === 'focus' || raw === 'mark' ? raw : defaultSendMode(kind);
}

type SendStorage = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

function defaultSendStorage(): SendStorage {
    try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** The send mode chosen in the window, whatever view shows now (none chosen: the default of the view `kind`). */
export function getSendModeChoice(windowId: string, kind: SatelliteKind | string, storage: SendStorage = defaultSendStorage()): SendMode {
    try { return parseSendMode(storage?.getItem(sendModeKey(windowId)), kind); } catch { return defaultSendMode(kind); }
}

/** What a choice in the view does in the main window now: the choice where the view offers it, else `mark`. */
export function getSendMode(windowId: string, kind: SatelliteKind | string, storage: SendStorage = defaultSendStorage()): SendMode {
    return sendModeAvailable(kind) ? getSendModeChoice(windowId, kind, storage) : 'mark';
}

/** Keep the window's send mode (both kept as chosen: `mark` in a Table is not its default). */
export function setSendMode(windowId: string, mode: SendMode, storage: SendStorage = defaultSendStorage()): void {
    try { storage?.setItem(sendModeKey(windowId), mode === 'focus' ? 'focus' : 'mark'); } catch { /* no storage */ }
}
