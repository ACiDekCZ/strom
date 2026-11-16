/**
 * A portrait edited later and its original (spec 107 §2, §4, §10): "Edit
 * crop" in the person dialog over the attachment the portrait names, or
 * within the finished square with "Choose the photo again…" when there is no
 * original; "Edit portrait crop" in the person page's ⋯ writing at once with
 * Undo; the attachment's Portrait tag, "As portrait…" and deleting the
 * source; the zoom's Portrait | Whole photo; nothing to edit where the person
 * cannot be changed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction, personModal, seedTree } from './helpers.js';
import { fakeBridge, fakeMaterial, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE } from './research-bridge.js';

const editor = (page: Page) => page.locator('.pe-overlay');
const pct = (page: Page) => editor(page).locator('.pe-pct');
const ppWin = (page: Page) => page.locator('#person-page-modal');

/** A PNG of four coloured quarters with a diagonal, so every crop shows. */
async function quartersPng(page: Page, w: number, h: number): Promise<Buffer> {
    const b64 = await page.evaluate(([w, h]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d')!;
        const fill = (col: string, l: number, t: number) => { x.fillStyle = col; x.fillRect(l, t, w / 2, h / 2); };
        fill('#c0392b', 0, 0);
        fill('#2980b9', w / 2, 0);
        fill('#27ae60', 0, h / 2);
        fill('#f1c40f', w / 2, h / 2);
        x.strokeStyle = '#000';
        x.lineWidth = Math.max(4, w / 100);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.stroke();
        return c.toDataURL('image/png').split(',')[1];
    }, [w, h]);
    return Buffer.from(b64, 'base64');
}

/** The same quarters as JPEG data URLs: the 900 × 600 original and a 256 px portrait cut from its centre. */
async function images(page: Page): Promise<{ original: string; portrait: string }> {
    return page.evaluate(() => {
        const draw = (w: number, h: number, sx: number, sw: number, out: number) => {
            const src = document.createElement('canvas');
            src.width = w; src.height = h;
            const x = src.getContext('2d')!;
            const fill = (col: string, l: number, t: number) => { x.fillStyle = col; x.fillRect(l, t, w / 2, h / 2); };
            fill('#c0392b', 0, 0); fill('#2980b9', w / 2, 0); fill('#27ae60', 0, h / 2); fill('#f1c40f', w / 2, h / 2);
            if (!out) return src.toDataURL('image/jpeg', 0.8);
            const c = document.createElement('canvas');
            c.width = out; c.height = out;
            c.getContext('2d')!.drawImage(src, sx, 0, sw, h, 0, 0, out, out);
            return c.toDataURL('image/jpeg', 0.8);
        };
        return { original: draw(900, 600, 0, 0, 0), portrait: draw(900, 600, 150, 600, 256) };
    });
}

/**
 * Zbyhoslav with a portrait: `source` — cut from his attachment "svatba.jpg"
 * (the centred square), else a portrait with no original; `noPhoto` — none.
 */
async function seedZbyhoslav(page: Page, kind: 'source' | 'plain' | 'noPhoto', extra: Record<string, unknown> = {}): Promise<{ original: string; portrait: string }> {
    await openApp(page);
    const img = await images(page);
    const att = { id: 'att_svatba', name: 'svatba.jpg', mimeType: 'image/jpeg', dataUrl: img.original, sizeBytes: 20000 };
    await seedTree(page, {
        zb: {
            firstName: 'Zbyhoslav', lastName: 'Brumlik', birthDate: '1931',
            ...(kind === 'noPhoto' ? {} : { photo: img.portrait }),
            attachments: [att],
            ...(kind === 'source' ? { photoSource: { attachmentId: att.id, region: { x: 150 / 900, y: 0, w: 600 / 900, h: 1 } } } : {}),
            ...extra,
        },
    });
    return img;
}

const stored = (page: Page) => page.evaluate(() => {
    const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Zbyhoslav')!;
    return { photo: p.photo, source: p.photoSource, attachments: p.attachments ?? [] };
});

