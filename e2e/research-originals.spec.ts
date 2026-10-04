import { test, expect, Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { cardAction, personModal } from './helpers.js';
import { fakeBridge, openResearch, openResearchMenu, poll, BRIDGE, UUID } from './research-bridge.js';

/**
 * Originals for Strom Research (step C, the base without its full UI): a file
 * added to a tree linked to a research keeps its preview in the tree and goes
 * to the research as it was — `GET` / `PUT /media/<sha256>` with the person's
 * research number — or waits in the browser until the bridge answers. A
 * research that does not take originals, and a tree without one, see nothing
 * of it.
 */

const DESKTOP = { width: 1440, height: 900 };
const AVATAR = 'e2e/fixtures/avatar.png';
const AVATAR_SHA = createHash('sha256').update(readFileSync(AVATAR)).digest('hex');
const AVATAR_BYTES = readFileSync(AVATAR).length;
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true, tasks: 'open' } };

/** Attach the fixture to Jan through the person editor; returns the editor. */
async function attachToJan(page: Page) {
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-attachment').setInputFiles(AVATAR);
    await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(1);
    return modal;
}

function janAttachment(page: Page) {
    return page.evaluate(() => {
        const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
        return jan.attachments?.[0] ?? null;
    });
}

function queued(page: Page): Promise<{ sha256: string; personId?: string; bytes: number }[]> {
    return page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('strom-originals');
        req.onsuccess = () => {
            const tx = req.result.transaction('originals', 'readonly');
            const all = tx.objectStore('originals').getAll();
            all.onsuccess = () => { resolve(all.result as never); req.result.close(); };
        };
    }));
}

