import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway, type TunnelReply } from './device-gateway.js';

/**
 * A device's first open of a research's tree through the fake gateway (spec
 * 094): the research keeps its tree's files and gives its images by their
 * hash (`ged.imagesByHash`, `media.app`), so the tree comes as on the
 * computer — `tree.ged?images=ref&media=app` and its images by `POST images`
 * — never the whole file with its images in it (a big research is 100 MB and
 * more over the home network, a phone's browser stuck on "Opening the
 * research…"). The download shows its progress over the start screen, with
 * Cancel, and a failure says so with Try again. A first open cancelled (or
 * failed, Try again not taken) goes back to the chooser of the research's
 * trees, never the app's own empty tree; Cancel of a tree chosen in the
 * switcher keeps the tree open before. Invented data only (the Pýchavkovi of
 * Mlýnky, the Hrotkovi of Hrotov, the computer Pracovna). `STROM_SHOTS_DIR`
 * set: screenshots go there.
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const HROT = '7b2e3d4f-5c6a-4b7c-9d8e-0f1a2b3c4d5e';

/** A 1×1 PNG: a real picture the browser can show. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SHA = createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex');

function ged(ref: boolean): string {
    const file = ref
        ? [`2 FILE strom-image:${SHA}`, '3 _MIME image/png', '3 _WIDTH 1', '3 _HEIGHT 1', `3 _BYTES ${Buffer.from(PNG, 'base64').length}`]
        : [`2 FILE data:image/png;base64,${PNG}`];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 25 NOV 2026', `1 _STROM_TREE ${PYCH}`, '1 _STROM_HEAD 3c7a9e1f05b2',
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Jan /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@', '1 SOUR @S0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Josef /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1880', '1 REFN P0003', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Matrika Mlýnky 1851', '1 REFN S0001',
        '1 OBJE', '2 FORM png', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0001', ...file,
        '0 TRLR',
    ].join('\n');
}

interface Asked {
    /** Every `tree.ged` asked: its query. */
    trees: Record<string, string>[];
    /** Every `POST images`: the hashes asked. */
    images: string[][];
}

/**
 * One tree of the research behind the gateway. `hold`: the answer of the next `tree.ged` waits for it;
 * `holdImages`: every `POST images` waits for it; `fail`: `tree.ged` answers 500 until asked again after the failure is said (its variant by hash, then the whole file it falls back to); `slowMs`: every `tree.ged` answers after it (the bridge building the tree).
 */
function research(gw: FakeGateway, o: { hold?: Promise<void>; holdImages?: Promise<void>; fail?: boolean; slowMs?: number } = {}): Asked {
    gw.trees = [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }];
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    const asked: Asked = { trees: [], images: [] };
    let hold = o.hold;
    let fail = o.fail ? 2 : 0;
    gw.onTunnel = async (req, device): Promise<TunnelReply | undefined> => {
        if (req.p === 'status') {
            return {
                s: 200,
                body: {
                    ok: true, features: ['device.gateway', 'ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app'],
                    tree: { id: PYCH, name: 'Pýchavkovi z Mlýnků' }, head: '3c7a9e1f05b2',
                    persons: 3, working: [], waiting: [], queue: [], links: [],
                    accepts: { mode: 'research', sync: { auto: 'off' } },
                    device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] },
                },
            };
        }
        if (req.p === 'tree.ged') {
            const q = (req as { q?: Record<string, string> }).q ?? {};
            asked.trees.push(q);
            if (hold) {
                const h = hold;
                hold = undefined;
                await h;
            }
            if (o.slowMs) await new Promise(r => setTimeout(r, o.slowMs));
            if (fail) {
                fail--;
                return { s: 500, body: { code: 'internal' } };
            }
            const ref = q.images === 'ref';
            return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Strom-Images': ref ? 'ref' : 'data' }, body: ged(ref) };
        }
        if (req.p === 'images' && req.m === 'POST') {
            const raw = (req as { b?: unknown }).b;
            const shas = (typeof raw === 'string' ? JSON.parse(raw) : raw as { images: string[] }).images as string[];
            asked.images.push(shas);
            if (o.holdImages) await o.holdImages;
            const images = shas.filter(s => s === SHA).map(sha => ({ sha, mime: 'image/png', bytes: Buffer.from(PNG, 'base64').length, data: PNG }));
            return { s: 200, body: { images, missing: shas.filter(s => s !== SHA), more: [] } };
        }
        return undefined;
    };
    return asked;
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

