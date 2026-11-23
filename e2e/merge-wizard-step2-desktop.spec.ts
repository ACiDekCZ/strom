import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, mergeCompare, mergeCurrentStep, mergePair } from './helpers.js';
import { brslenoviTree, brslenoviFile } from './merge-pair-fixture.js';

/**
 * Step 2 of the import guide on a wider window (spec 134, dotaz 10, frames
 * 4f–4k): the steps and the counts in one bar, the guide's window larger,
 * the pair's controls one row that never scrolls, only the table scrolls
 * (its head stays), the records by three, the list folding to a rail, and
 * the other steps by their numbers only below 1100 px. The fixture's family
 * Brslen and its places are invented (e2e/merge-pair-fixture.ts).
 */

const FILE = 'rodokmen-brslenovi.ged';

async function openStep2(page: Page, width: number, height: number): Promise<Locator> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.evaluate(async ({ tree, file, name }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(tree, name);
        S.MergerUI.startMerge(file, 'rodokmen-brslenovi.ged');
    }, { tree: brslenoviTree(), file: brslenoviFile(), name: 'Brslenovi' });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await mergePair(wizard, /Hostivít/);
    return wizard;
}

/** The table's scroll: [scrollHeight, clientHeight]. */
async function tableScroll(wizard: Locator): Promise<[number, number]> {
    return wizard.locator('.merge-pair-scroll').evaluate(el => [el.scrollHeight, el.clientHeight] as [number, number]);
}

test.describe('step 2 on a wider window (dotaz 10)', () => {
    test('1440×900: one bar, the pair fills the window, the table fits with the records folded', async ({ page }) => {
        const wizard = await openStep2(page, 1440, 900);
        // The steps and the counts in one bar of at most 44 px; the step's heading only for a reader.
        const bar = await wizard.locator('.merge-topbar').boundingBox();
        expect(bar!.height).toBeLessThanOrEqual(44);
        const progress = await wizard.locator('#merge-progress').boundingBox();
        const counts = await wizard.locator('#merge-counts').boundingBox();
        expect(Math.abs(progress!.y - counts!.y)).toBeLessThan(12);
        await expect(wizard.locator('#merge-step-body .merge-step-title')).toHaveCount(1);
        expect(await wizard.locator('#merge-step-body .merge-step-title').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
        // The window is larger than the old 960 px.
        expect((await wizard.locator('.modal').boundingBox())!.width).toBeGreaterThan(1200);

        // The controls: hide the list, Pair i of n, the group, ↑ ↓, the decisions in one row.
        const ctl = wizard.locator('.merge-pair-ctl');
        await expect(ctl).toBeInViewport({ ratio: 1 });
        await expect(ctl.locator('.merge-pairs-toggle')).toHaveAttribute('aria-label', 'Hide the list of pairs');
        await expect(ctl.locator('.merge-pair-move')).toHaveCount(2);
        await expect(ctl.locator('.merge-decide .merge-dec').first()).toBeVisible();
        await expect(wizard.locator('#merge-next')).toBeInViewport({ ratio: 1 });

        // The table: the import's column named by the file, relatives on lines, three records and "2 more ▸".
        const pair = wizard.locator('.merge-pair-scroll .pair');
        await expect(pair.locator('.hd.c2')).toHaveText(`Import · ${FILE}`);
        await expect(pair.locator('.ln', { hasText: 'Kunigunda Brslenová (1873–1947)' })).toHaveCount(1);
        const more = pair.locator('.merge-records-more');
        await expect(more).toHaveText('2 more ▸');
        const [sh, ch] = await tableScroll(wizard);
        expect(sh).toBeLessThanOrEqual(ch + 1);

        // The undecided rest stands at the list's foot, not under the pair.
        await expect(wizard.locator('#merge-s2-side #merge-rest')).toBeVisible();
        await expect(wizard.locator('#merge-pair #merge-rest')).toHaveCount(0);

        // "2 more ▸" shows all five records; Collapse folds them again.
        await more.click();
        await expect(pair.locator('.merge-records-more')).toHaveText('Collapse');
        await expect(pair.locator('.ln', { hasText: 'Pozemková kniha Dřínov' })).toHaveCount(1);
        await pair.locator('.merge-records-more').click();
        await expect(pair.locator('.merge-records-more')).toHaveText('2 more ▸');
    });

    test('1920×1080: the table fits with the records shown whole; its head stays when it scrolls', async ({ page }) => {
        const wizard = await openStep2(page, 1920, 1080);
        await wizard.locator('.merge-records-more').click();
        const [sh, ch] = await tableScroll(wizard);
        expect(sh).toBeLessThanOrEqual(ch + 1);
        await expect(wizard.locator('.merge-pair-scroll .pair > .hd').first()).toHaveCSS('position', 'sticky');
        await expect(wizard.locator('#merge-next')).toBeInViewport({ ratio: 1 });
    });

    test('the list folds to a rail: the pair widens, ↓ and the keys still move to the next pair', async ({ page }) => {
        const wizard = await openStep2(page, 1440, 900);
        const pane = wizard.locator('#merge-pair');
        const before = (await pane.boundingBox())!.width;
        const title = pane.locator('.merge-pair-title');
        const first = await title.textContent();
        await pane.locator('.merge-pairs-toggle').click();
        await expect(wizard.locator('#merge-s2-side')).toBeHidden();
        const show = wizard.locator('.merge-s2-rail .merge-pairs-toggle');
        await expect(show).toHaveAttribute('aria-label', 'Show the list of pairs');
        await expect(show).toBeFocused();
        expect((await pane.boundingBox())!.width).toBeGreaterThan(before + 150);
        // ↓ of the controls, then the key ↑ back.
        const down = pane.locator('.merge-pair-move[data-move="1"]');
        if (await down.isEnabled()) {
            await down.click();
            await expect(title).not.toHaveText(first!);
            await page.keyboard.press('ArrowUp');
            await expect(title).toHaveText(first!);
        }
        await show.click();
        await expect(wizard.locator('#merge-s2-side')).toBeVisible();
        await expect(wizard.locator('#merge-match-list .merge-item[aria-selected="true"]')).toContainText('Hostivít');
    });

    test('1024×768: the other steps by their numbers only, the bar one row with no overflow', async ({ page }) => {
        const wizard = await openStep2(page, 1024, 768);
        await expect(mergeCurrentStep(wizard).locator('.merge-step-nm')).toBeVisible();
        const others = wizard.locator('#merge-progress .merge-step:not(.active) .merge-step-nm');
        expect(await others.count()).toBeGreaterThan(0);
        for (const nm of await others.all()) await expect(nm).toBeHidden();
        const over = await wizard.locator('.merge-topbar').evaluate(el => el.scrollWidth - el.clientWidth);
        expect(over).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
});
