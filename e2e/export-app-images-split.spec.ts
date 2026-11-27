import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'url';
import { openApp, card } from './helpers.js';

/**
 * A saved app whose images are too many for one script (1127,
 * embedded-images.ts): a page's inline script is one string to the
 * browser, and past its longest string (about 512 million characters) the
 * script never runs — the app opened empty. From a size on, the data script
 * holds each image's place and the images follow in scripts of their own.
 * Here the size is 0 and each image has a script (`__STROM_SPLIT_IMAGES_FROM`,
 * `__STROM_IMAGE_SCRIPT_CHARS`): the file opens with the tree and its
 * photos, and the page does not keep the image scripts.
 */

test('a saved app with its images in scripts of their own opens with the tree and its photos', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
        const g = globalThis as { __STROM_SPLIT_IMAGES_FROM?: number; __STROM_IMAGE_SCRIPT_CHARS?: number };
        g.__STROM_SPLIT_IMAGES_FROM = 0;
        g.__STROM_IMAGE_SCRIPT_CHARS = 1;
    });
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_david' as never);
    });
    await expect(card(page, 'David')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    const out = testInfo.outputPath('exported.html');
    await download.saveAs(out);

    const html = readFileSync(out, 'utf8');
    const at = html.indexOf('<script>window.STROM_EMBEDDED_DATA');
    const dataScript = html.slice(at, html.indexOf('</script>', at));
    expect(dataScript).toContain('\\u0000si:0');
    expect(dataScript).not.toContain('data:image');
    const scripts = html.split('<script>window.STROM_EMBEDDED_IMAGES=').length - 1;
    expect(scripts).toBeGreaterThan(1);

    await page.goto(pathToFileURL(out).href);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(card(page, 'David')).toBeVisible();
    const photo = card(page, 'David').locator('img').first();
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    // The images are back in the data; their scripts and list are gone from the page.
    const left = await page.evaluate(() => ({
        list: 'STROM_EMBEDDED_IMAGES' in window,
        scripts: [...document.scripts].filter(s => s.textContent?.startsWith('window.STROM_EMBEDDED_IMAGES=')).length,
        refs: JSON.stringify((window as unknown as { STROM_EMBEDDED_DATA: unknown }).STROM_EMBEDDED_DATA).includes('\\u0000si:'),
    }));
    expect(left).toEqual({ list: false, scripts: 0, refs: false });
});
