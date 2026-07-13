import { test, expect } from '@playwright/test';

// A couple of flows with the UI forced to Czech (system language = cs-CZ).
test.use({ locale: 'cs-CZ' });

test('Czech UI: create the first person', async ({ page }) => {
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('#empty-state')).toBeVisible();

    await page.locator('#empty-state button').first().click();
    const modal = page.locator('#person-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novák');
    await modal.getByRole('button', { name: 'Uložit' }).click();
    await expect(modal).toBeHidden();

    await expect(
        page.locator('.person-card', { has: page.locator('.name-text', { hasText: 'Jan' }) })
    ).toBeVisible();
});

test('Czech UI: about dialog shows the version and Czech labels', async ({ page }) => {
    await page.goto('/strom.html');
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about.locator('#about-version')).toHaveText('1.2.0');
    await expect(about).toContainText('Vytvořil');
});
