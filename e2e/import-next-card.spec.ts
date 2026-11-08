import { test, expect, Page, TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { openApp, createFirstPerson, waitForPersist } from './helpers.js';

/**
 * The "What next" card after a GEDCOM import from another program (spec 066
 * §1, K4.1 + K1.3): shown on the new-tree, insert and merge paths instead of
 * the two questions and the "Import complete" toast, once per import; a JSON
 * file and Strom's own GEDCOM keep the questions.
 */

/**
 * A file another program wrote: two families nothing connects (Habrcetl,
 * Sprtec). With `finding`, the son is born before his father (a data check
 * finding).
 */
function writeOtherProgramGedcom(testInfo: TestInfo, opts: { finding?: boolean; oneFamily?: boolean } = {}): string {
    const lines = [
        '0 HEAD', '1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0', '1 DATE 12 MAR 2024',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Vendelin /Habrcetl/', '1 SEX M', '1 BIRT', '2 DATE 3 FEB 1850', '2 PLAC Zbysov', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Kunhuta /Habrcetlova/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Kvido /Habrcetl/', '1 SEX M', '1 BIRT', `2 DATE ${opts.finding ? '1840' : '1878'}`, '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
    ];
    if (!opts.oneFamily) {
        lines.push(
            '0 @I4@ INDI', '1 NAME Radomil /Sprtec/', '1 SEX M', '1 BIRT', '2 DATE 1861', '1 FAMS @F2@',
            '0 @I5@ INDI', '1 NAME Eufemie /Sprtcova/', '1 SEX F', '1 BIRT', '2 DATE 1864', '1 FAMS @F2@',
            '0 @F2@ FAM', '1 HUSB @I4@', '1 WIFE @I5@',
        );
    }
    lines.push('0 TRLR', '');
    const p = testInfo.outputPath(opts.finding ? 'ftm-finding.ged' : opts.oneFamily ? 'ftm-one.ged' : 'ftm.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

/** Load a GEDCOM file and take it as a new tree. */
async function importAsNewTree(page: Page, file: string, name = 'Habrcetl'): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(file);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill(name);
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();
}

function nextCard(page: Page) {
    return page.locator('#import-next-card');
}

/** The import records of the open tree, as stored. */
function storedImports(page: Page): Promise<Array<{ id: string; program: string; nextCardClosed?: boolean }>> {
    return page.evaluate(async () => {
        const id = window.Strom.TreeManager.getActiveTreeId();
        const data = await window.Strom.TreeManager.getTreeData(id);
        return (data?.imports ?? []) as Array<{ id: string; program: string; nextCardClosed?: boolean }>;
    });
}

test('a GEDCOM from another program: the card with its origin, the data check, the families and the research', async ({ page }, testInfo) => {
    await openApp(page);
    await importAsNewTree(page, writeOtherProgramGedcom(testInfo, { finding: true }));

    const card = nextCard(page);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('role', 'dialog');
    await expect(card.locator('#import-next-title')).toHaveText('What next');
    await expect(card.locator('#import-next-title')).toBeFocused();
    await expect(card.locator('.import-next-origin'))
        .toHaveText(/^Tree from Family Tree Maker 24\.0 \(file 12 Mar 2024\) · 5 people$/);

    // The data check found something: what it is, and the way to it.
    const check = card.locator('.import-next-row--check');
    await expect(check.locator('.import-next-row-title')).toHaveText('Data check');
    await expect(check.locator('.import-next-row-desc')).toHaveText(/^Found \d+ things? worth a look\. Nothing is corrected automatically\.$/);
    await expect(check.getByRole('button', { name: 'Review' })).toBeVisible();
    // Two families nothing connects.
    const split = card.locator('.import-next-row--split');
    await expect(split.locator('.import-next-row-desc')).toHaveText('2 families with nothing connecting them. Each can become a tree of its own.');
    await expect(split.getByRole('button', { name: 'Separate disconnected parts…' })).toBeVisible();
    // No research here: what it is and how to install it, with no mark.
    const research = card.locator('.import-next-row--research');
    await expect(research.locator('.import-next-row-title')).toHaveText('Ancestor research with this tree');
    await expect(research.getByRole('button', { name: 'Ancestor research' })).toBeVisible();
    await expect(research.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
    await expect(card.locator('.import-next-note')).toContainText('The research takes facts from the family tree as leads');
    await expect(card.getByRole('button', { name: 'Back to Family Tree Maker: export with sources…' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'A tree from another program' })).toBeVisible();

    // The card replaced the two questions and the toast.
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    await expect(page.locator('.toast', { hasText: 'Import complete' })).toHaveCount(0);

    // Closed: never again for this import, not even after a reload.
    await card.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await storedImports(page))[0]?.nextCardClosed).toBe(true);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await page.waitForTimeout(1200);
    await expect(nextCard(page)).toHaveCount(0);
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
});

test('a clean file of one family: the check row says so, without a button, and no split row', async ({ page }, testInfo) => {
    await openApp(page);
    await importAsNewTree(page, writeOtherProgramGedcom(testInfo, { oneFamily: true }));
    const card = nextCard(page);
    await expect(card).toBeVisible();
    const check = card.locator('.import-next-row--check');
    await expect(check.locator('.import-next-row-desc')).toHaveText('The data check found nothing to fix.');
    await expect(check.locator('button')).toHaveCount(0);
    await expect(card.locator('.import-next-row--split')).toHaveCount(0);
    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    expect((await storedImports(page))[0]?.nextCardClosed).toBe(true);
});

test('Review on the card opens the data check, and the card is closed for good', async ({ page }, testInfo) => {
    await openApp(page);
    await importAsNewTree(page, writeOtherProgramGedcom(testInfo, { finding: true }));
    const card = nextCard(page);
    await card.getByRole('button', { name: 'Review' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('#tree-validation-modal')).toBeVisible();
    await expect.poll(async () => (await storedImports(page))[0]?.nextCardClosed).toBe(true);
});

test('"Insert into tree": the card says where the people went, and a backup was taken before', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await waitForPersist(page, 'Seed');
    const treeName: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.name ?? '');

    await page.evaluate(() => { (window.Strom.UI as unknown as { importToCurrentTree: boolean }).importToCurrentTree = true; });
    await page.locator('#gedcom-input').setInputFiles(writeOtherProgramGedcom(testInfo, { finding: true }));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-insert-btn').click();

    const card = nextCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator('.import-next-origin'))
        .toHaveText(`Inserted into the tree ${treeName}: 5 people from Family Tree Maker 24.0 (file 12 Mar 2024)`);
    // K1.3: the data check after "Insert into tree" too (it is the card's first row).
    await expect(card.locator('.import-next-row--check .import-next-row-desc')).toHaveText(/^Found \d+ things? worth a look/);
    await expect(page.locator('.toast', { hasText: 'Import complete' })).toHaveCount(0);
});

