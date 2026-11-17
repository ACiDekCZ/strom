import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, cardAction, personModal } from './helpers.js';

/**
 * The materials on a phone, a tablet and a phone held sideways (spec 102
 * §11): a phone's window with 3 columns and no text under the tiles, the
 * review filters in the Filters sheet, a long press starting the selection,
 * the bar with three actions and ⋯, Go through in the viewer's sheet with
 * the swipe sentence (a swipe saves and goes on), the bulk and remove
 * dialogs as sheets from the bottom, the attachment row's trash taking the
 * file off the person; a tablet's 5 columns at 1024 px and the viewer's
 * 300 px panel; sideways 88 px tiles. Invented data.
 */

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 768 };
const SIDEWAYS = { width: 844, height: 390 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const win = (page: Page) => page.locator('#materials-modal');
const tiles = (page: Page) => win(page).locator('.mw-canvas .mw-tile');
const bar = (page: Page) => win(page).locator('.mw-selbar');
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const viewer = (page: Page) => page.locator('#attachment-overlay');

/** Florimund with eight files of the tree (the first two titled); a wedding photo also at Quirinella. */
async function tree(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        p1: { firstName: 'Florimund', lastName: 'Pfefferkorn', partners: ['p2'] },
        p2: { firstName: 'Quirinella', lastName: 'Pfefferkornová', gender: 'female' },
    }, 'Pfefferkorn', 'p1');
    await page.evaluate((px) => {
        const dm = window.Strom.DataManager;
        for (let i = 1; i <= 8; i++) {
            const a = dm.addAttachment('p1' as never, { name: `scan-${i}.png`, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 })!;
            if (i <= 2) dm.setMediaDetails(a.id, { title: `Wedding ${i}` });
            if (i === 1) dm.addMediaPlace(a.id, { personId: 'p2' as never });
        }
    }, PX);
}

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await expect(tiles(page).first()).toBeVisible();
}

/** A finger held on an element (the window's long press). */
async function longPress(page: Page, el: ReturnType<Page['locator']>): Promise<void> {
    const box = (await el.boundingBox())!;
    await page.evaluate(([x, y]) => new Promise<void>((resolve) => {
        const target = document.elementFromPoint(x, y)!;
        const fire = (type: string) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 9 }));
        fire('pointerdown');
        setTimeout(() => { fire('pointerup'); resolve(); }, 700);
    }), [box.x + box.width / 2, box.y + box.height / 2]);
}

/** A sideways swipe over the viewer's stage (to the left: the next file). */
async function swipe(page: Page, dx: number): Promise<void> {
    await page.evaluate((dx) => {
        const stage = document.getElementById('image-viewer-stage')!;
        const r = stage.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 4;
        const fire = (type: string, cx: number) => stage.dispatchEvent(new PointerEvent(type, {
            pointerId: 11, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, isPrimary: true,
        }));
        fire('pointerdown', x);
        for (let i = 1; i <= 5; i++) fire('pointermove', x + (dx * i) / 5);
        fire('pointerup', x + dx);
    }, dx);
}

