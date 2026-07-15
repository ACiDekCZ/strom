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

test('family book: the initials privacy default also hides living names in the tree page', async ({ page, context }) => {
    await openApp(page);
    // A living person (recent birth, no death date) plus a deceased relative
    // (born 1850 → the 110-year heuristic marks them deceased).
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const living = dm.createPerson({ firstName: 'Zivana', lastName: 'Soukroma', gender: 'female', birthDate: '1990' });
        const dead = dm.createPerson({ firstName: 'Stary', lastName: 'Predek', gender: 'male', birthDate: '1850' });
        dm.addParentChild(dead.id, living.id);
        window.Strom.TreeRenderer.setFocus(living.id);
        window.Strom.TreeRenderer.render();
    });

    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toBeVisible();
    // Default privacy is initials — leave it.
    await expect(dialog.locator('#book-privacy-mode')).toHaveValue('initials');

    const [book] = await Promise.all([
        context.waitForEvent('page'),
        dialog.getByRole('button', { name: 'Open book' }).click(),
    ]);
    await book.waitForLoadState('domcontentloaded');

    // The living person's full name appears NOWHERE — chapters, index, nor the
    // embedded tree SVG (regression: the overview SVG used unfiltered data).
    const html = await book.content();
    expect(html).not.toContain('Zivana');
    expect(html).toContain('Predek'); // the deceased relative stays readable
});

test('book window carries its own Print and Close controls', async ({ page, context }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.loadDemoTree());
    await expect(page.locator('.person-card').first()).toBeVisible();
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const popup = context.waitForEvent('page');
    await page.locator('#book-modal button', { hasText: 'Open book' }).click();
    const book = await popup;
    await book.waitForLoadState('domcontentloaded');
    await expect(book.locator('.book-toolbar')).toBeVisible();
    // Clicking Close runs window.close(); the click races with the page
    // tearing down, so tolerate the "page closed" error and assert the result.
    await Promise.all([
        book.waitForEvent('close').catch(() => { /* already closed */ }),
        book.locator('.book-toolbar button', { hasText: 'Close' })
            .click({ noWaitAfter: true }).catch(() => { /* page closed mid-click */ }),
    ]);
    await expect.poll(() => book.isClosed()).toBe(true);
});
