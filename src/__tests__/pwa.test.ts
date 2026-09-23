/**
 * PWA registration gate: the service worker is registered only on the hosted
 * PWA, never in the exported single-file app (embedded) or during development.
 */

import { describe, it, expect } from 'vitest';
import { shouldRegisterServiceWorker, pwaBasePath } from '../pwa.js';

describe('shouldRegisterServiceWorker', () => {
    it('registers only on the hosted PWA', () => {
        expect(shouldRegisterServiceWorker('pwa')).toBe(true);
    });
    it('never registers in embedded or dev modes', () => {
        expect(shouldRegisterServiceWorker('embedded')).toBe(false);
        expect(shouldRegisterServiceWorker('dev')).toBe(false);
    });
});

describe('pwaBasePath', () => {
    it('serves the public app from /run/', () => {
        expect(pwaBasePath('/run/')).toBe('/run/');
        expect(pwaBasePath('/run/index.html')).toBe('/run/');
        expect(pwaBasePath('/')).toBe('/run/');
    });
    it('serves the pre-release test build from /beta/', () => {
        expect(pwaBasePath('/beta/')).toBe('/beta/');
        expect(pwaBasePath('/beta')).toBe('/beta/');
        expect(pwaBasePath('/beta/index.html')).toBe('/beta/');
    });
    it('does not mistake look-alike paths for the beta', () => {
        expect(pwaBasePath('/betamax/')).toBe('/run/');
        expect(pwaBasePath('/run/beta/')).toBe('/run/');
    });
});
