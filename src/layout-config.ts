/**
 * Strom - layout configuration values: card sizes and spacing presets.
 */

import type { CardPhotoSize, LayoutConfig, PersonId, TreeSpacing } from './types.js';

/** The partner line's distance from the card's top: the set offset, else the card's middle. */
export function spouseLineOffset(config: Pick<LayoutConfig, 'cardHeight' | 'spouseLineY'>): number {
    return config.spouseLineY ?? config.cardHeight / 2;
}

/** The height of one person's card: its own (personHeights), else cardHeight. */
export function personCardHeight(config: Pick<LayoutConfig, 'cardHeight' | 'personHeights'>, personId: PersonId): number {
    return config.personHeights?.get(personId) ?? config.cardHeight;
}

/**
 * Card box per fixed density. Keys match LayoutConfig on purpose so the values can be
 * spread straight into it — with `width`/`height` names the spread silently did
 * nothing and the engine kept spacing for the default card.
 * MUST match the CSS for .person-card at each density.
 */
export const CARD_SIZE: Record<'compact' | 'normal', Pick<LayoutConfig, 'cardWidth' | 'cardHeight'>> = {
    // "Letopis" card: a 34px avatar + a two-row text column (name + meta).
    // compact drops the avatar and meta (names only), so it is shorter and
    // narrower. MUST match the CSS for .person-card at each density.
    compact: { cardWidth: 150, cardHeight: 44 },
    normal: { cardWidth: 188, cardHeight: 64 },
};

/**
 * The Normal card's box per photo size of the view (spec 096 §2): the card's
 * width and base height, the avatar's size and the card's side padding on a
 * card with an avatar, a photo or the initials alike (spec 103 K2.1). A view
 * takes the medium or large box only when someone drawn in it has an avatar
 * (renderer.ts viewHasAvatar), else the small one, which is CARD_SIZE.normal.
 * The text column beside the avatar is 126px in every size (src/card-width.ts
 * normalCardTextWidth). A large card with an avatar is 96px tall through
 * LayoutConfig.personHeights (the view's cardHeight stays 64; a placeholder
 * 64). MUST match index.html body[data-card-photo].
 */
export const NORMAL_PHOTO_BOX: Record<CardPhotoSize, { cardWidth: number; cardHeight: number; avatar: number; padX: number }> = {
    small: { cardWidth: 188, cardHeight: 64, avatar: 34, padX: 9 },
    medium: { cardWidth: 200, cardHeight: 64, avatar: 48, padX: 8 },
    large: { cardWidth: 236, cardHeight: 96, avatar: 80, padX: 10 },
};

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    cardWidth: 188,
    cardHeight: 64,
    horizontalGap: 31,
    verticalGap: 80,
    // Kept comfortably above horizontalGap/2 (the overlap-check minGap): the
    // +16 horizontalGap bump for the 188px card pushed minGap to 15.5. Couples
    // sit partnerGap apart and V-fan ancestor trees lean to ~partnerGap-1.5 at
    // their inner leaves, so 18 keeps every partner/inner-leaf pair a real,
    // valid distance apart.
    partnerGap: 18,
    padding: 50,
    minEdgeClearance: 14
};

/**
 * The dense spacing: the same cards, smaller gaps. Everything derived from
 * the gaps (couple and chain widths, generation bands, the bus in the middle
 * of a gap) follows by itself; `dense` caps the bus lanes (step 7).
 */
export const DENSE_LAYOUT_CONFIG: LayoutConfig = {
    ...DEFAULT_LAYOUT_CONFIG,
    horizontalGap: 20,
    verticalGap: 48,
    partnerGap: 14,
    dense: true,
};

/** The layout configuration of a spacing (card size still to be spread over it). */
export function layoutConfigFor(spacing: TreeSpacing): LayoutConfig {
    return spacing === 'dense' ? DENSE_LAYOUT_CONFIG : DEFAULT_LAYOUT_CONFIG;
}
