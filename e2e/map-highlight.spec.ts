/**
 * The window's selection highlighted on the map (spec 098 §11d): with the
 * scope This view or Whole tree the selection's points stand out, the others
 * are dimmed; a place's bubble lists the selection's people first and the
 * others under "Outside the selection"; a phone says it on a second line.
 * Without a selection nothing is dimmed.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedPathTree, stubTiles } from './map-path-fixture.js';

/** The path tree (map-path-fixture) with a list of four of its people, returned by id. */
async function setup(page: Page): Promise<string> {
    await stubTiles(page);
    await seedPathTree(page, {}, { timeOn: false });
    return page.evaluate(() => window.Strom.DataManager.createPersonList({
        name: 'Quillfen line', dynamic: false, personIds: ['tamsin', 'orrin', 'corwen', 'ansel'] as never[], sort: 'manual',
    })!.id);
}

const marker = (page: Page, key: string): Locator => page.locator(`.map-marker[data-key="${key}"]`);
const dimmed = (page: Page): Locator => page.locator('.map-marker.evidence-dim');

/** The list as the window's selection, then the Whole tree with it. */
async function listThenWholeTree(page: Page): Promise<void> {
    await page.locator('#map-scope-sel').click();
    const pop = page.locator('#map-container .map-scope-pick .sp-rodpick-pop');
    await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Quillfen line' }).locator('button').click();
    await expect(page.locator('#map-scope-sel')).toHaveClass(/active/);
    await page.locator('#map-scope-tree').click();
    await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);
}

test.describe('the selection highlighted on the map, a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Whole tree with a selection: points without its people dimmed, the bubble split; cleared: nothing dimmed @smoke', async ({ page }) => {
        const listId = await setup(page);
        // No selection: nothing dimmed, the bubble as it was.
        await expect(marker(page, 'zeta')).toBeVisible();
        await expect(dimmed(page)).toHaveCount(0);
        await marker(page, 'zeta').click();
        const popup = page.locator('.map-popup');
        await expect(popup).toContainText('Bram');
        await expect(popup.locator('.map-popup-outside-head')).toHaveCount(0);
        await expect(popup.locator('.is-dim')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await listThenWholeTree(page);
        // Tamsin, Orrin, Corwen, Ansel: Zeta, Eta, Iota, Lambda; Maelis (Theta), Ysolde (Kappa), Ivar (Mu) outside.
        for (const key of ['zeta', 'eta', 'iota', 'lambda']) await expect(marker(page, key)).not.toHaveClass(/evidence-dim/);
        for (const key of ['theta', 'kappa', 'mu']) await expect(marker(page, key)).toHaveClass(/evidence-dim/);
        await expect(marker(page, 'mu')).toHaveCSS('opacity', '0.45');
        // The desktop shows the selection in its scope: no second line.
        await expect(page.locator('.map-status-hl')).toBeHidden();

        // Zeta: Tamsin of the selection first, Bram under "Outside the selection", dimmed.
        await marker(page, 'zeta').click();
        await expect(popup.locator('.map-popup-summary')).toHaveText('2 people · 1 in the selection');
        const people = popup.locator('.map-popup-people');
        await expect(people.first()).toContainText('Tamsin');
        await expect(people.first()).not.toHaveClass(/is-dim/);
        await expect(popup.locator('.map-popup-outside-head')).toHaveText('Outside the selection');
        await expect(popup.locator('.map-popup-people.is-dim')).toContainText('Bram');
        await expect(popup.locator('.map-popup-people.is-dim')).not.toContainText('Tamsin');
        // A place of the selection alone: no outside part.
        await marker(page, 'lambda').click();
        await expect(popup).toContainText('Ansel');
        await expect(popup.locator('.map-popup-outside-head')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // The selection gone: nothing dimmed any more.
        await page.evaluate((l) => window.Strom.DataManager.deletePersonList(l), listId);
        await expect(dimmed(page)).toHaveCount(0);
    });
});

test.describe('the selection highlighted on the map, a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('the bar\'s quiet second line names the selection highlighted', async ({ page }) => {
        await setup(page);
        const btn = page.locator('#map-container .map-scope-btn');
        await expect(btn).toBeVisible();
        await expect(page.locator('.map-status')).toBeVisible();
        await expect(page.locator('.map-status-hl')).toHaveCount(0);

        await btn.click();
        await page.locator('.map-scope-sheet .map-scope-row[data-sel]', { hasText: 'Quillfen line' }).click();
        await expect(btn).toHaveText(/Scope:.*Quillfen line/);
        // In the scope Selection only its people are shown: no highlight, no line.
        await expect(page.locator('.map-status-hl')).toHaveCount(0);
        await btn.click();
        await page.locator('.map-scope-sheet [data-scope="tree"]').click();
        await expect(btn).toHaveText(/Scope:\s*Whole tree/);

        const line = page.locator('.map-status-hl');
        await expect(line).toBeVisible();
        await expect(line).toContainText('Quillfen line');
        await expect(line).toContainText('highlighted');
        await expect(marker(page, 'mu')).toHaveClass(/evidence-dim/);
        // Inside the bar, below its first line.
        const bar = (await page.locator('.map-status').boundingBox())!;
        const box = (await line.boundingBox())!;
        expect(box.y).toBeGreaterThan(bar.y + 8);
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    });
});

test.describe('the selection highlighted on the map, a phone, a long name', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('a long selection name wraps the second line: "highlighted" stays readable, the line inside the bar', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page, {}, { timeOn: false });
        await page.evaluate(() => window.Strom.DataManager.createPersonList({
            name: 'Letters to the Quillfen and Ostrowbek parishes', dynamic: false, personIds: ['tamsin', 'orrin'] as never[], sort: 'manual',
        }));
        const btn = page.locator('#map-container .map-scope-btn');
        await btn.click();
        await page.locator('.map-scope-sheet .map-scope-row[data-sel]', { hasText: 'Letters to the Quillfen and Ostrowbek parishes' }).click();
        await btn.click();
        await page.locator('.map-scope-sheet [data-scope="tree"]').click();

        const line = page.locator('.map-status-hl');
        await expect(line).toHaveText('Selection: List: Letters to the Quillfen and Ostrowbek parishes highlighted');
        // Nothing cut: the whole text in the line's box, on more than one line.
        const fit = await line.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, lh: parseFloat(getComputedStyle(el).lineHeight) }));
        expect(fit.sh).toBeLessThanOrEqual(fit.ch + 1);
        expect(fit.sw).toBeLessThanOrEqual(fit.cw + 1);
        expect(fit.ch).toBeGreaterThan(fit.lh * 1.5);
        const bar = (await page.locator('.map-status').boundingBox())!;
        const box = (await line.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});
