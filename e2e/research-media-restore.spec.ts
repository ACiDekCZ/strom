import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The tree's own files restored from a research that keeps them (spec 108
 * K2.3, Strom Research 1.35, `media.app`): opened with no tree here, the app
 * asks `tree.ged?images=ref&media=app` and gets back the portrait, the
 * couple's photo, an attachment with its fields and an original the archive
 * names by its name alone; the next file downloads none of them again. A
 * research without the gate is asked as before (no `media`). The bridge is
 * answered by page.route. Invented data only.
 */

const UUID = '4d8e2b61-0c7a-4f93-a5e1-7b3c9d2f6a08';
const BRIDGE = 'http://127.0.0.1:5993/0123456789abcdef0123456789abcdef';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const H1 = '4e5f60718293';
const H2 = '5f60718293a4';
const BIG_SHA = 'c'.repeat(64);

type Img = { b64: string; sha: string; url: string };

/** Small JPEGs of their own colours (portrait, scan, couple's photo, a letter), made by the browser. */
async function makeImages(page: Page): Promise<Img[]> {
    await page.goto('about:blank');
    const urls = await page.evaluate(() => ['#a73', '#3a7', '#73a', '#37a'].map((color, i) => {
        const c = document.createElement('canvas');
        c.width = 48 + i * 12;
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

const ref = (img: Img) => [`2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg', `3 _BYTES ${Buffer.from(img.b64, 'base64').length}`];

/**
 * The research's tree; `media`: with the tree's own files (`media=app`). H2 adds a child. `shared`: a
 * letter at the man and the couple (one media record, the couple's link `_PRIM N`).
 */
function ged(head: string, [portrait, scan, couple, letter]: Img[], media: boolean, shared = false): string {
    const both = media && shared;
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 17 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 CHAR UTF-8', '1 NOTE Pšeniční',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Lhota u Brodu 1924', '1 REFN S0001',
        '0 @P0001@ INDI', '1 NAME Hostivít /Pšeničný/', '1 SEX M', '1 BIRT', '2 DATE 1898', '1 REFN P0001', '1 FAMS @F0001@',
        ...(media ? [
            '1 OBJE', '2 FORM jpg', '2 _STROM_KIND photo', ...ref(portrait), '2 _DATE 1931',
            '1 OBJE', ...ref(scan), '2 TITL Svatební list', '2 NOTE Opis z fary', '2 _DATE 12 MAY 1924', '2 _SOUR @S0001@',
            '1 OBJE', '2 FILE kronika.tif', '2 TITL kronika.tif', `2 _STROM_SHA ${BIG_SHA}`,
        ] : []),
        ...(both ? ['1 OBJE @M0001@'] : []),
        '0 @P0002@ INDI', '1 NAME Ctirada /Pšeničná/', '1 SEX F', '1 BIRT', '2 DATE 1901', '1 REFN P0002', '1 FAMS @F0001@',
        ...(head === H2 ? ['0 @P0003@ INDI', '1 NAME Radovan /Pšeničný/', '1 SEX M', '1 BIRT', '2 DATE 1926', '1 REFN P0003', '1 FAMC @F0001@'] : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 MARR', '2 DATE 12 MAY 1924', ...(head === H2 ? ['1 CHIL @P0003@'] : []),
        ...(media ? ['1 OBJE', ...ref(couple), '2 _PRIM Y'] : []),
        ...(both ? ['1 OBJE @M0001@', '2 _PRIM N',
            '0 @M0001@ OBJE', ...ref(letter).map(l => l.replace(/^(\d)/, d => String(Number(d) - 1))),
            '1 FORM jpg', '2 TYPE document', '1 TITL Dopis z Lhoty', '1 _STROM_NAME dopis.jpg', '1 _PRIM N'] : []),
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    head: string;
    /** Every `tree.ged` asked: its query and the status answered. */
    trees: Array<{ images: string | null; media: string | null; status: number }>;
    /** Every hash asked by `POST /images`. */
    asked: string[];
    /** `POST /images` refused (404): the images by hash cannot be had. */
    failImages?: boolean;
    /** The letter at the man and the couple in the file (see ged). */
    shared?: boolean;
    /** Every write (`POST /sync`): its query and body. */
    writes: Array<{ media: string | null; body: string }>;
}

async function follow(page: Page, imgs: Img[], features: string[], opts: { failImages?: boolean; shared?: boolean } = {}): Promise<Bridge> {
    await page.clock.install({ time: new Date('2026-11-17T10:30:00Z') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    const bridge: Bridge = { head: H1, trees: [], asked: [], writes: [], ...opts };
    const byId = new Map(imgs.map(i => [i.sha, i]));
    const keeps = features.includes('media.app');
    const status = () => ({ tree: { id: UUID, name: 'Pšeniční' }, head: bridge.head, persons: 2, working: [], waiting: [], queue: [], features,
        // A research that takes the app's writes (only where a test writes).
        ...(bridge.shared ? { accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null } } : {}) });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) {
            const images = url.searchParams.get('images');
            const media = url.searchParams.get('media');
            const withMedia = keeps && images === 'ref' && media === 'app';
            const tag = `"${bridge.head}-${images ?? 'data'}${withMedia ? '-media' : ''}"`;
            const heads = { ...cors, etag: tag, 'x-strom-head': bridge.head, 'x-strom-images': images === 'ref' ? 'ref' : 'data' };
            if (req.headers()['if-none-match'] === tag) {
                bridge.trees.push({ images, media, status: 304 });
                return route.fulfill({ status: 304, headers: heads, body: '' });
            }
            bridge.trees.push({ images, media, status: 200 });
            return route.fulfill({ status: 200, headers: { ...heads, 'content-type': 'text/plain; charset=utf-8' }, body: ged(bridge.head, imgs, withMedia, bridge.shared) });
        }
        if (path.endsWith('/images') && req.method() === 'POST') {
            const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
            bridge.asked.push(...shas);
            if (bridge.failImages) return route.fulfill({ status: 404, headers: cors, body: '' });
            const images = shas.filter(s => byId.has(s)).map(sha => {
                const img = byId.get(sha)!;
                return { sha, mime: 'image/jpeg', bytes: Buffer.from(img.b64, 'base64').length, data: img.b64 };
            });
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ images, missing: shas.filter(s => !byId.has(s)), more: [] }) });
        }
        if (path.endsWith('/sync') && req.method() === 'POST') {
            bridge.writes.push({ media: url.searchParams.get('media'), body: req.postData() ?? '' });
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true, input: 'I0042', changes: 0, inbox: true, intake: 'R1' }) });
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(card(page, 'Hostivít')).toBeVisible();
    return bridge;
}

const card = (page: Page, name: string) => page.locator(`#tree-canvas .person-card[aria-label^="${name} "]`);

/** The tree's files as it holds them. */
const media = (page: Page) => page.evaluate(() => {
    const data = window.Strom.DataManager.getData();
    const man = Object.values(data.persons).find(p => p.refn === 'P0001');
    const couple = Object.values(data.partnerships)[0];
    return {
        portrait: man?.photo ?? null,
        portraitDate: man?.photoDate ?? null,
        couple: couple?.photo ?? null,
        attachments: (man ? window.Strom.DataManager.personMedia(man.id) : []).map(a => {
            const sourceId = a.places.flatMap(pl => 'sourceId' in pl ? [pl.sourceId] : [])[0];
            return {
            name: a.name, dataUrl: a.originalOnly ? null : a.dataUrl, note: a.note ?? null, date: a.date ?? null,
            source: sourceId ? data.sources?.[sourceId]?.title ?? null : null,
            originalOnly: !!a.originalOnly, sha: a.original?.sha256 ?? null,
            };
        }),
    };
});

test.describe('the tree\'s own files restored from a research that keeps them (media.app)', () => {
    test('opened with no tree here: portrait, couple\'s photo, attachment and an original by its name; nothing downloaded again', async ({ page }) => {
        const imgs = await makeImages(page);
        const [portrait, scan, couple] = imgs;
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app']);
        expect(bridge.trees[0]).toMatchObject({ images: 'ref', media: 'app', status: 200 });
        await expect.poll(() => media(page)).toEqual({
            portrait: portrait.url,
            portraitDate: '1931',
            couple: couple.url,
            attachments: [
                { name: 'Svatební list', dataUrl: scan.url, note: 'Opis z fary', date: '12 MAY 1924', source: 'Oddací matrika Lhota u Brodu 1924', originalOnly: false, sha: null },
                { name: 'kronika.tif', dataUrl: null, note: null, date: null, source: null, originalOnly: true, sha: BIG_SHA },
            ],
        });
        // The portrait on the card is a picture the browser decoded.
        const img = card(page, 'Hostivít').locator('img').first();
        await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
        expect(JSON.stringify(await page.evaluate(() => window.Strom.DataManager.getData()))).not.toContain('strom-image:');
        // The file with the tree's own files keeps its own tag.
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.treeEtag))
            .toMatchObject({ tag: `"${H1}-ref-media"`, variant: 'ref', media: true });
        const asked = [...bridge.asked];
        expect(new Set(asked)).toEqual(new Set([portrait.sha, scan.sha, couple.sha]));

        // A new head after a restart: the file asked with them again, its pictures found in the stored tree.
        bridge.head = H2;
        await page.reload();
        await expect(card(page, 'Radovan')).toBeVisible();
        expect(bridge.trees[bridge.trees.length - 1]).toMatchObject({ images: 'ref', media: 'app', status: 200 });
        expect(bridge.asked).toEqual(asked);
        expect((await media(page)).attachments.map(a => a.name)).toEqual(['Svatební list', 'kronika.tif']);
        expect((await media(page)).portrait).toBe(portrait.url);
    });

    test('the images cannot be had: the tree without them, tried again by itself, then said once with Try again, which brings them', async ({ page }) => {
        const imgs = await makeImages(page);
        const [portrait, , couple] = imgs;
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app'], { failImages: true });
        // The file with its images in it was taken: no portrait, no couple's photo.
        expect(await media(page)).toMatchObject({ portrait: null, couple: null });
        const withMedia = () => bridge.trees.filter(t => t.media === 'app').length;
        const first = withMedia();
        expect(first).toBeGreaterThan(0);
        const notice = page.locator('.toast[data-kind="research-media-missed"]');
        // Tried again by itself after a while; nothing said yet.
        await page.clock.fastForward(5_000);
        await expect.poll(withMedia).toBeGreaterThan(first);
        await expect(notice).toHaveCount(0);
        // Tried once more; still not had: said, with Try again.
        await page.clock.fastForward(30_000);
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('The photos from the research could not be loaded.');
        // Meanwhile the tree's writes only add (the archive never loses the files this browser lacks).
        const missed = () => page.evaluate(() => (JSON.parse(localStorage.getItem(`strom-research-auto:${window.Strom.DataManager.getCurrentTreeId()}`) ?? '{}') as { mediaMissed?: string }).mediaMissed ?? null);
        expect(await missed()).toBe(UUID);
        // The bridge gives them now: Try again brings the portrait and the couple's photo.
        bridge.failImages = false;
        await notice.getByRole('button', { name: 'Try again' }).click();
        await expect.poll(async () => (await media(page)).portrait).toBe(portrait.url);
        expect((await media(page)).couple).toBe(couple.url);
        await expect(notice).toHaveCount(0);
        expect(await missed()).toBeNull();
    });

    test('Try again of that notice says its work in the toast until the end, then says once more what failed (no second toast)', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app'], { failImages: true });
        const notice = page.locator('.toast[data-kind="research-media-missed"]');
        await page.clock.fastForward(5_000);
        await page.clock.fastForward(30_000);
        await expect(notice).toContainText('The photos from the research could not be loaded.');
        // The images' answer held: the toast works meanwhile.
        let release = (): void => undefined;
        const held = new Promise<void>(r => { release = r; });
        await page.route(`${BRIDGE}/**/images`, async (route) => { await held; await route.fallback(); });
        const asked = bridge.asked.length;
        await notice.getByRole('button', { name: 'Try again' }).click();
        await expect(notice).toHaveAttribute('aria-busy', 'true');
        await expect(notice.locator('.toast-title')).toHaveText('Loading the tree from the research…');
        await expect(notice.locator('.busy-spin')).toBeVisible();
        release();
        // Still not had: the same toast says it with Try again, no second one.
        await expect(notice).not.toHaveAttribute('aria-busy', 'true');
        await expect(notice).toContainText('The photos from the research could not be loaded.');
        await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(notice).toHaveCount(1);
        expect(bridge.asked.length).toBeGreaterThan(asked);
    });

    test('a file at a person and the couple by its hash: both places come in, and the next write keeps the couple\'s', async ({ page }) => {
        const imgs = await makeImages(page);
        const letter = imgs[3];
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app'], { shared: true });
        expect(bridge.trees[0]).toMatchObject({ images: 'ref', media: 'app', status: 200 });
        const letterPlaces = () => page.evaluate(() => {
            const data = window.Strom.DataManager.getData();
            const file = Object.values(data.media ?? {}).find(a => a.title === 'Dopis z Lhoty');
            return file ? { dataUrl: file.dataUrl, places: file.places.map(pl => 'personId' in pl ? 'person' : 'partnershipId' in pl ? 'couple' : 'source').sort() } : null;
        });
        await expect.poll(letterPlaces).toEqual({ dataUrl: letter.url, places: ['couple', 'person'] });
        // The next write carries the file at the couple too (the research never withdraws its place there).
        // An edit to send (the tree as loaded is the research's own version: nothing to write).
        await page.evaluate(() => { window.Strom.DataManager.createPerson({ firstName: 'Ctiboja', lastName: 'Pšeničná', gender: 'female' }); });
        await page.clock.fastForward(3_000);
        await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
        await expect.poll(() => bridge.writes.length).toBeGreaterThan(0);
        const sent = bridge.writes[bridge.writes.length - 1];
        expect(sent.media).toBe('app');
        const fam = sent.body.slice(sent.body.indexOf(' FAM\n'));
        expect(fam.slice(0, fam.indexOf('\n0 '))).toMatch(/\n1 OBJE @M\d+@\n2 _PRIM N(?:\n|$)/);
        expect(sent.body).toContain(letter.b64.slice(0, 60));
    });

    test('a research without the gate is asked as before: no media, no files of the tree', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash']);
        expect(bridge.trees.length).toBeGreaterThan(0);
        expect(bridge.trees.every(t => t.images === 'ref' && t.media === null)).toBe(true);
        expect(await media(page)).toEqual({ portrait: null, portraitDate: null, couple: null, attachments: [] });
        expect(bridge.asked).toEqual([]);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.treeEtag?.media)).toBeUndefined();
    });

    test('images not taken into the app: the file is asked without media', async ({ page }) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem('images-off')) return;
            sessionStorage.setItem('images-off', '1');
            localStorage.setItem('strom-settings', JSON.stringify({ importImages: false }));
        });
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, ['ged.stale', 'ged.etag', 'ged.imagesByHash', 'media.app']);
        expect(bridge.trees.every(t => t.media === null)).toBe(true);
        expect((await media(page)).portrait).toBeNull();
    });
});
