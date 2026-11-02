/**
 * The family pages in the dialog "Book and pages" (spec 026 §6): the
 * output switch (the book's rows give way to the pages' rows, the whole tree
 * with its counts), the estimate and its recount, the warning about the
 * living under full data, the large file (> 15 MB: the offers with their own
 * estimates and the set of files as a choice; > 50 MB: the set of files only,
 * saved as a .zip that unpacks), the
 * memory of the choices per tree, the file built and saved (it opens on the
 * whole tree's introduction), the pages' window's "Save as file", a phone's sheet,
 * the dark theme and German without overflow; the entries (026 §7: the
 * overview's lineage detail, the card's ⋯ menu, Export, a followed tree,
 * Escape over the window, a phone); the family pages in the app (026 §2.4,
 * §7: the card's ⋯ Family page, several marriages under one item, Back in
 * the window's stack, the person page's card Family page). Invented names only
 * (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page, tree: ReturnType<typeof rodsTree> = rodsTree()): Promise<void> {
    await openApp(page);
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    await page.evaluate(async (data) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
    }, tree);
}

async function openDialog(page: Page, output?: 'book' | 'pages'): Promise<Locator> {
    await page.evaluate((o) => window.Strom.UI.showBookDialog(o), output);
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

/** A photo of this many characters on a person of the Brandvold line (in memory only, not saved). */
async function injectPhoto(page: Page, chars: number): Promise<void> {
    await page.evaluate((n) => {
        const p = window.Strom.DataManager.getData().persons['b5' as never] as { photo?: string };
        p.photo = 'data:image/jpeg;base64,' + 'A'.repeat(n);
    }, chars);
}

const outBtn = (dialog: Locator, o: string): Locator => dialog.locator(`.book-out [data-output="${o}"]`);
const pagesOf = async (dialog: Locator): Promise<number> =>
    Number((await dialog.locator('.fp-est-d').textContent())!.match(/^(\d+) page/)![1]);

