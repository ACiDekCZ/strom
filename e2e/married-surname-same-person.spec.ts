import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, createFirstPerson, mergeCompare, mergeCount, mergeCurrentStep, mergeDecide, mergePair, mergeToStep4, mergeWriteAndSwitch } from './helpers.js';

/**
 * The wife written in the tree under the surname after marriage and in the
 * file under her birth one, told New in step 2 anyway (spec 134 K10.7,
 * K10.8): step 4 shows her as a third parent once for the couple's six
 * children (not six times) and as the husband's second partner, both with
 * Same person, which joins her with the tree's wife as a decision of step 2
 * (with Undo); the conflicts go and the write gives each child two parents
 * and the husband one wife. Fixtures of K10.6 (married-surname-family-*).
 */

test('Same person on a third parent joins the wife once for all six children', async ({ page }) => {
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

    await mergeDecide(wizard, 'Šeříková', 'new', 'maybe');
    await expect(mergeCount(wizard, 'joined')).toHaveText('7');
    await expect(mergeCount(wizard, 'added')).toHaveText('4');
    await expect(mergeCount(wizard, 'pending')).toHaveText('0');

    await mergeToStep4(wizard);
    const relTab = wizard.locator('#merge-s4-tab-rels');
    if (await relTab.isVisible()) await relTab.click();
    const third = wizard.locator('.merge-s4-rel[data-rel-kind="third-parent"]');
    const partner = wizard.locator('.merge-s4-rel[data-rel-kind="partner"]');
    // One row for the couple's six children (K10.8), decided once.
    await expect(third).toHaveCount(1);
    await expect(third).toHaveAttribute('data-count', '6');
    await expect(third.locator('.merge-s4-tag')).toHaveText('third parent · 6 children');
    await expect(third).toContainText('Marie Šeříková');
    await expect(partner).toHaveCount(1);
    // The step's line counts rows, not children: two conflicts.
    await expect(mergeCurrentStep(wizard)).toContainText('2 relationship conflicts');
    await third.getByRole('radio', { name: 'From the import' }).click();
    await expect(third.getByRole('radio', { name: 'From the import' })).toHaveAttribute('aria-checked', 'true');
    await third.getByRole('radio', { name: 'Keep mine' }).click();
    await expect(third.getByRole('radio', { name: 'Keep mine' })).toHaveAttribute('aria-checked', 'true');

    // Same person: the conflicts go, the wife is joined (K10.7).
    await third.locator('.merge-s4-same').click();
    await expect(third).toHaveCount(0);
    await expect(partner).toHaveCount(0);
    await expect(mergeCount(wizard, 'joined')).toHaveText('8');
    await expect(mergeCount(wizard, 'added')).toHaveText('3');
    const joined = wizard.locator('.merge-s4-joined');
    await expect(joined).toContainText('Marie Šeříková = Marie Anna Modřínová');
    // The step now says the conflicts are resolved, not "Step 4 is skipped" with "There are no relationship conflicts".
    await expect(wizard.locator('.merge-s4-skip-t')).toHaveText('Relationship conflicts resolved');
    await expect(wizard.locator('.merge-s4.is-skipped')).not.toContainText('There are no relationship conflicts');

    // Undo brings her back as new and the conflicts with her.
    await joined.locator('.merge-s4-unsame').click();
    await expect(third).toHaveCount(1);
    await expect(partner).toHaveCount(1);
    await expect(mergeCount(wizard, 'joined')).toHaveText('7');
    await expect(mergeCount(wizard, 'added')).toHaveText('4');
    await partner.locator('.merge-s4-same').click();
    await expect(third).toHaveCount(0);
    await expect(mergeCount(wizard, 'joined')).toHaveText('8');

    // Step 2 shows her joined, with the reason from step 4.
    await wizard.locator('#merge-progress [data-step="2"]').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    const wife = await mergePair(wizard, 'Šeříková');
    await expect(wife).toHaveAttribute('data-fate', 'joined');
    await expect(wizard.locator('#merge-pair .merge-why')).toContainText('same person, chosen in step 4');

    await mergeWriteAndSwitch(page, wizard);
    const data = await page.evaluate(() => window.Strom.DataManager.getData()) as {
        persons: Record<string, { firstName: string; lastName: string; parentIds: string[]; partnerships: string[] }>;
    };
    const persons = Object.values(data.persons);
    const kids = persons.filter(p => ['Karel', 'Věra', 'Josef', 'Ludmila', 'František', 'Božena'].includes(p.firstName));
    expect(kids).toHaveLength(6);
    for (const k of kids) expect(k.parentIds).toHaveLength(2);
    const husband = persons.find(p => p.firstName === 'Ondřej')!;
    expect(husband.partnerships).toHaveLength(1);
    // Nobody under her birth surname: the tree's eight and his parents and sister.
    expect(persons.filter(p => p.lastName === 'Šeříková')).toHaveLength(0);
    expect(persons).toHaveLength(11);
});
