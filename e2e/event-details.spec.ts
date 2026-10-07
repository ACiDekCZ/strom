import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Cause, age as recorded and house at an event (person dialog, event editor,
 * relationships panel), shown when filled and otherwise behind one quiet link;
 * the "Custom" card density with its lines; the tooltip, the life timeline and
 * the search reading the new details. Invented data.
 */

function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M',
        '1 BIRT', '2 DATE 1862', '2 PLAC Horní Lhota',
        '1 DEAT', '2 DATE 12 MAR 1919', '2 PLAC Horní Lhota', '2 AGE 54y',
        '1 OCCU mlynář', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F',
        '1 BAPM', '2 DATE 2 FEB 1869', '2 PLAC Dolní Lhota',
        '1 DEAT', '2 DATE Po 1919', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Anna /Vlková/', '1 SEX F', '1 BIRT', '2 DATE 1890',
        '1 DEAT', '2 DATE 1912', '2 PLAC Horní Lhota', '2 CAUS cholera', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
        '1 MARR', '2 DATE 14 FEB 1888', '2 PLAC Dolní Lhota',
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

async function setup(page: Page, width = 1440): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await dropFile(page, ged());
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

const idOf = (page: Page, first: string) => page.evaluate((first) =>
    window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === first)!.id, first);

async function editPerson(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), id);
    await expect(page.locator('#person-modal')).toBeVisible();
}

const field = (page: Page, group: string, key: string) =>
    page.locator(`#${group} .detail-field[data-detail="${key}"]`);