const loadToast = (page: Page) => page.locator('.toast[data-kind="tree-load"]');

/** The chooser of the research's trees on the start screen: the tree's row, nothing of the app's own empty tree to be seen. */
async function expectChooser(page: Page): Promise<void> {
    const boot = page.locator('#device-boot');
    await expect(boot).toHaveAttribute('data-state', 'trees');
    await expect(boot.locator('.device-tree-row')).toHaveCount(1);
    await expect(boot.locator('.device-tree-name')).toHaveText('Pýchavkovi z Mlýnků');
    // The start screen covers the page: the empty tree's "Add the first person" never what a tap meets.
    const covered = await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        return !!el?.closest('#device-boot');
    });
    expect(covered, 'the chooser over the page').toBe(true);
}

async function shot(page: Page, name: string): Promise<void> {
    const dir = process.env.STROM_SHOTS_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test.describe('en', () => {
    test.use({ locale: 'en-US' });

    test('the first open asks the tree with its images by hash, never the whole file', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw);
        await page.goto(gw.pairCode().url);
        await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 20000 });
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        expect(asked.trees.length, 'tree.ged asked').toBeGreaterThan(0);
        // The first ask already the variant with images by hash and the tree's own files.
        expect(asked.trees[0]).toMatchObject({ images: 'ref', media: 'app' });
        expect(asked.trees.filter(q => q.images !== 'ref'), 'the whole file with its images in it').toEqual([]);
        expect(asked.images.flat()).toContain(SHA);
    });

    test('a tree the bridge builds longer than a quick request (8 s) still opens', async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, { slowMs: 9_500 });
        await page.goto(gw.pairCode().url);
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 30000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        expect(asked.trees).toHaveLength(1);
    });

    test('the download shows its progress over the start screen; Cancel stops it, nothing opened, the chooser back', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        let release!: () => void;
        const asked = research(gw, { hold: new Promise<void>(r => { release = r; }) });
        await page.goto(gw.pairCode().url);
        await expect(page.locator('#device-boot')).toBeVisible({ timeout: 20000 });
        await expect(loadToast(page)).toBeVisible({ timeout: 20000 });
        await expect(loadToast(page).locator('.toast-title')).toHaveText('Loading the tree from the research…');
        await expect(loadToast(page).locator('.bar')).toBeVisible();
        // Over the start screen: its Cancel is what a tap there meets.
        const cancel = loadToast(page).getByRole('button', { name: 'Cancel' });
        const onTop = await cancel.evaluate((b) => {
            const r = b.getBoundingClientRect();
            return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        expect(onTop, 'Cancel above the start screen').toBe(true);
        await cancel.click();
        await expect(loadToast(page)).toHaveCount(0);
        // Back on the chooser of the research's trees: never the app's own empty tree under the research's connection.
        await expectChooser(page);
        release();
        await page.waitForTimeout(500);
        await expect(page.locator('.person-card', { hasText: 'Josef' })).toHaveCount(0);
        expect(asked.trees).toHaveLength(1);
        await shot(page, 'zrusit-vyber-390');
        // Chosen again from there: it opens.
        await page.locator('#device-boot .device-tree-row').first().click();
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        expect(asked.trees).toHaveLength(2);
    });

    test('Cancel while the images come stops them at once: "Opening…" gone, nothing opened, the chooser back', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        let release!: () => void;
        const asked = research(gw, { holdImages: new Promise<void>(r => { release = r; }) });
        await page.goto(gw.pairCode().url);
        await expect.poll(() => asked.images.length, { timeout: 20000 }).toBeGreaterThan(0);
        await loadToast(page).getByRole('button', { name: 'Cancel' }).click();
        // Not after the images asked already: at once, the answer still held — the chooser instead of "Opening…".
        await expect(page.locator('#device-boot')).toHaveAttribute('data-state', 'trees', { timeout: 3000 });
        await expect(loadToast(page)).toHaveCount(0);
        release();
        await page.waitForTimeout(500);
        await expect(page.locator('.person-card', { hasText: 'Josef' })).toHaveCount(0);
        expect(asked.images).toHaveLength(1);
    });

    test('a failed download says so with Try again, which opens the tree', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, { fail: true });
        await page.goto(gw.pairCode().url);
        const retry = page.locator('.toast').getByRole('button', { name: 'Try again' });
        await expect(retry).toBeVisible({ timeout: 20000 });
        await retry.click();
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        // The variant by hash, the whole file it fell back to (both refused), then by hash again.
        expect(asked.trees.map(q => q.images ?? 'data')).toEqual(['ref', 'data', 'ref']);
    });

    test('a failed download, Try again not taken: the chooser under its message, a tree chosen there opens', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        const asked = research(gw, { fail: true });
        await page.goto(gw.pairCode().url);
        const failed = page.locator('.toast').filter({ has: page.getByRole('button', { name: 'Try again' }) });
        await expect(failed).toBeVisible({ timeout: 20000 });
        await expectChooser(page);
        await failed.getByRole('button', { name: /close/i }).click();
        await expect(failed).toHaveCount(0);
        await expectChooser(page);
        await page.locator('#device-boot .device-tree-row').first().click();
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);
        expect(asked.trees.map(q => q.images ?? 'data')).toEqual(['ref', 'data', 'ref']);
    });

    test('Cancel of a tree chosen in the switcher: the tree open before stays, no chooser', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw);
        gw.trees = [{ id: PYCH, name: 'Pýchavkovi z Mlýnků', archive: false }, { id: HROT, name: 'Hrotkovi z Hrotova', archive: false }];
        // The first tree answers as research() does; the second one's file waits until released.
        const first = gw.onTunnel!;
        let release!: () => void;
        const held = new Promise<void>(r => { release = r; });
        let hrotAsked = 0;
        gw.onTunnel = async (req, device) => {
            if (req.tree === HROT && req.p === 'status') {
                const r = await first(req, device);
                return r && { ...r, body: { ...(r.body as object), tree: { id: HROT, name: 'Hrotkovi z Hrotova' } } };
            }
            if (req.tree === HROT && req.p === 'tree.ged') {
                hrotAsked++;
                await held;
                return { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged(false).replace(PYCH, HROT).replace(/Pýchavka/g, 'Hrotek') };
            }
            return first(req, device);
        };
        await page.goto(gw.pairCode().url);
        await page.locator('#device-boot .device-tree-row').first().click({ timeout: 20000 });
        await expect(page.locator('.person-card', { hasText: 'Josef' }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#device-boot')).toHaveCount(0);

        await page.locator('.tree-switcher-btn').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await sheet.locator('.device-tree-item').nth(1).click();
        await expect.poll(() => hrotAsked, { timeout: 15000 }).toBe(1);
        await loadToast(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(loadToast(page)).toHaveCount(0);
        release();
        await page.waitForTimeout(500);
        await expect(page.locator('#device-boot')).toHaveCount(0);
        await expect(page.locator('.person-card', { hasText: 'Josef Pýchavka' }).first()).toBeVisible();
        await expect(page.locator('.person-card', { hasText: 'Hrotek' })).toHaveCount(0);
        await expect(page.locator('#current-tree-name')).toHaveText('Pýchavkovi z Mlýnků');
    });
});
