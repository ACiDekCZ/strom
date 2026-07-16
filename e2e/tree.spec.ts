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

test('hiding the active tree switches to a visible one; the last visible cannot be hidden', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const original = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';
    await createTree(page, 'Branch D');   // creates + switches, manager open
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();

    // Hide the ACTIVE tree (Branch D): the app must switch to the other one.
    const activeRow = manager.locator('.tree-manager-item', { hasText: 'Branch D' });
    await activeRow.locator('.tree-row-menu-btn').click();
    await activeRow.locator('.tree-row-menu-item', { hasText: 'Hide' }).click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(original);

    // Now the original is the only visible tree — hiding it must be refused.
    const lastRow = manager.locator('.tree-manager-item', { hasText: original });
    await lastRow.locator('.tree-row-menu-btn').click();
    await lastRow.locator('.tree-row-menu-item', { hasText: 'Hide' }).click();
    await expect(page.locator('.toast')).toContainText('cannot be hidden');
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(original);
});

test('tree manager: Close button closes; the active tree has Open too', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await createTree(page, 'Branch E');   // creates + switches, manager open
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();

    // Every row offers Open — the active one included: it also just shows the
    // tree (a missing button on the active row read as an inconsistency).
    const activeRow = manager.locator('.tree-manager-item.active');
    await expect(activeRow).toContainText('Branch E');
    await activeRow.locator('.tree-open-btn').click();
    await expect(manager).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Branch E');

    // The footer has an explicit Close.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await expect(manager).toBeVisible();
    await manager.locator('.tree-manager-close').click();
    await expect(manager).toBeHidden();
});

test('cancelling the file picker returns to the New Tree menu, not to nowhere', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.locator('.tree-manager-footer .primary').click();   // New Tree
    const menu = page.locator('#new-tree-menu-modal');
    await expect(menu).toBeVisible();

    // "From GEDCOM" closes the dialogs and opens the OS picker. Headless
    // Chromium may auto-dismiss the chooser (firing `cancel` itself); the
    // explicit dispatch covers the environments that do not — the handler is
    // a no-op when the cancel was already handled.
    await menu.locator('.menu-option', { hasText: 'GEDCOM' }).click();
    await page.dispatchEvent('#gedcom-input', 'cancel');

    // Back where the click came from; Escape walks back to the manager.
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator('#tree-manager-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tree-manager-modal')).toBeHidden();
});

test('tree switcher: current-view actions (poster, export selection) are in the dropdown', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.tree-switcher-btn').click();
    const dropdown = page.locator('#tree-switcher-dropdown');
    await expect(dropdown).toHaveClass(/active/);

    // The current-view action group is present, in order.
    await expect(dropdown.locator('.tree-switcher-action', { hasText: 'Make a tree from this view' })).toBeVisible();
    await expect(dropdown.locator('.tree-switcher-action', { hasText: 'Poster' })).toBeVisible();
    await expect(dropdown.locator('.tree-switcher-action', { hasText: 'Export this view' })).toBeVisible();

    // Poster… opens the view-aware poster dialog with its "prints the current view" label.
    await dropdown.locator('.tree-switcher-action', { hasText: 'Poster' }).click();
    await expect(page.locator('#poster-modal')).toBeVisible();
    await expect(page.locator('#poster-view-label')).not.toBeEmpty();
    await page.evaluate(() => window.Strom.UI.closePosterDialog());
    await expect(page.locator('#poster-modal')).toBeHidden();
});

test('tree switcher: Export this view opens the export/privacy dialog for the current view', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.tree-switcher-btn').click();
    const dropdown = page.locator('#tree-switcher-dropdown');
    await dropdown.locator('.tree-switcher-action', { hasText: 'Export this view' }).click();

    // No silent export with defaults: the privacy/password dialog opens focused
    // on the current view, offering the same options as the export dialog path.
    await expect(page.locator('#export-password-modal')).toBeVisible();
    await expect(page.locator('#export-privacy-mode')).toBeVisible();
});
