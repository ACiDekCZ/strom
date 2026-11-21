/**
 * The window's selection and the map's scope across windows and openings
 * (spec 098 §7): a new window (a chart, the Table) takes the main window's
 * selection, "Hide others" and the map's scope over, then has its own — a
 * change in one window changes no other, the satellite offers Select › in
 * the person menu and keeps its own selection over its reload; only the
 * main window remembers them for the tree, so they come back when the tree
 * is opened again without moving the focus; a deleted list clears the
 * selection with a toast and the map falls back to This view. Invented
 * names only (e2e/rods-fixture.ts).
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { openApp, reloadApp, card } from './helpers.js';
import { rodsTree } from './rods-fixture.js';
import { stubTiles } from './map-path-fixture.js';

async function setup(page: Page, focus = 'b16'): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([data, f]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(f as never);
        await S.TreeRenderer.renderAsync();
    }, [rodsTree(), focus] as const);
}

const host = (page: Page): Locator => page.locator('#view-rod-picker');
const pill = (page: Page): Locator => page.locator('#evidence-pill');
const pillName = (page: Page): Locator => pill(page).locator('.evidence-pill-label--pick');
const hide = (page: Page): Locator => pill(page).locator('.evidence-pill-hide');
const stored = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    return S.SettingsManager.getSelectionForTree(S.DataManager.getCurrentTreeId()) as { ref: Record<string, unknown>; hideOthers: boolean } | null;
});
const focusId = (page: Page): Promise<string | null> => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);

/** A list of people chosen as the window's selection from the toolbar's choice. */
async function chooseList(page: Page, name: string, ids: string[]): Promise<string> {
    const id = await page.evaluate(([n, p]) => window.Strom.DataManager.createPersonList({ name: n, dynamic: false, personIds: p as never[], sort: 'manual' })!.id, [name, ids] as const);
    await host(page).locator('.sp-rodpick-btn').click();
    const pop = host(page).locator('.sp-rodpick-pop');
    await expect(pop).toBeVisible();
    await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    await expect(pillName(page)).toContainText(name);
    return id;
}

/** A click that opens a satellite of `kind` from the view tab (Ctrl/Cmd+click). */
async function openWindow(page: Page, kind: 'family' | 'table' | 'map'): Promise<Page> {
    const [sat] = await Promise.all([page.waitForEvent('popup'), page.locator(`#view-mode-${kind}`).click({ modifiers: ['ControlOrMeta'] })]);
    await sat.waitForLoadState('domcontentloaded');
    expect(sat.url()).toContain(`okno=${kind}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    return sat;
}

/** Select › Ancestors of the person in the card's menu. */
async function selectAncestors(page: Page, name: string): Promise<void> {
    await card(page, name).click();
    const menu = page.locator('.context-menu.person-menu');
    await menu.locator('[data-menu="select"]').click();
    await page.locator('.context-submenu [data-action^="select:anc:"]').click();
    await expect(pillName(page)).toContainText(`Ancestors: ${name}`);
}

test.describe('the selection in windows', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a new window takes the selection, Hide others and the map\'s scope over, then has its own (its reload too) @smoke', async ({ page }) => {
        await setup(page);
        await chooseList(page, 'Letters', ['b14', 'b15']);
        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await page.evaluate(() => window.Strom.UI.setMapScope('sel'));

        const sat = await openWindow(page, 'family');
        await sat.setViewportSize({ width: 1300, height: 850 });
        await expect(card(sat, 'Mikael')).toBeVisible();
        await expect(hide(sat)).toHaveAttribute('aria-pressed', 'true');
        expect(await sat.evaluate(() => window.Strom.UI.mapScopeNow())).toBe('sel');

        // Its own: Select › in the satellite's person menu changes this window only.
        await selectAncestors(sat, 'Mikael');
        await expect(hide(sat)).toHaveAttribute('aria-pressed', 'true');
        await expect(pillName(page)).toContainText('Letters');
        expect((await stored(page))?.ref).toMatchObject({ kind: 'list' });
        // The main window's change does not reach it.
        await pill(page).locator('.evidence-pill-close').click();
        await expect(pill(page)).toBeHidden();
        await expect.poll(() => stored(page)).toBeNull();
        await sat.waitForTimeout(300);
        await expect(pillName(sat)).toContainText('Ancestors: Mikael');

        // The satellite's reload keeps its own selection (not the tree's memory, now none).
        await sat.reload();
        await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
        await expect(pillName(sat)).toContainText('Ancestors: Mikael');
        await expect(pill(page)).toBeHidden();
        await sat.close();
    });

    test('a Table window takes the selection over: its scope Window selection shows it', async ({ page }) => {
        await setup(page);
        await selectAncestors(page, 'Karl');
        const sat = await openWindow(page, 'table');
        await expect(sat.locator('#table-container .tv-body')).toBeVisible();
        await sat.evaluate(() => window.Strom.UI.openTableForSelection());
        const scope = sat.locator('#table-container .tv-scope-btn');
        await expect(scope).toHaveClass(/is-sel/);
        await expect(scope).toContainText('Karl');
        // Clearing it in the main window leaves the Table window's scope as it is.
        await pill(page).locator('.evidence-pill-close').click();
        await expect(pill(page)).toBeHidden();
        await sat.waitForTimeout(300);
        await expect(scope).toContainText('Karl');
        await sat.close();
    });
});

test.describe('the selection remembered for the tree', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the selection, Hide others and the map\'s scope come back when the tree opens again; the focus does not move', async ({ page }) => {
        await stubTiles(page);
        await setup(page);
        await chooseList(page, 'Letters', ['b14', 'b15']);
        await hide(page).click();
        await page.evaluate(() => window.Strom.UI.setMapScope('sel'));
        // Far from the list's people (none drawn).
        await page.evaluate(async () => { window.Strom.TreeRenderer.setFocus('h4' as never); await window.Strom.TreeRenderer.renderAsync(); });
        await expect(page.locator('#tree-canvas .person-card[data-id="b14"]')).toHaveCount(0);

        await reloadApp(page);
        await expect(pillName(page)).toContainText('Letters');
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        expect(await focusId(page)).toBe('h4');
        await page.locator('#view-mode-map').click();
        await expect(page.locator('#map-container')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('sel');
    });

    test('a deleted list: the selection cleared with a toast, the map back to This view without an error', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        await stubTiles(page);
        await setup(page);
        const id = await chooseList(page, 'Letters', ['b14', 'b15']);
        await page.locator('#view-mode-map').click();
        await expect(page.locator('#map-container')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.setMapScope('sel'));
        await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('sel');

        await page.evaluate((l) => window.Strom.DataManager.deletePersonList(l), id);
        // The toast (it may wait under another message of the moment, the newest showing).
        await expect(page.locator('body > .toast', { hasText: 'Selection cleared: the list “Letters” was deleted.' })).toBeAttached();
        await expect.poll(() => page.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('view');
        await expect.poll(() => stored(page)).toBeNull();
        await expect(page.locator('#map-scope-view')).toHaveClass(/active/);
        expect(errors).toEqual([]);
    });
});