/** Elements of the dialog wider than their box or past the dialog's right edge. */
async function overflowing(dialog: Locator): Promise<string[]> {
    return dialog.locator('.book-dlg').evaluate((modal) => {
        const right = modal.getBoundingClientRect().right + 1;
        const out: string[] = [];
        modal.querySelectorAll<HTMLElement>('button, label, h2, h3, p, span').forEach(el => {
            if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return;
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            const clipped = getComputedStyle(el).textOverflow === 'ellipsis';
            if (r.right > right || (!clipped && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')) {
                out.push(`${el.className || el.tagName}: ${(el.textContent || '').trim().slice(0, 40)}`);
            }
        });
        if (modal.scrollWidth > modal.clientWidth) out.push('dialog scrolls sideways');
        return out;
    });
}

test.describe('family pages: the dialog', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the output switch: the pages\' rows, the whole tree, the estimate and its recount; back to the book @smoke', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await expect(dialog.locator('#book-dlg-title')).toHaveText('Book and pages');
        await expect(dialog.locator('.book-out [data-output]')).toHaveText(['Printed book', 'Linked pages']);
        await expect(outBtn(dialog, 'book')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-sec="parts"]')).toBeVisible();
        await expect(dialog.locator('input[name="book-kind"][value="tree"]')).toBeChecked();

        await outBtn(dialog, 'pages').click();
        await expect(outBtn(dialog, 'pages')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('.book-out-hint')).toContainText('works offline');
        // Only the pages' rows; the book's preview, presets and parts are gone.
        await expect(dialog.locator('[data-sec="parts"]')).toHaveCount(0);
        await expect(dialog.locator('.book-presets')).toBeHidden();
        await expect(dialog.locator('.book-dlg-side')).toBeHidden();
        for (const sec of ['privacy', 'families', 'groups', 'images', 'include']) await expect(dialog.locator(`[data-sec="${sec}"]`)).toBeVisible();
        await expect(dialog.locator('input[name="fp-families"][value="pages"]')).toBeChecked();
        await expect(dialog.locator('[data-clips="full"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-photos="full"]')).toHaveAttribute('aria-checked', 'true');
        for (const k of ['map', 'timelines']) await expect(dialog.locator(`input[name="fp-inc"][value="${k}"]`)).toBeChecked();
        // The person pages' groups (1102 §4.4): all on by default; the sources and the stories moved here from Includes.
        for (const k of ['history', 'childEvents', 'stories', 'sources', 'materials', 'pdf']) await expect(dialog.locator(`input[name="fp-grp"][value="${k}"]`)).toBeChecked();
        // The whole tree stays chosen for the pages too (1102 §1), with its counts; nothing says it moved.
        const tree = dialog.locator('.book-kind[data-kind="tree"]');
        await expect(tree.locator('input')).toBeEnabled();
        await expect(tree.locator('input')).toBeChecked();
        await expect(tree.locator('.book-kind-h')).toHaveText(/^\d+ people · \d+ family lines and other families$/);

        // The estimate: one file, its pages, people and images, its size and name.
        await expect(dialog.locator('.fp-est-t')).toHaveText('One .html file');
        await expect(dialog.locator('.fp-est-d')).toHaveText(/^\d+ pages · \d+ people · 0 images$/);
        await expect(dialog.locator('.fp-est-s')).toHaveText(/^about \d+(\.\d)? MB$/);
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.html');
        await expect(dialog.locator('.fp-big')).toBeHidden();
        await expect(dialog.locator('#book-open .fp-l-wide')).toHaveText('Save file…');
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('.fp-open')).toHaveText('Open in a window');
        // Families only as sections: fewer pages once the estimate is recounted.
        const before = await pagesOf(dialog);
        await dialog.locator('input[name="fp-families"][value="section"]').check();
        await expect.poll(() => pagesOf(dialog)).toBeLessThan(before);
        // The lineages: one chosen names the file; none chosen, nothing to save or open.
        await dialog.locator('input[name="book-kind"][value="rods"]').check();
        await dialog.locator('.book-rod-row', { hasText: 'Brandvold' }).locator('input').check();
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold-family-line.html');
        await dialog.locator('.book-rod-row', { hasText: 'Brandvold' }).locator('input').uncheck();
        await expect(dialog.locator('.fp-est-t')).toHaveText('No family line is selected.');
        await expect(dialog.locator('#book-open')).toBeDisabled();
        await expect(dialog.locator('.fp-open')).toBeDisabled();
        await dialog.locator('.book-rod-row', { hasText: 'Brandvold' }).locator('input').check();

        // Back to the book: its rows, the button, the dialog's rule (one Cancel right before the primary).
        await outBtn(dialog, 'book').click();
        await expect(dialog.locator('[data-sec="parts"]')).toBeVisible();
        await expect(dialog.locator('#book-open')).toHaveText('Open book');
        await expect(dialog.locator('.fp-open')).toBeHidden();
        await expect(dialog.locator('.book-estimate')).toHaveText(/about \d+ page/);
        expect(await dialog.locator('.buttons [data-dismiss]').evaluate(d => d.nextElementSibling?.id)).toBe('book-open');
    });

    test('the living under full data: the warning with their number; protected, none', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        await expect(dialog.locator('input[name="book-privacy"][value="initials"]')).toBeChecked();
        await expect(dialog.locator('.fp-warn')).toBeHidden();
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        await expect(dialog.locator('.fp-warn')).toHaveText(/^The selection includes \d+ living people\. The file will carry their names, dates and places\.$/);
        await dialog.locator('input[name="book-privacy"][value="anonymous"]').check();
        await expect(dialog.locator('.fp-warn')).toBeHidden();
    });

    test('over 15 MB the offers with their own estimates and the set of files as a choice; over 50 MB the set of files only', async ({ page }) => {
        await setup(page);
        await injectPhoto(page, 20_000_000);
        const dialog = await openDialog(page, 'pages');
        const big = dialog.locator('.fp-big');
        await expect(big).toBeVisible();
        await expect(dialog.locator('.fp-big-t')).toHaveText(/^The file will be large \(about 2\d MB\)\.$/);
        await expect(dialog.locator('.fp-est-s')).toHaveText(/^about 2\d MB$/);
        await expect(big.locator('[data-offer="small"]')).toHaveText(/^Reduce images \(about \d(\.\d)? MB\)$/);
        // No record excerpts in this tree: nothing to leave out.
        await expect(big.locator('[data-offer="noclips"]')).toBeHidden();
        const zip = big.locator('[data-offer="zip"]');
        await expect(zip).toHaveText('Set of files (.zip)');
        await expect(zip).toHaveAttribute('aria-pressed', 'false');
        await expect(dialog.locator('.fp-est-t')).toHaveText('One .html file');
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.html');
        // The set of files as a choice, and back.
        await zip.click();
        await expect(zip).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.locator('.fp-est-t')).toHaveText('Set of files (.zip)');
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.zip');
        // A set of files is estimated as an upper bound (§9.4).
        await expect(dialog.locator('.fp-est-s')).toHaveText(/^at most about 2\d MB$/);
        await zip.click();
        await expect(zip).toHaveAttribute('aria-pressed', 'false');
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.html');
        await expect(dialog.locator('.fp-est-s')).toHaveText(/^about 2\d MB$/);
        await expect(dialog.locator('#book-open')).toBeEnabled();
        // The offer takes its choice: the photos reduced, the warning gone.
        await big.locator('[data-offer="small"]').click();
        await expect(dialog.locator('[data-photos="small"]')).toHaveAttribute('aria-checked', 'true');
        await expect(big).toBeHidden();

        await page.locator('#book-modal .close-btn').click();
        await injectPhoto(page, 60_000_000);
        await openDialog(page, 'pages');
        await dialog.locator('[data-photos="full"]').click();
        await expect(dialog.locator('.fp-big-t')).toHaveText(/^One file would have 6\d MB; it is saved as a set of files\.$/);
        await expect(dialog.locator('.fp-est-t')).toHaveText('Set of files (.zip)');
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.zip');
        await expect(dialog.locator('.fp-est-s')).toHaveText(/^at most about 6\d MB$/);
        await expect(big.locator('[data-offer="zip"]')).toHaveAttribute('aria-pressed', 'true');
        // The only way over 50 MB: a click does not turn it off.
        await big.locator('[data-offer="zip"]').click();
        await expect(big.locator('[data-offer="zip"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await expect(dialog.locator('.fp-open')).toBeEnabled();
    });

    test('the set of files: Save downloads Brandvold.zip; it unpacks and its index.html opens the whole tree\'s introduction', async ({ page, context }) => {
        await setup(page);
        await injectPhoto(page, 20_000_000);
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('.fp-big [data-offer="zip"]').click();
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res).toBeVisible();
        await expect(res.locator('.fp-res-f')).toHaveText(/^Brandvold\.zip · \d+\.\d MB$/);
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        expect(download.suggestedFilename()).toBe('Brandvold.zip');
        const dir = mkdtempSync(join(tmpdir(), 'strom-pages-zip-'));
        const saved = join(dir, download.suggestedFilename());
        await download.saveAs(saved);
        expect(execFileSync('unzip', ['-t', saved]).toString()).toMatch(/No errors detected/);
        const list = execFileSync('unzip', ['-Z1', saved]).toString().trim().split('\n');
        expect(list[0]).toBe('index.html');
        expect(list).toEqual(expect.arrayContaining(['styl.css', 'skript.js', 'hledani.js', expect.stringMatching(/^obrazky\/img-\d+\.jpg$/)]));
        execFileSync('unzip', ['-q', saved, '-d', join(dir, 'out')]);
        const file = await context.newPage();
        await file.goto(pathToFileURL(join(dir, 'out', 'index.html')).href);
        await expect(file.locator('section.sp-page')).toHaveCount(1);
        await expect(file.locator('section.sp-page')).toHaveClass(/sp-page--tree/);
        await expect(file.locator('section.sp-page')).toBeVisible();
        await file.close();
    });

    test('memory per tree: the output and the pages\' choices come back after closing and after a reload', async ({ page }) => {
        await setup(page);
        let dialog = await openDialog(page, 'pages');
        await dialog.locator('input[name="fp-families"][value="section"]').check();
        await dialog.locator('[data-clips="none"]').click();
        await dialog.locator('[data-photos="small"]').click();
        await dialog.locator('input[name="fp-inc"][value="map"]').uncheck();
        await page.locator('#book-modal .close-btn').click();
        await expect(dialog).not.toHaveClass(/active/);
        const check = async (): Promise<void> => {
            await expect(outBtn(dialog, 'pages')).toHaveAttribute('aria-checked', 'true');
            await expect(dialog.locator('input[name="fp-families"][value="section"]')).toBeChecked();
            await expect(dialog.locator('[data-clips="none"]')).toHaveAttribute('aria-checked', 'true');
            await expect(dialog.locator('[data-photos="small"]')).toHaveAttribute('aria-checked', 'true');
            await expect(dialog.locator('input[name="fp-inc"][value="map"]')).not.toBeChecked();
            await expect(dialog.locator('input[name="fp-grp"][value="sources"]')).toBeChecked();
        };
        // The menu's dialog takes the remembered output.
        dialog = await openDialog(page);
        await check();
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        dialog = await openDialog(page);
        await check();
        // An entry of the book opens the book, the pages' choices stay.
        await page.locator('#book-modal .close-btn').click();
        await page.evaluate(() => window.Strom.UI.openBookForPerson('b5' as never));
        await expect(outBtn(dialog, 'book')).toHaveAttribute('aria-checked', 'true');
        await outBtn(dialog, 'pages').click();
        await expect(dialog.locator('input[name="fp-families"][value="section"]')).toBeChecked();
        await expect(dialog.locator('input[name="book-kind"][value="descendants"]')).toBeChecked();
    });

    test('the file: built, Save downloads it, it opens on the tree\'s introduction; Cancel during the build saves nothing', async ({ page, context }) => {
        // A browser that cannot share files (Chrome Canary on a Mac can): no Share.
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
        });
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res).toBeVisible();
        await expect(res.locator('.fp-res-t')).toHaveText('The file is ready');
        await expect(res.locator('.fp-res-f')).toHaveText(/^Brandvold\.html · \d+\.\d MB$/);
        await expect(res.locator('.fp-res-n')).toContainText('Family book');
        // Share only where files can be shared.
        await expect(res.locator('.fp-res-share')).toBeHidden();
        await expect(dialog.locator('.book-dlg-foot .buttons')).toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        expect(download.suggestedFilename()).toBe('Brandvold.html');
        const saved = join(mkdtempSync(join(tmpdir(), 'strom-pages-dlg-')), download.suggestedFilename());
        await download.saveAs(saved);
        const file = await context.newPage();
        await file.goto(pathToFileURL(saved).href);
        // The whole tree's set opens on its introduction, named after the tree.
        await expect.poll(() => file.locator('section.sp-page').evaluateAll(els => els
            .filter(e => getComputedStyle(e).display !== 'none').map(e => `${e.className}|${e.getAttribute('data-sp-title')}`)))
            .toEqual([expect.stringMatching(/sp-page--tree.*\|Brandvold$/)]);
        await file.close();

        // A change of the options drops the file: the options again.
        await dialog.locator('input[name="fp-families"][value="section"]').check();
        await expect(res).toHaveCount(0);
        await expect(dialog.locator('#book-open')).toBeVisible();

        // A slow build shows its progress after ~1 s; Cancel goes back, nothing is saved.
        await page.evaluate(() => {
            const w = window as Window & { requestIdleCallback?: unknown };
            w.requestIdleCallback = (cb: () => void) => window.setTimeout(cb, 400);
        });
        let downloads = 0;
        page.on('download', () => { downloads++; });
        await dialog.locator('#book-open').click();
        const prog = dialog.locator('.fp-prog');
        await expect(prog).toBeVisible();
        await expect(prog.locator('.fp-prog-t')).toHaveText('Saving the pages…');
        await expect(prog.locator('.fp-prog-step')).not.toHaveText('');
        await prog.locator('.fp-prog-cancel').click();
        await expect(prog).toHaveCount(0);
        await expect(dialog.locator('#book-open')).toBeEnabled();
        await page.waitForTimeout(1500);
        await expect(res).toHaveCount(0);
        expect(downloads).toBe(0);
    });

    test('the file where files can be shared: Share hands over the built file by its name', async ({ page }) => {
        await page.addInitScript(() => {
            const shared: { name: string; type: string; size: number }[] = [];
            (window as unknown as { __shared: typeof shared }).__shared = shared;
            Object.defineProperty(Navigator.prototype, 'canShare', { value: (d: { files?: File[] }) => !!d.files?.length, configurable: true });
            Object.defineProperty(Navigator.prototype, 'share', {
                value: async (d: { files?: File[] }) => { for (const f of d.files ?? []) shared.push({ name: f.name, type: f.type, size: f.size }); },
                configurable: true,
            });
        });
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res.locator('.fp-res-t')).toHaveText('The file is ready');
        await expect(res.locator('.fp-res-share')).toBeVisible();
        await res.locator('.fp-res-share').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; size: number }[] }).__shared))
            .toEqual([{ name: 'Brandvold.html', type: expect.stringMatching(/^text\/html/), size: expect.any(Number) }]);
    });

    test('the pages\' window: Save as file opens the dialog with the pages and the window\'s whole tree', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
        const win = page.locator('#person-page-modal');
        await win.locator('.pp-facts [data-pp-rod]', { hasText: 'Ostrander' }).click();
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.pp-save').click();
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(outBtn(dialog, 'pages')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('input[name="book-kind"][value="tree"]')).toBeChecked();
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.html');
    });

    test('the dark theme: the pages\' rows and footer on the dark surfaces', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const dialog = await openDialog(page, 'pages');
        await dialog.locator('input[name="book-privacy"][value="full"]').check();
        await expect(dialog.locator('.fp-warn')).toBeVisible();
        const lum = (c: string): number => {
            const [r, g, b] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        const colors = await dialog.evaluate((o) => {
            const cs = (sel: string) => getComputedStyle(o.querySelector(sel)!);
            return {
                dlg: cs('.book-dlg').backgroundColor, text: cs('.fp-est-t').color,
                warnBg: cs('.fp-warn').backgroundColor, warn: cs('.fp-warn').color,
            };
        });
        expect(lum(colors.dlg)).toBeLessThan(0.3);
        expect(lum(colors.text)).toBeGreaterThan(0.6);
        expect(lum(colors.warn)).toBeGreaterThan(lum(colors.warnBg));
    });
});

