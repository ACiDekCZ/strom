import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { HEAD, editJan, fakeBridge, openResearch, poll, researchGed, FakeBridge } from './research-bridge.js';

/**
 * More than one window on one research (PLAN_vic-prohlizecu.md): two windows
 * of the app in one browser share the stored trees, and the research reads a
 * send as edits against the head it names. Data older than that head would
 * take back what the research changed since. So the head travels with the
 * data — stored with them in one transaction, back with them on undo — and a
 * window whose copy another window has overwritten sends nothing.
 */

const QUIET = 120_000;
const DESKTOP = { width: 1440, height: 900 };
const WRITE = { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } };

function writesAtOnce(bridge: FakeBridge): void {
    let n = 0;
    bridge.syncReply = WRITE;
    bridge.onWrite = () => {
        n++;
        const head = `ab${n}0cd${n}0ef${n}0`;
        return { head, ged: researchGed(head, ['1 BIRT', '2 PLAC Praha']) };
    };
}

const accepts = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head ?? '');
const storedBase = (page: Page) => page.evaluate(() => new Promise<{ head: string } | null>((resolve) => {
    const req = indexedDB.open('strom-db');
    req.onsuccess = () => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        const get = req.result.transaction('researchBases', 'readonly').objectStore('researchBases').get(id);
        get.onsuccess = () => { resolve(get.result ?? null); req.result.close(); };
    };
}));

/** A research tree that sends by itself, its bridge running and writing at once. */
async function autoTree(page: Page): Promise<FakeBridge> {
    await page.clock.install();
    await openResearch(page, { auto: true });
    const bridge = await fakeBridge(page, { accepts });
    await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
    await poll(page);
    writesAtOnce(bridge);
    return bridge;
}

/** A second window of the app in the same browser, on the same tree and bridge. */
async function secondWindow(first: Page): Promise<{ page: Page; bridge: FakeBridge }> {
    const page = await first.context().newPage();
    await page.setViewportSize(DESKTOP);
    const bridge = await fakeBridge(page, { accepts });
    await openApp(page);
    await expect(card(page, 'Jan')).toBeVisible();
    return { page, bridge };
}

test.describe('more than one window on one research', () => {
    test.use({ viewport: DESKTOP });

    test('undoing the quiet load takes the head back with the data', async ({ page }) => {
        const bridge = await autoTree(page);
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => head(page)).toBe('ab10cd10ef10');
        await expect.poll(async () => (await storedBase(page))?.head).toBe('ab10cd10ef10');

        // Undo the load: the data before it, and the head they build on.
        await page.evaluate(() => window.Strom.DataManager.undo());
        expect(await head(page)).toBe(HEAD);
        await expect.poll(async () => (await storedBase(page))?.head).toBe(HEAD);

        // The next send names that head, never the newer one with the older data.
        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(2);
        expect(bridge.posts[1]).toContain(`1 _STROM_HEAD ${HEAD}`);
    });

    test('a window whose copy another window overwrote sends nothing, until it reloads', async ({ page }) => {
        const bridge = await autoTree(page);
        const second = await secondWindow(page);
        // The other window saves the tree: this window's copy is stale.
        await editJan(second.page, 'Kolín');
        await expect(page.locator('#other-tab-notice')).toBeVisible();

        await editJan(page, 'Brno');
        await page.clock.fastForward(QUIET * 2);
        expect(bridge.posts).toHaveLength(0);
        // By hand: said why, with a reload.
        await page.evaluate(() => window.Strom.UI.researchSendNow());
        await expect(page.locator('.toast')).toContainText('saved in another window');
        expect(bridge.posts).toHaveLength(0);

        // Reloaded: current again, it sends (the other window's data).
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await editJan(page, 'Tábor');
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => bridge.posts.length).toBe(1);
        await second.page.close();
    });

    test('opened again, a tree takes the head stored with its data, not a newer one another window wrote to the index', async ({ page }) => {
        await autoTree(page);
        const second = await secondWindow(page);
        // The first window writes and loads the research's new version (head ab10…).
        await editJan(page);
        await page.clock.fastForward(QUIET + 1000);
        await expect.poll(() => head(page)).toBe('ab10cd10ef10');
        // The second window still holds the older data and head, and saves them.
        expect(await head(second.page)).toBe(HEAD);
        await second.page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const josef = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Josef') as any;
            dm.updatePerson(josef.id, { birthPlace: 'Kolín' });
        });
        await expect.poll(async () => (await storedBase(second.page))?.head).toBe(HEAD);
        // The first window writes the index again (with its newer head).
        await page.evaluate(() => window.Strom.TreeManager.setActiveTree(window.Strom.TreeManager.getActiveTreeId()!));

        // A third window opens the tree: the second window's data, with the head they build on.
        const third = await page.context().newPage();
        await fakeBridge(third, { accepts });
        await openApp(third);
        await expect(card(third, 'Josef')).toBeVisible();
        const josefPlace = await third.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons)
            .find((p: any) => p.firstName === 'Josef') as any).birthPlace);
        expect(josefPlace).toBe('Kolín');
        await expect.poll(() => head(third)).toBe(HEAD);
        await second.page.close();
        await third.close();
    });
});
