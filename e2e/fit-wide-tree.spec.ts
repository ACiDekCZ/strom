import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, seedSetting } from './helpers.js';

/**
 * Fit to screen shows the whole tree also when it is too wide for the manual
 * zoom floor (T04): wide custom cards on a phone used to stop at the floor and
 * overflow the screen. Invented data.
 */

/** A couple with many children, every name long enough to widen the custom card. */
async function seedWideFamily(page: Page): Promise<void> {
    await createFirstPerson(page, 'Bohuslav', 'Wolkenstein-Trostburg', { gender: 'male' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const father = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Bohuslav')!;
        const mother = dm.createPerson({
            firstName: 'Maximiliána', lastName: 'Wolkenstein-Trostburgová', gender: 'female', birthDate: '1852',
        });
        const union = dm.createPartnership(father.id, mother.id);
        const names = ['Adalbert', 'Bonifác', 'Cyprián', 'Dobroslav', 'Emerich', 'Felicián', 'Gothard',
            'Hilarion', 'Ignác', 'Jaroslav', 'Kryštof', 'Leopold', 'Metoděj', 'Norbert'];
        names.forEach((first, i) => {
            const kid = dm.createPerson({
                firstName: first + ' Maria', lastName: 'Wolkenstein-Trostburg', gender: 'male', birthDate: String(1875 + i),
            });
            dm.addParentChild(father.id, kid.id, union.id);
            dm.addParentChild(mother.id, kid.id, union.id);
        });
        window.Strom.TreeRenderer.setFocus(father.id);
    });
    await expect(card(page, 'Norbert')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

/** How far the cards stick out of the tree container after the view settles (px, 0 = all inside). */
async function overflow(page: Page): Promise<number> {
    return page.evaluate(() => {
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        let out = 0;
        for (const el of document.querySelectorAll('#tree-canvas .person-card')) {
            const r = el.getBoundingClientRect();
            out = Math.max(out, box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom);
        }
        return Math.max(0, out);
    });
}

const scale = (page: Page) => page.evaluate(() => window.Strom.ZoomPan.getScale());

test('fit to screen shows a tree of wide custom cards whole on a phone, and manual zoom reaches that view (T04)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await seedWideFamily(page);
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('custom');
    // The custom card really is wide (a name over the default width).
    const cardWidth = await page.evaluate(() =>
        (window.Strom.TreeRenderer as unknown as { config: { cardWidth: number } }).config.cardWidth);
    expect(cardWidth).toBeGreaterThan(240);

    await page.evaluate(() => window.Strom.ZoomPan.fitToScreen());
    const fitScale = await scale(page);
    // The tree needs more than the manual floor allows…
    expect(fitScale).toBeLessThan(0.15);
    // …and every card is on screen.
    expect(await overflow(page)).toBe(0);

    // The − button at the fit view does not jump back in.
    await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
    await page.waitForTimeout(300);
    expect(await scale(page)).toBeCloseTo(fitScale, 5);

    // Zooming in from there works.
    await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
    await page.waitForTimeout(300);
    expect(await scale(page)).toBeGreaterThan(fitScale * 1.2);

    // Zooming out by hand (wheel) from a close view reaches the fit view, not only the old floor.
    await page.evaluate(() => window.Strom.ZoomPan.reset());
    await page.mouse.move(195, 420);
    for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(20);
    }
    await expect.poll(() => scale(page)).toBeLessThanOrEqual(fitScale + 1e-6);
    expect(await scale(page)).toBeGreaterThanOrEqual(fitScale * 0.9);
});

test('fit to screen of a tree that fits keeps its scale and the zoom floor stays 0.15 (T04)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await seedWideFamily(page);
    await page.evaluate(() => window.Strom.ZoomPan.fitToScreen());
    const fitScale = await scale(page);
    expect(fitScale).toBeGreaterThan(0.15);
    expect(await overflow(page)).toBe(0);
    // Manual zoom out stops at the usual floor.
    for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
        await page.waitForTimeout(240);
    }
    expect(await scale(page)).toBeCloseTo(0.15, 5);
});
