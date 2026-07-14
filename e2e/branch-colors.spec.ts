import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Branch colours: a settings toggle adds a coloured stripe class to cards
 * (relative to the focus) and shows a legend; turning it off removes both.
 */
test('branch colours toggle adds card classes and a legend', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    // Default ON: legend and stripes are present out of the box.
    const legend = page.locator('#branch-legend');
    await expect(legend).toBeVisible();
    // At least one card now carries a branch class (Henry VIII has descendants/ancestors).
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBeGreaterThan(0);

    // Dark-mode smoke: stripes and legend still render under the dark theme.
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(legend).toBeVisible();
    await expect(page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').first()).toBeVisible();
    await page.evaluate(() => window.Strom.SettingsManager.setTheme('system'));

    // Disable → stripes and legend gone.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#branch-colors-toggle').uncheck();
    await expect(legend).toBeHidden();
    await expect.poll(() =>
        page.locator('.person-card.branch-paternal, .person-card.branch-maternal, .person-card.branch-descendant').count()
    ).toBe(0);

    // Re-enable → they come back.
    await page.locator('#branch-colors-toggle').check();
    await expect(legend).toBeVisible();
});

test('the legend can be hidden separately while stripes stay on', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    const legend = page.locator('#branch-legend');
    await expect(legend).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#branch-legend-toggle').uncheck();
    await expect(legend).toBeHidden();
    // Stripes stay.
    await expect(page.locator('.person-card.branch-descendant').first()).toBeVisible();
});
