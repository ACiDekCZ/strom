import { test, expect, Page, TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { openApp, createFirstPerson, addRelation, card, waitForPersist } from './helpers.js';

/**
 * Import paths beyond the plain JSON file: an exported HTML app (plain and
 * password-protected) through the tree manager's "From HTML file", a
 * password-protected "Export all" backup through "From JSON", and the GEDCOM
 * result dialog's "Save as JSON" and "Merge with existing" choices.
 */

const FILE_PASSWORD = 'birch-file-77';

/** Stored trees with their person first names, read through the app. */
function treeSummaries(page: Page): Promise<Array<{ id: string; name: string; names: string[] }>> {
    return page.evaluate(async () => {
        const out: Array<{ id: string; name: string; names: string[] }> = [];
        for (const t of window.Strom.TreeManager.getTrees()) {
            const data = await window.Strom.TreeManager.getTreeData(t.id);
            const persons = data ? Object.values(data.persons) as Array<{ firstName: string }> : [];
            out.push({ id: t.id, name: t.name, names: persons.map(p => p.firstName).sort() });
        }
        return out;
    });
}

/** Tree manager → "New tree" → `option`; answers the OS file picker with `file`. */
async function importFromManager(page: Page, option: 'From HTML file' | 'From JSON' | 'From GEDCOM', file: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    await manager.locator('button.primary.edit-only').click();
    const menu = page.locator('#new-tree-menu-modal');
    await expect(menu).toBeVisible();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        menu.locator('.menu-option', { hasText: option }).click(),
    ]);
    await chooser.setFiles(file);
}

/** Export the active tree as a standalone app (optionally password-protected). */
async function exportAppFile(page: Page, testInfo: TestInfo, name: string, password?: string): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    if (password) {
        await pwd.locator('#export-encrypt-toggle').check();
        await pwd.locator('#export-password-input').fill(password);
        await pwd.locator('#export-password-confirm').fill(password);
    }
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    const out = testInfo.outputPath(name);
    await download.saveAs(out);
    return out;
}

/** Jan + Marie Novak with their son Petr (3 persons, 1 couple). */
async function buildFamily(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await waitForPersist(page, 'Petr');
}

test('an exported HTML app imports through "From HTML file" as a new tree with its counts', { tag: '@smoke' }, async ({ page }, testInfo) => {
    await openApp(page);
    await buildFamily(page);
    const file = await exportAppFile(page, testInfo, 'family.html');
    const before = await treeSummaries(page);
    expect(before).toHaveLength(1);

    await importFromManager(page, 'From HTML file', file);
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#import-tree-persons')).toHaveText('3');
    await expect(dialog.locator('#import-tree-partnerships')).toHaveText('1');
    await dialog.locator('#import-tree-name').fill('From the HTML file');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await treeSummaries(page)).length).toBe(2);
    const after = await treeSummaries(page);
    const imported = after.find(t => t.id !== before[0].id)!;
    expect(imported.name).toBe('From the HTML file');
    expect(imported.names).toEqual(['Jan', 'Marie', 'Petr']);
    // The source tree is untouched.
    expect(after.find(t => t.id === before[0].id)!.names).toEqual(['Jan', 'Marie', 'Petr']);
});

test('a password-protected HTML app asks for the file password: wrong keeps asking, right imports', async ({ page }, testInfo) => {
    await openApp(page);
    await buildFamily(page);
    const file = await exportAppFile(page, testInfo, 'locked.html', FILE_PASSWORD);
    // The exported file keeps the names encrypted.
    const html = readFileSync(file, 'utf-8');
    expect(html).not.toContain('Marie');

    await importFromManager(page, 'From HTML file', file);
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();

    await prompt.locator('#password-prompt-input').fill('not-it');
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt.locator('#password-prompt-error')).toHaveText('Incorrect password');
    await expect(prompt).toBeVisible();
    await expect(page.locator('#import-tree-modal')).toBeHidden();

    await prompt.locator('#password-prompt-input').fill(FILE_PASSWORD);
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt).toBeHidden();
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#import-tree-persons')).toHaveText('3');
    await dialog.locator('#import-tree-name').fill('Unlocked copy');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Unlocked copy');
    await expect(card(page, 'Marie')).toBeVisible();
    // The file password did not switch on local encryption.
    expect(await page.evaluate(() => window.Strom.SettingsManager.isEncryptionEnabled())).toBe(false);
});

