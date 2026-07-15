import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Card density (A8). The card BOX differs per density and the layout engine is
 * told the size — if the two ever drift apart, cards overlap. Every density is
 * checked against real DOM rectangles, not just the config number.
 */
async function overlapCount(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
        const rects = [...document.querySelectorAll('.person-card')].map(c => c.getBoundingClientRect());
        let n = 0;
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                if (a.left < b.right - 1 && b.left < a.right - 1
                    && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++;
            }
        }
        return n;
    });
}

test('every density sizes the cards, tells the layout, and never overlaps', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    // Detailed is 98 tall since it carries an occupation line (see CARD_SIZE).
    const expected = { compact: [120, 40], normal: [130, 65], detailed: [150, 98] } as const;
    for (const d of ['compact', 'normal', 'detailed'] as const) {
        await page.evaluate((den) => window.Strom.UI.setCardDensity(den), d);
        await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe(d);

        // The layout config must match the CSS box, or spacing is computed for
        // the wrong card and cards collide.
        const cfg = await page.evaluate(() => {
            const c = (window.Strom.TreeRenderer as unknown as { config: { cardWidth: number; cardHeight: number } }).config;
            return [c.cardWidth, c.cardHeight];
        });
        expect(cfg).toEqual([...expected[d]]);
        // Measure a NON-focused card: the focus card is scaled up on purpose.
        const box = await card(page, 'Edmund').boundingBox();
        expect(Math.round(box!.width)).toBe(expected[d][0]);

        expect(await overlapCount(page)).toBe(0);
    }
});

test('compact hides years and the deceased dagger; detailed adds place and age', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        if (p) dm.updatePerson(p.id, { birthPlace: 'Greenwich Palace' });
    });

    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toHaveCount(0);
    await expect(card(page, 'Henry VIII').locator('.deceased-marker')).toBeHidden();
    await expect(card(page, 'Henry VIII').locator('.card-place')).toHaveCount(0);

    await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toHaveCount(1);
    await expect(card(page, 'Henry VIII').locator('.card-place')).toHaveCount(0);

    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    await expect(card(page, 'Henry VIII').locator('.card-place')).toHaveText('Greenwich Palace');
    await expect(card(page, 'Henry VIII').locator('.card-age')).toContainText(/\d/);
});

test('detailed cards never show a nonsense age for historical people', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));

    // Someone long dead WITHOUT a death date has no knowable age — counting to
    // today produced ages like 230.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        if (p) dm.updatePerson(p.id, { deathDate: '' });
        window.Strom.TreeRenderer.render();
    });
    await expect(card(page, 'Henry VIII').locator('.card-age')).toHaveCount(0);

    // Nobody in the sample tree shows an implausible age.
    const overMax = await page.evaluate(() =>
        [...document.querySelectorAll('.card-age')]
            .map(e => parseInt(e.textContent!.replace(/\D+/g, ''), 10))
            .filter(n => n > 120).length);
    expect(overMax).toBe(0);
});
