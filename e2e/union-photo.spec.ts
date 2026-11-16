/**
 * The couple's photo (spec 107 §6, §7): its row in the relationships panel
 * (Choose photo, the thumbnail and its viewer, Remove with its question),
 * kept by Save and dropped by Cancel like the panel's other changes; Make
 * portraits… with a step per partner in the card's order, Skip, Keep and
 * Replace, all the portraits as one step. Invented data.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';

const PID = 'u_ilsa_oskar';
const panel = (page: Page) => page.locator('#relationships-modal');
const row = (page: Page) => panel(page).locator(`.pg-photo[data-partnership-id="${PID}"]`);
const editor = (page: Page) => page.locator('.pe-overlay');

/** A 1200 × 800 PNG: the left half red, the right half blue. */
async function couplePng(page: Page): Promise<Buffer> {
    const b64 = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 800;
        const x = c.getContext('2d')!;
        x.fillStyle = '#c0392b'; x.fillRect(0, 0, 600, 800);
        x.fillStyle = '#2980b9'; x.fillRect(600, 0, 600, 800);
        return c.toDataURL('image/png').split(',')[1];
    });
    return Buffer.from(b64, 'base64');
}

/** The same picture as a data URL, set as the union's photo without the panel. */
async function setPhoto(page: Page): Promise<void> {
    await page.evaluate((pid) => {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 800;
        const x = c.getContext('2d')!;
        x.fillStyle = '#c0392b'; x.fillRect(0, 0, 600, 800);
        x.fillStyle = '#2980b9'; x.fillRect(600, 0, 600, 800);
        window.Strom.DataManager.updatePartnership(pid as never, { photo: c.toDataURL('image/jpeg', 0.8), photoOriginalName: 'svatba-1924.jpg' });
    }, PID);
}

/** Ilsa (person1 of the union) and Oskar: the card shows Oskar on the left. */
async function seed(page: Page, extra: { ilsa?: Record<string, unknown>; oskar?: Record<string, unknown> } = {}): Promise<void> {
    await openApp(page);
    await seedTree(page, {
        ilsa: { firstName: 'Ilsa', lastName: 'Quellmayer', gender: 'female', birthDate: '1901', partners: ['oskar'], ...extra.ilsa },
        oskar: { firstName: 'Oskar', lastName: 'Quellmayer', gender: 'male', birthDate: '1898', ...extra.oskar },
    });
}

async function openPanel(page: Page, id = 'ilsa'): Promise<void> {
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id as never), id);
    await expect(panel(page)).toBeVisible();
}

/** Cancel with changes in the panel: the unsaved-changes question, Discard. */
async function discard(page: Page): Promise<void> {
    await page.locator('#relationships-modal button.secondary', { hasText: 'Cancel' }).click();
    await page.locator('#confirmation-modal.active #confirm-discard-btn').click();
    await expect(panel(page)).toBeHidden();
}

const union = (page: Page) => page.evaluate((pid) => {
    const u = window.Strom.DataManager.getPartnership(pid as never);
    return { photo: u?.photo ?? null, name: u?.photoOriginalName ?? null };
}, PID);

const portraits = (page: Page) => page.evaluate(() => {
    const out: Record<string, { photo: string | null; source: unknown }> = {};
    for (const id of ['ilsa', 'oskar']) {
        const p = window.Strom.DataManager.getPerson(id as never)!;
        out[id] = { photo: p.photo ?? null, source: p.photoSource ?? null };
    }
    return out;
});

