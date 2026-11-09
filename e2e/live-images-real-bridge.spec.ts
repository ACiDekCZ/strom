import { test, expect, type Page, type Response } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * "Follow live" against a REAL research bridge that gives its tree with the
 * images by their hash (`ged.imagesByHash`, spec 071), not a mock: the first
 * load asks `tree.ged?images=ref` and the images by `POST /images`, every
 * excerpt shows; a fact changed in the research brings the slim file and no
 * image; a new excerpt exactly one; a reload none; the bridge stopped, the
 * stored tree still shows them; the images equal, by SHA-256, those of the
 * file with its images in it.
 *
 * STROM_E2E_IMAGES_BRIDGE: a JSON file describing a synthetic research (made
 * of invented data in a sandbox of its own) and its running bridge:
 * `{ url, change, excerpt, stop }` — `change` a shell command that changes a
 * fact (no new excerpt), `excerpt` one that adds a source with one new
 * excerpt, `stop` one that ends the bridge. Not set (CI): skipped.
 */

interface ImagesBridge { url: string; change: string; excerpt: string; stop: string }

const FILE = process.env.STROM_E2E_IMAGES_BRIDGE ?? '';
const BRIDGE: ImagesBridge | null = FILE ? JSON.parse(fs.readFileSync(FILE, 'utf8')) as ImagesBridge : null;
const ORIGIN = 'http://localhost';

interface TreeAsk { ref: boolean; status: number; at: number }
interface ImagesAsk { shas: string[]; got: number; at: number }

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Each excerpt image of the file with its images in it (data URLs joined from their CONC lines). */
function imagesOfFullFile(ged: string): string[] {
    const out: string[] = [];
    const lines = ged.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = /^\d+ FILE data:image\/jpeg;base64,(.*)$/.exec(lines[i]);
        if (!m) continue;
        let b64 = m[1];
        while (/^\d+ CONC /.test(lines[i + 1] ?? '')) b64 += lines[++i].replace(/^\d+ CONC /, '');
        out.push(sha(Buffer.from(b64, 'base64')));
    }
    return out;
}

async function bridgeGet(path: string): Promise<{ status: number; text: string }> {
    const res = await fetch(`${BRIDGE!.url}${path}`, { headers: { Origin: ORIGIN } });
    return { status: res.status, text: await res.text() };
}

async function bridgeHead(): Promise<string> {
    return (JSON.parse((await bridgeGet('/status')).text) as { head: string }).head;
}

function run(cmd: string): void {
    execFileSync('bash', ['-c', cmd], { stdio: 'ignore', timeout: 120_000 });
}

