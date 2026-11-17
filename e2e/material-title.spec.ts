import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';
import { openApp, seedTree, cardAction, personModal } from './helpers.js';

/**
 * A material's title, kind and date (spec 102 §2): edited in place in the
 * viewer (✎, "Add a title", F2; Enter saves, Esc cancels and the viewer
 * stays; an empty title brings the file's name back; one undo step), in the
 * Attachment dialog from the person's attachment row (title, kind — the
 * chosen kind clicked again is none — date and note), and for material
 * outside the tree through the research's `material.edit` (a toast with
 * Undo), an older research that cannot (its sentence, nothing sent) and a
 * stopped one (off). Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const EDIT_FEATURES = [...MATERIAL_FEATURES, 'material.edit'];

async function setup(page: Page, opts: { features?: string[]; files?: FakeMaterialFile[] } = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? [], batches: [], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? EDIT_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

const janId = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);

/** Jan's file kept by the tree only (no original in the research); its id. */
async function attachToJan(page: Page, name: string): Promise<string> {
    const id = await janId(page);
    return page.evaluate(({ id, name, px }) => {
        const a = window.Strom.DataManager.addAttachment(id as never, { name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 })!;
        return a.id as string;
    }, { id, name, px: PX });
}

const stored = (page: Page, id: string) => page.evaluate((id) => {
    const a = window.Strom.DataManager.getMedia(id)!;
    return { title: a.title ?? null, kind: a.kind ?? null, date: a.date ?? null, note: a.note ?? null };
}, id);

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const form = (page: Page) => panel(page).locator('.mv-edit-form');
const kindOpt = (root: ReturnType<Page['locator']>, kind: string) => root.locator(`.mat-edit-kind-opt[data-kind="${kind}"]`);
const dialog = (page: Page) => page.locator('.mdlg-overlay .mdlg');
const toast = (page: Page) => page.locator('.toast[data-kind="materials"]');

async function view(page: Page, text: string): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await tile(page, text).click();
    await expect(viewer(page)).toHaveClass(/active/);
    await expect(panel(page).locator('.mv-title')).toBeVisible();
}

