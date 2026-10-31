/**
 * Tree overview, "Family lines" (package 1031 §1): the list of lineages over
 * the small threshold with founder, counts and the period bar, the detail of
 * one lineage (founder, places, members by generation, wives with their birth
 * line), the order and its memory, "Other families", a birth-line link,
 * "Show in tree" with "Back to overview", opening the overview at a lineage,
 * and the phone rows. Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers';
import { rodsTree, subTree, RodsTree } from './rods-fixture';

async function setup(page: Page, width = 1440, height = 900, tree: RodsTree = rodsTree()): Promise<string> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    return page.evaluate(async (data) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, tree);
}

async function openRods(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeOverview(id, { section: 'rods' }), treeId);
    const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
    await expect(sec).toHaveAttribute('data-ready', 'true');
    return sec;
}

const labels = (sec: Locator): Promise<string[]> => sec.locator('.tov-rod .tov-rod-label').allTextContents();

test.describe('tree overview: family lines', () => {
    test('rows, summary, the detail of a lineage and its birth-line link @smoke', async ({ page }) => {
        const treeId = await setup(page);
        const sec = await openRods(page, treeId);
        await expect(sec.locator('.tov-sec-title')).toHaveText('Family lines');
        // Brandvold, Tallqvist and Hollberg are lines; Ostrander and Kvarnby small families.
        await expect(sec.locator('.tov-sum')).toHaveText('3 lines · 2 other families');
        expect(await labels(sec)).toEqual(['Brandvold', 'Tallqvist', 'Hollberg']);
        const row = sec.locator('.tov-rod[data-rod]').first();
        await expect(row.locator('.tov-rod-period')).toContainText('1702–1999');
        await expect(row.locator('.tov-rod-founder')).toHaveText('founder Arvid Brandvold (c. 1702, Ekeby)');
        await expect(row.locator('.tov-rod-counts')).toHaveText('16 members · 8 married in · 9 generations · 2 living');
        // The person of "Ancestors of" (Mikael) is a Brandvold: the mark, no reordering.
        await expect(row.locator('.tov-rod-mark')).toHaveAttribute('title', 'Family line of Mikael Brandvold');
        await expect(row.locator('.tov-rod-bar-fill')).toHaveCount(1);
        await expect(sec.locator('.tov-rod-axis')).toContainText('1650');

        const head = row.locator('.tov-rod-row');
        await expect(head).toHaveAttribute('aria-expanded', 'false');
        await head.click();
        await expect(head).toHaveAttribute('aria-expanded', 'true');
        const detail = row.locator('.tov-rod-detail');
        await expect(detail.locator('[data-fact="founder"]')).toContainText('Arvid Brandvold (c. 1702, Ekeby) · set automatically');
        await expect(detail.locator('[data-fact="places"]')).toContainText('Ekeby');
        await expect(detail.locator('.tov-rod-gen')).toHaveCount(9);
        await expect(detail.locator('.tov-rod-gen-n').first()).toHaveText('I');
        await expect(detail.locator('.tov-rod-gen-names').first()).toHaveText('Arvid (c. 1702–1771)');
        // Karin married a Tallqvist; the wives with a birth line link to it.
        await expect(detail.locator('.tov-rod-gen[data-gen="2"]')).toContainText('Karin (1744) → Tallqvist line');
        await expect(detail.locator('[data-block="spouses"] .tov-rod-sub')).toHaveText('Wives in the line');
        await expect(detail.locator('.tov-rod-spouse').first()).toHaveText('Signe Hollberg (1715) · born into Hollberg');
        await expect(detail.locator('.tov-rod-spouse')).toHaveCount(4);
        await detail.getByRole('button', { name: 'and 4 more' }).click();
        await expect(sec.locator('.tov-rod.is-open .tov-rod-spouse')).toHaveCount(8);

        // One detail at a time: the birth line opens instead, brought into view.
        await sec.locator('.tov-rod.is-open .tov-rod-spouse').first().getByRole('button', { name: 'Hollberg' }).click();
        await expect(sec.locator('.tov-rod.is-open')).toHaveCount(1);
        await expect(sec.locator('.tov-rod.is-open .tov-rod-label')).toHaveText('Hollberg');
        await expect(sec.locator('.tov-rod.is-open .tov-rod-row')).toBeFocused();
        await expect(sec.locator('.tov-rod.is-open .tov-rod-gen').first()).toContainText('Gudmund (1690–1750)');
    });

    test('order by size, oldest and name, remembered on the device', async ({ page }) => {
        const treeId = await setup(page);
        let sec = await openRods(page, treeId);
        const sort = sec.locator('.tov-rod-sort');
        await expect(sort.getByRole('button', { name: 'size' })).toHaveAttribute('aria-pressed', 'true');
        await sort.getByRole('button', { name: 'oldest' }).click();
        expect(await labels(sec)).toEqual(['Hollberg', 'Brandvold', 'Tallqvist']);
        await sort.getByRole('button', { name: 'A–Z' }).click();
        expect(await labels(sec)).toEqual(['Brandvold', 'Hollberg', 'Tallqvist']);
        await expect(sort.getByRole('button', { name: 'A–Z' })).toBeFocused();
        await page.keyboard.press('Escape');
        sec = await openRods(page, treeId);
        await expect(sec.locator('.tov-rod-sort').getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');
        expect(await labels(sec)).toEqual(['Brandvold', 'Hollberg', 'Tallqvist']);
    });

    test('other families: the folded row, its grid and the link to the tree', async ({ page }) => {
        const treeId = await setup(page);
        const sec = await openRods(page, treeId);
        const other = sec.locator('.tov-rod-other');
        await expect(other).toContainText('Other families: 2');
        await expect(other).toContainText('(up to 4 people)');
        // Ostrander (Anton, Albin, Dagny) and Kvarnby (Olle, Stina); lone wives are not families.
        await expect(other.locator('.tov-rod-other-n')).toHaveText('5 people');
        await expect(sec.locator('.tov-rod-small')).toHaveCount(0);
        await other.click();
        await expect(other).toHaveAttribute('aria-expanded', 'true');
        const items = sec.locator('.tov-rod-small-item');
        await expect(items).toHaveText(['Kvarnby 2 people · 1810–1838', 'Ostrander 3 people · 1835–1866']);
        await items.first().getByRole('button', { name: 'Kvarnby' }).click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(page.locator('#evidence-pill')).toContainText('Kvarnby family line: 2 people');
    });

    test('show in tree: members highlighted, wives faint, back to the overview', async ({ page }) => {
        const treeId = await setup(page);
        const sec = await openRods(page, treeId);
        await sec.locator('.tov-rod-row').first().click();
        await sec.locator('.tov-rod.is-open').getByRole('button', { name: 'Show in tree' }).click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('Brandvold family line: 16 people');
        // Mikael's tree: his parents and grandparents are members, his mother married in.
        await expect(page.locator('.person-card.evidence-hit').first()).toBeVisible();
        await expect(page.locator('.person-card.evidence-faint').first()).toBeVisible();
        await expect(page.locator('.person-card[data-id="b14w"]')).toHaveClass(/evidence-faint/);
        await expect(page.locator('.person-card[data-id="b16"]')).toHaveClass(/evidence-hit/);
        await pill.getByRole('button', { name: 'Back to overview' }).click();
        const back = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
        await expect(back.locator('.tov-rod.is-open .tov-rod-label')).toHaveText('Brandvold');
        await expect(page.locator('.person-card.evidence-faint')).toHaveCount(0);
    });

    test('opened at a lineage: its detail expanded; a small one marked among the others', async ({ page }) => {
        const treeId = await setup(page);
        const first = await openRods(page, treeId);
        await first.locator('.tov-rod-other').click();
        const rods = {
            t: await first.locator('.tov-rod', { hasText: 'Tallqvist' }).getAttribute('data-rod'),
            k: await first.locator('.tov-rod-small-item', { hasText: 'Kvarnby' }).getAttribute('data-rod'),
        };
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await page.evaluate(({ id, rod }) => window.Strom.UI.showTreeOverviewRod(id, rod), { id: treeId, rod: rods.t });
        const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
        await expect(sec.locator('.tov-rod.is-open .tov-rod-label')).toHaveText('Tallqvist');
        await page.keyboard.press('Escape');
        await page.evaluate(({ id, rod }) => window.Strom.UI.showTreeOverviewRod(id, rod), { id: treeId, rod: rods.k });
        await expect(sec.locator('.tov-rod-other')).toHaveAttribute('aria-expanded', 'true');
        await expect(sec.locator('.tov-rod-small-item.is-marked')).toContainText('Kvarnby');
    });

    test('one lineage: its detail at once, no order; only small families: their list at once', async ({ page }) => {
        const treeId = await setup(page, 1440, 900, subTree(rodsTree(), ['h1', 'h1w', 'h2', 'h3', 'h2w', 'h4', 'h5'], 'h4'));
        let sec = await openRods(page, treeId);
        await expect(sec.locator('.tov-sum')).toHaveText('1 line · Hollberg');
        await expect(sec.locator('.tov-rod-sort')).toHaveCount(0);
        await expect(sec.locator('.tov-rod-bar')).toHaveCount(0);
        await expect(sec.locator('.tov-rod--single .tov-rod-detail [data-fact="founder"]')).toContainText('Gudmund Hollberg (1690, Rydsjö)');
        // The wives without parents are no families of their own.
        await expect(sec.locator('.tov-rod-other')).toHaveCount(0);

        const small = await page.evaluate(async (data) => {
            const S = window.Strom;
            return await S.DataManager.importAsNewTree(data, 'Ostrander') as string;
        }, subTree(rodsTree(), ['o1', 'o1w', 'o2', 'k1', 'k1w'], 'o2'));
        await page.keyboard.press('Escape');
        sec = await openRods(page, small);
        await expect(sec.locator('.tov-sum')).toHaveText('2 small families');
        await expect(sec.locator('.tov-rod-other')).toHaveCount(0);
        await expect(sec.locator('.tov-rod-small-item .tov-link')).toHaveText(['Kvarnby', 'Ostrander']);
        await expect(sec.locator('.tov-rod-small-facts')).toHaveText(['2 people · 1810–1838', '2 people · 1835–1866']);
        // Albin (the person of "Ancestors of") is an Ostrander.
        await expect(sec.locator('.tov-rod-small-item').nth(1).locator('.tov-rod-mark')).toHaveAttribute('title', 'Family line of Albin Ostrander');
        // The Hollberg tree is no longer the open one: "Show in tree" opens it first, editing waits for it.
        await page.keyboard.press('Escape');
        sec = await openRods(page, treeId);
        await expect(sec.locator('.tov-rod-act').first()).toHaveText('Open tree and show');
        const edit = sec.locator('.tov-rod-act', { hasText: 'Edit family line…' });
        await expect(edit).toHaveAttribute('aria-disabled', 'true');
        await expect(edit).toHaveAttribute('title', /tree is not open/i);
    });

    test('Czech: the section names and a lineage row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        const treeId = await page.evaluate(async (data) => {
            const S = window.Strom;
            const id = await S.DataManager.importAsNewTree(data, 'Brandvold');
            S.TreeRenderer.setFocus('b16');
            await S.TreeRenderer.renderAsync();
            return id as string;
        }, rodsTree());
        const sec = await openRods(page, treeId);
        await expect(sec.locator('.tov-sec-title')).toHaveText('Rody');
        await expect(sec.locator('.tov-sum')).toHaveText('3 rody · 2 další rodiny');
        await expect(sec.locator('.tov-rod-founder').first()).toHaveText('zakladatel Arvid Brandvold (asi 1702, Ekeby)');
        await expect(page.locator('#tree-overview-modal .tov-sec[data-section="time"] .tov-sec-title')).toHaveText('Rodina v čase');
    });

    test('phone: two-line rows without the bar, two generations first, full-width actions', async ({ page }) => {
        const treeId = await setup(page, 390, 844);
        const sec = await openRods(page, treeId);
        const row = sec.locator('.tov-rod').first();
        await expect(row.locator('.tov-rod-bar')).toBeHidden();
        await expect(row.locator('.tov-rod-short')).toHaveText('Arvid Brandvold · c. 1702 · 16 members · 8 married in · 9 generations · 2 living');
        const box = await row.locator('.tov-rod-row').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(64);
        await row.locator('.tov-rod-row').click();
        const detail = sec.locator('.tov-rod.is-open .tov-rod-detail');
        await expect(detail.locator('.tov-rod-gen:visible')).toHaveCount(2);
        await detail.getByRole('button', { name: 'Show all 9 generations' }).click();
        await expect(sec.locator('.tov-rod.is-open .tov-rod-gen:visible')).toHaveCount(9);
        const act = await sec.locator('.tov-rod.is-open .tov-rod-act').first().boundingBox();
        expect(act!.height).toBeGreaterThanOrEqual(48);
        const scroll = page.locator('#tree-overview-modal .tov-scroll');
        expect(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
});
