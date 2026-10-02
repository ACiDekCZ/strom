import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

test('editing: a valid flex date is accepted and normalized; nonsense is rejected', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Valid approximate date is accepted and normalized to ~1880.
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-birthdate').fill('about 1880');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#input-birthdate')).toHaveValue('~1880');

    // Nonsense is rejected: an alert appears and the modal stays open.
    await modal.locator('#input-birthdate').fill('nonsense');
    await modal.getByRole('button', { name: 'Save' }).click();
    const alert = page.locator('#confirmation-modal');
    await expect(alert).toBeVisible();
    await expect(alert.locator('#confirm-message')).toContainText('Invalid date');
    await alert.locator('#confirm-ok-btn').click();
    await expect(modal).toBeVisible();
});

// Delete → Ctrl+Z → Ctrl+Shift+Z: person-crud.spec.ts (deleting a person via the context menu).

test('locking a person makes the edit form read-only', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'toggle-lock');
    const janCard = card(page, 'Jan');
    await expect(janCard).toHaveClass(/locked/);

    // A locked person's edit form is read-only and offers no Save.
    const id = await janCard.getAttribute('data-id');
    await page.evaluate((pid) => (window as any).Strom.UI.showEditPersonModal(pid), id);
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('#input-firstname')).toHaveJSProperty('readOnly', true);
    await expect(modal.locator('#input-lastname')).toHaveJSProperty('readOnly', true);
    await expect(modal.locator('#input-gender')).toBeDisabled();
    await expect(modal.locator('#btn-save')).toBeHidden();
});
