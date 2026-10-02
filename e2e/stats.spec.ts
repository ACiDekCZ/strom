import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Visual family statistics: hero tiles, split bars, completeness progress,
 * inline SVG charts (column charts for axis-ordered series, horizontal bars
 * for name leaderboards) and record cards — everything visible without
 * expanding.
 */
test('tree statistics render charts (bars and columns), split bars and record cards inline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showActiveTreeStats());
    const modal = page.locator('#tree-stats-modal');
    await expect(modal).toBeVisible();

    // Hero: four tiles including generations and the year span.
    await expect(modal.locator('.tree-stats-header-item')).toHaveCount(4);
    await expect(modal.locator('.tree-stats-header')).toContainText('Generations');

    // Proportional split bars (men/women, living/deceased).
    await expect(modal.locator('.stats-split-bar')).toHaveCount(2);

    // Completeness progress bars.
    expect(await modal.locator('.stats-progress').count()).toBeGreaterThan(0);

    // Charts are visible directly — no collapsible section anymore.
    await expect(modal.locator('details')).toHaveCount(0);
    await expect(modal.locator('svg.stats-bar-chart').first()).toBeVisible();
    expect(await modal.locator('svg.stats-bar-chart .stats-bar-rect').count()).toBeGreaterThan(0);

    // Record cards (longest-lived, largest family, ...).
    expect(await modal.locator('.stats-record-card').count()).toBeGreaterThanOrEqual(2);

    // Axis-ordered series (births by month, by-generation charts) render as
    // vertical columns with axis labels; name leaderboards stay horizontal bars.
    await expect(modal.locator('svg.stats-col-chart').first()).toBeVisible();
    expect(await modal.locator('svg.stats-col-chart .stats-col-rect').count()).toBeGreaterThan(0);
    expect(await modal.locator('svg.stats-col-chart .stats-col-label').count()).toBeGreaterThan(0);
});
