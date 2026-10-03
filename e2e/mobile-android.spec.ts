import { test, devices } from '@playwright/test';
import { phoneScreens } from './mobile-screens.js';

/** An Android phone (Chromium): the same main screens as the iPhone in mobile-webkit.spec.ts. */
test.use({ ...devices['Pixel 7'] });

test('Android phone: the main screens fit; a card opens its sheet; no minimap; the new-version prompt fits', async ({ page }) => {
    await phoneScreens(page);
});
