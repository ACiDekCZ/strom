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
    await expect(book.locator('.book-families > h2')).toHaveText('Families');
    await expect(book.locator('.book-index-page > h2')).toHaveText('Person index');
    await expect(book.locator('.book-chapter').first()).toBeVisible();

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

// N16: the tree page used to draw every card at the default 188x64 on a layout
// made for the density's own card (compact 150x44: overlapping cards, lines
// through them). Every density is drawn at the size the layout was made for.
for (const density of ['compact', 'normal', 'detailed'] as const) {
    test(`family book, ${density} cards: the tree page draws them at the layout's size, apart, no line through a card`, async ({ page, context }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(page.locator('#empty-state')).toBeHidden();
        await page.evaluate((d) => window.Strom.UI.setCardDensity(d), density);
        await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe(density);
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        const dialog = page.locator('#book-modal');
        await dialog.locator('#book-privacy-mode').selectOption('full');
        const [book] = await Promise.all([
            context.waitForEvent('page'),
            dialog.getByRole('button', { name: 'Open book' }).click(),
        ]);
        await book.waitForLoadState('domcontentloaded');
        const svg = await book.locator('.book-tree-wrap svg').evaluate(el => el.outerHTML);
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
            .map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
        // The layout the book was made from.
        const view = await page.evaluate(() => {
            const r = window.Strom.TreeRenderer as unknown as { config: { cardWidth: number; cardHeight: number } };
            const layout = window.Strom.TreeRenderer.getPosterLayout();
            return {
                width: r.config.cardWidth, height: r.config.cardHeight,
                cards: [...layout.positions.values()].map(p => ({ x: p.x, y: p.y })),
            };
        });
        const expected = { compact: [150, 44], normal: [188, 64], detailed: [200, 100] }[density];
        expect([view.width, view.height]).toEqual(expected);

        // One card per laid-out person, each where the layout put it and as large as the layout's card.
        expect(rects).toHaveLength(view.cards.length);
        for (const c of view.cards) {
            const r = rects.find(x => Math.abs(x.x - c.x) < 0.06 && Math.abs(x.y - c.y) < 0.06);
            expect(r, `card at ${c.x},${c.y}`).toBeTruthy();
            expect([r!.w, r!.h]).toEqual(expected);
        }
        // No two cards overlap.
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
                expect(overlap, `cards ${i} and ${j}`).toBe(false);
            }
        }
        // No tree line runs through a card (lines touch a card only at its edge).
        const lines = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)]
            .map(m => m.slice(1, 5).map(Number));
        expect(lines.length).toBeGreaterThan(0);
        for (const [x1, y1, x2, y2] of lines) {
            for (const r of rects) {
                const through = Math.max(x1, x2) > r.x + 1 && Math.min(x1, x2) < r.x + r.w - 1
                    && Math.max(y1, y2) > r.y + 1 && Math.min(y1, y2) < r.y + r.h - 1;
                expect(through, `line ${x1},${y1}-${x2},${y2} through card at ${r.x},${r.y}`).toBe(false);
            }
        }
        // The density's look: compact is the name only (no avatar), normal a
        // 34px avatar, detailed a 44px one.
        const avatars = [...svg.matchAll(/<circle [^>]*r="(\d+)"/g)].map(m => Number(m[1]));
        if (density === 'compact') expect(avatars).toEqual([]);
        else expect(new Set(avatars)).toEqual(new Set([density === 'detailed' ? 22 : 17]));
    });
}
