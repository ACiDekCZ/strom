import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, cardAction, personModal } from './helpers.js';

/**
 * The married surname in the person editor (spec 010, K1.1, K3.1): the field
 * right under the surname — always there for a woman with a union, behind the
 * quiet "+ married surname" link for anyone else — and under the empty field
 * the suggestion from the husband's surname (Novák → Nováková), with "Use"
 * and × (not offered again once saved). Invented data.
 */

/** Jan Novák (b. 1919) and his wife Marie, born Dvořáková; their daughter Eva. */
async function family(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novák', { birthDate: '1919' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Dvořáková', 'female');
    await addRelation(page, 'Jan', 'child', 'Eva', 'Nováková', 'female');
}

/** The data of the person with this first name. */
async function personData(page: Page, first: string): Promise<{ marriedSurname?: string; dismissedMarriedSuggestion?: string }> {
    return page.evaluate((f) => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === f);
        return { marriedSurname: p?.marriedSurname, dismissedMarriedSuggestion: p?.dismissedMarriedSuggestion };
    }, first);
}

test('the field: always there for a woman with a union, behind the link for a man and a woman without one', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const modal = personModal(page);
    const field = modal.locator('#input-married-surname');
    const link = modal.locator('#married-surname-more');

    // Marie (a union): the field under the surname, no link; the suggestion under it.
    await cardAction(page, 'Marie', 'edit');
    await expect(field).toBeVisible();
    await expect(link).toBeHidden();
    await expect(modal.locator('label[for="input-married-surname"]')).toHaveText('Married surname');
    const surnameBox = await modal.locator('#input-lastname').boundingBox();
    const fieldBox = await field.boundingBox();
    expect(fieldBox!.y).toBeGreaterThan(surnameBox!.y + surnameBox!.height);
    expect(Math.abs(fieldBox!.x - surnameBox!.x)).toBeLessThan(1);
    await expect(modal.locator('#married-suggestion')).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // Jan (a man): the quiet link beside "+ title"; a click opens the field and focuses it.
    await cardAction(page, 'Jan', 'edit');
    await expect(field).toBeHidden();
    await expect(link).toBeVisible();
    await expect(link).toHaveText('+ married surname');
    await expect(modal.locator('#name-details .detail-more')).toHaveText('+ title');
    await link.click();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(link).toBeHidden();
    await expect(modal.locator('#married-suggestion')).toBeHidden();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // Eva (a woman without a union): the link, no suggestion.
    await cardAction(page, 'Eva', 'edit');
    await expect(field).toBeHidden();
    await expect(link).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // A filled field is there for anyone, the link not.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Jan');
        if (jan) dm.updatePerson(jan.id, { marriedSurname: 'Novák-Dvořák' });
    });
    await cardAction(page, 'Jan', 'edit');
    await expect(field).toBeVisible();
    await expect(field).toHaveValue('Novák-Dvořák');
    await expect(link).toBeHidden();
    // Emptied while typing, it stays on screen.
    await field.fill('');
    await expect(field).toBeVisible();
});

test('the suggestion Novák → Nováková: "Use" fills the field, ⌘/Ctrl+Z takes it back, Save puts it on the card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const modal = personModal(page);
    const field = modal.locator('#input-married-surname');
    const chip = modal.locator('#married-suggestion');

    await cardAction(page, 'Marie', 'edit');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.married-suggestion-main')).toHaveText('Suggestion: Nováková');
    await expect(chip.locator('.married-suggestion-main strong')).toHaveText('Nováková');
    await expect(chip.locator('.married-suggestion-source')).toHaveText('from husband’s surname Jan Novák');
    await expect(chip.getByRole('button', { name: 'Hide suggestion' })).toBeVisible();
    // Only a suggestion: nothing is filled in, the form is not changed.
    await expect(field).toHaveValue('');
    await expect(field).not.toHaveAttribute('placeholder', /./);

    await chip.getByRole('button', { name: 'Use' }).click();
    await expect(field).toHaveValue('Nováková');
    await expect(field).toBeFocused();
    expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([8, 8]);
    await expect(chip).toBeHidden();
    // The header follows: the married surname, the birth one as the note.
    await expect(modal.locator('#pm-name')).toHaveText('Marie Nováková (née Dvořáková)');

    // Undo in the field takes the suggestion back (and the chip returns).
    await page.keyboard.press('ControlOrMeta+z');
    await expect(field).toHaveValue('');
    await expect(chip).toBeVisible();
    await expect(modal.locator('#pm-name')).toHaveText('Marie Dvořáková');

    await chip.getByRole('button', { name: 'Use' }).click();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await personData(page, 'Marie')).toEqual({ marriedSurname: 'Nováková', dismissedMarriedSuggestion: undefined });
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('data-surname', 'Nováková');

    // Reopened: the field holds it, no suggestion.
    await cardAction(page, 'Marie', 'edit');
    await expect(field).toHaveValue('Nováková');
    await expect(chip).toBeHidden();
});

