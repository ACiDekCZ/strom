import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway } from './device-gateway.js';

/**
 * The Connection of a device of the home network (spec 094 §3, 3.5, 3.6,
 * 3.11, 3.12), through the fake gateway: the tree switcher's top block on a
 * computer, the dialog there and the sheet on a phone, Rename, disconnecting
 * with what waits on the device, and nothing offered that the gateway does not
 * announce. Invented data only (the Pýchavkovi of Mlýnky, the computer
 * Pracovna). `STROM_SHOTS_DIR` set: screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const LONG_TREE = 'Pýchavkovi z Mlýnků a Dolních Lhot';
const LONG_PC = 'Pracovna v podkroví u Pýchavků';
/** A device name as long as the gateway keeps (60 characters). */
const LONG_DEVICE = 'Notebook in der Bibliothek am Fenster im zweiten Stock links';

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 24 NOV 2026', `1 _STROM_TREE ${PYCH}`, '1 CHAR UTF-8',
    '0 @P0001@ INDI', '1 NAME Jan /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Josef /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');

/** The research behind the gateway: one tree; `actions` what the gateway announces (rename and unpair by default). */
function research(gw: FakeGateway, o: { name?: string; actions?: string[] } = {}): void {
    gw.trees = [{ id: PYCH, name: o.name ?? 'Pýchavkovi z Mlýnků', archive: false }];
    const actions = o.actions ?? ['device.rename', 'device.unpair'];
    gw.onTunnel = (req, device) => {
        if (req.p === 'status') {
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway'], tree: { id: PYCH, name: gw.trees[0].name }, head: 'h1',
                    persons: 3, working: [], waiting: [], queue: [], links: [],
                    device: { id: device.id, name: device.name, kind: device.kind, actions },
                },
            };
        }
        if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
        return undefined;
    };
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            // the home-screen icon's quiet line stays out of these screens
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

/** Paired by the QR code's address, the tree open. */
async function pairedApp(page: Page, gw: FakeGateway): Promise<void> {
    await page.goto(gw.pairCode().url);
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => gw.streams(), { timeout: 15000 }).toBe(1);
}

