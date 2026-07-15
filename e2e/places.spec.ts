import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

/**
 * Places registry (K5): suggestions come from the tree's own places (nothing is
 * downloaded), and a place written several ways is flagged and can be unified
 * in one click.
 */
test('place suggestions come from the tree, most used first', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const set = (n: string, place: string) => {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === n);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        };
        set('Henry VIII', 'Greenwich Palace');
        set('Arthur', 'Greenwich Palace');
        set('Henry VII', 'Pembroke Castle');
        window.Strom.TreeRenderer.render();
    });
    await expect.poll(() => page.evaluate(() =>
        [...document.querySelectorAll('#places-datalist option')].map(o => (o as HTMLOptionElement).value)
    )).toEqual(['Greenwich Palace', 'Pembroke Castle']);

    // The birth-place field offers them.
    await cardAction(page, 'Henry VIII', 'edit');
    await expect(personModal(page).locator('#input-birthplace')).toHaveAttribute('list', 'places-datalist');
});

test('a place written two ways is flagged and unified by the Fix button', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Děčín', deathPlace: 'decin' });
    });

    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    const issue = modal.locator('.validation-issue', { hasText: 'written several ways' });
    await expect(issue).toBeVisible();

    // One click unifies every spelling to the most-used one.
    await issue.locator('.validation-fix-btn').click();
    await expect(modal.locator('.validation-issue', { hasText: 'written several ways' })).toHaveCount(0);
    const places = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return [p.birthPlace, p.deathPlace];
    });
    expect(places[0]).toBe(places[1]);   // same spelling now
});
