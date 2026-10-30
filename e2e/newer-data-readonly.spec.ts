import { test, expect, type Page } from '@playwright/test';
import { openApp, seedTree, card } from './helpers.js';

/**
 * A tree a NEWER app saved (its data version above this build's) opens
 * read-only — at the start and when switched to: a bar says why and how to
 * get out (update the app), the edit entry points are gone, and the stored
 * record is never written, not even a view state. Invented data only.
 */

/** The stored record of a tree, read straight from the browser database. */
function readRecord(page: Page, treeId: string): Promise<Record<string, unknown>> {
    return page.evaluate((id) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const get = req.result.transaction('trees', 'readonly').objectStore('trees').get(id);
            get.onsuccess = () => { req.result.close(); resolve(get.result as Record<string, unknown>); };
            get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
    }), treeId);
}

/**
 * What a newer app leaves: the same tree with a higher version, a field this
 * build does not know and "open where it was left" (a view state it would write).
 */
async function makeNewer(page: Page, treeId: string): Promise<Record<string, unknown>> {
    await page.evaluate(() => window.Strom.TreeManager.flush());
    const record = await readRecord(page, treeId);
    const newer = { ...record, version: 99, futureField: { kept: true }, defaultPersonId: '__last_focused__' };
    await page.evaluate(({ id, value }) => new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const tx = req.result.transaction('trees', 'readwrite');
            tx.objectStore('trees').put(value, id);
            tx.oncomplete = () => { req.result.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
    }), { id: treeId, value: newer });
    return newer;
}

async function expectReadOnly(page: Page): Promise<void> {
    const bar = page.locator('#newer-data-notice');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('saved by a newer version of the app');
    await expect(bar).toContainText('Updating the app');
    await expect(page.locator('body')).toHaveClass(/data-newer/);
    await expect(page.locator('.btn-add-person')).toBeHidden();
    await expect(page.locator('.person-card .add-btn:visible')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(true);
}

/** Things that write the tree record in an editable tree: a focus change (last focused), Ctrl+Z, an edit. */
async function tryToWrite(page: Page, personId: string): Promise<void> {
    await page.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), personId);
    await page.keyboard.press('Control+z');
    const created = await page.evaluate(() => {
        try {
            window.Strom.DataManager.createPerson({ firstName: 'Intruder', lastName: 'Newer', gender: 'male' });
            return true;
        } catch {
            return false;
        }
    });
    expect(created).toBe(false);
    await page.evaluate(() => window.Strom.TreeManager.flush());
}

test('a tree a newer app saved, opened at the start: read-only with the bar, its record never written', async ({ page }) => {
    await openApp(page);
    await seedTree(page, {
        jan: { firstName: 'Jan', lastName: 'Zkousek', partners: ['eva'] },
        eva: { firstName: 'Eva', lastName: 'Zkouskova', gender: 'female', partners: ['jan'] },
    }, 'Future');
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    const newer = await makeNewer(page, treeId);

    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    // No blocking dialog any more: the tree is shown as stored.
    await expect(page.locator('#newer-version-storage-modal')).not.toHaveClass(/active/);
    await expect(card(page, 'Jan')).toBeVisible();
    await expectReadOnly(page);

    await tryToWrite(page, 'eva');
    expect(await readRecord(page, treeId)).toEqual(newer);
});

test('switching to a tree a newer app saved: read-only with the bar; back on a tree of this version, editing works', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { anna: { firstName: 'Anna', lastName: 'Kvitkova', gender: 'female' } }, 'Current');
    const current = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    await seedTree(page, {
        jan: { firstName: 'Jan', lastName: 'Zkousek', partners: ['eva'] },
        eva: { firstName: 'Eva', lastName: 'Zkouskova', gender: 'female', partners: ['jan'] },
    }, 'Future');
    const future = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), current);
    await expect(card(page, 'Anna')).toBeVisible();
    const newer = await makeNewer(page, future);

    await page.evaluate((id) => window.Strom.UI.switchToTree(id), future);
    await expect(card(page, 'Jan')).toBeVisible();
    await expectReadOnly(page);
    await tryToWrite(page, 'eva');
    expect(await readRecord(page, future)).toEqual(newer);

    // Another tree: the bar goes, editing is back.
    await page.evaluate((id) => window.Strom.UI.switchToTree(id), current);
    await expect(card(page, 'Anna')).toBeVisible();
    await expect(page.locator('#newer-data-notice')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/data-newer/);
    expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(false);
    await expect(page.locator('.btn-add-person')).toBeVisible();
});

test('the read-only bar says it in the new language at once when the UI language changes', async ({ page }) => {
    await openApp(page);
    await seedTree(page, { jan: { firstName: 'Jan', lastName: 'Zkousek' } }, 'Future');
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    const newer = await makeNewer(page, treeId);
    await page.reload();
    await expect(card(page, 'Jan')).toBeVisible();
    await expectReadOnly(page);

    const bar = page.locator('#newer-data-notice');
    await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
    await expect(bar).toContainText('Tento strom uložila novější verze aplikace');
    await expect(bar.locator('.pwa-update-close')).toHaveAttribute('aria-label', 'Zavřít');
    await page.evaluate(() => window.Strom.UI.setLanguage('de'));
    await expect(bar).toContainText('Dieser Stammbaum wurde von einer neueren Version der App gespeichert');
    await expect(bar).not.toContainText('Tento strom');
    expect(await readRecord(page, treeId)).toEqual(newer);
});
