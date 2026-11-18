import { test, expect, Page } from '@playwright/test';
import {
    HEAD, NEW_HEAD, block, editJan, fakeBridge, openResearch, openResearchMenu, poll, researchGed, FakeBridge,
} from './research-bridge.js';

/**
 * Waiting buttons, part 2: Send from the click to its end (one POST however often it is asked, the bar's
 * button in its working state and ✓ "Written", a failure in a toast with Try again and Export GEDCOM), and
 * loading the research's version (one download, its progress toast with a bar, Cancel while it downloads
 * leaves the tree, edits wait meanwhile).
 */

const WRITE = { status: 200, body: { ok: true, inbox: false, changes: 6, applied: 6, input: 'I0042' } };
const HAND = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };

function writesAtOnce(bridge: FakeBridge): void {
    let n = 0;
    bridge.syncReply = WRITE;
    bridge.onWrite = () => {
        n++;
        const head = `ab${n}0cd${n}0ef${n}0`;
        return { head, ged: researchGed(head, ['1 BIRT', '2 PLAC Praha']) };
    };
}

const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);
const sendButton = (page: Page) => page.locator('#research-sync-send');

test.describe('Send by hand', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
    });

    test('a double click sends once; the bar\'s button works, then says Written', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: HAND });
        writesAtOnce(bridge);
        bridge.syncDelayMs = 700;
        await poll(page);
        await editJan(page);
        const send = sendButton(page);
        await expect(send).toBeVisible();
        await send.dblclick();
        await expect(send).toHaveAttribute('aria-disabled', 'true');
        await expect(send).toHaveAttribute('data-busy', 'busy');
        await expect(send).toContainText('Sending…');
        await expect(send).toHaveAttribute('data-busy', 'done');
        await expect(send).toContainText('Written');
        await expect(page.locator('.toast')).toContainText('Written to the research, 6 changes.');
        expect(bridge.posts.length).toBe(1);
        // After the ✓ the bar shows the state anew: nothing left to send.
        await expect(send).toHaveCount(0);
    });

    test('Send from the research menu: the bar\'s button carries the state; asked twice, one POST', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: HAND });
        writesAtOnce(bridge);
        bridge.syncDelayMs = 700;
        await poll(page);
        await editJan(page);
        await expect(sendButton(page)).toBeVisible();
        await openResearchMenu(page);
        await block(page).locator('[data-action="send"]').click();
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect(sendButton(page)).toHaveAttribute('data-busy', 'busy');
        await expect(sendButton(page)).toHaveAttribute('data-busy', 'done');
        expect(bridge.posts.length).toBe(1);
    });

    test('the bridge gone mid-send: a toast with its heading, Try again and Export GEDCOM; nothing under the toolbar', async ({ page }) => {
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: HAND });
        await poll(page);
        await editJan(page);
        await expect(sendButton(page)).toBeVisible();
        bridge.syncAbort = true;
        await sendButton(page).click();
        const toast = page.locator('.toast').filter({ hasText: 'Writing to the research did not work.' });
        await expect(toast).toBeVisible();
        await expect(toast.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(toast.getByRole('button', { name: 'Export GEDCOM' })).toBeVisible();
        // No sentence under the toolbar's button: the toast says it.
        await expect(page.locator('#research-sync-pill .busy-msg')).toHaveCount(0);
    });
});

test.describe('loading the research\'s version', () => {
    async function newer(page: Page): Promise<FakeBridge> {
        await openResearch(page);
        const bridge = await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        await poll(page);
        return bridge;
    }
    const loadToast = (page: Page) => page.locator('.toast[data-kind="tree-load"]');

    test('asked twice: one download, its toast with a bar and the edits waiting; then the version', async ({ page }) => {
        const bridge = await newer(page);
        bridge.treeDelayMs = 1200;
        const before = bridge.treeGets ?? 0;
        await page.evaluate(() => {
            window.Strom.UI.researchSyncAction('loadNewer');
            window.Strom.UI.researchSyncAction('loadNewer');
        });
        await expect(loadToast(page)).toBeVisible();
        await expect(loadToast(page).locator('.toast-title')).toHaveText('Loading the tree from the research…');
        await expect(loadToast(page)).toContainText('edits wait for the load');
        await expect(loadToast(page).locator('.bar')).toBeVisible();
        await expect(loadToast(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect.poll(() => head(page), { timeout: 10_000 }).toBe(NEW_HEAD);
        await expect(loadToast(page)).toHaveCount(0);
        expect((bridge.treeGets ?? 0) - before).toBe(1);
    });

    test('Cancel while it downloads: the tree stays as it was, nothing asked', async ({ page }) => {
        const bridge = await newer(page);
        bridge.treeDelayMs = 3000;
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(loadToast(page)).toBeVisible();
        await loadToast(page).getByRole('button', { name: 'Cancel' }).click();
        await expect(loadToast(page)).toHaveCount(0);
        await page.waitForTimeout(3500);
        expect(await head(page)).toBe(HEAD);
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(page.locator('#confirmation-modal.active')).toHaveCount(0);
    });

    test('an edit saved while it loads makes no change, a toast says why', async ({ page }) => {
        const bridge = await newer(page);
        bridge.treeDelayMs = 3000;
        await page.evaluate(() => {
            const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
            window.Strom.UI.runPersonMenuAction(jan.id, 'edit');
        });
        const modal = page.locator('#person-modal');
        await expect(modal).toBeVisible();
        // The opening's own message off the screen (a message to be read holds the next one for 3 s).
        await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(loadToast(page)).toBeVisible();
        await modal.locator('#input-firstname').fill('Honza');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('.toast[data-kind="edit-lock"]')).toHaveText('The tree is loading from the research – edits are possible after loading.');
        await expect(modal).toBeVisible();
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().some(p => p.firstName === 'Honza'))).toBe(false);
        // After the load, edits go again.
        await expect(loadToast(page)).toHaveCount(0, { timeout: 10_000 });
    });
});

