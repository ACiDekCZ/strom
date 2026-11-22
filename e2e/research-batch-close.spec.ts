import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, openResearch, openResearchMenu, poll, block } from './research-bridge.js';

/**
 * A batch whose close fails (W136): `POST /batch/<id>/done` busy (503 with
 * `retry`), an error without a body, no answer — never said done while its
 * files may still wait in the bridge's queue. The window says so, closes it
 * again after the research's `retry` and only then shows the summary; a
 * cancel meanwhile keeps the batch remembered unfinished. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const BATCH_ACCEPTS = {
    sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true },
        estimate: { filesPerTask: 25, perTask: 1, currency: 'USD', basis: 'typical' } },
};
const cors = { 'access-control-allow-origin': '*' };

async function addFiles(page: Page, paths: string[]): Promise<void> {
    await page.evaluate((list) => {
        const files = list.map(path => ({ path, file: new File([`obsah ${path}`], path.split('/').pop()!, { type: 'image/jpeg' }) }));
        (window.Strom.UI as any).addBatchFiles(files);
    }, paths);
}

/** The first answers of `batch/<id>/done` from `replies` (then the fake bridge's own); how many closes were asked. */
async function closeReplies(page: Page, replies: ((route: Route) => Promise<void>)[]): Promise<{ asked: number }> {
    const seen = { asked: 0 };
    await page.route(url => /\/batch\/[^/]+\/done$/.test(url.pathname), async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const reply = replies[seen.asked++];
        if (reply) await reply(route);
        else await route.fallback();
    });
    return seen;
}

const busy = (retry: number) => (route: Route) => route.fulfill({
    status: 503, headers: { ...cors, 'content-type': 'application/json' },
    body: JSON.stringify({ error: 'the research is being written: ask again in a while', code: 'research.busy', retry }),
});

const unfinished = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-batch:')));

async function sendTwo(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as any).showBatchDialog());
    await addFiles(page, ['Krabice/a.jpg', 'Krabice/b.jpg']);
    const dialog = page.locator('#batch-modal');
    await dialog.locator('[data-act="next"]').click();
    await dialog.getByRole('button', { name: 'Send 2 files' }).click();
}

test.describe('A batch whose close fails (W136)', () => {
    test.use({ viewport: DESKTOP });

    test('busy twice (503 with retry): the window says the files still wait and closes it again; done only once it passes, with its count', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, features: ['media.known', 'media.queued'] });
        const closes = await closeReplies(page, [busy(1), busy(1)]);
        await openResearch(page, { media: true });
        await poll(page);
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-progress-title')).toHaveText('Closing the batch');
        await expect(dialog.locator('.batch-close-wait')).toHaveText('The files are still waiting to be written into the research. Closing the batch again shortly.');
        await expect(dialog.locator('.batch-done')).toHaveCount(0);
        // Still remembered unfinished while it is not closed.
        expect(await unfinished(page)).toHaveLength(1);
        await expect(dialog.locator('.batch-confirm-title')).toContainText('Batch “Krabice” is in the research');
        expect(closes.asked).toBe(3);
        expect(b.batchDone).toHaveLength(1);
        await expect(dialog.locator('.batch-done-row', { hasText: 'Received' })).toContainText('2');
        expect(await unfinished(page)).toEqual([]);
    });

    test('an error without a body (500), an older research: closed again after 5 s; hidden meanwhile, the block says it is not closed, the toast says done after', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS });
        const closes = await closeReplies(page, [route => route.fulfill({ status: 500, headers: cors, body: '' })]);
        await openResearch(page, { media: true });
        await poll(page);
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-close-wait')).toHaveText('The files are in the research, the batch is not closed yet. Closing the batch again shortly.');
        await dialog.getByRole('button', { name: 'Hide' }).click();
        await openResearchMenu(page);
        await expect(block(page).locator('.batch-line')).toContainText('Batch “Krabice” is not closed yet.');
        await expect(page.locator('.toast', { hasText: 'Batch “Krabice” is in the research: 2 received' })).toBeVisible({ timeout: 15_000 });
        expect(closes.asked).toBe(2);
        expect(b.batchDone).toHaveLength(1);
        expect(await unfinished(page)).toEqual([]);
    });

    test('cancelled while it waits to close again: not said done, the batch stays remembered unfinished', async ({ page }) => {
        const b = await fakeBridge(page, { accepts: BATCH_ACCEPTS, features: ['media.known', 'media.queued'] });
        await closeReplies(page, Array.from({ length: 10 }, () => busy(30)));
        await openResearch(page, { media: true });
        await poll(page);
        await sendTwo(page);
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-close-wait')).toBeVisible();
        await dialog.locator('[data-act="cancel-run"]').click();
        await page.locator('#confirm-ok-btn').click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Batch “Krabice” is not closed yet.' })).toContainText('The files are still waiting to be written into the research.');
        await expect(page.locator('.toast', { hasText: 'is in the research' })).toHaveCount(0);
        expect(b.batchDone ?? []).toHaveLength(0);
        expect(await unfinished(page)).toHaveLength(1);
        await openResearchMenu(page);
        await expect(block(page).locator('.batch-line')).toContainText('Unfinished batch “Krabice”');
    });
});
