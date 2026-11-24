/**
 * This browser (its profile) as a sender to the research (spec 094 K2.4):
 * a lasting random id and a readable name ("Chrome · Mac"). Both go with a
 * send to the research's bridge only (`_STROM_CLIENT` in the GEDCOM header),
 * never into an exported file. The name says nothing personal: only the
 * browser and the system, never translated (it is written in the research).
 */

/** Where the id is kept (per browser profile). */
const DEVICE_ID_KEY = 'strom-device-id';

/** What the research accepts as a client id (the same rule as a send's mark). */
export const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** A device as a send names it: its id, its readable name when known. */
export interface DeviceClient {
    id: string;
    name?: string;
}

/** The id of this page when nothing can be stored (or the stored one, once read). */
let pageId: string | null = null;

function newDeviceId(): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(a: T) => T } }).crypto;
    if (c?.randomUUID) return c.randomUUID().toLowerCase();
    // A browser without randomUUID (an old one): 16 random bytes in hex.
    const bytes = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function storedDeviceId(): string | null {
    try {
        const v = localStorage.getItem(DEVICE_ID_KEY);
        return v && DEVICE_ID_RE.test(v) ? v : null;
    } catch {
        return null;
    }
}

/**
 * This browser's lasting id, made on first use. Without storage (blocked,
 * a private window that throws) it lasts for the page only.
 */
export function deviceClientId(): string {
    const stored = storedDeviceId();
    if (stored) {
        pageId = stored;
        return stored;
    }
    if (!pageId) pageId = newDeviceId();
    try { localStorage.setItem(DEVICE_ID_KEY, pageId); } catch { /* no storage: this page's id */ }
    return pageId;
}

/** Whether a device id (from the research) is this browser; never makes an id. */
export function isThisDevice(id: string | null | undefined): boolean {
    if (!id) return false;
    const own = storedDeviceId() ?? pageId;
    return !!own && own === id;
}

/** What the browser says about itself (navigator), as the name is read from it. */
export interface DeviceEnv {
    userAgent: string;
    /** `navigator.userAgentData.brands` (Chromium only). */
    brands?: readonly string[];
    /** `navigator.userAgentData.platform` (Chromium only: "macOS", "Windows", …). */
    platform?: string;
    /** `navigator.maxTouchPoints`: an iPad asks for the Mac page and says so only by touch. */
    maxTouchPoints?: number;
}

function browserOf(env: DeviceEnv): string {
    const ua = env.userAgent || '';
    const brands = env.brands ?? [];
    const has = (b: string): boolean => brands.some(x => x === b);
    if (/\bEdg(e|A|iOS)?\//.test(ua) || has('Microsoft Edge')) return 'Edge';
    if (/\b(OPR|OPiOS|OPT)\//.test(ua) || has('Opera')) return 'Opera';
    if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet';
    if (has('Brave')) return 'Brave';
    if (/\bVivaldi\//.test(ua) || has('Vivaldi')) return 'Vivaldi';
    if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox';
    if (/\b(Chrome|CriOS)\//.test(ua) || has('Google Chrome')) return 'Chrome';
    if (/\bChromium\//.test(ua) || has('Chromium')) return 'Chromium';
    if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
    return '';
}

function systemOf(env: DeviceEnv): string {
    const ua = env.userAgent || '';
    const p = (env.platform ?? '').toLowerCase();
    if (/\biPhone\b|\biPod\b/.test(ua)) return 'iPhone';
    if (/\biPad\b/.test(ua)) return 'iPad';
    if (/\bAndroid\b/.test(ua) || p === 'android') return 'Android';
    if (/\bCrOS\b/.test(ua) || p === 'chrome os' || p === 'chromeos') return 'ChromeOS';
    if (/\bWindows\b/.test(ua) || p === 'windows') return 'Windows';
    if (/\bMacintosh\b|\bMac OS X\b/.test(ua) || p === 'macos') {
        // An iPad asks for the Mac page; only touch tells it apart.
        return (env.maxTouchPoints ?? 0) > 1 ? 'iPad' : 'Mac';
    }
    if (/\bLinux\b|\bX11\b/.test(ua) || p === 'linux') return 'Linux';
    return '';
}

/** "Chrome · Mac", or just the part known ('' when neither is). Pure. */
export function deviceNameOf(env: DeviceEnv): string {
    return [browserOf(env), systemOf(env)].filter(Boolean).join(' · ');
}

/** This browser's readable name ('' when it cannot be told). */
export function deviceName(): string {
    if (typeof navigator === 'undefined') return '';
    const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } };
    return deviceNameOf({
        userAgent: nav.userAgent || '',
        brands: nav.userAgentData?.brands?.map(b => b.brand),
        platform: nav.userAgentData?.platform,
        maxTouchPoints: nav.maxTouchPoints ?? 0,
    });
}

/** This browser as a send to the research names it. */
export function deviceClient(): DeviceClient {
    const name = deviceName();
    return { id: deviceClientId(), ...(name ? { name } : {}) };
}
