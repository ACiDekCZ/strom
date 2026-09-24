import { test, expect, Page, Download } from '@playwright/test';
import { pathToFileURL } from 'url';
import { openApp, createFirstPerson, card, addRelation, waitForPersist } from './helpers.js';

/**
 * Data-safety paths: local encryption across reloads (unlock, cancel, wrong
 * password), the other-tab warning, "Export all" backups restoring every tree,
 * reopening an exported file without duplicating it, and deleting a tree
 * taking its backups with it. Every test starts from a fresh browser context
 * (clean IndexedDB + localStorage).
 */

const PASSWORD = 'linden-tree-42';

/** Create a second tree named `name` from the new-tree dialog and leave it active. */
async function createTree(page: Page, name: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const dialog = page.locator('#new-tree-modal');
    await dialog.locator('#new-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(name);
}

/**
 * Two trees: the default one with Jan + Marie (2 persons) and "Second tree"
 * with Karel + Lenka + their child Ota (3 persons). Leaves the second active.
 */
async function buildTwoTrees(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await waitForPersist(page, 'Marie');
    await createTree(page, 'Second tree');
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await addRelation(page, 'Karel', 'partner', 'Lenka', 'Dvorak', 'female');
    await addRelation(page, 'Karel', 'child', 'Ota', 'Dvorak');
    await waitForPersist(page, 'Ota');
}

/** Stored trees with their person counts, read through the app (decrypts). */
function treeSummaries(page: Page): Promise<Array<{ id: string; name: string; persons: number; names: string[] }>> {
    return page.evaluate(async () => {
        const out: Array<{ id: string; name: string; persons: number; names: string[] }> = [];
        for (const t of window.Strom.TreeManager.getTrees()) {
            const data = await window.Strom.TreeManager.getTreeData(t.id);
            const persons = data ? Object.values(data.persons) as Array<{ firstName: string }> : [];
            out.push({
                id: t.id,
                name: t.name,
                persons: persons.length,
                names: persons.map(p => p.firstName).sort(),
            });
        }
        return out;
    });
}

/**
 * Wait until every stored tree record is encrypted and none of `plainNames`
 * is readable in the `trees` store any more — i.e. the encryption re-save
 * really landed on disk, so a reload sees ciphertext only.
 */
async function waitForEncryptedAtRest(page: Page, plainNames: string[]): Promise<void> {
    await page.waitForFunction((names) => new Promise<boolean>((resolve) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            try {
                const all = req.result.transaction('trees', 'readonly').objectStore('trees').getAll();
                all.onsuccess = () => {
                    const text = JSON.stringify(all.result);
                    resolve(text.includes('"encrypted":true') && names.every(n => !text.includes(n)));
                };
                all.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        };
        req.onerror = () => resolve(false);
    }), plainNames);
}

/** Switch local encryption on through the settings dialog. */
async function enableEncryption(page: Page, plainNames: string[]): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    await settings.locator('#encryption-toggle').check();
    const setup = page.locator('#password-setup-modal');
    await expect(setup).toBeVisible();
    await setup.locator('#password-setup-input').fill(PASSWORD);
    await setup.locator('#password-setup-confirm').fill(PASSWORD);
    await setup.getByRole('button', { name: 'Save' }).click();
    await expect(setup).toBeHidden();
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
    await waitForEncryptedAtRest(page, plainNames);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
}

/** The startup unlock prompt. */
function passwordPrompt(page: Page) {
    return page.locator('#password-prompt-modal');
}

async function submitPassword(page: Page, password: string): Promise<void> {
    const prompt = passwordPrompt(page);
    await prompt.locator('#password-prompt-input').fill(password);
    await prompt.locator('#password-prompt-input').press('Enter');
}

