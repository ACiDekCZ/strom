import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson, card } from './helpers.js';

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

test('poster dialog shows a truthful view label for the family view', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    // The line names the view, the focus person and the depth.
    const label = poster.locator('#poster-view-label');
    await expect(label).toContainText('Prints the current view:');
    await expect(label).toContainText('Family');
    await expect(label).toContainText('Jan Novak');
});

test('fan view: poster downloads an SVG containing fan sectors', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.locator('#view-mode-fan').click();
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    await expect(poster.locator('#poster-view-label')).toContainText('Fan');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    // A fan poster: the nested fan chart with drawn sectors (paths), the
    // self-contained light colours, and NOT the tree card layout.
    expect(svg).toContain('class="fan-svg"');
    expect(svg).toContain('fan-sector');
    expect(svg).toContain('#e3f2fd');       // embedded light male fill
    expect(svg).toMatch(/<path d="M /);      // sector geometry
});

test('timeline view: poster downloads an SVG containing timeline bars', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('timeline'));
    await expect(page.locator('.timeline-svg')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    // The label names the timeline view (no longer a "coming soon" block).
    await expect(poster.locator('#poster-view-label')).toContainText('Timeline');
    // Every export button is enabled (timeline is a first-class poster now).
    await expect(poster.locator('.menu-option').first()).toBeEnabled();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    // A timeline poster: the nested timeline chart with life-bars, self-contained
    // light colours, plain-text names (no foreignObject), and NOT the card layout.
    expect(svg).toContain('class="timeline-svg"');
    expect(svg).toContain('timeline-bar');
    expect(svg).toContain('tl-bar-rect');
    expect(svg).toContain('.tl-grid{stroke:#e2e2e2'); // embedded light colours
    expect(svg).not.toContain('<foreignObject');       // canvas-safe labels
});

test('timeline view: tiled print decodes its tiles (no blank sheets)', async ({ page }) => {
    // Regression: the timeline poster embedded a nested <svg> with duplicate
    // width/height attributes → invalid XML → the tile <img> never decoded, so
    // the print preview showed blank sheets. Assert the tile image loads.
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('timeline'));
    await expect(page.locator('.timeline-svg')).toBeVisible();

    await page.evaluate(() => {
        (window as unknown as { __printState?: unknown }).__printState = null;
        (window as unknown as { print: () => void }).print = () => {
            const img = document.querySelector('#poster-print img') as HTMLImageElement | null;
            (window as unknown as { __printState?: unknown }).__printState = {
                called: true,
                imgComplete: img?.complete ?? false,
                naturalWidth: img?.naturalWidth ?? 0,
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
        (window as unknown as { __printState?: { imgComplete: boolean; naturalWidth: number; pages: number } }).__printState!);
    expect(state.pages).toBeGreaterThan(0);
    // The nested timeline SVG is valid XML now, so the tile image actually
    // decodes: a broken SVG leaves naturalWidth === 0 and blank sheets.
    expect(state.imgComplete).toBe(true);
    expect(state.naturalWidth).toBeGreaterThan(0);
});

test('map view: poster export is honestly blocked and buttons are disabled', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    // Honest message, and every export button is disabled (no silent card print).
    await expect(poster.locator('#poster-view-label')).toContainText('map is not printable');
    const options = poster.locator('.menu-option');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
        await expect(options.nth(i)).toBeDisabled();
    }
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

test('tiled print adds an assembly guide and skips blank sheets', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();
    await page.evaluate(() => { (window as unknown as { print: () => void }).print = () => {}; });
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    await page.evaluate(() => window.Strom.UI.printPosterPdf());

    await expect.poll(() => page.evaluate(() =>
        document.querySelectorAll('#poster-print .poster-page').length)).toBeGreaterThan(0);
    const state = await page.evaluate(() => {
        const cells = document.querySelectorAll('#poster-print .poster-guide-cell').length;
        const tiles = document.querySelectorAll('#poster-print .poster-page:not(.poster-guide)').length;
        const clips = document.querySelectorAll('#poster-print .poster-page-clip').length;
        return { cells, tiles, clips, guide: !!document.querySelector('#poster-print .poster-guide') };
    });
    expect(state.guide).toBe(true);
    expect(state.cells).toBeGreaterThan(0);
    // Every printed tile has content; blank sheets are skipped, so tile count
    // never exceeds the guide's grid cells.
    expect(state.tiles).toBe(state.clips);
    expect(state.tiles).toBeLessThanOrEqual(state.cells);
});
