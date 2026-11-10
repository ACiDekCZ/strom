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
    await exportModal.locator('.menu-option', { hasText: 'Data backup (JSON)' }).click();

    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    const privacy = pwd.locator('#export-privacy-mode');
    await expect(privacy).toBeVisible();
    await privacy.selectOption('initials');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.locator('#export-submit-btn').click(),
    ]);
    const content = readFileSync(await download.path(), 'utf-8');
    const data = JSON.parse(content);
    const names = Object.values(data.persons).map((p: { firstName: string }) => p.firstName);

    // Living person's full first name is hidden; reduced to an initial.
    expect(names).not.toContain('Alice');
    expect(names).toContain('A.');
});

test('poster dialog opens above the export dialog with a truthful family-view label; SVG download is valid XML', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.showExportDialog());
    const exportModal = page.locator('#export-modal');
    await expect(exportModal).toBeVisible();
    await exportModal.locator('.menu-option', { hasText: 'Poster' }).click();

    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    // Stacking fix: the export dialog is closed, so the poster is not hidden behind it.
    await expect(exportModal).toBeHidden();
    // Format / orientation options are offered (print is not exercised).
    await expect(poster.locator('#poster-format')).toBeVisible();
    await expect(poster.locator('#poster-orientation')).toBeVisible();
    // A truthful label: it names the view, the focus person and the depth.
    const label = poster.locator('#poster-view-label');
    await expect(label).toContainText('Prints the current view:');
    await expect(label).toContainText('Family');
    await expect(label).toContainText('Jan Novak');

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
    await page.locator('#export-modal').locator('.menu-option', { hasText: 'Poster' }).click();
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

test('fan view: poster downloads an SVG containing fan sectors', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

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
    expect(svg).toContain('{fill:#d3dce4}'); // embedded print male fill (FAN_PALETTES.print)
    expect(svg).toMatch(/<path class="fan-fill[^"]*" d="M/); // sector geometry
});

test('fan view: the two-way poster names ancestors and descendants (1031)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.locator('#view-mode-fan').click();
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
    await page.getByRole('radio', { name: 'Two-way' }).click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFanShape())).toBe('two');

    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const label = page.locator('#poster-modal #poster-view-label');
    await expect(label).toContainText('ancestors and descendants');
    await expect(label).toContainText('3 down');
});

