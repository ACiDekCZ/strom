import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * "Follow live" with a bridge that gives its tree with the images by their
 * hash (`ged.imagesByHash`, spec 071): the app asks `tree.ged?images=ref` and
 * only the images it does not hold by `POST /images` — all of them the first
 * time, none after a change of a fact, one for a new excerpt, none after a
 * restart (the stored tree's own, found by their hash). Anything amiss (an
 * image the bridge lacks) loads the file with its images in it. Without the
 * feature the file is asked as always. Invented data only.
 */

const UUID = '9c3e1a75-6b2d-4f48-b0e7-1d5a8c2f6e93';
const BRIDGE = 'http://127.0.0.1:5995/0123456789abcdef0123456789abcdef';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match, content-type',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now, X-Strom-Images',
};
const H1 = '1a2b3c4d5e6f';
const H2 = '2b3c4d5e6f70';
const H3 = '3c4d5e6f7081';

type Img = { b64: string; sha: string; url: string };

/** Three small JPEGs of their own colours, made by the browser (real pictures it can show). */
async function makeImages(page: Page): Promise<Img[]> {
    await page.goto('about:blank');
    const urls = await page.evaluate(() => ['#a33', '#3a3', '#33a'].map((color, i) => {
        const c = document.createElement('canvas');
        c.width = 40 + i * 10;
        c.height = 30;
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

const indi = (id: string, name: string, sex: 'M' | 'F', year: number, links: string[]) =>
    [`0 @${id}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${year}`, `1 REFN ${id}`, ...links];

/** An excerpt's FILE: the image in it (CONC-wrapped as the research writes it) or by its hash. */
function fileLines(img: Img, ref: boolean): string[] {
    if (ref) return [`2 FILE strom-image:${img.sha}`, '3 _MIME image/jpeg', '3 _WIDTH 40', '3 _HEIGHT 30', `3 _BYTES ${Buffer.from(img.b64, 'base64').length}`];
    const out = [`2 FILE ${img.url.slice(0, 200)}`];
    for (let i = 200; i < img.url.length; i += 200) out.push(`3 CONC ${img.url.slice(i, i + 200)}`);
    return out;
}

/** The research's tree at `head`: H2 adds a child, H3 a third excerpt. */
function ged(head: string, imgs: Img[], ref: boolean): string {
    const excerpts = head === H3 ? imgs : imgs.slice(0, 2);
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 9 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 CHAR UTF-8', '1 NOTE Kapradinovi',
        ...indi('P0001', 'Radomil /Kapradina/', 'M', 1833, ['1 FAMS @F0001@', '1 SOUR @S0001@']),
        ...indi('P0002', 'Lubomíra /Ostřicová/', 'F', 1839, ['1 FAMS @F0001@']),
        ...indi('P0012', 'Hostivít /Kapradina/', 'M', 1861, ['1 FAMC @F0001@']),
        ...(head !== H1 ? indi('P0013', 'Dobromila /Kapradinová/', 'F', 1864, ['1 FAMC @F0001@']) : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', ...(head !== H1 ? ['1 CHIL @P0013@'] : []),
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Doubravka 1858', '1 REFN S0001',
        ...excerpts.flatMap((img, i) => ['1 OBJE', '2 FORM jpg', '2 _STROM_KIND excerpt', `2 _STROM_CLIP C000${i + 1}`, ...fileLines(img, ref)]),
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    head: string;
    /** Every `tree.ged` asked: images=ref, If-None-Match, the status answered. */
    trees: Array<{ ref: boolean; tag: string; status: number; at: number }>;
    /** Every `POST /images`: the hashes asked, when answered. */
    images: Array<{ shas: string[]; at: number }>;
    /** Hashes the bridge says it does not have. */
    lacks: Set<string>;
    /** The next stream (re)connect announces this head as a change. */
    change: string | null;
    /** Every request fails (the bridge gone). */
    gone: boolean;
}

/**
 * Follow the research at H1. `byHash`: the bridge has `ged.imagesByHash`
 * (with `ged.stale` and `ged.etag`); an answer of `/images` holds one image
 * (the rest `more`).
 */
async function follow(page: Page, imgs: Img[], o: { byHash: boolean; lacks?: string[] }): Promise<Bridge> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    const bridge: Bridge = { head: H1, trees: [], images: [], lacks: new Set(o.lacks ?? []), change: null, gone: false };
    const byId = new Map(imgs.map(i => [i.sha, i]));
    const status = () => ({
        tree: { id: UUID, name: 'Kapradinovi' }, head: bridge.head, persons: 4,
        working: [], waiting: [], queue: [],
        features: o.byHash ? ['ged.stale', 'ged.etag', 'ged.imagesByHash'] : ['ged.stale', 'ged.etag'],
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        if (bridge.gone) return route.abort('connectionrefused');
        const url = new URL(req.url());
        const path = url.pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) {
            const ref = url.searchParams.get('images') === 'ref';
            const tag = `"${bridge.head}-${ref ? 'ref' : 'data'}"`;
            const asked = req.headers()['if-none-match'] ?? '';
            const heads = { ...cors, etag: tag, 'x-strom-head': bridge.head, ...(o.byHash ? { 'x-strom-images': ref ? 'ref' : 'data' } : {}) };
            if (asked === tag) {
                bridge.trees.push({ ref, tag: asked, status: 304, at: Date.now() });
                return route.fulfill({ status: 304, headers: heads, body: '' });
            }
            bridge.trees.push({ ref, tag: asked, status: 200, at: Date.now() });
            return route.fulfill({ status: 200, headers: { ...heads, 'content-type': 'text/plain; charset=utf-8' }, body: ged(bridge.head, imgs, ref && o.byHash) });
        }
        if (path.endsWith('/images') && req.method() === 'POST') {
            const shas = (JSON.parse(req.postData() ?? '{}') as { images: string[] }).images;
            const images: Array<{ sha: string; mime: string; bytes: number; data: string }> = [];
            const missing: string[] = [];
            const more: string[] = [];
            for (const sha of shas) {
                const img = byId.get(sha);
                if (!img || bridge.lacks.has(sha)) missing.push(sha);
                else if (images.length) more.push(sha);
                else images.push({ sha, mime: 'image/jpeg', bytes: Buffer.from(img.b64, 'base64').length, data: img.b64 });
            }
            bridge.images.push({ shas, at: Date.now() });
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ images, missing, more }) });
        }
        if (path.endsWith('/events')) {
            let body = `event: hello\ndata: ${JSON.stringify(status())}\n\n`;
            if (bridge.change) {
                body += `event: change\ndata: ${JSON.stringify({ head: bridge.change, what: ['Zapsáno'], at: new Date().toISOString() })}\n\n`;
            }
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(card(page, 'Hostivít')).toBeVisible();
    return bridge;
}

const card = (page: Page, name: string) => page.locator('#tree-canvas .person-card', { hasText: name });
/** The excerpts of the source as the tree holds them. */
const excerpts = (page: Page) => page.evaluate(() => {
    const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find(s => s.refn === 'S0001');
    return (src?.excerpts ?? []).map(e => e.dataUrl);
});
const asked = (b: Bridge) => b.images.flatMap(a => a.shas);
const viewer = (page: Page) => page.locator('#source-viewer-modal');

/** The source's viewer shows `n` excerpts, each a picture the browser decoded. */
async function showsExcerpts(page: Page, n: number): Promise<void> {
    await page.evaluate(() => {
        const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find(s => s.refn === 'S0001')!;
        window.Strom.UI.showSourceViewer(src.id, null);
    });
    const imgs = viewer(page).locator('figure.viewer-excerpt img');
    await expect(imgs).toHaveCount(n);
    await expect.poll(() => imgs.evaluateAll(els => els.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toBeHidden();
}

test.describe('follow live with the images by their hash (ged.imagesByHash)', () => {
    test('first load fetches the images in batches; a change of a fact none; a new excerpt exactly one', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { byHash: true });
        // The file by reference, its two images asked (one per answer: the second as `more`).
        expect(bridge.trees[0]).toMatchObject({ ref: true, status: 200 });
        expect(bridge.trees.every(t => t.ref)).toBe(true);
        expect(bridge.images.map(a => a.shas)).toEqual([[imgs[0].sha, imgs[1].sha], [imgs[1].sha]]);
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);
        await showsExcerpts(page, 2);
        // How long the first load waited for its images (the mock bridge answers at once).
        const waited = bridge.images[bridge.images.length - 1].at - bridge.trees[0].at;
        test.info().annotations.push({ type: 'first-load-image-wait-ms', description: String(waited) });
        const link = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.treeEtag);
        expect(link).toMatchObject({ tag: `"${H1}-ref"`, variant: 'ref' });

        // A change of a fact: the file again, no image.
        const files = bridge.trees.length;
        bridge.head = H2;
        bridge.change = H2;
        await expect(card(page, 'Dobromila')).toBeVisible();
        expect(bridge.trees.slice(files).every(t => t.ref && t.status === 200)).toBe(true);
        expect(bridge.images.length).toBe(2);
        expect(await excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);

        // A new excerpt: exactly its image.
        bridge.head = H3;
        bridge.change = H3;
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url, imgs[2].url]);
        expect(bridge.images.slice(2).map(a => a.shas)).toEqual([[imgs[2].sha]]);
        await showsExcerpts(page, 3);
        expect(JSON.stringify(await page.evaluate(() => window.Strom.DataManager.getData()))).not.toContain('strom-image:');
    });

    test('a restart takes the stored tree\'s images (none downloaded); the bridge gone, they stay', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { byHash: true });
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);
        const posts = bridge.images.length;

        // The same head: the file of that variant asked with its tag, 304, nothing downloaded.
        const files = bridge.trees.length;
        await page.reload();
        await expect(card(page, 'Hostivít')).toBeVisible();
        await expect.poll(() => bridge.trees.length).toBeGreaterThan(files);
        expect(bridge.trees[files]).toMatchObject({ ref: true, tag: `"${H1}-ref"`, status: 304 });

        // A new head: the file by reference, its images found in the stored tree.
        bridge.head = H2;
        await page.reload();
        await expect(card(page, 'Dobromila')).toBeVisible();
        expect(bridge.trees[bridge.trees.length - 1]).toMatchObject({ ref: true, status: 200 });
        expect(bridge.images.length).toBe(posts);
        expect(await excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);

        // The bridge gone: the tree as stored, its images with it.
        bridge.gone = true;
        await page.reload();
        await expect(card(page, 'Dobromila')).toBeVisible();
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);
        await showsExcerpts(page, 2);
    });

    test('an image the bridge does not have: the file with its images in it, all of them there', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { byHash: true, lacks: [imgs[1].sha] });
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);
        expect(bridge.trees.map(t => t.ref)).toEqual([true, false]);
        // The tag kept is the whole file's.
        const etag = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.treeEtag);
        expect(etag?.tag).toBe(`"${H1}-data"`);
        expect(etag?.variant).toBeUndefined();
        await showsExcerpts(page, 2);
    });

    test('without the feature: the file as always, no images asked', async ({ page }) => {
        const imgs = await makeImages(page);
        const bridge = await follow(page, imgs, { byHash: false });
        await expect.poll(() => excerpts(page)).toEqual([imgs[0].url, imgs[1].url]);
        expect(bridge.trees.length).toBeGreaterThan(0);
        expect(bridge.trees.every(t => !t.ref)).toBe(true);
        expect(bridge.images).toEqual([]);
        bridge.head = H2;
        bridge.change = H2;
        await expect(card(page, 'Dobromila')).toBeVisible();
        expect(bridge.trees.every(t => !t.ref)).toBe(true);
        expect(bridge.images).toEqual([]);
    });
});