async function openDialog(page: Page): Promise<void> {
    await cardAction(page, 'Zbyhoslav', 'edit');
    await expect(personModal(page)).toBeVisible();
}

test.describe('Edit crop later (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the dialog: Edit crop opens over the attachment the portrait names, at its crop; Save keeps the attachment and the new crop', async ({ page }) => {
        await seedZbyhoslav(page, 'source');
        await openDialog(page);
        const actions = personModal(page).locator('.photo-actions button:visible');
        await expect(actions).toHaveText(['Choose photo', 'Edit crop', 'Remove']);
        await personModal(page).locator('#photo-recrop-btn').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-frame')).toBeFocused();
        // The original is there: no note about the finished square, no Current → New.
        await expect(editor(page).locator('.pe-note-original')).toHaveCount(0);
        await expect(editor(page).locator('.pe-note-replace')).toHaveCount(0);
        await expect(pct(page)).toHaveText('100 %');
        await page.keyboard.press('+');
        await expect(pct(page)).toHaveText('110 %');
        const before = (await stored(page)).photo;
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        const preview = await personModal(page).locator('#photo-preview img').getAttribute('src');
        expect(preview).not.toBe(before);
        // Nothing is written before Save.
        expect((await stored(page)).photo).toBe(before);
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        await expect(personModal(page)).toBeHidden();
        const s = await stored(page);
        expect(s.photo).toBe(preview);
        expect(s.attachments).toHaveLength(1);
        expect(s.source).toMatchObject({ attachmentId: 'att_svatba' });
        expect(s.source!.region.w * 900).toBeCloseTo(600 / 1.1, 0);
    });

    test('the dialog: a portrait without its original edits within the square; Choose the photo again… opens the file picker and the new file keeps its original', async ({ page }) => {
        await seedZbyhoslav(page, 'plain');
        await openDialog(page);
        await personModal(page).locator('#photo-recrop-btn').click();
        await expect(editor(page)).toBeVisible();
        const note = editor(page).locator('.pe-note-original');
        await expect(note).toContainText('The whole photo is not stored; the crop can only get smaller.');
        // squareOnly: zoom never under 100 %.
        await page.keyboard.press('-');
        await expect(pct(page)).toHaveText('100 %');
        await page.keyboard.press('+');
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        let s = await stored(page);
        expect(s.source).toBeUndefined();
        expect(s.attachments).toHaveLength(1);

        await openDialog(page);
        await personModal(page).locator('#photo-recrop-btn').click();
        const chooser = page.waitForEvent('filechooser');
        await editor(page).getByRole('button', { name: 'Choose the photo again…' }).click();
        await expect(editor(page)).toHaveCount(0);
        await (await chooser).setFiles({ name: 'novy.png', mimeType: 'image/png', buffer: await quartersPng(page, 900, 600) });
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-note-original')).toHaveCount(0);
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        s = await stored(page);
        expect(s.attachments.map(a => a.name)).toEqual(['svatba.jpg', 'novy.png']);
        expect(s.source).toMatchObject({ attachmentId: s.attachments[1].id });
    });

    test('the dialog: no portrait, no Edit crop', async ({ page }) => {
        await seedZbyhoslav(page, 'noPhoto');
        await openDialog(page);
        await expect(personModal(page).locator('#photo-recrop-btn')).toBeHidden();
        await expect(personModal(page).locator('#photo-remove-btn')).toBeHidden();
    });

    test('the person page: ⋯ Edit portrait crop writes at once, the page shows it, Undo brings the portrait back', async ({ page }) => {
        const img = await seedZbyhoslav(page, 'source');
        await page.evaluate(() => window.Strom.UI.showPersonPage('zb' as never));
        const w = ppWin(page);
        await expect(w).toBeVisible();
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Edit person', 'Edit portrait crop', 'Focus in tree']);
        await w.locator('[data-pp-menu="crop"]').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-note-original')).toHaveCount(0);
        await page.keyboard.press('+');
        await page.keyboard.press('Enter');
        await expect(editor(page)).toHaveCount(0);
        const toast = page.locator('.undo-toast');
        await expect(toast).toContainText('Portrait updated.');
        const s = await stored(page);
        expect(s.photo).not.toBe(img.portrait);
        expect(s.source).toMatchObject({ attachmentId: 'att_svatba' });
        expect(s.source!.region.w * 900).toBeCloseTo(600 / 1.1, 0);
        // The page redraws with the new portrait.
        await expect(w.locator('.pp-portrait img')).toHaveAttribute('src', s.photo!);
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await stored(page)).photo).toBe(img.portrait);
        expect((await stored(page)).source!.region.w * 900).toBeCloseTo(600, 0);
    });

    test('the person page: no portrait or a locked person, no Edit portrait crop', async ({ page }) => {
        await seedZbyhoslav(page, 'noPhoto');
        await page.evaluate(() => window.Strom.UI.showPersonPage('zb' as never));
        const w = ppWin(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Edit person', 'Focus in tree']);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);
        await page.evaluate(() => window.Strom.DataManager.updatePerson('zb' as never, { isLocked: true }));
        await page.evaluate(() => window.Strom.UI.showPersonPage('zb' as never));
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Focus in tree']);
    });

    test('the person page without the original: within the square; Choose the photo again… then Done writes the new portrait with its original', async ({ page }) => {
        await seedZbyhoslav(page, 'plain');
        await page.evaluate(() => window.Strom.UI.showPersonPage('zb' as never));
        const w = ppWin(page);
        await w.locator('.pp-more').click();
        await w.locator('[data-pp-menu="crop"]').click();
        await expect(editor(page).locator('.pe-note-original')).toBeVisible();
        const chooser = page.waitForEvent('filechooser');
        await editor(page).getByRole('button', { name: 'Choose the photo again…' }).click();
        await (await chooser).setFiles({ name: 'novy.png', mimeType: 'image/png', buffer: await quartersPng(page, 900, 600) });
        await expect(editor(page)).toBeVisible();
        // A new photo for a person with a portrait: Current → New, then "replaced".
        await expect(editor(page).locator('.pe-note-replace')).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(page.locator('.undo-toast')).toContainText('Portrait of Zbyhoslav Brumlik replaced.');
        const s = await stored(page);
        expect(s.attachments.map(a => a.name)).toEqual(['svatba.jpg', 'novy.png']);
        expect(s.source).toMatchObject({ attachmentId: s.attachments[1].id });
    });
});

