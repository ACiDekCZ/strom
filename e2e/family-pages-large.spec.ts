/**
 * A large set of pages (1102 §7): the footer's time of the save, the people
 * with only a name and years without a page of their own from 1000 pages,
 * the progress with the time left, the build in the background with its chip
 * in the toolbar (a phone and a phone held sideways too), the pause while the
 * app is hidden, one build at a time, and the index of people split by
 * letters in the saved set of files. Invented names only (the synthetic tree
 * and e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';

async function setup(page: Page, tree: { defaultPersonId?: string } & object = rodsTree(), name = 'Brandvold'): Promise<void> {
    await openApp(page);
    await page.evaluate(async ({ data, name }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, name);
        S.UI.updateTreeSwitcher?.();
        if (data.defaultPersonId) S.TreeRenderer.setFocus(data.defaultPersonId as never);
        await S.TreeRenderer.renderAsync();
    }, { data: tree as { defaultPersonId?: string }, name });
}

async function openDialog(page: Page): Promise<Locator> {
    await page.evaluate(() => window.Strom.UI.showBookDialog('pages'));
    const dialog = page.locator('#book-modal');
    await expect(dialog).toHaveClass(/active/);
    return dialog;
}

/** Every page waits this long, so the build can be watched (family-pages-ui's test hook). */
async function slowPages(page: Page, ms: number): Promise<void> {
    await page.evaluate((v) => { (window as Window & { __stromPagesDelay?: number }).__stromPagesDelay = v; }, ms);
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
    await page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

const pagesOf = async (dialog: Locator): Promise<number> =>
    Number((await dialog.locator('.fp-est-d').textContent())!.match(/^([\d,\s]+) page/)![1].replace(/\D/g, ''));

/** The synthetic tree of this many people (invented names), its youngest person in focus. */
function synthetic(persons: number): object {
    const { data, rootId } = syntheticTree({ persons });
    return { ...data, defaultPersonId: rootId };
}

test.describe('a large set of pages: the dialog (1102 §7)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the footer: the time of the save on this computer; no option for people with a name and years below 1000 pages', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await expect(dialog.locator('.fp-est-time')).toHaveText(/^Saving takes about \d+ (s|min) on this computer$/);
        await expect(dialog.locator('.fp-min')).toBeHidden();
    });

    test('from 1000 pages: the people with only a name and years without a page, on by default; off gives the pages back', async ({ page }) => {
        test.setTimeout(120_000);
        await setup(page, synthetic(1200), 'Smyslenov');
        const dialog = await openDialog(page);
        const min = dialog.locator('.fp-min');
        await expect(min).toBeVisible();
        await expect(min.locator('input[name="fp-min"]')).toBeChecked();
        await expect(min.locator('.fp-min-t')).toHaveText('No separate page for people with only a name and year');
        const n = Number((await min.locator('.fp-min-n').textContent())!.match(/\((\d+) fewer pages?\)/)![1]);
        expect(n).toBeGreaterThan(0);
        const fewer = await pagesOf(dialog);
        await min.locator('input[name="fp-min"]').uncheck();
        await expect.poll(() => pagesOf(dialog)).toBe(fewer + n);
        // Not remembered: the dialog again has it on.
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveClass(/active/);
        await openDialog(page);
        await expect(min.locator('input[name="fp-min"]')).toBeChecked();
    });

    test('the progress with the time left; in the background with the chip; done: the chip opens the result', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await slowPages(page, 150);
        await dialog.locator('#book-open').click();
        const prog = dialog.locator('.fp-prog');
        await expect(prog).toBeVisible();
        await expect(prog.locator('.fp-prog-n')).not.toHaveText('');
        await expect(prog.locator('.fp-prog-left')).toHaveText(/^about \d+ (s|min) left$/);
        await expect(prog.locator('.fp-prog-bg .fp-l-wide')).toHaveText('Continue in background');
        await prog.locator('.fp-prog-bg').click();
        await expect(dialog).not.toHaveClass(/active/);
        const chip = page.locator('#pages-bg-chip');
        await expect(chip).toBeVisible();
        await expect(chip.locator('.pages-bg-t')).toHaveText(/^Pages \d+%$/);
        await expect(chip).toBeFocused();
        // One build at a time.
        await page.evaluate(() => window.Strom.UI.showBookDialog('pages'));
        await expect(dialog).toHaveClass(/active/);
        await dialog.locator('#book-open').click();
        const alert = page.getByText('Saving is already in progress.');
        await expect(alert).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(alert).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveClass(/active/);
        await slowPages(page, 0);
        await expect(chip).toHaveClass(/is-done/, { timeout: 30_000 });
        await expect(chip.locator('.pages-bg-t')).toHaveText('The pages are ready');
        await chip.click();
        await expect(dialog).toHaveClass(/active/);
        await expect(dialog.locator('.fp-res-t')).toHaveText('The file is ready');
        await expect(chip).toBeHidden();
        await expect(dialog.locator('.fp-res-save')).toBeFocused();
    });

    test('the chip during the build reopens the progress', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await slowPages(page, 200);
        await dialog.locator('#book-open').click();
        await dialog.locator('.fp-prog .fp-prog-bg').click();
        const chip = page.locator('#pages-bg-chip');
        await chip.click();
        await expect(dialog).toHaveClass(/active/);
        await expect(dialog.locator('.fp-prog')).toBeVisible();
        await expect(chip).toBeHidden();
        await dialog.locator('.fp-prog-cancel').click();
        await expect(dialog.locator('.fp-prog')).toHaveCount(0);
        await expect(chip).toBeHidden();
    });

    test('hidden app: the build pauses with its note and goes on on return', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await slowPages(page, 150);
        await dialog.locator('#book-open').click();
        const prog = dialog.locator('.fp-prog');
        await expect(prog.locator('.fp-prog-n')).not.toHaveText('');
        await setHidden(page, true);
        await expect(prog.locator('.fp-prog-t')).toHaveText('Paused');
        await expect(prog.locator('.fp-prog-note')).toContainText('Saving pauses while another app is open');
        await page.waitForTimeout(400);
        const at = await prog.locator('.fp-prog-n').textContent();
        await page.waitForTimeout(800);
        await expect(prog.locator('.fp-prog-n')).toHaveText(at!);
        await setHidden(page, false);
        await expect(prog.locator('.fp-prog-t')).toHaveText('Saving the pages…');
        await expect(prog.locator('.fp-prog-note')).toBeHidden();
        await expect(prog.locator('.fp-prog-n')).not.toHaveText(at!);
        await slowPages(page, 0);
        await expect(dialog.locator('.fp-res-t')).toHaveText('The file is ready', { timeout: 30_000 });
    });

    test('the set of files of a large tree: the index of people by letters, each letter a page, a letter to the next', async ({ page, browser }) => {
        test.setTimeout(180_000);
        await setup(page, synthetic(1200), 'Smyslenov');
        const dialog = await openDialog(page);
        const offer = dialog.locator('.fp-big [data-offer="zip"]');
        if (await offer.isVisible()) await offer.click();
        await expect(dialog.locator('.fp-file')).toHaveText('Smyslenov.zip');
        await expect(dialog.locator('.fp-est-s')).toHaveText(/MB/);
        await dialog.locator('#book-open').click();
        const res = dialog.locator('.fp-res');
        await expect(res.locator('.fp-res-t')).toHaveText('The set of pages is ready', { timeout: 120_000 });
        await expect(res.locator('.fp-res-n')).toContainText('index.html');
        const [download] = await Promise.all([page.waitForEvent('download'), res.locator('.fp-res-save').click()]);
        const dir = mkdtempSync(join(tmpdir(), 'strom-large-zip-'));
        const saved = join(dir, download.suggestedFilename());
        await download.saveAs(saved);
        execFileSync('unzip', ['-q', saved, '-d', join(dir, 'out')]);
        const top = readdirSync(join(dir, 'out')).sort();
        expect(top.filter(f => f.endsWith('.html'))).toEqual(['index.html']);
        expect(top).toEqual(expect.arrayContaining(['_files', 'index', 'people', 'families', 'lines']));
        const letters = readdirSync(join(dir, 'out', 'index')).filter(f => /^osoby-[a-z-]+\.html$/.test(f)).sort();
        expect(letters.length).toBeGreaterThan(1);

        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const file = await ctx.newPage();
        await file.goto(pathToFileURL(join(dir, 'out', 'index', letters[0])).href);
        const abc = file.locator('nav.sp-abc');
        await expect(abc).toBeVisible();
        const cur = abc.locator('[aria-current="page"]');
        const first = (await cur.textContent())!.trim();
        await expect(file.locator('.sp-abc-hint')).toHaveText('Search finds a name faster than the index.');
        // The pager's next letter: another file, its letter current.
        await file.locator('.sp-abc-pager .sp-abc-next').click();
        await expect(abc.locator('[aria-current="page"]')).not.toHaveText(first);
        expect(file.url()).toMatch(/\/index\/osoby-[a-z-]+\.html/);
        // A letter of the row: its file.
        const link = abc.locator('a.sp-abc-l').first();
        const letter = (await link.textContent())!.trim();
        await link.click();
        await expect(abc.locator('[aria-current="page"]')).toHaveText(letter);
        // A row's link leads to a person's file.
        const person = file.locator('section.sp-page a[href*="../people/"]').first();
        await person.click();
        await expect(file.locator('section.sp-page--person')).toBeVisible();
        await ctx.close();
    });
});

