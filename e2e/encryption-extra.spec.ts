import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, waitForPersist } from './helpers.js';

/**
 * Local encryption beyond switching it on: the password-setup validation,
 * switching it OFF again (wrong password refused, right password leaves every
 * store readable without a password after a reload), and a tree encrypted
 * under another password (another tab changed it) asking for THAT tree's
 * password and re-encrypting it with the session key.
 */

const PASSWORD = 'linden-tree-42';
const OTHER_PASSWORD = 'spruce-tree-99';

/** Serialized content of every object store of the app's IndexedDB. */
function dumpDb(page: Page): Promise<string> {
    return page.evaluate(() => new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const db = req.result;
            const names = Array.from(db.objectStoreNames);
            const tx = db.transaction(names, 'readonly');
            const out: Record<string, unknown> = {};
            for (const name of names) {
                const all = tx.objectStore(name).getAll();
                all.onsuccess = () => { out[name] = all.result; };
            }
            tx.oncomplete = () => resolve(JSON.stringify(out));
            tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
    }));
}

/**
 * Backup payload records: their form ('gzip' plain / 'encrypted') and, for the
 * plain ones, the decompressed text.
 */
function snapshotPayloads(page: Page): Promise<Array<{ kind: string; text: string }>> {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const all = req.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
            all.onsuccess = async () => {
                const out: Array<{ kind: string; text: string }> = [];
                for (const rec of all.result as Array<{ meta?: unknown; gzip?: string; encrypted?: unknown }>) {
                    if (!rec.meta) continue;
                    if (typeof rec.gzip === 'string') {
                        const bytes = Uint8Array.from(atob(rec.gzip), c => c.charCodeAt(0));
                        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
                        out.push({ kind: 'gzip', text: await new Response(stream).text() });
                    } else {
                        out.push({ kind: rec.encrypted ? 'encrypted' : 'other', text: '' });
                    }
                }
                resolve(out);
            };
            all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
    }));
}

async function openSettings(page: Page) {
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    return settings;
}

/** Switch encryption on with `password` through the settings dialog (left open). */
async function enableEncryption(page: Page, password: string): Promise<void> {
    const settings = await openSettings(page);
    await settings.locator('#encryption-toggle').check();
    const setup = page.locator('#password-setup-modal');
    await expect(setup).toBeVisible();
    await setup.locator('#password-setup-input').fill(password);
    await setup.locator('#password-setup-confirm').fill(password);
    await setup.getByRole('button', { name: 'Save' }).click();
    await expect(setup).toBeHidden();
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
}

async function submitPrompt(page: Page, password: string): Promise<void> {
    const prompt = page.locator('#password-prompt-modal');
    await prompt.locator('#password-prompt-input').fill(password);
    await prompt.locator('#password-prompt-input').press('Enter');
}

test('password setup refuses a short password and a mismatch; Cancel leaves encryption off', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');

    const settings = await openSettings(page);
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption disabled');
    await settings.locator('#encryption-toggle').check();
    const setup = page.locator('#password-setup-modal');
    await expect(setup).toBeVisible();
    const error = setup.locator('#password-setup-error');
    await expect(error).toBeHidden();

    // Too short (checked before the match).
    await setup.locator('#password-setup-input').fill('abc');
    await setup.locator('#password-setup-confirm').fill('abc');
    await setup.getByRole('button', { name: 'Save' }).click();
    await expect(error).toHaveText('Password must be at least 6 characters');
    await expect(setup).toBeVisible();

    // Long enough but not matching. Enter in the first field moves to the
    // second; Enter in the second submits.
    await setup.locator('#password-setup-input').fill(PASSWORD);
    await setup.locator('#password-setup-input').press('Enter');
    await expect(setup.locator('#password-setup-confirm')).toBeFocused();
    await setup.locator('#password-setup-confirm').fill(`${PASSWORD}-typo`);
    await setup.locator('#password-setup-confirm').press('Enter');
    await expect(error).toHaveText('Passwords do not match');
    await expect(setup).toBeVisible();

    // Nothing was switched on or encrypted by the refused attempts.
    expect(await page.evaluate(() => window.Strom.SettingsManager.isEncryptionEnabled())).toBe(false);
    const db = await dumpDb(page);
    expect(db).toContain('Jan');
    expect(db).not.toContain('"encrypted":true');

    // Cancel: the toggle goes back off.
    await setup.getByRole('button', { name: 'Cancel' }).click();
    await expect(setup).toBeHidden();
    await expect(settings.locator('#encryption-toggle')).not.toBeChecked();
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption disabled');

    // Reopening the setup starts with empty fields and no stale error.
    await settings.locator('#encryption-toggle').check();
    await expect(setup).toBeVisible();
    await expect(setup.locator('#password-setup-input')).toHaveValue('');
    await expect(error).toBeHidden();
});

