import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
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
 * Cancel, and a failure says so with Try again. Invented data only (the
 * Pýchavkovi of Mlýnky, the computer Pracovna).
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';

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
 * `fail`: `tree.ged` answers 500 until asked again after the failure is said (its variant by hash, then the whole file it falls back to); `slowMs`: every `tree.ged` answers after it (the bridge building the tree).
 */
function research(gw: FakeGateway, o: { hold?: Promise<void>; fail?: boolean; slowMs?: number } = {}): Asked {
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

    test('the download shows its progress over the start screen; Cancel stops it, nothing opened', async ({ page }) => {
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
        await expect(page.locator('#device-boot')).toHaveCount(0);
        release();
        await page.waitForTimeout(500);
        await expect(page.locator('.person-card', { hasText: 'Josef' })).toHaveCount(0);
        expect(asked.trees).toHaveLength(1);
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
});
