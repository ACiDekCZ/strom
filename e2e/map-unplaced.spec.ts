/**
 * The selection's people without a place (spec 098 §5): the map's status
 * bar says how many have no place of any kind (only in the scope
 * Selection), and its line opens the Table with them — a list in the
 * list's scope, another selection in the scope "Selection: …" (Scope ▾'s
 * part Window selection) — with the chip "No place" on. Invented names only.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedPathTree, stubTiles } from './map-path-fixture.js';

async function setup(page: Page): Promise<void> {
    await stubTiles(page);
    // Wren: a second child of Fennick without any place (Elowen has none either).
    await seedPathTree(page, {
        wren: { firstName: 'Wren', lastName: 'Yarrowby', gender: 'male', birthDate: '1934', parents: ['fennick'] },
    }, { timeOn: false });
    await page.evaluate(() => {
        const D = window.Strom.DataManager;
        D.createPersonList({ name: 'Quillfen line', dynamic: false, personIds: ['tamsin', 'orrin', 'corwen', 'ansel'] as never[], sort: 'manual' });
        D.createPersonList({ name: 'Mixed', dynamic: false, personIds: ['tamsin', 'elowen', 'bram'] as never[], sort: 'manual' });
    });
}

const sel = (page: Page): Locator => page.locator('#map-scope-sel');
const pop = (page: Page): Locator => page.locator('#map-container .map-scope-pick .sp-rodpick-pop');
const line = (page: Page): Locator => page.locator('#map-status .map-status-unplaced');
const tv = (page: Page, s: string): Locator => page.locator(`#table-container ${s}`);
const shownKeys = (page: Page) => tv(page, '.tv-body .tv-row[data-key]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key!).filter(k => !k.includes('#')).sort());

async function pickList(page: Page, name: string): Promise<void> {
    await sel(page).click();
    await expect(pop(page)).toBeVisible();
    await pop(page).locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    await expect(pop(page)).toHaveCount(0);
}

/** The descendants of a person found by the choice's search. */
async function pickDescendants(page: Page, query: string): Promise<void> {
    await sel(page).click();
    await expect(pop(page)).toBeVisible();
    await pop(page).locator('.sp-rodpick-q').fill(query);
    await pop(page).locator('li[data-found][data-sel^="des:"] button').first().click();
    await expect(pop(page)).toHaveCount(0);
}

test.describe('the selection\'s people without a place', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a selection that is not a list: the line with the count, the Table in the scope "Selection: …" with No place @smoke', async ({ page }) => {
        await setup(page);
        // The whole tree and This view: no line.
        await expect(page.locator('#map-status')).toBeVisible();
        await expect(line(page)).toHaveCount(0);

        await pickDescendants(page, 'Fennick');
        await expect(sel(page)).toHaveClass(/active/);
        await expect(line(page)).toHaveText('2 people in the selection have no place ›');
        await expect(page.locator('#map-status .map-status-text')).toBeVisible();

        await line(page).click();
        await expect(page.locator('#table-container')).toBeVisible();
        const scope = tv(page, '.tv-scope-btn');
        await expect(scope).toContainText('Selection: Descendants: Fennick Yarrowby');
        await expect(scope).toHaveClass(/is-sel/);
        const chip = tv(page, '.tv-chip[data-chip="noPlace"]');
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect(chip).toHaveText('✓ No place');
        await expect(chip).toHaveAttribute('title', 'People with no place of birth, marriage, death or other event');
        expect(await shownKeys(page)).toEqual(['p:elowen', 'p:wren']);
        // No # column for a selection (it has no order of its own).
        await expect(tv(page, '.tv-headrow [data-col="num"]')).toHaveCount(0);

        // The chip off: the selection's people all, still in its scope.
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'false');
        expect(await shownKeys(page)).toEqual(['p:elowen', 'p:fennick', 'p:wren']);

        // Scope ▾: the part Window selection with the selection ticked, the whole tree back.
        await scope.click();
        const menu = page.locator('.tv-scope-menu');
        await expect(menu).toBeVisible();
        await expect(menu).toContainText('Window selection');
        const selRow = menu.locator('.tv-menu-item', { hasText: 'Selection: Descendants: Fennick Yarrowby' });
        await expect(selRow).toHaveAttribute('aria-checked', 'true');
        await menu.locator('.tv-menu-item', { hasText: 'Whole tree' }).click();
        await expect(scope).not.toHaveClass(/is-sel/);
        await expect(tv(page, '.tv-status-count')).toHaveText('11 of 11 people');
    });

    test('a list: the Table in the list\'s scope with No place; everybody placed: no line', async ({ page }) => {
        await setup(page);
        await pickList(page, 'Quillfen line');
        await expect(page.locator('.map-marker')).toHaveCount(4);
        await expect(line(page)).toHaveCount(0);

        await pickList(page, 'Mixed');
        await expect(line(page)).toHaveText('1 person in the selection has no place ›');
        await line(page).click();
        const scope = tv(page, '.tv-scope-btn');
        await expect(scope).toContainText('Mixed');
        await expect(scope).not.toHaveClass(/is-sel/);
        await expect(tv(page, '.tv-chip[data-chip="noPlace"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await shownKeys(page)).toEqual(['p:elowen']);
        // The list's part is among the lists, not under Window selection.
        await scope.click();
        await expect(page.locator('.tv-scope-menu')).not.toContainText('Window selection');
    });

    test('the empty map\'s link opens the same Table', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Unplaced', dynamic: false, personIds: ['elowen', 'wren'] as never[], sort: 'manual' });
        });
        await pickList(page, 'Unplaced');
        await expect(page.locator('.map-empty .map-empty-link')).toHaveText('2 people without a place ›');
        await page.locator('.map-empty .map-empty-link').click();
        await expect(tv(page, '.tv-scope-btn')).toContainText('Unplaced');
        await expect(tv(page, '.tv-chip[data-chip="noPlace"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await shownKeys(page)).toEqual(['p:elowen', 'p:wren']);
    });
});

test.describe('the selection\'s people without a place on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('the line is a 44 px target inside the bar; a tap opens the Table with them', async ({ page }) => {
        await setup(page);
        await page.locator('#map-container .map-scope-btn').click();
        const sheet = page.locator('.map-scope-sheet');
        await expect(sheet).toBeVisible();
        await sheet.locator('.map-scope-row[data-sel]', { hasText: 'Mixed' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(line(page)).toHaveText('1 person in the selection has no place ›');
        const box = (await line(page).boundingBox())!;
        const bar = (await page.locator('#map-status').boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(bar.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
        await line(page).tap();
        await expect(page.locator('#table-container')).toBeVisible();
        expect(await shownKeys(page)).toEqual(['p:elowen']);
    });
});
