import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, waitForPersist } from './helpers.js';

test('life events: add an event, it survives a page reload', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Open the edit modal and reveal the extended fields that hold events.
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();

    // Add an "Occupation" event with a place via the event editor dialog.
    await modal.locator('#btn-add-event').click();
    const editor = page.locator('#event-editor-modal');
    await expect(editor).toBeVisible();
    await editor.locator('#input-event-type').selectOption('occupation');
    await editor.locator('#input-event-date').fill('1925');
    await editor.locator('#input-event-place').fill('Kladno');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    // The event row appears in the list and the person modal can be closed.
    const list = modal.locator('#events-list');
    await expect(list).toContainText('Occupation');
    await expect(list).toContainText('Kladno');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    // Reload — the event must still be there (wait for the IndexedDB flush).
    await waitForPersist(page, 'Kladno');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();

    await cardAction(page, 'Jan', 'edit');
    // A person with events auto-expands the extended section on open.
    await expect(modal.locator('#events-list')).toContainText('Occupation');
    await expect(modal.locator('#events-list')).toContainText('Kladno');
});
