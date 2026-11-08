import { test, expect } from '@playwright/test';
import { join } from 'path';
import { openApp, createFirstPerson, waitForPersist } from './helpers.js';

/**
 * GEDCOM files from Czech and Polish Windows programs ("1 CHAR ANSI" in
 * Windows-1250): the import summary reads them with the right letters, says
 * how the encoding was settled, shows a sample of names and lets another
 * encoding re-read the file. Fixtures: test/gedcom-encoding/ (fictional names).
 */

const fixture = (name: string): string => join(process.cwd(), 'test', 'gedcom-encoding', name);

test('ANSI file in Windows-1250: right names, sample, and another encoding re-reads it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await waitForPersist(page, 'Seed');

    await page.locator('#gedcom-input').setInputFiles(fixture('ansi-czech.ged'));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    const row = result.locator('#gedcom-encoding-row');
    await expect(row).toBeVisible();
    const select = row.locator('#gedcom-encoding-select');
    await expect(select).toHaveValue('windows-1250');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Vojtěch Dvořák');
    await expect(row.locator('#gedcom-encoding-how')).toContainText('ANSI');

    // Western page: the same bytes turn into è/ø — visible in the sample.
    await select.selectOption('windows-1252');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Vojtìch Dvoøák');
    await expect(select).toHaveValue('windows-1252');
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('5');

    // Back to Central Europe and into a new tree: the stored names are right.
    await select.selectOption('windows-1250');
    await expect(row.locator('#gedcom-encoding-names')).toContainText('Řehoř Kučera');
    await result.locator('#gedcom-new-tree-btn').click();
    const confirm = page.locator('#import-tree-modal');
    await expect(confirm).toBeVisible();
    await confirm.locator('button.primary').first().click();
    await expect.poll(() => page.evaluate(async () => {
        const out: string[] = [];
        for (const t of window.Strom.TreeManager.getTrees()) {
            const data = await window.Strom.TreeManager.getTreeData(t.id);
            for (const p of Object.values(data?.persons ?? {}) as Array<{ firstName: string; lastName: string }>) {
                out.push(`${p.firstName} ${p.lastName}`);
            }
        }
        return out.sort();
    })).toEqual(['Ludmila Šťastná', 'Matěj Vlček', 'Seed Person', 'Vojtěch Dvořák', 'Zdeňka Pokorná', 'Řehoř Kučera'].sort());
});

test('a UTF-8 file has no encoding row', async ({ page }) => {
    await openApp(page);
    await page.locator('#gedcom-input').setInputFiles(fixture('ansi-utf8-czech.ged'));
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await expect(result.locator('#gedcom-stat-persons')).toHaveText('5');
    await expect(result.locator('#gedcom-encoding-row')).toBeHidden();
});
