/**
 * Small pure rules of the map's bubbles (src/ui/map-ui.ts): the kind marks in
 * front of a name and the house-number search of a town point.
 */

import { MapKind, MAP_KINDS } from './places.js';
import { foldText } from './streets.js';

/** The mark of each map kind, shown in front of a person's name. */
export const KIND_MARK: Readonly<Record<MapKind, string>> = { birth: '*', death: '†', wedding: '⚭', event: '•' };

/**
 * The marks of a person's kinds at a place, in the map's order ("* †" for
 * born and died there); with `enabled`, only the kinds switched on.
 */
export function kindMarks(kinds: ReadonlySet<MapKind>, enabled?: ReadonlySet<MapKind>): string {
    return MAP_KINDS.filter(k => kinds.has(k) && (!enabled || enabled.has(k))).map(k => KIND_MARK[k]).join(' ');
}

/**
 * Whether a house matches the bubble's search: the query (folded: no case, no
 * accents) starts the house's text or one of its words — "1" finds "16",
 * "čp. 12" and "Kopřivná 14", "kop" finds "Kopřivná 12". An empty query
 * matches every house.
 */
export function houseMatches(house: string, query: string): boolean {
    const q = foldText(query).trim();
    if (!q) return true;
    const text = foldText(house).replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.startsWith(q) || text.includes(` ${q}`);
}
