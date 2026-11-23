import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeIntake, fakeMaterial, materialFile, openResearch, openResearchMenu, poll, block, BRIDGE, BRIDGE2, MATERIAL_FEATURES, UUID, FakeBridge, FakeIntake,
    FakeMaterialFile,
} from './research-bridge.js';

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

/**
 * Sorting a closed batch only when switched on (spec 130 K1.2, K2.1, K2.2, K5.1): a research with `intake.auto`
 * off leaves the files in Materials and the end offers Sort with the agent…; on, it says the research sorts the
 * batch itself; an older research says what it said before. The switch in Research for this tree writes
 * `POST /intake {"auto": bool}` at once. The app never sends `sort`. Invented data.
 */
test.describe('Sorting a closed batch', () => {
    test.use({ viewport: DESKTOP });

    const SORT_ACCEPTS = { ...BATCH_ACCEPTS, media: { ...BATCH_ACCEPTS.media, tasks: 'open' } };
    const SORT_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];

    async function setup(page: Page, opts: { features: string[]; intake?: FakeIntake; files?: FakeMaterialFile[] }): Promise<FakeBridge> {
        await page.clock.setFixedTime(new Date('2026-11-21T10:30:00Z'));
        const b = await fakeBridge(page, { accepts: SORT_ACCEPTS, features: opts.features, material: fakeMaterial({ files: opts.files ?? [] }),
            ...(opts.intake ? { intake: opts.intake } : {}) });
        await openResearch(page, { media: true });
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        }, { uuid: UUID, base: BRIDGE, accepts: SORT_ACCEPTS });
        await poll(page);
        return b;
    }

    async function sendTwo(page: Page): Promise<void> {
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog.locator('.batch-confirm-title')).toContainText('Batch “Krabice” is in the research');
    }

    test('off (the default): the files wait in Materials, no sorting tasks, Sort with the agent… offered; no sort sent', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false) });
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-done-text')).toHaveText('The files wait in Materials, not sorted yet. The agent sorts them only on request.');
        await expect(dialog).not.toContainText(/agent will sort|Sorting tasks|sorts the batch by itself/);
        await expect(dialog.locator('.batch-sort [data-act="sort-agent"]')).toBeVisible();
        expect(b.batchDone).toHaveLength(1);
        expect('sort' in b.batchDone![0].body).toBe(false);
    });

    test('on: the research sorts the batch by itself, its tasks said; no Sort with the agent… at the end', async ({ page }) => {
        const b = await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(true) });
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-done-text')).toHaveText('The research sorts the batch by itself. Sources and excerpts that belong to people arrive with the next tree version.');
        await expect(dialog.locator('.batch-done-row', { hasText: 'Sorting tasks' })).toContainText('1');
        await expect(dialog.locator('.batch-sort')).toHaveCount(0);
        expect('sort' in b.batchDone![0].body).toBe(false);
    });

    test('an older research (no intake.auto): the text of before, its sorting tasks and the block as before', async ({ page }) => {
        await setup(page, { features: SORT_FEATURES });
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-done-text')).toHaveText('The agent will sort the files. Sources and excerpts that belong to people arrive with the next tree version.');
        await expect(dialog.locator('.batch-done-row', { hasText: 'Sorting tasks' })).toContainText('1');
        await expect(dialog.locator('.batch-sort [data-act="sort-agent"]')).toBeVisible();
    });

    test('without the list of materials (no material features): off says where the files wait and how they are sorted', async ({ page }) => {
        await setup(page, { features: ['intake.auto'], intake: fakeIntake(false) });
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-done-text')).toHaveText('The files wait in Materials, not sorted yet. The agent sorts them only on request: “Sort with the agent…” in Materials.');
        await expect(dialog.locator('.batch-sort')).toHaveCount(0);
    });

    async function openTreeSettings(page: Page): Promise<void> {
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
    }
    const section = (page: Page) => page.locator('#research-tree-settings-modal .research-intake');
    const toggle = (page: Page) => page.locator('#research-intake-auto');
    const note = (page: Page) => page.locator('#research-intake-note');

    test('Research for this tree: the switch follows /status.intake; on and off at once through POST /intake {auto}; no mark', async ({ page }) => {
        const intake = fakeIntake(false);
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake });
        await openTreeSettings(page);
        await expect(section(page).locator('legend')).toHaveText('Materials');
        await expect(section(page).locator('.settings-name')).toHaveText('The agent goes through files sent to the research by itself');
        await expect(section(page).locator('.settings-desc')).toContainText('Off: the files wait in Materials and are sorted only on request.');
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveCount(0);
        // Through the bridge, no terminal: no AI badge, no terminal mark, no link.
        await expect(section(page).locator('.research-ai-badge, .research-open-mark, svg, button, a')).toHaveCount(0);

        await section(page).locator('label').click();
        await expect.poll(() => intake.posts).toEqual([{ auto: true }]);
        await expect(section(page).locator('[data-pend]')).toHaveCount(0);
        await expect(toggle(page)).toBeChecked();
        await poll(page);
        await expect(toggle(page)).toBeChecked();

        await section(page).locator('label').click();
        await expect.poll(() => intake.posts).toEqual([{ auto: true }, { auto: false }]);
        await expect(toggle(page)).not.toBeChecked();
        await poll(page);
        await expect(toggle(page)).not.toBeChecked();
    });

    test('Research for this tree: busy (503) says so under the row and the switch stays; an archive\'s refusal takes the row away', async ({ page }) => {
        const intake = fakeIntake(false);
        intake.replies.push({ status: 503, body: { error: 'Busy.', code: 'research.busy' } });
        intake.replies.push({ status: 409, body: { error: 'An archive does not sort batches.', code: 'intake.archive', reasonCode: 'archive' } });
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake });
        await openTreeSettings(page);
        await section(page).locator('label').click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(toggle(page)).not.toBeChecked();
        await section(page).locator('label').click();
        await expect(page.locator('#research-intake-host')).toBeEmpty();
        expect(intake.posts).toEqual([{ auto: true }, { auto: true }]);
    });

    test('Research for this tree: no row from an older research, nor when the status does not say the setting', async ({ page }) => {
        const intake = fakeIntake(false);
        delete intake.intake;
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake });
        await openTreeSettings(page);
        await expect(page.locator('#research-intake-host')).toBeEmpty();
        await page.locator('#research-tree-settings-done').click();
        await expect(page.locator('#research-tree-settings-modal')).toHaveCount(0);
        intake.intake = { auto: true };
        await poll(page);
        await openTreeSettings(page);
        await expect(toggle(page)).toBeChecked();
    });

    test('Research for this tree: an older research (no intake.auto) shows no switch', async ({ page }) => {
        await setup(page, { features: SORT_FEATURES, intake: fakeIntake(true) });
        await openTreeSettings(page);
        await expect(page.locator('#research-intake-host')).toBeEmpty();
    });

    // ==================== Before sending a batch (spec 130 K1.3) ====================

    async function confirmTwo(page: Page) {
        await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
        await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await expect(dialog.getByRole('button', { name: 'Send 2 files' })).toBeVisible();
        return dialog;
    }

    test('before sending a batch, off: no cost and no agent, the files wait in Materials', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false) });
        const dialog = await confirmTwo(page);
        await expect(dialog.locator('.material-box')).toHaveText(/The files are stored in the research, outside git, and wait in Materials unsorted\. The agent sorts them only on request/);
        await expect(dialog).not.toContainText(/Estimated cost|Privacy|goes to the model provider/);
    });

    test('before sending a batch, on and older: privacy and cost as before', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(true) });
        const dialog = await confirmTwo(page);
        await expect(dialog).toContainText('Privacy');
        await expect(dialog).toContainText('Whatever the agent opens goes to the model provider.');
    });

    // ==================== A single file (Send material…, spec 130 K1.3) ====================

    async function sendOne(page: Page) {
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles({ name: 'dopis.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('obsah dopisu') });
        return dialog;
    }

    test('a single file, off: the dialog and the toast say it waits in Materials; Sort with the agent… (AI, no terminal) opens the sorting of it', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false),
            files: [materialFile(101, { name: 'dopis.jpg', persons: ['P0003'] })] });
        const dialog = await sendOne(page);
        await expect(dialog.locator('.material-box')).toContainText('Nothing is added to the tree. The research stores the files with the person. They wait in Materials; the agent goes through them only on request.');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        const toast = page.locator('.toast', { hasText: 'Sent to the research' });
        await expect(toast).toContainText('Sent to the research: 1 file for Jan Fíšek. It waits in Materials, not sorted yet.');
        await expect(toast).not.toContainText('task');
        const sort = toast.locator('.toast-action', { hasText: 'Sort with the agent…' });
        await expect(sort.locator('.research-ai-badge')).toHaveCount(1);
        await expect(sort.locator('.research-open-mark')).toHaveCount(0);
        await expect(toast.locator('.toast-action', { hasText: 'Show' })).toHaveCount(1);
        expect(b.mediaPuts).toHaveLength(1);
        await sort.click();
        await expect(page.locator('.mdlg--sort')).toBeVisible();
        await expect(page.locator('.mdlg--sort')).toContainText('1 file');
        // Only the dialog opened: nothing is sorted before its own button.
        expect(b.material?.sorts ?? []).toHaveLength(0);
    });

    test('a single file, on: the research makes a task of it, as before; no Sort with the agent…', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(true) });
        const dialog = await sendOne(page);
        await expect(dialog.locator('.material-box')).toContainText('Nothing is added to the tree. The research stores the files with the person and creates a task for the agent.');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        const toast = page.locator('.toast', { hasText: 'Sent to the research' });
        await expect(toast).toContainText('Sent to the research: 1 file for Jan Fíšek. The research will create a task.');
        await expect(toast.locator('.toast-action', { hasText: 'Sort with the agent' })).toHaveCount(0);
    });

    test('Also add as an attachment: its box beside its text; the note under it says at once whether the files go into the tree too', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(true) });
        const dialog = await sendOne(page);
        const check = dialog.locator('#material-attach');
        const label = dialog.locator('.material-attach .confirm-check-label');
        await expect(label).toHaveText('Also add as an attachment in the tree');
        // The box sits on the text's first line, left of it (not on a line of its own above it).
        const c = (await check.boundingBox())!;
        const t = (await label.boundingBox())!;
        expect(c.x + c.width).toBeLessThanOrEqual(t.x);
        expect(c.y).toBeLessThan(t.y + t.height);
        expect(c.y + c.height).toBeGreaterThan(t.y);
        const box = dialog.locator('.material-box');
        await expect(check).not.toBeChecked();
        await expect(box).toContainText('Nothing is added to the tree. The research stores the files with the person and creates a task for the agent.');
        await check.check();
        await expect(box).toContainText("The files are also added to the tree as the person's attachments. The research stores them with the person and creates a task for the agent.");
        await check.uncheck();
        await expect(box).toContainText('Nothing is added to the tree.');
        // Ticked, it stays so over a redraw (another file picked), and so does the note.
        await check.check();
        await dialog.locator('#material-input').setInputFiles({ name: 'dopis2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('druha strana') });
        await expect(dialog.locator('.material-item')).toHaveCount(2);
        await expect(check).toBeChecked();
        await expect(box).toContainText("The files are also added to the tree as the person's attachments.");
    });

    test('Also add as an attachment, files waiting in Materials: the note says they go into the tree too', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false) });
        const dialog = await sendOne(page);
        await dialog.locator('#material-attach').check();
        await expect(dialog.locator('.material-box')).toContainText("The files are also added to the tree as the person's attachments. The research stores them with the person. They wait in Materials; the agent goes through them only on request.");
    });

    test('a single file, an older research (no intake.auto): the texts of before', async ({ page }) => {
        await setup(page, { features: SORT_FEATURES });
        const dialog = await sendOne(page);
        await expect(dialog.locator('.material-box')).toContainText('creates a task for the agent');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        const toast = page.locator('.toast', { hasText: 'Sent to the research' });
        await expect(toast).toContainText('The research will create a task.');
        await expect(toast.locator('.toast-action', { hasText: 'Sort with the agent' })).toHaveCount(0);
    });

    test('the reply decides: the status says on, the research made no task of the file — it waits in Materials', async ({ page }) => {
        const intake = fakeIntake(true);
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake });
        const dialog = await sendOne(page);
        // Switched off in the research meanwhile (the app's status not read again yet).
        intake.intake = { auto: false };
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast', { hasText: 'Sent to the research' })).toContainText('It waits in Materials, not sorted yet.');
    });

    test('Materials: a file not gone through says "not sorted" when off', async ({ page }) => {
        const intake = fakeIntake(false);
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake, files: [materialFile(1, { persons: ['P0003'] })] });
        const id = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);
        await page.evaluate((id) => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal(id);
        }, id);
        const meta = page.locator('#materials-section .material-row:not(.is-skeleton) .material-meta').first();
        await expect(meta).toContainText('not sorted');
        await expect(meta).not.toContainText('waiting to be processed');
    });

    // ==================== German on a phone: nothing runs over an edge (finding 1121) ====================

    test.describe('in German on a phone', () => {
        test.use({ locale: 'de-DE', viewport: { width: 390, height: 844 } });

        /** How far boxes run past the right edge of a box's content (its padding inside); 0 when inside. */
        async function overRight(page: Page, outer: string, inner: string): Promise<number> {
            return page.evaluate(({ outer, inner }) => {
                const box = document.querySelector(outer) as HTMLElement;
                const r = box.getBoundingClientRect();
                const right = r.right - parseFloat(getComputedStyle(box).paddingRight);
                return Math.max(0, ...[...box.querySelectorAll(inner)].map(e => e.getBoundingClientRect().right - right));
            }, { outer, inner });
        }

        test('the toast after one file: its actions stay inside the toast\'s padding', async ({ page }) => {
            await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false) });
            const dialog = await sendOne(page);
            await dialog.getByRole('button', { name: '1 Datei senden' }).click();
            const toast = page.locator('.toast', { hasText: 'An die Forschung gesendet' });
            await expect(toast.locator('.toast-action')).toHaveCount(2);
            await expect(toast.locator('.toast-action', { hasText: 'Mit dem Agenten sortieren…' })).toBeVisible();
            await toast.evaluate(t => t.classList.add('e2e-toast'));
            expect(await overRight(page, '.e2e-toast', '.toast-action')).toBeLessThanOrEqual(0.5);
            const toastBox = (await toast.boundingBox())!;
            for (const act of await toast.locator('.toast-action').all()) {
                const b = (await act.boundingBox())!;
                expect(b.x).toBeGreaterThanOrEqual(toastBox.x);
                expect(b.x + b.width).toBeLessThanOrEqual(toastBox.x + toastBox.width);
            }
        });

        test('the batch\'s header: the title and the steps never overlap', async ({ page }) => {
            await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], intake: fakeIntake(false) });
            await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
            await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
            const dialog = page.locator('#batch-modal');
            await dialog.locator('[data-act="next"]').click();
            await expect(dialog.getByRole('button', { name: '2 Dateien senden' })).toBeVisible();
            // The text's own boxes (a word wider than its block runs out of it), against each step.
            const hits = await page.evaluate(() => {
                const head = document.querySelector('#batch-modal .batch-header .audit-log-heading')!;
                const range = document.createRange();
                range.selectNodeContents(head);
                const text = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
                const steps = [...document.querySelectorAll('#batch-modal .batch-step')].map(e => e.getBoundingClientRect());
                const close = document.querySelector('#batch-modal .batch-header .close-btn')!.getBoundingClientRect();
                const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
                return { steps: steps.length, hits: text.filter(t => [...steps, close].some(s => cross(t, s))).length };
            });
            expect(hits.steps).toBe(3);
            expect(hits.hits).toBe(0);
            const header = (await dialog.locator('.batch-header').boundingBox())!;
            for (const step of await dialog.locator('.batch-step').all()) {
                const b = (await step.boundingBox())!;
                expect(b.x + b.width).toBeLessThanOrEqual(header.x + header.width);
            }
        });
    });
});
