import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Outputs wait for the tree's photos (spec 116 §8, K1.7): a print or a file
 * asked for while photos are still on their way waits for them — its row
 * says "Waiting for photos · k of n", the progress toast titled by the
 * output counts them with Cancel, a second click starts nothing, the
 * indicator is held back — and is made once they came. Some did not come:
 * one alert with why and three actions (Try again, Continue without N
 * photos, Cancel), no ✕; Continue without makes it from the data as they
 * are. A bridge whose `POST /images` is held until the test lets it
 * answer, or refused. `window.print` stubbed. Invented data only.
 */

const UUID = '3e8a1c5f-6b2d-4a97-8c0e-9f4d2b7a1e63';
const BRIDGE = 'http://127.0.0.1:5997/1a2b3c4d5e6f708192a3b4c5d6e7f809';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const HEAD = '7b8c9d0e1f2a';

type Img = { b64: string; sha: string; url: string };

/** Three portraits of their own colours, made by the browser. */
async function makeImages(page: Page): Promise<Img[]> {
    await page.goto('about:blank');
    const urls = await page.evaluate(() => ['#a73', '#3a7', '#73a'].map((color, i) => {
        const c = document.createElement('canvas');
        c.width = 40 + i * 4;
        c.height = 40;
        const g = c.getContext('2d')!;
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.9);
    }));
    return urls.map(url => {
        const b64 = url.slice(url.indexOf(',') + 1);
        return { b64, url, sha: createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex') };
    });
}

