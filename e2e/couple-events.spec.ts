import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The couple's own events (banns, a census…) in the relationships panel, the
 * event editor in its couple mode, the life timeline; on a phone the list
 * collapses into one row. A couple without events looks as it did before,
 * unless the advanced mode offers "+ couple event". Invented data.
 */

function ged(): string {
    return [
        '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @S1@ SOUR', '1 TITL Oddací matrika Dolní Lhota',
        '0 @S2@ SOUR', '1 TITL Rubrika matky',
        '0 @I1@ INDI', '1 NAME Jan /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1862', '1 DEAT', '2 DATE 1919',
        '1 FAMS @F0@', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '1 SEX F', '1 BIRT', '2 DATE 1869', '1 FAMS @F1@',
        '0 @I4@ INDI', '1 NAME Anna /Kubátová/', '1 SEX F', '1 BIRT', '2 DATE 1863', '1 DEAT', '2 DATE 1886', '1 FAMS @F0@',
        '0 @I3@ INDI', '1 NAME Petr /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1890', '1 FAMC @F1@',
        '0 @F0@ FAM', '1 HUSB @I1@', '1 WIFE @I4@', '1 MARR', '2 DATE 1884', '2 PLAC Horní Lhota',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@',
        '1 MARR', '2 DATE 14 FEB 1888', '2 PLAC Dolní Lhota',
        '1 MARB', '2 DATE 22 JAN 1888', '2 PLAC Dolní Lhota',
        '2 _WITN Josef Kříž', '3 RELA Witness', '2 _WITN Václav Dvořák', '3 RELA Witness', '3 NOTE soused',
        '2 SOUR @S1@', '3 PAGE fol. 3',
        '1 EVEN', '2 TYPE Křest dítěte manželů', '2 SOUR @S2@', '2 NOTE jméno dítěte ani datum na snímku nejsou',
        '1 RESI', '2 DATE FROM 1890 TO 1900', '2 PLAC Horní Lhota', '2 ADDR čp. 13',
        '1 CENS', '2 DATE 1900', '2 PLAC Horní Lhota', '2 ADDR čp. 13',
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

async function openPanel(page: Page, first: string): Promise<void> {
    const id = await idOf(page, first);
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id), id);
    await expect(page.locator('#relationships-modal')).toBeVisible();
}

const editor = (page: Page) => page.locator('#event-editor-modal');
const coupleEvents = (page: Page) => page.locator('#relationships-modal .couple-events');
const rows = (page: Page) => page.locator('#relationships-modal .couple-event-row');