test.describe('originals go to the research', () => {
    test.use({ viewport: DESKTOP });

    test('a file added to a person goes to the research as it was, with the person', { tag: '@smoke' }, async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        const modal = await attachToJan(page);

        await expect.poll(() => b.mediaPuts.length).toBe(1);
        const put = b.mediaPuts[0];
        expect(put.sha).toBe(AVATAR_SHA);
        expect(put.bytes).toBe(AVATAR_BYTES);
        expect(put.headers['x-strom-person']).toBe('P0003');
        expect(put.headers['x-strom-name']).toBe('avatar.png');
        expect(put.headers['content-type']).toBe('image/png');
        // Asked first whether the research had it.
        expect(b.mediaAsks).toEqual([AVATAR_SHA]);

        // The tree keeps the preview and the original's identity, nothing more.
        const att = await janAttachment(page);
        expect(att.original).toEqual({ sha256: AVATAR_SHA, name: 'avatar.png', mimeType: 'image/png', bytes: AVATAR_BYTES });
        expect(att.mimeType).toBe('image/jpeg');
        // In the research: with the bridge running no state line, the original opens in full quality.
        await poll(page);
        await page.evaluate(() => window.Strom.UI.renderAttachmentsList());
        await expect(modal.locator('.media-full-quality')).toHaveText('Full quality');
        await expect(modal.locator('.media-state')).toHaveCount(0);
        expect(await queued(page)).toEqual([]);
    });

    test('the bridge down: the original waits in the browser and goes when it answers', { tag: '@smoke' }, async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        b.down = true;
        const modal = await attachToJan(page);
        await expect(modal.locator('.media-state.is-queued')).toContainText('waiting to be sent to the research');
        const waiting = await queued(page);
        expect(waiting.map(r => [r.sha256, r.bytes])).toEqual([[AVATAR_SHA, AVATAR_BYTES]]);
        expect(b.mediaPuts).toEqual([]);

        b.down = false;
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        await expect.poll(() => queued(page)).toEqual([]);
        await expect(modal.locator('.media-full-quality')).toBeVisible();
        await expect(modal.locator('.media-state')).toHaveCount(0);
    });

    test('a file the research already has is not sent again', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, mediaKnown: new Map([[AVATAR_SHA, 'M0007']]) });
        await openResearch(page, { media: true });
        const modal = await attachToJan(page);
        // The bridge not asked lately: the original is in the research, said with a dot.
        await expect(modal.locator('.media-state.is-in')).toHaveText('The original is in the research');
        expect(b.mediaAsks).toEqual([AVATAR_SHA]);
        expect(b.mediaPuts).toEqual([]);
    });

    test('a person the research does not know yet: the original waits for its number', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        // As a person added in the app: no research number yet.
        await page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            delete jan.refn;
        });
        const modal = await attachToJan(page);
        await expect(modal.locator('.media-state.is-queued')).toHaveText('The original will be sent after the next tree send');
        await poll(page);
        expect(b.mediaPuts).toEqual([]);
        expect((await queued(page)).length).toBe(1);

        // The next version from the research brings its number: it goes.
        await page.evaluate(() => {
            const jan = Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            jan.refn = 'P0003';
        });
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
    });

    test('a crop goes with the source and its region on the stored file', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await page.evaluate(async () => {
            const ui = window.Strom.UI as any;
            const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.refn === 'S0001') as any;
            const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' });
            const meta = { sha256: 'c'.repeat(64), name: 'scan.jpg', mimeType: 'image/jpeg', bytes: 5, orientation: 6 };
            // As the source editor does on Save: the excerpt refers to the original.
            const data = window.Strom.DataManager.getData();
            window.Strom.DataManager.updateSource(src.id, {
                excerpts: [{ id: 'e1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 1, height: 1, sizeBytes: 8, originalSha: meta.sha256 }],
            } as never);
            void data;
            await ui.queueOriginal(meta, blob, { sourceId: src.id, region: { x: 0, y: 0, w: 1, h: 0.25 } });
        });
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        const h = b.mediaPuts[0].headers;
        expect(h['x-strom-source']).toBe('S0001');
        expect(h['x-strom-person']).toBeUndefined();
        // Drawn on the photo shown upright (turned 90°): the left band of the stored file.
        expect(h['x-strom-region']).toBe('0,0,0.25,1');
        // Only the headers the research allows.
        expect(Object.keys(h).filter(k => k.startsWith('x-strom-')).sort()).toEqual(['x-strom-name', 'x-strom-region', 'x-strom-source']);
    });

    test('a TIFF: only its original goes to the research; the row has a type tile and no preview', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, links: ['send', 'open', 'live', 'app', 'setup', 'media'] });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await expect(modal.locator('#input-attachment')).toHaveAttribute('accept', /image\/tiff/);
        await modal.locator('#input-attachment').setInputFiles({ name: 'matrika-1846.tif', mimeType: 'image/tiff', buffer: Buffer.from('II*\0' + 'x'.repeat(5000)) });
        const row = modal.locator('.attachment-row.is-original-only');
        await expect(row.locator('.attachment-type-tile')).toHaveText('TIFF');
        await expect(row).toContainText('the research will make a preview');
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        const att = await janAttachment(page);
        // Its data is the page icon (a 3.8.x app keeps it on a save), never the TIFF.
        expect(att).toMatchObject({ originalOnly: true, mimeType: 'image/tiff' });
        expect(att.dataUrl).toMatch(/^data:image\/png;base64,/);
        expect(att.dataUrl.length).toBeLessThan(400);
        // In the research now: opened there (a TIFF is not shown in the app).
        await expect(row.locator('.media-full-quality')).toHaveText(/↗/);
    });

    test('a TIFF for a research that does not take originals: refused as before, no attachment', async ({ page }) => {
        await fakeBridge(page, { accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null } });
        await openResearch(page);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await expect(modal.locator('#input-attachment')).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
        await modal.locator('#input-attachment').setInputFiles({ name: 'matrika-1846.tif', mimeType: 'image/tiff', buffer: Buffer.from('II*\0xxxx') });
        await expect(page.locator('#confirmation-modal')).toContainText('Unsupported');
        expect(await janAttachment(page)).toBeNull();
    });

    test('a large file: its row says "Preparing the original…" while it is read', async ({ page }) => {
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        // Hashing held until released (a large file takes a while).
        await page.evaluate(() => {
            const ui = window.Strom.UI as any;
            const prepare = ui.prepareOriginal.bind(ui);
            ui.prepareOriginal = async (file: Blob, name: string) => {
                await new Promise<void>(resolve => { (window as any).__release = resolve; });
                return prepare(file, name);
            };
        });
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await cardAction(page, 'Jan', 'edit');
        const modal = personModal(page);
        await modal.locator('#input-attachment').setInputFiles({ name: 'sken.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024)]) });
        const row = modal.locator('.attachment-preparing');
        await expect(row).toContainText('sken.pdf');
        await expect(row).toContainText('Preparing the original');
        await page.evaluate(() => (window as any).__release());
        await expect(row).toHaveCount(0);
    });

    test('a research that does not take originals: nothing goes; one quiet line by the heading, no toast', async ({ page }) => {
        const b = await fakeBridge(page);
        await openResearch(page);
        const modal = await attachToJan(page);
        await poll(page);
        expect(b.mediaAsks).toEqual([]);
        expect(b.mediaPuts).toEqual([]);
        await expect(modal.locator('#attachments-older-research')).toHaveText("The research doesn't accept originals yet.");
        await expect(modal.locator('.media-state')).toHaveText('preview only');
        await expect(page.locator('.toast', { hasText: /original/i })).toHaveCount(0);
        expect(await queued(page)).toEqual([]);
    });

    test('a tree without a research: no hash, no queue, no request', async ({ page }) => {
        const requests: string[] = [];
        page.on('request', (r) => { if (r.url().startsWith(BRIDGE)) requests.push(r.url()); });
        await openResearch(page, { media: true });
        // Unlink the tree: an ordinary tree like everyone else's.
        await page.evaluate((uuid) => {
            const tm = window.Strom.TreeManager;
            tm.setResearchLink(tm.getActiveTreeId()!, undefined);
            localStorage.removeItem(`strom-research-bridge:${uuid}`);
        }, UUID);
        const linked = await page.evaluate(() => !!window.Strom.TreeManager.getActiveTreeMetadata()?.research);
        test.skip(linked, 'the link cannot be removed this way');
        await attachToJan(page);
        expect((await janAttachment(page)).original).toBeUndefined();
        expect(await queued(page)).toEqual([]);
        expect(requests.filter(u => u.includes('/media/'))).toEqual([]);
    });
});

