import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * A crop Strom Research sends back lies as its original is stored; its
 * `2 _STROM_ORIENT` (the original's EXIF orientation) turns it upright on
 * screen — in the source viewer and on the citation chip — while the image
 * kept in the tree stays as the research sent it. Invented data.
 */

/** A 400 × 100 JPEG drawn in the page (wide as stored). */
const wideJpeg = (page: Page) => page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 100;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 100);
    g.fillStyle = '#333'; g.fillRect(0, 0, 40, 100);
    return c.toDataURL('image/jpeg', 0.9);
});

async function setup(page: Page, orient: string | null): Promise<string> {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openApp(page);
    const jpeg = await wideJpeg(page);
    const ged = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Anna /Víšková/', '1 SEX F', '1 BIRT', '2 DATE 1888', '2 SOUR @S1@',
        '0 @S1@ SOUR', '1 TITL Křestní matrika Čáslav',
        '1 OBJE', '2 FORM jpeg', '2 _STROM_KIND excerpt', '2 _STROM_CLIP C0007', `2 _STROM_SHA ${'c'.repeat(64)}`,
        ...(orient ? [`2 _STROM_ORIENT ${orient}`] : []),
        `2 FILE ${jpeg}`,
        '0 TRLR',
    ].join('\n');
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'viskovi.ged', { type: 'text/plain' }));
        return dt;
    }, ged);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Anna')).toBeVisible();
    return jpeg;
}

const shownSize = (page: Page, selector: string) => page.locator(selector).first().evaluate(async (img: HTMLImageElement) => {
    await img.decode().catch(() => undefined);
    return { w: img.naturalWidth, h: img.naturalHeight };
});

const openViewer = (page: Page) => page.evaluate(() => {
    const id = Object.keys(window.Strom.DataManager.getData().sources ?? {})[0];
    window.Strom.UI.showSourceViewer(id, null);
});

test.describe('a research crop turned by its original\'s orientation', () => {
    test('orientation 6: the viewer shows it upright, the tree keeps it as sent', async ({ page }) => {
        const jpeg = await setup(page, '6');
        await openViewer(page);
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
        expect(await shownSize(page, '#source-viewer-modal img[data-excerpt-index]')).toEqual({ w: 100, h: 400 });
        const kept = await page.evaluate(() => {
            const src = Object.values(window.Strom.DataManager.getData().sources ?? {})[0] as { excerpts: { dataUrl: string; orient?: number }[] };
            return src.excerpts[0];
        });
        expect(kept.dataUrl).toBe(jpeg);
        expect(kept.orient).toBe(6);
    });

    test('without the line it shows as stored', async ({ page }) => {
        await setup(page, null);
        await openViewer(page);
        expect(await shownSize(page, '#source-viewer-modal img[data-excerpt-index]')).toEqual({ w: 400, h: 100 });
    });
});
