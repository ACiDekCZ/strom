import { test, expect, Page } from '@playwright/test';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { cardAction, personModal } from './helpers.js';
import { fakeBridge, openResearch, poll, BRIDGE, UUID } from './research-bridge.js';

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
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const tx = req.result.transaction('originals', 'readonly');
            const all = tx.objectStore('originals').getAll();
            all.onsuccess = () => { resolve(all.result as never); req.result.close(); };
        };
    }));
}

test.describe('originals go to the research', () => {
    test.use({ viewport: DESKTOP });

    test('a file added to a person goes to the research as it was, with the person', async ({ page }) => {
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
        await expect(modal.locator('.attachment-original')).toHaveText('Original in the research');
        expect(await queued(page)).toEqual([]);
    });

    test('the bridge down: the original waits in the browser and goes when it answers', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS });
        await openResearch(page, { media: true });
        b.down = true;
        const modal = await attachToJan(page);
        await expect(modal.locator('.attachment-original')).toHaveText('Original waits for the research');
        const waiting = await queued(page);
        expect(waiting.map(r => [r.sha256, r.bytes])).toEqual([[AVATAR_SHA, AVATAR_BYTES]]);
        expect(b.mediaPuts).toEqual([]);

        b.down = false;
        await poll(page);
        await expect.poll(() => b.mediaPuts.length).toBe(1);
        expect(b.mediaPuts[0].headers['x-strom-person']).toBe('P0003');
        await expect.poll(() => queued(page)).toEqual([]);
        await expect(modal.locator('.attachment-original')).toHaveText('Original in the research');
    });

    test('a file the research already has is not sent again', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, mediaKnown: new Map([[AVATAR_SHA, 'M0007']]) });
        await openResearch(page, { media: true });
        const modal = await attachToJan(page);
        await expect(modal.locator('.attachment-original')).toHaveText('Original in the research');
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
        await expect(modal.locator('.attachment-original')).toHaveText('Original waits for the research');
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

    test('a research that does not take originals: nothing goes, nothing is said', async ({ page }) => {
        const b = await fakeBridge(page);
        await openResearch(page);
        const modal = await attachToJan(page);
        await poll(page);
        expect(b.mediaAsks).toEqual([]);
        expect(b.mediaPuts).toEqual([]);
        await expect(modal.locator('.attachment-original')).toHaveCount(0);
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
