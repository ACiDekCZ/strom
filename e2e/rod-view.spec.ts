/**
 * The family line chosen in the tree view (spec 039): the toolbar's choice
 * (desktop before the view tabs, tablet at the bar's right end), its search
 * with Enter on the first result and the small lines unfolding under Other
 * families; the person menu's "Only the X line" (birth line first, the chosen
 * one offering the whole tree); on a phone More → Family line → the list as a
 * sheet, the pill's label opening it again; sideways beside the side bar;
 * German and the dark theme without overflow; a reload keeps the line.
 * Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page, focus = 'b16', opts: { long?: boolean } = {}): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([data, f]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(f as never);
        await S.TreeRenderer.renderAsync();
    }, [rodsTree(opts), focus] as const);
}

const host = (page: Page): Locator => page.locator('#view-rod-picker');
const pill = (page: Page): Locator => page.locator('#evidence-pill');
const pickSheet = (page: Page): Locator => page.locator('.rod-pick-sheet');

/** Elements past their box or the window's right edge; the page scrolling sideways. */
async function overflowing(page: Page, selector: string): Promise<string[]> {
    return page.locator(selector).first().evaluate((root) => {
        const right = window.innerWidth + 1;
        const out: string[] = [];
        root.querySelectorAll<HTMLElement>('button, span, b, h2, input, li').forEach(el => {
            if (!el.getClientRects().length) return;
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            const cs = getComputedStyle(el);
            const clipped = cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden';
            // Inside a box that cuts it (an ellipsis): that box is what counts.
            let inClip = false;
            for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
                if (getComputedStyle(p).overflowX !== 'visible') { inClip = true; break; }
            }
            if ((r.right > right && !inClip) || (!clipped && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible')) {
                out.push(`${el.className || el.tagName}: ${(el.textContent || '').trim().slice(0, 40)}`);
            }
        });
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('page scrolls sideways');
        return out;
    });
}

