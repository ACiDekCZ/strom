import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The family statistics in the tree overview on the sample tree: Life and
 * health (age at death, adult lifespan by birth period), Family through time
 * (splits, children per couple by generation, births by month, names) and
 * Highlights (records whose names lead to the person). The sections are
 * computed on idle callbacks, so their summaries show while they are closed.
 */
async function sampleOverview(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.locator('#toolbar-focus-count:visible, #focus-person-count:visible').first().click();
    const dialog = page.locator('#tree-overview-modal .modal.tov');
    await expect(dialog).toBeVisible();
    return dialog;
}

const section = (dialog: Locator, id: string): Locator => dialog.locator(`.tov-sec[data-section="${id}"]`);

async function expand(dialog: Locator, id: string): Promise<Locator> {
    const sec = section(dialog, id);
    await sec.locator('.tov-sec-head').click();
    await expect(sec.locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'true');
    await expect(sec).toHaveAttribute('data-ready', 'true');
    return sec;
}

// One sample tree and one overview for all four parts (the Highlights click closes it, so it goes last).
test('the overview of the sample: summaries on idle callbacks, Life and health, Family through time, Highlights leading to the person', async ({ page }) => {
    const dialog = await sampleOverview(page);
    await test.step('the closed sections get their summaries on idle callbacks', async () => {
        await expect(section(dialog, 'life').locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'false');
        await expect(section(dialog, 'life').locator('.tov-sum')).toHaveText('adult lifespan 75 years');
        await expect(section(dialog, 'time').locator('.tov-sum')).toHaveText(/^\d+ men, \d+ women$/);
        await expect(section(dialog, 'quality').locator('.tov-sum')).toHaveText('no errors');
        for (const id of ['life', 'time', 'quality', 'highlights']) {
            await expect(section(dialog, id)).toHaveAttribute('data-ready', 'true');
        }
    });
    await test.step('Life and health: age at death in the whole tree and adult lifespan by birth period', async () => {
        const life = await expand(dialog, 'life');
        // The whole tree: no "calculated from the person" mark.
        await expect(life.locator('.tov-mark')).toHaveCount(0);
        await expect(life.locator('.tov-block-scope')).toHaveText('in the whole tree');
        const under5 = life.locator('.tov-tile[data-tile="under5"]');
        await expect(under5.locator('.tov-tile-value')).toHaveText('5%');
        await expect(under5.locator('.tov-tile-note')).toHaveText('1 of 20 deaths with known birth');
        const adults = life.locator('.tov-tile[data-tile="adults"]');
        await expect(adults.locator('.tov-tile-value')).toHaveText('median 75 years');
        await expect(adults.locator('.tov-tile-note')).toHaveText('19 people who reached 15');
        // Only the 50-year periods with at least five people.
        const rows = life.locator('[data-chart="periods"] .tov-hbar-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText('1800–1849');
        await expect(rows.nth(0).locator('.tov-hbar-value')).toHaveText('74 years (n 5)');
        await expect(rows.nth(1)).toContainText('1850–1899');
        await expect(rows.nth(1).locator('.tov-hbar-value')).toHaveText('76 years (n 9)');
    });
    await test.step('Family through time: splits, children per couple by generation, months and names', async () => {
        const time = await expand(dialog, 'time');
        await expect(time.locator('.tov-mark')).toHaveCount(1);
        await expect(time.locator('.tov-split')).toHaveCount(2);
        await expect(time.locator('.tov-split[data-split="sex"] .tov-split-label')).toHaveText('Men / women');
        await expect(time.locator('.tov-split[data-split="living"] .tov-split-label')).toHaveText('Living / deceased (estimate)');
        // Generations with at least two couples, relative to Johan.
        const children = time.locator('[data-chart="children"]');
        await expect(children.locator('.tov-hbar-row')).toHaveCount(4);
        await expect(children.locator('.tov-hbar-row[data-generation="-1"] .tov-hbar-label')).toHaveText('Parents’ generation');
        await expect(children.locator('.tov-hbar-row[data-generation="-1"] .tov-hbar-value')).toHaveText('1.5');
        await expect(children.locator('.tov-note')).toContainText('Generations relative to Johan Berg.');
        await expect(time.locator('.tov-month')).toHaveCount(12);
        await expect(time.locator('.tov-month').first()).toHaveAttribute('title', /^January: \d+ births?$/);
        await expect(time.locator('.tov-names-col')).toHaveCount(2);
        await expect(time.locator('.tov-names-col[data-names="female"] .tov-name-row').first()).toContainText('Clara');
    });
    await test.step('Highlights: records lead to the person', async () => {
        const hl = await expand(dialog, 'highlights');
        await expect(hl.locator('.tov-tile[data-tile="oldest"] .tov-tile-value')).toHaveText('92 years');
        await expect(hl.locator('.tov-tile[data-tile="marriage"]')).toContainText('Thomas Berg & Lena Moreau');
        await expect(hl.locator('.tov-tile[data-tile="children"] .tov-tile-value')).toHaveText('3 children');
        await expect(hl.locator('.tov-tile[data-tile="average"]')).toContainText('Average children per couple');
        await expect(hl.locator('[data-block="anniversaries"] .tov-block-title')).toHaveText('Anniversaries in the next 30 days');
        await hl.locator('.tov-tile[data-tile="oldest"] .tov-tile-who').click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(card(page, 'Lena')).toHaveClass(/focused/);
    });
});
