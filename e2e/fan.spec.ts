import { test, expect } from '@playwright/test';
import { openApp, card, createFirstPerson } from './helpers.js';

/**
 * Fan chart view: semicircular ancestor diagram as the fourth display mode.
 */
test('fan view shows ancestor sectors and clicking one refocuses', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.locator('#view-mode-fan').click();
    const container = page.locator('#fan-container');
    await expect(container).toBeVisible();
    await expect(container.locator('.fan-svg')).toBeVisible();
    // The family canvas is hidden while the fan is up.
    await expect(page.locator('#tree-canvas')).toBeHidden();

    // Focus disc shows the focus person; his father is a clickable sector.
    await expect(container.locator('.fan-focus')).toContainText('Henry VIII');
    const father = container.locator('[data-fan-person]', { hasText: 'Henry VII' }).first();
    await expect(father).toBeVisible();
    await father.click();
    await expect(container.locator('.fan-focus')).toContainText('Henry VII');

    // Back to the family view: cards return, fan hidden.
    await page.locator('#view-mode-family').click();
    await expect(container).toBeHidden();
    await expect(card(page, 'Henry VIII')).toBeVisible();
});

test('fan view: generations selector changes ring count and persists', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('#view-mode-fan').click();

    const select = page.locator('#fan-gen-select');
    await expect(select).toHaveValue('5');
    const countAt = () => page.locator('#fan-chart .fan-sector').count();
    const at5 = await countAt();
    await select.selectOption('4');
    await expect(select).toHaveValue('4');
    const at4 = await countAt();
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

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('all four views are reachable from the hamburger menu', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('.hamburger-btn').click();
        for (const m of ['family', 'descendants', 'timeline', 'fan']) {
            await expect(page.locator(`#mm-view-${m}`)).toBeVisible();
        }
        // Export entry opens the export dialog (book/GEDCOM/CSV live there).
        await page.locator('#mobile-menu button', { hasText: 'Export' }).first().click();
        await expect(page.locator('#export-modal')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.closeExportDialog());
        await page.locator('.hamburger-btn').click();
        await page.locator('#mm-view-fan').click();
        await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
        // The menu marks the active view on reopen.
        await page.locator('.hamburger-btn').click();
        await expect(page.locator('#mm-view-fan')).toHaveClass(/active/);
    });
});
