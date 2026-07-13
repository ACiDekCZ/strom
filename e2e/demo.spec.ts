import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

test('empty state offers a demo tree that loads with a focus and a hint', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();

    await page.getByRole('button', { name: 'Try a sample tree' }).click();

    // The sample (House of Tudor in English) loads as a new tree.
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Sample: House of Tudor');
    // Focus person is shown and several cards are rendered.
    await expect(card(page, 'Henry VIII')).toBeVisible();
    expect(await page.locator('.person-card').count()).toBeGreaterThan(3);
    // Hint toast appears.
    await expect(page.locator('.toast')).toBeVisible();
});
