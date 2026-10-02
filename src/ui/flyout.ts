/**
 * Vertical fit of a flyout menu (the ⋯ menu's "Tree:" / "Research", the
 * person menu's "Research ›" / "More ›"): it starts level with its row and
 * is shifted up as far as needed to end inside the window; when even the
 * whole window height is not enough, it scrolls.
 */
export const FLYOUT_MARGIN = 8;

export function fitFlyout(top: number, height: number, viewport: number, margin = FLYOUT_MARGIN): { shift: number; maxHeight: number } {
    const maxHeight = Math.max(120, viewport - 2 * margin);
    const overflow = top + Math.min(height, maxHeight) - (viewport - margin);
    const shift = overflow <= 0 ? 0 : Math.min(overflow, Math.max(0, top - margin));
    return { shift, maxHeight };
}
