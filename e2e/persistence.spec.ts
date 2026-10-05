import { test, expect, Page } from '@playwright/test';
import { openApp, fillPerson, exportTreeJson, createFirstPerson, cardAction, personModal, card } from './helpers.js';

/** Import the 53-person fixture as a new tree (it has no version: no warning, straight to the dialog). */
async function importBigTree(page: Page, name: string): Promise<void> {
    await page.locator('#file-input').setInputFiles('test/comprehensive.json');
    // No version in the file: read as it is, no warning (straight to the import dialog).
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

/** Make the browser keep storage best-effort (refuse persistence) or grant it. */
async function stubPersistence(page: Page, granted: boolean): Promise<void> {
    await page.addInitScript((ok) => {
        let persistent = false;
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                ...(navigator.storage ? { estimate: navigator.storage.estimate.bind(navigator.storage), getDirectory: navigator.storage.getDirectory?.bind(navigator.storage) } : {}),
                persisted: async () => persistent,
                persist: async () => { persistent = ok; (window as unknown as { __persistAsked: number }).__persistAsked = ((window as unknown as { __persistAsked?: number }).__persistAsked ?? 0) + 1; return ok; },
            },
        });
    }, granted);
}

/** A user edit: add an unconnected person from the toolbar. */
async function addPerson(page: Page, firstName: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, firstName, 'Edit');
    await expect(page.locator('#person-modal')).toBeHidden();
}

test('edits no file holds: an information-only notice, the indicator until the next save', { tag: '@smoke' }, async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page, { fileCopyReminders: true });
    const notice = page.locator('#file-copy-notice');
    const indicator = page.locator('#unsaved-copy-indicator');

    // An imported tree has its file: nothing to say yet.
    await importBigTree(page, 'Persistence');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(notice).toHaveCount(0);
    await expect(indicator).toBeHidden();

    // The first edit: notice + indicator. The notice only informs: no button
    // but the "Where is my data?" link and the close.
    await addPerson(page, 'First');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Persistence');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice.locator('button')).toHaveCount(2);
    await expect(notice.getByRole('button', { name: 'Where is my data?' })).toBeVisible();
    await expect(indicator).toBeVisible();
    await expect(indicator.locator('.storage-pill-icon path')).toHaveCount(3);

    // Closed: not back on further edits, nor after a reload.
    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toHaveCount(0);
    await addPerson(page, 'Second');
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(indicator).toBeVisible();
    await addPerson(page, 'Third');
    await page.waitForTimeout(300);
    await expect(notice).toHaveCount(0);

    // Saved and changed again the same day: still quiet (at most once a day).
    await exportTreeJson(page);
    await expect(indicator).toHaveClass(/is-saved/);
    await expect(indicator).toBeHidden({ timeout: 6000 });
    await addPerson(page, 'Fourth');
    await expect(indicator).toBeVisible();
    await page.waitForTimeout(300);
    await expect(notice).toHaveCount(0);

    // A day after closing: the next edit brings the reminder back.
    await page.evaluate(() => {
        const id = window.Strom.DataManager.getCurrentTreeId()!;
        const meta = window.Strom.TreeManager.getTreeMetadata(id)!;
        meta.fileCopyNoticeClosedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    });
    await addPerson(page, 'Fifth');
    await expect(notice).toBeVisible();

    // Not closed: it is there after a reload too.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(notice).toBeVisible();

    // The link opens "Where the data is".
    await notice.getByRole('button', { name: 'Where is my data?' }).click();
    const dialog = page.locator('#storage-status-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('may clear it');
    await expect(dialog).toContainText('Changes made since then are only in the browser');
});

