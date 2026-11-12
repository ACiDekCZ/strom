/**
 * Full screen from the More sheet (spec 082 K1.3, T48): the browser's bars
 * (and Android's navigation) give the tree their room. Offered only in the
 * bottom-bar regime; where the browser cannot (Safari on an iPhone) the row
 * explains Add to Home Screen instead, and an app already on the Home Screen
 * has no row at all.
 */
import { isStandaloneDisplay } from '../pwa.js';
import { isIosDevice } from '../file-copy.js';

/** What the More sheet offers: the switch, the iPhone's hint, or nothing. */
export type FullscreenOffer = 'enter' | 'exit' | 'ios-hint' | null;

export interface FullscreenEnv {
    /** document.fullscreenEnabled */
    enabled: boolean;
    /** document.fullscreenElement is set */
    active: boolean;
    /** an iPhone, iPad or iPod */
    ios: boolean;
    /** running from the Home Screen / as an installed app */
    standalone: boolean;
}

/** The row for an environment (pure, tested). */
export function fullscreenOffer(env: FullscreenEnv): FullscreenOffer {
    if (env.enabled) return env.active ? 'exit' : 'enter';
    if (env.ios && !env.standalone) return 'ios-hint';
    return null;
}

/** The row for this browser now. */
export function currentFullscreenOffer(): FullscreenOffer {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return null;
    return fullscreenOffer({
        enabled: document.fullscreenEnabled === true,
        active: !!document.fullscreenElement,
        ios: isIosDevice(navigator.userAgent || '', navigator.platform || '', navigator.maxTouchPoints ?? 0),
        standalone: isStandaloneDisplay(),
    });
}

/** Turn full screen on or off (a refusal of the browser leaves the window as it is). */
export function toggleFullscreen(): void {
    if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => { /* already left */ });
    } else {
        void document.documentElement.requestFullscreen?.().catch(() => { /* not allowed: stays windowed */ });
    }
}
