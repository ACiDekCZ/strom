import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

test('empty state shows and the first person can be created', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();
    // Once loaded, the boot class is gone (see startup-flash.spec.ts).
    await expect(page.locator('html')).not.toHaveClass(/app-booting/);
    // The window title is the app's name only ("Strom Beta" on the test build).
    await expect(page).toHaveTitle('Strom');

    await createFirstPerson(page, 'Jan', 'Novak');

    await expect(card(page, 'Jan')).toBeVisible();
    await expect(page.locator('#empty-state')).toBeHidden();
});

// The About dialog and its version: about.spec.ts (English), cs.spec.ts (Czech).