test.describe('family pages: the dialog on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a full-screen sheet: rows with summaries open sub-sheets; the footer with Save and share; no sideways scroll', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page, 'pages');
        const modal = dialog.locator('.book-dlg');
        const box = (await modal.boundingBox())!;
        expect(box.width).toBe(390);
        await expect(dialog.locator('.book-sum-row .book-sum-l')).toHaveText(['Privacy of living people', 'Families', 'Person pages', 'Images', 'Includes']);
        await expect(dialog.locator('[data-sum="privacy"]')).toHaveText('Initials');
        await expect(dialog.locator('[data-sum="families"]')).toHaveText('Pages of their own');
        await expect(dialog.locator('[data-sum="groups"]')).toHaveText('6 of 6');
        await expect(dialog.locator('[data-sum="include"]')).toHaveText('Map, timelines');
        await expect(dialog.locator('[data-sec="families"]')).toBeHidden();
        await expect(dialog.locator('#book-open .fp-l-phone')).toHaveText('Save and share…');
        await expect(dialog.locator('#book-open .fp-l-wide')).toBeHidden();
        await expect(dialog.locator('.fp-open')).toBeVisible();
        await expect(dialog.locator('.buttons [data-dismiss]')).toBeHidden();
        // Save and share above Open in a window.
        const save = (await dialog.locator('#book-open').boundingBox())!;
        const open = (await dialog.locator('.fp-open').boundingBox())!;
        expect(save.y).toBeLessThan(open.y);
        expect(save.height).toBeGreaterThanOrEqual(48);
        expect(await overflowing(dialog)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

        await dialog.locator('[data-sub-open="images"]').click();
        await expect(dialog.locator('.book-sub-title')).toHaveText('Images');
        await expect(dialog.locator('[data-sec="images"]')).toBeVisible();
        await dialog.locator('[data-clips="none"]').click();
        expect(await overflowing(dialog)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog.locator('.book-sub-title')).toHaveText('');
        await expect(dialog.locator('[data-sum="images"]')).toHaveText('Photos only');
        await expect(dialog).toHaveClass(/active/);
    });
});

