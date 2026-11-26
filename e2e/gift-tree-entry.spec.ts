import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Give a family tree… (spec 093 §1): where the action is offered. The person
 * menu, the person page's ⋯, Actions › For the family (the first row), the
 * link under Split into families › From a person's view and the lists'
 * "Give a family tree to each person…"; a person without parents, partner or
 * children has no row in the menus, and the guide opened for them from For
 * the family says why. On a phone: the person sheet and More › For the family.
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function sampleOnDaniel(page: Page): Promise<void> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
}

async function guideFor(page: Page, name: string): Promise<Locator> {
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog.locator('.gift-prow .gift-pname').first()).toHaveText(name);
    return dialog;
}

async function closeGuide(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.closeGiftTree());
    await expect(page.locator('#gift-modal')).not.toHaveClass(/active/);
}

test('on a computer: the person menu, the person page, For the family, Split into families and the lists offer it; a lone person has no row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sampleOnDaniel(page);

    // The person menu: after Find in archives, before the lists.
    await card(page, 'Daniel').click();
    const menu = page.locator('.context-menu:not(.context-submenu)');
    const actions = await menu.locator('[data-action]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
    expect(actions.indexOf('gift-tree')).toBe(actions.indexOf('archives') + 1);
    await menu.locator('[data-action="gift-tree"]').click();
    await guideFor(page, 'Daniel Berg');
    await closeGuide(page);

    // The person page's ⋯: after Focus; the page stays under the guide.
    await page.evaluate(() => window.Strom.UI.showPersonPage('demo_daniel' as never));
    const pp = page.locator('#person-page-modal');
    await expect(pp).toHaveClass(/active/);
    await pp.locator('.pp-more').click();
    const items = await pp.locator('.pp-menu-item').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.ppMenu));
    expect(items.indexOf('gift')).toBe(items.indexOf('focus') + 1);
    await pp.locator('[data-pp-menu="gift"]').click();
    await guideFor(page, 'Daniel Berg');
    await expect(pp).toHaveClass(/active/);
    await closeGuide(page);
    await expect(pp).toHaveClass(/active/);
    await page.evaluate(() => window.Strom.UI.closePersonPage());

    // Actions › For the family: the first row, a line under it; for the person in focus.
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-family-row').click();
    const family = page.locator('#actions-family-submenu');
    await expect(family.locator('[role="menuitem"]').first()).toHaveText('Give a family tree…');
    await expect(family.locator('#actions-gift-row + .tree-switcher-divider')).toBeVisible();
    await page.locator('#actions-gift-row').click();
    await guideFor(page, 'Daniel Berg');
    await closeGuide(page);

    // Split into families › From a person's view: the sentence with the link closes it and opens the guide.
    await page.evaluate(() => { void window.Strom.UI.showSplitFamiliesDialog(); });
    const split = page.locator('#split-families-modal');
    await expect(split).toBeVisible();
    await expect(split.locator('#splitfam-gift')).toHaveCount(0);
    await split.locator('.splitfam-mode-btn[data-mode="perspective"]').click();
    await expect(split.locator('.splitfam-mode-btn[data-mode="perspective"]')).toHaveClass(/active/);
    await expect(split.locator('.splitfam-gift')).toContainText('Only for one person, without splitting the tree:');
    await split.locator('#splitfam-gift').click();
    await expect(page.locator('#split-families-modal')).toHaveCount(0);
    await guideFor(page, 'Daniel Berg');
    await closeGuide(page);

    // Lists of people: "Give a family tree to each person…" after Export.
    await page.evaluate(() => {
        const l = window.Strom.DataManager.createPersonList({ name: 'Christmas', dynamic: false, personIds: ['demo_daniel', 'demo_emma'] as never });
        window.Strom.UI.showPersonLists({ listId: l!.id });
    });
    const lists = page.locator('#person-lists-modal');
    await lists.locator('.pl-more').click();
    const rows = (await lists.locator('.pl-menu .pl-menu-item').allInnerTexts()).map(t => t.trim());
    expect(rows.indexOf('Give a family tree to each person…')).toBe(rows.findIndex(r => r.startsWith('Export')) + 1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.closePersonLists());

    // A person without parents, partner or children: no row in the person menu nor on the page.
    await page.evaluate(async () => {
        const p = window.Strom.DataManager.createPerson({ firstName: 'Ingvar', lastName: 'Sandmark', gender: 'male', birthDate: '1931' });
        await window.Strom.TreeRenderer.setFocus(p.id);
    });
    await expect(card(page, 'Ingvar')).toBeVisible();
    await card(page, 'Ingvar').click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="archives"]')).toBeVisible();
    await expect(menu.locator('[data-action="gift-tree"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const lone = await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());
    await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), lone);
    await pp.locator('.pp-more').click();
    await expect(pp.locator('[data-pp-menu="focus"]')).toBeVisible();
    await expect(pp.locator('[data-pp-menu="gift"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.Strom.UI.closePersonPage());

    // For the family opens the guide anyway; step 1 says why and Next stays off.
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-family-row').click();
    await page.locator('#actions-gift-row').click();
    const dialog = await guideFor(page, 'Ingvar Sandmark');
    await expect(dialog.locator('#gift-lone')).toContainText('Ingvar Sandmark');
    await expect(dialog.locator('#gift-next')).toBeDisabled();
});

test('on a phone: the person sheet and More › For the family offer it; the lists do not', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sampleOnDaniel(page);

    await card(page, 'Daniel').click();
    const sheet = page.locator('.bottom-sheet-person');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-action="gift-tree"]').click();
    await guideFor(page, 'Daniel Berg');
    await closeGuide(page);

    await page.locator('#bb-view-more').click();
    await page.locator('#sheet-family').click();
    const sub = page.locator('.bottom-sheet-subpage');
    await expect(sub.locator('.bottom-sheet-items .bottom-sheet-item').first()).toHaveText('Give a family tree…');
    await page.locator('#sheet-gift').click();
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
    await guideFor(page, 'Daniel Berg');
    await closeGuide(page);

    // Many packages are made on a computer only: a list's sheet has no such row.
    await page.evaluate(() => {
        const l = window.Strom.DataManager.createPersonList({ name: 'Christmas', dynamic: false, personIds: ['demo_daniel', 'demo_emma'] as never });
        window.Strom.UI.showPersonLists({ listId: l!.id });
    });
    await page.locator('#person-lists-modal .pl-more').click();
    const listSheet = page.locator('.bottom-sheet-menu');
    await expect(listSheet.locator('.bottom-sheet-item').first()).toHaveText('Open in Table');
    await expect(listSheet.locator('.bottom-sheet-item', { hasText: 'Give a family tree' })).toHaveCount(0);
});
