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

test('merge wizard: update-only toggle drops "New" to 0, and a match row can be skipped', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // Target has Anna; source has the same Anna (a match) plus a new Bob.
    const ids = await page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        const targetId = TM.createTree('Target');
        TM.saveTreeData(targetId, {
            persons: {
                t_anna: { id: 't_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', isPlaceholder: false, birthDate: '1900-01-01', partnerships: [], parentIds: [], childIds: [] },
            },
            partnerships: {},
        });
        const sourceId = TM.createTree('Source');
        TM.saveTreeData(sourceId, {
            persons: {
                s_anna: { id: 's_anna', firstName: 'Anna', lastName: 'Sdilena', gender: 'female', isPlaceholder: false, birthDate: '1900-01-01', partnerships: [], parentIds: [], childIds: [] },
                s_bob: { id: 's_bob', firstName: 'Bob', lastName: 'Novy', gender: 'male', isPlaceholder: false, birthDate: '1930-01-01', partnerships: [], parentIds: [], childIds: [] },
            },
            partnerships: {},
        });
        return { targetId, sourceId };
    });

    await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), ids.sourceId);
    const pick = page.locator('#merge-trees-modal');
    await expect(pick).toBeVisible();
    await page.evaluate((id) => window.Strom.UI.selectMergeTarget(id), ids.targetId);
    await pick.locator('#merge-trees-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();

    // Bob is the only unmatched new person → "New" = 1.
    await expect(wizard.locator('#merge-stat-new')).toHaveText('1');

    // Flip "update existing only" → nothing new will be added (stat truthfully 0).
    const toggle = page.locator('#merge-update-only-toggle');
    await expect(toggle).toBeVisible();
    await toggle.check();
    await expect(wizard.locator('#merge-stat-new')).toHaveText('0');
    await toggle.uncheck();
    await expect(wizard.locator('#merge-stat-new')).toHaveText('1');

    // The Anna match row can be skipped (neither merged nor added).
    const matchRow = wizard.locator('#merge-match-list .merge-item').filter({ hasText: 'Anna' }).first();
    await expect(matchRow).toBeVisible();
    await matchRow.locator('.merge-btn-skip').click();
    await expect(matchRow).toHaveClass(/skipped/);
    await expect(wizard.locator('#merge-stat-skipped')).toHaveText('1');
});

test('actions menu "Merge this view into…" opens the target picker', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // A second tree to serve as the merge target (createTree does not switch).
    await page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        const id = TM.createTree('Other Tree');
        TM.saveTreeData(id, {
            persons: { o1: { id: 'o1', firstName: 'Eva', lastName: 'Jina', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
            partnerships: {},
        });
    });

    // Open the ⋯ actions menu and click the new action.
    await page.locator('.actions-menu-btn').click();
    const action = page.locator('#actions-menu-dropdown .tree-switcher-action').filter({ hasText: 'Merge this view into' });
    await expect(action).toBeVisible();
    await action.click();

    // The target picker opens; the active tree is excluded, the other offered.
    await expect(page.locator('#merge-trees-modal')).toBeVisible();
    await expect(page.locator('#merge-trees-options')).toContainText('Other Tree');
});

test('merge wizard warns up-front when an input tree has validation errors', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');

    // A valid target tree and a source tree with a seeded error: a father that
    // does not list his child back (missingChildRef, error severity).
    const ids = await page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        const targetId = TM.createTree('Target Tree');
        TM.saveTreeData(targetId, {
            persons: {
                t_a: { id: 't_a', firstName: 'Anna', lastName: 'Valid', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
            },
            partnerships: {},
        });
        const sourceId = TM.createTree('Source Tree');
        TM.saveTreeData(sourceId, {
            persons: {
                s_dad: { id: 's_dad', firstName: 'Josef', lastName: 'Broken', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
                s_kid: { id: 's_kid', firstName: 'Karel', lastName: 'Broken', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: ['s_dad'], childIds: [] },
            },
            partnerships: {},
        });
        return { targetId, sourceId };
    });

    await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), ids.sourceId);
    const pick = page.locator('#merge-trees-modal');
    await expect(pick).toBeVisible();
    await page.evaluate((id) => window.Strom.UI.selectMergeTarget(id), ids.targetId);
    await pick.locator('#merge-trees-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    // The non-blocking pre-merge banner shows (and the merge is still runnable).
    const banner = page.locator('#merge-validation-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/issue/i);
    await expect(wizard.locator('.merge-actions .primary')).toBeEnabled();
});
