import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, importJsonAsNewTree, mergeCompare, mergeCurrentStep, mergeWriteAndSwitch, openTreeActions, openTreeStructure, reloadApp } from './helpers.js';

/**
 * The ways into the import guide and its first moment (spec 134 §2): a
 * dropped GEDCOM file, Import → GEDCOM, Merge into another tree (Swap), Merge
 * this view into; each opens step 1 with the import filled in and writes
 * nothing. A research's own file still loads as the research. A tree that
 * cannot take the import (locked, followed live) says why and what can be
 * done; a file that is no GEDCOM says so; a dialog open says it needs
 * finishing first; a merge left open is offered again after a reload, with
 * the line about its tree changed since. The families Modřín (the tree) and
 * Jilm (the file) are invented.
 */

const GED = 'e2e/fixtures/rodokmen-jilmovi.ged';

/** The app with the tree Modřínovi open (3 people). */
async function openModrinovi(page: Page): Promise<void> {
    await openApp(page);
    await importJsonAsNewTree(page, 'e2e/fixtures/modrinovi.json', 'Modřínovi');
}

/** A second tree Jilmovi (not switched to); its id. */
async function seedJilmovi(page: Page): Promise<string> {
    return page.evaluate(() => {
        const TM = window.Strom.TreeManager;
        const id = TM.createTree('Jilmovi');
        TM.saveTreeData(id, {
            persons: { j1: { id: 'j1', firstName: 'Amos', lastName: 'Jilm', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
            partnerships: {},
        });
        return id;
    });
}

/** Every tree's stored data, the open tree and the backups: what "nothing written" compares. */
async function stored(page: Page): Promise<string> {
    return page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        const trees = TM.getTrees();
        const data: Record<string, unknown> = {};
        for (const t of trees) data[t.name] = await TM.getTreeData(t.id);
        return JSON.stringify({ open: window.Strom.DataManager.getCurrentTreeId(), names: trees.map((t: { name: string }) => t.name).sort(), data });
    });
}

/** A file dropped on the page as the browser does it (dragenter, dragover, drop). */
async function dropFile(page: Page, name: string, text: string, stopAt?: 'dragover'): Promise<void> {
    await page.evaluate(({ name, text, stopAt }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: 'text/plain' }));
        const fire = (type: string) => document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        fire('dragenter');
        fire('dragover');
        if (stopAt === 'dragover') return;
        fire('drop');
    }, { name, text, stopAt });
}

const gedText = async (): Promise<string> => (await import('node:fs')).readFileSync(GED, 'utf-8');

const target = (wizard: Locator, name: string): Locator =>
    wizard.locator('.merge-s1-target').filter({ has: wizard.page().locator('.merge-s1-tname', { hasText: new RegExp(`^${name}$`) }) });

test('a dropped GEDCOM file: the overlay says the guide opens, step 1 holds the file, nothing is written', async ({ page }) => {
    await openModrinovi(page);
    const before = await stored(page);
    const text = await gedText();

    // While dragging: the overlay says what happens to the file.
    await dropFile(page, 'rodokmen-jilmovi.ged', text, 'dragover');
    const overlay = page.locator('#drop-overlay');
    await expect(overlay).toHaveClass(/active/);
    await expect(overlay).toContainText('The import guide opens: first choose what to do with it. Nothing is written until the last step is confirmed.');
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: new DataTransfer() })));

    await dropFile(page, 'rodokmen-jilmovi.ged', text);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Modřínovi');
    expect(await stored(page)).toBe(before);

    // Closed before the comparison: still nothing written.
    await page.keyboard.press('Escape');
    await expect(wizard).toBeHidden();
    expect(await stored(page)).toBe(before);
});

test('Import → GEDCOM opens step 1 with the file and writes nothing', async ({ page }) => {
    await openModrinovi(page);
    const before = await stored(page);
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Modřínovi');
    expect(await stored(page)).toBe(before);
});

