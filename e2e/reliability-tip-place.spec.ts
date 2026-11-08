import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card, cardAction, personModal } from './helpers.js';

/**
 * The status tip of a reliability pill opens right at the pill and on screen:
 * a floating bubble under the pill (above it when there is no room below) in
 * the person card's long list of events, at the occupation field's label and
 * in the relationships panel; the dialog's scroll never clips it. Invented data.
 */

function ged(): string {
    const ev = (tag: string, date: string, status: string, value = '') =>
        [`1 ${tag}${value ? ` ${value}` : ''}`, `2 DATE ${date}`, '2 PLAC Dolní Bramborov', `2 _STROM_STATUS ${status}`];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M',
        ...ev('BIRT', '3 FEB 1850', 'proven'),
        ...ev('CHR', '5 FEB 1850', 'probable'),
        ...ev('OCCU', '1880', 'probable', 'kolář'),
        ...ev('RESI', '1870', 'possible'),
        ...ev('RESI', '1875', 'lead'),
        ...ev('CENS', '1880', 'proven'),
        ...ev('CENS', '1890', 'possible'),
        ...ev('CENS', '1900', 'probable'),
        ...ev('EDUC', '1860', 'lead'),
        ...ev('RESI', '1905', 'possible'),
        ...ev('DEAT', '1912', 'proven'),
        ...ev('BURI', '1912', 'probable'),
        '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Zdeslava /Kvapilíková/', '1 SEX F', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
        '1 MARR', '2 DATE 8 APR 1874', '2 _STROM_STATUS possible',
        '1 DIV', '2 DATE 3 MAR 1881', '2 _STROM_STATUS probable',
        '0 TRLR',
    ].join('\n');
}

async function setup(page: Page): Promise<void> {
    await openApp(page);
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'kvapilik.ged', { type: 'text/plain' }));
        return dt;
    }, ged());
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await expect(card(page, 'Bonifác')).toBeVisible();
}

/** A click on the pill: its tip right at the pill (under it, or above it without room) and inside the viewport. */
async function expectTipAt(page: Page, pill: Locator, what: string): Promise<void> {
    await pill.scrollIntoViewIfNeeded();
    await pill.click();
    const tip = page.locator('#status-tip');
    await expect(tip).toBeVisible();
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    // In the page's top layer: never inside the dialog's scrolling body.
    expect(await tip.evaluate((el) => el.parentElement === document.body), `${what}: the tip floats`).toBe(true);
    const p = (await pill.boundingBox())!;
    const t = (await tip.boundingBox())!;
    const below = t.y - (p.y + p.height);
    const above = p.y - (t.y + t.height);
    expect(Math.min(Math.abs(below - 8), Math.abs(above - 8)), `${what}: the tip right at its pill`).toBeLessThanOrEqual(2);
    const vp = page.viewportSize()!;
    expect(t.y, `${what}: the tip on screen`).toBeGreaterThanOrEqual(0);
    expect(t.y + t.height, `${what}: the tip on screen`).toBeLessThanOrEqual(vp.height);
    expect(t.x, `${what}: the tip on screen`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width, `${what}: the tip on screen`).toBeLessThanOrEqual(vp.width);
    await pill.click();
    await expect(tip).toHaveCount(0);
}

for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
    test.describe(`the pill's text on a ${name}`, () => {
        test.use({ viewport: { width, height } });

        test('in the list of events: at the pill of the row', async ({ page }) => {
            await setup(page);
            await cardAction(page, 'Bonifác', 'edit');
            const modal = personModal(page);
            const rows = modal.locator('#events-list .event-row');
            expect(await rows.count()).toBeGreaterThanOrEqual(10);
            for (const i of [1, 4, 11]) {
                const row = rows.nth(i);
                await expectTipAt(page, row.locator('.fact-status'), `event row ${i + 1}`);
            }
        });

        test('at the occupation field: at its label\'s pill', async ({ page }) => {
            await setup(page);
            await cardAction(page, 'Bonifác', 'edit');
            const modal = personModal(page);
            const pill = modal.locator('label[for="input-occupation"] .fact-status');
            await expect(pill).toHaveCount(1);
            await expectTipAt(page, pill, 'occupation');
            // A click on the pill never focuses the label's field.
            await expect(modal.locator('#input-occupation')).not.toBeFocused();
        });

        test('in the relationships panel: at the wedding\'s and the divorce\'s pill', async ({ page }) => {
            await setup(page);
            const id = await page.evaluate(() =>
                window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Bonifác')!.id);
            await page.evaluate((pid) => window.Strom.UI.showRelationshipsPanel(pid), id);
            const modal = page.locator('#relationships-modal');
            await expect(modal).toBeVisible();
            for (const cls of ['.pg-label-start', '.pg-label-end']) {
                await expectTipAt(page, modal.locator(`.pg-row ${cls} .fact-status`).first(), `relationships ${cls}`);
            }
        });
    });
}
