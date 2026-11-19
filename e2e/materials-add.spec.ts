import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, HEAD, UUID, BRIDGE,
    FakeBridge, FakeMaterial,
} from './research-bridge.js';
import { openApp, seedTree } from './helpers.js';

/**
 * Add materials in the Materials window (spec 102 §8): "Add materials…" in
 * the header (no symbol) opens the research's batch wizard over the window;
 * files dragged onto the window show the drop over it and open the same
 * wizard with them (nothing is sent before its Send). Once the batch is in,
 * the strip says "N files added". A phone has it in the header's ⋯ (with
 * Where the files are); a tree without a research, or a read-only one, has
 * no Add. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Ilsa Talvanen', P0002: 'Oskar Quellmayer' };
const SORT_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];
const BATCH = { id: 'b-12345678', name: 'Krabice z půdy Talvanen', at: '2026-11-10T09:00:00Z' };

const win = (page: Page) => page.locator('#materials-modal');
const head = (page: Page) => win(page).locator('.mw-head');
const addBtn = (page: Page) => head(page).locator('.mw-add');
const more = (page: Page) => head(page).locator('.mw-head-more');
const strip = (page: Page) => win(page).locator('.mw-sort--top');
const wizard = (page: Page) => page.locator('#batch-modal');

async function setup(page: Page, opts: { features?: string[] } = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({
        files: [materialFile(1, { batch: BATCH.id }), materialFile(2, { batch: BATCH.id, title: 'Ilsa at the well', persons: ['P0001'] })],
        batches: [BATCH], people: PEOPLE, listBatches: true,
    });
    const ged = researchGed();
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? SORT_FEATURES, material, treeGed: ged });
    await openResearch(page, { media: true, ged });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await expect(win(page).locator('.mw-canvas .mw-tile').first()).toBeVisible();
}

/** Files with their folder paths dragged onto the window (the wizard reads a drop's entries; plain files here). */
async function dragFiles(page: Page, names: string[], target = '#materials-modal .mw-canvas'): Promise<void> {
    const dataTransfer = await page.evaluateHandle((list) => {
        const dt = new DataTransfer();
        for (const name of list) dt.items.add(new File([`obsah ${name}`], name, { type: 'image/jpeg' }));
        return dt;
    }, names);
    await page.dispatchEvent(target, 'dragenter', { dataTransfer });
    await page.dispatchEvent(target, 'dragover', { dataTransfer });
}

async function dropFiles(page: Page, names: string[], target = '#materials-modal .mw-canvas'): Promise<void> {
    const dataTransfer = await page.evaluateHandle((list) => {
        const dt = new DataTransfer();
        for (const name of list) dt.items.add(new File([`obsah ${name}`], name, { type: 'image/jpeg' }));
        return dt;
    }, names);
    await page.dispatchEvent(target, 'drop', { dataTransfer });
}

