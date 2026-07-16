import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation } from './helpers.js';

/**
 * The godparent who keeps turning up (P2). Recording who stood at a baptism was
 * only half of it — the half that matters is the pattern, and the app stored it
 * and said nothing.
 */
test('a name at several baptisms is reported as a lead', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Anna', 'Novakova', 'female');

    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        // One neighbour standing at all three baptisms.
        for (const name of ['Petr', 'Anna', 'Jan']) {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === name);
            if (p) dm.addLifeEvent(p.id, {
                type: 'baptism', date: '1880',
                participants: [{ id: `pt_${name}`, role: 'godparent', name: 'Marie Dvořáková' }],
            });
        }
    });

    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    await expect(page.locator('#tree-validation-modal')).toBeVisible();

    // This is the pattern a genealogist follows: she is nobody in the tree yet.
    // The name has to be there — "a godparent keeps turning up" without saying
    // which one is useless.
    const report = page.locator('#tree-validation-content');
    await expect(report).toContainText('Marie Dvořáková');
    await expect(report).toContainText('3×');
    await expect(report).toContainText('Jan Novak');
});

test('a godparent at one baptism is just a neighbour', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.addLifeEvent(dm.getAllPersons()[0].id, {
            type: 'baptism', date: '1880',
            participants: [{ id: 'pt1', role: 'godparent', name: 'Marie Dvořáková' }],
        });
    });
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    await expect(page.locator('#tree-validation-content')).not.toContainText('Marie Dvořáková');
});
