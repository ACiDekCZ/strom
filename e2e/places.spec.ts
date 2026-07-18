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

test('the places manager cleans up orphaned coordinates (undoable)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Kolín' });
        // One live pin (Kolín, Jan's birthplace) + one orphan pin (Praha —
        // nobody in the tree writes Praha any more).
        dm.setPlaceGeos(new Map([
            ['kolin', { lat: 50.0, lon: 15.2, label: 'Kolín' }],
            ['praha', { lat: 50.08, lon: 14.42, label: 'Praha' }],
        ]));
        window.Strom.TreeRenderer.render();
    });

    await page.evaluate(() => window.Strom.UI.showPlacesManager());
    const modal = page.locator('#places-modal');
    await expect(modal).toBeVisible();

    // The footer offers the cleanup with the orphan count.
    const cleanBtn = page.locator('#places-clean-orphans');
    await expect(cleanBtn).toBeEnabled();
    await expect(cleanBtn).toContainText('(1)');

    await cleanBtn.click();
    await page.locator('#confirmation-modal #confirm-ok-btn').click();

    // Only the orphan is gone; the live pin stays.
    await expect.poll(() => page.evaluate(() =>
        Object.keys(window.Strom.DataManager.getData().places || {}).sort()
    )).toEqual(['kolin']);

    // Undo restores the orphan (it went through the normal mutation path).
    await page.evaluate(() => window.Strom.DataManager.undo());
    await expect.poll(() => page.evaluate(() =>
        Object.keys(window.Strom.DataManager.getData().places || {}).sort()
    )).toEqual(['kolin', 'praha']);
});
