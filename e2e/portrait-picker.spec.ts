import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeBridge, FakeMaterialFile,
} from './research-bridge.js';

/**
 * Choose photo opens a picker of the person's photos a portrait can be cut
 * from (spec 107, 1122): a popover with a mouse over 1024 px, a bottom sheet
 * on touch; a tile opens the crop editor and in the person dialog the
 * portrait waits for Save. "Portrait from a photo…" at a person without a
 * portrait (the dialog's header, the person page), Change portrait… in the
 * person page's ⋯; the research stopped (one sentence), a working copy that
 * does not come (Try again). Invented data, a fixed clock.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The wedding photo of Josef and Anna (only in the research), and a letter (a PDF) of Josef. */
const FILES = (): FakeMaterialFile[] => [
    materialFile(1, { persons: ['P0001', 'P0002'], title: 'Svatba' }),
    materialFile(2, { persons: ['P0001'], title: 'Dopis', name: 'dopis.pdf', mime: 'application/pdf' }),
];

async function setup(page: Page): Promise<FakeBridge> {
    // Not at midnight UTC: the dates of the files and the toasts stay on their day.
    await page.clock.setFixedTime(new Date(2026, 10, 22, 14, 30));
    const material = fakeMaterial({ files: FILES(), batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return bridge;
}

const personId = (page: Page, first: string) => page.evaluate((first) =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === first)!.id, first);

async function editModal(page: Page, first: string): Promise<void> {
    const id = await personId(page, first);
    await page.evaluate((id) => {
        const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal');
        ui.showEditPersonModal(id);
    }, id);
    await expect(page.locator('#person-modal')).toBeVisible();
}

async function personPage(page: Page, first: string): Promise<void> {
    const id = await personId(page, first);
    await page.evaluate((id) => window.Strom.UI.showPersonPage(id as never), id);
    await expect(ppWin(page)).toBeVisible();
}

/** A file of the tree at the person (a picture). */
const treePhoto = (page: Page, first: string, name: string) => page.evaluate(async ({ first, name, px }) => {
    const dm = window.Strom.DataManager;
    const p = dm.getAllPersons().find(x => x.firstName === first)!;
    dm.addAttachment(p.id, { name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never);
}, { first, name, px: PX });

const stored = (page: Page, first: string) => page.evaluate((first) => {
    const dm = window.Strom.DataManager;
    const p = dm.getAllPersons().find(x => x.firstName === first)!;
    const media = (Object.values(dm.getData().media ?? {}) as { places: { personId?: string }[] }[]).map(a => a.places.map(pl => pl.personId));
    return { photo: p.photo ?? null, sourceId: (p.photoSource as { attachmentId?: string } | undefined)?.attachmentId ?? null, media };
}, first);

const modal = (page: Page) => page.locator('#person-modal');
const ppWin = (page: Page) => page.locator('#person-page-modal');
const popover = (page: Page) => page.locator('#portrait-pick');
const sheet = (page: Page) => page.locator('.portrait-pick-sheet');
const tile = (root: ReturnType<typeof popover>, text: string) => root.locator('.portrait-pick-tile', { hasText: text });
const editor = (page: Page) => page.locator('.pe-overlay');

test.describe('The portrait picker with a mouse (1440)', () => {
    test.use({ viewport: DESKTOP });

    test('the person dialog: Choose photo, a tile, Done, then Save writes the portrait and links the file', async ({ page }) => {
        await setup(page);
        await editModal(page, 'Josef');
        const choose = modal(page).locator('#photo-choose-btn');
        await choose.click();
        await expect(popover(page)).toBeVisible();
        await expect(choose).toHaveAttribute('aria-expanded', 'true');
        await expect(popover(page).locator('.portrait-pick-title')).toHaveText('Portrait from a photo');
        // The picture only (not the letter), with the other person in it.
        await expect(popover(page).locator('.portrait-pick-tile')).toHaveCount(1);
        await expect(tile(popover(page), 'Svatba')).toContainText('and 1 more');
        await expect(popover(page).locator('.portrait-pick-file')).toHaveText('From the computer…');
        await tile(popover(page), 'Svatba').click();
        await expect(editor(page)).toBeVisible();
        await expect(popover(page)).toHaveCount(0);
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        // Waits for Save: nothing written yet, the header's offer gone.
        expect((await stored(page, 'Josef')).photo).toBeNull();
        await expect(modal(page).locator('#pm-portrait-link')).toBeHidden();
        await modal(page).locator('#btn-save').click();
        await expect(modal(page)).toBeHidden();
        const josef = await stored(page, 'Josef');
        expect(josef.photo).not.toBeNull();
        expect(josef.sourceId).not.toBeNull();
        expect(josef.media).toHaveLength(1);
    });

    test('"Portrait from a photo…" in the dialog\'s header and the header circle open the same picker; its own button again closes it', async ({ page }) => {
        await setup(page);
        await editModal(page, 'Josef');
        const link = modal(page).locator('#pm-portrait-link');
        await expect(link).toBeVisible();
        await expect(link).toHaveText('Portrait from a photo…');
        await expect(modal(page).locator('#pm-portrait-sep')).toBeVisible();
        await link.click();
        await expect(popover(page)).toBeVisible();
        await expect(link).toHaveAttribute('aria-expanded', 'true');
        await link.click();
        await expect(popover(page)).toHaveCount(0);
        await expect(link).not.toHaveAttribute('aria-expanded', 'true');
        // The circle in the header is a button now.
        const avatar = modal(page).locator('#pm-avatar');
        await expect(avatar).toBeEnabled();
        await expect(avatar).toHaveAttribute('aria-label', 'Portrait from a photo…');
        await avatar.click();
        await expect(popover(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
        await expect(modal(page)).toBeVisible();
        // The empty preview of the Photo section too.
        const preview = modal(page).locator('#photo-preview');
        await expect(preview).toHaveClass(/is-pick/);
        await preview.click();
        await expect(popover(page)).toBeVisible();
        // Closing the dialog closes the picker.
        await page.evaluate(() => (window.Strom.UI as unknown as { closeModal(): void }).closeModal());
        await expect(popover(page)).toHaveCount(0);
    });

    test('a person without photos: no offer in the header, Choose photo goes straight to the file picker', async ({ page }) => {
        await setup(page);
        await editModal(page, 'Jan');
        await expect(modal(page).locator('#pm-portrait-link')).toBeHidden();
        await expect(modal(page).locator('#pm-avatar')).toBeDisabled();
        const chooser = page.waitForEvent('filechooser');
        await modal(page).locator('#photo-choose-btn').click();
        await chooser;
        await expect(popover(page)).toHaveCount(0);
    });

    test('the person page: the initials and "Portrait from a photo…" without a portrait, Change portrait… in the ⋯ with one', async ({ page }) => {
        await setup(page);
        await personPage(page, 'Josef');
        const link = ppWin(page).locator('.pp-portrait-link');
        await expect(link).toHaveText('Portrait from a photo…');
        await link.click();
        await expect(popover(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
        await expect(ppWin(page)).toBeVisible();
        await ppWin(page).locator('button.pp-initials--pick').click();
        await expect(popover(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(ppWin(page)).toHaveCount(0);

        // With a portrait: no link, Change portrait… in the ⋯ before the crop.
        await page.evaluate(({ px }) => {
            const dm = window.Strom.DataManager;
            dm.updatePerson(dm.getAllPersons().find(x => x.firstName === 'Josef')!.id, { photo: px });
        }, { px: PX });
        await personPage(page, 'Josef');
        await expect(ppWin(page).locator('.pp-portrait-link')).toHaveCount(0);
        await ppWin(page).locator('.pp-more').click();
        await expect(ppWin(page).locator('.pp-menu-item:visible')).toHaveText(['Edit person', 'Change portrait…', 'Edit portrait crop', 'Focus in tree', 'Give a family tree…']);
        await ppWin(page).locator('[data-pp-menu="portrait"]').click();
        await expect(popover(page)).toBeVisible();
        await tile(popover(page), 'Svatba').click();
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        // Written at once on the page.
        await expect.poll(async () => (await stored(page, 'Josef')).sourceId).not.toBeNull();
        expect((await stored(page, 'Josef')).photo).not.toBe(PX);
    });

    test('the research stopped: the picker says its photos wait for it in one sentence, nothing in the header', async ({ page }) => {
        const bridge = await setup(page);
        // The research's list of files kept in the page first (it comes after the bridge's answer, by itself):
        // a bridge stopped before it came would leave no research photo to speak of.
        const josef = await personId(page, 'Josef');
        await expect.poll(() => page.evaluate((id) => (window.Strom.UI as unknown as {
            portraitPickerModel(id: string): { shown: unknown[] };
        }).portraitPickerModel(id).shown.length, josef)).toBeGreaterThan(0);
        bridge.down = true;
        await poll(page);
        await editModal(page, 'Josef');
        await expect(modal(page).locator('#pm-portrait-link')).toBeHidden();
        await modal(page).locator('#photo-choose-btn').click();
        await expect(popover(page)).toBeVisible();
        await expect(popover(page).locator('.portrait-pick-tile')).toHaveCount(0);
        await expect(popover(page).locator('.portrait-pick-note')).toContainText('Photos from the research (1) are available while the research runs.');
        await expect(popover(page).locator('.portrait-pick-file')).toBeVisible();
    });

    test('the working copy does not come: one sentence with Try again, the picker stays, nothing written', async ({ page }) => {
        await setup(page);
        const wedding = (url: URL) => url.searchParams.get('file') === '1';
        await page.route(wedding, (route) => route.fulfill({ status: 500, body: '' }));
        await editModal(page, 'Josef');
        await modal(page).locator('#photo-choose-btn').click();
        await tile(popover(page), 'Svatba').click();
        const status = popover(page).locator('.portrait-pick-status.is-err');
        await expect(status).toContainText('The photo could not be loaded.');
        await expect(status.locator('[data-pick-act="retry"]')).toHaveText('Try again');
        await expect(editor(page)).toHaveCount(0);
        await expect(popover(page)).toBeVisible();
        // It comes the second time.
        await page.unroute(wedding);
        await status.locator('[data-pick-act="retry"]').click();
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(editor(page)).toHaveCount(0);
        expect((await stored(page, 'Josef')).media).toEqual([]);
    });
});

test.describe('The portrait picker on a phone (390, touch)', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    test('a bottom sheet with the tree\'s files; From this device… opens the file picker', async ({ page }) => {
        await setup(page);
        await treePhoto(page, 'Josef', 'na-poli.png');
        await editModal(page, 'Josef');
        await modal(page).locator('#photo-choose-btn').click();
        await expect(sheet(page)).toBeVisible();
        await expect(popover(page)).toHaveCount(0);
        // Touch: the tree's files only.
        await expect(sheet(page).locator('.portrait-pick-tile')).toHaveCount(1);
        await expect(tile(sheet(page), 'na-poli')).toBeVisible();
        const file = sheet(page).locator('.portrait-pick-file');
        await expect(file).toHaveText('From this device…');
        const chooser = page.waitForEvent('filechooser');
        await file.click();
        await chooser;
        await expect(sheet(page)).toHaveCount(0);
    });
});
