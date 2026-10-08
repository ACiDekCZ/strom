import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting, cardBoxesMatchLayout } from './helpers.js';

/**
 * Card types (A8, U03a). Compact and Normal are boxes of a fixed size the
 * layout engine is told (CARD_SIZE); Detailed and Register draw the lines of
 * their own preset fields as the Custom card draws the user's: as wide as the
 * view's texts (200–320), each card as tall as its content. Every type is
 * checked against real DOM rectangles, not just the config number. Invented
 * data (the sample tree).
 */
async function overlapCount(page: Page): Promise<number> {
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

async function sampleTree(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

const layoutBox = (page: Page) => page.evaluate(() => {
    const c = (window.Strom.TreeRenderer as unknown as { config: { cardWidth: number; cardHeight: number; personHeights?: Map<string, number> } }).config;
    return { width: c.cardWidth, height: c.cardHeight, own: !!c.personHeights };
});

test('every card type sizes the cards, tells the layout, and never overlaps', async ({ page }) => {
    await sampleTree(page);
    // "Letopis" card boxes (see CARD_SIZE): normal 188x64, compact names-only.
    const fixed = { compact: [150, 44], normal: [188, 64] } as const;
    for (const d of ['compact', 'normal', 'detailed', 'register', 'custom'] as const) {
        await page.evaluate((den) => window.Strom.UI.setCardDensity(den), d);
        await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe(d);
        await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
        const box = await layoutBox(page);
        if (d === 'compact' || d === 'normal') {
            // The layout config must match the CSS box, or spacing is computed for
            // the wrong card and cards collide.
            expect([box.width, box.height]).toEqual([...fixed[d]]);
            expect(box.own).toBe(false);
            await expect(page.locator('body')).not.toHaveAttribute('data-card-fields');
        } else {
            // A card of details: medium width, each card as tall as its content.
            expect(box.width).toBeGreaterThanOrEqual(200);
            expect(box.width).toBeLessThanOrEqual(320);
            expect(box.own).toBe(true);
            await expect(page.locator('body')).toHaveAttribute('data-card-fields', '');
            await expect(card(page, 'Johan').locator('.card-body--custom')).toHaveCount(1);
        }
        // Measure a NON-focused card: the focus card is scaled up on purpose.
        const maria = await card(page, 'Maria').evaluate(el => (el as HTMLElement).offsetWidth);
        expect(maria).toBe(box.width);
        expect(await overlapCount(page)).toBe(0);
    }
});

test('compact hides the meta row; normal shows the years and the place; Detailed a line per detail with the age', async ({ page }) => {
    await sampleTree(page);
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Johan');
        if (p) dm.updatePerson(p.id, { birthPlace: 'Greenwich Palace' });
    });

    // Compact: names only, no meta row.
    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await expect(card(page, 'Johan').locator('.birth-date')).toHaveCount(0);

    // Normal: meta row carries the life-year range and the birth place.
    await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
    await expect(card(page, 'Johan').locator('.birth-date')).toHaveCount(1);
    await expect(card(page, 'Johan').locator('.birth-date')).toContainText('Greenwich Palace');

    // Detailed: birth and death with their places, the age, the occupation —
    // the age a line of its own without a mark ("age 55"), from the date column.
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    const johan = card(page, 'Johan');
    await expect(johan.locator('.card-line--birth')).toContainText('Greenwich Palace');
    const age = johan.locator('.card-line--age');
    await expect(age).toHaveText(/^age \d+$/);
    await expect(age.locator('.card-line-mark')).toHaveText('');
    await expect(age.locator('.card-line-place--wide')).toHaveCount(1);
    // It starts where the dates do.
    const x = await johan.evaluate(el => ({
        age: el.querySelector('.card-line--age .card-line-place')!.getBoundingClientRect().left,
        date: el.querySelector('.card-line--birth .card-line-date')!.getBoundingClientRect().left,
    }));
    expect(Math.abs(x.age - x.date)).toBeLessThan(0.5);
    await expect(age).toHaveCSS('color', await johan.locator('.card-line--birth .card-line-place').evaluate(el => getComputedStyle(el).color));
    // The aria-label says it ("age 55").
    expect(await johan.getAttribute('aria-label')).toMatch(/, age \d+/);
    await expect(johan.locator('.card-place, .card-trade')).toHaveCount(0);
});

