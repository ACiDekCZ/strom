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

test('photo: rotate buttons are available and the photo survives rotation + save', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    // The photo editor lives in the collapsible "More Info" section.
    await modal.locator('#expand-details').click();
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/avatar.png');
    await expect(modal.locator('#photo-preview img')).toHaveCount(1);

    // Rotate buttons appear once a photo is present and rotate without error.
    await expect(modal.locator('#photo-rotate-right')).toBeVisible();
    await expect(modal.locator('#photo-rotate-left')).toBeVisible();
    await modal.locator('#photo-rotate-right').click();
    await modal.locator('#photo-rotate-left').click();
    // Still a valid JPEG portrait after rotating.
    await expect.poll(() => modal.locator('#photo-preview img').getAttribute('src'))
        .toMatch(/^data:image\/jpeg/);

    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // The photo persisted through rotation + save.
    const stored = await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons()[0].photo);
    expect(stored).toMatch(/^data:image\/jpeg/);
});

// The actual 90-degree pixel transform is exercised on an ASYMMETRIC image
// (top half black, bottom half white) so a real rotation is observable
// (avatar.png is symmetric → its bytes wouldn't change).
test('photo: a 90-degree rotation actually changes an asymmetric image', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/asymmetric.png');
    await expect(modal.locator('#photo-preview img')).toHaveCount(1);

    const before = await modal.locator('#photo-preview img').getAttribute('src');
    await modal.locator('#photo-rotate-right').click();
    await expect.poll(() => modal.locator('#photo-preview img').getAttribute('src'))
        .not.toBe(before);
});
