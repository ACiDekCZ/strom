import { test, expect } from '@playwright/test';
import { fakeBridge, openResearch, editJan, poll } from './research-bridge.js';

/**
 * "Only in browser" on a tree linked to Strom Research (Milan, 3 Oct 2026):
 * the edits are in the research, so the pill stays out while the research
 * has everything and while fresh edits are on their way; it shows once edits
 * stay unsent for 10 minutes — then they really are only in this browser.
 * A tree without a research keeps today's pill (storage specs). Its
 * portraits, couple photos and attachments the research does not keep: until a
 * file copy holds them, the pill shows (spec 108 K1b.1).
 */

const DESKTOP = { width: 1440, height: 900 };
const pill = (page: import('@playwright/test').Page) => page.locator('#unsaved-copy-indicator');

test.describe('the storage pill on a research tree', () => {
    test.use({ viewport: DESKTOP });

    test('out while the research holds the edits, on after 10 minutes unsent, out again once sent', async ({ page }) => {
        await page.clock.install();
        const b = await fakeBridge(page, { accepts: { sync: { auto: 'write' }, sources: true, verified: true, media: null },
            syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await openResearch(page);
        await poll(page);
        // Edited by hand (the Send button), not sent yet: the research will have it in a moment.
        await editJan(page);
        await page.clock.fastForward(5_000);
        await expect(page.locator('#research-sync-pill .research-sync-send')).toBeVisible();
        await expect(pill(page)).toBeHidden();

        // Ten minutes unsent: only in this browser now.
        await page.clock.fastForward(10 * 60_000 + 1_000);
        await expect(pill(page)).toBeVisible();

        // Sent and written: the research holds it, the pill goes.
        await page.locator('#research-sync-pill .research-sync-send').click();
        await expect.poll(() => b.posts.length).toBe(1);
        await expect(pill(page)).toBeHidden();
    });

    // Spec 108 K1b.1: the research takes the tree's text but none of its portraits, couple photos
    // or attachments, so a tree with pictures no file holds shows the pill at once, research or not.
    test('a portrait no file holds: on at once; a full file copy takes it; a new portrait brings it back', async ({ page }) => {
        await page.clock.install();
        await fakeBridge(page, { accepts: { sync: { auto: 'write' }, sources: true, verified: true, media: null } });
        await openResearch(page);
        await poll(page);
        await expect(pill(page)).toBeHidden();
        const setPortrait = (fill: string) => page.evaluate((fill) => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { photo: `data:image/jpeg;base64,${fill.repeat(3000)}` });
        }, fill);

        // A fresh edit the research is about to take — yet the portrait is only in this browser.
        await setPortrait('A');
        await page.clock.fastForward(1_000);
        await expect(pill(page)).toBeVisible();

        // A full export to a file carries the portrait: the pill goes, and an edit of the text after it stays with the research.
        await page.evaluate(() => window.Strom.DataManager.exportTreeJSON(window.Strom.TreeManager.getActiveTreeId()!));
        await expect(pill(page)).toBeHidden();
        await editJan(page);
        await page.clock.fastForward(1_000);
        await expect(pill(page)).toBeHidden();

        // Another portrait: not in the file.
        await setPortrait('B');
        await page.clock.fastForward(1_000);
        await expect(pill(page)).toBeVisible();
    });
});
