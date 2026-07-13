import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import {
    openApp, createFirstPerson, card, cardAction, addRelation, fillPerson,
    exportTreeJson, importJsonAsNewTree,
} from './helpers.js';

/** Build a small couple-with-child tree: Jan + Marie, child Petr. */
async function buildFamily(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
}

function personCount(page: Page): Promise<number> {
    return page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
}

test('JSON round-trip: export a 3-person tree, re-import it as a new tree', async ({ page }) => {
    await openApp(page);
    await buildFamily(page);

    const jsonPath = await exportTreeJson(page);
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(Object.keys(data.persons)).toHaveLength(3);
    expect(Object.keys(data.partnerships)).toHaveLength(1);

    await importJsonAsNewTree(page, jsonPath, 'Roundtrip');
    // The imported tree is now active; all three persons and the child link survive.
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Roundtrip');
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Petr')).toBeVisible();
    expect(await personCount(page)).toBe(3);
});

test('importing as a new tree leaves the existing tree untouched', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Solo', 'Original'); // unique name (fixtures use "Jan")
    const originalTree = (await page.locator('.tree-switcher-btn .tree-name').textContent())?.trim() || '';

    await importJsonAsNewTree(page, 'e2e/fixtures/family-basic.json', 'Imported');
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Imported');
    await expect(card(page, 'Jan')).toBeVisible();   // Jan Fixture
    await expect(card(page, 'Petr')).toBeVisible();  // Petr Fixture

    // The original tree is still there with its person intact.
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: originalTree }).first().click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(originalTree);
    await expect(card(page, 'Solo')).toBeVisible();
    await expect.poll(() => personCount(page)).toBe(1);
});

test('GEDCOM export and re-import through the UI preserves names and relations', async ({ page }) => {
    await openApp(page);
    await buildFamily(page);

    // Export as GEDCOM (passwordless dialog).
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    // Keep full names (persons without a birth date default to "living").
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [gedDownload] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const gedPath = await gedDownload.path();
    const ged = readFileSync(gedPath, 'utf-8');
    expect(ged).toContain('0 @I1@ INDI');
    expect(ged).toContain('Jan /Novak/');

    // Import it back as a new tree.
    await page.locator('#gedcom-input').setInputFiles(gedPath);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(page.locator('#gedcom-stat-persons')).toHaveText('3');
    await result.locator('#gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.locator('#import-tree-name').fill('From GEDCOM');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();

    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Petr')).toBeVisible();
});

test('focus export writes only the focused branch, not other families', async ({ page }) => {
    await openApp(page);
    await buildFamily(page); // connected family: Jan + Marie + Petr

    // A second, unrelated family in the same tree (disconnected component).
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, 'Standalone', 'Other');
    expect(await personCount(page)).toBe(4);

    // Focus the first family; the unrelated person is not in the visible set.
    await cardAction(page, 'Jan', 'focus');
    await page.evaluate(() => window.Strom.UI.exportFocusedJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    const names = Object.values(data.persons).map((p: { firstName: string }) => p.firstName);
    expect(names).toContain('Jan');
    expect(names).not.toContain('Standalone');
    expect(Object.keys(data.persons).length).toBeLessThan(4);
});

test('invalid JSON import shows a readable error and keeps existing data', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#file-input').setInputFiles('e2e/fixtures/broken.json');
    const validation = page.locator('#validation-modal');
    await expect(validation).toBeVisible();
    // The app did not crash and the original person is still present.
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await personCount(page)).toBe(1);
});

test('garbage GEDCOM import does not crash the app', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/broken.ged');
    // A lenient parser yields an empty result dialog (0 persons) rather than an
    // error; either way the app stays alive and the existing tree is untouched.
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(page.locator('#gedcom-stat-persons')).toHaveText('0');
    await page.evaluate(() => window.Strom.UI.closeGedcomResultDialog());
    await expect(card(page, 'Jan')).toBeVisible();
    expect(await personCount(page)).toBe(1);
});

test('demo tree can be exported and re-imported with the same person count', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    const demoCount = await personCount(page);
    expect(demoCount).toBeGreaterThan(3);

    const jsonPath = await exportTreeJson(page);
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(Object.keys(data.persons)).toHaveLength(demoCount);

    await importJsonAsNewTree(page, jsonPath, 'Demo Copy');
    expect(await personCount(page)).toBe(demoCount);
});
