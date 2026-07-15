import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

test('photo: uploading shows an avatar on the card; removing it clears the avatar', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/avatar.png');
    await expect(modal.locator('#photo-preview img')).toHaveCount(1);
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    await expect(card(page, 'Jan')).toHaveClass(/has-photo/);
    await expect(card(page, 'Jan').locator('.card-avatar img')).toBeVisible();

    // Remove: the edit modal auto-expands (photo present), so the remove button is visible.
    await cardAction(page, 'Jan', 'edit');
    await modal.locator('#photo-remove-btn').click();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    await expect(card(page, 'Jan').locator('.card-avatar')).toHaveCount(0);
});

test('photo: rotate buttons change the image and the rotation persists on save', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/avatar.png');
    await expect(modal.locator('#photo-preview img')).toHaveCount(1);

    // Rotate buttons appear once a photo is present.
    await expect(modal.locator('#photo-rotate-right')).toBeVisible();
    const before = await modal.locator('#photo-preview img').getAttribute('src');
    await modal.locator('#photo-rotate-right').click();
    await expect.poll(async () =>
        modal.locator('#photo-preview img').getAttribute('src')).not.toBe(before);
    const rotated = await modal.locator('#photo-preview img').getAttribute('src');

    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // The rotated image is what got stored.
    const stored = await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons()[0].photo);
    expect(stored).toBe(rotated);
});
