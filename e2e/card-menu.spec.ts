import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, addRelation, openPersonSubmenu } from './helpers.js';

/**
 * The person menu: about ten rows on the first level — the person itself,
 * "Add" as a grid of buttons, kinship and archives, then "Research ›" (when
 * the research has anything) and "More ›" (lock, merge, delete). See docs
 * (local) ZADANI_DEV_menu-osoby-a-akce.md.
 */

/** The first level of the normal mode, the "Add" grid among it. */
const FIRST = ['focus', 'edit', 'sources', 'descendants', 'parent', 'partner', 'child', 'sibling', 'add-family',
    'relationship', 'archives'];

async function actionsOf(page: Page, selector: string): Promise<string[]> {
    return page.locator(`${selector} [data-action]`).evaluateAll(
        (els) => els.map((el) => (el as HTMLElement).dataset.action || ''));
}

/** The first level row by row: an action, `grid` for the Add buttons, `>name` for a submenu row. */
async function rowsOf(page: Page, selector: string): Promise<string[]> {
    return page.locator(`${selector} :is([data-action], [data-menu], .menu-chip-grid)`).evaluateAll((els) => {
        const out: string[] = [];
        for (const el of els as HTMLElement[]) {
            if (el.closest('.menu-chip-grid') && !el.classList.contains('menu-chip-grid')) continue;
            if (el.classList.contains('menu-chip-grid')) out.push('grid');
            else if (el.dataset.menu) out.push(`>${el.dataset.menu}`);
            else out.push(el.dataset.action || '');
        }
        return out;
    });
}

test('desktop: the first level, the Add grid, More › with Delete apart', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await card(page, 'Jan').click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    expect(await rowsOf(page, '.context-menu')).toEqual(
        ['focus', 'edit', 'sources', 'descendants', 'grid', 'relationship', 'archives', '>more']);
    // Labels without "Show": nouns open their dialog.
    await expect(menu.locator('[data-action="sources"]')).toHaveText('Sources');
    await expect(menu.locator('.menu-section-header')).toHaveText('Add');
    // The grid: no parent yet, so Parents comes first; buttons read in full.
    const grid = menu.locator('.menu-chip-grid');
    await expect(grid.locator('button')).toHaveText(['Parents', 'Partner', 'Child', 'Sibling', 'Family…']);
    await expect(grid.locator('[data-action="child"]')).toHaveAttribute('aria-label', 'Add child');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.menu-chip-grid')!).gridTemplateColumns.split(' ').length)).toBe(2);

    const more = await openPersonSubmenu(page, 'more');
    await expect(menu.locator('[data-menu="more"]')).toHaveAttribute('aria-expanded', 'true');
    expect(await actionsOf(page, '.context-submenu')).toEqual(['toggle-lock', 'merge', 'delete']);
    await expect(more.locator('.context-menu-divider')).toHaveCount(1);
    await expect(more.locator('[data-action="delete"]')).toHaveClass(/danger/);

    // Esc closes the flyout, a second Esc the menu.
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-submenu')).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Delete from More › asks first.
    await card(page, 'Jan').click();
    await openPersonSubmenu(page, 'more');
    await page.locator('.context-submenu [data-action="delete"]').click();
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    await expect(page.locator('.context-menu')).toHaveCount(0);
});

test('desktop: with two parents there is no Parents button; with one it comes first', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'parent', 'Petr', 'Novak');
    await card(page, 'Jan').click();
    await expect(page.locator('.context-menu .menu-chip-grid button').first()).toHaveAttribute('data-action', 'parent');
    await page.keyboard.press('Escape');
    await addRelation(page, 'Jan', 'parent', 'Marie', 'Novakova', 'female');
    await card(page, 'Jan').click();
    expect(await actionsOf(page, '.context-menu .menu-chip-grid')).toEqual(['partner', 'child', 'sibling', 'add-family']);
});

test('desktop: the keyboard — ↓ to More, → opens it on Lock, ← back to More', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await card(page, 'Jan').focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.context-menu');
    await expect(menu.locator('[data-action="focus"]')).toBeFocused();
    // Up from the first row wraps to the last one: More ›.
    await page.keyboard.press('ArrowUp');
    const more = menu.locator('[data-menu="more"]');
    await expect(more).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.context-submenu [data-action="toggle-lock"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.context-submenu [data-action="merge"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.context-submenu')).toHaveCount(0);
    await expect(more).toBeFocused();
    // Through every first-level row down to More ›.
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('[data-action="focus"]')).toBeFocused();
});

