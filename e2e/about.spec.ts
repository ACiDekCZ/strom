import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/** About: the support link is a plain link to the author's page (no widget script). */
test('About offers "Buy me a coffee" as a plain link in a new tab', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about.locator('.about-support p')).toContainText('free and open source');
    const link = about.getByRole('link', { name: 'Buy me a coffee' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.buymeacoffee.com/acidekcz');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
});

test.describe('Czech', () => {
    test.use({ locale: 'cs-CZ' });
    test('About says it in Czech (formal)', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        await expect(page.locator('#about-modal').getByRole('link', { name: 'Kupte mi kávu' })).toBeVisible();
    });
});