/** What waits on the device: photos and edits put into its queue (IndexedDB `strom-device`, store `queue`). */
async function queue(page: Page, entries: Record<string, unknown>): Promise<void> {
    await page.evaluate(async (all) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('strom-device', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('queue', 'readwrite');
            for (const [k, v] of Object.entries(all)) tx.objectStore('queue').put(v, k);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, entries);
}

/** The Connection: the top block of the dropdown on a computer and a tablet, the sheet on a phone (its switcher's second line). */
async function openConnection(page: Page): Promise<void> {
    const width = page.viewportSize()!.width;
    if (width <= 640) {
        // On a phone the tree switcher's second line opens the Connection.
        await page.locator('#current-tree-conn').click();
        await expect(page.locator('.device-conn-sheet')).toBeVisible();
    } else {
        await page.locator('.tree-switcher-btn').click();
        await page.locator('#tree-switcher-conn-top').click();
        await expect(page.locator('#device-conn-modal')).toBeVisible();
    }
}

async function closeConnection(page: Page): Promise<void> {
    await page.evaluate(() => (window as unknown as { Strom: { UI: { closeDeviceConnection(): void } } }).Strom.UI.closeDeviceConnection());
    await expect(page.locator('.device-conn')).toHaveCount(0);
}

/** Nothing wider than the window (the page, and the given element inside itself). */
async function expectNoOverflow(page: Page, selector: string): Promise<void> {
    const m = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            el: el ? el.scrollWidth - el.clientWidth : 0,
            texts: el ? [...el.querySelectorAll<HTMLElement>('*')].filter(c => c.getBoundingClientRect().right > window.innerWidth + 0.5 || c.getBoundingClientRect().left < -0.5).map(c => c.className || c.tagName) : [],
        };
    }, selector);
    expect(m.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.el, `${selector} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.texts, `${selector}: elements outside the window`).toEqual([]);
}

function overlaps(a: { x: number; y: number; width: number; height: number } | null, b: { x: number; y: number; width: number; height: number } | null): boolean {
    if (!a || !b) return false;
    return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

const heightOf = (width: number): number => (width > 1024 ? 900 : width === 1024 ? 768 : 844);
const themeWord = (scheme: 'light' | 'dark'): string => (scheme === 'light' ? 'svetle' : 'tmave');

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test.describe('en', () => {
    test.use({ locale: 'en-US' });

    test('the dropdown\'s top block opens the dialog: the computer, this device renamed, what is not here', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw);
        await pairedApp(page, gw);
        await page.locator('.tree-switcher-btn').click();
        const top = page.locator('#tree-switcher-conn-top');
        await expect(top).toContainText('On computer Pracovna · connected');
        await expect(top).toContainText('Connection…');
        await expect(top.locator('.phone-dot.is-on')).toHaveCount(1);
        // first in the dropdown, the trees below
        await expect(page.locator('#tree-switcher-dropdown > *').first()).toHaveId('tree-switcher-conn-top');
        await top.click();
        await expect(page.locator('#tree-switcher-dropdown')).not.toHaveClass(/active/);
        const dialog = page.locator('#device-conn-modal');
        await expect(dialog.getByRole('heading', { name: 'Connection' })).toBeVisible();
        const pc = dialog.locator('.device-conn-pc');
        await expect(pc).toContainText('Computer');
        await expect(pc.locator('.device-conn-name')).toHaveText('Pracovna');
        await expect(pc).toContainText('connected · encrypted · home network');
        await expect(pc.locator('.device-conn-sub')).toContainText(/^since .+ · last synced .+$/);
        const me = dialog.locator('.device-conn-me');
        await expect(me).toContainText('This device');
        await expect(me.locator('.device-conn-name')).toHaveText(gw.devices[0].name);
        await expect(dialog).toContainText('Approvals and starting the agent are only on the computer with the research.');
        // the count of other devices waits for a gateway that tells it; no home-screen row in the dialog
        await expect(dialog).not.toContainText('more device');
        await expect(dialog.locator('[data-act="home"]')).toHaveCount(0);
        // no mark of the terminal or the agent on a device
        await expect(dialog.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);

        // Rename: in place, sent through the tunnel, kept
        await me.getByRole('button', { name: 'Rename' }).click();
        const field = dialog.getByRole('textbox', { name: 'Name of this device' });
        await expect(field).toBeFocused();
        await expect(field).toHaveAttribute('maxlength', '60');
        await field.fill(LONG_DEVICE);
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(me.locator('.device-conn-name')).toHaveText(LONG_DEVICE);
        expect(gw.devices[0].name).toBe(LONG_DEVICE);
        expect(gw.tunnelled.some(r => r.p === 'device/rename' && (r.b as { name?: string }).name === LONG_DEVICE)).toBe(true);
        // the long name ends in an ellipsis beside Rename
        expect(overlaps(await me.locator('.device-conn-name').boundingBox(), await me.getByRole('button', { name: 'Rename' }).boundingBox())).toBe(false);
        await expectNoOverflow(page, '#device-conn-modal .modal');

        // a refused name: said, the field stays
        const onTunnel = gw.onTunnel;
        gw.onTunnel = (req, device) => (req.p === 'device/rename' ? { s: 400, body: { code: 'device.name' } } : onTunnel(req, device));
        await me.getByRole('button', { name: 'Rename' }).click();
        await field.fill('Notebook · Firefox');
        await field.press('Enter');
        await expect(dialog.getByRole('alert')).toHaveText('The name was not saved.');
        await expect(field).toBeVisible();
        expect(gw.devices[0].name).toBe(LONG_DEVICE);
        gw.onTunnel = onTunnel;
        // Escape leaves the field, not the dialog
        await field.press('Escape');
        await expect(field).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });

    test('disconnecting: what waits on the device, Cancel back, then unpaired', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw);
        await pairedApp(page, gw);
        await queue(page, { 'photo-1': { kind: 'photo', name: 'svatba-1924.jpg' }, 'photo-2': { kind: 'photo', name: 'mlyn.jpg' }, 'edit-1': { kind: 'edit', changes: 1 } });
        await openConnection(page);
        const dialog = page.locator('#device-conn-modal');
        await dialog.getByRole('button', { name: 'Disconnect this device' }).click();
        await expect(dialog.getByRole('heading', { name: 'Disconnect this device?' })).toBeVisible();
        await expect(dialog).toContainText('The device will no longer see the research on Pracovna.');
        await expect(dialog).toContainText('Waiting to be sent: 2 photos, 1 edit. They stay on this device; they can be saved now and sent after pairing again.');
        // saving the photos comes with the photos' part: not offered before
        await expect(dialog.getByRole('button', { name: 'Save photos to the device' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog.getByRole('heading', { name: 'Connection' })).toBeVisible();
        expect(gw.tunnelled.some(r => r.p === 'device/unpair')).toBe(false);

        // the gateway cannot now: said, nothing forgotten
        const onTunnel = gw.onTunnel;
        gw.onTunnel = (req, device) => (req.p === 'device/unpair' ? { s: 500, body: { code: 'device.failed' } } : onTunnel(req, device));
        await dialog.getByRole('button', { name: 'Disconnect this device' }).click();
        await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
        await expect(dialog.getByRole('alert')).toHaveText('The device could not be disconnected now.');
        expect(gw.devices).toHaveLength(1);
        gw.onTunnel = onTunnel;

        await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(gw.devices).toHaveLength(0);
        await expect(page.locator('.toast', { hasText: 'This device is no longer paired with Pracovna.' })).toBeVisible();
        await expect(page.locator('.toast', { hasText: 'To pair again: scan the QR code' })).toBeVisible();
        expect(await page.evaluate(() => 'strom-device-paired' in localStorage)).toBe(false);
        // the queue stays on the device
        const kept = await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('strom-device', 1); r.onsuccess = () => resolve(r.result); });
            const keys = await new Promise<IDBValidKey[]>((resolve) => { const r = db.transaction('queue').objectStore('queue').getAllKeys(); r.onsuccess = () => resolve(r.result); });
            db.close();
            return keys.length;
        });
        expect(kept).toBe(3);
        // the device has left the gateway's bridge: no Connection offered any more (the unpaired state is §7's)
        await page.locator('.tree-switcher-btn').click();
        await expect(page.locator('#tree-switcher-dropdown')).toHaveClass(/active/);
        await expect(page.locator('#tree-switcher-conn-top')).toHaveCount(0);
    });

    test('a gateway that announces neither rename nor unpair: neither offered', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw, { actions: ['conflict.decide'] });
        await pairedApp(page, gw);
        await openConnection(page);
        const sheet = page.locator('.device-conn-sheet');
        await expect(sheet).toContainText('Pracovna');
        await expect(sheet.getByRole('button', { name: 'Rename' })).toHaveCount(0);
        await expect(sheet.getByRole('button', { name: 'Disconnect this device' })).toHaveCount(0);
        // the home-screen icon's row on a phone opens How
        await sheet.getByRole('button', { name: 'Home-screen icon' }).click();
        await expect(page.locator('#device-home-modal')).toBeVisible();
    });

    test('en at 390, 1024 and 1440, light and dark: nothing past the edge', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        research(gw);
        await pairedApp(page, gw);
        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [390, 1024, 1440]) {
                await page.setViewportSize({ width, height: heightOf(width) });
                await openConnection(page);
                await expectNoOverflow(page, '.device-conn');
                await closeConnection(page);
            }
        }
    });
});

test.describe('de', () => {
    test.use({ locale: 'de-DE' });

    test('a long tree, computer and device name at 390, 1024 and 1440, light and dark: the sheet, the dialog, the top block, disconnecting', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        gw.computer = { name: 'Pracovna', label: LONG_PC };
        research(gw, { name: LONG_TREE });
        await pairedApp(page, gw);
        await queue(page, { 'photo-1': { kind: 'photo', name: 'svatba-1924.jpg' }, 'edit-1': { kind: 'edit', changes: 2 }, 'edit-2': { kind: 'edit', changes: 1 } });

        // the phone: renamed to 60 characters in the sheet
        await openConnection(page);
        const sheet = page.locator('.device-conn-sheet');
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('Verbindung');
        await expect(sheet).toContainText('verbunden · verschlüsselt · Heimnetz');
        await sheet.getByRole('button', { name: 'Umbenennen' }).click();
        await sheet.getByRole('textbox', { name: 'Name dieses Geräts' }).fill(LONG_DEVICE);
        await sheet.getByRole('button', { name: 'Speichern' }).click();
        await expect(sheet.locator('.device-conn-me .device-conn-name')).toHaveText(LONG_DEVICE);
        await closeConnection(page);

        for (const scheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            for (const width of [390, 1024, 1440]) {
                await page.setViewportSize({ width, height: heightOf(width) });
                if (width > 640) {
                    await page.locator('.tree-switcher-btn').click();
                    const top = page.locator('#tree-switcher-conn-top');
                    await expect(top).toContainText(`Auf dem Computer ${LONG_PC} · verbunden`);
                    await expect(top).toContainText('Verbindung…');
                    await expectNoOverflow(page, '#tree-switcher-dropdown');
                    expect(overlaps(await top.locator('.tree-switcher-conn-top-t').boundingBox(), await top.locator('.tree-switcher-conn-top-a').boundingBox())).toBe(false);
                    if (width === 1440) await shot(page, `d4d-prepinac-spojeni-de-${width}-${themeWord(scheme)}`);
                    await page.keyboard.press('Escape');
                    await page.locator('body').click({ position: { x: 5, y: page.viewportSize()!.height - 5 } }).catch(() => undefined);
                }
                await openConnection(page);
                const host = page.locator('.device-conn');
                await expect(host.locator('.device-conn-pc .device-conn-name')).toHaveText(LONG_PC);
                await expect(host.locator('.device-conn-me .device-conn-name')).toHaveText(LONG_DEVICE);
                await expectNoOverflow(page, '.device-conn');
                const me = host.locator('.device-conn-me');
                expect(overlaps(await me.locator('.device-conn-name').boundingBox(), await me.getByRole('button', { name: 'Umbenennen' }).boundingBox())).toBe(false);
                if (width <= 640) {
                    // touch targets of the sheet
                    for (const b of await host.locator('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                }
                if (width === 390 || width === 1440) await shot(page, `d4d-spojeni-de-${width}-${themeWord(scheme)}`);

                await (width <= 640 ? host : page.locator('#device-conn-modal')).getByRole('button', { name: 'Dieses Gerät trennen' }).click();
                const ask = width <= 640 ? page.locator('.device-conn-sheet') : page.locator('#device-conn-modal');
                await expect(ask).toContainText('Dieses Gerät trennen?');
                await expect(ask).toContainText(`Das Gerät sieht die Forschung auf ${LONG_PC} nicht mehr.`);
                await expect(ask).toContainText('Wartet auf das Senden: 1 Foto, 2 Änderungen');
                await expectNoOverflow(page, '.device-conn');
                if (width === 390 || width === 1440) await shot(page, `d4d-odpojit-de-${width}-${themeWord(scheme)}`);
                await ask.getByRole('button', { name: 'Abbrechen' }).click();
                await expect(ask).toContainText('Dieses Gerät trennen');
                await closeConnection(page);
            }
        }
        expect(gw.devices).toHaveLength(1);
    });
});
