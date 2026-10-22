import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version;

// A couple of flows with the UI forced to Czech (system language = cs-CZ).
test.use({ locale: 'cs-CZ' });

test('Czech UI: create the first person', { tag: '@smoke' }, async ({ page }) => {
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
    await expect(about.locator('#about-version')).toHaveText(APP_VERSION);
    await expect(about).toContainText('Vytvořil');
    // The support link says it in Czech, addressing no one.
    await expect(about.getByRole('link', { name: 'Koupit kávu' })).toBeVisible();
    // License and the link to the source code (AGPL section 13).
    await expect(about.locator('#about-license')).toHaveText('AGPL-3.0-or-later');
    await expect(about.getByRole('link', { name: 'Zdrojový kód' }))
        .toHaveAttribute('href', 'https://github.com/ACiDekCZ/strom');
    // The Czech users' group: a plain link in a new tab, offered in Czech only.
    const group = about.getByRole('link', { name: 'Skupina uživatelů na Facebooku ↗' });
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute('href', 'https://www.facebook.com/groups/stromapp');
    await expect(group).toHaveAttribute('target', '_blank');
    await expect(group).toHaveAttribute('rel', /noopener/);
    await expect(about.locator('a[href*="facebook.com"]')).toHaveCount(1);
    // What's new links the Czech changelog (branch and anchor per version:
    // about.spec.ts, src/__tests__/about-changelog.test.ts).
    const changelog = about.getByRole('link', { name: 'Co je nového ↗' });
    await expect(changelog).toBeVisible();
    await expect(changelog).toHaveAttribute('href', /\/blob\/(main|beta)\/CHANGELOG\.cs\.md#\d+$/);
});
