import { test, expect, Page, Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { openApp, card, cardAction } from './helpers.js';

/**
 * A large gift package is written to the page's own files (1127, spool.ts):
 * Chrome breaks Blobs made in its memory faster than it moves them to its
 * disk (a tree with gigabytes of photos: "network error"), so the archive
 * and its large parts go into the origin private file system as they are
 * made. Here the size it is for is set to 0 (`__STROM_SPOOL_FROM`): the
 * package of the demo family goes that way, its download is a whole ZIP,
 * the spool holds only the package's file, and the files a page left
 * behind (it is gone) are removed.
 */

const TODAY = new Date('2026-12-10T10:00:00');

async function reviewForDaniel(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(TODAY);
    await page.addInitScript(() => { (globalThis as { __STROM_SPOOL_FROM?: number }).__STROM_SPOOL_FROM = 0; });
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('.gift-review')).toBeVisible();
    return dialog;
}

/** The spool's folders and their files' sizes, as the page sees them. */
async function spoolFiles(page: Page): Promise<Record<string, Record<string, number>>> {
    return page.evaluate(async () => {
        type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
        const out: Record<string, Record<string, number>> = {};
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('strom-spool', { create: true }) as Dir;
        for await (const [pageName, pageDir] of root.entries()) {
            for await (const [name, h] of (pageDir as Dir).entries()) {
                const files: Record<string, number> = {};
                if (h.kind === 'directory') {
                    for await (const [f, fh] of (h as Dir).entries()) files[f] = (await (fh as FileSystemFileHandle).getFile()).size;
                } else {
                    files[name] = (await (h as FileSystemFileHandle).getFile()).size;
                }
                out[`${pageName}/${name}`] = files;
            }
        }
        return out;
    });
}

function hasPython(): boolean {
    try {
        execFileSync('python3', ['-V'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

test('a package written to the page\'s own files: a whole ZIP, only its file kept, a gone page\'s files removed', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const dialog = await reviewForDaniel(page);
    // What a page that is gone left behind (no lock holds it).
    await page.evaluate(async () => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('strom-spool', { create: true });
        const left = await (await root.getDirectoryHandle('gone-page', { create: true })).getDirectoryHandle('gift-1', { create: true });
        const w = await (await left.getFileHandle('1.part', { create: true })).createWritable();
        await w.write('left behind');
        await w.close();
    });

    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('#gift-next').click();
    const download = await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"] .gift-run-h')).toHaveText('The package is ready', { timeout: 60_000 });
    const path = testInfo.outputPath('package.zip');
    await download.saveAs(path);
    const size = statSync(path).size;
    expect(size).toBeGreaterThan(100_000);

    const spool = await spoolFiles(page);
    const folders = Object.keys(spool);
    expect(folders.some(f => f.startsWith('gone-page/'))).toBe(false);
    // One folder of this page's gift, holding the package's file alone (the app's, the book's, the GEDCOM's let go of).
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatch(/\/gift-\d+$/);
    expect(Object.values(spool[folders[0]])).toEqual([size]);

    if (hasPython()) {
        const script = [
            'import sys, zipfile, json',
            'z = zipfile.ZipFile(sys.argv[1])',
            'assert z.testzip() is None',
            'print(json.dumps([i.filename for i in z.infolist()]))',
        ].join('\n');
        const names: string[] = JSON.parse(execFileSync('python3', ['-I', '-c', script, path], { encoding: 'utf8' }));
        for (const re of [/\(app\)\.html$/, /\.ged$/, /book.*\.html$/i, /\.svg$/]) expect(names.some(n => re.test(n)), String(re)).toBe(true);
    }

    // The file's name again: the same file, still readable.
    const again = page.waitForEvent('download');
    await dialog.locator('.gift-done-name').click();
    const second = testInfo.outputPath('again.zip');
    await (await again).saveAs(second);
    expect(statSync(second).size).toBe(size);
});

test('at the start the files of a closed page are removed, a live page\'s kept (no output made)', async ({ page, context }) => {
    await openApp(page);
    // Another page of the app still open: it holds its lock while it lives.
    const other = await context.newPage();
    await other.goto(page.url());
    await other.evaluate(() => { void navigator.locks.request('strom-spool:live-page', () => new Promise<void>(() => { /* held */ })); });
    await page.evaluate(async () => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('strom-spool', { create: true });
        for (const name of ['gone-page', 'live-page']) {
            const dir = await (await root.getDirectoryHandle(name, { create: true })).getDirectoryHandle('gift-1', { create: true });
            const w = await (await dir.getFileHandle('1.part', { create: true })).createWritable();
            await w.write('a package');
            await w.close();
        }
    });
    expect(Object.keys(await spoolFiles(page)).sort()).toEqual(['gone-page/gift-1', 'live-page/gift-1']);
    await page.reload();
    await expect.poll(async () => Object.keys(await spoolFiles(page)).sort()).toEqual(['live-page/gift-1']);
    await other.close();
});