test('Merge into another tree from Manage trees: the open tree is the target, Swap turns the way round, nothing is switched or written', async ({ page }) => {
    await openModrinovi(page);
    await seedJilmovi(page);
    const before = await stored(page);

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    const row = manager.locator('.tree-manager-item').filter({ has: page.locator('.tree-manager-item-name', { hasText: /^Jilmovi$/ }) });
    await row.locator('.tree-row-menu-btn').click();
    const menu = row.locator('.tree-row-menu.open');
    const entry = menu.locator('.tree-row-menu-item', { hasText: 'Merge into another tree' }).first();
    if (!await entry.isVisible()) await openTreeStructure(page, menu);
    await entry.click();

    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(manager).toBeHidden();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
    await expect(wizard.locator('.merge-s1-targets')).not.toContainText('Jilmovi');
    await expect(wizard.locator('#merge-route')).toHaveText('Jilmovi → Modřínovi');

    await wizard.locator('.merge-s1-swap').click();
    await expect(wizard.locator('#merge-route')).toHaveText('Modřínovi → Jilmovi');
    expect(await stored(page)).toBe(before);
});

test('Merge this view into: the open tree is not offered, the other one is the target', async ({ page }) => {
    await openModrinovi(page);
    await seedJilmovi(page);
    const before = await stored(page);
    const structure = await openTreeStructure(page, await openTreeActions(page));
    await structure.locator('.tree-switcher-action').filter({ hasText: 'Merge view into' }).click();
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(wizard.locator('.merge-s1-target')).toHaveCount(1);
    await expect(target(wizard, 'Jilmovi').locator('input')).toBeChecked();
    expect(await stored(page)).toBe(before);
});

test('a research\'s own file still loads as the research, not through the guide', async ({ page }) => {
    await openModrinovi(page);
    const text = [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', '1 _STROM_TREE 3c9e1f20-7a4b-4d6e-9f12-5b8a0c7d2e41', '1 _STROM_HEAD 9d2c4e6f8a1b',
        '1 CHAR UTF-8', '1 NOTE Jilmovi z Mechové',
        '0 @P0001@ INDI', '1 NAME Amos /Jilm/', '1 SEX M', '1 REFN P0001',
        '0 TRLR', '',
    ].join('\n');
    await dropFile(page, 'jilmovi.ged', text);
    // The research's tree is there (loaded, or asked about first), the guide never opens.
    await expect.poll(async () => await page.evaluate(() => window.Strom.TreeManager.getTrees().some((t: { name: string }) => t.name === 'Jilmovi z Mechové'))
        || await page.locator('#confirmation-modal.active').isVisible()).toBe(true);
    await expect(page.locator('#merge-modal')).toBeHidden();
});

