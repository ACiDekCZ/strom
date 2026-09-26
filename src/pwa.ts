/**
 * Progressive Web App wiring: register the service worker (only on the hosted
 * PWA), surface updates through a callback, and expose the registration gate as
 * a pure function for testing. The service worker itself lives in the WEB repo
 * (strom-app-info: /run/sw.js, and /beta/sw.js for the test build) — this file only registers it and drives the
 * update handshake. Data (IndexedDB) is never touched by the SW.
 */

import { AppMode, BETA_HOSTNAME } from './types.js';

/**
 * The hosted app's base path: the public app lives at /run/, the pre-release
 * test build at /beta/ (same origin, its own worker, cache and manifest).
 * Pure for testing.
 */
export function pwaBasePath(pathname: string): '/run/' | '/beta/' {
    return pathname === '/beta' || pathname.startsWith('/beta/') ? '/beta/' : '/run/';
}

/**
 * True for the pre-release test build: the beta site (beta.stromapp.info) or
 * /beta/ on the hosted site. Pure for testing.
 */
export function isBetaLocation(hostname: string, pathname: string): boolean {
    return hostname === BETA_HOSTNAME || pwaBasePath(pathname) === '/beta/';
}

/** True when this page is the pre-release test build. */
export function isBetaBuild(mode: AppMode): boolean {
    return mode === 'pwa' && typeof location !== 'undefined' && isBetaLocation(location.hostname, location.pathname);
}

/** Where the hosted PWA serves its service worker (web repo, scope = base path). */
function swUrl(): string {
    return `${pwaBasePath(location.pathname)}sw.js`;
}

/**
 * Register the service worker only for the hosted PWA. In embedded (exported
 * single-file), file:// and dev modes there is no SW to serve, so registering
 * would 404 (or, worse, cache a file:// shell) — never do it there.
 */
export function shouldRegisterServiceWorker(mode: AppMode): boolean {
    return mode === 'pwa';
}

/**
 * Register the SW and wire the update handshake. `onUpdateReady` fires when a new
 * version has installed and is waiting — the UI shows a "refresh" prompt, and
 * applyServiceWorkerUpdate() activates it. The page reloads once the new worker
 * takes control (controllerchange), so the user lands on the fresh build.
 */
export function registerServiceWorker(onUpdateReady: () => void): void {
    if (!('serviceWorker' in navigator)) return;

    // The worker calls clients.claim() on activate, so on the FIRST visit
    // controllerchange fires once as it takes control — that must not reload.
    // Only an update that replaces an existing controller should reload.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing || !hadController) return;
        refreshing = true;
        location.reload();
    });

    navigator.serviceWorker.register(swUrl()).then((reg) => {
        // If one is already waiting (installed between visits), prompt now.
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady();

        reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                // A new worker is installed AND an old one controls the page →
                // this is an update (not the first install), so offer to refresh.
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    onUpdateReady();
                }
            });
        });
    }).catch(() => { /* offline / no SW served — silently ignore */ });
}

/**
 * Link the web app manifest so the hosted PWA is installable. Done at runtime
 * (PWA mode only) so the exported single-file build never points at /run/.
 */
export function linkManifest(): void {
    if (typeof document === 'undefined' || document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `${pwaBasePath(location.pathname)}manifest.json`;
    document.head.appendChild(link);
    // iOS takes the home-screen icon from here, not from the manifest.
    const touch = document.createElement('link');
    touch.rel = 'apple-touch-icon';
    touch.href = `${pwaBasePath(location.pathname)}icons/apple-touch-icon.png`;
    document.head.appendChild(touch);
}

/** Tell the waiting worker to activate; controllerchange then reloads the page. */
export function applyServiceWorkerUpdate(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    }).catch(() => {});
}

// ---- Install offer (Chromium: beforeinstallprompt) ----

interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;

/** Window event: whether the app can be installed changed. */
export const INSTALL_AVAILABILITY_EVENT = 'strom:install-availability';

/**
 * Keep the browser's install offer so the storage advice can show its own
 * "Install" button. The browser's own entry points (address bar, menu) stay.
 */
export function captureInstallPrompt(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        installPrompt = e as InstallPromptEvent;
        window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
    });
}

/** The browser offers to install the app right now. */
export function canPromptInstall(): boolean {
    return installPrompt !== null;
}

/** Show the browser's install dialog; true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
    const offer = installPrompt;
    if (!offer) return false;
    installPrompt = null;   // an offer can be shown once
    try {
        await offer.prompt();
        const choice = await offer.userChoice;
        return choice.outcome === 'accepted';
    } catch {
        return false;
    } finally {
        window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
    }
}

/** Running as the installed app (home screen, dock, app window). */
export function isStandaloneDisplay(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
        if (window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true;
    } catch { /* no matchMedia */ }
    return (navigator as { standalone?: boolean }).standalone === true;
}
