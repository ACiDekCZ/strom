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
        await openResearchMenu(page, { expandMore: true });
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
        // An older research (no media.queued): no Prefer, each file answered with its record (200) as before.
        expect(b.mediaPuts.every(p => p.headers['prefer'] === undefined)).toBe(true);
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
        // A research without media.known / media.queued: asked file by file, sent as before.
        expect(b.mediaAsks).toHaveLength(2);
        expect(b.knownAsks ?? []).toEqual([]);
        expect(b.mediaPuts[0].headers['prefer']).toBeUndefined();
    });

    test('a research that writes a batch as it is closed (media.known, media.queued): one ask for all files, each sent once with 202 and nothing asked after it, what became of each from the close', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, features: ['media.known', 'media.queued', 'media.codes'] });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg', 'Krabice/c.jpg', 'Krabice/d.jpg']);
        const shaOf = (path: string): Promise<string> => page.evaluate(async (p) => {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`obsah ${p}`));
            return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
        }, path);
        const [a, bb, c, d] = await Promise.all(['Krabice/a.jpg', 'Krabice/b.jpg', 'Krabice/c.jpg', 'Krabice/d.jpg'].map(shaOf));
        // a: the research has it; b: came already and waits in its queue (another window); c: refused as the batch is written.
        b.mediaKnown.set(a, 'I0007');
        b.mediaQueued = new Map([[bb, { batch: 'another-window-batch', path: 'b.jpg' }]]);
        b.queuedRefuse = new Map([[c, { code: 'media.something-new', why: 'the file is gone' }]]);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        const seenBefore = (b.seen ?? []).length;
        const gedBefore = b.treeGets ?? 0;
        await dialog.getByRole('button', { name: 'Send 4 files' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        // One ask of media/known for the whole batch, none file by file.
        expect(b.knownAsks).toEqual([[a, bb, c, d]]);
        expect(b.mediaAsks).toEqual([]);
        // Only the two new files sent, each with Prefer: respond-async.
        expect(b.mediaPuts.map(p => p.sha)).toEqual([c, d]);
        expect(b.mediaPuts.every(p => p.headers['prefer'] === 'respond-async')).toBe(true);
        // Nothing asked after a 202: from the first PUT to the close only the files went (no media asks, no tree read).
        const during = (b.seen ?? []).slice(seenBefore);
        const firstPut = during.findIndex(x => x.startsWith('PUT /media/'));
        const close = during.findIndex(x => /^POST \/batch\/.+\/done$/.test(x));
        expect(firstPut).toBeGreaterThanOrEqual(0);
        expect(close).toBeGreaterThan(firstPut);
        expect(during.slice(firstPut, close).filter(x => !x.startsWith('PUT /media/') && !/^GET \/status/.test(x))).toEqual([]);
        expect(b.treeGets ?? 0).toBe(gedBefore);
        expect(b.batchDone).toHaveLength(1);
        expect(b.batchDone![0].body).toMatchObject({ files: 4 });
        // The summary: d received, a already there, c refused with the research's sentence (its code unknown here).
        await expect(dialog.locator('.batch-done-row').first()).toContainText('1');
        await expect(dialog.locator('.batch-done-row', { hasText: 'Already in the research' })).toContainText('1');
        await expect(dialog.locator('.batch-done-row.is-warn')).toContainText('Krabice/c.jpg');
        await expect(dialog.locator('.batch-done-row.is-warn')).toContainText('the file is gone');
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

    test('a phone: while it runs, Cancel, Hide and Pause stack in one column inside the screen', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
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
        const footer = dialog.locator('.batch-footer');
        expect(await footer.evaluate(f => f.scrollWidth - f.clientWidth)).toBeLessThanOrEqual(0);
        for (const act of ['cancel-run', 'hide', 'resume']) {
            const box = (await footer.locator(`[data-act="${act}"]`).boundingBox())!;
            expect(box.x, act).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, act).toBeLessThanOrEqual(390);
        }
    });

    test('Pause says Pausing… until the file on its way is in, then Paused; Cancel batch says Cancelling… until the batch is closed', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        let release!: () => void;
        let held = new Promise<void>(r => { release = r; });
        await page.route(url => url.pathname.includes('/media/'), async route => {
            if (route.request().method() === 'PUT') await held;
            await route.fallback();
        });
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg', 'Krabice/c.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await dialog.getByRole('button', { name: 'Send 3 files' }).click();
        await expect(dialog.locator('.batch-now')).toBeVisible();
        const pause = dialog.locator('[data-act="pause"]');
        await pause.click();
        // The file on its way still goes: not "Paused" yet, the button says it is pausing (through the redraws).
        await expect(pause).toHaveAttribute('data-busy', 'busy');
        await expect(pause).toContainText('Pausing…');
        await page.waitForTimeout(600);
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Sending to the research');
        await expect(dialog.locator('[data-act="pause"]')).toHaveAttribute('data-busy', 'busy');
        release();
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Paused');
        expect(b.mediaPuts).toHaveLength(1);

        held = new Promise<void>(r => { release = r; });
        await dialog.locator('[data-act="resume"]').click();
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Sending to the research');
        await dialog.locator('[data-act="cancel-run"]').click();
        await page.locator('#confirm-ok-btn').click();
        const cancel = dialog.locator('[data-act="cancel-run"]');
        await expect(cancel).toHaveAttribute('data-busy', 'busy');
        await expect(cancel).toContainText('Cancelling…');
        release();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        expect(b.batchDone).toHaveLength(1);
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
        // The one bar (2h): "k of n" at the right of the size, a 4 px paused bar.
        await expect(dialog.locator('.batch-prog .prog-k')).toHaveText(/^\d of 2$/);
        const bar = dialog.locator('.batch-prog .bar.is-paused');
        await expect(bar).toHaveCount(1);
        expect(await bar.evaluate(el => getComputedStyle(el).height)).toBe('4px');
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

    test('a research that gives codes (media.codes): a refused file is said in the app\'s language with its params, not the research\'s sentence; a 404 of its own does not pause the batch (L3, N37)', async ({ page }) => {
        const b = await fakeBridge(page, {
            accepts: BATCH_ACCEPTS, features: ['media.codes'], mediaPutStatus: 404,
            mediaPutReply: { error: 'no person P0042 in this research', code: 'media.no-person', text: 'no person P0042 in this research', params: { person: 'P0042' } },
        });
        await openResearch(page, { media: true });
        await poll(page);
        const dialog = page.locator('#batch-modal');
        await sendThree(page);
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        expect(b.batchDone).toHaveLength(1);
        await expect(dialog.locator('.batch-refused li')).toHaveText([
            'Krabice/a.jpg: the research has no person P0042', 'Krabice/b.jpg: the research has no person P0042', 'Krabice/c.jpg: the research has no person P0042',
        ]);
    });

    test('a code the app does not know, and a research without media.codes: the research\'s own sentence, as before (L3)', async ({ page }) => {
        const b = await fakeBridge(page, {
            accepts: BATCH_ACCEPTS, features: ['media.codes'], mediaPutStatus: 422,
            mediaPutReply: { error: 'something new went wrong', code: 'media.something-new', text: 'something new went wrong' },
        });
        await openResearch(page, { media: true });
        await poll(page);
        const dialog = page.locator('#batch-modal');
        await sendThree(page);
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        // An unknown code: the research's sentence, as before.
        await expect(dialog.locator('.batch-refused li').first()).toHaveText('Krabice/a.jpg: something new went wrong');
        await dialog.getByRole('button', { name: 'Done' }).click();
        // An older research (no media.codes): its sentence even with a code.
        b.features = [];
        await poll(page);
        b.mediaPutReply = { error: 'žádná osoba P0042', code: 'media.no-person', params: { person: 'P0042' } };
        b.mediaPutStatus = 404;
        await sendThree(page);
        await expect(dialog.locator('.batch-confirm-title')).toContainText('is in the research');
        await expect(dialog.locator('.batch-refused li').first()).toHaveText('Krabice/a.jpg: žádná osoba P0042');
    });

    test('a research that gives codes started again with a new token in the middle of a batch: paused, nothing refused (L3, N37)', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, features: ['media.codes'] });
        await openResearch(page, { media: true });
        await poll(page);
        const dialog = page.locator('#batch-modal');
        await sendThree(page, () => { b.rotateAt = 1; });
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Paused');
        await expect(dialog.locator('.batch-refused')).toHaveCount(0);
        expect(b.batchDone ?? []).toHaveLength(0);
    });

    test('a research that takes no batches: no "Add materials…"', async ({ page }) => {
        await fakeBridge(page, { accepts: { ...BATCH_ACCEPTS, media: { max: 500 * 1024 * 1024, region: true } } });
        await openResearch(page, { media: true });
        await poll(page);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-batch')).toHaveCount(0);
    });

    test('a research waiting for its agent: the batch is stored as it is, no privacy, cost or sorting said (K4.5)', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: { ...BATCH_ACCEPTS, mode: 'research', agentHere: false }, features: ['batch.kept'] });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await expect(dialog.locator('.batch-confirm-title')).toHaveText('Send to the research?');
        await expect(dialog.locator('.material-box')).toHaveText(/The files are stored in the research as they are, outside git\./);
        await expect(dialog.locator('.batch-cost-row')).toHaveCount(0);
        await expect(dialog).not.toContainText(/Privacy|model provider|Estimated cost/);
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('Batch “Krabice” is in the research');
        await expect(dialog.locator('.batch-done-text')).toHaveText('The files are stored in the research.');
        await expect(dialog).not.toContainText(/agent will sort|Sorting tasks/);
        expect(b.mediaPuts).toHaveLength(2);
    });
});

test.describe('Add materials in Czech', () => {
    test.use({ viewport: DESKTOP, locale: 'cs-CZ' });

    test('a research that gives codes: a refused file said in Czech with its params (L3)', async ({ page }) => {
        const b = await fakeBridge(page, {
            accepts: BATCH_ACCEPTS, features: ['media.codes'], mediaPutStatus: 413,
            mediaPutReply: { error: 'the batch has 2 files already (the most one takes)', code: 'batch.full-files', params: { batch: 'b-1', files: '2' } },
        });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await dialog.locator('[data-act="go"]').click();
        await expect(dialog.locator('.batch-done-row.is-warn')).toHaveText('Výzkum odmítl (Krabice/a.jpg: dávka už má 2 soubory, víc nebere)');
        expect(b.mediaPuts).toHaveLength(1);
    });
});
