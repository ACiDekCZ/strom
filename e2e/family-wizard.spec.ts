import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction } from './helpers.js';

/**
 * Family wizard: add parents, a partner and children in one form; the tree
 * renders them and a single Ctrl+Z removes the whole family.
 */
test('add a whole family via the wizard and undo it in one step', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Ego', 'Root');
    await expect(card(page, 'Ego')).toBeVisible();
    // A non-blocking "add family?" offer toast appears; dismiss it and drive the
    // wizard from the context menu instead.
    await page.locator('.family-offer-close').click();

    // Open the wizard from the context menu.
    await cardAction(page, 'Ego', 'add-family');
    const modal = page.locator('#family-wizard-modal');
    await expect(modal).toBeVisible();

    // Fill parents, a partner and two children.
    await modal.locator('.wiz-row[data-kind="father"] .wiz-first').fill('Otec');
    await modal.locator('.wiz-row[data-kind="mother"] .wiz-first').fill('Matka');
    await modal.locator('.wiz-row[data-kind="partner"] .wiz-first').fill('Partner');
    const children = modal.locator('.wiz-row[data-kind="child"]');
    await children.nth(0).locator('.wiz-first').fill('Syn');
    await modal.getByRole('button', { name: '+ Child' }).click();
    await modal.locator('.wiz-row[data-kind="child"]').nth(1).locator('.wiz-first').fill('Dcera');

    await modal.getByRole('button', { name: 'Add family' }).click();
    await expect(modal).toBeHidden();

    // All five new people render.
    for (const name of ['Otec', 'Matka', 'Partner', 'Syn', 'Dcera']) {
        await expect(card(page, name)).toBeVisible();
    }

    // One Ctrl+Z removes the entire family, leaving only Ego.
    await page.keyboard.press('Control+z');
    for (const name of ['Otec', 'Matka', 'Partner', 'Syn', 'Dcera']) {
        await expect(card(page, name)).toHaveCount(0);
    }
    await expect(card(page, 'Ego')).toBeVisible();
});
