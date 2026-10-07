/**
 * Line style of a parent→child connection from the children's parent-rel
 * types — shared by the on-screen renderer and the poster export.
 *
 * Adoptive = dashed, step/foster = dotted; colour and geometry never change.
 * The drop to a non-biological child takes that dash. When EVERY child on a
 * bus is non-biological, the whole connection (stem, connector, bus) is
 * dashed too, so an only adopted child gets one dashed line rather than a
 * solid stem with a dashed tail. With biological siblings the shared part
 * stays solid and only the non-biological drops are dashed.
 */

import { Person, ParentChildRelType } from './types.js';

export const ADOPTIVE_DASH = '6,4';
export const STEP_DASH = '2,3';

/** The non-biological kind a child's drop shows, or null for a biological child. */
export function parentRelKind(child: Pick<Person, 'parentRelTypes'> | undefined): ParentChildRelType | null {
    const types = child?.parentRelTypes ? Object.values(child.parentRelTypes) : [];
    if (types.includes('adoptive')) return 'adoptive';
    if (types.includes('foster')) return 'foster';
    if (types.includes('step')) return 'step';
    return null;
}

/** Dash of the drop to a child of this kind (undefined = solid). */
export function parentRelDash(kind: ParentChildRelType | null): string | undefined {
    if (kind === 'adoptive') return ADOPTIVE_DASH;
    if (kind === 'step' || kind === 'foster') return STEP_DASH;
    return undefined;
}

/**
 * Dash of a connection's shared part (stem, connector, bus) given the kinds
 * of its children: solid unless every child is non-biological. Children of
 * one dash share it; a mix of adoptive and step/foster children is dashed
 * like an adoption.
 */
export function connectionDash(kinds: readonly (ParentChildRelType | null)[]): string | undefined {
    if (kinds.length === 0) return undefined;
    const dashes = kinds.map(parentRelDash);
    if (dashes.some(d => d === undefined)) return undefined;
    return dashes.every(d => d === dashes[0]) ? dashes[0] : ADOPTIVE_DASH;
}