/** The excerpt images the app's tree holds now, by their SHA-256 (each decoded by the browser). */
async function appImages(page: Page): Promise<{ shas: string[]; decoded: boolean }> {
    const urls = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources ?? {})
        .flatMap(s => (s.excerpts ?? []).map(e => e.dataUrl ?? '')));
    const decoded = await page.evaluate(async (list) => {
        const ok = await Promise.all(list.map(u => new Promise<boolean>(resolve => {
            if (!u.startsWith('data:image/jpeg;base64,')) return resolve(false);
            const img = new Image();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = u;
        })));
        return ok.every(Boolean);
    }, urls);
    return { shas: urls.map(u => sha(Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'))), decoded };
}

/** The followed tree's research head (what the app holds). */
const appHead = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head ?? null);

const cards = (page: Page) => page.locator('#tree-canvas .person-card');

test.describe('follow live against a real bridge with images by hash', () => {
    if (!BRIDGE) {
        test('first load, a fact, a new excerpt, a reload, the bridge stopped', () => {
            test.skip(true, 'STROM_E2E_IMAGES_BRIDGE not set');
        });
        return;
    }

    test('first load, a fact, a new excerpt, a reload, the bridge stopped', async ({ page }) => {
        test.setTimeout(10 * 60_000);
        const bridge = BRIDGE;
        const trees: TreeAsk[] = [];
        const images: ImagesAsk[] = [];
        const pending: Promise<void>[] = [];
        // Each answer as it comes (a 304 has no body the app reads: its request never "finishes").
        page.on('response', (res: Response) => {
            const req = res.request();
            if (!req.url().startsWith(bridge.url)) return;
            const u = new URL(req.url());
            if (u.pathname.endsWith('/tree.ged')) {
                trees.push({ ref: u.searchParams.get('images') === 'ref', status: res.status(), at: Date.now() });
            } else if (u.pathname.endsWith('/images') && req.method() === 'POST') {
                const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
                const at = Date.now();
                pending.push(res.body().then(body => {
                    images.push({ shas, got: (JSON.parse(body.toString('utf8')) as { images: unknown[] }).images.length, at });
                }, () => {
                    images.push({ shas, got: 0, at });
                }));
            }
        });
        const fetched = () => images.reduce((n, a) => n + a.got, 0);

        await page.setViewportSize({ width: 1440, height: 900 });
        await seedResearchPromoSeen(page);
        await seedWhatsNewSeen(page);
        await seedSetting(page, 'fileCopyReminders', false);
        await seedSetting(page, 'onThisDay', false);
        await page.addInitScript(() => {
            (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
            try {
                localStorage.setItem('strom-tour-offered', '1');
                localStorage.setItem('strom-live-motion', '0');
            } catch { /* no storage */ }
        });

        // The research's files, as the bridge gives them to anyone (the file with its images in it, and by reference).
        const full = await bridgeGet('/tree.ged');
        const slim = await bridgeGet('/tree.ged?images=ref');
        expect([full.status, slim.status]).toEqual([200, 200]);
        const fullShas = imagesOfFullFile(full.text);
        const refShas = [...slim.text.matchAll(/^\d+ FILE strom-image:([0-9a-f]{64})/gm)].map(m => m[1]);
        expect(fullShas.length).toBeGreaterThan(1);
        expect(refShas).toEqual(fullShas);

        // 1. The first load: the file by reference, its images by POST /images, every excerpt there and shown.
        const head0 = await bridgeHead();
        await page.goto(`/strom.html?live=${encodeURIComponent(bridge.url)}`);
        await expect(page.locator('#live-panel')).toBeVisible({ timeout: 60_000 });
        await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => appHead(page), { timeout: 60_000 }).toBe(head0);
        expect(trees[0]).toMatchObject({ ref: true, status: 200 });
        expect(trees.every(t => t.ref)).toBe(true);
        await Promise.all(pending);
        expect(images.length).toBeGreaterThan(0);
        expect(fetched()).toBe(new Set(fullShas).size);
        let got = await appImages(page);
        expect(got.decoded).toBe(true);
        // The same images, byte for byte (by SHA-256), as the file with its images in it.
        expect([...got.shas].sort()).toEqual([...fullShas].sort());
        expect(JSON.stringify(await page.evaluate(() => window.Strom.DataManager.getData()))).not.toContain('strom-image:');
        // One source's viewer shows its excerpts as pictures.
        const shown = await page.evaluate(() => {
            const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find(s => (s.excerpts ?? []).length > 0)!;
            window.Strom.UI.showSourceViewer(src.id, null);
            return src.excerpts!.length;
        });
        const viewerImgs = page.locator('#source-viewer-modal figure.viewer-excerpt img');
        await expect(viewerImgs).toHaveCount(shown);
        await expect.poll(() => viewerImgs.evaluateAll(els => els.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await page.keyboard.press('Escape');

        // 2. A fact changed in the research: the slim file again, no image.
        let files = trees.length;
        let asks = images.length;
        run(bridge.change);
        const head1 = await bridgeHead();
        expect(head1).not.toBe(head0);
        await expect.poll(() => appHead(page), { timeout: 120_000 }).toBe(head1);
        expect(trees.length).toBeGreaterThan(files);
        expect(trees.slice(files).every(t => t.ref && t.status === 200)).toBe(true);
        await Promise.all(pending);
        expect(images.length).toBe(asks);

        // 3. A new excerpt: exactly its image.
        files = trees.length;
        asks = images.length;
        run(bridge.excerpt);
        const head2 = await bridgeHead();
        await expect.poll(() => appHead(page), { timeout: 120_000 }).toBe(head2);
        const full2 = imagesOfFullFile((await bridgeGet('/tree.ged')).text);
        const added = full2.filter(s => !fullShas.includes(s));
        expect(added.length).toBe(1);
        await Promise.all(pending);
        expect(images.slice(asks).flatMap(a => a.shas)).toEqual(added);
        expect(images.slice(asks).reduce((n, a) => n + a.got, 0)).toBe(1);
        got = await appImages(page);
        expect(got.decoded).toBe(true);
        expect([...got.shas].sort()).toEqual([...full2].sort());

        // 4. The app reloaded: nothing downloaded again.
        files = trees.length;
        asks = images.length;
        await page.reload();
        await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => trees.length, { timeout: 60_000 }).toBeGreaterThan(files);
        await expect.poll(() => appHead(page), { timeout: 60_000 }).toBe(head2);
        await page.waitForTimeout(2000);
        await Promise.all(pending);
        expect(images.length).toBe(asks);
        test.info().annotations.push({ type: 'reload-tree-answers', description: JSON.stringify(trees.slice(files).map(t => t.status)) });

        // 4b. The research changed while the app was away: the slim file again, its images found in the stored
        // tree by their hash (a new page holds none in memory) — none downloaded.
        await page.goto('about:blank');
        run(bridge.change);
        const head3 = await bridgeHead();
        expect(head3).not.toBe(head2);
        files = trees.length;
        asks = images.length;
        await page.goto('/strom.html');
        await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => appHead(page), { timeout: 120_000 }).toBe(head3);
        expect(trees.slice(files).some(t => t.ref && t.status === 200)).toBe(true);
        expect(trees.slice(files).every(t => t.ref)).toBe(true);
        await page.waitForTimeout(2000);
        await Promise.all(pending);
        expect(images.length).toBe(asks);
        got = await appImages(page);
        expect(got.decoded).toBe(true);
        expect([...got.shas].sort()).toEqual([...full2].sort());

        // 5. The bridge stopped: the tree as stored, its images with it.
        run(bridge.stop);
        await page.reload();
        await expect(cards(page).first()).toBeVisible({ timeout: 60_000 });
        await expect.poll(async () => (await appImages(page)).shas.length, { timeout: 30_000 }).toBe(full2.length);
        got = await appImages(page);
        expect(got.decoded).toBe(true);
        expect([...got.shas].sort()).toEqual([...full2].sort());
    });
});
