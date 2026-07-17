import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, fillPerson, card, cardAction, addRelation, personModal, waitForPersist } from './helpers.js';

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

test('a long name is clamped with an ellipsis, never overflowing the card', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Johannes Jacobus', 'Habsburg');

    // The name is never shrunk (the fit-tight mechanism was removed); it clips
    // with the CSS ellipsis and stays inside the card's width.
    const nameText = card(page, 'Johannes').locator('.name-text');
    await expect(nameText).not.toHaveClass(/fit-tight/);
    const cardW = (await card(page, 'Johannes').boundingBox())!.width;
    const nameW = (await nameText.boundingBox())!.width;
    expect(nameW).toBeLessThanOrEqual(cardW);
});

test('birth-date estimate hint fills an approximate year from other dates (K11)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Dcera', 'Novakova', { birthDate: '1880', gender: 'female' });
    await addRelation(page, 'Dcera', 'parent', 'Otec', 'Novak');
    await cardAction(page, 'Otec', 'edit');
    const modal = personModal(page);
    const hint = modal.locator('#birthdate-estimate');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('1868');   // 1880 - min parent age (12)
    await hint.locator('.field-hint-apply').click();
    await expect(modal.locator('#input-birthdate')).toHaveValue('~1868');
    // Once a date is entered, the hint hides.
    await modal.locator('#input-birthdate').fill('1870');
    await modal.getByRole('button', { name: 'Save' }).click();
    await cardAction(page, 'Otec', 'edit');
    await expect(modal.locator('#birthdate-estimate')).toBeHidden();
});

test('reference number and open question persist and mark the card (K12/F3)', async ({ page }) => {
    await openApp(page);
    // Name variants / reference numbers are research fields — off by default.
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Marie', 'Novakova', { gender: 'female' });
    await cardAction(page, 'Marie', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-refn').fill('box 12/1880');
    await modal.locator('#input-question').fill('Does anyone know her birth date?');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    const stored = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return { refn: p.refn, question: p.question };
    });
    expect(stored.refn).toBe('box 12/1880');
    expect(stored.question).toBe('Does anyone know her birth date?');

    // The card gets a subtle open-question marker.
    await expect(card(page, 'Marie')).toHaveClass(/has-question/);

    // Values survive a reopen — and the modal auto-expands because the person
    // now HAS extended data, so the fields are visible without a click.
    await cardAction(page, 'Marie', 'edit');
    await expect(modal.locator('#input-refn')).toBeVisible();
    await expect(modal.locator('#input-refn')).toHaveValue('box 12/1880');
    await modal.locator('#input-question').fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(card(page, 'Marie')).not.toHaveClass(/has-question/);
});

test('editing shows the whole record; adding starts short', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    // Adding: the short form, with the rest a click away.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await expect(modal.locator('#expand-details')).toBeVisible();
    await expect(modal.locator('#input-deathdate')).toBeHidden();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // Editing: everything, no hunting. This used to depend on a hand-written
    // list of "fields that count as extended data" — miss one and its value was
    // invisible until you expanded by hand, which happened twice.
    await cardAction(page, 'Jan', 'edit');
    await expect(modal.locator('#expand-details')).toBeHidden();
    await expect(modal.locator('#input-deathdate')).toBeVisible();
    await expect(modal.locator('#input-notes')).toBeVisible();
    await expect(modal.locator('#events-section')).toBeVisible();
});

test('a person added from the modal is findable in search right away', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Add a second person via the toolbar modal — no import, no tree switch.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Bartolomej', 'Vzacny');

    // The search picker must know them immediately (its cached list refreshes
    // on save — it used to stay stale until an import or a tree switch).
    const input = page.locator('#toolbar-search-picker .person-picker-input');
    await input.click();
    await input.fill('Bartolomej');
    await expect(page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Bartolomej' })).toBeVisible();
});
