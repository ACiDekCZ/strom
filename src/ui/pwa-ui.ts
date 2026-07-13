/**
 * PWA UI: the offline indicator in the toolbar and the "new version available"
 * refresh prompt. Registration logic lives in src/pwa.ts; this only renders.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { strings } from '../strings.js';
import { applyServiceWorkerUpdate } from '../pwa.js';
import { uiModule } from './module.js';

export const pwaUiMethods = uiModule({
    /** Show/hide a small "offline" toolbar badge based on connectivity. */
    initOnlineIndicator(): void {
        const badge = document.getElementById('offline-indicator');
        if (!badge) return;
        const sync = () => { badge.style.display = navigator.onLine ? 'none' : 'inline-flex'; };
        window.addEventListener('online', sync);
        window.addEventListener('offline', sync);
        sync();
    },

    /** Non-blocking prompt that a new app version is ready; click to refresh. */
    showUpdateAvailable(): void {
        document.querySelector('.pwa-update')?.remove();
        const p = strings.pwa;
        const el = document.createElement('div');
        el.className = 'pwa-update';
        el.innerHTML = `<span>${this.escapeHtml(p.updateReady)}</span>`
            + `<button type="button" class="pwa-update-btn">${this.escapeHtml(p.refresh)}</button>`
            + `<button type="button" class="pwa-update-close" aria-label="close">&times;</button>`;
        el.querySelector('.pwa-update-btn')!.addEventListener('click', () => applyServiceWorkerUpdate());
        el.querySelector('.pwa-update-close')!.addEventListener('click', () => el.remove());
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
    },
});
