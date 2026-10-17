import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The surname after marriage brought into an existing tree by merging a
 * MyHeritage file (spec 010, K1.2): a tree imported before _MARNM was read
 * gets the married surnames from Import GEDCOM → Merge with existing, a
 * different one already there is a conflict of the wizard, and nothing else
 * changes: no new persons, the birth surnames stay.
 */

type P = {
    id: string; firstName: string; lastName: string; gender: 'male' | 'female'; birthDate: string;
    marriedSurname?: string; nameVariants?: string[];
    partnerships?: string[]; parentIds?: string[]; childIds?: string[];
};

/** The tree e2e/fixtures/mh-marnm.ged gave before _MARNM was read; Eva has another married surname. */
function oldImport() {
    const persons: P[] = [
        { id: 'jan', firstName: 'Jan', lastName: 'Novák', gender: 'male', birthDate: '1901-03-03', partnerships: ['u1'], childIds: ['eva', 'karel'] },
        { id: 'marie', firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', birthDate: '1904-06-12', partnerships: ['u1'], childIds: ['eva', 'karel'] },
        { id: 'eva', firstName: 'Eva', lastName: 'Nováková', gender: 'female', birthDate: '1930-01-07', marriedSurname: 'Procházková', parentIds: ['jan', 'marie'], partnerships: ['u2'] },
        { id: 'petr', firstName: 'Petr', lastName: 'Svoboda', gender: 'male', birthDate: '1928-08-20', partnerships: ['u2'] },
        { id: 'karel', firstName: 'Karel', lastName: 'Novák', gender: 'male', birthDate: '1933-05-15', parentIds: ['jan', 'marie'] },
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...p }])),
        partnerships: {
            u1: { id: 'u1', person1Id: 'jan', person2Id: 'marie', status: 'married', startDate: '1928', childIds: ['eva', 'karel'] },
            u2: { id: 'u2', person1Id: 'petr', person2Id: 'eva', status: 'married', startDate: '1952', childIds: [] },
        },
    };
}

test('merging a MyHeritage file fills the married surnames, asks about a different one and adds no one', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.evaluate((data) => {
        window.Strom.DataManager.loadStromData(data as never);
        window.Strom.TreeRenderer.render();
    }, oldImport());

    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-marnm.ged');
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    await result.locator('#gedcom-merge-btn').click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('#merge-stat-matches')).toHaveText('5');
    await expect(wizard.locator('#merge-stat-new')).toHaveText('0');
    await expect(wizard.locator('#merge-stat-conflicts')).toHaveText('1');

    await wizard.locator('.merge-tab[data-filter="conflicts"]').click();
    const evaRow = wizard.locator('#merge-match-list .merge-item').filter({ hasText: 'Eva' });
    await expect(evaRow.locator('.merge-item-conflicts')).toContainText('Married surname: Procházková → Svobodová');
    await evaRow.locator('.merge-btn-resolve').click();
    const dialog = page.locator('#merge-conflict-dialog');
    await expect(dialog).toHaveClass(/active/);
    const married = dialog.locator('.conflict-row[data-field="marriedSurname"]');
    await expect(married).toContainText('Married surname');
    await expect(married.locator('input[value="keep_existing"]')).toBeChecked();
    await married.locator('.conflict-option', { hasText: 'Svobodová' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toHaveClass(/active/);

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
    // The merged tree's data, read from the store: the switch loads it asynchronously.
    const persons = await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        return Object.values((await TM.getTreeData(TM.getActiveTreeId()!))!.persons);
    }) as P[];
    const one = (first: string) => persons.find(p => p.firstName === first)!;
    expect(persons.map(p => p.firstName).sort()).toEqual(['Eva', 'Jan', 'Karel', 'Marie', 'Petr']);
    expect(one('Marie').marriedSurname).toBe('Nováková');
    expect(one('Marie').lastName).toBe('Dvořáková');
    expect(one('Eva').marriedSurname).toBe('Svobodová');
    expect(one('Eva').lastName).toBe('Nováková');
    expect(one('Eva').nameVariants).toEqual(['Procházková']);
    expect(one('Jan').marriedSurname).toBeUndefined();
    expect(one('Jan').lastName).toBe('Novák');
});
