import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card, cardAction, personModal, SeedPerson } from './helpers.js';

/**
 * The surname a person goes by (spec 024, K1.1, K1.2, K1.6): under a filled
 * married surname the person editor offers Birth | Married; with Birth the
 * card and the tree show the birth surname alone, and the person's detail
 * (card menu, bottom sheet, relationships panel, editor header) says the
 * married one as "(formerly …)". Without a choice nothing changes. Invented data.
 */

/** Jan Novák and his wife Marie, born Dvořáková (`marie` adds to her). */
async function family(page: Page, marie: Partial<SeedPerson> = {}): Promise<void> {
    await seedTree(page, {
        jan: { firstName: 'Jan', lastName: 'Novák', birthDate: '1919', partners: ['marie'] },
        marie: { firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', birthDate: '1921', partners: ['jan'], ...marie },
    });
}

async function marieData(page: Page): Promise<{ marriedSurname?: string; primaryName?: string; has: boolean }> {
    return page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Marie');
        return { marriedSurname: p?.marriedSurname, primaryName: p?.primaryName, has: !!p && 'primaryName' in p };
    });
}

/** The Birth | Married radios of the open editor. */
function choice(page: Page) {
    const box = personModal(page).locator('#primary-name-choice');
    return {
        box,
        group: box.getByRole('radiogroup', { name: 'Surname in use' }),
        birth: box.getByRole('radio', { name: 'Birth' }),
        married: box.getByRole('radio', { name: 'Married' }),
        hint: box.locator('.primary-name-hint'),
    };
}

test('the choice: only under a filled married surname, never with the suggestion, Married at first; untouched it saves nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const modal = personModal(page);
    const field = modal.locator('#input-married-surname');
    const chip = modal.locator('#married-suggestion');
    const c = choice(page);

    // Empty field: the suggestion, no choice.
    await cardAction(page, 'Marie', 'edit');
    await expect(field).toBeVisible();
    await expect(chip).toBeVisible();
    await expect(c.box).toBeHidden();

    // "Use" fills the field: the chip gives way to the choice, Married on.
    await chip.getByRole('button', { name: 'Use' }).click();
    await expect(field).toHaveValue('Nováková');
    await expect(chip).toBeHidden();
    await expect(c.box).toBeVisible();
    await expect(c.group).toBeVisible();
    await expect(c.box.locator('.primary-name-label')).toHaveText('Surname in use');
    await expect(c.hint).toHaveText('For example after a divorce, with a return to the birth surname.');
    await expect(c.married).toHaveAttribute('aria-checked', 'true');
    await expect(c.married).toHaveClass(/active/);
    await expect(c.married).toHaveAttribute('tabindex', '0');
    await expect(c.birth).toHaveAttribute('aria-checked', 'false');
    await expect(c.birth).toHaveAttribute('tabindex', '-1');
    // Birth first, two equal halves across the column.
    const [b, m, f] = await Promise.all([c.birth.boundingBox(), c.married.boundingBox(), field.boundingBox()]);
    expect(b!.x).toBeLessThan(m!.x);
    expect(Math.abs(b!.width - m!.width)).toBeLessThan(1.5);
    expect(Math.abs(b!.width + m!.width - f!.width)).toBeLessThan(3);

    // Saved untouched: the married surname, no choice written.
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await marieData(page)).toEqual({ marriedSurname: 'Nováková', primaryName: undefined, has: false });

    // Reopened: the choice on Married; closing changes nothing (no question).
    await cardAction(page, 'Marie', 'edit');
    await expect(c.box).toBeVisible();
    await expect(c.married).toHaveAttribute('aria-checked', 'true');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#confirmation-modal')).toBeHidden();

    // Emptying the field hides the choice (the field stays).
    await cardAction(page, 'Marie', 'edit');
    await field.fill('');
    await expect(c.box).toBeHidden();
    await expect(field).toBeVisible();
    await field.pressSequentially('Svobodová');
    await expect(c.box).toBeVisible();
});

