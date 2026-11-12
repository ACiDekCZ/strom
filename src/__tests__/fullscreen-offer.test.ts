import { describe, it, expect } from 'vitest';
import { fullscreenOffer } from '../ui/fullscreen.js';

/** More › Full screen (spec 082 K1.3): what the row offers in each browser. */
describe('fullscreenOffer', () => {
    const base = { enabled: false, active: false, ios: false, standalone: false };

    it('offers the switch where the browser can, by the state', () => {
        expect(fullscreenOffer({ ...base, enabled: true })).toBe('enter');
        expect(fullscreenOffer({ ...base, enabled: true, active: true })).toBe('exit');
        // An iPad's Safari that can: the switch, not the hint.
        expect(fullscreenOffer({ ...base, enabled: true, ios: true })).toBe('enter');
    });

    it('an iPhone in Safari: the way to the Home Screen; on the Home Screen: nothing', () => {
        expect(fullscreenOffer({ ...base, ios: true })).toBe('ios-hint');
        expect(fullscreenOffer({ ...base, ios: true, standalone: true })).toBeNull();
    });

    it('nothing where the browser cannot and it is no iPhone', () => {
        expect(fullscreenOffer(base)).toBeNull();
        expect(fullscreenOffer({ ...base, standalone: true })).toBeNull();
    });
});
