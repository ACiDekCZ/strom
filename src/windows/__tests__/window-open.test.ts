/**
 * "Open in a new window" (spec 079 §1) is offered only in the main window of
 * the app (not an exported file), wider than a phone and on a computer's
 * system (Windows, macOS, Linux, ChromeOS) whatever its pointer; not on
 * Android, iOS or iPadOS (tester, 12 Nov 2026: a Surface with a touch screen
 * lost ⧉ because its browser reported the primary pointer as touch).
 */

import { describe, it, expect } from 'vitest';
import { windowsOffered, isDesktopSystem, type WindowOfferEnv, type SystemInfo } from '../window-open.js';

const desk: WindowOfferEnv = { role: 'main', viewMode: false, width: 1440, phoneBar: false, desktopSystem: true };

const UA = {
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    iPadMobileSite: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const sys = (userAgent: string, maxTouchPoints = 0, extra: Partial<SystemInfo> = {}): SystemInfo => ({ userAgent, maxTouchPoints, ...extra });

describe('windows offered', () => {
    it('the main window on a computer, wider than a phone', () => {
        expect(windowsOffered(desk)).toBe(true);
        expect(windowsOffered({ ...desk, width: 641 })).toBe(true);
    });

    it('not on a phone, a phone held sideways, a tablet\'s system, an exported file, or in another window', () => {
        expect(windowsOffered({ ...desk, width: 640 })).toBe(false);
        expect(windowsOffered({ ...desk, width: 390 })).toBe(false);
        expect(windowsOffered({ ...desk, width: 900, phoneBar: true })).toBe(false);
        expect(windowsOffered({ ...desk, desktopSystem: false })).toBe(false);
        expect(windowsOffered({ ...desk, viewMode: true })).toBe(false);
        expect(windowsOffered({ ...desk, role: 'satellite' })).toBe(false);
        expect(windowsOffered({ ...desk, role: 'second-tab' })).toBe(false);
    });
});

describe('a computer\'s system, not its pointer', () => {
    it('Windows with a touch screen, also without a keyboard (the pointer is not read)', () => {
        expect(isDesktopSystem(sys(UA.windows, 10))).toBe(true);
        expect(isDesktopSystem(sys(UA.windows, 10, { mobile: false, platform: 'Windows' }))).toBe(true);
        expect(isDesktopSystem(sys(UA.windows, 0))).toBe(true);
    });

    it('a Mac with a mouse, Linux and ChromeOS', () => {
        expect(isDesktopSystem(sys(UA.mac, 0, { mobile: false, platform: 'macOS' }))).toBe(true);
        expect(isDesktopSystem(sys(UA.macSafari, 0))).toBe(true);
        expect(isDesktopSystem(sys(UA.linux, 0, { mobile: false, platform: 'Linux' }))).toBe(true);
        expect(isDesktopSystem(sys(UA.linuxFirefox, 0))).toBe(true);
        expect(isDesktopSystem(sys(UA.chromeOs, 10, { mobile: false, platform: 'Chrome OS' }))).toBe(true);
    });

    it('not an iPad, also one asking for desktop pages as a Mac (with a trackpad too)', () => {
        expect(isDesktopSystem(sys(UA.macSafari, 5))).toBe(false);
        expect(isDesktopSystem(sys(UA.mac, 5))).toBe(false);
        expect(isDesktopSystem(sys(UA.iPadMobileSite, 5))).toBe(false);
    });

    it('not an Android tablet (its browser says it is not mobile) nor a phone', () => {
        expect(isDesktopSystem(sys(UA.androidTablet, 10, { mobile: false, platform: 'Android' }))).toBe(false);
        expect(isDesktopSystem(sys(UA.androidTablet, 10))).toBe(false);
        expect(isDesktopSystem(sys(UA.androidPhone, 5, { mobile: true, platform: 'Android' }))).toBe(false);
        expect(isDesktopSystem(sys(UA.iPhone, 5))).toBe(false);
        // An Android tablet asking for desktop pages still says Android in userAgentData.
        expect(isDesktopSystem(sys(UA.linux, 10, { mobile: false, platform: 'Android' }))).toBe(false);
    });

    it('an unknown system: not offered', () => {
        expect(isDesktopSystem(sys('', 0))).toBe(false);
        expect(isDesktopSystem(sys('SomeTV/1.0', 0))).toBe(false);
    });
});