const portrait = (img: Img) => ['1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', `2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg',
    '3 _WIDTH 40', '3 _HEIGHT 40', `3 _BYTES ${Buffer.from(img.b64, 'base64').length}`];

function ged([a, b, c]: Img[]): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 20 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 CHAR UTF-8', '1 NOTE Pšeniční',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 BIRT', '2 DATE 1898', '1 REFN P0001', '1 FAMS @F0001@', ...portrait(a),
        '0 @P0002@ INDI', '1 NAME Ctirada /Pšeničná/', '1 SEX F', '1 BIRT', '2 DATE 1901', '1 REFN P0002', '1 FAMS @F0001@', ...portrait(b),
        '0 @P0003@ INDI', '1 NAME Velislava /Pšeničná/', '1 SEX F', '1 BIRT', '2 DATE 1926', '1 REFN P0003', '1 FAMC @F0001@', ...portrait(c),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@', '1 MARR', '2 DATE 12 MAY 1924',
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    /** Let the images held go (and every later ask until hold()). */
    release(): void;
    /** Hold the next asks again. */
    hold(): void;
    /** Refuse the asks (404) while true, a held one too once let go. */
    fail: boolean;
    asks: number;
}

/** Follow the research; the images it is asked for wait until `release()` (or are refused while `fail`). */
async function follow(page: Page, imgs: Img[], o: { phone?: boolean; fail?: boolean } = {}): Promise<Bridge> {
    await page.clock.install({ time: new Date('2026-11-20T10:30:00Z') });
    if (!o.phone) await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    let open: () => void = () => {};
    let gate = new Promise<void>(r => { open = r; });
    const bridge: Bridge = {
        release: () => open(),
        hold: () => { gate = new Promise<void>(r => { open = r; }); },
        fail: !!o.fail,
        asks: 0,
    };
    const byId = new Map(imgs.map(i => [i.sha, i]));
    const status = () => ({
        tree: { id: UUID, name: 'Pšeniční' }, head: HEAD, persons: 3, working: [], waiting: [], queue: [],
        features: ['ged.stale', 'ged.etag', 'ged.imagesByHash'],
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) {
            const heads = { ...cors, etag: `"${HEAD}"`, 'x-strom-head': HEAD, 'x-strom-images': url.searchParams.get('images') === 'ref' ? 'ref' : 'data' };
            return route.fulfill({ status: 200, headers: { ...heads, 'content-type': 'text/plain; charset=utf-8' }, body: ged(imgs) });
        }
        if (path.endsWith('/images') && req.method() === 'POST') {
            bridge.asks++;
            if (bridge.fail) return route.fulfill({ status: 404, headers: cors, body: '' });
            const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
            await gate;
            if (bridge.fail) return route.fulfill({ status: 404, headers: cors, body: '' }).catch(() => {});
            const images = shas.filter(s => byId.has(s)).map(sha => {
                const img = byId.get(sha)!;
                return { sha, mime: 'image/jpeg', bytes: Buffer.from(img.b64, 'base64').length, data: img.b64 };
            });
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ images, missing: shas.filter(s => !byId.has(s)), more: [] }) }).catch(() => {});
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(page.locator('#tree-canvas .person-card[aria-label^="Hostivít"]')).toBeVisible();
    return bridge;
}

const photos = (page: Page) => page.evaluate(() => window.Strom.DataManager.getAllPersons().filter(p => !!p.photo).length);

/** `window.print` records the moment instead: how many photos the tree had, and the poster's print sheet. */
async function stubPrint(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __prints: { photos: number; states: number; sheet: number }[]; print: () => void };
        w.__prints = [];
        w.print = () => {
            w.__prints.push({
                photos: window.Strom.DataManager.getAllPersons().filter(p => !!p.photo).length,
                states: document.querySelectorAll('#poster-print [data-img-state]').length,
                sheet: document.querySelectorAll('#poster-print img, #poster-print svg').length,
            });
        };
    });
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: { photos: number; states: number; sheet: number }[] }).__prints);

async function posterPrintRow(page: Page) {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    return poster.locator('.menu-option', { hasText: 'Print' });
}

const waitToast = (page: Page) => page.locator('.toast', { has: page.locator('.toast-title', { hasText: 'Printing the poster' }) });

test.describe('outputs wait for the photos (spec 116 §8)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('poster print: waits with its row and the toast, a second click starts nothing, prints once they came', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        await stubPrint(page);
        const row = await posterPrintRow(page);
        await row.click();
        // 8a: the row says it, the toast counts with Cancel, the indicator held back.
        await expect(row.locator('.option-busy')).toHaveText('Waiting for photos · 0 of 3');
        await expect(row).toHaveAttribute('aria-busy', 'true');
        const toast = waitToast(page);
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Waiting for photos');
        await expect(toast).toContainText('0 of 3');
        await expect(toast.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page.locator('#img-load-chip')).toBeHidden();
        await row.click({ force: true });
        await expect(waitToast(page)).toHaveCount(1);
        expect(await prints(page)).toEqual([]);

        bridge.release();
        await expect.poll(() => prints(page)).toHaveLength(1);
        const [p] = await prints(page);
        expect(p.photos).toBe(3);
        expect(p.states).toBe(0);
        await expect(waitToast(page)).toHaveCount(0);
        await expect(page.locator('.toast[data-kind="images-failed"]')).toHaveCount(0);
    });

    test('Cancel in the toast: no print, the row back at rest', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        await stubPrint(page);
        const row = await posterPrintRow(page);
        await row.click();
        const toast = waitToast(page);
        await expect(toast).toBeVisible();
        await toast.getByRole('button', { name: 'Cancel' }).click();
        await expect(row).not.toHaveAttribute('aria-busy', 'true');
        await expect(row.locator('.option-busy')).toHaveCount(0);
        bridge.release();
        await expect.poll(() => photos(page)).toBe(3);
        expect(await prints(page)).toEqual([]);
    });

    test('some did not come: one alert with why and three actions, no ✕; Continue without prints from the data as they are', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        await stubPrint(page);
        const row = await posterPrintRow(page);
        await row.click();
        await expect(waitToast(page)).toBeVisible();
        bridge.fail = true;
        bridge.release();
        // 8b: the alert titled by the output, why, the three actions.
        const alert = page.locator('.toast[role="alert"]', { has: page.locator('.toast-title', { hasText: 'Printing the poster' }) });
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('Some photos did not load (3). The research is not running.');
        await expect(alert.locator('.toast-action')).toHaveText(['Try again', 'Continue without 3 photos', 'Cancel']);
        await expect(alert.locator('.toast-close')).toHaveCount(0);
        // Through the bridge, no terminal, no agent: no mark.
        await expect(alert.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        // The output asks; the indicator's own notice does not ask again.
        await expect(page.locator('.toast[data-kind="images-failed"]')).toHaveCount(0);
        expect(await prints(page)).toEqual([]);
        await alert.getByRole('button', { name: 'Continue without 3 photos' }).click();
        await expect.poll(() => prints(page)).toHaveLength(1);
        expect((await prints(page))[0]).toMatchObject({ photos: 0, states: 0 });
        await expect(row).not.toHaveAttribute('aria-busy', 'true');
    });

    test('Try again after a failure: waits anew and prints with the photos', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { fail: true });
        await expect(page.locator('.toast[data-kind="images-failed"]')).toBeVisible();
        await stubPrint(page);
        const row = await posterPrintRow(page);
        await row.click();
        const alert = page.locator('.toast[role="alert"]', { has: page.locator('.toast-title', { hasText: 'Printing the poster' }) });
        await expect(alert).toBeVisible();
        await expect(page.locator('.toast[data-kind="images-failed"]')).toHaveCount(0);
        bridge.fail = false;
        bridge.release();
        await alert.getByRole('button', { name: 'Try again' }).click();
        await expect.poll(() => prints(page)).toHaveLength(1);
        expect((await prints(page))[0].photos).toBe(3);
    });

    test('backup: the Export button waits, the file carries the photos', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => { void window.Strom.UI.exportTargetTreeJSON(); });
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        await pwd.locator('#export-privacy-mode').selectOption('full');
        const btn = pwd.locator('#export-submit-btn');
        await btn.click();
        const toast = page.locator('.toast', { has: page.locator('.toast-title', { hasText: 'Data backup' }) });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Waiting for photos');
        const [download] = await Promise.all([page.waitForEvent('download'), (async () => { bridge.release(); })()]);
        const json = readFileSync(await download.path(), 'utf-8');
        for (const img of imgs) expect(json).toContain(img.b64.slice(0, 60));
        expect(json).not.toContain('strom-image:');
    });
});
