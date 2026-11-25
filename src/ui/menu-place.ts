/**
 * Where a popup menu goes vertically by its button: under it when it fits
 * there, over it when it fits there, otherwise on the side with more room,
 * as high as that room (the menu scrolls inside). With little room on either
 * side the menu takes the window's height, over its button if need be.
 */

export interface MenuPlace {
    /** The menu's top in the viewport (px). */
    top: number;
    /** Its height limit when it does not fit whole (px), else null. */
    maxHeight: number | null;
}

/** Below this room a side is too small to choose from (about 5 rows). */
export const MENU_MIN_ROOM = 200;

export function placeMenuVertically(
    anchor: { top: number; bottom: number },
    height: number,
    viewHeight: number,
    gap = 4,
    margin = 8,
): MenuPlace {
    const below = viewHeight - margin - (anchor.bottom + gap);
    const above = anchor.top - gap - margin;
    if (height <= below) return { top: anchor.bottom + gap, maxHeight: null };
    if (height <= above) return { top: anchor.top - gap - height, maxHeight: null };
    const best = Math.max(below, above);
    if (best >= MENU_MIN_ROOM) {
        return below >= above
            ? { top: anchor.bottom + gap, maxHeight: below }
            : { top: margin, maxHeight: above };
    }
    // Little room on either side: the whole window, from its bottom up.
    const fit = Math.min(height, viewHeight - 2 * margin);
    return { top: Math.max(margin, viewHeight - margin - fit), maxHeight: height > fit ? fit : null };
}
