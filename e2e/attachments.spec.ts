import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, waitForPersist } from './helpers.js';

test('attachments: add an image, it survives a reload, then delete it', async ({ page }) => {
    await openApp(page);
    // Attachments are a research field — off by default (see advanced-fields.spec).
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');

    // Open the edit modal and reveal the extended fields that hold attachments.
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);

    // Attach an image (compressed in-browser) and add a note.
    await modal.locator('#input-attachment').setInputFiles('e2e/fixtures/avatar.png');
    const list = modal.locator('#attachments-list');
    await expect(list.locator('.attachment-row')).toHaveCount(1);
    await list.locator('.attachment-note-input').fill('Birth certificate');
    await list.locator('.attachment-note-input').blur();
    await expect(modal.locator('#attachments-total')).toContainText('1');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    // Reload — the attachment (and its note) persist.
    await waitForPersist(page, 'Birth certificate');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(1);
    await expect(modal.locator('.attachment-note-input')).toHaveValue('Birth certificate');

    // Delete it.
    await modal.locator('.attachment-actions button').click();
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect(modal.locator('#attachments-list')).not.toContainText('avatar');
    await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(0);
});

test('attachments: a rejected PDF over the size cap is not added', async ({ page }) => {
    await openApp(page);
    // Attachments are a research field — off by default (see advanced-fields.spec).
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);

    // A > 2 MB PDF is rejected with a warning; nothing is attached.
    const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024 + 1024, 0x20)]);
    await modal.locator('#input-attachment').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: bigPdf });
    const alert = page.locator('#confirmation-modal');
    await expect(alert).toBeVisible();
    await expect(alert.locator('#confirm-message')).toContainText('too large');
    await alert.locator('#confirm-ok-btn').click();
    await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(0);
});
