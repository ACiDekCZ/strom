import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, focusViaSearch } from './helpers.js';

/**
 * The add form's big title is the person being written down — "New person"
 * until a name is typed, then that name, live. It never shows somebody else's
 * name (the focused person, the person last edited, the one the relative is
 * being added to), and there is no "Add person" subtitle repeating it.
 */
test('the add form is titled by the person being typed, never by another', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Eleanor', 'Whitfield', { birthDate: '1901' });
    await focusViaSearch(page, 'Eleanor');

    const modal = personModal(page);
    const name = modal.locator('#pm-name');
    const context = modal.locator('#modal-title');

    // Open the editor first so the form was last filled with Eleanor's record.
    await cardAction(page, 'Eleanor', 'edit');
    await expect(name).toHaveText('Eleanor Whitfield');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // Toolbar "Add person".
    await page.getByRole('button', { name: 'Add person' }).first().click();
    await expect(modal).toBeVisible();
    await expect(name).toHaveText('New person');
    await expect(context).toBeHidden();
    await expect(modal).not.toContainText('Eleanor');
    await expect(modal).not.toContainText('Whitfield');

    // Live: the title follows the name fields.
    await modal.locator('#input-firstname').pressSequentially('Karel');
    await expect(name).toHaveText('Karel');
    await modal.locator('#input-lastname').pressSequentially('Dvorak');
    await expect(name).toHaveText('Karel Dvorak');
    await modal.locator('#input-firstname').fill('');
    await modal.locator('#input-lastname').fill('');
    await expect(name).toHaveText('New person');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // Add child / parent / partner / sibling from the focused person's card:
    // the relation form names the relation, not the person it hangs on.
    const relation = page.locator('#relation-modal');
    for (const action of ['child', 'parent', 'partner', 'sibling'] as const) {
        await cardAction(page, 'Eleanor', action);
        await expect(relation).toBeVisible();
        await expect(relation.locator('#relation-title')).not.toContainText('Eleanor');
        await expect(relation.locator('#relation-title')).not.toContainText('Whitfield');
        await relation.getByRole('button', { name: 'Cancel' }).click();
        await expect(relation).toBeHidden();
    }

    // The family wizard opens the add form too.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(name).toHaveText('New person');
    await expect(modal).not.toContainText('Eleanor');
});

/**
 * The date field is short ("e.g. 1880"); the accepted forms are said once, in
 * one hint line under the field — never repeated by the placeholder.
 */
test('the birth date explains its formats exactly once', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);

    const input = modal.locator('#input-birthdate');
    await expect(input).toHaveAttribute('placeholder', 'e.g. 1880');
    const hint = modal.locator('#birthdate-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('before 1900');
    await expect(input).toHaveAttribute('aria-describedby', 'birthdate-hint');

    const hintText = (await hint.textContent())!.trim();
    const visibleText = await modal.evaluate((el) => (el as HTMLElement).innerText);
    expect(visibleText.split(hintText).length - 1, 'the hint appears once').toBe(1);
});

/**
 * "More details" is a section-heading disclosure: a real button that says
 * whether it is open, and reveals the rest of the form.
 */
test('"More details" is an accessible disclosure', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);

    const toggle = modal.locator('#expand-details');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText(/more details/i);
    await expect(modal.locator('#input-deathdate')).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(modal.locator('#input-deathdate')).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(modal.locator('#input-deathdate')).toBeHidden();
});

test.describe('in Czech', () => {
    test.use({ locale: 'cs-CZ' });

    test('the add form reads "Nová osoba" with a Czech date hint', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showAddPersonModal());
        const modal = personModal(page);
        await expect(modal.locator('#pm-name')).toHaveText('Nová osoba');
        await expect(modal.locator('#modal-title')).toBeHidden();
        await expect(modal.locator('#input-birthdate')).toHaveAttribute('placeholder', 'např. 1880');
        await expect(modal.locator('#birthdate-hint')).toContainText('před 1900');
    });
});
