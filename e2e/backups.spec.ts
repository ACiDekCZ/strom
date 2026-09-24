import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, waitForPersist } from './helpers';

/**
 * Versioned backups (time capsules): create a manual backup, mutate the tree,
 * then restore the backup and verify the earlier state comes back.
 */
test.describe('Backups', () => {
    test('manual backup survives a delete and restores', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Alpha', 'Root');
        await expect(card(page, 'Alpha')).toBeVisible();
        await waitForPersist(page, 'Alpha');

        // Open the backups dialog for the active tree and create a manual backup.
        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        const modal = page.locator('#snapshots-modal');
        await expect(modal).toBeVisible();
        await modal.getByRole('button', { name: 'Create backup now' }).click();

        // A snapshot row now exists.
        const rows = modal.locator('.snapshot-row');
        await expect(rows).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

        // Delete Alpha — the tree is now empty.
        await cardAction(page, 'Alpha', 'delete');
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toBeVisible();
        await confirm.locator('#confirm-ok-btn').click();
        await expect(card(page, 'Alpha')).toHaveCount(0);

        // Restore the backup: confirm the overwrite, Alpha reappears.
        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        await expect(modal).toBeVisible();
        await modal.locator('.snapshot-row').first().getByRole('button', { name: 'Restore' }).click();
        await expect(confirm).toBeVisible();
        await confirm.locator('#confirm-ok-btn').click();

        await expect(card(page, 'Alpha')).toBeVisible();
    });

    test('restore is undoable', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Beta', 'Root');
        await waitForPersist(page, 'Beta');

        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        const modal = page.locator('#snapshots-modal');
        await modal.getByRole('button', { name: 'Create backup now' }).click();
        await expect(modal.locator('.snapshot-row')).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

        await cardAction(page, 'Beta', 'delete');
        const confirm = page.locator('#confirmation-modal');
        await confirm.locator('#confirm-ok-btn').click();
        await expect(card(page, 'Beta')).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        await modal.locator('.snapshot-row').first().getByRole('button', { name: 'Restore' }).click();
        await confirm.locator('#confirm-ok-btn').click();
        await expect(card(page, 'Beta')).toBeVisible();

        // Ctrl+Z undoes the restore -> back to the empty (deleted) state.
        await page.keyboard.press('Control+z');
        await expect(card(page, 'Beta')).toHaveCount(0);
    });
});

test('Escape in the backups dialog returns to the tree manager (dialog stack)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    await page.evaluate(() => {
        const treeId = window.Strom.DataManager.getCurrentTreeId();
        return window.Strom.UI.showSnapshotsDialog(treeId, 'tree-manager-modal');
    });
    const snapshots = page.locator('#snapshots-modal');
    await expect(snapshots).toBeVisible();
    await expect(manager).toBeHidden();

    // Escape closes the sub-dialog and RETURNS to the tree manager.
    await page.keyboard.press('Escape');
    await expect(snapshots).toBeHidden();
    await expect(manager).toBeVisible();
});

test('automatic backups can be turned off per tree; the existing ones may go too', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // A first edit of the day takes the automatic backup.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, { birthDate: '1900' });
    });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const modal = page.locator('#snapshots-modal');
    const toggle = modal.locator('#snapshots-auto-toggle');
    await expect(toggle).toBeChecked();
    await expect(modal.locator('.snapshot-row')).toHaveCount(1);

    // Turning off asks about the existing backups; Cancel keeps everything.
    await toggle.uncheck();
    const ask = page.locator('#confirmation-modal');
    await expect(ask).toContainText('Keep them, or delete them');
    await ask.locator('#confirm-cancel-btn').click();
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await ask.getByRole('button', { name: 'Delete backups' }).click();
    await expect(modal.locator('.snapshot-row')).toHaveCount(0);
    await expect(toggle).not.toBeChecked();
    const id = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    expect(await page.evaluate((id) => window.Strom.TreeManager.isAutoBackupEnabled(id), id)).toBe(false);

    // No automatic backup any more (not even before an import); manual still works.
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('pre-import'); });
    await page.evaluate(() => window.Strom.UI.renderSnapshotsList());
    await expect(modal.locator('.snapshot-row')).toHaveCount(0);
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('manual'); });
    await page.evaluate(() => window.Strom.UI.renderSnapshotsList());
    await expect(modal.locator('.snapshot-row')).toHaveCount(1);
});
