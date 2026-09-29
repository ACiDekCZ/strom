import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson, card } from './helpers.js';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version;

test('empty state shows and the first person can be created', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();
    // The window title is the app's name only ("Strom Beta" on the test build).
    await expect(page).toHaveTitle('Strom');

    await createFirstPerson(page, 'Jan', 'Novak');

    await expect(card(page, 'Jan')).toBeVisible();
    await expect(page.locator('#empty-state')).toBeHidden();
});

test('about dialog shows the package.json version', async ({ page }) => {
    await openApp(page);
    await page.locator('.app-logo').click();
    const about = page.locator('#about-modal');
    await expect(about).toBeVisible();
    await expect(about.locator('#about-version')).toHaveText(APP_VERSION);
});
