import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { openApp, card } from './helpers.js';

/**
 * Give a family tree to each person… (spec 093 §7 [53, 54], §8 [58, 60]):
 * a list of the sample tree's people opened from Lists of people; a couple of
 * the list is one package, a person alone in the tree gets none; one person's
 * own settings change only their package; "Create packages" makes
 * "Family trees 2026.zip" with a finished ZIP for each package. A package
 * that fails is a warning row and the rest are made; Cancel all leaves nothing.
 */

const TODAY = new Date('2026-12-10T10:00:00');

/** The entries of a ZIP (stored or deflated), by path. */
function readZip(buf: Buffer): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('not a ZIP');
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(at + 10);
        const csize = buf.readUInt32LE(at + 20);
        const nameLen = buf.readUInt16LE(at + 28);
        const extraLen = buf.readUInt16LE(at + 30);
        const commentLen = buf.readUInt16LE(at + 32);
        const local = buf.readUInt32LE(at + 42);
        const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
        const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(dataAt, dataAt + csize);
        out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
        at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

/** The sample tree and a list "Christmas": Daniel, Julia (his wife), Emma and a person alone in the tree. */
async function sampleWithList(page: Page): Promise<string> {
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    const listId = await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
        const lone = window.Strom.DataManager.createPerson({ firstName: 'Ingvar', lastName: 'Sandmark', gender: 'male', birthDate: '1931' });
        const l = window.Strom.DataManager.createPersonList({ name: 'Christmas', dynamic: false, personIds: ['demo_daniel', 'demo_julia', 'demo_emma', lone.id] as never });
        return l!.id;
    });
    await expect(card(page, 'Daniel')).toBeVisible();
    return listId;
}

/** Lists of people › ⋯ › Give a family tree to each person… */
async function openFromList(page: Page, listId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showPersonLists({ listId: id }), listId);
    const lists = page.locator('#person-lists-modal');
    await lists.locator('.pl-more').click();
    await lists.locator('.pl-menu .pl-menu-item', { hasText: 'Give a family tree to each person…' }).click();
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

const row = (dialog: Locator, name: string): Locator => dialog.locator('.gift-rcp-r', { has: dialog.page().locator('.gift-rcp-name', { hasText: name }) });

test('a list: couples as one package, one person\'s own settings, Family trees 2026.zip with a ZIP for each', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const listId = await sampleWithList(page);
    const dialog = await openFromList(page, listId);

    // Step 1: the list, couples joined, the table.
    await expect(page.locator('#person-lists-modal.active')).toHaveCount(0);
    await expect(dialog.locator('[data-gk="mode-list"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-gk="batch-source"]')).toHaveValue(`list:${listId}`);
    await expect(dialog.locator('.gift-rcp-r')).toHaveCount(3);
    await expect(dialog.locator('.gift-rcp-head .gift-h3')).toHaveText('Recipients · 2 packages (3 people, 1 couple)');
    await expect(row(dialog, 'Daniel Berg and Julia Novak').locator('.gift-rcp-s')).toHaveText('couple');
    await expect(row(dialog, 'Ingvar Sandmark')).toHaveClass(/is-lone/);
    await expect(dialog.locator('.gift-sum-name')).toHaveText('Christmas');

    await dialog.locator('[data-gk="batch-pairs"]').uncheck();
    await expect(dialog.locator('.gift-rcp-r')).toHaveCount(4);
    await expect(dialog.locator('.gift-rcp-head .gift-h3')).toHaveText('Recipients · 3 packages (3 people)');
    await dialog.locator('[data-gk="batch-pairs"]').check();
    await expect(dialog.locator('.gift-rcp-r')).toHaveCount(3);

    // Emma's salutation in her row; her own settings: no book.
    await row(dialog, 'Emma Holm').locator('.gift-rcp-sal').fill('Dear Grandma Emma');
    await row(dialog, 'Emma Holm').locator('.gift-rcp-edit').click();
    await expect(dialog.locator('#gift-title')).toHaveText('Give a family tree · Emma Holm');
    await expect(dialog.locator('#gift-sub')).toContainText('own settings');
    await expect(dialog.locator('.gift-own-line')).toContainText('Changes only for Emma Holm');
    await expect(dialog.locator('#gift-nav [data-step="1"]')).toHaveAttribute('aria-disabled', 'true');
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await dialog.locator('[data-gk="part-book"]').uncheck();
    await expect(dialog.locator('.gift-sum-own')).toHaveText('own: the contents');
    await dialog.locator('#gift-back').click();
    await expect(dialog.locator('#gift-title')).toHaveText('Give a family tree');
    await expect(row(dialog, 'Emma Holm')).toHaveClass(/is-own/);
    await expect(row(dialog, 'Emma Holm').locator('.gift-rcp-tag')).toHaveText('own');
    await expect(row(dialog, 'Daniel Berg and Julia Novak').locator('.gift-rcp-tag')).toHaveText('common');
    await expect(row(dialog, 'Emma Holm').locator('.gift-rcp-sal')).toHaveValue('Dear Grandma Emma');

    // Common: without the app (a smaller run).
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await expect(dialog.locator('.gift-own-line')).toHaveCount(0);
    await dialog.locator('[data-gk="part-app"]').uncheck();

    // Step 5: the salutation is each row's; the preview goes through the recipients.
    await dialog.locator('#gift-nav [data-step="5"]').click();
    await expect(dialog.locator('.gift-sal-note')).toBeVisible();
    await expect(dialog.locator('[data-gk="letter-salutation"]')).toHaveCount(0);
    await expect(dialog.locator('.gift-switch-name')).toHaveText('Daniel Berg and Julia Novak');
    await dialog.locator('[data-gk="preview-next"]').click();
    await expect(dialog.locator('.gift-switch-name')).toHaveText('Emma Holm');

    // Step 6 and the making.
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('[data-gk="file-name"]')).toHaveValue('Family trees 2026.zip');
    await expect(dialog.locator('#gift-next')).toHaveText('Create packages');
    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('#gift-next').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('Family trees 2026.zip');
    await expect(dialog.locator('.gift-run-h')).toHaveText('The family trees are ready');
    await expect(dialog.locator('.gift-done-size')).toContainText('2 packages');

    const outer = readZip(readFileSync((await download.path())!));
    expect([...outer.keys()].sort()).toEqual(['Family tree – Daniel Berg and Julia Novak – 2026.zip', 'Family tree – Emma Holm – 2026.zip']);
    const couple = readZip(outer.get('Family tree – Daniel Berg and Julia Novak – 2026.zip')!);
    const emma = readZip(outer.get('Family tree – Emma Holm – 2026.zip')!);
    const has = (zip: Map<string, Buffer>, file: string) => [...zip.keys()].some(k => k.endsWith(`/${file}`));
    expect(has(couple, 'Family book.html')).toBe(true);
    expect(has(emma, 'Family book.html')).toBe(false);
    expect(has(couple, 'Family tree (app).html')).toBe(false);
    const start = [...emma.entries()].find(([k]) => k.endsWith('/Start here.html'))![1].toString('utf8');
    expect(start).toContain('Dear Grandma Emma');

    // The settings stay with each person: Emma's guide starts from them.
    await dialog.locator('[data-gk="run-finish"]').click();
    await expect(dialog).not.toHaveClass(/active/);
    await page.evaluate(() => window.Strom.UI.showGiftTree({ personId: 'demo_emma' as never }));
    await expect(dialog.locator('.gift-last')).toBeVisible();
});