test.describe('the toolbar\'s choice on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('search "hol" frames the first line, Enter picks it; the pill and the button agree; a reload keeps it @smoke', async ({ page }) => {
        await setup(page);
        await expect(host(page)).toBeVisible();
        const btn = host(page).locator('.sp-rodpick-btn');
        await expect(btn).toHaveText(/^Lines/);
        // Before the view tabs, 6px or so between them.
        const gap = await page.evaluate(() => {
            const a = document.querySelector('#view-rod-picker .sp-rodpick-btn')!.getBoundingClientRect();
            const b = document.getElementById('view-mode-segment')!.getBoundingClientRect();
            return b.left - a.right;
        });
        expect(gap).toBeGreaterThanOrEqual(4);
        expect(gap).toBeLessThanOrEqual(8);
        await btn.click();
        const q = host(page).locator('.sp-rodpick-q');
        await expect(q).toBeFocused();
        await q.fill('hol');
        await expect(host(page).locator('button.sp-rodpick-first')).toContainText('Hollberg');
        await q.press('Enter');
        await expect(host(page).locator('details.sp-rodpick')).not.toHaveAttribute('open', '');
        await expect(pill(page)).toBeVisible();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Hollberg');
        await expect(host(page).locator('.sp-rodpick-btn')).toContainText('Hollberg');
        await expect(pill(page).locator('.evidence-pill-close')).toHaveAttribute('aria-label', 'Show the whole tree');

        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await expect(host(page).locator('.sp-rodpick-btn')).toContainText('Hollberg');
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Hollberg');

        // Whole tree: the choice cleared, the pill gone.
        await host(page).locator('.sp-rodpick-btn').click();
        await host(page).locator('.sp-rodpick-tree button').click();
        await expect(pill(page)).toBeHidden();
        await expect(host(page).locator('.sp-rodpick-btn')).toHaveText(/^Lines/);
    });

    test('Descendants: another line already chosen, a line with nobody drawn moves the focus; ↩ Back brings it back', async ({ page }) => {
        await setup(page);
        await page.locator('#view-mode-descendants').click();
        await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);
        const focus = () => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
        const pick = async (name: string) => {
            await host(page).locator('.sp-rodpick-btn').click();
            const q = host(page).locator('.sp-rodpick-q');
            await q.fill(name.slice(0, 4).toLowerCase());
            await expect(host(page).locator('button.sp-rodpick-first')).toContainText(name);
            await q.press('Enter');
            await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText(name);
        };
        // Brandvold: Mikael is a member, the focus stays.
        await pick('Brandvold');
        expect(await focus()).toBe('b16');
        // Hollberg: none drawn under Mikael, the focus moves to the founder.
        await pick('Hollberg');
        await expect.poll(focus).toBe('h1');
        const back = page.locator('.focus-toast-box .focus-toast-back');
        await expect(back).toBeVisible();
        // Clicked at once, while the message is still coming in.
        await back.click();
        await expect.poll(focus).toBe('b16');
        await expect(page.locator('.focus-toast-box.show')).toHaveCount(0);
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Hollberg');

        // Once more from a chosen line, the other way: Brandvold again, then Hollberg.
        await pick('Brandvold');
        expect(await focus()).toBe('b16');
        await pick('Hollberg');
        await expect.poll(focus).toBe('h1');
        await page.locator('.focus-toast-box .focus-toast-back').click();
        await expect.poll(focus).toBe('b16');
    });

    test('Other families unfold the small lines alphabetically; one of them is chosen and marked', async ({ page }) => {
        await setup(page);
        await host(page).locator('.sp-rodpick-btn').click();
        const x = host(page).locator('button.sp-rodpick-x');
        await expect(x).toHaveAttribute('aria-expanded', 'false');
        await expect(host(page).locator('li.sp-rodpick-small:visible')).toHaveCount(0);
        await x.click();
        await expect(x).toHaveAttribute('aria-expanded', 'true');
        const smalls = host(page).locator('li.sp-rodpick-small:visible .sp-rodpick-n');
        await expect(smalls).toHaveCount(2);
        await expect(smalls.first()).toContainText('Kvarnby');
        await expect(smalls.nth(1)).toContainText('Ostrander');
        await host(page).locator('li.sp-rodpick-small:visible button').nth(1).click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Ostrander');
        await expect(host(page).locator('.sp-rodpick-btn')).toContainText('Ostrander');
        await host(page).locator('.sp-rodpick-btn').click();
        await expect(host(page).locator('li.sp-rodpick-small[aria-current]')).toBeVisible();
    });

    test('the person menu: one line, two lines (birth first), the chosen one offers the whole tree', async ({ page }) => {
        await setup(page, 'b4');
        // Karin Brandvold married into the Tallqvist line.
        await card(page, 'Karin').click();
        const menu = page.locator('.context-menu.person-menu');
        await expect(menu).toBeVisible();
        const rows = menu.locator('[data-action^="rod-only:"]');
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toContainText('Only the Brandvold line');
        await expect(rows.first().locator('.menu-item-meta')).toHaveText('birth');
        await expect(rows.nth(1)).toContainText('Tallqvist');
        await expect(rows.nth(1).locator('.menu-item-meta')).toHaveText('wife');
        // Right after Show descendants, without a research mark.
        const order = await menu.locator('[data-action]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
        expect(order[order.indexOf('descendants') + 1]).toMatch(/^rod-only:/);
        await expect(rows.first().locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await rows.first().click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Brandvold');

        await card(page, 'Karin').click();
        await expect(menu.locator('[data-action="rod-clear"]')).toHaveText(/Show the whole tree/);
        await expect(menu.locator('[data-action^="rod-only:"]')).toHaveCount(1);
        await menu.locator('[data-action="rod-clear"]').click();
        await expect(pill(page)).toBeHidden();
    });

    test('a followed or exported tree (read-only): the menu still offers the line', async ({ page }) => {
        await setup(page, 'b14');
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { isReadOnly: () => boolean }).isReadOnly = () => true; });
        await card(page, 'Karl').click();
        const row = page.locator('.context-menu.person-menu [data-action^="rod-only:"]');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Brandvold');
    });
});