test.describe('Materials on a phone', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('3 columns without text; the review filters in the Filters sheet; a long press selects; the bar has three actions and ⋯', async ({ page }) => {
        await tree(page);
        await openWindow(page);
        await expect(win(page).locator('.mw-canvas .mw-r-tiles').first().locator('.mw-tile')).toHaveCount(3);
        await expect(win(page).locator('.mw-tile-title').first()).toBeHidden();
        await expect(win(page).locator('.mw-chips-review')).toBeHidden();
        await win(page).locator('.mw-filters-btn').click();
        const sheet = page.locator('.mw-pop-sheet');
        await expect(sheet.locator('[data-mw="notitle"], [data-pop="notitle"]').first()).toHaveText('Without title · 6');
        await sheet.locator('[data-mw="notitle"], [data-pop="notitle"]').first().click();
        await page.keyboard.press('Escape');
        await expect(win(page).locator('.mw-filters-btn')).toHaveText('Filters · 1');
        await expect(tiles(page)).toHaveCount(6);
        // A long press starts selecting with that file; the header says how many, with Done.
        await longPress(page, tiles(page).first());
        await expect(win(page)).toHaveClass(/is-selecting/);
        await expect(win(page).locator('.mw-selhead')).toContainText('1 file selected');
        await tiles(page).nth(1).click();
        await expect(win(page).locator('.mw-selhead')).toContainText('2 files selected');
        const acts = bar(page).locator('.mw-selacts > button');
        await expect(acts).toHaveText(['Link to…', 'Title…', 'Go through', '⋯']);
        for (const b of await acts.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await bar(page).locator('[data-mw="sel-more"]').click();
        await expect(page.locator('.mw-pop-selMenu [data-action]')).toHaveText(['Kind…', 'Date…']);
        await page.keyboard.press('Escape');
        // Title… as a sheet from the bottom.
        await bar(page).locator('[data-mw="sel-title"]').click();
        const box = (await dialog(page).boundingBox())!;
        expect(Math.round(box.y + box.height)).toBe(PHONE.height);
        expect(Math.round(box.width)).toBe(PHONE.width);
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    });

    test('Go through in the viewer\'s sheet: the swipe sentence; a swipe saves and goes to the next file', async ({ page }) => {
        await tree(page);
        await openWindow(page);
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).nth(2).click();
        await tiles(page).nth(3).click();
        await bar(page).locator('[data-mw="sel-review"]').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(page.locator('#image-viewer-pos')).toContainText('Going through · 1 of 2');
        await expect(panel(page).locator('.mv-keys')).toHaveText('Swipe left and right for the next and previous file.');
        await panel(page).locator('.mat-edit-title').fill('Letter from Quellbach');
        await swipe(page, -160);
        await expect(page.locator('#image-viewer-pos')).toContainText('Going through · 2 of 2');
        const titled = await page.evaluate(() => window.Strom.DataManager.personMedia('p1' as never).filter(a => a.title === 'Letter from Quellbach').length);
        expect(titled).toBe(1);
        await panel(page).getByRole('button', { name: 'Skip', exact: true }).click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(toast(page)).toContainText('1 of 2 files updated.');
    });

    test('the attachment row\'s trash takes the file off this person; its last place asks as Remove from the tree…', async ({ page }) => {
        await tree(page);
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Florimund', 'edit');
        await expect(personModal(page)).toBeVisible();
        const row = (name: string) => personModal(page).locator('.attachment-row', { hasText: name });
        // Wedding 1 is also at Quirinella: only Florimund's place goes, with Undo.
        await row('Wedding 1').locator('.attachment-delete-btn').click();
        await expect(page.locator('.undo-toast-msg', { hasText: 'Removed: Florimund Pfefferkorn from Wedding 1.' })).toBeVisible();
        const places = await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const a = dm.personMedia('p2' as never).find(x => x.title === 'Wedding 1')!;
            return dm.getMedia(a.id)!.places.map(p => p.personId);
        });
        expect(places).toEqual(['p2']);
        await expect(row('Wedding 1')).toHaveCount(0);
        // Wedding 2 is only here: the Remove from the tree… sheet.
        await row('Wedding 2').locator('.attachment-delete-btn').click();
        const box = (await dialog(page).boundingBox())!;
        expect(Math.round(box.y + box.height)).toBe(PHONE.height);
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(row('Wedding 2')).toHaveCount(1);
    });
});

test.describe('Materials on a tablet and sideways', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('1024: 5 columns with text; the viewer\'s details in a 300 px panel from the right; the review chips in the sheet', async ({ page }) => {
        await page.setViewportSize(TABLET);
        await tree(page);
        await openWindow(page);
        await expect(win(page).locator('.mw-canvas .mw-r-tiles').first().locator('.mw-tile')).toHaveCount(5);
        await expect(win(page).locator('.mw-tile-title').first()).toBeVisible();
        expect((await tiles(page).first().boundingBox())!.width).toBeGreaterThanOrEqual(176);
        await expect(win(page).locator('.mw-chips-review [data-mw="notitle"]')).toBeHidden();
        await tiles(page).first().click();
        await expect(viewer(page)).toHaveClass(/active/);
        const box = (await panel(page).boundingBox())!;
        expect(Math.round(box.width)).toBe(300);
        expect(Math.round(box.x + box.width)).toBe(TABLET.width);
    });

    test('sideways: 88 px tiles without text, the list header hidden', async ({ page }) => {
        await page.setViewportSize(SIDEWAYS);
        await tree(page);
        await openWindow(page);
        const w = (await tiles(page).first().boundingBox())!.width;
        expect(w).toBeGreaterThanOrEqual(88);
        expect(w).toBeLessThan(124);
        await expect(win(page).locator('.mw-tile-title').first()).toBeHidden();
        await win(page).locator('[data-mw="view-list"]').click();
        await expect(win(page).locator('.mw-lhead')).toBeHidden();
    });
});
