import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card } from './helpers.js';

/**
 * Where a start opens (1101): the tree view, never the fan (or the timeline,
 * the map) left on screen, which used to come back with the tree's start
 * person instead of the person it was left with. Invented families only.
 */

async function twoTrees(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        lh_a: { firstName: 'Bořivoj', lastName: 'Lhoták' },
        lh_b: { firstName: 'Božetěch', lastName: 'Lhoták', parents: ['lh_a'] },
    }, 'Lhotákovi');
    await seedTree(page, {
        ho_c: { firstName: 'Zbyňka', lastName: 'Hollerbachová', parents: ['ho_b'], gender: 'female' },
        ho_b: { firstName: 'Kvido', lastName: 'Hollerbach', parents: ['ho_a'] },
        ho_a: { firstName: 'Radomil', lastName: 'Hollerbach' },
    }, 'Hollerbachovi', 'ho_c');
}

/** Fan view of the open tree, its centre re-set to `name` by a tap on the sector. */
async function fanOn(page: Page, name: string): Promise<void> {
    await page.locator('#view-mode-fan').click();
    const fan = page.locator('#fan-container');
    await expect(fan.locator('.fan-svg')).toBeVisible();
    await fan.locator('[data-fan-person]', { hasText: name }).first().click();
    await expect(fan.locator('.fan-focus')).toContainText(name);
}

async function reopen(page: Page): Promise<void> {
    await page.goto('/strom.html');
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

test('a start opens the tree view, not the fan, the timeline or the map left on screen', { tag: '@smoke' }, async ({ page }) => {
    await twoTrees(page);
    await fanOn(page, 'Kvido');
    await reopen(page);
    await expect(page.locator('#fan-container')).toBeHidden();
    // The tree a start opens, with its start person.
    await expect(card(page, 'Bořivoj')).toBeVisible();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);

    for (const view of ['timeline', 'map']) {
        await page.locator(`#view-mode-${view}`).click();
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
        await reopen(page);
        await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
        await expect(card(page, 'Bořivoj')).toBeVisible();
    }
});

test('a tree switch opens the tree view of a tree left in the fan; the descendants view stays', async ({ page }) => {
    await twoTrees(page);
    const ids = await page.evaluate(() => window.Strom.TreeManager.getTrees().map(t => ({ id: t.id, name: t.name })));
    const idOf = (name: string) => ids.find(t => t.name === name)!.id;
    const switchTo = async (name: string) => {
        await page.evaluate(async (id) => {
            await window.Strom.DataManager.switchTree(id as never);
            window.Strom.TreeRenderer.restoreFromSession();
            await window.Strom.TreeRenderer.renderAsync();
        }, idOf(name));
    };
    await fanOn(page, 'Radomil');
    await switchTo('Lhotákovi');
    await page.locator('#view-mode-descendants').click();
    await switchTo('Hollerbachovi');
    await expect(page.locator('#fan-container')).toBeHidden();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await switchTo('Lhotákovi');
    await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);
});
