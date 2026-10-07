import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The person card's life timeline after the 3.10 tester round: a divorce as
 * its own row, the children's events behind the head's chip (T15). Invented
 * data.
 */

function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1841', '2 PLAC Bystřice', '1 DEAT', '2 DATE 1922', '2 PLAC Bystřice', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Anna /Králová/', '1 SEX F', '1 BIRT', '2 DATE 1845', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Marie /Vlková/', '1 SEX F', '1 BIRT', '2 DATE 1867', '1 FAMC @F1@', '1 FAMS @F2@',
        '0 @I4@ INDI', '1 NAME Václav /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1870',
        '1 DEAT', '2 DATE 1894', '2 PLAC Bystřice', '1 BURI', '2 DATE 1894', '2 PLAC Bystřice', '1 FAMC @F1@',
        '0 @I5@ INDI', '1 NAME Karel /Malý/', '1 SEX M', '1 FAMS @F2@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@',
        '1 MARR', '2 DATE 1866', '2 PLAC Dolní Lhota', '1 DIV', '2 DATE 1898',
        '0 @F2@ FAM', '1 HUSB @I5@', '1 WIFE @I3@', '1 MARR', '2 DATE 1889', '2 PLAC Praha', '1 DIV', '2 DATE 1912',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'vlkovi.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

async function setup(page: Page, width = 1440, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await dropFile(page, ged());
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === first)!.id, first);

async function openCard(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#pm-lifeline-section')).toBeVisible();
}

const rows = (page: Page) => page.locator('#pm-lifeline-body .pm-lifeline-row');

test.describe('T15: divorce and the children\'s events in the life timeline', () => {
    test('a divorce is its own row; the children\'s events wait behind the chip, which is remembered', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Jan');
        await expect(rows(page).filter({ hasText: 'Divorced Anna Králová' })).toHaveCount(1);
        await expect(rows(page).filter({ hasText: 'Divorced Anna Králová' }).locator('.pm-lifeline-year')).toHaveText('1898');

        const chip = page.locator('#pm-lifeline-child-toggle');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText("Children's events");
        await expect(chip).toHaveAttribute('role', 'switch');
        await expect(chip).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent')).toHaveCount(0);

        // The chip does not fold the section, and adds indented rows.
        await chip.click();
        await expect(page.locator('#pm-lifeline-section')).not.toHaveClass(/collapsed/);
        await expect(chip).toHaveAttribute('aria-checked', 'true');
        const child = page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent');
        await expect(child.locator('.pm-lifeline-desc')).toHaveText([
            'Marie Vlková: marriage · Praha',
            'Václav Vlk: death · Bystřice',
            'Václav Vlk: burial · Bystřice',
            'Marie Vlková: divorce',
        ]);
        const own = await rows(page).first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        const indented = await child.first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        expect(indented - own).toBe(16);

        // One choice for everybody, kept over a reload.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await openCard(page, 'Anna');
        await expect(page.locator('#pm-lifeline-child-toggle')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#pm-lifeline-body .pm-lifeline-row.k-childEvent')).toHaveCount(4);
    });

    test('no chip without any child event', async ({ page }) => {
        await setup(page);
        await openCard(page, 'Marie');
        await expect(rows(page).filter({ hasText: 'Divorced Karel Malý' })).toHaveCount(1);
        await expect(page.locator('#pm-lifeline-child-toggle')).toBeHidden();
    });

    test('phone: the chip stays on the head row, 32 px high', async ({ page }) => {
        await setup(page, 360, 740);
        await openCard(page, 'Jan');
        const chip = page.locator('#pm-lifeline-child-toggle');
        await expect(chip).toBeVisible();
        const head = await page.locator('#pm-lifeline-head .pm-section-title').boundingBox();
        const box = await chip.boundingBox();
        expect(box!.height).toBe(32);
        // Same row: the chip's vertical middle within the title's line.
        expect(Math.abs((box!.y + box!.height / 2) - (head!.y + head!.height / 2))).toBeLessThan(4);
        expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    });
});
