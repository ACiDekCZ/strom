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
    await expect(modal.locator('#attachments-total')).toContainText(/^This person: 1 attachment \d/);
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
    // Nothing of this person's in the file: no size line (the whole tree's is not theirs).
    await expect(modal.locator('#attachments-total')).toHaveText('');
});

test('the size line is this person\'s: photo, attachments, excerpts of their sources; the whole tree only as a warning', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async () => {
        window.Strom.UI.toggleAdvancedFields(true);
        const px = 'data:image/png;base64,' + 'A'.repeat(4000);
        const big = 'data:image/jpeg;base64,' + 'B'.repeat(15 * 1024 * 1024);
        const p = (id: string, extra: Record<string, unknown>) => ({ id, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                a: p('a', { firstName: 'Adam', lastName: 'Malý', photo: px, birthSourceIds: ['s1'] }),
                b: p('b', { firstName: 'Bedřich', lastName: 'Velký', attachments: [{ id: 'x', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: big, sizeBytes: 15 * 1024 * 1024 }] }),
            },
            partnerships: {},
            sources: { s1: { id: 's1', title: 'Křest', excerpts: [{ id: 'e1', dataUrl: px, width: 10, height: 10, sizeBytes: 3000 }] } },
        } as never, 'Velikosti');
        window.Strom.UI.showEditPersonModal('a' as never);
    });
    const total = page.locator('#attachments-total');
    await expect(total.locator('div').first()).toHaveText(/^This person: photo \d+ kB · 1 excerpt from sources \d+ kB$/);
    await expect(total.locator('.warn')).toContainText('Images in the whole tree: 15');
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
