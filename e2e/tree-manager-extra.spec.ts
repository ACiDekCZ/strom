import { test, expect, Page, Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'url';
import { openApp, createFirstPerson, card, addRelation, fillPerson, waitForPersist, focusViaSearch } from './helpers.js';

/**
 * Tree manager flows beyond create / rename / delete: duplicating a tree (an
 * independent copy), the tree's start person, a tree from the current view,
 * the "Tree:" submenu acting on the active tree, switching trees inside an
 * "Export all" HTML file, validation links into another tree, and the backups
 * dialog's download / keep-on-turning-off paths.
 */

const manager = (page: Page): Locator => page.locator('#tree-manager-modal');

/** A tree-manager row by its exact tree name. */
function row(page: Page, treeName: string): Locator {
    const exact = new RegExp(`^${treeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    return manager(page).locator('.tree-manager-item')
        .filter({ has: page.locator('.tree-manager-item-name', { hasText: exact }) });
}

/** Open the manager (if needed) and click an item of a row's ⋯ menu. */
async function rowAction(page: Page, treeName: string, item: string): Promise<void> {
    if (!await manager(page).isVisible()) await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const r = row(page, treeName);
    await r.locator('.tree-row-menu-btn').click();
    await r.locator('.tree-row-menu.open .tree-row-menu-item', { hasText: item }).click();
}

/** ⋯ → Tree: → item. */
async function treeSubmenu(page: Page, item: string): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-tree-row').hover();
    await page.locator('#actions-tree-submenu .tree-switcher-action', { hasText: item }).click();
}

function activeTreeName(page: Page): Promise<string> {
    return page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata().name);
}

/** Stored trees by name → sorted first names (read back from storage). */
function storedTrees(page: Page): Promise<Record<string, string[]>> {
    return page.evaluate(async () => {
        const out: Record<string, string[]> = {};
        for (const t of window.Strom.TreeManager.getTrees()) {
            const data = await window.Strom.TreeManager.getTreeData(t.id);
            out[t.name] = (Object.values(data?.persons ?? {}) as Array<{ firstName: string; isPlaceholder?: boolean }>)
                .filter(p => !p.isPlaceholder).map(p => p.firstName).sort();
        }
        return out;
    });
}

/** Create a second, empty tree via the new-tree dialog (switches to it, closes the manager). */
async function createTree(page: Page, name: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const dialog = page.locator('#new-tree-modal');
    await dialog.locator('#new-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(name);
}

/** Jan + Marie with their son Petr. */
async function family(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await waitForPersist(page, 'Petr');
}

// ---------------------------------------------------------------- duplicate

test('Duplicate in a tree row makes an independent copy: editing it leaves the original alone', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await family(page);
    const original = await activeTreeName(page);

    await rowAction(page, original, 'Duplicate');
    const dialog = page.locator('#duplicate-tree-modal');
    await expect(dialog).toBeVisible();
    await expect(manager(page)).toBeHidden();
    await expect(dialog.locator('#duplicate-tree-name')).toHaveValue(`${original} (copy)`);
    await dialog.locator('#duplicate-tree-name').fill('Novak copy');
    await dialog.getByRole('button', { name: 'Duplicate' }).click();
    await expect(dialog).toBeHidden();

    // Back in the manager with both trees; the original is still the active one.
    await expect(manager(page)).toBeVisible();
    await expect(row(page, 'Novak copy')).toHaveCount(1);
    await expect(row(page, original)).toHaveClass(/active/);
    expect(await storedTrees(page)).toEqual({ [original]: ['Jan', 'Marie', 'Petr'], 'Novak copy': ['Jan', 'Marie', 'Petr'] });

    // Open the copy and edit it: a new child, and Jan renamed.
    await row(page, 'Novak copy').locator('.tree-open-btn').click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Novak copy');
    await addRelation(page, 'Jan', 'child', 'Anna', 'Novak', 'female');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan');
        dm.updatePerson(jan.id, { firstName: 'Johann' });
    });
    await waitForPersist(page, 'Johann');

    // After a reload, only the copy carries the edits.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    expect(await storedTrees(page)).toEqual({
        [original]: ['Jan', 'Marie', 'Petr'],
        'Novak copy': ['Anna', 'Johann', 'Marie', 'Petr'],
    });
});

test('duplicate dialog: Cancel and an empty name create nothing; Escape returns to the manager', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const original = await activeTreeName(page);
    const treeCount = () => page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    const dialog = page.locator('#duplicate-tree-modal');

    await rowAction(page, original, 'Duplicate');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(manager(page)).toBeVisible();
    expect(await treeCount()).toBe(1);

    // An empty name is refused: the dialog stays, the field keeps the focus.
    await rowAction(page, original, 'Duplicate');
    await dialog.locator('#duplicate-tree-name').fill('   ');
    await dialog.getByRole('button', { name: 'Duplicate' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#duplicate-tree-name')).toBeFocused();
    expect(await treeCount()).toBe(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(manager(page)).toBeVisible();
    expect(await treeCount()).toBe(1);
});

// ---------------------------------------------------------------- Tree: submenu

test('⋯ → Tree: Duplicate / Rename / Tree health / Merge into / Hide act on the active tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
    await createTree(page, 'Second');
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await waitForPersist(page, 'Karel');

    // Duplicate: prefilled with the ACTIVE tree's name; Enter confirms.
    await treeSubmenu(page, 'Duplicate');
    const dup = page.locator('#duplicate-tree-modal');
    await expect(dup.locator('#duplicate-tree-name')).toHaveValue('Second (copy)');
    await dup.locator('#duplicate-tree-name').press('Enter');
    await expect(dup).toBeHidden();
    await expect(row(page, 'Second (copy)')).toHaveCount(1);
    expect((await storedTrees(page))['Second (copy)']).toEqual(['Karel']);
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());

    // Rename the active tree; the switcher follows.
    await treeSubmenu(page, 'Rename');
    const rename = page.locator('#rename-tree-modal');
    await expect(rename.locator('#rename-tree-name')).toHaveValue('Second');
    await rename.locator('#rename-tree-name').fill('Dvorak');
    await rename.locator('#rename-tree-name').press('Enter');
    await expect(rename).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Dvorak');

    // Tree health opens for the active tree.
    await treeSubmenu(page, 'Tree health');
    const health = page.locator('#tree-health-modal');
    await expect(health).toHaveClass(/active/);
    await expect(health.locator('#tree-health-title')).toContainText('Dvorak');
    await page.evaluate(() => window.Strom.UI.closeTreeHealthDialog());

    // Merge into another tree: the active tree is the source, the others are targets.
    await treeSubmenu(page, 'Merge into another tree');
    const mergeDialog = page.locator('#merge-trees-modal');
    await expect(mergeDialog).toBeVisible();
    await expect(mergeDialog.locator('#merge-trees-options')).toContainText('Second (copy)');
    await expect(mergeDialog.locator('#merge-trees-options')).not.toContainText('Dvorak');
    await page.keyboard.press('Escape');
    await expect(mergeDialog).toBeHidden();

    // Hide the active tree: the app switches to a visible one, the switcher no longer lists it.
    await treeSubmenu(page, 'Hide');
    await expect(page.locator('.tree-switcher-btn .tree-name')).not.toHaveText('Dvorak');
    const hidden = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .filter((t: { isHidden?: boolean }) => t.isHidden).map((t: { name: string }) => t.name));
    expect(hidden).toEqual(['Dvorak']);
    await page.locator('.tree-switcher-btn').click();
    await expect(page.locator('#tree-switcher-dropdown .tree-switcher-item', { hasText: 'Dvorak' })).toHaveCount(0);
});

// ---------------------------------------------------------------- default person

/** Wait until the stored trees no longer contain `needle` (counterpart of waitForPersist). */
async function waitForPersistGone(page: Page, needle: string): Promise<void> {
    await page.waitForFunction((n) => new Promise<boolean>((resolve) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const all = req.result.transaction('trees', 'readonly').objectStore('trees').getAll();
            all.onsuccess = () => resolve(!JSON.stringify(all.result).includes(n));
            all.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
    }), needle);
}

test('a specific default person is the focus after a reload; "First person" goes back to the first', async ({ page }) => {
    await openApp(page);
    await family(page);
    const tree = await activeTreeName(page);
    const dialog = page.locator('#default-person-modal');

    // Default: "First person" (named) is selected, the picker hidden.
    await rowAction(page, tree, 'Default person');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#default-person-first')).toBeChecked();
    await expect(dialog.locator('#default-person-first-label')).toHaveText('First person (Jan Novak)');
    await expect(dialog.locator('#default-person-picker-container')).toBeHidden();

    // A specific person, picked in the picker.
    await dialog.locator('#default-person-specific').check();
    await expect(dialog.locator('#default-person-picker-container')).toBeVisible();
    await dialog.locator('#default-person-picker .person-picker-input').fill('Marie');
    await dialog.locator('#default-person-picker .person-picker-item', { hasText: 'Marie' }).first().click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    // Back in the manager; the row names the start person.
    await expect(manager(page)).toBeVisible();
    await expect(row(page, tree).locator('.tree-manager-item-stats-row')).toContainText('Marie Novak');
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());

    // Focus someone else, reload: Marie is the focus.
    await focusViaSearch(page, 'Petr');
    await waitForPersist(page, '"defaultPersonId"');
    await page.reload();
    await expect(card(page, 'Marie')).toHaveClass(/focused/);

    // The dialog reopens with Marie preselected; back to "First person".
    await rowAction(page, tree, 'Default person');
    await expect(dialog.locator('#default-person-specific')).toBeChecked();
    await expect(dialog.locator('#default-person-picker-container')).toBeVisible();
    await dialog.locator('#default-person-first').check();
    await expect(dialog.locator('#default-person-picker-container')).toBeHidden();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, tree).locator('.tree-manager-item-stats-row')).not.toContainText('Marie');
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());
    await waitForPersistGone(page, '"defaultPersonId"');
    await page.reload();
    await expect(card(page, 'Jan')).toHaveClass(/focused/);
});

test('"Last focused" as the default person restores the last focused person after a reload', async ({ page }) => {
    await openApp(page);
    await family(page);
    const tree = await activeTreeName(page);
    const dialog = page.locator('#default-person-modal');

    await rowAction(page, tree, 'Default person');
    await dialog.locator('#default-person-last').check();
    await expect(dialog.locator('#default-person-picker-container')).toBeHidden();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, tree).locator('.tree-manager-item-stats-row')).toContainText('Last focused');
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog());

    await focusViaSearch(page, 'Petr');
    const petrId = await page.evaluate(() => window.Strom.DataManager.getAllPersons()
        .find((p: { firstName: string }) => p.firstName === 'Petr').id);
    await waitForPersist(page, '"defaultPersonId":"__last_focused__"');
    await waitForPersist(page, `"lastFocusPersonId":"${petrId}"`);
    await page.reload();
    await expect(card(page, 'Petr')).toHaveClass(/focused/);

    // The dialog remembers the choice.
    await rowAction(page, tree, 'Default person');
    await expect(dialog.locator('#default-person-last')).toBeChecked();
});

test('a default person set for another tree is the focus when switching to it', async ({ page }) => {
    await openApp(page);
    await family(page);
    const first = await activeTreeName(page);
    await createTree(page, 'Second');

    // Set the first (non-active) tree's start person from its row.
    await rowAction(page, first, 'Default person');
    const dialog = page.locator('#default-person-modal');
    await expect(dialog.locator('#default-person-first-label')).toHaveText('First person (Jan Novak)');
    await dialog.locator('#default-person-specific').check();
    await dialog.locator('#default-person-picker .person-picker-input').fill('Petr');
    await dialog.locator('#default-person-picker .person-picker-item', { hasText: 'Petr' }).first().click();
    await expect(dialog.locator('#default-person-specific')).toBeChecked();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    // The active tree is untouched.
    expect(await page.evaluate(() => window.Strom.DataManager.getData().defaultPersonId)).toBeUndefined();

    await row(page, first).locator('.tree-open-btn').click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(first);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);
});

// ---------------------------------------------------------------- tree from the view

test('New tree → "From current view" makes a tree of exactly the persons on screen', async ({ page }) => {
    await openApp(page);
    await family(page);
    // A stray person not connected to the family stays out of the view.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Karel', 'Dvorak');
    await focusViaSearch(page, 'Jan');
    await expect(card(page, 'Karel')).toHaveCount(0);
    const original = await activeTreeName(page);

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await manager(page).locator('.tree-manager-footer .primary').click();
    const menu = page.locator('#new-tree-menu-modal');
    await expect(menu).toBeVisible();
    await menu.locator('.menu-option', { hasText: 'From current view' }).click();
    await expect(menu).toBeHidden();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill('Jan family');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Jan family');
    await expect(card(page, 'Jan')).toBeVisible();
    const trees = await storedTrees(page);
    expect(trees['Jan family']).toEqual(['Jan', 'Marie', 'Petr']);
    expect(trees[original]).toEqual(['Jan', 'Karel', 'Marie', 'Petr']);
});

test('"From current view" on an empty tree warns and creates nothing', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await manager(page).locator('.tree-manager-footer .primary').click();
    await page.locator('#new-tree-menu-modal .menu-option', { hasText: 'From current view' }).click();
    await expect(page.locator('#confirmation-modal')).toBeVisible();
    await expect(page.locator('#confirm-message')).toHaveText('No focused data to create tree from');
    await expect(page.locator('#import-tree-modal')).toBeHidden();
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(1);
});

// ---------------------------------------------------------------- embedded trees

test('an "Export all" HTML file switches between its trees in the tree switcher', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
    const first = await activeTreeName(page);
    await createTree(page, 'Second');
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await waitForPersist(page, 'Karel');
    expect(await storedTrees(page)).toEqual({ [first]: ['Jan'], Second: ['Karel'] });

    await page.evaluate(() => window.Strom.UI.showExportAllDialog());
    await page.locator('#export-all-modal .menu-option', { hasText: 'Export as app' }).click();
    const pwd = page.locator('#export-password-modal');
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    const file = testInfo.outputPath('all-trees.html');
    await download.saveAs(file);

    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    // The file opens on the tree that was active at export.
    await expect(page.locator('#current-tree-name')).toHaveText('Second');
    await expect(card(page, 'Karel')).toBeVisible();

    await page.locator('.tree-switcher-btn').click();
    const items = page.locator('#tree-switcher-dropdown .tree-switcher-item');
    await expect(items).toHaveCount(2);
    await expect(items.filter({ hasText: 'Second' })).toHaveClass(/active/);
    await items.filter({ hasText: first }).click();

    await expect(page.locator('#tree-switcher-dropdown')).not.toHaveClass(/active/);
    await expect(page.locator('#current-tree-name')).toHaveText(first);
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Karel')).toHaveCount(0);
    // Still a read-only view: nothing was written into this browser's storage.
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await page.locator('.tree-switcher-btn').click();
    await expect(items.filter({ hasText: first })).toHaveClass(/active/);
});

// ---------------------------------------------------------------- validation

test('validation of another tree: a person link switches to that tree and focuses the person', async ({ page }) => {
    await openApp(page);
    await family(page);
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const petr = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Petr');
        dm.updatePerson(petr.id, { birthDate: '1950', deathDate: '1940' });
    });
    await waitForPersist(page, '1940');
    const first = await activeTreeName(page);
    await createTree(page, 'Second');

    // Row ⋯ → Tree health of the first tree → Validation details.
    await rowAction(page, first, 'Tree health');
    const health = page.locator('#tree-health-modal');
    await expect(health).toHaveClass(/active/);
    await health.locator('.health-action[data-action="validate"]').click();
    const validation = page.locator('#tree-validation-modal');
    await expect(validation).toBeVisible();
    const issue = validation.locator('.validation-issue', { hasText: 'Death date is before birth' });
    await issue.locator('.validation-person-link', { hasText: 'Petr' }).click();

    await expect(validation).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(first);
    await expect(card(page, 'Petr')).toHaveClass(/focused/);
});

test('"Fix all" in the validation dialog repairs every fixable issue of the active tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    // One place written two ways on two people.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const [a, b] = dm.getAllPersons();
        dm.updatePerson(a.id, { birthPlace: 'Děčín' });
        dm.updatePerson(b.id, { birthPlace: 'Decin', deathPlace: 'Děčín' });
    });
    await waitForPersist(page, 'Decin');
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    const fixAll = modal.locator('.validation-fix-all-btn');
    await expect(fixAll).toBeVisible();
    await fixAll.click();

    // The repair is announced and the list re-validates (nothing fixable left).
    await expect(page.locator('#confirmation-modal')).toBeVisible();
    await page.locator('#confirm-ok-btn').click();
    await expect(modal.locator('.validation-fix-all-btn')).toHaveCount(0);
    await expect(modal.locator('.validation-issue', { hasText: 'written several ways' })).toHaveCount(0);
    const places = await page.evaluate(() => window.Strom.DataManager.getAllPersons()
        .flatMap((p: { birthPlace?: string; deathPlace?: string }) => [p.birthPlace, p.deathPlace]).filter(Boolean));
    expect(new Set(places).size).toBe(1);
});

// Regression: Fix in the validation dialog of a NON-active tree repaired the
// ACTIVE tree's data and left the checked tree as it was. A Fix there now
// switches to the checked tree first.
test('Fix in the validation dialog of a non-active tree switches to it and repairs it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const [a, b] = dm.getAllPersons();
        dm.updatePerson(a.id, { birthPlace: 'Děčín' });
        dm.updatePerson(b.id, { birthPlace: 'Decin', deathPlace: 'Děčín' });
    });
    await waitForPersist(page, 'Decin');
    const first = await activeTreeName(page);
    await createTree(page, 'Second');

    await rowAction(page, first, 'Tree health');
    await page.locator('#tree-health-modal .health-action[data-action="validate"]').click();
    const modal = page.locator('#tree-validation-modal');
    const issue = modal.locator('.validation-issue', { hasText: 'written several ways' });
    await issue.locator('.validation-fix-btn').click();

    await expect(modal.locator('.validation-issue', { hasText: 'written several ways' })).toHaveCount(0);
    expect(await activeTreeName(page)).toBe(first);
    await expect.poll(() => page.evaluate(async () => {
        const tm = window.Strom.TreeManager;
        const t = tm.getTrees().find((x: { name: string }) => x.name !== 'Second');
        const data = await tm.getTreeData(t.id);
        const places = (Object.values(data.persons) as Array<{ birthPlace?: string; deathPlace?: string }>)
            .flatMap(p => [p.birthPlace, p.deathPlace]).filter(Boolean);
        return new Set(places).size;
    })).toBe(1);
});

// ---------------------------------------------------------------- backups

test('a backup downloads as JSON named after the tree the dialog shows', async ({ page }, testInfo) => {
    await openApp(page);
    await family(page);
    const first = await activeTreeName(page);
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('manual'); });
    await createTree(page, 'Second');

    // Backups of the NON-active first tree, from its row.
    await rowAction(page, first, 'Backups');
    const modal = page.locator('#snapshots-modal');
    await expect(modal).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        modal.locator('.snapshot-row').first().getByRole('button', { name: 'Download' }).click(),
    ]);
    // "My Family Tree" → my-family-tree-backup-YYYY-MM-DD.json (not the active "Second").
    const slug = first.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${slug}-backup-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const file = testInfo.outputPath('backup.json');
    await download.saveAs(file);
    const data = JSON.parse(await readFile(file, 'utf8'));
    const names = (Object.values(data.persons) as Array<{ firstName: string }>).map(p => p.firstName).sort();
    expect(names).toEqual(['Jan', 'Marie', 'Petr']);
    // Downloading switched nothing.
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Second');
});

test('turning automatic backups off with "Keep backups" keeps the existing backups', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('manual'); });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const modal = page.locator('#snapshots-modal');
    const toggle = modal.locator('#snapshots-auto-toggle');
    await expect(toggle).toBeChecked();
    const before = await modal.locator('.snapshot-row').count();
    expect(before).toBeGreaterThan(0);

    await toggle.uncheck();
    await page.locator('#confirmation-modal').getByRole('button', { name: 'Keep backups' }).click();
    await expect(toggle).not.toBeChecked();
    await expect(modal.locator('.snapshot-row')).toHaveCount(before);
    const id = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    expect(await page.evaluate((i) => window.Strom.TreeManager.isAutoBackupEnabled(i), id)).toBe(false);

    // Turning it back on needs no question.
    await toggle.check();
    await expect(page.locator('#confirmation-modal')).toBeHidden();
    expect(await page.evaluate((i) => window.Strom.TreeManager.isAutoBackupEnabled(i), id)).toBe(true);
});