test.describe('family pages: the dialog in German', () => {
    test.use({ locale: 'de' });

    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
        test(`no text past its box at ${w} px, the large-file block included`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: h });
            await setup(page);
            await injectPhoto(page, 20_000_000);
            const dialog = await openDialog(page, 'pages');
            await expect(dialog.locator('#book-dlg-title')).toHaveText('Buch und Seiten');
            await expect(dialog.locator('.fp-big')).toBeVisible();
            await expect(dialog.locator('.fp-big-t')).toHaveText(/^Die Datei wird groß \(etwa 2\d MB\)\.$/);
            expect(await overflowing(dialog)).toEqual([]);
            if (w < 640) {
                await dialog.locator('[data-sub-open="families"]').click();
                expect(await overflowing(dialog)).toEqual([]);
            }
        });
    }
});

/** The tree overview at its family lines, the line's detail open. */
async function openOverviewRod(page: Page, rod: string): Promise<Locator> {
    const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeOverview(id as never, { section: 'rods' }), treeId);
    const sec = page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');
    await expect(sec).toHaveAttribute('data-ready', 'true');
    await sec.locator('.tov-rod[data-rod]', { hasText: rod }).locator('.tov-rod-row').click();
    return sec.locator('.tov-rod.is-open');
}

/** The person card's Family line ⋯ menu, opened. */
async function openCardRodMenu(page: Page, id: string): Promise<Locator> {
    await page.evaluate((pid) => window.Strom.UI.showEditPersonModal(pid as never), id);
    await expect(page.locator('#person-modal')).toHaveClass(/active/);
    const row = page.locator('#pm-rod');
    await row.locator('.pm-rod-more-btn').click();
    const menu = row.locator('.pm-rod-menu');
    await expect(menu).toBeVisible();
    return menu;
}

const treeJson = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData()));

