import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen, card } from './helpers.js';
import { poll } from './research-bridge.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';
import type { DeviceRequest } from '../src/device/device-crypto';

/**
 * A device of the home network without its computer (spec 094 §7) through the
 * fake gateway: not reachable, switched off on the computer (404), unpaired
 * (401), no network; the quiet line over the tree with what waits on the
 * device, the tree read only as last known, the research's actions grey but
 * Add materials, the list of what waits (save, discard asked first), and the
 * return with the paused batch going on. Invented data only (the Pýchavkovi of
 * Mlýnky, the computer Pracovna). `STROM_SHOTS_DIR` set: screenshots go there.
 */

const TREE = '7c3e1f20-5a4b-4d6e-9f80-1a2b3c4d5e6f';
const HEAD = '5d2e8a7c1b94';
const PNG = readFileSync('e2e/fixtures/avatar.png');
const PC_DE = 'Arbeitszimmer-Rechner im Dachgeschoss';
const TREE_DE = 'Die Pýchavkas aus Mlýnky in Mähren';
function photo(name: string, n: number): { name: string; mimeType: string; buffer: Buffer } {
    return { name, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from(`mlynky-${n}`)]) };
}
const ACCEPTS = {
    mode: 'research', sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } },
};
const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 20 NOV 2026',
    `1 _STROM_TREE ${TREE}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Pýchavkovi z Mlýnků',
    '0 @P0001@ INDI', '1 NAME Bonifác /Pýchavka/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Holubinka /Ryzcová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Hřibík /Pýchavka/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');

let gw: FakeGateway;
let treeName = 'Pýchavkovi z Mlýnků';

function bridge(req: DeviceRequest, device: { id: string; name: string; kind: string }): TunnelReply | undefined {
    if (req.tree !== TREE) return { s: 404, body: { code: 'tree.unknown' } };
    if (req.p === 'status') {
        return { s: 200, body: {
            ok: true, tree: { id: TREE, name: treeName }, head: HEAD, links: ['send', 'open', 'live', 'app', 'setup'], accepts: ACCEPTS,
            inbox: { trees: [], material: 0 }, lastIntake: null, sends: [], waiting: [], features: ['device.gateway', 'material.list'],
            device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair', 'media.put'] },
        } };
    }
    if (req.p === 'tree.ged') return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: GED };
    if (/^batch\/[^/]+\/done$/.test(req.p)) return { s: 200, body: { ok: true, inputs: gw.media.length, known: 0, refused: 0, tasks: [] } };
    return undefined;
}

test.beforeEach(async () => {
    treeName = 'Pýchavkovi z Mlýnků';
    gw = await startDeviceGateway();
    gw.trees = [{ id: TREE, name: treeName, archive: false }];
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    gw.onTunnel = bridge;
});
test.afterEach(async () => {
    await gw.close();
});

const state = (page: Page): Promise<string | undefined> =>
    page.evaluate(() => (globalThis as unknown as { __stromDevice?: { connection(): { state: string } | null } }).__stromDevice?.connection()?.state);

async function pairedTree(page: Page, opts: { lang: 'en' | 'de'; width: number; dark?: boolean }): Promise<void> {
    await page.setViewportSize({ width: opts.width, height: opts.width < 641 ? 844 : 900 });
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    // A fixed clock away from midnight; the gateway's own clock agrees with it.
    const fixed = new Date('2026-11-24T13:05:00Z').getTime();
    await page.clock.setFixedTime(fixed);
    gw.clockOffsetMs = fixed - Date.now();
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await seedSetting(page, 'onThisDay', false);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom.map.timeTipSeen', '1');
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
    await page.goto(gw.pairCode().url);
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect.poll(() => state(page), { timeout: 15000 }).toBe('connected');
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 15000 });
    await expect(card(page, 'Hřibík')).toBeVisible();
    await page.evaluate(() => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ modeAsked: true, skipPreview: true, placesOffer: 'done' }));
    });
    if (opts.lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await poll(page);
}

/**
 * Photos kept on the device for the tree (`batch:<tree>` in its queue, the files as Blobs) and one
 * edit. `handed`: sent (Send) and left by a reload without their batch, kept as the app keeps
 * them (by the open tree); else only chosen.
 */
async function keptPhotos(page: Page, names: string[], handed = false): Promise<void> {
    await page.evaluate(async ({ research, names, png, handed }) => {
        const tree = handed ? window.Strom.TreeManager.getActiveTreeId()! : research;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('strom-device', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const photos = names.map((name, i) => {
            const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
            const blob = new File([bytes, new Uint8Array([i])], name, { type: 'image/png' });
            return { id: `p${i}`, blob, name, type: 'image/png', size: blob.size };
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('queue', 'readwrite');
            tx.objectStore('queue').put({ treeId: tree, name: '', personId: '', note: '', photos, ...(handed ? { handedAt: '2026-11-24T12:50:00Z' } : {}) }, `batch:${tree}`);
            tx.objectStore('queue').put({ kind: 'edit', changes: 1 }, 'edit-1');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, { research: TREE, names, png: PNG.toString('base64'), handed });
}

async function queueKeys(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('strom-device', 1); r.onsuccess = () => resolve(r.result); });
        const keys = await new Promise<IDBValidKey[]>((resolve) => { const r = db.transaction('queue').objectStore('queue').getAllKeys(); r.onsuccess = () => resolve(r.result); });
        db.close();
        return keys.map(String).sort();
    });
}

/** The computer away: each connection closed, the device tries again at once. */
async function goAway(page: Page, expected = 'unreachable'): Promise<void> {
    gw.unreachable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => state(page)).toBe(expected);
    await expect(page.locator('#device-qline')).toBeVisible();
}

/** Nothing past the window; the quiet line under the toolbar, nothing floating over it. */
async function expectFits(page: Page): Promise<void> {
    const m = await page.evaluate(() => {
        const line = document.getElementById('device-qline')!;
        const r = line.getBoundingClientRect();
        const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
        const out = [...line.querySelectorAll<HTMLElement>('*')].filter(el => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && (b.right > window.innerWidth + 0.5 || b.left < -0.5 || b.bottom > r.bottom + 0.5);
        }).map(el => el.className || el.tagName);
        const visible = (el: Element) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
        const over = [...document.querySelectorAll('.focus-controls, .collab-bar, .descendants-badge, .research-overview')]
            .filter(visible).filter(el => { const b = el.getBoundingClientRect(); return b.top < r.bottom - 0.5 && b.bottom > r.top + 0.5 && b.left < r.right && b.right > r.left; })
            .map(el => el.className);
        return { page: document.documentElement.scrollWidth - window.innerWidth, line: line.scrollWidth - line.clientWidth, out, over, under: r.top - bar.bottom };
    });
    expect(m.page, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.line, 'the quiet line scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.out, 'outside the quiet line').toEqual([]);
    expect(m.over, 'over the quiet line').toEqual([]);
    expect(m.under, 'the quiet line under the toolbar').toBeGreaterThanOrEqual(-0.5);
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

const DLG = '#batch-modal .batch-dialog';

test.describe('a phone of the home network (touch)', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('not reachable: the quiet line, the tree read only and dimmed, the research grey but Add materials, what waits, Try again, back', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await keptPhotos(page, ['svatba-1924.png', 'mlyn.png', 'kaplicka.png']);
        await goAway(page);
        const line = page.locator('#device-qline');
        await expect(line).toContainText('The computer Pracovna is not reachable. The state shown is the last one known (');
        await expect(line).toContainText(/known \((02:05 PM|14:05|13:05)\)/);
        await expect(line.locator('[data-act="pending"]')).toHaveText('Waiting to be sent: 3 photos, 1 edit ›');
        await expect(line.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(page.locator('#current-tree-conn')).toContainText('Pracovna');
        // Read only as last known: locked, cards dimmed
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        expect(await card(page, 'Hřibík').evaluate(el => getComputedStyle(el.closest('.person-card') ?? el).opacity)).toBe('0.62');
        expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
        await expectFits(page);
        await shot(page, 'd7a-unreachable-en-390');

        // The More sheet: the state, the rows grey, Add materials… still there
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('#research-sheet-state')).toContainText('The computer Pracovna is not reachable · last known state ');
        await expect(sheet.locator('#sheet-research-item-overview')).toHaveAttribute('aria-disabled', 'true');
        await expect(sheet.locator('#sheet-research-item-batch')).not.toHaveAttribute('aria-disabled', 'true');
        await shot(page, 'd7a-more-en-390');
        await sheet.locator('#sheet-research-item-overview').dispatchEvent('click');
        await expect(page.locator('#research-overview')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.hideBottomSheet());

        // What waits: the photos, Save, Discard…
        await line.locator('[data-act="pending"]').tap();
        const list = page.locator('.device-waiting-sheet');
        await expect(list).toBeVisible();
        await expect(list).toContainText('Waiting on this device');
        // Only chosen photos and edits sent by hand: neither goes by itself (K3.8), the sentence says how they go
        await expect(list.locator('.device-waiting-note')).toHaveText('Edits are sent with “Send to research” once Pracovna is reachable. Photos not sent yet go with “Add materials…”.');
        await expect(list.locator('.device-waiting-th')).toHaveCount(3);
        await expect(list.getByRole('button', { name: 'Save photos to the device' })).toBeVisible();
        await expect(list.getByRole('button', { name: 'Discard…' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await shot(page, 'd7a-waiting-en-390');
        // Discard… asked first; Cancel keeps all
        await list.getByRole('button', { name: 'Discard…' }).tap();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toContainText('3 photos and 1 edit will be deleted from this device and will not reach the research. This cannot be undone.');
        await confirm.getByRole('button', { name: 'Cancel' }).tap();
        expect(await queueKeys(page)).toEqual([`batch:${TREE}`, 'edit-1']);
        await page.evaluate(() => window.Strom.UI.closeDeviceWaiting());

        // Still away: Try again keeps the line
        await line.getByRole('button', { name: 'Try again' }).tap();
        await expect.poll(() => state(page)).toBe('unreachable');
        await expect(line).toBeVisible();
        // Back
        gw.unreachable = false;
        await line.getByRole('button', { name: 'Try again' }).tap();
        await expect.poll(() => state(page)).toBe('connected');
        await expect(page.locator('.toast', { hasText: 'Reconnected.' })).toBeVisible();
        await expect(page.locator('#device-qline')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/tree-locked/);
        // nothing was discarded
        expect(await queueKeys(page)).toEqual([`batch:${TREE}`, 'edit-1']);
    });

    test('a batch cut off by the computer away goes on by itself when it is back, the toast says what is sent', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await page.evaluate(() => window.Strom.UI.showBatchDialog());
        const dlg = page.locator(DLG);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2060.png', 60), photo('IMG_2061.png', 61), photo('IMG_2062.png', 62)]);
        await dlg.locator('[data-act="next"]').tap();
        gw.unreachable = true;
        await dlg.locator('[data-act="go"]').tap();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unreachable');
        await expect(page.locator('#device-qline [data-act="pending"]')).toHaveText('Waiting to be sent: 3 photos ›');
        await dlg.locator('[data-act="hide"]').tap().catch(() => undefined);
        gw.unreachable = false;
        await page.locator('#device-qline').getByRole('button', { name: 'Try again' }).tap();
        await expect(page.locator('.toast', { hasText: 'Reconnected – sending 3 photos.' })).toBeVisible();
        await expect.poll(() => gw.media.length, { timeout: 15000 }).toBe(3);
        await expect.poll(() => queueKeys(page), { timeout: 15000 }).toEqual([]);
    });

    test('photos handed over and left by a reload go by themselves when the computer is back; edits sent by hand stay', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await keptPhotos(page, ['svatba-1924.png', 'mlyn.png', 'kaplicka.png'], true);
        await goAway(page);
        await page.locator('#device-qline [data-act="pending"]').tap();
        const list = page.locator('.device-waiting-sheet');
        await expect(list.locator('.device-waiting-note')).toHaveText('Photos are sent automatically once Pracovna is reachable. Edits are sent with “Send to research” once Pracovna is reachable.');
        await page.evaluate(() => window.Strom.UI.closeDeviceWaiting());
        gw.unreachable = false;
        await page.locator('#device-qline').getByRole('button', { name: 'Try again' }).tap();
        await expect(page.locator('.toast', { hasText: 'Reconnected – sending 3 photos.' })).toBeVisible();
        await expect.poll(() => gw.media.length, { timeout: 15000 }).toBe(3);
        // the photos left the queue; the edit sent by hand stays
        await expect.poll(() => queueKeys(page), { timeout: 15000 }).toEqual(['edit-1']);
    });

    test('photos handed over and left by a reload go by themselves once the research answers after the reload', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await keptPhotos(page, ['svatba-1924.png', 'mlyn.png'], true);
        await page.reload();
        await expect.poll(() => state(page), { timeout: 15000 }).toBe('connected');
        await expect.poll(() => gw.media.length, { timeout: 15000 }).toBe(2);
        await expect.poll(() => queueKeys(page), { timeout: 15000 }).toEqual(['edit-1']);
    });

    test('photos sent while the computer is away are kept as handed over (they go by themselves after a reload too)', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await page.evaluate(() => window.Strom.UI.showBatchDialog());
        const dlg = page.locator(DLG);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2080.png', 80), photo('IMG_2081.png', 81)]);
        await dlg.locator('[data-act="next"]').tap();
        gw.unreachable = true;
        await dlg.locator('[data-act="go"]').tap();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unreachable');
        // The page is served by the gateway: a reload while it is away cannot be had here; the batch kept
        // on the device says it was handed over, which is what a reload leaves (the tests above).
        const handed = await page.evaluate(async () => {
            const tree = window.Strom.TreeManager.getActiveTreeId()!;
            const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('strom-device', 1); r.onsuccess = () => resolve(r.result); });
            const v = await new Promise<{ handedAt?: string; photos: unknown[] } | undefined>((resolve) => {
                const r = db.transaction('queue').objectStore('queue').get(`batch:${tree}`);
                r.onsuccess = () => resolve(r.result as never);
            });
            db.close();
            return { handed: typeof v?.handedAt === 'string', photos: v?.photos.length ?? 0 };
        });
        expect(handed).toEqual({ handed: true, photos: 2 });
        await dlg.locator('[data-act="hide"]').tap().catch(() => undefined);
        await page.evaluate(() => window.Strom.UI.showDeviceWaiting());
        await expect(page.locator('.device-waiting-sheet .device-waiting-note')).toHaveText('Sent automatically once Pracovna is reachable.');
    });

    test('photos only chosen do not go by themselves when the computer is back', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await keptPhotos(page, ['svatba-1924.png']);
        await goAway(page);
        gw.unreachable = false;
        await page.locator('#device-qline').getByRole('button', { name: 'Try again' }).tap();
        await expect(page.locator('.toast', { hasText: 'Reconnected.' })).toBeVisible();
        await poll(page);
        await page.waitForTimeout(500);
        expect(gw.media.length).toBe(0);
        expect(await queueKeys(page)).toEqual([`batch:${TREE}`, 'edit-1']);
    });

    test('Discard… while a cut-off batch waits: it stops and keeps none of its photos again', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await page.evaluate(() => window.Strom.UI.showBatchDialog());
        const dlg = page.locator(DLG);
        await dlg.locator('#batch-input-gallery').setInputFiles([photo('IMG_2070.png', 70), photo('IMG_2071.png', 71)]);
        await dlg.locator('[data-act="next"]').tap();
        gw.unreachable = true;
        await dlg.locator('[data-act="go"]').tap();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unreachable');
        await dlg.locator('[data-act="hide"]').tap().catch(() => undefined);
        await page.evaluate(() => window.Strom.UI.closeBatchDialog?.());
        await page.locator('#device-qline [data-act="pending"]').tap();
        await page.locator('.device-waiting-sheet').getByRole('button', { name: 'Discard…' }).tap();
        await page.locator('#confirmation-modal').getByRole('button', { name: 'Discard', exact: true }).tap();
        // the batch stops (its close tried once), nothing of it kept again
        await expect.poll(() => page.evaluate(() => window.Strom.UI.batchSheetRow() === null), { timeout: 10000 }).toBe(true);
        await expect.poll(() => queueKeys(page)).toEqual([]);
        await page.waitForTimeout(500);
        expect(await queueKeys(page)).toEqual([]);
        await expect(page.locator('#device-qline [data-act="pending"]')).toHaveCount(0);
        gw.unreachable = false;
        await page.locator('#device-qline').getByRole('button', { name: 'Try again' }).tap();
        await expect(page.locator('.toast', { hasText: 'Reconnected.' })).toBeVisible();
        expect(gw.media.length).toBe(0);
    });

    test('no network: only on the home network; back when the network is', async ({ page, context }) => {
        await pairedTree(page, { lang: 'en', width: 390 });
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await expect.poll(() => state(page)).toBe('offline');
        const line = page.locator('#device-qline');
        await expect(line).toContainText('The research is available only on the home network of Pracovna.');
        await expect(page.locator('body')).toHaveClass(/tree-locked/);
        await expectFits(page);
        await shot(page, 'd7a-offline-en-390');
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('connected');
        await expect(line).toHaveCount(0);
    });
});

test.describe('a computer', () => {
    test('switched off on the computer (404) reads as not reachable; unpaired (401): the tree goes, what waits stays, Discard… asked first', async ({ page }) => {
        await pairedTree(page, { lang: 'en', width: 1440 });
        // Each sealed request refused as the gateway does for a device switched off
        await page.route('**/device/x', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'device.disabled' }) }));
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('disabled');
        await expect(page.locator('#device-qline')).toContainText('The computer Pracovna is not reachable.');
        await page.unroute('**/device/x');
        await page.locator('#device-qline').getByRole('button', { name: 'Try again' }).click();
        await expect.poll(() => state(page), { timeout: 15000 }).toBe('connected');
        await expect(page.locator('#device-qline')).toHaveCount(0);

        await keptPhotos(page, ['svatba-1924.png', 'mlyn.png']);
        await page.route('**/device/x', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'device.unpaired' }) }));
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => state(page)).toBe('unpaired');
        const line = page.locator('#device-qline');
        await expect(line).toContainText('This device is no longer paired');
        await expect(line.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        // nothing unsent in the tree: it goes with the pairing
        await expect(card(page, 'Hřibík')).toHaveCount(0);
        await expect(line.locator('[data-act="pending"]')).toHaveText('Waiting to be sent: 2 photos, 1 edit ›');
        await expectFits(page);
        await shot(page, 'd7a-unpaired-en-1440');
        await line.locator('[data-act="pending"]').click();
        const dlg = page.locator('#device-waiting-modal');
        await expect(dlg).toContainText('They stay on this device');
        await dlg.getByRole('button', { name: 'Discard…' }).click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toContainText('2 photos and 1 edit will be deleted from this device');
        await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(dlg).toHaveCount(0);
        expect(await queueKeys(page)).toEqual([]);
        await expect(line.locator('[data-act="pending"]')).toHaveCount(0);
    });
});

test.describe('German, a long computer and tree name', () => {
    for (const width of [1024, 1440]) {
        test(`no quiet sync mark beside the tree switcher at ${width}: the switcher's second line carries the computer's state (094 §3.1)`, async ({ page }) => {
            await pairedTree(page, { lang: 'de', width });
            await keptPhotos(page, ['hochzeit-1924.png']);
            const mark = page.locator('#research-sync-mark');
            await expect(page.locator('#current-tree-conn .phone-dot')).toBeVisible();
            await expect(mark).toHaveCount(0);
            await goAway(page);
            await expect(page.locator('#device-qline')).toContainText('nicht erreichbar');
            await expect(mark).toHaveCount(0);
        });
    }

    for (const width of [390, 1024, 1440]) {
        test(`the quiet line and what waits at ${width}, light and dark: nothing overflows or overlaps`, async ({ page }) => {
            treeName = TREE_DE;
            gw.trees = [{ id: TREE, name: TREE_DE, archive: false }];
            gw.computer = { name: '127.0.0.1', label: PC_DE };
            await pairedTree(page, { lang: 'de', width });
            await keptPhotos(page, ['hochzeit-1924.png', 'muehle.png', 'kapelle.png', 'hof.png', 'brunnen.png', 'schule.png', 'kirche.png']);
            await goAway(page);
            const line = page.locator('#device-qline');
            await expect(line).toContainText(`Der Computer ${PC_DE} ist nicht erreichbar.`);
            await expect(line.locator('[data-act="pending"]')).toHaveText('Wartet auf das Senden: 7 Fotos, 1 Änderung ›');
            for (const scheme of ['light', 'dark'] as const) {
                await page.emulateMedia({ colorScheme: scheme });
                await expectFits(page);
                await shot(page, `d7a-unreachable-de-${width}-${scheme}`);
                await line.locator('[data-act="pending"]').click();
                const host = page.locator('.device-waiting');
                await expect(host).toBeVisible();
                await expect(host.locator('.device-waiting-note')).toHaveText(`Änderungen werden mit „An Forschung senden“ gesendet, sobald ${PC_DE} erreichbar ist. Noch nicht gesendete Fotos gehen über „Materialien hinzufügen…“.`);
                const over = await page.evaluate(() => {
                    const root = document.querySelector('.device-waiting')!;
                    const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth) + 1;
                    return [...root.querySelectorAll<HTMLElement>('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > edge; }).map(el => el.className)
                        .concat(document.documentElement.scrollWidth > window.innerWidth ? ['page'] : []);
                });
                expect(over).toEqual([]);
                await shot(page, `d7a-waiting-de-${width}-${scheme}`);
                await page.evaluate(() => window.Strom.UI.closeDeviceWaiting());
                await expect(host).toHaveCount(0);
            }
        });
    }
});
