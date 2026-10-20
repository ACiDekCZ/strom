import { test, expect, Page, Route } from '@playwright/test';
import { readFileSync } from 'fs';
import { card, openApp } from './helpers.js';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll, researchGed, signal } from './research-bridge.js';

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
            .toHaveText('2 images are in the research. They load once the research runs on this computer.');
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
        await expect(viewer(page).locator('.viewer-image-held-text')).toHaveText('2 images are in the research. Left out by the research settings.');
        expect(ex.asks).toEqual([]);
        await viewer(page).getByRole('button', { name: 'Load images from the research' }).click();
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);

        await viewer(page).locator('.viewer-excerpt-more-btn').first().click();
        await viewer(page).getByRole('menuitem', { name: 'Remove from the app' }).click();
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(0);
        await expect(viewer(page).locator('.viewer-image-held-text')).toHaveText('2 images are in the research. Left out by the research settings.');
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

    test('Sources: the excerpts total holds the images from the research', async ({ page }) => {
        await setup(page);
        await openSource(page, 'S0001');
        await expect(viewer(page).locator('.viewer-excerpt.is-from-research')).toHaveCount(2);
        const fromResearch = await page.evaluate(() => window.Strom.UI.researchImagesBytes());
        expect(fromResearch).toBeGreaterThan(20);
        // A crop of the tree's own on S0002 just under 1.5 kB: alone it says "1 kB", with the
        // images from the research the total rounds to "2 kB".
        await page.evaluate((png) => {
            const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.refn === 'S0002') as any;
            src.excerpts = [{ id: 'own1', dataUrl: png, width: 1, height: 1, sizeBytes: 1535 }];
            window.Strom.UI.showSourcesDialog();
        }, PNG);
        await expect(page.locator('#sources-modal #sources-total')).toHaveText('Excerpts: 2 kB · of which from the research 1 kB');
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
        // No badge in the toolbar: the Research menu's row says it ended (until Sources opens again).
        await expect(page.locator('#research-images-badge, .research-images-badge')).toHaveCount(0);
        await expect(page.locator('#research-item-images')).toHaveAttribute('aria-label', 'Images in the research · 2 / 2 ✓');
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

/**
 * The Sources window's "Image in research" tag lines up with the title above
 * it (the dialog's button padding used to push the title 18px right of it).
 */
test('Sources: the tag at the left edge of its title', async ({ page }) => {
    await setup(page, { auto: false });
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    const modal = page.locator('#sources-modal');
    await modal.locator('#sources-filter [data-filter="imageHeld"]').click();
    const rows = modal.locator('.source-row');
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
        const [title, tag] = await Promise.all([rows.nth(i).locator('.source-title').boundingBox(), rows.nth(i).locator('.source-held-tag').boundingBox()]);
        expect(Math.abs(title!.x - tag!.x), `row ${i}`).toBeLessThanOrEqual(1);
        expect(tag!.y, `row ${i}: under the title`).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
    }
});

/**
 * The Research menu's row "Images in the research · N" (in place of the
 * toolbar badge the bulk load had): N sources whose image is only in the
 * research, offered while the research hands images out; the click opens
 * Sources on the "Image in research" filter; during the bulk load its
 * progress, ✓ at its end until Sources opens. It never lights the Research
 * button's dot (D7).
 */
test.describe('the Research menu: Images in the research', () => {
    const row = (page: Page) => page.locator('#research-menu #research-item-images');
    const openMenu = async (page: Page) => {
        await page.locator('#research-menu-btn').click();
        await expect(page.locator('#research-menu')).toBeVisible();
    };

    test('the count on the first level, the click opens Sources on the filter; the progress, ✓, gone once all are loaded', async ({ page }) => {
        const { ex } = await setup(page, { auto: false });
        const before = await signal(page);
        await openMenu(page);
        await expect(row(page)).toHaveText('Images in the research · 2');
        // Six at most on the first level, the row among them (above "Other actions").
        const first = page.locator('#research-menu > .research-menu-group > .tree-switcher-action:not(#research-item-more)');
        expect(await first.count()).toBeLessThanOrEqual(6);
        await expect(page.locator('#research-menu > .research-menu-group > #research-item-images')).toHaveCount(1);
        expect(await signal(page)).toBe(before);
        await row(page).click();
        await expect(page.locator('#research-menu')).toBeHidden();
        const modal = page.locator('#sources-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('#sources-filter [data-filter="imageHeld"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(modal.locator('.source-row')).toHaveCount(2);

        // The bulk load: its progress on the row while the window is closed.
        await modal.locator('#sources-bulk-open').click();
        let release!: () => void;
        ex.hold = new Promise<void>(r => { release = r; });
        await modal.locator('#sources-bulk-go').click();
        await page.evaluate(() => window.Strom.UI.closeSourcesDialog());
        await openMenu(page);
        await expect(row(page)).toHaveText(/^Images in the research · [01] \/ 2$/);
        release();
        ex.hold = undefined;
        await expect(row(page)).toHaveText('Images in the research · 2 / 2 ✓');
        expect(await signal(page)).toBe(before);
        // Sources opens from it; the finished row goes (nothing is left to load).
        await row(page).click();
        await expect(modal).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeSourcesDialog());
        await openMenu(page);
        await expect(row(page)).toHaveCount(0);
        await expect(page.locator('#research-images-badge, .research-images-badge')).toHaveCount(0);
    });

    test('no row while the research is not running; back once it runs', async ({ page }) => {
        const { b } = await setup(page, { auto: false });
        b.down = true;
        await poll(page);
        await openMenu(page);
        await expect(row(page)).toHaveCount(0);
        await page.keyboard.press('Escape');
        b.down = false;
        await poll(page);
        await openMenu(page);
        await expect(row(page)).toHaveText('Images in the research · 2');
    });

    test('an older research without excerpt.get: no row', async ({ page }) => {
        await setup(page, { features: [], auto: false });
        await openMenu(page);
        await expect(page.locator('#research-menu .research-menu-group').first()).toBeVisible();
        await expect(row(page)).toHaveCount(0);
    });

    test('a narrow window with a mouse: the row in the research group of More and on its research page', async ({ page }) => {
        await setup(page, { auto: false });
        await page.setViewportSize({ width: 900, height: 900 });
        await page.locator('#bb-view-more').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-items')).toContainText('Images in the research · 2');
        await page.locator('#research-sheet-all').click();
        const body = page.locator('#research-sheet-menu');
        await expect(body.locator('#research-item-images')).toHaveText('Images in the research · 2');
        await body.locator('#research-item-images').click();
        await expect(sheet).toHaveCount(0);
        await expect(page.locator('#sources-modal')).toBeVisible();
        await expect(page.locator('#sources-modal #sources-filter [data-filter="imageHeld"]')).toHaveAttribute('aria-pressed', 'true');
    });
});