test.describe('originals: the full UI (beta.10)', () => {
    test.use({ viewport: DESKTOP });

    test('waiting originals: the block\'s second line, Settings → Data with the budget, Discard with Undo, Discard all', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        b.down = true;
        const modal = await attachToJan(page);
        await expect(modal.locator('.media-state.is-queued')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();

        // ⋯ → Research: the second line of the block.
        await openResearchMenu(page);
        const line = page.locator('#research-sync-block .research-sync-line2');
        await expect(line).toContainText('1 original waiting');
        await line.getByRole('button', { name: 'Show…' }).click();

        const row = page.locator('#media-queue-row');
        await expect(row).toHaveAttribute('open', '');
        await expect(row.locator('.media-queue-item')).toHaveCount(1);
        await expect(row.locator('.media-queue-item')).toContainText('avatar.png');
        await expect(row.locator('.media-queue-item')).toContainText('Jan Víšek');
        await expect(row.locator('.media-queue-budget-text')).toContainText('reserved for waiting originals');
        await expect(row.locator('.media-queue-info')).toContainText('only in this browser');

        await row.locator('.media-queue-discard').click();
        await expect(row.locator('.media-queue-undo')).toContainText('Original discarded.');
        await expect.poll(() => queued(page)).toEqual([]);
        await row.locator('.media-queue-undo-btn').click();
        await expect.poll(async () => (await queued(page)).length).toBe(1);
        await expect(row).toBeVisible();

        await row.locator('.media-queue-discard-all').click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => queued(page)).toEqual([]);
        expect(b.mediaPuts).toEqual([]);
    });

    test('originals waiting 3 days: the amber pill "Originals waiting" in the toolbar, its label opens the queue', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true, auto: true });
        await poll(page);
        b.down = true;
        await attachToJan(page);
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await queued(page)).length).toBe(1);
        const pill = page.locator('#research-sync-pill');
        await expect(pill).not.toContainText('Originals waiting');
        // Four days later (the record's time moved back), the page opened again.
        await page.evaluate(() => new Promise<void>((resolve) => {
            const req = indexedDB.open('strom-originals');
            req.onsuccess = () => {
                const store = req.result.transaction('originals', 'readwrite').objectStore('originals');
                const all = store.getAll();
                all.onsuccess = () => {
                    const keys = store.getAllKeys();
                    keys.onsuccess = () => {
                        (all.result as any[]).forEach((rec, i) => store.put({ ...rec, addedAt: Date.now() - 4 * 86_400_000 }, keys.result[i]));
                        store.transaction.oncomplete = () => { req.result.close(); resolve(); };
                    };
                };
            };
        }));
        await page.reload();
        await expect(pill).toContainText('Originals waiting');
        await expect(pill.locator('.research-sync-pill-send')).toBeVisible();
        // (The label is hidden below 1600 px, as on the other amber pills; the pill's title says it.)
        await expect(pill).toHaveAttribute('title', 'Originals waiting');
        await pill.locator('.research-sync-pill-label').dispatchEvent('click');
        await expect(page.locator('#media-queue-row')).toHaveAttribute('open', '');
    });

    test('deleting an attachment whose original waits: discard it (ticked), or send it anyway', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        b.down = true;
        const modal = await attachToJan(page);
        await modal.locator('.attachment-delete-btn').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm.locator('#confirm-check-input')).toBeChecked();
        await expect(confirm).toContainText('Also discard the original waiting to be sent');
        await confirm.locator('#confirm-ok-btn').click();
        await expect.poll(() => queued(page)).toEqual([]);

        // Once more, unticked: the original stays and goes when the bridge answers.
        await modal.locator('#input-attachment').setInputFiles(AVATAR);
        await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(1);
        await modal.locator('.attachment-delete-btn').click();
        await confirm.locator('#confirm-check-input').uncheck();
        await confirm.locator('#confirm-ok-btn').click();
        await expect(modal.locator('#attachments-list .attachment-row')).toHaveCount(0);
        expect((await queued(page)).length).toBe(1);
        b.down = false;
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        await expect.poll(() => queued(page)).toEqual([]);
    });

    test('"Send original files" off for the tree: preview only, said why, nothing goes', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()));
        const toggle = page.locator('#research-originals-toggle');
        await expect(toggle).toBeChecked();
        await toggle.uncheck();
        await page.locator('#research-tree-settings-done').click();
        const modal = await attachToJan(page);
        await expect(modal.locator('.media-state')).toHaveText('preview only');
        await expect(modal.locator('.media-state')).toHaveAttribute('title', 'Sending originals is turned off for this tree.');
        await poll(page);
        expect(b.mediaPuts).toEqual([]);
        expect(await queued(page)).toEqual([]);
    });

    test('Full quality: the original loads into the viewer from the bridge, with its size; back to the preview', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        b.mediaFiles.set(AVATAR_SHA, { type: 'image/png', body: readFileSync(AVATAR) });
        await openResearch(page, { media: true });
        const modal = await attachToJan(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.renderAttachmentsList());
        await modal.locator('.media-full-quality').click();
        const viewer = page.locator('#attachment-overlay');
        await expect(viewer).toHaveClass(/active/);
        const bar = page.locator('#image-viewer-media');
        await expect(bar).toContainText(/Original · \d+ × \d+ px/);
        await bar.getByRole('button', { name: 'Back to preview' }).click();
        await expect(bar.getByRole('button', { name: 'Full quality' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);
    });

    test('Full quality of an original the research no longer has: said so, the link goes', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        const modal = await attachToJan(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.renderAttachmentsList());
        await modal.locator('.media-full-quality').click();
        await expect(page.locator('.toast')).toContainText('The original is no longer in the research');
        await page.keyboard.press('Escape');
        await expect(modal.locator('.media-state')).toHaveText('The original is no longer in the research');
        await expect(modal.locator('.media-full-quality')).toHaveCount(0);
    });
});