test('Detailed never shows a nonsense age, and none without a birth date', async ({ page }) => {
    await sampleTree(page);
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    // Someone long dead WITHOUT a death date has no knowable age — counting to
    // today produced ages like 230.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Johan');
        if (p) dm.updatePerson(p.id, { deathDate: '' });
        window.Strom.TreeRenderer.render();
    });
    await expect(card(page, 'Johan').locator('.card-line--age')).toHaveCount(0);
    // Without a birth date: no age line.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Maria');
        if (p) dm.updatePerson(p.id, { birthDate: '' });
        window.Strom.TreeRenderer.render();
    });
    await expect(card(page, 'Maria').locator('.card-line--age')).toHaveCount(0);

    // Nobody in the sample tree shows an implausible age.
    const ages = await page.evaluate(() => [...document.querySelectorAll('.person-card .card-line--age')]
        .map(e => parseInt(e.textContent!.replace(/\D+/g, ''), 10)));
    expect(ages.length).toBeGreaterThan(0);
    expect(ages.filter(n => n > 120)).toEqual([]);
});

test('the labels style: the age under the word "Age", the number as its value', async ({ page }) => {
    await seedSetting(page, 'cardFields', { on: ['birth', 'age'], style: 'labels' });
    await sampleTree(page);
    await page.evaluate(() => window.Strom.UI.setCardDensity('custom'));
    const age = card(page, 'Johan').locator('.card-line--age');
    await expect(age.locator('.card-line-label')).toHaveText('Age');
    await expect(age.locator('.card-line-value')).toHaveText(/^\d+$/);
});

test('a new user gets the Normal card; a stored type this version does not know is Normal too', async ({ page }) => {
    await sampleTree(page);
    // The sample opens on Register only when no type was chosen: start over without it.
    await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
        delete raw.cardDensity;
        localStorage.setItem('strom-settings', JSON.stringify(raw));
    });
    await page.reload();
    await expect(card(page, 'Johan')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.SettingsManager.getCardDensity())).toBe('normal');
    await expect(page.locator('body')).toHaveAttribute('data-card-density', 'normal');
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(page.locator('#card-type-row [aria-checked="true"] .card-type-name')).toHaveText('Normal');
    await expect(page.locator('#card-type-row .card-type-name')).toHaveText(['Compact', 'Normal', 'Detailed', 'Register', 'Custom…']);
    // The Normal card's sentence and no "Edit as Custom" (only the preset types have it).
    await expect(page.locator('#card-type-settings .card-type-desc')).toHaveText('Name, years and place of birth.');
    await expect(page.locator('#card-type-settings .card-type-edit')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
        localStorage.setItem('strom-settings', JSON.stringify({ ...raw, cardDensity: 'all' }));
    });
    await page.reload();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-card-density', 'normal');
});

test('a stored "detailed" opens as the new Detailed card; the stored Custom fields stay untouched', async ({ page }) => {
    const mine = { on: ['marriage'], style: 'labels', widthCap: 400 };
    await seedSetting(page, 'cardDensity', 'detailed');
    await seedSetting(page, 'cardFields', mine);
    await sampleTree(page);
    await expect(page.locator('body')).toHaveAttribute('data-card-density', 'detailed');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    // The preset's lines (marks, the age on), never the saved marriage-only labels.
    const johan = card(page, 'Johan');
    await expect(johan.locator('.card-line--birth')).toHaveCount(1);
    await expect(johan.locator('.card-line--age')).toHaveCount(1);
    await expect(johan.locator('.card-line--label')).toHaveCount(0);
    await expect(johan.locator('.card-line--marriage')).toHaveCount(0);
    // As tall as its content, at most the medium width.
    const box = await layoutBox(page);
    expect(box.own).toBe(true);
    expect(box.width).toBeLessThanOrEqual(320);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}'));
    expect(stored.cardDensity).toBe('detailed');
    expect(stored.cardFields).toEqual(mine);
    // Choosing Register or Detailed never writes the Custom fields.
    await page.evaluate(() => window.Strom.UI.setCardDensity('register'));
    await expect(johan.locator('.card-line--label').first()).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').cardFields)).toEqual(mine);
});
