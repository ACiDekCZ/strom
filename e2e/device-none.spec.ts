import { test, expect, type Browser, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fakeBridge, fakePhone, fakeDevice, openResearch, openResearchMenu, poll, type FakeBridge } from './research-bridge.js';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';

/**
 * Without the gateway nothing new (spec 094, K3.11): a research's bridge that
 * does not say `device.gateway` — with the other device features or without
 * them — leaves every place of the app as it was before the devices of the
 * home network: the Research menu, the phone's More sheet, the tree switcher
 * and its Trees sheet, Actions, Export, the tree's actions, "Connect phone".
 * Nothing of the device mode is drawn, nothing asks `/device/*` or opens the
 * gateway's events, and a pairing code in an ordinary address of the app does
 * nothing. Where research-connect-device.spec.ts ("without device.gateway",
 * English, 1440) and device-switcher.spec.ts ("outside the device mode", no
 * bridge) already show it, this adds Czech, the phone's width and the same
 * places with and without the other device features side by side. Invented
 * devices of the Pýchavkovi of Mlýnky only.
 */

const NOW = new Date('2026-11-24T13:20:00Z');
const ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: null };
/** The device features a bridge may say without the gateway: none of them may show. */
const OTHER_DEVICE = ['device.rename', 'device.events', 'device.phonePage'];
/** A request of the device mode: the gateway's `/device/…` or its tunnel (`__device/`). */
const DEVICE_REQUEST = /\/device(\/|$|\?)|__device\//;
const PAIR_ID = 'pairAbCdEfGhIjKlMnOp';
const SECRET = 'S3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS';

/** The connection on, one phone's page and two devices of the app (as a bridge with the gateway would say them). */
function phone() {
    return fakePhone({
        state: 'on', since: new Date(NOW.getTime() - 3600_000).toISOString(), qrExpiresAt: new Date(NOW.getTime() + 9 * 60_000).toISOString(),
        phones: [{ id: 'ph_page1', name: 'Android · Chrome', pairedAt: '2026-11-02T09:00:00Z', lastSeenAt: '2026-11-24T10:20:00Z', address: 'http://192.168.1.23:47800', stale: false }],
        devices: {
            app: 'ready', appVersion: '3.33.0', name: 'Pracovna.local',
            list: [
                fakeDevice('dv_aaaaaaaaaaaaaaaa', 'iPhone · Safari', { kind: 'phone', connected: true, lastSeenAt: '2026-11-24T13:19:30Z' }),
                fakeDevice('dv_bbbbbbbbbbbbbbbb', 'iPad · Safari', { kind: 'tablet', lastSeenAt: '2026-11-24T12:05:00Z' }),
            ],
        },
    });
}

/** Every request of the page that belongs to the device mode, and every EventSource it opens. */
async function watch(page: Page): Promise<{ requests: string[]; sources: () => Promise<string[]> }> {
    const requests: string[] = [];
    page.on('request', r => { if (DEVICE_REQUEST.test(r.url())) requests.push(`${r.method()} ${r.url()}`); });
    await page.addInitScript(() => {
        const Native = window.EventSource;
        const opened: string[] = [];
        (window as unknown as { __eventSources: string[] }).__eventSources = opened;
        if (!Native) return;
        window.EventSource = class extends Native {
            constructor(url: string | URL, init?: EventSourceInit) {
                super(url, init);
                opened.push(String(url));
            }
        } as typeof EventSource;
    });
    return {
        requests,
        sources: () => page.evaluate(() => (window as unknown as { __eventSources?: string[] }).__eventSources ?? []),
    };
}

/** The visible text of what is open now: a dropdown, the Research menu, a sheet, a dialog. */
const openNow = (page: Page): Promise<string[]> => page.evaluate(() => {
    const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    return [...document.querySelectorAll('.tree-switcher-dropdown.active, #research-menu.active, .bottom-sheet, .modal-overlay.active')]
        .filter(shown)
        .map(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
});

async function closeAll(page: Page): Promise<void> {
    for (let i = 0; i < 4 && (await openNow(page)).length; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }
    await expect.poll(() => openNow(page)).toEqual([]);
}

/** Nothing of the device mode in the page. */
async function expectNoDeviceMode(page: Page): Promise<void> {
    const m = await page.evaluate(() => ({
        mode: document.body.classList.contains('device-mode'),
        drawn: ['#device-boot', '#device-conn-modal', '#device-qline', '.device-qline', '#device-home-line', '#device-home-modal', '#tree-switcher-conn-top']
            .filter(sel => !!document.querySelector(sel)),
        conn: (() => { const el = document.getElementById('current-tree-conn'); return !!el && el.getBoundingClientRect().height > 0; })(),
        lines: (() => { const el = document.querySelector('.tree-switcher-lines'); return el ? getComputedStyle(el).display : 'contents'; })(),
    }));
    expect(m).toEqual({ mode: false, drawn: [], conn: false, lines: 'contents' });
}

const treeActionKeys = (page: Page): Promise<string[]> => page.evaluate(async () => {
    const s = (window as unknown as { Strom: { UI: { treeActionGroups: (id: string, src: string) => Promise<{ rows: { key: string }[] }[]> }; TreeManager: { getActiveTreeId: () => string } } }).Strom;
    return (await s.UI.treeActionGroups(s.TreeManager.getActiveTreeId(), 'actions')).flatMap(g => g.rows.map(r => r.key));
});

/** ⌘S / Ctrl+S taken by the app. */
const saveKeyTaken = (page: Page): Promise<boolean> => page.evaluate(() => [{ ctrlKey: true }, { metaKey: true }].some(mod => {
    const ev = new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true, ...mod });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
}));

