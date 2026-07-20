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


test('a hidden tree\u2019s row menu is not see-through', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const original = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';
    await createTree(page, 'Branch H');   // creates + switches, manager open
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();

    // Hide the original tree, then open ITS row menu: the dimmed row must not
    // dim the menu (opacity composites over the whole subtree \u2014 the row
    // undims while its menu is open).
    const row = manager.locator('.tree-manager-item', { hasText: original }).first();
    await row.locator('.tree-row-menu-btn').click();
    await row.locator('.tree-row-menu-item', { hasText: 'Hide' }).click();
    await expect(row).toHaveClass(/hidden-tree/);

    // The manager list re-renders asynchronously (per-row stats); a late
    // re-render can swap the DOM and close the menu between our click and the
    // style read. Poll: re-open if needed, then require the undimmed row.
    await expect.poll(async () => {
        const open = await row.locator('.tree-row-menu')
            .evaluate(el => el.classList.contains('open')).catch(() => false);
        if (!open) await row.locator('.tree-row-menu-btn').click();
        return row.evaluate(el => getComputedStyle(el).opacity);
    }).toBe('1');
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

    // The open menu must be a solid overlay (the modal must not show through
    // it) in BOTH themes. getComputedStyle reports the declared colour, so we
    // assert a non-transparent background-color.
    const lightBg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(lightBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(lightBg).not.toBe('transparent');
    expect(lightBg).toBe('rgb(255, 253, 248)');

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const darkBg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBg).not.toBe('transparent');
    expect(darkBg).toBe('rgb(44, 42, 36)');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

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

test('a clean tree shows the passed badge as an SVG check, never an emoji', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // A lone, dateless, source-free person raises no issues.
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);

    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();

    // Passed state: the badge is a green circle with an inline SVG check —
    // monochrome, obeys the theme, and carries NO emoji/glyph text.
    const icon = modal.locator('.validation-passed-icon');
    await expect(icon).toBeVisible();
    await expect(icon.locator('svg')).toBeVisible();
    expect((await icon.innerText()).trim()).toBe('');
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

test('actions menu: current-view actions (poster, export selection) live in the ⋯ menu', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // The tree switcher is trees only now — no action items, just Manage trees.
    await page.locator('.tree-switcher-btn').click();
    const switcher = page.locator('#tree-switcher-dropdown');
    await expect(switcher).toHaveClass(/active/);
    await expect(switcher.locator('.tree-switcher-action', { hasText: 'Poster' })).toHaveCount(0);
    await expect(switcher.locator('.tree-switcher-action', { hasText: 'Export this view' })).toHaveCount(0);
    await expect(switcher.locator('.tree-switcher-action', { hasText: 'Make a tree from this view' })).toHaveCount(0);
    await expect(switcher.locator('.tree-switcher-action', { hasText: 'Manage Trees' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Actions live in the desktop ⋯ menu, grouped under section headers.
    await page.locator('.actions-menu-btn').click();
    const dropdown = page.locator('#actions-menu-dropdown');
    await expect(dropdown).toHaveClass(/active/);
    await expect(dropdown.locator('.menu-section-header', { hasText: 'Current view' })).toBeVisible();
    // The old "Tree" section is gone — its actions live behind the "Tree:" row.
    await expect(page.locator('#actions-tree-row')).toBeVisible();
    await expect(dropdown.locator('.tree-switcher-action', { hasText: 'Make a tree' })).toBeVisible();
    await expect(dropdown.locator('.tree-switcher-action', { hasText: 'Poster' })).toBeVisible();
    // Current-view "Export" (a direct child of the dropdown, not the submenu one).
    await expect(page.locator('#actions-menu-dropdown > .tree-switcher-action', { hasText: 'Export' })).toBeVisible();

    // Poster… opens the view-aware poster dialog with its "prints the current view" label.
    await dropdown.locator('.tree-switcher-action', { hasText: 'Poster' }).click();
    await expect(dropdown).not.toHaveClass(/active/);   // item click closes the menu
    await expect(page.locator('#poster-modal')).toBeVisible();
    await expect(page.locator('#poster-view-label')).not.toBeEmpty();
    await page.evaluate(() => window.Strom.UI.closePosterDialog());
    await expect(page.locator('#poster-modal')).toBeHidden();
});

test('actions menu: closes on outside click and on Escape', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const dropdown = page.locator('#actions-menu-dropdown');

    // Outside click closes it.
    await page.locator('.actions-menu-btn').click();
    await expect(dropdown).toHaveClass(/active/);
    await page.locator('#tree-container').click({ position: { x: 5, y: 5 } });
    await expect(dropdown).not.toHaveClass(/active/);

    // Escape closes it.
    await page.locator('.actions-menu-btn').click();
    await expect(dropdown).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(dropdown).not.toHaveClass(/active/);
});

test('export dialog: view-scoped tiles are gated to the active tree; title names the target', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // The tree holding Jan becomes non-active once we make another one.
    const firstTreeName = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';

    await createTree(page, 'Archived');   // creates + switches to the new empty tree
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());

    const modal = page.locator('#export-modal');
    const treeName = modal.locator('#export-modal-tree-name');
    const poster = modal.locator('.menu-option', { hasText: 'Poster' });
    const exportView = modal.locator('#export-focus-btn');
    const makeTree = modal.locator('#make-tree-from-view-btn');

    // Opened for the ACTIVE tree: the view-scoped actions are offered.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await expect(modal).toBeVisible();
    await expect(treeName).toHaveText(': Archived');
    await expect(poster).toBeVisible();
    await expect(exportView).toBeVisible();
    await expect(makeTree).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closeExportDialog());
    await expect(modal).toBeHidden();

    // Opened for a NON-ACTIVE tree: only whole-tree actions; the title names it.
    const otherId = await page.evaluate(
        (name) => window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === name)?.id,
        firstTreeName
    );
    await page.evaluate((id) => window.Strom.UI.showExportDialog(id), otherId);
    await expect(modal).toBeVisible();
    await expect(treeName).toHaveText(`: ${firstTreeName}`);
    await expect(poster).toBeHidden();
    await expect(exportView).toBeHidden();
    await expect(makeTree).toBeHidden();
    await page.evaluate(() => window.Strom.UI.closeExportDialog());
});

test('actions menu: Export (current view) opens the export/privacy dialog for the current view', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.actions-menu-btn').click();
    // The current-view "Export" is a direct child of the dropdown (the submenu's
    // whole-tree "Export" is nested inside the "Tree:" flyout).
    await page.locator('#actions-menu-dropdown > .tree-switcher-action', { hasText: 'Export' }).click();

    // No silent export with defaults: the privacy/password dialog opens focused
    // on the current view, offering the same options as the export dialog path.
    await expect(page.locator('#export-password-modal')).toBeVisible();
    await expect(page.locator('#export-privacy-mode')).toBeVisible();
});
