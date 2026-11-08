import { test, expect, Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'fs';
import { openApp, createFirstPerson, waitForPersist, cardAction, personModal } from './helpers.js';

/**
 * The origin of facts from a GEDCOM another program wrote (spec 066): the
 * import becomes a record of the tree, every fact from the file keeps the
 * value it came with, an edit ends that, and inserting into the open tree
 * takes a backup first.
 */

function writeGedcom(testInfo: TestInfo): string {
    const lines = [
        '0 HEAD', '1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0', '1 DATE 12 MAR 2024',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Vendelin /Habrcetl/', '1 SEX M', '1 BIRT', '2 DATE 3 FEB 1850', '2 PLAC Zbysov', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Kunhuta /Habrcetlova/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1874',
        '0 TRLR', '',
    ];
    const p = testInfo.outputPath('origin.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

interface StoredPerson {
    firstName: string;
    birthDate?: string;
    importedValues?: Record<string, { from: string; value: string }>;
}

function storedTree(page: Page): Promise<{ imports?: Array<Record<string, unknown>>; persons: Record<string, StoredPerson> }> {
    return page.evaluate(async () => {
        const id = window.Strom.TreeManager.getActiveTreeId();
        const data = await window.Strom.TreeManager.getTreeData(id);
        return JSON.parse(JSON.stringify({ imports: data?.imports, persons: data?.persons ?? {} }));
    });
}

function person(tree: { persons: Record<string, StoredPerson> }, firstName: string): StoredPerson {
    const p = Object.values(tree.persons).find(x => x.firstName === firstName);
    if (!p) throw new Error(`no ${firstName}`);
    return p;
}

async function closeNextCard(page: Page): Promise<void> {
    const card = page.locator('#import-next-card');
    await expect(card).toBeVisible();
    await card.locator('.import-next-close').click();
    await expect(card).toHaveCount(0);
}

test('the import is a record of the tree, its facts are marked, and an edit ends a fact\'s mark', async ({ page }, testInfo) => {
    await openApp(page);
    await page.locator('#gedcom-input').setInputFiles(writeGedcom(testInfo));
    await page.locator('#gedcom-result-modal #gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await importDialog.locator('#import-tree-name').fill('Habrcetl');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await closeNextCard(page);

    let tree = await storedTree(page);
    expect(tree.imports).toHaveLength(1);
    const rec = tree.imports![0];
    expect(rec).toMatchObject({ program: 'Family Tree Maker', version: '24.0', fileDate: '12 MAR 2024', file: 'origin.ged' });
    expect(typeof rec.sha).toBe('string');
    const vendelin = person(tree, 'Vendelin');
    expect(Object.keys(vendelin.importedValues ?? {})).toEqual(expect.arrayContaining(['firstName', 'lastName', 'birthDate', 'birthPlace']));
    expect(Object.keys(person(tree, 'Kunhuta').importedValues ?? {})).toContain('birthDate');

    // Edit the birth date: that fact is no longer the file's, the others stay.
    await cardAction(page, 'Vendelin', 'edit');
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-birthdate').fill('4.2.1850');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    await waitForPersist(page, '1850-02-04');

    tree = await storedTree(page);
    // A fact counts as from the file only while its value is the one the file gave.
    const v = person(tree, 'Vendelin') as unknown as Record<string, unknown> & StoredPerson;
    const fromFile = Object.entries(v.importedValues ?? {})
        .filter(([key, iv]) => v[key] === iv.value)
        .map(([key]) => key);
    expect(fromFile).not.toContain('birthDate');
    expect(fromFile).toEqual(expect.arrayContaining(['firstName', 'birthPlace']));
    expect(person(tree, 'Vendelin').birthDate).toBe('1850-02-04');
});

test('inserting a GEDCOM into the open tree takes a backup before it', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Radomil', 'Sprtec');
    await waitForPersist(page, 'Radomil');

    await page.evaluate(() => { (window.Strom.UI as unknown as { importToCurrentTree: boolean }).importToCurrentTree = true; });
    await page.locator('#gedcom-input').setInputFiles(writeGedcom(testInfo));
    await page.locator('#gedcom-result-modal #gedcom-insert-btn').click();
    await closeNextCard(page);

    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const rows = page.locator('#snapshots-modal .snapshot-row');
    await expect(rows.filter({ hasText: 'Before import' })).toHaveCount(1);
});
