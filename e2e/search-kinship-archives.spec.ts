import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction } from './helpers.js';

async function addChild(page: Page, fromName: string, first: string, last: string): Promise<void> {
    await cardAction(page, fromName, 'child');
    const rel = page.locator('#relation-modal');
    await rel.locator('#rel-firstname').fill(first);
    await rel.locator('#rel-lastname').fill(last);
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
}

test('search focuses the found person', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addChild(page, 'Jan', 'Petr', 'Novak'); // Petr becomes the focus

    const input = page.locator('#toolbar-search-picker .person-picker-input');
    await input.fill('Jan');
    await page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Jan' }).first().click();

    await expect(card(page, 'Jan')).toHaveClass(/focused/);
});

test('relationship calculator shows a kinship term', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addChild(page, 'Jan', 'Petr', 'Novak');

    await cardAction(page, 'Jan', 'relationship');
    const modal = page.locator('#kinship-modal');
    await expect(modal).toBeVisible();
    await modal.locator('.person-picker-input').fill('Petr');
    await modal.locator('.person-picker-item', { hasText: 'Petr' }).first().click();

    const result = modal.locator('#kinship-result');
    await expect(result).toBeVisible();
    await expect(result).not.toBeEmpty();
});

test('archive search gates Czech portals by place relevance (EN UI)', async ({ page }) => {
    await openApp(page);

    // Person with no Czech place: only the international section.
    await createFirstPerson(page, 'John', 'Smith', { birthPlace: 'London' });
    await cardAction(page, 'John', 'archives');
    let modal = page.locator('#archives-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('FamilySearch');
    await expect(modal).not.toContainText('Czech registers');
    await modal.getByRole('button', { name: 'Close' }).click().catch(() => {});
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // Person with a Czech place: the Czech register section appears.
    await cardAction(page, 'John', 'edit');
    await page.locator('#person-modal #input-birthplace').fill('Brno');
    await page.locator('#person-modal').getByRole('button', { name: 'Save' }).click();
    await cardAction(page, 'John', 'archives');
    modal = page.locator('#archives-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Czech registers');
});