test('switching encryption off: wrong password refused, right one leaves trees and backups readable without a password', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');
    await waitForPersist(page, 'Marie');
    // A manual backup, so the side stores are converted too.
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const snapshots = page.locator('#snapshots-modal');
    await snapshots.getByRole('button', { name: 'Create backup now' }).click();
    await expect(snapshots.locator('.snapshot-row').first()).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

    await enableEncryption(page, PASSWORD);
    await expect.poll(async () => {
        const db = await dumpDb(page);
        return db.includes('"encrypted":true') && !db.includes('Marie');
    }).toBe(true);
    await expect.poll(async () => {
        const kinds = (await snapshotPayloads(page)).map(b => b.kind);
        return kinds.length > 0 && kinds.every(k => k === 'encrypted');
    }).toBe(true);

    // Untick the toggle: the password is asked first.
    const settings = page.locator('#settings-modal');
    await settings.locator('#encryption-toggle').uncheck();
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();

    await submitPrompt(page, 'not-the-password');
    await expect(prompt.locator('#password-prompt-error')).toHaveText('Incorrect password');
    await expect(prompt).toBeVisible();
    await expect(settings.locator('#encryption-toggle')).toBeChecked();
    expect(await page.evaluate(() => window.Strom.SettingsManager.isEncryptionEnabled())).toBe(true);

    await submitPrompt(page, PASSWORD);
    await expect(prompt).toBeHidden();
    await expect(settings.locator('#encryption-status')).toHaveText('Encryption disabled');
    await expect(settings.locator('#encryption-toggle')).not.toBeChecked();
    await expect(page.locator('.toast', { hasText: 'Encryption disabled' })).toBeVisible();

    // Every store is plaintext again: the tree and the backup.
    await expect.poll(async () => {
        const db = await dumpDb(page);
        return !db.includes('"encrypted":true') && db.includes('Marie');
    }).toBe(true);
    // The backup payload is a plain gzip again (not ciphertext) holding the tree.
    const backups = await snapshotPayloads(page);
    expect(backups.length).toBeGreaterThan(0); // the manual one (+ an automatic one)
    expect(backups.every(b => b.kind === 'gzip')).toBe(true);
    expect(backups.some(b => b.text.includes('Marie'))).toBe(true);

    // Reload: no password prompt, the tree is there and editable.
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(prompt).toBeHidden();
    await expect(page.locator('#locked-data-notice')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.SettingsManager.isEncryptionEnabled())).toBe(false);

    // Every backup is still listed.
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(snapshots.locator('.snapshot-row')).toHaveCount(backups.length);
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await waitForPersist(page, 'Petr');
});

