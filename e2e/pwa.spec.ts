import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * PWA offline indicator: the toolbar badge reflects connectivity. (Service
 * worker registration only runs on the hosted PWA host, not on localhost/dev,
 * so it is covered by the unit gate test rather than here — see COVERAGE.)
 */
test('offline indicator reflects connectivity', async ({ page, context }) => {
    await openApp(page);
    const badge = page.locator('#offline-indicator');
    await expect(badge).toBeHidden();

    await context.setOffline(true);
    await expect(badge).toBeVisible();

    await context.setOffline(false);
    await expect(badge).toBeHidden();
});