test('Birth: the card shows the birth surname alone, the card menu, relationships panel and editor header say "(formerly …)"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page, { marriedSurname: 'Nováková' });
    const modal = personModal(page);
    const c = choice(page);

    await cardAction(page, 'Marie', 'edit');
    await expect(modal.locator('#pm-name')).toHaveText('Marie Nováková (née Dvořáková)');
    await c.birth.click();
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');
    await expect(c.married).toHaveAttribute('aria-checked', 'false');
    // The header follows at once.
    await expect(modal.locator('#pm-name')).toHaveText('Marie Dvořáková (formerly Nováková)');
    await expect(modal.locator('#pm-name .pn-note--former')).toHaveText('(formerly Nováková)');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await marieData(page)).toEqual({ marriedSurname: 'Nováková', primaryName: 'birth', has: true });

    // The card: the birth surname, no birth row, no "formerly" (only the tooltip says it).
    const marie = card(page, 'Marie');
    await expect(marie.locator('.name-text')).toHaveAttribute('data-surname', 'Dvořáková');
    await expect(marie.locator('.card-birth')).toHaveCount(0);
    await expect(marie.locator('.name-text')).not.toContainText('formerly');
    await expect(marie.locator('.name-text')).toHaveAttribute('title', 'Marie Dvořáková (formerly Nováková)');
    await expect(marie.locator('.avatar-initials')).toHaveText('MD');

    // The card menu's header.
    await marie.click();
    const header = page.locator('.context-menu .context-menu-header');
    await expect(header).toHaveText('Marie Dvořáková (formerly Nováková)');
    await expect(header.locator('.pn-note--former')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // The relationships panel's title.
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Marie')!;
        window.Strom.UI.showRelationshipsPanel(p.id);
    });
    await expect(page.locator('#relationships-title .pn-note--former')).toHaveText('(formerly Nováková)');
    await expect(page.locator('#relationships-title')).toContainText('Marie Dvořáková (formerly Nováková)');
    await page.keyboard.press('Escape');
    await expect(page.locator('#relationships-modal')).toBeHidden();

    // Married said outright: saved as 'married', the card as without a choice.
    await cardAction(page, 'Marie', 'edit');
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');
    await c.married.click();
    await expect(modal.locator('#pm-name')).toHaveText('Marie Nováková (née Dvořáková)');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await marieData(page)).toEqual({ marriedSurname: 'Nováková', primaryName: 'married', has: true });
    await expect(marie.locator('.name-text')).toHaveAttribute('data-surname', 'Nováková');
    await expect(marie.locator('.card-birth')).toHaveText('née Dvořáková');

    // Emptying the married surname drops the choice with it.
    await cardAction(page, 'Marie', 'edit');
    await modal.locator('#input-married-surname').fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect(await marieData(page)).toEqual({ marriedSurname: undefined, primaryName: undefined, has: false });
});

test('the keyboard: one tab stop, ←/→ switch and move the focus, Space chooses', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page, { marriedSurname: 'Nováková' });
    const c = choice(page);
    await cardAction(page, 'Marie', 'edit');
    await expect(c.box).toBeVisible();

    // Tab from the field lands on the active radio only.
    await personModal(page).locator('#input-married-surname').focus();
    await page.keyboard.press('Tab');
    await expect(c.married).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(c.birth).toBeFocused();
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');
    await expect(c.birth).toHaveAttribute('tabindex', '0');
    await expect(c.married).toHaveAttribute('tabindex', '-1');
    await expect(personModal(page).locator('#pm-name')).toHaveText('Marie Dvořáková (formerly Nováková)');
    await page.keyboard.press('ArrowRight');
    await expect(c.married).toBeFocused();
    await expect(c.married).toHaveAttribute('aria-checked', 'true');

    // Space on the other radio chooses it.
    await c.birth.focus();
    await page.keyboard.press('Space');
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');

    // A changed choice is a change: closing asks.
    await personModal(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#confirmation-modal')).toBeVisible();
});

