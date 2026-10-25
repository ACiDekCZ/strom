/**
 * A tap on a person card by touch is the card's (GitHub #4).
 *
 * The browser moves a finger's tap onto the nearest button within the
 * finger's area (touch adjustment). The pills on a card's edges (branch tabs,
 * line links, ∞ other partners, ⇄) are buttons inside the card,
 * and a card holding such a button never counts as a target of its own: a tap
 * on the card a few pixels from a pill went to the pill. Zoomed out the whole
 * card lies within the finger's area, so a tap in its middle hid the children
 * shown there or set the focus instead of opening the person's sheet.
 *
 * Here the point the finger touched decides. A touch click the browser gave
 * to an edge pill while the finger stood on a card goes to what is under the
 * finger, as a tap there would: the card, or another pill. From 60 % zoom
 * the pill keeps:
 * - the finger on the pill itself;
 * - the finger off the cards: the half of the pill standing out of the card
 *   and the finger-sized area the browser gives it around.
 * Below 60 % the whole pill is its card's (round 5 §37): the part standing
 * out of the card and the area around it too, a tap there opens the
 * person's menu as a tap on the card does (a long press too, pillUnderFinger);
 * a finger on another card is that card's.
 */

import { ZoomPan } from './zoom.js';

/** An edge pill on a card of the tree. */
const PILL_SELECTOR = '#tree-canvas .person-card .card-edge > *';
/** From this scale on a pill takes the taps on its part over the card. */
const PILL_OVER_CARD_MIN_SCALE = 0.6;
/** A click this long after the finger came down is not that tap's. */
const TAP_CLICK_MS = 1500;

let lastTouch: { x: number; y: number; at: number } | null = null;

export function installCardTapTarget(): void {
    document.addEventListener('pointerdown', (e) => {
        lastTouch = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    }, true);
    document.addEventListener('click', onClick, true);
}

/**
 * The element a tap at (x, y) is for, when it is not the given pill: on a
 * card, else null (the pill's). Zoomed out below 60 % never the pill: the
 * card under the finger, else the pill's own card.
 */
function cardTargetAt(pill: Element, x: number, y: number): Element | null {
    const pillsTakeCard = ZoomPan.getScale() >= PILL_OVER_CARD_MIN_SCALE;
    for (const el of document.elementsFromPoint(x, y)) {
        const inPill = el.closest('.card-edge > *');
        if (inPill && !pillsTakeCard) continue;          // zoomed out: the card under the pill
        if (inPill === pill) return null;                // the finger on the pill itself
        if (el.closest('#tree-canvas .person-card')) return el;
        break;
    }
    return pillsTakeCard ? null : pill.closest('#tree-canvas .person-card');
}

/**
 * Whether the person menu opening now offers the card's line-link jumps
 * ("↗ Go to …", round 6 §40): it opens from a touch (a tap or a long press
 * just now) zoomed out below 60 %, where the card's jump tabs are the
 * card's and do not jump. With a mouse, a pen or the keyboard the tabs
 * jump at any zoom.
 */
export function menuOffersLineJumps(): boolean {
    return !!lastTouch && performance.now() - lastTouch.at <= TAP_CLICK_MS
        && ZoomPan.getScale() < PILL_OVER_CARD_MIN_SCALE;
}

/**
 * The edge pill a long press at (x, y) is for (its bubble opens): the finger
 * on the pill itself from 60 % zoom; else null, the press is the card's (the
 * person's menu). Below 60 % a long press is the card's wherever on its
 * pills the finger stands (round 4 §31, round 5 §37), as a tap there is:
 * no bubble opens.
 */
export function pillUnderFinger(x: number, y: number): HTMLElement | null {
    if (ZoomPan.getScale() < PILL_OVER_CARD_MIN_SCALE) return null;
    const top = document.elementFromPoint(x, y);
    if (!top || top.closest('.badge-tooltip')) return null;
    return top.closest<HTMLElement>(PILL_SELECTOR);
}

function onClick(e: MouseEvent): void {
    const touch = lastTouch;
    if (!touch || !e.isTrusted || performance.now() - touch.at > TAP_CLICK_MS) return;
    const pointerType = (e as PointerEvent).pointerType;
    if (pointerType === 'mouse' || pointerType === 'pen') return;
    // A tap in an open bubble (a long press opened it over the tree) is the bubble's
    if ((e.target as Element | null)?.closest?.('.badge-tooltip')) return;
    const pill = (e.target as Element | null)?.closest?.(PILL_SELECTOR);
    if (!pill) return;
    const target = cardTargetAt(pill, touch.x, touch.y);
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    target.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, composed: true, view: window, detail: 1,
        clientX: touch.x, clientY: touch.y,
    }));
}
