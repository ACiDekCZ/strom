/**
 * Responsive breakpoints — the single source of truth for JS, mirrored by the
 * breakpoint map at the top of the stylesheet in index.html.
 *
 *   mobile   width ≤ 499px          @media (max-width: 499px)
 *   tablet   500px ≤ width ≤ 900px  @media (min-width: 500px) and (max-width: 900px)
 *   desktop  width ≥ 901px          @media (min-width: 901px)
 *
 * "Tablet and below" is @media (max-width: 900px).
 *
 * Content-driven exception: the toolbar regime (bottom bar, inline tablet
 * toolbar) switches at TOOLBAR_COMPACT_MAX because the desktop toolbar does not
 * fit below it; the phone chrome (top bar, focus chip, zoom stack) likewise
 * extends to PHONE_CHROME_MAX — see the breakpoint map comment in index.html.
 */

/** Largest viewport width (CSS px) still treated as mobile. */
export const MOBILE_MAX = 499;
/** Largest viewport width (CSS px) still treated as tablet. */
export const TABLET_MAX = 900;
/** Largest viewport width (CSS px) that uses the compact toolbar + bottom bar. */
export const TOOLBAR_COMPACT_MAX = 1024;
/**
 * Largest viewport width (CSS px) that uses the phone chrome (phone top bar,
 * floating focus chip, dissolved zoom/minimap block): the inline tablet
 * toolbar does not fit below it.
 */
export const PHONE_CHROME_MAX = 640;

export const MQ_PHONE_CHROME = `(max-width: ${PHONE_CHROME_MAX}px)`;

export const MQ_MOBILE = `(max-width: ${MOBILE_MAX}px)`;
export const MQ_TABLET = `(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`;
export const MQ_TABLET_DOWN = `(max-width: ${TABLET_MAX}px)`;
export const MQ_DESKTOP = `(min-width: ${TABLET_MAX + 1}px)`;

function matches(query: string, test: (w: number) => boolean): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') return window.matchMedia(query).matches;
    return test(window.innerWidth);
}

/** Viewport is in the mobile band (≤ 499px). */
export function isMobile(): boolean {
    return matches(MQ_MOBILE, (w) => w <= MOBILE_MAX);
}

/** Viewport is in the tablet band (500–900px). */
export function isTablet(): boolean {
    return matches(MQ_TABLET, (w) => w > MOBILE_MAX && w <= TABLET_MAX);
}

/** Viewport is tablet or mobile (≤ 900px). */
export function isTabletOrMobile(): boolean {
    return matches(MQ_TABLET_DOWN, (w) => w <= TABLET_MAX);
}

/** Viewport is in the desktop band (≥ 901px). */
export function isDesktop(): boolean {
    return !isTabletOrMobile();
}

/** Viewport uses the phone chrome (≤ PHONE_CHROME_MAX): no minimap, focus chip. */
export function isPhoneChrome(): boolean {
    return matches(MQ_PHONE_CHROME, (w) => w <= PHONE_CHROME_MAX);
}

export const MQ_TOOLBAR_COMPACT = `(max-width: ${TOOLBAR_COMPACT_MAX}px)`;

/** Viewport uses the compact toolbar + bottom navigation (≤ TOOLBAR_COMPACT_MAX). */
export function isToolbarCompact(): boolean {
    return matches(MQ_TOOLBAR_COMPACT, (w) => w <= TOOLBAR_COMPACT_MAX);
}