test.describe('Local encryption', () => {
    test('encrypted tree survives a reload: password prompt, right password shows the tree', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
        await waitForPersist(page, 'Marie');

        await enableEncryption(page, ['Jan', 'Marie']);

        await page.reload();
        const prompt = passwordPrompt(page);
        await expect(prompt).toBeVisible();
        // Nothing of the tree is shown while locked.
        await expect(card(page, 'Jan')).toHaveCount(0);

        await submitPassword(page, PASSWORD);
        await expect(prompt).toBeHidden();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(card(page, 'Marie')).toBeVisible();
        await expect(page.locator('#locked-data-notice')).toHaveCount(0);
    });

    test('cancelled unlock leaves an Unlock banner and a read-only app; unlocking restores editing', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
        await waitForPersist(page, 'Marie');
        await enableEncryption(page, ['Jan', 'Marie']);

        await page.reload();
        const prompt = passwordPrompt(page);
        await expect(prompt).toBeVisible();
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        await expect(prompt).toBeHidden();

        const banner = page.locator('#locked-data-notice');
        await expect(banner).toBeVisible();
        await expect(banner).toHaveClass(/storage-notice/);
        await expect(banner.getByRole('button', { name: 'Unlock' })).toBeVisible();

        // Locked = read-only: the empty state says so and offers only Unlock.
        await expect(page.locator('body')).toHaveClass(/\bdata-locked\b/);
        const empty = page.locator('#empty-state');
        await expect(empty).toBeVisible();
        await expect(empty).toContainText('Your data is locked — unlock to continue');
        await expect(empty.getByRole('button', { name: 'Add first person' })).toBeHidden();
        await expect(empty.getByRole('button', { name: /Try a sample tree/ })).toBeHidden();
        const emptyUnlock = page.locator('#empty-state-unlock-btn');
        await expect(emptyUnlock).toBeVisible();
        await expect(emptyUnlock).toHaveText('Unlock');

        // No add / undo entry points anywhere in the shell.
        await expect(page.locator('.toolbar .btn-add-person')).toBeHidden();
        await expect(page.locator('#toolbar-family-btn')).toBeHidden();
        await expect(page.locator('#bottom-bar-fab')).toBeHidden();
        await expect(page.locator('#toolbar-undo-group')).toBeHidden();
        // The actions menu keeps settings, drops the edit rows.
        await page.locator('.actions-menu-btn').click();
        const menu = page.locator('#actions-menu-dropdown');
        await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
        await expect(page.locator('#actions-undo-row')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeActionsMenu());

        // Even a direct call cannot open the add dialog or change the data.
        await page.evaluate(() => window.Strom.UI.showAddPersonModal());
        await expect(page.locator('#person-modal')).not.toHaveClass(/\bactive\b/);
        const refused = await page.evaluate(() => {
            try {
                window.Strom.DataManager.createPerson({ firstName: 'Intruder', lastName: 'Locked', gender: 'male' });
                return 'created';
            } catch (err) {
                return (err as Error).name;
            }
        });
        expect(refused).toBe('DataLockedError');
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().length)).toBe(0);
        // Refused quietly: no "not being saved" toast.
        await expect(page.locator('.toast', { hasText: 'NOT being saved' })).toHaveCount(0);
        // The encrypted record is still there and still ciphertext only.
        await waitForEncryptedAtRest(page, ['Jan', 'Marie', 'Intruder']);

        // Unlock from the empty state: the tree comes back, editable, no reload.
        await emptyUnlock.click();
        await expect(prompt).toBeVisible();
        await submitPassword(page, PASSWORD);
        await expect(prompt).toBeHidden();
        await expect(banner).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/\bdata-locked\b/);
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(card(page, 'Marie')).toBeVisible();
        await expect(card(page, 'Intruder')).toHaveCount(0);
        await expect(page.locator('.toolbar .btn-add-person')).toBeVisible();

        await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
        await expect(card(page, 'Petr')).toBeVisible();
        await expect.poll(async () => (await treeSummaries(page))[0]?.names)
            .toEqual(['Jan', 'Marie', 'Petr']);
        await waitForEncryptedAtRest(page, ['Jan', 'Marie', 'Petr']);
        const trees = await treeSummaries(page);
        expect(trees).toHaveLength(1);
    });

    test('the Unlock banner reopens the prompt and unlocks the tree', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await waitForPersist(page, 'Jan');
        await enableEncryption(page, ['Jan']);

        await page.reload();
        const prompt = passwordPrompt(page);
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        const banner = page.locator('#locked-data-notice');
        await banner.getByRole('button', { name: 'Unlock' }).click();
        await expect(prompt).toBeVisible();
        await submitPassword(page, PASSWORD);
        await expect(prompt).toBeHidden();
        await expect(banner).toHaveCount(0);
        await expect(card(page, 'Jan')).toBeVisible();
    });

    test('wrong password, then the right one: all trees intact', async ({ page }) => {
        await openApp(page);
        await buildTwoTrees(page);
        const before = await treeSummaries(page);
        expect(before.map(t => t.persons).sort()).toEqual([2, 3]);

        await enableEncryption(page, ['Marie', 'Lenka', 'Ota']);

        await page.reload();
        const prompt = passwordPrompt(page);
        await expect(prompt).toBeVisible();

        await submitPassword(page, 'not-the-password');
        await expect(prompt.locator('#password-prompt-error')).toHaveText('Incorrect password');
        await expect(prompt).toBeVisible();

        await submitPassword(page, PASSWORD);
        await expect(prompt).toBeHidden();
        // The active tree (the second one) renders.
        await expect(card(page, 'Karel')).toBeVisible();
        await expect(card(page, 'Ota')).toBeVisible();

        const after = await treeSummaries(page);
        expect(after).toEqual(before);
    });
});

