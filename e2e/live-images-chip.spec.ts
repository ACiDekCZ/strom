import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The tree's photos coming after it (spec 116 §6, §7): the cards show them
 * on their way, the indicator "Photos k / n" counts them (its detail on a
 * click), ends with ✓ and goes; a bridge that cannot give them leaves one
 * alert with why and Try again, which brings them once the bridge can;
 * another tree opened meanwhile drops the indicator and the photos never
 * land there. On a phone the indicator stands above the bottom bar, clear
 * of back / forward and the zoom. A bridge whose `POST /images` is held
 * until the test lets it answer, or refused. Invented data only.
 */

const UUID = '7c2e9b14-3a5d-4f86-b1e7-0d9a6c4f2b51';
const BRIDGE = 'http://127.0.0.1:5996/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
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
    /** Refuse the asks (404) while true. */
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

const avatar = (page: Page, name: string) => page.locator(`#tree-canvas .person-card[aria-label^="${name}"] .card-avatar`);
const photos = (page: Page) => page.evaluate(() => window.Strom.DataManager.getAllPersons().filter(p => !!p.photo).length);

test.describe('"Photos k / n" and the notice of photos not loaded (spec 116 §6, §7)', () => {
    test('photos on their way: the cards wait, the indicator counts (its detail), an edit meanwhile keeps the photo; ✓ and gone', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        await expect(avatar(page, 'Hostivít')).toHaveAttribute('data-img-state', 'loading');
        await expect(avatar(page, 'Velislava')).toHaveAttribute('data-img-state', 'loading');

        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText(/Photos\s*0 \/ 3/);
        await expect(chip).toHaveAttribute('aria-label', 'Loading photos: 0 of 3');
        // Under the top bar in the middle.
        const box = (await chip.boundingBox())!;
        expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
        expect(box.y).toBeLessThan(200);

        // Its detail: what is left, and that the tree can be edited; Esc closes it, a click beside too.
        await chip.click();
        const pop = page.locator('#img-load-pop');
        await expect(pop).toBeVisible();
        await expect(pop).toContainText('Photos 0 / 3');
        await expect(pop).toContainText('3 to go · 0 not loaded');
        await expect(pop).toContainText('The tree can be edited meanwhile.');
        await expect(chip).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(pop).toBeHidden();
        await chip.click();
        await expect(pop).toBeVisible();
        await page.mouse.click(200, 700);
        await expect(pop).toBeHidden();

        // An edit of the person while the photo is on its way (the research's tree edited here).
        await page.evaluate(() => {
            window.Strom.DataManager.setLiveTree(null);
            const dm = window.Strom.DataManager;
            const p = dm.getAllPersons().find(x => x.firstName === 'Hostivít')!;
            dm.updatePerson(p.id, { birthPlace: 'Lhota' });
        });

        bridge.release();
        await expect(chip).toHaveText(/✓\s*Photos\s*3 \/ 3/);
        await expect(avatar(page, 'Hostivít').locator('img')).toHaveAttribute('src', imgs[0].url);
        await expect(avatar(page, 'Hostivít')).not.toHaveAttribute('data-img-state', /loading|refresh|failed/);
        expect(await photos(page)).toBe(3);
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Hostivít')!.birthPlace)).toBe('Lhota');
        // ✓ for 2 s, then gone.
        await expect(chip).toBeHidden({ timeout: 6000 });
        await expect(page.locator('.toast[data-kind="images-failed"]')).toHaveCount(0);
    });

    test('the bridge cannot give them: one alert with why and Try again; Try again counts again and brings them', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { fail: true });
        const notice = page.locator('.toast[data-kind="images-failed"]');
        await expect(notice).toBeVisible();
        await expect(notice).toHaveAttribute('role', 'alert');
        await expect(notice.locator('.toast-title')).toHaveText('Some photos did not load (3).');
        await expect(notice).toContainText('The research is not running. Strom Research needs to be started.');
        await expect(notice).toHaveCount(1);
        const again = notice.getByRole('button', { name: 'Try again', exact: true });
        // Through the bridge, no terminal, no agent: no mark.
        await expect(again).toHaveText('Try again');
        await expect(again.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await expect(page.locator('#img-load-chip')).toBeHidden();
        // The cards as without a photo (no veil), the tree usable.
        await expect(page.locator('#tree-canvas [data-img-state="loading"]')).toHaveCount(0);
        expect(await photos(page)).toBe(0);

        // The bridge can now, but holds the answer a while: Try again takes the notice away and counts the whole tree.
        bridge.fail = false;
        await again.click();
        await expect(notice).toHaveCount(0);
        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText(/Photos\s*0 \/ 3/);
        await expect(avatar(page, 'Hostivít')).toHaveAttribute('data-img-state', 'loading');
        bridge.release();
        await expect(chip).toHaveText(/✓\s*Photos\s*3 \/ 3/);
        await expect.poll(() => photos(page)).toBe(3);
        await expect(avatar(page, 'Velislava').locator('img')).toHaveAttribute('src', imgs[2].url);
        await expect(chip).toBeHidden({ timeout: 6000 });
        await expect(notice).toHaveCount(0);
    });

    test('failing again after Try again: the notice once more, one only', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { fail: true });
        const notice = page.locator('.toast[data-kind="images-failed"]');
        await expect(notice).toBeVisible();
        const asks = bridge.asks;
        await notice.getByRole('button', { name: 'Try again' }).click();
        await expect.poll(() => bridge.asks).toBeGreaterThan(asks);
        await expect(notice).toBeVisible();
        await expect(notice).toHaveCount(1);
        await expect(notice.locator('.toast-title')).toHaveText('Some photos did not load (3).');
    });

    test('another tree opened while they come: the indicator goes, the photos never land there', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs);
        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        const first = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
        const other = await page.evaluate(() => {
            window.Strom.DataManager.createNewTree('Jiný strom');
            window.dispatchEvent(new CustomEvent('strom:tree-switched'));
            return window.Strom.DataManager.getCurrentTreeId();
        });
        expect(other).not.toBe(first);
        await expect(chip).toBeHidden();
        bridge.release();
        // Long enough for an answer to have been taken in.
        await page.clock.runFor(1000);
        await expect(chip).toBeHidden();
        expect(await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(other);
        expect(JSON.stringify(await page.evaluate(() => window.Strom.DataManager.getData()))).not.toContain('data:image');
        await expect(page.locator('.toast[data-kind="images-failed"]')).toHaveCount(0);
    });
});

