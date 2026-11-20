import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The tree's files while the photos come after the tree (spec 116 §5): a
 * person's file on its way stands in the Materials window as its tile with
 * the type's letters under the veil and in the person's files as a calm
 * tile, read only; it comes in place once it arrives. One the bridge cannot
 * give is struck through with "Not loaded". No tile is ever a broken image
 * or a stand-in. A bridge whose `POST /images` is held until the test lets
 * it answer (or refused while `fail`). Invented data only.
 */

const UUID = '4f1a7d22-0c6e-4b93-a815-7e2d9c3b6a41';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const HEAD = '2d3e4f5a6b7c';

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
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND document', '2 TITL Výuční list', `2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg', '3 _WIDTH 40', '3 _HEIGHT 40',
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

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openMaterials({}));
    await expect(page.locator('#materials-modal')).toBeVisible();
}

/** No image of the place is a stand-in. */
async function noStandIns(page: Page, root: string): Promise<void> {
    const srcs = await page.locator(`${root} img`).evaluateAll(els => els.map(e => (e as HTMLImageElement).getAttribute('src') ?? ''));
    for (const s of srcs) expect(s).not.toContain('STROMPENDING');
}

test.describe('the tree\'s files while photos come after the tree (spec 116 §5)', () => {
    test('a file on its way: its tile under the veil with its letters, then the image in place', async ({ page }) => {
        const img = await makeImage(page);
        const bridge = await follow(page, img);
        await openWindow(page);
        const tile = page.locator('#materials-modal .mw-thumb').first();
        await expect(tile).toHaveAttribute('data-img-state', 'loading');
        await expect(tile.locator('.mw-type')).toHaveText(/\S/);
        await noStandIns(page, '#materials-modal');

        bridge.release();
        await expect(page.locator('#materials-modal .mw-thumb img').first()).toHaveAttribute('src', img.url);
        await expect(page.locator('#materials-modal .mw-thumb[data-img-state]')).toHaveCount(0);
    });

    test('the bridge cannot give it: "Not loaded" in the window, the person\'s file struck through and read only', async ({ page }) => {
        const img = await makeImage(page);
        await follow(page, img, { fail: true });
        await openWindow(page);
        const tile = page.locator('#materials-modal .mw-thumb[data-img-state="failed"]');
        await expect(tile).toHaveCount(1);
        await expect(tile).toContainText('Not loaded');
        await expect(tile).toHaveAttribute('title', 'The photo did not load.');
        await noStandIns(page, '#materials-modal');
        await page.keyboard.press('Escape');
        await expect(page.locator('#materials-modal')).toBeHidden();

        const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Hostivít')!.id as string);
        await page.evaluate(i => window.Strom.UI.showEditPersonModal(i as never), id);
        const row = page.locator('#attachments-list .attachment-row.is-waiting');
        await expect(row).toHaveCount(1);
        await expect(row.locator('.attachment-thumb')).toHaveAttribute('data-img-state', 'failed');
        await expect(row.locator('.attachment-delete-btn, .attachment-note-input, .attachment-more')).toHaveCount(0);
        await noStandIns(page, '#attachments-list');
    });
});
