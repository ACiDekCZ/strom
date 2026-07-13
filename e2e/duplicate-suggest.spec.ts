import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, fillPerson, personModal } from './helpers.js';

function realPersonCount(page: Page): Promise<number> {
    return page.evaluate(() =>
        Object.values(window.Strom.DataManager.getData().persons)
            .filter((p: { isPlaceholder?: boolean }) => !p.isPlaceholder).length
    );
}

test('new-person modal suggests an existing similar person and can jump to it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    // Start adding another person with the same name.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novak');

    // The duplicate hint appears (debounced) with the existing Jan.
    const panel = page.locator('#duplicate-suggest-person');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Jan');

    // "Go to person" closes the modal and focuses the existing person.
    await panel.getByRole('button', { name: 'Go to person' }).click();
    await expect(modal).toBeHidden();
    await expect(card(page, 'Jan')).toHaveClass(/focused/);
});

test('add-relation offers "use existing" and links instead of duplicating', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // A second, standalone person that we will later link as Jan's child.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Petr', 'Novak');
    expect(await realPersonCount(page)).toBe(2);

    // Add child to Jan; typing Petr's name surfaces the existing Petr.
    await cardAction(page, 'Jan', 'child');
    const rel = page.locator('#relation-modal');
    await expect(rel).toBeVisible();
    await rel.locator('#rel-firstname').fill('Petr');
    await rel.locator('#rel-lastname').fill('Novak');

    const panel = page.locator('#duplicate-suggest-relation');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Use existing' }).click();
    await expect(rel).toBeHidden();

    // No duplicate was created; Petr is now Jan's child.
    expect(await realPersonCount(page)).toBe(2);
    const linked = await page.evaluate(() => {
        const persons = Object.values(window.Strom.DataManager.getData().persons) as { firstName: string; id: string; childIds: string[] }[];
        const jan = persons.find(p => p.firstName === 'Jan')!;
        const petr = persons.find(p => p.firstName === 'Petr')!;
        return jan.childIds.includes(petr.id);
    });
    expect(linked).toBe(true);
});

test('duplicate suggestions can be turned off in settings', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    // Disable the feature.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#suggest-duplicates-toggle').uncheck();
    await page.keyboard.press('Escape');

    // Now the hint never appears.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await modal.locator('#input-firstname').fill('Jan');
    await modal.locator('#input-lastname').fill('Novak');
    await expect(page.locator('#duplicate-suggest-person')).toBeHidden();
});
