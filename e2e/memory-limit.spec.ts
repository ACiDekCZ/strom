import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The warnings before the app runs out of memory (spec 135, D9b). A low
 * stand-in limit (window.Strom.MemoryLimit.setLimit) makes them due; with
 * the browser's own limit nothing is asked.
 */

const LOW_LIMIT = 30 * 1024 * 1024;

async function giveFirstPersonAPhoto(page: Page): Promise<void> {
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        window.Strom.DataManager.updatePerson(p.id, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000) });
    });
}

async function openJsonExportDialog(page: Page) {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    return pwd;
}

test('a tree near the limit says so once per session, the notice can be closed', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    const notice = page.locator('.toast[data-kind="memory-limit"]');

    // The browser's own limit: nothing said.
    expect(await page.evaluate(() => window.Strom.MemoryLimit.check())).toBe(false);
    await expect(notice).toHaveCount(0);

    await page.evaluate((l) => window.Strom.MemoryLimit.setLimit(l), LOW_LIMIT);
    expect(await page.evaluate(() => window.Strom.MemoryLimit.check())).toBe(true);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('is close to the memory this browser gives the app');
    await expect(notice).toContainText('Closing the app’s other windows and removing images that are not needed');
    await notice.locator('.toast-close').click();
    await expect(notice).toHaveCount(0);

    // Once per session and tree: the next check says nothing.
    expect(await page.evaluate(() => window.Strom.MemoryLimit.check())).toBe(true);
    await page.waitForTimeout(300);
    await expect(notice).toHaveCount(0);
});

test('an export not near the limit asks nothing', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    await giveFirstPersonAPhoto(page);
    const pwd = await openJsonExportDialog(page);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    expect(Object.values(data.persons as Record<string, { photo?: string }>)[0].photo).toMatch(/^data:image\/jpeg/);
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
});

test('an export near the limit: Cancel makes no file, Continue the file with its images, or without them', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    await giveFirstPersonAPhoto(page);
    await page.evaluate((l) => window.Strom.MemoryLimit.setLimit(l), LOW_LIMIT);
    const confirm = page.locator('#confirmation-modal');

    // Cancel: no file, the export dialog stays.
    let pwd = await openJsonExportDialog(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await pwd.locator('#export-submit-btn').click();
    await expect(confirm).toHaveClass(/active/);
    await expect(confirm.locator('#confirm-title')).toHaveText('Memory may not be enough');
    await expect(confirm.locator('#confirm-message')).toContainText('A file with the images of');
    await expect(confirm.locator('#confirm-message')).toContainText('may need more memory than this browser gives the app');
    await expect(confirm.locator('.confirm-check-label')).toHaveText('Leave the images out of the file');
    await confirm.locator('#confirm-cancel-btn').click();
    await expect(confirm).not.toHaveClass(/active/);
    await expect(pwd).toBeVisible();
    await page.waitForTimeout(300);
    expect(downloads).toBe(0);

    // Continue: the file with its images.
    let [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
            await pwd.locator('#export-submit-btn').click();
            await expect(confirm.locator('#confirm-ok-btn')).toHaveText('Continue');
            await confirm.locator('#confirm-ok-btn').click();
        })(),
    ]);
    let data = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    expect(Object.values(data.persons as Record<string, { photo?: string }>)[0].photo).toMatch(/^data:image\/jpeg/);

    // Continue with "Leave the images out": the file without them.
    pwd = await openJsonExportDialog(page);
    [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
            await pwd.locator('#export-submit-btn').click();
            await confirm.locator('#confirm-check-input').check();
            await confirm.locator('#confirm-ok-btn').click();
        })(),
    ]);
    data = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    expect(Object.values(data.persons as Record<string, { photo?: string }>)[0].photo ?? '').toBe('');
    expect(Object.values(data.persons as Record<string, { firstName: string }>)[0].firstName).toBe('Tamsin');
});

test('reading a file near the limit: Cancel reads nothing, Continue goes on to the import', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    await page.evaluate((l) => window.Strom.MemoryLimit.setLimit(l), LOW_LIMIT);
    const file = {
        name: 'varenne.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
            version: 1,
            persons: { p1: { id: 'p1', firstName: 'Odile', lastName: 'Varenne', gender: 'female', partnerships: [], parentIds: [], childIds: [] } },
            partnerships: {},
        })),
    };
    const confirm = page.locator('#confirmation-modal');
    const importDialog = page.locator('#import-tree-modal');

    await page.locator('#file-input').setInputFiles(file);
    await expect(confirm).toHaveClass(/active/);
    await expect(confirm.locator('#confirm-message')).toContainText('Reading the file “varenne.json”');
    await expect(confirm.locator('#confirm-message')).toContainText('Closing the app’s other windows helps before going on.');
    await confirm.locator('#confirm-cancel-btn').click();
    await page.waitForTimeout(300);
    await expect(importDialog).not.toBeVisible();

    await page.locator('#file-input').setInputFiles(file);
    await confirm.locator('#confirm-ok-btn').click();
    await expect(importDialog).toBeVisible();
});

test('the book near the limit asks first: Cancel opens no window and keeps the dialog, Continue opens the book', async ({ page, context }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    await giveFirstPersonAPhoto(page);
    await page.evaluate((l) => window.Strom.MemoryLimit.setLimit(l), LOW_LIMIT);
    const confirm = page.locator('#confirmation-modal');
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    let windows = 0;
    context.on('page', () => { windows++; });

    await dialog.getByRole('button', { name: 'Open book' }).click();
    await expect(confirm).toHaveClass(/active/);
    await expect(confirm.locator('#confirm-message')).toContainText('The book with the images of');
    // The book cannot leave its images out: no checkbox.
    await expect(confirm.locator('.confirm-check-label')).toHaveCount(0);
    await confirm.locator('#confirm-cancel-btn').click();
    await expect(confirm).not.toHaveClass(/active/);
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    expect(windows).toBe(0);

    const [book] = await Promise.all([
        context.waitForEvent('page'),
        (async () => {
            await dialog.getByRole('button', { name: 'Open book' }).click();
            await confirm.locator('#confirm-ok-btn').click();
        })(),
    ]);
    await book.waitForLoadState('domcontentloaded');
    await expect(book.locator('main.book')).toBeAttached();
    await book.close();
});

test('the poster near the limit asks first: Cancel makes no file, Continue the poster', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Tamsin', 'Varenne');
    await giveFirstPersonAPhoto(page);
    await page.evaluate((l) => window.Strom.MemoryLimit.setLimit(l), LOW_LIMIT);
    const confirm = page.locator('#confirmation-modal');
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const svg = page.locator('#poster-modal .menu-option', { hasText: 'SVG' });
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await svg.click();
    await expect(confirm).toHaveClass(/active/);
    await expect(confirm.locator('#confirm-message')).toContainText('The poster with its portraits');
    await confirm.locator('#confirm-cancel-btn').click();
    await expect(confirm).not.toHaveClass(/active/);
    await expect(page.locator('#poster-modal')).toBeVisible();
    await page.waitForTimeout(300);
    expect(downloads).toBe(0);

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
            await svg.click();
            await confirm.locator('#confirm-ok-btn').click();
        })(),
    ]);
    expect(readFileSync(await download.path(), 'utf-8')).toContain('<svg');
});