test.describe('event details', () => {
    test('person dialog: a filled age shows with its check, the rest behind the link', async ({ page }) => {
        await setup(page);
        await editPerson(page, 'Jan');
        const more = page.locator('#death-details .detail-more');
        await expect(field(page, 'death-details', 'age')).toBeVisible();
        await expect(page.locator('#input-death-age')).toHaveValue('54 years');
        await expect(page.locator('#death-age-check')).toHaveText('Differs from calculation (56–57 years) by 2 years');
        await expect(page.locator('#death-age-check')).toHaveClass(/age-check--warn/);
        await expect(field(page, 'death-details', 'cause')).toBeHidden();
        await expect(more).toHaveText('+ cause, address');
        await expect(page.locator('#birth-details .detail-more')).toHaveText('+ address');

        await page.locator('#input-death-age').fill('infant');
        await expect(page.locator('#death-age-check')).toHaveText('Calculated 56–57 years');
        await expect(page.locator('#death-age-check')).not.toHaveClass(/age-check--warn/);

        await more.click();
        await expect(field(page, 'death-details', 'cause')).toBeVisible();
        await expect(field(page, 'death-details', 'address')).toBeVisible();
        await expect(page.locator('#input-death-cause')).toBeFocused();
        await expect(more).toBeHidden();
        await page.locator('#input-death-cause').fill('souchotiny');
        await page.locator('#btn-save').click();
        await expect(page.locator('#person-modal')).toBeHidden();

        const jan = await page.evaluate((id) => window.Strom.DataManager.getPerson(id), await idOf(page, 'Jan'));
        expect(jan).toMatchObject({ deathCause: 'souchotiny', deathAge: 'infant' });
        expect(jan.deathAddress).toBeUndefined();

        // Reopened: the address stayed empty, so it is behind the link again.
        await editPerson(page, 'Jan');
        await expect(field(page, 'death-details', 'cause')).toBeVisible();
        await expect(field(page, 'death-details', 'address')).toBeHidden();
        await expect(page.locator('#death-details .detail-more')).toHaveText('+ address');
    });

    test('person dialog: nothing filled, one quiet link — whatever the advanced setting', async ({ page }) => {
        await setup(page);
        for (const advanced of [false, true]) {
            await page.evaluate((on) => window.Strom.UI.toggleAdvancedFields(on), advanced);
            await editPerson(page, 'Marie');
            await expect(page.locator('#death-details .detail-more')).toHaveText('+ cause, age, address');
            await expect(page.locator('#death-details .detail-field:visible')).toHaveCount(0);
            await page.keyboard.press('Escape');
            await expect(page.locator('#person-modal')).toBeHidden();
        }
    });

    test('event editor: fields by type, a filled one survives a change of type', async ({ page }) => {
        await setup(page);
        await editPerson(page, 'Marie');
        await page.locator('#events-list .event-edit-btn').first().click();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toBeVisible();
        // A baptism offers only the house.
        await expect(editor.locator('.detail-more')).toHaveText('+ address');
        await editor.locator('#input-event-type').selectOption('custom');
        await editor.locator('#input-event-custom-label').fill('Rychtářka');
        await expect(editor.locator('.detail-more')).toHaveText('+ cause, age, address');
        await editor.locator('.detail-more').click();
        await expect(editor.locator('#event-cause-label')).toHaveText('Cause');
        await editor.locator('#input-event-cause').fill('požár');
        await editor.locator('#input-event-type').selectOption('burial');
        // The cause is filled, so it stays; a burial offers the age.
        await expect(editor.locator('.detail-field[data-detail="cause"]')).toBeVisible();
        await expect(editor.locator('.detail-field[data-detail="age"]')).toBeVisible();
        // The house is neither filled nor a burial's: it goes back behind the link.
        await expect(editor.locator('.detail-field[data-detail="address"]')).toBeHidden();
        await editor.locator('#input-event-age').fill('19 years');
        await editor.locator('button.primary').click();
        await expect(editor).toBeHidden();
        await expect(page.locator('#events-list .event-details-line').first()).toHaveText('požár · 19 years');
        // The life timeline says the age is the recorded one.
        await expect(page.locator('#pm-lifeline-body .event-details-line').first()).toHaveText('požár · recorded as 19 years');
    });

    test('relationships panel: a divorce with its place, the house and both ages', async ({ page }) => {
        await setup(page);
        const jan = await idOf(page, 'Jan');
        const marie = await idOf(page, 'Marie');
        await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), jan);
        const grid = page.locator('#relationships-modal .partnership-grid');
        await expect(grid.locator('.pg-label-start')).toHaveText('Marriage');
        await expect(grid.locator('.pg-end')).toBeHidden();
        await expect(grid.locator('.pg-add-end')).toHaveText('+ divorce');
        await expect(grid.locator('.detail-more')).toHaveText('+ age, address');
        await page.locator('#relationships-modal .rel-status-select').selectOption('divorced');
        await expect(grid.locator('.pg-end')).toBeVisible();
        await grid.locator('.partnership-end-date').fill('1900');
        await grid.locator('.partnership-end-date').dispatchEvent('change');
        await grid.locator('.partnership-end-place').fill('Praha');
        await grid.locator('.detail-more').click();
        // The husband left, the wife right, each with the age the dates give.
        const ages = grid.locator('.partnership-age');
        await expect(ages.nth(0)).toBeFocused();
        await ages.nth(0).fill('24 years');
        await ages.nth(1).fill('19 years');
        await expect(grid.locator('.pg-age .age-check').nth(0)).toHaveText('Jan · Differs from calculation (25–26 years) by 1 year');
        await expect(grid.locator('.pg-age .age-check').nth(1)).toHaveText('Marie · calculated 19 years');
        await grid.locator('.partnership-address').fill('No. 7');
        await page.locator('#relationships-modal button.primary').click();
        const u = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().partnerships)[0]);
        expect(u).toMatchObject({ status: 'divorced', endDate: '1900', endPlace: 'Praha', address: 'No. 7', ages: { [jan]: '24 years', [marie]: '19 years' } });
    });

    test('tooltip: the cause on the death line, the recorded age only when it differs', async ({ page }) => {
        await setup(page);
        await expect(card(page, 'Anna').locator('.card-tooltip .tt-line').nth(1)).toHaveText(/^† .*Horní Lhota.* · cholera$/);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-warn')).toHaveText('recorded as 54 years');
        await expect(card(page, 'Anna').locator('.card-tooltip .tt-warn')).toHaveCount(0);
        // Marie: no birth, her baptism instead.
        await expect(card(page, 'Marie').locator('.card-tooltip .tt-line').first()).toHaveText('≈ baptized 2/2/1869, Dolní Lhota');
    });

    test('search finds a cause of death and says where it matched', async ({ page }) => {
        await setup(page);
        await page.locator('#toolbar-search-picker .person-picker-input').fill('cholera');
        const item = page.locator('#toolbar-search-picker .person-picker-item');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('Anna Vlková');
        await expect(item.locator('.person-picker-match')).toHaveText('† 1912 Horní Lhota · cholera');
        await expect(item.locator('mark')).toHaveText('cholera');
    });
});

async function openCardSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#settings-modal')).toBeVisible();
}

const lines = (page: Page, first: string) => card(page, first).locator('.card-line');

