import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp } from './helpers.js';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version;

/**
 * About: the logo opens it, it shows the package.json version, and the support
 * link is a plain link to the author's page (no widget script). The Czech
 * labels are checked in cs.spec.ts.
 */
test('About shows the version and offers "Buy me a coffee" as a plain link in a new tab', async ({ page }) => {
    await openApp(page);
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about.locator('#about-version')).toHaveText(APP_VERSION);
    await expect(about.locator('.about-support p')).toContainText('free and open source');
    const link = about.getByRole('link', { name: 'Buy me a coffee' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://www.buymeacoffee.com/acidekcz');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
});