test('another tab saving the same tree shows a notice with a Reload action', async ({ page, context }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');

    const pageB = await context.newPage();
    await openApp(pageB);
    await expect(card(pageB, 'Jan')).toBeVisible();
    // Merely opening the tree elsewhere is not a change.
    await expect(page.locator('#other-tab-notice')).toHaveCount(0);

    // Tab B saves an edit.
    await addRelation(pageB, 'Jan', 'child', 'Petr', 'Novak');
    await waitForPersist(pageB, 'Petr');

    const notice = page.locator('#other-tab-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('changed in another tab');
    // Tab B does not warn about its own save.
    await expect(pageB.locator('#other-tab-notice')).toHaveCount(0);

    // Reload in tab A brings in B's change.
    await expect(card(page, 'Petr')).toHaveCount(0);
    await notice.getByRole('button', { name: 'Reload' }).click();
    await expect(card(page, 'Petr')).toBeVisible();
    await expect(page.locator('#other-tab-notice')).toHaveCount(0);
});

test.describe('"Export all" backups restore every tree', () => {
    /** Open "Export all", pick an option and export unencrypted with full names. */
    async function exportAll(page: Page, option: 'Export as JSON' | 'Export as app'): Promise<Download> {
        await page.evaluate(() => window.Strom.UI.showExportAllDialog());
        const menu = page.locator('#export-all-modal');
        await expect(menu).toBeVisible();
        await menu.locator('.menu-option', { hasText: option }).click();
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        await pwd.locator('#export-privacy-mode').selectOption('full');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            pwd.getByRole('button', { name: 'Export without encryption' }).click(),
        ]);
        return download;
    }

    /** Confirm the "Import all trees" question and wait for the new trees. */
    async function confirmRestore(page: Page, expectedTrees: number): Promise<void> {
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('2 trees');
        await confirm.locator('#confirm-ok-btn').click();
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getTrees().length))
            .toBe(expectedTrees);
    }

    async function expectRestored(page: Page, beforeIds: string[]): Promise<void> {
        const all = await treeSummaries(page);
        const restored = all.filter(t => !beforeIds.includes(t.id));
        expect(restored).toHaveLength(2);
        const byCount = [...restored].sort((a, b) => a.persons - b.persons);
        expect(byCount.map(t => t.persons)).toEqual([2, 3]);
        expect(byCount[0].names).toEqual(['Jan', 'Marie']);
        expect(byCount[1].names).toEqual(['Karel', 'Lenka', 'Ota']);
        expect(byCount[1].name).toContain('Second tree');
        // The originals are untouched.
        const originals = all.filter(t => beforeIds.includes(t.id));
        expect(originals.map(t => t.persons).sort()).toEqual([2, 3]);
    }

    test('"Export all" JSON re-imports as all trees with their persons', async ({ page }, testInfo) => {
        await openApp(page);
        await buildTwoTrees(page);
        const beforeIds = (await treeSummaries(page)).map(t => t.id);

        const download = await exportAll(page, 'Export as JSON');
        const file = testInfo.outputPath('strom-all-trees.json');
        await download.saveAs(file);

        await page.locator('#file-input').setInputFiles(file);
        await confirmRestore(page, 4);
        await expectRestored(page, beforeIds);
    });

    test('"Export all" HTML re-imports as all trees with their persons', async ({ page }, testInfo) => {
        await openApp(page);
        await buildTwoTrees(page);
        const beforeIds = (await treeSummaries(page)).map(t => t.id);

        const download = await exportAll(page, 'Export as app');
        const file = testInfo.outputPath('strom-all-trees.html');
        await download.saveAs(file);

        await page.locator('#html-input').setInputFiles(file);
        await confirmRestore(page, 4);
        await expectRestored(page, beforeIds);
    });
});

