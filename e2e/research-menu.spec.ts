import { test, expect, Page } from '@playwright/test';
import { FakeBridge, NEW_HEAD, block, fakeBridge, openResearch, poll, researchGed, signal } from './research-bridge.js';

/**
 * The toolbar's Research button and menu (U04): left of Actions, the menu on
 * the first level (state on top, then the actions by how often they are
 * used), one signal on the button, the keyboard (arrows over every item,
 * Home / End, ← / → to Actions, Escape back to what opened it), the More
 * sheet's research group in a narrow window with a mouse, and the button
 * hidden up to 1024 px. Invented data; the bridge is answered by page.route.
 */

const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const WAITING = [{ id: 'T0001', what: 'Confirm a baptism' }, { id: 'T0002', what: 'Which register?' }, { id: 'T0003', what: 'A new version of the story' }];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];

/** A research tree tied to a running research that says what it takes (sent by hand). */
async function researchTree(page: Page, opts: { edit?: boolean; waiting?: unknown[]; head?: string } = {}): Promise<FakeBridge> {
    await openResearch(page, { edit: opts.edit });
    const bridge = await fakeBridge(page, { accepts: ACCEPTS, links: LINKS, waiting: opts.waiting ?? [],
        ...(opts.head ? { head: opts.head, treeGed: researchGed(opts.head) } : {}) });
    await poll(page);
    await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
    return bridge;
}

const menu = (page: Page) => page.locator('#research-menu');
const button = (page: Page) => page.locator('#research-menu-btn');
const labels = (page: Page) => menu(page).locator('.tree-switcher-action .research-item-label');
const focusedId = (page: Page) => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.id || el.dataset.action || el.className : '';
});

test.describe('the Research button and menu', () => {
    test('left of Actions; the menu under it (right edges level): title with trial, the state, then frequent | now and then | occasional, the note', { tag: '@smoke' }, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page, { waiting: WAITING });
        const btn = button(page);
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
        await expect(btn).toHaveAttribute('aria-controls', 'research-menu');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        // Right before Actions in the toolbar; the chevron above 1280 px.
        expect(await btn.evaluate(b => b.parentElement?.nextElementSibling?.classList.contains('actions-menu'))).toBe(true);
        await expect(btn.locator('.research-menu-chevron')).toBeVisible();
        await btn.click();
        await expect(menu(page)).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await expect(btn).toHaveClass(/is-open/);
        const [b, m] = await Promise.all([btn.boundingBox(), menu(page).boundingBox()]);
        expect(m!.y).toBeGreaterThan(b!.y + b!.height - 1);
        expect(Math.abs((m!.x + m!.width) - (b!.x + b!.width))).toBeLessThan(2);
        expect(m!.width).toBeCloseTo(340, 0);
        // Title + trial, then the state block, then the groups.
        await expect(menu(page).locator('.research-menu-heading #research-menu-title')).toHaveText('Research');
        await expect(menu(page).locator('.research-menu-heading .research-trial-tag')).toHaveText('trial');
        await expect(menu(page)).toHaveAttribute('aria-labelledby', 'research-menu-title');
        expect(await menu(page).evaluate(el => Array.from(el.children).map(c => c.className.split(' ')[0])))
            .toEqual(['research-menu-heading', 'research-sync-block', 'research-menu-group', 'tree-switcher-divider', 'research-menu-group',
                'tree-switcher-divider', 'research-menu-group', 'tree-switcher-divider', 'research-submenu-note']);
        await expect(menu(page).locator('[role="group"]')).toHaveCount(3);
        await expect(menu(page).locator('[role="separator"]')).toHaveCount(3);
        await expect(labels(page)).toHaveText(['Awaiting action', 'Continue with the agent', 'Open research', 'Send changes',
            'Follow live', 'Research for this tree…', 'Settings in the research']);
        await expect(menu(page).locator('.research-menu-group.is-quiet .research-item-label')).toHaveText(['Research for this tree…', 'Settings in the research']);
        // The block's text is a live region; its buttons are items outside it.
        await expect(block(page).locator('[role="status"][aria-live="polite"]')).toHaveCount(1);
        await expect(block(page).locator('[role="status"] [role="menuitem"]')).toHaveCount(0);
        // A click outside closes it; Actions and Research never open together.
        await page.mouse.click(200, 600);
        await expect(menu(page)).toBeHidden();
        await btn.click();
        await page.locator('.actions-menu-btn').click();
        await expect(menu(page)).toBeHidden();
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await btn.click();
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await expect(menu(page)).toBeVisible();
        // An item done closes the menu.
        await page.locator('#research-item-open').click();
        await expect(menu(page)).toBeHidden();
    });

    test('"Send changes" goes from the rows while the state block offers the send (Send, What will be sent), and is there when it does not', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await button(page).click();
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
        await expect(page.locator('#research-item-send')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: 'Brno' });
        });
        await button(page).click();
        await expect(block(page)).toHaveAttribute('data-state', 'unsent');
        await expect(block(page).locator('[data-action="send"]')).toBeVisible();
        await expect(page.locator('#research-item-send')).toHaveCount(0);
    });

    test('one signal on the button: the count before attention before changes not sent; the ⋯ dot is the anniversaries\' only', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const bridge = await researchTree(page, { edit: true });
        // Changes not sent: the dot, and the button says so.
        expect(await signal(page)).toBe('unsent');
        await expect(button(page)).toHaveAttribute('aria-label', 'Research – changes from the app not yet in the research');
        await expect(page.locator('#actions-menu-dot')).toBeHidden();
        // The research has a newer version too: the state asks for the user (still one dot).
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('unsentAndNewer');
        expect(await signal(page)).toBe('attention');
        await expect(page.locator('#research-menu-signal')).toHaveText('');
        // Tasks waiting: their count wins.
        bridge.waiting = WAITING;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
        expect(await signal(page)).toBe('count');
        await expect(page.locator('#research-menu-signal')).toHaveText('3');
        await expect(button(page)).toHaveAttribute('aria-label', 'Research, awaiting action: 3');
        await expect(page.locator('#actions-menu-dot')).toBeHidden();
        expect(await page.locator('#research-menu-signal').count()).toBe(1);
    });

    test('a tree locked by hand: no state block and no "following live" line (that is only for following live)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.toggleTreeLock(tm.getActiveTreeId()!);
        });
        expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
        await button(page).click();
        await expect(menu(page)).toBeVisible();
        await expect(block(page)).toHaveCount(0);
        await expect(page.locator('#research-menu-following')).toHaveCount(0);
        await expect(button(page).locator('.research-menu-live')).toBeHidden();
    });

    test('locked data: no Research button (nothing of the research behind a lock)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await expect(button(page)).toBeVisible();
        await page.evaluate(() => {
            window.Strom.DataManager.isLocked = () => true;
            window.Strom.UI.refreshActionMenuBadges();
        });
        await expect(button(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.UI.researchMenuShown())).toBe(false);
    });

    test('up to 1280 px the word stays without the chevron; the toolbar keeps it whole', async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 800 });
        await researchTree(page, { waiting: WAITING });
        await expect(button(page)).toBeVisible();
        await expect(button(page).locator('.research-menu-label')).toHaveText('Research');
        await expect(button(page).locator('.research-menu-chevron')).toBeHidden();
        await expect(page.locator('#research-menu-signal')).toBeVisible();
    });
});