test('bottom-bar regime: the state rides the More tab as a warning triangle and tops its sheet; gone after a save', { tag: '@smoke' }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'Triangle');
    const badge = page.locator('#bottom-bar-more-storage-dot');

    // No state yet: no badge, and no storage row in the More sheet.
    await expect(badge).toBeHidden();
    await page.locator('#bb-view-more').click();
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    await expect(page.locator('.bottom-sheet-storage-row')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);

    // An edit: the More tab carries the state (a triangle, not a dot), the
    // toolbar pill stays out of this regime.
    await addPerson(page, 'First');
    await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
    await expect(badge).toBeVisible();
    await expect(badge.locator('svg path.tri')).toHaveCount(1);
    await expect(page.locator('#bb-view-more')).toHaveAttribute('aria-label', 'More – changes are not saved');

    // The sheet is topped by the state row, which opens "Where the data is".
    await page.locator('#bb-view-more').click();
    const row = page.locator('.bottom-sheet-storage-row');
    await expect(row).toContainText('Only in browser');
    await expect(page.locator('.bottom-sheet-storage-title')).toHaveText('Only in browser – not saved');
    await row.click();
    await expect(page.locator('#storage-status-modal')).toBeVisible();
    await expect(page.locator('#storage-status-modal .storage-pill')).toHaveClass(/is-unsaved/);

    // Saving clears the badge.
    await page.locator('#storage-status-save').click();
    await expect(badge).toBeHidden();
});

test('the backups dialog says whether the browser may clear the data', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'Backups');
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const note = page.locator('#snapshots-persistence');
    await expect(note).toContainText('may clear it');
    await expect(note).toContainText('was last saved to a file (or opened from one)');
    await note.getByRole('button', { name: 'Where is my data?' }).click();
    await expect(page.locator('#storage-status-modal')).toBeVisible();
});

test('persistent storage: no notice, no icon, and the backups dialog says so', async ({ page }) => {
    await stubPersistence(page, true);
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Persistent');
    await addPerson(page, 'First');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(page.locator('#file-copy-notice')).toHaveCount(0);
    await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-persistence')).toContainText('keeps the storage for good');
});

test('wide screens: a labelled pill, "Saved to file" after an export; reminders off: no notice', async ({ page }) => {
    await stubPersistence(page, false);
    await page.setViewportSize({ width: 1440, height: 800 });
    // openApp turns the file-copy reminders off by default.
    await openApp(page);
    await importBigTree(page, 'Wide');
    await addPerson(page, 'First');
    const pill = page.locator('#unsaved-copy-indicator');
    await expect(pill).toBeVisible();
    // With reminders off the indicator still shows, the notice never does.
    await expect(page.locator('#file-copy-notice')).toHaveCount(0);
    await expect(pill.locator('.storage-pill-label')).toHaveText('Only in browser');
    await exportTreeJson(page);
    await expect(pill.locator('.storage-pill-label')).toHaveText('Saved to file');
    await expect(pill).toBeHidden({ timeout: 6000 });
});

test('reduced motion: the first-edit highlight does not animate', async ({ page }) => {
    await stubPersistence(page, false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 800 });
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Calm');
    await addPerson(page, 'First');
    await expect(page.locator('#unsaved-copy-indicator')).toBeVisible();
    await expect(page.locator('#unsaved-copy-indicator')).toHaveClass(/storage-pulse/);
    const running = await page.locator('#unsaved-copy-indicator').evaluate(el => el.getAnimations().length);
    expect(running).toBe(0);
});

test('the indicator covers every tree; the dialog names them and saves all', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'First tree');
    await addPerson(page, 'Edited');
    await importBigTree(page, 'Second tree');
    // The open tree is saved (just imported), the first still is not.
    const indicator = page.locator('#unsaved-copy-indicator');
    await expect(indicator).toBeVisible();
    await indicator.click();
    const dialog = page.locator('#storage-status-modal');
    // Only another tree is unsaved: a list, and "Save all trees" is the primary action.
    await expect(dialog.locator('.storage-status-list-title')).toHaveText('Not saved to a file yet');
    await expect(dialog.locator('.storage-status-trees li')).toHaveCount(1);
    await expect(dialog.locator('.storage-status-trees')).toContainText('First tree');
    await expect(dialog.locator('#storage-status-save')).toBeHidden();
    await expect(dialog.locator('#storage-status-save-all')).toHaveClass(/primary/);
    // One click, no dialog.
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Save all trees' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('strom-all-trees.json');
    await expect(page.locator('#export-password-modal')).not.toHaveClass(/active/);
    await expect(indicator).toHaveClass(/is-saved/);
});

