import { test, expect } from '@playwright/test';
import { openApp, card, createFirstPerson } from './helpers.js';

/**
 * Fan chart view: semicircular ancestor diagram as the fourth display mode.
 */
test('fan view shows ancestor sectors and clicking one refocuses', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    await page.locator('#view-mode-fan').click();
    const container = page.locator('#fan-container');
    await expect(container).toBeVisible();
    await expect(container.locator('.fan-svg')).toBeVisible();
    // The family canvas is hidden while the fan is up.
    await expect(page.locator('#tree-canvas')).toBeHidden();

    // Focus disc shows the focus person; his father is a clickable sector.
    await expect(container.locator('.fan-focus')).toContainText('Johan');
    const father = container.locator('[data-fan-person]', { hasText: 'Peter' }).first();
    await expect(father).toBeVisible();
    await father.click();
    await expect(container.locator('.fan-focus')).toContainText('Peter');

    // Back to the family view: cards return, fan hidden.
    await page.locator('#view-mode-family').click();
    await expect(container).toBeHidden();
    await expect(card(page, 'Johan')).toBeVisible();
});

test('fan view: generations selector changes ring count and persists', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('#view-mode-fan').click();

    const select = page.locator('#fan-gen-select');
    await expect(select).toHaveValue('5');
    const countAt = () => page.locator('#fan-chart .fan-sector').count();
    // Counted once the chart is drawn (a slow machine counts a half-drawn fan otherwise).
    const settled = async (): Promise<number> => {
        let last = -1;
        await expect.poll(async () => { const n = await countAt(); const same = n > 0 && n === last; last = n; return same; },
            { intervals: [150] }).toBe(true);
        return last;
    };
    const at5 = await settled();
    await select.selectOption('4');
    await expect(select).toHaveValue('4');
    const at4 = await settled();
    expect(at4).toBeLessThanOrEqual(at5);
});

test('fan view: empty ancestor slot offers adding a parent', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#view-mode-fan').click();
    const container = page.locator('#fan-container');
    await expect(container).toBeVisible();

    // Jan has no parents: two dashed "+" slots, click opens the add-parent modal.
    const addSlots = container.locator('[data-fan-add]');
    await expect(addSlots).toHaveCount(2);
    await addSlots.first().click();
    await expect(page.locator('#relation-modal')).toBeVisible();
});

test('Kekule numbers are off by default, drawn when enabled, always in the tooltip (K9)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();

    // Default: no numbers drawn, but the tooltip carries the ahnentafel.
    await expect(page.locator('.fan-kekule')).toHaveCount(0);
    await expect(page.locator('.fan-sector title').first()).toHaveText(/^#2 · Peter/);

    // Enabled: numbers appear in the sectors.
    await page.evaluate(() => window.Strom.UI.toggleFanKekule(true));
    await expect.poll(() => page.locator('.fan-kekule').count()).toBeGreaterThan(0);
    await expect(page.locator('.fan-kekule').first()).toHaveText(/^\d+$/);

    await page.evaluate(() => window.Strom.UI.toggleFanKekule(false));
    await expect(page.locator('.fan-kekule')).toHaveCount(0);
});

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the primary views live on the bottom bar; Fan opens from the More sheet', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        // The three primary views are bottom-bar tabs.
        for (const m of ['family', 'descendants', 'timeline']) {
            await expect(page.locator(`#bb-view-${m}`)).toBeVisible();
        }
        // Fan lives in the More sheet.
        await page.locator('#bb-view-more').click();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Fan' }).click();
        await expect(page.locator('#fan-container .fan-svg')).toBeVisible();

        // The bottom bar marks "More" active while a sheet view (fan) is shown.
        await expect(page.locator('#bb-view-more')).toHaveClass(/active/);
        // Reopening the sheet marks the Fan row active.
        await page.locator('#bb-view-more').click();
        await expect(page.locator('.bottom-sheet-menu .bottom-sheet-item.active', { hasText: 'Fan' })).toBeVisible();
    });
});
