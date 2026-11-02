/**
 * Pages of selected people and a line of ancestors in the dialog "Book and
 * pages" (1102 §3.1, §3.2, §4): the person card's ⋯ "Pages for selected
 * people…" opens the pages with that person chosen; one person → Person page,
 * none → nothing to save, two or more → the set with its families; the
 * chips beyond six as "+ N more"; the saved file of selected people opens on
 * its introduction; the book has no selected people (the dialog says it moved
 * to the whole tree); the ancestors' segment of generations with the known
 * count; a phone's sub-sheet with Done. Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page): Promise<void> {
    await openApp(page);
    await page.evaluate(async (data) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
    }, rodsTree());
}

async function openDialog(page: Page, output?: 'book' | 'pages'): Promise<Locator> {
    await page.evaluate((o) => window.Strom.UI.showBookDialog(o), output);
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

const outBtn = (dialog: Locator, o: string): Locator => dialog.locator(`.book-out [data-output="${o}"]`);
const kind = (dialog: Locator, k: string): Locator => dialog.locator(`input[name="book-kind"][value="${k}"]`);

/** Pick a person in the selected people's picker by a search. */
async function pick(dialog: Locator, name: string): Promise<void> {
    await dialog.locator('.book-sel-persons .ppm-search').fill(name);
    await dialog.locator('.book-sel-persons .ppm-row', { hasText: name }).first().click();
}

test.describe('pages of selected people', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the card\'s ⋯ menu opens the pages with the person chosen; one person, none, a set with its families; chips beyond six @smoke', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showEditPersonModal('b14' as never));
        const row = page.locator('#pm-rod');
        await row.locator('.pm-rod-more-btn').click();
        await row.locator('.pm-rod-menu').getByRole('menuitem', { name: 'Pages for selected people…' }).click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(outBtn(dialog, 'pages')).toHaveAttribute('aria-checked', 'true');
        // The pages' kinds: Selected people last; it is checked, with Karl as its chip.
        await expect(dialog.locator('.book-kind[data-kind] .book-kind-t')).toHaveText([
            'Whole tree', 'Family lines', 'Ancestors of a person', 'Descendants of a person', 'Selected people',
        ]);
        await expect(kind(dialog, 'persons')).toBeChecked();
        const sel = dialog.locator('.book-sel-persons');
        await expect(sel).toBeVisible();
        await expect(sel.locator('.ppm-chip')).toHaveText(['Karl Brandvold×']);
        // One person: a person page, not a set.
        await expect(sel.locator('.book-sel-state')).toHaveText('One person = a person page.');
        await expect(dialog.locator('#book-open')).toHaveText('Person page…');
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('.fp-open')).toBeDisabled();

        // Nobody: nothing to save.
        await sel.locator('.ppm-chip-x').click();
        await expect(sel.locator('.book-sel-state')).toHaveText('Nobody selected yet. A set needs at least two people.');
        await expect(dialog.locator('.fp-est-t')).toHaveText('Nobody selected yet. A set needs at least two people.');
        await expect(dialog.locator('#book-open .fp-l-wide')).toHaveText('Save file…');
        await expect(dialog.locator('#book-open')).toBeDisabled();

        // Three people, Axel and Rut a couple: one family with a page.
        for (const name of ['Karl Brandvold', 'Axel Brandvold', 'Rut Hasselgren']) await pick(dialog, name);
        await expect(sel.locator('.book-sel-state')).toHaveText('3 people · 1 family with a page (both partners selected) · other relatives as plain text');
        await expect(dialog.locator('.fp-file')).toHaveText('Selected-people.html');
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('.fp-open')).toBeEnabled();

        // Seven people: six chips and "+ 1 more".
        for (const name of ['Viktor Brandvold', 'Dagny Ostrander', 'Gustaf Brandvold', 'Asta Ekhammar']) await pick(dialog, name);
        await expect(sel.locator('.ppm-chip:not(.ppm-chip--more)')).toHaveCount(6);
        await expect(sel.locator('.ppm-chip--more')).toHaveText('+ 1 more');
        await expect(sel.locator('.book-sel-state')).toHaveText(/^7 people · 3 families with a page/);
        // Done is the phone's.
        await expect(sel.locator('.book-sub-done')).toBeHidden();
    });

    test('the saved file of selected people opens on their introduction, grouped by line, with the families', async ({ page, context }) => {
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
        });
        await setup(page);
        await page.evaluate(() => window.Strom.UI.openSelectedPersonsPages('b13' as never));
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        for (const name of ['Rut Hasselgren', 'Karl Brandvold', 'Ingrid Tallqvist']) await pick(dialog, name);
        await expect(dialog.locator('.fp-file')).toHaveText('Selected-people.html');
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res).toBeVisible();
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        expect(download.suggestedFilename()).toBe('Selected-people.html');
        const saved = join(mkdtempSync(join(tmpdir(), 'strom-pages-sel-')), download.suggestedFilename());
        await download.saveAs(saved);
        const file = await context.newPage();
        await file.goto(pathToFileURL(saved).href);
        const intro = file.locator('section.sp-page--persons');
        await expect(intro).toBeVisible();
        await expect(intro.locator('h1')).toHaveText('Selected people');
        await expect(intro.locator('.sp-sel-row')).toHaveCount(4);
        await expect(intro.locator('.sp-sel-h').first()).toHaveText(/^Brandvold family line · 2 people$/);
        // Axel and Rut: the one family with a page.
        await expect(intro.locator('.sp-cross-row')).toHaveCount(1);
        await expect(intro.locator('.sp-cross-row')).toContainText('Axel Brandvold');
        // A person's link opens their page.
        await intro.locator('.sp-sel-row a', { hasText: 'Karl Brandvold' }).click();
        await expect(file.locator('section.sp-page--person:visible')).toHaveCount(1);
        await file.close();
    });

    test('the book has no selected people: the dialog switches to the whole tree and says so', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.openSelectedPersonsPages('b13' as never));
        const dialog = page.locator('#book-modal');
        await expect(kind(dialog, 'persons')).toBeChecked();
        await outBtn(dialog, 'book').click();
        await expect(kind(dialog, 'persons')).toHaveCount(0);
        await expect(kind(dialog, 'tree')).toBeChecked();
        await expect(dialog.locator('.book-sel-moved')).toHaveText('Selected people are for pages only; the whole tree is selected.');
        // Another choice drops the line.
        await dialog.locator('.book-kind[data-kind="rods"]').click();
        await expect(dialog.locator('.book-sel-moved')).toBeHidden();
    });

    test('the ancestors\' generations as a segment with the known count; the window shows the generations', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('.book-kind[data-kind="ancestors"]').click();
        await expect(kind(dialog, 'ancestors')).toBeChecked();
        await expect(dialog.locator('.book-person-name')).toHaveText('Mikael Brandvold (1958–)');
        await expect(dialog.locator('.book-gens')).toBeHidden();
        await expect(dialog.locator('.book-anc-line')).toBeVisible();
        await expect(dialog.locator('.book-anc-seg [data-anc-gen]:visible')).toHaveText(['2', '3', '4', '5', '6', '8']);
        await expect(dialog.locator('[data-anc-gen="4"]')).toHaveAttribute('aria-checked', 'true');
        // Mikael's parents 2 of 2, grandparents 2 of 4, then 2 of 8 and 4 of 16.
        await expect(dialog.locator('.book-anc-n')).toHaveText('10 of 30 ancestors');
        // Mikael is living: the file is not named after him.
        await expect(dialog.locator('.fp-file')).toHaveText('Ancestors.html');
        await dialog.locator('[data-anc-gen="2"]').click();
        await expect(dialog.locator('[data-anc-gen="2"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('.book-anc-n')).toHaveText('4 of 6 ancestors');
        await dialog.locator('.fp-open').click();
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('.pp-body .sp-anc-gen')).toHaveCount(3);
        await expect(win.locator('.pp-body .sp-anc-row--none')).toHaveCount(2);
    });
});

