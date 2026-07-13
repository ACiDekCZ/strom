import { Page, expect, Locator } from '@playwright/test';

/** Load the app and wait until the toolbar is interactive. */
export async function openApp(page: Page): Promise<void> {
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
}

/** The visible person modal (add/edit). */
export function personModal(page: Page): Locator {
    return page.locator('#person-modal');
}

/** Fill and save the add-person form (modal must already be open). */
export async function fillPerson(
    page: Page,
    firstName: string,
    lastName: string,
    opts: { gender?: 'male' | 'female'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill(firstName);
    await modal.locator('#input-lastname').fill(lastName);
    if (opts.gender === 'female') {
        await modal.locator('#input-gender').selectOption('female');
    }
    if (opts.birthDate !== undefined) {
        await modal.locator('#input-birthdate').fill(opts.birthDate);
    }
    if (opts.birthPlace !== undefined) {
        await modal.locator('#input-birthplace').fill(opts.birthPlace);
    }
    await modal.getByRole('button', { name: 'Save' }).click();
}

/** Create the very first person from the empty state (or toolbar). */
export async function createFirstPerson(
    page: Page,
    firstName: string,
    lastName: string,
    opts: { gender?: 'male' | 'female'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const addFirst = page.locator('#empty-state button').first();
    if (await addFirst.isVisible().catch(() => false)) {
        await addFirst.click();
    } else {
        await page.getByRole('button', { name: 'Add Person' }).first().click();
    }
    await fillPerson(page, firstName, lastName, opts);
}

/**
 * A person card by displayed first name. Matches the name element only — the
 * card's hover tooltip also contains partner/child names, so a plain hasText on
 * the whole card would be ambiguous.
 */
export function card(page: Page, firstName: string): Locator {
    return page.locator('.person-card', {
        has: page.locator('.name-text', { hasText: firstName }),
    }).first();
}

/** Open the context menu for a card and click an action. */
export async function cardAction(page: Page, firstName: string, action: string): Promise<void> {
    await card(page, firstName).click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.locator(`.context-menu-item[data-action="${action}"]`).click();
}
