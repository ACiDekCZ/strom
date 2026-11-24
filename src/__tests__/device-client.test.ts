/**
 * This browser as a sender to the research (spec 094 K2.4): its readable
 * name from what the browser says about itself, and a lasting id that
 * survives a broken storage. Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { deviceNameOf } from '../device-client.js';

const UA = {
    chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    edgeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    edgeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
    firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    safariIpadOld: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    operaWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('the device name', () => {
    it.each([
        [UA.chromeMac, 'Chrome · Mac'],
        [UA.chromeWindows, 'Chrome · Windows'],
        [UA.chromeLinux, 'Chrome · Linux'],
        [UA.chromeAndroid, 'Chrome · Android'],
        [UA.chromeIphone, 'Chrome · iPhone'],
        [UA.chromeOs, 'Chrome · ChromeOS'],
        [UA.edgeWindows, 'Edge · Windows'],
        [UA.edgeMac, 'Edge · Mac'],
        [UA.edgeAndroid, 'Edge · Android'],
        [UA.firefoxLinux, 'Firefox · Linux'],
        [UA.firefoxWindows, 'Firefox · Windows'],
        [UA.firefoxMac, 'Firefox · Mac'],
        [UA.firefoxIphone, 'Firefox · iPhone'],
        [UA.safariMac, 'Safari · Mac'],
        [UA.safariIphone, 'Safari · iPhone'],
        [UA.safariIpadOld, 'Safari · iPad'],
        [UA.samsungAndroid, 'Samsung Internet · Android'],
        [UA.operaWindows, 'Opera · Windows'],
    ])('%s → %s', (userAgent, name) => {
        expect(deviceNameOf({ userAgent, maxTouchPoints: 0 })).toBe(name);
    });

    it('an iPad asking for the Mac page is told by touch', () => {
        expect(deviceNameOf({ userAgent: UA.safariMac, maxTouchPoints: 5 })).toBe('Safari · iPad');
        expect(deviceNameOf({ userAgent: UA.safariMac, maxTouchPoints: 0 })).toBe('Safari · Mac');
    });

    it('the brands of userAgentData name what the user agent hides', () => {
        expect(deviceNameOf({ userAgent: UA.chromeWindows, brands: ['Not.A/Brand', 'Chromium', 'Brave'] })).toBe('Brave · Windows');
        expect(deviceNameOf({ userAgent: '', brands: ['Chromium', 'Google Chrome'], platform: 'macOS' })).toBe('Chrome · Mac');
        expect(deviceNameOf({ userAgent: '', brands: ['Microsoft Edge'], platform: 'Windows' })).toBe('Edge · Windows');
    });

    it('an unknown part is left out, nothing known gives none', () => {
        expect(deviceNameOf({ userAgent: 'curl/8.4.0' })).toBe('');
        expect(deviceNameOf({ userAgent: '' })).toBe('');
        expect(deviceNameOf({ userAgent: 'SomeBot/1.0 (Windows NT 10.0)' })).toBe('Windows');
        expect(deviceNameOf({ userAgent: 'Mozilla/5.0 (Plan9) Firefox/132.0' })).toBe('Firefox');
    });

    it('says nothing personal: only the browser and the system', () => {
        const name = deviceNameOf({ userAgent: `${UA.chromeMac} Jan.Hrotek@example.org /Users/hrotek` });
        expect(name).toBe('Chrome · Mac');
    });
});

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

function brokenStorage(): Storage {
    const fail = (): never => { throw new Error('SecurityError'); };
    return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

/** A fresh module (its page-only id forgotten), as on a new page. */
async function freshModule(): Promise<typeof import('../device-client.js')> {
    vi.resetModules();
    return import('../device-client.js');
}

describe('the device id', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is made once and kept: two calls, and a new page, give the same id', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        const m = await freshModule();
        const id = m.deviceClientId();
        expect(id).toMatch(m.DEVICE_ID_RE);
        expect(m.deviceClientId()).toBe(id);
        expect(storage.getItem('strom-device-id')).toBe(id);
        const again = await freshModule();
        expect(again.deviceClientId()).toBe(id);
        expect(again.isThisDevice(id)).toBe(true);
        expect(again.isThisDevice('another-device')).toBe(false);
        expect(again.isThisDevice('')).toBe(false);
    });

    it('a stored id of a wrong shape is replaced', async () => {
        const storage = memoryStorage();
        storage.setItem('strom-device-id', 'has spaces in it');
        vi.stubGlobal('localStorage', storage);
        const m = await freshModule();
        const id = m.deviceClientId();
        expect(id).toMatch(m.DEVICE_ID_RE);
        expect(id).not.toBe('has spaces in it');
    });

    it('a storage that throws: no crash, the id lasts for the page', async () => {
        vi.stubGlobal('localStorage', brokenStorage());
        const m = await freshModule();
        expect(m.isThisDevice('x')).toBe(false);
        const id = m.deviceClientId();
        expect(id).toMatch(m.DEVICE_ID_RE);
        expect(m.deviceClientId()).toBe(id);
        expect(m.isThisDevice(id)).toBe(true);
    });

    it('no storage at all: the same', async () => {
        vi.stubGlobal('localStorage', undefined);
        const m = await freshModule();
        const id = m.deviceClientId();
        expect(m.deviceClientId()).toBe(id);
    });

    it('isThisDevice never makes an id', async () => {
        const storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
        const m = await freshModule();
        expect(m.isThisDevice('abc')).toBe(false);
        expect(storage.getItem('strom-device-id')).toBeNull();
    });

    it('the device as a send names it: the id, the name when known', async () => {
        vi.stubGlobal('localStorage', memoryStorage());
        vi.stubGlobal('navigator', { userAgent: UA.firefoxLinux, maxTouchPoints: 0 });
        const m = await freshModule();
        expect(m.deviceClient()).toEqual({ id: m.deviceClientId(), name: 'Firefox · Linux' });
        vi.stubGlobal('navigator', { userAgent: 'curl/8.4.0' });
        expect(m.deviceClient()).toEqual({ id: m.deviceClientId() });
    });
});
