import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';

/**
 * Images through GEDCOM, the way a user does it: a tree with a portrait, a
 * register scan attached to the person and an excerpt cropped from it on the
 * cited source → Export → GEDCOM (all data) → import the downloaded file as a
 * new tree. Every image must come back byte for byte, with its links.
 */

interface Images { photo: string; scan: string; excerpt: string }

/** Real, decodable images drawn on a canvas (JPEG like the app stores them). */
async function makeImages(page: Page): Promise<Images> {
    return page.evaluate(() => {
        const draw = (w: number, h: number, type: string, label: string): string => {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d')!;
            const grad = g.createLinearGradient(0, 0, w, h);
            grad.addColorStop(0, '#3f6b4f'); grad.addColorStop(1, '#d0a23c');
            g.fillStyle = grad; g.fillRect(0, 0, w, h);
            g.fillStyle = '#fff'; g.font = `${Math.round(h / 4)}px serif`;
            g.fillText(label, 10, h / 2);
            return c.toDataURL(type, 0.85);
        };
        return {
            photo: draw(160, 200, 'image/jpeg', 'Jan'),
            scan: draw(900, 1200, 'image/jpeg', 'Matrika fol. 12'),
            excerpt: draw(1200, 240, 'image/jpeg', 'Křest 1850'),
        };
    });
}

function bytesOf(dataUrl: string): number {
    return Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
}

/** The comprehensive fixture with images on its first person and a cited source. */
function treeWithImages(img: Images): { json: string; first: string; last: string } {
    const data = JSON.parse(readFileSync('test/comprehensive.json', 'utf-8'));
    data.version = 7;
    const person = Object.values(data.persons)[0] as Record<string, unknown>;
    person.photo = img.photo;
    person.photoOriginalName = 'jan.jpg';
    person.sourceIds = ['src1'];
    person.attachments = [{
        id: 'att1', name: 'matrika-fol12.jpg', mimeType: 'image/jpeg',
        dataUrl: img.scan, sizeBytes: bytesOf(img.scan), note: 'Kniha narozených 12', sourceId: 'src1',
    }];
    data.sources = {
        src1: {
            id: 'src1', title: 'Křest Jana 1850', reference: 'fol. 12', transcript: 'Johann, ehelicher Sohn',
            excerpts: [{
                id: 'exc1', dataUrl: img.excerpt, width: 1200, height: 240, sizeBytes: bytesOf(img.excerpt),
                fromAttachmentId: 'att1', region: { x: 0.1, y: 0.4, w: 0.8, h: 0.15 },
            }],
        },
    };
    return { json: JSON.stringify(data), first: person.firstName as string, last: person.lastName as string };
}

async function importJson(page: Page, json: string, name: string): Promise<void> {
    await page.locator('#file-input').setInputFiles({ name: 'images.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

async function exportGedcom(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeGedcom());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    // Photos, attachments and sources are on by default — the user's default path.
    for (const id of ['#export-content-photos', '#export-content-attachments', '#export-content-sources']) {
        await expect(pwd.locator(id)).toBeChecked();
    }
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    return download.path();
}

async function importGedcom(page: Page, gedPath: string, name: string, withImages: boolean): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(gedPath);
    const result = page.locator('#gedcom-result-modal');
    await expect(result).toBeVisible();
    const images = result.locator('#gedcom-import-images');
    if ((await images.isChecked()) !== withImages) await images.setChecked(withImages);
    await result.locator('#gedcom-new-tree-btn').click();
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

/** The imported person (by name) with the images the open tree holds for it. */
async function readBack(page: Page, first: string, last: string) {
    return page.evaluate(([f, l]) => {
        const data = window.Strom.DataManager.getData();
        const p = Object.values(data.persons).find(x => x.firstName === f && x.lastName === l)!;
        const sources = Object.values(data.sources ?? {});
        const src = sources.find(s => (p.sourceIds ?? []).includes(s.id));
        return {
            photo: p.photo ?? null,
            photoName: p.photoOriginalName ?? null,
            attachments: (p.attachments ?? []).map(a => ({
                name: a.name, mimeType: a.mimeType, dataUrl: a.dataUrl, note: a.note ?? null,
                linkedToSource: !!src && a.sourceId === src.id,
            })),
            source: src ? {
                title: src.title, reference: src.reference ?? null, transcript: src.transcript ?? null,
                excerpts: (src.excerpts ?? []).map(e => ({ dataUrl: e.dataUrl, width: e.width, height: e.height })),
            } : null,
        };
    }, [first, last] as const);
}

test('GEDCOM export carries the images and a re-import brings them back', async ({ page }) => {
    await openApp(page);
    const img = await makeImages(page);
    const tree = treeWithImages(img);
    await importJson(page, tree.json, 'With images');

    const gedPath = await exportGedcom(page);
    const ged = readFileSync(gedPath, 'utf-8');
    // All three images travel whole inside the file (long lines continue with CONC).
    const joined = ged.replace(/\r?\n\d+ CONC /g, '');
    expect(ged).toContain('_STROM_KIND excerpt');
    for (const url of [img.photo, img.scan, img.excerpt]) expect(joined).toContain(url);
    for (const line of ged.split('\n')) expect(line.length).toBeLessThanOrEqual(255);

    await importGedcom(page, gedPath, 'Back from GEDCOM', true);
    const back = await readBack(page, tree.first, tree.last);
    expect(back.photo).toBe(img.photo);
    expect(back.photoName).toBe('jan.jpg');
    expect(back.attachments).toEqual([{
        name: 'matrika-fol12.jpg', mimeType: 'image/jpeg', dataUrl: img.scan, note: 'Kniha narozených 12', linkedToSource: true,
    }]);
    expect(back.source).toEqual({
        title: 'Křest Jana 1850', reference: 'fol. 12', transcript: 'Johann, ehelicher Sohn',
        excerpts: [{ dataUrl: img.excerpt, width: 1200, height: 240 }],
    });

    // And the images actually show: the portrait on the card decodes.
    const decoded = await page.evaluate(async (src) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        return im.naturalWidth;
    }, back.photo!);
    expect(decoded).toBe(160);
});

test('importing the same GEDCOM without images keeps the data, leaves the images out', async ({ page }) => {
    await openApp(page);
    const img = await makeImages(page);
    const tree = treeWithImages(img);
    await importJson(page, tree.json, 'With images');
    const gedPath = await exportGedcom(page);

    await importGedcom(page, gedPath, 'Without images', false);
    const back = await readBack(page, tree.first, tree.last);
    expect(back.photo).toBeNull();
    expect(back.attachments).toEqual([]);
    expect(back.source?.title).toBe('Křest Jana 1850');
    expect(back.source?.transcript).toBe('Johann, ehelicher Sohn');
    expect(back.source?.excerpts).toEqual([]);
});
