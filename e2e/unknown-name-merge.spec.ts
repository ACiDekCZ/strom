import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * A person of unknown given name in a merge (spec 010, K1.2): MyHeritage
 * writes a wife known only by her surname as "1 NAME /Nováková/". Merging
 * such a file into a tree that already holds her pairs her through her matched
 * husband — as a match for review, never confirmed by itself — and nobody is
 * added twice once it is confirmed.
 */

type P = {
    id: string; firstName: string; lastName: string; gender: 'male' | 'female'; birthDate?: string;
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};

/** The tree e2e/fixtures/mh-unknown-name.ged gave on an earlier import. */
function earlierImport() {
    const persons: P[] = [
        { id: 'jan', firstName: 'Jan', lastName: 'Novák', gender: 'male', birthDate: '1901-03-03', partnerships: ['u1'], childIds: ['karel'] },
        { id: 'wife', firstName: '?', lastName: 'Nováková', gender: 'female', partnerships: ['u1'], childIds: ['karel'] },
        { id: 'karel', firstName: 'Karel', lastName: 'Novák', gender: 'male', birthDate: '1933-05-15', parentIds: ['jan', 'wife'] },
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p }])),
        partnerships: {
            u1: { id: 'u1', person1Id: 'jan', person2Id: 'wife', status: 'married', startDate: '1928', childIds: ['karel'] },
        },
    };
}

test('a wife of unknown given name pairs through her matched husband, for review', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.evaluate((data) => {
        window.Strom.DataManager.loadStromData(data as never);
        window.Strom.TreeRenderer.render();
    }, earlierImport());

    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-unknown-name.ged');
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-merge-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('3');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('0');

    const wifeRow = wizard.locator('#merge-match-list .merge-item').filter({ hasText: 'Nováková' });
    await expect(wifeRow).toHaveCount(1);
    await expect(wifeRow).toHaveClass(/pending/);
    await expect(wifeRow.locator('.merge-item-score')).toContainText('Medium');
    await expect(wifeRow.locator('.merge-item-reasons')).toContainText('Unknown given name – matched through a relative');
    await expect(wizard.locator('#merge-match-list .merge-item.confirmed')).toHaveCount(2);

    await wifeRow.locator('.merge-btn-confirm').click();
    await expect(wizard.locator('#merge-match-list .merge-item.confirmed')).toHaveCount(3);

    await wizard.locator('.merge-actions .primary').click();
    const prompt = page.locator('#confirmation-modal.active.dialog-prompt');
    await expect(prompt).toBeVisible();
    await prompt.locator('#prompt-input').fill('Merged');
    await prompt.locator('#confirm-ok-btn').click();
    await expect(page.locator('#confirm-title')).toHaveText('Merge complete');
    await page.locator('#confirmation-modal.active #confirm-ok-btn').click();
    await expect.poll(() => page.evaluate(() =>
        window.Strom.TreeManager.getTrees().find((t: { name: string }) => t.name === 'Merged')?.id
        === window.Strom.TreeManager.getActiveTreeId())).toBe(true);
    const persons = await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        return Object.values((await TM.getTreeData(TM.getActiveTreeId()!))!.persons);
    }) as P[];
    expect(persons.map(p => p.id).sort()).toEqual(['jan', 'karel', 'wife']);
});
