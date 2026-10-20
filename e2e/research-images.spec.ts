import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'fs';
import { card } from './helpers.js';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * Source images the research left out of its file (`_STROM_IMG_OMITTED`):
 * loaded from its bridge when a source opens, kept with the tree, the
 * "Image in research" filter with the bulk load, the settings section and the
 * export choice. A mocked bridge, invented data.
 */

const DESKTOP = { width: 1280, height: 860 };
/** A 1 × 1 PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EXCERPT_FEATURES = ['excerpt.get'];

/** The research's file: S0001 with two crops left out for its settings, S0002 with one. */
function heldGed(): string {
    return researchGed().replace('1 _STROM_READ research', [
        '1 _STROM_READ research', '1 _STROM_IMG_OMITTED scope', '2 _STROM_CLIP C0001', '2 _STROM_CLIP C0002',
        '0 @S0002@ SOUR', '1 TITL Křestní matrika Kolín', '1 REFN S0002', '1 _STROM_IMG_OMITTED limit', '2 _STROM_CLIP C0003',
    ].join('\n'));
}

interface ExcerptBridge { asks: string[]; refuse: Map<string, { status: number; body: unknown }>; hold?: Promise<void> }

/** `GET /excerpt/<S…>?clip=` and `GET /excerpts?missing=1` on the fake bridge. */
async function serveExcerpts(page: Page, b: FakeBridge): Promise<ExcerptBridge> {
    const ex: ExcerptBridge = { asks: [], refuse: new Map() };
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    await page.route(url => url.href.startsWith(`${BRIDGE}/excerpt`), async (route: Route) => {
        if (b.down) return route.abort('connectionrefused');
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/excerpts')) {
            return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
                head: b.head, level: 'app', count: 2, clips: 3, bytes: 3 * 300 * 1024, estimated: false,
                sources: [
                    { source: 'S0001', why: 'scope', clips: ['C0001', 'C0002'], bytes: 2 * 300 * 1024, ready: true },
                    { source: 'S0002', why: 'limit', clips: ['C0003'], bytes: 300 * 1024, ready: false },
                ],
            }) });
        }
        const ref = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        const clip = url.searchParams.get('clip') ?? '';
        ex.asks.push(`${ref}/${clip}`);
        if (ex.hold) await ex.hold;
        const refusal = ex.refuse.get(clip);
        if (refusal) return route.fulfill({ status: refusal.status, headers: cors, body: JSON.stringify(refusal.body) });
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
            excerpts: [{ clip, sha: 'a'.repeat(64), region: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, width: 1, height: 1, mime: 'image/png', bytes: 70, dataUrl: PNG }],
            missing: [],
        }) });
    });
    return ex;
}

async function setup(page: Page, opts: { features?: string[]; auto?: boolean } = {}): Promise<{ b: FakeBridge; ex: ExcerptBridge }> {
    await page.setViewportSize(DESKTOP);
    const b = await fakeBridge(page, { features: opts.features ?? EXCERPT_FEATURES, treeGed: heldGed() });
    const ex = await serveExcerpts(page, b);
    await openResearch(page, { ged: heldGed() });
    if (opts.auto === false) {
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.patchResearchLink(tm.getActiveTreeId()!, { autoLoadImages: false });
        });
    }
    await poll(page);
    return { b, ex };
}

const openSource = (page: Page, ref: string) => page.evaluate((ref) => {
    const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.refn === ref) as any;
    window.Strom.UI.showSourceViewer(src.id, null);
}, ref);

const viewer = (page: Page) => page.locator('#source-viewer-modal');