test.describe('the toolbar\'s choice at 1100 px', () => {
    test.use({ viewport: { width: 1100, height: 800 } });

    test('no "Line" before the name, the bar without overflow; the list opens over the tabs', async ({ page }) => {
        await setup(page, 'b16', { long: true });
        await host(page).locator('.sp-rodpick-btn').click();
        await host(page).locator('.sp-rodpick-q').fill('brand');
        await host(page).locator('.sp-rodpick-q').press('Enter');
        const btn = host(page).locator('.sp-rodpick-btn');
        await expect(btn).toContainText('Brandvold');
        await expect(btn.locator('.sp-rodpick-pfx')).toBeHidden();
        const name = await btn.locator('b').boundingBox();
        expect(name!.width).toBeLessThanOrEqual(151);
        expect(await overflowing(page, '.toolbar')).toEqual([]);
    });
});

test.describe('the toolbar\'s choice on a tablet', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

    test('at the bar\'s right end, the list aligned to the button\'s right; no row in More', async ({ page }) => {
        await setup(page);
        await expect(host(page)).toBeVisible();
        const btn = host(page).locator('.sp-rodpick-btn');
        await btn.click();
        const pop = host(page).locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        const b = (await btn.boundingBox())!;
        const p = (await pop.boundingBox())!;
        expect(Math.abs((p.x + p.width) - (b.x + b.width))).toBeLessThanOrEqual(2);
        expect(p.x).toBeGreaterThanOrEqual(0);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showMoreMenuSheet());
        await expect(page.locator('.bottom-sheet-more')).toBeVisible();
        await expect(page.locator('#sheet-rod')).toHaveCount(0);
    });
});

