import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * A parent linked to his parents in the view only, over a wide family: the
 * focus Paula has two marriages with ten children, her father Ivo is linked
 * to Albert and Clara by an open hypothesis (H0001 A), and their other
 * children Edith, Felix and Greta (married to Hugo), none with children,
 * come in as Paula's aunts and uncle. They stood beyond the whole width of
 * Paula's family, at the edge of the tree, the grandparents' line running
 * across the tree to them; they now stand beside Ivo. Invented data only
 * (e2e/fixtures/research-hypothesis-wide-family.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-wide-family.ged', 'utf-8');

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'research-hypothesis-wide-family.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** Show H0001 A (Ivo a son of Albert and Clara), or switch the view links off; focus Paula. */
async function show(page: Page, master: boolean): Promise<void> {
    await page.evaluate((master) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify([{
            hypo: 'H0001', variant: 'A', kind: 'child', anchorId: byRefn('P0002'),
            islandIds: [byRefn('P0010'), byRefn('P0011')], on: true, addedAt: 1,
        }]));
        if (master) localStorage.removeItem(`strom-view-links-master:${treeId}`);
        else localStorage.setItem(`strom-view-links-master:${treeId}`, 'false');
        S.TreeRenderer.setFocus(byRefn('P0001'));
    }, master);
}

test.describe('linked in the view only: aunts and uncles over a wide family', () => {
    test('the parent\'s siblings stand beside him, not beyond the width of the family below', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await dropFile(page, GED);
        await expect(card(page, 'Paula')).toBeVisible();

        await show(page, true);
        for (const name of ['Albert', 'Clara', 'Edith', 'Felix', 'Greta', 'Hugo']) {
            await expect(card(page, name)).toHaveClass(/view-ghost/);
        }
        await expect(card(page, 'Ivo')).not.toHaveClass(/view-ghost/);

        // One run in Ivo's row: no gap between neighbouring cards wider than a
        // quarter of a card (the card gap); before, Greta stood about six card
        // widths away from Ivo
        const boxes = [];
        for (const name of ['Edith', 'Felix', 'Greta', 'Hugo', 'Ivo']) {
            const box = (await card(page, name).boundingBox())!;
            boxes.push({ name, ...box });
        }
        const top = boxes[4].y;
        for (const b of boxes) expect(Math.abs(b.y - top), `${b.name} in Ivo's row`).toBeLessThan(2);
        boxes.sort((a, b) => a.x - b.x);
        for (let i = 1; i < boxes.length; i++) {
            const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width);
            expect(gap, `gap between ${boxes[i - 1].name} and ${boxes[i].name}`).toBeLessThan(boxes[i].width / 4);
        }

        // The view links off: the shown family is gone again
        await show(page, false);
        await expect(card(page, 'Paula')).toBeVisible();
        for (const name of ['Albert', 'Edith', 'Greta']) await expect(page.locator('.person-card', { has: page.locator('.name-text', { hasText: name }) })).toHaveCount(0);
    });
});
