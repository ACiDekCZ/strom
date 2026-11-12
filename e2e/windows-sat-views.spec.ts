import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp, seedSetting, setFollowMode } from './helpers.js';

/**
 * A satellite's header in K2 (spec 079 §2, 2a–2f): the tree's name, the view
 * switcher (the view tabs from 960 px, below them "{view} ▾" with a menu of
 * the six views), "Follow selection", Undo, Redo and ⧉ "Open another
 * window". A switch changes this window only (the main window keeps its
 * view), outlives a reload of the window and is named in the main window's
 * list; ⧉ opens a third window of the same view with this window's state,
 * listed by the main window (Bring to front by its name); without the main
 * window ⧉ is disabled. Nothing in the header overflows or overlaps (de, 390
 * to 1440).
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Radhost', 'Kmínek', { birthDate: '1850-03-01', birthPlace: 'Brno', partnerships: ['u1'], childIds: ['c', 'e'] }),
    k: person('k', 'Vlastimila', 'Pšeničná', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c', 'e'] }),
    c: person('c', 'Bohuchval', 'Kmínek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
    e: person('e', 'Drahomíra', 'Kmínková', { gender: 'female', birthDate: '1878-09-10', parentIds: ['v', 'k'] }),
};
const PARTNERSHIPS = { u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c', 'e'], status: 'married' } };
/** About thirty characters: the header cuts it with an ellipsis where it has no room. */
const LONG_NAME = 'Kmínkovi ze Zadní Dlouhé Mezírky';
const NOW = new Date('2026-06-15T10:00:00Z');

async function openMain(page: Page, context: BrowserContext, name = 'Kmínek'): Promise<string> {
    await context.clock.install({ time: NOW });
    await openApp(page);
    const treeId = await page.evaluate(async ({ persons, partnerships, name }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships } as never, name);
        await window.Strom.TreeRenderer.setFocus('c' as never);
        return dm.getCurrentTreeId() as string;
    }, { persons: PERSONS, partnerships: PARTNERSHIPS, name });
    await expect(card(page, 'Bohuchval')).toBeVisible();
    return treeId;
}

