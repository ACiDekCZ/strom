/**
 * The family book (package 1031 §4, §6): the options dialog (presets, the
 * four kinds of selection and the House card for later, the parts with the
 * reasons they are unavailable, the estimate, the memory per tree and the
 * entries from the overview, the person card and a person), the book window
 * (toolbar, side contents, anchors, Save as HTML, Change options, Close) and
 * the book's content (privacy of the living, subchapters). Invented names
 * only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page): Promise<string> {
    await openApp(page);
    return page.evaluate(async (data) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, rodsTree());
}

async function openDialog(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

const kind = (dialog: Locator, k: string): Locator => dialog.locator(`input[name="book-kind"][value="${k}"]`);
const rodRow = (dialog: Locator, name: string): Locator => dialog.locator('.book-rod-row', { hasText: name }).locator('input');
const part = (dialog: Locator, k: string): Locator => dialog.locator(`.book-part[data-part="${k}"]`);
const estimatePages = async (dialog: Locator): Promise<number> =>
    Number((await dialog.locator('.book-estimate').textContent())!.match(/about (\d+) page/)![1]);

async function openBook(page: Page, context: BrowserContext): Promise<Page> {
    const [book] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('#book-modal #book-open').click(),
    ]);
    await book.waitForLoadState('domcontentloaded');
    return book;
}

test.describe('family book: the options dialog', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('structure: presets, four kinds and House later, the parts with their reasons; a change makes the preset Custom @smoke', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await expect(dialog.locator('#book-dlg-title')).toHaveText('Family book');
        const presets = dialog.locator('[data-preset]');
        await expect(presets).toHaveText(['For the family', 'For researchers', 'Custom']);
        await expect(dialog.locator('[data-preset="family"]')).toHaveAttribute('aria-checked', 'true');

        // What goes in the book: four kinds, the whole tree chosen; the House card is there, disabled.
        await expect(dialog.locator('.book-kind[data-kind] .book-kind-t')).toHaveText([
            'Whole tree', 'Family lines', 'Ancestors of a person', 'Descendants of a person',
        ]);
        await expect(kind(dialog, 'tree')).toBeChecked();
        const house = dialog.locator('.book-kind--house');
        await expect(house).toHaveAttribute('aria-disabled', 'true');
        await expect(house).toHaveText('House · later');
        await expect(house.locator('input')).toBeDisabled();
        // The tree's counts as the tree overview says them: 3 lines and 2 other families.
        await expect(dialog.locator('.book-kind[data-kind="tree"] .book-kind-h')).toHaveText('41 people · 3 family lines and 2 other families');

        // The parts: Families always in; what the tree lacks greyed with its reason.
        await expect(dialog.locator('.book-part')).toHaveCount(10);
        await expect(part(dialog, 'families').locator('input')).toBeChecked();
        await expect(part(dialog, 'families').locator('input')).toBeDisabled();
        await expect(part(dialog, 'history')).toHaveClass(/is-off/);
        await expect(part(dialog, 'history').locator('.book-part-r')).toHaveText('The tree has no history.');
        await expect(part(dialog, 'story').locator('.book-part-r')).toHaveText('The selection has no stories.');
        await expect(part(dialog, 'sources').locator('.book-part-r')).toHaveText('The selection has no sources.');
        await expect(part(dialog, 'media').locator('.book-part-r')).toHaveText('The tree has no photos or record clippings.');
        await expect(part(dialog, 'story').locator('input')).not.toBeChecked();
        await expect(part(dialog, 'smallRods').locator('input')).toBeChecked();
        await expect(part(dialog, 'chart').locator('.book-part-r')).toHaveText('');

        // Brief: no chart (with its reason) and the preset is Custom.
        await dialog.locator('[data-detail="brief"]').click();
        await expect(dialog.locator('[data-detail="brief"]')).toHaveAttribute('aria-checked', 'true');
        await expect(part(dialog, 'chart').locator('.book-part-r')).toHaveText('Only with the Normal and All detail.');
        await expect(part(dialog, 'chart').locator('input')).toBeDisabled();
        await expect(dialog.locator('[data-preset="custom"]')).toHaveAttribute('aria-checked', 'true');
        // A preset puts its choices back.
        await dialog.locator('[data-preset="research"]').click();
        await expect(dialog.locator('[data-preset="research"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-detail="all"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-switch="notes"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-switch="research"]')).toHaveAttribute('aria-checked', 'true');
        // Unticking a part, or a switch: Custom again.
        await part(dialog, 'index').locator('input').uncheck();
        await expect(dialog.locator('[data-preset="custom"]')).toHaveAttribute('aria-checked', 'true');
        await dialog.locator('[data-preset="family"]').click();
        await expect(part(dialog, 'index').locator('input')).toBeChecked();
        await expect(dialog.locator('[data-switch="notes"]')).toHaveAttribute('aria-checked', 'false');
        await dialog.locator('[data-switch="notes"]').click();
        await expect(dialog.locator('[data-preset="custom"]')).toHaveAttribute('aria-checked', 'true');

        // The side: title page, outline, estimate; Open book enabled.
        await expect(dialog.locator('.book-cover-title')).toHaveText('Brandvold');
        await expect(dialog.locator('.book-outline li').first()).toContainText('Brandvold family line');
        await expect(dialog.locator('.book-estimate')).toHaveText(/^about \d+ pages · \d+ people · \d+ chapters$/);
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('.book-open-hint')).toHaveText('The book opens in a new window. From there it can be printed or saved.');
    });

    test('family lines: none chosen → Open book disabled with the message; the estimate follows the choice; Other families only for the whole tree', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await kind(dialog, 'rods').check();
        await expect(dialog.locator('.book-rod-name')).toHaveText(['Brandvold', 'Hollberg', 'Tallqvist']);
        await expect(dialog.locator('.book-rods-small')).toHaveText('Other families (2 small family lines) are only in a book of the whole tree.');
        await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(0);
        await expect(dialog.locator('.book-estimate')).toHaveText('No family line is selected.');
        await expect(dialog.locator('#book-open')).toBeDisabled();
        await expect(part(dialog, 'smallRods').locator('.book-part-r')).toHaveText('Only in a book of the whole tree.');

        await rodRow(dialog, 'Tallqvist').check();
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('#book-title-input')).toHaveValue('Tallqvist family line');
        const one = await estimatePages(dialog);
        const oneText = await dialog.locator('.book-estimate').textContent();
        await rodRow(dialog, 'Brandvold').check();
        await expect(dialog.locator('.book-estimate')).not.toHaveText(oneText!);
        expect(await estimatePages(dialog)).toBeGreaterThan(one);
        // The lineages in the dialog's order, whatever order they were ticked in.
        await expect(dialog.locator('#book-title-input')).toHaveValue('Brandvold, Tallqvist family lines');
        await expect(dialog.locator('.book-outline li')).toContainText(['Brandvold family line', 'Tallqvist family line']);

        // A person kind: the focus person, 4 generations by default; one more grows the book.
        await kind(dialog, 'ancestors').check();
        await expect(dialog.locator('.book-person-name')).toHaveText('Mikael Brandvold (1958–)');
        await expect(dialog.locator('.book-gens-n')).toHaveText('4');
        await expect(dialog.locator('.book-gens-t')).toHaveText('generations up from this person');
        const before = await dialog.locator('.book-estimate').textContent();
        await dialog.locator('[data-gen="1"]').click();
        await expect(dialog.locator('.book-gens-n')).toHaveText('5');
        await expect(dialog.locator('.book-estimate')).not.toHaveText(before!);
        await expect(dialog.locator('#book-title-input')).toHaveValue('Ancestors of Mikael Brandvold');
        // Back to lineages: the choice made before is kept.
        await kind(dialog, 'rods').check();
        await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(2);
        // A title typed by hand, then back to the automatic one.
        await dialog.locator('#book-title-input').fill('Our families');
        await expect(dialog.locator('.book-cover-title')).toHaveText('Our families');
        await dialog.locator('.book-title-revert').click();
        await expect(dialog.locator('#book-title-input')).toHaveValue('Brandvold, Tallqvist family lines');
    });

    test('memory per tree: the options come back on reopening and after a reload, the selection\'s person and the title do not; card settings untouched', async ({ page }) => {
        const treeId = await setup(page);
        const others = () => page.evaluate((id) => {
            const all: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i)!;
                if (!k.startsWith('strom.book.')) all[k] = localStorage.getItem(k)!;
            }
            return { all, lifeline: window.Strom.SettingsManager.getLifelineDefaults(id) };
        }, treeId);
        const before = await others();
        let dialog = await openDialog(page);
        await dialog.locator('[data-detail="all"]').click();
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        await dialog.locator('[data-lang="de"]').click();
        await part(dialog, 'index').locator('input').uncheck();
        await kind(dialog, 'rods').check();
        await rodRow(dialog, 'Hollberg').check();
        await dialog.locator('#book-title-input').fill('A title of its own');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toHaveClass(/active/);
        expect(await page.evaluate((id) => !!localStorage.getItem(`strom.book.${id}`), treeId)).toBe(true);
        // The person card's settings and the timeline defaults are as they were.
        expect(await others()).toEqual(before);

        const check = async (): Promise<void> => {
            dialog = await openDialog(page);
            await expect(dialog.locator('[data-preset="custom"]')).toHaveAttribute('aria-checked', 'true');
            await expect(dialog.locator('[data-detail="all"]')).toHaveAttribute('aria-checked', 'true');
            await expect(dialog.locator('input[name="book-privacy"][value="full"]')).toBeChecked();
            await expect(dialog.locator('[data-lang="de"]')).toHaveAttribute('aria-checked', 'true');
            await expect(part(dialog, 'index').locator('input')).not.toBeChecked();
            // From the menu: the last lineages chosen (they still exist).
            await expect(kind(dialog, 'rods')).toBeChecked();
            await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(1);
            await expect(rodRow(dialog, 'Hollberg')).toBeChecked();
            // The title is never remembered: automatic, in the book's language.
            await expect(dialog.locator('#book-title-input')).toHaveValue('Stammlinie Hollberg');
            await page.evaluate(() => window.Strom.UI.closeBookDialog());
        };
        await check();
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await check();

        // Another tree remembers its own: the defaults there.
        await page.evaluate(async (data) => {
            await window.Strom.DataManager.importAsNewTree(data, 'Second');
        }, rodsTree());
        dialog = await openDialog(page);
        await expect(dialog.locator('[data-preset="family"]')).toHaveAttribute('aria-checked', 'true');
        await expect(kind(dialog, 'tree')).toBeChecked();
        await expect(dialog.locator('input[name="book-privacy"][value="initials"]')).toBeChecked();
    });

    test('entries: a lineage from the overview and from the person card, a person → descendants 4 generations', async ({ page }) => {
        const treeId = await setup(page);
        // The overview's lineage detail: "Family line book…".
        await page.evaluate((id) => window.Strom.UI.showTreeOverview(id, { section: 'rods' }), treeId);
        const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
        await expect(sec).toHaveAttribute('data-ready', 'true');
        await sec.locator('.tov-rod[data-rod]', { hasText: 'Tallqvist' }).locator('.tov-rod-row').click();
        await sec.locator('.tov-rod.is-open').getByRole('button', { name: 'Family line book…' }).click();
        let dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(page.locator('#tree-overview-modal.active')).toHaveCount(0);
        await expect(kind(dialog, 'rods')).toBeChecked();
        await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(1);
        await expect(rodRow(dialog, 'Tallqvist')).toBeChecked();
        await page.evaluate(() => window.Strom.UI.closeBookDialog());

        // The person card: ⋯ at the Family line row → "Family line book…".
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('b4' as never));
        const row = page.locator('#pm-rod');
        await row.locator('.pm-rod-more-btn').click();
        await row.locator('.pm-rod-menu [data-rod-act="book"]').click();
        dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        await expect(rodRow(dialog, 'Brandvold')).toBeChecked();
        await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(1);
        await page.evaluate(() => window.Strom.UI.closeBookDialog());

        // A person: their descendants, 4 generations.
        await page.evaluate(() => window.Strom.UI.openBookForPerson('b8' as never));
        await expect(kind(dialog, 'descendants')).toBeChecked();
        await expect(dialog.locator('.book-person-name')).toHaveText('Johan Brandvold (1795–1860)');
        await expect(dialog.locator('.book-gens-n')).toHaveText('4');
        await expect(dialog.locator('#book-title-input')).toHaveValue('Descendants of Johan Brandvold');
    });
});

test.describe('family book: the window', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('toolbar, side contents and anchors; Contents narrower; Save as HTML; Change options rewrites the same window; ✕ closes @smoke', async ({ page, context }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await kind(dialog, 'rods').check();
        await rodRow(dialog, 'Brandvold').check();
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        const pages = await estimatePages(dialog);
        const book = await openBook(page, context);
        await expect(dialog).not.toHaveClass(/active/);

        // The toolbar: the title and the estimate, Change options, Save as HTML, Print, ✕.
        const bar = book.locator('.book-toolbar');
        await expect(bar.locator('.book-bar-name')).toHaveText('Brandvold family line');
        await expect(bar.locator('.book-bar-pages')).toHaveText(` · about ${pages} pages`);
        await expect(bar.getByRole('button', { name: 'Change options' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Save as HTML' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Print' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Close' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Contents' })).toBeHidden();
        await expect(bar.getByRole('button', { name: 'More actions' })).toBeHidden();
        // The side contents (≥ 1100 px): a link per chapter to its #kap-N anchor.
        const side = book.locator('#book-side');
        await expect(side).toBeVisible();
        await expect(side.locator('a[href="#kap-1"]')).toHaveCount(1);
        const hrefs = await side.locator('a').evaluateAll(as => as.map(a => a.getAttribute('href')!));
        for (const h of hrefs) expect(await book.locator(h).count(), h).toBe(1);
        await side.locator('a[href="#kap-3"]').click();
        await expect(book).toHaveURL(/#kap-3$/);
        await expect(side.locator('a[href="#kap-3"]')).toHaveAttribute('aria-current', 'true');
        // The toolbar never covers the chapter it jumped to.
        const top = await book.locator('#kap-3').evaluate(el => el.getBoundingClientRect().top);
        expect(top).toBeGreaterThanOrEqual(52);

        // Narrower: the Contents button opens the contents as a panel.
        await book.setViewportSize({ width: 1000, height: 800 });
        await expect(side).toBeHidden();
        await bar.getByRole('button', { name: 'Contents' }).click();
        await expect(side).toBeVisible();
        await book.keyboard.press('Escape');
        await expect(side).toBeHidden();
        await book.setViewportSize({ width: 1440, height: 900 });

        // Save as HTML: "{title}.html", no research controls, its toolbar has Print only.
        const [download] = await Promise.all([
            book.waitForEvent('download'),
            bar.getByRole('button', { name: 'Save as HTML' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('Brandvold family line.html');
        const saved = readFileSync(await download.path(), 'utf-8');
        expect(saved).not.toContain('data-book-act="');
        expect(saved).not.toContain('strom-research://');
        expect(saved).not.toMatch(/<button[^>]*data-book-ui="(close|more)"/);
        expect(saved).toContain('Brandvold family line');
        const file = await context.newPage();
        await file.setViewportSize({ width: 1440, height: 900 });
        await file.setContent(saved);
        await expect(file.locator('.book-toolbar button:visible')).toHaveText(['Print']);
        await expect(file.locator('#book-side')).toBeVisible();
        await file.close();

        // Change options: the dialog with this book's options; Open book rewrites the same window.
        const count = context.pages().length;
        await bar.getByRole('button', { name: 'Change options' }).click();
        await expect(dialog).toHaveClass(/active/);
        await expect(rodRow(dialog, 'Brandvold')).toBeChecked();
        await expect(dialog.locator('input[name="book-privacy"][value="full"]')).toBeChecked();
        await rodRow(dialog, 'Tallqvist').check();
        await dialog.locator('#book-open').click();
        await expect(dialog).not.toHaveClass(/active/);
        expect(context.pages().length).toBe(count);
        await expect(book.locator('.book-bar-name')).toHaveText('Brandvold, Tallqvist family lines');
        // Its buttons still work after the rewrite (one download, not two).
        let downloads = 0;
        book.on('download', () => { downloads++; });
        const [again] = await Promise.all([
            book.waitForEvent('download'),
            book.locator('.book-toolbar').getByRole('button', { name: 'Save as HTML' }).click(),
        ]);
        expect(again.suggestedFilename()).toBe('Brandvold, Tallqvist family lines.html');
        await book.waitForTimeout(300);
        expect(downloads).toBe(1);

        // ✕ closes the window (the click races with the page tearing down).
        await Promise.all([
            book.waitForEvent('close').catch(() => { /* already closed */ }),
            book.locator('.book-toolbar').getByRole('button', { name: 'Close' })
                .click({ noWaitAfter: true }).catch(() => { /* page closed mid-click */ }),
        ]);
        await expect.poll(() => book.isClosed()).toBe(true);
    });
});