test('a password-protected "Export all" JSON restores every tree after the password', async ({ page }, testInfo) => {
    await openApp(page);
    await buildFamily(page);
    // A second tree with one person.
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const newTree = page.locator('#new-tree-modal');
    await newTree.locator('#new-tree-name').fill('Second tree');
    await newTree.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Second tree');
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await waitForPersist(page, 'Karel');
    const beforeIds = (await treeSummaries(page)).map(t => t.id);

    // "Export all" as JSON with a password.
    await page.evaluate(() => window.Strom.UI.showExportAllDialog());
    await page.locator('#export-all-modal .menu-option', { hasText: 'Export as JSON' }).click();
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    await pwd.locator('#export-encrypt-toggle').check();
    await pwd.locator('#export-password-input').fill(FILE_PASSWORD);
    await pwd.locator('#export-password-confirm').fill(FILE_PASSWORD);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    const file = testInfo.outputPath('strom-all-trees.json');
    await download.saveAs(file);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    expect(raw.encrypted).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('Karel');

    await importFromManager(page, 'From JSON', file);
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();
    await prompt.locator('#password-prompt-input').fill(FILE_PASSWORD);
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt).toBeHidden();

    // The decrypted backup routes to "restore all trees", not a single import.
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('2 trees');
    await confirm.locator('#confirm-ok-btn').click();
    await expect.poll(async () => (await treeSummaries(page)).length).toBe(4);

    const restored = (await treeSummaries(page)).filter(t => !beforeIds.includes(t.id));
    expect(restored.map(t => t.names.join(',')).sort()).toEqual(['Jan,Marie,Petr', 'Karel']);
    expect(restored.some(t => t.name.includes('Second tree'))).toBe(true);
});

/** A three-person GEDCOM: Jan Novak (b. 1950) + Eva, their son Karel. */
function writeFamilyGedcom(testInfo: TestInfo): string {
    const ged = [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Novak/', '1 SEX M', '1 BIRT', '2 DATE 1950', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Eva /Novakova/', '1 SEX F', '1 BIRT', '2 DATE 1952', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Karel /Novak/', '1 SEX M', '1 BIRT', '2 DATE 1975', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 MARR', '2 DATE 1973',
        '0 TRLR', '',
    ].join('\n');
    const p = testInfo.outputPath('family.ged');
    writeFileSync(p, ged);
    return p;
}

test('GEDCOM result: "Save as JSON" downloads the converted tree and adds no tree', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await waitForPersist(page, 'Seed');

    await page.locator('#gedcom-input').setInputFiles(writeFamilyGedcom(testInfo));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('3');
    await expect(result.locator('#gedcom-stat-partnerships')).toHaveText('1');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        result.locator('#gedcom-save-json-btn').click(),
    ]);
    expect(download.suggestedFilename()).toBe('family-tree.json');
    await expect(result).toBeHidden();

    const data = JSON.parse(readFileSync((await download.path())!, 'utf-8'));
    const persons = Object.values(data.persons) as Array<{ firstName: string; lastName: string; parentIds: string[] }>;
    expect(persons.map(p => `${p.firstName} ${p.lastName}`).sort())
        .toEqual(['Eva Novakova', 'Jan Novak', 'Karel Novak']);
    expect(persons.find(p => p.firstName === 'Karel')!.parentIds).toHaveLength(2);
    expect(Object.keys(data.partnerships)).toHaveLength(1);

    // Nothing was imported into the browser.
    const trees = await treeSummaries(page);
    expect(trees).toHaveLength(1);
    expect(trees[0].names).toEqual(['Seed']);
});

test('GEDCOM result: "Merge with existing" matches the shared person and adds the rest', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await waitForPersist(page, 'Jan');
    const originalId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    await page.locator('#gedcom-input').setInputFiles(writeFamilyGedcom(testInfo));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-merge-btn').click();
    await expect(result).toBeHidden();

    // The merge wizard pairs the file's Jan with mine and offers Eva + Karel as new.
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('1');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('2');
    await expect(wizard.locator('#merge-match-list')).toContainText('Jan');

    await wizard.getByRole('button', { name: 'Execute merge' }).click();
    // Same name + birth year is a confident match (no "undecided" gate); the
    // result goes to a new tree named in the prompt.
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('#prompt-input')).toHaveValue(/merged|\+/i);
    await confirm.locator('#prompt-input').fill('Merged with GEDCOM');
    await confirm.locator('#confirm-ok-btn').click();

    await expect.poll(async () => (await treeSummaries(page)).length).toBe(2);
    const trees = await treeSummaries(page);
    const merged = trees.find(t => t.name === 'Merged with GEDCOM')!;
    // Jan appears once (matched), Eva and Karel were added.
    expect(merged.names).toEqual(['Eva', 'Jan', 'Karel']);
    // My original tree is unchanged.
    expect(trees.find(t => t.id === originalId)!.names).toEqual(['Jan']);
});
