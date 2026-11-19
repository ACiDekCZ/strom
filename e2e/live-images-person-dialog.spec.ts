import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The person dialog and the relationships panel while the photos come
 * after the tree (spec 116 §4.1, §4.2, K1.5): a portrait on its way shows as
 * such in the dialog and comes into it when it arrives, the typed fields
 * staying; a Save meanwhile does not keep the photo away; a couple's photo
 * waits in the panel in its shape and gets its actions once it is here.
 * A bridge whose `POST /images` is held until the test lets it answer.
 * Invented data only.
 */

const UUID = '5d1f8a26-0c7e-4b39-a4e2-7f60b9c1d384';
const BRIDGE = 'http://127.0.0.1:5995/fedcba9876543210fedcba9876543210';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const HEAD = '6a7b8c9d0e1f';

type Img = { b64: string; sha: string; url: string };

/** A portrait and a couple's photo (wider than tall), made by the browser. */
async function makeImages(page: Page): Promise<Img[]> {
    await page.goto('about:blank');
    const urls = await page.evaluate(() => [['#a73', 40, 40], ['#37a', 80, 40]].map(([color, w, h]) => {
        const c = document.createElement('canvas');
        c.width = w as number;
        c.height = h as number;
        const g = c.getContext('2d')!;
        g.fillStyle = color as string;
        g.fillRect(0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.9);
    }));
    return urls.map(url => {
        const b64 = url.slice(url.indexOf(',') + 1);
        return { b64, url, sha: createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex') };
    });
}

const ref = (img: Img, w: number, h: number) => [`2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg', `3 _WIDTH ${w}`, `3 _HEIGHT ${h}`, `3 _BYTES ${Buffer.from(img.b64, 'base64').length}`];

function ged([portrait, couple]: Img[]): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 19 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 CHAR UTF-8', '1 NOTE Pšeniční',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 BIRT', '2 DATE 1898', '1 REFN P0001', '1 FAMS @F0001@',
        '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', ...ref(portrait, 40, 40),
        '0 @P0002@ INDI', '1 NAME Ctirada /Pšeničná/', '1 SEX F', '1 BIRT', '2 DATE 1901', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 MARR', '2 DATE 12 MAY 1924',
        '1 OBJE', ...ref(couple, 80, 40), '2 _PRIM Y',
        '0 TRLR',
    ].join('\n');
}

/** Follow the research; the images it is asked for wait until `release()`. */
async function follow(page: Page, imgs: Img[]): Promise<{ release(): void }> {
    await page.clock.install({ time: new Date('2026-11-19T10:30:00Z') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    let open: () => void = () => {};
    const gate = new Promise<void>(r => { open = r; });
    const byId = new Map(imgs.map(i => [i.sha, i]));
    const status = () => ({
        tree: { id: UUID, name: 'Pšeniční' }, head: HEAD, persons: 2, working: [], waiting: [], queue: [],
        features: ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app'],
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
            const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
            await gate;
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
    // The research's tree as one edited here (a followed tree is read-only): its images still on their way.
    await page.evaluate(() => { window.Strom.DataManager.setLiveTree(null); });
    expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(false);
    return { release: open };
}

/** The id of the person by first name, and the person's portrait now. */
const idOf = (page: Page, firstName: string) => page.evaluate(n => window.Strom.DataManager.getAllPersons().find(p => p.firstName === n)!.id as string, firstName);
const photoOf = (page: Page, id: string) => page.evaluate(i => window.Strom.DataManager.getPerson(i as never)?.photo ?? null, id);

test.describe('the person dialog while photos come after the tree (spec 116 §4)', () => {
    test('the portrait shows as on its way, comes into the open dialog, the typed name stays', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        const id = await idOf(page, 'Hostivít');
        await page.evaluate(i => window.Strom.UI.showEditPersonModal(i as never), id);
        const preview = page.locator('#photo-preview');
        await expect(preview).toHaveAttribute('data-img-state', 'loading');
        await expect(page.locator('#person-modal .photo-actions .photo-state')).toBeVisible();
        await expect(page.locator('#photo-recrop-btn')).toBeHidden();
        await expect(page.locator('#photo-remove-btn')).toBeHidden();
        await expect(page.locator('#pm-avatar')).toHaveAttribute('data-img-state', 'loading');
        await page.locator('#input-firstname').fill('Hostivít Jan');

        bridge.release();
        await expect(preview.locator('img')).toHaveAttribute('src', imgs[0].url);
        await expect(preview).not.toHaveAttribute('data-img-state', /loading|refresh|failed/);
        await expect(page.locator('#person-modal .photo-actions .photo-state')).toHaveCount(0);
        await expect(page.locator('#photo-remove-btn')).toBeVisible();
        await expect(page.locator('#input-firstname')).toHaveValue('Hostivít Jan');
        expect(await photoOf(page, id)).toBe(imgs[0].url);
    });

    test('Save while the portrait is on its way: the person gets it when it comes', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        const id = await idOf(page, 'Hostivít');
        await page.evaluate(i => window.Strom.UI.showEditPersonModal(i as never), id);
        await expect(page.locator('#photo-preview')).toHaveAttribute('data-img-state', 'loading');
        await page.locator('#input-firstname').fill('Hostivít Jan');
        await page.locator('#btn-save').click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        expect(await photoOf(page, id)).toBeNull();

        bridge.release();
        await expect.poll(() => photoOf(page, id)).toBe(imgs[0].url);
        expect(await page.evaluate(i => window.Strom.DataManager.getPerson(i as never)?.firstName, id)).toBe('Hostivít Jan');
        expect(JSON.stringify(await page.evaluate(() => window.Strom.DataManager.getData()))).not.toContain('strom-image:');
    });

    test('the couple\'s photo waits in the panel in its shape; Make portraits… and Remove once it is here', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        const id = await idOf(page, 'Hostivít');
        await page.evaluate(i => window.Strom.UI.showRelationshipsPanel(i as never), id);
        const row = page.locator('#relationships-content .pg-photo');
        const thumb = row.locator('.pg-photo-thumb');
        await expect(thumb).toHaveAttribute('data-img-state', 'loading');
        // The photo's own proportions (80 × 40): twice as wide as the thumbnail is tall.
        const box = await thumb.boundingBox();
        expect(box!.width / box!.height).toBeGreaterThan(1.6);
        await expect(row.locator('.pg-photo-choose')).toBeVisible();
        await expect(row.locator('.pg-photo-make')).toHaveCount(0);
        await expect(row.locator('.pg-photo-remove')).toHaveCount(0);
        await expect(row.locator('.pg-photo-state')).toBeVisible();

        bridge.release();
        await expect(row.locator('.pg-photo-make')).toBeVisible();
        await expect(row.locator('.pg-photo-remove')).toBeVisible();
        await expect(row.locator('.pg-photo-thumb img')).toHaveAttribute('src', imgs[1].url);
        await expect(row.locator('.pg-photo-state')).toHaveCount(0);
    });
});