test('a locked tree: step 1 says why, Add to a tree offers Manage trees', async ({ page }) => {
    await openModrinovi(page);
    await page.evaluate(() => window.Strom.TreeManager.toggleTreeLock(window.Strom.DataManager.getCurrentTreeId()));
    const before = await stored(page);
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    // The only tree cannot take it: New tree is preset, the tree said why.
    await expect(wizard.locator('.merge-s1-modes [data-mode="new"]')).toHaveAttribute('aria-checked', 'true');
    await wizard.locator('.merge-s1-modes [data-mode="add"]').click();
    const tile = target(wizard, 'Modřínovi');
    await expect(tile).toHaveAttribute('data-block', 'locked');
    await expect(tile.locator('.merge-s1-tline')).toContainText('The tree Modřínovi is locked: it cannot be written to.');
    // Every tree blocked: a dialog says why, with Manage trees and Choose another tree.
    const dialog = page.locator('#confirmation-modal');
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog).toContainText('The tree Modřínovi is locked: it cannot be written to.');
    await expect(dialog.getByRole('button', { name: 'Choose another tree' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Choose another tree' }).click();
    await expect(wizard).toBeVisible();
    // No tree to name: the route is the file alone, the primary compares without a tree's name and waits.
    await expect(wizard.locator('#merge-route')).not.toContainText('→');
    await expect(wizard.locator('#merge-next')).toHaveText(/^Compare \d+ people$/);
    await expect(wizard.locator('#merge-next')).toBeDisabled();
    await expect(wizard.locator('#merge-counts')).not.toContainText('New tree');
    expect(await stored(page)).toBe(before);
});

test('a tree followed live: step 1 says so, End following frees it', async ({ page }) => {
    await openModrinovi(page);
    // Following stood in for: the research is not running in this test.
    await page.evaluate(() => {
        const UI = window.Strom.UI as unknown as { isLiveFollowOn: () => boolean; setLiveFollow: (on: boolean) => void };
        let on = true;
        UI.isLiveFollowOn = () => on;
        UI.setLiveFollow = (v: boolean) => { on = v; };
    });
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await wizard.locator('.merge-s1-modes [data-mode="add"]').click();
    // The dialog for every tree blocked: End following.
    const dialog = page.locator('#confirmation-modal');
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog).toContainText('The tree is followed live from the research and is read-only.');
    await dialog.getByRole('button', { name: 'Choose another tree' }).click();
    // The line in step 1, with its own End following.
    const line = wizard.locator('#merge-s1-live');
    await expect(line).toContainText('The tree is followed live from the research and is read-only.');
    await line.locator('[data-s1="end-follow"]').click();
    await expect(line).toHaveCount(0);
    await expect(target(wizard, 'Modřínovi').locator('input')).toBeChecked();
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Modřínovi');
});

test('a dropped file that is no GEDCOM says so and changes nothing', async ({ page }) => {
    await openModrinovi(page);
    const before = await stored(page);
    await dropFile(page, 'poznamky-jilm.ged', 'Kniha Jilmů z Mechové\nnení to rodokmen\n');
    const dialog = page.locator('#confirmation-modal');
    await expect(dialog).toHaveClass(/active/);
    await expect(dialog).toContainText('poznamky-jilm.ged is not a readable GEDCOM file. Nothing changed.');
    await expect(page.locator('#merge-modal')).toBeHidden();
    expect(await stored(page)).toBe(before);
});

test('a GEDCOM file dropped over another dialog: the toast says it needs finishing first, Open now opens the guide', async ({ page }) => {
    await openModrinovi(page);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await expect(page.locator('#tree-manager-modal')).toBeVisible();
    await dropFile(page, 'rodokmen-jilmovi.ged', await gedText());
    const toast = page.locator('.toast').last();
    await expect(toast).toContainText('needs finishing first; then the file opens in the guide.');
    await expect(page.locator('#merge-modal')).toBeHidden();
    await toast.getByRole('button', { name: 'Open now' }).click();
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(page.locator('#tree-manager-modal')).toBeHidden();
    await expect(wizard.locator('#merge-route')).toHaveText('rodokmen-jilmovi.ged → Modřínovi');
});

test('a reload in an unfinished guide: the merge is offered again, the tree unchanged; its tree changed since: the line says so', async ({ page }) => {
    await openModrinovi(page);
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await expect.poll(() => page.evaluate(async () => !!(await window.Strom.MergerUI.getPendingMergeInfo()).current), { timeout: 10_000 }).toBe(true);
    const before = await stored(page);

    await reloadApp(page);
    const pending = page.locator('#pending-merge-modal');
    await expect(pending).toHaveClass(/active/);
    // A merge that did not finish (13g): its tree and the file are unchanged.
    await expect(pending.locator('.pending-merge-message')).toHaveText('Last time the merge did not finish. The tree Modřínovi and the file are unchanged.');
    const item = pending.locator('.pending-merge-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.pending-merge-meta')).toContainText('Step 2 of 6 · Who is who');
    await expect(item.locator('.pending-merge-changed')).toHaveCount(0);
    expect(await stored(page)).toBe(before);

    // The tree changes meanwhile (one person's birth place): the offer says so.
    await page.evaluate(() => window.Strom.UI.closePendingMergeDialog());
    await page.evaluate(async () => {
        const TM = window.Strom.TreeManager;
        const id = window.Strom.DataManager.getCurrentTreeId();
        const data = await TM.getTreeData(id);
        const first = Object.values(data.persons)[0] as { birthPlace?: string };
        first.birthPlace = 'Křemenná u Mechové';
        TM.saveTreeData(id, data);
    });
    await reloadApp(page);
    await expect(pending).toHaveClass(/active/);
    await expect(item.locator('.pending-merge-changed')).toHaveText('The tree Modřínovi has changed since (1 edit): suggestions are recalculated, decisions stay.');
});