test('a merge with a GEDCOM: the card in the merged tree, with the new and updated people', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Vendelin', 'Habrcetl', { birthDate: '1850' });
    await waitForPersist(page, 'Vendelin');

    await page.locator('#gedcom-input').setInputFiles(writeOtherProgramGedcom(testInfo, { oneFamily: true }));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-merge-btn').click();
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('1');
    await wizard.getByRole('button', { name: 'Execute merge' }).click();
    const confirm = page.locator('#confirmation-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('#prompt-input').fill('Habrcetl merged');
    await confirm.locator('#confirm-ok-btn').click();
    // "Switch to the new tree?"
    await expect(confirm).toContainText(/switch/i);
    await confirm.locator('#confirm-ok-btn').click();

    const card = nextCard(page);
    await expect(card).toBeVisible();
    await expect(card.locator('.import-next-origin'))
        .toHaveText(`Merged into the tree Habrcetl merged: 2 new people, 1 updated · from Family Tree Maker 24.0 (file 12 Mar 2024)`);
    await expect(page.locator('#tree-manager-modal')).not.toHaveClass(/active/);
});

test('a JSON file keeps the questions after an import, without the card', async ({ page }) => {
    await openApp(page);
    const json = JSON.stringify({
        version: 5,
        persons: {
            a: { id: 'a', firstName: 'Vendelin', lastName: 'Habrcetl', gender: 'male', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            b: { id: 'b', firstName: 'Kunhuta', lastName: 'Habrcetlova', gender: 'female', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            x: { id: 'x', firstName: 'Radomil', lastName: 'Sprtec', gender: 'male', isPlaceholder: false, partnerships: ['u2'], parentIds: [], childIds: [] },
            y: { id: 'y', firstName: 'Eufemie', lastName: 'Sprtcova', gender: 'female', isPlaceholder: false, partnerships: ['u2'], parentIds: [], childIds: [] },
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' },
            u2: { id: 'u2', person1Id: 'x', person2Id: 'y', childIds: [], status: 'married' },
        },
    });
    await page.evaluate((j) => {
        (window.Strom.UI as unknown as { importTreeData: unknown }).importTreeData = JSON.parse(j);
        window.Strom.UI.showImportTreeDialog(JSON.parse(j), 'Imported');
    }, json);
    await page.getByRole('button', { name: /Import|Create/ }).first().click();
    await expect(page.getByText(/families that nothing connects/i)).toBeVisible({ timeout: 10000 });
    await expect(nextCard(page)).toHaveCount(0);
});

test('Strom\'s own GEDCOM (exported, then loaded again) is no import from another program: no card', async ({ page }, testInfo) => {
    await openApp(page);
    await importAsNewTree(page, writeOtherProgramGedcom(testInfo, { finding: true }));
    await nextCard(page).getByRole('button', { name: 'Close', exact: true }).last().click();

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([page.waitForEvent('download'), pwd.locator('#export-submit-btn').click()]);
    const own = testInfo.outputPath('own.ged');
    await download.saveAs(own);
    expect(readFileSync(own, 'utf-8')).toMatch(/^1 SOUR STROM/m);

    await importAsNewTree(page, own, 'Again');
    // The questions of before (the data check finding), not the card.
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    await expect(page.locator('#confirmation-modal')).toContainText(/worth a look/);
    await expect(nextCard(page)).toHaveCount(0);
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a bottom sheet with Close across its width; a tap on the dimmed tree closes it too', async ({ page }, testInfo) => {
        await openApp(page);
        await importAsNewTree(page, writeOtherProgramGedcom(testInfo, { finding: true }));
        const card = nextCard(page);
        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/import-next--sheet/);
        // No × at the top on a phone: Close is at the bottom, the sheet's full width, 44 px or more.
        await expect(card.locator('.import-next-x')).toHaveCount(0);
        const close = card.locator('.import-next-close');
        const [cardBox, closeBox] = [await card.boundingBox(), await close.boundingBox()];
        expect(closeBox!.width).toBeGreaterThan(cardBox!.width - 40);
        expect(closeBox!.height).toBeGreaterThanOrEqual(44);
        // Nothing wider than the screen.
        expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        // On a phone the research row offers what it is (no research on a phone).
        await expect(card.locator('.import-next-row--research').getByRole('button', { name: 'Ancestor research' })).toBeVisible();

        await page.mouse.click(195, 30);
        await expect(card).toHaveCount(0);
        await expect.poll(async () => (await storedImports(page))[0]?.nextCardClosed).toBe(true);
    });
});