test('timeline view: poster downloads an SVG containing timeline bars', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

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
    await expect(card(page, 'Johan')).toBeVisible();

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
    await expect(card(page, 'Johan')).toBeVisible();

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

test('tiled print fires only after the tile image is decoded, adds an assembly guide and skips blank sheets', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();
    // Capture the state at the moment print() is invoked (empty-pages fix).
    await page.evaluate(() => {
        (window as unknown as { __printState?: unknown }).__printState = null;
        (window as unknown as { print: () => void }).print = () => {
            const img = document.querySelector('#poster-print img') as HTMLImageElement | null;
            (window as unknown as { __printState?: unknown }).__printState = {
                called: true,
                imgComplete: img?.complete ?? false,
            };
        };
    });
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    await page.evaluate(() => window.Strom.UI.printPosterPdf());

    await expect.poll(() => page.evaluate(() =>
        (window as unknown as { __printState?: { called?: boolean } }).__printState?.called ?? false
    )).toBe(true);
    const printed = await page.evaluate(() =>
        (window as unknown as { __printState?: { imgComplete: boolean } }).__printState!);
    expect(printed.imgComplete, 'print never fires on undecoded tiles').toBe(true);

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

/**
 * Spacing in the export dialog (spec 069 §4): its own choice, remembered on
 * this device at once, the screen left as it is; under each option the
 * sheets it prints on (the guide page's count) when the two differ.
 */
test.describe('poster spacing (1110)', () => {
    const svgHeight = (svg: string): number => Number(/<svg[^>]* height="(\d+)"/.exec(svg)![1]);

    async function downloadSvg(page: import('@playwright/test').Page): Promise<string> {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
        ]);
        return readFileSync(await download.path(), 'utf-8');
    }

    test('remembered at once, the screen untouched, a dense image lower than a normal one', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        const gens = await page.evaluate(() => new Set([...window.Strom.TreeRenderer.getPosterLayout().positions.values()].map(p => p.y)).size);
        expect(gens).toBeGreaterThanOrEqual(3);
        const screenBefore = await page.evaluate(() => [...window.Strom.TreeRenderer.getPosterLayout().positions.entries()]);

        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const row = page.locator('#poster-modal .poster-spacing');
        await expect(row).toBeVisible();
        await expect(row.locator('#poster-spacing-label')).toHaveText('Spacing');
        await expect(row.getByRole('radio', { name: 'Normal' })).toBeChecked();
        await expect(row.locator('.poster-spacing-desc')).toHaveText(
            'Smaller gaps between cards and generations; more people fit on the screen. Applies to image export, poster and PDF print.');
        expect(await page.evaluate(() => window.Strom.SettingsManager.getPosterSpacing())).toBe('normal');
        const normal = await downloadSvg(page);

        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await row.getByRole('radio', { name: 'Dense' }).check();
        // Stored at once, before any export; the screen's own spacing is another setting.
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings')!).posterSpacing)).toBe('dense');
        expect(await page.evaluate(() => window.Strom.SettingsManager.getTreeSpacing())).toBe('normal');
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(row.getByRole('radio', { name: 'Dense' })).toBeChecked();
        const dense = await downloadSvg(page);

        expect(svgHeight(dense)).toBeLessThan(svgHeight(normal));
        // The screen keeps its layout and its spacing.
        await expect(page.locator('#tree-canvas')).not.toHaveClass(/tree-dense/);
        expect(await page.evaluate(() => [...window.Strom.TreeRenderer.getPosterLayout().positions.entries()])).toEqual(screenBefore);

        // Remembered across a reload.
        await page.reload();
        await expect(card(page, 'Johan')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(page.locator('#poster-modal .poster-spacing').getByRole('radio', { name: 'Dense' })).toBeChecked();
    });

    test('each option names the sheets its print takes, as the guide page counts them; none when both take as many', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const modal = page.locator('#poster-modal');
        const sheets = (s: 'normal' | 'dense') => modal.locator(`.poster-sheets[data-spacing="${s}"]`);

        // Every format and orientation: the counts follow the choice at once.
        let differing: { format: string; orientation: string; normal: string; dense: string } | null = null;
        for (const format of ['A4', 'A3']) {
            for (const orientation of ['portrait', 'landscape']) {
                await modal.locator('#poster-format').selectOption(format);
                await modal.locator('#poster-orientation').selectOption(orientation);
                if (await sheets('normal').isHidden()) {
                    await expect(sheets('dense')).toBeHidden();
                    continue;
                }
                const n = (await sheets('normal').textContent())!, d = (await sheets('dense').textContent())!;
                expect(n).toMatch(new RegExp(`^\\d+ ${format} sheets?$`));
                expect(d).toMatch(new RegExp(`^\\d+ ${format} sheets?$`));
                expect(n).not.toBe(d);
                differing ??= { format, orientation, normal: n, dense: d };
            }
        }
        expect(differing, 'the sample tree takes fewer sheets in the dense spacing in some format').not.toBeNull();

        // The PDF's guide page counts the same sheets, in either spacing.
        for (const spacing of ['normal', 'dense'] as const) {
            await page.evaluate(() => {
                (window as unknown as { __guide?: string | null }).__guide = null;
                (window as unknown as { print: () => void }).print = () => {
                    (window as unknown as { __guide?: string | null }).__guide =
                        document.querySelector('#poster-print .poster-guide-head span')?.textContent ?? '';
                };
            });
            await page.evaluate(() => window.Strom.UI.showPosterDialog());
            await modal.locator('#poster-format').selectOption(differing!.format);
            await modal.locator('#poster-orientation').selectOption(differing!.orientation);
            await modal.locator('.poster-spacing').getByRole('radio', { name: spacing === 'normal' ? 'Normal' : 'Dense' }).check();
            await page.evaluate(() => window.Strom.UI.printPosterPdf());
            await expect.poll(() => page.evaluate(() => (window as unknown as { __guide?: string | null }).__guide)).not.toBeNull();
            const guide = await page.evaluate(() => (window as unknown as { __guide: string }).__guide);
            const count = Number(/^(\d+)/.exec(spacing === 'normal' ? differing!.normal : differing!.dense)![1]);
            expect(guide).toMatch(new RegExp(`^${count} sheets? \\(`));
            await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        }
    });

    test('a tree on one sheet either way shows no counts', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const row = page.locator('#poster-modal .poster-spacing');
        await expect(row).toBeVisible();
        await expect(row.locator('.poster-sheets')).toHaveCount(2);
        for (const el of await row.locator('.poster-sheets').all()) await expect(el).toBeHidden();
    });

    test('the fan and the timeline lay out their own way: no spacing row', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await page.locator('#view-mode-fan').click();
        await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(page.locator('#poster-modal')).toBeVisible();
        await expect(page.locator('#poster-modal .poster-spacing')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closePosterDialog());

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('timeline'));
        await expect(page.locator('.timeline-svg')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(page.locator('#poster-modal .poster-spacing')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closePosterDialog());

        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(page.locator('#poster-modal .poster-spacing')).toBeVisible();
    });
});