/** The backups "Before merge" of the tree `treeId`, as its backups dialog lists them (the dialog closed again). */
async function preMergeBackups(page: Page, treeId: string): Promise<string[]> {
    await page.evaluate((id) => window.Strom.UI.showSnapshotsDialog(id), treeId);
    const rows = page.locator('#snapshots-modal .snapshot-row');
    await expect(page.locator('#snapshots-modal')).toBeVisible();
    const texts = (await rows.allTextContents()).filter(t => t.includes('Before merge'));
    await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());
    return texts;
}

/** Automatic backups off for the tree: the backup "Before merge" is taken all the same (K0.4). */
async function autoBackupsOff(page: Page, treeId: string): Promise<void> {
    await page.evaluate((id) => window.Strom.TreeManager.setAutoBackups(id, false), treeId);
}

const openTreeId = (page: Page): Promise<string> => page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);

for (const way of ['GEDCOM file', 'view', 'share'] as const) {
    test(`the backup Before merge from a ${way}: none while comparing, one of the target at the write, with automatic backups off`, async ({ page }) => {
        await openModrinovi(page);
        const jilmovi = await seedJilmovi(page);
        const modrinovi = await openTreeId(page);
        const target = way === 'view' ? jilmovi : modrinovi;
        await autoBackupsOff(page, target);

        if (way === 'GEDCOM file') {
            await page.locator('#gedcom-input').setInputFiles(GED);
        } else if (way === 'view') {
            const structure = await openTreeStructure(page, await openTreeActions(page));
            await structure.locator('.tree-switcher-action').filter({ hasText: 'Merge view into' }).click();
        } else {
            // A relative's reply to a shared file, as Review and merge takes it.
            await page.evaluate(async (id) => {
                const UI = window.Strom.UI as unknown as { pendingReplyEnvelope: unknown; shareReplyMerge(): Promise<void> };
                UI.pendingReplyEnvelope = {
                    senderName: 'Amos',
                    data: {
                        version: 26, partnerships: {},
                        persons: { r1: { id: 'r1', firstName: 'Amos', lastName: 'Jilm', gender: 'male', birthDate: '1925', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
                    },
                };
                document.getElementById('share-reply-modal')!.dataset.targetTreeId = id;
                await UI.shareReplyMerge();
            }, modrinovi);
        }
        const wizard = page.locator('#merge-modal');
        await expect(wizard).toBeVisible();
        await mergeCompare(wizard);
        expect(await preMergeBackups(page, target)).toEqual([]);

        await mergeWriteAndSwitch(page, wizard);
        const backups = await preMergeBackups(page, target);
        expect(backups).toHaveLength(1);
        expect(backups[0]).toContain(way === 'view' ? '1 person' : '3 people');
    });
}

test('a saved merge whose tree changed, gone on with as saved: the backup Before merge holds the tree as it is at the write', async ({ page }) => {
    await openModrinovi(page);
    const modrinovi = await openTreeId(page);
    await autoBackupsOff(page, modrinovi);
    await page.locator('#gedcom-input').setInputFiles(GED);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await mergeCompare(wizard);
    await wizard.locator('#merge-save-later').click();
    await expect(wizard).toBeHidden();
    await expect.poll(() => page.evaluate(async () => (await window.Strom.MergerUI.getPendingMergeInfo()).saved.length)).toBe(1);

    // The tree gets a fourth person meanwhile.
    await page.evaluate(() => {
        window.Strom.DataManager.createPerson({ firstName: 'Hostivít', lastName: 'Modřín', gender: 'male', birthDate: '1950' });
    });

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.locator('#tree-manager-modal .tree-manager-item.pending-merge .tree-open-btn').click();
    const ask = page.locator('#confirmation-modal');
    await expect(page.locator('#confirm-title')).toHaveText('The tree has changed');
    await ask.getByRole('button', { name: 'Go on as saved' }).click();
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
    expect(await preMergeBackups(page, modrinovi)).toEqual([]);

    await mergeWriteAndSwitch(page, wizard);
    const backups = await preMergeBackups(page, modrinovi);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toContain('4 people');
});
