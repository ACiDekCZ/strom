import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal } from './helpers.js';

/**
 * Register entries on sources: excerpt thumbnails on citation chips, the
 * source viewer, the editor's excerpt block (paste, upload + crop, crop from
 * an attachment), "another entry from the same register", the picker, and
 * leaving images out of an import. Invented data only.
 */

/** A PNG of the given size drawn in the page (a stand-in for a register page). */
async function pngBuffer(page: Page, width: number, height: number): Promise<Buffer> {
    const b64 = await page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#333';
        for (let y = 40; y < height; y += 60) ctx.fillRect(40, y, width - 80, 6);
        return c.toDataURL('image/png').split(',')[1];
    }, { width, height });
    return Buffer.from(b64, 'base64');
}

/** A small JPEG data URL made in the page. */
function jpegDataUrl(page: Page, width = 600, height = 120): Promise<string> {
    return page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#123'; ctx.fillRect(10, 10, width / 2, 20);
        return c.toDataURL('image/jpeg', 0.8);
    }, { width, height });
}

/** Research fields on, one person "Jan" in the tree. Returns Jan's id. */
async function setup(page: Page): Promise<string> {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1865' });
    return page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].id as string);
}

/** Add a source (optionally with an excerpt) and cite it on the person. */
async function addCitedSource(page: Page, personId: string, source: Record<string, unknown>): Promise<string> {
    return page.evaluate(({ personId, source }) => {
        const dm = window.Strom.DataManager;
        const src = dm.addSource(source);
        dm.citePerson(personId, src.id);
        return src.id as string;
    }, { personId, source });
}

async function openPersonSources(page: Page) {
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await expect(modal.locator('#person-sources-section')).toBeVisible();
    return modal;
}