test('a locked person: the choice shows, disabled, without the hint', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page, { marriedSurname: 'Nováková', primaryName: 'birth' });
    const id = await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Marie')!.id);
    await page.evaluate((pid) => window.Strom.UI.runPersonMenuAction(pid as never, 'toggle-lock'), id);
    await cardAction(page, 'Marie', 'view');
    const c = choice(page);
    await expect(c.box).toBeVisible();
    await expect(c.birth).toBeDisabled();
    await expect(c.married).toBeDisabled();
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');
    await expect(c.hint).toBeHidden();
    await c.married.click({ force: true });
    await expect(c.birth).toHaveAttribute('aria-checked', 'true');
    expect((await marieData(page)).primaryName).toBe('birth');
});

test('Settings → Surname display "Birth surname": everyone under the birth surname, no "formerly"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page, { marriedSurname: 'Nováková', primaryName: 'birth' });
    await page.evaluate(() => window.Strom.UI.setSurnameDisplay('birth'));
    const marie = card(page, 'Marie');
    await expect(marie.locator('.name-text')).toHaveAttribute('data-surname', 'Dvořáková');
    await expect(marie.locator('.name-text')).toHaveAttribute('title', 'Marie Dvořáková');
    await marie.click();
    await expect(page.locator('.context-menu .context-menu-header')).toHaveText('Marie Dvořáková');
    await expect(page.locator('.context-menu .pn-note')).toHaveCount(0);

    // "Married surname": the choice wins, the note returns.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.setSurnameDisplay('married'));
    await expect(marie.locator('.name-text')).toHaveAttribute('data-surname', 'Dvořáková');
    await marie.click();
    await expect(page.locator('.context-menu .context-menu-header')).toHaveText('Marie Dvořáková (formerly Nováková)');
});

test('phone: 44px radios across the column, the bottom sheet says "(formerly …)" and wraps inside the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await seedTree(page, {
        karl: { firstName: 'Karl', lastName: 'Kolowrat', partners: ['maria'] },
        maria: {
            firstName: 'Maria Magdalena', lastName: 'Wartenstein-Lichtenstein', gender: 'female',
            marriedSurname: 'Kolowrat-Krakowská', primaryName: 'birth', partners: ['karl'],
        },
    }, 'Kolowrat', 'maria');
    await card(page, 'Maria').click();
    const sheet = page.locator('.bottom-sheet-person');
    await expect(sheet).toBeVisible();
    const title = sheet.locator('.bottom-sheet-menu-title');
    await expect(title).toHaveText('Maria Magdalena Wartenstein-Lichtenstein (formerly Kolowrat-Krakowská)');
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await title.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(390);

    await page.locator('.bottom-sheet-person [data-action="edit"]').filter({ visible: true }).click();
    const c = choice(page);
    await expect(c.box).toBeVisible();
    // The editor header: a note longer than the line breaks inside itself, nothing is cut.
    const header = personModal(page).locator('#pm-name');
    await expect(header).toHaveText('Maria Magdalena Wartenstein-Lichtenstein (formerly Kolowrat-Krakowská)');
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const radio of [c.birth, c.married]) {
        const box = await radio.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const field = await personModal(page).locator('#input-married-surname').boundingBox();
    const seg = await c.group.boundingBox();
    expect(Math.abs(seg!.width - field!.width)).toBeLessThan(3);
    expect(await c.group.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('GEDCOM: a name marked _STROM_PRIMARY shows on the card, the married one as "(formerly …)" in the menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/research-primary-birth.ged');
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    const jana = card(page, 'Jana');
    await expect(jana.locator('.name-text')).toHaveAttribute('data-surname', 'Lhotová');
    await expect(jana.locator('.name-text')).not.toContainText('formerly');
    await expect(jana.locator('.card-birth')).toHaveCount(0);
    await jana.click();
    await expect(page.locator('.context-menu .context-menu-header')).toHaveText('Jana Lhotová (formerly Zástěrová)');
});
