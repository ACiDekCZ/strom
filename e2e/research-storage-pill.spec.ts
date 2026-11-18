import { test, expect } from '@playwright/test';
import { fakeBridge, openResearch, editJan, poll } from './research-bridge.js';

/**
 * "Only in browser" on a tree linked to Strom Research (Milan, 3 Oct 2026):
 * the edits are in the research, so the pill stays out while the research
 * has everything and while fresh edits are on their way; it shows once edits
 * stay unsent for 10 minutes — then they really are only in this browser.
 * A tree without a research keeps today's pill (storage specs). Its
 * portraits, couple photos and attachments a research without `media.app`
 * does not keep: until a file copy holds them, the pill shows (spec 108
 * K1b.1); one that keeps them holds them once a write handed them over (K2.6).
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

    // Spec 108 K2.6: a research that keeps the tree's own files (`media.app`) holds them once a write handed them
    // over; a picture added after it is an edit not sent like any other — it waits, then counts.
    test('a research with media.app: the pictures count only until a write hands them over; a new one waits like any edit', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-11-17T10:30:00Z') });
        await openResearch(page);
        const b = await fakeBridge(page, { features: ['media.app'], accepts: { sync: { auto: 'write' }, sources: true, verified: true, media: null },
            syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await poll(page);
        const setPortrait = (fill: string) => page.evaluate((fill) => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { photo: `data:image/jpeg;base64,${fill.repeat(3000)}` });
        }, fill);

        // Not handed over yet: only in this browser.
        await setPortrait('A');
        await page.clock.fastForward(1_000);
        await expect(pill(page)).toBeVisible();

        // Written with its files: the research holds them.
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(1);
        expect(b.postQueries?.[0].get('media')).toBe('app');
        await expect(pill(page)).toBeHidden();

        // Another portrait: on its way like any edit, then — ten minutes unsent — only here.
        await setPortrait('B');
        await page.clock.fastForward(5_000);
        await expect(pill(page)).toBeHidden();
        await page.clock.fastForward(10 * 60_000 + 1_000);
        await expect(pill(page)).toBeVisible();
    });

    // An index saved before spec 108 knows no fingerprint of a research tree's pictures (N1): a tree
    // not open is not judged by that, and the app learns what it has from its stored data.
    for (const photo of [false, true]) {
        test(`a research tree not open whose pictures an older index does not know: judged by what it has (${photo ? 'a portrait' : 'none'})`, async ({ page }) => {
            await page.clock.install();
            await fakeBridge(page, { accepts: { sync: { auto: 'write' }, sources: true, verified: true, media: null },
                syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
            await openResearch(page);
            await poll(page);
            if (photo) {
                await page.evaluate(() => {
                    const dm = window.Strom.DataManager;
                    const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
                    dm.updatePerson(jan.id, { photo: `data:image/jpeg;base64,${'A'.repeat(3000)}` });
                });
            } else {
                await editJan(page);
            }
            await page.clock.fastForward(5_000);
            // Another tree opens; the research tree's fingerprint is gone, as in an index of an older version.
            // Judged at once: a read of the tree elsewhere learns it again.
            const before = await page.evaluate(async () => {
                const S = window.Strom as any;
                const rid = S.DataManager.getCurrentTreeId();
                const other = S.TreeManager.createTree('Second');
                await S.DataManager.switchTree(other);
                // Its last save landed (a save records the fingerprint).
                await S.TreeManager.flush();
                delete S.TreeManager.index.trees.find((t: any) => t.id === rid).mediaFp;
                S.UI.renderUnsavedIndicator();
                return { rid, holds: S.UI.researchHoldsTree(rid).holds, shown: S.UI.isUnsavedInBrowser() };
            });
            // Not known: not counted against it — the research holds the fresh edit.
            expect(before).toMatchObject({ holds: true, shown: false });

            // Learnt from the stored tree: a portrait no file holds lights the pill, none keeps it out.
            const learnt = await page.evaluate(async (rid) => {
                const S = window.Strom as any;
                await S.TreeManager.flush();
                delete S.TreeManager.index.trees.find((t: any) => t.id === rid).mediaFp;
                // Another read of the same tree meanwhile (the cards' badges read every visible tree) learns it
                // first: still counted, so the caller paints again.
                void S.TreeManager.getTreeData(rid);
                const n = await S.TreeManager.learnMediaFingerprints();
                S.UI.refreshUnsavedForResearch();
                return { n, fp: S.TreeManager.getTreeMetadata(rid)?.mediaFp };
            }, before.rid);
            expect(learnt.n).toBe(1);
            if (photo) expect(learnt.fp).toBeTruthy(); else expect(learnt.fp).toBe('');
            if (photo) await expect(pill(page)).toBeVisible(); else await expect(pill(page)).toBeHidden();
        });
    }

    // The cards' cross-tree badges read every visible tree: a hidden one, with them off, nothing else reads.
    test('a start learns the pictures of a research tree not open that an older index does not know', async ({ page }) => {
        await openResearch(page);
        const rid = await page.evaluate(async () => {
            const S = window.Strom as any;
            S.SettingsManager.setCrossTreeBadges(false);
            const rid = S.DataManager.getCurrentTreeId();
            const other = S.TreeManager.createTree('Second');
            await S.DataManager.switchTree(other);
            await S.TreeManager.flush();
            delete S.TreeManager.index.trees.find((t: any) => t.id === rid).mediaFp;
            S.TreeManager.toggleTreeVisibility(rid);
            await S.TreeManager.flush();
            return rid;
        });
        // Opens the visible tree (not the research tree an address would name).
        await page.goto(page.url().split('?')[0]);
        await expect.poll(() => page.evaluate(() => window.Strom?.TreeManager.getTreeMetadata(window.Strom.TreeManager.getActiveTreeId()!)?.name ?? null)).toBe('Second');
        await expect.poll(() => page.evaluate((rid) => window.Strom?.TreeManager.getTreeMetadata(rid)?.mediaFp ?? null, rid)).toBe('');
    });
});