test.describe('Send material… (beta.10)', () => {
    test.use({ viewport: DESKTOP });

    /** The person menu: "Send material…" (alone it sits in the menu itself, else under "Research ›"). */
    const openPersonResearch = async (page: Page) => {
        await page.locator('.person-card', { hasText: 'Jan' }).first().click();
        const research = page.locator('.context-menu [data-menu="research"]');
        if (await research.count()) await research.click();
        return page.locator('.context-menu, .context-submenu');
    };

    test('to a person: files with a note go to the research; a program is refused', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        const sub = await openPersonResearch(page);
        await sub.getByText('Send material…').first().click();
        const dialog = page.locator('#material-modal');
        await expect(dialog.locator('h2')).toHaveText('Send material to the research');
        await expect(dialog.locator('.audit-log-subtitle')).toContainText('Jan Víšek');
        await dialog.locator('#material-input').setInputFiles([
            { name: 'avatar.png', mimeType: 'image/png', buffer: readFileSync(AVATAR) },
            { name: 'dopis.txt', mimeType: 'text/plain', buffer: Buffer.from('Milá Anno…') },
            { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
        ]);
        await expect(dialog.locator('.material-item')).toHaveCount(2);
        await expect(dialog.locator('.material-rejected')).toContainText('1 file the research won\'t take');
        await dialog.locator('#material-note').fill('Z krabice od babičky');
        await expect(dialog.locator('.material-box')).toContainText('Nothing is added to the tree');
        await dialog.getByRole('button', { name: 'Send 2 files' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('Sent to the research: 2 files for Jan Víšek');
        expect(b.mediaPuts).toHaveLength(2);
        for (const put of b.mediaPuts) {
            expect(put.headers['x-strom-person']).toBe('P0003');
            expect(decodeURIComponent(put.headers['x-strom-note'])).toBe('Z krabice od babičky');
        }
        // Nothing in the tree, nothing left waiting.
        expect(await janAttachment(page)).toBeNull();
        expect(await queued(page)).toEqual([]);
    });

    test('no file yet: the main button is off and says "Send files"', async ({ page }) => {
        await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const go = page.locator('#material-modal .material-go');
        await expect(go).toHaveText('Send files');
        await expect(go).toBeDisabled();
        await page.locator('#material-input').setInputFiles(AVATAR);
        await expect(go).toHaveText('Send 1 file');
        await expect(go).toBeEnabled();
    });

    test('"Send original files" off: material is sent on purpose, so it goes anyway', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.patchResearchLink(tm.getActiveTreeId()!, { sendMedia: false });
        });
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research: 1 file for Jan Víšek');
        await expect(page.locator('.toast')).not.toContainText('refused');
        expect(b.mediaPuts).toHaveLength(1);
    });

    test('the bridge answered a while ago (not fresh): sent straight away, the toast says sent, not waiting', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        // The last answer older than the freshness window: still "up".
        await page.evaluate(() => (window.Strom.UI as any).researchBridgeFresh = () => false);
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await expect(dialog.locator('.material-box')).not.toContainText("isn't running");
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('Sent to the research: 1 file');
        await expect(page.locator('.toast')).not.toContainText('waits');
        expect(b.mediaPuts).toHaveLength(1);
        expect(await queued(page)).toEqual([]);
    });

    test('a file larger than the research takes: the toast says that, not that the research refused it', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: { ...MEDIA_ACCEPTS, media: { ...MEDIA_ACCEPTS.media, max: 100 } } });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText("Sent 0 of 1. avatar.png wasn't sent: it's larger than the research takes");
        await expect(page.locator('.toast')).not.toContainText("couldn't be loaded");
        expect(b.mediaPuts).toEqual([]);
    });

    test('material the research already has: sent with its note, and the toast says it had it (no task), not "sent"', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        b.mediaKnown.set(AVATAR_SHA, 'I0013');
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.locator('#material-note').fill('Dopis od babičky');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('The research already has this file; no new task comes of it.');
        // Not asked first: the note went along to the file it has.
        expect(b.mediaPuts).toHaveLength(1);
        expect(decodeURIComponent(b.mediaPuts[0].headers['x-strom-note'])).toBe('Dopis od babičky');
    });

    test('material the research had, and it added the person and the note (1.12): said so', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, knownAdds: true });
        b.mediaKnown.set(AVATAR_SHA, 'I0013');
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.locator('#material-note').fill('Dopis od babičky');
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect(page.locator('.toast')).toContainText('The research already had this file and added the person and the note to it.');
    });

    test('the research not running: the files wait in the browser and go later', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        const sub = await openPersonResearch(page);
        b.down = true;
        await page.evaluate(() => (window.Strom.UI as any).researchBridgeUp = () => false);
        await sub.getByText('Send material…').first().click();
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await expect(dialog.locator('.material-box')).toContainText("The research isn't running");
        await dialog.getByRole('button', { name: 'Send when the research runs' }).click();
        await expect(page.locator('.toast')).toContainText('1 file waits in this browser');
        expect((await queued(page)).length).toBe(1);
        b.down = false;
        await page.evaluate(() => { delete (window.Strom.UI as any).researchBridgeUp; });
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        await expect.poll(() => queued(page)).toEqual([]);
    });

    test('to a source from its viewer: the file goes with the source', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        await page.evaluate(() => {
            const src = Object.values(window.Strom.DataManager.getData().sources ?? {}).find((s: any) => s.refn === 'S0001') as any;
            window.Strom.UI.showSourceViewer(src.id, null);
        });
        await page.locator('#source-viewer-material').click();
        const dialog = page.locator('#material-modal');
        await expect(dialog.locator('.audit-log-subtitle')).toContainText('Oddací matrika Čáslav');
        await dialog.locator('#material-input').setInputFiles(AVATAR);
        await dialog.getByRole('button', { name: 'Send 1 file' }).click();
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-source']).toBe('S0001');
    });
});

