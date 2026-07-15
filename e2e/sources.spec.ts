import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, waitForPersist } from './helpers.js';

test('sources: cite a new source on a person, chip survives a reload', async ({ page }) => {
    await openApp(page);
    // Citing is a research field — off by default (see advanced-fields.spec).
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');

    // Open the edit modal and reveal the extended fields that hold citations.
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();

    // Cite -> source picker -> create a new source -> it is cited automatically.
    await modal.locator('#btn-cite-person').click();
    const picker = page.locator('#source-picker-modal');
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'New source…' }).click();

    const editor = page.locator('#source-editor-modal');
    await expect(editor).toBeVisible();
    await editor.locator('#input-source-title').fill('Census 1900');
    await editor.locator('#input-source-reference').fill('fol. 12');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    await expect(picker).toBeHidden();

    // The chip appears on the person.
    const chips = modal.locator('#person-sources-chips');
    await expect(chips).toContainText('Census 1900');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    // Reload — the citation and the source both persist.
    await waitForPersist(page, 'Census 1900');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();

    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#person-sources-chips')).toContainText('Census 1900');
});

test('sources manager lists a source and shows its citation count', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');

    // Add a source via the manager.
    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    const manager = page.locator('#sources-modal');
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: 'Add source' }).click();
    const editor = page.locator('#source-editor-modal');
    await editor.locator('#input-source-title').fill('Parish register');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    await expect(manager.locator('#sources-list')).toContainText('Parish register');
    await page.evaluate(() => window.Strom.UI.closeSourcesDialog());

    // Cite it on Jan, then confirm the manager shows a citation count.
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();
    await modal.locator('#btn-cite-person').click();
    const picker = page.locator('#source-picker-modal');
    await picker.locator('.source-picker-item', { hasText: 'Parish register' }).click();
    await expect(modal.locator('#person-sources-chips')).toContainText('Parish register');
    await modal.getByRole('button', { name: 'Save' }).click();

    await page.evaluate(() => window.Strom.UI.showSourcesDialog());
    await expect(manager.locator('#sources-list')).toContainText('1×');
});

test('sources: cite a source on a partnership (marriage record)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        const marie = dm.createPerson({ firstName: 'Marie', lastName: 'Novakova', gender: 'female' });
        dm.createPartnership(jan.id, marie.id);
        dm.addSource({ title: 'Oddaci matrika', reference: 'fol. 5' });
        window.Strom.UI.showRelationshipsPanel(jan.id);
    });
    const panel = page.locator('#relationships-modal');
    await expect(panel).toBeVisible();

    // Cite button opens the picker; picking attaches the chip to the partnership.
    await panel.locator('.partnership-cite-btn').first().click();
    const picker = page.locator('#source-picker-modal');
    await expect(picker).toBeVisible();
    await picker.locator('.source-picker-item', { hasText: 'Oddaci matrika' }).click();
    await expect(picker).toBeHidden();
    await expect(panel.locator('.partnership-citations .source-chip')).toContainText('Oddaci matrika');

    // Data really landed on the partnership; uncite removes it.
    const cited = await page.evaluate(() =>
        Object.values(window.Strom.DataManager.getData().partnerships)[0].sourceIds?.length ?? 0);
    expect(cited).toBe(1);
    await panel.locator('.partnership-uncite').click();
    await expect(panel.locator('.partnership-citations .source-chip')).toHaveCount(0);
});