/** A second picture for Zbyhoslav (no portrait comes from it). */
async function addSecondPicture(page: Page, original: string): Promise<void> {
    await page.evaluate((dataUrl) => {
        window.Strom.DataManager.addAttachment('zb' as never, { name: 'louka.jpg', mimeType: 'image/jpeg', dataUrl, sizeBytes: 20000 });
    }, original);
}

const attRow = (page: Page, name: string) => personModal(page).locator('#attachments-list .attachment-row', { hasText: name });

test.describe('The portrait\'s source among the attachments (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Portrait tag on the source, As portrait… on another picture; a portrait removed in the dialog takes the tag away', async ({ page }) => {
        const img = await seedZbyhoslav(page, 'source');
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await addSecondPicture(page, img.original);
        await openDialog(page);
        const tag = attRow(page, 'svatba.jpg').locator('.attachment-tag');
        await expect(tag).toHaveText('Portrait');
        await expect(tag).toHaveAttribute('title', 'The person’s portrait is cut from this photo.');
        await expect(attRow(page, 'svatba.jpg').locator('.attachment-portrait-btn')).toHaveCount(0);
        await expect(attRow(page, 'louka.jpg').locator('.attachment-tag')).toHaveCount(0);
        const btn = attRow(page, 'louka.jpg').locator('.attachment-portrait-btn');
        await expect(btn).toHaveText('As portrait…');
        const box = (await btn.boundingBox())!;
        expect(Math.round(box.height)).toBe(30);
        // Before the trash.
        await expect(attRow(page, 'louka.jpg').locator('.attachment-actions button')).toHaveClass([/attachment-portrait-btn/, /attachment-delete-btn/]);
        await personModal(page).locator('#photo-remove-btn').click();
        await expect(personModal(page).locator('#attachments-list .attachment-tag')).toHaveCount(0);
        await expect(attRow(page, 'svatba.jpg').locator('.attachment-portrait-btn')).toBeVisible();
    });

    test('As portrait… in the dialog: Current → New over the attachment, the tag moves on Done, Save names it without a new attachment', async ({ page }) => {
        const img = await seedZbyhoslav(page, 'source');
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await addSecondPicture(page, img.original);
        await openDialog(page);
        await attRow(page, 'louka.jpg').locator('.attachment-portrait-btn').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-note-replace')).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(editor(page)).toHaveCount(0);
        await expect(attRow(page, 'louka.jpg').locator('.attachment-tag')).toHaveText('Portrait');
        await expect(attRow(page, 'svatba.jpg').locator('.attachment-tag')).toHaveCount(0);
        // Nothing written before Save.
        expect((await stored(page)).source).toMatchObject({ attachmentId: 'att_svatba' });
        await personModal(page).getByRole('button', { name: 'Save' }).click();
        await expect(personModal(page)).toBeHidden();
        const s = await stored(page);
        expect(s.attachments).toHaveLength(2);
        expect(s.source).toMatchObject({ attachmentId: s.attachments[1].id });
        expect(s.photo).not.toBe(img.portrait);
    });

    test('deleting the source: the confirmation says the portrait stays; it stays without its source and is then edited within its square', async ({ page }) => {
        const img = await seedZbyhoslav(page, 'source');
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await addSecondPicture(page, img.original);
        await openDialog(page);
        // Another attachment: no note.
        await attRow(page, 'louka.jpg').locator('.attachment-delete-btn').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm).not.toContainText('portrait’s source');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await attRow(page, 'svatba.jpg').locator('.attachment-delete-btn').click();
        await expect(confirm).toContainText('This is the portrait’s source. The portrait stays; its crop can then only change within the finished square.');
        await confirm.locator('#confirm-ok-btn').click();
        await expect(attRow(page, 'svatba.jpg')).toHaveCount(0);
        const s = await stored(page);
        expect(s.photo).toBe(img.portrait);
        expect(s.source).toBeUndefined();
        await personModal(page).locator('#photo-recrop-btn').click();
        await expect(editor(page).locator('.pe-note-original')).toBeVisible();
    });

    test('a locked person: no As portrait…, no Edit crop', async ({ page }) => {
        const img = await seedZbyhoslav(page, 'source', { isLocked: true });
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await page.evaluate((dataUrl) => {
            const p = window.Strom.DataManager.getPerson('zb' as never)!;
            p.attachments!.push({ id: 'att_louka', name: 'louka.jpg', mimeType: 'image/jpeg', dataUrl, sizeBytes: 20000 });
        }, img.original);
        // A locked person's dialog (read-only; the card menu offers no Edit).
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal('zb');
        });
        await expect(personModal(page)).toBeVisible();
        await expect(attRow(page, 'svatba.jpg').locator('.attachment-tag')).toHaveText('Portrait');
        await expect(personModal(page).locator('.attachment-portrait-btn')).toHaveCount(0);
        await expect(personModal(page).locator('#photo-recrop-btn')).not.toBeEnabled();
    });
});

