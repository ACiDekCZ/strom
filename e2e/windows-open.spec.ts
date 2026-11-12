import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * Open in a new window (spec 079 §1, §4): ⧉ beside the view tabs only in the
 * main window on a computer's system (also with a touch screen; not Android,
 * iOS or iPadOS), wider than a phone, not in an exported file;
 * Ctrl/Cmd+click, the middle button and the context menu (right click,
 * Shift+F10) on the Table tab open it in a new window and the main window
 * stays where it is; the Table's own ⧉ hands its state over (saved view,
 * filters, search, sort, selected row); with windows open ⧉ says how many and
 * its menu lists them (×, Close all); a window the browser blocks is said with
 * Try again; from five windows on the menu and a toast say what it costs.
 */

const FAMILY: Record<string, SeedPerson> = {
    a: { firstName: 'Ferdan', lastName: 'Oskvelt', birthDate: '1850-03-01', deathDate: '1910-05-02', partners: ['b'] },
    b: { firstName: 'Lumira', lastName: 'Haskendal', gender: 'female', birthDate: '1855-07-12', deathDate: '1920-01-09', partners: ['a'] },
    c: { firstName: 'Petrin', lastName: 'Oskvelt', birthDate: '1880-01-04', deathDate: '1950-02-03', parents: ['a', 'b'], partners: ['d'] },
    d: { firstName: 'Ilvena', lastName: 'Šťorbalová', gender: 'female', birthDate: '1884-09-20', deathDate: '1960-11-11', partners: ['c'] },
    e: { firstName: 'Ondrin', lastName: 'Oskvelt', birthDate: '1915-04-02', deathDate: '1990-06-30', parents: ['c', 'd'] },
    f: { firstName: 'Mareth', lastName: 'Oskvelt', gender: 'female', birthDate: '1952-08-14', parents: ['e'] },
    g: { firstName: 'Hedda', lastName: 'Prellwin', gender: 'female', birthDate: '1975-03-03' },
};

const windowBtn = (page: Page) => page.locator('#view-window-btn');
const windowMenu = (page: Page) => page.locator('#view-window-menu');
const tableTab = (page: Page) => page.locator('#view-mode-table');
const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);

async function openMain(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, FAMILY, 'Oskvelt', 'c');
}

/** window.open of the page answers with windows that are not there (the registry counts them; nothing loads). */
async function stubWindows(page: Page, blocked = false): Promise<void> {
    await page.evaluate((blocked) => {
        const w = window as unknown as { __realOpen?: typeof window.open };
        w.__realOpen ??= window.open;
        window.open = (() => (blocked ? null : { closed: false, focus() {}, close() { this.closed = true; } })) as unknown as typeof window.open;
    }, blocked);
}