test.describe('pages of selected people on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the sub-sheet of selected people: the picker, Done back to the dialog with the count; ancestors with All', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('.book-kind[data-kind="persons"]').click();
        await dialog.locator('.book-kind[data-kind="persons"] .book-kind-sum').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('Selected people');
        const sel = dialog.locator('.book-sel-persons');
        await expect(sel).toBeVisible();
        for (const name of ['Axel Brandvold', 'Rut Hasselgren']) await pick(dialog, name);
        await expect(sel.locator('.book-sel-state')).toHaveText(/^2 people · 1 family with a page/);
        const done = sel.locator('.book-sub-done');
        await expect(done).toHaveText('Done');
        expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        await done.click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('');
        await expect(dialog.locator('.book-kind[data-kind="persons"] .book-sum-v')).toHaveText('2 people');
        await expect(dialog).toHaveClass(/active/);

        // Ancestors: the sub-sheet offers All too.
        await dialog.locator('.book-kind[data-kind="ancestors"]').click();
        await dialog.locator('.book-kind[data-kind="ancestors"] .book-kind-sum').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('Ancestors of a person');
        await expect(dialog.locator('[data-anc-gen="all"]')).toBeVisible();
        await dialog.locator('[data-anc-gen="all"]').click();
        await expect(dialog.locator('.book-anc-n')).toHaveText(/^\d+ of \d+ ancestors$/);
        await page.keyboard.press('Escape');
        await expect(dialog.locator('.book-sub-title')).toHaveText('');
    });
});