test.describe('a bridge busy at start (503)', () => {
    test.use({ viewport: DESKTOP });

    test('material waiting in the browser goes once the busy bridge answers; asking goes on after 503', async ({ page }) => {
        await page.clock.install();
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        b.down = true;
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles({ name: 'fotka.png', mimeType: 'image/png', buffer: readFileSync(AVATAR) });
        await dialog.locator('#material-note').fill('poznámka');
        await dialog.locator('.material-go').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await queued(page)).length).toBe(1);

        // The research starts: busy for a moment (503), then answers.
        b.down = false;
        b.busy = true;
        await page.clock.fastForward(70_000);
        await expect.poll(() => (b.seen ?? []).filter(x => x.includes('/status')).length).toBeGreaterThan(0);
        b.busy = false;
        // Busy said "Retry-After: 2": asked again within seconds, not after the minute.
        await page.clock.fastForward(5_000);
        await expect.poll(() => b.mediaPuts.length, { timeout: 10_000 }).toBe(1);
        expect(decodeURIComponent(b.mediaPuts[0].headers['x-strom-note'])).toBe('poznámka');
        await expect.poll(() => queued(page)).toEqual([]);
    });

    test('material left in the queue goes after a reload', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        await poll(page);
        b.down = true;
        await page.evaluate(() => (window.Strom.UI as any).showMaterialDialog({ personId: Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Jan')!.id }));
        const dialog = page.locator('#material-modal');
        await dialog.locator('#material-input').setInputFiles({ name: 'fotka.png', mimeType: 'image/png', buffer: readFileSync(AVATAR) });
        await dialog.locator('.material-go').click();
        await expect.poll(async () => (await queued(page)).length).toBe(1);
        b.down = false;
        await page.reload();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await expect.poll(() => b.mediaPuts.length, { timeout: 15_000 }).toBe(1);
        await expect.poll(() => queued(page)).toEqual([]);
    });
});
