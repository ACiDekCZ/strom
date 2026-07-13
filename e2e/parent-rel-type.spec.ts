import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, addRelation, waitForPersist } from './helpers.js';

test('parent relationship type: adoptive dashes the child drop and persists', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');

    const janId = await card(page, 'Jan').getAttribute('data-id');
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), janId);
    const panel = page.locator('#relationships-modal');
    await expect(panel).toBeVisible();

    // The child row exposes a parent-relationship-type select; pick "adoptive".
    const select = panel.locator('.parent-rel-type-select').first();
    await expect(select).toBeVisible();
    await select.selectOption('adoptive');

    // The vertical drop to the child becomes dashed (stroke-dasharray 6,4).
    await expect(page.locator('#tree-lines line.child-drop[stroke-dasharray="6,4"]')).toHaveCount(1);

    // Persist: close the panel, reload, and confirm it stuck.
    await page.evaluate(() => window.Strom.UI.saveRelationships());
    await waitForPersist(page, 'adoptive');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('#tree-lines line.child-drop[stroke-dasharray="6,4"]')).toHaveCount(1);

    // The stored type is adoptive.
    const type = await page.evaluate((id) => {
        const petr = Object.values(window.Strom.DataManager.getData().persons)
            .find((p: { firstName: string }) => p.firstName === 'Petr') as { parentRelTypes?: Record<string, string> };
        return petr.parentRelTypes?.[id as string];
    }, janId);
    expect(type).toBe('adoptive');
});
