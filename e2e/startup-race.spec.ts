import { test, expect } from '@playwright/test';
import { seedResearchPromoSeen, seedSetting, fillPerson, waitForPersist } from './helpers.js';

/**
 * Startup race: the toolbar is on screen before DataManager.init() has read
 * the startup tree. A person added in that window used to reach storage and
 * then vanish — the load finished with the tree as it was read before the
 * edit and overwrote it. Until the tree is in, the toolbar takes no clicks
 * (html.app-loading); a click made meanwhile lands once it is.
 *
 * The slow read is simulated by delaying the success callbacks of IndexedDB
 * reads of the `trees` store during the first seconds (a big tree or a slow
 * device takes that long for real).
 */

test('a person added while the startup tree is still loading is kept', async ({ page }) => {
    await seedResearchPromoSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await page.addInitScript(() => {
        const t0 = Date.now();
        const origGet = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey) {
            const req = origGet.call(this, key);
            if (Date.now() - t0 < 4000 && this.name === 'trees') {
                const desc = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
                let handler: ((e: Event) => void) | null = null;
                Object.defineProperty(req, 'onsuccess', {
                    set(h) {
                        handler = h;
                        desc.set!.call(req, (e: Event) => setTimeout(() => handler?.call(req, e), 2500));
                    },
                    get() { return handler; },
                });
            }
            return req;
        };
    });
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.getByRole('button', { name: 'Add person' }).first().click();
    await fillPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');

    // Startup finishes (the switcher names the tree); Jan must still be there.
    await expect(page.locator('#current-tree-name')).not.toHaveText('...', { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() =>
        window.Strom.DataManager.getAllPersons().map((p: { firstName: string }) => p.firstName))).toEqual(['Jan']);
    const stored = await page.evaluate(async () => {
        const tm = window.Strom.TreeManager;
        const data = await tm.getTreeData(tm.getActiveTreeId());
        return Object.values(data?.persons ?? {}).map(p => (p as { firstName: string }).firstName);
    });
    expect(stored).toEqual(['Jan']);
});
