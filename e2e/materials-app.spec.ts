import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, cardAction, personModal } from './helpers.js';

/**
 * The Materials window of every tree (spec 102 §1): a tree without a research
 * opens it from Actions › Materials (with the number of its files), shows its
 * own files once each, grouped by the day added or by person (a file at two
 * people stands in both groups; a file only at a source under "No person"),
 * says where the files are behind ⓘ (Esc and a click outside close it) and,
 * without any file, an empty state with the search alone. The person's
 * attachments link to the window filtered to them. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DAY = 86_400_000;

async function tree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
        p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1', 'p2'] },
    }, 'Pfefferkorn', 'p3');
}

/**
 * Three files: a wedding photo at Florimund and Quirinella (added two days
 * ago), Kasimir's letter (today) and a register page only at a source (a
 * hundred days ago: "Earlier").
 */
async function files(page: Page): Promise<void> {
    await page.evaluate(({ px, day }) => {
        const dm = window.Strom.DataManager;
        const at = (days: number) => new Date(Date.now() - days * day).toISOString();
        const file = (name: string, days: number) => ({ name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70, addedAt: at(days) });
        const wedding = dm.addAttachment('p1' as never, file('svatba.png', 2))!;
        dm.addMediaPlace(wedding.id, { personId: 'p2' as never });
        dm.addAttachment('p3' as never, file('dopis.png', 0));
        const source = dm.addSource({ title: 'Matrika Quellbach' } as never)!;
        const page = dm.addAttachment('p3' as never, file('matrika.png', 100), source.id)!;
        dm.removeMediaPlace(page.id, { personId: 'p3' as never });
    }, { px: PX, day: DAY });
}

const win = (page: Page) => page.locator('#materials-modal');
const groups = (page: Page) => win(page).locator('.mw-canvas .mw-group');
const group = (page: Page, name: string) => groups(page).filter({ has: page.locator('.mw-group-name', { hasText: name }) });
const tilesIn = async (page: Page, name: string): Promise<string[]> => {
    const key = await group(page, name).locator('.mw-group-toggle').getAttribute('data-group');
    return win(page).locator('.mw-canvas .mw-tile').evaluateAll((els, key) => els
        .filter(el => (el.closest('.mw-r') as HTMLElement | null)?.dataset.row?.startsWith(`t:${key}`) ?? false)
        .map(el => el.querySelector('.mw-tile-title')?.textContent?.trim() ?? ''), key);
};

async function openFromActions(page: Page, count: string): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    const row = page.locator('#actions-materials-row');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Materials');
    await expect(page.locator('#actions-materials-count')).toHaveText(count);
    // Right under Sources (when offered) and before the lists of people.
    const order = await page.locator('#actions-menu-dropdown [role="menuitem"]').evaluateAll(els => els.map(e => e.id));
    expect(order.indexOf('actions-materials-row')).toBe(order.indexOf('actions-lists-row') - 1);
    await row.click();
    await expect(win(page)).toBeVisible();
}