test.describe('The couple’s photo in the relationships panel (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Choose photo shows the thumbnail and the actions at once; Cancel drops it, Save keeps it as one step', async ({ page }) => {
        await seed(page);
        await openPanel(page);
        await expect(row(page).locator('.pg-label')).toHaveText('Photo');
        await expect(row(page).locator('button')).toHaveText(['Choose photo']);
        await expect(row(page).locator('.pg-photo-hint')).toBeVisible();
        const png = await couplePng(page);

        let chooser = page.waitForEvent('filechooser');
        await row(page).getByRole('button', { name: 'Choose photo' }).click();
        await (await chooser).setFiles({ name: 'svatba-1924.png', mimeType: 'image/png', buffer: png });
        await expect(row(page).locator('.pg-photo-thumb img')).toBeVisible();
        await expect(row(page).locator('.pg-photo-actions button')).toHaveText(['Choose photo', 'Make portraits…', 'Remove']);
        await expect(row(page).locator('.pg-photo-size')).toHaveText(/^\d+ kB$/);
        await expect(row(page).locator('.pg-photo-hint')).toHaveCount(0);
        await discard(page);
        expect((await union(page)).photo).toBeNull();

        await openPanel(page);
        chooser = page.waitForEvent('filechooser');
        await row(page).getByRole('button', { name: 'Choose photo' }).click();
        await (await chooser).setFiles({ name: 'svatba-1924.png', mimeType: 'image/png', buffer: png });
        await expect(row(page).locator('.pg-photo-thumb img')).toBeVisible();
        await panel(page).getByRole('button', { name: 'Save' }).click();
        await expect(panel(page)).toBeHidden();
        const saved = await union(page);
        expect(saved.photo).toMatch(/^data:image\/jpeg/);
        expect(saved.name).toBe('svatba-1924.png');
        // One step in the history: Undo takes the photo away.
        await page.evaluate(() => window.Strom.UI.performUndo());
        expect((await union(page)).photo).toBeNull();
    });

    test('the thumbnail opens the viewer with the partners in the card’s order and Make portraits…', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await openPanel(page);
        await row(page).locator('.pg-photo-thumb').click();
        const viewer = page.locator('#attachment-overlay');
        await expect(viewer).toBeVisible();
        await expect(viewer.locator('.mv-title')).toHaveText('Oskar and Ilsa · couple’s photo');
        await expect(viewer.locator('.mv-name')).toHaveText('svatba-1924.jpg');
        await expect(viewer.locator('.mv-act')).toHaveText(['Download', 'Make portraits…']);
        await viewer.getByRole('button', { name: 'Make portraits…' }).click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-step')).toHaveText([/Oskar/, /Ilsa/]);
    });

    test('Remove asks first and says the portraits stay; they keep their picture, cut off from the photo', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await page.evaluate((pid) => {
            const DM = window.Strom.DataManager;
            DM.updatePerson('oskar' as never, { photo: DM.getPartnership(pid as never)!.photo, photoSource: { partnershipId: pid, region: { x: 0, y: 0, w: 0.5, h: 0.75 } } as never });
        }, PID);
        await openPanel(page);
        await row(page).getByRole('button', { name: 'Remove' }).click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm).toContainText('Remove the couple’s photo?');
        await expect(confirm).toContainText('Portraits made from it stay.');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        expect((await union(page)).photo).not.toBeNull();
        await row(page).getByRole('button', { name: 'Remove' }).click();
        await confirm.locator('#confirm-ok-btn').click();
        await expect(row(page).locator('.pg-photo-thumb')).toHaveCount(0);
        await expect(row(page).locator('button')).toHaveText(['Choose photo']);
        await panel(page).getByRole('button', { name: 'Save' }).click();
        expect((await union(page)).photo).toBeNull();
        const p = await portraits(page);
        expect(p.oskar.photo).not.toBeNull();
        expect(p.oskar.source).toBeNull();
    });

    test('a locked partner: the thumbnail and size only, no row without a photo', async ({ page }) => {
        await seed(page, { oskar: { isLocked: true } });
        await openPanel(page);
        await expect(row(page)).toHaveCount(0);
        await page.locator('#relationships-modal button.secondary', { hasText: 'Cancel' }).click();
        await setPhoto(page);
        await openPanel(page);
        await expect(row(page).locator('.pg-photo-thumb')).toBeVisible();
        await expect(row(page).locator('button:not(.pg-photo-thumb)')).toHaveCount(0);
        await expect(row(page).locator('.pg-photo-size')).toHaveText(/kB$/);
        await row(page).locator('.pg-photo-thumb').click();
        await expect(page.locator('#image-viewer-panel .mv-act')).toHaveText(['Download']);
    });
});

