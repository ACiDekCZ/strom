import { test, expect, Page } from '@playwright/test';
import { openApp, card, cardAction } from './helpers.js';

/**
 * The research's status of a fact (`2 _STROM_STATUS`) as a small label beside
 * the fact: the birth, the death and events in the person editor, the wedding
 * and the divorce and the couple's events in the relationships panel. A value
 * the app does not know shows nothing. Invented data.
 */

function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1862', '2 PLAC Dolní Lhota', '2 _STROM_STATUS lead',
        '1 OCCU rolník', '2 _STROM_STATUS probable',
        '1 DEAT', '2 DATE 1919', '2 _STROM_STATUS proven',
        '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F',
        '1 BIRT', '2 DATE 1869', '2 _STROM_STATUS certain', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 14 FEB 1888', '2 PLAC Dolní Lhota', '2 _STROM_STATUS possible',
        '1 MARB', '2 DATE 22 JAN 1888', '2 _STROM_STATUS proven',
        '0 TRLR',
    ].join('\n');
}

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'vlkovi.ged', { type: 'text/plain' }));
        return dt;
    }, ged());
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

async function openPanel(page: Page, first: string): Promise<void> {
    const id = await page.evaluate((first) =>
        window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === first)!.id, first);
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), id);
    await expect(page.locator('#relationships-modal')).toBeVisible();
}

test.describe('the research\'s status of a fact', () => {
    test('the person editor labels the birth, an event and the death', async ({ page }) => {
        await setup(page);
        await cardAction(page, 'Jan', 'edit');
        const rows = page.locator('#events-list .event-row');
        await expect(rows.filter({ hasText: 'Birth' }).locator('.fact-status')).toHaveText('Lead');
        await expect(rows.filter({ hasText: 'Occupation' }).locator('.fact-status')).toHaveText('Probable');
        await expect(rows.filter({ hasText: 'Death' }).locator('.fact-status')).toHaveText('Proven');
        await expect(rows.filter({ hasText: 'Birth' }).locator('.fact-status')).toHaveAttribute('title', /as the research holds this fact/);
    });

    test('a value the app does not know shows no label', async ({ page }) => {
        await setup(page);
        await cardAction(page, 'Marie', 'edit');
        await expect(page.locator('#events-list .event-row').filter({ hasText: 'Birth' })).toBeVisible();
        await expect(page.locator('#events-list .fact-status')).toHaveCount(0);
    });

    test('the relationships panel labels the wedding and the couple\'s event', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Jan');
        const modal = page.locator('#relationships-modal');
        await expect(modal.locator('.pg-label-start .fact-status')).toHaveText('Possible');
        await expect(modal.locator('.couple-event-row .fact-status')).toHaveText('Proven');
    });

    for (const [name, width, height] of [['phone', 390, 844], ['tablet', 768, 1024]] as const) {
        test(`the wedding's label fits on a ${name}`, async ({ page }) => {
            await setup(page, width, height);
            await openPanel(page, 'Jan');
            const label = page.locator('#relationships-modal .pg-label-start .fact-status');
            await expect(label).toBeVisible();
            const box = (await label.boundingBox())!;
            expect(box.x + box.width).toBeLessThanOrEqual(width);
        });
    }
});
