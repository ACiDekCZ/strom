/**
 * On the map (spec 098 §6): a list from the dialog Lists of people (its
 * secondary button and its ⋯, the phone's sheet) and the Table's ⋯ in a
 * list's or the window selection's scope show the people on the Map in the
 * scope Selection, the window's selection being that list or selection. A
 * satellite's Table hands it to the main window; without the main window the
 * row is disabled and says why. Invented names only.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { seedPathTree, stubTiles } from './map-path-fixture.js';

async function setup(page: Page): Promise<void> {
    await stubTiles(page);
    await seedPathTree(page, {}, { timeOn: false });
    await page.evaluate(() => {
        const D = window.Strom.DataManager;
        D.createPersonList({ name: 'Quillfen line', dynamic: false, personIds: ['tamsin', 'orrin', 'corwen', 'ansel'] as never[], sort: 'manual' });
        D.createPersonList({ name: 'Others', dynamic: false, personIds: ['bram', 'fennick'] as never[], sort: 'manual' });
        window.Strom.UI.setDisplayViewMode('family');
    });
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
}

const listId = (page: Page, name: string) => page.evaluate((n) => window.Strom.DataManager.getPersonLists().find(x => x.name === n)!.id, name);
const lists = (page: Page) => page.locator('#person-lists-modal');
const tvItem = (page: Page, label: string) => page.locator('.tv-menu .tv-menu-item', { hasText: label });

/** The Map in the scope Selection with the window's selection `ref` (as the tree keeps it) and `n` markers. */
async function onMap(page: Page, ref: Record<string, string>, n: number): Promise<void> {
    await expect(page.locator('#map-container')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
    await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('sel');
    await expect.poll(() => page.evaluate(() => {
        const S = window.Strom;
        return S.SettingsManager.getSelectionForTree(S.DataManager.getCurrentTreeId())?.ref ?? null;
    })).toEqual(ref);
    await expect(page.locator('.map-marker')).toHaveCount(n);
}

test.describe('On the map', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('from the dialog Lists of people: the secondary button after Open in Table, and the list\'s ⋯ @smoke', async ({ page }) => {
        await setup(page);
        const id = await listId(page, 'Quillfen line');
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Quillfen line' }).click();
        const btn = d.locator('.pl-acts [data-key="on-map"]');
        await expect(btn).toHaveText('On the map');
        await expect(btn).toHaveAttribute('title', "Show the list's people on the map");
        await expect(btn).toHaveClass(/secondary/);
        // Right after the primary Open in Table.
        expect(await d.locator('.pl-acts > button').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key))).toEqual(['open-table', 'on-map', 'menu-detail']);
        await btn.click();
        await expect(d).toHaveCount(0);
        await onMap(page, { kind: 'list', listId: id }, 4);
        await expect(page.locator('#map-scope-sel')).toHaveClass(/active/);
        await expect(page.locator('#map-scope-sel')).toContainText('Quillfen line');

        // The list's ⋯: On the map right under Open in Table.
        const other = await listId(page, 'Others');
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        await d.locator('.pl-row', { hasText: 'Others' }).hover();
        await d.locator(`[data-key="dots-${other}"]`).click();
        const items = d.locator('.pl-menu .pl-menu-item');
        await expect(items.nth(0)).toHaveText('Open in Table');
        await expect(items.nth(1)).toHaveText('On the map');
        await d.locator('.pl-menu [data-key="menu-map"]').click();
        await expect(d).toHaveCount(0);
        await onMap(page, { kind: 'list', listId: other }, 2);
    });

    test('from the Table\'s ⋯: only in a list\'s or the selection\'s scope, the last row', async ({ page }) => {
        await setup(page);
        const id = await listId(page, 'Quillfen line');
        await page.locator('#view-mode-table').click();
        await page.locator('#table-container .tv-more-menu-btn').click();
        await expect(page.locator('.tv-menu')).toBeVisible();
        await expect(tvItem(page, 'On the map')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await page.evaluate((l) => window.Strom.UI.openTableInScope(l, {}), id);
        await page.locator('#table-container .tv-more-menu-btn').click();
        const last = page.locator('.tv-menu .tv-menu-item').last();
        await expect(last).toHaveText('On the map');
        await last.click();
        await onMap(page, { kind: 'list', listId: id }, 4);

        // The window selection's scope (descendants of Corwen), the map meanwhile in Whole tree: back to the selection.
        await page.evaluate(() => window.Strom.UI.showSelectionOnMap({ kind: 'descendants', personId: 'corwen' } as never));
        await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('sel');
        await page.evaluate(() => window.Strom.UI.setMapScope('tree'));
        await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('tree');
        await page.evaluate(() => window.Strom.UI.openTableForSelection());
        await expect(page.locator('#table-container .tv-scope-btn')).toHaveClass(/is-sel/);
        await page.locator('#table-container .tv-more-menu-btn').click();
        await tvItem(page, 'On the map').click();
        await onMap(page, { kind: 'descendants', personId: 'corwen' }, 3);
    });
});

test.describe('On the map on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the list\'s sheet: On the map under Open in Table', async ({ page }) => {
        await setup(page);
        const id = await listId(page, 'Quillfen line');
        await page.evaluate(() => window.Strom.UI.showPersonLists());
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Quillfen line' }).tap();
        await d.locator('.pl-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet.locator('.bottom-sheet-item').nth(0)).toHaveText('Open in Table');
        const row = page.locator('#pl-sheet-map');
        await expect(row).toHaveText('On the map');
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await row.tap();
        await onMap(page, { kind: 'list', listId: id }, 4);
    });
});

test.describe('On the map from a satellite\'s Table', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    async function openSatellite(context: BrowserContext, treeId: string): Promise<Page> {
        const sat = await context.newPage();
        await sat.setViewportSize({ width: 1200, height: 800 });
        await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=om01aa`);
        await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
        await expect(sat.locator('.sat-header-title')).not.toHaveText('');
        await expect(sat.locator('#table-container .tv-body')).toBeVisible();
        return sat;
    }

    test('the main window shows the list on its map; without it the row is disabled', async ({ page, context }) => {
        await setup(page);
        const id = await listId(page, 'Quillfen line');
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        const sat = await openSatellite(context, treeId);
        await sat.evaluate((l) => window.Strom.UI.openTableInScope(l, {}), id);
        await sat.locator('#table-container .tv-more-menu-btn').click();
        const row = tvItem(sat, 'On the map');
        await expect(row).not.toHaveAttribute('aria-disabled', 'true');
        await row.click();
        await onMap(page, { kind: 'list', listId: id }, 4);
        // The satellite keeps its Table.
        expect(await sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('table');

        await page.close();
        await expect.poll(() => sat.evaluate(() => window.Strom.UI.showOnMapState().disabled), { timeout: 4500 }).toBe(true);
        await sat.locator('#table-container .tv-more-menu-btn').click();
        await expect(row).toHaveAttribute('aria-disabled', 'true');
        await expect(row).toHaveAttribute('title', 'The main window is not open.');
        await sat.close();
    });
});
