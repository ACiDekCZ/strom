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

    // "Letopis" card boxes (see CARD_SIZE): normal 188x64, compact names-only,
    // detailed taller for the occupation/age lines.
    const expected = { compact: [150, 44], normal: [188, 64], detailed: [200, 100] } as const;
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

test('compact hides the meta row; normal and detailed show life years, place and age', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        if (p) dm.updatePerson(p.id, { birthPlace: 'Greenwich Palace' });
    });

    // Compact: names only, no meta row.
    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toHaveCount(0);

    // Normal: meta row carries the life-year range and the birth place.
    await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toHaveCount(1);
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toContainText('Greenwich Palace');

    // Detailed: keeps the meta row and adds the age line.
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    await expect(card(page, 'Henry VIII').locator('.birth-date')).toContainText('Greenwich Palace');
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