/** The toolbar fits the window: nothing past its right edge, the chip inside. */
async function chipFits(page: Page): Promise<void> {
    const chip = page.locator('#pages-bg-chip');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.pages-bg-s')).toBeVisible();
    await expect(chip.locator('.pages-bg-t')).toBeHidden();
    const box = (await chip.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('a large set of pages on a phone (1102 §7.2)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the time on this phone; Background; the short chip in the toolbar', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await expect(dialog.locator('.fp-est-time')).toHaveText(/^Saving takes about \d+ (s|min) on this phone/);
        await slowPages(page, 200);
        await dialog.locator('#book-open').click();
        const prog = dialog.locator('.fp-prog');
        await expect(prog.locator('.fp-prog-note')).toHaveText('Saving pauses when another app is opened.');
        const bg = prog.locator('.fp-prog-bg');
        await expect(bg.locator('.fp-l-phone')).toHaveText('Background');
        expect((await bg.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await bg.click();
        await expect(dialog).not.toHaveClass(/active/);
        await chipFits(page);
        await expect(page.locator('#pages-bg-chip .pages-bg-s')).toHaveText(/^\d+%$/);
        await page.locator('#pages-bg-chip').click();
        await expect(dialog.locator('.fp-prog')).toBeVisible();
        await dialog.locator('.fp-prog-cancel').click();
    });
});

test.describe('a large set of pages on a phone held sideways (1102 §7.2)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the short chip fits the toolbar', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await slowPages(page, 200);
        await dialog.locator('#book-open').click();
        await dialog.locator('.fp-prog .fp-prog-bg').click();
        await chipFits(page);
    });

    test('the side column with the large file and the option for people with a name and years: its top reachable, the buttons in view', async ({ page }) => {
        test.setTimeout(120_000);
        await setup(page, synthetic(1200), 'Smyslenov');
        const dialog = await openDialog(page);
        await expect(dialog.locator('.fp-min')).toBeVisible();
        const foot = dialog.locator('.book-dlg-foot');
        const f = (await foot.boundingBox())!;
        // The column scrolls from its top: nothing above it out of reach.
        expect((await dialog.locator('.fp-est').boundingBox())!.y).toBeGreaterThanOrEqual(f.y - 0.5);
        for (const b of [dialog.locator('#book-open'), dialog.locator('.fp-open')]) {
            const box = (await b.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(f.x);
            expect(box.x + box.width).toBeLessThanOrEqual(844);
            expect(box.y + box.height).toBeLessThanOrEqual(390);
        }
        await foot.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(dialog.locator('.fp-min')).toBeInViewport();
        await expect(dialog.locator('#book-open')).toBeInViewport({ ratio: 1 });
    });
});

test.describe('a large set of pages on a tablet (1102 §7.2)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('the short chip: the tree\'s and the focus person\'s names keep their room', async ({ page }) => {
        await setup(page);
        const dialog = await openDialog(page);
        await slowPages(page, 200);
        await dialog.locator('#book-open').click();
        await dialog.locator('.fp-prog .fp-prog-bg').click();
        // The short chip (the bar and the percentage), as on a phone.
        await chipFits(page);
        await page.locator('#pages-bg-chip').click();
        await dialog.locator('.fp-prog-cancel').click();
    });
});
