import { test, expect, Page, TestInfo } from '@playwright/test';
import { writeFileSync } from 'fs';
import { openApp, createFirstPerson, waitForPersist, cardAction, personModal, card } from './helpers.js';

/**
 * One mark of reliability per fact (spec 066 §2): after a GEDCOM from another
 * program the person card says where the facts came from, with one pill while
 * they all share the step and a pill at each fact once they differ; a tree
 * without an import shows no marks; the tree card's one status mark (spec 066
 * P4 §1) shows the weakest step after an import and the citations in a tree
 * of the app's own; on a phone a tap opens and closes the mark's text; a
 * research tree with origin shows a person's confirmation and proven facts.
 * Invented data.
 */

function writeGedcom(testInfo: TestInfo, cited = false): string {
    const lines = [
        '0 HEAD', '1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0', '1 DATE 12 MAR 2024',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 BIRT', '2 DATE 3 FEB 1850',
        ...(cited ? ['2 SOUR @S1@'] : []), '1 DEAT', '2 DATE 1912', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Zdeslava /Kvapilíková/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1874',
        ...(cited ? ['0 @S1@ SOUR', '1 TITL Matrika N Bramborov 1840–1870'] : []),
        '0 TRLR', '',
    ];
    const p = testInfo.outputPath('kvapilik.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

async function importTree(page: Page, testInfo: TestInfo, cited = false): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(writeGedcom(testInfo, cited));
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
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect(modal.locator('#pm-origin')).toBeHidden();
        await expect(modal.locator('.fact-status')).toHaveCount(0);
        // No sources and no origin: the tree cards say nothing either.
        await expect(page.locator('.card-status-mark')).toHaveCount(0);
    });

    test('after an import with sources: the tree card\'s one mark is the import\'s, no stripes', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo, true);
        // On by default (spec 066 P4 §4), the import wins over the citation.
        const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
        await expect(mark).toHaveCount(1);
        await expect(mark).toHaveClass(/\bcs-import\b/);
        await expect(mark.locator('.fs-dots i')).toHaveCount(2);
        await expect(mark.locator('.fs-dots i.on')).toHaveCount(0);
        await expect(card(page, 'Zdeslava').locator(':scope > .card-status-mark')).toHaveClass(/\bcs-import\b/);
        await expect(page.locator('.ev-stripe, .card-state, .card-rel-mark')).toHaveCount(0);
        // No native title: the words are the tooltip's.
        await expect(mark).not.toHaveAttribute('title', /.*/);
        // In the card's own pixels (the tree may be zoomed): a 12px pill inside the card.
        const size = await mark.evaluate((el: HTMLElement) => ({ h: el.offsetHeight, w: el.offsetWidth }));
        expect(size.h).toBe(12);
        expect(size.w).toBeGreaterThanOrEqual(18);
        const box = (await mark.boundingBox())!;
        const cardBox = (await card(page, 'Bonifác').boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
        expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
        // In words (spec 066 P4 §5): the import's short title, the cited source under it.
        const ttStatus = card(page, 'Bonifác').locator('.card-tooltip .tt-status');
        await expect(ttStatus).toContainText('From the family tree (unverified)');
        await expect(ttStatus.locator('.tt-status-sub')).toContainText('cited in the family tree, not verified in Strom');

        await page.evaluate(() => { window.Strom.SettingsManager.setCardSignal('status', false); window.Strom.TreeRenderer.render(); });
        // Off: gone from the cards (the tooltip keeps its words).
        await expect(page.locator('.person-card > .card-status-mark')).toHaveCount(0);
    });

    test('a tree of the app\'s own with sources: ●● backed, ●○ partly, a dotted frame for none', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            const p = (id: string, firstName: string, extra: Record<string, unknown>) => ({
                id, firstName, lastName: 'Kvapilík', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
            });
            await window.Strom.DataManager.importAsNewTree({
                persons: {
                    a: p('a', 'Bonifác', { birthDate: '1850', birthSourceIds: ['s1'], childIds: ['b', 'c'] }),
                    b: p('b', 'Radovan', { birthDate: '1872', deathDate: '1920', birthSourceIds: ['s1'], parentIds: ['a'] }),
                    c: p('c', 'Vavřinec', { birthDate: '1875', parentIds: ['a'] }),
                },
                partnerships: {},
                sources: { s1: { id: 's1', title: 'Matrika N Bramborov 1840–1870' } },
            } as never, 'Kvapilík');
        });
        const mark = (name: string) => card(page, name).locator(':scope > .card-status-mark');
        await expect(mark('Bonifác')).toHaveClass(/\bcs-p2\b/);
        await expect(mark('Radovan')).toHaveClass(/\bcs-p1\b/);
        await expect(mark('Vavřinec')).toHaveClass(/\bcs-none\b/);
        await expect(mark('Vavřinec').locator('.fs-dots')).toHaveCount(0);
        // Neutral: the dots take the light text colour, the dotted frame the line colour.
        const look = await mark('Bonifác').evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-light)';
            el.parentElement!.appendChild(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { color: getComputedStyle(el).color, want };
        });
        expect(look.color).toBe(look.want);
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
            S.SettingsManager.setBranchLegend(true);
            S.TreeRenderer.render();
        });
        // One meter (K5.1): proven by one reader is ●● on the card, the legend says what it means.
        const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
        await expect(mark).toHaveClass(/\bcs-p2\b/);
        await expect(card(page, 'Bonifác')).toHaveAttribute('aria-label', /everything verified: birth/);
        await expect(page.locator('#legend-marks .legend-mark-row')).toContainText(['everything verified']);
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