interface Places {
    research: string[];
    trees: string[];
    actions: string[];
    export: string[];
    phone: string[];
    keys: string[];
    saveKey: boolean;
}

/** Every place that would carry the devices, as it reads now. */
async function places(page: Page, b: FakeBridge, narrow: boolean): Promise<Places> {
    const out = {} as Places;
    await openResearchMenu(page, { expandMore: true });
    await expect(page.locator('#research-item-phone')).toBeVisible();
    out.research = await openNow(page);
    await closeAll(page);

    await page.locator('.tree-switcher-btn').click();
    await expect(page.locator(narrow ? '.bottom-sheet' : '#tree-switcher-dropdown.active')).toBeVisible();
    // the trees' own actions: import and managing trees as before, no quiet line of the computer
    await expect(page.locator(narrow ? '.bottom-sheet-quiet' : '#tree-switcher-not-here')).toHaveCount(0);
    if (!narrow) await expect(page.locator('#tree-switcher-import')).toBeVisible();
    out.trees = await openNow(page);
    await closeAll(page);

    // Actions; on a phone the More sheet
    if (narrow) await page.evaluate(() => window.Strom.UI.showMoreMenuSheet());
    else await page.locator('.actions-menu-btn').click();
    await expect(page.locator(narrow ? '.bottom-sheet' : '#actions-menu-dropdown.active')).toBeVisible();
    await expect(page.locator('#actions-storage-row')).toHaveCount(1);
    out.actions = await openNow(page);
    await closeAll(page);

    await page.evaluate(() => (window.Strom.UI as unknown as { showExportDialog(): void }).showExportDialog());
    await expect(page.locator('#export-modal')).toHaveClass(/active/);
    // linking a file stays offered (this browser can)
    expect(await page.locator('#export-modal .fsa-only').evaluateAll(els => els.some(el => (el as HTMLElement).offsetParent !== null))).toBe(true);
    out.export = await openNow(page);
    await closeAll(page);

    // Connect phone: as before, its code without an address, no devices, no "phone page only"
    await openResearchMenu(page, { expandMore: true });
    await page.locator('#research-item-phone').click();
    const dialog = page.locator('#phone-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.phone-row')).toHaveCount(1);
    await dialog.locator('[data-act="qr"]').first().click();
    await expect(dialog.locator('.phone-qr-img')).toBeVisible();
    await expect(dialog.locator('.phone-addr, .phone-page-only, [data-countdown-sr], .phone-rename-btn, .phone-list-now, [data-act="dev-rename"], [data-act="copy"]')).toHaveCount(0);
    out.phone = [(await dialog.innerText()).replace(/\s+/g, ' ').trim()];
    await closeAll(page);
    expect(b.phone!.deviceAsks ?? []).toEqual([]);

    out.keys = await treeActionKeys(page);
    out.saveKey = await saveKeyTaken(page);
    return out;
}

/** The app with a research's bridge saying `features`, at this width and language; its places and requests. */
async function withBridge(browser: Browser, lang: 'en' | 'cs', width: number, features: string[]) {
    const ctx = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width, height: width <= 640 ? 844 : 900 },
        locale: lang === 'cs' ? 'cs-CZ' : 'en-US',
        timezoneId: 'Europe/Prague',
    });
    const page = await ctx.newPage();
    const seen = await watch(page);
    await page.clock.setFixedTime(NOW);
    const b = await fakeBridge(page, { accepts: ACCEPTS, features, phone: phone() });
    await openResearch(page);
    await poll(page);
    await expectNoDeviceMode(page);
    const found = await places(page, b, width <= 640);
    await expectNoDeviceMode(page);
    const sources = await seen.sources();
    await ctx.close();
    return { found, requests: seen.requests, sources };
}