test.describe('A material\'s title in the viewer', () => {
    test.use({ viewport: DESKTOP });

    test('the tree\'s file: F2 opens the fields, Esc cancels and the viewer stays, Enter saves; Tab goes title → kind → date → Save; Undo in one step', async ({ page }) => {
        await setup(page);
        const id = await attachToJan(page, 'IMG_0042.png');
        await view(page, 'IMG_0042.png');
        const pen = panel(page).locator('.mv-edit');
        await expect(pen).toHaveAttribute('aria-label', 'Edit title and details');
        await expect(panel(page).locator('.mv-add-title')).toHaveText('Add a title');
        // No title: no File row (the name is the title).
        await expect(panel(page).locator('.mv-file')).toHaveCount(0);

        await page.keyboard.press('F2');
        await expect(form(page)).toBeVisible();
        const title = form(page).locator('.mat-edit-title');
        await expect(title).toBeFocused();
        await expect(title).toHaveValue('');
        await expect(title).toHaveAttribute('maxlength', '300');
        await expect(form(page).locator('.mv-keys')).toHaveText('Enter saves · Esc cancels');
        // The Kind and Date rows of the fields wait while editing.
        await expect(panel(page).locator('.mv-fields dt', { hasText: 'Kind' })).toHaveCount(0);
        await title.fill('Not this one');
        await page.keyboard.press('Escape');
        await expect(form(page)).toHaveCount(0);
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(pen).toBeFocused();
        await expect(panel(page).locator('.mv-title')).toHaveText('IMG_0042.png');
        expect(await stored(page, id)).toEqual({ title: null, kind: null, date: null, note: null });

        await pen.click();
        await expect(title).toBeFocused();
        await title.fill('Wedding outside the church, May 1924');
        await page.keyboard.press('Tab');
        await expect(kindOpt(form(page), 'photo')).toBeFocused();
        // The chosen kind clicked again is no kind.
        await kindOpt(form(page), 'photo').click();
        await expect(kindOpt(form(page), 'photo')).toHaveAttribute('aria-pressed', 'true');
        await kindOpt(form(page), 'photo').click();
        await expect(kindOpt(form(page), 'photo')).toHaveAttribute('aria-pressed', 'false');
        await kindOpt(form(page), 'document').click();
        await expect(kindOpt(form(page), 'document')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Tab');
        await expect(form(page).locator('.mat-edit-date')).toBeFocused();
        await page.keyboard.type('1924');
        await page.keyboard.press('Tab');
        await expect(form(page).locator('[data-action="saveDetails"]')).toBeFocused();
        await form(page).locator('.mat-edit-date').press('Enter');
        await expect(form(page)).toHaveCount(0);
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(panel(page).locator('.mv-title')).toHaveText('Wedding outside the church, May 1924');
        await expect(panel(page).locator('.mv-file')).toHaveText('IMG_0042.png');
        await expect(panel(page).locator('.mv-add-title')).toHaveCount(0);
        await expect(panel(page).locator('.mv-summary')).toContainText('1924');
        expect(await stored(page, id)).toEqual({ title: 'Wedding outside the church, May 1924', kind: 'document', date: '1924', note: null });

        // One undo step takes title, kind and date back.
        await page.evaluate(() => (window.Strom.UI as unknown as { performUndo(): void }).performUndo());
        expect(await stored(page, id)).toEqual({ title: null, kind: null, date: null, note: null });
        await expect(panel(page).locator('.mv-title')).toHaveText('IMG_0042.png');
        await expect(panel(page).locator('.mv-add-title')).toBeVisible();
    });

    test('an empty title brings the file\'s name back; Add a title opens the fields', async ({ page }) => {
        await setup(page);
        const id = await attachToJan(page, 'IMG_0043.png');
        await page.evaluate((id) => window.Strom.DataManager.setMediaDetails(id, { title: 'Letter from Bohdalec' }), id);
        await view(page, 'Letter from Bohdalec');
        await expect(panel(page).locator('.mv-add-title')).toHaveCount(0);
        await expect(panel(page).locator('.mv-file')).toHaveText('IMG_0043.png');
        await page.keyboard.press('F2');
        const title = form(page).locator('.mat-edit-title');
        await expect(title).toHaveValue('Letter from Bohdalec');
        await title.fill('');
        await title.press('Enter');
        await expect(form(page)).toHaveCount(0);
        await expect(panel(page).locator('.mv-title')).toHaveText('IMG_0043.png');
        await expect(panel(page).locator('.mv-file')).toHaveCount(0);
        expect((await stored(page, id)).title).toBeNull();
        await panel(page).locator('.mv-add-title').click();
        await expect(title).toBeFocused();
    });
});

test.describe('The Attachment dialog', () => {
    test.use({ viewport: DESKTOP });

    test('the row\'s ⋯ → Title and details…: the file on top, title, kind, date and note saved in one undo step; the row shows them', async ({ page }) => {
        // A tree without a research: the person's attachment rows.
        await openApp(page);
        await seedTree(page, { kv: { firstName: 'Kunhuta', lastName: 'Brumlik', birthDate: '1902',
            attachments: [{ id: 'att_dopis', name: 'IMG_0044.png', mimeType: 'image/png', dataUrl: PX, sizeBytes: 70 }] } });
        const id = 'att_dopis';
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Kunhuta', 'edit');
        await expect(personModal(page)).toBeVisible();
        const row = page.locator('#person-modal #attachments-list .attachment-row', { hasText: 'IMG_0044.png' });
        await row.locator('.attachment-more').click();
        await page.locator('#materials-item-menu [data-action="edit"]').click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.mdlg-file')).toHaveText('IMG_0044.png');
        await expect(dialog(page).locator('.mat-edit-hint')).toHaveText('Shown instead of the file name. Empty = the file name.');
        await expect(dialog(page).locator('.mat-edit-title')).toBeFocused();
        await dialog(page).locator('.mat-edit-title').fill('Letter from Bohdalec');
        // Tab stays in the dialog: title → kind → date → note.
        await page.keyboard.press('Tab');
        await expect(kindOpt(dialog(page), 'photo')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog(page).locator('.mat-edit-date')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog(page).locator('.mat-edit-note')).toBeFocused();
        await kindOpt(dialog(page), 'record').click();
        await kindOpt(dialog(page), 'record').click();
        await expect(kindOpt(dialog(page), 'record')).toHaveAttribute('aria-pressed', 'false');
        await kindOpt(dialog(page), 'document').click();
        await dialog(page).locator('.mat-edit-date').fill('1931');
        await dialog(page).locator('.mat-edit-note').fill('From aunt Ermelinda');
        await dialog(page).getByRole('button', { name: 'Save' }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await stored(page, id)).toEqual({ title: 'Letter from Bohdalec', kind: 'document', date: '1931', note: 'From aunt Ermelinda' });
        const titled = page.locator('#person-modal #attachments-list .attachment-row', { hasText: 'Letter from Bohdalec' });
        await expect(titled.locator('.attachment-name')).toHaveText('Letter from Bohdalec');
        await expect(titled.locator('.attachment-size').first()).toContainText(/^IMG_0044\.png · Document · 1931 · /);
        await expect(titled.locator('.attachment-note-text')).toHaveText('From aunt Ermelinda');

        // Esc in the dialog cancels without writing.
        await titled.locator('.attachment-more').click();
        await page.locator('#materials-item-menu [data-action="edit"]').click();
        await dialog(page).locator('.mat-edit-title').fill('Something else');
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
        expect((await stored(page, id)).title).toBe('Letter from Bohdalec');

        await page.evaluate(() => (window.Strom.UI as unknown as { performUndo(): void }).performUndo());
        expect(await stored(page, id)).toEqual({ title: null, kind: null, date: null, note: null });
    });
});

test.describe('Material outside the tree', () => {
    test.use({ viewport: DESKTOP });

    test('with material.edit: Enter sends POST /material/edit; the toast\'s Undo sends what was', async ({ page }) => {
        const { material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        await view(page, 'scan-1.jpg');
        await expect(panel(page).locator('.mv-add-title')).toBeVisible();
        await page.keyboard.press('F2');
        await form(page).locator('.mat-edit-title').fill('Letter from Bohdalec');
        await kindOpt(form(page), 'document').click();
        await form(page).locator('.mat-edit-title').press('Enter');
        await expect.poll(() => material.edits?.length ?? 0).toBe(1);
        expect(material.edits![0]).toEqual({ ids: ['I0001'], title: 'Letter from Bohdalec', kind: 'document' });
        await expect(form(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Saved: Letter from Bohdalec.');
        await expect(panel(page).locator('.mv-title')).toHaveText('Letter from Bohdalec');
        await toast(page).getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => material.edits?.length ?? 0).toBe(2);
        expect(material.edits![1]).toEqual({ ids: ['I0001'], title: '', kind: '' });
        expect(material.files[0].title).toBeUndefined();
    });

    test('an older research (no material.edit): its sentence, no ✎, F2 sends nothing', async ({ page }) => {
        const { material } = await setup(page, { features: MATERIAL_FEATURES, files: [materialFile(1, { persons: ['P0003'] })] });
        await view(page, 'scan-1.jpg');
        await expect(panel(page).locator('.mv-older-edit')).toHaveText('A newer version of the research can title material that is not in the tree.');
        await expect(panel(page).locator('.mv-edit')).toHaveCount(0);
        await expect(panel(page).locator('.mv-add-title')).toHaveCount(0);
        await page.keyboard.press('F2');
        await expect(form(page)).toHaveCount(0);
        expect(material.edits ?? []).toEqual([]);
    });

    test('the research stopped: ✎ off with the sentence, nothing sent', async ({ page }) => {
        const { bridge, material } = await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(tile(page, 'scan-1.jpg')).toBeVisible();
        bridge.down = true;
        await poll(page);
        await tile(page, 'scan-1.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        const pen = panel(page).locator('.mv-edit');
        await expect(pen).toHaveAttribute('aria-disabled', 'true');
        await expect(pen).toHaveAttribute('title', 'Linking, hiding and editing material outside the tree works while the research runs.');
        await expect(panel(page).locator('.mv-off')).toHaveText('Linking, hiding and editing material outside the tree works while the research runs.');
        await expect(panel(page).locator('.mv-add-title')).toHaveCount(0);
        await pen.click({ force: true });
        await page.keyboard.press('F2');
        await expect(form(page)).toHaveCount(0);
        expect(material.edits ?? []).toEqual([]);
    });
});

test.describe('Searching the materials window', () => {
    test.use({ viewport: DESKTOP });

    test('finds a file by its title, its file name and its note', async ({ page }) => {
        await setup(page, { files: [materialFile(1, { persons: ['P0003'] })] });
        const id = await attachToJan(page, 'IMG_0045.png');
        await page.evaluate((id) => window.Strom.DataManager.setMediaDetails(id, { title: 'Letter from Bohdalec', note: 'From aunt Ermelinda' }), id);
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(win(page)).toBeVisible();
        const search = win(page).locator('input[type="search"], .mw-search input').first();
        await expect(search).toHaveAttribute('placeholder', 'Search title, name and note');
        for (const q of ['bohdalec', 'img_0045', 'ermelinda']) {
            await search.fill(q);
            await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
            await expect(tile(page, 'Letter from Bohdalec')).toBeVisible();
        }
        await search.fill('scan-1');
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
        await expect(tile(page, 'scan-1.jpg')).toBeVisible();
    });
});