test.describe('family pages: the entries', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the overview\'s lineage detail: Family line page between Show in tree and the book, it opens the window', async ({ page }) => {
        await setup(page);
        const detail = await openOverviewRod(page, 'Tallqvist');
        await expect(detail.locator('.tov-rod-act')).toHaveText(['Show in tree', 'Family line page', 'Family line book…', 'Edit family line…']);
        await detail.getByRole('button', { name: 'Family line page' }).click();
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Tallqvist');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
    });

    test('the card\'s ⋯ menu: Family line page closes the card and opens the line\'s page; Back returns to the person @smoke', async ({ page }) => {
        await setup(page);
        const menu = await openCardRodMenu(page, 'b16');
        await expect(menu.getByRole('menuitem')).toHaveText([
            'Show family line in tree', 'Family line page', 'Family line book…', 'Pages for selected people…', 'Edit family line…', 'Start a family line from this person…',
        ]);
        await menu.locator('[data-rod-act="page"]').click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
        // A person of the line's page opens their page in the same window, Back returns.
        await win.locator('.pp-body [data-sp-open^="person:"]').first().click();
        await expect(win).not.toHaveClass(/pp-is-set/);
        await win.locator('.pp-back').click();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
    });

    test('Actions → For the family → Family pages: the focus person\'s line opens in the window, the living marked; a person without a line opens Other families of the whole tree (1102 §3)', async ({ page }) => {
        const tree = rodsTree();
        (tree.persons as Record<string, unknown>).solo = {
            id: 'solo', firstName: 'Ingvar', lastName: 'Sandmark', gender: 'male', isPlaceholder: false,
            birthDate: '1931', deathDate: '2001', partnerships: [], parentIds: [], childIds: [],
        };
        await setup(page, tree);
        const viaMenu = async (): Promise<void> => {
            await page.locator('.actions-menu-btn').click();
            await page.locator('#actions-family-row').click();
            await expect(page.locator('#actions-family-submenu [role="menuitem"]')).toHaveText(['Family book', 'Family pages', 'Pages for the whole tree', 'Poster…', 'Slideshow (TV)']);
            await page.locator('#actions-pages-row').click();
        };
        await viaMenu();
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
        await expect(page.locator('#actions-family-submenu')).toBeHidden();
        // The window only: Mikael (born 1958) carries "living", Karl (died 1999) not.
        const body = win.locator('.pp-body');
        const tagsAfter = (id: string): Promise<string[]> => body.evaluate((el, pid) => [...el.querySelectorAll(`[data-sp-open="person:${pid}"]`)]
            .map(b => { let n = b.nextElementSibling; if (n?.classList.contains('sp-yrs')) n = n.nextElementSibling; return n?.classList.contains('sp-living') ? n.textContent ?? '' : '-'; }), id);
        await expect.poll(() => tagsAfter('b16')).toContain('living');
        expect(new Set(await tagsAfter('b16'))).toEqual(new Set(['living']));
        expect(new Set(await tagsAfter('b14'))).toEqual(new Set(['-']));
        expect(await body.locator('.sp-living').first().evaluate(el => getComputedStyle(el).fontSize)).toBe('12px');
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);

        // Ingvar has no line of his own: the window over the whole tree, on Other families with his surname's block.
        await page.evaluate(async () => { window.Strom.TreeRenderer.setFocus('solo' as never); await window.Strom.TreeRenderer.renderAsync(); });
        await viaMenu();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(page.locator('#book-modal')).not.toHaveClass(/active/);
        await expect(win.locator('.pp-body section.sp-page--other')).toBeVisible();
        await expect(win.locator('.pp-body [data-sp-open="person:solo"]').first()).toBeVisible();
    });

    test('Export → Print and image: Family pages opens the dialog with the pages and the focus person\'s line; Family book the book', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-pages-btn').click();
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await expect(page.locator('#export-modal')).not.toHaveClass(/active/);
        await expect(outBtn(dialog, 'pages')).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('.book-rod-row input:checked')).toHaveCount(1);
        await expect(dialog.locator('.book-rod-row', { hasText: 'Brandvold' }).locator('input')).toBeChecked();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveClass(/active/);

        // The pages are now remembered; Export's Family book still opens the book.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.locator('#export-modal .menu-option', { hasText: 'Family book' }).click();
        await expect(dialog).toHaveClass(/active/);
        await expect(outBtn(dialog, 'book')).toHaveAttribute('aria-checked', 'true');
    });

    test('Escape over the window: the dialog from Save as file first, then the window', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
        const win = page.locator('#person-page-modal');
        await win.locator('.pp-facts [data-pp-rod]', { hasText: 'Brandvold' }).click();
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.pp-save').click();
        const dialog = page.locator('#book-modal');
        await expect(dialog).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveClass(/active/);
        await expect(win).toBeVisible();
        await expect(win).toHaveClass(/pp-is-set/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-page-modal')).toHaveCount(0);
    });

    test('a followed tree and a locked person: the entries work, nothing in the tree changes', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            const D = window.Strom.DataManager;
            (D.getData().persons['b4' as never] as { isLocked?: boolean }).isLocked = true;
            D.setLiveTree(D.getCurrentTreeId());
        });
        const before = await treeJson(page);
        const win = page.locator('#person-page-modal');
        for (const id of ['b16', 'b4']) {
            const menu = await openCardRodMenu(page, id);
            await expect(menu.locator('[data-rod-act="page"]')).not.toHaveAttribute('aria-disabled', 'true');
            await menu.locator('[data-rod-act="page"]').click();
            await expect(win).toHaveClass(/pp-is-set/);
            await expect(win.locator('#pp-title')).toContainText('Brandvold');
            await page.keyboard.press('Escape');
            await expect(win).toHaveCount(0);
        }

        const detail = await openOverviewRod(page, 'Brandvold');
        await detail.getByRole('button', { name: 'Family line page' }).click();
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.pp-save').click();
        await expect(page.locator('#book-modal')).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
        expect(await treeJson(page)).toBe(before);
    });
});

