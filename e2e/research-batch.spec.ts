import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, openResearchMenu, poll, block, BRIDGE2 } from './research-bridge.js';

/**
 * "Add materials…" (C2): a folder of files for the research as one batch —
 * choose, review (system files and programs left out, folders open only for
 * them), send with the batch's headers, close it, the summary; an unfinished
 * batch remembered; a drop of files opens the review. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const BATCH_ACCEPTS = {
    sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true },
        estimate: { filesPerTask: 25, perTask: 1, currency: 'USD', basis: 'typical' } },
};

/** Files with their folder paths, made in the page and handed to the open wizard. */
async function addFiles(page: Page, paths: string[]): Promise<void> {
    await page.evaluate((list) => {
        const files = list.map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' }) }));
        (window.Strom.UI as any).addBatchFiles(files);
    }, paths);
}

test.describe('Add materials', () => {
    test.use({ viewport: DESKTOP });

    test('a folder: reviewed, sent as one batch with its paths, closed; the summary', { tag: '@smoke' }, async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await openResearchMenu(page);
        await page.locator('#research-item-batch').click();
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('h2')).toHaveText('Add materials to the research');
        await expect(dialog.locator('.batch-step.is-active')).toHaveText('Choose');
        await expect(dialog.locator('[data-act="next"]')).toBeDisabled();

        await addFiles(page, ['Krabice/Dopisy/1946.jpg', 'Krabice/Dopisy/1947.jpg', 'Krabice/.DS_Store', 'Krabice/setup.exe', 'Krabice/foto.jpg']);
        // Review: the folder is open for what is left out; the rest folded.
        await expect(dialog.locator('.batch-step.is-active')).toHaveText('Review');
        await expect(dialog.locator('.batch-list-title')).toHaveText('Krabice');
        await expect(dialog.locator('.batch-list-sub')).toContainText('5 files');
        await expect(dialog.locator('.batch-list-sub')).toContainText('2 unticked');
        const ds = dialog.locator('.batch-file', { hasText: '.DS_Store' });
        await expect(ds.locator('.batch-reason')).toHaveText('system file');
        await expect(ds.locator('input')).toBeEnabled();
        const exe = dialog.locator('.batch-file', { hasText: 'setup.exe' });
        await expect(exe.locator('.batch-reason')).toContainText('program');
        await expect(exe.locator('input')).toBeDisabled();
        await expect(dialog.locator('.batch-folder', { hasText: 'Dopisy' })).toHaveAttribute('aria-expanded', 'false');
        await expect(dialog.locator('.batch-more')).toContainText('1 more file');
        await expect(dialog.locator('.batch-foot-note')).toContainText('3 files will be sent');

        await dialog.locator('[data-act="next"]').click();
        await expect(dialog.locator('.batch-confirm-title')).toHaveText('Send to the research?');
        await expect(dialog.locator('.batch-confirm-sum')).toContainText('Krabice · 3 files');
        await expect(dialog.locator('.batch-cost-row')).toContainText('about $1.00');
        await dialog.getByRole('button', { name: 'Send 3 files' }).click();

        await expect(dialog.locator('.batch-confirm-title')).toContainText('Batch “Krabice” is in the research');
        await expect(dialog.locator('.batch-done-row').first()).toContainText('3');
        expect(b.mediaPuts).toHaveLength(3);
        const ids = new Set(b.mediaPuts.map(p => p.headers['x-strom-batch']));
        expect(ids.size).toBe(1);
        expect(b.mediaPuts.map(p => p.headers['x-strom-path']).sort()).toEqual(['Krabice/Dopisy/1946.jpg', 'Krabice/Dopisy/1947.jpg', 'Krabice/foto.jpg']);
        expect(b.batchDone).toHaveLength(1);
        expect(b.batchDone![0].body).toMatchObject({ name: 'Krabice', files: 3 });
        // Nothing left unfinished.
        expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-batch:')))).toEqual([]);
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toHaveCount(0);
    });

    test('a file the research already has: skipped, the summary says how many it had; a small batch costs at most one task', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
        // The research has a.jpg (its hash, as the page makes it).
        const sha = await page.evaluate(async () => {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('obsah Krabice/a.jpg'));
            return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
        });
        b.mediaKnown.set(sha, 'I0007');
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await expect(dialog.locator('.batch-cost-row')).toContainText('at most about $1.00');
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        await expect(dialog.locator('.batch-done-row', { hasText: 'Already in the research' })).toContainText('1');
        expect(b.mediaPuts).toHaveLength(1);
        expect(b.batchDone![0].body).toMatchObject({ files: 2 });
    });

    test('an unfinished batch: the block says so; Continue… opens the wizard with the banner; Discard forgets it', async ({ page }) => {
        await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => {
            const treeId = window.Strom.TreeManager.getActiveTreeId();
            localStorage.setItem(`strom-batch:${treeId}`, JSON.stringify({ id: '4f1c0000-aaaa', name: 'Krabice', total: 214, done: 80, bytes: 1, startedAt: new Date().toISOString() }));
        });
        await openResearchMenu(page);
        const line = block(page).locator('.batch-line');
        await expect(line).toContainText('Unfinished batch “Krabice”');
        await expect(line).toContainText('80 of 214 sent');
        await line.getByRole('menuitem', { name: 'Continue…' }).click();
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-banner')).toContainText('80 of 214 files sent');
        await dialog.locator('.batch-banner').getByRole('button', { name: 'Discard' }).click();
        await expect(dialog.locator('.batch-banner')).toHaveCount(0);
        expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-batch:')))).toEqual([]);
    });

    test('the research not running: the wizard says so instead of the picker', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        b.down = true;
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-drop.is-down')).toContainText("The research isn't running");
        await expect(dialog.locator('[data-act="pick-files"]')).toHaveCount(0);
    });

    test('files dropped onto the window open the review', async ({ page }) => {
        await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => {
            const dt = new DataTransfer();
            dt.items.add(new File(['a'], 'dopis.jpg', { type: 'image/jpeg' }));
            dt.items.add(new File(['b'], 'foto.jpg', { type: 'image/jpeg' }));
            window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        });
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-step.is-active')).toHaveText('Review');
        await expect(dialog.locator('.batch-list-sub')).toContainText('2 files');
    });

    test('the research stops answering: paused, said why; Continue once it runs goes on and closes the batch; Hide shows the line', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        b.down = true;
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Paused');
        await expect(dialog.locator('.batch-paused-note')).toContainText('The research stopped responding');
        // Hidden: the block tells how far it is, with Show.
        await dialog.getByRole('button', { name: 'Hide' }).click();
        await expect(dialog).toHaveCount(0);
        await openResearchMenu(page);
        await expect(block(page).locator('.batch-line')).toContainText('Sending batch “Krabice”');
        await block(page).locator('.batch-line').getByRole('menuitem', { name: 'Show' }).click();
        b.down = false;
        await dialog.getByRole('button', { name: 'Continue' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        expect(b.mediaPuts).toHaveLength(2);
        expect(b.batchDone).toHaveLength(1);
    });

    /** Three files chosen, reviewed, sent; `before` runs right before Send. */
    async function sendThree(page: Page, before: () => void = () => {}): Promise<void> {
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg', 'Krabice/c.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        before();
        await dialog.getByRole('button', { name: 'Send 3 files' }).click();
    }

    /** The research hands over its new address (as a ?live= does), remembered for its tree. */
    async function newAddress(page: Page): Promise<void> {
        await page.evaluate((base) => { void window.Strom.UI.startLiveFollow(base); }, BRIDGE2);
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('strom-research-bridge:'))!)!).base)).toBe(BRIDGE2);
    }

    for (const refusal of [404, 403]) {
        const how = refusal === 404 ? '404 without a body, as Strom Research answers an old token' : '403';
        test(`the research started again with a new token in the middle of a batch (${how}): paused, after the new connection Continue finishes it, no files chosen again, nothing refused (N20, N37)`, async ({ page }) => {
            const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, tokenRefusal: refusal });
            await openResearch(page, { media: true });
            await poll(page);
            const dialog = page.locator('#batch-modal');
            // The first file goes; the token changes right before the second one's PUT.
            await sendThree(page, () => { b.rotateAt = 1; });
            await expect(dialog.locator('.batch-progress-title')).toHaveText('Paused');
            await expect(dialog.locator('.batch-paused-note')).toContainText('The research stopped responding');
            await expect(dialog.locator('.batch-refused')).toHaveCount(0);
            // Only the first file taken (the second one's PUT turned down at the old address); not closed there.
            expect(b.mediaPuts.map(p => p.headers['x-strom-path'])).toEqual(['Krabice/a.jpg']);
            expect(b.batchDone ?? []).toHaveLength(0);
            await newAddress(page);
            await dialog.getByRole('button', { name: 'Continue' }).click();
            await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
            // The second and third file to the new address, the batch closed there; nothing said refused.
            const taken = b.mediaPuts.slice(1);
            expect(taken).toHaveLength(2);
            expect(taken.map(p => p.headers['x-strom-path']).sort()).toEqual(['Krabice/b.jpg', 'Krabice/c.jpg']);
            expect(b.batchDone).toHaveLength(1);
            expect(b.seen!.filter(x => x.startsWith('POST /batch/'))).toHaveLength(1);
            await expect(dialog.locator('.batch-done-row.is-warn')).toHaveCount(0);
            await expect(dialog.locator('.batch-refused')).toHaveCount(0);
            await expect(dialog.locator('.batch-done-row', { hasText: 'Received' })).toContainText('3');
        });
    }

    test('the research started again with a new token before the batch is closed: paused, Continue closes it at the new address (N37)', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        const dialog = page.locator('#batch-modal');
        await sendThree(page, () => { b.rotateAt = 'done'; });
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Paused');
        await expect(dialog.locator('.batch-paused-note')).toContainText('The research stopped responding');
        expect(b.mediaPuts).toHaveLength(3);
        expect(b.batchDone ?? []).toHaveLength(0);
        await newAddress(page);
        await dialog.getByRole('button', { name: 'Continue' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        // Closed once, at the new address; no file sent again.
        expect(b.batchDone).toHaveLength(1);
        expect(b.mediaPuts).toHaveLength(3);
        await expect(dialog.locator('.batch-done-row', { hasText: 'Received' })).toContainText('3');
        await expect(dialog.locator('.batch-done-row', { hasText: 'Tasks' })).toContainText('1');
    });

    test('a 404 with the research still answering at its address (a person it does not have): the file is refused, the batch is not paused (N37)', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, mediaPutStatus: 404 });
        await openResearch(page, { media: true });
        await poll(page);
        const dialog = page.locator('#batch-modal');
        await sendThree(page);
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        expect(b.mediaPuts).toHaveLength(3);
        expect(b.batchDone).toHaveLength(1);
        await expect(dialog.locator('.batch-refused summary')).toContainText('3');
        await expect(dialog.locator('.batch-refused li')).toHaveText(['Krabice/a.jpg: no', 'Krabice/b.jpg: no', 'Krabice/c.jpg: no']);
    });

    test('a research that takes no batches: no "Add materials…"', async ({ page }) => {
        await fakeBridge(page, { accepts: { ...BATCH_ACCEPTS, media: { max: 500 * 1024 * 1024, region: true } } });
        await openResearch(page, { media: true });
        await poll(page);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-batch')).toHaveCount(0);
    });
});