test.describe('the keyboard', () => {
    test('Enter opens it on the first item (the state block\'s button); arrows go over every item, Home / End; Escape back to the button', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page, { edit: true });
        await button(page).focus();
        await page.keyboard.press('Enter');
        await expect(menu(page)).toBeVisible();
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(block(page).locator('[data-action="showChanges"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#research-item-chat')).toBeFocused();
        await page.keyboard.press('End');
        await expect(page.locator('#research-item-setup')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        // Round: the title's "trial" first.
        await expect(menu(page).locator('.research-trial-tag')).toBeFocused();
        await page.keyboard.press('Home');
        await expect(menu(page).locator('.research-trial-tag')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(page.locator('#research-item-setup')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
        await expect(button(page)).toBeFocused();
        // ↓ on the button opens it too.
        await page.keyboard.press('ArrowDown');
        await expect(menu(page)).toBeVisible();
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        // Tab out: it closes.
        await page.keyboard.press('End');
        await page.keyboard.press('Tab');
        await expect(menu(page)).toBeHidden();
    });

    test('← / → switch between Research and Actions, never on the "Tree:" row (its flyout) ', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await button(page).focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowRight');
        await expect(menu(page)).toBeHidden();
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await expect(page.locator('#actions-book-row')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await expect(menu(page)).toBeVisible();
        expect(await focusedId(page)).toBe('research-item-chat');
        // On the "Tree:" row → opens its flyout and ← closes it (Actions stays open).
        await page.keyboard.press('ArrowRight');
        await page.locator('#actions-tree-row').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#actions-tree-wrap')).toHaveClass(/submenu-open/);
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#actions-tree-wrap')).not.toHaveClass(/submenu-open/);
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await expect(menu(page)).toBeHidden();
    });

    test('opened from the toolbar pill: Escape puts focus back on the pill', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await researchTree(page);
        const mark = page.locator('#research-sync-mark');
        await expect(mark).toBeVisible();
        await mark.focus();
        await page.keyboard.press('Enter');
        await expect(menu(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
        await expect(mark).toBeFocused();
    });
});

test.describe('a narrow window with a mouse (≤ 1024 px)', () => {
    test('no Research button; More starts with the research group, "All research actions ›" shows the whole menu in the same sheet, Escape back', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await researchTree(page, { edit: true, waiting: WAITING });
        await expect(button(page)).toBeHidden();
        // The More tab carries the research's signal here.
        await expect(page.locator('#bottom-bar-more-dot')).toBeVisible();
        await page.locator('#bb-view-more').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const items = sheet.locator('.bottom-sheet-items');
        // First the group: title + trial, the state in one line with its first action, the frequent ones, all of them.
        expect(await items.evaluate(el => (el.firstElementChild as HTMLElement).className)).toContain('research-sheet-heading');
        await expect(items.locator('.research-sheet-heading')).toContainText('Research');
        await expect(items.locator('.research-sheet-heading .research-trial-tag')).toHaveText('trial');
        await expect(page.locator('#research-sheet-state-text')).toHaveText("Changes the research doesn't have");
        await expect(page.locator('#research-sheet-state [role="menuitem"]')).toHaveText('Send changes');
        const groupRows = await items.evaluate(el => {
            const out: string[] = [];
            for (const c of Array.from(el.children)) {
                if (c.classList.contains('bottom-sheet-divider')) break;
                if (c.matches('button.bottom-sheet-item')) out.push((c.querySelector('.bottom-sheet-label')?.textContent ?? '').trim());
            }
            return out;
        });
        expect(groupRows).toEqual(['Awaiting action', 'Continue with the agent', 'Open research', 'All research actions']);
        // Not "Ancestor research" beside it: this tree has its research.
        await expect(sheet).not.toContainText('Ancestor research');
        const all = page.locator('#research-sheet-all');
        await all.click();
        // The same sheet, its page: ‹ back, the whole menu (one place only: no ids twice).
        await expect(sheet).toHaveCount(1);
        await expect(items).toBeHidden();
        const body = page.locator('#research-sheet-menu');
        await expect(body).toBeVisible();
        await expect(body.locator('.research-menu-back')).toBeVisible();
        expect((await body.locator('.research-menu-back').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('#research-sync-block')).toHaveCount(1);
        await expect(body.locator('#research-sync-block')).toHaveCount(1);
        await expect(page.locator('#research-menu #research-sync-block')).toHaveCount(0);
        await expect(body.locator('.research-item-label').first()).toHaveText('Awaiting action');
        expect((await body.locator('#research-item-waiting').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // Escape: back to the list, focus on "All research actions"; a second one closes.
        await page.keyboard.press('Escape');
        await expect(items).toBeVisible();
        await expect(body).toBeHidden();
        await expect(all).toBeFocused();
        // ‹ back works the same; an item done closes the sheet.
        await all.click();
        await body.locator('.research-menu-back').click();
        await expect(all).toBeFocused();
        await all.click();
        await body.locator('#research-item-open').click();
        await expect(sheet).toHaveCount(0);
    });

    test('the button hidden at 1024 and 700 px (shown from 1025); what opens the menu from the state opens the sheet on its research page', async ({ page }) => {
        await page.setViewportSize({ width: 1025, height: 800 });
        await researchTree(page);
        await expect(button(page)).toBeVisible();
        for (const width of [1024, 700]) {
            await page.setViewportSize({ width, height: 800 });
            await expect(button(page)).toBeHidden();
        }
        await page.setViewportSize({ width: 900, height: 900 });
        await page.evaluate(() => window.Strom.UI.openResearchSyncMenu());
        await expect(page.locator('#research-sheet-menu')).toBeVisible();
        await expect(page.locator('#research-sheet-menu .research-menu-heading')).toContainText('Research');
        await expect(menu(page)).toBeHidden();
    });
});

test.describe('"Awaiting action" in every language', () => {
    for (const [lang, item, aria] of [
        ['cs', 'Čeká na vyřízení', 'Výzkum, čeká na vyřízení: 3'],
        ['de', 'Wartet auf Bearbeitung', 'Forschung, wartet auf Bearbeitung: 3'],
        ['en', 'Awaiting action', 'Research, awaiting action: 3'],
    ] as const) {
        test(`${lang}: the menu row and the button's name`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await researchTree(page, { waiting: WAITING });
            await page.evaluate((lang) => window.Strom.UI.setLanguage(lang), lang);
            await expect(button(page)).toHaveAttribute('aria-label', aria);
            await button(page).click();
            await expect(page.locator('#research-item-waiting .research-item-label')).toHaveText(item);
            await expect(page.locator('#research-item-waiting')).toHaveAttribute('aria-label', `${item}: 3`);
        });
    }
});
