import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

test('empty state offers a demo tree that loads with a focus and a hint', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();

    await page.getByRole('button', { name: 'Try a sample tree' }).click();

    // The sample (the Berg family) loads as a new tree.
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Sample: the Berg family');
    // Focus person is shown and several cards are rendered.
    await expect(card(page, 'Johan')).toBeVisible();
    expect(await page.locator('.person-card').count()).toBeGreaterThan(3);
    // Hint toast appears.
    await expect(page.locator('.toast')).toBeVisible();
});

test('the sample opens with the fullest card and its drawn pictures', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('custom');
    await expect(card(page, 'Johan').locator('.card-line')).not.toHaveCount(0);
    // Portraits, the register page and its crops are drawn on load, not shipped.
    const media = await page.evaluate(() => {
        const d = window.Strom.DataManager.getData();
        const persons = Object.values(d.persons);
        return {
            photos: persons.filter(p => p.photo?.startsWith('data:image/jpeg')).length,
            pages: persons.flatMap(p => p.attachments ?? []).length,
            crops: Object.values(d.sources ?? {}).flatMap(s => s.excerpts ?? []).length,
        };
    });
    expect(media).toEqual({ photos: 3, pages: 1, crops: 3 });
});

test('the sample keeps a card density the user already chose', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('compact');
});