test.describe('Make portraits… (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('two steps in the card’s order: Done saves both, naming the photo; the panel keeps them with Save, one Undo takes both back', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await openPanel(page);
        await row(page).getByRole('button', { name: 'Make portraits…' }).click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page)).toContainText('Portraits from the couple’s photo');
        await expect(editor(page).locator('.pe-step')).toHaveText([/Oskar/, /Ilsa/]);
        await editor(page).locator('.pe-primary').click();
        await expect(editor(page).locator('.pe-primary')).toHaveText('Done');
        await editor(page).locator('.pe-primary').click();
        await expect(editor(page)).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '2 portraits saved from the couple’s photo.' })).toBeVisible();
        let p = await portraits(page);
        expect(p.oskar.source).toMatchObject({ partnershipId: PID });
        expect(p.ilsa.source).toMatchObject({ partnershipId: PID });
        // Oskar is cut from the left half, Ilsa from the right one.
        expect((p.oskar.source as { region: { x: number } }).region.x).toBeLessThan(0.25);
        expect((p.ilsa.source as { region: { x: number } }).region.x).toBeGreaterThan(0.4);
        await panel(page).getByRole('button', { name: 'Save' }).click();
        await expect(panel(page)).toBeHidden();
        await page.evaluate(() => window.Strom.UI.performUndo());
        p = await portraits(page);
        expect(p.oskar.photo).toBeNull();
        expect(p.ilsa.photo).toBeNull();
    });

    test('Cancel in the panel drops the portraits made', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await openPanel(page);
        await row(page).getByRole('button', { name: 'Make portraits…' }).click();
        await editor(page).locator('.pe-primary').click();
        await editor(page).locator('.pe-primary').click();
        await expect(editor(page)).toHaveCount(0);
        await discard(page);
        const p = await portraits(page);
        expect(p.oskar.photo).toBeNull();
        expect(p.ilsa.photo).toBeNull();
    });

    test('outside the panel: Skip leaves a partner out, the toast counts it, Undo takes the portrait back', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await page.evaluate((pid) => { void window.Strom.UI.makeUnionPortraits(pid as never); }, PID);
        await expect(editor(page)).toBeVisible();
        await editor(page).locator('.pe-skip').click();
        await expect(editor(page).locator('.pe-primary')).toHaveText('Done');
        await editor(page).locator('.pe-primary').click();
        const toast = page.locator('.undo-toast', { hasText: '1 portrait saved from the couple’s photo, 1 skipped.' });
        await expect(toast).toBeVisible();
        let p = await portraits(page);
        expect(p.oskar.photo).toBeNull();
        expect(p.ilsa.source).toMatchObject({ partnershipId: PID });
        await toast.getByRole('button', { name: 'Undo' }).click();
        p = await portraits(page);
        expect(p.ilsa.photo).toBeNull();
    });

    test('a partner with a portrait: Keep leaves it, Replace makes a new one', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        const old = await page.evaluate(() => {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            const x = c.getContext('2d')!;
            x.fillStyle = '#27ae60'; x.fillRect(0, 0, 64, 64);
            const url = c.toDataURL('image/jpeg', 0.8);
            window.Strom.DataManager.updatePerson('oskar' as never, { photo: url });
            window.Strom.DataManager.updatePerson('ilsa' as never, { photo: url });
            return url;
        });
        await page.evaluate((pid) => { void window.Strom.UI.makeUnionPortraits(pid as never); }, PID);
        await expect(editor(page)).toBeVisible();
        // Oskar: keep.
        await editor(page).locator('.pe-tile[data-keep="1"]').click();
        await editor(page).locator('.pe-primary').click();
        // Ilsa: replace.
        await editor(page).locator('.pe-tile[data-keep="0"]').click();
        await editor(page).locator('.pe-primary').click();
        await expect(page.locator('.undo-toast', { hasText: '1 portrait saved from the couple’s photo, 1 skipped.' })).toBeVisible();
        const p = await portraits(page);
        expect(p.oskar.photo).toBe(old);
        expect(p.oskar.source).toBeNull();
        expect(p.ilsa.photo).not.toBe(old);
        expect(p.ilsa.source).toMatchObject({ partnershipId: PID });
    });
});

test.describe('The couple’s photo row on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the thumbnail is 48 px high and the buttons are 44 px touch targets', async ({ page }) => {
        await seed(page);
        await setPhoto(page);
        await openPanel(page);
        const thumb = await row(page).locator('.pg-photo-thumb').boundingBox();
        expect(Math.round(thumb!.height)).toBe(48);
        for (const b of await row(page).locator('.pg-photo-actions button').all()) {
            expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        const box = await panel(page).locator('.modal-content, .modal').first().boundingBox();
        const r = await row(page).boundingBox();
        expect(r!.x + r!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    });
});

