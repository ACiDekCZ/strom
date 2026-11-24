import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCreateNewTree, mergeDecide, mergeDone, mergeTreeInto, mergeWrite } from './helpers.js';

/**
 * The same file merged again (spec 134 §13 13c, K1.5, K0.7): the second
 * merge of rodokmen-jilmovi.ged into Modřínovi says in step 1 when the file
 * was merged, how many of its people are new and how many are joined with
 * that merge; the second write brings in only the one left out the first
 * time and duplicates nobody. The tree Modřínovi (e2e/fixtures/modrinovi.json)
 * and the file (Kvido as in the tree, Amos, Elvíra and Kasián Jilm) are invented.
 */

const FIRST = new Date(2026, 10, 22, 15, 41);

/** The open tree's people (first and last names), placeholders aside. */
const openPeople = (page: Page): Promise<string[]> => page.evaluate(() =>
    Object.values(window.Strom.DataManager.getData().persons).filter((p: any) => !p.isPlaceholder)
        .map((p: any) => `${p.firstName} ${p.lastName}`).sort());

async function pickFile(page: Page): Promise<Locator> {
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/rodokmen-jilmovi.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    return wizard;
}

test('the same file merged again: step 1 says it was merged, 1 new and 3 joined; the write adds Kasián once and nobody twice', async ({ page }) => {
    await page.clock.setFixedTime(FIRST);
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');

    // The first merge: Kasián left out.
    let wizard = await pickFile(page);
    await expect(wizard.locator('.merge-s1-note')).toHaveCount(0);
    await mergeCompare(wizard);
    await mergeDecide(wizard, 'Kasián', 'skip');
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);
    const once = await openPeople(page);
    expect(once).toContain('Amos Jilm');
    expect(once).not.toContain('Kasián Jilm');

    // The same file again, an hour later.
    await page.clock.setFixedTime(new Date(2026, 10, 22, 16, 41));
    wizard = await pickFile(page);
    await expect(wizard.locator('.merge-s1-note')).toHaveText(
        'This file was already merged (today 3:41 PM). Only 1 person is new; 3 are joined with that earlier merge and will not be duplicated.');
    await mergeCompare(wizard);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);
    const twice = await openPeople(page);
    expect(twice).toEqual([...once, 'Kasián Jilm'].sort());
    expect(await page.evaluate(() => window.Strom.DataManager.getData().merges?.length)).toBe(2);
});

test('the file once more with nobody new: the sentence says 0 new, the comparison finds a copy and nothing is written', async ({ page }) => {
    await page.clock.setFixedTime(FIRST);
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    let wizard = await pickFile(page);
    await mergeCompare(wizard);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);
    const once = await openPeople(page);

    wizard = await pickFile(page);
    await expect(wizard.locator('.merge-s1-note')).toContainText('Only 0 people are new; 4 are joined');
    await mergeCompare(wizard);
    await expect(wizard.locator('.merge-s2-copy, .merge-s2-show-copy').first()).toBeVisible();
    await expect(wizard).toContainText('All 4 people are already in the tree Modřínovi and bring nothing new.');
    expect(await openPeople(page)).toEqual(once);
});

test('the same tree merged again: step 1 names the tree and its merge, 0 new and 4 joined (134 N1, part C 6)', async ({ page }) => {
    await page.clock.setFixedTime(FIRST);
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await mergeCreateNewTree(page, await pickFile(page), 'Jilmovi');
    const ids = await page.evaluate(() => Object.fromEntries(window.Strom.TreeManager.getTrees().map((t: { id: string; name: string }) => [t.name, t.id])));

    let wizard = await mergeTreeInto(page, ids['Jilmovi'], ids['Modřínovi']);
    await expect(wizard.locator('.merge-s1-note')).toHaveCount(0);
    await mergeCompare(wizard);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);

    await page.clock.setFixedTime(new Date(2026, 10, 22, 16, 41));
    wizard = await mergeTreeInto(page, ids['Jilmovi'], ids['Modřínovi']);
    await expect(wizard.locator('.merge-s1-note')).toHaveText(
        'The tree Jilmovi was already merged into this one (today 3:41 PM). Only 0 people are new; 4 are joined with that earlier merge and will not be duplicated.');
});
