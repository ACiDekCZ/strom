import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeDone, mergeSetScope, mergeToStep4, mergeToStep5, mergeWrite } from './helpers.js';

/**
 * Rules saved for a program (spec 134 K10.4): step 5 remembers the scope and
 * who is right for files from the program the file names (`1 SOUR FICTIVE`);
 * the next file of that program starts step 1 filled in (and step 4's rule),
 * Settings lists the rule and removes it; afterwards nothing is filled in.
 * A tree of the invented Modřín family, a file of the invented Jilm family.
 */

const GED = 'e2e/fixtures/rodokmen-jilmovi.ged';

/** A fresh copy of Modřínovi open, the file in the guide on step 1. */
async function openGuide(page: Page, name: string): Promise<Locator> {
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', name);
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    return wizard;
}

const scopeInput = (wizard: Locator, s: string): Locator => wizard.locator(`.merge-s1-scope[data-scope="${s}"] input`);

test('remembered in step 5 for files from FICTIVE: the next file starts with its scope and rule, Settings removes it', async ({ page }) => {
    await openApp(page);
    let wizard = await openGuide(page, 'Modřínovi');
    // Nothing saved yet: scope a), no note.
    await expect(scopeInput(wizard, 'a')).toBeChecked();
    await expect(wizard.locator('.merge-s1-prefilled')).toHaveCount(0);

    // Scope c), the import wins, remembered in step 5 and written.
    await mergeSetScope(page, 'c');
    await mergeCompare(wizard);
    await mergeToStep4(wizard);
    await wizard.locator('.merge-s4-tile[data-rule="import"]').click();
    await expect(wizard.locator('.merge-s4-tile[data-rule="import"]')).toHaveAttribute('aria-checked', 'true');
    await mergeToStep5(wizard);
    const remember = wizard.locator('.merge-s5-remember');
    await expect(remember).toBeVisible();
    await expect(remember.locator('label')).toHaveText('Remember for files from FICTIVE: scope c), The import wins');
    await expect(remember.locator('.merge-s5-note')).toHaveText('Next time step 1 is filled in with it (can be changed). Saved rules are in Settings → Data and privacy.');
    await remember.locator('input').check();
    // Not saved before the guide writes.
    expect(await page.evaluate(() => window.Strom.SettingsManager.getMergeRules().length)).toBe(0);
    await mergeWrite(wizard, 'tree');
    await mergeDone(wizard);
    expect(await page.evaluate(() => window.Strom.SettingsManager.getMergeRule('fictive'))).toMatchObject({ program: 'FICTIVE', scope: 'c', rules: { all: 'import' } });

    // The next file of the program: step 1 filled in (can be changed), step 4's rule too.
    wizard = await openGuide(page, 'Modřínovi B');
    await expect(scopeInput(wizard, 'c')).toBeChecked();
    await expect(wizard.locator('.merge-s1-prefilled')).toHaveText('Filled in from the rule saved for files from FICTIVE (can be changed).');
    await mergeCompare(wizard);
    await mergeToStep4(wizard);
    await expect(wizard.locator('.merge-s4-tile[data-rule="import"]')).toHaveAttribute('aria-checked', 'true');
    // Unticked: nothing is saved again.
    await mergeToStep5(wizard);
    await expect(wizard.locator('.merge-s5-remember input')).not.toBeChecked();
    await page.keyboard.press('Escape');
    await page.locator('#merge-close-confirm').getByRole('button', { name: 'Discard changes' }).click();
    await expect(wizard).toBeHidden();

    // Settings › Data and privacy: the rule, Remove.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const row = page.locator('#merge-rules-row');
    await expect(row).toBeVisible();
    const item = row.locator('.merge-rules-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.merge-rules-program')).toHaveText('FICTIVE');
    await expect(item.locator('.merge-rules-detail')).toHaveText('scope c) Decide detail by detail · The import wins');
    await item.getByRole('button', { name: 'Remove the rule for files from FICTIVE' }).click();
    await expect(row).toBeHidden();
    expect(await page.evaluate(() => window.Strom.SettingsManager.getMergeRules().length)).toBe(0);
    await page.evaluate(() => window.Strom.UI.closeSettingsDialog());

    // Afterwards nothing is filled in.
    wizard = await openGuide(page, 'Modřínovi C');
    await expect(scopeInput(wizard, 'a')).toBeChecked();
    await expect(wizard.locator('.merge-s1-prefilled')).toHaveCount(0);
});
