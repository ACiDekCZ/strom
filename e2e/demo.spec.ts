import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

test('empty state offers a demo tree that loads with a focus, a hint, the Register card and its drawn pictures', async ({ page }) => {
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

    // It opens on the Register card (each event with its place and full date) and its drawn pictures.
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('register');
    await expect(card(page, 'Johan').locator('.card-line--label')).not.toHaveCount(0);
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

test('the sample opens on the Register card and leaves the Custom fields as they were (U03a)', async ({ page }) => {
    await openApp(page);
    // Custom fields saved earlier, no card type chosen yet.
    const mine = { on: ['marriage'], style: 'labels', widthCap: 400 };
    await page.evaluate((f) => {
        const raw = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
        localStorage.setItem('strom-settings', JSON.stringify({ ...raw, cardFields: f }));
    }, mine);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').cardFields);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.Strom.SettingsManager.getCardDensity())).toBe('register');
    // The Register lines, not the saved Custom ones (marriage only).
    await expect(card(page, 'Johan').locator('.card-line--birth')).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').cardFields)).toEqual(before);
});