test('"Save all trees" only when two or more trees are unsaved; the open one first', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'One');
    await addPerson(page, 'A');
    await page.locator('#unsaved-copy-indicator').click();
    const dialog = page.locator('#storage-status-modal');
    await expect(dialog.locator('#storage-status-save')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).toBeHidden();
    await expect(dialog.locator('.storage-status-trees')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.closeStorageStatusDialog());

    await importBigTree(page, 'Two');
    await addPerson(page, 'B');
    await page.locator('#unsaved-copy-indicator').click();
    await expect(dialog.locator('#storage-status-save')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).not.toHaveClass(/primary/);
    const rows = dialog.locator('.storage-status-trees li');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Two');
    await expect(rows.first().locator('.tree-badge')).toHaveText('open');
});

for (const width of [360, 768]) {
    test(`the "More" dots sit on the icon's corner at ${width}px, safe area or not`, async ({ page }) => {
        await stubPersistence(page, false);
        await page.setViewportSize({ width, height: 800 });
        await openApp(page);
        await importBigTree(page, 'Dots');
        await addPerson(page, 'A');
        // The badge pulses by size when it turns on: measure it at rest.
        const badge = page.locator('#bottom-bar-more-storage-dot');
        await expect(badge).toBeVisible();
        await expect(badge).not.toHaveClass(/storage-pulse/, { timeout: 5000 });
        for (const pad of [0, 34]) {
            await page.evaluate((p) => { (document.querySelector('.bottom-bar') as HTMLElement).style.paddingBottom = `${p}px`; }, pad);
            const gap = await page.evaluate(() => {
                const icon = document.querySelector('#bb-view-more .bottom-bar-icon')!.getBoundingClientRect();
                const dot = document.getElementById('bottom-bar-more-storage-dot')!.getBoundingClientRect();
                return { dx: Math.abs(dot.right - (icon.right + 4)), dy: Math.abs(dot.top - (icon.top - 2)) };
            });
            expect(gap.dx, `pad ${pad}: dot x`).toBeLessThanOrEqual(6);
            expect(gap.dy, `pad ${pad}: dot y`).toBeLessThanOrEqual(6);
        }
        // No ⋯ in the top bar any more (More is the bottom bar's only).
        await expect(page.locator('.mobile-more-btn')).toBeHidden();
    });
}

for (const width of [1100, 1200]) {
    test(`${width}px: the state never takes room from the tree switcher's name`, async ({ page }) => {
        await stubPersistence(page, false);
        await page.setViewportSize({ width, height: 800 });
        await openApp(page);
        await importBigTree(page, 'Novákovi');
        const nameWidth = () => page.locator('.tree-switcher-btn .tree-name').evaluate(el => el.clientWidth);
        const before = await nameWidth();
        await addPerson(page, 'A');
        await expect(page.locator('body')).toHaveClass(/storage-unsaved/);
        expect(await nameWidth()).toBe(before);
        if (width < 1180) {
            // No pill here: the Actions ⋯ has the dot, its menu the state row.
            await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
            await expect(page.locator('.actions-menu-storage-dot')).toBeVisible();
            await page.locator('.actions-menu-btn').click();
            await page.locator('#actions-storage-row').click();
            await expect(page.locator('#storage-status-modal')).toBeVisible();
        } else {
            await expect(page.locator('#unsaved-copy-indicator')).toBeVisible();
            await expect(page.locator('.actions-menu-storage-dot')).toBeHidden();
        }
    });
}

