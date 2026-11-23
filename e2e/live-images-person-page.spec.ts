import { test, expect, Page, Locator } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The person page in the app's window while the photos come after the tree
 * (spec 116 §5): a portrait on its way shows the initials in its square
 * under the veil and comes in place once it arrives; one that did not come
 * keeps the square calm, without the zoom, with "The photo did not load"
 * and Try again under it, which brings it once the bridge can. The page
 * never shows a broken image. A bridge whose `POST /images` is held until
 * the test lets it answer (or refused while `fail`). Invented data only.
 */

const UUID = '9b3e6c14-7a52-4d08-b1f6-2c8d5e7a9f30';
const BRIDGE = 'http://127.0.0.1:5995/0123456789abcdef0123456789abcdef';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const HEAD = '1c2d3e4f5a6b';

type Img = { b64: string; sha: string; url: string };

async function makeImage(page: Page): Promise<Img> {
    await page.goto('about:blank');
    const url = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 40;
        const g = c.getContext('2d')!;
        g.fillStyle = '#7a3';
        g.fillRect(0, 0, 40, 40);
        return c.toDataURL('image/jpeg', 0.9);
    });
    const b64 = url.slice(url.indexOf(',') + 1);
    return { b64, url, sha: createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex') };
}

function ged(img: Img): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 20 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 CHAR UTF-8', '1 NOTE Pšeniční',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 BIRT', '2 DATE 1898', '1 REFN P0001',
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', `2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg', '3 _WIDTH 40', '3 _HEIGHT 40',
        `3 _BYTES ${Buffer.from(img.b64, 'base64').length}`,
        '0 TRLR',
    ].join('\n');
}

interface Bridge { release(): void; fail: boolean }

async function follow(page: Page, img: Img, o: { fail?: boolean } = {}): Promise<Bridge> {
    await page.clock.install({ time: new Date('2026-11-20T10:30:00Z') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    let open: () => void = () => {};
    const gate = new Promise<void>(r => { open = r; });
    const bridge: Bridge = { release: () => open(), fail: !!o.fail };
    const status = () => ({
        tree: { id: UUID, name: 'Pšeniční' }, head: HEAD, persons: 1, working: [], waiting: [], queue: [],
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
            return route.fulfill({ status: 200, headers: { ...heads, 'content-type': 'text/plain; charset=utf-8' }, body: ged(img) });
        }
        if (path.endsWith('/images') && req.method() === 'POST') {
            if (bridge.fail) return route.fulfill({ status: 404, headers: cors, body: '' });
            const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
            await gate;
            const images = shas.filter(s => s === img.sha)
                .map(sha => ({ sha, mime: 'image/jpeg', bytes: Buffer.from(img.b64, 'base64').length, data: img.b64 }));
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ images, missing: shas.filter(s => s !== img.sha), more: [] }) }).catch(() => {});
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

async function openPage(page: Page): Promise<void> {
    const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Hostivít')!.id as string);
    await page.evaluate(i => window.Strom.UI.showPersonPage(i as never), id);
    await expect(page.locator('#person-page-modal')).toBeVisible();
}

/** No image of the page is a stand-in or broken. */
/**
 * The picture an <img> shows, as a data URL of its bytes: a pooled image shows
 * through an object URL (spec 135), so its content is compared, not its address.
 */
async function shownPicture(img: Locator): Promise<string | null> {
    return img.evaluate(async (el) => {
        const src = (el as HTMLImageElement).getAttribute('src') ?? '';
        if (!src.startsWith('blob:')) return src || null;
        const blob = await (await fetch(src)).blob();
        return new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsDataURL(blob);
        });
    });
}

async function noBrokenImages(page: Page): Promise<void> {
    const srcs = await page.locator('#person-page-modal img').evaluateAll(els => els.map(e => (e as HTMLImageElement).getAttribute('src') ?? ''));
    for (const s of srcs) expect(s).not.toContain('strom-image');
}

test.describe('the person page while photos come after the tree (spec 116 §5)', () => {
    test('the portrait on its way: the initials under the veil, then the photo in place', async ({ page }) => {
        const img = await makeImage(page);
        const bridge = await follow(page, img);
        await openPage(page);
        const portrait = page.locator('#person-page-modal .pp-portrait');
        await expect(portrait).toHaveAttribute('data-img-state', 'loading');
        await expect(portrait).toHaveAttribute('aria-label', 'photo loading');
        await expect(portrait.locator('.pp-initials-text')).toHaveText('HP');
        await expect(portrait.locator('.pp-portrait-zoom')).toHaveCount(0);
        await noBrokenImages(page);

        bridge.release();
        await expect.poll(() => shownPicture(portrait.locator('img.pp-photo'))).toBe(img.url);
        await expect(portrait).not.toHaveAttribute('data-img-state', /loading|failed/);
        await expect(portrait.locator('.pp-portrait-zoom')).toHaveCount(1);
    });

    test('the bridge cannot give it: the calm square, "The photo did not load" and Try again, which brings it', async ({ page }) => {
        const img = await makeImage(page);
        const bridge = await follow(page, img, { fail: true });
        await openPage(page);
        const portrait = page.locator('#person-page-modal .pp-portrait');
        const msg = page.locator('#person-page-modal .pp-img-msg');
        await expect(msg).toContainText('The photo did not load.');
        await expect(portrait).toHaveAttribute('aria-label', 'photo not loaded');
        await expect(portrait).not.toHaveAttribute('data-img-state', 'loading');
        await expect(portrait.locator('.pp-portrait-zoom')).toHaveCount(0);
        await noBrokenImages(page);

        bridge.fail = false;
        bridge.release();
        await msg.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect.poll(() => shownPicture(portrait.locator('img.pp-photo'))).toBe(img.url);
        await expect(msg).toHaveCount(0);
    });
});