for (const lang of ['en', 'cs'] as const) {
    for (const width of [390, 1440]) {
        test(`${lang}, ${width}: a bridge without device.gateway — with the other device features or without — changes nothing anywhere`, async ({ browser }) => {
            test.setTimeout(90_000);
            const plain = await withBridge(browser, lang, width, ['phone']);
            const other = await withBridge(browser, lang, width, ['phone', ...OTHER_DEVICE]);

            // the same places, word for word
            expect(other.found).toEqual(plain.found);
            // what belongs to the computer is there: import and managing trees, deleting, backups, ⌘S
            expect(plain.found.keys).toEqual(expect.arrayContaining(['delete', 'snapshots', 'manageTrees']));
            expect(plain.found.saveKey).toBe(true);
            const importWord = lang === 'cs' ? 'Import' : 'Import…';
            expect(plain.found.trees.join(' ')).toContain(importWord);
            // the dialog is today's "Connect phone"
            expect(plain.found.phone[0]).toContain(lang === 'cs' ? 'Připojit telefon' : 'Connect phone');
            // no device request, no gateway events
            for (const run of [plain, other]) {
                expect(run.requests).toEqual([]);
                expect(run.sources.filter(u => DEVICE_REQUEST.test(u))).toEqual([]);
            }
        });
    }
}

test.describe('a pairing code in an ordinary address of the app', () => {
    test.use({ viewport: { width: 390, height: 844 }, locale: 'en-US' });

    async function seeds(page: Page): Promise<void> {
        await seedResearchPromoSeen(page);
        await seedWhatsNewSeen(page);
        await page.addInitScript(() => { try { localStorage.setItem('strom-tour-offered', '1'); } catch { /* none */ } });
    }

    for (const [where, code] of [['the icon\'s code', `#home.${PAIR_ID}.${SECRET}`], ['the QR code\'s', `#${PAIR_ID}.${SECRET}`]] as const) {
        test(`on the app's website (${where}): nothing asked, nothing drawn, the address as it was`, async ({ page }) => {
            const html = await fs.readFile('e2e-dist/strom.html', 'utf8');
            await page.context().route('https://stromapp.info/**', route => {
                const p = new URL(route.request().url()).pathname;
                return p === '/app/' || p === '/pair'
                    ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
                    : route.fulfill({ status: 404, body: '' });
            });
            const seen = await watch(page);
            await seeds(page);
            const url = code.startsWith('#home') ? `https://stromapp.info/app/${code}` : `https://stromapp.info/pair?m=app${code}`;
            await page.goto(url);
            await expect(page.locator('html')).not.toHaveClass(/app-loading/, { timeout: 15000 });
            await page.waitForTimeout(500);
            await expectNoDeviceMode(page);
            // the code stays in the address (the app adds only its own ?tree=)
            const left = new URL(page.url()), asked = new URL(url);
            expect([left.pathname, left.hash]).toEqual([asked.pathname, asked.hash]);
            expect(seen.requests).toEqual([]);
            expect(await seen.sources()).toEqual([]);
        });
    }

    test('in a file: nothing asked, nothing drawn', async ({ page }) => {
        const seen = await watch(page);
        await seeds(page);
        const url = `${pathToFileURL(resolve('e2e-dist/strom.html')).href}#home.${PAIR_ID}.${SECRET}`;
        await page.goto(url);
        await expect(page.locator('html')).not.toHaveClass(/app-loading/, { timeout: 15000 });
        await page.waitForTimeout(500);
        await expectNoDeviceMode(page);
        expect(new URL(page.url()).hash).toBe(new URL(url).hash);
        expect(seen.requests).toEqual([]);
    });

    test('on a server of its own without a gateway: one look for the gateway, then the app as before at the same path', async ({ page }) => {
        const seen = await watch(page);
        await seeds(page);
        await page.goto(`/strom.html#home.${PAIR_ID}.${SECRET}`);
        await expect(page.locator('html')).not.toHaveClass(/app-loading/, { timeout: 15000 });
        // the gateway's hello unanswered (an ordinary server): the start screen gone, the app as it was
        await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 10000 });
        await expectNoDeviceMode(page);
        await expect(page.locator('.tree-switcher-btn')).toBeVisible();
        // the code is out of the address (it is a secret), the path stays
        const left = new URL(page.url());
        expect([left.pathname, left.hash]).toEqual(['/strom.html', '']);
        // only the hello, never a pairing or the tunnel
        expect(seen.requests.map(r => r.replace(/^(\w+) https?:\/\/[^/]+/, '$1 '))).toEqual(['GET /device/hello']);
        expect(await seen.sources()).toEqual([]);
    });
});
