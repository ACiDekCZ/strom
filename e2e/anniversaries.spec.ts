import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, waitForPersist } from './helpers.js';

/**
 * Anniversaries + "on this day": a person whose birthday is today triggers the
 * once-a-day card (gone after dismiss + reload) and is listed in the panel.
 */
test('on-this-day card shows once and the anniversaries panel lists today\'s birthday', async ({ page }) => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const birthDate = `1980-${mm}-${dd}`;  // born today, decades ago

    await openApp(page);
    await createFirstPerson(page, 'Marie', 'Novak', { gender: 'female', birthDate });
    await waitForPersist(page, 'Marie');

    // Trigger the "on this day" check deterministically (normally fired on idle).
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    const card = page.locator('#otd-card');
    await expect(card).toBeVisible();
    await expect(card.locator('#otd-text')).toContainText('Marie');

    // Dismiss it; a second check the same day does nothing (once per day).
    await card.locator('.otd-close').click();
    await expect(card).toBeHidden();
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    await expect(card).toBeHidden();

    // After reload the startup check must not resurface it (localStorage guard).
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page.locator('#otd-card')).toBeHidden();

    // The anniversaries panel lists today's birthday.
    await page.evaluate(() => window.Strom.UI.showAnniversariesDialog());
    const modal = page.locator('#anniversaries-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.anniversary-row')).toHaveCount(1);
    await expect(modal.locator('.anniversary-row')).toContainText('Marie');
});

test('the on-this-day card belongs to the open tree and goes when switching trees', async ({ page }) => {
    const now = new Date();
    const today = `1950-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await openApp(page);
    await createFirstPerson(page, 'Vera', 'Old', { gender: 'female', birthDate: today });
    await waitForPersist(page, 'Vera');
    const first = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
    await page.evaluate(() => window.Strom.UI.maybeShowOnThisDay());
    const card = page.locator('#otd-card');
    await expect(card).toContainText('Vera');

    // Another tree without an anniversary today: the card is not left behind.
    await page.evaluate(() => {
        window.Strom.DataManager.createNewTree('Other');
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
    });
    await expect(card).toBeHidden();

    // Back in the first tree: already shown today, so it stays away.
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), first);
    await expect(page.locator('.person-card', { hasText: 'Vera' })).toBeVisible();
    await expect(card).toBeHidden();
});