/** A satellite of `kind`, connected to the main window (it has the tree). */
async function openSatellite(context: BrowserContext, treeId: string, kind: string, w: string, size = { width: 1200, height: 800 }): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize(size);
    await sat.goto(`/strom.html?okno=${kind}&tree=${encodeURIComponent(treeId)}&w=${w}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).not.toHaveText('');
    return sat;
}

const segment = (page: Page) => page.locator('.sat-header .sat-view-segment');
const viewBtn = (page: Page) => page.locator('.sat-header .sat-view-btn');
const another = (page: Page) => page.locator('.sat-header .sat-another');
const viewOf = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getViewMode());

/** Open the main window's ⧉ menu: its rows of open windows ("{view} · {tree}"). */
async function listedWindows(page: Page): Promise<string[]> {
    await page.locator('#view-window-btn').click();
    const names = await page.locator('#view-window-menu .view-window-name').allTextContents();
    await page.keyboard.press('Escape');
    return names;
}

/** Nothing in the header overflows it or overlaps another of its controls. */
async function headerFits(page: Page): Promise<void> {
    const r = await page.locator('.sat-header').evaluate((h) => {
        const kids = [...h.children].filter(el => (el as HTMLElement).offsetParent !== null && !el.classList.contains('sat-header-spacer'));
        const boxes = kids.map(el => { const b = el.getBoundingClientRect(); return { cls: el.className, left: b.left, right: b.right, width: b.width }; });
        const overlaps: string[] = [];
        for (let i = 1; i < boxes.length; i++) if (boxes[i].left < boxes[i - 1].right - 0.5) overlaps.push(`${boxes[i - 1].cls} / ${boxes[i].cls}`);
        const hb = h.getBoundingClientRect();
        const titleEl = h.querySelector('.sat-header-title') as HTMLElement;
        return {
            scroll: h.scrollWidth, client: h.clientWidth, overlaps,
            outside: boxes.filter(b => b.right > hb.right + 0.5 || b.left < hb.left - 0.5).map(b => b.cls),
            titleWidth: titleEl.getBoundingClientRect().width,
            titleCut: titleEl.scrollWidth > titleEl.clientWidth,
            docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(r.scroll, 'header scrollWidth').toBeLessThanOrEqual(r.client);
    expect(r.overlaps).toEqual([]);
    expect(r.outside).toEqual([]);
    expect(r.docScroll).toBeLessThanOrEqual(0);
    expect(r.titleWidth, 'the name keeps some room').toBeGreaterThan(20);
}

test.describe('the view switcher', () => {
    test('≥ 960: the view tabs switch this window only; the switch outlives a reload and the main window lists it', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const treeId = await openMain(page, context);
        const sat = await openSatellite(context, treeId, 'family', 'sv01aa', { width: 1200, height: 800 });

        await expect(sat.locator('.sat-header-title')).toHaveText('Kmínek');
        await expect(segment(sat)).toBeVisible();
        await expect(viewBtn(sat)).toBeHidden();
        await expect(segment(sat).locator('button')).toHaveText(['Family', 'Descendants', 'Timeline', 'Fan', 'Map', 'Table']);
        await expect(segment(sat).locator('button.active')).toHaveText('Family');
        await expect(sat).toHaveTitle('Family – Kmínek – Strom');

        await segment(sat).getByRole('button', { name: 'Timeline' }).click();
        await expect(sat.locator('#timeline-container')).toBeVisible();
        await expect(segment(sat).locator('button.active')).toHaveText('Timeline');
        await expect(segment(sat).getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true');
        await expect(sat).toHaveTitle('Timeline – Kmínek – Strom');
        expect(new URL(sat.url()).searchParams.get('okno')).toBe('timeline');

        // The main window keeps its view and lists the window's new one.
        expect(await viewOf(page)).toBe('family');
        await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
        await expect.poll(() => listedWindows(page)).toEqual(['Timeline · Kmínek']);

        // A reload of the window: the same view.
        await sat.reload();
        await expect(sat.locator('#timeline-container')).toBeVisible();
        await expect(segment(sat).locator('button.active')).toHaveText('Timeline');
        await expect(sat).toHaveTitle('Timeline – Kmínek – Strom');
        await expect.poll(() => listedWindows(page)).toEqual(['Timeline · Kmínek']);

        // Table ↔ chart in one window: the Table opens at the window's person, back to a chart again.
        await segment(sat).getByRole('button', { name: 'Table' }).click();
        await expect(sat.locator('#table-container .tv-body')).toBeVisible();
        await segment(sat).getByRole('button', { name: 'Descendants' }).click();
        await expect(segment(sat).locator('button.active')).toHaveText('Descendants');
        expect(new URL(sat.url()).searchParams.get('okno')).toBe('descendants');
        expect(await viewOf(page)).toBe('family');
        await sat.close();
    });

    test('< 960: one button "{view} ▾" with a menu of the six views (arrows, Enter, Esc)', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const treeId = await openMain(page, context);
        const sat = await openSatellite(context, treeId, 'map', 'sv02aa', { width: 760, height: 700 });

        await expect(segment(sat)).toBeHidden();
        await expect(viewBtn(sat)).toBeVisible();
        await expect(viewBtn(sat)).toHaveText(/^Map/);
        expect((await viewBtn(sat).boundingBox())!.height).toBe(30);

        await viewBtn(sat).click();
        const menu = sat.locator('.sat-view-menu');
        await expect(menu).toHaveAttribute('role', 'menu');
        await expect(menu.getByRole('menuitemradio')).toHaveCount(6);
        await expect(menu.getByRole('menuitemradio', { name: /Map/ })).toHaveAttribute('aria-checked', 'true');
        await expect(menu.getByRole('menuitemradio', { name: /Map/ })).toBeFocused();
        // Esc: closed, the focus back on the button, nothing switched.
        await sat.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(viewBtn(sat)).toBeFocused();

        // ArrowDown opens at the first view; the arrows go round; Enter switches.
        await sat.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitemradio', { name: 'Family' })).toBeFocused();
        await sat.keyboard.press('ArrowUp');
        await expect(menu.getByRole('menuitemradio', { name: 'Table' })).toBeFocused();
        await sat.keyboard.press('ArrowUp');
        await sat.keyboard.press('ArrowUp');
        await expect(menu.getByRole('menuitemradio', { name: 'Fan' })).toBeFocused();
        await sat.keyboard.press('Enter');
        await expect(menu).toHaveCount(0);
        await expect(sat.locator('#fan-container')).toBeVisible();
        await expect(viewBtn(sat)).toHaveText(/^Fan/);
        await expect(sat).toHaveTitle('Fan – Kmínek – Strom');
        expect(new URL(sat.url()).searchParams.get('okno')).toBe('fan');
        expect(await viewOf(page)).toBe('family');

        // Wider than 960: the tabs again, the same view.
        await sat.setViewportSize({ width: 1000, height: 700 });
        await expect(viewBtn(sat)).toBeHidden();
        await expect(segment(sat).locator('button.active')).toHaveText('Fan');
        await sat.close();
    });
});

test.describe('⧉ Open another window', () => {
    test('opens a third window of the same view with this window\'s state; the main window lists it and brings it forward by its name', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const treeId = await openMain(page, context);
        const sat = await openSatellite(context, treeId, 'descendants', 'sv03aa');
        await expect(another(sat)).toBeVisible();
        await expect(another(sat)).toBeEnabled();
        await expect(another(sat)).toHaveAccessibleName('Open another window');
        expect((await another(sat).boundingBox())!.width).toBe(32);

        // This window's person, not the main window's.
        await sat.evaluate(() => window.Strom.TreeRenderer.setFocus('e' as never));
        await expect.poll(() => sat.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('e');

        const [third] = await Promise.all([sat.waitForEvent('popup'), another(sat).click()]);
        await third.waitForLoadState('domcontentloaded');
        expect(new URL(third.url()).searchParams.get('okno')).toBe('descendants');
        await expect(third.locator('.sat-header-title')).toHaveText('Kmínek');
        await expect(third.locator('.sat-header .sat-view-segment button.active, .sat-header .sat-view-btn').first()).toBeVisible();
        await expect.poll(() => third.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('e');
        expect(await third.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
        // The main window: its own view and person, both windows listed.
        expect(await viewOf(page)).toBe('family');
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('c');
        await expect.poll(() => listedWindows(page)).toEqual(['Descendants · Kmínek', 'Descendants · Kmínek']);
        await expect(page.locator('#view-window-btn .view-window-count')).toHaveText('2 more windows');

        // Bring to front: found by its name (no blank window opens).
        const pages = context.pages().length;
        await page.locator('#view-window-btn').click();
        await page.locator('#view-window-menu .view-window-row').nth(1).locator('.view-window-front').click();
        await page.waitForTimeout(500);
        expect(context.pages().length).toBe(pages);
        expect(await third.evaluate(() => window.name)).toMatch(/^strom-w-/);

        // Close from the main window's list: the window goes.
        if (await page.locator('#view-window-menu').count() === 0) await page.locator('#view-window-btn').click();
        await page.locator('#view-window-menu .view-window-row').nth(1).locator('.view-window-close').click();
        await expect.poll(() => third.isClosed()).toBe(true);
        await sat.close();
    });

    test('blocked by the browser: the toast with Try again', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const treeId = await openMain(page, context);
        const sat = await openSatellite(context, treeId, 'map', 'sv04aa');
        await sat.evaluate(() => { window.open = (() => null) as unknown as typeof window.open; });
        await another(sat).click();
        const toast = sat.locator('.toast', { hasText: 'The browser blocked the new window.' });
        await expect(toast).toBeVisible();
        await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
        await sat.close();
    });

    test('without the main window ⧉ is disabled and says why', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const treeId = await openMain(page, context);
        const sat = await openSatellite(context, treeId, 'fan', 'sv05aa');
        await expect(another(sat)).toBeEnabled();
        await page.close();
        await expect(another(sat)).toBeDisabled({ timeout: 4500 });
        await expect(another(sat)).toHaveAttribute('title', /The main window is closed · as of \d{1,2}:\d{2}.*, read-only/);
        await sat.close();
    });
});

test.describe('the header fits (de)', () => {
    for (const width of [1440, 1024, 960, 959, 600, 390]) {
        test(`${width}: nothing overflows or overlaps; a long tree name is cut`, async ({ page, context }) => {
            await seedSetting(page, 'language', 'de');
            await page.setViewportSize({ width: 1440, height: 900 });
            const treeId = await openMain(page, context, LONG_NAME);
            const sat = await openSatellite(context, treeId, 'descendants', `sv1${width}`, { width, height: 700 });
            await expect(sat.locator('.sat-follow')).toHaveAttribute('aria-label', 'Auswahl folgen: wechseln');
            await expect(another(sat)).toHaveAccessibleName('Weiteres Fenster öffnen');
            if (width >= 960) await expect(segment(sat)).toBeVisible();
            else await expect(viewBtn(sat)).toBeVisible();
            // The name beside the mode, but next to the view tabs below 1200 px and on a phone width.
            await expect(sat.locator('.sat-follow-label')).toBeVisible({ visible: width >= 1200 || (width > 640 && width < 960) });
            await expect(sat.locator('.sat-follow-state')).toBeVisible({ visible: width > 640 });
            await headerFits(sat);
            // "Follow selection" (K2.1): its longest mode fits too; its menu stays inside the window, nothing in it cut.
            await setFollowMode(sat, 'mark');
            await headerFits(sat);
            await sat.locator('.sat-follow').click();
            const m = await sat.locator('.sat-follow-menu').evaluate((menu) => {
                const b = menu.getBoundingClientRect();
                const cut = [...menu.querySelectorAll<HTMLElement>('.view-window-item-label, .sat-follow-item-note')]
                    .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent);
                return { left: b.left, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight, cut, items: menu.querySelectorAll('[role="menuitemradio"]').length };
            });
            expect(m.items).toBe(3);
            expect(m.left).toBeGreaterThanOrEqual(0);
            expect(m.right).toBeLessThanOrEqual(m.vw);
            expect(m.bottom).toBeLessThanOrEqual(m.vh);
            expect(m.cut).toEqual([]);
            await sat.keyboard.press('Escape');
            if (width === 390) {
                expect(await sat.locator('.sat-header-title').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'), 'the long name is cut with an ellipsis').toBe(true);
            }
            await expect(sat).toHaveTitle(`Nachkommen – ${LONG_NAME} – Strom`);
            await sat.close();
        });
    }
});