test('desktop: the flyout opens on hover, beside the menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await card(page, 'Jan').click();
    await page.locator('.context-menu [data-menu="more"]').hover();
    const sub = page.locator('.context-submenu');
    await expect(sub).toBeVisible();
    const geo = await page.evaluate(() => {
        const m = document.querySelector('.context-menu:not(.context-submenu)')!.getBoundingClientRect();
        const s = document.querySelector('.context-submenu')!.getBoundingClientRect();
        return { menuLeft: m.left, menuRight: m.right, subLeft: s.left, subRight: s.right };
    });
    expect(geo.subLeft >= geo.menuRight || geo.subRight <= geo.menuLeft).toBe(true);
    // Another row closes it again.
    await page.locator('.context-menu [data-action="archives"]').hover();
    await expect(sub).toHaveCount(0);
});

test('read-only: no Add grid, no More', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
    await card(page, 'Jan').click();
    expect(await rowsOf(page, '.context-menu')).toEqual(['focus', 'relationship', 'archives']);
});

test('a locked person: Unlock on the first level (a submenu of one is no submenu); a locked tree: not even that', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const id = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons)[0]);
    await page.evaluate((pid) => window.Strom.UI.runPersonMenuAction(pid as never, 'toggle-lock'), id);
    await card(page, 'Jan').click();
    expect(await rowsOf(page, '.context-menu')).toEqual(['focus', 'view', 'toggle-lock']);
    await expect(page.locator('.context-menu [data-action="toggle-lock"]')).toHaveText('Unlock');
    await page.keyboard.press('Escape');

    const tid = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((t) => window.Strom.UI.toggleTreeLock(t), tid);
    await card(page, 'Jan').click();
    expect(await rowsOf(page, '.context-menu')).toEqual(['focus', 'view']);
});

/**
 * In the bottom-navigation regime (≤ 1024px) the card menu is a bottom sheet,
 * like the "More" menu: a floating menu there ended up under the bottom bar
 * and the add button. Every row must be reachable and clickable.
 */