test('a tree re-encrypted under another password in another tab asks for that password and is re-keyed', async ({ page, context }) => {
    await openApp(page);
    // Tree 1: Jan; tree 2 ("Second tree"): Karel. Tree 1 stays active.
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const newTree = page.locator('#new-tree-modal');
    await newTree.locator('#new-tree-name').fill('Second tree');
    await newTree.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await createFirstPerson(page, 'Karel', 'Dvorak');
    await waitForPersist(page, 'Karel');
    const secondId: string = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    const firstName: string = await page.evaluate((sid) =>
        window.Strom.TreeManager.getTrees().find((t: { id: string }) => t.id !== sid)!.name, secondId);
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: firstName }).first().click();
    await expect(card(page, 'Jan')).toBeVisible();

    // Tab A switches encryption on with PASSWORD.
    await enableEncryption(page, PASSWORD);
    await page.keyboard.press('Escape');
    await expect.poll(async () => !(await dumpDb(page)).includes('Karel')).toBe(true);

    // Tab B unlocks, switches encryption off and on again with OTHER_PASSWORD:
    // every tree is now under a key tab A's session does not hold.
    const tabB = await context.newPage();
    await openApp(tabB);
    await expect(tabB.locator('#password-prompt-modal')).toBeVisible();
    await submitPrompt(tabB, PASSWORD);
    await expect(card(tabB, 'Jan')).toBeVisible();
    const settingsB = await openSettings(tabB);
    await settingsB.locator('#encryption-toggle').uncheck();
    await expect(tabB.locator('#password-prompt-modal')).toBeVisible();
    await submitPrompt(tabB, PASSWORD);
    await expect(settingsB.locator('#encryption-status')).toHaveText('Encryption disabled');
    await settingsB.locator('#encryption-toggle').check();
    const setupB = tabB.locator('#password-setup-modal');
    await setupB.locator('#password-setup-input').fill(OTHER_PASSWORD);
    await setupB.locator('#password-setup-confirm').fill(OTHER_PASSWORD);
    await setupB.getByRole('button', { name: 'Save' }).click();
    await expect(setupB).toBeHidden();
    await expect(settingsB.locator('#encryption-status')).toHaveText('Encryption enabled');
    await tabB.close();

    // Tab A opens the second tree: it cannot be read with the session key, so
    // the prompt asks for THAT tree's password (with its own explanation).
    await page.evaluate(() => document.getElementById('other-tab-notice')?.remove());
    await page.locator('.tree-switcher-btn').click();
    await page.locator('.tree-switcher-item', { hasText: 'Second tree' }).first().click();
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();
    await expect(prompt.locator('.modal-description')).toContainText('encrypted with a different password');

    // The session's own password does not open it.
    await submitPrompt(page, PASSWORD);
    await expect(prompt.locator('#password-prompt-error')).toHaveText('Incorrect password');
    await expect(prompt).toBeVisible();

    // The other tab's password does: the tree loads and is re-keyed.
    await submitPrompt(page, OTHER_PASSWORD);
    await expect(prompt).toBeHidden();
    await expect(page.locator('.toast', { hasText: 'Tree unlocked and re-encrypted' })).toBeVisible();
    await expect(card(page, 'Karel')).toBeVisible();
    await expect(page.locator('#locked-data-notice')).toHaveCount(0);
    // The shared prompt got its generic description back.
    await expect(prompt.locator('.modal-description')).not.toContainText('different password');

    // Stored ciphertext only, now readable with tab A's session key.
    const db = await dumpDb(page);
    expect(db).not.toContain('Karel');
    const names = await page.evaluate(async (sid) => {
        const data = await window.Strom.TreeManager.getTreeData(sid);
        return data ? Object.values(data.persons).map((p) => (p as { firstName: string }).firstName) : null;
    }, secondId);
    expect(names).toEqual(['Karel']);
    // And it saves normally again.
    await addRelation(page, 'Karel', 'child', 'Ota', 'Dvorak');
    await expect.poll(() => page.evaluate(async (sid) => {
        const data = await window.Strom.TreeManager.getTreeData(sid);
        return data ? (Object.values(data.persons) as Array<{ firstName: string; isPlaceholder?: boolean }>)
            .filter(p => !p.isPlaceholder).map(p => p.firstName).sort() : null;
    }, secondId)).toEqual(['Karel', 'Ota']);
});
