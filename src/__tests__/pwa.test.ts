/**
 * PWA registration gate: the service worker is registered only on the hosted
 * PWA, never in the exported single-file app (embedded) or during development.
 */

import { describe, it, expect } from 'vitest';
import { shouldRegisterServiceWorker } from '../pwa.js';

describe('shouldRegisterServiceWorker', () => {
    it('registers only on the hosted PWA', () => {
        expect(shouldRegisterServiceWorker('pwa')).toBe(true);
    });
    it('never registers in embedded or dev modes', () => {
        expect(shouldRegisterServiceWorker('embedded')).toBe(false);
        expect(shouldRegisterServiceWorker('dev')).toBe(false);
    });
});
