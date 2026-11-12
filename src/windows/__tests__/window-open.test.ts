/**
 * "Open in a new window" (spec 079 §1) is offered only in the main window of
 * the app (not an exported file), wider than a phone and with a mouse.
 */

import { describe, it, expect } from 'vitest';
import { windowsOffered, type WindowOfferEnv } from '../window-open.js';

const desk: WindowOfferEnv = { role: 'main', viewMode: false, width: 1440, phoneBar: false, finePointer: true };

describe('windows offered', () => {
    it('the main window with a mouse, wider than a phone', () => {
        expect(windowsOffered(desk)).toBe(true);
        expect(windowsOffered({ ...desk, width: 641 })).toBe(true);
    });

    it('not on a phone, a phone held sideways, a touch screen, an exported file, or in another window', () => {
        expect(windowsOffered({ ...desk, width: 640 })).toBe(false);
        expect(windowsOffered({ ...desk, width: 390 })).toBe(false);
        expect(windowsOffered({ ...desk, width: 900, phoneBar: true })).toBe(false);
        expect(windowsOffered({ ...desk, finePointer: false })).toBe(false);
        expect(windowsOffered({ ...desk, viewMode: true })).toBe(false);
        expect(windowsOffered({ ...desk, role: 'satellite' })).toBe(false);
        expect(windowsOffered({ ...desk, role: 'second-tab' })).toBe(false);
    });
});
