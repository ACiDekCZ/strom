import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, card, cardAction } from './helpers.js';

/**
 * Give a family tree… → Create package when it goes wrong (spec 093 §8):
 * the browser running out of memory stops the making with "Without the app"
 * and "Try without photos", each making a smaller package at once; a
 * download the browser refuses keeps the package for "Download again"; near
 * the memory limit the question comes first and "Leave the photos out of
 * the package" makes it without them. The failures are staged by replacing
 * the app's own functions in the page (the app file, the object URL), no
 * test hook in the app.
 */

const TODAY = new Date('2026-12-10T10:00:00');

/** The paths of a ZIP's entries (its central directory). */
function zipPaths(buf: Buffer): string[] {
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('not a ZIP');
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        const nameLen = buf.readUInt16LE(at + 28);
        out.push(buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'));
        at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    }
    return out;
}

async function sampleOnDaniel(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(TODAY);
    await openApp(page);
    await page.evaluate(async () => {
        await window.Strom.UI.loadDemoTree();
        // A photo in the cut, so "photos" means something (fictional bytes).
        window.Strom.DataManager.updatePerson('demo_daniel' as never, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000) });
        await window.Strom.TreeRenderer.setFocus('demo_daniel' as never);
    });
    await expect(card(page, 'Daniel')).toBeVisible();
}

async function openOnReview(page: Page): Promise<Locator> {
    await cardAction(page, 'Daniel', 'gift-tree');
    const dialog = page.locator('#gift-modal');
    await expect(dialog).toHaveClass(/active/);
    await dialog.locator('#gift-nav [data-step="6"]').click();
    await expect(dialog.locator('.gift-review')).toBeVisible();
    return dialog;
}

/** The app's file fails with the browser's out-of-memory error: always, or only the first time. */
async function appRunsOutOfMemory(page: Page, once: boolean): Promise<void> {
    await page.evaluate((onlyOnce) => {
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: (...a: unknown[]) => Promise<Blob> };
        const real = exporter.buildFocusAppBlob.bind(exporter);
        let calls = 0;
        exporter.buildFocusAppBlob = (...a: unknown[]) => {
            calls++;
            if (!onlyOnce || calls === 1) return Promise.reject(new RangeError('Invalid string length'));
            return real(...a);
        };
    }, once);
}

async function expectOutOfMemory(dialog: Locator): Promise<void> {
    const run = dialog.locator('.gift-run[data-phase="oom"]');
    await expect(run.locator('.gift-run-h')).toHaveText('Making stopped: out of memory', { timeout: 60_000 });
    await expect(run.locator('.gift-lead')).toContainText('ran out of memory at the app');
    await expect(dialog.locator('[data-gk="run-no-app"]')).toHaveText('Without the app');
    await expect(dialog.locator('[data-gk="run-no-photos"]')).toHaveText('Try without photos');
    await expect(dialog.locator('[data-gk="run-close"]')).toBeVisible();
}

