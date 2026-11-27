import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

/**
 * The book saved as HTML from its window when it is written to the page's
 * own files (1127, spool.ts; `__STROM_SPOOL_FROM` = 0): the download is the
 * whole book, not cancelled.
 */
test('the book saved as HTML from a spool file downloads whole', async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => { (globalThis as { __STROM_SPOOL_FROM?: number }).__STROM_SPOOL_FROM = 0; });
    await openApp(page);
    await page.evaluate(async (data) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
    }, rodsTree());
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('input[name="book-privacy"][value="full"]').check();
    const [book] = await Promise.all([context.waitForEvent('page'), dialog.locator('#book-open').click()]);
    await book.locator('.book-toolbar').waitFor();
    const [download] = await Promise.all([
        book.waitForEvent('download'),
        book.locator('.book-toolbar').getByRole('button', { name: 'Save as HTML' }).click(),
    ]);
    expect(await download.failure()).toBeNull();
    const saved = readFileSync((await download.path())!, 'utf-8');
    expect(saved).toContain('</html>');
});
