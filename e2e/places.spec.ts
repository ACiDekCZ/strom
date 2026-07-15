import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

/**
 * Places registry (K5): suggestions come from the tree's own places (nothing is
 * downloaded), and a place written several ways is flagged and can be unified
 * in one click.
 */
test('place suggestions come from the tree, most used first', async ({ page }) => {
    // Built from scratch rather than from the demo, which carries places of its
    // own — this is about the suggestions coming from THIS tree's places.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Kolín', deathPlace: 'Kolín' });
        const marie = dm.createPerson({ firstName: 'Marie', lastName: 'Novakova', gender: 'female' });
        dm.updatePerson(marie.id, { birthPlace: 'Beroun' });
        window.Strom.TreeRenderer.render();
    });
    // Most used first: Kolín (2×) before Beroun (1×).
    await expect.poll(() => page.evaluate(() =>
        [...document.querySelectorAll('#places-datalist option')].map(o => (o as HTMLOptionElement).value)
    )).toEqual(['Kolín', 'Beroun']);

    // The birth-place field offers them.
    await cardAction(page, 'Jan', 'edit');
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
