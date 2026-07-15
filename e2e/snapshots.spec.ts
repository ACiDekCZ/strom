import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

/**
 * Backups: deleting one, and being honest about what they are. They live in the
 * browser's IndexedDB, outside the tree data — so they never grow the exported
 * file, and they are not a substitute for exporting it.
 */
test('a single backup can be deleted, and the tree is not touched', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(async () => {
        await window.Strom.DataManager.snapshotNow('manual');
        await window.Strom.DataManager.snapshotNow('manual');
    });

    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-modal')).toHaveClass(/active/);
    const rows = page.locator('.snapshot-row');
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    await page.locator('.snapshot-delete').first().click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(rows).toHaveCount(before - 1);
    // Only the backup went.
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().length)).toBe(1);
});

test('backups say they are not a substitute for exporting', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());

    // Someone who reads these as their safety net and then reinstalls their
    // laptop loses everything — the dialog has to say so.
    await expect(page.locator('.snapshots-note')).toContainText('this browser');
    await expect(page.locator('.snapshots-note')).toContainText('Export');
});

test('backups never end up inside the tree file', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(async () => {
        await window.Strom.DataManager.snapshotNow('manual');
    });

    // The exported data is what the user carries away; backups inside it would
    // grow the file every day, each one holding the ones before it.
    const data = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()));
    expect(Object.keys(JSON.parse(data))).not.toContain('snapshots');
    expect(data).not.toContain('gzip');
});

test('one backup of one person reads as "1 person"', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(async () => {
        await window.Strom.DataManager.snapshotNow('manual');
    });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());

    await expect(page.locator('.snapshot-meta').first()).toContainText('1 person');
    await expect(page.locator('.snapshot-meta').first()).not.toContainText('1 people');
});