/** A click that opens a satellite: the popup it opened, loaded as a Table window. */
async function popupOf(page: Page, click: () => Promise<void>): Promise<Page> {
    const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('okno=table');
    return popup;
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('⧉ is there; Ctrl/Cmd+click, the middle button and the context menu on the Table tab open a window and the main window stays', async ({ page }) => {
        await openMain(page);
        await expect(windowBtn(page)).toBeVisible();
        await expect(windowBtn(page)).toHaveAccessibleName('Open in a new window');
        // The hint is on the Table tab only.
        await expect(tableTab(page)).toHaveAttribute('title', /^Table · (Ctrl|⌘)\+click: in a new window$/);
        await expect(page.locator('#view-mode-family')).not.toHaveAttribute('title', /new window/);

        const stays = async () => {
            await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
            await expect(tableTab(page)).not.toHaveClass(/active/);
        };

        const p1 = await popupOf(page, () => tableTab(page).click({ modifiers: ['ControlOrMeta'] }));
        await stays();
        const p2 = await popupOf(page, () => tableTab(page).click({ button: 'middle' }));
        await stays();

        await tableTab(page).click({ button: 'right' });
        const ctx = page.locator('.view-window-ctx');
        await expect(ctx).toBeVisible();
        await expect(ctx.getByRole('menuitem')).toHaveText(/Table in a new window/);
        const p3 = await popupOf(page, () => ctx.getByRole('menuitem').click());
        await expect(ctx).toHaveCount(0);
        await stays();

        await tableTab(page).focus();
        await page.keyboard.press('Shift+F10');
        await expect(ctx).toBeVisible();
        await expect(ctx.getByRole('menuitem')).toBeFocused();
        const p4 = await popupOf(page, () => page.keyboard.press('Enter'));
        await stays();

        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(4);
        for (const p of [p1, p2, p3, p4]) await p.close();
    });

    test('the Table\'s ⧉ hands its saved view, filters, search, sort and selected row to the new window', async ({ page }) => {
        await openMain(page);
        await tableTab(page).click();
        await expect(tv(page, '.tv-status-count')).toHaveText('7 of 7 people');

        // A saved view with a filter, then a sort on top (changed), a search and a selected row.
        await tv(page, '.tv-chips .tv-chip[data-chip="deceased"]').click();
        await tv(page, '.tv-view-saveas').click();
        const input = page.locator('.tv-fpanel.tv-vpanel .tv-vname-input');
        await input.fill('Deceased line');
        await input.press('Enter');
        await expect(tv(page, '.tv-view-name')).toHaveText('Deceased line');
        await tv(page, '.tv-headrow [data-col="name"]').click();
        await expect(tv(page, '.tv-view-changed')).toBeVisible();
        await tv(page, '.tv-search-q').fill('Ondrin');
        await expect(tv(page, '.tv-status-count')).toHaveText('1 of 7 people');
        await tv(page, '.tv-body .tv-row[data-key="p:e"] [aria-colindex="2"]').click();
        await expect(tv(page, '.tv-body .tv-row[data-key="p:e"]')).toHaveAttribute('aria-selected', 'true');
        const sort = await tv(page, '.tv-status-sort').textContent();
        expect(sort).toBeTruthy();

        const btn = tv(page, '.table-bar__window');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAccessibleName('Open in a new window');
        const sat = await popupOf(page, () => btn.click());
        await expect(tv(sat, '.tv-status-count')).toHaveText('1 of 7 people');
        await expect(tv(sat, '.tv-view-name')).toHaveText('Deceased line');
        await expect(tv(sat, '.tv-view-changed')).toBeVisible();
        await expect(tv(sat, '.tv-chips .tv-chip[data-chip="deceased"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(tv(sat, '.tv-search-q')).toHaveValue('Ondrin');
        await expect(tv(sat, '.tv-status-sort')).toHaveText(sort!);
        await expect(tv(sat, '.tv-body .tv-row[data-key="p:e"]')).toHaveAttribute('aria-selected', 'true');
        // No ⧉ in a satellite.
        await expect(tv(sat, '.table-bar__window')).toBeHidden();
        await expect(sat.locator('#view-window-wrap')).toBeHidden();
        await sat.close();
    });

    test('with windows open ⧉ says how many; the menu lists them, × closes one, Close all the rest', async ({ page }) => {
        await openMain(page);
        await expect(page.locator('#view-window-btn .view-window-count')).toBeHidden();
        const p1 = await popupOf(page, () => tableTab(page).click({ modifiers: ['ControlOrMeta'] }));
        const p2 = await popupOf(page, () => tableTab(page).click({ modifiers: ['ControlOrMeta'] }));
        await expect(windowBtn(page)).toHaveClass(/has-windows/);
        await expect(page.locator('#view-window-btn .view-window-count')).toHaveText('2 more windows');
        await expect(windowBtn(page)).toHaveAccessibleName('Open in a new window · 2 more windows');

        await windowBtn(page).click();
        await expect(windowMenu(page)).toBeVisible();
        await expect(windowBtn(page)).toHaveAttribute('aria-expanded', 'true');
        const rows = windowMenu(page).locator('.view-window-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.first().locator('.view-window-name')).toHaveText('Table · Oskvelt');
        await expect(windowMenu(page).locator('.view-window-item[data-view="table"]')).toHaveText('Table');

        const closed = p1.waitForEvent('close');
        await rows.first().locator('.view-window-close').click();
        await closed;
        await expect(rows).toHaveCount(1);
        await expect(page.locator('#view-window-btn .view-window-count')).toHaveText('1 more window');

        const closed2 = p2.waitForEvent('close');
        await windowMenu(page).locator('.view-window-closeall').click();
        await closed2;
        await expect(windowMenu(page).locator('.view-window-list')).toHaveCount(0);
        await expect(windowBtn(page)).not.toHaveClass(/has-windows/);
        await expect(page.locator('#view-window-btn .view-window-count')).toBeHidden();

        // The keyboard: Esc closes and gives the focus back to ⧉.
        await page.keyboard.press('Escape');
        await expect(windowMenu(page)).toHaveCount(0);
        await expect(windowBtn(page)).toBeFocused();
    });

    test('a window the browser blocks: the toast says so, Try again opens it', async ({ page }) => {
        await openMain(page);
        await stubWindows(page, true);
        await tableTab(page).click({ modifiers: ['ControlOrMeta'] });
        const toast = page.locator('.toast.show');
        await expect(toast).toContainText('The browser blocked the new window.');
        const retry = toast.getByRole('button', { name: 'Try again' });
        await expect(retry).toBeVisible();
        await expect(page.locator('#view-mode-family')).toHaveClass(/active/);

        // Allowed meanwhile: Try again opens the window.
        await page.evaluate(() => { window.open = (window as unknown as { __realOpen: typeof window.open }).__realOpen; });
        const sat = await popupOf(page, () => retry.click());
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(1);
        await sat.close();
    });

    test('from five windows on: a box in the menu and a toast after opening one more', async ({ page }) => {
        await openMain(page);
        await stubWindows(page);
        await page.evaluate(() => { for (let i = 0; i < 5; i++) window.Strom.Windows!.openSatellite('table', undefined); });
        await expect(page.locator('#view-window-btn .view-window-count')).toHaveText('5 more windows');
        await tableTab(page).click({ modifiers: ['ControlOrMeta'] });
        await expect(page.locator('.toast.show')).toContainText('6 windows open. Each extra window needs memory');
        await windowBtn(page).click();
        await expect(windowMenu(page).locator('.view-window-many')).toHaveText('6 windows open. Each extra window needs memory; with a large tree the app may slow down.');
        await expect(windowMenu(page).locator('.view-window-row')).toHaveCount(6);
    });

    test('an exported file offers no windows', async ({ page }) => {
        await openMain(page);
        await expect(windowBtn(page)).toBeVisible();
        await page.evaluate(() => {
            (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true;
            window.dispatchEvent(new Event('resize'));
        });
        await expect(page.locator('#view-window-wrap')).toBeHidden();
        await tableTab(page).click({ modifiers: ['ControlOrMeta'] });
        expect(await page.evaluate(() => window.Strom.Windows?.size)).toBe(0);
        await expect(tableTab(page)).not.toHaveAttribute('title', /new window/);
    });
});

test.describe('tablet width with a mouse (1024)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('⧉ is in the toolbar and its menu opens the Table', async ({ page }) => {
        await openMain(page);
        await expect(windowBtn(page)).toBeVisible();
        await windowBtn(page).focus();
        await page.keyboard.press('ArrowDown');
        const item = windowMenu(page).locator('.view-window-item[data-view="table"]');
        await expect(item).toBeFocused();
        const sat = await popupOf(page, () => page.keyboard.press('Enter'));
        await expect(page.locator('#view-window-btn .view-window-count')).toHaveText('1');
        await sat.close();
    });

    test('the Table\'s ⧉ stays in the bar\'s first row beside Export (in de)', async ({ page }) => {
        await openMain(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
        const btn = tv(page, '.table-bar__window');
        await expect(btn).toBeVisible();
        const b = (await btn.boundingBox())!;
        const exp = (await tv(page, '.tv-export-btn').boundingBox())!;
        const seg = (await tv(page, '.tv-rowtype').boundingBox())!;
        expect(Math.abs((b.y + b.height / 2) - (seg.y + seg.height / 2))).toBeLessThan(2);
        expect(b.x).toBeGreaterThan(exp.x + exp.width);
        expect(b.x + b.width).toBeLessThanOrEqual(1024);
    });
});

const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const UA_ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** No ⧉ anywhere, and Ctrl+click on the Table tab just switches. */
async function expectNoWindows(page: Page): Promise<void> {
    await expect(page.locator('#view-window-wrap')).toBeHidden();
    await expect(tableTab(page)).not.toHaveAttribute('title', /new window/);
    await tableTab(page).click({ modifiers: ['ControlOrMeta'] });
    await expect(tableTab(page)).toHaveClass(/active/);
    expect(await page.evaluate(() => window.Strom.Windows?.size)).toBe(0);
    await expect(tv(page, '.tv-grid')).toBeVisible();
    await expect(tv(page, '.table-bar__window')).toBeHidden();
}

// Tester, 12 Nov 2026: a Surface (Windows, touch screen) reports its primary
// pointer as touch; ⧉ follows the system, not the pointer.
test.describe('a computer with a touch screen (1280, Windows)', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, userAgent: UA_WINDOWS });

    test('⧉ is there although the pointer is coarse; Ctrl+click on the Table tab opens a window', async ({ page }) => {
        await openMain(page);
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches)).toBe(true);
        await expect(windowBtn(page)).toBeVisible();
        const sat = await popupOf(page, () => tableTab(page).click({ modifiers: ['ControlOrMeta'] }));
        await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
        await sat.close();
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
        await expect(tv(page, '.table-bar__window')).toBeVisible();
    });
});

test.describe('an Android tablet (1280)', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, userAgent: UA_ANDROID_TABLET });

    test('no ⧉, and Ctrl+click on the Table tab just switches', async ({ page }) => {
        await openMain(page);
        await expectNoWindows(page);
    });
});

test.describe('an iPad asking for desktop pages as a Mac (1280)', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true, userAgent: UA_MAC_SAFARI });

    test('no ⧉ (its touch points tell it from a Mac)', async ({ page }) => {
        await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5, configurable: true }); });
        await openMain(page);
        await expectNoWindows(page);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('no ⧉ anywhere', async ({ page }) => {
        await openMain(page);
        await expect(page.locator('#view-window-wrap')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
        await expect(tv(page, '.tv-grid')).toBeVisible();
        await expect(tv(page, '.table-bar__window')).toBeHidden();
    });
});
