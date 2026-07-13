import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Visual family statistics: the tree-stats dialog has a collapsible "Family
 * statistics" section that renders inline-SVG bar charts.
 */
test('family statistics section renders SVG charts', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    // Open the tree-stats dialog and expand the family-statistics section.
    await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
    const modal = page.locator('#tree-stats-modal');
    await expect(modal).toBeVisible();

    const summary = modal.locator('.tree-stats-family-summary');
    await expect(summary).toHaveText('Family statistics');
    await summary.click();

    // At least one bar chart (e.g. most common names) is drawn.
    await expect(modal.locator('svg.stats-bar-chart').first()).toBeVisible();
    expect(await modal.locator('svg.stats-bar-chart .stats-bar-rect').count()).toBeGreaterThan(0);
});