test.describe('Add materials in the Materials window', () => {
    test.use({ viewport: DESKTOP });

    test('Add materials… in the header: no symbol, the wizard over the window; once sent, the strip says the files added', async ({ page }) => {
        const { bridge } = await setup(page);
        await openWindow(page);
        await expect(addBtn(page)).toBeVisible();
        await expect(addBtn(page)).toHaveText('Add materials…');
        await expect(addBtn(page).locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        // Before the ×, the ⋯ of a phone not drawn.
        await expect(more(page)).toBeHidden();
        const order = await head(page).evaluate(el => {
            const box = (sel: string) => el.querySelector(sel)!.getBoundingClientRect();
            return { add: box('.mw-add').right, close: box('.close-btn').left, addTop: box('.mw-add').top, closeTop: box('.close-btn').top };
        });
        expect(order.add).toBeLessThanOrEqual(order.close);
        expect(Math.abs(order.addTop - order.closeTop)).toBeLessThan(12);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('1 file without title or person');

        await addBtn(page).click();
        await expect(wizard(page)).toBeVisible();
        await expect(wizard(page).locator('h2')).toHaveText('Add materials to the research');
        // The window stays under it.
        await expect(win(page)).toBeVisible();
        await page.evaluate(() => {
            const list = ['Talvanen/a.jpg', 'Talvanen/b.jpg', 'Talvanen/c.jpg'].map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
            (window.Strom.UI as unknown as { addBatchFiles(f: unknown): void }).addBatchFiles(list);
        });
        await wizard(page).locator('[data-act="next"]').click();
        await wizard(page).getByRole('button', { name: 'Send 3 files' }).click();
        await expect(wizard(page).locator('.batch-confirm-title')).toContainText('is in the research');
        expect(bridge.mediaPuts).toHaveLength(3);

        await wizard(page).locator('.batch-footer [data-act="close"]').click();
        await expect(wizard(page)).toHaveCount(0);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('3 files added · 4 without title or person');
        // The list read again: the new batch is in the window.
        await expect(win(page).locator('.mw-canvas .mw-group-name', { hasText: /^Talvanen$/ })).toHaveCount(1);

        // Opened again, the strip says the whole archive.
        await page.evaluate(() => (window.Strom.UI as unknown as { closeMaterials(): void }).closeMaterials());
        await openWindow(page);
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('4 files without title or person');
    });

    test('files dragged onto the window: the drop over it; dropped, the wizard opens with them and sends nothing by itself', async ({ page }) => {
        const { bridge } = await setup(page);
        await openWindow(page);
        await dragFiles(page, ['dopis-1946.jpg', 'dopis-1947.jpg']);
        const drop = win(page).locator('.materials-window .drop-overlay.mw-drop');
        await expect(drop).toBeVisible();
        await expect(drop.locator('.drop-overlay-title')).toHaveText('Drop here: add to materials');
        await expect(drop.locator('.drop-overlay-sub')).toHaveText('Files and folders. Add materials opens with them; nothing is sent without confirming.');
        // Over the window alone, not the app's drop over the whole page.
        const r = await drop.boundingBox();
        const w = await win(page).locator('.materials-window').boundingBox();
        expect(r).toEqual(w);
        await expect(page.locator('#drop-overlay.active')).toHaveCount(0);

        await dropFiles(page, ['dopis-1946.jpg', 'dopis-1947.jpg']);
        await expect(drop).toBeHidden();
        await expect(wizard(page)).toBeVisible();
        await expect(wizard(page).locator('.batch-step.is-active')).toHaveText('Review');
        await expect(wizard(page).locator('.batch-foot-note')).toContainText('2 files will be sent');
        expect(bridge.mediaPuts).toHaveLength(0);

        // Leaving the window takes the drop away.
        // Closing the review asks first (files ticked); then the window takes a drop again.
        await wizard(page).locator('.close-btn').click();
        await page.locator('#confirmation-modal').getByRole('button', { name: 'Close', exact: true }).click();
        await expect(wizard(page)).toHaveCount(0);
        expect(bridge.mediaPuts).toHaveLength(0);
        await dragFiles(page, ['x.jpg']);
        await expect(drop).toBeVisible();
        const dataTransfer = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.jpg')); return dt; });
        await page.dispatchEvent('#materials-modal .mw-canvas', 'dragleave', { dataTransfer });
        await expect(drop).toBeHidden();
    });

    test('a read-only tree: no Add, no drop', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await openWindow(page);
        await expect(addBtn(page)).toBeHidden();
        await dragFiles(page, ['a.jpg']);
        await expect(win(page).locator('.drop-overlay.mw-drop.active')).toHaveCount(0);
    });

    test.describe('on a tablet (1024 px)', () => {
        test.use({ viewport: TABLET });

        test('Add materials… in the header, nothing wider than the window', async ({ page }) => {
            await setup(page);
            await openWindow(page);
            await expect(addBtn(page)).toBeVisible();
            await expect(more(page)).toBeHidden();
            await expect(head(page).locator('.mw-where')).toBeVisible();
            const over = await win(page).locator('.materials-window').evaluate(el => el.scrollWidth - el.clientWidth);
            expect(over).toBeLessThanOrEqual(0);
            const right = await addBtn(page).evaluate(el => el.getBoundingClientRect().right);
            expect(right).toBeLessThanOrEqual(1024);
        });
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: PHONE });

        test('Add materials… and Where the files are in the header\'s ⋯, a list from below', async ({ page }) => {
            await setup(page);
            await openWindow(page);
            await expect(addBtn(page)).toBeHidden();
            await expect(head(page).locator('.mw-where')).toBeHidden();
            await expect(more(page)).toBeVisible();
            await expect(more(page)).toHaveAttribute('aria-label', 'More actions');
            await more(page).click();
            const menu = page.locator('.mw-pop-headMenu');
            await expect(menu).toBeVisible();
            await expect(menu.getByRole('menuitem')).toHaveText(['Add materials…', 'Where the files are']);
            const box = (await menu.boundingBox())!;
            expect(Math.round(box.x)).toBe(0);
            expect(Math.round(box.width)).toBe(390);
            expect(Math.round(box.y + box.height)).toBe(844);

            await menu.getByRole('menuitem', { name: 'Where the files are' }).click();
            await expect(page.locator('.mw-pop-where')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('.mw-pop-where')).toHaveCount(0);

            await more(page).click();
            await page.locator('.mw-pop-headMenu').getByRole('menuitem', { name: 'Add materials…' }).click();
            await expect(page.locator('.mw-pop-headMenu')).toHaveCount(0);
            await expect(wizard(page)).toBeVisible();
        });
    });
});

test.describe('Materials window of a tree without a research', () => {
    test.use({ viewport: DESKTOP });

    test('no Add materials (attachments are added at a person), no drop', async ({ page }) => {
        await openApp(page);
        await seedTree(page, {
            p1: { firstName: 'Oskar', lastName: 'Quellmayer' },
        }, 'Quellmayer', 'p1');
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(win(page)).toBeVisible();
        await expect(win(page)).toHaveAttribute('data-model', 'app');
        await expect(addBtn(page)).toHaveCount(1);
        await expect(addBtn(page)).toBeHidden();
        await dragFiles(page, ['a.jpg'], '#materials-modal .materials-window-body');
        await expect(win(page).locator('.drop-overlay.mw-drop.active')).toHaveCount(0);
    });

    test.describe('on a phone (390 px)', () => {
        test.use({ viewport: PHONE });

        test('the ⋯ holds Where the files are alone', async ({ page }) => {
            await openApp(page);
            await seedTree(page, { p1: { firstName: 'Oskar', lastName: 'Quellmayer' } }, 'Quellmayer', 'p1');
            await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
            await more(page).click();
            await expect(page.locator('.mw-pop-headMenu').getByRole('menuitem')).toHaveText(['Where the files are']);
        });
    });
});