/** Paste a PNG into the focused element of the page (Chromium ClipboardEvent). */
async function pasteImage(page: Page, selector: string, png: Buffer): Promise<void> {
    await page.evaluate(({ selector, b64 }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
        const target = document.querySelector(selector)!;
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { selector, b64: png.toString('base64') });
}

const editor = (page: Page) => page.locator('#source-editor-modal');
const viewer = (page: Page) => page.locator('#source-viewer-modal');
const cropper = (page: Page) => page.locator('.crop-overlay');

test.describe('citation chips and the viewer', () => {
    test('a chip shows an icon or the excerpt; clicking opens the viewer; × still uncites', async ({ page }) => {
        const jan = await setup(page);
        const jpeg = await jpegDataUrl(page);
        await addCitedSource(page, jan, { title: 'Bez výřezu' });
        await addCitedSource(page, jan, {
            title: 'Křest Jana', repository: 'SOA Zámrsk', reference: 'fol. 45', transcript: 'Jan, syn Josefa',
            url: 'https://archive.example/book/1', recordDate: '1865-03-14', quality: 3,
            excerpts: [{ id: 'e1', dataUrl: jpeg, width: 600, height: 120, sizeBytes: 900,
                pageUrl: 'https://archive.example/book/1/image/57', caption: 'levá strana' }],
        });
        const modal = await openPersonSources(page);
        const chips = modal.locator('#person-sources-chips .source-chip');
        await expect(chips).toHaveCount(2);
        await expect(chips.filter({ hasText: 'Bez výřezu' }).locator('.source-chip-icon')).toHaveCount(1);
        await expect(chips.filter({ hasText: 'Křest Jana' }).locator('img.source-chip-thumb')).toHaveCount(1);

        await chips.filter({ hasText: 'Křest Jana' }).locator('.source-chip-open').click();
        const v = viewer(page);
        await expect(v).toBeVisible();
        await expect(v.locator('#source-viewer-title')).toHaveText('Křest Jana');
        await expect(v.locator('#source-viewer-meta')).toContainText('SOA Zámrsk');
        await expect(v.locator('#source-viewer-meta')).toContainText('Original');
        await expect(v.locator('.viewer-excerpt img')).toHaveCount(1);
        await expect(v.locator('figcaption')).toHaveText('levá strana');
        // The page link wins over the book link.
        await expect(v.locator('a.viewer-open-page')).toHaveAttribute('href', 'https://archive.example/book/1/image/57');
        await expect(v.locator('.viewer-transcript')).toHaveText('Jan, syn Josefa');
        await expect(v.locator('.viewer-cites li')).toHaveText(['Jan Novak']);

        // Zoom → the fullscreen overlay; Escape closes only the overlay.
        await v.locator('.viewer-excerpt img').click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await expect(v).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(v).toBeHidden();
        await expect(modal).toBeVisible();

        // Uncite still works through ×.
        await chips.filter({ hasText: 'Bez výřezu' }).locator('.source-chip-remove').click();
        await expect(modal.locator('#person-sources-chips .source-chip')).toHaveCount(1);
    });

    test('missing parts are not rendered; a javascript: link is never a link', async ({ page }) => {
        const jan = await setup(page);
        await addCitedSource(page, jan, { title: 'Holý pramen', url: 'javascript:alert(1)' });
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-chips .source-chip-open').click();
        const v = viewer(page);
        await expect(v).toBeVisible();
        await expect(v.locator('.viewer-excerpt')).toHaveCount(0);
        await expect(v.locator('.viewer-transcript')).toHaveCount(0);
        await expect(v.locator('a.viewer-open-page')).toHaveCount(0);
        await expect(v.locator('a[href^="javascript"]')).toHaveCount(0);
        // No excerpt yet: the viewer offers to add one.
        await expect(v.getByRole('button', { name: 'Add excerpt' })).toBeVisible();
    });

    test('Edit from the viewer returns to the refreshed viewer', async ({ page }) => {
        const jan = await setup(page);
        await addCitedSource(page, jan, { title: 'Křest' });
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-chips .source-chip-open').click();
        await viewer(page).locator('#source-viewer-edit').click();
        await expect(editor(page)).toBeVisible();
        await editor(page).locator('#source-more summary').click();
        await editor(page).locator('#input-source-transcript').fill('Přepsáno');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(viewer(page)).toBeVisible();
        await expect(viewer(page).locator('.viewer-transcript')).toHaveText('Přepsáno');
    });
});

test.describe('the excerpt block in the editor', () => {
    test('a pasted image becomes the excerpt without the crop editor; text still pastes', async ({ page }) => {
        const jan = await setup(page);
        await addCitedSource(page, jan, { title: 'Křest' });
        const png = await pngBuffer(page, 2400, 400);
        await page.evaluate(() => window.Strom.UI.showEditSourceModal(Object.keys(window.Strom.DataManager.getData().sources)[0]));
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.excerpt-empty')).toBeVisible();

        await editor(page).locator('#input-source-title').focus();
        await pasteImage(page, '#input-source-title', png);
        await expect(cropper(page)).toHaveCount(0);
        const item = editor(page).locator('.excerpt-item');
        await expect(item).toHaveCount(1);
        // Pasted text is left to the field.
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Křest');

        await editor(page).getByRole('button', { name: 'Save' }).click();
        const exc = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources as Record<string, any>)[0].excerpts[0]);
        expect(exc.dataUrl.startsWith('data:image/jpeg')).toBe(true);
        expect(exc.width).toBe(1200);
        expect(exc.height).toBe(200);
    });

    test('an uploaded scan goes through the crop editor; the result is a JPEG ≤ 1200 px', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#input-source-title').fill('Sňatek');
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'page-57.png', mimeType: 'image/png', buffer: await pngBuffer(page, 3000, 2000),
        });
        await expect(cropper(page)).toBeVisible();
        await expect(cropper(page).locator('.crop-size')).toContainText('px');
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(cropper(page)).toHaveCount(0);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const exc = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources as Record<string, any>)[0].excerpts[0]);
        expect(exc.dataUrl.startsWith('data:image/jpeg')).toBe(true);
        expect(Math.max(exc.width, exc.height)).toBeLessThanOrEqual(1200);
        expect(exc.fromAttachmentId).toBeUndefined();
        expect(exc.region).toBeUndefined();
    });

    test('"also save the whole page" adds an attachment and links the excerpt to it', async ({ page }) => {
        await setup(page);
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-section').getByRole('button', { name: 'Cite a source' }).click();
        await page.locator('#source-picker-modal').getByRole('button', { name: 'New source…' }).click();
        await expect(editor(page)).toBeVisible();
        // The title is suggested from the context.
        await expect(editor(page).locator('#input-source-title')).toHaveValue('Jan Novak');
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'page-57.png', mimeType: 'image/png', buffer: await pngBuffer(page, 1600, 1000),
        });
        await cropper(page).locator('#crop-keep-page').check();
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await editor(page).getByRole('button', { name: 'Save' }).click();
        await expect(editor(page)).toBeHidden();

        const state = await page.evaluate(() => {
            const d = window.Strom.DataManager.getData();
            const person = Object.values(d.persons as Record<string, any>)[0];
            const src = Object.values(d.sources as Record<string, any>)[0];
            return { atts: person.attachments ?? [], exc: src.excerpts[0], cited: person.sourceIds };
        });
        expect(state.atts).toHaveLength(1);
        expect(state.exc.fromAttachmentId).toBe(state.atts[0].id);
        expect(state.exc.region.w).toBeGreaterThan(0);
        expect(state.cited).toHaveLength(1);

        // Crop again later: the crop editor opens on the saved page.
        await page.evaluate(() => window.Strom.UI.showEditSourceModal(Object.keys(window.Strom.DataManager.getData().sources)[0]));
        await editor(page).getByRole('button', { name: 'Crop', exact: true }).click();
        await expect(cropper(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(cropper(page)).toHaveCount(0);
        await expect(editor(page)).toBeVisible();
    });

    test('a second excerpt is fine, a third one is refused', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#input-source-title').fill('Zápis přes dvě strany');
        const png = await pngBuffer(page, 800, 200);
        await pasteImage(page, '#source-editor-modal', png);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await expect(editor(page).getByRole('button', { name: /Add continuation/ })).toBeVisible();
        await pasteImage(page, '#source-editor-modal', png);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(2);
        await expect(editor(page).getByRole('button', { name: /Add continuation/ })).toHaveCount(0);
        await pasteImage(page, '#source-editor-modal', png);
        await expect(page.locator('.toast')).toContainText('at most two excerpts');
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(2);
    });

    test('"More" folds for a new source, opens for one with a transcript; reliability toggles', async ({ page }) => {
        const jan = await setup(page);
        const id = await addCitedSource(page, jan, { title: 'S přepisem', transcript: 'Anno 1865' });
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await expect(editor(page).locator('#source-more')).not.toHaveAttribute('open', '');
        await editor(page).getByRole('button', { name: 'Cancel' }).click();

        await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), id);
        await expect(editor(page).locator('#source-more')).toHaveAttribute('open', '');
        const q = editor(page).locator('#source-quality');
        await q.getByRole('radio', { name: 'Copy / index' }).click();
        await expect(q.getByRole('radio', { name: 'Copy / index' })).toHaveAttribute('aria-checked', 'true');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        expect(await page.evaluate((id) => window.Strom.DataManager.getData().sources[id].quality, id)).toBe(2);

        await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), id);
        await q.getByRole('radio', { name: 'Copy / index' }).click();   // second click clears
        await expect(q.getByRole('radio', { name: 'Copy / index' })).toHaveAttribute('aria-checked', 'false');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        expect(await page.evaluate((id) => window.Strom.DataManager.getData().sources[id].quality, id)).toBeUndefined();
    });

    test('an excerpt alone is an unsaved change; one Save is one undo step', async ({ page }) => {
        const jan = await setup(page);
        const id = await addCitedSource(page, jan, { title: 'Křest' });
        await page.evaluate((id) => window.Strom.UI.showEditSourceModal(id), id);
        await pasteImage(page, '#source-editor-modal', await pngBuffer(page, 600, 100));
        await editor(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('#confirmation-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(editor(page)).toBeVisible();

        await editor(page).locator('#source-more summary').click();
        await editor(page).locator('#input-source-transcript').fill('Jan');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const saved = await page.evaluate((id) => window.Strom.DataManager.getData().sources[id], id);
        expect(saved.excerpts).toHaveLength(1);
        expect(saved.transcript).toBe('Jan');
        await page.evaluate(() => window.Strom.DataManager.undo());
        const undone = await page.evaluate((id) => window.Strom.DataManager.getData().sources[id], id);
        expect(undone.excerpts).toBeUndefined();
        expect(undone.transcript).toBeUndefined();
    });
});

