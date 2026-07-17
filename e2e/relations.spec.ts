import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction } from './helpers.js';

async function addRelation(
    page: Page,
    fromName: string,
    action: 'parent' | 'partner' | 'child' | 'sibling',
    firstName: string,
    lastName: string,
    gender?: 'male' | 'female'
): Promise<void> {
    await cardAction(page, fromName, action);
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#rel-firstname').fill(firstName);
    await modal.locator('#rel-lastname').fill(lastName);
    if (gender === 'female') {
        await modal.locator('#rel-gender').selectOption('female');
    }
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();
}

test('add partner, child and parent via the context menu; cards render', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await expect(card(page, 'Marie')).toBeVisible();

    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await expect(card(page, 'Petr')).toBeVisible();

    await addRelation(page, 'Jan', 'parent', 'Josef', 'Novak');
    await expect(card(page, 'Josef')).toBeVisible();

    // Four distinct cards now on the canvas.
    await expect(page.locator('.person-card')).toHaveCount(4);
});

test('add-relation birth date is a flex-date: "~1930" saves, renders and round-trips', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Add a child with an approximate birth date through the relation modal.
    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    const birth = modal.locator('#rel-birthdate');
    // It must be the flexible text input, not the OS date picker.
    await expect(birth).toHaveAttribute('type', 'text');
    await expect(birth).toHaveClass(/flex-date/);
    await modal.locator('#rel-firstname').fill('Petr');
    await modal.locator('#rel-lastname').fill('Novak');
    await birth.fill('~1930');
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();

    // Renders on the card meta ("* ~1930").
    const petr = card(page, 'Petr');
    await expect(petr).toBeVisible();
    await expect(petr.locator('.birth-date')).toContainText('~1930');

    // Round-trips: the person modal shows the same flex value on edit.
    await cardAction(page, 'Petr', 'edit');
    const pm = page.locator('#person-modal');
    await expect(pm).toBeVisible();
    await expect(pm.locator('#input-birthdate')).toHaveValue('~1930');
});

test('add-relation birth date rejects an unparseable value', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'child');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#rel-firstname').fill('Petr');
    const birth = modal.locator('#rel-birthdate');
    await birth.fill('not a date');
    // Live validation flags the field red, exactly like the person modal.
    await expect(birth).toHaveClass(/invalid/);
    await modal.locator('#rel-submit-btn').click();
    // Save is blocked with the same alert the person modal shows.
    const alert = page.locator('#confirmation-modal');
    await expect(alert).toBeVisible();
    await expect(alert.locator('#confirm-message')).toContainText('Invalid date');
    await alert.locator('#confirm-ok-btn').click();
    // The relation modal stays open and no child card was created.
    await expect(modal).toBeVisible();
    await expect(card(page, 'Petr')).toHaveCount(0);
});