test.describe('the custom card', () => {
    test('first time: the Brief preset; each card as tall as its content; the baptism stands in', async ({ page }) => {
        await setup(page);
        await openCardSettings(page);
        await page.locator('#card-density-select').selectOption('custom');
        await expect(page.locator('#card-fields-settings')).toBeVisible();
        await expect(page.locator('#card-fields-settings input[type="checkbox"]:checked')).toHaveCount(3);
        // The default shows every detail whole (U02, the author's choice): 3px between
        // details, so three one-row details make 56 + 3 × 17 + 2 × 3.
        await expect(page.locator('.card-preview-size')).toHaveText('card 200 × 113 px');
        await expect(page.locator('.card-fields-status')).toHaveText('3 of 7 details on. A missing detail is left out.');
        await page.keyboard.press('Escape');

        await expect(lines(page, 'Jan')).toHaveText(['*1862 Horní Lhota', '†1919 Horní Lhota', 'mlynář']);
        await expect(lines(page, 'Marie')).toHaveText(['≈1869 Dolní Lhota', '†after 1919']);
        // The box itself, not as zoomed on screen: one width, each card as tall as its own
        // details (U02 V3, the default): Jan's three 113, the two of Marie and Anna 56 + 2 × 17 + 3.
        for (const [name, height] of [['Jan', 113], ['Marie', 93], ['Anna', 93]] as const) {
            const size = await card(page, name).evaluate(el => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
            expect(size, name).toEqual([200, height]);
        }
    });

    test('ticks, chips, order, full dates, and all seven details can be on', async ({ page }) => {
        await setup(page);
        await openCardSettings(page);
        await page.locator('#card-density-select').selectOption('custom');
        const host = page.locator('#card-fields-settings');
        // One row a detail and one height: the card is 56 + 17 a detail on, whoever is in the view.
        await host.locator('.card-look-lines').getByRole('button', { name: '1 line', exact: true }).click();
        await host.locator('.card-look-height').getByRole('button', { name: 'Equal', exact: true }).click();
        const row = (key: string) => host.locator(`.card-field-row[data-key="${key}"]`);
        // Baptism gets a line of its own: Marie's birth line no longer borrows it.
        await row('baptism').locator('input').check();
        await expect(row('birth').locator('[data-opt="baptism"]')).toHaveCount(0);
        await row('death').locator('[data-opt="cause"]').click();
        await host.locator('.card-fields-date [data-full="1"]').click();
        await row('marriage').locator('input').check();
        await expect(host.locator('.card-fields-status')).toHaveText('5 of 7 details on. A missing detail is left out.');
        // No limit (U02): nothing waits greyed, the sixth and the seventh go on too and the card grows for them.
        await expect(host.locator('.card-field-row.is-disabled, input[type="checkbox"]:disabled')).toHaveCount(0);
        await row('divorce').locator('input').check();
        await row('burial').locator('input').check();
        await expect(host.locator('input[type="checkbox"]:checked')).toHaveCount(7);
        await expect(host.locator('.card-fields-status')).toHaveText('7 of 7 details on. A missing detail is left out.');
        await expect(page.locator('#card-fields-settings').getByText(/at most/)).toHaveCount(0);
        await expect.poll(() => card(page, 'Marie').evaluate(el => (el as HTMLElement).offsetHeight)).toBe(175);
        await row('divorce').locator('input').uncheck();
        await row('burial').locator('input').uncheck();
        await expect(host.locator('.card-fields-status')).toHaveText('5 of 7 details on. A missing detail is left out.');
        // The width follows the view's longest line (full dates, the cause): the size says the drawn one.
        await expect.poll(async () => {
            const w = await card(page, 'Marie').evaluate(el => (el as HTMLElement).offsetWidth);
            return (await page.locator('.card-preview-size').textContent()) === `card ${w} × 141 px` && w > 200;
        }).toBe(true);
        // Death to the top.
        await row('death').locator('.card-field-up').click();
        await row('death').locator('.card-field-up').click();
        await expect(row('death').locator('.card-field-up')).toBeDisabled();
        await page.keyboard.press('Escape');

        await expect(lines(page, 'Jan')).toHaveText(['†3/12/1919 Horní Lhota', '*1862 Horní Lhota', 'mlynář', '⚭2/14/1888 Dolní Lhota']);
        await expect(lines(page, 'Anna').first()).toHaveText('†1912 Horní Lhota · cholera');
        await expect(lines(page, 'Marie')).toHaveText(['†after 1919', '≈2/2/1869 Dolní Lhota', '⚭2/14/1888 Dolní Lhota']);
        expect(await card(page, 'Marie').evaluate(el => (el as HTMLElement).offsetHeight)).toBe(141);
    });

    test('the poster draws the same lines as the screen', async ({ page }) => {
        await setup(page);
        await openCardSettings(page);
        await page.locator('#card-density-select').selectOption('custom');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
        ]);
        const { readFileSync } = await import('fs');
        const svg = readFileSync(await download.path(), 'utf-8');
        // The date and the place of a line are two texts (the place at the view's date column).
        for (const text of ['>1862<', '>1919<', '>Horní Lhota<', '>mlynář<', '>after 1919<', '>1869<', '>Dolní Lhota<']) {
            expect(svg).toContain(text);
        }
        // The card's height as on screen (the default: the tallest card of the view).
        const height = await card(page, 'Jan').evaluate(el => (el as HTMLElement).offsetHeight);
        expect(height).toBe(113);
        expect(svg).toContain(`height="${height}"`);
    });

    test('phone 360: the toggles under the name, thumb-sized arrows', async ({ page }) => {
        await setup(page, 360);
        await openCardSettings(page);
        await page.locator('#card-density-select').selectOption('custom');
        const row = page.locator('#card-fields-settings .card-field-row[data-key="birth"]');
        const up = await row.locator('.card-field-down').boundingBox();
        expect(Math.round(up!.width)).toBe(44);
        const name = await row.locator('.card-field-name').boundingBox();
        const chip = await row.locator('.card-field-chip').first().boundingBox();
        expect(chip!.y).toBeGreaterThan(name!.y + name!.height - 1);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(360);
    });
});
