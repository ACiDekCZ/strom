/**
 * A showcase file opened or dropped (spec 143 §4): told by its header, not
 * its name; "Opening the sample" with its name and size, then the same steps
 * as the link (a sample tree of its own, a second opening only switches). A
 * file that cannot be opened offers the small sample, never Try again. New
 * tree and the empty start offer the showcase above the small sample; a
 * standalone file (embedded mode) never downloads it — it links to the file
 * on the web and opens a downloaded one. All data is invented (the Horák
 * family from Dolní Lhota, e2e/fixtures/showcase).
 */
import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openApp, seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/showcase/strom-ukazka-cs.json', import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf-8');
const NAME = 'Ukázka – rod Horáků';

const treeCount = (page: Page): Promise<number> => page.evaluate(() => window.Strom.TreeManager.getTrees().length);
const activeTreeName = (page: Page): Promise<string> => page.evaluate(() => {
    const id = window.Strom.DataManager.getCurrentTreeId();
    return (id && window.Strom.TreeManager.getTreeMetadata(id)?.name) || '';
});

/** Notes every "Opening the sample" toast drawn (it may be gone again before a check sees it). */
async function watchOpeningToast(page: Page): Promise<void> {
    await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __opening: string[] }).__opening = seen;
        new MutationObserver(() => {
            for (const t of document.querySelectorAll('.showcase-opening-toast')) {
                const text = t.textContent ?? '';
                if (!seen.includes(text)) seen.push(text);
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
}

/** A file dragged over the window and dropped (`name`: the file's name, `body`: its text). */
async function dropFile(page: Page, name: string, body: string, opts: { overlayTitle?: string } = {}): Promise<void> {
    await page.evaluate(({ name, body }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([body], name, { type: 'application/json' }));
        (window as unknown as { __dt: DataTransfer }).__dt = dt;
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { name, body });
    if (opts.overlayTitle) {
        await expect(page.locator('#drop-overlay.active .drop-overlay-title')).toHaveText(opts.overlayTitle);
        await expect(page.locator('#drop-overlay.active .drop-overlay-sub'))
            .toHaveText('The sample file opens as a tree of its own; other trees stay unchanged.');
    }
    await page.evaluate(() => {
        const dt = (window as unknown as { __dt: DataTransfer }).__dt;
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
}

test.describe('in the app', () => {
    test.beforeEach(async ({ page }) => {
        await openApp(page);
    });

    test('a dropped showcase file opens as a sample tree, told by its header; dropped again it only switches', async ({ page }) => {
        const foreign: string[] = [];
        const origin = new URL(page.url()).origin;
        page.on('request', (req) => {
            const url = req.url();
            if (/^https?:/.test(url) && new URL(url).origin !== origin) foreign.push(url);
        });
        await watchOpeningToast(page);
        // Any name: the header says it.
        await dropFile(page, 'stazeno.json', FIXTURE, { overlayTitle: 'Drop here: open the sample' });
        await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(NAME);
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
        const opening = await page.evaluate(() => (window as unknown as { __opening: string[] }).__opening);
        expect(opening.some(t => t.includes('Opening the sample') && t.includes('stazeno.json') && /\d+ kB/.test(t))).toBe(true);
        const tree = await page.evaluate(() => {
            const t = window.Strom.TreeManager.getTreeMetadata(window.Strom.DataManager.getCurrentTreeId()!)!;
            return { sample: t.sample?.exportId, sendMode: t.research?.sendMode };
        });
        expect(tree).toEqual({ sample: 'showcase-cs', sendMode: 'off' });

        // Another tree opened, the same file dropped again: only switched back, no new tree.
        await page.evaluate(() => window.Strom.DataManager.createNewTree('Moje'));
        await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
        const trees = await treeCount(page);
        await dropFile(page, 'strom-ukazka-cs.json', FIXTURE);
        await expect.poll(() => activeTreeName(page)).toBe(NAME);
        expect(await treeCount(page)).toBe(trees);
        expect(foreign).toEqual([]);
    });

    test('once "The sample is open." says so, the tree takes a dropped file: no switch still holds edits', async ({ page }) => {
        // The moment the toast is drawn, the same file is dropped again: it is taken (only switched to,
        // nothing made), never refused as "being switched" (the toast came inside the switch's last moments).
        await page.evaluate((body) => {
            const w = window as unknown as { __locked: string[]; __droppedAtToast: boolean };
            w.__locked = [];
            w.__droppedAtToast = false;
            new MutationObserver(() => {
                for (const t of document.querySelectorAll('.toast[data-kind="edit-lock"]')) {
                    const text = t.textContent ?? '';
                    if (!w.__locked.includes(text)) w.__locked.push(text);
                }
                if (w.__droppedAtToast) return;
                const opened = Array.from(document.querySelectorAll('.toast')).some(t => t.textContent?.includes('The sample is open.'));
                if (!opened) return;
                w.__droppedAtToast = true;
                const dt = new DataTransfer();
                dt.items.add(new File([body], 'strom-ukazka-cs.json', { type: 'application/json' }));
                window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
            }).observe(document.body, { childList: true, subtree: true, characterData: true });
        }, FIXTURE);
        await watchOpeningToast(page);
        await dropFile(page, 'stazeno.json', FIXTURE);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __droppedAtToast: boolean }).__droppedAtToast)).toBe(true);
        // The second drop is read ("Opening the sample" with its name) and done.
        await expect.poll(() => page.evaluate(() => (window as unknown as { __opening: string[] }).__opening
            .some(t => t.includes('strom-ukazka-cs.json')))).toBe(true);
        await expect(page.locator('.showcase-opening-toast')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __locked: string[] }).__locked)).toEqual([]);
        // One sample tree, the one open: the second drop only switched.
        expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().filter(t => t.sample?.exportId === 'showcase-cs').length)).toBe(1);
        expect(await activeTreeName(page)).toBe(NAME);
    });

    test('a showcase file that cannot be opened says so and offers the small sample, without Try again', async ({ page }) => {
        const before = await treeCount(page);
        const newer = JSON.stringify({ ...JSON.parse(FIXTURE), format: 2 });
        await dropFile(page, 'strom-ukazka-cs.json', newer);
        const dialog = page.locator('#confirmation-modal.dialog-warning.active');
        await expect(dialog.locator('h2')).toHaveText('The sample file cannot be opened');
        await expect(dialog).toContainText('newer version of the app');
        await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Close' }).click();
        expect(await treeCount(page)).toBe(before);

        const broken = JSON.stringify({ ...JSON.parse(FIXTURE), exportId: '' });
        await dropFile(page, 'strom-ukazka-cs.json', broken);
        await expect(dialog.locator('h2')).toHaveText('The sample file cannot be opened');
        await dialog.getByRole('button', { name: 'Open the small sample' }).click();
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Sample: the Berg family');
    });

    test('New tree › From JSON opens a showcase file as a sample tree; New tree offers the showcase above the small sample', async ({ page }) => {
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await page.locator('#tree-manager-modal .tree-manager-new-btn').click();
        const menu = page.locator('#new-tree-menu-modal');
        await expect(menu).toBeVisible();
        const titles = await menu.locator('.menu-option .option-title').allTextContents();
        const at = titles.indexOf('Try the sample with research');
        expect(titles.slice(at - 1, at + 2)).toEqual(['From JSON', 'Try the sample with research', 'Try the small sample']);
        await expect(menu.locator('#new-tree-showcase-desc')).toHaveText(/^A made-up family with view-only research · \d+\.\d MB download$/);
        await expect(menu.locator('.menu-option', { hasText: 'Try the small sample' }).locator('.option-desc'))
            .toHaveText('A made-up family that shows what a tree can hold · works offline too');

        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            menu.locator('.menu-option', { hasText: 'From JSON' }).click(),
        ]);
        await chooser.setFiles(FIXTURE_PATH);
        await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(NAME);
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
        await expect(menu).toBeHidden();
    });

    test('the empty start offers the showcase with research above the small sample; the row downloads it', async ({ page }) => {
        const links = page.locator('#empty-state .empty-state-actions button.link');
        await expect(links).toHaveText(['Try the sample with research →', 'Try the small sample →']);
        await page.route('**/demo/cs/strom-ukazka-cs.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }));
        await page.route('**/demo/en/strom-ukazka-en.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: FIXTURE }));
        await links.first().click();
        await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
    });
});