test.describe('on a phone (spec 116 §6.1, 6e)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('above the bottom bar in the middle, clear of back / forward and the zoom', async ({ page }) => {
        const imgs = await makeImages(page);
        await follow(page, imgs, { phone: true });
        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        // Back / forward shown (as after a few steps of the focus).
        await page.evaluate(() => {
            for (const id of ['focus-back-btn', 'focus-forward-btn']) document.getElementById(id)!.style.display = 'block';
        });
        const c = (await chip.boundingBox())!;
        const bar = (await page.locator('.bottom-bar').boundingBox())!;
        expect(c.y + c.height).toBeLessThanOrEqual(bar.y);
        expect(c.height).toBeGreaterThanOrEqual(44);
        const strip = page.locator('#live-panel.phone-strip');
        if (await strip.isVisible()) expect(c.y + c.height).toBeLessThanOrEqual((await strip.boundingBox())!.y + 1);
        const apart = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
            a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        for (const sel of ['#focus-back-btn', '#focus-forward-btn']) {
            expect(apart(c, (await page.locator(sel).boundingBox())!), sel).toBe(true);
        }
        for (const b of await page.locator('.zoom-controls button').all()) {
            if (await b.isVisible()) expect(apart(c, (await b.boundingBox())!)).toBe(true);
        }
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(390);
    });

    test('a message at the bottom: the indicator above it while it shows, back down when it goes', async ({ page }) => {
        const imgs = await makeImages(page);
        await follow(page, imgs, { phone: true });
        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await expect.poll(async () => (await chip.boundingBox())!.y).toBeGreaterThan(0);
        const rest = (await chip.boundingBox())!.y;
        await page.evaluate(() => window.Strom.UI.showToast('A message long enough to take two lines on a phone held upright', 10000));
        const toast = page.locator('.toast').last();
        await expect(toast).toBeVisible();
        // Under the message it stood unseen (the message is drawn over it).
        await expect.poll(async () => {
            const c = (await chip.boundingBox())!;
            const t = (await toast.boundingBox())!;
            return c.y + c.height <= t.y + 1;
        }).toBe(true);
        expect((await chip.boundingBox())!.y).toBeLessThan(rest);
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await expect.poll(async () => (await chip.boundingBox())!.y).toBe(rest);
    });

    test('the count with photos not loaded wraps whole, not a word a line', async ({ page }) => {
        const imgs = await makeImages(page);
        await follow(page, imgs, { phone: true });
        const chip = page.locator('#img-load-chip');
        await expect(chip).toBeVisible();
        // The count as it reads once some did not come while others still wait (German, the longest).
        await page.evaluate(() => {
            const n = document.querySelector('#img-load-chip .img-load-n')!;
            const f = document.createElement('span');
            f.className = 'img-load-f';
            f.textContent = '· 2 nicht geladen';
            n.replaceChildren('1 / 8', ' ', f);
        });
        const f = (await chip.locator('.img-load-f').boundingBox())!;
        // One line of the piece ("· 3 not loaded"), not two.
        const lh = await chip.locator('.img-load-n').evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
        expect(f.height).toBeLessThan(lh * 1.5);
    });
});
