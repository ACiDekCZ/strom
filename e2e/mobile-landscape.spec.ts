import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * A phone held sideways (ZADANI_DEV_mobil_ovladani 4a, ≤1024 × ≤500
 * landscape): the side bar on the left, one 44px header with the tree's name,
 * the person and the magnifier, the steppers as a popover, only ⛶.
 */
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

async function sample(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#toolbar-focus-name')).not.toHaveText('');
}

test('the side bar: 76px on the left, the tabs top to bottom with the FAB in the middle, a short Timeline', async ({ page }) => {
    await sample(page);
    const bar = (await page.locator('#bottom-bar').boundingBox())!;
    expect(bar.x).toBe(0);
    expect(Math.round(bar.width)).toBe(76);
    expect(Math.round(bar.height)).toBe(390);
    const ys = await page.locator('#bottom-bar > button').evaluateAll(els => els.map(el => ({
        id: el.id, y: Math.round(el.getBoundingClientRect().y), h: el.getBoundingClientRect().height,
    })));
    expect(ys.map(b => b.id)).toEqual(['bb-view-family', 'bb-view-descendants', 'bottom-bar-fab', 'bb-view-timeline', 'bb-view-more']);
    for (let i = 1; i < ys.length; i++) expect(ys[i].y).toBeGreaterThan(ys[i - 1].y);
    for (const b of ys) expect(Math.round(b.h)).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#bb-view-timeline .bottom-bar-label-short')).toHaveText('Timeline');
    await expect(page.locator('#bb-view-timeline .bottom-bar-label-full')).toBeHidden();
    // The active tab: a line on its left.
    const active = await page.locator('#bb-view-family').evaluate(el => getComputedStyle(el).borderLeftWidth);
    expect(active).toBe('2px');
});

test('one 44px header: icon · tree name | person · ↑n · ↓n · magnifier; the tree takes the rest', async ({ page }) => {
    await sample(page);
    const head = (await page.locator('.toolbar').boundingBox())!;
    expect(Math.round(head.height)).toBe(44);
    expect(Math.round(head.x)).toBe(76);
    const tree = (await page.locator('#tree-container').boundingBox())!;
    expect(Math.round(tree.y)).toBe(44);
    expect(Math.round(tree.x)).toBe(76);
    expect(Math.round(tree.height)).toBe(390 - 44);
    // No floating person panel: the person sits in the header.
    await expect(page.locator('#focus-controls')).toBeHidden();
    const order = await page.evaluate(() => ['.toolbar-tree-icon', '.tree-switcher-btn', '#toolbar-focus-name',
        '.toolbar-focus .focus-chip[data-for="toolbar-depth-up"]', '.toolbar-focus .focus-chip[data-for="toolbar-depth-down"]', '#search-open-btn']
        .map(sel => Math.round(document.querySelector(sel)!.getBoundingClientRect().x)));
    for (let i = 1; i < order.length; i++) expect(order[i], `order ${i}`).toBeGreaterThan(order[i - 1]);
    // Nothing of the header runs past the window.
    const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.toolbar > *')]
        .filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(844);
});

test('the chips open the steppers as a popover under them; the depth changes there', async ({ page }) => {
    await sample(page);
    const chip = page.locator('.toolbar-focus .focus-chip[data-for="toolbar-depth-down"]');
    await expect(chip.locator('.focus-chip-value')).toHaveText(await page.locator('#toolbar-depth-down').inputValue());
    await chip.tap();
    const pop = page.locator('.toolbar-focus .focus-depth');
    await expect(pop).toBeVisible();
    const p = (await pop.boundingBox())!;
    expect(p.y).toBeGreaterThanOrEqual(44);
    expect(p.x + p.width).toBeLessThanOrEqual(844);
    const value = Number(await page.locator('#toolbar-depth-down').inputValue());
    await pop.locator('.depth-stepper').nth(1).locator('[data-step="-1"]').tap();
    await expect(chip.locator('.focus-chip-value')).toHaveText(String(value - 1));
    await page.locator('#tree-container').dispatchEvent('pointerdown');
    await expect(pop).toBeHidden();
});

test('search opens over the whole header; only ⛶ bottom right; sheets stay inside the short window', async ({ page }) => {
    await sample(page);
    await page.locator('#search-open-btn').tap();
    await expect(page.locator('#toolbar-search-picker .person-picker-input')).toBeFocused();
    await expect(page.locator('.toolbar-focus')).toBeHidden();
    await expect(page.locator('.tree-switcher')).toBeHidden();
    await page.locator('#search-cancel-btn').tap();
    await expect(page.locator('.toolbar-focus')).toBeVisible();

    const zoom = page.locator('.zoom-controls button:visible');
    await expect(zoom).toHaveCount(1);
    const z = (await zoom.boundingBox())!;
    expect(Math.round(844 - (z.x + z.width))).toBe(12);
    expect(Math.round(390 - (z.y + z.height))).toBe(12);
    await expect(page.locator('#minimap-panel')).toBeHidden();

    await page.locator('#bb-view-more').tap();
    const sheet = page.locator('.bottom-sheet-menu');
    await expect(sheet).toBeVisible();
    const s = (await sheet.boundingBox())!;
    expect(s.width).toBeLessThanOrEqual(560);
    expect(s.height).toBeLessThanOrEqual(390 - 16 + 1);
});

test('a standalone file: its banner starts under the header and beside the side bar', async ({ page }) => {
    await sample(page);
    await page.evaluate(() => {
        document.body.classList.add('embedded-mode');
        document.getElementById('embedded-mode-banner')!.classList.add('visible');
    });
    const b = (await page.locator('#embedded-mode-banner').boundingBox())!;
    expect(Math.round(b.y)).toBe(44);
    expect(Math.round(b.x)).toBe(76);
});