test.describe('source images from the research', () => {
    test('opening a source loads its images, they stay with the tree and are not asked for again', { tag: '@smoke' }, async ({ page }) => {
        const { ex } = await setup(page);
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
        await expect(viewer(page).locator('.viewer-excerpt-origin').first()).toHaveText('from the research');
        expect(ex.asks).toEqual(['S0001/C0001', 'S0001/C0002']);
        // Kept apart from the tree's data: the source itself is unchanged.
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().sources ?? {})
            .find((s: any) => s.refn === 'S0001') as any).excerpts)).toBeUndefined();

        // Again after a reload (offline too): from the browser, not from the research.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
        expect(ex.asks).toHaveLength(2);
    });

    test('with the research not running: a sentence, nothing loads', async ({ page }) => {
        const { b, ex } = await setup(page);
        b.down = true;
        await poll(page);
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-image-held-text'))
            .toHaveText('The image is in the research. It loads once the research runs on this computer.');
        await expect(viewer(page).locator('.viewer-load-images')).toHaveCount(0);
        expect(ex.asks).toEqual([]);
        // The bridge comes back with the source open: it loads by itself.
        b.down = false;
        await poll(page);
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
    });

    test('an older research without excerpt.get: the reason, no load', async ({ page }) => {
        const { ex } = await setup(page, { features: [] });
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-image-held-text'))
            .toHaveText('The image is in the research but was not included for the app (research settings).');
        await expect(viewer(page).locator('.viewer-load-images')).toHaveCount(0);
        expect(ex.asks).toEqual([]);
    });

    test('automatic loading off: a button loads; Remove from the app takes them away again', async ({ page }) => {
        const { ex } = await setup(page, { auto: false });
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-image-held-text')).toHaveText('2 images are in the research.');
        expect(ex.asks).toEqual([]);
        await viewer(page).getByRole('button', { name: 'Load images from the research' }).click();
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);

        await viewer(page).locator('.viewer-excerpt-more-btn').first().click();
        await viewer(page).getByRole('menuitem', { name: 'Remove from the app' }).click();
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(0);
        await expect(viewer(page).locator('.viewer-image-held-text')).toHaveText('2 images are in the research.');
    });

    test('a refusal of the research: the reason in place, a failure can be tried again', async ({ page }) => {
        const { ex } = await setup(page);
        ex.refuse.set('C0002', { status: 404, body: { error: 'No such excerpt.', code: 'excerpt.unknown' } });
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(1);
        await expect(viewer(page).locator('.viewer-image-held-text')).toHaveText('Loading failed.');
        ex.refuse.clear();
        await viewer(page).getByRole('button', { name: 'Try again' }).click();
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
    });

    test('Sources: the filter, the warning with counts and space, the bulk load and its summary', async ({ page }) => {
        const { ex } = await setup(page, { auto: false });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        const modal = page.locator('#sources-modal');
        const filter = modal.locator('#sources-filter [data-filter="imageHeld"]');
        await expect(filter).toHaveText('Image in research · 2');
        await expect(modal.locator('.source-held-tag')).toHaveCount(2);
        await filter.click();
        await expect(modal.locator('.sources-bulk-line')).toContainText('3 images for 2 sources are only in the research.');
        await modal.getByRole('button', { name: 'Load all from the research…' }).click();
        await expect(modal.locator('.sources-bulk-panel')).toContainText('2 sources, 3 images, about 900 kB.');
        await expect(modal.locator('.sources-bulk-panel')).toContainText('Free space in the browser');
        await modal.locator('#sources-bulk-go').click();
        await expect(modal.locator('.sources-bulk-panel')).toContainText('Loaded 2 sources');
        expect(ex.asks.sort()).toEqual(['S0001/C0001', 'S0001/C0002', 'S0002/C0003']);
        // The badge says it ended until Sources opens again.
        await expect(page.locator('#research-images-badge')).toContainText('images 3 / 3');
        await modal.locator('#sources-bulk-done').click();
        await expect(modal.locator('.source-row-thumb:not(.is-held)')).toHaveCount(2);
    });

    test('the research tree settings: what is loaded, removing it, the automatic load switch', async ({ page }) => {
        await setup(page);
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
        await page.evaluate(() => window.Strom.UI.closeSourceViewer());
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        const section = page.locator('.research-images');
        await expect(section.locator('#research-images-loaded')).toContainText('Loaded from the research: 1 source');
        await section.locator('#research-images-auto').uncheck();
        expect(await page.evaluate(() => window.Strom.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId()!)?.research?.autoLoadImages)).toBe(false);
        await section.locator('#research-images-remove').click();
        await page.locator('.modal-overlay.active').getByRole('button', { name: 'Remove', exact: true }).click();
        await expect(section.locator('#research-images-loaded')).toHaveCount(0);
    });

    test('export: the loaded images go into the file with "Only those in the app", none with "No source images"', async ({ page }) => {
        await setup(page);
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
        await page.evaluate(() => window.Strom.UI.closeSourceViewer());

        const exportJson = async (choice: 'none' | 'app'): Promise<any> => {
            await page.evaluate(() => { window.Strom.UI.showExportDialog(); void window.Strom.UI.exportTargetTreeJSON(); });
            const pwd = page.locator('#export-password-modal');
            const images = pwd.locator('#export-source-images');
            await expect(images).toBeVisible();
            await expect(images.locator('input[value="app"]')).toBeChecked();
            await images.locator(`input[value="${choice}"]`).check();
            await pwd.locator('#export-privacy-mode').selectOption('full');
            const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
            return JSON.parse(readFileSync(await download.path(), 'utf-8'));
        };
        const withImages = await exportJson('app');
        const s1 = Object.values(withImages.sources ?? withImages.data?.sources ?? {}).find((s: any) => s.refn === 'S0001') as any;
        expect(s1.excerpts.map((e: any) => e.clip)).toEqual(['C0001', 'C0002']);
        const without = await exportJson('none');
        const s1none = Object.values(without.sources ?? without.data?.sources ?? {}).find((s: any) => s.refn === 'S0001') as any;
        expect(s1none.excerpts).toBeUndefined();
    });
});