test.describe('family book: phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the dialog as rows with summaries and sub-sheets; the window with Contents, ⋯ and ✕', async ({ page, context }) => {
        await setup(page);
        const dialog = await openDialog(page);
        const modal = dialog.locator('.book-dlg');
        const over = await modal.evaluate(el => el.scrollWidth - el.clientWidth);
        expect(over).toBeLessThanOrEqual(0);
        // The rows with their summaries.
        await expect(dialog.locator('.book-sum-row .book-sum-l')).toHaveText([
            'Parts of the book', 'Detail per person', 'Notes and researcher data', 'Privacy of living people', 'Book language', 'Title',
        ]);
        await expect(dialog.locator('[data-sum="detail"]')).toHaveText('Normal');
        await expect(dialog.locator('[data-sum="privacy"]')).toHaveText('Initials');
        // A sub-sheet: its title and Back; Escape steps back, not out.
        await dialog.locator('[data-sub-open="parts"]').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('Parts of the book');
        await expect(part(dialog, 'index')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog.locator('.book-sub-title')).toHaveText('');
        await expect(dialog).toHaveClass(/active/);
        // Family lines through its row: the sub-sheet with the list.
        await dialog.locator('.book-kind[data-kind="rods"]').click();
        await dialog.locator('.book-kind[data-kind="rods"] .book-kind-sum').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('Family lines');
        await dialog.locator('.book-rod-row', { hasText: 'Brandvold' }).click();
        await dialog.locator('.book-sub-back').click();
        await expect(dialog.locator('.book-kind[data-kind="rods"] .book-sum-v')).toHaveText('Brandvold');
        await expect(dialog.locator('#book-open')).toBeEnabled();

        const book = await openBook(page, context);
        const bar = book.locator('.book-toolbar');
        await expect(bar.getByRole('button', { name: 'Contents' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'More actions' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Close' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'Save as HTML' })).toBeHidden();
        await expect(bar.locator('.book-bar-pages')).toBeHidden();
        expect(await book.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        // The life charts' year axes: no two years run together.
        await expect(book.locator('.pp-ch-axis').first()).toBeAttached();
        const crowded = await book.evaluate(() => [...document.querySelectorAll('.pp-ch-axis')].filter(ax => {
            const r = [...ax.querySelectorAll('span')].filter(s => s.getClientRects().length > 0).map(s => s.getBoundingClientRect());
            return r.some((a, i) => i > 0 && a.left < r[i - 1].right + 2);
        }).length);
        expect(crowded).toBe(0);
        await bar.getByRole('button', { name: 'More actions' }).click();
        const more = book.locator('.book-more');
        await expect(more).toBeVisible();
        // Share only where files can be shared (not in this browser).
        await expect(more.getByRole('menuitem')).toHaveText(['Save as HTML', 'Print', 'Change options']);
        await book.keyboard.press('Escape');
        await expect(more).toBeHidden();
        await bar.getByRole('button', { name: 'Contents' }).click();
        await expect(book.locator('#book-side')).toBeVisible();
        await book.locator('#book-side a[href="#kap-2"]').click();
        await expect(book.locator('#book-side')).toBeHidden();
        await expect(book).toHaveURL(/#kap-2$/);
    });
});

test.describe('family book: phone, German', () => {
    test.use({ viewport: { width: 390, height: 844 }, locale: 'de' });

    test('the whole tree: the phone\'s set of each life chart, no label past the right edge, no sideways scroll', async ({ page, context }) => {
        await setup(page);
        await openDialog(page);
        const book = await openBook(page, context);
        await expect(book.locator('.pp-chart-set--narrow').first()).toBeVisible();
        await expect(book.locator('.pp-chart-set--wide').first()).toBeHidden();
        const past = await book.evaluate(() => [...document.querySelectorAll('.pp-chart *')]
            .filter(e => e.getClientRects().length > 0 && e.getBoundingClientRect().right > innerWidth + 0.5)
            .map(e => (e.textContent ?? '').trim()));
        expect(past).toEqual([]);
        expect(await book.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
});

test.describe('family book: the content', () => {
    test('the sample tree: the book in a new window with its structure', async ({ page, context }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(page.locator('#empty-state')).toBeHidden();
        // From the export menu.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal').locator('.menu-option', { hasText: 'Family book' }).click();
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(page.locator('#export-modal')).not.toHaveClass(/active/);
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        const book = await openBook(page, context);
        await expect(book.locator('body')).toContainText('Johan');
        await expect(book.locator('.book-title-page')).toBeVisible();
        await expect(book.locator('#book-toc')).toBeVisible();
        await expect(book.locator('article.book-family').first()).toBeVisible();
        await expect(book.locator('#book-index')).toBeVisible();
        await expect(book.locator('#book-index h2').first()).toHaveText('Person index');
        await book.close();
    });

    test('the initials privacy default also hides living names in the lineage tree', async ({ page, context }) => {
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
        const dialog = await openDialog(page);
        // Default privacy is initials — leave it.
        await expect(dialog.locator('input[name="book-privacy"][value="initials"]')).toBeChecked();
        const book = await openBook(page, context);
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

    test('a childless couple\'s story is a subchapter after the main-line partner\'s chapter (spec 027, 1031)', async ({ page, context }) => {
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
        const dialog = await openDialog(page);
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        // The story makes the Stories part available.
        await expect(part(dialog, 'story').locator('input')).toBeEnabled();
        const book = await openBook(page, context);
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
});
