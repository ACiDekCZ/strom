import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson } from './helpers.js';

test('export dialog: privacy select applies; JSON download hides living names with initials', async ({ page }) => {
    await openApp(page);
    // A clearly-living person (recent birth) plus a clearly-deceased one.
    await createFirstPerson(page, 'Alice', 'Living', { gender: 'female', birthDate: '1990' });

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const exportModal = page.locator('#export-modal');
    await expect(exportModal).toBeVisible();
    await exportModal.locator('.menu-option', { hasText: 'Export JSON' }).click();

    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    const privacy = pwd.locator('#export-privacy-mode');
    await expect(privacy).toBeVisible();
    await privacy.selectOption('initials');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const content = readFileSync(await download.path(), 'utf-8');
    const data = JSON.parse(content);
    const names = Object.values(data.persons).map((p: { firstName: string }) => p.firstName);

    // Living person's full first name is hidden; reduced to an initial.
    expect(names).not.toContain('Alice');
    expect(names).toContain('A.');
});

test('poster dialog opens above the export dialog; SVG download is valid XML', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const exportModal = page.locator('#export-modal');
    await expect(exportModal).toBeVisible();
    await exportModal.locator('.menu-option', { hasText: 'Export as poster' }).click();

    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    // Stacking fix: the export dialog is closed, so the poster is not hidden behind it.
    await expect(exportModal).toBeHidden();
    // Format / orientation options are offered (print is not exercised).
    await expect(poster.locator('#poster-format')).toBeVisible();
    await expect(poster.locator('#poster-orientation')).toBeVisible();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Jan');
});

test('poster PNG export downloads a non-empty PNG image', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.locator('#export-modal').locator('.menu-option', { hasText: 'Export as poster' }).click();
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'PNG' }).click(),
    ]);
    const bytes = readFileSync(await download.path());
    // PNG magic number, and a non-trivial payload.
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBeGreaterThan(1000);
});

test('poster SVG applies the living-privacy filter', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Alice', 'Living', { gender: 'female', birthDate: '1990' });

    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    await poster.locator('#poster-privacy-mode').selectOption('initials');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.getByRole('button', { name: /SVG/ }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg).not.toContain('Alice');
    expect(svg).toContain('A.');
});

test('tiled print fires only after the tile image is decoded (empty-pages fix)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Capture the state at the moment print() is invoked.
    await page.evaluate(() => {
        (window as unknown as { __printState?: unknown }).__printState = null;
        (window as unknown as { print: () => void }).print = () => {
            const img = document.querySelector('#poster-print img') as HTMLImageElement | null;
            (window as unknown as { __printState?: unknown }).__printState = {
                called: true,
                imgComplete: img?.complete ?? false,
                pages: document.querySelectorAll('#poster-print .poster-page').length,
            };
        };
    });
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    await page.evaluate(() => window.Strom.UI.printPosterPdf());

    await expect.poll(() => page.evaluate(() =>
        (window as unknown as { __printState?: { called?: boolean } }).__printState?.called ?? false
    )).toBe(true);
    const state = await page.evaluate(() =>
        (window as unknown as { __printState?: { imgComplete: boolean; pages: number } }).__printState!);
    expect(state.pages).toBeGreaterThan(0);
    expect(state.imgComplete).toBe(true);   // print never fires on undecoded tiles
});
