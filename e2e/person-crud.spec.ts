import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation, personModal, waitForPersist } from './helpers.js';

/** Count real (non-placeholder) persons; single-parent children spawn a placeholder partner. */
function realPersonCount(page: Page): Promise<number> {
    return page.evaluate(() =>
        Object.values(window.Strom.DataManager.getData().persons)
            .filter((p: { isPlaceholder?: boolean }) => !p.isPlaceholder).length
    );
}

test('a created person persists across a page reload', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan')).toBeVisible();

    await waitForPersist(page, 'Jan');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await realPersonCount(page)).toBe(1);
});

test('editing every person field survives a reload', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-firstname').fill('Johann');
    await modal.locator('#input-lastname').fill('Neumann');
    await modal.locator('#input-gender').selectOption('female');
    await modal.locator('#input-birthdate').fill('1900');
    await modal.locator('#input-birthplace').fill('Praha');
    // Extended fields (death, notes, deceased) live behind the expander.
    await modal.locator('#expand-details').click();
    await modal.locator('#input-deathdate').fill('1970');
    await modal.locator('#input-deathplace').fill('Brno');
    await modal.locator('#input-notes').fill('A test biography');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    await waitForPersist(page, 'Johann');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await cardAction(page, 'Johann', 'edit');
    await expect(modal.locator('#input-firstname')).toHaveValue('Johann');
    await expect(modal.locator('#input-lastname')).toHaveValue('Neumann');
    await expect(modal.locator('#input-gender')).toHaveValue('female');
    await expect(modal.locator('#input-birthdate')).toHaveValue('1900');
    await expect(modal.locator('#input-birthplace')).toHaveValue('Praha');
    await expect(modal.locator('#input-deathdate')).toHaveValue('1970');
    await expect(modal.locator('#input-deathplace')).toHaveValue('Brno');
    await expect(modal.locator('#input-notes')).toHaveValue('A test biography');
    await expect(modal.locator('#input-is-deceased')).toBeChecked();
});

test('deleting a person via the context menu asks for confirmation and undo restores it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');
    expect(await realPersonCount(page)).toBe(2);

    await cardAction(page, 'Petr', 'delete');
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect(confirm).toBeHidden();
    await expect(card(page, 'Petr')).toBeHidden();
    expect(await realPersonCount(page)).toBe(1);

    await page.locator('#tree-container').click();
    await page.keyboard.press('Control+z');
    await expect(card(page, 'Petr')).toBeVisible();
    expect(await realPersonCount(page)).toBe(2);
});

test('the Delete key removes the focused person after confirmation', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Petr', 'focus');
    await expect(card(page, 'Petr')).toHaveClass(/focused/);

    await page.locator('#tree-container').click();
    await page.keyboard.press('Delete');
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect(confirm).toBeHidden();
    await expect(card(page, 'Petr')).toBeHidden();
    expect(await realPersonCount(page)).toBe(1);
});

test('deleting the last person returns the empty state', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(page.locator('#empty-state')).toBeHidden();

    await cardAction(page, 'Jan', 'delete');
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect(confirm).toBeHidden();

    await expect(page.locator('#empty-state')).toBeVisible();
    expect(await realPersonCount(page)).toBe(0);
});

test('a long first name shrinks to fit the card instead of truncating', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Johannes Jacobus', 'Habsburg');

    const nameText = card(page, 'Johannes').locator('.name-text');
    await expect(nameText).toHaveClass(/fit-tight/);
    // The full name stays readable (not cut off): no horizontal overflow left.
    const fits = await nameText.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
});
