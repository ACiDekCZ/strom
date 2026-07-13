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
