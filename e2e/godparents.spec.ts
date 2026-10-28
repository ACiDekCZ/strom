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
    // A lead: in the Leads, its group closed until opened.
    const group = page.locator('#tree-validation-content .vq-section[data-section="trace"] .vq-group[data-type="recurringGodparent"]');
    await expect(group.locator('.vq-group-count')).toHaveText('1');
    await group.locator('.vq-group-head').click();
    const report = group.locator('.vq-row');
    await expect(report.locator('.vq-subject')).toHaveText('Marie Dvořáková');
    // States exactly what was counted: events across distinct people.
    await expect(report).toContainText('at 3 events of 3 people');
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
    await expect(page.locator('#tree-validation-content .validation-passed')).toBeVisible();
    await expect(page.locator('#tree-validation-content .vq-group[data-type="recurringGodparent"]')).toHaveCount(0);
});
