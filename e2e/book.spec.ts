import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('family book: dialog generates a printable book in a new window, with its own Close', async ({ page, context }) => {
    await openApp(page);
    // A populated tree so the book has content.
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();

    // Open the export menu and pick "Family book".
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.locator('#export-modal').locator('.menu-option', { hasText: 'Family book' }).click();

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
    await expect(book.locator('body')).toContainText('Johan');
    await expect(book.locator('.book-title-page h1')).toBeVisible();
    await expect(book.locator('#book-toc .book-toc-rod').first()).toBeVisible();
    await expect(book.locator('.book-rod').first()).toBeVisible();
    await expect(book.locator('.book-family').first()).toBeVisible();
    await expect(book.locator('.book-index-page > h2')).toHaveText('Person index');

    // The book window carries its own Print and Close controls. Clicking Close
    // runs window.close(); the click races with the page tearing down, so
    // tolerate the "page closed" error and assert the result.
    await expect(book.locator('.book-toolbar')).toBeVisible();
    await Promise.all([
        book.waitForEvent('close').catch(() => { /* already closed */ }),
        book.locator('.book-toolbar button', { hasText: 'Close' })
            .click({ noWaitAfter: true }).catch(() => { /* page closed mid-click */ }),
    ]);
    await expect.poll(() => book.isClosed()).toBe(true);
});

test('family book: the initials privacy default also hides living names in the lineage tree', async ({ page, context }) => {
    await openApp(page);
    // A living person (recent birth, no death date) plus a deceased couple
    // (born 1850 → the 110-year heuristic marks them deceased): a chapter of
    // the Predek line, the living daughter in its lineage tree and index.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const living = dm.createPerson({ firstName: 'Zivana', lastName: 'Predkova', gender: 'female', birthDate: '1990' });
        const dead = dm.createPerson({ firstName: 'Stary', lastName: 'Predek', gender: 'male', birthDate: '1850' });
        const wife = dm.createPerson({ firstName: 'Stara', lastName: 'Lomikarova', gender: 'female', birthDate: '1852' });
        const union = dm.createPartnership(dead.id, wife.id)!;
        dm.addParentChild(dead.id, living.id, union.id);
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

    // The living person's full name appears NOWHERE — contents, chapters,
    // lineage tree, nor the index.
    await expect(book.locator('.book-rod-lineage').first()).toBeVisible();
    const html = await book.content();
    expect(html).not.toContain('Zivana');
    expect(html).toContain('Predek'); // the deceased relative stays readable
    // No drawn tree page: the lineage tree is text.
    expect(html).not.toContain('foreignObject');
    await expect(book.locator('.book-tree-wrap')).toHaveCount(0);
});

test('family book: a childless couple\'s story is a subchapter after the main-line partner\'s chapter (spec 027, 1031)', async ({ page, context }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();
    // A second, childless marriage of a parent from the first chapter, with a story of its own.
    await page.evaluate(() => {
        type U = { id: string; person1Id: string; person2Id: string; childIds: string[] };
        const data = structuredClone(window.Strom.DataManager.getData());
        const host = (Object.values(data.partnerships) as U[]).find(u => u.childIds.length > 0)!;
        const h = data.persons[host.person1Id];
        data.persons['p-rozalie'] = { id: 'p-rozalie', firstName: 'Rozalie', lastName: 'Testova', gender: 'female', isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: ['u-rozalie'], birthDate: '1700', deathDate: '1780' };
        data.partnerships['u-rozalie'] = { id: 'u-rozalie', person1Id: h.id, person2Id: 'p-rozalie', status: 'married', childIds: [],
            startDate: '1730', story: { status: 'final', text: 'The second marriage was short.' } };
        h.partnerships.push('u-rozalie');
        window.Strom.DataManager.replaceWithSourceData(data);
    });
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    await page.locator('#book-privacy-mode').selectOption('full');
    const [book] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('#book-modal').getByRole('button', { name: 'Open book' }).click(),
    ]);
    await book.waitForLoadState('domcontentloaded');
    // The childless union is a subchapter of its own, with the couple's story.
    const sub = book.locator('article.book-family.is-sub', { hasText: 'Rozalie Testova' });
    await expect(sub).toHaveCount(1);
    await expect(sub.locator('.book-family-head h2')).toContainText(/ and Rozalie Testova$/);
    await expect(sub.locator('.book-story h4')).toContainText(/ and Rozalie Testova · 1730–/);
    await expect(sub).toContainText('The second marriage was short.');
    // In the contents one step further in than its parent chapter.
    await expect(book.locator('#book-toc li.book-toc-sub', { hasText: 'Rozalie Testova' })).toHaveCount(1);
    await book.close();
});
