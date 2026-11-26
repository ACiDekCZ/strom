import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { openApp, seedTree, SeedPerson } from './helpers.js';

/**
 * The family book of a house (spec 030 §8, K1.3): the House tile in the book
 * dialog for a tree with a numbered house (the old "House · later" card is
 * gone), the house chosen by its search (houses with history first, then the
 * others), the scope under it, the title from the town, the number and the
 * name after the farm, the book with the house's people, and Change options
 * bringing the house back. A phone's row opens the house in its sub-sheet.
 *
 * Invented village Bělokamen: čp. 16 "U Prouzalů" of the Prouzals (Kunhuta
 * married in), čp. 7 of the Trnovec family and čp. 40 below the threshold.
 */

const PEOPLE: Record<string, SeedPerson> = {
    svatobor: {
        firstName: 'Svatobor', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890', partners: ['radegunda'],
    },
    radegunda: {
        firstName: 'Radegunda', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Mlýnkovice', birthDate: '1824',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1891', partners: ['svatobor'],
    },
    hostivit: {
        firstName: 'Hostivít', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910', parents: ['svatobor', 'radegunda'], partners: ['kunhuta'],
    },
    kunhuta: {
        firstName: 'Kunhuta', lastName: 'Kvitelková', gender: 'female', birthPlace: 'Mlýnkovice', birthDate: '1855',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1915', partners: ['hostivit'],
    },
    lubomir: { firstName: 'Lubomír', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1830', deathDate: '1890' },
    kresomysl: {
        firstName: 'Křesomysl', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1862', deathDate: '1918',
        parents: ['lubomir'],
    },
    hroznata: { firstName: 'Hroznata', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 40', birthDate: '1900', deathDate: '1919' },
};

async function seedVillage(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, PEOPLE, 'Prouzal', 'svatobor');
    await page.evaluate(async () => {
        const S = window.Strom;
        S.DataManager.setHouseUserData('belokamen|16' as never, { name: 'U Prouzalů' }, 'čp. 16');
        await S.TreeManager.flush();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

async function openDialog(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

/** Choose a house in the popover by its search. */
async function pickHouse(page: Page, dialog: Locator, query: string, label: string): Promise<void> {
    await dialog.locator('.book-house-btn').click();
    const pop = page.locator('.tov-pop');
    await expect(pop).toBeVisible();
    await pop.locator('.tov-pop-search').fill(query);
    await pop.locator('.tov-pop-row', { hasText: label }).click();
    await expect(pop).toHaveCount(0);
}

async function openBook(page: Page, context: BrowserContext): Promise<Page> {
    const [book] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('#book-modal #book-open').click(),
    ]);
    await book.waitForLoadState('domcontentloaded');
    await book.locator('.book-toolbar').waitFor();
    return book;
}

test.describe('family book: a house', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the House tile, the house by its search, the scope and the title; the book of the house; Change options keeps it', async ({ page, context }) => {
        await seedVillage(page);
        const dialog = await openDialog(page);

        // The House tile instead of the old card for later.
        await expect(dialog.locator('.book-kind--house')).toHaveCount(0);
        await expect(dialog.locator('.book-kinds')).not.toContainText('later');
        const tile = dialog.locator('.book-kind[data-kind="house"]');
        await expect(tile.locator('.book-kind-t')).toHaveText('House');
        await expect(tile.locator('.book-kind-h')).toHaveText('the house’s family across generations');
        await expect(dialog.locator('.book-sel-house')).toBeHidden();

        // Chosen: the house of the person in focus, its name after the farm beside the number.
        await tile.click();
        await expect(dialog.locator('input[name="book-kind"][value="house"]')).toBeChecked();
        const sel = dialog.locator('.book-sel-house');
        await expect(sel).toBeVisible();
        await expect(sel.locator('.book-person-l')).toHaveText('House');
        await expect(sel.locator('.book-house-name')).toHaveText('Bělokamen čp. 16');
        await expect(sel.locator('.book-house-alias')).toHaveText('U Prouzalů');
        await expect(sel.locator('.book-house-scope')).toHaveText(
            'The house’s family across generations: 4 people from 1820–1915, with spouses and children born in the house.');
        await expect(dialog.locator('.book-cover-title')).toHaveText('Bělokamen čp. 16 · U Prouzalů');
        // Other families belong to a book of the whole tree only.
        await expect(dialog.locator('.book-part[data-part="smallRods"]')).toHaveClass(/is-off/);

        // The search: houses with history first, then the others.
        await dialog.locator('.book-house-btn').click();
        const pop = page.locator('.tov-pop');
        await expect(pop.locator('.tov-pop-head')).toHaveText(['Houses with history', 'More houses']);
        await expect(pop.locator('.tov-pop-row .tov-pop-name')).toHaveText(['Bělokamen čp. 7', 'Bělokamen čp. 16', 'Bělokamen čp. 40']);
        await expect(pop.locator('.tov-pop-row', { hasText: 'čp. 16' }).locator('.tov-pop-meta')).toHaveText(/^U Prouzalů · 1820–1915 · Prouzal/);
        await expect(pop.locator('.tov-pop-row', { hasText: 'čp. 16' }).locator('.tov-pop-count')).toHaveText('4 people');
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);

        await pickHouse(page, dialog, 'Trnovec', 'Bělokamen čp. 7');
        await expect(sel.locator('.book-house-name')).toHaveText('Bělokamen čp. 7');
        await expect(sel.locator('.book-house-alias')).toBeHidden();
        await expect(dialog.locator('.book-cover-title')).toHaveText('Bělokamen čp. 7');
        await expect(dialog.locator('.book-kind[data-kind="house"] .book-sum-v')).toHaveText('Bělokamen čp. 7');

        await pickHouse(page, dialog, '16', 'Bělokamen čp. 16');
        await expect(dialog.locator('.book-cover-title')).toHaveText('Bělokamen čp. 16 · U Prouzalů');
        await expect(dialog.locator('#book-open')).toBeEnabled();

        // The book: the people of the house, not those of another house.
        const book = await openBook(page, context);
        await expect(book.locator('.book-toolbar .book-bar-name')).toHaveText('Bělokamen čp. 16 · U Prouzalů');
        const text = await book.locator('body').innerText();
        expect(text).toContain('Svatobor');
        expect(text).toContain('Kunhuta');
        expect(text).not.toContain('Křesomysl');

        // Change options: the dialog comes back with the house.
        await book.locator('.book-toolbar').getByRole('button', { name: 'Change options' }).click();
        await expect(dialog).toHaveClass(/active/);
        await expect(dialog.locator('input[name="book-kind"][value="house"]')).toBeChecked();
        await expect(dialog.locator('.book-house-name')).toHaveText('Bělokamen čp. 16');
    });

    test('the index of houses: off by default, with how many houses; ticked, the book ends with it', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T14:00:00'));
        await seedVillage(page);
        const dialog = await openDialog(page);
        await dialog.locator('.book-kind[data-kind="house"]').click();
        const part = dialog.locator('.book-part[data-part="houseIndex"]');
        await expect(part.locator('.book-part-t')).toHaveText('Index of houses');
        await expect(part.locator('.book-part-r')).toHaveText('1 house → people, years');
        await expect(part.locator('input')).not.toBeChecked();
        await expect(part.locator('input')).toBeEnabled();
        await part.locator('input').check();
        await expect(dialog.locator('.book-outline')).toContainText('Index of houses');

        const book = await openBook(page, context);
        const index = book.locator('#book-house-index');
        await expect(index.locator('h2')).toHaveText('Index of houses');
        await expect(index.locator('.book-index-letter')).toHaveText(['Bělokamen']);
        await expect(index.locator('.book-house-head')).toHaveText('čp. 16 U Prouzalů');
        await expect(index.locator('.book-house-person').first()).toContainText('Prouzal Svatobor, born 1820, died 1890');
        await expect(index.locator('.book-house-person', { hasText: 'Kunhuta' })).toContainText('married in');
        await expect(book.locator('#book-toc a[href="#book-house-index"]')).toHaveText('Index of houses');
    });

    test('the Houses chapter: with how many houses and pages, the index of houses only with it; in the book after the small lineages', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T14:00:00'));
        await seedVillage(page);
        const dialog = await openDialog(page);
        const part = dialog.locator('.book-part[data-part="houses"]');
        await expect(part.locator('.book-part-t')).toHaveText('Houses');
        await expect(part.locator('.book-part-r')).toHaveText(/^\d+ houses? · about \d+ pages?$/);
        // Off by default without a house the research has done.
        await expect(part.locator('input')).not.toBeChecked();
        const index = dialog.locator('.book-part[data-part="houseIndex"]');
        await expect(index.locator('.book-part-r')).toHaveText('Only with the Houses chapter.');
        await expect(index.locator('input')).toBeDisabled();
        await part.locator('input').check();
        await expect(index.locator('input')).toBeEnabled();
        await expect(dialog.locator('.book-outline')).toContainText('Houses');

        const book = await openBook(page, context);
        const chapter = book.locator('#book-houses');
        await expect(chapter.locator('h2')).toHaveText('Houses');
        await expect(chapter.locator('.book-house-ch h3', { hasText: 'čp. 16' })).toHaveText('Bělokamen čp. 16');
        await expect(chapter.locator('.book-house-ch', { hasText: 'čp. 16' }).locator('.book-house-alias')).toHaveText('U Prouzalů');
        await expect(chapter.locator('.book-house-ch', { hasText: 'čp. 16' })).toContainText('Timeline');
        await expect(book.locator('#book-toc a[href="#book-houses"]')).toHaveText('Houses');
    });

    test('a book of a house: the last ~100 years by name only, on by default; switched off, the book shows their years', async ({ page, context }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T14:00:00'));
        await openApp(page);
        await seedTree(page, {
            ...PEOPLE,
            dobromil: {
                firstName: 'Dobromil', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1912',
                deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1975', parents: ['hostivit', 'kunhuta'],
            },
        }, 'Prouzal', 'svatobor');
        const dialog = await openDialog(page);
        const sw = dialog.locator('.book-house-recent [data-switch="houseRecent"]');
        // Only with the House selection.
        await expect(sw).toBeHidden();
        await dialog.locator('.book-kind[data-kind="house"]').click();
        await expect(sw).toBeVisible();
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('.book-house-recent')).toContainText('Last ~100 years by name only');
        // The cover's period as the book's title page has it: without Dobromil's 1975.
        await expect(dialog.locator('.book-cover-sub')).toHaveText('1820–1915');

        const book = await openBook(page, context);
        await expect(book.locator('body')).toContainText('Dobromil');
        expect(await book.locator('body').innerText()).not.toContain('1975');
        await expect(book.locator('.book-title-sub')).toHaveText('1820–1915');
        await expect(book.locator('.book-title-page h1')).toHaveText(await dialog.locator('.book-cover-title').innerText());

        // Off: Change options, the switch, the same window again.
        await book.locator('.book-toolbar').getByRole('button', { name: 'Change options' }).click();
        await expect(dialog).toHaveClass(/active/);
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(dialog.locator('.book-cover-sub')).toHaveText('1820–1975');
        await dialog.locator('#book-open').click();
        await expect(book.locator('body')).toContainText('1975');
    });

    test('the pages have no House tile: the whole tree takes its place, the book gets it back', async ({ page }) => {
        await seedVillage(page);
        const dialog = await openDialog(page);
        await dialog.locator('.book-kind[data-kind="house"]').click();
        await dialog.locator('button[data-output="pages"]').click();
        await expect(dialog.locator('.book-kind[data-kind="house"]')).toHaveCount(0);
        await expect(dialog.locator('input[name="book-kind"][value="tree"]')).toBeChecked();
        await dialog.locator('button[data-output="book"]').click();
        await expect(dialog.locator('.book-kind[data-kind="house"]')).toHaveCount(1);
    });
});

