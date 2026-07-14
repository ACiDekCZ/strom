import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

async function createTree(page: Page, name: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const dialog = page.locator('#new-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#new-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
}

test('trees: create a new tree, switch between trees', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const original = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';

    await createTree(page, 'Branch B');
    // Creating a tree opens the tree manager and switches to the new (empty) tree.
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Branch B');

    // Switch back to the original tree via the switcher.
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: original }).first().click();
    await expect(card(page, 'Jan')).toBeVisible();
});

test('trees: rename and delete a tree from the tree manager', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await createTree(page, 'Temp');
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    await expect(manager.locator('.tree-manager-item-name', { hasText: 'Temp' })).toBeVisible();

    const tempId = await page.evaluate(
        () => window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Temp')?.id
    );

    // Rename Temp -> Temp Renamed via the rename dialog.
    await page.evaluate((id) => window.Strom.UI.showRenameTreeDialog(id, 'tree-manager-modal'), tempId);
    const renameDialog = page.locator('#rename-tree-modal');
    await expect(renameDialog).toBeVisible();
    await renameDialog.locator('#rename-tree-name').fill('Temp Renamed');
    await renameDialog.getByRole('button', { name: 'Save' }).click();
    await expect(renameDialog).toBeHidden();
    await expect(manager.locator('.tree-manager-item-name', { hasText: 'Temp Renamed' })).toBeVisible();

    // Delete it via the confirmation dialog (fire-and-forget: it awaits the
    // dialog result, which only resolves once we click OK below).
    await page.evaluate((id) => { void window.Strom.UI.confirmDeleteTree(id); }, tempId);
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect(confirm).toBeHidden();

    // Deletion is async; the manager list updates once it completes.
    await expect(manager.locator('.tree-manager-item-name', { hasText: 'Temp Renamed' })).toHaveCount(0);
});

test('tree manager: row menu groups actions; Open switches to the tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const original = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';

    // Creating a tree opens the manager and switches to the new tree.
    await createTree(page, 'Branch C');
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();

    // The active tree is badged and listed first.
    const firstRow = manager.locator('.tree-manager-item').first();
    await expect(firstRow).toHaveClass(/active/);
    await expect(firstRow.locator('.tree-badge.active-badge')).toBeVisible();

    // The original tree's row: actions live in the ⋯ menu.
    const otherRow = manager.locator('.tree-manager-item', { hasText: original });
    await otherRow.locator('.tree-row-menu-btn').click();
    const menu = otherRow.locator('.tree-row-menu');
    await expect(menu).toHaveClass(/open/);
    await menu.locator('.tree-row-menu-item', { hasText: 'Rename' }).click();
    const renameDialog = page.locator('#rename-tree-modal');
    await expect(renameDialog).toBeVisible();
    await renameDialog.getByRole('button', { name: 'Cancel' }).click();

    // Reopen the manager (rename dialog closed it via the dialog stack) and
    // switch to the original tree with the row's Open button.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await manager.locator('.tree-manager-item', { hasText: original })
        .locator('.tree-open-btn').click();
    await expect(manager).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(original);
    await expect(card(page, 'Jan')).toBeVisible();
});

test('tree validation flags date inconsistencies with details', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Corrupt the data on purpose: death before birth + a citation to a
    // source that does not exist.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons()[0];
        // Orphan citation as a broken import would leave it (the app's own
        // source removal cleans citations, so plant it directly)...
        (p as { sourceIds?: string[] }).sourceIds = ['ghost-source'];
        // ...and persist it by updating the person.
        dm.updatePerson(p.id, { birthDate: '1950', deathDate: '1940' });
    });

    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);

    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.validation-issue.error', { hasText: 'Death date is before birth' })).toBeVisible();
    await expect(modal.locator('.validation-issue-detail').first()).toContainText('1940');
    await expect(modal.locator('.validation-issue', { hasText: 'missing source' })).toBeVisible();
});
