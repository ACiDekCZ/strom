import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('family book: dialog generates a printable book in a new window', async ({ page, context }) => {
    await openApp(page);
    // A populated tree so the book has content.
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();

    // Open the export menu and pick "Family Book".
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.locator('#export-modal').locator('.menu-option', { hasText: 'Family Book' }).click();

    const dialog = page.locator('#book-modal');
    await expect(dialog).toBeVisible();
    // Full privacy so demo names appear verbatim.
    await dialog.locator('#book-privacy-mode').selectOption('full');

    // Generating opens the book in a new tab.
    const [book] = await Promise.all([
        context.waitForEvent('page'),
        dialog.getByRole('button', { name: 'Open book' }).click(),
    ]);
    await book.waitForLoadState('domcontentloaded');

    // The book contains the demo tree's people and the expected structure.
    await expect(book.locator('body')).toContainText('Henry VIII');
    await expect(book.locator('.book-families > h2')).toHaveText('Families');
    await expect(book.locator('.book-index-page > h2')).toHaveText('Person Index');
    await expect(book.locator('.book-chapter').first()).toBeVisible();
});