// One width per bottom-navigation band: 600 (≤ 640, phone chrome) and 1024
// (641–1024, the regime's upper boundary).
for (const width of [600, 1024]) {
    test(`card menu is a bottom sheet with every row clickable at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 720 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await card(page, 'Jan').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('Jan Novak');
        // Tiles first (Edit · Focus · Sources), then Add, the rows, More ›.
        expect(await actionsOf(page, '.bottom-sheet-person .sheet-tiles')).toEqual(['edit', 'focus', 'sources']);
        expect(await rowsOf(page, '.bottom-sheet-person .sheet-page-root')).toEqual(
            ['edit', 'focus', 'sources', 'grid', 'descendants', 'relationship', 'archives', '>more']);
        expect(await actionsOf(page, '.bottom-sheet-person .sheet-page-root').then(a => [...a].sort())).toEqual([...FIRST].sort());

        // Actionability (visible, stable, receives the pointer — not covered by
        // the bottom bar or the FAB) for every row, scrolling as needed.
        for (const action of FIRST) {
            await sheet.locator(`[data-action="${action}"]`).click({ trial: true });
        }

        // And a real click does its job.
        await sheet.locator('[data-action="edit"]').click();
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(sheet).toHaveCount(0);
    });
}

test.describe('phone 360 × 640', () => {
    test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

    test('tiles, the whole sheet without scrolling even with a notice; More › and ‹ Back in the same sheet', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const id = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons)[0]);
        await page.evaluate((pid) => {
            window.Strom.DataManager.updatePerson(pid as never, { question: 'Where did he live before the wedding? '.repeat(6).trim(), story: { text: 'A story.' } } as never);
            window.Strom.TreeRenderer.render();
        }, id);
        await card(page, 'Jan').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.sheet-tile')).toHaveText(['Edit', 'Focus', 'Sources', 'Story']);
        await expect(sheet.locator('.menu-signal')).toBeVisible();
        // Measured once the sheet has slid up.
        await page.waitForTimeout(300);
        const tile = await sheet.locator('.sheet-tile').first().boundingBox();
        expect(tile!.height).toBeGreaterThanOrEqual(63.5);
        const chip = await sheet.locator('.menu-chip').first().boundingBox();
        expect(chip!.height).toBeGreaterThanOrEqual(43.5);
        const fit = await sheet.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
        expect(fit.scroll, 'the whole sheet fits').toBeLessThanOrEqual(fit.client + 1);

        await sheet.locator('[data-menu="more"]').click();
        const sub = sheet.locator('.sheet-page-sub');
        await expect(sub).toBeVisible();
        await expect(sheet.locator('.sheet-page-root')).toBeHidden();
        await expect(sub.locator('.sheet-subhead-title')).toHaveText('More');
        expect(await actionsOf(page, '.bottom-sheet-person .sheet-page-sub')).toEqual(['toggle-lock', 'merge', 'delete']);
        await sub.locator('.sheet-back').click();
        await expect(sheet.locator('.sheet-page-root')).toBeVisible();
        await expect(sub).toBeHidden();
        await expect(sheet).toBeVisible();
    });

    test('a notice of 200 characters takes two lines at most; the whole text is its tooltip', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        const text = 'Which parish kept the record of his baptism: the register of Voss says nothing, the emigrant list names Bergen, and the census of 1870 gives a third place altogether.';
        const id = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons)[0]);
        await page.evaluate(([pid, q]) => {
            window.Strom.DataManager.updatePerson(pid as never, { question: q } as never);
            window.Strom.TreeRenderer.render();
        }, [id, text.padEnd(200, '.')]);
        await card(page, 'Jan').click();
        const signal = page.locator('.bottom-sheet-person .menu-signal-text');
        await expect(signal).toHaveAttribute('title', `Question: ${text.padEnd(200, '.')}`);
        // Two lines of the notice's text, not more (one line ≈ 1.2–1.5 × the font size).
        const geo = await signal.evaluate((el) => ({ height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) }));
        expect(geo.height).toBeGreaterThan(geo.font * 2);
        expect(geo.height).toBeLessThanOrEqual(geo.font * 3.2);
    });
});

test.describe('tablet 1366', () => {
    test.use({ viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: true });

    test('the person sheet and the More sheet are 560 px wide at most, centred', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await card(page, 'Jan').click();
        const box = await page.locator('.bottom-sheet-person').boundingBox();
        const vw = page.viewportSize()!.width;
        expect(box!.width).toBeLessThanOrEqual(560);
        expect(Math.abs(box!.x + box!.width / 2 - vw / 2)).toBeLessThanOrEqual(1);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.Strom.UI.showMoreMenuSheet());
        const more = await page.locator('.bottom-sheet-menu').boundingBox();
        expect(more!.width).toBeLessThanOrEqual(560);
        expect(Math.abs(more!.x + more!.width / 2 - vw / 2)).toBeLessThanOrEqual(1);
    });
});

/**
 * On desktop the floating menu lives between the toolbar and the window's
 * bottom edge: it never covers the toolbar, and a list taller than that
 * space scrolls instead of running off screen.
 */
test('desktop card menu stays below the toolbar and scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await card(page, 'Jan').click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
    expect(await actionsOf(page, '.context-menu')).toEqual(FIRST);

    const geo = await page.evaluate(() => {
        const m = document.querySelector('.context-menu') as HTMLElement;
        const r = m.getBoundingClientRect();
        const tb = document.querySelector('.toolbar')!.getBoundingClientRect();
        return {
            top: r.top, bottom: r.bottom, toolbarBottom: tb.bottom, vh: window.innerHeight,
            scrollable: m.scrollHeight > m.clientHeight,
            overflowY: getComputedStyle(m).overflowY,
        };
    });
    expect(geo.top).toBeGreaterThanOrEqual(geo.toolbarBottom);
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh - 8 + 0.5);
    expect(geo.scrollable, 'the list is taller than the space: it scrolls').toBe(true);
    expect(geo.overflowY).toBe('auto');

    // The last row is reachable by scrolling, and its flyout fits in the window.
    await menu.locator('[data-menu="more"]').click();
    const sub = await page.locator('.context-submenu').boundingBox();
    expect(sub!.y + sub!.height).toBeLessThanOrEqual(420 - 8 + 0.5);
});