test.describe("couple's events", () => {
    test('a couple without events looks as before; the advanced mode offers "+ couple event"', { tag: '@smoke' }, async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Anna');
        await expect(coupleEvents(page)).toHaveCount(0);
        await expect(page.locator('#relationships-modal .pg-add-event')).toHaveCount(0);
        await page.locator('#relationships-modal button.secondary', { hasText: 'Cancel' }).click();

        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await openPanel(page, 'Anna');
        const links = page.locator('#relationships-modal .pg-links > button:visible');
        await expect(links.last()).toHaveText('+ couple event');
        await links.last().click();
        await expect(editor(page)).toBeVisible();
        await expect(page.locator('#event-editor-title')).toHaveText('Add couple event');
        await expect(page.locator('#event-editor-subtitle')).toHaveText('Jan Vlk & Anna Kubátová');
        await expect(page.locator('#input-event-type')).toHaveValue('banns');
        await expect(page.locator('#btn-delete-event')).toBeHidden();
        // The sentence about the status is no folded field hint: no "?" at Type.
        await expect(page.locator('label[for="input-event-type"] .hint-toggle')).toHaveCount(0);
        // Only the couple's types, grouped; the wedding and the divorce are fields.
        const groups = await page.locator('#input-event-type optgroup').evaluateAll(gs => gs.map(g => (g as HTMLOptGroupElement).label));
        expect(groups).toEqual(['Before the marriage', 'Life together', 'End', 'Other']);
        const values = await page.locator('#input-event-type option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
        expect(values).toEqual(['engagement', 'banns', 'marriageLicence', 'marriageContract', 'marriageSettlement',
            'residence', 'census', 'divorceFiled', 'annulment', 'custom']);
    });

    test('the list under the wedding: date order, undated last, the quiet second line', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Marie');
        await expect(coupleEvents(page).locator('.couple-events-title')).toHaveText("Couple's events");
        await expect(rows(page)).toHaveCount(4);
        await expect(rows(page).locator('.couple-event-type')).toHaveText(['Banns', 'Residence', 'Census', 'Křest dítěte manželů']);
        await expect(rows(page).nth(0).locator('.couple-event-meta')).toHaveText('1/22/1888 · Dolní Lhota');
        await expect(rows(page).nth(0).locator('.couple-event-sub')).toHaveText('witnesses Josef Kříž, Václav Dvořák · 1 source');
        await expect(rows(page).nth(1).locator('.couple-event-meta')).toHaveText(/1890.*1900 · Horní Lhota/);
        await expect(rows(page).nth(1).locator('.couple-event-sub')).toHaveText('čp. 13');
        await expect(rows(page).nth(3).locator('.couple-event-meta')).toHaveText('no date');
        await expect(rows(page).nth(3).locator('.couple-event-sub')).toHaveText('1 source · note');
        // Under the list even without the advanced mode: the couple has events.
        await expect(coupleEvents(page).locator('.couple-event-add')).toHaveText('+ couple event');
        await expect(page.locator('#relationships-modal .pg-add-event')).toHaveCount(0);
        // Desktop shows the list itself, without the phone's toggle.
        await expect(coupleEvents(page).locator('.couple-events-toggle')).toBeHidden();
        await expect(rows(page).first()).toBeVisible();
    });

    test('a person with two partners: the list only at the marriage that has events', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Jan');
        await expect(coupleEvents(page)).toHaveCount(1);
        const marie = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().partnerships)
            .find(u => u.events?.length)!.id);
        await expect(coupleEvents(page)).toHaveAttribute('data-partnership-id', marie);
    });

    test('the editor offers the details by type and keeps what is filled in', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Marie');
        await rows(page).nth(0).click();
        await expect(page.locator('#event-editor-title')).toHaveText('Edit couple event');
        await expect(page.locator('#event-editor-subtitle')).toHaveText('Jan Vlk & Marie Dvořáková');
        await expect(page.locator('#event-participants-label')).toHaveText(/^Witnesses and others/);
        // Its long hint still folds into the label's "?".
        await expect(page.locator('#event-participants-label .hint-toggle')).toHaveCount(1);
        await expect(page.locator('#btn-delete-event')).toBeVisible();
        const more = page.locator('#event-details .detail-more');
        await expect(more).toHaveText('+ age, address');
        await expect(page.locator('#event-status-note')).toBeHidden();

        await page.locator('#input-event-type').selectOption('residence');
        await expect(more).toHaveText('+ address');
        await page.locator('#input-event-type').selectOption('divorceFiled');
        await expect(more).toHaveText('+ cause, address');
        await expect(page.locator('#event-status-note')).toHaveText("The couple's status stays as it is. Change it in the relationships panel if needed.");

        // Each partner's age, named under the field; it stays when the type no longer offers it.
        await page.locator('#input-event-type').selectOption('banns');
        await more.click();
        await expect(page.locator('#input-event-age-1')).toBeFocused();
        await page.locator('#input-event-age-1').fill('24 years');
        await expect(page.locator('#event-age-check-1')).toHaveText('Jan · Differs from calculation (25–26 years) by 1 year');
        await expect(page.locator('#event-age-check-2')).toHaveText(/^Marie/);
        await page.locator('#input-event-type').selectOption('residence');
        await expect(page.locator('#input-event-age-1')).toBeVisible();

        // A new person at the event is a witness.
        await page.locator('#event-participants-section > button.secondary').click();
        await expect(page.locator('.participant-row').last().locator('.participant-role')).toHaveValue('witness');
    });

    test('add: a custom event needs its name, a date is optional; Cancel of the panel discards, Save keeps', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Marie');
        await coupleEvents(page).locator('.couple-event-add').click();
        await page.locator('#input-event-type').selectOption('custom');
        await expect(page.locator('#event-custom-label-group')).toBeVisible();
        await editor(page).locator('button.primary').click();
        await expect(page.locator('.modal-overlay.active').getByText('Enter a label for the custom event')).toBeVisible();
        await page.locator('.modal-overlay.active button.primary', { hasText: 'OK' }).click();
        await page.locator('#input-event-custom-label').fill('Smír');
        await editor(page).locator('button.primary').click();
        await expect(editor(page)).toBeHidden();
        await expect(rows(page)).toHaveCount(5);
        await expect(rows(page).last().locator('.couple-event-type')).toHaveText('Smír');

        // The panel's Cancel takes it back with everything else done in it.
        await page.locator('#relationships-modal button.secondary', { hasText: 'Cancel' }).click();
        await page.locator('#confirm-discard-btn').click();
        const count = () => page.evaluate(() => Object.values(window.Strom.DataManager.getData().partnerships)
            .reduce((n, u) => n + (u.events?.length ?? 0), 0));
        expect(await count()).toBe(4);

        await openPanel(page, 'Marie');
        await coupleEvents(page).locator('.couple-event-add').click();
        await page.locator('#input-event-type').selectOption('marriageContract');
        await page.locator('#input-event-date').fill('2/1/1888');
        await editor(page).locator('button.primary').click();
        await page.locator('#relationships-modal button.primary').click();
        expect(await count()).toBe(5);
    });

    test('delete from the editor\'s footer, after a question naming the event', async ({ page }) => {
        await setup(page);
        await openPanel(page, 'Marie');
        await rows(page).nth(2).click();
        await page.locator('#btn-delete-event').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toContainText('Census — 1900 · Horní Lhota');
        await confirm.getByRole('button', { name: 'Delete event' }).click();
        await expect(editor(page)).toBeHidden();
        await expect(rows(page)).toHaveCount(3);
        await expect(rows(page).locator('.couple-event-type')).toHaveText(['Banns', 'Residence', 'Křest dítěte manželů']);
    });

    test('the life timeline names the other partner; a click opens the couple\'s event', async ({ page }) => {
        await setup(page);
        const jan = await idOf(page, 'Jan');
        await page.evaluate((id) => window.Strom.UI.showEditPersonModal(id), jan);
        const lifeline = page.locator('#pm-lifeline-body');
        await expect(lifeline.locator('.pm-lifeline-row.is-link')).toHaveCount(3);
        const banns = lifeline.locator('.pm-lifeline-row.is-link').first();
        await expect(banns.locator('.pm-lifeline-desc')).toContainText('Banns — Marie Dvořáková · Dolní Lhota');
        await expect(banns.locator('.event-details-line')).toHaveText('witnesses Josef Kříž, Václav Dvořák');
        await expect(lifeline.locator('.pm-lifeline-row.is-link').nth(1).locator('.pm-lifeline-year')).toHaveText('1890–1900');
        await expect(lifeline).not.toContainText('Křest dítěte manželů');
        // The row opens the event; the names and places in it are their own links (T17).
        await banns.locator('.pm-lifeline-year').click();
        await expect(editor(page)).toBeVisible();
        await expect(page.locator('#event-editor-subtitle')).toHaveText('Jan Vlk & Marie Dvořáková');
        await page.locator('#input-event-place').fill('Čáslav');
        await editor(page).locator('button.primary').click();
        await expect(editor(page)).toBeHidden();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(lifeline.locator('.pm-lifeline-row.is-link').first().locator('.pm-lifeline-desc')).toContainText('Čáslav');
    });

    test('phone: one row naming the types, expanded in place, 44 px targets', async ({ page }) => {
        await setup(page, 360, 640);
        await openPanel(page, 'Marie');
        const toggle = coupleEvents(page).locator('.couple-events-toggle');
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle.locator('.couple-events-toggle-summary')).toHaveText('4 · banns, residence, census, křest dítěte manželů');
        expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(rows(page).first()).toBeHidden();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(rows(page)).toHaveCount(4);
        await expect(rows(page).first()).toBeVisible();
        const add = coupleEvents(page).locator('.couple-event-add');
        expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // No horizontal overflow of the panel.
        const overflow = await page.locator('#relationships-modal .modal').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    // Desktop (1440) is checked in "the list under the wedding".
    test('tablet shows the list without a toggle', async ({ page }) => {
        await setup(page, 768);
        await openPanel(page, 'Marie');
        await expect(coupleEvents(page).locator('.couple-events-toggle')).toBeHidden();
        await expect(rows(page).first()).toBeVisible();
    });
});