test.describe('Use as portrait… in the materials (desktop)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    const ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true, tasks: 'open' } };

    /** Jan of the research with a portrait and two pictures of the tree, the first its source. */
    async function setup(page: Page): Promise<{ original: string; portrait: string; janId: string }> {
        const material = fakeMaterial({ files: [], batches: [], people: { P0003: 'Jan Fíšek' } });
        await fakeBridge(page, { accepts: ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed() });
        await openResearch(page, { media: true });
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        }, { uuid: UUID, base: BRIDGE, accepts: ACCEPTS });
        const img = await images(page);
        const janId = await page.evaluate((img) => {
            const DM = window.Strom.DataManager;
            const jan = Object.values(DM.getData().persons).find(p => p.firstName === 'Jan')!;
            const a = DM.addAttachment(jan.id, { name: 'svatba.jpg', mimeType: 'image/jpeg', dataUrl: img.original, sizeBytes: 20000 })!;
            DM.addAttachment(jan.id, { name: 'louka.jpg', mimeType: 'image/jpeg', dataUrl: img.original, sizeBytes: 20000 });
            DM.updatePerson(jan.id, { photo: img.portrait, photoSource: { attachmentId: a.id, region: { x: 150 / 900, y: 0, w: 600 / 900, h: 1 } } });
            return jan.id as string;
        }, img);
        await poll(page);
        return { ...img, janId };
    }

    const janStored = (page: Page, id: string) => page.evaluate((id) => {
        const p = window.Strom.DataManager.getPerson(id as never)!;
        return { photo: p.photo, source: p.photoSource, names: (p.attachments ?? []).map(a => [a.id, a.name]) };
    }, id);

    test('the person\'s materials: the tag on the source, Use as portrait… in another picture\'s ⋯, waiting for Save', async ({ page }) => {
        const { janId } = await setup(page);
        await page.evaluate((id) => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal(id);
        }, janId);
        const section = page.locator('#materials-section');
        const row = (name: string) => section.locator('.material-row:not(.is-skeleton)', { hasText: name });
        await expect(row('svatba.jpg').locator('.material-portrait-tag')).toHaveText('Portrait');
        await expect(row('louka.jpg').locator('.material-portrait-tag')).toHaveCount(0);
        await row('svatba.jpg').locator('.material-more').click();
        await expect(page.locator('#materials-item-menu [data-action="useAsPortrait"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await row('louka.jpg').locator('.material-more').click();
        const items = page.locator('#materials-item-menu [data-action]');
        await expect(items).toHaveText(['Open', 'Download', 'Use as portrait…', 'Delete from the tree…']);
        await page.locator('#materials-item-menu [data-action="useAsPortrait"]').click();
        await expect(editor(page)).toBeVisible();
        await expect(editor(page).locator('.pe-note-replace')).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        await expect(row('louka.jpg').locator('.material-portrait-tag')).toHaveText('Portrait');
        await page.locator('#person-modal').getByRole('button', { name: 'Save' }).click();
        const s = await janStored(page, janId);
        expect(s.names.map(n => n[1])).toEqual(['svatba.jpg', 'louka.jpg']);
        expect(s.source).toMatchObject({ attachmentId: s.names[1][0] });
    });

    test('the viewer: the tag in the panel, Use as portrait… between Download and Delete writes at once with Undo', async ({ page }) => {
        const img = await setup(page);
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        const win = page.locator('#materials-modal');
        await expect(win).toBeVisible();
        const panel = page.locator('#image-viewer-panel');
        await win.locator('.mw-canvas .mw-tile', { hasText: 'svatba.jpg' }).click();
        await expect(panel.locator('.mv-portrait-tag')).toHaveText('Portrait');
        await expect(panel.locator('.mv-act[data-action="useAsPortrait"]')).toHaveCount(0);
        await page.keyboard.press('ArrowRight');
        await expect(panel.locator('.mv-title')).toHaveText(/louka/);
        await expect(panel.locator('.mv-portrait-tag')).toHaveCount(0);
        await expect(panel.locator('.mv-act')).toHaveText(['Download', 'Use as portrait…', 'Delete from the tree…']);
        await panel.locator('.mv-act[data-action="useAsPortrait"]').click();
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await expect(editor(page)).toBeVisible();
        await editor(page).getByRole('button', { name: 'Done' }).click();
        // (The setup's own edits keep a toast of theirs.)
        const toast = page.locator('.undo-toast', { hasText: 'Portrait of Jan Fíšek replaced.' });
        await expect(toast).toBeVisible();
        let s = await janStored(page, img.janId);
        expect(s.source).toMatchObject({ attachmentId: s.names[1][0] });
        expect(s.names).toHaveLength(2);
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await janStored(page, img.janId)).photo).toBe(img.portrait);
        s = await janStored(page, img.janId);
        expect(s.source).toMatchObject({ attachmentId: s.names[0][0] });
    });
});