test.describe('family pages: the entries on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the overview\'s button and the card\'s menu open the window without sideways scroll', async ({ page }) => {
        await setup(page);
        const detail = await openOverviewRod(page, 'Brandvold');
        const btn = detail.getByRole('button', { name: 'Family line page' });
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await btn.click();
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(await win.locator('.pp-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);

        const menu = await openCardRodMenu(page, 'b16');
        await menu.locator('[data-rod-act="page"]').click();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
    });

    test('More › For the family: Family pages right after Family book; it closes the sheet and opens the focus person\'s line (§9.6)', async ({ page }) => {
        await setup(page);
        await page.locator('#bb-view-more').click();
        await page.locator('#sheet-family').click();
        const sub = page.locator('.bottom-sheet-subpage');
        await expect(sub.locator('.bottom-sheet-items .bottom-sheet-item')).toHaveText(['Family book', 'Family pages', 'Pages for the whole tree', 'Poster…', 'Slideshow (TV)']);
        const row = page.locator('#sheet-pages');
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await row.click();
        await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
        await expect(win.locator('.pp-body .sp-living').first()).toBeVisible();
    });
});

/** A 1×1 JPEG: the marriage register's excerpt. */
const CLIP_IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/** The fixture with the wedding of Karl and Ester (bu8) cited from a marriage register with an excerpt and its scan's page. */
function marriageExcerpt(): ReturnType<typeof rodsTree> {
    const tree = rodsTree() as ReturnType<typeof rodsTree> & { sources?: Record<string, unknown> };
    tree.sources = {
        'src-marr': {
            id: 'src-marr', title: 'Marriage register Ekeby 1950–1960', reference: 'fol. 4',
            excerpts: [{ id: 'x1', dataUrl: CLIP_IMG, width: 1, height: 1, sizeBytes: 300, pageUrl: 'https://archive.example/ekeby/4' }],
        },
    };
    (tree.partnerships as Record<string, Record<string, unknown>>).bu8.sourceIds = ['src-marr'];
    return tree;
}

/** The fixture with a second marriage of Karl (b14): Vera Lindqvist, no children. */
function twoMarriages(): ReturnType<typeof rodsTree> {
    const tree = rodsTree();
    const P = tree.persons as Record<string, Record<string, unknown>>;
    P.b14v = { id: 'b14v', firstName: 'Vera', lastName: 'Lindqvist', gender: 'female', isPlaceholder: false, birthDate: '1930', partnerships: ['bu9'], parentIds: [], childIds: [] };
    (tree.partnerships as Record<string, unknown>).bu9 = { id: 'bu9', person1Id: 'b14', person2Id: 'b14v', childIds: [], status: 'married', startDate: '1975' };
    (P.b14.partnerships as string[]).push('bu9');
    return tree;
}

test.describe('family pages: the families in the app', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the card\'s ⋯ menu: Family page (Karl and Ester) after Family line page opens the family\'s page; Back from a partner\'s page returns to it', async ({ page }) => {
        await setup(page);
        const menu = await openCardRodMenu(page, 'b14');
        await expect(menu.getByRole('menuitem')).toHaveText([
            'Show family line in tree', 'Family line page', 'Family page (Karl and Ester)', 'Family line book…', 'Pages for selected people…', 'Edit family line…', 'Start a family line from this person…',
        ]);
        await menu.locator('[data-rod-act="family"][data-fam="bu8"]').click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Ester Fagerholm');
        await expect(win.locator('.pp-body .sp-partner')).toHaveCount(2);
        // A partner's person page in the same window; Back returns to the family.
        await win.locator('.pp-body .sp-go[data-sp-open="person:b14"]').click();
        await expect(win).not.toHaveClass(/pp-is-set/);
        await expect(win.locator('.pp-mname')).toContainText('Karl');
        await win.locator('.pp-back').click();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Ester Fagerholm');
    });

    test('several marriages: one item Family pages unfolds them as ⚭ year and partner; each opens its family; closing the menu folds it', async ({ page }) => {
        await setup(page, twoMarriages());
        let menu = await openCardRodMenu(page, 'b14');
        const many = menu.locator('[data-rod-act="families"]');
        await expect(menu.getByRole('menuitem')).toHaveText([
            'Show family line in tree', 'Family line page', 'Family pages', 'Family line book…', 'Pages for selected people…', 'Edit family line…', 'Start a family line from this person…',
        ]);
        await expect(many).toHaveAttribute('aria-expanded', 'false');
        await many.click();
        await expect(many).toHaveAttribute('aria-expanded', 'true');
        const sub = menu.locator('.pm-rod-sub');
        // Each by the wedding's year and the other partner (design 7b); no recorded date, the name alone.
        await expect(sub.getByRole('menuitem')).toHaveText(['Ester Fagerholm', '⚭ 1975 Vera Lindqvist']);
        await expect(sub.getByRole('menuitem').first()).toBeFocused();
        // Closing the menu folds the item again.
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await page.locator('#pm-rod .pm-rod-more-btn').click();
        await expect(many).toHaveAttribute('aria-expanded', 'false');
        await expect(sub).toBeHidden();
        await many.click();
        await sub.locator('[data-fam="bu9"]').click();
        const win = page.locator('#person-page-modal');
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Vera Lindqvist');
        // The other marriage leads to the first family in the same window; Back returns.
        await win.locator('.pp-body .sp-other [data-sp-open="family:bu8"]').click();
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Ester Fagerholm');
        await win.locator('.pp-back').click();
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Vera Lindqvist');
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
        menu = await openCardRodMenu(page, 'b16');
        await expect(menu.locator('[data-rod-act="family"], [data-rod-act="families"]')).toHaveCount(0);
    });

    test('the marriage\'s excerpt: a click enlarges it in the app\'s image viewer, Escape returns to it; its scan in the archive under it', async ({ page }) => {
        await setup(page, marriageExcerpt());
        await page.evaluate(() => window.Strom.UI.showPersonPage('b14' as never));
        const win = page.locator('#person-page-modal');
        await win.locator('.pp-body .sp-famcard[data-sp-open="family:bu8"]').click();
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Ester Fagerholm');
        const clip = win.locator('.pp-body .sp-marriage .sp-clip');
        await expect(clip).toHaveAttribute('aria-label', 'Enlarge: Marriage register Ekeby 1950–1960, fol. 4');
        await expect(win.locator('.pp-body .sp-marriage .sp-clip-scan a')).toHaveText('Scan in the archive ↗');
        await expect(win.locator('.pp-body .sp-marriage .sp-clip-scan a')).toHaveAttribute('href', 'https://archive.example/ekeby/4');
        await clip.click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await expect(page.locator('#attachment-overlay-img')).toHaveAttribute('src', /^data:image\/jpeg/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await expect(clip).toBeFocused();
        await expect(win).toBeVisible();
    });

    test('the person page\'s window: a card Family page at the own family and at the parents\'; it opens the family, Back the person', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b14' as never));
        const win = page.locator('#person-page-modal');
        await expect(win).toBeVisible();
        await expect(win).not.toHaveClass(/pp-is-set/);
        const own = win.locator('.pp-body .sp-famcard[data-sp-open="family:bu8"]');
        await expect(own).toContainText('Family page →');
        await expect(win.locator('.pp-body .sp-famcard[data-sp-open="family:bu7"]')).toBeVisible();
        await own.click();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(win.locator('#pp-title')).toHaveText('Karl Brandvold and Ester Fagerholm');
        await win.locator('.pp-back').click();
        await expect(win).not.toHaveClass(/pp-is-set/);
        await expect(win.locator('.pp-mname')).toContainText('Karl');
        await expect(own).toBeVisible();
    });
});

