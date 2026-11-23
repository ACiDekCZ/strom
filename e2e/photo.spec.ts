import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

test('photo: uploading shows an avatar on the card; removing it clears the avatar', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/avatar.png');
    // The portrait editor opens over the dialog; Done puts the portrait in the preview.
    await page.locator('.pe-overlay').getByRole('button', { name: 'Done' }).click();
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

    // The photo goes, but the avatar circle stays and falls back to initials
    // (the "Letopis" card always carries an avatar in normal/detailed density).
    await expect(card(page, 'Jan')).not.toHaveClass(/has-photo/);
    await expect(card(page, 'Jan').locator('.card-avatar img')).toHaveCount(0);
    await expect(card(page, 'Jan').locator('.card-avatar .avatar-initials')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    await expect(card(page, 'Jan').locator('.card-avatar .avatar-initials')).toBeVisible();
});

// The 90-degree turn is exercised on an ASYMMETRIC image (top half black,
// bottom half white) so a real rotation is observable (avatar.png is
// symmetric → its bytes wouldn't change). The dialog has no turn buttons of
// its own any more: the portrait editor turns the photo (spec 107 §1).
test('photo: the editor turns the image for real, and the turned photo survives save', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    const editor = page.locator('.pe-overlay');
    await expect(modal.locator('#photo-rotate-right, #photo-rotate-left')).toHaveCount(0);
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/asymmetric.png');
    await editor.getByRole('button', { name: 'Done' }).click();
    const before = await modal.locator('#photo-preview img').getAttribute('src');

    // The same file turned by a quarter: another image.
    await modal.locator('#input-photo').setInputFiles('e2e/fixtures/asymmetric.png');
    await editor.getByRole('button', { name: 'Rotate right' }).click();
    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(editor).toHaveCount(0);
    const turned = await modal.locator('#photo-preview img').getAttribute('src');
    expect(turned).toMatch(/^data:image\/jpeg/);
    expect(turned).not.toBe(before);

    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    // The turned photo persisted, its source saying so.
    const stored = await page.evaluate(async () => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return { photo: await window.Strom.Images.expandedData(p.photo), turns: p.photoSource?.quarterTurns };
    });
    expect(stored.photo).toBe(turned);
    expect(stored.turns).toBe(1);
});
