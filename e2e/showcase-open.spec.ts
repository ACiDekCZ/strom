/**
 * The showcase opened from `?demo=<lang>` (spec 143 §2, §3): downloaded with
 * its progress, opened as a sample tree of its own (the tag, the toast), the
 * parameter gone from the address at once; a second opening only switches;
 * Cancel makes nothing; a server error offers the small sample; a newer
 * version on the web is offered once and replaces the tree's data. Nothing
 * leaves the app's origin. All data is invented (the Horák family from
 * Dolní Lhota, e2e/fixtures/showcase).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';

const FIXTURE = readFileSync(new URL('./fixtures/showcase/strom-ukazka-cs.json', import.meta.url), 'utf-8');
const FILE_ROUTE = '**/demo/cs/strom-ukazka-cs.json';
const VERSION_ROUTE = '**/demo/cs/VERSION';
const NAME = 'Ukázka – rod Horáků';

/** The fixture as a newer showcase version (Anna got a middle name). */
function newerFixture(version: string): string {
    const file = JSON.parse(FIXTURE) as { sampleVersion: string; tree: { text: string } };
    file.sampleVersion = version;
    file.tree.text = file.tree.text.replace('1 NAME Anna /Horáková/', '1 NAME Anna Marie /Horáková/');
    return JSON.stringify(file);
}

async function serveFile(page: Page, body: string): Promise<{ count: () => number }> {
    let n = 0;
    await page.route(FILE_ROUTE, (route) => {
        n++;
        return route.fulfill({ status: 200, contentType: 'application/json', body });
    });
    return { count: () => n };
}

/** The app opened on `?demo=cs` (the seeds of openApp kept). */
async function openDemo(page: Page): Promise<void> {
    await page.goto('/strom.html?demo=cs');
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

const treeCount = (page: Page): Promise<number> => page.evaluate(() => window.Strom.TreeManager.getTrees().length);
const activeSample = (page: Page): Promise<{ name: string; version: string | null }> => page.evaluate(() => {
    const id = window.Strom.DataManager.getCurrentTreeId();
    const t = id ? window.Strom.TreeManager.getTreeMetadata(id) : null;
    return { name: t?.name ?? '', version: t?.sample?.sampleVersion ?? null };
});

test.beforeEach(async ({ page }) => {
    // The app's own empty start first (its seeds), then the showcase link.
    await openApp(page);
});

test('?demo=cs downloads the showcase and opens it as a sample tree; a second link only switches to it', async ({ page }) => {
    const file = await serveFile(page, FIXTURE);
    const foreign: string[] = [];
    const origin = new URL(page.url()).origin;
    page.on('request', (req) => {
        const url = req.url();
        if (/^https?:/.test(url) && new URL(url).origin !== origin) foreign.push(url);
    });
    const before = await treeCount(page);
    await openDemo(page);

    await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(NAME);
    await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
    // The parameter left the address at once (a reload never downloads again).
    expect(new URL(page.url()).searchParams.has('demo')).toBe(false);
    expect(await treeCount(page)).toBeLessThanOrEqual(before + 1);
    const tree = await page.evaluate(() => {
        const id = window.Strom.DataManager.getCurrentTreeId()!;
        const t = window.Strom.TreeManager.getTreeMetadata(id)!;
        const persons = Object.values(window.Strom.DataManager.getData().persons);
        return { sample: t.sample?.exportId, sendMode: t.research?.sendMode, research: t.research?.id, people: persons.length };
    });
    expect(tree).toEqual({ sample: 'showcase-cs', sendMode: 'off', research: '943fce29-c1c6-5433-8031-96ce4bbbcd8d', people: 5 });

    // Another tree opened, then the link again: only switched back, nothing downloaded, no new tree.
    await page.evaluate(() => window.Strom.DataManager.createNewTree('Moje'));
    const trees = await treeCount(page);
    await openDemo(page);
    await expect.poll(() => activeSample(page).then(s => s.name)).toBe(NAME);
    expect(await treeCount(page)).toBe(trees);
    expect(file.count()).toBe(1);
    await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toHaveCount(0);
    // Nothing went anywhere but the app's own origin (no research, no bridge).
    expect(foreign).toEqual([]);
});

test('Cancel stops the download and makes no tree', async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(FILE_ROUTE, async (route: Route) => {
        await held;
        try { await route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }); } catch { /* the page stopped it */ }
    });
    const before = await page.evaluate(() => window.Strom.TreeManager.getTrees().map(t => t.id));
    await openDemo(page);
    const toast = page.locator('.toast--progress', { hasText: 'Downloading the sample' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.toast', { hasText: 'The sample download was cancelled.' })).toBeVisible();
    release();
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().map(t => t.id))).toEqual(before);
});

