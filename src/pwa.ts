/**
 * Progressive Web App wiring: register the service worker (only on the hosted
 * PWA), surface updates through a callback, and expose the registration gate as
 * a pure function for testing. The service worker itself lives in the WEB repo
 * (strom-app-info: /run/sw.js, and /beta/sw.js for the test build) — this file only registers it and drives the
 * update handshake. Data (IndexedDB) is never touched by the SW.
 */

import { AppMode, BETA_HOSTNAME } from './types.js';
import { detectAppBrowser } from './research-transfer.js';
import { isIosDevice } from './file-copy.js';

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
    // Opened by Strom Research (?import-url= / ?live= / ?send=): an older
    // build may not know the request. Captured now — the address is cleaned
    // once the request is read — so the reload can carry it to the new build.
    researchRequest = /[?&](import-url|live|send)=/.test(location.search) ? location.href : null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) reloadForUpdate();
    });

    navigator.serviceWorker.register(swUrl()).then((reg) => {
        registration = reg;
        // If one is already waiting (installed between visits): a research
        // request switches to it right away (the new build handles it), else
        // the user is offered the refresh.
        if (reg.waiting && navigator.serviceWorker.controller && researchRequest) {
            activateWaiting([reg.waiting], reloadForUpdate);
            return;
        }
        watchForUpdate(reg, () => !!navigator.serviceWorker.controller, onUpdateReady);
        // A tab left open finds a newer build when it is looked at again (the
        // browser itself checks only on a navigation), at most every 30 minutes.
        let checkedAt = Date.now();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || Date.now() - checkedAt < UPDATE_CHECK_MS) return;
            checkedAt = Date.now();
            reg.update().catch(() => { /* offline */ });
        });
    }).catch(() => { /* offline / no SW served — silently ignore */ });
}

/** How often a tab looked at again asks for a newer build. */
const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * Offer the refresh once a new worker waits while an old one controls the
 * page (an update, not the first install): one waiting already, one still
 * installing when the registration resolved (its `updatefound` may have
 * fired before anyone listened — the prompt never came, finding 34), or one
 * found later.
 */
export function watchForUpdate(
    reg: Pick<ServiceWorkerRegistration, 'waiting' | 'installing' | 'addEventListener'>,
    controlled: () => boolean,
    onUpdateReady: () => void,
): void {
    let told = false;
    const tell = (): void => {
        if (told || !controlled()) return;
        told = true;
        onUpdateReady();
    };
    const watch = (worker: ServiceWorker | null): void => {
        if (!worker) return;
        if (worker.state === 'installed') { tell(); return; }
        worker.addEventListener('statechange', () => { if (worker.state === 'installed') tell(); });
    };
    if (reg.waiting) tell();
    else watch(reg.installing);
    reg.addEventListener('updatefound', () => { told = false; watch(reg.installing); });
}

let registration: ServiceWorkerRegistration | null = null;
let researchRequest: string | null = null;
let refreshing = false;

/** Reload once onto the new build (carrying a research request, if any). */
function reloadForUpdate(): void {
    if (refreshing) return;
    refreshing = true;
    if (researchRequest) location.replace(researchRequest);
    else location.reload();
}

/** How often, and how many times, SKIP_WAITING goes again to a worker still waiting. */
export const SKIP_WAITING_RETRY_MS = 2000;
const SKIP_WAITING_TRIES = 3;

/**
 * Ask the waiting worker(s) to activate and reload once one has. The page
 * reloads on controllerchange already; the worker's own 'activated' is a
 * second way there, for a page the new worker does not claim. A worker that
 * is still waiting gets the message again a few times.
 */
function activateWaiting(workers: ServiceWorker[], reload: () => void): void {
    for (const worker of workers) {
        worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') reload();
        });
        let tries = 0;
        const ask = () => {
            if (worker.state !== 'installed') return;
            worker.postMessage({ type: 'SKIP_WAITING' });
            if (++tries < SKIP_WAITING_TRIES) setTimeout(ask, SKIP_WAITING_RETRY_MS);
        };
        ask();
    }
}

