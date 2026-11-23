import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, mergeCompare, mergeCount, mergePair, mergeRow } from './helpers.js';

/**
 * A person of unknown given name in a merge (spec 010, K1.2): MyHeritage
 * writes a wife known only by her surname as "1 NAME /Nováková/". Merging
 * such a file into a tree that already holds her pairs her through her matched
 * husband — as a match for review, never confirmed by itself — and nobody is
 * added twice once it is confirmed: the file then holds only the tree's
 * people and the guide writes nothing (13b).
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
    const result = page.locator('#merge-modal');
    await expect(result).toBeVisible();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await expect(mergeCount(wizard, 'joined')).toHaveText('2');
    // The offered wife is left to decide: nobody is added, and the write waits for her.
    await expect(mergeCount(wizard, 'pending')).toHaveText('1');
    await expect(mergeCount(wizard, 'added')).toHaveText('0');
    await expect(wizard.locator('#merge-next')).toBeDisabled();
    await expect(wizard.locator('#merge-next-why')).toHaveText('1 pair left to decide');

    // Her pair stands among Maybe the same (score below 80), "? Nováková" with no given name.
    const wifeRow = await mergePair(wizard, 'Nováková', 'maybe');
    await expect(mergeRow(wizard, 'Nováková')).toHaveCount(1);
    await expect(wifeRow).toHaveAttribute('data-fate', 'pending');
    const score = Number((await wifeRow.locator('.merge-item-score').textContent())?.replace(/\D/g, ''));
    expect(score).toBeLessThan(80);
    await expect(wizard.locator('#merge-pair .merge-why')).toContainText('Unknown given name – matched through a relative');
    await expect(wizard.locator('#merge-pair .pair')).toContainText('no name');

    await wizard.locator('#merge-pair .merge-dec[data-dec="same"]').click();
    await expect(wifeRow).toHaveAttribute('data-fate', 'joined');
    await expect(mergeCount(wizard, 'joined')).toHaveText('3');
    await expect(mergeCount(wizard, 'pending')).toHaveText('0');
    await expect(mergeCount(wizard, 'added')).toHaveText('0');

    // Her join decided the last pair: the list stays where it was worked in.
    await expect(mergeRow(wizard, 'Nováková')).toHaveCount(1);

    // Everyone joined, nothing new in scope a): a sentence over the list says so, the primary only closes.
    const treesBefore = await page.evaluate(() => window.Strom.TreeManager.getTrees().length);
    await expect(wizard.locator('.merge-s2-copy-note')).toHaveText(/^All 3 people are already in the tree .+ and bring nothing new\.$/);
    await expect(wizard.locator('#merge-next')).toHaveText('Close');
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().length)).toBe(treesBefore);
    const persons = await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        return Object.values((await TM.getTreeData(TM.getActiveTreeId()!))!.persons);
    }) as P[];
    expect(persons.map(p => p.id).sort()).toEqual(['jan', 'karel', 'wife']);
});