test('reopening an exported HTML file offers the stored tree instead of adding a duplicate', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    // Export the tree as a standalone app file.
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const file = testInfo.outputPath('family.html');
    await download.saveAs(file);
    const fileUrl = pathToFileURL(file).href;

    const storedTrees = () => page.evaluate(() => window.Strom.TreeManager.getTrees().length);

    // First open: view mode; "Stay with this file" keeps it in this browser.
    await page.goto(fileUrl);
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(page.locator('#existing-export-modal')).toBeHidden();
    await page.locator('#view-mode-banner').getByText('Stay with this file').click();
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);
    await expect(card(page, 'Jan')).toBeVisible();
    await expect.poll(storedTrees).toBe(1);
    await waitForPersist(page, 'Marie');

    // Second open of the SAME file: the stored tree is offered.
    await page.goto(fileUrl);
    const existing = page.locator('#existing-export-modal');
    await expect(existing).toBeVisible();
    await expect(existing.locator('#existing-export-tree-name')).not.toBeEmpty();
    expect(await storedTrees()).toBe(1);

    // Staying in the file's view and clicking "Stay with this file" again
    // re-offers the stored tree instead of importing a second copy.
    await existing.getByRole('button', { name: 'View embedded version' }).click();
    await expect(existing).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await page.locator('#view-mode-banner').getByText('Stay with this file').click();
    await expect(existing).toBeVisible();
    expect(await storedTrees()).toBe(1);

    // Keep working with the stored version: no second copy appears.
    await existing.getByRole('button', { name: 'View stored version' }).click();
    await expect(existing).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await storedTrees()).toBe(1);

    // Third open, choosing to update storage instead: still one tree.
    await page.goto(fileUrl);
    await expect(existing).toBeVisible();
    await existing.getByRole('button', { name: 'Update storage' }).click();
    await expect(existing).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);
    await expect(card(page, 'Marie')).toBeVisible();
    expect(await storedTrees()).toBe(1);
});

test('deleting a tree deletes its backups, other trees keep theirs', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
    const doomedId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    // Manual backup of the tree that will be deleted (through the dialog).
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const snapshots = page.locator('#snapshots-modal');
    await snapshots.getByRole('button', { name: 'Create backup now' }).click();
    await expect(snapshots.locator('.snapshot-row')).toHaveCount(1);
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

    // A second tree with a backup of its own.
    await createTree(page, 'Keeper');
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await waitForPersist(page, 'Karel');
    const keeperId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await snapshots.getByRole('button', { name: 'Create backup now' }).click();
    await expect(snapshots.locator('.snapshot-row')).toHaveCount(1);
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

    const snapshotTreeIds = () => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const all = req.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
            // Payload records carry { meta }; the small meta:<id> records are the meta itself.
            all.onsuccess = () => resolve(all.result
                .filter((s: { meta?: unknown }) => s.meta)
                .map((s: { meta: { treeId: string } }) => s.meta.treeId));
            all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
    }));
    expect((await snapshotTreeIds()).sort()).toEqual([doomedId, keeperId].sort());

    // Delete the first tree from the tree manager (confirm).
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await expect(page.locator('#tree-manager-modal')).toBeVisible();
    await page.evaluate((id) => { void window.Strom.UI.confirmDeleteTree(id); }, doomedId);
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#confirm-ok-btn').click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(1);

    // Its backup is gone; the other tree's backup stays.
    await expect.poll(snapshotTreeIds).toEqual([keeperId]);
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(snapshots.locator('.snapshot-row')).toHaveCount(1);
});
