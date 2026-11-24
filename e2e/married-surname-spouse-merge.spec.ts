import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, createFirstPerson, mergeCompare, mergeCount, mergePair, mergeRow, mergeGroup } from './helpers.js';

/**
 * A wife written in the tree under the surname after marriage and in the file
 * under her birth one (spec 134 K10.6): her husband and their six children
 * join, and she is offered in Maybe the same through those shared children,
 * never added as new — which would give each child a third parent and him a
 * second wife. The file also brings his parents and his unmarried sister
 * Marie Modřínová, whom the tree does not have; by name and birth year she
 * looks more like the tree's wife than the wife does.
 *
 * The fixtures (e2e/fixtures/married-surname-family-tree.json + -import.ged)
 * serve the conflicts of step 4 too (K10.7, K10.8).
 */

test('the wife under her birth surname is offered through the shared children, not added as new', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    const tree = JSON.parse(readFileSync('e2e/fixtures/married-surname-family-tree.json', 'utf8'));
    await page.evaluate((data) => {
        window.Strom.DataManager.loadStromData(data as never);
        window.Strom.TreeRenderer.render();
    }, tree);

    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/married-surname-family-import.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);

    // Husband and six children joined; his parents and sister new; she waits to be decided.
    await expect(mergeCount(wizard, 'joined')).toHaveText('7');
    await expect(mergeCount(wizard, 'added')).toHaveText('3');
    await expect(mergeCount(wizard, 'pending')).toHaveText('1');

    await mergeGroup(wizard, 'new');
    await expect(mergeRow(wizard, 'Šeříková')).toHaveCount(0);

    const wifeRow = await mergePair(wizard, 'Šeříková', 'maybe');
    await expect(wifeRow).toHaveAttribute('data-fate', 'pending');
    await expect(wizard.locator('#merge-pair .pair')).toContainText('Marie Anna');
    await expect(wizard.locator('#merge-pair .merge-why')).toContainText('Partner of a joined person, shared children');

    await wizard.locator('#merge-pair .merge-dec[data-dec="same"]').click();
    await expect(wifeRow).toHaveAttribute('data-fate', 'joined');
    await expect(mergeCount(wizard, 'joined')).toHaveText('8');
    await expect(mergeCount(wizard, 'added')).toHaveText('3');
    await expect(mergeCount(wizard, 'pending')).toHaveText('0');
});