test.describe('the phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More → Family line → the list → a pick → the pill → its label → another line', async ({ page }) => {
        await setup(page);
        await expect(host(page)).toBeHidden();
        await page.locator('#bb-view-more').click();
        const row = page.locator('#sheet-rod');
        await expect(row).toBeVisible();
        await expect(row.locator('.more-rod-row-label')).toHaveText('Family line');
        await expect(row.locator('.more-rod-row-value')).toHaveText('Whole tree');
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(51.5);
        await row.click();
        const sheet = pickSheet(page);
        await expect(sheet).toBeVisible();
        await expect(page.locator('.bottom-sheet-more')).toHaveCount(0);
        await page.waitForTimeout(300);
        const box = (await sheet.boundingBox())!;
        expect(Math.round(box.height)).toBe(844 - 40);
        // No keyboard over the list: the field is not focused until tapped.
        await expect(sheet.locator('.sp-rodpick-q')).not.toBeFocused();
        expect((await sheet.locator('.sp-rodpick-q').boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        expect(await sheet.locator('.sp-rodpick-q').evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
        expect((await sheet.locator('.sp-rodpick-tree button').boundingBox())!.height).toBeGreaterThanOrEqual(55.5);
        expect((await sheet.locator('.sp-rodpick-rod button').first().boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
        expect((await sheet.locator('.rod-pick-sheet-x').boundingBox())!.width).toBeGreaterThanOrEqual(43.5);
        await sheet.locator('.sp-rodpick-rod', { hasText: 'Hollberg' }).locator('button').click();
        await expect(sheet).toHaveCount(0);
        const label = pill(page).locator('.evidence-pill-label--pick');
        await expect(label).toContainText('Hollberg');

        await label.click();
        await expect(pickSheet(page)).toBeVisible();
        await expect(pickSheet(page).locator('li[aria-current]')).toContainText('Hollberg');
        await pickSheet(page).locator('.sp-rodpick-rod', { hasText: 'Tallqvist' }).locator('button').click();
        await expect(label).toContainText('Tallqvist');

        await page.locator('#bb-view-more').click();
        await expect(page.locator('#sheet-rod .more-rod-row-value')).toContainText('Tallqvist');
        // × closes the list, nothing changes.
        await page.locator('#sheet-rod').click();
        await pickSheet(page).locator('.rod-pick-sheet-x').click();
        await expect(pickSheet(page)).toHaveCount(0);
        await expect(label).toContainText('Tallqvist');
    });

    test('the person\'s sheet offers the line; More has no Family line row on the timeline', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonBottomSheet('b16' as never));
        const sheet = page.locator('.bottom-sheet-person');
        const row = sheet.locator('[data-action^="rod-only:"]');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Only the Brandvold line');
        await row.click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Brandvold');
        await page.evaluate(() => window.Strom.UI.showPersonBottomSheet('b16' as never));
        await expect(page.locator('.bottom-sheet-person [data-action="rod-clear"]')).toBeVisible();
        await page.keyboard.press('Escape');

        await page.locator('#bb-view-timeline').click();
        await page.locator('#bb-view-more').click();
        await expect(page.locator('.bottom-sheet-more')).toBeVisible();
        await expect(page.locator('#sheet-rod')).toHaveCount(0);
    });

    test('German, dark: the row, the sheet and the pill with a long name stay in their boxes', async ({ page }) => {
        await setup(page, 'b16', { long: true });
        await page.evaluate(() => {
            window.Strom.UI.setLanguage('de' as never);
            window.Strom.SettingsManager.setTheme('dark');
        });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.locator('#bb-view-more').click();
        await expect(page.locator('#sheet-rod .more-rod-row-label')).toHaveText('Stammlinie');
        await expect(page.locator('#sheet-rod .more-rod-row-value')).toHaveText('Ganzer Stammbaum');
        await page.locator('#sheet-rod').click();
        const sheet = pickSheet(page);
        await expect(sheet.locator('.rod-pick-sheet-title')).toHaveText('Stammlinie wählen');
        expect(await overflowing(page, '.rod-pick-sheet')).toEqual([]);
        await sheet.locator('.sp-rodpick-rod', { hasText: 'Brandvold' }).locator('button').click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Brandvold');
        expect(await overflowing(page, '#evidence-pill')).toEqual([]);
        // The chevron stays beside the cut name.
        const chev = (await pill(page).locator('.evidence-pill-pick-chev').boundingBox())!;
        const pillBox = (await pill(page).boundingBox())!;
        expect(chev.x + chev.width).toBeLessThanOrEqual(pillBox.x + pillBox.width);
        await page.locator('#bb-view-more').click();
        expect(await overflowing(page, '.bottom-sheet-more')).toEqual([]);
        // The value cut with an ellipsis, the whole name in its title.
        await expect(page.locator('#sheet-rod .more-rod-row-value')).toHaveAttribute('title', /Brandvold-Ekhammarsson Lindenau/);
    });
});

test.describe('a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('More from the side bar has the row; the list beside the side bar, the window\'s height, scrolling', async ({ page }) => {
        await setup(page);
        await expect(host(page)).toBeHidden();
        await page.locator('#bb-view-more').click();
        const row = page.locator('#sheet-rod');
        await expect(row).toBeVisible();
        await row.click();
        const sheet = pickSheet(page);
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(300);
        const side = await page.evaluate(() => document.querySelector('.bottom-bar')!.getBoundingClientRect().right);
        const box = (await sheet.boundingBox())!;
        expect(Math.abs(box.x - side)).toBeLessThanOrEqual(2);
        expect(Math.round(box.height)).toBe(390 - 40);
        await sheet.locator('button.sp-rodpick-x').click();
        const scrolls = await sheet.evaluate(el => el.scrollHeight > el.clientHeight);
        expect(scrolls).toBe(true);
        // The last small line reached by scrolling, the search field still on top.
        const last = sheet.locator('li.sp-rodpick-small').last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        const q = (await sheet.locator('.sp-rodpick-q').boundingBox())!;
        expect(q.y).toBeGreaterThanOrEqual(box.y);
        expect(q.y).toBeLessThan(box.y + 120);
        expect(await overflowing(page, '.rod-pick-sheet')).toEqual([]);
    });
});