test('typing the married surname: the header changes as it is typed, spaces are trimmed on save', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const modal = personModal(page);
    const field = modal.locator('#input-married-surname');

    await cardAction(page, 'Marie', 'edit');
    await expect(modal.locator('#pm-name')).toHaveText('Marie Dvořáková');
    await field.pressSequentially('Svobodová ');
    await expect(modal.locator('#pm-name')).toHaveText('Marie Svobodová (née Dvořáková)');
    // Typed: the suggestion goes.
    await expect(modal.locator('#married-suggestion')).toBeHidden();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect((await personData(page, 'Marie')).marriedSurname).toBe('Svobodová');

    // Emptied: none (undefined), the card shows the birth surname again.
    await cardAction(page, 'Marie', 'edit');
    await field.fill('   ');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect((await personData(page, 'Marie')).marriedSurname).toBeUndefined();
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('data-surname', 'Dvořáková');
});

test('× hides the suggestion; saved, it is not offered again — a new husband\'s surname is', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const modal = personModal(page);
    const chip = modal.locator('#married-suggestion');

    await cardAction(page, 'Marie', 'edit');
    await chip.getByRole('button', { name: 'Hide suggestion' }).click();
    await expect(chip).toBeHidden();
    await expect(modal.locator('#input-married-surname')).toHaveValue('');
    // Hidden only in the form until saved: closing asks.
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#confirmation-modal')).toBeVisible();
    await page.locator('#confirm-save-btn').click();
    await expect(modal).toBeHidden();
    expect(await personData(page, 'Marie')).toEqual({ marriedSurname: undefined, dismissedMarriedSuggestion: 'Nováková' });

    await cardAction(page, 'Marie', 'edit');
    await expect(modal.locator('#input-married-surname')).toBeVisible();
    await expect(chip).toBeHidden();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();

    // The husband's surname changes: that one is offered.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Jan');
        if (jan) dm.updatePerson(jan.id, { lastName: 'Brodský' });
    });
    await cardAction(page, 'Marie', 'edit');
    await expect(chip.locator('.married-suggestion-main')).toHaveText('Suggestion: Brodská');
});

test('several marriages: from the latest wedding; one among her other spellings says so', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    await addRelation(page, 'Marie', 'partner', 'Karel', 'Svoboda', 'male');
    // Jan's wedding 1940, Karel's 1938 (in the data after Jan's): Jan is the latest.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const by = (f: string) => dm.getAllPersons().find((x: { firstName: string }) => x.firstName === f)!;
        const marie = by('Marie');
        const jan = dm.getPartnershipBetween(marie.id, by('Jan').id)!;
        const karel = dm.getPartnershipBetween(marie.id, by('Karel').id)!;
        dm.updatePartnership(jan.id, { startDate: '1940' });
        dm.updatePartnership(karel.id, { startDate: '1938' });
        dm.updatePerson(marie.id, { nameVariants: ['Marie Nováková'] });
    });
    const modal = personModal(page);
    const chip = modal.locator('#married-suggestion');
    await cardAction(page, 'Marie', 'edit');
    await expect(chip.locator('.married-suggestion-main')).toHaveText('Suggestion: Nováková');
    await expect(chip.locator('.married-suggestion-source')).toHaveText('from husband’s surname Jan Novák · also among other spellings of the name');
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // Karel married later: his surname.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const by = (f: string) => dm.getAllPersons().find((x: { firstName: string }) => x.firstName === f)!;
        dm.updatePartnership(dm.getPartnershipBetween(by('Marie').id, by('Karel').id)!.id, { startDate: '1946' });
    });
    await cardAction(page, 'Marie', 'edit');
    await expect(chip.locator('.married-suggestion-main')).toHaveText('Suggestion: Svobodová');
    await expect(chip.locator('.married-suggestion-source')).toHaveText('from husband’s surname Karel Svoboda');
});

test('an English tree: Smith stays Smith', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'John', 'Smith', { birthDate: '1950' });
    await addRelation(page, 'John', 'partner', 'Mary', 'Brown', 'female');
    await cardAction(page, 'Mary', 'edit');
    await expect(personModal(page).locator('#married-suggestion .married-suggestion-main')).toHaveText('Suggestion: Smith');
});

test('phone: a 44px field and 44px buttons, the field moves up into view when focused', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page);
    await family(page);
    await cardAction(page, 'Marie', 'edit');
    const modal = personModal(page);
    const field = modal.locator('#input-married-surname');
    await expect(field).toBeVisible();
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const name of ['Use', 'Hide suggestion']) {
        const box = await modal.locator('#married-suggestion').getByRole('button', { name }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // Scrolled away, then focused: the field comes back to the upper third.
    const scroller = modal.locator('.modal-content').first();
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.evaluate(() => document.querySelector<HTMLInputElement>('#input-married-surname')?.blur());
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // Without the browser's own scrolling: the dialog moves it.
    await field.evaluate((el: HTMLInputElement) => el.focus({ preventScroll: true }));
    const top = await field.evaluate((el) => el.getBoundingClientRect().top);
    // Under the dialog's header (with its label), in the upper third.
    const visibleFrom = await scroller.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(visibleFrom + 16);
    expect(top).toBeLessThanOrEqual(740 / 3);
});
