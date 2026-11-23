import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeGroup, mergeGroupsLoose, mergeOpenList } from './helpers.js';

/**
 * The import guide's steps 3 and 5 on a phone (spec 134 §14): held upright
 * (390 × 844) the primary button stays on the screen, step 3 folds its
 * filters under Filters ▾ so the list starts on the first screen and shows
 * the branch preview as a sheet, step 5 puts Where to write first as a
 * segment; held sideways (844 × 390) the primary button stays on the screen
 * too. Step 2's list of pairs as a sheet keeps its tabs readable however
 * many pairs there are. The tree Modřínovi (e2e/fixtures/modrinovi.json)
 * and the file rodokmen-jilmovi.ged are invented.
 */

const PHONE = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };

async function openGuide(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer } = 'e2e/fixtures/rodokmen-jilmovi.ged'): Promise<Locator> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
    await page.locator('#gedcom-input').setInputFiles(file);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    return wizard;
}

/** Nothing of the page scrolls sideways. */
const noSideways = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Kvido (as in the tree) and 60 new children of his: a list of pairs longer than the sheet. */
function manyNewGed(): { name: string; mimeType: string; buffer: Buffer } {
    const names = ['Budivoj', 'Hostivít', 'Velemír', 'Zbyhněv', 'Bonifác', 'Dobroslava', 'Eulálie', 'Libuna'];
    const lines = ['0 HEAD', '1 SOUR FICTIVE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Kvido /Modřín/', '1 SEX M', '1 BIRT', '2 DATE 1921', '2 PLAC Křemenná', '1 FAMS @F1@'];
    const kids: string[] = [];
    for (let i = 0; i < 60; i++) {
        const female = i % 8 >= 5;
        lines.push(`0 @K${i}@ INDI`, `1 NAME ${names[i % 8]} /${female ? 'Modřínová' : 'Modřín'}/`, `1 SEX ${female ? 'F' : 'M'}`,
            '1 BIRT', `2 DATE ${1940 + (i % 40)}`, '1 FAMC @F1@');
        kids.push(`1 CHIL @K${i}@`);
    }
    lines.push('0 @F1@ FAM', '1 HUSB @I1@', ...kids, '0 TRLR');
    return { name: 'rodokmen-jilmovi.ged', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n') + '\n', 'utf-8') };
}

test.describe('a phone held upright', () => {
    test.use({ viewport: PHONE });

    test('step 2: the sheet of a long list of pairs keeps its group tabs full height', async ({ page }) => {
        const wizard = await openGuide(page, manyNewGed());
        await mergeOpenList(wizard);
        await mergeGroup(wizard, 'new');
        expect(await wizard.locator('#merge-match-list [role="option"]').count()).toBeGreaterThan(40);
        const tabs = wizard.locator('#merge-s2-side .merge-tabs');
        await expect(tabs).toBeInViewport();
        // The tabs were squeezed to a few pixels by the long list below them.
        expect((await tabs.boundingBox())!.height).toBeGreaterThanOrEqual(32);
        await expect(wizard.locator('#merge-match-list [role="option"]').first()).toBeInViewport();
    });

    test('step 3: the filters fold under Filters ▾, the list starts on the first screen, the preview is a sheet, the primary button on the screen', async ({ page }) => {
        const wizard = await openGuide(page, manyNewGed());
        // A pair left to decide (a child like the tree's own one) goes as new.
        const rest = wizard.getByRole('button', { name: /^Add as new \(\d+\)$/ });
        if (await rest.count()) await rest.click();
        await wizard.locator('#merge-next').click();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
        const next = wizard.locator('#merge-next');
        await expect(next).toBeInViewport();

        // Filters folded away: the list's first row on the first screen.
        const more = wizard.locator('.merge-s3-more');
        await expect(more).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(more).toHaveText(/^Filters/);
        await expect(wizard.locator('.merge-s3-filters')).toBeHidden();
        const first = wizard.locator('.merge-s3-list > li[role="option"]').first();
        await expect(first).toBeVisible();
        expect((await first.boundingBox())!.y + 20).toBeLessThan(PHONE.height);
        expect(await noSideways(page)).toBe(true);

        // Filters ▾ shows them; a filter on is counted on the folded button.
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(wizard.locator('.merge-s3-filters')).toBeVisible();
        await wizard.locator('.merge-s3-filters [data-t="withSource"]').click();
        await more.click();
        await expect(wizard.locator('.merge-s3-filters')).toBeHidden();
        await expect(more).toHaveText(/^Filters \(1\)/);
        await more.click();
        await wizard.locator('.merge-s3-filters [data-t="withSource"]').click();
        await more.click();

        // The branch preview as a sheet over the step, closed by its ×.
        await wizard.locator('.merge-s3-preview-open').click();
        const preview = wizard.locator('.merge-s3-preview');
        await expect(preview).toBeVisible();
        expect(await preview.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
        await expect(wizard.locator('.merge-s3-preview-close')).toBeInViewport();
        await wizard.locator('.merge-s3-preview-close').click();
        await expect(preview).toBeHidden();

        await mergeGroupsLoose(wizard);
        await expect(next).toBeInViewport();
    });

    test('step 5: Where to write first, as a segment; the primary button on the screen', async ({ page }) => {
        const wizard = await openGuide(page);
        await wizard.locator('#merge-next').click();
        await mergeGroupsLoose(wizard);
        await wizard.locator('#merge-next').click();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
        await expect(wizard.locator('#merge-next')).toBeInViewport();
        const seg = wizard.locator('.merge-s5-into');
        await expect(seg).toHaveClass(/\bsel-seg\b/);
        await expect(seg).toBeInViewport();
        // Above the list of what happens.
        const segBox = (await seg.boundingBox())!;
        const listBox = (await wizard.locator('.merge-s5-gh').first().boundingBox())!;
        expect(segBox.y).toBeLessThan(listBox.y);
        expect(await noSideways(page)).toBe(true);
    });
});

test.describe('a phone held sideways', () => {
    test.use({ viewport: SIDEWAYS });

    test('steps 3 and 5: the primary button on the screen, nothing scrolls sideways', async ({ page }) => {
        const wizard = await openGuide(page);
        const next = wizard.locator('#merge-next');
        await next.click();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '3');
        await expect(next).toBeInViewport();
        expect(await noSideways(page)).toBe(true);
        await mergeGroupsLoose(wizard);
        await next.click();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
        await expect(next).toBeInViewport();
        expect(await noSideways(page)).toBe(true);
    });
});