test.describe('family book: a house on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the House row opens the house in its sub-sheet, without a sideways scroll', async ({ page }) => {
        await seedVillage(page);
        const dialog = await openDialog(page);
        const row = dialog.locator('.book-kind[data-kind="house"]');
        await row.click();
        await row.locator('.book-kind-sum').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('House');
        const btn = dialog.locator('.book-house-btn');
        await expect(btn).toBeVisible();
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await dialog.locator('.book-dlg').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await btn.click();
        await expect(page.locator('.tov-pop .tov-pop-row', { hasText: 'čp. 16' })).toBeVisible();
    });

    test('a long town shortens, the number of the house stays whole; the name after the farm under it', async ({ page }) => {
        await seedVillage(page);
        await page.evaluate(async () => {
            const S = window.Strom;
            for (const p of Object.values(S.DataManager.getData().persons) as { id: string; birthPlace?: string; deathPlace?: string }[]) {
                const town = (v?: string) => (v === 'Bělokamen' ? 'Horní Bělokamen nad Prouzalkou' : v);
                S.DataManager.updatePerson(p.id as never, { birthPlace: town(p.birthPlace), deathPlace: town(p.deathPlace) } as never);
            }
            await S.TreeManager.flush();
        });
        const dialog = await openDialog(page);
        const row = dialog.locator('.book-kind[data-kind="house"]');
        await row.click();
        const whole = async (el: Locator, within: Locator) => {
            await expect(el).toHaveText('čp. 16');
            const b = (await el.boundingBox())!;
            const w = (await within.boundingBox())!;
            expect(b.x + b.width).toBeLessThanOrEqual(w.x + w.width + 0.5);
            expect(await el.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        };
        const sum = row.locator('.book-sum-v');
        await expect(sum).toHaveText('Horní Bělokamen nad Prouzalkou čp. 16');
        await whole(sum.locator('.book-hn'), sum);
        await row.locator('.book-kind-sum').click();
        const btn = dialog.locator('.book-house-btn');
        await whole(btn.locator('.book-house-name .book-hn'), btn);
        expect(await dialog.locator('.book-dlg').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    });
});