/** Table › Unions with the Photo column shown: Ilsa and Oskar's union has a photo, Wolfhart and Adelgunde's none. */
async function openUnionsTable(page: Page, phone = false): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, {
        ilsa: { firstName: 'Ilsa', lastName: 'Quellmayer', gender: 'female', birthDate: '1901', partners: ['oskar'] },
        oskar: { firstName: 'Oskar', lastName: 'Quellmayer', gender: 'male', birthDate: '1898' },
        wolfhart: { firstName: 'Wolfhart', lastName: 'Fronwieser', gender: 'male', birthDate: '1880', partners: ['adelgunde'] },
        adelgunde: { firstName: 'Adelgunde', lastName: 'Fronwieser', gender: 'female', birthDate: '1884' },
    });
    await setPhoto(page);
    await page.locator(phone ? '#bb-view-table' : '#view-mode-table').click();
    const tv = page.locator('#table-container');
    if (phone) {
        await tv.locator('.tv-rowtype-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: /^Unions/ }).tap();
    } else {
        await tv.locator('.tv-rowtype [data-rowtype="unions"]').click();
    }
    await expect(tv).toHaveAttribute('data-rowtype', 'unions');
    await expect(tv.locator('.tv-headrow [data-col="uPhoto"]')).toHaveCount(0);
    if (phone) {
        await tv.locator('.tv-more-menu-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Columns' }).tap();
    } else {
        await tv.locator('.tv-cols-btn').click();
    }
    const cols = page.locator('.tv-colpanel');
    await page.locator('.tv-cp-q').fill('Photo');
    await cols.getByRole('checkbox', { name: 'Photo', exact: true }).check();
    await cols.locator('.tv-cp-done').click();
    await expect(tv.locator('.tv-headrow [data-col="uPhoto"]')).toBeVisible();
}

test.describe('Table › Unions, the Photo column (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the thumbnail zooms the photo with Make portraits…, written at once with Undo; the filter with / without photo', async ({ page }) => {
        await openUnionsTable(page);
        const tv = page.locator('#table-container');
        const thumbs = tv.locator('.tv-body .tv-thumb');
        await expect(thumbs).toHaveCount(1);
        await expect(tv.locator(`.tv-row[data-key="u:${PID}"] .tv-thumb img`)).toHaveAttribute('src', /^blob:/);
        await thumbs.click();
        await expect(page.locator('#image-viewer-panel .mv-title')).toHaveText('Oskar and Ilsa · couple’s photo');
        await page.locator('#image-viewer-panel').getByRole('button', { name: 'Make portraits…' }).click();
        await expect(editor(page)).toBeVisible();
        await editor(page).locator('.pe-primary').click();
        await editor(page).locator('.pe-primary').click();
        const toast = page.locator('.undo-toast', { hasText: '2 portraits saved from the couple’s photo.' });
        await expect(toast).toBeVisible();
        expect((await portraits(page)).oskar.source).toMatchObject({ partnershipId: PID });
        await toast.getByRole('button', { name: 'Undo' }).click();
        const p = await portraits(page);
        expect(p.oskar.photo).toBeNull();
        expect(p.ilsa.photo).toBeNull();

        // The filter: "without photo" and "with photo" alone.
        await tv.locator('.tv-headrow [data-col="uPhoto"]').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="filter"]').click();
        const panel = page.locator('.tv-fpanel');
        await expect(panel.locator('.tv-ff-check')).toHaveText(['without photo', 'with photo']);
        await expect(panel.locator('input[type="text"], input[type="number"]')).toHaveCount(0);
        await panel.getByRole('checkbox', { name: 'with photo' }).check();
        await panel.locator('.tv-fpanel-apply').click();
        await expect(tv.locator('.tv-status-count')).toHaveText('1 of 2 unions');
        await expect(tv.locator('.tv-body .tv-row[data-key]')).toHaveCount(1);
    });
});

test.describe('Table › Unions, the Photo column on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the thumbnail fits the row and a tap zooms the photo', async ({ page }) => {
        await openUnionsTable(page, true);
        const thumb = page.locator(`#table-container .tv-row[data-key="u:${PID}"] .tv-thumb`);
        await thumb.scrollIntoViewIfNeeded();
        const box = (await thumb.boundingBox())!;
        const row = (await page.locator(`#table-container .tv-row[data-key="u:${PID}"]`).boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(row.height);
        await thumb.tap();
        await expect(page.locator('#image-viewer-panel .mv-title')).toHaveText('Oskar and Ilsa · couple’s photo');
    });
});