/** Edit Kamil's birth year in the person dialog and save. */
async function saveBirthYear(page: Page, year: string): Promise<void> {
    await cardAction(page, 'Kamil', 'edit');
    await personModal(page).locator('#input-birthdate').fill(year);
    await personModal(page).getByRole('button', { name: 'Save' }).click();
}

test('an edit saved right before the page is reloaded, left or closed is kept', { tag: '@smoke' }, async ({ page, context }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kamil', 'Novak', { birthDate: '1900' });
    await page.waitForTimeout(500);

    // Reloaded at once: the write still under way went with the page before.
    await saveBirthYear(page, '1899');
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(card(page, 'Kamil')).toContainText('1899');

    // Left for another address at once.
    await saveBirthYear(page, '1898');
    await page.goto('/strom.html?view=tree');
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(card(page, 'Kamil')).toContainText('1898');

    // The tab closed at once, the app opened again.
    await saveBirthYear(page, '1897');
    await page.close();
    const again = await context.newPage();
    await again.goto('/strom.html');
    await expect(again.locator('html')).not.toHaveClass(/app-loading/);
    await expect(card(again, 'Kamil')).toContainText('1897');
    // Stored: nothing is kept aside any more.
    await expect.poll(() => again.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-save-rescue:')).length)).toBe(0);
});

test('a state kept aside on leaving does not overwrite a tree stored after it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kamil', 'Novak', { birthDate: '1900' });
    await saveBirthYear(page, '1895');
    await expect(card(page, 'Kamil')).toContainText('1895');
    // A rescue older than the stored tree (another window stored it later).
    await page.evaluate(() => {
        const id = (window as unknown as { Strom: { TreeManager: { getActiveTreeId(): string } } }).Strom.TreeManager.getActiveTreeId();
        localStorage.setItem(`strom-save-rescue:${id}`, JSON.stringify({ at: Date.now() - 60_000, base: null, data: { version: 1, persons: {}, partnerships: {} } }));
    });
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(card(page, 'Kamil')).toContainText('1895');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-save-rescue:')).length)).toBe(0);
});

test('a state kept aside by a closed tab that another tab outdated goes to Backups, never lost; it restores like any backup', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kamil', 'Novak', { birthDate: '1900' });
    await saveBirthYear(page, '1895');
    await expect(card(page, 'Kamil')).toContainText('1895');
    await page.waitForTimeout(300);
    // The closed tab's state: Kamil 1777, rescued a minute before this tab stored 1895.
    const rescuedAt = await page.evaluate(() => {
        const strom = (window as unknown as { Strom: { TreeManager: { getActiveTreeId(): string }; DataManager: { getData(): any } } }).Strom;
        const data = JSON.parse(JSON.stringify(strom.DataManager.getData()));
        for (const p of Object.values(data.persons) as any[]) if (p.firstName === 'Kamil') p.birthDate = '1777';
        const at = Date.now() - 60_000;
        localStorage.setItem(`strom-save-rescue:${strom.TreeManager.getActiveTreeId()}`, JSON.stringify({ at, base: null, data }));
        return at;
    });
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    // The newer state stays.
    await expect(card(page, 'Kamil')).toContainText('1895');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-save-rescue:')).length)).toBe(0);
    // The rescued one is a backup, at the time it was rescued.
    const backups = await page.evaluate(() => new Promise<{ reason: string; createdAt: number }[]>((resolve, reject) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            const all = req.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll();
            all.onsuccess = () => resolve(all.result.filter((s: { meta?: unknown }) => s.meta).map((s: { meta: { reason: string; createdAt: number } }) => s.meta));
            all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
    }));
    expect(backups.filter(b => b.reason === 'closed-tab').map(b => b.createdAt)).toEqual([rescuedAt]);
    await page.evaluate(() => (window as unknown as { Strom: { UI: { showSnapshotsDialog(): void } } }).Strom.UI.showSnapshotsDialog());
    const row = page.locator('#snapshots-modal .snapshot-row', { hasText: 'Backup copy from a closed tab' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Restore' }).click();
    await page.locator('#confirmation-modal').getByRole('button', { name: 'Restore backup' }).click();
    await expect(card(page, 'Kamil')).toContainText('1777');
});