test.describe('in a standalone file', () => {
    test('nothing is downloaded: the dialog links to the file on the web and opens a downloaded one', async ({ page }, testInfo) => {
        const out = testInfo.outputPath('strom.html');
        copyFileSync(resolve('e2e-dist/strom.html'), out);
        await seedResearchPromoSeen(page);
        await seedWhatsNewSeen(page);
        await seedSetting(page, 'fileCopyReminders', false);
        await seedSetting(page, 'onThisDay', false);
        const fetched: string[] = [];
        page.on('request', (req) => { if (req.url().includes('/demo/')) fetched.push(req.url()); });
        await page.goto(`${pathToFileURL(out).href}?demo=cs`);
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);

        // ?demo= in a standalone file: the same dialog, no download.
        const dialog = page.locator('#confirmation-modal.active');
        await expect(dialog.locator('h2')).toHaveText('Sample with research');
        await expect(dialog.getByRole('button', { name: 'Download the sample file (stromapp.info) ↗' })).toBeVisible();
        await dialog.getByRole('button', { name: 'Close' }).click();

        // The New tree row says it opens from a downloaded file.
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await page.locator('#tree-manager-modal .tree-manager-new-btn').click();
        const menu = page.locator('#new-tree-menu-modal');
        await expect(menu.locator('#new-tree-showcase-desc'))
            .toHaveText('From a downloaded sample file (.json) · a standalone file does not download it');
        await menu.locator('.menu-option', { hasText: 'Try the sample with research' }).click();
        await expect(menu).toBeHidden();
        await expect(dialog.locator('h2')).toHaveText('Sample with research');
        await expect(dialog).toContainText('A standalone file does not download the sample.');
        await expect(dialog.locator('#confirm-buttons button')).toHaveText(['Close', 'Open the small sample', 'Open a downloaded sample file…']);
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            dialog.getByRole('button', { name: 'Open a downloaded sample file…' }).click(),
        ]);
        await chooser.setFiles(FIXTURE_PATH);
        await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
        await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(NAME);
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
        expect(fetched).toEqual([]);
    });
});
