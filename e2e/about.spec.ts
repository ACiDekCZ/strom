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

/**
 * License: AGPL-3.0-or-later. The app runs over the network, so (AGPL
 * section 13) About offers the corresponding source: a visible link to the
 * public repository in a new tab, on a phone as well as a tablet and a desktop.
 */
for (const vp of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'phone', width: 360, height: 740 },
    { name: 'phone sideways', width: 740, height: 360 },
]) {
    test(`About shows the license AGPL-3.0-or-later and a link to the source code (${vp.name})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAboutDialog());
        const about = page.locator('#about-modal');
        await expect(about).toBeVisible();

        const license = about.locator('#about-license');
        await expect(license).toHaveText('AGPL-3.0-or-later');
        await expect(license).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
        await expect(about).not.toContainText('MPL');

        const source = about.getByRole('link', { name: 'Source code' });
        await source.scrollIntoViewIfNeeded();
        await expect(source).toBeVisible();
        await expect(source).toHaveAttribute('href', 'https://github.com/ACiDekCZ/strom');
        await expect(source).toHaveAttribute('target', '_blank');
        await expect(source).toHaveAttribute('rel', /noopener/);

        // The link lies inside the dialog and inside the viewport.
        const box = await source.boundingBox();
        const dialog = await about.locator('.about-modal').boundingBox();
        expect(box).not.toBeNull();
        expect(dialog).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(dialog!.x);
        expect(box!.x + box!.width).toBeLessThanOrEqual(dialog!.x + dialog!.width);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
    });
}

