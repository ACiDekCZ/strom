/**
 * Progressive Web App wiring: register the service worker (only on the hosted
 * PWA), surface updates through a callback, and expose the registration gate as
 * a pure function for testing. The service worker itself lives in the WEB repo
 * (strom-app-info: /run/sw.js) — this file only registers it and drives the
 * update handshake. Data (IndexedDB) is never touched by the SW.
 */

import { AppMode } from './types.js';

/** Where the hosted PWA serves its service worker (web repo, scope /run/). */
const SW_URL = '/run/sw.js';

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

    navigator.serviceWorker.register(SW_URL).then((reg) => {
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
    link.href = '/run/manifest.json';
    document.head.appendChild(link);
}

/** Tell the waiting worker to activate; controllerchange then reloads the page. */
export function applyServiceWorkerUpdate(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    }).catch(() => {});
}
