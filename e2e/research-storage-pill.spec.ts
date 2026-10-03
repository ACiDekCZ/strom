import { test, expect } from '@playwright/test';
import { fakeBridge, openResearch, editJan, poll } from './research-bridge.js';

/**
 * "Only in browser" on a tree linked to Strom Research (Milan, 3 Oct 2026):
 * the edits are in the research, so the pill stays out while the research
 * has everything and while fresh edits are on their way; it shows once edits
 * stay unsent for 10 minutes — then they really are only in this browser.
 * A tree without a research keeps today's pill (storage specs).
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
});
