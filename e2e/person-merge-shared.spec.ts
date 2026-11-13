import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The person merge of two records with shared events (spec 085 §7, 7a):
 * a census both are in is listed once with the choice of the age, a
 * residence one is in while the other has the same one of its own offers
 * to join it (ticked). Invented data.
 */

const census = { type: 'census', date: '1921-02-15', place: 'Kozinec', shareId: 'SHC1921' };
const residence = { type: 'residence', date: '1925', place: 'Kozinec', shareId: 'SHR1925' };

function treeJson() {
    const person = (id: string, firstName: string, gender: 'male' | 'female', events: object[], extra: object = {}) =>
        ({ id, firstName, lastName: gender === 'male' ? 'Křepelák' : 'Křepeláková', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], events, ...extra });
    return {
        version: 20,
        persons: {
            p_dobromil: person('p_dobromil', 'Dobromil', 'male', [
                { id: 'c_d', ...census, age: '40' },
                { id: 'r_own', type: 'residence', date: '1925', place: 'Kozinec', sourceIds: ['s2'] },
            ], { birthDate: '1881-03-02' }),
            p_dobrek: person('p_dobrek', 'Dobrek', 'male', [
                { id: 'c_k', ...census, age: '41' },
                { id: 'r_k', ...residence },
            ], { birthDate: '1881-03-02' }),
            p_zdeslava: person('p_zdeslava', 'Zdeslava', 'female', [
                { id: 'c_z', ...census, age: '36' },
                { id: 'r_z', ...residence },
            ], { birthDate: '1885-07-19' }),
        },
        partnerships: {},
        sources: { s2: { id: 's2', title: 'Domovská matrika Kozinec' } },
    };
}

async function importTree(page: Page, fileName = 'krepelak.json'): Promise<void> {
    await page.locator('#file-input').setInputFiles({
        name: fileName, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(treeJson())),
    });
    const importDialog = page.locator('#import-tree-modal');
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Import' }).click();
    await expect(importDialog).toBeHidden();
}

async function openMerge(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showPersonMergeDialog('p_dobromil', 'p_dobrek'));
    const modal = page.locator('#person-merge-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#person-merge-other')).toContainText('Dobrek');
    return modal;
}

test('person merge with shared events: the census once with the age to choose, the own residence joining the shared one', async ({ page }) => {
    await openApp(page);
    await importTree(page);
    const modal = await openMerge(page);

    const shared = modal.locator('#person-merge-shared');
    await expect(shared).toBeVisible();
    await expect(shared.locator('h3')).toHaveText('Shared events after the merge');
    const rows = shared.locator('.person-merge-shared-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Census');
    await expect(rows.nth(0)).toContainText('Once – both are in it.');
    await expect(rows.nth(0).locator('.person-merge-shared-note .shared-event-mark')).toHaveCount(1);
    await expect(rows.nth(1)).toContainText('Residence');
    await expect(rows.nth(1)).toContainText('Attach to the shared event (2 people) – the own copy matches');
    await expect(rows.nth(1).locator('input[type="checkbox"]')).toBeChecked();
    // The ages differ: a choice, so not "no conflicts".
    await expect(modal.locator('#person-merge-no-conflicts')).toBeHidden();
    await rows.nth(0).locator('.person-merge-conflict-option[data-value="other"]').click();
    await expect(rows.nth(0).locator('.person-merge-conflict-option[data-value="other"]')).toHaveClass(/selected/);

    await modal.locator('#person-merge-btn').click();
    await expect(modal).toBeHidden();

    const after = await page.evaluate(() => {
        const d = window.Strom.DataManager.getData();
        return {
            gone: !d.persons['p_dobrek'],
            dobromil: d.persons['p_dobromil'].events,
            zdeslava: d.persons['p_zdeslava'].events,
        };
    }) as { gone: boolean; dobromil: { id: string; type: string; shareId?: string; age?: string; sourceIds?: string[] }[]; zdeslava: { type: string; sourceIds?: string[] }[] };
    expect(after.gone).toBe(true);
    const censuses = after.dobromil.filter(e => e.type === 'census');
    expect(censuses).toEqual([expect.objectContaining({ id: 'c_d', shareId: 'SHC1921', age: '41' })]);
    const residences = after.dobromil.filter(e => e.type === 'residence');
    expect(residences).toEqual([expect.objectContaining({ id: 'r_k', shareId: 'SHR1925' })]);
    // The own record's source reached the shared residence of both.
    expect(residences[0].sourceIds).toEqual(['s2']);
    expect(after.zdeslava.find(e => e.type === 'residence')!.sourceIds).toEqual(['s2']);
});

test('person merge: an unticked own residence stays an own event beside the shared one', async ({ page }) => {
    await openApp(page);
    await importTree(page);
    const modal = await openMerge(page);
    const attach = modal.locator('#person-merge-shared .person-merge-shared-check input');
    await attach.uncheck();
    await expect(attach).not.toBeChecked();
    await modal.locator('#person-merge-btn').click();
    await expect(modal).toBeHidden();
    const residences = await page.evaluate(() =>
        window.Strom.DataManager.getData().persons['p_dobromil'].events!.filter((e: { type: string }) => e.type === 'residence')
            .map((e: { id: string; shareId?: string }) => [e.id, e.shareId ?? null]));
    expect(residences).toEqual([['r_own', null], ['r_k', 'SHR1925']]);
});
