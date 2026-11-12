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