test('out of memory: "Try without photos" makes the package again without photos, remembered for the person', async ({ page }) => {
    test.setTimeout(90_000);
    await sampleOnDaniel(page);
    await appRunsOutOfMemory(page, true);
    const dialog = await openOnReview(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await dialog.locator('#gift-next').click();
    await expectOutOfMemory(dialog);
    expect(downloads).toBe(0);

    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('[data-gk="run-no-photos"]').click();
    const download = await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"] .gift-run-h')).toHaveText('The package is ready', { timeout: 60_000 });
    // The app is still in it; the photos are off in the settings kept for Daniel.
    const paths = zipPaths(readFileSync((await download.path())!));
    expect(paths.some(p => p.endsWith('Family tree (app).html'))).toBe(true);
    await dialog.locator('[data-gk="run-finish"]').click();
    await expect(dialog).not.toHaveClass(/active/);
    await cardAction(page, 'Daniel', 'gift-tree');
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await expect(dialog.locator('[data-gk="photos-off"]')).toHaveAttribute('aria-checked', 'true');
});

test('out of memory: "Without the app" makes the package again without the app', async ({ page }) => {
    test.setTimeout(90_000);
    await sampleOnDaniel(page);
    await appRunsOutOfMemory(page, false);
    const dialog = await openOnReview(page);
    await dialog.locator('#gift-next').click();
    await expectOutOfMemory(dialog);

    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await dialog.locator('[data-gk="run-no-app"]').click();
    const download = await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"]')).toBeVisible({ timeout: 60_000 });
    const paths = zipPaths(readFileSync((await download.path())!));
    expect(paths.some(p => p.endsWith('Family tree (app).html'))).toBe(false);
    expect(paths.some(p => p.endsWith('Start here.html'))).toBe(true);
});

test('a refused download keeps the package: "Download again" saves it without making it again', async ({ page }) => {
    test.setTimeout(90_000);
    await sampleOnDaniel(page);
    // The browser refuses the first saving of the ZIP.
    await page.evaluate(() => {
        const w = window as unknown as { __giftMade?: number };
        const real = URL.createObjectURL.bind(URL);
        let refused = false;
        URL.createObjectURL = (o: Blob | MediaSource) => {
            if (o instanceof Blob && o.type === 'application/zip' && !refused) {
                refused = true;
                throw new DOMException('Download blocked', 'SecurityError');
            }
            return real(o);
        };
        const exporter = window.Strom.AppExporter as unknown as { buildFocusAppBlob: (...a: unknown[]) => Promise<Blob> };
        const app = exporter.buildFocusAppBlob.bind(exporter);
        w.__giftMade = 0;
        exporter.buildFocusAppBlob = (...a: unknown[]) => { w.__giftMade!++; return app(...a); };
    });
    const dialog = await openOnReview(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await dialog.locator('#gift-next').click();
    const run = dialog.locator('.gift-run[data-phase="nodownload"]');
    await expect(run.locator('.gift-run-h')).toHaveText('The browser did not allow the download', { timeout: 60_000 });
    await expect(run.locator('.gift-lead')).toContainText('The package is ready (');
    await expect(dialog.locator('[data-gk="run-close"]')).toBeVisible();
    expect(downloads).toBe(0);

    const downloaded = page.waitForEvent('download');
    await dialog.locator('[data-gk="run-download"]').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('Family tree – Daniel Berg – 2026.zip');
    await expect(dialog.locator('.gift-run[data-phase="done"]')).toBeVisible();
    // Made once: the second try only saves the file.
    expect(await page.evaluate(() => (window as unknown as { __giftMade?: number }).__giftMade)).toBe(1);
});

test('near the memory limit the question comes first: Cancel makes nothing, "Leave the photos out" makes it without them', async ({ page }) => {
    test.setTimeout(90_000);
    await sampleOnDaniel(page);
    await page.evaluate(() => window.Strom.MemoryLimit.setLimit(30 * 1024 * 1024));
    const dialog = await openOnReview(page);
    const confirm = page.locator('#confirmation-modal');
    let downloads = 0;
    page.on('download', () => { downloads++; });

    await dialog.locator('#gift-next').click();
    await expect(confirm).toHaveClass(/active/);
    await expect(confirm.locator('#confirm-message')).toContainText('The package with photos (');
    await confirm.locator('#confirm-cancel-btn').click();
    await expect(confirm).not.toHaveClass(/active/);
    await expect(dialog.locator('.gift-review')).toBeVisible();
    await expect(dialog.locator('.gift-run')).toHaveCount(0);
    expect(downloads).toBe(0);

    await dialog.locator('#gift-next').click();
    await expect(confirm).toHaveClass(/active/);
    await confirm.getByText('Leave the photos out of the package').click();
    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await confirm.locator('#confirm-ok-btn').click();
    await downloaded;
    await expect(dialog.locator('.gift-run[data-phase="done"]')).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => window.Strom.MemoryLimit.setLimit(null));
    await dialog.locator('[data-gk="run-finish"]').click();
    await cardAction(page, 'Daniel', 'gift-tree');
    await dialog.locator('#gift-nav [data-step="4"]').click();
    await expect(dialog.locator('[data-gk="photos-off"]')).toHaveAttribute('aria-checked', 'true');
});