test.describe('family pages: the window\'s bar (§3.1, §3.4)', () => {
    test('the breadcrumb: wide the whole path without "‹ the page above" (no repeated target), on a phone "‹ the page above" alone (1101)', async ({ page }) => {
        await setup(page);
        const win = page.locator('#person-page-modal');
        const crumbs = win.locator('.sp-app nav.sp-crumbs');
        const seen = (): Promise<string[]> => crumbs.evaluate(nav => [...nav.children].filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent!.trim()));
        for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
            await page.setViewportSize({ width: w, height: h });
            await page.evaluate(() => window.Strom.UI.showPersonPage('b14' as never));
            await win.locator('.pp-body .sp-famcard[data-sp-open="family:bu8"]').click();
            await expect(win).toHaveClass(/pp-is-set/);
            await expect(crumbs).toBeVisible();
            if (w > 640) {
                await expect(crumbs.locator('.sp-crumb-back'), `${w}×${h}`).toBeHidden();
                expect(await seen(), `${w}×${h}`).toEqual(['Tree', '›', 'Brandvold family line', '›', 'Karl and Ester']);
            } else {
                await expect(crumbs.locator('.sp-crumb-back')).toBeVisible();
                expect(await seen()).toEqual(['‹ Brandvold family line']);
            }
            await page.keyboard.press('Escape');
            await expect(win).toHaveCount(0);
        }
    });

    test('the search over the window\'s page: results as buttons, Escape brings the page back and the window stays; a result opens the person; Index opens the index', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
        const win = page.locator('#person-page-modal');
        await win.locator('.pp-facts [data-pp-rod]', { hasText: 'Brandvold' }).click();
        await expect(win).toHaveClass(/pp-is-set/);
        const q = win.locator('.sp-fbar .sp-q');
        await expect(q).toBeVisible();
        await expect(q).toHaveAttribute('placeholder', 'Search a name…');
        await q.fill('brandv');
        const rows = win.locator('.sp-results .sp-res-row');
        await expect(rows.first()).toBeVisible();
        await expect(win.locator('.sp-app section.sp-page')).toBeHidden();
        await q.press('Escape');
        await expect(win.locator('.sp-results')).toBeHidden();
        await expect(win.locator('.sp-app section.sp-page')).toBeVisible();
        await expect(win).toHaveClass(/pp-is-set/);
        await expect(q).toHaveValue('');
        await q.fill('brandv');
        const first = win.locator('.sp-results button.sp-res-n').first();
        const name = (await first.textContent())!;
        await first.click();
        await expect(win).not.toHaveClass(/pp-is-set/);
        await expect(win.locator('.pp-mname')).toContainText(name.split(' ')[0]);
        await page.locator('#person-page-modal .pp-back').click();
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.sp-fbar button.sp-fbar-a', { hasText: 'Index' }).click();
        await expect(win.locator('.sp-app section.sp-page--index')).toBeVisible();
        await expect(win.locator('.sp-fbar button.sp-fbar-a', { hasText: 'Index' })).toHaveAttribute('aria-current', 'page');
        await expect(win.locator('.sp-tabs .sp-tab')).toHaveText(['People', 'Families', 'Surnames', 'Places']);
    });

    test('the dialog\'s label and field rules do not reach the search: on a phone it waits behind the magnifier, the name is not cut; wide, the magnifier sits inside the field (1101)', async ({ page }) => {
        await setup(page);
        const win = page.locator('#person-page-modal');
        const open = async (): Promise<void> => {
            await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
            await win.locator('.pp-facts [data-pp-rod]', { hasText: 'Brandvold' }).click();
            await expect(win).toHaveClass(/pp-is-set/);
        };
        const search = win.locator('.sp-fbar label.sp-search');
        const q = win.locator('.sp-fbar .sp-q');
        // Wide: one row, no label margin, the magnifier vertically inside the field and left of the text.
        await page.setViewportSize({ width: 1440, height: 900 });
        await open();
        const wide = await search.evaluate((el) => {
            const cs = getComputedStyle(el);
            const f = el.querySelector('.sp-q')!.getBoundingClientRect();
            const i = el.querySelector('.sp-ico')!.getBoundingClientRect();
            const pad = parseFloat(getComputedStyle(el.querySelector('.sp-q')!).paddingLeft);
            return { display: cs.display, margin: cs.marginBottom, dy: Math.abs((i.top + i.bottom) / 2 - (f.top + f.bottom) / 2), inside: i.left >= f.left && i.right + 4 <= f.left + pad };
        });
        expect(wide).toEqual({ display: 'flex', margin: '0px', dy: expect.any(Number), inside: true });
        expect(wide.dy).toBeLessThanOrEqual(2);
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
        // Phone: the name, the magnifier and Menu; the field only after the magnifier, 16 px (no zoom on focus).
        await page.setViewportSize({ width: 390, height: 844 });
        await open();
        await expect(search).toBeHidden();
        const home = win.locator('.sp-fbar .sp-fbar-home');
        expect(await home.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await win.locator('.sp-fbar .sp-fbar-lupa').click();
        await expect(search).toBeVisible();
        await expect(q).toBeFocused();
        expect(await q.evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
        await win.locator('.sp-fbar .sp-fbar-cancel').click();
        await expect(search).toBeHidden();
    });
});

