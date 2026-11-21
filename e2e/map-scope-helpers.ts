import { expect, type Page } from '@playwright/test';

/**
 * The map's scope Whole tree, as a person chooses it: the segment's part at
 * a computer's or a tablet's width, the phone's "Scope: … ▾" button and its
 * sheet at a phone's (spec 098 §10).
 */
export async function chooseMapWholeTree(page: Page): Promise<void> {
    const phone = await page.evaluate(() => window.matchMedia('(max-width: 640px)').matches);
    if (phone) {
        await page.locator('#map-container .map-scope-btn').click();
        const row = page.locator('.map-scope-sheet .map-scope-row[data-scope="tree"]');
        await expect(row).toBeVisible();
        await row.click();
        await expect(page.locator('.map-scope-sheet')).toHaveCount(0);
        return;
    }
    await page.locator('#map-scope-tree').click();
}
