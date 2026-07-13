import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation, fillPerson } from './helpers.js';

function realPersonCount(page: Page): Promise<number> {
    return page.evaluate(() =>
        Object.values(window.Strom.DataManager.getData().persons)
            .filter((p: { isPlaceholder?: boolean }) => !p.isPlaceholder).length
    );
}

async function janId(page: Page): Promise<string> {
    const id = await card(page, 'Jan').getAttribute('data-id');
    if (!id) throw new Error('Jan has no data-id');
    return id;
}

test('adding a sibling via the context menu renders the new card', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await cardAction(page, 'Jan', 'sibling');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#rel-firstname').fill('Anna');
    await modal.locator('#rel-lastname').fill('Novak');
    await modal.locator('#rel-gender').selectOption('female');
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();

    await expect(card(page, 'Anna')).toBeVisible();
});

test('linking an existing person as a partner creates no duplicate', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // A second, unrelated person to link later.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Marie', 'Svoboda', { gender: 'female' });
    expect(await realPersonCount(page)).toBe(2);

    // Add partner to Jan, but link the EXISTING Marie instead of creating a new one.
    await cardAction(page, 'Jan', 'partner');
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#toggle-link-mode').click();
    await modal.locator('#existing-person-picker .person-picker-input').fill('Marie');
    await modal.locator('#existing-person-picker .person-picker-item', { hasText: 'Marie' }).first().click();
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();

    // No new person was created; Jan and Marie are now a couple.
    expect(await realPersonCount(page)).toBe(2);
    await cardAction(page, 'Jan', 'focus');
    await expect(card(page, 'Marie')).toBeVisible();
});

test('partnership status and note can be changed and a partnership removed', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    // Open the relationships panel for Jan and mark the union divorced with a note.
    const id = await janId(page);
    await page.evaluate((pid) => window.Strom.UI.showRelationshipsPanel(pid), id);
    const panel = page.locator('#relationships-modal');
    await expect(panel).toBeVisible();
    await panel.locator('.rel-status-select').first().selectOption('divorced');
    await panel.locator('.partnership-note').first().fill('Divorced in 1960');
    await page.evaluate(() => window.Strom.UI.saveRelationships());
    await expect(panel).toBeHidden();

    // Reopen: the changes persisted.
    await page.evaluate((pid) => window.Strom.UI.showRelationshipsPanel(pid), id);
    await expect(panel).toBeVisible();
    await expect(panel.locator('.rel-status-select').first()).toHaveValue('divorced');
    await expect(panel.locator('.partnership-note').first()).toHaveValue('Divorced in 1960');

    // Remove the partnership.
    await panel.locator('.rel-remove-btn[data-rel-type="partner"]').first().click();
    await page.evaluate(() => window.Strom.UI.saveRelationships());
    await expect(panel).toBeHidden();

    const partnerships = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().partnerships).length);
    expect(partnerships).toBe(0);
});