test.describe('another entry from the same register', () => {
    test('copies archive, reference and link only; from a chip it is cited there', async ({ page }) => {
        const jan = await setup(page);
        await addCitedSource(page, jan, {
            title: 'Křest Jana', repository: 'SOA Zámrsk', reference: 'Týnec 17', url: 'https://archive.example/b/17',
            transcript: 'x', note: 'n',
        });
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-chips .source-chip-open').click();
        await viewer(page).getByRole('button', { name: 'Another entry from the same register' }).click();
        const e = editor(page);
        await expect(e).toBeVisible();
        await expect(e.locator('#input-source-title')).toHaveValue('');
        await expect(e.locator('#input-source-title')).toHaveAttribute('placeholder', 'Křest Jana');
        await expect(e.locator('#input-source-repository')).toHaveValue('SOA Zámrsk');
        await expect(e.locator('#input-source-reference')).toHaveValue('Týnec 17');
        await expect(e.locator('#input-source-url')).toHaveValue('https://archive.example/b/17');
        await expect(e.locator('#input-source-transcript')).toHaveValue('');
        await expect(e.locator('#input-source-note')).toHaveValue('');
        await e.locator('#input-source-title').fill('Křest bratra');
        await e.getByRole('button', { name: 'Save' }).click();
        await expect(modal.locator('#person-sources-chips .source-chip')).toHaveCount(2);
    });

    test('from the catalog nothing is cited', async ({ page }) => {
        const jan = await setup(page);
        const id = await addCitedSource(page, jan, { title: 'Kniha', repository: 'SOA' });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await page.locator('#sources-list .source-row-open').click();
        await expect(viewer(page)).toBeVisible();
        await viewer(page).getByRole('button', { name: 'Another entry from the same register' }).click();
        await editor(page).locator('#input-source-title').fill('Jiný zápis');
        await editor(page).getByRole('button', { name: 'Save' }).click();
        const cites = await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].sourceIds);
        expect(cites).toEqual([id]);
        expect(await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().sources).length)).toBe(2);
    });
});

