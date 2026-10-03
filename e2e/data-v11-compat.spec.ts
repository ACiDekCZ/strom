import { test, expect } from '@playwright/test';
import { openApp, seedResearchPromoSeen } from './helpers.js';

/**
 * Data format 10 -> 11 (Strom 3.8 -> 3.9) through the real app: a tree saved
 * by 3.8.1 imports with everything kept and is stored as v11; data from a
 * NEWER app (embedded in an HTML file, or a newer browser database) is never
 * taken in silently. Invented data only.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A small tree in the shape 3.8.1 exports (data version 10). */
function v10Tree(version = 10): Record<string, unknown> {
    return {
        version,
        persons: {
            p1: {
                id: 'p1', firstName: 'Jan', lastName: 'Zkousek', gender: 'male', isPlaceholder: false,
                partnerships: ['u1'], parentIds: [], childIds: ['p3'], birthDate: '1890', birthSourceIds: ['s1'], photo: PNG,
                events: [{ id: 'e1', type: 'residence', date: '1920', place: 'Praha', sourceIds: ['s1'] }],
                attachments: [{ id: 'a1', name: 'page.png', mimeType: 'image/png', dataUrl: PNG, sizeBytes: 70, sourceId: 's1' }],
            },
            p2: { id: 'p2', firstName: 'Marie', lastName: 'Zkouskova', gender: 'female', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: ['p3'] },
            p3: { id: 'p3', firstName: 'Karel', lastName: 'Zkousek', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: ['p1', 'p2'], childIds: [] },
        },
        partnerships: {
            u1: {
                id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: ['p3'], status: 'married', startDate: '1915', sourceIds: ['s1'],
                events: [{ id: 'ce1', type: 'banns', date: '1915-04', place: 'Brno', sourceIds: ['s1'] }],
            },
        },
        sources: {
            s1: {
                id: 's1', title: 'Matrika Brno 1915', transcript: 'Jan a Marie oddani',
                excerpts: [{ id: 'x1', dataUrl: PNG, width: 1, height: 1, sizeBytes: 70 }],
            },
        },
    };
}

test('a 3.8.1 (v10) JSON tree imports with everything kept and is stored as v11', async ({ page }) => {
    await openApp(page);
    await page.locator('#file-input').setInputFiles({ name: 'strom-381.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v10Tree())) });

    // An older format is no warning (no "Validation failed"): straight to the import, images along (the setting).
    await expect(page.locator('#validation-modal')).not.toHaveClass(/active/);

    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill('From 3.8.1');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();

    const stored = await page.evaluate(async () => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        const d = await window.Strom.TreeManager.getTreeData(id);
        const p1 = d!.persons['p1' as never] as { photo?: string; events?: unknown[]; attachments?: unknown[]; birthSourceIds?: string[] };
        const u1 = d!.partnerships['u1' as never] as { events?: unknown[]; sourceIds?: string[] };
        return {
            version: d!.version, persons: Object.keys(d!.persons).length, partnerships: Object.keys(d!.partnerships).length,
            photo: !!p1.photo, events: p1.events?.length, attachments: p1.attachments?.length, birthSources: p1.birthSourceIds,
            coupleEvents: u1.events?.length, coupleSources: u1.sourceIds,
            excerpts: d!.sources?.s1?.excerpts?.length, transcript: d!.sources?.s1?.transcript,
        };
    });
    expect(stored).toEqual({
        version: 11, persons: 3, partnerships: 1, photo: true, events: 1, attachments: 1, birthSources: ['s1'],
        coupleEvents: 1, coupleSources: ['s1'], excerpts: 1, transcript: 'Jan a Marie oddani',
    });
    await expect(page.locator('.person-card').first()).toBeVisible();
});

test('newer data embedded in an HTML file opens read-only, its import disabled', async ({ page }) => {
    await seedResearchPromoSeen(page);
    // What an exported HTML file carries in its head (src/export.ts), here from a future app.
    const envelope = { exportId: 'exp_future', exportedAt: '2027-01-01T00:00:00.000Z', appVersion: '9.0.0', treeName: 'Future', data: v10Tree(99) };
    await page.addInitScript((env) => { (window as unknown as { STROM_EMBEDDED_DATA: unknown }).STROM_EMBEDDED_DATA = env; }, envelope);
    await page.goto('/strom.html');

    const modal = page.locator('#newer-version-viewmode-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#viewmode-your-version')).toHaveText('11');
    await expect(modal.locator('#viewmode-data-version')).toHaveText('99');
    await modal.getByRole('button', { name: 'View only (read-only)' }).click();

    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(page.locator('.person-card').first()).toBeVisible();
    expect(await page.evaluate(() => window.Strom.DataManager.isImportBlocked())).toBe(true);
    // Nothing of the newer file reached the browser's storage.
    const stored = await page.evaluate(async () => {
        const trees = window.Strom.TreeManager.getTrees();
        let persons = 0;
        for (const t of trees) persons += Object.keys((await window.Strom.TreeManager.getTreeData(t.id))?.persons ?? {}).length;
        return persons;
    });
    expect(stored).toBe(0);
});

test('a browser database left by a newer app: this build still starts, opens it as it is and keeps the trees', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();
    // A newer build upgrades the database (as 3.9 did to one of 3.8.1): this
    // tab's connection closes, and the reload opens it with a lower version.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('strom-db', 99);
        req.onupgradeneeded = () => req.result.createObjectStore('future');
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
    }));
    await page.reload();
    // No "storage could not be opened": the tree is there.
    await expect(page.locator('.person-card').first()).toBeVisible();
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map(d => ({ name: d.name, version: d.version })));
    expect(dbs).toContainEqual({ name: 'strom-db', version: 99 });
});
