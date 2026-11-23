import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, createFirstPerson, mergeCompare, mergeCount, mergePair, mergePickValue, mergeSetScope, mergeToStep4, mergeWriteAndSwitch } from './helpers.js';

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

/**
 * The old import in the tree, the MyHeritage file merged in and compared;
 * Eva's different married surname shows in what speaks against her pair.
 */
async function mergeWithEva(page: Page): Promise<Locator> {
    await openApp(page);
    await createFirstPerson(page, 'Seed', 'Person');
    await page.evaluate((data) => {
        window.Strom.DataManager.loadStromData(data as never);
        window.Strom.TreeRenderer.render();
    }, oldImport());

    await page.evaluate(() => window.Strom.UI.startGedcomImportPlain());
    await page.locator('#gedcom-input').setInputFiles('e2e/fixtures/mh-marnm.ged');
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await expect(mergeCount(wizard, 'joined')).toHaveText('5');
    await expect(mergeCount(wizard, 'added')).toHaveText('0');

    // Eva's pair (joined, score 80+): what speaks against it.
    await mergePair(wizard, 'Eva', 'same');
    await expect(wizard.locator('#merge-pair .merge-why-no')).toContainText('Married surname: Procházková → Svobodová');
    return wizard;
}

test('merging a MyHeritage file fills the married surnames, asks about a different one and adds no one', async ({ page }) => {
    const wizard = await mergeWithEva(page);
    // Scope b): what the tree lacks is filled, a different value stays the tree's.
    await mergeSetScope(page, 'b');
    await mergeWriteAndSwitch(page, wizard);
    const persons = await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        return Object.values((await TM.getTreeData(TM.getActiveTreeId()!))!.persons);
    }) as P[];
    const one = (first: string) => persons.find(p => p.firstName === first)!;
    expect(persons.map(p => p.firstName).sort()).toEqual(['Eva', 'Jan', 'Karel', 'Marie', 'Petr']);
    expect(one('Marie').marriedSurname).toBe('Nováková');
    expect(one('Marie').lastName).toBe('Dvořáková');
    expect(one('Eva').marriedSurname).toBe('Procházková');
    expect(one('Eva').lastName).toBe('Nováková');
    expect(one('Jan').marriedSurname).toBeUndefined();
    expect(one('Jan').lastName).toBe('Novák');
});

test('merging a MyHeritage file: the different married surname chosen in step 4 wins, the old one kept as a variant', async ({ page }) => {
    const wizard = await mergeWithEva(page);
    await mergeSetScope(page, 'c');
    // Step 4 (Who is right): the whole merge keeps the tree's values; Eva's married surname from the import.
    await mergeToStep4(wizard);
    await mergePickValue(wizard, 'eva', 'marriedSurname', 'import');
    await expect(wizard.locator('.merge-s4-row[data-person="eva"][data-field="marriedSurname"] .merge-s4-res-v')).toHaveText('Svobodová');
    await mergeWriteAndSwitch(page, wizard);
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