test.describe('the source picker', () => {
    test('recently used on top of a big catalog; search reads transcripts', async ({ page }) => {
        const jan = await setup(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            for (let i = 0; i < 10; i++) dm.addSource({ title: `Pramen ${String(i).padStart(2, '0')}`, transcript: i === 7 ? 'kovář z Lhoty' : undefined });
        });
        // Cite one through the picker so it becomes "recent".
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-section').getByRole('button', { name: 'Cite a source' }).click();
        const picker = page.locator('#source-picker-modal');
        await picker.getByRole('button', { name: /Pramen 03/ }).click();
        await page.evaluate((jan) => window.Strom.DataManager.uncitePerson(jan, Object.values(window.Strom.DataManager.getData().sources as Record<string, any>).find(s => s.title === 'Pramen 03').id), jan);

        await modal.locator('#person-sources-section').getByRole('button', { name: 'Cite a source' }).click();
        await expect(picker.locator('.source-picker-section').first()).toHaveText('Recently used');
        await expect(picker.locator('.source-picker-item').first()).toContainText('Pramen 03');

        await picker.locator('#source-picker-search').fill('kovář');
        await expect(picker.locator('.source-picker-section')).toHaveCount(0);
        await expect(picker.locator('.source-picker-item')).toHaveCount(1);
        await expect(picker.locator('.source-picker-item')).toContainText('Pramen 07');
    });

    test('"Manage sources" opens the catalog and comes back to the picker', async ({ page }) => {
        await setup(page);
        const modal = await openPersonSources(page);
        await modal.locator('#person-sources-section').getByRole('button', { name: 'Cite a source' }).click();
        await page.locator('#source-picker-modal').getByRole('button', { name: 'Manage sources' }).click();
        await expect(page.locator('#sources-modal')).toHaveClass(/active/);
        await page.locator('#sources-modal .close-btn').click();
        await expect(page.locator('#source-picker-modal')).toHaveClass(/active/);
    });
});

test.describe('crop editor keyboard', () => {
    test('arrows move, Alt+arrows resize, Enter applies; focus returns', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#input-source-title').fill('Klávesnice');
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'p.png', mimeType: 'image/png', buffer: await pngBuffer(page, 1000, 1000),
        });
        const frame = cropper(page).locator('.crop-frame');
        await expect(frame).toBeFocused();
        const box0 = await frame.boundingBox();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
        const box1 = await frame.boundingBox();
        expect(box1!.x).toBeGreaterThan(box0!.x);
        expect(box1!.y).toBeGreaterThan(box0!.y);
        await page.keyboard.press('Alt+ArrowLeft');
        const box2 = await frame.boundingBox();
        expect(box2!.width).toBeLessThan(box1!.width);
        await page.keyboard.press('Enter');
        await expect(cropper(page)).toHaveCount(0);
        await expect(editor(page).locator('.excerpt-item')).toHaveCount(1);
        await expect(editor(page)).toBeVisible();
    });
});