test.describe('Materials window without a research', () => {
    test.use({ viewport: DESKTOP });

    test('Actions › Materials N opens the tree\'s files: by the day added, by person (a file at two people in both), no batches', async ({ page }) => {
        await tree(page);
        await files(page);
        await openFromActions(page, '3');
        await expect(win(page)).toHaveAttribute('data-model', 'app');
        await expect(win(page).locator('.mw-summary')).toHaveText('3 files · 1 without a person');
        await expect(win(page).locator('.mw-status')).toBeHidden();
        // By the day added: today, two days ago, Earlier; the day names who the files were added with.
        await expect(win(page).locator('[data-mw="group-added"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(groups(page)).toHaveCount(3);
        await expect(groups(page).nth(2).locator('.mw-group-name')).toHaveText('Earlier');
        await expect(groups(page).nth(1).locator('.mw-group-meta')).toHaveText('added with Florimund Pfefferkorn, Quirinella Pfefferkornová');
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(3);
        // No batches, no "In the tree" (everything is), the number of places on the tile; selecting is there (spec 102 §8).
        await expect(win(page).locator('[data-mw="batch"], [data-mw="group-batch"], [data-mw="hidden"]')).toHaveCount(0);
        await expect(win(page).locator('[data-mw="select"]')).toHaveCount(1);
        await expect(win(page).locator('.mw-intree')).toHaveCount(0);
        const wedding = win(page).locator('.mw-tile', { hasText: 'svatba.png' });
        await expect(wedding.locator('.mw-places')).toHaveText('2');
        await expect(wedding.locator('.mw-places')).toHaveAttribute('aria-label', '2 places');

        // By person: a group per person by name, the wedding photo in both, the register page under No person.
        await win(page).locator('[data-mw="group-person"]').click();
        await expect(win(page)).toHaveAttribute('data-group', 'person');
        await expect(groups(page).locator('.mw-group-name')).toHaveText(['Florimund Pfefferkorn', 'Kasimir Pfefferkorn', 'Quirinella Pfefferkornová', 'No person']);
        expect(await tilesIn(page, 'Florimund')).toEqual(['svatba.png']);
        expect(await tilesIn(page, 'Quirinella')).toEqual(['svatba.png']);
        expect(await tilesIn(page, 'Kasimir')).toEqual(['dopis.png']);
        expect(await tilesIn(page, 'No person')).toEqual(['matrika.png']);
        // Remembered for the next opening, apart from the archive's grouping.
        const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('strom.materials.view') ?? '{}'));
        expect(prefs).toMatchObject({ group: 'batch', appGroup: 'person' });
        await win(page).locator('.close-btn').click();
        await page.evaluate(() => window.Strom.UI.openMaterials());
        await expect(win(page).locator('[data-mw="group-person"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a person the records do not name ("?") reads "Unknown person" by person and in Where used', async ({ page }) => {
        await openApp(page);
        await seedTree(page, {
            p1: { firstName: '?', lastName: '', isPlaceholder: true },
            p3: { firstName: 'Kasimir', lastName: 'Pfefferkorn', parents: ['p1'] },
        }, 'Pfefferkorn', 'p3');
        await page.evaluate(({ px }) => {
            const dm = window.Strom.DataManager;
            const photo = dm.addAttachment('p1' as never, { name: 'portret.png', mimeType: 'image/png', dataUrl: px, sizeBytes: 70 })!;
            dm.addMediaPlace(photo.id, { personId: 'p3' as never });
        }, { px: PX });
        await page.evaluate(() => window.Strom.UI.openMaterials());
        await win(page).locator('[data-mw="group-person"]').click();
        await expect(groups(page).locator('.mw-group-name')).toHaveText(['Kasimir Pfefferkorn', 'Unknown person']);
        await win(page).locator('.mw-canvas .mw-tile').first().click();
        const uses = page.locator('#image-viewer-panel .mv-uses');
        await expect(uses).toBeVisible();
        await expect(uses.locator('.mv-use-link')).toHaveText(['Unknown person', 'Kasimir Pfefferkorn']);
    });

    test('ⓘ says where the files are; Esc and a click outside close it', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => window.Strom.UI.openMaterials());
        const info = win(page).locator('.mw-where');
        await expect(info).toHaveAttribute('aria-expanded', 'false');
        await info.click();
        const pop = page.locator('.mw-pop-where');
        await expect(pop).toBeVisible();
        await expect(info).toHaveAttribute('aria-expanded', 'true');
        await expect(pop.locator('.mw-pop-head')).toHaveText('Where the files are');
        await expect(pop.locator('.mw-where-text')).toHaveText(['The files are only in this browser. Backup: Export all.']);
        // Esc closes the popover only (the window stays) and gives the focus back.
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(win(page)).toBeVisible();
        await expect(info).toBeFocused();
        await info.click();
        await expect(pop).toBeVisible();
        await win(page).locator('.mw-summary').click();
        await expect(pop).toHaveCount(0);
        await expect(info).toHaveAttribute('aria-expanded', 'false');
    });

    test('a tree without files: the empty state with the search alone', async ({ page }) => {
        await tree(page);
        await openFromActions(page, '0');
        const empty = win(page).locator('.mw-empty.is-none');
        await expect(empty).toBeVisible();
        await expect(empty.locator('.mw-empty-title')).toHaveText('The tree has no files yet');
        await expect(empty).toContainText('Sources and attachments → Add attachment');
        await expect(empty.locator('.mw-empty-where')).toHaveText('The files are only in this browser. Backup: Export all.');
        await expect(win(page).locator('.mw-search')).toBeVisible();
        await expect(win(page).locator('.mw-tools')).toBeHidden();
        await expect(win(page).locator('.mw-summary')).toHaveText('0 files · 0 without a person');
    });

    test('the person\'s attachments: "All materials of this person (N) ›" opens the window filtered to them', async ({ page }) => {
        await tree(page);
        await files(page);
        await cardAction(page, 'Florimund', 'edit');
        const link = personModal(page).locator('#attachments-all-materials');
        await expect(link).toBeVisible();
        await expect(link).toHaveText('All materials of this person (1) ›');
        await link.click();
        await expect(win(page)).toBeVisible();
        await expect(win(page).locator('.mw-chip.is-active .mw-chip-main')).toHaveText('Person: Florimund Pfefferkorn');
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
        await expect(win(page).locator('.mw-canvas .mw-tile')).toContainText('svatba.png');
    });

    test('the person page\'s Materials opens the window filtered to them (not the old list)', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('p1' as never));
        const open = page.locator('#pp-sec-materials .pp-gal-open');
        await expect(open).toBeVisible();
        await open.click();
        await expect(win(page)).toBeVisible();
        await expect(win(page)).toHaveAttribute('data-model', 'app');
        await expect(win(page).locator('.mw-chip.is-active .mw-chip-main')).toHaveText('Person: Florimund Pfefferkorn');
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
        await expect(win(page).locator('.mw-canvas .mw-tile')).toContainText('svatba.png');
        // The window stands over the person page, its search reachable.
        await win(page).locator('.mw-canvas .mw-tile').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
    });

    test('a person without files has no link', async ({ page }) => {
        await tree(page);
        await cardAction(page, 'Kasimir', 'edit');
        await expect(personModal(page)).toBeVisible();
        await expect(personModal(page).locator('#attachments-all-materials')).toBeHidden();
    });
});

test.describe('Materials window without a research: phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the window fills the screen; ⓘ stays by the title, the places count on the tile', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.evaluate(() => window.Strom.UI.openMaterials());
        await expect(win(page)).toBeVisible();
        const info = win(page).locator('.mw-where');
        await expect(info).toBeVisible();
        const [title, i] = await Promise.all([win(page).locator('#materials-title').boundingBox(), info.boundingBox()]);
        expect(Math.abs((title!.y + title!.height / 2) - (i!.y + i!.height / 2))).toBeLessThan(12);
        await expect(win(page).locator('.mw-tile', { hasText: 'svatba.png' }).locator('.mw-places')).toBeVisible();
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(scroll).toBeLessThanOrEqual(0);
    });
});

test.describe('Materials window without a research: tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

    test('More › Materials N opens the window; a phone\'s More keeps its first level without it', async ({ page }) => {
        await tree(page);
        await files(page);
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const row = sheet.locator('.bottom-sheet-item', { hasText: 'Materials' });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('3');
        await row.tap();
        await expect(win(page)).toBeVisible();
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(3);
        await win(page).locator('.close-btn').tap();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#bb-view-more').tap();
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Materials' })).toHaveCount(0);
    });
});