test('a package that fails is a warning row and the others are made; Cancel all leaves nothing', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const listId = await sampleWithList(page);
    // The app's file: the first package runs out of memory, the others get a small page.
    await page.evaluate(() => {
        let calls = 0;
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: () => Promise<Blob> };
        exporter.buildFocusAppBlob = async () => {
            calls++;
            if (calls === 1) throw new RangeError('Array buffer allocation failed');
            return new Blob(['<!doctype html><title>app</title>'], { type: 'text/html' });
        };
    });
    let dialog = await openFromList(page, listId);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('#gift-next').click();
    const download = await downloaded;
    await expect(dialog.locator('.gift-run-h')).toHaveText('The family trees are ready');
    await expect(dialog.locator('.gift-batch-fail')).toHaveText('1 package was not created (Daniel Berg and Julia Novak: out of memory)');
    await expect(dialog.locator('.gift-stp.is-warn')).toHaveCount(1);
    await expect(dialog.locator('.gift-stp.is-done')).toHaveCount(1);
    const outer = readZip(readFileSync((await download.path())!));
    expect([...outer.keys()]).toEqual(['Family tree – Emma Holm – 2026.zip']);
    await dialog.locator('[data-gk="run-finish"]').click();

    // Cancel all while making: Cancelled, nothing downloaded.
    await page.evaluate(() => {
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: () => Promise<Blob> };
        exporter.buildFocusAppBlob = () => new Promise(resolve => setTimeout(() => resolve(new Blob(['x'], { type: 'text/html' })), 1500));
    });
    let downloads = 0;
    page.on('download', () => { downloads++; });
    dialog = await openFromList(page, listId);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await dialog.locator('#gift-next').click();
    await expect(dialog.locator('.gift-run-h')).toHaveText('Creating family trees · Christmas');
    await expect(dialog.locator('.prog-t')).toContainText('Person 1 of 2');
    await dialog.locator('[data-gk="run-cancel"]').click();
    await expect(dialog.locator('.gift-run-h')).toHaveText('Cancelled');
    await expect(dialog.locator('[data-gk="run-again"]')).toBeVisible();
    expect(downloads).toBe(0);
});

test('Save to folder… (Chrome, Edge): each package written into the chosen folder, no archive downloaded', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const listId = await sampleWithList(page);
    // A folder the page may write into (the browser's own picker stands in).
    await page.evaluate(() => {
        const files: Record<string, number> = {};
        (window as unknown as { __giftFolder: Record<string, number> }).__giftFolder = files;
        const dir = {
            name: 'Gifts',
            getFileHandle: async (name: string) => ({
                createWritable: async () => ({
                    write: async (blob: Blob) => { files[name] = blob.size; },
                    close: async () => undefined,
                }),
            }),
            removeEntry: async (name: string) => { delete files[name]; },
        };
        (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => dir;
    });
    let downloads = 0;
    page.on('download', () => { downloads++; });
    const dialog = await openFromList(page, listId);
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await dialog.locator('[data-gk="part-app"]').uncheck();
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await dialog.locator('[data-gk="save-folder"]').click();
    await expect(dialog.locator('.gift-run-h')).toHaveText('The family trees are ready');
    await expect(dialog.locator('.gift-done-file')).toContainText('in the folder Gifts');
    await expect(dialog.locator('.gift-done-size')).toContainText('2 packages');
    const written = await page.evaluate(() => Object.keys((window as unknown as { __giftFolder: Record<string, number> }).__giftFolder).sort());
    expect(written).toEqual(['Family tree – Daniel Berg and Julia Novak – 2026.zip', 'Family tree – Emma Holm – 2026.zip']);
    expect(downloads).toBe(0);
});
