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
