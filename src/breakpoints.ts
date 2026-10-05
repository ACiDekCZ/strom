/**
 * Responsive breakpoints — the single source of truth for JS, mirrored by the
 * breakpoint map at the top of the stylesheet in index.html.
 *
 *   mobile   width ≤ 640px           @media (max-width: 640px)
 *   tablet   641px ≤ width ≤ 1024px  @media (min-width: 641px) and (max-width: 1024px)
 *   desktop  width ≥ 1025px          @media (min-width: 1025px)
 *
 * "Tablet and below" is @media (max-width: 1024px): the bottom bar and the
 * inline tablet toolbar. Mobile is the phone chrome: the phone top bar, the
 * person row, the dissolved zoom/minimap block. A phone held sideways
 * (MQ_PHONE_LANDSCAPE) keeps the phone top bar in its own layout.
 */

/** Largest viewport width (CSS px) still treated as mobile. */
export const MOBILE_MAX = 640;
/** Largest viewport width (CSS px) still treated as tablet. */
export const TABLET_MAX = 1024;

export const MQ_MOBILE = `(max-width: ${MOBILE_MAX}px)`;
export const MQ_TABLET = `(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`;
export const MQ_TABLET_DOWN = `(max-width: ${TABLET_MAX}px)`;
export const MQ_DESKTOP = `(min-width: ${TABLET_MAX + 1}px)`;

function matches(query: string, test: (w: number) => boolean): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') return window.matchMedia(query).matches;
    return test(window.innerWidth);
}

/** Viewport is in the mobile band (≤ 640px): the phone chrome. */
export function isMobile(): boolean {
    return matches(MQ_MOBILE, (w) => w <= MOBILE_MAX);
}

/** Viewport is in the tablet band (641–1024px). */
export function isTablet(): boolean {
    return matches(MQ_TABLET, (w) => w > MOBILE_MAX && w <= TABLET_MAX);
}

/** Viewport is tablet or mobile (≤ 1024px): the bottom bar and the compact toolbar. */
export function isTabletOrMobile(): boolean {
    return matches(MQ_TABLET_DOWN, (w) => w <= TABLET_MAX);
}

/** Viewport is in the desktop band (≥ 1025px). */
export function isDesktop(): boolean {
    return !isTabletOrMobile();
}

/** A phone held sideways: the side bar and the one 44px header. */
export const MQ_PHONE_LANDSCAPE = `(max-width: ${TABLET_MAX}px) and (max-height: 500px) and (orientation: landscape)`;
/** The phone top bar (icon · tree name · magnifier): a phone either way up. */
export const MQ_PHONE_BAR = `${MQ_MOBILE}, ${MQ_PHONE_LANDSCAPE}`;

/** The phone top bar is in use (≤ 640px, or a phone sideways). */
export function isPhoneBar(): boolean {
    return matches(MQ_PHONE_BAR, (w) => w <= MOBILE_MAX);
}