test.describe('leaving images out of an import', () => {
    const excerptGed = (jpeg: string) => [
        '0 HEAD', '1 SOUR TEST', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 SOUR @S1@',
        '0 @S1@ SOUR', '1 TITL Křest', '1 TEXT Jan, syn Josefa',
        '1 OBJE', '2 _STROM_KIND excerpt', `2 FILE ${jpeg}`,
        '0 TRLR',
    ].join('\n');

    test('GEDCOM result: excerpts tile, checkbox with size; unchecked → text only', async ({ page }) => {
        await openApp(page);
        const jpeg = await jpegDataUrl(page, 200, 40);
        await page.evaluate((text) => window.Strom.UI.openGedcomText(text), excerptGed(jpeg));
        const dlg = page.locator('#gedcom-result-modal');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#gedcom-stat-excerpts')).toHaveText('1');
        await expect(dlg.locator('#gedcom-images-row')).toBeVisible();
        await expect(dlg.locator('#gedcom-images-size')).toContainText('MB');
        await dlg.locator('#gedcom-import-images').uncheck();
        await expect(dlg.locator('#gedcom-stat-excerpts-item')).toHaveClass(/muted/);
        await dlg.locator('#gedcom-new-tree-btn').click();
        await page.locator('#import-tree-modal').getByRole('button', { name: /Import/ }).last().click();
        const src = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources as Record<string, any>)[0]);
        expect(src.excerpts).toBeUndefined();
        expect(src.transcript).toBe('Jan, syn Josefa');
        // The choice was for this import only.
        expect(await page.evaluate(() => window.Strom.SettingsManager.isImportImages())).toBe(true);
    });

    test('a file without images shows no checkbox', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.openGedcomText(
            '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Karel /Bez/\n1 SEX M\n0 TRLR'));
        await expect(page.locator('#gedcom-result-modal')).toBeVisible();
        await expect(page.locator('#gedcom-images-row')).toBeHidden();
    });
});

test.describe('a research update', () => {
    const researchGed = (jpeg: string, extra = false) => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 23 SEP 2026',
        '1 _STROM_TREE 3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '1 SOUR @S0001@',
        ...(extra ? ['0 @P0002@ INDI', '1 NAME Anna /Víšková/', '1 SEX F', '1 REFN P0002'] : []),
        '0 @S0001@ SOUR', '1 TITL Křest Josefa', '1 REFN S0001',
        '1 OBJE', '2 _STROM_KIND excerpt', `2 FILE ${jpeg}`,
        '0 TRLR',
    ].join('\n');

    test('asks about images and warns that the tree\'s own excerpts are replaced', async ({ page }) => {
        await openApp(page);
        const jpeg = await jpegDataUrl(page, 200, 40);
        await page.evaluate((t) => window.Strom.UI.openGedcomText(t), researchGed(jpeg));
        await expect(page.locator('.toast')).toContainText('Opened the research');
        // The user edits the tree in the app.
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.updatePerson(dm.getAllPersons()[0].id, { firstName: 'Josef Karel' });
        });

        void page.evaluate((t) => window.Strom.UI.openGedcomText(t), researchGed(jpeg, true));
        const dlg = page.locator('#confirmation-modal');
        await expect(dlg).toBeVisible();
        await expect(dlg).toContainText('Excerpts you added to this tree will be replaced');
        const check = dlg.locator('#confirm-choice-check');
        await expect(check).toBeChecked();
        await check.uncheck();
        await dlg.getByRole('button', { name: 'Update' }).click();
        await expect(page.locator('.toast')).toContainText('Updated the research');
        const src = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().sources as Record<string, any>)[0]);
        expect(src.title).toBe('Křest Josefa');
        expect(src.excerpts).toBeUndefined();
    });
});

test.describe('layout', () => {
    test('viewer and crop editor fit a 360 px phone in German', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        const jan = await setup(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        const jpeg = await jpegDataUrl(page);
        const id = await addCitedSource(page, jan, {
            title: 'Taufe Johann', transcript: 'Johann, Sohn des Josef', excerpts: [{ id: 'e', dataUrl: jpeg, width: 600, height: 120, sizeBytes: 1 }],
        });
        await page.evaluate((id) => window.Strom.UI.showSourceViewer(id, null), id);
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await expect(viewer(page)).toBeVisible();
        expect(await overflow()).toBeLessThanOrEqual(0);
        const box = await viewer(page).locator('.modal').boundingBox();
        expect(box!.width).toBeLessThanOrEqual(360);

        await page.evaluate(() => window.Strom.UI.closeSourceViewer());
        await page.evaluate(() => window.Strom.UI.showAddSourceModal());
        await editor(page).locator('#source-excerpt-file').setInputFiles({
            name: 'p.png', mimeType: 'image/png', buffer: await pngBuffer(page, 1200, 900),
        });
        await expect(cropper(page)).toBeVisible();
        await expect(cropper(page).locator('.crop-apply-top')).toBeVisible();
        await expect(cropper(page).locator('.crop-zoom-in')).toBeHidden();
        expect(await overflow()).toBeLessThanOrEqual(0);
    });
});
