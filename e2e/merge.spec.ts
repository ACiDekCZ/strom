import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, addRelation } from './helpers.js';

function personCount(page: Page): Promise<number> {
    return page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
}

test('merging two persons collapses them into one and undo restores both', async ({ page }) => {
    await openApp(page);
    // Jan with two children (both visible under the focus) plus a partner.
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await cardAction(page, 'Jan', 'focus');
    await addRelation(page, 'Jan', 'child', 'Pavel', 'Novak');
    await cardAction(page, 'Jan', 'focus');
    expect(await personCount(page)).toBe(4);

    // Merge Pavel INTO Petr (keep = Petr, whose modal is open).
    await cardAction(page, 'Petr', 'edit');
    await page.locator('#person-modal #btn-merge').click();
    const mergeModal = page.locator('#person-merge-modal');
    await expect(mergeModal).toBeVisible();
    await mergeModal.locator('#person-merge-picker .person-picker-input').fill('Pavel');
    await mergeModal.locator('#person-merge-picker .person-picker-item', { hasText: 'Pavel' }).first().click();
    const confirmBtn = mergeModal.locator('#person-merge-btn');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(mergeModal).toBeHidden();
    // The underlying edit modal closes together with the merge dialog.
    await expect(page.locator('#person-modal')).toBeHidden();

    // Pavel is gone; Petr (and the rest of the family) remain.
    expect(await personCount(page)).toBe(3);
    await cardAction(page, 'Jan', 'focus');
    await expect(card(page, 'Pavel')).toBeHidden();
    await expect(card(page, 'Petr')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();

    // Undo restores the pre-merge state.
    await page.locator('#tree-container').click();
    await page.keyboard.press('Control+z');
    expect(await personCount(page)).toBe(4);
    await cardAction(page, 'Jan', 'focus');
    await expect(card(page, 'Pavel')).toBeVisible();
});

test('tree merge wizard matches a shared person and merges without duplicates', async ({ page }) => {
    await openApp(page);
    // Two trees that share "Jan Merge" (1940).
    await createFirstPerson(page, 'Seed', 'Person'); // tree A gets a real name to keep
    await page.locator('#file-input').setInputFiles('e2e/fixtures/merge-a.json');
    let importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill('Tree A');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await page.locator('#file-input').setInputFiles('e2e/fixtures/merge-b.json');
    importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill('Tree B');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    // Active tree is now Tree B. Merge Tree A into it.
    const treeAId = await page.evaluate(
        () => window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Tree A')?.id
    );
    await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), treeAId);
    const pick = page.locator('#merge-trees-modal');
    await expect(pick).toBeVisible();
    // Choose Tree B as the merge target.
    const treeBId = await page.evaluate(
        () => window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Tree B')?.id
    );
    await page.evaluate((id) => window.Strom.UI.selectMergeTarget(id), treeBId);
    await pick.locator('#merge-trees-btn').click();

    // The merge wizard opens, detects the shared person as a match, and shows it
    // in the review list. (Executing the merge through the multi-step wizard is
    // not driven here — see e2e/COVERAGE.md, tree-merge = partial.)
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-stat-matches')).not.toHaveText('0');
    await expect(wizard.locator('#merge-match-list .merge-item').first()).toBeVisible();
    await expect(wizard.locator('#merge-match-list')).toContainText('Jan');

    // Exactly ONE wizard step reads as current.
    await expect(wizard.locator('.merge-step.active')).toHaveCount(1);
    await expect(wizard.locator('.merge-step.active')).toHaveText(/Review matches/);
});