/** The tree overview of the active tree, its "Tree pages" button clicked: the window over the whole tree. */
async function treePagesFromOverview(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.DataManager.getCurrentTreeId() as never));
    const btn = page.locator('#tree-overview-modal .tov-pages');
    await expect(btn).toHaveText('Tree pages');
    await btn.click();
    await expect(page.locator('#tree-overview-modal')).toBeHidden();
    const win = page.locator('#person-page-modal');
    await expect(win).toHaveClass(/pp-is-set/);
    await expect(win.locator('.pp-body section.sp-page--tree')).toBeVisible();
    return win;
}

test.describe('the whole tree\'s pages (1102)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the overview\'s Tree pages: the introduction with the lines; the choice of a line filters, Enter opens the line, Back returns', async ({ page }) => {
        await setup(page);
        const win = await treePagesFromOverview(page);
        const intro = win.locator('.pp-body section.sp-page--tree');
        // The lines above four members as cards, the small families together as Other families.
        await expect(intro).toContainText('Brandvold');
        await expect(intro).toContainText('Tallqvist');
        await expect(intro).toContainText('Other families');
        const pick = win.locator('.sp-fbar details.sp-rodpick');
        await expect(pick.locator('.sp-rodpick-btn')).toHaveText(/^Lines/);
        await pick.locator('.sp-rodpick-btn').click();
        await expect(pick).toHaveAttribute('open', '');
        const q = pick.locator('.sp-rodpick-q');
        await expect(q).toBeFocused();
        await q.fill('tallq');
        await expect(pick.locator('.sp-rodpick-rod:not([hidden])')).toHaveCount(1);
        await q.press('Enter');
        await expect(win.locator('.pp-body section.sp-page--rod')).toBeVisible();
        await expect(win.locator('#pp-title')).toContainText('Tallqvist');
        await expect(pick).not.toHaveAttribute('open', '');
        await expect(win.locator('.sp-fbar .sp-rodpick-btn')).toContainText('Tallqvist');
        // Escape closes the choice only, the window stays.
        await win.locator('.sp-fbar .sp-rodpick-btn').click();
        await page.keyboard.press('Escape');
        await expect(win.locator('.sp-fbar details.sp-rodpick')).not.toHaveAttribute('open', '');
        await expect(win).toHaveClass(/pp-is-set/);
        await win.locator('.pp-back').click();
        await expect(win.locator('.pp-body section.sp-page--tree')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(win).toHaveCount(0);
    });

    test('the dialog: the whole tree for the pages; the zip of the whole tree has the choice of a line that works without scripts', async ({ page, browser }) => {
        await setup(page);
        await injectPhoto(page, 20_000_000);
        const dialog = await openDialog(page, 'pages');
        await expect(dialog.locator('input[name="book-kind"][value="tree"]')).toBeChecked();
        await dialog.locator('.fp-big [data-offer="zip"]').click();
        await expect(dialog.locator('.fp-file')).toHaveText('Brandvold.zip');
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res).toBeVisible();
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        const dir = mkdtempSync(join(tmpdir(), 'strom-tree-zip-'));
        const saved = join(dir, download.suggestedFilename());
        await download.saveAs(saved);
        execFileSync('unzip', ['-q', saved, '-d', join(dir, 'out')]);
        const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
        const file = await ctx.newPage();
        await file.goto(pathToFileURL(join(dir, 'out', 'index.html')).href);
        await expect(file.locator('section.sp-page--tree')).toBeVisible();
        const pick = file.locator('.sp-fbar details.sp-rodpick');
        await expect(pick).toBeVisible();
        // Without scripts: no search field, the list itself; its links lead to the lines' files.
        await pick.locator('summary').click();
        await expect(pick.locator('.sp-rodpick-q')).toBeHidden();
        const link = pick.locator('.sp-rodpick-rod a.sp-rodpick-a', { hasText: 'Hollberg' });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', /\.html(#.*)?$/);
        await link.click();
        await expect(file.locator('section.sp-page--rod')).toBeVisible();
        await expect(file.locator('.sp-fbar .sp-rodpick-btn')).toContainText('Hollberg');
        await ctx.close();
    });
});

test.describe('the whole tree\'s pages on a phone (1102)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the window fits 390 px; the choice of a line is a full-width panel with rows of 44 px', async ({ page }) => {
        await setup(page);
        const win = await treePagesFromOverview(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(await win.locator('.pp-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        const pick = win.locator('.sp-fbar details.sp-rodpick');
        await pick.locator('.sp-rodpick-btn').tap();
        const pop = pick.locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        const box = (await pop.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(391);
        for (const h of await pick.locator('.sp-rodpick-a').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
            expect(h).toBeGreaterThanOrEqual(44);
        }
        await pick.locator('.sp-rodpick-rod .sp-rodpick-a', { hasText: 'Brandvold' }).tap();
        await expect(win.locator('.pp-body section.sp-page--rod')).toBeVisible();
        await expect(win.locator('#pp-title')).toContainText('Brandvold');
    });
});