/**
 * The bulk load in the widest labels (de, a long tree name): no toolbar badge
 * takes the search field's room any more, so at 1440 px the placeholder stays
 * whole without the squeeze (Actions keeps its word) while loading and after;
 * at 1024 px the search keeps its width. A tree without a research is measured
 * as before (no squeeze).
 */
test.describe('the bulk load and the search field (de-DE)', () => {
    test.use({ locale: 'de-DE' });

    const searchRoom = (page: Page) => page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('.toolbar #toolbar-search-picker .person-picker-input')!;
        const cs = getComputedStyle(input);
        const cv = document.createElement('canvas').getContext('2d')!;
        cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const tb = document.querySelector<HTMLElement>('.toolbar')!;
        return {
            width: input.clientWidth,
            room: input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
            need: Math.min(cv.measureText(input.placeholder).width, 120),
            overflow: tb.scrollWidth - tb.clientWidth,
        };
    });

    for (const width of [1440, 1024]) {
        test(`${width} px: the placeholder whole and the search as wide while loading and after as before it`, async ({ page }) => {
            const long = heldGed().replace('1 NOTE Fíškovi', '1 NOTE Fíškovi z Čáslavi a Kutné Hory');
            await page.setViewportSize({ width, height: 900 });
            const b = await fakeBridge(page, { features: EXCERPT_FEATURES, treeGed: long });
            const ex = await serveExcerpts(page, b);
            await openResearch(page, { ged: long });
            await page.evaluate(() => {
                const tm = window.Strom.TreeManager;
                tm.patchResearchLink(tm.getActiveTreeId()!, { autoLoadImages: false });
            });
            await poll(page);
            const fits = async () => { const r = await searchRoom(page); return r.room >= r.need && r.overflow <= 0; };
            await expect.poll(fits).toBe(true);
            const idle = (await searchRoom(page)).width;
            let release!: () => void;
            ex.hold = new Promise<void>(r => { release = r; });
            await page.evaluate(() => { window.Strom.UI.startBulkImageLoad(); });
            await expect(page.locator('#research-images-badge, .research-images-badge')).toHaveCount(0);
            await expect.poll(fits).toBe(true);
            expect((await searchRoom(page)).width).toBe(idle);
            if (width === 1440) {
                await expect(page.locator('.toolbar')).not.toHaveClass(/toolbar-squeeze/);
                await page.locator('#research-menu-btn').click();
                await expect(page.locator('#research-item-images')).toHaveText(/^Bilder in der Forschung · [01] \/ 2$/);
            }
            release();
            ex.hold = undefined;
            if (width === 1440) await expect(page.locator('#research-item-images')).toHaveText('Bilder in der Forschung · 2 / 2 ✓');
            else await expect.poll(() => page.evaluate(() => window.Strom.UI.researchImagesMenuItem()?.label)).toBe('Bilder in der Forschung · 2 / 2 ✓');
            await expect.poll(fits).toBe(true);
            expect((await searchRoom(page)).width).toBe(idle);
        });
    }

    test('a tree without a research: no squeeze, the "/" hint stays', async ({ page }) => {
        await openApp(page);
        for (const width of [1100, 1180, 1281, 1440]) {
            await page.setViewportSize({ width, height: 850 });
            await page.waitForTimeout(80);
            await expect(page.locator('.toolbar'), `${width}px`).not.toHaveClass(/toolbar-squeeze/);
            await expect(page.locator('.toolbar .search-shortcut'), `${width}px`).toBeVisible();
        }
    });
});