test('a tab closed before its save landed keeps its state while another tab goes on saving the tree: it goes to Backups at the next start (N60-1)', async ({ page, context }) => {
    type W = { Strom: { TreeManager: any; DataManager: any } };
    await openApp(page);
    await createFirstPerson(page, 'Kamil', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => (window as unknown as W).Strom.DataManager.createPerson({ firstName: 'Pavel', lastName: 'Novak', gender: 'male', birthDate: '1910' }));
    await page.waitForTimeout(500);
    const other = await context.newPage();
    await other.goto('/strom.html');
    await expect(other.locator('html')).not.toHaveClass(/app-loading/);
    const born = (p: Page, name: string) => p.evaluate((name) => (Object.values((window as unknown as W).Strom.DataManager.getData().persons).find((x: any) => x.firstName === name) as any)?.birthDate, name);
    expect(await born(other, 'Pavel')).toBe('1910');
    // This tab's write never lands; it is closed with the edit rescued.
    await page.evaluate(() => {
        const { TreeManager, DataManager } = (window as unknown as W).Strom;
        TreeManager.saveQueues.set(TreeManager.getActiveTreeId(), new Promise(() => undefined));
        const kamil = Object.values(DataManager.getData().persons).find((p: any) => p.firstName === 'Kamil') as any;
        DataManager.updatePerson(kamil.id, { birthDate: '1777' });
        TreeManager.rescueUnsettledSaves();
    });
    const rescues = (p: Page) => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-save-rescue:')).length);
    expect(await rescues(page)).toBe(1);
    await page.close();
    // The other tab saves the tree: the closed tab's copy stays.
    await other.evaluate(() => {
        const dm = (window as unknown as W).Strom.DataManager;
        const pavel = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Pavel') as any;
        dm.updatePerson(pavel.id, { birthDate: '1912' });
    });
    await other.waitForTimeout(500);
    expect(await rescues(other)).toBe(1);
    // The next start: the tree stored later stays, the closed tab's state is a backup.
    await other.reload();
    await expect(other.locator('html')).not.toHaveClass(/app-loading/);
    expect(await born(other, 'Pavel')).toBe('1912');
    await expect(card(other, 'Kamil')).toContainText('1900');
    await expect.poll(() => rescues(other)).toBe(0);
    await other.evaluate(() => (window as unknown as { Strom: { UI: { showSnapshotsDialog(): void } } }).Strom.UI.showSnapshotsDialog());
    const row = other.locator('#snapshots-modal .snapshot-row', { hasText: 'Backup copy from a closed tab' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Restore' }).click();
    await other.locator('#confirmation-modal').getByRole('button', { name: 'Restore backup' }).click();
    await expect(card(other, 'Kamil')).toContainText('1777');
});

test('a state kept aside that is the stored tree anyway makes no backup', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kamil', 'Novak', { birthDate: '1900' });
    await saveBirthYear(page, '1895');
    await expect(card(page, 'Kamil')).toContainText('1895');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const strom = (window as unknown as { Strom: { TreeManager: { getActiveTreeId(): string }; DataManager: { getData(): unknown } } }).Strom;
        localStorage.setItem(`strom-save-rescue:${strom.TreeManager.getActiveTreeId()}`, JSON.stringify({ at: Date.now() - 60_000, base: null, data: strom.DataManager.getData() }));
    });
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('strom-save-rescue:')).length)).toBe(0);
    await page.evaluate(() => (window as unknown as { Strom: { UI: { showSnapshotsDialog(): void } } }).Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-modal .snapshot-row', { hasText: 'Backup copy from a closed tab' })).toHaveCount(0);
});