/**
 * The waiting workers this page could switch to: the one its own
 * registration holds, and any its scope's registration holds (looked up
 * afresh — the kept registration may be stale).
 */
export async function findWaitingWorkers(
    kept: ServiceWorkerRegistration | null, container: ServiceWorkerContainer, scope: string,
): Promise<ServiceWorker[]> {
    const regs = [kept];
    try { regs.push(await container.getRegistration(scope) ?? null); } catch { /* none */ }
    try { regs.push(...await container.getRegistrations()); } catch { /* none */ }
    const found: ServiceWorker[] = [];
    for (const reg of regs) {
        const waiting = reg?.waiting;
        if (waiting && !found.includes(waiting) && reg.scope.endsWith(scope)) found.push(waiting);
    }
    return found;
}

/**
 * The "Refresh" button of the update prompt: activate the waiting worker,
 * the page then reloads onto the new build. With none waiting any more, a
 * newer worker may already be active (another window switched) — reload onto
 * it; otherwise look for the update once more.
 */
export async function applyServiceWorkerUpdate(
    container: ServiceWorkerContainer | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    reload: () => void = reloadForUpdate,
): Promise<void> {
    if (!container) return;
    const scope = typeof location !== 'undefined' ? pwaBasePath(location.pathname) : '/run/';
    // The worker the page knows is asked at once, before any lookup: a slow
    // getRegistrations() made the first click look as if nothing happened.
    const first = registration?.waiting ?? null;
    if (first) activateWaiting([first], reload);
    const waiting = (await findWaitingWorkers(registration, container, scope)).filter(w => w !== first);
    if (waiting.length) { activateWaiting(waiting, reload); return; }
    if (first) return;
    const reg = registration ?? await container.getRegistration(scope).catch(() => undefined) ?? null;
    if (!reg) return;
    if (reg.active && container.controller && reg.active !== container.controller) { reload(); return; }
    try { await reg.update(); } catch { return; }
    if (reg.waiting) { activateWaiting([reg.waiting], reload); return; }
    const installing = reg.installing;
    installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') activateWaiting([installing], reload);
    });
}

/** For tests: forget the registration kept by registerServiceWorker. */
export function resetServiceWorkerState(): void {
    registration = null;
    refreshing = false;
}

/**
 * Safari on a computer (Add to Dock): its app gets a name and icon of its own
 * ("Strom (Safari)", muted), so it is never taken for the Strom installed from
 * Chrome or Edge — it cannot reach the research and keeps storage apart from
 * any browser. An iPhone or iPad (Add to Home Screen) stays "Strom": no
 * research there to tell apart from.
 */
export function isSafariOnComputer(userAgent: string, platform: string, maxTouchPoints: number, brands?: readonly string[]): boolean {
    return detectAppBrowser(userAgent, brands) === 'safari' && !isIosDevice(userAgent, platform, maxTouchPoints);
}

/** The name of Safari's own app (the deploy makes manifest-safari.json with it, see deploy.yml). */
export function safariAppName(beta: boolean): string {
    return beta ? 'Strom Beta (Safari)' : 'Strom (Safari)';
}

/**
 * Link the web app manifest so the hosted PWA is installable. Done at runtime
 * (PWA mode only) so the exported single-file build never points at /run/.
 * `safariName`: Safari on a computer — its own manifest (name, muted icons),
 * touch icon and app title.
 */
export function linkManifest(safariName: string | null = null): void {
    if (typeof document === 'undefined' || document.querySelector('link[rel="manifest"]')) return;
    const base = pwaBasePath(location.pathname);
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `${base}${safariName ? 'manifest-safari.json' : 'manifest.json'}`;
    document.head.appendChild(link);
    // iOS takes the home-screen icon from here, not from the manifest.
    const touch = document.createElement('link');
    touch.rel = 'apple-touch-icon';
    touch.href = `${base}icons/${safariName ? 'apple-touch-icon-muted.png' : 'apple-touch-icon.png'}`;
    document.head.appendChild(touch);
    if (safariName) {
        const title = document.createElement('meta');
        title.name = 'apple-mobile-web-app-title';
        title.content = safariName;
        document.head.appendChild(title);
    }
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