test.describe('a progress toast and a message to be read', () => {
    test('a progress toast coming after "Research version loaded" with Restore waits under it; an informative one or one that stays gives way', async ({ page }) => {
        await openResearch(page);
        const shown = page.locator('body > .toast:not(.toast-held)');
        // A message with its action and its own time: a progress toast started after it waits under it.
        await page.evaluate(() => {
            const UI = window.Strom.UI as any;
            UI.showToast('Research version loaded.', 4000, { action: { label: 'Restore the state before loading', run: () => undefined } });
            (window as any).__p = UI.showProgressToast({ title: 'Opening the research…' }, {});
        });
        await expect(shown).toHaveCount(1);
        await expect(shown).toContainText('Research version loaded.');
        await expect(shown.getByRole('button', { name: 'Restore the state before loading' })).toBeVisible();
        // Its time over: the progress toast shows.
        await expect(shown).toContainText('Opening the research…', { timeout: 6000 });
        await page.evaluate(() => (window as any).__p.close());

        // A mere message, or one that stays until closed: the progress toast shows over it at once.
        for (const stays of [false, true]) {
            await page.evaluate((closable) => {
                const UI = window.Strom.UI as any;
                UI.showToast('A message.', closable ? Infinity : 4000,
                    closable ? { closable, action: { label: 'Try again', run: () => undefined } } : {});
                (window as any).__p = UI.showProgressToast({ title: 'Loading the tree…' }, {});
            }, stays);
            await expect(shown).toHaveCount(1);
            await expect(shown).toContainText('Loading the tree…');
            await page.evaluate(() => (window as any).__p.close());
        }
    });
});

test.describe('a toast with two actions', () => {
    for (const width of [1440, 390]) {
        test(`its actions stand apart, never glued together (${width} px)`, async ({ page }) => {
            await page.setViewportSize({ width, height: 860 });
            await openResearch(page);
            const gapOf = (sel: string) => page.evaluate((s) => {
                const acts = [...document.querySelectorAll(`${s} .toast-actions > .toast-action`)]
                    .filter(b => !(b as HTMLElement).hidden).map(b => b.getBoundingClientRect());
                return acts.length < 2 ? -1 : acts[1].left - acts[0].right;
            }, sel);
            // The progress toast: Cancel the wait + Install…
            await page.evaluate(() => {
                (window as any).__p = (window.Strom.UI as any).showProgressToast(
                    { title: 'Waiting for the research…', cancel: () => undefined, more: { label: 'Install…', run: () => undefined } }, {});
            });
            await expect(page.locator('.toast--progress .toast-action')).toHaveCount(2);
            await expect.poll(() => gapOf('.toast--progress')).toBeGreaterThanOrEqual(10);
            // Cancel hidden by a step: the one left has no gap before it.
            await page.evaluate(() => (window as any).__p.update({ step: 'A step', cancel: false }));
            const lead = await page.evaluate(() => {
                const t = document.querySelector('.toast--progress .toast-actions')!;
                const b = [...t.querySelectorAll('.toast-action')].find(x => !(x as HTMLElement).hidden)!;
                return getComputedStyle(b).marginLeft;
            });
            expect(lead).toBe('0px');
            await page.evaluate(() => (window as any).__p.close());
            // A message's own two actions.
            await page.evaluate(() => {
                (window.Strom.UI as any).showToast('The terminal did not open?', Infinity, {
                    closable: true,
                    action: { label: 'Try again', run: () => undefined },
                    more: { label: 'Install…', run: () => undefined },
                });
            });
            await expect.poll(() => gapOf('body > .toast:not(.toast--progress):not(.toast-held)')).toBeGreaterThanOrEqual(10);
        });
    }
});