test('a server error says why and opens the small sample instead', async ({ page }) => {
    await page.route(FILE_ROUTE, (route) => route.fulfill({ status: 503, body: 'busy' }));
    await openDemo(page);
    const dialog = page.locator('#confirmation-modal.dialog-warning.active');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('The sample did not download');
    await expect(dialog).toContainText('503');
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Open the small sample' }).click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Sample: the Berg family');
});

test('a newer showcase on the web is offered once and replaces the tree\'s data, the tree kept', async ({ page }) => {
    await serveFile(page, FIXTURE);
    await openDemo(page);
    await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
    const id = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId());

    // The web has 3.34.0 now.
    await page.unroute(FILE_ROUTE);
    await serveFile(page, newerFixture('3.34.0'));
    await page.route(VERSION_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: '3.34.0\n' }));
    await openDemo(page);
    const offer = page.locator('.toast.toast--actions-below', { hasText: 'A newer sample is available (3.34.0).' });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Not now' }).click();
    // Offered once per version: the next link says nothing more.
    await openDemo(page);
    await expect.poll(() => activeSample(page).then(s => s.name)).toBe(NAME);
    await expect(page.locator('.toast', { hasText: 'A newer sample is available' })).toHaveCount(0);

    // Kept in the tree's ⋯ in Manage trees.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    const row = manager.locator('.tree-manager-item', { hasText: NAME });
    await row.locator('.tree-row-menu-btn').click();
    const item = row.locator('.tree-row-menu [data-action="sampleUpdate"]');
    await expect(item).toHaveText('Update the sample (3.34.0)…');
    await item.click();
    const confirm = page.locator('#confirmation-modal.active');
    await expect(confirm).toContainText('3.34.0');
    await confirm.getByRole('button', { name: 'Update' }).click();
    await expect(page.locator('.toast', { hasText: 'The sample is updated to version 3.34.0.' })).toBeVisible();

    const after = await page.evaluate(() => ({
        id: window.Strom.DataManager.getCurrentTreeId(),
        anna: Object.values(window.Strom.DataManager.getData().persons).some(p => p.firstName === 'Anna Marie'),
    }));
    expect(after).toEqual({ id, anna: true });
    expect((await activeSample(page)).version).toBe('3.34.0');
});

test('a computer in de: the showcase\'s long name beside the tag is not cut to the squeezed 56 px (the research row is tight)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serveFile(page, FIXTURE);
    await openDemo(page);
    await expect(page.locator('#current-tree-tag .tree-sample-tag')).toBeVisible();
    await page.evaluate(() => {
        const S = window.Strom;
        S.UI.setLanguage('de' as never);
        S.TreeManager.renameTree(S.DataManager.getCurrentTreeId()!, 'Beispiel – Familie Horák-Krejčíová');
        S.UI.updateTreeSwitcher();
    });
    await expect(page.locator('#current-tree-tag .tree-sample-tag')).toHaveText('Beispiel');
    // The name may give up the tag's extra room (210 → 130 px), never fall to the squeezed cap.
    await expect(page.locator('.toolbar')).not.toHaveClass(/toolbar-squeeze-name/);
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('current-tree-name')!.getBoundingClientRect().width))).toBeGreaterThanOrEqual(125);
});
