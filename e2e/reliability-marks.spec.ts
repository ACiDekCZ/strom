import { test, expect, Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'fs';
import { openApp, createFirstPerson, waitForPersist, cardAction, personModal, card } from './helpers.js';

/**
 * One mark of reliability per fact (spec 066 §2): after a GEDCOM from another
 * program the person card says where the facts came from, with one pill while
 * they all share the step and a pill at each fact once they differ; a tree
 * without an import shows no marks; the tree cards show the weakest step when
 * the setting is on; on a phone a tap opens and closes the mark's text; a
 * research tree with origin shows a person's confirmation and proven facts.
 * Invented data.
 */

function writeGedcom(testInfo: TestInfo): string {
    const lines = [
        '0 HEAD', '1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0', '1 DATE 12 MAR 2024',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 BIRT', '2 DATE 3 FEB 1850', '1 DEAT', '2 DATE 1912', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Zdeslava /Kvapilíková/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1874',
        '0 TRLR', '',
    ];
    const p = testInfo.outputPath('kvapilik.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

async function importTree(page: Page, testInfo: TestInfo): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(writeGedcom(testInfo));
    await page.locator('#gedcom-result-modal #gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await importDialog.locator('#import-tree-name').fill('Kvapilík');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    const next = page.locator('#import-next-card');
    await expect(next).toBeVisible();
    await next.locator('.import-next-close').click();
    await expect(next).toHaveCount(0);
    await expect(card(page, 'Bonifác')).toBeVisible();
}

test.describe('reliability marks', () => {
    test('after an import: one pill in the origin row; after an edit, a pill at each fact', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const origin = modal.locator('#pm-origin');
        await expect(origin).toBeVisible();
        await expect(origin).toContainText('All of this person\'s facts come from Family Tree Maker');
        await expect(origin.locator('.fact-status')).toHaveCount(1);
        await expect(origin.locator('.fact-status')).toHaveClass(/fact-status-import/);
        await expect(origin.locator('.fact-status')).toHaveText('From family tree');
        await expect(modal.locator('#events-list .fact-status')).toHaveCount(0);
        await expect(modal.locator('.form-group > label > .fact-status')).toHaveCount(0);

        await modal.locator('#input-birthdate').fill('4.2.1850');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();
        await waitForPersist(page, '1850-02-04');

        await cardAction(page, 'Bonifác', 'edit');
        await expect(origin).toContainText('Facts marked “from family tree” come from Family Tree Maker');
        await expect(origin.locator('.fact-status')).toHaveCount(0);
        const rows = modal.locator('#events-list .event-row');
        await expect(rows.filter({ hasText: 'Death' }).locator('.fact-status-import')).toHaveCount(1);
        await expect(rows.filter({ hasText: 'Birth' }).locator('.fact-status')).toHaveCount(0);
        await expect(modal.locator('label[for="input-firstname"] .fact-status-import')).toBeVisible();
        await expect(modal.locator('#lastname-label .fact-status-import')).toBeVisible();

        // Setting off: no marks on the person card at all.
        await page.evaluate(() => window.Strom.UI.toggleReliabilityCard(false));
        await expect(origin).toBeHidden();
        await expect(modal.locator('.fact-status')).toHaveCount(0);
    });

    test('a tree without an import shows no marks', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Bonifác', 'Kvapilík');
        await page.evaluate(() => window.Strom.UI.toggleReliabilityTree(true));
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect(modal.locator('#pm-origin')).toBeHidden();
        await expect(modal.locator('.fact-status')).toHaveCount(0);
        await expect(page.locator('.card-rel-mark')).toHaveCount(0);
    });

    test('the tree cards show the weakest step once the setting is on', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo);
        await expect(page.locator('.card-rel-mark')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.toggleReliabilityTree(true));
        const mark = card(page, 'Bonifác').locator('.card-rel-mark');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveClass(/fact-status-import/);
        await expect(mark).toHaveAttribute('title', /^From the family tree \(unverified\): taken from Family Tree Maker.* · Weakest fact on the card: name, birth, death$/);
        // In the card's own pixels (the tree may be zoomed).
        const size = await mark.evaluate((el: HTMLElement) => ({ h: el.offsetHeight, w: el.offsetWidth }));
        expect(size.h).toBe(14);
        expect(size.w).toBeGreaterThanOrEqual(18);
        const box = (await mark.boundingBox())!;
        const cardBox = (await card(page, 'Bonifác').boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
        expect(box.y).toBeGreaterThanOrEqual(cardBox.y);

        await page.evaluate(() => window.Strom.UI.toggleReliabilityTree(false));
        await expect(page.locator('.card-rel-mark')).toHaveCount(0);
    });

    test('a research tree with origin: a person\'s confirmation and proven facts', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Bonifác', 'Kvapilík');
        await page.evaluate(() => {
            const S = window.Strom;
            const p = S.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Bonifác')!;
            p.birthDate = '1850-02-03';
            p.birthStatus = 'proven';
            p.researchOrigins = { name: { kind: 'user' }, sex: { kind: 'user' }, birth: { kind: 'research' } };
            // The research's bridge names `origin`: the tree is the research's.
            S.UI.researchShowsOriginNow = () => true;
            S.UI.activeResearchId = () => 'r-kvapilik';
        });
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect(modal.locator('#pm-origin')).toBeHidden();
        await expect(modal.locator('label[for="input-firstname"] .fact-status-human')).toHaveText('✓Confirmed');
        const birth = modal.locator('#events-list .event-row').filter({ hasText: 'Birth' }).locator('.fact-status');
        await expect(birth).toHaveClass(/fact-status-proven/);
        await expect(birth).toHaveText('Proven');
        await expect(birth.locator('.fs-dots i.on')).toHaveCount(1);
    });
});

test.describe('the mark on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tap opens the mark\'s text and a second tap or a tap elsewhere closes it', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const pill = modal.locator('#pm-origin .fact-status');
        await expect(pill).toBeVisible();
        const box = (await pill.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(20);

        await pill.tap();
        const tip = page.locator('#fact-status-tip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('From the family tree (unverified)');
        await expect(tip.locator('.fact-status-tip-help')).toHaveText('What the marks mean');
        await expect(pill).toHaveAttribute('aria-expanded', 'true');
        const tipBox = (await tip.boundingBox())!;
        expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(390);
        expect((await tip.locator('.fact-status-tip-help').boundingBox())!.height).toBeGreaterThanOrEqual(44);

        await pill.tap();
        await expect(tip).toHaveCount(0);
        await expect(pill).toHaveAttribute('aria-expanded', 'false');

        await pill.tap();
        await expect(tip).toBeVisible();
        await modal.locator('.pm-header').tap({ position: { x: 10, y: 10 } });
        await expect(tip).toHaveCount(0);
        await expect(modal).toBeVisible();
    });
});
